import { useEffect, useMemo, useState } from "react";
import { ArrowRight, CheckCircle2, FileText, Plus, RefreshCcw, ShoppingBag } from "lucide-react";
import { Badge } from "../components/Badge";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { SectionHeader } from "../components/SectionHeader";
import {
  createPilotPurchaseInvoice,
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

function todayIso() {
  return new Date().toISOString().slice(0, 10);
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

function buildBlankDraft(data?: PilotPurchasesResponse): PurchaseDraft {
  const supplierName = data?.suppliers[0]?.name ?? "Fresh Dairy Toronto";
  return {
    id: null,
    supplierName,
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

export function PilotPurchasesPage() {
  const [data, setData] = useState<PilotPurchasesResponse | null>(null);
  const [inventoryItems, setInventoryItems] = useState<PilotInventoryItem[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [draft, setDraft] = useState<PurchaseDraft>(buildBlankDraft());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [receiveMessage, setReceiveMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);

    try {
      const [purchases, inventory] = await Promise.all([fetchPilotPurchases(), fetchPilotInventory()]);
      setData(purchases);
      setInventoryItems(inventory.items);
      if (selectedId === null && purchases.invoices[0]) {
        setSelectedId(purchases.invoices[0].id);
        setDraft(invoiceToDraft(purchases.invoices[0]));
      }
      if (!selectedId && !purchases.invoices.length) {
        setDraft(buildBlankDraft(purchases));
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
  }, []);

  const selectedInvoice = useMemo(
    () => data?.invoices.find((invoice) => invoice.id === selectedId) ?? null,
    [data?.invoices, selectedId],
  );

  useEffect(() => {
    if (selectedInvoice) {
      setDraft(invoiceToDraft(selectedInvoice));
    }
  }, [selectedInvoice]);

  const invoiceRows = showAll ? data?.invoices ?? [] : (data?.invoices ?? []).slice(0, 5);
  const priceChanges = (data?.priceChanges ?? []).slice(0, 3);

  const setLine = (index: number, updater: (line: DraftLine) => DraftLine) => {
    setDraft((current) => ({
      ...current,
      lineItems: current.lineItems.map((line, lineIndex) => (lineIndex === index ? updater(line) : line)),
    }));
  };

  const recalcTotals = (nextLines: DraftLine[]) => {
    const subtotal = nextLines.reduce((sum, line) => sum + Number(line.lineTotal || line.quantity * line.unitPrice), 0);
    setDraft((current) => ({ ...current, lineItems: nextLines, subtotal, totalAmount: subtotal + Number(current.tax || 0) }));
  };

  const saveDraft = async (status: string) => {
    setSaving(true);
    setReceiveMessage(null);
    setError(null);

    try {
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
      await load();
      setSelectedId(saved.id);
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
    setSaving(true);
    setReceiveMessage(null);
    setError(null);

    try {
      const received = await receivePilotPurchaseInvoice(draft.id);
      setSelectedId(received.id);
      setDraft(invoiceToDraft(received));
      setReceiveMessage(`Invoice ${received.invoiceNumber} received into inventory.`);
      await load();
      setSelectedId(received.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not receive the purchase.");
    } finally {
      setSaving(false);
    }
  };

  const openInvoice = async (invoiceId: number) => {
    setSelectedId(invoiceId);
    setReceiveMessage(null);
    setError(null);
    const invoice = await fetchPilotPurchaseInvoice(invoiceId);
    setDraft(invoiceToDraft(invoice));
  };

  const addLine = () => {
    const next = [...draft.lineItems, blankLine()];
    recalcTotals(next);
  };

  return (
    <div className="space-y-6">
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
                setDraft(buildBlankDraft(data ?? undefined));
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

      <div className="grid gap-6 xl:grid-cols-[0.92fr_1.08fr]">
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
            description={draft.status === "Completed" ? "This purchase is completed and view-only for receiving." : "Edit the purchase, confirm the lines, then save or receive into inventory."}
          />

          <div className="grid gap-4 md:grid-cols-2">
            <label className="block">
              <span className="text-sm font-semibold text-ink">Supplier</span>
              <select
                className="input mt-1"
                value={draft.supplierName}
                onChange={(event) => setDraft((current) => ({ ...current, supplierName: event.target.value }))}
                disabled={draft.status === "Completed"}
              >
                {data?.suppliers.map((supplier) => (
                  <option key={supplier.id} value={supplier.name}>{supplier.name}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-sm font-semibold text-ink">Invoice number</span>
              <input className="input mt-1" value={draft.invoiceNumber} onChange={(event) => setDraft((current) => ({ ...current, invoiceNumber: event.target.value }))} disabled={draft.status === "Completed"} />
            </label>
            <label className="block">
              <span className="text-sm font-semibold text-ink">Invoice date</span>
              <input className="input mt-1" type="date" value={draft.invoiceDate} onChange={(event) => setDraft((current) => ({ ...current, invoiceDate: event.target.value }))} disabled={draft.status === "Completed"} />
            </label>
            <label className="block">
              <span className="text-sm font-semibold text-ink">Status</span>
              <select className="input mt-1" value={draft.status} onChange={(event) => setDraft((current) => ({ ...current, status: event.target.value }))} disabled={draft.status === "Completed"}>
                <option value="Draft">Needs review</option>
                <option value="Ready">Ready</option>
                <option value="Completed">Completed</option>
              </select>
            </label>
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-3">
            <label className="block">
              <span className="text-sm font-semibold text-ink">Subtotal</span>
              <input className="input mt-1" type="number" step="0.01" value={draft.subtotal} onChange={(event) => setDraft((current) => ({ ...current, subtotal: Number(event.target.value), totalAmount: Number(event.target.value) + Number(current.tax || 0) }))} disabled={draft.status === "Completed"} />
            </label>
            <label className="block">
              <span className="text-sm font-semibold text-ink">Tax</span>
              <input className="input mt-1" type="number" step="0.01" value={draft.tax} onChange={(event) => setDraft((current) => ({ ...current, tax: Number(event.target.value), totalAmount: Number(current.subtotal || 0) + Number(event.target.value) }))} disabled={draft.status === "Completed"} />
            </label>
            <label className="block">
              <span className="text-sm font-semibold text-ink">Total</span>
              <input className="input mt-1" type="number" step="0.01" value={draft.totalAmount} onChange={(event) => setDraft((current) => ({ ...current, totalAmount: Number(event.target.value) }))} disabled={draft.status === "Completed"} />
            </label>
          </div>

          <div className="mt-5 rounded-2xl border border-line bg-slate-50 p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold text-ink">Line items</p>
              <button type="button" className="text-sm font-semibold text-brand-700" onClick={addLine} disabled={draft.status === "Completed"}>
                Add line
              </button>
            </div>
            <div className="mt-4 space-y-4">
              {draft.lineItems.map((line, index) => (
                <div key={line.id ?? index} className="rounded-2xl border border-line bg-white p-4">
                  <div className="grid gap-3 md:grid-cols-2">
                    <label className="block">
                      <span className="text-xs font-bold uppercase tracking-wide text-muted">Description</span>
                      <input className="input mt-1" value={line.description} onChange={(event) => setLine(index, (current) => ({ ...current, description: event.target.value }))} disabled={draft.status === "Completed"} />
                    </label>
                    <label className="block">
                      <span className="text-xs font-bold uppercase tracking-wide text-muted">Inventory item</span>
                      <select className="input mt-1" value={line.inventoryItemId ?? ""} onChange={(event) => setLine(index, (current) => ({ ...current, inventoryItemId: event.target.value ? Number(event.target.value) : null }))} disabled={draft.status === "Completed"}>
                        <option value="">Unmapped</option>
                        {inventoryItems.map((item) => (
                          <option key={item.id} value={item.id}>{item.name}</option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <div className="mt-3 grid gap-3 md:grid-cols-4">
                    <label className="block">
                      <span className="text-xs font-bold uppercase tracking-wide text-muted">Qty</span>
                      <input className="input mt-1" type="number" step="0.0001" value={line.quantity} onChange={(event) => setLine(index, (current) => ({ ...current, quantity: Number(event.target.value), lineTotal: Number(event.target.value) * Number(current.unitPrice || 0) }))} disabled={draft.status === "Completed"} />
                    </label>
                    <label className="block">
                      <span className="text-xs font-bold uppercase tracking-wide text-muted">Unit price</span>
                      <input className="input mt-1" type="number" step="0.01" value={line.unitPrice} onChange={(event) => setLine(index, (current) => ({ ...current, unitPrice: Number(event.target.value), lineTotal: Number(current.quantity || 0) * Number(event.target.value) }))} disabled={draft.status === "Completed"} />
                    </label>
                    <label className="block">
                      <span className="text-xs font-bold uppercase tracking-wide text-muted">Line total</span>
                      <input className="input mt-1" type="number" step="0.01" value={line.lineTotal} onChange={(event) => setLine(index, (current) => ({ ...current, lineTotal: Number(event.target.value) }))} disabled={draft.status === "Completed"} />
                    </label>
                    <label className="block">
                      <span className="text-xs font-bold uppercase tracking-wide text-muted">Confidence</span>
                      <input className="input mt-1" type="number" step="0.01" value={line.confidence} onChange={(event) => setLine(index, (current) => ({ ...current, confidence: Number(event.target.value) }))} disabled={draft.status === "Completed"} />
                    </label>
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-3 text-sm">
                    <label className="inline-flex items-center gap-2 text-muted">
                      <input checked={line.needsReview} disabled={draft.status === "Completed"} type="checkbox" onChange={(event) => setLine(index, (current) => ({ ...current, needsReview: event.target.checked }))} />
                      Needs review
                    </label>
                    <button
                      className="text-sm font-semibold text-danger disabled:text-slate-300"
                      type="button"
                      disabled={draft.status === "Completed" || draft.lineItems.length === 1}
                      onClick={() => {
                        const next = draft.lineItems.filter((_, lineIndex) => lineIndex !== index);
                        recalcTotals(next.length ? next : [blankLine()]);
                      }}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <label className="mt-5 block">
            <span className="text-sm font-semibold text-ink">Notes</span>
            <textarea className="input mt-1" value={draft.notes} onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))} disabled={draft.status === "Completed"} />
          </label>

          <div className="mt-5 flex flex-wrap gap-3">
            <Button disabled={saving || draft.status === "Completed"} type="button" onClick={() => void saveDraft("Draft")}>
              {saving ? "Saving..." : "Save draft"}
            </Button>
            <Button disabled={saving || draft.status === "Completed"} variant="secondary" type="button" onClick={() => void saveDraft("Ready")}>
              Save ready
            </Button>
            <Button
              disabled={saving || !draft.id || draft.status === "Completed"}
              icon={<CheckCircle2 className="h-4 w-4" />}
              type="button"
              onClick={() => void receiveInvoice()}
            >
              Receive into inventory
            </Button>
          </div>

          <div className="mt-4 rounded-2xl border border-line bg-slate-50 p-4 text-sm text-muted">
            <p className="font-semibold text-ink">Purchase status</p>
            <p className="mt-1">Completed purchases become view-only and can no longer be received twice.</p>
          </div>
        </Card>
      </div>
    </div>
  );
}
