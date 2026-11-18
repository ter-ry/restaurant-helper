import { useEffect, useMemo, useRef, useState, type FocusEvent } from "react";
import { CheckCircle2, FileText, Plus, RefreshCcw } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { Badge } from "../components/Badge";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { ThemedDateTimeInput } from "../components/ThemedDateTimeInput";
import { Modal } from "../components/Modal";
import { SectionHeader } from "../components/SectionHeader";
import {
  createPilotPurchaseInvoice,
  overridePilotOcrDiscrepancy,
  type PilotOcrEvidence,
  createPilotInventoryItem,
  createPilotSupplier,
  fetchPilotInventory,
  fetchPilotPurchases,
  fetchPilotPurchaseInvoice,
  fetchPilotPurchasePreview,
  receivePilotPurchaseInvoice,
  uploadPilotInvoiceOcr,
  updatePilotPurchaseInvoice,
  voidPilotPurchaseInvoice,
  PilotApiError,
  type PilotInventoryItem,
  type PilotPurchaseInvoice,
  type PilotInvoiceOcrResponse,
  type PilotPurchasesResponse,
} from "./pilotApi";
import { formatDate, formatMoney, formatNumber } from "./workspace/pilotWorkspaceUtils";
import { lineBlockers, suggestInventoryItem } from "./purchaseMapping";
import { buildOcrPrintedEvidence, checkOcrLines, type OcrPrintedEvidence } from "./ocrReconciliation";
import { PurchaseInvoiceDetailsModal } from "./purchases/PurchaseDetailPanel";
import { MATERIAL_PRICE_CHANGE_PERCENT, purchaseStatus } from "./purchases/purchaseStatus";
import { useWideLayout } from "./purchases/useWideLayout";

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
  /** Signed token from the OCR response; sent once when the extracted draft is first saved (#169). */
  ocrEvidenceToken?: string;
  /** Server-stored printed amounts and verdict; the durable source once the draft is saved. */
  ocrServer?: PilotOcrEvidence | null;
  correctsInvoiceId?: number | null;
  correctedByInvoiceId?: number | null;
  voidReason?: string;
  lineItems: DraftLine[];
}

