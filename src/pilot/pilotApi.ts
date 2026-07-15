import { pilotApiBaseUrl } from "./pilotConfig";

export interface PilotUser {
  id: number;
  email: string;
  isActive: boolean;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface PilotOrganization {
  id: number;
  name: string;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface PilotLocation {
  id: number;
  organizationId: number;
  name: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  region: string;
  postalCode: string;
  country: string;
  timezone: string;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface PilotOrganizationBundle {
  organization: PilotOrganization;
  restaurantLocations: PilotLocation[];
  currentLocation: PilotLocation | null;
  membershipRole?: "owner" | "manager" | string;
}

export interface PilotAuthMeResponse {
  user: PilotUser;
  membershipRole: "owner" | "manager" | string | null;
  currentOrganizationId: number | null;
  currentLocationId: number | null;
  csrfToken: string;
}

export interface PilotLoginResponse {
  user: PilotUser;
  membershipRole: "owner" | "manager" | string | null;
  currentOrganization: PilotOrganization | null;
  currentLocationId: number | null;
  csrfToken: string;
}

export interface PilotApiErrorPayload {
  error: string;
  errors?: Record<string, string>;
}

export class PilotApiError extends Error {
  status: number;
  errors?: Record<string, string>;

  constructor(message: string, status: number, errors?: Record<string, string>) {
    super(message);
    this.name = "PilotApiError";
    this.status = status;
    this.errors = errors;
  }
}

function buildUrl(path: string) {
  return new URL(path, `${pilotApiBaseUrl}/`).toString();
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
  const response = await fetch(buildUrl(path), {
    ...init,
    credentials: "include",
    headers: {
      Accept: "application/json",
      ...(init.headers ?? {}),
    },
  });
  const payload = await readJsonResponse<PilotApiErrorPayload>(response);

  if (!response.ok) {
    throw new PilotApiError(payload?.error || `Request failed with status ${response.status}`, response.status, payload?.errors);
  }

  return payload as T;
}

export async function getPilotCsrfToken() {
  const payload = await requestJson<{ csrfToken: string }>("/api/auth/csrf");
  return payload.csrfToken;
}

export async function fetchPilotSession() {
  return requestJson<PilotAuthMeResponse>("/api/auth/me");
}

export async function loginToPilot(email: string, password: string) {
  const csrfToken = await getPilotCsrfToken();
  return requestJson<PilotLoginResponse>("/api/auth/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CSRFToken": csrfToken,
    },
    body: JSON.stringify({ email, password }),
  });
}

export async function logoutOfPilot() {
  const csrfToken = await getPilotCsrfToken();
  return requestJson<{ ok: true }>("/api/auth/logout", {
    method: "POST",
    headers: {
      "X-CSRFToken": csrfToken,
    },
  });
}

export async function fetchCurrentOrganization() {
  return requestJson<PilotOrganizationBundle>("/api/organizations/current");
}
