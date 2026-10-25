use base64::{engine::general_purpose::STANDARD, Engine};
use image::{GenericImageView, ImageFormat, ImageReader};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{Cursor, Read},
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

pub type Result<T> = std::result::Result<T, String>;
pub const EXTENSIONS: &[&str] = &[
    "png", "jpg", "jpeg", "webp", "gif", "bmp", "tif", "tiff", "mp4", "mov", "webm", "mkv",
];
const MAX_IMAGE_BYTES: u64 = 64 * 1024 * 1024;
pub const ISLAND_PET_IDS: [&str; 12] = [
    "mallow", "mint", "aqua", "ember", "violet", "peach", "ice", "rose", "gugu", "deepseek",
    "claude", "chatgpt",
];

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Capture {
    pub id: String,
    pub name: String,
    pub path: String,
    pub thumbnail: String,
    pub kind: String,
    pub width: u32,
    pub height: u32,
    pub created_at: u64,
    pub source: String,
    pub pinned: bool,
    #[serde(default)]
    pub shelf_hidden: bool,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub fingerprint: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub watch_clipboard: bool,
    pub watch_folders: Vec<String>,
    pub edge_reveal: bool,
    pub peek_on_capture: bool,
    pub hide_windows_on_capture: bool,
    pub start_at_login: bool,
    pub theme: String,
    pub max_items: usize,
    pub capture_shortcut: String,
    pub paste_shortcut: String,
    pub shelf_shortcut: String,
    pub pin_double_click_action: String,
    pub shelf_anchor: ShelfAnchor,
    pub shelf_shake_to_dismiss: bool,
    pub shelf_hover_preview: bool,
    pub shelf_hover_delay_ms: u32,
    pub island_pets: Vec<String>,
    pub island_pet_interactions: bool,
}

/// Position is relative to the monitor's available horizontal travel, not CSS pixels.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ShelfAnchor {
    pub monitor: Option<String>,
    pub ratio: f64,
}
impl Default for ShelfAnchor {
    fn default() -> Self {
        Self {
            monitor: None,
            ratio: 0.5,
        }
    }
}
impl ShelfAnchor {
    pub fn sanitized(mut self) -> Self {
        self.ratio = if self.ratio.is_finite() {
            self.ratio.clamp(0.0, 1.0)
        } else {
            0.5
        };
        self
    }
}

