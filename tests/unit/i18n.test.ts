import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DICTS, detectLang, setLang, t } from '../../src/i18n';

const DIR = join(__dirname, '../../src/i18n');

describe('i18n', () => {
  it('every language file has every English key, none empty, no extra keys', () => {
    const en = JSON.parse(readFileSync(join(DIR, 'en.json'), 'utf8')) as Record<string, string>;
    const keys = Object.keys(en).sort();
    const files = readdirSync(DIR).filter((f) => f.endsWith('.json'));
    expect(files.length).toBeGreaterThanOrEqual(2);
    for (const f of files) {
      const d = JSON.parse(readFileSync(join(DIR, f), 'utf8')) as Record<string, string>;
      expect(Object.keys(d).sort(), f).toEqual(keys);
      for (const [k, v] of Object.entries(d)) {
        expect(typeof v, `${f}:${k}`).toBe('string');
        expect(v.trim().length, `${f}:${k}`).toBeGreaterThan(0);
        // placeholders must match English
        expect((v.match(/\{\w+\}/g) ?? []).sort(), `${f}:${k}`).toEqual((en[k]!.match(/\{\w+\}/g) ?? []).sort());
      }
    }
    // every JSON file is registered in the game
    expect(Object.keys(DICTS).sort()).toEqual(files.map((f) => f.replace('.json', '')).sort());
  });
  it('detects the platform / browser language, falls back to English', () => {
    expect(detectLang('fr-CA')).toBe('fr');
    expect(detectLang(null, 'en-US')).toBe('en');
    expect(detectLang('xx-XX', 'zz')).toBe('en');
    expect(detectLang(undefined, 'FR')).toBe('fr');
  });
  it('interpolates', () => {
    setLang('fr');
    expect(t('worlds.level', { n: 3 })).toBe('Niveau 3');
    setLang('en');
    expect(t('result.coins', { n: 25 })).toBe('+25 coins');
  });
});
