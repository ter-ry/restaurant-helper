import { expect, test, type Page, type Route } from "@playwright/test";

/**
 * Browser acceptance for the Square integration page (/app/square, #343).
 * The API is a small stateful fake (no Flask/PostgreSQL, no Square), so this exercises the real React UI,
 * its in-progress/success/failure states, duplicate-submit guard and server re-fetch at phone and tablet widths.
 */

type World = {
  catalog: { id: number; name: string; mappedTo: string }[];
  locationMapping: number | null;
  /** Catalog rows that the next catalog sync will make visible on the server. */
  pendingCatalog: { id: number; name: string; mappedTo: string }[];
  imported: boolean;
  failNext: Set<string>;
  delayMs: number;
  posts: { path: string; body: any }[];
  catalogReads: number;
  statusReads: number;
};

const ORG = { id: 42, name: "Showcase Cafe", lifecycleStatus: "ACTIVE", setupStatus: "COMPLETE", subscriptionStatus: "ACTIVE", setupTemplateKey: "GENERIC_RESTAURANT", setupFeeStatus: "confirmed", isProspect: false, activeAt: "2026-01-01T00:00:00Z", setupCompletedAt: "2026-01-01T00:00:00Z" };
const LOCATIONS = [
  { id: 7, name: "Queen St Cafe", city: "Toronto", region: "ON", timezone: "America/Toronto" },
  { id: 9, name: "King St Kiosk", city: "Toronto", region: "ON", timezone: "America/Toronto" },
];
const MODULES = ["PURCHASES", "INVENTORY", "SQUARE_INTEGRATION", "DAILY_CLOSE", "MENU_COSTING"];
const MENU_ITEMS = [
  { id: 11, name: "Latte", category: "Drinks", sellingPrice: 5.25, active: true },
  { id: 12, name: "Butter Croissant", category: "Bakery", sellingPrice: 4.5, active: true },
];
const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
];

const json = (route: Route, payload: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(payload) });

function newWorld(): World {
  return {
    catalog: [{ id: 101, name: "Latte - Regular", mappedTo: "" }],
    locationMapping: null,
    pendingCatalog: [{ id: 102, name: "Croissant - Plain", mappedTo: "" }],
    imported: false,
    failNext: new Set(),
    delayMs: 0,
    posts: [],
    catalogReads: 0,
    statusReads: 0,
  };
}

function connection(world: World) {
  return {
    id: 1, organizationId: 42, organization: { id: 42, name: "Showcase Cafe" }, environment: "sandbox", squareMerchantId: "MERCHANT1", status: "connected",
    tokenExpiresAt: null, revokedAt: null, lastSyncAt: "2026-11-16T12:00:00Z", lastOrderActivityAt: new Date().toISOString(), syncStatus: "ok", syncError: "",
    catalogCount: world.catalog.length, orderCount: 0, locationCount: 1, dailySalesCount: 0,
    locations: [{
      id: 5, squareLocationId: "SQLOC1", name: "Queen Street Square", status: "ACTIVE", rawPayload: {},
      mappings: world.locationMapping ? [{ id: 1, squareLocationId: 5, restaurantLocationId: world.locationMapping, restaurantLocation: { id: world.locationMapping, name: "Queen St Cafe" }, mappedByUserId: 1, mappedAt: null }] : [],
    }],
    catalogObjects: [], orders: [], dailySales: [], syncJobs: [], webhookEvents: [],
  };
}

function candidates(world: World) {
  return world.catalog.map((row) => ({
    id: row.id, squareCatalogObjectId: row.id, squareObjectId: `VAR${row.id}`, squareObjectType: "ITEM_VARIATION", squareObjectName: row.name, squareItemName: row.name,
    isDeleted: false, soldUnits: 0, suggestedMenuItemId: null, suggestedMenuItemName: "",
    mapping: row.mappedTo ? { id: row.id, squareCatalogObjectId: row.id, squareObjectId: `VAR${row.id}`, squareObjectType: "ITEM_VARIATION", squareObjectName: row.name, squareItemName: row.name, mappingType: "menu_item", flowtallyEntityType: "menu_item", flowtallyEntityId: row.mappedTo, status: "mapped", mappedByUserId: 1, createdAt: null, updatedAt: null } : null,
  }));
}

