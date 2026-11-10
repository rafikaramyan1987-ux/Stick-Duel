import type { Vec } from '../core/math';
import { Rng } from '../core/rng';
import { AMMO_ORDER, Duel } from '../game/duel';
import { aimsAt } from '../physics/aim';
import { TRAP_CAP } from '../physics/sim';
import type { AmmoId, LevelDef } from './types';

/**
 * Level checker. Bots play every level as a real duel: the same Duel the game uses (rival turns
 * and rival AI included, fixed 60 Hz step, fixed seed), from the first shot to the K.O.
 *
 * - The "sharp" bot: every turn it tries every candidate shot on a copy of the game (aimed at the
 *   rival's head and body, every rope, every named body and the water, flat and lobbed, several
 *   speeds, every ammo it has), plays the best one for real, and goes on until the duel is over.
 *   Its real playthrough is the proof that the level can be won (and the e2e tests replay it).
 * - "Human" bots: the same choices with aim and power errors like a player's (several seeds). The
 *   average length of their winning duels must be at least 4 player shots.
 * - Traps: every candidate shot measures the damage the environment did to each fighter in one
 *   shot; it must never be more than 80, so a trap alone never K.O.s a fighter at full HP.
 */
export interface Shot {
  ammo: AmmoId;
  angle: number;
  power: number;
  target: string;
}

export interface DuelRun {
  win: boolean;
  shots: Shot[];
  playerHp: number;
  rivalHp: number;
  stars: number;
  trapKill: boolean;
  chain: boolean;
}

export interface LevelCheck {
  id: string;
  rivalHp: number;
  /** The sharp bot's winning duel (null = it did not win). */
  solution: Shot[] | null;
  sharp: DuelRun;
  humans: DuelRun[];
  /** Average player shots of the human bots' winning duels. */
  avgShots: number;
  /** Most damage the environment did to one fighter in one shot (any candidate, any run). */
  maxTrap: number;
  /** Most trap damage dealt to the rival in one shot, and how. */
  bestTrap: { damage: number; target: string };
  sims: number;
  ms: number;
}

/** Human-like aim errors. */
export const HUMAN_ANGLE_ERR = 0.03;
export const HUMAN_POWER_ERR = 0.035;
export const HUMAN_RUNS = 5;

const MAX_TURN_STEPS = 60 * 40;
const MAX_SHOTS = 24;

type Outcome = 'win' | 'lose' | 'continue' | 'invalid';

/** Fires a shot and runs the game until it is the player's turn again (or the duel is over). */
export function playShot(d: Duel, s: Shot, stopAfterPlayer = false): Outcome {
  if ((d.ammo[s.ammo] ?? 0) <= 0 || !d.selectAmmo(s.ammo)) return 'invalid';
  d.setAim(s.angle, s.power);
  if (!d.fire()) return 'invalid';
  for (let i = 0; i < MAX_TURN_STEPS; i++) {
    d.update(1 / 60);
    if (d.phase === 'over') return d.result?.win ? 'win' : 'lose';
    if (d.phase === 'aim') return 'continue';
    if (stopAfterPlayer && d.phase === 'rivalAim') return 'continue';
  }
  return 'lose';
}

/** Replays a shot list from the start: true if it wins with exactly these shots. */
export function verify(level: LevelDef, shots: Shot[], seed = 1): boolean {
  const d = new Duel(level, seed, { headless: true });
  for (let i = 0; i < shots.length; i++) {
    const r = playShot(d, shots[i]!);
    if (r === 'win') return i === shots.length - 1;
    if (r !== 'continue') return false;
  }
  return false;
}

function targets(d: Duel): Array<{ name: string; p: Vec }> {
  const s = d.sim;
  const out: Array<{ name: string; p: Vec }> = [];
  const r = s.fighters[1].rag;
  out.push({ name: 'rival head', p: { x: r.head.getPosition().x, y: r.head.getPosition().y } });
  out.push({ name: 'rival', p: { x: r.torso.getPosition().x, y: r.torso.getPosition().y } });
  // the player's own side (own cover, the traps over the player) is never worth a shot
  const mid = d.level.player.x + (d.level.rival.x > d.level.player.x ? 2.8 : -2.8);
  for (const rope of s.ropes) {
    if (!rope.joint) continue;
    const [a, b] = s.ropeEnds(rope);
    if (Math.max(a.x, b.x) < mid) continue; // (levels: the player is on the left)
    for (const k of [0.35, 0.65]) out.push({ name: `rope ${rope.id}`, p: { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k } });
  }
  for (const e of s.ents) {
    if (e.dead || !e.name) continue;
    const p = e.body.getPosition();
    if (p.x < mid) continue;
    out.push({ name: e.name, p: { x: p.x, y: p.y } });
  }
  for (const w of s.water) if (!w.frozen) out.push({ name: 'water', p: { x: (w.x0 + w.x1) / 2, y: w.y + 0.05 } });
  return out;
}

