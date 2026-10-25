use crate::{
    capture,
    library::{Result, Settings},
    lock, AppState,
};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};

pub fn parse(settings: &Settings) -> Result<[Shortcut; 3]> {
    let names = [
        &settings.capture_shortcut,
        &settings.paste_shortcut,
        &settings.shelf_shortcut,
    ];
    let values = names.map(|name| {
        name.parse::<Shortcut>()
            .map_err(|e| format!("快捷键 {name} 无效：{e}"))
    });
    let [a, b, c] = values;
    let shortcuts = [a?, b?, c?];
    if shortcuts[0].id() == shortcuts[1].id()
        || shortcuts[0].id() == shortcuts[2].id()
        || shortcuts[1].id() == shortcuts[2].id()
    {
        return Err("截图、贴图和晾图快捷键不能重复。".into());
    }
    Ok(shortcuts)
}
/// Only the edited actions are part of the transaction. An unchanged shortcut may
/// have failed at startup; retrying it would prevent users fixing conflicts one by one.
fn changed_shortcuts(old: &Settings, new: &Settings) -> Result<Vec<Shortcut>> {
    Ok(parse(old)?
        .into_iter()
        .zip(parse(new)?)
        .filter_map(|(before, after)| (before != after).then_some(after))
        .collect())
}
/// Register changed additions first, then roll them back on any new conflict.
pub fn prepare(app: &AppHandle, old: &Settings, new: &Settings) -> Result<Vec<Shortcut>> {
    let mut registered = Vec::new();
    for shortcut in changed_shortcuts(old, new)? {
        if app.global_shortcut().is_registered(shortcut) {
            continue;
        }
        if app.global_shortcut().register(shortcut).is_err() {
            rollback(app, &registered);
            return Err(format!(
                "快捷键 {} 被其他程序占用，原设置已保留。",
                shortcut
            ));
        }
        registered.push(shortcut);
    }
    Ok(registered)
}
fn unavailable_warnings(
    settings: &Settings,
    is_registered: impl Fn(Shortcut) -> bool,
) -> Vec<String> {
    match parse(settings) {
        Ok(shortcuts) => ["截图", "贴图", "晾图"].into_iter().zip(shortcuts)
            .filter(|(_, shortcut)| !is_registered(*shortcut))
            .map(|(action, shortcut)| format!("{action}快捷键 {shortcut} 被其他程序占用，当前不可用。请在设置中更改快捷键，或关闭占用它的软件后重新启动晾图。界面按钮仍可使用。"))
            .collect(),
        Err(error) => vec![error],
    }
}
pub fn refresh_warnings(app: &AppHandle, settings: &Settings) {
    let warnings = unavailable_warnings(settings, |shortcut| {
        app.global_shortcut().is_registered(shortcut)
    });
    if let Ok(mut saved) = app.state::<AppState>().shortcut_warnings.lock() {
        *saved = warnings;
    }
}
pub fn rollback(app: &AppHandle, added: &[Shortcut]) {
    for shortcut in added {
        let _ = app.global_shortcut().unregister(*shortcut);
    }
}
pub fn commit(app: &AppHandle, old: &Settings, new: &Settings) {
    if let (Ok(old), Ok(new)) = (parse(old), parse(new)) {
        for shortcut in old {
            if !new.contains(&shortcut) {
                let _ = app.global_shortcut().unregister(shortcut);
            }
        }
    }
}
pub fn register_startup(app: &AppHandle) {
    if let Ok(settings) = lock(&app.state::<AppState>()).map(|library| library.settings.clone()) {
        if let Ok(shortcuts) = parse(&settings) {
            for shortcut in shortcuts {
                let _ = app.global_shortcut().register(shortcut);
            }
        }
        // Populate before creating any webview, so readiness reads cannot miss failures.
        refresh_warnings(app, &settings);
    }
}
pub fn dispatch(app: &AppHandle, id: u32) {
    let shortcuts = lock(&app.state::<AppState>()).and_then(|l| parse(&l.settings));
    if let Ok(s) = shortcuts {
        if id == s[0].id() {
            capture::dispatch_capture(app);
        } else if id == s[1].id() {
            if app
                .state::<AppState>()
                .capture_active
                .load(std::sync::atomic::Ordering::SeqCst)
            {
                let _ = app.emit_to("capture", "capture-pin", ());
            } else {
                capture::dispatch_paste(app);
            }
        } else if id == s[2].id() {
            crate::toggle_shelf(app);
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn default_and_custom_shortcuts_parse() {
        let mut settings = Settings::default();
        assert!(parse(&settings).is_ok());
        settings.capture_shortcut = "Ctrl+Shift+Q".into();
        assert!(parse(&settings).is_ok());
    }
    #[test]
    fn conflicting_startup_keys_can_be_recovered_independently() {
        let initial = Settings::default();
        let keys = parse(&initial).unwrap();
        // Simulate Snipaste owning F1/F3: only shelf is registered by this app.
        let mut registered = std::collections::HashSet::from([keys[2].id()]);
        assert_eq!(
            unavailable_warnings(&initial, |key| registered.contains(&key.id())).len(),
            2
        );
        let mut first = initial.clone();
        first.capture_shortcut = "Ctrl+Shift+F1".into();
        let changes = changed_shortcuts(&initial, &first).unwrap();
        assert_eq!(changes, vec![parse(&first).unwrap()[0]]);
        registered.extend(changes.iter().map(|key| key.id()));
        let warnings = unavailable_warnings(&first, |key| registered.contains(&key.id()));
        assert_eq!(warnings.len(), 1);
        assert!(warnings[0].contains("贴图快捷键 F3"));
        // An unrelated preference must not retry the still-conflicting paste shortcut.
        let mut unrelated = first.clone();
        unrelated.theme = "dark".into();
        assert!(changed_shortcuts(&first, &unrelated).unwrap().is_empty());
        let mut second = unrelated.clone();
        second.paste_shortcut = "Ctrl+Shift+F3".into();
        let changes = changed_shortcuts(&unrelated, &second).unwrap();
        assert_eq!(changes, vec![parse(&second).unwrap()[1]]);
        registered.extend(changes.iter().map(|key| key.id()));
        assert!(unavailable_warnings(&second, |key| registered.contains(&key.id())).is_empty());
    }
    #[test]
    fn aliases_are_checked_for_collision() {
        let mut s = Settings {
            capture_shortcut: "Control+Alt+T".into(),
            ..Default::default()
        };
        assert!(parse(&s).is_err());
        s.capture_shortcut = "definitely-invalid".into();
        assert!(parse(&s).is_err());
    }
}
