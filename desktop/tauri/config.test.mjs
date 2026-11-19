import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (path) => readFileSync(join(root, path), "utf8");
const pkg = JSON.parse(read("package.json"));
const conf = JSON.parse(read("desktop/tauri/src-tauri/tauri.conf.json"));

test("app identity is Sumi and versions have one source of truth", () => {
  assert.equal(conf.productName, "Sumi");
  assert.equal(conf.mainBinaryName, "sumi");
  assert.equal(conf.identifier, "local.sumi.journal");
  assert.equal(conf.version, pkg.version);
  assert.match(read("desktop/tauri/src-tauri/Cargo.toml"), /^name = "sumi"$/m);
  assert.match(
    read("desktop/tauri/src-tauri/Cargo.toml"),
    new RegExp(`^version = "${pkg.version}"$`, "m"),
  );
  // Sub-packages must not be bumped with the app.
  assert.equal(JSON.parse(read("packages/core/package.json")).version, "0.1.0");
  assert.equal(JSON.parse(read("apps/web/package.json")).version, "0.1.0");
});

test("root scripts expose the Tauri shell only and no Electron dependency remains", () => {
  const scripts = pkg.scripts;
  assert.equal(scripts["tauri:build"], "node desktop/tauri/run.mjs build");
  assert.equal(scripts["desktop:build"], "pnpm tauri:build");
  assert.equal(scripts["desktop:open"], "pnpm tauri:open");
  assert.equal(scripts["desktop:check"], "pnpm tauri:check");
  assert.equal(scripts["desktop:package"], undefined);
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  for (const name of Object.keys(deps)) assert.doesNotMatch(name, /electron|sparkle/i);
  assert.ok(deps["@tauri-apps/cli"]);
  assert.equal(existsSync(join(root, "desktop/main.cjs")), false);
});

test("release workflow is tag-driven, never auto-releases, and drafts", () => {
  const workflow = read(".github/workflows/release.yml");
  assert.match(workflow, /tags:\s*\n\s*- "v\*"/);
  assert.doesNotMatch(workflow, /branches:/);
  assert.match(workflow, /--draft/);
  assert.equal(existsSync(join(root, ".github/workflows/electron-release.yml")), false);
  const ci = read(".github/workflows/tauri-ci.yml");
  assert.match(ci, /branches: \[electron\]/);
  assert.doesNotMatch(ci, /tauri-platform-verification/);
});

test("THIRD-PARTY-NOTICES.md retains the notices for what the app still ships", () => {
  const notices = read("desktop/THIRD-PARTY-NOTICES.md");
  for (const [pattern, label] of [
    [/Tauri/, "Tauri"],
    [/LuxAlgo Trade Journal/, "Trade Journal"],
    [/Kami/, "Kami"],
    [/Node\.js/, "Node.js"],
    [/transcribe\.cpp/, "transcribe.cpp"],
    [/Silero VAD/, "Silero VAD"],
  ]) {
    assert.match(notices, pattern, `${label} notice missing`);
  }
});
