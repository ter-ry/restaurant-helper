import { expect, test, type Page, type Route } from "@playwright/test";

/**
 * Browser acceptance (#325) for Menu Costing menu-item create, failed save, and delete at phone and tablet widths.
 * The API is a small stateful fake: server state changes only through the mocked endpoints, so these tests exercise
 * the real React UI, its in-progress / success / failure states, duplicate-submit guards and server refresh.
 * No live data and no external services.
 */

const ORG = { id: 42, name: "Menu Costing Cafe", lifecycleStatus: "ACTIVE", setupStatus: "COMPLETE", subscriptionStatus: "ACTIVE", setupTemplateKey: "GENERIC_RESTAURANT", setupFeeStatus: "confirmed", isProspect: false, activeAt: "2026-01-01T00:00:00Z", setupCompletedAt: "2026-01-01T00:00:00Z" };
const LOCATIONS = [{ id: 7, name: "Line Kitchen", city: "Toronto", region: "ON" }];
const MODULES = ["MENU_COSTING"];
const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
];

const json = (route: Route, payload: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(payload) });
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type MenuItem = { id: number; name: string; category: string; sellingPrice: number };

type World = {
  menuItems: MenuItem[];
  nextId: number;
  posts: any[];
  deletes: string[];
  menuReads: number;
  delayMs: number;
  failNextPost: boolean;
  failNextRead: number;
  costUnavailable: boolean;
};

const RECIPE_COST_PER_YIELD = 2;

function newWorld(): World {
  return { menuItems: [{ id: 21, name: "Cheesy Toast", category: "Breakfast", sellingPrice: 12 }], nextId: 22, posts: [], deletes: [], menuReads: 0, delayMs: 0, failNextPost: false, failNextRead: 0, costUnavailable: false };
}

const menuItemPayload = (item: MenuItem) => ({
  id: item.id, organizationId: 42, locationId: 7, recipeId: 1, name: item.name, normalizedName: item.name.toLowerCase(), category: item.category,
  sellingPrice: item.sellingPrice, active: true, notes: "", recipe: null, recipeCostPerYield: RECIPE_COST_PER_YIELD,
  grossProfit: Math.round((item.sellingPrice - RECIPE_COST_PER_YIELD) * 100) / 100,
  foodCostPercent: Math.round((RECIPE_COST_PER_YIELD / item.sellingPrice) * 1000) / 10,
  grossMarginPercent: Math.round(((item.sellingPrice - RECIPE_COST_PER_YIELD) / item.sellingPrice) * 1000) / 10,
  costAvailable: true, warnings: [], createdByUserId: null, updatedByUserId: null, createdAt: null, updatedAt: null,
});

const recipePayload = () => ({
  id: 1, organizationId: 42, locationId: 7, name: "Cheesy Toast Recipe", normalizedName: "cheesy toast recipe", description: "Toasted bread with cheese",
  yieldQuantity: 2, yieldUnit: "servings", active: true, notes: "", ingredientCount: 0, ingredients: [], totalCost: 4, costPerYield: RECIPE_COST_PER_YIELD,
  costAvailable: true, warnings: [], createdByUserId: null, updatedByUserId: null, createdAt: null, updatedAt: null,
});

