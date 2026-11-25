import { expect, test, type Page, type Route } from "@playwright/test";

/**
 * Browser acceptance (#339) for the purchase create, save-draft and save-and-receive flow at phone and tablet
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
  { width: 1440, height: 900 },
];

const json = (route: Route, payload: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(payload) });
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));


type Invoice = { notes?: string; id: number; invoiceNumber: string; status: string; lineItems: any[]; subtotal: number; tax: number; totalAmount: number; invoiceDate: string };
type World = {
  invoices: Invoice[];
  onHand: number;
  posts: { path: string; method: string; body: any }[];
  delayMs: number;
  refuseCreate: { status: number; message: string; errors: Record<string, any> } | null;
  failReceiveOnce: boolean;
  /** When set, the next void is refused with a 409 (for example the received stock was already used). */
  refuseVoidOnce: string | null;
  /** Purchase list reads answered by the fake server (proves the page re-fetched after a mutation). */
  listReads: number;
  nextId: number;
  /** Extra delay on purchase list reads (applied only when > 0, e.g. after the first load). */
  listDelayMs: number;
  /** Number of line items the fake OCR endpoint extracts (default 1). */
  ocrLineCount: number;
  /** When set, the fake OCR reads these printed amounts and the fake server stores/recomputes the verdict from the saved lines. */
  ocrPrinted: { subtotal: number; tax: number; total: number } | null;
};
const newWorld = (): World => ({ invoices: [], onHand: 12, posts: [], delayMs: 0, refuseCreate: null, failReceiveOnce: false, refuseVoidOnce: null, listReads: 0, nextId: 600, listDelayMs: 0, ocrLineCount: 1, ocrPrinted: null });
const SUPPLIERS = [{ id: 3, name: "Cedar Meats", isActive: true }];
const ITEM = {
  id: 30, organizationId: 42, locationId: 7, supplierId: null, name: "Chicken Breast", normalizedName: "chicken breast", category: "Poultry", stockUnit: "kg",
  minQuantity: 1, parLevel: 5, preferredSupplierName: "", latestPurchasePrice: 4, averageUnitCost: 4, lastPurchaseUnit: "kg", lastPurchaseConversionFactor: 1,
  lastReceivedAt: null, lastCountedAt: null, averageDailyUsage: 0.8, estimatedCostMethod: "weighted_average", active: true, notes: "", createdByUserId: 1,
  updatedByUserId: 1, createdAt: null, updatedAt: null,
};
const invoiceJson = (invoice: Invoice) => ({
  organizationId: 42, locationId: 7, supplierId: 3, supplier: { id: 3, name: "Cedar Meats" }, notes: "", sourceFileName: "", sourceFileType: "", sourceFileKey: "",
  extractedText: "", extractionStatus: "manual", receivedAt: null, receivedByUserId: null, createdByUserId: 1, updatedByUserId: 1, postedAt: null,
  correctsInvoiceId: null, correctedByInvoiceId: null, voidedAt: null, voidReason: "", createdAt: null, updatedAt: null, ...invoice,
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
    if (pathname === "/api/pilot/suppliers" && method === "GET") return json(route, { suppliers: SUPPLIERS });
    if (pathname === "/api/pilot/inventory" && method === "GET") {
      return json(route, {
        items: [{ ...ITEM, currentOnHand: world.onHand }], movements: [], countSessions: [], reorderPlan: { suggestions: [], groupedBySupplier: [] },
        summary: { inventoryItemCount: 1, inventoryOutOfStockCount: 0, inventoryReorderNowCount: 0, inventoryLowStockCount: 0, inventoryValue: 0 },
      });
    }
    if (pathname === "/api/pilot/purchases" && method === "GET") {
      world.listReads += 1;
      // The response reflects the server at request time, even when it is delivered late (a stale snapshot).
      const snapshot = world.invoices.map(invoiceJson);
      const lateBy = world.listDelayMs;
      world.listDelayMs = 0; // only the next read is delayed
      if (lateBy) await sleep(lateBy);
      return json(route, {
        invoices: snapshot, suppliers: [{ id: 3, name: "Cedar Meats" }], purchaseLines: [], priceChanges: [], summary: {},
        exportReadiness: { readyForCsv: 0, needsReview: 0, needsMapping: 0, quickBooksFutureOnly: true },
      });
    }
    const mutate = async (apply: () => Response | unknown) => {
      if (world.delayMs) await sleep(world.delayMs);
      return apply();
    };
    const toInvoice = (id: number, status: string): Invoice => ({
      id, notes: body.notes ?? "", invoiceNumber: body.invoiceNumber, status, invoiceDate: body.invoiceDate, subtotal: body.subtotal, tax: body.tax, totalAmount: body.totalAmount,
      lineItems: (body.lineItems ?? []).map((line: any, index: number) => ({ id: id * 10 + index, ...line })),
    });
    const withEvidence = (invoice: Invoice): Invoice => {
      const printed = world.ocrPrinted;
      if (!printed) return invoice;
      const lineTotal = Math.round(invoice.lineItems.reduce((sum, line) => sum + Number(line.lineTotal), 0) * 100) / 100;
      const matched = Math.abs(printed.subtotal - lineTotal) <= 0.01;
      (invoice as any).ocrEvidence = {
        status: matched ? "matched" : "incomplete", printedSubtotal: printed.subtotal, printedTax: printed.tax, printedTotal: printed.total,
        expectedAmount: printed.subtotal, lineTotal, difference: Math.round((printed.subtotal - lineTotal) * 100) / 100, override: null,
      };
      return invoice;
    };
    if (pathname === "/api/pilot/purchases/invoices" && method === "POST") {
      await mutate(() => null);
      if (world.refuseCreate) {
        const refusal = world.refuseCreate;
        return json(route, { error: refusal.message, errors: refusal.errors }, refusal.status);
      }
      const invoice = withEvidence(toInvoice(world.nextId++, body.status));
      world.invoices.push(invoice);
      return json(route, invoiceJson(invoice), 201);
    }
    if (pathname === "/api/pilot/purchases/ocr" && method === "POST") {
      await mutate(() => null);
      const field = (value: string | number) => ({ value, confidence: 0.95, needsReview: false });
      return json(route, {
        provider: "fake", fileName: "invoice.png", contentType: "image/png", rawText: "", evidenceToken: "token",
        fields: { supplier: field("Cedar Meats"), invoiceDate: field("2026-11-10"), invoiceNumber: field("OCR-1"), subtotal: field(world.ocrPrinted?.subtotal ?? 4), tax: field(world.ocrPrinted?.tax ?? 0), total: field(world.ocrPrinted?.total ?? 4) },
        lineItems: Array.from({ length: world.ocrLineCount }, (_, index) => ({ itemName: world.ocrLineCount > 1 ? `Chicken breast fresh boneless skinless 2kg tray ${index + 1}` : "Chicken breast", originalDescription: "Chicken breast", quantity: 1, unit: "kg", unitPrice: 4, lineTotal: 4, confidence: 0.95, needsReview: false, rawSourceLine: "" })),
        warnings: [], overallConfidence: 0.95, needsReview: false,
      });
    }
    if (pathname === "/api/pilot/suppliers" && method === "POST") {
      await mutate(() => null);
      return json(route, { id: 4, name: body.name, isActive: true }, 201);
    }
    const voidMatch = pathname.match(/^\/api\/pilot\/purchases\/invoices\/(\d+)\/void$/);
    if (voidMatch && method === "POST") {
      await mutate(() => null);
      const invoice = world.invoices.find((entry) => entry.id === Number(voidMatch[1]));
      if (!invoice) return json(route, { error: "Not found." }, 404);
      if (world.refuseVoidOnce) {
        const message = world.refuseVoidOnce;
        world.refuseVoidOnce = null;
        return json(route, { error: message, errors: {} }, 409);
      }
      invoice.status = "Corrected";
      return json(route, invoiceJson(invoice));
    }
    const one = pathname.match(/^\/api\/pilot\/purchases\/invoices\/(\d+)(\/receive)?$/);
    if (one) {
      const invoice = world.invoices.find((entry) => entry.id === Number(one[1]));
      if (!invoice) return json(route, { error: "Not found." }, 404);
      if (method === "GET") return json(route, invoiceJson(invoice));
      if (method === "PATCH") {
        await mutate(() => null);
        Object.assign(invoice, toInvoice(invoice.id, body.status));
        withEvidence(invoice);
        return json(route, invoiceJson(invoice));
      }
      if (one[2] && method === "POST") {
        await mutate(() => null);
        if (world.failReceiveOnce) {
          world.failReceiveOnce = false;
          return json(route, { error: "Receiving failed. Try again." }, 500);
        }
        invoice.status = "Completed";
        world.onHand += 2;
        return json(route, invoiceJson(invoice));
      }
    }
    return json(route, { error: `Unmocked ${method} ${pathname}` }, 404);
  });
}

