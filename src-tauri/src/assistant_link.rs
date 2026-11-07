use std::{
    process::Child,
    sync::{Arc, Mutex},
};

pub(crate) fn stop_child(child: &mut Child) {
    #[cfg(windows)]
    {
        use std::{
            os::windows::process::CommandExt,
            path::PathBuf,
            process::{Command, Stdio},
        };

        // Launchers such as Volta can leave a descendant holding the stdio pipes.
        if let (Ok(None), Some(windows)) = (child.try_wait(), std::env::var_os("SystemRoot")) {
            let pid = child.id().to_string();
            let _ = Command::new(PathBuf::from(windows).join("System32/taskkill.exe"))
                .args(["/PID", &pid, "/T", "/F"])
                .creation_flags(0x08000000) // CREATE_NO_WINDOW
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status();
        }
    }
    let _ = child.kill();
    let _ = child.wait();
}

pub(crate) struct AssistantLink<T>(Arc<Mutex<LinkState<T>>>);

struct LinkState<T> {
    generation: u64,
    session: Option<Arc<T>>,
    ready: bool,
}

impl<T> Default for AssistantLink<T> {
    fn default() -> Self {
        Self(Arc::new(Mutex::new(LinkState {
            generation: 0,
            session: None,
            ready: false,
        })))
    }
}

impl<T> Clone for AssistantLink<T> {
    fn clone(&self) -> Self {
        Self(self.0.clone())
    }
}

impl<T> AssistantLink<T> {
    pub(crate) fn reset(&self) -> Result<(u64, Option<Arc<T>>), String> {
        let mut active = self.0.lock().map_err(|err| err.to_string())?;
        active.generation += 1;
        active.ready = false;
        Ok((active.generation, active.session.take()))
    }

    /// Returns false if disconnect or another connection superseded this attempt.
    pub(crate) fn connect(
        &self,
        generation: u64,
        spawn: impl FnOnce() -> Result<T, String>,
        initialize: impl FnOnce(&T) -> Result<(), String>,
    ) -> Result<bool, String> {
        if self.0.lock().map_err(|err| err.to_string())?.generation != generation {
            return Ok(false);
        }
        let session = Arc::new(spawn()?);
        {
            let mut active = self.0.lock().map_err(|err| err.to_string())?;
            if active.generation != generation {
                return Ok(false);
            }
            active.session = Some(session.clone());
        }

        // Make the child available for cancellation while initialize waits.
        let result = initialize(&session);
        let mut active = self.0.lock().map_err(|err| err.to_string())?;
        if active.generation != generation {
            return Ok(false);
        }
        active.ready = result.is_ok();
        if !active.ready {
            active.session.take();
        }
        result.map(|()| true)
    }

    pub(crate) fn session(&self) -> Result<Option<Arc<T>>, String> {
        let active = self.0.lock().map_err(|err| err.to_string())?;
        Ok(if active.ready {
            active.session.clone()
        } else {
            None
        })
    }
}
