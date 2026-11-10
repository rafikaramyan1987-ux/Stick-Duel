import { describe, expect, it } from 'vitest';
import { levelById, LEVELS } from '../../src/levels';
import type { LevelDef } from '../../src/levels/types';
import { aimsAt } from '../../src/physics/aim';
import { AMMO, Sim, segSegDist } from '../../src/physics/sim';

const run = (s: Sim, seconds: number) => {
  for (let i = 0; i < seconds * 60; i++) s.step();
};

/** A tiny flat arena for focused tests. */
function arena(objects: LevelDef['objects'] = [], ropes: LevelDef['ropes'] = []): LevelDef {
  return {
    id: 'test',
    world: 'forest',
    n: 1,
    name: 'level.forest1',
    shots: 3,
    par: 1,
    ammo: { arrow: 3 },
    player: { x: 0, y: 0, hp: 100 },
    rival: { x: 10, y: 0, hp: 100 },
    terrain: [{ surface: 'grass', points: [{ x: -10, y: 0 }, { x: 25, y: 0 }, { x: 25, y: 5 }, { x: -10, y: 5 }] }],
    objects,
    ropes,
    view: { x0: -2, x1: 12, y0: -8, y1: 1 },
    killY: 12,
    rivalSkill: 0.5,
  };
}

describe('simulation', () => {
  it('fighters stand still and unhurt when nothing happens', () => {
    for (const lv of LEVELS) {
      const s = new Sim(lv, 1);
      s.warmUp();
      const before = s.fighters.map((f) => f.rag.torso.getPosition().x);
      run(s, 4);
      s.fighters.forEach((f, i) => {
        expect(f.hp).toBe(f.maxHp);
        expect(f.alive).toBe(true);
        expect(Math.abs(f.rag.torso.getPosition().x - before[i]!)).toBeLessThan(0.3);
      });
      expect(s.isSettled()).toBe(true);
    }
  });

  it('is deterministic: the same shot gives exactly the same result', () => {
    const lv = levelById('castle-1')!;
    const out = [1, 2].map(() => {
      const s = new Sim(lv, 7);
      s.warmUp();
      s.fire(0, -0.5, 0.8, 'arrow');
      run(s, 6);
      const p = s.fighters[1].rag.torso.getPosition();
      return `${s.fighters[1].hp}|${p.x.toFixed(6)}|${p.y.toFixed(6)}|${s.ents.length}`;
    });
    expect(out[0]).toBe(out[1]);
  });

  it('a direct arrow hit only does a little damage', () => {
    const s = new Sim(arena(), 1);
    s.warmUp();
    const target = s.fighters[1].rag.torso.getPosition();
    const aim = aimsAt(s, 0, { x: target.x, y: target.y })[0]!;
    s.fire(0, aim.angle, aim.power, 'arrow');
    run(s, 3);
    const dmg = 100 - s.fighters[1].hp;
    expect(dmg).toBeGreaterThan(0);
    expect(dmg).toBeLessThanOrEqual(AMMO.arrow.direct * 1.5);
    expect(s.stats?.direct).toBe(dmg);
  });

  it('an arrow cuts a rope and the dropped weight hurts by mass and speed', () => {
    const lv = arena(
      [{ id: 'rock', shape: 'box', x: 10, y: -5, w: 1, h: 1, mat: 'stone', look: 'stoneBlock' }],
      [{ id: 'r', anchor: { x: 10, y: -7.5 }, body: 'rock', local: { x: 0, y: -0.5 } }],
    );
    const s = new Sim(lv, 1);
    s.warmUp();
    expect(s.rope('r')!.joint).not.toBeNull();
    const aim = aimsAt(s, 0, { x: 10, y: -6.6 }).find((a) => a.angle > -0.9)!;
    s.fire(0, aim.angle, aim.power, 'arrow');
    run(s, 4);
    expect(s.rope('r')!.joint).toBeNull();
    expect(s.stats!.ropes).toBe(1);
    expect(s.fighters[1].hp).toBeLessThan(40);
    expect(s.stats!.env).toBeGreaterThan(60);
  });

  it('a fire arrow ignites a barrel, which explodes and breaks wood nearby into chunks', () => {
    const lv = arena([
      { id: 'tnt', shape: 'box', x: 6, y: -0.45, w: 0.7, h: 0.9, mat: 'barrel', look: 'barrelTnt' },
      { id: 'plank', shape: 'box', x: 7, y: -0.6, w: 0.3, h: 1.2, mat: 'wood', look: 'woodBeam' },
    ]);
    const s = new Sim(lv, 1);
    s.warmUp();
    const aim = aimsAt(s, 0, { x: 6, y: -0.5 }).find((a) => a.angle > -0.8)!;
    s.fire(0, aim.angle, aim.power, 'fire');
    run(s, 4);
    expect(s.stats!.ignites).toBeGreaterThan(0);
    expect(s.stats!.explosions).toBe(1);
    expect(s.entByName('tnt')).toBeUndefined();
    expect(s.entByName('plank')).toBeUndefined();
    expect(s.liveEnts().some((e) => e.desc.chunk && e.desc.mat === 'wood')).toBe(true);
  });

  it('a normal arrow does not set a barrel off', () => {
    const s = new Sim(arena([{ id: 'tnt', shape: 'box', x: 6, y: -0.45, w: 0.7, h: 0.9, mat: 'barrel', look: 'barrelTnt' }]), 1);
    s.warmUp();
    const aim = aimsAt(s, 0, { x: 6, y: -0.5 }).find((a) => a.angle > -0.8)!;
    s.fire(0, aim.angle, aim.power, 'arrow');
    run(s, 3);
    expect(s.stats!.explosions).toBe(0);
    expect(s.entByName('tnt')).toBeDefined();
  });

  it('falling out of the world is a K.O.', () => {
    const s = new Sim(arena(), 1);
    s.warmUp();
    for (const p of s.fighters[1].rag.parts) p.body.setTransform({ x: p.body.getPosition().x + 30, y: p.body.getPosition().y }, p.body.getAngle());
    run(s, 4);
    expect(s.fighters[1].alive).toBe(false);
  });

  it('segment distance helper', () => {
    expect(segSegDist({ x: 0, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 }, { x: 2, y: 0 })).toBe(0);
    expect(segSegDist({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 })).toBeCloseTo(1);
  });
});