async function installWorld(page: Page, world: World) {
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    const method = request.method();
    let body: any = {};
    try { body = JSON.parse(request.postData() ?? "{}"); } catch { /* no body */ }

    if (pathname === "/api/auth/me") {
      return json(route, {
        user: { id: 1, email: "owner@example.com", isActive: true, createdAt: null, updatedAt: null }, platformRole: null, membershipRole: "owner",
        currentOrganizationId: ORG.id, currentLocationId: 7, csrfToken: "csrf-token", enabledModuleKeys: MODULES,
        organizations: [{ organization: ORG, membershipRole: "owner", selected: true }],
      });
    }
    if (pathname === "/api/auth/csrf") return json(route, { csrfToken: "csrf-token" });
    if (pathname.startsWith("/api/organizations")) {
      const bundle = { organization: ORG, restaurantLocations: LOCATIONS, currentLocation: LOCATIONS[0], membershipRole: "owner", enabledModuleKeys: MODULES };
      return json(route, {
        organizations: [{ organization: ORG, membershipRole: "owner", selected: true }], currentOrganizationId: ORG.id, currentMembershipId: 1,
        currentLocationId: 7, currentOrganization: bundle, ...bundle,
      });
    }
    if (pathname === "/api/pilot/attention") return json(route, { reorder: { count: 0 } });
    if (pathname === "/api/pilot/inventory" && method === "GET") {
      return json(route, { items: [], movements: [], countSessions: [], reorderPlan: { suggestions: [], groupedBySupplier: [] }, summary: {} });
    }
    if (pathname === "/api/pilot/menu-costing" && method === "GET") {
      world.menuReads += 1;
      if (world.failNextRead > 0) {
        world.failNextRead -= 1;
        return json(route, { error: "The server could not process this request. Try again." }, 503);
      }
      // costUnavailable models a recipe whose ingredient costs are not known: the API reports null figures, never 0.
      const unavailable = (item: MenuItem) => ({ ...menuItemPayload(item), recipeCostPerYield: null, grossProfit: null, foodCostPercent: null, grossMarginPercent: null, costAvailable: false, warnings: ["Ingredient cost unavailable"] });
      return json(route, { organizationId: 42, locationId: 7, recipes: [recipePayload()], menuItems: world.menuItems.map((item) => (world.costUnavailable ? unavailable(item) : menuItemPayload(item))) });
    }
    if (pathname === "/api/pilot/menu-costing/menu-items" && method === "POST") {
      world.posts.push(body);
      if (world.delayMs) await sleep(world.delayMs);
      if (world.failNextPost) {
        world.failNextPost = false;
        return json(route, { error: "Menu item could not be saved. Please try again." }, 500);
      }
      const created: MenuItem = { id: world.nextId++, name: body.name, category: body.category, sellingPrice: body.sellingPrice };
      world.menuItems.push(created);
      return json(route, menuItemPayload(created), 201);
    }
    const detail = pathname.match(/^\/api\/pilot\/menu-costing\/menu-items\/(\d+)$/);
    if (detail && method === "DELETE") {
      world.deletes.push(detail[1]);
      if (world.delayMs) await sleep(world.delayMs);
      world.menuItems = world.menuItems.filter((item) => item.id !== Number(detail[1]));
      return json(route, { ok: true });
    }
    return json(route, { error: `Unhandled ${method} ${pathname}` }, 404);
  });
}

async function noHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

