import { expect, test, type Page, type Route } from "@playwright/test";

/**
 * Browser acceptance (#345) for the Data migration page at phone and tablet widths. The API is a small stateful fake:
 * the job changes only through the mocked upload/mapping/preview/approve/execute/rollback endpoints.
 * No live data, no external services.
 */

const ORG = { id: 42, name: "Showcase Cafe", lifecycleStatus: "ACTIVE", setupStatus: "COMPLETE", subscriptionStatus: "ACTIVE", setupTemplateKey: "GENERIC_RESTAURANT", setupFeeStatus: "confirmed", isProspect: false, activeAt: "2026-01-01T00:00:00Z", setupCompletedAt: "2026-01-01T00:00:00Z" };
const MODULES = ["PURCHASES", "INVENTORY", "DAILY_CLOSE"];
const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
];

const json = (route: Route, payload: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(payload) });
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Action = "upload" | "mapping" | "preview" | "approve" | "execute" | "rollback";
type World = { job: any | null; calls: Record<Action, number>; reads: number; failReads: boolean; delayMs: number; failNext: Action | null };

function newWorld(): World {
  return { job: null, calls: { upload: 0, mapping: 0, preview: 0, approve: 0, execute: 0, rollback: 0 }, reads: 0, failReads: false, delayMs: 0, failNext: null };
}

function makeJob(status: string) {
  return {
    id: 7, organizationId: 42, createdByUserId: 1, approvedByUserId: null, sourceType: "file", sourceFileName: "suppliers.csv", sourceFileExtension: "csv",
    sourceMimeType: "text/csv", sourceHash: "abc", storagePath: "x", status, entityScope: "supplier", mapping: {}, summary: {}, rowCount: 2, previewRowCount: 2,
    appliedRowCount: status === "COMPLETED" ? 2 : 0, blockedRowCount: 0, warningCount: 0, approvedAt: null, executedAt: null, rolledBackAt: null, batchId: "",
    rollbackBlockers: [], sourceColumns: ["name", "phone"], sampleRows: [{ name: "Fresh Co", phone: "416-555-0100" }],
    createdAt: "2026-11-17T12:00:00Z", updatedAt: "2026-11-17T12:00:00Z", organization: null, files: [], rows: [], changes: [], mappings: [], auditEvents: [],
  };
}

const NEXT: Record<Exclude<Action, "upload">, { from: string[]; to: string }> = {
  mapping: { from: ["UPLOADED", "MAPPED", "PREVIEWED"], to: "MAPPED" },
  preview: { from: ["MAPPED", "PREVIEWED"], to: "PREVIEWED" },
  approve: { from: ["PREVIEWED"], to: "APPROVED" },
  execute: { from: ["APPROVED"], to: "COMPLETED" },
  rollback: { from: ["COMPLETED"], to: "ROLLED_BACK" },
};

async function installWorld(page: Page, world: World) {
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    const method = request.method();

    if (pathname === "/api/auth/me") {
      return json(route, {
        user: { id: 1, email: "owner@example.com", isActive: true, createdAt: null, updatedAt: null }, platformRole: null, membershipRole: "owner",
        currentOrganizationId: ORG.id, currentLocationId: 7, csrfToken: "csrf-token", enabledModuleKeys: MODULES,
        organizations: [{ organization: ORG, membershipRole: "owner", selected: true }],
      });
    }
    if (pathname === "/api/auth/csrf") return json(route, { csrfToken: "csrf-token" });
    if (pathname.startsWith("/api/organizations") && method === "GET") {
      const bundle = { organization: ORG, restaurantLocations: [{ id: 7, name: "Queen St Cafe", city: "Toronto", region: "ON" }], currentLocation: null, membershipRole: "owner", enabledModuleKeys: MODULES };
      return json(route, { organizations: [{ organization: ORG, membershipRole: "owner", selected: true }], currentOrganizationId: ORG.id, currentMembershipId: 1, currentLocationId: 7, currentOrganization: bundle, ...bundle });
    }
    if (world.failReads && method === "GET" && pathname.startsWith("/api/imports/")) {
      world.reads += 1;
      return json(route, { error: "Import service is unreachable." }, 503);
    }
    if (pathname === "/api/imports/organizations/42/jobs" && method === "GET") {
      world.reads += 1;
      return json(route, { jobs: world.job ? [world.job] : [] });
    }
    if (pathname === "/api/imports/jobs/7" && method === "GET") {
      world.reads += 1;
      return json(route, { job: world.job });
    }

    let action: Action | null = null;
    if (pathname === "/api/imports/jobs" && method === "POST") action = "upload";
    const m = pathname.match(/^\/api\/imports\/jobs\/7\/(mapping|preview|approve|execute|rollback)$/);
    if (m) action = m[1] as Action;
    if (action) {
      world.calls[action] += 1;
      if (world.delayMs) await sleep(world.delayMs);
      if (world.failNext === action) {
        world.failNext = null;
        return json(route, { error: `The ${action} step is temporarily unavailable.` }, 503);
      }
      if (action === "upload") {
        world.job = makeJob("UPLOADED");
      } else {
        const rule = NEXT[action];
        if (!world.job || !rule.from.includes(world.job.status)) return json(route, { error: `Cannot ${action} from ${world.job?.status}.` }, 409);
        world.job = { ...world.job, status: rule.to };
      }
      return json(route, { job: world.job });
    }
    return json(route, { error: `Unhandled ${method} ${pathname}` }, 404);
  });
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

const CSV = "tests/e2e/fixtures/suppliers.csv";