impl Default for Settings {
    fn default() -> Self {
        let mut folders = Vec::new();
        if let Some(screenshots) = crate::native::screenshot_folder() {
            folders.push(screenshots.to_string_lossy().into_owned());
        }
        if let Some(videos) = dirs::video_dir() {
            folders.push(videos.join("Captures").to_string_lossy().into_owned());
        }
        Self {
            watch_clipboard: false,
            watch_folders: folders,
            edge_reveal: true,
            peek_on_capture: true,
            hide_windows_on_capture: false,
            start_at_login: false,
            theme: "system".into(),
            max_items: 200,
            capture_shortcut: "F1".into(),
            paste_shortcut: "F3".into(),
            shelf_shortcut: "Ctrl+Alt+T".into(),
            pin_double_click_action: "close".into(),
            shelf_anchor: ShelfAnchor::default(),
            shelf_shake_to_dismiss: true,
            shelf_hover_preview: true,
            shelf_hover_delay_ms: 1000,
            island_pets: vec!["mallow".into()],
            island_pet_interactions: true,
        }
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSnapshot {
    pub items: Vec<Capture>,
    pub settings: Settings,
    pub storage_path: String,
}

#[derive(Serialize, Deserialize, Default)]
struct DiskState {
    #[serde(default)]
    items: Vec<Capture>,
    #[serde(default)]
    settings: Settings,
}

pub struct Library {
    pub root: PathBuf,
    pub items: Vec<Capture>,
    pub settings: Settings,
    pub active_pins: std::collections::HashSet<String>,
    pub active_drags: std::collections::HashSet<String>,
}

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

pub fn is_supported(path: &Path) -> bool {
    path.extension()
        .and_then(|s| s.to_str())
        .map(|s| EXTENSIONS.contains(&s.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

pub fn validate_pin_double_click_action(action: &str) -> Result<()> {
    if ["close", "collapse", "none"].contains(&action) {
        Ok(())
    } else {
        Err("贴图双击行为必须为关闭、收起或不执行操作。".into())
    }
}

pub fn validate_shelf_hover_delay(delay: u32) -> Result<()> {
    if (1000..=5000).contains(&delay) {
        Ok(())
    } else {
        Err("悬停预览等待时间须为 1–5 秒。".into())
    }
}

pub fn validate_island_pets(pets: &[String]) -> Result<()> {
    if !(1..=3).contains(&pets.len())
        || pets.iter().enumerate().any(|(index, pet)| {
            !ISLAND_PET_IDS.contains(&pet.as_str()) || pets[..index].contains(pet)
        })
    {
        Err("请选择 1–3 个不同的灵动岛角色。".into())
    } else {
        Ok(())
    }
}

/// Forward/legacy indexes may contain unknown IDs. Repair only this preference
/// in memory, retaining valid residents and every unrelated setting and item.
fn sanitize_island_pets(pets: &[String]) -> Vec<String> {
    let mut result = Vec::with_capacity(3);
    for pet in pets {
        if ISLAND_PET_IDS.contains(&pet.as_str()) && !result.contains(pet) {
            result.push(pet.clone());
            if result.len() == 3 {
                break;
            }
        }
    }
    if result.is_empty() {
        result.push("mallow".into());
    }
    result
}

fn hash_file(path: &Path) -> Result<String> {
    let mut file = fs::File::open(path).map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    let mut chunk = [0u8; 65536];
    loop {
        let n = file.read(&mut chunk).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        hasher.update(&chunk[..n]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

pub fn decode_image(path: &Path) -> Result<image::DynamicImage> {
    if fs::metadata(path).map_err(|e| e.to_string())?.len() > MAX_IMAGE_BYTES {
        return Err("图片超过 64 MB，暂不支持。".into());
    }
    let mut reader = ImageReader::open(path)
        .map_err(|e| e.to_string())?
        .with_guessed_format()
        .map_err(|e| e.to_string())?;
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(20000);
    limits.max_image_height = Some(20000);
    limits.max_alloc = Some(320_000_000);
    reader.limits(limits);
    let img = reader.decode().map_err(|e| format!("无法读取图片: {e}"))?;
    if u64::from(img.width()) * u64::from(img.height()) > 80_000_000 {
        return Err("图片尺寸过大。".into());
    }
    Ok(img)
}

fn resolve_owned_item(item: &Capture, safe_root: &Path) -> Option<PathBuf> {
    let indexed = Path::new(&item.path);
    if let Ok(path) = indexed.canonicalize() {
        if path.parent() == Some(safe_root) && path.is_file() {
            return Some(path);
        }
    }
    // An index can outlive its old virtual/absolute path. Only consider the
    // UUID-named file already inside this library, and prove its content matches
    // the saved identity. Never import the indexed external path as a fallback.
    if uuid::Uuid::parse_str(&item.id).is_err()
        || indexed.file_stem()?.to_str()? != item.id
        || !is_supported(indexed)
        || item.fingerprint.is_empty()
    {
        return None;
    }
    let candidate = safe_root.join(indexed.file_name()?).canonicalize().ok()?;
    if candidate.parent() != Some(safe_root) || !candidate.is_file() {
        return None;
    }
    let fingerprint = if item.fingerprint.starts_with("pixels:") {
        let rgba = decode_image(&candidate).ok()?.into_rgba8();
        if (rgba.width(), rgba.height()) != (item.width, item.height) {
            return None;
        }
        let mut hash = Sha256::new();
        hash.update(rgba.width().to_le_bytes());
        hash.update(rgba.height().to_le_bytes());
        hash.update(rgba.as_raw());
        format!("pixels:{:x}", hash.finalize())
    } else {
        hash_file(&candidate).ok()?
    };
    (fingerprint == item.fingerprint).then_some(candidate)
}

impl Library {
    pub fn load(root: PathBuf) -> Result<Self> {
        let file = root.join("state.json");
        // MSIX's merged AppData view can resolve a directory to Local while its
        // state.json and images resolve to LocalCache. Anchor all operations to
        // the actual index location, not the merged directory handle.
        let root = if file.exists() {
            file.canonicalize()
                .map_err(|e| e.to_string())?
                .parent()
                .ok_or("资料库索引位置无效")?
                .to_path_buf()
        } else {
            fs::create_dir_all(&root).map_err(|e| e.to_string())?;
            root.canonicalize().map_err(|e| e.to_string())?
        };
        #[cfg(windows)]
        let root = crate::native::shell_path(&root);
        fs::create_dir_all(root.join("library")).map_err(|e| e.to_string())?;
        let file = root.join("state.json");
        let disk: DiskState = if file.exists() {
            serde_json::from_slice(&fs::read(&file).map_err(|e| e.to_string())?)
                .map_err(|e| format!("资料库索引损坏；原文件保留在 {}。{e}", root.display()))?
        } else {
            DiskState::default()
        };
        let mut result = Self {
            root,
            items: disk.items,
            settings: disk.settings,
            active_pins: std::collections::HashSet::new(),
            active_drags: std::collections::HashSet::new(),
        };
        let safe_root = result
            .root
            .join("library")
            .canonicalize()
            .map_err(|e| e.to_string())?;
        result.items.retain_mut(|item| {
            let Some(path) = resolve_owned_item(item, &safe_root) else {
                return false;
            };
            let Ok(path) = crate::native::external_file_path(&path) else {
                return false;
            };
            item.path = path.to_string_lossy().into_owned();
            true
        });
        result.settings.max_items = result.settings.max_items.clamp(20, 1000);
        result.settings.shelf_hover_delay_ms =
            result.settings.shelf_hover_delay_ms.clamp(1000, 5000);
        result.settings.shelf_anchor = result.settings.shelf_anchor.clone().sanitized();
        result.settings.island_pets = sanitize_island_pets(&result.settings.island_pets);
        if validate_pin_double_click_action(&result.settings.pin_double_click_action).is_err() {
            result.settings.pin_double_click_action = "close".into();
        }
        Ok(result)
    }

    pub fn set_pin_double_click_action(&mut self, action: String) -> Result<()> {
        validate_pin_double_click_action(&action)?;
        let previous = std::mem::replace(&mut self.settings.pin_double_click_action, action);
        if let Err(error) = self.persist() {
            self.settings.pin_double_click_action = previous;
            return Err(error);
        }
        Ok(())
    }

    pub fn set_shelf_anchor(&mut self, anchor: ShelfAnchor) -> Result<()> {
        let previous = std::mem::replace(&mut self.settings.shelf_anchor, anchor.sanitized());
        if let Err(error) = self.persist() {
            self.settings.shelf_anchor = previous;
            return Err(error);
        }
        Ok(())
    }

    /// A shelf dismissal changes presentation only: never prune or unlink data.
    pub fn set_shelf_hidden(&mut self, id: &str, hidden: bool) -> Result<()> {
        let index = self
            .items
            .iter()
            .position(|item| item.id == id)
            .ok_or("图片已不存在")?;
        let previous = self.items[index].shelf_hidden;
        self.items[index].shelf_hidden = hidden;
        if let Err(error) = self.persist() {
            self.items[index].shelf_hidden = previous;
            return Err(error);
        }
        Ok(())
    }

    pub fn snapshot(&self) -> AppSnapshot {
        AppSnapshot {
            items: self.items.clone(),
            settings: self.settings.clone(),
            storage_path: self.root.join("library").to_string_lossy().into_owned(),
        }
    }

    pub fn persist(&self) -> Result<()> {
        let bytes = serde_json::to_vec_pretty(&DiskState {
            items: self.items.clone(),
            settings: self.settings.clone(),
        })
        .map_err(|e| e.to_string())?;
        let temp = self.root.join("state.json.tmp");
        {
            use std::io::Write;
            let mut file = fs::File::create(&temp).map_err(|e| e.to_string())?;
            file.write_all(&bytes).map_err(|e| e.to_string())?;
            file.sync_all().map_err(|e| e.to_string())?;
        }
        fs::rename(temp, self.root.join("state.json")).map_err(|e| e.to_string())
    }

    pub fn item(&self, id: &str) -> Result<Capture> {
        self.items
            .iter()
            .find(|i| i.id == id)
            .cloned()
            .ok_or_else(|| "该项目已被移除。".into())
    }

    pub fn import(&mut self, path: &Path, source: &str) -> Result<bool> {
        if !path.is_file() || !is_supported(path) {
            return Err("请选择 PNG、JPEG、WebP、GIF、BMP、TIFF 图片或视频。".into());
        }
        let metadata = fs::metadata(path).map_err(|e| e.to_string())?;
        if metadata.len() == 0 || metadata.len() > 2 * 1024 * 1024 * 1024 {
            return Err("文件为空或超过 2 GB。".into());
        }
        let ext = path
            .extension()
            .unwrap()
            .to_string_lossy()
            .to_ascii_lowercase();
        let video = ["mp4", "mov", "webm", "mkv"].contains(&ext.as_str());
        let (width, height, thumbnail, fingerprint) = if video {
            (0, 0, String::new(), hash_file(path)?)
        } else {
            let rgba = decode_image(path)?.into_rgba8();
            let mut hash = Sha256::new();
            hash.update(rgba.width().to_le_bytes());
            hash.update(rgba.height().to_le_bytes());
            hash.update(rgba.as_raw());
            // Multi-frame formats must retain their complete identity, not only frame one.
            let fingerprint = if ["gif", "webp", "tif", "tiff"].contains(&ext.as_str()) {
                hash_file(path)?
            } else {
                format!("pixels:{:x}", hash.finalize())
            };
            let img = image::DynamicImage::ImageRgba8(rgba);
            let (width, height) = img.dimensions();
            let thumb = img.thumbnail(480, 320);
            let mut png = Cursor::new(Vec::new());
            thumb
                .write_to(&mut png, ImageFormat::Png)
                .map_err(|e| e.to_string())?;
            (
                width,
                height,
                format!(
                    "data:image/png;base64,{}",
                    STANDARD.encode(png.into_inner())
                ),
                fingerprint,
            )
        };
        if self.items.iter().any(|i| i.fingerprint == fingerprint) {
            return Ok(false);
        }
        let id = uuid::Uuid::new_v4().to_string();
        let target = self.root.join("library").join(format!("{id}.{ext}"));
        fs::copy(path, &target).map_err(|e| format!("无法保存副本: {e}"))?;
        self.items.insert(
            0,
            Capture {
                id,
                name: path.file_name().unwrap().to_string_lossy().into_owned(),
                path: target.to_string_lossy().into_owned(),
                thumbnail,
                kind: if video { "video" } else { "image" }.into(),
                width,
                height,
                created_at: now_ms(),
                source: source.into(),
                pinned: false,
                shelf_hidden: false,
                fingerprint,
            },
        );
        self.prune()?;
        self.persist()?;
        Ok(true)
    }

    pub fn import_png(&mut self, bytes: &[u8], name: &str, source: &str) -> Result<bool> {
        if bytes.len() as u64 > MAX_IMAGE_BYTES {
            return Err("图片超过 64 MB。".into());
        }
        let temp = self
            .root
            .join(format!("incoming-{}.png", uuid::Uuid::new_v4()));
        fs::write(&temp, bytes).map_err(|e| e.to_string())?;
        let imported = self.import(&temp, source);
        let _ = fs::remove_file(&temp);
        if matches!(imported, Ok(true)) {
            self.items[0].name = name.into();
            self.persist()?;
        }
        imported
    }

    pub fn remove(&mut self, id: &str) -> Result<()> {
        if self.active_drags.contains(id) {
            return Err("图片正在拖放，请松开鼠标后再移除。".into());
        }
        let item = self.item(id)?;
        let target = Path::new(&item.path);
        if target.exists() {
            let canonical = target.canonicalize().map_err(|e| e.to_string())?;
            let library = self
                .root
                .join("library")
                .canonicalize()
                .map_err(|e| e.to_string())?;
            if canonical.parent() != Some(library.as_path()) {
                return Err("拒绝删除资料库以外的文件。".into());
            }
            fs::remove_file(target).map_err(|e| e.to_string())?;
        }
        self.items.retain(|i| i.id != id);
        self.persist()
    }

    pub fn prune(&mut self) -> Result<()> {
        while self.items.len() > self.settings.max_items {
            let Some(id) = self
                .items
                .iter()
                // Always keep the arriving item. Pinned items may exceed the soft limit.
                .skip(1)
                .rev()
                .find(|i| {
                    !i.pinned
                        && !self.active_pins.contains(&i.id)
                        && !self.active_drags.contains(&i.id)
                })
                .map(|i| i.id.clone())
            else {
                break;
            };
            self.remove(&id)?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn capture_visibility_legacy_default_and_setting_roundtrip_preserve_preferences() {
        let legacy: Settings = serde_json::from_str(
            r#"{"captureShortcut":"Control+Shift+F1","theme":"dark","shelfHoverDelayMs":3700}"#,
        )
        .unwrap();
        assert!(!legacy.hide_windows_on_capture);
        let temp = tempfile::tempdir_in(env!("CARGO_MANIFEST_DIR")).unwrap();
        let mut library = Library::load(temp.path().join("app")).unwrap();
        library.settings = legacy;
        for hidden in [false, true, false] {
            library.settings.hide_windows_on_capture = hidden;
            library.persist().unwrap();
            let loaded = Library::load(library.root.clone()).unwrap();
            assert_eq!(loaded.settings.hide_windows_on_capture, hidden);
            assert_eq!(loaded.settings.capture_shortcut, "Control+Shift+F1");
            assert_eq!(loaded.settings.theme, "dark");
            assert_eq!(loaded.settings.shelf_hover_delay_ms, 3700);
            assert_eq!(
                serde_json::to_value(&loaded.settings).unwrap()["hideWindowsOnCapture"],
                hidden
            );
        }
    }

    #[test]
    fn island_pet_legacy_defaults_preserve_existing_preferences() {
        let legacy: Settings = serde_json::from_str(
            r#"{"captureShortcut":"Alt+F1","theme":"dark","shelfHoverDelayMs":3700}"#,
        )
        .unwrap();
        assert_eq!(legacy.island_pets, ["mallow"]);
        assert!(legacy.island_pet_interactions);
        assert_eq!(legacy.capture_shortcut, "Alt+F1");
        assert_eq!(legacy.theme, "dark");
        assert_eq!(legacy.shelf_hover_delay_ms, 3700);
    }

    #[test]
    fn island_pet_updates_reject_empty_unknown_duplicate_or_excess_residents() {
        for id in ISLAND_PET_IDS {
            assert!(validate_island_pets(&[id.into()]).is_ok());
        }
        assert!(validate_island_pets(&["rose".into(), "aqua".into(), "mint".into()]).is_ok());
        assert!(
            validate_island_pets(&["deepseek".into(), "claude".into(), "chatgpt".into()]).is_ok()
        );
        for ids in [
            vec![],
            vec!["mallow", "mallow"],
            vec!["deepseek", "deepseek"],
            vec!["unknown"],
            vec!["MALLOW"],
            vec![" mint"],
            vec!["mallow", "mint", "aqua", "ember"],
            vec!["gugu", "deepseek", "claude", "chatgpt"],
        ] {
            let pets: Vec<String> = ids.into_iter().map(String::from).collect();
            let before = pets.clone();
            assert!(validate_island_pets(&pets).is_err());
            assert_eq!(pets, before);
        }
    }

    #[test]
    fn island_pet_load_repairs_only_residents_without_rewriting_the_index() {
        let temp = tempfile::tempdir_in(env!("CARGO_MANIFEST_DIR")).unwrap();
        let source = temp.path().join("source.png");
        sample(&source, 91);
        let mut library = Library::load(temp.path().join("app")).unwrap();
        library.import(&source, "import").unwrap();
        library.items[0].shelf_hidden = true;
        library.items[0].pinned = true;
        library.settings.capture_shortcut = "Alt+F1".into();
        library.settings.shelf_anchor.ratio = 0.63;
        library.settings.shelf_hover_delay_ms = 3700;
        library.settings.island_pet_interactions = false;
        let item_before = serde_json::to_value(&library.items).unwrap();
        let file_before = fs::read(&library.items[0].path).unwrap();
        for (invalid, expected) in [
            (vec![], vec!["mallow"]),
            (vec!["unknown", "future"], vec!["mallow"]),
            (
                vec![
                    "future", "deepseek", "deepseek", "chatgpt", "gugu", "claude",
                ],
                vec!["deepseek", "chatgpt", "gugu"],
            ),
            (
                vec!["future", "rose", "rose", "mint", "ice", "peach"],
                vec!["rose", "mint", "ice"],
            ),
        ] {
            library.settings.island_pets = invalid.into_iter().map(String::from).collect();
            library.persist().unwrap();
            let saved = fs::read(library.root.join("state.json")).unwrap();
            let mut expected_settings = serde_json::to_value(&library.settings).unwrap();
            expected_settings["islandPets"] = serde_json::json!(expected);
            let loaded = Library::load(library.root.clone()).unwrap();
            assert_eq!(
                serde_json::to_value(&loaded.settings).unwrap(),
                expected_settings
            );
            assert_eq!(serde_json::to_value(&loaded.items).unwrap(), item_before);
            assert_eq!(fs::read(&loaded.items[0].path).unwrap(), file_before);
            assert_eq!(fs::read(library.root.join("state.json")).unwrap(), saved);
        }
    }

    #[test]
    fn island_pet_count_order_and_interaction_roundtrip() {
        let temp = tempfile::tempdir_in(env!("CARGO_MANIFEST_DIR")).unwrap();
        let mut library = Library::load(temp.path().join("app")).unwrap();
        library.settings.capture_shortcut = "Alt+F1".into();
        for (pets, interactions) in [
            (vec!["peach"], false),
            (vec!["rose", "mint"], true),
            (vec!["ice", "gugu", "violet"], false),
            (vec!["deepseek"], true),
            (vec!["gugu", "claude"], false),
            (vec!["chatgpt", "deepseek", "claude"], true),
        ] {
            library.settings.island_pets = pets.into_iter().map(String::from).collect();
            library.settings.island_pet_interactions = interactions;
            validate_island_pets(&library.settings.island_pets).unwrap();
            library.persist().unwrap();
            let loaded = Library::load(library.root.clone()).unwrap();
            assert_eq!(
                serde_json::to_value(&loaded.settings).unwrap(),
                serde_json::to_value(&library.settings).unwrap()
            );
        }
    }

    #[test]
    fn legacy_state_defaults_enable_shelf_features_without_hiding_existing_items() {
        let legacy: Settings = serde_json::from_str(r#"{"theme":"dark"}"#).unwrap();
        assert!(legacy.shelf_shake_to_dismiss);
        assert!(legacy.shelf_hover_preview);
        assert_eq!(legacy.shelf_hover_delay_ms, 1000);
        assert!(validate_shelf_hover_delay(1000).is_ok());
        assert!(validate_shelf_hover_delay(5000).is_ok());
        assert!(validate_shelf_hover_delay(999).is_err());
        assert!(validate_shelf_hover_delay(5001).is_err());
        let item: Capture = serde_json::from_value(serde_json::json!({"id":"legacy","name":"image.png","path":"image.png","thumbnail":"","kind":"image","width":1,"height":1,"createdAt":0,"source":"import","pinned":false})).unwrap();
        assert!(!item.shelf_hidden);
    }
    #[test]
    fn new_hover_default_does_not_replace_persisted_user_delays() {
        let temp = tempfile::tempdir_in(env!("CARGO_MANIFEST_DIR")).unwrap();
        let root = temp.path().join("app");
        let mut library = Library::load(root.clone()).unwrap();
        assert_eq!(library.settings.shelf_hover_delay_ms, 1000);
        for delay in [1000, 2000, 3700, 5000] {
            library.settings.shelf_hover_delay_ms = delay;
            library.persist().unwrap();
            let reloaded = Library::load(root.clone()).unwrap();
            assert_eq!(reloaded.settings.shelf_hover_delay_ms, delay);
        }
    }
    #[test]
    fn shelf_dismiss_restore_preserves_file_and_all_other_item_metadata() {
        let temp = tempfile::tempdir_in(env!("CARGO_MANIFEST_DIR")).unwrap();
        let source = temp.path().join("source.png");
        sample(&source, 40);
        let mut lib = Library::load(temp.path().join("app")).unwrap();
        lib.import(&source, "import").unwrap();
        let item = lib.items[0].clone();
        let bytes = fs::read(&item.path).unwrap();
        let before = serde_json::to_value(&item).unwrap();
        lib.set_shelf_hidden(&item.id, true).unwrap();
        let reloaded = Library::load(lib.root.clone()).unwrap();
        assert_eq!(reloaded.items.len(), 1);
        assert!(reloaded.items[0].shelf_hidden);
        assert_eq!(fs::read(&item.path).unwrap(), bytes);
        let mut after = serde_json::to_value(&reloaded.items[0]).unwrap();
        after["shelfHidden"] = serde_json::Value::Bool(false);
        assert_eq!(after, before);
        lib.set_shelf_hidden(&item.id, false).unwrap();
        assert_eq!(serde_json::to_value(&lib.items[0]).unwrap(), before);
        fs::create_dir(lib.root.join("state.json.tmp")).unwrap();
        assert!(lib.set_shelf_hidden(&item.id, true).is_err());
        assert!(!lib.items[0].shelf_hidden);
        assert_eq!(fs::read(&item.path).unwrap(), bytes);
    }
    fn sample(path: &Path, color: u8) {
        image::RgbaImage::from_pixel(20, 10, image::Rgba([color, 50, 80, 255]))
            .save(path)
            .unwrap();
    }
    #[test]
    fn shelf_anchor_migrates_and_only_updates_its_own_setting_transactionally() {
        let temp = tempfile::tempdir_in(env!("CARGO_MANIFEST_DIR")).unwrap();
        let root = temp.path().join("app");
        let mut lib = Library::load(root.clone()).unwrap();
        let legacy: Settings =
            serde_json::from_str(r#"{"captureShortcut":"Alt+F1","theme":"dark"}"#).unwrap();
        assert_eq!(legacy.shelf_anchor, ShelfAnchor::default());
        lib.settings = legacy;
        let moved = ShelfAnchor {
            monitor: Some("DISPLAY2".into()),
            ratio: 0.72,
        };
        lib.set_shelf_anchor(moved.clone()).unwrap();
        let loaded = Library::load(root.clone()).unwrap();
        assert_eq!(loaded.settings.shelf_anchor, moved);
        assert_eq!(loaded.settings.capture_shortcut, "Alt+F1");
        assert_eq!(loaded.settings.theme, "dark");
        let saved = fs::read(root.join("state.json")).unwrap();
        fs::create_dir(root.join("state.json.tmp")).unwrap();
        assert!(lib.set_shelf_anchor(ShelfAnchor::default()).is_err());
        assert_eq!(lib.settings.shelf_anchor, moved);
        assert_eq!(fs::read(root.join("state.json")).unwrap(), saved);
        assert_eq!(
            ShelfAnchor {
                monitor: None,
                ratio: f64::NAN
            }
            .sanitized()
            .ratio,
            0.5
        );
    }
    #[test]
    fn pin_double_click_settings_migrate_validate_and_persist_transactionally() {
        let temp = tempfile::tempdir_in(env!("CARGO_MANIFEST_DIR")).unwrap();
        let root = temp.path().join("app");
        let mut lib = Library::load(root.clone()).unwrap();
        // Old indexes lack the field and receive the deliberate close default.
        let legacy: Settings = serde_json::from_str(r#"{"captureShortcut":"Alt+F1"}"#).unwrap();
        assert_eq!(legacy.pin_double_click_action, "close");
        lib.settings = legacy;
        for action in ["collapse", "none", "close"] {
            lib.set_pin_double_click_action(action.into()).unwrap();
            let loaded = Library::load(root.clone()).unwrap();
            assert_eq!(loaded.settings.pin_double_click_action, action);
            assert_eq!(loaded.settings.capture_shortcut, "Alt+F1");
        }
        let saved = fs::read(root.join("state.json")).unwrap();
        for invalid in ["", "minimize", "CLOSE", "close "] {
            assert!(lib.set_pin_double_click_action(invalid.into()).is_err());
            assert_eq!(lib.settings.pin_double_click_action, "close");
        }
        assert_eq!(fs::read(root.join("state.json")).unwrap(), saved);
        // A failed disk transaction must not announce an in-memory preference.
        fs::create_dir(root.join("state.json.tmp")).unwrap();
        assert!(lib.set_pin_double_click_action("collapse".into()).is_err());
        assert_eq!(lib.settings.pin_double_click_action, "close");
        assert_eq!(fs::read(root.join("state.json")).unwrap(), saved);
    }
    #[test]
    fn relocated_index_uses_only_owned_content_verified_files() {
        let temp = tempfile::tempdir_in(env!("CARGO_MANIFEST_DIR")).unwrap();
        let source = temp.path().join("source.png");
        sample(&source, 25);
        let old_root = temp.path().join("old");
        let mut old = Library::load(old_root.clone()).unwrap();
        old.import(&source, "import").unwrap();
        let item = old.items[0].clone();
        let relocated = temp.path().join("relocated");
        fs::create_dir_all(relocated.join("library")).unwrap();
        let target = relocated
            .join("library")
            .join(Path::new(&item.path).file_name().unwrap());
        fs::copy(&item.path, &target).unwrap();
        fs::copy(old_root.join("state.json"), relocated.join("state.json")).unwrap();
        let index_before = fs::read(relocated.join("state.json")).unwrap();
        let mut loaded = Library::load(relocated.clone()).unwrap();
        assert_eq!(loaded.items.len(), 1);
        assert_eq!(
            Path::new(&loaded.items[0].path).canonicalize().unwrap(),
            target.canonicalize().unwrap()
        );
        // Loading repairs paths only in memory; no original index is rewritten.
        assert_eq!(
            fs::read(relocated.join("state.json")).unwrap(),
            index_before
        );
        loaded.remove(&item.id).unwrap();
        assert!(!target.exists());
        assert!(Path::new(&item.path).exists());
        // Same UUID/name is insufficient when bytes/pixels differ.
        fs::copy(old_root.join("state.json"), relocated.join("state.json")).unwrap();
        sample(&target, 99);
        assert!(Library::load(relocated.clone()).unwrap().items.is_empty());
        // Nor may a fingerprint alone turn an arbitrary external filename into
        // an owned entry (even when a matching copy is present in this library).
        fs::copy(&item.path, &target).unwrap();
        let safe_root = relocated.join("library").canonicalize().unwrap();
        let mut invalid = item.clone();
        invalid.path = source.to_string_lossy().into_owned();
        assert!(resolve_owned_item(&invalid, &safe_root).is_none());
        invalid = item.clone();
        invalid.fingerprint.clear();
        assert!(resolve_owned_item(&invalid, &safe_root).is_none());
        fs::remove_file(&target).unwrap();
        assert!(resolve_owned_item(&item, &safe_root).is_none());
    }
    #[test]
    fn full_pinned_library_keeps_new_capture_and_existing_names() {
        let temp = tempfile::tempdir_in(env!("CARGO_MANIFEST_DIR")).unwrap();
        let mut lib = Library::load(temp.path().join("app")).unwrap();
        lib.settings.max_items = 20;
        for color in 0..20 {
            let path = temp.path().join(format!("{color}.png"));
            sample(&path, color);
            lib.import(&path, "import").unwrap();
            lib.items[0].pinned = true;
        }
        let existing: Vec<_> = lib
            .items
            .iter()
            .map(|item| (item.id.clone(), item.name.clone()))
            .collect();
        let path = temp.path().join("new.png");
        sample(&path, 100);
        assert!(lib
            .import_png(&fs::read(&path).unwrap(), "Clipboard.png", "clipboard")
            .unwrap());
        assert_eq!(lib.items.len(), 21);
        assert_eq!(lib.items[0].name, "Clipboard.png");
        for (id, name) in existing {
            assert_eq!(lib.item(&id).unwrap().name, name);
        }
    }

    #[test]
    fn deduplicates_identical_pixels_across_file_encodings() {
        let temp = tempfile::tempdir_in(env!("CARGO_MANIFEST_DIR")).unwrap();
        let png = temp.path().join("same.png");
        sample(&png, 15);
        let bmp = temp.path().join("same.bmp");
        image::open(&png).unwrap().save(&bmp).unwrap();
        let mut lib = Library::load(temp.path().join("app")).unwrap();
        assert!(lib.import(&png, "folder").unwrap());
        assert!(!lib.import(&bmp, "clipboard").unwrap());
        assert_eq!(lib.items.len(), 1);
    }

    #[test]
    fn imports_copy_deduplicate_and_remove_without_touching_original() {
        let temp = tempfile::tempdir_in(env!("CARGO_MANIFEST_DIR")).unwrap();
        let original = temp.path().join("original.png");
        sample(&original, 1);
        let mut lib = Library::load(temp.path().join("app")).unwrap();
        assert!(lib.import(&original, "import").unwrap());
        assert!(!lib.import(&original, "import").unwrap());
        assert_eq!(lib.items[0].width, 20);
        let id = lib.items[0].id.clone();
        let copy = lib.items[0].path.clone();
        lib.remove(&id).unwrap();
        assert!(original.exists());
        assert!(!Path::new(&copy).exists());
    }
    #[test]
    fn retention_keeps_pinned_and_roundtrips_settings() {
        let temp = tempfile::tempdir_in(env!("CARGO_MANIFEST_DIR")).unwrap();
        let root = temp.path().join("app");
        let mut lib = Library::load(root.clone()).unwrap();
        lib.settings.max_items = 20;
        for color in 0..23 {
            let p = temp.path().join(format!("{color}.png"));
            sample(&p, color);
            lib.import(&p, "import").unwrap();
            if color == 0 {
                lib.items[0].pinned = true;
            }
        }
        lib.settings.watch_clipboard = true;
        lib.persist().unwrap();
        let loaded = Library::load(root).unwrap();
        assert_eq!(loaded.items.len(), 20);
        assert!(loaded.items.iter().any(|i| i.name == "0.png" && i.pinned));
        assert!(loaded.settings.watch_clipboard);
    }
    #[test]
    fn open_desktop_pins_survive_retention_without_becoming_favorites() {
        let temp = tempfile::tempdir_in(env!("CARGO_MANIFEST_DIR")).unwrap();
        let root = temp.path().join("app");
        let mut lib = Library::load(root.clone()).unwrap();
        lib.settings.max_items = 2;
        let first = temp.path().join("first.png");
        sample(&first, 1);
        lib.import(&first, "import").unwrap();
        let id = lib.items[0].id.clone();
        lib.active_pins.insert(id.clone());
        for color in 2..7 {
            let file = temp.path().join(format!("{color}.png"));
            sample(&file, color);
            lib.import(&file, "import").unwrap();
        }
        assert!(lib.item(&id).is_ok());
        assert!(!lib.item(&id).unwrap().pinned);
        assert_eq!(lib.items.len(), 2);
        assert!(Library::load(root).unwrap().active_pins.is_empty());
        lib.active_pins.remove(&id);
        let file = temp.path().join("last.png");
        sample(&file, 20);
        lib.import(&file, "import").unwrap();
        assert!(lib.item(&id).is_err());
    }
    #[test]
    fn outgoing_drag_source_survives_background_retention_until_drop() {
        let temp = tempfile::tempdir_in(env!("CARGO_MANIFEST_DIR")).unwrap();
        let mut lib = Library::load(temp.path().join("app")).unwrap();
        lib.settings.max_items = 2;
        let original = temp.path().join("source.png");
        sample(&original, 1);
        lib.import(&original, "import").unwrap();
        let item = lib.items[0].clone();
        lib.active_drags.insert(item.id.clone());
        for color in 2..6 {
            let source = temp.path().join(format!("{color}.png"));
            sample(&source, color);
            lib.import(&source, "clipboard").unwrap();
        }
        assert!(Path::new(&item.path).exists());
        assert!(original.exists());
        assert_eq!(lib.items.len(), 2);
        assert!(lib.remove(&item.id).is_err());
        assert!(Path::new(&item.path).exists());
        lib.active_drags.remove(&item.id);
        let source = temp.path().join("after-drop.png");
        sample(&source, 7);
        lib.import(&source, "import").unwrap();
        assert!(!Path::new(&item.path).exists());
        assert!(original.exists());
    }
    #[test]
    fn refuses_external_deletion_and_corrupt_database() {
        let temp = tempfile::tempdir_in(env!("CARGO_MANIFEST_DIR")).unwrap();
        let p = temp.path().join("source.png");
        sample(&p, 5);
        let root = temp.path().join("app");
        let mut lib = Library::load(root.clone()).unwrap();
        lib.import(&p, "import").unwrap();
        let id = lib.items[0].id.clone();
        lib.items[0].path = p.to_string_lossy().into_owned();
        assert!(lib.remove(&id).is_err());
        assert!(p.exists());
        fs::write(root.join("state.json"), "broken").unwrap();
        assert!(Library::load(root).is_err());
    }
}
