//! The tray icon and its quota popover, the Windows and Linux stand-in for the macOS menu bar.
//!
//! Windows delivers tray clicks, so a left click toggles the popover next to the icon.
//! Linux AppIndicator only shows a menu (GNOME never reports clicks), so the menu carries
//! "Show quota", which opens the popover at the top centre of the screen.
use std::{
    sync::Mutex,
    time::{Duration, Instant},
};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, Rect, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder, WindowEvent,
};

const TRAY_ID: &str = "quotio";
pub const MAIN: &str = "main";
pub const POPOVER: &str = "popover";
const POPOVER_WIDTH: f64 = 360.0;
const POPOVER_MIN_HEIGHT: f64 = 160.0;
/// Space between the popover and the tray icon or the screen edge, in logical pixels.
const MARGIN: f64 = 8.0;
// Clicking the tray icon while the popover is open blurs it first; without this window the
// same click would hide the popover and then show it again.
const BLUR_DEBOUNCE: Duration = Duration::from_millis(250);

#[derive(Clone, Copy)]
enum Anchor {
    /// The tray icon's bounds in physical pixels.
    Tray {
        position: PhysicalPosition<f64>,
        width: f64,
        height: f64,
    },
    TopCenter,
}

struct PopoverState {
    anchor: Mutex<Anchor>,
    hidden_at: Mutex<Option<Instant>>,
}

