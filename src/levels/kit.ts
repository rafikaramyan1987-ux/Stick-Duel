import { TUNED_HP } from './tuning';
import type { BoxObj, BallObj, LevelDef, ObjDef, Pool, RopeDef, TerrainDef, V2, WorldId } from './types';

/**
 * Building blocks for the hand-made arenas. y is DOWN (ground at 0, the sky is negative).
 * Arenas are compact (about 14 m wide) so a phone in portrait shows the shooter, the structure and
 * the rival at a readable size. The player stands near x = 1.2, the rival near x = 11.6.
 */
export const PX = 1.2;
export const RX = 11.6;
type Surface = TerrainDef['surface'];

export const SURFACE: Record<WorldId, Surface> = {
  forest: 'grass',
  castle: 'stone',
  mountains: 'grass',
  desert: 'sand',
  frozen: 'snow',
  volcano: 'dark',
};

/** Flat ground from x0 to x1 at height y. */
export function flat(surface: Surface, x0 = -10, x1 = 26, y = 0): TerrainDef {
  return { surface, points: [{ x: x0, y }, { x: x1, y }, { x: x1, y: 8 }, { x: x0, y: 8 }] };
}

/** Ground following a profile of (x, y) points from left to right. */
export function profile(surface: Surface, pts: V2[]): TerrainDef {
  const first = pts[0]!;
  const last = pts[pts.length - 1]!;
  return { surface, points: [{ x: -10, y: first.y }, ...pts, { x: 26, y: last.y }, { x: 26, y: 8 }, { x: -10, y: 8 }] };
}

/** A raised block of ground (ledge, mesa) with vertical sides. */
export function block(surface: Surface, x0: number, x1: number, top: number, bottom = 0.3): TerrainDef {
  return { surface, points: [{ x: x0, y: top }, { x: x1, y: top }, { x: x1, y: bottom }, { x: x0, y: bottom }] };
}

/** Ground with a pit from x0 to x1 (depth d). Returns the terrain pieces. */
export function pitGround(surface: Surface, x0: number, x1: number, d: number): TerrainDef[] {
  return [
    { surface, points: [{ x: -10, y: 0 }, { x: x0, y: 0 }, { x: x0, y: d }, { x: x1, y: d }, { x: x1, y: 0 }, { x: 26, y: 0 }, { x: 26, y: 8 }, { x: -10, y: 8 }] },
  ];
}

export const pool = (x0: number, x1: number, y: number, depth: number): Pool => ({ x0, x1, y, depth });

let auto = 0;
const nid = (p: string) => `${p}${++auto}`;

type Extra = Partial<Pick<BoxObj, 'angle' | 'depth' | 'hp' | 'fixed'>>;

export function box(x: number, y: number, w: number, h: number, mat: BoxObj['mat'], look: BoxObj['look'], extra: Extra & { id?: string } = {}): BoxObj {
  return { shape: 'box', x, y, w, h, mat, look, ...extra };
}

/** Box standing on a surface at groundY. */
export function on(groundY: number, x: number, w: number, h: number, mat: BoxObj['mat'], look: BoxObj['look'], extra: Extra & { id?: string } = {}): BoxObj {
  return box(x, groundY - h / 2, w, h, mat, look, extra);
}

export const crate = (x: number, groundY: number, s = 0.9, id?: string): BoxObj => on(groundY, x, s, s, 'crate', 'crate', { id });
export const stone = (x: number, groundY: number, w: number, h: number, id?: string): BoxObj => on(groundY, x, w, h, 'stone', 'stoneBlock', { id });
export const beam = (x: number, groundY: number, h: number, id?: string, w = 0.3): BoxObj => on(groundY, x, w, h, 'wood', 'woodBeam', { id, depth: 0.4 });
export const plank = (x: number, y: number, w: number, fixed = false, id?: string, h = 0.3): BoxObj => box(x, y, w, h, 'wood', 'woodPlank', { id, fixed, depth: 1.2 });
export const post = (x: number, groundY: number, h: number, w = 0.32): BoxObj => on(groundY, x, w, h, 'wood', 'post', { fixed: true, depth: 0.4 });
export const tnt = (x: number, groundY: number, id?: string): BoxObj => on(groundY, x, 0.8, 1, 'barrel', 'barrelTnt', { id: id ?? nid('tnt'), depth: 0.8 });
export const ice = (x: number, groundY: number, w: number, h: number, id?: string): BoxObj => on(groundY, x, w, h, 'ice', 'iceBlock', { id });
export const sand = (x: number, groundY: number, w: number, h: number, id?: string): BoxObj => on(groundY, x, w, h, 'sand', 'sandBlock', { id });
export const glass = (x: number, y: number, w: number, h = 0.25, id?: string): BoxObj => box(x, y, w, h, 'glass', 'glass', { id, fixed: true, depth: 2 });

