import { Box, Chain, Circle, RopeJoint, World, type Body, type Contact, type Fixture, type Joint } from 'planck';
import { clamp, wrapAngle, type Vec } from '../core/math';
import { Rng } from '../core/rng';
import type { AmmoId, Look, LevelDef, ObjDef, RopeDef } from '../levels/types';
import { MATERIALS, type MaterialId } from './materials';
import { Ragdoll, STAND, type PartName } from './ragdoll';

/**
 * The Topple Duel world: a deterministic Planck (Box2D) simulation stepped at a fixed 60 Hz.
 * It knows nothing about rendering, input or turns; the same code runs in the game, the rival AI
 * and the level checker (Node), so a level that the checker solves can be solved in the game.
 *
 * Units: metres, kilograms (per metre of depth), seconds. y points DOWN.
 */
export const DT = 1 / 60;
export const GRAVITY = 10;
export const FIGHTER_SCALE = 1.35;
export const MIN_SPEED = 7;
export const MAX_SPEED = 21;

export type Side = 0 | 1;

export interface AmmoDef {
  id: AmmoId;
  /** Multiplier on the zone damage of a direct hit (head 35, body 20, arm/leg 10 at full speed). */
  direct: number;
  /** Push impulse per (m/s) of arrow speed. */
  push: number;
  /** Damage to breakable bodies on a hit. */
  crack: number;
  radius: number;
}

export const AMMO: Record<AmmoId, AmmoDef> = {
  arrow: { id: 'arrow', direct: 1, push: 0.22, crack: 22, radius: 0.05 },
  fire: { id: 'fire', direct: 0.9, push: 0.18, crack: 12, radius: 0.05 },
  heavy: { id: 'heavy', direct: 1.25, push: 1.3, crack: 55, radius: 0.08 },
  ice: { id: 'ice', direct: 0.9, push: 0.2, crack: 12, radius: 0.05 },
  bomb: { id: 'bomb', direct: 0, push: 0, crack: 0, radius: 0.16 },
};

export type HitZone = 'head' | 'body' | 'limb';
/** Damage of a direct hit at full speed, by zone. */
export const ZONE_DAMAGE: Record<HitZone, number> = { head: 35, body: 20, limb: 10 };
/** The most damage the environment can do to one fighter during one shot: a trap never K.O.s a full-HP fighter. */
export const TRAP_CAP = 80;
/** Falling out of the arena, into lava or into deep water: this much damage, then back to the start spot. */
export const HAZARD_DAMAGE = 35;
/** Things that fall or blow up hurt fighters by mass and speed, scaled so a big trap lands at 40–80. */
export const TRAP_SCALE = 0.6;

export const zoneOf = (part: PartName): HitZone => (part === 'head' ? 'head' : part === 'torso' ? 'body' : 'limb');
/** Slow arrows hurt less: 50 % at the slowest, 100 % from about 85 % power. */
export const speedFactor = (speed: number): number => clamp(0.3 + (0.7 * speed) / (MAX_SPEED * 0.92), 0.5, 1);

export interface EntDesc {
  shape: 'box' | 'ball';
  w: number;
  h: number;
  r: number;
  look: Look;
  mat: MaterialId;
  depth: number;
  fixed: boolean;
  chunk: boolean;
}

export interface Ent {
  id: number;
  name?: string;
  desc: EntDesc;
  body: Body;
  hp: number;
  /** Seconds burning (-1 = not burning). */
  burning: number;
  /** Seconds until it explodes (-1 = no fuse). */
  fuse: number;
  /** Seconds since it was created (chunks fade out). */
  age: number;
  dead: boolean;
  /** Charred (burnt chunks look dark). */
  charred: boolean;
  /** Hit by an ice arrow: slippery (and looks frosted). */
  frozen: boolean;
  /** Seconds spent in lava. */
  inLava: number;
  /** Swings for ever on its rope (a moving target); does not keep the turn from ending. */
  swinging?: boolean;
  /** A trap load: the damage it does to a fighter on a solid hit (by design, 40–80). */
  hurts?: number;
}

/** A water pool at runtime. */
export interface WaterState {
  x0: number;
  x1: number;
  y: number;
  depth: number;
  frozen: boolean;
}

export interface Rope {
  id: string;
  def: RopeDef;
  joint: Joint | null;
  ent: Ent;
  local: Vec;
  /** World position of the loose end after it was cut (for the dangling look). */
  cutAt: number;
}

export interface Arrow {
  id: number;
  ammo: AmmoId;
  side: Side;
  body: Body;
  prev: Vec;
  age: number;
  alive: boolean;
}

export interface Stuck {
  id: number;
  ammo: AmmoId;
  /** Attached to an entity / fighter part, or to the static world (null). */
  ent: Ent | null;
  part: { side: Side; name: PartName } | null;
  local: Vec;
  angle: number;
  age: number;
}

export type SimEvent =
  | { t: 'shot'; side: Side; ammo: AmmoId; x: number; y: number; angle: number; power: number }
  | { t: 'impact'; x: number; y: number; sound: string; strength: number }
  | { t: 'break'; x: number; y: number; mat: MaterialId; size: number; charred: boolean }
  | { t: 'ropeCut'; id: string; x: number; y: number }
  | { t: 'ignite'; x: number; y: number }
  | { t: 'explode'; x: number; y: number; r: number }
  | { t: 'damage'; side: Side; amount: number; x: number; y: number; direct: boolean; hp: number; zone?: HitZone }
  | { t: 'respawn'; side: Side; x: number; y: number }
  | { t: 'ko'; side: Side; x: number; y: number }
  | { t: 'stick'; x: number; y: number; sound: string; ammo: AmmoId }
  | { t: 'fall'; x: number; y: number }
  | { t: 'splash'; x: number; y: number; big: boolean }
  | { t: 'freeze'; x: number; y: number; w: number }
  | { t: 'frost'; x: number; y: number }
  | { t: 'lava'; x: number; y: number };

export interface Fighter {
  side: Side;
  rag: Ragdoll;
  hp: number;
  maxHp: number;
  alive: boolean;
  group: number;
  /** Aim used for the arm pose (radians, screen angle, y down). */
  aim: number | null;
  lastHit: Map<number, number>;
}

