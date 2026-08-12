function normalizeBaseUrl(value: string | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.replace(/\/+$/, "");
}

export function resolveApiBaseUrl() {
  const configured = normalizeBaseUrl(import.meta.env.VITE_FLOWTALLY_API_BASE_URL ?? import.meta.env.VITE_PILOT_API_BASE_URL);
  return configured ?? window.location.origin;
}

export function buildApiUrl(path: string) {
  return new URL(path, `${resolveApiBaseUrl()}/`).toString();
}
