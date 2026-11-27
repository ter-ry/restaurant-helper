import { expect, test, type Page, type Route } from "@playwright/test";

/**
 * Browser acceptance (#347) for inventory waste and stock adjustment at phone and tablet
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
];

const json = (route: Route, payload: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(payload) });
const refuse = (route: Route, message: string, errors: Record<string, string>, status = 409) => json(route, { error: message, errors }, status);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Item = { id: number; name: string; category: string; stockUnit: string; currentOnHand: number; minQuantity: number; parLevel: number; supplierId: number | null; active: boolean };

type World = {
  items: Item[];
  invoice: { status: string; voidReason: string; voidedAt: string | null; correctedByInvoiceId: number | null };
  posts: { path: string; body: any }[];
  /** Milliseconds to hold mutation responses so the in-progress state can be observed. */
  delayMs: number;
  /** Next mutation: apply on the server but answer 503 (dropped connection after commit). */
  dropNextResponse: boolean;
  /** Next mutation: refuse with this status/error without applying. */
  refuseNext: { status: number; message: string; errors: Record<string, string> } | null;
  /** Remaining GET /api/pilot/inventory calls that should be answered from fresh server state (counted for refresh proof). */
  inventoryReads: number;
  seen: Map<string, unknown>;
  /** Hold GET inventory/item-detail responses this long (a slow re-read after a saved movement). */
  slowReadsMs: number;
  /** Answer the next N GET inventory/item-detail reads with 503. */
  failReads: number;
};

function newWorld(): World {
  return {
    items: [
      { id: 30, name: "Chicken Breast", category: "Poultry", stockUnit: "kg", currentOnHand: 12, minQuantity: 1, parLevel: 5, supplierId: null, active: true },
      { id: 31, name: "Whole Milk", category: "Dairy", stockUnit: "L", currentOnHand: 20, minQuantity: 4, parLevel: 10, supplierId: null, active: true },
      { id: 32, name: "Oat Milk", category: "Dairy", stockUnit: "L", currentOnHand: 8, minQuantity: 2, parLevel: 6, supplierId: null, active: true },
    ],
    invoice: { status: "Completed", voidReason: "", voidedAt: null, correctedByInvoiceId: null },
    posts: [], delayMs: 0, dropNextResponse: false, refuseNext: null, inventoryReads: 0, seen: new Map(), slowReadsMs: 0, failReads: 0,
  };
}

const SUPPLIERS = [{ id: 3, name: "Cedar Meats", isActive: true }, { id: 4, name: "Prairie Dairy", isActive: true }];

const itemPayload = (world: World, item: Item) => ({
  id: item.id, organizationId: 42, locationId: 7, supplierId: item.supplierId, name: item.name, normalizedName: item.name.toLowerCase(), category: item.category,
  stockUnit: item.stockUnit, currentOnHand: item.currentOnHand, minQuantity: item.minQuantity, parLevel: item.parLevel,
  preferredSupplierName: SUPPLIERS.find((supplier) => supplier.id === item.supplierId)?.name ?? "", latestPurchasePrice: 4, averageUnitCost: 4,
  lastPurchaseUnit: item.stockUnit, lastPurchaseConversionFactor: 1, lastReceivedAt: null, lastCountedAt: null, averageDailyUsage: 0.8,
  estimatedCostMethod: "weighted_average", active: item.active, notes: "", createdByUserId: 1, updatedByUserId: 1, createdAt: null, updatedAt: null,
});

