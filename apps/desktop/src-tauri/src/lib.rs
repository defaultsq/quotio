mod proxy;
mod sidecar;
mod tray;

use proxy::Proxy;
use sidecar::{ApiError, ApiResponse, Sidecar};
use std::sync::Arc;
use tauri::Manager;

/// Proxies one request to the sidecar's `/v2/*` API. The bearer token stays in Rust.
#[tauri::command]
async fn api(
    sidecar: tauri::State<'_, Arc<Sidecar>>,
    method: String,
    path: String,
    body: Option<serde_json::Value>,
    idempotency_key: Option<String>,
) -> Result<ApiResponse, ApiError> {
    sidecar
        .request(&method, &path, body, idempotency_key.as_deref())
        .await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .setup(|app| {
            // `bundle.externalBin` places the CLI next to the app executable, in dev and release.
            let binary = std::env::current_exe()?
                .with_file_name(format!("quotio-cli{}", std::env::consts::EXE_SUFFIX));
            let data_dir = app.path().app_data_dir()?;
            let log_dir = app.path().app_log_dir()?;
            app.manage(Sidecar::start(binary, data_dir, log_dir));
            app.manage(Proxy::new(app.handle())?);
            tray::setup(app.handle())?;
            Ok(())
        })
        .on_window_event(tray::on_main_window_event)
        .invoke_handler(tauri::generate_handler![
            api,
            tray::open_main,
            tray::close_popover,
            tray::quit,
            tray::fit_popover,
            tray::set_tray_tooltip,
            proxy::proxy_status,
            proxy::proxy_releases,
            proxy::proxy_install,
            proxy::proxy_activate,
            proxy::proxy_start,
            proxy::proxy_restart,
            proxy::proxy_stop,
            proxy::proxy_management_key
        ])
        .build(tauri::generate_context!())
        .expect("error while building the Quotio desktop app")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                app.state::<Arc<Sidecar>>().stop();
                app.state::<Arc<Proxy>>().shutdown();
            }
        });
}
