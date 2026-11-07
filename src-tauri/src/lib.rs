//! MedoTask — desktop shell.
//!
//! The UI is the same Vue application that runs in the browser; this shell
//! only supplies native windows. Each "window" (main, overview, trash,
//! settings, mini, assistant) is a real OS window created from the frontend
//! through the `open_window` command.

use std::path::PathBuf;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

#[cfg(all(desktop, feature = "assistant"))]
mod codex_link;
#[cfg(desktop)]
mod desktop;
#[cfg(windows)]
mod mini_dock;
#[cfg(windows)]
mod window_layout;
#[cfg(windows)]
mod windows_startup;

fn webview_profile(app: &tauri::AppHandle) -> tauri::Result<PathBuf> {
    if let Some(path) =
        std::env::var_os("WEBVIEW2_USER_DATA_FOLDER").filter(|path| !path.is_empty())
    {
        return Ok(std::env::current_dir()?.join(path));
    }

    // Tauri resolved the original main window's relative directory under LocalAppData.
    let legacy = app
        .path()
        .local_data_dir()?
        .join("main")
        .join("medotask-webview");
    if legacy.is_dir() {
        return Ok(legacy);
    }
    Ok(app.path().app_local_data_dir()?.join("webview"))
}

/// Window presets, mirroring the browser build's route table.
fn preset(label: &str) -> Option<(String, f64, f64, bool, bool)> {
    // (title, width, height, decorations, always_on_top)
    Some(match label {
        "main" => ("MedoTask".into(), 900.0, 700.0, false, false),
        "overview" => ("MedoTask 总览".into(), 1000.0, 800.0, false, false),
        "trash" => ("MedoTask 垃圾箱".into(), 420.0, 620.0, false, false),
        "setting" => ("MedoTask 设置".into(), 420.0, 540.0, false, true),
        "mini" => ("MedoTask 浮窗".into(), 300.0, 200.0, false, true),
        #[cfg(feature = "assistant")]
        "ai" => ("MedoTask 助手".into(), 460.0, 640.0, false, false),
        _ => return None,
    })
}

/// Open (or focus) a MedoTask window by label.
#[tauri::command]
async fn open_window(
    app: tauri::AppHandle,
    label: String,
    date: Option<u32>,
) -> Result<(), String> {
    let main_date = date.filter(|_| label == "main");
    if let Some(win) = app.get_webview_window(&label) {
        if let Some(date) = main_date {
            win.eval(format!("window.location.hash = '/?date={date}'"))
                .map_err(|err| err.to_string())?;
        }
        let _ = win.show();
        let _ = win.unminimize();
        #[cfg(windows)]
        match label.as_str() {
            "main" => window_layout::keep_visible(&win.as_ref().window()),
            "mini" => mini_dock::show(&win),
            _ => {}
        }
        let _ = win.set_focus();
        return Ok(());
    }

    let (title, width, height, decorations, always_on_top) =
        preset(&label).ok_or_else(|| format!("unknown window: {label}"))?;
    #[cfg(windows)]
    let placement = window_layout::saved(&app, &label);

    let profile = webview_profile(&app).map_err(|err| err.to_string())?;
    let page = if let Some(date) = main_date {
        format!("?date={date}")
    } else if label == "main" {
        String::new()
    } else {
        label.clone()
    };
    let mut builder =
        WebviewWindowBuilder::new(&app, &label, WebviewUrl::App(format!("#/{page}").into()))
            .data_directory(profile)
            .title(title)
            .inner_size(width, height)
            .min_inner_size(240.0, 160.0)
            .decorations(decorations)
            .resizable(true)
            .always_on_top(always_on_top)
            .skip_taskbar(label == "mini")
            .focused(true);

    if label == "mini" {
        #[cfg(windows)]
        {
            builder = builder
                .min_inner_size(mini_dock::MIN_SIZE.width, mini_dock::MIN_SIZE.height)
                .transparent(true)
                .shadow(false)
                .visible(false)
                .focused(false);
            *mini_dock::state(&app) =
                mini_dock::MiniDock::restored(placement.and_then(|state| state.edge()));
        }
    }
    if label == "main" {
        builder = builder.disable_drag_drop_handler();
    }

    let _window = builder.build().map_err(|e| e.to_string())?;
    #[cfg(windows)]
    if label == "mini" {
        if let Some(placement) = placement {
            if let Err(err) = placement.apply(&_window.as_ref().window()) {
                eprintln!("[medotask] could not restore mini window: {err}");
            }
        }
        let _ = _window.show();
        let _ = _window.set_focus();
    }
    Ok(())
}

