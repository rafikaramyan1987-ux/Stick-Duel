import { evaluate } from '../core/ai';
import { beam, makeBlocker, pointInPoly, rect, type Shape } from '../core/geometry';
import { clamp, lerp, type Vec } from '../core/math';
import { hashSeed, Rng } from '../core/rng';
import { WEAPONS, type WeaponId } from '../core/weapons';
import { LEVELS_PER_WORLD, worldByIndex, type EnemyKind, type WorldDef } from './worlds';

export type Mat = 'grass' | 'wood' | 'stone' | 'rock' | 'sand' | 'sandstone' | 'cactus' | 'ice' | 'snow' | 'basalt';

export interface Solid {
  id: number;
  shape: Shape;
  mat: Mat;
  /** Arrows/axes/spears stay stuck in it (otherwise they bounce off). */
  sticky: boolean;
  role: 'platform' | 'obstacle' | 'cover' | 'branch';
  /** Volcano: this chunk can crumble and fall. */
  crumble?: boolean;
  /** Obstacle group (a tree with its branches, a wall with its battlements…). */
  group: number;
}

export type DecoKind =
  | 'canopy'
  | 'bush'
  | 'flowers'
  | 'mushroom'
  | 'banner'
  | 'torch'
  | 'flag'
  | 'pine'
  | 'boulder'
  | 'skullrock'
  | 'palm'
  | 'pot'
  | 'snowman'
  | 'icicles'
  | 'crystal'
  | 'vent'
  | 'grass';

export interface Deco {
  kind: DecoKind;
  x: number;
  y: number;
  s: number;
  flip: boolean;
  seed: number;
  /** Draw in front of fighters (otherwise behind). */
  front?: boolean;
  group: number;
}

export type FloorKind = 'forestfloor' | 'courtyard' | 'abyss' | 'sandplain' | 'lake' | 'lava';

export type BonusKind = 'balloon' | 'crate' | 'bird';
export type Reward = 'coins' | 'fire' | 'triple' | 'shield' | 'heal';

/** A floating bonus between the fighters: hit it for coins or a one-shot power-up. */
export interface BonusDef {
  id: number;
  kind: BonusKind;
  /** Rest position; balloons/crates bob up and down, birds fly back and forth. */
  x: number;
  y: number;
  reward: Reward;
  coins: number;
  /** Horizontal flight range (birds), metres. */
  range: number;
  phase: number;
}

export interface LevelDef {
  key: string;
  world: WorldDef;
  /** 1..10 (boss = 10). Endless/2P use synthetic levels. */
  level: number;
  boss: boolean;
  seed: number;
  /** Feet positions. Player always at x = 0. */
  playerSpot: Vec;
  enemySpot: Vec;
  solids: Solid[];
  decos: Deco[];
  floor: { y: number; kind: FloorKind };
  /** Wind: base (m/s², + = to the right) and random change per turn. */
  wind: { base: number; gust: number };
  /** Anything below this y has fallen off. */
  killY: number;
  /** 0..1 — AI accuracy and decision quality. */
  skill: number;
  /** AI behaviour: damage multiplier, whether it may headshot, whether its first shot always misses. */
  ai: { damage: number; headshots: boolean; missFirst: boolean };
  /** Damage multiplier for human players' hits (duel pace). */
  playerDamage: number;
  enemy: { kind: EnemyKind; hp: number; scale: number; weapons: WeaponId[]; boss: boolean };
  playerHp: number;
  par: number;
  /** How long (seconds of flight) the dotted aim preview shows. */
  preview: number;
  friction: number;
  /** Floating balloons / crates / birds to hit for coins or power-ups. */
  bonuses: BonusDef[];
  /** Falling off the platform is an instant K.O. (not on the gentle first levels). */
  ringOut: boolean;
  /** World bounds used for "flew away" checks. */
  bounds: { minX: number; maxX: number; minY: number; maxY: number };
}

