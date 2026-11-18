mod backend;
#[cfg(target_os = "macos")]
mod macos;
#[cfg(not(target_os = "macos"))]
mod portable;
mod profile;
mod security;
mod updater;
mod window;

use backend::{Backend, STARTUP_TIMEOUT};
#[cfg(target_os = "macos")]
use macos as platform;
#[cfg(not(target_os = "macos"))]
use portable as platform;
use profile::{atomic_write, Preferences, Profile, SMOKE_FILE};
use serde_json::{json, Value};
use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Manager, RunEvent};

const LABEL: &str = "main";
const SMOKE_DOWNLOAD: &str = "sumi-tauri-smoke.txt";
const SMOKE_DOWNLOAD_BYTES: &[u8] = b"Sumi native blob download\n";
#[cfg(target_os = "macos")]
const PLATFORM: &str = "darwin";
#[cfg(target_os = "linux")]
const PLATFORM: &str = "linux";
#[cfg(windows)]
const PLATFORM: &str = "win32";

struct State {
    profile: Profile,
    prefs: Mutex<Preferences>,
    backend: Arc<Backend>,
    #[cfg(target_os = "macos")]
    dispatch_ticket: Arc<Mutex<Option<String>>>,
    #[cfg(not(target_os = "macos"))]
    bridge_key: String,
    downloads: Arc<platform::Downloads>,
    smoke_done: AtomicBool,
    failed: AtomicBool,
    updating: AtomicBool,
    zoom: Mutex<f64>,
}

#[tauri::command]
fn save_preferences(state: tauri::State<'_, State>, dict: Value) -> Result<Value, String> {
    state.prefs.lock().unwrap().save(dict).map_err(|e| {
        eprintln!("Sumi could not save preferences: {e}");
        "Could not save preferences".into()
    })
}

#[tauri::command]
fn runtime_info(app: AppHandle, state: tauri::State<'_, State>) -> Value {
    let arch = match std::env::consts::ARCH {
        "aarch64" => "arm64",
        "x86_64" => "x64",
        arch => arch,
    };
    json!({"runtime":"tauri", "tauriVersion":tauri::VERSION, "electronVersion":"",
        "version":app.package_info().version.to_string(), "platform":PLATFORM, "arch":arch,
        "update":updater::initial(&app, state.profile.test) })
}

#[tauri::command]
async fn check_for_updates(app: AppHandle) -> Value {
    updater::check(app).await
}

fn write_smoke(state: &State, result: Value) -> Option<bool> {
    if !state.profile.smoke || state.smoke_done.swap(true, Ordering::AcqRel) {
        return None;
    }
    Some(
        match serde_json::to_vec(&result)
            .map_err(std::io::Error::other)
            .and_then(|bytes| atomic_write(&state.profile.dir.join(SMOKE_FILE), &bytes))
        {
            Ok(()) => result["ok"] == true,
            Err(err) => {
                eprintln!("Sumi could not write smoke result: {err}");
                false
            }
        },
    )
}

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct SmokeReport {
    ok: bool,
    checks: SmokeChecks,
    error: Option<String>,
}

#[derive(Default, serde::Deserialize, serde::Serialize)]
#[serde(default, rename_all = "camelCase", deny_unknown_fields)]
struct SmokeChecks {
    runtime_info: bool,
    preferences: bool,
    secure_context: bool,
    media_devices: bool,
    health: bool,
}

