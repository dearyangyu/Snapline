use crate::{
    desktop_geometry::DesktopRect,
    library::{now_ms, AppSnapshot, Result},
    lock, native, publish, report, AppState,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use image::RgbaImage;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    io::Cursor,
    sync::{
        atomic::{AtomicU8, Ordering},
        Arc,
    },
};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

pub struct Session {
    pub id: String,
    pub frame: Arc<native::DesktopFrame>,
    pub png: String,
    pub monitors: Vec<Selection>,
}

/// Capture exclusion and its visibility policy are acquired together. Changing
/// settings while the overlay is open cannot change this capture's restoration.
#[derive(Default)]
pub struct CaptureActivity(AtomicU8);
impl CaptureActivity {
    pub fn load(&self, ordering: Ordering) -> bool {
        self.0.load(ordering) != 0
    }
    pub fn preserves_windows(&self) -> bool {
        self.0.load(Ordering::SeqCst) == 1
    }
    fn begin(&self, hide_windows: bool) -> Result<()> {
        self.0
            .compare_exchange(
                0,
                if hide_windows { 2 } else { 1 },
                Ordering::SeqCst,
                Ordering::SeqCst,
            )
            .map(|_| ())
            .map_err(|_| "截图正在进行中；按 Esc 取消当前截图。".into())
    }
    fn finish(&self) {
        self.0.store(0, Ordering::SeqCst);
    }
}

/// Owned by one capture and consumed synchronously during restoration. Never
/// persist HWNDs, or retain them for the delayed compositor completion callback.
#[derive(Clone, Debug, PartialEq, Eq)]
struct ForegroundTarget {
    hwnd: isize,
    process: u32,
    thread: u32,
    class: Vec<u16>,
}
impl ForegroundTarget {
    fn matches_live(
        &self,
        live: Option<&Self>,
        visible: bool,
        minimized: bool,
        enabled: bool,
    ) -> bool {
        visible && !minimized && enabled && live == Some(self)
    }
    #[cfg(windows)]
    fn read(hwnd: isize) -> Option<Self> {
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            GetClassNameW, GetWindowThreadProcessId, IsWindow,
        };
        let handle = hwnd as windows_sys::Win32::Foundation::HWND;
        unsafe {
            if handle.is_null() || IsWindow(handle) == 0 {
                return None;
            }
            let mut process = 0;
            let thread = GetWindowThreadProcessId(handle, &mut process);
            let mut class = [0u16; 256];
            let count = GetClassNameW(handle, class.as_mut_ptr(), class.len() as i32);
            if process == 0 || thread == 0 || count <= 0 {
                return None;
            }
            Some(Self {
                hwnd,
                process,
                thread,
                class: class[..count as usize].to_vec(),
            })
        }
    }
    #[cfg(windows)]
    fn current() -> Option<Self> {
        Self::read(
            unsafe { windows_sys::Win32::UI::WindowsAndMessaging::GetForegroundWindow() } as isize,
        )
    }
    #[cfg(not(windows))]
    fn current() -> Option<Self> {
        None
    }
    #[cfg(windows)]
    fn valid(&self) -> bool {
        use windows_sys::Win32::UI::{
            Input::KeyboardAndMouse::IsWindowEnabled,
            WindowsAndMessaging::{IsIconic, IsWindowVisible},
        };
        let hwnd = self.hwnd as windows_sys::Win32::Foundation::HWND;
        self.matches_live(
            Self::read(self.hwnd).as_ref(),
            unsafe { IsWindowVisible(hwnd) != 0 },
            unsafe { IsIconic(hwnd) != 0 },
            unsafe { IsWindowEnabled(hwnd) != 0 },
        )
    }
    #[cfg(not(windows))]
    fn valid(&self) -> bool {
        self.matches_live(None, false, false, false)
    }
    #[cfg(windows)]
    fn restore_focus(&self) -> bool {
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            GetForegroundWindow, SetForegroundWindow,
        };
        if !self.valid() {
            return false;
        }
        let hwnd = self.hwnd as windows_sys::Win32::Foundation::HWND;
        unsafe {
            if GetForegroundWindow() == hwnd {
                return true;
            }
            // Respect Windows' foreground lock. Never synthesize Alt, attach
            // input queues, unminimize another app, or retry in a later callback.
            SetForegroundWindow(hwnd) != 0 && GetForegroundWindow() == hwnd
        }
    }
    #[cfg(not(windows))]
    fn restore_focus(&self) -> bool {
        false
    }
}

#[derive(Default)]
pub struct CaptureStartup {
    id: Option<String>,
    configured: bool,
    presented: bool,
    foreground: Option<ForegroundTarget>,
}
impl CaptureStartup {
    fn begin(&mut self, id: String) {
        let foreground = self.foreground.take();
        *self = Self {
            id: Some(id),
            configured: false,
            presented: false,
            foreground,
        };
    }
    fn matches(&self, id: &str) -> bool {
        self.id.as_deref() == Some(id)
    }
    fn configure(&mut self, id: &str) -> bool {
        if !self.matches(id) {
            return false;
        }
        self.configured = true;
        true
    }
    fn present(&mut self, id: &str) -> Result<bool> {
        if !self.matches(id) {
            return Err("截图会话已结束".into());
        }
        if !self.configured {
            return Ok(false);
        }
        self.presented = true;
        Ok(true)
    }
    fn cancel(&mut self, id: &str) -> bool {
        if !self.matches(id) {
            return false;
        }
        let foreground = self.foreground.take();
        *self = Self {
            foreground,
            ..Self::default()
        };
        true
    }
    fn pending(&self, id: &str) -> bool {
        self.matches(id) && !self.presented
    }
}
#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
pub struct Selection {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
}
impl Selection {
    fn validate(self, width: u32, height: u32) -> Result<Self> {
        if self.width == 0
            || self.height == 0
            || self.x.checked_add(self.width).is_none_or(|n| n > width)
            || self.y.checked_add(self.height).is_none_or(|n| n > height)
        {
            Err("选区超出截图范围，请重新框选。".into())
        } else {
            Ok(self)
        }
    }

