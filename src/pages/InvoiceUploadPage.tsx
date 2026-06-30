import { AlertTriangle, FileUp, Loader2, Plus, Save, Sparkles, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type Dispatch, type MouseEvent, type ReactNode, type SetStateAction } from "react";
import { useNavigate } from "react-router-dom";
import { Badge, type BadgeTone } from "../components/Badge";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { InvoiceLineItemCard as InvoiceLineItemCardView } from "../components/InvoiceLineItemCard";
import { PilotInvoiceDetailsModal } from "../components/PilotInvoiceDetailsModal";
import { PageLayout } from "../components/PageLayout";
import { SectionHeader } from "../components/SectionHeader";
import { buildInvoiceSaveConfirmation, createDraftFromInvoice, getDraftSummaryDisplay } from "../lib/invoiceHistory";
import { captureInvoiceDocument, isSupportedInvoiceUpload } from "../lib/invoiceCapture";
import { formatLineConfidence, getLineTotalReviewState, normalizeComparisonKey as normalizeLineItemKey, updateLineItemDescription } from "../lib/invoiceLineItemView";
import { useDemoProfile } from "../lib/demoProfile";
import { buildExportReadinessModel } from "../lib/demoReadiness";
import { buildDemoRestaurantInvoiceDraft } from "../lib/invoiceSamples";
import { buildInvoiceReceiveLines, summarizeInvoiceInventoryStatus } from "../lib/invoiceInventory";
import { getRecentInvoicePreview, sortInvoicesNewestFirst, usePilotWorkspace } from "../lib/pilotWorkspace";
import type { InvoiceFieldConfidence, InventoryInvoiceReceipt, PilotInvoiceDraft, PilotInvoiceLineItem, PilotInvoiceRecord, PilotPriceChangeRecord } from "../types";
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

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1).getTime();
}

function startOfNextMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 1).getTime();
}

function buildSupplierSpendRows(invoices: PilotInvoiceRecord[]) {
  const now = new Date();
  const currentMonthStart = startOfMonth(now);
  const nextMonthStart = startOfNextMonth(now);
  const previousMonthStart = startOfMonth(new Date(now.getFullYear(), now.getMonth() - 1, 1));

  const bySupplier = new Map<string, { currentSpend: number; currentCount: number; previousSpend: number }>();

  for (const invoice of invoices) {
    const invoiceTime = new Date(invoice.invoiceDate).getTime();
    const current = bySupplier.get(invoice.supplier) ?? { currentSpend: 0, currentCount: 0, previousSpend: 0 };

    if (invoiceTime >= currentMonthStart && invoiceTime < nextMonthStart) {
      current.currentSpend += invoice.totalAmount;
      current.currentCount += 1;
    } else if (invoiceTime >= previousMonthStart && invoiceTime < currentMonthStart) {
      current.previousSpend += invoice.totalAmount;
    }

    bySupplier.set(invoice.supplier, current);
  }

  return [...bySupplier.entries()]
    .map(([supplier, totals]) => {
      const changePercent = totals.previousSpend > 0 ? ((totals.currentSpend - totals.previousSpend) / totals.previousSpend) * 100 : 0;
      return {
        supplier,
        monthSpend: totals.currentSpend,
        invoiceCount: totals.currentCount,
        trendLabel: totals.previousSpend > 0 ? `${formatPercent(changePercent)} vs prior month` : "No prior month data",
      };
    })
    .sort((a, b) => b.monthSpend - a.monthSpend)
    .slice(0, 4);
}

function getInvoiceExportStatus(invoice: PilotInvoiceRecord, inventoryReceipts: InventoryInvoiceReceipt[]) {
  const inventoryStatus = summarizeInvoiceInventoryStatus(invoice, inventoryReceipts);
  if (invoice.status !== "Ready") {
    return "Needs review";
  }
  if (inventoryStatus === "Not received") {
    return "Needs mapping";
  }
  return "Ready for CSV";
}

