import { expect, test, type Locator, type Page, type Route } from "@playwright/test";

/**
 * Browser acceptance for the verified-free inventory evidence UI (#316; backend #308/#314, UI #312/#313).
 * The API is a small stateful fake that mirrors the documented server rules (append-only evidence, idempotent
 * record/correct, refused unknown-cost transfers, consumption tracking), so this exercises the real React UI,
 * its server refresh and its retry behavior at phone and tablet widths. No live data and no external services.
 */

type Verification = {
  id: number;
  itemId: number;
  quantity: number;
  consumedQuantity: number;
  remainingQuantity: number;
  unit: string;
  evidenceType: string;
  evidenceNote: string;
  correctionOfId: number | null;
  verifiedAt: string | null;
  revokedAt: string | null;
  revokedReason: string;
};

type World = {
  onHand: number;
  rows: Verification[];
  nextId: number;
  keys: Map<string, Verification>;
  posts: { path: string; body: any }[];
  /** Apply the next record call on the server but answer 500, like a dropped connection after commit. */
  dropNextRecordResponse: boolean;
  /** Delay (ms) before answering record calls, to hold a request in flight. */
  recordDelayMs: number;
};

const ORG = { id: 42, name: "Showcase Cafe", lifecycleStatus: "ACTIVE", setupStatus: "COMPLETE", subscriptionStatus: "ACTIVE", setupTemplateKey: "GENERIC_RESTAURANT", setupFeeStatus: "confirmed", isProspect: false, activeAt: "2026-01-01T00:00:00Z", setupCompletedAt: "2026-01-01T00:00:00Z" };
const LOCATIONS = [
  { id: 7, name: "Queen St Cafe", city: "Toronto", region: "ON" },
  { id: 9, name: "King St Kiosk", city: "Toronto", region: "ON" },
];
const MODULES = ["PURCHASES", "INVENTORY", "REORDER_PLANS", "DAILY_CLOSE"];
const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
];

const json = (route: Route, payload: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(payload) });
const refuse = (route: Route, message: string, errors: Record<string, string>, status = 409) => json(route, { error: message, errors }, status);

function newWorld(onHand = 10): World {
  return { onHand, rows: [], nextId: 1, keys: new Map(), posts: [], dropNextRecordResponse: false, recordDelayMs: 0 };
}

const unverifiedOf = (world: World) => world.onHand - world.rows.filter((row) => !row.revokedAt).reduce((sum, row) => sum + row.remainingQuantity, 0);

function itemPayload(world: World) {
  return {
    id: 30, organizationId: 42, locationId: 7, supplierId: null, name: "Chicken Breast", normalizedName: "chicken breast", category: "Poultry",
    stockUnit: "kg", currentOnHand: world.onHand, minQuantity: 1, parLevel: 5, preferredSupplierName: "", latestPurchasePrice: 0,
    averageUnitCost: 0, lastPurchaseUnit: "kg", lastPurchaseConversionFactor: 1, lastReceivedAt: null, lastCountedAt: null,
    averageDailyUsage: 0.8, estimatedCostMethod: "weighted_average", active: true, notes: "", createdByUserId: 1, updatedByUserId: 1, createdAt: null, updatedAt: null,
  };
}