/** Difficulty knobs (see docs/playtest.md for how they were tuned). */
type Pair = [number, number];
export const TUNING: {
  skill: Pair;
  bossSkill: number;
  damage: Pair;
  gentleDamage: number;
  worldDamage: number[];
  worldSkill: number[];
  bossDamage: number[];
  playerDamage: number;
  hp: [number, number, number];
  bossHp: Pair;
  preview: Pair;
} = {
  /** AI skill: base + slope × difficulty, plus a boss bonus. */
  skill: [0.3, 0.6],
  bossSkill: 0.25,
  /** AI damage multiplier from the first to the last level, and on the gentle levels. */
  damage: [1.5, 1.85],
  gentleDamage: 0.5,
  /** Per-world AI damage offset (each world's enemy weapons hit differently: bombs splash, boomerangs rarely hit). */
  worldDamage: [0, 0.05, -0.1, 0.2, -0.45, -0.4],
  /** Per-world AI skill offset. */
  worldSkill: [0.08, 0.06, -0.08, 0, -0.14, -0.16],
  /** Extra AI damage for each world's boss. */
  bossDamage: [-0.4, 0.1, 0.05, 0.95, -0.45, -0.2],
  /** Player (human) damage multiplier: sets the pace of the duels. */
  playerDamage: 1.5,
  /** Enemy HP: base + difficulty slope + within-world slope; bosses: base + per world. */
  hp: [42, 26, 8],
  bossHp: [60, 10],
  /** Aim preview length (s of flight) from the first to the last level. */
  preview: [1.4, 0.8],
};

/** Overall difficulty 0..1 across all 60 levels. */
export const difficulty = (world: number, level: number): number => clamp(((world - 1) * LEVELS_PER_WORLD + (level - 1)) / 59, 0, 1);

interface Builder {
  solids: Solid[];
  decos: Deco[];
  rng: Rng;
  /** Starts a new obstacle group; following solids/decos belong to it. */
  group(): void;
  add(shape: Shape, mat: Mat, role: Solid['role'], sticky: boolean, crumble?: boolean): void;
  deco(kind: DecoKind, x: number, y: number, s?: number, front?: boolean): void;
}

function builder(seed: number): Builder {
  let id = 0;
  let group = 0;
  const b: Builder = {
    solids: [],
    decos: [],
    rng: new Rng(seed),
    group() {
      group++;
    },
    add(shape, mat, role, sticky, crumble) {
      b.solids.push({ id: id++, shape, mat, role, sticky, crumble, group });
    },
    deco(kind, x, y, s = 1, front = false) {
      b.decos.push({ kind, x, y, s, flip: b.rng.chance(0.5), seed: b.rng.int(0, 1e6), front, group });
    },
  };
  return b;
}

const poly = (pts: Vec[]): Shape => ({ kind: 'poly', pts });
const circle = (x: number, y: number, r: number): Shape => ({ kind: 'circle', c: { x, y }, r });

/** Places n obstacles evenly-ish in the gap between the two fighters, away from both. */
function gapSpots(b: Builder, x0: number, x1: number, n: number, margin = 3): number[] {
  const out: number[] = [];
  const a = x0 + margin;
  const z = x1 - margin;
  if (z <= a || n <= 0) return out;
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const jitter = ((z - a) / n) * 0.25 * (b.rng.next() * 2 - 1);
    out.push(lerp(a, z, t) + jitter);
  }
  return out;
}

// ───────────────────────── per-world layouts ─────────────────────────

