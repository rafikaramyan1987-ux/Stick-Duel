import * as THREE from 'three';
import type { AmmoId, LevelDef } from '../levels/types';
import type { EntDesc, Side, Sim, SimEvent } from '../physics/sim';
import type { Frame } from '../game/frame';
import { buildBackdrop } from './backdrop';
import { CharacterView, PLAYER_LOOK, RIVAL_LOOKS, type CharacterLook } from './character';
import { Fx } from './fx';
import { buildProp, RopeView } from './props';
import type { Stage } from './stage';
import { mergeStatic } from './merge';
import { buildTerrain, flatMat, groundAt } from './terrain';
import { THEMES } from './theme';

function arrowMesh(ammo: AmmoId): THREE.Object3D {
  const g = new THREE.Group();
  if (ammo === 'bomb') {
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 10), flatMat(0x2b2d36, 0.4));
    b.castShadow = true;
    g.add(b);
    const fuse = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.14, 5), flatMat(0xc9a46a));
    fuse.position.y = 0.22;
    g.add(fuse);
    return g;
  }
  const heavy = ammo === 'heavy';
  const len = heavy ? 0.85 : 0.75;
  const shaftColor = heavy ? 0x5a5f6e : 0xe7c48e;
  const headColor = ammo === 'fire' ? 0xff7a2f : ammo === 'ice' ? 0x8fdcff : heavy ? 0x3b3f4c : 0x9aa2b2;
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(heavy ? 0.035 : 0.022, heavy ? 0.035 : 0.022, len, 6), flatMat(shaftColor, 0.7));
  shaft.rotation.z = Math.PI / 2;
  shaft.castShadow = true;
  g.add(shaft);
  const head = new THREE.Mesh(new THREE.ConeGeometry(heavy ? 0.09 : 0.06, heavy ? 0.22 : 0.16, 6), ammo === 'fire' ? new THREE.MeshBasicMaterial({ color: headColor }) : flatMat(headColor, 0.4));
  head.rotation.z = -Math.PI / 2;
  head.position.x = len / 2 + 0.06;
  g.add(head);
  for (const s of [-1, 1]) {
    const f = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.06, 0.01), flatMat(ammo === 'fire' ? 0xffd23f : 0xff5a4f, 0.8));
    f.position.set(-len / 2 + 0.06, s * 0.035, 0);
    f.rotation.z = s * 0.3;
    g.add(f);
  }
  return g;
}

const charred = new Map<THREE.Material, THREE.Material>();
function charMat(m: THREE.Material): THREE.Material {
  let c = charred.get(m);
  if (!c) {
    c = m.clone();
    const sm = c as THREE.MeshStandardMaterial;
    if (sm.color) sm.color.multiplyScalar(0.32);
    charred.set(m, c);
  }
  return c;
}

export class View {
  readonly root = new THREE.Group();
  fx: Fx;
  private props = new Map<number, { obj: THREE.Object3D; charred: boolean; desc: EntDesc }>();
  private ropes = new Map<string, RopeView>();
  private stubs = new Map<string, RopeView>();
  private arrows = new Map<number, THREE.Object3D>();
  private stuck = new Map<number, THREE.Object3D>();
  chars: [CharacterView, CharacterView] | null = null;
  private dots: THREE.InstancedMesh;
  private time = 0;
  private terrainGround: (x: number) => number = () => 0;

