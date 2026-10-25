//! A small, persistent top-edge entry. All window geometry is physical desktop space.
use crate::{
    desktop_geometry::DesktopRect,
    library::{now_ms, Result, ShelfAnchor},
    lock, native, publish, report, reveal_shelf, AppState,
};
use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
    time::{Duration, Instant},
};
use tauri::{
    AppHandle, Emitter, Manager, Monitor, PhysicalPosition, PhysicalSize, WebviewUrl,
    WebviewWindow, WebviewWindowBuilder,
};

const WIDTH: f64 = 168.0;
const HEIGHT: f64 = 42.0;
const GAP: f64 = 12.0;
const SHELF_HEIGHT: f64 = 250.0;
fn trace_enabled() -> bool {
    static ENABLED: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    *ENABLED
        .get_or_init(|| std::env::var_os("SNAPLINE_TRACE_ISLAND").is_some_and(|value| value == "1"))
}
fn trace(message: std::fmt::Arguments<'_>) {
    if trace_enabled() {
        eprintln!("[island {}] {message}", now_ms());
    }
}
#[derive(Clone, Copy)]
struct Drag {
    start: (i32, i32),
    fraction: f64,
    moved: bool,
}
impl Drag {
    fn from_local(bounds: DesktopRect, grab_x: f64, grab_y: f64) -> Result<Self> {
        if !grab_x.is_finite() || !grab_y.is_finite() {
            return Err("拖动起点无效。".into());
        }
        // Preserve the same rounded physical grab pixel in both the threshold
        // origin and movement equation (125% DPI can otherwise add one pixel).
        let grab_pixel = (f64::from(bounds.width) * grab_x.clamp(0.0, 1.0)).round();
        let fraction = grab_pixel / f64::from(bounds.width.max(1));
        let coordinate = |origin: i32, size: u32, ratio: f64| {
            (i64::from(origin) + (f64::from(size) * ratio.clamp(0.0, 1.0)).round() as i64)
                .clamp(i64::from(i32::MIN), i64::from(i32::MAX)) as i32
        };
        Ok(Self {
            start: (
                coordinate(bounds.x, bounds.width, fraction),
                coordinate(bounds.y, bounds.height, grab_y),
            ),
            fraction,
            moved: false,
        })
    }
    fn observe(&mut self, cursor: (i32, i32)) {
        self.moved |= (i64::from(cursor.0) - i64::from(self.start.0)).abs() >= 4
            || (i64::from(cursor.1) - i64::from(self.start.1)).abs() >= 4;
    }
}
#[derive(Default)]
struct Runtime {
    drag: Option<Drag>,
    last_drag_moved: bool,
    last_drag_error: Option<String>,
    hover: Option<Instant>,
    hover_range: (f64, f64),
    outside: Option<Instant>,
    placement: Option<(String, DesktopRect)>,
    suppress_hover_until: u64,
    require_hover_exit: bool,
}
impl Runtime {
    fn set_hover_range(&mut self, start: f64, end: f64) -> Result<()> {
        if !start.is_finite() || !end.is_finite() || start < 0.0 || end > 1.0 || start >= end {
            // A failed layout handshake must not retain an old hot area which
            // may now belong to the grip. Never fall back to the whole capsule.
            self.hover_range = (0.0, 0.0);
            self.hover = None;
            return Err("入口按钮边界无效。".into());
        }
        if self.hover_range != (start, end) {
            self.hover = None;
            self.hover_range = (start, end);
        }
        Ok(())
    }
    fn suppress_after_move(&mut self) {
        self.hover = None;
        self.require_hover_exit = true;
    }
    fn complete_drag_hover(&mut self, moved: bool, milliseconds: u64) {
        self.last_drag_moved = moved;
        self.hover = None;
        if moved {
            self.suppress_hover_until = milliseconds.saturating_add(900);
            self.suppress_after_move();
        }
    }
    fn observe_hover_exit(&mut self, rect: DesktopRect, cursor: (i32, i32)) {
        if !rect.contains(cursor) {
            self.require_hover_exit = false;
        }
    }
    fn poll_hover(
        &mut self,
        rect: DesktopRect,
        cursor: (i32, i32),
        button_down: bool,
        now: Instant,
        milliseconds: u64,
    ) -> bool {
        if self.require_hover_exit
            || button_down
            || milliseconds < self.suppress_hover_until
            || !hover_contains(rect, self.hover_range, cursor)
        {
            self.hover = None;
            return false;
        }
        let started = *self.hover.get_or_insert(now);
        if now.saturating_duration_since(started) < Duration::from_millis(350) {
            return false;
        }
        self.hover = None;
        true
    }
}
#[derive(Default)]
struct AnchorState {
    runtime: Mutex<Runtime>,
    ready: AtomicBool,
    tick_pending: AtomicBool,
    gallery_creating: AtomicBool,
    gallery: Mutex<GalleryLifecycle>,
    shelf: Mutex<ShelfLifecycle>,
    shelf_cursor_layered: Mutex<Option<bool>>,
}

#[derive(Clone, Copy, Default, Debug, PartialEq, Eq)]
enum ShelfPhase {
    #[default]
    Hidden,
    Waiting,
    Preparing,
    Opening,
    Open,
    Closing,
}
#[derive(Clone, Copy, Default, serde::Serialize)]
struct IslandOrigin {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}
#[derive(Clone, serde::Serialize)]
struct ShelfTransition {
    phase: &'static str,
    token: u64,
    origin: IslandOrigin,
}
#[derive(Default)]
struct ShelfLifecycle {
    phase: ShelfPhase,
    token: u64,
    origin: IslandOrigin,
    frontend_ready: bool,
    deadline: Option<Instant>,
    painted: bool,
    anchor_pending: bool,
}
impl ShelfLifecycle {
    fn change(&mut self, phase: ShelfPhase, timeout: Option<Duration>) {
        trace(format_args!(
            "change {:?}-> {:?} token={}->{}",
            self.phase,
            phase,
            self.token,
            self.token.wrapping_add(1)
        ));
        self.token = self.token.wrapping_add(1);
        self.phase = phase;
        self.deadline = timeout.map(|duration| Instant::now() + duration);
        match phase {
            ShelfPhase::Hidden => {
                self.painted = false;
                self.anchor_pending = false;
            }
            ShelfPhase::Waiting | ShelfPhase::Preparing => {
                self.painted = false;
                self.anchor_pending = true;
            }
            ShelfPhase::Opening => {
                self.painted = false;
            }
            ShelfPhase::Open | ShelfPhase::Closing => {}
        }
    }
    fn message(&self, phase: &'static str) -> ShelfTransition {
        ShelfTransition {
            phase,
            token: self.token,
            origin: self.origin,
        }
    }
    fn matches(&self, token: u64, phase: ShelfPhase) -> bool {
        self.token == token && self.phase == phase
    }
    fn mark_painted(&mut self, token: u64) -> bool {
        if !self.matches(token, ShelfPhase::Opening) {
            return false;
        }
        self.painted = true;
        self.anchor_pending = false;
        true
    }
    fn can_finish_open(&self, token: u64) -> bool {
        self.matches(token, ShelfPhase::Opening) && self.painted
    }
}

#[derive(Default)]
struct GalleryLifecycle {
    session: Option<String>,
    prepared: bool,
    frontend_ready: bool,
}
impl GalleryLifecycle {
    fn matches(&self, session: &str) -> bool {
        self.session.as_deref() == Some(session)
    }
    fn can_show(&self, capture_active: bool) -> bool {
        self.session.is_some() && self.prepared && self.frontend_ready && !capture_active
    }
}
fn clear_gallery(app: &AppHandle, session: &str) {
    if let Ok(mut state) = app.state::<AnchorState>().gallery.lock() {
        if state.matches(session) {
            *state = GalleryLifecycle::default();
        }
    }
}

