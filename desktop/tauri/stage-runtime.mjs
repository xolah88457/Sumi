import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  augmentStandaloneDependencies,
  bundledDependencyPackages,
  bundleWindowsCrt,
  collectShippedLicenses,
  getNativeLibName,
  getPnpmCommand,
  stageBackend,
} from "../lib/runtime.mjs";
import {
  ALLOWED_BUNDLED_MODEL,
  checkNoPrivateFiles,
  isForbiddenName,
  isPathContained,
  readRootVersion,
} from "../lib/common.mjs";

const tauriDir = fileURLToPath(new URL(".", import.meta.url));
const root = resolve(tauriDir, "../..");
const nodeVersion = "v26.13.1";
// From https://nodejs.org/dist/v26.13.1/SHASUMS256.txt (tar.gz on Unix, zip on Windows).
const nodeSha = {
  "darwin-arm64": "aec2514ea1ceb2ba52455e9ec65986f6749a06dd759e5db2a72e6889668c9735",
  "darwin-x64": "82bb96078a24ca50b9c9a38f2379e6be6d87171fcd400fc14c8934b3bce96e2f",
  "linux-x64": "518674de2b621728a5e4486f5fb3b7d2900bb3cc4aa97969edaa463db99f9778",
  "win32-x64": "e2edda75bfb089654705cf65a13b58933bfd5f57148e8ebda916f58a2474f1f7",
};

export function runtimeNodePath(resources, platform = process.platform) {
  return join(resources, "runtime", platform === "win32" ? "node.exe" : "node");
}

export function isolatedRuntimeEnv(profile) {
  return {
    HOME: profile,
    PATH: "/usr/bin:/bin",
    TMPDIR: profile,
    JOURNAL_DATA_DIR: profile,
    SUMI_TEST_MODE: "1",
    ...(process.platform === "win32" && {
      SystemRoot: process.env.SystemRoot,
      PATH: join(process.env.SystemRoot ?? "C:\\Windows", "System32"),
      USERPROFILE: profile,
      APPDATA: profile,
      LOCALAPPDATA: profile,
      TEMP: profile,
      TMP: profile,
    }),
  };
}

function privateName(name) {
  return (
    (name !== ALLOWED_BUNDLED_MODEL && isForbiddenName(name.toLowerCase())) ||
    /\.(?:db|sqlite3?)(?:-shm|-wal|-journal)?$/i.test(name) ||
    /\.(?:key|pem|p12|pfx)$/i.test(name)
  );
}

export function includeServerFile(path) {
  return !privateName(basename(path));
}

