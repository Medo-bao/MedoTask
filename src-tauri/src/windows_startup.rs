use crate::desktop::STARTUP_ARG;
use auto_launch::{AutoLaunch, WindowsEnableMode};
use std::io;
use windows_registry::{Key, CURRENT_USER, LOCAL_MACHINE};

const RUN_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
const ENTRY_NOT_FOUND: i32 = 0x80070002_u32 as i32; // HRESULT_FROM_WIN32(ERROR_FILE_NOT_FOUND)

fn read_entry(root: &Key, key: &str, name: &str) -> io::Result<Option<String>> {
    match root.open(key).and_then(|key| key.get_string(name)) {
        Ok(value) => Ok(Some(value)),
        Err(err) if err.code().0 == ENTRY_NOT_FOUND => Ok(None),
        Err(err) => Err(err.into()),
    }
}

fn sync_entry(
    root: &Key,
    key: &str,
    name: &str,
    command: &str,
    repair: bool,
) -> io::Result<Option<bool>> {
    let Some(current) = read_entry(root, key, name)? else {
        return Ok(None);
    };
    if current != command {
        if !repair {
            return Ok(Some(false));
        }
        root.options()
            .write()
            .open(key)?
            .set_string(name, command)?;
    }
    Ok(Some(true))
}

fn launcher(name: &str) -> Result<AutoLaunch, String> {
    let mode = if read_entry(LOCAL_MACHINE, RUN_KEY, name)
        .map_err(|err| err.to_string())?
        .is_some()
    {
        WindowsEnableMode::System
    } else {
        WindowsEnableMode::CurrentUser
    };
    let exe = std::env::current_exe().map_err(|err| err.to_string())?;
    let path = format!("\"{}\"", exe.display());
    Ok(AutoLaunch::new(name, &path, mode, &[STARTUP_ARG]))
}

fn sync_entries(launcher: &AutoLaunch, repair: bool) -> Result<bool, String> {
    let name = launcher.get_app_name();
    let command = format!("{} {STARTUP_ARG}", launcher.get_app_path());
    let mut registered = false;
    for root in [LOCAL_MACHINE, CURRENT_USER] {
        match sync_entry(root, RUN_KEY, name, &command, repair).map_err(|err| err.to_string())? {
            Some(true) => registered = true,
            Some(false) => return Ok(false),
            None => {}
        }
    }
    Ok(registered)
}

fn status(launcher: &AutoLaunch, repair: bool) -> Result<bool, String> {
    if !launcher.is_enabled().map_err(|err| err.to_string())? {
        return Ok(false);
    }
    sync_entries(launcher, repair)
}

pub(crate) fn refresh(name: &str) -> Result<(), String> {
    // Preserve Windows' enabled/disabled state while repointing existing Run entries.
    status(&launcher(name)?, true).map(|_| ())
}

pub(crate) fn is_enabled(name: &str) -> Result<bool, String> {
    status(&launcher(name)?, false)
}

pub(crate) fn set_enabled(name: &str, enabled: bool) -> Result<bool, String> {
    let launcher = launcher(name)?;
    if enabled {
        sync_entries(&launcher, true)?;
        launcher.enable()
    } else {
        launcher.disable()
    }
    .map_err(|err| err.to_string())?;
    status(&launcher, false)
}
