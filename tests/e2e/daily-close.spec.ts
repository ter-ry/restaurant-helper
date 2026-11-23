import { expect, test, type Page, type Route } from "@playwright/test";

/**
 * Browser acceptance for the Square Daily Close workflow at phone and tablet widths.
 * The API is a small stateful fake that mirrors the documented server rules (one session per location/date,
 * draft -> completed, completed is read-only). It exercises the real React page: in-progress states,
 * duplicate-submit prevention, server refresh after success, failure feedback and the owner cash-variance policy
 * (variance only against verified expected cash; never invented). No live data and no external services.
 */

type World = {
  session: null | { id: number; status: "DRAFT" | "COMPLETED"; notes: string; countedCash: number | null; completedAt: string | null };
  expectedCash: number | null;
  calls: { method: string; path: string; body: any }[];
  delayMs: number;
  failFinalize: boolean;
};

const ORG = { id: 42, name: "Showcase Cafe", lifecycleStatus: "ACTIVE", setupStatus: "COMPLETE", subscriptionStatus: "ACTIVE", setupTemplateKey: "GENERIC_RESTAURANT", setupFeeStatus: "confirmed", isProspect: false, activeAt: "2026-01-01T00:00:00Z", setupCompletedAt: "2026-01-01T00:00:00Z" };
const LOCATIONS = [{ id: 7, name: "Queen St Cafe", city: "Toronto", region: "ON", timezone: "America/Toronto" }];
const MODULES = ["PURCHASES", "INVENTORY", "REORDER_PLANS", "DAILY_CLOSE"];
const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
];
const DATE = "2026-11-15";

const json = (route: Route, payload: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(payload) });

function newWorld(expectedCash: number | null = 250): World {
  return { session: null, expectedCash, calls: [], delayMs: 0, failFinalize: false };
}

function closePayload(world: World) {
  const s = world.session;
  const completed = s?.status === "COMPLETED";
  const cash = {
    status: world.expectedCash == null ? "unavailable" : "available", mode: "drawer_shift", expectedCash: world.expectedCash,
    openingFloat: 100, cashPayments: 150, cashRefunds: 0, paidIn: 0, paidOut: 0, closedCash: null,
    countedCash: s?.countedCash ?? null,
    overShort: s?.countedCash != null && world.expectedCash != null ? Math.round((s.countedCash - world.expectedCash) * 100) / 100 : null,
    varianceUnavailableReason: world.expectedCash == null ? "A cash drawer shift is still open, so expected cash cannot be verified for this date." : undefined,
    openShiftCount: world.expectedCash == null ? 1 : 0, unreconciledShiftCount: 0,
  };
  const snapshot = {
    healthStatus: "Ready", inventoryValue: 1200, readyToFinalize: true,
    sales: { netSales: 1840.5, orders: 96, refunds: 12.25, cancelledOrders: 2 },
    usage: { period: null, coverage: {}, totals: { theoreticalUsage: 10, actualUsage: null, discrepancy: null, discrepancyPercent: null }, contributingMenuItems: [], unmappedVariations: [], ingredientUsage: [] },
    variance: { quantity: null, percent: null, value: null },
    cashReconciliation: cash, attentionItems: [],
    square: { squareStatus: "Connected", squareSynced: true, locationMapped: true },
  };
  const session = s && {
    id: s.id, organizationId: 42, locationId: 7, businessDate: DATE, status: s.status, summarySnapshot: {}, usageSnapshot: {}, exceptionsSnapshot: [],
    notes: s.notes, completedAt: s.completedAt, completedByUserId: null, createdByUserId: 1, createdAt: null, updatedAt: null, currentSnapshot: snapshot,
  };
  return {
    session, snapshot, usage: snapshot.usage, exceptions: [], businessDate: DATE, location: { id: 7, name: "Queen St Cafe", timezone: "America/Toronto" },
    history: session ? [session] : [], square: null,
  };
}

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

    if (pathname === "/api/pilot/daily-close" && method === "GET") return json(route, closePayload(world));
    if (world.delayMs && method !== "GET") await new Promise((resolve) => setTimeout(resolve, world.delayMs));

    if (pathname === "/api/pilot/daily-close" && method === "POST") {
      world.session ??= { id: 5, status: "DRAFT", notes: "", countedCash: null, completedAt: null };
      return json(route, closePayload(world), 201);
    }
    const patch = pathname.match(/^\/api\/pilot\/daily-close\/(\d+)$/);
    if (patch && method === "PATCH" && world.session) {
      if (world.session.status === "COMPLETED") return json(route, { error: "A completed close is read-only." }, 409);
      world.session.notes = String(body.notes ?? "");
      world.session.countedCash = body.reconciliation?.countedCash ?? null;
      return json(route, closePayload(world));
    }
    if (/^\/api\/pilot\/daily-close\/\d+\/finalize$/.test(pathname) && method === "POST" && world.session) {
      if (world.failFinalize) {
        world.failFinalize = false;
        return json(route, { error: "Square sales are still syncing. Try again in a minute." }, 409);
      }
      world.session.status = "COMPLETED";
      world.session.completedAt = "2026-11-16T03:00:00Z";
      return json(route, closePayload(world));
    }
    return json(route, { error: `Unmocked ${method} ${pathname}` }, 404);
  });
}

