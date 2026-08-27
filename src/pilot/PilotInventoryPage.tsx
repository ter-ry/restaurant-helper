import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Plus, RefreshCcw, Scale, Search, SquarePen, Truck } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Badge } from "../components/Badge";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { SectionHeader } from "../components/SectionHeader";
import {
  createPilotInventoryAdjustment,
  createPilotInventoryItem,
  fetchPilotInventory,
  fetchPilotInventoryItem,
  fetchPilotSuppliers,
  createPilotSupplier,
  updatePilotSupplier,
  type PilotCountSession,
  type PilotInventoryItem,
  type PilotInventoryItemDetail,
  type PilotInventoryResponse,
  type PilotSupplierSummary,
  updatePilotInventoryItem,
} from "./pilotApi";
import { formatDateTime, formatMoney, formatNumber, statusTone } from "./workspace/pilotWorkspaceUtils";

interface InventoryDraft {
  id: number | null;
  name: string;
  category: string;
  stockUnit: string;
  currentOnHand: number;
  averageUnitCost: number;
  minQuantity: number;
  parLevel: number;
  preferredSupplierName: string;
  latestPurchasePrice: number;
  lastPurchaseUnit: string;
  lastPurchaseConversionFactor: number;
  averageDailyUsage: number;
  notes: string;
  active: boolean;
}

interface SupplierDraft {
  id: number | null;
  name: string;
  categoryFocus: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  orderingNotes: string;
  notes: string;
  isActive: boolean;
}

type InventoryEditorMode = "hidden" | "create" | "edit";

function blankDraft(suppliers: PilotSupplierSummary[] = []): InventoryDraft {
  return {
    id: null,
    name: "",
    category: "Other",
    stockUnit: "each",
    currentOnHand: 0,
    averageUnitCost: 0,
    minQuantity: 0,
    parLevel: 0,
    preferredSupplierName: "",
    latestPurchasePrice: 0,
    lastPurchaseUnit: "each",
    lastPurchaseConversionFactor: 1,
    averageDailyUsage: 0,
    notes: "",
    active: true,
  };
}

function blankSupplierDraft(suppliers: PilotSupplierSummary[] = []): SupplierDraft {
  const activeSupplier = suppliers.find((supplier) => supplier.isActive) ?? suppliers[0];
  return {
    id: null,
    name: "",
    categoryFocus: activeSupplier?.categoryFocus ?? "Other",
    contactName: "",
    contactPhone: "",
    contactEmail: "",
    orderingNotes: "",
    notes: "",
    isActive: true,
  };
}

function draftFromItem(item: PilotInventoryItem): InventoryDraft {
  return {
    id: item.id,
    name: item.name,
    category: item.category,
    stockUnit: item.stockUnit,
    currentOnHand: item.currentOnHand,
    averageUnitCost: item.averageUnitCost ?? 0,
    minQuantity: item.minQuantity,
    parLevel: item.parLevel,
    preferredSupplierName: item.preferredSupplierName,
    latestPurchasePrice: item.latestPurchasePrice,
    lastPurchaseUnit: item.lastPurchaseUnit,
    lastPurchaseConversionFactor: item.lastPurchaseConversionFactor,
    averageDailyUsage: item.averageDailyUsage ?? 0,
    notes: item.notes,
    active: item.active,
  };
}

function stockStatus(item: Pick<PilotInventoryItem, "currentOnHand" | "minQuantity" | "parLevel" | "averageDailyUsage">) {
  const daysRemaining = item.averageDailyUsage && item.averageDailyUsage > 0 ? Number((item.currentOnHand / item.averageDailyUsage).toFixed(1)) : null;
  if (item.currentOnHand <= 0) return "Out of stock";
  if (item.currentOnHand <= item.minQuantity || (daysRemaining !== null && daysRemaining <= 3)) return "Reorder now";
  if (item.currentOnHand < item.parLevel || (daysRemaining !== null && daysRemaining <= 10)) return "Low stock";
  return "In stock";
}

function adjustmentTone(quantity: number) {
  if (quantity < 0) return "danger" as const;
  if (quantity > 0) return "success" as const;
  return "neutral" as const;
}

