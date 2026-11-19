import { execFileSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { win32 as winPath, basename, dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  assertSymlinksConfined,
  cleanPrivateFiles,
  ensureVerifiedArchive,
  findFileCaseInsensitive,
  isPathContained,
  normalizeArch,
  parseFileVersionString,
  parseShaSums,
  probeDllFileVersion,
  sha256File,
} from "./common.mjs";

/**
 * Runtime staging helpers shared by the Tauri shell: bundled Node, native addons,
 * standalone Next.js server copy, Windows CRT and shipped licences.
 */
export { cleanPrivateFiles, isPathContained, parseFileVersionString, parseShaSums };

export const SILERO_EXPECTED_SHA256 =
  "0d871a800c420fdd5d1b17a3aea4296d1c39608f0ff4a9295eb76457eb1c88e6";

export const REQUIRED_WIN32_CRT_DLLS = ["msvcp140.dll", "vcruntime140.dll", "vcruntime140_1.dll"];

/**
 * Minimum trusted Visual C++ 14.x x64 CRT FILEVERSION that may ever be bundled
 * app-local. transcribe-cpp native artifacts are built with VS 2022 >= 17.10
 * (msvcp140.dll >= 14.40); an app-local copy older than 14.40 wins over the host's
 * newer System32 DLL in the loader search order and crashes native backend
 * enumeration / TranscribeModel.load with a std::mutex ABI access violation
 * (0xC0000005). See https://github.com/handy-computer/transcribe.cpp/issues/210
 * (fixed upstream in transcribe-cpp 0.4.1 via PR #212, but old app-local CRT DLLs
 * must still never be shipped, so the build fails closed below this floor).
 */
export const MIN_WIN32_CRT_FILEVERSION = [14, 40, 0, 0];

/** Numeric comparison of 4-part file versions: >0 if a>b, <0 if a<b, 0 if equal. */
export function compareFileVersions(a, b) {
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const x = Number(a[i] || 0);
    const y = Number(b[i] || 0);
    if (x !== y) return x - y;
  }
  return 0;
}

/** Formats a 4-part version array as "14.40.0.0". */
export function formatFileVersion(version) {
  return (version || []).map(Number).join(".");
}

/**
 * Reads the PE FILEVERSION of a Windows DLL via PowerShell FileVersionInfo.
 * Returns a 4-part numeric array. Throws when the version cannot be read;
 * `runTool` is injectable for tests.
 */
export function readDllFileVersion(filePath, runTool = execFileSync) {
  const { version, output } = probeDllFileVersion(filePath, runTool);
  if (!version) {
    throw new Error(`Could not read FILEVERSION of ${filePath} (powershell output: ${output})`);
  }
  return version;
}

/**
 * Collects candidate directories holding app-local Visual C++ 14.x x64 CRT DLLs
 * on Windows. Prefers the official Microsoft Visual C++ Redistributable directory
 * (via vswhere or VCToolsRedistDir), or falls back to system32 if necessary.
 */
export function collectWindowsCrtCandidateDirs(env = process.env) {
  const candidates = [];

  // 1. Explicit environment override
  if (env.VC_REDIST_X64_DIR && existsSync(env.VC_REDIST_X64_DIR)) {
    candidates.push(env.VC_REDIST_X64_DIR);
  }

  // 2. VCToolsRedistDir environment variable (set in VS command prompts)
  if (env.VCToolsRedistDir) {
    const vcDir = join(env.VCToolsRedistDir, "x64");
    if (existsSync(vcDir)) {
      try {
        for (const entry of readdirSync(vcDir)) {
          if (/^Microsoft\.VC\d+\.CRT$/i.test(entry)) {
            candidates.push(join(vcDir, entry));
          }
        }
      } catch {}
    }
  }

  // 3. Probe vswhere if available on Windows
  if (process.platform === "win32") {
    try {
      const vswhere = join(
        env["ProgramFiles(x86)"] || "C:\\Program Files (x86)",
        "Microsoft Visual Studio",
        "Installer",
        "vswhere.exe",
      );
      if (existsSync(vswhere)) {
        const found = execFileSync(
          vswhere,
          ["-latest", "-products", "*", "-find", "VC/Redist/MSVC/**/x64/Microsoft.VC*.CRT"],
          { encoding: "utf8" },
        )
          .trim()
          .split(/\r?\n/)
          .filter(Boolean);
        candidates.push(...found);
      }
    } catch {
      // vswhere not found or failed
    }
  }

  // 4. Common Visual Studio / Build Tools paths on C:\
  const programFiles = [
    env["ProgramFiles"] || "C:\\Program Files",
    env["ProgramFiles(x86)"] || "C:\\Program Files (x86)",
  ];
  for (const pf of programFiles) {
    for (const edition of ["Enterprise", "Professional", "Community", "BuildTools"]) {
      for (const year of ["2022", "2019"]) {
        const redistBase = join(
          pf,
          "Microsoft Visual Studio",
          year,
          edition,
          "VC",
          "Redist",
          "MSVC",
        );
        if (existsSync(redistBase)) {
          try {
            for (const ver of readdirSync(redistBase)) {
              const crtDir = join(redistBase, ver, "x64");
              if (existsSync(crtDir)) {
                for (const entry of readdirSync(crtDir)) {
                  if (/^Microsoft\.VC\d+\.CRT$/i.test(entry)) {
                    candidates.push(join(crtDir, entry));
                  }
                }
              }
            }
          } catch {}
        }
      }
    }
  }

  // 5. System32 fallback
  const sys32 = join(env["SystemRoot"] || env["WINDIR"] || "C:\\Windows", "System32");
  if (existsSync(sys32)) {
    candidates.push(sys32);
  }

  return candidates;
}