for (const viewport of VIEWPORTS) {
  test.describe(`${viewport.width}px`, () => {
    test.use({ viewport });

    test(`upload shows progress, sends one request and loads the server job at ${viewport.width}px`, async ({ page }) => {
      const world = newWorld();
      world.delayMs = 400;
      await installWorld(page, world);
      await page.goto("/imports", { waitUntil: "domcontentloaded" });
      await page.setInputFiles('input[name="import-file"]', CSV);
      await page.getByRole("button", { name: "Upload file" }).dblclick();
      await expect(page.getByRole("button", { name: "Uploading…" })).toBeDisabled();
      await expect(page.getByRole("status").filter({ hasText: "File uploaded." })).toBeVisible();
      expect(world.calls.upload).toBe(1);
      await expect(page.getByRole("button", { name: "Save mapping" })).toBeVisible();
      await expectNoHorizontalOverflow(page);
    });

    test(`a failed upload shows the error, keeps the chosen file and retry succeeds at ${viewport.width}px`, async ({ page }) => {
      const world = newWorld();
      world.failNext = "upload";
      await installWorld(page, world);
      await page.goto("/imports", { waitUntil: "domcontentloaded" });
      await page.setInputFiles('input[name="import-file"]', CSV);
      await page.getByRole("button", { name: "Upload file" }).click();
      await expect(page.getByRole("alert")).toContainText("The upload step is temporarily unavailable.");
      await expect(page.locator('input[name="import-file"]')).toHaveValue(/suppliers\.csv/);
      await expectNoHorizontalOverflow(page);

      await page.getByRole("button", { name: "Upload file" }).click();
      await expect(page.getByRole("status").filter({ hasText: "File uploaded." })).toBeVisible();
      await expect(page.getByRole("alert")).toHaveCount(0);
      expect(world.calls.upload).toBe(2);
    });

    test(`when the upload succeeds but the follow-up reads fail, the workspace and a retry control stay available at ${viewport.width}px`, async ({ page }) => {
      const world = newWorld();
      await installWorld(page, world);
      await page.goto("/imports", { waitUntil: "domcontentloaded" });
      await page.setInputFiles('input[name="import-file"]', CSV);
      world.failReads = true;
      await page.getByRole("button", { name: "Upload file" }).click();
      await expect(page.getByRole("status").filter({ hasText: "File uploaded." })).toBeVisible();
      await expect(page.getByRole("status").filter({ hasText: "could not be refreshed" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Load error" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Save mapping" })).toBeVisible();
      world.failReads = false;
      await page.getByRole("button", { name: "Refresh import jobs" }).click();
      await expect(page.getByRole("button", { name: /suppliers\.csv/ })).toBeVisible();
      expect(world.calls.upload).toBe(1);
      await expectNoHorizontalOverflow(page);
    });

    test(`mapping, preview, approve, execute and rollback each show progress, block duplicates and re-fetch at ${viewport.width}px`, async ({ page }) => {
      const world = newWorld();
      world.job = makeJob("UPLOADED");
      await installWorld(page, world);
      await page.goto("/imports", { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("button", { name: "Save mapping" })).toBeVisible();
      world.delayMs = 300;

      await page.getByRole("button", { name: "Save mapping" }).dblclick();
      await expect(page.getByRole("button", { name: "Saving…" })).toBeDisabled();
      await expect(page.getByRole("status").filter({ hasText: "Mapping saved." })).toBeVisible();
      expect(world.calls.mapping).toBe(1);

      await page.getByRole("button", { name: "Preview", exact: true }).dblclick();
      await expect(page.getByRole("status").filter({ hasText: "Preview refreshed" })).toBeVisible();
      expect(world.calls.preview).toBe(1);

      await page.getByRole("button", { name: "Approve", exact: true }).dblclick();
      await expect(page.getByRole("status").filter({ hasText: "Import approved." })).toBeVisible();
      expect(world.calls.approve).toBe(1);

      const readsBefore = world.reads;
      const execute = page.getByRole("button", { name: "Execute" });
      await execute.dblclick();
      await expect(page.getByRole("button", { name: "Executing…" })).toBeDisabled();
      await expect(page.getByRole("button", { name: "Approve", exact: true })).toBeDisabled();
      await expect(page.getByRole("status").filter({ hasText: "Import executed." })).toBeVisible();
      expect(world.calls.execute).toBe(1);
      expect(world.reads).toBeGreaterThan(readsBefore);
      await expect(page.getByRole("button", { name: "Execute" })).toBeDisabled();

      await page.getByRole("button", { name: "Rollback" }).dblclick();
      await expect(page.getByRole("status").filter({ hasText: "Import rolled back." })).toBeVisible();
      expect(world.calls.rollback).toBe(1);
      await expect(page.getByRole("button", { name: "Rollback" })).toBeDisabled();
      await expectNoHorizontalOverflow(page);
    });

    test(`a failed execute is visible, leaves the job approved and a retry succeeds at ${viewport.width}px`, async ({ page }) => {
      const world = newWorld();
      world.job = makeJob("APPROVED");
      world.failNext = "execute";
      await installWorld(page, world);
      await page.goto("/imports", { waitUntil: "domcontentloaded" });
      await page.getByRole("button", { name: "Execute" }).click();
      await expect(page.getByRole("alert")).toContainText("The execute step is temporarily unavailable.");
      await expect(page.getByRole("status").filter({ hasText: "Import executed." })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Execute" })).toBeEnabled();
      await expectNoHorizontalOverflow(page);

      await page.getByRole("button", { name: "Execute" }).click();
      await expect(page.getByRole("status").filter({ hasText: "Import executed." })).toBeVisible();
      await expect(page.getByRole("alert")).toHaveCount(0);
      expect(world.calls.execute).toBe(2);
    });
  });
}
