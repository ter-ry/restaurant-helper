import { expect, test, type Page, type Route } from "@playwright/test";

/**
 * Browser acceptance (#351, Milestone C) for the Inventory page load journey: a failed first load shows an alert with
 * Retry and no false "0 items" figures; Retry recovers and shows the server's items. Mocked, isolated fake API.
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

type Item = { id: number; name: string; category: string; stockUnit: string; currentOnHand: number; minQuantity: number; parLevel: number; supplierId: number | null; active: boolean };
const ITEMS: Item[] = [
  { id: 30, name: "Chicken Breast", category: "Poultry", stockUnit: "kg", currentOnHand: 12, minQuantity: 1, parLevel: 5, supplierId: null, active: true },
  { id: 31, name: "Whole Milk", category: "Dairy", stockUnit: "L", currentOnHand: 20, minQuantity: 4, parLevel: 10, supplierId: null, active: true },
];
const SUPPLIERS = [{ id: 3, name: "Cedar Meats", isActive: true }];
type World = { failInventory: boolean; inventoryReads: number };

const itemPayload = (item: Item) => ({
  id: item.id, organizationId: 42, locationId: 7, supplierId: item.supplierId, name: item.name, normalizedName: item.name.toLowerCase(), category: item.category,
  stockUnit: item.stockUnit, currentOnHand: item.currentOnHand, minQuantity: item.minQuantity, parLevel: item.parLevel,
  preferredSupplierName: SUPPLIERS.find((supplier) => supplier.id === item.supplierId)?.name ?? "", latestPurchasePrice: 4, averageUnitCost: 4,
  lastPurchaseUnit: item.stockUnit, lastPurchaseConversionFactor: 1, lastReceivedAt: null, lastCountedAt: null, averageDailyUsage: 0.8,
  estimatedCostMethod: "weighted_average", active: item.active, notes: "", createdByUserId: 1, updatedByUserId: 1, createdAt: null, updatedAt: null,
});


async function installWorld(page: Page, world: World) {
  await page.route("**/api/**", async (route) => {
    const { pathname } = new URL(route.request().url());
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
    if (pathname === "/api/pilot/inventory") {
      world.inventoryReads += 1;
      if (world.failInventory) {
        return json(route, { error: "Inventory service is temporarily unavailable." }, 503);
      }
      return json(route, {
        items: ITEMS.map(itemPayload), movements: [], countSessions: [], reorderPlan: { suggestions: [], groupedBySupplier: [] },
        summary: { inventoryItemCount: ITEMS.length, inventoryOutOfStockCount: 0, inventoryReorderNowCount: 0, inventoryLowStockCount: 0, inventoryValue: 0 },
      });
    }
    if (pathname === "/api/pilot/inventory/negative-stock") return json(route, { count: 0, posCausedCount: 0, items: [] });
    return json(route, { error: `Unmocked ${pathname}` }, 404);
  });
}

for (const viewport of VIEWPORTS) {
  test.describe(`inventory load at ${viewport.width}px`, () => {
    test.use({ viewport });

    test("a failed first load shows an alert and no false totals; Retry shows the server items", async ({ page }) => {
      const world: World = { failInventory: true, inventoryReads: 0 };
      await installWorld(page, world);
      await page.goto("/app/inventory", { waitUntil: "domcontentloaded" });
      const alert = page.getByRole("alert").filter({ hasText: "temporarily unavailable" });
      await expect(alert).toBeVisible();
      await expect(page.getByText("Chicken Breast")).toHaveCount(0);
      await expect(page.getByText("No inventory items match this search.")).toHaveCount(0);
      await expect(page.getByText("0 total")).toHaveCount(0);
      // Let any background revalidation settle while the server is still failing, so only Retry can recover.
      await page.waitForLoadState("networkidle");
      world.failInventory = false;
      await alert.getByRole("button", { name: "Retry" }).click();
      await expect(page.getByText("Chicken Breast").first()).toBeVisible();
      await expect(page.getByText("Whole Milk").first()).toBeVisible();
      await expect(page.getByRole("alert").filter({ hasText: "temporarily unavailable" })).toHaveCount(0);
      expect(world.inventoryReads).toBeGreaterThanOrEqual(2);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    });

    test("a repeated failure keeps the alert and still shows no items", async ({ page }) => {
      const world: World = { failInventory: true, inventoryReads: 0 };
      await installWorld(page, world);
      await page.goto("/app/inventory", { waitUntil: "domcontentloaded" });
      const alert = page.getByRole("alert").filter({ hasText: "temporarily unavailable" });
      await expect(alert).toBeVisible();
      const readsBefore = world.inventoryReads;
      await alert.getByRole("button", { name: "Retry" }).click();
      await expect.poll(() => world.inventoryReads).toBeGreaterThan(readsBefore);
      await expect(alert).toBeVisible();
      await expect(page.getByText("Chicken Breast")).toHaveCount(0);
      // Let any background revalidation settle while the server is still failing, so only Retry can recover.
      await page.waitForLoadState("networkidle");
      world.failInventory = false;
      await alert.getByRole("button", { name: "Retry" }).click();
      await expect(page.getByText("Chicken Breast").first()).toBeVisible();
    });
  });
}