/**
 * Selects the app-local Windows CRT DLLs to bundle, VERIFYING each candidate's PE
 * FILEVERSION. Per DLL the NEWEST candidate >= MIN_WIN32_CRT_FILEVERSION wins
 * (numeric descending, not discovery order). Fails closed: if any required DLL
 * has no qualifying candidate, nothing is resolved — an old or partial app-local
 * set must never ship, because an app-local msvcp140.dll below the floor overrides
 * the host's newer System32 copy and crashes transcribe-cpp native init (0xC0000005).
 *
 * Returns { resolved, missing, rejected, floor }.
 * options.readFileVersion (injectable for tests) maps a DLL path to a 4-part version.
 */
export function selectWindowsCrtDlls(options = {}) {
  const env = options.env || process.env;
  const readFileVersion = options.readFileVersion || readDllFileVersion;
  const candidates = collectWindowsCrtCandidateDirs(env);

  const resolved = {};
  const missing = [];
  const rejected = [];

  for (const dll of REQUIRED_WIN32_CRT_DLLS) {
    const found = [];
    for (const dir of candidates) {
      const fullPath = findFileCaseInsensitive(dir, dll);
      if (!fullPath) continue;
      let version = null;
      try {
        const v = readFileVersion(fullPath);
        version = Array.isArray(v) ? v.map(Number) : parseFileVersionString(v);
      } catch {
        version = null;
      }
      if (version && version.length >= 3) {
        found.push({
          path: fullPath,
          version: [version[0], version[1], version[2], version[3] || 0],
        });
      } else {
        rejected.push({ dll, path: fullPath, version: "unknown", reason: "unreadable-version" });
      }
    }

    const eligible = found
      .filter((c) => compareFileVersions(c.version, MIN_WIN32_CRT_FILEVERSION) >= 0)
      .sort((a, b) => compareFileVersions(b.version, a.version)); // numeric descending: newest first
    if (eligible.length > 0) {
      resolved[dll] = eligible[0].path;
      for (const c of eligible.slice(1)) {
        rejected.push({
          dll,
          path: c.path,
          version: formatFileVersion(c.version),
          reason: "superseded",
        });
      }
    } else {
      missing.push(dll);
    }
    for (const c of found) {
      if (!eligible.includes(c)) {
        rejected.push({
          dll,
          path: c.path,
          version: formatFileVersion(c.version),
          reason: "below-floor",
        });
      }
    }
  }

  // Fail closed: all-or-nothing — never bundle an old (< floor) or partial CRT set.
  if (missing.length > 0) {
    return { resolved: {}, missing, rejected, floor: MIN_WIN32_CRT_FILEVERSION.slice() };
  }
  return { resolved, missing, rejected, floor: MIN_WIN32_CRT_FILEVERSION.slice() };
}

/**
 * Resolves the app-local Visual C++ 14.x x64 CRT DLLs to bundle on Windows:
 * the newest FILEVERSION >= MIN_WIN32_CRT_FILEVERSION per DLL, or {} when any
 * required DLL lacks a trusted candidate (fail closed, never old/partial).
 */
export function resolveWindowsCrtDlls(options = {}) {
  return selectWindowsCrtDlls(options).resolved;
}

/**
 * Bundles the required Microsoft Visual C++ 14.x x64 CRT runtime DLLs into
 * the app resources and transcribe artifact directories on Windows.
 * Fails closed: throws if any required DLL is missing or below MIN_WIN32_CRT_FILEVERSION,
 * ensuring an old or incomplete CRT is never bundled into the distribution.
 */
export function bundleWindowsCrt(resources, nativeTuple, options = {}) {
  const crtFloor = formatFileVersion(MIN_WIN32_CRT_FILEVERSION);
  console.log(
    `Locating and bundling Microsoft Visual C++ x64 CRT runtime DLLs (FILEVERSION >= ${crtFloor})...`,
  );
  const crtSelection = selectWindowsCrtDlls(options);
  const crtDlls = crtSelection.resolved;
  const missingDlls = REQUIRED_WIN32_CRT_DLLS.filter((dll) => !crtDlls[dll]);
  if (missingDlls.length > 0) {
    const rejectedNote =
      crtSelection.rejected.length > 0
        ? ` Rejected candidates: ${crtSelection.rejected
            .map((r) => `${r.dll} ${r.version} (${r.reason}) at ${r.path}`)
            .join("; ")}.`
        : "";
    throw new Error(
      `Cannot build Windows distribution: missing app-local VC++ CRT DLLs with FILEVERSION >= ${crtFloor}: ${missingDlls.join(", ")}.${rejectedNote} CRT bundling is fail-closed: old or partial sets are never shipped because an app-local msvcp140.dll below ${crtFloor} overrides the host System32 copy and crashes transcribe-cpp native init (0xC0000005).`,
    );
  }

  for (const dll of REQUIRED_WIN32_CRT_DLLS) {
    console.log(`Bundling app-local CRT ${dll} from ${crtDlls[dll]}`);
  }

  const crtTargets = [join(resources, "runtime")];
  if (nativeTuple) {
    crtTargets.push(
      join(resources, "server/node_modules", `@transcribe-cpp/${nativeTuple}`),
      join(resources, "server/apps/web/node_modules", `@transcribe-cpp/${nativeTuple}`),
    );
  }

  for (const targetDir of crtTargets) {
    mkdirSync(targetDir, { recursive: true });
    for (const [dllName, dllPath] of Object.entries(crtDlls)) {
      cpSync(dllPath, join(targetDir, dllName));
    }
  }

  const licensesDir = join(resources, "licenses");
  mkdirSync(licensesDir, { recursive: true });
  writeFileSync(
    join(licensesDir, "Microsoft-Visual-CPP-Redist-Notice.txt"),
    "Microsoft Visual C++ Runtime (MSVCP140.dll, VCRUNTIME140.dll, VCRUNTIME140_1.dll)\n" +
      "Redistributed under Visual Studio 2015-2022 Redistributable License Terms for local application runtime.\n",
    "utf8",
  );

  return crtDlls;
}

