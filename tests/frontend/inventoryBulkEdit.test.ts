import { describe, expect, it } from "vitest";
import {
  BULK_EDIT_MAX_ITEMS,
  buildBulkChanges,
  buildExpected,
  emptyBulkForm,
  filterItems,
  pruneSelection,
  selectAll,
} from "../../src/lib/inventoryBulkEdit";
import type { PilotInventoryItem } from "../../src/pilot/pilotApi";

const item = (id: number, over: Partial<PilotInventoryItem> = {}) =>
  ({ id, name: `Item ${id}`, category: "Dry", minQuantity: 1, parLevel: 4, supplierId: null, preferredSupplierName: "", active: true, stockUnit: "kg", ...over }) as PilotInventoryItem;

describe("buildBulkChanges", () => {
  it("requires at least one field", () => {
    expect(buildBulkChanges(emptyBulkForm()).errors.form).toMatch(/at least one/i);
  });
  it("validates numbers and PAR >= threshold", () => {
    const form = { ...emptyBulkForm(), changeMin: true, minQuantity: "5", changePar: true, parLevel: "2" };
    expect(buildBulkChanges(form).errors.parLevel).toMatch(/below/i);
    expect(buildBulkChanges({ ...form, parLevel: "abc" }).errors.parLevel).toBeTruthy();
    expect(buildBulkChanges({ ...form, parLevel: "-1" }).errors.parLevel).toBeTruthy();
    expect(buildBulkChanges({ ...form, minQuantity: "" }).errors.minQuantity).toBeTruthy();
    expect(buildBulkChanges({ ...form, parLevel: "9.5" })).toEqual({ changes: { minQuantity: 5, parLevel: 9.5 }, errors: {} });
  });
  it("maps supplier choice and clear", () => {
    expect(buildBulkChanges({ ...emptyBulkForm(), changeSupplier: true, supplierId: "7" }).changes).toEqual({ supplierId: 7 });
    expect(buildBulkChanges({ ...emptyBulkForm(), changeSupplier: true, supplierId: "" }).changes).toEqual({ supplierId: null });
    expect(buildBulkChanges({ ...emptyBulkForm(), changeActive: true, active: false }).changes).toEqual({ active: false });
  });
});

describe("selection helpers", () => {
  it("sends the reviewed values only for changed fields", () => {
    const items = [item(1, { parLevel: 6 }), item(2)];
    expect(buildExpected(items, [1, 2, 99], { parLevel: 9 })).toEqual({ "1": { parLevel: 6 }, "2": { parLevel: 4 } });
  });
  it("filters by search and active state", () => {
    const items = [item(1, { name: "Flour" }), item(2, { name: "Milk", active: false, preferredSupplierName: "Dairy Co" })];
    expect(filterItems(items, "dairy", "all").map((i) => i.id)).toEqual([2]);
    expect(filterItems(items, "", "active").map((i) => i.id)).toEqual([1]);
    expect(filterItems(items, "", "all", "none").length).toBe(2);
  });
  it("caps select-all and prunes vanished ids", () => {
    const many = Array.from({ length: BULK_EDIT_MAX_ITEMS + 5 }, (_, i) => item(i + 1));
    const { selection, truncated } = selectAll(many, new Set());
    expect(selection.size).toBe(BULK_EDIT_MAX_ITEMS);
    expect(truncated).toBe(true);
    expect([...pruneSelection(new Set([1, 999]), many)]).toEqual([1]);
  });
});
