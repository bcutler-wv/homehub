import {
  searchTermFor, matchKey, isPantryStaple, lookupMatch, rememberMatch, forgetMatch,
  buildDraftRows, byAisle, groupByAisle, toShoppingItem,
} from "./krogerMatch";

describe("searchTermFor", () => {
  test("passes through a plain ingredient name", () => {
    expect(searchTermFor("Red lentils")).toBe("Red lentils");
  });

  test("strips a leading quantity and unit", () => {
    expect(searchTermFor("2 cloves garlic")).toBe("garlic");
    expect(searchTermFor("1 lb chicken thighs")).toBe("chicken thighs");
    expect(searchTermFor("1/2 cup jasmine rice")).toBe("jasmine rice");
    expect(searchTermFor("¼ tsp turmeric")).toBe("turmeric");
  });

  test("drops parentheticals, trailing preparation, and descriptors", () => {
    expect(searchTermFor("Tomatoes (14 oz can)")).toBe("Tomatoes");
    expect(searchTermFor("garlic, minced")).toBe("garlic");
    expect(searchTermFor("2 large ripe bananas")).toBe("bananas");
    expect(searchTermFor("Fresh thyme")).toBe("thyme");
  });

  test("strips a bare leading count", () => {
    expect(searchTermFor("2 bananas")).toBe("bananas");
    expect(searchTermFor("3 eggs")).toBe("eggs");
  });

  // Known limitation: a leading number is assumed to be a count, so a product
  // whose name starts with a digit loses it. With a unit present the name
  // survives, which covers how recipes usually write it.
  test("a unit protects a name that starts with a digit", () => {
    expect(searchTermFor("1 can 7 Up")).toBe("7 Up");
    expect(searchTermFor("7 Up")).toBe("Up"); // ambiguous without a unit
  });

  test("handles empty input", () => {
    expect(searchTermFor("")).toBe("");
    expect(searchTermFor(null)).toBe("");
  });
});

describe("isPantryStaple", () => {
  test("flags staples that are not a single SKU", () => {
    expect(isPantryStaple("Salt & pepper")).toBe(true);
    expect(isPantryStaple("salt")).toBe(true);
    expect(isPantryStaple("Water")).toBe(true);
    expect(isPantryStaple("")).toBe(true);
  });

  test("does not flag real products", () => {
    expect(isPantryStaple("Red lentils")).toBe(false);
    expect(isPantryStaple("2 cloves garlic")).toBe(false);
  });
});

describe("match memory", () => {
  const product = { productId: "0001111089816", description: "Kroger® Red Lentils" };

  test("remembers and looks up by normalized term, ignoring quantity", () => {
    const matches = rememberMatch({}, "Red lentils", product);
    expect(matches["red lentils"]).toBe(product);
    // A different phrasing of the same ingredient still resolves.
    expect(lookupMatch(matches, "2 cups red lentils")).toBe(product);
    expect(lookupMatch(matches, "red lentils, rinsed")).toBe(product);
  });

  test("ignores a product with no productId", () => {
    expect(rememberMatch({}, "garlic", { description: "no id" })).toEqual({});
  });

  test("forgets a match without touching the rest", () => {
    const matches = rememberMatch(rememberMatch({}, "garlic", product), "onion", product);
    const next = forgetMatch(matches, "garlic");
    expect(next.garlic).toBeUndefined();
    expect(next.onion).toBe(product);
    // Original is untouched.
    expect(matches.garlic).toBe(product);
  });

  test("lookup misses return null", () => {
    expect(lookupMatch({}, "garlic")).toBeNull();
    expect(lookupMatch(undefined, "garlic")).toBeNull();
  });
});

describe("buildDraftRows", () => {
  test("dedupes ingredients, pre-fills matches, and flags staples", () => {
    const product = { productId: "1", description: "Kroger® Garlic" };
    const rows = buildDraftRows(
      ["2 cloves garlic", "Garlic", "Red lentils", "Salt & pepper"],
      { garlic: product }
    );

    expect(rows).toHaveLength(3); // the two garlic lines collapse
    expect(rows[0].product).toBe(product);
    expect(rows[0].term).toBe("garlic");
    expect(rows[1].product).toBeNull();
    expect(rows[2].staple).toBe(true);
    expect(rows.every(r => r.include)).toBe(true);
  });

  test("handles an empty ingredient list", () => {
    expect(buildDraftRows([], {})).toEqual([]);
    expect(buildDraftRows(undefined, {})).toEqual([]);
  });
});

