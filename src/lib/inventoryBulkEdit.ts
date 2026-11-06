/** Pure helpers for the inventory bulk-edit workflow (#234). No network, no React. */
import type { PilotInventoryItem } from "../pilot/pilotApi";

export const BULK_EDIT_MAX_ITEMS = 200;
export const BULK_EDIT_MAX_QUANTITY = 9999999.9999;

export type BulkField = "minQuantity" | "parLevel" | "supplierId" | "active";

export interface BulkFormState {
  changeMin: boolean;
  minQuantity: string;
  changePar: boolean;
  parLevel: string;
  changeSupplier: boolean;
  /** "" means "no supplier" (clear); otherwise a supplier id. */
  supplierId: string;
  changeActive: boolean;
  active: boolean;
}

export const emptyBulkForm = (): BulkFormState => ({
  changeMin: false,
  minQuantity: "",
  changePar: false,
  parLevel: "",
  changeSupplier: false,
  supplierId: "",
  changeActive: false,
  active: true,
});

export type BulkChanges = Partial<{ minQuantity: number; parLevel: number; supplierId: number | null; active: boolean }>;

function parseQuantity(text: string, label: string): { value?: number; error?: string } {
  const trimmed = text.trim();
  if (!trimmed) return { error: `Enter ${label}.` };
  if (!/^\d+(\.\d{1,4})?$/.test(trimmed)) return { error: `${label[0].toUpperCase()}${label.slice(1)} must be a number of 0 or more with up to 4 decimals.` };
  const value = Number(trimmed);
  if (value > BULK_EDIT_MAX_QUANTITY) return { error: `${label[0].toUpperCase()}${label.slice(1)} is too large.` };
  return { value };
}

/** Client-side validation mirrors the server; the server remains authoritative. */
export function buildBulkChanges(form: BulkFormState): { changes: BulkChanges; errors: Partial<Record<BulkField | "form", string>> } {
  const changes: BulkChanges = {};
  const errors: Partial<Record<BulkField | "form", string>> = {};
  if (form.changeMin) {
    const parsed = parseQuantity(form.minQuantity, "a reorder threshold");
    if (parsed.error) errors.minQuantity = parsed.error;
    else changes.minQuantity = parsed.value;
  }
  if (form.changePar) {
    const parsed = parseQuantity(form.parLevel, "a PAR level");
    if (parsed.error) errors.parLevel = parsed.error;
    else changes.parLevel = parsed.value;
  }
  if (form.changeSupplier) changes.supplierId = form.supplierId ? Number(form.supplierId) : null;
  if (form.changeActive) changes.active = form.active;
  if (!form.changeMin && !form.changePar && !form.changeSupplier && !form.changeActive) errors.form = "Choose at least one field to change.";
  if (changes.minQuantity !== undefined && changes.parLevel !== undefined && changes.parLevel < changes.minQuantity) {
    errors.parLevel = "PAR level cannot be below the reorder threshold.";
  }
  return { changes, errors };
}

/** The values the user saw for each changed field, sent back so the server can detect stale edits. */
export function buildExpected(items: PilotInventoryItem[], selectedIds: number[], changes: BulkChanges) {
  const byId = new Map(items.map((item) => [item.id, item]));
  const expected: Record<string, Record<string, number | boolean | string | null>> = {};
  for (const id of selectedIds) {
    const item = byId.get(id);
    if (!item) continue;
    const seen: Record<string, number | boolean | string | null> = {};
    if ("minQuantity" in changes) seen.minQuantity = item.minQuantity;
    if ("parLevel" in changes) seen.parLevel = item.parLevel;
    if ("supplierId" in changes) {
      seen.supplierId = item.supplierId;
      seen.supplierName = item.preferredSupplierName ?? "";
    }
    if ("active" in changes) seen.active = item.active;
    expected[String(id)] = seen;
  }
  return expected;
}

export type ActiveFilter = "all" | "active" | "inactive";

export function filterItems(items: PilotInventoryItem[], search: string, activeFilter: ActiveFilter, supplierFilter = "") {
  const needle = search.trim().toLowerCase();
  return items.filter((item) => {
    if (activeFilter === "active" && !item.active) return false;
    if (activeFilter === "inactive" && item.active) return false;
    if (supplierFilter === "none" && item.supplierId !== null) return false;
    if (supplierFilter && supplierFilter !== "none" && String(item.supplierId) !== supplierFilter) return false;
    if (!needle) return true;
    return `${item.name} ${item.category} ${item.preferredSupplierName}`.toLowerCase().includes(needle);
  });
}

/** Selection is capped; returns the resulting id set and whether the cap truncated it. */
export function selectAll(visible: PilotInventoryItem[], current: Set<number>) {
  const next = new Set(current);
  let truncated = false;
  for (const item of visible) {
    if (next.size >= BULK_EDIT_MAX_ITEMS) {
      truncated = true;
      break;
    }
    next.add(item.id);
  }
  return { selection: next, truncated };
}

/** Drop selected ids that no longer exist in the authoritative list (e.g. after a refresh). */
export function pruneSelection(selection: Set<number>, items: PilotInventoryItem[]) {
  const ids = new Set(items.map((item) => item.id));
  return new Set([...selection].filter((id) => ids.has(id)));
}

export function describeChanges(changes: BulkChanges, supplierName: (id: number | null) => string) {
  const parts: string[] = [];
  if (changes.minQuantity !== undefined) parts.push(`reorder threshold ${changes.minQuantity}`);
  if (changes.parLevel !== undefined) parts.push(`PAR ${changes.parLevel}`);
  if (changes.supplierId !== undefined) parts.push(changes.supplierId === null ? "no preferred supplier" : `supplier ${supplierName(changes.supplierId)}`);
  if (changes.active !== undefined) parts.push(changes.active ? "active" : "inactive");
  return parts;
}
