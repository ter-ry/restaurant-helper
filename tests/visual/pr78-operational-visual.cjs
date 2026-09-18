const { chromium } = require("@playwright/test");
const fs = require("node:fs");
const path = require("node:path");

const baseUrl = process.env.FLOWTALLY_VISUAL_BASE_URL || "http://127.0.0.1:43124";
const artifactDir = path.resolve(__dirname, "../../review-artifacts/pr78");
const organization = { id: 101, name: "Harbour Kitchen", lifecycleStatus: "ACTIVE", setupStatus: "COMPLETE", subscriptionStatus: "ACTIVE" };
const location = { id: 201, organizationId: 101, name: "Queen Street", timezone: "America/Toronto", city: "Toronto", region: "ON" };
const supplier = { id: 301, organizationId: 101, name: "Lakeview Produce", normalizedName: "lakeview produce", categoryFocus: "Produce", contactName: "Maya Chen", contactPhone: "", contactEmail: "", orderingNotes: "", notes: "", isActive: true };
const inventoryItem = { id: 401, organizationId: 101, locationId: 201, supplierId: 301, name: "Ground beef", normalizedName: "ground beef", category: "Protein", stockUnit: "kg", currentOnHand: 7.5, minQuantity: 10, parLevel: 24, preferredSupplierName: supplier.name, latestPurchasePrice: 8.4, averageUnitCost: 8.1, lastPurchaseUnit: "kg", lastPurchaseConversionFactor: 1, lastReceivedAt: "2026-09-10T12:00:00Z", lastCountedAt: "2026-09-17T12:00:00Z", averageDailyUsage: 2.4, estimatedCostMethod: "weighted_average", active: true, notes: "", createdByUserId: 1, updatedByUserId: 1, createdAt: null, updatedAt: null };
const inventory = { items: [inventoryItem], movements: [], countSessions: [], suppliers: [supplier], reorderPlan: { suggestions: [{ id: 1, inventoryItemId: 401, inventoryItemName: "Ground beef", category: "Protein", supplier: supplier.name, currentQuantity: 7.5, unit: "kg", minimumQuantity: 10, parLevel: 24, suggestedQuantity: 16.5, adjustedQuantity: 16.5, latestPurchasePrice: 8.4, estimatedCost: 138.6, stockStatus: "Below minimum", status: "Suggested", daysRemaining: 2 }], groupedBySupplier: [] }, summary: { inventoryItemCount: 1, lowStockCount: 1, inventoryReorderNowCount: 1, inventoryValue: 60.75 } };
const invoiceLine = { id: 1, invoiceId: 10, supplierName: supplier.name, invoiceNumber: "LK-2048", invoiceDate: "2026-09-16", inventoryItemId: 401, supplierItemMappingId: null, lineIndex: 0, description: "Ground beef", normalizedDescription: "ground beef", purchaseUnit: "kg", inventoryUnit: "kg", conversionFactor: 1, quantity: 12, unitPrice: 8.4, lineTotal: 100.8, confidence: 0.72, needsReview: true, previousUnitPrice: 7.5, priceChangePercent: 12, note: "Confirm unit price", createdAt: null, updatedAt: null };
const purchases = { invoices: [{ id: 10, organizationId: 101, locationId: 201, supplierId: 301, supplier, invoiceNumber: "LK-2048", invoiceDate: "2026-09-16", subtotal: 100.8, tax: 13.1, totalAmount: 113.9, notes: "", status: "Draft", sourceFileName: "invoice-2048.pdf", sourceFileType: "application/pdf", sourceFileKey: "", extractedText: "", extractionStatus: "Needs review", receivedAt: null, receivedByUserId: null, createdByUserId: 1, updatedByUserId: 1, postedAt: null, lineItems: [invoiceLine], createdAt: null, updatedAt: null }], suppliers: [supplier], purchaseLines: [invoiceLine], priceChanges: [{ inventoryItemName: "Ground beef", previousUnitPrice: 7.5, currentUnitPrice: 8.4, priceChangePercent: 12 }], summary: { invoiceCount: 1, draftCount: 1, needsReviewCount: 1, totalSpend: 113.9 }, exportReadiness: { readyForCsv: 0, needsReview: 1, needsMapping: 0, quickBooksFutureOnly: true } };
const snapshot = { healthStatus: "Needs review", inventoryValue: 12450, sales: { grossSales: 4280, orderCount: 86 }, usage: { period: { startAt: "2026-09-17T00:00:00Z", endAt: "2026-09-18T00:00:00Z" }, coverage: { mappedVariationCount: 8, totalVariationCount: 10 }, totals: { theoreticalUsage: 245, actualUsage: 238, discrepancy: -7, discrepancyPercent: -2.8 }, contributingMenuItems: [], unmappedVariations: [{ name: "Seasonal Soup" }], ingredientUsage: [] }, variance: { quantity: -7, percent: -2.8, value: -64 }, square: { squareStatus: "Connected", squareSynced: true, locationMapped: true }, readyToFinalize: false };
const dailyClose = { session: { id: 51, organizationId: 101, locationId: 201, businessDate: "2026-09-17", status: "OPEN", summarySnapshot: {}, usageSnapshot: {}, exceptionsSnapshot: ["Ground beef count is below PAR", "One Square variation remains unmapped"], notes: "Review before finalizing", completedAt: null, completedByUserId: null, createdByUserId: 1, createdAt: null, updatedAt: null, currentSnapshot: snapshot }, snapshot, usage: snapshot.usage, exceptions: ["Ground beef count is below PAR", "One Square variation remains unmapped"], history: [{ id: 50, organizationId: 101, locationId: 201, businessDate: "2026-09-16", status: "COMPLETED", summarySnapshot: {}, usageSnapshot: {}, exceptionsSnapshot: [], notes: "Closed", completedAt: "2026-09-16T23:30:00Z", completedByUserId: 1, createdByUserId: 1, createdAt: null, updatedAt: null, currentSnapshot: snapshot }], location, businessDate: "2026-09-17", square: snapshot.square };
const auth = { user: { id: 1, email: "demo@example.test", isActive: true }, membershipRole: "owner", currentOrganizationId: 101, currentLocationId: 201, enabledModuleKeys: ["INVENTORY", "PURCHASES", "REORDER_PLANS", "REPORTING", "STOCK_COUNTS", "MENU_COSTING", "DAILY_CLOSE", "SQUARE_INTEGRATION"], organizations: [], csrfToken: "fixture-csrf" };
const squareStatus = { connection: { id: 1, organizationId: 101, organization, environment: "demo", squareMerchantId: "demo-merchant", status: "connected", tokenExpiresAt: null, revokedAt: null, lastSyncAt: "2026-09-17T23:00:00Z", syncStatus: "success", syncError: "", catalogCount: 1, orderCount: 21, locationCount: 1, dailySalesCount: 21, locations: [{ id: 1, squareLocationId: "LOC-1", name: "Harbour Kitchen POS", status: "ACTIVE", rawPayload: {}, mappings: [{ id: 1, squareLocationId: 1, restaurantLocationId: 201, restaurantLocation: location, mappedByUserId: 1, mappedAt: null }] }], catalogObjects: [], orders: [], dailySales: [{ saleDate: "2026-09-17", squareLocationId: "LOC-1", grossSales: 4280, refundAmount: 0, netSales: 4280, orderCount: 86, itemCount: 164 }], syncJobs: [], webhookEvents: [] } };
const squareMappings = { mappings: [{ id: 1, organizationId: 101, squareCatalogObjectId: 1, squareObjectId: "ITEM-1", squareObjectType: "ITEM", squareItemName: "Harbour Burger", mappingType: "menu_item", flowtallyEntityType: "menu_item", flowtallyEntityId: "1", status: "mapped", isDeleted: false, createdAt: null, updatedAt: null }], unmappedVariations: [], mappingCoverage: { mappedVariationCount: 8, totalVariationCount: 10, mappedPercent: 80 }, squareLocations: [{ id: 1, name: "Harbour Kitchen" }], menuItems: [] };

