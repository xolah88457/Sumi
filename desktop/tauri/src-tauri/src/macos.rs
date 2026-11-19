use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    ptr::null_mut,
    sync::{Arc, Mutex},
};

use block2::{Block, RcBlock};
use objc2::{
    define_class, msg_send,
    rc::Retained,
    runtime::{NSObject, ProtocolObject},
    DefinedClass, MainThreadOnly,
};
use objc2_app_kit::{
    NSAlert, NSAlertFirstButtonReturn, NSModalResponseOK, NSOpenPanel, NSSavePanel, NSTextField,
    NSWorkspace,
};
use objc2_foundation::{
    ns_string, MainThreadMarker, NSArray, NSData, NSError, NSHTTPURLResponse, NSObjectProtocol,
    NSPoint, NSRect, NSSize, NSString, NSURLResponse, NSURL,
};
use objc2_web_kit::{
    WKContentWorld, WKDownload, WKDownloadDelegate, WKFrameInfo, WKMediaCaptureType, WKNavigation,
    WKNavigationAction, WKNavigationActionPolicy, WKNavigationDelegate, WKNavigationResponse,
    WKNavigationResponsePolicy, WKOpenPanelParameters, WKPermissionDecision, WKScriptMessage,
    WKScriptMessageHandler, WKSecurityOrigin, WKUIDelegate, WKUserContentController, WKUserScript,
    WKUserScriptInjectionTime, WKWebView,
};
use tauri::{
    ipc::{CallbackFn, InvokeResponse, InvokeResponseBody},
    webview::InvokeRequest,
    AppHandle, Manager, Url, WebviewWindow,
};

use crate::{
    security::{download_url, safe_external, same_origin},
    State, LABEL,
};

#[derive(serde::Deserialize)]
struct Message {
    cmd: String,
    callback: u32,
    error: u32,
    payload: serde_json::Value,
}

pub struct Hooks {
    app: AppHandle,
    origin: Url,
    wry_navigation_delegate: Option<Retained<ProtocolObject<dyn WKNavigationDelegate>>>,
    // AppKit's WebKit delegates are weak. Its content controller owns our hook.
    downloads: Arc<Downloads>,
    smoke_download: Option<PathBuf>,
    dispatch_ticket: Arc<Mutex<Option<String>>>,
}

#[derive(Default)]
pub struct Downloads(Mutex<HashMap<usize, (tempfile::TempDir, PathBuf)>>);

impl Downloads {
    pub fn clear(&self) {
        self.0.lock().unwrap().clear();
    }

    pub fn trace_summary(&self) -> String {
        "macOS downloads use the WKDownload delegate".into()
    }
}

fn is_attachment(response: &NSURLResponse) -> bool {
    response
        .downcast_ref::<NSHTTPURLResponse>()
        .is_some_and(|http| {
            http.valueForHTTPHeaderField(ns_string!("Content-Disposition"))
                .is_some_and(|header| {
                    header
                        .to_string()
                        .split(';')
                        .next()
                        .is_some_and(|disposition| {
                            disposition.trim().eq_ignore_ascii_case("attachment")
                        })
                })
        })
}

fn document_url(frame: &WKFrameInfo) -> Option<Url> {
    let url = unsafe { frame.request() }.URL()?.absoluteString()?;
    Url::parse(&url.to_string()).ok()
}

fn trusted_origin(origin: &WKSecurityOrigin, expected: &Url) -> bool {
    unsafe { origin.protocol() }.to_string() == "http"
        && unsafe { origin.host() }.to_string() == "127.0.0.1"
        && unsafe { origin.port() } == expected.port_or_known_default().unwrap_or(0) as isize
}

fn trusted_frame(frame: &WKFrameInfo, origin: &Url) -> Option<Url> {
    if !unsafe { frame.isMainFrame() }
        || !trusted_origin(unsafe { frame.securityOrigin() }.as_ref(), origin)
    {
        return None;
    }
    document_url(frame).filter(|url| same_origin(url, origin))
}

fn alert(mtm: MainThreadMarker, title: &str, text: &str) -> Retained<NSAlert> {
    let alert = NSAlert::new(mtm);
    alert.setMessageText(&NSString::from_str(title));
    alert.setInformativeText(&NSString::from_str(text));
    alert
}