#[tauri::command]
async fn smoke_report(app: AppHandle, report: SmokeReport) -> Result<(), &'static str> {
    let state = app.state::<State>();
    if !state.profile.smoke {
        return Err("Smoke mode is disabled");
    }
    let result = tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<State>();
        let path = state.profile.dir.join(SMOKE_DOWNLOAD);
        let deadline = Instant::now() + Duration::from_secs(8);
        let claimed = report.ok
            && report.checks.runtime_info
            && report.checks.preferences
            && report.checks.secure_context
            && report.checks.media_devices
            && report.checks.health;
        let mut download = false;
        while claimed && !state.backend.stopping() && Instant::now() < deadline {
            if std::fs::read(&path).is_ok_and(|bytes| bytes == SMOKE_DOWNLOAD_BYTES) {
                download = true;
                break;
            }
            thread::sleep(Duration::from_millis(40));
        }
        let mut checks = serde_json::to_value(report.checks).expect("serialize smoke booleans");
        checks["nativeBlobDownload"] = json!(download);
        let ok = claimed && download;
        let mut result = json!({"ok":ok, "checks":checks});
        if !ok {
            result["error"] = json!(report
                .error
                .unwrap_or_else(|| if claimed {
                    "Native blob download did not complete".into()
                } else {
                    "WebView smoke check failed".into()
                })
                .chars()
                .take(512)
                .collect::<String>());
        }
        if let Some(success) = write_smoke(&state, result) {
            app.exit(if success { 0 } else { 1 });
        }
    })
    .await;
    result.map_err(|_| "Smoke task failed")
}

fn failure(app: &AppHandle, message: &str) {
    let Some(state) = app.try_state::<State>() else {
        return;
    };
    if state.backend.stopping() || state.failed.swap(true, Ordering::AcqRel) {
        return;
    }
    eprintln!("Sumi Rust: {message}");
    if state.profile.smoke {
        if write_smoke(&state, json!({"ok": false, "checks": {}, "error":message})).is_some() {
            app.exit(1);
        }
    } else {
        let handle = app.clone();
        let message = message.to_string();
        let _ = app.run_on_main_thread(move || {
            platform::notice("Sumi Rust could not open", &message);
            handle.exit(1);
        });
    }
}

fn setup(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let home = app.path().home_dir()?;
    let profile = Profile::open(&home)?;
    let mut prefs = Preferences::open(&profile.dir, profile.test)?;
    if profile.smoke && prefs.value().get("journal-theme-v1").is_none() {
        let mut seed = prefs.value().clone();
        seed["journal-theme-v1"] = json!("dark");
        prefs.save(seed)?;
    }
    let runtime = if tauri::is_dev() {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../runtime")
    } else {
        app.path().resource_dir()?.join("runtime")
    };
    window::menu(app)?;
    #[cfg(not(target_os = "macos"))]
    let bridge_key = {
        let mut bytes = [0_u8; 32];
        getrandom::fill(&mut bytes).map_err(std::io::Error::other)?;
        bytes.iter().map(|b| format!("{b:02x}")).collect()
    };
    let (backend, ready) = Backend::spawn(&runtime, &profile, &home)?;
    let smoke = profile.smoke;
    app.manage(State {
        profile,
        prefs: Mutex::new(prefs),
        backend: backend.clone(),
        #[cfg(target_os = "macos")]
        dispatch_ticket: Default::default(),
        #[cfg(not(target_os = "macos"))]
        bridge_key,
        downloads: Default::default(),
        smoke_done: false.into(),
        failed: false.into(),
        updating: false.into(),
        zoom: Mutex::new(1.0),
    });
    let handle = app.handle().clone();
    thread::Builder::new().name("sumi-backend-watch".into()).spawn(move || {
        let started = Instant::now();
        let mut shown = None;
        while !backend.stopping() {
            match backend.status() {
                Ok(None) => (),
                status => {
                    let details = match status {
                        Ok(Some(status)) => status.to_string(),
                        Err(err) => err.to_string(),
                        _ => unreachable!(),
                    };
                    failure(&handle, &format!("The local journal server stopped ({details}). See tauri-desktop.log in the journal profile."));
                    break;
                }
            }
            if shown.is_none() {
                if let Ok(origin) = ready.try_recv() {
                    let app = handle.clone();
                    if handle.run_on_main_thread(move || {
                        if !app.state::<State>().backend.stopping() {
                            if let Err(err) = window::open(&app, origin) { failure(&app, &err.to_string()); }
                        }
                    }).is_err() { break; }
                    shown = Some(Instant::now());
                } else if started.elapsed() >= STARTUP_TIMEOUT {
                    failure(&handle, "The local journal server did not report an exact readiness line before the startup deadline.");
                    break;
                }
            } else if smoke
                && (shown.is_some_and(|time| time.elapsed() >= Duration::from_secs(35))
                    || started.elapsed() >= Duration::from_secs(85))
                && !handle.state::<State>().smoke_done.load(Ordering::Acquire) {
                failure(&handle, "The WebView did not report its smoke checks before the deadline.");
                break;
            }
            thread::sleep(Duration::from_millis(40));
        }
    })?;
    Ok(())
}