export function getNodeArchiveName(
  runtimeVersion = process.version,
  platform = process.platform,
  arch = process.arch,
) {
  const normArch = normalizeArch(arch);
  if (platform === "win32") {
    return `node-${runtimeVersion}-win-${normArch}.zip`;
  }
  return `node-${runtimeVersion}-${platform}-${normArch}.tar.gz`;
}

export function getNodeBinaryRelativePath(platform = process.platform) {
  return platform === "win32" ? "node.exe" : "bin/node";
}

export async function ensureNodeArchive(
  cacheDir,
  runtimeVersion = process.version,
  arch = process.arch,
  platform = process.platform,
  pinnedSha = null,
) {
  return ensureVerifiedArchive({
    cacheDir,
    pinnedSha,
    archiveName: getNodeArchiveName(runtimeVersion, platform, arch),
    baseUrl: `https://nodejs.org/dist/${runtimeVersion}`,
    sumsCacheName: `node-${runtimeVersion}-SHASUMS256.txt`,
    label: `official Node ${runtimeVersion}`,
    sumsLabel: "Node SHASUMS256.txt",
    archiveKind: "Node",
    archiveTimeoutMs: 120_000,
  });
}

/**
 * Resolves the verified transcribe-cpp native platform tuple.
 */
export function getNativeTuple(platform = process.platform, arch = process.arch) {
  const normArch = normalizeArch(arch);
  if (platform === "darwin") {
    return normArch === "arm64" ? "darwin-arm64-metal" : "darwin-x64-cpu";
  }
  if (platform === "linux") {
    return normArch === "arm64" ? "linux-arm64-cpu-vulkan" : "linux-x64-cpu-vulkan";
  }
  if (platform === "win32") {
    return normArch === "x64" ? "win32-x64-cpu-vulkan" : null;
  }
  return null;
}

export function getNativeLibName(platform = process.platform) {
  if (platform === "darwin") return "libtranscribe.dylib";
  if (platform === "win32") return "transcribe.dll";
  return "libtranscribe.so";
}

export function getKoffiPackageName(platform = process.platform, arch = process.arch) {
  const normArch = normalizeArch(arch);
  return `@koromix/koffi-${platform}-${normArch}`;
}

/**
 * Resolves the installed @koromix/koffi-${platform}-${arch} package directory from installed metadata.
 */
export function resolveKoffiPackageDir(root, platform = process.platform, arch = process.arch) {
  const normArch = normalizeArch(arch);
  const pkgName = `koffi-${platform}-${normArch}`;

  // 1. Try resolving via Node's createRequire from apps/web or root
  for (const start of [join(root, "apps/web/package.json"), join(root, "package.json")]) {
    if (existsSync(start)) {
      try {
        const req = createRequire(start);
        const resolvedPath = req.resolve(`@koromix/${pkgName}/package.json`);
        const pkgDir = dirname(resolvedPath);
        if (existsSync(pkgDir)) {
          return pkgDir;
        }
      } catch {
        try {
          const req = createRequire(start);
          const entry = req.resolve(`@koromix/${pkgName}`);
          const found = findOwningPackageJson(entry);
          if (found && existsSync(found.pkgDir)) {
            return found.pkgDir;
          }
        } catch {}
      }
    }
  }

  // 2. Scan node_modules/.pnpm for the package directory matching the target package
  const pnpmDir = join(root, "node_modules/.pnpm");
  if (existsSync(pnpmDir)) {
    const pattern = `@koromix+${pkgName}@`;
    for (const entry of readdirSync(pnpmDir)) {
      if (entry.startsWith(pattern)) {
        const candidate = join(pnpmDir, entry, "node_modules/@koromix", pkgName);
        if (existsSync(candidate)) {
          return candidate;
        }
      }
    }
  }

  return null;
}

/**
 * Resolves the installed @koromix native directory for Koffi from actual installed metadata.
 */
export function resolveKoffiNativeDir(root, platform = process.platform, arch = process.arch) {
  const pkgDir = resolveKoffiPackageDir(root, platform, arch);
  return pkgDir ? dirname(pkgDir) : null;
}

/**
 * Asserts that the Koffi native binary payload (.node) exists in the staged server bundle.
 */
export function assertKoffiPayload(serverDir, platform = process.platform, arch = process.arch) {
  const normArch = normalizeArch(arch);
  const binarySubpath = `${platform}_${normArch}/koffi.node`;
  const pkgSubpath = `@koromix/koffi-${platform}-${normArch}`;

  const candidates = [
    join(serverDir, "node_modules", pkgSubpath, binarySubpath),
    join(serverDir, "apps/web/node_modules", pkgSubpath, binarySubpath),
  ];

  const pnpmDir = join(serverDir, "node_modules/.pnpm");
  if (existsSync(pnpmDir)) {
    for (const entry of readdirSync(pnpmDir)) {
      if (entry.includes(`koffi-${platform}-${normArch}`)) {
        candidates.push(join(pnpmDir, entry, "node_modules", pkgSubpath, binarySubpath));
      }
    }
  }

  const existing = candidates.filter((c) => existsSync(c));
  if (existing.length === 0) {
    throw new Error(
      `Koffi native binary payload missing: ${binarySubpath} not found under ${pkgSubpath} in ${serverDir}`,
    );
  }
  return existing;
}

