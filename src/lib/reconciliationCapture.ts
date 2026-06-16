const apiBaseUrl = normalizeBaseUrl(import.meta.env.VITE_OCR_API_BASE_URL) ?? "http://127.0.0.1:5000";

export type ReconciliationSourceKey = "uber_eats" | "doordash" | "skip" | "pos" | "card" | "cash";

export interface ReconciliationFieldResult<T> {
  value: T;
  confidence: number;
  needsReview: boolean;
  evidence: string;
}

export interface ReconciliationExtractResult {
  provider: string;
  fileName: string;
  contentType: string;
  sourceKey: ReconciliationSourceKey;
  sourceLabel: string;
  rawText: string;
  overallConfidence: number;
  needsReview: boolean;
  warnings: string[];
  fields: {
    businessDate: ReconciliationFieldResult<string>;
    platform: ReconciliationFieldResult<string>;
    orderCount: ReconciliationFieldResult<number>;
    grossSales: ReconciliationFieldResult<number>;
    discounts: ReconciliationFieldResult<number>;
    refunds: ReconciliationFieldResult<number>;
    tax: ReconciliationFieldResult<number>;
    tips: ReconciliationFieldResult<number>;
    fees: ReconciliationFieldResult<number>;
    netSalesOrPayout: ReconciliationFieldResult<number>;
    cardBatchTotal: ReconciliationFieldResult<number>;
    posExpectedSales: ReconciliationFieldResult<number>;
    cashCount: ReconciliationFieldResult<number>;
    suggestedAmount: ReconciliationFieldResult<number>;
    suggestedAmountType: ReconciliationFieldResult<string>;
  };
}

function normalizeBaseUrl(value: string | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed.replace(/\/+$/, "");
}

export async function captureReconciliationDocument(file: File, source: ReconciliationSourceKey): Promise<ReconciliationExtractResult> {
  const formData = new FormData();
  formData.append("file", file, file.name);
  formData.append("source", source);

  const response = await fetch(`${apiBaseUrl}/api/reconciliation/extract`, {
    method: "POST",
    body: formData,
  });

  const body = (await response.json().catch(() => ({}))) as Partial<{ error: string } & ReconciliationExtractResult>;
  if (!response.ok) {
    throw new Error(body.error || `Reconciliation extraction failed with status ${response.status}`);
  }

  return body as ReconciliationExtractResult;
}
