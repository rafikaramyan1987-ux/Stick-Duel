import * as THREE from 'three';
import type { TerrainDef, V2 } from '../levels/types';
import type { Theme } from './theme';

/**
 * Ground pieces: the level polygon extruded into a chunky slab (dirt / stone sides) with a thick,
 * slightly overhanging top layer (grass, sand, stone…), like the Kenney Nature Kit cliff blocks.
 * Physics y is down; Three.js y is up, so every y is negated here.
 */

const matCache = new Map<number, THREE.MeshStandardMaterial>();
export function flatMat(color: number, rough = 0.9): THREE.MeshStandardMaterial {
  const key = color * 10 + Math.round(rough * 9);
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0, flatShading: true });
    matCache.set(key, m);
  }
  return m;
}

function signedArea(pts: V2[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    const q = pts[(i + 1) % pts.length]!;
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

/** Edges of the polygon whose outside faces up (the walkable surface), in physics coordinates. */
export function topEdges(t: TerrainDef): Array<[V2, V2]> {
  const pts = t.points;
  const ccw = signedArea(pts) > 0; // in y-down coordinates
  const out: Array<[V2, V2]> = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % pts.length]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const l = Math.hypot(dx, dy) || 1;
    // outward normal
    const ny = ccw ? -dx / l : dx / l;
    if (ny < -0.45) out.push([a, b]);
  }
  return out;
}

/** Height of the ground surface (physics y) at x, or +Infinity if there is none. */
export function groundAt(terrain: TerrainDef[], x: number): number {
  let best = Infinity;
  for (const t of terrain) {
    for (const [a, b] of topEdges(t)) {
      const x0 = Math.min(a.x, b.x);
      const x1 = Math.max(a.x, b.x);
      if (x < x0 || x > x1) continue;
      const k = (x - a.x) / (b.x - a.x || 1);
      best = Math.min(best, a.y + (b.y - a.y) * k);
    }
  }
  return best;
}

export function buildTerrain(t: TerrainDef, theme: Theme): THREE.Group {
  const g = new THREE.Group();
  const depth = t.depth ?? 3.2;
  const shape = new THREE.Shape(t.points.map((p) => new THREE.Vector2(p.x, -p.y)));
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.08, bevelSegments: 1, curveSegments: 1 });
  geo.translate(0, 0, -depth / 2);
  const sideColor = t.surface === 'stone' ? theme.top.stone : theme.side;
  const body = new THREE.Mesh(geo, [flatMat(t.surface === 'stone' ? shade(sideColor, 0.92) : sideColor), flatMat(t.surface === 'stone' ? shade(sideColor, 0.8) : theme.sideDark)]);
  body.receiveShadow = true;
  g.add(body);
  // stone floors get a darker brick line pattern; others a thick coloured top layer
  const topColor = theme.top[t.surface];
  const topMat = flatMat(topColor, 0.85);
  const lipMat = flatMat(shade(topColor, 0.86), 0.85);
  for (const [a, b] of topEdges(t)) {
    const dx = b.x - a.x;
    const dy = -(b.y - a.y);
    const len = Math.hypot(dx, dy);
    const ang = Math.atan2(dy, dx);
    const thick = t.surface === 'stone' ? 0.22 : 0.34;
    const slab = new THREE.Mesh(new THREE.BoxGeometry(len + 0.36, thick, depth + 0.3), [topMat, topMat, topMat, topMat, lipMat, lipMat]);
    slab.position.set((a.x + b.x) / 2, -(a.y + b.y) / 2 - thick / 2 + 0.1, 0);
    slab.rotation.z = ang;
    slab.receiveShadow = true;
    slab.castShadow = false;
    g.add(slab);
    if (t.surface === 'grass') {
      // little grass "drips" over the edge on the front face
      const n = Math.max(1, Math.floor(len / 0.9));
      for (let i = 0; i < n; i++) {
        const k = (i + 0.5) / n;
        const drip = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.22 + ((i * 37) % 5) * 0.04, 0.12), lipMat);
        drip.position.set(a.x + dx * k, -a.y + dy * k - thick, depth / 2 + 0.14);
        drip.rotation.z = ang;
        g.add(drip);
      }
    }
  }
  return g;
}

export function shade(color: number, k: number): number {
  const r = Math.min(255, Math.round(((color >> 16) & 255) * k));
  const gg = Math.min(255, Math.round(((color >> 8) & 255) * k));
  const b = Math.min(255, Math.round((color & 255) * k));
  return (r << 16) | (gg << 8) | b;
}
