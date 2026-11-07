use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, Window, WindowEvent,
};
#[cfg(not(windows))]
use tauri_plugin_autostart::ManagerExt;

const TRAY_ID: &str = "medotask";
pub(crate) const STARTUP_ARG: &str = "--medotask-autostart";

pub(crate) fn show_main(app: &AppHandle, capture: bool) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        #[cfg(windows)]
        crate::window_layout::keep_visible(&window.as_ref().window());
        let _ = window.set_focus();
        if capture {
            let _ = window.eval("window.location.hash = '/?capture=1'");
        }
    }
}

pub(crate) fn create_tray(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let icon = app
        .default_window_icon()
        .cloned()
        .ok_or("missing app icon")?;
    let open = MenuItem::with_id(app, "tray-open", "打开 MedoTask", true, None::<&str>)?;
    let capture = MenuItem::with_id(app, "tray-capture", "快速新建待办", true, None::<&str>)?;
    let mini = MenuItem::with_id(app, "tray-mini", "打开浮窗", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "tray-quit", "退出 MedoTask", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &capture, &mini, &separator, &quit])?;
    TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .tooltip("MedoTask")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "tray-open" => show_main(app, false),
            "tray-capture" => show_main(app, true),
            "tray-mini" => {
                let app = app.clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(err) = super::open_window(app, "mini".into(), None).await {
                        eprintln!("[medotask] could not open the mini window: {err}");
                    }
                });
            }
            "tray-quit" => exit(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main(tray.app_handle(), false);
            }
        })
        .build(app)?;
    Ok(())
}

pub(crate) fn close_to_tray(window: &Window, event: &WindowEvent) {
    if window.label() == "main" {
        if let WindowEvent::CloseRequested { api, .. } = event {
            if window.app_handle().tray_by_id(TRAY_ID).is_some() && window.hide().is_ok() {
                api.prevent_close();
            }
        }
    }
}

#[tauri::command]
pub(crate) fn tray_available(app: AppHandle) -> bool {
    app.tray_by_id(TRAY_ID).is_some()
}

#[tauri::command]
pub(crate) fn autostart_enabled(app: AppHandle) -> Result<bool, String> {
    #[cfg(windows)]
    return crate::windows_startup::is_enabled(&app.package_info().name);
    #[cfg(not(windows))]
    app.autolaunch().is_enabled().map_err(|err| err.to_string())
}

#[tauri::command]
pub(crate) fn set_autostart(app: AppHandle, enabled: bool) -> Result<bool, String> {
    #[cfg(windows)]
    return crate::windows_startup::set_enabled(&app.package_info().name, enabled);
    #[cfg(not(windows))]
    {
        let autostart = app.autolaunch();
        if enabled {
            autostart.enable()
        } else {
            autostart.disable()
        }
        .map_err(|err| err.to_string())?;
        autostart_enabled(app)
    }
}

#[cfg(windows)]
#[tauri::command]
pub(crate) fn save_reminder_sound(
    app: AppHandle,
    request: tauri::ipc::Request<'_>,
) -> Result<(), String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("请选择 WAV 文件".into());
    };
    if bytes.len() > 8 * 1024 * 1024 || !is_wave(bytes) {
        return Err("请选择 8 MB 以内的有效 WAV 文件".into());
    }
    let profile = super::webview_profile(&app).map_err(|err| err.to_string())?;
    let temp = profile.join("reminder.tmp");
    std::fs::create_dir_all(&profile)
        .and_then(|_| std::fs::write(&temp, bytes))
        .and_then(|_| std::fs::rename(temp, profile.join("reminder.wav")))
        .map_err(|err| err.to_string())
}

