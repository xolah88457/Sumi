# Sumi desktop (Tauri: macOS, Windows and Linux)

Sumi is an independent, local-first desktop trading journal. See the [root README](../README.md) for the product overview. This document covers the desktop shell: how it is built, where your data lives, how it updates and how it is released.

The desktop app is a [Tauri 2](https://tauri.app) shell. It hosts the Next.js standalone server (`apps/web`) on loopback, run by a bundled official Node.js runtime with the native addons (`better-sqlite3`, `koffi`, `transcribe-cpp`), and shows it in the operating system WebView (WKWebView, WebView2, WebKitGTK) instead of shipping Chromium. End users do not need Node.js or a browser. Sumi is desktop-only; there is no hosted distribution. Developers can run the web app alone with `pnpm dev`.

Sumi used to ship as an Electron app (0.3.x). Electron has been removed; see [Moving from the Electron app](#moving-from-the-electron-app).

## Layout

| Path                                 | Purpose                                                                                               |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| `desktop/tauri/src-tauri/`           | Rust shell: window, menus, profile and preferences, backend process, security policy, updater         |
| `desktop/tauri/run.mjs`              | `build`, `open` and `check` for the packaged app                                                      |
| `desktop/tauri/stage-runtime.mjs`    | Stages the standalone server, bundled Node and licences into `desktop/tauri/runtime/`                 |
| `desktop/tauri/bridge.js`            | Preload bridge exposing `window.sumiDesktop` (preferences, runtime info, update check)                |
| `desktop/tauri/release-manifest.mjs` | Builds the updater `latest.json` from signed release artifacts                                        |
| `desktop/launch.cjs`                 | Entry point run by the bundled Node: starts the Next.js server, prints the readiness line, shuts down |
| `desktop/lib/`                       | Build-time helpers shared by staging (`runtime.mjs`, `common.mjs`); never copied into the app         |

All desktop tests run with `node --test desktop/launch.test.mjs desktop/lib/*.test.mjs desktop/tauri/*.test.mjs`; the Rust tests with `cargo test --locked` in `desktop/tauri/src-tauri`.

## Platforms and packages

| Target      | Native CI host         | WebView               | Package and smoke target                                                             |
| ----------- | ---------------------- | --------------------- | ------------------------------------------------------------------------------------ |
| macOS arm64 | macOS 15 Apple Silicon | WKWebView             | `Sumi.app` (macOS 13+)                                                               |
| macOS x64   | macOS 15 Intel         | WKWebView             | `Sumi.app` (macOS 13+)                                                               |
| Windows x64 | Windows Server 2025    | Edge WebView2         | `Sumi_<version>_x64-setup.exe` (NSIS); standalone `sumi.exe` with sibling `runtime/` |
| Linux x64   | Ubuntu 22.04 LTS       | WebKitGTK 4.1 / GTK 3 | `Sumi_<version>_amd64.AppImage` (release) and `.deb` (CI/local)                      |

The Linux baseline is Ubuntu 22.04 x64 (glibc 2.35) with `libwebkit2gtk-4.1-dev`. Building on a newer distribution can raise the glibc baseline, and AppArmor can restrict unprivileged namespaces; do not disable the WebKit sandbox to make a smoke test pass. 32-bit and Arm Windows/Linux are not supported. Native ASR inference (the ~700 MB Parakeet model) is not run in CI; staging probes the bundled SQLite addon and Silero VAD instead.

## Build and try it safely

Use native Node **26.13.1** (the bundled runtime ABI), the pnpm version pinned in the root `package.json`, and stable Rust on the architecture you plan to run. Do not cross-compile this runtime. Prerequisites:

- macOS: Xcode Command Line Tools and a logged-in desktop session for `open` and `check`.
- Windows: Visual Studio C++ Build Tools with the Windows SDK and MSVC x64 tools, the Evergreen WebView2 Runtime and a desktop session. Keep the executable next to `runtime/` when testing the standalone payload. The build bundles the app-local Visual C++ 14.x CRT DLLs (`msvcp140.dll`, `vcruntime140.dll`, `vcruntime140_1.dll`) found through `vswhere` or `VCToolsRedistDir`, so users need no Redistributable.
- Linux (Ubuntu 22.04): use a graphical session for manual checks or Xvfb for headless smoke.

```sh
sudo apt-get install -y build-essential pkg-config libssl-dev libgtk-3-dev \
  libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev \
  patchelf libfuse2 dbus-x11 xvfb xauth
```

From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm tauri:build   # alias: pnpm desktop:build
pnpm tauri:check   # alias: pnpm desktop:check
pnpm tauri:open    # alias: pnpm desktop:open
```

- `tauri:build` builds the web app, stages `desktop/tauri/runtime/` with the bundled runtime and invokes the pinned Tauri CLI. Output is under `desktop/tauri/src-tauri/target/release/`: `bundle/macos/`, `bundle/nsis/` plus `sumi.exe` with `runtime/`, or `bundle/deb/` and `bundle/appimage/`.
- `tauri:check` runs the runner tests and launches the built `.app`, Windows standalone payload or Linux AppImage. Missing packages, failed checks, timeouts and nonzero exits fail the command. Test an installed executable with `node desktop/tauri/run.mjs check <packaged-executable>`; do not pass an installer.
- `tauri:open` launches the same package interactively with a disposable journal.

For headless Linux, including after installing the local `.deb` on a test machine:

```sh
WEBKIT_DISABLE_DMABUF_RENDERER=1 dbus-run-session -- xvfb-run -a pnpm tauri:check
WEBKIT_DISABLE_DMABUF_RENDERER=1 dbus-run-session -- xvfb-run -a \
  node desktop/tauri/run.mjs check /usr/bin/sumi
```

Each runner launch uses a new canonical temp directory with `SUMI_TEST_MODE=1` and an explicit `JOURNAL_DATA_DIR`, ignores inherited journal and backend overrides, and removes its scratch directory afterwards. Use synthetic records, CSVs, audio and attachments only, and never live broker, AI or other third-party credentials. Launching from Finder, Start or the desktop menu bypasses the runner and opens your real journal.

## Where your data lives

All user databases, encrypted credentials, preferences and downloaded voice weights live in one per-user folder, the same one the Electron app used:

| OS      | Journal data directory                                                                                       |
| ------- | ------------------------------------------------------------------------------------------------------------ |
| macOS   | `~/Library/Application Support/Sumi`                                                                         |
| Windows | `%APPDATA%\Sumi` (`C:\Users\<user>\AppData\Roaming\Sumi`)                                                    |
| Linux   | `$XDG_CONFIG_HOME/Sumi`, or `~/.config/Sumi` if unset (a relative `XDG_CONFIG_HOME` or `APPDATA` is ignored) |

```text
<data directory>/
  journal.db          # primary SQLite database (trades, accounts, notes, playbooks)
  journal.db-wal      # SQLite write-ahead log
  .secret             # generated key for credentials encrypted at rest
  preferences.json    # desktop theme, layout and sidebar preferences (mode 0600)
  tauri-desktop.log   # backend startup and diagnostic log
  tauri-window.json   # window size and position
  tauri.lock          # single-instance lock
  tauri-webview/      # WebView storage (Linux and Windows)
  voice/              # on-device Parakeet model weights (downloaded on demand)
  electron/           # left behind by the old Electron app; safe to delete once you no longer need it
```

Choose **Sumi > Show Journal Data** in the menu to open the folder.

- **Backups**: quit Sumi and copy the entire folder, including the hidden `.secret` file. Never delete, overwrite or merge an existing journal folder.
- **Preferences**: `preferences.json` keeps only `journal-*` string keys, written atomically with mode `0600` under a 64 KiB bound. A corrupt file is preserved as `preferences.json.corrupt-*` and never silently overwritten. On macOS, if no `preferences.json` exists yet, preferences are imported once from `defaults` (`local.sumi.journal`, `journalPreferences`).
- **Bundle identifier**: `local.sumi.journal` (the former Electron `appId`). It does not affect where the journal lives: that path is fixed above and does not use Tauri's per-identifier app directories. The identifier only names macOS WebView storage and the Windows installer's registry entry. The NSIS uninstaller's optional "delete application data" removes `%APPDATA%\local.sumi.journal`, never `%APPDATA%\Sumi`.
- **Never run two shells on one journal**: the app takes an exclusive lock (`tauri.lock`), but the old Electron app uses a different lock. Quit any remaining Electron copy before opening the Tauri app.

## Moving from the Electron app

The Electron app does not update itself into this one. Install the new build once (the macOS `Sumi.app` replaces the old one in `/Applications`; on Windows run the new installer; on Linux run the AppImage). Open it and your journal is there: it reads the same data directory, including `journal.db`, `.secret`, attachments, voice weights and `preferences.json`. Nothing is copied, moved or deleted. Not carried over: WebView-only state the old Chromium profile kept in `electron/` (all app preferences use the `journal-*` keys stored in `preferences.json`, so the visible settings survive). Back up the data folder before the first launch if you want a safety copy.

## Process and network isolation

- The backend binds an OS-assigned ephemeral port on `127.0.0.1` and prints exactly one `SUMI_READY http://127.0.0.1:<port>` line; the shell accepts nothing else as readiness.
- The backend child gets an explicit environment (`PATH`, `HOME`/`USERPROFILE`, `TMPDIR`, `LANG`, `JOURNAL_DATA_DIR` and a few Windows system variables). It does not inherit `NODE_OPTIONS`, API keys or shell variables. Enter API credentials in **Settings > AI**.
- On Unix the backend runs in its own process group and shutdown signals the whole group (SIGTERM, then SIGKILL after 3 s); on Windows it runs in a job object. A second launch is refused by the profile lock.
- IPC is limited to a fixed command set, validated by sender origin. Navigation stays on the loopback origin; other links open in the default browser (`http`, `https`, `mailto` without credentials only). Downloads accept same-origin, same-origin `blob:` and a few `data:` types.

## Updates

Updates use [`tauri-plugin-updater`](https://v2.tauri.app/plugin/updater/) against a `latest.json` published on GitHub Releases, verified with an independent Tauri (minisign) key pair. The feed URL and public key are compiled in from `SUMI_TAURI_UPDATER_ENDPOINT` and `SUMI_TAURI_UPDATER_PUBKEY`; neither can be changed at runtime. **A build without both reports "updates unavailable" in Settings > About**, which is the state of every local and unsigned CI build. **Check for updates** is user-initiated, asks before installing, and restarts the app.

Updater artifacts and signatures are produced only when `TAURI_SIGNING_PRIVATE_KEY` is set during `pnpm tauri:build` (the key is stripped from the staging and web build steps). Generate a key pair with `pnpm tauri signer generate` and keep the private key out of the repository.

## Releases

`.github/workflows/release.yml` runs when a tag `v<semver>` (for example `v0.4.0`) is pushed. It requires that:

1. the tag matches `package.json`, `desktop/tauri/src-tauri/tauri.conf.json` and `Cargo.toml` versions, and
2. the tagged commit is on the default branch (named `electron` for historical reasons).

It runs typecheck and tests, builds the macOS arm64, macOS x64, Windows x64 and Linux x64 packages natively (the same matrix as `tauri-ci.yml`), smoke-tests each, and attaches one installer per platform (`.dmg`, Windows setup `.exe`, `.AppImage`) to a **draft** GitHub Release with `SHA256SUMS.txt`. When signing is configured it also attaches the macOS `.app.tar.gz` updater payloads and `latest.json`, which embeds the update signatures (no detached `.sig` files are published). The `.deb` is still built and smoke-tested in CI but is not uploaded. Merging to the default branch never releases. Review the draft, then publish it; the updater feed (`releases/latest/download/latest.json`) only becomes live once the release is published.

Repository settings the owner provides:

| Name                                 | Kind     | Purpose                                                                             |
| ------------------------------------ | -------- | ----------------------------------------------------------------------------------- |
| `TAURI_SIGNING_PRIVATE_KEY`          | secret   | Signs updater artifacts. Without it, no updater artifacts and no `latest.json`      |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | secret   | Password of that key, if it has one                                                 |
| `TAURI_UPDATER_PUBKEY`               | variable | Public key (the `.pub` file contents); required when the signing key is set         |
| `TAURI_UPDATER_ENDPOINT`             | variable | Optional feed URL override; default is the repository's `latest.json` release asset |

Windows builds are unsigned; SmartScreen shows "Unknown publisher": choose **More info**, then **Run anyway**. Updater signatures (above) are separate from Apple code signing. Never commit keys or certificates.

### macOS: unsigned builds (the default)

Without the Apple secrets below, the macOS build is ad-hoc signed and not notarized, and everything works the same except the first launch. **This is needed only once, for the first install**; the release notes carry the same steps:

1. Move Sumi to Applications and open it once. macOS shows a warning that it cannot verify the app; dismiss it.
2. Open **System Settings > Privacy & Security**, scroll to **Security**, click **Open Anyway** next to Sumi, and confirm.

On macOS 15 (Sequoia) and later, Control-click > Open no longer bypasses Gatekeeper; use Open Anyway as above. Terminal alternative, run before opening the app: `xattr -dr com.apple.quarantine /Applications/Sumi.app`.

Later in-app updates do not trigger Gatekeeper again. `tauri-plugin-updater` verifies the download against Sumi's own update signature, then unpacks it and replaces the app in place from the running app. It neither sets nor strips the quarantine attribute (the plugin contains no quarantine handling); a file written by a running, already-trusted app is never quarantined, and Gatekeeper only assesses quarantined files. This is read from the plugin source and not yet exercised on a real Mac.

### macOS: Developer ID signing and notarization (optional)

When the secrets below are present, `release.yml` imports the certificate into a temporary keychain (deleted in an `always()` step), signs every Mach-O file in the bundled Node runtime and native modules with the hardened runtime and a secure timestamp (`desktop/tauri/macos-signing.mjs`; Tauri does not reliably sign files inside resources, and notarization rejects any that are unsigned), then lets Tauri sign and notarize the app. It then runs `codesign --verify --deep --strict`, `spctl --assess` and `xcrun stapler validate`, and the release notes omit the Gatekeeper workaround. With the secrets absent the build is the unsigned one above. A partly configured set of secrets fails the build rather than silently downgrading it.

Setup:

1. Join the [Apple Developer Program](https://developer.apple.com/programs/) (paid, annual). Only the Account Holder can create Developer ID certificates.
2. Create a **Developer ID Application** certificate: in the Apple Developer portal, Certificates, add a certificate of that type, upload a certificate signing request (Keychain Access > Certificate Assistant > Request a Certificate From a Certificate Authority, saved to disk), then download and double-click the `.cer`.
3. In Keychain Access, find "Developer ID Application: Your Name (TEAMID)" under My Certificates, right-click > Export, and save as a `.p12` with a strong password. Encode it for the secret: `base64 -i certificate.p12 | pbcopy`. The exact certificate name is the signing identity.
4. For notarization, create an App Store Connect API key (recommended): App Store Connect > Users and Access > Integrations > App Store Connect API > Team Keys, generate a key with the **Developer** role, and note the Issuer ID and Key ID. Download the `.p8` once (Apple will not show it again).
5. Add the repository secrets (Settings > Secrets and variables > Actions):

| Secret                       | Value                                                                            |
| ---------------------------- | -------------------------------------------------------------------------------- |
| `APPLE_CERTIFICATE`          | Base64 of the `.p12`                                                             |
| `APPLE_CERTIFICATE_PASSWORD` | The `.p12` password                                                              |
| `APPLE_SIGNING_IDENTITY`     | For example `Developer ID Application: Your Name (TEAMID)`                       |
| `APPLE_API_ISSUER`           | App Store Connect Issuer ID                                                      |
| `APPLE_API_KEY`              | The Key ID                                                                       |
| `APPLE_API_KEY_P8`           | The full text of the `.p8` file (written to a temp file as `APPLE_API_KEY_PATH`) |
| `APPLE_ID`                   | Fallback to the API key: Apple ID email                                          |
| `APPLE_PASSWORD`             | Fallback: an [app-specific password](https://support.apple.com/102654)           |
| `APPLE_TEAM_ID`              | Fallback: the 10-character Team ID                                               |

The API key is used when all three of `APPLE_API_ISSUER`, `APPLE_API_KEY` and `APPLE_API_KEY_P8` are set; otherwise the Apple ID trio is used. Signing without any notarization credentials produces a signed but not notarized app, and the release notes keep the workaround.

The Node runtime is signed with `desktop/tauri/src-tauri/Entitlements.runtime.plist` (`allow-jit` for V8, `allow-unsigned-executable-memory` for koffi and V8 executable pages, `disable-library-validation` as a safety net for native addons; each is explained in the file). The app itself uses `Entitlements.plist` (microphone only) with Tauri's default hardened runtime.

## Parity checklist

CI requires a clean exit and a report from the packaged WebView, not a server readiness log. A green native job does not imply physical desktop or release parity.

| Area                    | Automated smoke                                                                      | Manual verification on each target                                                                                                                                        |
| ----------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Startup and preferences | Loopback health, Tauri runtime bridge, seeded preference restoration, secure context | Create and edit a synthetic trade; resize and zoom. Change a preference, reload and check it persisted before quitting.                                                   |
| Microphone and voice    | `getUserMedia` availability; staged VAD silence probe                                | Allow and deny microphone permission; record with a test mic. Verify the prompt, playback and local transcription.                                                        |
| Save dialog             | Native Blob download of known bytes to scratch                                       | Verify save and cancel, default filename and overwrite behaviour with temporary destinations only.                                                                        |
| Import and export       | Not covered by the WebView smoke                                                     | Import a synthetic CSV through the picker; export CSV and full JSON and inspect them. Do not restore into or export from a real journal.                                  |
| Updates                 | No real update installed                                                             | In an unconfigured build verify the unavailable state. Before the first release, verify check, cancel, signature rejection and a real upgrade with an isolated test feed. |

## Private offline voice dictation

On-device dictation uses `@transcribe-cpp` on every platform: Metal on Apple Silicon, CPU on Intel macOS, and CPU with optional Vulkan on Windows and Linux (no GPU required). The Silero VAD model (`silero-vad-v6.2-F32.gguf`, about 1.2 MB, MIT) is bundled and checksum-verified; the Parakeet weights (about 697 MiB) are never bundled and are downloaded on demand into `<data>/voice/`. Physical microphone behaviour across Linux sound servers and Windows devices is untested in CI.

## Licences

Upstream licences (Node.js, Kami, Silero VAD, transcribe.cpp, Visual C++ runtime notice and every shipped dependency) are collected into the bundle by staging and listed in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) and in **Settings > About**.
