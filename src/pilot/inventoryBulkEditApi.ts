import type { BulkChanges } from "../lib/inventoryBulkEdit";
import { PilotApiError, requestCsrfJson, type PilotInventoryItem } from "./pilotApi";

export interface BulkEditReviewItem {
  id: number;
  name: string;
  status: "changed" | "unchanged";
  changedFields: string[];
  before: Record<string, number | boolean | null>;
  after: Record<string, number | boolean | null>;
}

export interface BulkEditResponse {
  applied: boolean;
  batchId: string | null;
  summary: { selected: number; changed: number; unchanged: number };
  items: BulkEditReviewItem[];
  refreshedItems?: PilotInventoryItem[];
}

export interface BulkEditRequest {
  itemIds: number[];
  changes: BulkChanges;
  expected: Record<string, Record<string, number | boolean | null>>;
  dryRun?: boolean;
}

/** `PilotApiError.errors` keys of the form `item-<id>` carry per-item rejections. */
export function itemErrorsFrom(error: unknown): Array<{ itemId: number; message: string }> {
  if (!(error instanceof PilotApiError) || !error.errors) return [];
  return Object.entries(error.errors)
    .filter(([key]) => /^item-\d+$/.test(key))
    .map(([key, message]) => ({ itemId: Number(key.slice(5)), message }));
}

export function submitBulkEdit(request: BulkEditRequest) {
  return requestCsrfJson<BulkEditResponse>("/api/pilot/inventory/bulk-edit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
}
