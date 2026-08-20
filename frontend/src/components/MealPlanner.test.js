import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import MealPlanner, { parseIngredients } from "./MealPlanner";
import { getWeekDays } from "../lib/utils";

describe("parseIngredients", () => {
  test("prefers one ingredient per non-empty line", () => {
    expect(parseIngredients("Pasta\n\nTomatoes\n Garlic ")).toEqual([
      "Pasta",
      "Tomatoes",
      "Garlic",
    ]);
  });

  test("falls back to comma-separated ingredients for single-line recipes", () => {
    expect(parseIngredients("Milk, eggs, flour,, sugar ")).toEqual([
      "Milk",
      "eggs",
      "flour",
      "sugar",
    ]);
  });

  test("returns an empty list for blank input", () => {
    expect(parseIngredients("   ")).toEqual([]);
    expect(parseIngredients(null)).toEqual([]);
  });
});

describe("cookbook density", () => {
  const RECIPES = [
    { id: 1, name: "Roast chicken", description: "lemon & thyme", category: "Meat", cookTime: 80, servings: 5, image: "data:image/png;base64,AAA", isFavourite: true },
    { id: 2, name: "Shakshuka", description: "spiced tomato", category: "Veg", cookTime: 25, servings: 2, image: null },
  ];

  const renderCookbook = () => render(
    <MealPlanner
      recipes={RECIPES}
      setRecipes={jest.fn()}
      mealPlan={{}}
      setMealPlan={jest.fn()}
      shopping={{ stores: [], items: [] }}
      setShopping={jest.fn()}
      apiEnabled={false}
      queueMutation={jest.fn()}
      showToast={jest.fn()}
    />
  );

  beforeEach(() => { localStorage.clear(); });

  test("defaults to cards, which show recipe images", () => {
    const { container } = renderCookbook();
    expect(container.querySelector(".cookbook-grid")).toBeInTheDocument();
    expect(container.querySelector(".cookbook-list")).toBeNull();
    expect(screen.getByAltText("Roast chicken")).toBeInTheDocument();
  });

  test("list view drops the image section but keeps the recipes", () => {
    const { container } = renderCookbook();

    fireEvent.click(screen.getByRole("button", { name: "List" }));

    expect(container.querySelector(".cookbook-list")).toBeInTheDocument();
    expect(container.querySelectorAll(".cookbook-row")).toHaveLength(2);
    expect(screen.queryByAltText("Roast chicken")).not.toBeInTheDocument();
    expect(screen.getByText("Roast chicken")).toBeInTheDocument();
    expect(screen.getByText("Shakshuka")).toBeInTheDocument();
  });

  test("the choice persists across a remount", () => {
    const first = renderCookbook();
    fireEvent.click(screen.getByRole("button", { name: "List" }));
    first.unmount();

    const { container } = renderCookbook();
    expect(container.querySelector(".cookbook-list")).toBeInTheDocument();
  });

  test("favouriting from a list row does not open the recipe", () => {
    renderCookbook();
    fireEvent.click(screen.getByRole("button", { name: "List" }));

    fireEvent.click(screen.getByRole("button", { name: /Unfavourite Roast chicken/ }));
    // The detail sidebar would render the instructions heading; it must not open.
    expect(screen.queryByText("Ingredients")).not.toBeInTheDocument();
  });
});

