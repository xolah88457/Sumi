use crate::{platform, profile::atomic_write, State, LABEL, PLATFORM};
use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::{
    ipc::CapabilityBuilder,
    menu::{AboutMetadata, Menu, MenuEvent, MenuItem, PredefinedMenuItem as Role, Submenu},
    App, AppHandle, LogicalPosition, Manager, Url, WebviewUrl, WebviewWindowBuilder, WindowEvent,
};

const WINDOW_STATE: &str = "tauri-window.json";
const MIN_WIDTH: f64 = 900.;
const MIN_HEIGHT: f64 = 620.;

#[derive(Deserialize, Serialize)]
struct Bounds {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    maximized: bool,
    zoom: f64,
}

pub fn open(app: &AppHandle, origin: Url) -> tauri::Result<()> {
    let state = app.state::<State>();
    let url_origin = origin.origin().ascii_serialization();
    let capability = CapabilityBuilder::new("sumi-loopback")
        .local(false)
        .remote(format!("{url_origin}/*"))
        .webview(LABEL)
        .permission("allow-runtime-info")
        .permission("allow-save-preferences")
        .permission("allow-check-for-updates");
    #[cfg(not(target_os = "macos"))]
    let capability = capability.permission("allow-open-external");
    app.add_capability(if state.profile.smoke {
        capability.permission("allow-smoke-report")
    } else {
        capability
    })?;

    let mut bounds = std::fs::read(state.profile.dir.join(WINDOW_STATE))
        .ok()
        .filter(|bytes| bytes.len() < 8192)
        .and_then(|bytes| serde_json::from_slice::<Bounds>(&bytes).ok())
        .filter(|b| {
            (MIN_WIDTH..=8000.).contains(&b.width)
                && (MIN_HEIGHT..=8000.).contains(&b.height)
                && b.x.is_finite()
                && b.y.is_finite()
                && (0.5..=3.).contains(&b.zoom)
        });

    // Install native frame and navigation checks before any loopback content loads.
    #[cfg(target_os = "macos")]
    let bridge_key: Option<&str> = None;
    #[cfg(not(target_os = "macos"))]
    let bridge_key = Some(state.bridge_key.as_str());
    let bootstrap = format!(
        "({})(...{});",
        include_str!("../../bridge.js").trim().trim_end_matches(';'),
        json!([
            url_origin,
            state.prefs.lock().unwrap().value(),
            state.profile.smoke,
            PLATFORM,
            bridge_key,
        ])
    );
    let builder = WebviewWindowBuilder::new(
        app,
        LABEL,
        WebviewUrl::External("about:blank".parse().unwrap()),
    )
    .title("Sumi")
    .visible(false)
    .min_inner_size(MIN_WIDTH, MIN_HEIGHT)
    .inner_size(
        bounds.as_ref().map_or(1440., |b| b.width),
        bounds.as_ref().map_or(920., |b| b.height),
    )
    .background_color(tauri::window::Color(251, 250, 246, 255))
    .center()
    .disable_drag_drop_handler()
    .incognito(state.profile.test)
    .initialization_script(bootstrap);
    #[cfg(not(target_os = "macos"))]
    let builder = platform::configure(builder, &state, &origin);
    let window = builder.build()?;
    // Paper is #fbfaf6; use the dark paper (#171512) when the saved choice is dark, or
    // when nothing is saved and the OS is dark. The window is still hidden here.
    let saved_theme = state
        .prefs
        .lock()
        .unwrap()
        .value()
        .get("journal-theme-v1")
        .and_then(|v| v.as_str())
        .map(str::to_owned);
    let dark = match saved_theme.as_deref() {
        Some("dark") => true,
        Some("light") => false,
        _ => matches!(window.theme(), Ok(tauri::Theme::Dark)),
    };
    if dark {
        let _ = window.set_background_color(Some(tauri::window::Color(23, 21, 18, 255)));
    }
    platform::install(&window, origin.clone())?;
    if let Some(b) = bounds.take() {
        if let Ok(monitors) = window.available_monitors() {
            if monitors.iter().any(|monitor| {
                let pos = monitor.position().to_logical::<f64>(monitor.scale_factor());
                let size = monitor.size().to_logical::<f64>(monitor.scale_factor());
                (pos.x..pos.x + size.width - 80.).contains(&b.x)
                    && (pos.y..pos.y + size.height - 60.).contains(&b.y)
            }) {
                let _ = window.set_position(LogicalPosition::new(b.x, b.y));
            }
        }
        if b.maximized {
            let _ = window.maximize();
        }
        if window.set_zoom(b.zoom).is_ok() {
            *state.zoom.lock().unwrap() = b.zoom;
        }
    }
    let handle = app.clone();
    window.on_window_event(move |event| {
        if let WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            handle.exit(0);
        }
    });
    window.navigate(origin)?;
    window.show()?;
    let _ = window.set_focus();
    if state.profile.test {
        println!("SUMI_TAURI_READY {url_origin}");
    }
    Ok(())
}

pub fn persist(app: &AppHandle, state: &State) {
    let Some(window) = app.get_webview_window(LABEL) else {
        return;
    };
    let (Ok(pos), Ok(size), Ok(scale), Ok(maximized)) = (
        window.outer_position(),
        window.inner_size(),
        window.scale_factor(),
        window.is_maximized(),
    ) else {
        return;
    };
    let pos = pos.to_logical::<f64>(scale);
    let size = size.to_logical::<f64>(scale);
    let bounds = Bounds {
        x: pos.x,
        y: pos.y,
        width: size.width,
        height: size.height,
        maximized,
        zoom: *state.zoom.lock().unwrap(),
    };
    if let Ok(bytes) = serde_json::to_vec(&bounds) {
        if let Err(err) = atomic_write(&state.profile.dir.join(WINDOW_STATE), &bytes) {
            eprintln!("Could not save Sumi window state: {err}");
        }
    }
}

