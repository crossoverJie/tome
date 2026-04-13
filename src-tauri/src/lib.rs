mod completion;
mod pty;

use completion::{CompletionResponse, ResolvedPathTarget};
use pty::PtyManager;
use std::sync::Arc;
use tauri::State;

struct AppState {
    pty_manager: Arc<PtyManager>,
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
fn resolve_path_target(path: String, cwd: String) -> Result<ResolvedPathTarget, String> {
    completion::resolve_path_target(&path, &cwd)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .manage(AppState {
            pty_manager: Arc::new(PtyManager::new()),
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
            resolve_path_target
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
