import { Badge } from "./Badge";
import { Button } from "./Button";
import { Card } from "./Card";
import { DataTable, type Column } from "./DataTable";
import type { MouseEvent } from "react";
import type { PilotInvoiceLineItem, PilotInvoiceRecord } from "../types";
import { formatCurrency, formatDate, formatDateTime, formatPercent } from "../utils/format";

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <span className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</span>
      <span className="min-w-0 break-words text-sm text-ink sm:max-w-56 sm:text-right">{value}</span>
    </div>
  );
}

export function PilotInvoiceDetailsModal({
  open,
  invoice,
  inventoryStatus,
  onClose,
  onReopenInReview,
  onReceiveIntoInventory,
}: {
  open: boolean;
  invoice: PilotInvoiceRecord | null;
  inventoryStatus: string | null;
  onClose: () => void;
  onReopenInReview: (invoice: PilotInvoiceRecord) => void;
  onReceiveIntoInventory: (invoice: PilotInvoiceRecord) => void;
}) {
  if (!open || !invoice) {
    return null;
  }

  const lineItemColumns: Column<PilotInvoiceLineItem>[] = [
    { header: "Description", accessor: "itemName" },
    { header: "Original description", accessor: "originalDescription", className: "min-w-52" },
    { header: "Qty", accessor: (row) => String(row.quantity) },
    { header: "Unit", accessor: "unit" },
    { header: "Unit price", accessor: (row) => formatCurrency(row.unitPrice) },
    { header: "Line total", accessor: (row) => formatCurrency(row.lineTotal) },
    { header: "Confidence", accessor: (row) => formatPercent(row.confidence * 100) },
    { header: "Status", accessor: "status" },
  ];

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
            <p className="text-xs font-bold uppercase tracking-wide text-muted">Saved invoice</p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-bold text-ink sm:text-xl">{invoice.supplier || "Unknown supplier"}</h2>
              <Badge tone={invoice.status === "Ready" ? "success" : "warning"}>{invoice.status}</Badge>
              <Badge tone={invoice.confirmed ? "success" : "warning"}>{invoice.confirmed ? "Saved" : "Needs review"}</Badge>
            </div>
            <p className="mt-1 text-sm leading-6 text-muted">
              View the saved purchase details or edit the stored values. OCR is not rerun when viewing an already saved invoice.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" onClick={() => onReopenInReview(invoice)}>
              Edit saved purchase
            </Button>
            <Button type="button" variant="secondary" onClick={() => onReceiveIntoInventory(invoice)}>
              Receive into inventory
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
                  <SummaryRow label="Supplier" value={invoice.supplier || "Unknown supplier"} />
                  <SummaryRow label="Invoice number" value={invoice.invoiceNumber || "Not saved"} />
                  <SummaryRow label="Invoice date" value={invoice.invoiceDate ? formatDate(invoice.invoiceDate) : "Not saved"} />
                  <SummaryRow label="Subtotal" value={formatCurrency(invoice.subtotal)} />
                  <SummaryRow label="Tax" value={formatCurrency(invoice.tax)} />
                  <SummaryRow label="Total" value={formatCurrency(invoice.totalAmount)} />
                </div>
                <div className="space-y-3">
                  <SummaryRow label="Saved status" value={invoice.confirmed ? "Confirmed" : "Needs review"} />
                  <SummaryRow label="Inventory status" value={inventoryStatus || "Not received"} />
                  <SummaryRow label="Saved at" value={formatDateTime(invoice.savedAt || invoice.updatedAt || invoice.createdAt)} />
                  <SummaryRow label="Created at" value={formatDateTime(invoice.createdAt)} />
                  <SummaryRow label="Updated at" value={formatDateTime(invoice.updatedAt)} />
                  <SummaryRow label="Source file" value={invoice.fileName || "Not available"} />
                  <SummaryRow label="File type" value={invoice.fileType || "Not available"} />
                </div>
              </div>
            </Card>

            <Card className="p-5">
              <div className="mb-4">
                <h3 className="text-lg font-bold text-ink">Original document</h3>
                <p className="mt-1 text-sm text-muted">If this invoice was uploaded in the current session, you can review the original file here.</p>
              </div>
              {invoice.sourceDocumentUrl ? (
                <div className="overflow-hidden rounded-xl border border-line bg-slate-50">
                  {invoice.sourceDocumentType?.includes("pdf") ? (
                    <iframe className="h-[70vh] w-full bg-white" src={invoice.sourceDocumentUrl} title={`${invoice.fileName || invoice.invoiceNumber || "Invoice"} original document`} />
                  ) : (
                    <img className="max-h-[70vh] w-full bg-white object-contain" src={invoice.sourceDocumentUrl} alt={`${invoice.fileName || invoice.invoiceNumber || "Invoice"} original document`} />
                  )}
                </div>
              ) : (
                <p className="text-sm leading-6 text-slate-700">No original file preview is stored for this record yet.</p>
              )}
            </Card>

            <Card className="p-5">
              <div className="mb-4">
                <h3 className="text-lg font-bold text-ink">Line items</h3>
                <p className="mt-1 text-sm text-muted">The saved descriptions and values below reflect the stored record, not a fresh OCR pass.</p>
              </div>
              <div className="space-y-3 sm:hidden">
                {invoice.lineItems.map((item, index) => (
                  <div key={item.id} className="rounded-xl border border-line bg-slate-50 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-bold text-ink">Line item {index + 1}</p>
                        <p className="mt-1 text-xs leading-5 text-muted">{item.itemName}</p>
                      </div>
                      <Badge tone={item.needsReview ? "warning" : "success"}>{formatPercent(item.confidence * 100)}</Badge>
                    </div>
                    <div className="mt-3 space-y-2 text-sm leading-6 text-slate-700">
                      <SummaryRow label="Original description" value={item.originalDescription || "Not saved"} />
                      <SummaryRow label="Qty" value={String(item.quantity)} />
                      <SummaryRow label="Unit" value={item.unit} />
                      <SummaryRow label="Unit price" value={formatCurrency(item.unitPrice)} />
                      <SummaryRow label="Line total" value={formatCurrency(item.lineTotal)} />
                      <SummaryRow label="Status" value={item.status} />
                    </div>
                  </div>
                ))}
              </div>
              <div className="hidden sm:block">
                <DataTable columns={lineItemColumns} data={invoice.lineItems} getRowKey={(row) => row.id} />
              </div>
            </Card>

            <Card className="p-5">
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="space-y-3">
                  <SummaryRow label="Extraction provider" value={invoice.extractionProvider || "manual"} />
                  <SummaryRow label="Review flags" value={String(invoice.extractionWarnings.length)} />
                  <SummaryRow label="Notes" value={invoice.notes || "None"} />
                </div>
                <div className="space-y-3">
                  <SummaryRow label="Raw OCR text" value={invoice.extractedText ? `${invoice.extractedText.slice(0, 120)}${invoice.extractedText.length > 120 ? "..." : ""}` : "Not stored"} />
                  <SummaryRow label="Warnings" value={invoice.extractionWarnings.length ? invoice.extractionWarnings.join(" | ") : "None"} />
                  <SummaryRow label="Source preservation" value="Original descriptions and raw OCR lines are stored separately." />
                </div>
              </div>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
