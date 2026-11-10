import { describe, expect, it } from 'vitest';
import { freshSave, sanitize, starCount } from '../../src/game/save';

describe('save data', () => {
  it('sanitizes anything into a valid save', () => {
    expect(sanitize(null)).toEqual(freshSave());
    expect(sanitize('junk')).toEqual(freshSave());
    const s = sanitize({ coins: -5, levels: { 'forest-1': { stars: [1, 0, 1] }, bad: { stars: 3 } }, tutorial: 1, music: false, lang: 'fr', hints: ['a', 3] });
    expect(s.coins).toBe(0);
    expect(s.levels).toEqual({ 'forest-1': { stars: [true, false, true] } });
    expect(s.tutorial).toBe(true);
    expect(s.music).toBe(false);
    expect(s.sfx).toBe(true);
    expect(s.lang).toBe('fr');
    expect(s.hints).toEqual(['a']);
    expect(starCount(s, 'forest-1')).toBe(2);
    expect(starCount(s, 'nope')).toBe(0);
  });
});
