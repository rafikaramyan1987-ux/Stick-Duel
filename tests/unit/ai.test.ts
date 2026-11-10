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

  it('uses the environment against the player when it can (castle: the crate over you; desert: a fire arrow on the barrel)', () => {
    const castle = levelById('castle-3')!;
    // desert 1 without the rival's bunker (from inside it, the barrel is out of reach)
    const d1 = levelById('desert-1')!;
    const desert = { ...d1, objects: d1.objects.filter((o) => !o.fixed) };
    let env = 0;
    let fire = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const s = new Sim(castle, 1);
      s.warmUp();
      if (planRivalShot(s, castle, seed, 1, {}).kind === 'env') env++;
      const d = new Sim(desert, 1);
      d.warmUp();
      const shot = planRivalShot(d, desert, seed, 1, { fire: 1 });
      if (shot.kind === 'env' && shot.ammo === 'fire') fire++;
    }
    expect(env).toBeGreaterThan(3);
    expect(fire).toBeGreaterThan(3);
  });

  it('only aims in its own facing direction', () => {
    const lv = levelById('forest-1')!;
    const s = new Sim(lv, 1);
    s.warmUp();
    const shot = planRivalShot(s, lv, 1, 2, {});
    // the rival is on the right: it shoots to the left (|angle| > 90°)
    expect(Math.abs(shot.angle)).toBeGreaterThan(Math.PI / 2);
  });
});
