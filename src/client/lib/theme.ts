export type Theme = "light" | "dark" | "system";
const KEY = "trainer-hub:theme";
const darkQuery = () => window.matchMedia?.("(prefers-color-scheme: dark)");

export function getTheme(): Theme {
  try {
    const t = localStorage.getItem(KEY);
    return t === "light" || t === "dark" ? t : "system";
  } catch {
    return "system";
  }
}

/**
 * Puts the look actually in use on <html data-mode="light|dark">, which the stylesheet reads.
 * (index.html does the same before the page draws, so there's no flash of the wrong colours.)
 */
function applyMode(theme: Theme) {
  const dark = theme === "dark" || (theme === "system" && !!darkQuery()?.matches);
  document.documentElement.dataset.mode = dark ? "dark" : "light";
}

// Follow the device when it switches between light and dark, unless the trainer picked one.
darkQuery()?.addEventListener?.("change", () => applyMode(getTheme()));

/** Switches light or dark mode for this browser; "system" follows the device again. */
export function setTheme(theme: Theme) {
  try {
    if (theme === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, theme);
  } catch {
    // Storage blocked: the change lasts for this visit.
  }
  applyMode(theme);
  window.dispatchEvent(new Event("trainer-hub:theme"));
}