function insideRelative(base, path) {
  const rel = relative(base, path);
  return !isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`) ? rel : null;
}

// Next copies pnpm's absolute Windows junction targets verbatim. Remap only its
// virtual-store paths to the matching traced paths, never to installed sources.
export function windowsStandaloneLinkResolver(standalone, root, omit = () => false) {
  const store = join(root, "node_modules/.pnpm");
  const tracedStore = join(standalone, "node_modules/.pnpm");
  return (path, target) => {
    const storeRel = isAbsolute(target) ? insideRelative(store, target) : null;
    return confinedLinkTarget(
      standalone,
      path,
      target,
      omit,
      storeRel ? join(tracedStore, storeRel) : null,
    );
  };
}

function confinedLinkTarget(base, path, target, omit, remapped = null) {
  const candidate = remapped ?? resolve(dirname(path), target);
  const rel = insideRelative(base, candidate);
  const unsafe = () => new Error(`Unsafe runtime symlink: ${path} -> ${target}`);
  if (rel === null || (!remapped && isAbsolute(target))) throw unsafe();
  const parts = rel ? rel.split(sep) : [];
  let current = base;
  for (const [i, part] of parts.entries()) {
    current = join(current, part);
    if (privateName(part) || omit(current)) throw unsafe();
    if (process.platform === "win32") {
      // Do not accept alternate data streams, short names or trailing-dot aliases.
      if (
        !readdirSync(dirname(current)).some((name) => name.toLowerCase() === part.toLowerCase())
      ) {
        throw unsafe();
      }
    }
    // Inspect components without traversing junctions or malformed directory links.
    // A final link is safe to walk separately under the same rules.
    if (i < parts.length - 1 && !lstatSync(current).isDirectory()) throw unsafe();
  }
  return candidate;
}

// Check links before copying or patching the entrypoint. Absolute links into the
// source tree are not portable; relative links must stay in the copied tree.
export function validateResourceTree(
  base,
  { allowLinks = true, omit = () => false, resolveLink } = {},
) {
  if (lstatSync(base).isSymbolicLink()) throw new Error(`Unsafe runtime root: ${base}`);
  const canonicalBase = realpathSync(base);
  const visited = new Set();
  const active = new Set();
  const key = (path) => (process.platform === "win32" ? path.toLowerCase() : path);
  function visit(path) {
    if (omit(path)) return;
    if (!includeServerFile(path)) throw new Error(`Private runtime file: ${path}`);
    const id = key(path);
    if (active.has(id)) throw new Error(`Circular runtime symlink: ${path}`);
    if (visited.has(id)) return;
    const info = lstatSync(path);
    if (info.isFile()) return;
    active.add(id);
    if (info.isSymbolicLink()) {
      const target = readlinkSync(path);
      if (!allowLinks) throw new Error(`Unsafe runtime symlink: ${path} -> ${target}`);
      if (resolveLink) {
        visit(resolveLink(path, target));
      } else {
        const candidate = confinedLinkTarget(canonicalBase, path, target, omit);
        visit(candidate);
        // The Unix copy follows the original link. Reject raw paths whose
        // filesystem resolution differs from the checked lexical traversal.
        if (realpathSync.native(path) !== realpathSync.native(candidate)) {
          throw new Error(`Unsafe runtime symlink: ${path} -> ${target}`);
        }
      }
    } else if (info.isDirectory()) {
      for (const entry of readdirSync(path)) visit(join(path, entry));
    } else {
      throw new Error(`Unsupported runtime file: ${path}`);
    }
    active.delete(id);
    visited.add(id);
  }
  visit(canonicalBase);
}

function validateSources({ standalone, staticDir, publicDir, include, windows = false }) {
  for (const [path, allowLinks] of [
    [standalone, true],
    [staticDir, false],
    [publicDir, false],
  ]) {
    if (!existsSync(path))
      throw new Error(`Missing Next.js build input: ${path}. Run pnpm build first.`);
    if (!isPathContained(root, path)) throw new Error(`Runtime source outside checkout: ${path}`);
    const omit = (candidate) => !include(candidate);
    validateResourceTree(path, {
      allowLinks,
      omit,
      resolveLink:
        allowLinks && windows
          ? windowsStandaloneLinkResolver(realpathSync(path), root, omit)
          : undefined,
    });
  }
  for (const path of [
    "desktop/launch.cjs",
    "desktop/Kami-LICENSE.txt",
    "desktop/THIRD-PARTY-NOTICES.md",
    "LICENSE",
    "models/silero-vad-v6.2-F32.gguf",
    "models/LICENSE.silero_vad",
  ]) {
    const source = join(root, path);
    if (!lstatSync(source).isFile() || !isPathContained(root, source)) {
      throw new Error(`Invalid runtime source: ${source}`);
    }
  }
}

function verifyNativeRuntime(resources, profile, nativeTuple) {
  const web = join(resources, "server/apps/web");
  for (const name of [
    "Node-LICENSE.txt",
    "Trade-Journal-MIT.txt",
    "Kami-MIT.txt",
    "Silero-VAD-MIT.txt",
    "THIRD-PARTY-NOTICES.md",
    ...(process.platform === "win32" ? ["Microsoft-Visual-CPP-Redist-Notice.txt"] : []),
  ]) {
    if (!lstatSync(join(resources, "licenses", name)).isFile())
      throw new Error(`Missing runtime license: ${name}`);
  }
  const probe = `
    import assert from "node:assert/strict";
    import { createRequire } from "node:module";
    import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";
    import { fileURLToPath } from "node:url";
    import { lstatSync, realpathSync } from "node:fs";
    const [expectedVersion, platform, arch, nativeTuple, libName] = process.argv.slice(2);
    const web = import.meta.dirname;
    assert.equal(process.version, expectedVersion);
    assert.equal(process.platform, platform);
    assert.equal(process.arch, arch);
    const req = createRequire(import.meta.url);
    const server = realpathSync(join(web, "../.."));
    function inBundle(path) {
      if (!isAbsolute(path)) return false;
      const rel = relative(server, realpathSync(path));
      return rel && !isAbsolute(rel) && rel !== ".." && !rel.startsWith(".." + sep);
    }
    assert.ok(inBundle(req.resolve("better-sqlite3")));
    const Database = req("better-sqlite3");
    const db = new Database(":memory:");
    assert.equal(db.prepare("SELECT 1 AS ok").get().ok, 1);
    db.close();
    assert.ok(inBundle(fileURLToPath(import.meta.resolve("transcribe-cpp"))));
    const voice = await import("transcribe-cpp");
    const library = realpathSync(voice.libraryPath());
    assert.ok(inBundle(library));
    assert.equal(basename(library), libName);
    assert.equal(basename(dirname(library)), nativeTuple);
    assert.equal(basename(dirname(dirname(library))), "@transcribe-cpp");
    if (platform === "win32" || platform === "linux") {
      const vulkan = platform === "win32" ? "ggml-vulkan.dll" : "libggml-vulkan.so";
      assert.ok(lstatSync(join(dirname(library), vulkan)).isFile());
    }
    for (const name of ["better_sqlite3.node", "koffi.node"]) {
      assert.ok(Object.keys(req.cache).some((path) => basename(path) === name && inBundle(path)),
        "Native addon not loaded from the bundle: " + name);
    }
    const model = await voice.TranscribeModel.load(join(web, "models/silero-vad-v6.2-F32.gguf"));
    const session = model.createVadSession();
    try {
      const result = await session.run(new Float32Array(16000));
      assert.ok(result.probs.length > 0 && result.probs[0] < 0.2, "Expected silence from Silero VAD");
    } finally {
      session.dispose();
      model.dispose();
    }
  `;
  const probePath = join(web, ".sumi-native-probe.mjs");
  writeFileSync(probePath, probe, { flag: "wx" });
  try {
    execFileSync(
      runtimeNodePath(resources),
      [probePath, nodeVersion, process.platform, process.arch, nativeTuple, getNativeLibName()],
      {
        cwd: profile,
        env: isolatedRuntimeEnv(profile),
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 30_000,
      },
    );
  } catch (cause) {
    const details = cause.stderr?.toString().trim() || cause.code || cause.signal || cause.status;
    const target = `${process.platform}-${process.arch}`;
    throw new Error(
      `Staged native runtime failed (Node ${nodeVersion} ${target}): ${details}. Use native dependencies installed for that Node ABI and target.`,
      { cause },
    );
  } finally {
    rmSync(probePath);
  }
}

export async function stageRuntime({ skipWebBuild = false } = {}) {
  const target = `${process.platform}-${process.arch}`;
  if (!Object.hasOwn(nodeSha, target)) {
    throw new Error("Tauri runtime staging requires macOS arm64/x64, Windows x64, or Linux x64.");
  }
  if (process.env.TRANSCRIBE_LIBRARY)
    throw new Error("Unset TRANSCRIBE_LIBRARY to stage the installed native package.");
  const temp = realpathSync(
    process.platform === "darwin"
      ? execFileSync("/usr/bin/getconf", ["DARWIN_USER_TEMP_DIR"], { encoding: "utf8" }).trim()
      : tmpdir(),
  );
  const nextDir = join(root, "apps/web/.next");
  if (
    lstatSync(nextDir, { throwIfNoEntry: false })?.isSymbolicLink() ||
    !isPathContained(root, nextDir)
  ) {
    throw new Error(`Unsafe Next.js output directory: ${nextDir}`);
  }
  for (const file of [".env", ".env.local", ".env.production", ".env.production.local"]) {
    // Next can inline these values. Reused output must come from a clean build too.
    if (lstatSync(join(root, "apps/web", file), { throwIfNoEntry: false })) {
      throw new Error(`Remove apps/web/${file} and use a clean web build before staging.`);
    }
  }
  const profile = mkdtempSync(join(temp, "sumi-tauri-stage-"));
  try {
    if (!skipWebBuild) {
      const { command, args, options } = getPnpmCommand(["build"]);
      execFileSync(command, args, {
        cwd: root,
        env: {
          ...isolatedRuntimeEnv(profile),
          PATH: process.env.PATH,
          LANG: process.env.LANG ?? "en_US.UTF-8",
          NEXT_TELEMETRY_DISABLED: "1",
          ...(process.platform === "win32" && {
            ComSpec: process.env.ComSpec,
            PATHEXT: process.env.PATHEXT,
          }),
        },
        stdio: "inherit",
        ...options,
      });
    }

    const traced = join(nextDir, "standalone");
    const staticDir = join(nextDir, "static");
    const publicDir = join(root, "apps/web/public");
    // These paths are journal/export roots, not dependency data directories.
    const privateRoots = ["data", "outputs", join("apps", "web", "data")];
    const include = (path) => {
      const rel = relative(traced, path).toLowerCase();
      return (
        includeServerFile(path) &&
        !privateRoots.some((dir) => rel === dir || rel.startsWith(dir + sep)) &&
        !rel.startsWith(".runtime-backup")
      );
    };
    const windows = process.platform === "win32";
    validateSources({ standalone: traced, staticDir, publicDir, include, windows });
    const resolveWindowsLink = windows
      ? windowsStandaloneLinkResolver(traced, root, (path) => !include(path))
      : undefined;

    const work = mkdtempSync(join(tauriDir, ".runtime-stage-"));
    const staged = join(work, "staged");
    const ready = windows ? staged : join(work, "ready");
    const backup = join(work, "previous");
    const output = join(tauriDir, "runtime");
    let preserveBackup = false;
    try {
      const cacheDir = join(root, ".desktop-cache");
      mkdirSync(cacheDir, { recursive: true });
      const nativeTuple = await stageBackend({
        root,
        resources: staged,
        cacheDir,
        platform: process.platform,
        normArch: process.arch,
        appVersion: readRootVersion(root),
        runtimeVersion: nodeVersion,
        pinnedNodeSha: nodeSha[target],
        filterServerFile: include,
        resolveWindowsStandaloneLink: resolveWindowsLink,
        validateNativeSource(source) {
          if (
            !isPathContained(join(root, "node_modules"), source) ||
            !isPathContained(root, source)
          ) {
            throw new Error(`Native package outside checkout node_modules: ${source}`);
          }
          validateResourceTree(source);
        },
      });
      if (windows) bundleWindowsCrt(staged, nativeTuple);
      validateResourceTree(staged, { allowLinks: !windows });
      collectShippedLicenses(
        join(staged, "licenses/dependencies"),
        [join(staged, "server")],
        [join(root, "node_modules/.pnpm")],
        bundledDependencyPackages(join(root, "apps/web"), ["tailwindcss", "tw-animate-css"]),
      );
      if (!windows) {
        validateResourceTree(staged);
        // Tauri walks resources without following directory symlinks. Materialize
        // confined pnpm links so package resolution survives that copy.
        cpSync(staged, ready, { recursive: true, dereference: true });
        // Dereferenced packages no longer resolve sibling dependencies in .pnpm.
        augmentStandaloneDependencies(join(ready, "server"));
      }
      validateResourceTree(ready, { allowLinks: false });
      checkNoPrivateFiles(ready);
      verifyNativeRuntime(ready, profile, nativeTuple);

      const hadPrevious = lstatSync(output, { throwIfNoEntry: false }) !== undefined;
      if (hadPrevious) renameSync(output, backup);
      try {
        renameSync(ready, output);
      } catch (error) {
        if (hadPrevious) {
          try {
            renameSync(backup, output);
          } catch {
            preserveBackup = true;
            throw new Error(`Could not restore the previous runtime; it remains at ${backup}`, {
              cause: error,
            });
          }
        }
        throw error;
      }
      console.log(`Staged ${target} Tauri runtime at ${output}`);
      return output;
    } finally {
      if (!preserveBackup) rmSync(work, { recursive: true, force: true });
    }
  } finally {
    rmSync(profile, { recursive: true, force: true });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const args = process.argv.slice(2);
    if (args.length > 1 || (args.length === 1 && args[0] !== "--skip-web-build")) {
      throw new Error("Usage: node desktop/tauri/stage-runtime.mjs [--skip-web-build]");
    }
    await stageRuntime({ skipWebBuild: args.length === 1 });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
