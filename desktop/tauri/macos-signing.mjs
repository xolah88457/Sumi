// Developer ID signing helpers for the macOS release build. Everything here is plain Node
// so the decisions (what is Mach-O, what gets signed, with which arguments) are unit
// tested on any OS. Nothing in this file reads or prints a secret value.
import { execFileSync } from "node:child_process";
import { closeSync, lstatSync, openSync, readSync, readdirSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const tauriDir = fileURLToPath(new URL(".", import.meta.url));

// Entitlements applied to the bundled Node executable (see the plist for why).
export const runtimeEntitlementsPath = join(tauriDir, "src-tauri", "Entitlements.runtime.plist");

// Apple credentials. Only the Tauri CLI and codesign may see them: the web build and the
// runtime stager run without them (run.mjs strips these names).
export const appleSecretNames = [
  "APPLE_CERTIFICATE",
  "APPLE_CERTIFICATE_PASSWORD",
  "APPLE_SIGNING_IDENTITY",
  "APPLE_API_ISSUER",
  "APPLE_API_KEY",
  "APPLE_API_KEY_P8",
  "APPLE_API_KEY_PATH",
  "APPLE_ID",
  "APPLE_PASSWORD",
  "APPLE_TEAM_ID",
];

const MH_EXECUTE = 2;

function readExact(fd, position, length) {
  const buffer = Buffer.alloc(length);
  const read = readSync(fd, buffer, 0, length, position);
  return buffer.subarray(0, read);
}

function thinKind(header) {
  if (header.length < 16) return null;
  const magic = header.readUInt32BE(0);
  let fileType;
  if (magic === 0xfeedface || magic === 0xfeedfacf) fileType = header.readUInt32BE(12);
  else if (magic === 0xcefaedfe || magic === 0xcffaedfe) fileType = header.readUInt32LE(12);
  else return null;
  return fileType === MH_EXECUTE ? "executable" : "other";
}

// Classifies a file from its leading bytes (never its extension): "executable" for a
// Mach-O executable, "other" for any other Mach-O (dylib, bundle, .node addon, object),
// null when it is not Mach-O. `readAt(position, length)` fetches bytes for fat files.
export function machOKind(head, readAt = () => Buffer.alloc(0)) {
  if (head.length < 8) return null;
  const thin = thinKind(head);
  if (thin) return thin;
  const magic = head.readUInt32BE(0);
  if (magic !== 0xcafebabe && magic !== 0xcafebabf) return null;
  // Java class files share 0xcafebabe; their next word is minor/major version (>= 45),
  // while a fat header holds a small architecture count.
  const count = head.readUInt32BE(4);
  if (count < 1 || count > 30 || head.length < 24) return null;
  const offset = magic === 0xcafebabe ? head.readUInt32BE(16) : Number(head.readBigUInt64BE(16));
  return thinKind(readAt(offset, 16)) ?? null;
}

export function isMachO(head, readAt) {
  return machOKind(head, readAt) !== null;
}

export function fileMachOKind(path) {
  const fd = openSync(path, "r");
  try {
    return machOKind(readExact(fd, 0, 32), (position, length) => readExact(fd, position, length));
  } finally {
    closeSync(fd);
  }
}

// Every regular Mach-O file under `dir`, found by content. Symlinks are never followed
// or signed (the staged runtime has none, and a link must not redirect a signature).
export function findMachOFiles(dir, classify = fileMachOKind) {
  const found = [];
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile() && lstatSync(path).size >= 8) {
        const kind = classify(path);
        if (kind) found.push({ path, kind });
      }
    }
  };
  walk(dir);
  return found.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

// Hardened runtime plus a secure timestamp are what notarization requires of every
// Mach-O. Entitlements are given to executables only: they belong to the process, so
// addons and dylibs loaded into it inherit them and need none of their own.
export function codesignArgs({ identity, file, kind, entitlements }) {
  if (!identity) throw new Error("A signing identity is required");
  return [
    "--force",
    "--sign",
    identity,
    "--options",
    "runtime",
    "--timestamp",
    ...(kind === "executable" && entitlements ? ["--entitlements", entitlements] : []),
    file,
  ];
}

export function verifyArgs(file) {
  return ["--verify", "--strict", "--verbose=2", file];
}

export function signRuntime({
  dir,
  identity,
  entitlements = runtimeEntitlementsPath,
  run = (command, args, options) => execFileSync(command, args, options),
  classify = fileMachOKind,
  env = {},
  log = console.log,
}) {
  const files = findMachOFiles(dir, classify);
  if (!files.some((file) => file.kind === "executable")) {
    throw new Error(`No Mach-O executable (the Node runtime) found under ${dir}`);
  }
  const options = { env, stdio: ["ignore", "inherit", "inherit"] };
  for (const { path, kind } of files) {
    run("/usr/bin/codesign", codesignArgs({ identity, file: path, kind, entitlements }), options);
    run("/usr/bin/codesign", verifyArgs(path), options);
  }
  log(`Signed ${files.length} Mach-O files in the staged runtime with the hardened runtime`);
  return files;
}

