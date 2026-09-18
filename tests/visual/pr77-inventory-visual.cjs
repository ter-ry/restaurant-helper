const { chromium } = require("@playwright/test");
const fs = require("node:fs");
const path = require("node:path");

const baseUrl = process.env.FLOWTALLY_VISUAL_BASE_URL || "http://127.0.0.1:43124";
const artifactDir = path.resolve(__dirname, "../../review-artifacts/pr77");

const organization = {
  id: 101,
  name: "Harbour Kitchen",
  lifecycleStatus: "ACTIVE",
  setupStatus: "COMPLETE",
  subscriptionStatus: "ACTIVE",
  createdAt: "2025-01-01T00:00:00Z",
  updatedAt: "2025-01-01T00:00:00Z",
};
const location = {
  id: 201,
  organizationId: organization.id,
  name: "Harbour Kitchen - Queen Street",
  addressLine1: "100 Queen Street West",
  addressLine2: "",
  city: "Toronto",
  region: "ON",
  postalCode: "M5H 2N2",
  country: "CA",
  timezone: "America/Toronto",
  createdAt: "2025-01-01T00:00:00Z",
  updatedAt: "2025-01-01T00:00:00Z",
};
const suppliers = [
  { id: 301, organizationId: 101, name: "Lakeview Produce", normalizedName: "lakeview produce", categoryFocus: "Produce", contactName: "Maya Chen", contactPhone: "416-555-0101", contactEmail: "orders@example.test", orderingNotes: "Order by noon", notes: "", isActive: true, inventoryItemCount: 4, purchaseInvoiceCount: 12, supplierItemMappingCount: 8, latestInvoiceDate: "2025-08-28", historicalReferenceCount: 12, recentInvoices: [], recentMappings: [] },
  { id: 302, organizationId: 101, name: "North Star Foods", normalizedName: "north star foods", categoryFocus: "Dry goods", contactName: "", contactPhone: "", contactEmail: "", orderingNotes: "", notes: "", isActive: true, inventoryItemCount: 3, purchaseInvoiceCount: 8, supplierItemMappingCount: 6, latestInvoiceDate: "2025-08-27", historicalReferenceCount: 8, recentInvoices: [], recentMappings: [] },
  { id: 303, organizationId: 101, name: "Harbour Dairy", normalizedName: "harbour dairy", categoryFocus: "Dairy", contactName: "", contactPhone: "", contactEmail: "", orderingNotes: "", notes: "", isActive: true, inventoryItemCount: 2, purchaseInvoiceCount: 6, supplierItemMappingCount: 4, latestInvoiceDate: "2025-08-26", historicalReferenceCount: 6, recentInvoices: [], recentMappings: [] },
];
const item = (id, name, category, onHand, minimum, par, cost, supplierId) => ({
  id, organizationId: 101, locationId: 201, supplierId, name, normalizedName: name.toLowerCase(), category,
  stockUnit: "each", currentOnHand: onHand, minQuantity: minimum, parLevel: par, preferredSupplierName: suppliers.find((s) => s.id === supplierId)?.name || "",
  latestPurchasePrice: cost, averageUnitCost: cost, lastPurchaseUnit: "each", lastPurchaseConversionFactor: 1,
  lastReceivedAt: "2025-08-28T14:00:00Z", lastCountedAt: "2025-08-29T14:00:00Z", averageDailyUsage: 2.4,
  estimatedCostMethod: "latest_purchase", active: true, notes: "", createdByUserId: 1, updatedByUserId: 1,
  createdAt: "2025-01-01T00:00:00Z", updatedAt: "2025-08-29T14:00:00Z",
});
const items = [
  item(401, "Burger buns", "Bakery", 18, 12, 36, 0.72, 301),
  item(402, "Ground beef", "Protein", 7.5, 10, 24, 8.4, 302),
  item(403, "Romaine lettuce", "Produce", 14, 8, 20, 1.1, 301),
  item(404, "Chicken breast", "Protein", 6, 8, 18, 7.2, 302),
  item(405, "Whole milk", "Dairy", 4, 6, 12, 4.25, 303),
  item(406, "Espresso beans", "Beverage", 11, 8, 16, 18.5, 303),
  item(407, "Blueberries", "Produce", 3, 5, 10, 5.8, 301),
  item(408, "Tomatoes", "Produce", 22, 10, 24, 2.25, 301),
];

