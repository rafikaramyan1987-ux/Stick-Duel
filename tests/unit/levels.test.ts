import { describe, expect, it } from 'vitest';
import { Duel } from '../../src/game/duel';
import { LEVELS } from '../../src/levels';
import type { AmmoId } from '../../src/levels/types';
import { aimsAt } from '../../src/physics/aim';
import { AMMO, Sim } from '../../src/physics/sim';

/**
 * Phase A level checks (the full search bot and docs/levels-report.md come with the level checker):
 * every level has an environmental one-shot win within par, found by aiming at its ropes and bodies
 * with the real physics, and from level 3 on, direct hits alone can never win.
 */
function targets(s: Sim): Array<{ x: number; y: number }> {
  const out: Array<{ x: number; y: number }> = [];
  for (const r of s.ropes) {
    const [a, b] = s.ropeEnds(r);
    out.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  }
  for (const e of s.ents) if (e.name) out.push({ x: e.body.getPosition().x, y: e.body.getPosition().y });
  return out;
}

describe('levels', () => {
  it('there are 3 preview levels: forest rope + log, castle chandelier, desert barrels', () => {
    expect(LEVELS.map((l) => l.id)).toEqual(['forest-1', 'castle-1', 'desert-1']);
    for (const l of LEVELS) {
      expect(l.par).toBeGreaterThanOrEqual(1);
      expect(Object.values(l.ammo).reduce((a, b) => a + (b ?? 0), 0)).toBe(l.shots);
    }
  });

  for (const [i, lv] of LEVELS.entries()) {
    it(`${lv.id}: an environmental win exists within par`, () => {
      const probe = new Sim(lv, 1);
      probe.warmUp();
      let win: string | null = null;
      search: for (const t of targets(probe)) {
        for (const ammo of Object.keys(lv.ammo) as AmmoId[]) {
          for (const aim of aimsAt(probe, 0, t, [12, 16, 21])) {
            const s = new Sim(lv, 1);
            s.warmUp();
            s.fire(0, aim.angle, aim.power, ammo);
            for (let k = 0; k < 60 * 9 && s.fighters[1].alive; k++) s.step();
            if (!s.fighters[1].alive && s.fighters[0].alive && s.stats!.direct === 0) {
              win = `${ammo} ${aim.angle.toFixed(3)} ${aim.power.toFixed(3)}`;
              break search;
            }
          }
        }
      }
      expect(win, `no environmental win in ${lv.id}`).not.toBeNull();
    }, 60_000);

    it(`${lv.id}: direct hits alone ${i >= 2 ? 'can never' : 'are not meant to'} win`, () => {
      // best case: every shot is a head hit with the strongest direct ammo the level gives
      let best = 0;
      for (const [a, n] of Object.entries(lv.ammo) as Array<[AmmoId, number]>) best += AMMO[a].direct * 1.5 * n;
      if (i >= 2) expect(best).toBeLessThan(lv.rival.hp);
    });
  }

  it('the duel gives 3 stars for a one-shot environmental win, with a replay first', () => {
    const lv = LEVELS[1]!;
    const d = new Duel(lv, 1);
    const rope = d.sim.rope('chain')!;
    const [a, b] = d.sim.ropeEnds(rope);
    const aim = aimsAt(d.sim, 0, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }).find((x) => x.angle > -0.9)!;
    d.setAim(aim.angle, aim.power);
    const phases: string[] = [];
    d.listeners.phase = (p) => phases.push(p);
    expect(d.fire()).toBe(true);
    for (let k = 0; k < 60 * 30 && d.phase !== 'over'; k++) d.update(1 / 60);
    expect(phases).toContain('replay');
    expect(d.result).toMatchObject({ win: true, stars: [true, true, true], shotsUsed: 1, noDirect: true });
  });

  it('running out of shots loses', () => {
    const d = new Duel(LEVELS[0]!, 1);
    d.ammo.arrow = 1;
    d.setAim(1.0, 0);
    d.fire();
    for (let k = 0; k < 60 * 20 && d.phase !== 'over'; k++) d.update(1 / 60);
    expect(d.result).toMatchObject({ win: false, reason: 'shots' });
  });
});
