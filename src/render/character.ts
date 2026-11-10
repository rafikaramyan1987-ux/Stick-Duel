import * as THREE from 'three';
import { partSpecs, type PartName } from '../physics/ragdoll';
import { flatMat, shade } from './terrain';

/**
 * Chunky cartoon fighter: rounded limbs, a big head with a simple, expressive face and a hat.
 * Every mesh follows one ragdoll body; the face is turned three-quarters towards the camera.
 */
export type HatId = 'none' | 'cap' | 'crown' | 'helmet' | 'tophat' | 'headband' | 'hood' | 'turban' | 'viking' | 'wizard';
export type Face = 'normal' | 'aim' | 'hurt' | 'ko' | 'happy';

export interface CharacterLook {
  shirt: number;
  pants: number;
  skin: number;
  hat: HatId;
  hatColor: number;
}

export const PLAYER_LOOK: CharacterLook = { shirt: 0x3d8bff, pants: 0x2f3e6b, skin: 0xffd1a8, hat: 'headband', hatColor: 0xff5a4f };
export const RIVAL_LOOKS: Record<string, CharacterLook> = {
  forest: { shirt: 0x58b04a, pants: 0x5b4632, skin: 0xf5c69c, hat: 'hood', hatColor: 0x3e8a3a },
  castle: { shirt: 0xb0b8c8, pants: 0x4a4f63, skin: 0xffcfa6, hat: 'helmet', hatColor: 0xc5ccd8 },
  desert: { shirt: 0xf3e3c3, pants: 0xa7744a, skin: 0xd9a06e, hat: 'turban', hatColor: 0x7e57c2 },
  mountains: { shirt: 0x8a5a3a, pants: 0x4b3a33, skin: 0xffd0a6, hat: 'viking', hatColor: 0xa9b0bc },
  frozen: { shirt: 0x9fd8ff, pants: 0x3d5470, skin: 0xffd6b3, hat: 'cap', hatColor: 0x5ab0ff },
  volcano: { shirt: 0x5b4a6b, pants: 0x2f2838, skin: 0xe8b08a, hat: 'wizard', hatColor: 0x7e57c2 },
};

interface PartMesh {
  name: PartName;
  obj: THREE.Object3D;
  z: number;
}

export class CharacterView {
  readonly root = new THREE.Group();
  readonly parts: PartMesh[] = [];
  private readonly eyes: THREE.Object3D[] = [];
  private readonly xEyes: THREE.Object3D;
  private readonly happyEyes: THREE.Object3D;
  private readonly mouth: THREE.Mesh;
  private readonly frown: THREE.Mesh;
  readonly bow: THREE.Group;
  readonly nocked: THREE.Group;
  private face: Face = 'normal';
  private blinkT = 2 + Math.random() * 2;
  private faceT = 0;
  hat: THREE.Object3D | null = null;