  constructor(private readonly stage: Stage) {
    this.fx = new Fx((x) => this.terrainGround(x));
    stage.scene.add(this.root);
    stage.scene.add(this.fx.group);
    this.dots = new THREE.InstancedMesh(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthTest: false }), 60);
    this.dots.count = 0;
    this.dots.renderOrder = 20;
    this.dots.frustumCulled = false;
    stage.scene.add(this.dots);
  }

  build(level: LevelDef, sim: Sim, rivalLook?: CharacterLook): void {
    this.clear();
    const theme = THEMES[level.world];
    this.stage.applyTheme(theme);
    this.root.add(mergeStatic(buildBackdrop(level, theme), true, true));
    const terrain = new THREE.Group();
    for (const t of level.terrain) terrain.add(buildTerrain(t, theme));
    // deep earth under the arena so tall portrait views never see the underside of the ground
    const deep = new THREE.Mesh(new THREE.BoxGeometry(160, 80, 3), flatMat(theme.sideDark, 1));
    deep.position.set((level.view.x0 + level.view.x1) / 2, -45.5, -0.2);
    terrain.add(deep);
    this.root.add(mergeStatic(terrain, false, true));
    this.terrainGround = (x) => {
      const y = groundAt(level.terrain, x);
      return Number.isFinite(y) ? y : 50;
    };
    const facing0: 1 | -1 = level.rival.x >= level.player.x ? 1 : -1;
    const c0 = new CharacterView(sim.fighters[0].rag.scale, facing0, PLAYER_LOOK);
    const c1 = new CharacterView(sim.fighters[1].rag.scale, facing0 === 1 ? -1 : 1, rivalLook ?? RIVAL_LOOKS[level.world] ?? RIVAL_LOOKS.forest!);
    this.root.add(c0.root, c1.root);
    this.chars = [c0, c1];
  }

  clear(): void {
    this.root.clear();
    this.props.clear();
    this.ropes.clear();
    this.stubs.clear();
    this.arrows.clear();
    this.stuck.clear();
    this.fx.clear();
    this.chars = null;
    this.dots.count = 0;
  }

  /** Puts every mesh where the frame says. */
  sync(frame: Frame, dt: number): void {
    this.time += dt;
    const seen = new Set<number>();
    for (const e of frame.ents) {
      seen.add(e.id);
      let p = this.props.get(e.id);
      if (!p) {
        const obj = buildProp(e.desc, e.charred);
        this.root.add(obj);
        p = { obj, charred: e.charred, desc: e.desc };
        this.props.set(e.id, p);
      }
      if (e.charred && !p.charred) {
        p.charred = true;
        p.obj.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh && !(m.material instanceof THREE.MeshBasicMaterial)) m.material = Array.isArray(m.material) ? m.material.map(charMat) : charMat(m.material);
        });
      }
      p.obj.position.set(e.x, -e.y, 0);
      p.obj.rotation.z = -e.a;
      if (e.burning && Math.random() < dt * 22) {
        const w = e.desc.w * 0.8;
        this.fx.fire(e.x + (Math.random() - 0.5) * w, -e.y + e.desc.h * 0.3, 1, Math.min(1.4, 0.6 + w * 0.5));
        if (Math.random() < 0.25) this.fx.smoke(e.x, -e.y + e.desc.h * 0.6, 1, 0.3, 0.7);
      }
      if (e.fuse && Math.random() < dt * 30) this.fx.bitsBurst(e.x, -e.y + e.desc.h * 0.55, 'spark', 1, 2.5);
      if (e.desc.look === 'chandelier') {
        p.obj.traverse((o) => {
          if (o.userData.flame) o.scale.y = 0.85 + Math.sin(this.time * 18 + o.id) * 0.15;
        });
      }
    }
    for (const [id, p] of this.props) {
      if (!seen.has(id)) {
        this.root.remove(p.obj);
        this.props.delete(id);
      }
    }
    // ropes
    for (const r of frame.ropes) {
      let rv = this.ropes.get(r.id);
      if (!rv) {
        rv = new RopeView(r.kind);
        this.root.add(rv.obj);
        this.ropes.set(r.id, rv);
      }
      if (!r.cut) {
        rv.obj.visible = true;
        rv.set(r.ax, -r.ay, r.bx, -r.by);
      } else {
        rv.obj.visible = false;
        let st = this.stubs.get(r.id);
        if (!st) {
          st = new RopeView(r.kind);
          this.root.add(st.obj);
          this.stubs.set(r.id, st);
        }
        const sway = Math.sin(this.time * 3 + r.ax) * 0.12;
        st.set(r.ax, -r.ay, r.ax + sway, -r.ay - 0.55);
      }
    }
    // arrows in flight
    const live = new Set<number>();
    for (const a of frame.arrows) {
      live.add(a.id);
      let o = this.arrows.get(a.id);
      if (!o) {
        o = arrowMesh(a.ammo);
        this.root.add(o);
        this.arrows.set(a.id, o);
      }
      o.position.set(a.x, -a.y, 0.05);
      o.rotation.z = -a.a;
      this.fx.trail(a.x, -a.y, a.ammo === 'fire');
    }
    for (const [id, o] of this.arrows) {
      if (!live.has(id)) {
        this.root.remove(o);
        this.arrows.delete(id);
      }
    }
    // stuck arrows
    const st = new Set<number>();
    for (const s of frame.stuck) {
      st.add(s.id);
      let o = this.stuck.get(s.id);
      if (!o) {
        o = arrowMesh(s.ammo);
        this.root.add(o);
        this.stuck.set(s.id, o);
      }
      // push the arrow back so the tip sits in the surface
      o.position.set(s.x - Math.cos(s.a) * 0.3, -(s.y - Math.sin(s.a) * 0.3), 0.05);
      o.rotation.z = -s.a;
    }
    for (const [id, o] of this.stuck) {
      if (!st.has(id)) {
        this.root.remove(o);
        this.stuck.delete(id);
      }
    }
    if (this.chars) {
      for (let i = 0; i < 2; i++) {
        const parts = frame.parts[i as Side];
        this.chars[i as Side].sync((n) => parts[n], dt);
      }
    }
    this.fx.setScale(this.stage.pointScale());
    this.fx.update(dt);
  }

  /** Dotted aim preview (physics points). */
  showPath(points: Array<{ x: number; y: number }> | null, color = 0xffffff): void {
    if (!points) {
      this.dots.count = 0;
      return;
    }
    const m = new THREE.Matrix4();
    const n = Math.min(points.length, 60);
    (this.dots.material as THREE.MeshBasicMaterial).color.set(color);
    for (let i = 0; i < n; i++) {
      const p = points[i]!;
      const s = 1.15 - (i / n) * 0.6;
      m.makeScale(s, s, s);
      m.setPosition(p.x, -p.y, 0.3);
      this.dots.setMatrixAt(i, m);
    }
    this.dots.count = n;
    this.dots.instanceMatrix.needsUpdate = true;
  }

  /** Visual effects for simulation events (sounds and UI are handled by the game). */
  event(e: SimEvent): void {
    const y = -('y' in e ? e.y : 0);
    switch (e.t) {
      case 'impact':
        if (e.strength > 0.15) this.fx.dust(e.x, y, Math.round(4 + e.strength * 10), e.sound === 'stone' ? 0xe5d8c4 : 0xeadcc3, 0.6 + e.strength * 0.8);
        if (e.sound === 'wood' && e.strength > 0.35) this.fx.bitsBurst(e.x, y, 'splinter', 4, 3);
        if (e.sound === 'metal' && e.strength > 0.25) this.fx.bitsBurst(e.x, y, 'spark', 8, 4);
        break;
      case 'break': {
        const kind = e.charred ? 'splinter' : e.mat === 'stone' ? 'stone' : e.mat === 'ice' || e.mat === 'glass' ? 'ice' : e.mat === 'sand' ? 'sand' : 'splinter';
        this.fx.bitsBurst(e.x, y, kind, 14, 5);
        this.fx.dust(e.x, y, 10, e.charred ? 0x6b625c : 0xe9dcc5, 0.9);
        if (e.charred) this.fx.smoke(e.x, y, 4, 0.3);
        break;
      }
      case 'ropeCut':
        this.fx.bitsBurst(e.x, y, 'splinter', 5, 2.5, 0.5);
        break;
      case 'ignite':
        this.fx.fire(e.x, y, 8, 1);
        this.fx.bitsBurst(e.x, y, 'spark', 6, 3);
        break;
      case 'explode':
        this.fx.explosion(e.x, y, e.r);
        break;
      case 'stick':
        if (e.sound === 'stone') this.fx.bitsBurst(e.x, y, 'stone', 3, 2.5, 0.6);
        else if (e.sound === 'wood') this.fx.bitsBurst(e.x, y, 'splinter', 3, 2.5, 0.6);
        else if (e.sound === 'metal') this.fx.bitsBurst(e.x, y, 'spark', 6, 3);
        else if (e.sound === 'punch') this.fx.bitsBurst(e.x, y, 'spark', 5, 2.5);
        else this.fx.dust(e.x, y, 4, 0xe9dcc5, 0.5);
        break;
      case 'damage':
        if (!e.direct && e.amount > 12) this.fx.bitsBurst(e.x, y, 'spark', 10, 4);
        break;
      case 'ko':
        this.fx.bitsBurst(e.x, y + 0.6, 'spark', 16, 4);
        break;
      default:
        break;
    }
  }
}
