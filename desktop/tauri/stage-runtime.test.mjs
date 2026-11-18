import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { copyStandaloneForWindows } from "../build.mjs";
import {
  includeServerFile,
  isolatedRuntimeEnv,
  runtimeNodePath,
  validateResourceTree,
  windowsStandaloneLinkResolver,
} from "./stage-runtime.mjs";

const tauriDir = fileURLToPath(new URL(".", import.meta.url));

function fixture(t) {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), "sumi-tauri-stage-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const tree = join(dir, "tree");
  mkdirSync(tree);
  return { dir, tree };
}

test("standalone copying excludes databases, environment files, secrets, and other model weights", (t) => {
  const { tree } = fixture(t);
  for (const name of [
    ".env",
    ".env.production.local",
    "journal.db-wal",
    "journal.sqlite3-shm",
    ".secret",
    "signing.key",
    "asr.gguf",
    "ASR.GGUF",
  ]) {
    assert.equal(includeServerFile(join(tree, name)), false, name);
  }
  for (const name of ["data", "server.js", "silero-vad-v6.2-F32.gguf"]) {
    assert.equal(includeServerFile(join(tree, name)), true, name);
  }
  writeFileSync(join(tree, ".secret"), "dummy, not a real secret");
  assert.doesNotThrow(() =>
    validateResourceTree(tree, { omit: (path) => !includeServerFile(path) }),
  );
  assert.throws(() => validateResourceTree(tree), /Private runtime file/);
});

test("only portable, confined pnpm links pass source validation", (t) => {
  const { dir, tree } = fixture(t);
  const packageDir = join(tree, "package");
  mkdirSync(packageDir);
  writeFileSync(join(packageDir, "manifest.json"), "{}");
  const link = join(tree, "link");
  symlinkSync("package", link, "dir");
  assert.doesNotThrow(() => validateResourceTree(tree));
  assert.throws(() => validateResourceTree(tree, { allowLinks: false }), /Unsafe runtime symlink/);

  rmSync(link);
  symlinkSync(packageDir, link, "dir");
  assert.throws(() => validateResourceTree(tree), /Unsafe runtime symlink/);

  rmSync(link);
  writeFileSync(join(dir, "outside.json"), "{}");
  symlinkSync("../outside.json", link);
  assert.throws(() => validateResourceTree(tree), /Unsafe runtime symlink/);

  rmSync(link);
  symlinkSync("missing.json", link);
  assert.throws(
    () => validateResourceTree(tree),
    (error) => error.code === "ENOENT" || /Unsafe runtime symlink/.test(error.message),
  );
});

test("links cannot restore excluded files or loop back to an ancestor", (t) => {
  const { tree } = fixture(t);
  writeFileSync(join(tree, ".env.production"), "DUMMY=1");
  const link = join(tree, "alias");
  symlinkSync(".env.production", link);
  assert.throws(
    () => validateResourceTree(tree, { omit: (path) => !includeServerFile(path) }),
    /Unsafe runtime symlink/,
  );

  rmSync(link);
  symlinkSync(".", link, "dir");
  assert.throws(
    () => validateResourceTree(tree, { omit: (path) => !includeServerFile(path) }),
    /Circular runtime symlink/,
  );
});

test("Windows copy remaps a pnpm junction to the filtered trace, not the checkout", (t) => {
  const { dir: checkout, tree: traced } = fixture(t);
  const pkgPath = join("node_modules", ".pnpm", "test@1", "node_modules", "test");
  const installed = join(checkout, pkgPath);
  const tracedPkg = join(traced, pkgPath);
  for (const path of [installed, tracedPkg]) mkdirSync(path, { recursive: true });
  writeFileSync(join(installed, "index.js"), "not the traced file");
  writeFileSync(join(tracedPkg, "index.js"), "traced");
  writeFileSync(join(tracedPkg, "local.key"), "dummy private key");
  const link = join(traced, "test");
  const junction = process.platform === "win32" ? "junction" : "dir";
  symlinkSync(installed, link, junction);
  const omit = (path) => !includeServerFile(path);
  const resolveLink = windowsStandaloneLinkResolver(traced, checkout, omit);
  const ready = join(checkout, "ready");
  assert.throws(() => validateResourceTree(traced, { omit }), /Unsafe runtime symlink/);
  validateResourceTree(traced, { omit, resolveLink });
  copyStandaloneForWindows(traced, ready, checkout, { filter: includeServerFile, resolveLink });
  validateResourceTree(ready, { allowLinks: false });
  assert.equal(readFileSync(join(ready, "test", "index.js"), "utf8"), "traced");
  assert.equal(existsSync(join(ready, "test", "local.key")), false);

  // A valid installed target must not become a fallback for stale trace output.
  rmSync(tracedPkg, { recursive: true });
  assert.throws(() => validateResourceTree(traced, { omit, resolveLink }));
  rmSync(link);
  symlinkSync(checkout, link, junction);
  assert.throws(
    () => validateResourceTree(traced, { omit, resolveLink }),
    /Unsafe runtime symlink/,
  );
});

