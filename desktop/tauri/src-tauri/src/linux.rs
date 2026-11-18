use super::{same_origin, State, LABEL};
use gtk::{gio, prelude::*};
use std::{
    cell::RefCell,
    path::{Path, PathBuf},
    rc::Rc,
};
use tauri::{AppHandle, Manager, Url, WebviewWindow};
use webkit2gtk::{
    prelude::*, PolicyDecisionType, ResponsePolicyDecision, UserMediaPermissionRequest,
};

pub fn install(window: &WebviewWindow, origin: Url) -> tauri::Result<()> {
    let app = window.app_handle().clone();
    // with_webview runs synchronously here because the window is opened on the UI thread.
    let (tx, rx) = std::sync::mpsc::sync_channel(1);
    window.with_webview(move |platform| {
        let view = platform.inner();
        let Some((settings, context)) = WebViewExt::settings(&view).zip(view.context()) else {
            let _ = tx.send(Err(std::io::Error::other(
                "WebKitGTK media or download configuration unavailable",
            )));
            return;
        };
        settings.set_enable_media_stream(true);

        // Wry checks navigation actions; WebKitGTK also exposes the final response
        // and whether it is the main resource of the top-level frame.
        let target = origin.clone();
        view.connect_decide_policy(move |_, decision, kind| {
            if kind != PolicyDecisionType::Response {
                return false;
            }
            let Some(response) = decision.downcast_ref::<ResponsePolicyDecision>() else {
                return false;
            };
            if response.is_main_frame_main_resource() {
                if let Some((reply, url)) = response.response().and_then(|reply| {
                    let url = Url::parse(&reply.uri()?).ok()?;
                    Some((reply, url))
                }) {
                    let attached = reply
                        .http_headers()
                        .and_then(|h| h.one("Content-Disposition"))
                        .is_some_and(|value| {
                            value
                                .split(';')
                                .next()
                                .is_some_and(|kind| kind.trim().eq_ignore_ascii_case("attachment"))
                        });
                    if crate::security::download_url(&url, &target)
                        && (attached || !response.is_mime_type_supported())
                    {
                        decision.download();
                        return true;
                    }
                    if same_origin(&url, &target) {
                        return false;
                    }
                }
            }
            decision.ignore();
            true
        });
        let target = origin.clone();
        view.connect_permission_request(move |view, request| {
            let allow = view
                .uri()
                .and_then(|uri| Url::parse(&uri).ok())
                .is_some_and(|url| same_origin(&url, &target))
                && request
                    .downcast_ref::<UserMediaPermissionRequest>()
                    .is_some_and(|media| {
                        media.is_for_audio_device() && !media.is_for_video_device()
                    });
            if allow {
                request.allow();
            } else {
                request.deny();
            }
            true
        });
        let handle = app.clone();
        view.connect_web_process_terminated(move |_, _| {
            crate::failure(&handle, "The WebKitGTK content process stopped.");
        });
        let view = view.downgrade();
        context.connect_download_started(move |_, download| {
            if !view.upgrade().is_some_and(|view| {
                download.web_view().as_ref() == Some(&view)
                    && view
                        .uri()
                        .and_then(|uri| Url::parse(&uri).ok())
                        .is_some_and(|url| same_origin(&url, &origin))
            }) {
                download.cancel();
                return;
            }
            let handle = app.clone();
            let target = origin.clone();
            let stage = Rc::new(RefCell::new(None::<PathBuf>));
            let destination = stage.clone();
            download.connect_decide_destination(move |download, name| {
                let url = download
                    .request()
                    .and_then(|req| req.uri())
                    .and_then(|uri| Url::parse(&uri).ok());
                // Reject redirected responses from outside loopback, even when
                // WebKit reports the original request on the download object.
                let safe_response =
                    download
                        .response()
                        .and_then(|res| res.uri())
                        .is_none_or(|uri| {
                            Url::parse(&uri)
                                .is_ok_and(|url| crate::security::download_url(&url, &target))
                        });
                let state = handle.state::<State>();
                if let Some(path) = url
                    .filter(|_| safe_response)
                    .and_then(|url| state.downloads.start(&state, &url, &target, name))
                {
                    let uri = gio::File::for_path(&path).uri();
                    destination.replace(Some(path));
                    download.set_destination(&uri);
                } else {
                    download.cancel();
                }
                true
            });
            let failed = Rc::new(std::cell::Cell::new(false));
            download.connect_failed({
                let failed = failed.clone();
                move |_, _| failed.set(true)
            });
            let handle = app.clone();
            download.connect_finished(move |_| {
                if let Some(path) = stage.take() {
                    handle
                        .state::<State>()
                        .downloads
                        .finish(&handle, &path, !failed.get());
                }
            });
        });
        let _ = tx.send(Ok(()));
    })?;
    rx.try_recv()
        .map_err(|_| std::io::Error::other("WebKitGTK hooks were not installed"))??;
    Ok(())
}

pub fn save_path(app: &AppHandle, name: &str) -> Option<PathBuf> {
    let window = app.get_webview_window(LABEL)?.gtk_window().ok()?;
    let dialog = gtk::FileChooserNative::new(
        Some("Save Download"),
        Some(&window),
        gtk::FileChooserAction::Save,
        None,
        None,
    );
    dialog.set_current_name(name);
    dialog.set_do_overwrite_confirmation(true);
    let result = (dialog.run() == gtk::ResponseType::Accept)
        .then(|| dialog.filename())
        .flatten();
    dialog.destroy();
    result
}

pub fn notice(title: &str, text: &str) {
    dialog(title, text, gtk::MessageType::Error, gtk::ButtonsType::Ok);
}

pub fn confirm_update(version: &str) -> bool {
    dialog(
        "Update Sumi Rust?",
        &format!("Install version {version} and restart Sumi Rust?"),
        gtk::MessageType::Question,
        gtk::ButtonsType::YesNo,
    ) == gtk::ResponseType::Yes
}

fn dialog(
    title: &str,
    text: &str,
    kind: gtk::MessageType,
    buttons: gtk::ButtonsType,
) -> gtk::ResponseType {
    let dialog = gtk::MessageDialog::builder()
        .modal(true)
        .message_type(kind)
        .buttons(buttons)
        .text(title)
        .secondary_text(text)
        .build();
    #[allow(deprecated)]
    let response = dialog.run();
    dialog.close();
    response
}

fn open_uri(uri: &str) {
    if let Err(err) = gio::AppInfo::launch_default_for_uri(uri, None::<&gio::AppLaunchContext>) {
        eprintln!("Could not open Sumi destination: {err}");
    }
}

pub fn open_path(path: &Path) {
    open_uri(&gio::File::for_path(path).uri());
}

pub fn open_link(url: &Url) {
    open_uri(url.as_str());
}

pub fn force_reload(window: &WebviewWindow) -> tauri::Result<()> {
    window.with_webview(|platform| platform.inner().reload_bypass_cache())
}

pub fn edit(window: &WebviewWindow, id: &str) -> tauri::Result<()> {
    let command = match id {
        "undo" => "Undo",
        "redo" => "Redo",
        "cut" => "Cut",
        "copy" => "Copy",
        "paste" => "Paste",
        "select-all" => "SelectAll",
        _ => return Ok(()),
    };
    window.with_webview(move |platform| platform.inner().execute_editing_command(command))
}
