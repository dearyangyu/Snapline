mod anchor_glow;
mod capture;
mod desktop_geometry;
mod drag_visual;
mod library;
mod shelf_anchor;
mod shelf_preview;
#[cfg(windows)]
mod shelf_shake;
mod shortcuts;
use capture::*;
use shelf_anchor::*;
use shelf_preview::*;
mod native;
#[cfg(windows)]
mod native_drag;
#[cfg(windows)]
mod native_drag_ghost;

use base64::{engine::general_purpose::STANDARD, Engine};
use library::{now_ms, AppSnapshot, Library, Result, Settings};
use std::{
    collections::HashMap,
    io::Cursor,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering},
        Mutex,
    },
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_autostart::ManagerExt as AutostartExt;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_global_shortcut::ShortcutState;

struct AppState {
    library: Mutex<Library>,
    shelf_until: AtomicU64,
    shelf_manual: AtomicBool,
    capture_active: capture::CaptureActivity,
    capture: Mutex<Option<capture::Session>>,
    capture_startup: Mutex<capture::CaptureStartup>,
    hidden_windows: Mutex<Vec<String>>,
    settings_busy: AtomicBool,
    shortcut_warnings: Mutex<Vec<String>>,
    copied_sequence: AtomicU32,
    dragging: AtomicBool,
}

fn lock(state: &AppState) -> Result<std::sync::MutexGuard<'_, Library>> {
    state
        .library
        .lock()
        .map_err(|_| "资料库忙，请重启应用。".into())
}

fn publish(app: &AppHandle, peek: bool) -> Result<AppSnapshot> {
    let state = app.state::<AppState>();
    let snapshot = lock(&state)?.snapshot();
    for (label, w) in app.webview_windows() {
        if let Some(id) = label.strip_prefix("pin-") {
            if !snapshot.items.iter().any(|item| item.id == id) {
                let _ = w.destroy();
            }
        }
    }
    let _ = app.emit("library-changed", &snapshot);
    if peek
        && snapshot.settings.peek_on_capture
        && !state.capture_active.load(Ordering::SeqCst)
        && app.get_webview_window("gallery").is_none()
        && !native::foreground_is_fullscreen()
    {
        let _ = reveal_shelf(app, 3500);
    }
    Ok(snapshot)
}

fn report(app: &AppHandle, message: impl ToString) {
    let _ = app.emit("app-error", message.to_string());
}

fn reveal_shelf(app: &AppHandle, hold_ms: u64) -> Result<()> {
    shelf_anchor::reveal(app, hold_ms)
}

fn toggle_shelf(app: &AppHandle) {
    if app
        .state::<AppState>()
        .capture_active
        .load(Ordering::SeqCst)
    {
        return;
    }
    if let Some(w) = app.get_webview_window("shelf") {
        if w.is_visible().unwrap_or(false) || shelf_anchor::shelf_requested(app) {
            let _ = shelf_anchor::close_shelf(app);
        } else {
            app.state::<AppState>()
                .shelf_manual
                .store(true, Ordering::SeqCst);
            if let Err(e) = reveal_shelf(app, 0) {
                report(app, e);
            }
        }
    }
}

#[tauri::command]
fn get_state(state: State<'_, AppState>) -> Result<AppSnapshot> {
    Ok(lock(&state)?.snapshot())
}

#[tauri::command]
fn get_startup_warnings(state: State<'_, AppState>) -> Result<Vec<String>> {
    state
        .shortcut_warnings
        .lock()
        .map(|warnings| warnings.clone())
        .map_err(|_| "快捷键状态不可用".into())
}