async function installWorld(page: Page, world: World) {
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    const method = request.method();
    let body: any = {};
    try { body = JSON.parse(request.postData() ?? "{}"); } catch { /* no body */ }
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
    if (pathname === "/api/pilot/suppliers") return json(route, { suppliers: SUPPLIERS });
    if (method === "GET" && /^\/api\/pilot\/inventory(\/items\/\d+)?$/.test(pathname)) {
      if (world.failReads > 0) {
        world.failReads -= 1;
        return json(route, { error: "The server could not process this request. Try again." }, 503);
      }
      if (world.slowReadsMs) await sleep(world.slowReadsMs);
    }
    if (pathname === "/api/pilot/inventory" && method === "GET") {
      world.inventoryReads += 1;
      return json(route, {
        items: world.items.map((item) => itemPayload(world, item)), movements: [], countSessions: [], reorderPlan: { suggestions: [], groupedBySupplier: [] },
        summary: { inventoryItemCount: world.items.length, inventoryOutOfStockCount: 0, inventoryReorderNowCount: 0, inventoryLowStockCount: 0, inventoryValue: 0 },
      });
    }
    if (pathname === "/api/pilot/inventory/negative-stock") return json(route, { count: 0, posCausedCount: 0, items: [] });
    const detail = pathname.match(/^\/api\/pilot\/inventory\/items\/(\d+)$/);
    if (detail) {
      const item = world.items.find((entry) => entry.id === Number(detail[1]));
      return item ? json(route, { item: itemPayload(world, item), purchaseHistory: [], movementHistory: [], supplierMappings: [] }) : json(route, { error: "Not found." }, 404);
    }
    if (/^\/api\/pilot\/inventory\/items\/\d+\/cost-verifications$/.test(pathname)) return json(route, { itemId: 30, verifications: [] });

    const mutate = async (apply: () => unknown, successStatus = 200) => {
      if (world.delayMs) await sleep(world.delayMs);
      if (world.refuseNext) {
        const refusal = world.refuseNext;
        world.refuseNext = null;
        return refuse(route, refusal.message, refusal.errors, refusal.status);
      }
      return json(route, apply(), successStatus);
    };

    if (pathname === "/api/pilot/inventory/waste-events" && method === "POST") {
      return mutate(() => {
        const item = world.items.find((entry) => entry.id === body.inventoryItemId)!;
        item.currentOnHand -= Number(body.quantity);
        return { id: 1, inventoryItemId: item.id, quantity: Number(body.quantity), unit: body.unit, reason: body.reason, note: body.note ?? "", totalCost: Number(body.quantity) * 4 };
      }, 201);
    }
    const adjustment = pathname.match(/^\/api\/pilot\/inventory\/items\/(\d+)\/adjustments$/);
    if (adjustment && method === "POST") {
      return mutate(() => {
        const item = world.items.find((entry) => entry.id === Number(adjustment[1]))!;
        item.currentOnHand += Number(body.quantityDelta);
        return { id: 2, inventoryItemId: item.id, inventoryItemName: item.name, quantityDelta: Number(body.quantityDelta), quantityAfter: item.currentOnHand, unit: item.stockUnit };
      }, 201);
    }
    return json(route, { error: `Unmocked ${method} ${pathname}` }, 404);
  });
}

const posts = (world: World, suffix: string) => world.posts.filter((post) => post.path.endsWith(suffix));

async function expectNoOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
}

