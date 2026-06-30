import { normalizeComparisonKey } from "./invoiceLineItemView";
import type {
  InventoryInvoiceReceipt,
  InventoryItem,
  InventoryItemStatus,
  InventoryMovement,
  InventoryMovementType,
  InventoryLineMapping,
  PilotInventoryDraft,
  PilotInventoryDraftLine,
  PilotInventoryState,
  PilotInvoiceLineItem,
  PilotInvoiceRecord,
  PilotWorkspaceSummary,
} from "../types";
import { formatCurrency } from "../utils/format";

const LOW_STOCK_DAYS = 14;

type SeedInventorySpec = {
  id: string;
  name: string;
  category: string;
  currentQuantity: number;
  receiptQuantity: number;
  unit: string;
  minQuantity: number;
  parLevel: number;
  preferredSupplier: string;
  latestPurchasePrice: number;
  latestPurchaseUnit: string;
  latestPurchaseConversionFactor: number;
  lastReceivedAt: string;
  lastCountedAt: string;
  averageDailyUsage: number;
  notes: string;
  movements: Array<{
    movementType: InventoryMovementType;
    quantityDelta: number;
    note: string;
    createdAt: string;
  }>;
};

const seedInventorySpecs: SeedInventorySpec[] = [
  {
    id: "inventory-seed-1",
    name: "Tapioca pearls 3kg bag",
    category: "Tea / beverage base",
    currentQuantity: 2,
    receiptQuantity: 4,
    unit: "bag",
    minQuantity: 3,
    parLevel: 6,
    preferredSupplier: "GTA Beverage Supply",
    latestPurchasePrice: 45,
    latestPurchaseUnit: "bag",
    latestPurchaseConversionFactor: 1,
    lastReceivedAt: "2026-06-03",
    lastCountedAt: "2026-06-20",
    averageDailyUsage: 1.1,
    notes: "Needs reorder after the lunch rush.",
    movements: [
      {
        movementType: "usage",
        quantityDelta: -1,
        note: "Sample sales usage (demo only).",
        createdAt: "2026-06-04T18:00:00.000Z",
      },
      {
        movementType: "physical count adjustment",
        quantityDelta: -1,
        note: "Physical count adjustment after end-of-day count.",
        createdAt: "2026-06-05T09:00:00.000Z",
      },
    ],
  },
  {
    id: "inventory-seed-2",
    name: "Brown sugar syrup 5L",
    category: "Syrups / toppings",
    currentQuantity: 4,
    receiptQuantity: 4,
    unit: "bottle",
    minQuantity: 3,
    parLevel: 7,
    preferredSupplier: "GTA Beverage Supply",
    latestPurchasePrice: 31,
    latestPurchaseUnit: "bottle",
    latestPurchaseConversionFactor: 1,
    lastReceivedAt: "2026-06-03",
    lastCountedAt: "2026-06-19",
    averageDailyUsage: 0.7,
    notes: "Price moved up but stock is still manageable.",
    movements: [],
  },
  {
    id: "inventory-seed-3",
    name: "Black tea leaves 1kg",
    category: "Tea / beverage base",
    currentQuantity: 9,
    receiptQuantity: 8,
    unit: "bag",
    minQuantity: 4,
    parLevel: 10,
    preferredSupplier: "GTA Beverage Supply",
    latestPurchasePrice: 34,
    latestPurchaseUnit: "bag",
    latestPurchaseConversionFactor: 1,
    lastReceivedAt: "2026-06-05",
    lastCountedAt: "2026-06-19",
    averageDailyUsage: 0.6,
    notes: "Stable item with no urgent reorder need.",
    movements: [
      {
        movementType: "manual addition",
        quantityDelta: 1,
        note: "Manual adjustment after stockroom review.",
        createdAt: "2026-06-06T10:30:00.000Z",
      },
    ],
  },
  {
    id: "inventory-seed-4",
    name: "Oat milk cartons",
    category: "Dairy",
    currentQuantity: 3,
    receiptQuantity: 4,
    unit: "case",
    minQuantity: 4,
    parLevel: 8,
    preferredSupplier: "Fresh Dairy Toronto",
    latestPurchasePrice: 41,
    latestPurchaseUnit: "case",
    latestPurchaseConversionFactor: 1,
    lastReceivedAt: "2026-06-03",
    lastCountedAt: "2026-06-20",
    averageDailyUsage: 0.9,
    notes: "Low stock after a busy cold-drink weekend.",
    movements: [
      {
        movementType: "usage",
        quantityDelta: -1,
        note: "Sample sales usage (demo only).",
        createdAt: "2026-06-04T16:30:00.000Z",
      },
    ],
  },
  {
    id: "inventory-seed-5",
    name: "700ml plastic cups",
    category: "Packaging",
    currentQuantity: 22,
    receiptQuantity: 24,
    unit: "case",
    minQuantity: 12,
    parLevel: 24,
    preferredSupplier: "Metro Packaging",
    latestPurchasePrice: 65,
    latestPurchaseUnit: "case",
    latestPurchaseConversionFactor: 1,
    lastReceivedAt: "2026-06-04",
    lastCountedAt: "2026-06-19",
    averageDailyUsage: 1.2,
    notes: "Healthy stock after the supplier price dropped.",
    movements: [
      {
        movementType: "correction",
        quantityDelta: -2,
        note: "Manual correction after opening count.",
        createdAt: "2026-06-05T11:15:00.000Z",
      },
    ],
  },
  {
    id: "inventory-seed-6",
    name: "Cup sealing film",
    category: "Packaging",
    currentQuantity: 1,
    receiptQuantity: 2,
    unit: "roll",
    minQuantity: 2,
    parLevel: 5,
    preferredSupplier: "Metro Packaging",
    latestPurchasePrice: 58,
    latestPurchaseUnit: "roll",
    latestPurchaseConversionFactor: 1,
    lastReceivedAt: "2026-06-04",
    lastCountedAt: "2026-06-20",
    averageDailyUsage: 0.4,
    notes: "Below minimum and due for reorder.",
    movements: [
      {
        movementType: "physical count adjustment",
        quantityDelta: -1,
        note: "Physical count adjustment after closing stock take.",
        createdAt: "2026-06-06T08:45:00.000Z",
      },
    ],
  },
  {
    id: "inventory-seed-7",
    name: "Straws",
    category: "Packaging",
    currentQuantity: 16,
    receiptQuantity: 14,
    unit: "box",
    minQuantity: 8,
    parLevel: 18,
    preferredSupplier: "Metro Packaging",
    latestPurchasePrice: 22,
    latestPurchaseUnit: "box",
    latestPurchaseConversionFactor: 1,
    lastReceivedAt: "2026-06-04",
    lastCountedAt: "2026-06-18",
    averageDailyUsage: 0.3,
    notes: "Manual count topped the bin back up.",
    movements: [
      {
        movementType: "manual addition",
        quantityDelta: 2,
        note: "Manual adjustment after refill.",
        createdAt: "2026-06-06T09:10:00.000Z",
      },
    ],
  },
  {
    id: "inventory-seed-8",
    name: "Cup lids",
    category: "Packaging",
    currentQuantity: 5,
    receiptQuantity: 5,
    unit: "case",
    minQuantity: 4,
    parLevel: 8,
    preferredSupplier: "Metro Packaging",
    latestPurchasePrice: 35,
    latestPurchaseUnit: "case",
    latestPurchaseConversionFactor: 1,
    lastReceivedAt: "2026-06-04",
    lastCountedAt: "2026-06-19",
    averageDailyUsage: 0.5,
    notes: "Stable pricing and steady usage.",
    movements: [],
  },
  {
    id: "inventory-seed-9",
    name: "Croissants",
    category: "Food / bakery",
    currentQuantity: 6,
    receiptQuantity: 6,
    unit: "tray",
    minQuantity: 4,
    parLevel: 8,
    preferredSupplier: "Local Bakery Supply",
    latestPurchasePrice: 28.4,
    latestPurchaseUnit: "tray",
    latestPurchaseConversionFactor: 1,
    lastReceivedAt: "2026-06-11",
    lastCountedAt: "2026-06-18",
    averageDailyUsage: 1.4,
    notes: "Croissants move fastest in the morning rush.",
    movements: [
      {
        movementType: "usage",
        quantityDelta: -1,
        note: "Sample bakery usage (demo only).",
        createdAt: "2026-06-11T17:00:00.000Z",
      },
    ],
  },
  {
    id: "inventory-seed-10",
    name: "Breakfast Sandwich Buns",
    category: "Food / bakery",
    currentQuantity: 8,
    receiptQuantity: 8,
    unit: "bag",
    minQuantity: 6,
    parLevel: 10,
    preferredSupplier: "No Frills Grocery",
    latestPurchasePrice: 13.7,
    latestPurchaseUnit: "bag",
    latestPurchaseConversionFactor: 1,
    lastReceivedAt: "2026-06-15",
    lastCountedAt: "2026-06-18",
    averageDailyUsage: 0.8,
    notes: "Breakfast sandwich buns stay in the prep cycle and track with grocery top-ups.",
    movements: [],
  },
  {
    id: "inventory-seed-11",
    name: "Jasmine Rice 20kg",
    category: "Dry goods",
    currentQuantity: 2,
    receiptQuantity: 3,
    unit: "bag",
    minQuantity: 2,
    parLevel: 4,
    preferredSupplier: "Ontario Produce Co.",
    latestPurchasePrice: 36,
    latestPurchaseUnit: "bag",
    latestPurchaseConversionFactor: 1,
    lastReceivedAt: "2026-06-06",
    lastCountedAt: "2026-06-18",
    averageDailyUsage: 0.35,
    notes: "Core lunch item for bowls and weekly prep.",
    movements: [],
  },
  {
    id: "inventory-seed-12",
    name: "Chicken Thigh 10kg",
    category: "Meat / protein",
    currentQuantity: 1,
    receiptQuantity: 2,
    unit: "case",
    minQuantity: 1,
    parLevel: 3,
    preferredSupplier: "Ontario Meat & Poultry",
    latestPurchasePrice: 82,
    latestPurchaseUnit: "case",
    latestPurchaseConversionFactor: 1,
    lastReceivedAt: "2026-06-06",
    lastCountedAt: "2026-06-18",
    averageDailyUsage: 0.4,
    notes: "Prep-heavy protein item; reorder before the weekend.",
    movements: [],
  },
  {
    id: "inventory-seed-13",
    name: "Wheat Noodles 10kg",
    category: "Dry goods",
    currentQuantity: 2,
    receiptQuantity: 2,
    unit: "case",
    minQuantity: 1,
    parLevel: 3,
    preferredSupplier: "Ontario Produce Co.",
    latestPurchasePrice: 42,
    latestPurchaseUnit: "case",
    latestPurchaseConversionFactor: 1,
    lastReceivedAt: "2026-06-06",
    lastCountedAt: "2026-06-18",
    averageDailyUsage: 0.25,
    notes: "Used by the spicy noodle bowl.",
    movements: [],
  },
  {
    id: "inventory-seed-14",
    name: "Penne Pasta 10kg",
    category: "Dry goods",
    currentQuantity: 1,
    receiptQuantity: 2,
    unit: "case",
    minQuantity: 1,
    parLevel: 3,
    preferredSupplier: "Ontario Produce Co.",
    latestPurchasePrice: 39,
    latestPurchaseUnit: "case",
    latestPurchaseConversionFactor: 1,
    lastReceivedAt: "2026-06-06",
    lastCountedAt: "2026-06-18",
    averageDailyUsage: 0.18,
    notes: "Pasta station item for the weekday lunch menu.",
    movements: [],
  },
  {
    id: "inventory-seed-15",
    name: "Teriyaki Sauce 4L",
    category: "Sauces / condiments",
    currentQuantity: 2,
    receiptQuantity: 2,
    unit: "jug",
    minQuantity: 1,
    parLevel: 3,
    preferredSupplier: "Ontario Produce Co.",
    latestPurchasePrice: 24,
    latestPurchaseUnit: "jug",
    latestPurchaseConversionFactor: 1,
    lastReceivedAt: "2026-06-06",
    lastCountedAt: "2026-06-18",
    averageDailyUsage: 0.12,
    notes: "Bowl sauce tracked for expected ingredient usage.",
    movements: [],
  },
  {
    id: "inventory-seed-16",
    name: "Canola Oil 16L",
    category: "Oils / staples",
    currentQuantity: 1,
    receiptQuantity: 2,
    unit: "jug",
    minQuantity: 1,
    parLevel: 2,
    preferredSupplier: "Ontario Produce Co.",
    latestPurchasePrice: 47,
    latestPurchaseUnit: "jug",
    latestPurchaseConversionFactor: 1,
    lastReceivedAt: "2026-06-06",
    lastCountedAt: "2026-06-18",
    averageDailyUsage: 0.08,
    notes: "Prep staple for bowls, noodles, and saute station.",
    movements: [],
  },
  {
    id: "inventory-seed-17",
    name: "Kosher Salt 1kg",
    category: "Dry goods",
    currentQuantity: 4,
    receiptQuantity: 4,
    unit: "box",
    minQuantity: 2,
    parLevel: 4,
    preferredSupplier: "Ontario Produce Co.",
    latestPurchasePrice: 6,
    latestPurchaseUnit: "box",
    latestPurchaseConversionFactor: 1,
    lastReceivedAt: "2026-06-06",
    lastCountedAt: "2026-06-18",
    averageDailyUsage: 0.03,
    notes: "Low-cost staple kept for recipe completeness.",
    movements: [],
  },
  {
    id: "inventory-seed-18",
    name: "Black Pepper 500g",
    category: "Dry goods",
    currentQuantity: 2,
    receiptQuantity: 2,
    unit: "tin",
    minQuantity: 1,
    parLevel: 2,
    preferredSupplier: "Ontario Produce Co.",
    latestPurchasePrice: 9.5,
    latestPurchaseUnit: "tin",
    latestPurchaseConversionFactor: 1,
    lastReceivedAt: "2026-06-06",
    lastCountedAt: "2026-06-18",
    averageDailyUsage: 0.02,
    notes: "Used by pasta and prep recipes.",
    movements: [],
  },
  {
    id: "inventory-seed-19",
    name: "Chili Oil 2L",
    category: "Sauces / condiments",
    currentQuantity: 1,
    receiptQuantity: 2,
    unit: "jug",
    minQuantity: 1,
    parLevel: 2,
    preferredSupplier: "Ontario Produce Co.",
    latestPurchasePrice: 28,
    latestPurchaseUnit: "jug",
    latestPurchaseConversionFactor: 1,
    lastReceivedAt: "2026-06-06",
    lastCountedAt: "2026-06-18",
    averageDailyUsage: 0.08,
    notes: "Spicy noodle prep item.",
    movements: [],
  },
  {
    id: "inventory-seed-20",
    name: "Peanut Sauce 4L",
    category: "Sauces / condiments",
    currentQuantity: 2,
    receiptQuantity: 2,
    unit: "jug",
    minQuantity: 1,
    parLevel: 3,
    preferredSupplier: "Ontario Produce Co.",
    latestPurchasePrice: 32,
    latestPurchaseUnit: "jug",
    latestPurchaseConversionFactor: 1,
    lastReceivedAt: "2026-06-06",
    lastCountedAt: "2026-06-18",
    averageDailyUsage: 0.1,
    notes: "Used by the noodle bowl recipe.",
    movements: [],
  },
  {
    id: "inventory-seed-21",
    name: "Tomato Sauce 6x2.84L",
    category: "Sauces / condiments",
    currentQuantity: 1,
    receiptQuantity: 2,
    unit: "case",
    minQuantity: 1,
    parLevel: 2,
    preferredSupplier: "Ontario Produce Co.",
    latestPurchasePrice: 44,
    latestPurchaseUnit: "case",
    latestPurchaseConversionFactor: 1,
    lastReceivedAt: "2026-06-06",
    lastCountedAt: "2026-06-18",
    averageDailyUsage: 0.08,
    notes: "Pasta sauce base for the lunch menu.",
    movements: [],
  },
];