#[tauri::command]
async fn import_files(
    app: AppHandle,
    window: WebviewWindow,
    paths: Option<Vec<String>>,
) -> Result<AppSnapshot> {
    let paths: Vec<PathBuf> = match paths {
        Some(paths) => paths.into_iter().map(PathBuf::from).collect(),
        None => app
            .dialog()
            .file()
            .set_parent(&window)
            .set_title("选择图片或视频")
            .add_filter("图片和视频", library::EXTENSIONS)
            .blocking_pick_files()
            .unwrap_or_default()
            .into_iter()
            .filter_map(|p| p.into_path().ok())
            .collect(),
    };
    if paths.len() > 200 {
        return Err("每次最多导入 200 个文件。".into());
    }
    let state = app.state::<AppState>();
    let mut failures = Vec::new();
    {
        let mut lib = lock(&state)?;
        for path in paths {
            if let Err(e) = lib.import(&path, "import") {
                failures.push(format!(
                    "{}: {e}",
                    path.file_name().unwrap_or_default().to_string_lossy()
                ));
            }
        }
    }
    if !failures.is_empty() {
        report(&app, failures.join("\n"));
    }
    publish(&app, false)
}

#[tauri::command]
async fn choose_watch_folder(app: AppHandle, window: WebviewWindow) -> Result<AppSnapshot> {
    if let Some(path) = app
        .dialog()
        .file()
        .set_parent(&window)
        .set_title("选择自动收集文件夹")
        .blocking_pick_folder()
        .and_then(|p| p.into_path().ok())
    {
        let state = app.state::<AppState>();
        let mut lib = lock(&state)?;
        let path = path.to_string_lossy().into_owned();
        if !lib.settings.watch_folders.contains(&path) {
            lib.settings.watch_folders.push(path);
            lib.persist()?;
        }
    }
    publish(&app, false)
}

struct SettingsBusy<'a>(&'a AtomicBool);
impl Drop for SettingsBusy<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}
fn settings_guard(state: &AppState) -> Result<SettingsBusy<'_>> {
    state
        .settings_busy
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .map_err(|_| "设置正在保存，请稍后重试。")?;
    Ok(SettingsBusy(&state.settings_busy))
}

#[tauri::command]
async fn set_pin_double_click_action(app: AppHandle, action: String) -> Result<AppSnapshot> {
    library::validate_pin_double_click_action(&action)?;
    let state = app.state::<AppState>();
    let _busy = settings_guard(&state)?;
    lock(&state)?.set_pin_double_click_action(action)?;
    publish(&app, false)
}

#[tauri::command]
async fn update_settings(app: AppHandle, mut settings: Settings) -> Result<AppSnapshot> {
    library::validate_pin_double_click_action(&settings.pin_double_click_action)?;
    library::validate_shelf_hover_delay(settings.shelf_hover_delay_ms)?;
    library::validate_island_pets(&settings.island_pets)?;
    settings.max_items = settings.max_items.clamp(20, 1000);
    if !["system", "light", "dark"].contains(&settings.theme.as_str()) {
        settings.theme = "system".into();
    }
    if settings.watch_folders.len() > 32 {
        return Err("最多监听 32 个文件夹。".into());
    }
    settings.watch_folders.retain(|p| !p.trim().is_empty());
    settings.watch_folders.sort();
    settings.watch_folders.dedup();
    let state = app.state::<AppState>();
    let _busy = settings_guard(&state)?;
    let mut old = lock(&state)?.settings.clone();
    // Dragging the entry is a separate targeted transaction. A settings form
    // opened before that drag must not replace the newly saved location.
    settings.shelf_anchor = old.shelf_anchor.clone();
    let added = shortcuts::prepare(&app, &old, &settings)?;
    let result = (|| -> Result<()> {
        if old.start_at_login != settings.start_at_login {
            let manager = app.autolaunch();
            if settings.start_at_login {
                manager.enable()
            } else {
                manager.disable()
            }
            .map_err(|e| format!("无法更改开机启动: {e}"))?;
        }
        let mut lib = lock(&state)?;
        // A drag may have completed while autostart/shortcut preparation ran.
        // Re-read the native-owned field at the actual transaction boundary.
        settings.shelf_anchor = lib.settings.shelf_anchor.clone();
        old.shelf_anchor = settings.shelf_anchor.clone();
        lib.settings = settings.clone();
        if let Err(e) = lib.persist() {
            lib.settings = old.clone();
            return Err(e);
        }
        // Defer pruning until the settings transaction is durably saved.
        lib.prune()?;
        lib.persist()?;
        Ok(())
    })();
    if let Err(e) = result {
        shortcuts::rollback(&app, &added);
        if let Ok(mut lib) = lock(&state) {
            old.shelf_anchor = lib.settings.shelf_anchor.clone();
            lib.settings = old.clone();
            let _ = lib.persist();
        }
        if old.start_at_login != settings.start_at_login {
            let manager = app.autolaunch();
            let _ = if old.start_at_login {
                manager.enable()
            } else {
                manager.disable()
            };
        }
        return Err(e);
    }
    shortcuts::commit(&app, &old, &settings);
    shortcuts::refresh_warnings(&app, &settings);
    if !settings.shelf_hover_preview {
        shelf_preview::close(app.clone()).await?;
    }
    publish(&app, false)
}