/**
 * Removes koffi native payloads that the target cannot load from the staged server tree.
 *
 * Koffi's per-platform package ships one directory per libc/arch (`linux_x64` for glibc and
 * `musl_x64` for musl), and other `@koromix/koffi-*` packages are for other targets. Only
 * `<platform>_<arch>` (glibc on Linux) is supported. linuxdeploy resolves the shared-library
 * dependencies of every ELF file in the AppDir, so the musl addon would fail AppImage
 * bundling on glibc hosts with "Could not find dependency: libc.musl-x86_64.so.1".
 *
 * Package manifests and licence files stay in place, so licence collection is unaffected.
 * Returns the removed paths, relative to `serverDir`.
 */
export function pruneKoffiPayloads(serverDir, platform = process.platform, arch = process.arch) {
  const normArch = normalizeArch(arch);
  const keepPackage = `koffi-${platform}-${normArch}`;
  const keepPayload = `${platform}_${normArch}`;
  const removed = [];

  const modulesDirs = new Set();
  for (const modules of findNodeModulesDirs(serverDir)) {
    modulesDirs.add(modules);
    const virtualStore = join(modules, ".pnpm");
    if (existsSync(virtualStore)) {
      for (const entry of readdirSync(virtualStore)) {
        modulesDirs.add(join(virtualStore, entry, "node_modules"));
      }
    }
  }

  for (const modules of modulesDirs) {
    const scope = join(modules, "@koromix");
    if (!existsSync(scope)) continue;
    for (const entry of readdirSync(scope)) {
      if (!entry.startsWith("koffi-")) continue;
      const packagePath = join(scope, entry);
      if (entry !== keepPackage) {
        rmSync(packagePath, { recursive: true, force: true });
        removed.push(relative(serverDir, packagePath));
        continue;
      }
      if (lstatSync(packagePath).isSymbolicLink()) continue; // its real directory is pruned itself
      for (const child of readdirSync(packagePath, { withFileTypes: true })) {
        if (!child.isDirectory() || child.name === keepPayload) continue;
        const payload = join(packagePath, child.name);
        if (!existsSync(join(payload, "koffi.node"))) continue;
        rmSync(payload, { recursive: true, force: true });
        removed.push(relative(serverDir, payload));
      }
    }
  }
  return removed.sort();
}

/**
 * Locates the owning package.json for an entrypoint file by walking up directories.
 * Fallback for packages whose "exports" map hides ./package.json.
 */
export function findOwningPackageJson(entryPath) {
  let dir = dirname(entryPath);
  while (dir && dir !== dirname(dir)) {
    const pkgPath = join(dir, "package.json");
    if (existsSync(pkgPath)) {
      try {
        const json = JSON.parse(readFileSync(pkgPath, "utf8"));
        return { pkgPath, pkgDir: dir, json };
      } catch {}
    }
    dir = dirname(dir);
  }
  return null;
}

/**
 * Resolves a package's directory and metadata from a starting directory.
 * Tries direct package.json subpath first; if hidden by exports (e.g. fs-extra),
 * resolves the entrypoint and walks up to the owning package.json.
 * Throws loudly if the required dependency is missing.
 */
export function resolvePackage(pkgName, startDir) {
  const req = createRequire(
    existsSync(join(startDir, "package.json"))
      ? join(startDir, "package.json")
      : join(startDir, "dummy.js"),
  );

  // 1. Try direct package.json subpath
  try {
    const pkgPath = req.resolve(`${pkgName}/package.json`);
    const json = JSON.parse(readFileSync(pkgPath, "utf8"));
    return { pkgPath, pkgDir: dirname(pkgPath), json };
  } catch (err) {
    // 2. Try entrypoint then find owning package.json
    try {
      const entryPath = req.resolve(pkgName);
      const found = findOwningPackageJson(entryPath);
      if (found) return found;
    } catch (e2) {}
  }

  throw new Error(`Required runtime dependency missing: ${pkgName} (required from ${startDir})`);
}

/**
 * Bundles a package and its production dependencies with version-aware hoisting and nesting.
 * If conflicting versions of a transitive dependency are encountered, nests the dependency
 * in the requiring package's local node_modules directory rather than overwriting or skipping it.
 * Bounded recursion prevents infinite cycles on circular dependencies.
 */
export function bundlePackageWithRuntimeDeps(pkgName, startDir, targetNodeModules) {
  const topInstalled = new Map(); // packageName -> version

  function bundle(name, fromDir, currentTargetModules, stack = new Set()) {
    const { pkgDir, json } = resolvePackage(name, fromDir);
    const pkgId = `${json.name}@${json.version}`;
    if (stack.has(pkgId)) return; // Bounded cycle prevention
    const nextStack = new Set(stack);
    nextStack.add(pkgId);

    let destDir;
    let nextTargetModules;

    if (!topInstalled.has(json.name)) {
      // First time seeing this package: install at top level
      destDir = join(targetNodeModules, json.name);
      topInstalled.set(json.name, json.version);
      nextTargetModules = targetNodeModules;
    } else if (topInstalled.get(json.name) === json.version) {
      // Already installed at top level with identical version
      destDir = join(targetNodeModules, json.name);
      nextTargetModules = targetNodeModules;
    } else {
      // Version conflict: nest inside the requiring package's node_modules
      destDir = join(currentTargetModules, json.name);
      nextTargetModules = join(destDir, "node_modules");
    }

    if (!existsSync(destDir)) {
      mkdirSync(dirname(destDir), { recursive: true });
      cpSync(pkgDir, destDir, { recursive: true, dereference: true });
    }

    const deps = Object.keys(json.dependencies || {});
    for (const dep of deps) {
      const depTargetModules = join(destDir, "node_modules");
      bundle(dep, pkgDir, depTargetModules, nextStack);
    }
  }

  bundle(pkgName, startDir, targetNodeModules);
}

/**
 * Copies Next.js standalone server directory for Windows without invoking cpSync({ dereference: true })
 * on Next.js 15 symlinks. Next.js creates symlinks using fs.promises.symlink() without the 'dir'/'junction'
 * type argument, causing Windows NTFS to create file-type reparse points for directories that throw
 * EPERM on fs.stat(). Resolves link targets via readlink/realpath/installed package roots, and copies
 * the actual resolved package directory tree dereferenced.
 */