  constructor(
    readonly scale: number,
    readonly facing: 1 | -1,
    look: CharacterLook,
  ) {
    const specs = partSpecs(scale);
    const skin = flatMat(look.skin, 0.75);
    const shirt = flatMat(look.shirt, 0.8);
    const pants = flatMat(look.pants, 0.8);
    const shoe = flatMat(0x3a2f2a, 0.7);
    for (const sp of specs) {
      const g = new THREE.Group();
      const back = sp.name.endsWith('B');
      const front = sp.name.endsWith('F');
      const z = back ? -0.17 * scale : front ? 0.17 * scale : 0;
      if (sp.name === 'head') {
        g.add(this.buildHead(sp.circle! * 1.12, skin, look));
      } else {
        const r = sp.name === 'torso' ? sp.hw * 1.15 : sp.hw * 1.25;
        const len = Math.max(0.01, sp.hh * 2 - r * 0.9);
        const mat = sp.name === 'torso' || sp.name.startsWith('uArm') ? shirt : sp.name.startsWith('lArm') ? skin : pants;
        const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 4, 10), back ? flatMat(shade((mat.color as THREE.Color).getHex(), 0.82), 0.8) : mat);
        m.castShadow = true;
        if (sp.name === 'torso') {
          m.scale.set(1.15, 1, 0.95);
          // belt
          const belt = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.17, r * 1.17, r * 0.35, 12), flatMat(0x4a3428, 0.7));
          belt.scale.set(1.15, 1, 0.95);
          belt.position.y = -sp.hh * 0.62;
          g.add(belt);
        }
        g.add(m);
        if (sp.name.startsWith('lArm')) {
          const hand = new THREE.Mesh(new THREE.SphereGeometry(r * 1.25, 10, 8), back ? flatMat(shade(look.skin, 0.85), 0.75) : skin);
          hand.position.y = -sp.hh;
          hand.castShadow = true;
          g.add(hand);
        }
        if (sp.name.startsWith('shin')) {
          const s = new THREE.Mesh(new THREE.SphereGeometry(r * 1.3, 10, 8), shoe);
          s.scale.set(1.6, 0.85, 1.1);
          s.position.set(this.facing * r * 0.6, -sp.hh - r * 0.2, 0);
          s.castShadow = true;
          g.add(s);
        }
      }
      g.position.z = z;
      this.root.add(g);
      this.parts.push({ name: sp.name, obj: g, z });
    }
    // bow in the front hand
    const lArm = this.part('lArmF');
    const la = specs.find((s) => s.name === 'lArmF')!;
    this.bow = new THREE.Group();
    const bowR = 0.42 * scale;
    const arc = new THREE.Mesh(new THREE.TorusGeometry(bowR, 0.035 * scale, 5, 14, Math.PI * 0.9), flatMat(0x8a4b25, 0.6));
    arc.rotation.z = -Math.PI / 2 - Math.PI * 0.45;
    arc.castShadow = true;
    this.bow.add(arc);
    const ends = [Math.PI * 0.45, -Math.PI * 0.45].map((a) => new THREE.Vector3(Math.sin(a) * bowR, -Math.cos(a) * bowR, 0));
    const strLen = ends[0]!.distanceTo(ends[1]!);
    const str = new THREE.Mesh(new THREE.CylinderGeometry(0.008 * scale, 0.008 * scale, strLen, 4), new THREE.MeshBasicMaterial({ color: 0xf5f0e6 }));
    str.rotation.z = Math.PI / 2;
    str.position.y = ends[0]!.y;
    this.bow.add(str);
    // grip in the hand: the arc bulges towards the target, the string is on the archer's side
    this.bow.position.y = -la.hh + bowR * 0.95;
    this.bow.position.z = 0.06 * scale;
    lArm.add(this.bow);
    // arrow on the string while aiming
    this.nocked = new THREE.Group();
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.018 * scale, 0.018 * scale, 0.75 * scale, 5), flatMat(0xe7c48e, 0.7));
    this.nocked.add(shaft);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.05 * scale, 0.14 * scale, 5), flatMat(0x8e96a6, 0.4));
    tip.position.y = -0.42 * scale;
    tip.rotation.z = Math.PI;
    this.nocked.add(tip);
    this.nocked.position.y = -la.hh - 0.05 * scale;
    this.nocked.position.z = 0.08 * scale;
    lArm.add(this.nocked);
    this.nocked.visible = false;

    // faces are built in buildHead
    this.xEyes = this.root.getObjectByName('xeyes')!;
    this.happyEyes = this.root.getObjectByName('happyeyes')!;
    this.mouth = this.root.getObjectByName('mouth') as THREE.Mesh;
    this.frown = this.root.getObjectByName('frown') as THREE.Mesh;
  }

  part(name: PartName): THREE.Object3D {
    return this.parts.find((p) => p.name === name)!.obj;
  }

  private buildHead(r: number, skin: THREE.Material, look: CharacterLook): THREE.Object3D {
    const head = new THREE.Group();
    const ball = new THREE.Mesh(new THREE.SphereGeometry(r, 18, 14), skin);
    ball.castShadow = true;
    head.add(ball);
    const face = new THREE.Group();
    face.rotation.y = this.facing * 0.62;
    head.add(face);
    const white = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 });
    const black = new THREE.MeshStandardMaterial({ color: 0x1d1b26, roughness: 0.3 });
    for (const sx of [-1, 1]) {
      const eye = new THREE.Group();
      const w = new THREE.Mesh(new THREE.SphereGeometry(r * 0.24, 12, 10), white);
      w.scale.set(0.85, 1.15, 0.5);
      eye.add(w);
      const p = new THREE.Mesh(new THREE.SphereGeometry(r * 0.13, 10, 8), black);
      p.position.set(this.facing * r * 0.04, -r * 0.01, r * 0.09);
      p.scale.set(1, 1.1, 0.6);
      eye.add(p);
      const shine = new THREE.Mesh(new THREE.SphereGeometry(r * 0.04, 6, 5), white);
      shine.position.set(this.facing * r * 0.07 - r * 0.02, r * 0.06, r * 0.15);
      eye.add(shine);
      eye.position.set(sx * r * 0.34, r * 0.12, r * 0.86);
      face.add(eye);
      this.eyes.push(eye);
      const brow = new THREE.Mesh(new THREE.BoxGeometry(r * 0.3, r * 0.07, r * 0.08), black);
      brow.position.set(sx * r * 0.34, r * 0.46, r * 0.84);
      brow.rotation.z = sx * -0.12;
      brow.name = 'brow';
      face.add(brow);
      const cheek = new THREE.Mesh(new THREE.SphereGeometry(r * 0.13, 8, 6), new THREE.MeshStandardMaterial({ color: 0xff8e8e, roughness: 0.8, transparent: true, opacity: 0.55 }));
      cheek.scale.set(1.2, 0.7, 0.3);
      cheek.position.set(sx * r * 0.58, -r * 0.14, r * 0.76);
      face.add(cheek);
    }
    const xe = new THREE.Group();
    xe.name = 'xeyes';
    for (const sx of [-1, 1]) {
      for (const a of [0.8, -0.8]) {
        const bar = new THREE.Mesh(new THREE.BoxGeometry(r * 0.32, r * 0.07, r * 0.06), black);
        bar.rotation.z = a;
        bar.position.set(sx * r * 0.34, r * 0.12, r * 0.94);
        xe.add(bar);
      }
    }
    xe.visible = false;
    face.add(xe);
    const he = new THREE.Group();
    he.name = 'happyeyes';
    for (const sx of [-1, 1]) {
      const arc = new THREE.Mesh(new THREE.TorusGeometry(r * 0.13, r * 0.035, 5, 10, Math.PI), black);
      arc.position.set(sx * r * 0.34, r * 0.08, r * 0.93);
      he.add(arc);
    }
    he.visible = false;
    face.add(he);
    const mouth = new THREE.Mesh(new THREE.TorusGeometry(r * 0.2, r * 0.045, 5, 12, Math.PI), black);
    mouth.rotation.z = Math.PI;
    mouth.position.set(0, -r * 0.2, r * 0.93);
    mouth.name = 'mouth';
    face.add(mouth);
    const frown = new THREE.Mesh(new THREE.TorusGeometry(r * 0.14, r * 0.04, 5, 12, Math.PI), black);
    frown.position.set(0, -r * 0.4, r * 0.9);
    frown.name = 'frown';
    frown.visible = false;
    face.add(frown);
    const nose = new THREE.Mesh(new THREE.SphereGeometry(r * 0.1, 8, 6), flatMat(shade(look.skin, 0.9), 0.7));
    nose.position.set(this.facing * r * 0.05, -r * 0.02, r * 0.98);
    face.add(nose);
    this.hat = buildHat(look.hat, look.hatColor, r, this.facing);
    if (this.hat) head.add(this.hat);
    return head;
  }

  setFace(f: Face, hold = 0): void {
    if (this.face === 'ko' && f !== 'ko') return;
    this.face = f;
    this.faceT = hold;
    this.applyFace();
  }

  resetFace(): void {
    this.face = 'normal';
    this.applyFace();
  }

  private applyFace(): void {
    const f = this.face;
    this.xEyes.visible = f === 'ko';
    this.happyEyes.visible = f === 'happy';
    for (const e of this.eyes) {
      e.visible = f === 'normal' || f === 'aim' || f === 'hurt';
      e.scale.y = f === 'hurt' ? 0.25 : 1;
    }
    if (f === 'aim' && this.eyes[0]) this.eyes[this.facing === 1 ? 0 : 1]!.scale.y = 0.45;
    this.mouth.visible = f === 'normal' || f === 'happy' || f === 'aim';
    this.mouth.scale.setScalar(f === 'happy' ? 1.35 : f === 'aim' ? 0.6 : 1);
    this.frown.visible = f === 'hurt' || f === 'ko';
  }

  /** Follows the ragdoll: (x, y, angle) per part in physics coordinates (y down). */
  sync(get: (name: PartName) => { x: number; y: number; a: number }, dt: number): void {
    for (const p of this.parts) {
      const s = get(p.name);
      p.obj.position.set(s.x, -s.y, p.z);
      p.obj.rotation.z = -s.a;
    }
    if (this.faceT > 0) {
      this.faceT -= dt;
      if (this.faceT <= 0 && this.face !== 'ko') {
        this.face = 'normal';
        this.applyFace();
      }
    }
    // blink
    this.blinkT -= dt;
    if (this.face === 'normal' || this.face === 'aim') {
      const blinking = this.blinkT < 0.12;
      for (const e of this.eyes) if (this.face === 'normal') e.scale.y = blinking ? 0.1 : 1;
      if (this.blinkT < 0) this.blinkT = 2.5 + Math.random() * 2.5;
    }
  }
}

