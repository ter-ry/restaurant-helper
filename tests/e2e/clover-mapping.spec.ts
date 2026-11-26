import { expect, test, type Page, type Route } from "@playwright/test";

/**
 * Browser acceptance for the Clover connection and explicit menu-mapping UI (#341).
 * The API is a small stateful fake that mirrors the documented server rules, so this exercises the real React UI,
 * its post-mutation server refresh, failure handling and duplicate-submit protection at phone and tablet widths.
 * No live data, no Clover sandbox, and Clover inventory writes are not involved.
 */

type Mapping = { id: number; organizationId: number; restaurantLocationId: number; cloverItemId: string; flowtallyMenuItemId: number; flowtallyMenuItemName: string; hasRecipe: boolean };
type World = {
  connected: boolean;
  locationMapped: boolean;
  mappings: Mapping[];
  nextId: number;
  writes: { method: string; path: string; body: any }[];
  mappingReads: number;
  statusReads: number;
  /** Next write fails with this status, then clears. */
  failNext: { status: number; message: string } | null;
  writeDelayMs: number;
};

const ORG = { id: 42, name: "Clover Cafe", lifecycleStatus: "ACTIVE", setupStatus: "COMPLETE", subscriptionStatus: "ACTIVE", setupTemplateKey: "GENERIC_RESTAURANT", setupFeeStatus: "confirmed", isProspect: false, activeAt: "2026-01-01T00:00:00Z", setupCompletedAt: "2026-01-01T00:00:00Z" };
const LOCATIONS = [{ id: 7, name: "Queen St Cafe", city: "Toronto", region: "ON", timezone: "America/Toronto" }];
const MODULES = ["PURCHASES", "INVENTORY", "REORDER_PLANS", "DAILY_CLOSE", "SQUARE_INTEGRATION"];
const VIEWPORTS = [{ width: 390, height: 844 }, { width: 768, height: 1024 }];
const MENU = [
  { id: 11, name: "Flat White", active: true, recipe: { id: 1 } },
  { id: 12, name: "Butter Croissant", active: true, recipe: null },
];
const CATALOG = {
  readOnly: true, merchantName: "Clover Cafe Inc.", location: { id: "CL1", name: "Queen St" }, itemCount: 2,
  items: ["Latte", "Croissant"].map((name, index) => ({ id: `CI${index + 1}`, name, priceCents: 450 + index * 100, active: true, deleted: false, hidden: false, available: true, itemGroupId: null, optionIds: [], categories: [], modifierGroups: [] })),
};

const json = (route: Route, payload: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(payload) });

function newWorld(): World {
  return { connected: true, locationMapped: false, mappings: [], nextId: 1, writes: [], mappingReads: 0, statusReads: 0, failNext: null, writeDelayMs: 0 };
}

