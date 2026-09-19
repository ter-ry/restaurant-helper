import { describe, expect, it, vi } from "vitest";
import { clearPilotDataCache, getPilotCached, setPilotCacheScope, subscribePilotCache } from "../../src/pilot/pilotDataCache";

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

  it("serves expired data immediately while revalidating in the background", async () => {
    clearPilotDataCache();
    setPilotCacheScope("user-1:org-1:location-1");
    const loader = vi.fn().mockResolvedValueOnce("first").mockResolvedValueOnce("fresh");
    await expect(getPilotCached("/api/pilot/dashboard", loader, 1)).resolves.toBe("first");
    await new Promise((resolve) => setTimeout(resolve, 5));
    await expect(getPilotCached("/api/pilot/dashboard", loader, 1)).resolves.toBe("first");
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("publishes fresh background data to mounted consumers", async () => {
    clearPilotDataCache();
    setPilotCacheScope("user-1:org-1:location-1");
    const loader = vi.fn().mockResolvedValueOnce("first").mockResolvedValueOnce("fresh");
    const updates: string[] = [];
    await getPilotCached("/api/pilot/dashboard", loader, 1);
    const unsubscribe = subscribePilotCache<string>("/api/pilot/dashboard", (value) => updates.push(value));
    await new Promise((resolve) => setTimeout(resolve, 5));
    await expect(getPilotCached("/api/pilot/dashboard", loader, 1)).resolves.toBe("first");
    await vi.waitFor(() => expect(updates).toEqual(["fresh"]));

    unsubscribe();
  });

  it("consumes failed background revalidation without an unhandled rejection", async () => {
    clearPilotDataCache();
    setPilotCacheScope("user-1:org-1:location-1");
    const loader = vi.fn().mockResolvedValueOnce("first").mockRejectedValueOnce(new Error("offline"));

    await getPilotCached("/api/pilot/dashboard", loader, 1);
    await new Promise((resolve) => setTimeout(resolve, 5));
    await expect(getPilotCached("/api/pilot/dashboard", loader, 1)).resolves.toBe("first");
    await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(2));
    // The stale value remains cached; no rejection escapes the background task.
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("does not publish or cache an invalidated in-flight response", async () => {
    clearPilotDataCache();
    setPilotCacheScope("user-1:org-1:location-1");
    let resolveOld!: (value: string) => void;
    const oldLoader = vi.fn(() => new Promise<string>((resolve) => { resolveOld = resolve; }));
    const updates: string[] = [];
    subscribePilotCache<string>("/api/pilot/inventory", (value) => updates.push(value));

    const oldRequest = getPilotCached("/api/pilot/inventory", oldLoader);
    clearPilotDataCache();
    resolveOld("old");
    await oldRequest;

    const freshLoader = vi.fn().mockResolvedValue("fresh");
    await expect(getPilotCached("/api/pilot/inventory", freshLoader)).resolves.toBe("fresh");
    expect(updates).toEqual(["fresh"]);
    expect(freshLoader).toHaveBeenCalledTimes(1);
  });

  it("keeps navigation data usable at one minute and refreshes again after five minutes", async () => {
    vi.useFakeTimers();
    try {
      clearPilotDataCache();
      setPilotCacheScope("user-1:org-1:location-1");
      const loader = vi.fn().mockResolvedValueOnce("first").mockResolvedValueOnce("after-minute").mockResolvedValueOnce("after-five-minutes");
      await expect(getPilotCached("/api/pilot/square", loader)).resolves.toBe("first");

      vi.advanceTimersByTime(60_001);
      await expect(getPilotCached("/api/pilot/square", loader)).resolves.toBe("first");
      await Promise.resolve();
      expect(loader).toHaveBeenCalledTimes(2);

      vi.advanceTimersByTime(5 * 60_000 + 13_000);
      await expect(getPilotCached("/api/pilot/square", loader)).resolves.toBe("after-minute");
      await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(3));
      await expect(getPilotCached("/api/pilot/square", loader)).resolves.toBe("after-five-minutes");
      expect(loader).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });
});
