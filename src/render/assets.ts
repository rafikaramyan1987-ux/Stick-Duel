import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/**
 * Kenney CC0 models (Nature Kit, Castle Kit, Platformer Kit), copied by scripts/pack-assets.mjs.
 * They are inlined into the single-file build as data URLs and loaded once at boot.
 */
const MODEL_URLS = import.meta.glob('../assets/models/*/*.glb', { query: '?url', import: 'default', eager: true }) as Record<string, string>;
const TEXTURE_URLS = import.meta.glob('../assets/models/*/colormap.png', { query: '?url', import: 'default', eager: true }) as Record<string, string>;

export type ModelName = string; // "nature/log", "castle/wall", "platformer/crate", …

const models = new Map<ModelName, THREE.Object3D>();

/** Nature Kit colours nudged to the game's palette (brighter greens, warmer bark). */
const NATURE_TINT: Record<string, number> = {
  leafsGreen: 0x62c24c,
  leafsDark: 0x3f9f4a,
  grass: 0x7dd54f,
  woodBark: 0x9b6a45,
  woodBarkDark: 0x7d5238,
  wood: 0xc98a58,
  woodInner: 0xf0d2a4,
  dirt: 0xb87c4c,
  stone: 0xc9c3b8,
  stoneDark: 0xa39d94,
};
const boxes = new Map<ModelName, THREE.Box3>();

function kitOf(path: string): string {
  const m = /models\/([^/]+)\//.exec(path);
  return m?.[1] ?? '';
}

export async function loadModels(onProgress?: (done: number, total: number) => void): Promise<void> {
  const entries = Object.entries(MODEL_URLS);
  let done = 0;
  const loaders = new Map<string, GLTFLoader>();
  for (const [path] of entries) {
    const kit = kitOf(path);
    if (loaders.has(kit)) continue;
    const tex = Object.entries(TEXTURE_URLS).find(([p]) => kitOf(p) === kit)?.[1];
    const manager = new THREE.LoadingManager();
    manager.setURLModifier((url) => (tex && url.endsWith('colormap.png') ? tex : url));
    loaders.set(kit, new GLTFLoader(manager));
  }
  await Promise.all(
    entries.map(async ([path, url]) => {
      const kit = kitOf(path);
      const name = `${kit}/${path.split('/').pop()!.replace('.glb', '')}`;
      try {
        const gltf = await loaders.get(kit)!.loadAsync(url);
        const root = gltf.scene;
        root.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh) {
            m.castShadow = true;
            m.receiveShadow = true;
            const mat = m.material as THREE.MeshStandardMaterial;
            if (mat?.map) {
              mat.map.colorSpace = THREE.SRGBColorSpace;
              mat.map.anisotropy = 4;
            }
            if (mat && kit === 'nature' && NATURE_TINT[mat.name] !== undefined) {
              mat.color.setHex(NATURE_TINT[mat.name]!);
              mat.flatShading = true;
            }
            if (mat) {
              mat.roughness = Math.max(mat.roughness ?? 1, 0.75);
              mat.metalness = 0;
            }
          }
        });
        models.set(name, root);
        boxes.set(name, new THREE.Box3().setFromObject(root));
      } catch (e) {
        console.warn('model failed', name, e);
      }
      done++;
      onProgress?.(done, entries.length);
    }),
  );
}

export function hasModel(name: ModelName): boolean {
  return models.has(name);
}

/** A copy of a model (geometry and materials are shared). */
export function model(name: ModelName): THREE.Object3D {
  const m = models.get(name);
  if (!m) return new THREE.Group();
  return m.clone(true);
}

/**
 * The model scaled (non-uniformly) so its bounding box is exactly w × h × d, centred on the origin.
 */
export function fitted(name: ModelName, w: number, h: number, d: number): THREE.Object3D {
  const box = boxes.get(name);
  const inner = model(name);
  const g = new THREE.Group();
  if (!box) return g;
  const size = box.getSize(new THREE.Vector3());
  const c = box.getCenter(new THREE.Vector3());
  inner.scale.set(w / (size.x || 1), h / (size.y || 1), d / (size.z || 1));
  inner.position.set(-c.x * inner.scale.x, -c.y * inner.scale.y, -c.z * inner.scale.z);
  g.add(inner);
  return g;
}

/**
 * Repeats a model along the longer side so tiles keep a pleasant aspect ratio (walls, beams).
 */
export function tiled(name: ModelName, w: number, h: number, d: number, unit = 1): THREE.Object3D {
  const g = new THREE.Group();
  const vertical = h >= w;
  const len = vertical ? h : w;
  const n = Math.max(1, Math.round(len / unit));
  const step = len / n;
  for (let i = 0; i < n; i++) {
    const t = vertical ? fitted(name, w, step, d) : fitted(name, step, h, d);
    const off = -len / 2 + step * (i + 0.5);
    if (vertical) t.position.y = off;
    else t.position.x = off;
    g.add(t);
  }
  return g;
}

/** A decoration placed with its base on y = 0, uniformly scaled to a height. */
export function prop(name: ModelName, height: number): THREE.Object3D {
  const box = boxes.get(name);
  const inner = model(name);
  const g = new THREE.Group();
  if (!box) return g;
  const size = box.getSize(new THREE.Vector3());
  const s = height / (size.y || 1);
  inner.scale.setScalar(s);
  const c = box.getCenter(new THREE.Vector3());
  inner.position.set(-c.x * s, -box.min.y * s, -c.z * s);
  g.add(inner);
  return g;
}
