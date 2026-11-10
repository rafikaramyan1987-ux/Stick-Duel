import type { Vec } from '../core/math';
import { AMMO_ORDER, Duel } from '../game/duel';
import { aimsAt } from '../physics/aim';
import { AMMO } from '../physics/sim';
import type { AmmoId, LevelDef } from './types';

/**
 * Level checker bot. It plays a level with the real game rules (the same Duel the game uses,
 * rival turns included, fixed 60 Hz step, fixed seed), searching aim angles, power and ammo:
 *
 * - every candidate first shot is tried, so it knows whether a one-shot win exists;
 * - a beam search over the most promising states looks for a win within par;
 * - every win it finds is replayed from scratch, shot by shot, before it counts;
 * - a direct-hit-only strategy (every shot aimed at the rival) is played too, and the maximum
 *   damage direct hits could ever do is compared with the rival's HP.
 *
 * Candidates: shots aimed (ballistic solve, flat and lobbed, several speeds) at every rope, every
 * named body and the rival, plus a coarse grid of angles × powers, for every ammo type left.
 */
export interface Shot {
  ammo: AmmoId;
  angle: number;
  power: number;
  target: string;
}

export interface LevelCheck {
  id: string;
  par: number;
  shots: number;
  rivalHp: number;
  solution: Shot[] | null;
  /** A first shot that wins on its own (null = none among all candidates). */
  oneShot: Shot | null;
  directOnly: { win: boolean; damage: number };
  /** Most damage direct hits could do with all the level's ammo (all head hits). */
  directBound: number;
  /** Most damage a single first shot did (and with what). */
  bestSingle: { damage: number; shot: Shot | null };
  sims: number;
  ms: number;
}

const MAX_TURN_STEPS = 60 * 40;

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

/** Replays a whole solution from the start: true if it wins with exactly these shots. */
export function verify(level: LevelDef, shots: Shot[]): boolean {
  const d = new Duel(level, 1, { headless: true });
  for (let i = 0; i < shots.length; i++) {
    const r = playShot(d, shots[i]!);
    if (r === 'win') return i === shots.length - 1;
    if (r !== 'continue') return false;
  }
  return false;
}

/**
 * A win found on a copied state can miss by a hair when replayed for real (copies drift a little).
 * Replay the earlier shots exactly and try small variations of the last one, each verified from scratch.
 */
function refine(level: LevelDef, path: Shot[]): Shot[] | null {
  const last = path[path.length - 1]!;
  const prefix = path.slice(0, -1);
  for (const da of [0, -0.01, 0.01, -0.02, 0.02, -0.035, 0.035]) {
    for (const dp of [0, -0.02, 0.02, -0.04, 0.04]) {
      const cand = [...prefix, { ...last, angle: last.angle + da, power: Math.min(1, Math.max(0, last.power + dp)) }];
      if (verify(level, cand)) return cand;
    }
  }
  return null;
}

function targets(d: Duel): Array<{ name: string; p: Vec }> {
  const s = d.sim;
  const out: Array<{ name: string; p: Vec }> = [];
  for (const r of s.ropes) {
    if (!r.joint) continue;
    const [a, b] = s.ropeEnds(r);
    for (const k of [0.3, 0.6]) out.push({ name: `rope ${r.id}`, p: { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k } });
  }
  for (const e of s.ents) {
    if (e.dead || !e.name) continue;
    const p = e.body.getPosition();
    out.push({ name: e.name, p: { x: p.x, y: p.y } });
    out.push({ name: `${e.name} top`, p: { x: p.x, y: p.y - e.desc.h * 0.35 } });
  }
  for (const w of s.water) if (!w.frozen) out.push({ name: 'water', p: { x: (w.x0 + w.x1) / 2, y: w.y + 0.05 } });
  const r = s.fighters[1].rag;
  out.push({ name: 'rival', p: { x: r.torso.getPosition().x, y: r.torso.getPosition().y } });
  out.push({ name: 'rival head', p: { x: r.head.getPosition().x, y: r.head.getPosition().y } });
  return out;
}

