import { Box, Circle, RevoluteJoint, type Body, type RevoluteJointOpt, type World } from 'planck';
import { clamp, rotate, wrapAngle, type Vec } from '../core/math';

/**
 * Active ragdoll: a chunky cartoon figure made of Planck bodies joined by revolute joints.
 * Coordinates are metres, y pointing down. A body at angle 0 "hangs": its long axis points down
 * (+y), the joint to its parent is at the top.
 *
 * While standing, joint motors hold a pose and a corrective torque keeps the torso upright. A hard hit
 * makes it go limp (it flops physically), then it stands back up where it landed. K.O. = limp for good.
 * If the floor under it disappears it simply falls (no levitation).
 */
export type PartName = 'torso' | 'head' | 'uArmF' | 'lArmF' | 'uArmB' | 'lArmB' | 'thighF' | 'shinF' | 'thighB' | 'shinB';

export interface PartSpec {
  name: PartName;
  circle?: number;
  hw: number;
  hh: number;
  parent?: PartName;
  parentAnchor?: Vec;
  anchor?: Vec;
  limits?: [number, number];
  density: number;
}

/** Ragdoll proportions: big head, short chunky limbs (s = overall scale). */
export function partSpecs(s: number): PartSpec[] {
  const t = 0.26 * s;
  const ua = 0.13 * s;
  const la = 0.13 * s;
  const th = 0.17 * s;
  const sh = 0.17 * s;
  const lw = 0.075 * s;
  const head = 0.3 * s;
  return [
    { name: 'torso', hw: 0.15 * s, hh: t, density: 3 },
    { name: 'head', circle: head, hw: head, hh: head, parent: 'torso', parentAnchor: { x: 0, y: -t }, anchor: { x: 0, y: head * 0.9 }, limits: [-0.4, 0.4], density: 1.4 },
    { name: 'uArmB', hw: lw, hh: ua, parent: 'torso', parentAnchor: { x: 0, y: -t + 0.07 * s }, anchor: { x: 0, y: -ua }, density: 1.5 },
    { name: 'lArmB', hw: lw * 0.95, hh: la, parent: 'uArmB', parentAnchor: { x: 0, y: ua }, anchor: { x: 0, y: -la }, limits: [-2.4, 0.05], density: 1.5 },
    { name: 'thighB', hw: lw * 1.15, hh: th, parent: 'torso', parentAnchor: { x: 0, y: t }, anchor: { x: 0, y: -th }, limits: [-1.8, 0.7], density: 2.2 },
    { name: 'shinB', hw: lw * 1.05, hh: sh, parent: 'thighB', parentAnchor: { x: 0, y: th }, anchor: { x: 0, y: -sh }, limits: [-0.05, 2.3], density: 2.2 },
    { name: 'thighF', hw: lw * 1.15, hh: th, parent: 'torso', parentAnchor: { x: 0, y: t }, anchor: { x: 0, y: -th }, limits: [-1.8, 0.7], density: 2.2 },
    { name: 'shinF', hw: lw * 1.05, hh: sh, parent: 'thighF', parentAnchor: { x: 0, y: th }, anchor: { x: 0, y: -sh }, limits: [-0.05, 2.3], density: 2.2 },
    { name: 'uArmF', hw: lw, hh: ua, parent: 'torso', parentAnchor: { x: 0, y: -t + 0.07 * s }, anchor: { x: 0, y: -ua }, density: 1.5 },
    { name: 'lArmF', hw: lw * 0.95, hh: la, parent: 'uArmF', parentAnchor: { x: 0, y: ua }, anchor: { x: 0, y: -la }, limits: [-2.4, 0.05], density: 1.5 },
  ];
}

export type Pose = Partial<Record<PartName, number>>;
export const STAND: Pose = { head: 0, uArmF: -0.3, lArmF: -0.4, uArmB: 0.3, lArmB: -0.35, thighF: -0.12, shinF: 0.08, thighB: 0.14, shinB: 0.06 };
export const CHEER: Pose = { head: -0.1, uArmF: -2.7, lArmF: -0.3, uArmB: 2.7, lArmB: -0.3, thighF: -0.2, shinF: 0.1, thighB: 0.2, shinB: 0.1 };

export type RagdollState = 'stand' | 'limp' | 'recover' | 'ko';

export interface Part {
  name: PartName;
  body: Body;
  spec: PartSpec;
  joint?: RevoluteJoint;
}