export function copyStandaloneForWindows(
  standaloneSrc,
  serverDest,
  root,
  { filter, resolveLink } = {},
) {
  function defaultLinkTarget(srcPath) {
    const srcDir = dirname(srcPath);
    let resolvedTarget = null;

    // 1. Read the symlink target string and resolve relative to link parent
    try {
      const rawLink = readlinkSync(srcPath);
      const candidate = resolve(srcDir, rawLink);
      if (existsSync(candidate)) {
        resolvedTarget = candidate;
      }
    } catch {
      resolvedTarget = null;
    }

    // 2. Try realpathSync fallback
    if (!resolvedTarget) {
      try {
        const real = realpathSync(srcPath);
        if (existsSync(real)) {
          resolvedTarget = real;
        }
      } catch {
        resolvedTarget = null;
      }
    }

    // 3. Known installed package roots fallback (apps/web or root package.json)
    if (!resolvedTarget) {
      const pkgName = basename(srcPath);
      for (const start of [join(root, "apps/web/package.json"), join(root, "package.json")]) {
        if (existsSync(start)) {
          try {
            const req = createRequire(start);
            const entryFile = req.resolve(pkgName);
            const found = findOwningPackageJson(entryFile);
            if (found && existsSync(found.pkgDir)) {
              resolvedTarget = found.pkgDir;
              break;
            }
          } catch {}
        }
      }
    }

    // Fail closed immediately on unresolved dangling link
    if (!resolvedTarget || !existsSync(resolvedTarget)) {
      const relPath = relative(standaloneSrc, srcPath);
      throw new Error(`Failed to resolve standalone link target for ${relPath} (link: ${srcPath})`);
    }

    return resolvedTarget;
  }

  function copyEntry(srcPath, destPath, ancestors) {
    if (filter && !filter(srcPath)) return;
    const key = process.platform === "win32" ? srcPath.toLowerCase() : srcPath;
    // Cycle ancestor fail-fast check
    if (ancestors.has(key)) {
      throw new Error(`Circular link detected in standalone bundle: ${srcPath}`);
    }
    const entry = lstatSync(srcPath);
    if (entry.isSymbolicLink() || entry.isDirectory()) {
      ancestors.add(key);
      if (entry.isSymbolicLink()) {
        // A confined caller resolves raw links without following NTFS reparse
        // points or falling back to installed packages outside the traced tree.
        const target = resolveLink
          ? resolveLink(srcPath, readlinkSync(srcPath))
          : defaultLinkTarget(srcPath);
        copyEntry(target, destPath, ancestors);
      } else {
        // Copy directory via own traversal rather than blind cpSync; preserve file copy
        mkdirSync(destPath, { recursive: true });
        for (const name of readdirSync(srcPath)) {
          copyEntry(join(srcPath, name), join(destPath, name), ancestors);
        }
      }
      ancestors.delete(key);
    } else if (entry.isFile()) {
      copyFileSync(srcPath, destPath);
    } else {
      throw new Error(`Unsupported standalone file: ${srcPath}`);
    }
  }

  copyEntry(resolve(standaloneSrc), serverDest, new Set());
}

/**
 * Augments a staged Next standalone server bundle with genuine portable runtime dependencies.
 * Resolves traced packages from the pnpm store and hoists them so that Next.js sibling dependencies
 * (such as styled-jsx, @next/env, @swc/helpers) resolve cleanly in environments where symlinks
 * are dereferenced or where NTFS junctions cannot reference the checkout.
 */
export function augmentStandaloneDependencies(serverDir) {
  const pnpmDir = join(serverDir, "node_modules", ".pnpm");
  if (!existsSync(pnpmDir)) return;

  const targets = [join(serverDir, "node_modules"), join(serverDir, "apps/web/node_modules")];

  for (const entry of readdirSync(pnpmDir)) {
    const modulesDir = join(pnpmDir, entry, "node_modules");
    if (!existsSync(modulesDir)) continue;

    for (const item of readdirSync(modulesDir)) {
      if (item.startsWith(".")) continue;
      const itemPath = join(modulesDir, item);
      if (item.startsWith("@")) {
        for (const subItem of readdirSync(itemPath)) {
          const subPath = join(itemPath, subItem);
          const pkgName = `${item}/${subItem}`;
          for (const target of targets) {
            const dest = join(target, pkgName);
            if (!existsSync(dest)) {
              mkdirSync(dirname(dest), { recursive: true });
              cpSync(subPath, dest, { recursive: true, dereference: true });
            }
          }
        }
      } else {
        for (const target of targets) {
          const dest = join(target, item);
          if (!existsSync(dest)) {
            mkdirSync(dirname(dest), { recursive: true });
            cpSync(itemPath, dest, { recursive: true, dereference: true });
          }
        }
      }
    }
  }
}

/**
 * Returns the tar executable used to unpack the Node archive. On Windows this is the
 * bsdtar shipped in %SystemRoot%\\System32, addressed by absolute path: a bare `tar` on PATH
 * can resolve to Git-for-Windows' GNU tar, which reads `D:\\...` as a remote host and cannot
 * read .zip files.
 */
export function getTarCommand(platform = process.platform, env = process.env) {
  if (platform !== "win32") return "tar";
  const systemRoot = env.SystemRoot || env.SYSTEMROOT || env.windir || "C:\\Windows";
  return winPath.join(systemRoot, "System32", "tar.exe");
}

/**
 * Resolves the platform-safe command and arguments for invoking pnpm.
 * On Windows, dispatches via ComSpec cmd.exe /d /s /c "pnpm build" or validated
 * Node + npm_execpath to avoid ENOENT/EINVAL and Node batch file security restrictions.
 */
