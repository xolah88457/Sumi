(function installSumiDesktop(expectedOrigin, initialPreferences, smoke, expectedPlatform, bridgeKey) {
  "use strict";
  if (window !== window.top || window.location.origin !== expectedOrigin) return;

  // Capture the native function at document start. Do not leak the frame key
  // through Tauri's public JS hooks, mutable options, or a page-supplied serializer.
  const nativeInvoke = window.__TAURI_INTERNALS__.invoke;
  const invoke = bridgeKey
    ? (command, args) => nativeInvoke(command, args, { headers: { "sumi-native-frame": bridgeKey } })
    : nativeInvoke;

  if (bridgeKey) {
    document.addEventListener("click", (event) => {
      if (!event.isTrusted || event.defaultPrevented || event.button !== 0) return;
      const link = event.composedPath().find((node) => node instanceof HTMLAnchorElement);
      if (!link || link.hasAttribute("download") || !link.hasAttribute("href")) return;
      const url = new URL(link.href);
      if (url.username || url.password) return;
      if (url.origin === expectedOrigin) {
        if (link.target.toLowerCase() === "_blank") {
          event.preventDefault();
          window.location.assign(url.href);
        }
        return;
      }
      if (!["http:", "https:", "mailto:"].includes(url.protocol)) return;
      event.preventDefault();
      void invoke("open_external", { target: url.href }).catch(() => {});
    });
  }
  // WKWebView reruns the same document-start script on reload. Prefer the last
  // native-confirmed save within this window over the original launch snapshot.
  const snapshotKey = "sumi-desktop-preferences";
  let preferences = initialPreferences;
  try {
    const saved = sessionStorage.getItem(snapshotKey);
    if (saved !== null) preferences = JSON.parse(saved);
  } catch { /* Storage can be unavailable; use the native launch snapshot. */ }
  Object.defineProperty(window, "sumiDesktop", {
    value: Object.freeze({
      preferences: Object.freeze({ ...preferences }),
      savePreferences(dict) {
        if (dict && typeof dict === "object" && !Array.isArray(dict)) {
          void invoke("save_preferences", { dict }).then((saved) => {
            try {
              sessionStorage.setItem(snapshotKey, JSON.stringify(saved));
            } catch { /* The native save already succeeded. */ }
          }).catch(() => {
            console.error("Sumi could not save desktop preferences.");
          });
        }
      },
      getInfo() {
        return invoke("runtime_info");
      },
      checkForUpdates() {
        return invoke("check_for_updates");
      },
    }),
  });

  if (smoke) {
    document.addEventListener("DOMContentLoaded", async () => {
      const checks = {};
      let error;
      try {
        const info = await window.sumiDesktop.getInfo();
        checks.runtimeInfo = info.runtime === "tauri" && !!info.tauriVersion &&
          info.platform === expectedPlatform && !!info.version;
        const keys = Object.keys(initialPreferences);
        checks.preferences = keys.length > 0 && keys.every((key) =>
          window.sumiDesktop.preferences[key] === initialPreferences[key] &&
          localStorage.getItem(key) === initialPreferences[key]);
        checks.secureContext = window.isSecureContext === true;
        checks.mediaDevices = typeof navigator.mediaDevices?.getUserMedia === "function";
        const response = await fetch("/api/health", { redirect: "error" });
        checks.health = response.ok;
        const blob = URL.createObjectURL(new Blob(["Sumi native blob download\n"], { type: "text/plain" }));
        const link = document.createElement("a");
        link.href = blob;
        link.download = "sumi-tauri-smoke.txt";
        document.body.appendChild(link);
        link.click();
        link.remove();
      } catch (cause) {
        error = String(cause).slice(0, 512);
      }
      const ok = !error && Object.keys(checks).length === 5 && Object.values(checks).every(Boolean);
      await invoke("smoke_report", { report: { ok, checks, error } });
    }, { once: true });
  }
})