const posts = (world: World, suffix: string, method = "POST") => world.posts.filter((post) => post.path.endsWith(suffix) && post.method === method);

async function expectNoOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
}

for (const viewport of VIEWPORTS) {
  test.describe(`purchases receive at ${viewport.width}px`, () => {
    test.use({ viewport });

    async function startPurchase(page: Page, world: World, invoiceNumber = "CM-2001") {
      await installWorld(page, world);
      await page.goto("/app/purchases", { waitUntil: "domcontentloaded" });
      await page.getByRole("button", { name: "New purchase" }).click();
      const editor = page.getByTestId("purchase-editor-card");
      await editor.getByLabel("Supplier", { exact: true }).selectOption({ label: "Cedar Meats" });
      await editor.getByLabel("Invoice number").fill(invoiceNumber);
      const line = editor.getByLabel("Description");
      await line.fill("Chicken breast 2kg");
      await editor.locator("select").filter({ hasText: "Unmapped" }).selectOption({ label: "Chicken Breast" });
      const numbers = editor.locator('input[type="number"]');
      // Order in the editor: subtotal, tax, total, then the line quantity, unit price, line total.
      await numbers.nth(0).fill("100");
      await numbers.nth(1).fill("13");
      await numbers.nth(3).fill("2");
      await numbers.nth(4).fill("50");
      return editor;
    }

    test("save draft shows progress then success and re-reads the list from the server", async ({ page }) => {
      const world = newWorld();
      world.delayMs = 500;
      const editor = await startPurchase(page, world);
      await expectNoOverflow(page);
      const readsBefore = world.listReads;
      await editor.getByRole("button", { name: "Save draft" }).click();
      await expect(editor.getByRole("button", { name: "Saving..." })).toBeDisabled();
      await expect(page.getByText("Invoice CM-2001 saved successfully.")).toBeVisible();
      // The list is re-read from the server after the save (the saved invoice exists only in the server's list response).
      await expect.poll(() => world.listReads).toBeGreaterThan(readsBefore);
      expect(posts(world, "/purchases/invoices")).toHaveLength(1);
      expect(world.invoices[0].status).toBe("Draft");
      await expectNoOverflow(page);
    });

    test("save & receive needs confirmation, blocks a double click and closes with a received message", async ({ page }) => {
      const world = newWorld();
      world.delayMs = 500;
      const editor = await startPurchase(page, world);
      await editor.getByRole("button", { name: "Save & receive" }).click();
      const dialog = page.getByRole("dialog", { name: "Confirm receipt" });
      await expect(dialog).toContainText("This will update inventory");
      expect(posts(world, "/purchases/invoices")).toHaveLength(0);
      await dialog.getByRole("button", { name: "Confirm receive" }).click();
      await expect(dialog.getByRole("button", { name: "Receiving…" })).toBeDisabled();
      await dialog.getByRole("button", { name: "Receiving…" }).click({ force: true }).catch(() => undefined);
      await expect(page.getByText("Invoice CM-2001 received into inventory.")).toBeVisible();
      expect(posts(world, "/purchases/invoices")).toHaveLength(1);
      expect(world.posts.filter((post) => post.path.endsWith("/receive"))).toHaveLength(1);
      expect(world.invoices[0].status).toBe("Completed");
      expect(world.onHand).toBe(14);
      await expect(page.getByTestId("purchase-editor-card")).toHaveCount(0);
      await expectNoOverflow(page);
    });

    test("a duplicate invoice number is refused, nothing is received, and the existing purchase can be opened", async ({ page }) => {
      const world = newWorld();
      world.invoices.push({ id: 501, invoiceNumber: "CM-2001", status: "Completed", invoiceDate: "2026-11-10", subtotal: 100, tax: 13, totalAmount: 113, lineItems: [] });
      world.refuseCreate = { status: 409, message: "Duplicate invoice.", errors: { invoiceNumber: "Invoice CM-2001 already exists for this supplier.", duplicateInvoiceId: 501 } };
      const editor = await startPurchase(page, world);
      await editor.getByRole("button", { name: "Save & receive" }).click();
      await page.getByRole("dialog", { name: "Confirm receipt" }).getByRole("button", { name: "Confirm receive" }).click();
      const alert = editor.getByRole("alert").filter({ hasText: "Duplicate invoice." });
      await expect(alert).toContainText("already exists");
      await alert.getByRole("button", { name: "Open existing purchase" }).click();
      const detail = page.getByTestId("purchase-detail-modal");
      await expect(detail).toBeVisible();
      await expect(detail).toContainText("CM-2001");
      await expect(detail).toContainText("Received");
      await expect(detail).toContainText("$113.00"); // the persisted purchase 501, not the unsaved draft ($100 subtotal)
      expect(world.posts.filter((post) => post.path.endsWith("/receive"))).toHaveLength(0);
      expect(world.onHand).toBe(12);
      await expectNoOverflow(page);
    });

    test("a failed receive keeps the saved draft: retry updates it, never creates a second invoice", async ({ page }) => {
      const world = newWorld();
      world.failReceiveOnce = true;
      const editor = await startPurchase(page, world);
      await editor.getByRole("button", { name: "Save & receive" }).click();
      await page.getByRole("dialog", { name: "Confirm receipt" }).getByRole("button", { name: "Confirm receive" }).click();
      await expect(page.getByRole("alert").filter({ hasText: "was saved but not received" })).toBeVisible();
      await expect(page.getByTestId("purchase-action-feedback")).toContainText("did not complete");
      await expect(page.getByTestId("purchase-action-feedback")).not.toContainText("Not saved");
      expect(world.invoices).toHaveLength(1);
      expect(world.onHand).toBe(12);

      // Edit the saved draft after the failure: the retry must persist this edit (PATCH) before it receives.
      await editor.locator("textarea").first().fill("Edited after failed receive");
      await editor.getByRole("button", { name: "Save & receive" }).click();
      await page.getByRole("dialog", { name: "Confirm receipt" }).getByRole("button", { name: "Confirm receive" }).click();
      await expect(page.getByText("received into inventory").or(page.getByText("was received successfully"))).toBeVisible();
      expect(posts(world, "/purchases/invoices")).toHaveLength(1); // create happened once; the retry used PATCH
      expect(world.invoices).toHaveLength(1);
      expect(world.invoices[0].status).toBe("Completed");
      expect(world.invoices[0].notes).toBe("Edited after failed receive"); // the fake server kept the edit
      const sequence = world.posts.map((post) => `${post.method} ${post.path.replace(/\d+/g, "#")}`);
      const lastPatch = sequence.lastIndexOf("PATCH /api/pilot/purchases/invoices/#");
      const lastReceive = sequence.lastIndexOf("POST /api/pilot/purchases/invoices/#/receive");
      expect(lastPatch).toBeGreaterThan(sequence.indexOf("POST /api/pilot/purchases/invoices/#/receive")); // after the failed receive
      expect(lastPatch).toBeLessThan(lastReceive);
      expect(world.posts[lastPatch].body.notes).toBe("Edited after failed receive");
      expect(world.onHand).toBe(14);
    });
  });
}

