// Selectable typefaces. Everything visual reads from --g-serif (headings) and
// --g-sans (body), so switching a face here re-skins the whole app.
//
// `spec` is the Google Fonts css2 family fragment, including the axis ranges we
// actually use. Only the chosen faces get requested at runtime.
//
// The ids here are mirrored by HEADING_FONT_IDS / BODY_FONT_IDS in
// backend/server.js, which allow-lists what the settings endpoint will store.
// Adding a face here needs the same id added there or it will not save.

export const HEADING_FONTS = [
  { id: "instrument-serif", label: "Instrument Serif", stack: '"Instrument Serif", Georgia, serif', spec: "Instrument+Serif:ital@0;1" },
  { id: "fraunces",         label: "Fraunces",         stack: '"Fraunces", Georgia, serif',         spec: "Fraunces:opsz,wght@9..144,300..700" },
  { id: "playfair",         label: "Playfair Display", stack: '"Playfair Display", Georgia, serif', spec: "Playfair+Display:wght@400..700" },
  { id: "dm-serif",         label: "DM Serif Display", stack: '"DM Serif Display", Georgia, serif', spec: "DM+Serif+Display" },
  { id: "libre-baskerville",label: "Libre Baskerville",stack: '"Libre Baskerville", Georgia, serif',spec: "Libre+Baskerville:wght@400;700" },
  { id: "space-grotesk",    label: "Space Grotesk",    stack: '"Space Grotesk", system-ui, sans-serif', spec: "Space+Grotesk:wght@400..700" },
  { id: "outfit",           label: "Outfit",           stack: '"Outfit", system-ui, sans-serif',    spec: "Outfit:wght@300..700" },
];

export const BODY_FONTS = [
  { id: "dm-sans",     label: "DM Sans",     stack: '"DM Sans", system-ui, sans-serif',     spec: "DM+Sans:ital,opsz,wght@0,9..40,300..700;1,9..40,400" },
  { id: "inter",       label: "Inter",       stack: '"Inter", system-ui, sans-serif',       spec: "Inter:wght@300..700" },
  { id: "work-sans",   label: "Work Sans",   stack: '"Work Sans", system-ui, sans-serif',   spec: "Work+Sans:ital,wght@0,300..700;1,400" },
  { id: "nunito-sans", label: "Nunito Sans", stack: '"Nunito Sans", system-ui, sans-serif', spec: "Nunito+Sans:ital,opsz,wght@0,6..12,300..700;1,6..12,400" },
  { id: "source-sans", label: "Source Sans", stack: '"Source Sans 3", system-ui, sans-serif', spec: "Source+Sans+3:ital,wght@0,300..700;1,400" },
  { id: "karla",       label: "Karla",       stack: '"Karla", system-ui, sans-serif',       spec: "Karla:ital,wght@0,300..700;1,400" },
  { id: "lora",        label: "Lora",        stack: '"Lora", Georgia, serif',               spec: "Lora:ital,wght@0,400..700;1,400" },
];

export const DEFAULT_HEADING_FONT = "instrument-serif";
export const DEFAULT_BODY_FONT = "dm-sans";

export const headingFont = (id) =>
  HEADING_FONTS.find(f => f.id === id) || HEADING_FONTS.find(f => f.id === DEFAULT_HEADING_FONT);

export const bodyFont = (id) =>
  BODY_FONTS.find(f => f.id === id) || BODY_FONTS.find(f => f.id === DEFAULT_BODY_FONT);

export const isHeadingFont = (id) => HEADING_FONTS.some(f => f.id === id);
export const isBodyFont = (id) => BODY_FONTS.some(f => f.id === id);

const LINK_ID = "homehub-font-link";

/**
 * Point --g-serif / --g-sans at the chosen faces and request them. The two
 * defaults ship in index.html, so a default pairing needs no extra request.
 */
export const applyFonts = (headingId, bodyId, doc = document) => {
  const heading = headingFont(headingId);
  const body = bodyFont(bodyId);

  doc.documentElement.style.setProperty("--g-serif", heading.stack);
  doc.documentElement.style.setProperty("--g-sans", body.stack);

  const needed = [heading, body].filter(f => f.id !== DEFAULT_HEADING_FONT && f.id !== DEFAULT_BODY_FONT);
  const existing = doc.getElementById(LINK_ID);

  if (!needed.length) {
    existing?.remove();
    return { heading, body, href: null };
  }

  const href = `https://fonts.googleapis.com/css2?${needed.map(f => `family=${f.spec}`).join("&")}&display=swap`;
  if (existing) {
    if (existing.getAttribute("href") !== href) existing.setAttribute("href", href);
  } else {
    const link = doc.createElement("link");
    link.id = LINK_ID;
    link.rel = "stylesheet";
    link.href = href;
    doc.head.appendChild(link);
  }
  return { heading, body, href };
};
