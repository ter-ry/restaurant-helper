export type Severity = "Low" | "Medium" | "High";
export type ItemStatus = "Matched" | "New Item" | "Price Increased" | "Needs Review";
export type InvoiceStatus = "Processed" | "Needs Review" | "Price Changes Found";
export type PriceStatus = "Increased" | "Stable" | "Decreased";

export interface DemoCustomization {
  restaurantName: string;
  city: string;
  restaurantType: string;
  primarySupplier: string;
  ownerPainPoint: string;
}

export interface Supplier {
  id: string;
  name: string;
  categoryFocus: string;
  totalSpendMonth: number;
  invoicesMonth: number;
  itemsTracked: number;
  averagePriceChange: number;
  notes: string;
}

export interface CategorySpend {
  category: string;
  spend: number;
  share: number;
}

export interface DailyReconciliationRecord {
  date: string;
  salesWindow: string;
  posSales: number;
  cashExpected: number;
  cashCounted: number;
  cardSales: number;
  deliveryPayout: number;
  refunds: number;
  voids: number;
  tips: number;
  variance: number;
  note: string;
}

export interface SupplierSpend {
  supplierId: string;
  supplier: string;
  spend: number;
  invoices: number;
  change: number;
}

export interface TrackedItem {
  id: string;
  name: string;
  category: string;
  preferredSupplier: string;
  lastPrice: number;
  previousPrice: number;
  changePercent: number;
  lastPurchasedDate: string;
  status: PriceStatus;
  severity: Severity;
}

export interface PriceChange {
  id: string;
  item: string;
  supplier: string;
  category: string;
  previousPrice: number;
  currentPrice: number;
  changePercent: number;
  dateDetected: string;
  severity: Severity;
  status: PriceStatus;
  suggestedAction: string;
}

export interface InvoiceLineItem {
  id: string;
  itemName: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  lineTotal: number;
  category: string;
  status: ItemStatus;
}

export interface InvoiceFieldConfidence {
  supplier: number;
  invoiceDate: number;
  invoiceNumber: number;
  subtotal: number;
  tax: number;
  total: number;
  lineItems: number;
}

export interface ExtractedInvoice {
  id?: string;
  supplier: string;
  invoiceDate: string;
  invoiceNumber: string;
  totalAmount: number;
  status?: InvoiceStatus;
  items: InvoiceLineItem[];
}

export type PilotInvoiceStatus = "Ready" | "Needs Review";
export type InvoiceInventoryStatus = "Not received" | "Partially received" | "Received" | "No tracked items" | "Skipped";
export type PilotReconciliationStatus = "Balanced" | "Small difference" | "Needs Review" | "Incomplete";
export type InventoryItemStatus = "In stock" | "Low stock" | "Reorder now" | "Out of stock" | "Count needed";
export type InventoryMovementType =
  | "invoice receipt"
  | "manual addition"
  | "adjustment"
  | "usage"
  | "waste"
  | "spoilage / expired"
  | "damaged"
  | "staff meal / comped"
  | "breakage"
  | "count adjustment"
  | "physical count adjustment"
  | "correction"
  | "other";

export interface PilotInvoiceLineItem extends InvoiceLineItem {
  originalDescription: string;
  rawSourceLine: string;
  comparisonKey: string;
  confidence: number;
  needsReview: boolean;
  previousUnitPrice?: number;
  priceChangePercent?: number;
}

export interface PilotInvoiceDraft {
  id?: string;
  supplier: string;
  invoiceDate: string;
  invoiceNumber: string;
  subtotal: number;
  tax: number;
  totalAmount: number;
  status: PilotInvoiceStatus;
  notes: string;
  fileName: string;
  fileType: string;
  sourceDocumentUrl?: string;
  sourceDocumentName?: string;
  sourceDocumentType?: string;
  extractedText: string;
  extractionWarnings: string[];
  fieldConfidence: InvoiceFieldConfidence;
  extractionProvider: string;
  confirmed: boolean;
  lineItems: PilotInvoiceLineItem[];
  savedAt?: string;
  inventoryReceiptStatus?: InvoiceInventoryStatus;
  inventoryReceiptUpdatedAt?: string;
}

export interface PilotInvoiceRecord extends PilotInvoiceDraft {
  id: string;
  createdAt: string;
  updatedAt: string;
}

