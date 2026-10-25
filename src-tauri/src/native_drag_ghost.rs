//! One UI-thread, click-through layered HWND for a real shelf OLE gesture.
//! The timer only reads the cursor; it never sends input or decides file drops.
use crate::{
    drag_visual::{DragCanvas, DragVisual, Sway},
    library::Result,
    native,
};
use std::{
    cell::RefCell,
    marker::PhantomData,
    ptr::null_mut,
    rc::Rc,
    sync::atomic::{AtomicU64, Ordering},
    time::{Duration, Instant},
};
use windows_sys::Win32::{
    Foundation::{HWND, POINT, SIZE},
    Graphics::{
        Dwm::{DwmSetWindowAttribute, DWMWA_TRANSITIONS_FORCEDISABLED},
        Gdi::{
            CreateCompatibleDC, CreateDIBSection, DeleteDC, DeleteObject, SelectObject, BITMAPINFO,
            BITMAPINFOHEADER, BI_RGB, BLENDFUNCTION, DIB_RGB_COLORS, HBITMAP, HDC, HGDIOBJ,
        },
    },
    UI::WindowsAndMessaging::{
        CreateWindowExW, DestroyWindow, IsWindowVisible, KillTimer, SetTimer, ShowWindow,
        SystemParametersInfoW, UpdateLayeredWindow, SPI_GETCLIENTAREAANIMATION, SW_SHOWNOACTIVATE,
        ULW_ALPHA, WS_DISABLED, WS_EX_LAYERED, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, WS_EX_TOPMOST,
        WS_EX_TRANSPARENT, WS_POPUP,
    },
};

static NEXT_TOKEN: AtomicU64 = AtomicU64::new(1);
thread_local! { static ACTIVE: RefCell<Option<Active>> = const { RefCell::new(None) }; }
struct Active {
    window: GhostWindow,
    notify: Box<dyn Fn(u64, bool)>,
    fallback: Option<Box<dyn FnOnce()>>,
}
impl Drop for Active {
    fn drop(&mut self) {
        (self.notify)(self.window.token, false);
    }
}

/// This marker deliberately prevents moving HWND/GDI lifetime to a worker.
pub struct GhostSession {
    token: u64,
    _thread: PhantomData<Rc<()>>,
}
impl Drop for GhostSession {
    fn drop(&mut self) {
        let active = ACTIVE.with(|slot| {
            let mut slot = slot.borrow_mut();
            if slot
                .as_ref()
                .is_some_and(|active| active.window.token == self.token)
            {
                slot.take()
            } else {
                None
            }
        });
        // Drop outside the RefCell borrow: DestroyWindow/COM may dispatch messages.
        drop(active);
    }
}

pub fn start(
    preview: &[u8],
    visual: DragVisual,
    scale: f64,
    notify: impl Fn(u64, bool) + 'static,
    fallback: impl FnOnce() + 'static,
) -> Result<GhostSession> {
    if ACTIVE.with(|slot| slot.borrow().is_some()) {
        return Err("拖动影像正在使用".into());
    }
    let mut enabled = 1i32;
    let system_reduced = unsafe {
        SystemParametersInfoW(
            SPI_GETCLIENTAREAANIMATION,
            0,
            (&mut enabled as *mut i32).cast(),
            0,
        )
    } != 0
        && enabled == 0;
    let token = NEXT_TOKEN.fetch_add(1, Ordering::Relaxed);
    let canvas = DragCanvas::from_png(preview, visual, scale)?;
    let point = native::cursor().ok_or("无法读取拖动位置")?;
    let mut window = GhostWindow::new(
        canvas,
        token,
        point,
        scale,
        visual.angle_deg,
        visual.reduced_motion || system_reduced,
    )?;
    window.paint(point, true)?;
    if unsafe { SetTimer(window.hwnd, token as usize, 16, Some(timer)) } == 0 {
        return Err("无法启动拖动影像刷新".into());
    }
    unsafe {
        ShowWindow(window.hwnd, SW_SHOWNOACTIVATE);
    }
    if unsafe { IsWindowVisible(window.hwnd) } == 0 {
        return Err("无法显示拖动影像".into());
    }
    notify(token, true);
    ACTIVE.with(|slot| {
        *slot.borrow_mut() = Some(Active {
            window,
            notify: Box::new(notify),
            fallback: Some(Box::new(fallback)),
        })
    });
    Ok(GhostSession {
        token,
        _thread: PhantomData,
    })
}

unsafe extern "system" fn timer(hwnd: HWND, _: u32, id: usize, _: u32) {
    refresh(Some((hwnd, id)));
}
/// OLE feedback gives immediate movement updates; the bounded timer also covers
/// desktop/non-drop targets and lets the spring settle while the hand is still.
pub fn refresh(expected: Option<(HWND, usize)>) {
    let failed = ACTIVE.with(|slot| {
        let Ok(mut slot) = slot.try_borrow_mut() else {
            return None;
        };
        let active = slot.as_mut()?;
        if expected.is_some_and(|(hwnd, token)| {
            hwnd != active.window.hwnd || token != active.window.token as usize
        }) {
            return None;
        }
        let point = native::cursor()?;
        if active.window.paint(point, false).is_err() {
            slot.take()
        } else {
            None
        }
    });
    if let Some(mut failed) = failed {
        let fallback = failed.fallback.take();
        // The custom HWND/timer is gone before Shell is allowed to create its
        // static preview; a queued old timer cannot recreate this TLS session.
        drop(failed);
        if let Some(fallback) = fallback {
            fallback();
        }
    }
}

