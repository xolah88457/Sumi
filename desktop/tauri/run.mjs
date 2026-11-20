import { execFileSync, spawn } from "node:child_process";
import { createHash, createPublicKey, verify } from "node:crypto";
import { accessSync, constants, readFileSync, realpathSync, statSync } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  appleSecretNames,
  codesignEnv,
  signRuntime,
  signingPlan,
  tauriAppleEnv,
} from "./macos-signing.mjs";

const tauriDir = fileURLToPath(new URL(".", import.meta.url));
const targetDir = join(tauriDir, "src-tauri", "target");
const require = createRequire(import.meta.url);
const usage = "Usage: node desktop/tauri/run.mjs <build|open|check [packaged-executable]>";
const smokeChecks = [
  "runtimeInfo",
  "preferences",
  "secureContext",
  "mediaDevices",
  "health",
  "nativeBlobDownload",
];

export function nativePackages(
  releaseDir,
  { productName, version, mainBinaryName },
  platform,
  arch,
) {
  const bundle = join(releaseDir, "bundle");
  if (platform === "darwin" && ["arm64", "x64"].includes(arch)) {
    // Tauri's dmg target also needs the app bundle. Its file name is
    // <productName>_<version>_<aarch64|x64>.dmg; the build fails loudly if it is absent.
    return {
      bundles: "app,dmg",
      app: join(bundle, "macos", `${productName}.app`),
      installer: join(
        bundle,
        "dmg",
        `${productName}_${version}_${arch === "arm64" ? "aarch64" : "x64"}.dmg`,
      ),
    };
  }
  if (platform === "win32" && arch === "x64") {
    return {
      bundles: "nsis",
      app: join(releaseDir, `${mainBinaryName}.exe`),
      installer: join(bundle, "nsis", `${productName}_${version}_x64-setup.exe`),
    };
  }
  if (platform === "linux" && arch === "x64") {
    return {
      bundles: "deb,appimage",
      app: join(bundle, "appimage", `${productName}_${version}_amd64.AppImage`),
      installer: join(bundle, "deb", `${productName}_${version}_amd64.deb`),
    };
  }
  throw new Error(`Unsupported native Tauri target: ${platform}-${arch}`);
}

// Updater artifacts (.sig files, updater archives) are produced only when the release
// signing key is present. Without it the build is identical to a local one and the app
// reports "updates unavailable". The key is never read or logged here.
export function updaterBuildArgs(env = process.env) {
  return env.TAURI_SIGNING_PRIVATE_KEY || env.TAURI_SIGNING_PRIVATE_KEY_PATH
    ? ["--config", JSON.stringify({ bundle: { createUpdaterArtifacts: true } })]
    : [];
}

// Updater artifacts per platform; these are the files release.yml collects and signs.
export function updaterArtifacts(releaseDir, { productName, version }, platform, arch) {
  const { app, installer } = nativePackages(
    releaseDir,
    { productName, version, mainBinaryName: productName },
    platform,
    arch,
  );
  if (platform === "darwin") return [`${app}.tar.gz`];
  if (platform === "win32") return [installer];
  return [app];
}

export function updaterSigningKeyPresent(env = process.env) {
  return Boolean(env.TAURI_SIGNING_PRIVATE_KEY || env.TAURI_SIGNING_PRIVATE_KEY_PATH);
}

const ed25519SpkiPrefix = Buffer.from("302a300506032b6570032100", "hex");

// Minisign text file (as base64 of the whole file, the Tauri encoding) -> line 2 bytes.
function minisignLine(base64Text, label) {
  const lines = Buffer.from(String(base64Text).trim(), "base64").toString("utf8").split("\n");
  if (lines.length < 2 || !lines[1].trim()) throw new Error(`Malformed minisign ${label}`);
  return Buffer.from(lines[1].trim(), "base64");
}