export function candidates(d: Duel): Shot[] {
  const out: Shot[] = [];
  const seen = new Set<string>();
  const ammo = AMMO_ORDER.filter((a) => (d.ammo[a] ?? 0) > 0);
  for (const t of targets(d)) {
    for (const a of ammo) {
      // special ammo only where it can matter: on things (not on the rival) or bombs near the rival
      if (a !== 'arrow' && t.name.startsWith('rival') && a !== 'heavy' && a !== 'bomb') continue;
      for (const aim of aimsAt(d.sim, 0, t.p, [12, 15.5, 18.5, 21])) {
        const k = `${a}|${aim.angle.toFixed(3)}|${aim.power.toFixed(2)}`;
        if (seen.has(k)) continue;
        seen.add(k);
        out.push({ ammo: a, angle: aim.angle, power: aim.power, target: t.name });
      }
    }
  }
  return out;
}

interface Eval {
  shot: Shot;
  score: number;
}

export class Stats {
  sims = 0;
  maxTrap = 0;
  bestTrap = { damage: 0, target: '' };
}

/** Plays one candidate on a copy (the player's shot only) and scores it. */
export function evaluate(base: Duel, c: Shot, st: Stats): Eval | null {
  const d = base.clone();
  st.sims++;
  if (playShot(d, c, true) === 'invalid') return null;
  const s = d.sim.stats;
  const env = s ? Math.max(...s.envTo) : 0;
  st.maxTrap = Math.max(st.maxTrap, env);
  if (s && s.envTo[1] > st.bestTrap.damage) st.bestTrap = { damage: s.envTo[1], target: `${c.ammo} → ${c.target}` };
  const before = base.sim.fighters;
  const after = d.sim.fighters;
  const dealt = before[1].hp - after[1].hp;
  const taken = before[0].hp - after[0].hp;
  let score = dealt * 1 - taken * 1.5;
  if (!after[1].alive) score += 1000;
  if (!after[0].alive) score -= 1000;
  // progress on the arena: broken cover, cut ropes, fire, explosions (a trap set up for later)
  if (s) score += s.breaks * 3 + s.ropes * 4 + s.explosions * 3 + s.ignites * 2;
  // special ammo is worth keeping for when it matters
  if (c.ammo !== 'arrow') score -= 4;
  return { shot: c, score };
}

/** Plays a whole duel. `noise` = null for the sharp bot, else the human errors' random source. */
export function playDuel(level: LevelDef, st: Stats, noise: Rng | null, seed = 1, log?: (d: Duel) => void): DuelRun {
  const d = new Duel(level, seed, { headless: true });
  log?.(d);
  const shots: Shot[] = [];
  let out: Outcome = 'continue';
  while (out === 'continue' && shots.length < MAX_SHOTS) {
    const evals = candidates(d)
      .map((c) => evaluate(d, c, st))
      .filter((e): e is Eval => !!e)
      .sort((a, b) => b.score - a.score);
    const best = evals[0];
    if (!best) break;
    let shot = best.shot;
    if (noise) {
      // a human does not always see the best shot, and never aims perfectly
      const pick = evals[Math.min(evals.length - 1, noise.chance(0.25) ? 1 : 0)]!.shot;
      shot = { ...pick, angle: pick.angle + noise.gauss() * HUMAN_ANGLE_ERR, power: Math.min(1, Math.max(0, pick.power + noise.gauss() * HUMAN_POWER_ERR)) };
    }
    out = playShot(d, shot, false);
    shots.push(shot);
    const s = d.sim.stats;
    if (s) st.maxTrap = Math.max(st.maxTrap, ...s.envTo);
  }
  const r = d.result;
  return {
    win: out === 'win',
    shots,
    playerHp: d.sim.fighters[0].hp,
    rivalHp: d.sim.fighters[1].hp,
    stars: r ? r.stars.filter(Boolean).length : 0,
    trapKill: !!r?.trapKill,
    chain: !!r?.chain,
  };
}

export function checkLevel(level: LevelDef, opts: { humans?: number } = {}): LevelCheck {
  const t0 = Date.now();
  const st = new Stats();
  let sharp = playDuel(level, st, null);
  // the sharp bot's real playthrough is the proof; make sure it replays exactly
  if (sharp.win && !verify(level, sharp.shots)) sharp = { ...sharp, win: false };
  const humans: DuelRun[] = [];
  for (let i = 0; i < (opts.humans ?? HUMAN_RUNS); i++) humans.push(playDuel(level, st, new Rng(1000 + i * 77), 1 + i));
  // the human bots' wins say how long a duel lasts (the sharp bot only if no human won)
  const hw = humans.filter((r) => r.win);
  const wins = hw.length ? hw : [sharp].filter((r) => r.win);
  const avgShots = wins.length ? wins.reduce((n, r) => n + r.shots.length, 0) / wins.length : 0;
  return {
    id: level.id,
    rivalHp: level.rival.hp,
    solution: sharp.win ? sharp.shots : null,
    sharp,
    humans,
    avgShots,
    maxTrap: st.maxTrap,
    bestTrap: st.bestTrap,
    sims: st.sims,
    ms: Date.now() - t0,
  };
}

export { TRAP_CAP };
