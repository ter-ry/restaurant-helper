import type { InvoiceFieldConfidence, PilotInvoiceLineItem } from "../types";

export interface InvoiceOcrFieldResult<T> {
  value: T;
  confidence: number;
  needsReview: boolean;
  evidence: string;
}

export interface InvoiceOcrResult {
  provider: string;
  fileName: string;
  contentType: string;
  rawText: string;
  overallConfidence: number;
  needsReview: boolean;
  warnings: string[];
  ocrExitCode?: number;
  fields: {
    supplier: InvoiceOcrFieldResult<string>;
    invoiceDate: InvoiceOcrFieldResult<string>;
    invoiceNumber: InvoiceOcrFieldResult<string>;
    subtotal: InvoiceOcrFieldResult<number>;
    tax: InvoiceOcrFieldResult<number>;
    total: InvoiceOcrFieldResult<number>;
  };
  lineItems: Array<
    Pick<PilotInvoiceLineItem, "originalDescription" | "comparisonKey" | "itemName" | "quantity" | "unit" | "unitPrice" | "lineTotal" | "confidence" | "needsReview">
  >;
}

const apiBaseUrl = resolveApiBaseUrl();
const supportedExtensions = new Set(["jpg", "jpeg", "png", "webp", "pdf"]);

function normalizeBaseUrl(value: string | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed.replace(/\/+$/, "");
}

function resolveApiBaseUrl() {
  const configured = normalizeBaseUrl(import.meta.env.VITE_OCR_API_BASE_URL);
  if (configured) {
    return configured;
  }
  if (import.meta.env.DEV) {
    return "http://127.0.0.1:5000";
  }
  throw new Error("VITE_OCR_API_BASE_URL is required in production builds.");
}

export async function captureInvoiceDocument(file: File): Promise<InvoiceOcrResult> {
  const formData = new FormData();
  formData.append("file", file, file.name);

  const response = await fetch(`${apiBaseUrl}/api/invoices/ocr`, {
    method: "POST",
    body: formData,
  });

  const body = (await response.json().catch(() => ({}))) as Partial<{ error: string } & InvoiceOcrResult>;
  if (!response.ok) {
    throw new Error(body.error || `Invoice OCR request failed with status ${response.status}`);
  }

  return body as InvoiceOcrResult;
}

export function isSupportedInvoiceUpload(file: File | string) {
  const filename = typeof file === "string" ? file : file.name;
  const extension = filename.split(".").pop()?.toLowerCase() ?? "";
  return supportedExtensions.has(extension);
}

export function buildFieldConfidenceSummary(confidence: InvoiceFieldConfidence) {
  return Object.entries(confidence).map(([field, value]) => ({ field, value }));
}
