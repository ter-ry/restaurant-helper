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
  /** Purchase list reads answered by the fake server (proves the page re-fetched after a mutation). */
  listReads: number;
  nextId: number;
};
const newWorld = (): World => ({ invoices: [], onHand: 12, posts: [], delayMs: 0, refuseCreate: null, failReceiveOnce: false, listReads: 0, nextId: 600 });
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
      return json(route, {
        invoices: world.invoices.map(invoiceJson), suppliers: [{ id: 3, name: "Cedar Meats" }], purchaseLines: [], priceChanges: [], summary: {},
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
    if (pathname === "/api/pilot/purchases/invoices" && method === "POST") {
      await mutate(() => null);
      if (world.refuseCreate) {
        const refusal = world.refuseCreate;
        return json(route, { error: refusal.message, errors: refusal.errors }, refusal.status);
      }
      const invoice = toInvoice(world.nextId++, body.status);
      world.invoices.push(invoice);
      return json(route, invoiceJson(invoice), 201);
    }
    if (pathname === "/api/pilot/purchases/ocr" && method === "POST") {
      await mutate(() => null);
      const field = (value: string | number) => ({ value, confidence: 0.95, needsReview: false });
      return json(route, {
        provider: "fake", fileName: "invoice.png", contentType: "image/png", rawText: "", evidenceToken: "token",
        fields: { supplier: field("Cedar Meats"), invoiceDate: field("2026-11-10"), invoiceNumber: field("OCR-1"), subtotal: field(4), tax: field(0), total: field(4) },
        lineItems: [{ itemName: "Chicken breast", originalDescription: "Chicken breast", quantity: 1, unit: "kg", unitPrice: 4, lineTotal: 4, confidence: 0.95, needsReview: false, rawSourceLine: "" }],
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

  test("a queue item opens in the right panel beside the queue, with pinned actions and a price-change warning", async ({ page }) => {
    const world = newWorld();
    // The mapped item averages $4/kg: line 1 is +12.5%, line 2 is +1%, the rest are unchanged.
    const lines = Array.from({ length: 8 }, (_, index) => savedLine(700, index, index === 0 ? 4.5 : index === 1 ? 4.04 : 4));
    world.invoices.push({ id: 700, invoiceNumber: "CM-700", status: "Draft", invoiceDate: "2026-11-10", subtotal: 32.54, tax: 0, totalAmount: 32.54, lineItems: lines });
    await installWorld(page, world);
    await page.goto("/app/purchases", { waitUntil: "domcontentloaded" });

    const panel = page.getByTestId("purchase-side-panel");
    await expect(panel).toContainText("Select a purchase to review it here");
    await page.getByTestId("purchase-queue").getByRole("button", { name: /CM-700/ }).click();

    const editor = panel.getByTestId("purchase-editor-card");
    await expect(editor).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0); // a panel, not a modal
    const queueBox = await page.getByTestId("purchase-queue").boundingBox();
    const panelBox = await panel.boundingBox();
    expect(queueBox && panelBox && queueBox.x + queueBox.width <= panelBox.x + 1).toBe(true); // side by side, queue still visible

    await expect(editor.getByText("Cost up 12.5% vs average cost")).toBeVisible(); // material change only
    await expect(editor.getByText(/Cost (up|down) 1(\.\d)?%/)).toHaveCount(0);
    await expect(editor.getByTestId("purchase-line-7")).toBeAttached();
    await expect(page.getByRole("button", { name: /CM-700/ })).toHaveAttribute("aria-current", "true");

    // Pinned: the action bar stays in view while the long line list scrolls, and acts on the saved draft.
    const bar = editor.getByTestId("purchase-action-bar");
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(bar).toBeInViewport();
    await editor.getByLabel("Invoice number").fill("CM-700A");
    await bar.getByRole("button", { name: "Save draft" }).click();
    await expect(page.getByText("Invoice CM-700A saved successfully.").first()).toBeVisible();
    expect(world.posts.filter((post) => post.method === "PATCH")).toHaveLength(1);
    await expectNoOverflow(page);
  });

  test("Save & receive from the pinned bar still asks for confirmation and receives once", async ({ page }) => {
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
    await expect(page.getByTestId("purchase-side-panel").getByTestId("purchase-editor-card")).toHaveCount(0);
  });

  test("arrow keys move between queue items and a completed purchase opens inline with one status vocabulary", async ({ page }) => {
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
    const detail = page.getByTestId("purchase-side-panel").getByTestId("purchase-detail-modal");
    await expect(detail).toContainText("CM-722");
    await expect(detail).toContainText("Received");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(queue).toBeVisible();
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
    await queue.getByRole("button", { name: /CM-731/ }).click();
    await expect(page.getByTestId("purchase-editor-card").getByLabel("Invoice number")).toHaveValue("CM-731");
  });
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
    const detail = page.getByTestId("purchase-side-panel").getByTestId("purchase-detail-modal");
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
    await queue.getByRole("button", { name: /CM-760/ }).click();
    await expect(editor.getByLabel("Supplier", { exact: true })).toHaveValue("Cedar Meats"); // B kept its own supplier
  });
});
