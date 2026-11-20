import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import {
  checkApp,
  nativePackages,
  signUpdaterArtifacts,
  updaterArtifacts,
  updaterBuildArgs,
  verifyMinisign,
  verifyUpdaterSignatures,
  withoutSigningSecrets,
} from "./run.mjs";

async function fixture(t, body) {
  const dir = await mkdtemp(join(tmpdir(), "sumi-tauri-run-test-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const script = join(dir, "fake-sumi.mjs");
  const profileLog = join(dir, "profile");
  await writeFile(
    script,
    `import assert from 'node:assert/strict';
import { existsSync, realpathSync, writeFileSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
const { JOURNAL_DATA_DIR: profile, SUMI_TEST_MODE, SUMI_TAURI_SMOKE } = process.env;
assert.equal(SUMI_TEST_MODE, '1');
assert.equal(SUMI_TAURI_SMOKE, '1');
assert.equal(process.env.SUMI_SERVER_PATH, undefined);
assert.equal(process.env.TEST_SECRET, undefined);
assert.equal(realpathSync(process.cwd()), profile);
assert.equal(realpathSync(profile), profile);
assert.equal(basename(profile), 'journal');
assert.equal(process.env.TMPDIR, dirname(profile));
assert.match(basename(dirname(profile)), /^sumi-tauri-/);
assert.ok(!existsSync(join(profile, 'tauri-smoke.json')));
writeFileSync(${JSON.stringify(profileLog)}, profile);
${body}`,
  );
  return {
    check: (timeout) => checkApp(process.execPath, timeout, [script]),
    assertClean: async () =>
      assert.equal(existsSync(dirname(await readFile(profileLog, "utf8"))), false),
    profile: async () => readFile(profileLog, "utf8"),
  };
}

const report = {
  ok: true,
  checks: {
    runtimeInfo: true,
    preferences: true,
    secureContext: true,
    mediaDevices: true,
    health: true,
    nativeBlobDownload: true,
  },
};
const writeReport = (json) => `writeFileSync('tauri-smoke.json', ${JSON.stringify(json)});`;
const success = writeReport(JSON.stringify(report));

// No shell fixtures: Windows exercises the same spawn, report, and cleanup contract.
test("checks with a new canonical scratch profile each time, then cleans it up", async (t) => {
  const { check, assertClean, profile } = await fixture(t, success);
  const originals = Object.fromEntries(
    ["SUMI_SERVER_PATH", "TEST_SECRET", "JOURNAL_DATA_DIR"].map((key) => [key, process.env[key]]),
  );
  t.after(() => {
    for (const [key, value] of Object.entries(originals)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  process.env.SUMI_SERVER_PATH = "ignore-this-override";
  process.env.TEST_SECRET = "synthetic";
  process.env.JOURNAL_DATA_DIR = "ignore-this-profile";
  assert.deepEqual(await check(), report);
  const first = await profile();
  await assertClean();
  assert.deepEqual(await check(), report);
  assert.notEqual(await profile(), first);
  if (process.platform === "linux")
    assert.equal(dirname(dirname(await profile())), await realpath("/tmp"));
  await assertClean();
});

test("rejects a ready line without the UI smoke report", async (t) => {
  const { check, assertClean } = await fixture(
    t,
    'console.log("SUMI_TAURI_READY http://127.0.0.1:12345");',
  );
  await assert.rejects(check(), /exited without a valid smoke report/);
  await assertClean();
});

test("rejects invalid JSON, failed reports, and incomplete smoke", async (t) => {
  for (const [json, expected] of [
    ["{", /exited without a valid smoke report/],
    ['{"ok":false,"error":"bridge missing"}', /smoke failed\nbridge missing/],
    ['{"ok":true,"checks":{"health":true}}', /checks missing or false: .*nativeBlobDownload/],
    [
      JSON.stringify({ ...report, checks: { ...report.checks, nativeBlobDownload: false } }),
      /checks missing or false: nativeBlobDownload/,
    ],
  ]) {
    const { check, assertClean } = await fixture(t, writeReport(json));
    await assert.rejects(check(), expected);
    await assertClean();
  }
});

test("rejects abnormal exits even after the app has written a report", async (t) => {
  const { check, assertClean } = await fixture(t, `${success}\nprocess.exit(9);`);
  await assert.rejects(check(), /smoke failed: exit 9/);
  await assertClean();
});

test("times out and cleans up when the app reports but hangs instead of exiting", async (t) => {
  const { check, assertClean } = await fixture(t, `${success}\nsetInterval(() => {}, 30000);`);
  await assert.rejects(check(1_000), /timed out after 1000 ms/);
  await assertClean();
});

test("selects package formats and paths for supported host tuples only", () => {
  const config = { productName: "Sumi", mainBinaryName: "sumi", version: "1.2.3" };
  for (const [arch, dmgArch] of [
    ["arm64", "aarch64"],
    ["x64", "x64"],
  ]) {
    assert.deepEqual(nativePackages("release", config, "darwin", arch), {
      bundles: "app",
      app: join("release", "bundle", "macos", "Sumi.app"),
      installer: join("release", "bundle", "dmg", `Sumi_1.2.3_${dmgArch}.dmg`),
    });
  }
  assert.deepEqual(nativePackages("release", config, "win32", "x64"), {
    bundles: "nsis",
    app: join("release", "sumi.exe"),
    installer: join("release", "bundle", "nsis", "Sumi_1.2.3_x64-setup.exe"),
  });
  assert.deepEqual(nativePackages("release", config, "linux", "x64"), {
    bundles: "deb,appimage",
    app: join("release", "bundle", "appimage", "Sumi_1.2.3_amd64.AppImage"),
    installer: join("release", "bundle", "deb", "Sumi_1.2.3_amd64.deb"),
  });
  for (const [platform, arch] of [
    ["linux", "arm64"],
    ["win32", "arm64"],
    ["darwin", "ia32"],
    ["freebsd", "x64"],
  ]) {
    assert.throws(
      () => nativePackages("release", config, platform, arch),
      /Unsupported native Tauri target/,
    );
  }
});

test("CLI fails on missing package and does not accept extra launch arguments", () => {
  const cli = fileURLToPath(new URL("run.mjs", import.meta.url));
  for (const [args, expected] of [
    [["check", "__missing__.exe"], /Missing or empty Tauri package file/],
    [["open", "other.exe"], /Usage:/],
    [["check", "other.exe", "--ignore"], /Usage:/],
  ]) {
    assert.throws(
      () => execFileSync(process.execPath, [cli, ...args], { stdio: "pipe" }),
      (error) => {
        assert.equal(error.status, 1);
        assert.match(error.stderr.toString(), expected);
        return true;
      },
    );
  }
});

test("updater artifacts are requested only when the signing key is configured", () => {
  assert.deepEqual(updaterBuildArgs({}), []);
  assert.deepEqual(updaterBuildArgs({ TAURI_SIGNING_PRIVATE_KEY: "" }), []);
  for (const env of [
    { TAURI_SIGNING_PRIVATE_KEY: "synthetic" },
    { TAURI_SIGNING_PRIVATE_KEY_PATH: "/tmp/synthetic.key" },
  ]) {
    const [flag, json] = updaterBuildArgs(env);
    assert.equal(flag, "--config");
    assert.deepEqual(JSON.parse(json), { bundle: { createUpdaterArtifacts: true } });
  }
});

test("signing secrets are removed from the environment handed to staging", () => {
  const env = withoutSigningSecrets({
    PATH: "/usr/bin",
    TAURI_SIGNING_PRIVATE_KEY: "a",
    TAURI_SIGNING_PRIVATE_KEY_PATH: "b",
    TAURI_SIGNING_PRIVATE_KEY_PASSWORD: "c",
  });
  assert.deepEqual(env, { PATH: "/usr/bin" });
});

test("Apple signing secrets are removed from the environment handed to staging", () => {
  const apple = {
    APPLE_CERTIFICATE: "a",
    APPLE_CERTIFICATE_PASSWORD: "b",
    APPLE_SIGNING_IDENTITY: "c",
    APPLE_API_ISSUER: "d",
    APPLE_API_KEY: "e",
    APPLE_API_KEY_P8: "f",
    APPLE_API_KEY_PATH: "g",
    APPLE_ID: "h",
    APPLE_PASSWORD: "i",
    APPLE_TEAM_ID: "j",
  };
  assert.deepEqual(withoutSigningSecrets({ PATH: "/usr/bin", ...apple }), { PATH: "/usr/bin" });
});

const tauriCli = createRequire(import.meta.url).resolve("@tauri-apps/cli/tauri.js");

function cli(args, env = {}) {
  return execFileSync(process.execPath, [tauriCli, ...args], {
    env: { ...process.env, ...env },
    stdio: ["ignore", "ignore", "ignore"],
  });
}

async function keypair(dir, name, password) {
  const key = join(dir, name);
  cli(["signer", "generate", "--ci", "-w", key, "-p", password]);
  return {
    privateKey: await readFile(key, "utf8"),
    pubkey: (await readFile(`${key}.pub`, "utf8")).trim(),
  };
}

test("updaterArtifacts lists the per-platform updater archives", () => {
  const config = { productName: "Sumi", version: "1.2.3" };
  const dir = join("r", "release");
  assert.deepEqual(updaterArtifacts(dir, config, "darwin", "arm64"), [
    join(dir, "bundle", "macos", "Sumi.app.tar.gz"),
  ]);
  assert.deepEqual(updaterArtifacts(dir, config, "darwin", "x64"), [
    join(dir, "bundle", "macos", "Sumi.app.tar.gz"),
  ]);
  assert.deepEqual(updaterArtifacts(dir, config, "win32", "x64"), [
    join(dir, "bundle", "nsis", "Sumi_1.2.3_x64-setup.exe"),
  ]);
  assert.deepEqual(updaterArtifacts(dir, config, "linux", "x64"), [
    join(dir, "bundle", "appimage", "Sumi_1.2.3_amd64.AppImage"),
  ]);
  assert.throws(() => updaterArtifacts(dir, config, "linux", "arm64"), /Unsupported/);
});

test("signs with the Tauri CLI and verifies minisign signatures end to end", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "sumi-tauri-sign-test-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const password = "test-password";
  const good = await keypair(dir, "good", password);
  const other = await keypair(dir, "other", "");
  const file = join(dir, "Sumi.app.tar.gz");
  await writeFile(file, "updater payload");

  signUpdaterArtifacts([file], "1.2.3", {
    ...process.env,
    TAURI_SIGNING_PRIVATE_KEY: good.privateKey,
    TAURI_SIGNING_PRIVATE_KEY_PASSWORD: password,
  });
  assert.ok(existsSync(`${file}.sig`));
  const signature = await readFile(`${file}.sig`, "utf8");
  assert.match(Buffer.from(signature.trim(), "base64").toString(), /version:1\.2\.3/);

  assert.doesNotThrow(() => verifyUpdaterSignatures([file], good.pubkey));
  assert.equal(verifyMinisign(Buffer.from("updater payload"), signature, good.pubkey), true);

  assert.throws(() => verifyUpdaterSignatures([file], other.pubkey), /key ID does not match/);
  assert.throws(() => verifyUpdaterSignatures([file], ""), /SUMI_TAURI_UPDATER_PUBKEY is empty/);
  assert.throws(() => verifyUpdaterSignatures([file], "not a key"), /Malformed/);

  await writeFile(file, "tampered payload");
  assert.throws(() => verifyUpdaterSignatures([file], good.pubkey), /does not verify/);

  await rm(`${file}.sig`);
  assert.throws(() => verifyUpdaterSignatures([file], good.pubkey), /Missing updater signature/);
  assert.throws(
    () => signUpdaterArtifacts([join(dir, "absent")], "1.2.3", process.env),
    /Missing or empty/,
  );
});
