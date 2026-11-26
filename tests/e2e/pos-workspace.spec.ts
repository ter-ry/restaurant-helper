import { expect, test, type Page, type Route } from "@playwright/test";

/**
 * Browser acceptance for the provider-aware POS workspace (/app/pos).
 * Mocked API only (no Flask/PostgreSQL, no Square or Clover): proves provider resolution per location,
 * separation of the two workspaces, onboarding, conflict fail-safe, legacy-URL compatibility and 390/768/1280 layouts.
 * This is NOT live provider acceptance.
 */

type World = {
  currentLocationId: number;
  squareMappedLocations: number[];
  squareConnected: boolean;
  cloverEnabled: boolean;
  cloverConnected: boolean;
  cloverMappedLocations: number[];
  failSquareStatus: boolean;
  mutations: string[];
};

const ORG = { id: 42, name: "Showcase Cafe", lifecycleStatus: "ACTIVE", setupStatus: "COMPLETE", subscriptionStatus: "ACTIVE", setupTemplateKey: "GENERIC_RESTAURANT", setupFeeStatus: "confirmed", isProspect: false, activeAt: "2026-01-01T00:00:00Z", setupCompletedAt: "2026-01-01T00:00:00Z" };
const LOCATIONS = [
  { id: 7, name: "Queen St Cafe", city: "Toronto", region: "ON", timezone: "America/Toronto" },
  { id: 9, name: "King St Kiosk", city: "Toronto", region: "ON", timezone: "America/Toronto" },
];
const MODULES = ["PURCHASES", "INVENTORY", "SQUARE_INTEGRATION", "DAILY_CLOSE", "MENU_COSTING"];
const VIEWPORTS = [{ width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1280, height: 900 }];

const json = (route: Route, payload: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(payload) });

function newWorld(overrides: Partial<World> = {}): World {
  return { currentLocationId: 7, squareMappedLocations: [], squareConnected: false, cloverEnabled: true, cloverConnected: false, cloverMappedLocations: [], failSquareStatus: false, mutations: [], ...overrides };
}

function squareConnection(world: World) {
  return {
    id: 1, organizationId: 42, organization: { id: 42, name: ORG.name }, environment: "production", squareMerchantId: "M1", status: "connected",
    tokenExpiresAt: null, revokedAt: null, lastSyncAt: "2026-11-16T12:00:00Z", lastOrderActivityAt: new Date().toISOString(), syncStatus: "ok", syncError: "",
    catalogCount: 0, orderCount: 0, locationCount: 1, dailySalesCount: 0,
    locations: [{ id: 5, squareLocationId: "SQ1", name: "Square HQ", status: "ACTIVE", rawPayload: {}, mappings: world.squareMappedLocations.map((id) => ({ id, squareLocationId: 5, restaurantLocationId: id, restaurantLocation: { id, name: "Mapped" }, mappedByUserId: 1, mappedAt: null })) }],
    catalogObjects: [], orders: [], dailySales: [], syncJobs: [], webhookEvents: [],
  };
}

async function install(page: Page, world: World) {
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    const method = request.method();
    if (method !== "GET") world.mutations.push(`${method} ${pathname}`);
    const current = LOCATIONS.find((l) => l.id === world.currentLocationId)!;
    if (pathname === "/api/auth/me") {
      return json(route, { user: { id: 1, email: "owner@example.com", isActive: true, createdAt: null, updatedAt: null }, platformRole: null, membershipRole: "owner", currentOrganizationId: ORG.id, currentLocationId: current.id, csrfToken: "csrf-token", enabledModuleKeys: MODULES, organizations: [{ organization: ORG, membershipRole: "owner", selected: true }] });
    }
    if (pathname === "/api/auth/csrf") return json(route, { csrfToken: "csrf-token" });
    if (pathname.startsWith("/api/organizations")) {
      const bundle = { organization: ORG, restaurantLocations: LOCATIONS, currentLocation: current, membershipRole: "owner", enabledModuleKeys: MODULES };
      return json(route, { organizations: [{ organization: ORG, membershipRole: "owner", selected: true }], currentOrganizationId: ORG.id, currentMembershipId: 1, currentLocationId: current.id, currentOrganization: bundle, ...bundle });
    }
    if (pathname === "/api/integrations/square/status") {
      if (world.failSquareStatus) return json(route, { error: "Square status is unavailable." }, 503);
      return json(route, { connection: world.squareConnected ? squareConnection(world) : null });
    }
    if (pathname === "/api/integrations/clover/status") {
      if (!world.cloverEnabled) return json(route, { enabled: false, connection: null });
      return json(route, { enabled: true, catalogEnabled: true, mappingEnabled: true, connection: { environment: "sandbox", region: "north_america", merchantName: "Sandbox Cafe", status: world.cloverConnected ? "connected" : "disconnected" } });
    }
    if (pathname === "/api/integrations/clover/mappings") {
      const mapped = world.cloverMappedLocations.includes(current.id);
      return json(route, { enabled: true, locationMapping: mapped ? { id: 1, organizationId: 42, restaurantLocationId: current.id, cloverMerchantId: "CM1", cloverLocationId: null, confirmedAt: null } : null, menuMappings: [] });
    }
    if (pathname === "/api/integrations/square/catalog/mappings") return json(route, { connection: world.squareConnected ? squareConnection(world) : null, menuItems: [], mappings: [], unmappedVariations: [], mappingCoverage: { mappedVariationCount: 0, totalVariationCount: 0, mappedPercent: 0 } });
    if (pathname === "/api/integrations/square/catalog/menu-import") return json(route, { summary: {}, items: [] });
    if (pathname === "/api/pilot/menu-costing") return json(route, { menuItems: [], ingredients: [], summary: {} });
    return json(route, { error: `Unmocked ${method} ${pathname}` }, 404);
  });
}

