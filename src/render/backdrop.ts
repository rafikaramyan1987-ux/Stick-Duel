import * as THREE from 'three';
import { Rng } from '../core/rng';
import type { LevelDef } from '../levels/types';
import { prop } from './assets';
import { flatMat, groundAt } from './terrain';
import type { Theme } from './theme';

/**
 * Everything behind (and a little in front of) the play plane: gradient sky, a ground plane running
 * into the distance, hills and clouds far away, and a middle layer of Kenney trees, castle towers or
 * cacti that gives the camera its parallax.
 */
export function buildSky(theme: Theme): THREE.Mesh {
  const geo = new THREE.SphereGeometry(450, 24, 12);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: { top: { value: new THREE.Color(theme.skyTop) }, bottom: { value: new THREE.Color(theme.skyBottom) } },
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 bottom; varying vec3 vP; void main(){ float h = clamp(vP.y * 2.2 + 0.05, 0.0, 1.0); gl_FragColor = vec4(mix(bottom, top, pow(h, 0.8)), 1.0); }',
  });
  const m = new THREE.Mesh(geo, mat);
  m.renderOrder = -10;
  return m;
}

function hill(color: number, x: number, z: number, w: number, h: number, seed: number): THREE.Mesh {
  const geo = new THREE.IcosahedronGeometry(1, 1);
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const r = new Rng(seed);
  for (let i = 0; i < pos.count; i++) {
    const k = 1 + r.range(-0.08, 0.08);
    pos.setXYZ(i, pos.getX(i) * k, Math.max(pos.getY(i), -0.2) * k, pos.getZ(i) * k);
  }
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, flatMat(color, 1));
  m.scale.set(w, h, w * 0.6);
  m.position.set(x, -0.5, z);
  m.receiveShadow = false;
  return m;
}

function cloud(x: number, y: number, z: number, s: number, rng: Rng): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true, emissive: 0xffffff, emissiveIntensity: 0.25 });
  const n = 3 + rng.int(0, 2);
  for (let i = 0; i < n; i++) {
    const b = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 0), mat);
    const r = rng.range(1, 1.8);
    b.scale.set(r * 1.3, r, r);
    b.position.set((i - n / 2) * 1.6 + rng.range(-0.3, 0.3), rng.range(-0.3, 0.5), rng.range(-0.3, 0.3));
    g.add(b);
  }
  g.scale.setScalar(s);
  g.position.set(x, y, z);
  return g;
}

function castleTower(h: number, roof: boolean): THREE.Group {
  const g = new THREE.Group();
  const base = prop('castle/tower-square-base', 1);
  g.add(base);
  const n = Math.max(1, Math.round(h));
  for (let i = 0; i < n; i++) {
    const mid = prop(i % 2 ? 'castle/tower-square-mid-windows' : 'castle/tower-square-mid', 1);
    mid.position.y = 1 + i;
    g.add(mid);
  }
  const top = prop(roof ? 'castle/tower-square-top-roof' : 'castle/tower-hexagon-roof', roof ? 1.2 : 1);
  top.position.y = 1 + n;
  g.add(top);
  return g;
}