const savedLine = (invoiceId: number, index: number, unitPrice = 4) => ({
  id: invoiceId * 10 + index, description: `Chicken breast ${index + 1}`, inventoryItemId: 30, purchaseUnit: "kg", inventoryUnit: "kg", conversionFactor: 1,
  quantity: 1, unitPrice, lineTotal: unitPrice, confidence: 0.95, needsReview: false, note: "",
});

test.describe("purchases master/detail at 1440px", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("a queue item opens the editor in a dedicated full-width overlay, with price-change warnings and an in-flow action bar", async ({ page }) => {
    const world = newWorld();
    // The mapped item averages $4/kg: line 1 is +12.5%, line 2 is +1%, the rest are unchanged.
    const lines = Array.from({ length: 8 }, (_, index) => savedLine(700, index, index === 0 ? 4.5 : index === 1 ? 4.04 : 4));
    world.invoices.push({ id: 700, invoiceNumber: "CM-700", status: "Draft", invoiceDate: "2026-11-10", subtotal: 32.54, tax: 0, totalAmount: 32.54, lineItems: lines });
    await installWorld(page, world);
    await page.goto("/app/purchases", { waitUntil: "domcontentloaded" });

    // Overview: Needs review (left, wider) and Purchase history (right) are both visible side by side, with no empty detail pane.
    const reviewBox = await page.getByTestId("purchase-review-card").boundingBox();
    const historyBox = await page.getByTestId("purchase-history-card").boundingBox();
    expect(reviewBox && historyBox && historyBox.x >= reviewBox.x + reviewBox.width - 1).toBe(true);
    expect(reviewBox && historyBox && reviewBox.width).toBeGreaterThan(historyBox!.width);
    expect(Math.abs(reviewBox!.y - historyBox!.y)).toBeLessThan(2);
    await expect(page.getByText("Select a purchase to review it here")).toHaveCount(0);
    await expect(page.getByTestId("purchase-side-panel")).toHaveCount(0);
    await expectNoOverflow(page);
    await page.getByTestId("purchase-queue").getByRole("button", { name: /CM-700/ }).click();

    const dialog = page.getByRole("dialog", { name: "Purchase editor" });
    const editor = dialog.getByTestId("purchase-editor-card");
    await expect(editor).toBeVisible(); // a spacious overlay, not a panel squeezed beside the queue
    const editorBox = await editor.boundingBox();
    expect(editorBox && editorBox.width).toBeGreaterThan(1000);

    await expect(editor.getByText("Cost up 12.5% vs average cost")).toBeVisible(); // material change only
    await expect(editor.getByText(/Cost (up|down) 1(\.\d)?%/)).toHaveCount(0);
    await expect(editor.getByTestId("purchase-line-7")).toBeAttached();

    // The action bar sits after the last line in normal flow, so it never covers the fields being edited.
    const bar = editor.getByTestId("purchase-action-bar");
    await editor.getByTestId("purchase-line-7").scrollIntoViewIfNeeded();
    const lastLineBox = await editor.getByTestId("purchase-line-7").boundingBox();
    const barBox = await bar.boundingBox();
    expect(lastLineBox && barBox && barBox.y >= lastLineBox.y + lastLineBox.height - 1).toBe(true);
    await editor.getByLabel("Invoice number").fill("CM-700A");
    await bar.getByRole("button", { name: "Save draft" }).click();
    await expect(page.getByText("Invoice CM-700A saved successfully.").first()).toBeVisible();
    expect(world.posts.filter((post) => post.method === "PATCH")).toHaveLength(1);
    await expectNoOverflow(page);
  });

  test("Save & receive from the action bar still asks for confirmation and receives once", async ({ page }) => {
    const world = newWorld();
    world.invoices.push({ id: 710, invoiceNumber: "CM-710", status: "Draft", invoiceDate: "2026-11-10", subtotal: 4, tax: 0, totalAmount: 4, lineItems: [savedLine(710, 0)] });
    await installWorld(page, world);
    await page.goto("/app/purchases", { waitUntil: "domcontentloaded" });
    await page.getByTestId("purchase-queue").getByRole("button", { name: /CM-710/ }).click();
    await page.getByTestId("purchase-action-bar").getByRole("button", { name: "Save & receive" }).click();
    await page.getByRole("dialog", { name: "Confirm receipt" }).getByRole("button", { name: "Confirm receive" }).click();
    await expect(page.getByText(/received into inventory/).first()).toBeVisible();
    expect(world.posts.filter((post) => post.path.endsWith("/receive"))).toHaveLength(1);
    expect(world.invoices[0].status).toBe("Completed");
    await expect(page.getByTestId("purchase-editor-card")).toHaveCount(0);
  });

  test("arrow keys move between queue items and a completed purchase opens in a readable modal with one status vocabulary", async ({ page }) => {
    const world = newWorld();
    world.invoices.push(
      { id: 720, invoiceNumber: "CM-720", status: "Draft", invoiceDate: "2026-11-10", subtotal: 5, tax: 0, totalAmount: 5, lineItems: [savedLine(720, 0)] },
      { id: 721, invoiceNumber: "CM-721", status: "Draft", invoiceDate: "2026-11-11", subtotal: 5, tax: 0, totalAmount: 5, lineItems: [savedLine(721, 0)] },
      { id: 722, invoiceNumber: "CM-722", status: "Completed", invoiceDate: "2026-11-09", subtotal: 5, tax: 0, totalAmount: 5, lineItems: [savedLine(722, 0)] },
    );
    await installWorld(page, world);
    await page.goto("/app/purchases", { waitUntil: "domcontentloaded" });
    const queue = page.getByTestId("purchase-queue");
    await queue.getByRole("button", { name: /CM-720/ }).focus();
    await page.keyboard.press("ArrowDown");
    await expect(queue.getByRole("button", { name: /CM-721/ })).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(queue.getByRole("button", { name: /CM-722/ })).toBeFocused();
    await expect(queue.getByRole("button", { name: /CM-722/ })).toContainText("Received");
    await page.keyboard.press("Enter");
    const detail = page.getByTestId("purchase-detail-modal");
    await expect(detail).toContainText("CM-722");
    await expect(detail).toContainText("Received");
    // A completed purchase opens as a readable modal, not an empty persistent side workspace.
    await expect(page.getByTestId("purchase-side-panel")).toHaveCount(0);
  });
});

