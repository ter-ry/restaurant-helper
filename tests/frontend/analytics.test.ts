import { describe, expect, it, vi } from "vitest";
import { initAnalytics, shouldEnableAnalytics, trackEvent, trackPageView } from "../../src/lib/analytics";

describe("analytics gating", () => {
  it("only enables analytics on the approved production hostnames", () => {
    expect(shouldEnableAnalytics("flowtally.ca", true, "G-TEST")).toBe(true);
    expect(shouldEnableAnalytics("www.flowtally.ca", true, "G-TEST")).toBe(true);
    expect(shouldEnableAnalytics("localhost", true, "G-TEST")).toBe(false);
    expect(shouldEnableAnalytics("127.0.0.1", true, "G-TEST")).toBe(false);
    expect(shouldEnableAnalytics("flowtally.ca", false, "G-TEST")).toBe(false);
  });

  it("stays inert during local test execution", () => {
    const appendSpy = vi.spyOn(document.head, "appendChild");
    const gtagSpy = vi.fn();
    const originalGtag = window.gtag;
    window.gtag = gtagSpy;

    try {
      initAnalytics();
      trackPageView("/auth/google/complete");
      trackEvent("cta_view_demo_click");

      expect(appendSpy).not.toHaveBeenCalled();
      expect(gtagSpy).not.toHaveBeenCalled();
      expect(document.querySelector('script[src*="googletagmanager.com"]')).toBeNull();
    } finally {
      window.gtag = originalGtag;
    }
  });
});
