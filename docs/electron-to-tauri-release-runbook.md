# Electron to Tauri release runbook

Owner runbook for moving existing Electron users to the Tauri app. It covers one last Electron release (`electron-v0.3.8`, whose only job is to point users at the new app) and the Tauri-only release `v0.4.0`.

Everything about the updaters below was read from the source in this repository and from `node_modules/electron-updater` 6.8.11, not from memory. File and line references are given so you can re-check.

## Summary

- Electron installs find "the newest release" through GitHub's **Latest** flag. Whichever release GitHub marks Latest must carry the Electron feed files (`latest.yml`, `latest-linux.yml`, `appcast.xml`, `appcast-x64.xml`).
- Tauri 0.4.0 installs read `releases/latest/download/latest.json`, so they also depend on the Latest flag, in the opposite direction.
- One release can be Latest at a time. So `electron-v0.3.8` holds Latest for a transition window, `v0.4.0` is published **without** taking Latest, and a later Tauri release takes Latest to end the window.
- Publish `v0.4.0` first so the link in the notice works, then `electron-v0.3.8`.

## How the Electron updaters pick a release

### Windows and Linux (electron-updater)

- Configured in `desktop/update-service-platform.cjs`: provider `github`, owner `xolah88457`, repo `trade-journal` (defaults at lines 161-162, `setFeedURL` at lines 249-257), with `allowPrerelease = false` (line 264), `autoDownload = false`, no downgrade.
- The GitHub provider (`node_modules/electron-updater/out/providers/GitHubProvider.js`, `getLatestVersion`) does three things, in this order:
  1. Requests `https://github.com/<owner>/<repo>/releases.atom` (line 43). It throws "No published versions on GitHub" if the feed has no `<entry>` (line 48). The atom feed is otherwise only used for release notes in this mode.
  2. Because `allowPrerelease` is false, it calls `getLatestTagName` (line 93, defined at lines 158-175). That requests `https://github.com/<owner>/<repo>/releases/latest` with `Accept: application/json` and reads `tag_name`. This is GitHub's **Latest** release (not the newest tag, not the newest entry in the atom feed, not the highest semver).
  3. Downloads `https://github.com/<owner>/<repo>/releases/download/<tag>/<channel file>` (lines 116-135, `getBaseDownloadPath` at line 183). The channel file name is `latest` plus a platform suffix (`Provider.js` lines 30-46, `util.js` line 30): `latest.yml` on Windows, `latest-linux.yml` on Linux x64 (`-linux-<arch>` for other Linux arches), `latest-mac.yml` on macOS (unused here, see below).
- If that file is missing the provider throws `ERR_UPDATER_CHANNEL_FILE_NOT_FOUND` (line 125). Sumi surfaces it as "Update check failed" (`update-service-platform.cjs`, the `error` listener).
- The tag does not have to look like `v<semver>`: `electron-v0.3.8` is read verbatim from `tag_name`, and the version comes from inside the yml file. Version comparison uses the yml `version` against the running app version.
- Files this app needs on the Latest release: `latest.yml` (Windows), `latest-linux.yml` (Linux), plus the installers those files reference (`Sumi-<v>-win32-x64-setup.exe`, `.AppImage`, `.deb`, and the `.blockmap` files). The release workflow already produces and uploads all of them.

### macOS (Sparkle via electron-sparkle)

- macOS does not use electron-updater. `desktop/update-service.cjs` uses `electron-sparkle`, and its availability check is macOS-only (line 195).
- The feed URL is a fixed appcast URL that `desktop/build.mjs` writes into the app at build time (`SUFeedURL`, lines 452-462), taken from `desktop/update-config.json`:
  - Apple Silicon: `https://github.com/xolah88457/trade-journal/releases/latest/download/appcast.xml`
  - Intel: `https://github.com/xolah88457/trade-journal/releases/latest/download/appcast-x64.xml`
