//! Hiding the menu bar (MDHero · File · Edit · View · Window) with a right-click
//! on the toolbar, and bringing it back the same way.
//!
//! Windows only. On macOS the menu lives in the system menu bar, which an app
//! cannot hide. On Linux, GTK only fires a menu item's shortcut while its menu
//! bar is on screen, and Ctrl+O, Ctrl+F or Ctrl+Q have no fallback in the
//! webview, so hiding the bar would take them away. On Windows the shortcuts
//! keep working: Tauri runs them through an accelerator table that does not
//! depend on the bar being shown.
//!
//! The choice lives in a file Rust reads at startup rather than in the
//! webview's localStorage, so a hidden bar is hidden before the window is first
//! drawn instead of showing, then vanishing and moving the page up, on every
//! launch.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{
    menu::{CheckMenuItem, Menu},
    AppHandle, Manager, Runtime, WebviewWindow,
};

const PREFS_FILE: &str = "menu-bar.json";

/// Id of the toolbar menu's item, handled in `lib.rs::setup`'s `on_menu_event`.
pub const TOGGLE_ID: &str = "menubar:toggle";

#[derive(Serialize, Deserialize)]
struct MenuBarPrefs {
    hidden: bool,
}

fn prefs_path<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    app.path()
        .app_config_dir()
        .ok()
        .map(|dir| dir.join(PREFS_FILE))
}

fn parse_hidden(json: &str) -> bool {
    serde_json::from_str::<MenuBarPrefs>(json)
        .map(|prefs| prefs.hidden)
        .unwrap_or(false)
}

fn save_hidden<R: Runtime>(app: &AppHandle<R>, hidden: bool) -> Result<(), String> {
    let path =
        prefs_path(app).ok_or_else(|| "Could not determine the config directory".to_string())?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)
            .map_err(|e| format!("Failed to create config directory: {}", e))?;
    }
    let json = serde_json::to_string(&MenuBarPrefs { hidden }).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| format!("Failed to save setting: {}", e))
}

/// Hides the menu bar if it was hidden when the app last ran. Called from
/// `setup`, once the menu is set and before the window is first drawn.
pub fn restore<R: Runtime>(window: &WebviewWindow<R>) {
    if !cfg!(target_os = "windows") {
        return;
    }
    let hidden = prefs_path(window.app_handle())
        .and_then(|path| std::fs::read_to_string(path).ok())
        .map(|json| parse_hidden(&json))
        .unwrap_or(false);
    if hidden {
        let _ = window.hide_menu();
    }
}

/// Hides the menu bar if it is shown, shows it if not, and remembers which.
pub fn toggle<R: Runtime>(window: &WebviewWindow<R>) {
    let hide = window.is_menu_visible().unwrap_or(false);
    let result = if hide {
        window.hide_menu()
    } else {
        window.show_menu()
    };
    if result.is_ok() {
        let _ = save_hidden(window.app_handle(), hide);
    }
}

/// The toolbar's right-click menu: a single "Menu Bar" item, ticked while the
/// bar is shown. Picking it goes through `toggle`.
#[tauri::command]
pub fn show_toolbar_context_menu(app: AppHandle) -> Result<(), String> {
    if !cfg!(target_os = "windows") {
        return Err("The menu bar can only be hidden on Windows".to_string());
    }
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "main window not found".to_string())?;
    let shown = window.is_menu_visible().map_err(|e| e.to_string())?;

    let menu = Menu::new(&app).map_err(|e| e.to_string())?;
    let item = CheckMenuItem::with_id(&app, TOGGLE_ID, "Menu Bar", true, shown, None::<&str>)
        .map_err(|e| e.to_string())?;
    menu.append(&item).map_err(|e| e.to_string())?;
    window.popup_menu(&menu).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_back_what_is_saved() {
        for hidden in [true, false] {
            let json = serde_json::to_string(&MenuBarPrefs { hidden }).unwrap();
            assert_eq!(parse_hidden(&json), hidden);
        }
    }

    #[test]
    fn anything_unreadable_means_shown() {
        assert!(!parse_hidden(""));
        assert!(!parse_hidden("not json"));
        assert!(!parse_hidden("{}"));
        assert!(!parse_hidden(r#"{"hidden":"yes"}"#));
    }
}