#[cfg(windows)]
fn is_wave(bytes: &[u8]) -> bool {
    if !bytes.starts_with(b"RIFF") || bytes.get(8..12) != Some(b"WAVE") {
        return false;
    }
    let mut cursor = 12;
    let mut has_format = false;
    let mut has_audio = false;
    while let Some(header) = bytes.get(cursor..cursor + 8) {
        let size = u32::from_le_bytes([header[4], header[5], header[6], header[7]]) as usize;
        if size > bytes.len() - cursor - 8 {
            return false;
        }
        has_format |= &header[..4] == b"fmt " && size >= 16;
        has_audio |= &header[..4] == b"data" && size > 0;
        cursor += 8 + size + size % 2;
    }
    has_format && has_audio
}

#[cfg(windows)]
fn play_reminder_file(app: &AppHandle, sound: &str) -> bool {
    use std::{os::windows::ffi::OsStrExt, path::PathBuf, ptr::null_mut};
    use windows_sys::Win32::Media::Audio::{PlaySoundW, SND_ASYNC, SND_FILENAME, SND_NODEFAULT};
    let path = if sound == "Custom" {
        super::webview_profile(app)
            .ok()
            .map(|folder| folder.join("reminder.wav"))
    } else {
        let file = match sound {
            "IM" | "SMS" => "Windows Notify Messaging.wav",
            "Mail" => "Windows Notify Email.wav",
            "Reminder" => "Windows Notify Calendar.wav",
            "Alarm" => "Alarm01.wav",
            "Call" => "Ring01.wav",
            _ => "Windows Notify System Generic.wav",
        };
        std::env::var_os("WINDIR").map(|dir| PathBuf::from(dir).join("Media").join(file))
    };
    path.is_some_and(|path| {
        let path = path
            .as_os_str()
            .encode_wide()
            .chain([0])
            .collect::<Vec<_>>();
        unsafe {
            PlaySoundW(
                path.as_ptr(),
                null_mut(),
                SND_ASYNC | SND_FILENAME | SND_NODEFAULT,
            ) != 0
        }
    })
}

#[cfg(windows)]
#[tauri::command]
pub(crate) fn preview_reminder_sound(app: AppHandle, sound: String) -> Result<(), String> {
    if play_reminder_file(&app, &sound) {
        Ok(())
    } else {
        Err("Windows 无法播放这个提醒声音".into())
    }
}

#[cfg(windows)]
#[tauri::command]
pub(crate) async fn show_countdown_reminder(
    window: tauri::WebviewWindow,
    message: String,
    sound: String,
) -> Result<(), String> {
    use std::{ffi::OsStr, os::windows::ffi::OsStrExt, ptr::null_mut};
    use windows_sys::Win32::{
        Media::Audio::{PlaySoundW, SND_ALIAS, SND_ASYNC},
        UI::WindowsAndMessaging::{MessageBoxW, MB_OK, MB_SETFOREGROUND, MB_TOPMOST},
    };

    if window.label() != "main" {
        return Err("reminders belong to the main window".into());
    }
    let background = !window.is_visible().unwrap_or(false)
        || window.is_minimized().unwrap_or(false)
        || !window.is_focused().unwrap_or(false);
    let wide = |value: &OsStr| value.encode_wide().chain([0]).collect::<Vec<u16>>();
    if !play_reminder_file(window.app_handle(), &sound) {
        let fallback = wide(OsStr::new("SystemAsterisk"));
        unsafe { PlaySoundW(fallback.as_ptr(), null_mut(), SND_ASYNC | SND_ALIAS) };
    }
    if background {
        tauri::async_runtime::spawn_blocking(move || {
            let title = wide(OsStr::new("MedoTask 提醒"));
            let message = wide(OsStr::new(&message));
            unsafe {
                MessageBoxW(
                    null_mut(),
                    message.as_ptr(),
                    title.as_ptr(),
                    MB_OK | MB_SETFOREGROUND | MB_TOPMOST,
                );
            }
        });
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn quit_desktop(app: AppHandle) {
    exit(&app);
}

fn exit(app: &AppHandle) {
    #[cfg(windows)]
    crate::window_layout::flush(app);
    #[cfg(feature = "assistant")]
    crate::codex_link::disconnect(app);
    app.exit(0);
}
