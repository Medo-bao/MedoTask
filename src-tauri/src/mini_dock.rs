use std::{
    sync::{Mutex, MutexGuard},
    time::{Duration, Instant},
};

use tauri::{
    AppHandle, LogicalSize, Manager, PhysicalPosition, PhysicalRect, PhysicalSize, State,
    WebviewWindow, Window,
};
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON, VK_RBUTTON};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    SetWindowPos, SWP_NOACTIVATE, SWP_NOOWNERZORDER, SWP_NOZORDER,
};

use crate::window_layout;

pub(crate) const MIN_SIZE: LogicalSize<f64> = LogicalSize::new(240.0, 160.0);
const SIDE_STRIP_WIDTH: f64 = 6.0;
const TOP_STRIP_HEIGHT: f64 = 6.0;
const SNAP_DISTANCE: f64 = 16.0;
const HOVER_DELAY: Duration = Duration::from_millis(70);
const HIDE_DELAY: Duration = Duration::from_millis(360);
const REVEAL_DELAY: Duration = Duration::from_millis(1000);
const IDLE_CHECK_MS: u64 = 160;
const SPRING_RATE: f64 = 34.0;

#[derive(Clone, Copy, PartialEq, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Edge {
    Left,
    Top,
    Right,
}

impl Edge {
    fn closest(
        area: &PhysicalRect<i32, u32>,
        position: PhysicalPosition<i32>,
        size: PhysicalSize<u32>,
        scale: f64,
        preferred: Option<Self>,
    ) -> Option<Self> {
        let left = area.position.x;
        let right = left + area.size.width as i32;
        [
            (Self::Left, position.x.abs_diff(left)),
            (Self::Top, position.y.abs_diff(area.position.y)),
            (
                Self::Right,
                (position.x + size.width as i32).abs_diff(right),
            ),
        ]
        .into_iter()
        .min_by_key(|(edge, distance)| (*distance, Some(*edge) != preferred))
        .filter(|(_, distance)| f64::from(*distance) <= SNAP_DISTANCE * scale)
        .map(|(edge, _)| edge)
    }
}

#[derive(serde::Serialize)]
pub(crate) struct DockView {
    edge: Option<Edge>,
    openness: f64,
    moving: bool,
    width: f64,
    height: f64,
    check_in_ms: u64,
}

impl Default for DockView {
    fn default() -> Self {
        Self {
            edge: None,
            openness: 1.0,
            moving: false,
            width: 0.0,
            height: 0.0,
            check_in_ms: IDLE_CHECK_MS,
        }
    }
}

struct Docked {
    edge: Edge,
    size: LogicalSize<f64>,
    openness: f64,
    velocity: f64,
    revealing: bool,
    sampled: Instant,
}

impl Docked {
    fn reveal(&mut self, now: Instant) {
        if !self.revealing && self.openness == 0.0 {
            self.sampled = now;
        }
        self.revealing = true;
    }

    fn target(&self) -> f64 {
        if self.revealing {
            1.0
        } else {
            0.0
        }
    }

    fn advance(&mut self, now: Instant, reduced_motion: bool) {
        let elapsed = now.saturating_duration_since(self.sampled).as_secs_f64();
        self.sampled = now;
        let target = self.target();
        if reduced_motion {
            self.openness = target;
            self.velocity = 0.0;
            return;
        }

        // A critically damped spring preserves position and velocity on reversal.
        let offset = self.openness - target;
        let travel = self.velocity + SPRING_RATE * offset;
        let decay = (-SPRING_RATE * elapsed).exp();
        let openness = target + (offset + travel * elapsed) * decay;
        let velocity = (self.velocity - SPRING_RATE * travel * elapsed) * decay;
        if (openness - target).abs() < 0.004 && velocity.abs() < 0.14 {
            self.openness = target;
            self.velocity = 0.0;
        } else {
            self.openness = openness.clamp(0.0, 1.0);
            self.velocity = if openness == self.openness {
                velocity
            } else {
                0.0
            };
        }
    }

    fn view(&self, size: LogicalSize<f64>) -> DockView {
        DockView {
            edge: Some(self.edge),
            openness: self.openness,
            moving: self.openness != self.target() || self.velocity != 0.0,
            width: size.width,
            height: size.height,
            check_in_ms: IDLE_CHECK_MS,
        }
    }

