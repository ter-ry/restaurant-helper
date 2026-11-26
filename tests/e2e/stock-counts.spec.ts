import { expect, test, type Page, type Route } from "@playwright/test";

/**
 * Browser acceptance for Stock Counts at phone and tablet widths. A small stateful fake API mirrors the server rules
 * (one draft per start, counted/uncounted derived from saved lines, completed is read-only). It drives the real React page:
 * duplicate-submit prevention, server refresh, failure feedback with retry and the later-movement confirmation.
 * No live data and no external services.
 */

type Line = { id: number; inventoryItemId: number; name: string; unit: string; expected: number; counted: number | null; note: string; moved: boolean };
type Session = { id: number; status: "Draft" | "Completed"; lines: Line[]; notes: string; countedBy: string; version: number };
type World = {
  sessions: Session[];
  calls: { method: string; path: string; body: any }[];
  delayMs: number;
  failNext: null | "save" | "finalize";
  movementOnStart: boolean;
};

const ORG = { id: 42, name: "Showcase Cafe", lifecycleStatus: "ACTIVE", setupStatus: "COMPLETE", subscriptionStatus: "ACTIVE", setupTemplateKey: "GENERIC_RESTAURANT", setupFeeStatus: "confirmed", isProspect: false, activeAt: "2026-01-01T00:00:00Z", setupCompletedAt: "2026-01-01T00:00:00Z" };
const LOCATIONS = [{ id: 7, name: "Queen St Cafe", city: "Toronto", region: "ON", timezone: "America/Toronto" }];
const MODULES = ["PURCHASES", "INVENTORY", "REORDER_PLANS", "STOCK_COUNTS"];
const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
];
const ITEMS = [
  { id: 1, name: "Whole Milk", unit: "L", onHand: 24 },
  { id: 2, name: "Espresso Beans", unit: "kg", onHand: 8 },
  { id: 3, name: "Oat Milk", unit: "L", onHand: 12 },
];

const json = (route: Route, payload: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(payload) });
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function newWorld(): World {
  return { sessions: [], calls: [], delayMs: 0, failNext: null, movementOnStart: false };
}

function draftWorld(movement = false): World {
  const world = newWorld();
  world.sessions = [{
    id: 11, status: "Draft", notes: "", countedBy: "Floor lead", version: 1,
    lines: ITEMS.map((item, index) => ({ id: 100 + index, inventoryItemId: item.id, name: item.name, unit: item.unit, expected: item.onHand, counted: null, note: "", moved: movement && item.id === 1 })),
  }];
  return world;
}

const sessionPayload = (session: Session) => {
  const counted = session.lines.filter((line) => line.counted !== null).length;
  const moved = session.lines.filter((line) => line.moved).length;
  return {
    id: session.id, organizationId: 42, locationId: 7, status: session.status, startedAt: "2026-11-16T09:00:00Z",
    completedAt: session.status === "Completed" ? "2026-11-16T11:00:00Z" : null, countedBy: session.countedBy, notes: session.notes,
    itemCount: session.lines.length, countedLineCount: counted, uncountedLineCount: session.lines.length - counted,
    varianceTotal: session.lines.reduce((sum, line) => sum + (line.counted == null ? 0 : line.counted - line.expected), 0),
    movementCountSinceStart: moved, hasMovementSinceStart: moved > 0, createdByUserId: 1, finalizedByUserId: session.status === "Completed" ? 1 : null,
    createdAt: "2026-11-16T09:00:00Z", updatedAt: `2026-11-16T09:00:0${session.version}Z`,
    lines: session.lines.map((line, index) => ({
      id: line.id, sessionId: session.id, inventoryItemId: line.inventoryItemId, lineIndex: index, itemNameSnapshot: line.name, stockUnitSnapshot: line.unit,
      expectedQuantity: line.expected, countedQuantity: line.counted, variance: line.counted == null ? null : line.counted - line.expected,
      resultingQuantity: session.status === "Completed" ? line.counted : null, note: line.note, status: line.counted == null ? "Pending" : "Counted",
      movementCountSinceStart: line.moved ? 1 : 0, hasMovementSinceStart: line.moved, createdAt: null, updatedAt: null,
    })),
  };
};

