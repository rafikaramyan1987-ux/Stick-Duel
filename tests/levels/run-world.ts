import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { LEVELS, WORLD_LEVELS } from '../../src/levels';
import { checkLevel } from '../../src/levels/checker';
import type { WorldId } from '../../src/levels/types';

/**
 * Level checker for one world: proves a win within par for every level (real game rules, rival
 * turns included), and that from global level 4 on no single shot wins, and from level 3 on a
 * direct-hit-only strategy does not win. Results go to .levels/<world>.json for the report.
 */
export function runWorld(world: WorldId): void {
  const results: unknown[] = [];
  for (const lv of WORLD_LEVELS[world]) {
    const index = LEVELS.indexOf(lv); // 0-based global level number
    it(`${lv.id} (level ${index + 1})`, () => {
      const r = checkLevel(lv);
      results.push({ ...r, index: index + 1, world, n: lv.n, boss: !!lv.boss, tricky: !!lv.tricky, wind: lv.wind ?? 0 });
      mkdirSync('.levels', { recursive: true });
      writeFileSync(`.levels/${world}.json`, JSON.stringify(results, null, 1));
      expect(r.solution, `${lv.id}: no win found within par ${lv.par}`).not.toBeNull();
      expect(r.solution!.length).toBeLessThanOrEqual(lv.par);
      if (index >= 3) {
        expect(lv.par, `${lv.id}: par must be at least 2 after the first 3 levels`).toBeGreaterThanOrEqual(2);
        expect(r.oneShot, `${lv.id}: a single shot wins (${JSON.stringify(r.oneShot)})`).toBeNull();
      }
      if (index >= 2) expect(r.directOnly.win, `${lv.id}: direct hits alone win`).toBe(false);
    });
  }
}
