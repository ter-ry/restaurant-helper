function isTruthy(value: string | undefined) {
  return Boolean(value && ["1", "true", "yes", "on"].includes(value.trim().toLowerCase()));
}

function normalizeBaseUrl(value: string | undefined, fallback: string) {
  const trimmed = value?.trim();
  const resolved = trimmed ? trimmed : fallback;
  return resolved.replace(/\/+$/, "");
}

export const pilotAppEnabled = isTruthy(import.meta.env.VITE_ENABLE_PILOT_APP);
export const pilotApiBaseUrl = normalizeBaseUrl(import.meta.env.VITE_PILOT_API_BASE_URL, "http://127.0.0.1:5001");
