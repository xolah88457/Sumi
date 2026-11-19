// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { DensityToggle } from "../src/components/density-toggle";
import {
  TABLE_DENSITY_KEY,
  readTableDensity,
  useTableDensity,
  writeTableDensity,
} from "../src/lib/table-density";

function Harness() {
  const [density, setDensity] = useTableDensity();
  return createElement(
    "div",
    { "data-testid": "wrap", "data-density": density },
    createElement(DensityToggle, { value: density, onChange: setDensity }),
  );
}

let container: HTMLDivElement, root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  localStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  writeTableDensity("comfortable");
});
const wrap = () => container.querySelector<HTMLElement>("[data-testid=wrap]")!;
const button = (name: string) =>
  [...container.querySelectorAll("button")].find((b) => b.textContent === name)!;

it("defaults to comfortable and ignores unknown stored values", () => {
  expect(readTableDensity()).toBe("comfortable");
  localStorage.setItem(TABLE_DENSITY_KEY, "tiny");
  expect(readTableDensity()).toBe("comfortable");
});

it("switches the wrapper attribute and persists the choice", async () => {
  await act(async () => root.render(createElement(Harness)));
  expect(wrap().dataset.density).toBe("comfortable");
  expect(button("Comfortable").getAttribute("aria-pressed")).toBe("true");
  await act(async () => button("Compact").click());
  expect(wrap().dataset.density).toBe("compact");
  expect(button("Compact").getAttribute("aria-pressed")).toBe("true");
  expect(localStorage.getItem(TABLE_DENSITY_KEY)).toBe("compact");
});

it("restores a stored choice on mount", async () => {
  localStorage.setItem(TABLE_DENSITY_KEY, "compact");
  await act(async () => root.render(createElement(Harness)));
  expect(wrap().dataset.density).toBe("compact");
});

it("still works for the session when storage throws", async () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  await act(async () => root.render(createElement(Harness)));
  await act(async () => button("Compact").click());
  expect(wrap().dataset.density).toBe("compact");
});
