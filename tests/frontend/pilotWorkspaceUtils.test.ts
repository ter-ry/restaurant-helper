import { describe, expect, it } from "vitest";
import { formatConversionFactor, formatDate, formatInventoryQuantity } from "../../src/pilot/workspace/pilotWorkspaceUtils";

describe("formatInventoryQuantity", () => {
  it("keeps up to two meaningful decimals without trailing zeroes", () => {
    expect(formatInventoryQuantity(12)).toBe("12");
    expect(formatInventoryQuantity(0.4)).toBe("0.4");
    expect(formatInventoryQuantity(1.25)).toBe("1.25");
    expect(formatInventoryQuantity(1.256)).toBe("1.26");
    expect(formatInventoryQuantity(null)).toBe("—");
  });
});

describe("formatConversionFactor", () => {
  it.each([[1, "1"], [0.25, "0.25"], [0.125, "0.125"], [0.01, "0.01"], [5, "5"], [12, "12"]])("preserves useful conversion precision for %s", (value, expected) => {
    expect(formatConversionFactor(value)).toBe(expected);
  });
  it("uses an em dash for missing factors", () => {
    expect(formatConversionFactor(null)).toBe("—");
  });
});

describe("formatDate", () => {
  it("preserves date-only business dates regardless of browser timezone", () => {
    expect(formatDate("2026-10-04")).toBe("Oct 4");
  });
});
