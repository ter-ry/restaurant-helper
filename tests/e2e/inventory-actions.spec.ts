import { expect, test, type Page, type Route } from "@playwright/test";

/**
 * Browser acceptance (#321) for inventory bulk edit, location transfer and received-invoice void at phone and tablet
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
};

function newWorld(): World {
  return {
    items: [
      { id: 30, name: "Chicken Breast", category: "Poultry", stockUnit: "kg", currentOnHand: 12, minQuantity: 1, parLevel: 5, supplierId: null, active: true },
      { id: 31, name: "Whole Milk", category: "Dairy", stockUnit: "L", currentOnHand: 20, minQuantity: 4, parLevel: 10, supplierId: null, active: true },
      { id: 32, name: "Oat Milk", category: "Dairy", stockUnit: "L", currentOnHand: 8, minQuantity: 2, parLevel: 6, supplierId: null, active: true },
    ],
    invoice: { status: "Completed", voidReason: "", voidedAt: null, correctedByInvoiceId: null },
    posts: [], delayMs: 0, dropNextResponse: false, refuseNext: null, inventoryReads: 0, seen: new Map(),
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

const invoicePayload = (world: World) => ({
  id: 501, organizationId: 42, locationId: 7, supplierId: 3, supplier: { id: 3, name: "Cedar Meats" }, invoiceNumber: "CM-1042", invoiceDate: "2026-11-10",
  subtotal: 100, tax: 13, totalAmount: 113, notes: "", status: world.invoice.status, sourceFileName: "", sourceFileType: "", sourceFileKey: "", extractedText: "",
  extractionStatus: "manual", receivedAt: "2026-11-10T15:00:00Z", receivedByUserId: 1, createdByUserId: 1, updatedByUserId: 1, postedAt: "2026-11-10T15:00:00Z",
  correctsInvoiceId: null, correctedByInvoiceId: world.invoice.correctedByInvoiceId, voidedAt: world.invoice.voidedAt, voidReason: world.invoice.voidReason,
  lineItems: [], createdAt: null, updatedAt: null,
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

    // Shared mutation behavior: delay, refusal, applied-but-dropped.
    const mutate = async (apply: () => unknown, successStatus = 200) => {
      if (world.delayMs) await sleep(world.delayMs);
      if (world.refuseNext) {
        const refusal = world.refuseNext;
        world.refuseNext = null;
        return refuse(route, refusal.message, refusal.errors, refusal.status);
      }
      const result = apply();
      if (world.dropNextResponse) {
        world.dropNextResponse = false;
        return json(route, { error: "Service unavailable." }, 503);
      }
      return json(route, result, successStatus);
    };

    if (pathname === "/api/pilot/inventory/bulk-edit" && method === "POST") {
      const ids: number[] = body.itemIds;
      const changes = body.changes ?? {};
      const entries = ids.map((id) => {
        const item = world.items.find((entry) => entry.id === id)!;
        const changedFields: string[] = [];
        const before: Record<string, any> = {};
        const after: Record<string, any> = {};
        if ("parLevel" in changes && changes.parLevel !== item.parLevel) { changedFields.push("parLevel"); before.parLevel = item.parLevel; after.parLevel = changes.parLevel; }
        if ("minQuantity" in changes && changes.minQuantity !== item.minQuantity) { changedFields.push("minQuantity"); before.minQuantity = item.minQuantity; after.minQuantity = changes.minQuantity; }
        return { id, name: item.name, status: changedFields.length ? "changed" : "unchanged", changedFields, before, after };
      });
      const summary = { selected: ids.length, changed: entries.filter((entry) => entry.status === "changed").length, unchanged: entries.filter((entry) => entry.status === "unchanged").length };
      if (body.dryRun) return mutate(() => ({ applied: false, batchId: null, summary, items: entries }));
      return mutate(() => {
        for (const entry of entries) {
          const item = world.items.find((candidate) => candidate.id === entry.id)!;
          if ("parLevel" in entry.after) item.parLevel = entry.after.parLevel;
          if ("minQuantity" in entry.after) item.minQuantity = entry.after.minQuantity;
        }
        return { applied: true, batchId: "batch-1", summary, items: entries };
      });
    }

    if (pathname === "/api/pilot/inventory/transfers" && method === "POST") {
      const key = String(body.idempotencyKey ?? "");
      const replay = world.seen.get(key);
      if (replay) return json(route, { ...(replay as object), replayed: true }, 200);
      return mutate(() => {
        const item = world.items.find((entry) => entry.id === body.sourceItemId)!;
        item.currentOnHand -= Number(body.quantity);
        const result = {
          id: 1, fromLocationId: 7, toLocationId: body.destinationLocationId, fromItemId: item.id, toItemId: 99, quantity: Number(body.quantity), unit: item.stockUnit,
          unitCost: 4, reason: body.reason ?? "", idempotencyKey: key, createdAt: null, inMovement: null, replayed: false,
          outMovement: { id: 1, quantityAfter: item.currentOnHand },
        };
        world.seen.set(key, result);
        return result;
      }, 201);
    }

    if (pathname === "/api/pilot/purchases" && method === "GET") {
      return json(route, {
        invoices: [invoicePayload(world)], suppliers: [{ id: 3, name: "Cedar Meats" }], purchaseLines: [], priceChanges: [], summary: {},
        exportReadiness: { readyForCsv: 0, needsReview: 0, needsMapping: 0, quickBooksFutureOnly: true },
      });
    }
    if (pathname === "/api/pilot/purchases/invoices/501" && method === "GET") return json(route, invoicePayload(world));
    if (pathname === "/api/pilot/purchases/invoices/501/preview") return json(route, { invoiceId: 501, reviewSummary: {}, mutatesInventory: false, lines: [] });
    if (pathname === "/api/pilot/purchases/invoices/501/void" && method === "POST") {
      const key = String(body.idempotencyKey ?? "");
      if (world.seen.has(key)) return json(route, { ...invoicePayload(world), replayed: true });
      return mutate(() => {
        world.invoice = { status: "Corrected", voidReason: body.reason, voidedAt: "2026-11-16T13:00:00Z", correctedByInvoiceId: null };
        world.seen.set(key, true);
        return { ...invoicePayload(world), replayed: false };
      });
    }

    return json(route, { error: `Unmocked ${method} ${pathname}` }, 404);
  });
}

const posts = (world: World, suffix: string, predicate: (body: any) => boolean = () => true) => world.posts.filter((post) => post.path.endsWith(suffix) && predicate(post.body));

async function expectNoOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
}

for (const viewport of VIEWPORTS) {
  test.describe(`inventory actions at ${viewport.width}px`, () => {
    test.use({ viewport });

    test("bulk edit: multi-select, review, in-progress apply, double-submit blocked, list refreshed from server", async ({ page }) => {
      const world = newWorld();
      await installWorld(page, world);
      await page.goto("/app/inventory?view=bulk", { waitUntil: "domcontentloaded" });

      await expect(page.getByRole("heading", { name: "Bulk edit items" })).toBeVisible();
      await page.getByLabel("Select Whole Milk").check();
      await page.getByLabel("Select Oat Milk").check();
      await expect(page.getByTestId("selected-count")).toHaveText("2 selected");

      await page.getByLabel("PAR level", { exact: true }).check();
      await page.getByLabel("New PAR level").fill("14");
      await expectNoOverflow(page);

      await page.getByRole("button", { name: "Review changes (2)" }).click();
      await expect(page.getByRole("heading", { name: /Review: 2 will change/ })).toBeVisible();
      expect(posts(world, "/bulk-edit", (body) => body.dryRun === true)).toHaveLength(1);
      // The dry run changes nothing on the server.
      expect(world.items.map((item) => item.parLevel)).toEqual([5, 10, 6]);

      world.delayMs = 600;
      const apply = page.getByRole("button", { name: "Apply to 2 items" });
      await apply.click();
      await expect(page.getByRole("button", { name: "Applying…" })).toBeDisabled();
      await expect(page.getByText("Applying changes to 2 items…")).toBeVisible();
      // A second activation while in flight cannot send a second request (the button is disabled; force the click anyway).
      await page.getByRole("button", { name: "Applying…" }).click({ force: true, trial: false }).catch(() => undefined);

      await expect(page.getByText("Updated 2 items.")).toBeVisible();
      expect(posts(world, "/bulk-edit", (body) => body.dryRun === false)).toHaveLength(1);
      expect(world.items.map((item) => item.parLevel)).toEqual([5, 14, 14]);
      // The list shows the server's values, not optimistic client state, and the selection is reset.
      await expect(page.getByText("PAR 14 L").first()).toBeVisible();
      await expect(page.getByTestId("selected-count")).toHaveText("0 selected");
      await expectNoOverflow(page);
    });

    test("bulk edit: a refused apply says nothing was saved and offers a refresh when items changed", async ({ page }) => {
      const world = newWorld();
      await installWorld(page, world);
      await page.goto("/app/inventory?view=bulk", { waitUntil: "domcontentloaded" });

      await page.getByLabel("Select Whole Milk").check();
      await page.getByLabel("PAR level", { exact: true }).check();
      await page.getByLabel("New PAR level").fill("14");
      await page.getByRole("button", { name: "Review changes (1)" }).click();
      await expect(page.getByRole("heading", { name: /Review: 1 will change/ })).toBeVisible();

      world.refuseNext = { status: 409, message: "Items changed.", errors: { "item-31": "PAR changed from 10 to 12 since you loaded it." } };
      await page.getByRole("button", { name: "Apply to 1 item" }).click();

      const alert = page.getByRole("alert").filter({ hasText: "Nothing was saved" });
      await expect(alert).toContainText("Some items changed since you loaded them. Nothing was saved.");
      await expect(alert).toContainText("Whole Milk: PAR changed from 10 to 12 since you loaded it.");
      expect(world.items[1].parLevel).toBe(10);

      await alert.getByRole("button", { name: "Refresh list" }).click();
      await expect(page.getByRole("alert")).toHaveCount(0);
      await expectNoOverflow(page);
    });

    test("transfer: refusal, in-progress, duplicate prevention, success refreshes the source stock", async ({ page }) => {
      const world = newWorld();
      await installWorld(page, world);
      await page.goto("/app/inventory", { waitUntil: "domcontentloaded" });
      await page.getByRole("row", { name: /Chicken Breast/ }).click();

      await page.getByRole("button", { name: "Transfer to another location" }).click();
      const panel = page.getByTestId("transfer-panel");
      await expect(panel).toContainText("Available here: 12 kg");

      // Client-side validation, then a server refusal that leaves the form editable and nothing applied.
      await panel.getByRole("button", { name: "Confirm transfer" }).click();
      await expect(panel.getByRole("alert")).toHaveText("Choose where to send the stock.");
      await panel.getByLabel("Send to").selectOption({ label: "King St Kiosk" });
      await panel.getByLabel(/Quantity/).fill("50");
      await panel.getByRole("button", { name: "Confirm transfer" }).click();
      await expect(panel.getByRole("alert")).toHaveText("Only 12 kg is on hand here. Stock cannot go below zero.");

      await panel.getByLabel(/Quantity/).fill("5");
      world.refuseNext = { status: 409, message: "Transfer refused.", errors: { quantity: "Stock changed; reload and try again." } };
      await panel.getByRole("button", { name: "Confirm transfer" }).click();
      await expect(panel.getByRole("alert")).toContainText("Transfer refused. Stock changed; reload and try again.");
      expect(world.items[0].currentOnHand).toBe(12);
      await expect(panel.getByLabel(/Quantity/)).toBeEnabled();

      // Success path with a held request: the button is disabled and a second click cannot send a second transfer.
      world.delayMs = 600;
      const confirm = panel.getByRole("button", { name: "Confirm transfer" });
      await confirm.click();
      await expect(panel.getByRole("button", { name: "Transferring…" })).toBeDisabled();
      await panel.getByRole("button", { name: "Transferring…" }).click({ force: true }).catch(() => undefined);

      await expect(page.getByRole("status").filter({ hasText: "Transferred 5 kg of Chicken Breast to King St Kiosk." })).toContainText("here is now 7 kg");
      expect(posts(world, "/transfers", (body) => body.quantity === 5).length).toBe(2); // the refused attempt + the applied one
      expect(world.items[0].currentOnHand).toBe(7);
      // The refused and applied attempts used different keys: a refusal is a fresh decision, not a replay.
      const keys = new Set(posts(world, "/transfers").map((post) => post.body.idempotencyKey));
      expect(keys.size).toBe(2);
      // Source figures come from the server again, with no manual reload.
      await expect(page.getByTestId("transfer-panel")).toHaveCount(0);
      await expect(page.getByText("7 kg").first()).toBeVisible();
      await expectNoOverflow(page);
    });

    test("transfer: an unknown outcome keeps the same key so retrying cannot move stock twice", async ({ page }) => {
      const world = newWorld();
      await installWorld(page, world);
      await page.goto("/app/inventory", { waitUntil: "domcontentloaded" });
      await page.getByRole("row", { name: /Chicken Breast/ }).click();
      await page.getByRole("button", { name: "Transfer to another location" }).click();
      const panel = page.getByTestId("transfer-panel");
      await panel.getByLabel("Send to").selectOption({ label: "King St Kiosk" });
      await panel.getByLabel(/Quantity/).fill("4");

      world.dropNextResponse = true; // applied on the server, but the browser only sees a 503
      await panel.getByRole("button", { name: "Confirm transfer" }).click();
      await expect(panel.getByRole("alert")).toContainText("Check the movement history before retrying or discarding.");
      expect(world.items[0].currentOnHand).toBe(8);
      await expect(panel.getByLabel(/Quantity/)).toBeDisabled(); // request is immutable while the outcome is unknown

      await panel.getByRole("button", { name: "Retry same transfer" }).click();
      await expect(page.getByRole("status").filter({ hasText: "Transferred 4 kg of Chicken Breast" })).toBeVisible();
      const sent = posts(world, "/transfers");
      expect(sent).toHaveLength(2);
      expect(sent[1].body.idempotencyKey).toBe(sent[0].body.idempotencyKey);
      expect(world.items[0].currentOnHand).toBe(8); // moved exactly once
      await expectNoOverflow(page);
    });

    test("invoice void: confirmation, in-progress, failure keeps the receipt, success shows the voided state", async ({ page }) => {
      const world = newWorld();
      await installWorld(page, world);
      await page.goto("/app/purchases?invoiceId=501", { waitUntil: "domcontentloaded" });

      const modal = page.getByTestId("purchase-detail-modal");
      await expect(modal).toBeVisible();
      const voidButton = modal.getByRole("button", { name: "Void receipt" });
      await expect(voidButton).toBeDisabled(); // a reason is required
      await modal.getByLabel("Void reason").fill("Wrong supplier receipt");
      await expectNoOverflow(page);

      // Confirmation step: nothing is sent until the user confirms, and Keep invoice backs out.
      await voidButton.click();
      const dialog = modal.getByRole("alertdialog", { name: "Confirm void" });
      await expect(dialog).toContainText("Void invoice CM-1042?");
      await dialog.getByRole("button", { name: "Keep invoice" }).click();
      await expect(dialog).toHaveCount(0);
      expect(posts(world, "/void")).toHaveLength(0);

      // A definite server refusal is shown, and the receipt stays Completed.
      world.refuseNext = { status: 409, message: "Void refused.", errors: { stock: "Chicken Breast stock from this receipt was already used." } };
      await voidButton.click();
      await modal.getByRole("button", { name: "Yes, void this invoice" }).click();
      await expect(modal.getByRole("alert").filter({ hasText: "Void refused." })).toContainText("already used");
      expect(world.invoice.status).toBe("Completed");

      // Success with a held request: in-progress label, no duplicate void, then the page shows the voided state from the server.
      world.delayMs = 600;
      await voidButton.click();
      await modal.getByRole("button", { name: "Yes, void this invoice" }).click();
      await expect(modal.getByRole("button", { name: "Voiding..." })).toBeDisabled();
      await modal.getByRole("button", { name: "Voiding..." }).click({ force: true }).catch(() => undefined);

      await expect(modal.getByText("This invoice was voided")).toBeVisible();
      await expect(modal).toContainText("Reason: Wrong supplier receipt");
      await expect(modal.getByRole("button", { name: "Void receipt" })).toHaveCount(0);
      expect(posts(world, "/void").filter((post) => post.body.reason === "Wrong supplier receipt")).toHaveLength(2); // refused + applied
      expect(world.invoice.status).toBe("Corrected");
      await expectNoOverflow(page);
    });

    test("invoice void: a lost response keeps the key so confirming again replays instead of voiding twice", async ({ page }) => {
      const world = newWorld();
      await installWorld(page, world);
      await page.goto("/app/purchases?invoiceId=501", { waitUntil: "domcontentloaded" });
      const modal = page.getByTestId("purchase-detail-modal");
      await modal.getByLabel("Void reason").fill("Duplicate entry");

      world.dropNextResponse = true;
      await modal.getByRole("button", { name: "Void receipt" }).click();
      await modal.getByRole("button", { name: "Yes, void this invoice" }).click();
      await expect(modal.getByRole("alert").filter({ hasText: "Check the purchase list before trying again." })).toBeVisible();

      await modal.getByRole("button", { name: "Void receipt" }).click();
      await modal.getByRole("button", { name: "Yes, void this invoice" }).click();
      await expect(modal.getByText("This invoice was voided")).toBeVisible();
      const sent = posts(world, "/void");
      expect(sent).toHaveLength(2);
      expect(sent[1].body.idempotencyKey).toBe(sent[0].body.idempotencyKey);
      await expectNoOverflow(page);
    });
  });
}
