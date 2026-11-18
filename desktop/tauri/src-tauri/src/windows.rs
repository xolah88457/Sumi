use super::{same_origin, State, LABEL};
use std::{
    ffi::{OsStr, OsString},
    os::windows::ffi::{OsStrExt, OsStringExt},
    path::{Path, PathBuf},
    ptr::{null, null_mut},
};
use tauri::{AppHandle, Manager, Url, WebviewWindow};
use webview2_com::{
    take_pwstr, CallDevToolsProtocolMethodCompletedHandler, DownloadStartingEventHandler,
    FrameCreatedEventHandler, FramePermissionRequestedEventHandler,
    Microsoft::Web::WebView2::Win32::*, NavigationStartingEventHandler,
    PermissionRequestedEventHandler, ProcessFailedEventHandler, StateChangedEventHandler,
};
use windows::core::{w, Interface, HSTRING, PWSTR};
use windows_sys::Win32::UI::{
    Controls::Dialogs::{
        GetSaveFileNameW, OFN_NOCHANGEDIR, OFN_OVERWRITEPROMPT, OFN_PATHMUSTEXIST, OPENFILENAMEW,
    },
    Shell::ShellExecuteW,
    WindowsAndMessaging::{
        MessageBoxW, IDYES, MB_DEFBUTTON2, MB_ICONERROR, MB_ICONQUESTION, MB_OK, MB_YESNO,
        SW_SHOWNORMAL,
    },
};

pub fn install(window: &WebviewWindow, origin: Url) -> tauri::Result<()> {
    let app = window.app_handle().clone();
    // with_webview runs synchronously here because the window is opened on the UI thread.
    let (tx, rx) = std::sync::mpsc::sync_channel(1);
    window.with_webview(move |platform| {
        let result = unsafe {
            platform
                .controller()
                .CoreWebView2()
                .and_then(|view| hooks(&view, app, origin))
        };
        let _ = tx.send(result.map_err(std::io::Error::other));
    })?;
    rx.try_recv()
        .map_err(|_| std::io::Error::other("WebView2 hooks were not installed"))??;
    Ok(())
}

unsafe fn hooks(view: &ICoreWebView2, app: AppHandle, origin: Url) -> windows::core::Result<()> {
    let mut token = 0;
    view.add_FrameNavigationStarting(
        &NavigationStartingEventHandler::create(Box::new(|_, args| {
            if let Some(args) = args {
                args.SetCancel(true)?;
            }
            Ok(())
        })),
        &mut token,
    )?;
    let frames: ICoreWebView2_4 = view.cast()?;
    frames.add_FrameCreated(
        &FrameCreatedEventHandler::create(Box::new(|_, args| {
            if let Some(args) = args {
                let frame: ICoreWebView2Frame3 = args.Frame()?.cast()?;
                frame.add_PermissionRequested(
                    &FramePermissionRequestedEventHandler::create(Box::new(|_, args| {
                        if let Some(args) = args {
                            args.SetState(COREWEBVIEW2_PERMISSION_STATE_DENY)?;
                            args.SetHandled(true)?;
                        }
                        Ok(())
                    })),
                    &mut 0,
                )?;
            }
            Ok(())
        })),
        &mut token,
    )?;
    let target = origin.clone();
    view.add_PermissionRequested(
        &PermissionRequestedEventHandler::create(Box::new(move |_, args| {
            let Some(args) = args else {
                return Ok(());
            };
            // WebView2 sends frame permission requests through the frame event
            // first. Frame navigations are denied; verify the requester URI too.
            let mut uri = PWSTR::null();
            let mut kind = COREWEBVIEW2_PERMISSION_KIND::default();
            args.Uri(&mut uri)?;
            let uri = take_pwstr(uri);
            args.PermissionKind(&mut kind)?;
            let allow = kind == COREWEBVIEW2_PERMISSION_KIND_MICROPHONE
                && Url::parse(&uri).is_ok_and(|url| same_origin(&url, &target));
            let settings: ICoreWebView2PermissionRequestedEventArgs3 = args.cast()?;
            settings.SetSavesInProfile(false)?;
            args.SetState(if allow {
                COREWEBVIEW2_PERMISSION_STATE_ALLOW
            } else {
                COREWEBVIEW2_PERMISSION_STATE_DENY
            })
        })),
        &mut token,
    )?;
    let handle = app.clone();
    view.add_ProcessFailed(
        &ProcessFailedEventHandler::create(Box::new(move |_, args| {
            let mut kind = COREWEBVIEW2_PROCESS_FAILED_KIND::default();
            if let Some(args) = args {
                args.ProcessFailedKind(&mut kind)?;
                if matches!(
                    kind,
                    COREWEBVIEW2_PROCESS_FAILED_KIND_BROWSER_PROCESS_EXITED
                        | COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_EXITED
                ) {
                    crate::failure(&handle, "The WebView2 content process stopped.");
                }
            }
            Ok(())
        })),
        &mut token,
    )?;
    frames.add_DownloadStarting(
        &DownloadStartingEventHandler::create(Box::new(move |view, args| {
            let Some((view, args)) = view.zip(args) else {
                return Ok(());
            };
            // Native download writes only to private staging. Suppress the default UI.
            args.SetHandled(true)?;
            args.SetCancel(true)?;
            let mut source = PWSTR::null();
            view.Source(&mut source)?;
            if !Url::parse(&take_pwstr(source)).is_ok_and(|url| same_origin(&url, &origin)) {
                return Ok(());
            }
            let operation = args.DownloadOperation()?;
            let mut uri = PWSTR::null();
            operation.Uri(&mut uri)?;
            let Ok(url) = Url::parse(&take_pwstr(uri)) else {
                return Ok(());
            };
            let mut path = PWSTR::null();
            args.ResultFilePath(&mut path)?;
            let name = take_pwstr(path);
            let state = app.state::<State>();
            if let Some(path) = state.downloads.start(&state, &url, &origin, &name) {
                let dest = HSTRING::from(path.as_path());
                let handle = app.clone();
                let finished_path = path.clone();
                let configured = operation
                    .add_StateChanged(
                        &StateChangedEventHandler::create(Box::new(move |operation, _| {
                            let Some(operation) = operation else {
                                return Ok(());
                            };
                            let mut state = COREWEBVIEW2_DOWNLOAD_STATE::default();
                            operation.State(&mut state)?;
                            if state != COREWEBVIEW2_DOWNLOAD_STATE_IN_PROGRESS {
                                // Completion runs in a WebView2 event callback. Show modal UI
                                // only after returning to the message pump.
                                let handle = handle.clone();
                                let path = finished_path.clone();
                                let success = state == COREWEBVIEW2_DOWNLOAD_STATE_COMPLETED;
                                std::thread::spawn(move || {
                                    let app = handle.clone();
                                    let _ = handle.run_on_main_thread(move || {
                                        app.state::<State>().downloads.finish(&app, &path, success)
                                    });
                                });
                            }
                            Ok(())
                        })),
                        &mut 0,
                    )
                    .and_then(|()| args.SetResultFilePath(&dest))
                    .and_then(|()| args.SetCancel(false));
                if configured.is_err() {
                    state.downloads.finish(&app, &path, false);
                }
                configured?;
            }
            Ok(())
        })),
        &mut token,
    )?;
    Ok(())
}

