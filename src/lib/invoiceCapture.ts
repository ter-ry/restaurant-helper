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
    Pick<PilotInvoiceLineItem, "originalDescription" | "rawSourceLine" | "comparisonKey" | "itemName" | "quantity" | "unit" | "unitPrice" | "lineTotal" | "confidence" | "needsReview">
  >;
}

const apiBaseUrl = resolveApiBaseUrl();
const supportedExtensions = new Set(["jpg", "jpeg", "png", "webp", "pdf"]);
const maxImageUploadPixels = 2400;
const maxImageUploadBytes = 6 * 1024 * 1024;

function normalizeBaseUrl(value: string | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed.replace(/\/+$/, "");
}

function resolveApiBaseUrl() {
  const env = import.meta?.env;
  const configured = normalizeBaseUrl(env?.VITE_OCR_API_BASE_URL);
  if (configured) {
    return configured;
  }
  if (env?.DEV || typeof window === "undefined") {
    return "http://127.0.0.1:5000";
  }
  return "";
}

export async function captureInvoiceDocument(file: File): Promise<InvoiceOcrResult> {
  if (!apiBaseUrl) {
    throw new Error("OCR backend is not configured for this build. Set VITE_OCR_API_BASE_URL to enable invoice extraction.");
  }

  const uploadFile = await prepareUploadFile(file);
  const formData = new FormData();
  formData.append("file", uploadFile, uploadFile.name);

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

async function prepareUploadFile(file: File) {
  if (!file.type.startsWith("image/") || file.size <= maxImageUploadBytes) {
    return file;
  }

  if (typeof createImageBitmap !== "function" || typeof document === "undefined") {
    return file;
  }

  try {
    const bitmap = await createImageBitmap(file);
    const longestSide = Math.max(bitmap.width, bitmap.height);
    if (longestSide <= maxImageUploadPixels) {
      bitmap.close();
      return file;
    }

    const scale = maxImageUploadPixels / longestSide;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) {
      bitmap.close();
      return file;
    }

    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob((value) => resolve(value), "image/jpeg", 0.86));
    if (!blob) {
      return file;
    }

    const nextName = file.name.replace(/\.[^.]+$/, ".jpg");
    return new File([blob], nextName, { type: "image/jpeg", lastModified: file.lastModified });
  } catch {
    return file;
  }
}

export function isSupportedInvoiceUpload(file: File | string) {
  const filename = typeof file === "string" ? file : file.name;
  const extension = filename.split(".").pop()?.toLowerCase() ?? "";
  return supportedExtensions.has(extension);
}

export function buildFieldConfidenceSummary(confidence: InvoiceFieldConfidence) {
  return Object.entries(confidence).map(([field, value]) => ({ field, value }));
}