    fn desktop_rect(self, frame: DesktopRect) -> Result<DesktopRect> {
        self.validate(frame.width, frame.height)?;
        // Capture selections are offsets into a physical virtual-desktop bitmap.
        // Do not scale/clamp them to one monitor's logical size or work area.
        let coordinate = |origin: i32, offset: u32| {
            i32::try_from(i64::from(origin) + i64::from(offset))
                .map_err(|_| "截图位置超出桌面支持范围。".to_string())
        };
        Ok(DesktopRect {
            x: coordinate(frame.x, self.x)?,
            y: coordinate(frame.y, self.y)?,
            width: self.width,
            height: self.height,
        })
    }
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureSession {
    session_id: String,
    data_url: String,
    width: u32,
    height: u32,
    origin_x: i32,
    origin_y: i32,
    monitors: Vec<Selection>,
    cursor: Option<PhysicalPointer>,
}

// Must run on the UI thread, alongside ready/timeout/Destroyed handling. Never
// hold a state lock while calling a window API (Destroyed may run synchronously).
fn cancel_current(app: &AppHandle, id: &str, message: Option<&str>) -> Result<()> {
    let state = app.state::<AppState>();
    let current = state
        .capture_startup
        .lock()
        .map_err(|_| "截图状态不可用")?
        .cancel(id);
    if !current {
        return Ok(());
    }
    if let Ok(mut session) = state.capture.lock() {
        if session.as_ref().is_some_and(|s| s.id == id) {
            session.take();
        }
    }
    if let Some(window) = app.get_webview_window("capture") {
        let _ = window.destroy();
    }
    // This teardown is already serialized on the UI thread. Restore and focus
    // the previous surface now, before finish_capture can create a new pin or
    // open the editor; a queued restoration must never steal their focus later.
    restore_on_main(app);
    if let Some(message) = message {
        let _ = crate::show_main_now(app);
        report(app, message);
    }
    Ok(())
}

async fn cancel_session(app: AppHandle, id: String, message: Option<String>) -> Result<()> {
    let (send, mut receive) = tauri::async_runtime::channel(1);
    let handle = app.clone();
    app.run_on_main_thread(move || {
        let _ = send.try_send(cancel_current(&handle, &id, message.as_deref()));
    })
    .map_err(|e| e.to_string())?;
    receive.recv().await.ok_or("截图窗口未能恢复")?
}

fn restore(app: &AppHandle) {
    // Tao show() is synchronous only on the UI thread. Keep the no-transition
    // flag set through its ShowWindow and compositor submission, including the
    // fullscreen-capture/error paths that call restore from a worker.
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || restore_on_main(&handle));
}
fn restore_on_main(app: &AppHandle) {
    let state = app.state::<AppState>();
    let foreground = state
        .capture_startup
        .lock()
        .ok()
        .and_then(|mut startup| startup.foreground.take());
    // If the original app disappeared or was minimized during capture, retain
    // the still-valid foreground chosen by Windows when the overlay closed.
    // Save it before showing our own windows (Tao show() activates them).
    let fallback_foreground = ForegroundTarget::current().filter(ForegroundTarget::valid);
    let mut labels = state
        .hidden_windows
        .lock()
        .map(|mut w| std::mem::take(&mut *w))
        .unwrap_or_default();
    let restore_gallery = labels.iter().any(|label| label == "gallery");
    // The visible-window snapshot originates from a HashMap. A restored main
    // window shown after the fullscreen gallery would cover it and take focus.
    // Show the gallery last, while retaining passive anchor restoration.
    labels.sort_by_key(|label| label == "gallery");
    let mut restored = Vec::new();
    for label in labels {
        if let Some(w) = app.get_webview_window(&label) {
            let _ = native::set_capture_transitions(&w, true);
            if label == "anchor" {
                let _ = crate::shelf_anchor::set_visible(&w, true);
            } else {
                let _ = w.show();
            }
            restored.push(w);
        }
    }
    let focus_target = foreground
        .filter(ForegroundTarget::valid)
        .or(fallback_foreground);
    if let Some(target) = focus_target {
        let _ = target.restore_focus();
    } else if restore_gallery {
        if let Some(gallery) = app.get_webview_window("gallery") {
            if gallery.is_visible().unwrap_or(false) {
                let _ = gallery.set_focus();
            }
        }
    }
    if restored.is_empty() {
        state.capture_active.finish();
        return;
    }
    // DwmFlush can wait for a refresh/GPU work, so never block WebView2's UI
    // thread. Keep capture_active until the completion callback, preventing a
    // subsequent capture from inheriting this restoration's delayed flag reset.
    let handle = app.clone();
    std::thread::spawn(move || {
        let flushed = native::flush_compositor().is_ok();
        let finish = handle.clone();
        let _ = handle.run_on_main_thread(move || {
            // Do not focus windows here: a new pin/editor can already have been
            // opened after synchronous restoration. On compositor failure retain
            // the per-window no-transition flag.
            if flushed {
                for window in restored {
                    let _ = native::set_capture_transitions(&window, false);
                }
            }
            finish.state::<AppState>().capture_active.finish();
        });
    });
}
async fn prepare_for_capture(app: &AppHandle) -> Result<()> {
    let state = app.state::<AppState>();
    let hide_windows = lock(&state)?.settings.hide_windows_on_capture;
    state.capture_active.begin(hide_windows)?;
    // Snapshot before any hide can change the foreground. begin/cancel retain
    // this one-shot target; all restore/error/fullscreen paths consume it.
    match state.capture_startup.lock() {
        Ok(mut startup) => startup.foreground = ForegroundTarget::current(),
        Err(_) => {
            state.capture_active.finish();
            return Err("截图状态不可用".into());
        }
    }
    match state.hidden_windows.lock() {
        Ok(mut hidden) => hidden.clear(),
        Err(_) => {
            restore(app);
            return Err("窗口状态不可用".into());
        }
    }
    let (send, mut receive) = tauri::async_runtime::channel(1);
    let capture_app = app.clone();
    if let Err(error) = app.run_on_main_thread(move || {
        let result = (|| -> Result<()> {
            // Even the non-hiding path crosses the UI-thread barrier. All visual
            // watchers now retain their current state until this capture ends.
            if capture_app
                .state::<AppState>()
                .capture_active
                .preserves_windows()
            {
                crate::shelf_preview::preserve_for_capture(&capture_app);
                return Ok(());
            }
            let visible: Vec<_> = capture_app
                .webview_windows()
                .into_iter()
                .filter(|(label, window)| {
                    restorable_window(
                        label,
                        window.is_visible().unwrap_or(false),
                        window.is_minimized().unwrap_or(true),
                    )
                })
                .collect();
            // A partially prepared shelf must never be restored by a plain show().
            // Capture completion may request a fresh prepare/ready generation.
            crate::shelf_preview::close_now(&capture_app, None)?;
            crate::shelf_anchor::hide_immediately(&capture_app)?;
            // The halo is a passive companion, never an independently restored
            // app window. Hide it even if the anchor was already hidden.
            crate::anchor_glow::hide(&capture_app)?;
            for (label, window) in visible {
                native::set_capture_transitions(&window, true)?;
                if label == "anchor" {
                    crate::shelf_anchor::set_visible(&window, false)?;
                } else {
                    window.hide().map_err(|e| e.to_string())?;
                }
                if window.is_visible().map_err(|e| e.to_string())? {
                    return Err("截图前未能隐藏晾图窗口，请重试。".into());
                }
                // Restore only windows actually hidden by this invocation.
                capture_app
                    .state::<AppState>()
                    .hidden_windows
                    .lock()
                    .map_err(|_| "窗口状态不可用")?
                    .push(label);
            }
            Ok(())
        })();
        let _ = send.try_send(result);
    }) {
        restore(app);
        return Err(error.to_string());
    }
    let result = receive
        .recv()
        .await
        .unwrap_or_else(|| Err("截图窗口同步失败。".into()));
    if result.is_err() {
        restore(app);
    }
    result?;
    Ok(())
}

