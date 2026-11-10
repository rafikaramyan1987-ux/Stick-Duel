import { describe, expect, it } from 'vitest';
import { planRivalShot } from '../../src/game/ai';
import { levelById } from '../../src/levels';
import { Sim } from '../../src/physics/sim';

describe('rival AI', () => {
  it('is deterministic for a seed and turn', () => {
    const lv = levelById('castle-1')!;
    const a = new Sim(lv, 1);
    a.warmUp();
    const b = new Sim(lv, 1);
    b.warmUp();
    expect(planRivalShot(a, lv, 3, 1, {})).toEqual(planRivalShot(b, lv, 3, 1, {}));
  });

  it('shoots at the player, and from world 2 also at the traps on the player side (with fire for barrels)', () => {
    const forest = levelById('forest-2')!;
    const castle = levelById('castle-1')!;
    const desert = levelById('desert-1')!;
    let forestEnv = 0;
    let rope = 0;
    let fire = 0;
    for (let seed = 1; seed <= 16; seed++) {
      const f = new Sim(forest, 1);
      f.warmUp();
      if (planRivalShot(f, forest, seed, 1, {}).kind === 'env') forestEnv++;
      const s = new Sim(castle, 1);
      s.warmUp();
      if (planRivalShot(s, castle, seed, 1, {}).kind === 'env') rope++;
      const d = new Sim(desert, 1);
      d.warmUp();
      const shot = planRivalShot(d, desert, seed, 1, { fire: 1 });
      if (shot.kind === 'env' && shot.ammo === 'fire') fire++;
    }
    expect(forestEnv).toBe(0);
    expect(rope).toBeGreaterThan(2);
    expect(fire).toBeGreaterThan(2);
  });

  it('bosses use their weapon every other turn', () => {
    const lv = levelById('castle-9')!;
    const s = new Sim(lv, 1);
    s.warmUp();
    const shots = [0, 1, 2, 3].map((t) => planRivalShot(s, lv, 1, t, {})).filter((x) => x.kind === 'direct');
    expect(shots.some((x) => x.ammo === 'heavy' && x.weapon)).toBe(true);
    const f = levelById('forest-9')!;
    const fs = new Sim(f, 1);
    fs.warmUp();
    expect(planRivalShot(fs, f, 1, 1, {}).volley).toBe(true);
  });

  it('only aims in its own facing direction', () => {
    const lv = levelById('forest-1')!;
    const s = new Sim(lv, 1);
    s.warmUp();
    const shot = planRivalShot(s, lv, 1, 2, {});
    expect(Math.abs(shot.angle)).toBeGreaterThan(Math.PI / 2);
  });
});
