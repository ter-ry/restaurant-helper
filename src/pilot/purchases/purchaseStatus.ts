import type { PilotPurchaseInvoice } from "../pilotApi";

export type PurchaseStatusTone = "success" | "warning" | "danger" | "neutral";

/** One vocabulary for a purchase everywhere it is shown (queue, editor header, detail panel). */
export function purchaseStatus(
  invoice: Pick<PilotPurchaseInvoice, "status"> & { reviewSummary?: { state?: string } | null },
  liveState?: "READY" | "REVIEW" | "BLOCKING",
): { label: string; tone: PurchaseStatusTone } {
  if (invoice.status === "Completed") return { label: "Received", tone: "success" };
  if (invoice.status === "Corrected") return { label: "Voided", tone: "neutral" };
  const state = liveState ?? invoice.reviewSummary?.state;
  if (state === "READY") return { label: "Ready to receive", tone: "success" };
  if (state === "BLOCKING") return { label: "Needs attention", tone: "danger" };
  return { label: invoice.status === "Draft" ? "Draft: needs review" : "Needs review", tone: "warning" };
}

/** The server flags a price change as material from this size (backend/utils.py). */
export const MATERIAL_PRICE_CHANGE_PERCENT = 5;