fn restorable_window(label: &str, visible: bool, minimized: bool) -> bool {
    visible && !minimized && !matches!(label, "capture" | "shelf" | "shelf-preview" | "anchor-glow")
}

#[tauri::command]
pub async fn start_capture(app: AppHandle) -> Result<()> {
    prepare_for_capture(&app).await?;
    let id = uuid::Uuid::new_v4().to_string();
    match app.state::<AppState>().capture_startup.lock() {
        Ok(mut startup) => startup.begin(id.clone()),
        Err(_) => {
            restore(&app);
            return Err("截图状态不可用".into());
        }
    }
    let result = start_inner(&app, &id).await;
    if result.is_err() {
        let _ = cancel_session(app.clone(), id, None).await;
    }
    result
}
async fn start_inner(app: &AppHandle, id: &str) -> Result<()> {
    let frame = tauri::async_runtime::spawn_blocking(|| {
        native::wait_for_compositor()?;
        native::capture_desktop()
    })
    .await
    .map_err(|e| e.to_string())??;
    let width = frame.image.width();
    let height = frame.image.height();
    let x = frame.origin_x;
    let y = frame.origin_y;
    let frame = Arc::new(frame);
    let encode = frame.clone();
    let png = tauri::async_runtime::spawn_blocking(move || encode_png(&encode.image))
        .await
        .map_err(|e| e.to_string())??;
    let monitors = app
        .get_webview_window("main")
        .and_then(|window| window.available_monitors().ok())
        .unwrap_or_default()
        .iter()
        .filter_map(|monitor| {
            DesktopRect::from(monitor)
                .clipped_to(DesktopRect {
                    x,
                    y,
                    width,
                    height,
                })
                .map(|(x, y, width, height)| Selection {
                    x,
                    y,
                    width,
                    height,
                })
        })
        .collect();
    let session = Session {
        id: id.to_owned(),
        monitors,
        frame,
        png: format!("data:image/png;base64,{}", STANDARD.encode(png)),
    };
    *app.state::<AppState>()
        .capture
        .lock()
        .map_err(|_| "截图状态不可用")? = Some(session);
    let window = WebviewWindowBuilder::new(
        app,
        "capture",
        WebviewUrl::App(format!("index.html?view=capture&session={id}").into()),
    )
    .title("Snapline · 截图")
    .decorations(false)
    .transparent(true)
    .background_color(tauri::window::Color(0, 0, 0, 0))
    .no_redirection_bitmap(true)
    .shadow(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .resizable(false)
    .visible(false)
    .build()
    .map_err(|e| e.to_string())?;
    native::set_capture_transitions(&window, true)?;
    window
        .set_position(tauri::PhysicalPosition::new(x, y))
        .map_err(|e| e.to_string())?;
    window
        .set_size(tauri::PhysicalSize::new(width, height))
        .map_err(|e| e.to_string())?;
    let on_close = app.clone();
    let close_id = id.to_owned();
    window.on_window_event(move |event| {
        if matches!(event, tauri::WindowEvent::Destroyed) {
            let _ = cancel_current(&on_close, &close_id, None);
        }
    });
    if !app
        .state::<AppState>()
        .capture_startup
        .lock()
        .map_err(|_| "截图状态不可用")?
        .configure(id)
    {
        let _ = window.destroy();
        return Err("截图会话已结束".into());
    }
    // Hidden WebView2 pages can throttle animation frames. The frontend signals
    // decoded image + completed layout; this watchdog recovers if it never can.
    let timeout_app = app.clone();
    let timeout_id = id.to_owned();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(8));
        let handle = timeout_app.clone();
        let _ = timeout_app.run_on_main_thread(move || {
            let pending = handle
                .state::<AppState>()
                .capture_startup
                .lock()
                .map(|gate| gate.pending(&timeout_id))
                .unwrap_or(false);
            if pending {
                let _ = cancel_current(
                    &handle,
                    &timeout_id,
                    Some("截图画面未能加载，已恢复窗口。请重试。"),
                );
            }
        });
    });
    Ok(())
}
#[tauri::command]
pub fn get_capture_session(
    app: AppHandle,
    window: WebviewWindow,
    session_id: String,
) -> Result<CaptureSession> {
    if window.label() != "capture" {
        return Err("当前窗口不是截图界面".into());
    }
    let state = app.state::<AppState>();
    let session = state.capture.lock().map_err(|_| "截图状态不可用")?;
    let session = session.as_ref().ok_or("截图已结束")?;
    if session.id != session_id {
        return Err("截图会话已结束".into());
    }
    Ok(CaptureSession {
        session_id: session.id.clone(),
        data_url: session.png.clone(),
        width: session.frame.image.width(),
        height: session.frame.image.height(),
        origin_x: session.frame.origin_x,
        origin_y: session.frame.origin_y,
        monitors: session.monitors.clone(),
        cursor: native::cursor().map(|(x, y)| PhysicalPointer { x, y }),
    })
}
#[tauri::command]
pub async fn capture_ready(
    app: AppHandle,
    window: WebviewWindow,
    session_id: String,
) -> Result<bool> {
    if window.label() != "capture" {
        return Err("当前窗口不是截图界面".into());
    }
    let (send, mut receive) = tauri::async_runtime::channel(1);
    let handle = app.clone();
    app.run_on_main_thread(move || {
        let result = (|| -> Result<bool> {
            let present = handle
                .state::<AppState>()
                .capture_startup
                .lock()
                .map_err(|_| "截图状态不可用")?
                .present(&session_id)?;
            if !present {
                return Ok(false);
            }
            native::set_capture_transitions(&window, true)?;
            window.show().map_err(|e| e.to_string())?;
            window.set_focus().map_err(|e| e.to_string())?;
            Ok(true)
        })();
        if result.is_err() {
            let _ = cancel_current(
                &handle,
                &session_id,
                Some("截图窗口未能显示，已恢复原窗口。"),
            );
        }
        let _ = send.try_send(result);
    })
    .map_err(|e| e.to_string())?;
    receive.recv().await.ok_or("截图窗口未响应")?
}
#[tauri::command]
pub async fn capture_load_failed(
    app: AppHandle,
    window: WebviewWindow,
    session_id: String,
) -> Result<()> {
    if window.label() != "capture" {
        return Err("当前窗口不是截图界面".into());
    }
    cancel_session(
        app,
        session_id,
        Some("截图画面加载失败，已恢复原窗口。请重试。".into()),
    )
    .await
}
#[tauri::command]
pub async fn cancel_capture(app: AppHandle, session_id: String) -> Result<()> {
    cancel_session(app, session_id, None).await
}
fn encode_png(image: &RgbaImage) -> Result<Vec<u8>> {
    let mut png = Cursor::new(Vec::new());
    image
        .write_to(&mut png, image::ImageFormat::Png)
        .map_err(|e| e.to_string())?;
    Ok(png.into_inner())
}
fn decode_annotated_selection(data_url: &str, selection: Selection) -> Result<RgbaImage> {
    if data_url.len() > 90_000_000 {
        return Err("标注图片过大，请缩小选区后重试。".into());
    }
    let payload = data_url
        .strip_prefix("data:image/png;base64,")
        .ok_or("标注结果必须为 PNG 图片。")?;
    let bytes = STANDARD
        .decode(payload)
        .map_err(|_| "标注图片数据不完整，请重试。")?;
    // Match the library's compressed-size, pixel and decoder-allocation budgets.
    if bytes.len() > 64 * 1024 * 1024 {
        return Err("标注图片超过 64 MB，请缩小选区后重试。".into());
    }
    let dimensions = image::ImageReader::with_format(Cursor::new(&bytes), image::ImageFormat::Png)
        .into_dimensions()
        .map_err(|_| "标注结果不是有效的 PNG 图片。")?;
    if dimensions != (selection.width, selection.height) {
        return Err("标注图片尺寸与当前选区不一致，请重试。".into());
    }
    if dimensions.0 == 0
        || dimensions.1 == 0
        || dimensions.0 > 20000
        || dimensions.1 > 20000
        || u64::from(dimensions.0) * u64::from(dimensions.1) > 80_000_000
    {
        return Err("标注图片尺寸过大。".into());
    }
    let mut reader = image::ImageReader::with_format(Cursor::new(&bytes), image::ImageFormat::Png);
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(20000);
    limits.max_image_height = Some(20000);
    limits.max_alloc = Some(320_000_000);
    reader.limits(limits);
    reader
        .decode()
        .map(|image| image.into_rgba8())
        .map_err(|_| "标注图片无法解码，请重试。".into())
}