function inventoryResponse() {
  const suggestions = items.filter((row) => row.currentOnHand < row.minQuantity).map((row, index) => ({
    id: 500 + index, inventoryItemId: row.id, inventoryItemName: row.name, category: row.category,
    supplier: row.preferredSupplierName, currentQuantity: row.currentOnHand, unit: row.stockUnit,
    minimumQuantity: row.minQuantity, parLevel: row.parLevel, suggestedQuantity: row.parLevel - row.currentOnHand,
    adjustedQuantity: row.parLevel - row.currentOnHand, latestPurchasePrice: row.latestPurchasePrice,
    estimatedCost: (row.parLevel - row.currentOnHand) * row.latestPurchasePrice, stockStatus: "Below minimum", status: "Suggested", daysRemaining: 2,
  }));
  return { items, movements: [], countSessions: [], suppliers, reorderPlan: { suggestions, groupedBySupplier: [], }, summary: { inventoryItemCount: items.length, lowStockCount: suggestions.length, supplierCount: suppliers.length } };
}

function authMe() {
  return {
    user: { id: 1, email: "demo@example.test", isActive: true, createdAt: "2025-01-01T00:00:00Z", updatedAt: "2025-01-01T00:00:00Z" },
    membershipRole: "owner", currentOrganizationId: 101, currentLocationId: 201,
    enabledModuleKeys: ["INVENTORY", "PURCHASES", "REORDER_PLANS", "REPORTING", "STOCK_COUNTS"], organizations: [], csrfToken: "fixture-csrf",
  };
}

async function installMocks(page) {
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    console.log("fixture", url.pathname);
    const body = (() => {
      if (url.pathname === "/api/auth/me") return authMe();
      if (url.pathname === "/api/auth/csrf") return { csrfToken: "fixture-csrf" };
      if (url.pathname === "/api/organizations/current") return { organization, restaurantLocations: [location], currentLocation: location, enabledModuleKeys: authMe().enabledModuleKeys, membershipRole: "owner" };
      if (url.pathname === "/api/organizations") return { organizations: [], currentOrganizationId: 101, currentMembershipId: 501 };
      if (url.pathname === "/api/pilot/attention") return { reorder: { count: 2 } };
      if (url.pathname === "/api/pilot/inventory") return inventoryResponse();
      if (url.pathname === "/api/pilot/suppliers") return { suppliers };
      if (url.pathname.startsWith("/api/pilot/inventory/items/")) return { item: items[0], purchaseHistory: [], movementHistory: [], supplierMappings: [] };
      return {};
    })();
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
}

async function capture(browser, name, viewport, theme) {
  const page = await browser.newPage({ viewport });
  page.on("pageerror", (error) => console.error(`${name} pageerror:`, error.message));
  page.on("console", (message) => { if (message.type() === "error") console.error(`${name} console:`, message.text()); });
  await page.addInitScript((selectedTheme) => {
    window.localStorage.setItem("flowtally:pilot-theme", selectedTheme);
  }, theme);
  await installMocks(page);
  await page.goto(`${baseUrl}/app/inventory`, { waitUntil: "domcontentloaded", timeout: 15000 });
  await page.waitForTimeout(1500);
  if (!(await page.getByRole("heading", { name: "Inventory" }).count())) {
    throw new Error(`Inventory fixture did not render: ${(await page.locator("body").innerText()).slice(0, 500)}`);
  }
  await page.screenshot({ path: path.join(artifactDir, `${name}.png`), fullPage: true });
  await page.close();
}

(async () => {
  fs.mkdirSync(artifactDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    await capture(browser, "inventory-dark-desktop", { width: 1440, height: 900 }, "dark");
    await capture(browser, "inventory-light-desktop", { width: 1440, height: 900 }, "light");
    await capture(browser, "inventory-dark-mobile", { width: 390, height: 844 }, "dark");
  } finally {
    await browser.close();
  }
})();
