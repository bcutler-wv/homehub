const { test, expect } = require("playwright/test");

const ADMIN = {
  username: process.env.SMOKE_ADMIN_USERNAME || "admin",
  password: process.env.SMOKE_ADMIN_PASSWORD || "secret123",
};

// The weather widget calls open-meteo directly; every test stubs it so the
// dashboard renders a known reading.
const stubWeather = (page) => page.route(/open-meteo\.com/, async (route) => {
  const url = route.request().url();
  if (url.includes("geocoding-api")) {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ results: [{ name: "Brussels", country: "Belgium", latitude: 50.85, longitude: 4.35 }] }),
    });
    return;
  }
  await route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      current: { temperature_2m: 21, weathercode: 1 },
      daily: {
        temperature_2m_max: [24],
        temperature_2m_min: [16],
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
  await page.getByRole("button", { name: "Weekdays", exact: true }).click();
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

  await expect(page.getByText(/^21°F$/)).toBeVisible();

  await page.getByRole("button", { name: "Admin" }).first().click();
  await expect(page.getByRole("heading", { name: "Admin" })).toBeVisible();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "°C" }).click();
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByText("Settings saved")).toBeVisible();

  await page.getByRole("button", { name: "Dashboard" }).first().click();
  await expect(page.getByText(/^21°C$/)).toBeVisible();
});