function nowIso() {
  return new Date().toISOString();
}

function toMillis(value: string | undefined) {
  if (!value) {
    return Number.NEGATIVE_INFINITY;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

function clampMoney(value: number) {
  return Number.isFinite(value) ? Number(value.toFixed(2)) : 0;
}

function clampQuantity(value: number) {
  return Number.isFinite(value) ? Number(value.toFixed(2)) : 0;
}

function normalizeName(value: string) {
  return normalizeComparisonKey(value);
}

function normalizeSupplierKey(value: string) {
  return value.trim().toLowerCase();
}

function inventoryStatusForItem(item: InventoryItem): InventoryItemStatus {
  const now = Date.now();
  const lastCountedAt = Date.parse(item.lastCountedAt || "");
  const countIsStale = !Number.isFinite(lastCountedAt) || now - lastCountedAt > LOW_STOCK_DAYS * 24 * 60 * 60 * 1000;

  if (item.currentQuantity <= 0) {
    return "Out of stock";
  }
  if (item.currentQuantity <= item.minQuantity) {
    return "Reorder now";
  }
  if (item.currentQuantity <= item.parLevel) {
    return "Low stock";
  }
  if (countIsStale) {
    return "Count needed";
  }
  return "In stock";
}

export function getInventoryStatusTone(status: InventoryItemStatus) {
  switch (status) {
    case "Out of stock":
    case "Reorder now":
      return "danger" as const;
    case "Low stock":
    case "Count needed":
      return "warning" as const;
    default:
      return "success" as const;
  }
}

export function getInventoryStatusLabel(item: InventoryItem) {
  return inventoryStatusForItem(item);
}

export function sortInventoryItems(items: InventoryItem[]) {
  return [...items].sort((a, b) => {
    const activeDelta = Number(b.active) - Number(a.active);
    if (activeDelta !== 0) {
      return activeDelta;
    }

    const statusOrder = inventoryStatusRank(inventoryStatusForItem(a)) - inventoryStatusRank(inventoryStatusForItem(b));
    if (statusOrder !== 0) {
      return statusOrder;
    }

    return a.name.localeCompare(b.name);
  });
}

function inventoryStatusRank(status: InventoryItemStatus) {
  switch (status) {
    case "Out of stock":
      return 0;
    case "Reorder now":
      return 1;
    case "Low stock":
      return 2;
    case "Count needed":
      return 3;
    default:
      return 4;
  }
}

function createSeedInventoryItems(): InventoryItem[] {
  return seedInventorySpecs.map((item) => {
    const createdAt = `${item.lastReceivedAt}T12:00:00.000Z`;
    return {
      id: item.id,
      name: item.name,
      normalizedName: normalizeName(item.name),
      category: item.category,
      currentQuantity: item.currentQuantity,
      unit: item.unit,
      minQuantity: item.minQuantity,
      parLevel: item.parLevel,
      preferredSupplier: item.preferredSupplier,
      latestPurchasePrice: clampMoney(item.latestPurchasePrice),
      latestPurchaseUnit: item.latestPurchaseUnit,
      latestPurchaseConversionFactor: item.latestPurchaseConversionFactor,
      lastReceivedAt: item.lastReceivedAt,
      lastCountedAt: item.lastCountedAt,
      averageDailyUsage: item.averageDailyUsage,
      supplierMatchKey: normalizeName(item.preferredSupplier),
      itemMatchKey: normalizeName(item.name),
      active: true,
      notes: item.notes,
      createdAt,
      updatedAt: createdAt,
    };
  });
}

function createSeedMovements(items: InventoryItem[]): InventoryMovement[] {
  return items.flatMap((item, index) => {
    const spec = seedInventorySpecs.find((candidate) => candidate.id === item.id);
    const receiptCreatedAt = item.createdAt;
    let runningQuantity = spec?.receiptQuantity ?? item.currentQuantity;
    const receiptMovement: InventoryMovement = {
      id: `inventory-movement-seed-${index + 1}`,
      inventoryItemId: item.id,
      inventoryItemName: item.name,
      movementType: "invoice receipt",
      quantityDelta: runningQuantity,
      quantityBefore: 0,
      quantityAfter: runningQuantity,
      unit: item.unit,
      sourceInvoiceId: `seed-invoice-${index + 1}`,
      sourceInvoiceNumber: `INV-SEED-${index + 1}`,
      sourceInvoiceDate: item.lastReceivedAt,
      sourceInvoiceLineItemId: `seed-line-${index + 1}`,
      sourceInvoiceLineDescription: item.name,
      receiptKey: `seed-receipt-${index + 1}`,
      note: "Seeded starting inventory receipt.",
      createdAt: receiptCreatedAt,
      updatedAt: receiptCreatedAt,
    };

    const adjustments = (spec?.movements ?? []).map((movement, movementIndex) => {
      const createdAt = movement.createdAt;
      const quantityBefore = runningQuantity;
      runningQuantity = Number((runningQuantity + movement.quantityDelta).toFixed(2));
      return {
        id: `inventory-movement-seed-${index + 1}-${movementIndex + 1}`,
        inventoryItemId: item.id,
        inventoryItemName: item.name,
        movementType: movement.movementType,
        quantityDelta: Number(movement.quantityDelta.toFixed(2)),
        quantityBefore,
        quantityAfter: runningQuantity,
        unit: item.unit,
        note: movement.note,
        createdAt,
        updatedAt: createdAt,
      } satisfies InventoryMovement;
    });

    return [receiptMovement, ...adjustments];
  });
}

function createSeedReceipts(items: InventoryItem[]): InventoryInvoiceReceipt[] {
  return items.map((item, index) => {
    const spec = seedInventorySpecs.find((candidate) => candidate.id === item.id);
    const createdAt = item.createdAt;
    const quantity = spec?.receiptQuantity ?? item.currentQuantity;
    return {
      id: `inventory-receipt-seed-${index + 1}`,
      invoiceId: `seed-invoice-${index + 1}`,
      invoiceNumber: `INV-SEED-${index + 1}`,
      invoiceDate: item.lastReceivedAt,
      supplier: item.preferredSupplier,
      invoiceLineItemId: `seed-line-${index + 1}`,
      invoiceLineDescription: item.name,
      normalizedDescription: item.itemMatchKey,
      inventoryItemId: item.id,
      inventoryItemName: item.name,
      quantity,
      unit: item.unit,
      conversionFactor: 1,
      unitPrice: item.latestPurchasePrice,
      lineTotal: clampMoney(item.latestPurchasePrice * quantity),
      receiptKey: `seed-receipt-${index + 1}`,
      note: "Seeded starting inventory receipt.",
      createdAt,
      updatedAt: createdAt,
    };
  });
}

export function createSeedInventoryState(): PilotInventoryState {
  const items = createSeedInventoryItems();
  return {
    items,
    movements: createSeedMovements(items),
    receipts: createSeedReceipts(items),
    lineMappings: [],
    countSessions: [],
    reorderIntents: [],
  };
}

function ensureInventoryItemShape(item: InventoryItem): InventoryItem {
  const normalizedName = item.normalizedName || normalizeName(item.name);
  const currentQuantity = clampQuantity(item.currentQuantity);
  const minQuantity = clampQuantity(item.minQuantity);
  const parLevel = clampQuantity(item.parLevel || item.minQuantity + 1);
  const createdAt = item.createdAt || item.updatedAt || nowIso();
  const updatedAt = item.updatedAt || createdAt;
  const lastReceivedAt = item.lastReceivedAt || createdAt.slice(0, 10);
  const lastCountedAt = item.lastCountedAt || lastReceivedAt;
  return {
    ...item,
    name: item.name.trim() || "Unnamed item",
    normalizedName,
    category: item.category.trim() || "Other",
    currentQuantity,
    unit: item.unit.trim() || "each",
    minQuantity,
    parLevel: Math.max(parLevel, minQuantity),
    preferredSupplier: item.preferredSupplier.trim(),
    latestPurchasePrice: clampMoney(item.latestPurchasePrice),
    latestPurchaseUnit: item.latestPurchaseUnit?.trim() || item.unit.trim() || "each",
    latestPurchaseConversionFactor: typeof item.latestPurchaseConversionFactor === "number" && Number.isFinite(item.latestPurchaseConversionFactor) ? Number(item.latestPurchaseConversionFactor.toFixed(4)) : undefined,
    lastReceivedAt,
    lastCountedAt,
    averageDailyUsage: typeof item.averageDailyUsage === "number" && Number.isFinite(item.averageDailyUsage) ? Number(item.averageDailyUsage.toFixed(2)) : undefined,
    supplierMatchKey: item.supplierMatchKey.trim() || normalizeName(item.preferredSupplier),
    itemMatchKey: item.itemMatchKey.trim() || normalizedName,
    active: Boolean(item.active),
    notes: item.notes.trim(),
    createdAt,
    updatedAt,
  };
}

export function normalizeStoredInventoryState(state: Partial<PilotInventoryState> | undefined): PilotInventoryState {
  const fallback = createSeedInventoryState();
  const items = Array.isArray(state?.items) ? state.items.map((item) => ensureInventoryItemShape(item)) : fallback.items;
  const itemMap = new Map(items.map((item) => [item.id, item] as const));

  const movements = Array.isArray(state?.movements)
    ? state.movements.map((movement) => ({
        ...movement,
        inventoryItemName: movement.inventoryItemName || itemMap.get(movement.inventoryItemId)?.name || "Unknown item",
        movementType: movement.movementType as InventoryMovementType,
        quantityDelta: clampQuantity(movement.quantityDelta),
        quantityBefore: clampQuantity(movement.quantityBefore),
        quantityAfter: clampQuantity(movement.quantityAfter),
        unit: movement.unit || itemMap.get(movement.inventoryItemId)?.unit || "each",
        note: movement.note?.trim() || "",
        createdAt: movement.createdAt || movement.updatedAt || nowIso(),
        updatedAt: movement.updatedAt || movement.createdAt || nowIso(),
      }))
    : fallback.movements;

  const receipts = Array.isArray(state?.receipts)
    ? state.receipts.map((receipt) => ({
        ...receipt,
        invoiceNumber: receipt.invoiceNumber || "",
        invoiceDate: receipt.invoiceDate || "",
        supplier: receipt.supplier?.trim() || "Unknown supplier",
        invoiceLineDescription: receipt.invoiceLineDescription || "",
        normalizedDescription: receipt.normalizedDescription || normalizeName(receipt.invoiceLineDescription || ""),
        inventoryItemName: receipt.inventoryItemName || itemMap.get(receipt.inventoryItemId)?.name || "Unknown item",
        quantity: clampQuantity(receipt.quantity),
        unit: receipt.unit || itemMap.get(receipt.inventoryItemId)?.unit || "each",
        conversionFactor: receipt.conversionFactor && Number.isFinite(receipt.conversionFactor) ? Number(receipt.conversionFactor) : 1,
        unitPrice: clampMoney(receipt.unitPrice),
        lineTotal: clampMoney(receipt.lineTotal),
        note: receipt.note?.trim() || "",
        createdAt: receipt.createdAt || receipt.updatedAt || nowIso(),
        updatedAt: receipt.updatedAt || receipt.createdAt || nowIso(),
      }))
    : fallback.receipts;

  const lineMappings = Array.isArray(state?.lineMappings)
    ? state.lineMappings.map((mapping) => ({
        id: mapping.id || `inventory-mapping-${nowIso()}`,
        supplierKey: normalizeSupplierKey(mapping.supplierKey || ""),
        lineKey: normalizeName(mapping.lineKey || ""),
        inventoryItemId: mapping.inventoryItemId || "",
        inventoryItemName: mapping.inventoryItemName || itemMap.get(mapping.inventoryItemId)?.name || "Unknown item",
        confirmedInvoiceUnit: mapping.confirmedInvoiceUnit || "each",
        inventoryUnit: mapping.inventoryUnit || itemMap.get(mapping.inventoryItemId)?.unit || "each",
        conversionFactor: Number.isFinite(mapping.conversionFactor) ? Number(mapping.conversionFactor) : 1,
        confirmedAt: mapping.confirmedAt || nowIso(),
      }))
    : fallback.lineMappings ?? [];

  const countSessions = Array.isArray(state?.countSessions) ? state.countSessions : fallback.countSessions ?? [];
  const reorderIntents = Array.isArray(state?.reorderIntents) ? state.reorderIntents : fallback.reorderIntents ?? [];

  return {
    items,
    movements,
    receipts,
    lineMappings,
    countSessions,
    reorderIntents,
  };
}

export function buildInventorySummary(state: PilotInventoryState): Pick<PilotWorkspaceSummary, "inventoryItemCount" | "inventoryLowStockCount" | "inventoryReorderNowCount" | "inventoryOutOfStockCount" | "inventoryCountNeededCount" | "inventoryMovementCount" | "inventoryReceiptCount" | "inventoryValue"> {
  const items = state.items;
  const statuses = items.reduce(
    (acc, item) => {
      const status = inventoryStatusForItem(item);
      if (status === "Low stock") acc.lowStock += 1;
      if (status === "Reorder now") acc.reorderNow += 1;
      if (status === "Out of stock") acc.outOfStock += 1;
      if (status === "Count needed") acc.countNeeded += 1;
      acc.value += item.currentQuantity * item.latestPurchasePrice;
      return acc;
    },
    { lowStock: 0, reorderNow: 0, outOfStock: 0, countNeeded: 0, value: 0 },
  );

  return {
    inventoryItemCount: items.length,
    inventoryLowStockCount: statuses.lowStock,
    inventoryReorderNowCount: statuses.reorderNow,
    inventoryOutOfStockCount: statuses.outOfStock,
    inventoryCountNeededCount: statuses.countNeeded,
    inventoryMovementCount: state.movements.length,
    inventoryReceiptCount: state.receipts.length,
    inventoryValue: Number(statuses.value.toFixed(2)),
  };
}

export function sortInventoryMovementsNewestFirst(movements: InventoryMovement[]) {
  return [...movements].sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
}

export function sortInventoryReceiptsNewestFirst(receipts: InventoryInvoiceReceipt[]) {
  return [...receipts].sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
}

export function upsertInventoryItem(items: InventoryItem[], draft: PilotInventoryDraft) {
  const now = nowIso();
  const existing = draft.id ? items.find((item) => item.id === draft.id) : undefined;
  const id = existing?.id || draft.id || `inventory-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const createdAt = existing?.createdAt || now;
  const next: InventoryItem = ensureInventoryItemShape({
    id,
    name: draft.name,
    normalizedName: normalizeName(draft.name),
    category: draft.category,
    currentQuantity: draft.currentQuantity,
    unit: draft.unit,
    minQuantity: draft.minQuantity,
    parLevel: draft.parLevel,
    preferredSupplier: draft.preferredSupplier,
    latestPurchasePrice: draft.latestPurchasePrice,
    latestPurchaseUnit: existing?.latestPurchaseUnit || draft.unit,
    latestPurchaseConversionFactor: existing?.latestPurchaseConversionFactor,
    lastReceivedAt: existing?.lastReceivedAt || createdAt.slice(0, 10),
    lastCountedAt: existing?.lastCountedAt || createdAt.slice(0, 10),
    averageDailyUsage: draft.averageDailyUsage,
    supplierMatchKey: normalizeName(draft.preferredSupplier),
    itemMatchKey: normalizeName(draft.name),
    active: draft.active,
    notes: draft.notes,
    createdAt,
    updatedAt: now,
  });

  const index = items.findIndex((item) => item.id === next.id);
  const nextItems = index === -1 ? [next, ...items] : [...items.slice(0, index), next, ...items.slice(index + 1)];
  return { item: next, items: nextItems };
}

export function archiveInventoryItem(items: InventoryItem[], id: string) {
  return items.map((item) => (item.id === id ? { ...item, active: false, updatedAt: nowIso() } : item));
}

export function deleteInventoryItem(items: InventoryItem[], id: string) {
  return items.filter((item) => item.id !== id);
}

export function createInventoryDraft(item?: InventoryItem): PilotInventoryDraft {
  if (!item) {
    return {
      id: undefined,
      name: "",
      category: "Other",
      currentQuantity: 0,
      unit: "each",
      minQuantity: 0,
      parLevel: 0,
      preferredSupplier: "",
      latestPurchasePrice: 0,
      averageDailyUsage: undefined,
      notes: "",
      active: true,
    };
  }

  return {
    id: item.id,
    name: item.name,
    category: item.category,
    currentQuantity: item.currentQuantity,
    unit: item.unit,
    minQuantity: item.minQuantity,
    parLevel: item.parLevel,
    preferredSupplier: item.preferredSupplier,
    latestPurchasePrice: item.latestPurchasePrice,
    averageDailyUsage: item.averageDailyUsage,
    notes: item.notes,
    active: item.active,
  };
}

export function buildInventoryMappingKey(supplier: string, lineKey: string) {
  return `${normalizeSupplierKey(supplier)}::${normalizeName(lineKey)}`;
}

export function findRememberedInventoryMapping(mappings: InventoryLineMapping[], supplier: string, lineKey: string) {
  const key = buildInventoryMappingKey(supplier, lineKey);
  return [...mappings]
    .filter((mapping) => buildInventoryMappingKey(mapping.supplierKey, mapping.lineKey) === key)
    .sort((a, b) => toMillis(b.confirmedAt) - toMillis(a.confirmedAt))[0] ?? null;
}

export function rememberInventoryMapping(
  mappings: InventoryLineMapping[],
  mapping: Omit<InventoryLineMapping, "id" | "confirmedAt"> & { confirmedAt?: string },
) {
  const normalized: InventoryLineMapping = {
    id: `inventory-mapping-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    supplierKey: normalizeSupplierKey(mapping.supplierKey),
    lineKey: normalizeName(mapping.lineKey),
    inventoryItemId: mapping.inventoryItemId,
    inventoryItemName: mapping.inventoryItemName,
    confirmedInvoiceUnit: mapping.confirmedInvoiceUnit || "each",
    inventoryUnit: mapping.inventoryUnit || "each",
    conversionFactor: Number.isFinite(mapping.conversionFactor) ? Number(mapping.conversionFactor) : 1,
    confirmedAt: mapping.confirmedAt || nowIso(),
  };

  return [
    normalized,
    ...mappings.filter((entry) => buildInventoryMappingKey(entry.supplierKey, entry.lineKey) !== buildInventoryMappingKey(normalized.supplierKey, normalized.lineKey)),
  ];
}

export function findExactInventoryItemSuggestion(items: InventoryItem[], value: string) {
  const key = normalizeName(value);
  if (!key) {
    return null;
  }

  return sortInventoryItems(items).find((item) => item.itemMatchKey === key || item.normalizedName === key) ?? null;
}

export function summarizeInventoryReceiptLines(lines: PilotInventoryDraftLine[]) {
  const itemCount = lines.filter((line) => line.inventoryItemId).length;
  const receiptQuantity = lines.reduce((sum, line) => sum + Number(line.quantity || 0) * Number(line.conversionFactor || 0), 0);
  return {
    itemCount,
    receiptQuantity: Number(receiptQuantity.toFixed(2)),
  };
}

export function deriveInventoryReceiptKey(invoice: Pick<PilotInvoiceRecord, "id" | "invoiceNumber" | "invoiceDate" | "supplier">, line: Pick<PilotInvoiceLineItem, "id" | "comparisonKey" | "itemName" | "originalDescription" | "rawSourceLine">, itemId: string, conversionFactor: number) {
  const normalized = normalizeName(line.comparisonKey || line.itemName || line.originalDescription || line.rawSourceLine || "");
  return [invoice.id, invoice.invoiceNumber || "", invoice.invoiceDate || "", invoice.supplier || "", line.id || "", itemId, normalized, conversionFactor.toFixed(4)].join("|");
}

export function findInventoryItemSuggestions(items: InventoryItem[], value: string) {
  const key = normalizeName(value);
  if (!key) {
    return [];
  }

  return sortInventoryItems(items).filter((item) => item.itemMatchKey === key || item.normalizedName === key || item.itemMatchKey.includes(key) || key.includes(item.itemMatchKey)).slice(0, 6);
}

export function describeInventoryStatus(item: InventoryItem) {
  const status = inventoryStatusForItem(item);
  const daysOfStock = item.averageDailyUsage && item.averageDailyUsage > 0 ? item.currentQuantity / item.averageDailyUsage : undefined;
  const daysRemaining = typeof daysOfStock === "number" && Number.isFinite(daysOfStock) ? Number(daysOfStock.toFixed(1)) : undefined;
  return {
    status,
    daysRemaining,
    inventoryValue: formatCurrency(item.currentQuantity * item.latestPurchasePrice),
  };
}