    fn place(
        &self,
        window: &WebviewWindow,
        area: &PhysicalRect<i32, u32>,
        scale: f64,
        position: PhysicalPosition<i32>,
        outer: PhysicalSize<u32>,
    ) -> tauri::Result<DockView> {
        let inner = window.inner_size()?;
        let frame_width = outer.width.saturating_sub(inner.width);
        let frame_height = outer.height.saturating_sub(inner.height);
        let full = self.size.to_physical::<u32>(scale);
        let expanded = PhysicalSize::new(
            full.width
                .min(area.size.width.saturating_sub(frame_width))
                .max(1),
            full.height
                .min(area.size.height.saturating_sub(frame_height))
                .max(1),
        );
        let shrink = |span: u32, collapsed: f64| {
            let span = f64::from(span);
            let collapsed = (collapsed * scale).round().clamp(1.0, span);
            (collapsed + (span - collapsed) * self.openness).round() as u32
        };
        let size = match self.edge {
            Edge::Left | Edge::Right => {
                PhysicalSize::new(shrink(expanded.width, SIDE_STRIP_WIDTH), expanded.height)
            }
            Edge::Top => {
                PhysicalSize::new(expanded.width, shrink(expanded.height, TOP_STRIP_HEIGHT))
            }
        };
        let bounds = PhysicalSize::new(size.width + frame_width, size.height + frame_height);
        let destination = window_layout::fit_position(area, position, bounds, Some(self.edge));
        if position != destination || outer != bounds {
            // Resize and anchor together so the right edge never crosses into another display.
            let updated = unsafe {
                SetWindowPos(
                    window.hwnd()?.0,
                    std::ptr::null_mut(),
                    destination.x,
                    destination.y,
                    bounds.width as i32,
                    bounds.height as i32,
                    SWP_NOACTIVATE | SWP_NOZORDER | SWP_NOOWNERZORDER,
                )
            };
            if updated == 0 {
                return Err(std::io::Error::last_os_error().into());
            }
        }
        Ok(self.view(expanded.to_logical(scale)))
    }
}

#[derive(Default)]
pub(crate) struct MiniDock {
    docked: Option<Docked>,
    hide_after: Option<Instant>,
    hover_after: Option<Instant>,
    edge_hint: Option<Edge>,
    enabled: bool,
}

impl MiniDock {
    pub(crate) fn restored(edge: Option<Edge>) -> Self {
        Self {
            edge_hint: edge,
            hide_after: Some(Instant::now() + REVEAL_DELAY),
            ..Self::default()
        }
    }

    pub(crate) fn is_docked(&self) -> bool {
        self.docked.is_some()
    }

    pub(crate) fn edge_at(&self, window: &Window) -> Option<Edge> {
        if !self.enabled {
            return None;
        }
        let monitor = window.current_monitor().ok()??;
        Edge::closest(
            monitor.work_area(),
            window.outer_position().ok()?,
            window.outer_size().ok()?,
            monitor.scale_factor(),
            self.edge_hint,
        )
    }

    fn reveal(&mut self, now: Instant) {
        if let Some(docked) = &mut self.docked {
            docked.reveal(now);
        }
        self.hover_after = None;
        self.hide_after = Some(now + REVEAL_DELAY);
    }

