import type { LangCode } from '../i18n';
import { readJSON, writeJSON, removeKey } from '../platform/storage';

/** Progress and settings, saved in the platform storage (CrazyGames data module) or localStorage. */
export const SAVE_KEY = 'topple-duel.save.v1';

export interface LevelProgress {
  /** [win, par, trick] — each star is earned once and kept. */
  stars: [boolean, boolean, boolean];
}

export interface SaveData {
  v: 1;
  levels: Record<string, LevelProgress>;
  coins: number;
  /** The level-1 tutorial has been shown (never again). */
  tutorial: boolean;
  /** One-time hints already shown. */
  hints: string[];
  music: boolean;
  sfx: boolean;
  lang: LangCode | null;
  /** Last level played (Continue). */
  last: string | null;
}

export function freshSave(): SaveData {
  return { v: 1, levels: {}, coins: 0, tutorial: false, hints: [], music: true, sfx: true, lang: null, last: null };
}

export function sanitize(raw: unknown): SaveData {
  const s = freshSave();
  if (!raw || typeof raw !== 'object') return s;
  const r = raw as Partial<SaveData>;
  if (r.levels && typeof r.levels === 'object') {
    for (const [id, lp] of Object.entries(r.levels)) {
      const st = (lp as LevelProgress)?.stars;
      if (Array.isArray(st) && st.length === 3) s.levels[id] = { stars: [!!st[0], !!st[1], !!st[2]] };
    }
  }
  s.coins = Number.isFinite(r.coins) && (r.coins as number) >= 0 ? Math.floor(r.coins as number) : 0;
  s.tutorial = !!r.tutorial;
  s.hints = Array.isArray(r.hints) ? r.hints.filter((h) => typeof h === 'string') : [];
  s.music = r.music !== false;
  s.sfx = r.sfx !== false;
  s.lang = typeof r.lang === 'string' ? (r.lang as LangCode) : null;
  s.last = typeof r.last === 'string' ? r.last : null;
  return s;
}

export function loadSave(): SaveData {
  return sanitize(readJSON<unknown>(SAVE_KEY, null));
}

export function writeSave(s: SaveData): void {
  writeJSON(SAVE_KEY, s);
}

export function clearSave(): void {
  removeKey(SAVE_KEY);
}

export function starCount(s: SaveData, id: string): number {
  return (s.levels[id]?.stars ?? []).filter(Boolean).length;
}