export function log(id: string, x: number, y: number, r = 0.7): BallObj {
  return { id, shape: 'ball', x, y, r, mat: 'wood', look: 'log', hp: 999, depth: 1.6 };
}
export function boulder(id: string, x: number, y: number, r = 0.75): BallObj {
  return { id, shape: 'ball', x, y, r, mat: 'rock', look: 'boulder', depth: 1.5 };
}

/** Something hanging on a rope from an anchor; the body is placed `len` below the anchor. */
export function hang(ropeId: string, anchor: V2, len: number, body: ObjDef, kind: RopeDef['kind'] = 'rope'): { obj: ObjDef; rope: RopeDef } {
  const id = body.id ?? `${ropeId}-load`;
  const h = body.shape === 'box' ? body.h : body.r * 2;
  const obj = { ...body, id, x: anchor.x, y: anchor.y + len + h / 2 } as ObjDef;
  return { obj, rope: { id: ropeId, anchor, body: id, local: { x: 0, y: -h / 2 }, kind } };
}

export const rock = (id: string, w = 1, h = 1): BoxObj => box(0, 0, w, h, 'stone', 'stoneBlock', { id });
export const chandelier = (id: string): BoxObj => box(0, 0, 2, 0.5, 'metal', 'chandelier', { id, depth: 1.4 });

/** A gallows-style frame: a post and a beam on top, to hang things from. */
export function gallows(x: number, groundY: number, h: number, reach: number): ObjDef[] {
  // frames are iron-hard timber: they do not burn or break (so fire cannot sneak along them)
  return [{ ...post(x, groundY, h, 0.36), mat: 'metal' }, box(x + reach / 2, groundY - h - 0.18, Math.abs(reach) + 0.5, 0.36, 'metal', 'woodPlank', { fixed: true, depth: 0.8 })];
}

/** A shelter in front of the rival: a wall and a roof. */
export function shelter(x0: number, x1: number, groundY: number, h: number, mat: 'wood' | 'stone', roof = true): ObjDef[] {
  const out: ObjDef[] = [];
  if (mat === 'stone') out.push(box(x0, groundY - h / 2, 0.8, h, 'stone', 'castleWall', { fixed: true, depth: 1.8 }));
  else out.push(post(x0, groundY, h, 0.36));
  if (roof) out.push(box((x0 + x1) / 2, groundY - h - 0.15, x1 - x0 + 0.6, 0.3, mat === 'stone' ? 'stone' : 'wood', mat === 'stone' ? 'castleBeam' : 'woodPlank', { fixed: true, depth: 1.5 }));
  return out;
}

export interface LevelSpec {
  par: number;
  rivalHp?: number;
  rivalX?: number;
  rivalY?: number;
  playerX?: number;
  playerY?: number;
  ammo: LevelDef['ammo'];
  terrain?: TerrainDef[];
  objects: ObjDef[];
  ropes?: RopeDef[];
  hangs?: Array<{ obj: ObjDef; rope: RopeDef }>;
  view?: Partial<LevelDef['view']>;
  water?: Pool[];
  lava?: Pool[];
  wind?: number;
  rivalTargets?: string[];
  rivalAmmo?: LevelDef['rivalAmmo'];
  rivalSkill?: number;
  hintTarget?: string;
  boss?: boolean;
  rivalLook?: string;
  shots?: number;
}