async function expectNoOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
}

async function openPage(page: Page) {
  await page.goto(`/app/daily-close?locationId=7&businessDate=${DATE}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Daily Close" }).first()).toBeVisible();
}

for (const viewport of VIEWPORTS) {
  test.describe(`Daily Close at ${viewport.width}px`, () => {
    test.use({ viewport });

    test("Start close shows progress, sends one request on a double tap and refreshes to the active close", async ({ page }) => {
      const world = newWorld();
      world.delayMs = 400;
      await installWorld(page, world);
      await openPage(page);
      await expect(page.getByRole("heading", { name: "Start a daily close" })).toBeVisible();
      const start = page.getByRole("button", { name: "Start close" });
      await start.dblclick();
      await expect(start).toBeDisabled();
      await expect(page.getByRole("heading", { name: "Active daily close" })).toBeVisible();
      expect(world.calls.filter((call) => call.method === "POST" && call.path === "/api/pilot/daily-close")).toHaveLength(1);
      await expect(page.getByText("$1,840.50").first()).toBeVisible();
      await expectNoOverflow(page);
    });

    test("counted cash shows live over/short against verified expected cash and saves with the notes", async ({ page }) => {
      const world = newWorld(250);
      world.session = { id: 5, status: "DRAFT", notes: "", countedCash: null, completedAt: null };
      await installWorld(page, world);
      await openPage(page);
      await expect(page.getByText("Enter the physically counted cash to calculate the variance.")).toBeVisible();
      await page.getByLabel("Counted cash").fill("245.5");
      await expect(page.getByText("$4.50 short")).toBeVisible();
      await page.getByLabel("Counted cash").fill("250");
      await expect(page.getByText("Balanced")).toBeVisible();
      await page.getByLabel("Counted cash").fill("245.5");
      await page.getByPlaceholder(/Add context/).fill("Paid out $4.50 for ice, no receipt.");
      await page.getByRole("button", { name: "Save notes" }).click();
      await expect.poll(() => world.calls.find((call) => call.method === "PATCH")?.body).toEqual({ notes: "Paid out $4.50 for ice, no receipt.", reconciliation: { countedCash: 245.5 } });
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(page.getByLabel("Counted cash")).toHaveValue("245.5");
      await expect(page.getByPlaceholder(/Add context/)).toHaveValue("Paid out $4.50 for ice, no receipt.");
      await expectNoOverflow(page);
    });

    test("variance is unavailable, with the reason, when expected cash cannot be verified", async ({ page }) => {
      const world = newWorld(null);
      world.session = { id: 5, status: "DRAFT", notes: "", countedCash: null, completedAt: null };
      await installWorld(page, world);
      await openPage(page);
      await page.getByLabel("Counted cash").fill("180");
      await expect(page.getByText("Variance unavailable")).toBeVisible();
      await expect(page.getByTestId("variance-unavailable")).toContainText("still open");
      await expect(page.getByText(/^\$[\d.,]+ (over|short)$/)).toHaveCount(0);
      await expectNoOverflow(page);
    });

    test("a failed completion shows the server's reason, keeps the draft editable and can be retried", async ({ page }) => {
      const world = newWorld(250);
      world.session = { id: 5, status: "DRAFT", notes: "", countedCash: null, completedAt: null };
      world.failFinalize = true;
      await installWorld(page, world);
      await openPage(page);
      await page.getByLabel("Counted cash").fill("250");
      const complete = page.getByRole("button", { name: "Complete close" });
      await complete.click();
      await expect(page.getByText("Square sales are still syncing. Try again in a minute.")).toBeVisible();
      await expect(complete).toBeEnabled();
      await expect(page.getByLabel("Counted cash")).toBeEnabled();
      expect(world.session!.status).toBe("DRAFT");
      await complete.click();
      await expect(page.getByRole("heading", { name: "Completed daily close" })).toBeVisible();
      await expect(page.getByText("Square sales are still syncing. Try again in a minute.")).toHaveCount(0);
      await expectNoOverflow(page);
    });

    test("completing sends one finalize on a double tap, then the close is read-only with a CSV download", async ({ page }) => {
      const world = newWorld(250);
      world.session = { id: 5, status: "DRAFT", notes: "", countedCash: null, completedAt: null };
      world.delayMs = 400;
      await installWorld(page, world);
      await openPage(page);
      await page.getByLabel("Counted cash").fill("250");
      const complete = page.getByRole("button", { name: "Complete close" });
      await complete.dblclick();
      await expect(page.getByRole("heading", { name: "Completed daily close" })).toBeVisible();
      expect(world.calls.filter((call) => call.path.endsWith("/finalize"))).toHaveLength(1);
      await expect(page.getByLabel("Counted cash")).toBeDisabled();
      await expect(page.getByPlaceholder(/Add context/)).toBeDisabled();
      await expect(page.getByRole("button", { name: "Save notes" })).toBeDisabled();
      await expect(page.getByRole("button", { name: "Complete close" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Download close CSV" })).toBeVisible();
      await expectNoOverflow(page);
    });
  });
}
