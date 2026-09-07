const { test, expect } = require("playwright/test");

const ADMIN = {
  username: process.env.SMOKE_ADMIN_USERNAME || "admin",
  password: process.env.SMOKE_ADMIN_PASSWORD || "secret123",
};

// The weather widget calls open-meteo directly; every test stubs it. The mock
// answers with a distinguishable temperature per requested unit, so a test can
// prove the app forwarded the configured unit rather than merely relabelling
// the suffix on an unchanged number.
const MOCK_TEMPS = { fahrenheit: 70, celsius: 21 };

const stubWeather = (page) => page.route(/open-meteo\.com/, async (route) => {
  const url = new URL(route.request().url());
  if (url.hostname.startsWith("geocoding-api")) {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ results: [{ name: "Brussels", country: "Belgium", latitude: 50.85, longitude: 4.35 }] }),
    });
    return;
  }
  const unit = url.searchParams.get("temperature_unit") === "celsius" ? "celsius" : "fahrenheit";
  const temp = MOCK_TEMPS[unit];
  await route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      current: { temperature_2m: temp, weathercode: 1 },
      daily: {
        temperature_2m_max: [temp + 3],
        temperature_2m_min: [temp - 5],
        sunrise: ["2026-06-30T05:30"],
        sunset: ["2026-06-30T22:00"],
      },
    }),
  });
});

const login = async (page) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "HomeHub" })).toBeVisible();
  await page.locator('input[autocomplete="username"]').fill(ADMIN.username);
  await page.locator('input[autocomplete="current-password"]').fill(ADMIN.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText(/Good (morning|afternoon|evening),/)).toBeVisible();
};

const columnFor = (page, dayName) =>
  page.locator(`.planner-day-card:has(.planner-day-name:text-is("${dayName}"))`);


// dnd-kit activates on pointer movement past a distance threshold, so a single
// jump from source to target is not enough — it needs intermediate positions.
const dragOnto = async (page, source, target) => {
  await source.scrollIntoViewIfNeeded();
  const from = await source.boundingBox();
  const to = await target.boundingBox();
  const viewport = page.viewportSize();

  // Aim near the top of the target rather than its centre: a tall day column
  // can have its middle below the fold, and the pointer cannot be moved off
  // screen, so the drop would never register.
  const targetX = to.x + to.width / 2;
  const targetY = Math.min(to.y + Math.min(60, to.height / 2), viewport.height - 8);

  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 24, from.y + from.height / 2, { steps: 6 });
  await page.mouse.move(targetX, targetY, { steps: 12 });
  await page.mouse.up();
};

const addWeeklyTask = async (page, title) => {
  await page.getByRole("button", { name: "New task" }).click();
  await page.getByPlaceholder("e.g. Pack school bags").fill(title);
  await page.getByRole("button", { name: "Weekly", exact: true }).click();
  await page.getByRole("button", { name: "Save task" }).click();
  await expect(page.getByText("Task added")).toBeVisible();
};

test("login and core household workflows", async ({ page }) => {
  await stubWeather(page);
  await login(page);

  await expect(page.getByText("Bills to settle")).toBeVisible();

  await page.getByRole("button", { name: "Quick add" }).click();
  const quickAdd = page.getByRole("dialog").filter({ hasText: "Quick add" });
  await quickAdd.getByRole("button", { name: "Invoice" }).click();
  await quickAdd.locator('input[placeholder="e.g. Engie"]').fill("Smoke Utilities");
  await quickAdd.locator('input[placeholder="0.00"]').fill("123.45");
  await quickAdd.getByRole("button", { name: "Add" }).click();
  await expect(page.getByText("Invoice added")).toBeVisible();

  await page.getByRole("button", { name: "Invoices" }).click();
  await expect(page.getByRole("heading", { name: "Invoice Tracker" })).toBeVisible();
  await expect(page.getByText("Smoke Utilities")).toBeVisible();

  await page.getByRole("button", { name: "Shopping" }).click();
  await expect(page.getByRole("heading", { name: "Shopping" })).toBeVisible();
  await page.getByRole("button", { name: "Add store" }).click();

  await page.getByPlaceholder("e.g. Colruyt").fill("Colruyt");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("button", { name: /Colruyt/ })).toBeVisible();

  await page.locator('input[placeholder="Add to Colruyt..."]').fill("Milk");
  await page.locator('input[placeholder="Add to Colruyt..."]').press("Enter");
  await expect(page.getByText("Milk")).toBeVisible();

  await page.getByRole("button", { name: "Meals" }).click();
  await expect(page.getByRole("heading", { name: "Meals" })).toBeVisible();
  await expect(page.getByRole("heading", { name: /^Cookbook/ })).toBeVisible();

  await page.getByRole("button", { name: "Admin" }).click();
  await expect(page.getByRole("heading", { name: "Admin" })).toBeVisible();
  await page.getByRole("button", { name: "System" }).click();
  await expect(page.getByText("System stats")).toBeVisible();
  await expect(page.getByText("Upload storage")).toBeVisible();
});

