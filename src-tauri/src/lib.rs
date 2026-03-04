use nicotaurix_core::{qr, ws};
use std::sync::Mutex;

#[cfg(not(target_os = "ios"))]
use tauri::{Manager, Url, WebviewBuilder, WebviewUrl, webview::NewWindowResponse};

#[cfg(target_os = "ios")]
use tauri::Manager;

struct BrowserState {
    current_url: Mutex<String>,
}

// ── Shared commands (both desktop & iOS) ──

#[tauri::command]
fn get_platform() -> String {
    #[cfg(target_os = "ios")]
    { "ios".to_string() }
    #[cfg(not(target_os = "ios"))]
    { "desktop".to_string() }
}

#[tauri::command]
fn get_local_qr(port: u16) -> Result<String, String> {
    qr::generate_qr_svg(port)
}

#[tauri::command]
fn get_ws_qr() -> Result<String, String> {
    let ip = qr::get_lan_ip()?;
    let ws_url = format!("ws://{}:{}/ws", ip, ws::WS_PORT);
    qr::generate_qr_svg_for_url(&ws_url)
}

#[tauri::command]
fn get_local_ip() -> Result<String, String> {
    qr::get_lan_ip()
}

#[tauri::command]
fn get_ws_url() -> Result<String, String> {
    let ip = qr::get_lan_ip()?;
    Ok(format!("ws://{}:{}/ws", ip, ws::WS_PORT))
}

// ── Desktop-only commands ──

#[tauri::command]
fn navigate(app: tauri::AppHandle, url: String) -> Result<(), String> {
    #[cfg(not(target_os = "ios"))]
    {
        let parsed_url = if url.starts_with("http://") || url.starts_with("https://") {
            url.clone()
        } else {
            format!("https://{}", url)
        };

        let tauri_url: Url = parsed_url.parse().map_err(|e| format!("Invalid URL: {}", e))?;

        if let Some(webview) = app.get_webview("browser") {
            webview.navigate(tauri_url).map_err(|e| format!("Navigation failed: {}", e))?;

            let app2 = app.clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_secs(2)).await;
                if let Some(wv) = app2.get_webview("browser") {
                    let _ = wv.eval(include_str!("../../frontend/src/danmaku-inject.js"));
                }
            });
        } else {
            return Err("Browser webview not found".to_string());
        }

        if let Some(state) = app.try_state::<BrowserState>() {
            *state.current_url.lock().unwrap() = parsed_url;
        }
    }

    #[cfg(target_os = "ios")]
    { let _ = (app, url); }

    Ok(())
}

#[tauri::command]
fn browser_back(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(not(target_os = "ios"))]
    if let Some(webview) = app.get_webview("browser") {
        webview.eval("window.history.back()")
            .map_err(|e| format!("Back failed: {}", e))?;
    }
    #[cfg(target_os = "ios")]
    { let _ = app; }
    Ok(())
}

#[tauri::command]
fn browser_forward(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(not(target_os = "ios"))]
    if let Some(webview) = app.get_webview("browser") {
        webview.eval("window.history.forward()")
            .map_err(|e| format!("Forward failed: {}", e))?;
    }
    #[cfg(target_os = "ios")]
    { let _ = app; }
    Ok(())
}

#[tauri::command]
fn browser_reload(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(not(target_os = "ios"))]
    if let Some(webview) = app.get_webview("browser") {
        webview.eval("window.location.reload()")
            .map_err(|e| format!("Reload failed: {}", e))?;

        let app2 = app.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_secs(2)).await;
            if let Some(wv) = app2.get_webview("browser") {
                let _ = wv.eval(include_str!("../../frontend/src/danmaku-inject.js"));
            }
        });
    }
    #[cfg(target_os = "ios")]
    { let _ = app; }
    Ok(())
}

#[tauri::command]
fn inject_danmaku_script(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(not(target_os = "ios"))]
    if let Some(webview) = app.get_webview("browser") {
        webview.eval(include_str!("../../frontend/src/danmaku-inject.js"))
            .map_err(|e| format!("Injection failed: {}", e))?;
    }
    #[cfg(target_os = "ios")]
    { let _ = app; }
    Ok(())
}

// ── App entry point ──

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(BrowserState {
            current_url: Mutex::new("https://x.com".to_string()),
        })
        .setup(|app| {
            // Desktop: start WS server + multi-webview browser
            #[cfg(not(target_os = "ios"))]
            {
                // Start WebSocket server for danmaku sync
                tauri::async_runtime::spawn(async move {
                    if let Err(e) = ws::start_ws_server().await {
                        eprintln!("WebSocket server error: {}", e);
                    }
                });

                let window = app.get_window("main").unwrap();

                let browser_webview = WebviewBuilder::new(
                    "browser",
                    WebviewUrl::External("https://x.com".parse().unwrap()),
                )
                .auto_resize()
                .on_navigation(|_url| true)
                .on_new_window(move |_url, _features| {
                    NewWindowResponse::Allow
                });

                window.add_child(
                    browser_webview,
                    tauri::Position::Logical(tauri::LogicalPosition::new(0.0, 42.0)),
                    tauri::Size::Logical(tauri::LogicalSize::new(1280.0, 758.0)),
                ).map_err(|e| format!("Failed to create browser webview: {}", e))?;

                // Inject danmaku script after X.com loads
                let app_handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    tokio::time::sleep(std::time::Duration::from_secs(3)).await;
                    if let Some(wv) = app_handle.get_webview("browser") {
                        let _ = wv.eval(include_str!("../../frontend/src/danmaku-inject.js"));
                    }
                });
            }

            // iOS: no WS server, no multi-webview, just the main webview
            // The frontend JS detects platform and shows mobile danmaku viewer UI

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_platform,
            get_local_qr,
            get_ws_qr,
            get_local_ip,
            get_ws_url,
            navigate,
            browser_back,
            browser_forward,
            browser_reload,
            inject_danmaku_script
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