function forest(b: Builder, L: Layout): void {
  const floor = Math.max(0, L.enemy.y) + 3.2;
  L.floor = { y: floor, kind: 'forestfloor' };
  const hill = (cx: number, top: number, half: number) => {
    b.add(poly([
      { x: cx - half, y: top },
      { x: cx + half, y: top },
      { x: cx + half + 0.8, y: top + 0.45 },
      { x: cx + half + 2.2, y: floor + 1.5 },
      { x: cx - half - 2.2, y: floor + 1.5 },
      { x: cx - half - 0.8, y: top + 0.45 },
    ]), 'grass', 'platform', true);
    b.deco('grass', cx - half * 0.6, top, 1);
    b.deco('flowers', cx + half * 0.7, top, 0.9, true);
    if (b.rng.chance(0.6)) b.deco('mushroom', cx - half - 0.4, top + 0.25, 0.8);
  };
  hill(0, 0, 1.9);
  const treehouse = L.level >= 6 && L.level < 10 && b.rng.chance(0.5);
  if (treehouse) {
    const e = L.enemy;
    // a wooden platform on a big trunk
    b.add(poly(rect(e.x - 1.8, e.y, e.x + 1.8, e.y + 0.32)), 'wood', 'platform', true);
    b.add(poly([
      { x: e.x - 0.35, y: e.y + 0.32 },
      { x: e.x + 0.35, y: e.y + 0.32 },
      { x: e.x + 0.55, y: floor + 1 },
      { x: e.x - 0.55, y: floor + 1 },
    ]), 'wood', 'obstacle', true);
    b.deco('canopy', e.x + 0.4, e.y - 3.2, 1.5);
  } else {
    hill(L.enemy.x, L.enemy.y, L.boss ? 2.6 : 1.9);
  }
  // gentle start: no tree on 1-1; on 1-2/1-3 a single small tree well away from the player
  const gentle = L.level <= 3;
  const trees = L.level === 1 ? 0 : gentle ? 1 : clamp(Math.round(L.local * 1.6 + b.rng.range(0.3, 1.1)), 1, 2);
  const spots = gentle ? [lerp(Math.max(5.5, L.enemy.x * 0.6), L.enemy.x - 3.2, 0.5)] : gapSpots(b, 0, L.enemy.x, trees, 3.4);
  for (const x of spots.slice(0, trees)) {
    b.group();
    const top = Math.min(0, L.enemy.y) - (gentle ? b.rng.range(1.2, 1.8) : b.rng.range(1.6, 2.6) + L.local * 0.5);
    const w = b.rng.range(0.32, 0.45);
    b.add(poly([
      { x: x - w * 0.7, y: top },
      { x: x + w * 0.7, y: top },
      { x: x + w, y: floor + 0.5 },
      { x: x - w, y: floor + 0.5 },
    ]), 'wood', 'obstacle', true);
    b.deco('canopy', x, top - 0.6, b.rng.range(1.1, 1.5));
    const branches = b.rng.int(1, 2);
    for (let i = 0; i < branches; i++) {
      const side = (i % 2 === 0 ? -1 : 1) * (b.rng.chance(0.5) ? 1 : -1);
      const y = top + b.rng.range(0.7, 1.9);
      const l = b.rng.range(0.9, 1.5);
      const a = { x: x + side * w * 0.6, y };
      const tip = { x: x + side * (w + l), y: y - b.rng.range(0.5, 1) };
      b.add(poly(beam(a, tip, 0.11)), 'wood', 'branch', true);
      b.deco('canopy', tip.x, tip.y - 0.15, b.rng.range(0.55, 0.8));
    }
  }
  for (let i = 0; i < 5; i++) b.deco('bush', b.rng.range(-6, L.enemy.x + 6), floor, b.rng.range(0.8, 1.4));
}

function castle(b: Builder, L: Layout): void {
  const floor = Math.max(0, L.enemy.y) + 7.5;
  L.floor = { y: floor, kind: 'courtyard' };
  const tower = (cx: number, top: number, half: number, facing: 1 | -1, boss: boolean) => {
    b.add(poly(rect(cx - half, top, cx + half, floor + 2)), 'stone', 'platform', false);
    // battlements: the inner merlon is cover against low shots
    const mw = 0.5;
    const mh = 0.62;
    const inner = cx + facing * (half - mw / 2);
    const outer = cx - facing * (half - mw / 2);
    b.add(poly(rect(inner - mw / 2, top - mh, inner + mw / 2, top)), 'stone', 'cover', false);
    b.add(poly(rect(outer - mw / 2, top - mh, outer + mw / 2, top)), 'stone', 'cover', false);
    b.deco('banner', cx + facing * 0.15, top + 0.7, boss ? 1.3 : 1);
    b.deco('torch', cx - facing * (half - 0.35), top + 2.4, 1);
    b.deco('flag', outer, top - mh, boss ? 1.3 : 1);
  };
  tower(0, 0, 2, 1, false);
  tower(L.enemy.x, L.enemy.y, L.boss ? 2.6 : 2, -1, L.boss);
  const walls = clamp(Math.round(L.local * 1.4 + b.rng.range(0.3, 1.1)), 1, 2);
  for (const x of gapSpots(b, 0, L.enemy.x, walls, 3.6)) {
    b.group();
    const top = Math.min(0, L.enemy.y) - b.rng.range(-0.8, 1.4) - L.local * 1.1;
    const half = b.rng.range(0.55, 0.9);
    b.add(poly(rect(x - half, top, x + half, floor + 2)), 'stone', 'obstacle', false);
    const n = Math.max(2, Math.round(half * 2.2));
    for (let i = 0; i < n; i++) {
      const mx = x - half + (half * 2 * (i + 0.5)) / n;
      b.add(poly(rect(mx - 0.2, top - 0.45, mx + 0.2, top)), 'stone', 'cover', false);
    }
    if (b.rng.chance(0.6)) b.deco('banner', x, top + 0.9, 0.8);
    b.deco('torch', x + (b.rng.chance(0.5) ? -half - 0.05 : half + 0.05), top + 1.6, 0.9);
  }
}

