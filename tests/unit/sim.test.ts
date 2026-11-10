import { describe, expect, it } from 'vitest';
import { levelById, LEVELS } from '../../src/levels';
import type { LevelDef } from '../../src/levels/types';
import { aimsAt } from '../../src/physics/aim';
import { HAZARD_DAMAGE, Sim, segSegDist, TRAP_CAP, ZONE_DAMAGE } from '../../src/physics/sim';

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
    ammo: {},
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
        expect(f.hp, lv.id).toBe(f.maxHp);
        expect(f.alive, lv.id).toBe(true);
        expect(Math.abs(f.rag.torso.getPosition().x - before[i]!), lv.id).toBeLessThan(0.3);
      });
      expect(s.isSettled(), lv.id).toBe(true);
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

  it('direct hits do damage by zone (head 35, body 20, arm/leg 10), scaled by the arrow speed', () => {
    const hit = (part: 'head' | 'torso' | 'thighF', speedIdx: number) => {
      const s = new Sim(arena(), 1);
      s.warmUp();
      const zone: string[] = [];
      const target = s.fighters[1].rag.byName[part].body.getPosition();
      const aim = aimsAt(s, 0, { x: target.x, y: target.y }, [[12, 21][speedIdx]!]).find((a) => a.angle > -0.6)!;
      s.fire(0, aim.angle, aim.power, 'arrow');
      for (let i = 0; i < 120; i++) {
        s.step();
        for (const e of s.events.splice(0)) if (e.t === 'damage' && e.direct) zone.push(`${e.zone}:${e.amount}`);
      }
      return { zone, dmg: s.stats!.direct };
    };
    const head = hit('head', 1);
    const body = hit('torso', 1);
    expect(head.zone[0]).toMatch(/^head:/);
    expect(body.zone[0]).toMatch(/^body:/);
    expect(head.dmg).toBeGreaterThan(28);
    expect(head.dmg).toBeLessThanOrEqual(ZONE_DAMAGE.head);
    expect(body.dmg).toBeGreaterThan(15);
    expect(body.dmg).toBeLessThanOrEqual(ZONE_DAMAGE.body);
    // a slow arrow hurts less
    expect(hit('torso', 0).dmg).toBeLessThan(body.dmg);
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
    // a heavy rock: a lot of damage, but never more than the trap cap
    expect(s.stats!.env).toBeGreaterThan(40);
    expect(s.stats!.env).toBeLessThanOrEqual(TRAP_CAP);
    expect(s.fighters[1].alive).toBe(true);
  });

  it('a trap never K.O.s a fighter at full HP: two rocks and a barrel in one shot still stop at the cap', () => {
    const lv = arena(
      [
        { id: 'rock', shape: 'box', x: 10, y: -5, w: 1.2, h: 1.2, mat: 'stone', look: 'stoneBlock' },
        { id: 'rock2', shape: 'box', x: 10.2, y: -7, w: 1.2, h: 1.2, mat: 'stone', look: 'stoneBlock' },
        { id: 'tnt', shape: 'box', x: 9.2, y: -0.5, w: 0.8, h: 1, mat: 'barrel', look: 'barrelTnt' },
      ],
      [{ id: 'r', anchor: { x: 10, y: -8.5 }, body: 'rock', local: { x: 0, y: -0.6 } }],
    );
    const s = new Sim(lv, 1);
    s.warmUp();
    const aim = aimsAt(s, 0, { x: 9.2, y: -0.5 }).find((a) => a.angle > -0.8)!;
    s.fire(0, aim.angle, aim.power, 'fire');
    run(s, 6);
    expect(s.stats!.envTo[1]).toBeLessThanOrEqual(TRAP_CAP);
    expect(s.fighters[1].hp).toBeGreaterThanOrEqual(100 - TRAP_CAP);
    expect(s.fighters[1].alive).toBe(true);
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

  it('falling out of the world costs HP and puts the fighter back on their spot', () => {
    const s = new Sim(arena(), 1);
    s.warmUp();
    for (const p of s.fighters[1].rag.parts) p.body.setTransform({ x: p.body.getPosition().x + 30, y: p.body.getPosition().y }, p.body.getAngle());
    run(s, 4);
    expect(s.fighters[1].alive).toBe(true);
    expect(s.fighters[1].hp).toBe(100 - HAZARD_DAMAGE);
    expect(Math.abs(s.fighters[1].rag.torso.getPosition().x - 10)).toBeLessThan(1);
  });

  it('segment distance helper', () => {
    expect(segSegDist({ x: 0, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 }, { x: 2, y: 0 })).toBe(0);
    expect(segSegDist({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 })).toBeCloseTo(1);
  });
});