pub fn notice(title: &str, text: &str) {
    if let Some(mtm) = MainThreadMarker::new() {
        alert(mtm, title, text).runModal();
    }
}

pub fn confirm_update(version: &str) -> bool {
    let Some(mtm) = MainThreadMarker::new() else {
        return false;
    };
    let dialog = alert(
        mtm,
        "Update Sumi?",
        &format!("Install version {version} and restart Sumi?"),
    );
    dialog.addButtonWithTitle(ns_string!("Install and Restart"));
    dialog.addButtonWithTitle(ns_string!("Not Now"));
    dialog.runModal() == NSAlertFirstButtonReturn
}

pub fn open_path(path: &Path) {
    if let Some(path) = path.to_str() {
        NSWorkspace::sharedWorkspace().openURL(&NSURL::fileURLWithPath(&NSString::from_str(path)));
    }
}

fn open_external(url: &Url) {
    if let Some(url) = NSURL::URLWithString(&NSString::from_str(url.as_str())) {
        NSWorkspace::sharedWorkspace().openURL(&url);
    }
}

impl Hooks {
    fn dispatch(&self, message: &WKScriptMessage) {
        let frame = unsafe { message.frameInfo() };
        let Some(url) = trusted_frame(&frame, &self.origin) else {
            return;
        };
        let Some(view) = self.app.get_webview_window(LABEL) else {
            return;
        };
        let Ok(body) = (unsafe { message.body() }).downcast::<NSString>() else {
            return;
        };
        let body = body.to_string();
        if body.len() > 512 * 1024 {
            return;
        }
        if unsafe { message.name() }.to_string() == "sumiLink" {
            if let Ok(target) = Url::parse(&body) {
                if !same_origin(&target, &self.origin) && safe_external(&target) {
                    open_external(&target);
                }
            }
            return;
        }
        let Ok(Message {
            cmd,
            callback,
            error,
            payload,
        }) = serde_json::from_str(&body)
        else {
            return;
        };
        if !matches!(
            cmd.as_str(),
            "runtime_info" | "save_preferences" | "check_for_updates" | "smoke_report"
        ) {
            return;
        }
        // Tauri's default transports lack sender-frame metadata. Strip Wry's
        // message handler and give only this frame-checked dispatcher a one-use
        // native header. This also rules out direct ipc:// custom protocol calls.
        let mut nonce = [0_u8; 24];
        if getrandom::fill(&mut nonce).is_err() {
            return;
        }
        let ticket: String = nonce.iter().map(|b| format!("{b:02x}")).collect();
        let mut headers = tauri::http::HeaderMap::new();
        headers.insert("sumi-native-frame", ticket.parse().expect("ASCII hex"));
        *self.dispatch_ticket.lock().unwrap() = Some(ticket);
        let webview: &tauri::Webview = view.as_ref();
        webview.clone().on_message(
            InvokeRequest {
                cmd,
                callback: CallbackFn(callback),
                error: CallbackFn(error),
                body: payload.into(),
                url,
                headers,
                invoke_key: self.app.invoke_key().to_string(),
            },
            Box::new(|view, _, result, success, failure| {
                let (callback, value) = match result {
                    InvokeResponse::Ok(InvokeResponseBody::Json(value)) => (success, value),
                    InvokeResponse::Err(err) => (failure, err.0.to_string()),
                    _ => (failure, "\"Unexpected IPC response\"".into()),
                };
                // JSON is parsed as a string, never evaluated as JavaScript code.
                if let Ok(encoded) = serde_json::to_string(&value) {
                    let _ = view.eval(format!(
                        "window.__TAURI_INTERNALS__.runCallback({}, JSON.parse({encoded}));",
                        callback.0
                    ));
                }
            }),
        );
        self.dispatch_ticket.lock().unwrap().take();
    }

