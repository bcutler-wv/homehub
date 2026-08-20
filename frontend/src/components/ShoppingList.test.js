import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import ShoppingList from "./ShoppingList";

const KROGER = { id: 1, name: "Kroger", color: "#5a7a5e", vendor: "kroger" };
const SAMS = { id: 2, name: "Sam's Club", color: "#5d7c95", vendor: null };

// The Kroger flow only engages once /api/kroger/status reports configured.
const mockKrogerStatus = (configured) => {
  global.fetch = jest.fn((url) => {
    if (String(url).includes("/api/kroger/status")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ configured, locationId: "02900788" }) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  });
};

afterEach(() => { delete global.fetch; });

const renderList = (shopping, overrides = {}) => {
  const setShopping = jest.fn();
  const utils = render(
    <ShoppingList
      shopping={shopping}
      setShopping={setShopping}
      apiEnabled={overrides.apiEnabled ?? false}
      queueMutation={jest.fn()}
      showToast={jest.fn()}
      {...overrides}
    />
  );
  return { setShopping, ...utils };
};

const renderKrogerList = async (shopping) => {
  mockKrogerStatus(true);
  const utils = renderList(shopping, { apiEnabled: true });
  // Wait for the status probe to enable product search.
  await waitFor(() => expect(global.fetch).toHaveBeenCalled());
  return utils;
};

const selectStore = (name) => fireEvent.click(screen.getByRole("button", { name: new RegExp(name) }));

describe("ShoppingList Kroger vendor", () => {
  test("typing on the Kroger list opens product search instead of adding text", async () => {
    const { setShopping } = await renderKrogerList({ stores: [KROGER, SAMS], items: [] });

    selectStore("Kroger");
    await screen.findByRole("button", { name: "Find" });
    fireEvent.change(screen.getByPlaceholderText(/Add to Kroger/i), { target: { value: "red lentils" } });
    fireEvent.click(screen.getByRole("button", { name: "Find" }));

    // The search modal takes over; nothing is added yet.
    expect(await screen.findByLabelText("Search Kroger products")).toHaveValue("red lentils");
    expect(setShopping).not.toHaveBeenCalled();
  });

  test("a non-Kroger store adds plain text exactly as before", () => {
    const { setShopping } = renderList({ stores: [KROGER, SAMS], items: [] });

    selectStore("Sam's Club");
    expect(screen.getByRole("button", { name: "Add" })).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText(/Add to Sam's Club/i), { target: { value: "paper towels" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(setShopping).toHaveBeenCalled();
    expect(screen.queryByLabelText("Search Kroger products")).not.toBeInTheDocument();
  });

  test("the Kroger list sections items by aisle in walk order", async () => {
    await renderKrogerList({
      stores: [KROGER],
      items: [
        { id: 10, storeId: 1, name: "Milk", checked: false, kroger: { aisle: "DAIRY", price: 3.49 } },
        { id: 11, storeId: 1, name: "Rice", checked: false, kroger: { aisle: "AISLE 10", price: 2.19 } },
        { id: 12, storeId: 1, name: "Lentils", checked: false, kroger: { aisle: "AISLE 2", price: 2.69 } },
        { id: 13, storeId: 1, name: "Mystery", checked: false, kroger: null },
      ],
    });

    selectStore("Kroger");
    await screen.findByText("AISLE 2");
    const headings = screen.getAllByText(/^(AISLE \d+|DAIRY|Not located)$/);
    // Numbered aisles ascend, departments follow, unlocated last.
    expect(headings.map(h => h.textContent)).toEqual(["AISLE 2", "AISLE 10", "DAIRY", "Not located"]);
  });

  test("a matched item shows its price and brand on the card", async () => {
    await renderKrogerList({
      stores: [KROGER],
      items: [{
        id: 10, storeId: 1, name: "Kroger® Red Lentils", checked: false,
        kroger: { brand: "Kroger", size: "16 oz", price: 2.69, aisle: "AISLE 8", bay: "8" },
      }],
    });

    selectStore("Kroger");
    expect(await screen.findByText("$2.69")).toBeInTheDocument();
    expect(screen.getByText("Kroger · 16 oz")).toBeInTheDocument();
  });

  test("promo price wins over the regular price on the card", async () => {
    await renderKrogerList({
      stores: [KROGER],
      items: [{
        id: 10, storeId: 1, name: "Chicken", checked: false,
        kroger: { price: 4.99, promoPrice: 3.49, aisle: "MEAT" },
      }],
    });

    selectStore("Kroger");
    expect(await screen.findByText("$3.49")).toBeInTheDocument();
    expect(screen.queryByText("$4.99")).not.toBeInTheDocument();
  });

  test("a non-Kroger list is not sectioned and keeps its original order", () => {
    renderList({
      stores: [SAMS],
      items: [
        { id: 20, storeId: 2, name: "Zucchini", checked: false },
        { id: 21, storeId: 2, name: "Apples", checked: false },
      ],
    });

    selectStore("Sam's Club");
    expect(screen.queryByText("Not located")).not.toBeInTheDocument();
    const names = screen.getAllByText(/Zucchini|Apples/).map(n => n.textContent);
    expect(names).toEqual(["Zucchini", "Apples"]);
  });

  test("a Kroger store falls back to plain text adds when the API is not configured", async () => {
    mockKrogerStatus(false);
    const { setShopping } = renderList({ stores: [KROGER], items: [] }, { apiEnabled: true });

    selectStore("Kroger");
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());

    expect(screen.getByRole("button", { name: "Add" })).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText(/Add to Kroger/i), { target: { value: "milk" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(setShopping).toHaveBeenCalled();
    expect(screen.queryByLabelText("Search Kroger products")).not.toBeInTheDocument();
  });

  test("All stores does not silently target Kroger", async () => {
    mockKrogerStatus(true);
    const { setShopping } = renderList({ stores: [KROGER, SAMS], items: [] }, { apiEnabled: true });
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());

    // Kroger is first in the list, but no store is selected on either control.
    expect(screen.getByPlaceholderText("Choose a store...")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add" })).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText("Choose a store..."), { target: { value: "milk" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(setShopping).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Search Kroger products")).not.toBeInTheDocument();
  });

  test("picking Kroger under the Add button hooks product search", async () => {
    mockKrogerStatus(true);
    renderList({ stores: [SAMS, KROGER], items: [] }, { apiEnabled: true });
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());

    // Choosing a non-Kroger target keeps the plain add.
    fireEvent.change(screen.getByLabelText("Add to store"), { target: { value: String(SAMS.id) } });
    expect(screen.getByRole("button", { name: "Add" })).toBeEnabled();

    // Switching the target to Kroger is what turns on search.
    fireEvent.change(screen.getByLabelText("Add to store"), { target: { value: String(KROGER.id) } });
    const find = await screen.findByRole("button", { name: "Find" });

    fireEvent.change(screen.getByPlaceholderText("Add to Kroger..."), { target: { value: "red lentils" } });
    fireEvent.click(find);
    expect(await screen.findByLabelText("Search Kroger products")).toHaveValue("red lentils");
  });

  test("the store selector only appears under All stores", async () => {
    await renderKrogerList({ stores: [KROGER, SAMS], items: [] });
    expect(screen.getByLabelText("Add to store")).toBeInTheDocument();

    selectStore("Sam's Club");
    expect(screen.queryByLabelText("Add to store")).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Add to Sam's Club/i)).toBeInTheDocument();
  });
});
