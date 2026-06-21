import { AlertTriangle, CheckCircle2, FileUp, Loader2, Plus, RefreshCw, Save, Sparkles, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type Dispatch, type MouseEvent, type SetStateAction } from "react";
import { useNavigate } from "react-router-dom";
import { Badge, type BadgeTone } from "../components/Badge";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { DataTable, type Column } from "../components/DataTable";
import { InvoiceLineItemCard as InvoiceLineItemCardView } from "../components/InvoiceLineItemCard";
import { PilotInvoiceDetailsModal } from "../components/PilotInvoiceDetailsModal";
import { PageLayout } from "../components/PageLayout";
import { SectionHeader } from "../components/SectionHeader";
import { buildInvoiceSaveConfirmation, createDraftFromInvoice, getDraftSummaryDisplay } from "../lib/invoiceHistory";
import { captureInvoiceDocument, isSupportedInvoiceUpload } from "../lib/invoiceCapture";
import { formatLineConfidence, getLineTotalReviewState, normalizeComparisonKey as normalizeLineItemKey, updateLineItemDescription } from "../lib/invoiceLineItemView";
import { useDemoProfile } from "../lib/demoProfile";
import { buildDemoRestaurantInvoiceDraft } from "../lib/invoiceSamples";
import { summarizeInvoiceInventoryStatus } from "../lib/invoiceInventory";
import { getRecentInvoicePreview, usePilotWorkspace } from "../lib/pilotWorkspace";
import type { InvoiceFieldConfidence, PilotInvoiceDraft, PilotInvoiceLineItem, PilotInvoiceRecord, PilotPriceChangeRecord } from "../types";
import { formatCurrency, formatDate, formatDateTime, formatPercent } from "../utils/format";
import { buildDemoPath, defaultDemoProfileSlug } from "../lib/demoProfile";

const confidenceThreshold = 0.8;

