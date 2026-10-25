//! Windows file dragging. Construct the same Shell IDataObject in production and
//! protocol tests. Tests may transfer files to an isolated Windows Shell folder
//! drop target, but never enter DoDragDrop or simulate cross-window mouse input.
use std::{
    os::windows::ffi::OsStrExt,
    path::PathBuf,
    sync::{Arc, Mutex},
    time::Instant,
};
use windows::{
    core::{implement, Error, Result, HRESULT, PCWSTR},
    Win32::{
        Foundation::{
            BOOL, COLORREF, DRAGDROP_S_CANCEL, DRAGDROP_S_DROP, DRAGDROP_S_USEDEFAULTCURSORS,
            E_INVALIDARG, E_POINTER, POINT, SIZE, S_OK,
        },
        Graphics::Gdi::{
            CreateDIBSection, DeleteObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS,
            HBITMAP,
        },
        System::{
            Com::{CoCreateInstance, CoTaskMemFree, IDataObject, CLSCTX_INPROC_SERVER},
            Ole::{
                DoDragDrop, IDropSource, IDropSource_Impl, OleInitialize, OleUninitialize,
                DROPEFFECT, DROPEFFECT_COPY,
            },
            SystemServices::{MK_LBUTTON, MODIFIERKEYS_FLAGS},
        },
        UI::Shell::{
            BHID_DataObject, CLSID_DragDropHelper, Common::ITEMIDLIST, IDragSourceHelper,
            SHCreateShellItemArrayFromIDLists, SHParseDisplayName, SHDRAGIMAGE,
        },
    },
};

struct Apartment;
impl Apartment {
    fn enter() -> Result<Self> {
        unsafe {
            OleInitialize(None)?;
        }
        Ok(Self)
    }
}
impl Drop for Apartment {
    fn drop(&mut self) {
        unsafe {
            OleUninitialize();
        }
    }
}
struct OwnedPidl(*mut ITEMIDLIST);
impl Drop for OwnedPidl {
    fn drop(&mut self) {
        unsafe {
            CoTaskMemFree(Some(self.0.cast()));
        }
    }
}
struct Bitmap(HBITMAP);
impl Drop for Bitmap {
    fn drop(&mut self) {
        unsafe {
            let _ = DeleteObject(self.0);
        }
    }
}

/// Must be called in an initialized COM apartment. Shell copies the PIDLs into
/// its array; release every original allocation even when a later path fails.
fn file_data_object(paths: &[PathBuf]) -> Result<IDataObject> {
    if paths.is_empty() || paths.len() > 200 {
        return Err(Error::from(E_INVALIDARG));
    }
    let mut owned = Vec::with_capacity(paths.len());
    for path in paths {
        if !path.is_absolute() || !path.is_file() {
            return Err(Error::from(E_INVALIDARG));
        }
        let wide: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
        let mut pidl = OwnedPidl(std::ptr::null_mut());
        unsafe {
            SHParseDisplayName(PCWSTR(wide.as_ptr()), None, &mut pidl.0, 0, None)?;
        }
        if pidl.0.is_null() {
            return Err(Error::from(E_POINTER));
        }
        owned.push(pidl);
    }
    let list: Vec<_> = owned.iter().map(|pidl| pidl.0.cast_const()).collect();
    unsafe { SHCreateShellItemArrayFromIDLists(&list)?.BindToHandler(None, &BHID_DataObject) }
}