async function expectNoOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
}

for (const viewport of VIEWPORTS) {
  test.describe(`POS workspace at ${viewport.width}px`, () => {
    test.use({ viewport });

    test("Square-only location opens the Square workspace with no Clover panel", async ({ page }) => {
      const world = newWorld({ squareConnected: true, squareMappedLocations: [7] });
      await install(page, world);
      await page.goto("/app/pos", { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("heading", { name: "Location mapping" })).toBeVisible();
      await expect(page).toHaveURL(/\/app\/pos\/square$/);
      await expect(page.getByText(/clover/i)).toHaveCount(0);
      expect(world.mutations).toEqual([]);
      await expectNoOverflow(page);
    });

    test("Clover-only location opens the Clover workspace with no Square connection panel", async ({ page }) => {
      const world = newWorld({ cloverConnected: true, cloverMappedLocations: [7] });
      await install(page, world);
      await page.goto("/app/pos", { waitUntil: "domcontentloaded" });
      await expect(page).toHaveURL(/\/app\/pos\/clover$/);
      await expect(page.getByText("Clover sandbox", { exact: true })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Location mapping" })).toHaveCount(0);
      expect(world.mutations).toEqual([]);
      await expectNoOverflow(page);
    });

    test("unconnected location shows provider selection and mutates nothing", async ({ page }) => {
      const world = newWorld();
      await install(page, world);
      await page.goto("/app/pos", { waitUntil: "domcontentloaded" });
      await expect(page.getByText("Connect your point-of-sale")).toBeVisible();
      await expect(page.getByRole("link", { name: "Set up Square" })).toBeVisible();
      await expect(page.getByRole("link", { name: "Set up Clover" })).toBeVisible();
      expect(world.mutations).toEqual([]);
      await expectNoOverflow(page);
    });

    test("different locations of one organization resolve to different providers", async ({ page }) => {
      const world = newWorld({ squareConnected: true, squareMappedLocations: [7], cloverConnected: true, cloverMappedLocations: [9], currentLocationId: 9 });
      await install(page, world);
      await page.goto("/app/pos", { waitUntil: "domcontentloaded" });
      await expect(page).toHaveURL(/\/app\/pos\/clover$/);
      await expect(page.getByText("Clover sandbox", { exact: true })).toBeVisible();
      await expectNoOverflow(page);
    });

    test("conflicting providers fail safe: no workspace and no mutation", async ({ page }) => {
      const world = newWorld({ squareConnected: true, squareMappedLocations: [7], cloverConnected: true, cloverMappedLocations: [7] });
      await install(page, world);
      await page.goto("/app/pos/square", { waitUntil: "domcontentloaded" });
      await expect(page.getByText("Conflicting point-of-sale setup")).toBeVisible();
      await expect(page.getByRole("heading", { name: "Location mapping" })).toHaveCount(0);
      await expect(page.getByText("Clover sandbox", { exact: true })).toHaveCount(0);
      expect(world.mutations).toEqual([]);
      await expectNoOverflow(page);
    });

    test("status failure shows a retryable fail-safe state, then recovers", async ({ page }) => {
      const world = newWorld({ squareConnected: true, squareMappedLocations: [7], failSquareStatus: true });
      await install(page, world);
      await page.goto("/app/pos", { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("alert")).toContainText("could not confirm");
      world.failSquareStatus = false;
      await page.getByRole("button", { name: "Retry" }).click();
      await expect(page.getByRole("heading", { name: "Location mapping" })).toBeVisible();
    });

    test("legacy /app/square keeps working and the sidebar entry is POS", async ({ page }) => {
      const world = newWorld({ squareConnected: true, squareMappedLocations: [7] });
      await install(page, world);
      await page.goto("/app/square?error=square_authorization_denied", { waitUntil: "domcontentloaded" });
      await expect(page).toHaveURL(/\/app\/pos\/square\?error=square_authorization_denied$/);
      await expect(page.getByRole("heading", { name: "Location mapping" })).toBeVisible();
      if (viewport.width >= 1024) {
        await expect(page.getByRole("link", { name: "POS", exact: true }).first()).toBeVisible();
      }
    });
  });
}