describe("add to list targets Kroger", () => {
  const RECIPE = {
    id: 1, name: "Red lentil curry", description: "coconut dahl", category: "Veg",
    cookTime: 30, servings: 4, image: null,
    ingredients: "Red lentils\nCoconut milk\nSalt & pepper",
    instructions: "Simmer.",
  };
  const KROGER = { id: 7, name: "Kroger", vendor: "kroger" };
  const SAMS = { id: 8, name: "Sam's Club", vendor: null };

  const LENTILS = {
    productId: "0001111089816", description: "Kroger® Red Lentils", brand: "Kroger",
    size: "16 oz", price: 2.69, aisle: "AISLE 8", bay: "8", image: null,
  };

  const mockApi = ({ configured = true, matches = {} } = {}) => {
    global.fetch = jest.fn((url, options) => {
      const u = String(url);
      const reply = (body) => Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
      if (u.includes("/api/kroger/status")) return reply({ configured, locationId: "02900788" });
      if (u.includes("/api/kroger/matches") && (!options || options.method !== "POST")) return reply(matches);
      if (u.includes("/api/kroger/matches")) return reply({ ok: true });
      if (u.includes("/api/kroger/search")) {
        return reply({ products: u.includes("lentils") ? [LENTILS] : [] });
      }
      if (u.includes("/api/shopping/items")) {
        return reply({ ...JSON.parse(options.body), id: Math.floor(Math.random() * 1e6), checked: false });
      }
      return reply({});
    });
  };

  afterEach(() => { delete global.fetch; });

  const renderMeals = (stores, setShopping = jest.fn()) => render(
    <MealPlanner
      recipes={[RECIPE]}
      setRecipes={jest.fn()}
      mealPlan={{}}
      setMealPlan={jest.fn()}
      shopping={{ stores, items: [] }}
      setShopping={setShopping}
      apiEnabled
      queueMutation={jest.fn()}
      showToast={jest.fn()}
    />
  );

  const openRecipeAndAdd = async () => {
    fireEvent.click(screen.getByText("Red lentil curry"));
    fireEvent.click(await screen.findByRole("button", { name: "Add to list" }));
  };

  test("resolves ingredients to products and skips the store picker", async () => {
    mockApi();
    renderMeals([SAMS, KROGER]);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());

    await openRecipeAndAdd();

    // Kroger is the fixed target, so no store dropdown is offered.
    expect(await screen.findByText("Add to Kroger")).toBeInTheDocument();
    expect(screen.queryByText("Target store")).not.toBeInTheDocument();

    // The matched product replaces the raw ingredient text.
    expect(await screen.findByText("Kroger® Red Lentils")).toBeInTheDocument();
    expect(screen.getByText("$2.69")).toBeInTheDocument();
    expect(screen.getByText("AISLE 8 · bay 8")).toBeInTheDocument();
  });

  test("a pantry staple is flagged for plain text rather than matched", async () => {
    mockApi();
    renderMeals([KROGER]);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    await openRecipeAndAdd();

    expect(await screen.findByText("pantry staple · added as text")).toBeInTheDocument();
    // Nothing was searched for it.
    const searched = global.fetch.mock.calls.map(c => String(c[0])).filter(u => u.includes("/api/kroger/search"));
    expect(searched.some(u => u.includes("pepper"))).toBe(false);
  });

  test("an ingredient with no match falls through as text instead of blocking", async () => {
    mockApi();
    renderMeals([KROGER]);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    await openRecipeAndAdd();

    expect(await screen.findByText("no match · added as text")).toBeInTheDocument();
  });

  test("remembered matches are reused without searching again", async () => {
    mockApi({ matches: { "red lentils": LENTILS } });
    renderMeals([KROGER]);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    await openRecipeAndAdd();

    expect(await screen.findByText("Kroger® Red Lentils")).toBeInTheDocument();
    const searched = global.fetch.mock.calls.map(c => String(c[0])).filter(u => u.includes("/api/kroger/search"));
    expect(searched.some(u => u.includes("lentils"))).toBe(false);
  });

  test("falls back to the store picker when the API is not configured", async () => {
    mockApi({ configured: false });
    renderMeals([KROGER]);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    await openRecipeAndAdd();

    expect(await screen.findByText("Target store")).toBeInTheDocument();
    expect(screen.queryByText("Add to Kroger")).not.toBeInTheDocument();
  });

  test("falls back to the store picker when there is no Kroger store", async () => {
    mockApi();
    renderMeals([SAMS]);
    await openRecipeAndAdd();

    expect(await screen.findByText("Target store")).toBeInTheDocument();
  });
});