export function getPnpmCommand(args = [], env = process.env, platform = process.platform) {
  // 1. If npm_execpath points to a validated JS script, invoke directly with current Node binary
  if (env.npm_execpath && existsSync(env.npm_execpath) && /\.[cm]?js$/i.test(env.npm_execpath)) {
    return {
      command: process.execPath,
      args: [env.npm_execpath, ...args],
      options: {},
    };
  }

  // 2. On Windows, dispatch via ComSpec cmd.exe /d /s /c without arbitrary shell argument concatenation
  if (platform === "win32") {
    const comSpec = env.ComSpec || env.COMSPEC || "cmd.exe";
    return {
      command: comSpec,
      args: ["/d", "/s", "/c", ["pnpm", ...args].join(" ")],
      options: { windowsVerbatimArguments: true },
    };
  }

  // 3. Unix standard dispatch
  return {
    command: "pnpm",
    args,
    options: {},
  };
}

/**
 * Verifies that symlinks within a directory do not escape the application bundle.
 */
export function assertSelfContained(directory, serverBase) {
  assertSymlinksConfined(directory, serverBase, { skipMissing: false });
}

/**
 * Finds every node_modules directory under `root` without descending into node_modules
 * themselves or following symlinks (e.g. server/node_modules, server/apps/web/node_modules).
 */
export function findNodeModulesDirs(root) {
  const found = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const p = join(dir, entry.name);
      if (entry.name === "node_modules") found.push(p);
      else walk(p);
    }
  };
  walk(root);
  return found;
}

const LICENSE_FILE_PATTERN = /^(licen[sc]e|copying|notice)(\.|$)/i;

function packageIdOf(packagePath) {
  let metadata;
  try {
    metadata = JSON.parse(readFileSync(join(packagePath, "package.json"), "utf8"));
  } catch (cause) {
    throw new Error(`Cannot read dependency metadata at ${packagePath}`, { cause });
  }
  return `${metadata.name}@${metadata.version}`.replaceAll("/", "__");
}

/**
 * Lists the package directories directly inside a node_modules directory
 * (descending into @scopes), skipping dot entries.
 */
function listPackageDirs(modules) {
  const dirs = [];
  if (!existsSync(modules)) return dirs;
  for (const entry of readdirSync(modules)) {
    if (entry.startsWith(".")) continue;
    const packagePath = join(modules, entry);
    if (entry.startsWith("@")) dirs.push(...listPackageDirs(packagePath));
    else if (existsSync(join(packagePath, "package.json"))) dirs.push(packagePath);
  }
  return dirs;
}

/**
 * Copies LICENSE/COPYING/NOTICE files of every package that actually ships into
 * `<destRoot>/<name>@<version>/`.
 *
 * `scanRoots` are directories of the staged app (the bundled server tree and the
 * app's own node_modules): a package is listed only if it is present there, so dev
 * dependencies and build tooling from the developer checkout never appear. Next's
 * standalone tracing copies only the files a package needs at runtime and leaves
 * its LICENSE behind, so each shipped package's license text is taken from the same
 * name@version in `sourceStores` (pnpm virtual stores of the checkout) when found,
 * otherwise from the staged copy itself. `bundledPackages` adds package directories that
 * ship compiled into the app bundle (see bundledDependencyPackages).
 *
 * Handles pnpm's virtual store (`.pnpm/<id>/node_modules`) and nested node_modules.
 * Returns the sorted list of shipped package ids.
 */
/**
 * Package directories in the production dependency closure of `rootDir`'s package.json
 * (dependencies, optionalDependencies and installed peers), plus `extraNames` resolved from
 * `rootDir`. The web build compiles these into its .next chunks, so they ship as code even
 * though most never appear as files under node_modules in the staged server tree.
 */
function findInstalledPackage(name, fromDir) {
  for (let dir = fromDir; dir !== dirname(dir); dir = dirname(dir)) {
    const pkgPath = join(dir, "node_modules", name, "package.json");
    if (existsSync(pkgPath))
      return { pkgPath, pkgDir: dirname(pkgPath), json: JSON.parse(readFileSync(pkgPath, "utf8")) };
  }
  return null;
}

export function bundledDependencyPackages(rootDir, extraNames = []) {
  const found = new Map(); // real package dir -> package dir
  function visit(json, fromDir) {
    const required = Object.keys(json.dependencies || {});
    const optional = [
      ...Object.keys(json.optionalDependencies || {}),
      ...Object.keys(json.peerDependencies || {}),
    ];
    for (const name of [...required, ...optional]) {
      if (name.startsWith("@types/")) continue; // type declarations compile to nothing
      let resolved;
      try {
        resolved = resolvePackage(name, fromDir);
      } catch (error) {
        // CSS-only packages export no resolvable entry; find their directory directly.
        resolved = findInstalledPackage(name, fromDir);
        if (!resolved && required.includes(name)) throw error;
        if (!resolved) continue; // optional or peer dependency not installed on this host
      }
      const real = realpathSync(resolved.pkgDir);
      if (found.has(real)) continue;
      found.set(real, resolved.pkgDir);
      visit(resolved.json, real);
    }
  }
  visit({ dependencies: Object.fromEntries(extraNames.map((name) => [name, "*"])) }, rootDir);
  visit(JSON.parse(readFileSync(join(rootDir, "package.json"), "utf8")), rootDir);
  return [...found.values()];
}

