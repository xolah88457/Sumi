import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  appleSecretNames,
  codesignArgs,
  codesignEnv,
  findMachOFiles,
  isMachO,
  machOKind,
  runtimeEntitlementsPath,
  signRuntime,
  signingPlan,
  tauriAppleEnv,
  verifyArgs,
} from "./macos-signing.mjs";

const pad = (bytes, length = 64) => Buffer.concat([Buffer.from(bytes), Buffer.alloc(length)]);
const thin64le = (fileType) => {
  const header = Buffer.alloc(64);
  header.writeUInt32LE(0xfeedfacf, 0);
  header.writeUInt32LE(0x0100000c, 4);
  header.writeUInt32LE(fileType, 12);
  return header;
};
const thin32be = (fileType) => {
  const header = Buffer.alloc(64);
  header.writeUInt32BE(0xfeedface, 0);
  header.writeUInt32BE(fileType, 12);
  return header;
};
const fat = (inner, offset = 4096) => {
  const header = Buffer.alloc(offset + inner.length);
  header.writeUInt32BE(0xcafebabe, 0);
  header.writeUInt32BE(2, 4);
  header.writeUInt32BE(offset, 16);
  inner.copy(header, offset);
  return header;
};
const at = (buffer) => (position, length) => buffer.subarray(position, position + length);

test("Mach-O is recognised by magic bytes, in every thin and fat flavour", () => {
  assert.equal(machOKind(thin64le(2)), "executable");
  assert.equal(machOKind(thin64le(6)), "other");
  assert.equal(machOKind(thin64le(8)), "other");
  assert.equal(machOKind(thin32be(2)), "executable");
  const bytes = fat(thin64le(2));
  assert.equal(machOKind(bytes.subarray(0, 32), at(bytes)), "executable");
  const dylib = fat(thin64le(6));
  assert.equal(machOKind(dylib.subarray(0, 32), at(dylib)), "other");
  assert.equal(isMachO(thin64le(6)), true);
});

test("other formats that look similar are not Mach-O", () => {
  const javaClass = Buffer.alloc(64);
  javaClass.writeUInt32BE(0xcafebabe, 0);
  javaClass.writeUInt32BE(52, 4);
  assert.equal(machOKind(javaClass), null);
  assert.equal(machOKind(pad([0x7f, 0x45, 0x4c, 0x46])), null, "ELF");
  assert.equal(machOKind(pad([0x4d, 0x5a])), null, "PE");
  assert.equal(machOKind(Buffer.from("#!/usr/bin/env node\nconsole.log(1)\n")), null);
  assert.equal(machOKind(Buffer.alloc(4)), null);
  assert.equal(machOKind(Buffer.alloc(0)), null);
});

