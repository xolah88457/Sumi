use crate::{platform, State};
use serde_json::{json, Value};
use std::{sync::atomic::Ordering, time::Duration};
use tauri::{AppHandle, Manager, Url};
use tauri_plugin_updater::UpdaterExt;

// The feed (a GitHub Releases `latest.json`) and the minisign public key are baked in at
// build time from SUMI_TAURI_UPDATER_ENDPOINT / SUMI_TAURI_UPDATER_PUBKEY. No runtime
// env or IPC argument can choose the endpoint or trust key. A build without both
// reports "updates unavailable".
fn settings() -> Option<(Url, &'static str)> {
    let key = option_env!("SUMI_TAURI_UPDATER_PUBKEY")?.trim();
    let url = Url::parse(option_env!("SUMI_TAURI_UPDATER_ENDPOINT")?).ok()?;
    if key.is_empty() || !https_url(&url) || !url.path().ends_with(".json") || url.query().is_some()
    {
        return None;
    }
    Some((url, key))
}

fn https_url(url: &Url) -> bool {
    url.scheme() == "https"
        && url.host().is_some()
        && url.username().is_empty()
        && url.password().is_none()
        && url.fragment().is_none()
}

fn state(app: &AppHandle, status: &str, message: Option<&str>) -> Value {
    let mut value = json!({"status":status, "nativeUI":true, "provider":"tauri-updater", "currentVersion":app.package_info().version.to_string()});
    if let Some(message) = message {
        value["message"] = json!(message);
    }
    value
}

pub fn initial(app: &AppHandle, test: bool) -> Value {
    if !test && !tauri::is_dev() && settings().is_some() {
        state(app, "idle", None)
    } else {
        state(
            app,
            "unavailable",
            Some("No signed Tauri update channel is configured for this build."),
        )
    }
}

pub async fn check(app: AppHandle) -> Value {
    let shell = app.state::<State>();
    let initial = initial(&app, shell.profile.test);
    if initial["status"] == "unavailable" {
        return initial;
    }
    if shell.updating.swap(true, Ordering::AcqRel) {
        return state(&app, "checking", None);
    }
    struct Reset<'a>(&'a std::sync::atomic::AtomicBool);
    impl Drop for Reset<'_> {
        fn drop(&mut self) {
            self.0.store(false, Ordering::Release);
        }
    }
    let _reset = Reset(&shell.updating);
    match update(&app).await {
        Ok(value) => value,
        Err(err) => {
            eprintln!("Sumi signed update failed: {err}");
            let mut result = state(&app, "error", None);
            result["error"] = json!("Could not check or install the signed Sumi update.");
            result
        }
    }
}

async fn update(app: &AppHandle) -> Result<Value, Box<dyn std::error::Error + Send + Sync>> {
    let (url, key) = settings().ok_or("Missing Tauri feed or public key")?;
    let updater = app
        .updater_builder()
        .endpoints(vec![url])?
        .pubkey(key)
        .timeout(Duration::from_secs(120))
        .configure_client(|client| {
            client
                .https_only(true)
                // GitHub serves release assets through an HTTPS redirect to its CDN;
                // https_only rejects any downgrade and the artifact signature is
                // still verified independently.
                .redirect(reqwest::redirect::Policy::limited(5))
        });
    #[cfg(windows)]
    let updater = {
        let app = app.clone();
        updater.on_before_exit(move || {
            // The Windows installer path exits directly, skipping Tauri's RunEvent.
            let (tx, rx) = std::sync::mpsc::sync_channel(1);
            let handle = app.clone();
            if app
                .run_on_main_thread(move || {
                    let shell = handle.state::<State>();
                    crate::window::persist(&handle, &shell);
                    shell.backend.stop();
                    shell.downloads.clear();
                    let _ = tx.send(());
                })
                .is_ok()
            {
                let _ = rx.recv_timeout(Duration::from_secs(5));
            }
            app.state::<State>().backend.stop();
            app.cleanup_before_exit();
        })
    };
    let updater = updater.build()?;
    let Some(update) = updater.check().await? else {
        return Ok(state(app, "not-available", Some("Sumi is up to date.")));
    };
    if !https_url(&update.download_url) {
        return Err("Update artifact must use HTTPS".into());
    }
    let version = update.version.clone();
    let (tx, mut rx) = tauri::async_runtime::channel(1);
    app.run_on_main_thread(move || {
        let _ = tx.try_send(platform::confirm_update(&version));
    })?;
    if rx.recv().await != Some(true) {
        let mut result = state(app, "available", Some("Update installation was postponed."));
        result["availableVersion"] = json!(update.version);
        return Ok(result);
    }
    // Download verifies the independent Tauri signature before returning bytes.
    update.download_and_install(|_, _| {}, || {}).await?;
    app.request_restart();
    Ok(state(app, "installing", Some("Restarting Sumi.")))
}
