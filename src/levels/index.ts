import type { LevelDef, ObjDef, V2 } from './types';

/**
 * Hand-made arenas. y is DOWN: ground level is 0, -4 is four metres up.
 * Every level has one intended environmental solution; a direct hit only does a few points of damage.
 */

const groundSlab = (x0: number, x1: number, y = 0, bottom = 6): V2[] => [
  { x: x0, y },
  { x: x1, y },
  { x: x1, y: bottom },
  { x: x0, y: bottom },
];

const post = (x: number, groundY: number, h: number, w = 0.28, look: ObjDef['look'] = 'post'): ObjDef => ({
  shape: 'box',
  x,
  y: groundY - h / 2,
  w,
  h,
  mat: 'wood',
  fixed: true,
  look,
  depth: 0.4,
});

/* ------------------------------------------------------------------ */
/* Forest 1: cut the rope, the log rolls down the hill                 */
/* ------------------------------------------------------------------ */
const forest1: LevelDef = {
  id: 'forest-1',
  world: 'forest',
  n: 1,
  name: 'level.forest1',
  shots: 5,
  par: 1,
  ammo: { arrow: 5 },
  player: { x: 1.5, y: 0, hp: 100 },
  rival: { x: 10.6, y: 0, hp: 80 },
  terrain: [
    {
      surface: 'grass',
      points: [
        { x: -8, y: 0 },
        { x: 11.8, y: 0 },
        { x: 19.5, y: -5.4 },
        { x: 26, y: -5.4 },
        { x: 26, y: 6 },
        { x: -8, y: 6 },
      ],
    },
  ],
  objects: [
    // the rival's shelter: a post and a plank roof (blocks lobbed arrows)
    post(9.2, 0, 2.6, 0.32),
    { shape: 'box', x: 10.25, y: -2.75, w: 2.7, h: 0.3, mat: 'wood', fixed: true, look: 'woodPlank', depth: 1.4 },
    // the stake and the log held by a rope
    post(20.4, -5.4, 1.3, 0.3),
    { id: 'log', shape: 'ball', x: 17.05, y: -4.45, r: 0.62, mat: 'wood', look: 'log', hp: 999, depth: 1.5 },
  ],
  ropes: [{ id: 'rope', anchor: { x: 20.4, y: -6.4 }, body: 'log' }],
  view: { x0: -1, x1: 21.5, y0: -8, y1: 0.6 },
  killY: 12,
  rivalSkill: 0.25,
  hintTarget: 'rope',
};

/* ------------------------------------------------------------------ */
/* Castle 1: drop the chandelier                                       */
/* ------------------------------------------------------------------ */
const castle1: LevelDef = {
  id: 'castle-1',
  world: 'castle',
  n: 1,
  name: 'level.castle1',
  shots: 5,
  par: 1,
  ammo: { arrow: 5 },
  player: { x: 1.4, y: -2, hp: 100 },
  rival: { x: 13.2, y: 0, hp: 100 },
  terrain: [
    { surface: 'stone', points: groundSlab(-8, 26) },
    {
      surface: 'stone',
      points: [
        { x: -8, y: -2 },
        { x: 4, y: -2 },
        { x: 4, y: 0.2 },
        { x: -8, y: 0.2 },
      ],
    },
  ],
  objects: [
    // hall: front wall, ceiling beam, back tower
    { shape: 'box', x: 10, y: -1.15, w: 0.9, h: 2.3, mat: 'stone', fixed: true, look: 'castleWall', depth: 1.8 },
    { shape: 'box', x: 13.6, y: -6.55, w: 8.2, h: 0.6, mat: 'stone', fixed: true, look: 'castleBeam', depth: 1.6 },
    { shape: 'box', x: 17.4, y: -3.4, w: 1.6, h: 6.8, mat: 'stone', fixed: true, look: 'castleTower', depth: 1.8 },
    { id: 'chandelier', shape: 'box', x: 13.2, y: -4.35, w: 1.9, h: 0.5, mat: 'metal', look: 'chandelier', depth: 1.4 },
    // over the player: a crate the rival can drop on you
    { shape: 'box', x: -1.4, y: -4.6, w: 1.2, h: 5.2, mat: 'stone', fixed: true, look: 'castleTower', depth: 1.8 },
    { shape: 'box', x: 0.9, y: -6.9, w: 3.8, h: 0.5, mat: 'stone', fixed: true, look: 'castleBeam', depth: 1.4 },
    { id: 'crate', shape: 'box', x: 2.1, y: -4.9, w: 0.8, h: 0.8, mat: 'crate', look: 'crate' },
  ],
  ropes: [
    { id: 'chain', anchor: { x: 13.2, y: -6.25 }, body: 'chandelier', local: { x: 0, y: -0.2 }, kind: 'chain' },
    { id: 'crateRope', anchor: { x: 2.1, y: -6.65 }, body: 'crate', local: { x: 0, y: -0.4 } },
  ],
  view: { x0: -1.5, x1: 18.5, y0: -7.8, y1: 0.6 },
  killY: 12,
  rivalTargets: ['crateRope'],
  rivalSkill: 0.35,
  hintTarget: 'chain',
};

