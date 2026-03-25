mod pty;

use pty::PtyManager;
use std::sync::Arc;
use tauri::State;

struct AppState {
    pty_manager: Arc<PtyManager>,
}

#[tauri::command]
fn create_session(app: tauri::AppHandle, state: State<AppState>) -> Result<String, String> {
    state.pty_manager.create_session(app)
}

#[tauri::command]
fn write_input(session_id: String, data: String, state: State<AppState>) -> Result<(), String> {
    state.pty_manager.write_input(&session_id, &data)
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(AppState {
            pty_manager: Arc::new(PtyManager::new()),
        })
        .invoke_handler(tauri::generate_handler![
            create_session,
            write_input,
            resize_pty
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