export interface PilotReconciliationDraft {
  id?: string;
  date: string;
  uberEats: number;
  doorDash: number;
  skip: number;
  cash: number;
  card: number;
  other: number;
  expectedPosSales: number;
  expectedPosEntered: boolean;
  otherSourceName: string;
  refunds: number;
  discounts: number;
  tips: number;
  fees: number;
  manualAdjustment: number;
  variance: number;
  status: PilotReconciliationStatus;
  notes: string;
  confirmed?: boolean;
  savedAt?: string;
  origin?: "seed" | "user";
}

export interface PilotReconciliationRecord extends PilotReconciliationDraft {
  id: string;
  createdAt: string;
  updatedAt: string;
}

export interface PilotPriceChangeRecord {
  id: string;
  invoiceId: string;
  invoiceDate: string;
  previousInvoiceDate: string;
  supplier: string;
  itemName: string;
  originalDescription: string;
  rawSourceLine: string;
  comparisonKey: string;
  category: string;
  previousPrice: number;
  currentPrice: number;
  changePercent: number;
  status: PriceStatus;
  severity: Severity;
}

export interface InventoryItem {
  id: string;
  name: string;
  normalizedName: string;
  category: string;
  currentQuantity: number;
  unit: string;
  minQuantity: number;
  parLevel: number;
  preferredSupplier: string;
  latestPurchasePrice: number;
  averageUnitCost?: number;
  latestPurchaseUnit: string;
  latestPurchaseConversionFactor?: number;
  lastReceivedAt: string;
  lastCountedAt: string;
  averageDailyUsage?: number;
  supplierMatchKey: string;
  itemMatchKey: string;
  active: boolean;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface InventoryMovement {
  id: string;
  inventoryItemId: string;
  inventoryItemName: string;
  movementType: InventoryMovementType;
  quantityDelta: number;
  quantityBefore: number;
  quantityAfter: number;
  unit: string;
  sourceInvoiceId?: string;
  sourceInvoiceNumber?: string;
  sourceInvoiceDate?: string;
  sourceInvoiceLineItemId?: string;
  sourceInvoiceLineDescription?: string;
  sourceCountSessionId?: string;
  sourceCountSessionName?: string;
  receiptKey?: string;
  note: string;
  createdAt: string;
  updatedAt: string;
}

export interface InventoryInvoiceReceipt {
  id: string;
  invoiceId: string;
  invoiceNumber: string;
  invoiceDate: string;
  supplier: string;
  invoiceLineItemId: string;
  invoiceLineDescription: string;
  normalizedDescription: string;
  inventoryItemId: string;
  inventoryItemName: string;
  quantity: number;
  unit: string;
  conversionFactor: number;
  unitPrice: number;
  lineTotal: number;
  receiptKey: string;
  note: string;
  createdAt: string;
  updatedAt: string;
}

export interface InventoryLineMapping {
  id: string;
  supplierKey: string;
  lineKey: string;
  inventoryItemId: string;
  inventoryItemName: string;
  confirmedInvoiceUnit: string;
  inventoryUnit: string;
  conversionFactor: number;
  confirmedAt: string;
}

export type InventoryCountSessionStatus = "Draft" | "Ready to review" | "Completed" | "Cancelled";
export type InventoryCountSessionFilterKind = "all-active" | "category" | "supplier" | "needs-count";
export type InventoryCountLineStatus = "pending" | "confirmed" | "skipped";

export interface InventoryCountSessionLine {
  id: string;
  inventoryItemId: string;
  itemNameSnapshot: string;
  stockUnitSnapshot: string;
  recordedQuantity: number;
  countedQuantity: number | null;
  difference: number | null;
  resultingQuantity: number | null;
  note: string;
  confirmationStatus: InventoryCountLineStatus;
}

export interface InventoryCountSession {
  id: string;
  status: InventoryCountSessionStatus;
  startedAt: string;
  completedAt?: string;
  selectedCategory?: string;
  selectedSupplier?: string;
  filterKind: InventoryCountSessionFilterKind;
  itemCount: number;
  countedBy?: string;
  notes: string;
  lines: InventoryCountSessionLine[];
  createdAt: string;
  updatedAt: string;
}

export type InventoryReorderLineStatus = "Needs ordering" | "Ordered" | "Partially received" | "Received";

export interface InventoryReorderIntent {
  id: string;
  itemId: string;
  itemName: string;
  category: string;
  supplier: string;
  currentQuantity: number;
  unit: string;
  minimumQuantity: number;
  parLevel: number;
  suggestedQuantity: number;
  adjustedQuantity: number;
  latestPurchasePrice: number;
  estimatedCost: number | null;
  costStatus: "available" | "unavailable";
  daysRemaining?: number | null;
  notes: string;
  status: InventoryReorderLineStatus;
  markedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PilotInventoryDraftLine {
  invoiceLineItemId: string;
  inventoryItemId: string;
  quantity: number;
  conversionFactor: number;
  note: string;
}

export interface PilotInventoryDraft {
  id?: string;
  name: string;
  category: string;
  currentQuantity: number;
  unit: string;
  minQuantity: number;
  parLevel: number;
  preferredSupplier: string;
  latestPurchasePrice: number;
  averageUnitCost?: number;
  averageDailyUsage?: number;
  notes: string;
  active: boolean;
}

export interface PilotInventoryState {
  items: InventoryItem[];
  movements: InventoryMovement[];
  receipts: InventoryInvoiceReceipt[];
  lineMappings: InventoryLineMapping[];
  countSessions: InventoryCountSession[];
  reorderIntents: InventoryReorderIntent[];
}

export interface PilotWorkspaceSummary {
  invoiceCount: number;
  invoiceSpend: number;
  invoiceReviewQueueCount: number;
  weeklyInvoiceSpend: number;
  weeklyInvoiceCount: number;
  monthlyInvoiceSpend: number;
  monthlyInvoiceCount: number;
  reconciliationCount: number;
  unresolvedReconciliationCount: number;
  weeklyUnresolvedVariance: number;
  monthlyUnresolvedVariance: number;
  recentPriceChangeCount: number;
  todayReconciliationStatus: PilotReconciliationStatus;
  todayReconciliationVariance: number;
  todayReconciliationDate: string;
  inventoryItemCount: number;
  inventoryLowStockCount: number;
  inventoryReorderNowCount: number;
  inventoryOutOfStockCount: number;
  inventoryCountNeededCount: number;
  inventoryMovementCount: number;
  inventoryReceiptCount: number;
  inventoryValue: number;
  inventoryCountSessionDraftCount: number;
  inventoryItemsToReorderCount: number;
  inventoryEstimatedReorderCost: number;
  inventoryRecentLargeAdjustmentCount: number;
}

export interface ReportCard {
  title: string;
  description: string;
  cadence: string;
}

export interface InvoiceSummary {
  id: string;
  supplier: string;
  invoiceDate: string;
  invoiceNumber: string;
  totalAmount: number;
  category: string;
  status: InvoiceStatus;
  flaggedItems: number;
  lineItems: InvoiceLineItem[];
}

export interface MonthlyInsight {
  label: string;
  value: string;
  helper: string;
}

export interface DemoPageCopy {
  title: string;
  eyebrow: string;
  description: string;
}

export interface DemoProfileCopy {
  dashboard: DemoPageCopy;
  dailyReconciliation: DemoPageCopy;
  invoices: DemoPageCopy;
  priceTracker: DemoPageCopy;
  reports: DemoPageCopy;
  settings: DemoPageCopy;
}

export interface DemoProfileData {
  slug: string;
  label: string;
  customization: DemoCustomization;
  period: string;
  currency: string;
  monthlySummary: {
    period: string;
    invoicesReviewed: number;
    totalSpend: number;
    estimatedCostIncrease: number;
    priceChangesDetected: number;
    increasedItems: number;
    decreasedItems: number;
    stableWatchItems: number;
    suppliersTracked: number;
  };
  categories: CategorySpend[];
  suppliers: Supplier[];
  supplierSpend: SupplierSpend[];
  trackedItems: TrackedItem[];
  priceChanges: PriceChange[];
  invoices: InvoiceSummary[];
  extractedInvoice: ExtractedInvoice;
  dashboardAlerts: string[];
  recommendedActions: string[];
  monthlyInsights: MonthlyInsight[];
  reportCards: ReportCard[];
  dailyReconciliation: DailyReconciliationRecord[];
  copy: DemoProfileCopy;
}
