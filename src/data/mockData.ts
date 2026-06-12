import type {
  CategorySpend,
  ExtractedInvoice,
  InvoiceSummary,
  MonthlyInsight,
  PriceChange,
  PriceStatus,
  ReportCard,
  Severity,
  Supplier,
  SupplierSpend,
  TrackedItem,
} from "../types";

export const restaurantProfile = {
  name: "Harbourfront Cafe",
  businessType: "Independent Toronto cafe",
  mainContact: "Maya Chen",
  email: "maya@harbourfrontcafe.example",
  phone: "(416) 555-0148",
  reportFrequency: "Monthly",
  alertThreshold: 5,
  currency: "CAD",
  period: "May 2026",
};

export const monthlySummary = {
  period: "May 2026",
  invoicesReviewed: 29,
  totalSpend: 15264.6,
  estimatedCostIncrease: 612,
  priceChangesDetected: 12,
  increasedItems: 9,
  decreasedItems: 1,
  stableWatchItems: 2,
  suppliersTracked: 6,
};

export const categories = [
  "Meat",
  "Produce",
  "Dairy",
  "Dry Goods",
  "Packaging",
  "Beverages",
  "Cleaning Supplies",
];

export const suppliers: Supplier[] = [
  {
    id: "gfs",
    name: "GFS",
    categoryFocus: "Meat, Dairy, Dry Goods",
    totalSpendMonth: 4280.75,
    invoicesMonth: 6,
    itemsTracked: 28,
    averagePriceChange: 6.8,
    notes: "Chicken, dairy, and pantry items drove most of the increases this month.",
  },
  {
    id: "sysco",
    name: "Sysco",
    categoryFocus: "Dry Goods, Cleaning Supplies",
    totalSpendMonth: 3124.2,
    invoicesMonth: 5,
    itemsTracked: 23,
    averagePriceChange: 5.1,
    notes: "Stable overall, but sanitizer and napkins need review before the next order.",
  },
  {
    id: "costco-business-centre",
    name: "Costco Business Centre",
    categoryFocus: "Packaging, Beverages",
    totalSpendMonth: 2186.4,
    invoicesMonth: 4,
    itemsTracked: 19,
    averagePriceChange: 3.4,
    notes: "Useful for bulk beverage and packaging buys. Cups moved up faster than expected.",
  },
  {
    id: "local-produce",
    name: "Local Produce Co.",
    categoryFocus: "Produce",
    totalSpendMonth: 2472.95,
    invoicesMonth: 7,
    itemsTracked: 21,
    averagePriceChange: 8.2,
    notes: "Produce volatility is visible. Tomatoes and greens should be watched weekly.",
  },
  {
    id: "packaging-supplier",
    name: "Packaging Supplier",
    categoryFocus: "Packaging",
    totalSpendMonth: 1498.3,
    invoicesMonth: 3,
    itemsTracked: 12,
    averagePriceChange: 9.7,
    notes: "Takeout containers and paper bags are raising delivery order costs.",
  },
  {
    id: "coffee-roaster",
    name: "Coffee Roaster",
    categoryFocus: "Beverages",
    totalSpendMonth: 1702,
    invoicesMonth: 4,
    itemsTracked: 8,
    averagePriceChange: 2.2,
    notes: "Coffee is mostly stable. Milk and cup costs are the larger beverage margin issue.",
  },
];

export const supplierSpend: SupplierSpend[] = suppliers.map((supplier) => ({
  supplierId: supplier.id,
  supplier: supplier.name,
  spend: supplier.totalSpendMonth,
  invoices: supplier.invoicesMonth,
  change: supplier.averagePriceChange,
}));

export const categorySpend: CategorySpend[] = [
  { category: "Meat", spend: 2642.35, share: 17.3 },
  { category: "Produce", spend: 2472.95, share: 16.2 },
  { category: "Dairy", spend: 1854.7, share: 12.1 },
  { category: "Dry Goods", spend: 3128.9, share: 20.5 },
  { category: "Packaging", spend: 2684.7, share: 17.6 },
  { category: "Beverages", spend: 1786.4, share: 11.7 },
  { category: "Cleaning Supplies", spend: 694.6, share: 4.6 },
];

function priceStatus(changePercent: number): PriceStatus {
  if (changePercent >= 3) return "Increased";
  if (changePercent <= -3) return "Decreased";
  return "Stable";
}

function severity(changePercent: number): Severity {
  const absoluteChange = Math.abs(changePercent);
  if (absoluteChange >= 10) return "High";
  if (absoluteChange >= 5) return "Medium";
  return "Low";
}

