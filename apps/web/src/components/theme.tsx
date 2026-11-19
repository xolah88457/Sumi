"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Check, Monitor, Moon, Sun } from "lucide-react";
import {
  DARK_QUERY,
  THEME_KEY,
  resolveTheme,
  themePreference,
  type Theme,
  type ThemePreference,
} from "@/lib/theme";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";

const ThemeContext = createContext({
  theme: "light" as Theme,
  preference: "system" as ThemePreference,
  ready: false,
  setPreference: (_: ThemePreference) => {},
});

export const useThemePreference = () => useContext(ThemeContext);

const systemPrefersDark = () => {
  try {
    return window.matchMedia(DARK_QUERY).matches;
  } catch {
    return false;
  }
};
const readStoredPreference = (): ThemePreference => {
  try {
    return themePreference(localStorage.getItem(THEME_KEY));
  } catch {
    return "system";
  }
};

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>("light");
  const [preference, setPreferenceState] = useState<ThemePreference>("system");
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const apply = (next: Theme) => {
    document.documentElement.classList.toggle("dark", next === "dark");
    setTheme(next);
  };
  useEffect(() => {
    // Read the pre-paint result, including its storage-unavailable fallback.
    setTheme(document.documentElement.classList.contains("dark") ? "dark" : "light");
    setPreferenceState(readStoredPreference());
    setReady(true);
    const sync = (event: StorageEvent) => {
      if (event.key === THEME_KEY || event.key === null) {
        const next = themePreference(event.newValue);
        setPreferenceState(next);
        apply(resolveTheme(next, systemPrefersDark()));
        setError("");
      }
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);
  // Follow the OS live while the user has not picked a theme.
  useEffect(() => {
    if (preference !== "system") return;
    let query: MediaQueryList;
    try {
      query = window.matchMedia(DARK_QUERY);
    } catch {
      return;
    }
    const onChange = () => apply(query.matches ? "dark" : "light");
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, [preference]);
  const setPreference = (next: ThemePreference) => {
    setPreferenceState(next);
    apply(resolveTheme(next, systemPrefersDark()));
    try {
      if (next === "system") localStorage.removeItem(THEME_KEY);
      else localStorage.setItem(THEME_KEY, next);
      setError("");
    } catch {
      setError("Appearance changed, but your browser could not save it for next time.");
    }
  };
  return (
    <ThemeContext.Provider value={{ theme, preference, ready, setPreference }}>
      {children}
      {error && (
        <p
          role="status"
          className="fixed bottom-4 right-4 z-50 max-w-[calc(100vw-32px)] rounded-xl border bg-popover px-4 py-3 text-sm text-popover-foreground shadow-popover"
        >
          {error}
        </p>
      )}
    </ThemeContext.Provider>
  );
}

const OPTIONS: { value: ThemePreference; label: string; Icon: typeof Sun }[] = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
  { value: "system", label: "System", Icon: Monitor },
];

export function ThemeToggle({
  iconOnly = false,
  className,
}: {
  iconOnly?: boolean;
  className?: string;
}) {
  const { theme, preference, ready, setPreference } = useContext(ThemeContext);
  const current = OPTIONS.find((option) => option.value === preference) ?? OPTIONS[0]!;
  const label = `Appearance: ${current.label}${preference === "system" ? ` (${theme})` : ""}`;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size={iconOnly ? "icon" : "sm"}
          className={
            iconOnly
              ? cn("shrink-0 text-muted-foreground hover:text-foreground", className)
              : cn(
                  "w-full justify-start gap-2 text-muted-foreground hover:text-foreground",
                  className,
                )
          }
          disabled={!ready}
          aria-label={label}
          title={iconOnly ? label : undefined}
        >
          {theme === "dark" ? <Moon aria-hidden="true" /> : <Sun aria-hidden="true" />}
          {!iconOnly && `Appearance: ${current.label}`}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="min-w-40">
        {OPTIONS.map(({ value, label: optionLabel, Icon }) => (
          <DropdownMenuItem key={value} onSelect={() => setPreference(value)}>
            <Icon aria-hidden="true" className="size-4" />
            {optionLabel}
            {preference === value && <Check aria-hidden="true" className="ml-auto size-4" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