function mountains(b: Builder, L: Layout): void {
  const floor = Math.max(0, L.enemy.y) + 16;
  L.floor = { y: floor, kind: 'abyss' };
  const cliff = (cx: number, top: number, half: number) => {
    b.add(poly([
      { x: cx - half, y: top },
      { x: cx + half, y: top },
      { x: cx + half + 0.5, y: top + 1.4 },
      { x: cx + half + 1.6, y: floor + 3 },
      { x: cx - half - 1.6, y: floor + 3 },
      { x: cx - half - 0.5, y: top + 1.4 },
    ]), 'rock', 'platform', false);
    b.deco('pine', cx - half - 0.2, top + 1.2, 0.9);
    if (b.rng.chance(0.7)) b.deco('boulder', cx + half * 0.75, top, 0.6, true);
  };
  cliff(0, 0, 1.8);
  cliff(L.enemy.x, L.enemy.y, L.boss ? 2.6 : 1.8);
  const spires = clamp(Math.round(L.local * 2 + b.rng.range(0, 1.2)), 0, 2);
  for (const x of gapSpots(b, 0, L.enemy.x, spires, 4)) {
    b.group();
    const top = Math.min(0, L.enemy.y) - b.rng.range(0.5, 3.5);
    const half = b.rng.range(0.9, 1.3);
    b.add(poly([
      { x: x - half * 0.55, y: top + 0.3 },
      { x: x - half * 0.1, y: top },
      { x: x + half * 0.5, y: top + 0.15 },
      { x: x + half * 0.8, y: top + 0.8 },
      { x: x + half * 1.5, y: floor + 3 },
      { x: x - half * 1.5, y: floor + 3 },
      { x: x - half * 0.85, y: top + 1 },
    ]), 'rock', 'obstacle', false);
    if (b.rng.chance(0.6)) b.deco('pine', x + half * 0.2, top + 0.12, 0.7);
  }
}

function desert(b: Builder, L: Layout): void {
  const floor = Math.max(0, L.enemy.y) + 2.8;
  L.floor = { y: floor, kind: 'sandplain' };
  const dune = (cx: number, top: number, a: number) => {
    const pts: Vec[] = [];
    const depth = floor + 1.2 - top;
    for (let i = 0; i <= 16; i++) {
      const u = -1 + (i / 16) * 2;
      pts.push({ x: cx + u * a, y: top + depth * Math.pow(Math.abs(u), 2.6) });
    }
    b.add(poly(pts), 'sand', 'platform', true);
  };
  const mesa = (cx: number, top: number, half: number) => {
    b.add(poly([
      { x: cx - half, y: top },
      { x: cx + half, y: top },
      { x: cx + half + 0.4, y: floor + 1 },
      { x: cx - half - 0.4, y: floor + 1 },
    ]), 'sandstone', 'platform', true);
  };
  dune(0, 0, 4.2);
  if (L.enemy.y < -1.4 || L.boss) mesa(L.enemy.x, L.enemy.y, L.boss ? 2.6 : 2);
  else dune(L.enemy.x, L.enemy.y, 4.2);
  const cacti = clamp(Math.round(L.local * 2.2 + b.rng.range(0.4, 1.3)), 1, 3);
  for (const x of gapSpots(b, 0, L.enemy.x, cacti, 4.2)) {
    b.group();
    const h = b.rng.range(2.4, 3.6) + L.local * 1.4;
    const base = floor + 0.3;
    const top = base - h;
    b.add(poly(beam({ x, y: base }, { x, y: top + 0.25 }, 0.26)), 'cactus', 'obstacle', true);
    b.add(circle(x, top + 0.26, 0.26), 'cactus', 'obstacle', true);
    for (const side of [-1, 1]) {
      if (b.rng.chance(0.25)) continue;
      const ay = lerp(top + 0.8, base - 1, b.rng.range(0.1, 0.7));
      const ax = x + side * 0.85;
      b.add(poly(beam({ x, y: ay }, { x: ax, y: ay }, 0.16)), 'cactus', 'obstacle', true);
      b.add(poly(beam({ x: ax, y: ay + 0.12 }, { x: ax, y: ay - 0.85 }, 0.16)), 'cactus', 'obstacle', true);
      b.add(circle(ax, ay - 0.85, 0.16), 'cactus', 'obstacle', true);
    }
  }
  for (let i = 0; i < 3; i++) b.deco('skullrock', b.rng.range(2, L.enemy.x - 2), floor + 0.2, b.rng.range(0.6, 1));
  b.deco('palm', -4.5, floor + 0.2, 1.2);
  b.deco('pot', 1.3, 0.05, 0.7, true);
}