/** Adds the full-width ground unless a piece of terrain already is one (pits, ponds, lava pits). */
function withGround(world: WorldId, t: TerrainDef[]): TerrainDef[] {
  const full = t.some((p) => Math.min(...p.points.map((q) => q.x)) <= -9 && Math.max(...p.points.map((q) => q.x)) >= 25 && p.points.some((q) => q.y >= 7));
  return full ? t : [flat(SURFACE[world]), ...t];
}

const SKILL: Record<WorldId, number> = { forest: 0.25, castle: 0.35, mountains: 0.45, desert: 0.55, frozen: 0.65, volcano: 0.75 };

export function level(world: WorldId, n: number, s: LevelSpec): LevelDef {
  const objects = [...s.objects, ...(s.hangs ?? []).map((h) => h.obj)];
  const ropes = [...(s.ropes ?? []), ...(s.hangs ?? []).map((h) => h.rope)];
  const ammoTotal = Object.values(s.ammo).reduce((a, b) => a + (b ?? 0), 0);
  return {
    id: `${world}-${n}`,
    world,
    n,
    name: s.boss ? `boss.${world}` : `world.${world}`,
    shots: s.shots ?? ammoTotal,
    par: s.par,
    ammo: s.ammo,
    player: { x: s.playerX ?? PX, y: s.playerY ?? 0, hp: 100 },
    rival: { x: s.rivalX ?? RX, y: s.rivalY ?? 0, hp: TUNED_HP[`${world}-${n}`] ?? s.rivalHp ?? (s.boss ? 180 : 100) },
    terrain: withGround(world, s.terrain ?? []),
    objects,
    ropes,
    view: { x0: -1.4, x1: 13.8, y0: -9, y1: 0.9, ...s.view },
    killY: 14,
    water: s.water,
    lava: s.lava,
    wind: s.wind,
    rivalTargets: s.rivalTargets,
    rivalAmmo: s.rivalAmmo,
    rivalSkill: Math.min(0.9, (s.rivalSkill ?? SKILL[world]) + (n - 1) * 0.02),
    hintTarget: s.hintTarget,
    tricky: n % 4 === 0 && !s.boss,
    boss: s.boss,
    rivalLook: s.rivalLook,
  };
}

/* ------------------------------------------------------------------ */
/* Hazard builders                                                     */
/* ------------------------------------------------------------------ */

export interface Part {
  terrain?: TerrainDef[];
  objects: ObjDef[];
  ropes: RopeDef[];
  water?: Pool[];
  lava?: Pool[];
}

/** Merges level parts. */
export function parts(...ps: Part[]): Required<Part> {
  return {
    terrain: ps.flatMap((p) => p.terrain ?? []),
    objects: ps.flatMap((p) => p.objects),
    ropes: ps.flatMap((p) => p.ropes),
    water: ps.flatMap((p) => p.water ?? []),
    lava: ps.flatMap((p) => p.lava ?? []),
  };
}

/** Head top of a standing fighter whose feet are at groundY. */
export const HEAD = (groundY = 0) => groundY - 2.45;

/**
 * A load hanging from a frame above x, its bottom `drop` metres above the rival's head.
 * The frame post stands at postX.
 */
export function drop(id: string, x: number, dropH: number, load: ObjDef, postX: number, groundY = 0, kind: RopeDef['kind'] = 'rope'): Part {
  const h = load.shape === 'box' ? load.h : load.r * 2;
  const bottom = HEAD(groundY) - dropH;
  const top = bottom - h;
  const frameY = top - 0.9;
  const frame = gallows(postX, groundY, groundY - frameY, x - postX);
  const hg = hang(id, { x, y: frameY + 0.2 }, top - (frameY + 0.2), { ...load, id: load.id ?? `${id}-load` }, kind);
  return { objects: [...frame, hg.obj], ropes: [hg.rope] };
}

/**
 * A log on a slope that falls towards the rival, tied to a stake at the top of the slope.
 * The slope goes from (x0, 0) up to (x1, top), with a flat top to x2 (dir = -1: slope descends to the left).
 */