export class Ragdoll {
  readonly parts: Part[] = [];
  readonly byName = {} as Record<PartName, Part>;
  state: RagdollState = 'stand';
  strength = 1;
  stateTime = 0;
  pose: Pose = { ...STAND };
  totalMass = 0;
  /** Feet y while standing on something (updated when it lands). */
  footY: number;
  readonly height: number;

  constructor(
    private readonly world: World,
    x: number,
    footY: number,
    public readonly facing: 1 | -1,
    public readonly scale: number,
    group: number,
    private readonly gravity: number,
    userData: (part: PartName) => unknown,
  ) {
    this.footY = footY;
    this.height = 1.75 * scale;
    for (const sp of partSpecs(scale)) {
      const body = world.createBody({ type: 'dynamic', position: { x: 0, y: 0 }, angularDamping: 0.8, linearDamping: 0.05 });
      const shape = sp.circle ? new Circle(sp.circle) : new Box(sp.hw, sp.hh);
      body.createFixture({ shape, density: sp.density, friction: sp.name.startsWith('shin') ? 1.4 : 0.6, restitution: 0.05, filterGroupIndex: group });
      body.setUserData(userData(sp.name));
      const part: Part = { name: sp.name, body, spec: sp };
      this.parts.push(part);
      this.byName[sp.name] = part;
    }
    this.placeAt(x, footY);
    for (const p of this.parts) {
      const sp = p.spec;
      if (!sp.parent || !sp.parentAnchor) continue;
      const parent = this.byName[sp.parent];
      const anchor = parent.body.getWorldPoint(sp.parentAnchor);
      const lim = sp.limits ? this.mirrorLimits(sp.limits) : undefined;
      const joint = new RevoluteJoint(
        { referenceAngle: 0, enableLimit: !!lim, lowerAngle: lim?.[0] ?? 0, upperAngle: lim?.[1] ?? 0, enableMotor: true, maxMotorTorque: 0, motorSpeed: 0 } as RevoluteJointOpt,
        parent.body,
        p.body,
        anchor,
      );
      world.createJoint(joint);
      p.joint = joint;
    }
    this.totalMass = this.parts.reduce((m, p) => m + p.body.getMass(), 0);
  }

  private mirrorLimits([a, b]: [number, number]): [number, number] {
    return this.facing === 1 ? [a, b] : [-b, -a];
  }
  private mirror(a: number): number {
    return this.facing === 1 ? a : -a;
  }

  /** Forward kinematics: puts every part in the current pose with its feet at (x, footY). */
  placeAt(x: number, footY: number): void {
    const angles = new Map<PartName, number>([['torso', 0]]);
    const pos = new Map<PartName, Vec>([['torso', { x: 0, y: 0 }]]);
    for (const p of this.parts) {
      const sp = p.spec;
      if (!sp.parent || !sp.parentAnchor || !sp.anchor) continue;
      const pa = angles.get(sp.parent) ?? 0;
      const pp = pos.get(sp.parent) ?? { x: 0, y: 0 };
      const a = pa + this.mirror(this.pose[sp.name] ?? 0);
      const jw = rotate(sp.parentAnchor, pa);
      const ja = rotate(sp.anchor, a);
      angles.set(sp.name, a);
      pos.set(sp.name, { x: pp.x + jw.x - ja.x, y: pp.y + jw.y - ja.y });
    }
    let maxY = -Infinity;
    for (const n of ['shinF', 'shinB'] as const) {
      const sp = this.byName[n].spec;
      const p = pos.get(n) ?? { x: 0, y: 0 };
      const tip = rotate({ x: 0, y: sp.hh + sp.hw }, angles.get(n) ?? 0);
      maxY = Math.max(maxY, p.y + tip.y);
    }
    for (const p of this.parts) {
      const lp = pos.get(p.name) ?? { x: 0, y: 0 };
      p.body.setTransform({ x: x + lp.x, y: footY - maxY + lp.y - 0.01 }, angles.get(p.name) ?? 0);
      p.body.setLinearVelocity({ x: 0, y: 0 });
      p.body.setAngularVelocity(0);
      p.body.setAwake(true);
    }
  }

  get torso(): Body {
    return this.byName.torso.body;
  }
  get head(): Body {
    return this.byName.head.body;
  }

  hand(): Vec {
    const p = this.byName.lArmF;
    const w = p.body.getWorldPoint({ x: 0, y: p.spec.hh });
    return { x: w.x, y: w.y };
  }
  shoulder(): Vec {
    const t = this.byName.torso;
    const w = t.body.getWorldPoint({ x: 0, y: -t.spec.hh + 0.07 * this.scale });
    return { x: w.x, y: w.y };
  }