async function installWorld(page: Page, world: World) {
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    const method = request.method();
    const body = (() => { try { return JSON.parse(request.postData() ?? "{}"); } catch { return {}; } })();

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
      return json(route, { organizations: [{ organization: ORG, membershipRole: "owner", selected: true }], currentOrganizationId: ORG.id, currentMembershipId: 1, currentLocationId: 7, currentOrganization: bundle, ...bundle });
    }
    if (pathname === "/api/integrations/square/status") return json(route, { connection: null });
    if (pathname === "/api/integrations/square/catalog-mappings") return json(route, { mappings: [], unmappedVariations: [], mappingCoverage: null });
    if (pathname === "/api/pilot/menu-costing") return json(route, { menuItems: MENU, ingredients: [], summary: {} });

    if (pathname === "/api/integrations/clover/status") {
      world.statusReads += 1;
      return json(route, {
        enabled: true, catalogEnabled: true, mappingEnabled: true, shadowOrdersEnabled: false,
        connection: { status: world.connected ? "connected" : "disconnected", environment: "sandbox", region: "north_america", merchantId: "M1", merchantName: "Clover Cafe Inc." },
      });
    }
    if (pathname === "/api/integrations/clover/catalog") return json(route, CATALOG);
    if (pathname === "/api/integrations/clover/mappings") {
      world.mappingReads += 1;
      return json(route, {
        enabled: true,
        locationMapping: world.locationMapped ? { id: 1, restaurantLocationId: 7, cloverLocationId: "CL1" } : null,
        menuMappings: world.locationMapped ? world.mappings : [],
      });
    }

    if (method !== "GET" && pathname.startsWith("/api/integrations/clover/")) {
      world.writes.push({ method, path: pathname, body });
      if (world.writeDelayMs) await new Promise((resolve) => setTimeout(resolve, world.writeDelayMs));
      if (world.failNext) {
        const failure = world.failNext;
        world.failNext = null;
        return json(route, { error: failure.message }, failure.status);
      }
      if (pathname === "/api/integrations/clover/location-mapping") {
        if (method === "POST") { world.locationMapped = true; return json(route, { locationMapping: { id: 1, restaurantLocationId: 7, cloverLocationId: "CL1" } }); }
        world.locationMapped = false; world.mappings = [];
        return json(route, { ok: true });
      }
      if (pathname === "/api/integrations/clover/menu-mappings" && method === "POST") {
        const menu = MENU.find((entry) => entry.id === Number(body.flowtallyMenuItemId))!;
        const mapping: Mapping = { id: world.nextId++, organizationId: 42, restaurantLocationId: 7, cloverItemId: body.cloverItemId, flowtallyMenuItemId: menu.id, flowtallyMenuItemName: menu.name, hasRecipe: Boolean(menu.recipe) };
        world.mappings.push(mapping);
        return json(route, { mapping }, 201);
      }
      const edit = pathname.match(/^\/api\/integrations\/clover\/menu-mappings\/(\d+)$/);
      if (edit && method === "PATCH") {
        const mapping = world.mappings.find((entry) => entry.id === Number(edit[1]))!;
        const menu = MENU.find((entry) => entry.id === Number(body.flowtallyMenuItemId))!;
        Object.assign(mapping, { flowtallyMenuItemId: menu.id, flowtallyMenuItemName: menu.name, hasRecipe: Boolean(menu.recipe) });
        return json(route, { mapping });
      }
      if (edit && method === "DELETE") {
        world.mappings = world.mappings.filter((entry) => entry.id !== Number(edit[1]));
        return json(route, { ok: true });
      }
      if (pathname === "/api/integrations/clover/disconnect" && method === "POST") {
        world.connected = false;
        return json(route, { connection: { status: "disconnected", environment: "sandbox", region: "north_america" }, remoteRevocation: "revoked" });
      }
    }
    return json(route, { error: `Unmocked ${method} ${pathname}` }, 404);
  });
}

async function openMapping(page: Page) {
  await page.goto("/app/pos/clover", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Preview catalog" }).click();
  const panel = page.getByLabel("Clover menu mapping");
  await expect(panel.getByText("Latte")).toBeVisible();
  return panel;
}

async function expectNoOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
}

