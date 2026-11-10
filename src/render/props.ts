import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { EntDesc } from '../physics/sim';
import { fitted, hasModel, tiled } from './assets';
import { flatMat, shade } from './terrain';

/**
 * 3D models for physics bodies. Kenney models where the kits have them (crates, barrels, logs,
 * castle walls and towers); simple polished low-poly meshes in the same style for the rest
 * (TNT barrels, chandeliers, planks, posts, ice, chunks).
 */

export const COLORS = {
  wood: 0xd98a4e,
  woodDark: 0xa8612f,
  woodLight: 0xf0b276,
  stone: 0xdcc6a6,
  stoneDark: 0xb49d80,
  metal: 0x5d6475,
  gold: 0xf5c04a,
  red: 0xe5483d,
  redDark: 0xb8322b,
  yellow: 0xffd23f,
  ice: 0xbfe8ff,
  glass: 0xd6f3ff,
  rope: 0xc9a46a,
  chain: 0x80889a,
  charred: 0x4a3a33,
  sand: 0xf2cf8a,
  sandstone: 0xe7b47c,
};

const geoCache = new Map<string, THREE.BufferGeometry>();
function rbox(w: number, h: number, d: number, r = 0.06): THREE.BufferGeometry {
  const key = `rb${w.toFixed(2)}_${h.toFixed(2)}_${d.toFixed(2)}_${r}`;
  let g = geoCache.get(key);
  if (!g) {
    g = new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 3, h / 3, d / 3));
    geoCache.set(key, g);
  }
  return g;
}

function mesh(geo: THREE.BufferGeometry, color: number, rough = 0.85): THREE.Mesh {
  const m = new THREE.Mesh(geo, flatMat(color, rough));
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function plank(w: number, h: number, d: number, charred: boolean): THREE.Object3D {
  const g = new THREE.Group();
  const base = charred ? COLORS.charred : COLORS.wood;
  const n = Math.max(1, Math.round(d / 0.32));
  const step = d / n;
  for (let i = 0; i < n; i++) {
    const p = mesh(rbox(w, h, step * 0.94, 0.05), shade(base, i % 2 ? 0.92 : 1.02));
    p.position.z = -d / 2 + step * (i + 0.5);
    g.add(p);
  }
  return g;
}

function beam(w: number, h: number, d: number, charred: boolean): THREE.Object3D {
  const g = new THREE.Group();
  const base = charred ? COLORS.charred : COLORS.woodDark;
  g.add(mesh(rbox(w, h, d, 0.05), base));
  // grain stripes
  const vertical = h > w;
  const stripe = mesh(rbox(vertical ? w * 0.18 : w * 0.96, vertical ? h * 0.96 : h * 0.18, d * 1.02, 0.02), shade(base, 0.85));
  g.add(stripe);
  return g;
}

function tntBarrel(w: number, h: number, d: number): THREE.Object3D {
  const g = new THREE.Group();
  const r = Math.min(w, d) / 2;
  const body = mesh(new THREE.CylinderGeometry(r * 0.96, r * 0.96, h * 0.98, 12), COLORS.red, 0.6);
  g.add(body);
  for (const y of [-0.36, 0.36]) {
    const band = mesh(new THREE.CylinderGeometry(r * 1.02, r * 1.02, h * 0.1, 12), 0x3b3f4c, 0.5);
    band.position.y = y * h;
    g.add(band);
  }
  const stripe = mesh(new THREE.CylinderGeometry(r * 1.005, r * 1.005, h * 0.2, 12), COLORS.yellow, 0.6);
  g.add(stripe);
  // hazard mark facing the camera
  const mark = new THREE.Mesh(new THREE.CircleGeometry(r * 0.38, 3), new THREE.MeshBasicMaterial({ color: 0x24262e }));
  mark.position.set(0, 0, r * 1.03);
  mark.rotation.z = Math.PI / 2;
  g.add(mark);
  const lid = mesh(new THREE.CylinderGeometry(r * 0.8, r * 0.9, h * 0.05, 12), COLORS.redDark, 0.6);
  lid.position.y = h * 0.5;
  g.add(lid);
  return g;
}

function chandelier(w: number, h: number): THREE.Object3D {
  const g = new THREE.Group();
  const ringR = w * 0.46;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(ringR, h * 0.13, 6, 18), flatMat(COLORS.gold, 0.4));
  ring.rotation.x = Math.PI / 2;
  ring.castShadow = true;
  ring.position.y = -h * 0.15;
  g.add(ring);
  const hub = mesh(new THREE.SphereGeometry(h * 0.3, 10, 8), COLORS.gold, 0.4);
  hub.position.y = h * 0.05;
  g.add(hub);
  const top = mesh(new THREE.CylinderGeometry(h * 0.06, h * 0.06, h * 0.6, 6), COLORS.gold, 0.4);
  top.position.y = h * 0.3;
  g.add(top);
  const flameMat = new THREE.MeshBasicMaterial({ color: 0xffc63d });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const spoke = mesh(new THREE.CylinderGeometry(h * 0.04, h * 0.04, ringR, 5), COLORS.gold, 0.4);
    spoke.rotation.z = Math.PI / 2;
    spoke.rotation.y = -a;
    spoke.position.set((Math.cos(a) * ringR) / 2, -h * 0.05, (Math.sin(a) * ringR) / 2);
    g.add(spoke);
    const candle = mesh(new THREE.CylinderGeometry(h * 0.08, h * 0.08, h * 0.45, 8), 0xfff6e6, 0.7);
    candle.position.set(Math.cos(a) * ringR, h * 0.12, Math.sin(a) * ringR);
    g.add(candle);
    const flame = new THREE.Mesh(new THREE.ConeGeometry(h * 0.07, h * 0.22, 6), flameMat);
    flame.position.set(Math.cos(a) * ringR, h * 0.45, Math.sin(a) * ringR);
    flame.userData.flame = true;
    g.add(flame);
  }
  return g;
}

