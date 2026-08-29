import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { ArrowRight, CheckCircle2, FileText, Plus, RefreshCcw, ShoppingBag } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { Badge } from "../components/Badge";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { SectionHeader } from "../components/SectionHeader";
import { WorkspaceTabs } from "./workspace/WorkspaceTabs";
import {
  createPilotPurchaseInvoice,
  correctPilotPurchaseInvoice,
  fetchPilotInventory,
  fetchPilotPurchases,
  fetchPilotPurchaseInvoice,
  receivePilotPurchaseInvoice,
  updatePilotPurchaseInvoice,
  type PilotInventoryItem,
  type PilotPurchaseInvoice,
  type PilotPurchasesResponse,
} from "./pilotApi";
import { formatDate, formatDateTime, formatMoney, formatNumber, statusTone } from "./workspace/pilotWorkspaceUtils";

interface DraftLine {
  id?: number;
  description: string;
  inventoryItemId: number | null;
  purchaseUnit: string;
  inventoryUnit: string;
  conversionFactor: number;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  confidence: number;
  needsReview: boolean;
  note: string;
}

interface PurchaseDraft {
  id: number | null;
  supplierName: string;
  invoiceNumber: string;
  invoiceDate: string;
  subtotal: number;
  tax: number;
  totalAmount: number;
  notes: string;
  status: string;
  sourceFileName: string;
  sourceFileType: string;
  extractionStatus: string;
  extractedText: string;
  lineItems: DraftLine[];
}

const commonUnits = ["each", "bag", "bottle", "box", "case", "dozen", "kg", "lb", "L", "ml", "pack", "roll", "tray"];

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function normalizeLookup(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function blankLine(): DraftLine {
  return {
    description: "",
    inventoryItemId: null,
    purchaseUnit: "each",
    inventoryUnit: "each",
    conversionFactor: 1,
    quantity: 1,
    unitPrice: 0,
    lineTotal: 0,
    confidence: 0.45,
    needsReview: true,
    note: "",
  };
}

function buildBlankDraft(): PurchaseDraft {
  return {
    id: null,
    supplierName: "",
    invoiceNumber: "",
    invoiceDate: todayIso(),
    subtotal: 0,
    tax: 0,
    totalAmount: 0,
    notes: "",
    status: "Draft",
    sourceFileName: "",
    sourceFileType: "",
    extractionStatus: "manual",
    extractedText: "",
    lineItems: [blankLine()],
  };
}

function invoiceToDraft(invoice: PilotPurchaseInvoice): PurchaseDraft {
  return {
    id: invoice.id,
    supplierName: invoice.supplier?.name ?? "",
    invoiceNumber: invoice.invoiceNumber,
    invoiceDate: invoice.invoiceDate,
    subtotal: invoice.subtotal,
    tax: invoice.tax,
    totalAmount: invoice.totalAmount,
    notes: invoice.notes,
    status: invoice.status,
    sourceFileName: invoice.sourceFileName,
    sourceFileType: invoice.sourceFileType,
    extractionStatus: invoice.extractionStatus,
    extractedText: invoice.extractedText,
    lineItems: invoice.lineItems.length
      ? invoice.lineItems.map((line) => ({
          id: line.id,
          description: line.description,
          inventoryItemId: line.inventoryItemId,
          purchaseUnit: line.purchaseUnit,
          inventoryUnit: line.inventoryUnit,
          conversionFactor: line.conversionFactor,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          lineTotal: line.lineTotal,
          confidence: line.confidence,
          needsReview: line.needsReview,
          note: line.note,
        }))
      : [blankLine()],
  };
}

type MappingHint = {
  inventoryItemId: number;
  purchaseUnit: string;
  inventoryUnit: string;
  conversionFactor: number;
};

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <span className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</span>
      <span className="min-w-0 break-words text-sm text-ink sm:max-w-56 sm:text-right">{value}</span>
    </div>
  );
}