pub fn setup(app: &AppHandle) -> tauri::Result<()> {
    app.manage(PopoverState {
        anchor: Mutex::new(Anchor::TopCenter),
        hidden_at: Mutex::new(None),
    });

    let popover = WebviewWindowBuilder::new(app, POPOVER, WebviewUrl::App("index.html".into()))
        .title("Quotio")
        .inner_size(POPOVER_WIDTH, 520.0)
        .resizable(false)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible(false)
        .focused(false)
        .build()?;
    let handle = app.clone();
    popover.on_window_event(move |event| {
        if let WindowEvent::Focused(false) = event {
            hide_popover(&handle);
        }
    });

    let show = MenuItem::with_id(app, "show", "Show quota", true, None::<&str>)?;
    let open = MenuItem::with_id(app, "open", "Open Quotio", true, None::<&str>)?;
    let refresh = MenuItem::with_id(app, "refresh", "Refresh now", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Quotio", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&show, &open, &refresh, &separator, &quit])?;

    let mut tray = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip("Quotio")
        .menu(&menu)
        .show_menu_on_left_click(cfg!(target_os = "linux"))
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_popover(app, Anchor::TopCenter),
            "open" => show_main(app),
            "refresh" => {
                if let Err(error) = app.emit_to(MAIN, "tray-refresh", ()) {
                    eprintln!("tray refresh could not reach the main window: {error}");
                }
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                rect,
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                toggle_popover(tray.app_handle(), tray_anchor(rect));
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

/// Closing the main window keeps Quotio running in the tray; only Quit exits.
pub fn on_main_window_event(window: &tauri::Window, event: &WindowEvent) {
    if let WindowEvent::CloseRequested { api, .. } = event {
        if window.label() == MAIN {
            api.prevent_close();
            if let Err(error) = window.hide() {
                eprintln!("main window could not hide: {error}");
            }
        }
    }
}

fn tray_anchor(rect: Rect) -> Anchor {
    // Tray rects arrive in physical pixels on every platform that reports clicks.
    let position = rect.position.to_physical::<f64>(1.0);
    let size = rect.size.to_physical::<f64>(1.0);
    Anchor::Tray {
        position,
        width: size.width,
        height: size.height,
    }
}

fn toggle_popover(app: &AppHandle, anchor: Anchor) {
    let Some(window) = app.get_webview_window(POPOVER) else {
        return;
    };
    let recently_hidden = app
        .state::<PopoverState>()
        .hidden_at
        .lock()
        .unwrap()
        .is_some_and(|at| at.elapsed() < BLUR_DEBOUNCE);
    if window.is_visible().unwrap_or(false) || recently_hidden {
        hide_popover(app);
    } else {
        show_popover(app, anchor);
    }
}

fn show_popover(app: &AppHandle, anchor: Anchor) {
    let Some(window) = app.get_webview_window(POPOVER) else {
        return;
    };
    *app.state::<PopoverState>().anchor.lock().unwrap() = anchor;
    let result = place(&window, anchor)
        .and_then(|()| window.show())
        .and_then(|()| window.set_focus());
    if let Err(error) = result {
        eprintln!("popover could not open: {error}");
    }
    // The popover re-reads quota whenever it opens rather than waiting for its next poll.
    let _ = window.emit_to(POPOVER, "popover-shown", ());
}

fn hide_popover(app: &AppHandle) {
    let Some(window) = app.get_webview_window(POPOVER) else {
        return;
    };
    if window.is_visible().unwrap_or(false) {
        *app.state::<PopoverState>().hidden_at.lock().unwrap() = Some(Instant::now());
        let _ = window.hide();
    }
}

pub fn show_main(app: &AppHandle) {
    hide_popover(app);
    let Some(window) = app.get_webview_window(MAIN) else {
        return;
    };
    let result = window
        .unminimize()
        .and_then(|()| window.show())
        .and_then(|()| window.set_focus());
    if let Err(error) = result {
        eprintln!("main window could not open: {error}");
    }
}

/// Moves the popover next to its anchor, kept inside the work area of the anchor's monitor.
fn place(window: &WebviewWindow, anchor: Anchor) -> tauri::Result<()> {
    let monitor = match anchor {
        Anchor::Tray { position, .. } => window.monitor_from_point(position.x, position.y)?,
        Anchor::TopCenter => None,
    };
    let Some(monitor) = monitor.or(window.primary_monitor()?) else {
        return Ok(());
    };
    let work = monitor.work_area();
    let (left, top) = (work.position.x as f64, work.position.y as f64);
    let (right, bottom) = (left + work.size.width as f64, top + work.size.height as f64);
    let size = window.outer_size()?;
    let (width, height) = (size.width as f64, size.height as f64);
    let margin = MARGIN * monitor.scale_factor();

    let (x, y) = match anchor {
        Anchor::Tray {
            position,
            width: icon_width,
            height: icon_height,
        } => {
            let x = position.x + icon_width / 2.0 - width / 2.0;
            // Open away from the taskbar: above an icon in the lower half, below one in the upper half.
            let y = if position.y > (top + bottom) / 2.0 {
                position.y - height - margin
            } else {
                position.y + icon_height + margin
            };
            (x, y)
        }
        Anchor::TopCenter => ((left + right - width) / 2.0, top + margin),
    };
    let x = x.clamp(left + margin, (right - width - margin).max(left));
    let y = y.clamp(top + margin, (bottom - height - margin).max(top));
    window.set_position(PhysicalPosition::new(x, y))
}

#[tauri::command]
pub fn open_main(app: AppHandle) {
    show_main(&app);
}

#[tauri::command]
pub fn close_popover(app: AppHandle) {
    hide_popover(&app);
}

#[tauri::command]
pub fn quit(app: AppHandle) {
    app.exit(0);
}

/// Sizes the popover to its content, capped to the screen, and keeps it attached to its anchor.
#[tauri::command]
pub fn fit_popover(app: AppHandle, height: f64) -> Result<(), String> {
    let Some(window) = app.get_webview_window(POPOVER) else {
        return Ok(());
    };
    let monitor = window
        .current_monitor()
        .map_err(|error| error.to_string())?
        .or(window.primary_monitor().map_err(|error| error.to_string())?);
    let max = monitor.map_or(720.0, |monitor| {
        monitor.work_area().size.height as f64 / monitor.scale_factor() - 4.0 * MARGIN
    });
    window
        .set_size(LogicalSize::new(
            POPOVER_WIDTH,
            height.clamp(POPOVER_MIN_HEIGHT, max.max(POPOVER_MIN_HEIGHT)),
        ))
        .map_err(|error| error.to_string())?;
    let anchor = *app.state::<PopoverState>().anchor.lock().unwrap();
    place(&window, anchor).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn set_tray_tooltip(app: AppHandle, text: String) -> Result<(), String> {
    match app.tray_by_id(TRAY_ID) {
        Some(tray) => tray.set_tooltip(Some(text)).map_err(|error| error.to_string()),
        None => Ok(()),
    }
}
