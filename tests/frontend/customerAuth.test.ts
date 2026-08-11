import { afterEach, describe, expect, it, vi } from "vitest";
import { getGoogleLoginStartUrl } from "../../src/lib/customerAuth";
import { getSquareConnectionStartUrl } from "../../src/lib/squareIntegration";

describe("customer auth launchers", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("builds the Google login URL from the configured API origin", () => {
    vi.stubEnv("VITE_FLOWTALLY_API_BASE_URL", "https://api-staging.flowtally.ca");
    expect(getGoogleLoginStartUrl()).toBe("https://api-staging.flowtally.ca/api/auth/google/start?purpose=login");
  });

  it("builds the Square connection URL from the configured API origin", () => {
    vi.stubEnv("VITE_FLOWTALLY_API_BASE_URL", "https://api-staging.flowtally.ca");
    expect(getSquareConnectionStartUrl(42)).toBe("https://api-staging.flowtally.ca/api/integrations/square/start?organizationId=42");
  });
});