- `releases/latest/download/<asset>` is a GitHub redirect that resolves against the same **Latest** flag. The URLs are baked into every installed 0.3.x app, so they cannot be changed for installs already out there. The appcast items point their archive URLs at `releases/download/electron-v<version>/Sumi-<version>-macos-<arch>.zip` (`archiveUrlPattern` in `update-config.json`), so the zip is fetched from the tag, not from Latest.
- Files needed on the Latest release: `appcast.xml`, `appcast-x64.xml`, and the signed zips they reference. The release workflow's signing step needs the `SPARKLE_PRIVATE_KEY` secret and fails the build if it is missing.

### Consequence for the transition

Both updaters read GitHub's Latest flag, and the Tauri updater reads `releases/latest/download/latest.json`. If `v0.4.0` becomes Latest, every installed Electron app gets a 404 on its feed file and reports a failed update check, and never learns about 0.3.8. So `electron-v0.3.8` must be Latest while Electron users are expected to update.

The release workflow already publishes with `gh release create ... --latest` (last step of `.github/workflows/electron-release.yml`), so tagging `electron-v0.3.8` takes Latest by itself even if `v0.4.0` was published earlier.

Notes:

- The Electron apps reference the repository as `xolah88457/trade-journal`, while the link in the notice and the release page use `xolah88457/Sumi`. Updates work only while GitHub keeps redirecting the old name to the new one. Check this in step 5 below rather than assuming it.
- The tag-triggered job refuses a tag whose commit is not an ancestor of `origin/electron` and whose version differs from the root `package.json` (the "Validate Tag, Root Version, and Branch Ancestry" step). Merge this branch into `electron` before tagging.

## Order of operations

### 0. Preconditions

1. GitHub Actions has not run on this repository since Nov 9. Re-enable it or fix it first (repository Settings, Actions), and confirm with a trivial run (for example a push to a scratch branch, or re-running the latest `ci.yml` run). Nothing below can be released until a workflow runs.
2. Confirm the repository secret `SPARKLE_PRIVATE_KEY` exists. The macOS release jobs fail without it.
3. Merge this branch (`claude/electron-final-release`) into `electron`. Pushes to `electron` run the full build and smoke matrix without publishing, which is your dry run. Wait for it to be green.
4. Merge PR #4 (Tauri only) and make sure the Tauri release workflow for `v0.4.0` does **not** mark the release as Latest (see step 1). If the workflow cannot be told that, publish `v0.4.0` as a draft and flip it by hand.

### 1. Publish Tauri `v0.4.0` without taking Latest

- Tag `v0.4.0` and let the Tauri release run. Review the draft, check the installers and `latest.json` and signatures are attached, then publish with **Set as the latest release unchecked** (or `gh release edit v0.4.0 --latest=false` right after publishing).
- Why before the Electron release: the notice links to `https://github.com/xolah88457/Sumi/releases/tag/v0.4.0`, and Electron users who update to 0.3.8 click it immediately.
- Why not Latest: while `electron-v0.3.7` is still Latest, installed Electron apps keep working. If v0.4.0 were Latest, they would break before 0.3.8 exists.
- Confirm: `gh release list --repo xolah88457/Sumi` shows `electron-v0.3.7` as Latest and `v0.4.0` without the Latest label.

### 2. Tag and publish `electron-v0.3.8`

- From the updated `electron` branch (root `package.json` is `0.3.8`): `git tag electron-v0.3.8 && git push origin electron-v0.3.8`.
- The workflow builds macOS arm64 and x64, Windows x64 and Linux x64, runs the smoke checks, requires all feed files, and publishes with `--latest`.
- Do steps 1 and 2 close together (the same day). Between them nothing is broken for anyone, since 0.3.7 stays Latest, but the less time users spend on 0.3.7 the better.

### 3. Verify the feeds from outside