#[implement(IDropSource)]
struct DropSource {
    gesture: Arc<Mutex<DragGesture>>,
}
struct DragGesture {
    detector: Option<crate::shelf_shake::ShakeDetector>,
    started: Instant,
    dismissed: bool,
}
impl DragGesture {
    fn sample(&mut self) -> bool {
        if let (Some(detector), Some(point)) = (self.detector.as_mut(), crate::native::cursor()) {
            self.dismissed |= detector.sample(point, self.started.elapsed().as_millis() as u64);
        }
        self.dismissed
    }
    fn continuation(&mut self, escape: bool, held: bool) -> HRESULT {
        if escape {
            // Escape always wins, including a pending shake seen in GiveFeedback.
            self.dismissed = false;
            return DRAGDROP_S_CANCEL;
        }
        if self.sample() {
            DRAGDROP_S_CANCEL
        } else if !held {
            DRAGDROP_S_DROP
        } else {
            S_OK
        }
    }
}
#[allow(non_snake_case)]
impl IDropSource_Impl for DropSource {
    fn QueryContinueDrag(&self, escape: BOOL, keys: MODIFIERKEYS_FLAGS) -> HRESULT {
        self.gesture
            .lock()
            .map(|mut gesture| {
                gesture.continuation(
                    escape.as_bool(),
                    (keys & MK_LBUTTON) != MODIFIERKEYS_FLAGS(0),
                )
            })
            .unwrap_or(DRAGDROP_S_CANCEL)
    }
    fn GiveFeedback(&self, _: DROPEFFECT) -> HRESULT {
        // OLE calls this on real cursor movement even when no button state
        // changes. Only QueryContinueDrag may cancel the OLE operation.
        if let Ok(mut gesture) = self.gesture.lock() {
            gesture.sample();
        }
        // Never enter the UI/GDI path while the gesture mutex is held: COM and
        // window messages can reenter feedback while resolving another target.
        crate::native_drag_ghost::refresh(None);
        DRAGDROP_S_USEDEFAULTCURSORS
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DragOutcome {
    Finished,
    Cancelled,
    ShelfDismissed,
}

fn preview_bitmap(png: &[u8]) -> crate::library::Result<(Bitmap, u32, u32)> {
    if png.len() > 4 * 1024 * 1024 {
        return Err("拖动预览图片过大".into());
    }
    let mut reader =
        image::ImageReader::with_format(std::io::Cursor::new(png), image::ImageFormat::Png);
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(1024);
    limits.max_image_height = Some(1024);
    limits.max_alloc = Some(8 * 1024 * 1024);
    reader.limits(limits);
    let image = reader.decode().map_err(|_| "拖动预览图片无效")?;
    let image = if image.width() > 320 || image.height() > 240 {
        image.thumbnail(320, 240)
    } else {
        image
    }
    .into_rgba8();
    let (width, height) = image.dimensions();
    let info = BITMAPINFO {
        bmiHeader: BITMAPINFOHEADER {
            biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: width as i32,
            biHeight: -(height as i32),
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB.0,
            ..Default::default()
        },
        ..Default::default()
    };
    let mut bits = std::ptr::null_mut();
    let bitmap = Bitmap(
        unsafe { CreateDIBSection(None, &info, DIB_RGB_COLORS, &mut bits, None, 0) }
            .map_err(|e| e.to_string())?,
    );
    if bits.is_null() {
        return Err("无法创建拖动预览".into());
    }
    let pixels =
        unsafe { std::slice::from_raw_parts_mut(bits.cast::<u8>(), (width * height * 4) as usize) };
    for (dest, src) in pixels.as_chunks_mut::<4>().0.iter_mut().zip(image.pixels()) {
        // InitializeFromBitmap applies premultiplication itself; supply straight BGRA.
        dest.copy_from_slice(&[src[2], src[1], src[0], src[3]]);
    }
    Ok((bitmap, width, height))
}

fn system_preview(data: &IDataObject, preview: &[u8]) {
    // A missing preview must not prevent an otherwise valid file drag.
    if let Ok((bitmap, width, height)) = preview_bitmap(preview) {
        unsafe {
            if let Ok(helper) = CoCreateInstance::<_, IDragSourceHelper>(
                &CLSID_DragDropHelper,
                None,
                CLSCTX_INPROC_SERVER,
            ) {
                let image = SHDRAGIMAGE {
                    sizeDragImage: SIZE {
                        cx: width as i32,
                        cy: height as i32,
                    },
                    ptOffset: POINT {
                        x: (width / 2) as i32,
                        y: (height / 2) as i32,
                    },
                    hbmpDragImage: bitmap.0,
                    crColorKey: COLORREF(0xffff_ffff),
                };
                if helper.InitializeFromBitmap(&image, data).is_ok() {
                    // The helper takes ownership on successful initialization.
                    // Do not DeleteObject a consumed (potentially reused) handle.
                    std::mem::forget(bitmap);
                }
            }
        }
    }
}

/// UI-thread entry. OleInitialize/Uninitialize are balanced on this same thread;
/// no interface, PIDL or image handle crosses an await or enters a worker thread.
pub fn start_file_drag(
    path: PathBuf,
    preview: &[u8],
    shake_scale: Option<f64>,
    visual: Option<(crate::drag_visual::DragVisual, f64)>,
    notify: impl Fn(u64, bool) + 'static,
) -> crate::library::Result<DragOutcome> {
    let _apartment = Apartment::enter().map_err(|_| "Windows 拖放接口未就绪，请重试。")?;
    let data = file_data_object(&[path]).map_err(|_| "无法准备拖出文件，请确认图片仍可访问。")?;
    let ghost = visual.and_then(|(visual, scale)| {
        let fallback_data = data.clone();
        let fallback_preview = preview.to_vec();
        match crate::native_drag_ghost::start(preview, visual, scale, notify, move || {
            system_preview(&fallback_data, &fallback_preview);
        }) {
            Ok(session) => Some(session),
            Err(error) => {
                if std::env::var_os("SNAPLINE_TRACE_ISLAND").is_some() {
                    eprintln!("[shelf-drag] visual fallback: {error}");
                }
                None
            }
        }
    });
    // Register only one drag-image owner. Main-window drags and failed native
    // visual initialization retain the existing Windows Shell static preview.
    if ghost.is_none() {
        system_preview(&data, preview);
    }
    let gesture = Arc::new(Mutex::new(DragGesture {
        detector: shake_scale.map(crate::shelf_shake::ShakeDetector::new),
        started: Instant::now(),
        dismissed: false,
    }));
    if let Ok(mut state) = gesture.lock() {
        state.sample();
    }
    let source: IDropSource = DropSource {
        gesture: gesture.clone(),
    }
    .into();
    let mut effect = DROPEFFECT::default();
    let result = unsafe { DoDragDrop(&data, &source, DROPEFFECT_COPY, &mut effect) };
    // No delayed fade after release: a ghost must never survive its OLE session,
    // including Escape, accepted external drops and a latched shake cancellation.
    drop(ghost);
    if result == DRAGDROP_S_DROP {
        Ok(DragOutcome::Finished)
    } else if result == DRAGDROP_S_CANCEL {
        Ok(
            if gesture.lock().map(|state| state.dismissed).unwrap_or(false) {
                DragOutcome::ShelfDismissed
            } else {
                DragOutcome::Cancelled
            },
        )
    } else {
        Err("Windows 未能完成文件拖放，请重试。".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::windows::ffi::OsStringExt;
    use windows::Win32::{
        System::{
            Com::{DVASPECT_CONTENT, FORMATETC, TYMED_HGLOBAL},
            Ole::{ReleaseStgMedium, CF_HDROP},
        },
        UI::Shell::{DragQueryFileW, HDROP},
    };

    #[test]
    fn native_shell_data_object_roundtrips_unicode_files_without_drop() {
        let _apartment = Apartment::enter().unwrap();
        let temp = tempfile::tempdir_in(env!("CARGO_MANIFEST_DIR")).unwrap();
        let mut paths = vec![];
        for (name, bytes) in [
            ("截图, with spaces.png", b"first".as_slice()),
            ("另一张 🖼.png", b"second".as_slice()),
        ] {
            let path = temp.path().join(name);
            std::fs::write(&path, bytes).unwrap();
            paths.push(crate::native::external_file_path(&path).unwrap());
        }
        let data = file_data_object(&paths).unwrap();
        let format = FORMATETC {
            cfFormat: CF_HDROP.0,
            dwAspect: DVASPECT_CONTENT.0,
            lindex: -1,
            tymed: TYMED_HGLOBAL.0 as u32,
            ..Default::default()
        };
        unsafe {
            assert!(data.QueryGetData(&format).is_ok());
            let mut medium = data.GetData(&format).unwrap();
            let drop = HDROP(medium.u.hGlobal.0 as isize);
            let count = DragQueryFileW(drop, u32::MAX, None);
            assert_eq!(count as usize, paths.len());
            for (i, path) in paths.iter().enumerate() {
                let length = DragQueryFileW(drop, i as u32, None);
                let mut name = vec![0; length as usize + 1];
                assert_eq!(DragQueryFileW(drop, i as u32, Some(&mut name)), length);
                let decoded =
                    PathBuf::from(std::ffi::OsString::from_wide(&name[..length as usize]));
                assert_eq!(&decoded, path);
                assert_eq!(
                    std::fs::read(decoded).unwrap(),
                    std::fs::read(path).unwrap()
                );
            }
            ReleaseStgMedium(&mut medium);
        }
        assert!(file_data_object(&[]).is_err());
        assert!(file_data_object(&[paths[0].clone(), temp.path().join("missing.png")]).is_err());
        assert!(paths.iter().all(|p| p.is_file()));
    }

    /// Exercise the real Windows Shell's receiver as well as our production
    /// source IDataObject. This is COM protocol integration, not a UI drag test.
    #[test]
    fn windows_shell_drop_target_copies_unicode_images_and_preserves_sources() {
        use windows::Win32::{
            Foundation::POINTL,
            System::{Ole::IDropTarget, SystemServices::MK_CONTROL},
            UI::Shell::{BHID_SFUIObject, IShellItem, SHCreateItemFromParsingName},
        };

        let _apartment = Apartment::enter().unwrap();
        let temp = tempfile::tempdir_in(env!("CARGO_MANIFEST_DIR")).unwrap();
        let destination = temp.path().join("external receiver 文件夹");
        std::fs::create_dir(&destination).unwrap();
        let mut sources = Vec::new();
        for (name, color) in [
            ("截图, with spaces.png", [211, 43, 71, 255]),
            ("透明图 🖼.png", [32, 113, 92, 127]),
        ] {
            let path = temp.path().join(name);
            image::RgbaImage::from_pixel(23, 17, image::Rgba(color))
                .save(&path)
                .unwrap();
            sources.push(crate::native::external_file_path(&path).unwrap());
        }
        let data = file_data_object(&sources).unwrap();
        let folder = crate::native::shell_path(&destination.canonicalize().unwrap());
        let wide: Vec<u16> = folder.as_os_str().encode_wide().chain(Some(0)).collect();
        let point = POINTL { x: 0, y: 0 }; // No HWND or physical pointer is involved.
        unsafe {
            let item: IShellItem =
                SHCreateItemFromParsingName(PCWSTR(wide.as_ptr()), None).unwrap();
            let target: IDropTarget = item.BindToHandler(None, &BHID_SFUIObject).unwrap();
            let mut effect = DROPEFFECT_COPY;
            target
                .DragEnter(&data, MK_LBUTTON | MK_CONTROL, point, &mut effect)
                .unwrap();
            assert_eq!(effect, DROPEFFECT_COPY);
            target.DragLeave().unwrap();
            assert_eq!(std::fs::read_dir(&destination).unwrap().count(), 0);

            effect = DROPEFFECT_COPY;
            // Production allows COPY only. Even on the same volume, dragging
            // without Ctrl must not turn this into the Shell's usual move.
            target
                .DragEnter(&data, MK_LBUTTON, point, &mut effect)
                .unwrap();
            assert_eq!(effect, DROPEFFECT_COPY);
            target.DragOver(MK_LBUTTON, point, &mut effect).unwrap();
            assert_eq!(effect, DROPEFFECT_COPY);
            target
                .Drop(&data, MODIFIERKEYS_FLAGS(0), point, &mut effect)
                .unwrap();
            assert_eq!(effect, DROPEFFECT_COPY);
        }
        assert_eq!(std::fs::read_dir(&destination).unwrap().count(), 2);
        for source in &sources {
            let copied = destination.join(source.file_name().unwrap());
            assert!(source.is_file(), "Copy must preserve the source");
            assert_eq!(
                std::fs::read(&copied).unwrap(),
                std::fs::read(source).unwrap()
            );
            let image = image::open(copied).unwrap();
            assert_eq!((image.width(), image.height()), (23, 17));
        }
        eprintln!("Windows Shell protocol transfer: 2 Unicode PNG files copied byte-for-byte, source files preserved; DragLeave copied no files. No window input was simulated.");
    }

    #[test]
    fn drop_source_distinguishes_cancel_release_and_continuation() {
        let source = DropSource {
            gesture: Arc::new(Mutex::new(DragGesture {
                detector: None,
                started: Instant::now(),
                dismissed: false,
            })),
        };
        assert_eq!(
            source.QueryContinueDrag(BOOL(1), MK_LBUTTON),
            DRAGDROP_S_CANCEL
        );
        assert_eq!(
            source.QueryContinueDrag(BOOL(0), MODIFIERKEYS_FLAGS(0)),
            DRAGDROP_S_DROP
        );
        assert_eq!(source.QueryContinueDrag(BOOL(0), MK_LBUTTON), S_OK);
    }

    #[test]
    fn escape_overrides_a_latched_shake_and_release_cancels_before_file_drop() {
        let mut gesture = DragGesture {
            detector: None,
            started: Instant::now(),
            dismissed: true,
        };
        assert_eq!(gesture.continuation(false, false), DRAGDROP_S_CANCEL);
        assert!(gesture.dismissed);
        assert_eq!(gesture.continuation(true, true), DRAGDROP_S_CANCEL);
        assert!(!gesture.dismissed);
    }

    #[test]
    fn native_drag_preview_preserves_straight_alpha_and_releases_bitmap() {
        use windows::Win32::Graphics::Gdi::{GetObjectW, DIBSECTION};
        let image = image::RgbaImage::from_pixel(2, 1, image::Rgba([200, 30, 50, 128]));
        let mut png = std::io::Cursor::new(Vec::new());
        image.write_to(&mut png, image::ImageFormat::Png).unwrap();
        let (bitmap, width, height) = preview_bitmap(png.get_ref()).unwrap();
        assert_eq!((width, height), (2, 1));
        let mut dib = DIBSECTION::default();
        let handle = bitmap.0;
        unsafe {
            assert_ne!(
                GetObjectW(
                    handle,
                    std::mem::size_of::<DIBSECTION>() as i32,
                    Some((&mut dib as *mut DIBSECTION).cast())
                ),
                0
            );
            let bytes = std::slice::from_raw_parts(dib.dsBm.bmBits.cast::<u8>(), 8);
            assert_eq!(bytes, &[50, 30, 200, 128, 50, 30, 200, 128]);
        }
        drop(bitmap);
        unsafe {
            assert_eq!(
                GetObjectW(
                    handle,
                    std::mem::size_of::<DIBSECTION>() as i32,
                    Some((&mut dib as *mut DIBSECTION).cast())
                ),
                0
            );
        }
        assert!(preview_bitmap(b"invalid PNG").is_err());
    }

    #[test]
    fn shell_drag_helper_consumes_bitmap_without_starting_a_drag() {
        use windows::Win32::Graphics::Gdi::{GetObjectW, BITMAP};
        let _apartment = Apartment::enter().unwrap();
        let temp = tempfile::tempdir_in(env!("CARGO_MANIFEST_DIR")).unwrap();
        let file = temp.path().join("preview-source.png");
        let pixels = image::RgbaImage::from_pixel(4, 4, image::Rgba([20, 30, 40, 128]));
        pixels.save(&file).unwrap();
        let data = file_data_object(&[crate::native::external_file_path(&file).unwrap()]).unwrap();
        let (bitmap, width, height) = preview_bitmap(&std::fs::read(file).unwrap()).unwrap();
        let handle = bitmap.0;
        let mut object = BITMAP::default();
        unsafe {
            let helper: IDragSourceHelper =
                CoCreateInstance(&CLSID_DragDropHelper, None, CLSCTX_INPROC_SERVER).unwrap();
            let image = SHDRAGIMAGE {
                sizeDragImage: SIZE {
                    cx: width as i32,
                    cy: height as i32,
                },
                ptOffset: POINT { x: 0, y: 0 },
                hbmpDragImage: handle,
                crColorKey: COLORREF(0xffff_ffff),
            };
            assert_ne!(
                GetObjectW(
                    handle,
                    std::mem::size_of::<BITMAP>() as i32,
                    Some((&mut object as *mut BITMAP).cast())
                ),
                0
            );
            helper.InitializeFromBitmap(&image, &data).unwrap();
            std::mem::forget(bitmap); // Successful helper call owns this handle.
            let after_initialize = GetObjectW(
                handle,
                std::mem::size_of::<BITMAP>() as i32,
                Some((&mut object as *mut BITMAP).cast()),
            );
            drop(helper);
            drop(data);
            let after_release = GetObjectW(
                handle,
                std::mem::size_of::<BITMAP>() as i32,
                Some((&mut object as *mut BITMAP).cast()),
            );
            eprintln!("InitializeFromBitmap handle probe: after initialize={after_initialize}, after helper/data release={after_release}");
            assert_eq!(after_release, 0);
        }
    }
}
