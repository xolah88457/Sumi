import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";

const source = readFileSync(new URL("./bridge.js", import.meta.url), "utf8");
const origin = "http://127.0.0.1:49152";
const portable = readFileSync(new URL("./src-tauri/src/portable.rs", import.meta.url), "utf8");
const transportScript = portable.match(/\.invoke_system\(r#"([\s\S]+?)"#\)/)[1]
  .replace("__INVOKE_KEY__", JSON.stringify("test-invoke-key"));

function setup({ actualOrigin = origin, mainFrame = true, smoke = false, session = new Map(), saveError = false, expectedPlatform = "darwin", actualPlatform = expectedPlatform } = {}) {
  const calls = [];
  const info = { runtime: "tauri", tauriVersion: "2.12.5", platform: actualPlatform, version: "0.3.7" };
  const initial = { "journal-theme-v1": "dark" };
  const window = {
    location: { origin: actualOrigin },
    isSecureContext: true,
    __TAURI_INTERNALS__: {
      async invoke(command, args, options) {
        calls.push([command, args, options]);
        if (command === "runtime_info") return info;
        if (command === "save_preferences") {
          if (saveError) throw new Error("save failed");
          return Object.fromEntries(Object.entries(args.dict).filter(([key]) => key.startsWith("journal-")));
        }
      },
    },
  };
  window.top = mainFrame ? window : {};
  let ready;
  const anchor = { click() { calls.push(["download", this.download, this.href]); }, remove() {} };
  const document = {
    addEventListener(name, cb) {
      if (name === "DOMContentLoaded") ready = cb;
      else assert.equal(name, "click");
    },
    createElement(name) { assert.equal(name, "a"); return anchor; },
    body: { appendChild(el) { assert.equal(el, anchor); } },
  };
  const bridgeKey = expectedPlatform === "darwin" ? null : "test-frame-key";
  runInNewContext(`(${source})(origin, initial, smoke, expectedPlatform, bridgeKey);`, {
    window, document, origin, initial, smoke, expectedPlatform, bridgeKey, Blob,
    URL: { createObjectURL: (blob) => { assert.equal(blob.size, 26); return "blob:sumi"; } },
    localStorage: { getItem: (key) => initial[key] },
    sessionStorage: { getItem: (key) => session.get(key) ?? null, setItem: (key, value) => session.set(key, value) },
    console: { error() {} },
    navigator: { mediaDevices: { getUserMedia() {} } },
    async fetch(path) { assert.equal(path, "/api/health"); return { ok: true }; },
  });
  return { window, ready, calls, initial, info };
}

test("bridge is unavailable to an iframe or a different origin", () => {
  for (const expectedPlatform of ["darwin", "linux", "win32"]) {
    for (const options of [{ mainFrame: false }, { actualOrigin: origin.replace("49152", "49153") }]) {
      const { window, ready, calls } = setup({ ...options, smoke: true, expectedPlatform });
      assert.equal(window.sumiDesktop, undefined);
      assert.equal(ready, undefined);
      assert.deepEqual(calls, []);
    }
  }
});

test("portable IPC binds native transport and serializes the frame key outside page payloads", () => {
  for (const platform of ["linux", "win32"]) {
    const messages = [];
    const transport = { postMessage(message) { messages.push(JSON.parse(message)); } };
    const window = {
      __TAURI_INTERNALS__: {},
      ...(platform === "win32" ? { chrome: { webview: transport } } : { webkit: { messageHandlers: { ipc: transport } } }),
    };
    window.top = {};
    runInNewContext(transportScript, { window });
    assert.equal(window.__TAURI_INTERNALS__.postMessage, undefined);
    window.top = window;
    runInNewContext(transportScript, { window });
    transport.postMessage = () => assert.fail("mutable transport was used");
    const payload = { toJSON() { return { dict: { "journal-theme-v1": "dark" } }; } };
    window.__TAURI_INTERNALS__.postMessage({
      cmd: "save_preferences", callback: 1, error: 2, payload,
      options: { headers: { "sumi-native-frame": "test-frame-key" } },
    });
    assert.deepEqual(messages, [{
      cmd: "save_preferences", callback: 1, error: 2,
      payload: { dict: { "journal-theme-v1": "dark" } },
      __TAURI_INVOKE_KEY__: "test-invoke-key",
      options: { customProtocolIpcBlocked: true, headers: { "sumi-native-frame": "test-frame-key" } },
    }]);
  }
});

test("bridge exposes frozen startup preferences and only the desktop contract", async () => {
  const { window, ready, calls, initial, info } = setup();
  const api = window.sumiDesktop;
  assert.equal(ready, undefined);
  assert.ok(Object.isFrozen(api));
  assert.ok(Object.isFrozen(api.preferences));
  assert.deepEqual({ ...api.preferences }, initial);
  assert.deepEqual(Object.keys(api), ["preferences", "savePreferences", "getInfo", "checkForUpdates"]);
  api.savePreferences(null);
  api.savePreferences([]);
  assert.equal(api.savePreferences(initial), undefined);
  assert.equal(await api.getInfo(), info);
  await api.checkForUpdates();
  assert.deepEqual(calls.map(([command]) => command), ["save_preferences", "runtime_info", "check_for_updates"]);
  assert.equal(calls[0][1].dict, initial);
});

test("reload uses the last native-confirmed preferences, not the launch snapshot or a failed save", async () => {
  const session = new Map();
  const first = setup({ session });
  first.window.sumiDesktop.savePreferences({ "journal-theme-v1": "light", ignored: "value" });
  await Promise.resolve();
  const reloaded = setup({ session, saveError: true });
  assert.deepEqual({ ...reloaded.window.sumiDesktop.preferences }, { "journal-theme-v1": "light" });
  reloaded.window.sumiDesktop.savePreferences({ "journal-theme-v1": "system" });
  await Promise.resolve();
  assert.deepEqual({ ...setup({ session }).window.sumiDesktop.preferences }, { "journal-theme-v1": "light" });
});

test("smoke requests a synthetic blob download and reports page checks on all platforms", async () => {
  for (const expectedPlatform of ["darwin", "linux", "win32"]) {
    const { ready, calls } = setup({ smoke: true, expectedPlatform });
    await ready();
    assert.deepEqual(calls.map(([command]) => command), ["runtime_info", "download", "smoke_report"]);
    assert.deepEqual(calls[1], ["download", "sumi-tauri-smoke.txt", "blob:sumi"]);
    const { report } = calls[2][1];
    assert.equal(report.ok, true);
    assert.deepEqual({ ...report.checks }, {
      runtimeInfo: true, preferences: true, secureContext: true, mediaDevices: true, health: true,
    });
    const frame = calls[0][2]?.headers["sumi-native-frame"];
    assert.equal(frame, expectedPlatform === "darwin" ? undefined : "test-frame-key");
  }
});

test("smoke rejects runtime info from the wrong platform", async () => {
  const { ready, calls } = setup({ smoke: true, expectedPlatform: "linux", actualPlatform: "darwin" });
  await ready();
  assert.equal(calls[2][1].report.ok, false);
  assert.equal(calls[2][1].report.checks.runtimeInfo, false);
});