export function PilotInventoryPage() {
  const navigate = useNavigate();
  const [data, setData] = useState<PilotInventoryResponse | null>(null);
  const [suppliers, setSuppliers] = useState<PilotSupplierSummary[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [editorMode, setEditorMode] = useState<InventoryEditorMode>("hidden");
  const [draft, setDraft] = useState<InventoryDraft>(blankDraft());
  const [itemDetail, setItemDetail] = useState<PilotInventoryItemDetail | null>(null);
  const [itemDetailLoading, setItemDetailLoading] = useState(false);
  const [selectedSupplierId, setSelectedSupplierId] = useState<number | null>(null);
  const [supplierDraft, setSupplierDraft] = useState<SupplierDraft>(blankSupplierDraft());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [supplierSaving, setSupplierSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [supplierSearch, setSupplierSearch] = useState("");
  const [adjustmentDelta, setAdjustmentDelta] = useState(0);
  const [adjustmentReason, setAdjustmentReason] = useState("Periodic review");
  const [adjustmentNote, setAdjustmentNote] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);

    try {
      const [response, supplierResponse] = await Promise.all([fetchPilotInventory(), fetchPilotSuppliers()]);
      setData(response);
      setSuppliers(supplierResponse.suppliers);
      if (!selectedId && !response.items.length) {
        setDraft(blankDraft(supplierResponse.suppliers));
      }
      if (selectedSupplierId === null && supplierResponse.suppliers[0]) {
        setSelectedSupplierId(supplierResponse.suppliers[0].id);
        setSupplierDraft({
          id: supplierResponse.suppliers[0].id,
          name: supplierResponse.suppliers[0].name,
          categoryFocus: supplierResponse.suppliers[0].categoryFocus,
          contactName: supplierResponse.suppliers[0].contactName,
          contactPhone: supplierResponse.suppliers[0].contactPhone,
          contactEmail: supplierResponse.suppliers[0].contactEmail,
          orderingNotes: supplierResponse.suppliers[0].orderingNotes,
          notes: supplierResponse.suppliers[0].notes,
          isActive: supplierResponse.suppliers[0].isActive,
        });
      }
      if (!selectedSupplierId && !supplierResponse.suppliers.length) {
        setSupplierDraft(blankSupplierDraft());
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load inventory.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedItem = useMemo(() => data?.items.find((item) => item.id === selectedId) ?? null, [data?.items, selectedId]);
  const selectedSupplier = useMemo(() => suppliers.find((supplier) => supplier.id === selectedSupplierId) ?? null, [selectedSupplierId, suppliers]);
  const selectedItemPurchaseHistory = itemDetail?.purchaseHistory ?? [];
  const selectedItemMovementHistory = itemDetail?.movementHistory ?? [];
  const selectedItemSupplierMappings = itemDetail?.supplierMappings ?? [];
  const filteredItems = useMemo(
    () => (data?.items ?? []).filter((item) => `${item.name} ${item.category} ${item.preferredSupplierName}`.toLowerCase().includes(search.toLowerCase())),
    [data?.items, search],
  );
  const filteredSuppliers = useMemo(
    () => suppliers.filter((supplier) => `${supplier.name} ${supplier.categoryFocus} ${supplier.contactName} ${supplier.contactPhone} ${supplier.contactEmail}`.toLowerCase().includes(supplierSearch.toLowerCase())),
    [supplierSearch, suppliers],
  );

  useEffect(() => {
    if (selectedItem) {
      setDraft(draftFromItem(selectedItem));
    }
  }, [selectedItem]);

  useEffect(() => {
    if (!selectedItem && editorMode === "edit") {
      setEditorMode("hidden");
    }
  }, [editorMode, selectedItem]);

  useEffect(() => {
    if (!selectedId) {
      setItemDetail(null);
      return;
    }

    let cancelled = false;
    setItemDetailLoading(true);
    void fetchPilotInventoryItem(selectedId)
      .then((detail) => {
        if (!cancelled) {
          setItemDetail(detail);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not load inventory item history.");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setItemDetailLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  useEffect(() => {
    if (selectedSupplier) {
      setSupplierDraft({
        id: selectedSupplier.id,
        name: selectedSupplier.name,
        categoryFocus: selectedSupplier.categoryFocus,
        contactName: selectedSupplier.contactName,
        contactPhone: selectedSupplier.contactPhone,
        contactEmail: selectedSupplier.contactEmail,
        orderingNotes: selectedSupplier.orderingNotes,
        notes: selectedSupplier.notes,
        isActive: selectedSupplier.isActive,
      });
    }
  }, [selectedSupplier]);

  const saveItem = async () => {
    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      const payload = {
        name: draft.name,
        category: draft.category,
        stockUnit: draft.stockUnit,
        currentOnHand: draft.currentOnHand,
        minQuantity: draft.minQuantity,
        parLevel: draft.parLevel,
        preferredSupplierName: draft.preferredSupplierName,
        latestPurchasePrice: draft.latestPurchasePrice,
        lastPurchaseUnit: draft.lastPurchaseUnit,
        lastPurchaseConversionFactor: draft.lastPurchaseConversionFactor,
        averageDailyUsage: draft.averageDailyUsage,
        notes: draft.notes,
        active: draft.active,
      };
      const saved = draft.id ? await updatePilotInventoryItem(draft.id, payload) : await createPilotInventoryItem(payload);
      setSelectedId(saved.id);
      setEditorMode("edit");
      setDraft(draftFromItem(saved));
      setMessage(`Inventory item ${saved.name} saved.`);
      await load();
      setSelectedId(saved.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save inventory item.");
    } finally {
      setSaving(false);
    }
  };

  const saveSupplier = async () => {
    setSupplierSaving(true);
    setError(null);
    setMessage(null);

    try {
      const payload = {
        name: supplierDraft.name,
        categoryFocus: supplierDraft.categoryFocus,
        contactName: supplierDraft.contactName,
        contactPhone: supplierDraft.contactPhone,
        contactEmail: supplierDraft.contactEmail,
        orderingNotes: supplierDraft.orderingNotes,
        notes: supplierDraft.notes,
        isActive: supplierDraft.isActive,
      };
      const saved = supplierDraft.id ? await updatePilotSupplier(supplierDraft.id, payload) : await createPilotSupplier(payload);
      setSelectedSupplierId(saved.id);
      setSupplierDraft({
        id: saved.id,
        name: saved.name,
        categoryFocus: saved.categoryFocus,
        contactName: saved.contactName,
        contactPhone: saved.contactPhone,
        contactEmail: saved.contactEmail,
        orderingNotes: saved.orderingNotes,
        notes: saved.notes,
        isActive: saved.isActive,
      });
      setMessage(`Supplier ${saved.name} saved.`);
      await load();
      setSelectedSupplierId(saved.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save supplier.");
    } finally {
      setSupplierSaving(false);
    }
  };

  const saveAdjustment = async () => {
    if (!draft.id) {
      setError("Save the inventory item before recording an adjustment.");
      return;
    }

    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      const delta = adjustmentDelta;
      await createPilotInventoryAdjustment(draft.id, {
        reason: adjustmentReason,
        quantityDelta: delta,
        movementType: delta < 0 ? "manual decrease" : "manual increase",
        sourceRecordId: `manual-${Date.now()}`,
        sourceLineId: "manual",
        note: adjustmentNote,
      });
      setMessage(`Adjustment recorded for ${draft.name}.`);
      setAdjustmentDelta(0);
      setAdjustmentNote("");
      await load();
      setSelectedId(draft.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not record adjustment.");
    } finally {
      setSaving(false);
    }
  };

  const reorderCount = data?.summary.inventoryReorderNowCount ?? 0;
  const inventoryModeLabel = editorMode === "create" ? "Create item" : editorMode === "edit" ? "Edit item" : "Browse catalog";
  const showItemEditor = editorMode !== "hidden" || selectedId !== null;
  const averageCost = draft.averageUnitCost > 0 ? draft.averageUnitCost : null;
  const estimatedInventoryValue = averageCost !== null ? draft.currentOnHand * averageCost : null;
  const openItem = (itemId: number) => {
    setSelectedId(itemId);
    setEditorMode("edit");
  };
  const startNewItem = () => {
    setSelectedId(null);
    setEditorMode("create");
    setDraft(blankDraft(suppliers));
    setItemDetail(null);
  };
  const closeItemEditor = () => {
    setSelectedId(null);
    setEditorMode("hidden");
    setItemDetail(null);
  };

  return (
    <div className="space-y-6">
      <Card className="surface-panel p-6 sm:p-7">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-brand-700">Inventory</p>
            <h1 className="mt-3 text-3xl font-bold tracking-tight text-ink sm:text-4xl">Keep stock, counts, and reorder logic aligned</h1>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-muted">Manage the item list, current on-hand quantities, adjustments, and the stock-count backbone that keeps the pilot realistic.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button icon={<Plus className="h-4 w-4" />} type="button" onClick={() => { startNewItem(); setMessage(null); }}>
              New item
            </Button>
            <Button variant="secondary" icon={<RefreshCcw className="h-4 w-4" />} type="button" onClick={() => void load()}>
              Refresh
            </Button>
            <Button type="button" icon={<Truck className="h-4 w-4" />} onClick={() => navigate("/app/reorder-plan")}>
              Reorder list ({reorderCount})
            </Button>
          </div>
        </div>

        {error ? <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{error}</div> : null}
        {message ? <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">{message}</div> : null}

        <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {[
            { label: "Items tracked", value: formatNumber(data?.summary.inventoryItemCount ?? 0) },
            { label: "Out of stock", value: formatNumber(data?.summary.inventoryOutOfStockCount ?? 0) },
            { label: "Reorder now", value: formatNumber(data?.summary.inventoryReorderNowCount ?? 0) },
            { label: "Low stock", value: formatNumber(data?.summary.inventoryLowStockCount ?? 0) },
            { label: "Inventory value", value: formatMoney(data?.summary.inventoryValue ?? 0) },
          ].map((metric) => (
            <div key={metric.label} className="rounded-2xl border border-line bg-white p-4">
              <p className="text-xs font-bold uppercase tracking-wide text-muted">{metric.label}</p>
              <p className="mt-2 text-2xl font-bold text-ink">{metric.value}</p>
            </div>
          ))}
        </div>
      </Card>

      <Card className="p-6">
        <SectionHeader title="Suppliers" description="Keep supplier names, focus areas, and active status consistent across invoices and inventory items." />

        <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
              <Badge tone="neutral">{suppliers.filter((supplier) => supplier.isActive).length} active</Badge>
              <Badge tone="neutral">{suppliers.filter((supplier) => !supplier.isActive).length} inactive</Badge>
            </div>
            <div className="rounded-2xl border border-line bg-slate-50 px-4 py-3">
              <div className="flex items-center gap-2">
                <Search className="h-4 w-4 text-muted" />
                <input className="w-full bg-transparent text-sm outline-none" placeholder="Search supplier, contact, or category" value={supplierSearch} onChange={(event) => setSupplierSearch(event.target.value)} />
              </div>
            </div>
            {filteredSuppliers.map((supplier) => (
              <button
                key={supplier.id}
                type="button"
                onClick={() => {
                  setSelectedSupplierId(supplier.id);
                  setSupplierDraft({
                    id: supplier.id,
                    name: supplier.name,
                    categoryFocus: supplier.categoryFocus,
                    contactName: supplier.contactName,
                    contactPhone: supplier.contactPhone,
                    contactEmail: supplier.contactEmail,
                    orderingNotes: supplier.orderingNotes,
                    notes: supplier.notes,
                    isActive: supplier.isActive,
                  });
                }}
                className={`w-full rounded-2xl border px-4 py-4 text-left transition hover:-translate-y-0.5 hover:shadow-soft ${
                  selectedSupplierId === supplier.id ? "border-brand-200 bg-brand-50" : "border-line bg-slate-50"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-ink">{supplier.name}</p>
                    <p className="text-sm text-muted">{supplier.categoryFocus || "Other"}</p>
                    <p className="mt-1 text-xs text-muted">{supplier.contactName || "No contact"}{supplier.contactEmail ? ` · ${supplier.contactEmail}` : ""}</p>
                  </div>
                  <Badge tone={supplier.isActive ? "success" : "neutral"}>{supplier.isActive ? "Active" : "Inactive"}</Badge>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-3 text-sm text-muted">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wide text-muted">Items</p>
                    <p className="mt-1 text-ink">{formatNumber(supplier.inventoryItemCount)}</p>
                  </div>
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wide text-muted">Invoices</p>
                    <p className="mt-1 text-ink">{formatNumber(supplier.purchaseInvoiceCount)}</p>
                  </div>
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wide text-muted">Last invoice</p>
                    <p className="mt-1 text-ink">{supplier.latestInvoiceDate ? supplier.latestInvoiceDate : "—"}</p>
                  </div>
                </div>
              </button>
            ))}
            {!filteredSuppliers.length ? <p className="rounded-2xl border border-dashed border-line px-4 py-8 text-sm text-muted">No suppliers match this search.</p> : null}
          </div>

          <div className="rounded-2xl border border-line bg-slate-50 p-4">
            <p className="text-xs font-bold uppercase tracking-wide text-muted">{supplierDraft.id ? `Edit ${supplierDraft.name || "supplier"}` : "New supplier"}</p>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <label className="block">
                <span className="text-sm font-semibold text-ink">Supplier name</span>
                <input className="input mt-1" value={supplierDraft.name} onChange={(event) => setSupplierDraft((current) => ({ ...current, name: event.target.value }))} />
              </label>
              <label className="block">
                <span className="text-sm font-semibold text-ink">Category focus</span>
                <input className="input mt-1" value={supplierDraft.categoryFocus} onChange={(event) => setSupplierDraft((current) => ({ ...current, categoryFocus: event.target.value }))} />
              </label>
              <label className="block">
                <span className="text-sm font-semibold text-ink">Contact name</span>
                <input className="input mt-1" value={supplierDraft.contactName} onChange={(event) => setSupplierDraft((current) => ({ ...current, contactName: event.target.value }))} />
              </label>
              <label className="block">
                <span className="text-sm font-semibold text-ink">Contact phone</span>
                <input className="input mt-1" value={supplierDraft.contactPhone} onChange={(event) => setSupplierDraft((current) => ({ ...current, contactPhone: event.target.value }))} />
              </label>
              <label className="block">
                <span className="text-sm font-semibold text-ink">Contact email</span>
                <input className="input mt-1" type="email" value={supplierDraft.contactEmail} onChange={(event) => setSupplierDraft((current) => ({ ...current, contactEmail: event.target.value }))} />
              </label>
            </div>
            <label className="mt-4 block">
              <span className="text-sm font-semibold text-ink">Ordering notes</span>
              <textarea className="input mt-1" value={supplierDraft.orderingNotes} onChange={(event) => setSupplierDraft((current) => ({ ...current, orderingNotes: event.target.value }))} />
            </label>
            <label className="mt-4 block">
              <span className="text-sm font-semibold text-ink">Internal notes</span>
              <textarea className="input mt-1" value={supplierDraft.notes} onChange={(event) => setSupplierDraft((current) => ({ ...current, notes: event.target.value }))} />
            </label>
            <label className="mt-4 block">
              <span className="text-sm font-semibold text-ink">Status</span>
              <select className="input mt-1" value={supplierDraft.isActive ? "true" : "false"} onChange={(event) => setSupplierDraft((current) => ({ ...current, isActive: event.target.value === "true" }))}>
                <option value="true">Active</option>
                <option value="false">Inactive</option>
              </select>
            </label>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button disabled={supplierSaving} type="button" onClick={() => void saveSupplier()}>
                {supplierDraft.id ? "Update supplier" : "Create supplier"}
              </Button>
              <Button
                variant="secondary"
                disabled={supplierSaving}
                type="button"
                onClick={() => {
                  setSelectedSupplierId(null);
                  setSupplierDraft(blankSupplierDraft(suppliers));
                }}
              >
                New supplier
              </Button>
            </div>

            {selectedSupplier ? (
              <div className="mt-4 rounded-2xl border border-line bg-white p-4">
                <p className="text-xs font-bold uppercase tracking-wide text-muted">Historical references</p>
                <div className="mt-3 grid grid-cols-3 gap-3 text-sm">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wide text-muted">Items</p>
                    <p className="mt-1 text-ink">{formatNumber(selectedSupplier.inventoryItemCount)}</p>
                  </div>
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wide text-muted">Invoices</p>
                    <p className="mt-1 text-ink">{formatNumber(selectedSupplier.purchaseInvoiceCount)}</p>
                  </div>
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wide text-muted">Mappings</p>
                    <p className="mt-1 text-ink">{formatNumber(selectedSupplier.supplierItemMappingCount)}</p>
                  </div>
                </div>
                <p className="mt-3 text-sm text-muted">
                  This supplier is referenced by {formatNumber(selectedSupplier.historicalReferenceCount)} historical records.
                </p>
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <div>
                    <p className="text-sm font-semibold text-ink">Recent invoices</p>
                    <div className="mt-2 space-y-2">
                      {selectedSupplier.recentInvoices.length ? selectedSupplier.recentInvoices.map((invoice) => (
                        <div key={invoice.id} className="rounded-2xl border border-line bg-slate-50 px-3 py-3 text-sm">
                          <div className="flex items-center justify-between gap-2">
                            <div>
                              <p className="font-semibold text-ink">{invoice.invoiceNumber}</p>
                              <p className="text-xs text-muted">{invoice.invoiceDate}</p>
                            </div>
                            <Badge tone={statusTone(invoice.status)}>{invoice.status}</Badge>
                          </div>
                          <p className="mt-2 text-muted">{formatMoney(invoice.totalAmount)}</p>
                        </div>
                      )) : <p className="rounded-2xl border border-dashed border-line px-3 py-4 text-sm text-muted">No invoice history yet.</p>}
                    </div>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-ink">Recent mappings</p>
                    <div className="mt-2 space-y-2">
                      {selectedSupplier.recentMappings.length ? selectedSupplier.recentMappings.map((mapping) => (
                        <div key={mapping.id} className="rounded-2xl border border-line bg-slate-50 px-3 py-3 text-sm">
                          <p className="font-semibold text-ink">{mapping.supplierItemName}</p>
                          <p className="text-xs text-muted">{mapping.inventoryItemName || "Unlinked inventory item"}</p>
                          <p className="mt-2 text-muted">{mapping.purchaseUnit} → {mapping.inventoryUnit} · x{formatNumber(mapping.conversionFactor)}</p>
                        </div>
                      )) : <p className="rounded-2xl border border-dashed border-line px-3 py-4 text-sm text-muted">No mapping history yet.</p>}
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[1.35fr_0.95fr]">
        <Card className="p-6">
          <SectionHeader title="Items" description="Search, open, and keep the stock list current." />
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex flex-1 items-center gap-2 rounded-2xl border border-line bg-slate-50 px-4 py-3">
              <Search className="h-4 w-4 text-muted" />
              <input className="w-full bg-transparent text-sm outline-none" placeholder="Search item, supplier, category, or unit" value={search} onChange={(event) => setSearch(event.target.value)} />
            </div>
            <Badge tone="neutral">{filteredItems.length} visible</Badge>
            <Badge tone="neutral">{data?.items.length ?? 0} total</Badge>
          </div>

          <div className="mt-4 overflow-hidden rounded-2xl border border-line bg-white">
            <div className="max-h-[62vh] overflow-y-auto">
              <table className="min-w-full border-separate border-spacing-0 text-left text-sm">
                <thead className="sticky top-0 z-10 bg-slate-50 text-xs uppercase tracking-wide text-muted">
                  <tr>
                    {["Item", "Category", "On hand", "Unit", "Minimum", "PAR", "Latest cost", "Reorder status"].map((heading) => (
                      <th key={heading} className="border-b border-line px-4 py-3 font-bold">
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredItems.map((item) => {
                    const status = stockStatus(item);
                    const selected = selectedId === item.id;
                    return (
                      <tr
                        key={item.id}
                        className={`cursor-pointer border-b border-line transition hover:bg-brand-50/60 ${selected ? "bg-brand-50" : "bg-white"}`}
                        onClick={() => openItem(item.id)}
                      >
                        <td className="px-4 py-3 font-semibold text-ink">
                          <div>
                            <p>{item.name}</p>
                            <p className="mt-1 text-xs text-muted">{item.preferredSupplierName || "No supplier"}</p>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-muted">{item.category}</td>
                        <td className="px-4 py-3 font-medium text-ink">{formatNumber(item.currentOnHand)}</td>
                        <td className="px-4 py-3 text-muted">{item.stockUnit}</td>
                        <td className="px-4 py-3 text-muted">{formatNumber(item.minQuantity)}</td>
                        <td className="px-4 py-3 text-muted">{formatNumber(item.parLevel)}</td>
                        <td className="px-4 py-3 text-muted">
                          <div className="space-y-1">
                            <p className="font-medium text-ink">{formatMoney(item.latestPurchasePrice)}</p>
                            <p className="text-xs text-muted">
                              Avg {item.averageUnitCost && item.averageUnitCost > 0 ? formatMoney(item.averageUnitCost) : "not set"}
                            </p>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <Badge tone={statusTone(status)}>{status}</Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {!filteredItems.length ? <p className="px-4 py-8 text-sm text-muted">No inventory items match this search.</p> : null}
            </div>
          </div>

          <div className="mt-5 rounded-2xl border border-line bg-slate-50 p-4 text-sm text-muted">
            <p className="font-semibold text-ink">PAR and Minimum</p>
            <p className="mt-1">PAR is the target stock level. Minimum is the point where reorder becomes urgent.</p>
          </div>

          <div className="mt-5">
            <SectionHeader title="Recent movements" description="What changed most recently." />
            <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
              {(data?.movements ?? []).slice(0, 8).map((movement) => (
                <div key={movement.id} className="rounded-2xl border border-line bg-slate-50 px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-semibold text-ink">{movement.inventoryItemName}</p>
                      <p className="text-sm text-muted">{movement.reason}</p>
                    </div>
                    <p className={`text-sm font-semibold ${movement.quantityDelta >= 0 ? "text-emerald-700" : "text-red-700"}`}>
                      {movement.quantityDelta >= 0 ? "+" : ""}{formatNumber(movement.quantityDelta)} {movement.unit}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Card>

        <Card className="p-6 lg:sticky lg:top-4">
          {showItemEditor ? (
            <>
              <SectionHeader
                title={draft.id ? `Edit ${draft.name || "inventory item"}` : editorMode === "create" ? "Create inventory item" : "Inventory item"}
                description={draft.id ? "Keep the live preview aligned with the form." : editorMode === "create" ? "Add the new item deliberately, then save it into the catalog." : "Select an item from the catalog to edit it, or start a new one."}
                action={<Button variant="secondary" type="button" onClick={closeItemEditor}>Close</Button>}
              />

          <div className="grid gap-4 md:grid-cols-2">
            <label className="block">
              <span className="text-sm font-semibold text-ink">Item name</span>
              <input className="input mt-1" value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} />
            </label>
            <label className="block">
              <span className="text-sm font-semibold text-ink">Category</span>
              <input className="input mt-1" value={draft.category} onChange={(event) => setDraft((current) => ({ ...current, category: event.target.value }))} />
            </label>
            <label className="block">
                <span className="text-sm font-semibold text-ink">Base unit</span>
                <input className="input mt-1" value={draft.stockUnit} onChange={(event) => setDraft((current) => ({ ...current, stockUnit: event.target.value }))} />
              </label>
            <label className="block">
              <span className="text-sm font-semibold text-ink">Preferred supplier</span>
              {suppliers.length ? (
                <select className="input mt-1" value={draft.preferredSupplierName} onChange={(event) => setDraft((current) => ({ ...current, preferredSupplierName: event.target.value }))}>
                  <option value="">Unassigned</option>
                  {suppliers.map((supplier) => (
                    <option key={supplier.id} value={supplier.name}>
                      {supplier.name}
                    </option>
                  ))}
                </select>
              ) : (
                <input className="input mt-1" value={draft.preferredSupplierName} onChange={(event) => setDraft((current) => ({ ...current, preferredSupplierName: event.target.value }))} />
              )}
            </label>
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-4">
            <label className="block">
              <span className="text-sm font-semibold text-ink">Current on hand</span>
              <input className="input mt-1" type="number" step="0.0001" value={draft.currentOnHand} onChange={(event) => setDraft((current) => ({ ...current, currentOnHand: Number(event.target.value) }))} />
            </label>
            <label className="block">
              <span className="text-sm font-semibold text-ink">Minimum</span>
              <input className="input mt-1" type="number" step="0.0001" value={draft.minQuantity} onChange={(event) => setDraft((current) => ({ ...current, minQuantity: Number(event.target.value) }))} />
            </label>
            <label className="block">
              <span className="text-sm font-semibold text-ink">PAR</span>
              <input className="input mt-1" type="number" step="0.0001" value={draft.parLevel} onChange={(event) => setDraft((current) => ({ ...current, parLevel: Number(event.target.value) }))} />
            </label>
            <label className="block">
              <span className="text-sm font-semibold text-ink">Latest price</span>
              <input className="input mt-1" type="number" step="0.01" value={draft.latestPurchasePrice} onChange={(event) => setDraft((current) => ({ ...current, latestPurchasePrice: Number(event.target.value) }))} />
            </label>
            <label className="block">
              <span className="text-sm font-semibold text-ink">Last purchase unit</span>
              <input className="input mt-1" value={draft.lastPurchaseUnit} onChange={(event) => setDraft((current) => ({ ...current, lastPurchaseUnit: event.target.value }))} />
            </label>
            <label className="block">
              <span className="text-sm font-semibold text-ink">Purchase conversion</span>
              <input className="input mt-1" type="number" step="0.0001" value={draft.lastPurchaseConversionFactor} onChange={(event) => setDraft((current) => ({ ...current, lastPurchaseConversionFactor: Number(event.target.value) }))} />
            </label>
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <label className="block">
              <span className="text-sm font-semibold text-ink">Average daily usage</span>
              <input className="input mt-1" type="number" step="0.0001" value={draft.averageDailyUsage} onChange={(event) => setDraft((current) => ({ ...current, averageDailyUsage: Number(event.target.value) }))} />
            </label>
            <label className="block">
              <span className="text-sm font-semibold text-ink">Active</span>
              <select className="input mt-1" value={draft.active ? "true" : "false"} onChange={(event) => setDraft((current) => ({ ...current, active: event.target.value === "true" }))}>
                <option value="true">Active</option>
                <option value="false">Inactive</option>
              </select>
            </label>
          </div>

          <label className="mt-4 block">
            <span className="text-sm font-semibold text-ink">Notes</span>
            <textarea className="input mt-1" value={draft.notes} onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))} />
          </label>

          <div className="mt-5 grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
            <div className="rounded-2xl border border-line bg-slate-50 p-4" data-testid="inventory-live-preview">
              <p className="text-xs font-bold uppercase tracking-wide text-muted">Live preview</p>
              <div className="mt-3 space-y-2">
                <p className="text-2xl font-bold text-ink">{draft.name || "New inventory item"}</p>
                <div className="flex flex-wrap gap-2">
                  <Badge tone={statusTone(stockStatus({ currentOnHand: draft.currentOnHand, minQuantity: draft.minQuantity, parLevel: draft.parLevel, averageDailyUsage: draft.averageDailyUsage }))}>
                    {stockStatus({ currentOnHand: draft.currentOnHand, minQuantity: draft.minQuantity, parLevel: draft.parLevel, averageDailyUsage: draft.averageDailyUsage })}
                  </Badge>
                  <Badge tone="neutral">{draft.category || "Other"}</Badge>
                  <Badge tone="neutral">{draft.stockUnit || "each"}</Badge>
                </div>
                <div className="grid grid-cols-2 gap-3 pt-2 text-sm">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wide text-muted">On hand</p>
                    <p className="mt-1 text-ink">{formatNumber(draft.currentOnHand)} {draft.stockUnit}</p>
                  </div>
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wide text-muted">PAR / Min</p>
                    <p className="mt-1 text-ink">{formatNumber(draft.parLevel)} / {formatNumber(draft.minQuantity)}</p>
                  </div>
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wide text-muted">Supplier</p>
                    <p className="mt-1 text-ink">{draft.preferredSupplierName || "Unassigned"}</p>
                  </div>
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wide text-muted">Average cost</p>
                    <p className="mt-1 text-ink">{averageCost !== null ? formatMoney(averageCost) : "Not yet available"}</p>
                  </div>
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wide text-muted">Latest cost</p>
                    <p className="mt-1 text-ink">{formatMoney(draft.latestPurchasePrice)}</p>
                  </div>
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wide text-muted">Estimated inventory value</p>
                    <p className="mt-1 text-ink">{estimatedInventoryValue !== null ? formatMoney(estimatedInventoryValue) : "Not yet available"}</p>
                  </div>
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wide text-muted">Last purchase</p>
                    <p className="mt-1 text-ink">{draft.lastPurchaseUnit || "each"} · x{formatNumber(draft.lastPurchaseConversionFactor)}</p>
                  </div>
                </div>
                <p className="text-xs text-muted">Base unit changes are blocked once an item has invoice or movement history.</p>
              </div>
            </div>

            <div className="rounded-2xl border border-line bg-slate-50 p-4">
              <p className="text-xs font-bold uppercase tracking-wide text-muted">Adjustment</p>
              <div className="mt-3 grid gap-4 md:grid-cols-2">
                <label className="block">
                  <span className="text-sm font-semibold text-ink">Quantity delta</span>
                  <input className="input mt-1" type="number" step="0.0001" value={adjustmentDelta} onChange={(event) => setAdjustmentDelta(Number(event.target.value))} />
                </label>
                <label className="block">
                  <span className="text-sm font-semibold text-ink">Reason</span>
                  <input className="input mt-1" value={adjustmentReason} onChange={(event) => setAdjustmentReason(event.target.value)} />
                </label>
              </div>
              <label className="mt-3 block">
                <span className="text-sm font-semibold text-ink">Note</span>
                <textarea className="input mt-1" value={adjustmentNote} onChange={(event) => setAdjustmentNote(event.target.value)} />
              </label>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button disabled={saving} icon={<Scale className="h-4 w-4" />} type="button" onClick={() => void saveAdjustment()}>
                  Save stock movement
                </Button>
                <Button variant="secondary" disabled={saving || !draft.id} icon={<SquarePen className="h-4 w-4" />} type="button" onClick={() => void saveItem()}>
                  {draft.id ? "Update item" : "Create item"}
                </Button>
                <Button variant="secondary" icon={<ArrowRight className="h-4 w-4" />} type="button" onClick={() => navigate("/app/stock-counts")}>
                  Stock counts
                </Button>
              </div>
            </div>
          </div>

          <div className="mt-5 grid gap-4 xl:grid-cols-3">
            <div className="rounded-2xl border border-line bg-white p-4">
              <p className="text-xs font-bold uppercase tracking-wide text-muted">Purchase history</p>
              <div className="mt-3 space-y-2">
                {itemDetailLoading ? <p className="text-sm text-muted">Loading purchase history...</p> : null}
                {selectedItemPurchaseHistory.length ? selectedItemPurchaseHistory.map((line) => (
                  <div key={line.id} className="rounded-2xl border border-line bg-slate-50 px-3 py-3 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <p className="font-semibold text-ink">{line.invoiceNumber}</p>
                        <p className="text-xs text-muted">{line.supplierName} · {line.invoiceDate}</p>
                      </div>
                      <p className="font-semibold text-ink">{formatMoney(line.lineTotal)}</p>
                    </div>
                    <p className="mt-2 text-muted">{line.description} · {formatNumber(line.quantity)} {line.purchaseUnit}</p>
                  </div>
                )) : !itemDetailLoading ? <p className="rounded-2xl border border-dashed border-line px-3 py-4 text-sm text-muted">No purchase history yet.</p> : null}
              </div>
            </div>

            <div className="rounded-2xl border border-line bg-white p-4">
              <p className="text-xs font-bold uppercase tracking-wide text-muted">Movement history</p>
              <div className="mt-3 space-y-2">
                {itemDetailLoading ? <p className="text-sm text-muted">Loading movement history...</p> : null}
                {selectedItemMovementHistory.length ? selectedItemMovementHistory.map((movement) => (
                  <div key={movement.id} className="rounded-2xl border border-line bg-slate-50 px-3 py-3 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-semibold text-ink">{movement.sourceType}</p>
                      <p className={`font-semibold ${movement.quantityDelta >= 0 ? "text-emerald-700" : "text-red-700"}`}>
                        {movement.quantityDelta >= 0 ? "+" : ""}{formatNumber(movement.quantityDelta)} {movement.unit}
                      </p>
                    </div>
                    <p className="mt-2 text-xs text-muted">{movement.reason}</p>
                  </div>
                )) : !itemDetailLoading ? <p className="rounded-2xl border border-dashed border-line px-3 py-4 text-sm text-muted">No movement history yet.</p> : null}
              </div>
            </div>

            <div className="rounded-2xl border border-line bg-white p-4">
              <p className="text-xs font-bold uppercase tracking-wide text-muted">Supplier mappings</p>
              <div className="mt-3 space-y-2">
                {itemDetailLoading ? <p className="text-sm text-muted">Loading mapping history...</p> : null}
                {selectedItemSupplierMappings.length ? selectedItemSupplierMappings.map((mapping) => (
                  <div key={mapping.id} className="rounded-2xl border border-line bg-slate-50 px-3 py-3 text-sm">
                    <p className="font-semibold text-ink">{mapping.supplierItemName}</p>
                    <p className="text-xs text-muted">{mapping.purchaseUnit} → {mapping.inventoryUnit} · x{formatNumber(mapping.conversionFactor)}</p>
                    <p className="mt-2 text-xs text-muted">{mapping.lastSeenAt ? `Last seen ${mapping.lastSeenAt}` : "No last-seen date"}</p>
                  </div>
                )) : !itemDetailLoading ? <p className="rounded-2xl border border-dashed border-line px-3 py-4 text-sm text-muted">No supplier mappings yet.</p> : null}
              </div>
            </div>
          </div>
          </>
          ) : (
            <div className="flex min-h-[44rem] flex-col justify-center rounded-2xl border border-dashed border-line bg-slate-50 p-8">
              <p className="text-xs font-bold uppercase tracking-wide text-muted">Inventory workspace</p>
              <h2 className="mt-2 text-2xl font-bold text-ink">Select an item or create one deliberately</h2>
              <p className="mt-3 max-w-md text-sm leading-6 text-muted">
                The catalog stays visible on the left. Open an item to edit its details, or start a new item when you are ready to add one.
              </p>
              <div className="mt-5 flex flex-wrap gap-3">
                <Button type="button" onClick={startNewItem}>
                  New item
                </Button>
                <Button variant="secondary" type="button" onClick={() => navigate("/app/reorder-plan")}>
                  Reorder list
                </Button>
              </div>
            </div>
          )}
        </Card>
      </div>

      <Card className="p-6">
        <SectionHeader title="Count sessions" description="Recent counts and the session status." />
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {(data?.countSessions ?? []).slice(0, 3).map((session) => <CountSessionCard key={session.id} session={session} />)}
          {!data?.countSessions.length ? <p className="rounded-2xl border border-dashed border-line px-4 py-8 text-sm text-muted">No count sessions yet.</p> : null}
        </div>
      </Card>
    </div>
  );
}

function CountSessionCard({ session }: { session: PilotCountSession }) {
  return (
    <div className="rounded-2xl border border-line bg-slate-50 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-ink">Count #{session.id}</p>
          <p className="text-sm text-muted">{session.countedBy || "Unassigned"} • {formatDateTime(session.updatedAt)}</p>
        </div>
        <Badge tone={statusTone(session.status)}>{session.status}</Badge>
      </div>
      <p className="mt-3 text-sm text-muted">{session.itemCount} items counted</p>
      <div className="mt-3 flex items-center justify-between text-sm">
        <span className="text-muted">Completed</span>
        <span className="font-semibold text-ink">{session.completedAt ? formatDateTime(session.completedAt) : "Pending"}</span>
      </div>
    </div>
  );
}