function makeRow(world: World, fields: { quantity: number; evidenceType: string; evidenceNote: string; correctionOfId?: number }): Verification {
  const row: Verification = {
    id: world.nextId++, itemId: 30, quantity: fields.quantity, consumedQuantity: 0, remainingQuantity: fields.quantity, unit: "kg",
    evidenceType: fields.evidenceType, evidenceNote: fields.evidenceNote, correctionOfId: fields.correctionOfId ?? null,
    verifiedAt: "2026-11-16T12:00:00Z", revokedAt: null, revokedReason: "",
  };
  world.rows.push(row);
  return row;
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
    if (pathname === "/api/pilot/suppliers") return json(route, { suppliers: [] });
    if (pathname === "/api/pilot/inventory") {
      return json(route, {
        items: [itemPayload(world)], movements: [], countSessions: [], reorderPlan: { suggestions: [], groupedBySupplier: [] },
        summary: { inventoryItemCount: 1, inventoryOutOfStockCount: 0, inventoryReorderNowCount: 0, inventoryLowStockCount: 0, inventoryValue: 0 },
      });
    }
    if (pathname === "/api/pilot/inventory/negative-stock") return json(route, { count: 0, posCausedCount: 0, items: [] });
    if (pathname === "/api/pilot/inventory/items/30") return json(route, { item: itemPayload(world), purchaseHistory: [], movementHistory: [], supplierMappings: [] });

    if (pathname === "/api/pilot/inventory/items/30/cost-verifications") {
      if (method === "GET") return json(route, { itemId: 30, verifications: world.rows });
      const key = String(body.idempotencyKey ?? "");
      const replay = world.keys.get(key);
      if (replay) return json(route, { ...replay, replayed: true }, 200);
      if (world.recordDelayMs) await new Promise((resolve) => setTimeout(resolve, world.recordDelayMs));
      if (Number(body.quantity) > unverifiedOf(world) + 1e-9) {
        return refuse(route, "Verification rejected.", { verification: `Only ${unverifiedOf(world)} kg is unverified zero-cost stock.`, code: "exceeds_unverified_stock" });
      }
      const row = makeRow(world, { quantity: Number(body.quantity), evidenceType: body.evidenceType, evidenceNote: body.evidenceNote });
      world.keys.set(key, row);
      if (world.dropNextRecordResponse) {
        world.dropNextRecordResponse = false;
        return json(route, { error: "Service unavailable." }, 503);
      }
      return json(route, row, 201);
    }

    const revoke = pathname.match(/^\/api\/pilot\/inventory\/cost-verifications\/(\d+)\/revoke$/);
    if (revoke && method === "POST") {
      const row = world.rows.find((entry) => entry.id === Number(revoke[1]));
      if (!row) return json(route, { error: "Not found." }, 404);
      if (row.revokedAt) return refuse(route, "Verification rejected.", { verification: "Already revoked.", code: "already_revoked" });
      row.revokedAt = "2026-11-16T12:30:00Z";
      row.revokedReason = String(body.reason ?? "");
      return json(route, row);
    }

    const correct = pathname.match(/^\/api\/pilot\/inventory\/cost-verifications\/(\d+)\/correct$/);
    if (correct && method === "POST") {
      const old = world.rows.find((entry) => entry.id === Number(correct[1]));
      if (!old) return json(route, { error: "Not found." }, 404);
      const quantity = Number(body.quantity);
      if (quantity < old.consumedQuantity) {
        return refuse(route, "Verification rejected.", { verification: `${old.consumedQuantity} kg was already moved at $0, so the corrected quantity cannot be lower.`, code: "below_consumed_quantity" });
      }
      old.revokedAt = "2026-11-16T12:40:00Z";
      old.revokedReason = String(body.reason ?? "");
      const row = makeRow(world, { quantity, evidenceType: body.evidenceType, evidenceNote: body.evidenceNote, correctionOfId: old.id });
      row.consumedQuantity = old.consumedQuantity;
      row.remainingQuantity = quantity - old.consumedQuantity;
      return json(route, row, 201);
    }

    if (pathname === "/api/pilot/inventory/transfers" && method === "POST") {
      const quantity = Number(body.quantity);
      let needed = quantity;
      const active = world.rows.filter((row) => !row.revokedAt);
      if (active.reduce((sum, row) => sum + row.remainingQuantity, 0) + 1e-9 < quantity) {
        return refuse(route, "Source item has no cost.", {
          sourceItemId: "Chicken Breast has no average cost yet, so the value to carry to King St Kiosk is unknown. Receive it on an invoice, set its cost first, or record verified-free evidence if it was genuinely free.",
        });
      }
      for (const row of active) {
        const take = Math.min(row.remainingQuantity, needed);
        row.consumedQuantity += take;
        row.remainingQuantity -= take;
        needed -= take;
      }
      world.onHand -= quantity;
      return json(route, { id: 1, fromLocationId: 7, toLocationId: 9, fromItemId: 30, toItemId: 31, quantity, unit: "kg", unitCost: 0, reason: body.reason ?? "", idempotencyKey: body.idempotencyKey, createdAt: null, outMovement: null, inMovement: null, replayed: false }, 201);
    }

    return json(route, { error: `Unmocked ${method} ${pathname}` }, 404);
  });
}

