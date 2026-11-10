import de from './de.json';
import en from './en.json';
import es from './es.json';
import fr from './fr.json';
import it from './it.json';
import nl from './nl.json';
import pl from './pl.json';
import pt from './pt.json';
import ru from './ru.json';
import tr from './tr.json';

/**
 * Translations: one JSON file per language (src/i18n/<code>.json), English is the reference.
 * tests/unit/i18n.test.ts checks that every language has every English key.
 */
export type Key = keyof typeof en;
type Dict = Record<Key, string>;

export const DICTS = { en, fr, de, it, es, pt, nl, pl, tr, ru } satisfies Record<string, Dict>;
export type LangCode = keyof typeof DICTS;
export const LANGS: Array<{ code: LangCode; name: string }> = [
  { code: 'en', name: 'English' },
  { code: 'fr', name: 'Français' },
  { code: 'de', name: 'Deutsch' },
  { code: 'it', name: 'Italiano' },
  { code: 'es', name: 'Español' },
  { code: 'pt', name: 'Português' },
  { code: 'nl', name: 'Nederlands' },
  { code: 'pl', name: 'Polski' },
  { code: 'tr', name: 'Türkçe' },
  { code: 'ru', name: 'Русский' },
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