fn take_matching_session(
    capture: &mut Option<Session>,
    expected: &Arc<native::DesktopFrame>,
) -> Result<Session> {
    if !capture
        .as_ref()
        .is_some_and(|session| Arc::ptr_eq(&session.frame, expected))
    {
        return Err("原截图已结束，请在当前截图中重新操作。".into());
    }
    capture.take().ok_or_else(|| "截图已结束".into())
}
fn import_image(app: &AppHandle, image: &RgbaImage, source: &str) -> Result<String> {
    let mut hash = Sha256::new();
    hash.update(image.width().to_le_bytes());
    hash.update(image.height().to_le_bytes());
    hash.update(image.as_raw());
    let fingerprint = format!("pixels:{:x}", hash.finalize());
    let bytes = encode_png(image)?;
    let state = app.state::<AppState>();
    let mut lib = lock(&state)?;
    lib.import_png(&bytes, &format!("Screenshot-{}.png", now_ms()), source)?;
    lib.items
        .iter()
        .find(|i| i.fingerprint == fingerprint)
        .map(|i| i.id.clone())
        .ok_or_else(|| "无法找到保存的截图".into())
}
#[tauri::command]
pub async fn finish_capture(
    app: AppHandle,
    session_id: String,
    selection: Selection,
    action: String,
    data_url: Option<String>,
) -> Result<AppSnapshot> {
    if !["copy", "edit", "pin", "save"].contains(&action.as_str()) {
        return Err("未知截图操作".into());
    }
    let frame = {
        let state = app.state::<AppState>();
        let capture = state.capture.lock().map_err(|_| "截图状态不可用")?;
        let s = capture.as_ref().ok_or("截图已结束")?;
        if s.id != session_id {
            return Err("原截图已结束，请在当前截图中重新操作。".into());
        }
        selection.validate(s.frame.image.width(), s.frame.image.height())?;
        s.frame.clone()
    };
    let source = if data_url.is_some() {
        "annotated"
    } else {
        "screenshot"
    };
    let capture_bounds = selection.desktop_rect(DesktopRect {
        x: frame.origin_x,
        y: frame.origin_y,
        width: frame.image.width(),
        height: frame.image.height(),
    })?;
    let decode_frame = frame.clone();
    // Keep the overlay/session intact on invalid payloads; decoding and cropping
    // run off the UI thread and cannot consume a later session after cancellation.
    let image = tauri::async_runtime::spawn_blocking(move || match data_url {
        Some(data_url) => decode_annotated_selection(&data_url, selection),
        None => Ok(image::imageops::crop_imm(
            &decode_frame.image,
            selection.x,
            selection.y,
            selection.width,
            selection.height,
        )
        .to_image()),
    })
    .await
    .map_err(|e| e.to_string())??;
    // Serialize ownership validation and all teardown with cancellation/ready.
    // Otherwise a late finish could destroy the next session's reused label.
    let (send, mut receive) = tauri::async_runtime::channel(1);
    let handle = app.clone();
    app.run_on_main_thread(move || {
        let result = (|| -> Result<()> {
            let state = handle.state::<AppState>();
            if !state
                .capture_startup
                .lock()
                .map_err(|_| "截图状态不可用")?
                .matches(&session_id)
            {
                return Err("原截图已结束，请在当前截图中重新操作。".into());
            }
            {
                let mut capture = state.capture.lock().map_err(|_| "截图状态不可用")?;
                take_matching_session(&mut capture, &frame)?;
            }
            cancel_current(&handle, &session_id, None)
        })();
        let _ = send.try_send(result);
    })
    .map_err(|e| e.to_string())?;
    receive.recv().await.ok_or("截图窗口未能恢复")??;
    let result = async {
        let handle = app.clone();
        let id =
            tauri::async_runtime::spawn_blocking(move || import_image(&handle, &image, source))
                .await
                .map_err(|e| e.to_string())??;
        publish(&app, false)?;
        match action.as_str() {
            "copy" => crate::copy_item(app.clone(), id).await?,
            "pin" => pin_item_at(app.clone(), id, Some(capture_bounds)).await?,
            "edit" => {
                crate::show_main(app.clone()).await?;
                app.emit_to("main", "preview-item", serde_json::json!({"id": id}))
                    .map_err(|e| e.to_string())?;
            }
            "save" => {
                let parent = app.get_webview_window("main").ok_or("主窗口尚未就绪")?;
                crate::export_item(app.clone(), parent, id).await?;
            }
            _ => {}
        }
        publish(&app, false)
    }
    .await;
    if let Err(error) = &result {
        // The capture webview is gone: surface delivery failures in a live window.
        let _ = crate::show_main(app.clone()).await;
        report(&app, error);
    }
    result
}
#[tauri::command]
pub async fn capture_fullscreen(app: AppHandle) -> Result<AppSnapshot> {
    let cursor = native::cursor();
    let monitors = app
        .get_webview_window("main")
        .and_then(|w| w.available_monitors().ok())
        .unwrap_or_default();
    let monitor = monitors
        .iter()
        .find(|m| cursor.is_some_and(|point| DesktopRect::from(*m).contains(point)))
        .map(DesktopRect::from)
        .ok_or("无法确定鼠标所在显示器，请将鼠标移入显示器后重试。")?;
    prepare_for_capture(&app).await?;
    let result = tauri::async_runtime::spawn_blocking(move || {
        native::wait_for_compositor()?;
        native::capture_desktop()
    })
    .await
    .map_err(|e| e.to_string())
    .and_then(|r| r);
    restore(&app);
    let mut frame = result?;
    let selected_monitor_still_exists = app
        .get_webview_window("main")
        .and_then(|window| window.available_monitors().ok())
        .is_some_and(|current| current.iter().any(|m| DesktopRect::from(m) == monitor));
    if !selected_monitor_still_exists {
        return Err("显示器布局在截图期间发生变化，请重试。".into());
    }
    // A disconnected/moved monitor must never fall back to copying the entire
    // virtual desktop, or wrap a negative origin into an unsigned crop offset.
    let (x, y, width, height) = monitor
        .crop_inside(DesktopRect {
            x: frame.origin_x,
            y: frame.origin_y,
            width: frame.image.width(),
            height: frame.image.height(),
        })
        .ok_or("显示器布局在截图期间发生变化，请重试。")?;
    frame.image = image::imageops::crop_imm(&frame.image, x, y, width, height).to_image();
    let handle = app.clone();
    let id = tauri::async_runtime::spawn_blocking(move || {
        import_image(&handle, &frame.image, "screenshot")
    })
    .await
    .map_err(|e| e.to_string())??;
    crate::copy_item(app.clone(), id).await?;
    publish(&app, true)
}
#[tauri::command]
pub async fn pin_item(app: AppHandle, id: String) -> Result<()> {
    pin_item_at(app, id, None).await
}