const itemPayload = (item: (typeof ITEMS)[number]) => ({
  id: item.id, organizationId: 42, locationId: 7, supplierId: null, name: item.name, normalizedName: item.name.toLowerCase(), category: "Dairy & Bar",
  stockUnit: item.unit, currentOnHand: item.onHand, minQuantity: 2, parLevel: 10, preferredSupplierName: "", latestPurchasePrice: 3, lastPurchaseUnit: item.unit,
  lastPurchaseConversionFactor: 1, lastReceivedAt: null, lastCountedAt: null, averageDailyUsage: null, estimatedCostMethod: "latest_purchase_price", active: true,
  notes: "", createdByUserId: 1, updatedByUserId: 1, createdAt: null, updatedAt: null,
});

async function installWorld(page: Page, world: World) {
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    const method = request.method();
    let body: any = {};
    try {
      body = JSON.parse(request.postData() ?? "{}");
    } catch {
      body = {};
    }
    if (method !== "GET") world.calls.push({ method, path: pathname, body });

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
    if (pathname === "/api/pilot/inventory" && method === "GET") {
      return json(route, {
        items: ITEMS.map(itemPayload), movements: [], countSessions: [], reorderPlan: { suggestions: [], groupedBySupplier: [] },
        summary: { inventoryItemCount: ITEMS.length, inventoryOutOfStockCount: 0, inventoryReorderNowCount: 0, inventoryLowStockCount: 0, inventoryValue: 0 },
      });
    }
    if (pathname === "/api/pilot/suppliers") return json(route, { suppliers: [] });
    if (pathname === "/api/pilot/inventory/negative-stock") return json(route, { count: 0, posCausedCount: 0, items: [] });
    if (pathname === "/api/pilot/inventory/count-sessions" && method === "GET") return json(route, { countSessions: world.sessions.map(sessionPayload) });
    const one = pathname.match(/^\/api\/pilot\/inventory\/count-sessions\/(\d+)(\/finalize)?$/);
    if (one && method === "GET") {
      const found = world.sessions.find((entry) => entry.id === Number(one[1]));
      return found ? json(route, sessionPayload(found)) : json(route, { error: "Not found." }, 404);
    }

    if (world.delayMs) await sleep(world.delayMs);

    if (pathname === "/api/pilot/inventory/count-sessions" && method === "POST") {
      const ids: number[] = body.itemIds ?? [];
      const created: Session = {
        id: 11 + world.sessions.length, status: "Draft", notes: body.notes ?? "", countedBy: body.countedBy ?? "", version: 1,
        lines: ITEMS.filter((item) => ids.includes(item.id)).map((item, index) => ({ id: 100 + index, inventoryItemId: item.id, name: item.name, unit: item.unit, expected: item.onHand, counted: null, note: "", moved: world.movementOnStart && item.id === 1 })),
      };
      world.sessions.push(created);
      return json(route, sessionPayload(created), 201);
    }
    if (one && !one[2] && method === "PATCH") {
      const found = world.sessions.find((entry) => entry.id === Number(one[1]));
      if (!found) return json(route, { error: "Not found." }, 404);
      if (found.status === "Completed") return json(route, { error: "A finalized count is read-only." }, 409);
      if (world.failNext === "save") {
        world.failNext = null;
        return json(route, { error: "Could not save: the count was changed by someone else. Refresh and try again." }, 409);
      }
      found.notes = body.notes ?? found.notes;
      found.countedBy = body.countedBy ?? found.countedBy;
      for (const patch of body.lines ?? []) {
        const line = found.lines.find((entry) => entry.id === patch.id);
        if (line) {
          line.counted = patch.countedQuantity;
          line.note = patch.note ?? "";
        }
      }
      found.version += 1;
      return json(route, sessionPayload(found));
    }
    if (one && one[2] && method === "POST") {
      const found = world.sessions.find((entry) => entry.id === Number(one[1]));
      if (!found) return json(route, { error: "Not found." }, 404);
      if (world.failNext === "finalize") {
        world.failNext = null;
        return json(route, { error: "Finalize failed: inventory is locked by another update. Try again." }, 409);
      }
      if (found.lines.some((line) => line.moved) && !body.confirmConcurrency) return json(route, { error: "Later inventory movements must be confirmed." }, 409);
      found.status = "Completed";
      found.version += 1;
      return json(route, sessionPayload(found));
    }
    return json(route, { error: `Unmocked ${method} ${pathname}` }, 404);
  });
}