/** What happened during one shot (stars, tricks, replay). */
export interface ShotStats {
  side: Side;
  ropes: number;
  breaks: number;
  explosions: number;
  ignites: number;
  /** Damage dealt to the other fighter by the arrow itself. */
  direct: number;
  /** Damage dealt to the other fighter by the environment. */
  env: number;
  /** Damage the shooter did to themself. */
  self: number;
  kill: boolean;
  /** The K.O. came from the environment (a trap), not from the arrow itself. */
  trapKill: boolean;
  /** Environment damage per fighter during this shot (capped at TRAP_CAP). */
  envTo: [number, number];
  heads: number;
}

interface BodyTag {
  kind: 'ent' | 'part' | 'arrow' | 'terrain' | 'anchor';
  ent?: Ent;
  side?: Side;
  part?: PartName;
  arrow?: Arrow;
}

interface PendingHit {
  arrow: Arrow;
  other: Body;
  point: Vec;
}

const tag = (b: Body): BodyTag => (b.getUserData() as BodyTag | null) ?? { kind: 'terrain' };

export class Sim {
  readonly world: World;
  readonly ents: Ent[] = [];
  readonly ropes: Rope[] = [];
  readonly arrows: Arrow[] = [];
  readonly stuck: Stuck[] = [];
  readonly fighters: [Fighter, Fighter];
  readonly events: SimEvent[] = [];
  readonly rng: Rng;
  time = 0;
  steps = 0;
  /** Damage is off during the warm-up that lets the level settle. */
  damageOn = false;
  stats: ShotStats | null = null;
  /** Seconds everything has been at rest. */
  quiet = 0;
  readonly water: WaterState[];
  readonly wind: number;
  nextId = 1;
  private readonly anchor: Body;
  private pendingHits: PendingHit[] = [];
  private breakQueue = new Set<Ent>();
  private explodeQueue: Array<{ x: number; y: number; r: number; power: number; hurt: number }> = [];
  private impactCooldown = new Map<number, number>();

  /**
   * A copy of the world at rest (between turns), for the rival AI and the level checker to try shots
   * without touching the real game. Contact warm-starting is not copied, so a clone can drift a tiny
   * bit from the original: anything the checker finds is verified again from scratch.
   */
  clone(): Sim {
    const c = new Sim(this.level, 1);
    c.rng.state = this.rng.state;
    c.time = this.time;
    c.steps = this.steps;
    c.quiet = this.quiet;
    c.damageOn = this.damageOn;
    c.stats = this.stats ? { ...this.stats, envTo: [...this.stats.envTo] } : null;
    c.envFree = [...this.envFree];
    c.trapCap = this.trapCap;
    c.impactCooldown = new Map(this.impactCooldown);
    const src = new Map(this.ents.filter((e) => !e.dead).map((e) => [e.id, e]));
    for (const e of c.ents.slice()) if (!src.has(e.id)) c.removeEnt(e);
    const have = new Set(c.ents.filter((e) => !e.dead).map((e) => e.id));
    for (const e of src.values()) {
      if (have.has(e.id)) continue;
      const d = e.desc;
      const n = c.addObj(
        { shape: d.shape, x: 0, y: 0, w: d.w, h: d.h, r: d.r, mat: d.mat, look: d.look, depth: d.depth, fixed: d.fixed } as ObjDef,
        d.chunk,
        e.charred,
      );
      n.id = e.id;
    }
    const byId = new Map(c.ents.filter((e) => !e.dead).map((e) => [e.id, e]));
    for (const e of src.values()) {
      const n = byId.get(e.id)!;
      n.body.setTransform(e.body.getPosition(), e.body.getAngle());
      n.body.setLinearVelocity(e.body.getLinearVelocity());
      n.body.setAngularVelocity(e.body.getAngularVelocity());
      n.body.setAwake(e.body.isAwake());
      n.hp = e.hp;
      n.burning = e.burning;
      n.fuse = e.fuse;
      n.age = e.age;
      n.charred = e.charred;
      n.inLava = e.inLava;
      n.name = e.name;
      if (e.frozen) {
        n.frozen = true;
        for (let f = n.body.getFixtureList(); f; f = f.getNext()) f.setFriction(0.02);
      }
    }
    c.nextId = this.nextId;
    this.ropes.forEach((r, i) => {
      const cr = c.ropes[i]!;
      if (!r.joint && cr.joint) {
        c.world.destroyJoint(cr.joint);
        cr.joint = null;
        cr.cutAt = r.cutAt;
      }
    });
    this.water.forEach((w, i) => (c.water[i]!.frozen = w.frozen));
    this.fighters.forEach((f, i) => {
      const g = c.fighters[i]!;
      g.hp = f.hp;
      g.maxHp = f.maxHp;
      g.alive = f.alive;
      g.aim = f.aim;
      g.lastHit = new Map(f.lastHit);
      const r = f.rag;
      const q = g.rag;
      q.state = r.state;
      q.strength = r.strength;
      q.stateTime = r.stateTime;
      q.pose = { ...r.pose };
      q.footY = r.footY;
      r.parts.forEach((p, k) => {
        const b = q.parts[k]!.body;
        b.setTransform(p.body.getPosition(), p.body.getAngle());
        b.setLinearVelocity(p.body.getLinearVelocity());
        b.setAngularVelocity(p.body.getAngularVelocity());
        b.setAwake(true);
      });
    });
    c.events.length = 0;
    return c;
  }

  constructor(
    readonly level: LevelDef,
    seed = 1,
  ) {
    this.rng = new Rng(seed);
    this.water = (level.water ?? []).map((w) => ({ ...w, frozen: false }));
    this.wind = level.wind ?? 0;
    this.world = new World({ gravity: { x: 0, y: GRAVITY }, allowSleep: true });
    this.anchor = this.world.createBody({ type: 'static' });
    this.anchor.setUserData({ kind: 'anchor' } satisfies BodyTag);
    for (const t of level.terrain) {
      const b = this.world.createBody({ type: 'static' });
      b.createFixture({ shape: new Chain(t.points, true), friction: MATERIALS.ground.friction, restitution: 0.02 });
      b.setUserData({ kind: 'terrain' } satisfies BodyTag);
    }
    for (const o of level.objects) this.addObj(o);
    for (const r of level.ropes) this.addRope(r);
    this.fighters = [this.makeFighter(0), this.makeFighter(1)];
    this.world.on('pre-solve', (c) => this.preSolve(c));
    this.world.on('begin-contact', (c) => this.beginContact(c));
    this.world.on('post-solve', (c, imp) => this.postSolve(c, imp.normalImpulses));
  }

