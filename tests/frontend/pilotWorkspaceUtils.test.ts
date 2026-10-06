import { describe, expect, it } from "vitest";
import { formatInventoryQuantity } from "../../src/pilot/workspace/pilotWorkspaceUtils";

describe("formatInventoryQuantity", () => {
  it("keeps up to two meaningful decimals without trailing zeroes", () => {
    expect(formatInventoryQuantity(12)).toBe("12");
    expect(formatInventoryQuantity(0.4)).toBe("0.4");
    expect(formatInventoryQuantity(1.25)).toBe("1.25");
    expect(formatInventoryQuantity(1.256)).toBe("1.26");
    expect(formatInventoryQuantity(null)).toBe("—");
  });
});
