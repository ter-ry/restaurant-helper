import { Trash2 } from "lucide-react";
import { type Dispatch, type SetStateAction } from "react";

import { Badge } from "./Badge";
import { Button } from "./Button";
import { formatLineConfidence, getLineTotalReviewState, updateLineItemDescription } from "../lib/invoiceLineItemView";
import type { PilotInvoiceDraft, PilotInvoiceLineItem } from "../types";

const confidenceThreshold = 0.8;

function confidenceTone(confidence: number, needsReview: boolean) {
  if (needsReview || confidence < confidenceThreshold) {
    return confidence < 0.55 ? "danger" : "warning";
  }
  if (confidence >= 0.95) {
    return "success";
  }
  return "info";
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <span className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</span>
      <span className="min-w-0 break-words text-sm text-ink sm:max-w-56 sm:text-right">{value}</span>
    </div>
  );
}

function FieldEditor({
  label,
  value,
  helper,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string | number;
  helper: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: "text" | "number";
}) {
  return (
    <label className="block min-w-0">
      <span className="text-xs font-bold uppercase tracking-wide text-muted">{label}</span>
      <p className="mt-1 text-xs leading-5 text-muted">{helper}</p>
      <div className="mt-2">
        <input
          className="input w-full min-w-0"
          placeholder={placeholder}
          type={type}
          value={typeof value === "number" ? String(value) : value}
          onChange={(event) => onChange(event.target.value)}
        />
      </div>
    </label>
  );
}

function LineTotalSummary({
  item,
  onChangePrintedTotal,
}: {
  item: PilotInvoiceLineItem;
  onChangePrintedTotal: (value: string) => void;
}) {
  const totalState = getLineTotalReviewState(item);
  const hasMismatch = totalState.mismatch;

  return (
    <div className="mt-4 rounded-xl border border-line bg-slate-50 p-4">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
        <span className="text-xs font-bold uppercase tracking-wide text-muted">Line total</span>
        <span className="text-sm font-semibold text-ink">{totalState.summary}</span>
      </div>
      {hasMismatch ? (
        <p className="mt-2 text-xs leading-5 text-amber-700">{totalState.warning}</p>
      ) : totalState.warning ? (
        <p className="mt-2 text-xs leading-5 text-muted">{totalState.warning}</p>
      ) : null}
      {hasMismatch || !totalState.hasPrintedTotal ? (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <SummaryRow label="Printed total" value={`$${totalState.extractedTotal.toFixed(2)}`} />
          <SummaryRow label="Calculated total" value={`$${totalState.calculatedTotal.toFixed(2)}`} />
        </div>
      ) : null}
      {hasMismatch || !totalState.hasPrintedTotal ? (
        <label className="mt-3 block">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted">Correct printed total</span>
          <input
            className="input mt-2 w-full max-w-sm"
            type="number"
            value={item.lineTotal}
            onChange={(event) => onChangePrintedTotal(event.target.value)}
          />
        </label>
      ) : null}
    </div>
  );
}

export function InvoiceLineItemCard({
  item,
  index,
  setDraft,
  onRemove,
}: {
  item: PilotInvoiceLineItem;
  index: number;
  setDraft: Dispatch<SetStateAction<PilotInvoiceDraft>>;
  onRemove: (index: number) => void;
}) {
  const totalState = getLineTotalReviewState(item);

  return (
    <div className="min-w-0 rounded-xl border border-line bg-white p-4 shadow-soft">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-bold text-ink">Line item {index + 1}</p>
            <Badge tone={confidenceTone(item.confidence, item.needsReview)}>{formatLineConfidence(item.confidence)}</Badge>
            <Badge tone={item.status === "Price Increased" ? "danger" : item.status === "Matched" ? "success" : "warning"}>{item.status}</Badge>
          </div>
          <p className="mt-1 text-xs leading-5 text-muted">The item description is editable. The raw OCR line stays stored separately for traceability.</p>
        </div>
        <Button type="button" variant="ghost" className="w-full sm:w-auto" icon={<Trash2 className="h-4 w-4" />} onClick={() => onRemove(index)}>
          Remove
        </Button>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(7rem,0.45fr)_minmax(7rem,0.45fr)_minmax(0,1fr)]">
        <FieldEditor
          label="Item description"
          value={item.itemName}
          helper="Product or service name shown on the invoice."
          onChange={(value) =>
            setLineItemValue(setDraft, index, (current) => ({
              ...current,
              ...updateLineItemDescription(current, value),
            }))
          }
          placeholder="Enter line description"
        />
        <FieldEditor
          label="Quantity"
          value={item.quantity}
          helper="Units on the invoice."
          onChange={(value) =>
            setLineItemValue(setDraft, index, (current) => ({
              ...current,
              quantity: Number(value) || 0,
            }))
          }
          type="number"
        />
        <FieldEditor
          label="Unit"
          value={item.unit}
          helper="Case, kg, each, L, etc."
          onChange={(value) =>
            setLineItemValue(setDraft, index, (current) => ({
              ...current,
              unit: value,
            }))
          }
          placeholder="each"
        />
        <FieldEditor
          label="Unit price"
          value={item.unitPrice}
          helper="Per-unit amount before tax."
          onChange={(value) =>
            setLineItemValue(setDraft, index, (current) => ({
              ...current,
              unitPrice: Number(value) || 0,
            }))
          }
          type="number"
        />
      </div>

      <LineTotalSummary
        item={item}
        onChangePrintedTotal={(value) =>
          setLineItemValue(setDraft, index, (current) => ({
            ...current,
            lineTotal: Number(value) || 0,
          }))
        }
      />

      <details className="mt-4 rounded-lg border border-dashed border-line bg-slate-50 px-4 py-3">
        <summary className="cursor-pointer text-xs font-bold uppercase tracking-wide text-muted">View source details</summary>
        <div className="mt-3 space-y-2 text-sm leading-6 text-slate-700">
          <SummaryRow label="Raw OCR line" value={item.rawSourceLine || "Not available"} />
          <SummaryRow label="Matching key" value={item.comparisonKey || "Not available"} />
        </div>
      </details>
    </div>
  );
}

function setLineItemValue(
  setDraft: Dispatch<SetStateAction<PilotInvoiceDraft>>,
  index: number,
  updater: (current: PilotInvoiceLineItem) => PilotInvoiceLineItem,
) {
  setDraft((current) => ({
    ...current,
    confirmed: false,
    lineItems: current.lineItems.map((item, itemIndex) => (itemIndex === index ? updater(item) : item)),
  }));
}
