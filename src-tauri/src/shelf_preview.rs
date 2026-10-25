//! Temporary hover preview. The native session is authoritative over late WebView
//! decoding/ready messages; closing never opens or activates the main library.
use crate::{
    library::{Capture, Result},
    lock, native, shelf_anchor, AppState,
};
use serde::Serialize;
use std::{
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Mutex,
    },
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewSession {
    session_id: u64,
    item: Capture,
}
#[derive(Default)]
struct Lifecycle {
    session: Option<PreviewSession>,
    prepared: bool,
    ready: bool,
    confirmed: bool,
    shown: bool,
    explicit: bool,
    foreground: Option<usize>,
    deadline: Option<Instant>,
    ignore_escape_until_released: bool,
}
impl Lifecycle {
    fn escape_dismisses(&mut self, pressed: bool) -> bool {
        if !pressed {
            self.ignore_escape_until_released = false;
        }
        pressed && !self.ignore_escape_until_released
    }
    fn matches(&self, id: u64) -> bool {
        self.session
            .as_ref()
            .is_some_and(|session| session.session_id == id)
    }
    fn acknowledge(&mut self, id: u64) -> bool {
        if !self.matches(id) {
            return false;
        }
        self.ready = true;
        true
    }
    fn confirm(&mut self, id: u64) -> bool {
        if !self.matches(id) {
            return false;
        }
        self.confirmed = true;
        true
    }
    fn can_show(&self, permitted: bool) -> bool {
        self.session.is_some()
            && self.prepared
            && self.ready
            && self.confirmed
            && !self.shown
            && permitted
    }
    fn clear(&mut self, id: u64) -> bool {
        if !self.matches(id) {
            return false;
        }
        *self = Self::default();
        true
    }
}
#[derive(Default)]
pub struct PreviewState {
    lifecycle: Mutex<Lifecycle>,
    creating: AtomicBool,
    next: AtomicU64,
}
pub fn initialize(app: &AppHandle) {
    app.manage(PreviewState::default());
}
pub fn is_active(app: &AppHandle) -> bool {
    app.state::<PreviewState>()
        .lifecycle
        .lock()
        .map(|s| s.session.is_some())
        .unwrap_or(false)
}
pub fn preserve_for_capture(app: &AppHandle) {
    if let Ok(mut lifecycle) = app.state::<PreviewState>().lifecycle.lock() {
        // Esc belongs to the capture overlay until the key is released. It must
        // not also dismiss the unchanged preview on the first watcher tick.
        lifecycle.ignore_escape_until_released = true;
    }
}
#[cfg(windows)]
fn foreground() -> Option<usize> {
    let handle = unsafe { windows_sys::Win32::UI::WindowsAndMessaging::GetForegroundWindow() };
    (!handle.is_null()).then_some(handle as usize)
}
#[cfg(not(windows))]
fn foreground() -> Option<usize> {
    None
}
fn foreign_foreground(app: &AppHandle, previous: Option<usize>) -> bool {
    let current = foreground();
    if current.is_none() || current == previous {
        return false;
    }
    #[cfg(windows)]
    return current
        != app
            .get_webview_window("shelf-preview")
            .and_then(|w| w.hwnd().ok())
            .map(|hwnd| hwnd.0 as usize);
    #[cfg(not(windows))]
    {
        let _ = app;
        false
    }
}
fn permitted(app: &AppHandle, item_id: &str, require_hover: bool, explicit: bool) -> bool {
    let state = app.state::<AppState>();
    if state.capture_active.load(Ordering::SeqCst)
        || state.dragging.load(Ordering::SeqCst)
        || app.get_webview_window("gallery").is_some()
        || !shelf_anchor::is_interactive(app)
    {
        return false;
    }
    let Ok(lib) = lock(&state) else {
        return false;
    };
    if (!lib.settings.shelf_hover_preview && !explicit)
        || !lib
            .items
            .iter()
            .any(|item| item.id == item_id && !item.shelf_hidden && item.kind == "image")
    {
        return false;
    }
    drop(lib);
    if !require_hover {
        return true;
    }
    #[cfg(windows)]
    if unsafe { windows_sys::Win32::UI::Input::KeyboardAndMouse::GetAsyncKeyState(1) } < 0 {
        return false;
    }
    let Some(shelf) = app.get_webview_window("shelf") else {
        return false;
    };
    shelf
        .outer_position()
        .ok()
        .zip(shelf.outer_size().ok())
        .zip(native::cursor())
        .is_some_and(|((position, size), cursor)| {
            crate::desktop_geometry::DesktopRect {
                x: position.x,
                y: position.y,
                width: size.width,
                height: size.height,
            }
            .contains(cursor)
        })
}
/// UI-thread only. Invalidating first prevents a queued ready/focus callback
/// from restoring a window which capture, gallery or another close removed.
pub fn close_now(app: &AppHandle, expected: Option<u64>) -> Result<()> {
    let id = {
        let state = app.state::<PreviewState>();
        let mut lifecycle = state.lifecycle.lock().map_err(|_| "预览状态不可用")?;
        let Some(id) = lifecycle.session.as_ref().map(|s| s.session_id) else {
            return Ok(());
        };
        if expected.is_some_and(|expected| expected != id) {
            return Ok(());
        }
        lifecycle.clear(id);
        id
    };
    if let Some(window) = app.get_webview_window("shelf-preview") {
        window.destroy().map_err(|e| e.to_string())?;
    }
    app.state::<AppState>()
        .shelf_until
        .store(crate::library::now_ms() + 600, Ordering::Relaxed);
    let _ = app.emit_to(
        "shelf",
        "shelf-preview-closed",
        serde_json::json!({"sessionId": id}),
    );
    Ok(())
}
pub async fn close(app: AppHandle) -> Result<()> {
    if !is_active(&app) {
        return Ok(());
    }
    shelf_anchor::on_main(app, |app| close_now(app, None)).await
}
fn reveal_ready(app: &AppHandle) -> Result<()> {
    let (session, explicit, shown, previous_foreground) = {
        let state = app.state::<PreviewState>();
        let lifecycle = state.lifecycle.lock().map_err(|_| "预览状态不可用")?;
        (
            lifecycle.session.clone(),
            lifecycle.explicit,
            lifecycle.shown,
            lifecycle.foreground,
        )
    };
    if shown {
        return Ok(());
    }
    let Some(session) = session else {
        return Ok(());
    };
    let allowed = permitted(app, &session.item.id, !explicit, explicit)
        && !foreign_foreground(app, previous_foreground);
    if !allowed {
        return close_now(app, Some(session.session_id));
    }
    {
        let state = app.state::<PreviewState>();
        let mut lifecycle = state.lifecycle.lock().map_err(|_| "预览状态不可用")?;
        if !lifecycle.matches(session.session_id) || !lifecycle.can_show(allowed) {
            return Ok(());
        }
        lifecycle.shown = true;
        lifecycle.deadline = None;
        lifecycle.foreground = foreground();
    }
    let display = (|| -> Result<()> {
        let window = app
            .get_webview_window("shelf-preview")
            .ok_or("预览窗口尚未就绪")?;
        native::set_capture_transitions(&window, true)?;
        if explicit {
            window.show().map_err(|e| e.to_string())?;
            window.set_focus().map_err(|e| e.to_string())?;
        } else {
            shelf_anchor::set_visible(&window, true)?;
        }
        Ok(())
    })();
    if let Err(error) = display {
        let _ = close_now(app, Some(session.session_id));
        return Err(error);
    }
    let _ = app.emit_to(
        "shelf",
        "shelf-preview-opened",
        serde_json::json!({"sessionId": session.session_id}),
    );
    Ok(())
}
/// Called by the existing UI-thread watcher, with no timers or background UI calls.
pub fn tick(app: &AppHandle) -> Result<bool> {
    let (session, shown, explicit, previous_foreground, expired) = {
        let state = app.state::<PreviewState>();
        let lifecycle = state.lifecycle.lock().map_err(|_| "预览状态不可用")?;
        (
            lifecycle.session.clone(),
            lifecycle.shown,
            lifecycle.explicit,
            lifecycle.foreground,
            lifecycle.deadline.is_some_and(|t| Instant::now() >= t),
        )
    };
    let Some(session) = session else {
        return Ok(false);
    };
    if app
        .state::<AppState>()
        .capture_active
        .load(Ordering::SeqCst)
    {
        return Ok(true);
    }
    #[cfg(windows)]
    let dismissed = {
        use windows_sys::Win32::UI::Input::KeyboardAndMouse::GetAsyncKeyState;
        let pressed = unsafe { GetAsyncKeyState(0x1b) } < 0;
        let escape = app
            .state::<PreviewState>()
            .lifecycle
            .lock()
            .map_err(|_| "预览状态不可用")?
            .escape_dismisses(pressed);
        escape || foreign_foreground(app, previous_foreground)
    };
    #[cfg(not(windows))]
    let dismissed = {
        let _ = previous_foreground;
        false
    };
    if expired || dismissed || !permitted(app, &session.item.id, !shown && !explicit, explicit) {
        close_now(app, Some(session.session_id))?;
        return Ok(false);
    }
    Ok(true)
}