#[tauri::command]
async fn set_shelf_hidden(
    app: AppHandle,
    window: WebviewWindow,
    id: String,
    hidden: bool,
) -> Result<AppSnapshot> {
    lock(&app.state::<AppState>())?.set_shelf_hidden(&id, hidden)?;
    if hidden {
        shelf_preview::close(app.clone()).await?;
        if window.label() == "shelf" {
            app.state::<AppState>()
                .shelf_until
                .fetch_max(now_ms() + 1200, Ordering::Relaxed);
        }
    }
    publish(&app, false)
}

#[tauri::command]
async fn copy_item(app: AppHandle, id: String) -> Result<()> {
    let item = lock(&app.state::<AppState>())?.item(&id)?;
    if item.kind != "image" {
        return Err("视频请使用拖拽或导出。".into());
    }
    let img = library::decode_image(Path::new(&item.path))?.into_rgba8();
    let mut clipboard = arboard::Clipboard::new().map_err(|e| e.to_string())?;
    clipboard
        .set_image(arboard::ImageData {
            width: img.width() as usize,
            height: img.height() as usize,
            bytes: std::borrow::Cow::Owned(img.into_raw()),
        })
        .map_err(|e| e.to_string())?;
    app.state::<AppState>()
        .copied_sequence
        .store(native::clipboard_sequence(), Ordering::SeqCst);
    Ok(())
}

#[tauri::command]
async fn export_item(app: AppHandle, window: WebviewWindow, id: String) -> Result<()> {
    let item = lock(&app.state::<AppState>())?.item(&id)?;
    if let Some(path) = app
        .dialog()
        .file()
        .set_parent(&window)
        .set_title("导出副本")
        .set_file_name(&item.name)
        .blocking_save_file()
        .and_then(|p| p.into_path().ok())
    {
        if path == Path::new(&item.path) {
            return Ok(());
        }
        std::fs::copy(&item.path, path).map_err(|e| format!("导出失败: {e}"))?;
    }
    Ok(())
}

#[tauri::command]
async fn remove_item(app: AppHandle, id: String) -> Result<AppSnapshot> {
    lock(&app.state::<AppState>())?.remove(&id)?;
    if let Some(w) = app.get_webview_window(&format!("pin-{id}")) {
        let _ = w.destroy();
    }
    publish(&app, false)
}

#[tauri::command]
async fn toggle_pin(app: AppHandle, id: String) -> Result<AppSnapshot> {
    {
        let state = app.state::<AppState>();
        let mut lib = lock(&state)?;
        let item = lib
            .items
            .iter_mut()
            .find(|i| i.id == id)
            .ok_or("该项目已被移除")?;
        item.pinned = !item.pinned;
        lib.persist()?;
    }
    publish(&app, false)
}

#[tauri::command]
async fn clear_unpinned(app: AppHandle) -> Result<AppSnapshot> {
    {
        let state = app.state::<AppState>();
        let mut lib = lock(&state)?;
        let ids: Vec<_> = lib
            .items
            .iter()
            .filter(|i| {
                !i.pinned && !lib.active_pins.contains(&i.id) && !lib.active_drags.contains(&i.id)
            })
            .map(|i| i.id.clone())
            .collect();
        for id in ids {
            lib.remove(&id)?;
        }
    }
    publish(&app, false)
}

#[tauri::command]
async fn open_item(app: AppHandle, id: String) -> Result<()> {
    let item = lock(&app.state::<AppState>())?.item(&id)?;
    open::that(native::external_file_path(Path::new(&item.path))?).map_err(|e| e.to_string())
}