  /** Lets stacked structures settle before play starts (no damage, no events). */
  warmUp(seconds = 1.2): void {
    this.damageOn = false;
    const n = Math.round(seconds / DT);
    for (let i = 0; i < n; i++) this.step();
    this.events.length = 0;
    this.damageOn = true;
  }

  private makeFighter(side: Side): Fighter {
    const def = side === 0 ? this.level.player : this.level.rival;
    const other = side === 0 ? this.level.rival : this.level.player;
    const facing: 1 | -1 = other.x >= def.x ? 1 : -1;
    const group = side === 0 ? -1 : -2;
    const rag = new Ragdoll(this.world, def.x, def.y, facing, FIGHTER_SCALE, group, GRAVITY, (part) => ({ kind: 'part', side, part }) satisfies BodyTag);
    return { side, rag, hp: def.hp, maxHp: def.hp, alive: true, group, aim: null, lastHit: new Map() };
  }

  addObj(o: ObjDef, chunk = false, charred = false): Ent {
    const mat = MATERIALS[o.mat];
    const body = this.world.createBody({ type: o.fixed ? 'static' : 'dynamic', position: { x: o.x, y: o.y }, angle: o.angle ?? 0, angularDamping: o.shape === 'ball' ? 0.4 : 0.15, linearDamping: 0.02 });
    const shape = o.shape === 'ball' ? new Circle(o.r) : new Box(o.w / 2, o.h / 2);
    body.createFixture({ shape, density: mat.density, friction: mat.friction, restitution: mat.restitution });
    const desc: EntDesc = {
      shape: o.shape,
      w: o.shape === 'box' ? o.w : o.r * 2,
      h: o.shape === 'box' ? o.h : o.r * 2,
      r: o.shape === 'ball' ? o.r : 0,
      look: o.look,
      mat: o.mat,
      depth: o.depth ?? (o.shape === 'ball' ? 1.2 : clamp(Math.min(o.w, o.h) * 1.2, 0.6, 1.6)),
      fixed: !!o.fixed,
      chunk,
    };
    const ent: Ent = { id: this.nextId++, name: o.id, desc, body, hp: o.hp ?? mat.hp ?? Infinity, burning: -1, fuse: -1, age: 0, dead: false, charred, frozen: false, inLava: 0, hurts: chunk ? undefined : o.hurts };
    body.setUserData({ kind: 'ent', ent } satisfies BodyTag);
    this.ents.push(ent);
    return ent;
  }

  private addRope(r: RopeDef): void {
    const ent = this.ents.find((e) => e.name === r.body);
    if (!ent) throw new Error(`rope ${r.id}: no body ${r.body}`);
    const local = r.local ?? { x: 0, y: 0 };
    const wp = ent.body.getWorldPoint(local);
    const len = Math.hypot(wp.x - r.anchor.x, wp.y - r.anchor.y);
    const joint = this.world.createJoint(
      new RopeJoint({ maxLength: len, localAnchorA: r.anchor, localAnchorB: local, collideConnected: false, bodyA: this.anchor, bodyB: ent.body }),
    );
    this.ropes.push({ id: r.id, def: r, joint, ent, local, cutAt: -1 });
    if (r.swing) {
      // a moving target: no damping, pushed sideways once
      ent.swinging = true;
      ent.body.setAngularDamping(0.3);
      ent.body.setLinearDamping(0);
      ent.body.setLinearVelocity({ x: r.swing, y: 0 });
      return;
    }
    // a hanging load comes to rest instead of swinging for ever (normal damping once it is cut)
    ent.body.setAngularDamping(2);
    ent.body.setLinearDamping(0.4);
  }

  entByName(name: string): Ent | undefined {
    return this.ents.find((e) => e.name === name && !e.dead);
  }
  rope(id: string): Rope | undefined {
    return this.ropes.find((r) => r.id === id);
  }
  ropeEnds(r: Rope): [Vec, Vec] {
    const b = r.ent.body.getWorldPoint(r.local);
    return [r.def.anchor, { x: b.x, y: b.y }];
  }

  /* ------------------------------------------------------------------ */
  /* Shooting                                                            */
  /* ------------------------------------------------------------------ */

  /** Where a shot from this fighter starts. */
  muzzle(side: Side, angle: number): Vec {
    const f = this.fighters[side];
    const s = f.rag.shoulder();
    return { x: s.x + Math.cos(angle) * 0.62 * FIGHTER_SCALE, y: s.y + Math.sin(angle) * 0.62 * FIGHTER_SCALE };
  }

  static speedFor(power: number): number {
    return MIN_SPEED + (MAX_SPEED - MIN_SPEED) * clamp(power, 0, 1);
  }

  /** `volley`: an extra arrow of the same turn (a boss volley): the shot's stats go on. */
  fire(side: Side, angle: number, power: number, ammo: AmmoId, volley = false): Arrow {
    const p = this.muzzle(side, angle);
    const speed = Sim.speedFor(power);
    const def = AMMO[ammo];
    const body = this.world.createBody({ type: 'dynamic', position: p, bullet: true, fixedRotation: true });
    body.createFixture({ shape: new Circle(def.radius), density: 2, friction: 0, restitution: 0, filterGroupIndex: this.fighters[side].group });
    body.setLinearVelocity({ x: Math.cos(angle) * speed, y: Math.sin(angle) * speed });
    const arrow: Arrow = { id: this.nextId++, ammo, side, body, prev: { ...p }, age: 0, alive: true };
    body.setUserData({ kind: 'arrow', arrow } satisfies BodyTag);
    this.arrows.push(arrow);
    if (!volley || !this.stats) {
      this.stats = { side, ropes: 0, breaks: 0, explosions: 0, ignites: 0, direct: 0, env: 0, self: 0, kill: false, trapKill: false, envTo: [0, 0], heads: 0 };
      this.envFree = [0, 0];
    }
    this.events.push({ t: 'shot', side, ammo, x: p.x, y: p.y, angle, power });
    // recoil pose: arm stays pointing for a moment
    this.fighters[side].aim = angle;
    return arrow;
  }