export const trackedItems: TrackedItem[] = [
  {
    id: "chicken-thighs",
    name: "Chicken Thighs 10kg",
    category: "Meat",
    preferredSupplier: "GFS",
    lastPrice: 86.2,
    previousPrice: 76.5,
    changePercent: 12.7,
    lastPurchasedDate: "2026-05-28",
    status: priceStatus(12.7),
    severity: severity(12.7),
  },
  {
    id: "tomatoes-case",
    name: "Roma Tomatoes Case",
    category: "Produce",
    preferredSupplier: "Local Produce Co.",
    lastPrice: 47.8,
    previousPrice: 39.6,
    changePercent: 20.7,
    lastPurchasedDate: "2026-05-29",
    status: priceStatus(20.7),
    severity: severity(20.7),
  },
  {
    id: "butter-kg",
    name: "Butter 1kg",
    category: "Dairy",
    preferredSupplier: "GFS",
    lastPrice: 12.85,
    previousPrice: 11.2,
    changePercent: 14.7,
    lastPurchasedDate: "2026-05-27",
    status: priceStatus(14.7),
    severity: severity(14.7),
  },
  {
    id: "takeout-containers",
    name: "Takeout Containers Case",
    category: "Packaging",
    preferredSupplier: "Packaging Supplier",
    lastPrice: 82.4,
    previousPrice: 74.1,
    changePercent: 11.2,
    lastPurchasedDate: "2026-05-30",
    status: priceStatus(11.2),
    severity: severity(11.2),
  },
  {
    id: "paper-bags",
    name: "Paper Bags 500ct",
    category: "Packaging",
    preferredSupplier: "Packaging Supplier",
    lastPrice: 58.9,
    previousPrice: 54.25,
    changePercent: 8.6,
    lastPurchasedDate: "2026-05-24",
    status: priceStatus(8.6),
    severity: severity(8.6),
  },
  {
    id: "coffee-beans",
    name: "House Espresso Beans 5lb",
    category: "Beverages",
    preferredSupplier: "Coffee Roaster",
    lastPrice: 64,
    previousPrice: 62.5,
    changePercent: 2.4,
    lastPurchasedDate: "2026-05-31",
    status: priceStatus(2.4),
    severity: severity(2.4),
  },
  {
    id: "whole-milk",
    name: "Whole Milk 4L",
    category: "Dairy",
    preferredSupplier: "Costco Business Centre",
    lastPrice: 6.55,
    previousPrice: 6.28,
    changePercent: 4.3,
    lastPurchasedDate: "2026-05-30",
    status: priceStatus(4.3),
    severity: severity(4.3),
  },
  {
    id: "cooking-oil",
    name: "Canola Oil 16L",
    category: "Dry Goods",
    preferredSupplier: "Sysco",
    lastPrice: 41.2,
    previousPrice: 38.1,
    changePercent: 8.1,
    lastPurchasedDate: "2026-05-26",
    status: priceStatus(8.1),
    severity: severity(8.1),
  },
  {
    id: "sanitizer",
    name: "Food-Safe Sanitizer 4L",
    category: "Cleaning Supplies",
    preferredSupplier: "Sysco",
    lastPrice: 28.4,
    previousPrice: 25.7,
    changePercent: 10.5,
    lastPurchasedDate: "2026-05-25",
    status: priceStatus(10.5),
    severity: severity(10.5),
  },
  {
    id: "flour",
    name: "All-Purpose Flour 20kg",
    category: "Dry Goods",
    preferredSupplier: "GFS",
    lastPrice: 29.1,
    previousPrice: 30.4,
    changePercent: -4.3,
    lastPurchasedDate: "2026-05-28",
    status: priceStatus(-4.3),
    severity: severity(-4.3),
  },
  {
    id: "spinach",
    name: "Baby Spinach Case",
    category: "Produce",
    preferredSupplier: "Local Produce Co.",
    lastPrice: 34.2,
    previousPrice: 34.8,
    changePercent: -1.7,
    lastPurchasedDate: "2026-05-29",
    status: priceStatus(-1.7),
    severity: severity(-1.7),
  },
  {
    id: "cold-cups",
    name: "16oz Cold Cups Case",
    category: "Packaging",
    preferredSupplier: "Costco Business Centre",
    lastPrice: 91.6,
    previousPrice: 86.8,
    changePercent: 5.5,
    lastPurchasedDate: "2026-05-22",
    status: priceStatus(5.5),
    severity: severity(5.5),
  },
];