    fn staging_path(&self, download: &WKDownload, name: &NSString) -> Option<Retained<NSURL>> {
        let frame = unsafe { download.originatingFrame() };
        trusted_frame(&frame, &self.origin)?;
        let url = unsafe { download.originalRequest() }?
            .URL()?
            .absoluteString()?;
        if !download_url(&Url::parse(&url.to_string()).ok()?, &self.origin) {
            return None;
        }
        let name = name.to_string();
        let name = Path::new(&name).file_name().and_then(|name| name.to_str());
        let final_path = if let Some(path) = &self.smoke_download {
            if name != Some("sumi-tauri-smoke.txt") {
                return None;
            }
            path.clone()
        } else {
            // Use runModal only on the main thread. Write to a temporary sibling
            // first: WKDownload refuses existing paths, even after overwrite confirmation.
            let panel = NSSavePanel::savePanel(MainThreadMarker::new()?);
            panel.setNameFieldStringValue(&NSString::from_str(name.unwrap_or("download")));
            if panel.runModal() != NSModalResponseOK {
                return None;
            }
            PathBuf::from(panel.URL()?.path()?.to_string())
        };
        if self.app.state::<State>().backend.stopping() {
            return None;
        }
        let staging = tempfile::Builder::new()
            .prefix(".sumi-download-")
            .tempdir_in(final_path.parent()?)
            .ok()?;
        let file = staging.path().join("download");
        let url = NSURL::fileURLWithPath(&NSString::from_str(file.to_str()?));
        self.downloads
            .0
            .lock()
            .unwrap()
            .insert(download as *const _ as usize, (staging, final_path));
        Some(url)
    }

    fn finish_download(&self, download: &WKDownload, success: bool) {
        let paths = self
            .downloads
            .0
            .lock()
            .unwrap()
            .remove(&(download as *const _ as usize));
        if let Some((staging, final_path)) = paths {
            if success && std::fs::rename(staging.path().join("download"), final_path).is_err() {
                notice(
                    "Could not save download",
                    "The destination is not writable.",
                );
            }
        }
    }
}

