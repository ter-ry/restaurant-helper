type Entry = { value: unknown; expiresAt: number; staleUntil: number };
const entries = new Map<string, Entry>();
const inFlight = new Map<string, Promise<unknown>>();
const listeners = new Map<string, Set<(value: unknown) => void>>();
let scope = "anonymous";
let generation = 0;
export function setPilotCacheScope(nextScope: string | null | undefined) {
  const next = nextScope || "anonymous";
  if (next !== scope) {
    entries.clear();
    inFlight.clear();
    listeners.clear();
    scope = next;
    generation += 1;
  }
}
export function clearPilotDataCache() {
  entries.clear();
  inFlight.clear();
  generation += 1;
}

/**
 * Subscribe to fresh values for a cache key. This lets a mounted workspace
 * apply stale-while-revalidate results without navigating away and back.
 */
export function subscribePilotCache<T>(key: string, listener: (value: T) => void): () => void {
  const cacheKey = `${scope}:${key}`;
  const keyListeners = listeners.get(cacheKey) ?? new Set<(value: unknown) => void>();
  keyListeners.add(listener as (value: unknown) => void);
  listeners.set(cacheKey, keyListeners);
  return () => {
    const current = listeners.get(cacheKey);
    current?.delete(listener as (value: unknown) => void);
    if (current && current.size === 0) listeners.delete(cacheKey);
  };
}

export async function getPilotCached<T>(key: string, loader: () => Promise<T>, ttlMs = 12_000): Promise<T> {
  const cacheKey = `${scope}:${key}`;
  const cached = entries.get(cacheKey);
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.value as T;
  if (cached && cached.staleUntil > now) {
    // A stale read is intentionally resolved immediately. Consume a possible
    // revalidation failure so it cannot become an unhandled rejection; the
    // stale value remains available until a later request succeeds.
    void startLoad(cacheKey, loader, ttlMs).catch(() => undefined);
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
      listeners.get(cacheKey)?.forEach((listener) => {
        // A consumer callback must not turn a successful request into a
        // rejected request or affect other mounted consumers.
        try {
          listener(value);
        } catch {
          // Consumers own their render/update errors.
        }
      });
    }
    return value;
  }).finally(() => { if (inFlight.get(cacheKey) === request) inFlight.delete(cacheKey); });
  inFlight.set(cacheKey, request);
  return request;
}