function PurchaseInvoiceDetailsModal({
  invoice,
  onClose,
}: {
  invoice: PilotPurchaseInvoice | null;
  onClose: () => void;
}) {
  if (!invoice) {
    return null;
  }

  const closeOnBackdrop = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) {
      onClose();
    }
  };
  const receivedLabel = invoice.status === "Completed" ? "Received" : invoice.status;
  const statusToneOverride = invoice.status === "Completed" ? "success" : invoice.status === "Corrected" ? "warning" : statusTone(invoice.status);

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/55 p-0 sm:p-4" onMouseDown={closeOnBackdrop} role="dialog" aria-modal="true" data-testid="purchase-detail-modal">
      <div className="mx-auto flex h-full w-full max-w-6xl flex-col overflow-hidden bg-slate-50 shadow-2xl sm:max-h-[92vh] sm:rounded-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-line bg-white p-4 sm:p-5">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-wide text-muted">Purchase history</p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-bold text-ink sm:text-xl">{invoice.supplier?.name || "Unknown supplier"}</h2>
              <Badge tone={statusToneOverride}>{receivedLabel || "Read-only"}</Badge>
              <Badge tone="neutral">Read-only</Badge>
            </div>
            <p className="mt-1 text-sm leading-6 text-muted">This completed purchase is locked for review only. Save and receive actions stay disabled here.</p>
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
                  <SummaryRow label="Status" value={invoice.status} />
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
                      <SummaryRow label="Unit price" value={formatMoney(line.unitPrice)} />
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

