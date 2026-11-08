import { describe, expect, it } from 'vitest';
import { Duel, type DuelEvent, type FighterSetup } from '../../src/game/duel';
import { generateLevel } from '../../src/game/levels';

const hero = (ai: boolean): FighterSetup => ({ look: 'hero', hat: 'none', color: 'blue', weapons: ['bow'], weapon: 'bow', hp: 100, ai });

function play(duel: Duel, maxSeconds: number, events: DuelEvent[]) {
  duel.on((e) => events.push(e));
  duel.start();
  for (let t = 0; t < maxSeconds && duel.phase !== 'over'; t += 1 / 60) {
    if (duel.humanAiming) {
      const s = duel.autoShot();
      if (s) {
        duel.setAim(s.angle, s.power);
        duel.fire();
      }
    }
    duel.update(1 / 60);
  }
}

describe('duel', () => {
  it('a perfect first shot hits the enemy on level 1', () => {
    const L = generateLevel(1, 1);
    const duel = new Duel(L, { mode: 'adventure', left: hero(false), right: { ...hero(true), look: 'ranger', hp: L.enemy.hp } });
    const events: DuelEvent[] = [];
    duel.on((e) => events.push(e));
    duel.start();
    const s = duel.autoShot()!;
    duel.setAim(s.angle, s.power);
    expect(duel.fire()).toBe(true);
    for (let i = 0; i < 400 && duel.phase === 'flight'; i++) duel.update(1 / 60);
    const hit = events.find((e) => e.type === 'hit');
    expect(hit, JSON.stringify(events.map((e) => e.type))).toBeTruthy();
    expect(duel.fighters[1].hp).toBeLessThan(L.enemy.hp);
  });

  for (const w of [1, 2, 3, 4, 5, 6]) {
    for (const lvl of [1, 10]) {
      it(`world ${w} level ${lvl}: a duel ends with a winner`, { timeout: 30000 }, () => {
        const L = generateLevel(w, lvl);
        const duel = new Duel(L, {
          mode: 'adventure',
          left: { ...hero(false), weapons: ['bow', 'spear'], weapon: 'spear' },
          right: { ...hero(true), look: L.world.enemy, hp: L.enemy.hp, weapons: L.enemy.weapons, weapon: L.enemy.weapons[0]!, scale: L.enemy.scale },
        });
        const events: DuelEvent[] = [];
        play(duel, 400, events);
        console.info(w, lvl, duel.turnNumber, duel.fighters.map((f) => `${f.hp} ${f.shots}/${f.hits}`).join(" | "));
        expect(duel.phase, `turns ${duel.turnNumber} hp ${duel.fighters.map((f) => f.hp)}`).toBe('over');
        expect(duel.winner).not.toBeNull();
        expect(events.some((e) => e.type === 'hit')).toBe(true);
      });
    }
  }
});

describe('gentle first levels', () => {
  it('the AI misses its first shot and never headshots on levels 1-1 to 1-3', { timeout: 60_000 }, () => {
    for (const lvl of [1, 2, 3]) {
      for (let seed = 1; seed <= 6; seed++) {
        const L = generateLevel(1, lvl);
        const duel = new Duel(L, { mode: 'adventure', left: { ...hero(false), hp: 999 }, right: { ...hero(true), look: 'ranger', hp: 999 }, seed });
        const hits: DuelEvent[] = [];
        let aiShots = 0;
        let firstHit = false;
        duel.on((e) => {
          if (e.type === 'fire' && e.side === 1) aiShots++;
          if (e.type === 'hit' && e.side === 0) {
            hits.push(e);
            if (aiShots === 1) firstHit = true;
          }
        });
        duel.start();
        // the player fires harmless shots straight up so the AI keeps getting turns
        for (let t = 0; t < 90 && aiShots < 6; t += 1 / 60) {
          if (duel.humanAiming) {
            duel.setAim(-Math.PI / 2 + 0.3, 0.1);
            duel.fire();
          }
          duel.update(1 / 60);
        }
        expect(aiShots).toBeGreaterThanOrEqual(3);
        expect(firstHit, `1-${lvl} seed ${seed}`).toBe(false);
        expect(hits.filter((e) => e.type === 'hit' && e.zone === 'head')).toEqual([]);
      }
    }
  });
});