test("findMachOFiles selects by content, ignores extensions and symlinks", () => {
  const dir = mkdtempSync(join(tmpdir(), "sumi-macho-"));
  try {
    mkdirSync(join(dir, "runtime", "deep"), { recursive: true });
    writeFileSync(join(dir, "runtime", "node"), thin64le(2)); // no extension
    writeFileSync(join(dir, "runtime", "deep", "addon.node"), thin64le(8));
    writeFileSync(join(dir, "runtime", "deep", "libfoo.dylib"), thin64le(6));
    writeFileSync(join(dir, "runtime", "deep", "noext-lib"), thin64le(6));
    writeFileSync(join(dir, "runtime", "fake.node"), "not a binary at all");
    writeFileSync(join(dir, "runtime", "tool.dylib"), "text pretending to be a dylib");
    writeFileSync(join(dir, "runtime", "linux.so"), pad([0x7f, 0x45, 0x4c, 0x46]));
    writeFileSync(join(dir, "runtime", "tiny"), "abc");
    symlinkSync(join(dir, "runtime", "node"), join(dir, "runtime", "node-link"));
    const found = findMachOFiles(dir).map(({ path, kind }) => [path.slice(dir.length + 1), kind]);
    assert.deepEqual(found, [
      [join("runtime", "deep", "addon.node"), "other"],
      [join("runtime", "deep", "libfoo.dylib"), "other"],
      [join("runtime", "deep", "noext-lib"), "other"],
      [join("runtime", "node"), "executable"],
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("codesign arguments use the hardened runtime and a secure timestamp", () => {
  const identity = "Developer ID Application: Example (TEAM123456)";
  assert.deepEqual(
    codesignArgs({ identity, file: "/r/node", kind: "executable", entitlements: "/e.plist" }),
    [
      "--force",
      "--sign",
      identity,
      "--options",
      "runtime",
      "--timestamp",
      "--entitlements",
      "/e.plist",
      "/r/node",
    ],
  );
  // Libraries and addons are signed without entitlements.
  assert.deepEqual(
    codesignArgs({ identity, file: "/r/a.node", kind: "other", entitlements: "/e.plist" }),
    ["--force", "--sign", identity, "--options", "runtime", "--timestamp", "/r/a.node"],
  );
  assert.throws(() => codesignArgs({ identity: "", file: "/r/a" }), /identity/);
  assert.deepEqual(verifyArgs("/r/a"), ["--verify", "--strict", "--verbose=2", "/r/a"]);
});

test("signRuntime signs and verifies every Mach-O, and refuses a runtime without Node", () => {
  const calls = [];
  const run = (command, args, options) => calls.push({ command, args, options });
  const dir = mkdtempSync(join(tmpdir(), "sumi-sign-"));
  try {
    mkdirSync(join(dir, "x"));
    for (const name of ["node", "a.node", "plain.js"])
      writeFileSync(join(dir, "x", name), "placeholder-bytes");
    const classify = (path) =>
      ({ node: "executable", "a.node": "other" })[path.split("/").pop()] ?? null;
    signRuntime({
      dir,
      identity: "ID",
      entitlements: "/e.plist",
      run,
      classify,
      env: { HOME: "/h" },
      log() {},
    });
    assert.deepEqual(
      calls.map((c) => [c.command, c.args[0]]),
      Array(4)
        .fill(0)
        .map((_, i) => ["/usr/bin/codesign", i % 2 ? "--verify" : "--force"]),
    );
    assert.ok(
      calls[0].args.includes("/e.plist") === false,
      "addon first (sorted), no entitlements",
    );
    assert.ok(calls[2].args.includes("/e.plist"), "node gets the entitlements");
    assert.deepEqual(calls[0].options.env, { HOME: "/h" });
    assert.throws(
      () => signRuntime({ dir, identity: "ID", run, classify: () => "other", log() {} }),
      /Node runtime/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("signing plan: nothing, signed only, API key and Apple ID notarization", () => {
  assert.deepEqual(signingPlan({}), { sign: false, notarize: "none" });
  assert.deepEqual(signingPlan({ APPLE_SIGNING_IDENTITY: "ID" }), { sign: true, notarize: "none" });
  const api = {
    APPLE_SIGNING_IDENTITY: "ID",
    APPLE_API_ISSUER: "i",
    APPLE_API_KEY: "k",
    APPLE_API_KEY_PATH: "/p",
  };
  assert.deepEqual(signingPlan(api), { sign: true, notarize: "api" });
  const appleId = {
    APPLE_SIGNING_IDENTITY: "ID",
    APPLE_ID: "a",
    APPLE_PASSWORD: "p",
    APPLE_TEAM_ID: "t",
  };
  assert.deepEqual(signingPlan(appleId), { sign: true, notarize: "apple-id" });
  // The App Store Connect key wins when both are configured.
  assert.equal(signingPlan({ ...appleId, ...api }).notarize, "api");
});

test("signing plan rejects half-configured setups instead of downgrading silently", () => {
  const strict = { requireCertificate: true };
  assert.deepEqual(signingPlan({}, strict), { sign: false, notarize: "none" });
  assert.throws(() => signingPlan({ APPLE_CERTIFICATE: "x" }, strict), /Incomplete Apple signing/);
  assert.throws(
    () => signingPlan({ APPLE_CERTIFICATE: "x", APPLE_CERTIFICATE_PASSWORD: "y" }, strict),
    /Incomplete Apple signing/,
  );
  assert.throws(() => signingPlan({ APPLE_CERTIFICATE: "x" }), /together/);
  assert.throws(
    () => signingPlan({ APPLE_SIGNING_IDENTITY: "ID", APPLE_API_ISSUER: "i" }),
    /Incomplete notarization key/,
  );
  assert.throws(
    () => signingPlan({ APPLE_SIGNING_IDENTITY: "ID", APPLE_ID: "a" }),
    /Incomplete Apple ID/,
  );
  assert.throws(
    () => signingPlan({ APPLE_ID: "a", APPLE_PASSWORD: "p", APPLE_TEAM_ID: "t" }),
    /unsigned app/,
  );
  const full = {
    APPLE_CERTIFICATE: "x",
    APPLE_CERTIFICATE_PASSWORD: "y",
    APPLE_SIGNING_IDENTITY: "ID",
  };
  assert.deepEqual(signingPlan(full, strict), { sign: true, notarize: "none" });
});

test("the Tauri environment carries only what the chosen method needs", () => {
  const all = Object.fromEntries(appleSecretNames.map((name) => [name, `v-${name}`]));
  const base = { PATH: "/usr/bin" };
  assert.deepEqual(tauriAppleEnv({ ...base, ...all }, { sign: false, notarize: "none" }), base);
  assert.deepEqual(tauriAppleEnv({ ...base, ...all }, { sign: true, notarize: "api" }), {
    ...base,
    APPLE_SIGNING_IDENTITY: "v-APPLE_SIGNING_IDENTITY",
    APPLE_API_ISSUER: "v-APPLE_API_ISSUER",
    APPLE_API_KEY: "v-APPLE_API_KEY",
    APPLE_API_KEY_PATH: "v-APPLE_API_KEY_PATH",
  });
  assert.deepEqual(tauriAppleEnv({ ...base, ...all }, { sign: true, notarize: "apple-id" }), {
    ...base,
    APPLE_SIGNING_IDENTITY: "v-APPLE_SIGNING_IDENTITY",
    APPLE_ID: "v-APPLE_ID",
    APPLE_PASSWORD: "v-APPLE_PASSWORD",
    APPLE_TEAM_ID: "v-APPLE_TEAM_ID",
  });
  assert.deepEqual(tauriAppleEnv({ ...base, ...all }, { sign: true, notarize: "none" }), {
    ...base,
    APPLE_SIGNING_IDENTITY: "v-APPLE_SIGNING_IDENTITY",
  });
  assert.deepEqual(codesignEnv({ ...base, ...all, HOME: "/h" }), { HOME: "/h", PATH: "/usr/bin" });
});

test("the runtime entitlements are exactly the three Node needs, each justified", () => {
  const plist = readFileSync(runtimeEntitlementsPath, "utf8");
  const keys = [...plist.matchAll(/<key>([^<]+)<\/key>\s*<true\/>/g)].map((m) => m[1]);
  assert.deepEqual(keys, [
    "com.apple.security.cs.allow-jit",
    "com.apple.security.cs.allow-unsigned-executable-memory",
    "com.apple.security.cs.disable-library-validation",
  ]);
  // Every key is preceded by an explanatory comment.
  assert.equal((plist.match(/<!--/g) ?? []).length, keys.length + 1);
  // The main app keeps its own, smaller entitlements.
  const app = readFileSync(join(runtimeEntitlementsPath, "..", "Entitlements.plist"), "utf8");
  assert.match(app, /device\.audio-input/);
  assert.doesNotMatch(app, /allow-jit|disable-library-validation/);
});
