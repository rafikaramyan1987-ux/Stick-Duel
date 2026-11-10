import { describe, expect, it } from 'vitest';
import { Duel } from '../../src/game/duel';
import { LEVELS } from '../../src/levels';
import { checkLevel } from '../../src/levels/checker';
import { endlessLevel } from '../../src/levels/endless';
import { VERSUS } from '../../src/levels/versus';
import { aimsAt } from '../../src/physics/aim';
import { Sim } from '../../src/physics/sim';

/**
 * Phase A level checks (the full search bot and docs/levels-report.md come with the level checker):
 * every level has an environmental one-shot win within par, found by aiming at its ropes and bodies
 * with the real physics, and from level 3 on, direct hits alone can never win.
 */
describe('levels', () => {
  it('six worlds × (8 levels + a boss), ids unique, par grows after the first three, every 4th is tricky', () => {
    expect(LEVELS).toHaveLength(54);
    expect(new Set(LEVELS.map((l) => l.id)).size).toBe(54);
    LEVELS.forEach((l, i) => {
      expect(Object.values(l.ammo).reduce((a, b) => a + (b ?? 0), 0)).toBe(l.shots);
      if (i < 3) expect(l.par).toBe(1);
      else expect(l.par).toBeGreaterThanOrEqual(2);
      expect(l.par).toBeLessThanOrEqual(3);
      if (l.boss) {
        expect(l.n).toBe(9);
        expect(l.rival.hp).toBeGreaterThanOrEqual(160);
      } else expect(!!l.tricky).toBe(l.n % 4 === 0);
    });
  });

  it('the first three levels have an environmental one-shot win (forest 1–3)', () => {
    for (const lv of LEVELS.slice(0, 3)) {
      const r = checkLevel(lv, { maxDepth: 1 });
      expect(r.solution, lv.id).not.toBeNull();
      expect(r.directOnly.win).toBe(false);
    }
  }, 120_000);

  it('the duel gives 3 stars for a one-shot environmental win, with a replay first', () => {
    const lv = LEVELS[1]!;
    const d = new Duel(lv, 1);
    const rope = d.sim.ropes[0]!;
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

  it('running out of shots loses; continue with 1 HP gives the turn back', () => {
    const d = new Duel(LEVELS[0]!, 1);
    d.ammo.arrow = 1;
    d.setAim(1.0, 0);
    d.fire();
    for (let k = 0; k < 60 * 20 && d.phase !== 'over'; k++) d.update(1 / 60);
    expect(d.result).toMatchObject({ win: false, reason: 'shots' });
    d.revive();
    expect(d.phase).toBe('aim');
    expect(d.sim.fighters[0].alive).toBe(true);
    expect(d.sim.fighters[0].hp).toBe(1);
    expect(d.shotsLeft).toBeGreaterThan(0);
  });

  it('two players: turns alternate between both archers', () => {
    const d = new Duel(VERSUS[0]!, 1, { versus: true });
    expect(d.turn).toBe(0);
    d.setAim(1.0, 0);
    d.fire();
    for (let k = 0; k < 60 * 20 && d.phase !== 'aim'; k++) d.update(1 / 60);
    expect(d.turn).toBe(1);
    expect(d.facing).toBe(-1);
    d.setAim(Math.PI - 1, 0);
    d.fire();
    for (let k = 0; k < 60 * 20 && (d.phase !== 'aim' || d.turn !== 0); k++) d.update(1 / 60);
    expect(d.turn).toBe(0);
  });

  it('endless arenas are varied and playable', () => {
    const ids = new Set<string>();
    for (let w = 1; w <= 8; w++) {
      const l = endlessLevel(w, 7);
      ids.add(`${l.world}:${l.objects.length}`);
      const s = new Sim(l, 1);
      s.warmUp();
      expect(s.fighters.every((f) => f.alive)).toBe(true);
    }
    expect(ids.size).toBeGreaterThan(3);
  });
});
