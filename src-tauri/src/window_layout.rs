use std::{fs, path::PathBuf, sync::Mutex, time::Duration};

use serde::{Deserialize, Serialize};
use tauri::{
    AppHandle, Manager, PhysicalPosition, PhysicalRect, PhysicalSize, Window, WindowEvent,
};

use crate::mini_dock::{Edge, MiniDock};

#[derive(Clone, Copy, PartialEq, Deserialize, Serialize)]
pub(crate) struct Placement {
    x: i32,
    y: i32,
    width: f64,
    height: f64,
    edge: Option<Edge>,
}

impl Placement {
    fn capture(window: &Window, edge: Option<Edge>) -> tauri::Result<Self> {
        let position = window.outer_position()?;
        let size = window
            .inner_size()?
            .to_logical::<f64>(window.scale_factor()?);
        Ok(Self {
            x: position.x,
            y: position.y,
            width: size.width,
            height: size.height,
            edge,
        })
    }

    pub(crate) fn edge(self) -> Option<Edge> {
        self.edge
    }

    pub(crate) fn apply(self, window: &Window) -> tauri::Result<()> {
        let monitor = window
            .monitor_from_point(self.x.into(), self.y.into())?
            .or(window.primary_monitor()?);
        let Some(monitor) = monitor else {
            return Ok(());
        };
        let area = monitor.work_area();
        let inner = window.inner_size()?;
        let outer = window.outer_size()?;
        let scale = monitor.scale_factor();
        let frame_scale = scale / window.scale_factor()?;
        let frame_width =
            (f64::from(outer.width.saturating_sub(inner.width)) * frame_scale).round() as u32;
        let frame_height =
            (f64::from(outer.height.saturating_sub(inner.height)) * frame_scale).round() as u32;
        let size = PhysicalSize::new(
            ((self.width * scale).round() as u32)
                .min(area.size.width.saturating_sub(frame_width))
                .max(1),
            ((self.height * scale).round() as u32)
                .min(area.size.height.saturating_sub(frame_height))
                .max(1),
        );
        let position = PhysicalPosition::new(self.x, self.y);
        let expected_outer =
            PhysicalSize::new(size.width + frame_width, size.height + frame_height);
        let destination = fit_position(area, position, expected_outer, self.edge);
        if window.outer_position()? != destination {
            window.set_position(destination)?;
        }
        if window.inner_size()? != size {
            window.set_size(size)?;
        }
        let actual = fit_position(area, destination, window.outer_size()?, self.edge);
        if window.outer_position()? != actual {
            window.set_position(actual)?;
        }
        Ok(())
    }
}

#[derive(Default, Deserialize, Serialize)]
struct Layouts {
    main: Option<Placement>,
    mini: Option<Placement>,
    #[serde(skip)]
    dirty: bool,
    #[serde(skip)]
    queued: bool,
}

pub(crate) struct WindowLayout {
    path: PathBuf,
    layouts: Mutex<Layouts>,
}

impl WindowLayout {
    pub(crate) fn load(path: PathBuf) -> Self {
        let layouts = fs::read(&path)
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default();
        Self {
            path,
            layouts: Mutex::new(layouts),
        }
    }

    fn save(&self) {
        let Ok(mut layouts) = self.layouts.lock() else {
            return;
        };
        layouts.queued = false;
        if !layouts.dirty {
            return;
        }
        let result = (|| -> Result<(), Box<dyn std::error::Error>> {
            if let Some(parent) = self.path.parent() {
                fs::create_dir_all(parent)?;
            }
            let temp = self.path.with_extension("tmp");
            fs::write(&temp, serde_json::to_vec(&*layouts)?)?;
            fs::rename(temp, &self.path)?;
            Ok(())
        })();
        match result {
            Ok(()) => layouts.dirty = false,
            Err(err) => eprintln!("[medotask] could not save window layout: {err}"),
        }
    }
}

pub(crate) fn saved(app: &AppHandle, label: &str) -> Option<Placement> {
    let state = app.try_state::<WindowLayout>()?;
    let layouts = state.layouts.lock().ok()?;
    match label {
        "main" => layouts.main,
        "mini" => layouts.mini,
        _ => None,
    }
}

pub(crate) fn fit_position(
    area: &PhysicalRect<i32, u32>,
    position: PhysicalPosition<i32>,
    size: PhysicalSize<u32>,
    edge: Option<Edge>,
) -> PhysicalPosition<i32> {
    let left = area.position.x;
    let top = area.position.y;
    let max_x = left + area.size.width.saturating_sub(size.width) as i32;
    let max_y = top + area.size.height.saturating_sub(size.height) as i32;
    let mut x = position.x.clamp(left, max_x);
    let mut y = position.y.clamp(top, max_y);
    match edge {
        Some(Edge::Left) => x = left,
        Some(Edge::Top) => y = top,
        Some(Edge::Right) => x = max_x,
        None => {}
    }
    PhysicalPosition::new(x, y)
}

pub(crate) fn keep_visible(window: &Window) {
    let result = (|| -> tauri::Result<()> {
        if !window.is_minimized()? && !window.is_maximized()? {
            Placement::capture(window, None)?.apply(window)?;
        }
        Ok(())
    })();
    if let Err(err) = result {
        eprintln!("[medotask] could not fit window on screen: {err}");
    }
}

pub(crate) fn remember(window: &Window, edge: Option<Edge>) {
    if window.is_minimized().unwrap_or(true) || window.is_maximized().unwrap_or(true) {
        return;
    }
    let Ok(placement) = Placement::capture(window, edge) else {
        return;
    };
    let app = window.app_handle();
    let Some(state) = app.try_state::<WindowLayout>() else {
        return;
    };
    let Ok(mut layouts) = state.layouts.lock() else {
        return;
    };
    let slot = match window.label() {
        "main" => &mut layouts.main,
        "mini" => &mut layouts.mini,
        _ => return,
    };
    if *slot == Some(placement) {
        return;
    }
    *slot = Some(placement);
    layouts.dirty = true;
    if layouts.queued {
        return;
    }
    layouts.queued = true;
    drop(layouts);
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        std::thread::sleep(Duration::from_millis(300));
        flush(&app);
    });
}

pub(crate) fn track(window: &Window, event: &WindowEvent) {
    if !matches!(window.label(), "main" | "mini")
        || !matches!(
            event,
            WindowEvent::Moved(_) | WindowEvent::Resized(_) | WindowEvent::CloseRequested { .. }
        )
    {
        return;
    }
    let app = window.app_handle();
    if window.is_visible().unwrap_or(false) {
        if window.label() == "mini" {
            let state = app.state::<Mutex<MiniDock>>();
            if let Ok(dock) = state.try_lock() {
                if !dock.is_docked() {
                    remember(window, dock.edge_at(window));
                }
            };
        } else {
            remember(window, None);
        }
    }
    if matches!(event, WindowEvent::CloseRequested { .. }) {
        flush(app);
    }
}

pub(crate) fn flush(app: &AppHandle) {
    if let Some(state) = app.try_state::<WindowLayout>() {
        state.save();
    }
}
