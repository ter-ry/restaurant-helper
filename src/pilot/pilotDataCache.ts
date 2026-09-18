type Entry = { value: unknown; expiresAt: number; staleUntil: number };
const entries = new Map<string, Entry>();
const inFlight = new Map<string, Promise<unknown>>();
let scope = "anonymous";
let generation = 0;
export function setPilotCacheScope(nextScope: string | null | undefined) {
  const next = nextScope || "anonymous";
  if (next !== scope) { entries.clear(); inFlight.clear(); scope = next; generation += 1; }
}
export function clearPilotDataCache() { entries.clear(); inFlight.clear(); generation += 1; }
export async function getPilotCached<T>(key: string, loader: () => Promise<T>, ttlMs = 12_000): Promise<T> {
  const cacheKey = `${scope}:${key}`;
  const cached = entries.get(cacheKey);
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.value as T;
  if (cached && cached.staleUntil > now) {
    void startLoad(cacheKey, loader, ttlMs);
    return cached.value as T;
  }
  if (cached) entries.delete(cacheKey);
  return startLoad(cacheKey, loader, ttlMs);
}

function startLoad<T>(cacheKey: string, loader: () => Promise<T>, ttlMs: number): Promise<T> {
  const existing = inFlight.get(cacheKey);
  if (existing) return existing as Promise<T>;
  const requestGeneration = generation;
  let request: Promise<T>;
  request = loader().then((value) => {
    if (requestGeneration === generation && scope && cacheKey.startsWith(`${scope}:`)) {
      const expiresAt = Date.now() + ttlMs;
      entries.set(cacheKey, { value, expiresAt, staleUntil: expiresAt + 60_000 });
    }
    return value;
  }).finally(() => { if (inFlight.get(cacheKey) === request) inFlight.delete(cacheKey); });
  inFlight.set(cacheKey, request);
  return request;
}
