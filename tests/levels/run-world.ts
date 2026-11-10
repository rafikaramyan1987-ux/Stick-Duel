import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { LEVELS, WORLD_LEVELS } from '../../src/levels';
import { checkLevel, TRAP_CAP } from '../../src/levels/checker';
import type { WorldId } from '../../src/levels/types';

/**
 * Level checker for one world (real duels, rival turns included): every level is won by the sharp
 * bot, a trap never does more than 80 damage in one shot (so it never K.O.s a full-HP fighter), and
 * winning duels last at least 4 player shots on average. Results go to .levels/<world>.json.
 */
export function runWorld(world: WorldId): void {
  const results: unknown[] = [];
  for (const lv of WORLD_LEVELS[world]) {
    const index = LEVELS.indexOf(lv) + 1;
    it(`${lv.id} (level ${index})`, () => {
      const r = checkLevel(lv);
      results.push({ ...r, index, world, n: lv.n, boss: !!lv.boss, tricky: !!lv.tricky, wind: lv.wind ?? 0, skill: lv.rivalSkill });
      mkdirSync('.levels', { recursive: true });
      writeFileSync(`.levels/${world}.json`, JSON.stringify(results, null, 1));
      expect(r.solution, `${lv.id}: the sharp bot did not win`).not.toBeNull();
      expect(r.maxTrap, `${lv.id}: a trap did ${r.maxTrap} in one shot`).toBeLessThanOrEqual(TRAP_CAP);
      expect(Math.min(lv.player.hp, lv.rival.hp)).toBeGreaterThan(TRAP_CAP);
      expect(r.avgShots, `${lv.id}: winning duels last ${r.avgShots.toFixed(1)} shots on average`).toBeGreaterThanOrEqual(4);
    });
  }
}
