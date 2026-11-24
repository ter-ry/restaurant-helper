import { expect, test, type Page, type Route } from "@playwright/test";

/**
 * Browser acceptance (#349) for inventory create-item and supplier archive/restore at phone and tablet
 * widths. The API is a small stateful fake (server state changes only through the mocked endpoints), so these tests
 * exercise the real React UI, its in-progress / success / failure states, duplicate-submit guards and server refresh.
 * No live data and no external services.
 */

const ORG = { id: 42, name: "Showcase Cafe", lifecycleStatus: "ACTIVE", setupStatus: "COMPLETE", subscriptionStatus: "ACTIVE", setupTemplateKey: "GENERIC_RESTAURANT", setupFeeStatus: "confirmed", isProspect: false, activeAt: "2026-01-01T00:00:00Z", setupCompletedAt: "2026-01-01T00:00:00Z" };
const LOCATIONS = [
  { id: 7, name: "Queen St Cafe", city: "Toronto", region: "ON" },
  { id: 9, name: "King St Kiosk", city: "Toronto", region: "ON" },
];
const MODULES = ["PURCHASES", "INVENTORY", "REORDER_PLANS", "DAILY_CLOSE", "STOCK_COUNTS"];
const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1280, height: 800 },
];

const json = (route: Route, payload: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(payload) });
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Item = { id: number; name: string; category: string; stockUnit: string; currentOnHand: number; minQuantity: number; parLevel: number; supplierId: number | null; active: boolean };
type Supplier = { id: number; name: string; isActive: boolean };

type World = {
  items: Item[];
  suppliers: Supplier[];
  posts: { path: string; method: string; body: any }[];
  delayMs: number;
  refuseNext: { status: number; message: string } | null;
  inventoryReads: number;
};

const newWorld = (): World => ({
  items: [{ id: 30, name: "Chicken Breast", category: "Poultry", stockUnit: "kg", currentOnHand: 12, minQuantity: 1, parLevel: 5, supplierId: null, active: true }],
  suppliers: [{ id: 3, name: "Cedar Meats", isActive: true }],
  posts: [], delayMs: 0, refuseNext: null, inventoryReads: 0,
});

const itemPayload = (item: Item) => ({
  id: item.id, organizationId: 42, locationId: 7, supplierId: item.supplierId, name: item.name, normalizedName: item.name.toLowerCase(), category: item.category,
  stockUnit: item.stockUnit, currentOnHand: item.currentOnHand, minQuantity: item.minQuantity, parLevel: item.parLevel,
  preferredSupplierName: "", latestPurchasePrice: 4, averageUnitCost: 4, lastPurchaseUnit: item.stockUnit, lastPurchaseConversionFactor: 1,
  lastReceivedAt: null, lastCountedAt: null, averageDailyUsage: 0, estimatedCostMethod: "weighted_average", active: item.active, notes: "",
  createdByUserId: 1, updatedByUserId: 1, createdAt: null, updatedAt: null,
});

const supplierPayload = (supplier: Supplier) => ({
  id: supplier.id, organizationId: 42, name: supplier.name, normalizedName: supplier.name.toLowerCase(), categoryFocus: "Meat", contactName: "", contactPhone: "",
  contactEmail: "", orderingNotes: "", notes: "", isActive: supplier.isActive, inventoryItemCount: 0, purchaseInvoiceCount: 0, supplierItemMappingCount: 0,
  latestInvoiceDate: null, historicalReferenceCount: 0, recentInvoices: [], recentMappings: [],
});