function snow(b: Builder, L: Layout): void {
  const floor = Math.max(0, L.enemy.y) + 1.6;
  L.floor = { y: floor, kind: 'lake' };
  const floe = (cx: number, top: number, half: number) => {
    b.add(poly([
      { x: cx - half, y: top },
      { x: cx + half, y: top },
      { x: cx + half - 0.3, y: floor + 3 },
      { x: cx - half + 0.3, y: floor + 3 },
    ]), 'ice', 'platform', false);
    b.deco('icicles', cx, top + 0.15, half);
  };
  floe(0, 0, 2.4);
  floe(L.enemy.x, L.enemy.y, L.boss ? 3 : 2.4);
  b.deco('pine', -2.8, 0.05, 1.2);
  b.deco('pine', L.enemy.x + 3, L.enemy.y + 0.05, 1.1);
  const n = clamp(Math.round(L.local * 2 + b.rng.range(0.3, 1.2)), 1, 3);
  for (const x of gapSpots(b, 0, L.enemy.x, n, 3.8)) {
    b.group();
    if (b.rng.chance(0.45)) {
      // snowman on a small floe
      b.add(poly(rect(x - 0.9, floor - 0.7, x + 0.9, floor + 2)), 'ice', 'obstacle', false);
      const y0 = floor - 0.7;
      b.add(circle(x, y0 - 0.55, 0.55), 'snow', 'obstacle', true);
      b.add(circle(x, y0 - 1.42, 0.4), 'snow', 'obstacle', true);
      b.add(circle(x, y0 - 2.05, 0.29), 'snow', 'obstacle', true);
      b.deco('snowman', x, y0, 1);
    } else {
      const top = Math.min(0, L.enemy.y) - b.rng.range(1, 3.5) - L.local;
      const half = b.rng.range(0.4, 0.7);
      b.add(poly([
        { x: x, y: top - 0.6 },
        { x: x + half, y: top },
        { x: x + half * 1.2, y: floor + 2 },
        { x: x - half * 1.2, y: floor + 2 },
        { x: x - half, y: top },
      ]), 'ice', 'obstacle', false);
      b.deco('crystal', x, floor - 0.1, 0.8);
    }
  }
}

function volcano(b: Builder, L: Layout): void {
  const floor = Math.max(0, L.enemy.y) + 5.5;
  L.floor = { y: floor, kind: 'lava' };
  const column = (cx: number, top: number, half: number) => {
    // centre chunk holds the fighter; the edges can crumble into the lava
    const c = 1.6;
    b.add(poly([
      { x: cx - c, y: top },
      { x: cx + c, y: top },
      { x: cx + c * 1.2, y: floor + 3 },
      { x: cx - c * 1.2, y: floor + 3 },
    ]), 'basalt', 'platform', false);
    for (const side of [-1, 1]) {
      const x0 = cx + side * c;
      const x1 = cx + side * half;
      const pts = [
        { x: x0, y: top },
        { x: x1, y: top + 0.05 },
        { x: x1 - side * 0.35, y: top + 0.9 },
        { x: x0 + side * 0.08, y: top + 2.2 },
      ];
      b.add(poly(side === 1 ? pts : [...pts].reverse()), 'basalt', 'platform', false, true);
    }
  };
  column(0, 0, 2.3);
  column(L.enemy.x, L.enemy.y, L.boss ? 3 : 2.3);
  const n = clamp(Math.round(L.local * 2 + b.rng.range(0.3, 1.3)), 1, 3);
  for (const x of gapSpots(b, 0, L.enemy.x, n, 3.8)) {
    b.group();
    const top = Math.min(0, L.enemy.y) - b.rng.range(0.6, 3.4) - L.local * 0.8;
    const half = b.rng.range(0.5, 0.85);
    b.add(poly([
      { x: x - half, y: top + 0.25 },
      { x: x - half * 0.3, y: top },
      { x: x + half * 0.6, y: top + 0.1 },
      { x: x + half * 1.2, y: floor + 2 },
      { x: x - half * 1.3, y: floor + 2 },
    ]), 'basalt', 'obstacle', false);
  }
  for (let i = 0; i < 3; i++) b.deco('vent', b.rng.range(-3, L.enemy.x + 3), floor, b.rng.range(0.7, 1.2));
}