// Verify a Tauri updater signature (.sig contents) for `data` against a Tauri public key,
// both base64-encoded minisign text files. Returns true or throws with the reason.
export function verifyMinisign(data, signature, pubkey) {
  const pub = minisignLine(pubkey, "public key");
  const sigText = Buffer.from(String(signature).trim(), "base64").toString("utf8").split("\n");
  const sig = minisignLine(signature, "signature");
  if (pub.length !== 42 || pub.toString("latin1", 0, 2) !== "Ed") {
    throw new Error("Malformed minisign public key");
  }
  if (sig.length !== 74) throw new Error("Malformed minisign signature");
  const alg = sig.toString("latin1", 0, 2);
  if (alg !== "ED" && alg !== "Ed") throw new Error(`Unsupported minisign algorithm: ${alg}`);
  if (!sig.subarray(2, 10).equals(pub.subarray(2, 10))) {
    throw new Error("Signature key ID does not match the updater public key");
  }
  const key = createPublicKey({
    key: Buffer.concat([ed25519SpkiPrefix, pub.subarray(10)]),
    format: "der",
    type: "spki",
  });
  const message = alg === "ED" ? createHash("blake2b512").update(data).digest() : data;
  if (!verify(null, message, key, sig.subarray(10))) {
    throw new Error("Signature does not verify against the updater public key");
  }
  // Global signature covers the signature plus the trusted comment (e.g. the version).
  const trusted = (sigText[2] || "").replace(/^trusted comment: /, "");
  const global = Buffer.from((sigText[3] || "").trim(), "base64");
  if (
    !sigText[2]?.startsWith("trusted comment: ") ||
    !verify(null, Buffer.concat([sig.subarray(10), Buffer.from(trusted)]), key, global)
  ) {
    throw new Error("Trusted comment does not verify against the updater public key");
  }
  return true;
}

// Fail the build if any artifact's .sig is missing or was not made by the updater key.
export function verifyUpdaterSignatures(files, pubkey) {
  if (!pubkey || !pubkey.trim()) {
    throw new Error(
      "Updater signing key is set but SUMI_TAURI_UPDATER_PUBKEY is empty; cannot verify signatures.",
    );
  }
  for (const file of files) {
    let signature;
    try {
      signature = readFileSync(`${file}.sig`, "utf8");
    } catch {
      throw new Error(`Missing updater signature: ${file}.sig`);
    }
    try {
      verifyMinisign(readFileSync(file), signature, pubkey);
    } catch (error) {
      throw new Error(`Updater signature check failed for ${basename(file)}: ${error.message}`);
    }
  }
}

// `tauri build --no-sign` also skips updater signing, so sign the artifacts with the CLI.
// The key reaches only the signer child process, through its environment; it is never logged.
export function signUpdaterArtifacts(files, version, env = process.env) {
  const tauri = require.resolve("@tauri-apps/cli/tauri.js");
  for (const file of files) {
    requireFile(file);
    execFileSync(process.execPath, [tauri, "signer", "sign", "--app-version", version, file], {
      env,
      stdio: ["ignore", "ignore", "inherit"],
    });
  }
}

// Secrets that only the Tauri CLI needs; keep them out of the web build and the stager.
export function withoutSigningSecrets(env) {
  const clean = { ...env };
  for (const name of [
    "TAURI_SIGNING_PRIVATE_KEY",
    "TAURI_SIGNING_PRIVATE_KEY_PATH",
    "TAURI_SIGNING_PRIVATE_KEY_PASSWORD",
    ...appleSecretNames,
  ]) {
    delete clean[name];
  }
  return clean;
}

function systemTempRoot() {
  // Match the roots Rust accepts, independent of TMPDIR/TMP/TEMP overrides.
  if (process.platform === "darwin") {
    return execFileSync("/usr/bin/getconf", ["DARWIN_USER_TEMP_DIR"], { encoding: "utf8" }).trim();
  }
  if (process.platform === "win32") {
    const localAppData = execFileSync(
      join(
        process.env.SystemRoot ?? "C:\\Windows",
        "System32/WindowsPowerShell/v1.0/powershell.exe",
      ),
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "[Console]::OutputEncoding = [Text.UTF8Encoding]::new(); [Environment]::GetFolderPath('LocalApplicationData')",
      ],
      { encoding: "utf8", windowsHide: true },
    ).trim();
    if (!localAppData) throw new Error("Cannot determine Windows Local AppData");
    return join(localAppData, "Temp");
  }
  return "/tmp";
}