fn valid_scale(scale: f64) -> f64 {
    if scale.is_finite() && scale > 0.0 {
        scale
    } else {
        1.0
    }
}
fn inset(available: u32, size: u32, scale: f64) -> u32 {
    ((GAP * valid_scale(scale)).round() as u32).min(available.saturating_sub(size) / 2)
}
fn geometry(area: DesktopRect, scale: f64, ratio: f64) -> DesktopRect {
    let scale = valid_scale(scale);
    let width = ((WIDTH * scale).round() as u32).clamp(1, area.width.max(1));
    let height = ((HEIGHT * scale).round() as u32).clamp(1, area.height.max(1));
    let ratio = if ratio.is_finite() {
        ratio.clamp(0.0, 1.0)
    } else {
        0.5
    };
    let margin = inset(area.width, width, scale);
    let travel = area.width.saturating_sub(width + margin * 2);
    DesktopRect {
        x: (i64::from(area.x) + i64::from(margin) + (f64::from(travel) * ratio).round() as i64)
            .clamp(i64::from(i32::MIN), i64::from(i32::MAX)) as i32,
        y: (i64::from(area.y) + i64::from(inset(area.height, height, scale)))
            .clamp(i64::from(i32::MIN), i64::from(i32::MAX)) as i32,
        width,
        height,
    }
}
fn cursor_ratio(area: DesktopRect, scale: f64, width: u32, x: i32, fraction: f64) -> f64 {
    let margin = inset(area.width, width, scale);
    let travel = area.width.saturating_sub(width + margin * 2);
    if travel == 0 {
        return 0.5;
    }
    ((f64::from(x) - f64::from(area.x) - f64::from(margin) - f64::from(width) * fraction)
        / f64::from(travel))
    .clamp(0.0, 1.0)
}
fn expanded_geometry(
    area: DesktopRect,
    scale: f64,
    anchor: DesktopRect,
) -> (DesktopRect, IslandOrigin) {
    let scale = valid_scale(scale);
    // The compact entry is the island; expansion keeps the original desktop
    // clothesline across its monitor, with no island-shaped panel or morph.
    let width = area.width.max(1);
    let height = ((SHELF_HEIGHT * scale).round() as u32).clamp(1, area.height.max(1));
    let rect = DesktopRect {
        x: area.x,
        y: area.y,
        width,
        height,
    };
    (
        rect,
        IslandOrigin {
            x: (f64::from(anchor.x) - f64::from(rect.x)) / scale,
            y: (f64::from(anchor.y) - f64::from(rect.y)) / scale,
            width: f64::from(anchor.width) / scale,
            height: f64::from(anchor.height) / scale,
        },
    )
}
fn hover_contains(rect: DesktopRect, range: (f64, f64), cursor: (i32, i32)) -> bool {
    let left = f64::from(rect.x) + f64::from(rect.width) * range.0;
    let right = f64::from(rect.x) + f64::from(rect.width) * range.1;
    if !rect.contains(cursor) || f64::from(cursor.0) < left || f64::from(cursor.0) >= right {
        return false;
    }
    // Hover follows the visible CSS capsule, not its larger native alpha guard.
    // Transparent corners must not trigger the entry through another app.
    let x = f64::from(cursor.0) - f64::from(rect.x) + 0.5;
    let y = f64::from(cursor.1) - f64::from(rect.y) + 0.5;
    let radius = f64::from(rect.width.min(rect.height)) / 2.0;
    let center_x = x.clamp(radius, f64::from(rect.width) - radius);
    let center_y = y.clamp(radius, f64::from(rect.height) - radius);
    (x - center_x).hypot(y - center_y) <= radius
}
fn monitor_index(
    monitors: &[Monitor],
    saved: &ShelfAnchor,
    primary: Option<&Monitor>,
) -> Option<usize> {
    let names: Vec<_> = monitors
        .iter()
        .map(|m| m.name().map(String::as_str))
        .collect();
    let primary = primary.and_then(|p| monitors.iter().position(|m| m.position() == p.position()));
    preferred_monitor_index(&names, saved.monitor.as_deref(), primary)
}
fn preferred_monitor_index(
    names: &[Option<&str>],
    saved: Option<&str>,
    primary: Option<usize>,
) -> Option<usize> {
    names
        .iter()
        .position(|name| saved.is_some() && *name == saved)
        .or_else(|| primary.filter(|index| *index < names.len()))
        .or_else(|| (!names.is_empty()).then_some(0))
}
fn placement(window: &WebviewWindow, saved: &ShelfAnchor) -> Result<(Monitor, DesktopRect)> {
    let monitors = window.available_monitors().map_err(|e| e.to_string())?;
    let primary = window.primary_monitor().map_err(|e| e.to_string())?;
    let index = monitor_index(&monitors, saved, primary.as_ref()).ok_or("显示器不可用")?;
    let monitor = monitors[index].clone();
    let rect = geometry(
        DesktopRect::from(&monitor),
        monitor.scale_factor(),
        saved.ratio,
    );
    Ok((monitor, rect))
}
pub(crate) fn apply(window: &WebviewWindow, rect: DesktopRect) -> Result<()> {
    // WM_DPICHANGED can adjust both bounds: read back and correct on the UI thread.
    let was_visible = window.is_visible().map_err(|e| e.to_string())?;
    let position = PhysicalPosition::new(rect.x, rect.y);
    let size = PhysicalSize::new(rect.width, rect.height);
    for _ in 0..3 {
        #[cfg(windows)]
        {
            use windows_sys::Win32::UI::WindowsAndMessaging::{
                SetWindowPos, SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_NOZORDER,
            };
            let hwnd = window.hwnd().map_err(|e| e.to_string())?.0;
            if unsafe {
                SetWindowPos(
                    hwnd as _,
                    std::ptr::null_mut(),
                    rect.x,
                    rect.y,
                    rect.width as i32,
                    rect.height as i32,
                    // Recalculate non-client bounds even when the initial
                    // outer size already matches. Otherwise a hidden HWND can
                    // retain its creation-time caption insets (8/31/8/8).
                    SWP_FRAMECHANGED | SWP_NOACTIVATE | SWP_NOZORDER,
                )
            } == 0
            {
                return Err("无法调整顶部入口位置。".into());
            }
        }
        #[cfg(not(windows))]
        {
            window.set_position(position).map_err(|e| e.to_string())?;
            window.set_size(size).map_err(|e| e.to_string())?;
        }
        if window.inner_position().map_err(|e| e.to_string())? == position
            && window.inner_size().map_err(|e| e.to_string())? == size
        {
            if window.label() == "anchor" {
                rounded_region(window, Some(f64::from(rect.height) / 2.0))?;
                if crate::anchor_glow::position(window, rect).is_err() {
                    let _ = crate::anchor_glow::hide(window.app_handle());
                }
            }
            // Tao's DPI handler may reapply its internal hidden flag. Preserve
            // the entry's actual visibility without activating its HWND.
            if was_visible && !window.is_visible().map_err(|e| e.to_string())? {
                set_visible(window, true)?;
            }
            return Ok(());
        }
    }
    Err(format!(
        "顶部入口定位暂未完成（{}：目标 {:?}；实际 client {:?} / {:?}，outer {:?} / {:?}）。",
        window.label(),
        rect,
        window.inner_position(),
        window.inner_size(),
        window.outer_position(),
        window.outer_size()
    ))
}
/// The persistent entry is passive: automatic reappearance must never steal
/// another app's keyboard focus. Keep every anchor show/hide on this native path;
/// Tao's is_visible reads IsWindowVisible, whereas its show() uses SW_SHOW.
pub fn set_visible(window: &WebviewWindow, visible: bool) -> Result<()> {
    let changed = window.is_visible().unwrap_or(false) != visible;
    set_visible_native(window, visible)?;
    if window.label() == "anchor" {
        if changed {
            let _ = window.emit("anchor-visibility", visible);
        }
        if visible {
            let _ = crate::anchor_glow::sync(window.app_handle());
        } else {
            crate::anchor_glow::hide(window.app_handle())?;
        }
    }
    Ok(())
}
pub(crate) fn set_visible_native(window: &WebviewWindow, visible: bool) -> Result<()> {
    #[cfg(windows)]
    {
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            IsWindowVisible, ShowWindow, SW_HIDE, SW_SHOWNOACTIVATE,
        };
        let hwnd = window.hwnd().map_err(|e| e.to_string())?.0;
        unsafe {
            ShowWindow(hwnd as _, if visible { SW_SHOWNOACTIVATE } else { SW_HIDE });
            if (IsWindowVisible(hwnd as _) != 0) != visible {
                return Err("顶部入口显示状态未能更新。".into());
            }
        }
        Ok(())
    }
    #[cfg(not(windows))]
    {
        if visible {
            window.show()
        } else {
            window.hide()
        }
        .map_err(|e| e.to_string())
    }
}