/** Nothing but a fighter's own platform within this distance (m) of it: shots never start blocked. */
export const CLEARANCE = 3;

/** Leaf clumps sitting on a branch (they go when the branch goes). */
function branchDecos(decos: Deco[], branch: Solid): Deco[] {
  if (branch.shape.kind !== 'poly') return [];
  const pts = branch.shape.pts;
  return decos.filter((d) => d.kind === 'canopy' && d.group === branch.group && pts.some((q) => Math.hypot(q.x - d.x, q.y - d.y) < 0.9));
}

/** Removes branches near a fighter, and whole obstacles (trees, walls…) that crowd one. */
function clearAroundFighters(b: Builder, spots: Vec[]): void {
  const near = (s: Solid) =>
    spots.some((p) => (s.shape.kind === 'circle' ? Math.abs(s.shape.c.x - p.x) - s.shape.r : Math.min(...s.shape.pts.map((q) => Math.abs(q.x - p.x)))) < CLEARANCE);
  for (const br of b.solids.filter((s) => s.role === 'branch' && near(s))) {
    const gone = branchDecos(b.decos, br);
    b.decos = b.decos.filter((d) => !gone.includes(d));
  }
  b.solids = b.solids.filter((s) => !(s.role === 'branch' && near(s)));
  const crowded = new Set(b.solids.filter((s) => s.group > 0 && near(s)).map((s) => s.group));
  b.solids = b.solids.filter((s) => !crowded.has(s.group));
  b.decos = b.decos.filter((d) => !crowded.has(d.group));
}

interface Layout {
  level: number;
  local: number;
  boss: boolean;
  enemy: Vec;
  floor: { y: number; kind: FloorKind };
}

const LAYOUTS: Record<WorldDef['id'], (b: Builder, L: Layout) => void> = { forest, castle, mountains, desert, snow, volcano };

export interface LevelOptions {
  /** Endless/2P: no boss, custom seed. */
  seed?: number;
  forceBoss?: boolean;
}

/** Minimum width (radians) of launch angles that hit, for each side: "more than one good angle". */
export const MIN_LANE = 0.65;

/**
 * Width of the lane for one shooter: the total range of launch angles (bow, no wind)
 * for which some power hits the opponent's body without touching the scenery.
 */
export function laneWidth(L: LevelDef, side: 0 | 1): number {
  const blocked = makeBlocker(L.solids.map((s) => s.shape));
  const me = side === 0 ? L.playerSpot : L.enemySpot;
  const foe = side === 0 ? L.enemySpot : L.playerSpot;
  const s1 = side === 0 ? 1 : L.enemy.scale;
  const s2 = side === 0 ? L.enemy.scale : 1;
  const dir = side === 0 ? 1 : -1;
  const from = { x: me.x + dir * 0.4 * s1, y: me.y - 1.75 * s1 };
  const target = { x: foe.x, y: foe.y - 1.2 * s2 };
  const step = 0.04;
  let width = 0;
  for (let up = -0.3; up <= 1.32; up += step) {
    const angle = dir > 0 ? -up : Math.PI + up;
    let best = Infinity;
    for (let j = 0; j <= 32 && best > 0.3; j++) {
      const speed = WEAPONS.bow.speedMin + ((WEAPONS.bow.speedMax - WEAPONS.bow.speedMin) * j) / 32;
      best = Math.min(best, evaluate({ from, target, weapon: WEAPONS.bow, wind: 0, blocked }, angle, speed));
    }
    if (best <= 0.3) width += step;
  }
  return width;
}

/** Both fighters have a comfortable lane (several good angles) through the scenery. */
export function playable(L: LevelDef): boolean {
  return laneWidth(L, 0) >= MIN_LANE && laneWidth(L, 1) >= MIN_LANE;
}