struct GhostWindow {
    hwnd: HWND,
    dc: HDC,
    bitmap: HBITMAP,
    old_bitmap: HGDIOBJ,
    bits: *mut u8,
    canvas: DragCanvas,
    motion: Sway,
    token: u64,
    updated: Instant,
    rendered: Instant,
    last_angle: f64,
}
impl GhostWindow {
    fn new(
        canvas: DragCanvas,
        token: u64,
        point: (i32, i32),
        scale: f64,
        angle: f64,
        reduced: bool,
    ) -> Result<Self> {
        let mut result = Self {
            hwnd: null_mut(),
            dc: null_mut(),
            bitmap: null_mut(),
            old_bitmap: null_mut(),
            bits: null_mut(),
            canvas,
            motion: Sway::new(point, scale, angle, reduced),
            token,
            updated: Instant::now(),
            rendered: Instant::now(),
            last_angle: f64::NAN,
        };
        unsafe {
            // Layered+TRANSPARENT is documented to pass mouse hit testing to
            // windows underneath. DISABLED also keeps WindowFromPoint/OLE from
            // treating this decorative window as an input destination.
            result.hwnd = CreateWindowExW(
                WS_EX_LAYERED
                    | WS_EX_TRANSPARENT
                    | WS_EX_NOACTIVATE
                    | WS_EX_TOOLWINDOW
                    | WS_EX_TOPMOST,
                windows_sys::w!("STATIC"),
                windows_sys::w!("Snapline Drag Image"),
                WS_POPUP | WS_DISABLED,
                0,
                0,
                result.canvas.size as i32,
                result.canvas.size as i32,
                null_mut(),
                null_mut(),
                null_mut(),
                null_mut(),
            );
            if result.hwnd.is_null() {
                return Err("无法创建拖动影像窗口".into());
            }
            let disabled = 1i32;
            if DwmSetWindowAttribute(
                result.hwnd,
                DWMWA_TRANSITIONS_FORCEDISABLED as u32,
                (&disabled as *const i32).cast(),
                4,
            ) < 0
            {
                return Err("无法同步拖动影像窗口".into());
            }
            result.dc = CreateCompatibleDC(null_mut());
            if result.dc.is_null() {
                return Err("无法创建拖动影像画布".into());
            }
            let mut info: BITMAPINFO = std::mem::zeroed();
            info.bmiHeader = BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: result.canvas.size as i32,
                biHeight: -(result.canvas.size as i32),
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB,
                ..std::mem::zeroed()
            };
            let mut bits = null_mut();
            result.bitmap =
                CreateDIBSection(result.dc, &info, DIB_RGB_COLORS, &mut bits, null_mut(), 0);
            result.bits = bits.cast();
            if result.bitmap.is_null() || result.bits.is_null() {
                return Err("无法分配拖动影像".into());
            }
            result.old_bitmap = SelectObject(result.dc, result.bitmap);
            if result.old_bitmap.is_null() || result.old_bitmap as isize == -1 {
                return Err("无法准备拖动影像".into());
            }
        }
        Ok(result)
    }
    fn paint(&mut self, point: (i32, i32), force: bool) -> Result<()> {
        let now = Instant::now();
        self.motion
            .step(point, now.duration_since(self.updated).as_secs_f64());
        self.updated = now;
        let redraw = force
            || (!self.last_angle.is_finite())
            || ((self.motion.angle - self.last_angle).abs() >= 0.15
                && now.duration_since(self.rendered) >= Duration::from_millis(12));
        // Position must use the last rendered angle, not a newer unpainted pose,
        // otherwise the held image point would slip under a stationary cursor.
        let angle = if redraw {
            self.motion.angle
        } else {
            self.last_angle
        };
        let (x, y) = self.canvas.origin(point, angle);
        let destination = POINT { x, y };
        let success = unsafe {
            if redraw {
                let pixels = std::slice::from_raw_parts_mut(
                    self.bits,
                    (self.canvas.size * self.canvas.size * 4) as usize,
                );
                self.canvas.render(angle, pixels);
                let size = SIZE {
                    cx: self.canvas.size as i32,
                    cy: self.canvas.size as i32,
                };
                let source = POINT { x: 0, y: 0 };
                let blend = BLENDFUNCTION {
                    BlendOp: 0,
                    BlendFlags: 0,
                    SourceConstantAlpha: 255,
                    AlphaFormat: 1,
                };
                UpdateLayeredWindow(
                    self.hwnd,
                    null_mut(),
                    &destination,
                    &size,
                    self.dc,
                    &source,
                    0,
                    &blend,
                    ULW_ALPHA,
                )
            } else {
                UpdateLayeredWindow(
                    self.hwnd,
                    null_mut(),
                    &destination,
                    std::ptr::null(),
                    null_mut(),
                    std::ptr::null(),
                    0,
                    std::ptr::null(),
                    0,
                )
            }
        };
        if success == 0 {
            return Err("拖动影像刷新失败".into());
        }
        if redraw {
            self.last_angle = angle;
            self.rendered = now;
        }
        Ok(())
    }
}
impl Drop for GhostWindow {
    fn drop(&mut self) {
        unsafe {
            if !self.hwnd.is_null() {
                KillTimer(self.hwnd, self.token as usize);
                DestroyWindow(self.hwnd);
            }
            if !self.dc.is_null() && !self.old_bitmap.is_null() && self.old_bitmap as isize != -1 {
                SelectObject(self.dc, self.old_bitmap);
            }
            if !self.bitmap.is_null() {
                DeleteObject(self.bitmap);
            }
            if !self.dc.is_null() {
                DeleteDC(self.dc);
            }
        }
    }
}
