import { useRef, useState, type MouseEvent } from "react";
import { purchaseStatus } from "./purchaseStatus";
import { Badge } from "../../components/Badge";
import { Button } from "../../components/Button";
import { Card } from "../../components/Card";
import { PilotApiError, type PilotPurchaseInvoice } from "../pilotApi";
import { formatDate, formatDateTime, formatMoney, formatNumber } from "../workspace/pilotWorkspaceUtils";

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <span className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</span>
      <span className="min-w-0 break-words text-sm text-ink sm:max-w-56 sm:text-right">{value}</span>
    </div>
  );
}

function VoidInvoicePanel({
  invoice,
  onVoid,
  onOpenInvoice,
}: {
  invoice: PilotPurchaseInvoice;
  onVoid: (invoice: PilotPurchaseInvoice, request: { reason: string; createCorrectionDraft: boolean; idempotencyKey: string }) => Promise<void>;
  onOpenInvoice: (invoiceId: number) => void;
}) {
  const [reason, setReason] = useState("");
  const [createCorrectionDraft, setCreateCorrectionDraft] = useState(true);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  // One key per void decision: retrying after a lost response replays the same void instead of repeating it.
  const keyRef = useRef<string | null>(null);

  if (invoice.status === "Corrected") {
    return (
      <Card className="p-5">
        <p className="text-sm font-semibold text-ink">This invoice was voided</p>
        <p className="mt-1 text-sm text-muted">
          Its inventory movements were reversed with linked opposite movements; the original receipt stays in the history.
          {invoice.voidReason ? ` Reason: ${invoice.voidReason}` : ""}
        </p>
        {invoice.correctedByInvoiceId ? (
          <Button className="mt-3" variant="secondary" type="button" onClick={() => onOpenInvoice(invoice.correctedByInvoiceId as number)}>
            Open corrected copy
          </Button>
        ) : null}
      </Card>
    );
  }
  if (invoice.status !== "Completed") {
    return null;
  }

  const confirmVoid = async () => {
    if (busy) {
      return;
    }
    setBusy(true);
    setFailure(null);
    keyRef.current ??= `void-${invoice.id}-${typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Date.now())}`;
    try {
      await onVoid(invoice, { reason: reason.trim(), createCorrectionDraft, idempotencyKey: keyRef.current });
      keyRef.current = null;
    } catch (err) {
      if (err instanceof PilotApiError && err.status >= 400 && err.status < 500) {
        // A definite refusal (for example stock already used): the next attempt is a new decision.
        keyRef.current = null;
        const detail = Object.values(err.errors ?? {}).join(" ");
        setFailure(detail ? `${err.message} ${detail}` : err.message);
      } else {
        // Unknown outcome (network or server error): keep the key so confirming again cannot void twice.
        setFailure(`${err instanceof Error ? err.message : "Could not void the invoice."} Check the purchase list before trying again.`);
      }
      setConfirmOpen(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="border border-amber-200 bg-amber-50 p-5">
      <p className="text-sm font-semibold text-ink">Need to void or correct this receipt?</p>
      <p className="mt-1 text-sm text-muted">
        Flowtally keeps the original and adds opposite stock movements. This only works while the stock you received is still on hand; if it was already used, you will see what changed.
      </p>
      <textarea
        className="input mt-3"
        rows={3}
        value={reason}
        disabled={busy}
        onChange={(event) => setReason(event.target.value)}
        placeholder="Why is this receipt being voided?"
        aria-label="Void reason"
      />
      <label className="mt-3 flex items-start gap-2 text-sm text-ink">
        <input type="checkbox" className="mt-1" checked={createCorrectionDraft} disabled={busy} onChange={(event) => setCreateCorrectionDraft(event.target.checked)} />
        <span>Create a corrected draft copy to review and receive again</span>
      </label>
      {failure ? <p className="mt-3 text-sm font-medium text-red-700" role="alert">{failure}</p> : null}
      {confirmOpen ? (
        <div className="mt-3 rounded-xl border border-amber-300 bg-white p-3 text-sm" role="alertdialog" aria-label="Confirm void">
          <p className="font-semibold text-ink">Void invoice {invoice.invoiceNumber}?</p>
          <p className="mt-1 text-muted">The stock from this receipt is taken back out of inventory. A corrected copy can be received afterwards.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button disabled={busy} type="button" onClick={() => void confirmVoid()}>
              {busy ? "Voiding..." : "Yes, void this invoice"}
            </Button>
            <Button disabled={busy} variant="secondary" type="button" onClick={() => setConfirmOpen(false)}>
              Keep invoice
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-3">
          <Button disabled={busy || !reason.trim()} variant="secondary" type="button" onClick={() => setConfirmOpen(true)}>
            Void receipt
          </Button>
        </div>
      )}
    </Card>
  );
}

export function PurchaseInvoiceDetailsModal({
  invoice,
  refreshFailure,
  refreshing,
  onRefresh,
  onClose,
  onVoid,
  onOpenInvoice,
  inline = false,
}: {
  inline?: boolean;
  invoice: PilotPurchaseInvoice | null;
  refreshFailure: string | null;
  refreshing: boolean;
  onRefresh: () => void;
  onClose: () => void;
  onVoid: (invoice: PilotPurchaseInvoice, request: { reason: string; createCorrectionDraft: boolean; idempotencyKey: string }) => Promise<void>;
  onOpenInvoice: (invoiceId: number) => void;
}) {
  if (!invoice) {
    return null;
  }

  const closeOnBackdrop = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) {
      onClose();
    }
  };
  const { label: receivedLabel, tone: statusToneOverride } = purchaseStatus(invoice);
  // One root element either way, so the void form below keeps its state when the layout switches.
  const rootProps = inline
    ? { role: "region", "aria-label": "Purchase detail" }
    : { className: "fixed inset-0 z-50 bg-slate-950/55 p-0 sm:p-4", onMouseDown: closeOnBackdrop, role: "dialog", "aria-modal": true };

  return (
    <div {...rootProps} data-testid="purchase-detail-modal">
      <div className={inline ? "flex w-full flex-col overflow-hidden rounded-2xl border border-line bg-slate-50" : "mx-auto flex h-full w-full max-w-6xl flex-col overflow-hidden bg-slate-50 shadow-2xl sm:max-h-[92vh] sm:rounded-2xl"}>
        <div className="flex items-start justify-between gap-4 border-b border-line bg-white p-4 sm:p-5">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-wide text-muted">Purchase history</p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-bold text-ink sm:text-xl">{invoice.supplier?.name || "Unknown supplier"}</h2>
              <Badge tone={statusToneOverride}>{receivedLabel || "Read-only"}</Badge>
              <Badge tone="neutral">Read-only</Badge>
            </div>
            <p className="mt-1 text-sm leading-6 text-muted">This purchase is locked for review. It can be voided below, which reverses its stock movements.</p>
          </div>
          <Button type="button" variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="space-y-6 p-4 sm:p-5">
            <Card className="surface-panel p-5">
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="space-y-3">
                  <SummaryRow label="Supplier" value={invoice.supplier?.name || "Unknown supplier"} />
                  <SummaryRow label="Invoice number" value={invoice.invoiceNumber || "Not saved"} />
                  <SummaryRow label="Invoice date" value={invoice.invoiceDate ? formatDate(invoice.invoiceDate) : "Not saved"} />
                  <SummaryRow label="Status" value={receivedLabel} />
                  <SummaryRow label="Subtotal" value={formatMoney(invoice.subtotal)} />
                  <SummaryRow label="Tax" value={formatMoney(invoice.tax)} />
                  <SummaryRow label="Total" value={formatMoney(invoice.totalAmount)} />
                </div>
                <div className="space-y-3">
                  <SummaryRow label="Received at" value={invoice.receivedAt ? formatDateTime(invoice.receivedAt) : "Not recorded"} />
                  <SummaryRow label="Received by" value={invoice.receivedByUserId ? `User #${invoice.receivedByUserId}` : "Not recorded"} />
                  <SummaryRow label="Posted at" value={invoice.postedAt ? formatDateTime(invoice.postedAt) : "Not posted"} />
                  <SummaryRow label="Saved at" value={formatDateTime(invoice.updatedAt || invoice.createdAt)} />
                  <SummaryRow label="Source file" value={invoice.sourceFileName || "Not available"} />
                  <SummaryRow label="File type" value={invoice.sourceFileType || "Not available"} />
                </div>
              </div>
            </Card>

            {refreshFailure ? (
              <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                <span>{refreshFailure}</span>
                <Button variant="secondary" type="button" disabled={refreshing} onClick={onRefresh}>{refreshing ? "Refreshing…" : "Refresh purchase status"}</Button>
              </div>
            ) : null}

            <VoidInvoicePanel key={`${invoice.id}-${invoice.status}`} invoice={invoice} onVoid={onVoid} onOpenInvoice={onOpenInvoice} />

            <Card className="p-5">
              <div className="mb-4">
                <h3 className="text-lg font-bold text-ink">Invoice items</h3>
                <p className="mt-1 text-sm text-muted">Line mappings, quantities, and costs are shown as stored on the completed record.</p>
              </div>
              <div className="space-y-3">
                {invoice.lineItems.map((line, index) => (
                  <div key={line.id ?? index} className="rounded-2xl border border-line bg-slate-50 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold text-ink">{line.description || `Line item ${index + 1}`}</p>
                        <p className="mt-1 text-sm text-muted">{line.inventoryItemId ? `Mapped to inventory item #${line.inventoryItemId}` : "Unmapped line"}</p>
                      </div>
                      <Badge tone={line.needsReview ? "warning" : "success"}>{line.needsReview ? "Needs review" : "Confirmed"}</Badge>
                    </div>
                    <div className="mt-3 grid gap-3 md:grid-cols-4">
                      <SummaryRow label="Quantity" value={formatNumber(line.quantity)} />
                      <SummaryRow label="Purchase unit" value={line.purchaseUnit || "each"} />
                      <SummaryRow label="Inventory unit" value={line.inventoryUnit || "each"} />
                      <SummaryRow label="Conversion" value={formatNumber(line.conversionFactor)} />
                      <SummaryRow label="Inventory quantity" value={`${formatNumber(line.normalizedQuantity ?? Number(line.quantity || 0) * Number(line.conversionFactor || 1))} ${line.inventoryUnit || "each"}`} />
                      <SummaryRow label="Unit price" value={formatMoney(line.unitPrice)} />
                      <SummaryRow label="Inventory unit cost" value={formatMoney(line.normalizedUnitCost ?? line.unitPrice)} />
                      <SummaryRow label="Line total" value={formatMoney(line.lineTotal)} />
                      <SummaryRow label="Confidence" value={`${Math.round(line.confidence * 100)}%`} />
                      <SummaryRow label="Note" value={line.note || "None"} />
                    </div>
                  </div>
                ))}
              </div>
            </Card>

            <Card className="p-5">
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="space-y-3">
                  <SummaryRow label="Extraction status" value={invoice.extractionStatus || "manual"} />
                  <SummaryRow label="Source file type" value={invoice.sourceFileType || "Not available"} />
                  <SummaryRow label="Source file name" value={invoice.sourceFileName || "Not available"} />
                </div>
                <div className="space-y-3">
                  <SummaryRow label="Raw OCR text" value={invoice.extractedText ? `${invoice.extractedText.slice(0, 120)}${invoice.extractedText.length > 120 ? "..." : ""}` : "Not stored"} />
                  <SummaryRow label="Notes" value={invoice.notes || "None"} />
                </div>
              </div>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