pub fn menu(app: &App) -> tauri::Result<()> {
    let item = |id, name, shortcut| MenuItem::with_id(app, id, name, true, shortcut);
    #[cfg(target_os = "macos")]
    let application = Submenu::with_items(app, "Sumi", true, &[
        &Role::about(app, Some("About Sumi"), Some(AboutMetadata {
            name: Some("Sumi".into()), version: Some(app.package_info().version.to_string()),
            credits: Some("A local trading journal. Built on LuxAlgo's MIT-licensed Trade Journal with a Kami-inspired theme (Tw93). Not affiliated with either project.".into()),
            ..Default::default()
        }))?,
        &item("show-data", "Show Journal Data", None)?, &Role::separator(app)?,
        &Role::hide(app, Some("Hide Sumi"))?, &Role::hide_others(app, None)?, &Role::show_all(app, None)?,
        &Role::separator(app)?, &item("quit", "Quit Sumi", Some("Cmd+Q"))?,
    ])?;
    #[cfg(not(target_os = "macos"))]
    let application = Submenu::with_items(
        app,
        "Sumi",
        true,
        &[
            &Role::about(
                app,
                Some("About Sumi"),
                Some(AboutMetadata {
                    name: Some("Sumi".into()),
                    version: Some(app.package_info().version.to_string()),
                    ..Default::default()
                }),
            )?,
            &item("show-data", "Show Journal Data", None)?,
            &Role::separator(app)?,
            &item("quit", "Quit Sumi", Some("Ctrl+Q"))?,
        ],
    )?;
    #[cfg(not(target_os = "linux"))]
    let edit = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &Role::undo(app, None)?,
            &Role::redo(app, None)?,
            &Role::separator(app)?,
            &Role::cut(app, None)?,
            &Role::copy(app, None)?,
            &Role::paste(app, None)?,
            &Role::select_all(app, None)?,
        ],
    )?;
    #[cfg(target_os = "linux")]
    let edit = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &item("undo", "Undo", Some("Ctrl+Z"))?,
            &item("redo", "Redo", Some("Ctrl+Y"))?,
            &Role::separator(app)?,
            &item("cut", "Cut", Some("Ctrl+X"))?,
            &item("copy", "Copy", Some("Ctrl+C"))?,
            &item("paste", "Paste", Some("Ctrl+V"))?,
            &item("select-all", "Select All", Some("Ctrl+A"))?,
        ],
    )?;
    let view = Submenu::with_items(
        app,
        "View",
        true,
        &[
            &item("reload", "Reload", Some("CmdOrCtrl+R"))?,
            &item("force-reload", "Force Reload", Some("CmdOrCtrl+Shift+R"))?,
            &Role::separator(app)?,
            &item("zoom-reset", "Actual Size", Some("CmdOrCtrl+0"))?,
            &item("zoom-in", "Zoom In", Some("CmdOrCtrl+Equal"))?,
            &item("zoom-out", "Zoom Out", Some("CmdOrCtrl+Minus"))?,
        ],
    )?;
    #[cfg(target_os = "macos")]
    let windows = Submenu::with_items(
        app,
        "Window",
        true,
        &[
            &Role::minimize(app, None)?,
            &item("zoom-window", "Zoom", None)?,
            &Role::close_window(app, None)?,
        ],
    )?;
    #[cfg(target_os = "macos")]
    windows.set_as_windows_menu_for_nsapp()?;
    #[cfg(not(target_os = "macos"))]
    let windows = Submenu::with_items(
        app,
        "Window",
        true,
        &[
            &item("minimize", "Minimize", None)?,
            &item("zoom-window", "Zoom", None)?,
            &item("close", "Close", None)?,
        ],
    )?;
    app.set_menu(Menu::with_items(
        app,
        &[&application, &edit, &view, &windows],
    )?)?;
    Ok(())
}

pub fn menu_event(app: &AppHandle, event: MenuEvent) {
    let id = event.id().as_ref();
    if id == "quit" {
        app.exit(0);
        return;
    }
    let Some(state) = app.try_state::<State>() else {
        return;
    };
    if id == "show-data" {
        platform::open_path(&state.profile.dir);
        return;
    }
    let Some(window) = app.get_webview_window(LABEL) else {
        return;
    };
    let result = match id {
        "reload" => window.reload(),
        "force-reload" => platform::force_reload(&window),
        #[cfg(not(target_os = "macos"))]
        "minimize" => window.minimize(),
        #[cfg(not(target_os = "macos"))]
        "close" => window.close(),
        #[cfg(target_os = "linux")]
        "undo" | "redo" | "cut" | "copy" | "paste" | "select-all" => platform::edit(&window, id),
        "zoom-window" => window.is_maximized().and_then(|m| {
            if m {
                window.unmaximize()
            } else {
                window.maximize()
            }
        }),
        "zoom-in" | "zoom-out" | "zoom-reset" => {
            let mut zoom = state.zoom.lock().unwrap();
            let next = match id {
                "zoom-in" => (*zoom + 0.1).min(3.),
                "zoom-out" => (*zoom - 0.1).max(0.5),
                _ => 1.,
            };
            window.set_zoom(next).map(|()| *zoom = next)
        }
        _ => Ok(()),
    };
    if let Err(error) = result {
        eprintln!("Sumi menu action failed: {error}");
    }
}