function buildPurchaseExportSnapshot(recentInvoices: PilotInvoiceRecord[], inventoryReceipts: InventoryInvoiceReceipt[]) {
  const readyForCsv = recentInvoices.filter((invoice) => getInvoiceExportStatus(invoice, inventoryReceipts) === "Ready for CSV").length;
  const needsReview = recentInvoices.filter((invoice) => invoice.status !== "Ready").length;
  const needsMapping = recentInvoices.filter((invoice) => invoice.status === "Ready" && summarizeInvoiceInventoryStatus(invoice, inventoryReceipts) === "Not received").length;

  return {
    readyForCsv,
    needsReview,
    needsMapping,
  };
}

export function InvoiceUploadPage() {
  const demo = useDemoProfile();
  const { saveInvoice, recentInvoices, reviewQueue, priceChanges, summary, inventoryItems, inventoryMappings, inventoryReceipts, reconciliations, updateInvoiceInventoryStatus } = usePilotWorkspace();
  const [draft, setDraft] = useState<PilotInvoiceDraft>(() => createBlankDraft());
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [reviewOpen, setReviewOpen] = useState(false);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);
  const [purchaseHistoryModalOpen, setPurchaseHistoryModalOpen] = useState(false);
  const [priceChangesModalOpen, setPriceChangesModalOpen] = useState(false);
  const [mappingModalOpen, setMappingModalOpen] = useState(false);
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
  const purchaseHistoryInvoices = useMemo(() => sortInvoicesNewestFirst(recentInvoices), [recentInvoices]);
  const supplierSpendRows = useMemo(() => buildSupplierSpendRows(recentInvoices), [recentInvoices]);
  const purchaseExportSnapshot = useMemo(() => buildPurchaseExportSnapshot(recentInvoices, inventoryReceipts), [inventoryReceipts, recentInvoices]);
  const exportReadiness = useMemo(
    () =>
      buildExportReadinessModel({
        invoices: recentInvoices,
        inventoryReceipts,
        reconciliations,
        summary,
      }),
    [inventoryReceipts, recentInvoices, reconciliations, summary],
  );
  const currentMonthPriceChanges = useMemo(() => {
    const monthStart = startOfMonth(new Date());
    return priceChanges.filter((change) => new Date(change.invoiceDate).getTime() >= monthStart);
  }, [priceChanges]);
  const sortedCurrentMonthPriceChanges = useMemo(
    () => [...currentMonthPriceChanges].sort((a, b) => new Date(b.invoiceDate).getTime() - new Date(a.invoiceDate).getTime()),
    [currentMonthPriceChanges],
  );
  const activeInventoryInvoice = savedInvoicePrompt ?? selectedInvoice ?? recentInvoices[0] ?? null;
  const mappedItemCount = useMemo(
    () =>
      recentInvoices.reduce((count, invoice) => {
        const receiveLines = buildInvoiceReceiveLines(invoice.id, inventoryItems, inventoryMappings, inventoryReceipts, recentInvoices);
        return count + receiveLines.filter((line) => line.state !== "unmapped").length;
      }, 0),
    [inventoryItems, inventoryMappings, inventoryReceipts, recentInvoices],
  );
  const activeReceiveLines = useMemo(
    () => (activeInventoryInvoice ? buildInvoiceReceiveLines(activeInventoryInvoice.id, inventoryItems, inventoryMappings, inventoryReceipts, recentInvoices) : []),
    [activeInventoryInvoice, inventoryItems, inventoryMappings, inventoryReceipts, recentInvoices],
  );
  const getInvoiceInventoryStatus = (invoice: PilotInvoiceRecord) => summarizeInvoiceInventoryStatus(invoice, inventoryReceipts);
  const selectedInvoiceInventoryStatus = selectedInvoice ? getInvoiceInventoryStatus(selectedInvoice) : null;
  const invoiceModalOpen = reviewOpen || Boolean(savedInvoicePrompt);
  const ocrUnavailable = errorMessage.startsWith("OCR backend is not configured");

  const openInvoice = (invoice: PilotInvoiceRecord) => {
    setSavedInvoicePrompt(null);
    setSelectedInvoiceId(invoice.id);
  };

  const reopenInvoiceForReview = (invoice: PilotInvoiceRecord) => {
    setSavedInvoicePrompt(null);
    setDraft(createDraftFromInvoice(invoice));
    setReviewOpen(true);
    setStatusMessage(`Editing saved purchase from ${invoice.supplier || "this supplier"}.`);
    setErrorMessage("");
  };

  const handleFileUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) {
      return;
    }

    setSelectedInvoiceId(null);
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
    setPurchaseHistoryModalOpen(false);
    setPriceChangesModalOpen(false);
    setMappingModalOpen(false);
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
      title="Purchases"
      eyebrow="Pilot workspace"
      description="Review incoming invoices, confirm item matches, and save clean purchase records."
    >
      <div className="grid gap-6">
        <Card className="surface-panel min-w-0 p-5 sm:p-6">
          <div className="flex flex-col gap-4 border-b border-line pb-5 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0">
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-brand-700">Purchases</p>
              <h1 className="mt-2 text-2xl font-bold text-ink sm:text-3xl">Review purchases before they update inventory.</h1>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <MetricCard label="Needs confirmation" value={String(reviewQueue.length + (hasActiveDraft ? 1 : 0))} helper="Open items" />
              <MetricCard label="Ready for inventory" value={String(mappedItemCount)} helper="Lines ready to receive" />
              <MetricCard label="CSV ready" value={String(purchaseExportSnapshot.readyForCsv)} helper="Reviewed purchase records" />
            </div>
          </div>

          <SectionHeader
            title="Upload and import"
            description="Upload a supplier invoice or receipt, then review extracted fields before saving."
            action={<Badge tone="info">OCR + manual review</Badge>}
          />

          <div className="rounded-xl border border-line bg-slate-50 p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-ink">Upload invoice or receipt</p>
                <p className="mt-1 text-sm leading-6 text-muted">Supported files: JPG, JPEG, PNG, WEBP, and PDF.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" icon={<FileUp className="h-4 w-4" />} onClick={() => fileInputRef.current?.click()} disabled={isProcessing}>
                  Choose file
                </Button>
                <Button type="button" variant="ghost" icon={<Sparkles className="h-4 w-4" />} onClick={loadSampleInvoice} disabled={isProcessing || isSaving}>
                  Load sample purchase
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
            <p className="mt-3 text-xs leading-5 text-muted">API keys stay on the backend, not in the browser.</p>
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
            <div
              className={`mt-4 rounded-lg px-4 py-3 text-sm leading-6 ${ocrUnavailable ? "border border-line bg-slate-50 text-slate-700" : "border border-red-200 bg-red-50 text-red-800"}`}
              role="alert"
            >
              <div className="flex items-center gap-2 font-semibold">
                <AlertTriangle className="h-4 w-4" />
                {ocrUnavailable ? "OCR unavailable in this environment" : "OCR or upload problem"}
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

          <div className="mt-5 grid gap-4 xl:grid-cols-2">
            {savedInvoicePrompt || hasActiveDraft ? (
            <>
            <Card className="min-w-0 border border-line bg-white p-5">
              <SectionHeader
                title="Review queue"
                description="These saved purchases still need confirmation before they are treated as final."
                action={<Badge tone="warning">{reviewQueue.length} items</Badge>}
              />
              {reviewQueue.length ? (
                <div className="space-y-3">
                  {reviewQueue.slice(0, 4).map((invoice) => (
                    <button
                      key={invoice.id}
                      type="button"
                      className="w-full rounded-xl border border-line bg-slate-50 p-4 text-left transition hover:bg-slate-100"
                      onClick={() => reopenInvoiceForReview(invoice)}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-bold text-ink">{invoice.supplier}</p>
                          <p className="mt-1 text-xs leading-5 text-muted">
                            {invoice.invoiceNumber || "No invoice number"} · {formatMaybeDate(invoice.invoiceDate)} · {formatMaybeCurrency(invoice.totalAmount)}
                          </p>
                        </div>
                        <Badge tone="warning">Needs confirmation</Badge>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted">
                        <span>{invoice.lineItems.length} line items</span>
                        <span>Receiving: {getInvoiceInventoryStatus(invoice)}</span>
                        <span>Export: {getInvoiceExportStatus(invoice, inventoryReceipts)}</span>
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-line bg-slate-50 p-4 text-sm leading-6 text-muted">
                  No saved purchases are waiting for review right now. Upload a new invoice or receipt to start the workflow.
                </div>
              )}
            </Card>

            <Card className="min-w-0 border border-line bg-white p-5">
              <SectionHeader
                title="Active review workspace"
                description="Review OCR fields, confirm line items, and save the purchase."
                action={
                  hasActiveDraft ? (
                    <Button type="button" variant="secondary" onClick={() => setReviewOpen(true)}>
                      {reviewOpen ? "Review open" : "Open review"}
                    </Button>
                  ) : null
                }
              />
              {savedInvoicePrompt ? (
                <div className="space-y-4 rounded-xl border border-brand-100 bg-brand-50/50 p-4">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wide text-muted">Saved purchase ready for inventory</p>
                    <p className="mt-1 text-base font-semibold text-ink">{savedInvoicePrompt.supplier || "Saved invoice"}</p>
                    <p className="mt-1 text-sm leading-6 text-muted">
                      {savedInvoicePrompt.invoiceNumber || "No invoice number"} · {formatMaybeDate(savedInvoicePrompt.invoiceDate)} · {formatMaybeCurrency(savedInvoicePrompt.totalAmount)}
                    </p>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-3">
                    <MetricCard label="Source document" value={savedInvoicePrompt.fileName || "Not stored"} helper="Original file name stays linked locally" />
                    <MetricCard label="Line items" value={String(savedInvoicePrompt.lineItems.length)} helper="Reviewed purchase lines" />
                    <MetricCard label="Receiving" value={getInvoiceInventoryStatus(savedInvoicePrompt)} helper="Inventory handoff status" />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="secondary" onClick={() => handleReceiveSavedInvoice(savedInvoicePrompt)}>
                      Map / receive into inventory
                    </Button>
                    <Button type="button" variant="ghost" onClick={() => handleSkipSavedInvoice(savedInvoicePrompt)}>
                      Skip receiving
                    </Button>
                  </div>
                </div>
              ) : hasActiveDraft ? (
                <div className="space-y-4 rounded-xl border border-brand-100 bg-brand-50/50 p-4">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wide text-muted">Focused review draft</p>
                    <p className="mt-1 text-base font-semibold text-ink">{draft.fileName || "Untitled draft"}</p>
                    <p className="mt-1 text-sm leading-6 text-muted">
                      {draft.supplier || "Supplier not confirmed"} · {draft.invoiceNumber || "No invoice number"} · {formatMaybeDate(draft.invoiceDate)}
                    </p>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-3">
                    <MetricCard label="Confidence" value={draftSummary.confidence} helper="Extracted fields still need confirmation" />
                    <MetricCard label="Review flags" value={String(draftSummary.reviewFlags)} helper="Fields and line items marked for attention" />
                    <MetricCard label="Line items" value={String(draft.lineItems.length)} helper={`${lineItemsNeedingReview} line items need attention`} />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="secondary" onClick={() => setReviewOpen(true)}>
                      Continue review
                    </Button>
                    <Button type="button" variant="ghost" onClick={handleResetDraft}>
                      Clear draft
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-line bg-slate-50 p-4 text-sm leading-6 text-muted">
                  Upload a new purchase to open the focused review workflow. The page keeps the saved history below so you can reopen older purchases anytime.
                </div>
              )}
            </Card>

            <Card className="min-w-0 border border-line bg-white p-5">
              <SectionHeader
                title="Match items to inventory"
                description="Map invoice lines before the purchase is saved."
                action={activeInventoryInvoice ? <Button type="button" variant="secondary" onClick={() => setMappingModalOpen(true)}>View all mappings</Button> : null}
              />
              {activeInventoryInvoice ? (
                <div className="space-y-3">
                  <div className="flex flex-wrap gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
                    <span>Ready: {activeReceiveLines.filter((line) => line.state === "linked").length}</span>
                    <span>Needs confirmation: {activeReceiveLines.filter((line) => line.state === "unmapped").length}</span>
                    <span>Completed: {activeReceiveLines.filter((line) => line.state === "already-received").length}</span>
                  </div>
                  <div className="space-y-2">
                    {activeReceiveLines.slice(0, 3).map((line) => (
                      <div key={line.invoiceLineItemId} className="rounded-xl border border-line bg-slate-50 p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-bold text-ink">{line.invoiceLineName}</p>
                            <p className="mt-0.5 text-xs leading-5 text-muted">{line.sourceDescription || "Original description not available"} - {formatCurrency(line.unitPrice)}</p>
                          </div>
                          <Badge tone={line.state === "linked" || line.state === "already-received" ? "success" : line.state === "do-not-track" ? "neutral" : "warning"}>
                            {line.state === "already-received" ? "Completed" : line.state === "linked" ? "Ready" : line.state === "do-not-track" ? "Completed" : "Needs confirmation"}
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                  <Button type="button" variant="secondary" onClick={() => navigate(buildDemoPath(defaultDemoProfileSlug, "inventory") + "?receive=" + encodeURIComponent(activeInventoryInvoice.id))}>Map / receive</Button>
                </div>
              ) : (
                <p className="text-sm leading-6 text-muted">Upload a purchase to see receiving status.</p>
              )}
            </Card>

            </>
            ) : (
              <p className="rounded-xl border border-dashed border-line bg-slate-50 p-4 text-sm leading-6 text-muted">Select a purchase to review extracted fields.</p>
            )}
          </div>

        </Card>

          <div className="grid gap-4 lg:grid-cols-2">
          <Card className="p-5">
            <SectionHeader
              title="Purchase history"
              action={recentInvoices.length > 3 ? <Button type="button" variant="secondary" onClick={() => setPurchaseHistoryModalOpen(true)}>View all purchases</Button> : null}
            />
            <div className="space-y-2">
              {recentInvoicePreview.visibleInvoices.slice(0, 4).map((invoice) => (
                <button key={invoice.id} type="button" className="w-full rounded-xl border border-line bg-white p-3 text-left transition hover:bg-slate-50" onClick={() => openInvoice(invoice)}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-ink">{invoice.supplier}</p>
                      <p className="mt-0.5 text-xs leading-5 text-muted">{invoice.invoiceNumber || "No invoice number"} · {formatMaybeDate(invoice.invoiceDate)} · {formatMaybeCurrency(invoice.totalAmount)}</p>
                    </div>
                    <Badge tone={invoice.status === "Ready" ? "success" : "warning"}>{invoice.status}</Badge>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
                    <span>Receiving: {getInvoiceInventoryStatus(invoice)}</span>
                    <span>Export: {getInvoiceExportStatus(invoice, inventoryReceipts)}</span>
                    <span>{invoice.lineItems.length} items</span>
                  </div>
                </button>
              ))}
            </div>
          </Card>

          <Card className="p-5">
            <SectionHeader
              title="Price-change alerts"
              action={currentMonthPriceChanges.length > 3 ? <Button type="button" variant="secondary" onClick={() => setPriceChangesModalOpen(true)}>View all price changes</Button> : null}
            />
            <div className="space-y-2">
              {sortedCurrentMonthPriceChanges.slice(0, 3).map((change) => (
                <div key={change.id} className="rounded-xl border border-line bg-white p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-ink">{change.itemName}</p>
                      <p className="mt-0.5 text-xs leading-5 text-muted">{change.supplier} · {formatDate(change.invoiceDate)}</p>
                    </div>
                    <Badge tone={change.status === "Increased" ? "danger" : change.status === "Decreased" ? "success" : "neutral"}>{formatPercent(change.changePercent)}</Badge>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted">
                    <span>Prev {formatCurrency(change.previousPrice)}</span>
                    <span>Now {formatCurrency(change.currentPrice)}</span>
                    <span>{formatDate(change.previousInvoiceDate)} → {formatDate(change.invoiceDate)}</span>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          <Card className="p-5">
            <SectionHeader title="Supplier spend" />
            {supplierSpendRows.length ? (
              <div className="space-y-2">
                <div className="flex items-start justify-between gap-3 rounded-xl border border-line bg-slate-50 p-3">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-ink">{supplierSpendRows[0].supplier}</p>
                    <p className="mt-0.5 text-xs leading-5 text-muted">{supplierSpendRows[0].invoiceCount} invoices this month</p>
                  </div>
                  <Badge tone={supplierSpendRows[0].monthSpend > 0 ? "success" : "neutral"}>{formatCurrency(supplierSpendRows[0].monthSpend)}</Badge>
                </div>
                <p className="text-xs leading-5 text-muted">{supplierSpendRows[0].trendLabel}</p>
              </div>
            ) : (
              <p className="text-sm leading-6 text-muted">No supplier spend yet.</p>
            )}
          </Card>
          <Card className="p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <SectionHeader title="Bookkeeping handoff" />
                <p className="mt-1 text-sm leading-6 text-muted">Final CSV export lives in Close &amp; Reports.</p>
              </div>
              <Button type="button" variant="secondary" onClick={() => navigate(buildDemoPath(defaultDemoProfileSlug, "close-reports"))}>Open Close &amp; Reports</Button>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Badge tone={purchaseExportSnapshot.readyForCsv > 0 ? "success" : "neutral"}>CSV ready {purchaseExportSnapshot.readyForCsv}</Badge>
              <Badge tone={purchaseExportSnapshot.needsReview > 0 ? "warning" : "neutral"}>Needs review {purchaseExportSnapshot.needsReview}</Badge>
              <Badge tone={purchaseExportSnapshot.needsMapping > 0 ? "warning" : "neutral"}>Needs mapping {purchaseExportSnapshot.needsMapping}</Badge>
              <Badge tone="info">QuickBooks future-only</Badge>
            </div>
          </Card>
        </div>

        <Card className="surface-panel p-5">
          <div className="flex items-start gap-4">
            <div className="rounded-lg bg-slate-100 p-3 text-slate-700">
              <FileUp className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-muted">Local storage</p>
              <p className="mt-2 text-sm leading-6 text-slate-700">Saved invoices are stored in this browser only. Refreshing the page should keep the data, and clearing browser storage will remove it.</p>
              <p className="mt-3 text-sm text-muted">{summary.invoiceCount} invoices stored locally.</p>
            </div>
          </div>
        </Card>
      </div>

      <ListOverlayModal
        open={purchaseHistoryModalOpen}
        title="All purchases"
        description="Newest saved purchases first. Open a row to inspect or reopen it."
        onClose={() => setPurchaseHistoryModalOpen(false)}
      >
        <div className="space-y-2">
          {purchaseHistoryInvoices.map((invoice) => (
            <button
              key={invoice.id}
              type="button"
              className="w-full rounded-xl border border-line bg-white p-3 text-left transition hover:bg-slate-50"
              onClick={() => {
                setPurchaseHistoryModalOpen(false);
                openInvoice(invoice);
              }}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-ink">{invoice.supplier}</p>
                  <p className="mt-0.5 text-xs leading-5 text-muted">
                    {invoice.invoiceNumber || "No invoice number"} · {formatMaybeDate(invoice.invoiceDate)} · {formatMaybeCurrency(invoice.totalAmount)}
                  </p>
                </div>
                <Badge tone={invoice.status === "Ready" ? "success" : "warning"}>{invoice.status}</Badge>
              </div>
              <div className="mt-2 flex flex-wrap gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
                <span>Receiving: {getInvoiceInventoryStatus(invoice)}</span>
                <span>Export: {getInvoiceExportStatus(invoice, inventoryReceipts)}</span>
                <span>{invoice.lineItems.length} items</span>
              </div>
            </button>
          ))}
        </div>
      </ListOverlayModal>

      <ListOverlayModal
        open={priceChangesModalOpen}
        title="All price changes"
        description="Newest detected price changes first."
        onClose={() => setPriceChangesModalOpen(false)}
      >
        <div className="space-y-2">
          {currentMonthPriceChanges.length ? (
            sortedCurrentMonthPriceChanges.map((change) => (
              <div key={change.id} className="rounded-xl border border-line bg-white p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-ink">{change.itemName}</p>
                    <p className="mt-0.5 text-xs leading-5 text-muted">
                      {change.supplier} · {formatDate(change.invoiceDate)}
                    </p>
                  </div>
                  <Badge tone={change.status === "Increased" ? "danger" : change.status === "Decreased" ? "success" : "neutral"}>{formatPercent(change.changePercent)}</Badge>
                </div>
                <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted">
                  <span>Prev {formatCurrency(change.previousPrice)}</span>
                  <span>Now {formatCurrency(change.currentPrice)}</span>
                  <span>
                    {formatDate(change.previousInvoiceDate)} → {formatDate(change.invoiceDate)}
                  </span>
                </div>
              </div>
            ))
          ) : (
            <div className="rounded-xl border border-dashed border-line bg-slate-50 p-4 text-sm leading-6 text-muted">No price changes detected this month yet.</div>
          )}
        </div>
      </ListOverlayModal>

      <ListOverlayModal
        open={mappingModalOpen}
        title="All mapping and receiving"
        description="These lines can be mapped or received into inventory."
        onClose={() => setMappingModalOpen(false)}
      >
        {activeInventoryInvoice ? (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
              <span>Ready: {activeReceiveLines.filter((line) => line.state === "linked").length}</span>
              <span>Needs confirmation: {activeReceiveLines.filter((line) => line.state === "unmapped").length}</span>
              <span>Completed: {activeReceiveLines.filter((line) => line.state === "already-received").length}</span>
            </div>
            <div className="space-y-2">
              {activeReceiveLines.map((line) => (
                <div key={line.invoiceLineItemId} className="rounded-xl border border-line bg-white p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-ink">{line.invoiceLineName}</p>
                      <p className="mt-0.5 text-xs leading-5 text-muted">
                        {line.sourceDescription || "Original description not available"} · {formatCurrency(line.unitPrice)}
                      </p>
                    </div>
                    <Badge tone={line.state === "linked" || line.state === "already-received" ? "success" : line.state === "do-not-track" ? "neutral" : "warning"}>
                      {line.state === "already-received" ? "Completed" : line.state === "linked" ? "Ready" : line.state === "do-not-track" ? "Completed" : "Needs confirmation"}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-line bg-slate-50 p-4 text-sm leading-6 text-muted">Upload or open a purchase to view mapping status.</div>
        )}
      </ListOverlayModal>

      <InvoiceReviewModal
        open={invoiceModalOpen}
        draft={draft}
        errorMessage={errorMessage}
        isProcessing={isProcessing}
        isSaving={isSaving}
        onClose={handleCloseReviewModal}
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

function ListOverlayModal({
  open,
  title,
  description,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  description: string;
  onClose: () => void;
  children: ReactNode;
}) {
  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/50 p-3 sm:items-center sm:p-6" role="dialog" aria-modal="true">
      <div className="w-full max-w-4xl overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-line p-4 sm:p-5">
          <div>
            <h2 className="text-lg font-bold text-ink">{title}</h2>
            <p className="mt-1 text-sm leading-6 text-muted">{description}</p>
          </div>
          <Button type="button" variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
        <div className="max-h-[75vh] overflow-y-auto p-4 sm:p-5">{children}</div>
      </div>
    </div>
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
                    <SummaryRow label="Saved status" value={savedInvoice.confirmed ? "Confirmed" : "Needs confirmation"} />
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
              <Badge tone={draft.confirmed ? "success" : "warning"}>{draft.confirmed ? "Confirmed" : "Needs confirmation"}</Badge>
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
                    <SummaryRow label="Needs confirmation" value={String(uncertainFields.length + lineItemsNeedingReview)} />
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
                    I reviewed the extracted fields and item matches. Saving will complete this purchase record.
                  </span>
                </label>
                <div className="mt-4 flex flex-wrap gap-3">
                  <Button
                    type="button"
                    icon={<Save className="h-4 w-4" />}
                    onClick={onSave}
                    disabled={!draft.confirmed || isProcessing || isSaving || !draft.fileName}
                  >
                    {isSaving ? "Saving..." : "Save purchase"}
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