fn main() -> std::process::ExitCode {
    let builder = tauri::Builder::default();
    #[cfg(target_os = "macos")]
    let builder = builder.invoke_system(r#"
            Object.defineProperty(window.__TAURI_INTERNALS__, 'postMessage', {
                value: (message) => window.webkit.messageHandlers.sumi.postMessage(JSON.stringify(message))
            });
        "#);
    #[cfg(not(target_os = "macos"))]
    let builder = platform::ipc(builder);
    let result = builder
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(move |invoke| {
            let view = invoke.message.webview();
            let Some(state) = view.try_state::<State>() else {
                invoke.resolver.reject("Unauthorized Sumi frame");
                return true;
            };
            let supplied = invoke
                .message
                .headers()
                .get("sumi-native-frame")
                .and_then(|v| v.to_str().ok());
            #[cfg(target_os = "macos")]
            let authorized = supplied.is_some()
                && supplied == state.dispatch_ticket.lock().unwrap().take().as_deref();
            #[cfg(not(target_os = "macos"))]
            let authorized = supplied == Some(state.bridge_key.as_str());
            if view.label() != LABEL || !authorized {
                invoke.resolver.reject("Unauthorized Sumi frame");
                return true;
            }
            if invoke.message.command() == "smoke_report" && !state.profile.smoke {
                invoke.resolver.reject("Smoke mode is disabled");
                return true;
            }
            #[cfg(target_os = "macos")]
            let handler: fn(tauri::ipc::Invoke<tauri::Wry>) -> bool = tauri::generate_handler![
                save_preferences,
                runtime_info,
                check_for_updates,
                smoke_report
            ];
            #[cfg(not(target_os = "macos"))]
            let handler: fn(tauri::ipc::Invoke<tauri::Wry>) -> bool = tauri::generate_handler![
                save_preferences,
                runtime_info,
                check_for_updates,
                smoke_report,
                portable::open_external
            ];
            handler(invoke)
        })
        .setup(|app| {
            if let Err(err) = setup(app) {
                eprintln!("Sumi Rust startup failed: {err}");
                if std::env::var_os("SUMI_TEST_MODE").is_none_or(|v| v != "1") {
                    platform::notice("Sumi Rust could not start", &err.to_string());
                }
                app.handle().exit(1);
            }
            Ok(())
        })
        .on_menu_event(window::menu_event)
        .build(tauri::generate_context!());
    let app = match result {
        Ok(app) => app,
        Err(err) => {
            eprintln!("Sumi Rust startup failed: {err}");
            return std::process::ExitCode::FAILURE;
        }
    };
    app.run(|app, event| match event {
        RunEvent::ExitRequested { api, code, .. } => {
            if code.is_none()
                && app.get_webview_window(LABEL).is_none()
                && app
                    .try_state::<State>()
                    .is_some_and(|s| !s.backend.stopping() && !s.failed.load(Ordering::Acquire))
            {
                // Last window closing during startup transitions must not exit the app.
                // A user closing the main window explicitly exits from its close handler.
                api.prevent_exit();
            } else if let Some(state) = app.try_state::<State>() {
                window::persist(app, &state);
                state.backend.stop();
                state.downloads.clear();
            }
        }
        RunEvent::Exit => {
            if let Some(state) = app.try_state::<State>() {
                state.backend.stop();
                state.downloads.clear();
            }
        }
        #[cfg(target_os = "macos")]
        RunEvent::Reopen { .. } => {
            if let Some(window) = app.get_webview_window(LABEL) {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }
        _ => (),
    });
    std::process::ExitCode::SUCCESS
}