  /** Points of the flight path the aim preview shows (same integrator as Planck: semi-implicit Euler). */
  previewPath(side: Side, angle: number, power: number, seconds: number): Vec[] {
    const p = this.muzzle(side, angle);
    const speed = Sim.speedFor(power);
    let vx = Math.cos(angle) * speed;
    let vy = Math.sin(angle) * speed;
    let x = p.x;
    let y = p.y;
    const out: Vec[] = [{ x, y }];
    const n = Math.round(seconds / DT);
    for (let i = 0; i < n; i++) {
      vy += GRAVITY * DT;
      vx += this.wind * DT;
      x += vx * DT;
      y += vy * DT;
      if (i % 3 === 2) out.push({ x, y });
    }
    return out;
  }

  setAim(side: Side, angle: number | null): void {
    this.fighters[side].aim = angle;
  }

  /* ------------------------------------------------------------------ */
  /* Contacts                                                            */
  /* ------------------------------------------------------------------ */

  private preSolve(c: Contact): void {
    const fa = c.getFixtureA();
    const fb = c.getFixtureB();
    const ta = tag(fa.getBody());
    const tb = tag(fb.getBody());
    if (ta.kind === 'arrow' || tb.kind === 'arrow') {
      c.setEnabled(false);
      const [at, other] = ta.kind === 'arrow' ? [ta, fb.getBody()] : [tb, fa.getBody()];
      const arrow = at.arrow;
      if (!arrow || !arrow.alive) return;
      if (tag(other).kind === 'arrow') return;
      if (this.pendingHits.some((h) => h.arrow === arrow)) return;
      const wm = c.getWorldManifold(null);
      const pt = wm?.points[0] ?? arrow.body.getPosition();
      this.pendingHits.push({ arrow, other, point: { x: pt.x, y: pt.y } });
    }
  }

  private beginContact(c: Contact): void {
    if (!this.damageOn) return;
    const ba = c.getFixtureA().getBody();
    const bb = c.getFixtureB().getBody();
    const ta = tag(ba);
    const tb = tag(bb);
    if (ta.kind === 'arrow' || tb.kind === 'arrow') return;
    const wm = c.getWorldManifold(null);
    if (!wm || wm.points.length === 0) return;
    const p = wm.points[0]!;
    const n = wm.normal;
    const va = ba.getLinearVelocityFromWorldPoint(p);
    const vb = bb.getLinearVelocityFromWorldPoint(p);
    const vn = Math.abs((va.x - vb.x) * n.x + (va.y - vb.y) * n.y);
    // impact sounds / dust
    if (vn > 1.6) {
      const key = Math.min(ba === this.anchor ? 0 : this.idOf(ba), this.idOf(bb)) * 100003 + Math.max(this.idOf(ba), this.idOf(bb));
      const last = this.impactCooldown.get(key) ?? -1;
      if (this.time - last > 0.18) {
        this.impactCooldown.set(key, this.time);
        const heavier = ba.getMass() >= bb.getMass() ? ta : tb;
        const snd = heavier.kind === 'ent' && heavier.ent ? MATERIALS[heavier.ent.desc.mat].sound : heavier.kind === 'part' ? 'soft' : 'soft';
        const m = Math.max(ba.getMass(), bb.getMass());
        const strength = clamp((vn - 1.5) * Math.sqrt(Math.max(m, 0.5)) / 18, 0.05, 1);
        if (ta.kind !== 'part' || tb.kind !== 'part') this.events.push({ t: 'impact', x: p.x, y: p.y, sound: snd, strength });
      }
    }
    // things hurt by their own speed (a fighter flopping onto a resting crate is not hit by it)
    const own = (v: Vec) => Math.abs(v.x * n.x + v.y * n.y);
    if (ta.kind === 'part') this.fighterImpact(ta.side!, bb, tb, vn, p, own(vb));
    if (tb.kind === 'part') this.fighterImpact(tb.side!, ba, ta, vn, p, own(va));
  }

  private idOf(b: Body): number {
    const t = tag(b);
    if (t.kind === 'ent') return t.ent!.id;
    if (t.kind === 'part') return 900000 + (t.side ?? 0);
    return 0;
  }

  /** Damage from things hitting a fighter: grows with the mass and the impact speed. */
  private fighterImpact(side: Side, other: Body, ot: BodyTag, vn: number, p: Vec, vOther: number): void {
    const f = this.fighters[side];
    if (!f.alive) return;
    if (ot.kind === 'part' && ot.side === side) return;
    let dmg = 0;
    let key: number;
    if (other.isStatic() || ot.kind === 'terrain' || ot.kind === 'anchor' || ot.ent?.desc.fixed) {
      // falling onto the ground
      if (vn > 7.5) dmg = (vn - 7.5) * 5 * TRAP_SCALE;
      key = -1;
    } else if (ot.kind === 'part') {
      return;
    } else {
      const m = Math.min(other.getMass(), 60);
      const v = Math.min(vn, vOther);
      const hurts = ot.ent?.hurts;
      // a trap load does its designed damage on a solid hit (less when it only bumps you)
      if (hurts) dmg = v > 1.5 ? hurts * clamp((v - 1.5) / 3.5, 0.3, 1) : 0;
      else if (v > 2) dmg = 6.5 * Math.sqrt(m) * Math.pow(v - 2, 1.3) * TRAP_SCALE;
      key = ot.ent?.id ?? 0;
    }
    if (dmg < 3) return;
    // the same body hurts the same fighter at most once every 2.5 s (no damage from resting on you)
    const last = f.lastHit.get(key) ?? -9;
    if (this.time - last < 2.5) return;
    f.lastHit.set(key, this.time);
    this.hurt(side, dmg, p, false);
    if (dmg > 6) f.rag.hit(clamp(dmg / 40, 0.5, 1.5));
  }