/// Close a MedoTask window.
#[tauri::command]
async fn close_window(app: tauri::AppHandle, label: String) -> Result<(), String> {
    if let Some(win) = app.get_webview_window(&label) {
        win.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn minimize_window(window: tauri::Window) -> Result<(), String> {
    window.minimize().map_err(|err| err.to_string())
}

/// Show a window without stealing focus when it is already visible.
#[tauri::command]
async fn show_window(app: tauri::AppHandle, label: String) -> Result<(), String> {
    if let Some(win) = app.get_webview_window(&label) {
        let _ = win.show();
        let _ = win.unminimize();
        #[cfg(windows)]
        match label.as_str() {
            "main" => window_layout::keep_visible(&win.as_ref().window()),
            "mini" => mini_dock::show(&win),
            _ => {}
        }
    }
    Ok(())
}

/// Report which MedoTask windows are currently open.
#[tauri::command]
fn list_windows(app: tauri::AppHandle) -> Vec<String> {
    app.webview_windows().keys().cloned().collect()
}

/// Read or set the calling window's native always-on-top state.
#[tauri::command]
async fn window_always_on_top(window: tauri::Window, value: Option<bool>) -> Result<bool, String> {
    if let Some(value) = value {
        window.set_always_on_top(value).map_err(|e| e.to_string())?;
    }
    window.is_always_on_top().map_err(|e| e.to_string())
}

/// Start dragging the current window (custom title bar support).
#[tauri::command]
async fn start_dragging(window: tauri::Window) -> Result<(), String> {
    window.start_dragging().map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_single_instance::init(|app, args, _| {
            if !args.iter().any(|arg| arg == desktop::STARTUP_ARG) {
                desktop::show_main(app, false);
            }
        }))
        .on_window_event(|window, event| {
            #[cfg(windows)]
            window_layout::track(window, event);
            desktop::close_to_tray(window, event);
            #[cfg(feature = "assistant")]
            if window.label() == "ai" && matches!(event, tauri::WindowEvent::Destroyed) {
                let app = window.app_handle().clone();
                tauri::async_runtime::spawn_blocking(move || codex_link::disconnect(&app));
            }
        });
    #[cfg(all(desktop, not(windows)))]
    let builder = builder.plugin(
        tauri_plugin_autostart::Builder::new()
            .arg(desktop::STARTUP_ARG)
            .build(),
    );
    #[cfg(windows)]
    let builder = builder.manage(std::sync::Mutex::new(mini_dock::MiniDock::default()));
    #[cfg(all(desktop, feature = "assistant"))]
    let builder = builder.manage(codex_link::CodexLink::default());

    builder
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let profile = webview_profile(app.handle())?;
            #[cfg(windows)]
            app.manage(window_layout::WindowLayout::load(
                profile.join("window-layout.json"),
            ));
            let main = &app.config().app.windows[0];
            let main = WebviewWindowBuilder::from_config(app, main)?.data_directory(profile);
            #[cfg(desktop)]
            let start_in_tray = std::env::args_os().any(|arg| arg == desktop::STARTUP_ARG);
            #[cfg(all(desktop, not(windows)))]
            let main = main.visible(!start_in_tray).focused(!start_in_tray);
            #[cfg(windows)]
            {
                let saved = window_layout::saved(app.handle(), "main");
                let window = main.visible(false).focused(false).build()?;
                if let Some(placement) = saved {
                    if let Err(err) = placement.apply(&window.as_ref().window()) {
                        eprintln!("[medotask] could not restore main window: {err}");
                    }
                }
                if !start_in_tray {
                    window.show()?;
                    let _ = window.set_focus();
                }
                if let Err(err) = windows_startup::refresh(&app.package_info().name) {
                    eprintln!("[medotask] could not refresh the startup path: {err}");
                }
            }
            #[cfg(not(windows))]
            main.build()?;
            #[cfg(desktop)]
            if let Err(err) = desktop::create_tray(app.handle()) {
                eprintln!("[medotask] system tray unavailable: {err}");
                if start_in_tray {
                    desktop::show_main(app.handle(), false);
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            open_window,
            close_window,
            minimize_window,
            show_window,
            list_windows,
            window_always_on_top,
            start_dragging,
            #[cfg(desktop)]
            desktop::tray_available,
            #[cfg(desktop)]
            desktop::autostart_enabled,
            #[cfg(desktop)]
            desktop::set_autostart,
            #[cfg(windows)]
            desktop::show_countdown_reminder,
            #[cfg(windows)]
            desktop::save_reminder_sound,
            #[cfg(windows)]
            desktop::preview_reminder_sound,
            #[cfg(windows)]
            mini_dock::update_mini_dock,
            #[cfg(all(desktop, feature = "assistant"))]
            codex_link::codex_connect,
            #[cfg(all(desktop, feature = "assistant"))]
            codex_link::codex_chat,
            #[cfg(all(desktop, feature = "assistant"))]
            codex_link::codex_disconnect,
            #[cfg(desktop)]
            desktop::quit_desktop
        ])
        .run(tauri::generate_context!())
        .expect("error while running MedoTask");
}
