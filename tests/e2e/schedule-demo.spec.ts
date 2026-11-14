import { expect, test, type Page } from "@playwright/test";

const ROUTE = "/demo/cafe/schedule";

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

for (const viewport of [
  { name: "390px", width: 390, height: 844 },
  { name: "768px", width: 768, height: 1024 },
]) {
  test(`schedule demo availability, conflicts and overnight windows at ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto(ROUTE);

    await expect(page.getByRole("heading", { name: "Schedule", exact: true }).first()).toBeVisible();
    // Seed data: Sofia (weekend-only) is rostered on Thu Close, so one conflict and one open shift (Sun Close) at start.
    await expect(page.getByText("1 conflict", { exact: true })).toBeVisible();
    await expect(page.getByText("Thu Close: outside availability")).toBeVisible();
    await expect(page.getByText("1 open shift", { exact: true })).toBeVisible();
    await expect(page.getByText("Demo preview only")).toBeVisible();
    await expectNoHorizontalOverflow(page);

    // Unsupported capabilities are disabled and honestly labelled; no payroll claims.
    await expect(page.getByRole("button", { name: /Auto-generate week \(not in demo\)/ })).toBeDisabled();
    await expect(page.getByRole("button", { name: /Export \/ share \(not in demo\)/ })).toBeDisabled();
    await expect(page.getByText("Payroll stays out of scope")).toBeVisible();
    await expect(page.getByText("Generated weekly schedule")).toHaveCount(0);

    // Preview a genuine availability conflict (Noah is only available Tue-Thu), then cancel: nothing changes.
    const monOpen = page.getByLabel("Mon Open assignment");
    await monOpen.selectOption({ label: "Noah Kim" });
    await expect(page.getByText("Assign Noah Kim to Mon Open?")).toBeVisible();
    await expect(page.getByText(/Noah Kim is outside stated availability for Mon Open/)).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByText("1 conflict", { exact: true })).toBeVisible();
    await expect(monOpen).toHaveValue("maya");

    // Confirm anyway: the conflict is counted and listed.
    await monOpen.selectOption({ label: "Noah Kim" });
    await page.getByRole("button", { name: "Assign anyway" }).click();
    await expect(page.getByText("2 conflicts", { exact: true })).toBeVisible();
    await expect(page.getByText("Mon Open: outside availability")).toBeVisible();
    await expect(page.getByText("Needs review", { exact: true })).toBeVisible();
    await expectNoHorizontalOverflow(page);

    // Fixing availability clears the conflict (Mon 6:00-20:00).
    await page.getByRole("button", { name: "Edit Noah's availability" }).click();
    const noah = page.getByRole("group", { name: "Noah Kim availability" });
    await noah.getByRole("button", { name: "Mon", exact: true }).click();
    await noah.getByLabel("From").selectOption({ label: "6:00" });
    await expect(page.getByText("1 conflict", { exact: true })).toBeVisible();
    await expect(page.getByText("Mon Open: outside availability")).toHaveCount(0);

    // Overnight window: Sofia 22:00-2:00 does not cover her Sat 11:00-15:00 shift.
    await page.getByRole("button", { name: "Edit Sofia's availability" }).click();
    const sofia = page.getByRole("group", { name: "Sofia Gomez availability" });
    await sofia.getByLabel("From").selectOption({ label: "22:00" });
    await sofia.getByLabel("To").selectOption({ label: "2:00" });
    await expect(page.getByText("Sat/Sun 22:00-2:00", { exact: true })).toBeVisible();
    await expect(page.getByText("Sat Mid: outside availability")).toBeVisible();
    await expect(page.getByText("Sun Mid: outside availability")).toBeVisible();
    await expect(page.getByText("3 conflicts", { exact: true })).toBeVisible();
    await expectNoHorizontalOverflow(page);

    // Demo state is browser-only and honestly not persisted.
    await page.reload();
    await expect(page.getByText("1 conflict", { exact: true })).toBeVisible();
    await expect(page.getByText("Sat/Sun 10:00-18:00", { exact: true })).toBeVisible();
  });
}