function importPreview(world: World) {
  return {
    locationId: 7,
    summary: { new: world.imported ? 0 : 2, mapped: world.imported ? 2 : 0, recipe_needed: world.imported ? 2 : 0, inactive: 0, conflict: 0 },
    entries: world.catalog.map((row) => ({ squareCatalogObjectId: row.id, squareObjectId: `VAR${row.id}`, name: row.name, parentName: "", category: "", sellingPrice: 5, state: world.imported ? "recipe_needed" : "new", menuItemId: world.imported ? 11 : null, isDeleted: false })),
  };
}

async function installWorld(page: Page, world: World) {
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    const method = request.method();
    const body = (() => {
      try {
        return JSON.parse(request.postData() ?? "{}");
      } catch {
        return {};
      }
    })();
    if (method === "POST") world.posts.push({ path: pathname, body });

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
    if (pathname === "/api/integrations/clover/status") return json(route, { enabled: false, connection: null });
    if (pathname === "/api/pilot/menu-costing") return json(route, { menuItems: MENU_ITEMS, recipes: [] });

    if (pathname === "/api/integrations/square/status") {
      world.statusReads += 1;
      return json(route, { connection: connection(world) });
    }
    if (pathname === "/api/integrations/square/catalog/mappings" && method === "GET") {
      world.catalogReads += 1;
      const rows = candidates(world);
      const mapped = rows.filter((row) => row.mapping).length;
      return json(route, {
        connection: connection(world), menuItems: MENU_ITEMS, mappings: rows, unmappedVariations: [],
        mappingCoverage: { mappedVariationCount: mapped, totalVariationCount: rows.length, mappedPercent: rows.length ? (mapped / rows.length) * 100 : 0 },
      });
    }

    const postKey = `${method} ${pathname}`;
    const mutating = [
      "POST /api/integrations/square/locations/sync", "POST /api/integrations/square/catalog/sync", "POST /api/integrations/square/orders/sync",
      "POST /api/integrations/square/location-mappings", "POST /api/integrations/square/catalog/mappings", "POST /api/integrations/square/catalog/menu-import",
    ];
    if (mutating.includes(postKey)) {
      if (world.delayMs) await new Promise((resolve) => setTimeout(resolve, world.delayMs));
      if (world.failNext.has(postKey)) {
        world.failNext.delete(postKey);
        return json(route, { error: "Square is unavailable right now." }, 503);
      }
      if (postKey.endsWith("/catalog/sync")) world.catalog.push(...world.pendingCatalog.splice(0));
      if (postKey.endsWith("/location-mappings")) world.locationMapping = Number(body.restaurantLocationId);
      if (postKey.endsWith("/catalog/mappings")) {
        const row = world.catalog.find((entry) => entry.id === Number(body.squareCatalogObjectId));
        if (row) row.mappedTo = String(body.flowtallyEntityId ?? "");
      }
      if (postKey.endsWith("/menu-import")) {
        world.imported = true;
        return json(route, { ...importPreview(world), result: { created: 2 } });
      }
      return json(route, { connection: connection(world), job: { id: 1, status: "ok" } });
    }
    if (method === "GET" && pathname === "/api/integrations/square/catalog/menu-import") return json(route, importPreview(world));

    return json(route, { error: `Unmocked ${method} ${pathname}` }, 404);
  });
}

async function expectNoOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
}

