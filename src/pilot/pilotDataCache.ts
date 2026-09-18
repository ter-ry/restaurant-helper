type Entry = { value: unknown; expiresAt: number };
const entries = new Map<string, Entry>();
const inFlight = new Map<string, Promise<unknown>>();
let scope = "anonymous";
export function setPilotCacheScope(nextScope: string | null | undefined) {
  const next = nextScope || "anonymous";
  if (next !== scope) { entries.clear(); inFlight.clear(); scope = next; }
}
export function clearPilotDataCache() { entries.clear(); inFlight.clear(); }
export async function getPilotCached<T>(key: string, loader: () => Promise<T>, ttlMs = 12_000): Promise<T> {
  const cacheKey = `${scope}:${key}`;
  const cached = entries.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value as T;
  if (cached) entries.delete(cacheKey);
  const existing = inFlight.get(cacheKey);
  if (existing) return existing as Promise<T>;
  const request = loader().then((value) => { entries.set(cacheKey, { value, expiresAt: Date.now() + ttlMs }); return value; }).finally(() => inFlight.delete(cacheKey));
  inFlight.set(cacheKey, request);
  return request;
}