// Reapply the physical rectangle after a monitor change: Tao's WM_DPICHANGED
// handler can adjust both size and position. Run on the UI thread so its window
// messages have completed before reading back the resulting physical geometry.
fn configure_capture_pin(window: &WebviewWindow, bounds: DesktopRect) -> Result<()> {
    native::set_capture_transitions(window, true)?;
    window.hide().map_err(|e| e.to_string())?;
    window
        .set_min_size(Some(tauri::PhysicalSize::new(1, 1)))
        .map_err(|e| e.to_string())?;
    let position = tauri::PhysicalPosition::new(bounds.x, bounds.y);
    let size = tauri::PhysicalSize::new(bounds.width, bounds.height);
    for _ in 0..3 {
        window.set_position(position).map_err(|e| e.to_string())?;
        window.set_size(size).map_err(|e| e.to_string())?;
        if window.inner_position().map_err(|e| e.to_string())? == position
            && window.inner_size().map_err(|e| e.to_string())? == size
        {
            #[cfg(windows)]
            native::set_opacity(window.hwnd().map_err(|e| e.to_string())?.0 as isize, 1.0)?;
            // Deduplication can reuse a collapsed/dimmed pin. Its webview must
            // discard that presentation state when it becomes a fresh capture.
            window
                .emit_to(window.label(), "pin-capture-reset", ())
                .map_err(|e| e.to_string())?;
            return Ok(());
        }
    }
    Err("贴图未能恢复到截图位置，请重试。".into())
}