  /** Lowest point of the feet. */
  feetY(): number {
    let y = -Infinity;
    for (const n of ['shinF', 'shinB'] as const) {
      const p = this.byName[n];
      y = Math.max(y, p.body.getWorldPoint({ x: 0, y: p.spec.hh + p.spec.hw }).y);
    }
    return y;
  }

  isUpright(): boolean {
    return Math.abs(wrapAngle(this.torso.getAngle())) < 0.35;
  }

  /** Speed of the fastest part (to know when it has come to rest). */
  maxSpeed(): number {
    let m = 0;
    for (const p of this.parts) {
      const v = p.body.getLinearVelocity();
      m = Math.max(m, Math.hypot(v.x, v.y));
    }
    return m;
  }

  /** Distance from the torso down to the nearest solid thing that is not this ragdoll (Infinity if none). */
  private support(): number {
    const tp = this.torso.getPosition();
    const reach = this.height * 1.2;
    let best = Infinity;
    const own = new Set(this.parts.map((p) => p.body));
    for (const dx of [-0.12, 0.12]) {
      this.world.rayCast({ x: tp.x + dx * this.scale, y: tp.y }, { x: tp.x + dx * this.scale, y: tp.y + reach }, (fix, _pt, _n, frac) => {
        if (own.has(fix.getBody()) || fix.isSensor()) return -1;
        best = Math.min(best, frac * reach);
        return frac;
      });
    }
    return best;
  }

  hit(limpSeconds = 0.9): void {
    if (this.state === 'ko') return;
    this.state = 'limp';
    this.stateTime = Math.max(this.stateTime, limpSeconds);
  }
  knockOut(): void {
    this.state = 'ko';
    this.stateTime = 0;
  }
  revive(): void {
    this.state = 'recover';
    this.stateTime = 1.4;
  }

  update(dt: number): void {
    this.stateTime -= dt;
    switch (this.state) {
      case 'limp':
        this.strength = 0.03;
        if (this.stateTime <= 0 && this.maxSpeed() < 3) {
          this.state = 'recover';
          this.stateTime = 1.8;
        }
        break;
      case 'recover':
        this.strength = Math.min(1, this.strength + dt * 1.6);
        if (this.stateTime <= 0 || (this.stateTime < 1.3 && this.isUpright())) this.state = 'stand';
        break;
      case 'ko':
        this.strength = Math.max(0, this.strength - dt * 3);
        break;
      default:
        this.strength = Math.min(1, this.strength + dt * 2);
    }
    this.drive();
  }

  private drive(): void {
    const st = this.strength;
    const ko = this.state === 'ko';
    for (const p of this.parts) {
      const j = p.joint;
      if (!j) continue;
      const target = this.mirror(this.pose[p.name] ?? 0);
      const err = wrapAngle(target - j.getJointAngle());
      const leg = p.name.startsWith('thigh') || p.name.startsWith('shin');
      const base = leg ? 160 : p.name === 'head' ? 30 : 40;
      j.setMaxMotorTorque(ko ? 0.3 : base * this.scale * this.scale * Math.max(st, 0.02));
      j.setMotorSpeed(clamp(err * 16, -18, 18));
    }
    if (ko || st < 0.1) return;
    const torso = this.torso;
    const sup = this.support();
    const grounded = sup < this.height * 0.85;
    // keep the torso upright while there is something to stand on
    const a = wrapAngle(torso.getAngle());
    const w = torso.getAngularVelocity();
    const inertia = this.totalMass * this.height * this.height * 0.3;
    const upright = grounded ? 1 : 0.25;
    torso.applyTorque((-a * 55 - w * 10) * inertia * st * upright, true);
    // stand-up assist (puppet string) only when the feet can reach the ground
    if (this.state === 'recover' && grounded) {
      const tv = torso.getLinearVelocity();
      const standDist = this.height * 0.5;
      const below = standDist - sup;
      if (below > 0) {
        const lift = this.totalMass * this.gravity * clamp(0.9 + below * 2, 0, 1.6) * st;
        torso.applyForceToCenter({ x: 0, y: -lift - tv.y * this.totalMass * 3 }, true);
      }
    }
    if (this.state === 'stand' && grounded) this.footY = this.feetY();
  }

  destroy(): void {
    for (const p of this.parts) this.world.destroyBody(p.body);
  }
}
