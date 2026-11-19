//! Tauri/Wry transport and shared Windows/Linux download lifecycle.
use crate::{
    security::{download_url, safe_external, same_origin},
    State, LABEL, SMOKE_DOWNLOAD,
};
use std::{
    fs::File,
    io,
    path::{Path, PathBuf},
};
use tauri::{
    webview::NewWindowResponse, AppHandle, Builder, Manager, Url, WebviewWindowBuilder, Wry,
};

#[cfg(target_os = "linux")]
#[path = "linux.rs"]
mod native;
#[cfg(windows)]
#[path = "windows.rs"]
mod native;
#[cfg(target_os = "linux")]
pub use native::edit;
pub use native::{confirm_update, force_reload, install, notice, open_path};

pub fn ipc(builder: Builder<Wry>) -> Builder<Wry> {
    // Never use Tauri's custom protocol as a callable IPC transport. In Linux,
    // Wry cannot report the sender frame; only the exact top-level document's
    // document-start bridge knows the second key checked by our invoke handler.
    builder
        .register_uri_scheme_protocol("ipc", |_, _| {
            tauri::http::Response::builder()
                .status(403)
                .body(Vec::<u8>::new())
                .unwrap()
        })
        .invoke_system(r#"
        (() => {
            if (window !== window.top) return;
            const stringify = JSON.stringify;
            // Wry's wrapper looks up the native method at call time. Bind it
            // now so page scripts cannot replace it and read the envelope.
            const transport = window.chrome?.webview ?? window.webkit?.messageHandlers?.ipc;
            if (!transport) return;
            const post = transport.postMessage.bind(transport);
            const invokeKey = __INVOKE_KEY__;
            Object.defineProperty(window.__TAURI_INTERNALS__, 'postMessage', {
                value: ({ cmd, callback, error, options, payload }) => {
                    // Serialize untrusted payload separately: no page-defined toJSON
                    // can see options or substitute its own authorization envelope.
                    const frame = options?.headers?.['sumi-native-frame'];
                    post(`{"cmd":${stringify(cmd)},"callback":${stringify(callback)},"error":${stringify(error)},"payload":${stringify(payload)},"__TAURI_INVOKE_KEY__":${stringify(invokeKey)},"options":{"customProtocolIpcBlocked":true,"headers":${typeof frame === 'string' ? `{"sumi-native-frame":${stringify(frame)}}` : '{}'}}}`);
                }
            });
        })();
        "#)
}

pub fn configure<'a>(
    builder: WebviewWindowBuilder<'a, Wry, AppHandle>,
    state: &State,
    origin: &Url,
) -> WebviewWindowBuilder<'a, Wry, AppHandle> {
    let target = origin.clone();
    builder
        .devtools(false)
        .data_directory(state.profile.dir.join("tauri-webview"))
        .on_navigation(move |url| allow_navigation(url, &target))
        .on_new_window(|_, _| NewWindowResponse::Deny)
}

// Wry reports every navigation action to this hook on WebKitGTK and WebView2,
// including the blob: navigation behind `<a download>`. Rejecting it there means
// the native download never starts. Only blobs minted by our own origin pass.
fn allow_navigation(url: &Url, origin: &Url) -> bool {
    url.as_str() == "about:blank"
        || same_origin(url, origin)
        || (url.scheme() == "blob"
            && Url::parse(url.path()).is_ok_and(|inner| same_origin(&inner, origin)))
}

#[tauri::command]
pub fn open_external(app: AppHandle, target: &str) -> Result<(), &'static str> {
    let url = Url::parse(target).map_err(|_| "Invalid Sumi link")?;
    let own = app
        .get_webview_window(LABEL)
        .and_then(|window| window.url().ok());
    if target.len() > 8192 || !safe_external(&url) || own.is_none_or(|own| same_origin(&url, &own))
    {
        return Err("Invalid Sumi link");
    }
    native::open_link(&url);
    Ok(())
}

#[derive(Default)]
pub struct Downloads(std::sync::Mutex<std::collections::HashMap<PathBuf, PendingDownload>>);

struct PendingDownload {
    _staging: tempfile::TempDir,
    filename: String,
}

impl Downloads {
    pub fn clear(&self) {
        self.0.lock().unwrap().clear();
    }

    pub fn start(&self, state: &State, url: &Url, origin: &Url, filename: &str) -> Option<PathBuf> {
        if state.backend.stopping() || !download_url(url, origin) {
            return None;
        }
        let name = Path::new(filename)
            .file_name()
            .and_then(|name| name.to_str())
            .filter(|name| !name.is_empty())
            .unwrap_or("download");
        if state.profile.smoke && name != SMOKE_DOWNLOAD {
            return None;
        }
        let stage = tempfile::Builder::new()
            .prefix(".sumi-download-")
            .tempdir_in(&state.profile.dir)
            .ok()?;
        let path = stage.path().join("download");
        self.0.lock().unwrap().insert(
            path.clone(),
            PendingDownload {
                _staging: stage,
                filename: name.into(),
            },
        );
        Some(path)
    }

    pub fn finish(&self, app: &AppHandle, path: &Path, success: bool) {
        let Some(pending) = self.0.lock().unwrap().remove(path) else {
            return;
        };
        let state = app.state::<State>();
        if !success || state.backend.stopping() {
            return;
        }
        let dest = if state.profile.smoke {
            Some(state.profile.dir.join(SMOKE_DOWNLOAD))
        } else {
            native::save_path(app, &pending.filename)
        };
        if let Some(dest) = dest {
            if !state.backend.stopping() && save_download(path, &dest).is_err() {
                notice(
                    "Could not save download",
                    "The destination is not writable.",
                );
            }
        }
    }
}

fn save_download(from: &Path, dest: &Path) -> io::Result<()> {
    // The chosen folder can be on another volume. Publish complete bytes only.
    let parent = dest
        .parent()
        .ok_or_else(|| io::Error::other("missing download parent"))?;
    let mut file = tempfile::NamedTempFile::new_in(parent)?;
    io::copy(&mut File::open(from)?, &mut file)?;
    file.as_file().sync_all()?;
    file.persist(dest)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn navigation_allows_only_own_origin_blobs() {
        let origin = Url::parse("http://127.0.0.1:49000").unwrap();
        let ok = |s: &str| allow_navigation(&Url::parse(s).unwrap(), &origin);
        assert!(ok("about:blank"));
        assert!(ok("http://127.0.0.1:49000/journal"));
        assert!(ok(
            "blob:http://127.0.0.1:49000/0b1f6a52-1d2c-4c8e-9f0a-6a2f1f0c9d11"
        ));
        assert!(!ok(
            "blob:http://127.0.0.1:49001/0b1f6a52-1d2c-4c8e-9f0a-6a2f1f0c9d11"
        ));
        assert!(!ok(
            "blob:https://example.com/0b1f6a52-1d2c-4c8e-9f0a-6a2f1f0c9d11"
        ));
        assert!(!ok("data:text/csv,a"));
        assert!(!ok("https://example.com/"));
    }
}
