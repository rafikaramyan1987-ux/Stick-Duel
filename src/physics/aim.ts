import { clamp, type Vec } from '../core/math';
import { GRAVITY, MAX_SPEED, MIN_SPEED, Sim, type Side } from './sim';

export interface Aim {
  angle: number;
  power: number;
}

/**
 * Launch angle (screen radians, y down) that sends a shot at `speed` from `from` through `to`,
 * or null if it can't reach. `high` picks the lobbed arc.
 */
export function ballisticAngle(from: Vec, to: Vec, speed: number, high: boolean): number | null {
  const dx = to.x - from.x;
  const up = from.y - to.y; // y up
  const ax = Math.abs(dx);
  if (ax < 1e-4) return null;
  const v2 = speed * speed;
  const disc = v2 * v2 - GRAVITY * (GRAVITY * ax * ax + 2 * up * v2);
  if (disc < 0) return null;
  const root = Math.sqrt(disc);
  const th = Math.atan((v2 + (high ? root : -root)) / (GRAVITY * ax));
  // convert to a screen angle: up is negative y
  return dx >= 0 ? -th : -(Math.PI - th);
}

/** Converts a launch speed into the 0..1 power the shot uses. */
export const powerForSpeed = (speed: number): number => clamp((speed - MIN_SPEED) / (MAX_SPEED - MIN_SPEED), 0, 1);

/**
 * Aims a fighter's shot at a world point. Tries a few speeds and returns the solutions
 * (flat and lobbed), taking the muzzle offset into account.
 */
export function aimsAt(sim: Sim, side: Side, target: Vec, speeds = [10, 13, 16, 19, 21]): Aim[] {
  const out: Aim[] = [];
  for (const speed of speeds) {
    for (const high of [false, true]) {
      let angle = ballisticAngle(sim.fighters[side].rag.shoulder(), target, speed, high);
      if (angle === null) continue;
      for (let i = 0; i < 2 && angle !== null; i++) angle = ballisticAngle(sim.muzzle(side, angle), target, speed, high);
      if (angle === null) continue;
      const power = powerForSpeed(speed);
      if (sim.wind !== 0) {
        angle = refineForWind(sim, side, target, angle, power);
        if (angle === null) continue;
      }
      out.push({ angle, power });
    }
  }
  return out;
}

/** Is the flight path to the target free of solid things (checked with ray casts along the arc)? */
export function pathClear(sim: Sim, side: Side, aim: Aim, target: Vec, ignore: (b: unknown) => boolean = () => false): boolean {
  const pts = sim.previewPath(side, aim.angle, aim.power, 3);
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    let hit = false;
    sim.world.rayCast(a, b, (fix) => {
      const ud = fix.getBody().getUserData() as { kind?: string; side?: Side } | null;
      if (ud?.kind === 'part' && ud.side === side) return -1;
      if (ignore(fix.getBody())) return -1;
      hit = true;
      return 0;
    });
    if (hit) return false;
    // reached the target
    if (Math.hypot(b.x - target.x, b.y - target.y) < 0.35) return true;
    if ((b.x - target.x) * Math.sign(target.x - pts[0]!.x) > 0.3) return true;
  }
  return true;
}

/** Closest distance between the flight path and a point. */
export function missDistance(sim: Sim, side: Side, angle: number, power: number, target: Vec): number {
  const pts = sim.previewPath(side, angle, power, 3.5);
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const l2 = dx * dx + dy * dy || 1;
    const t = clamp(((target.x - a.x) * dx + (target.y - a.y) * dy) / l2, 0, 1);
    best = Math.min(best, Math.hypot(a.x + dx * t - target.x, a.y + dy * t - target.y));
  }
  return best;
}

/** Wind bends the arc: golden-section search around the no-wind angle. */
function refineForWind(sim: Sim, side: Side, target: Vec, a0: number, power: number): number | null {
  let lo = a0 - 0.45;
  let hi = a0 + 0.45;
  const g = (Math.sqrt(5) - 1) / 2;
  let c = hi - g * (hi - lo);
  let d = lo + g * (hi - lo);
  let fc = missDistance(sim, side, c, power, target);
  let fd = missDistance(sim, side, d, power, target);
  for (let i = 0; i < 26; i++) {
    if (fc < fd) {
      hi = d;
      d = c;
      fd = fc;
      c = hi - g * (hi - lo);
      fc = missDistance(sim, side, c, power, target);
    } else {
      lo = c;
      c = d;
      fc = fd;
      d = lo + g * (hi - lo);
      fd = missDistance(sim, side, d, power, target);
    }
  }
  const a = (lo + hi) / 2;
  return missDistance(sim, side, a, power, target) < 0.15 ? a : null;
}
