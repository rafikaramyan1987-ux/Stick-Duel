import { clamp, lerp, type Vec } from './math';
import type { Rng } from './rng';
import { launch, powerFor, simulate, speedFor } from './trajectory';
import type { WeaponDef, WeaponId } from './weapons';

export interface AimProblem {
  from: Vec;
  target: Vec;
  weapon: WeaponDef;
  /** Wind the shooter believes in (m/s²). */
  wind: number;
  /** Return true if segment a→b hits scenery. */
  blocked?: (ax: number, ay: number, bx: number, by: number) => boolean;
}

export interface AimSolution {
  angle: number;
  speed: number;
  power: number;
  /** Closest distance of the simulated flight to the target, metres. */
  miss: number;
}

const BLOCK_PENALTY = 50;

/** Simulates a shot; returns how close it gets to the target and whether scenery stopped it. */
export function trace(p: AimProblem, angle: number, speed: number): { best: number; blocked: boolean } {
  const f = launch(p.from, angle, speed);
  const dir = Math.sign(p.target.x - p.from.x) || 1;
  let best = Infinity;
  let blocked = false;
  const boomerang = p.weapon.boomerang > 0;
  simulate(f, p.weapon, { wind: p.wind }, {
    maxTime: boomerang ? 4.5 : 5,
    every: 1000,
    dt: 1 / 120,
    stop: (ax, ay, bx, by) => {
      const d = Math.hypot(bx - p.target.x, by - p.target.y);
      if (d < best) best = d;
      if (p.blocked?.(ax, ay, bx, by)) {
        blocked = true;
        return true;
      }
      if (!boomerang && (bx - p.target.x) * dir > 1.5) return true;
      return by > p.target.y + 8;
    },
  });
  return { best, blocked };
}

/** Score of a candidate shot: closest distance to the target, heavily penalised if scenery stops it first. */
export function evaluate(p: AimProblem, angle: number, speed: number): number {
  const { best, blocked } = trace(p, angle, speed);
  // blocked only counts if the flight had not already reached the target
  return blocked && best > 0.3 ? BLOCK_PENALTY + best : best;
}

/**
 * Finds a launch angle and speed whose flight passes as close as possible to the
 * target: a coarse grid over angle × speed, then a finer local search.
 */
export function solveAim(p: AimProblem): AimSolution {
  const dir = Math.sign(p.target.x - p.from.x) || 1;
  const toAngle = (up: number) => (dir > 0 ? -up : Math.PI + up);
  const w = p.weapon;
  let best = { up: 0.6, speed: speedFor(0.7, w), miss: Infinity };
  for (let i = 0; i <= 28; i++) {
    const up = lerp(-0.25, 1.3, i / 28);
    for (let j = 0; j <= 18; j++) {
      const speed = lerp(w.speedMin, w.speedMax, j / 18);
      const miss = evaluate(p, toAngle(up), speed);
      // prefer flatter, faster shots when equally good (more readable)
      if (miss < best.miss - 0.02) best = { up, speed, miss };
    }
  }
  let da = 0.03;
  let ds = (w.speedMax - w.speedMin) / 36;
  for (let iter = 0; iter < 4; iter++) {
    const c = { ...best };
    for (let i = -2; i <= 2; i++) {
      for (let j = -2; j <= 2; j++) {
        const up = c.up + i * da;
        const speed = clamp(c.speed + j * ds, w.speedMin, w.speedMax);
        const miss = evaluate(p, toAngle(up), speed);
        if (miss < best.miss) best = { up, speed, miss };
      }
    }
    da /= 2;
    ds /= 2;
  }
  return { angle: toAngle(best.up), speed: best.speed, power: powerFor(best.speed, w), miss: best.miss };
}

/** Standard deviations of the AI's aiming error for a skill 0..1 — never zero. */
export function errorSigma(skill: number): { angle: number; power: number; wind: number } {
  const s = clamp(skill, 0, 1);
  return { angle: lerp(0.17, 0.03, s), power: lerp(0.16, 0.035, s), wind: lerp(0.6, 0.15, s) };
}

/** Applies a human-like error to a perfect solution. */
export function applyError(sol: AimSolution, w: WeaponDef, skill: number, rng: Rng): AimSolution {
  const sig = errorSigma(skill);
  // a tiny bias so even the best AI is never pixel perfect
  const bias = (rng.chance(0.5) ? 1 : -1) * 0.006;
  const angle = sol.angle + rng.gauss() * sig.angle + bias;
  const speed = clamp(sol.speed * (1 + rng.gauss() * sig.power), w.speedMin, w.speedMax);
  return { angle, speed, power: powerFor(speed, w), miss: NaN };
}

/** The wind the AI "feels": a noisy reading of the real one. */
export const perceivedWind = (wind: number, skill: number, rng: Rng): number => wind * (1 + rng.gauss() * errorSigma(skill).wind);

/** Occasionally switches weapon; better AIs pick bombs when the target hides behind cover. */
export function chooseWeapon(pool: WeaponId[], current: WeaponId, skill: number, rng: Rng, targetCovered: boolean): WeaponId {
  if (pool.length <= 1) return pool[0] ?? current;
  if (targetCovered && pool.includes('bomb') && rng.chance(0.3 + skill * 0.5)) return 'bomb';
  if (rng.chance(0.3)) return rng.pick(pool);
  return pool.includes(current) ? current : (pool[0] as WeaponId);
}
