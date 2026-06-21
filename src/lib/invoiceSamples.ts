import type { PilotInvoiceDraft, PilotInvoiceLineItem } from "../types";

type DemoInvoiceLine = {
  itemName: string;
  originalDescription: string;
  rawSourceLine: string;
  comparisonKey: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  lineTotal: number;
  category: string;
};

function createDemoLineItem(index: number, line: DemoInvoiceLine): PilotInvoiceLineItem {
  return {
    id: `demo-line-${index + 1}`,
    itemName: line.itemName,
    originalDescription: line.originalDescription,
    rawSourceLine: line.rawSourceLine,
    comparisonKey: line.comparisonKey,
    quantity: line.quantity,
    unit: line.unit,
    unitPrice: Number(line.unitPrice.toFixed(2)),
    lineTotal: Number(line.lineTotal.toFixed(2)),
    category: line.category,
    status: "Matched",
    confidence: 0.94,
    needsReview: false,
  };
}

function buildDemoPreviewSvg(lines: DemoInvoiceLine[], subtotal: number, tax: number, total: number) {
  const rowHeight = 28;
  const width = 920;
  const height = 210 + lines.length * rowHeight;
  const lineRows = lines
    .map(
      (line, index) => `
        <text x="48" y="${170 + index * rowHeight}" font-size="16" fill="#15324a">${index + 1}. ${line.itemName}</text>
        <text x="486" y="${170 + index * rowHeight}" font-size="16" fill="#15324a" text-anchor="end">${line.quantity} ${line.unit}</text>
        <text x="600" y="${170 + index * rowHeight}" font-size="16" fill="#15324a" text-anchor="end">$${line.unitPrice.toFixed(2)}</text>
        <text x="870" y="${170 + index * rowHeight}" font-size="16" fill="#15324a" text-anchor="end">$${line.lineTotal.toFixed(2)}</text>`,
    )
    .join("");

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Demo invoice preview">
      <rect width="100%" height="100%" fill="#f8fafc" />
      <rect x="28" y="28" width="${width - 56}" height="${height - 56}" rx="24" fill="#ffffff" stroke="#d8e1ea" />
      <text x="48" y="74" font-size="28" font-weight="700" fill="#15324a">Bubble Bay Tea Supply</text>
      <text x="48" y="104" font-size="16" fill="#567086">Sample invoice for demo meetings</text>
      <text x="48" y="136" font-size="15" fill="#567086">Invoice: BBTS-2481   Date: 2026-06-18   Terms: Net 15</text>
      <rect x="48" y="154" width="${width - 96}" height="1.5" fill="#d8e1ea" />
      <text x="48" y="168" font-size="14" font-weight="700" fill="#567086">Item</text>
      <text x="486" y="168" font-size="14" font-weight="700" fill="#567086" text-anchor="end">Qty / Unit</text>
      <text x="600" y="168" font-size="14" font-weight="700" fill="#567086" text-anchor="end">Unit price</text>
      <text x="870" y="168" font-size="14" font-weight="700" fill="#567086" text-anchor="end">Line total</text>
      ${lineRows}
      <rect x="48" y="${height - 104}" width="${width - 96}" height="1.5" fill="#d8e1ea" />
      <text x="600" y="${height - 74}" font-size="16" font-weight="700" fill="#15324a" text-anchor="end">Subtotal</text>
      <text x="870" y="${height - 74}" font-size="16" font-weight="700" fill="#15324a" text-anchor="end">$${subtotal.toFixed(2)}</text>
      <text x="600" y="${height - 48}" font-size="16" font-weight="700" fill="#15324a" text-anchor="end">Tax</text>
      <text x="870" y="${height - 48}" font-size="16" font-weight="700" fill="#15324a" text-anchor="end">$${tax.toFixed(2)}</text>
      <text x="600" y="${height - 18}" font-size="18" font-weight="700" fill="#0f4c81" text-anchor="end">Total</text>
      <text x="870" y="${height - 18}" font-size="18" font-weight="700" fill="#0f4c81" text-anchor="end">$${total.toFixed(2)}</text>
    </svg>`;

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export function buildDemoRestaurantInvoiceDraft(): PilotInvoiceDraft {
  const lines: DemoInvoiceLine[] = [
    {
      itemName: "Tapioca Pearls 3kg",
      originalDescription: "Tapioca Pearls 3kg",
      rawSourceLine: "Tapioca Pearls 3kg 4 case $18.50 $74.00",
      comparisonKey: "tapioca pearls",
      quantity: 4,
      unit: "case",
      unitPrice: 18.5,
      lineTotal: 74,
      category: "Dry Goods",
    },
    {
      itemName: "Brown Sugar Syrup 1L",
      originalDescription: "Brown Sugar Syrup 1L",
      rawSourceLine: "Brown Sugar Syrup 1L 6 bottle $9.75 $58.50",
      comparisonKey: "brown sugar syrup",
      quantity: 6,
      unit: "bottle",
      unitPrice: 9.75,
      lineTotal: 58.5,
      category: "Dry Goods",
    },
    {
      itemName: "Black Tea Leaves 500g",
      originalDescription: "Black Tea Leaves 500g",
      rawSourceLine: "Black Tea Leaves 500g 5 bag $14.20 $71.00",
      comparisonKey: "black tea leaves",
      quantity: 5,
      unit: "bag",
      unitPrice: 14.2,
      lineTotal: 71,
      category: "Coffee",
    },
    {
      itemName: "Oat Milk Carton 4L",
      originalDescription: "Oat Milk Carton 4L",
      rawSourceLine: "Oat Milk Carton 4L 12 carton $6.25 $75.00",
      comparisonKey: "oat milk carton",
      quantity: 12,
      unit: "carton",
      unitPrice: 6.25,
      lineTotal: 75,
      category: "Dairy",
    },
    {
      itemName: "700ml Plastic Cups Case",
      originalDescription: "700ml Plastic Cups Case",
      rawSourceLine: "700ml Plastic Cups Case 8 case $27.90 $223.20",
      comparisonKey: "plastic cups",
      quantity: 8,
      unit: "case",
      unitPrice: 27.9,
      lineTotal: 223.2,
      category: "Packaging",
    },
    {
      itemName: "Cup Sealing Film Roll",
      originalDescription: "Cup Sealing Film Roll",
      rawSourceLine: "Cup Sealing Film Roll 3 roll $32.00 $96.00",
      comparisonKey: "cup sealing film",
      quantity: 3,
      unit: "roll",
      unitPrice: 32,
      lineTotal: 96,
      category: "Packaging",
    },
    {
      itemName: "Straws Pack",
      originalDescription: "Straws Pack",
      rawSourceLine: "Straws Pack 10 pack $8.50 $85.00",
      comparisonKey: "straws",
      quantity: 10,
      unit: "pack",
      unitPrice: 8.5,
      lineTotal: 85,
      category: "Packaging",
    },
    {
      itemName: "Hot Cup Lids Case",
      originalDescription: "Hot Cup Lids Case",
      rawSourceLine: "Hot Cup Lids Case 4 case $36.25 $145.00",
      comparisonKey: "hot cup lids",
      quantity: 4,
      unit: "case",
      unitPrice: 36.25,
      lineTotal: 145,
      category: "Packaging",
    },
  ];

  const subtotal = Number(lines.reduce((sum, line) => sum + line.lineTotal, 0).toFixed(2));
  const tax = Number((subtotal * 0.13).toFixed(2));
  const total = Number((subtotal + tax).toFixed(2));

  return {
    supplier: "Bubble Bay Tea Supply",
    invoiceDate: "2026-06-18",
    invoiceNumber: "BBTS-2481",
    subtotal,
    tax,
    totalAmount: total,
    status: "Ready",
    notes: "Demo sample invoice loaded instantly for meetings. Review the values before saving.",
    fileName: "demo-bubble-bay-invoice.svg",
    fileType: "image/svg+xml",
    sourceDocumentUrl: buildDemoPreviewSvg(lines, subtotal, tax, total),
    sourceDocumentName: "demo-bubble-bay-invoice.svg",
    sourceDocumentType: "image/svg+xml",
    extractedText: lines.map((line) => line.rawSourceLine).join("\n"),
    extractionWarnings: ["Demo sample invoice loaded instantly for a meeting-friendly review flow."],
    fieldConfidence: { supplier: 0.98, invoiceDate: 0.98, invoiceNumber: 0.98, subtotal: 0.95, tax: 0.95, total: 0.95, lineItems: 0.94 },
    extractionProvider: "demo sample",
    confirmed: false,
    lineItems: lines.map((line, index) => createDemoLineItem(index, line)),
  };
}
