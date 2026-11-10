import { describe, expect, it } from 'vitest';
import { Duel } from '../../src/game/duel';
import { LEVELS } from '../../src/levels';
import { endlessLevel } from '../../src/levels/endless';
import { VERSUS } from '../../src/levels/versus';
import { aimsAt } from '../../src/physics/aim';
import { Sim, TRAP_CAP } from '../../src/physics/sim';

/** Level rules (the full proof is the level checker: npm run levels:check → docs/levels-report.md). */
describe('levels', () => {
  it('six worlds × (8 levels + a boss), ids unique, every 4th is tricky, bosses have 150–250 HP', () => {
    expect(LEVELS).toHaveLength(54);
    expect(new Set(LEVELS.map((l) => l.id)).size).toBe(54);
    for (const l of LEVELS) {
      expect(l.player.hp).toBe(100);
      expect(l.rival.hp).toBeGreaterThan(TRAP_CAP);
      if (l.boss) {
        expect(l.n).toBe(9);
        expect(l.rival.hp).toBeGreaterThanOrEqual(150);
        expect(l.rival.hp).toBeLessThanOrEqual(250);
        expect(l.rivalWeapon).toBeDefined();
      } else expect(!!l.tricky).toBe(l.n % 4 === 0);
      // wind in the mountains and the desert only
      if (l.wind) expect(['mountains', 'desert']).toContain(l.world);
    }
    expect(LEVELS.filter((l) => l.world === 'mountains' || l.world === 'desert').every((l) => !!l.wind || l.id === 'desert-1')).toBe(true);
  });

  it('the rival gets sharper by world and by level; from world 2 it has traps on the player side', () => {
    for (let i = 1; i < LEVELS.length; i++) {
      const a = LEVELS[i - 1]!;
      const b = LEVELS[i]!;
      if (a.world === b.world) expect(b.rivalSkill).toBeGreaterThan(a.rivalSkill);
    }
    const first = (w: string) => LEVELS.find((l) => l.world === w)!.rivalSkill;
    expect(first('castle')).toBeGreaterThan(first('forest'));
    expect(first('volcano')).toBeGreaterThan(first('frozen'));
    for (const l of LEVELS.filter((x) => x.world !== 'forest')) expect(l.rivalTargets?.length, l.id).toBeGreaterThan(0);
  });

  it('teaching levels: 1 has no cover, 2 has cover, 3 has the first trap', () => {
    const [f1, f2, f3] = LEVELS;
    expect(f1!.objects).toHaveLength(0);
    expect(f2!.objects.length).toBeGreaterThan(0);
    expect(f2!.ropes).toHaveLength(0);
    expect(f3!.ropes.length).toBeGreaterThan(0);
  });

  it('a duel: unlimited arrows, both sides shoot, stars for win / over half HP / trap K.O.', () => {
    const d = new Duel(LEVELS[0]!, 1, { headless: true });
    expect(d.ammo.arrow).toBe(Infinity);
    const phases = new Set<string>();
    d.listeners.phase = (p) => phases.add(p);
    for (let shot = 0; shot < 30 && d.phase !== 'over'; shot++) {
      const head = d.sim.fighters[1].rag.head.getPosition();
      const aim = aimsAt(d.sim, 0, { x: head.x, y: head.y }, [21]).find((a) => a.angle > -0.6)!;
      d.setAim(aim.angle, aim.power);
      expect(d.fire()).toBe(true);
      for (let k = 0; k < 60 * 30 && !['aim', 'over'].includes(d.phase as string); k++) d.update(1 / 60);
    }
    expect(phases).toContain('rivalFlight');
    expect(d.result?.win).toBe(true);
    expect(d.result!.stars[0]).toBe(true);
    expect(d.result!.stars[1]).toBe(d.playerHp > 50);
    expect(d.result!.stars[2]).toBe(d.result!.trapKill || d.result!.chain);
  });

  it('losing; continue with 1 HP gives the turn back', () => {
    const d = new Duel(LEVELS[0]!, 1);
    d.sim.fighters[0].hp = 1;
    d.ammo.bomb = 1;
    d.selectAmmo('bomb');
    d.setAim(1.0, 0); // a bomb at your own feet
    d.fire();
    for (let k = 0; k < 60 * 20 && d.phase !== 'over'; k++) d.update(1 / 60);
    expect(d.result).toMatchObject({ win: false, reason: 'ko' });
    d.revive();
    expect(d.phase).toBe('aim');
    expect(d.sim.fighters[0].alive).toBe(true);
    expect(d.sim.fighters[0].hp).toBe(1);
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