  private postSolve(c: Contact, impulses: number[]): void {
    if (!this.damageOn) return;
    const imp = (impulses[0] ?? 0) + (impulses[1] ?? 0);
    for (const b of [c.getFixtureA().getBody(), c.getFixtureB().getBody()]) {
      const t = tag(b);
      const e = t.ent;
      if (!e || e.dead || e.desc.chunk) continue;
      const mat = MATERIALS[e.desc.mat];
      if (imp > mat.toughness) {
        if (mat.explosive) {
          if (e.fuse < 0) e.fuse = 0.05;
          continue;
        }
        if (!Number.isFinite(e.hp)) continue;
        e.hp -= (imp - mat.toughness) * 0.9;
        if (e.hp <= 0) this.breakQueue.add(e);
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* Damage, breaking, fire, explosions                                  */
  /* ------------------------------------------------------------------ */

  hurt(side: Side, amount: number, p: Vec, direct: boolean, zone?: HitZone): void {
    const f = this.fighters[side];
    if (!f.alive || !this.damageOn) return;
    let dmg = Math.round(amount);
    const st = this.stats;
    // traps: at most TRAP_CAP per fighter per shot, whatever piles up
    if (!direct) {
      const used = st ? st.envTo[side] : this.envFree[side];
      dmg = Math.min(dmg, this.trapCap - used);
      if (st) st.envTo[side] += Math.max(0, dmg);
      else this.envFree[side] += Math.max(0, dmg);
    }
    if (dmg <= 0) return;
    f.hp = Math.max(0, f.hp - dmg);
    if (st) {
      if (side === st.side) st.self += dmg;
      else if (direct) st.direct += dmg;
      else st.env += dmg;
      if (zone === 'head' && side !== st.side) st.heads++;
    }
    this.events.push({ t: 'damage', side, amount: dmg, x: p.x, y: p.y, direct, hp: f.hp, zone });
    if (f.hp <= 0) {
      if (st && st.side !== side && !direct) st.trapKill = true;
      this.knockOut(side);
    }
  }

  /** The trap cap (tools raise it to measure raw trap damage). */
  trapCap = TRAP_CAP;
  /** Environment damage outside any shot (between turns), with the same cap. */
  private envFree: [number, number] = [0, 0];
  resetTrapCap(): void {
    this.envFree = [0, 0];
  }

  /** A fighter that fell out, into lava or water: damage, then back on their start spot. */
  private hazard(f: Fighter, p: Vec): void {
    this.hurt(f.side, HAZARD_DAMAGE, p, false);
    if (!f.alive) return;
    const def = f.side === 0 ? this.level.player : this.level.rival;
    f.rag.placeAt(def.x, def.y);
    f.rag.hit(0.6);
    this.events.push({ t: 'respawn', side: f.side, x: def.x, y: def.y });
  }

  private knockOut(side: Side): void {
    const f = this.fighters[side];
    if (!f.alive) return;
    f.alive = false;
    f.hp = 0;
    f.rag.knockOut();
    const tp = f.rag.torso.getPosition();
    if (this.stats && this.stats.side !== side) this.stats.kill = true;
    this.events.push({ t: 'ko', side, x: tp.x, y: tp.y });
  }

  private breakEnt(e: Ent): void {
    if (e.dead) return;
    const b = e.body;
    const pos = b.getPosition();
    const ang = b.getAngle();
    const d = e.desc;
    const nx = d.w > d.h * 1.6 ? 3 : d.w > 0.7 ? 2 : 1;
    const ny = d.h > d.w * 1.6 ? 3 : d.h > 0.7 ? 2 : 1;
    const cw = d.w / nx;
    const ch = d.h / ny;
    this.removeEnt(e);
    if (this.stats) this.stats.breaks++;
    this.events.push({ t: 'break', x: pos.x, y: pos.y, mat: d.mat, size: Math.max(d.w, d.h), charred: e.charred || e.burning >= 0 });
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < ny; j++) {
        const lx = -d.w / 2 + cw * (i + 0.5);
        const ly = -d.h / 2 + ch * (j + 0.5);
        const wx = pos.x + lx * c - ly * s;
        const wy = pos.y + lx * s + ly * c;
        const piece = this.addObj(
          { shape: 'box', x: wx, y: wy, angle: ang + this.rng.range(-0.15, 0.15), w: cw * 0.94, h: ch * 0.94, mat: d.mat, look: d.look, depth: d.depth * this.rng.range(0.7, 0.95) },
          true,
          e.charred || e.burning >= 0,
        );
        const v = b.getLinearVelocityFromWorldPoint({ x: wx, y: wy });
        const out = { x: wx - pos.x, y: wy - pos.y };
        const ol = Math.hypot(out.x, out.y) || 1;
        const kick = this.rng.range(0.8, 2.2);
        piece.body.setLinearVelocity({ x: v.x + (out.x / ol) * kick, y: v.y + (out.y / ol) * kick - 0.5 });
        piece.body.setAngularVelocity(b.getAngularVelocity() + this.rng.range(-4, 4));
        if (e.burning >= 0 && this.rng.chance(0.4)) piece.burning = 2.2;
      }
    }
  }

  private removeEnt(e: Ent): void {
    if (e.dead) return;
    e.dead = true;
    for (const r of this.ropes) if (r.ent === e) this.cutRope(r, false);
    for (let i = this.stuck.length - 1; i >= 0; i--) if (this.stuck[i]!.ent === e) this.stuck.splice(i, 1);
    this.world.destroyBody(e.body);
  }

  cutRope(r: Rope, count = true): void {
    if (!r.joint) return;
    this.world.destroyJoint(r.joint);
    r.joint = null;
    r.cutAt = this.time;
    r.ent.body.setAwake(true);
    if (!this.ropes.some((o) => o !== r && o.joint && o.ent === r.ent)) {
      r.ent.swinging = false;
      r.ent.body.setAngularDamping(r.ent.desc.shape === 'ball' ? 0.4 : 0.15);
      r.ent.body.setLinearDamping(0.02);
    }
    const [a, b] = this.ropeEnds(r);
    if (count && this.stats) this.stats.ropes++;
    this.events.push({ t: 'ropeCut', id: r.id, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  }

  ignite(e: Ent): void {
    if (e.dead) return;
    const m = MATERIALS[e.desc.mat];
    if (m.explosive) {
      if (e.fuse < 0) {
        e.fuse = 1.1;
        e.burning = 0;
        const p = e.body.getPosition();
        if (this.stats) this.stats.ignites++;
        this.events.push({ t: 'ignite', x: p.x, y: p.y });
      }
      return;
    }
    if (!m.flammable || e.burning >= 0) return;
    e.burning = 0;
    const p = e.body.getPosition();
    if (this.stats) this.stats.ignites++;
    this.events.push({ t: 'ignite', x: p.x, y: p.y });
  }

  /** Ice arrow: the body becomes slippery and stops burning. */
  frost(e: Ent): void {
    if (e.dead) return;
    e.burning = -1;
    if (!MATERIALS[e.desc.mat].explosive) e.fuse = -1;
    if (!e.frozen) {
      e.frozen = true;
      for (let f = e.body.getFixtureList(); f; f = f.getNext()) f.setFriction(0.02);
      // contacts keep their mixed friction: refresh them
      for (let ce = e.body.getContactList(); ce; ce = ce.next ?? null) ce.contact.resetFriction();
      e.body.setAwake(true);
      const p = e.body.getPosition();
      this.events.push({ t: 'frost', x: p.x, y: p.y });
    }
  }

  /** Freezes a water pool into a thick, slippery ice platform. */
  freezeWater(w: WaterState): void {
    if (w.frozen) return;
    w.frozen = true;
    const ice = this.addObj({ shape: 'box', x: (w.x0 + w.x1) / 2, y: w.y + 0.25, w: w.x1 - w.x0 + 0.1, h: 0.5, mat: 'ice', fixed: true, look: 'iceBlock', depth: 3, hp: 1e9 });
    ice.frozen = true;
    for (let f = ice.body.getFixtureList(); f; f = f.getNext()) f.setFriction(0.03);
    if (this.stats) this.stats.ignites++;
    this.events.push({ t: 'freeze', x: (w.x0 + w.x1) / 2, y: w.y, w: w.x1 - w.x0 });
  }

  private waterAt(x: number, y: number): WaterState | undefined {
    return this.water.find((w) => !w.frozen && x >= w.x0 && x <= w.x1 && y >= w.y && y <= w.y + w.depth + 1);
  }

  private lavaAt(x: number, y: number): boolean {
    return (this.level.lava ?? []).some((l) => x >= l.x0 && x <= l.x1 && y >= l.y);
  }

  /** `hurt` scales the damage to fighters (TNT 1, bombs much less: they are for structures). */
  explode(x: number, y: number, r = 2.6, power = 26, hurt = 1): void {
    this.explodeQueue.push({ x, y, r, power, hurt });
  }

  private doExplode(x: number, y: number, r: number, power: number, hurt = 1): void {
    if (this.stats) this.stats.explosions++;
    this.events.push({ t: 'explode', x, y, r });
    for (const e of this.ents) {
      if (e.dead) continue;
      const p = e.body.getPosition();
      const dx = p.x - x;
      const dy = p.y - y;
      const d = Math.hypot(dx, dy);
      if (d > r + Math.max(e.desc.w, e.desc.h) / 2) continue;
      const k = clamp(1 - d / (r + 0.5), 0, 1);
      const m = MATERIALS[e.desc.mat];
      if (!e.desc.fixed) {
        const dir = d > 0.01 ? { x: dx / d, y: dy / d } : { x: 0, y: -1 };
        e.body.applyLinearImpulse({ x: dir.x * power * k * Math.sqrt(e.body.getMass()), y: (dir.y - 0.35) * power * k * Math.sqrt(e.body.getMass()) }, p, true);
        e.body.applyAngularImpulse(this.rng.range(-1, 1) * k * e.body.getInertia() * 6, true);
      }
      if (m.explosive) {
        // TNT sets off its neighbours; a bomb only a barrel it lands right next to
        if ((hurt >= 1 || k > 0.45) && (e.fuse < 0 || e.fuse > 0.2)) e.fuse = 0.18;
      } else if (Number.isFinite(e.hp) && !e.desc.chunk) {
        e.hp -= 70 * k;
        if (e.hp <= 0) this.breakQueue.add(e);
        else if (m.flammable && k > 0.3) this.ignite(e);
      }
    }
    for (const f of this.fighters) {
      const tp = f.rag.torso.getPosition();
      const d = Math.hypot(tp.x - x, tp.y - y);
      if (d > r + 0.4) continue;
      const k = clamp(1 - d / (r + 0.4), 0, 1);
      this.hurt(f.side, (30 + 80 * k) * hurt * TRAP_SCALE, tp, false);
      f.rag.hit(1.4);
      for (const p of f.rag.parts) {
        const pp = p.body.getPosition();
        const dl = Math.hypot(pp.x - x, pp.y - y) || 1;
        // bombs (hurt < 1) shove much less than TNT
        const s = power * 0.09 * k * p.body.getMass() * 4 * Math.min(1, hurt * 1.5);
        p.body.applyLinearImpulse({ x: ((pp.x - x) / dl) * s, y: ((pp.y - y) / dl - 0.6) * s }, pp, true);
      }
    }
    for (const rp of this.ropes) {
      if (!rp.joint) continue;
      const [a, b] = this.ropeEnds(rp);
      if (segPointDist(a, b, { x, y }) < r * 0.7) this.cutRope(rp);
    }
  }

  /** An arrow hit something. */
  private resolveHit(h: PendingHit): void {
    const a = h.arrow;
    if (!a.alive) return;
    a.alive = false;
    const def = AMMO[a.ammo];
    const vel = a.body.getLinearVelocity();
    const speed = Math.hypot(vel.x, vel.y);
    const angle = Math.atan2(vel.y, vel.x);
    const ot = tag(h.other);
    this.world.destroyBody(a.body);
    if (a.ammo === 'bomb') {
      this.explode(h.point.x, h.point.y, 2.3, 16, 0.3);
      return;
    }
    let sound: string;
    let stuckTo: Stuck['ent'] = null;
    let part: Stuck['part'] = null;
    if (ot.kind === 'ent' && ot.ent && !ot.ent.dead) {
      const e = ot.ent;
      const m = MATERIALS[e.desc.mat];
      sound = m.sound;
      if (!e.desc.fixed) {
        const j = def.push * speed;
        h.other.applyLinearImpulse({ x: (vel.x / speed) * j, y: (vel.y / speed) * j }, h.point, true);
      }
      if (a.ammo === 'fire') this.ignite(e);
      if (a.ammo === 'ice') this.frost(e);
      if (m.explosive && a.ammo === 'heavy') e.fuse = Math.min(e.fuse < 0 ? 9 : e.fuse, 0.08);
      if (Number.isFinite(e.hp) && !m.explosive && !e.desc.chunk) {
        const crack = a.ammo === 'heavy' && e.desc.mat === 'stone' ? 70 : def.crack;
        e.hp -= crack;
        if (e.hp <= 0) this.breakQueue.add(e);
      }
      stuckTo = e;
    } else if (ot.kind === 'part' && ot.side !== undefined) {
      const f = this.fighters[ot.side];
      sound = 'punch';
      const zone = zoneOf(ot.part!);
      // a jolt, not a launch (the flinch comes from the ragdoll going limp)
      const j = def.push * speed * (zone === 'head' ? 0.18 : 0.3);
      h.other.applyLinearImpulse({ x: (vel.x / speed) * j, y: (vel.y / speed) * j }, h.point, true);
      this.hurt(ot.side, ZONE_DAMAGE[zone] * def.direct * speedFactor(speed), h.point, true, zone);
      if (f.alive) f.rag.hit(zone === 'head' ? 0.75 : zone === 'body' ? 0.55 : 0.35);
      if (a.ammo === 'fire') this.events.push({ t: 'ignite', x: h.point.x, y: h.point.y });
      part = { side: ot.side, name: ot.part! };
    } else {
      sound = 'soft';
    }
    this.events.push({ t: 'stick', x: h.point.x, y: h.point.y, sound, ammo: a.ammo });
    // the arrow stays stuck where it hit
    let local: Vec = h.point;
    let la = angle;
    const host = stuckTo?.body ?? (part ? this.fighters[part.side].rag.byName[part.name].body : null);
    if (host) {
      const lp = host.getLocalPoint(h.point);
      local = { x: lp.x, y: lp.y };
      la = angle - host.getAngle();
    }
    this.stuck.push({ id: a.id, ammo: a.ammo, ent: stuckTo, part, local, angle: la, age: 0 });
    if (this.stuck.length > 14) this.stuck.shift();
  }

  /* ------------------------------------------------------------------ */
  /* Step                                                                */
  /* ------------------------------------------------------------------ */

  step(): void {
    // fighters' muscles
    for (const f of this.fighters) {
      if (f.aim !== null && f.alive && f.rag.state === 'stand') {
        const rel = wrapAngle(f.aim - Math.PI / 2 - f.rag.torso.getAngle());
        const k = f.rag.facing;
        f.rag.pose = { ...STAND, uArmF: rel * k, lArmF: 0, uArmB: rel * k + 0.25, lArmB: -1.5, head: clamp(wrapAngle(rel * k + Math.PI / 2) * 0.3, -0.35, 0.35) };
      } else if (f.rag.state === 'stand') {
        f.rag.pose = { ...STAND };
      }
      f.rag.update(DT);
    }
    if (this.wind !== 0) for (const a of this.arrows) if (a.alive) a.body.applyForceToCenter({ x: this.wind * a.body.getMass(), y: 0 }, true);
    // water drags and floats things a little; lava burns and swallows them
    for (const e of this.ents) {
      if (e.dead || e.desc.fixed) continue;
      const p = e.body.getPosition();
      if (this.water.length && this.waterAt(p.x, p.y)) {
        const v = e.body.getLinearVelocity();
        const m = e.body.getMass();
        e.body.applyForceToCenter({ x: -v.x * m * 3, y: -v.y * m * 3 - m * GRAVITY * 0.55 }, true);
        if (e.burning >= 0) e.burning = -1;
      }
      if (this.level.lava && this.lavaAt(p.x, p.y + e.desc.h * 0.3)) {
        const v = e.body.getLinearVelocity();
        const m = e.body.getMass();
        e.body.applyForceToCenter({ x: -v.x * m * 4, y: -v.y * m * 4 - m * GRAVITY * 0.7 }, true);
        if (e.inLava === 0) this.events.push({ t: 'lava', x: p.x, y: p.y });
        e.inLava += DT;
        if (MATERIALS[e.desc.mat].flammable) this.ignite(e);
      }
    }
    this.world.step(DT, 8, 3);
    this.time += DT;
    this.steps++;

    // arrows: wind, water, rope cutting, lifetime
    for (const a of this.arrows) {
      if (!a.alive) continue;
      const p = a.body.getPosition();
      const pool = this.waterAt(p.x, p.y);
      if (pool) {
        a.alive = false;
        this.world.destroyBody(a.body);
        if (a.ammo === 'ice') this.freezeWater(pool);
        else if (a.ammo === 'bomb') this.explode(p.x, pool.y, 2.3, 16, 0.3);
        this.events.push({ t: 'splash', x: p.x, y: pool.y, big: false });
        continue;
      }
      if (this.lavaAt(p.x, p.y)) {
        a.alive = false;
        this.world.destroyBody(a.body);
        this.events.push({ t: 'lava', x: p.x, y: p.y });
        continue;
      }
      for (const r of this.ropes) {
        if (!r.joint) continue;
        const [ra, rb] = this.ropeEnds(r);
        if (segSegDist(a.prev, p, ra, rb) < 0.12) {
          this.cutRope(r);
          if (a.ammo === 'bomb') {
            a.alive = false;
            this.world.destroyBody(a.body);
            this.explode(p.x, p.y, 2.3, 16, 0.3);
          }
        }
      }
      a.prev = { x: p.x, y: p.y };
      a.age += DT;
      if (a.alive && (a.age > 7 || p.y > this.level.killY || p.x < this.level.view.x0 - 30 || p.x > this.level.view.x1 + 30)) {
        a.alive = false;
        this.world.destroyBody(a.body);
      }
    }
    const hits = this.pendingHits;
    this.pendingHits = [];
    for (const h of hits) this.resolveHit(h);
    for (let i = this.arrows.length - 1; i >= 0; i--) if (!this.arrows[i]!.alive) this.arrows.splice(i, 1);

    // fire & fuses
    for (const e of this.ents) {
      if (e.dead) continue;
      e.age += DT;
      if (e.fuse >= 0) {
        e.fuse -= DT;
        if (e.fuse <= 0) {
          const p = e.body.getPosition();
          this.removeEnt(e);
          this.explode(p.x, p.y, 2.6, 26);
          continue;
        }
      }
      if (e.burning >= 0 && !MATERIALS[e.desc.mat].explosive) {
        e.burning += DT;
        e.charred = true;
        // spread to touching flammable bodies
        if (Math.floor((e.burning - DT) * 2) !== Math.floor(e.burning * 2)) {
          for (let ce = e.body.getContactList(); ce; ce = ce.next ?? null) {
            if (!ce.contact.isTouching()) continue;
            const ot = tag(ce.other!);
            if (ot.ent && e.burning > 0.9) this.ignite(ot.ent);
            if (ot.kind === 'part' && ot.side !== undefined) this.hurt(ot.side, 4, ce.other!.getPosition(), false);
          }
          for (const r of this.ropes) if (r.joint && r.ent === e && e.burning > 1.2) this.cutRope(r);
        }
        if (e.burning > (e.desc.chunk ? 2.6 : 3.6)) {
          if (e.desc.chunk) this.removeEnt(e);
          else this.breakQueue.add(e);
        }
      }
      if (e.inLava > 1.6) {
        this.removeEnt(e);
        continue;
      }
      if (e.desc.chunk && e.age > 6 && e.desc.w * e.desc.h < 0.2) {
        const v = e.body.getLinearVelocity();
        if (Math.hypot(v.x, v.y) < 0.3) this.removeEnt(e);
      }
      if (!e.dead && e.body.getPosition().y > this.level.killY) this.removeEnt(e);
    }
    for (const e of this.breakQueue) this.breakEnt(e);
    this.breakQueue.clear();
    const ex = this.explodeQueue;
    this.explodeQueue = [];
    for (const x of ex) this.doExplode(x.x, x.y, x.r, x.power, x.hurt);
    for (const s of this.stuck) s.age += DT;

    // fighters falling out of the world
    for (const f of this.fighters) {
      if (!f.alive) continue;
      const tp = f.rag.torso.getPosition();
      const feet = f.rag.feetY();
      if (tp.y > this.level.killY) {
        this.events.push({ t: 'fall', x: tp.x, y: tp.y });
        this.hazard(f, tp);
      } else if (this.lavaAt(tp.x, feet - 0.05)) {
        this.events.push({ t: 'lava', x: tp.x, y: feet });
        this.hazard(f, tp);
      } else if (this.waterAt(tp.x, tp.y)) {
        this.events.push({ t: 'splash', x: tp.x, y: this.waterAt(tp.x, tp.y)!.y, big: true });
        this.hazard(f, tp);
      }
    }
    this.quiet = this.rawSettled() ? this.quiet + DT : 0;
    if (this.ents.length > 220) {
      for (let i = this.ents.length - 1; i >= 0; i--) if (this.ents[i]!.dead) this.ents.splice(i, 1);
    }
  }

  /** Nothing has moved for a moment (and nothing is burning or about to explode). */
  isSettled(): boolean {
    return this.quiet >= 0.6;
  }

  private rawSettled(): boolean {
    if (this.arrows.length > 0 || this.explodeQueue.length > 0) return false;
    for (const e of this.ents) {
      if (e.dead) continue;
      // fixed bodies count while they burn or tick (a burning roof is still coming down)
      if (e.desc.fixed) {
        if (e.fuse >= 0 || e.burning >= 0) return false;
        continue;
      }
      if (e.fuse >= 0) return false;
      if (e.burning >= 0 && !e.desc.chunk) return false;
      if (!e.body.isAwake() || e.swinging) continue;
      const v = e.body.getLinearVelocity();
      // a log spinning in place on its rope is not "moving" for the turn
      if (Math.hypot(v.x, v.y) > 0.25 || (e.desc.shape === 'box' && Math.abs(e.body.getAngularVelocity()) > 0.4)) return false;
    }
    for (const f of this.fighters) {
      if (f.rag.maxSpeed() > 1.2) return false;
      if (f.alive && f.rag.state === 'limp') return false;
    }
    return true;
  }

  /** Bodies that are still alive. */
  liveEnts(): Ent[] {
    return this.ents.filter((e) => !e.dead);
  }

  /** The fixture under a world point (for tests / hints). */
  fixtureAt(p: Vec): Fixture | null {
    let found: Fixture | null = null;
    this.world.queryAABB({ lowerBound: { x: p.x - 0.01, y: p.y - 0.01 }, upperBound: { x: p.x + 0.01, y: p.y + 0.01 } } as never, (f) => {
      if (f.testPoint(p)) {
        found = f;
        return false;
      }
      return true;
    });
    return found;
  }
}

export function segPointDist(a: Vec, b: Vec, p: Vec): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / l2, 0, 1) : 0;
  return Math.hypot(a.x + dx * t - p.x, a.y + dy * t - p.y);
}

/** Shortest distance between segments ab and cd. */
export function segSegDist(a: Vec, b: Vec, c: Vec, d: Vec): number {
  const cross = (o: Vec, p: Vec, q: Vec) => (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x);
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return 0;
  return Math.min(segPointDist(c, d, a), segPointDist(c, d, b), segPointDist(a, b, c), segPointDist(a, b, d));
}
