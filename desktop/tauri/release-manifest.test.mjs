import assert from "node:assert/strict";
import test from "node:test";
import { buildManifest } from "./release-manifest.mjs";

const files = [
  "Sumi-1.2.3-macos-arm64.app.tar.gz",
  "Sumi-1.2.3-macos-arm64.app.tar.gz.sig",
  "Sumi-1.2.3-windows-x64.exe",
  "Sumi-1.2.3-windows-x64.exe.sig",
  "Sumi-1.2.3-linux-x64.AppImage",
  "Sumi-1.2.3-linux-x64.AppImage.sig",
  "Sumi-1.2.3-linux-x64.deb",
  "Sumi-1.2.3-macos-x64.app.tar.gz",
];
const args = {
  version: "1.2.3",
  tag: "v1.2.3",
  repository: "owner/repo",
  files,
  readSignature: (name) => `sig:${name}\n`,
};

test("manifest lists only artifacts that have a signature, with GitHub release URLs", () => {
  const manifest = buildManifest(args);
  assert.deepEqual(Object.keys(manifest.platforms).sort(), [
    "darwin-aarch64",
    "linux-x86_64",
    "windows-x86_64",
  ]);
  assert.equal(manifest.version, "1.2.3");
  assert.equal(
    manifest.platforms["darwin-aarch64"].url,
    "https://github.com/owner/repo/releases/download/v1.2.3/Sumi-1.2.3-macos-arm64.app.tar.gz",
  );
  assert.equal(
    manifest.platforms["linux-x86_64"].signature,
    "sig:Sumi-1.2.3-linux-x64.AppImage.sig",
  );
});

test("manifest refuses to exist without any signed artifact", () => {
  assert.throws(() => buildManifest({ ...args, files: ["Sumi-1.2.3-linux-x64.deb"] }), /No signed/);
});
