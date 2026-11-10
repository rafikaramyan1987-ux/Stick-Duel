/**
 * localStorage wrapper. Every access is wrapped in try/catch: storage can be
 * disabled (private mode, iframe sandbox, quota). Falls back to memory.
 */
import type { StorageLike } from './ads';

const memory = new Map<string, string>();
let backend: StorageLike | null = null;

/** Use the platform storage (CrazyGames data module) instead of localStorage. */
export function setStorageBackend(s: StorageLike | null): void {
  backend = s;
}

function store(): StorageLike {
  // Playgama (3.2.1): progress only through Bridge Storage; without Bridge the in-memory copy below is the save
  if (import.meta.env.VITE_PLATFORM === 'playgama') {
    if (!backend) throw new Error('no Bridge storage');
    return backend;
  }
  return backend ?? window.localStorage;
}

export function readJSON<T>(key: string, fallback: T): T {
  let raw: string | null;
  try {
    raw = store().getItem(key);
  } catch {
    raw = null;
  }
  if (raw == null) raw = memory.get(key) ?? null;
  if (raw == null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function writeJSON(key: string, value: unknown): void {
  const raw = JSON.stringify(value);
  memory.set(key, raw);
  try {
    store().setItem(key, raw);
  } catch {
    /* storage unavailable: memory copy is kept for this session */
  }
}

export function removeKey(key: string): void {
  memory.delete(key);
  try {
    store().removeItem(key);
  } catch {
    /* ignore */
  }
}
