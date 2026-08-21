import { buildApiUrl } from "./apiBase";
import { CustomerApiError, getCustomerCsrfToken } from "./customerAuth";

export interface DataImportFieldSpec {
  field: string;
  label: string;
  required: boolean;
}

export const DATA_IMPORT_FIELDS: Record<string, DataImportFieldSpec[]> = {
  supplier: [
    { field: "name", label: "Supplier name", required: true },
    { field: "categoryFocus", label: "Category focus", required: false },
    { field: "contactName", label: "Contact name", required: false },
    { field: "contactPhone", label: "Contact phone", required: false },
    { field: "contactEmail", label: "Contact email", required: false },
    { field: "orderingNotes", label: "Ordering notes", required: false },
    { field: "notes", label: "Notes", required: false },
  ],
  inventory_item: [
    { field: "name", label: "Item name", required: true },
    { field: "locationName", label: "Location name", required: true },
    { field: "supplierName", label: "Supplier name", required: false },
    { field: "category", label: "Category", required: false },
    { field: "stockUnit", label: "Stock unit", required: false },
    { field: "currentOnHand", label: "Current on hand", required: false },
    { field: "minQuantity", label: "Minimum quantity", required: false },
    { field: "parLevel", label: "PAR level", required: false },
    { field: "latestPurchasePrice", label: "Latest purchase price", required: false },
  ],
  supplier_item_mapping: [
    { field: "supplierName", label: "Supplier name", required: true },
    { field: "inventoryItemName", label: "Inventory item name", required: true },
    { field: "supplierItemName", label: "Supplier item name", required: true },
    { field: "purchaseUnit", label: "Purchase unit", required: false },
    { field: "inventoryUnit", label: "Inventory unit", required: false },
    { field: "conversionFactor", label: "Conversion factor", required: false },
  ],
  opening_inventory: [
    { field: "itemName", label: "Item name", required: true },
    { field: "locationName", label: "Location name", required: true },
    { field: "currentOnHand", label: "Opening quantity", required: true },
    { field: "stockUnit", label: "Stock unit", required: false },
  ],
};

export const DATA_IMPORT_ENTITY_SCOPES = Object.keys(DATA_IMPORT_FIELDS);

export interface DataImportFileSummary {
  id: number;
  role: string;
  originalFileName: string;
  storagePath: string;
  sha256: string;
  byteSize: number;
  mimeType: string;
  uploadedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface DataImportIssueSummary {
  id: number;
  dataImportRowId: number;
  severity: string;
  fieldName: string;
  code: string;
  message: string;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface DataImportChangeSummary {
  id: number;
  dataImportJobId: number;
  dataImportRowId: number | null;
  entityType: string;
  changeType: string;
  targetEntityId: string;
  rowFingerprint: string;
  previous: Record<string, unknown>;
  applied: Record<string, unknown>;
  rollbackable: boolean;
  status: string;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface DataImportRowSummary {
  id: number;
  dataImportJobId: number;
  rowNumber: number;
  entityType: string;
  sourceRow: Record<string, unknown>;
  normalizedRow: Record<string, unknown>;
  rowFingerprint: string;
  status: string;
  targetEntityType: string;
  targetEntityId: string;
  issueSummary: string;
  warningCount: number;
  blockedCount: number;
  canRollback: boolean;
  issues: DataImportIssueSummary[];
  changes: DataImportChangeSummary[];
  createdAt: string | null;
  updatedAt: string | null;
}

export interface DataImportMappingSummary {
  id: number;
  sourceColumnName: string;
  targetFieldName: string;
  mappingType: string;
  fixedValue: Record<string, unknown>;
  displayOrder: number;
  isRequired: boolean;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface DataImportJobSummary {
  id: number;
  organizationId: number;
  createdByUserId: number | null;
  approvedByUserId: number | null;
  sourceType: string;
  sourceFileName: string;
  sourceFileExtension: string;
  sourceMimeType: string;
  sourceHash: string;
  storagePath: string;
  status: string;
  entityScope: string;
  mapping: Record<string, unknown>;
  summary: Record<string, unknown>;
  rowCount: number;
  previewRowCount: number;
  appliedRowCount: number;
  blockedRowCount: number;
  warningCount: number;
  approvedAt: string | null;
  executedAt: string | null;
  rolledBackAt: string | null;
  batchId: string;
  rollbackBlockers: string[];
  sourceColumns: string[];
  sampleRows: Array<Record<string, unknown>>;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface DataImportJobDetail extends DataImportJobSummary {
  organization: Record<string, unknown> | null;
  files: DataImportFileSummary[];
  rows: DataImportRowSummary[];
  changes: DataImportChangeSummary[];
  mappings: DataImportMappingSummary[];
  auditEvents: Array<Record<string, unknown>>;
}

export interface DataImportJobResponse {
  job: DataImportJobDetail;
}

export interface DataImportJobsListResponse {
  jobs: DataImportJobSummary[];
}

async function readJsonResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (!text) {
    return null as T;
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    return null as T;
  }
}

async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(buildApiUrl(path), {
    ...init,
    credentials: "include",
    headers: {
      Accept: "application/json",
      ...(init.headers ?? {}),
    },
  });
  const payload = await readJsonResponse<{ error?: string }>(response);
  if (!response.ok) {
    throw new CustomerApiError(payload?.error || `Request failed with status ${response.status}`, response.status);
  }
  return payload as T;
}

export async function listImportJobs(organizationId: number) {
  return requestJson<DataImportJobsListResponse>(`/api/imports/organizations/${organizationId}/jobs`);
}

export async function fetchImportJob(jobId: number) {
  return requestJson<DataImportJobResponse>(`/api/imports/jobs/${jobId}`);
}

export async function uploadImportJob(formData: FormData) {
  const csrfToken = await getCustomerCsrfToken();
  return requestJson<DataImportJobResponse>("/api/imports/jobs", {
    method: "POST",
    headers: {
      "X-CSRFToken": csrfToken,
    },
    body: formData,
  });
}

export async function saveImportMapping(jobId: number, payload: { entityScope: string; fieldMappings: Record<string, string>; fixedValues: Record<string, unknown> }) {
  const csrfToken = await getCustomerCsrfToken();
  return requestJson<DataImportJobResponse>(`/api/imports/jobs/${jobId}/mapping`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CSRFToken": csrfToken,
    },
    body: JSON.stringify(payload),
  });
}

export async function previewImportJob(jobId: number) {
  const csrfToken = await getCustomerCsrfToken();
  return requestJson<DataImportJobResponse>(`/api/imports/jobs/${jobId}/preview`, {
    method: "POST",
    headers: {
      "X-CSRFToken": csrfToken,
    },
  });
}

export async function approveImportJob(jobId: number) {
  const csrfToken = await getCustomerCsrfToken();
  return requestJson<DataImportJobResponse>(`/api/imports/jobs/${jobId}/approve`, {
    method: "POST",
    headers: {
      "X-CSRFToken": csrfToken,
    },
  });
}

export async function executeImportJob(jobId: number) {
  const csrfToken = await getCustomerCsrfToken();
  return requestJson<DataImportJobResponse>(`/api/imports/jobs/${jobId}/execute`, {
    method: "POST",
    headers: {
      "X-CSRFToken": csrfToken,
    },
  });
}

export async function rollbackImportJob(jobId: number) {
  const csrfToken = await getCustomerCsrfToken();
  return requestJson<DataImportJobResponse>(`/api/imports/jobs/${jobId}/rollback`, {
    method: "POST",
    headers: {
      "X-CSRFToken": csrfToken,
    },
  });
}