export function candidates(d: Duel, grid: boolean): Shot[] {
  const out: Shot[] = [];
  const seen = new Set<string>();
  const add = (s: Shot) => {
    const k = `${s.ammo}|${s.angle.toFixed(2)}|${s.power.toFixed(2)}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push(s);
  };
  const ammo = AMMO_ORDER.filter((a) => (d.ammo[a] ?? 0) > 0);
  const tg = targets(d);
  for (const a of ammo) {
    for (const t of tg) {
      for (const aim of aimsAt(d.sim, 0, t.p, [10, 14, 18, 21])) add({ ammo: a, angle: aim.angle, power: aim.power, target: t.name });
    }
  }
  if (grid) {
    const f = d.facing;
    for (const a of ammo) {
      for (let up = -0.2; up <= 1.45; up += 0.15) {
        for (const power of [0.35, 0.6, 0.85, 1]) add({ ammo: a, angle: f === 1 ? -up : -Math.PI + up, power, target: 'grid' });
      }
    }
  }
  return out;
}

function score(d: Duel, before: Duel): number {
  const r = d.sim.fighters[1];
  const p = d.sim.fighters[0];
  const st = d.sim.stats;
  // environmental damage and changes to the arena count; direct hits barely (they never win a level)
  let s = -(before.sim.fighters[0].hp - p.hp) * 0.5;
  if (st && st.side === 0) s += st.env * 4 + st.direct * 0.3 + st.ropes * 6 + st.breaks * 4 + st.explosions * 6 + st.ignites * 5;
  else s += (before.sim.fighters[1].hp - r.hp) * 2;
  s += d.sim.water.filter((w) => w.frozen).length * 8 - before.sim.water.filter((w) => w.frozen).length * 8;
  // hazards that moved closer to the rival
  const rp = r.rag.torso.getPosition();
  for (const e of d.sim.ents) {
    if (e.dead || e.desc.fixed) continue;
    const q = e.body.getPosition();
    const dist = Math.hypot(q.x - rp.x, q.y - rp.y);
    if (dist < 2.5) s += (2.5 - dist) * Math.min(4, e.body.getMass() * 0.05);
  }
  return s;
}

/** Plays every shot at the rival with the ammo that hurts most directly. */
function directOnly(level: LevelDef): { win: boolean; damage: number } {
  const d = new Duel(level, 1, { headless: true });
  const start = d.sim.fighters[1].hp;
  for (let i = 0; i < 20; i++) {
    const ammo = AMMO_ORDER.filter((a) => (d.ammo[a] ?? 0) > 0 && a !== 'bomb' && a !== 'fire').sort((a, b) => AMMO[b].direct - AMMO[a].direct)[0];
    if (!ammo) break;
    const head = d.sim.fighters[1].rag.head.getPosition();
    const aims = aimsAt(d.sim, 0, { x: head.x, y: head.y }, [12, 16, 21]);
    const aim = aims[0];
    if (!aim) break;
    const r = playShot(d, { ammo, angle: aim.angle, power: aim.power, target: 'rival head' });
    // a win only counts as "direct only" if every point of damage came from the arrows themselves
    if (r === 'win') return { win: d.directOnRival >= start, damage: start };
    if (r !== 'continue') break;
  }
  return { win: false, damage: start - d.sim.fighters[1].hp };
}

/** Raw damage each first shot does (rival HP raised out of reach), best per target. */
export function measure(level: LevelDef): Array<{ target: string; damage: number; shot: Shot }> {
  const lv: LevelDef = { ...level, rival: { ...level.rival, hp: 9999 } };
  const base = new Duel(lv, 1, { headless: true });
  const best = new Map<string, { target: string; damage: number; shot: Shot }>();
  for (const c of candidates(base, true)) {
    // the player's shot only (no rival turn)
    const d = new Duel(lv, 1, { headless: true });
    d.sim.fire(0, c.angle, c.power, c.ammo);
    for (let i = 0; i < 60 * 8; i++) {
      d.sim.step();
      if (i > 60 && d.sim.isSettled()) break;
    }
    const dmg = 9999 - d.sim.fighters[1].hp;
    const key = c.target.replace(/ top$/, '');
    if (dmg > (best.get(key)?.damage ?? -1)) best.set(key, { target: key, damage: dmg, shot: c });
  }
  return [...best.values()].filter((b) => b.damage > 0).sort((a, b) => b.damage - a.damage);
}

export function checkLevel(level: LevelDef, opts: { beam?: number; maxDepth?: number } = {}): LevelCheck {
  const t0 = Date.now();
  const beam = opts.beam ?? 14;
  const maxDepth = opts.maxDepth ?? level.par;
  const base = new Duel(level, 1, { headless: true });
  let sims = 0;
  let oneShot: Shot | null = null;
  const bestSingle: LevelCheck['bestSingle'] = { damage: 0, shot: null };
  const rivalStart = base.sim.fighters[1].hp;
  let solution: Shot[] | null = null;
  let frontier: Array<{ d: Duel; path: Shot[]; score: number }> = [{ d: base, path: [], score: 0 }];
  for (let depth = 1; depth <= maxDepth && !solution; depth++) {
    const next: Array<{ d: Duel; path: Shot[]; score: number }> = [];
    for (const node of frontier) {
      for (const c of candidates(node.d, depth === 1)) {
        // first shots run on a fresh duel (exactly the game); deeper ones on copies (verified after)
        const child = depth === 1 ? new Duel(level, 1, { headless: true }) : node.d.clone();
        sims++;
        const r = playShot(child, c);
        if (depth === 1) {
          const dmg = rivalStart - child.sim.fighters[1].hp;
          if (dmg > bestSingle.damage) {
            bestSingle.damage = dmg;
            bestSingle.shot = c;
          }
        }
        if (r === 'win') {
          const path = [...node.path, c];
          if (depth === 1 && !oneShot) oneShot = c;
          if (!solution && path.length <= level.par) solution = verify(level, path) ? path : path.length > 1 ? refine(level, path) : null;
          if (depth === 1) continue; // keep scanning: every first shot is tried
          if (solution) break;
        } else if (r === 'continue') {
          next.push({ d: child, path: [...node.path, c], score: node.score + score(child, node.d) });
        }
      }
      if (solution && depth > 1) break;
    }
    next.sort((a, b) => b.score - a.score);
    // keep different plans in the beam: the best state of every distinct sequence of targets first,
    // then the next best ones (so "burn the roof first" is not crowded out by ten ways to cut a rope)
    const picked: typeof next = [];
    const seenKeys = new Set<string>();
    const keyOf = (n: (typeof next)[number]) => n.path.map((s) => `${s.ammo}@${s.target.replace(/ top$/, '')}`).join('>');
    const width = depth === 1 ? beam : Math.round(beam * 0.7);
    for (const n of next) {
      if (picked.length >= width + (depth === 1 ? 10 : 0)) break;
      const k = keyOf(n);
      if (seenKeys.has(k)) continue;
      seenKeys.add(k);
      picked.push(n);
    }
    for (const n of next) {
      if (picked.length >= beam) break;
      if (!picked.includes(n)) picked.push(n);
    }
    frontier = picked;
  }
  let bound = 0;
  for (const a of AMMO_ORDER) bound += AMMO[a].direct * 1.5 * (level.ammo[a] ?? 0);
  return {
    id: level.id,
    par: level.par,
    shots: level.shots,
    rivalHp: level.rival.hp,
    solution,
    oneShot,
    directOnly: directOnly(level),
    directBound: bound,
    bestSingle,
    sims,
    ms: Date.now() - t0,
  };
}
