import type { MaterialId } from '../physics/materials';

/**
 * Level data. Units are metres, x to the right, y DOWN (ground level is y = 0, the sky is negative y).
 * Everything happens in one vertical plane; the renderer gives each body a depth (z) for the 2.5D look.
 */
export type WorldId = 'forest' | 'castle' | 'mountains' | 'desert' | 'frozen' | 'volcano';
export type AmmoId = 'arrow' | 'fire' | 'heavy' | 'ice' | 'bomb';

export interface V2 {
  x: number;
  y: number;
}

/** What a body looks like (src/render/props.ts turns it into a 3D model). */
export type Look =
  | 'log'
  | 'boulder'
  | 'stoneBlock'
  | 'woodBeam'
  | 'woodPlank'
  | 'crate'
  | 'crateStrong'
  | 'barrelTnt'
  | 'barrelWood'
  | 'chandelier'
  | 'castleWall'
  | 'castleTower'
  | 'castleBeam'
  | 'post'
  | 'sandBlock'
  | 'sandstone'
  | 'iceBlock'
  | 'glass'
  | 'none';

interface BaseObj {
  /** Name used by ropes and AI targets. */
  id?: string;
  x: number;
  y: number;
  angle?: number;
  mat: MaterialId;
  /** Static (never moves) or dynamic. Default dynamic. */
  fixed?: boolean;
  look: Look;
  /** Visual depth (z) in metres. */
  depth?: number;
  /** Overrides the material's hit points. */
  hp?: number;
}

export interface BoxObj extends BaseObj {
  shape: 'box';
  w: number;
  h: number;
}
export interface BallObj extends BaseObj {
  shape: 'ball';
  r: number;
}
export type ObjDef = BoxObj | BallObj;

/** A solid piece of ground: a polygon (clockwise or not) with a coloured top surface. */
export interface TerrainDef {
  points: V2[];
  /** Surface style for the renderer. */
  surface: 'grass' | 'stone' | 'sand' | 'snow' | 'dark';
  /** Visual depth in metres (default 3). */
  depth?: number;
}

export interface RopeDef {
  id: string;
  /** Fixed anchor point in the world. */
  anchor: V2;
  /** Body the rope holds, and the attach point in that body's local frame. */
  body: string;
  local?: V2;
  /** Rope or chain (look only; both are cut by any arrow). */
  kind?: 'rope' | 'chain';
}

/** A rectangular pool: surface at y, from x0 to x1, bottom at y + depth. */
export interface Pool {
  x0: number;
  x1: number;
  y: number;
  depth: number;
}

export interface FighterDef {
  /** Feet position. */
  x: number;
  y: number;
  hp: number;
}

export interface LevelDef {
  id: string;
  world: WorldId;
  /** 1-based number inside the world. */
  n: number;
  /** i18n key of the level name. */
  name: string;
  /** Shots the player may fire. */
  shots: number;
  /** Shots for the second star. */
  par: number;
  /** Ammo the player has (arrow counts are included in shots; other types are limited). */
  ammo: Partial<Record<AmmoId, number>>;
  player: FighterDef;
  rival: FighterDef;
  terrain: TerrainDef[];
  objects: ObjDef[];
  ropes: RopeDef[];
  /** Camera framing (world box that must be visible). */
  view: { x0: number; x1: number; y0: number; y1: number };
  /** Below this y everything is gone (falls off the world). */
  killY: number;
  /** Lava pools: fighters touching them are K.O., bodies burn and sink. */
  lava?: Pool[];
  /** Water pools: fighters falling in are out (splash); ice arrows freeze them into platforms. */
  water?: Pool[];
  /** Horizontal wind acceleration on arrows (m/s², + is to the right). */
  wind?: number;
  /** Boss arena (bigger rival, special structure). */
  boss?: boolean;
  /** Rival look override (world look by default). */
  rivalLook?: string;
  /** Rival AI: ids of ropes / objects it may shoot at to hurt the player. */
  rivalTargets?: string[];
  /** Rival AI accuracy 0..1 (1 = perfect). */
  rivalSkill: number;
  /** Special ammo the rival may use on its targets (it always has normal arrows). */
  rivalAmmo?: AmmoId[];
  /** Tutorial / hint: the id of the rope or object the first-time hint points at. */
  hintTarget?: string;
  /** Every 4th level is a tricky one. */
  tricky?: boolean;
}
