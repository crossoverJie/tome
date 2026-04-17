mod agent_registry;
mod completion;
mod menu_bar;
mod pty;

use agent_registry::{AgentOverviewData, AgentWorkspaceRegistry, WindowSnapshot};
use completion::{CompletionResponse, ResolvedPathTarget};
use pty::PtyManager;
use std::sync::Arc;
use tauri::{Emitter, Manager, State};

struct AppState {
    pty_manager: Arc<PtyManager>,
    agent_registry: Arc<AgentWorkspaceRegistry>,
}

#[tauri::command]
fn create_session(
    app: tauri::AppHandle,
    state: State<AppState>,
    initial_cwd: Option<String>,
) -> Result<String, String> {
    state.pty_manager.create_session(app, initial_cwd)
}

#[tauri::command]
fn write_input(session_id: String, data: String, state: State<AppState>) -> Result<(), String> {
    state.pty_manager.write_input(&session_id, &data)
}

#[tauri::command]
fn request_completion(
    session_id: String,
    text: String,
    cursor: usize,
    state: State<AppState>,
) -> Result<CompletionResponse, String> {
    state.pty_manager.request_completion(&session_id, &text, cursor)
}

#[tauri::command]
fn get_current_directory(session_id: String, state: State<AppState>) -> Result<String, String> {
    state.pty_manager.get_current_directory(&session_id)
}

#[tauri::command]
fn resize_pty(
    session_id: String,
    cols: u16,
    rows: u16,
    state: State<AppState>,
) -> Result<(), String> {
    state.pty_manager.resize(&session_id, cols, rows)
}

#[tauri::command]
fn move_cursor_to_position(
    session_id: String,
    row: u16,
    col: u16,
    staged: Option<bool>,
    state: State<AppState>,
) -> Result<(), String> {
    state
        .pty_manager
        .move_cursor_to_position(&session_id, row, col, staged.unwrap_or(false))
}

#[tauri::command]
fn report_cursor_position(
    session_id: String,
    row: u16,
    col: u16,
    set_anchor: bool,
    state: State<AppState>,
) -> Result<bool, String> {
    state.pty_manager.report_cursor_position(&session_id, row, col, set_anchor)
}

#[tauri::command]
fn clear_interactive_input_anchor(
    session_id: String,
    state: State<AppState>,
) -> Result<(), String> {
    state.pty_manager.clear_interactive_input_anchor(&session_id)
}

#[tauri::command]
fn check_command_exists(command: String) -> bool {
    completion::check_command_exists(&command)
}

#[tauri::command]
fn check_path_exists(path: String, cwd: String) -> bool {
    completion::check_path_exists(&path, &cwd)
}

#[tauri::command]
fn update_window_snapshot(
    snapshot: WindowSnapshot,
    app: tauri::AppHandle,
    state: State<AppState>,
) -> Result<(), String> {
    state.agent_registry.update_window(snapshot);
    // Update tray icon tooltip to show active agent count
    let _ = menu_bar::update_tray_icon(&app, &state.agent_registry);
    Ok(())
}

#[tauri::command]
fn get_agent_overview(state: State<AppState>) -> Result<AgentOverviewData, String> {
    Ok(state.agent_registry.get_overview())
}

#[tauri::command]
fn unregister_window(
    window_label: String,
    app: tauri::AppHandle,
    state: State<AppState>,
) -> Result<(), String> {
    state.agent_registry.remove_window(&window_label);
    // Update tray icon tooltip after window unregisters
    let _ = menu_bar::update_tray_icon(&app, &state.agent_registry);
    Ok(())
}

#[tauri::command]
fn resolve_path_target(path: String, cwd: String) -> Result<ResolvedPathTarget, String> {
    completion::resolve_path_target(&path, &cwd)
}

#[derive(serde::Serialize, Clone)]
struct FocusPaneEvent {
    tab_id: String,
    pane_id: String,
}

#[derive(serde::Serialize, Clone)]
struct SystemInfo {
    os: String,
    shell: String,
    cpu: Option<String>,
    memory: Option<String>,
}