describe("kroger draft correctness", () => {
  const KROGER = { id: 7, name: "Kroger", vendor: "kroger" };
  const LENTILS = {
    productId: "0001111089816", description: "Kroger® Red Lentils", brand: "Kroger",
    size: "16 oz", price: 2.69, aisle: "AISLE 8", bay: "8", image: null,
  };

  const posts = () => global.fetch.mock.calls
    .filter(([, o]) => o?.method === "POST")
    .map(([u, o]) => ({ url: String(u), body: JSON.parse(o.body) }));

  const mockApi = () => {
    global.fetch = jest.fn((url, options) => {
      const u = String(url);
      const reply = (body) => Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
      if (u.includes("/api/kroger/status")) return reply({ configured: true, locationId: "02900788" });
      if (u.includes("/api/kroger/matches") && options?.method !== "POST") return reply({});
      if (u.includes("/api/kroger/matches")) return reply({ ok: true });
      if (u.includes("/api/kroger/search")) return reply({ products: u.includes("lentils") ? [LENTILS] : [] });
      if (u.includes("/api/shopping/items")) return reply({ ...JSON.parse(options.body), id: 1, checked: false });
      return reply({});
    });
  };

  afterEach(() => { delete global.fetch; });

  test("ingredients keep their own recipe when two recipes share one", async () => {
    // Recipe A's two garlic lines collapse into one row, so a positional join
    // would hand Red lentils recipe A's id instead of recipe B's.
    const A = { id: 1, name: "Garlic bread", ingredients: "2 cloves garlic\ngarlic, minced", image: null };
    const B = { id: 2, name: "Dahl", ingredients: "Red lentils", image: null };
    const days = getWeekDays();
    mockApi();

    render(
      <MealPlanner
        recipes={[A, B]}
        setRecipes={jest.fn()}
        mealPlan={{ [days[0].key]: { recipeId: 1 }, [days[1].key]: { recipeId: 2 } }}
        setMealPlan={jest.fn()}
        shopping={{ stores: [KROGER], items: [] }}
        setShopping={jest.fn()}
        apiEnabled
        queueMutation={jest.fn()}
        showToast={jest.fn()}
      />
    );
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    // Let the status probe settle so the Kroger flow is armed before clicking.
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByRole("button", { name: /Add week ingredients/i }));
    await screen.findByText("Add to Kroger");
    await waitFor(() => expect(screen.getByRole("button", { name: /^Add \d/ })).toBeEnabled());

    fireEvent.click(screen.getByRole("button", { name: /^Add \d/ }));

    await waitFor(() => expect(posts().some(p => p.url.includes("/api/shopping/items"))).toBe(true));
    const lentils = posts().find(p => p.url.includes("/api/shopping/items") && /lentil/i.test(p.body.name));
    expect(lentils.body.recipeId).toBe(2);
  });

  test("a confirmed pick is remembered under the normalized term", async () => {
    const recipe = { id: 1, name: "Dahl", ingredients: "2 cups red lentils", image: null };
    mockApi();

    render(
      <MealPlanner
        recipes={[recipe]} setRecipes={jest.fn()} mealPlan={{}} setMealPlan={jest.fn()}
        shopping={{ stores: [KROGER], items: [] }} setShopping={jest.fn()}
        apiEnabled queueMutation={jest.fn()} showToast={jest.fn()}
      />
    );
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());

    fireEvent.click(screen.getByText("Dahl"));
    fireEvent.click(await screen.findByRole("button", { name: "Add to list" }));
    await screen.findByText("Add to Kroger");

    // The auto-suggestion alone must not be remembered.
    await waitFor(() => expect(screen.getByRole("button", { name: "Change" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /^Add \d/ }));
    await waitFor(() => expect(posts().some(p => p.url.includes("/api/shopping/items"))).toBe(true));
    expect(posts().some(p => p.url.includes("/api/kroger/matches"))).toBe(false);
  });

  test("an explicit pick is remembered, keyed for later lookup", async () => {
    const recipe = { id: 1, name: "Dahl", ingredients: "2 cups red lentils", image: null };
    mockApi();

    render(
      <MealPlanner
        recipes={[recipe]} setRecipes={jest.fn()} mealPlan={{}} setMealPlan={jest.fn()}
        shopping={{ stores: [KROGER], items: [] }} setShopping={jest.fn()}
        apiEnabled queueMutation={jest.fn()} showToast={jest.fn()}
      />
    );
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());

    fireEvent.click(screen.getByText("Dahl"));
    fireEvent.click(await screen.findByRole("button", { name: "Add to list" }));
    await screen.findByText("Add to Kroger");

    // Confirm the product through the search modal.
    fireEvent.click(await screen.findByRole("button", { name: "Change" }));
    fireEvent.click(await screen.findByRole("button", { name: /Kroger® Red Lentils/ }));

    fireEvent.click(await screen.findByRole("button", { name: /^Add \d/ }));

    await waitFor(() => expect(posts().some(p => p.url.includes("/api/kroger/matches"))).toBe(true));
    const remembered = posts().find(p => p.url.includes("/api/kroger/matches"));
    // Not "2 cups red lentils" — lookups normalize the quantity away.
    expect(remembered.body.term).toBe("red lentils");
  });
});