export function generateLevel(worldIndex: number, level: number, opt: LevelOptions = {}): LevelDef {
  const base = opt.seed ?? hashSeed(worldIndex, level, 7);
  const lane = (L: LevelDef) => Math.min(laneWidth(L, 0), laneWidth(L, 1));
  // try a few layouts, keep the first with a comfortable lane (or the best one)
  let best: LevelDef | null = null;
  let bestLane = -1;
  for (let attempt = 0; attempt < 6; attempt++) {
    const L = buildLevel(worldIndex, level, attempt === 0 ? base : hashSeed(base, attempt), opt.forceBoss);
    const w = lane(L);
    if (w >= MIN_LANE) return L;
    if (w > bestLane) {
      best = L;
      bestLane = w;
    }
  }
  let L = best as LevelDef;
  // still too tight: remove the branch or obstacle whose removal opens the lane most
  while (bestLane < MIN_LANE) {
    const options: LevelDef[] = [];
    L.solids.forEach((s, i) => {
      if (s.role !== 'branch') return;
      const gone = branchDecos(L.decos, s);
      options.push({ ...L, solids: L.solids.filter((_, j) => j !== i), decos: L.decos.filter((d) => !gone.includes(d)) });
    });
    for (const g of new Set(L.solids.filter((s) => s.group > 0).map((s) => s.group))) {
      options.push({ ...L, solids: L.solids.filter((s) => s.group !== g), decos: L.decos.filter((d) => d.group !== g) });
    }
    if (!options.length) break;
    let pick = options[0] as LevelDef;
    let pickLane = -1;
    for (const o of options) {
      const w = lane(o);
      if (w > pickLane + 0.01) {
        pick = o;
        pickLane = w;
      }
    }
    L = pick;
    bestLane = pickLane;
  }
  return L;
}

function buildLevel(worldIndex: number, level: number, seed: number, forceBoss?: boolean): LevelDef {
  const world = worldByIndex(worldIndex);
  const boss = forceBoss ?? level === LEVELS_PER_WORLD;
  const rng = new Rng(seed);
  const T = difficulty(world.index, level);
  const local = (level - 1) / (LEVELS_PER_WORLD - 1);

  // distance and height difference grow smoothly
  let distance = 9.5 + T * 6 + local * 3 + rng.range(0, 1.5) + (boss ? 1.5 : 0);
  let height = rng.range(-0.4, 0.8) + local * 1.6;
  if (world.id === 'mountains') height = (rng.chance(0.3) ? -1 : 1) * rng.range(2, 3.2 + local * 3.5);
  if (world.id === 'castle') height = rng.range(-1, 1.2) + local * 1.6;
  if (world.id === 'snow') height = rng.range(-0.6, 0.6) + local;
  if (boss) height = Math.max(height, world.id === 'mountains' ? 3.5 : 1.4);
  distance = Math.round(distance * 10) / 10;
  const enemy = { x: distance, y: -Math.round(height * 10) / 10 };

  const b = builder(seed ^ 0x51ed);
  const L: Layout = { level, local, boss, enemy, floor: { y: 3, kind: 'forestfloor' } };
  LAYOUTS[world.id](b, L);
  clearAroundFighters(b, [{ x: 0, y: 0 }, enemy]);

  let windMag = lerp(world.wind.from, world.wind.to, local) * rng.range(0.8, 1.1);
  if (windMag < 0.25) windMag = 0;
  const base = Math.round(windMag * (rng.chance(0.5) ? 1 : -1) * 10) / 10;
  // the first three forest levels are a gentle introduction
  const gentle = world.index === 1 && level <= 3;
  // difficulty knobs, tuned with the playtest bot (scripts/playtest, docs/playtest.md)
  const skill = gentle ? 0 : clamp(TUNING.skill[0] + T * TUNING.skill[1] + (TUNING.worldSkill[world.index - 1] ?? 0) + (boss ? TUNING.bossSkill : 0), 0, 0.85);
  const wi = world.index - 1;
  const aiDamage = gentle
    ? TUNING.gentleDamage
    : lerp(TUNING.damage[0], TUNING.damage[1], T) + (TUNING.worldDamage[wi] ?? 0) + (boss ? (TUNING.bossDamage[wi] ?? 0) : 0);
  const enemyHp = boss
    ? TUNING.bossHp[0] + world.index * TUNING.bossHp[1]
    : Math.round(TUNING.hp[0] + T * TUNING.hp[1] + local * TUNING.hp[2]);
  const weapons: WeaponId[] = boss ? [world.boss.weapon] : world.enemyWeapons.slice(0, 1 + Math.floor(local * world.enemyWeapons.length));
  const minX = -8;
  const maxX = distance + 8;

  return {
    key: `${world.index}-${level}`,
    world,
    level,
    boss,
    seed,
    playerSpot: { x: 0, y: 0 },
    enemySpot: enemy,
    solids: b.solids,
    decos: b.decos,
    floor: L.floor,
    wind: { base, gust: world.wind.gust * (0.4 + 0.6 * local) },
    killY: L.floor.y + (L.floor.kind === 'lava' || L.floor.kind === 'lake' || L.floor.kind === 'abyss' ? 0 : 0.5),
    skill,
    ai: { damage: aiDamage, headshots: !gentle, missFirst: gentle },
    playerDamage: TUNING.playerDamage,
    enemy: { kind: world.enemy, hp: enemyHp, scale: boss ? world.boss.scale : 1, weapons, boss },
    playerHp: 100 + (world.index - 1) * 10,
    // shots for the third star: the hits a bow needs, plus a couple of misses
    par: Math.ceil(enemyHp / (WEAPONS.bow.damage * TUNING.playerDamage)) + 2,
    preview: lerp(TUNING.preview[0], TUNING.preview[1], T),
    friction: world.friction,
    bonuses: makeBonuses(world, level, seed, enemy, b.solids, gentle),
    ringOut: !gentle,
    bounds: { minX: minX - 30, maxX: maxX + 30, minY: -60, maxY: L.floor.y + 4 },
  };
}