/* ------------------------------------------------------------------ */
/* Desert 1: set the barrels off                                       */
/* ------------------------------------------------------------------ */
const desert1: LevelDef = {
  id: 'desert-1',
  world: 'desert',
  n: 1,
  name: 'level.desert1',
  shots: 5,
  par: 1,
  ammo: { arrow: 4, fire: 1 },
  player: { x: 1.4, y: 0, hp: 100 },
  rival: { x: 13.6, y: -2, hp: 75 },
  terrain: [
    {
      surface: 'sand',
      points: [
        { x: -8, y: 0 },
        { x: 4.5, y: 0 },
        { x: 6.2, y: -0.9 },
        { x: 7.8, y: -0.9 },
        { x: 9.5, y: 0 },
        { x: 11.4, y: 0 },
        { x: 12, y: -2 },
        { x: 17, y: -2 },
        { x: 17.6, y: 0 },
        { x: 26, y: 0 },
        { x: 26, y: 6 },
        { x: -8, y: 6 },
      ],
    },
  ],
  objects: [
    // sandstone wall in front of the rival
    { shape: 'box', x: 12.45, y: -3.15, w: 0.7, h: 2.3, mat: 'stone', fixed: true, look: 'sandstone', depth: 1.6 },
    // TNT next to the rival
    { id: 'tnt', shape: 'box', x: 14.75, y: -2.46, w: 0.72, h: 0.9, mat: 'barrel', look: 'barrelTnt', depth: 0.72 },
    // wooden scaffold with a TNT barrel on top
    { shape: 'box', x: 15.25, y: -3.15, w: 0.24, h: 2.3, mat: 'wood', look: 'woodBeam', depth: 0.3 },
    { shape: 'box', x: 16.55, y: -3.15, w: 0.24, h: 2.3, mat: 'wood', look: 'woodBeam', depth: 0.3 },
    { shape: 'box', x: 15.9, y: -4.45, w: 1.9, h: 0.3, mat: 'wood', look: 'woodPlank', depth: 1.1 },
    { id: 'tntHigh', shape: 'box', x: 15.6, y: -5.06, w: 0.72, h: 0.9, mat: 'barrel', look: 'barrelTnt', depth: 0.72 },
    // a barrel near the player the rival can set off
    { id: 'tntPlayer', shape: 'box', x: 3.5, y: -0.46, w: 0.72, h: 0.9, mat: 'barrel', look: 'barrelTnt', depth: 0.72 },
    { shape: 'box', x: -0.6, y: -0.4, w: 0.8, h: 0.8, mat: 'crate', look: 'crate' },
  ],
  ropes: [],
  view: { x0: -1.5, x1: 18.5, y0: -7.2, y1: 0.6 },
  killY: 12,
  rivalTargets: ['tntPlayer'],
  rivalAmmo: ['fire'],
  rivalSkill: 0.3,
  hintTarget: 'tntHigh',
};

export const LEVELS: LevelDef[] = [forest1, castle1, desert1];

export function levelById(id: string): LevelDef | undefined {
  return LEVELS.find((l) => l.id === id);
}
