// Shared Kroger matching layer used by both entry points: the recipe
// "Add to list" flow in Meals and the product search on the Kroger tab in
// Shopping. Pure functions only — the network calls live in the components.

// Leading quantities and the units that usually follow them. Recipes in this
// app are often just names ("Red lentils"), but hand-entered ones carry
// amounts, and searching "2 cloves garlic" returns nothing useful.
const UNITS = [
  "cup", "cups", "tbsp", "tablespoon", "tablespoons", "tsp", "teaspoon", "teaspoons",
  "oz", "ounce", "ounces", "lb", "lbs", "pound", "pounds", "g", "gram", "grams",
  "kg", "ml", "l", "liter", "liters", "clove", "cloves", "can", "cans", "tin", "tins",
  "package", "packages", "pkg", "bunch", "bunches", "slice", "slices", "pinch",
  "handful", "jar", "jars", "bottle", "bottles", "sprig", "sprigs", "stick", "sticks",
];

// Things no one buys as a single SKU from a recipe line.
const PANTRY_STAPLES = [
  "salt", "pepper", "salt & pepper", "salt and pepper", "water", "ice",
  "salt to taste", "pepper to taste", "seasoning", "to taste",
];

const QUANTITY = new RegExp(
  `^\\s*[\\d¼½¾⅓⅔⅛]+(?:[\\s./-][\\d¼½¾⅓⅔⅛]+)*\\s*(?:${UNITS.join("|")})?\\.?\\s+`,
  "i"
);

/**
 * Reduce a recipe ingredient line to a term worth sending to product search.
 * "2 cloves garlic, minced" → "garlic"
 */
export const searchTermFor = (line) => {
  if (!line) return "";
  let term = String(line).trim();
  term = term.replace(/\([^)]*\)/g, " ");        // "(optional)", "(14 oz)"
  term = term.replace(QUANTITY, "");             // leading amount and unit
  term = term.split(",")[0];                     // "garlic, minced" → "garlic"
  term = term.replace(/\b(?:fresh|freshly|chopped|minced|diced|sliced|ground|large|small|medium|ripe|optional)\b/gi, " ");
  term = term.replace(/\s+/g, " ").trim();
  return term;
};

export const matchKey = (line) => searchTermFor(line).toLowerCase();

/** Staples that should pass through as plain text rather than blocking an add. */
export const isPantryStaple = (line) => {
  const key = matchKey(line);
  if (!key) return true;
  return PANTRY_STAPLES.includes(key);
};

export const lookupMatch = (matches, line) => (matches || {})[matchKey(line)] || null;

export const rememberMatch = (matches, line, product) => {
  const key = matchKey(line);
  if (!key || !product?.productId) return matches || {};
  return { ...(matches || {}), [key]: product };
};

export const forgetMatch = (matches, line) => {
  const key = matchKey(line);
  if (!key || !(matches || {})[key]) return matches || {};
  const next = { ...matches };
  delete next[key];
  return next;
};

/**
 * Build the working set for the add-to-list modal: one row per unique
 * ingredient, pre-filled from remembered matches, staples flagged for
 * pass-through.
 */
export const buildDraftRows = (ingredientLines, matches) => {
  const seen = new Set();
  return (ingredientLines || []).reduce((rows, line) => {
    const key = matchKey(line);
    if (!key || seen.has(key)) return rows;
    seen.add(key);
    rows.push({
      line,
      term: searchTermFor(line),
      product: lookupMatch(matches, line),
      staple: isPantryStaple(line),
      include: true,
    });
    return rows;
  }, []);
};

export const UNLOCATED = "Not located";

// Aisle labels sort as "AISLE 2" before "AISLE 10", with named departments
// (DAIRY, MEAT) after the numbered aisles and unmatched items last.
const aisleRank = (item) => {
  const aisle = String(item?.kroger?.aisle || "").trim();
  if (!aisle) return [3, 0, ""];
  const numbered = /^aisle\s+(\d+)/i.exec(aisle);
  if (numbered) return [1, parseInt(numbered[1], 10), ""];
  return [2, 0, aisle.toUpperCase()];
};

/** The section an item belongs to: stable, and matching how aisleRank compares. */
export const aisleGroupKey = (item) => {
  const [rank, num, name] = aisleRank(item);
  if (rank === 3) return "\u0000unlocated";
  if (rank === 1) return `aisle-${num}`;
  return `dept-${name}`;
};

export const byAisle = (a, b) => {
  const [ra, na, sa] = aisleRank(a);
  const [rb, nb, sb] = aisleRank(b);
  if (ra !== rb) return ra - rb;
  if (na !== nb) return na - nb;
  if (sa !== sb) return sa.localeCompare(sb);
  const bayA = parseInt(a?.kroger?.bay, 10);
  const bayB = parseInt(b?.kroger?.bay, 10);
  if (Number.isFinite(bayA) && Number.isFinite(bayB) && bayA !== bayB) return bayA - bayB;
  return String(a?.name || "").localeCompare(String(b?.name || ""));
};

/**
 * Group a Kroger list into the sections you walk: numbered aisles in order,
 * then named departments, then anything without a known location.
 */
export const groupByAisle = (items) => {
  const sorted = [...(items || [])].sort(byAisle);
  const groups = [];
  sorted.forEach(item => {
    const key = aisleGroupKey(item);
    const last = groups[groups.length - 1];
    if (last && last.key === key) { last.items.push(item); return; }
    groups.push({
      key,
      label: item?.kroger?.aisle ? item.kroger.aisle.trim().toUpperCase() : UNLOCATED,
      items: [item],
    });
  });
  return groups;
};

/** Shape a search result plus its source line into a shopping item payload. */
export const toShoppingItem = (product, { storeId, line, recipeId = null }) => ({
  storeId,
  name: product?.description || searchTermFor(line) || line,
  recipeId,
  sourceText: line,
  kroger: product
    ? {
      productId: product.productId,
      upc: product.upc || null,
      brand: product.brand || null,
      size: product.size || null,
      price: product.price ?? null,
      promoPrice: product.promoPrice ?? null,
      aisle: product.aisle || null,
      bay: product.bay || null,
      image: product.image || null,
    }
    : null,
});