function postMesh(w: number, h: number, d: number): THREE.Object3D {
  const g = new THREE.Group();
  const r = Math.max(w, d) / 2;
  const p = mesh(new THREE.CylinderGeometry(r * 0.9, r, h, 7), COLORS.woodDark);
  g.add(p);
  const cap = mesh(new THREE.ConeGeometry(r * 0.95, r * 0.9, 7), shade(COLORS.woodDark, 0.85));
  cap.position.y = h / 2 + r * 0.4;
  g.add(cap);
  return g;
}

function iceBlock(w: number, h: number, d: number, glass: boolean): THREE.Object3D {
  const m = new THREE.Mesh(
    rbox(w, h, d, 0.05),
    new THREE.MeshStandardMaterial({ color: glass ? COLORS.glass : COLORS.ice, roughness: 0.15, metalness: 0, transparent: true, opacity: glass ? 0.55 : 0.82, flatShading: true }),
  );
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** A broken-off piece: a chunky, slightly irregular block in the material's colour. */
function chunk(desc: EntDesc, charred: boolean): THREE.Object3D {
  const color = charred
    ? COLORS.charred
    : desc.mat === 'stone'
      ? desc.look === 'sandstone'
        ? COLORS.sandstone
        : COLORS.stone
      : desc.mat === 'ice'
        ? COLORS.ice
        : desc.mat === 'glass'
          ? COLORS.glass
          : desc.mat === 'sand'
            ? COLORS.sand
            : desc.mat === 'crate'
              ? 0xe0894a
              : COLORS.wood;
  if (desc.mat === 'ice' || desc.mat === 'glass') return iceBlock(desc.w, desc.h, desc.depth, desc.mat === 'glass');
  const geo = new THREE.DodecahedronGeometry(0.5, 0);
  const m = mesh(geo, color);
  m.scale.set(desc.w * 1.05, desc.h * 1.05, desc.depth * 0.9);
  const g = new THREE.Group();
  g.add(m);
  return g;
}

export function buildProp(desc: EntDesc, charred = false): THREE.Object3D {
  const { w, h, depth: d } = desc;
  if (desc.chunk) return chunk(desc, charred);
  switch (desc.look) {
    case 'log': {
      if (hasModel('nature/log')) {
        const o = fitted('nature/log', w * 1.04, h * 1.04, d);
        return o;
      }
      return mesh(new THREE.CylinderGeometry(desc.r, desc.r, d, 10).rotateX(Math.PI / 2), COLORS.wood);
    }
    case 'boulder':
      return fitted('nature/rock_largeC', w * 1.1, h * 1.1, d);
    case 'crate':
      return fitted('platformer/crate', w, h, d);
    case 'crateStrong':
      return fitted('platformer/crate-strong', w, h, d);
    case 'barrelWood':
      return fitted('platformer/barrel', w, h, d);
    case 'barrelTnt':
      return tntBarrel(w, h, d);
    case 'chandelier':
      return chandelier(w, h);
    case 'castleWall':
      return tiled('castle/wall', w, h, d, 1.3);
    case 'castleTower': {
      const g = new THREE.Group();
      const body = tiled('castle/tower-square-mid-windows', w, h, d, Math.max(1.2, w * 1.1));
      g.add(body);
      return g;
    }
    case 'castleBeam':
      return tiled('castle/wall-half', w, h, d, 1.2);
    case 'sandstone':
      return tiled('castle/wall-pillar', w, h, d, 1.2);
    case 'woodPlank':
      return plank(w, h, d, charred);
    case 'woodBeam':
      return beam(w, h, d, charred);
    case 'post':
      return postMesh(w, h, d);
    case 'stoneBlock':
      return mesh(rbox(w, h, d, 0.08), COLORS.stone);
    case 'sandBlock':
      return mesh(rbox(w, h, d, 0.1), COLORS.sand);
    case 'iceBlock':
      return iceBlock(w, h, d, false);
    case 'glass':
      return iceBlock(w, h, d, true);
    default:
      return mesh(rbox(w, h, d), 0xcccccc);
  }
}

/** Rope or chain between two points (rebuilt cheaply each frame by scaling a unit cylinder). */
export class RopeView {
  readonly obj: THREE.Mesh;
  constructor(kind: 'rope' | 'chain') {
    const geo = new THREE.CylinderGeometry(1, 1, 1, 6, 1);
    geo.translate(0, 0.5, 0);
    this.obj = new THREE.Mesh(geo, flatMat(kind === 'chain' ? COLORS.chain : COLORS.rope, 0.7));
    this.obj.castShadow = true;
    this.thick = kind === 'chain' ? 0.06 : 0.05;
  }
  private readonly thick: number;
  set(ax: number, ay: number, bx: number, by: number): void {
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy);
    this.obj.position.set(ax, ay, 0);
    this.obj.scale.set(this.thick, Math.max(len, 0.001), this.thick);
    this.obj.rotation.z = Math.atan2(dy, dx) - Math.PI / 2;
  }
}