async function installWorld(page: Page, world: World) {
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    const method = request.method();
    let body: any = {};
    try { body = JSON.parse(request.postData() ?? "{}"); } catch { /* no body */ }
    if (method !== "GET") world.posts.push({ path: pathname, method, body });

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
    if (pathname === "/api/pilot/suppliers" && method === "GET") return json(route, { suppliers: world.suppliers.map(supplierPayload) });
    if (pathname === "/api/pilot/inventory" && method === "GET") {
      world.inventoryReads += 1;
      return json(route, {
        items: world.items.map(itemPayload), movements: [], countSessions: [], reorderPlan: { suggestions: [], groupedBySupplier: [] },
        summary: { inventoryItemCount: world.items.length, inventoryOutOfStockCount: 0, inventoryReorderNowCount: 0, inventoryLowStockCount: 0, inventoryValue: 0 },
      });
    }
    if (pathname === "/api/pilot/inventory/negative-stock") return json(route, { count: 0, posCausedCount: 0, items: [] });
    const detail = pathname.match(/^\/api\/pilot\/inventory\/items\/(\d+)$/);
    if (detail && method === "GET") {
      const item = world.items.find((entry) => entry.id === Number(detail[1]));
      return item ? json(route, { item: itemPayload(item), purchaseHistory: [], movementHistory: [], supplierMappings: [] }) : json(route, { error: "Not found." }, 404);
    }
    if (/cost-verifications$/.test(pathname)) return json(route, { itemId: 30, verifications: [] });

    const mutate = async (apply: () => unknown, status = 200) => {
      if (world.delayMs) await sleep(world.delayMs);
      if (world.refuseNext) {
        const refusal = world.refuseNext;
        world.refuseNext = null;
        return json(route, { error: refusal.message, errors: {} }, refusal.status);
      }
      return json(route, apply(), status);
    };

    if (pathname === "/api/pilot/inventory/items" && method === "POST") {
      return mutate(() => {
        const item: Item = { id: 40, name: body.name, category: body.category ?? "", stockUnit: body.stockUnit ?? "each", currentOnHand: Number(body.currentOnHand ?? 0), minQuantity: 0, parLevel: 0, supplierId: null, active: true };
        world.items.push(item);
        return itemPayload(item);
      }, 201);
    }
    const supplier = pathname.match(/^\/api\/pilot\/suppliers\/(\d+)$/);
    if (supplier && method === "PATCH") {
      return mutate(() => {
        const target = world.suppliers.find((entry) => entry.id === Number(supplier[1]))!;
        if (typeof body.isActive === "boolean") target.isActive = body.isActive;
        return supplierPayload(target);
      });
    }
    return json(route, { error: `Unmocked ${method} ${pathname}` }, 404);
  });
}

async function expectNoOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
}

for (const viewport of VIEWPORTS) {
  test.describe(`inventory create item and supplier archive at ${viewport.width}px`, () => {
    test.use({ viewport });

    test("create item: failure keeps the entry, success sends one create and shows the server item", async ({ page }) => {
      const world = newWorld();
      await installWorld(page, world);
      await page.goto("/app/inventory", { waitUntil: "domcontentloaded" });
      await expect(page.getByText("Chicken Breast").first()).toBeVisible();
      if (viewport.width < 640) await page.getByRole("button", { name: "Open inventory actions" }).click();
      await page.getByRole("button", { name: "Create item" }).first().click();
      await page.getByLabel("Item name").fill("Oat Milk");
      await expectNoOverflow(page);

      world.refuseNext = { status: 409, message: "An item with this name already exists." };
      await page.getByRole("button", { name: "Create item", exact: true }).last().click();
      await expect(page.getByText("An item with this name already exists.")).toBeVisible();
      await expect(page.getByLabel("Item name")).toHaveValue("Oat Milk");
      expect(world.items).toHaveLength(1);

      world.delayMs = 500;
      const readsBefore = world.inventoryReads;
      await page.getByRole("button", { name: "Create item", exact: true }).last().click();
      await expect(page.getByRole("button", { name: "Create item", exact: true }).last()).toBeDisabled();
      await expect(page.getByText("Oat Milk saved.")).toBeVisible();
      expect(world.posts.filter((post) => post.path === "/api/pilot/inventory/items")).toHaveLength(2);
      expect(world.items).toHaveLength(2);
      expect(world.inventoryReads).toBeGreaterThan(readsBefore);
      await expectNoOverflow(page);
    });

    test("supplier archive: failure is shown, success archives once and the list re-reads server state", async ({ page }) => {
      const world = newWorld();
      await installWorld(page, world);
      await page.goto("/app/inventory", { waitUntil: "domcontentloaded" });
      await page.getByRole("tab", { name: /Suppliers/ }).click().catch(async () => { await page.getByText("Suppliers", { exact: false }).first().click(); });
      await page.getByText("Cedar Meats").first().click();
      await expectNoOverflow(page);

      world.refuseNext = { status: 409, message: "Supplier cannot be archived right now." };
      await page.getByRole("button", { name: "Archive supplier" }).click();
      await expect(page.getByText("Supplier cannot be archived right now.")).toBeVisible();
      expect(world.suppliers[0].isActive).toBe(true);

      world.delayMs = 500;
      await page.getByRole("button", { name: "Archive supplier" }).click();
      await expect(page.getByRole("button", { name: "Working…" })).toBeDisabled();
      await expect(page.getByText(/Supplier Cedar Meats archived\./)).toBeVisible();
      expect(world.suppliers[0].isActive).toBe(false);
      expect(world.posts.filter((post) => post.method === "PATCH")).toHaveLength(2);
      await expect(page.getByRole("button", { name: "Restore supplier" })).toBeVisible();
      await expectNoOverflow(page);
    });
  });
}
