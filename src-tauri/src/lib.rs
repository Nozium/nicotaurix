use nicotaurix_core::{qr, ws};
use tauri::Manager;

#[tauri::command]
fn get_local_qr(port: u16) -> Result<String, String> {
    qr::generate_qr_svg(port)
}

#[tauri::command]
fn get_local_ip() -> Result<String, String> {
    qr::get_lan_ip()
}

#[tauri::command]
fn get_ws_url() -> Result<String, String> {
    let ip = qr::get_lan_ip()?;
    Ok(format!("ws://{}:{}", ip, ws::WS_PORT))
}

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            // Start WebSocket server for danmaku sync
            tauri::async_runtime::spawn(async move {
                if let Err(e) = ws::start_ws_server().await {
                    eprintln!("WebSocket server error: {}", e);
                }
            });

            // Inject danmaku script into main window
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.eval(include_str!("../../frontend/src/danmaku-inject.js"));
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_local_qr,
            get_local_ip,
            get_ws_url
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
