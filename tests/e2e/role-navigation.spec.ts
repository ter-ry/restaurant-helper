import { expect, test, type Page, type Route } from "@playwright/test";

/**
 * Browser acceptance (#351) for role- and module-based workspace navigation, desktop and phone.
 * Mocked API only: this verifies what the UI shows for a given session, not backend authorization.
 */

const ORG = { id: 42, name: "Showcase Cafe", lifecycleStatus: "ACTIVE", setupStatus: "COMPLETE", subscriptionStatus: "ACTIVE", setupTemplateKey: "GENERIC_RESTAURANT", setupFeeStatus: "confirmed", isProspect: false, activeAt: "2026-01-01T00:00:00Z", setupCompletedAt: "2026-01-01T00:00:00Z" };
const json = (route: Route, payload: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(payload) });

async function installSession(page: Page, membershipRole: "owner" | "manager", modules: string[]) {
  await page.route("**/api/**", async (route) => {
    const { pathname } = new URL(route.request().url());
    const method = route.request().method();
    if (pathname === "/api/auth/me") {
      return json(route, {
        user: { id: 1, email: "user@example.com", isActive: true, createdAt: null, updatedAt: null }, platformRole: null, membershipRole,
        currentOrganizationId: ORG.id, currentLocationId: 7, csrfToken: "csrf-token", enabledModuleKeys: modules,
        organizations: [{ organization: ORG, membershipRole, selected: true }],
      });
    }
    if (pathname === "/api/auth/csrf") return json(route, { csrfToken: "csrf-token" });
    if (pathname.startsWith("/api/organizations") && method === "GET") {
      const location = { id: 7, name: "Queen St Cafe", city: "Toronto", region: "ON", timezone: "America/Toronto" };
      const bundle = { organization: ORG, restaurantLocations: [location], currentLocation: location, membershipRole, enabledModuleKeys: modules };
      return json(route, { organizations: [{ organization: ORG, membershipRole, selected: true }], currentOrganizationId: ORG.id, currentMembershipId: 1, currentLocationId: 7, currentOrganization: bundle, ...bundle });
    }
    // Page data is out of scope here: unrelated endpoints fail so only the shell/navigation is under test.
    return json(route, { error: "not mocked" }, 503);
  });
}

const ALL_MODULES = ["PURCHASES", "INVENTORY", "MENU_COSTING", "SQUARE_INTEGRATION", "DAILY_CLOSE"];

test.describe("workspace navigation visibility", () => {
  test("owner sees Reports in the desktop sidebar and it opens the Owner Reports route", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await installSession(page, "owner", ALL_MODULES);
    await page.goto("/app/dashboard");
    const nav = page.getByRole("navigation", { name: "Workspace navigation" });
    for (const label of ["Dashboard", "Purchases", "Inventory", "Menu Costing", "Square", "Daily Close", "Reports"]) {
      await expect(nav.getByRole("link", { name: label, exact: true })).toBeVisible();
    }
    await nav.getByRole("link", { name: "Reports", exact: true }).click();
    await expect(page).toHaveURL(/\/owner\/reports/);
  });

  test("manager never sees Reports on desktop", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await installSession(page, "manager", ALL_MODULES);
    await page.goto("/app/dashboard");
    const nav = page.getByRole("navigation", { name: "Workspace navigation" });
    await expect(nav.getByRole("link", { name: "Purchases", exact: true })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Reports", exact: true })).toHaveCount(0);
  });

  test("modules that are not enabled are hidden from the sidebar", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await installSession(page, "owner", ["PURCHASES", "INVENTORY"]);
    await page.goto("/app/dashboard");
    const nav = page.getByRole("navigation", { name: "Workspace navigation" });
    await expect(nav.getByRole("link", { name: "Purchases", exact: true })).toBeVisible();
    for (const label of ["Menu Costing", "Square", "Daily Close"]) {
      await expect(nav.getByRole("link", { name: label, exact: true })).toHaveCount(0);
    }
  });

  for (const role of ["owner", "manager"] as const) {
    test(`phone drawer: Reports is ${role === "owner" ? "shown" : "hidden"} for ${role} and the page does not overflow`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await installSession(page, role, ALL_MODULES);
      await page.goto("/app/dashboard");
      await page.getByRole("button", { name: "Open navigation" }).click();
      const nav = page.getByRole("navigation", { name: "Workspace navigation" });
      await expect(nav.getByRole("link", { name: "Purchases", exact: true })).toBeVisible();
      await expect(nav.getByRole("link", { name: "Reports", exact: true })).toHaveCount(role === "owner" ? 1 : 0);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(0);
      await nav.getByRole("link", { name: "Purchases", exact: true }).click();
      await expect(page).toHaveURL(/\/app\/purchases/);
      await expect(page.getByRole("button", { name: "Close navigation" })).toHaveCount(0);
    });
  }
});