async fn pin_item_at(
    app: AppHandle,
    id: String,
    capture_bounds: Option<DesktopRect>,
) -> Result<()> {
    let item = lock(&app.state::<AppState>())?.item(&id)?;
    if item.kind != "image" {
        return Err("只有图片可以贴在桌面。".into());
    }
    let label = format!("pin-{id}");
    if let Some(w) = app.get_webview_window(&label) {
        let (send, mut receive) = tauri::async_runtime::channel(1);
        app.run_on_main_thread(move || {
            let result = (|| -> Result<()> {
                if let Some(bounds) = capture_bounds {
                    configure_capture_pin(&w, bounds)?;
                }
                w.show().map_err(|e| e.to_string())?;
                w.set_focus().map_err(|e| e.to_string())
            })();
            let _ = send.try_send(result);
        })
        .map_err(|e| e.to_string())?;
        return receive.recv().await.ok_or("贴图窗口未能恢复")?;
    }
    let w = WebviewWindowBuilder::new(
        &app,
        &label,
        WebviewUrl::App(format!("index.html?view=pin&id={id}").into()),
    )
    .title(format!("Snapline · {}", item.name))
    .decorations(false)
    .transparent(true)
    .shadow(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .inner_size(500.0, 400.0)
    .min_inner_size(96.0, 72.0)
    .resizable(true)
    .maximizable(false)
    .visible(false)
    .build()
    .map_err(|e| e.to_string())?;
    native::remove_pin_frame(&w);
    lock(&app.state::<AppState>())?
        .active_pins
        .insert(id.clone());
    let pin_app = app.clone();
    let pin_id = id.clone();
    w.on_window_event(move |event| {
        if matches!(event, tauri::WindowEvent::Destroyed) {
            if let Ok(mut library) = lock(&pin_app.state::<AppState>()) {
                library.active_pins.remove(&pin_id);
            }
        }
    });
    let cursor = native::cursor();
    let monitors = w.available_monitors().unwrap_or_default();
    let monitor = monitors
        .iter()
        .find(|m| cursor.is_some_and(|point| DesktopRect::from(*m).contains(point)))
        .cloned()
        .or_else(|| w.current_monitor().ok().flatten());
    let work_area = monitor.as_ref().map(|m| {
        let area = m.work_area();
        DesktopRect {
            x: area.position.x,
            y: area.position.y,
            width: area.size.width,
            height: area.size.height,
        }
    });
    let max = work_area
        .map(|area| (area.width as f64 * 0.75, area.height as f64 * 0.75))
        .unwrap_or((900.0, 700.0));
    let scale = (max.0 / item.width.max(1) as f64)
        .min(max.1 / item.height.max(1) as f64)
        .min(1.0);
    let size = tauri::PhysicalSize::new(
        (item.width as f64 * scale).max(96.0) as u32,
        (item.height as f64 * scale).max(72.0) as u32,
    );
    // Move to the destination DPI first, then apply explicit physical size.
    // Otherwise WM_DPICHANGED may rescale a size calculated for the old monitor.
    let (send, mut receive) = tauri::async_runtime::channel(1);
    let window = w.clone();
    if let Err(error) = app.run_on_main_thread(move || {
        let result = (|| -> Result<()> {
            if let Some(bounds) = capture_bounds {
                configure_capture_pin(&window, bounds)?;
            } else {
                if let Some(area) = work_area {
                    window
                        .set_position(tauri::PhysicalPosition::new(area.x, area.y))
                        .map_err(|e| e.to_string())?;
                }
                window.set_size(size).map_err(|e| e.to_string())?;
                if let Some(area) = work_area {
                    let actual = window.outer_size().map_err(|e| e.to_string())?;
                    let (x, y) = area.center_window(actual.width, actual.height);
                    window
                        .set_position(tauri::PhysicalPosition::new(x, y))
                        .map_err(|e| e.to_string())?;
                } else {
                    window.center().map_err(|e| e.to_string())?;
                }
            }
            window.show().map_err(|e| e.to_string())?;
            let _ = window.set_focus();
            Ok(())
        })();
        let _ = send.try_send(result);
    }) {
        let _ = w.destroy();
        return Err(error.to_string());
    }
    let result = receive.recv().await.ok_or("贴图窗口未能恢复")?;
    if result.is_err() {
        let _ = w.destroy();
    }
    result
}
#[tauri::command]
pub async fn paste_clipboard(app: AppHandle) -> Result<AppSnapshot> {
    if app
        .state::<AppState>()
        .capture_active
        .load(Ordering::SeqCst)
    {
        return Err("请先完成当前截图。".into());
    }
    let handle = app.clone();
    let id = tauri::async_runtime::spawn_blocking(move || {
        let mut clipboard = arboard::Clipboard::new().map_err(|e| e.to_string())?;
        let image = clipboard
            .get_image()
            .map_err(|_| "剪贴板中没有图片，请先截图或复制一张图片。")?;
        if image.width == 0
            || image.height == 0
            || image.width.saturating_mul(image.height) > 80_000_000
        {
            return Err("剪贴板图片尺寸过大。".into());
        }
        let image = RgbaImage::from_raw(
            image.width as u32,
            image.height as u32,
            image.bytes.into_owned(),
        )
        .ok_or("剪贴板图片数据无效")?;
        import_image(&handle, &image, "clipboard")
    })
    .await
    .map_err(|e| e.to_string())??;
    pin_item(app.clone(), id).await?;
    publish(&app, false)
}
#[tauri::command]
pub async fn toggle_pins(app: AppHandle) -> Result<()> {
    if app
        .state::<AppState>()
        .capture_active
        .load(Ordering::SeqCst)
    {
        return Err("请先完成当前截图。".into());
    }
    let windows: Vec<_> = app
        .webview_windows()
        .into_iter()
        .filter(|(label, _)| label.starts_with("pin-"))
        .map(|(_, w)| w)
        .collect();
    let hide = windows.iter().any(|w| w.is_visible().unwrap_or(false));
    for w in windows {
        if hide { w.hide() } else { w.show() }.map_err(|e| e.to_string())?;
    }
    Ok(())
}
#[tauri::command]
pub async fn close_pin(window: WebviewWindow) -> Result<()> {
    if !window.label().starts_with("pin-") {
        return Err("当前窗口不是贴图。".into());
    }
    window.destroy().map_err(|e| e.to_string())
}
#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
pub struct DragAnchor {
    pub x: f64,
    pub y: f64,
}
fn anchored_position(cursor: (i32, i32), anchor: DragAnchor) -> Result<(i32, i32)> {
    if !anchor.x.is_finite()
        || !anchor.y.is_finite()
        || anchor.x.abs() > 160_000.0
        || anchor.y.abs() > 160_000.0
    {
        return Err("贴图拖动锚点无效。".into());
    }
    Ok((
        (f64::from(cursor.0) - anchor.x)
            .round()
            .clamp(-100_000.0, 100_000.0) as i32,
        (f64::from(cursor.1) - anchor.y)
            .round()
            .clamp(-100_000.0, 100_000.0) as i32,
    ))
}
#[tauri::command]
pub async fn get_pin_drag_anchor(
    window: WebviewWindow,
    client_x: f64,
    client_y: f64,
    scale: f64,
) -> Result<DragAnchor> {
    if !window.label().starts_with("pin-")
        || !scale.is_finite()
        || !(0.5..=8.0).contains(&scale)
        || !client_x.is_finite()
        || !client_y.is_finite()
    {
        return Err("贴图拖动参数无效。".into());
    }
    let inner = window.inner_position().map_err(|e| e.to_string())?;
    let outer = window.outer_position().map_err(|e| e.to_string())?;
    Ok(DragAnchor {
        x: client_x * scale + f64::from(inner.x - outer.x),
        y: client_y * scale + f64::from(inner.y - outer.y),
    })
}
#[derive(Clone, Copy, Serialize, Deserialize)]
pub struct PhysicalPointer {
    pub x: i32,
    pub y: i32,
}
#[tauri::command]
pub fn get_cursor_position() -> Result<PhysicalPointer> {
    native::cursor()
        .map(|(x, y)| PhysicalPointer { x, y })
        .ok_or_else(|| "无法读取鼠标位置".into())
}
#[tauri::command]
pub async fn move_pin_to_cursor(
    window: WebviewWindow,
    anchor: DragAnchor,
    cursor: Option<PhysicalPointer>,
) -> Result<()> {
    if !window.label().starts_with("pin-") {
        return Err("当前窗口不是贴图。".into());
    }
    let cursor = match cursor {
        Some(position) => (position.x, position.y),
        None => native::cursor().ok_or("无法读取鼠标位置")?,
    };
    let (x, y) = anchored_position(cursor, anchor)?;
    window
        .set_position(tauri::PhysicalPosition::new(x, y))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn move_pin(window: WebviewWindow, x: i32, y: i32) -> Result<()> {
    if !window.label().starts_with("pin-") {
        return Err("当前窗口不是贴图。".into());
    }
    // Physical pixels preserve negative monitor coordinates and fractional DPI movement.
    if !(-100_000..=100_000).contains(&x) || !(-100_000..=100_000).contains(&y) {
        return Err("贴图位置超出桌面支持范围。".into());
    }
    window
        .set_position(tauri::PhysicalPosition::new(x, y))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn resize_pin(app: AppHandle, window: WebviewWindow, scale: f64) -> Result<()> {
    let id = window
        .label()
        .strip_prefix("pin-")
        .ok_or("当前窗口不是贴图")?;
    if !scale.is_finite() || !(0.001..=5.0).contains(&scale) {
        return Err("缩放范围为 0.1%–500%。".into());
    }
    let item = lock(&app.state::<AppState>())?.item(id)?;
    window
        .set_size(tauri::PhysicalSize::new(
            (item.width as f64 * scale).clamp(96.0, 16000.0) as u32,
            (item.height as f64 * scale).clamp(72.0, 16000.0) as u32,
        ))
        .map_err(|e| e.to_string())
}
#[tauri::command]
pub async fn set_pin_opacity(window: WebviewWindow, opacity: f64) -> Result<()> {
    if !window.label().starts_with("pin-")
        || !opacity.is_finite()
        || !(0.15..=1.0).contains(&opacity)
    {
        return Err("贴图透明度范围为 15%–100%。".into());
    }
    #[cfg(windows)]
    {
        native::set_opacity(
            window.hwnd().map_err(|e| e.to_string())?.0 as isize,
            opacity,
        )?;
    }
    Ok(())
}
pub fn dispatch_capture(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(e) = start_capture(app.clone()).await {
            report(&app, e);
        }
    });
}
pub fn dispatch_paste(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(e) = paste_clipboard(app.clone()).await {
            report(&app, e);
        }
    });
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn capture_visibility_policy_is_exclusive_and_latched_until_completion() {
        let activity = CaptureActivity::default();
        assert!(!activity.load(Ordering::SeqCst));
        assert!(!activity.preserves_windows());
        activity.begin(false).unwrap();
        assert!(activity.load(Ordering::SeqCst));
        assert!(activity.preserves_windows());
        // A second request/settings choice cannot replace an active policy.
        assert!(activity.begin(true).is_err());
        assert!(activity.preserves_windows());
        activity.finish();
        assert!(!activity.load(Ordering::SeqCst));
        activity.begin(true).unwrap();
        assert!(activity.load(Ordering::SeqCst));
        assert!(!activity.preserves_windows());
        assert!(activity.begin(false).is_err());
        assert!(!activity.preserves_windows());
        activity.finish();
        activity.begin(false).unwrap(); // Failure/cancel allows a fresh capture.
        assert!(activity.preserves_windows());
    }

    #[test]
    fn capture_restore_list_excludes_minimized_hidden_and_managed_transient_windows() {
        for label in ["main", "anchor", "gallery", "pin-1"] {
            assert!(restorable_window(label, true, false));
            assert!(!restorable_window(label, true, true));
            assert!(!restorable_window(label, false, false));
        }
        for label in ["capture", "shelf", "shelf-preview", "anchor-glow"] {
            assert!(!restorable_window(label, true, false));
        }
    }

    #[test]
    fn foreground_identity_rejects_closed_reused_hidden_and_minimized_windows() {
        let saved = ForegroundTarget {
            hwnd: 123,
            process: 45,
            thread: 67,
            class: vec![65, 66],
        };
        assert!(saved.matches_live(Some(&saved), true, false, true));
        assert!(!saved.matches_live(None, true, false, true));
        assert!(!saved.matches_live(Some(&saved), false, false, true));
        assert!(!saved.matches_live(Some(&saved), true, true, true));
        assert!(!saved.matches_live(Some(&saved), true, false, false));
        for replacement in [
            ForegroundTarget {
                hwnd: 999,
                ..saved.clone()
            },
            ForegroundTarget {
                process: 999,
                ..saved.clone()
            },
            ForegroundTarget {
                thread: 999,
                ..saved.clone()
            },
            ForegroundTarget {
                class: vec![90],
                ..saved.clone()
            },
        ] {
            assert!(!saved.matches_live(Some(&replacement), true, false, true));
        }
    }
    #[test]
    fn foreground_snapshot_survives_session_teardown_and_is_consumed_only_once() {
        let saved = ForegroundTarget {
            hwnd: 123,
            process: 45,
            thread: 67,
            class: vec![65],
        };
        let mut startup = CaptureStartup {
            foreground: Some(saved.clone()),
            ..Default::default()
        };
        startup.begin("first".into());
        assert_eq!(startup.foreground.as_ref(), Some(&saved));
        assert!(!startup.cancel("stale"));
        assert_eq!(startup.foreground.as_ref(), Some(&saved));
        assert!(startup.cancel("first"));
        assert_eq!(startup.foreground.take(), Some(saved));
        assert!(startup.foreground.take().is_none());
        startup.begin("next".into());
        assert!(startup.foreground.is_none());
    }
    #[test]
    fn capture_ready_waits_for_layout_and_old_messages_cannot_cancel_new_session() {
        let mut gate = CaptureStartup::default();
        gate.begin("old".into());
        assert!(!gate.present("old").unwrap());
        assert!(gate.pending("old"));
        assert!(gate.configure("old"));
        assert!(gate.present("old").unwrap());
        assert!(!gate.pending("old")); // Late timeout cannot close a visible capture.
        assert!(gate.cancel("old"));
        gate.begin("new".into());
        assert!(gate.present("old").is_err());
        assert!(!gate.configure("old"));
        assert!(!gate.pending("old"));
        assert!(!gate.cancel("old")); // Old failure/Destroyed callback is harmless.
        assert!(gate.pending("new"));
        assert!(gate.cancel("new")); // Decode failure or timeout recovers pending state.
        assert!(!gate.cancel("new")); // Cleanup is idempotent.
        assert!(gate.present("new").is_err());
    }
    #[test]
    fn annotated_png_keeps_exact_pixels_and_rejects_bad_inputs() {
        let selection = Selection {
            x: 3,
            y: 4,
            width: 4,
            height: 2,
        };
        let image = RgbaImage::from_fn(4, 2, |x, y| image::Rgba([x as u8, y as u8, 73, 255]));
        let png = encode_png(&image).unwrap();
        let data_url = format!("data:image/png;base64,{}", STANDARD.encode(&png));
        assert_eq!(
            decode_annotated_selection(&data_url, selection).unwrap(),
            image
        );
        for invalid in [
            "data:image/jpeg;base64,AAAA".to_owned(),
            "data:image/png;base64,%%%".to_owned(),
            format!("data:image/png;base64,{}", STANDARD.encode(b"not a PNG")),
            format!(
                "data:image/png;base64,{}",
                STANDARD.encode(&png[..png.len() / 2])
            ),
        ] {
            assert!(decode_annotated_selection(&invalid, selection).is_err());
        }
        assert!(decode_annotated_selection(
            &data_url,
            Selection {
                width: 3,
                ..selection
            }
        )
        .is_err());
        let too_wide = RgbaImage::new(20001, 1);
        let too_wide_url = format!(
            "data:image/png;base64,{}",
            STANDARD.encode(encode_png(&too_wide).unwrap())
        );
        assert!(decode_annotated_selection(
            &too_wide_url,
            Selection {
                width: 20001,
                height: 1,
                ..selection
            }
        )
        .is_err());
    }

    #[test]
    fn late_annotation_result_cannot_consume_a_new_capture() {
        let frame = || {
            Arc::new(native::DesktopFrame {
                image: RgbaImage::new(2, 2),
                origin_x: 0,
                origin_y: 0,
            })
        };
        let old = frame();
        let new = frame();
        let mut capture = Some(Session {
            id: "new".into(),
            frame: new.clone(),
            png: String::new(),
            monitors: vec![],
        });
        assert!(take_matching_session(&mut capture, &old).is_err());
        assert!(Arc::ptr_eq(&capture.as_ref().unwrap().frame, &new));
        assert!(take_matching_session(&mut capture, &new).is_ok());
        assert!(take_matching_session(&mut capture, &new).is_err());
        assert!(capture.is_none());
    }

    #[test]
    fn rejects_empty_overflow_and_outside_selections() {
        for s in [
            Selection {
                x: 0,
                y: 0,
                width: 0,
                height: 1,
            },
            Selection {
                x: u32::MAX,
                y: 0,
                width: 2,
                height: 1,
            },
            Selection {
                x: 90,
                y: 0,
                width: 11,
                height: 5,
            },
            Selection {
                x: 0,
                y: 99,
                width: 1,
                height: 2,
            },
        ] {
            assert!(s.validate(100, 100).is_err());
        }
        assert!(Selection {
            x: 0,
            y: 0,
            width: 100,
            height: 100
        }
        .validate(100, 100)
        .is_ok());
    }
    #[test]
    fn capture_pin_origin_round_trips_physical_selection_across_mixed_dpi_layouts() {
        // Geometry simulation only: the native test must separately cover DPI
        // messages. Even if the source spans the seam, DPI is not applied twice.
        for dpi in [1.0, 1.25, 1.5, 2.0] {
            let left_width = (1920.0 * dpi) as u32;
            let frame = DesktopRect {
                x: -(left_width as i32),
                y: -480,
                width: left_width + 2560,
                height: 2640,
            };
            for selection in [
                Selection {
                    x: 120,
                    y: 80,
                    width: 320,
                    height: 180,
                },
                Selection {
                    x: left_width - 150,
                    y: 400,
                    width: 700,
                    height: 600,
                },
                Selection {
                    x: left_width + 2100,
                    y: 1850,
                    width: 460,
                    height: 790,
                },
            ] {
                let bounds = selection.desktop_rect(frame).unwrap();
                assert_eq!(bounds.x, frame.x + selection.x as i32);
                assert_eq!(bounds.y, frame.y + selection.y as i32);
                assert_eq!(
                    bounds.crop_inside(frame),
                    Some((selection.x, selection.y, selection.width, selection.height))
                );
            }
            let cross_monitor = Selection {
                x: left_width - 150,
                y: 400,
                width: 700,
                height: 600,
            }
            .desktop_rect(frame)
            .unwrap();
            assert_eq!(cross_monitor.x, -150);
            assert_eq!(cross_monitor.y, -80);
            assert_eq!((cross_monitor.width, cross_monitor.height), (700, 600));
        }
    }
    #[test]
    fn capture_pins_preserve_tiny_and_full_desktop_sizes_without_work_area_clamping() {
        let frame = DesktopRect {
            x: -3840,
            y: -2160,
            width: 7680,
            height: 4320,
        };
        let tiny = Selection {
            x: 7679,
            y: 4319,
            width: 1,
            height: 1,
        }
        .desktop_rect(frame)
        .unwrap();
        assert_eq!(
            tiny,
            DesktopRect {
                x: 3839,
                y: 2159,
                width: 1,
                height: 1,
            }
        );
        assert_eq!(
            Selection {
                x: 0,
                y: 0,
                width: frame.width,
                height: frame.height,
            }
            .desktop_rect(frame)
            .unwrap(),
            frame
        );
    }
    #[test]
    fn capture_pin_bounds_reject_invalid_offsets_instead_of_wrapping_or_clamping() {
        let frame = DesktopRect {
            x: -1920,
            y: -300,
            width: 4480,
            height: 1740,
        };
        for selection in [
            Selection {
                x: 0,
                y: 0,
                width: 0,
                height: 1,
            },
            Selection {
                x: 4480,
                y: 0,
                width: 1,
                height: 1,
            },
            Selection {
                x: u32::MAX,
                y: 0,
                width: 2,
                height: 1,
            },
        ] {
            assert!(selection.desktop_rect(frame).is_err());
        }
        let valid_offset = Selection {
            x: 20,
            y: 20,
            width: 1,
            height: 1,
        };
        assert!(valid_offset
            .desktop_rect(DesktopRect {
                x: i32::MAX - 10,
                ..frame
            })
            .is_err());
        assert!(valid_offset
            .desktop_rect(DesktopRect {
                y: i32::MAX - 10,
                ..frame
            })
            .is_err());
    }
    #[test]
    fn drag_anchor_stays_physical_across_negative_monitors_and_dpi_changes() {
        // Simulated DPI matrix, not a claim of testing physical mixed-DPI hardware.
        for initial_scale in [1.0, 1.25, 1.5, 2.0] {
            let anchor = DragAnchor {
                x: 120.0 * initial_scale,
                y: 60.0 * initial_scale,
            };
            for cursor in [(-2400, -800), (-25, 20), (10, 30), (2500, 1500)] {
                let position = anchored_position(cursor, anchor).unwrap();
                assert_eq!(position.0 + anchor.x as i32, cursor.0);
                assert_eq!(position.1 + anchor.y as i32, cursor.1);
            }
            // A destination monitor's DPI never rescales a global cursor coordinate.
            for destination_scale in [1.0, 1.25, 1.5, 2.0] {
                let legacy_x =
                    (2500.0 / destination_scale * initial_scale - anchor.x).round() as i32;
                if initial_scale != destination_scale {
                    assert_ne!(legacy_x, 2500 - anchor.x as i32);
                }
                assert_eq!(
                    anchored_position((-300, 50), anchor).unwrap(),
                    (-300 - anchor.x as i32, 50 - anchor.y as i32)
                );
            }
        }
        assert!(anchored_position(
            (0, 0),
            DragAnchor {
                x: f64::NAN,
                y: 0.0
            }
        )
        .is_err());
    }
    #[test]
    fn crop_retains_exact_pixels_without_scaling() {
        let image = RgbaImage::from_fn(8, 6, |x, y| image::Rgba([x as u8, y as u8, 42, 255]));
        let crop = image::imageops::crop_imm(&image, 2, 3, 4, 2).to_image();
        assert_eq!(crop.dimensions(), (4, 2));
        assert_eq!(crop.get_pixel(3, 1), &image::Rgba([5, 4, 42, 255]));
        let png = encode_png(&crop).unwrap();
        assert_eq!(image::load_from_memory(&png).unwrap().into_rgba8(), crop);
    }
}