    fn update(
        &mut self,
        window: &WebviewWindow,
        hold_open: bool,
        reduced_motion: bool,
    ) -> tauri::Result<DockView> {
        if !self.enabled && !self.is_docked() {
            return Ok(DockView::default());
        }
        let monitor = match window.current_monitor()? {
            Some(monitor) => Some(monitor),
            None => window.primary_monitor()?,
        };
        let Some(monitor) = monitor else {
            return Ok(self
                .docked
                .as_ref()
                .map_or_else(DockView::default, |docked| docked.view(docked.size)));
        };
        let area = monitor.work_area();
        let scale = monitor.scale_factor();
        let mut position = window.outer_position()?;
        let outer = window.outer_size()?;
        let pointer = window.cursor_position()?;
        let hovered = |position: PhysicalPosition<i32>| {
            let x = pointer.x - f64::from(position.x);
            let y = pointer.y - f64::from(position.y);
            x >= 0.0 && x < f64::from(outer.width) && y >= 0.0 && y < f64::from(outer.height)
        };
        let now = Instant::now();
        let mut next_check = IDLE_CHECK_MS;
        if let Some(docked) = &mut self.docked {
            if !hovered(position) && !hold_open {
                self.hover_after = None;
            } else if !docked.revealing {
                // A pass over a resting strip should not open it. Re-entering
                // during contraction can reverse immediately.
                let wait = if docked.openness == 0.0 && !hold_open {
                    self.hover_after
                        .get_or_insert(now + HOVER_DELAY)
                        .saturating_duration_since(now)
                } else {
                    Duration::ZERO
                };
                if wait.is_zero() {
                    docked.reveal(now);
                    self.hover_after = None;
                    self.hide_after = None;
                } else {
                    next_check = check_in_ms(wait);
                }
            }
        } else {
            // Wait for the physical mouse buttons before snapping a drag or resize.
            let mouse_down = unsafe {
                GetAsyncKeyState(i32::from(VK_LBUTTON)) < 0
                    || GetAsyncKeyState(i32::from(VK_RBUTTON)) < 0
            };
            if mouse_down {
                self.hide_after = None;
                return Ok(DockView::default());
            }
            let Some(edge) = Edge::closest(area, position, outer, scale, self.edge_hint) else {
                if self.edge_hint.take().is_some() {
                    window_layout::remember(&window.as_ref().window(), None);
                }
                self.hide_after = None;
                return Ok(DockView::default());
            };
            let snapped = window_layout::fit_position(area, position, outer, Some(edge));
            if position != snapped {
                window.set_position(snapped)?;
                position = snapped;
            }
            if self.edge_hint.replace(edge) != Some(edge) {
                window_layout::remember(&window.as_ref().window(), Some(edge));
            }
            if hovered(position) || hold_open {
                self.hide_after = None;
                return Ok(DockView::default());
            }
            let wait = self
                .hide_after
                .get_or_insert(now + HIDE_DELAY)
                .saturating_duration_since(now);
            if !wait.is_zero() {
                return Ok(DockView {
                    check_in_ms: check_in_ms(wait),
                    ..DockView::default()
                });
            }

            let size = window.inner_size()?.to_logical(window.scale_factor()?);
            window_layout::remember(&window.as_ref().window(), Some(edge));
            window.set_min_size(None::<LogicalSize<f64>>)?;
            self.docked = Some(Docked {
                edge,
                size,
                openness: 1.0,
                velocity: 0.0,
                revealing: false,
                sampled: now,
            });
        }
        let docked = self.docked.as_mut().expect("dock frame initialized");
        docked.advance(now, reduced_motion);
        let mut view = docked.place(window, area, scale, position, outer)?;
        view.check_in_ms = next_check;
        if view.openness == 1.0 && !view.moving {
            window.set_min_size(Some(MIN_SIZE))?;
            self.docked = None;
            window_layout::remember(&window.as_ref().window(), self.edge_hint);
            return Ok(DockView::default());
        }
        Ok(view)
    }
}

fn check_in_ms(wait: Duration) -> u64 {
    (wait.as_millis() as u64 + 1).min(IDLE_CHECK_MS)
}

pub(crate) fn state(app: &AppHandle) -> MutexGuard<'_, MiniDock> {
    app.state::<Mutex<MiniDock>>()
        .inner()
        .lock()
        .expect("mini dock lock")
}

pub(crate) fn show(window: &WebviewWindow) {
    let docked = {
        let mut dock = state(window.app_handle());
        dock.reveal(Instant::now());
        dock.is_docked()
    };
    if docked {
        let _ = window.eval("window.dispatchEvent(new Event('medotask:reveal-mini'))");
    } else {
        window_layout::keep_visible(&window.as_ref().window());
    }
}

#[tauri::command]
pub(crate) fn update_mini_dock(
    window: WebviewWindow,
    dock: State<'_, Mutex<MiniDock>>,
    enabled: bool,
    reveal: bool,
    hold_open: bool,
    reduced_motion: bool,
) -> Result<DockView, String> {
    if window.label() != "mini" {
        return Err("edge hiding is only available in the mini window".into());
    }
    let mut dock = dock.lock().map_err(|err| err.to_string())?;
    let disabling = dock.enabled && !enabled;
    dock.enabled = enabled;
    if !enabled {
        dock.edge_hint = None;
    }
    if !enabled || reveal {
        dock.reveal(Instant::now());
    }
    let view = dock
        .update(&window, hold_open, reduced_motion)
        .map_err(|err| err.to_string())?;
    if disabling && !dock.is_docked() {
        window_layout::remember(&window.as_ref().window(), None);
    }
    Ok(view)
}
