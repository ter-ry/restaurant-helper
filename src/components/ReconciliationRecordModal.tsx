import { Badge } from "./Badge";
import { Button } from "./Button";
import { Card } from "./Card";
import type { MouseEvent } from "react";
import type { PilotReconciliationRecord } from "../types";
import { buildReconciliationSaveConfirmation, summarizeReconciliationDraft } from "../lib/reconciliationWorkflow";
import { formatCurrency, formatDate, formatDateTime } from "../utils/format";

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <span className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</span>
      <span className="min-w-0 break-words text-sm text-ink sm:max-w-56 sm:text-right">{value}</span>
    </div>
  );
}

export function ReconciliationRecordModal({
  open,
  record,
  onClose,
  onEdit,
  onDelete,
}: {
  open: boolean;
  record: PilotReconciliationRecord | null;
  onClose: () => void;
  onEdit: (record: PilotReconciliationRecord) => void;
  onDelete: (record: PilotReconciliationRecord) => void;
}) {
  if (!open || !record) {
    return null;
  }

  const summary = summarizeReconciliationDraft(record);
  const closeOnBackdrop = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) {
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/55 p-0 sm:p-4" onMouseDown={closeOnBackdrop} role="dialog" aria-modal="true">
      <div className="mx-auto flex h-full w-full max-w-5xl flex-col overflow-hidden bg-slate-50 shadow-2xl sm:max-h-[92vh] sm:rounded-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-line bg-white p-4 sm:p-5">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-wide text-muted">Saved reconciliation</p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-bold text-ink sm:text-xl">{formatDate(record.date)}</h2>
              <Badge tone={record.origin === "seed" ? "info" : "success"}>{record.origin === "seed" ? "Sample" : "Saved"}</Badge>
              <Badge tone={record.status === "Balanced" ? "success" : record.status === "Small difference" ? "warning" : "danger"}>{record.status}</Badge>
            </div>
            <p className="mt-1 text-sm leading-6 text-muted">{summary.explanation}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" onClick={() => onEdit(record)}>
              Edit
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                if (window.confirm(`Delete the ${record.date} reconciliation? This cannot be undone.`)) {
                  onDelete(record);
                }
              }}
            >
              Delete
            </Button>
            <Button type="button" variant="ghost" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="space-y-6 p-4 sm:p-5">
            <Card className="surface-panel p-5">
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="space-y-3">
                  <SummaryRow label="Business date" value={formatDate(record.date)} />
                  <SummaryRow label="Expected POS" value={formatCurrency(record.expectedPosSales)} />
                  <SummaryRow label="Accounted total" value={formatCurrency(summary.accountedTotal)} />
                  <SummaryRow label="Difference" value={formatCurrency(summary.variance)} />
                </div>
                <div className="space-y-3">
                  <SummaryRow label="Saved status" value={record.status} />
                  <SummaryRow label="Saved at" value={formatDateTime(record.savedAt || record.updatedAt || record.createdAt)} />
                  <SummaryRow label="Updated at" value={formatDateTime(record.updatedAt)} />
                  <SummaryRow label="Origin" value={record.origin === "seed" ? "Sample record" : "User-created record"} />
                </div>
              </div>
            </Card>

            <Card className="p-5">
              <div className="mb-4">
                <h3 className="text-lg font-bold text-ink">Breakdown</h3>
                <p className="mt-1 text-sm text-muted">{buildReconciliationSaveConfirmation(record)}</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {summary.breakdown.map((item) => (
                  <div key={item.label} className="rounded-lg border border-line bg-slate-50 p-3">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-muted">{item.label}</p>
                    <p className="mt-1 text-sm font-semibold text-ink">{formatCurrency(item.value)}</p>
                  </div>
                ))}
              </div>
            </Card>

            <Card className="p-5">
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="space-y-3">
                  <SummaryRow label="Notes" value={record.notes || "None"} />
                  <SummaryRow label="Other source" value={record.otherSourceName || "Not entered"} />
                  <SummaryRow label="Refunds" value={formatCurrency(record.refunds)} />
                  <SummaryRow label="Discounts" value={formatCurrency(record.discounts)} />
                </div>
                <div className="space-y-3">
                  <SummaryRow label="Tips" value={formatCurrency(record.tips)} />
                  <SummaryRow label="Fees" value={formatCurrency(record.fees)} />
                  <SummaryRow label="Manual adjustment" value={formatCurrency(record.manualAdjustment)} />
                  <SummaryRow label="Review note" value={summary.requiresNote ? "A note is recommended for this variance" : "No special note required"} />
                </div>
              </div>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
