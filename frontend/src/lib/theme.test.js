import {
  THEMES, DEFAULT_THEME, isTheme, themeStorageKey, resolveTheme, otherTheme,
  prefersDark, readStoredTheme, storeTheme, applyTheme,
} from "./theme";

afterEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
});

describe("theme catalog", () => {
  test("exposes exactly the two themes, with light as the fallback", () => {
    expect(THEMES).toEqual(["light", "dark"]);
    expect(isTheme(DEFAULT_THEME)).toBe(true);
  });

  test("rejects anything that is not a known theme", () => {
    expect(isTheme("sepia")).toBe(false);
    expect(isTheme(null)).toBe(false);
    expect(isTheme(undefined)).toBe(false);
  });

  test("otherTheme flips", () => {
    expect(otherTheme("light")).toBe("dark");
    expect(otherTheme("dark")).toBe("light");
  });
});

describe("themeStorageKey", () => {
  test("is namespaced per user so a shared device keeps the choices apart", () => {
    expect(themeStorageKey(1)).toBe("theme:1");
    expect(themeStorageKey(2)).toBe("theme:2");
    expect(themeStorageKey(1)).not.toBe(themeStorageKey(2));
  });

  test("signed-out gets its own bucket rather than borrowing someone's", () => {
    expect(themeStorageKey(null)).toBe("theme:anon");
    expect(themeStorageKey(undefined)).toBe("theme:anon");
  });
});

describe("resolveTheme", () => {
  test("a stored choice wins over the OS preference", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  test("falls back to the OS preference when nothing is stored", () => {
    expect(resolveTheme(null, true)).toBe("dark");
    expect(resolveTheme(null, false)).toBe("light");
  });

  test("a junk stored value is treated as no choice at all", () => {
    expect(resolveTheme("neon", true)).toBe("dark");
    expect(resolveTheme("", false)).toBe("light");
  });
});

describe("prefersDark", () => {
  test("reads the media query", () => {
    expect(prefersDark({ matchMedia: () => ({ matches: true }) })).toBe(true);
    expect(prefersDark({ matchMedia: () => ({ matches: false }) })).toBe(false);
  });

  test("is false where matchMedia is missing or throws", () => {
    expect(prefersDark({})).toBe(false);
    expect(prefersDark(null)).toBe(false);
    expect(prefersDark({ matchMedia: () => { throw new Error("nope"); } })).toBe(false);
  });
});

describe("storage", () => {
  test("round-trips per user", () => {
    storeTheme(7, "dark");
    storeTheme(8, "light");
    expect(readStoredTheme(7)).toBe("dark");
    expect(readStoredTheme(8)).toBe("light");
    expect(localStorage.getItem("theme:7")).toBe("dark");
  });

  test("an unset user reads as no choice", () => {
    expect(readStoredTheme(99)).toBeNull();
  });

  test("refuses to store a value that is not a theme", () => {
    expect(storeTheme(1, "neon")).toBe(false);
    expect(localStorage.getItem("theme:1")).toBeNull();
  });

  test("survives storage that is unavailable", () => {
    const broken = {
      getItem() { throw new Error("blocked"); },
      setItem() { throw new Error("blocked"); },
    };
    expect(storeTheme(1, "dark", broken)).toBe(false);
    expect(readStoredTheme(1, broken)).toBeNull();
  });
});

describe("applyTheme", () => {
  test("stamps the theme on the root element and returns it", () => {
    expect(applyTheme("dark")).toBe("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(applyTheme("light")).toBe("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  test("an unknown theme lands on the default rather than an empty attribute", () => {
    applyTheme("neon");
    expect(document.documentElement.getAttribute("data-theme")).toBe(DEFAULT_THEME);
  });
});
