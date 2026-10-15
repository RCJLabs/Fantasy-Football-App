import { openDB, type IDBPDatabase } from 'idb';

interface Entry<T> {
  value: T;
  savedAt: number;
}

export interface Cached<T> {
  value: T;
  savedAt: number;
  /** True when the network failed and an older copy was returned. */
  stale: boolean;
}

let dbPromise: Promise<IDBPDatabase> | null = null;
function db(): Promise<IDBPDatabase> | null {
  if (typeof indexedDB === 'undefined') return null;
  dbPromise ??= openDB('ff-assistant', 1, {
    upgrade(d) {
      d.createObjectStore('kv');
    },
  }).catch((e) => {
    // IndexedDB can be unavailable (private mode, blocked storage): run without a cache.
    console.warn('IndexedDB unavailable', e);
    dbPromise = null;
    throw e;
  });
  return dbPromise;
}

async function read<T>(key: string): Promise<Entry<T> | undefined> {
  try {
    const d = await db();
    return d ? ((await d.get('kv', key)) as Entry<T> | undefined) : undefined;
  } catch {
    return undefined;
  }
}

async function write<T>(key: string, value: T): Promise<void> {
  try {
    const d = await db();
    await d?.put('kv', { value, savedAt: Date.now() } satisfies Entry<T>, key);
  } catch {
    /* cache is best-effort */
  }
}

/**
 * Return a cached value younger than `ttlMs`, otherwise load and store it. If loading fails and an
 * older copy exists, return that copy marked stale (offline / API down).
 */
export async function cached<T>(key: string, ttlMs: number, load: () => Promise<T>, opts: { force?: boolean } = {}): Promise<Cached<T>> {
  const hit = await read<T>(key);
  if (hit && !opts.force && Date.now() - hit.savedAt < ttlMs) return { ...hit, stale: false };
  try {
    const value = await load();
    await write(key, value);
    return { value, savedAt: Date.now(), stale: false };
  } catch (e) {
    if (hit) return { ...hit, stale: true };
    throw e;
  }
}

export async function clearCache(): Promise<void> {
  try {
    const d = await db();
    await d?.clear('kv');
  } catch {
    /* ignore */
  }
}

/** Ask the browser not to evict our storage (helps on iOS). */
export async function requestPersistence(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}
