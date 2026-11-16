import { expect, test, type Page, type Route } from "@playwright/test";

/**
 * Browser acceptance (#329) for Team invitations at phone and tablet widths. The API is a small stateful fake:
 * the invitation list changes only through the mocked create/cancel endpoints. No live data, no external services.
 */

const ORG = { id: 42, name: "Showcase Cafe", lifecycleStatus: "ACTIVE", setupStatus: "COMPLETE", subscriptionStatus: "ACTIVE", setupTemplateKey: "GENERIC_RESTAURANT", setupFeeStatus: "confirmed", isProspect: false, activeAt: "2026-01-01T00:00:00Z", setupCompletedAt: "2026-01-01T00:00:00Z" };
const MODULES = ["PURCHASES", "INVENTORY", "DAILY_CLOSE"];
const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
];

const json = (route: Route, payload: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(payload) });
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Invitation = { id: number; organizationId: number; invitedEmail: string; role: string; status: string; expiresAt: string | null; revokedAt: string | null; acceptedAt: string | null; createdAt: string; updatedAt: string };
type World = { invitations: Invitation[]; creates: number; cancels: number; reads: number; delayMs: number; failNext: "create" | "cancel" | null };

function newWorld(): World {
  const base = { organizationId: 42, expiresAt: null, revokedAt: null, acceptedAt: null, createdAt: "2026-11-10T12:00:00Z", updatedAt: "2026-11-10T12:00:00Z" };
  return {
    invitations: [
      { id: 1, invitedEmail: "sam.manager@example.com", role: "manager", status: "pending", ...base },
      { id: 2, invitedEmail: "lee.baker@example.com", role: "manager", status: "pending", ...base },
    ],
    creates: 0, cancels: 0, reads: 0, delayMs: 0, failNext: null,
  };
}

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
    if (pathname.startsWith("/api/organizations") && method === "GET") {
      const bundle = { organization: ORG, restaurantLocations: [{ id: 7, name: "Queen St Cafe", city: "Toronto", region: "ON" }], currentLocation: null, membershipRole: "owner", enabledModuleKeys: MODULES };
      return json(route, { organizations: [{ organization: ORG, membershipRole: "owner", selected: true }], currentOrganizationId: ORG.id, currentMembershipId: 1, currentLocationId: 7, currentOrganization: bundle, ...bundle });
    }
    if (pathname === "/api/organization-invitations" && method === "GET") {
      world.reads += 1;
      return json(route, { invitations: world.invitations });
    }
    if (pathname === "/api/organization-invitations" && method === "POST") {
      world.creates += 1;
      if (world.delayMs) await sleep(world.delayMs);
      if (world.failNext === "create") {
        world.failNext = null;
        return json(route, { error: "Invitations are temporarily unavailable." }, 503);
      }
      const invitation: Invitation = { id: 100 + world.creates, organizationId: 42, invitedEmail: String(body.email), role: String(body.role), status: "pending", expiresAt: null, revokedAt: null, acceptedAt: null, createdAt: "2026-11-16T12:00:00Z", updatedAt: "2026-11-16T12:00:00Z" };
      world.invitations = [invitation, ...world.invitations];
      return json(route, { invitation, invitationUrl: `/invite/token-${invitation.id}` });
    }
    const cancel = pathname.match(/^\/api\/organization-invitations\/(\d+)\/cancel$/);
    if (cancel && method === "POST") {
      world.cancels += 1;
      if (world.delayMs) await sleep(world.delayMs);
      if (world.failNext === "cancel") {
        world.failNext = null;
        return json(route, { error: "Could not reach the invitation service." }, 503);
      }
      world.invitations = world.invitations.map((entry) => (entry.id === Number(cancel[1]) ? { ...entry, status: "revoked", revokedAt: "2026-11-16T12:00:00Z" } : entry));
      return json(route, { invitation: world.invitations.find((entry) => entry.id === Number(cancel[1])) });
    }
    return json(route, { error: `Unhandled ${method} ${pathname}` }, 404);
  });
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

for (const viewport of VIEWPORTS) {
  test.describe(`${viewport.width}px`, () => {
    test.use({ viewport });

    test(`cancelling an invitation shows progress, sends one request and refreshes from the server at ${viewport.width}px`, async ({ page }) => {
      const world = newWorld();
      world.delayMs = 400;
      await installWorld(page, world);
      await page.goto("/owner/team", { waitUntil: "domcontentloaded" });
      await expect(page.getByText("sam.manager@example.com")).toBeVisible();

      const cancelButtons = page.getByRole("button", { name: "Cancel" });
      await cancelButtons.first().dblclick();
      await expect(page.getByRole("button", { name: "Cancelling..." })).toBeVisible();
      await expect(page.getByRole("status").filter({ hasText: "Invitation cancelled." })).toBeVisible();
      expect(world.cancels).toBe(1);
      expect(world.reads).toBeGreaterThanOrEqual(2);
      await expect(page.getByText("Revoked", { exact: true })).toHaveCount(1);
      await expect(page.getByRole("button", { name: "Cancel" })).toHaveCount(1);
      await expectNoHorizontalOverflow(page);
    });

    test(`a failed cancel shows the error, keeps the invitation pending and retry succeeds at ${viewport.width}px`, async ({ page }) => {
      const world = newWorld();
      world.failNext = "cancel";
      await installWorld(page, world);
      await page.goto("/owner/team", { waitUntil: "domcontentloaded" });
      await page.getByRole("button", { name: "Cancel" }).first().click();
      await expect(page.getByText("Could not reach the invitation service.")).toBeVisible();
      await expect(page.getByRole("button", { name: "Cancel" })).toHaveCount(2);
      await expectNoHorizontalOverflow(page);

      await page.getByRole("button", { name: "Cancel" }).first().click();
      await expect(page.getByText("Invitation cancelled.")).toBeVisible();
      await expect(page.getByText("Could not reach the invitation service.")).toHaveCount(0);
      expect(world.cancels).toBe(2);
      await expect(page.getByRole("button", { name: "Cancel" })).toHaveCount(1);
    });

    test(`creating an invitation sends one POST on double submit, and a failed create can be retried at ${viewport.width}px`, async ({ page }) => {
      const world = newWorld();
      world.failNext = "create";
      await installWorld(page, world);
      await page.goto("/owner/team", { waitUntil: "domcontentloaded" });

      await page.getByLabel("Invitee email").fill("new.hire@example.com");
      await page.getByRole("button", { name: "Create invitation" }).click();
      await expect(page.getByText("Invitations are temporarily unavailable.")).toBeVisible();
      await expect(page.getByText("new.hire@example.com", { exact: true })).toHaveCount(0);
      expect(world.creates).toBe(1);

      world.delayMs = 400;
      await page.getByRole("button", { name: "Create invitation" }).dblclick();
      await expect(page.getByRole("button", { name: "Creating invitation..." })).toBeDisabled();
      await expect(page.getByText("Latest invitation URL")).toBeVisible();
      expect(world.creates).toBe(2);
      await expect(page.getByText("new.hire@example.com", { exact: true })).toBeVisible();
      await expectNoHorizontalOverflow(page);
    });
  });
}
