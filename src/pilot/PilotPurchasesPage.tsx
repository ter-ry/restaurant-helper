import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, FileUp, Plus, RefreshCcw, Sparkles } from "lucide-react";
import { useLocation } from "react-router-dom";
import { Badge } from "../components/Badge";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { SectionHeader } from "../components/SectionHeader";
import { captureInvoiceDocument, isSupportedInvoiceUpload } from "../lib/invoiceCapture";
import {
  PilotApiError,
  createPilotInventoryItem,
  createPilotPurchaseInvoice,
  createPilotSupplier,
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
import { formatDate, formatMoney, formatNumber, statusTone } from "./workspace/pilotWorkspaceUtils";

interface DraftLine {
  clientId: string;
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

type InlineNotice = {
  kind: "success" | "error";
  title: string;
  message: string;
};

type ValidationErrors = Record<string, string>;

type InlineSupplierDraft = {
  name: string;
  categoryFocus: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  orderingNotes: string;
  notes: string;
};

type InlineInventoryDraft = {
  name: string;
  category: string;
  stockUnit: string;
  currentOnHand: number;
  minQuantity: number;
  parLevel: number;
  preferredSupplierName: string;
  latestPurchasePrice: number;
  lastPurchaseUnit: string;
  lastPurchaseConversionFactor: number;
  notes: string;
  active: boolean;
};

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function createLineClientId() {
  if (typeof globalThis.crypto !== "undefined" && typeof globalThis.crypto.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `line-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}

function normalizeLookup(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function blankLine(): DraftLine {
  return {
    clientId: createLineClientId(),
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
    invoiceNumber: `FP-${String(Math.floor(Math.random() * 9000) + 1000)}`,
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

function buildBlankSupplierDraft(): InlineSupplierDraft {
  return {
    name: "",
    categoryFocus: "Other",
    contactName: "",
    contactPhone: "",
    contactEmail: "",
    orderingNotes: "",
    notes: "",
  };
}

function buildInlineInventoryDraft(line: DraftLine, supplierName: string): InlineInventoryDraft {
  return {
    name: line.description.trim() || "New inventory item",
    category: "Other",
    stockUnit: line.inventoryUnit || line.purchaseUnit || "each",
    currentOnHand: 0,
    minQuantity: 0,
    parLevel: 0,
    preferredSupplierName: supplierName,
    latestPurchasePrice: Number.isFinite(line.unitPrice) ? Number(line.unitPrice.toFixed(2)) : 0,
    lastPurchaseUnit: line.purchaseUnit || "each",
    lastPurchaseConversionFactor: Number.isFinite(line.conversionFactor) && line.conversionFactor > 0 ? line.conversionFactor : 1,
    notes: "",
    active: true,
  };
}

function hasValidationError(errors: ValidationErrors, key: string) {
  return Object.keys(errors).some((candidate) => candidate === key || candidate.startsWith(`${key}.`) || candidate.startsWith(`${key}[`));
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
          clientId: line.id != null ? `line-${line.id}` : createLineClientId(),
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

function createDraftFromOcr(
  result: Awaited<ReturnType<typeof captureInvoiceDocument>>,
  file: File,
  inventoryItems: PilotInventoryItem[],
  mappingHints: Map<string, MappingHint>,
): PurchaseDraft {
  const supplierName = result.fields.supplier.value.trim() || "Unknown supplier";
  const normalizedSupplier = normalizeLookup(supplierName);
  const lineItems = result.lineItems.length
    ? result.lineItems.map((item, index) => {
        const description = item.itemName || item.originalDescription || `Line item ${index + 1}`;
        const normalizedDescription = normalizeLookup(description);
        const hint = mappingHints.get(`${normalizedSupplier}|${normalizedDescription}`) ?? null;
        const matchedItem = inventoryItems.find((candidate) => normalizeLookup(candidate.name) === normalizedDescription) ?? null;
        const inventoryItemId = hint?.inventoryItemId ?? matchedItem?.id ?? null;
        const inventoryItem = inventoryItemId ? inventoryItems.find((candidate) => candidate.id === inventoryItemId) ?? null : null;

        return {
          clientId: createLineClientId(),
          description,
          inventoryItemId,
          purchaseUnit: hint?.purchaseUnit ?? item.unit ?? inventoryItem?.lastPurchaseUnit ?? "each",
          inventoryUnit: hint?.inventoryUnit ?? inventoryItem?.stockUnit ?? item.unit ?? "each",
          conversionFactor: hint?.conversionFactor ?? 1,
          quantity: Number.isFinite(item.quantity) && item.quantity > 0 ? item.quantity : 1,
          unitPrice: Number.isFinite(item.unitPrice) ? Number(item.unitPrice.toFixed(2)) : 0,
          lineTotal: Number.isFinite(item.lineTotal) ? Number(item.lineTotal.toFixed(2)) : 0,
          confidence: item.confidence,
          needsReview: item.needsReview,
          note: "",
        };
      })
    : [blankLine()];

  return {
    id: null,
    supplierName,
    invoiceNumber: result.fields.invoiceNumber.value.trim() || `OCR-${Date.now().toString(36).toUpperCase()}`,
    invoiceDate: result.fields.invoiceDate.value || todayIso(),
    subtotal: Number.isFinite(result.fields.subtotal.value) ? Number(result.fields.subtotal.value.toFixed(2)) : 0,
    tax: Number.isFinite(result.fields.tax.value) ? Number(result.fields.tax.value.toFixed(2)) : 0,
    totalAmount: Number.isFinite(result.fields.total.value) ? Number(result.fields.total.value.toFixed(2)) : 0,
    notes: result.warnings.join(" "),
    status: result.needsReview ? "Draft" : "Ready",
    sourceFileName: file.name,
    sourceFileType: file.type || "application/octet-stream",
    extractionStatus: result.provider,
    extractedText: result.rawText,
    lineItems,
  };
}

export function PilotPurchasesPage() {
  const location = useLocation();
  const [data, setData] = useState<PilotPurchasesResponse | null>(null);
  const [inventoryItems, setInventoryItems] = useState<PilotInventoryItem[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [draft, setDraft] = useState<PurchaseDraft>(buildBlankDraft());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [receiveMessage, setReceiveMessage] = useState<string | null>(null);
  const [ocrMessage, setOcrMessage] = useState<string | null>(null);
  const [correctionNote, setCorrectionNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<InlineNotice | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [supplierCreateOpen, setSupplierCreateOpen] = useState(false);
  const [supplierSaving, setSupplierSaving] = useState(false);
  const [supplierDraft, setSupplierDraft] = useState<InlineSupplierDraft>(() => buildBlankSupplierDraft());
  const [supplierFieldErrors, setSupplierFieldErrors] = useState<ValidationErrors>({});
  const [inventoryCreateLineId, setInventoryCreateLineId] = useState<string | null>(null);
  const [inventorySavingLineId, setInventorySavingLineId] = useState<string | null>(null);
  const [inventoryDraft, setInventoryDraft] = useState<InlineInventoryDraft>(() => buildInlineInventoryDraft(blankLine(), ""));
  const [inventoryFieldErrors, setInventoryFieldErrors] = useState<ValidationErrors>({});
  const [draftFieldErrors, setDraftFieldErrors] = useState<ValidationErrors>({});
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const supplierSelectRef = useRef<HTMLSelectElement | null>(null);
  const supplierInputRef = useRef<HTMLInputElement | null>(null);
  const inventoryNameRef = useRef<HTMLInputElement | null>(null);
  const invoiceNumberRef = useRef<HTMLInputElement | null>(null);
  const invoiceDateRef = useRef<HTMLInputElement | null>(null);
  const totalAmountRef = useRef<HTMLInputElement | null>(null);
  const firstLineDescriptionRef = useRef<HTMLInputElement | null>(null);
  const editorPanelRef = useRef<HTMLDivElement | null>(null);
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

  const handleOcrUpload = async (file: File | null | undefined) => {
    if (!file) {
      return;
    }
    if (!isSupportedInvoiceUpload(file)) {
      setError("Upload a JPG, PNG, WEBP, or PDF invoice.");
      return;
    }

    setOcrLoading(true);
    setError(null);
    setReceiveMessage(null);
    setOcrMessage(null);

    try {
      const result = await captureInvoiceDocument(file);
      setDraft(createDraftFromOcr(result, file, inventoryItems, mappingHints));
      setSelectedId(null);
      setOcrMessage(`OCR draft loaded from ${file.name}. Review the fields before saving.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not extract the invoice.");
    } finally {
      setOcrLoading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const load = async (preferredInvoiceId: number | null = requestedInvoiceId) => {
    setLoading(true);
    setError(null);
    setDraftFieldErrors({});
    setSupplierFieldErrors({});
    setInventoryFieldErrors({});

    try {
      const [purchases, inventory] = await Promise.all([fetchPilotPurchases(), fetchPilotInventory()]);
      setData(purchases);
      setInventoryItems(inventory.items);
      setSupplierCreateOpen(purchases.suppliers.length === 0);
      setSupplierDraft(buildBlankSupplierDraft());
      setInventoryCreateLineId(null);
      setInventorySavingLineId(null);
      setInventoryDraft(buildInlineInventoryDraft(blankLine(), ""));
      setDraftFieldErrors({});
      setSupplierFieldErrors({});
      setInventoryFieldErrors({});
      setOcrMessage(null);
      const requestedInvoice = preferredInvoiceId ? purchases.invoices.find((invoice) => invoice.id === preferredInvoiceId) ?? null : null;
      const currentInvoice = requestedInvoice ?? (selectedId !== null ? purchases.invoices.find((invoice) => invoice.id === selectedId) ?? null : purchases.invoices[0] ?? null);
      if (currentInvoice) {
        setSelectedId(currentInvoice.id);
        setDraft(invoiceToDraft(currentInvoice));
      } else {
        setDraft(buildBlankDraft());
        setSelectedId(null);
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

  const hasSuppliers = (data?.suppliers.length ?? 0) > 0;

  useEffect(() => {
    if (!hasSuppliers) {
      setSupplierCreateOpen(true);
    }
  }, [hasSuppliers]);

  useEffect(() => {
    if (!notice || notice.kind !== "success") {
      return;
    }

    const timeout = window.setTimeout(() => setNotice(null), 3500);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  const inventoryItemOptions = [...inventoryItems].sort((a, b) => a.name.localeCompare(b.name));
  const showNotice = (kind: InlineNotice["kind"], title: string, message: string) => {
    setNotice({ kind, title, message });
  };
  const lineKey = (line: DraftLine) => line.clientId;

  const scrollEditorIntoView = (focusTarget?: "supplier-select" | "supplier-input") => {
    window.requestAnimationFrame(() => {
      editorPanelRef.current?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
      if (focusTarget === "supplier-select" || (focusTarget === undefined && hasSuppliers && !supplierCreateOpen)) {
        supplierSelectRef.current?.focus();
      } else if (focusTarget === "supplier-input" || focusTarget === undefined) {
        supplierInputRef.current?.focus();
      }
    });
  };

  const focusPurchaseValidationTarget = (errors: ValidationErrors) => {
    window.requestAnimationFrame(() => {
      if (hasValidationError(errors, "supplierName")) {
        if (hasSuppliers && !supplierCreateOpen) {
          supplierSelectRef.current?.focus();
        } else {
          supplierInputRef.current?.focus();
        }
        return;
      }
      if (hasValidationError(errors, "invoiceNumber")) {
        invoiceNumberRef.current?.focus();
        return;
      }
      if (hasValidationError(errors, "invoiceDate")) {
        invoiceDateRef.current?.focus();
        return;
      }
      if (hasValidationError(errors, "totalAmount")) {
        totalAmountRef.current?.focus();
        return;
      }
      if (hasValidationError(errors, "lineItems")) {
        firstLineDescriptionRef.current?.focus();
      }
    });
  };

  const firstValidationMessage = Object.values(draftFieldErrors)[0] ?? null;

  const refreshCollections = async () => {
    const [purchases, inventory] = await Promise.all([fetchPilotPurchases(), fetchPilotInventory()]);
    setData(purchases);
    setInventoryItems(inventory.items);
    return { purchases, inventory };
  };

  const selectedInvoice = useMemo(
    () => data?.invoices.find((invoice) => invoice.id === selectedId) ?? null,
    [data?.invoices, selectedId],
  );

  useEffect(() => {
    if (selectedInvoice) {
      setDraft(invoiceToDraft(selectedInvoice));
      setCorrectionNote("");
    }
  }, [selectedInvoice]);

  const invoiceRows = showAll ? data?.invoices ?? [] : (data?.invoices ?? []).slice(0, 5);
  const priceChanges = (data?.priceChanges ?? []).slice(0, 3);
  const finalizedStatus = draft.status === "Completed" || draft.status === "Corrected";
  const mappedLineCount = draft.lineItems.filter((line) => line.inventoryItemId).length;
  const unresolvedLineCount = draft.lineItems.filter((line) => !line.inventoryItemId).length;
  const readyToReceive = !finalizedStatus && unresolvedLineCount === 0 && mappedLineCount > 0 && draft.lineItems.every((line) => line.conversionFactor > 0 && line.quantity > 0);

  const recalculateTotals = (lines: DraftLine[], nextTax = draft.tax) => {
    const subtotal = lines.reduce((sum, line) => sum + Number(line.lineTotal || line.quantity * line.unitPrice), 0);
    return {
      lineItems: lines,
      subtotal,
      totalAmount: subtotal + Number(nextTax || 0),
    };
  };

  const updateLine = (clientId: string, updater: (line: DraftLine) => DraftLine) => {
    setDraft((current) => ({
      ...current,
      ...recalculateTotals(current.lineItems.map((line) => (line.clientId === clientId ? updater(line) : line)), current.tax),
    }));
  };

  const setTax = (tax: number) => {
    setDraft((current) => ({
      ...current,
      tax,
      totalAmount: current.subtotal + tax,
    }));
  };

  const startBlankDraft = (message: string) => {
    setSelectedId(null);
    setReceiveMessage(null);
    setError(null);
    setOcrMessage(null);
    setDraftFieldErrors({});
    setSupplierFieldErrors({});
    setInventoryFieldErrors({});
    setCorrectionNote("");
    setDraft(buildBlankDraft());
    setSupplierDraft(buildBlankSupplierDraft());
    setInventoryCreateLineId(null);
    setNotice({
      kind: "success",
      title: "Blank purchase draft ready",
      message,
    });
    scrollEditorIntoView(hasSuppliers ? "supplier-select" : "supplier-input");
  };

  const createSupplier = async () => {
    if (supplierSaving) {
      return;
    }

    const name = supplierDraft.name.trim();
    if (!name) {
      showNotice("error", "Supplier name required", "Enter a supplier name before creating the first vendor.");
      setSupplierFieldErrors({ name: "Supplier name is required." });
      supplierInputRef.current?.focus();
      return;
    }

    setSupplierSaving(true);
    setError(null);
    setSupplierFieldErrors({});

    try {
      await createPilotSupplier({
        name,
        categoryFocus: supplierDraft.categoryFocus,
        contactName: supplierDraft.contactName,
        contactPhone: supplierDraft.contactPhone,
        contactEmail: supplierDraft.contactEmail,
        orderingNotes: supplierDraft.orderingNotes,
        notes: supplierDraft.notes,
        isActive: true,
      });
      const refreshed = await refreshCollections();
      setDraft((current) => ({
        ...current,
        supplierName: name,
      }));
      setSupplierDraft(buildBlankSupplierDraft());
      setSupplierCreateOpen(false);
      const supplierCount = refreshed.purchases.suppliers.length;
      showNotice("success", "Supplier created", `${name} is now available for this purchase${supplierCount > 1 ? " and the updated supplier list has been reloaded." : "."}`);
      window.requestAnimationFrame(() => {
        scrollEditorIntoView("supplier-select");
        supplierSelectRef.current?.focus();
      });
    } catch (err) {
      const fieldErrors = err instanceof PilotApiError ? (err.errors ?? {}) : {};
      const message = err instanceof Error ? err.message : "Could not create the supplier.";
      setError(message);
      setSupplierFieldErrors(fieldErrors);
      showNotice("error", "Supplier save failed", message);
      if (Object.keys(fieldErrors).length > 0) {
        window.requestAnimationFrame(() => {
          if (fieldErrors.name) {
            supplierInputRef.current?.focus();
          } else {
            supplierSelectRef.current?.focus();
          }
        });
      }
    } finally {
      setSupplierSaving(false);
    }
  };

  const beginInventoryCreation = (line: DraftLine, _index: number) => {
    setInventoryCreateLineId(lineKey(line));
    setInventoryDraft(buildInlineInventoryDraft(line, draft.supplierName.trim()));
    showNotice("success", "Create inventory item", "Confirm the item details and save it below.");
  };

  const cancelInventoryCreation = () => {
    setInventoryCreateLineId(null);
    setInventoryDraft(buildInlineInventoryDraft(blankLine(), draft.supplierName.trim()));
  };

  const createInventoryItemForLine = async (line: DraftLine, _index: number) => {
    if (inventorySavingLineId) {
      return;
    }

    const currentLineKey = lineKey(line);
    const name = inventoryDraft.name.trim() || line.description.trim();
    if (!name) {
      showNotice("error", "Inventory item name required", "Enter a name before creating the first item.");
      setInventoryFieldErrors({ name: "Inventory item name is required." });
      inventoryNameRef.current?.focus();
      return;
    }

    setInventorySavingLineId(currentLineKey);
    setError(null);
    setInventoryFieldErrors({});

    try {
      const saved = await createPilotInventoryItem({
        name,
        category: inventoryDraft.category,
        stockUnit: inventoryDraft.stockUnit,
        currentOnHand: inventoryDraft.currentOnHand,
        minQuantity: inventoryDraft.minQuantity,
        parLevel: inventoryDraft.parLevel,
        preferredSupplierName: inventoryDraft.preferredSupplierName || draft.supplierName || "",
        latestPurchasePrice: inventoryDraft.latestPurchasePrice,
        lastPurchaseUnit: inventoryDraft.lastPurchaseUnit,
        lastPurchaseConversionFactor: inventoryDraft.lastPurchaseConversionFactor,
        notes: inventoryDraft.notes,
        active: inventoryDraft.active,
      });
      await refreshCollections();
      setDraft((current) => ({
        ...current,
        lineItems: current.lineItems.map((entry) =>
          entry.clientId === line.clientId
            ? {
                ...entry,
                inventoryItemId: saved.id,
                inventoryUnit: saved.stockUnit || entry.inventoryUnit,
                purchaseUnit: saved.lastPurchaseUnit || entry.purchaseUnit,
                conversionFactor: saved.lastPurchaseConversionFactor || entry.conversionFactor,
                needsReview: false,
              }
            : entry,
        ),
      }));
      setInventoryCreateLineId(null);
      setInventoryDraft(buildInlineInventoryDraft(blankLine(), draft.supplierName.trim()));
      showNotice("success", "Inventory item created", `${saved.name} is now mapped to this line.`);
      window.requestAnimationFrame(() => {
        scrollEditorIntoView("supplier-select");
      });
    } catch (err) {
      const fieldErrors = err instanceof PilotApiError ? (err.errors ?? {}) : {};
      const message = err instanceof Error ? err.message : "Could not create the inventory item.";
      setError(message);
      setInventoryFieldErrors(fieldErrors);
      showNotice("error", "Inventory save failed", message);
      if (Object.keys(fieldErrors).length > 0) {
        window.requestAnimationFrame(() => {
          if (fieldErrors.name) {
            inventoryNameRef.current?.focus();
          }
        });
      }
    } finally {
      setInventorySavingLineId(null);
    }
  };

  const saveDraft = async (status: string) => {
    setSaving(true);
    setReceiveMessage(null);
    setError(null);
    setDraftFieldErrors({});

    try {
      if (status === "Ready" && unresolvedLineCount > 0) {
        throw new Error("Map every invoice line before marking the purchase ready.");
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
      setOcrMessage(null);
      await load(saved.id);
      showNotice("success", "Purchase saved", `Invoice ${saved.invoiceNumber} saved successfully.`);
    } catch (err) {
      const fieldErrors = err instanceof PilotApiError ? (err.errors ?? {}) : {};
      const message = err instanceof Error ? err.message : "Could not save the purchase.";
      setError(message);
      setDraftFieldErrors(fieldErrors);
      showNotice("error", "Purchase save failed", message);
      if (Object.keys(fieldErrors).length > 0) {
        focusPurchaseValidationTarget(fieldErrors);
      }
    } finally {
      setSaving(false);
    }
  };

  const receiveInvoice = async () => {
    if (!draft.id) {
      return;
    }
    if (!readyToReceive) {
      setError("Map every invoice line before receiving this purchase.");
      return;
    }
    setSaving(true);
    setReceiveMessage(null);
    setError(null);

    try {
      const received = await receivePilotPurchaseInvoice(draft.id);
      setSelectedId(received.id);
      setDraft(invoiceToDraft(received));
      setReceiveMessage(`Invoice ${received.invoiceNumber} received into inventory.`);
      setOcrMessage(null);
      await load(received.id);
      showNotice("success", "Purchase received", `Invoice ${received.invoiceNumber} received into inventory.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not receive the purchase.";
      setError(message);
      showNotice("error", "Receive failed", message);
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
      setReceiveMessage(`Invoice ${corrected.invoiceNumber} corrected and inventory movements were reversed.`);
      setOcrMessage(null);
      await load(corrected.id);
      showNotice("success", "Purchase corrected", `Invoice ${corrected.invoiceNumber} corrected and inventory movements were reversed.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not record the correction.";
      setError(message);
      showNotice("error", "Correction failed", message);
    } finally {
      setSaving(false);
    }
  };

  const openInvoice = async (invoiceId: number) => {
    setSelectedId(invoiceId);
    setReceiveMessage(null);
    setError(null);
    setCorrectionNote("");
    const invoice = await fetchPilotPurchaseInvoice(invoiceId);
    setDraft(invoiceToDraft(invoice));
  };

  const addLine = () => {
    const next = [...draft.lineItems, blankLine()];
    setDraft((current) => ({ ...current, ...recalculateTotals(next, current.tax) }));
  };

  const applyMappingHint = (supplierName: string, description: string) => {
    const hint = mappingHints.get(`${normalizeLookup(supplierName)}|${normalizeLookup(description)}`);
    return hint ?? null;
  };

  const setLineDescription = (clientId: string, description: string) => {
    updateLine(clientId, (current) => {
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

  const setLineInventoryItem = (clientId: string, inventoryItemId: number | null, description: string) => {
    const selectedItem = inventoryItems.find((item) => item.id === inventoryItemId) ?? null;
    const hint = description ? applyMappingHint(draft.supplierName, description) : null;
    updateLine(clientId, (current) => ({
      ...current,
      inventoryItemId,
      inventoryUnit: hint?.inventoryUnit ?? selectedItem?.stockUnit ?? current.inventoryUnit,
      purchaseUnit: hint?.purchaseUnit ?? current.purchaseUnit,
      conversionFactor: hint?.conversionFactor ?? (current.conversionFactor || 1),
    }));
  };

  return (
    <div className="space-y-6">
      {notice ? (
        <div
          aria-atomic="true"
          aria-live={notice.kind === "success" ? "polite" : "assertive"}
          className="pointer-events-none fixed bottom-4 left-4 right-4 z-50 flex justify-end sm:left-auto sm:right-4 sm:max-w-sm"
          data-testid="purchase-mutation-toast"
          role={notice.kind === "success" ? "status" : "alert"}
        >
          <Card className={`pointer-events-auto w-full border px-4 py-3 shadow-xl ${notice.kind === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-950" : "border-rose-200 bg-rose-50 text-rose-950"}`}>
            <div className="flex items-start gap-3">
              {notice.kind === "success" ? <CheckCircle2 className="mt-0.5 h-5 w-5" /> : <AlertTriangle className="mt-0.5 h-5 w-5" />}
              <div className="min-w-0">
                <p className="text-sm font-semibold uppercase tracking-wide">{notice.title}</p>
                <p className="mt-1 text-sm leading-6">{notice.message}</p>
              </div>
            </div>
          </Card>
        </div>
      ) : null}
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
              onClick={() => startBlankDraft("You can start entering supplier, line, and amount details right away.")}
            >
              New purchase
            </Button>
            <Button variant="secondary" icon={<RefreshCcw className="h-4 w-4" />} type="button" onClick={() => void load()}>
              Refresh
            </Button>
            <Button variant="secondary" icon={<FileUp className="h-4 w-4" />} type="button" onClick={() => fileInputRef.current?.click()} disabled={ocrLoading}>
              {ocrLoading ? "Processing OCR..." : "Upload invoice"}
            </Button>
          </div>
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-3xl border border-line bg-slate-50 p-5">
            <p className="text-xs font-bold uppercase tracking-wide text-muted">Authenticated OCR intake</p>
            <h2 className="mt-2 text-xl font-bold text-ink">Upload a supplier invoice and review the extracted draft</h2>
            <p className="mt-2 text-sm leading-6 text-muted">
              This path uses the real OCR backend, then saves the extracted draft into the pilot database after you review it. No browser localStorage is involved.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button type="button" onClick={() => fileInputRef.current?.click()} disabled={ocrLoading} icon={<Sparkles className="h-4 w-4" />}>
                {ocrLoading ? "Extracting..." : "Choose invoice file"}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => startBlankDraft("Blank draft ready. Add the first supplier or line details below.")}
              >
                Blank draft
              </Button>
              <input
                ref={fileInputRef}
                className="hidden"
                type="file"
                accept=".jpg,.jpeg,.png,.webp,.pdf"
                onChange={(event) => void handleOcrUpload(event.target.files?.[0] ?? null)}
              />
            </div>
            <p className="mt-3 text-xs leading-5 text-muted">
              Supported files: JPG, PNG, WEBP, PDF. OCR improves the supplier, invoice number, totals, and line-item review queue before you save.
            </p>
          </div>

          <div className="rounded-3xl border border-line bg-white p-5">
            <p className="text-xs font-bold uppercase tracking-wide text-muted">Review status</p>
            <div className="mt-3 space-y-2 text-sm leading-6 text-muted">
              <p>{ocrMessage ?? "Upload a file to prefill a real purchase draft."}</p>
              <p>{data?.summary.uploadsNeedingReview ? `${data.summary.uploadsNeedingReview} purchases still need review.` : "No review backlog right now."}</p>
              <p>{data?.summary.exportReady ? `${data.summary.exportReady} purchases are ready for export once received.` : "Save and receive a draft to move it into inventory."}</p>
            </div>
          </div>
        </div>

        {firstValidationMessage ? (
          <div data-testid="purchase-validation-errors" className="mt-5 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm leading-6 text-rose-900">
            <p className="font-semibold">Please fix the highlighted fields.</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {Object.entries(draftFieldErrors).map(([field, message]) => (
                <li key={field}>
                  <span className="font-semibold">{field}:</span> {message}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {error && !firstValidationMessage ? <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{error}</div> : null}
        {receiveMessage ? <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">{receiveMessage}</div> : null}
        {!error && ocrLoading ? <div className="mt-5 rounded-2xl border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-brand-900">Extracting invoice data from the selected file...</div> : null}

        <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {[
            { label: "This month spend", value: formatMoney(data?.summary.thisMonthSpend ?? 0) },
            { label: "Uploads needing review", value: formatNumber(data?.summary.uploadsNeedingReview ?? 0) },
            { label: "Price changes flagged", value: formatNumber(data?.summary.priceChangesFlagged ?? 0) },
            { label: "Mapped items", value: formatNumber(data?.summary.mappedItems ?? 0) },
            { label: "Export ready", value: formatNumber(data?.summary.exportReady ?? 0) },
          ].map((metric) => (
            <div key={metric.label} className="rounded-2xl border border-line bg-white p-4">
              <p className="text-xs font-bold uppercase tracking-wide text-muted">{metric.label}</p>
              <p className="mt-2 text-2xl font-bold text-ink">{metric.value}</p>
            </div>
          ))}
        </div>
      </Card>

      <div className="grid gap-6 2xl:grid-cols-[minmax(0,1.25fr)_minmax(0,0.75fr)]">
        <div ref={editorPanelRef} className="scroll-mt-32">
          <Card className="p-6">
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
                  <span>{invoice.lineItems.length} line items</span>
                </div>
              </button>
            ))}
            {!invoiceRows.length ? <p className="rounded-2xl border border-dashed border-line px-4 py-8 text-sm text-muted">No purchases yet. Create the first invoice to start tracking spend.</p> : null}
          </div>
          {data?.invoices.length && data.invoices.length > 5 ? (
            <button type="button" className="mt-4 text-sm font-semibold text-brand-700" onClick={() => setShowAll((value) => !value)}>
              {showAll ? "Show fewer purchases" : "View all purchases"}
            </button>
          ) : null}

          <div className="mt-6">
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
          </div>
        </Card>

        <Card className="p-6">
          <SectionHeader
            title={draft.id ? `Review ${draft.invoiceNumber}` : "New purchase"}
            description={draft.status === "Corrected" ? "This purchase has been corrected and is view-only." : draft.status === "Completed" ? "This purchase is completed and view-only for receiving." : "Edit the purchase, confirm the lines, then save or receive into inventory."}
          />

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <label className="block text-sm font-semibold text-ink" htmlFor="purchase-supplier">
                  Supplier
                </label>
                {hasSuppliers ? (
                  <button
                    type="button"
                    className="text-sm font-semibold text-brand-700 transition hover:text-brand-800 disabled:opacity-60"
                    onClick={() => setSupplierCreateOpen((current) => !current)}
                    disabled={finalizedStatus}
                  >
                    {supplierCreateOpen ? "Hide create supplier" : "Add supplier"}
                  </button>
                ) : null}
              </div>
              {hasSuppliers ? (
                <>
                  <select
                    ref={supplierSelectRef}
                    id="purchase-supplier"
                    className={`input mt-1 ${draftFieldErrors.supplierName ? "border-rose-400 ring-1 ring-rose-200" : ""}`}
                    value={draft.supplierName}
                    onChange={(event) => setDraft((current) => ({ ...current, supplierName: event.target.value }))}
                    disabled={finalizedStatus}
                    aria-invalid={Boolean(draftFieldErrors.supplierName)}
                  >
                    <option value="">Choose supplier</option>
                    {data?.suppliers.map((supplier) => (
                      <option key={supplier.id} value={supplier.name}>
                        {supplier.name}
                      </option>
                    ))}
                  </select>
                  {draftFieldErrors.supplierName ? <p className="text-xs leading-5 text-rose-700">{draftFieldErrors.supplierName}</p> : null}
                  {!draft.supplierName ? <p className="text-xs leading-5 text-muted">Choose an existing supplier or create a new one below.</p> : null}
                </>
              ) : (
                <div className="rounded-2xl border border-dashed border-brand-200 bg-brand-50/50 p-4">
                  <p className="text-sm font-semibold text-ink">No suppliers yet</p>
                  <p className="mt-1 text-sm leading-6 text-muted">
                    Create the first supplier in the inline form below, then it will be selected automatically for this purchase.
                  </p>
                </div>
              )}
            </div>
            <label className="block">
              <span className="text-sm font-semibold text-ink">Invoice number</span>
              <input
                ref={invoiceNumberRef}
                className={`input mt-1 ${draftFieldErrors.invoiceNumber ? "border-rose-400 ring-1 ring-rose-200" : ""}`}
                value={draft.invoiceNumber}
                onChange={(event) => setDraft((current) => ({ ...current, invoiceNumber: event.target.value }))}
                disabled={finalizedStatus}
                aria-invalid={Boolean(draftFieldErrors.invoiceNumber)}
              />
              {draftFieldErrors.invoiceNumber ? <p className="mt-1 text-xs leading-5 text-rose-700">{draftFieldErrors.invoiceNumber}</p> : null}
            </label>
            <label className="block">
              <span className="text-sm font-semibold text-ink">Invoice date</span>
              <input
                ref={invoiceDateRef}
                className={`input mt-1 ${draftFieldErrors.invoiceDate ? "border-rose-400 ring-1 ring-rose-200" : ""}`}
                type="date"
                value={draft.invoiceDate}
                onChange={(event) => setDraft((current) => ({ ...current, invoiceDate: event.target.value }))}
                disabled={finalizedStatus}
                aria-invalid={Boolean(draftFieldErrors.invoiceDate)}
              />
              {draftFieldErrors.invoiceDate ? <p className="mt-1 text-xs leading-5 text-rose-700">{draftFieldErrors.invoiceDate}</p> : null}
            </label>
            <label className="block">
              <span className="text-sm font-semibold text-ink">Status</span>
              {finalizedStatus ? (
                <div className="mt-1 rounded-2xl border border-line bg-slate-50 px-4 py-3">
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

          {supplierCreateOpen || !hasSuppliers ? (
            <div className="mt-4 rounded-2xl border border-brand-100 bg-brand-50/50 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-ink">{hasSuppliers ? "Create a new supplier" : "Create the first supplier"}</p>
                  <p className="mt-1 text-sm leading-6 text-muted">
                    {hasSuppliers
                      ? "Add a vendor inline without leaving the purchase editor."
                      : "There are no suppliers yet, so create one before you continue this purchase."}
                  </p>
                </div>
                {hasSuppliers ? (
                  <button type="button" className="text-sm font-semibold text-brand-700 transition hover:text-brand-800" onClick={() => setSupplierCreateOpen(false)}>
                    Close
                  </button>
                ) : null}
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <label className="block">
                  <span className="text-xs font-bold uppercase tracking-wide text-muted">Supplier name</span>
                  <input
                    ref={supplierInputRef}
                    className={`input mt-1 ${supplierFieldErrors.name ? "border-rose-400 ring-1 ring-rose-200" : ""}`}
                    value={supplierDraft.name}
                    onChange={(event) => setSupplierDraft((current) => ({ ...current, name: event.target.value }))}
                    placeholder="Enter supplier name"
                    disabled={finalizedStatus || supplierSaving}
                    aria-invalid={Boolean(supplierFieldErrors.name)}
                  />
                  {supplierFieldErrors.name ? <p className="mt-1 text-xs leading-5 text-rose-700">{supplierFieldErrors.name}</p> : null}
                </label>
                <label className="block">
                  <span className="text-xs font-bold uppercase tracking-wide text-muted">Category focus</span>
                  <input
                    className={`input mt-1 ${supplierFieldErrors.categoryFocus ? "border-rose-400 ring-1 ring-rose-200" : ""}`}
                    value={supplierDraft.categoryFocus}
                    onChange={(event) => setSupplierDraft((current) => ({ ...current, categoryFocus: event.target.value }))}
                    placeholder="Dairy, produce, packaging..."
                    disabled={finalizedStatus || supplierSaving}
                    aria-invalid={Boolean(supplierFieldErrors.categoryFocus)}
                  />
                  {supplierFieldErrors.categoryFocus ? <p className="mt-1 text-xs leading-5 text-rose-700">{supplierFieldErrors.categoryFocus}</p> : null}
                </label>
              </div>
              <div className="mt-3 grid gap-3 md:grid-cols-3">
                <label className="block">
                  <span className="text-xs font-bold uppercase tracking-wide text-muted">Contact name</span>
                  <input className={`input mt-1 ${supplierFieldErrors.contactName ? "border-rose-400 ring-1 ring-rose-200" : ""}`} value={supplierDraft.contactName} onChange={(event) => setSupplierDraft((current) => ({ ...current, contactName: event.target.value }))} disabled={finalizedStatus || supplierSaving} aria-invalid={Boolean(supplierFieldErrors.contactName)} />
                  {supplierFieldErrors.contactName ? <p className="mt-1 text-xs leading-5 text-rose-700">{supplierFieldErrors.contactName}</p> : null}
                </label>
                <label className="block">
                  <span className="text-xs font-bold uppercase tracking-wide text-muted">Contact phone</span>
                  <input className={`input mt-1 ${supplierFieldErrors.contactPhone ? "border-rose-400 ring-1 ring-rose-200" : ""}`} value={supplierDraft.contactPhone} onChange={(event) => setSupplierDraft((current) => ({ ...current, contactPhone: event.target.value }))} disabled={finalizedStatus || supplierSaving} aria-invalid={Boolean(supplierFieldErrors.contactPhone)} />
                  {supplierFieldErrors.contactPhone ? <p className="mt-1 text-xs leading-5 text-rose-700">{supplierFieldErrors.contactPhone}</p> : null}
                </label>
                <label className="block">
                  <span className="text-xs font-bold uppercase tracking-wide text-muted">Contact email</span>
                  <input className={`input mt-1 ${supplierFieldErrors.contactEmail ? "border-rose-400 ring-1 ring-rose-200" : ""}`} type="email" value={supplierDraft.contactEmail} onChange={(event) => setSupplierDraft((current) => ({ ...current, contactEmail: event.target.value }))} disabled={finalizedStatus || supplierSaving} aria-invalid={Boolean(supplierFieldErrors.contactEmail)} />
                  {supplierFieldErrors.contactEmail ? <p className="mt-1 text-xs leading-5 text-rose-700">{supplierFieldErrors.contactEmail}</p> : null}
                </label>
              </div>
              <div className="mt-3 flex flex-wrap gap-3">
                <Button type="button" onClick={() => void createSupplier()} disabled={finalizedStatus || supplierSaving}>
                  {supplierSaving ? "Creating supplier..." : "Create supplier"}
                </Button>
                {hasSuppliers ? (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      setSupplierCreateOpen(false);
                      setSupplierDraft(buildBlankSupplierDraft());
                    }}
                    disabled={supplierSaving}
                  >
                    Cancel
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null}

          <div className="mt-5 grid gap-4 md:grid-cols-3">
            <label className="block">
              <span className="text-sm font-semibold text-ink">Subtotal</span>
              <input className="input mt-1" type="number" step="0.01" value={draft.subtotal} onChange={(event) => setDraft((current) => ({ ...current, subtotal: Number(event.target.value), totalAmount: Number(event.target.value) + Number(current.tax || 0) }))} disabled={finalizedStatus} />
            </label>
            <label className="block">
              <span className="text-sm font-semibold text-ink">Tax</span>
              <input className="input mt-1" type="number" step="0.01" value={draft.tax} onChange={(event) => setTax(Number(event.target.value))} disabled={finalizedStatus} />
            </label>
            <label className="block">
              <span className="text-sm font-semibold text-ink">Total</span>
              <input className="input mt-1" type="number" step="0.01" value={draft.totalAmount} onChange={(event) => setDraft((current) => ({ ...current, totalAmount: Number(event.target.value) }))} disabled={finalizedStatus} />
            </label>
          </div>

          <div className="mt-5 rounded-2xl border border-line bg-slate-50 p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold text-ink">Line items</p>
              <button type="button" className="text-sm font-semibold text-brand-700" onClick={addLine} disabled={finalizedStatus}>
                Add line
              </button>
            </div>
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              <Badge tone="neutral">{mappedLineCount} mapped</Badge>
              <Badge tone={unresolvedLineCount > 0 ? "warning" : "success"}>{unresolvedLineCount} need confirmation</Badge>
              <Badge tone={readyToReceive ? "success" : "neutral"}>{readyToReceive ? "Ready to receive" : "Not ready to receive"}</Badge>
            </div>
            <div className="mt-4 space-y-4">
              {draft.lineItems.map((line, index) => (
                <div key={line.clientId} data-testid="purchase-line-card" data-line-id={line.clientId} className="rounded-2xl border border-line bg-white p-4">
                  <div className="grid gap-3 md:grid-cols-2">
                    <label className="block">
                      <span className="text-xs font-bold uppercase tracking-wide text-muted">Description</span>
                      <input
                        ref={index === 0 ? firstLineDescriptionRef : null}
                        className={`input mt-1 ${draftFieldErrors["lineItems"] ? "border-rose-400 ring-1 ring-rose-200" : ""}`}
                        data-field="line-description"
                        value={line.description}
                        onChange={(event) => setLineDescription(line.clientId, event.target.value)}
                        disabled={finalizedStatus}
                        aria-invalid={Boolean(draftFieldErrors["lineItems"])}
                      />
                    </label>
                    <label className="block">
                      <span className="text-xs font-bold uppercase tracking-wide text-muted">Inventory item</span>
                      <select className={`input mt-1 ${draftFieldErrors["lineItems"] ? "border-rose-400 ring-1 ring-rose-200" : ""}`} value={line.inventoryItemId ?? ""} onChange={(event) => setLineInventoryItem(line.clientId, event.target.value ? Number(event.target.value) : null, line.description)} disabled={finalizedStatus} aria-invalid={Boolean(draftFieldErrors["lineItems"])}>
                        <option value="">Unmapped</option>
                        {inventoryItemOptions.map((item) => (
                          <option key={item.id} value={item.id}>{item.name}</option>
                        ))}
                      </select>
                      {!line.inventoryItemId ? (
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            className="text-sm font-semibold text-brand-700 transition hover:text-brand-800 disabled:opacity-60"
                            onClick={() => beginInventoryCreation(line, index)}
                            disabled={finalizedStatus}
                          >
                            {inventoryCreateLineId === lineKey(line) ? "Creating item below" : "Create inventory item"}
                          </button>
                          {inventoryItems.length === 0 ? <span className="text-xs leading-5 text-muted">No inventory items yet.</span> : null}
                        </div>
                      ) : null}
                    </label>
                  </div>
                  <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-6">
                    <label className="block">
                      <span className="text-xs font-bold uppercase tracking-wide text-muted">Purchase unit</span>
                      <input className="input mt-1" list={`purchase-units-${line.clientId}`} value={line.purchaseUnit} onChange={(event) => updateLine(line.clientId, (current) => ({ ...current, purchaseUnit: event.target.value }))} disabled={finalizedStatus} />
                      <datalist id={`purchase-units-${line.clientId}`}>
                        {commonUnits.map((unit) => (
                          <option key={unit} value={unit} />
                        ))}
                      </datalist>
                    </label>
                    <label className="block">
                      <span className="text-xs font-bold uppercase tracking-wide text-muted">Inventory unit</span>
                      <input className="input mt-1" list={`inventory-units-${line.clientId}`} value={line.inventoryUnit} onChange={(event) => updateLine(line.clientId, (current) => ({ ...current, inventoryUnit: event.target.value }))} disabled={finalizedStatus} />
                      <datalist id={`inventory-units-${line.clientId}`}>
                        {commonUnits.map((unit) => (
                          <option key={unit} value={unit} />
                        ))}
                      </datalist>
                    </label>
                    <label className="block">
                      <span className="text-xs font-bold uppercase tracking-wide text-muted">Conversion</span>
                      <input className="input mt-1" type="number" step="0.0001" value={line.conversionFactor} onChange={(event) => updateLine(line.clientId, (current) => ({ ...current, conversionFactor: Number(event.target.value) || 1 }))} disabled={finalizedStatus} />
                    </label>
                    <label className="block">
                      <span className="text-xs font-bold uppercase tracking-wide text-muted">Qty</span>
                      <input className="input mt-1" type="number" step="0.0001" value={line.quantity} onChange={(event) => updateLine(line.clientId, (current) => ({ ...current, quantity: Number(event.target.value), lineTotal: Number(event.target.value) * Number(current.unitPrice || 0) }))} disabled={finalizedStatus} />
                    </label>
                    <label className="block">
                      <span className="text-xs font-bold uppercase tracking-wide text-muted">Unit price</span>
                      <input className="input mt-1" type="number" step="0.01" value={line.unitPrice} onChange={(event) => updateLine(line.clientId, (current) => ({ ...current, unitPrice: Number(event.target.value), lineTotal: Number(current.quantity || 0) * Number(event.target.value) }))} disabled={finalizedStatus} />
                    </label>
                    <label className="block">
                      <span className="text-xs font-bold uppercase tracking-wide text-muted">Line total</span>
                      <input className="input mt-1" type="number" step="0.01" value={line.lineTotal} onChange={(event) => updateLine(line.clientId, (current) => ({ ...current, lineTotal: Number(event.target.value) }))} disabled={finalizedStatus} />
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
                        <input checked={line.needsReview} disabled={finalizedStatus} type="checkbox" onChange={(event) => updateLine(line.clientId, (current) => ({ ...current, needsReview: event.target.checked }))} />
                        Needs review
                      </label>
                      <button
                        className="text-sm font-semibold text-danger disabled:text-slate-300"
                        type="button"
                        disabled={finalizedStatus || draft.lineItems.length === 1}
                        onClick={() => {
                          const next = draft.lineItems.filter((entry) => entry.clientId !== line.clientId);
                          setDraft((current) => ({ ...current, ...recalculateTotals(next.length ? next : [blankLine()], current.tax) }));
                        }}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                  {line.inventoryItemId ? (
                    <p className="mt-3 text-xs leading-5 text-muted">
                      Inventory unit {line.inventoryUnit || "each"} will receive {formatNumber(Number((line.quantity || 0) * (line.conversionFactor || 1)))} units from this line.
                    </p>
                  ) : null}
                  {!line.inventoryItemId && inventoryCreateLineId === lineKey(line) ? (
                    <div className="mt-4 rounded-xl border border-brand-100 bg-brand-50/50 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-ink">Create inventory item from this line</p>
                          <p className="mt-1 text-sm leading-6 text-muted">
                            We prefilled the name, unit, and price from the invoice line. Confirm the stock unit and PAR before saving.
                          </p>
                        </div>
                        <button type="button" className="text-sm font-semibold text-brand-700 transition hover:text-brand-800" onClick={cancelInventoryCreation}>
                          Close
                        </button>
                      </div>
                  <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    <label className="block">
                      <span className="text-xs font-bold uppercase tracking-wide text-muted">Item name</span>
                      <input ref={inventoryNameRef} className={`input mt-1 ${inventoryFieldErrors.name ? "border-rose-400 ring-1 ring-rose-200" : ""}`} value={inventoryDraft.name} onChange={(event) => setInventoryDraft((current) => ({ ...current, name: event.target.value }))} disabled={finalizedStatus || inventorySavingLineId === lineKey(line)} aria-invalid={Boolean(inventoryFieldErrors.name)} />
                      {inventoryFieldErrors.name ? <p className="mt-1 text-xs leading-5 text-rose-700">{inventoryFieldErrors.name}</p> : null}
                    </label>
                    <label className="block">
                      <span className="text-xs font-bold uppercase tracking-wide text-muted">Stock unit</span>
                      <input className={`input mt-1 ${inventoryFieldErrors.stockUnit ? "border-rose-400 ring-1 ring-rose-200" : ""}`} list={`inventory-units-create-${lineKey(line)}`} value={inventoryDraft.stockUnit} onChange={(event) => setInventoryDraft((current) => ({ ...current, stockUnit: event.target.value }))} disabled={finalizedStatus || inventorySavingLineId === lineKey(line)} aria-invalid={Boolean(inventoryFieldErrors.stockUnit)} />
                      <datalist id={`inventory-units-create-${lineKey(line)}`}>
                        {commonUnits.map((unit) => (
                          <option key={unit} value={unit} />
                        ))}
                      </datalist>
                      {inventoryFieldErrors.stockUnit ? <p className="mt-1 text-xs leading-5 text-rose-700">{inventoryFieldErrors.stockUnit}</p> : null}
                    </label>
                    <label className="block">
                      <span className="text-xs font-bold uppercase tracking-wide text-muted">Category</span>
                      <input className={`input mt-1 ${inventoryFieldErrors.category ? "border-rose-400 ring-1 ring-rose-200" : ""}`} value={inventoryDraft.category} onChange={(event) => setInventoryDraft((current) => ({ ...current, category: event.target.value }))} disabled={finalizedStatus || inventorySavingLineId === lineKey(line)} aria-invalid={Boolean(inventoryFieldErrors.category)} />
                      {inventoryFieldErrors.category ? <p className="mt-1 text-xs leading-5 text-rose-700">{inventoryFieldErrors.category}</p> : null}
                    </label>
                    <label className="block">
                      <span className="text-xs font-bold uppercase tracking-wide text-muted">Preferred supplier</span>
                      <input className={`input mt-1 ${inventoryFieldErrors.preferredSupplierName ? "border-rose-400 ring-1 ring-rose-200" : ""}`} value={inventoryDraft.preferredSupplierName} onChange={(event) => setInventoryDraft((current) => ({ ...current, preferredSupplierName: event.target.value }))} disabled={finalizedStatus || inventorySavingLineId === lineKey(line)} aria-invalid={Boolean(inventoryFieldErrors.preferredSupplierName)} />
                      {inventoryFieldErrors.preferredSupplierName ? <p className="mt-1 text-xs leading-5 text-rose-700">{inventoryFieldErrors.preferredSupplierName}</p> : null}
                    </label>
                    <label className="block">
                      <span className="text-xs font-bold uppercase tracking-wide text-muted">Latest price</span>
                      <input className={`input mt-1 ${inventoryFieldErrors.latestPurchasePrice ? "border-rose-400 ring-1 ring-rose-200" : ""}`} type="number" step="0.01" value={inventoryDraft.latestPurchasePrice} onChange={(event) => setInventoryDraft((current) => ({ ...current, latestPurchasePrice: Number(event.target.value) || 0 }))} disabled={finalizedStatus || inventorySavingLineId === lineKey(line)} aria-invalid={Boolean(inventoryFieldErrors.latestPurchasePrice)} />
                      {inventoryFieldErrors.latestPurchasePrice ? <p className="mt-1 text-xs leading-5 text-rose-700">{inventoryFieldErrors.latestPurchasePrice}</p> : null}
                    </label>
                    <label className="block">
                      <span className="text-xs font-bold uppercase tracking-wide text-muted">Last purchase unit</span>
                      <input className={`input mt-1 ${inventoryFieldErrors.lastPurchaseUnit ? "border-rose-400 ring-1 ring-rose-200" : ""}`} value={inventoryDraft.lastPurchaseUnit} onChange={(event) => setInventoryDraft((current) => ({ ...current, lastPurchaseUnit: event.target.value }))} disabled={finalizedStatus || inventorySavingLineId === lineKey(line)} aria-invalid={Boolean(inventoryFieldErrors.lastPurchaseUnit)} />
                      {inventoryFieldErrors.lastPurchaseUnit ? <p className="mt-1 text-xs leading-5 text-rose-700">{inventoryFieldErrors.lastPurchaseUnit}</p> : null}
                    </label>
                    <label className="block">
                      <span className="text-xs font-bold uppercase tracking-wide text-muted">Conversion factor</span>
                      <input className={`input mt-1 ${inventoryFieldErrors.lastPurchaseConversionFactor ? "border-rose-400 ring-1 ring-rose-200" : ""}`} type="number" step="0.0001" value={inventoryDraft.lastPurchaseConversionFactor} onChange={(event) => setInventoryDraft((current) => ({ ...current, lastPurchaseConversionFactor: Number(event.target.value) || 1 }))} disabled={finalizedStatus || inventorySavingLineId === lineKey(line)} aria-invalid={Boolean(inventoryFieldErrors.lastPurchaseConversionFactor)} />
                      {inventoryFieldErrors.lastPurchaseConversionFactor ? <p className="mt-1 text-xs leading-5 text-rose-700">{inventoryFieldErrors.lastPurchaseConversionFactor}</p> : null}
                    </label>
                    <label className="block">
                      <span className="text-xs font-bold uppercase tracking-wide text-muted">Current on hand</span>
                      <input className={`input mt-1 ${inventoryFieldErrors.currentOnHand ? "border-rose-400 ring-1 ring-rose-200" : ""}`} type="number" step="0.0001" value={inventoryDraft.currentOnHand} onChange={(event) => setInventoryDraft((current) => ({ ...current, currentOnHand: Number(event.target.value) || 0 }))} disabled={finalizedStatus || inventorySavingLineId === lineKey(line)} aria-invalid={Boolean(inventoryFieldErrors.currentOnHand)} />
                      {inventoryFieldErrors.currentOnHand ? <p className="mt-1 text-xs leading-5 text-rose-700">{inventoryFieldErrors.currentOnHand}</p> : null}
                    </label>
                    <label className="block">
                      <span className="text-xs font-bold uppercase tracking-wide text-muted">Min / PAR</span>
                      <div className="mt-1 grid grid-cols-2 gap-2">
                            <input className={`input ${inventoryFieldErrors.minQuantity ? "border-rose-400 ring-1 ring-rose-200" : ""}`} type="number" step="0.0001" value={inventoryDraft.minQuantity} onChange={(event) => setInventoryDraft((current) => ({ ...current, minQuantity: Number(event.target.value) || 0 }))} disabled={finalizedStatus || inventorySavingLineId === lineKey(line)} aria-invalid={Boolean(inventoryFieldErrors.minQuantity)} />
                            <input className={`input ${inventoryFieldErrors.parLevel ? "border-rose-400 ring-1 ring-rose-200" : ""}`} type="number" step="0.0001" value={inventoryDraft.parLevel} onChange={(event) => setInventoryDraft((current) => ({ ...current, parLevel: Number(event.target.value) || 0 }))} disabled={finalizedStatus || inventorySavingLineId === lineKey(line)} aria-invalid={Boolean(inventoryFieldErrors.parLevel)} />
                      </div>
                      {inventoryFieldErrors.minQuantity ? <p className="mt-1 text-xs leading-5 text-rose-700">{inventoryFieldErrors.minQuantity}</p> : null}
                      {inventoryFieldErrors.parLevel ? <p className="mt-1 text-xs leading-5 text-rose-700">{inventoryFieldErrors.parLevel}</p> : null}
                    </label>
                  </div>
                      <div className="mt-3 flex flex-wrap gap-3">
                        <Button type="button" onClick={() => void createInventoryItemForLine(line, index)} disabled={finalizedStatus || inventorySavingLineId === lineKey(line)}>
                          {inventorySavingLineId === lineKey(line) ? "Creating item..." : "Create and map item"}
                        </Button>
                        <Button type="button" variant="ghost" onClick={cancelInventoryCreation} disabled={inventorySavingLineId === lineKey(line)}>
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>

          <label className="mt-5 block">
            <span className="text-sm font-semibold text-ink">Notes</span>
            <textarea className="input mt-1" value={draft.notes} onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))} disabled={finalizedStatus} />
          </label>

          <div className="mt-5 flex flex-wrap gap-3">
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

          {draft.status === "Completed" ? (
            <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4">
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
            <div className="mt-5 rounded-2xl border border-line bg-slate-50 p-4 text-sm text-muted">
              <p className="font-semibold text-ink">This invoice was corrected</p>
              <p className="mt-1">Inventory movements were reversed and the record is now view-only.</p>
            </div>
          ) : null}

          <div className="mt-4 rounded-2xl border border-line bg-slate-50 p-4 text-sm text-muted">
            <p className="font-semibold text-ink">Purchase status</p>
            <p className="mt-1">Completed purchases become view-only and can no longer be received twice. Corrected purchases stay view-only and preserve the audit trail. Save ready is available only when every line is mapped.</p>
          </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
