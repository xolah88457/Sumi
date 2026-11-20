import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { codesignDmg, createMacDmg, hdiutilCreateArgs } from "./macos-dmg.mjs";

const busy = () => {
  throw Object.assign(new Error("failed"), { stderr: "hdiutil: create failed - Resource busy\n" });
};

function harness(failures) {
  const root = mkdtempSync(join(tmpdir(), "dmg-test-"));
  const calls = [];
  const sleeps = [];
  const logs = [];
  let creates = 0;
  let stage;
  const exec = (command, args) => {
    calls.push([command, args]);
    if (command === "/usr/bin/hdiutil" && args[0] === "create") {
      stage = args[args.indexOf("-srcfolder") + 1];
      if (++creates <= failures) busy();
    }
    if (command === "/bin/ls") return "Sumi 1\nOther\nSumi\n";
    return "";
  };
  const opts = {
    app: "/x/Sumi.app",
    output: join(root, "dmg", "Sumi_1_x64.dmg"),
    platform: "darwin",
    exec,
    sleep: async (ms) => void sleeps.push(ms),
    stageRoot: root,
    log: (m) => logs.push(m),
  };
  return { opts, calls, sleeps, logs, root, stage: () => stage };
}

test("retries hdiutil create and succeeds on the third attempt", async (t) => {
  const h = harness(2);
  t.after(() => rmSync(h.root, { recursive: true, force: true }));
  assert.equal(await createMacDmg(h.opts), h.opts.output);
  const creates = h.calls.filter(([, a]) => a[0] === "create");
  assert.equal(creates.length, 3);
  assert.deepEqual(h.sleeps, [10_000, 20_000]);
  assert.equal(h.logs.length, 2);
  assert.match(h.logs[0], /attempt 1\/5.*Resource busy/);
  const detaches = h.calls.filter(([, a]) => a[0] === "detach").map(([, a]) => a.join(" "));
  assert.deepEqual(detaches, [
    "detach -force /Volumes/Sumi 1",
    "detach -force /Volumes/Sumi",
    "detach -force /Volumes/Sumi 1",
    "detach -force /Volumes/Sumi",
  ]);
  assert.deepEqual(creates[0][1], hdiutilCreateArgs(h.stage(), h.opts.output));
  assert.deepEqual(h.calls[0], ["/usr/bin/ditto", ["/x/Sumi.app", join(h.stage(), "Sumi.app")]]);
  assert.equal(existsSync(h.stage()), false);
});

test("hdiutil arguments are exact", () => {
  assert.deepEqual(hdiutilCreateArgs("/s", "/o.dmg"), [
    "create",
    "-volname",
    "Sumi",
    "-srcfolder",
    "/s",
    "-fs",
    "HFS+",
    "-format",
    "UDZO",
    "-ov",
    "/o.dmg",
  ]);
});

test("throws with the last stderr after five failed attempts", async (t) => {
  const h = harness(99);
  t.after(() => rmSync(h.root, { recursive: true, force: true }));
  await assert.rejects(
    createMacDmg(h.opts),
    /after 5 attempts: hdiutil: create failed - Resource busy/,
  );
  assert.equal(h.calls.filter(([, a]) => a[0] === "create").length, 5);
  assert.deepEqual(h.sleeps, [10_000, 20_000, 30_000, 40_000]);
  assert.equal(existsSync(h.stage()), false);
});

test("does nothing off darwin", async () => {
  const h = harness(0);
  await assert.rejects(createMacDmg({ ...h.opts, platform: "linux" }), /darwin/);
  assert.equal(h.calls.length, 0);
  rmSync(h.root, { recursive: true, force: true });
});

test("codesigns the dmg with timestamp and the given environment", () => {
  const seen = [];
  codesignDmg("/o.dmg", "Developer ID X", { HOME: "/h" }, (...a) => seen.push(a));
  assert.deepEqual(seen, [
    [
      "/usr/bin/codesign",
      ["--force", "--sign", "Developer ID X", "--timestamp", "/o.dmg"],
      { env: { HOME: "/h" } },
    ],
  ]);
});
