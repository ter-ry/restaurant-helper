import { expect, test } from "@playwright/test";

test.describe("dark landing card contrast", () => {
  test("keeps informational cards dark with readable text on desktop", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/", { waitUntil: "networkidle" });

    const cards = page.locator(".landing-card");
    await expect(cards).toHaveCount(13);
    const styles = await cards.evaluateAll((elements) => elements.map((element) => {
      const style = getComputedStyle(element);
      const heading = element.querySelector("h3, .text-sm.font-bold, .text-xl.font-bold") as HTMLElement | null;
      const body = element.querySelector("p.text-slate-500, p.text-slate-600") as HTMLElement | null;
      return {
        background: style.backgroundColor,
        heading: heading ? getComputedStyle(heading).color : style.color,
        body: body ? getComputedStyle(body).color : style.color,
      };
    }));

    for (const style of styles) {
      expect(style.background).not.toBe("rgb(255, 255, 255)");
      expect(style.heading).not.toBe("rgb(255, 255, 255)");
      expect(style.body).not.toBe("rgb(255, 255, 255)");
    }
  });

  test("keeps the same card treatment on mobile and preserves navigation", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/", { waitUntil: "networkidle" });
    await expect(page.locator(".landing-card").first()).toBeVisible();
    await expect(page.locator("#primary-navigation")).toBeHidden();
    await page.getByRole("button", { name: "Open navigation" }).click();
    await expect(page.locator("#primary-navigation")).toBeVisible();
    const backgrounds = await page.locator(".landing-card").evaluateAll((elements) => elements.map((element) => getComputedStyle(element).backgroundColor));
    expect(backgrounds.every((background) => background !== "rgb(255, 255, 255)")).toBe(true);
  });
});