function response(pathname) {
  if (pathname === "/api/auth/me") return auth;
  if (pathname === "/api/auth/csrf") return { csrfToken: "fixture-csrf" };
  if (pathname === "/api/organizations/current") return { organization, restaurantLocations: [location], currentLocation: location, enabledModuleKeys: auth.enabledModuleKeys, membershipRole: "owner" };
  if (pathname === "/api/organizations") return { organizations: [], currentOrganizationId: 101, currentMembershipId: 1 };
  if (pathname === "/api/pilot/attention") return { reorder: { count: 1 } };
  if (pathname === "/api/pilot/inventory") return inventory;
  if (pathname === "/api/pilot/suppliers") return { suppliers: [supplier] };
  if (pathname === "/api/pilot/purchases") return purchases;
  if (pathname === "/api/pilot/daily-close") return dailyClose;
  if (pathname === "/api/integrations/square/status") return squareStatus;
  if (pathname === "/api/integrations/square/catalog/mappings") return squareMappings;
  if (pathname === "/api/pilot/menu-costing") return { organizationId: 101, locationId: 201, recipes: [], menuItems: [] };
  if (pathname.startsWith("/api/pilot/inventory/items/")) return { item: inventoryItem, purchaseHistory: [invoiceLine], movementHistory: [], supplierMappings: [] };
  return {};
}

async function installMocks(page, fixture = "connected") {
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (fixture === "loading") {
      await new Promise((resolve) => setTimeout(resolve, 1400));
    }
    if (url.pathname === "/api/integrations/square/status" && fixture === "disconnected") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ connection: null }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(response(url.pathname)) });
  });
}

async function capture(browser, route, name, viewport, theme, fixture = "connected") {
  const page = await browser.newPage({ viewport });
  await page.addInitScript((selectedTheme) => window.localStorage.setItem("flowtally:pilot-theme", selectedTheme), theme);
  await installMocks(page, fixture);
  await page.goto(`${baseUrl}${route}`, { waitUntil: "domcontentloaded", timeout: 15000 });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(artifactDir, `${name}.png`), fullPage: false });
  await page.close();
}

(async () => {
  fs.mkdirSync(artifactDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    await capture(browser, "/app/purchases", "purchases-dark-desktop", { width: 1440, height: 900 }, "dark");
    await capture(browser, "/app/purchases", "purchases-light-desktop", { width: 1440, height: 900 }, "light");
    await capture(browser, "/app/daily-close", "daily-close-dark-desktop", { width: 1440, height: 900 }, "dark");
    await capture(browser, "/app/daily-close", "daily-close-light-desktop", { width: 1440, height: 900 }, "light");
    await capture(browser, "/app/square", "square-dark-desktop", { width: 1440, height: 900 }, "dark");
    await capture(browser, "/app/square", "square-disconnected-dark-desktop", { width: 1440, height: 900 }, "dark", "disconnected");
    await capture(browser, "/app/square", "square-loading-dark-desktop", { width: 1440, height: 900 }, "dark", "loading");
  } finally { await browser.close(); }
})();