async function openSquare(page: Page) {
  await page.goto("/app/square", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Location mapping" })).toBeVisible();
}

async function openRecovery(page: Page) {
  await page.getByText("Troubleshooting and recovery").click();
}

for (const viewport of VIEWPORTS) {
  test.describe(`Square page at ${viewport.width}px`, () => {
    test.use({ viewport });

    test("renders the connected page without horizontal overflow", async ({ page }) => {
      await installWorld(page, newWorld());
      await openSquare(page);
      await expect(page.getByRole("heading", { name: "Menu mapping" })).toBeVisible();
      await expect(page.getByText("Latte - Regular")).toBeVisible();
      await expect(page.getByRole("button", { name: "Review import" })).toBeVisible();
      await expectNoOverflow(page);
    });

    test("location mapping save shows success and survives failure with a retry", async ({ page }) => {
      const world = newWorld();
      await installWorld(page, world);
      await openSquare(page);
      const select = page.locator("#pilot-square-location-5");
      await select.selectOption("7");
      world.failNext.add("POST /api/integrations/square/location-mappings");
      await page.getByRole("button", { name: "Save mapping" }).first().click();
      await expect(page.getByText("Square is unavailable right now.")).toBeVisible();
      await expect(page.getByText("Unmapped", { exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Save mapping" }).first().click();
      await expect(page.getByText("location-5 completed.")).toBeVisible();
      await expect(page.getByText("Mapped", { exact: true }).first()).toBeVisible();
      expect(world.posts.filter((post) => post.path.endsWith("/location-mappings"))).toHaveLength(2);
      await expectNoOverflow(page);
    });

    test("menu item mapping save re-fetches and shows failure then success", async ({ page }) => {
      const world = newWorld();
      await installWorld(page, world);
      await openSquare(page);
      const select = page.locator("#pilot-square-menu-item-101");
      await select.selectOption("11");
      world.failNext.add("POST /api/integrations/square/catalog/mappings");
      const saveRow = page.locator("div.rounded-2xl", { has: select }).getByRole("button", { name: "Save mapping" });
      await saveRow.click();
      await expect(page.getByText("Square is unavailable right now.")).toBeVisible();
      const readsBefore = world.catalogReads;
      await saveRow.click();
      await expect(page.getByText("catalog-101 completed.")).toBeVisible();
      await expect.poll(() => world.catalogReads).toBeGreaterThan(readsBefore);
      await expect(page.locator("div.rounded-2xl", { has: select }).getByText("Mapped", { exact: true })).toBeVisible();
    });

    test("Refresh catalog blocks duplicate clicks and shows new Square items without a reload", async ({ page }) => {
      const world = newWorld();
      world.delayMs = 400;
      await installWorld(page, world);
      await openSquare(page);
      await openRecovery(page);
      const button = page.getByRole("button", { name: "Refresh catalog" });
      await button.click();
      await expect(page.getByRole("button", { name: "Refreshing catalog…" })).toBeDisabled();
      await expect(page.getByRole("button", { name: "Reconcile orders" })).toBeDisabled();
      await expect(page.getByText("Catalog refresh completed.")).toBeVisible();
      expect(world.posts.filter((post) => post.path.endsWith("/catalog/sync"))).toHaveLength(1);
      // Authoritative state: the variation that arrived with the sync must be mappable now, not after a manual reload.
      await expect(page.getByText("Croissant - Plain")).toBeVisible();
    });

    test("Reconcile Square data: failure is visible and retry completes all three syncs", async ({ page }) => {
      const world = newWorld();
      await installWorld(page, world);
      await openSquare(page);
      await openRecovery(page);
      world.failNext.add("POST /api/integrations/square/catalog/sync");
      await page.getByRole("button", { name: "Reconcile Square data" }).click();
      await expect(page.getByText("Square is unavailable right now.")).toBeVisible();
      await expect(page.getByRole("button", { name: "Reconcile Square data" })).toBeEnabled();
      await page.getByRole("button", { name: "Reconcile Square data" }).click();
      await expect(page.getByText("Square reconciliation completed.")).toBeVisible();
      await expect(page.getByText("Croissant - Plain")).toBeVisible();
      expect(world.posts.some((post) => post.path.endsWith("/orders/sync"))).toBe(true);
    });

    test("menu import review then import, with a failed attempt first", async ({ page }) => {
      const world = newWorld();
      await installWorld(page, world);
      await openSquare(page);
      await page.getByRole("button", { name: "Review import" }).click();
      await expect(page.getByText("Latte - Regular").last()).toBeVisible();
      world.failNext.add("POST /api/integrations/square/catalog/menu-import");
      await page.getByRole("button", { name: "Import menu" }).click();
      await expect(page.getByText("Square is unavailable right now.")).toBeVisible();
      await page.getByRole("button", { name: "Import menu" }).click();
      await expect(page.getByText("Square menu import completed.")).toBeVisible();
      await expect(page.getByText("Recipe needed").first()).toBeVisible();
      await expectNoOverflow(page);
    });
  });
}