describe('bonuses, power-ups, ring-outs, kill cam', () => {
  const setup = (w: number, l: number, hp = 999) => {
    const L = generateLevel(w, l);
    const duel = new Duel(L, { mode: 'adventure', left: { ...hero(false), hp }, right: { ...hero(true), look: L.world.enemy, hp }, seed: 3 });
    const events: DuelEvent[] = [];
    duel.on((e) => events.push(e));
    duel.start();
    return { L, duel, events };
  };
  const flyOut = (duel: Duel) => {
    for (let i = 0; i < 600 && duel.phase === 'flight'; i++) duel.update(1 / 60);
  };

  it('shooting a bonus rewards the shooter (power-ups, heal, coins)', () => {
    const { duel, events } = setup(1, 5);
    const b = duel.bonuses[0]!;
    const s = duel.autoShotAt({ x: b.x, y: b.y });
    duel.setAim(s.angle, s.power);
    duel.fire();
    flyOut(duel);
    const e = events.find((x) => x.type === 'bonus');
    expect(e).toBeTruthy();
    expect(b.alive).toBe(false);
    const me = duel.fighters[0];
    expect(me.bonuses).toBe(1);
    if (b.def.reward === 'fire' || b.def.reward === 'triple') expect(me.power).toBe(b.def.reward);
    if (b.def.reward === 'coins') expect(me.coins).toBe(b.def.coins);
  });

  it('levels used below have no bonus in the way', () => {
    expect(generateLevel(2, 3).bonuses).toEqual([]);
  });

  it('triple shot fires three projectiles; fire arrows hit harder', () => {
    const { duel } = setup(2, 3);
    duel.fighters[0].power = 'triple';
    const s = duel.autoShot()!;
    duel.setAim(s.angle, s.power);
    duel.fire();
    expect(duel.projectiles).toHaveLength(3);
    expect(duel.fighters[0].power).toBeNull();
    const a = setup(2, 3);
    const b = setup(2, 3);
    b.duel.fighters[0].power = 'fire';
    for (const d of [a, b]) {
      const sh = d.duel.autoShot()!;
      d.duel.setAim(sh.angle, sh.power);
      d.duel.fire();
      flyOut(d.duel);
    }
    const hitA = a.events.find((e) => e.type === 'hit');
    const hitB = b.events.find((e) => e.type === 'hit');
    if (hitA?.type === 'hit' && hitB?.type === 'hit' && hitA.zone === hitB.zone) expect(hitB.dmg).toBeGreaterThan(hitA.dmg);
    if (hitB?.type === 'hit') expect(hitB.fire).toBe(true);
  });

  it('a shield blocks the next hit', () => {
    const { duel, events } = setup(2, 3);
    duel.fighters[1].shield = true;
    const s = duel.autoShot()!;
    duel.setAim(s.angle, s.power);
    duel.fire();
    flyOut(duel);
    expect(events.some((e) => e.type === 'shield')).toBe(true);
    expect(duel.fighters[1].hp).toBe(999);
    expect(duel.fighters[1].shield).toBe(false);
  });

  it('ring-out: a weakened fighter knocked off by a heavy hit is out; never on levels 1-1 to 1-3', () => {
    const push = (duel: Duel) => {
      const r = duel.fighters[1].rag;
      r.hit(3);
      for (const p of r.parts) p.body.applyLinearImpulse({ x: 9 * p.body.getMass(), y: -3 * p.body.getMass() }, p.body.getPosition(), true);
    };
    const run = (duel: Duel, events: DuelEvent[]) => {
      for (let i = 0; i < 400 && !events.some((e) => e.type === 'fall'); i++) duel.update(1 / 60);
      return events.find((e) => e.type === 'fall');
    };
    // weakened + heavy hit: ring-out (instant K.O.), except on the gentle levels
    for (const [w, l, ringOut] of [[6, 5, true], [3, 4, true], [1, 2, false]] as const) {
      const { duel, events, L } = setup(w, l);
      expect(L.ringOut).toBe(ringOut);
      const f = duel.fighters[1];
      f.hp = Math.floor(f.maxHp * 0.4);
      f.lastHeavyHitAt = duel.time;
      push(duel);
      const fall = run(duel, events);
      expect(fall, `${w}-${l}`).toBeTruthy();
      if (fall?.type !== 'fall') continue;
      expect(fall.ringOut).toBe(ringOut);
      expect(f.ko).toBe(ringOut);
    }
    // healthy, or no heavy hit (a slip): small damage and back on the platform
    for (const healthy of [true, false]) {
      const { duel, events } = setup(6, 5);
      const f = duel.fighters[1];
      if (!healthy) f.hp = Math.floor(f.maxHp * 0.4);
      else f.lastHeavyHitAt = duel.time;
      push(duel);
      const fall = run(duel, events);
      expect(fall?.type === 'fall' && fall.ringOut).toBe(false);
      expect(f.ko).toBe(false);
    }
  });

  it('a lethal shot starts the kill cam (slow motion, skippable); a headshot knocks the hat off', () => {
    const { duel, events } = setup(2, 3, 999);
    duel.fighters[1].hp = 3;
    const s = duel.autoShot(true)!;
    duel.setAim(s.angle, s.power);
    duel.fire();
    let slowSeen = false;
    for (let i = 0; i < 600 && duel.phase === 'flight'; i++) {
      duel.update(1 / 60);
      if (duel.killCam) slowSeen ||= duel.timeScale < 1;
    }
    expect(events.some((e) => e.type === 'killcam')).toBe(true);
    expect(slowSeen).toBe(true);
    expect(duel.fighters[1].ko).toBe(true);
    if (events.some((e) => e.type === 'hit' && e.zone === 'head')) {
      expect(events.some((e) => e.type === 'hat')).toBe(true);
      expect(duel.fighters[1].hatLost).toBe(true);
    }
    duel.skipKillCam();
    expect(duel.killCam).toBeNull();
    expect(duel.timeScale).toBe(1);
  });
});