async function withScratchProfile(run) {
  const temp = await realpath(systemTempRoot());
  const scratch = await mkdtemp(join(temp, "sumi-tauri-"));
  try {
    const profile = join(scratch, "journal");
    await mkdir(profile, { mode: 0o700 });
    return await run({
      TMPDIR: scratch,
      ...(process.platform === "win32" && { TEMP: scratch, TMP: scratch }),
      SUMI_TEST_MODE: "1",
      JOURNAL_DATA_DIR: profile,
    });
  } finally {
    await rm(scratch, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
  }
}

function macExecutable(appPath) {
  const contents = join(appPath, "Contents");
  let executable;
  try {
    executable = execFileSync(
      "/usr/bin/plutil",
      ["-extract", "CFBundleExecutable", "raw", "-o", "-", join(contents, "Info.plist")],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    ).trim();
  } catch {
    throw new Error(`No usable bundle at ${appPath}. Run 'pnpm tauri:build' first.`);
  }
  if (!executable || executable !== basename(executable) || [".", ".."].includes(executable)) {
    throw new Error(`Invalid CFBundleExecutable in ${appPath}`);
  }
  return join(contents, "MacOS", executable);
}

function requireFile(path, executable = false) {
  const info = statSync(path, { throwIfNoEntry: false });
  if (!info?.isFile() || info.size === 0) {
    throw new Error(`Missing or empty Tauri package file: ${path}. Run 'pnpm tauri:build' first.`);
  }
  if (executable && process.platform !== "win32") accessSync(path, constants.X_OK);
  return path;
}

function launchOptions(executable, env) {
  const host = {};
  for (const key of [
    "HOME",
    "PATH",
    "LANG",
    "LC_ALL",
    "SystemRoot",
    "WINDIR",
    "USERPROFILE",
    "APPDATA",
    "LOCALAPPDATA",
    "DISPLAY",
    "XAUTHORITY",
    "WAYLAND_DISPLAY",
    "XDG_RUNTIME_DIR",
    "DBUS_SESSION_BUS_ADDRESS",
    "WEBKIT_DISABLE_DMABUF_RENDERER",
  ]) {
    if (process.env[key] !== undefined) host[key] = process.env[key];
  }
  if (process.platform === "linux") {
    for (const name of ["CACHE", "CONFIG", "DATA", "STATE"]) {
      host[`XDG_${name}_HOME`] = join(env.TMPDIR, `xdg-${name.toLowerCase()}`);
    }
    // Extraction uses the launch's scratch root, not the link-free journal child.
    if (executable.endsWith(".AppImage")) host.APPIMAGE_EXTRACT_AND_RUN = "1";
  }
  return { cwd: env.JOURNAL_DATA_DIR, env: { ...host, ...env } };
}

function killSmoke(child) {
  if (!child.pid) return;
  if (process.platform === "win32") {
    try {
      execFileSync(
        join(process.env.SystemRoot ?? "C:\\Windows", "System32", "taskkill.exe"),
        ["/PID", String(child.pid), "/T", "/F"],
        { stdio: "ignore", timeout: 5_000 },
      );
    } catch {
      child.kill("SIGKILL");
    }
  } else {
    // AppImage extract-and-run waits on a subprocess. Kill its launch group, not just the wrapper.
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  }
}

function launchSmoke(executable, args, env, timeout) {
  return new Promise((resolve) => {
    const child = spawn(executable, args, {
      ...launchOptions(executable, { ...env, SUMI_TAURI_SMOKE: "1" }),
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    for (const pipe of [child.stdout, child.stderr]) {
      pipe.setEncoding("utf8");
      pipe.on("data", (chunk) => {
        output = (output + chunk).slice(-16_384);
      });
    }
    let reason;
    const timer = setTimeout(() => {
      reason = `timed out after ${timeout} ms`;
      try {
        killSmoke(child);
      } catch (error) {
        reason += `; process cleanup failed: ${error.message}`;
      }
      child.stdout.destroy();
      child.stderr.destroy();
    }, timeout);
    child.once("error", (error) => {
      reason ??= error.message;
    });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ reason: reason ?? (code !== 0 ? `exit ${signal ?? code}` : null), output });
    });
  });
}

export async function checkApp(executable, timeout = 90_000, args = []) {
  return withScratchProfile(async (env) => {
    const { reason, output } = await launchSmoke(executable, args, env, timeout);
    let report;
    let reportError;
    try {
      report = JSON.parse(await readFile(join(env.JOURNAL_DATA_DIR, "tauri-smoke.json"), "utf8"));
    } catch (error) {
      reportError = error.message;
    }
    if (reason || reportError || report?.ok !== true) {
      const backend = await readFile(join(env.JOURNAL_DATA_DIR, "tauri-desktop.log"), "utf8").catch(
        () => "",
      );
      const details = [report?.error, output.trim(), backend.slice(-16_384).trim()]
        .filter(Boolean)
        .join("\n");
      const failure = reason
        ? `Packaged Tauri smoke failed: ${reason}`
        : reportError
          ? `Packaged Tauri app exited without a valid smoke report: ${reportError}`
          : "Packaged Tauri smoke failed";
      throw new Error(`${failure}${details ? `\n${details}` : ""}`);
    }
    const missing = smokeChecks.filter((name) => report.checks?.[name] !== true);
    if (missing.length)
      throw new Error(`Packaged Tauri smoke checks missing or false: ${missing.join(", ")}`);
    return report;
  });
}