async function openItem(page: Page) {
  await page.goto("/app/inventory", { waitUntil: "domcontentloaded" });
  await page.getByRole("row", { name: /Chicken Breast/ }).click();
  const panel = page.getByTestId("verified-free-panel");
  await expect(panel).toBeVisible();
  return panel;
}

async function expectNoOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
}

/** A control is usable on a phone only if it sits inside the viewport horizontally and nothing covers its centre. */
async function expectUsable(page: Page, control: Locator) {
  await control.scrollIntoViewIfNeeded();
  await expect(control).toBeInViewport();
  const box = await control.boundingBox();
  const width = page.viewportSize()!.width;
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(width);
  const uncovered = await control.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return hit !== null && element.contains(hit);
  });
  expect(uncovered).toBe(true);
}

for (const viewport of VIEWPORTS) {
  test.describe(`verified-free evidence at ${viewport.width}px`, () => {
    test.use({ viewport });

    test("zero-cost stock is shown as unverified, not free, and the record form enforces its requirements", async ({ page }) => {
      const world = newWorld(10);
      await installWorld(page, world);
      const panel = await openItem(page);

      await expect(panel).toContainText("no purchase cost, so its value is unknown, not free");
      await expect(panel).toContainText("On hand 10 kg · verified free 0 · unverified 10");
      await expectNoOverflow(page);

      await panel.getByRole("button", { name: "Record verified free stock" }).click();
      const form = page.getByTestId("verified-free-form");
      await expect(form.getByLabel("Quantity (kg)")).toHaveValue("10");
      await expect(form.getByLabel(/Evidence note/)).toBeVisible();
      await expect(form.getByLabel(/Reason/)).toHaveCount(0);

      const confirm = form.getByRole("button", { name: "Confirm free stock" });
      await expectUsable(page, confirm);
      await expectUsable(page, form.getByRole("button", { name: "Cancel" }));

      await confirm.click();
      await expect(form.getByRole("alert")).toHaveText("Explain how you know this stock was free.");
      await form.getByLabel(/Evidence note/).fill("Supplier added 2 cases free, noted on invoice #1042");
      await form.getByLabel("Quantity (kg)").fill("12");
      await confirm.click();
      await expect(form.getByRole("alert")).toHaveText("Only 10 kg is not yet verified.");
      await form.getByLabel("Quantity (kg)").fill("0");
      await confirm.click();
      await expect(form.getByRole("alert")).toHaveText("Enter a quantity greater than zero.");
      expect(world.posts.filter((post) => post.path.endsWith("/cost-verifications"))).toHaveLength(0);
      await expectNoOverflow(page);
    });

    test("record then server refresh shows the new evidence, and a long note wraps without overflow", async ({ page }) => {
      const world = newWorld(10);
      await installWorld(page, world);
      const panel = await openItem(page);
      const longNote = "Supplier Cedar Meats added two free cases " + "documented-on-invoice-".repeat(8) + "1042";

      await panel.getByRole("button", { name: "Record verified free stock" }).click();
      const form = page.getByTestId("verified-free-form");
      await form.getByLabel("How was it free?").selectOption("donation");
      await form.getByLabel("Quantity (kg)").fill("4");
      await form.getByLabel(/Evidence note/).fill(longNote);
      await form.getByRole("button", { name: "Confirm free stock" }).click();

      await expect(panel.getByRole("status")).toContainText("Free stock recorded. The audit trail keeps every earlier entry.");
      await expect(panel).toContainText("On hand 10 kg · verified free 4 · unverified 6");
      const list = panel.getByRole("list", { name: "Free stock evidence" });
      await expect(list.getByRole("listitem")).toHaveCount(1);
      await expect(list).toContainText("4 kg · Donation");
      await expect(list).toContainText(longNote);
      await expect(page.getByTestId("verified-free-form")).toHaveCount(0);
      expect(world.posts.filter((post) => post.path.endsWith("/cost-verifications"))).toHaveLength(1);
      expect(world.posts[0].body).toMatchObject({ evidenceType: "donation", quantity: 4, evidenceNote: longNote });
      expect(String(world.posts[0].body.idempotencyKey)).toMatch(/^free-/);
      await expectNoOverflow(page);
    });

    test("a refused record keeps the form open with the server's reason and applies nothing", async ({ page }) => {
      const world = newWorld(10);
      await installWorld(page, world);
      const panel = await openItem(page);
      await panel.getByRole("button", { name: "Record verified free stock" }).click();
      const form = page.getByTestId("verified-free-form");
      await form.getByLabel(/Evidence note/).fill("Donated tray");
      // Another session already verified most of the stock after this page loaded.
      makeRow(world, { quantity: 8, evidenceType: "donation", evidenceNote: "Recorded elsewhere" });
      await form.getByRole("button", { name: "Confirm free stock" }).click();
      await expect(form.getByRole("alert")).toContainText("Verification rejected. Only 2 kg is unverified zero-cost stock.");
      // The refusal re-reads authoritative state, so the other session's evidence now shows.
      await expect(panel).toContainText("verified free 8 · unverified 2");
      expect(world.rows).toHaveLength(1);
      await expect(form.getByRole("button", { name: "Confirm free stock" })).toBeEnabled();
    });

    test("an unknown-outcome save is retried with the same key and is recorded exactly once", async ({ page }) => {
      const world = newWorld(10);
      world.dropNextRecordResponse = true;
      await installWorld(page, world);
      const panel = await openItem(page);
      await panel.getByRole("button", { name: "Record verified free stock" }).click();
      const form = page.getByTestId("verified-free-form");
      await form.getByLabel("Quantity (kg)").fill("5");
      await form.getByLabel(/Evidence note/).fill("Promo case from rep");
      await form.getByRole("button", { name: "Confirm free stock" }).click();

      await expect(form.getByRole("alert")).toContainText("Check the list below before retrying or discarding.");
      // The attempt is locked: the request cannot be edited, only retried or discarded.
      await expect(form.getByLabel("Quantity (kg)")).toBeDisabled();
      await expect(form.getByLabel(/Evidence note/)).toBeDisabled();
      await expect(form.getByRole("button", { name: "Discard attempt" })).toBeVisible();
      // The server did commit it, and the failed save re-read the list, so the owner can see that before retrying.
      await expect(panel).toContainText("verified free 5 · unverified 5");

      await expectUsable(page, form.getByRole("button", { name: "Retry same request" }));
      await form.getByRole("button", { name: "Retry same request" }).click();
      await expect(panel.getByRole("status")).toContainText("Free stock recorded");
      await expect(panel.getByRole("list", { name: "Free stock evidence" }).getByRole("listitem")).toHaveCount(1);
      expect(world.rows).toHaveLength(1);
      const posts = world.posts.filter((post) => post.path.endsWith("/cost-verifications"));
      expect(posts).toHaveLength(2);
      expect(posts[1].body.idempotencyKey).toBe(posts[0].body.idempotencyKey);
    });

    test("a double-tap on Confirm sends one request while the save is in flight", async ({ page }) => {
      const world = newWorld(10);
      world.recordDelayMs = 600;
      await installWorld(page, world);
      const panel = await openItem(page);
      await panel.getByRole("button", { name: "Record verified free stock" }).click();
      const form = page.getByTestId("verified-free-form");
      await form.getByLabel(/Evidence note/).fill("Donated by neighbour bakery");
      const confirm = form.getByRole("button", { name: "Confirm free stock" });
      await confirm.dblclick();
      await expect(form.getByRole("button", { name: "Saving…" })).toBeDisabled();
      await expect(panel.getByRole("status")).toContainText("Free stock recorded");
      expect(world.posts.filter((post) => post.path.endsWith("/cost-verifications"))).toHaveLength(1);
      expect(world.rows).toHaveLength(1);
    });

    test("a $0 transfer is refused for unverified stock with the server's explanation, then allowed once evidence covers it", async ({ page }) => {
      const world = newWorld(10);
      await installWorld(page, world);
      const panel = await openItem(page);

      const startTransfer = async (quantity: string, reason: string) => {
        const open = page.getByRole("button", { name: "Transfer to another location" });
        if (await open.isVisible()) await open.click();
        const transfer = page.getByTestId("transfer-panel");
        await transfer.getByLabel(/Send to/).selectOption({ label: "King St Kiosk" }).catch(async () => transfer.getByRole("combobox").selectOption("9"));
        await transfer.getByLabel(/Quantity/).fill(quantity);
        await transfer.getByLabel(/Note \(optional\)/).fill(reason);
        await transfer.getByRole("button", { name: "Confirm transfer" }).click();
        return transfer;
      };

      // Unknown cost: the server refuses and the UI says so truthfully, without claiming the stock is free.
      const refused = await startTransfer("3", "Cover kiosk shortage");
      await expect(refused.getByRole("alert")).toContainText("no average cost yet, so the value to carry to King St Kiosk is unknown");
      await expect(refused.getByRole("alert")).toContainText("record verified-free evidence if it was genuinely free");
      await expect(panel).toContainText("On hand 10 kg · verified free 0 · unverified 10");
      await expectNoOverflow(page);

      // Record evidence for 4 kg, then move 3 kg at $0: evidence is consumed and the panel re-reads on its own.
      await panel.getByRole("button", { name: "Record verified free stock" }).click();
      const form = page.getByTestId("verified-free-form");
      await form.getByLabel("Quantity (kg)").fill("4");
      await form.getByLabel(/Evidence note/).fill("Supplier free goods, invoice #1042");
      await form.getByRole("button", { name: "Confirm free stock" }).click();
      await expect(panel).toContainText("verified free 4 · unverified 6");

      await startTransfer("3", "Cover kiosk shortage");
      await expect(panel).toContainText("On hand 7 kg · verified free 1 · unverified 6");
      const row = panel.getByRole("list", { name: "Free stock evidence" }).getByRole("listitem").first();
      await expect(row).toContainText("Moved at $0: 3 · remaining 1");
      // Evidence that already backed a transfer can be corrected but no longer revoked.
      await expect(row.getByRole("button", { name: "Correct" })).toBeVisible();
      await expect(row.getByRole("button", { name: "Revoke" })).toHaveCount(0);

      // Exhaust it: 1 kg left, then a further move needs evidence again.
      await startTransfer("1", "Last of the free stock");
      await expect(panel).toContainText("On hand 6 kg · verified free 0 · unverified 6");
      await expect(row).toContainText("Moved at $0: 4 · remaining 0");
      const exhausted = await startTransfer("1", "One more");
      await expect(exhausted.getByRole("alert")).toContainText("value to carry to King St Kiosk is unknown");
      await expectNoOverflow(page);
    });

    test("revoke requires a reason, keeps the row in the audit trail and restores the unverified quantity", async ({ page }) => {
      const world = newWorld(10);
      makeRow(world, { quantity: 4, evidenceType: "supplier_free_goods", evidenceNote: "Invoice #1042" });
      await installWorld(page, world);
      const panel = await openItem(page);
      await expect(panel).toContainText("verified free 4 · unverified 6");

      await panel.getByRole("button", { name: "Revoke" }).click();
      const form = page.getByTestId("verified-free-form");
      await expect(form.getByLabel(/Evidence note/)).toHaveCount(0);
      const confirm = form.getByRole("button", { name: "Confirm revoke" });
      await expectUsable(page, confirm);
      await confirm.click();
      await expect(form.getByRole("alert")).toHaveText("Say why this evidence is being revoked.");
      expect(world.posts.filter((post) => post.path.endsWith("/revoke"))).toHaveLength(0);

      await form.getByLabel(/Reason/).fill("Invoice was for a different item");
      await confirm.click();
      await expect(panel.getByRole("status")).toContainText("Evidence revoked. The audit trail keeps every earlier entry.");
      await expect(panel).toContainText("verified free 0 · unverified 10");
      const row = panel.getByRole("list", { name: "Free stock evidence" }).getByRole("listitem");
      await expect(row).toHaveCount(1);
      await expect(row).toContainText("Revoked");
      await expect(row).toContainText("Revoked because: Invoice was for a different item");
      await expect(row.getByRole("button")).toHaveCount(0);
      await expectNoOverflow(page);
    });

    test("correct requires a note and a reason, refuses a quantity below what already moved, and links the correction", async ({ page }) => {
      const world = newWorld(10);
      const original = makeRow(world, { quantity: 4, evidenceType: "supplier_free_goods", evidenceNote: "Invoice #1042" });
      original.consumedQuantity = 3;
      original.remainingQuantity = 1;
      world.onHand = 7;
      await installWorld(page, world);
      const panel = await openItem(page);

      await panel.getByRole("button", { name: "Correct" }).click();
      const form = page.getByTestId("verified-free-form");
      await expect(form.getByLabel("Quantity (kg)")).toHaveValue("4");
      await expect(form.getByLabel(/Evidence note/)).toHaveValue("Invoice #1042");
      const save = form.getByRole("button", { name: "Save correction" });
      await expectUsable(page, save);

      await save.click();
      await expect(form.getByRole("alert")).toHaveText("Say why the evidence is being corrected.");

      await form.getByLabel(/Reason/).fill("Typo in quantity");
      await form.getByLabel("Quantity (kg)").fill("2");
      await save.click();
      await expect(form.getByRole("alert")).toContainText("3 kg was already moved at $0, so the corrected quantity cannot be lower.");
      expect(world.rows).toHaveLength(1);
      expect(world.rows[0].revokedAt).toBeNull();

      await form.getByLabel("Quantity (kg)").fill("5");
      await form.getByLabel(/Evidence note/).fill("Invoice #1042 (corrected to 5 kg)");
      await save.click();
      await expect(panel.getByRole("status")).toContainText("Evidence corrected. The audit trail keeps every earlier entry.");
      await expect(panel).toContainText("verified free 2 · unverified 5");
      const items = panel.getByRole("list", { name: "Free stock evidence" }).getByRole("listitem");
      await expect(items).toHaveCount(2);
      await expect(items.nth(0)).toContainText("Revoked");
      await expect(items.nth(1)).toContainText("Corrects #1");
      await expect(items.nth(1)).toContainText("5 kg");
      await expectNoOverflow(page);
    });

    test("Refresh re-reads evidence another session changed and never treats missing cost as free", async ({ page }) => {
      const world = newWorld(10);
      await installWorld(page, world);
      const panel = await openItem(page);
      await expect(panel).toContainText("verified free 0 · unverified 10");
      makeRow(world, { quantity: 6, evidenceType: "other_documented", evidenceNote: "Owner note on file" });
      await page.getByRole("button", { name: "Refresh", exact: true }).first().click();
      await expect(panel).toContainText("verified free 6 · unverified 4");
      // Unverified stock never becomes "verified free" on its own: the record button only offers the remainder.
      await panel.getByRole("button", { name: "Record verified free stock" }).click();
      await expect(page.getByTestId("verified-free-form").getByLabel("Quantity (kg)")).toHaveValue("4");
    });
  });
}
