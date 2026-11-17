import { expect, test, type Page, type Route } from "@playwright/test";

/**
 * Browser acceptance (#333) for Stock Counts at phone and tablet widths. The API is a small stateful fake: count
 * sessions change only through the mocked create / save / finalize endpoints. No live data, no external services.
 */

const ORG = { id: 42, name: "Showcase Cafe", lifecycleStatus: "ACTIVE", setupStatus: "COMPLETE", subscriptionStatus: "ACTIVE", setupTemplateKey: "GENERIC_RESTAURANT", setupFeeStatus: "confirmed", isProspect: false, activeAt: "2026-01-01T00:00:00Z", setupCompletedAt: "2026-01-01T00:00:00Z" };
const MODULES = ["PURCHASES", "INVENTORY", "STOCK_COUNTS", "DAILY_CLOSE"];
const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
];

const json = (route: Route, payload: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(payload) });
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Item = { id: number; name: string; stockUnit: string; onHand: number };
type Line = { id: number; inventoryItemId: number; name: string; unit: string; expected: number; counted: number | null; note: string; later: number };
type Session = { id: number; status: "Draft" | "Completed"; countedBy: string; notes: string; lines: Line[]; rev: number };
type World = {
  items: Item[];
  sessions: Session[];
  creates: number;
  saves: any[];
  finalizes: any[];
  delayMs: number;
  failNext: "save" | "finalize" | null;
  /** When set, new sessions have a later movement on the first line. */
  laterMovement: boolean;
};

function newWorld(): World {
  return {
    items: [
      { id: 30, name: "Whole Milk", stockUnit: "L", onHand: 20 },
      { id: 31, name: "Oat Milk", stockUnit: "L", onHand: 8 },
      { id: 32, name: "Espresso Beans", stockUnit: "kg", onHand: 6 },
    ],
    sessions: [], creates: 0, saves: [], finalizes: [], delayMs: 0, failNext: null, laterMovement: false,
  };
}

const sessionPayload = (session: Session) => {
  const counted = session.lines.filter((line) => line.counted !== null);
  const movement = session.lines.filter((line) => line.later > 0);
  return {
    id: session.id, organizationId: 42, locationId: 7, status: session.status, startedAt: "2026-11-17T09:00:00Z",
    completedAt: session.status === "Completed" ? "2026-11-17T10:00:00Z" : null, countedBy: session.countedBy, notes: session.notes,
    itemCount: session.lines.length, countedLineCount: counted.length, uncountedLineCount: session.lines.length - counted.length,
    varianceTotal: counted.reduce((sum, line) => sum + (line.counted! - line.expected), 0),
    movementCountSinceStart: movement.reduce((sum, line) => sum + line.later, 0), hasMovementSinceStart: movement.length > 0,
    createdByUserId: 1, finalizedByUserId: session.status === "Completed" ? 1 : null, createdAt: "2026-11-17T09:00:00Z", updatedAt: `2026-11-17T09:00:${String(10 + session.rev).padStart(2, "0")}Z`,
    lines: session.lines.map((line, index) => ({
      id: line.id, sessionId: session.id, inventoryItemId: line.inventoryItemId, lineIndex: index, itemNameSnapshot: line.name, stockUnitSnapshot: line.unit,
      expectedQuantity: line.expected, countedQuantity: line.counted, variance: line.counted === null ? null : line.counted - line.expected,
      resultingQuantity: session.status === "Completed" ? line.counted : null, note: line.note, status: line.counted === null ? "Pending" : "Counted",
      movementCountSinceStart: line.later, hasMovementSinceStart: line.later > 0, createdAt: null, updatedAt: null,
    })),
  };
};

const itemPayload = (item: Item) => ({
  id: item.id, organizationId: 42, locationId: 7, supplierId: null, name: item.name, normalizedName: item.name.toLowerCase(), category: "Dairy", stockUnit: item.stockUnit,
  currentOnHand: item.onHand, minQuantity: 1, parLevel: 5, preferredSupplierName: "", latestPurchasePrice: 4, averageUnitCost: 4, lastPurchaseUnit: item.stockUnit,
  lastPurchaseConversionFactor: 1, lastReceivedAt: null, lastCountedAt: null, averageDailyUsage: 0.8, estimatedCostMethod: "weighted_average", active: true, notes: "",
  createdByUserId: 1, updatedByUserId: 1, createdAt: null, updatedAt: null,
});