async function expectNoOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
}

async function openCounts(page: Page) {
  await page.goto("/app/inventory?view=counts", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Stock Counts" })).toBeVisible();
  await expect(page.getByText("Loading stock counts…")).toHaveCount(0);
}

for (const viewport of VIEWPORTS) {
  test.describe(`Stock Counts at ${viewport.width}px`, () => {
    test.use({ viewport });

    test("starting a count sends one request on a double tap and opens the count with every active item", async ({ page }) => {
      const world = newWorld();
      world.delayMs = 400;
      await installWorld(page, world);
      await openCounts(page);
      await expect(page.getByText("No count in progress")).toBeVisible();
      await page.getByRole("button", { name: "New count" }).first().click();
      const start = page.getByRole("button", { name: "Start count" });
      await start.dblclick();
      await expect(page.getByRole("dialog").getByText("Count inventory")).toBeVisible();
      expect(world.calls.filter((call) => call.method === "POST" && call.path === "/api/pilot/inventory/count-sessions")).toHaveLength(1);
      expect(world.calls[0].body.itemIds).toEqual([1, 2, 3]);
      await expect(page.getByRole("dialog").getByLabel("Counted quantity for Whole Milk")).toBeVisible();
      await expect(page.getByRole("dialog").getByLabel("Counted quantity for Oat Milk")).toBeVisible();
      await expectNoOverflow(page);
    });

    test("counts and notes save as a draft, finish stays blocked until every line is saved as counted, then completes once", async ({ page }) => {
      const world = draftWorld();
      world.delayMs = 300;
      await installWorld(page, world);
      await openCounts(page);
      await page.getByRole("button", { name: /Draft #11/ }).click();
      const dialog = page.getByRole("dialog");
      await expect(dialog.getByText("Count inventory")).toBeVisible();
      await expect(dialog.getByRole("button", { name: "Continue / review" })).toBeDisabled();

      await dialog.getByLabel("Counted quantity for Whole Milk").fill("22");
      await dialog.getByLabel("Variance note for Whole Milk").fill("Two cartons spoiled");
      await dialog.getByLabel("Counted quantity for Espresso Beans").fill("8");
      await dialog.getByLabel("Counted quantity for Oat Milk").fill("12");
      await dialog.getByRole("button", { name: "Save draft" }).dblclick();
      // Review must not open while the draft save is still in flight (owner #169 segment 4C).
      await expect(dialog.getByRole("button", { name: "Continue / review" })).toBeDisabled();
      await expect(dialog.getByRole("button", { name: "Continue / review" })).toBeEnabled();
      expect(world.calls.filter((call) => call.method === "PATCH")).toHaveLength(1);
      expect(world.calls.find((call) => call.method === "PATCH")!.body.lines).toEqual([
        { id: 100, countedQuantity: 22, note: "Two cartons spoiled" },
        { id: 101, countedQuantity: 8, note: "" },
        { id: 102, countedQuantity: 12, note: "" },
      ]);

      await dialog.getByRole("button", { name: "Continue / review" }).click();
      await expect(dialog.getByText("Review differences")).toBeVisible();
      await expect(dialog.getByText("Whole Milk")).toBeVisible();
      await expect(dialog.getByText("24 → 22 L")).toBeVisible();
      await expect(dialog.getByText("Espresso Beans")).toHaveCount(0);
      await dialog.getByRole("button", { name: "Complete count" }).dblclick();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      expect(world.calls.filter((call) => call.path.endsWith("/finalize"))).toHaveLength(1);
      expect(world.sessions[0].status).toBe("Completed");
      await expect(page.getByText("Count applied")).toBeVisible();
      await expect(page.getByLabel("Counted quantity for Whole Milk")).toBeDisabled();
      await expect(page.getByRole("button", { name: "Complete count" })).toHaveCount(0);
      await expectNoOverflow(page);
    });

    test("a failed save and a failed finalize show the server reason, keep the draft editable and can be retried", async ({ page }) => {
      const world = draftWorld();
      world.sessions[0].lines.forEach((line) => (line.counted = line.expected));
      await installWorld(page, world);
      await openCounts(page);
      await page.getByRole("button", { name: /Draft #11/ }).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByLabel("Counted quantity for Whole Milk").fill("23");

      world.failNext = "save";
      await dialog.getByRole("button", { name: "Save draft" }).click();
      await expect(dialog.getByRole("alert")).toContainText("changed by someone else");
      await expect(dialog.getByLabel("Counted quantity for Whole Milk")).toHaveValue("23");
      await dialog.getByRole("button", { name: "Save draft" }).click();
      await expect(dialog.getByRole("alert")).toHaveCount(0);

      await dialog.getByRole("button", { name: "Continue / review" }).click();
      world.failNext = "finalize";
      await dialog.getByRole("button", { name: "Complete count" }).click();
      await expect(dialog.getByRole("alert")).toContainText("inventory is locked by another update");
      expect(world.sessions[0].status).toBe("Draft");
      await expect(dialog.getByRole("button", { name: "Complete count" })).toBeEnabled();
      await dialog.getByRole("button", { name: "Complete count" }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      expect(world.sessions[0].status).toBe("Completed");
      await expectNoOverflow(page);
    });

    test("switching between two saved drafts does not show unsaved changes until something is edited", async ({ page }) => {
      const world = draftWorld();
      world.sessions.push({ ...world.sessions[0], id: 12, countedBy: "Closing lead", lines: world.sessions[0].lines.map((line) => ({ ...line, id: line.id + 100, counted: line.inventoryItemId === 2 ? 8 : null })) });
      await installWorld(page, world);
      await openCounts(page);
      await page.getByRole("button", { name: /Draft #11/ }).click();
      const dialog = page.getByRole("dialog");
      await expect(dialog.getByLabel("Counted quantity for Whole Milk")).toBeVisible();
      await dialog.getByRole("button", { name: "Return to overview" }).click();
      await expect(page.getByText("Unsaved changes")).toHaveCount(0);

      await page.getByRole("button", { name: /Draft #12/ }).click();
      await expect(dialog.getByLabel("Counted quantity for Espresso Beans")).toHaveValue("8");
      await expect(page.getByText("Unsaved changes")).toHaveCount(0);
      await dialog.getByLabel("Counted quantity for Whole Milk").fill("23");
      await expect(page.getByText("Unsaved changes")).toBeVisible();
    });

    test("later inventory movement requires an explicit confirmation before the count can be completed", async ({ page }) => {
      const world = draftWorld(true);
      world.sessions[0].lines.forEach((line) => (line.counted = line.expected));
      await installWorld(page, world);
      await openCounts(page);
      await page.getByRole("button", { name: /Draft #11/ }).click();
      const dialog = page.getByRole("dialog");
      await expect(dialog.getByText("Review later movements")).toBeVisible();
      await dialog.getByRole("button", { name: "Continue / review" }).click();
      const complete = dialog.getByRole("button", { name: "Complete count" });
      await expect(complete).toBeDisabled();
      await dialog.getByLabel(/reviewed later inventory activity/i).check();
      await expect(complete).toBeEnabled();
      await complete.click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      expect(world.calls.find((call) => call.path.endsWith("/finalize"))!.body).toEqual({ confirmConcurrency: true });
      await expectNoOverflow(page);
    });
  });
}