async function run(command, packagePath) {
  const { platform, arch } = process;
  const releaseDir = join(targetDir, "release");
  const config = JSON.parse(readFileSync(join(tauriDir, "src-tauri", "tauri.conf.json"), "utf8"));
  const { app, installer, bundles } = nativePackages(releaseDir, config, platform, arch);
  const executable = () =>
    requireFile(
      packagePath ? resolve(packagePath) : platform === "darwin" ? macExecutable(app) : app,
      true,
    );
  if (command === "build") {
    await withScratchProfile(async (profile) => {
      // Developer ID signing applies to macOS only; everywhere else, and on macOS without
      // APPLE_SIGNING_IDENTITY, the build is the unchanged ad-hoc/unsigned one.
      const plan =
        platform === "darwin" && process.env.APPLE_SIGNING_IDENTITY
          ? signingPlan(process.env)
          : { sign: false, notarize: "none" };
      const env = tauriAppleEnv({ ...process.env, ...profile, CARGO_TARGET_DIR: targetDir }, plan);
      // Keep Cargo on its native default target and the release layout above.
      delete env.CARGO_BUILD_TARGET;
      execFileSync(process.execPath, [join(tauriDir, "stage-runtime.mjs")], {
        cwd: tauriDir,
        env: withoutSigningSecrets(env),
        stdio: "inherit",
      });
      if (plan.sign) {
        // Tauri does not reliably sign arbitrary Mach-O files inside resources, and
        // notarization rejects any that lack the hardened runtime and a timestamp.
        signRuntime({
          dir: join(tauriDir, "runtime"),
          identity: process.env.APPLE_SIGNING_IDENTITY,
          env: codesignEnv(process.env),
        });
      }
      if (platform === "win32") {
        // Cargo copies resource files but does not prune files removed from the stage.
        await rm(join(releaseDir, "runtime"), { recursive: true, force: true });
      }
      execFileSync(
        process.execPath,
        [
          require.resolve("@tauri-apps/cli/tauri.js"),
          "build",
          "--bundles",
          bundles,
          "--ci",
          ...(plan.sign ? [] : ["--no-sign"]),
          ...updaterBuildArgs(env),
          "--",
          "--locked",
        ],
        { cwd: tauriDir, env, stdio: "inherit" },
      );
      if (updaterSigningKeyPresent(process.env)) {
        const artifacts = updaterArtifacts(releaseDir, config, platform, arch);
        artifacts.forEach((file) => requireFile(file));
        if (!plan.sign) signUpdaterArtifacts(artifacts, config.version, process.env);
        verifyUpdaterSignatures(artifacts, process.env.SUMI_TAURI_UPDATER_PUBKEY);
        console.log(`Verified updater signatures: ${artifacts.map((f) => basename(f)).join(", ")}`);
      }
    });
    executable();
    if (platform === "win32") {
      for (const file of ["runtime/node.exe", "launch.cjs", "server/apps/web/server.js"]) {
        requireFile(join(releaseDir, "runtime", file));
      }
    }
    if (installer) requireFile(installer);
    console.log(`Built ${app}${installer ? `\nBuilt ${installer}` : ""}`);
  } else if (command === "open") {
    const binary = executable();
    await withScratchProfile(
      (env) =>
        new Promise((resolve, reject) => {
          console.log(`Opening ${app} with disposable journal ${env.JOURNAL_DATA_DIR}`);
          const child = spawn(binary, [], { ...launchOptions(binary, env), stdio: "inherit" });
          child.once("error", reject);
          child.once("exit", (code, signal) => {
            if (code === 0) resolve();
            else reject(new Error(`Packaged Tauri app exited with ${signal || code}`));
          });
        }),
    );
  } else if (command === "check") {
    const binary = executable();
    console.log(`Checking packaged Tauri executable: ${binary}`);
    const report = await checkApp(
      binary,
      platform === "linux" && binary.endsWith(".AppImage") ? 180_000 : 90_000,
    );
    console.log("Packaged Tauri smoke passed:", report.checks);
  }
}

if (
  process.argv[1] &&
  realpathSync.native(fileURLToPath(import.meta.url)) === realpathSync.native(process.argv[1])
) {
  try {
    const [command, packagePath, ...extra] = process.argv.slice(2);
    if (
      !["build", "open", "check"].includes(command) ||
      extra.length ||
      (packagePath !== undefined && (command !== "check" || !packagePath))
    ) {
      throw new Error(usage);
    }
    await run(command, packagePath);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
