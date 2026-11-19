import assert from "node:assert/strict";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { checkNoPrivateFiles, checkSelfContainedSymlinks } from "./common.mjs";

import {
  MIN_WIN32_CRT_FILEVERSION,
  REQUIRED_WIN32_CRT_DLLS,
  SILERO_EXPECTED_SHA256,
  assertKoffiPayload,
  augmentStandaloneDependencies,
  bundlePackageWithRuntimeDeps,
  bundleWindowsCrt,
  bundledDependencyPackages,
  collectShippedLicenses,
  compareFileVersions,
  copyStandaloneForWindows,
  formatFileVersion,
  getKoffiPackageName,
  getNativeLibName,
  getNativeTuple,
  getNodeArchiveName,
  getNodeBinaryRelativePath,
  getPnpmCommand,
  getTarCommand,
  isPathContained,
  pruneKoffiPayloads,
  parseFileVersionString,
  readDllFileVersion,
  resolveKoffiNativeDir,
  resolveKoffiPackageDir,
  resolveWindowsCrtDlls,
  selectWindowsCrtDlls,
} from "./runtime.mjs";
import {
  assertSymlinksConfined,
  ensureVerifiedArchive,
  forbiddenNameKind,
  normalizeArch,
  probeDllFileVersion,
  readRootVersion,
  sha256Hex,
} from "./common.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

test("Node archive download naming and binary layout across platforms", () => {
  const version = "v26.13.0";
  assert.equal(getNodeArchiveName(version, "darwin", "arm64"), "node-v26.13.0-darwin-arm64.tar.gz");
  assert.equal(getNodeArchiveName(version, "darwin", "x64"), "node-v26.13.0-darwin-x64.tar.gz");
  assert.equal(getNodeArchiveName(version, "linux", "x64"), "node-v26.13.0-linux-x64.tar.gz");
  assert.equal(getNodeArchiveName(version, "win32", "x64"), "node-v26.13.0-win-x64.zip");

  assert.equal(getNodeBinaryRelativePath("darwin"), "bin/node");
  assert.equal(getNodeBinaryRelativePath("linux"), "bin/node");
  assert.equal(getNodeBinaryRelativePath("win32"), "node.exe");
});

test("native tuple, library name, and Koffi package mapping across supported host OS", () => {
  // Transcribe tuples
  assert.equal(getNativeTuple("darwin", "arm64"), "darwin-arm64-metal");
  assert.equal(getNativeTuple("darwin", "x64"), "darwin-x64-cpu");
  assert.equal(getNativeTuple("linux", "x64"), "linux-x64-cpu-vulkan");
  assert.equal(getNativeTuple("linux", "arm64"), "linux-arm64-cpu-vulkan");
  assert.equal(getNativeTuple("win32", "x64"), "win32-x64-cpu-vulkan");
  assert.equal(getNativeTuple("win32", "arm64"), null);

  // Library filenames
  assert.equal(getNativeLibName("darwin"), "libtranscribe.dylib");
  assert.equal(getNativeLibName("win32"), "transcribe.dll");
  assert.equal(getNativeLibName("linux"), "libtranscribe.so");

  // Koffi platform packages
  assert.equal(getKoffiPackageName("darwin", "arm64"), "@koromix/koffi-darwin-arm64");
  assert.equal(getKoffiPackageName("darwin", "x64"), "@koromix/koffi-darwin-x64");
  assert.equal(getKoffiPackageName("linux", "x64"), "@koromix/koffi-linux-x64");
  assert.equal(getKoffiPackageName("linux", "arm64"), "@koromix/koffi-linux-arm64");
  assert.equal(getKoffiPackageName("win32", "x64"), "@koromix/koffi-win32-x64");

  // Koffi native directory resolution finds installed package on host
  const koffiDir = resolveKoffiNativeDir(root, process.platform, process.arch);
  assert.ok(koffiDir, "Koffi native directory must resolve on host");
  assert.ok(existsSync(koffiDir), `Resolved Koffi dir must exist at ${koffiDir}`);
});

test("apps/web/next.config.ts externalizes all 5 verified transcribe-cpp tuples", () => {
  const nextConfigPath = join(root, "apps/web/next.config.ts");
  const content = readFileSync(nextConfigPath, "utf8");

  const requiredTuples = [
    "@transcribe-cpp/darwin-arm64-metal",
    "@transcribe-cpp/darwin-x64-cpu",
    "@transcribe-cpp/linux-x64-cpu-vulkan",
    "@transcribe-cpp/linux-arm64-cpu-vulkan",
    "@transcribe-cpp/win32-x64-cpu-vulkan",
  ];

  for (const tuple of requiredTuples) {
    assert.ok(
      content.includes(`"${tuple}"`) || content.includes(`'${tuple}'`),
      `next.config.ts serverExternalPackages must include ${tuple}`,
    );
  }
  assert.ok(content.includes('"better-sqlite3"'), "better-sqlite3 must be externalized");
  assert.ok(content.includes('"transcribe-cpp"'), "transcribe-cpp must be externalized");
  assert.ok(content.includes('"koffi"'), "koffi must be externalized");
});

