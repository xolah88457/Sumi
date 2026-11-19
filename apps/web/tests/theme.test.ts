import { describe, expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import { THEME_INIT_SCRIPT, THEME_KEY, resolveTheme, themePreference } from "../src/lib/theme";

const run = (saved: string | null | "throw", systemDark: boolean | "throw") => {
  const calls: unknown[] = [];
  runInNewContext(THEME_INIT_SCRIPT, {
    localStorage: {
      getItem: (key: string) => {
        expect(key).toBe(THEME_KEY);
        if (saved === "throw") throw new Error("blocked");
        return saved;
      },
    },
    matchMedia: (query: string) => {
      expect(query).toBe("(prefers-color-scheme: dark)");
      if (systemDark === "throw") throw new Error("unsupported");
      return { matches: systemDark };
    },
    document: {
      documentElement: { classList: { toggle: (...args: unknown[]) => calls.push(args) } },
    },
  });
  return calls;
};

describe("journal appearance", () => {
  it("follows the OS until the user picks a theme", () => {
    expect(themePreference(null)).toBe("system");
    expect(themePreference("system")).toBe("system");
    expect(themePreference("invalid")).toBe("system");
    expect(themePreference("dark")).toBe("dark");
    expect(themePreference("light")).toBe("light");
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });
  it.each([
    [null, true, true],
    [null, false, false],
    ["invalid", true, true],
    ["dark", false, true],
    ["light", true, false],
  ] as const)("applies %s with OS dark=%s before hydration", (saved, systemDark, expected) => {
    expect(run(saved, systemDark)).toEqual([["dark", expected]]);
  });
  it("falls back to light paper when storage and matchMedia are blocked", () => {
    expect(run("throw", "throw")).toEqual([["dark", false]]);
  });
  it("still follows the OS when browser storage is blocked", () => {
    expect(run("throw", true)).toEqual([["dark", true]]);
  });
});