/// GDI regions are binary masks. Keep their edge outside Chromium's partially
/// transparent CSS edge, while still excluding the unused window corners.
#[cfg(windows)]
fn capsule_hit_region(
    width: u32,
    height: u32,
    radius: f64,
) -> Result<windows_sys::Win32::Graphics::Gdi::HRGN> {
    use windows_sys::Win32::Graphics::Gdi::{
        CombineRgn, CreateRectRgn, CreateRoundRectRgn, DeleteObject, RGN_AND,
    };
    // Keep the guard in physical pixels, independent of monitor DPI. GDI's
    // rasterized ellipse also needs the right/bottom endpoint one unit beyond
    // the guard; omitting it cuts the lower/right alpha fringe at some scales.
    // The rectangular intersection below keeps the hit region inside the HWND.
    const ALPHA_GUARD: i32 = 2;
    const MAX_REGION_COORDINATE: i32 = (1 << 26) - 1; // GDI uses signed 27-bit coordinates.
    let width = i32::try_from(width).map_err(|_| "顶部入口尺寸无效")?;
    let height = i32::try_from(height).map_err(|_| "顶部入口尺寸无效")?;
    if width <= 0
        || height <= 0
        || width > MAX_REGION_COORDINATE - ALPHA_GUARD - 1
        || height > MAX_REGION_COORDINATE - ALPHA_GUARD - 1
        || !radius.is_finite()
        || radius < 0.0
    {
        return Err("顶部入口尺寸无效".into());
    }
    let diameter = ((radius.min(f64::from(width.min(height)) / 2.0) + f64::from(ALPHA_GUARD)) * 2.0)
        .round() as i32;
    unsafe {
        let region = CreateRoundRectRgn(
            -ALPHA_GUARD,
            -ALPHA_GUARD,
            width + ALPHA_GUARD + 1,
            height + ALPHA_GUARD + 1,
            diameter,
            diameter,
        );
        if region.is_null() {
            return Err("无法设置灵动岛点击区域。".into());
        }
        let bounds = CreateRectRgn(0, 0, width, height);
        if bounds.is_null() {
            DeleteObject(region);
            return Err("无法设置灵动岛点击区域。".into());
        }
        let combined = CombineRgn(region, region, bounds, RGN_AND);
        DeleteObject(bounds);
        if combined == 0 {
            DeleteObject(region);
            return Err("无法设置灵动岛点击区域。".into());
        }
        Ok(region)
    }
}
/// CSS owns the antialiased visual contour; the native region is only a loose
/// hit mask. The expanded clothesline keeps its full rectangular window.
fn rounded_region(window: &WebviewWindow, radius: Option<f64>) -> Result<()> {
    #[cfg(windows)]
    {
        use windows_sys::Win32::Graphics::Gdi::{DeleteObject, SetWindowRgn};
        let hwnd = window.hwnd().map_err(|e| e.to_string())?.0;
        let size = window.inner_size().map_err(|e| e.to_string())?;
        let region = if let Some(radius) = radius {
            capsule_hit_region(size.width, size.height, radius)?
        } else {
            std::ptr::null_mut()
        };
        if unsafe { SetWindowRgn(hwnd as _, region, 1) } == 0 {
            if !region.is_null() {
                unsafe {
                    DeleteObject(region);
                }
            }
            return Err("无法更新灵动岛点击区域。".into());
        }
    }
    #[cfg(not(windows))]
    let _ = (window, radius);
    Ok(())
}
fn ignore_shelf_cursor(window: &WebviewWindow, ignore: bool) -> Result<()> {
    #[cfg(windows)]
    {
        use windows_sys::Win32::{
            Foundation::{GetLastError, SetLastError},
            UI::WindowsAndMessaging::{
                GetWindowLongPtrW, SetWindowLongPtrW, GWL_EXSTYLE, WS_EX_LAYERED, WS_EX_TRANSPARENT,
            },
        };
        let hwnd = window.hwnd().map_err(|e| e.to_string())?.0;
        let state = window.app_handle().state::<AnchorState>();
        let mut saved_layered = state
            .shelf_cursor_layered
            .lock()
            .map_err(|_| "灵动岛点击状态不可用")?;
        unsafe {
            SetLastError(0);
            let previous = GetWindowLongPtrW(hwnd as _, GWL_EXSTYLE) as u32;
            if previous == 0 && GetLastError() != 0 {
                return Err("无法读取灵动岛点击状态。".into());
            }
            let next = if ignore {
                saved_layered.get_or_insert(previous & WS_EX_LAYERED != 0);
                previous | WS_EX_TRANSPARENT | WS_EX_LAYERED
            } else if let Some(was_layered) = *saved_layered {
                let restored = previous & !WS_EX_TRANSPARENT;
                if was_layered {
                    restored
                } else {
                    restored & !WS_EX_LAYERED
                }
            } else {
                return Ok(());
            };
            if next != previous {
                SetLastError(0);
                if SetWindowLongPtrW(hwnd as _, GWL_EXSTYLE, next as isize) == 0
                    && GetLastError() != 0
                {
                    return Err("无法更新灵动岛点击状态。".into());
                }
            }
            if !ignore {
                *saved_layered = None;
            }
        }
        // Only change extended input styles. Tao's cursor setter also rewrites
        // its cached VISIBLE=false flag, hiding a passive SW_SHOWNOACTIVATE HWND.
        Ok(())
    }
    #[cfg(not(windows))]
    window
        .set_ignore_cursor_events(ignore)
        .map_err(|e| e.to_string())
}
fn focus_shelf_on_request(window: &WebviewWindow) -> Result<()> {
    #[cfg(windows)]
    {
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            GetForegroundWindow, SetForegroundWindow,
        };
        let hwnd = window.hwnd().map_err(|e| e.to_string())?.0;
        // This path is only for explicit click/shortcut activation. Respect
        // Windows foreground restrictions; never attach input queues or force
        // focus away from another app if the system rejects the request.
        unsafe {
            if !std::ptr::eq(GetForegroundWindow(), hwnd) {
                SetForegroundWindow(hwnd as _);
            }
            if !std::ptr::eq(GetForegroundWindow(), hwnd) {
                trace(format_args!("explicit focus request declined by Windows"));
                return Ok(());
            }
        }
        // Tao's top-level focus API checks its cached VISIBLE flag, whereas our
        // passive windows use SW_SHOWNOACTIVATE. Focus the WebView directly once
        // Windows confirms this HWND is the foreground window.
        let webview: &tauri::Webview = window.as_ref();
        webview.set_focus().map_err(|e| e.to_string())
    }
    #[cfg(not(windows))]
    window.set_focus().map_err(|e| e.to_string())
}
fn shelf_blocked(app: &AppHandle) -> bool {
    app.state::<AppState>()
        .capture_active
        .load(Ordering::SeqCst)
        || app.get_webview_window("gallery").is_some()
        || native::foreground_is_fullscreen()
}
fn restore_anchor(app: &AppHandle) -> Result<()> {
    let settings = lock(&app.state::<AppState>())?.settings.clone();
    if !settings.edge_reveal
        || shelf_blocked(app)
        || !app.state::<AnchorState>().ready.load(Ordering::SeqCst)
    {
        return Ok(());
    }
    if let Some(anchor) = app.get_webview_window("anchor") {
        let (_, rect) = placement(&anchor, &settings.shelf_anchor)?;
        apply(&anchor, rect)?;
        native::set_capture_transitions(&anchor, true)?;
        set_visible(&anchor, true)?;
    }
    Ok(())
}
pub fn shelf_requested(app: &AppHandle) -> bool {
    app.state::<AnchorState>()
        .shelf
        .lock()
        .map(|state| state.phase != ShelfPhase::Hidden)
        .unwrap_or(false)
}
pub fn is_interactive(app: &AppHandle) -> bool {
    app.state::<AnchorState>()
        .shelf
        .lock()
        .map(|state| state.phase == ShelfPhase::Open)
        .unwrap_or(false)
        && app
            .get_webview_window("shelf")
            .is_some_and(|window| window.is_visible().unwrap_or(false))
}
pub fn reveal(app: &AppHandle, hold_ms: u64) -> Result<()> {
    trace(format_args!("reveal requested hold={hold_ms}"));
    let handle = app.clone();
    app.run_on_main_thread(move || {
        if let Err(error) = reveal_now(&handle, hold_ms) {
            trace(format_args!("reveal error {error}"));
            report(&handle, error);
        }
    })
    .map_err(|e| e.to_string())
}
fn reveal_now(app: &AppHandle, hold_ms: u64) -> Result<()> {
    if shelf_blocked(app) {
        trace(format_args!(
            "reveal blocked capture={} gallery={} fullscreen={}",
            app.state::<AppState>()
                .capture_active
                .load(Ordering::SeqCst),
            app.get_webview_window("gallery").is_some(),
            native::foreground_is_fullscreen()
        ));
        return Ok(());
    }
    app.state::<AppState>()
        .shelf_until
        .store(now_ms() + hold_ms, Ordering::Relaxed);
    let a = app.state::<AnchorState>();
    let window = app.get_webview_window("shelf").ok_or("晾图窗口尚未就绪")?;
    let mut state = a.shelf.lock().map_err(|_| "灵动岛状态不可用")?;
    trace(format_args!(
        "reveal state {:?} token={} frontend_ready={}",
        state.phase, state.token, state.frontend_ready
    ));
    match state.phase {
        ShelfPhase::Open | ShelfPhase::Opening | ShelfPhase::Preparing | ShelfPhase::Waiting => {
            return Ok(())
        }
        ShelfPhase::Closing => {
            state.change(ShelfPhase::Opening, Some(Duration::from_millis(650)));
            let event = state.message("open");
            drop(state);
            return window
                .emit("shelf-transition", event)
                .map_err(|e| e.to_string());
        }
        ShelfPhase::Hidden => {}
    }
    let saved = lock(&app.state::<AppState>())?
        .settings
        .shelf_anchor
        .clone();
    let (monitor, anchor) = placement(&window, &saved)?;
    let (rect, origin) =
        expanded_geometry(DesktopRect::from(&monitor), monitor.scale_factor(), anchor);
    apply(&window, rect)?;
    trace(format_args!("shelf geometry applied {:?}", rect));
    native::set_capture_transitions(&window, true)?;
    rounded_region(&window, None)?;
    ignore_shelf_cursor(&window, true)?;
    state.origin = origin;
    let phase = if state.frontend_ready {
        ShelfPhase::Preparing
    } else {
        ShelfPhase::Waiting
    };
    state.change(phase, Some(Duration::from_secs(2)));
    let message = (phase == ShelfPhase::Preparing).then(|| state.message("prepare"));
    drop(state);
    if let Some(event) = message {
        trace(format_args!("emit prepare token={}", event.token));
        window
            .emit("shelf-transition", event)
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}
pub fn hide_immediately(app: &AppHandle) -> Result<()> {
    app.state::<AnchorState>()
        .shelf
        .lock()
        .map_err(|_| "灵动岛状态不可用")?
        .change(ShelfPhase::Hidden, None);
    app.state::<AppState>()
        .shelf_manual
        .store(false, Ordering::SeqCst);
    if let Some(window) = app.get_webview_window("shelf") {
        set_visible(&window, false)?;
        ignore_shelf_cursor(&window, false)?;
    }
    Ok(())
}
pub fn close_shelf(app: &AppHandle) -> Result<()> {
    let handle = app.clone();
    app.run_on_main_thread(move || {
        if let Ok(mut runtime) = handle.state::<AnchorState>().runtime.lock() {
            runtime.require_hover_exit = true;
            runtime.hover = None;
        }
        if let Err(error) = close_shelf_now(&handle) {
            report(&handle, error);
        }
    })
    .map_err(|e| e.to_string())
}
fn close_shelf_now(app: &AppHandle) -> Result<()> {
    crate::shelf_preview::close_now(app, None)?;
    app.state::<AppState>()
        .shelf_manual
        .store(false, Ordering::SeqCst);
    let a = app.state::<AnchorState>();
    let mut state = a.shelf.lock().map_err(|_| "灵动岛状态不可用")?;
    match state.phase {
        ShelfPhase::Hidden | ShelfPhase::Closing => return Ok(()),
        ShelfPhase::Waiting | ShelfPhase::Preparing => {
            drop(state);
            hide_immediately(app)?;
            return restore_anchor(app);
        }
        ShelfPhase::Opening | ShelfPhase::Open => {}
    }
    state.change(ShelfPhase::Closing, Some(Duration::from_millis(650)));
    let event = state.message("close");
    drop(state);
    let window = app.get_webview_window("shelf").ok_or("晾图窗口尚未就绪")?;
    ignore_shelf_cursor(&window, true)?;
    rounded_region(&window, None)?;
    window
        .emit("shelf-transition", event)
        .map_err(|e| e.to_string())
}
fn finish_close(app: &AppHandle, token: u64) -> Result<()> {
    if app
        .state::<AppState>()
        .capture_active
        .load(Ordering::SeqCst)
    {
        return Ok(());
    }
    let a = app.state::<AnchorState>();
    let mut state = a.shelf.lock().map_err(|_| "灵动岛状态不可用")?;
    if !state.matches(token, ShelfPhase::Closing) {
        return Ok(());
    }
    state.change(ShelfPhase::Hidden, None);
    drop(state);
    // Restore the fixed compact entry before removing the expanded clothesline.
    restore_anchor(app)?;
    if let Some(window) = app.get_webview_window("shelf") {
        set_visible(&window, false)?;
        ignore_shelf_cursor(&window, false)?;
    }
    Ok(())
}
fn finish_open(app: &AppHandle, token: u64) -> Result<()> {
    trace(format_args!("finish_open token={token}"));
    if app
        .state::<AppState>()
        .capture_active
        .load(Ordering::SeqCst)
    {
        return Ok(());
    }
    if shelf_blocked(app) {
        return hide_immediately(app);
    }
    let a = app.state::<AnchorState>();
    let mut state = a.shelf.lock().map_err(|_| "灵动岛状态不可用")?;
    if !state.can_finish_open(token) {
        return Ok(());
    }
    state.phase = ShelfPhase::Open;
    state.deadline = None;
    drop(state);
    if let Some(window) = app.get_webview_window("shelf") {
        rounded_region(&window, None)?;
        ignore_shelf_cursor(&window, false)?;
    }
    Ok(())
}
fn advance_shelf(app: &AppHandle) -> Result<()> {
    let a = app.state::<AnchorState>();
    let state = a.shelf.lock().map_err(|_| "灵动岛状态不可用")?;
    if !state
        .deadline
        .is_some_and(|deadline| Instant::now() >= deadline)
    {
        return Ok(());
    }
    let token = state.token;
    trace(format_args!("deadline {:?} token={token}", state.phase));
    match state.phase {
        ShelfPhase::Opening => {
            let painted = state.painted;
            drop(state);
            if painted {
                finish_open(app, token)
            } else {
                // A visible HWND is not proof that its hidden WebView painted.
                // Keep the compact entry rather than replacing it with a gap.
                hide_immediately(app)?;
                restore_anchor(app)
            }
        }
        ShelfPhase::Closing => {
            drop(state);
            finish_close(app, token)
        }
        ShelfPhase::Preparing | ShelfPhase::Waiting => {
            drop(state);
            hide_immediately(app)?;
            restore_anchor(app)
        }
        _ => Ok(()),
    }
}
#[tauri::command]
pub async fn shelf_frontend_ready(app: AppHandle, window: WebviewWindow) -> Result<bool> {
    trace(format_args!("frontend_ready received"));
    if window.label() != "shelf" {
        return Err("灵动岛窗口无效".into());
    }
    on_main(app, |app| {
        let a = app.state::<AnchorState>();
        let mut state = a.shelf.lock().map_err(|_| "灵动岛状态不可用")?;
        trace(format_args!(
            "frontend_ready state {:?} token={}",
            state.phase, state.token
        ));
        state.frontend_ready = true;
        if state.phase == ShelfPhase::Waiting {
            state.phase = ShelfPhase::Preparing;
            state.deadline = Some(Instant::now() + Duration::from_secs(2));
            let event = state.message("prepare");
            drop(state);
            if let Some(window) = app.get_webview_window("shelf") {
                window
                    .emit("shelf-transition", event)
                    .map_err(|e| e.to_string())?;
            }
        }
        Ok(trace_enabled())
    })
    .await
}
#[tauri::command]
pub async fn shelf_transition_ready(
    app: AppHandle,
    window: WebviewWindow,
    token: u64,
) -> Result<()> {
    trace(format_args!("ready received token={token}"));
    if window.label() != "shelf" {
        return Err("灵动岛窗口无效".into());
    }
    on_main(app, move |app| {
        if app
            .state::<AppState>()
            .capture_active
            .load(Ordering::SeqCst)
        {
            return Ok(());
        }
        if shelf_blocked(app) {
            return hide_immediately(app);
        }
        let a = app.state::<AnchorState>();
        let mut state = a.shelf.lock().map_err(|_| "灵动岛状态不可用")?;
        trace(format_args!(
            "ready matches={} incoming={} current={} phase={:?}",
            state.matches(token, ShelfPhase::Preparing),
            token,
            state.token,
            state.phase
        ));
        if !state.matches(token, ShelfPhase::Preparing) {
            return Ok(());
        }
        state.phase = ShelfPhase::Opening;
        state.deadline = Some(Instant::now() + Duration::from_millis(650));
        let event = state.message("open");
        drop(state);
        let window = app.get_webview_window("shelf").ok_or("晾图窗口尚未就绪")?;
        set_visible(&window, true)?;
        trace(format_args!("shown shelf token={token}"));
        // Explicit clicks and the shortcut may transfer focus. Hover and
        // background capture peeks must leave the user's current app alone.
        if app.state::<AppState>().shelf_manual.load(Ordering::SeqCst) {
            focus_shelf_on_request(&window)?;
        }
        window
            .emit("shelf-transition", event)
            .map_err(|e| e.to_string())
    })
    .await
}
#[tauri::command]
pub async fn shelf_transition_painted(
    app: AppHandle,
    window: WebviewWindow,
    token: u64,
) -> Result<()> {
    if window.label() != "shelf" {
        return Err("灵动岛窗口无效".into());
    }
    on_main(app, move |app| {
        if app
            .state::<AppState>()
            .capture_active
            .load(Ordering::SeqCst)
        {
            return Ok(());
        }
        if shelf_blocked(app) {
            return hide_immediately(app);
        }
        let a = app.state::<AnchorState>();
        if !a
            .shelf
            .lock()
            .map_err(|_| "灵动岛状态不可用")?
            .matches(token, ShelfPhase::Opening)
        {
            return Ok(());
        }
        let shelf = app.get_webview_window("shelf").ok_or("晾图窗口尚未就绪")?;
        if !shelf.is_visible().map_err(|e| e.to_string())? {
            return Ok(());
        }
        // The frontend sends this only after two visible animation frames;
        // finish the pending compositor submission before retiring the entry.
        native::flush_compositor()?;
        if app
            .state::<AppState>()
            .capture_active
            .load(Ordering::SeqCst)
        {
            return Ok(());
        }
        if shelf_blocked(app) {
            return hide_immediately(app);
        }
        if !a
            .shelf
            .lock()
            .map_err(|_| "灵动岛状态不可用")?
            .mark_painted(token)
        {
            return Ok(());
        }
        trace(format_args!("painted shelf token={token}"));
        if let Some(anchor) = app.get_webview_window("anchor") {
            set_visible(&anchor, false)?;
        }
        // Interaction starts after the first paint, not after the pendulum's
        // decorative settling animation. Reduced-motion uses this same gate.
        finish_open(app, token)
    })
    .await
}
#[tauri::command]
pub fn shelf_frontend_trace(window: WebviewWindow, stage: String, token: u64) -> Result<()> {
    if window.label() != "shelf" {
        return Err("灵动岛窗口无效".into());
    }
    if [
        "event-prepare",
        "event-open",
        "event-close",
        "missing-root",
        "rejected",
        "missing-content",
        "ready-sent",
        "handler-error",
    ]
    .contains(&stage.as_str())
    {
        trace(format_args!("frontend {stage} token={token}"));
    }
    Ok(())
}
#[tauri::command]
pub async fn shelf_transition_opened(
    app: AppHandle,
    window: WebviewWindow,
    token: u64,
) -> Result<()> {
    if window.label() != "shelf" {
        return Err("灵动岛窗口无效".into());
    }
    on_main(app, move |app| finish_open(app, token)).await
}
#[tauri::command]
pub async fn shelf_transition_finished(
    app: AppHandle,
    window: WebviewWindow,
    token: u64,
) -> Result<()> {
    if window.label() != "shelf" {
        return Err("灵动岛窗口无效".into());
    }
    on_main(app, move |app| finish_close(app, token)).await
}
pub(crate) async fn on_main<T: Send + 'static>(
    app: AppHandle,
    f: impl FnOnce(&AppHandle) -> Result<T> + Send + 'static,
) -> Result<T> {
    let (send, mut receive) = tauri::async_runtime::channel(1);
    let handle = app.clone();
    app.run_on_main_thread(move || {
        let _ = send.try_send(f(&handle));
    })
    .map_err(|e| e.to_string())?;
    receive.recv().await.ok_or("窗口操作未完成")?
}
/// Register before constructing any WebView: the hidden shelf can finish its
/// frontend handshake while setup is still creating the tray and anchor.
pub fn initialize(app: &AppHandle) {
    app.manage(AnchorState::default());
    crate::anchor_glow::initialize(app);
}
pub fn create(app: &AppHandle) -> Result<()> {
    let window = WebviewWindowBuilder::new(
        app,
        "anchor",
        WebviewUrl::App("index.html?view=anchor".into()),
    )
    .title("Snapline · 顶部入口")
    .inner_size(WIDTH, HEIGHT)
    .min_inner_size(1.0, 1.0)
    .decorations(false)
    .transparent(true)
    .shadow(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .resizable(false)
    .focused(false)
    .visible(false)
    .build()
    .map_err(|e| e.to_string())?;
    native::set_capture_transitions(&window, true)?;
    if let Err(error) = crate::anchor_glow::create(app) {
        report(app, error);
    }
    let saved = lock(&app.state::<AppState>())?
        .settings
        .shelf_anchor
        .clone();
    let (_, rect) = placement(&window, &saved)?;
    if let Err(error) = apply(&window, rect) {
        // Window/DPI creation can still be settling. Keep the optional island
        // hidden and let the watcher retry instead of terminating the library.
        eprintln!("{error}");
        report(app, error);
    }
    Ok(())
}
#[tauri::command]
pub async fn anchor_ready(
    app: AppHandle,
    window: WebviewWindow,
    hover_start: f64,
    hover_end: f64,
) -> Result<()> {
    if window.label() != "anchor" {
        return Err("入口窗口无效".into());
    }
    app.state::<AnchorState>()
        .runtime
        .lock()
        .map_err(|_| "入口位置不可用")?
        .set_hover_range(hover_start, hover_end)?;
    app.state::<AnchorState>()
        .ready
        .store(true, Ordering::SeqCst);
    Ok(())
}
#[tauri::command]
pub async fn open_shelf(app: AppHandle) -> Result<()> {
    on_main(app, |app| {
        if app
            .state::<AppState>()
            .capture_active
            .load(Ordering::SeqCst)
        {
            return Ok(());
        }
        app.state::<AppState>()
            .shelf_manual
            .store(true, Ordering::SeqCst);
        reveal_shelf(app, 1000)
    })
    .await
}
#[tauri::command]
pub async fn begin_shelf_anchor_drag(
    app: AppHandle,
    window: WebviewWindow,
    grab_x: f64,
    grab_y: f64,
) -> Result<()> {
    if window.label() != "anchor" {
        return Err("入口窗口无效".into());
    }
    on_main(app, move |app| {
        let w = app.get_webview_window("anchor").ok_or("入口窗口不可用")?;
        let p = w.outer_position().map_err(|e| e.to_string())?;
        let size = w.outer_size().map_err(|e| e.to_string())?;
        let drag = Drag::from_local(
            DesktopRect {
                x: p.x,
                y: p.y,
                width: size.width,
                height: size.height,
            },
            grab_x,
            grab_y,
        )?;
        let state = app.state::<AnchorState>();
        let mut runtime = state.runtime.lock().map_err(|_| "入口位置不可用")?;
        runtime.hover = None;
        runtime.last_drag_moved = false;
        runtime.last_drag_error = None;
        runtime.drag = Some(drag);
        Ok(())
    })
    .await
}
fn move_drag(app: &AppHandle, runtime: &mut Runtime, cursor: (i32, i32)) -> Result<()> {
    let Some(mut drag) = runtime.drag else {
        return Ok(());
    };
    let w = app.get_webview_window("anchor").ok_or("入口窗口不可用")?;
    let monitors = w.available_monitors().map_err(|e| e.to_string())?;
    let monitor = monitors
        .iter()
        .find(|m| DesktopRect::from(*m).contains(cursor));
    drag.observe(cursor);
    runtime.drag = Some(drag);
    if !drag.moved {
        return Ok(());
    }
    let Some(monitor) = monitor else {
        return Ok(());
    }; // Desktop gaps do not change monitors.
    let area = DesktopRect::from(monitor);
    let centered = geometry(area, monitor.scale_factor(), 0.5);
    let ratio = cursor_ratio(
        area,
        monitor.scale_factor(),
        centered.width,
        cursor.0,
        drag.fraction,
    );
    let rect = geometry(area, monitor.scale_factor(), ratio);
    apply(&w, rect)?;
    runtime.placement = Some((monitor.name().cloned().unwrap_or_default(), rect));
    Ok(())
}
fn finish_drag(app: &AppHandle, runtime: &mut Runtime) -> Result<bool> {
    if runtime.drag.is_none() {
        return match runtime.last_drag_error.take() {
            Some(error) => Err(error),
            None => Ok(runtime.last_drag_moved),
        };
    }
    let movement = native::cursor().map_or(Ok(()), |cursor| move_drag(app, runtime, cursor));
    let drag = runtime.drag.take().ok_or("入口拖动已结束")?;
    runtime.complete_drag_hover(drag.moved, now_ms());
    let result = (|| -> Result<bool> {
        movement?;
        if !drag.moved {
            return Ok(false);
        }
        let w = app.get_webview_window("anchor").ok_or("入口窗口不可用")?;
        let p = w.outer_position().map_err(|e| e.to_string())?;
        let size = w.outer_size().map_err(|e| e.to_string())?;
        let monitors = w.available_monitors().map_err(|e| e.to_string())?;
        let m = monitors
            .iter()
            .find(|m| DesktopRect::from(*m).contains((p.x, p.y)))
            .ok_or("显示器已变更，入口位置未保存。")?;
        let anchor = ShelfAnchor {
            monitor: m.name().cloned(),
            ratio: cursor_ratio(DesktopRect::from(m), m.scale_factor(), size.width, p.x, 0.0),
        };
        lock(&app.state::<AppState>())?.set_shelf_anchor(anchor)?;
        publish(app, false)?;
        Ok(true)
    })();
    if let Err(error) = &result {
        runtime.last_drag_error = Some(error.clone());
    }
    result
}
#[tauri::command]
pub async fn finish_shelf_anchor_drag(app: AppHandle) -> Result<bool> {
    on_main(app, |app| {
        let state = app.state::<AnchorState>();
        let mut runtime = state.runtime.lock().map_err(|_| "入口位置不可用")?;
        finish_drag(app, &mut runtime)
    })
    .await
}
#[tauri::command]
pub async fn nudge_shelf_anchor(app: AppHandle, delta: f64) -> Result<()> {
    if !delta.is_finite() {
        return Err("位置增量无效".into());
    }
    on_main(app, move |app| {
        let w = app.get_webview_window("anchor").ok_or("入口窗口不可用")?;
        let state = app.state::<AppState>();
        let saved = lock(&state)?.settings.shelf_anchor.clone();
        let (m, rect) = placement(&w, &saved)?;
        let area = DesktopRect::from(&m);
        let x = (f64::from(rect.x) + delta.clamp(-100.0, 100.0) * m.scale_factor()).round() as i32;
        let next = ShelfAnchor {
            monitor: m.name().cloned(),
            ratio: cursor_ratio(area, m.scale_factor(), rect.width, x, 0.0),
        };
        lock(&state)?.set_shelf_anchor(next.clone())?;
        apply(&w, geometry(area, m.scale_factor(), next.ratio))?;
        app.state::<AnchorState>()
            .runtime
            .lock()
            .map_err(|_| "入口位置不可用")?
            .suppress_after_move();
        publish(app, false)?;
        Ok(())
    })
    .await
}
#[tauri::command]
pub async fn reset_shelf_anchor(app: AppHandle) -> Result<()> {
    on_main(app, |app| {
        lock(&app.state::<AppState>())?.set_shelf_anchor(ShelfAnchor::default())?;
        app.state::<AnchorState>()
            .runtime
            .lock()
            .map_err(|_| "入口位置不可用")?
            .suppress_after_move();
        publish(app, false)?;
        Ok(())
    })
    .await
}
#[cfg(windows)]
fn left_button_down() -> bool {
    unsafe { windows_sys::Win32::UI::Input::KeyboardAndMouse::GetAsyncKeyState(1) < 0 }
}
#[cfg(not(windows))]
fn left_button_down() -> bool {
    true
}
fn tick(app: &AppHandle) -> Result<()> {
    // Preparation exclusively owns the visibility snapshot and any hiding.
    // Watchers must neither pre-hide a window nor react to overlay focus.
    if app
        .state::<AppState>()
        .capture_active
        .load(Ordering::SeqCst)
    {
        return Ok(());
    }
    // The preview is an app-owned fullscreen surface, not an external app
    // requesting edge suppression. Keep its shelf stable beneath it.
    if crate::shelf_preview::tick(app)? {
        return Ok(());
    }
    let a = app.state::<AnchorState>();
    let state = app.state::<AppState>();
    let mut rt = a.runtime.lock().map_err(|_| "入口状态不可用")?;
    let anchor = app.get_webview_window("anchor").ok_or("入口窗口不可用")?;
    let shelf = app.get_webview_window("shelf").ok_or("晾图窗口不可用")?;
    let settings = lock(&state)?.settings.clone();
    // The user can start capture while the hidden gallery WebView is loading.
    // It then is not part of capture's visible-window restore list. Complete
    // its ready handshake after capture instead of leaving an invisible blocker.
    if !state.capture_active.load(Ordering::SeqCst)
        && app
            .get_webview_window("gallery")
            .is_some_and(|w| !w.is_visible().unwrap_or(false))
    {
        reveal_gallery_if_ready(app)?;
    }
    if state.capture_active.load(Ordering::SeqCst)
        || app.get_webview_window("gallery").is_some()
        || native::foreground_is_fullscreen()
    {
        if rt.drag.is_some() {
            if let Err(error) = finish_drag(app, &mut rt) {
                report(app, error);
            }
        }
        if anchor.is_visible().unwrap_or(false) {
            set_visible(&anchor, false)?;
        }
        // Capture owns visibility bookkeeping; do not race it by hiding its source windows.
        if !state.capture_active.load(Ordering::SeqCst)
            && (shelf.is_visible().unwrap_or(false) || shelf_requested(app))
        {
            hide_immediately(app)?;
        }
        rt.hover = None;
        rt.outside = None;
        return Ok(());
    }
    advance_shelf(app)?;
    let Some(cursor) = native::cursor() else {
        return Ok(());
    };
    if rt.drag.is_some() {
        if left_button_down() {
            move_drag(app, &mut rt, cursor)?;
        } else {
            if let Err(error) = finish_drag(app, &mut rt) {
                report(app, error);
            }
        }
        return Ok(());
    }
    let (monitor, rect) = placement(&anchor, &settings.shelf_anchor)?;
    rt.observe_hover_exit(rect, cursor);
    let key = (monitor.name().cloned().unwrap_or_default(), rect);
    if rt.placement.as_ref() != Some(&key) {
        apply(&anchor, rect)?;
        rt.placement = Some(key);
    }
    let shelf_visible = shelf.is_visible().unwrap_or(false);
    let waiting_for_paint = a
        .shelf
        .lock()
        .map_err(|_| "灵动岛状态不可用")?
        .anchor_pending;
    let should_show = settings.edge_reveal
        && a.ready.load(Ordering::SeqCst)
        && (!shelf_visible || waiting_for_paint);
    if should_show != anchor.is_visible().unwrap_or(false) {
        if should_show {
            native::set_capture_transitions(&anchor, true)?;
            set_visible(&anchor, true)?;
        } else {
            set_visible(&anchor, false)?;
        }
    }
    if state.dragging.load(Ordering::SeqCst) {
        rt.hover = None;
        return Ok(());
    }
    if shelf_visible {
        let inside = shelf
            .outer_position()
            .ok()
            .zip(shelf.outer_size().ok())
            .is_some_and(|(p, s)| {
                DesktopRect {
                    x: p.x,
                    y: p.y,
                    width: s.width,
                    height: s.height,
                }
                .contains(cursor)
            });
        if inside {
            state.shelf_manual.store(false, Ordering::SeqCst);
        }
        if inside
            || state.shelf_manual.load(Ordering::SeqCst)
            || state.shelf_until.load(Ordering::Relaxed) > now_ms()
        {
            rt.outside = None;
        } else if rt.outside.get_or_insert_with(Instant::now).elapsed() > Duration::from_millis(600)
        {
            close_shelf_now(app)?;
            rt.outside = None;
        }
        rt.hover = None;
    } else if should_show {
        if rt.poll_hover(rect, cursor, left_button_down(), Instant::now(), now_ms()) {
            reveal_shelf(app, 500)?;
        }
    } else {
        rt.hover = None;
    }
    Ok(())
}
pub fn start_watcher(app: AppHandle) {
    std::thread::spawn(move || loop {
        let state = app.state::<AnchorState>();
        let dragging = state
            .runtime
            .lock()
            .map(|rt| rt.drag.is_some())
            .unwrap_or(false);
        std::thread::sleep(Duration::from_millis(if dragging { 16 } else { 80 }));
        if state.tick_pending.swap(true, Ordering::SeqCst) {
            continue;
        }
        let handle = app.clone();
        if app
            .run_on_main_thread(move || {
                // Transient monitor removal must not turn into repetitive toast notifications.
                let _ = tick(&handle);
                let _ = crate::anchor_glow::sync(&handle);
                handle
                    .state::<AnchorState>()
                    .tick_pending
                    .store(false, Ordering::SeqCst);
            })
            .is_err()
        {
            state.tick_pending.store(false, Ordering::SeqCst);
        }
    });
}
fn reveal_gallery_if_ready(app: &AppHandle) -> Result<()> {
    let state = app.state::<AnchorState>();
    if !state
        .gallery
        .lock()
        .map_err(|_| "图库状态不可用")?
        .can_show(
            app.state::<AppState>()
                .capture_active
                .load(Ordering::SeqCst),
        )
    {
        return Ok(());
    }
    let w = app.get_webview_window("gallery").ok_or("图库窗口不可用")?;
    // Loading a hidden gallery can overlap capture. Commit every visible
    // side effect only after this UI-thread presentation gate permits showing.
    crate::shelf_preview::close_now(app, None)?;
    hide_immediately(app)?;
    if let Some(anchor) = app.get_webview_window("anchor") {
        set_visible(&anchor, false)?;
    }
    native::set_capture_transitions(&w, true)?;
    w.show().map_err(|e| e.to_string())?;
    w.set_focus().map_err(|e| e.to_string())
}
#[tauri::command]
pub async fn show_gallery(app: AppHandle) -> Result<()> {
    if app
        .state::<AppState>()
        .capture_active
        .load(Ordering::SeqCst)
    {
        return Err("请先完成或取消截图。".into());
    }
    if app.get_webview_window("gallery").is_some() {
        return on_main(app, reveal_gallery_if_ready).await;
    }
    if app
        .state::<AnchorState>()
        .gallery_creating
        .swap(true, Ordering::SeqCst)
    {
        return Ok(());
    }
    let session = uuid::Uuid::new_v4().to_string();
    let result = async {
        *app.state::<AnchorState>()
            .gallery
            .lock()
            .map_err(|_| "图库状态不可用")? = GalleryLifecycle {
            session: Some(session.clone()),
            ..Default::default()
        };
        // WebView2 must be created from the async command worker, not a synchronous IPC handler.
        let w = WebviewWindowBuilder::new(
            &app,
            "gallery",
            WebviewUrl::App(format!("index.html?view=gallery&session={session}").into()),
        )
        .title("Snapline · 全屏图库")
        .inner_size(1200.0, 800.0)
        .decorations(false)
        .transparent(false)
        .background_color(tauri::utils::config::Color(18, 20, 25, 255))
        .shadow(false)
        .resizable(false)
        .focused(false)
        .visible(false)
        .build()
        .map_err(|e| e.to_string())?;
        w.on_window_event({
            let app = app.clone();
            let session = session.clone();
            move |event| {
                if matches!(event, tauri::WindowEvent::Destroyed) {
                    clear_gallery(&app, &session);
                }
            }
        });
        let session = session.clone();
        on_main(app.clone(), move |app| {
            if !app
                .state::<AnchorState>()
                .gallery
                .lock()
                .map_err(|_| "图库状态不可用")?
                .matches(&session)
            {
                return Ok(());
            }
            let settings = lock(&app.state::<AppState>())?
                .settings
                .shelf_anchor
                .clone();
            let (m, _) = placement(&w, &settings)?;
            native::set_capture_transitions(&w, true)?;
            w.set_position(*m.position()).map_err(|e| e.to_string())?;
            w.set_size(*m.size()).map_err(|e| e.to_string())?;
            w.set_fullscreen_on_monitor(PhysicalPosition::new(
                f64::from(m.position().x),
                f64::from(m.position().y),
            ))
            .map_err(|e| e.to_string())?;
            app.state::<AnchorState>()
                .gallery
                .lock()
                .map_err(|_| "图库状态不可用")?
                .prepared = true;
            reveal_gallery_if_ready(app)
        })
        .await
    }
    .await;
    if result.is_err() {
        let _ = on_main(app.clone(), move |app| {
            let current = app
                .state::<AnchorState>()
                .gallery
                .lock()
                .map(|state| state.matches(&session))
                .unwrap_or(false);
            if current {
                if let Some(w) = app.get_webview_window("gallery") {
                    let _ = w.destroy();
                }
                clear_gallery(app, &session);
            }
            Ok(())
        })
        .await;
    }
    app.state::<AnchorState>()
        .gallery_creating
        .store(false, Ordering::SeqCst);
    result
}
#[tauri::command]
pub async fn gallery_ready(app: AppHandle, window: WebviewWindow, session: String) -> Result<()> {
    if window.label() != "gallery" {
        return Err("图库窗口无效".into());
    }
    on_main(app, move |app| {
        {
            let state = app.state::<AnchorState>();
            let mut gallery = state.gallery.lock().map_err(|_| "图库状态不可用")?;
            if !gallery.matches(&session) {
                return Ok(());
            }
            gallery.frontend_ready = true;
        }
        reveal_gallery_if_ready(app)
    })
    .await
}
#[tauri::command]
pub async fn close_gallery(app: AppHandle, session: String) -> Result<()> {
    on_main(app, move |app| {
        if !app
            .state::<AnchorState>()
            .gallery
            .lock()
            .map_err(|_| "图库状态不可用")?
            .matches(&session)
        {
            return Ok(());
        }
        if let Some(w) = app.get_webview_window("gallery") {
            w.destroy().map_err(|e| e.to_string())?;
        }
        clear_gallery(app, &session);
        Ok(())
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    const PET_RANGE: (f64, f64) = (31.0 / WIDTH, 127.0 / WIDTH);
    #[test]
    fn hover_handshake_defaults_disabled_and_rejects_invalid_or_stale_bounds() {
        let rect = DesktopRect {
            x: -1200,
            y: -300,
            width: 168,
            height: 42,
        };
        let pet = (rect.x + 80, rect.y + 20);
        let now = Instant::now();
        let mut runtime = Runtime::default();
        assert!(!runtime.poll_hover(rect, pet, false, now, 2000));
        assert!(!runtime.poll_hover(rect, pet, false, now + Duration::from_secs(3), 5000));
        runtime.set_hover_range(PET_RANGE.0, PET_RANGE.1).unwrap();
        assert!(!runtime.poll_hover(rect, pet, false, now, 2000));
        // A resized/layout-replaced button cannot inherit the old dwell.
        runtime.set_hover_range(40.0 / WIDTH, PET_RANGE.1).unwrap();
        assert!(!runtime.poll_hover(rect, pet, false, now + Duration::from_millis(400), 2400));
        for (start, end) in [
            (f64::NAN, 1.0),
            (0.0, f64::INFINITY),
            (-0.1, 0.5),
            (0.2, 1.1),
            (0.5, 0.5),
            (0.8, 0.2),
        ] {
            assert!(runtime.set_hover_range(start, end).is_err());
            assert_eq!(runtime.hover_range, (0.0, 0.0));
            assert!(runtime.hover.is_none());
            assert!(!runtime.poll_hover(rect, pet, false, now + Duration::from_secs(3), 5000));
        }
    }
    #[test]
    fn grip_hover_and_short_press_do_not_open_but_direct_move_to_pet_can() {
        let rect = DesktopRect {
            x: -1200,
            y: -300,
            width: 168,
            height: 42,
        };
        let grip = (rect.x + 18, rect.y + 20);
        let pet = (rect.x + 80, rect.y + 20);
        let now = Instant::now();
        let mut runtime = Runtime::default();
        runtime.set_hover_range(PET_RANGE.0, PET_RANGE.1).unwrap();
        assert!(!runtime.poll_hover(rect, pet, false, now, 2000));
        assert!(!runtime.poll_hover(rect, grip, false, now + Duration::from_secs(1), 3000));
        assert!(!runtime.poll_hover(rect, grip, true, now + Duration::from_secs(2), 4000));
        runtime.complete_drag_hover(false, 5000);
        assert!(!runtime.require_hover_exit); // A plain grip press is not a drag.
        assert_eq!(runtime.suppress_hover_until, 0);
        assert!(!runtime.poll_hover(rect, pet, false, now + Duration::from_secs(3), 5000));
        assert!(!runtime.poll_hover(rect, pet, false, now + Duration::from_millis(3349), 5349));
        assert!(runtime.poll_hover(rect, pet, false, now + Duration::from_millis(3350), 5350));
    }
    #[test]
    fn moved_drag_or_keyboard_reposition_requires_exit_even_after_time_limit() {
        let rect = DesktopRect {
            x: -1200,
            y: -300,
            width: 168,
            height: 42,
        };
        let grip = (rect.x + 18, rect.y + 20);
        let pet = (rect.x + 80, rect.y + 20);
        let now = Instant::now();
        let mut runtime = Runtime::default();
        runtime.set_hover_range(PET_RANGE.0, PET_RANGE.1).unwrap();
        runtime.complete_drag_hover(true, 0);
        assert_eq!(runtime.suppress_hover_until, 900);
        for cursor in [grip, pet, grip, pet] {
            runtime.observe_hover_exit(rect, cursor);
            assert!(!runtime.poll_hover(rect, cursor, false, now + Duration::from_secs(5), 5000));
            assert!(runtime.require_hover_exit);
        }
        runtime.observe_hover_exit(rect, (rect.x, rect.y - 1));
        assert!(!runtime.require_hover_exit);
        assert!(!runtime.poll_hover(rect, pet, false, now + Duration::from_secs(6), 6000));
        assert!(runtime.poll_hover(rect, pet, false, now + Duration::from_millis(6350), 6350));
    }
    #[test]
    fn hover_ignores_transparent_capsule_corners_without_expanding_gallery_hotspot() {
        for scale in [1.0_f64, 1.25, 1.5, 2.0] {
            let rect = geometry(
                DesktopRect {
                    x: -2560,
                    y: -720,
                    width: 2560,
                    height: 1440,
                },
                scale,
                0.5,
            );
            let range = (4.0 / WIDTH, 124.0 / WIDTH);
            assert!(!hover_contains(
                rect,
                range,
                (rect.x + (5.0 * scale) as i32, rect.y)
            ));
            assert!(hover_contains(
                rect,
                range,
                (rect.x + (WIDTH * scale / 2.0) as i32, rect.y)
            ));
            assert!(!hover_contains(
                rect,
                range,
                (rect.x + rect.width as i32 - 1, rect.y)
            ));
            assert!(!hover_contains(
                rect,
                range,
                (
                    rect.x + (150.0 * scale) as i32,
                    rect.y + rect.height as i32 / 2
                )
            ));
        }
    }
    #[cfg(windows)]
    #[test]
    fn native_hit_region_preserves_css_alpha_fringe_at_supported_dpi_scales() {
        use windows_sys::Win32::Graphics::Gdi::{
            CreateRoundRectRgn, DeleteObject, GetRgnBox, PtInRegion,
        };
        struct Region(windows_sys::Win32::Graphics::Gdi::HRGN);
        impl Drop for Region {
            fn drop(&mut self) {
                unsafe {
                    DeleteObject(self.0);
                }
            }
        }
        let mut legacy_clipped_pixels = 0;
        for scale in [1.0_f64, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0] {
            let width = (WIDTH * scale).round() as u32;
            let height = (HEIGHT * scale).round() as u32;
            let radius = f64::from(height) / 2.0;
            let region = Region(capsule_hit_region(width, height, radius).unwrap());
            let legacy = Region(unsafe {
                CreateRoundRectRgn(
                    0,
                    0,
                    width as i32 + 1,
                    height as i32 + 1,
                    height as i32,
                    height as i32,
                )
            });
            assert!(!legacy.0.is_null());
            let mut bounds = windows_sys::Win32::Foundation::RECT {
                left: 0,
                top: 0,
                right: 0,
                bottom: 0,
            };
            assert_ne!(unsafe { GetRgnBox(region.0, &mut bounds) }, 0);
            assert_eq!(
                (bounds.left, bounds.top, bounds.right, bounds.bottom),
                (0, 0, width as i32, height as i32)
            );
            for y in 0..height {
                for x in 0..width {
                    // Conservatively include a full physical pixel outside the
                    // ideal CSS contour, covering all partial-alpha edge pixels.
                    let px = f64::from(x) + 0.5;
                    let py = f64::from(y) + 0.5;
                    let center_x = px.clamp(radius, f64::from(width) - radius);
                    let distance = (px - center_x).hypot(py - radius) - radius;
                    if distance <= 1.0 {
                        assert_ne!(
                            unsafe { PtInRegion(region.0, x as i32, y as i32) },
                            0,
                            "alpha fringe clipped at scale {scale}, pixel ({x}, {y})"
                        );
                        if unsafe { PtInRegion(legacy.0, x as i32, y as i32) } == 0 {
                            legacy_clipped_pixels += 1;
                        }
                    }
                }
            }
            // Keep far transparent corners and every pixel outside the HWND
            // transparent to input; only the narrow guard band is added.
            for (x, y) in [
                (0, 0),
                (width as i32 - 1, 0),
                (0, height as i32 - 1),
                (width as i32 - 1, height as i32 - 1),
                (-1, height as i32 / 2),
                (width as i32, height as i32 / 2),
            ] {
                assert_eq!(unsafe { PtInRegion(region.0, x, y) }, 0);
            }
        }
        assert!(
            legacy_clipped_pixels > 0,
            "regression must exercise the previous hard clipping"
        );
    }
    #[cfg(windows)]
    #[test]
    fn native_hit_region_clamps_tiny_windows_and_rejects_invalid_geometry() {
        use windows_sys::Win32::Graphics::Gdi::{DeleteObject, GetRgnBox};
        for (width, height) in [(1, 1), (2, 1), (40, 10)] {
            let region = capsule_hit_region(width, height, f64::from(height) / 2.0).unwrap();
            let mut bounds = windows_sys::Win32::Foundation::RECT {
                left: 0,
                top: 0,
                right: 0,
                bottom: 0,
            };
            let kind = unsafe { GetRgnBox(region, &mut bounds) };
            unsafe {
                DeleteObject(region);
            }
            assert_ne!(kind, 0);
            assert_eq!(
                (bounds.left, bounds.top, bounds.right, bounds.bottom),
                (0, 0, width as i32, height as i32)
            );
        }
        for (width, height, radius) in [
            (0, 42, 21.0),
            (168, 0, 21.0),
            (u32::MAX, 42, 21.0),
            (168, 42, f64::NAN),
            (168, 42, -1.0),
        ] {
            assert!(capsule_hit_region(width, height, radius).is_err());
        }
    }
    #[test]
    fn first_paint_is_required_before_entry_handoff_or_input_activation() {
        let mut state = ShelfLifecycle::default();
        state.change(ShelfPhase::Preparing, Some(Duration::from_secs(2)));
        let token = state.token;
        state.phase = ShelfPhase::Opening; // The native HWND is now visible.
        assert!(state.anchor_pending);
        assert!(!state.can_finish_open(token)); // A ready/opened ACK is not paint evidence.
        assert!(state.mark_painted(token));
        assert!(!state.anchor_pending);
        assert!(state.can_finish_open(token));
        state.phase = ShelfPhase::Open;
        assert!(!state.mark_painted(token)); // Duplicate paint cannot repeat a handoff.
    }
    #[test]
    fn late_paint_after_capture_close_or_reopen_cannot_hide_new_entry() {
        let mut state = ShelfLifecycle::default();
        state.change(ShelfPhase::Preparing, None);
        let old = state.token;
        state.phase = ShelfPhase::Opening;
        state.change(ShelfPhase::Closing, None);
        assert!(!state.mark_painted(old));
        state.change(ShelfPhase::Opening, None);
        assert!(state.anchor_pending);
        assert!(!state.mark_painted(old));
        let current = state.token;
        state.change(ShelfPhase::Hidden, None); // Capture/gallery cancellation.
        assert!(!state.mark_painted(current));
        state.change(ShelfPhase::Preparing, None);
        state.phase = ShelfPhase::Opening;
        assert!(!state.mark_painted(current));
        assert!(state.anchor_pending);
    }
    #[test]
    fn reversing_a_painted_shelf_waits_for_new_paint_without_flashing_entry() {
        let mut state = ShelfLifecycle::default();
        state.change(ShelfPhase::Preparing, None);
        state.phase = ShelfPhase::Opening;
        let old = state.token;
        assert!(state.mark_painted(old));
        state.phase = ShelfPhase::Open;
        state.change(ShelfPhase::Closing, None);
        state.change(ShelfPhase::Opening, None);
        assert!(!state.anchor_pending);
        assert!(!state.can_finish_open(state.token));
        assert!(!state.mark_painted(old));
        assert!(state.mark_painted(state.token));
        assert!(state.can_finish_open(state.token));
    }
    #[test]
    fn explicit_close_stays_closed_until_pointer_leaves_compact_island() {
        let rect = DesktopRect {
            x: 1200,
            y: 12,
            width: 168,
            height: 42,
        };
        let mut runtime = Runtime {
            require_hover_exit: true,
            ..Default::default()
        };
        runtime.observe_hover_exit(rect, (1280, 30));
        assert!(runtime.require_hover_exit);
        runtime.observe_hover_exit(rect, (1367, 53));
        assert!(runtime.require_hover_exit);
        runtime.observe_hover_exit(rect, (1368, 53));
        assert!(!runtime.require_hover_exit);
    }
    #[test]
    fn expanded_clothesline_covers_monitor_width_at_every_anchor_position_and_scale() {
        for scale in [1.0, 1.25, 1.5, 2.0] {
            for area in [
                DesktopRect {
                    x: -2560,
                    y: -720,
                    width: 2560,
                    height: 1440,
                },
                DesktopRect {
                    x: 1920,
                    y: 200,
                    width: 800,
                    height: 600,
                },
                DesktopRect {
                    x: 0,
                    y: 0,
                    width: 40,
                    height: 10,
                },
            ] {
                for ratio in [0.0, 0.25, 0.5, 0.75, 1.0] {
                    let compact = geometry(area, scale, ratio);
                    let (expanded, origin) = expanded_geometry(area, scale, compact);
                    assert!(expanded.crop_inside(area).is_some());
                    assert!(compact.crop_inside(expanded).is_some());
                    assert!(origin.x >= 0.0 && origin.y >= 0.0);
                    assert_eq!((origin.x * scale).round() as i32, compact.x - expanded.x);
                    assert_eq!((origin.y * scale).round() as i32, compact.y - expanded.y);
                    assert_eq!(expanded.width, area.width);
                    assert_eq!(expanded.x, area.x);
                    assert_eq!(expanded.y, area.y);
                    assert_eq!(
                        expanded.height,
                        ((250.0 * scale).round() as u32).min(area.height)
                    );
                }
            }
        }
    }
    #[test]
    fn cancelled_prepare_ack_cannot_reopen_during_capture_or_gallery() {
        let mut state = ShelfLifecycle::default();
        state.change(ShelfPhase::Preparing, Some(Duration::from_secs(2)));
        let old = state.message("prepare");
        assert!(state.matches(old.token, ShelfPhase::Preparing));
        state.change(ShelfPhase::Hidden, None);
        assert!(!state.matches(old.token, ShelfPhase::Preparing));
        state.change(ShelfPhase::Preparing, Some(Duration::from_secs(2)));
        assert!(!state.matches(old.token, ShelfPhase::Preparing));
        assert!(state.matches(state.token, ShelfPhase::Preparing));
    }
    #[test]
    fn interrupted_close_rejects_old_completion_and_preserves_new_open() {
        let mut state = ShelfLifecycle::default();
        state.change(ShelfPhase::Closing, Some(Duration::from_millis(650)));
        let closing = state.message("close");
        state.change(ShelfPhase::Opening, Some(Duration::from_millis(650)));
        let reopened = state.message("open");
        assert!(reopened.token > closing.token);
        assert!(!state.matches(closing.token, ShelfPhase::Closing));
        assert!(!state.matches(reopened.token, ShelfPhase::Preparing));
        assert!(state.matches(reopened.token, ShelfPhase::Opening));
        state.phase = ShelfPhase::Open;
        assert!(!state.matches(closing.token, ShelfPhase::Closing));
    }
    #[test]
    fn fast_drag_reconstructs_pointerdown_even_when_begin_ipc_arrives_after_release() {
        for scale in [1.0, 1.25, 1.5, 2.0] {
            let area = DesktopRect {
                x: -2560,
                y: -720,
                width: 2560,
                height: 1440,
            };
            let before = geometry(area, scale, 0.5);
            let mut drag = Drag::from_local(before, 10.0 / WIDTH, 10.0 / HEIGHT).unwrap();
            let released_cursor = (drag.start.0 + (40.0 * scale).round() as i32, drag.start.1);
            // No pointermove or native sampling happened before this release.
            drag.observe(released_cursor);
            assert!(drag.moved);
            let after = geometry(
                area,
                scale,
                cursor_ratio(area, scale, before.width, released_cursor.0, drag.fraction),
            );
            assert_eq!(after.x - before.x, (40.0 * scale).round() as i32);
            assert_eq!(after.y, before.y);
        }
    }
    #[test]
    fn only_pet_hover_reveals_shelf_excluding_grip_gallery_and_exact_boundaries() {
        for scale in [1.0, 1.25, 1.5, 2.0] {
            let rect = geometry(
                DesktopRect {
                    x: -2560,
                    y: 0,
                    width: 2560,
                    height: 1440,
                },
                scale,
                0.5,
            );
            // The reported PET button bounds: 7px padding + 24px fixed grip,
            // ending before the gallery's 2px gap and 34px fixed button.
            let range = PET_RANGE;
            let middle_y = rect.y + rect.height as i32 / 2;
            let left = f64::from(rect.x) + f64::from(rect.width) * range.0;
            let right = f64::from(rect.x) + f64::from(rect.width) * range.1;
            for x in rect.x..rect.x + rect.width as i32 {
                assert_eq!(
                    hover_contains(rect, range, (x, middle_y)),
                    f64::from(x) >= left && f64::from(x) < right
                );
            }
            assert!(hover_contains(
                rect,
                range,
                (rect.x + (40.0 * scale) as i32, rect.y + 10)
            ));
            assert!(!hover_contains(
                rect,
                range,
                (rect.x + (150.0 * scale) as i32, rect.y + 10)
            ));
            assert!(!hover_contains(rect, range, (rect.x, 0)));
            assert!(!hover_contains(rect, (0.0, 1.0), (rect.x, rect.y)));
            assert!(!hover_contains(
                rect,
                (0.0, 1.0),
                (rect.x + rect.width as i32 - 1, rect.y)
            ));
        }
    }
    #[test]
    fn gallery_ready_waits_for_capture_and_rejects_previous_window_messages() {
        let mut state = GalleryLifecycle {
            session: Some("first".into()),
            frontend_ready: true,
            prepared: false,
        };
        assert!(!state.can_show(false));
        state.prepared = true;
        assert!(!state.can_show(true));
        assert!(state.can_show(false)); // The watcher retries when capture restoration completes.
        state = GalleryLifecycle {
            session: Some("second".into()),
            ..Default::default()
        };
        assert!(!state.matches("first"));
        assert!(state.matches("second"));
        assert!(!state.can_show(false));
        state = GalleryLifecycle::default();
        assert!(!state.matches("second"));
    }
    #[test]
    fn monitor_identity_survives_reorder_and_removed_monitor_uses_primary() {
        let names = [Some("DISPLAY2"), Some("DISPLAY1")];
        assert_eq!(
            preferred_monitor_index(&names, Some("DISPLAY2"), Some(1)),
            Some(0)
        );
        assert_eq!(
            preferred_monitor_index(&names, Some("removed"), Some(1)),
            Some(1)
        );
        assert_eq!(preferred_monitor_index(&names, None, None), Some(0));
        assert_eq!(preferred_monitor_index(&[], Some("removed"), Some(0)), None);
    }
    #[test]
    fn normalized_position_keeps_entry_on_negative_origin_mixed_dpi_monitors() {
        for scale in [1.0, 1.25, 1.5, 2.0] {
            let area = DesktopRect {
                x: -2560,
                y: -720,
                width: 2560,
                height: 1440,
            };
            for ratio in [0.0, 0.25, 0.5, 1.0] {
                let rect = geometry(area, scale, ratio);
                assert_eq!(rect.y, area.y + (GAP * scale).round() as i32);
                assert!(area.contains((rect.x, rect.y)));
                assert!(area.contains((
                    rect.x + rect.width as i32 - 1,
                    rect.y + rect.height as i32 - 1
                )));
                assert!(
                    (cursor_ratio(area, scale, rect.width, rect.x, 0.0) - ratio).abs() < 0.0005
                );
            }
        }
    }
    #[test]
    fn activation_is_only_entry_rectangle_not_whole_top_edge() {
        let rect = geometry(
            DesktopRect {
                x: 0,
                y: 0,
                width: 2560,
                height: 1440,
            },
            1.5,
            0.5,
        );
        assert!(rect.contains((rect.x, rect.y)));
        assert!(rect.contains((
            rect.x + rect.width as i32 - 1,
            rect.y + rect.height as i32 - 1
        )));
        for point in [
            (0, 0),
            (2559, 0),
            (rect.x - 1, 0),
            (rect.x + rect.width as i32, 0),
            (rect.x, rect.y + rect.height as i32),
        ] {
            assert!(!rect.contains(point));
        }
    }
    #[test]
    fn extreme_offsets_and_invalid_settings_clamp_safely() {
        let area = DesktopRect {
            x: -1920,
            y: 120,
            width: 1920,
            height: 1080,
        };
        assert_eq!(cursor_ratio(area, 1.0, 168, i32::MIN, 0.5), 0.0);
        assert_eq!(cursor_ratio(area, 1.0, 168, i32::MAX, 0.5), 1.0);
        assert_eq!(geometry(area, 1.0, f64::NAN), geometry(area, 1.0, 0.5));
        let tiny = DesktopRect {
            x: 0,
            y: 0,
            width: 40,
            height: 10,
        };
        assert_eq!(geometry(tiny, 2.0, 0.0), tiny);
    }
}
