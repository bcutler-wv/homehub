// Light/dark switching. Every colour the app paints comes from a design token
// in App.css, so a theme is just a value of `data-theme` on <html> — nothing
// component-level has to know which one is active.
//
// The choice is per user *per device*: two people sharing a tablet each get
// their own, and it needs no backend round-trip to take effect on load.

export const THEMES = ["light", "dark"];
export const DEFAULT_THEME = "light";

export const isTheme = (value) => THEMES.includes(value);

/** Anonymous gets its own bucket so the login screen doesn't inherit a stranger's pick. */
export const themeStorageKey = (userId) => `theme:${userId ?? "anon"}`;

/** A stored choice always wins; otherwise follow the OS. */
export const resolveTheme = (stored, prefersDark) =>
  isTheme(stored) ? stored : (prefersDark ? "dark" : "light");

export const otherTheme = (theme) => (theme === "dark" ? "light" : "dark");

export const prefersDark = (win = typeof window === "undefined" ? null : window) => {
  try {
    return !!win?.matchMedia?.("(prefers-color-scheme: dark)")?.matches;
  } catch {
    return false;
  }
};

export const readStoredTheme = (userId, storage = safeStorage()) => {
  try {
    const value = storage?.getItem(themeStorageKey(userId));
    return isTheme(value) ? value : null;
  } catch {
    return null;
  }
};

export const storeTheme = (userId, theme, storage = safeStorage()) => {
  if (!isTheme(theme)) return false;
  try {
    storage?.setItem(themeStorageKey(userId), theme);
    return true;
  } catch {
    // Private-mode / quota failures shouldn't stop the theme from applying.
    return false;
  }
};

export const applyTheme = (theme, doc = document) => {
  const next = isTheme(theme) ? theme : DEFAULT_THEME;
  doc.documentElement.setAttribute("data-theme", next);
  return next;
};

function safeStorage() {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}