export const priceChanges: PriceChange[] = trackedItems.map((item) => ({
  id: item.id,
  item: item.name,
  supplier: item.preferredSupplier,
  category: item.category,
  previousPrice: item.previousPrice,
  currentPrice: item.lastPrice,
  changePercent: item.changePercent,
  dateDetected: item.lastPurchasedDate,
  severity: item.severity,
  status: item.status,
  suggestedAction:
    item.changePercent >= 10
      ? "Review menu margin or ask for alternate pricing before the next order."
      : item.changePercent >= 5
        ? "Watch the next invoice and compare against one alternate supplier."
        : item.changePercent <= -3
          ? "Note the savings and keep this supplier in the next report."
          : "No urgent action. Keep tracking this item.",
}));

export const invoices: InvoiceSummary[] = [
  {
    id: "inv-gfs-5821",
    supplier: "GFS",
    invoiceDate: "2026-05-28",
    invoiceNumber: "GFS-5821",
    totalAmount: 1242.65,
    category: "Mixed",
    status: "Price Changes Found",
    flaggedItems: 3,
    lineItems: [
      { id: "gfs-1", itemName: "Chicken Thighs 10kg", quantity: 6, unit: "case", unitPrice: 86.2, lineTotal: 517.2, category: "Meat", status: "Price Increased" },
      { id: "gfs-2", itemName: "Butter 1kg", quantity: 18, unit: "kg", unitPrice: 12.85, lineTotal: 231.3, category: "Dairy", status: "Price Increased" },
      { id: "gfs-3", itemName: "All-Purpose Flour 20kg", quantity: 8, unit: "bag", unitPrice: 29.1, lineTotal: 232.8, category: "Dry Goods", status: "Matched" },
      { id: "gfs-4", itemName: "Cream Cheese 2kg", quantity: 6, unit: "tub", unitPrice: 43.55, lineTotal: 261.35, category: "Dairy", status: "Needs Review" },
    ],
  },
  {
    id: "inv-local-produce-2044",
    supplier: "Local Produce Co.",
    invoiceDate: "2026-05-29",
    invoiceNumber: "LPC-2044",
    totalAmount: 693.4,
    category: "Produce",
    status: "Price Changes Found",
    flaggedItems: 2,
    lineItems: [
      { id: "lpc-1", itemName: "Roma Tomatoes Case", quantity: 5, unit: "case", unitPrice: 47.8, lineTotal: 239, category: "Produce", status: "Price Increased" },
      { id: "lpc-2", itemName: "Baby Spinach Case", quantity: 4, unit: "case", unitPrice: 34.2, lineTotal: 136.8, category: "Produce", status: "Matched" },
      { id: "lpc-3", itemName: "Avocado Case", quantity: 3, unit: "case", unitPrice: 72.6, lineTotal: 217.8, category: "Produce", status: "Needs Review" },
      { id: "lpc-4", itemName: "Lemons Case", quantity: 2, unit: "case", unitPrice: 49.9, lineTotal: 99.8, category: "Produce", status: "New Item" },
    ],
  },
  {
    id: "inv-packaging-1198",
    supplier: "Packaging Supplier",
    invoiceDate: "2026-05-30",
    invoiceNumber: "PKG-1198",
    totalAmount: 812.9,
    category: "Packaging",
    status: "Needs Review",
    flaggedItems: 2,
    lineItems: [
      { id: "pkg-1", itemName: "Takeout Containers Case", quantity: 5, unit: "case", unitPrice: 82.4, lineTotal: 412, category: "Packaging", status: "Price Increased" },
      { id: "pkg-2", itemName: "Paper Bags 500ct", quantity: 4, unit: "case", unitPrice: 58.9, lineTotal: 235.6, category: "Packaging", status: "Price Increased" },
      { id: "pkg-3", itemName: "Tamper Labels Roll", quantity: 3, unit: "roll", unitPrice: 55.1, lineTotal: 165.3, category: "Packaging", status: "Needs Review" },
    ],
  },
  {
    id: "inv-sysco-7744",
    supplier: "Sysco",
    invoiceDate: "2026-05-26",
    invoiceNumber: "SYS-7744",
    totalAmount: 956.3,
    category: "Dry Goods",
    status: "Processed",
    flaggedItems: 2,
    lineItems: [
      { id: "sys-1", itemName: "Canola Oil 16L", quantity: 8, unit: "jug", unitPrice: 41.2, lineTotal: 329.6, category: "Dry Goods", status: "Price Increased" },
      { id: "sys-2", itemName: "Food-Safe Sanitizer 4L", quantity: 4, unit: "jug", unitPrice: 28.4, lineTotal: 113.6, category: "Cleaning Supplies", status: "Price Increased" },
      { id: "sys-3", itemName: "Napkins Case", quantity: 6, unit: "case", unitPrice: 42.6, lineTotal: 255.6, category: "Packaging", status: "Matched" },
      { id: "sys-4", itemName: "Brown Sugar 10kg", quantity: 6, unit: "bag", unitPrice: 42.92, lineTotal: 257.5, category: "Dry Goods", status: "Matched" },
    ],
  },
  {
    id: "inv-coffee-4431",
    supplier: "Coffee Roaster",
    invoiceDate: "2026-05-31",
    invoiceNumber: "CR-4431",
    totalAmount: 512,
    category: "Beverages",
    status: "Processed",
    flaggedItems: 0,
    lineItems: [
      { id: "cr-1", itemName: "House Espresso Beans 5lb", quantity: 8, unit: "bag", unitPrice: 64, lineTotal: 512, category: "Beverages", status: "Matched" },
    ],
  },
  {
    id: "inv-costco-9912",
    supplier: "Costco Business Centre",
    invoiceDate: "2026-05-30",
    invoiceNumber: "CBC-9912",
    totalAmount: 739.8,
    category: "Mixed",
    status: "Price Changes Found",
    flaggedItems: 2,
    lineItems: [
      { id: "cbc-1", itemName: "Whole Milk 4L", quantity: 24, unit: "jug", unitPrice: 6.55, lineTotal: 157.2, category: "Dairy", status: "Matched" },
      { id: "cbc-2", itemName: "16oz Cold Cups Case", quantity: 4, unit: "case", unitPrice: 91.6, lineTotal: 366.4, category: "Packaging", status: "Price Increased" },
      { id: "cbc-3", itemName: "Sparkling Water 24ct", quantity: 10, unit: "case", unitPrice: 21.62, lineTotal: 216.2, category: "Beverages", status: "Matched" },
    ],
  },
];