async function installWorld(page: Page, world: World) {
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    const method = request.method();
    let body: any = {};
    try { body = JSON.parse(request.postData() ?? "{}"); } catch { /* no body */ }

    if (pathname === "/api/auth/me") {
      return json(route, {
        user: { id: 1, email: "owner@example.com", isActive: true, createdAt: null, updatedAt: null }, platformRole: null, membershipRole: "owner",
        currentOrganizationId: ORG.id, currentLocationId: 7, csrfToken: "csrf-token", enabledModuleKeys: MODULES,
        organizations: [{ organization: ORG, membershipRole: "owner", selected: true }],
      });
    }
    if (pathname === "/api/auth/csrf") return json(route, { csrfToken: "csrf-token" });
    if (pathname.startsWith("/api/organizations")) {
      const location = { id: 7, name: "Queen St Cafe", city: "Toronto", region: "ON" };
      const bundle = { organization: ORG, restaurantLocations: [location], currentLocation: location, membershipRole: "owner", enabledModuleKeys: MODULES };
      return json(route, { organizations: [{ organization: ORG, membershipRole: "owner", selected: true }], currentOrganizationId: ORG.id, currentMembershipId: 1, currentLocationId: 7, currentOrganization: bundle, ...bundle });
    }
    if (pathname === "/api/pilot/inventory" && method === "GET") {
      return json(route, {
        items: world.items.map(itemPayload), movements: [], countSessions: world.sessions.map(sessionPayload), reorderPlan: { suggestions: [], groupedBySupplier: [] },
        summary: { inventoryItemCount: world.items.length, inventoryOutOfStockCount: 0, inventoryReorderNowCount: 0, inventoryLowStockCount: 0, inventoryValue: 0 },
      });
    }
    if (pathname === "/api/pilot/inventory/negative-stock") return json(route, { count: 0, posCausedCount: 0, items: [] });
    if (pathname === "/api/pilot/inventory/count-sessions" && method === "GET") return json(route, { countSessions: world.sessions.map(sessionPayload) });
    if (pathname === "/api/pilot/inventory/count-sessions" && method === "POST") {
      world.creates += 1;
      if (world.delayMs) await sleep(world.delayMs);
      const ids: number[] = body.itemIds;
      const session: Session = {
        id: 900 + world.creates, status: "Draft", countedBy: String(body.countedBy ?? ""), notes: String(body.notes ?? ""), rev: 0,
        lines: world.items.filter((item) => ids.includes(item.id)).map((item, index) => ({
          id: 5000 + world.creates * 10 + index, inventoryItemId: item.id, name: item.name, unit: item.stockUnit, expected: item.onHand, counted: null, note: "",
          later: world.laterMovement && index === 0 ? 2 : 0,
        })),
      };
      world.sessions = [session, ...world.sessions];
      return json(route, sessionPayload(session), 201);
    }
    const one = pathname.match(/^\/api\/pilot\/inventory\/count-sessions\/(\d+)(\/finalize)?$/);
    if (one) {
      const session = world.sessions.find((entry) => entry.id === Number(one[1]));
      if (!session) return json(route, { error: "Count not found." }, 404);
      if (method === "GET") return json(route, sessionPayload(session));
      if (method === "PATCH") {
        world.saves.push(body);
        if (world.delayMs) await sleep(world.delayMs);
        if (world.failNext === "save") {
          world.failNext = null;
          return json(route, { error: "Could not save: the count service is unavailable." }, 503);
        }
        session.countedBy = String(body.countedBy ?? session.countedBy);
        for (const incoming of body.lines ?? []) {
          const line = session.lines.find((entry) => entry.id === incoming.id);
          if (line) { line.counted = incoming.countedQuantity; line.note = incoming.note ?? ""; }
        }
        session.rev += 1;
        return json(route, sessionPayload(session));
      }
      if (method === "POST" && one[2]) {
        world.finalizes.push(body);
        if (world.delayMs) await sleep(world.delayMs);
        if (world.failNext === "finalize") {
          world.failNext = null;
          return json(route, { error: "Could not apply the count: the inventory ledger is busy." }, 503);
        }
        if (session.status === "Completed") return json(route, { error: "This count is already finalized." }, 409);
        session.status = "Completed";
        for (const line of session.lines) world.items.find((item) => item.id === line.inventoryItemId)!.onHand = line.counted ?? line.expected;
        session.rev += 1;
        return json(route, sessionPayload(session));
      }
    }
    return json(route, { error: `Unhandled ${method} ${pathname}` }, 404);
  });
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