test("Windows junction remapping cannot traverse an excluded ancestor or an intermediate junction", (t) => {
  const { dir: checkout, tree: traced } = fixture(t);
  const store = join(checkout, "node_modules", ".pnpm");
  const tracedStore = join(traced, "node_modules", ".pnpm");
  mkdirSync(join(tracedStore, "excluded"), { recursive: true });
  writeFileSync(join(tracedStore, "excluded", "index.js"), "dummy");
  const alias = join(traced, "alias");
  const omit = (path) => path === join(tracedStore, "excluded");
  const resolveLink = windowsStandaloneLinkResolver(traced, checkout, omit);
  assert.throws(
    () => resolveLink(alias, join(store, "excluded", "index.js")),
    /Unsafe runtime symlink/,
  );
  symlinkSync(
    checkout,
    join(tracedStore, "directory"),
    process.platform === "win32" ? "junction" : "dir",
  );
  assert.throws(
    () => resolveLink(alias, join(store, "directory", "index.js")),
    /Unsafe runtime symlink/,
  );
});

test("staged Node executable uses the native runtime name", () => {
  for (const platform of ["darwin", "linux", "win32"]) {
    assert.equal(
      runtimeNodePath("bundle", platform),
      join("bundle", "runtime", platform === "win32" ? "node.exe" : "node"),
    );
  }
});

test("stager CLI rejects unknown arguments before building", () => {
  assert.throws(
    () =>
      execFileSync(process.execPath, ["stage-runtime.mjs", "--help"], {
        cwd: tauriDir,
        stdio: "pipe",
      }),
    /Usage: node desktop\/tauri\/stage-runtime.mjs \[--skip-web-build\]/,
  );
});

// Opt in after running the stager. Exercise the real standalone resources as
// packaged, without rebuilding or opening the user's journal.
test(
  "staged runtime serves Next on an ephemeral loopback port",
  {
    skip: process.env.SUMI_CHECK_STAGED_RUNTIME !== "1",
  },
  async (t) => {
    const { tree: profile } = fixture(t);
    const runtime = join(tauriDir, "runtime");
    validateResourceTree(runtime, { allowLinks: false });
    const child = spawn(runtimeNodePath(runtime), [join(runtime, "launch.cjs")], {
      cwd: profile,
      env: isolatedRuntimeEnv(profile),
      stdio: ["ignore", "pipe", "pipe"],
    });
    const closed = once(child, "close");
    let stderr = "";
    child.stderr.setEncoding("utf8").on("data", (chunk) => {
      stderr += chunk;
    });
    try {
      let stdout = "";
      const origin = await new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`No SUMI_READY within 30 seconds: ${stderr}`)),
          30_000,
        );
        const fail = (error) => {
          clearTimeout(timer);
          reject(error);
        };
        closed.then(
          ([code, signal]) => fail(new Error(`Backend exited (${code ?? signal}): ${stderr}`)),
          fail,
        );
        child.stdout.setEncoding("utf8").on("data", (chunk) => {
          stdout += chunk;
          const ready = stdout.match(/^SUMI_READY (http:\/\/127\.0\.0\.1:\d+)\r?\n/m);
          if (ready) {
            clearTimeout(timer);
            resolve(ready[1]);
          }
        });
      });
      assert.notEqual(new URL(origin).port, "3000");
      const get = (path) => fetch(new URL(path, origin), { signal: AbortSignal.timeout(10_000) });
      const dashboard = await get("/");
      assert.equal(dashboard.status, 200);
      const html = await dashboard.text();
      const chunk = html.match(/src="(\/_next\/static\/[^" ]+\.js)"/)?.[1];
      assert.ok(chunk);
      const asset = await get(chunk);
      assert.equal(asset.status, 200);
      await asset.body.cancel();
      const voice = await get("/dictation-worklet.js");
      assert.equal(voice.status, 200);
      await voice.body.cancel();
      assert.ok(existsSync(join(profile, "journal.db")));
    } finally {
      child.kill("SIGTERM");
      const forceStop = setTimeout(() => child.kill("SIGKILL"), 5000);
      try {
        await closed;
      } finally {
        clearTimeout(forceStop);
      }
    }
  },
);