const commonUnits = ["each", "bag", "bottle", "box", "case", "dozen", "kg", "lb", "L", "ml", "pack", "roll", "tray"];

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function normalizeLookup(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function selectZeroValue(event: FocusEvent<HTMLInputElement>) {
  if (Number(event.currentTarget.value) === 0) {
    event.currentTarget.select();
  }
}

function roundCurrency(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function purchaseErrorMessage(error: unknown) {
  if (error instanceof PilotApiError && error.errors) {
    const details = Object.values(error.errors).join(" ");
    return details ? `${error.message} ${details}` : error.message;
  }
  return error instanceof Error ? error.message : "Could not save the purchase.";
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
    ocrServer: invoice.ocrEvidence ?? null,
    correctsInvoiceId: invoice.correctsInvoiceId ?? null,
    correctedByInvoiceId: invoice.correctedByInvoiceId ?? null,
    voidReason: invoice.voidReason ?? "",
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

export function PilotPurchasesPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const editorPanelRef = useRef<HTMLDivElement | null>(null);
  const wideLayout = useWideLayout();
  const ocrInputRef = useRef<HTMLInputElement | null>(null);
  const [data, setData] = useState<PilotPurchasesResponse | null>(null);
  const [inventoryItems, setInventoryItems] = useState<PilotInventoryItem[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [draft, setDraft] = useState<PurchaseDraft>(buildBlankDraft());
  const [detailInvoice, setDetailInvoice] = useState<PilotPurchaseInvoice | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  // A void in flight also blocks switching purchases: its completion reloads the page state.
  const [voiding, setVoiding] = useState(false);
  // Which action is in flight, so only that button announces progress ("Receiving..." must not show for a draft save).
  const [savingAction, setSavingAction] = useState<"draft" | "receive" | null>(null);
  const [receiveConfirmOpen, setReceiveConfirmOpen] = useState(false);
  const [receiveReconciliationInvoiceId, setReceiveReconciliationInvoiceId] = useState<number | null>(null);
  const [receiveMessage, setReceiveMessage] = useState<string | null>(null);
  // Set when a void was confirmed by the server but the follow-up refresh failed; cleared once a refresh succeeds.
  const [voidRefresh, setVoidRefresh] = useState<{ invoiceId: number; message: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [duplicateInvoiceId, setDuplicateInvoiceId] = useState<number | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const [purchaseSearch, setPurchaseSearch] = useState("");
  const [purchaseFilter, setPurchaseFilter] = useState<"all" | "review" | "received" | "corrected">("all");
  const [showSupplierForm, setShowSupplierForm] = useState(false);
  const [newSupplierName, setNewSupplierName] = useState("");
  const [supplierSaving, setSupplierSaving] = useState(false);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [ocrError, setOcrError] = useState<string | null>(null);
  const [ocrEvidence, setOcrEvidence] = useState<OcrPrintedEvidence | null>(null);
  // The exact gap the owner confirmed against the original document; any later line edit that changes the gap voids it.
  const [ocrOverrideReason, setOcrOverrideReason] = useState("");
  const [ocrOverrideBusy, setOcrOverrideBusy] = useState(false);
  const [ocrOverrideError, setOcrOverrideError] = useState<string | null>(null);
  const [lastOcrFile, setLastOcrFile] = useState<File | null>(null);
  const [ocrPreviewUrl, setOcrPreviewUrl] = useState<string | null>(null);
  const [ocrPreviewType, setOcrPreviewType] = useState<"image" | "pdf" | null>(null);
  const [purchasePreview, setPurchasePreview] = useState<Awaited<ReturnType<typeof fetchPilotPurchasePreview>> | null>(null);
  const [ocrPreviewName, setOcrPreviewName] = useState("");
  const [newInventoryItem, setNewInventoryItem] = useState<{ name: string; stockUnit: string; category: string }>({ name: "", stockUnit: "each", category: "Other" });
  const [inventoryItemTargetIndex, setInventoryItemTargetIndex] = useState<number | null>(null);
  const [inventoryItemSaving, setInventoryItemSaving] = useState(false);
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

  const load = async (preferredInvoiceId: number | null | undefined = requestedInvoiceId): Promise<boolean> => {
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
        setShowReview(false);
        setEditorOpen(true);
      } else {
        setSelectedId(null);
        setDraft(buildBlankDraft());
        setDetailInvoice(resolvedInvoice && (resolvedInvoice.status === "Completed" || resolvedInvoice.status === "Corrected") ? resolvedInvoice : null);
        setShowReview(false);
      }
      setHasLoaded(true);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load purchases.");
      return false;
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedInvoiceId]);

  useEffect(() => () => {
    if (ocrPreviewUrl) {
      try { URL.revokeObjectURL(ocrPreviewUrl); } catch { /* browser cleanup is best effort */ }
    }
  }, [ocrPreviewUrl]);

  const selectedInvoice = useMemo(
    () => data?.invoices?.find((invoice) => invoice.id === selectedId) ?? null,
    [data?.invoices, selectedId],
  );

  // Set when the cached invoice is replaced only to reconcile server evidence (an override); the editor then keeps
  // its unsaved edits instead of being re-initialised from the cache.
  const keepEditorForInvoiceId = useRef<number | null>(null);
  const selectedIdRef = useRef<number | null>(null);
  selectedIdRef.current = selectedId;
  useEffect(() => {
    if (selectedInvoice) {
      if (keepEditorForInvoiceId.current === selectedInvoice.id) keepEditorForInvoiceId.current = null;
      else setDraft(invoiceToDraft(selectedInvoice));
      if (selectedInvoice.id) {
        void fetchPilotPurchasePreview(selectedInvoice.id).then(setPurchasePreview).catch(() => setPurchasePreview(null));
      }
    }
  }, [selectedInvoice]);

  // In the side-panel layout the editor appears next to the queue: move keyboard focus into it when it opens or changes.
  useEffect(() => {
    if (wideLayout && editorOpen) editorPanelRef.current?.focus();
  }, [wideLayout, editorOpen, selectedId]);

  const closeDetailInvoice = () => {
    setDetailInvoice(null);
    navigate(location.pathname, { replace: true });
    // The unrefreshed state stays visible on the page error banner, whose Retry re-runs the load.
    setVoidRefresh(null);
  };

  const invoiceRows = showAll ? data?.invoices ?? [] : (data?.invoices ?? []).slice(0, 5);
  const filteredInvoices = useMemo(() => (data?.invoices ?? []).filter((invoice) => {
    const query = purchaseSearch.trim().toLowerCase();
    const matchesQuery = !query || `${invoice.supplier?.name ?? ""} ${invoice.invoiceNumber}`.toLowerCase().includes(query);
    const matchesFilter = purchaseFilter === "all" || (purchaseFilter === "review" && invoice.status !== "Completed" && invoice.status !== "Corrected") || (purchaseFilter === "received" && invoice.status === "Completed") || (purchaseFilter === "corrected" && invoice.status === "Corrected");
    return matchesQuery && matchesFilter;
  }), [data?.invoices, purchaseFilter, purchaseSearch]);
  const initialLoading = loading && !hasLoaded;
  const finalizedStatus = draft.status === "Completed" || draft.status === "Corrected";
  const mappedLineCount = draft.lineItems.filter((line) => line.inventoryItemId).length;
  const unresolvedLineCount = draft.lineItems.filter((line) => !line.inventoryItemId).length;
  const readyToReceive = !finalizedStatus && unresolvedLineCount === 0 && mappedLineCount > 0 && draft.lineItems.every((line) => line.conversionFactor > 0 && line.quantity > 0);
  // Once saved, the server-stored printed amounts are the only evidence (they survive reload and reopen); the
  // in-memory evidence only covers the not-yet-saved extraction.
  const activeOcrEvidence = useMemo<OcrPrintedEvidence | null>(() => {
    if (draft.id && draft.ocrServer) {
      return { printedSubtotal: draft.ocrServer.printedSubtotal, printedTax: draft.ocrServer.printedTax, printedTotal: draft.ocrServer.printedTotal, warnings: [], serverMessage: "", invoiceId: draft.id };
    }
    return ocrEvidence && draft.extractionStatus === "ocr" && (ocrEvidence.invoiceId === null ? !draft.id : ocrEvidence.invoiceId === draft.id) ? ocrEvidence : null;
  }, [draft.id, draft.ocrServer, draft.extractionStatus, ocrEvidence]);
  const ocrCheck = useMemo(
    () => (activeOcrEvidence ? checkOcrLines(activeOcrEvidence, draft.lineItems.map((line) => Number(line.lineTotal) || 0)) : null),
    [activeOcrEvidence, draft.lineItems],
  );
  // An override is the server's audited record, valid only for the exact line total it acknowledged.
  const ocrOverrideValid = Boolean(draft.ocrServer?.override && ocrCheck && Math.abs(draft.ocrServer.override.acknowledgedLineTotal - ocrCheck.itemsTotal) <= 0.01);
  // Saving the extracted draft gives it an id; the printed-amount check follows that same purchase. Only the unsaved OCR
  // draft being saved is bound, so opening some other saved invoice never inherits this evidence.
  const bindOcrEvidence = (savedId: number) => {
    if (draft.id || draft.extractionStatus !== "ocr") return;
    setOcrEvidence((current) => (current && current.invoiceId === null ? { ...current, invoiceId: savedId } : current));
  };
  const localReviewSummary = useMemo(() => {
    const blockers = draft.lineItems.flatMap((line) => [
      !line.inventoryItemId ? `Map ${line.description || "this item"} to inventory.` : null,
      line.quantity <= 0 ? `Enter a quantity for ${line.description || "this item"}.` : null,
      line.conversionFactor <= 0 ? `Enter a valid conversion for ${line.description || "this item"}.` : null,
      Math.abs(roundCurrency((line.quantity || 0) * (line.unitPrice || 0)) - roundCurrency(line.lineTotal || 0)) > 0.01
        ? `${line.description || "This item"}: quantity × unit price is ${formatMoney(roundCurrency((line.quantity || 0) * (line.unitPrice || 0)))}, but the line total is ${formatMoney(roundCurrency(line.lineTotal || 0))}. Review before receiving.`
        : null,
    ].filter(Boolean) as string[]);
    const warnings = draft.lineItems.filter((line) => line.needsReview || line.confidence < 0.8).map((line) => `Review ${line.description || "this item"} before receiving.`);
    const lineSubtotal = draft.lineItems.reduce((sum, line) => sum + Number(line.lineTotal || 0), 0);
    const subtotalDifference = lineSubtotal - Number(draft.subtotal || 0);
    const totalDifference = Number(draft.subtotal || 0) + Number(draft.tax || 0) - Number(draft.totalAmount || 0);
    // Line edits recompute the draft subtotal from the lines, so the printed invoice amounts are checked separately:
    // receiving stays blocked until the lines match them or the owner confirms the current gap against the document.
    if (ocrCheck?.status === "incomplete" && !ocrOverrideValid) blockers.push(`Extracted items do not match the printed invoice (difference ${formatMoney(Math.abs(ocrCheck.difference ?? 0))}). Correct the lines, or save the draft and record an audited override.`);
    if (Math.abs(subtotalDifference) > 0.01) blockers.push(`Line items differ from invoice subtotal by ${formatMoney(Math.abs(subtotalDifference))}.`);
    if (Math.abs(totalDifference) > 0.01) blockers.push(`Subtotal plus tax differs from invoice total by ${formatMoney(Math.abs(totalDifference))}.`);
    return {
      state: blockers.length ? "BLOCKING" : warnings.length ? "REVIEW" : "READY",
      blockers,
      warnings,
      reconciliation: { lineSubtotal, subtotalDifference, totalDifference, status: blockers.length ? "mismatch" : "matched" },
      readyToReceive: blockers.length === 0 && readyToReceive,
    };
  }, [draft, readyToReceive, ocrCheck, ocrOverrideValid]);
  // Always derive eligibility from the values currently in the editor. The
  // saved invoice summary may be stale after a quantity/mapping edit; the
  // backend revalidates the persisted payload before creating movements.
  const reviewSummary = localReviewSummary;
  const authoritativeReadyToReceive = localReviewSummary.readyToReceive;

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

  const purchasePayload = (status: string) => ({
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
    ...(draft.id ? {} : { ocrEvidenceToken: draft.ocrEvidenceToken }),
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
  });

  const recordOcrOverride = async () => {
    if (!draft.id || !ocrCheck || ocrOverrideBusy) return;
    setOcrOverrideBusy(true);
    setOcrOverrideError(null);
    try {
      const saved = await overridePilotOcrDiscrepancy(draft.id, { reason: ocrOverrideReason.trim(), acknowledgedLineTotal: ocrCheck.itemsTotal });
      // The user may have opened another purchase while this was in flight: only the invoice that asked gets the evidence.
      setDraft((current) => (current.id === saved.id ? { ...current, ocrServer: saved.ocrEvidence ?? null } : current));
      // openInvoice prefers the cached list entry, so keep it in step with the server record.
      if (selectedIdRef.current === saved.id) keepEditorForInvoiceId.current = saved.id;
      setData((current) => (current ? { ...current, invoices: current.invoices.map((invoice) => (invoice.id === saved.id ? saved : invoice)) } : current));
      setOcrOverrideReason("");
    } catch (caught) {
      setOcrOverrideError(caught instanceof Error ? caught.message : "The override could not be recorded.");
    } finally {
      setOcrOverrideBusy(false);
    }
  };

  const saveDraft = async (status: string) => {
    if (saving) return;
    setSaving(true);
    setSavingAction("draft");
    setReceiveMessage(null);
    setError(null);
    setDuplicateInvoiceId(null);

    try {
      if (status === "Ready" && unresolvedLineCount > 0) {
        throw new Error("Map every invoice item before marking the purchase ready.");
      }
      const payload = purchasePayload(status);
      const saved = draft.id ? await updatePilotPurchaseInvoice(draft.id, payload) : await createPilotPurchaseInvoice(payload);
      bindOcrEvidence(saved.id);
      setSelectedId(saved.id);
      setDraft(invoiceToDraft(saved));
      setReceiveMessage(`Invoice ${saved.invoiceNumber} saved successfully.`);
      await load(saved.id);
    } catch (err) {
      if (err instanceof PilotApiError && err.errors?.duplicateInvoiceId) setDuplicateInvoiceId(Number(err.errors.duplicateInvoiceId));
      setError(purchaseErrorMessage(err));
    } finally {
      setSaving(false);
      setSavingAction(null);
    }
  };

  const saveAndReceive = async () => {
    if (saving) return;
    if (!authoritativeReadyToReceive) {
      setError("Map every invoice item before receiving this purchase.");
      return;
    }
    setSaving(true);
    setSavingAction("receive");
    setReceiveMessage(null);
    setError(null);
    setDuplicateInvoiceId(null);
    setReceiveReconciliationInvoiceId(null);
    let savedInvoiceId: number | null = null;
    try {
      const payload = purchasePayload("Ready");
      const saved = draft.id ? await updatePilotPurchaseInvoice(draft.id, payload) : await createPilotPurchaseInvoice(payload);
      savedInvoiceId = saved.id;
      bindOcrEvidence(saved.id);
      // Keep the server-saved draft available if the following receive call
      // times out or fails. It must never be recreated blindly.
      setSelectedId(saved.id);
      setDraft(invoiceToDraft(saved));
      await receivePilotPurchaseInvoice(saved.id);
      setSelectedId(null);
      setDraft(buildBlankDraft());
      setDetailInvoice(null);
      setShowReview(false);
      setEditorOpen(false);
      setReceiveMessage(`Invoice ${saved.invoiceNumber || "purchase"} received into inventory.`);
      setReceiveConfirmOpen(false);
      navigate(location.pathname, { replace: true });
      await load(null);
    } catch (err) {
      if (err instanceof PilotApiError && err.errors?.duplicateInvoiceId) setDuplicateInvoiceId(Number(err.errors.duplicateInvoiceId));
      if (savedInvoiceId) {
        try {
          const current = await fetchPilotPurchaseInvoice(savedInvoiceId);
          setSelectedId(current.id);
          setDraft(invoiceToDraft(current));
          setEditorOpen(current.status !== "Completed" && current.status !== "Corrected");
          if (current.status === "Completed") {
            setReceiveConfirmOpen(false);
            setReceiveReconciliationInvoiceId(null);
            setReceiveMessage(`Invoice ${current.invoiceNumber || "purchase"} was received successfully.`);
            await load(null);
            return;
          }
          setReceiveReconciliationInvoiceId(null);
          setReceiveConfirmOpen(false);
          setError(`Invoice ${current.invoiceNumber || "purchase"} was saved but not received. Review it before retrying.`);
        } catch {
          setReceiveReconciliationInvoiceId(savedInvoiceId);
          setReceiveConfirmOpen(true);
          setError(`Invoice ${savedInvoiceId} was saved, but its receiving status could not be confirmed. Refresh before retrying.`);
        }
      } else {
        // Nothing was saved, so close the confirmation: it would otherwise sit over this error and its recovery action.
        setReceiveConfirmOpen(false);
        setError(purchaseErrorMessage(err));
      }
    } finally {
      setSaving(false);
      setSavingAction(null);
    }
  };

  const createSupplier = async () => {
    const name = newSupplierName.trim();
    if (!name) return;
    setSupplierSaving(true);
    setError(null);
    try {
      const supplier = await createPilotSupplier({ name });
      setData((current) => current ? { ...current, suppliers: [...current.suppliers, supplier] } : current);
      setDraft((current) => ({ ...current, supplierName: supplier.name }));
      setNewSupplierName("");
      setShowSupplierForm(false);
      setReceiveMessage(`${supplier.name} added and selected.`);
    } catch (err) {
      setError(purchaseErrorMessage(err));
    } finally {
      setSupplierSaving(false);
    }
  };

  const requestReceive = () => {
    if (receiveReconciliationInvoiceId !== null) {
      setError("Refresh the purchase status before retrying receipt.");
      return;
    }
    if (!authoritativeReadyToReceive) {
      setError("Map every invoice item before receiving this purchase.");
      return;
    }
    setReceiveConfirmOpen(true);
  };

  const receiveInvoice = async () => {
    if (!draft.id) {
      return;
    }
    if (saving || receiveReconciliationInvoiceId !== null) return;
    if (!authoritativeReadyToReceive) {
      setError("Map every invoice item before receiving this purchase.");
      return;
    }
    setSaving(true);
    setReceiveMessage(null);
    setError(null);
    setReceiveReconciliationInvoiceId(null);

    let savedInvoiceId: number | null = null;
    try {
      // Persist the exact values currently reviewed in the editor before
      // receiving a saved draft. The receive endpoint then validates that
      // same authoritative snapshot and creates movements exactly once.
      const saved = await updatePilotPurchaseInvoice(draft.id, purchasePayload("Ready"));
      savedInvoiceId = saved.id;
      setSelectedId(saved.id);
      setDraft(invoiceToDraft(saved));
      const received = await receivePilotPurchaseInvoice(saved.id);
      setSelectedId(null);
      setDraft(buildBlankDraft());
      setDetailInvoice(null);
      setShowReview(false);
      setEditorOpen(false);
      setReceiveMessage(`Invoice ${received.invoiceNumber} received into inventory.`);
      setReceiveConfirmOpen(false);
      navigate(location.pathname, { replace: true });
      await load(null);
    } catch (err) {
      if (savedInvoiceId) {
        try {
          const current = await fetchPilotPurchaseInvoice(savedInvoiceId);
          setSelectedId(current.id);
          setDraft(invoiceToDraft(current));
          setEditorOpen(current.status !== "Completed" && current.status !== "Corrected");
          if (current.status === "Completed") {
            setReceiveConfirmOpen(false);
            setReceiveReconciliationInvoiceId(null);
            setReceiveMessage(`Invoice ${current.invoiceNumber || "purchase"} was received successfully.`);
            await load(null);
            return;
          }
          setReceiveReconciliationInvoiceId(null);
          setReceiveConfirmOpen(false);
          setError(`Invoice ${current.invoiceNumber || "purchase"} was saved but not received. Review it before retrying.`);
        } catch {
          setReceiveReconciliationInvoiceId(savedInvoiceId);
          setReceiveConfirmOpen(true);
          setError(`Invoice ${savedInvoiceId} was saved, but its receiving status could not be confirmed. Refresh before retrying.`);
        }
      } else {
        setError(err instanceof Error ? err.message : "Could not receive the purchase.");
      }
    } finally {
      setSaving(false);
    }
  };

  const reconcileReceiptStatus = async () => {
    const invoiceId = receiveReconciliationInvoiceId;
    if (!invoiceId || saving) return;
    setSaving(true);
    setError(null);
    try {
      const current = await fetchPilotPurchaseInvoice(invoiceId);
      setSelectedId(current.id);
      setDraft(invoiceToDraft(current));
      if (current.status === "Completed") {
        setReceiveConfirmOpen(false);
        setReceiveReconciliationInvoiceId(null);
        setReceiveMessage(`Invoice ${current.invoiceNumber || "purchase"} was received successfully.`);
        await load(null);
      } else {
        setReceiveConfirmOpen(false);
        setReceiveReconciliationInvoiceId(null);
        setEditorOpen(true);
        setError(`Invoice ${current.invoiceNumber || "purchase"} was saved but not received. Review it before retrying.`);
      }
    } catch {
      setReceiveReconciliationInvoiceId(invoiceId);
      setReceiveConfirmOpen(true);
      setError(`Invoice ${invoiceId} was saved, but its receiving status could not be confirmed. Refresh before retrying.`);
    } finally {
      setSaving(false);
    }
  };

  // Throws on failure so VoidInvoicePanel can show the reason and decide whether the idempotency key is reusable.
  const voidInvoice = async (invoice: PilotPurchaseInvoice, request: { reason: string; createCorrectionDraft: boolean; idempotencyKey: string }) => {
    setReceiveMessage(null);
    setError(null);
    setVoiding(true);
    let voided: PilotPurchaseInvoice;
    try {
      voided = await voidPilotPurchaseInvoice(invoice.id, request);
    } catch (caught) {
      setVoiding(false);
      throw caught;
    }
    setReceiveMessage(
      voided.correctedByInvoiceId
        ? `Invoice ${voided.invoiceNumber} was voided and its inventory movements were reversed. A corrected draft is ready to review.`
        : `Invoice ${voided.invoiceNumber} was voided and its inventory movements were reversed.`,
    );
    // Show the confirmed void immediately so the void controls cannot be reused if the refresh below fails.
    setDetailInvoice(voided);
    // Reconcile with the server: the invoice list, inventory and dashboard figures all changed.
    const reconciled = await load(voided.id);
    setVoiding(false);
    if (reconciled) {
      setVoidRefresh(null);
    } else {
      setVoidRefresh({ invoiceId: voided.id, message: `Invoice ${voided.invoiceNumber} was voided, but the page could not refresh. Use Refresh purchase status to see updated totals and stock.` });
    }
  };

  const refreshAfterVoid = async () => {
    if (!voidRefresh || loading) return;
    const reconciled = await load(voidRefresh.invoiceId);
    if (reconciled) {
      setVoidRefresh(null);
    }
  };

  const openInvoice = async (invoiceId: number) => {
    setReceiveMessage(null);
    setError(null);
    const invoice = data?.invoices.find((entry) => entry.id === invoiceId) ?? (await fetchPilotPurchaseInvoice(invoiceId));
    if (invoice.status === "Completed" || invoice.status === "Corrected") {
      setSelectedId(null);
      setDraft(buildBlankDraft());
      setDetailInvoice(invoice);
      setShowReview(false);
      setEditorOpen(false);
      return;
    }
    setDetailInvoice(null);
    setSelectedId(invoice.id);
    setDraft(invoiceToDraft(invoice));
    setShowReview(false);
    setEditorOpen(true);
  };

  const addLine = () => {
    const next = [...draft.lineItems, blankLine()];
    setDraft((current) => ({ ...current, ...recalculateTotals(next, current.tax) }));
  };

  const applyMappingHint = (supplierName: string, description: string) => {
    const hint = mappingHints.get(`${normalizeLookup(supplierName)}|${normalizeLookup(description)}`);
    return hint ?? null;
  };

  const applyOcrResult = (result: PilotInvoiceOcrResponse, file: File) => {
    const fieldValue = (field: { value: string | number | null } | undefined) => field?.value ?? "";
    const supplierName = String(fieldValue(result.fields.supplier)).trim();
    const lineItems = result.lineItems.map((line) => {
      const baseDescription = String(line.itemName || line.originalDescription || "").trim();
      // OCR keeps package size separate from purchased quantity. Preserve it
      // in the editable description so inventory mapping can distinguish, for
      // example, Milk 2L from Milk 4L without changing the invoice quantity.
      const packageLabel = String(line.packaging || "").replace(/\s+/g, "").trim();
      const description = packageLabel && !baseDescription.replace(/\s+/g, "").toLowerCase().includes(packageLabel.toLowerCase())
        ? `${baseDescription} ${packageLabel}`.trim()
        : baseDescription;
      const hint = applyMappingHint(supplierName, description);
      const exactMatch = inventoryItems.find((item) => item.active && normalizeLookup(item.name) === normalizeLookup(description));
      const inventoryItemId = hint?.inventoryItemId ?? exactMatch?.id ?? null;
      return {
        ...blankLine(),
        description,
        inventoryItemId,
        purchaseUnit: hint?.purchaseUnit ?? (line.unit || "each"),
        inventoryUnit: hint?.inventoryUnit ?? exactMatch?.stockUnit ?? "each",
        conversionFactor: hint?.conversionFactor ?? 1,
        quantity: Number(line.quantity) > 0 ? Number(line.quantity) : 1,
        unitPrice: Number(line.unitPrice) || 0,
        lineTotal: Number(line.lineTotal) || 0,
        confidence: Number(line.confidence) || 0,
        needsReview: Boolean(result.needsReview || line.needsReview || !inventoryItemId),
        note: line.rawSourceLine || "",
      };
    });
    const subtotal = Number(fieldValue(result.fields.subtotal)) || lineItems.reduce((sum, line) => sum + line.lineTotal, 0);
    const tax = Number(fieldValue(result.fields.tax)) || 0;
    setSelectedId(null);
    setDetailInvoice(null);
    setDraft({
      ...buildBlankDraft(),
      supplierName,
      invoiceNumber: String(fieldValue(result.fields.invoiceNumber)).trim(),
      invoiceDate: String(fieldValue(result.fields.invoiceDate) || todayIso()),
      subtotal,
      tax,
      totalAmount: Number(fieldValue(result.fields.total)) || subtotal + tax,
      sourceFileName: result.fileName || file.name,
      sourceFileType: result.contentType || file.type,
      extractionStatus: "ocr",
      extractedText: result.rawText || "",
      ocrEvidenceToken: result.evidenceToken,
      lineItems: lineItems.length ? lineItems : [blankLine()],
    });
    setOcrEvidence(buildOcrPrintedEvidence(result));
    setOcrOverrideReason("");
    setOcrOverrideError(null);
    setShowReview(false);
    setReceiveMessage(result.needsReview ? "Invoice extracted. Review the highlighted fields before saving." : "Invoice extracted. Review the draft before saving.");
  };

  const uploadInvoice = async (file: File) => {
    let previewUrl: string | null = null;
    try {
      if (typeof window !== "undefined" && window.location.origin !== "null") {
        previewUrl = URL.createObjectURL(file);
      }
    } catch {
      // Some embedded browsers do not expose blob URLs; OCR can still proceed.
    }
    if (previewUrl) {
      setOcrPreviewUrl((current) => {
        if (current) { try { URL.revokeObjectURL(current); } catch { /* best effort */ } }
        return previewUrl;
      });
    }
    setOcrPreviewType(file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf") ? "pdf" : "image");
    setOcrPreviewName(file.name);
    setLastOcrFile(file);
    setOcrLoading(true);
    setOcrError(null);
    setReceiveMessage(null);
    try {
      const result = await uploadPilotInvoiceOcr(file);
      applyOcrResult(result, file);
    } catch (err) {
      setOcrError(purchaseErrorMessage(err));
    } finally {
      setOcrLoading(false);
      if (ocrInputRef.current) {
        ocrInputRef.current.value = "";
      }
    }
  };

  const clearOcrReview = () => {
    setOcrPreviewUrl((current) => {
      if (current) { try { URL.revokeObjectURL(current); } catch { /* best effort */ } }
      return null;
    });
    setOcrPreviewType(null);
    setOcrPreviewName("");
    setLastOcrFile(null);
    setOcrError(null);
    // Printed evidence is deliberately kept: "Continue manually" keeps the extracted draft, and the draft must stay
    // checked against what the invoice printed. It is replaced by the next extraction and ignored for non-OCR drafts.
  };

  const setLineDescription = (index: number, description: string) => {
    updateLine(index, (current) => {
      const next = { ...current, description };
      const exactMatches = inventoryItems.filter((item) => item.active && normalizeLookup(item.name) === normalizeLookup(description));
      if (exactMatches.length === 1 && !current.inventoryItemId) {
        return {
          ...next,
          inventoryItemId: exactMatches[0].id,
          inventoryUnit: exactMatches[0].stockUnit,
          conversionFactor: current.conversionFactor || 1,
          needsReview: false,
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
      needsReview: inventoryItemId ? false : current.needsReview,
    }));
  };

  const openInventoryItemCreator = (index: number, line: DraftLine) => {
    setInventoryItemTargetIndex(index);
    setNewInventoryItem({ name: line.description.trim(), stockUnit: line.inventoryUnit || line.purchaseUnit || "each", category: "Other" });
  };

  const createInventoryItemInline = async () => {
    if (inventoryItemTargetIndex == null || !newInventoryItem.name.trim()) return;
    setInventoryItemSaving(true);
    setError(null);
    try {
      const created = await createPilotInventoryItem({ name: newInventoryItem.name.trim(), category: newInventoryItem.category.trim() || "Other", stockUnit: newInventoryItem.stockUnit.trim() || "each", currentOnHand: 0, latestPurchasePrice: 0, lastPurchaseUnit: newInventoryItem.stockUnit.trim() || "each", lastPurchaseConversionFactor: 1, minQuantity: 0, parLevel: 0, active: true });
      setInventoryItems((current) => [...current, created]);
      setLineInventoryItem(inventoryItemTargetIndex, created.id, draft.lineItems[inventoryItemTargetIndex]?.description ?? created.name);
      setInventoryItemTargetIndex(null);
    } catch (err) {
      setError(purchaseErrorMessage(err));
    } finally {
      setInventoryItemSaving(false);
    }
  };

  const editorStatus = purchaseStatus({ status: draft.status }, reviewSummary.state as "READY" | "REVIEW" | "BLOCKING");
  const footerSummary = reviewSummary.blockers.length
    ? `${reviewSummary.blockers.length} ${reviewSummary.blockers.length === 1 ? "issue" : "issues"} to resolve before receiving`
    : reviewSummary.warnings.length
      ? "Check the highlighted items, then receive"
      : "Everything reconciles";
  const editorContent = (
    <div className={ocrPreviewUrl ? `grid gap-5 ${wideLayout ? "2xl:grid-cols-[minmax(16rem,0.7fr)_minmax(0,1.3fr)]" : "xl:grid-cols-[minmax(18rem,0.8fr)_minmax(0,1.2fr)]"}` : ""}>
      {ocrPreviewUrl ? (
        <aside className="self-start rounded-2xl border border-brand-100 bg-brand-50 p-4 xl:sticky xl:top-0">
          <p className="text-xs font-bold uppercase tracking-wide text-brand-800">Original document</p>
          <p className="mt-1 text-sm text-muted">{ocrPreviewName} · Compare this source with the editable fields.</p>
          <a className="mt-3 inline-flex text-sm font-semibold text-brand-700 underline" href={ocrPreviewUrl} target="_blank" rel="noreferrer">Open document in a new tab</a>
          <div className="mt-4 min-h-56 overflow-hidden rounded-xl border border-line bg-white">
            {ocrPreviewType === "image" ? <img src={ocrPreviewUrl} alt="Original uploaded invoice" className="max-h-[32rem] w-full object-contain" /> : typeof navigator !== "undefined" && navigator.userAgent.toLowerCase().includes("jsdom") ? <p className="p-4 text-sm text-muted">PDF preview is unavailable in this browser. Use the link above to open the document.</p> : <iframe title="Original uploaded invoice PDF" src={ocrPreviewUrl} sandbox="" className="h-[32rem] w-full" />}
          </div>
          {ocrError ? <div role="alert" className="mt-4 rounded-xl border border-danger/20 bg-red-50 p-3 text-sm text-danger"><p>{ocrError}</p><div className="mt-3 flex flex-wrap gap-2"><Button variant="secondary" type="button" disabled={ocrLoading || !lastOcrFile} onClick={() => lastOcrFile && void uploadInvoice(lastOcrFile)}>{ocrLoading ? "Retrying…" : "Retry extraction"}</Button><Button variant="ghost" type="button" onClick={() => setOcrError(null)}>Continue manually</Button><Button variant="ghost" type="button" onClick={() => { clearOcrReview(); setEditorOpen(false); }}>Cancel</Button></div></div> : null}
          {!ocrError ? <div className="mt-4 flex flex-wrap gap-2"><Button variant="ghost" type="button" onClick={() => clearOcrReview()}>Continue manually</Button><Button variant="ghost" type="button" onClick={() => { clearOcrReview(); setEditorOpen(false); }}>Cancel</Button></div> : null}
        </aside>
      ) : null}
      <div ref={editorPanelRef} tabIndex={-1} className="scroll-mt-32 outline-none">
      <Card className={`workspace-card w-full ${ocrLoading ? "pointer-events-none opacity-60" : ""}`} data-testid="purchase-editor-card" aria-busy={ocrLoading}>
        {ocrLoading ? <div role="status" className="mb-4 flex items-center gap-2 rounded-2xl border border-brand-200 bg-brand-50 px-4 py-3 text-sm font-semibold text-brand-900"><span className="h-4 w-4 animate-spin rounded-full border-2 border-brand-200 border-t-brand-700" />Reading invoice… Extracting supplier, totals, and line items.</div> : null}
        {!draft.id && !ocrPreviewUrl ? <div className="mb-4 flex flex-col gap-3 rounded-2xl border border-brand-100 bg-brand-50/50 p-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-sm font-semibold text-ink">How would you like to add this purchase?</p><p className="mt-1 text-xs text-muted">Upload an invoice for OCR or enter the purchase details manually.</p></div><div className="flex flex-wrap gap-2"><input ref={ocrInputRef} className="sr-only" aria-label="Invoice file" type="file" accept=".jpg,.jpeg,.png,.webp,.pdf" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadInvoice(file); }} /><Button variant="secondary" icon={<FileText className="h-4 w-4" />} type="button" onClick={() => ocrInputRef.current?.click()} disabled={ocrLoading || saving}>{ocrLoading ? "Processing invoice…" : "Upload invoice"}</Button><Button variant="ghost" type="button" onClick={() => editorPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}>Enter manually</Button></div></div> : null}
        {error ? <div role="alert" className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"><p>{error}</p>{duplicateInvoiceId ? <Button variant="ghost" type="button" className="mt-2" onClick={() => void openInvoice(duplicateInvoiceId)}>Open existing purchase</Button> : null}</div> : null}
        <div className="flex flex-col gap-3 border-b border-line pb-4 sm:flex-row sm:items-start sm:justify-between">
          <SectionHeader
            title={draft.id ? `Review ${draft.invoiceNumber}` : draft.extractionStatus === "ocr" ? (draft.invoiceNumber ? `Review ${draft.invoiceNumber}` : "Review invoice") : "New purchase"}
            description={draft.status === "Corrected" ? "This purchase has been corrected and is view-only." : draft.status === "Completed" ? "This purchase is completed and view-only for receiving." : "Enter supplier details and invoice lines together, then receive when the mapping is ready."}
          />
          <div className="flex flex-wrap items-center gap-2 text-xs sm:justify-end">
            <Badge tone={editorStatus.tone}>{editorStatus.label}</Badge>
            <Badge tone={unresolvedLineCount > 0 ? "warning" : "success"}>{mappedLineCount} of {draft.lineItems.length} items mapped</Badge>
            {wideLayout ? <Button variant="ghost" type="button" onClick={() => setEditorOpen(false)}>Close panel</Button> : null}
          </div>
        </div>

        {ocrCheck && activeOcrEvidence ? (
          <div data-testid="ocr-reconciliation-banner" data-status={ocrCheck.status} role={ocrCheck.status === "matched" ? "status" : "alert"} className={`mt-4 rounded-2xl border px-4 py-3 text-sm ${ocrCheck.status === "matched" ? "border-emerald-200 bg-emerald-50 text-emerald-900" : ocrCheck.status === "incomplete" ? "border-rose-300 bg-rose-50 text-rose-900" : "border-amber-300 bg-amber-50 text-amber-900"}`}>
            <p className="font-bold">{ocrCheck.status === "matched" ? "Extracted items match the invoice" : ocrCheck.status === "incomplete" ? "Extraction looks incomplete" : "Extraction is not verified"}</p>
            <p className="mt-1 leading-6">{ocrCheck.message}</p>
            {ocrCheck.status !== "matched" ? <p className="mt-1 text-xs leading-5">Nothing was added or adjusted for you. Correct a line or add the missing one; editing the totals fields does not clear this warning.</p> : null}
            {ocrCheck.status !== "matched" && activeOcrEvidence.warnings.filter((warning) => warning !== activeOcrEvidence.serverMessage).length ? (
              <ul className="mt-2 list-disc space-y-1 pl-5 text-xs leading-5">{activeOcrEvidence.warnings.filter((warning) => warning !== activeOcrEvidence.serverMessage).map((warning) => <li key={warning}>{warning}</li>)}</ul>
            ) : null}
            {ocrCheck.status !== "matched" ? <div className="mt-3"><Button variant="secondary" type="button" onClick={addLine}>Add missing line</Button></div> : null}
            {ocrCheck.status === "incomplete" ? (
              ocrOverrideValid && draft.ocrServer?.override ? (
                <p className="mt-3 text-xs font-semibold leading-5" data-testid="ocr-override-recorded">Audited override recorded for these exact lines: {draft.ocrServer.override.reason}</p>
              ) : (
                <div className="mt-3 space-y-2 text-xs leading-5" data-testid="ocr-override-form">
                  <label className="block font-semibold" htmlFor="ocr-override-reason">Reason these lines are correct even though they do not add up to the printed amount (recorded with your name)</label>
                  <textarea id="ocr-override-reason" className="w-full rounded-xl border border-rose-200 bg-white px-3 py-2 text-sm text-ink" rows={2} value={ocrOverrideReason} onChange={(event) => setOcrOverrideReason(event.target.value)} disabled={!draft.id || ocrOverrideBusy} />
                  {!draft.id ? <p>Save the draft first; the override is recorded against the saved purchase.</p> : null}
                  {ocrOverrideError ? <p role="alert" className="font-semibold">{ocrOverrideError}</p> : null}
                  <Button variant="secondary" type="button" disabled={!draft.id || ocrOverrideBusy || ocrOverrideReason.trim().length < 10} onClick={() => void recordOcrOverride()}>{ocrOverrideBusy ? "Recording..." : "Record audited override"}</Button>
                </div>
              )
            ) : null}
          </div>
        ) : null}
        {receiveMessage ? <div aria-live="polite" className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">{receiveMessage}</div> : null}

        {!showReview ? (
          <div className="mt-4 grid gap-3 rounded-2xl border border-brand-100 bg-brand-50/40 p-3 md:grid-cols-[minmax(12rem,1.3fr)_minmax(9rem,0.8fr)_minmax(11rem,0.9fr)] md:items-end">
            <div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-semibold text-ink">Supplier</span>
                <button type="button" className="text-xs font-semibold text-brand-700 disabled:text-slate-300" onClick={() => setShowSupplierForm((value) => !value)} disabled={finalizedStatus}>
                  {showSupplierForm ? "Cancel" : "+ New supplier"}
                </button>
              </div>
              <select aria-label="Supplier" className="input mt-1" value={draft.supplierName} onChange={(event) => setDraft((current) => ({ ...current, supplierName: event.target.value }))} disabled={finalizedStatus}>
                <option value="">Choose a supplier</option>
                {data?.suppliers?.filter((supplier) => supplier.isActive !== false || normalizeLookup(supplier.name) === normalizeLookup(draft.supplierName)).map((supplier) => <option key={supplier.id} value={supplier.name}>{supplier.isActive === false ? `${supplier.name} (archived)` : supplier.name}</option>)}
              </select>
              {draft.supplierName && !(data?.suppliers ?? []).some((supplier) => normalizeLookup(supplier.name) === normalizeLookup(draft.supplierName)) ? <p className="mt-2 text-xs text-warning-700">Supplier not in directory. Confirm the name or add it before saving.</p> : null}
              {showSupplierForm ? <div className="mt-2 flex gap-2"><input aria-label="New supplier name" className="input" value={newSupplierName} onChange={(event) => setNewSupplierName(event.target.value)} placeholder="Supplier name" disabled={supplierSaving} /><Button type="button" disabled={supplierSaving || !newSupplierName.trim()} onClick={() => void createSupplier()}>{supplierSaving ? "Adding..." : "Add"}</Button></div> : null}
            </div>
            <label className="block"><span className="text-sm font-semibold text-ink">Invoice #</span><input aria-label="Invoice number" className="input mt-1" value={draft.invoiceNumber} placeholder="Optional" onChange={(event) => setDraft((current) => ({ ...current, invoiceNumber: event.target.value }))} disabled={finalizedStatus} /></label>
            <label className="block"><span className="text-sm font-semibold text-ink">Date</span><ThemedDateTimeInput className="input mt-1" type="date" value={draft.invoiceDate} onChange={(event) => setDraft((current) => ({ ...current, invoiceDate: event.target.value }))} disabled={finalizedStatus} /></label>
          </div>
        ) : null}

        {!finalizedStatus && draft.id && !authoritativeReadyToReceive ? (
          <div className="mt-4 flex justify-end">
            <Button variant="secondary" type="button" onClick={() => setShowReview(true)}>
              Review before saving
            </Button>
          </div>
        ) : null}

        <div className="mt-4 flex flex-col gap-4">
          {!showReview ? (
            <section className="order-2 space-y-4" data-testid="purchase-details-panel">
              <div className="grid gap-3 md:grid-cols-3">
                <label className="block rounded-2xl border border-line bg-slate-50 p-4">
                  <span className="text-sm font-semibold text-ink">Subtotal</span>
                  <input className="input mt-1 w-32" type="number" step="1" value={draft.subtotal} onFocus={selectZeroValue} onChange={(event) => setDraft((current) => ({ ...current, subtotal: Number(event.target.value), totalAmount: Number(event.target.value) + Number(current.tax || 0) }))} disabled={finalizedStatus} />
                </label>
                <label className="block rounded-2xl border border-line bg-slate-50 p-4">
                  <span className="text-sm font-semibold text-ink">Tax</span>
                  <input className="input mt-1 w-32" type="number" step="1" value={draft.tax} onFocus={selectZeroValue} onChange={(event) => setTax(Number(event.target.value))} disabled={finalizedStatus} />
                </label>
                <label className="block rounded-2xl border border-line bg-slate-50 p-4">
                  <span className="text-sm font-semibold text-ink">Total</span>
                  <input className="input mt-1 w-32 font-semibold" type="number" step="1" value={draft.totalAmount} onFocus={selectZeroValue} onChange={(event) => setDraft((current) => ({ ...current, totalAmount: Number(event.target.value) }))} disabled={finalizedStatus} />
                </label>
              </div>

              <label className="block rounded-2xl border border-line bg-slate-50 p-3">
                <span className="text-sm font-semibold text-ink">Notes</span>
                <textarea className="input mt-1 min-h-10" rows={1} value={draft.notes} onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))} disabled={finalizedStatus} placeholder="Optional purchase note" />
              </label>
            </section>
          ) : null}

          {!showReview ? (
            <section className="order-1 space-y-4" data-testid="purchase-lines-panel">
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
                  {draft.lineItems.map((line, index) => {
                    // Compared live against the mapped item's average cost per stock unit, both already loaded on this page.
                    const mappedItem = line.inventoryItemId ? inventoryItems.find((item) => item.id === line.inventoryItemId) : undefined;
                    const baselineCost = Number(mappedItem?.averageUnitCost ?? 0);
                    const lineUnitCost = Number(line.conversionFactor) > 0 ? Number(line.unitPrice) / Number(line.conversionFactor) : 0;
                    const priceChange = baselineCost > 0 && lineUnitCost > 0 ? ((lineUnitCost - baselineCost) / baselineCost) * 100 : null;
                    const materialPriceChange = priceChange !== null && Math.abs(priceChange) >= MATERIAL_PRICE_CHANGE_PERCENT;
                    const inventoryQuantity = formatNumber(Number((line.quantity || 0) * (line.conversionFactor || 1)));
                    const labelClass = "text-[11px] font-bold uppercase tracking-wide text-muted";
                    return (
                      <div key={line.id ?? index} data-testid={`purchase-line-${index}`} className={`rounded-xl border bg-white p-3 ${materialPriceChange ? "border-amber-300" : line.inventoryItemId ? "border-line" : "border-amber-200"}`}>
                        <div className="grid gap-2 sm:grid-cols-2 2xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1.2fr)_minmax(15rem,auto)]">
                          <label className="block">
                            <span className={labelClass}>Description</span>
                            <input className="input mt-1" value={line.description} onChange={(event) => setLineDescription(index, event.target.value)} disabled={finalizedStatus} />
                          </label>
                          <label className="block">
                            <span className={labelClass}>Inventory item</span>
                            <div className="mt-1 flex gap-2"><select className="input min-w-0" value={line.inventoryItemId ?? ""} onChange={(event) => setLineInventoryItem(index, event.target.value ? Number(event.target.value) : null, line.description)} disabled={finalizedStatus || ocrLoading}>
                              <option value="">Unmapped</option>
                              {inventoryItems.map((item) => (
                                <option key={item.id} value={item.id}>{item.name}</option>
                              ))}
                            </select><Button variant="secondary" type="button" disabled={finalizedStatus || ocrLoading} onClick={() => openInventoryItemCreator(index, line)}>+ Create</Button></div>
                          </label>
                          <div className="grid grid-cols-3 gap-2 sm:col-span-2 2xl:col-span-1">
                            <label className="block">
                              <span className={labelClass}>Quantity</span>
                              <input className="input mt-1 w-full" type="number" step="1" value={line.quantity} onFocus={selectZeroValue} onChange={(event) => updateLine(index, (current) => ({ ...current, quantity: Number(event.target.value), lineTotal: Number(event.target.value) * Number(current.unitPrice || 0) }))} disabled={finalizedStatus} />
                            </label>
                            <label className="block">
                              <span className={labelClass}>Unit price</span>
                              <input className="input mt-1 w-full" type="number" step="1" value={line.unitPrice} onFocus={selectZeroValue} onChange={(event) => updateLine(index, (current) => ({ ...current, unitPrice: Number(event.target.value), lineTotal: Number(current.quantity || 0) * Number(event.target.value) }))} disabled={finalizedStatus} />
                            </label>
                            <label className="block">
                              <span className={labelClass}>Line total</span>
                              <input className="input mt-1 w-full font-semibold" type="number" step="1" value={line.lineTotal} onFocus={selectZeroValue} onChange={(event) => updateLine(index, (current) => ({ ...current, lineTotal: Number(event.target.value) }))} disabled={finalizedStatus} />
                            </label>
                          </div>
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                          <Badge tone={line.inventoryItemId ? "success" : "warning"}>{line.inventoryItemId ? "Mapped" : "Needs mapping"}</Badge>
                          <Badge tone={line.needsReview ? "warning" : "success"}>{line.needsReview ? "Needs review" : "Confirmed"}</Badge>
                          {materialPriceChange && priceChange !== null ? <Badge tone="warning">Cost {priceChange > 0 ? "up" : "down"} {formatNumber(Math.round(Math.abs(priceChange) * 10) / 10)}% vs average cost</Badge> : null}
                          <Badge tone="neutral">{line.confidence >= 0.9 ? "High confidence" : line.confidence >= 0.7 ? "Medium confidence" : "Low confidence"}</Badge>
                          {line.inventoryItemId && mappingHints.has(`${normalizeLookup(draft.supplierName)}|${normalizeLookup(line.description)}`) ? <Badge tone="neutral">Matched from previous invoices</Badge> : null}
                          <span className="ml-auto flex items-center gap-3">
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
                          </span>
                        </div>
                        {line.inventoryItemId ? (
                          <p className="mt-1 text-xs leading-5 text-muted">
                            {line.purchaseUnit !== line.inventoryUnit
                              ? `${formatNumber(line.quantity)} ${line.purchaseUnit} × ${formatNumber(line.conversionFactor)} ${line.inventoryUnit || "each"}/${line.purchaseUnit} → ${inventoryQuantity} ${line.inventoryUnit || "each"}`
                              : `Adds ${inventoryQuantity} ${line.inventoryUnit || "each"} to inventory.`}
                          </p>
                        ) : null}
                        <div className="mt-2 border-t border-dashed border-line pt-2" role="group" aria-label={`Line ${index + 1} units and conversion`}>
                          <div className="grid grid-cols-3 gap-2">
                            <label className="block">
                              <span className={labelClass}>Purchase unit</span>
                              <input className="input mt-1" list={`purchase-units-${index}`} value={line.purchaseUnit} onChange={(event) => updateLine(index, (current) => ({ ...current, purchaseUnit: event.target.value }))} disabled={finalizedStatus} />
                              <datalist id={`purchase-units-${index}`}>
                                {commonUnits.map((unit) => (
                                  <option key={unit} value={unit} />
                                ))}
                              </datalist>
                            </label>
                            <label className="block">
                              <span className={labelClass}>Inventory unit</span>
                              <input className="input mt-1" list={`inventory-units-${index}`} value={line.inventoryUnit} onChange={(event) => updateLine(index, (current) => ({ ...current, inventoryUnit: event.target.value }))} disabled={finalizedStatus} />
                              <datalist id={`inventory-units-${index}`}>
                                {commonUnits.map((unit) => (
                                  <option key={unit} value={unit} />
                                ))}
                              </datalist>
                            </label>
                            <label className="block">
                              <span className={labelClass}>Conversion</span>
                              <input className="input mt-1" type="number" step="1" value={line.conversionFactor} onFocus={selectZeroValue} onChange={(event) => updateLine(index, (current) => ({ ...current, conversionFactor: Number(event.target.value) || 1 }))} disabled={finalizedStatus} />
                            </label>
                          </div>
                        </div>
                        {!finalizedStatus && !line.inventoryItemId ? (() => {
                          const suggestion = suggestInventoryItem(line.description, inventoryItems);
                          return suggestion ? (
                            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm" data-testid={`line-suggestion-${index}`}>
                              <Badge tone="info">Suggested</Badge>
                              <span className="text-muted">Looks like {suggestion.name}.</span>
                              <Button variant="secondary" type="button" onClick={() => setLineInventoryItem(index, suggestion.id, line.description)}>Use {suggestion.name}</Button>
                            </div>
                          ) : null;
                        })() : null}
                        {!finalizedStatus && line.description.trim() && lineBlockers(line).length > 0 ? (
                          <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-danger" aria-label={`Line ${index + 1} issues`}>
                            {lineBlockers(line).map((reason) => <li key={reason}>{reason}</li>)}
                          </ul>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            </section>
          ) : null}

          {showReview ? (
            <section className="order-3 space-y-4" data-testid="purchase-review-panel">
              <div className="rounded-2xl border border-line bg-white p-4" data-testid="purchase-review-summary">
                <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-sm font-semibold text-ink">Review summary</p><p className="mt-1 text-xs text-muted">Every line must reconcile before inventory is changed.</p></div><div className="flex flex-wrap items-center gap-2"><Badge tone={reviewSummary.state === "READY" ? "success" : reviewSummary.state === "BLOCKING" ? "danger" : "warning"}>{reviewSummary.state}</Badge>{unresolvedLineCount > 0 ? <Badge tone="warning">Needs mapping</Badge> : null}</div></div>
                {reviewSummary.blockers.length ? <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-danger">{reviewSummary.blockers.map((message) => <li key={message}>{message}</li>)}</ul> : null}
                {reviewSummary.warnings.length ? <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-muted">{reviewSummary.warnings.map((message) => <li key={message}>{message}</li>)}</ul> : null}
                {"reconciliation" in reviewSummary && reviewSummary.reconciliation ? (() => { const reconciliation = reviewSummary.reconciliation as NonNullable<PilotPurchaseInvoice["reviewSummary"]>["reconciliation"]; return <p className="mt-3 text-sm font-semibold text-ink">{reconciliation?.status === "matched" ? "Totals match" : `Totals differ by ${formatMoney(Math.abs(reconciliation?.totalDifference ?? 0))}`}</p>; })() : null}
                {purchasePreview?.lines?.length ? <div className="mt-4 overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr className="border-b border-line text-muted"><th className="px-2 py-2">Inventory impact</th><th className="px-2 py-2">Before</th><th className="px-2 py-2">Receiving</th><th className="px-2 py-2">After</th><th className="px-2 py-2">Cost after</th><th className="px-2 py-2">Price change</th></tr></thead><tbody>{purchasePreview.lines.map((line) => <tr key={line.lineId} className="border-b border-line"><td className="px-2 py-2 font-semibold text-ink">{line.inventoryItemName || line.description}</td><td className="px-2 py-2">{line.currentOnHand ?? "—"} {line.unit}</td><td className="px-2 py-2">+{line.quantityDelta} {line.unit}</td><td className="px-2 py-2">{line.afterOnHand ?? "—"} {line.unit}</td><td className="px-2 py-2">{line.averageUnitCostAfter == null ? "—" : formatMoney(line.averageUnitCostAfter)}</td><td className="px-2 py-2">{line.priceChangePercent == null ? "—" : `${line.priceChangePercent > 0 ? "+" : ""}${formatNumber(line.priceChangePercent)}%`}</td></tr>)}</tbody></table><p className="mt-2 text-xs text-muted">Preview only. Inventory changes occur only after you receive.</p></div> : null}
              </div>
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
                    disabled={saving || !draft.id || finalizedStatus || !authoritativeReadyToReceive}
                    icon={<CheckCircle2 className="h-4 w-4" />}
                    type="button"
                    onClick={requestReceive}
                  >
                    Receive into inventory
                  </Button>
                </div>
              </div>

              {draft.correctsInvoiceId ? (
                <div className="rounded-2xl border border-line bg-slate-50 p-4 text-sm text-muted">
                  <p className="font-semibold text-ink">Corrected copy of a voided invoice</p>
                  <p className="mt-1">Check the numbers against the supplier&apos;s corrected invoice, then receive it as a new purchase. The invoice number was suffixed so it can be saved; change it if the supplier issued a new one.</p>
                  <Button className="mt-3" variant="secondary" type="button" onClick={() => void openInvoice(draft.correctsInvoiceId as number)}>
                    Open voided original
                  </Button>
                </div>
              ) : null}

              <div className="rounded-2xl border border-line bg-white p-4 text-sm text-muted">
                <p className="font-semibold text-ink">Purchase status</p>
                <p className="mt-1">Completed purchases become view-only and can no longer be received twice. Corrected purchases stay view-only and preserve the audit trail. Save ready is available only when every item is mapped.</p>
              </div>
            </section>
          ) : null}
        </div>
        {!finalizedStatus ? (
          <div data-testid="purchase-action-bar" className={`sticky z-10 -mx-4 mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-line bg-white px-4 py-3 shadow-[0_-4px_12px_rgba(15,23,42,0.06)] ${wideLayout ? "bottom-0" : "-bottom-4"}`}>
            <p className={`min-w-0 text-sm font-semibold ${reviewSummary.blockers.length ? "text-danger" : "text-muted"}`}>{footerSummary}</p>
            <div className="grid w-full grid-cols-3 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:justify-end">
              <Button variant="ghost" disabled={ocrLoading} type="button" onClick={() => setShowReview(true)}>
                Review
              </Button>
              <Button variant="secondary" disabled={saving || ocrLoading} type="button" onClick={() => void saveDraft("Draft")}>
                {savingAction === "draft" ? "Saving..." : "Save draft"}
              </Button>
              <Button disabled={saving || ocrLoading || !authoritativeReadyToReceive} type="button" onClick={requestReceive}>
                {savingAction === "receive" ? "Receiving..." : "Save & receive"}
              </Button>
            </div>
          </div>
        ) : null}
      </Card>
      </div>
    </div>
  );

  return (
    <div className="workspace-page">
      <Card className="surface-panel workspace-card p-3 sm:p-4">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            {[
              { label: "Needs review", value: hasLoaded ? formatNumber(data?.summary?.uploadsNeedingReview ?? 0) : "—" },
              { label: "Material price changes", value: hasLoaded ? formatNumber(data?.summary?.priceChangesFlagged ?? 0) : "—" },
              { label: "Received this month", value: hasLoaded ? formatNumber(data?.summary?.receivedThisMonth ?? 0) : "—" },
              { label: "Spend this month", value: hasLoaded ? formatMoney(data?.summary?.thisMonthSpend ?? 0) : "—" },
            ].map((metric) => (
              <div key={metric.label} className="flex items-center gap-2 rounded-full border border-line bg-white px-3 py-1.5">
                <span className="text-[11px] font-bold uppercase tracking-wide text-muted">{metric.label}</span>
                <span className="text-sm font-bold text-ink">{metric.value}</span>
              </div>
            ))}
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button
              icon={<Plus className="h-4 w-4" />}
              type="button"
              disabled={saving || voiding}
              onClick={() => {
                setSelectedId(null);
                setReceiveMessage(null);
                setDraft(buildBlankDraft());
                clearOcrReview();
                setShowReview(false);
                setEditorOpen(true);
              }}
            >
              New purchase
            </Button>
            <Button variant="secondary" icon={<RefreshCcw className="h-4 w-4" />} type="button" onClick={() => void load()} disabled={loading}>
              Refresh
            </Button>
          </div>
        </div>

        {loading ? <div className="mt-5 text-sm text-muted">{initialLoading ? "Loading purchases…" : "Refreshing purchases…"}</div> : null}
        {error && !editorOpen ? <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"><span>{error}</span><Button variant="secondary" type="button" onClick={() => void load()} disabled={loading}>Retry</Button></div> : null}
        {receiveMessage && !editorOpen ? <div aria-live="polite" className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">{receiveMessage}</div> : null}

      </Card>

      {editorOpen && !wideLayout ? <Modal title={ocrPreviewUrl ? "Review uploaded invoice" : "Purchase editor"} size="full" onClose={() => setEditorOpen(false)}>
        {editorContent}
      </Modal> : null}

      {inventoryItemTargetIndex != null ? <Modal title="Create inventory item" size="small" onClose={() => setInventoryItemTargetIndex(null)}>
        <p className="text-sm text-muted">Create the missing item and keep this invoice draft open.</p>
        <div className="mt-4 space-y-3">
          <label className="block"><span className="text-sm font-semibold text-ink">Item name</span><input className="input mt-1" value={newInventoryItem.name} onChange={(event) => setNewInventoryItem((current) => ({ ...current, name: event.target.value }))} /></label>
          <label className="block"><span className="text-sm font-semibold text-ink">Category</span><input className="input mt-1" value={newInventoryItem.category} onChange={(event) => setNewInventoryItem((current) => ({ ...current, category: event.target.value }))} /></label>
          <label className="block"><span className="text-sm font-semibold text-ink">Stock unit</span><input className="input mt-1" value={newInventoryItem.stockUnit} onChange={(event) => setNewInventoryItem((current) => ({ ...current, stockUnit: event.target.value }))} /></label>
          <div className="flex justify-end gap-2"><Button variant="secondary" type="button" onClick={() => setInventoryItemTargetIndex(null)}>Cancel</Button><Button type="button" disabled={inventoryItemSaving || !newInventoryItem.name.trim()} onClick={() => void createInventoryItemInline()}>{inventoryItemSaving ? "Creating…" : "Create item"}</Button></div>
        </div>
      </Modal> : null}

      <div className="pilot-purchases-layout grid gap-4 xl:grid-cols-[minmax(20rem,26rem)_minmax(0,1fr)] xl:items-start">
        <div
          className="flex min-w-0 flex-col gap-4 xl:sticky xl:top-4 xl:max-h-[calc(100vh-2rem)] xl:overflow-y-auto"
          data-testid="purchase-queue"
          onKeyDown={(event) => {
            if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
            const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button[data-queue-item]"));
            const at = items.indexOf(document.activeElement as HTMLButtonElement);
            if (at === -1) return;
            event.preventDefault();
            items[Math.min(items.length - 1, Math.max(0, at + (event.key === "ArrowDown" ? 1 : -1)))]?.focus();
          }}
        >
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center xl:flex-col xl:items-stretch">
            <input className="input sm:max-w-xl xl:max-w-none" aria-label="Search purchases" placeholder="Search supplier or invoice number" value={purchaseSearch} onChange={(event) => setPurchaseSearch(event.target.value)} />
            <select className="input w-full sm:w-44 xl:w-full" aria-label="Purchase filter" value={purchaseFilter} onChange={(event) => setPurchaseFilter(event.target.value as typeof purchaseFilter)}><option value="all">All purchases</option><option value="review">Needs review</option><option value="received">Received</option><option value="corrected">Voided</option></select>
          </div>
          <Card className="w-full p-4" data-testid="purchase-review-card">
            <SectionHeader title="Needs review" />
            <div className="max-h-[26rem] space-y-2 overflow-y-auto pr-1 xl:max-h-none">
              {filteredInvoices.filter((invoice) => invoice.status !== "Completed" && invoice.status !== "Corrected").map((invoice) => {
                const status = purchaseStatus(invoice);
                const active = selectedId === invoice.id && editorOpen;
                return (
                  <button key={invoice.id} type="button" data-queue-item disabled={saving || voiding} aria-current={active ? "true" : undefined} onClick={() => void openInvoice(invoice.id)} className={`purchase-review-item w-full rounded-xl border px-3 py-3 text-left transition hover:shadow-soft ${active ? "border-brand-400 bg-brand-50 ring-2 ring-brand-200" : "border-amber-200 bg-amber-50/50"}`}>
                    <div className="flex items-start justify-between gap-3"><div><p className="font-semibold text-ink">{invoice.supplier?.name ?? "Supplier"}</p><p className="text-sm text-muted">{invoice.invoiceNumber} • {formatDate(invoice.invoiceDate)}</p></div><Badge tone={status.tone}>{status.label}</Badge></div>
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm text-muted"><span>{formatMoney(invoice.totalAmount)}</span><span>{invoice.lineItems.length} lines · {invoice.reviewSummary?.mappedLineCount ?? 0}/{invoice.lineItems.length} matched</span></div>
                    {invoice.reviewSummary?.blockers?.[0] ? <p className="mt-2 text-xs text-danger">{invoice.reviewSummary.blockers[0]}</p> : invoice.reviewSummary?.warnings?.[0] ? <p className="mt-2 text-xs text-muted">{invoice.reviewSummary.warnings[0]}</p> : null}
                  </button>
                );
              })}
              {initialLoading ? <p className="text-sm text-muted">Loading review items…</p> : null}
              {!loading && hasLoaded && !(data?.invoices ?? []).some((invoice) => invoice.status !== "Completed" && invoice.status !== "Corrected") ? <p className="rounded-xl border border-dashed border-line px-3 py-6 text-sm text-muted">No purchases need review.</p> : null}
            </div>
          </Card>
          <Card className="w-full p-4" data-testid="purchase-history-card">
            <SectionHeader title="Purchase history" />
            <div className="max-h-[26rem] space-y-2 overflow-y-auto pr-1 xl:max-h-none">
              {filteredInvoices.filter((invoice) => invoice.status === "Completed" || invoice.status === "Corrected").map((invoice) => {
                const status = purchaseStatus(invoice);
                const active = detailInvoice?.id === invoice.id;
                return (
                  <button key={invoice.id} type="button" data-queue-item disabled={saving || voiding} aria-current={active ? "true" : undefined} onClick={() => void openInvoice(invoice.id)} className={`w-full rounded-xl border px-3 py-3 text-left transition hover:shadow-soft ${active || selectedInvoice?.id === invoice.id ? "border-brand-400 bg-brand-50 ring-2 ring-brand-200" : "border-line bg-slate-50"}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold text-ink">{invoice.supplier?.name ?? "Supplier"}</p>
                        <p className="text-sm text-muted">{invoice.invoiceNumber} • {formatDate(invoice.invoiceDate)}</p>
                      </div>
                      <Badge tone={status.tone}>{status.label}</Badge>
                    </div>
                    <div className="mt-2 flex items-center justify-between text-sm text-muted">
                      <span>{formatMoney(invoice.totalAmount)}</span>
                      <span>{invoice.lineItems.length} invoice items</span>
                    </div>
                  </button>
                );
              })}
              {!loading && hasLoaded && !invoiceRows.some((invoice) => invoice.status === "Completed" || invoice.status === "Corrected") ? <p className="rounded-xl border border-dashed border-line px-3 py-6 text-sm text-muted">No completed purchases yet.</p> : null}
            </div>
            {data?.invoices?.length && data.invoices.length > 5 ? (
              <button type="button" className="mt-4 text-sm font-semibold text-brand-700" onClick={() => setShowAll((value) => !value)}>
                {showAll ? "Show fewer purchases" : "View all purchases"}
              </button>
            ) : null}
          </Card>
        </div>
        {wideLayout ? (
          <div className="min-w-0" data-testid="purchase-side-panel">
            {editorOpen ? editorContent : detailInvoice ? (
              <PurchaseInvoiceDetailsModal inline invoice={detailInvoice} refreshFailure={voidRefresh && voidRefresh.invoiceId === detailInvoice.id ? voidRefresh.message : null} refreshing={loading} onRefresh={() => void refreshAfterVoid()} onClose={closeDetailInvoice} onVoid={voidInvoice} onOpenInvoice={(invoiceId) => void openInvoice(invoiceId)} />
            ) : (
              <Card className="p-8 text-center">
                <p className="font-semibold text-ink">Select a purchase to review it here</p>
                <p className="mt-1 text-sm text-muted">Pick an invoice from the queue, or choose New purchase to upload an invoice or enter one by hand.</p>
              </Card>
            )}
          </div>
        ) : null}
      </div>

      {receiveConfirmOpen ? (
        <Modal title="Confirm receipt" size="small" onClose={() => { if (!saving) setReceiveConfirmOpen(false); }}>
          <p className="text-sm text-muted">This will update inventory for {draft.lineItems.length} mapped invoice {draft.lineItems.length === 1 ? "line" : "lines"} and record the receipt. Confirm only after reviewing the quantities and costs.</p>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" type="button" disabled={saving} onClick={() => setReceiveConfirmOpen(false)}>Cancel</Button>
            {receiveReconciliationInvoiceId !== null ? <Button variant="secondary" type="button" disabled={saving} onClick={() => void reconcileReceiptStatus()}>Refresh purchase status</Button> : null}
            <Button type="button" disabled={saving || receiveReconciliationInvoiceId !== null} onClick={() => void (draft.id ? receiveInvoice() : saveAndReceive())}>{saving ? "Receiving…" : receiveReconciliationInvoiceId !== null ? "Reconcile status first" : "Confirm receive"}</Button>
          </div>
        </Modal>
      ) : null}
      {!wideLayout ? <PurchaseInvoiceDetailsModal invoice={detailInvoice} refreshFailure={voidRefresh && voidRefresh.invoiceId === detailInvoice?.id ? voidRefresh.message : null} refreshing={loading} onRefresh={() => void refreshAfterVoid()} onClose={closeDetailInvoice} onVoid={voidInvoice} onOpenInvoice={(invoiceId) => void openInvoice(invoiceId)} /> : null}
    </div>
  );
}
