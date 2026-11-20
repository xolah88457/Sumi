// Builds the macOS .dmg ourselves instead of through Tauri's bundle_dmg.sh. On GitHub
// macOS runners `hdiutil create` intermittently fails with "Resource busy", and the
// Tauri script cannot be retried on its own. Everything touching the OS is injectable so
// the retry logic is unit tested on any platform.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

export const dmgVolumeName = "Sumi";
export const dmgMaxAttempts = 5;

export const hdiutilCreateArgs = (stage, output) => [
  "create",
  "-volname",
  dmgVolumeName,
  "-srcfolder",
  stage,
  "-fs",
  "HFS+",
  "-format",
  "UDZO",
  "-ov",
  output,
];

const defaultExec = (command, args, options = {}) =>
  execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...options });
const defaultSleep = (ms) => new Promise((done) => setTimeout(done, ms));

const stderrOf = (error) => String(error?.stderr ?? error?.message ?? error).trim();

function detachLeftovers(exec) {
  try {
    const volumes = String(exec("/bin/ls", ["/Volumes"]) ?? "")
      .split("\n")
      .filter((name) => name.startsWith(dmgVolumeName));
    for (const name of volumes) {
      try {
        exec("/usr/bin/hdiutil", ["detach", "-force", `/Volumes/${name}`]);
      } catch {
        // Best effort.
      }
    }
  } catch {
    // Best effort.
  }
}

// Creates `output` from `app` plus an Applications symlink. Returns the output path.
export async function createMacDmg({
  app,
  output,
  platform = process.platform,
  exec = defaultExec,
  sleep = defaultSleep,
  stageRoot = tmpdir(),
  log = console.log,
}) {
  if (platform !== "darwin") throw new Error("macOS dmg creation requires a darwin host");
  const stage = mkdtempSync(join(stageRoot, "sumi-dmg-"));
  try {
    exec("/usr/bin/ditto", [app, join(stage, basename(app))]);
    symlinkSync("/Applications", join(stage, "Applications"));
    mkdirSync(dirname(output), { recursive: true });
    let lastError = "";
    for (let attempt = 1; attempt <= dmgMaxAttempts; attempt++) {
      rmSync(output, { force: true });
      try {
        exec("/usr/bin/hdiutil", hdiutilCreateArgs(stage, output));
        return output;
      } catch (error) {
        lastError = stderrOf(error);
        if (attempt === dmgMaxAttempts) break;
        const wait = attempt * 10_000;
        log(
          `hdiutil create failed (attempt ${attempt}/${dmgMaxAttempts}), retrying in ${wait / 1000}s: ${lastError}`,
        );
        detachLeftovers(exec);
        await sleep(wait);
      }
    }
    throw new Error(`hdiutil create failed after ${dmgMaxAttempts} attempts: ${lastError}`);
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}

export function codesignDmg(dmg, identity, env, exec = defaultExec) {
  exec("/usr/bin/codesign", ["--force", "--sign", identity, "--timestamp", dmg], { env });
}