export function collectShippedLicenses(
  destRoot,
  scanRoots,
  sourceStores = [],
  bundledPackages = [],
) {
  const sourceById = new Map();
  for (const store of sourceStores) {
    if (!existsSync(store)) continue;
    for (const entry of readdirSync(store)) {
      for (const packagePath of listPackageDirs(join(store, entry, "node_modules"))) {
        const id = packageIdOf(packagePath);
        if (!sourceById.has(id)) sourceById.set(id, packagePath);
      }
    }
  }

  const shipped = new Map(); // id -> staged package path
  const visited = new Set();
  function visitModules(modules) {
    if (!existsSync(modules)) return;
    let real;
    try {
      real = realpathSync(modules);
    } catch {
      return;
    }
    if (visited.has(real)) return;
    visited.add(real);
    for (const packagePath of listPackageDirs(modules)) {
      const id = packageIdOf(packagePath);
      if (!shipped.has(id)) shipped.set(id, packagePath);
      visitModules(join(packagePath, "node_modules"));
    }
  }

  for (const scanRoot of scanRoots) {
    const modulesDirs =
      basename(scanRoot) === "node_modules" ? [scanRoot] : findNodeModulesDirs(scanRoot);
    for (const modules of modulesDirs) {
      visitModules(modules);
      const virtualStore = join(modules, ".pnpm");
      if (existsSync(virtualStore)) {
        for (const entry of readdirSync(virtualStore)) {
          visitModules(join(virtualStore, entry, "node_modules"));
        }
      }
    }
  }

  for (const packagePath of bundledPackages) {
    const id = packageIdOf(packagePath);
    if (!shipped.has(id)) shipped.set(id, packagePath);
  }

  for (const [id, stagedPath] of shipped) {
    const candidates = [sourceById.get(id), stagedPath].filter(Boolean);
    for (const candidate of candidates) {
      const files = readdirSync(candidate).filter((name) => LICENSE_FILE_PATTERN.test(name));
      if (files.length === 0) continue;
      const destination = join(destRoot, id);
      mkdirSync(destination, { recursive: true });
      for (const name of files) {
        cpSync(join(candidate, name), join(destination, name), { recursive: true });
      }
      break;
    }
  }
  return [...shipped.keys()].sort();
}