async function fillNewMenuItem(page: Page, name: string, price: string) {
  await page.getByRole("button", { name: "New menu item" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name").fill(name);
  await dialog.getByLabel("Category").fill("Breakfast");
  await dialog.getByLabel("Selling price").fill(price);
  return dialog;
}

for (const viewport of VIEWPORTS) {
  test.describe(`Menu Costing actions at ${viewport.width}px`, () => {
    test.use({ viewport });

    test(`a failed initial load shows an alert and Retry with no false figures, and Retry recovers at ${viewport.width}px`, async ({ page }) => {
      const world = newWorld();
      world.failNextRead = 1;
      await installWorld(page, world);
      await page.goto("/app/menu-costing", { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("alert").first()).toContainText("could not process");
      await expect(page.getByText("Cheesy Toast")).toHaveCount(0);
      await expect(page.getByText("$0.00")).toHaveCount(0);
      await noHorizontalOverflow(page);

      await page.getByRole("button", { name: "Retry" }).click();
      await expect(page.getByText("Cheesy Toast").first()).toBeVisible();
      await expect(page.getByRole("button", { name: "Retry" })).toHaveCount(0);
      const row = page.getByRole("row", { name: /Cheesy Toast/ });
      await expect(row).toContainText("Food cost 16.7%");
      await expect(row).toContainText("Cost available");
    });

    test(`unavailable ingredient cost is labelled, never shown as $0 or 0% at ${viewport.width}px`, async ({ page }) => {
      const world = newWorld();
      world.costUnavailable = true;
      await installWorld(page, world);
      await page.goto("/app/menu-costing", { waitUntil: "domcontentloaded" });
      const row = page.getByRole("row", { name: /Cheesy Toast/ });
      await expect(row).toBeVisible();
      await expect(row).toContainText("Cost unavailable");
      await expect(row).toContainText("Food cost Unavailable");
      await expect(row).toContainText("Contribution unavailable");
      await expect(row).toContainText("Needs review");
      await expect(row).not.toContainText("Cost available");
      await expect(row).not.toContainText("0%");
      await expect(row).not.toContainText("Cost $0");
      await noHorizontalOverflow(page);
    });

    test(`create shows in-progress, sends one request on double click and refreshes from the server at ${viewport.width}px`, async ({ page }) => {
      const world = newWorld();
      world.delayMs = 600;
      await installWorld(page, world);
      await page.goto("/app/menu-costing", { waitUntil: "domcontentloaded" });
      await expect(page.getByText("Cheesy Toast").first()).toBeVisible();
      await noHorizontalOverflow(page);

      const dialog = await fillNewMenuItem(page, "Avocado Toast", "16");
      const readsBefore = world.menuReads;
      const create = dialog.getByRole("button", { name: "Create menu item" });
      await create.dblclick();
      await expect(dialog.getByRole("button", { name: "Saving…" })).toBeDisabled();
      await expect(dialog.getByText("Menu item Avocado Toast saved.")).toBeVisible();

      expect(world.posts).toHaveLength(1);
      expect(world.posts[0]).toMatchObject({ name: "Avocado Toast", category: "Breakfast", sellingPrice: 16 });
      // Authoritative refresh: the list was re-fetched and shows server-computed figures (2 / 16 = 12.5%).
      expect(world.menuReads).toBeGreaterThan(readsBefore);
      await dialog.getByRole("button", { name: /close/i }).first().click();
      const row = page.getByRole("row", { name: /Avocado Toast/ });
      await expect(row).toContainText("Price $16.00");
      await expect(row).toContainText("Food cost 12.5%");
      await noHorizontalOverflow(page);
    });

    test(`a failed save stays inside the dialog, keeps the draft and can be retried at ${viewport.width}px`, async ({ page }) => {
      const world = newWorld();
      world.failNextPost = true;
      await installWorld(page, world);
      await page.goto("/app/menu-costing", { waitUntil: "domcontentloaded" });
      await expect(page.getByText("Cheesy Toast").first()).toBeVisible();

      const dialog = await fillNewMenuItem(page, "Granola Bowl", "9.5");
      await dialog.getByRole("button", { name: "Create menu item" }).click();
      await expect(dialog.getByRole("alert")).toContainText("Menu item could not be saved");
      await expect(dialog.getByLabel("Name")).toHaveValue("Granola Bowl");
      await expect(dialog.getByRole("button", { name: "Create menu item" })).toBeEnabled();
      expect(world.menuItems).toHaveLength(1);

      await dialog.getByRole("button", { name: "Create menu item" }).click();
      await expect(dialog.getByText("Menu item Granola Bowl saved.")).toBeVisible();
      expect(world.posts).toHaveLength(2);
      expect(world.menuItems.map((item) => item.name)).toContain("Granola Bowl");
      await noHorizontalOverflow(page);
    });

    test(`delete asks for confirmation, shows progress, sends one request and refreshes at ${viewport.width}px`, async ({ page }) => {
      const world = newWorld();
      world.delayMs = 600;
      await installWorld(page, world);
      await page.goto("/app/menu-costing", { waitUntil: "domcontentloaded" });
      await page.getByRole("row", { name: /Cheesy Toast/ }).click();
      await page.getByRole("dialog").getByRole("button", { name: "Delete menu item" }).click();

      const confirm = page.getByRole("dialog").filter({ hasText: "Delete Cheesy Toast? This cannot be undone." });
      await expect(confirm).toBeVisible();
      await confirm.getByRole("button", { name: "Delete", exact: true }).dblclick();
      await expect(confirm.getByRole("button", { name: "Deleting…" })).toBeDisabled();
      await expect(page.getByText("No menu items yet.")).toBeVisible();

      expect(world.deletes).toEqual(["21"]);
      await expect(page.getByRole("row", { name: /Cheesy Toast/ })).toHaveCount(0);
      await noHorizontalOverflow(page);
    });
  });
}