for (const viewport of VIEWPORTS) {
  test.describe(`Clover mapping at ${viewport.width}px`, () => {
    test.use({ viewport });

    test("confirm location, map, change and remove a menu item with visible progress and server refresh", async ({ page }) => {
      const world = newWorld();
      await installWorld(page, world);
      const panel = await openMapping(page);
      await expectNoOverflow(page);
      await expect(panel.getByLabel("Map Latte")).toBeDisabled();

      await panel.getByRole("button", { name: "Confirm location" }).click();
      await expect(panel.getByText("Clover location confirmed.")).toBeVisible();
      await expect(panel.getByText("Confirmed", { exact: true })).toBeVisible();
      expect(world.writes.filter((write) => write.path.endsWith("/location-mapping"))).toHaveLength(1);

      const readsBefore = world.mappingReads;
      await panel.getByLabel("Map Latte").selectOption({ label: "Flat White · recipe" });
      await panel.getByRole("button", { name: "Save mapping" }).click();
      await expect(panel.getByText("Saved mapping for Latte.")).toBeVisible();
      await expect(panel.getByText("Mapped to Flat White · recipe ready")).toBeVisible();
      expect(world.mappingReads).toBeGreaterThan(readsBefore);
      await expectNoOverflow(page);

      await panel.getByLabel("Map Latte").selectOption({ label: "Butter Croissant · no recipe" });
      await panel.getByRole("button", { name: "Save mapping" }).click();
      await expect(panel.getByText("Mapped to Butter Croissant · recipe missing")).toBeVisible();
      expect(world.writes.some((write) => write.method === "PATCH")).toBe(true);

      await panel.getByRole("button", { name: "Remove" }).last().click();
      await expect(panel.getByText("Removed mapping for Butter Croissant.")).toBeVisible();
      await expect(panel.getByText("Unmapped")).toHaveCount(2);
      expect(world.mappings).toHaveLength(0);
    });

    test("a failed save shows the error, keeps the choice, and retry succeeds with one stored mapping", async ({ page }) => {
      const world = newWorld();
      world.locationMapped = true;
      await installWorld(page, world);
      const panel = await openMapping(page);

      world.failNext = { status: 409, message: "This Clover item is already mapped." };
      await panel.getByLabel("Map Latte").selectOption({ label: "Flat White · recipe" });
      await panel.getByRole("button", { name: "Save mapping" }).click();
      await expect(panel.getByRole("alert")).toHaveText("This Clover item is already mapped.");
      await expect(panel.getByLabel("Map Latte")).toHaveValue("11");
      expect(world.mappings).toHaveLength(0);

      await panel.getByRole("button", { name: "Save mapping" }).click();
      await expect(panel.getByText("Saved mapping for Latte.")).toBeVisible();
      await expect(panel.getByRole("alert")).toHaveCount(0);
      expect(world.mappings).toHaveLength(1);
    });

    test("double-clicking Save sends one request and shows progress", async ({ page }) => {
      const world = newWorld();
      world.locationMapped = true;
      world.writeDelayMs = 400;
      await installWorld(page, world);
      const panel = await openMapping(page);

      await panel.getByLabel("Map Latte").selectOption({ label: "Flat White · recipe" });
      const save = panel.getByRole("button", { name: "Save mapping" });
      await save.dblclick({ force: true });
      await expect(panel.getByText("Saving mapping…")).toBeVisible();
      await expect(panel.getByText("Saved mapping for Latte.")).toBeVisible();
      expect(world.writes.filter((write) => write.method === "POST" && write.path.endsWith("/menu-mappings"))).toHaveLength(1);
    });

    test("disconnect asks first, shows the result and re-reads status; cancelling sends nothing", async ({ page }) => {
      const world = newWorld();
      await installWorld(page, world);
      await page.goto("/app/pos/clover", { waitUntil: "domcontentloaded" });
      const disconnect = page.getByRole("button", { name: "Disconnect", exact: true });
      await expect(disconnect).toBeVisible();

      page.once("dialog", (dialog) => void dialog.dismiss());
      await disconnect.click();
      expect(world.writes).toHaveLength(0);

      const reads = world.statusReads;
      world.failNext = { status: 500, message: "Clover is unavailable." };
      page.once("dialog", (dialog) => void dialog.accept());
      await disconnect.click();
      await expect(page.getByRole("alert").filter({ hasText: "Clover is unavailable." })).toBeVisible();
      await expect(disconnect).toBeEnabled();

      page.once("dialog", (dialog) => void dialog.accept());
      await disconnect.click();
      await expect(page.getByText("Clover disconnected.")).toBeVisible();
      await expect(page.getByRole("button", { name: "Connect Clover sandbox" })).toBeVisible();
      expect(world.statusReads).toBeGreaterThan(reads);
      expect(world.writes.filter((write) => write.path.endsWith("/disconnect"))).toHaveLength(2);
      await expectNoOverflow(page);
    });
  });
}