#[tauri::command]
pub async fn show_shelf_preview(
    app: AppHandle,
    window: WebviewWindow,
    id: String,
    explicit: Option<bool>,
) -> Result<u64> {
    if window.label() != "shelf" {
        return Err("仅能从晾衣架打开悬停预览。".into());
    }
    let explicit = explicit.unwrap_or(false);
    if app
        .state::<PreviewState>()
        .creating
        .swap(true, Ordering::SeqCst)
    {
        return Err("预览正在准备。".into());
    }
    let result = async {
        let item_id = id.clone();
        let (session_id, monitor) = shelf_anchor::on_main(app.clone(), move |app| {
            if is_active(app) || !permitted(app, &item_id, !explicit, explicit) {
                return Err("本次悬停已结束。".into());
            }
            let shelf = app.get_webview_window("shelf").ok_or("晾衣架尚未就绪")?;
            let monitor = shelf
                .current_monitor()
                .map_err(|e| e.to_string())?
                .ok_or("显示器不可用")?;
            let item = lock(&app.state::<AppState>())?.item(&item_id)?;
            let state = app.state::<PreviewState>();
            let session_id = state.next.fetch_add(1, Ordering::SeqCst) + 1;
            *state.lifecycle.lock().map_err(|_| "预览状态不可用")? = Lifecycle {
                session: Some(PreviewSession { session_id, item }),
                deadline: Some(Instant::now() + Duration::from_secs(8)),
                explicit,
                foreground: foreground(),
                ..Default::default()
            };
            Ok((session_id, monitor))
        })
        .await?;
        let build = WebviewWindowBuilder::new(
            &app,
            "shelf-preview",
            WebviewUrl::App(format!("index.html?view=shelf-preview&session={session_id}").into()),
        )
        .title("Snapline · 临时预览")
        .inner_size(800.0, 600.0)
        .min_inner_size(1.0, 1.0)
        .decorations(false)
        .transparent(true)
        .background_color(tauri::utils::config::Color(0, 0, 0, 0))
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .focused(false)
        .visible(false)
        .build();
        let preview = match build {
            Ok(window) => window,
            Err(error) => {
                shelf_anchor::on_main(app.clone(), move |app| close_now(app, Some(session_id)))
                    .await?;
                return Err(error.to_string());
            }
        };
        preview.on_window_event({
            let app = app.clone();
            move |event| {
                if matches!(event, tauri::WindowEvent::Destroyed) {
                    if let Ok(mut lifecycle) = app.state::<PreviewState>().lifecycle.lock() {
                        lifecycle.clear(session_id);
                    }
                } else if matches!(event, tauri::WindowEvent::Focused(false))
                    && !app
                        .state::<AppState>()
                        .capture_active
                        .load(Ordering::SeqCst)
                {
                    let shown = app
                        .state::<PreviewState>()
                        .lifecycle
                        .lock()
                        .map(|s| s.matches(session_id) && s.shown)
                        .unwrap_or(false);
                    if shown {
                        let _ = close_now(&app, Some(session_id));
                    }
                }
            }
        });
        let configure = shelf_anchor::on_main(app.clone(), move |app| {
            let current = app
                .state::<PreviewState>()
                .lifecycle
                .lock()
                .map_err(|_| "预览状态不可用")?
                .matches(session_id);
            if !current || !permitted(app, &id, !explicit, explicit) {
                // A capture can cancel the session while WebView2 is building.
                let _ = preview.destroy();
                return close_now(app, Some(session_id));
            }
            native::set_capture_transitions(&preview, true)?;
            native::remove_pin_frame(&preview);
            preview
                .set_position(*monitor.position())
                .map_err(|e| e.to_string())?;
            preview
                .set_size(*monitor.size())
                .map_err(|e| e.to_string())?;
            preview
                .set_fullscreen_on_monitor(tauri::PhysicalPosition::new(
                    f64::from(monitor.position().x),
                    f64::from(monitor.position().y),
                ))
                .map_err(|e| e.to_string())?;
            app.state::<PreviewState>()
                .lifecycle
                .lock()
                .map_err(|_| "预览状态不可用")?
                .prepared = true;
            reveal_ready(app)
        })
        .await;
        if configure.is_err() {
            let _ = shelf_anchor::on_main(app.clone(), move |app| close_now(app, Some(session_id)))
                .await;
        }
        configure?;
        Ok(session_id)
    }
    .await;
    app.state::<PreviewState>()
        .creating
        .store(false, Ordering::SeqCst);
    result
}
#[tauri::command]
pub fn get_shelf_preview(
    window: WebviewWindow,
    state: State<'_, PreviewState>,
) -> Result<PreviewSession> {
    if window.label() != "shelf-preview" {
        return Err("预览窗口无效".into());
    }
    state
        .lifecycle
        .lock()
        .map_err(|_| "预览状态不可用")?
        .session
        .clone()
        .ok_or("预览已关闭".into())
}
#[tauri::command]
pub async fn shelf_preview_ready(
    app: AppHandle,
    window: WebviewWindow,
    session_id: u64,
) -> Result<()> {
    if window.label() != "shelf-preview" {
        return Err("预览窗口无效".into());
    }
    shelf_anchor::on_main(app, move |app| {
        if !app
            .state::<PreviewState>()
            .lifecycle
            .lock()
            .map_err(|_| "预览状态不可用")?
            .acknowledge(session_id)
        {
            return Ok(());
        }
        reveal_ready(app)
    })
    .await
}
#[tauri::command]
pub async fn confirm_shelf_preview(
    app: AppHandle,
    window: WebviewWindow,
    session_id: u64,
) -> Result<()> {
    if window.label() != "shelf" {
        return Err("预览来源窗口无效".into());
    }
    shelf_anchor::on_main(app, move |app| {
        {
            let state = app.state::<PreviewState>();
            let mut lifecycle = state.lifecycle.lock().map_err(|_| "预览状态不可用")?;
            if !lifecycle.confirm(session_id) {
                return Ok(());
            }
        }
        reveal_ready(app)
    })
    .await
}
#[tauri::command]
pub async fn close_shelf_preview(
    app: AppHandle,
    window: WebviewWindow,
    session_id: u64,
    only_if_pending: Option<bool>,
) -> Result<()> {
    if !["shelf", "shelf-preview"].contains(&window.label()) {
        return Err("预览窗口无效".into());
    }
    shelf_anchor::on_main(app, move |app| {
        if only_if_pending.unwrap_or(false)
            && app
                .state::<PreviewState>()
                .lifecycle
                .lock()
                .map_err(|_| "预览状态不可用")?
                .shown
        {
            return Ok(());
        }
        close_now(app, Some(session_id))
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn preserved_preview_ignores_capture_escape_until_release_then_accepts_new_escape() {
        let mut state = Lifecycle {
            ignore_escape_until_released: true,
            ..Default::default()
        };
        assert!(!state.escape_dismisses(true));
        assert!(!state.escape_dismisses(true));
        assert!(!state.escape_dismisses(false));
        assert!(state.escape_dismisses(true));
    }
    fn lifecycle(id: u64) -> Lifecycle {
        let item: Capture = serde_json::from_value(serde_json::json!({"id":"item","name":"a.png","path":"a.png","thumbnail":"","kind":"image","width":1,"height":1,"createdAt":0,"source":"import","pinned":false})).unwrap();
        Lifecycle {
            session: Some(PreviewSession {
                session_id: id,
                item,
            }),
            ..Default::default()
        }
    }
    #[test]
    fn ready_requires_matching_live_session_and_native_preparation() {
        let mut state = lifecycle(4);
        assert!(!state.acknowledge(3));
        assert!(!state.can_show(true));
        assert!(state.acknowledge(4));
        assert!(!state.can_show(true));
        state.prepared = true;
        assert!(!state.can_show(true)); // Source may have left while WebView2 built.
        state.confirmed = true;
        assert!(!state.can_show(false));
        assert!(state.can_show(true));
        state.shown = true;
        assert!(!state.can_show(true));
    }
    #[test]
    fn cancelled_and_previous_session_acks_never_reopen_or_close_new_preview() {
        let mut state = lifecycle(5);
        assert!(state.clear(5));
        assert!(!state.acknowledge(5));
        assert!(!state.confirm(5));
        assert!(!state.can_show(true));
        state = lifecycle(6);
        assert!(!state.acknowledge(5));
        assert!(!state.confirm(5));
        assert!(!state.clear(5));
        assert!(state.matches(6));
    }
}