const present = (env, name) => Boolean(env[name]);

// Decides what to do from the environment. Throws on a half-configured setup so a typo
// can never silently downgrade a release to an unsigned or un-notarized build.
//   sign:     Developer ID signing (APPLE_SIGNING_IDENTITY, plus the certificate that the
//             workflow imports into a temporary keychain)
//   notarize: "api" (App Store Connect key), "apple-id", or "none"
export function signingPlan(env = process.env, { requireCertificate = false } = {}) {
  const certificate = ["APPLE_CERTIFICATE", "APPLE_CERTIFICATE_PASSWORD", "APPLE_SIGNING_IDENTITY"];
  const certificateSet = certificate.filter((name) => present(env, name));
  const needsAll = requireCertificate && certificateSet.length > 0;
  if (needsAll && certificateSet.length !== certificate.length) {
    throw new Error(`Incomplete Apple signing secrets: set all of ${certificate.join(", ")}`);
  }
  if (
    !requireCertificate &&
    present(env, "APPLE_CERTIFICATE") !== present(env, "APPLE_CERTIFICATE_PASSWORD")
  ) {
    throw new Error("APPLE_CERTIFICATE and APPLE_CERTIFICATE_PASSWORD must be set together");
  }
  const sign = present(env, "APPLE_SIGNING_IDENTITY");

  const api = ["APPLE_API_ISSUER", "APPLE_API_KEY"].filter((name) => present(env, name));
  const hasKeyFile = present(env, "APPLE_API_KEY_P8") || present(env, "APPLE_API_KEY_PATH");
  const apiSet = api.length + (hasKeyFile ? 1 : 0);
  const appleId = ["APPLE_ID", "APPLE_PASSWORD", "APPLE_TEAM_ID"].filter((name) =>
    present(env, name),
  );
  let notarize = "none";
  if (apiSet === 3) notarize = "api";
  else if (appleId.length === 3) notarize = "apple-id";
  else if (apiSet > 0) {
    throw new Error(
      "Incomplete notarization key: set APPLE_API_ISSUER, APPLE_API_KEY and APPLE_API_KEY_P8",
    );
  } else if (appleId.length > 0) {
    throw new Error(
      "Incomplete Apple ID notarization: set APPLE_ID, APPLE_PASSWORD and APPLE_TEAM_ID",
    );
  }
  if (notarize !== "none" && !sign) {
    throw new Error(
      "Notarization needs APPLE_SIGNING_IDENTITY: an unsigned app cannot be notarized",
    );
  }
  return { sign, notarize };
}

// The environment for the Tauri CLI. Without signing it carries no Apple variable at all
// (so the ad-hoc build is exactly what it was). With signing it carries only the
// identity and the one notarization method in use: the certificate is already in the
// keychain, so Tauri must not import it again.
export function tauriAppleEnv(env, plan) {
  const clean = { ...env };
  for (const name of appleSecretNames) delete clean[name];
  if (!plan.sign) return clean;
  const keep = ["APPLE_SIGNING_IDENTITY"];
  if (plan.notarize === "api") keep.push("APPLE_API_ISSUER", "APPLE_API_KEY", "APPLE_API_KEY_PATH");
  if (plan.notarize === "apple-id") keep.push("APPLE_ID", "APPLE_PASSWORD", "APPLE_TEAM_ID");
  for (const name of keep) if (env[name]) clean[name] = env[name];
  return clean;
}

// codesign needs a login environment (keychain lookup) but nothing else.
export function codesignEnv(env) {
  const minimal = {};
  for (const name of ["HOME", "PATH", "TMPDIR", "USER", "LOGNAME"]) {
    if (env[name] !== undefined) minimal[name] = env[name];
  }
  return minimal;
}

if (
  process.argv[1] &&
  realpathSync.native(fileURLToPath(import.meta.url)) ===
    realpathSync.native(resolve(process.argv[1]))
) {
  // `plan` prints GITHUB_OUTPUT lines for the release workflow.
  try {
    if (process.argv[2] !== "plan" || process.argv.length !== 3) {
      throw new Error("Usage: node desktop/tauri/macos-signing.mjs plan");
    }
    const { sign, notarize } = signingPlan(process.env, { requireCertificate: true });
    console.log(`sign=${sign}`);
    console.log(`notarize=${notarize}`);
    console.log(`notarized=${notarize !== "none"}`);
  } catch (error) {
    console.error(`::error::${error.message}`);
    process.exitCode = 1;
  }
}
