//! "Hide Menu Bar" / "Show Menu Bar" at the end of the webview's own
//! right-click menu, to hide the menu bar (MDHero · File · Edit · View ·
//! Window) or bring it back.
//!
//! The item joins the menu WebView2 already opens on the toolbar and the rest
//! of the window, rather than replacing it; the parts of the page with a menu
//! of their own (the document, the tabs) keep theirs.
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
use tauri::{webview::PlatformWebview, Manager, WebviewWindow};
use webview2_com::{
    ContextMenuRequestedEventHandler, CustomItemSelectedEventHandler,
    Microsoft::Web::WebView2::Win32::*,
};
use windows::core::{Interface, BOOL, HSTRING};

const PREFS_FILE: &str = "menu-bar.json";

#[derive(Serialize, Deserialize)]
struct MenuBarPrefs {
    hidden: bool,
}

fn prefs_path(window: &WebviewWindow) -> Option<PathBuf> {
    window
        .path()
        .app_config_dir()
        .ok()
        .map(|dir| dir.join(PREFS_FILE))
}

fn parse_hidden(json: &str) -> bool {
    serde_json::from_str::<MenuBarPrefs>(json)
        .map(|prefs| prefs.hidden)
        .unwrap_or(false)
}

fn save_hidden(window: &WebviewWindow, hidden: bool) -> Result<(), String> {
    let path = prefs_path(window)
        .ok_or_else(|| "Could not determine the config directory".to_string())?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)
            .map_err(|e| format!("Failed to create config directory: {}", e))?;
    }
    let json = serde_json::to_string(&MenuBarPrefs { hidden }).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| format!("Failed to save setting: {}", e))
}

/// Called from `setup`, once the menu is set and before the window is first
/// drawn: hides the menu bar if it was hidden when the app last ran, and adds
/// the item to the webview's right-click menu.
pub fn setup(window: &WebviewWindow) {
    let hidden = prefs_path(window)
        .and_then(|path| std::fs::read_to_string(path).ok())
        .map(|json| parse_hidden(&json))
        .unwrap_or(false);
    if hidden {
        let _ = window.hide_menu();
    }

    let target = window.clone();
    let _ = window.with_webview(move |webview| {
        // SAFETY: `with_webview` runs this on the UI thread, where WebView2's
        // COM objects live.
        if let Err(e) = unsafe { add_context_menu_item(&webview, target) } {
            eprintln!("Menu bar item not added to the context menu: {:?}", e);
        }
    });
}

/// Hides the menu bar if it is shown, shows it if not, and remembers which.
fn toggle(window: &WebviewWindow) {
    let hide = window.is_menu_visible().unwrap_or(false);
    let result = if hide {
        window.hide_menu()
    } else {
        window.show_menu()
    };
    if result.is_ok() {
        let _ = save_hidden(window, hide);
    }
}

/// Appends a separator and the item to WebView2's menu each time it opens.
/// Only on the page itself: a text field, selected text, an image or a video
/// get their menu as it is.
unsafe fn add_context_menu_item(
    webview: &PlatformWebview,
    window: WebviewWindow,
) -> windows::core::Result<()> {
    let core = webview
        .controller()
        .CoreWebView2()?
        .cast::<ICoreWebView2_11>()?;
    let environment = webview.environment().cast::<ICoreWebView2Environment9>()?;

    let handler = ContextMenuRequestedEventHandler::create(Box::new(move |_, args| unsafe {
        let Some(args) = args else { return Ok(()) };

        let target = args.ContextMenuTarget()?;
        let mut kind = COREWEBVIEW2_CONTEXT_MENU_TARGET_KIND::default();
        target.Kind(&mut kind)?;
        let mut editable = BOOL::default();
        target.IsEditable(&mut editable)?;
        if kind != COREWEBVIEW2_CONTEXT_MENU_TARGET_KIND_PAGE || editable.as_bool() {
            return Ok(());
        }

        let label = if window.is_menu_visible().unwrap_or(false) {
            "Hide Menu Bar"
        } else {
            "Show Menu Bar"
        };
        let separator = environment.CreateContextMenuItem(
            &HSTRING::new(),
            None,
            COREWEBVIEW2_CONTEXT_MENU_ITEM_KIND_SEPARATOR,
        )?;
        let item = environment.CreateContextMenuItem(
            &HSTRING::from(label),
            None,
            COREWEBVIEW2_CONTEXT_MENU_ITEM_KIND_COMMAND,
        )?;
        let selected = window.clone();
        let mut token = 0;
        item.add_CustomItemSelected(
            &CustomItemSelectedEventHandler::create(Box::new(move |_, _| {
                toggle(&selected);
                Ok(())
            })),
            &mut token,
        )?;

        let items = args.MenuItems()?;
        let mut count = 0;
        items.Count(&mut count)?;
        items.InsertValueAtIndex(count, &separator)?;
        items.InsertValueAtIndex(count + 1, &item)?;
        Ok(())
    }));

    let mut token = 0;
    core.add_ContextMenuRequested(&handler, &mut token)
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
