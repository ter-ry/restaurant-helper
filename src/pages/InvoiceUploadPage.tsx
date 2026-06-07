import { CheckCircle2, FileUp, Save, UploadCloud } from "lucide-react";
import { Badge } from "../components/Badge";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { DataTable, type Column } from "../components/DataTable";
import { PageLayout } from "../components/PageLayout";
import { SectionHeader } from "../components/SectionHeader";
import { extractedInvoice } from "../data/mockData";
import type { BadgeTone } from "../components/Badge";
import type { InvoiceLineItem, ItemStatus } from "../types";
import { formatCurrency, formatDate } from "../utils/format";

function statusTone(status: ItemStatus): BadgeTone {
  if (status === "Matched") return "success";
  if (status === "Price Increased") return "danger";
  if (status === "New Item") return "info";
  return "warning";
}

export function InvoiceUploadPage() {
  const columns: Column<InvoiceLineItem>[] = [
    { header: "Item Name", accessor: "itemName" },
    { header: "Quantity", accessor: "quantity" },
    { header: "Unit", accessor: "unit" },
    { header: "Unit Price", accessor: (row) => formatCurrency(row.unitPrice) },
    { header: "Line Total", accessor: (row) => formatCurrency(row.lineTotal) },
    { header: "Category", accessor: "category" },
    { header: "Status", accessor: (row) => <Badge tone={statusTone(row.status)}>{row.status}</Badge> },
  ];

  return (
    <PageLayout
      title="Invoice Upload / Review"
      description="Simulate the workflow that turns messy supplier invoices into reviewed item costs and price-change alerts."
    >
      <div className="grid gap-6 xl:grid-cols-[0.85fr_1.15fr]">
        <section>
          <SectionHeader title="Step 1: Upload Invoice" />
          <Card className="p-6">
            <div className="flex min-h-72 flex-col items-center justify-center rounded-lg border-2 border-dashed border-line bg-slate-50 p-8 text-center">
              <UploadCloud className="h-10 w-10 text-slate-500" />
              <h2 className="mt-4 text-lg font-bold text-ink">Drag and drop invoice files</h2>
              <p className="mt-2 max-w-sm text-sm leading-6 text-muted">
                Upload supplier PDFs or invoice images. OCR extraction will be added later. This demo uses sample
                extracted data.
              </p>
              <Button className="mt-5" icon={<FileUp className="h-4 w-4" />}>
                Upload PDF/Image
              </Button>
            </div>
          </Card>
        </section>

        <section>
          <SectionHeader title="Step 2: Review Extracted Invoice" />
          <Card className="p-5">
            <div className="grid gap-4 sm:grid-cols-2">
              {[
                ["Supplier", extractedInvoice.supplier],
                ["Invoice date", formatDate(extractedInvoice.invoiceDate)],
                ["Invoice number", extractedInvoice.invoiceNumber],
                ["Total amount", formatCurrency(extractedInvoice.totalAmount)],
              ].map(([label, value]) => (
                <label key={label} className="block">
                  <span className="text-xs font-bold uppercase tracking-wide text-muted">{label}</span>
                  <input className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm text-ink" value={value} readOnly />
                </label>
              ))}
            </div>
          </Card>
        </section>
      </div>

      <section className="mt-8">
        <SectionHeader title="Review Line Items" description="The status column shows what matched, what is new, and what may squeeze margin." />
        <DataTable columns={columns} data={extractedInvoice.items} getRowKey={(row) => row.id} />
        <div className="mt-5 flex flex-wrap gap-3">
          <Button icon={<Save className="h-4 w-4" />}>Save Invoice</Button>
          <Button variant="secondary" icon={<CheckCircle2 className="h-4 w-4" />}>
            Mark as Reviewed
          </Button>
          <Button variant="ghost" icon={<FileUp className="h-4 w-4" />}>
            Upload Another Invoice
          </Button>
        </div>
      </section>
    </PageLayout>
  );
}
