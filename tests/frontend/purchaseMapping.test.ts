import { describe, expect, it } from "vitest";
import { lineBlockers, suggestInventoryItem } from "../../src/pilot/purchaseMapping";

const items = [
  { id: 1, name: "Whole Milk" },
  { id: 2, name: "Chicken Breast" },
  { id: 3, name: "Oat Milk" },
  { id: 4, name: "All-Purpose Flour" },
];

describe("suggestInventoryItem", () => {
  it("suggests when every word of an inventory name is on the invoice line", () => {
    expect(suggestInventoryItem("Chicken Breast 1kg", items)?.id).toBe(2);
    expect(suggestInventoryItem("Flour all purpose 10kg bag", items)?.id).toBe(4);
  });
  it("does not guess when nothing matches or the match is ambiguous", () => {
    expect(suggestInventoryItem("Paper napkins", items)).toBeNull();
    expect(suggestInventoryItem("Milk 2L", items)).toBeNull(); // 'Milk' alone is not a full name here
    expect(suggestInventoryItem("Whole Milk or Oat Milk", items)).toBeNull(); // tie
    expect(suggestInventoryItem("", items)).toBeNull();
  });
});

describe("lineBlockers", () => {
  const ok = { inventoryItemId: 2, quantity: 5, conversionFactor: 1, unitPrice: 9.8, lineTotal: 49 };
  it("is empty for a ready line", () => expect(lineBlockers(ok)).toEqual([]));
  it("reports each unresolved problem", () => {
    expect(lineBlockers({ ...ok, inventoryItemId: null })).toHaveLength(1);
    expect(lineBlockers({ ...ok, quantity: 0, lineTotal: 0 })[0]).toContain("quantity");
    expect(lineBlockers({ ...ok, conversionFactor: 0 })[0]).toContain("conversion");
    expect(lineBlockers({ ...ok, quantity: 1 })[0]).toContain("9.80");
  });
});