test("moving a recurring task just this week leaves later weeks alone", async ({ page }) => {
  await stubWeather(page);
  await login(page);

  await page.getByRole("button", { name: "Tasks" }).first().click();
  await expect(page.getByRole("heading", { name: "Tasks" })).toBeVisible();

  await page.getByRole("button", { name: "New task" }).click();
  await page.getByPlaceholder("e.g. Pack school bags").fill("Smoke recurring");
  await page.getByRole("button", { name: "Weekly", exact: true }).click();
  await page.getByRole("button", { name: "Save task" }).click();
  await expect(page.getByText("Task added")).toBeVisible();

  // Defaults to Mon-Fri, so it starts on Monday.
  await expect(columnFor(page, "Monday")).toContainText("Smoke recurring");

  await columnFor(page, "Monday")
    .getByLabel("Move Smoke recurring to another day")
    .click();
  await page.getByRole("menuitem", { name: "Sun" }).click();
  await page.getByRole("button", { name: "Just this week" }).click();
  await expect(page.getByText("Task moved")).toBeVisible();

  await expect(columnFor(page, "Sunday")).toContainText("Smoke recurring");
  await expect(columnFor(page, "Monday")).not.toContainText("Smoke recurring");

  // The override is week-scoped: next week the task is back on Monday.
  await page.getByRole("button", { name: "Next week" }).click();
  await expect(columnFor(page, "Monday")).toContainText("Smoke recurring");
  await expect(columnFor(page, "Sunday")).not.toContainText("Smoke recurring");
});

test("temperature toggle flips the unit shown on the dashboard", async ({ page }) => {
  await stubWeather(page);
  await login(page);

  // Default unit is fahrenheit: showing the mock's fahrenheit value proves the
  // request carried temperature_unit=fahrenheit.
  await expect(page.getByText(`${MOCK_TEMPS.fahrenheit}°F`, { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Admin" }).first().click();
  await expect(page.getByRole("heading", { name: "Admin" })).toBeVisible();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByText("Temperature unit")).toBeVisible();

  await page.getByRole("button", { name: "°C" }).click();
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByText("Settings saved")).toBeVisible();

  await page.getByRole("button", { name: "Dashboard" }).first().click();
  // The number changing (not just the suffix) proves temperature_unit=celsius
  // reached the open-meteo request.
  await expect(page.getByText(`${MOCK_TEMPS.celsius}°C`, { exact: true })).toBeVisible();
});

test("dragging a task between days moves it", async ({ page }) => {
  await stubWeather(page);
  await login(page);
  await page.getByRole("button", { name: "Tasks" }).first().click();
  await expect(page.getByRole("heading", { name: "Tasks" })).toBeVisible();

  await addWeeklyTask(page, "Drag me");
  await expect(columnFor(page, "Monday")).toContainText("Drag me");

  // The title is the drag handle; the tickbox deliberately is not.
  const handle = columnFor(page, "Monday").locator(".planner-day-task-title", { hasText: "Drag me" });
  await dragOnto(page, handle, columnFor(page, "Sunday"));

  await page.getByRole("button", { name: "Just this week" }).click();
  await expect(page.getByText("Task moved")).toBeVisible();

  await expect(columnFor(page, "Sunday")).toContainText("Drag me");
  await expect(columnFor(page, "Monday")).not.toContainText("Drag me");
});

test("dragging a day heading moves every task on that day", async ({ page }) => {
  await stubWeather(page);
  await login(page);
  await page.getByRole("button", { name: "Tasks" }).first().click();
  await expect(page.getByRole("heading", { name: "Tasks" })).toBeVisible();

  await addWeeklyTask(page, "First chore");
  await addWeeklyTask(page, "Second chore");
  await expect(columnFor(page, "Monday")).toContainText("First chore");
  await expect(columnFor(page, "Monday")).toContainText("Second chore");

  await dragOnto(
    page,
    columnFor(page, "Monday").locator(".planner-day-heading"),
    columnFor(page, "Saturday")
  );

  await expect(page.getByText(/Move all 2 tasks/)).toBeVisible();
  await page.getByRole("button", { name: "Just this week" }).click();

  await expect(columnFor(page, "Saturday")).toContainText("First chore");
  await expect(columnFor(page, "Saturday")).toContainText("Second chore");
  await expect(columnFor(page, "Monday")).not.toContainText("chore");
});

// Relative luminance per WCAG, so the assertion is a real ratio rather than a
// screenshot nobody looks at.
const contrastRatio = (fg, bg) => {
  const parse = (c) => (c.match(/\d+(\.\d+)?/g) || []).slice(0, 3).map(Number);
  const lum = ([r, g, b]) => {
    const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const [hi, lo] = [lum(parse(fg)), lum(parse(bg))].sort((a, b) => b - a);
  return (hi + 0.05) / (lo + 0.05);
};

test("dark theme keeps text readable", async ({ page }) => {
  await stubWeather(page);
  await login(page);

  // A note gives us the sticky-note surface, which keeps its pale tone in dark
  // and so needs its own ink rather than the inverted body colour.
  await page.getByRole("button", { name: /New note/ }).click();
  await page.getByLabel("Note text").fill("bins out **Thursday**");
  await page.getByRole("button", { name: "Save note" }).click();
  // Wait for the editor to close, or the textarea still holds the same words.
  await expect(page.getByLabel("Note text")).toBeHidden();
  await expect(page.locator(".note-body").first()).toBeVisible();

  await page.getByRole("button", { name: /Switch to dark theme/ }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  // Colour transitions are animated; measure the settled value.
  await page.waitForTimeout(600);

  for (const selector of ["h1", ".nav-btn--active", ".sidebar-quickadd", ".note-body"]) {
    const { fg, bg } = await page.locator(selector).first().evaluate((node) => {
      const style = getComputedStyle(node);
      let el = node;
      let bg = style.backgroundColor;
      while (el && (bg === "rgba(0, 0, 0, 0)" || bg === "transparent")) {
        el = el.parentElement;
        if (!el) break;
        bg = getComputedStyle(el).backgroundColor;
      }
      return { fg: style.color, bg };
    });
    expect(contrastRatio(fg, bg), `${selector} contrast in dark`).toBeGreaterThan(4.5);
  }

  // The choice has to survive a reload, per user.
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});