define_class!(
    #[unsafe(super(NSObject))]
    #[thread_kind = MainThreadOnly]
    #[ivars = Hooks]
    struct SumiWebKitHooks;

    unsafe impl NSObjectProtocol for SumiWebKitHooks {}

    unsafe impl WKScriptMessageHandler for SumiWebKitHooks {
        #[unsafe(method(userContentController:didReceiveScriptMessage:))]
        fn receive(&self, _: &WKUserContentController, message: &WKScriptMessage) {
            self.ivars().dispatch(message);
        }
    }

    unsafe impl WKNavigationDelegate for SumiWebKitHooks {
        #[unsafe(method(webView:decidePolicyForNavigationAction:decisionHandler:))]
        fn action(
            &self,
            _view: &WKWebView,
            action: &WKNavigationAction,
            done: &Block<dyn Fn(WKNavigationActionPolicy)>,
        ) {
            let origin = &self.ivars().origin;
            let url = unsafe { action.request() }
                .URL()
                .and_then(|u| u.absoluteString())
                .and_then(|s| Url::parse(&s.to_string()).ok());
            let source = unsafe { action.sourceFrame() }.and_then(|f| trusted_frame(&f, origin));
            let target_is_main =
                unsafe { action.targetFrame() }.is_some_and(|f| unsafe { f.isMainFrame() });
            let Some(url) = url else {
                done.call((WKNavigationActionPolicy::Cancel,));
                return;
            };
            if unsafe { action.shouldPerformDownload() }
                && source.is_some()
                && download_url(&url, origin)
            {
                done.call((WKNavigationActionPolicy::Download,));
            } else if same_origin(&url, origin) && target_is_main {
                done.call((WKNavigationActionPolicy::Allow,));
            } else {
                done.call((WKNavigationActionPolicy::Cancel,));
            }
        }

        #[unsafe(method(webView:decidePolicyForNavigationResponse:decisionHandler:))]
        fn response(
            &self,
            _view: &WKWebView,
            response: &WKNavigationResponse,
            done: &Block<dyn Fn(WKNavigationResponsePolicy)>,
        ) {
            let reply = unsafe { response.response() };
            let url = reply
                .URL()
                .and_then(|u| u.absoluteString())
                .and_then(|s| Url::parse(&s.to_string()).ok());
            let trusted = unsafe { response.isForMainFrame() }
                && url.is_some_and(|u| same_origin(&u, &self.ivars().origin));
            done.call((if !trusted {
                WKNavigationResponsePolicy::Cancel
            } else if is_attachment(&reply) || !unsafe { response.canShowMIMEType() } {
                WKNavigationResponsePolicy::Download
            } else {
                WKNavigationResponsePolicy::Allow
            },));
        }

        #[unsafe(method(webView:navigationAction:didBecomeDownload:))]
        fn action_download(&self, _: &WKWebView, _: &WKNavigationAction, download: &WKDownload) {
            unsafe { download.setDelegate(Some(ProtocolObject::from_ref(self))) };
        }

        #[unsafe(method(webView:navigationResponse:didBecomeDownload:))]
        fn response_download(
            &self,
            _: &WKWebView,
            _: &WKNavigationResponse,
            download: &WKDownload,
        ) {
            unsafe { download.setDelegate(Some(ProtocolObject::from_ref(self))) };
        }

        #[unsafe(method(webView:didCommitNavigation:))]
        fn committed(&self, view: &WKWebView, navigation: Option<&WKNavigation>) {
            // Wry releases its queued JavaScript (including IPC replies) on commit.
            if let Some(delegate) = &self.ivars().wry_navigation_delegate {
                unsafe { delegate.webView_didCommitNavigation(view, navigation) };
            }
        }

        #[unsafe(method(webView:didFinishNavigation:))]
        fn loaded(&self, view: &WKWebView, navigation: Option<&WKNavigation>) {
            if let Some(delegate) = &self.ivars().wry_navigation_delegate {
                unsafe { delegate.webView_didFinishNavigation(view, navigation) };
            }
        }

        #[unsafe(method(webViewWebContentProcessDidTerminate:))]
        fn terminated(&self, _: &WKWebView) {
            crate::failure(&self.ivars().app, "The WebKit content process stopped.");
        }
    }

    unsafe impl WKDownloadDelegate for SumiWebKitHooks {
        #[unsafe(method(download:decideDestinationUsingResponse:suggestedFilename:completionHandler:))]
        fn destination(
            &self,
            download: &WKDownload,
            _: &NSURLResponse,
            name: &NSString,
            done: &Block<dyn Fn(*mut NSURL)>,
        ) {
            let url = self.ivars().staging_path(download, name);
            done.call((url
                .as_ref()
                .map_or(null_mut(), |u| Retained::as_ptr(u).cast_mut()),));
        }

        #[unsafe(method(download:willPerformHTTPRedirection:newRequest:decisionHandler:))]
        fn redirect_download(
            &self,
            _: &WKDownload,
            _: &objc2_foundation::NSHTTPURLResponse,
            request: &objc2_foundation::NSURLRequest,
            done: &Block<dyn Fn(objc2_web_kit::WKDownloadRedirectPolicy)>,
        ) {
            let allow = request
                .URL()
                .and_then(|u| u.absoluteString())
                .and_then(|s| Url::parse(&s.to_string()).ok())
                .is_some_and(|u| same_origin(&u, &self.ivars().origin));
            done.call((if allow {
                objc2_web_kit::WKDownloadRedirectPolicy::Allow
            } else {
                objc2_web_kit::WKDownloadRedirectPolicy::Cancel
            },));
        }

        #[unsafe(method(downloadDidFinish:))]
        fn download_finished(&self, download: &WKDownload) {
            self.ivars().finish_download(download, true);
        }

        #[unsafe(method(download:didFailWithError:resumeData:))]
        fn download_failed(&self, download: &WKDownload, error: &NSError, _: Option<&NSData>) {
            eprintln!(
                "Sumi download did not complete: {}",
                error.localizedDescription()
            );
            self.ivars().finish_download(download, false);
        }
    }

    unsafe impl WKUIDelegate for SumiWebKitHooks {
        #[unsafe(method_id(webView:createWebViewWithConfiguration:forNavigationAction:windowFeatures:))]
        fn popup(
            &self,
            view: &WKWebView,
            _: &objc2_web_kit::WKWebViewConfiguration,
            action: &WKNavigationAction,
            _: &objc2_web_kit::WKWindowFeatures,
        ) -> Option<Retained<WKWebView>> {
            // Never create a popup. Preserve same-origin links in this webview.
            if unsafe { action.navigationType() } == objc2_web_kit::WKNavigationType::LinkActivated
                && unsafe { action.sourceFrame() }
                    .and_then(|f| trusted_frame(&f, &self.ivars().origin))
                    .is_some()
            {
                let request = unsafe { action.request() };
                let url = request
                    .URL()
                    .and_then(|u| u.absoluteString())
                    .and_then(|s| Url::parse(&s.to_string()).ok());
                if let Some(url) = url {
                    if same_origin(&url, &self.ivars().origin) {
                        unsafe {
                            view.loadRequest(&request);
                        }
                    }
                }
            }
            None
        }

        #[unsafe(method(webView:requestMediaCapturePermissionForOrigin:initiatedByFrame:type:decisionHandler:))]
        fn media(
            &self,
            _: &WKWebView,
            origin: &WKSecurityOrigin,
            frame: &WKFrameInfo,
            capture: WKMediaCaptureType,
            done: &Block<dyn Fn(WKPermissionDecision)>,
        ) {
            let expected = &self.ivars().origin;
            let trusted =
                trusted_frame(frame, expected).is_some() && trusted_origin(origin, expected);
            done.call((if trusted && capture == WKMediaCaptureType::Microphone {
                WKPermissionDecision::Grant
            } else {
                WKPermissionDecision::Deny
            },));
        }

        #[unsafe(method(webView:runOpenPanelWithParameters:initiatedByFrame:completionHandler:))]
        fn upload(
            &self,
            _: &WKWebView,
            params: &WKOpenPanelParameters,
            frame: &WKFrameInfo,
            done: &Block<dyn Fn(*mut NSArray<NSURL>)>,
        ) {
            if trusted_frame(frame, &self.ivars().origin).is_none() {
                done.call((null_mut(),));
                return;
            }
            let panel = NSOpenPanel::openPanel(self.mtm());
            panel.setCanChooseFiles(true);
            panel.setCanChooseDirectories(unsafe { params.allowsDirectories() });
            panel.setAllowsMultipleSelection(unsafe { params.allowsMultipleSelection() });
            let done = done.copy();
            let selection = panel.clone();
            panel.beginWithCompletionHandler(&RcBlock::new(move |result| {
                let urls = (result == NSModalResponseOK).then(|| selection.URLs());
                done.call((urls
                    .as_ref()
                    .map_or(null_mut(), |urls| Retained::as_ptr(urls).cast_mut()),));
            }));
        }

        #[unsafe(method(webView:runJavaScriptAlertPanelWithMessage:initiatedByFrame:completionHandler:))]
        fn js_alert(
            &self,
            _: &WKWebView,
            message: &NSString,
            frame: &WKFrameInfo,
            done: &Block<dyn Fn()>,
        ) {
            if trusted_frame(frame, &self.ivars().origin).is_some() {
                alert(self.mtm(), "Sumi", &message.to_string()).runModal();
            }
            done.call(());
        }

        #[unsafe(method(webView:runJavaScriptConfirmPanelWithMessage:initiatedByFrame:completionHandler:))]
        fn js_confirm(
            &self,
            _: &WKWebView,
            message: &NSString,
            frame: &WKFrameInfo,
            done: &Block<dyn Fn(objc2::runtime::Bool)>,
        ) {
            let answer = trusted_frame(frame, &self.ivars().origin).is_some() && {
                let ask = alert(self.mtm(), "Sumi", &message.to_string());
                ask.addButtonWithTitle(ns_string!("OK"));
                ask.addButtonWithTitle(ns_string!("Cancel"));
                ask.runModal() == NSAlertFirstButtonReturn
            };
            done.call((answer.into(),));
        }

        #[unsafe(method(webView:runJavaScriptTextInputPanelWithPrompt:defaultText:initiatedByFrame:completionHandler:))]
        fn js_prompt(
            &self,
            _: &WKWebView,
            prompt: &NSString,
            default: Option<&NSString>,
            frame: &WKFrameInfo,
            done: &Block<dyn Fn(*mut NSString)>,
        ) {
            let answer = if trusted_frame(frame, &self.ivars().origin).is_some() {
                let ask = alert(self.mtm(), "Sumi", &prompt.to_string());
                let field = NSTextField::initWithFrame(
                    self.mtm().alloc(),
                    NSRect::new(NSPoint::ZERO, NSSize::new(300., 24.)),
                );
                if let Some(default) = default {
                    field.setStringValue(default);
                }
                ask.setAccessoryView(Some(&field));
                ask.addButtonWithTitle(ns_string!("OK"));
                ask.addButtonWithTitle(ns_string!("Cancel"));
                (ask.runModal() == NSAlertFirstButtonReturn).then(|| field.stringValue())
            } else {
                None
            };
            done.call((answer
                .as_ref()
                .map_or(null_mut(), |s| Retained::as_ptr(s).cast_mut()),));
        }
    }
);

