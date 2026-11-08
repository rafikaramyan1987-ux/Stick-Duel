/**
 * Headless playtest bot: plays the real duel logic (Duel + Planck ragdolls + the
 * game's AI) with a simulated human on the left.
 *
 * How the "human" aims — only with what a player can see:
 * - the dotted preview: the start of the flight *without wind*, for the level's
 *   preview time. The bot plans its shot from that no-wind arc and has to guess
 *   the rest, so its error grows with the part of the flight it cannot see;
 * - the wind arrow: it compensates only a fraction of it (by profile);
 * - the scenery: it avoids obvious obstacles (it can see them);
 * - its previous shot: it corrects part of its last miss, like a player does.
 * It uses the default weapon (bow) and takes a few seconds per turn to aim
 * (the simulation keeps running meanwhile, so duel lengths are realistic).
 */
import { solveAim } from '../../src/core/ai';
import { makeBlocker, segShape } from '../../src/core/geometry';
import type { Vec } from '../../src/core/math';
import { Rng } from '../../src/core/rng';
import { launch, SIM_DT, speedFor, step } from '../../src/core/trajectory';
import { WEAPONS } from '../../src/core/weapons';
import { Duel, type FighterSetup } from '../../src/game/duel';
import { generateLevel, type LevelDef } from '../../src/game/levels';
import { clamp } from '../../src/core/math';

export interface Profile {
  name: 'beginner' | 'average' | 'good';
  /** Aim noise (rad) and power noise (fraction of speed), for a fully visible flight. */
  angleSd: number;
  powerSd: number;
  /** How much of the unseen part of the flight adds to the error. */
  guessSd: number;
  /** Fraction of the wind compensated. */
  windComp: number;
  /** Fraction of the last miss corrected on the next shot. */
  correct: number;
  /** Seconds spent aiming per turn (mean). */
  think: number;
  /** Chance to go for the head. */
  head: number;
  /** Chance to go for a floating bonus when one is around. */
  bonus: number;
}

export const PROFILES: Profile[] = [
  { name: 'beginner', angleSd: 0.06, powerSd: 0.08, guessSd: 0.9, windComp: 0.2, correct: 0.45, think: 6, head: 0, bonus: 0.1 },
  { name: 'average', angleSd: 0.035, powerSd: 0.05, guessSd: 0.6, windComp: 0.55, correct: 0.65, think: 4.5, head: 0.1, bonus: 0.15 },
  { name: 'good', angleSd: 0.018, powerSd: 0.028, guessSd: 0.35, windComp: 0.85, correct: 0.8, think: 3.5, head: 0.3, bonus: 0.2 },
];

export interface DuelStats {
  won: boolean;
  turns: number;
  seconds: number;
  playerShots: number;
  blockedNear: number;
  aiTurns: number;
  aiDamage: number;
  aiHeadshots: number;
  aiFirstShotHit: boolean;
  playerHits: number;
  /** The duel ended by a ring-out (player / AI fell off). */
  playerRingOut: boolean;
  aiRingOut: boolean;
  bonusHits: number;
}

const hero = (L: LevelDef, hp?: number): FighterSetup => ({ look: 'hero', hat: 'none', color: 'blue', weapons: ['bow'], weapon: 'bow', hp: hp ?? L.playerHp, maxHp: L.playerHp, ai: false });