test.describe("history then New purchase at 1440px", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("after closing a received purchase, New purchase opens a clean editor and never shows the old receipt", async ({ page }) => {
    const world = newWorld();
    world.invoices.push(
      { id: 770, invoiceNumber: "CM-770", status: "Completed", invoiceDate: "2026-11-09", subtotal: 5, tax: 0, totalAmount: 5, lineItems: [savedLine(770, 0)] },
    );
    await installWorld(page, world);
    await page.goto("/app/purchases", { waitUntil: "domcontentloaded" });
    await page.getByTestId("purchase-queue").getByRole("button", { name: /CM-770/ }).click();
    await expect(page.getByTestId("purchase-detail-modal")).toContainText("CM-770");
    // The receipt is a modal now: it must be closed before a new purchase can start, and then leaves nothing behind.
    await page.getByTestId("purchase-detail-modal").getByRole("button", { name: /^Close/ }).first().click();
    await expect(page.getByTestId("purchase-detail-modal")).toHaveCount(0);
    await page.getByRole("button", { name: "New purchase" }).click();
    const editorDialog = page.getByRole("dialog", { name: "Purchase editor" });
    await expect(editorDialog).toBeVisible();
    await expect(editorDialog).not.toContainText("CM-770");
    await editorDialog.getByRole("button", { name: "Close Purchase editor" }).click();
    await expect(page.getByTestId("purchase-detail-modal")).toHaveCount(0);
    await expect(page.getByText("Select a purchase to review it here")).toHaveCount(0);
    await page.setViewportSize({ width: 900, height: 900 });
    await expect(page.getByTestId("purchase-detail-modal")).toHaveCount(0);
  });
});

test.describe("purchase queue while a save is in flight at 1440px", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("other purchases cannot be opened until the save finishes, so edits never jump back", async ({ page }) => {
    const world = newWorld();
    world.delayMs = 600;
    world.invoices.push(
      { id: 730, invoiceNumber: "CM-730", status: "Draft", invoiceDate: "2026-11-10", subtotal: 4, tax: 0, totalAmount: 4, lineItems: [savedLine(730, 0)] },
      { id: 731, invoiceNumber: "CM-731", status: "Draft", invoiceDate: "2026-11-11", subtotal: 4, tax: 0, totalAmount: 4, lineItems: [savedLine(731, 0)] },
    );
    await installWorld(page, world);
    await page.goto("/app/purchases", { waitUntil: "domcontentloaded" });
    const queue = page.getByTestId("purchase-queue");
    await queue.getByRole("button", { name: /CM-730/ }).click();
    await page.getByTestId("purchase-action-bar").getByRole("button", { name: "Save draft" }).click();
    await expect(queue.getByRole("button", { name: /CM-731/ })).toBeDisabled();
    await expect(page.getByRole("button", { name: "New purchase" })).toBeDisabled();
    await expect(page.getByText("Invoice CM-730 saved successfully.").first()).toBeVisible();
    await expect(queue.getByRole("button", { name: /CM-731/ })).toBeEnabled();
    await page.getByRole("dialog", { name: "Purchase editor" }).getByRole("button", { name: "Close Purchase editor" }).click();
    await queue.getByRole("button", { name: /CM-731/ }).click();
    await expect(page.getByTestId("purchase-editor-card").getByLabel("Invoice number")).toHaveValue("CM-731");
  });
});

