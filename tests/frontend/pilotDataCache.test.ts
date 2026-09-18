import { describe, expect, it, vi } from "vitest";
import { clearPilotDataCache, getPilotCached, setPilotCacheScope } from "../../src/pilot/pilotDataCache";

describe("pilot data cache", () => {
  it("deduplicates in-flight reads and isolates organization scopes", async () => {
    clearPilotDataCache();
    setPilotCacheScope("user-1:org-1:location-1");
    const loader = vi.fn(async () => ({ items: [1] }));
    const [first, second] = await Promise.all([
      getPilotCached("/api/pilot/inventory", loader),
      getPilotCached("/api/pilot/inventory", loader),
    ]);
    expect(first).toEqual(second);
    expect(loader).toHaveBeenCalledTimes(1);

    setPilotCacheScope("user-1:org-2:location-9");
    await getPilotCached("/api/pilot/inventory", loader);
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("clears cached reads after invalidation", async () => {
    clearPilotDataCache();
    setPilotCacheScope("user-1:org-1:location-1");
    const loader = vi.fn(async () => Date.now());
    await getPilotCached("/api/pilot/dashboard", loader);
    clearPilotDataCache();
    await getPilotCached("/api/pilot/dashboard", loader);
    expect(loader).toHaveBeenCalledTimes(2);
  });
});