```bash
# The redirect for "latest" must land on the Electron tag
curl -sIL -o /dev/null -w '%{url_effective}\n' https://github.com/xolah88457/Sumi/releases/latest
# Expect .../releases/tag/electron-v0.3.8

# What electron-updater asks for (tag_name must be electron-v0.3.8)
curl -sL -H 'Accept: application/json' https://github.com/xolah88457/trade-journal/releases/latest

# Feed files the installed apps request
for f in latest.yml latest-linux.yml appcast.xml appcast-x64.xml; do
  curl -sIL -o /dev/null -w "$f %{http_code}\n" \
    https://github.com/xolah88457/trade-journal/releases/latest/download/$f
done
# All four must be 200 (this also proves the old repository name still redirects)
```

If any feed file is not 200, fix it before announcing anything. If `latest` points at `v0.4.0`, run `gh release edit electron-v0.3.8 --latest` and re-check.

### 4. Try a real upgrade

On at least one machine per platform, install 0.3.7, then use Settings, About, Check for updates. Expect 0.3.8 to be offered, install, relaunch, and show the banner. The release notes for earlier versions say the first real Windows upgrade was never exercised, so test Windows in particular.

### 5. Transition period

- Keep `electron-v0.3.8` as Latest for a period you choose and state publicly. Suggested: 60 to 90 days, since the Electron updater is user-initiated (no background checks) and many people open the app rarely.
- While the window is open, what Tauri 0.4.0 users see: their updater requests `releases/latest/download/latest.json`, which resolves to the Electron release, has no `latest.json`, and returns 404. The Tauri updater is being changed to treat a missing manifest as "up to date", so these users see "up to date" instead of an error. They will not receive Tauri updates during the window.
- Consequence: a Tauri fix released during the window does not reach Tauri users automatically. Either ship it as a manual download (publish it without Latest and say so on the release page), or end the window early.
- If you want to check that behavior before shipping: `curl -sIL https://github.com/xolah88457/Sumi/releases/latest/download/latest.json` should return 404 during the window.

### 6. End the window: later Tauri releases take over Latest

- Publish the next Tauri release (for example `v0.4.1`) with **Set as the latest release** checked, or run `gh release edit v0.4.1 --latest`. It must carry `latest.json` and signatures.
- From then on `releases/latest/download/latest.json` works for Tauri users, and every Tauri release after that takes Latest normally.
- Electron installs that did not update by then get a failed update check (404 on their feed file). They still run, and they still show the banner if they are on 0.3.8. Anyone still on 0.3.7 has to download the new app manually from the v0.4.0 page.
- Optionally edit the `electron-v0.3.8` release notes afterwards to say the Electron line is closed.

## Rollback

- 0.3.8 turns out broken: `gh release edit electron-v0.3.8 --latest=false` and `gh release edit electron-v0.3.7 --latest`, then fix forward with `electron-v0.3.9`. Installs that already took 0.3.8 stay on it until a newer Latest Electron feed appears.
- `v0.4.0` turns out broken: edit the release notes or pull the assets. The notice link keeps pointing at the same page, so fix the page rather than the link.

## What is in the final Electron release

- A dismissible banner at the top of the app, shown only under Electron (not in a browser and not in Tauri). "Not now" hides it until the next launch.
- A permanent notice in Settings, About, with the same message and link.
- Version `0.3.8` in the root `package.json`, which is what the release workflow's version guard checks. The Tauri version files (`tauri.conf.json`, `Cargo.toml`, `Cargo.lock`) are unchanged on this branch; the guard does not read them.
- The external link opens in the system browser through the existing preload and `sumi:open-external` path. The allowlist in `desktop/security.cjs` is protocol-based (`https`, `http`, `mailto`, no credentials), so it needed no change; `desktop/security.test.mjs` now pins the exact link.
- Release notes in `electron-release.yml` open with the final-release message and the link.
- The new app needs the old app to be quit first because the two use different single-instance locks. The notice says so.
