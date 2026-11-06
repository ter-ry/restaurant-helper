import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchPilotInventoryItem, reversePilotInventoryAdjustment } from "../../src/pilot/pilotApi";
import { clearPilotDataCache, setPilotCacheScope } from "../../src/pilot/pilotDataCache";

// Uses the real pilotApi + cache layer; only the network is faked (#231 review: stale cache after a 409).
describe("reversePilotInventoryAdjustment cache handling", () => {
  let itemReads: number;
  let history: string;

  beforeEach(() => {
    clearPilotDataCache();
    setPilotCacheScope("42:7");
    itemReads = 0;
    history = "not reversed";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
        if (url.includes("/api/auth/csrf")) return json({ csrfToken: "t" });
        if (url.includes("/reverse") && init?.method === "POST") {
          history = "reversed by another session";
          return json({ error: "This adjustment has already been reversed." }, 409);
        }
        if (url.includes("/api/pilot/inventory/items/30")) {
          itemReads += 1;
          return json({ item: {}, purchaseHistory: [], movementHistory: [{ note: history }], supplierMappings: [] });
        }
        return json({}, 404);
      }),
    );
  });

  it("drops stale cached history when the reversal is rejected so the next read hits the server", async () => {
    const first = await fetchPilotInventoryItem(30);
    expect(JSON.stringify(first)).toContain("not reversed");
    // Without invalidation this second read would be served from the cache.
    await expect(reversePilotInventoryAdjustment(5, { reason: "typo", idempotencyKey: "k" })).rejects.toThrow("already been reversed");

    const reloaded = await fetchPilotInventoryItem(30);

    expect(itemReads).toBe(2);
    expect(JSON.stringify(reloaded)).toContain("reversed by another session");
  });
});
