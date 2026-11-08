import { describe, expect, it } from 'vitest';
import { segShape } from '../../src/core/geometry';
import { difficulty, generateLevel, laneWidth, MIN_LANE, playable } from '../../src/game/levels';
import { LEVELS_PER_WORLD, WORLDS } from '../../src/game/worlds';

const all = WORLDS.flatMap((w) => Array.from({ length: LEVELS_PER_WORLD }, (_, i) => generateLevel(w.index, i + 1)));

describe('levels', () => {
  it('60 levels, the 10th of each world is a boss', () => {
    expect(all).toHaveLength(60);
    for (const L of all) expect(L.boss).toBe(L.level === 10);
    for (const L of all.filter((l) => l.boss)) {
      const lvl9 = all.find((l) => l.world.index === L.world.index && l.level === 9)!;
      expect(L.enemy.hp).toBeGreaterThan(lvl9.enemy.hp);
      expect(L.enemy.scale).toBeGreaterThan(1.2);
      expect(L.enemy.weapons).toEqual([L.world.boss.weapon]);
    }
  });

  it('is deterministic', () => {
    expect(JSON.stringify(generateLevel(3, 4))).toBe(JSON.stringify(generateLevel(3, 4)));
  });

  it('both fighters stand on solid ground', () => {
    for (const L of all) {
      for (const spot of [L.playerSpot, L.enemySpot]) {
        const under = L.solids.some((s) => s.role === 'platform' && segShape(spot.x, spot.y - 0.2, spot.x, spot.y + 0.3, s.shape));
        expect(under, `${L.key} ${JSON.stringify(spot)}`).toBe(true);
      }
    }
  });

  // heavy: runs the aim solver for both sides of all 60 levels
  it('every level has a clear shot lane for both sides', { timeout: 30_000 }, () => {
    for (const L of all) expect(playable(L), L.key).toBe(true);
  });

  it('lanes are comfortable: a range of good angles for both sides', { timeout: 60_000 }, () => {
    for (const L of all) {
      expect(laneWidth(L, 0), `${L.key} player`).toBeGreaterThanOrEqual(MIN_LANE);
      expect(laneWidth(L, 1), `${L.key} enemy`).toBeGreaterThanOrEqual(MIN_LANE);
    }
  });

  it('shots start above the lip: flat and rising shots clear the scenery near the shooter', () => {
    for (const L of all) {
      for (const [spot, dir, sc] of [[L.playerSpot, 1, 1], [L.enemySpot, -1, L.enemy.scale]] as const) {
        // launch point as in the game (shoulder + 0.55 m along the aim)
        for (const up of [-0.12, 0, 0.3, 0.6, 0.9]) {
          const a = dir > 0 ? -up : Math.PI + up;
          const x0 = spot.x + Math.cos(a) * 0.55 * sc;
          const y0 = spot.y - 1.43 * sc + Math.sin(a) * 0.55 * sc;
          const x1 = x0 + Math.cos(a) * 2.5;
          const y1 = y0 + Math.sin(a) * 2.5;
          const hit = L.solids.find((s) => segShape(x0, y0, x1, y1, s.shape));
          expect(hit, `${L.key} ${dir > 0 ? 'player' : 'enemy'} angle ${up}`).toBeUndefined();
        }
      }
    }
  });

  it('world 1 levels 1–3 are a gentle introduction', () => {
    for (const L of all.filter((l) => l.world.index === 1 && l.level <= 3)) {
      expect(L.ai).toMatchObject({ headshots: false, missFirst: true });
      // nothing but the player's own hill within 4 m of the player
      const near = L.solids.filter((s) => s.role !== 'platform' && s.shape.kind === 'poly' && s.shape.pts.some((p) => Math.abs(p.x - L.playerSpot.x) < 4));
      expect(near, L.key).toEqual([]);
    }
    for (const L of all.filter((l) => !(l.world.index === 1 && l.level <= 3))) expect(L.ai.missFirst).toBe(false);
  });

  it('difficulty rises smoothly: distance and enemy HP across worlds, AI within each world', () => {
    expect(difficulty(1, 1)).toBe(0);
    expect(difficulty(6, 10)).toBe(1);
    const avg = (w: number, f: (L: (typeof all)[number]) => number) => {
      const ls = all.filter((l) => l.world.index === w && !l.boss);
      return ls.reduce((a, l) => a + f(l), 0) / ls.length;
    };
    for (let w = 2; w <= 6; w++) {
      expect(avg(w, (l) => l.enemySpot.x)).toBeGreaterThan(avg(w - 1, (l) => l.enemySpot.x) - 0.5);
      expect(avg(w, (l) => l.enemy.hp)).toBeGreaterThan(avg(w - 1, (l) => l.enemy.hp));
    }
    // within a world the AI gets steadily sharper and hits harder (snow/volcano trade AI skill for hazards)
    for (const W of WORLDS) {
      const ls = all.filter((l) => l.world.index === W.index && !l.boss && !(W.index === 1 && l.level <= 3));
      for (let i = 1; i < ls.length; i++) {
        expect(ls[i]!.skill, ls[i]!.key).toBeGreaterThanOrEqual(ls[i - 1]!.skill);
        expect(ls[i]!.ai.damage, ls[i]!.key).toBeGreaterThanOrEqual(ls[i - 1]!.ai.damage);
      }
    }
    for (const L of all) expect(L.skill).toBeLessThanOrEqual(0.85);
  });


  it('wind: calm forest, gusty mountains and desert', () => {
    expect(all.filter((l) => l.world.id === 'forest' && l.level <= 3).every((l) => l.wind.base === 0)).toBe(true);
    for (const id of ['mountains', 'desert'] as const) expect(all.filter((l) => l.world.id === id).every((l) => l.wind.gust >= 0.4)).toBe(true);
  });

  it('ice is slippery and volcano platforms crumble', () => {
    expect(all.filter((l) => l.world.id === 'snow').every((l) => l.friction < 0.1)).toBe(true);
    expect(all.filter((l) => l.world.id === 'volcano').every((l) => l.solids.some((s) => s.crumble))).toBe(true);
  });
});

describe('scenery near the fighters', () => {
  it('no obstacle within the clearance of either fighter (own platform excepted)', async () => {
    const { CLEARANCE } = await import('../../src/game/levels');
    for (const L of all) {
      for (const p of [L.playerSpot, L.enemySpot]) {
        const near = L.solids.filter((s) => s.group > 0 && (s.shape.kind === 'circle' ? Math.abs(s.shape.c.x - p.x) - s.shape.r : Math.min(...s.shape.pts.map((q) => Math.abs(q.x - p.x)))) < CLEARANCE);
        expect(near, L.key).toEqual([]);
      }
    }
  });
  it('every leaf clump hangs on a trunk or branch', () => {
    for (const L of all) {
      for (const d of L.decos.filter((x) => x.kind === 'canopy')) {
        const wood = L.solids.filter((s) => s.mat === 'wood' && s.shape.kind === 'poly');
        const close = wood.some((s) => s.shape.kind === 'poly' && s.shape.pts.some((q) => Math.hypot(q.x - d.x, q.y - d.y) < 3.6));
        expect(close, `${L.key} canopy at ${d.x.toFixed(1)},${d.y.toFixed(1)}`).toBe(true);
      }
    }
  });
});