function buildHat(id: HatId, color: number, r: number, facing: 1 | -1): THREE.Object3D | null {
  if (id === 'none') return null;
  const g = new THREE.Group();
  const m = flatMat(color, 0.7);
  const dark = flatMat(shade(color, 0.75), 0.7);
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z = 0) => {
    const o = new THREE.Mesh(geo, mat);
    o.position.set(x, y, z);
    o.castShadow = true;
    g.add(o);
    return o;
  };
  switch (id) {
    case 'cap': {
      const dome = add(new THREE.SphereGeometry(r * 1.03, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), m, 0, r * 0.15);
      dome.scale.y = 0.9;
      const brim = add(new THREE.CylinderGeometry(r * 0.6, r * 0.6, r * 0.08, 14, 1, false, 0, Math.PI), dark, facing * r * 0.55, r * 0.2);
      brim.rotation.y = facing === 1 ? Math.PI / 2 : -Math.PI / 2;
      break;
    }
    case 'crown': {
      add(new THREE.CylinderGeometry(r * 0.7, r * 0.75, r * 0.4, 8, 1, true), flatMat(0xf5c04a, 0.35), 0, r * 0.95);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        add(new THREE.ConeGeometry(r * 0.14, r * 0.3, 4), flatMat(0xf5c04a, 0.35), Math.cos(a) * r * 0.66, r * 1.28, Math.sin(a) * r * 0.66);
      }
      break;
    }
    case 'helmet': {
      const dome = add(new THREE.SphereGeometry(r * 1.08, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), flatMat(color, 0.35), 0, r * 0.05);
      dome.scale.y = 1.05;
      const crest = add(new THREE.BoxGeometry(r * 0.16, r * 0.5, r * 1.3), flatMat(0xe5483d, 0.7), 0, r * 1.1);
      crest.rotation.y = Math.PI / 2;
      const rim = add(new THREE.TorusGeometry(r * 1.06, r * 0.06, 5, 18), flatMat(shade(color, 0.8), 0.35), 0, r * 0.08);
      rim.rotation.x = Math.PI / 2;
      break;
    }
    case 'tophat': {
      add(new THREE.CylinderGeometry(r * 0.95, r * 0.95, r * 0.08, 16), m, 0, r * 0.8);
      add(new THREE.CylinderGeometry(r * 0.6, r * 0.62, r * 0.9, 16), m, 0, r * 1.25);
      add(new THREE.CylinderGeometry(r * 0.63, r * 0.63, r * 0.15, 16), flatMat(0xe5483d, 0.7), 0, r * 0.92);
      break;
    }
    case 'headband': {
      const band = add(new THREE.TorusGeometry(r * 0.98, r * 0.1, 6, 20), m, 0, r * 0.42);
      band.rotation.x = Math.PI / 2 - 0.15;
      const tail = add(new THREE.BoxGeometry(r * 0.5, r * 0.14, r * 0.06), m, -facing * r * 1.15, r * 0.3, -r * 0.2);
      tail.rotation.z = facing * 0.5;
      break;
    }
    case 'hood': {
      const hood = add(new THREE.SphereGeometry(r * 1.12, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.62), m, -facing * r * 0.05, r * 0.02);
      hood.rotation.z = facing * 0.25;
      const tip = add(new THREE.ConeGeometry(r * 0.35, r * 0.7, 8), dark, -facing * r * 0.7, r * 0.75);
      tip.rotation.z = facing * 1.1;
      break;
    }
    case 'turban': {
      for (let i = 0; i < 3; i++) {
        const t = add(new THREE.TorusGeometry(r * (0.82 - i * 0.18), r * 0.2, 6, 16), i % 2 ? dark : m, 0, r * (0.62 + i * 0.22));
        t.rotation.x = Math.PI / 2;
      }
      add(new THREE.SphereGeometry(r * 0.13, 8, 6), flatMat(0x4fc3f7, 0.3), facing * r * 0.3, r * 0.7, r * 0.75);
      break;
    }
    case 'viking': {
      const dome = add(new THREE.SphereGeometry(r * 1.06, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), flatMat(color, 0.35), 0, r * 0.12);
      dome.scale.y = 0.95;
      for (const sx of [-1, 1]) {
        const horn = add(new THREE.ConeGeometry(r * 0.18, r * 0.75, 8), flatMat(0xfff3d6, 0.6), sx * r * 0.95, r * 0.7, -r * 0.1);
        horn.rotation.z = -sx * 0.7;
      }
      break;
    }
    case 'wizard': {
      add(new THREE.CylinderGeometry(r * 1.1, r * 1.1, r * 0.08, 16), m, 0, r * 0.65);
      const cone = add(new THREE.ConeGeometry(r * 0.7, r * 1.6, 12), m, -facing * r * 0.1, r * 1.45);
      cone.rotation.z = facing * 0.18;
      add(new THREE.SphereGeometry(r * 0.12, 8, 6), flatMat(0xffd23f, 0.4), facing * r * 0.25, r * 1.2, r * 0.55);
      break;
    }
  }
  return g;
}