export function slopeLog(id: string, ropeId: string, x0: number, x1: number, x2: number, top: number, surface: Surface, r = 0.7, at = 0.35): Part {
  const pts = x0 < x1 ? [{ x: x0, y: 0 }, { x: x1, y: top }, { x: x2, y: top }] : [{ x: x2, y: top }, { x: x1, y: top }, { x: x0, y: 0 }];
  const dx = x1 - x0;
  // outward normal of the slope (the one pointing up)
  const sxv = x0 - x1;
  const syv = -top;
  const len = Math.hypot(sxv, syv);
  let nx = -syv / len;
  let ny = sxv / len;
  if (ny > 0) {
    nx = -nx;
    ny = -ny;
  }
  const lx = x1 - dx * at;
  const sy = top * (1 - at);
  const stakeX = x1 + (x2 - x1) * 0.5;
  return {
    terrain: [{ surface, points: [...pts, { x: pts[pts.length - 1]!.x, y: 0.3 }, { x: pts[0]!.x, y: 0.3 }] }],
    objects: [post(stakeX, top, 1.3), log(id, lx + nx * r, sy + ny * r, r)],
    ropes: [{ id: ropeId, anchor: { x: stakeX, y: top - 1.15 }, body: id }],
  };
}

/** A log hanging from `anchor`, pulled aside to (holdX, holdY) by a second rope to a post. */
export function pendulum(id: string, anchor: V2, len: number, pullAngle: number, holdPostX: number, groundY = 0, r = 0.7, frame = true): Part {
  const bx = anchor.x - Math.sin(pullAngle) * len;
  const by = anchor.y + Math.cos(pullAngle) * len;
  const postH = groundY - by + 0.2;
  const objects: ObjDef[] = [log(id, bx, by, r), post(holdPostX, groundY, Math.max(1, postH))];
  // the frame post stands behind the rival's spot, not on it; iron-hard timber (does not burn)
  const px = Math.max(anchor.x + 3.4, 13.7);
  if (frame) objects.push({ ...post(px, groundY, groundY - anchor.y + 0.2, 0.4), mat: 'metal' }, box((anchor.x - 0.3 + px) / 2, anchor.y - 0.1, px - anchor.x + 0.6, 0.36, 'metal', 'woodPlank', { fixed: true, depth: 0.8 }));
  return {
    objects,
    ropes: [
      { id: `${id}-swing`, anchor: { x: anchor.x, y: anchor.y + 0.1 }, body: id },
      { id: `${id}-hold`, anchor: { x: holdPostX, y: groundY - Math.max(1, postH) + 0.1 }, body: id },
    ],
  };
}

/** A tower of blocks standing on the ground (topples when pushed). */
export function tower(x: number, groundY: number, rows: number, mat: 'wood' | 'stone' | 'crate' | 'ice' | 'sand', w = 0.9, h = 0.9, prefix = 'tw'): Part {
  const objects: ObjDef[] = [];
  const look = mat === 'stone' ? 'stoneBlock' : mat === 'crate' ? 'crate' : mat === 'ice' ? 'iceBlock' : mat === 'sand' ? 'sandBlock' : 'woodBeam';
  for (let i = 0; i < rows; i++) objects.push(on(groundY - i * h, x, w, h, mat === 'wood' ? 'wood' : mat, look as BoxObj['look'], { id: `${prefix}${i}` }));
  return { objects, ropes: [] };
}

/** A sloped ledge with a heavy thing held back by a wooden stopper (burn / blast / push it away). */
export function ledge(id: string, x0: number, x1: number, y: number, tilt: number, thing: 'boulder' | 'stone', surface: Surface, stopper = true): Part {
  // the ledge descends from x0 to x1 by `tilt`
  // a cliff when the ledge sticks out from the right (down to the ground), else a floating shelf
  const terrain: TerrainDef =
    x0 > x1
      ? { surface, points: [{ x: x0 + 3, y }, { x: x1, y: y + tilt }, { x: x1 + 0.5, y: 0.3 }, { x: x0 + 3, y: 0.3 }] }
      : { surface, points: [{ x: x0, y }, { x: x1, y: y + tilt }, { x: x1, y: y + tilt + 0.8 }, { x: x0, y: y + 0.8 }] };
  const dir = Math.sign(x1 - x0);
  const sx = x1 - dir * 0.35;
  const objects: ObjDef[] = [];
  // fixed, so the boulder cannot push it over; fire burns it, a heavy bolt snaps it
  if (stopper) objects.push(on(y + tilt - 0.02, sx, 0.3, 1.2, 'wood', 'woodBeam', { id: `${id}-stop`, depth: 0.5, fixed: true }));
  const cx = sx - dir * 1.15;
  const cy = y + tilt * ((cx - x0) / (x1 - x0));
  if (thing === 'boulder') objects.push(boulder(id, cx, cy - 0.78, 0.75));
  else objects.push(box(cx, cy - 0.55, 1.1, 1.1, 'stone', 'stoneBlock', { id, angle: Math.atan2(tilt, x1 - x0) }));
  return { terrain: [terrain], objects, ropes: [] };
}