/** Stages the shared standalone server, launcher, assets, and official Node runtime. */
export async function stageBackend({
  root,
  resources,
  cacheDir,
  platform,
  normArch,
  appVersion,
  runtimeVersion = process.version,
  pinnedNodeSha,
  filterServerFile,
  resolveWindowsStandaloneLink,
  validateNativeSource,
}) {
  mkdirSync(join(resources, "runtime"), { recursive: true });
  mkdirSync(join(resources, "licenses"), { recursive: true });

  const standaloneSrc = join(root, "apps/web/.next/standalone");
  const serverDest = join(resources, "server");

  if (platform === "win32") {
    // Windows portable copy: avoids EPERM from cpSync({ dereference: true }) on Next directory junctions
    copyStandaloneForWindows(standaloneSrc, serverDest, root, {
      filter: filterServerFile,
      resolveLink: resolveWindowsStandaloneLink,
    });
    augmentStandaloneDependencies(serverDest);
  } else {
    // macOS and Linux: preserve proven working paths with verbatim symlinks
    cpSync(standaloneSrc, serverDest, {
      recursive: true,
      dereference: false,
      verbatimSymlinks: true,
      filter: filterServerFile,
    });
    if (platform === "linux") {
      augmentStandaloneDependencies(serverDest);
    }
  }

  const web = join(resources, "server/apps/web");
  const entrypoint = join(web, "server.js");
  const generated = readFileSync(entrypoint, "utf8");
  const portFallback = "parseInt(process.env.PORT, 10) || 3000";
  if (!generated.includes(portFallback)) {
    throw new Error("Next's standalone entrypoint changed; review ephemeral port handling.");
  }
  writeFileSync(
    entrypoint,
    generated.replace(portFallback, `(process.env.PORT === "0" ? 0 : (${portFallback}))`),
  );
  cpSync(join(root, "apps/web/.next/static"), join(web, ".next/static"), {
    recursive: true,
    filter: filterServerFile,
  });
  cpSync(join(root, "apps/web/public"), join(web, "public"), {
    recursive: true,
    filter: filterServerFile,
  });

  console.log(
    `Downloading and verifying official Node runtime (${runtimeVersion}) for ${platform}-${normArch}...`,
  );
  const { archivePath: nodeArchivePath } = await ensureNodeArchive(
    cacheDir,
    runtimeVersion,
    normArch,
    platform,
    pinnedNodeSha,
  );

  const nodeTemp = mkdtempSync(join(tmpdir(), "sumi-node-"));
  try {
    if (platform === "win32") {
      // Windows includes bsdtar with ZIP support; no Git Bash unzip required.
      execFileSync(getTarCommand("win32"), ["-xf", nodeArchivePath, "-C", nodeTemp]);
      const runtimeDir = join(nodeTemp, `node-${runtimeVersion}-win-${normArch}`);
      cpSync(join(runtimeDir, "node.exe"), join(resources, "runtime/node.exe"));
      const nodeLicense = join(runtimeDir, "LICENSE");
      if (existsSync(nodeLicense)) {
        cpSync(nodeLicense, join(resources, "licenses/Node-LICENSE.txt"));
      }
    } else {
      execFileSync(getTarCommand(platform), ["-xzf", nodeArchivePath, "-C", nodeTemp], {
        cwd: root,
        stdio: "inherit",
      });
      const runtimeDir = join(nodeTemp, `node-${runtimeVersion}-${platform}-${normArch}`);
      const nodeDest = join(resources, "runtime/node");
      cpSync(join(runtimeDir, "bin/node"), nodeDest);
      chmodSync(nodeDest, 0o755);
      const nodeLicense = join(runtimeDir, "LICENSE");
      if (existsSync(nodeLicense)) {
        cpSync(nodeLicense, join(resources, "licenses/Node-LICENSE.txt"));
      }
    }
  } finally {
    rmSync(nodeTemp, { recursive: true, force: true });
  }

  cpSync(join(root, "desktop/launch.cjs"), join(resources, "launch.cjs"));
  writeFileSync(
    join(resources, "package.json"),
    JSON.stringify(
      { name: "sumi-desktop", version: appVersion, type: "commonjs", private: true },
      null,
      2,
    ) + "\n",
  );

  cpSync(join(root, "LICENSE"), join(resources, "licenses/Trade-Journal-MIT.txt"));
  cpSync(join(root, "desktop/Kami-LICENSE.txt"), join(resources, "licenses/Kami-MIT.txt"));
  cpSync(
    join(root, "apps/web/public/licenses/CharisSIL-OFL.txt"),
    join(resources, "licenses/CharisSIL-OFL.txt"),
  );
  cpSync(
    join(root, "desktop/THIRD-PARTY-NOTICES.md"),
    join(resources, "licenses/THIRD-PARTY-NOTICES.md"),
  );

  // Clean private files from standalone server bundle
  cleanPrivateFiles(join(resources, "server"));

  // Bundle ONLY the lightweight MIT-licensed Silero VAD asset (1.2 MB)
  const sileroSrc = join(root, "models/silero-vad-v6.2-F32.gguf");
  if (!existsSync(sileroSrc)) {
    throw new Error(`Silero VAD model missing at ${sileroSrc}`);
  }
  const sileroHash = sha256File(sileroSrc);
  if (sileroHash !== SILERO_EXPECTED_SHA256) {
    throw new Error(
      `Silero VAD checksum mismatch: expected ${SILERO_EXPECTED_SHA256}, got ${sileroHash}`,
    );
  }
  const serverWebModels = join(web, "models");
  mkdirSync(serverWebModels, { recursive: true });
  cpSync(sileroSrc, join(serverWebModels, "silero-vad-v6.2-F32.gguf"));
  const sileroLicenseSrc = join(root, "models/LICENSE.silero_vad");
  if (existsSync(sileroLicenseSrc)) {
    cpSync(sileroLicenseSrc, join(serverWebModels, "LICENSE.silero_vad"));
    cpSync(sileroLicenseSrc, join(resources, "licenses/Silero-VAD-MIT.txt"));
  }

  // Package transcribe-cpp native binary
  const nativeTuple = getNativeTuple(platform, normArch);
  const libName = getNativeLibName(platform);
  if (nativeTuple) {
    try {
      const packageDir = realpathSync(join(root, "apps/web/node_modules/transcribe-cpp"));
      validateNativeSource?.(packageDir);
      const pkgJson = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"));
      const entryRelative = pkgJson.exports?.["."]?.import || "./dist/index.js";
      const entryPath = join(packageDir, entryRelative);
      const { artifactDir } = await import(pathToFileURL(entryPath).href);
      const nativeSrc = artifactDir();
      validateNativeSource?.(nativeSrc);
      if (!existsSync(join(nativeSrc, libName))) {
        throw new Error(`transcribe-cpp native library missing: ${join(nativeSrc, libName)}`);
      }
      for (const nm of [
        join(resources, "server/node_modules"),
        join(resources, "server/apps/web/node_modules"),
      ]) {
        const pkgDest = join(nm, `@transcribe-cpp/${nativeTuple}`);
        if (!existsSync(join(pkgDest, libName))) {
          mkdirSync(pkgDest, { recursive: true });
          cpSync(nativeSrc, pkgDest, { recursive: true, dereference: true });
        }
      }
    } catch (cause) {
      throw new Error(`Cannot package transcribe-cpp native platform binaries: ${cause.message}`, {
        cause,
      });
    }

    // Package Koffi native module from actual installed metadata
    const koffiPkgDir = resolveKoffiPackageDir(root, platform, normArch);
    if (koffiPkgDir && existsSync(koffiPkgDir)) {
      validateNativeSource?.(koffiPkgDir);
      const pkgSubpath = `@koromix/koffi-${platform}-${normArch}`;
      const koffiTargets = [
        join(resources, "server/node_modules", pkgSubpath),
        join(resources, "server/apps/web/node_modules", pkgSubpath),
      ];

      // Also ensure all matching package paths in .pnpm have the full native payload
      const pnpmServer = join(resources, "server/node_modules/.pnpm");
      if (existsSync(pnpmServer)) {
        for (const entry of readdirSync(pnpmServer)) {
          if (entry.includes(`koffi-${platform}-${normArch}`) || entry.startsWith("koffi@")) {
            koffiTargets.push(join(pnpmServer, entry, "node_modules", pkgSubpath));
          }
        }
      }

      // pnpm may stage some targets as relative links to another target's directory. Fill the
      // real directories first; a link that then resolves is left as is, and a dangling one is
      // replaced by a copy (copying onto it fails with ENOTDIR).
      const isLink = (path) => {
        try {
          return lstatSync(path).isSymbolicLink();
        } catch {
          return false;
        }
      };
      const ordered = [
        ...koffiTargets.filter((target) => !isLink(target)),
        ...koffiTargets.filter(isLink),
      ];
      for (const targetPkgDir of ordered) {
        if (isLink(targetPkgDir)) {
          if (existsSync(join(targetPkgDir, "package.json"))) continue;
          rmSync(targetPkgDir);
        }
        mkdirSync(targetPkgDir, { recursive: true });
        cpSync(koffiPkgDir, targetPkgDir, { recursive: true, dereference: true });
      }

      // Ship only the target's payload and assert it survives: not musl, nor other OS/arch builds (see pruneKoffiPayloads).
      pruneKoffiPayloads(join(resources, "server"), platform, normArch);
      assertKoffiPayload(join(resources, "server"), platform, normArch);
    }
  }

  // Verify self-contained symlinks
  const serverBase = realpathSync(join(resources, "server"));
  assertSelfContained(join(resources, "server"), serverBase);
  return nativeTuple;
}
