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
export type PilotReconciliationStatus = "Balanced" | "Small difference" | "Needs Review" | "Incomplete";

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
  extractedText: string;
  extractionWarnings: string[];
  fieldConfidence: InvoiceFieldConfidence;
  extractionProvider: string;
  confirmed: boolean;
  lineItems: PilotInvoiceLineItem[];
  savedAt?: string;
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