export function buildBackdrop(level: LevelDef, theme: Theme): THREE.Group {
  const g = new THREE.Group();
  const rng = new Rng(level.id.split('').reduce((a, c) => a * 31 + c.charCodeAt(0), 7));
  g.add(buildSky(theme));
  const cx = (level.view.x0 + level.view.x1) / 2;
  // ground running into the distance
  const far = new THREE.Mesh(new THREE.PlaneGeometry(500, 300), flatMat(theme.far, 1));
  far.rotation.x = -Math.PI / 2;
  far.position.set(cx, -0.05, -152);
  far.receiveShadow = true;
  g.add(far);
  // hills
  for (let i = 0; i < 9; i++) {
    const c = theme.hills[i % theme.hills.length]!;
    g.add(hill(c, cx - 70 + i * 18 + rng.range(-6, 6), -55 - (i % 3) * 14, rng.range(14, 26), rng.range(6, 14), i + 3));
  }
  // clouds
  for (let i = 0; i < 6; i++) g.add(cloud(cx - 40 + i * 16 + rng.range(-4, 4), rng.range(16, 26), -60 - rng.range(0, 20), rng.range(1.4, 2.4), rng));

  const ground = (x: number) => {
    const y = groundAt(level.terrain, x);
    return Number.isFinite(y) ? -y : 0;
  };
  const x0 = level.view.x0 - 14;
  const x1 = level.view.x1 + 14;
  const place = (name: string, height: number, x: number, z: number, onGround = true) => {
    const o = prop(name, height);
    o.position.set(x, onGround ? Math.min(ground(x), 0) : 0, z);
    o.rotation.y = rng.range(-0.6, 0.6);
    g.add(o);
    return o;
  };

  if (level.world === 'forest') {
    const trees = ['nature/tree_default', 'nature/tree_oak', 'nature/tree_pineTallA', 'nature/tree_fat', 'nature/tree_pineRoundC'];
    for (let x = x0; x < x1; x += rng.range(2.4, 4)) place(rng.pick(trees), rng.range(3.5, 5.5), x, rng.range(-9, -13), false);
    for (let x = x0 - 10; x < x1 + 10; x += rng.range(2.5, 4)) place(rng.pick(trees), rng.range(5, 8), x, rng.range(-18, -26), false);
    for (let x = x0; x < x1; x += rng.range(2, 4)) place(rng.pick(['nature/plant_bushLarge', 'nature/plant_bush']), rng.range(0.7, 1.2), x, rng.range(-4.5, -6), false);
  } else if (level.world === 'castle') {
    for (let i = 0; i < 6; i++) {
      const t = castleTower(rng.int(3, 6), i % 2 === 0);
      t.scale.setScalar(rng.range(1.4, 2));
      t.position.set(x0 + 4 + i * ((x1 - x0) / 6) + rng.range(-1, 1), 0, rng.range(-14, -20));
      g.add(t);
    }
    for (let x = x0; x < x1; x += 2.4) {
      const w = prop('castle/wall', 2.6);
      w.scale.x = 2.4 / 1.9;
      w.position.set(x, 0, -11);
      g.add(w);
    }
    for (let x = x0; x < x1; x += rng.range(4, 7)) place('castle/flag-banner-long', rng.range(2, 2.8), x, -10.2, false);
    for (let x = x0; x < x1; x += rng.range(3, 6)) place(rng.pick(['nature/tree_oak', 'nature/tree_default']), rng.range(3, 4.5), x, rng.range(-5, -8), false);
  } else if (level.world === 'desert') {
    for (let x = x0; x < x1; x += rng.range(2, 4)) place(rng.pick(['nature/cactus_tall', 'nature/cactus_short']), rng.range(1.2, 2.6), x, rng.range(-4.5, -9), false);
    for (let x = x0; x < x1; x += rng.range(4, 7)) place(rng.pick(['nature/tree_palmTall', 'nature/tree_palm']), rng.range(4, 6), x, rng.range(-10, -16), false);
    for (let x = x0; x < x1; x += rng.range(6, 10)) {
      const r = place(rng.pick(['nature/rock_tallA', 'nature/rock_tallC']), rng.range(5, 9), x, rng.range(-18, -26), false);
      r.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) m.material = flatMat(0xd98c5f, 1);
      });
    }
  }
  // small details along the front edge of the ground
  const front = level.world === 'desert' ? ['nature/stone_largeA', 'nature/cactus_short'] : level.world === 'castle' ? ['nature/grass', 'nature/stone_largeA'] : ['nature/grass_large', 'nature/flower_redA', 'nature/flower_yellowA', 'nature/mushroom_red', 'nature/grass'];
  for (let x = x0; x < x1; x += rng.range(0.8, 1.8)) {
    const gy = groundAt(level.terrain, x);
    if (!Number.isFinite(gy)) continue;
    const o = prop(rng.pick(front), rng.range(0.25, 0.45));
    o.position.set(x, -gy, rng.chance(0.5) ? rng.range(1.25, 1.55) : rng.range(-1.2, -1.5));
    o.rotation.y = rng.range(0, 6);
    g.add(o);
  }
  return g;
}
