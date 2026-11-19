// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  ELECTRON_MIGRATION_BODY,
  ELECTRON_MIGRATION_DISMISS_KEY,
  ELECTRON_MIGRATION_TITLE,
  ELECTRON_MIGRATION_URL,
  ElectronMigrationBanner,
} from "../src/components/electron-migration-notice";
import { AboutSettings } from "../src/components/about-settings";
import { Shell } from "../src/components/shell";
import { TooltipProvider } from "../src/components/ui/tooltip";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("../src/components/command-palette", () => ({
  CommandPalette: () => null,
  ShortcutHint: () => null,
}));

type BridgeInfo = Record<string, unknown>;

const electronInfo = {
  version: "0.3.8",
  electronVersion: "45.2.3",
  platform: "darwin",
  arch: "arm64",
};
const tauriInfo = {
  version: "0.4.0",
  runtime: "tauri",
  tauriVersion: "2.12.0",
  platform: "darwin",
  arch: "arm64",
};

function setBridge(info: BridgeInfo) {
  (window as unknown as { sumiDesktop: unknown }).sumiDesktop = {
    preferences: {},
    savePreferences: () => {},
    getInfo: vi.fn().mockResolvedValue(info),
    checkForUpdates: vi.fn().mockResolvedValue({ status: "idle" }),
  };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  window.matchMedia ??= ((query: string) =>
    ({
      matches: false,
      media: query,
      addEventListener() {},
      removeEventListener() {},
    }) as unknown as MediaQueryList) as typeof window.matchMedia;
  sessionStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  delete (window as unknown as { sumiDesktop?: unknown }).sumiDesktop;
  sessionStorage.clear();
});

async function render(element: Parameters<Root["render"]>[0]) {
  await act(async () => root.render(element));
}

function shell() {
  return createElement(
    TooltipProvider,
    null,
    createElement(Shell, null, createElement("p", null, "page body")),
  );
}

async function remount() {
  await act(async () => root.unmount());
  root = createRoot(container);
}

describe("Electron migration banner", () => {
  it("shows the headline, body and download link under Electron", async () => {
    setBridge(electronInfo);
    await render(createElement(ElectronMigrationBanner));

    const text = container.textContent ?? "";
    expect(text).toContain(ELECTRON_MIGRATION_TITLE);
    expect(text).toContain(ELECTRON_MIGRATION_BODY);
    const link = container.querySelector<HTMLAnchorElement>("a");
    expect(link?.textContent).toContain("Download Sumi 0.4");
    expect(link?.getAttribute("href")).toBe(ELECTRON_MIGRATION_URL);
    expect(ELECTRON_MIGRATION_URL).toBe("https://github.com/xolah88457/Sumi/releases/tag/v0.4.0");
    expect(link?.getAttribute("rel")).toContain("noopener");
  });

  it("is hidden in a plain browser", async () => {
    await render(createElement(ElectronMigrationBanner));
    expect(container.textContent).toBe("");
  });

  it("is hidden in the Tauri app", async () => {
    setBridge(tauriInfo);
    await render(createElement(ElectronMigrationBanner));
    expect(container.textContent).toBe("");
  });

  it("hides on Not now and stays hidden for the session", async () => {
    setBridge(electronInfo);
    await render(createElement(ElectronMigrationBanner));
    const dismiss = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Not now",
    );
    expect(dismiss).toBeDefined();
    await act(async () => dismiss!.click());
    expect(container.textContent).toBe("");
    expect(sessionStorage.getItem(ELECTRON_MIGRATION_DISMISS_KEY)).toBe("1");

    await remount();
    await render(createElement(ElectronMigrationBanner));
    expect(container.textContent).toBe("");

    // A new launch starts with empty session storage, so the banner returns.
    sessionStorage.clear();
    await remount();
    await render(createElement(ElectronMigrationBanner));
    expect(container.textContent).toContain(ELECTRON_MIGRATION_TITLE);
  });

  it("renders in the app shell under Electron only", async () => {
    setBridge(electronInfo);
    await render(shell());
    expect(container.querySelector('[data-testid="electron-migration-banner"]')).not.toBeNull();
    expect(container.textContent).toContain("page body");

    await remount();
    setBridge(tauriInfo);
    await render(shell());
    expect(container.querySelector('[data-testid="electron-migration-banner"]')).toBeNull();
    expect(container.textContent).toContain("page body");
  });
});

describe("About section migration notice", () => {
  it("is always visible under Electron, with the download link", async () => {
    setBridge(electronInfo);
    await render(createElement(AboutSettings));
    const notice = container.querySelector('[data-testid="electron-migration-notice"]');
    expect(notice?.textContent).toContain(ELECTRON_MIGRATION_BODY);
    expect(notice?.querySelector("a")?.getAttribute("href")).toBe(ELECTRON_MIGRATION_URL);
  });

  it("is absent in the browser and in Tauri", async () => {
    await render(createElement(AboutSettings));
    expect(container.querySelector('[data-testid="electron-migration-notice"]')).toBeNull();

    await remount();
    setBridge(tauriInfo);
    await render(createElement(AboutSettings));
    expect(container.querySelector('[data-testid="electron-migration-notice"]')).toBeNull();
  });
});
