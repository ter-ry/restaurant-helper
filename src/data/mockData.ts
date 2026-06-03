import type {
  CategorySpend,
  ExtractedInvoice,
  PriceChange,
  ReportCard,
  Supplier,
  SupplierSpend,
  TrackedItem,
} from "../types";

export const restaurantProfile = {
  name: "Sample Cafe",
  businessType: "Independent cafe",
  mainContact: "Maya Chen",
  email: "maya@samplecafe.example",
  phone: "(416) 555-0148",
  reportFrequency: "Biweekly",
  alertThreshold: 5,
  currency: "USD",
};

export const categories = [
  "Meat & Seafood",
  "Produce",
  "Dairy",
  "Packaging",
  "Dry Goods",
  "Beverages",
  "Other",
];

export const suppliers: Supplier[] = [
  {
    id: "local-butcher",
    name: "Local Butcher Co.",
    categoryFocus: "Meat & Seafood",
    totalSpendMonth: 1860,
    invoicesMonth: 6,
    itemsTracked: 14,
    averagePriceChange: 7.4,
    notes: "Chicken is up again. Check menu pricing before the next order.",
  },
  {
    id: "abc-produce",
    name: "ABC Produce",
    categoryFocus: "Produce",
    totalSpendMonth: 1325,
    invoicesMonth: 5,
    itemsTracked: 19,
    averagePriceChange: 4.8,
    notes: "One weekly invoice is missing and produce prices are drifting up.",
  },
  {
    id: "dairy-direct",
    name: "Dairy Direct",
    categoryFocus: "Dairy",
    totalSpendMonth: 1120,
    invoicesMonth: 4,
    itemsTracked: 11,
    averagePriceChange: 2.4,
    notes: "Mostly stable. Butter moved up enough to watch bakery items.",
  },
  {
    id: "packaging-depot",
    name: "Packaging Depot",
    categoryFocus: "Packaging",
    totalSpendMonth: 980,
    invoicesMonth: 3,
    itemsTracked: 9,
    averagePriceChange: 8.9,
    notes: "Cups and takeout containers are raising per-order costs.",
  },
  {
    id: "golden-dry-goods",
    name: "Golden Dry Goods",
    categoryFocus: "Dry Goods",
    totalSpendMonth: 1435,
    invoicesMonth: 7,
    itemsTracked: 22,
    averagePriceChange: 7.9,
    notes: "Cooking oil is the largest current margin squeeze.",
  },
  {
    id: "city-seafood",
    name: "City Seafood",
    categoryFocus: "Meat & Seafood",
    totalSpendMonth: 1040,
    invoicesMonth: 3,
    itemsTracked: 8,
    averagePriceChange: 3.2,
    notes: "Salmon is slightly down. Keep current seafood pricing for now.",
  },
  {
    id: "bean-roast",
    name: "Bean & Roast Supply",
    categoryFocus: "Beverages",
    totalSpendMonth: 660,
    invoicesMonth: 4,
    itemsTracked: 6,
    averagePriceChange: 1.8,
    notes: "Coffee pricing is stable. No action needed this week.",
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
  { category: "Meat & Seafood", spend: 2900, share: 34.4 },
  { category: "Dry Goods", spend: 1435, share: 17.0 },
  { category: "Produce", spend: 1325, share: 15.7 },
  { category: "Dairy", spend: 1120, share: 13.3 },
  { category: "Packaging", spend: 980, share: 11.6 },
  { category: "Beverages", spend: 660, share: 7.8 },
];

export const trackedItems: TrackedItem[] = [
  {
    id: "chicken-breast",
    name: "Chicken Breast 10kg",
    category: "Meat & Seafood",
    preferredSupplier: "Local Butcher Co.",
    lastPrice: 74.5,
    previousPrice: 68,
    changePercent: 9.6,
    lastPurchasedDate: "2026-05-14",
  },
  {
    id: "cooking-oil",
    name: "Cooking Oil 16L",
    category: "Dry Goods",
    preferredSupplier: "Golden Dry Goods",
    lastPrice: 38,
    previousPrice: 31.2,
    changePercent: 21.8,
    lastPurchasedDate: "2026-05-13",
  },
  {
    id: "cups",
    name: "12oz Cups Case",
    category: "Packaging",
    preferredSupplier: "Packaging Depot",
    lastPrice: 91.5,
    previousPrice: 82,
    changePercent: 11.6,
    lastPurchasedDate: "2026-05-12",
  },
  {
    id: "tomatoes",
    name: "Tomatoes Case",
    category: "Produce",
    preferredSupplier: "ABC Produce",
    lastPrice: 44.75,
    previousPrice: 43.2,
    changePercent: 4.4,
    lastPurchasedDate: "2026-05-10",
  },
  {
    id: "milk",
    name: "Whole Milk 4L",
    category: "Dairy",
    preferredSupplier: "Dairy Direct",
    lastPrice: 6.2,
    previousPrice: 6.05,
    changePercent: 1.2,
    lastPurchasedDate: "2026-05-15",
  },
  {
    id: "salmon",
    name: "Salmon Fillet 5kg",
    category: "Meat & Seafood",
    preferredSupplier: "City Seafood",
    lastPrice: 118,
    previousPrice: 120,
    changePercent: -1.7,
    lastPurchasedDate: "2026-05-09",
  },
  {
    id: "coffee",
    name: "Coffee Beans 5lb",
    category: "Beverages",
    preferredSupplier: "Bean & Roast Supply",
    lastPrice: 58,
    previousPrice: 57,
    changePercent: 0.8,
    lastPurchasedDate: "2026-05-11",
  },
  {
    id: "flour",
    name: "Flour 20kg",
    category: "Dry Goods",
    preferredSupplier: "Golden Dry Goods",
    lastPrice: 28.4,
    previousPrice: 29.1,
    changePercent: -2.4,
    lastPurchasedDate: "2026-05-14",
  },
  {
    id: "butter",
    name: "Butter 1kg",
    category: "Dairy",
    preferredSupplier: "Dairy Direct",
    lastPrice: 11.9,
    previousPrice: 11.2,
    changePercent: 6.3,
    lastPurchasedDate: "2026-05-15",
  },
  {
    id: "containers",
    name: "Takeout Containers Case",
    category: "Packaging",
    preferredSupplier: "Packaging Depot",
    lastPrice: 76.8,
    previousPrice: 72.5,
    changePercent: 5.9,
    lastPurchasedDate: "2026-05-08",
  },
];

export const priceChanges: PriceChange[] = trackedItems.map((item) => ({
  id: item.id,
  item: item.name,
  supplier: item.preferredSupplier,
  previousPrice: item.previousPrice,
  currentPrice: item.lastPrice,
  changePercent: item.changePercent,
  dateDetected: item.lastPurchasedDate,
  severity:
    Math.abs(item.changePercent) > 10
      ? "High"
      : Math.abs(item.changePercent) >= 5
        ? "Medium"
        : "Low",
  suggestedAction:
    item.changePercent > 10
      ? "Get a quote or reduce ordering before the next buy."
      : item.changePercent >= 5
        ? "Check menu margin and compare the next invoice."
        : item.changePercent < 0
          ? "Note savings and keep current supplier."
          : "Watch next invoice for confirmation.",
}));

export const extractedInvoice: ExtractedInvoice = {
  supplier: "Golden Dry Goods",
  invoiceDate: "2026-05-15",
  invoiceNumber: "GDG-10482",
  totalAmount: 642.4,
  items: [
    {
      id: "line-1",
      itemName: "Cooking Oil 16L",
      quantity: 4,
      unit: "jug",
      unitPrice: 38,
      lineTotal: 152,
      category: "Dry Goods",
      status: "Price Increased",
    },
    {
      id: "line-2",
      itemName: "Flour 20kg",
      quantity: 8,
      unit: "bag",
      unitPrice: 28.4,
      lineTotal: 227.2,
      category: "Dry Goods",
      status: "Matched",
    },
    {
      id: "line-3",
      itemName: "Brown Sugar 10kg",
      quantity: 3,
      unit: "bag",
      unitPrice: 24.5,
      lineTotal: 73.5,
      category: "Dry Goods",
      status: "New Item",
    },
    {
      id: "line-4",
      itemName: "Cleaning Towels Case",
      quantity: 2,
      unit: "case",
      unitPrice: 42.35,
      lineTotal: 84.7,
      category: "Other",
      status: "Needs Review",
    },
  ],
};

export const dashboardAlerts = [
  "Cooking Oil 16L jumped from $31.20 to $38.00 (+21.8%). This is the biggest margin risk.",
  "12oz Cups Case rose from $82.00 to $91.50 (+11.6%). Packaging is now 11.6% of spend.",
  "Chicken Breast 10kg increased from $68.00 to $74.50 (+9.6%). Check chicken menu margins.",
  "ABC Produce is missing this week's invoice. Produce spend may be understated.",
];

export const recommendedActions = [
  "Ask Golden Dry Goods for oil pricing or quote an alternate supplier before the next order.",
  "Check chicken sandwich, salad, and entree margins using the new chicken cost.",
  "Compare Packaging Depot against one alternate cup/container supplier this week.",
  "Follow up with ABC Produce so the missing invoice does not hide true produce spend.",
];

export const reportCards: ReportCard[] = [
  {
    title: "Biweekly Cost-Control Report",
    description: "Owner-ready summary of what got more expensive, where spend went, and what needs attention.",
    cadence: "Every 2 weeks",
  },
  {
    title: "Monthly Supplier Spending Report",
    description: "Which suppliers took the most dollars and which ones changed pricing.",
    cadence: "Monthly",
  },
  {
    title: "Price Change Summary",
    description: "Line-item changes with severity and a plain-language next step.",
    cadence: "On demand",
  },
  {
    title: "Category Spending Report",
    description: "A simple view of food, packaging, beverage, and other spend buckets.",
    cadence: "Monthly",
  },
];