fn wide(value: impl AsRef<OsStr>) -> Vec<u16> {
    value.as_ref().encode_wide().chain(Some(0)).collect()
}

pub fn save_path(app: &AppHandle, name: &str) -> Option<PathBuf> {
    let owner = app.get_webview_window(LABEL)?.hwnd().ok()?.0;
    let mut file = wide(name);
    if file.len() > 260 {
        file = wide("download");
    }
    file.resize(32768, 0);
    let title = wide("Save Download");
    let mut dialog = OPENFILENAMEW {
        lStructSize: std::mem::size_of::<OPENFILENAMEW>() as u32,
        hwndOwner: owner,
        lpstrFile: file.as_mut_ptr(),
        nMaxFile: file.len() as u32,
        lpstrTitle: title.as_ptr(),
        Flags: OFN_NOCHANGEDIR | OFN_OVERWRITEPROMPT | OFN_PATHMUSTEXIST,
        ..Default::default()
    };
    if unsafe { GetSaveFileNameW(&mut dialog) } == 0 {
        return None;
    }
    Some(PathBuf::from(OsString::from_wide(
        &file[..file.iter().position(|&ch| ch == 0)?],
    )))
}

pub fn notice(title: &str, text: &str) {
    unsafe {
        MessageBoxW(
            null_mut(),
            wide(text).as_ptr(),
            wide(title).as_ptr(),
            MB_OK | MB_ICONERROR,
        )
    };
}

pub fn confirm_update(version: &str) -> bool {
    let text = format!("Install version {version} and restart Sumi Rust?");
    (unsafe {
        MessageBoxW(
            null_mut(),
            wide(text).as_ptr(),
            wide("Update Sumi Rust?").as_ptr(),
            MB_YESNO | MB_ICONQUESTION | MB_DEFBUTTON2,
        )
    }) == IDYES
}

fn open(value: impl AsRef<OsStr>) {
    let result = unsafe {
        ShellExecuteW(
            null_mut(),
            wide("open").as_ptr(),
            wide(value).as_ptr(),
            null(),
            null(),
            SW_SHOWNORMAL,
        )
    };
    if result as isize <= 32 {
        eprintln!("Could not open Sumi destination: {}", result as isize);
    }
}

pub fn open_path(path: &Path) {
    open(path);
}
pub fn open_link(url: &Url) {
    open(url.as_str());
}

pub fn force_reload(window: &WebviewWindow) -> tauri::Result<()> {
    window.with_webview(|platform| unsafe {
        if let Ok(view) = platform.controller().CoreWebView2() {
            let result = view.CallDevToolsProtocolMethod(
                w!("Page.reload"),
                w!(r#"{"ignoreCache":true}"#),
                &CallDevToolsProtocolMethodCompletedHandler::create(Box::new(|_, _| Ok(()))),
            );
            if let Err(err) = result {
                eprintln!("Could not force reload Sumi: {err}");
            }
        }
    })
}
