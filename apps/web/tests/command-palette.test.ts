// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { CommandPalette, filterCommands, scoreCommand } from "../src/components/command-palette";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/components/add-trade-dialog", () => ({
  AddTradeDialog: ({ open }: { open?: boolean }) =>
    open ? createElement("div", { "data-testid": "add-trade" }) : null,
}));

let container: HTMLDivElement;
let root: Root;
const onOpenChange = vi.fn();
const onToggleSidebar = vi.fn();

const render = (open: boolean) =>
  act(async () =>
    root.render(
      createElement(CommandPalette, {
        open,
        onOpenChange,
        onToggleSidebar,
        filterQuery: "accounts=a1",
      }),
    ),
  );
const input = () => document.querySelector<HTMLInputElement>("[role='combobox']")!;
const options = () => [...document.querySelectorAll<HTMLElement>("[role='option']")];
const type = async (value: string) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    setter.call(input(), value);
    input().dispatchEvent(new Event("input", { bubbles: true }));
  });
};
const key = (target: EventTarget, init: KeyboardEventInit) =>
  act(async () => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }),
    );
  });

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  push.mockClear();
  onOpenChange.mockClear();
  onToggleSidebar.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("filterCommands", () => {
  const list = [
    { label: "Dashboard", keywords: "home" },
    { label: "Daily journal", keywords: "diary" },
    { label: "Trades", keywords: "executions" },
    { label: "Missed trades" },
  ];
  it("returns everything for an empty query", () => {
    expect(filterCommands(list, "  ")).toHaveLength(4);
  });
  it("ranks prefix matches ahead of later word matches", () => {
    expect(filterCommands(list, "tra").map((c) => c.label)).toEqual(["Trades", "Missed trades"]);
  });
  it("matches keywords, every word, and initials", () => {
    expect(filterCommands(list, "diary").map((c) => c.label)).toEqual(["Daily journal"]);
    expect(filterCommands(list, "missed tra").map((c) => c.label)).toEqual(["Missed trades"]);
    expect(filterCommands(list, "dj").map((c) => c.label)).toEqual(["Daily journal"]);
    expect(scoreCommand("zzz", list[0]!)).toBe(-1);
  });
});

describe("CommandPalette", () => {
  it("renders an accessible combobox and listbox when open", async () => {
    await render(true);
    expect(input().getAttribute("aria-controls")).toBe(
      document.querySelector("[role='listbox']")!.id,
    );
    expect(document.querySelector("[role='dialog']")).not.toBeNull();
    expect(options().length).toBeGreaterThan(10);
    expect(options()[0]!.getAttribute("aria-selected")).toBe("true");
    expect(input().getAttribute("aria-activedescendant")).toBe(options()[0]!.id);
  });

  it("filters as you type and reports an empty result", async () => {
    await render(true);
    await type("calend");
    expect(options().map((o) => o.textContent)).toEqual([expect.stringContaining("Calendar")]);
    await type("qqqq");
    expect(options()).toHaveLength(0);
    expect(document.body.textContent).toContain("No matching commands");
  });

  it("moves with the arrow keys and runs the active command on Enter", async () => {
    await render(true);
    await type("trades");
    await key(input(), { key: "ArrowDown" });
    expect(options()[1]!.getAttribute("aria-selected")).toBe("true");
    await key(input(), { key: "ArrowUp" });
    await key(input(), { key: "Enter" });
    expect(push).toHaveBeenCalledWith("/trades?accounts=a1");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("runs the sidebar command", async () => {
    await render(true);
    await type("sidebar");
    await key(input(), { key: "Enter" });
    expect(onToggleSidebar).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape", async () => {
    await render(true);
    await key(input(), { key: "Escape" });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("toggles from Ctrl+K and Cmd+K on the window", async () => {
    await render(false);
    await key(window, { key: "k", ctrlKey: true });
    expect(onOpenChange).toHaveBeenLastCalledWith(true);
    await key(window, { key: "k", metaKey: true });
    expect(onOpenChange).toHaveBeenCalledTimes(2);
  });

  it("opens the add trade dialog from its command", async () => {
    await render(true);
    await type("add trade");
    await key(input(), { key: "Enter" });
    expect(document.querySelector("[data-testid='add-trade']")).not.toBeNull();
    expect(push).not.toHaveBeenCalled();
  });
});