describe("byAisle", () => {
  const item = (name, aisle, bay) => ({ name, kroger: aisle ? { aisle, bay } : null });

  test("orders numbered aisles numerically, not lexically", () => {
    const sorted = [item("a", "AISLE 10"), item("b", "AISLE 2")].sort(byAisle);
    expect(sorted.map(i => i.name)).toEqual(["b", "a"]);
  });

  test("puts named departments after numbered aisles and unmatched items last", () => {
    const sorted = [
      item("unmatched", null),
      item("dairy", "DAIRY"),
      item("aisle8", "AISLE 8"),
    ].sort(byAisle);
    expect(sorted.map(i => i.name)).toEqual(["aisle8", "dairy", "unmatched"]);
  });

  test("breaks ties on bay, then name", () => {
    const sorted = [
      item("z", "AISLE 8", "15"),
      item("a", "AISLE 8", "2"),
      item("m", "AISLE 8", "2"),
    ].sort(byAisle);
    expect(sorted.map(i => i.name)).toEqual(["a", "m", "z"]);
  });
});

describe("toShoppingItem", () => {
  test("carries the product metadata and the source line", () => {
    const payload = toShoppingItem(
      { productId: "1", description: "Kroger® Red Lentils", brand: "Kroger", size: "16 oz", price: 2.69, aisle: "AISLE 8", bay: "8", image: "https://img" },
      { storeId: 3, line: "2 cups red lentils", recipeId: 9 }
    );

    expect(payload.name).toBe("Kroger® Red Lentils");
    expect(payload.storeId).toBe(3);
    expect(payload.recipeId).toBe(9);
    expect(payload.sourceText).toBe("2 cups red lentils");
    expect(payload.kroger.price).toBe(2.69);
    expect(payload.kroger.aisle).toBe("AISLE 8");
  });

  test("falls back to the cleaned line when there is no product", () => {
    const payload = toShoppingItem(null, { storeId: 3, line: "2 cloves garlic" });
    expect(payload.name).toBe("garlic");
    expect(payload.kroger).toBeNull();
  });
});

describe("groupByAisle", () => {
  const item = (name, aisle, bay) => ({ name, kroger: aisle ? { aisle, bay } : null });

  test("sections the list in walk order with unlocated items last", () => {
    const groups = groupByAisle([
      item("milk", "DAIRY"),
      item("bread", null),
      item("lentils", "AISLE 8"),
      item("rice", "AISLE 2"),
      item("yogurt", "DAIRY"),
    ]);

    expect(groups.map(g => g.label)).toEqual(["AISLE 2", "AISLE 8", "DAIRY", "Not located"]);
    expect(new Set(groups.map(g => g.key)).size).toBe(groups.length);
    expect(groups[2].items.map(i => i.name)).toEqual(["milk", "yogurt"]);
    expect(groups[3].items.map(i => i.name)).toEqual(["bread"]);
  });

  test("returns nothing for an empty list", () => {
    expect(groupByAisle([])).toEqual([]);
    expect(groupByAisle(undefined)).toEqual([]);
  });
});

describe("groupByAisle label collisions", () => {
  const item = (name, aisle) => ({ name, kroger: aisle ? { aisle } : null });

  test("labels differing only in case or spacing form one section", () => {
    const groups = groupByAisle([
      item("a", "Aisle 2"),
      item("b", "AISLE 2"),
      item("c", "  aisle 2 "),
      item("d", "Dairy"),
      item("e", "DAIRY"),
    ]);

    expect(groups.map(g => g.label)).toEqual(["AISLE 2", "DAIRY"]);
    expect(groups[0].items).toHaveLength(3);
    expect(groups[1].items).toHaveLength(2);
  });

  test("an aisle literally named like the sentinel stays separate from unlocated items", () => {
    const groups = groupByAisle([item("real", "Not located"), item("none", null)]);
    expect(groups).toHaveLength(2);
    expect(new Set(groups.map(g => g.key)).size).toBe(2);
  });
});
