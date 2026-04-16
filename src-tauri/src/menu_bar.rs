use tauri::{
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, Runtime, WebviewUrl, WebviewWindowBuilder, WindowEvent,
};

use crate::agent_registry::AgentWorkspaceRegistry;
use std::sync::atomic::{AtomicBool, Ordering};

const OVERVIEW_WINDOW_LABEL: &str = "agent-overview";
const OVERVIEW_WINDOW_WIDTH: f64 = 720.0;
const OVERVIEW_WINDOW_HEIGHT: f64 = 400.0;

// Flag to track if auto-close should be enabled (prevents closing immediately on open)
static AUTO_CLOSE_ENABLED: AtomicBool = AtomicBool::new(false);

const TRAY_ICON_ID: &str = "tome-tray";

/// Initialize the menu bar tray icon (click to show overview)
pub fn init_menu_bar<R: Runtime>(app: &tauri::App<R>) -> Result<(), Box<dyn std::error::Error>> {
    // Build the tray icon without menu - click directly opens overview
    let _tray = TrayIconBuilder::with_id(TRAY_ICON_ID)
        .icon(app.default_window_icon().unwrap().clone())
        .tooltip("Tome")
        .on_tray_icon_event(move |tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                toggle_overview_window(tray.app_handle());
            }
        })
        .build(app)?;

    Ok(())
}

/// Toggle the overview window visibility
fn toggle_overview_window<R: Runtime>(app: &tauri::AppHandle<R>) {
    // Check if overview window exists
    if let Some(window) = app.get_webview_window(OVERVIEW_WINDOW_LABEL) {
        match window.is_visible() {
            Ok(true) => {
                let _ = window.hide();
            }
            Ok(false) => {
                let _ = window.show();
                let _ = window.set_focus();
            }
            Err(_) => {}
        }
    } else {
        let _ = create_overview_window(app);
    }
}

/// Create the overview window positioned near the menu bar
fn create_overview_window<R: Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<(), Box<dyn std::error::Error>> {
    // Get the primary monitor
    let monitor = match app.primary_monitor()? {
        Some(m) => m,
        None => {
            let monitors = app.available_monitors().unwrap_or_default();
            monitors.first().cloned().ok_or("No monitors available")?
        }
    };

    let monitor_size = monitor.size();
    let monitor_position = monitor.position();
    let scale_factor = monitor.scale_factor();

    // Position at top-center of screen, below the menu bar
    // Menu bar is typically ~24px on macOS, so start at y=35
    // Account for monitor position (important for multi-monitor setups)
    // Use logical pixels (Tauri's .position() expects logical pixels)
    let x = monitor_position.x as f64
        + (monitor_size.width as f64 / scale_factor - OVERVIEW_WINDOW_WIDTH) / 2.0;
    let y = monitor_position.y as f64 / scale_factor + 35.0;

    let window = WebviewWindowBuilder::new(
        app,
        OVERVIEW_WINDOW_LABEL,
        WebviewUrl::App("/overview".into()),
    )
    .title("Agent Overview")
    .inner_size(OVERVIEW_WINDOW_WIDTH, OVERVIEW_WINDOW_HEIGHT)
    .position(x, y)
    .resizable(false)
    .maximizable(false)
    .minimizable(false)
    .always_on_top(true)
    .decorations(false)
    .skip_taskbar(true)
    .visible(true)
    .build()?;

    // Show and focus
    let _ = window.show();
    let _ = window.set_focus();

    // Reset auto-close flag and enable after delay
    AUTO_CLOSE_ENABLED.store(false, Ordering::SeqCst);
    let _app_handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(300));
        AUTO_CLOSE_ENABLED.store(true, Ordering::SeqCst);
    });

    // Listen for focus loss to auto-close
    let window_clone = window.clone();
    window.on_window_event(move |event| {
        if let WindowEvent::Focused(false) = event {
            if AUTO_CLOSE_ENABLED.load(Ordering::SeqCst) {
                let _ = window_clone.close();
            }
        }
    });

    Ok(())
}

/// Update the tray icon based on agent state
pub fn update_tray_icon<R: Runtime>(
    app: &tauri::AppHandle<R>,
    registry: &AgentWorkspaceRegistry,
) -> Result<(), Box<dyn std::error::Error>> {
    if let Some(tray) = app.tray_by_id(TRAY_ICON_ID) {
        let active_count = registry.active_agent_count();
        let tooltip = if active_count > 0 {
            format!(
                "Tome - {} active agent{}",
                active_count,
                if active_count > 1 { "s" } else { "" }
            )
        } else {
            "Tome".to_string()
        };
        let _ = tray.set_tooltip(Some(&tooltip));
    }

    Ok(())
}

/// Get the overview window label
pub fn overview_window_label() -> &'static str {
    OVERVIEW_WINDOW_LABEL
}
