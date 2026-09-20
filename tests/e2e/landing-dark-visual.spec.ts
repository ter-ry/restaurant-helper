import { expect, test } from "@playwright/test";

test.describe("dark landing card contrast", () => {
  test("keeps informational cards dark with readable text on desktop", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/", { waitUntil: "networkidle" });

    await expect(page.locator(".landing-showcase")).toBeVisible();
    await expect(page.getByRole("link", { name: "Request access" }).first()).toHaveAttribute("href", /login/);
    await expect(page.getByRole("link", { name: "See how it works" })).toHaveAttribute("href", "#how-it-works");
    await expect(page.getByRole("link", { name: "View Live Demo" })).toHaveAttribute("href", /demo/);
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

  test("reveals sections once and shows everything immediately with reduced motion", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/", { waitUntil: "networkidle" });
    await page.mouse.wheel(0, 4000);
    await page.mouse.wheel(0, -4000);
    await expect(page.locator(".landing-hero")).toHaveClass(/landing-reveal-visible/);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.reload({ waitUntil: "networkidle" });
    const states = await page.locator(".landing-reveal").evaluateAll((elements) => elements.map((element) => getComputedStyle(element).opacity));
    expect(states.every((opacity) => opacity === "1")).toBe(true);
  });

  test("paints the initial reveal state before showing the hero", async ({ page }) => {
    await page.addInitScript(() => {
      const events: Array<{ time: number; tokens: string[]; target: string }> = [];
      (window as typeof window & { __landingRevealEvents?: typeof events }).__landingRevealEvents = events;
      const add = DOMTokenList.prototype.add;
      DOMTokenList.prototype.add = function (...tokens: string[]) {
        if (tokens.includes("landing-reveal-ready") || tokens.includes("landing-reveal-visible")) {
          events.push({ time: performance.now(), tokens, target: this.value });
        }
        return add.apply(this, tokens);
      };
    });
    await page.goto("/", { waitUntil: "networkidle" });

    const timing = await page.evaluate(() => {
      const events = (window as typeof window & { __landingRevealEvents?: Array<{ time: number; tokens: string[]; target: string }> }).__landingRevealEvents ?? [];
      const ready = events.find((event) => event.target.includes("landing-hero") && event.tokens.includes("landing-reveal-ready"));
      const visible = events.find((event) => event.target.includes("landing-hero") && event.tokens.includes("landing-reveal-visible"));
      const style = getComputedStyle(document.querySelector(".landing-hero") as HTMLElement);
      return { gap: ready && visible ? visible.time - ready.time : 0, transition: style.transition };
    });

    expect(timing.gap).toBeGreaterThan(0);
    expect(timing.transition).toContain("0.56s");
  });
});
