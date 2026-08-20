import { render, screen, fireEvent } from "@testing-library/react";
import MealPlanner, { parseIngredients } from "./MealPlanner";

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
