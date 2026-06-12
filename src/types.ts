export type Severity = "Low" | "Medium" | "High";
export type ItemStatus = "Matched" | "New Item" | "Price Increased" | "Needs Review";
export type InvoiceStatus = "Processed" | "Needs Review" | "Price Changes Found";
export type PriceStatus = "Increased" | "Stable" | "Decreased";

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

export interface ExtractedInvoice {
  id?: string;
  supplier: string;
  invoiceDate: string;
  invoiceNumber: string;
  totalAmount: number;
  status?: InvoiceStatus;
  items: InvoiceLineItem[];
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
