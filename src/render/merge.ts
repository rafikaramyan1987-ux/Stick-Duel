import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Bakes a static group (scenery, terrain) into one mesh per material, so a whole backdrop of
 * Kenney trees costs a handful of draw calls instead of hundreds (60 fps on mid-range phones).
 * Meshes with custom shaders or transparency are kept as they are.
 */
export function mergeStatic(src: THREE.Object3D, castShadow: boolean, receiveShadow: boolean): THREE.Group {
  src.updateMatrixWorld(true);
  const buckets = new Map<string, { mat: THREE.Material; geos: THREE.BufferGeometry[] }>();
  const keep: THREE.Object3D[] = [];
  src.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    if (mats.some((x) => x instanceof THREE.ShaderMaterial || x.transparent)) {
      keep.push(m);
      return;
    }
    const base = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
    base.applyMatrix4(m.matrixWorld);
    const groups = Array.isArray(m.material) && base.groups.length ? base.groups : [{ start: 0, count: base.getAttribute('position').count, materialIndex: 0 }];
    for (const g of groups) {
      const mat = mats[g.materialIndex ?? 0] ?? mats[0]!;
      const part = extract(base, g.start, g.count);
      const sig = `${mat.uuid}|${Object.keys(part.attributes).sort().join(',')}`;
      let b = buckets.get(sig);
      if (!b) {
        b = { mat, geos: [] };
        buckets.set(sig, b);
      }
      b.geos.push(part);
    }
  });
  const out = new THREE.Group();
  for (const b of buckets.values()) {
    const merged = mergeGeometries(b.geos, false);
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, b.mat);
    mesh.castShadow = castShadow;
    mesh.receiveShadow = receiveShadow;
    out.add(mesh);
  }
  for (const k of keep) {
    k.updateMatrixWorld(true);
    k.matrix.copy(k.matrixWorld);
    k.matrix.decompose(k.position, k.quaternion, k.scale);
    out.add(k);
  }
  return out;
}

/** A copy of a range of vertices of a non-indexed geometry, with only position / normal / uv / color. */
function extract(geo: THREE.BufferGeometry, start: number, count: number): THREE.BufferGeometry {
  const out = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv', 'color']) {
    const a = geo.getAttribute(name) as THREE.BufferAttribute | undefined;
    if (!a) continue;
    const arr = new Float32Array(count * a.itemSize);
    for (let i = 0; i < count; i++) for (let k = 0; k < a.itemSize; k++) arr[i * a.itemSize + k] = a.getComponent(start + i, k);
    out.setAttribute(name, new THREE.BufferAttribute(arr, a.itemSize));
  }
  if (!out.getAttribute('normal')) out.computeVertexNormals();
  return out;
}
