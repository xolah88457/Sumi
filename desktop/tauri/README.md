# Sumi Rust (Tauri preview)

Sumi Rust keeps the Next.js UI, standalone server, bundled Node and native addons. It uses the operating system WebView instead of shipping Chromium. End users do not need Node. Electron builds and the Electron update channel remain separate.

## Native build and package matrix

| Target      | Native CI host         | WebView               | Package and smoke target                                                         |
| ----------- | ---------------------- | --------------------- | -------------------------------------------------------------------------------- |
| macOS arm64 | macOS 15 Apple Silicon | WKWebView             | `Sumi Rust.app`                                                                  |
| macOS x64   | macOS 15 Intel         | WKWebView             | `Sumi Rust.app`                                                                  |
| Windows x64 | Windows Server 2025    | Edge WebView2         | Standalone executable with sibling `runtime/`, then executable installed by NSIS |
| Linux x64   | Ubuntu 22.04 LTS       | WebKitGTK 4.1 / GTK 3 | Installed `.deb` and AppImage (extract-and-run under Xvfb)                       |

The Tauri matrix matches Electron's architectures, not all of its release formats. Pushes to `tauri-platform-verification` trigger the native matrix without a pull request. The Linux build baseline is **Ubuntu 22.04 x64 (glibc 2.35)** with current Jammy updates and `libwebkit2gtk-4.1-dev`. Ubuntu 24.04 also provides WebKitGTK 4.1 but is not a separate validated target; building there can raise the glibc baseline, and AppArmor can restrict unprivileged namespaces. Do not disable the WebKit sandbox to make smoke pass.

## Build and try it safely

Use native Node **26.13.1** (the bundled runtime ABI), the pnpm version pinned in the root `package.json`, and stable Rust on the architecture you plan to run. Do not cross-compile this runtime. Platform prerequisites:

- macOS: Xcode Command Line Tools and a logged-in desktop session for `open` and `check`.
- Windows: Visual Studio C++ Build Tools with the Windows SDK and MSVC x64 tools, the Evergreen WebView2 Runtime, and a desktop session. Keep the executable next to `runtime/` when testing the standalone payload; the `.exe` alone is not the package.
- Linux: Install the packages below on Ubuntu 22.04. Use a graphical session for manual checks or Xvfb for headless smoke.

```sh
sudo apt-get install -y build-essential pkg-config libssl-dev libgtk-3-dev \
  libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev \
  patchelf libfuse2 dbus-x11 xvfb xauth
```

From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm tauri:build
pnpm tauri:check
pnpm tauri:open
```

- `tauri:build` stages `desktop/tauri/runtime/` with the bundled runtime and invokes the pinned Tauri CLI. Find output under `desktop/tauri/src-tauri/target/release/`: `bundle/macos/`, `bundle/nsis/` plus `sumi-tauri.exe` with `runtime/`, or `bundle/deb/` and `bundle/appimage/`.
- `tauri:check` runs runner tests and launches the built `.app`, Windows standalone payload, or Linux AppImage. Missing packages, failed checks, timeouts, and nonzero exits fail the command. Test a trusted executable from an installed package with `node desktop/tauri/run.mjs check <packaged-executable>`; do not pass an installer to `check`.
- `tauri:open` launches the same default package interactively with a disposable journal. Quit the app to return to the terminal.

For headless Linux, including after installing the local `.deb` on a test machine:

```sh
WEBKIT_DISABLE_DMABUF_RENDERER=1 dbus-run-session -- xvfb-run -a pnpm tauri:check
WEBKIT_DISABLE_DMABUF_RENDERER=1 dbus-run-session -- xvfb-run -a \
  node desktop/tauri/run.mjs check /usr/bin/sumi-tauri
```

Each launch uses a new canonical temp directory with `SUMI_TEST_MODE=1` and an explicit `JOURNAL_DATA_DIR`. The runner ignores inherited journal and backend overrides and removes its scratch directory afterward. Use synthetic records, CSVs, audio, and attachments only. Do not enter live broker, AI, or other third-party credentials. Launching directly from Finder, Start, or the desktop menu bypasses the runner and may open the real journal. The macOS shells share `~/Library/Application Support/Sumi`; back up the entire directory and quit Electron before any intentional production migration. Never run both shells against the same journal.

## Parity checklist

CI requires a clean exit and a report from the packaged WebView, not a server readiness log or a stub. Staging separately probes the bundled SQLite addon and native Silero VAD. A green native job does not imply physical desktop or release parity.

| Area                    | Automated smoke                                                                      | Manual verification on each target                                                                                                                                                                                            |
| ----------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Startup and preferences | Loopback health, Tauri runtime bridge, seeded preference restoration, secure context | Create and edit a synthetic trade; resize and zoom. Change a preference, reload the page, and check it persisted before quitting.                                                                                             |
| Microphone and voice    | `navigator.mediaDevices.getUserMedia` availability; staged VAD silence probe         | Allow and deny microphone permission; record and stop with a test mic. Verify the permission prompt, recording playback, and local transcription.                                                                             |
| Save dialog             | Native Blob download of known bytes to scratch; no human dialog                      | Verify save and cancel, default filename, and overwrite behavior with temporary destinations only.                                                                                                                            |
| Import and export       | Not covered by the WebView smoke                                                     | Import a synthetic CSV through the picker. Export CSV and full JSON, inspect the files, and confirm expected fields and counts. Do not restore into or export from a real journal.                                            |
| Updates                 | No real update installed                                                             | In an unconfigured build verify the unavailable state. Before release, verify check, cancel, signature rejection, and a successful upgrade using an isolated test feed and a clean VM or account with synthetic journal data. |

## Release and updates

This workflow builds unsigned validation packages; it does not publish or use release credentials. For a release, provision a dedicated HTTPS Tauri update feed and an independent Tauri updater key pair. Configure the Rust app with only the feed URL and public key. Enable Tauri updater artifacts in the release config, sign those artifacts in release CI, and publish matching Tauri update URLs and signatures. Do not reuse the Electron Sparkle appcast, electron-updater metadata, or Electron signing keys. Keep private updater keys and passwords out of the repository and app bundle.

Updater artifact signatures are separate from macOS Developer ID code signing and Apple notarization. Sign and notarize distributed macOS bundles separately; a local build is not a distribution release.