for (const viewport of VIEWPORTS) {
  test.describe(`inventory waste and adjustment at ${viewport.width}px`, () => {
    test.use({ viewport });

    test("waste: failure keeps the entry, success shows one deduction and the server on-hand", async ({ page }) => {
      const world = newWorld();
      await installWorld(page, world);
      await page.goto("/app/inventory", { waitUntil: "domcontentloaded" });
      await page.getByText("Whole Milk").first().click();
      const readsBefore = world.inventoryReads;
      await page.getByRole("button", { name: "Record waste" }).click();
      await expect(page.getByRole("heading", { name: "Record waste / loss" })).toBeVisible();
      await page.getByLabel("Quantity (L)").fill("3");
      await expectNoOverflow(page);

      world.refuseNext = { status: 409, message: "Cannot record waste right now.", errors: {} };
      await page.getByRole("button", { name: "Record waste", exact: true }).last().click();
      await expect(page.getByRole("alert").filter({ hasText: "Cannot record waste right now." })).toBeVisible();
      expect(world.items[1].currentOnHand).toBe(20);
      await expect(page.getByLabel("Quantity (L)")).toHaveValue("3");

      world.delayMs = 500;
      await page.getByRole("button", { name: "Record waste", exact: true }).last().click();
      await expect(page.getByRole("button", { name: "Saving…" })).toBeDisabled();
      await page.getByRole("button", { name: "Saving…" }).click({ force: true }).catch(() => undefined);
      await expect(page.getByText(/Waste recorded: 3 L/)).toBeVisible();
      expect(posts(world, "/waste-events")).toHaveLength(2);
      expect(world.items[1].currentOnHand).toBe(17);
      // The rendered on-hand comes from the re-read, not only from the optimistic client value.
      expect(world.inventoryReads).toBeGreaterThan(readsBefore);
      await expect(page.getByText("17 L", { exact: true }).first()).toBeVisible();
      await expect(page.getByRole("heading", { name: "Record waste / loss" })).toHaveCount(0);
      await expectNoOverflow(page);
    });

    test("waste: success is confirmed at once, a slow re-read shows Updating, then the server figures land", async ({ page }) => {
      const world = newWorld();
      await installWorld(page, world);
      await page.goto("/app/inventory", { waitUntil: "domcontentloaded" });
      await page.getByText("Whole Milk").first().click();
      await page.getByRole("button", { name: "Record waste" }).click();
      await page.getByLabel("Quantity (L)").fill("3");
      world.slowReadsMs = 1500;
      await page.getByRole("button", { name: "Record waste", exact: true }).last().click();
      await expect(page.getByText(/Waste recorded: 3 L/)).toBeVisible({ timeout: 1200 });
      await expect(page.getByRole("heading", { name: "Record waste / loss" })).toHaveCount(0);
      await expect(page.getByText("Updating stock, value and history…")).toBeVisible();
      await expect(page.getByText("Updating stock, value and history…")).toHaveCount(0, { timeout: 4000 });
      await expect(page.getByText("17 L", { exact: true }).first()).toBeVisible();
      expect(posts(world, "/waste-events")).toHaveLength(1);
    });

    test("adjustment: the saved movement shows the new on-hand at once, and a failed re-read offers Retry without a second movement", async ({ page }) => {
      const world = newWorld();
      await installWorld(page, world);
      await page.goto("/app/inventory", { waitUntil: "domcontentloaded" });
      await page.getByText("Oat Milk").first().click();
      await page.getByRole("button", { name: "Adjust inventory" }).click();
      await page.getByLabel(/Quantity delta/).fill("2");
      world.failReads = 2;
      await page.getByRole("button", { name: "Save stock movement" }).last().click();
      await expect(page.getByText(/Inventory updated: 8 L → 10 L/)).toBeVisible();
      await expect(page.getByText("10 L", { exact: true }).first()).toBeVisible();
      await expect(page.getByRole("alert").filter({ hasText: "could not be refreshed" })).toBeVisible();
      // The notice is not tied to the Overview tab: it stays visible on History, where the stale entries are shown.
      await page.getByRole("tab", { name: "History" }).click();
      await expect(page.getByRole("alert").filter({ hasText: "could not be refreshed" })).toBeVisible();
      await page.getByRole("button", { name: "Retry" }).click();
      await expect(page.getByRole("alert").filter({ hasText: "could not be refreshed" })).toHaveCount(0);
      expect(posts(world, "/adjustments")).toHaveLength(1);
      await expect(page.getByText("10 L", { exact: true }).first()).toBeVisible();
    });

    test("quantity fields can be cleared and retyped without a stuck 0 (owner QA, #351)", async ({ page }) => {
      const world = newWorld();
      await installWorld(page, world);
      await page.goto("/app/inventory", { waitUntil: "domcontentloaded" });
      await page.getByText("Oat Milk").first().click();
      await page.getByRole("button", { name: "Adjust inventory" }).click();
      const delta = page.getByLabel(/Quantity delta/);
      await expect(delta).toHaveValue("");
      await expect(page.getByRole("button", { name: "Save stock movement" })).toBeDisabled();
      await delta.fill("1");
      await expect(delta).toHaveValue("1");
      await delta.press("Backspace");
      await expect(delta).toHaveValue("");
      await delta.pressSequentially("1");
      await expect(delta).toHaveValue("1");
      await expect(page.getByRole("button", { name: "Save stock movement" })).toBeEnabled();
      await delta.fill("");
      await expect(page.getByRole("button", { name: "Save stock movement" })).toBeDisabled();
    });

    test("adjustment: failure keeps the entry, success is applied exactly once", async ({ page }) => {
      const world = newWorld();
      await installWorld(page, world);
      await page.goto("/app/inventory", { waitUntil: "domcontentloaded" });
      await page.getByText("Oat Milk").first().click();
      const readsBefore = world.inventoryReads;
      await page.getByRole("button", { name: "Adjust inventory" }).click();
      await page.getByLabel(/Quantity delta/).fill("-2");

      world.refuseNext = { status: 409, message: "Adjustment refused.", errors: {} };
      await page.getByRole("button", { name: "Save stock movement" }).click();
      await expect(page.getByRole("alert").filter({ hasText: "Adjustment refused." })).toBeVisible();
      expect(world.items[2].currentOnHand).toBe(8);

      world.delayMs = 500;
      await page.getByRole("button", { name: "Save stock movement" }).click();
      await expect(page.getByRole("button", { name: "Saving…" })).toBeDisabled();
      await expect(page.getByText(/Inventory updated: 8 L → 6 L/)).toBeVisible();
      expect(posts(world, "/adjustments").filter((post) => post.path.includes("/32/"))).toHaveLength(2);
      expect(world.items[2].currentOnHand).toBe(6);
      expect(world.inventoryReads).toBeGreaterThan(readsBefore);
      await expect(page.getByText("6 L", { exact: true }).first()).toBeVisible();
      await expectNoOverflow(page);
    });
  });
}