#[tauri::command]
async fn reveal_item(app: AppHandle, id: String) -> Result<()> {
    let item = lock(&app.state::<AppState>())?.item(&id)?;
    #[cfg(windows)]
    {
        let (send, mut receive) = tauri::async_runtime::channel(1);
        std::thread::spawn(move || {
            let _ = send.blocking_send(native::reveal_path(Path::new(&item.path)));
        });
        receive.recv().await.ok_or("资源管理器请求未完成")??;
    }
    #[cfg(not(windows))]
    {
        open::that(Path::new(&item.path).parent().unwrap()).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn show_main(app: AppHandle) -> Result<()> {
    show_main_now(&app)
}

fn show_main_now(app: &AppHandle) -> Result<()> {
    let w = app.get_webview_window("main").ok_or("主窗口尚未就绪")?;
    w.show().map_err(|e| e.to_string())?;
    let _ = w.unminimize();
    w.set_focus().map_err(|e| e.to_string())
}

#[tauri::command]
async fn hide_shelf(app: AppHandle) -> Result<()> {
    shelf_preview::close(app.clone()).await?;
    shelf_anchor::close_shelf(&app)
}

struct FileDragLease {
    app: AppHandle,
    id: String,
}
impl Drop for FileDragLease {
    fn drop(&mut self) {
        let state = self.app.state::<AppState>();
        if let Ok(mut lib) = lock(&state) {
            lib.active_drags.remove(&self.id);
        }
        state.dragging.store(false, Ordering::SeqCst);
        state.shelf_until.store(now_ms() + 1200, Ordering::Relaxed);
    }
}
fn acquire_drag(app: &AppHandle, id: &str) -> Result<(library::Capture, FileDragLease)> {
    let state = app.state::<AppState>();
    if state
        .dragging
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Err("另一次文件拖放仍在进行。".into());
    }
    let lease = FileDragLease {
        app: app.clone(),
        id: id.into(),
    };
    let mut lib = lock(&state)?;
    let item = lib.item(id)?;
    // Resolve and protect the same item under one lock before any preview decoding.
    lib.active_drags.insert(id.into());
    Ok((item, lease))
}
#[tauri::command]
async fn start_drag(
    app: AppHandle,
    window: WebviewWindow,
    id: String,
    visual: Option<drag_visual::DragVisual>,
) -> Result<()> {
    let (item, lease) = acquire_drag(&app, &id)?;
    shelf_preview::close(app.clone()).await?;
    #[cfg(windows)]
    let shake_scale = (window.label() == "shelf"
        && lock(&app.state::<AppState>())?
            .settings
            .shelf_shake_to_dismiss)
        .then(|| window.scale_factor().unwrap_or(1.0));
    #[cfg(windows)]
    let ghost_visual = if window.label() == "shelf" && item.kind == "image" {
        visual.map(|visual| (visual, window.scale_factor().unwrap_or(1.0)))
    } else {
        None
    };
    #[cfg(not(windows))]
    let _ = visual;
    let path = native::external_file_path(Path::new(&item.path))?;
    let icon = if item.kind == "image" {
        // Keep the Windows drag ghost small even when the source is a large capture.
        let preview = item
            .thumbnail
            .strip_prefix("data:image/png;base64,")
            .ok_or("预览图片不可用")?;
        STANDARD.decode(preview).map_err(|e| e.to_string())?
    } else {
        let mut image = Cursor::new(Vec::new());
        image::RgbaImage::from_pixel(48, 48, image::Rgba([96, 109, 94, 255]))
            .write_to(&mut image, image::ImageFormat::Png)
            .map_err(|e| e.to_string())?;
        image.into_inner()
    };
    #[cfg(not(windows))]
    let dispatcher = window.clone();
    window
        .run_on_main_thread(move || {
            let _lease = lease; // All returns and scheduling failure release the same RAII lease.
            #[cfg(windows)]
            let visual_notify = {
                let app = app.clone();
                let id = id.clone();
                move |token, active| {
                    let _ = app.emit_to(
                        "shelf",
                        "shelf-drag-visual",
                        serde_json::json!({"id": id, "active": active, "token": token}),
                    );
                }
            };
            #[cfg(windows)]
            let result =
                native_drag::start_file_drag(path, &icon, shake_scale, ghost_visual, visual_notify)
                    .and_then(|outcome| {
                        if std::env::var_os("SNAPLINE_TRACE_ISLAND").is_some() {
                            eprintln!(
                                "[shelf-drag] id={id} shake_enabled={} outcome={outcome:?}",
                                shake_scale.is_some()
                            );
                        }
                        if outcome == native_drag::DragOutcome::ShelfDismissed {
                            let state = app.state::<AppState>();
                            let mut library = lock(&state)?;
                            if library.settings.shelf_shake_to_dismiss {
                                library.set_shelf_hidden(&id, true)?;
                                drop(library);
                                // Keep the already-visible clothesline long enough
                                // to show dismissal and its gap closing, even if the
                                // real OLE cursor finishes outside this window. This
                                // affects auto-hide only; never reopen a closed shelf.
                                state
                                    .shelf_until
                                    .fetch_max(now_ms() + 1200, Ordering::Relaxed);
                                publish(&app, false)?;
                                let _ = app.emit_to(
                                    "shelf",
                                    "shelf-dismissed",
                                    serde_json::json!({"id": id}),
                                );
                            }
                        }
                        Ok(())
                    });
            #[cfg(not(windows))]
            let result = drag::start_drag(
                &dispatcher,
                drag::DragItem::Files(vec![path]),
                drag::Image::Raw(icon),
                |_, _| {},
                drag::Options {
                    mode: drag::DragMode::Copy,
                    ..Default::default()
                },
            );
            if let Err(error) = result {
                report(&app, error);
            }
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn save_edited_image(app: AppHandle, id: String, data_url: String) -> Result<AppSnapshot> {
    if data_url.len() > 90_000_000 {
        return Err("编辑图片过大。".into());
    }
    let payload = data_url
        .strip_prefix("data:image/png;base64,")
        .ok_or("需要 PNG 图片数据")?;
    let bytes = STANDARD.decode(payload).map_err(|e| e.to_string())?;
    {
        let state = app.state::<AppState>();
        let mut lib = lock(&state)?;
        let original = lib.item(&id)?;
        let stem = Path::new(&original.name)
            .file_stem()
            .unwrap_or_default()
            .to_string_lossy();
        lib.import_png(&bytes, &format!("{stem}-edited.png"), "edited")?;
    }
    publish(&app, false)
}

#[tauri::command]
fn quit_app(app: AppHandle) {
    app.exit(0);
}

fn start_watchers(app: AppHandle) {
    std::thread::spawn(move || {
        let mut known: HashMap<PathBuf, HashMap<PathBuf, (u64, std::time::SystemTime)>> =
            HashMap::new();
        let mut pending: HashMap<PathBuf, (u64, std::time::SystemTime, u8)> = HashMap::new();
        let mut last_sequence = native::clipboard_sequence();
        let mut clipboard_retry = (0u32, 0u8);
        let mut clipboard_enabled = false;
        loop {
            std::thread::sleep(Duration::from_millis(600));
            let state = app.state::<AppState>();
            let settings = match lock(&state) {
                Ok(lib) => lib.settings.clone(),
                Err(_) => continue,
            };
            let active_folders: Vec<PathBuf> =
                settings.watch_folders.iter().map(PathBuf::from).collect();
            known.retain(|p, _| active_folders.contains(p));
            pending.retain(|p, _| {
                p.parent()
                    .is_some_and(|parent| active_folders.contains(&parent.to_path_buf()))
            });
            let mut changed = false;
            for folder in active_folders {
                let entries: HashMap<PathBuf, (u64, std::time::SystemTime)> =
                    std::fs::read_dir(&folder)
                        .into_iter()
                        .flatten()
                        .filter_map(|e| e.ok())
                        .filter_map(|e| {
                            let path = e.path();
                            if !library::is_supported(&path) {
                                return None;
                            }
                            let m = e.metadata().ok()?;
                            if !m.is_file() {
                                return None;
                            }
                            Some((path, (m.len(), m.modified().ok()?)))
                        })
                        .collect();
                let Some(previous) = known.get(&folder) else {
                    known.insert(folder, entries);
                    continue;
                };
                for (path, (len, modified)) in &entries {
                    if previous.get(path) == Some(&(*len, *modified)) && !pending.contains_key(path)
                    {
                        continue;
                    }
                    let attempt = pending.entry(path.clone()).or_insert((*len, *modified, 0));
                    if attempt.0 != *len || attempt.1 != *modified {
                        *attempt = (*len, *modified, 0);
                        continue;
                    }
                    attempt.2 = attempt.2.saturating_add(1);
                    if attempt.2 < 2 || *len == 0 {
                        continue;
                    }
                    // Recorders can pause disk writes while still owning the file.
                    if !native::file_ready_for_copy(path) {
                        continue;
                    }
                    let result = lock(&state).and_then(|mut lib| lib.import(path, "folder"));
                    match result {
                        Ok(imported) => {
                            changed |= imported;
                            pending.remove(path);
                        }
                        Err(e) if attempt.2 >= 8 => {
                            report(&app, e);
                            pending.remove(path);
                        }
                        Err(_) => {}
                    }
                }
                pending.retain(|path, _| {
                    path.parent() != Some(folder.as_path()) || entries.contains_key(path)
                });
                known.insert(folder, entries);
            }
            let sequence = native::clipboard_sequence();
            if settings.watch_clipboard && !clipboard_enabled {
                last_sequence = sequence;
            }
            clipboard_enabled = settings.watch_clipboard;
            if sequence != last_sequence {
                let previous_sequence = last_sequence;
                last_sequence = sequence;
                if settings.watch_clipboard
                    && sequence != state.copied_sequence.load(Ordering::SeqCst)
                    && native::clipboard_is_image_only()
                {
                    let image =
                        arboard::Clipboard::new().and_then(|mut clipboard| clipboard.get_image());
                    if let Ok(img) = image {
                        if img.width > 0
                            && img.height > 0
                            && img.width.saturating_mul(img.height) <= 80_000_000
                            && native::clipboard_sequence() == sequence
                        {
                            if let Some(buffer) = image::RgbaImage::from_raw(
                                img.width as u32,
                                img.height as u32,
                                img.bytes.into_owned(),
                            ) {
                                let mut png = Cursor::new(Vec::new());
                                if buffer.write_to(&mut png, image::ImageFormat::Png).is_ok()
                                    && native::clipboard_sequence() == sequence
                                    && native::clipboard_is_image_only()
                                {
                                    let source = "clipboard";
                                    let result = lock(&state).and_then(|mut lib| {
                                        lib.import_png(
                                            png.get_ref(),
                                            &format!("Screenshot-{}.png", now_ms()),
                                            source,
                                        )
                                    });
                                    match result {
                                        Ok(imported) => {
                                            changed |= imported;
                                        }
                                        Err(e) => report(&app, e),
                                    }
                                }
                            }
                        }
                    } else {
                        // A producer can briefly retain OpenClipboard after updating it.
                        // Retry this sequence, without ever reading a replaced/private copy.
                        if clipboard_retry.0 != sequence {
                            clipboard_retry = (sequence, 0);
                        }
                        if clipboard_retry.1 < 3 {
                            clipboard_retry.1 += 1;
                            last_sequence = previous_sequence;
                        }
                    }
                }
            }
            if changed {
                let _ = publish(&app, true);
            }
        }
    });
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            let _ = show_main_now(app);
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_autostart::Builder::new()
                .args(["--background"])
                .build(),
        )
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        shortcuts::dispatch(app, shortcut.id());
                    }
                })
                .build(),
        )
        .setup(|app| {
            let root = app.path().app_local_data_dir()?;
            let mut library = Library::load(root).map_err(std::io::Error::other)?;
            // Permit only direct children of the resolved physical library. The
            // configured AppData scope can point at MSIX's different merged root.
            app.asset_protocol_scope()
                .allow_directory(library.root.join("library"), false)?;
            if let Ok(enabled) = app.autolaunch().is_enabled() {
                library.settings.start_at_login = enabled;
            }
            app.manage(AppState {
                library: Mutex::new(library),
                shelf_until: AtomicU64::new(0),
                shelf_manual: AtomicBool::new(false),
                capture_active: capture::CaptureActivity::default(),
                capture: Mutex::new(None),
                capture_startup: Mutex::new(capture::CaptureStartup::default()),
                hidden_windows: Mutex::new(Vec::new()),
                settings_busy: AtomicBool::new(false),
                shortcut_warnings: Mutex::new(Vec::new()),
                copied_sequence: AtomicU32::new(0),
                dragging: AtomicBool::new(false),
            });
            shelf_anchor::initialize(app.handle());
            shelf_preview::initialize(app.handle());
            shortcuts::register_startup(app.handle());
            let main = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("Snapline · 晾图")
                .inner_size(1200.0, 800.0)
                .min_inner_size(800.0, 600.0)
                .center()
                .visible(!std::env::args().any(|a| a == "--background"))
                .build()?;
            main.on_window_event({
                let main = main.clone();
                move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = main.hide();
                    }
                }
            });
            WebviewWindowBuilder::new(
                app,
                "shelf",
                WebviewUrl::App("index.html?view=shelf".into()),
            )
            .title("Snapline Shelf")
            .inner_size(1200.0, 250.0)
            .decorations(false)
            .transparent(true)
            .shadow(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .resizable(false)
            .focused(false)
            .visible(false)
            .build()?;
            use tauri::{
                menu::{Menu, MenuItem, PredefinedMenuItem},
                tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
            };
            let open = MenuItem::with_id(app, "open", "打开晾图", true, None::<&str>)?;
            let shelf = MenuItem::with_id(app, "shelf", "展开 / 收起晾衣架", true, None::<&str>)?;
            let capture = MenuItem::with_id(app, "capture", "截取屏幕", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let separator = PredefinedMenuItem::separator(app)?;
            let menu = Menu::with_items(app, &[&open, &shelf, &capture, &separator, &quit])?;
            let mut tray = TrayIconBuilder::with_id("snapline")
                .tooltip("Snapline · 晾图")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => {
                        let _ = show_main_now(app);
                    }
                    "shelf" => toggle_shelf(app),
                    "capture" => {
                        dispatch_capture(app);
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let _ = show_main_now(tray.app_handle());
                    }
                });
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;
            start_watchers(app.handle().clone());
            shelf_anchor::create(app.handle()).map_err(std::io::Error::other)?;
            shelf_anchor::start_watcher(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_state,
            set_shelf_hidden,
            show_shelf_preview,
            get_shelf_preview,
            shelf_preview_ready,
            confirm_shelf_preview,
            close_shelf_preview,
            get_startup_warnings,
            import_files,
            choose_watch_folder,
            update_settings,
            set_pin_double_click_action,
            copy_item,
            export_item,
            remove_item,
            toggle_pin,
            clear_unpinned,
            open_item,
            reveal_item,
            start_capture,
            get_capture_session,
            capture_ready,
            capture_load_failed,
            finish_capture,
            cancel_capture,
            capture_fullscreen,
            pin_item,
            paste_clipboard,
            toggle_pins,
            close_pin,
            resize_pin,
            move_pin,
            get_pin_drag_anchor,
            get_cursor_position,
            move_pin_to_cursor,
            set_pin_opacity,
            show_main,
            hide_shelf,
            open_shelf,
            anchor_ready,
            anchor_glow::anchor_glow_ready,
            anchor_glow::anchor_visual_visible,
            shelf_frontend_ready,
            shelf_frontend_trace,
            shelf_transition_ready,
            shelf_transition_painted,
            shelf_transition_opened,
            shelf_transition_finished,
            begin_shelf_anchor_drag,
            finish_shelf_anchor_drag,
            nudge_shelf_anchor,
            reset_shelf_anchor,
            show_gallery,
            gallery_ready,
            close_gallery,
            start_drag,
            save_edited_image,
            quit_app
        ])
        .run(tauri::generate_context!())
        .expect("Unable to launch Snapline");
}
