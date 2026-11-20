#!/usr/bin/env bash
# Verifies the macOS .dmg produced by `pnpm tauri:build`: it must mount, hold Sumi.app and an
# Applications symlink, and the app copied out of it must be intact and pass the packaged smoke.
# Usage: bash desktop/tauri/verify-macos-dmg.sh [path-to.dmg]
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
fail() { echo "::error::DMG verification failed: $*"; exit 1; }

dmg="${1:-}"
if [ -z "$dmg" ]; then
  shopt -s nullglob
  dmgs=("$root"/desktop/tauri/src-tauri/target/release/bundle/dmg/*.dmg)
  [ "${#dmgs[@]}" -eq 1 ] || fail "expected exactly one .dmg in bundle/dmg, found ${#dmgs[@]}"
  dmg="${dmgs[0]}"
fi
[ -s "$dmg" ] || fail "missing or empty disk image: $dmg"
echo "Verifying $dmg"

work="$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/sumi-dmg.XXXXXX")"
mnt="$work/mount"
mkdir "$mnt" "$work/copy"
attached=0
cleanup() {
  if [ "$attached" = 1 ]; then hdiutil detach "$mnt" -force >/dev/null 2>&1 || true; fi
  rm -rf "$work"
}
trap cleanup EXIT

hdiutil attach -nobrowse -readonly -mountpoint "$mnt" "$dmg" >/dev/null || fail "hdiutil could not mount $dmg"
attached=1

[ -d "$mnt/Sumi.app" ] || fail "Sumi.app is missing from the disk image (found: $(ls -A "$mnt" | tr '\n' ' '))"
[ -L "$mnt/Applications" ] || fail "Applications is not a symlink in the disk image"
[ "$(readlink "$mnt/Applications")" = "/Applications" ] || fail "Applications points to $(readlink "$mnt/Applications"), expected /Applications"

ditto "$mnt/Sumi.app" "$work/copy/Sumi.app"
hdiutil detach "$mnt" >/dev/null || fail "could not detach $mnt"
attached=0

app="$work/copy/Sumi.app"
codesign --verify --deep --strict --verbose=2 "$app" || fail "codesign --verify failed for the app copied from the disk image"
exe="$(/usr/bin/plutil -extract CFBundleExecutable raw -o - "$app/Contents/Info.plist")"
[ -x "$app/Contents/MacOS/$exe" ] || fail "Contents/MacOS/$exe is not executable"

node "$root/desktop/tauri/run.mjs" check "$app/Contents/MacOS/$exe" || fail "packaged smoke failed for the app copied from the disk image"
echo "DMG verified: $(basename "$dmg")"