const BONUS_KIND: Record<WorldDef['id'], BonusKind[]> = {
  forest: ['bird', 'balloon'],
  castle: ['crate', 'balloon'],
  mountains: ['bird', 'balloon'],
  desert: ['balloon', 'crate'],
  snow: ['balloon', 'bird'],
  volcano: ['crate', 'balloon'],
};

/** Some levels get 1–2 floating bonuses in the open air between the fighters. */
function makeBonuses(world: WorldDef, level: number, seed: number, enemy: Vec, solids: Solid[], gentle: boolean): BonusDef[] {
  // own random stream: adding bonuses never changes a level's layout
  const rng = new Rng(seed ^ 0xb0b);
  if (world.index === 1 && level <= 2) return [];
  const n = gentle ? 1 : rng.chance(0.65) ? (rng.chance(0.35) ? 2 : 1) : 0;
  const out: BonusDef[] = [];
  const top = Math.min(0, enemy.y);
  for (let i = 0; i < n * 6 && out.length < n; i++) {
    const kind = gentle ? 'balloon' : rng.pick(BONUS_KIND[world.id]);
    const x = lerp(enemy.x * 0.3, enemy.x * 0.7, rng.next());
    const y = top - rng.range(2.4, 5.2);
    // keep clear of scenery and of the other bonus
    const clear = solids.every((s) => {
      if (s.shape.kind === 'circle') return Math.hypot(s.shape.c.x - x, s.shape.c.y - y) > s.shape.r + 1.2;
      return !s.shape.pts.some((q) => Math.hypot(q.x - x, q.y - y) < 1.4) && !pointInPoly(x, y, s.shape.pts);
    });
    if (!clear || out.some((o) => Math.abs(o.x - x) < 2.5)) continue;
    const r = rng.next();
    const reward: Reward = gentle ? 'coins' : r < 0.36 ? 'coins' : r < 0.52 ? 'fire' : r < 0.68 ? 'triple' : r < 0.84 ? 'shield' : 'heal';
    out.push({ id: out.length, kind, x, y, reward, coins: reward === 'coins' ? 5 + Math.round(world.index * 3 + rng.range(0, 6)) : 0, range: kind === 'bird' ? rng.range(1.2, 2.2) : 0, phase: rng.range(0, 6.28) });
  }
  return out;
}

/** Endless mode: a random unlocked world, levels getting harder with each wave. */
export function endlessLevel(wave: number, furthestWorld: number, rng: Rng): LevelDef {
  const world = 1 + rng.int(0, Math.max(1, furthestWorld) - 1);
  const level = clamp(2 + Math.floor(wave * 0.8), 2, 9);
  return generateLevel(world, level, { seed: rng.int(1, 1e9), forceBoss: false });
}