/** A roof that only fire removes (very tough, but wooden). */
export function woodRoof(x0: number, x1: number, y: number, id = 'roof'): ObjDef[] {
  return [box((x0 + x1) / 2, y, x1 - x0, 0.35, 'wood', 'woodPlank', { id, fixed: true, hp: 1e6, depth: 1.6 }), post(x0 + 0.2, 0, -y - 0.15), post(x1 - 0.2, 0, -y - 0.15)];
}

export type RoofKind = 'wood' | 'stone' | 'ice' | 'sand' | 'crate';

/**
 * A bunker around the rival: two fixed walls and a roof. The left wall stops short of the roof, so
 * the archers can see (and the rival can shoot) through the gap, but nothing falls in until the
 * roof is gone. Roofs: wood burns (fire arrows only), stone cracks (two heavy bolts), ice and crate
 * break with one heavy bolt or a bomb, sand crumbles under a bomb.
 */
export function bunker(x0: number, x1: number, roofY: number, roof: RoofKind, wallLook: BoxObj['look'] = 'castleWall', groundY = 0, gap = 1.1): Part {
  const wallH = groundY - roofY;
  const leftH = wallH - gap;
  const roofMat = roof === 'wood' ? 'wood' : roof === 'crate' ? 'crate' : roof;
  const roofLook: BoxObj['look'] = roof === 'wood' ? 'woodPlank' : roof === 'stone' ? 'stoneBlock' : roof === 'ice' ? 'iceBlock' : roof === 'sand' ? 'sandBlock' : 'crateStrong';
  const hp = roof === 'wood' ? 1e6 : roof === 'stone' ? 130 : roof === 'ice' ? 50 : roof === 'sand' ? 60 : 50;
  return {
    objects: [
      box(x0, groundY - leftH / 2, 0.6, leftH, 'stone', wallLook, { fixed: true, depth: 1.8, hp: 1e9 }),
      box(x1, groundY - wallH / 2, 0.6, wallH, 'stone', wallLook, { fixed: true, depth: 1.8, hp: 1e9 }),
      box((x0 + x1) / 2, roofY - 0.2, x1 - x0 + 0.6, 0.4, roofMat, roofLook, { id: 'roof', fixed: true, hp, depth: 1.8 }),
    ],
    ropes: [],
  };
}

/**
 * A closed hut around the rival: the front wall (facing the player) is the gate. Wood burns (fire
 * arrows only), stone cracks after two heavy bolts. Swinging rams and rolling logs stop at it.
 */
export function hut(x0: number, x1: number, roofY: number, front: 'wood' | 'stone', wallLook: BoxObj['look'] = 'castleWall', groundY = 0): Part {
  const h = groundY - roofY;
  return {
    objects: [
      front === 'wood'
        ? box(x0, groundY - h / 2, 0.45, h, 'wood', 'woodPlank', { id: 'gate', fixed: true, hp: 1e6, depth: 1.8 })
        : box(x0, groundY - h / 2, 0.6, h, 'stone', 'stoneBlock', { id: 'gate', fixed: true, hp: 130, depth: 1.8 }),
      box(x1, groundY - h / 2, 0.6, h, 'stone', wallLook, { fixed: true, depth: 1.8, hp: 1e9 }),
      box((x0 + x1) / 2, roofY - 0.2, x1 - x0 + 0.6, 0.4, 'stone', 'stoneBlock', { fixed: true, hp: 1e9, depth: 1.8 }),
    ],
    ropes: [],
  };
}
