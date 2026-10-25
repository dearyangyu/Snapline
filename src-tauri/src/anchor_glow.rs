//! Passive outer light. The existing 168x42 anchor keeps all input and geometry.
use crate::{desktop_geometry::DesktopRect, library::Result, native, shelf_anchor, AppState};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

const PADDING: f64 = 44.0;
#[derive(Default)]
struct GlowState {
    token: AtomicU64,
    ready: AtomicBool,
}
pub fn initialize(app: &AppHandle) {
    app.manage(GlowState::default());
}

fn geometry(anchor: DesktopRect, scale: f64) -> DesktopRect {
    let scale = if scale.is_finite() && scale > 0.0 {
        scale
    } else {
        1.0
    };
    let padding = (PADDING * scale).round() as u32;
    DesktopRect {
        x: (i64::from(anchor.x) - i64::from(padding))
            .clamp(i64::from(i32::MIN), i64::from(i32::MAX)) as i32,
        y: (i64::from(anchor.y) - i64::from(padding))
            .clamp(i64::from(i32::MIN), i64::from(i32::MAX)) as i32,
        width: anchor.width.saturating_add(padding.saturating_mul(2)),
        height: anchor.height.saturating_add(padding.saturating_mul(2)),
    }
}
fn can_show(anchor_visible: bool, ready: bool, capture_active: bool) -> bool {
    anchor_visible && ready && !capture_active
}

pub fn create(app: &AppHandle) -> Result<()> {
    let state = app.state::<GlowState>();
    let token = state.token.fetch_add(1, Ordering::SeqCst) + 1;
    state.ready.store(false, Ordering::SeqCst);
    let window = WebviewWindowBuilder::new(
        app,
        "anchor-glow",
        WebviewUrl::App(format!("index.html?view=anchor-glow&token={token}").into()),
    )
    .title("Snapline · 入口光晕")
    .inner_size(256.0, 130.0)
    .min_inner_size(1.0, 1.0)
    .decorations(false)
    .transparent(true)
    .shadow(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .resizable(false)
    .focused(false)
    .focusable(false)
    .visible(false)
    .build()
    .map_err(|error| error.to_string())?;
    // Initialize Tao's ignore flag while still hidden; subsequent native updates
    // preserve it and never call a Tao mutator that reapplies cached visibility.
    window
        .set_ignore_cursor_events(true)
        .map_err(|error| error.to_string())?;
    configure(&window)?;
    native::set_capture_transitions(&window, true)?;
    Ok(())
}

#[cfg(windows)]
fn configure(window: &WebviewWindow) -> Result<()> {
    use windows_sys::Win32::{
        Foundation::{GetLastError, SetLastError},
        UI::WindowsAndMessaging::{
            GetWindowLongPtrW, SetWindowLongPtrW, GWL_EXSTYLE, WS_EX_LAYERED, WS_EX_NOACTIVATE,
            WS_EX_TOOLWINDOW, WS_EX_TRANSPARENT,
        },
    };
    let hwnd = window.hwnd().map_err(|error| error.to_string())?.0;
    unsafe {
        SetLastError(0);
        let previous = GetWindowLongPtrW(hwnd as _, GWL_EXSTYLE);
        if previous == 0 && GetLastError() != 0 {
            return Err("无法读取入口光晕样式".into());
        }
        let next = previous
            | (WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW) as isize;
        if previous != next {
            SetLastError(0);
            if SetWindowLongPtrW(hwnd as _, GWL_EXSTYLE, next) == 0 && GetLastError() != 0 {
                return Err("无法设置入口光晕穿透".into());
            }
        }
    }
    Ok(())
}
#[cfg(not(windows))]
fn configure(_window: &WebviewWindow) -> Result<()> {
    Ok(())
}

fn behind(anchor: &WebviewWindow, glow: &WebviewWindow) -> Result<()> {
    #[cfg(windows)]
    {
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            GetWindow, SetWindowPos, GW_HWNDPREV, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE,
        };
        let anchor = anchor.hwnd().map_err(|e| e.to_string())?.0;
        let glow = glow.hwnd().map_err(|e| e.to_string())?.0;
        unsafe {
            if !std::ptr::eq(GetWindow(glow as _, GW_HWNDPREV), anchor)
                && SetWindowPos(
                    glow as _,
                    anchor as _,
                    0,
                    0,
                    0,
                    0,
                    SWP_NOACTIVATE | SWP_NOMOVE | SWP_NOSIZE,
                ) == 0
            {
                return Err("无法排列入口光晕".into());
            }
        }
    }
    #[cfg(not(windows))]
    let _ = (anchor, glow);
    Ok(())
}

