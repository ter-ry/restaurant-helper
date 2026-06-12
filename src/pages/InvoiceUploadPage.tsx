import { FileUp, UploadCloud, X } from "lucide-react";
import { useState } from "react";
import { Badge } from "../components/Badge";
import type { BadgeTone } from "../components/Badge";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { DataTable, type Column } from "../components/DataTable";
import { PageLayout } from "../components/PageLayout";
import { PilotCtaPanel } from "../components/PilotCtaPanel";
import { SectionHeader } from "../components/SectionHeader";
import { invoices } from "../data/mockData";
import type { InvoiceLineItem, InvoiceStatus, InvoiceSummary, ItemStatus } from "../types";
import { formatCurrency, formatDate } from "../utils/format";

function invoiceTone(status: InvoiceStatus): BadgeTone {
  if (status === "Processed") return "success";
  if (status === "Price Changes Found") return "warning";
  return "danger";
}

function lineTone(status: ItemStatus): BadgeTone {
  if (status === "Matched") return "success";
  if (status === "Price Increased") return "danger";
  if (status === "New Item") return "info";
  return "warning";
}

export function InvoiceUploadPage() {
  const [selectedInvoice, setSelectedInvoice] = useState<InvoiceSummary | null>(null);

  const invoiceColumns: Column<InvoiceSummary>[] = [
    { header: "Invoice", accessor: "invoiceNumber" },
    { header: "Supplier", accessor: "supplier" },
    { header: "Date", accessor: (row) => formatDate(row.invoiceDate) },
    { header: "Category", accessor: "category" },
    { header: "Total", accessor: (row) => formatCurrency(row.totalAmount) },
    { header: "Flagged items", accessor: "flaggedItems" },
    { header: "Status", accessor: (row) => <Badge tone={invoiceTone(row.status)}>{row.status}</Badge> },
  ];

  const lineColumns: Column<InvoiceLineItem>[] = [
    { header: "Line item", accessor: "itemName" },
    { header: "Qty", accessor: "quantity" },
    { header: "Unit", accessor: "unit" },
    { header: "Unit price", accessor: (row) => formatCurrency(row.unitPrice) },
    { header: "Line total", accessor: (row) => formatCurrency(row.lineTotal) },
    { header: "Category", accessor: "category" },
    { header: "Status", accessor: (row) => <Badge tone={lineTone(row.status)}>{row.status}</Badge> },
  ];

  return (
    <PageLayout
      title="Invoices"
      eyebrow="Harbourfront Cafe / invoice review"
      description="A demo review queue for supplier invoices. Upload is visual only; this prototype uses mock invoice data."
    >
      <div className="grid gap-6 xl:grid-cols-[0.8fr_1.2fr]">
        <Card className="p-6">
          <SectionHeader title="Demo upload" description="Frontend-only dropzone for showing the intended invoice workflow." />
          <div className="flex min-h-64 flex-col items-center justify-center rounded-lg border-2 border-dashed border-line bg-slate-50 p-8 text-center">
            <UploadCloud className="h-10 w-10 text-slate-500" />
            <h2 className="mt-4 text-lg font-bold text-ink">Drop supplier invoices here</h2>
            <p className="mt-2 max-w-sm text-sm leading-6 text-muted">
              For validation, restaurant owners can send 2-3 sample invoices and receive a sample cost report.
            </p>
            <Button className="mt-5" icon={<FileUp className="h-4 w-4" />}>
              Demo upload
            </Button>
          </div>
        </Card>

        <Card className="p-6">
          <SectionHeader title="Current invoice status" description="How Flowtally would summarize this month before the owner opens a spreadsheet." />
          <div className="grid gap-4 sm:grid-cols-3">
            <Metric label="Processed" value={String(invoices.filter((item) => item.status === "Processed").length)} />
            <Metric label="Need review" value={String(invoices.filter((item) => item.status === "Needs Review").length)} />
            <Metric label="Price flags" value={String(invoices.reduce((sum, item) => sum + item.flaggedItems, 0))} />
          </div>
          <p className="mt-5 text-sm leading-6 text-slate-600">
            The useful demo moment is clicking an invoice and seeing which line items were matched, which changed price,
            and which need owner review.
          </p>
        </Card>
      </div>

      <section className="mt-8">
        <SectionHeader title="Invoice table" description="Click a row to open the detail drawer." />
        <DataTable columns={invoiceColumns} data={invoices} getRowKey={(row) => row.id} onRowClick={setSelectedInvoice} />
      </section>

      {selectedInvoice ? (
        <div className="fixed inset-0 z-50 bg-ink/30 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Invoice detail">
          <button
            type="button"
            className="absolute inset-0 h-full w-full cursor-default"
            onClick={() => setSelectedInvoice(null)}
            aria-label="Close invoice detail backdrop"
          />
          <aside className="absolute right-0 top-0 flex h-full w-full max-w-3xl flex-col overflow-hidden bg-white shadow-2xl">
            <div className="flex flex-col gap-4 border-b border-line bg-white p-5 md:flex-row md:items-start md:justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-muted">Invoice detail</p>
                <h2 className="mt-1 text-xl font-bold text-ink">
                  {selectedInvoice.supplier} / {selectedInvoice.invoiceNumber}
                </h2>
                <p className="mt-1 text-sm text-muted">
                  {formatDate(selectedInvoice.invoiceDate)} - {formatCurrency(selectedInvoice.totalAmount)}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <Badge tone={invoiceTone(selectedInvoice.status)}>{selectedInvoice.status}</Badge>
                <button
                  type="button"
                  onClick={() => setSelectedInvoice(null)}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-line text-muted transition hover:bg-slate-50 hover:text-ink"
                  aria-label="Close invoice detail"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-5">
              <DataTable columns={lineColumns} data={selectedInvoice.lineItems} getRowKey={(row) => row.id} />
            </div>
          </aside>
        </div>
      ) : null}

      <section className="mt-8">
        <PilotCtaPanel />
      </section>
    </PageLayout>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-slate-50 p-4">
      <p className="text-xs font-bold uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-2 text-2xl font-bold text-ink">{value}</p>
    </div>
  );
}
