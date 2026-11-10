import en from './en.json';
import fr from './fr.json';

/**
 * Translations: one JSON file per language (src/i18n/<code>.json), English is the reference.
 * tests/unit/i18n.test.ts checks that every language has every English key.
 */
export type Key = keyof typeof en;
type Dict = Record<Key, string>;

export const DICTS = { en, fr } satisfies Record<string, Dict>;
export type LangCode = keyof typeof DICTS;
export const LANGS: Array<{ code: LangCode; name: string }> = [
  { code: 'en', name: 'English' },
  { code: 'fr', name: 'Français' },
];

let current: LangCode = 'en';

/** First supported language among the candidates (platform locale, browser languages…), else English. */
export function detectLang(...candidates: Array<string | null | undefined>): LangCode {
  for (const c of candidates) {
    if (!c) continue;
    const l = c.toLowerCase().slice(0, 2);
    if (l in DICTS) return l as LangCode;
  }
  return 'en';
}

export function setLang(l: LangCode): void {
  current = l in DICTS ? l : 'en';
  if (typeof document !== 'undefined') document.documentElement.lang = current;
}
export const getLang = (): LangCode => current;

export function t(key: Key, vars: Record<string, string | number> = {}): string {
  let s: string = (DICTS[current] as Dict)[key] ?? en[key] ?? key;
  for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, String(v));
  return s;
}