pub fn position(anchor: &WebviewWindow, rect: DesktopRect) -> Result<()> {
    let Some(glow) = anchor.app_handle().get_webview_window("anchor-glow") else {
        return Ok(());
    };
    let target = geometry(rect, anchor.scale_factor().map_err(|e| e.to_string())?);
    let position = glow.inner_position().map_err(|e| e.to_string())?;
    let size = glow.inner_size().map_err(|e| e.to_string())?;
    if position.x != target.x
        || position.y != target.y
        || size.width != target.width
        || size.height != target.height
    {
        shelf_anchor::apply(&glow, target)?;
    }
    configure(&glow)?;
    behind(anchor, &glow)
}
pub fn hide(app: &AppHandle) -> Result<()> {
    if let Some(window) = app.get_webview_window("anchor-glow") {
        shelf_anchor::set_visible_native(&window, false)?;
    }
    Ok(())
}
pub fn sync(app: &AppHandle) -> Result<()> {
    // Capture preparation owns hiding; a watcher must not race its snapshot.
    if app
        .state::<AppState>()
        .capture_active
        .load(Ordering::SeqCst)
    {
        return Ok(());
    }
    let Some(anchor) = app.get_webview_window("anchor") else {
        return hide(app);
    };
    let Some(glow) = app.get_webview_window("anchor-glow") else {
        return Ok(());
    };
    let visible = can_show(
        anchor.is_visible().unwrap_or(false),
        app.state::<GlowState>().ready.load(Ordering::SeqCst),
        app.state::<AppState>()
            .capture_active
            .load(Ordering::SeqCst),
    );
    if !visible {
        return hide(app);
    }
    let p = anchor.inner_position().map_err(|e| e.to_string())?;
    let s = anchor.inner_size().map_err(|e| e.to_string())?;
    if let Err(error) = position(
        &anchor,
        DesktopRect {
            x: p.x,
            y: p.y,
            width: s.width,
            height: s.height,
        },
    ) {
        let _ = hide(app);
        return Err(error);
    }
    if !glow.is_visible().unwrap_or(false) {
        shelf_anchor::set_visible_native(&glow, true)?;
    }
    behind(&anchor, &glow)
}

#[tauri::command]
pub async fn anchor_glow_ready(app: AppHandle, window: WebviewWindow, token: u64) -> Result<()> {
    if window.label() != "anchor-glow" {
        return Err("光晕窗口无效".into());
    }
    shelf_anchor::on_main(app, move |app| {
        let state = app.state::<GlowState>();
        if state.token.load(Ordering::SeqCst) != token {
            return Ok(());
        }
        state.ready.store(true, Ordering::SeqCst);
        sync(app)
    })
    .await
}
#[tauri::command]
pub fn anchor_visual_visible(app: AppHandle, window: WebviewWindow) -> Result<bool> {
    if window.label() != "anchor" {
        return Err("入口窗口无效".into());
    }
    Ok(app
        .get_webview_window("anchor")
        .is_some_and(|w| w.is_visible().unwrap_or(false)))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn halo_padding_does_not_change_visual_anchor_or_monitor_ratio() {
        for scale in [1.0_f64, 1.25, 1.5, 2.0] {
            let anchor = DesktopRect {
                x: -1800,
                y: 12,
                width: (168.0 * scale).round() as u32,
                height: (42.0 * scale).round() as u32,
            };
            let outer = geometry(anchor, scale);
            let pad = (44.0 * scale).round() as i32;
            assert_eq!((outer.x + pad, outer.y + pad), (anchor.x, anchor.y));
            assert_eq!(outer.width - 2 * pad as u32, anchor.width);
            assert_eq!(outer.height - 2 * pad as u32, anchor.height);
        }
    }
    #[test]
    fn capture_and_hidden_anchor_always_suppress_ready_halo() {
        assert!(can_show(true, true, false));
        assert!(!can_show(true, true, true));
        assert!(!can_show(false, true, false));
        assert!(!can_show(true, false, false));
    }
}
