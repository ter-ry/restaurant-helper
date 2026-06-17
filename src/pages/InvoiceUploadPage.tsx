import { AlertTriangle, ArrowRight, CheckCircle2, FileUp, Loader2, Plus, RefreshCw, Save, ShieldAlert, Sparkles, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type Dispatch, type SetStateAction } from "react";
import { Badge, type BadgeTone } from "../components/Badge";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { DataTable, type Column } from "../components/DataTable";
import { PageLayout } from "../components/PageLayout";
import { SectionHeader } from "../components/SectionHeader";
import { captureInvoiceDocument, isSupportedInvoiceUpload } from "../lib/invoiceCapture";
import { useDemoProfile } from "../lib/demoProfile";
import { usePilotWorkspace } from "../lib/pilotWorkspace";
import type { InvoiceFieldConfidence, PilotInvoiceDraft, PilotInvoiceLineItem, PilotPriceChangeRecord } from "../types";
import { formatCurrency, formatDate, formatPercent } from "../utils/format";

const confidenceThreshold = 0.8;

function createBlankLineItem(index: number): PilotInvoiceLineItem {
  return {
    id: `line-${index + 1}-${Math.random().toString(16).slice(2, 6)}`,
    itemName: "",
    originalDescription: "",
    comparisonKey: "",
    quantity: 1,
    unit: "each",
    unitPrice: 0,
    lineTotal: 0,
    category: "Other",
    status: "Needs Review",
    confidence: 0,
    needsReview: true,
  };
}

function createBlankDraft(): PilotInvoiceDraft {
  return {
    supplier: "",
    invoiceDate: "",
    invoiceNumber: "",
    subtotal: 0,
    tax: 0,
    totalAmount: 0,
    status: "Needs Review",
    notes: "",
    fileName: "",
    fileType: "",
    extractedText: "",
    extractionWarnings: [],
    fieldConfidence: { supplier: 0, invoiceDate: 0, invoiceNumber: 0, subtotal: 0, tax: 0, total: 0, lineItems: 0 },
    extractionProvider: "manual",
    confirmed: false,
    lineItems: [createBlankLineItem(0)],
  };
}

function confidenceTone(confidence: number, needsReview: boolean): BadgeTone {
  if (needsReview || confidence < confidenceThreshold) {
    return confidence < 0.55 ? "danger" : "warning";
  }
  if (confidence >= 0.95) {
    return "success";
  }
  return "info";
}

function confidenceLabel(confidence: number, needsReview: boolean) {
  return `${Math.round(confidence * 100)}%${needsReview || confidence < confidenceThreshold ? " review" : ""}`;
}