test.describe("save draft acknowledgement stays visible beside the sticky action bar", () => {
  for (const width of [390, 1280]) {
    test(`confirms the save inside the action bar at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      const world = newWorld();
      world.invoices.push({ id: 740, invoiceNumber: "CM-740", status: "Draft", invoiceDate: "2026-11-10", subtotal: 4, tax: 0, totalAmount: 4, lineItems: [savedLine(740, 0)] });
      await installWorld(page, world);
      await page.goto("/app/purchases", { waitUntil: "domcontentloaded" });
      await page.getByTestId("purchase-queue").getByRole("button", { name: /CM-740/ }).click();
      const bar = page.getByTestId("purchase-action-bar");
      await bar.getByRole("button", { name: "Save draft" }).click();
      const feedback = bar.getByTestId("purchase-action-feedback");
      await expect(feedback).toContainText("Invoice CM-740 saved successfully.");
      await expect(feedback).toBeInViewport();
    });
  }
});

test.describe("purchase queue while a void is in flight at 1440px", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("other purchases cannot be opened until the void finishes", async ({ page }) => {
    const world = newWorld();
    world.delayMs = 600;
    world.invoices.push(
      { id: 740, invoiceNumber: "CM-740", status: "Completed", invoiceDate: "2026-11-09", subtotal: 4, tax: 0, totalAmount: 4, lineItems: [savedLine(740, 0)] },
      { id: 741, invoiceNumber: "CM-741", status: "Draft", invoiceDate: "2026-11-11", subtotal: 4, tax: 0, totalAmount: 4, lineItems: [savedLine(741, 0)] },
    );
    await installWorld(page, world);
    await page.goto("/app/purchases", { waitUntil: "domcontentloaded" });
    const queue = page.getByTestId("purchase-queue");
    await queue.getByRole("button", { name: /CM-740/ }).click();
    const detail = page.getByTestId("purchase-detail-modal");
    await detail.getByLabel("Void reason").fill("Supplier sent the wrong goods");
    await detail.getByRole("button", { name: "Void receipt" }).click();
    await detail.getByRole("button", { name: "Yes, void this invoice" }).click();
    await expect(queue.getByRole("button", { name: /CM-741/ })).toBeDisabled();
    await expect(page.getByRole("button", { name: "New purchase" })).toBeDisabled();
    await expect(page.getByText(/was voided and its inventory movements were reversed/).first()).toBeVisible();
    await expect(queue.getByRole("button", { name: /CM-741/ })).toBeEnabled();
    expect(world.posts.filter((post) => post.path.endsWith("/void"))).toHaveLength(1);
  });
});

test.describe("void receipt confirmation, refusal and retry at 1440px", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("a reason is required, Keep invoice sends nothing, a refusal leaves the receipt intact and a retry voids it once", async ({ page }) => {
    const world = newWorld();
    world.refuseVoidOnce = "The stock from this receipt has already been used.";
    world.invoices.push({ id: 750, invoiceNumber: "CM-750", status: "Completed", invoiceDate: "2026-11-09", subtotal: 4, tax: 0, totalAmount: 4, lineItems: [savedLine(750, 0)] });
    await installWorld(page, world);
    await page.goto("/app/purchases", { waitUntil: "domcontentloaded" });
    await page.getByTestId("purchase-queue").getByRole("button", { name: /CM-750/ }).click();
    const detail = page.getByTestId("purchase-detail-modal");
    const voidButton = detail.getByRole("button", { name: "Void receipt" });

    await expect(voidButton).toBeDisabled();
    await detail.getByLabel("Void reason").fill("Supplier sent the wrong goods");
    await expect(voidButton).toBeEnabled();

    await voidButton.click();
    await expect(detail.getByRole("alertdialog", { name: "Confirm void" })).toBeVisible();
    await detail.getByRole("button", { name: "Keep invoice" }).click();
    await expect(detail.getByRole("alertdialog", { name: "Confirm void" })).toHaveCount(0);
    expect(posts(world, "/void")).toHaveLength(0);

    await voidButton.click();
    await detail.getByRole("button", { name: "Yes, void this invoice" }).click();
    await expect(detail.getByRole("alert").filter({ hasText: "already been used" })).toBeVisible();
    await expect(detail.getByRole("alertdialog", { name: "Confirm void" })).toHaveCount(0);
    expect(world.invoices[0].status).toBe("Completed");
    expect(posts(world, "/void")).toHaveLength(1);

    await voidButton.click();
    await detail.getByRole("button", { name: "Yes, void this invoice" }).click();
    await expect(page.getByText(/was voided and its inventory movements were reversed/).first()).toBeVisible();
    expect(posts(world, "/void")).toHaveLength(2);
    expect(world.invoices[0].status).toBe("Corrected");
  });
});

test.describe("resizing while a void is in flight at 1440px", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("resizing across the breakpoint keeps the same void modal, so the in-flight void is not duplicated", async ({ page }) => {
    const world = newWorld();
    world.delayMs = 800;
    world.invoices.push(
      { id: 750, invoiceNumber: "CM-750", status: "Completed", invoiceDate: "2026-11-09", subtotal: 4, tax: 0, totalAmount: 4, lineItems: [savedLine(750, 0)] },
    );
    await installWorld(page, world);
    await page.goto("/app/purchases", { waitUntil: "domcontentloaded" });
    await page.getByTestId("purchase-queue").getByRole("button", { name: /CM-750/ }).click();
    const detail = page.getByTestId("purchase-detail-modal");
    await detail.getByLabel("Void reason").fill("Supplier sent the wrong goods");
    await detail.getByRole("button", { name: "Void receipt" }).click();
    await detail.getByRole("button", { name: "Yes, void this invoice" }).click();
    await page.setViewportSize({ width: 900, height: 900 });
    await expect(page.getByTestId("purchase-detail-modal")).toBeVisible();
    await expect(page.getByText(/was voided and its inventory movements were reversed/).first()).toBeVisible();
    expect(world.posts.filter((post) => post.path.endsWith("/void"))).toHaveLength(1);
  });
});

test.describe("purchase queue while OCR extraction is pending at 1440px", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("other purchases cannot be opened until extraction finishes, so the extracted draft is never lost", async ({ page }) => {
    const world = newWorld();
    world.delayMs = 700;
    world.invoices.push({ id: 750, invoiceNumber: "CM-750", status: "Draft", invoiceDate: "2026-11-11", subtotal: 4, tax: 0, totalAmount: 4, lineItems: [savedLine(750, 0)] });
    await installWorld(page, world);
    await page.goto("/app/purchases", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "New purchase" }).click();
    await page.getByLabel("Invoice file").setInputFiles("tests/e2e/fixtures/suppliers.csv");
    const queue = page.getByTestId("purchase-queue");
    await expect(queue.getByRole("button", { name: /CM-750/ })).toBeDisabled();
    await expect(page.getByRole("button", { name: "New purchase" })).toBeDisabled();
    await expect(page.getByTestId("purchase-editor-card").getByLabel("Invoice number")).toHaveValue("OCR-1");
    await expect(queue.getByRole("button", { name: /CM-750/ })).toBeEnabled();
  });
});

test.describe("purchase queue while a supplier is being added at 1440px", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("other purchases cannot be opened until the new supplier is saved, so it cannot land on another purchase", async ({ page }) => {
    const world = newWorld();
    world.delayMs = 700;
    world.invoices.push({ id: 760, invoiceNumber: "CM-760", status: "Draft", invoiceDate: "2026-11-11", subtotal: 4, tax: 0, totalAmount: 4, lineItems: [savedLine(760, 0)] });
    await installWorld(page, world);
    await page.goto("/app/purchases", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "New purchase" }).click();
    const editor = page.getByTestId("purchase-editor-card");
    await editor.getByRole("button", { name: "+ New supplier" }).click();
    await editor.getByLabel("New supplier name").fill("Harbour Fish Co");
    await editor.getByRole("button", { name: "Add", exact: true }).click();
    const queue = page.getByTestId("purchase-queue");
    await expect(queue.getByRole("button", { name: /CM-760/ })).toBeDisabled();
    await expect(page.getByText("Harbour Fish Co added and selected.").first()).toBeVisible();
    await expect(queue.getByRole("button", { name: /CM-760/ })).toBeEnabled();
    await page.getByRole("dialog", { name: "Purchase editor" }).getByRole("button", { name: "Close Purchase editor" }).click();
    await queue.getByRole("button", { name: /CM-760/ }).click();
    await expect(editor.getByLabel("Supplier", { exact: true })).toHaveValue("Cedar Meats"); // B kept its own supplier
  });
});

for (const viewport of VIEWPORTS) {
  test.describe(`realistic multi-line invoice at ${viewport.width}px`, () => {
    test.use({ viewport });

    test("12 lines with unmapped items and a cost warning: no overflow, mapping issues visible, action bar below the last line", async ({ page }) => {
      const world = newWorld();
      const lines = Array.from({ length: 12 }, (_, index) => ({
        ...savedLine(900, index, index === 3 ? 4.6 : 4),
        description: index === 5 || index === 9 ? `Specialty sauce ${index} 4L case` : `Chicken breast fresh boneless skinless 2kg tray ${index + 1}`,
        inventoryItemId: index === 5 || index === 9 ? null : 30,
      }));
      world.invoices.push({ id: 900, invoiceNumber: "CM-900", status: "Draft", invoiceDate: "2026-11-12", subtotal: 48.6, tax: 0, totalAmount: 48.6, lineItems: lines });
      await installWorld(page, world);
      await page.goto("/app/purchases", { waitUntil: "domcontentloaded" });
      await page.getByRole("button", { name: /CM-900/ }).click();
      const editor = page.getByTestId("purchase-editor-card");
      await expect(editor.getByTestId("purchase-line-11")).toBeAttached();
      await expect(editor.getByText("Cost up 15% vs average cost")).toBeVisible();
      const bar = editor.getByTestId("purchase-action-bar");
      await expect(bar).toContainText("Map 2 items to inventory before receiving");
      await expect(editor.getByRole("button", { name: "Save & receive" })).toBeDisabled();
      await expect(editor.getByText("Needs mapping")).toHaveCount(2);
      await page.locator("section.pilot-modal").last().evaluate((node) => { node.scrollTop = node.scrollHeight; }); // scrolled to the very end: the sticky bar rests below the last line
      const lastLine = await editor.getByTestId("purchase-line-11").boundingBox();
      const barBox = await bar.boundingBox();
      expect(lastLine && barBox && barBox.y >= lastLine.y + lastLine.height - 1).toBe(true); // never covers the last line
      await expectNoOverflow(page);
    });
  });
}

for (const width of [1280, 1366, 1440, 1600]) {
  test.describe(`uploaded invoice preview at ${width}px`, () => {
    test.use({ viewport: { width, height: 800 } });

    test("the original-document preview only pins when it sits beside the form, so it never covers the fields", async ({ page }) => {
      const world = newWorld();
      await installWorld(page, world);
      await page.goto("/app/purchases", { waitUntil: "domcontentloaded" });
      await page.getByRole("button", { name: "New purchase" }).click();
      await page.getByLabel("Invoice file").setInputFiles("tests/e2e/fixtures/suppliers.csv");
      await expect(page.getByTestId("purchase-editor-card").getByLabel("Invoice number")).toHaveValue("OCR-1");
      const aside = page.locator("aside", { hasText: "Original document" });
      await expect(aside).toBeVisible();
      const position = await aside.evaluate((node) => getComputedStyle(node).position);
      const sideBySide = await aside.evaluate((node) => {
        const sibling = node.nextElementSibling as HTMLElement | null;
        return !!sibling && Math.abs(sibling.getBoundingClientRect().top - node.getBoundingClientRect().top) < 8;
      });
      if (!sideBySide) expect(position).not.toBe("sticky");
      await expectNoOverflow(page);
    });
  });
}

for (const width of [1440, 1280, 768, 390]) {
  test.describe(`uploaded invoice with five lines and the original document at ${width}px`, () => {
    test.use({ viewport: { width, height: width >= 1280 ? 900 : 844 } });

    test("labels and fields never overlap, quantity, price and total keep a usable width, and the action bar stays below the lines", async ({ page }) => {
      const world = newWorld();
      world.ocrLineCount = 5;
      await installWorld(page, world);
      await page.goto("/app/purchases", { waitUntil: "domcontentloaded" });
      await page.getByRole("button", { name: "New purchase" }).click();
      await page.getByLabel("Invoice file").setInputFiles("tests/e2e/fixtures/suppliers.csv");
      const dialog = page.getByRole("dialog", { name: "Review uploaded invoice" });
      const editor = dialog.getByTestId("purchase-editor-card");
      await expect(editor.getByLabel("Invoice number")).toHaveValue("OCR-1");
      await expect(dialog.locator("aside", { hasText: "Original document" })).toBeVisible(); // source stays visible beside the form
      await expect(editor.getByTestId("purchase-line-4")).toBeAttached();
      // The queue is behind the overlay, so the editor is the only working column next to the document.
      const dialogBox = await dialog.boundingBox();
      const editorBox = await editor.boundingBox();
      expect(dialogBox && editorBox && editorBox.width).toBeGreaterThan(width >= 1280 ? 600 : width - 80);

      for (let index = 0; index < 5; index += 1) {
        const line = editor.getByTestId(`purchase-line-${index}`);
        await line.scrollIntoViewIfNeeded();
        const boxes = await line.evaluate((node) => {
          const fields = Array.from(node.querySelectorAll("label")).filter((label) => label.querySelector("input, select, textarea")).slice(0, 5);
          return fields.map((label) => {
            const rect = label.getBoundingClientRect();
            const control = label.querySelector("input, select")!.getBoundingClientRect();
            return { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom, width: control.width };
          });
        });
        // Description, inventory item, quantity, unit price and line total: no two field blocks overlap, none is cramped.
        for (let a = 0; a < boxes.length; a += 1) {
          expect(boxes[a].width).toBeGreaterThan(60);
          for (let b = a + 1; b < boxes.length; b += 1) {
            const apart = boxes[a].right <= boxes[b].x + 1 || boxes[b].right <= boxes[a].x + 1 || boxes[a].bottom <= boxes[b].y + 1 || boxes[b].bottom <= boxes[a].y + 1;
            expect(apart).toBe(true);
          }
        }
      }
      await page.locator("section.pilot-modal").last().evaluate((node) => { node.scrollTop = node.scrollHeight; }); // scrolled to the very end: the sticky bar rests below the last line
      const lastLine = await editor.getByTestId("purchase-line-4").boundingBox();
      const barBox = await editor.getByTestId("purchase-action-bar").boundingBox();
      expect(lastLine && barBox && barBox.y >= lastLine.y + lastLine.height - 1).toBe(true);
      await expectNoOverflow(page);
    });
  });
}

test.describe("closing a confirmation over the editor at 1440px", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("Escape in Confirm receipt and in Create inventory item leaves the editor and its unsaved values in place", async ({ page }) => {
    const world = newWorld();
    world.invoices.push({ id: 820, invoiceNumber: "CM-820", status: "Draft", invoiceDate: "2026-11-11", subtotal: 4, tax: 0, totalAmount: 4, lineItems: [savedLine(820, 0)] });
    await installWorld(page, world);
    await page.goto("/app/purchases", { waitUntil: "domcontentloaded" });
    await page.getByTestId("purchase-queue").getByRole("button", { name: /CM-820/ }).click();
    const editor = page.getByRole("dialog", { name: "Purchase editor" });
    await editor.getByLabel("Invoice number").fill("CM-820-EDITED");

    await editor.getByRole("button", { name: "Save & receive" }).click();
    const confirm = page.getByRole("dialog", { name: "Confirm receipt" });
    await expect(confirm).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(confirm).toHaveCount(0);
    await expect(editor).toBeVisible();
    await expect(editor.getByLabel("Invoice number")).toHaveValue("CM-820-EDITED");

    await editor.getByRole("button", { name: "+ Create" }).first().click();
    const create = page.getByRole("dialog", { name: "Create inventory item" });
    await expect(create).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(create).toHaveCount(0);
    await expect(editor).toBeVisible();
    await expect(editor.getByLabel("Invoice number")).toHaveValue("CM-820-EDITED");
    expect(world.posts.filter((post) => post.path.endsWith("/receive"))).toHaveLength(0);
  });
});

for (const viewport of VIEWPORTS) {
  test.describe(`printed-total mismatch journey at ${viewport.width}px`, () => {
    test.use({ viewport });

    test("extract, save draft, reopen from the server: the mismatch persists, receiving stays blocked, correcting the line clears it", async ({ page }) => {
      const world = newWorld();
      world.ocrPrinted = { subtotal: 48, tax: 6.24, total: 54.24 };
      await installWorld(page, world);
      await page.goto("/app/purchases", { waitUntil: "domcontentloaded" });
      await page.getByRole("button", { name: "New purchase" }).click();
      await page.getByLabel("Invoice file").setInputFiles("tests/e2e/fixtures/suppliers.csv");
      const editor = page.getByTestId("purchase-editor-card");
      await expect(editor.getByLabel("Invoice number")).toHaveValue("OCR-1");
      const banner = page.getByTestId("ocr-reconciliation-banner");
      await expect(banner).toHaveAttribute("data-status", "incomplete");
      await expect(banner).toHaveAttribute("role", "alert");
      await editor.locator("select").filter({ hasText: "Unmapped" }).selectOption({ label: "Chicken Breast" });

      // Fully mapped but the lines ($4.00) do not add up to the printed subtotal ($48.00): receiving is refused, nothing is posted.
      await expect(editor.getByRole("button", { name: "Save & receive" })).toBeDisabled();
      expect(world.posts.filter((post) => post.path.endsWith("/receive"))).toHaveLength(0);
      expect(posts(world, "/purchases/invoices")).toHaveLength(0);

      // The draft can be saved; the verdict then comes from the server-stored printed amounts.
      await editor.getByRole("button", { name: "Save draft" }).click();
      await expect(page.getByText("Invoice OCR-1 saved successfully.")).toBeVisible();
      expect(posts(world, "/purchases/invoices")).toHaveLength(1);
      expect(world.invoices[0].status).toBe("Draft");

      // Reload: only server state remains. Reopen the draft; the mismatch and the block are still there.
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.getByTestId("purchase-queue").getByRole("button", { name: /OCR-1/ }).first().click();
      const reopened = page.getByTestId("purchase-editor-card");
      await expect(page.getByTestId("ocr-reconciliation-banner")).toHaveAttribute("data-status", "incomplete");
      await expect(reopened.getByRole("button", { name: "Save & receive" })).toBeDisabled();
      expect(world.posts.filter((post) => post.path.endsWith("/receive"))).toHaveLength(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);

      // Correcting the line so the lines add up clears the warning and receiving works exactly once.
      await reopened.getByLabel("Unit price").fill("48");
      await expect(page.getByTestId("ocr-reconciliation-banner")).toHaveAttribute("data-status", "matched");
      await expect(reopened.getByRole("button", { name: "Save & receive" })).toBeEnabled();
    });
  });
}

for (const width of [1280, 768, 390]) {
  test.describe(`purchases overview at ${width}px`, () => {
    test.use({ viewport: { width, height: 900 } });

    test("Needs review and Purchase history are both visible with no empty pane or nested page scroll trap", async ({ page }) => {
      const world = newWorld();
      world.invoices.push(
        { id: 780, invoiceNumber: "CM-780", status: "Draft", invoiceDate: "2026-11-10", subtotal: 5, tax: 0, totalAmount: 5, lineItems: [savedLine(780, 0)] },
        { id: 781, invoiceNumber: "CM-781", status: "Completed", invoiceDate: "2026-11-09", subtotal: 5, tax: 0, totalAmount: 5, lineItems: [savedLine(781, 0)] },
      );
      await installWorld(page, world);
      await page.goto("/app/purchases", { waitUntil: "domcontentloaded" });
      const review = page.getByTestId("purchase-review-card");
      const history = page.getByTestId("purchase-history-card");
      await expect(review).toContainText("CM-780");
      await expect(history).toContainText("CM-781");
      await expect(page.getByLabel("Search purchases")).toBeVisible();
      await expect(page.getByText("Select a purchase to review it here")).toHaveCount(0);
      const [r, h] = [await review.boundingBox(), await history.boundingBox()];
      if (width >= 1280) {
        expect(h!.x).toBeGreaterThanOrEqual(r!.x + r!.width - 1); // side by side
        expect(r!.width).toBeGreaterThan(h!.width); // review queue is the wider column
      } else {
        expect(h!.y).toBeGreaterThanOrEqual(r!.y + r!.height - 1); // stacked
      }
      // Cards do not trap the page in a tall scroll container: the queue wrapper itself never scrolls.
      const wrapperScrolls = await page.getByTestId("purchase-queue").evaluate((el) => getComputedStyle(el).overflowY !== "visible");
      expect(wrapperScrolls).toBe(false);
      await expectNoOverflow(page);
      await page.getByTestId("purchase-queue").getByRole("button", { name: /CM-781/ }).click();
      await expect(page.getByTestId("purchase-detail-modal")).toContainText("CM-781");
      await expectNoOverflow(page);
    });
  });
}

for (const width of [1440, 1280, 768, 390]) {
  test.describe(`sticky invoice mismatch summary while editing at ${width}px`, () => {
    test.use({ viewport: { width, height: width >= 1280 ? 800 : 844 } });

    test("the printed-total discrepancy stays on screen beside the actions while editing the last line, next to the mapping blocker", async ({ page }) => {
      const world = newWorld();
      world.ocrLineCount = 5;
      world.ocrPrinted = { subtotal: 20, tax: 0, total: 20 };
      await installWorld(page, world);
      await page.goto("/app/purchases", { waitUntil: "domcontentloaded" });
      await page.getByRole("button", { name: "New purchase" }).click();
      await page.getByLabel("Invoice file").setInputFiles("tests/e2e/fixtures/suppliers.csv");
      const dialog = page.getByRole("dialog", { name: "Review uploaded invoice" });
      const editor = dialog.getByTestId("purchase-editor-card");
      await expect(editor.getByTestId("purchase-line-4")).toBeAttached();
      const banner = dialog.getByTestId("ocr-reconciliation-banner");
      const summary = dialog.getByTestId("ocr-sticky-summary");
      const bar = dialog.getByTestId("purchase-action-bar");
      await expect(banner).toHaveAttribute("data-status", "matched");
      await expect(summary).toHaveAttribute("data-tone", "ok");

      // Edit the last line at the bottom of the long invoice: 1 kg -> 0.5 kg.
      const lastLine = editor.getByTestId("purchase-line-4");
      await lastLine.scrollIntoViewIfNeeded();
      await lastLine.getByLabel("Quantity").fill("0.5");

      // The detailed banner is scrolled out of view, but the compact summary is not.
      await expect(banner).not.toBeInViewport();
      await expect(summary).toBeInViewport({ ratio: 1 });
      await expect(summary).toHaveAttribute("data-tone", "bad");
      await expect(summary).toContainText("$18.00");
      await expect(summary).toContainText("$20.00");
      await expect(summary).toContainText("$2.00");
      // The independent mapping blocker is shown alongside it, never instead of it.
      await expect(bar).toContainText("Map 5 items to inventory before receiving");
      await expect(bar).toBeInViewport({ ratio: 1 });
      const receive = bar.getByRole("button", { name: "Save & receive" });
      await expect(receive).toBeDisabled();
      await expect(receive).toBeInViewport({ ratio: 1 });
      // Not announced as an alert on every keystroke: only the detailed banner carries the alert role.
      expect(await summary.getAttribute("role")).toBeNull();

      // The sticky bar must not cover the field being edited.
      const barBox = await bar.boundingBox();
      const fieldBox = await lastLine.getByLabel("Quantity").boundingBox();
      expect(barBox && fieldBox && (fieldBox.y + fieldBox.height <= barBox.y + 1 || fieldBox.y >= barBox.y + barBox.height - 1)).toBe(true);
      await expectNoOverflow(page);
      await page.screenshot({ path: `test-results/purchase-sticky-summary-${width}.png` });

      // Restoring the quantity clears the mismatch, the mapping blocker remains, nothing was posted.
      await lastLine.getByLabel("Quantity").fill("1");
      await expect(summary).toHaveAttribute("data-tone", "ok");
      await expect(summary).not.toContainText("mismatch");
      await expect(bar).toContainText("Map 5 items to inventory before receiving");
      expect(world.posts.filter((post) => post.path.endsWith("/receive"))).toHaveLength(0);
    });
  });
}