/// Get memory usage percentage on macOS
#[cfg(target_os = "macos")]
fn get_memory_usage() -> Option<u8> {
    use std::mem;

    // Use vm_statistics64 to get memory info
    unsafe {
        let mut stats: libc::vm_statistics64 = mem::zeroed();
        let mut count = libc::HOST_VM_INFO64_COUNT as u32;

        let result = libc::host_statistics64(
            libc::mach_host_self(),
            libc::HOST_VM_INFO64,
            &mut stats as *mut _ as *mut libc::integer_t,
            &mut count,
        );

        if result != libc::KERN_SUCCESS {
            return None;
        }

        let page_size = libc::sysconf(libc::_SC_PAGESIZE) as u64;

        let total_memory = (stats.wire_count as u64
            + stats.active_count as u64
            + stats.inactive_count as u64
            + stats.free_count as u64
            + stats.compressor_page_count as u64)
            * page_size;

        let used_memory = (stats.wire_count as u64
            + stats.active_count as u64
            + stats.compressor_page_count as u64)
            * page_size;

        if total_memory == 0 {
            return None;
        }

        let usage_percent = ((used_memory as f64 / total_memory as f64) * 100.0) as u8;
        Some(usage_percent)
    }
}

#[cfg(not(target_os = "macos"))]
fn get_memory_usage() -> Option<u8> {
    None
}

#[tauri::command]
fn get_system_info() -> Result<SystemInfo, String> {
    // OS info
    let os = format!("{} {}", std::env::consts::OS, std::env::consts::ARCH);

    // Shell info - get from SHELL env var or default to "unknown"
    let shell = std::env::var("SHELL")
        .ok()
        .and_then(|s| s.split('/').last().map(|s| s.to_string()))
        .unwrap_or_else(|| "unknown".to_string());

    // CPU info - try to get from system_profiler on macOS
    let cpu = if cfg!(target_os = "macos") {
        std::process::Command::new("sysctl")
            .args(["-n", "machdep.cpu.brand_string"])
            .output()
            .ok()
            .and_then(|output| String::from_utf8(output.stdout).ok())
            .map(|s| s.trim().to_string())
    } else {
        None
    };

    // Memory info - get actual usage percentage
    let memory = get_memory_usage().map(|p| format!("{}% used", p));

    Ok(SystemInfo {
        os,
        shell,
        cpu,
        memory,
    })
}

#[tauri::command]
fn focus_pane_in_window(
    window_label: String,
    tab_id: String,
    pane_id: String,
    app: tauri::AppHandle,
) -> Result<(), String> {
    // Emit event to the target window to focus the pane
    // The frontend will handle the actual focus logic
    app.emit_to(
        &window_label,
        "focus-pane",
        FocusPaneEvent { tab_id, pane_id },
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
fn focus_window(window_label: String, app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(&window_label) {
        let _ = window.show();
        let _ = window.set_focus();
        Ok(())
    } else {
        Err(format!("Window '{}' not found", window_label))
    }
}
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .manage(AppState {
            pty_manager: Arc::new(PtyManager::new()),
            agent_registry: Arc::new(AgentWorkspaceRegistry::new()),
        })
        .invoke_handler(tauri::generate_handler![
            create_session,
            write_input,
            request_completion,
            get_current_directory,
            resize_pty,
            move_cursor_to_position,
            report_cursor_position,
            clear_interactive_input_anchor,
            check_command_exists,
            check_path_exists,
            resolve_path_target,
            update_window_snapshot,
            get_agent_overview,
            unregister_window,
            focus_pane_in_window,
            focus_window,
            get_system_info
        ])
        .setup(|app| {
            // Initialize menu bar tray icon
            menu_bar::init_menu_bar(app)?;

            // Start stale window cleanup task (every 60 seconds)
            let app_handle = app.handle().clone();
            let agent_registry = app.state::<AppState>().agent_registry.clone();
            std::thread::spawn(move || {
                let cleanup_interval = std::time::Duration::from_secs(60);
                let stale_threshold_seconds = 300; // 5 minutes

                loop {
                    std::thread::sleep(cleanup_interval);
                    let _removed = agent_registry.cleanup_stale_windows(stale_threshold_seconds);
                    // Update tray icon after cleanup
                    let _ = menu_bar::update_tray_icon(&app_handle, &agent_registry);
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
