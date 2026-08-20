import {
  HEADING_FONTS, BODY_FONTS, headingFont, bodyFont,
  isHeadingFont, isBodyFont, applyFonts,
  DEFAULT_HEADING_FONT, DEFAULT_BODY_FONT,
} from "./fonts";

const linkEl = () => document.getElementById("homehub-font-link");
const cssVar = (name) => document.documentElement.style.getPropertyValue(name);

afterEach(() => {
  linkEl()?.remove();
  document.documentElement.style.removeProperty("--g-serif");
  document.documentElement.style.removeProperty("--g-sans");
});

describe("font catalog", () => {
  test("every entry has a unique id, a stack, and a spec", () => {
    const all = [...HEADING_FONTS, ...BODY_FONTS];
    all.forEach(f => {
      expect(f.id).toBeTruthy();
      expect(f.label).toBeTruthy();
      expect(f.stack).toMatch(/,/); // always has a fallback
      expect(f.spec).toBeTruthy();
    });
    expect(new Set(HEADING_FONTS.map(f => f.id)).size).toBe(HEADING_FONTS.length);
    expect(new Set(BODY_FONTS.map(f => f.id)).size).toBe(BODY_FONTS.length);
  });

  test("the defaults exist in their lists", () => {
    expect(isHeadingFont(DEFAULT_HEADING_FONT)).toBe(true);
    expect(isBodyFont(DEFAULT_BODY_FONT)).toBe(true);
  });

  test("an unknown id falls back to the default rather than breaking the page", () => {
    expect(headingFont("comic-sans").id).toBe(DEFAULT_HEADING_FONT);
    expect(bodyFont(undefined).id).toBe(DEFAULT_BODY_FONT);
    expect(isHeadingFont("comic-sans")).toBe(false);
  });
});

describe("applyFonts", () => {
  test("points the CSS variables at the chosen stacks", () => {
    applyFonts("fraunces", "inter");
    expect(cssVar("--g-serif")).toContain("Fraunces");
    expect(cssVar("--g-sans")).toContain("Inter");
  });

  test("requests nothing extra for the default pairing, which ships in the page", () => {
    applyFonts(DEFAULT_HEADING_FONT, DEFAULT_BODY_FONT);
    expect(linkEl()).toBeNull();
    // The variables are still set, so nothing depends on the static stylesheet.
    expect(cssVar("--g-serif")).toContain("Instrument Serif");
  });

  test("requests only the non-default face when one side changes", () => {
    applyFonts("playfair", DEFAULT_BODY_FONT);
    const href = linkEl().getAttribute("href");
    expect(href).toContain("Playfair+Display");
    expect(href).not.toContain("DM+Sans");
  });

  test("reuses a single link element across changes", () => {
    applyFonts("fraunces", "inter");
    const first = linkEl();
    applyFonts("outfit", "karla");
    const second = linkEl();
    expect(second).toBe(first);
    expect(document.querySelectorAll("#homehub-font-link")).toHaveLength(1);
    expect(second.getAttribute("href")).toContain("Outfit");
    expect(second.getAttribute("href")).not.toContain("Fraunces");
  });

  test("removes the link when returning to the defaults", () => {
    applyFonts("fraunces", "inter");
    expect(linkEl()).not.toBeNull();
    applyFonts(DEFAULT_HEADING_FONT, DEFAULT_BODY_FONT);
    expect(linkEl()).toBeNull();
  });

  test("an unknown id applies the default instead of an empty stack", () => {
    applyFonts("nonsense", "nonsense");
    expect(cssVar("--g-serif")).toContain("Instrument Serif");
    expect(cssVar("--g-sans")).toContain("DM Sans");
    expect(linkEl()).toBeNull();
  });
});