test("distribution security checks enforce model, private file, and symlink boundaries", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "sumi-dist-sec-"));

  try {
    writeFileSync(join(tempDir, "silero-vad-v6.2-F32.gguf"), "dummy vad");
    writeFileSync(join(tempDir, "server.js"), "console.log()");
    assert.doesNotThrow(() => checkNoPrivateFiles(tempDir));

    const envFile = join(tempDir, ".env.production");
    writeFileSync(envFile, "SECRET=1");
    assert.throws(() => checkNoPrivateFiles(tempDir), /Environment file bundled in distribution/);
    rmSync(envFile);

    const dbFile = join(tempDir, "journal.sqlite");
    writeFileSync(dbFile, "sqlite format");
    assert.throws(() => checkNoPrivateFiles(tempDir), /Database bundled in distribution/);
    rmSync(dbFile);

    const heavyModel = join(tempDir, "parakeet-unified-en-0.6b-Q8_0.gguf");
    writeFileSync(heavyModel, "heavy weights");
    assert.throws(() => checkNoPrivateFiles(tempDir), /Forbidden model weights bundled/);
    rmSync(heavyModel);

    const outside = mkdtempSync(join(tmpdir(), "sumi-outside-"));
    const escapeLink = join(tempDir, "escape-link");
    symlinkSync(outside, escapeLink);
    assert.throws(
      () => checkSelfContainedSymlinks(tempDir, tempDir + "/"),
      /Symlink escapes application bundle/,
    );
    rmSync(escapeLink);
    rmSync(outside, { recursive: true, force: true });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("Silero VAD 1.2 MB verified hash is present and matches constant", () => {
  assert.equal(
    SILERO_EXPECTED_SHA256,
    "0d871a800c420fdd5d1b17a3aea4296d1c39608f0ff4a9295eb76457eb1c88e6",
  );
  const sileroPath = join(root, "models/silero-vad-v6.2-F32.gguf");
  assert.ok(existsSync(sileroPath), `Silero VAD model missing at ${sileroPath}`);
  const bytes = readFileSync(sileroPath);
  const hash = createHash("sha256").update(bytes).digest("hex");
  assert.equal(
    hash,
    SILERO_EXPECTED_SHA256,
    "Silero VAD SHA-256 hash must match official constant",
  );
});

/**
 * Creates an isolated Windows environment for CRT candidate discovery tests,
 * preventing host Visual Studio (vswhere, Redist) and System32 paths from leaking
 * into test fixtures on Windows build runners.
 */
function makeIsolatedCrtEnv(emptyDir, overrides = {}) {
  return {
    ProgramFiles: emptyDir,
    "ProgramFiles(x86)": emptyDir,
    SystemRoot: emptyDir,
    WINDIR: emptyDir,
    VCToolsRedistDir: "",
    ...overrides,
  };
}

test("REQUIRED_WIN32_CRT_DLLS defines required app-local runtime libraries and resolveWindowsCrtDlls resolves them", () => {
  assert.deepEqual(REQUIRED_WIN32_CRT_DLLS, [
    "msvcp140.dll",
    "vcruntime140.dll",
    "vcruntime140_1.dll",
  ]);
  assert.deepEqual(MIN_WIN32_CRT_FILEVERSION, [14, 40, 0, 0]);

  const mockRedist = mkdtempSync(join(tmpdir(), "vc-redist-mock-"));
  const emptyDir = mkdtempSync(join(tmpdir(), "crt-empty-"));
  try {
    writeFileSync(join(mockRedist, "msvcp140.dll"), "msvcp");
    writeFileSync(join(mockRedist, "vcruntime140.dll"), "vcruntime");
    writeFileSync(join(mockRedist, "vcruntime140_1.dll"), "vcruntime1");

    const resolved = resolveWindowsCrtDlls({
      env: makeIsolatedCrtEnv(emptyDir, { VC_REDIST_X64_DIR: mockRedist }),
      readFileVersion: () => [14, 44, 35111, 0],
    });
    assert.equal(resolved["msvcp140.dll"], join(mockRedist, "msvcp140.dll"));
    assert.equal(resolved["vcruntime140.dll"], join(mockRedist, "vcruntime140.dll"));
    assert.equal(resolved["vcruntime140_1.dll"], join(mockRedist, "vcruntime140_1.dll"));
  } finally {
    rmSync(mockRedist, { recursive: true, force: true });
    rmSync(emptyDir, { recursive: true, force: true });
  }
});

test("compareFileVersions and parseFileVersionString order 4-part versions numerically", () => {
  assert.ok(compareFileVersions([14, 44, 0, 0], [14, 40, 33810, 0]) > 0);
  assert.ok(compareFileVersions([14, 40, 0, 0], [14, 39, 99999, 9]) > 0);
  assert.ok(compareFileVersions([14, 40, 0, 1], [14, 40, 0, 0]) > 0);
  assert.ok(compareFileVersions([14, 40], [14, 40, 0, 0]) === 0);
  assert.equal(compareFileVersions([14, 40, 0, 0], [14, 40, 0, 0]), 0);
  assert.deepEqual(parseFileVersionString("14.44.35111.0\r\n"), [14, 44, 35111, 0]);
  assert.deepEqual(parseFileVersionString("14.40.33810"), [14, 40, 33810, 0]);
  assert.equal(parseFileVersionString("not-a-version"), null);
  assert.equal(parseFileVersionString(undefined), null);
  assert.equal(formatFileVersion([14, 40, 0, 0]), "14.40.0.0");
});

test("readDllFileVersion parses PowerShell FileVersionInfo output via injectable runTool", () => {
  const mockTool = (cmd, args) => {
    assert.equal(cmd, "powershell");
    assert.ok(args.join(" ").includes("FileVersionInfo"));
    return "14.44.35111.0\r\n";
  };
  assert.deepEqual(readDllFileVersion("C:\\x\\msvcp140.dll", mockTool), [14, 44, 35111, 0]);
  assert.throws(
    () => readDllFileVersion("C:\\x\\msvcp140.dll", () => "garbage"),
    /Could not read FILEVERSION/,
  );
});

test("resolveWindowsCrtDlls picks the NEWEST FILEVERSION across candidate dirs, not discovery order", () => {
  const oldDir = mkdtempSync(join(tmpdir(), "crt-old-"));
  const sysRoot = mkdtempSync(join(tmpdir(), "crt-sysroot-"));
  const emptyDir = mkdtempSync(join(tmpdir(), "crt-empty-"));
  const sys32 = join(sysRoot, "System32");
  try {
    mkdirSync(sys32, { recursive: true });
    const versions = new Map();
    for (const dll of REQUIRED_WIN32_CRT_DLLS) {
      writeFileSync(join(oldDir, dll), "old");
      // Deliberately uppercase in System32 to also exercise case-insensitive matching
      writeFileSync(join(sys32, dll.toUpperCase()), "new");
      versions.set(join(oldDir, dll).toLowerCase(), [14, 29, 27139, 5]); // below floor, listed FIRST
      versions.set(join(sys32, dll.toUpperCase()).toLowerCase(), [14, 44, 35111, 0]); // newest
    }
    const readFileVersion = (p) => {
      const v = versions.get(p.toLowerCase());
      if (!v) throw new Error("no version for " + p);
      return v;
    };
    const env = makeIsolatedCrtEnv(emptyDir, { VC_REDIST_X64_DIR: oldDir, SystemRoot: sysRoot });
    const resolved = resolveWindowsCrtDlls({ env, readFileVersion });
    for (const dll of REQUIRED_WIN32_CRT_DLLS) {
      // Newest (System32) wins even though the older VC_REDIST_X64_DIR is listed first
      assert.equal(resolved[dll]?.toLowerCase(), join(sys32, dll).toLowerCase());
      assert.notEqual(resolved[dll]?.toLowerCase(), join(oldDir, dll).toLowerCase());
    }

    // Numeric descending within a single VCToolsRedistDir tree: 14.43 beats 14.40
    const vcTools = mkdtempSync(join(tmpdir(), "crt-vctools-"));
    const x64 = join(vcTools, "x64");
    mkdirSync(join(x64, "Microsoft.VC143.CRT"), { recursive: true });
    mkdirSync(join(x64, "Microsoft.VC142.CRT"), { recursive: true });
    const v143 = join(x64, "Microsoft.VC143.CRT");
    const v142 = join(x64, "Microsoft.VC142.CRT");
    const versions2 = new Map();
    for (const dll of REQUIRED_WIN32_CRT_DLLS) {
      writeFileSync(join(v142, dll), "140");
      writeFileSync(join(v143, dll), "143");
      versions2.set(join(v142, dll), [14, 40, 33810, 0]);
      versions2.set(join(v143, dll), [14, 43, 32605, 0]);
    }
    const resolved2 = resolveWindowsCrtDlls({
      env: makeIsolatedCrtEnv(emptyDir, { VCToolsRedistDir: vcTools }),
      readFileVersion: (p) => versions2.get(p),
    });
    for (const dll of REQUIRED_WIN32_CRT_DLLS) {
      assert.equal(resolved2[dll], join(v143, dll));
    }
    rmSync(vcTools, { recursive: true, force: true });
  } finally {
    rmSync(oldDir, { recursive: true, force: true });
    rmSync(sysRoot, { recursive: true, force: true });
    rmSync(emptyDir, { recursive: true, force: true });
  }
});

test("resolveWindowsCrtDlls fails closed when only below-floor CRT candidates exist (never bundles old)", () => {
  const dir = mkdtempSync(join(tmpdir(), "crt-oldonly-"));
  const emptyDir = mkdtempSync(join(tmpdir(), "crt-empty-"));
  try {
    for (const dll of REQUIRED_WIN32_CRT_DLLS) {
      writeFileSync(join(dir, dll), "old");
    }
    const env = makeIsolatedCrtEnv(emptyDir, { VC_REDIST_X64_DIR: dir });
    const readFileVersion = () => [14, 29, 27139, 5]; // msvcp140 < 14.40: std::mutex ABI crash risk
    const sel = selectWindowsCrtDlls({ env, readFileVersion });
    assert.deepEqual(sel.resolved, {});
    assert.deepEqual([...sel.missing].sort(), [...REQUIRED_WIN32_CRT_DLLS].sort());
    assert.equal(sel.rejected.length, REQUIRED_WIN32_CRT_DLLS.length);
    assert.ok(sel.rejected.every((r) => r.reason === "below-floor"));
    assert.ok(sel.rejected.every((r) => r.version === "14.29.27139.5"));
    assert.deepEqual(resolveWindowsCrtDlls({ env, readFileVersion }), {});
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(emptyDir, { recursive: true, force: true });
  }
});

test("resolveWindowsCrtDlls fails closed on a partial set (one DLL only available below floor)", () => {
  const dir = mkdtempSync(join(tmpdir(), "crt-partial-"));
  const emptyDir = mkdtempSync(join(tmpdir(), "crt-empty-"));
  try {
    for (const dll of REQUIRED_WIN32_CRT_DLLS) {
      writeFileSync(join(dir, dll), "x");
    }
    const env = makeIsolatedCrtEnv(emptyDir, { VC_REDIST_X64_DIR: dir });
    const readFileVersion = (p) =>
      p.toLowerCase().includes("msvcp140") ? [14, 44, 0, 0] : [14, 38, 0, 0];
    const sel = selectWindowsCrtDlls({ env, readFileVersion });
    assert.deepEqual(sel.resolved, {}); // no partial bundle
    assert.deepEqual([...sel.missing].sort(), ["vcruntime140.dll", "vcruntime140_1.dll"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(emptyDir, { recursive: true, force: true });
  }
});

test("CRT floor boundary: exactly 14.40.0.0 accepted, 14.39.x rejected", () => {
  const dir = mkdtempSync(join(tmpdir(), "crt-floor-"));
  const emptyDir = mkdtempSync(join(tmpdir(), "crt-empty-"));
  try {
    for (const dll of REQUIRED_WIN32_CRT_DLLS) {
      writeFileSync(join(dir, dll), "x");
    }
    const env = makeIsolatedCrtEnv(emptyDir, { VC_REDIST_X64_DIR: dir });
    const at = resolveWindowsCrtDlls({ env, readFileVersion: () => [14, 40, 0, 0] });
    assert.equal(at["msvcp140.dll"], join(dir, "msvcp140.dll"));
    assert.deepEqual(resolveWindowsCrtDlls({ env, readFileVersion: () => [14, 39, 99999, 0] }), {});
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(emptyDir, { recursive: true, force: true });
  }
});

test("bundleWindowsCrt fails closed with throw before copy/swap when required DLLs missing or below floor", () => {
  const tmp = mkdtempSync(join(tmpdir(), "crt-bundle-fail-"));
  const oldDir = mkdtempSync(join(tmpdir(), "crt-bundle-old-"));
  const emptyDir = mkdtempSync(join(tmpdir(), "crt-empty-"));
  try {
    const resources = join(tmp, "resources");
    mkdirSync(resources, { recursive: true });

    // Candidate directory contains DLLs below the 14.40 floor
    for (const dll of REQUIRED_WIN32_CRT_DLLS) {
      writeFileSync(join(oldDir, dll), "old-dll-bytes");
    }

    const env = makeIsolatedCrtEnv(emptyDir, { VC_REDIST_X64_DIR: oldDir });
    const readFileVersion = () => [14, 29, 27139, 5]; // msvcp140 < 14.40: std::mutex ABI crash risk

    // Must throw fail-closed BEFORE any copy or staging occurs
    assert.throws(
      () => bundleWindowsCrt(resources, "win32-x64-msvc", { env, readFileVersion }),
      /Cannot build Windows distribution: missing app-local VC\+\+ CRT DLLs with FILEVERSION >= 14\.40\.0\.0/,
    );

    // Verify nothing was copied to resources/runtime or resources/licenses
    assert.equal(existsSync(join(resources, "runtime")), false);
    assert.equal(existsSync(join(resources, "licenses")), false);
    assert.equal(existsSync(join(resources, "server")), false);

    // With qualifying DLLs (>= 14.40.0.0), bundling succeeds and copies all artifacts
    const validDir = mkdtempSync(join(tmpdir(), "crt-bundle-valid-"));
    try {
      for (const dll of REQUIRED_WIN32_CRT_DLLS) {
        writeFileSync(join(validDir, dll), `valid-${dll}`);
      }
      const validEnv = makeIsolatedCrtEnv(emptyDir, { VC_REDIST_X64_DIR: validDir });
      const validReadFileVersion = () => [14, 44, 35111, 0];

      const bundled = bundleWindowsCrt(resources, "win32-x64-msvc", {
        env: validEnv,
        readFileVersion: validReadFileVersion,
      });

      assert.deepEqual(Object.keys(bundled).sort(), [...REQUIRED_WIN32_CRT_DLLS].sort());
      for (const dll of REQUIRED_WIN32_CRT_DLLS) {
        assert.ok(existsSync(join(resources, "runtime", dll)));
        assert.ok(
          existsSync(join(resources, "server/node_modules/@transcribe-cpp/win32-x64-msvc", dll)),
        );
        assert.ok(
          existsSync(
            join(resources, "server/apps/web/node_modules/@transcribe-cpp/win32-x64-msvc", dll),
          ),
        );
      }
      assert.ok(existsSync(join(resources, "licenses", "Microsoft-Visual-CPP-Redist-Notice.txt")));
    } finally {
      rmSync(validDir, { recursive: true, force: true });
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
    rmSync(oldDir, { recursive: true, force: true });
    rmSync(emptyDir, { recursive: true, force: true });
  }
});

test("bundlePackageWithRuntimeDeps resolves packages with hidden package.json exports", async () => {
  const fixtureDir = mkdtempSync(join(tmpdir(), "hidden-pkg-fixture-"));
  const fixtureModules = join(fixtureDir, "node_modules");

  try {
    // Package whose exports map hides ./package.json (like koffi/fs-extra variants)
    const hiddenPkgDir = join(fixtureModules, "hidden-lib");
    mkdirSync(join(hiddenPkgDir, "dist"), { recursive: true });
    writeFileSync(
      join(hiddenPkgDir, "package.json"),
      JSON.stringify({
        name: "hidden-lib",
        version: "1.2.3",
        main: "./dist/index.js",
        exports: {
          ".": "./dist/index.js",
        },
      }),
      "utf8",
    );
    writeFileSync(
      join(hiddenPkgDir, "dist", "index.js"),
      "module.exports = { status: 'hidden-pkg-works' };",
      "utf8",
    );

    writeFileSync(
      join(fixtureDir, "package.json"),
      JSON.stringify({
        name: "consumer",
        version: "1.0.0",
        dependencies: { "hidden-lib": "1.2.3" },
      }),
      "utf8",
    );

    // Bundle into isolated target directory
    const isolatedDir = mkdtempSync(join(tmpdir(), "isolated-hidden-"));
    const isolatedModules = join(isolatedDir, "node_modules");
    try {
      bundlePackageWithRuntimeDeps("hidden-lib", fixtureDir, isolatedModules);

      // Verify that require from copied isolated tree succeeds
      const { createRequire } = await import("node:module");
      const isolatedReq = createRequire(join(isolatedDir, "test.js"));
      const loaded = isolatedReq("hidden-lib");
      assert.equal(loaded.status, "hidden-pkg-works");
    } finally {
      rmSync(isolatedDir, { recursive: true, force: true });
    }
  } finally {
    rmSync(fixtureDir, { recursive: true, force: true });
  }
});

test("bundlePackageWithRuntimeDeps handles two conflicting transitive versions with version-aware nesting", async () => {
  const fixtureDir = mkdtempSync(join(tmpdir(), "conflict-fixture-"));
  const fixtureModules = join(fixtureDir, "node_modules");

  try {
    // pkg-a depends on shared@1.0.0
    mkdirSync(join(fixtureModules, "pkg-a", "node_modules", "shared"), { recursive: true });
    writeFileSync(
      join(fixtureModules, "pkg-a", "package.json"),
      JSON.stringify({
        name: "pkg-a",
        version: "1.0.0",
        main: "index.js",
        dependencies: { shared: "1.0.0" },
      }),
      "utf8",
    );
    writeFileSync(
      join(fixtureModules, "pkg-a", "index.js"),
      "module.exports = { name: 'pkg-a', sharedVersion: require('shared').version };",
      "utf8",
    );
    writeFileSync(
      join(fixtureModules, "pkg-a", "node_modules", "shared", "package.json"),
      JSON.stringify({ name: "shared", version: "1.0.0", main: "index.js" }),
      "utf8",
    );
    writeFileSync(
      join(fixtureModules, "pkg-a", "node_modules", "shared", "index.js"),
      "module.exports = { version: '1.0.0' };",
      "utf8",
    );

    // pkg-b depends on shared@2.0.0
    mkdirSync(join(fixtureModules, "pkg-b", "node_modules", "shared"), { recursive: true });
    writeFileSync(
      join(fixtureModules, "pkg-b", "package.json"),
      JSON.stringify({
        name: "pkg-b",
        version: "1.0.0",
        main: "index.js",
        dependencies: { shared: "2.0.0" },
      }),
      "utf8",
    );
    writeFileSync(
      join(fixtureModules, "pkg-b", "index.js"),
      "module.exports = { name: 'pkg-b', sharedVersion: require('shared').version };",
      "utf8",
    );
    writeFileSync(
      join(fixtureModules, "pkg-b", "node_modules", "shared", "package.json"),
      JSON.stringify({ name: "shared", version: "2.0.0", main: "index.js" }),
      "utf8",
    );
    writeFileSync(
      join(fixtureModules, "pkg-b", "node_modules", "shared", "index.js"),
      "module.exports = { version: '2.0.0' };",
      "utf8",
    );

    writeFileSync(
      join(fixtureDir, "package.json"),
      JSON.stringify({
        name: "root-app",
        version: "1.0.0",
        dependencies: { "pkg-a": "1.0.0", "pkg-b": "1.0.0" },
      }),
      "utf8",
    );

    // Bundle both into isolated directory
    const isolatedDir = mkdtempSync(join(tmpdir(), "isolated-conflict-"));
    const isolatedModules = join(isolatedDir, "node_modules");
    try {
      bundlePackageWithRuntimeDeps("pkg-a", fixtureDir, isolatedModules);
      bundlePackageWithRuntimeDeps("pkg-b", fixtureDir, isolatedModules);

      // Require both from copied isolated tree
      const { createRequire } = await import("node:module");
      const isolatedReq = createRequire(join(isolatedDir, "index.js"));
      const modA = isolatedReq("pkg-a");
      const modB = isolatedReq("pkg-b");

      assert.equal(modA.sharedVersion, "1.0.0", "pkg-a must resolve shared@1.0.0");
      assert.equal(modB.sharedVersion, "2.0.0", "pkg-b must resolve shared@2.0.0");
    } finally {
      rmSync(isolatedDir, { recursive: true, force: true });
    }
  } finally {
    rmSync(fixtureDir, { recursive: true, force: true });
  }
});

test("bundlePackageWithRuntimeDeps fails loudly when a required dependency is missing", () => {
  const fixtureDir = mkdtempSync(join(tmpdir(), "missing-dep-fixture-"));
  try {
    writeFileSync(
      join(fixtureDir, "package.json"),
      JSON.stringify({
        name: "broken-pkg",
        version: "1.0.0",
        dependencies: { "nonexistent-dependency-xyz": "1.0.0" },
      }),
      "utf8",
    );

    const isolatedDir = mkdtempSync(join(tmpdir(), "isolated-missing-"));
    try {
      assert.throws(
        () =>
          bundlePackageWithRuntimeDeps(
            "nonexistent-dependency-xyz",
            fixtureDir,
            join(isolatedDir, "node_modules"),
          ),
        /Required runtime dependency missing: nonexistent-dependency-xyz/,
      );
    } finally {
      rmSync(isolatedDir, { recursive: true, force: true });
    }
  } finally {
    rmSync(fixtureDir, { recursive: true, force: true });
  }
});

test("augmentStandaloneDependencies guarantees Next-style sibling resolution in dereferenced layouts", async () => {
  const standaloneSrc = join(root, "apps/web/.next/standalone");
  if (!existsSync(standaloneSrc)) return;

  const isolatedServer = mkdtempSync(join(tmpdir(), "standalone-isolated-"));
  try {
    // Copy standalone with dereference (simulating Windows NTFS junction removal)
    cpSync(standaloneSrc, isolatedServer, { recursive: true, dereference: true });

    const webModules = join(isolatedServer, "apps/web/node_modules");
    const { createRequire } = await import("node:module");

    // Before augment: Next fails to resolve sibling styled-jsx/package.json
    const preReqFromNext = createRequire(join(webModules, "next", "package.json"));
    assert.throws(
      () => preReqFromNext.resolve("styled-jsx/package.json"),
      /Cannot find module 'styled-jsx\/package\.json'/,
    );

    // Apply augmentation
    augmentStandaloneDependencies(isolatedServer);

    // After augment: Next successfully resolves sibling styled-jsx and @next/env
    const realIsolated = realpathSync(isolatedServer);
    const postReqFromNext = createRequire(join(webModules, "next", "package.json"));
    const resolvedStyledJsx = postReqFromNext.resolve("styled-jsx/package.json");
    assert.ok(
      resolvedStyledJsx.startsWith(realIsolated),
      "styled-jsx must resolve from within isolated server bundle",
    );

    const resolvedNextEnv = postReqFromNext.resolve("@next/env");
    assert.ok(
      resolvedNextEnv.startsWith(realIsolated),
      "@next/env must resolve from within isolated server bundle",
    );

    // Check that require from server.js entrypoint resolves Next and core runtime dependencies
    const serverReq = createRequire(join(isolatedServer, "apps/web/server.js"));
    assert.doesNotThrow(() => serverReq.resolve("next"));
    assert.doesNotThrow(() => serverReq.resolve("better-sqlite3"));
    assert.doesNotThrow(() => serverReq.resolve("react"));
  } finally {
    rmSync(isolatedServer, { recursive: true, force: true });
  }
});

test("getPnpmCommand dispatches platform-safe invocation across Windows and Unix", () => {
  // Unix dispatch
  const unixDispatch = getPnpmCommand(["build"], {}, "darwin");
  assert.equal(unixDispatch.command, "pnpm");
  assert.deepEqual(unixDispatch.args, ["build"]);

  const linuxDispatch = getPnpmCommand(["build"], {}, "linux");
  assert.equal(linuxDispatch.command, "pnpm");
  assert.deepEqual(linuxDispatch.args, ["build"]);

  // Windows ComSpec fallback (cmd.exe /d /s /c "pnpm build")
  const winDispatch = getPnpmCommand(
    ["build"],
    { ComSpec: "C:\\Windows\\System32\\cmd.exe" },
    "win32",
  );
  assert.equal(winDispatch.command, "C:\\Windows\\System32\\cmd.exe");
  assert.deepEqual(winDispatch.args, ["/d", "/s", "/c", "pnpm build"]);
  assert.equal(winDispatch.options.windowsVerbatimArguments, true);

  // Windows with default COMSPEC
  const winDefault = getPnpmCommand(["build", "--filter", "web"], {}, "win32");
  assert.equal(winDefault.command, "cmd.exe");
  assert.deepEqual(winDefault.args, ["/d", "/s", "/c", "pnpm build --filter web"]);

  // Validated npm_execpath points to JS script: runs directly via Node binary on any platform
  const tmpScript = mkdtempSync(join(tmpdir(), "pnpm-script-"));
  const fakePnpmJs = join(tmpScript, "pnpm.cjs");
  try {
    writeFileSync(fakePnpmJs, "");
    const nodeDispatch = getPnpmCommand(["build"], { npm_execpath: fakePnpmJs }, "win32");
    assert.equal(nodeDispatch.command, process.execPath);
    assert.deepEqual(nodeDispatch.args, [fakePnpmJs, "build"]);
  } finally {
    rmSync(tmpScript, { recursive: true, force: true });
  }
});

test("isPathContained checks cross-platform confinement, handles Windows backslashes, and rejects UNC and cross-drive escapes", () => {
  // Unix boundaries
  assert.equal(isPathContained("/app/base", "/app/base/sub/file", "darwin"), true);
  assert.equal(isPathContained("/app/base", "/app/base", "darwin"), true);
  assert.equal(isPathContained("/app/base", "/app/outside", "darwin"), false);
  assert.equal(isPathContained("/app/base", "/app/base/../outside", "darwin"), false);

  // Linux boundaries
  assert.equal(isPathContained("/opt/sumi", "/opt/sumi/resources/app", "linux"), true);
  assert.equal(isPathContained("/opt/sumi", "/etc/passwd", "linux"), false);

  // Windows backslash and case-insensitivity
  assert.equal(
    isPathContained("C:\\bundle", "C:\\bundle\\Versions\\A\\Test", "win32"),
    true,
    "Valid Windows child path with backslashes must be contained",
  );
  assert.equal(
    isPathContained("C:\\bundle", "c:\\bundle\\sub\\file", "win32"),
    true,
    "Windows case differences must be recognized as contained",
  );
  assert.equal(isPathContained("C:\\bundle", "C:\\bundle", "win32"), true);

  // Windows escaping paths
  assert.equal(
    isPathContained("C:\\bundle", "C:\\outside\\file", "win32"),
    false,
    "Sibling outside path must escape",
  );
  assert.equal(
    isPathContained("C:\\bundle", "C:\\bundle\\..\\outside", "win32"),
    false,
    "Parent traversal must escape",
  );

  // Windows cross-drive and UNC paths
  assert.equal(
    isPathContained("C:\\bundle", "D:\\bundle\\file", "win32"),
    false,
    "Cross-drive path must escape",
  );
  assert.equal(
    isPathContained("C:\\bundle", "\\\\server\\share\\file", "win32"),
    false,
    "UNC path must escape",
  );
});

test("resolveKoffiPackageDir and assertKoffiPayload verify complete native binary payload", () => {
  const pkgDir = resolveKoffiPackageDir(root, process.platform, process.arch);
  assert.ok(pkgDir, "Koffi package directory must resolve on host");
  assert.ok(
    existsSync(join(pkgDir, "package.json")),
    "package.json must exist in Koffi package dir",
  );
  assert.ok(existsSync(join(pkgDir, "index.js")), "index.js must exist in Koffi package dir");

  const normArch = process.arch === "arm64" ? "arm64" : "x64";
  const binarySubpath = `${process.platform}_${normArch}/koffi.node`;
  assert.ok(
    existsSync(join(pkgDir, binarySubpath)),
    `Native binary payload must exist at ${join(pkgDir, binarySubpath)}`,
  );

  // Test assertKoffiPayload with mock directory
  const mockServer = mkdtempSync(join(tmpdir(), "mock-server-koffi-"));
  try {
    // Missing payload throws
    assert.throws(
      () => assertKoffiPayload(mockServer, process.platform, process.arch),
      /Koffi native binary payload missing/,
    );

    // Provide payload
    const pkgDest = join(
      mockServer,
      "node_modules",
      `@koromix/koffi-${process.platform}-${normArch}`,
    );
    mkdirSync(join(pkgDest, `${process.platform}_${normArch}`), { recursive: true });
    writeFileSync(join(pkgDest, binarySubpath), "dummy node binary");

    // Assertion succeeds
    const found = assertKoffiPayload(mockServer, process.platform, process.arch);
    assert.ok(found.length > 0);
  } finally {
    rmSync(mockServer, { recursive: true, force: true });
  }
});

test("copyStandaloneForWindows copies Next standalone directory tree dereferencing valid packages without EPERM", () => {
  const mockStandalone = mkdtempSync(join(tmpdir(), "mock-standalone-"));
  const mockDest = mkdtempSync(join(tmpdir(), "mock-server-dest-"));

  try {
    // 1. Create simulated pnpm virtual store package
    const pnpmReactDir = join(
      mockStandalone,
      "node_modules",
      ".pnpm",
      "react@19.2.8",
      "node_modules",
      "react",
    );
    mkdirSync(pnpmReactDir, { recursive: true });
    writeFileSync(
      join(pnpmReactDir, "package.json"),
      JSON.stringify({ name: "react", version: "19.2.8" }),
    );
    writeFileSync(join(pnpmReactDir, "index.js"), "module.exports = 'react-mock';");

    // 2. Create simulated apps/web with symlink to pnpm react
    const webModules = join(mockStandalone, "apps", "web", "node_modules");
    mkdirSync(webModules, { recursive: true });
    const reactLink = join(webModules, "react");
    if (process.platform === "win32") {
      // pnpm uses absolute junction targets on native Windows.
      symlinkSync(pnpmReactDir, reactLink, "junction");
    } else {
      symlinkSync("../../../node_modules/.pnpm/react@19.2.8/node_modules/react", reactLink, "dir");
    }

    // 3. Create standalone files
    writeFileSync(join(mockStandalone, "apps", "web", "server.js"), "console.log('server');");
    writeFileSync(join(mockStandalone, "package.json"), JSON.stringify({ name: "root" }));

    // Execute copyStandaloneForWindows
    copyStandaloneForWindows(mockStandalone, mockDest, root);

    // Assert that react was copied dereferenced into destination
    const copiedReactPkg = join(mockDest, "apps", "web", "node_modules", "react", "package.json");
    assert.ok(existsSync(copiedReactPkg), "react package.json must exist in copied server");
    const copiedMeta = JSON.parse(readFileSync(copiedReactPkg, "utf8"));
    assert.equal(copiedMeta.name, "react");
    assert.equal(copiedMeta.version, "19.2.8");

    // Assert server.js was copied
    assert.ok(existsSync(join(mockDest, "apps", "web", "server.js")));
  } finally {
    rmSync(mockStandalone, { recursive: true, force: true });
    rmSync(mockDest, { recursive: true, force: true });
  }
});

test("copyStandaloneForWindows fails closed on dangling unresolved link", () => {
  const mockStandalone = mkdtempSync(join(tmpdir(), "mock-dangling-src-"));
  const mockDest = mkdtempSync(join(tmpdir(), "mock-dangling-dest-"));

  try {
    const webModules = join(mockStandalone, "apps", "web", "node_modules");
    mkdirSync(webModules, { recursive: true });
    const brokenLink = join(webModules, "dangling-pkg");
    symlinkSync("/nonexistent/dangling/target/path", brokenLink);

    assert.throws(
      () => copyStandaloneForWindows(mockStandalone, mockDest, root),
      /Failed to resolve standalone link target for apps[\\/]web[\\/]node_modules[\\/]dangling-pkg/,
    );
  } finally {
    rmSync(mockStandalone, { recursive: true, force: true });
    rmSync(mockDest, { recursive: true, force: true });
  }
});

test("copyStandaloneForWindows fails fast on circular directory links", () => {
  const mockStandalone = mkdtempSync(join(tmpdir(), "mock-circular-src-"));
  const mockDest = mkdtempSync(join(tmpdir(), "mock-circular-dest-"));

  try {
    const dirA = join(mockStandalone, "dir-a");
    mkdirSync(dirA, { recursive: true });
    writeFileSync(join(dirA, "file.txt"), "hello");
    const loopLink = join(dirA, "loop");
    symlinkSync(dirA, loopLink, process.platform === "win32" ? "junction" : "dir");

    assert.throws(
      () => copyStandaloneForWindows(mockStandalone, mockDest, root),
      /Circular link detected in standalone bundle/,
    );
  } finally {
    rmSync(mockStandalone, { recursive: true, force: true });
    rmSync(mockDest, { recursive: true, force: true });
  }
});

test("shared helpers: arch normalisation, root version and forbidden file names", () => {
  assert.equal(normalizeArch("arm64"), "arm64");
  assert.equal(normalizeArch("x64"), "x64");
  assert.equal(normalizeArch("ia32"), "x64");
  assert.equal(readRootVersion(root), JSON.parse(readFileSync(join(root, "package.json"))).version);

  const tempDir = mkdtempSync(join(tmpdir(), "sumi-common-"));
  try {
    assert.throws(() => readRootVersion(tempDir), /ENOENT/);
    writeFileSync(join(tempDir, "package.json"), JSON.stringify({ name: "x" }));
    assert.throws(() => readRootVersion(tempDir), /has no version field/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }

  assert.equal(forbiddenNameKind(".env.local"), "env");
  assert.equal(forbiddenNameKind("journal.sqlite-wal"), "database");
  assert.equal(forbiddenNameKind("a.db"), "database");
  assert.equal(forbiddenNameKind("parakeet.gguf"), "model");
  assert.equal(forbiddenNameKind("silero-vad-v6.2-F32.gguf"), null);
  assert.equal(forbiddenNameKind(".secret"), "secret");
  assert.equal(forbiddenNameKind("index.js"), null);
});

test("isPathContained does not mistake children named like parent escapes for escapes", () => {
  assert.equal(isPathContained("/app/base", "/app/base/..hidden/file", "linux"), true);
  assert.equal(isPathContained("/app/base", "/app/base/../outside", "linux"), false);
  assert.equal(isPathContained("C:\\bundle", "C:\\bundle\\..foo\\x", "win32"), true);
});

test("assertSymlinksConfined reports escapes with the given message and honours skipMissing", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "sumi-symlinks-"));
  try {
    const base = join(tempDir, "bundle");
    mkdirSync(base);
    writeFileSync(join(tempDir, "outside.txt"), "x");
    symlinkSync(join(tempDir, "outside.txt"), join(base, "bad"));
    assert.throws(
      () => assertSymlinksConfined(base, base, { message: "Custom escape" }),
      /^Error: Custom escape: .*bad -> .*outside\.txt$/,
    );
    const missing = join(tempDir, "missing");
    assert.doesNotThrow(() => assertSymlinksConfined(missing, base));
    assert.throws(() => assertSymlinksConfined(missing, base, { skipMissing: false }), /ENOENT/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("probeDllFileVersion parses tool output and propagates tool failures", () => {
  const ok = probeDllFileVersion("C:\\x\\a'b.dll", (cmd, args) => {
    assert.equal(cmd, "powershell");
    assert.match(args.at(-1), /a''b\.dll/);
    return "14.44.35111.0\r\n";
  });
  assert.deepEqual(ok.version, [14, 44, 35111, 0]);
  assert.equal(probeDllFileVersion("x", () => "garbage").version, null);
  assert.throws(
    () =>
      probeDllFileVersion("x", () => {
        throw new Error("powershell missing");
      }),
    /powershell missing/,
  );
});

test("ensureVerifiedArchive downloads, verifies against official and pinned checksums, and caches", async () => {
  const cacheDir = mkdtempSync(join(tmpdir(), "sumi-archive-"));
  try {
    const payload = Buffer.from("archive-bytes");
    const sha = sha256Hex(payload);
    const calls = [];
    const makeFetch =
      (sums, body = payload) =>
      async (url) => {
        calls.push(url);
        if (url.endsWith("SHASUMS256.txt"))
          return { ok: true, status: 200, text: async () => sums };
        return { ok: true, status: 200, arrayBuffer: async () => body };
      };
    const spec = {
      cacheDir,
      archiveName: "thing-1.zip",
      baseUrl: "https://example.test/v1",
      sumsCacheName: "thing-SHASUMS256.txt",
      label: "official Thing v1",
      sumsLabel: "Thing SHASUMS256.txt",
      archiveKind: "Thing",
      archiveTimeoutMs: 5000,
    };

    // Fresh download verifies against the official sums and caches both files.
    const first = await ensureVerifiedArchive({
      ...spec,
      fetchFn: makeFetch(`${sha}  thing-1.zip\n`),
    });
    assert.equal(first.checksum, sha);
    assert.equal(readFileSync(first.archivePath, "utf8"), "archive-bytes");
    assert.equal(calls.length, 2);

    // A matching cached archive is reused without any network access.
    const second = await ensureVerifiedArchive({
      ...spec,
      fetchFn: async () => assert.fail("must not fetch when the cache is valid"),
    });
    assert.equal(second.archivePath, first.archivePath);
    assert.equal(second.checksum, sha);

    // A pinned checksum is authoritative: a stale cache with a different pin re-downloads.
    const wrongPin = "0".repeat(64);
    await assert.rejects(
      ensureVerifiedArchive({
        ...spec,
        pinnedSha: wrongPin,
        fetchFn: makeFetch(`${sha}  thing-1.zip\n`),
      }),
      /does not match pinned checksum/,
    );

    // Corrupt download and missing checksum entries are rejected and not cached.
    rmSync(join(cacheDir, "thing-1.zip"));
    await assert.rejects(
      ensureVerifiedArchive({
        ...spec,
        fetchFn: makeFetch(`${sha}  thing-1.zip\n`, Buffer.from("tampered")),
      }),
      /Thing archive checksum mismatch/,
    );
    assert.equal(existsSync(join(cacheDir, "thing-1.zip")), false);
    await assert.rejects(
      ensureVerifiedArchive({ ...spec, fetchFn: makeFetch(`${sha}  other.zip\n`) }),
      /Could not find checksum for thing-1\.zip in Thing SHASUMS256\.txt/,
    );
    await assert.rejects(
      ensureVerifiedArchive({
        ...spec,
        fetchFn: async () => ({ ok: false, status: 404 }),
      }),
      /Failed to download official Thing v1 \(404\/404\)/,
    );
  } finally {
    rmSync(cacheDir, { recursive: true, force: true });
  }
});

test("collectShippedLicenses lists only packages in the staged app and reads licenses from the store", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "sumi-licenses-"));
  try {
    const writePkg = (dir, name, version, files = {}) => {
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "package.json"), JSON.stringify({ name, version }));
      for (const [file, text] of Object.entries(files)) writeFileSync(join(dir, file), text);
    };

    // Checkout pnpm store: shipped + dev-only packages, with license texts.
    const store = join(tempDir, "checkout/node_modules/.pnpm");
    writePkg(join(store, "next@1.0.0/node_modules/next"), "next", "1.0.0", { LICENSE: "MIT next" });
    writePkg(join(store, "@scope+lib@2.0.0/node_modules/@scope/lib"), "@scope/lib", "2.0.0", {
      LICENSE: "MIT scope-lib",
    });
    writePkg(join(store, "vitest@3.0.0/node_modules/vitest"), "vitest", "3.0.0", {
      LICENSE: "MIT dev only",
    });

    // Staged app: traced standalone server (no LICENSE files) and app node_modules.
    const resources = join(tempDir, "app/resources");
    const serverModules = join(resources, "server/node_modules");
    writePkg(join(serverModules, ".pnpm/next@1.0.0/node_modules/next"), "next", "1.0.0");
    writePkg(
      join(serverModules, ".pnpm/@scope+lib@2.0.0/node_modules/@scope/lib"),
      "@scope/lib",
      "2.0.0",
    );
    writePkg(join(resources, "server/apps/web/node_modules/local"), "local", "0.0.1", {
      "README.md": "not a license file",
      COPYING: "own copying",
    });
    const appModules = join(resources, "app/node_modules");
    writePkg(join(appModules, "example-updater"), "example-updater", "6.0.0", {
      LICENSE: "MIT updater",
    });
    writePkg(join(appModules, "example-updater/node_modules/nested"), "nested", "1.0.0", {
      "NOTICE.md": "nested notice",
    });

    const dest = join(resources, "licenses/dependencies");
    const ids = collectShippedLicenses(
      dest,
      [join(resources, "server"), appModules],
      [store, join(tempDir, "missing-store")],
    );

    assert.deepEqual(ids, [
      "@scope__lib@2.0.0",
      "example-updater@6.0.0",
      "local@0.0.1",
      "nested@1.0.0",
      "next@1.0.0",
    ]);
    assert.equal(readFileSync(join(dest, "next@1.0.0/LICENSE"), "utf8"), "MIT next");
    assert.equal(readFileSync(join(dest, "@scope__lib@2.0.0/LICENSE"), "utf8"), "MIT scope-lib");
    assert.equal(readFileSync(join(dest, "example-updater@6.0.0/LICENSE"), "utf8"), "MIT updater");
    assert.equal(readFileSync(join(dest, "nested@1.0.0/NOTICE.md"), "utf8"), "nested notice");
    assert.equal(readFileSync(join(dest, "local@0.0.1/COPYING"), "utf8"), "own copying");
    assert.equal(existsSync(join(dest, "local@0.0.1/README.md")), false);
    assert.equal(
      existsSync(join(dest, "vitest@3.0.0")),
      false,
      "dev-only packages must not be listed",
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("bundledDependencyPackages follows production dependencies and skips dev and type-only packages", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "sumi-bundled-"));
  try {
    const writePkg = (dir, json) => {
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "package.json"), JSON.stringify(json));
      writeFileSync(join(dir, "index.js"), "module.exports = {};");
    };
    const web = join(tempDir, "apps/web");
    const modules = join(tempDir, "node_modules");
    writePkg(web, {
      name: "web",
      dependencies: { chart: "1", "@types/react": "1" },
      devDependencies: { vitest: "1" },
    });
    writePkg(join(modules, "chart"), {
      name: "chart",
      version: "1.0.0",
      dependencies: { scale: "1" },
      optionalDependencies: { "not-installed": "1" },
      peerDependencies: { react: "1" },
    });
    writePkg(join(modules, "scale"), { name: "scale", version: "2.0.0" });
    writePkg(join(modules, "react"), { name: "react", version: "19.0.0" });
    writePkg(join(modules, "vitest"), { name: "vitest", version: "3.0.0" });
    writePkg(join(modules, "@types/react"), { name: "@types/react", version: "19.0.0" });
    // CSS-only package: its exports map exposes no JavaScript entry or package.json.
    mkdirSync(join(modules, "animate"), { recursive: true });
    writeFileSync(
      join(modules, "animate/package.json"),
      JSON.stringify({ name: "animate", version: "1.0.0", exports: { "./css": "./a.css" } }),
    );

    const names = bundledDependencyPackages(web, ["animate"])
      .map((dir) => JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).name)
      .sort();
    assert.deepEqual(names, ["animate", "chart", "react", "scale"]);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("getTarCommand uses the absolute System32 bsdtar on Windows, never PATH", () => {
  assert.equal(
    getTarCommand("win32", { SystemRoot: "D:\\Windows" }),
    "D:\\Windows\\System32\\tar.exe",
  );
  assert.equal(getTarCommand("win32", {}), "C:\\Windows\\System32\\tar.exe");
  assert.equal(getTarCommand("linux", { SystemRoot: "C:\\Windows" }), "tar");
  assert.equal(getTarCommand("darwin", {}), "tar");
  // The staging code must route extraction through the helper rather than a bare name.
  const src = readFileSync(join(root, "desktop/lib/runtime.mjs"), "utf8");
  assert.doesNotMatch(src, /execFileSync\(\s*"tar(\.exe)?"/);
});

test("pruneKoffiPayloads keeps only the target koffi payload and leaves licence handling intact", () => {
  for (const [platform, arch, payload, others] of [
    ["linux", "x64", "linux_x64", ["musl_x64", "linux_arm64"]],
    ["darwin", "arm64", "darwin_arm64", ["darwin_x64"]],
    ["win32", "x64", "win32_x64", ["win32_arm64"]],
  ]) {
    const server = mkdtempSync(join(tmpdir(), "prune-koffi-"));
    const licenses = mkdtempSync(join(tmpdir(), "prune-koffi-lic-"));
    try {
      const pkgName = `koffi-${platform}-${arch}`;
      const makePackage = (modules, name, payloads) => {
        const dir = join(modules, "@koromix", name);
        mkdirSync(dir, { recursive: true });
        writeFileSync(
          join(dir, "package.json"),
          JSON.stringify({ name: `@koromix/${name}`, version: "3.3.7" }),
        );
        writeFileSync(join(dir, "LICENSE.txt"), "MIT licence text");
        writeFileSync(join(dir, "index.js"), "module.exports = {};");
        for (const sub of payloads) {
          mkdirSync(join(dir, sub), { recursive: true });
          writeFileSync(join(dir, sub, "koffi.node"), "binary");
        }
        return dir;
      };
      const modulesDirs = [
        join(server, "node_modules"),
        join(server, "apps/web/node_modules"),
        join(server, "node_modules/.pnpm/koffi@3.3.7/node_modules"),
      ];
      for (const modules of modulesDirs) {
        makePackage(modules, pkgName, [payload, ...others]);
        makePackage(modules, "koffi-freebsd-x64", ["freebsd_x64"]);
      }
      // A dangling link to another target's package must not break pruning.
      symlinkSync(
        join(server, "does-not-exist"),
        join(server, "node_modules/@koromix/koffi-android-arm64"),
      );
      // Unrelated packages and payload-like folders are never touched.
      const other = join(server, "node_modules/better-sqlite3/build/Release");
      mkdirSync(other, { recursive: true });
      writeFileSync(join(other, "better_sqlite3.node"), "binary");
      mkdirSync(join(server, "node_modules/@koromix", pkgName, "docs_x64"), { recursive: true });

      const removed = pruneKoffiPayloads(server, platform, arch);
      assert.ok(removed.length >= modulesDirs.length * (others.length + 1));
      for (const modules of modulesDirs) {
        const pkg = join(modules, "@koromix", pkgName);
        assert.ok(existsSync(join(pkg, payload, "koffi.node")), `${payload} kept`);
        for (const sub of others) assert.ok(!existsSync(join(pkg, sub)), `${sub} pruned`);
        assert.ok(!existsSync(join(modules, "@koromix", "koffi-freebsd-x64")));
        for (const name of ["package.json", "index.js", "LICENSE.txt"]) {
          assert.ok(existsSync(join(pkg, name)), `${name} kept`);
        }
      }
      assert.ok(existsSync(join(other, "better_sqlite3.node")));
      assert.ok(existsSync(join(server, "node_modules/@koromix", pkgName, "docs_x64")));
      assertKoffiPayload(server, platform, arch);
      // Idempotent
      assert.deepEqual(pruneKoffiPayloads(server, platform, arch), []);

      // Licence collection still lists the kept package and copies its licence text.
      const ids = collectShippedLicenses(licenses, [server]);
      assert.ok(ids.includes(`@koromix__${pkgName}@3.3.7`));
      assert.ok(!ids.some((id) => id.includes("freebsd")));
      assert.equal(
        readFileSync(join(licenses, `@koromix__${pkgName}@3.3.7`, "LICENSE.txt"), "utf8"),
        "MIT licence text",
      );
    } finally {
      rmSync(server, { recursive: true, force: true });
      rmSync(licenses, { recursive: true, force: true });
    }
  }
});