export const extractedInvoice: ExtractedInvoice = {
  id: invoices[0].id,
  supplier: invoices[0].supplier,
  invoiceDate: invoices[0].invoiceDate,
  invoiceNumber: invoices[0].invoiceNumber,
  totalAmount: invoices[0].totalAmount,
  status: invoices[0].status,
  items: invoices[0].lineItems,
};

export const dashboardAlerts = [
  "Tomatoes rose 20.7% this month. Brunch and sandwich costs should be checked before the next menu print.",
  "Butter increased 14.7%. Bakery items and sauces may be underpriced if portions stayed the same.",
  "Takeout containers are up 11.2%. Delivery order margins are likely thinner than dine-in.",
  "Packaging Supplier has the highest average price movement at 9.7%. Compare one alternate quote this week.",
];

export const recommendedActions = [
  "Ask Local Produce Co. whether tomato pricing is temporary or seasonal before the next large order.",
  "Compare takeout containers against Costco Business Centre and one local packaging vendor.",
  "Review butter-heavy bakery items using the new GFS butter price.",
  "Send two recent supplier invoices into Flowtally to validate whether the report catches useful changes.",
];

export const monthlyInsights: MonthlyInsight[] = [
  {
    label: "Monthly invoice spend",
    value: "$15,264.60",
    helper: "29 supplier invoices reviewed for May 2026",
  },
  {
    label: "Estimated cost increase",
    value: "$612",
    helper: "Approximate monthly impact from flagged item increases",
  },
  {
    label: "Price changes detected",
    value: "12",
    helper: "9 increases, 1 decrease, 2 stable-watch items",
  },
  {
    label: "Suppliers tracked",
    value: "6",
    helper: "GFS, Sysco, Costco, produce, packaging, coffee",
  },
];

export const reportCards: ReportCard[] = [
  {
    title: "Monthly Cost-Control Report",
    description: "Owner-ready summary of spend, price changes, and the next actions to protect margin.",
    cadence: "Monthly",
  },
  {
    title: "Supplier Spend Snapshot",
    description: "Which suppliers took the most dollars and which ones moved pricing fastest.",
    cadence: "Monthly",
  },
  {
    title: "Price Change Watchlist",
    description: "Line-item changes with severity and plain-language owner action.",
    cadence: "Weekly",
  },
  {
    title: "Invoice Review Summary",
    description: "Processed invoices, review flags, and missing cost details.",
    cadence: "On demand",
  },
];