function createBlankLineItem(index: number): PilotInvoiceLineItem {
  return {
    id: `line-${index + 1}-${Math.random().toString(16).slice(2, 6)}`,
    itemName: "",
    originalDescription: "",
    rawSourceLine: "",
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
    id: undefined,
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
    sourceDocumentUrl: "",
    sourceDocumentName: "",
    sourceDocumentType: "",
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
  return formatLineConfidence(confidence);
}

function buildDraftFromOcr(result: Awaited<ReturnType<typeof captureInvoiceDocument>>, file: File, sourceDocumentUrl = ""): PilotInvoiceDraft {
  const lineItems: PilotInvoiceLineItem[] = result.lineItems.length > 0 ? result.lineItems.map((item, index) => ({
    id: `line-${index + 1}-${Math.random().toString(16).slice(2, 6)}`,
    itemName: item.itemName || item.originalDescription || `Line item ${index + 1}`,
    originalDescription: item.originalDescription || item.itemName || `Line item ${index + 1}`,
    rawSourceLine: item.rawSourceLine || item.originalDescription || item.itemName || `Line item ${index + 1}`,
    comparisonKey: item.comparisonKey || normalizeLineItemKey(item.originalDescription || item.itemName || ""),
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
    sourceDocumentUrl,
    sourceDocumentName: file.name,
    sourceDocumentType: file.type || "application/octet-stream",
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
  const { saveInvoice, recentInvoices, reviewQueue, priceChanges, summary, inventoryReceipts, updateInvoiceInventoryStatus } = usePilotWorkspace();
  const [draft, setDraft] = useState<PilotInvoiceDraft>(() => createBlankDraft());
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [reviewOpen, setReviewOpen] = useState(false);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);
  const [showAllInvoices, setShowAllInvoices] = useState(false);
  const [ocrStage, setOcrStage] = useState("Idle");
  const [ocrElapsedSeconds, setOcrElapsedSeconds] = useState(0);
  const [uploadStartedAt, setUploadStartedAt] = useState<number | null>(null);
  const [savedInvoicePrompt, setSavedInvoicePrompt] = useState<PilotInvoiceRecord | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const sourceDocumentUrlRef = useRef<string | null>(null);
  const saveLockRef = useRef(false);
  const navigate = useNavigate();

  useEffect(() => {
    handleResetDraft();
  }, [demo.slug]);

  useEffect(() => {
    if (!isProcessing || uploadStartedAt === null) {
      setOcrElapsedSeconds(0);
      return;
    }

    const updateElapsed = () => setOcrElapsedSeconds(Math.max(0, Math.floor((Date.now() - uploadStartedAt) / 1000)));
    updateElapsed();
    const timer = window.setInterval(updateElapsed, 1000);
    const stageTimers = [
      window.setTimeout(() => setOcrStage("Reading document"), 250),
      window.setTimeout(() => setOcrStage("Extracting fields"), 1500),
      window.setTimeout(() => setOcrStage("Still working - you can continue waiting or enter manually"), 5000),
    ];

    return () => {
      window.clearInterval(timer);
      stageTimers.forEach((timerId) => window.clearTimeout(timerId));
    };
  }, [isProcessing, uploadStartedAt]);

  const draftSummary = useMemo(() => getDraftSummaryDisplay(draft, reviewOpen), [draft, reviewOpen]);
  const hasActiveDraft = draftSummary.hasActiveDraft;

  const uncertainFields = useMemo(() => {
    const fields: Array<keyof InvoiceFieldConfidence> = ["supplier", "invoiceDate", "invoiceNumber", "subtotal", "tax", "total", "lineItems"];
    return fields.filter((field) => {
      const confidence = draft.fieldConfidence[field];
      return confidence < confidenceThreshold;
    });
  }, [draft.fieldConfidence]);

  const lineItemsNeedingReview = draft.lineItems.filter((item) => item.needsReview || item.confidence < confidenceThreshold).length;
  const selectedInvoice = useMemo(() => recentInvoices.find((invoice) => invoice.id === selectedInvoiceId) ?? null, [recentInvoices, selectedInvoiceId]);
  const recentInvoicePreview = useMemo(() => getRecentInvoicePreview(recentInvoices, 5), [recentInvoices]);
  const getInvoiceInventoryStatus = (invoice: PilotInvoiceRecord) => summarizeInvoiceInventoryStatus(invoice, inventoryReceipts);
  const selectedInvoiceInventoryStatus = selectedInvoice ? getInvoiceInventoryStatus(selectedInvoice) : null;
  const invoiceModalOpen = reviewOpen || Boolean(savedInvoicePrompt);

  const openInvoice = (invoice: PilotInvoiceRecord) => {
    setSavedInvoicePrompt(null);
    setSelectedInvoiceId(invoice.id);
  };

  const reopenInvoiceForReview = (invoice: PilotInvoiceRecord) => {
    setSavedInvoicePrompt(null);
    setDraft(createDraftFromInvoice(invoice));
    setReviewOpen(true);
    setStatusMessage(`Reopened ${invoice.supplier || "the invoice"} for review.`);
    setErrorMessage("");
  };

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
    {
      header: "Inventory",
      accessor: (row) => {
        const inventoryStatus = getInvoiceInventoryStatus(row);
        return <Badge tone={inventoryStatus === "Received" ? "success" : inventoryStatus === "Partially received" ? "warning" : inventoryStatus === "Skipped" ? "neutral" : "info"}>{inventoryStatus}</Badge>;
      },
    },
    { header: "Status", accessor: (row) => <Badge tone={row.status === "Ready" ? "success" : "warning"}>{row.status}</Badge> },
    {
      header: "Open",
      accessor: (row) => (
        <Button type="button" variant="ghost" onClick={() => openInvoice(row)}>
          Open
        </Button>
      ),
    },
  ];

  const handleFileUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) {
      return;
    }

    setSelectedInvoiceId(null);
    setShowAllInvoices(false);
    setSavedInvoicePrompt(null);
    setOcrStage("Idle");
    setOcrElapsedSeconds(0);
    setUploadStartedAt(null);

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
      setReviewOpen(true);
      return;
    }

    setIsProcessing(true);
    setUploadStartedAt(Date.now());
    setOcrStage("Uploading");
    setErrorMessage("");
    setStatusMessage("Uploading invoice for OCR extraction...");

    try {
      sourceDocumentUrlRef.current = URL.createObjectURL(file);
      const extracted = await captureInvoiceDocument(file);
      setDraft(buildDraftFromOcr(extracted, file, sourceDocumentUrlRef.current));
      setOcrStage("Preparing review");
      setStatusMessage(`Extracted ${file.name}. Please review every highlighted field before saving.`);
      setReviewOpen(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invoice OCR failed.";
      setDraft({
        ...createBlankDraft(),
        fileName: file.name,
        fileType: file.type || "application/octet-stream",
        sourceDocumentUrl: sourceDocumentUrlRef.current ?? "",
        sourceDocumentName: file.name,
        sourceDocumentType: file.type || "application/octet-stream",
        extractionWarnings: [message, "You can still enter the invoice manually below."],
        notes: message,
      });
      setOcrStage("Manual fallback");
      setErrorMessage(message);
      setStatusMessage("OCR did not finish cleanly, but manual entry is still available.");
      setReviewOpen(true);
    } finally {
      setIsProcessing(false);
      setUploadStartedAt(null);
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

  const loadSampleInvoice = () => {
    const sample = buildDemoRestaurantInvoiceDraft();
    setSelectedInvoiceId(null);
    setShowAllInvoices(false);
    setSavedInvoicePrompt(null);
    sourceDocumentUrlRef.current = null;
    setDraft(sample);
    setReviewOpen(true);
    setErrorMessage("");
    setIsProcessing(false);
    setStatusMessage("Loaded a demo invoice draft instantly. Review the prefilled values before saving.");
    setOcrStage("Demo sample");
    setOcrElapsedSeconds(0);
    setUploadStartedAt(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleCloseReviewModal = () => {
    setReviewOpen(false);
    setSavedInvoicePrompt(null);
  };

  const handleReceiveSavedInvoice = (invoice: PilotInvoiceRecord) => {
    setSavedInvoicePrompt(null);
    setReviewOpen(false);
    setStatusMessage(`Opening inventory receipt flow for ${invoice.supplier || "the saved invoice"}.`);
    navigate(`${buildDemoPath(defaultDemoProfileSlug, "inventory")}?receive=${encodeURIComponent(invoice.id)}`);
  };

  const handleSkipSavedInvoice = (invoice: PilotInvoiceRecord) => {
    updateInvoiceInventoryStatus(invoice.id, "Skipped");
    setStatusMessage(`Skipped inventory receiving for ${invoice.supplier || "the invoice"}.`);
    setReviewOpen(false);
    setSavedInvoicePrompt(null);
  };

  const handleSave = () => {
    if (isSaving || saveLockRef.current) {
      return;
    }

    saveLockRef.current = true;
    setIsSaving(true);

    try {
      const saved = saveInvoice(draft);
      setStatusMessage(buildInvoiceSaveConfirmation(saved));
      setErrorMessage("");
      setReviewOpen(false);
      setDraft(createBlankDraft());
      setSavedInvoicePrompt(saved);
      sourceDocumentUrlRef.current = null;
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    } finally {
      setIsSaving(false);
      saveLockRef.current = false;
    }
  };

  function handleResetDraft() {
    setDraft(createBlankDraft());
    sourceDocumentUrlRef.current = null;
    setStatusMessage("");
    setErrorMessage("");
    setIsProcessing(false);
    setReviewOpen(false);
    setIsSaving(false);
    setSelectedInvoiceId(null);
    setShowAllInvoices(false);
    setOcrStage("Idle");
    setOcrElapsedSeconds(0);
    setUploadStartedAt(null);
    setSavedInvoicePrompt(null);
    saveLockRef.current = false;
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  return (
    <PageLayout
      title="Invoice capture"
      eyebrow={`${demo.customization.restaurantName} / Pilot workspace`}
      description="Upload a photographed invoice or PDF. The focused review step opens in a modal so you can correct the extracted fields and save structured data locally."
    >
      <div className="grid gap-6">
        <Card className="surface-panel min-w-0 p-5 sm:p-6">
          <SectionHeader
            title="Upload invoice"
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
                  variant="secondary"
                  icon={<Sparkles className="h-4 w-4" />}
                  onClick={loadSampleInvoice}
                  disabled={isProcessing || isSaving}
                >
                  Load sample restaurant invoice
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  icon={<RefreshCw className="h-4 w-4" />}
                  onClick={handleResetDraft}
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
              <p className="mt-1">{ocrStage}.</p>
              <p className="mt-1 text-xs text-brand-600">
                Elapsed: {ocrElapsedSeconds}s{ocrElapsedSeconds >= 5 ? " | Still working - you can continue waiting or enter manually" : ""}
              </p>
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
              value={draftSummary.confidence}
              helper={hasActiveDraft ? "Extracted fields still need confirmation" : "Upload an invoice to see extraction confidence"}
            />
            <MetricCard
              label="Review flags"
              value={String(draftSummary.reviewFlags)}
              helper={hasActiveDraft ? "Fields and line items marked for attention" : "No active invoice draft"}
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

          {draft.fileName && !reviewOpen ? (
            <div className="mt-5 rounded-xl border border-brand-100 bg-brand-50/50 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-muted">Review ready</p>
                  <p className="mt-1 text-sm font-semibold text-ink">{draft.fileName}</p>
                  <p className="mt-1 text-sm leading-6 text-muted">
                    {reviewQueue.length} saved invoice records are waiting for owner review. Reopen the focused review step to confirm or correct the extracted fields.
                  </p>
                </div>
                <Button type="button" variant="secondary" onClick={() => setReviewOpen(true)}>
                  Resume review
                </Button>
              </div>
            </div>
          ) : null}

        </Card>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="p-5">
            <SectionHeader
              title="Recent invoices"
              description="The newest five saved invoices are shown here first. Use the full list to reopen older records."
              action={
                recentInvoices.length > 5 ? (
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setShowAllInvoices((current) => !current)}
                  >
                  {showAllInvoices ? "Hide all invoices" : `View all invoices (${recentInvoicePreview.totalCount})`}
                  </Button>
                ) : null
              }
            />
            <div className="space-y-3 sm:hidden">
              {recentInvoicePreview.visibleInvoices.map((invoice) => (
                <button
                  key={invoice.id}
                  type="button"
                  className="w-full rounded-xl border border-line bg-white p-4 text-left shadow-soft transition hover:bg-slate-50"
                  onClick={() => openInvoice(invoice)}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-ink">{invoice.supplier}</p>
                      <p className="mt-1 text-xs leading-5 text-muted">
                        {invoice.invoiceNumber || "No invoice number"} | {formatMaybeDate(invoice.invoiceDate)}
                      </p>
                      <p className="mt-1 text-xs leading-5 text-muted">Inventory: {getInvoiceInventoryStatus(invoice)}</p>
                    </div>
                    <Badge tone={invoice.status === "Ready" ? "success" : "warning"}>{invoice.status}</Badge>
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-3 text-sm text-slate-700">
                    <span>{formatMaybeCurrency(invoice.totalAmount)}</span>
                    <span className="text-xs font-semibold uppercase tracking-wide text-brand-700">Open</span>
                  </div>
                </button>
              ))}
            </div>
            <div className="hidden sm:block">
              <DataTable columns={recentInvoiceColumns} data={recentInvoicePreview.visibleInvoices} getRowKey={(row) => row.id} />
            </div>
          </Card>

          <Card className="p-5">
            <SectionHeader title="Recent price changes" description="Only conservative matches from saved invoice history are shown." />
            <div className="space-y-3 sm:hidden">
              {priceChanges.slice(0, 5).map((change) => (
                <div key={change.id} className="rounded-xl border border-line bg-white p-4 shadow-soft">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-ink">{change.itemName}</p>
                      <p className="mt-1 text-xs leading-5 text-muted">{change.supplier} | {formatDate(change.invoiceDate)}</p>
                    </div>
                    <Badge tone={change.status === "Increased" ? "danger" : change.status === "Decreased" ? "success" : "neutral"}>{formatPercent(change.changePercent)}</Badge>
                  </div>
                  <div className="mt-3 grid gap-2 text-sm text-slate-700 sm:grid-cols-2">
                    <div className="rounded-lg bg-slate-50 px-3 py-2">
                      <p className="text-[10px] font-bold uppercase tracking-wide text-muted">Previous</p>
                      <p className="mt-1 font-semibold text-ink">{formatCurrency(change.previousPrice)}</p>
                      <p className="mt-1 text-xs text-muted">{formatDate(change.previousInvoiceDate)}</p>
                    </div>
                    <div className="rounded-lg bg-slate-50 px-3 py-2">
                      <p className="text-[10px] font-bold uppercase tracking-wide text-muted">Current</p>
                      <p className="mt-1 font-semibold text-ink">{formatCurrency(change.currentPrice)}</p>
                      <p className="mt-1 text-xs text-muted">{formatDate(change.invoiceDate)}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="hidden sm:block">
              <DataTable columns={priceChangeColumns} data={priceChanges.slice(0, 5)} getRowKey={(row) => row.id} />
            </div>
          </Card>
        </div>

        {showAllInvoices && recentInvoicePreview.hasMore ? (
          <Card className="p-5">
            <SectionHeader title="All invoices" description="Every saved invoice in this browser, newest first." />
            <div className="space-y-3 sm:hidden">
              {recentInvoices.map((invoice) => (
                <button
                  key={invoice.id}
                  type="button"
                  className="w-full rounded-xl border border-line bg-white p-4 text-left shadow-soft transition hover:bg-slate-50"
                  onClick={() => openInvoice(invoice)}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-ink">{invoice.supplier}</p>
                      <p className="mt-1 text-xs leading-5 text-muted">
                        {invoice.invoiceNumber || "No invoice number"} | {formatMaybeDate(invoice.invoiceDate)}
                      </p>
                      <p className="mt-1 text-xs leading-5 text-muted">Inventory: {getInvoiceInventoryStatus(invoice)}</p>
                    </div>
                    <Badge tone={invoice.status === "Ready" ? "success" : "warning"}>{invoice.status}</Badge>
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-3 text-sm text-slate-700">
                    <span>{formatMaybeCurrency(invoice.totalAmount)}</span>
                    <span className="text-xs font-semibold uppercase tracking-wide text-brand-700">Open</span>
                  </div>
                </button>
              ))}
            </div>
            <div className="hidden sm:block">
              <DataTable columns={recentInvoiceColumns} data={recentInvoices} getRowKey={(row) => row.id} />
            </div>
          </Card>
        ) : null}

        <Card className="surface-panel p-5">
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

      <InvoiceReviewModal
        open={invoiceModalOpen}
        draft={draft}
        errorMessage={errorMessage}
        isProcessing={isProcessing}
        isSaving={isSaving}
        onClose={handleCloseReviewModal}
        onConfirm={() => setDraft((current) => ({ ...current, confirmed: true }))}
        onSave={handleSave}
        setDraft={setDraft}
        uncertainFields={uncertainFields}
        lineItemsNeedingReview={lineItemsNeedingReview}
        onAddLineItem={addLineItem}
        onRemoveLineItem={removeLineItem}
        savedInvoice={savedInvoicePrompt}
        onReceiveSavedInvoice={handleReceiveSavedInvoice}
        onSkipSavedInvoice={handleSkipSavedInvoice}
      />

      <PilotInvoiceDetailsModal
        open={Boolean(selectedInvoice)}
        invoice={selectedInvoice}
        inventoryStatus={selectedInvoiceInventoryStatus}
        onClose={() => setSelectedInvoiceId(null)}
        onReopenInReview={(invoice) => {
          setSelectedInvoiceId(null);
          reopenInvoiceForReview(invoice);
        }}
        onReceiveIntoInventory={(invoice) => {
          setSelectedInvoiceId(null);
          navigate(`${buildDemoPath(defaultDemoProfileSlug, "inventory")}?receive=${encodeURIComponent(invoice.id)}`);
        }}
      />
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
  showConfidence = true,
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
  showConfidence?: boolean;
}) {
  const tone = confidenceTone(confidence, needsReview);
  const flagged = needsReview || confidence < confidenceThreshold;

  return (
    <label className="block min-w-0">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
        <span className="text-xs font-bold uppercase tracking-wide text-muted">{label}</span>
        {showConfidence ? <Badge tone={tone}>{confidenceLabel(confidence, needsReview)}</Badge> : null}
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
          confidence={item.confidence}
          needsReview={item.needsReview}
          helper="Product or service name shown on the invoice."
          showConfidence={false}
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
          confidence={item.confidence}
          needsReview={item.needsReview}
          helper="Units on the invoice."
          showConfidence={false}
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
          showConfidence={false}
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
          showConfidence={false}
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

export function InvoiceReviewModal({
  open,
  draft,
  errorMessage,
  isProcessing,
  isSaving,
  onClose,
  onConfirm,
  onSave,
  setDraft,
  uncertainFields,
  lineItemsNeedingReview,
  onAddLineItem,
  onRemoveLineItem,
  savedInvoice,
  onReceiveSavedInvoice,
  onSkipSavedInvoice,
}: {
  open: boolean;
  draft: PilotInvoiceDraft;
  errorMessage: string;
  isProcessing: boolean;
  isSaving: boolean;
  onClose: () => void;
  onConfirm: () => void;
  onSave: () => void;
  setDraft: Dispatch<SetStateAction<PilotInvoiceDraft>>;
  uncertainFields: string[];
  lineItemsNeedingReview: number;
  onAddLineItem: () => void;
  onRemoveLineItem: (index: number) => void;
  savedInvoice?: PilotInvoiceRecord | null;
  onReceiveSavedInvoice?: (invoice: PilotInvoiceRecord) => void;
  onSkipSavedInvoice?: (invoice: PilotInvoiceRecord) => void;
}) {
  useEffect(() => {
    if (!open) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose, open]);

  const isSavedState = Boolean(savedInvoice);
  const [selectedLineItemIds, setSelectedLineItemIds] = useState<string[]>([]);

  useEffect(() => {
    setSelectedLineItemIds([]);
  }, [open, isSavedState]);

  if (!open) {
    return null;
  }

  const closeOnBackdrop = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) {
      onClose();
    }
  };

  const toggleLineItemSelection = (index: number) => {
    const id = draft.lineItems[index]?.id;
    if (!id) {
      return;
    }

    setSelectedLineItemIds((current) => (current.includes(id) ? current.filter((candidate) => candidate !== id) : [...current, id]));
  };

  const removeSelectedLineItems = () => {
    const selected = new Set(selectedLineItemIds);
    if (!selected.size) {
      return;
    }

    setDraft((current) => ({
      ...current,
      confirmed: false,
      lineItems: current.lineItems.filter((item) => !selected.has(item.id)),
    }));
    setSelectedLineItemIds([]);
  };

  const removeLowConfidenceLineItems = () => {
    setDraft((current) => ({
      ...current,
      confirmed: false,
      lineItems: current.lineItems.filter((item) => item.confidence >= confidenceThreshold),
    }));
    setSelectedLineItemIds([]);
  };

  const clearAllLineItems = () => {
    setDraft((current) => ({
      ...current,
      confirmed: false,
      lineItems: [],
    }));
    setSelectedLineItemIds([]);
  };

  if (isSavedState && savedInvoice) {
    return (
      <div className="fixed inset-0 z-50 bg-slate-950/55 p-0 sm:p-4" onMouseDown={closeOnBackdrop} role="dialog" aria-modal="true">
        <div className="mx-auto flex h-full w-full max-w-4xl flex-col overflow-hidden bg-slate-50 shadow-2xl sm:max-h-[92vh] sm:rounded-2xl">
          <div className="flex items-start justify-between gap-4 border-b border-line bg-white p-4 sm:p-5">
            <div className="min-w-0">
              <p className="text-xs font-bold uppercase tracking-wide text-muted">Invoice saved</p>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-bold text-ink sm:text-xl">{savedInvoice.supplier || "Saved invoice"}</h2>
                <Badge tone="success">Saved</Badge>
                <Badge tone="info">{savedInvoice.extractionProvider || "manual"}</Badge>
              </div>
              <p className="mt-1 text-sm leading-6 text-muted">
                The record is stored locally. Choose whether to receive it into inventory now or skip it for the moment.
              </p>
            </div>
            <Button type="button" variant="ghost" icon={<X className="h-4 w-4" />} onClick={onClose}>
              Close
            </Button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="space-y-5 p-4 sm:p-5">
              <Card className="surface-panel p-5">
                <div className="grid gap-4 lg:grid-cols-2">
                  <div className="space-y-3">
                    <SummaryRow label="Supplier" value={savedInvoice.supplier || "Unknown supplier"} />
                    <SummaryRow label="Invoice number" value={savedInvoice.invoiceNumber || "Not saved"} />
                    <SummaryRow label="Invoice date" value={savedInvoice.invoiceDate ? formatDate(savedInvoice.invoiceDate) : "Not saved"} />
                    <SummaryRow label="Total" value={formatCurrency(savedInvoice.totalAmount)} />
                  </div>
                  <div className="space-y-3">
                    <SummaryRow label="Saved status" value={savedInvoice.confirmed ? "Confirmed" : "Needs review"} />
                    <SummaryRow label="Saved at" value={savedInvoice.savedAt ? formatDateTime(savedInvoice.savedAt) : "Just now"} />
                    <SummaryRow label="Source file" value={savedInvoice.fileName || "Not available"} />
                    <SummaryRow label="Line items" value={String(savedInvoice.lineItems.length)} />
                  </div>
                </div>
              </Card>

              <div className="rounded-xl border border-brand-100 bg-brand-50/60 p-4">
                <p className="text-sm font-semibold text-ink">Next step</p>
                <p className="mt-1 text-sm leading-6 text-muted">Receiving now will open the saved invoice in the inventory workflow without running OCR again.</p>
                <div className="mt-4 flex flex-wrap gap-3">
                  <Button type="button" variant="secondary" onClick={() => onReceiveSavedInvoice?.(savedInvoice)}>
                    Receive into inventory
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => onSkipSavedInvoice?.(savedInvoice)}>
                    Skip for now
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/55 p-0 sm:p-4" onMouseDown={closeOnBackdrop} role="dialog" aria-modal="true">
      <div className="mx-auto flex h-full w-full max-w-7xl flex-col overflow-hidden bg-slate-50 shadow-2xl sm:max-h-[92vh] sm:rounded-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-line bg-white p-4 sm:p-5">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-wide text-muted">Focused review step</p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-bold text-ink sm:text-xl">Review extracted invoice</h2>
              <Badge tone={draft.confirmed ? "success" : "warning"}>{draft.confirmed ? "Confirmed" : "Needs review"}</Badge>
              <Badge tone="info">{draft.extractionProvider || "manual"}</Badge>
            </div>
            <p className="mt-1 text-sm leading-6 text-muted">
              Confirm or correct the extracted fields before saving. Closing this panel keeps your draft on the page.
            </p>
          </div>
          <Button type="button" variant="ghost" icon={<X className="h-4 w-4" />} onClick={onClose}>
            Close
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="p-4 sm:p-5">
            {errorMessage ? (
              <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm leading-6 text-red-800" role="alert">
                <div className="flex items-center gap-2 font-semibold">
                  <AlertTriangle className="h-4 w-4" />
                  OCR or upload problem
                </div>
                <p className="mt-1">{errorMessage}</p>
              </div>
            ) : null}

            <Card className="surface-panel min-w-0 p-5 sm:p-6">
              <SectionHeader
                title="Extracted invoice review"
                description="The OCR output is a starting point. Review the metadata, line items, notes, and raw text before saving."
                action={<Badge tone="info">Single-restaurant pilot</Badge>}
              />

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
                  label="Line items"
                  value={String(draft.lineItems.length)}
                  helper="Conservative matches only"
                />
                <MetricCard
                  label="Status"
                  value={draft.status}
                  helper="Save only after review"
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
                    <div className="flex flex-wrap gap-2">
                      {selectedLineItemIds.length ? (
                        <Button type="button" variant="ghost" icon={<Trash2 className="h-4 w-4" />} onClick={removeSelectedLineItems}>
                          Remove selected ({selectedLineItemIds.length})
                        </Button>
                      ) : null}
                      <Button type="button" variant="ghost" onClick={removeLowConfidenceLineItems}>
                        Remove low-confidence rows
                      </Button>
                      <Button type="button" variant="ghost" onClick={clearAllLineItems}>
                        Clear all line items
                      </Button>
                      <Button type="button" variant="secondary" icon={<Plus className="h-4 w-4" />} onClick={onAddLineItem}>
                        Add line item
                      </Button>
                    </div>
                  }
                />

                {draft.lineItems.length ? (
                  <div className="space-y-4">
                    {draft.lineItems.map((item, index) => (
                      <InvoiceLineItemCardView
                        key={item.id}
                        item={item}
                        index={index}
                        setDraft={setDraft}
                        onRemove={onRemoveLineItem}
                        selected={selectedLineItemIds.includes(item.id)}
                        onToggleSelected={toggleLineItemSelection}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-line bg-slate-50 p-4">
                    <p className="text-sm font-semibold text-ink">No line items remain.</p>
                    <p className="mt-1 text-sm leading-6 text-muted">Add a manual row to continue, or load another invoice if the OCR result was too noisy.</p>
                    <div className="mt-3">
                      <Button type="button" variant="secondary" icon={<Plus className="h-4 w-4" />} onClick={onAddLineItem}>
                        Add line item
                      </Button>
                    </div>
                  </div>
                )}
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

              <div className="mt-6 rounded-xl border border-line bg-slate-50 p-4">
                <p className="text-xs font-bold uppercase tracking-wide text-muted">Original document</p>
                <p className="mt-2 text-xs leading-5 text-muted">Review the uploaded file alongside the extracted fields. The preview stays local in this browser session.</p>
                {draft.sourceDocumentUrl ? (
                  <div className="mt-3 overflow-hidden rounded-lg border border-line bg-white">
                    {draft.sourceDocumentType?.includes("pdf") ? (
                      <iframe className="h-[60vh] w-full bg-white" src={draft.sourceDocumentUrl} title={`${draft.fileName || "Invoice"} original document`} />
                    ) : (
                      <img className="max-h-[60vh] w-full object-contain bg-white" src={draft.sourceDocumentUrl} alt={`${draft.fileName || "Invoice"} original document`} />
                    )}
                  </div>
                ) : (
                  <p className="mt-3 text-sm leading-6 text-slate-700">No original document preview is available for this upload.</p>
                )}
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
                    onClick={onSave}
                    disabled={!draft.confirmed || isProcessing || isSaving || !draft.fileName}
                  >
                    {isSaving ? "Saving..." : "Confirm and save"}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    icon={<CheckCircle2 className="h-4 w-4" />}
                    onClick={onConfirm}
                    disabled={isProcessing}
                  >
                    Mark reviewed
                  </Button>
                </div>
              </div>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
