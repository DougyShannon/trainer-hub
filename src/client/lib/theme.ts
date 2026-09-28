export type Theme = "light" | "dark" | "system";
const KEY = "trainer-hub:theme";

export function getTheme(): Theme {
  try {
    const t = localStorage.getItem(KEY);
    return t === "light" || t === "dark" ? t : "system";
  } catch {
    return "system";
  }
}

/** Switches light or dark mode for this browser; "system" follows the device again. */
export function setTheme(theme: Theme) {
  if (theme === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  try {
    if (theme === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, theme);
  } catch {
    // Storage blocked: the change lasts for this visit.
  }
  window.dispatchEvent(new Event("trainer-hub:theme"));
}