function normalizeComparisonKey(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/\b(?:qty|quantity|case|cs|pack|pkg|x)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildDraftFromOcr(result: Awaited<ReturnType<typeof captureInvoiceDocument>>, file: File): PilotInvoiceDraft {
  const lineItems: PilotInvoiceLineItem[] = result.lineItems.length > 0 ? result.lineItems.map((item, index) => ({
    id: `line-${index + 1}-${Math.random().toString(16).slice(2, 6)}`,
    itemName: item.itemName || item.originalDescription || `Line item ${index + 1}`,
    originalDescription: item.originalDescription || item.itemName || `Line item ${index + 1}`,
    comparisonKey: item.comparisonKey || normalizeComparisonKey(item.itemName || item.originalDescription || ""),
    quantity: Number.isFinite(item.quantity) && item.quantity > 0 ? item.quantity : 1,
    unit: item.unit || "each",
    unitPrice: Number.isFinite(item.unitPrice) ? Number(item.unitPrice.toFixed(2)) : 0,
    lineTotal: Number.isFinite(item.lineTotal) ? Number(item.lineTotal.toFixed(2)) : 0,
    category: "Other",
    status: (item.needsReview || item.confidence < confidenceThreshold ? "Needs Review" : "Matched") as PilotInvoiceLineItem["status"],
    confidence: item.confidence,
    needsReview: item.needsReview || item.confidence < confidenceThreshold,
  })) : [createBlankLineItem(0)];

  const fieldConfidence = result.fields;

  return {
    supplier: result.fields.supplier.value || "",
    invoiceDate: result.fields.invoiceDate.value || "",
    invoiceNumber: result.fields.invoiceNumber.value || "",
    subtotal: Number.isFinite(result.fields.subtotal.value) ? Number(result.fields.subtotal.value.toFixed(2)) : 0,
    tax: Number.isFinite(result.fields.tax.value) ? Number(result.fields.tax.value.toFixed(2)) : 0,
    totalAmount: Number.isFinite(result.fields.total.value) ? Number(result.fields.total.value.toFixed(2)) : 0,
    status: result.needsReview ? "Needs Review" : "Ready",
    notes: result.warnings.join(" "),
    fileName: file.name,
    fileType: file.type || "application/octet-stream",
    extractedText: result.rawText,
    extractionWarnings: result.warnings,
    fieldConfidence: {
      supplier: fieldConfidence.supplier.confidence,
      invoiceDate: fieldConfidence.invoiceDate.confidence,
      invoiceNumber: fieldConfidence.invoiceNumber.confidence,
      subtotal: fieldConfidence.subtotal.confidence,
      tax: fieldConfidence.tax.confidence,
      total: fieldConfidence.total.confidence,
      lineItems: result.lineItems.length ? Number((result.lineItems.reduce((sum, item) => sum + item.confidence, 0) / result.lineItems.length).toFixed(2)) : 0,
    },
    extractionProvider: result.provider,
    confirmed: false,
    lineItems,
  };
}

function formatMaybeDate(value: string) {
  return value ? formatDate(value) : "Not extracted";
}

function formatMaybeCurrency(value: number) {
  return Number.isFinite(value) ? formatCurrency(value) : "Not extracted";
}

function setDraftValue(
  setDraft: Dispatch<SetStateAction<PilotInvoiceDraft>>,
  updater: (current: PilotInvoiceDraft) => PilotInvoiceDraft,
) {
  setDraft((current) => {
    const next = updater(current);
    return {
      ...next,
      confirmed: false,
    };
  });
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

export function InvoiceUploadPage() {
  const demo = useDemoProfile();
  const { saveInvoice, recentInvoices, reviewQueue, priceChanges, summary } = usePilotWorkspace();
  const [draft, setDraft] = useState<PilotInvoiceDraft>(() => createBlankDraft());
  const [isProcessing, setIsProcessing] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setDraft(createBlankDraft());
    setStatusMessage("");
    setErrorMessage("");
    setIsProcessing(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, [demo.slug]);

  const uncertainFields = useMemo(() => {
    const fields: Array<keyof InvoiceFieldConfidence> = ["supplier", "invoiceDate", "invoiceNumber", "subtotal", "tax", "total", "lineItems"];
    return fields.filter((field) => {
      const confidence = draft.fieldConfidence[field];
      return confidence < confidenceThreshold;
    });
  }, [draft.fieldConfidence]);

  const lineItemsNeedingReview = draft.lineItems.filter((item) => item.needsReview || item.confidence < confidenceThreshold).length;

  const priceChangeColumns: Column<PilotPriceChangeRecord>[] = [
    { header: "Item", accessor: "itemName" },
    { header: "Supplier", accessor: "supplier" },
    { header: "Previous date", accessor: (row) => formatDate(row.previousInvoiceDate) },
    { header: "Current date", accessor: (row) => formatDate(row.invoiceDate) },
    { header: "Previous", accessor: (row) => formatCurrency(row.previousPrice) },
    { header: "Current", accessor: (row) => formatCurrency(row.currentPrice) },
    { header: "Change", accessor: (row) => <Badge tone={row.status === "Increased" ? "danger" : row.status === "Decreased" ? "success" : "neutral"}>{formatPercent(row.changePercent)}</Badge> },
  ];

  const recentInvoiceColumns: Column<(typeof recentInvoices)[number]>[] = [
    { header: "Supplier", accessor: "supplier" },
    { header: "Invoice", accessor: "invoiceNumber" },
    { header: "Date", accessor: (row) => formatMaybeDate(row.invoiceDate) },
    { header: "Total", accessor: (row) => formatMaybeCurrency(row.totalAmount) },
    { header: "Status", accessor: (row) => <Badge tone={row.status === "Ready" ? "success" : "warning"}>{row.status}</Badge> },
  ];

  const handleFileUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) {
      return;
    }

    if (!isSupportedInvoiceUpload(file)) {
      setDraft({
        ...createBlankDraft(),
        fileName: file.name,
        fileType: file.type || "application/octet-stream",
        extractionWarnings: ["That file type is not supported yet. Use JPG, JPEG, PNG, WEBP, or PDF."],
        notes: "Unsupported file type. Enter the invoice manually.",
      });
      setErrorMessage("That file type is not supported yet. Use JPG, JPEG, PNG, WEBP, or PDF.");
      setStatusMessage("");
      return;
    }

    setIsProcessing(true);
    setErrorMessage("");
    setStatusMessage("Sending the file to the OCR service for extraction...");

    try {
      const extracted = await captureInvoiceDocument(file);
      setDraft(buildDraftFromOcr(extracted, file));
      setStatusMessage(`Extracted ${file.name}. Please review every highlighted field before saving.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invoice OCR failed.";
      setDraft({
        ...createBlankDraft(),
        fileName: file.name,
        fileType: file.type || "application/octet-stream",
        extractionWarnings: [message, "You can still enter the invoice manually below."],
        notes: message,
      });
      setErrorMessage(message);
      setStatusMessage("OCR did not finish cleanly, but manual entry is still available.");
    } finally {
      setIsProcessing(false);
    }
  };

  const addLineItem = () => {
    setDraft((current) => ({
      ...current,
      confirmed: false,
      lineItems: [...current.lineItems, createBlankLineItem(current.lineItems.length)],
    }));
  };

  const removeLineItem = (index: number) => {
    setDraft((current) => ({
      ...current,
      confirmed: false,
      lineItems: current.lineItems.length > 1 ? current.lineItems.filter((_, itemIndex) => itemIndex !== index) : [createBlankLineItem(0)],
    }));
  };

  const handleSave = () => {
    const saved = saveInvoice(draft);
    setStatusMessage(`Saved ${saved.invoiceNumber || "the invoice"} and updated local price history.`);
    setErrorMessage("");
    setDraft(createBlankDraft());
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  return (
    <PageLayout
      title="Invoice capture"
      eyebrow={`${demo.customization.restaurantName} / Pilot workspace`}
      description="Upload a photographed invoice or PDF, review the extracted fields, correct them, and save structured invoice data locally."
    >
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
        <Card className="surface-panel min-w-0 p-5 sm:p-6">
          <SectionHeader
            title="Upload and review"
            description="OCR runs on the local Flask backend and sends the file to OCR.space. The result is extracted data that still needs confirmation."
            action={<Badge tone="info">Single-restaurant pilot</Badge>}
          />

          <div className="rounded-xl border border-dashed border-brand-100 bg-brand-50/40 p-4">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-sm font-bold text-ink">Upload invoice image or PDF</p>
                <p className="mt-1 text-sm leading-6 text-muted">Supports JPG, JPEG, PNG, WEBP, and PDFs. Scanned PDFs are sent to OCR.space for text extraction.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  icon={<FileUp className="h-4 w-4" />}
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isProcessing}
                >
                  Choose file
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  icon={<RefreshCw className="h-4 w-4" />}
                  onClick={() => setDraft(createBlankDraft())}
                  disabled={isProcessing}
                >
                  Clear form
                </Button>
              </div>
            </div>
            <input
              ref={fileInputRef}
              accept=".jpg,.jpeg,.png,.webp,.pdf,image/jpeg,image/png,image/webp,application/pdf"
              className="hidden"
              onChange={handleFileUpload}
              type="file"
            />
            <p className="mt-3 text-xs leading-5 text-muted">Do not upload files you are not comfortable sending to a third-party OCR provider. API keys stay on the backend, not in the browser.</p>
          </div>

          {isProcessing ? (
            <div className="mt-4 rounded-lg border border-brand-100 bg-brand-50 px-4 py-3 text-sm leading-6 text-brand-700">
              <div className="flex items-center gap-2 font-semibold">
                <Loader2 className="h-4 w-4 animate-spin" />
                Processing invoice
              </div>
              <p className="mt-1">The file is being uploaded, OCR is running, and the extracted fields will appear here when it finishes.</p>
            </div>
          ) : null}

          {errorMessage ? (
            <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm leading-6 text-red-800" role="alert">
              <div className="flex items-center gap-2 font-semibold">
                <AlertTriangle className="h-4 w-4" />
                OCR or upload problem
              </div>
              <p className="mt-1">{errorMessage}</p>
            </div>
          ) : null}

          {statusMessage ? (
            <div className="mt-4 rounded-lg border border-brand-100 bg-white px-4 py-3 text-sm leading-6 text-slate-700" role="status">
              <div className="flex items-center gap-2 font-semibold text-ink">
                <Sparkles className="h-4 w-4 text-brand-600" />
                Review state
              </div>
              <p className="mt-1">{statusMessage}</p>
            </div>
          ) : null}

          <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              label="Confidence"
              value={`${Math.round(((draft.fieldConfidence.supplier + draft.fieldConfidence.invoiceDate + draft.fieldConfidence.invoiceNumber + draft.fieldConfidence.subtotal + draft.fieldConfidence.tax + draft.fieldConfidence.total) / 6) * 100) || 0}%`}
              helper="Extracted fields still need confirmation"
            />
            <MetricCard
              label="Review flags"
              value={String(uncertainFields.length + lineItemsNeedingReview)}
              helper="Fields and line items marked for attention"
            />
            <MetricCard
              label="Recent invoices"
              value={String(recentInvoices.length)}
              helper="Stored locally in this browser"
            />
            <MetricCard
              label="Recent changes"
              value={String(priceChanges.length)}
              helper="Meaningful prior matches only"
            />
          </div>

          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <FieldEditor
              label="Supplier name"
              value={draft.supplier}
              confidence={draft.fieldConfidence.supplier}
              needsReview={draft.fieldConfidence.supplier < confidenceThreshold}
              helper="OCR result from the supplier header or invoice body."
              onChange={(value) => setDraftValue(setDraft, (current) => ({ ...current, supplier: value }))}
              placeholder="Enter supplier name"
            />
            <FieldEditor
              label="Invoice date"
              type="date"
              value={draft.invoiceDate}
              confidence={draft.fieldConfidence.invoiceDate}
              needsReview={draft.fieldConfidence.invoiceDate < confidenceThreshold}
              helper="Keep this as the invoice date printed on the document."
              onChange={(value) => setDraftValue(setDraft, (current) => ({ ...current, invoiceDate: value }))}
            />
            <FieldEditor
              label="Invoice number"
              value={draft.invoiceNumber}
              confidence={draft.fieldConfidence.invoiceNumber}
              needsReview={draft.fieldConfidence.invoiceNumber < confidenceThreshold}
              helper="Reference number or invoice ID."
              onChange={(value) => setDraftValue(setDraft, (current) => ({ ...current, invoiceNumber: value }))}
              placeholder="Enter invoice number"
            />
            <FieldEditor
              label="Subtotal"
              value={draft.subtotal}
              confidence={draft.fieldConfidence.subtotal}
              needsReview={draft.fieldConfidence.subtotal < confidenceThreshold}
              helper="Pre-tax invoice total."
              onChange={(value) => setDraftValue(setDraft, (current) => ({ ...current, subtotal: Number(value) || 0 }))}
              type="number"
            />
            <FieldEditor
              label="Tax"
              value={draft.tax}
              confidence={draft.fieldConfidence.tax}
              needsReview={draft.fieldConfidence.tax < confidenceThreshold}
              helper="GST, HST, VAT, or other tax."
              onChange={(value) => setDraftValue(setDraft, (current) => ({ ...current, tax: Number(value) || 0 }))}
              type="number"
            />
            <FieldEditor
              label="Total"
              value={draft.totalAmount}
              confidence={draft.fieldConfidence.total}
              needsReview={draft.fieldConfidence.total < confidenceThreshold}
              helper="Final invoice total to be checked against the document."
              onChange={(value) => setDraftValue(setDraft, (current) => ({ ...current, totalAmount: Number(value) || 0 }))}
              type="number"
            />
          </div>

          <div className="mt-6">
            <SectionHeader
              title="Line items"
              description="Add, remove, or correct line items before saving. Conservative name matching keeps unrelated products separate."
              action={
                <Button type="button" variant="secondary" icon={<Plus className="h-4 w-4" />} onClick={addLineItem}>
                  Add line item
                </Button>
              }
            />

            <div className="space-y-4">
              {draft.lineItems.map((item, index) => (
                <div key={item.id} className="min-w-0 rounded-xl border border-line bg-white p-4 shadow-soft">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-bold text-ink">Line item {index + 1}</p>
                        <Badge tone={confidenceTone(item.confidence, item.needsReview)}>{confidenceLabel(item.confidence, item.needsReview)}</Badge>
                        <Badge tone={item.status === "Price Increased" ? "danger" : item.status === "Matched" ? "success" : "warning"}>{item.status}</Badge>
                      </div>
                      <p className="mt-1 text-xs leading-5 text-muted">Original description is stored separately from the comparison key that drives price tracking.</p>
                    </div>
                    <Button type="button" variant="ghost" className="w-full sm:w-auto" icon={<Trash2 className="h-4 w-4" />} onClick={() => removeLineItem(index)}>
                      Remove
                    </Button>
                  </div>

                  <div className="mt-4 grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
                    <FieldEditor
                      label="Original description"
                      value={item.originalDescription}
                      confidence={item.confidence}
                      needsReview={item.needsReview}
                      helper="Keep the raw invoice wording here."
                      onChange={(value) =>
                        setLineItemValue(setDraft, index, (current) => ({
                          ...current,
                          originalDescription: value,
                          itemName: value,
                        }))
                      }
                      placeholder="Enter line description"
                    />
                    <FieldEditor
                      label="Matching key"
                      value={item.comparisonKey}
                      confidence={item.confidence}
                      needsReview={item.needsReview}
                      helper="Used only for conservative price comparisons."
                      onChange={(value) =>
                        setLineItemValue(setDraft, index, (current) => ({
                          ...current,
                          comparisonKey: value,
                        }))
                      }
                      placeholder="Normalized match key"
                    />
                    <FieldEditor
                      label="Quantity"
                      value={item.quantity}
                      confidence={item.confidence}
                      needsReview={item.needsReview}
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
                      confidence={item.confidence}
                      needsReview={item.needsReview}
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
                      confidence={item.confidence}
                      needsReview={item.needsReview}
                      helper="Per-unit amount before tax."
                      onChange={(value) =>
                        setLineItemValue(setDraft, index, (current) => ({
                          ...current,
                          unitPrice: Number(value) || 0,
                        }))
                      }
                      type="number"
                    />
                    <FieldEditor
                      label="Line total"
                      value={item.lineTotal}
                      confidence={item.confidence}
                      needsReview={item.needsReview}
                      helper="Line total printed on the invoice."
                      onChange={(value) =>
                        setLineItemValue(setDraft, index, (current) => ({
                          ...current,
                          lineTotal: Number(value) || 0,
                        }))
                      }
                      type="number"
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.65fr)]">
            <FieldEditor
              label="Notes"
              value={draft.notes}
              confidence={1}
              needsReview={false}
              helper="Reason for a correction, a missing item, or a manual follow-up."
              onChange={(value) => setDraftValue(setDraft, (current) => ({ ...current, notes: value }))}
              placeholder="Add notes"
              asTextArea
            />
            <div className="min-w-0 rounded-xl border border-line bg-slate-50 p-4">
              <p className="text-xs font-bold uppercase tracking-wide text-muted">Processing summary</p>
              <div className="mt-3 space-y-3 text-sm leading-6 text-slate-700">
                <SummaryRow label="File" value={draft.fileName || "No file uploaded"} />
                <SummaryRow label="Provider" value={draft.extractionProvider || "manual"} />
                <SummaryRow label="Status" value={draft.status} />
                <SummaryRow label="Warnings" value={String(draft.extractionWarnings.length)} />
                <SummaryRow label="Line items" value={String(draft.lineItems.length)} />
                <SummaryRow label="Needs review" value={String(uncertainFields.length + lineItemsNeedingReview)} />
              </div>
            </div>
          </div>

          <div className="mt-6 min-w-0 rounded-xl border border-line bg-slate-50 p-4">
            <p className="text-xs font-bold uppercase tracking-wide text-muted">Raw extracted text</p>
            <p className="mt-2 text-xs leading-5 text-muted">This is the OCR text used to populate the structured fields. It is shown here so the operator can verify what the backend extracted.</p>
            <textarea
              className="input mt-3 min-h-44 font-mono text-xs leading-5"
              value={draft.extractedText || "No extracted text yet."}
              onChange={() => undefined}
              readOnly
            />
          </div>

          <div className="mt-6 rounded-xl border border-brand-100 bg-brand-50/50 p-4">
            <label className="flex items-start gap-3 text-sm leading-6 text-slate-700">
              <input
                checked={draft.confirmed}
                onChange={(event) => setDraft((current) => ({ ...current, confirmed: event.target.checked }))}
                className="mt-1 h-4 w-4 rounded border-line text-brand-600"
                type="checkbox"
              />
              <span>
                I reviewed this invoice and understand that the fields were extracted and may still need correction before the record is trusted.
              </span>
            </label>
            <div className="mt-4 flex flex-wrap gap-3">
              <Button
                type="button"
                icon={<Save className="h-4 w-4" />}
                onClick={handleSave}
                disabled={!draft.confirmed || isProcessing || !draft.fileName}
              >
                Confirm and save
              </Button>
              <Button
                type="button"
                variant="secondary"
                icon={<CheckCircle2 className="h-4 w-4" />}
                onClick={() => setDraft((current) => ({ ...current, confirmed: true }))}
                disabled={isProcessing}
              >
                Mark reviewed
              </Button>
            </div>
          </div>
        </Card>

        <div className="grid gap-4">
          <Card className="p-5">
            <div className="flex items-start gap-4">
              <div className="rounded-lg bg-ink p-3 text-white">
                <ShieldAlert className="h-5 w-5" />
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-muted">Privacy and architecture</p>
                <p className="mt-2 text-sm leading-6 text-slate-700">
                  The upload is handled by the local Flask backend and then forwarded to OCR.space for real OCR. That keeps API keys out of the frontend, but it does mean the invoice file leaves this machine for OCR processing.
                </p>
              </div>
            </div>
          </Card>

          <Card className="p-5">
            <SectionHeader title="Invoice review queue" description="Records that still need a final owner check." />
            <DataTable columns={recentInvoiceColumns} data={reviewQueue.slice(0, 5)} getRowKey={(row) => row.id} />
          </Card>

          <Card className="p-5">
            <SectionHeader title="Recent price changes" description="Only conservative matches from saved invoice history are shown." />
            <DataTable columns={priceChangeColumns} data={priceChanges.slice(0, 5)} getRowKey={(row) => row.id} />
          </Card>

          <Card className="surface-panel p-5">
            <div className="flex items-start gap-4">
              <div className="rounded-lg bg-brand-600 p-3 text-white">
                <ArrowRight className="h-5 w-5" />
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-muted">What a restaurant can test now</p>
                <ul className="mt-2 space-y-2 text-sm leading-6 text-slate-700">
                  <li>Upload a JPG, PNG, WEBP, or PDF invoice.</li>
                  <li>Correct any uncertain field or line item and save the record locally.</li>
                  <li>Upload a second invoice for the same supplier to see the price history update.</li>
                </ul>
              </div>
            </div>
          </Card>

          <Card className="p-5">
            <div className="flex items-start gap-4">
              <div className="rounded-lg bg-slate-100 p-3 text-slate-700">
                <FileUp className="h-5 w-5" />
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-muted">Local storage</p>
                <p className="mt-2 text-sm leading-6 text-slate-700">
                  Saved invoices are stored in this browser only. Refreshing the page should keep the data, and clearing browser storage will remove it.
                </p>
                <p className="mt-3 text-sm text-muted">{summary.invoiceCount} invoices stored locally.</p>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </PageLayout>
  );
}

function FieldEditor({
  label,
  value,
  confidence,
  needsReview,
  helper,
  onChange,
  placeholder,
  type = "text",
  asTextArea = false,
}: {
  label: string;
  value: string | number;
  confidence: number;
  needsReview: boolean;
  helper: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: "text" | "date" | "number";
  asTextArea?: boolean;
}) {
  const tone = confidenceTone(confidence, needsReview);
  const flagged = needsReview || confidence < confidenceThreshold;

  return (
    <label className="block min-w-0">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
        <span className="text-xs font-bold uppercase tracking-wide text-muted">{label}</span>
        <Badge tone={tone}>{confidenceLabel(confidence, needsReview)}</Badge>
      </div>
      <p className="mt-1 text-xs leading-5 text-muted">{helper}</p>
      <div className="mt-2">
        {asTextArea ? (
          <textarea
            className={`input w-full min-w-0 ${flagged ? "border-amber-300 bg-amber-50/30" : ""}`}
            placeholder={placeholder}
            value={typeof value === "number" ? String(value) : value}
            onChange={(event) => onChange(event.target.value)}
          />
        ) : (
          <input
            className={`input w-full min-w-0 ${flagged ? "border-amber-300 bg-amber-50/30" : ""}`}
            placeholder={placeholder}
            type={type}
            value={typeof value === "number" ? String(value) : value}
            onChange={(event) => onChange(event.target.value)}
          />
        )}
      </div>
    </label>
  );
}

function MetricCard({ label, value, helper }: { label: string; value: string; helper: string }) {
  return (
    <div className="rounded-xl border border-line bg-white p-4">
      <p className="text-xs font-bold uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-2 text-2xl font-bold text-ink">{value}</p>
      <p className="mt-1 text-xs leading-5 text-muted">{helper}</p>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <span className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</span>
      <span className="min-w-0 break-words text-sm text-ink sm:max-w-56 sm:text-right">{value}</span>
    </div>
  );
}