/** Plays one duel. `playerHp` lets Endless carry HP over between waves. */
export function playDuel(L: LevelDef, prof: Profile, seed: number, playerHp?: number): DuelStats & { hpLeft: number } {
  const rng = new Rng(seed);
  const duel = new Duel(L, {
    mode: 'adventure',
    left: hero(L, playerHp),
    right: { look: L.enemy.kind, hat: 'none', color: 'red', weapons: L.enemy.weapons, weapon: L.enemy.weapons[0] ?? 'bow', hp: L.enemy.hp, ai: true, scale: L.enemy.scale, boss: L.enemy.boss },
    seed,
  });
  const st: DuelStats = { won: false, turns: 0, seconds: 0, playerShots: 0, blockedNear: 0, aiTurns: 0, aiDamage: 0, aiHeadshots: 0, aiFirstShotHit: false, playerHits: 0, playerRingOut: false, aiRingOut: false, bonusHits: 0 };
  let aiShotIndex = 0;
  duel.on((e) => {
    if (e.type === 'hit' && e.side === 0) {
      st.aiDamage += e.dmg;
      if (e.zone === 'head') st.aiHeadshots++;
      if (aiShotIndex === 1) st.aiFirstShotHit = true;
    }
    if (e.type === 'fall' && e.side === 0) st.aiDamage += e.dmg;
    if (e.type === 'hit' && e.side === 1) st.playerHits++;
    if (e.type === 'fire' && e.side === 1) {
      aiShotIndex++;
      st.aiTurns++;
    }
  });
  duel.start();
  const blocked = makeBlocker(L.solids.map((s) => s.shape));
  let bias: Vec = { x: 0, y: 0 };
  let thinking = 0;
  let slowExtra = 0;
  const dt = 1 / 60;
  for (let t = 0; t < 900 && duel.phase !== 'over'; t += dt) {
    if (duel.humanAiming) {
      // the human aims for a few seconds; nothing happens meanwhile, so that time is
      // added to the duel length instead of being simulated tick by tick
      thinking += Math.min(18, Math.max(1.5, prof.think + rng.gauss() * 1.2));
      const planned = plan(duel, prof, rng, bias, blocked);
      const me = duel.fighters[0];
      const foe = duel.fighters[1];
      const from = me.launchPoint(planned.angle);
      const speed = speedFor(planned.power, me.def);
      const res = traceShot(from, planned.angle, speed, duel.wind, L, foe.center());
      if (res.blockedAt && Math.abs(res.blockedAt.x - me.rag.homeX) < 4) st.blockedNear++;
      // remember how far off it was (at the target's x), to correct next time
      if (!res.blockedAt || Math.abs(res.blockedAt.x - foe.center().x) < 2) bias = { x: 0, y: bias.y * (1 - prof.correct) + res.missY * prof.correct };
      duel.setAim(planned.angle, planned.power);
      duel.fire();
      st.playerShots++;
    }
    // slow motion (kill cam, headshots) takes real time too
    slowExtra += dt / duel.timeScale - dt;
    duel.update(dt);
  }
  st.won = duel.winner === 0;
  st.turns = duel.turnNumber;
  st.seconds = duel.time + thinking + slowExtra;
  st.playerRingOut = duel.fighters[0].ringedOut;
  st.aiRingOut = duel.fighters[1].ringedOut;
  st.bonusHits = duel.fighters[0].bonuses;
  return { ...st, hpLeft: duel.fighters[0].hp };
}

/** The human's plan: the shot that looks right from the preview, plus human error. */
function plan(duel: Duel, prof: Profile, rng: Rng, bias: Vec, blocked: (ax: number, ay: number, bx: number, by: number) => boolean): { angle: number; power: number } {
  const me = duel.fighters[0];
  const foe = duel.fighters[1];
  const w = me.def;
  const aimHead = rng.chance(prof.head);
  let c: Vec = aimHead ? foe.rag.head.getPosition() : foe.center();
  // like a player, sometimes go for a floating bonus
  const bonus = duel.bonuses.find((b) => b.alive);
  if (bonus && !me.power && rng.chance(prof.bonus)) c = { x: bonus.x, y: bonus.y };
  // aim point corrected by part of the last miss
  const target = { x: c.x, y: c.y - bias.y };
  const wind = duel.wind * prof.windComp;
  const from = me.launchPoint(me.restAngle());
  let sol = solveAim({ from, target, weapon: w, wind, blocked });
  sol = solveAim({ from: me.launchPoint(sol.angle), target, weapon: w, wind, blocked });
  // how much of the flight the preview shows
  const flight = Math.max(0.3, Math.abs(foe.center().x - from.x) / Math.max(1, Math.abs(Math.cos(sol.angle) * sol.speed)));
  const seen = Math.min(1, (duel.level.preview * (0.5 + sol.power * 0.7)) / flight);
  const k = 1 + prof.guessSd * (1 - seen) * 2;
  const angle = sol.angle + rng.gauss() * prof.angleSd * k;
  const power = Math.max(0.1, Math.min(1, sol.power + rng.gauss() * prof.powerSd * k));
  return { angle, power };
}