export function PilotPurchasesPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const editorPanelRef = useRef<HTMLDivElement | null>(null);
  const [data, setData] = useState<PilotPurchasesResponse | null>(null);
  const [inventoryItems, setInventoryItems] = useState<PilotInventoryItem[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [draft, setDraft] = useState<PurchaseDraft>(buildBlankDraft());
  const [detailInvoice, setDetailInvoice] = useState<PilotPurchaseInvoice | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [receiveMessage, setReceiveMessage] = useState<string | null>(null);
  const [correctionNote, setCorrectionNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [purchasePanel, setPurchasePanel] = useState<"details" | "lines" | "review">("details");
  const requestedInvoiceId = useMemo(() => {
    const value = new URLSearchParams(location.search).get("invoiceId");
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }, [location.search]);
  const mappingHints = useMemo(() => {
    const hints = new Map<string, MappingHint>();
    for (const line of data?.purchaseLines ?? []) {
      if (!line.inventoryItemId || !line.supplierName || !line.description) {
        continue;
      }
      const key = `${normalizeLookup(line.supplierName)}|${normalizeLookup(line.description)}`;
      if (!hints.has(key)) {
        hints.set(key, {
          inventoryItemId: line.inventoryItemId,
          purchaseUnit: line.purchaseUnit || "each",
          inventoryUnit: line.inventoryUnit || "each",
          conversionFactor: line.conversionFactor || 1,
        });
      }
    }
    return hints;
  }, [data?.purchaseLines]);

  const load = async (preferredInvoiceId: number | null | undefined = requestedInvoiceId) => {
    setLoading(true);
    setError(null);

    try {
      const [purchases, inventory] = await Promise.all([fetchPilotPurchases(), fetchPilotInventory()]);
      setData(purchases);
      setInventoryItems(inventory.items);
      const resolvedInvoice = preferredInvoiceId ? purchases.invoices.find((invoice) => invoice.id === preferredInvoiceId) ?? null : null;
      if (resolvedInvoice && resolvedInvoice.status !== "Completed" && resolvedInvoice.status !== "Corrected") {
        setSelectedId(resolvedInvoice.id);
        setDraft(invoiceToDraft(resolvedInvoice));
        setDetailInvoice(null);
        setPurchasePanel("details");
      } else {
        setSelectedId(null);
        setDraft(buildBlankDraft());
        setDetailInvoice(resolvedInvoice && (resolvedInvoice.status === "Completed" || resolvedInvoice.status === "Corrected") ? resolvedInvoice : null);
        setPurchasePanel("details");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load purchases.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedInvoiceId]);

  const selectedInvoice = useMemo(
    () => data?.invoices?.find((invoice) => invoice.id === selectedId) ?? null,
    [data?.invoices, selectedId],
  );

  useEffect(() => {
    if (selectedInvoice) {
      setDraft(invoiceToDraft(selectedInvoice));
      setCorrectionNote("");
    }
  }, [selectedInvoice]);

  const closeDetailInvoice = () => {
    setDetailInvoice(null);
    navigate(location.pathname, { replace: true });
  };

  const invoiceRows = showAll ? data?.invoices ?? [] : (data?.invoices ?? []).slice(0, 5);
  const priceChanges = (data?.priceChanges ?? []).slice(0, 3);
  const finalizedStatus = draft.status === "Completed" || draft.status === "Corrected";
  const purchaseStatusLabel = finalizedStatus ? "Read-only purchase" : draft.id ? "Editable draft" : "New purchase";
  const mappedLineCount = draft.lineItems.filter((line) => line.inventoryItemId).length;
  const unresolvedLineCount = draft.lineItems.filter((line) => !line.inventoryItemId).length;
  const readyToReceive = !finalizedStatus && unresolvedLineCount === 0 && mappedLineCount > 0 && draft.lineItems.every((line) => line.conversionFactor > 0 && line.quantity > 0);
  const purchaseTabs = [
    { id: "details", label: "Details", badge: finalizedStatus ? "Locked" : "Core" },
    { id: "lines", label: "Invoice items", badge: `${draft.lineItems.length}` },
    { id: "review", label: "Review", badge: finalizedStatus ? draft.status : readyToReceive ? "Ready" : "Action" },
  ];

  const recalculateTotals = (lines: DraftLine[], nextTax = draft.tax) => {
    const subtotal = lines.reduce((sum, line) => sum + Number(line.lineTotal || line.quantity * line.unitPrice), 0);
    return {
      lineItems: lines,
      subtotal,
      totalAmount: subtotal + Number(nextTax || 0),
    };
  };

  const updateLine = (index: number, updater: (line: DraftLine) => DraftLine) => {
    setDraft((current) => ({
      ...current,
      ...recalculateTotals(current.lineItems.map((line, lineIndex) => (lineIndex === index ? updater(line) : line)), current.tax),
    }));
  };

  const setTax = (tax: number) => {
    setDraft((current) => ({
      ...current,
      tax,
      totalAmount: current.subtotal + tax,
    }));
  };

  const saveDraft = async (status: string) => {
    setSaving(true);
    setReceiveMessage(null);
    setError(null);

    try {
      if (status === "Ready" && unresolvedLineCount > 0) {
        throw new Error("Map every invoice item before marking the purchase ready.");
      }
      const payload = {
        supplierName: draft.supplierName,
        invoiceNumber: draft.invoiceNumber,
        invoiceDate: draft.invoiceDate,
        subtotal: draft.subtotal,
        tax: draft.tax,
        totalAmount: draft.totalAmount,
        notes: draft.notes,
        status,
        sourceFileName: draft.sourceFileName,
        sourceFileType: draft.sourceFileType,
        extractionStatus: draft.extractionStatus,
        extractedText: draft.extractedText,
        lineItems: draft.lineItems.map((line) => ({
          description: line.description,
          inventoryItemId: line.inventoryItemId,
          purchaseUnit: line.purchaseUnit,
          inventoryUnit: line.inventoryUnit,
          conversionFactor: line.conversionFactor,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          lineTotal: line.lineTotal || line.quantity * line.unitPrice,
          confidence: line.confidence,
          needsReview: line.needsReview,
          note: line.note,
        })),
      };
      const saved = draft.id ? await updatePilotPurchaseInvoice(draft.id, payload) : await createPilotPurchaseInvoice(payload);
      setSelectedId(saved.id);
      setDraft(invoiceToDraft(saved));
      setReceiveMessage(`Invoice ${saved.invoiceNumber} saved successfully.`);
      await load(saved.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the purchase.");
    } finally {
      setSaving(false);
    }
  };

  const receiveInvoice = async () => {
    if (!draft.id) {
      return;
    }
    if (!readyToReceive) {
      setError("Map every invoice item before receiving this purchase.");
      return;
    }
    setSaving(true);
    setReceiveMessage(null);
    setError(null);

    try {
      const received = await receivePilotPurchaseInvoice(draft.id);
      setSelectedId(null);
      setDraft(buildBlankDraft());
      setDetailInvoice(null);
      setPurchasePanel("details");
      setReceiveMessage(`Invoice ${received.invoiceNumber} received into inventory.`);
      navigate(location.pathname, { replace: true });
      await load(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not receive the purchase.");
    } finally {
      setSaving(false);
    }
  };

  const correctInvoice = async () => {
    if (!draft.id || draft.status !== "Completed") {
      return;
    }
    setSaving(true);
    setReceiveMessage(null);
    setError(null);

    try {
      const corrected = await correctPilotPurchaseInvoice(draft.id, {
        reason: correctionNote.trim() || "Inventory correction",
      });
      setSelectedId(corrected.id);
      setDraft(invoiceToDraft(corrected));
      setCorrectionNote("");
      setPurchasePanel("details");
      setReceiveMessage(`Invoice ${corrected.invoiceNumber} corrected and inventory movements were reversed.`);
      await load(corrected.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not record the correction.");
    } finally {
      setSaving(false);
    }
  };

  const openInvoice = async (invoiceId: number) => {
    setReceiveMessage(null);
    setError(null);
    setCorrectionNote("");
    const invoice = data?.invoices.find((entry) => entry.id === invoiceId) ?? (await fetchPilotPurchaseInvoice(invoiceId));
    if (invoice.status === "Completed" || invoice.status === "Corrected") {
      setSelectedId(null);
      setDraft(buildBlankDraft());
      setDetailInvoice(invoice);
      setPurchasePanel("details");
      return;
    }
    setDetailInvoice(null);
    setSelectedId(invoice.id);
    setDraft(invoiceToDraft(invoice));
    setPurchasePanel("details");
  };

  const addLine = () => {
    const next = [...draft.lineItems, blankLine()];
    setDraft((current) => ({ ...current, ...recalculateTotals(next, current.tax) }));
  };

  const applyMappingHint = (supplierName: string, description: string) => {
    const hint = mappingHints.get(`${normalizeLookup(supplierName)}|${normalizeLookup(description)}`);
    return hint ?? null;
  };

  const setLineDescription = (index: number, description: string) => {
    updateLine(index, (current) => {
      const next = { ...current, description };
      const hint = applyMappingHint(draft.supplierName, description);
      if (hint && !current.inventoryItemId) {
        return {
          ...next,
          inventoryItemId: hint.inventoryItemId,
          purchaseUnit: hint.purchaseUnit,
          inventoryUnit: hint.inventoryUnit,
          conversionFactor: hint.conversionFactor,
        };
      }
      return next;
    });
  };

  const setLineInventoryItem = (index: number, inventoryItemId: number | null, description: string) => {
    const selectedItem = inventoryItems.find((item) => item.id === inventoryItemId) ?? null;
    const hint = description ? applyMappingHint(draft.supplierName, description) : null;
    updateLine(index, (current) => ({
      ...current,
      inventoryItemId,
      inventoryUnit: hint?.inventoryUnit ?? selectedItem?.stockUnit ?? current.inventoryUnit,
      purchaseUnit: hint?.purchaseUnit ?? current.purchaseUnit,
      conversionFactor: hint?.conversionFactor ?? (current.conversionFactor || 1),
    }));
  };

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <Card className="surface-panel p-6 sm:p-7">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-brand-700">Purchases</p>
            <h1 className="mt-3 text-3xl font-bold tracking-tight text-ink sm:text-4xl">Capture invoices, confirm items, and move stock</h1>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-muted">This is the daily intake hub for supplier invoices and receipts. Saved purchases can be reviewed, mapped, received, and marked ready for export.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              icon={<Plus className="h-4 w-4" />}
              type="button"
              onClick={() => {
                setSelectedId(null);
                setReceiveMessage(null);
                setCorrectionNote("");
      setDraft(buildBlankDraft());
                setPurchasePanel("details");
                window.requestAnimationFrame(() => {
                  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
                  editorPanelRef.current?.scrollIntoView({ behavior: prefersReducedMotion ? "auto" : "smooth", block: "start" });
                });
              }}
            >
              New purchase
            </Button>
            <Button variant="secondary" icon={<RefreshCcw className="h-4 w-4" />} type="button" onClick={() => void load()}>
              Refresh
            </Button>
          </div>
        </div>

        {error ? <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{error}</div> : null}
        {receiveMessage ? <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">{receiveMessage}</div> : null}

        <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {[
            { label: "This month spend", value: formatMoney(data?.summary?.thisMonthSpend ?? 0) },
            { label: "Uploads needing review", value: formatNumber(data?.summary?.uploadsNeedingReview ?? 0) },
            { label: "Price changes flagged", value: formatNumber(data?.summary?.priceChangesFlagged ?? 0) },
            { label: "Mapped items", value: formatNumber(data?.summary?.mappedItems ?? 0) },
            { label: "Export ready", value: formatNumber(data?.summary?.exportReady ?? 0) },
          ].map((metric) => (
            <div key={metric.label} className="rounded-2xl border border-line bg-white p-4">
              <p className="text-xs font-bold uppercase tracking-wide text-muted">{metric.label}</p>
              <p className="mt-2 text-2xl font-bold text-ink">{metric.value}</p>
            </div>
          ))}
        </div>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(320px,0.85fr)]">
        <div ref={editorPanelRef} className="scroll-mt-32">
          <Card hidden={!!detailInvoice} aria-hidden={detailInvoice ? "true" : undefined} className={detailInvoice ? "hidden" : "w-full p-6"} data-testid="purchase-editor-card">
            <div className="flex flex-col gap-4 border-b border-line pb-5 sm:flex-row sm:items-start sm:justify-between">
              <SectionHeader
                title={draft.id ? `Review ${draft.invoiceNumber}` : "New purchase"}
                description={draft.status === "Corrected" ? "This purchase has been corrected and is view-only." : draft.status === "Completed" ? "This purchase is completed and view-only for receiving." : "Work through details, invoice items, and review in a compact workspace."}
              />
              <div className="flex flex-col items-start gap-2 sm:items-end">
                <Badge tone={finalizedStatus ? "neutral" : readyToReceive ? "success" : "warning"}>{purchaseStatusLabel}</Badge>
                <div className="flex flex-wrap gap-2 text-xs">
                  <Badge tone="neutral">{mappedLineCount} mapped</Badge>
                  <Badge tone={unresolvedLineCount > 0 ? "warning" : "success"}>{unresolvedLineCount} need confirmation</Badge>
                  <Badge tone={readyToReceive ? "success" : "neutral"}>{readyToReceive ? "Ready to receive" : "Not ready to receive"}</Badge>
                </div>
              </div>
            </div>

            <div className="mt-5">
              <WorkspaceTabs
                ariaLabel="Purchase workspace sections"
                onChange={(value) => setPurchasePanel(value as "details" | "lines" | "review")}
                tabs={purchaseTabs}
                value={purchasePanel}
              />
            </div>

            <div className="mt-5 space-y-5">
              {purchasePanel === "details" ? (
                <section className="space-y-5" data-testid="purchase-details-panel">
                  <div className="rounded-2xl border border-line bg-slate-50 p-4">
                    <div className="grid gap-4 md:grid-cols-2">
                      <label className="block">
                        <span className="text-sm font-semibold text-ink">Supplier</span>
                        <select className="input mt-1" value={draft.supplierName} onChange={(event) => setDraft((current) => ({ ...current, supplierName: event.target.value }))} disabled={finalizedStatus}>
                          <option value="">Choose a supplier</option>
                          {data?.suppliers?.map((supplier) => (
                            <option key={supplier.id} value={supplier.name}>{supplier.name}</option>
                          ))}
                        </select>
                      </label>
                      <label className="block">
                        <span className="text-sm font-semibold text-ink">Invoice number</span>
                        <input className="input mt-1" value={draft.invoiceNumber} placeholder="Leave blank until the invoice number is known" onChange={(event) => setDraft((current) => ({ ...current, invoiceNumber: event.target.value }))} disabled={finalizedStatus} />
                      </label>
                      <label className="block">
                        <span className="text-sm font-semibold text-ink">Invoice date</span>
                        <input className="input mt-1" type="date" value={draft.invoiceDate} onChange={(event) => setDraft((current) => ({ ...current, invoiceDate: event.target.value }))} disabled={finalizedStatus} />
                      </label>
                      <label className="block">
                        <span className="text-sm font-semibold text-ink">Status</span>
                        {finalizedStatus ? (
                          <div className="mt-1 rounded-2xl border border-line bg-white px-4 py-3">
                            <Badge tone={statusTone(draft.status)}>{draft.status}</Badge>
                          </div>
                        ) : (
                          <select className="input mt-1" value={draft.status} onChange={(event) => setDraft((current) => ({ ...current, status: event.target.value }))}>
                            <option value="Draft">Needs review</option>
                            <option value="Ready">Ready</option>
                            <option value="Completed">Completed</option>
                          </select>
                        )}
                      </label>
                    </div>
                  </div>

                  <div className="grid gap-4 md:grid-cols-3">
                    <label className="block rounded-2xl border border-line bg-slate-50 p-4">
                      <span className="text-sm font-semibold text-ink">Subtotal</span>
                      <input className="input mt-1" type="number" step="0.01" value={draft.subtotal} onChange={(event) => setDraft((current) => ({ ...current, subtotal: Number(event.target.value), totalAmount: Number(event.target.value) + Number(current.tax || 0) }))} disabled={finalizedStatus} />
                    </label>
                    <label className="block rounded-2xl border border-line bg-slate-50 p-4">
                      <span className="text-sm font-semibold text-ink">Tax</span>
                      <input className="input mt-1" type="number" step="0.01" value={draft.tax} onChange={(event) => setTax(Number(event.target.value))} disabled={finalizedStatus} />
                    </label>
                    <label className="block rounded-2xl border border-line bg-slate-50 p-4">
                      <span className="text-sm font-semibold text-ink">Total</span>
                      <input className="input mt-1" type="number" step="0.01" value={draft.totalAmount} onChange={(event) => setDraft((current) => ({ ...current, totalAmount: Number(event.target.value) }))} disabled={finalizedStatus} />
                    </label>
                  </div>

                  <label className="block rounded-2xl border border-line bg-slate-50 p-4">
                    <span className="text-sm font-semibold text-ink">Notes</span>
                    <textarea className="input mt-1" value={draft.notes} onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))} disabled={finalizedStatus} />
                  </label>
                </section>
              ) : null}

              {purchasePanel === "lines" ? (
                <section className="space-y-4" data-testid="purchase-lines-panel">
                  <div className="rounded-2xl border border-line bg-slate-50 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-ink">Invoice items</p>
                        <p className="mt-1 text-sm text-muted">Map each supplier item before receiving the purchase.</p>
                      </div>
                      <button type="button" className="text-sm font-semibold text-brand-700" onClick={addLine} disabled={finalizedStatus}>
                        Add item
                      </button>
                    </div>
                    <div className="mt-4 space-y-4">
                      {draft.lineItems.map((line, index) => (
                        <div key={line.id ?? index} className="rounded-2xl border border-line bg-white p-4">
                          <div className="grid gap-3 md:grid-cols-2">
                            <label className="block">
                              <span className="text-xs font-bold uppercase tracking-wide text-muted">Description</span>
                              <input className="input mt-1" value={line.description} onChange={(event) => setLineDescription(index, event.target.value)} disabled={finalizedStatus} />
                            </label>
                            <label className="block">
                              <span className="text-xs font-bold uppercase tracking-wide text-muted">Inventory item</span>
                              <select className="input mt-1" value={line.inventoryItemId ?? ""} onChange={(event) => setLineInventoryItem(index, event.target.value ? Number(event.target.value) : null, line.description)} disabled={finalizedStatus}>
                                <option value="">Unmapped</option>
                                {inventoryItems.map((item) => (
                                  <option key={item.id} value={item.id}>{item.name}</option>
                                ))}
                              </select>
                            </label>
                          </div>
                          <div className="mt-3 grid gap-3 md:grid-cols-4">
                            <label className="block">
                              <span className="text-xs font-bold uppercase tracking-wide text-muted">Purchase unit</span>
                              <input className="input mt-1" list={`purchase-units-${index}`} value={line.purchaseUnit} onChange={(event) => updateLine(index, (current) => ({ ...current, purchaseUnit: event.target.value }))} disabled={finalizedStatus} />
                              <datalist id={`purchase-units-${index}`}>
                                {commonUnits.map((unit) => (
                                  <option key={unit} value={unit} />
                                ))}
                              </datalist>
                            </label>
                            <label className="block">
                              <span className="text-xs font-bold uppercase tracking-wide text-muted">Inventory unit</span>
                              <input className="input mt-1" list={`inventory-units-${index}`} value={line.inventoryUnit} onChange={(event) => updateLine(index, (current) => ({ ...current, inventoryUnit: event.target.value }))} disabled={finalizedStatus} />
                              <datalist id={`inventory-units-${index}`}>
                                {commonUnits.map((unit) => (
                                  <option key={unit} value={unit} />
                                ))}
                              </datalist>
                            </label>
                            <label className="block">
                              <span className="text-xs font-bold uppercase tracking-wide text-muted">Conversion</span>
                              <input className="input mt-1" type="number" step="0.0001" value={line.conversionFactor} onChange={(event) => updateLine(index, (current) => ({ ...current, conversionFactor: Number(event.target.value) || 1 }))} disabled={finalizedStatus} />
                            </label>
                            <label className="block">
                              <span className="text-xs font-bold uppercase tracking-wide text-muted">Qty / price / total</span>
                              <div className="mt-1 grid grid-cols-3 gap-2">
                                <input className="input" type="number" step="0.0001" value={line.quantity} onChange={(event) => updateLine(index, (current) => ({ ...current, quantity: Number(event.target.value), lineTotal: Number(event.target.value) * Number(current.unitPrice || 0) }))} disabled={finalizedStatus} />
                                <input className="input" type="number" step="0.01" value={line.unitPrice} onChange={(event) => updateLine(index, (current) => ({ ...current, unitPrice: Number(event.target.value), lineTotal: Number(current.quantity || 0) * Number(event.target.value) }))} disabled={finalizedStatus} />
                                <input className="input" type="number" step="0.01" value={line.lineTotal} onChange={(event) => updateLine(index, (current) => ({ ...current, lineTotal: Number(event.target.value) }))} disabled={finalizedStatus} />
                              </div>
                            </label>
                          </div>
                          <div className="mt-3 grid gap-3 md:grid-cols-[1fr_auto] md:items-center">
                            <div className="flex flex-wrap items-center gap-2 text-sm">
                              <Badge tone={line.inventoryItemId ? "success" : "warning"}>{line.inventoryItemId ? "Mapped" : "Needs mapping"}</Badge>
                              <Badge tone={line.needsReview ? "warning" : "success"}>{line.needsReview ? "Needs review" : "Confirmed"}</Badge>
                              <Badge tone="neutral">
                                {formatNumber(Number((line.quantity || 0) * (line.conversionFactor || 1)))} {line.inventoryUnit || "inventory units"}
                              </Badge>
                              <Badge tone="neutral">{line.confidence >= 0.9 ? "High confidence" : line.confidence >= 0.7 ? "Medium confidence" : "Low confidence"}</Badge>
                            </div>
                            <div className="flex items-center justify-between gap-3 text-sm md:justify-end">
                              <label className="inline-flex items-center gap-2 text-muted">
                                <input checked={line.needsReview} disabled={finalizedStatus} type="checkbox" onChange={(event) => updateLine(index, (current) => ({ ...current, needsReview: event.target.checked }))} />
                                Needs review
                              </label>
                              <button
                                className="text-sm font-semibold text-danger disabled:text-slate-300"
                                type="button"
                                disabled={finalizedStatus || draft.lineItems.length === 1}
                                onClick={() => {
                                  const next = draft.lineItems.filter((_, lineIndex) => lineIndex !== index);
                                  setDraft((current) => ({ ...current, ...recalculateTotals(next.length ? next : [blankLine()], current.tax) }));
                                }}
                              >
                                Remove
                              </button>
                            </div>
                          </div>
                          {line.inventoryItemId ? (
                            <p className="mt-3 text-xs leading-5 text-muted">
                              Inventory unit {line.inventoryUnit || "each"} will receive {formatNumber(Number((line.quantity || 0) * (line.conversionFactor || 1)))} units from this item.
                            </p>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </div>
                </section>
              ) : null}

              {purchasePanel === "review" ? (
                <section className="space-y-4" data-testid="purchase-review-panel">
                  <div className="rounded-2xl border border-line bg-slate-50 p-4">
                    <p className="text-sm font-semibold text-ink">Review and send</p>
                    <p className="mt-1 text-sm text-muted">
                      {finalizedStatus
                        ? "This purchase is locked for review only. Completed and corrected records cannot be received again."
                        : "Save a draft first, or mark it ready once every invoice item has been mapped to inventory."}
                    </p>
                    <div className="mt-4 flex flex-wrap gap-3">
                      <Button disabled={saving || finalizedStatus} type="button" onClick={() => void saveDraft("Draft")}>
                        {saving ? "Saving..." : "Save draft"}
                      </Button>
                      <Button disabled={saving || finalizedStatus} variant="secondary" type="button" onClick={() => void saveDraft("Ready")}>
                        Save ready
                      </Button>
                      <Button
                        disabled={saving || !draft.id || finalizedStatus || !readyToReceive}
                        icon={<CheckCircle2 className="h-4 w-4" />}
                        type="button"
                        onClick={() => void receiveInvoice()}
                      >
                        Receive into inventory
                      </Button>
                    </div>
                  </div>

                  {draft.status === "Completed" ? (
                    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                      <p className="text-sm font-semibold text-ink">Need to correct this receipt?</p>
                      <p className="mt-1 text-sm text-muted">Enter a short reason and Flowtally will reverse the inventory movements, mark the purchase corrected, and keep the audit trail intact.</p>
                      <textarea className="input mt-3" rows={3} value={correctionNote} onChange={(event) => setCorrectionNote(event.target.value)} placeholder="Why is this receipt being corrected?" />
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button disabled={saving || !correctionNote.trim()} variant="secondary" type="button" onClick={() => void correctInvoice()}>
                          {saving ? "Saving..." : "Record correction"}
                        </Button>
                      </div>
                    </div>
                  ) : null}

                  {draft.status === "Corrected" ? (
                    <div className="rounded-2xl border border-line bg-slate-50 p-4 text-sm text-muted">
                      <p className="font-semibold text-ink">This invoice was corrected</p>
                      <p className="mt-1">Inventory movements were reversed and the record is now view-only.</p>
                    </div>
                  ) : null}

                  <div className="rounded-2xl border border-line bg-white p-4 text-sm text-muted">
                    <p className="font-semibold text-ink">Purchase status</p>
                    <p className="mt-1">Completed purchases become view-only and can no longer be received twice. Corrected purchases stay view-only and preserve the audit trail. Save ready is available only when every item is mapped.</p>
                  </div>
                </section>
              ) : null}
            </div>
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="w-full p-6" data-testid="purchase-history-card">
            <SectionHeader title="Review queue and purchase history" description="Newest purchases first. Open one to continue review." />
            <div className="space-y-3">
              {loading ? <p className="text-sm text-muted">Loading purchases…</p> : null}
              {invoiceRows.map((invoice) => (
                <button key={invoice.id} type="button" onClick={() => void openInvoice(invoice.id)} className={`w-full rounded-2xl border px-4 py-4 text-left transition hover:-translate-y-0.5 hover:shadow-soft ${selectedInvoice?.id === invoice.id ? "border-brand-200 bg-brand-50" : "border-line bg-slate-50"}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-ink">{invoice.supplier?.name ?? "Supplier"}</p>
                      <p className="text-sm text-muted">{invoice.invoiceNumber} • {formatDate(invoice.invoiceDate)}</p>
                    </div>
                    <Badge tone={statusTone(invoice.status)}>{invoice.status}</Badge>
                  </div>
                  <div className="mt-3 flex items-center justify-between text-sm text-muted">
                    <span>{formatMoney(invoice.totalAmount)}</span>
                    <span>{invoice.lineItems.length} invoice items</span>
                  </div>
                </button>
              ))}
              {!invoiceRows.length ? <p className="rounded-2xl border border-dashed border-line px-4 py-8 text-sm text-muted">No purchases yet. Create the first invoice to start tracking spend.</p> : null}
            </div>
            {data?.invoices?.length && data.invoices.length > 5 ? (
              <button type="button" className="mt-4 text-sm font-semibold text-brand-700" onClick={() => setShowAll((value) => !value)}>
                {showAll ? "Show fewer purchases" : "View all purchases"}
              </button>
            ) : null}
          </Card>

          <Card className="w-full p-6">
            <p className="text-xs font-bold uppercase tracking-wide text-muted">Price changes</p>
            <div className="mt-3 space-y-2">
              {priceChanges.map((change) => (
                <div key={String(change.id)} className="rounded-2xl border border-line bg-slate-50 px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-semibold text-ink">{String(change.itemName ?? change.item ?? "")}</p>
                      <p className="text-sm text-muted">{String(change.supplier ?? "")}</p>
                    </div>
                    <Badge tone={Number(change.changePercent ?? 0) >= 0 ? "orange" : "success"}>
                      {Number(change.changePercent ?? 0) >= 0 ? "+" : ""}{formatNumber(Number(change.changePercent ?? 0))}%
                    </Badge>
                  </div>
                </div>
              ))}
              {!priceChanges.length ? <p className="text-sm text-muted">Price change alerts will appear after the first repeated supplier item.</p> : null}
            </div>
          </Card>
        </div>
      </div>

      <PurchaseInvoiceDetailsModal invoice={detailInvoice} onClose={closeDetailInvoice} />
    </div>
  );
}
