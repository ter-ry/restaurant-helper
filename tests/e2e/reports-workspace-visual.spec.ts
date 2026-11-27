import { expect, test } from "@playwright/test";

declare const process: { env: Record<string, string | undefined> };

if (process.env.PLAYWRIGHT_EXECUTABLE_PATH) {
  test.use({ launchOptions: { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } });
}

for (const viewport of [
  { name: "desktop", width: 1280, height: 900 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "mobile", width: 390, height: 844 },
]) {
  test(`renders trend bars and gaps at ${viewport.name} width`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto("/tests/e2e/reports-workspace-fixture.html", { waitUntil: "networkidle" });

    await expect(page.getByTestId("reports-workspace")).toBeVisible();
    await expect(page.getByTestId("trend-bar-sales-trend-Mon")).toBeVisible();
    const geometry = await page.evaluate(() => {
      const bar = (label: string) => {
        const element = document.querySelector(`[data-testid="trend-bar-sales-trend-${label}"]`) as HTMLElement | null;
        if (!element) return null;
        const rect = element.getBoundingClientRect();
        return { rectHeight: rect.height, computedHeight: getComputedStyle(element).height };
      };
      return { positive: bar("Mon"), unavailable: bar("Tue"), zero: bar("Wed"), large: bar("Thu"), overflow: document.documentElement.scrollWidth - window.innerWidth };
    });

    expect(geometry.positive?.rectHeight).toBeGreaterThan(0);
    expect(geometry.large?.rectHeight).toBeGreaterThan(geometry.positive?.rectHeight ?? 0);
    expect(geometry.unavailable?.rectHeight).toBe(0);
    expect(geometry.zero?.rectHeight).toBe(0);
    expect(geometry.overflow).toBeLessThanOrEqual(1);
    const screenshot = await page.screenshot({ animations: "disabled", fullPage: true });
    expect(screenshot.byteLength).toBeGreaterThan(1000);
  });
}