/** Real flight of a planned shot against the scenery; vertical miss at the target. */
export function traceShot(from: Vec, angle: number, speed: number, wind: number, L: LevelDef, target: Vec): { blockedAt: Vec | null; missY: number } {
  const f = launch(from, angle, speed);
  const w = WEAPONS.bow;
  let missY = 0;
  let crossed = false;
  const dir = Math.sign(target.x - from.x) || 1;
  for (let i = 0; i < 240 * 6; i++) {
    const ax = f.x;
    const ay = f.y;
    step(f, w, { wind }, SIM_DT);
    if (!crossed && (f.x - target.x) * dir >= 0) {
      crossed = true;
      missY = f.y - target.y;
    }
    for (const s of L.solids) {
      if (segShape(ax, ay, f.x, f.y, s.shape)) {
        if (!crossed) missY = (f.y - target.y) + (target.x - f.x) * dir * 0.5;
        return { blockedAt: { x: f.x, y: f.y }, missY: crossed ? missY : Math.min(missY, 6) };
      }
    }
    if (f.y > L.floor.y + 1) break;
  }
  if (!crossed) missY = 4;
  return { blockedAt: null, missY };
}

export interface LevelReport {
  world: number;
  level: number;
  boss: boolean;
  rows: Record<Profile['name'], { win: number; turns: number; seconds: number; blockedNear: number; aiDmgPerTurn: number; aiHeadshots: number; aiFirstHit: number; hitRate: number; ringOutWin: number; ringOutLoss: number; bonusHits: number }>;
}

export function runLevel(world: number, level: number, runs: number, seedBase = 1): LevelReport {
  const L = generateLevel(world, level);
  const rows = {} as LevelReport['rows'];
  for (const p of PROFILES) {
    const all: DuelStats[] = [];
    for (let i = 0; i < runs; i++) all.push(playDuel(L, p, seedBase * 1000 + i * 7919 + world * 31 + level));
    const shots = all.reduce((a, s) => a + s.playerShots, 0);
    const aiTurns = all.reduce((a, s) => a + s.aiTurns, 0);
    rows[p.name] = {
      win: all.filter((s) => s.won).length / runs,
      turns: avg(all.map((s) => s.turns)),
      seconds: avg(all.map((s) => s.seconds)),
      blockedNear: shots ? all.reduce((a, s) => a + s.blockedNear, 0) / shots : 0,
      aiDmgPerTurn: aiTurns ? all.reduce((a, s) => a + s.aiDamage, 0) / aiTurns : 0,
      aiHeadshots: all.reduce((a, s) => a + s.aiHeadshots, 0),
      aiFirstHit: all.filter((s) => s.aiFirstShotHit).length / runs,
      hitRate: shots ? all.reduce((a, s) => a + s.playerHits, 0) / shots : 0,
      ringOutWin: all.filter((s) => s.aiRingOut).length / runs,
      ringOutLoss: all.filter((s) => s.playerRingOut).length / runs,
      bonusHits: avg(all.map((s) => s.bonusHits)),
    };
  }
  return { world, level, boss: L.boss, rows };
}

/** Endless: waves until defeat (capped), HP carried over with the same heal as the game. */
export function runEndless(runs: number, maxWaves = 25): Record<Profile['name'], { waves: number; seconds: number }> {
  const out = {} as Record<Profile['name'], { waves: number; seconds: number }>;
  for (const p of PROFILES) {
    const waves: number[] = [];
    const secs: number[] = [];
    for (let r = 0; r < runs; r++) {
      const rng = new Rng(9000 + r);
      let hp = -1;
      let wave = 0;
      for (; wave < maxWaves; wave++) {
        // same rule as the game's Endless mode (all worlds open)
        const L = generateLevel(1 + rng.int(0, 5), clamp(2 + Math.floor(wave * 0.8), 2, 9), { seed: rng.int(1, 1e9), forceBoss: false });
        const res = playDuel(L, p, rng.int(1, 1e9), hp < 0 ? undefined : hp);
        secs.push(res.seconds);
        if (!res.won) break;
        hp = Math.min(L.playerHp, res.hpLeft + 25);
      }
      waves.push(wave);
    }
    out[p.name] = { waves: avg(waves), seconds: avg(secs) };
  }
  return out;
}

const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
