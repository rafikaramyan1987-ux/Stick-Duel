import * as THREE from 'three';

/**
 * Particles made in code: soft round sprites (dust, smoke, fire, glow) in two Points systems
 * (normal and additive), and chunky solid bits (splinters, stone chips, ice shards, sparks, confetti)
 * in one InstancedMesh. Fixed-size pools, no allocation per frame.
 */
const SOFT_VERT = `
attribute float size;
attribute float alpha;
attribute vec3 tint;
varying float vAlpha;
varying vec3 vTint;
uniform float scale;
void main() {
  vAlpha = alpha;
  vTint = tint;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = size * scale / -mv.z;
  gl_Position = projectionMatrix * mv;
}`;
const SOFT_FRAG = `
varying float vAlpha;
varying vec3 vTint;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  if (d > 0.5) discard;
  float a = smoothstep(0.5, 0.18, d) * vAlpha;
  gl_FragColor = vec4(vTint, a);
}`;

interface Soft {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  max: number;
  size: number;
  grow: number;
  r: number;
  g: number;
  b: number;
  a: number;
  drag: number;
  lift: number;
}

class SoftSystem {
  readonly points: THREE.Points;
  private readonly items: Soft[] = [];
  private readonly pos: Float32Array;
  private readonly size: Float32Array;
  private readonly alpha: Float32Array;
  private readonly tint: Float32Array;
  private readonly mat: THREE.ShaderMaterial;
  constructor(
    private readonly cap: number,
    additive: boolean,
  ) {
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(cap * 3);
    this.size = new Float32Array(cap);
    this.alpha = new Float32Array(cap);
    this.tint = new Float32Array(cap * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('tint', new THREE.BufferAttribute(this.tint, 3).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      vertexShader: SOFT_VERT,
      fragmentShader: SOFT_FRAG,
      uniforms: { scale: { value: 600 } },
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 11 : 10;
  }
  setScale(px: number): void {
    this.mat.uniforms.scale!.value = px;
  }
  add(p: Soft): void {
    if (this.items.length >= this.cap) this.items.shift();
    this.items.push(p);
  }
  update(dt: number): void {
    const it = this.items;
    for (let i = it.length - 1; i >= 0; i--) {
      const p = it[i]!;
      p.life -= dt;
      if (p.life <= 0) {
        it.splice(i, 1);
        continue;
      }
      const d = Math.exp(-p.drag * dt);
      p.vx *= d;
      p.vy = p.vy * d + p.lift * dt;
      p.vz *= d;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.size += p.grow * dt;
    }
    const n = it.length;
    for (let i = 0; i < n; i++) {
      const p = it[i]!;
      const k = p.life / p.max;
      this.pos[i * 3] = p.x;
      this.pos[i * 3 + 1] = p.y;
      this.pos[i * 3 + 2] = p.z;
      this.size[i] = p.size;
      this.alpha[i] = p.a * Math.min(1, k * 2.2) * Math.min(1, (1 - k) * 8 + 0.2);
      this.tint[i * 3] = p.r;
      this.tint[i * 3 + 1] = p.g;
      this.tint[i * 3 + 2] = p.b;
    }
    const geo = this.points.geometry;
    geo.setDrawRange(0, n);
    for (const k of ['position', 'size', 'alpha', 'tint']) (geo.getAttribute(k) as THREE.BufferAttribute).needsUpdate = true;
  }
  clear(): void {
    this.items.length = 0;
  }
}

interface Bit {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  rx: number;
  ry: number;
  rz: number;
  wx: number;
  wy: number;
  wz: number;
  sx: number;
  sy: number;
  sz: number;
  life: number;
  max: number;
  color: THREE.Color;
  bounce: boolean;
}

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpE = new THREE.Euler();
const tmpS = new THREE.Vector3();
const tmpP = new THREE.Vector3();

class BitSystem {
  readonly mesh: THREE.InstancedMesh;
  private readonly items: Bit[] = [];
  constructor(
    private readonly cap: number,
    private readonly ground: (x: number) => number,
  ) {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.8, flatShading: true });
    this.mesh = new THREE.InstancedMesh(geo, mat, cap);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.setColorAt(0, new THREE.Color(1, 1, 1));
  }
  add(b: Bit): void {
    if (this.items.length >= this.cap) this.items.shift();
    this.items.push(b);
  }
  update(dt: number): void {
    const it = this.items;
    for (let i = it.length - 1; i >= 0; i--) {
      const b = it[i]!;
      b.life -= dt;
      if (b.life <= 0) {
        it.splice(i, 1);
        continue;
      }
      b.vy -= 14 * dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.z += b.vz * dt;
      b.rx += b.wx * dt;
      b.ry += b.wy * dt;
      b.rz += b.wz * dt;
      if (b.bounce) {
        const gy = -this.ground(b.x);
        if (b.y < gy + b.sy * 0.5 && b.vy < 0) {
          b.y = gy + b.sy * 0.5;
          b.vy *= -0.35;
          b.vx *= 0.6;
          b.vz *= 0.6;
          b.wx *= 0.5;
          b.wz *= 0.5;
        }
      }
    }
    const n = it.length;
    for (let i = 0; i < n; i++) {
      const b = it[i]!;
      const k = Math.min(1, (b.life / b.max) * 4);
      tmpE.set(b.rx, b.ry, b.rz);
      tmpQ.setFromEuler(tmpE);
      tmpS.set(b.sx * k, b.sy * k, b.sz * k);
      tmpP.set(b.x, b.y, b.z);
      tmpM.compose(tmpP, tmpQ, tmpS);
      this.mesh.setMatrixAt(i, tmpM);
      this.mesh.setColorAt(i, b.color);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
  clear(): void {
    this.items.length = 0;
  }
}

export type BitKind = 'splinter' | 'stone' | 'ice' | 'spark' | 'confetti' | 'metal' | 'sand' | 'leaf';

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

export class Fx {
  readonly group = new THREE.Group();
  private readonly soft: SoftSystem;
  private readonly glow: SoftSystem;
  private readonly bits: BitSystem;

  constructor(ground: (x: number) => number) {
    this.soft = new SoftSystem(700, false);
    this.glow = new SoftSystem(500, true);
    this.bits = new BitSystem(420, ground);
    this.group.add(this.soft.points, this.glow.points, this.bits.mesh);
  }

  /** Pixel scale for point sizes (depends on canvas height and camera FOV). */
  setScale(px: number): void {
    this.soft.setScale(px);
    this.glow.setScale(px);
  }

  update(dt: number): void {
    this.soft.update(dt);
    this.glow.update(dt);
    this.bits.update(dt);
  }

  clear(): void {
    this.soft.clear();
    this.glow.clear();
    this.bits.clear();
  }

  /* Coordinates here are Three.js world coordinates (y up). */

  dust(x: number, y: number, n = 10, color = 0xe9dcc5, spread = 1): void {
    const c = new THREE.Color(color);
    for (let i = 0; i < n; i++) {
      const a = rnd(0, Math.PI);
      const s = rnd(0.6, 2.4) * spread;
      this.soft.add({ x: x + rnd(-0.2, 0.2), y: y + rnd(0, 0.2), z: rnd(-0.6, 0.6), vx: Math.cos(a) * s, vy: Math.sin(a) * s * 0.6, vz: rnd(-0.5, 0.5), life: rnd(0.6, 1.2), max: 1.2, size: rnd(0.35, 0.7) * spread, grow: 0.8, r: c.r, g: c.g, b: c.b, a: 0.75, drag: 2.5, lift: 0.3 });
    }
  }

  smoke(x: number, y: number, n = 8, dark = 0.35, size = 1): void {
    for (let i = 0; i < n; i++) {
      const v = dark + rnd(-0.06, 0.06);
      this.soft.add({ x: x + rnd(-0.3, 0.3), y: y + rnd(-0.2, 0.3), z: rnd(-0.4, 0.4), vx: rnd(-0.6, 0.6), vy: rnd(0.6, 1.8), vz: rnd(-0.3, 0.3), life: rnd(1.2, 2.2), max: 2.2, size: rnd(0.5, 0.9) * size, grow: 0.9 * size, r: v, g: v, b: v * 1.05, a: 0.6, drag: 1.2, lift: 0.4 });
    }
  }

  fire(x: number, y: number, n = 3, size = 1): void {
    for (let i = 0; i < n; i++) {
      const hot = Math.random();
      this.glow.add({ x: x + rnd(-0.25, 0.25) * size, y: y + rnd(-0.1, 0.2), z: rnd(-0.3, 0.3) + 0.3, vx: rnd(-0.3, 0.3), vy: rnd(1, 2.4), vz: 0, life: rnd(0.35, 0.7), max: 0.7, size: rnd(0.35, 0.6) * size, grow: -0.4, r: 1, g: 0.45 + hot * 0.4, b: 0.1 + hot * 0.15, a: 0.95, drag: 1, lift: 1.2 });
    }
  }

  explosion(x: number, y: number, r: number): void {
    // flash
    this.glow.add({ x, y, z: 0.5, vx: 0, vy: 0, vz: 0, life: 0.18, max: 0.18, size: r * 1.6, grow: r * 3, r: 1, g: 0.8, b: 0.45, a: 0.7, drag: 0, lift: 0 });
    for (let i = 0; i < 34; i++) {
      const a = rnd(0, Math.PI * 2);
      const s = rnd(2, 8) * (r / 2.6);
      const hot = Math.random();
      this.glow.add({ x, y, z: rnd(-0.5, 0.5) + 0.3, vx: Math.cos(a) * s, vy: Math.sin(a) * s + 1.5, vz: rnd(-1, 1), life: rnd(0.3, 0.7), max: 0.7, size: rnd(0.5, 1), grow: -0.6, r: 1, g: 0.32 + hot * 0.4, b: 0.05 + hot * 0.1, a: 0.75, drag: 3.2, lift: 2 });
    }
    // dark smoke core so the blast reads against bright skies
    for (let i = 0; i < 10; i++) {
      const a = rnd(0, Math.PI * 2);
      const s = rnd(0.5, 2.5);
      this.soft.add({ x, y, z: 0.2, vx: Math.cos(a) * s, vy: Math.sin(a) * s + 0.8, vz: 0, life: rnd(0.8, 1.4), max: 1.4, size: rnd(0.9, 1.5), grow: 1.4, r: 0.22, g: 0.18, b: 0.18, a: 0.75, drag: 2.5, lift: 0.6 });
    }
    for (let i = 0; i < 22; i++) {
      const a = rnd(0, Math.PI * 2);
      const s = rnd(1, 4.5) * (r / 2.6);
      const v = rnd(0.25, 0.45);
      this.soft.add({ x: x + rnd(-0.4, 0.4), y: y + rnd(-0.4, 0.4), z: rnd(-0.6, 0.6), vx: Math.cos(a) * s, vy: Math.sin(a) * s + 1, vz: rnd(-0.5, 0.5), life: rnd(1.4, 2.6), max: 2.6, size: rnd(1, 1.8), grow: 1.1, r: v, g: v, b: v, a: 0.7, drag: 2, lift: 0.8 });
    }
    this.bitsBurst(x, y, 'spark', 26, 9);
  }

  bitsBurst(x: number, y: number, kind: BitKind, n: number, speed = 5, size = 1): void {
    for (let i = 0; i < n; i++) {
      const a = rnd(0, Math.PI * 2);
      const s = rnd(0.3, 1) * speed;
      let color = 0xffffff;
      let sx = 0.1;
      let sy = 0.1;
      let sz = 0.1;
      let life = rnd(0.8, 1.6);
      let bounce = true;
      switch (kind) {
        case 'splinter':
          color = Math.random() < 0.5 ? 0xd98a4e : 0xa8612f;
          sx = rnd(0.25, 0.5);
          sy = 0.07;
          sz = 0.07;
          break;
        case 'stone':
          color = Math.random() < 0.5 ? 0xdcc6a6 : 0xb49d80;
          sx = sy = sz = rnd(0.1, 0.24);
          break;
        case 'metal':
          color = Math.random() < 0.5 ? 0xf5c04a : 0x8e96a6;
          sx = sy = sz = rnd(0.06, 0.12);
          break;
        case 'ice':
          color = Math.random() < 0.5 ? 0xd6f3ff : 0x9fdcff;
          sx = rnd(0.08, 0.16);
          sy = rnd(0.2, 0.35);
          sz = 0.06;
          break;
        case 'sand':
          color = 0xf2cf8a;
          sx = sy = sz = rnd(0.06, 0.12);
          break;
        case 'leaf':
          color = Math.random() < 0.5 ? 0x6fc24a : 0x58a83e;
          sx = 0.16;
          sy = 0.02;
          sz = 0.1;
          life = rnd(1.5, 2.5);
          break;
        case 'spark':
          color = Math.random() < 0.5 ? 0xffd23f : 0xff8a3d;
          sx = sy = sz = rnd(0.05, 0.1);
          life = rnd(0.3, 0.7);
          bounce = false;
          break;
        case 'confetti': {
          const cols = [0xff5a4f, 0xffd23f, 0x4fc3f7, 0x7dd54f, 0xc77dff];
          color = cols[Math.floor(Math.random() * cols.length)]!;
          sx = 0.16;
          sy = 0.1;
          sz = 0.02;
          life = rnd(1.5, 2.6);
          break;
        }
      }
      this.bits.add({
        x,
        y,
        z: rnd(-0.4, 0.6),
        vx: Math.cos(a) * s,
        vy: Math.abs(Math.sin(a)) * s + speed * 0.4,
        vz: rnd(-1.5, 1.5),
        rx: rnd(0, 6),
        ry: rnd(0, 6),
        rz: rnd(0, 6),
        wx: rnd(-12, 12),
        wy: rnd(-12, 12),
        wz: rnd(-12, 12),
        sx: sx * size,
        sy: sy * size,
        sz: sz * size,
        life,
        max: life,
        color: new THREE.Color(color),
        bounce,
      });
    }
  }

  trail(x: number, y: number, fire: boolean): void {
    if (fire) this.fire(x, y, 1, 0.6);
    else this.soft.add({ x, y, z: 0, vx: 0, vy: 0, vz: 0, life: 0.35, max: 0.35, size: 0.18, grow: -0.2, r: 1, g: 1, b: 1, a: 0.5, drag: 0, lift: 0 });
  }
}