async function startCount(page: Page, world: World) {
  await page.goto("/app/inventory?view=counts", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Stock Counts" })).toBeVisible();
  await page.getByRole("button", { name: "New count" }).first().click();
  await expect(page.getByRole("dialog", { name: "New stock count" })).toBeVisible();
  await page.getByRole("button", { name: "Start count" }).dblclick();
  const dialog = page.getByRole("dialog", { name: /Stock count #/ });
  await expect(dialog).toBeVisible();
  expect(world.creates).toBe(1);
  // Let the post-create refresh settle so typed quantities are not replaced by the fetched draft.
  await expect(page.getByText("Refreshing stock counts…")).toHaveCount(0);
  await expect(page.getByText("Stock count 901 started.")).toBeVisible();
  return dialog;
}

for (const viewport of VIEWPORTS) {
  test.describe(`${viewport.width}px`, () => {
    test.use({ viewport });

    test(`start, count, save draft, complete and read-only history at ${viewport.width}px`, async ({ page }) => {
      const world = newWorld();
      world.delayMs = 300;
      await installWorld(page, world);
      const dialog = await startCount(page, world);
      await expect(dialog.getByLabel("Counted quantity for Whole Milk")).toBeVisible();
      await expect(dialog.getByLabel("Counted quantity for Oat Milk")).toBeVisible();
      await expect(dialog.getByLabel("Counted quantity for Espresso Beans")).toBeVisible();
      await expect(dialog.getByText("3 uncounted")).toBeVisible();
      await expect(dialog.getByRole("button", { name: "Continue / review" })).toBeDisabled();

      // Partial entry saved as a draft: still blocked from completing.
      await dialog.getByLabel("Counted quantity for Whole Milk").fill("18");
      await dialog.getByLabel("Variance note for Whole Milk").fill("Spilled during close");
      await dialog.getByLabel("Counted quantity for Oat Milk").fill("8");
      await dialog.getByRole("button", { name: "Save draft" }).click();
      await expect(dialog.getByRole("button", { name: "Saving…" })).toBeDisabled();
      await expect(page.getByText("Stock count 901 saved.")).toBeVisible();
      expect(world.saves).toHaveLength(1);
      expect(world.saves[0].lines.find((line: any) => line.countedQuantity === 18)).toMatchObject({ note: "Spilled during close" });
      await expect(dialog.getByText("1 uncounted")).toBeVisible();
      await expect(dialog.getByRole("button", { name: "Continue / review" })).toBeDisabled();

      // Reload shows the persisted values.
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(page.getByRole("heading", { name: /Edit count #901/ })).toBeVisible();
      await page.getByRole("button", { name: /Draft #901/ }).click();
      const reopened = page.getByRole("dialog", { name: "Stock count #901" });
      await expect(reopened.getByLabel("Counted quantity for Whole Milk")).toHaveValue("18");
      await expect(reopened.getByLabel("Variance note for Whole Milk")).toHaveValue("Spilled during close");
      await expect(reopened.getByLabel("Counted quantity for Espresso Beans")).toHaveValue("");

      await reopened.getByLabel("Counted quantity for Espresso Beans").fill("5");
      await reopened.getByRole("button", { name: "Save draft" }).click();
      await expect(page.getByText("Stock count 901 saved.")).toBeVisible();
      await expect(reopened.getByText("0 uncounted")).toBeVisible();
      await expectNoHorizontalOverflow(page);

      await reopened.getByRole("button", { name: "Continue / review" }).click();
      await expect(reopened.getByText("Whole Milk")).toBeVisible();
      await expect(reopened.getByText("20 → 18 L")).toBeVisible();
      await expect(reopened.getByText("6 → 5 kg")).toBeVisible();

      // Complete: one request on a double tap, then read-only in History.
      await reopened.getByRole("button", { name: "Complete count" }).dblclick();
      await expect(page.getByText("Stock count 901 finalized.")).toBeVisible();
      expect(world.finalizes).toHaveLength(1);
      expect(world.finalizes[0]).toMatchObject({ confirmConcurrency: false });
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(page.getByRole("heading", { name: /Completed count #901/ })).toBeVisible();
      await expect(page.getByText("Count applied")).toBeVisible();
      await expect(page.getByLabel("Counted quantity for Whole Milk")).toBeDisabled();
      await expect(page.getByRole("button", { name: "Apply count to inventory" })).toBeDisabled();
      await expect(page.getByRole("button", { name: "Save draft" })).toBeDisabled();
      expect(world.items.find((item) => item.id === 30)!.onHand).toBe(18);
      await expectNoHorizontalOverflow(page);
    });

    test(`later movement requires the confirmation before completing at ${viewport.width}px`, async ({ page }) => {
      const world = newWorld();
      world.laterMovement = true;
      await installWorld(page, world);
      const dialog = await startCount(page, world);
      await expect(dialog.getByText("Review later movements")).toBeVisible();
      await dialog.getByLabel("Counted quantity for Whole Milk").fill("20");
      await dialog.getByLabel("Counted quantity for Oat Milk").fill("8");
      await dialog.getByLabel("Counted quantity for Espresso Beans").fill("6");
      await dialog.getByRole("button", { name: "Save draft" }).click();
      await expect(page.getByText("Stock count 901 saved.")).toBeVisible();
      await dialog.getByRole("button", { name: "Continue / review" }).click();

      const complete = dialog.getByRole("button", { name: "Complete count" });
      await expect(complete).toBeDisabled();
      await dialog.getByRole("checkbox").check();
      await expect(complete).toBeEnabled();
      await complete.click();
      await expect(page.getByText("Stock count 901 finalized.")).toBeVisible();
      expect(world.finalizes).toEqual([{ confirmConcurrency: true }]);
    });

    test(`server failures show the reason, keep the draft editable and can be retried at ${viewport.width}px`, async ({ page }) => {
      const world = newWorld();
      await installWorld(page, world);
      const dialog = await startCount(page, world);
      await dialog.getByLabel("Counted quantity for Whole Milk").fill("19");
      await dialog.getByLabel("Counted quantity for Oat Milk").fill("8");
      await dialog.getByLabel("Counted quantity for Espresso Beans").fill("6");

      world.failNext = "save";
      await dialog.getByRole("button", { name: "Save draft" }).click();
      await expect(dialog.getByRole("alert")).toContainText("Could not save: the count service is unavailable.");
      await expect(dialog.getByLabel("Counted quantity for Whole Milk")).toHaveValue("19");
      await expect(dialog.getByLabel("Counted quantity for Whole Milk")).toBeEditable();
      await expect(dialog.getByRole("button", { name: "Continue / review" })).toBeDisabled();

      await dialog.getByRole("button", { name: "Save draft" }).click();
      await expect(page.getByText("Stock count 901 saved.")).toBeVisible();
      expect(world.saves).toHaveLength(2);
      await dialog.getByRole("button", { name: "Continue / review" }).click();

      world.failNext = "finalize";
      await dialog.getByRole("button", { name: "Complete count" }).click();
      await expect(dialog.getByRole("alert")).toContainText("Could not apply the count: the inventory ledger is busy.");
      expect(world.sessions[0].status).toBe("Draft");
      await expect(dialog.getByRole("button", { name: "Complete count" })).toBeEnabled();
      await expectNoHorizontalOverflow(page);

      await dialog.getByRole("button", { name: "Complete count" }).click();
      await expect(page.getByText("Stock count 901 finalized.")).toBeVisible();
      expect(world.finalizes).toHaveLength(2);
      expect(world.sessions[0].status).toBe("Completed");
    });
  });
}
