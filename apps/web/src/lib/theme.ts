/** What is applied to the page. */
export type Theme = "dark" | "light";
/** What the user chose. "system" (nothing stored) follows the OS until they pick. */
export type ThemePreference = Theme | "system";
export const THEME_KEY = "journal-theme-v1";
export const DARK_QUERY = "(prefers-color-scheme: dark)";

export const themePreference = (value: string | null): ThemePreference =>
  value === "dark" || value === "light" ? value : "system";

export const resolveTheme = (preference: ThemePreference, systemDark: boolean): Theme =>
  preference === "system" ? (systemDark ? "dark" : "light") : preference;

// Apply saved preferences before paint. With no saved choice the OS decides;
// if storage or matchMedia is unavailable the page falls back to light paper.
export const THEME_INIT_SCRIPT = `(()=>{let p="system";try{const v=localStorage.getItem(${JSON.stringify(THEME_KEY)});if(v==="dark"||v==="light")p=v}catch{}let dark=p==="dark";if(p==="system"){try{dark=matchMedia(${JSON.stringify(DARK_QUERY)}).matches}catch{}}document.documentElement.classList.toggle("dark",dark)})();`;