pub fn install(window: &WebviewWindow, origin: Url) -> tauri::Result<()> {
    let app = window.app_handle().clone();
    let state = app.state::<State>();
    let dispatch_ticket = state.dispatch_ticket.clone();
    let downloads = state.downloads.clone();
    let smoke_download = state
        .profile
        .smoke
        .then(|| state.profile.dir.join("sumi-tauri-smoke.txt"));
    window.with_webview(move |platform| {
        // Tauri/Wry supplies a WKWebView on AppKit's main thread.
        let view = unsafe { &*platform.inner().cast::<WKWebView>() };
        let hooks = view.mtm().alloc::<SumiWebKitHooks>().set_ivars(Hooks {
            app,
            origin,
            wry_navigation_delegate: unsafe { view.navigationDelegate() },
            downloads,
            smoke_download,
            dispatch_ticket,
        });
        let hooks: Retained<SumiWebKitHooks> = unsafe { msg_send![super(hooks), init] };
        unsafe {
            let controller = view.configuration().userContentController();
            controller.removeScriptMessageHandlerForName(ns_string!("ipc"));
            controller.addScriptMessageHandler_name(
                ProtocolObject::from_ref(&*hooks),
                ns_string!("sumi"),
            );
            // Only this isolated script can post to the OS link handler. Page
            // scripts can dispatch synthetic clicks, but cannot set isTrusted.
            let world = WKContentWorld::worldWithName(ns_string!("SumiExternalLinks"), view.mtm());
            controller.addScriptMessageHandler_contentWorld_name(
                ProtocolObject::from_ref(&*hooks), &world, ns_string!("sumiLink")
            );
            let link_script = WKUserScript::initWithSource_injectionTime_forMainFrameOnly_inContentWorld(
                view.mtm().alloc(),
                ns_string!(r#"document.addEventListener('click', (event) => {
                    if (!event.isTrusted || event.defaultPrevented || event.button !== 0) return;
                    const link = event.composedPath().find((node) => node instanceof HTMLAnchorElement);
                    if (!link || link.hasAttribute('download') || !link.hasAttribute('href')) return;
                    const url = new URL(link.href);
                    if (url.origin === location.origin || url.username || url.password ||
                        !['http:', 'https:', 'mailto:'].includes(url.protocol)) return;
                    event.preventDefault();
                    window.webkit.messageHandlers.sumiLink.postMessage(url.href);
                });"#),
                WKUserScriptInjectionTime::AtDocumentStart, true, &world,
            );
            controller.addUserScript(&link_script);
            view.setNavigationDelegate(Some(ProtocolObject::from_ref(&*hooks)));
            view.setUIDelegate(Some(ProtocolObject::from_ref(&*hooks)));
            view.setAllowsBackForwardNavigationGestures(true);
        }
    })
}

pub fn force_reload(window: &WebviewWindow) -> tauri::Result<()> {
    window.with_webview(|platform| unsafe {
        (&*platform.inner().cast::<WKWebView>()).reloadFromOrigin();
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use objc2::AnyThread;
    use objc2_foundation::NSDictionary;

    #[test]
    fn explicitly_attached_displayable_response_is_a_download() {
        let url = NSURL::URLWithString(ns_string!("http://127.0.0.1:49152/report.csv")).unwrap();
        for (disposition, download) in [
            (ns_string!("Attachment; filename=report.csv"), true),
            (ns_string!("inline; filename=attachment.csv"), false),
        ] {
            let headers = NSDictionary::from_slices(
                &[
                    ns_string!("content-disposition"),
                    ns_string!("Content-Type"),
                ],
                &[disposition, ns_string!("text/csv")],
            );
            let response = NSHTTPURLResponse::initWithURL_statusCode_HTTPVersion_headerFields(
                NSHTTPURLResponse::alloc(),
                &url,
                200,
                None,
                Some(&headers),
            )
            .unwrap();
            assert_eq!(is_attachment(&response), download);
        }
    }
}
