import { useEffect, useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import Sidebar from "./Sidebar";
import { applyTheme, otherTheme, prefersDark, readStoredTheme, resolveTheme, storeTheme } from "../lib/theme";

const TOOLS = [
  { id: "dashboard", name: "Dashboard", shortName: "Dashboard", active: true },
  { id: "invoices",  name: "Invoice Tracker", shortName: "Invoices", active: true },
];

const USER = { id: 4, username: "alison", role: "user" };

const renderSidebar = (overrides = {}) => {
  const props = {
    activeTool: "dashboard",
    setActiveTool: jest.fn(),
    tools: TOOLS,
    showToast: jest.fn(),
    currentUser: USER,
    onLogout: jest.fn(),
    settings: {},
    onOpenQuickAdd: jest.fn(),
    onOpenSearch: jest.fn(),
    theme: "light",
    onToggleTheme: jest.fn(),
    ...overrides,
  };
  return { props, ...render(<Sidebar {...props} />) };
};

/** Mirrors how App.js drives the sidebar, so the wiring is exercised end to end. */
function ThemedSidebar({ currentUser }) {
  const [theme, setTheme] = useState("light");
  const userId = currentUser?.id ?? null;

  useEffect(() => {
    setTheme(applyTheme(resolveTheme(readStoredTheme(userId), prefersDark())));
  }, [userId]);

  const toggleTheme = () => setTheme(current => {
    const next = otherTheme(current);
    applyTheme(next);
    storeTheme(userId, next);
    return next;
  });

  return (
    <Sidebar
      activeTool="dashboard" setActiveTool={jest.fn()} tools={TOOLS} showToast={jest.fn()}
      currentUser={currentUser} onLogout={jest.fn()} settings={{}}
      onOpenQuickAdd={jest.fn()} onOpenSearch={jest.fn()}
      theme={theme} onToggleTheme={toggleTheme}
    />
  );
}

const toggle = () => screen.getByRole("button", { name: /switch to (light|dark) theme/i });

afterEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
});

describe("theme toggle", () => {
  test("sits next to the signed-in user's name", () => {
    renderSidebar();
    const row = screen.getByText(/signed in as/i).closest(".sidebar-user-row");
    expect(row).not.toBeNull();
    expect(row).toContainElement(toggle());
  });

  test("labels itself by what it will do, and reports dark as pressed", () => {
    const { rerender, props } = renderSidebar();
    expect(toggle()).toHaveAttribute("aria-label", "Switch to dark theme");
    expect(toggle()).toHaveAttribute("aria-pressed", "false");

    rerender(<Sidebar {...props} theme="dark" />);
    expect(toggle()).toHaveAttribute("aria-label", "Switch to light theme");
    expect(toggle()).toHaveAttribute("aria-pressed", "true");
  });

  test("clicking asks the app to switch", () => {
    const { props } = renderSidebar();
    fireEvent.click(toggle());
    expect(props.onToggleTheme).toHaveBeenCalledTimes(1);
  });

  test("is hidden along with the rest of the user block when nobody is signed in", () => {
    renderSidebar({ currentUser: null });
    expect(screen.queryByRole("button", { name: /switch to .* theme/i })).toBeNull();
  });
});

describe("theme toggle wired up", () => {
  test("flips the attribute on the document root", () => {
    render(<ThemedSidebar currentUser={USER} />);
    expect(document.documentElement).toHaveAttribute("data-theme", "light");

    fireEvent.click(toggle());
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");

    fireEvent.click(toggle());
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
  });

  test("persists the choice against the user's id", () => {
    render(<ThemedSidebar currentUser={USER} />);
    fireEvent.click(toggle());
    expect(localStorage.getItem("theme:4")).toBe("dark");
  });

  test("two users on the same device keep separate themes", () => {
    const first = render(<ThemedSidebar currentUser={USER} />);
    fireEvent.click(toggle());
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    first.unmount();

    const second = render(<ThemedSidebar currentUser={{ id: 5, username: "sam", role: "user" }} />);
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
    expect(localStorage.getItem("theme:5")).toBeNull();
    second.unmount();

    render(<ThemedSidebar currentUser={USER} />);
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
  });
});
