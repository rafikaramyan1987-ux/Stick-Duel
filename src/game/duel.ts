import { Circle, Polygon, World, type Body } from 'planck';
import { applyError, chooseWeapon, perceivedWind, solveAim, trace } from '../core/ai';
import { blastDamage, hitDamage, type Zone } from '../core/damage';
import { distToSegSq, makeBlocker, segCircle, segShape, type SegHit } from '../core/geometry';
import { clamp, lerp, wrapAngle, type Vec } from '../core/math';
import { Rng } from '../core/rng';
import { GRAVITY, launch, SIM_DT, speedFor, step, type Flight } from '../core/trajectory';
import { projectileRadius, WEAPONS, type WeaponDef, type WeaponId } from '../core/weapons';
import type { BonusDef, LevelDef, Reward, Solid } from './levels';
import type { ColorId, HatId } from './progress';
import { armAngleFor, Ragdoll, STAND, type PartName, type Pose } from './ragdoll';
import type { EnemyKind } from './worlds';

export type Side = 0 | 1;
export type Mode = 'adventure' | 'endless' | 'versus';

export interface FighterSetup {
  look: 'hero' | 'hero2' | EnemyKind;
  hat: HatId;
  color: ColorId;
  weapons: WeaponId[];
  weapon: WeaponId;
  hp: number;
  maxHp?: number;
  ai: boolean;
  scale?: number;
  boss?: boolean;
}

export interface Stuck {
  look: WeaponDef['look'];
  size: number;
  /** Attached to a body part (local coords) or to the scenery (world coords). */
  part: PartName | null;
  x: number;
  y: number;
  a: number;
}

export interface Projectile {
  w: WeaponDef;
  /** Fire-arrow power-up: more damage, sets the target "on fire" (cartoon smoke). */
  fire: boolean;
  /** Kill-cam prediction already done for this projectile. */
  predicted: boolean;
  f: Flight;
  owner: Side;
  angle: number;
  alive: boolean;
  trail: Vec[];
  leafCooldown: number;
}

export interface Debris {
  look: WeaponDef['look'];
  size: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  a: number;
  va: number;
  life: number;
}

export interface FallingChunk {
  solid: Solid;
  x: number;
  y: number;
  vy: number;
  a: number;
  va: number;
  shake: number;
}

export type Power = 'fire' | 'triple';

export interface Bonus {
  def: BonusDef;
  alive: boolean;
  x: number;
  y: number;
}

/** Cinematic: the lethal shot in slow motion, then the knocked-out fighter. */
export interface KillCam {
  victim: Side;
  proj: Projectile | null;
  phase: 'approach' | 'impact' | 'fall';
  t: number;
}

export type DuelEvent =
  | { type: 'fire'; side: Side; weapon: WeaponDef }
  | { type: 'hit'; side: Side; dmg: number; zone: Zone; x: number; y: number; weapon: WeaponDef; ko: boolean; fire: boolean }
  | { type: 'blast'; x: number; y: number; r: number; weapon: WeaponDef }
  | { type: 'thud'; x: number; y: number; mat: Solid['mat']; weapon: WeaponDef }
  | { type: 'clink'; x: number; y: number; mat: Solid['mat'] }
  | { type: 'burst'; x: number; y: number; weapon: WeaponDef }
  | { type: 'leaves'; x: number; y: number }
  | { type: 'miss'; side: Side }
  | { type: 'fall'; side: Side; dmg: number; x: number; y: number; ko: boolean; ringOut: boolean }
  | { type: 'bonus'; side: Side; reward: Reward; coins: number; kind: BonusDef['kind']; x: number; y: number }
  | { type: 'shield'; side: Side; x: number; y: number }
  | { type: 'hat'; side: Side }
  | { type: 'killcam'; victim: Side }
  | { type: 'crumble'; x: number; y: number }
  | { type: 'turn'; side: Side }
  | { type: 'timeout'; side: Side }
  | { type: 'over'; winner: Side };

export type Phase = 'intro' | 'aim' | 'flight' | 'settle' | 'over';

export const TURN_SECONDS = 20;
/** Extra hit radius (m) for human players' projectiles. */
export const AIM_ASSIST = 0.12;
const FALL_DAMAGE = 6;

export class Fighter {
  hp: number;
  readonly maxHp: number;
  weapon: WeaponId;
  /** Aim while the player drags / the AI winds up. */
  aim: { angle: number; power: number } | null = null;
  /** Seconds since the last throw (arm swing animation). */
  throwT = 9;
  hurtT = 0;
  stuck: Stuck[] = [];
  shots = 0;
  hits = 0;
  headshots = 0;
  breath = 0;
  /** Keep the aiming pose outside of its turn (cover renders). */
  showAim = false;
  /** One-shot power-up for the next shot. */
  power: Power | null = null;
  /** Blocks the next enemy hit. */
  shield = false;
  /** Seconds of cartoon "burning" (smoke, soot) after a fire arrow. */
  burnT = 0;
  /** Coins and bonuses picked up during this duel. */
  coins = 0;
  bonuses = 0;
  damageTaken = 0;
  headStreak = 0;
  bestHeadStreak = 0;
  /** Headgear knocked off by a headshot, flying away. */
  hatLost = false;
  hat: { x: number; y: number; vx: number; vy: number; a: number; va: number } | null = null;
  /** Fell off the platform (after a K.O. or as a ring-out). */
  fallen = false;
  /** Lost by ring-out. */
  ringedOut = false;
  /** Sim time of the last heavy hit (blast, heavy weapon, headshot): ring-outs need one. */
  lastHeavyHitAt = -99;

  constructor(
    readonly side: Side,
    readonly setup: FighterSetup,
    readonly rag: Ragdoll,
  ) {
    this.hp = setup.hp;
    this.maxHp = setup.maxHp ?? setup.hp;
    this.weapon = setup.weapon;
  }

  get facing(): 1 | -1 {
    return this.rag.facing;
  }
  get ko(): boolean {
    return this.hp <= 0;
  }
  get def(): WeaponDef {
    return WEAPONS[this.weapon];
  }

  /** Where shots start: in front of the shoulder along the aim. */
  launchPoint(angle: number): Vec {
    const s = this.rag.shoulder();
    const r = 0.55 * this.rag.scale;
    return { x: s.x + Math.cos(angle) * r, y: s.y + Math.sin(angle) * r };
  }

  /** Default aim direction (a 35° lob towards the opponent). */
  restAngle(): number {
    return this.facing === 1 ? -0.6 : Math.PI + 0.6;
  }

  center(): Vec {
    const p = this.rag.torso.getPosition();
    return { x: p.x, y: p.y };
  }
}

export interface DuelOptions {
  mode: Mode;
  left: FighterSetup;
  right: FighterSetup;
  seed?: number;
  /** Whose turn first. */
  first?: Side;
}

export class Duel {
  readonly world: World;
  readonly fighters: [Fighter, Fighter];
  readonly rng: Rng;
  readonly solids: Solid[];
  private readonly bodies = new Map<number, Body>();
  projectiles: Projectile[] = [];
  debris: Debris[] = [];
  chunks: FallingChunk[] = [];
  /** Stuck projectiles in the scenery. */
  stuckWorld: Stuck[] = [];
  phase: Phase = 'intro';
  phaseT = 0;
  turn: Side = 0;
  turnNumber = 0;
  turnLeft = TURN_SECONDS;
  wind: number;
  winner: Side | null = null;
  /** Short slow motion after a headshot (seconds of sim time). */
  slowmo = 0;
  killCam: KillCam | null = null;
  bonuses: Bonus[];
  shake = 0;
  time = 0;
  private acc = 0;
  private listeners: Array<(e: DuelEvent) => void> = [];
  private aiPlan: { at: number; fireAt: number; angle: number; speed: number; weapon: WeaponId } | null = null;
  private settleMin = 0;
  /** For tests/automation: next AI shots are perfect (no error). */
  aiPerfect = false;

  constructor(
    readonly level: LevelDef,
    readonly opt: DuelOptions,
  ) {
    this.rng = new Rng(opt.seed ?? level.seed ^ 0xabcdef);
    this.world = new World({ gravity: { x: 0, y: GRAVITY } });
    this.solids = level.solids.map((s) => ({ ...s }));
    for (const s of this.solids) this.addStatic(s);
    const mk = (side: Side, setup: FighterSetup, spot: Vec) => {
      const rag = new Ragdoll(this.world, spot.x, spot.y, side === 0 ? 1 : -1, setup.scale ?? 1, -(side + 1), GRAVITY);
      rag.homeSpring = level.friction < 0.2 ? 0.7 : 1;
      return new Fighter(side, setup, rag);
    };
    this.fighters = [mk(0, opt.left, level.playerSpot), mk(1, opt.right, level.enemySpot)];
    this.wind = level.wind.base;
    this.turn = opt.first ?? 0;
    this.bonuses = (opt.mode === 'versus' ? [] : level.bonuses).map((def) => ({ def, alive: true, x: def.x, y: def.y }));
    // let the ragdolls settle on their platforms
    for (let i = 0; i < 30; i++) this.physicsStep(1 / 60);
  }

  on(cb: (e: DuelEvent) => void): void {
    this.listeners.push(cb);
  }
  private emit(e: DuelEvent): void {
    for (const cb of this.listeners) cb(e);
  }

  private addStatic(s: Solid): void {
    const body = this.world.createBody({ type: 'static' });
    const friction = s.role === 'platform' ? this.level.friction : 0.6;
    if (s.shape.kind === 'circle') {
      body.createFixture({ shape: new Circle(s.shape.c, s.shape.r), friction });
    } else {
      const pts = s.shape.pts;
      // split big convex polygons into fans of ≤ 8 vertices
      if (pts.length <= 8) body.createFixture({ shape: new Polygon(pts), friction });
      else {
        const p0 = pts[0] as Vec;
        for (let i = 1; i < pts.length - 1; i += 6) {
          const fan = [p0, ...pts.slice(i, Math.min(pts.length, i + 7))];
          if (fan.length >= 3) body.createFixture({ shape: new Polygon(fan), friction });
        }
      }
    }
    this.bodies.set(s.id, body);
  }

  get current(): Fighter {
    return this.fighters[this.turn];
  }
  other(side: Side): Fighter {
    return this.fighters[side === 0 ? 1 : 0];
  }
  /** Is it a human's turn to aim? */
  get humanAiming(): boolean {
    return this.phase === 'aim' && !this.current.setup.ai;
  }

  start(): void {
    if (this.phase !== 'intro') return;
    this.beginTurn(this.turn, false);
  }

  private beginTurn(side: Side, changeWind: boolean): void {
    this.turn = side;
    this.turnNumber++;
    this.phase = 'aim';
    this.phaseT = 0;
    this.turnLeft = TURN_SECONDS;
    this.aiPlan = null;
    if (changeWind && this.level.wind.gust > 0) {
      const w = this.level.wind;
      const lim = Math.max(Math.abs(w.base) + w.gust, 0.5);
      this.wind = Math.round(clamp(w.base + this.rng.gauss() * w.gust, -lim, lim) * 10) / 10;
    }
    const f = this.current;
    f.aim = null;
    this.emit({ type: 'turn', side });
  }

  // ───────────── human input ─────────────

  setAim(angle: number, power: number): void {
    if (!this.humanAiming) return;
    this.current.aim = { angle, power: clamp(power, 0, 1) };
  }
  cancelAim(): void {
    if (this.humanAiming) this.current.aim = null;
  }
  selectWeapon(id: WeaponId): boolean {
    const f = this.current;
    if (this.phase !== 'aim' || f.setup.ai || !f.setup.weapons.includes(id)) return false;
    f.weapon = id;
    return true;
  }
  /** Fires the current aim; returns false if nothing was aimed. */
  fire(): boolean {
    const f = this.current;
    if (!this.humanAiming || !f.aim || f.aim.power < 0.08) return false;
    this.shoot(f, f.aim.angle, speedFor(f.aim.power, f.def));
    return true;
  }

  private shoot(f: Fighter, angle: number, speed: number): void {
    const w = f.def;
    const from = f.launchPoint(angle);
    const triple = f.power === 'triple' && w.count === 1;
    const count = triple ? 3 : w.count;
    const spread = triple ? 0.06 : w.spread;
    const fire = f.power === 'fire';
    f.power = null;
    for (let i = 0; i < count; i++) {
      const a = angle + (i - (count - 1) / 2) * spread;
      const fl = launch(from, a, speed * (1 - Math.abs(i - (count - 1) / 2) * 0.03));
      this.projectiles.push({ w, f: fl, owner: f.side, angle: a, alive: true, trail: [], leafCooldown: 0, fire, predicted: false });
    }
    f.shots++;
    f.throwT = 0;
    f.aim = { angle, power: (speed - w.speedMin) / (w.speedMax - w.speedMin) };
    this.phase = 'flight';
    this.phaseT = 0;
    this.emit({ type: 'fire', side: f.side, weapon: w });
  }

  // ───────────── AI ─────────────

  /** Scenery collision test for the aim solver (rebuilt per solve: chunks can crumble). */
  private blocker(): (ax: number, ay: number, bx: number, by: number) => boolean {
    return makeBlocker(this.solids.map((s) => s.shape));
  }

  private planAI(): void {
    const f = this.current;
    const foe = this.other(f.side);
    const L = this.level;
    const covered = this.solids.some((s) => s.role === 'cover' && s.shape.kind === 'poly' && Math.abs((s.shape.pts[0]?.x ?? 0) - foe.rag.homeX) < 2.6);
    const weapon = chooseWeapon(f.setup.weapons, f.weapon, L.skill, this.rng, covered);
    f.weapon = weapon;
    const w = WEAPONS[weapon];
    const aimHead = L.ai.headshots && this.rng.chance(L.skill * 0.35);
    const t = foe.center();
    let target = aimHead ? { x: foe.rag.head.getPosition().x, y: foe.rag.head.getPosition().y } : { x: t.x, y: t.y + 0.05 };
    // sometimes the AI goes for a floating bonus instead
    const bonus = this.bonuses.find((b) => b.alive);
    if (bonus && !f.power && f.shots > 0 && this.rng.chance(0.15 + L.skill * 0.15)) target = { x: bonus.x, y: bonus.y };
    const restAngle = f.restAngle();
    const from = f.launchPoint(restAngle);
    const wind = this.aiPerfect ? this.wind : perceivedWind(this.wind, L.skill, this.rng);
    const blocked = this.blocker();
    let sol = solveAim({ from, target, weapon: w, wind, blocked });
    // the launch point depends on the angle: refine once from the solved angle
    sol = solveAim({ from: f.launchPoint(sol.angle), target, weapon: w, wind, blocked });
    if (!this.aiPerfect) sol = applyError(sol, w, L.skill, this.rng);
    // gentle levels: the AI's first shot always falls short or long
    if (L.ai.missFirst && f.shots === 0 && !this.aiPerfect) {
      // pick a shot that visibly falls short (or flies long), checked against the real flight
      const prob = { from: f.launchPoint(sol.angle), target: foe.center(), weapon: w, wind: this.wind, blocked };
      // the body reaches ~1.2 m below and ~0.8 m above the torso centre
      for (const k of [0.7, 0.6, 0.5, 1.35, 1.5]) {
        const speed = clamp(sol.speed * k, w.speedMin, w.speedMax);
        if (trace(prob, sol.angle, speed).best > 2.2) {
          sol = { ...sol, speed };
          break;
        }
      }
    }
    const think = lerp(1.3, 0.8, L.skill) + this.rng.range(0, 0.4);
    this.aiPlan = { at: think, fireAt: think + 0.7, angle: sol.angle, speed: sol.speed, weapon };
  }

  private updateAI(): void {
    const f = this.current;
    if (!this.aiPlan) {
      if (this.phaseT > 0.35) this.planAI();
      return;
    }
    const p = this.aiPlan;
    if (this.phaseT >= p.at) {
      const k = clamp((this.phaseT - p.at) / (p.fireAt - p.at), 0, 1);
      const w = WEAPONS[p.weapon];
      const power = (p.speed - w.speedMin) / (w.speedMax - w.speedMin);
      const ease = 1 - (1 - k) * (1 - k);
      f.aim = { angle: lerp(f.restAngle(), p.angle, Math.min(1, ease * 1.4)), power: power * ease };
    }
    if (this.phaseT >= p.fireAt) this.shoot(f, p.angle, p.speed);
  }

  // ───────────── simulation ─────────────

  /** How fast the game should run right now (kill cam / headshot slow motion). */
  get timeScale(): number {
    const k = this.killCam;
    if (k) return k.phase === 'approach' ? 0.4 : 0.45;
    return this.slowmo > 0 ? 0.5 : 1;
  }

  /** Tap to skip the kill cam. */
  skipKillCam(): void {
    this.killCam = null;
    this.slowmo = 0;
  }

  update(dt: number): void {
    this.time += dt;
    this.slowmo = Math.max(0, this.slowmo - dt);
    const k = this.killCam;
    if (k) {
      k.t += dt;
      if (k.phase === 'approach' && (!k.proj || !k.proj.alive) && k.t > 0.05) {
        // the predicted lethal shot did not land (shield, scenery…)
        if (!this.fighters[k.victim].ko) this.killCam = null;
        else k.phase = 'impact';
      }
      if (this.killCam && k.phase !== 'approach' && k.t > (k.phase === 'fall' ? 1.5 : 1.1)) this.killCam = null;
    }
    this.shake = Math.max(0, this.shake - dt * 2.5);
    this.acc += dt;
    let steps = 0;
    while (this.acc >= 1 / 60 && steps < 4) {
      this.acc -= 1 / 60;
      this.tick(1 / 60);
      steps++;
    }
    if (steps === 4) this.acc = 0;
  }

  private tick(dt: number): void {
    this.phaseT += dt;
    for (const f of this.fighters) this.poseFighter(f, dt);
    this.physicsStep(dt);
    this.updateBonuses();
    this.updateProjectiles(dt);
    this.updateDebris(dt);
    this.checkFalls();
    switch (this.phase) {
      case 'aim':
        if (this.current.setup.ai) this.updateAI();
        else {
          this.turnLeft -= dt;
          if (this.turnLeft <= 0) {
            this.current.aim = null;
            this.emit({ type: 'timeout', side: this.turn });
            this.endTurn();
          }
        }
        break;
      case 'flight':
        if (this.projectiles.every((p) => !p.alive)) {
          this.phase = 'settle';
          this.phaseT = 0;
          this.settleMin = 0.6;
        } else if (this.phaseT > 8) {
          for (const p of this.projectiles) p.alive = false;
        }
        break;
      case 'settle': {
        const busy = this.fighters.some((f) => !f.ko && (f.rag.state === 'limp' || f.rag.state === 'recover'));
        if (this.phaseT > this.settleMin && (!busy || this.phaseT > 2.6)) this.endTurn();
        break;
      }
      default:
        break;
    }
    this.projectiles = this.projectiles.filter((p) => p.alive);
  }

  private endTurn(): void {
    const ko = this.fighters.find((f) => f.ko);
    if (ko) {
      this.phase = 'over';
      this.phaseT = 0;
      this.winner = ko.side === 0 ? 1 : 0;
      this.emit({ type: 'over', winner: this.winner });
      return;
    }
    if (this.level.world.id === 'volcano' && this.turnNumber % 2 === 0 && this.rng.chance(0.55)) this.crumbleRandom();
    this.fighters[this.turn].aim = null;
    this.beginTurn(this.turn === 0 ? 1 : 0, true);
  }

  private physicsStep(dt: number): void {
    for (const f of this.fighters) f.rag.update(dt);
    this.world.step(dt, 8, 3);
  }

  private poseFighter(f: Fighter, dt: number): void {
    f.throwT += dt;
    f.hurtT = Math.max(0, f.hurtT - dt);
    f.breath += dt;
    const r = f.rag;
    const pose: Pose = { ...STAND };
    const torsoA = r.torso.getAngle();
    const set = (n: PartName, absAngle: number) => {
      pose[n] = r.facing === 1 ? absAngle : -absAngle;
    };
    const b = Math.sin(f.breath * 2.2) * 0.05;
    pose.uArmF = (pose.uArmF ?? 0) + b;
    pose.uArmB = (pose.uArmB ?? 0) - b;
    const look = f.def.look;
    const aiming = f.aim && (this.phase === 'aim' || f.throwT < 0.35 || f.showAim);
    if (aiming && f.aim) {
      const a = f.aim.angle;
      const p = f.aim.power;
      const arm = armAngleFor(a, torsoA);
      pose.thighF = -0.32;
      pose.thighB = 0.34;
      pose.shinB = 0.2;
      if (look === 'arrow' || look === 'bolt') {
        set('uArmF', arm);
        pose.lArmF = 0;
        if (look === 'arrow') {
          set('uArmB', arm + Math.PI - r.facing * 0.15);
          pose.lArmB = -2.6 + p * 0.7;
        }
      } else {
        // wind up behind the head, then swing through
        const swing = f.throwT < 0.35 ? clamp(f.throwT / 0.18, 0, 1) : 0;
        set('uArmF', arm + 0.2 * r.facing);
        pose.lArmF = -0.3;
        const back = arm - r.facing * (1.8 + p * 0.5);
        const fwd = arm + r.facing * 0.5;
        set('uArmB', lerp(back, fwd, swing));
        pose.lArmB = lerp(-1.2, -0.1, swing);
      }
    } else if (r.walking !== 0) {
      const ph = this.time * 9;
      pose.thighF = Math.sin(ph) * 0.45;
      pose.thighB = -Math.sin(ph) * 0.45;
      pose.shinF = 0.25 + Math.max(0, Math.cos(ph)) * 0.5;
      pose.shinB = 0.25 + Math.max(0, -Math.cos(ph)) * 0.5;
    }
    if (f.ko) pose.head = 0.4;
    r.pose = pose;
    r.lean = aiming ? -0.06 : 0;
    // low HP: a dizzy wobble
    if (!f.ko && f.hp / f.maxHp < 0.3 && !aiming) r.lean = Math.sin(this.time * 3.2 + f.side) * 0.1;
    f.burnT = Math.max(0, f.burnT - dt);
  }

  private updateProjectiles(dt: number): void {
    const sub = Math.round(dt / SIM_DT);
    for (const p of this.projectiles) {
      if (!p.alive) continue;
      p.leafCooldown -= dt;
      for (let i = 0; i < sub && p.alive; i++) {
        const ax = p.f.x;
        const ay = p.f.y;
        step(p.f, p.w, { wind: this.wind }, SIM_DT);
        this.collide(p, ax, ay);
      }
      if (!p.alive) continue;
      if (!p.predicted && !this.killCam) this.predictLethal(p);
      p.angle = p.w.spin ? p.angle + p.w.spin * dt * p.f.dir : Math.atan2(p.f.vy, p.f.vx);
      p.trail.push({ x: p.f.x, y: p.f.y });
      if (p.trail.length > 14) p.trail.shift();
      const B = this.level.bounds;
      if (p.f.y > B.maxY || p.f.x < B.minX || p.f.x > B.maxX || p.f.y < B.minY) {
        p.alive = false;
        this.emit({ type: 'miss', side: p.owner });
      }
      if (p.f.y > this.level.floor.y + 0.2 && p.alive) {
        // splash/land in the floor (lava, lake, courtyard…)
        p.alive = false;
        if (p.w.explode) this.explode(p, p.f.x, this.level.floor.y);
        else this.emit({ type: 'thud', x: p.f.x, y: this.level.floor.y, mat: 'sand', weapon: p.w });
      }
    }
  }

  /** Which body part (if any) the segment a→b touches. */
  private partHit(f: Fighter, ax: number, ay: number, bx: number, by: number, pad: number): PartName | null {
    for (const part of f.rag.parts) {
      const sp = part.spec;
      if (sp.circle) {
        if (segCircle(ax, ay, bx, by, part.body.getPosition(), sp.circle + pad)) return part.name;
      } else {
        const t0 = part.body.getWorldPoint({ x: 0, y: -sp.hh });
        const t1 = part.body.getWorldPoint({ x: 0, y: sp.hh });
        const r = sp.hw + 0.02 + pad;
        if (distToSegSq(bx, by, t0.x, t0.y, t1.x, t1.y) < r * r) return part.name;
      }
    }
    return null;
  }

  private hitPad(p: Projectile): number {
    // a little aim assist for human players (kids): their shots hit a slightly larger body
    return projectileRadius(p.w) + (this.fighters[p.owner].setup.ai ? 0 : AIM_ASSIST);
  }

  /** Looks ahead along a flight: will it hit the opponent for a K.O.? Starts the kill cam. */
  private predictLethal(p: Projectile): void {
    const victim = this.other(p.owner);
    if (victim.ko || victim.fallen || victim.shield) return;
    const c = victim.center();
    if (Math.hypot(c.x - p.f.x, c.y - p.f.y) > 6) return;
    p.predicted = true;
    const f = { ...p.f };
    const pad = this.hitPad(p);
    for (let i = 0; i < 240 * 0.9; i++) {
      const ax = f.x;
      const ay = f.y;
      step(f, p.w, { wind: this.wind }, SIM_DT);
      const part = this.partHit(victim, ax, ay, f.x, f.y, pad);
      if (part) {
        const shooter = this.fighters[p.owner];
        const zone = this.zoneFor(shooter, part);
        const raw = p.w.explode ? blastDamage(p.w, 0) : hitDamage(p.w, zone, Math.hypot(f.vx, f.vy));
        const dmg = this.scaleDamage(shooter, raw) * (p.fire ? 1.5 : 1);
        if (dmg >= victim.hp) {
          this.killCam = { victim: victim.side, proj: p, phase: 'approach', t: 0 };
          this.emit({ type: 'killcam', victim: victim.side });
        }
        return;
      }
      if (this.solids.some((s) => segShape(ax, ay, f.x, f.y, s.shape))) return;
    }
  }

  private zoneFor(shooter: Fighter, part: PartName): Zone {
    const z = Ragdoll.zoneOf(part);
    // gentle levels: AI hits never count as headshots
    return z === 'head' && shooter.setup.ai && !this.level.ai.headshots ? 'torso' : z;
  }

  private updateBonuses(): void {
    for (const b of this.bonuses) {
      if (!b.alive) continue;
      const d = b.def;
      const t = this.time + d.phase;
      b.x = d.x + (d.kind === 'bird' ? Math.sin(t * 0.7) * d.range : Math.sin(t * 0.5) * 0.15);
      b.y = d.y + Math.sin(t * (d.kind === 'bird' ? 3 : 1.3)) * (d.kind === 'bird' ? 0.15 : 0.25);
    }
  }

  /** A projectile touched a bonus: reward its owner. Balloons and birds let the shot fly on. */
  private takeBonus(p: Projectile, b: Bonus): boolean {
    b.alive = false;
    const f = this.fighters[p.owner];
    const r = b.def.reward;
    f.bonuses++;
    if (r === 'coins') f.coins += b.def.coins;
    else if (r === 'heal') f.hp = Math.min(f.maxHp, f.hp + 20);
    else if (r === 'shield') f.shield = true;
    else f.power = r;
    this.emit({ type: 'bonus', side: f.side, reward: r, coins: b.def.coins, kind: b.def.kind, x: b.x, y: b.y });
    return b.def.kind === 'crate';
  }

  private collide(p: Projectile, ax: number, ay: number): void {
    const bx = p.f.x;
    const by = p.f.y;
    const pr = projectileRadius(p.w);
    const pad = this.hitPad(p);
    // floating bonuses
    for (const b of this.bonuses) {
      if (!b.alive) continue;
      if (!segCircle(ax, ay, bx, by, { x: b.x, y: b.y }, (b.def.kind === 'crate' ? 0.42 : 0.4) + pad - pr)) continue;
      if (this.takeBonus(p, b)) {
        // crates stop the shot
        p.alive = false;
        if (p.w.explode) this.explode(p, bx, by);
        else this.debris.push({ look: p.w.look, size: p.w.size, x: bx, y: by, vx: -p.f.vx * 0.1, vy: -2, a: p.angle, va: 9, life: 1.2 });
        return;
      }
    }
    // fighters (never your own projectile)
    for (const f of this.fighters) {
      if (f.side === p.owner || f.fallen) continue;
      const part = this.partHit(f, ax, ay, bx, by, pad);
      if (part) {
        this.hitFighter(p, f, part, bx, by);
        return;
      }
    }
    // scenery
    let best: SegHit | null = null;
    let bestSolid: Solid | null = null;
    for (const s of this.solids) {
      const h = segShape(ax, ay, bx, by, s.shape, pr * 0.5);
      if (h && (!best || h.t < best.t)) {
        best = h;
        bestSolid = s;
      }
    }
    if (best && bestSolid) {
      this.hitSolid(p, bestSolid, best);
      return;
    }
    // leaves
    if (p.leafCooldown <= 0) {
      for (const d of this.level.decos) {
        if (d.kind !== 'canopy') continue;
        const r = 1.1 * d.s;
        if ((bx - d.x) ** 2 + (by - d.y) ** 2 < r * r) {
          p.leafCooldown = 0.25;
          this.emit({ type: 'leaves', x: bx, y: by });
          break;
        }
      }
    }
  }

  private hitFighter(p: Projectile, f: Fighter, partName: PartName, x: number, y: number): void {
    p.alive = false;
    // explosives only hurt through their blast
    if (p.w.explode) {
      this.explode(p, x, y);
      return;
    }
    const shooter = this.fighters[p.owner];
    const zone = this.zoneFor(shooter, partName);
    const speed = Math.hypot(p.f.vx, p.f.vy);
    const part = f.rag.byName[partName];
    const dx = p.f.vx / (speed || 1);
    const dy = p.f.vy / (speed || 1);
    if (this.blockedByShield(f, x, y)) {
      this.debris.push({ look: p.w.look, size: p.w.size, x, y, vx: -dx * 3, vy: -3, a: p.angle, va: 10, life: 1.2 });
      if (this.killCam?.proj === p) this.killCam = null;
      return;
    }
    let dmg = this.scaleDamage(shooter, hitDamage(p.w, zone, speed));
    if (p.fire) {
      dmg = Math.round(dmg * 1.5);
      f.burnT = 2.6;
    }
    shooter.hits++;
    if (zone === 'head') {
      shooter.headshots++;
      shooter.headStreak++;
      shooter.bestHeadStreak = Math.max(shooter.bestHeadStreak, shooter.headStreak);
      this.knockHat(f, dx);
    } else shooter.headStreak = 0;
    // headshots and heavy weapons push harder (ring-outs near an edge)
    let k = (p.w.knockback * f.rag.totalMass * 0.16) / Math.max(1, f.rag.scale * 0.9);
    if (zone === 'head') k *= 2;
    if (zone === 'head' || p.w.knockback >= 6) f.lastHeavyHitAt = this.time;
    part.body.applyLinearImpulse({ x: dx * k, y: dy * k - k * 0.15 }, { x, y }, true);
    if (zone !== 'head') f.rag.head.applyLinearImpulse({ x: dx * k * 0.15, y: 0 }, f.rag.head.getPosition(), true);
    this.damage(f, dmg);
    f.rag.hit(0.45 + dmg / 70);
    if (f.ko) this.koLaunch(f, dx);
    if (p.w.sticks) {
      const tip = { x: x + dx * 0.08, y: y + dy * 0.08 };
      const lp = part.body.getLocalPoint(tip);
      f.stuck.push({ look: p.w.look, size: p.w.size, part: partName, x: lp.x, y: lp.y, a: wrapAngle(Math.atan2(dy, dx) - part.body.getAngle()) });
      if (f.stuck.length > 8) f.stuck.shift();
    } else {
      this.debris.push({ look: p.w.look, size: p.w.size, x, y, vx: -dx * 2, vy: -3, a: p.angle, va: 8, life: 1.6 });
    }
    this.shake = Math.max(this.shake, zone === 'head' ? 0.7 : 0.45);
    if (f.ko) this.startImpactCam(f.side, p);
    else if (zone === 'head') this.slowmo = 0.45;
    this.emit({ type: 'hit', side: f.side, dmg, zone, x, y, weapon: p.w, ko: f.ko, fire: p.fire });
  }

  /** A shield absorbs one enemy hit. */
  private blockedByShield(f: Fighter, x: number, y: number): boolean {
    if (!f.shield) return false;
    f.shield = false;
    this.shake = Math.max(this.shake, 0.3);
    this.emit({ type: 'shield', side: f.side, x, y });
    return true;
  }

  /** The knocked-out fighter flies off with a satisfying push. */
  private koLaunch(f: Fighter, dir: number): void {
    const m = f.rag.totalMass;
    const s = Math.sign(dir) || -f.facing;
    f.rag.torso.applyLinearImpulse({ x: s * m * 1.4, y: -m * 1.6 }, f.rag.torso.getPosition(), true);
    f.rag.head.applyLinearImpulse({ x: s * m * 0.25, y: -m * 0.2 }, f.rag.head.getPosition(), true);
  }

  private startImpactCam(victim: Side, p: Projectile | null): void {
    if (this.killCam && this.killCam.victim === victim) {
      this.killCam.phase = 'impact';
      this.killCam.t = 0;
      return;
    }
    this.killCam = { victim, proj: p, phase: 'impact', t: 0 };
    this.emit({ type: 'killcam', victim });
  }

  /** A headshot knocks the hat / helmet off (once). */
  private knockHat(f: Fighter, dir: number): void {
    const look = f.setup.look;
    const has = look === 'hero' || look === 'hero2' ? f.setup.hat !== 'none' : look !== 'yeti' && look !== 'golem';
    if (!has || f.hatLost) return;
    f.hatLost = true;
    const h = f.rag.head.getPosition();
    f.hat = { x: h.x, y: h.y - 0.15 * f.rag.scale, vx: dir * 3 + (Math.random() - 0.5), vy: -5.5, a: f.rag.head.getAngle(), va: (Math.sign(dir) || 1) * 9 };
    this.emit({ type: 'hat', side: f.side });
  }

  /** AI damage is scaled per level (softer early on); human hits set the duel pace (not in 2-player mode). */
  private scaleDamage(shooter: Fighter, dmg: number): number {
    if (dmg <= 0) return dmg;
    const k = shooter.setup.ai ? this.level.ai.damage : this.opt.mode === 'versus' ? 1 : this.level.playerDamage;
    return Math.max(1, Math.round(dmg * k));
  }

  private damage(f: Fighter, dmg: number): void {
    if (f.ko) return;
    f.damageTaken += Math.min(dmg, f.hp);
    f.hp = Math.max(0, f.hp - dmg);
    f.hurtT = 0.9;
    if (f.hp <= 0) f.rag.knockOut();
  }

  private hitSolid(p: Projectile, s: Solid, h: SegHit): void {
    p.alive = false;
    if (p.w.explode) {
      this.explode(p, h.x, h.y);
      return;
    }
    if (p.w.sticks && s.sticky) {
      const a = Math.atan2(p.f.vy, p.f.vx);
      this.stuckWorld.push({ look: p.w.look, size: p.w.size, part: null, x: h.x + Math.cos(a) * 0.1, y: h.y + Math.sin(a) * 0.1, a: p.w.spin ? p.angle : a });
      if (this.stuckWorld.length > 24) this.stuckWorld.shift();
      this.emit({ type: 'thud', x: h.x, y: h.y, mat: s.mat, weapon: p.w });
      return;
    }
    if (p.w.look === 'snowball' || p.w.look === 'bolt') {
      this.emit({ type: 'burst', x: h.x, y: h.y, weapon: p.w });
      return;
    }
    // bounce off and fall
    const vn = p.f.vx * h.nx + p.f.vy * h.ny;
    const rvx = (p.f.vx - 2 * vn * h.nx) * 0.25;
    const rvy = (p.f.vy - 2 * vn * h.ny) * 0.25;
    this.debris.push({ look: p.w.look, size: p.w.size, x: h.x + h.nx * 0.05, y: h.y + h.ny * 0.05, vx: rvx, vy: rvy, a: p.angle, va: (Math.random() - 0.5) * 20, life: 1.4 });
    this.emit({ type: 'clink', x: h.x, y: h.y, mat: s.mat });
  }

  private explode(p: Projectile, x: number, y: number): void {
    const w = p.w;
    const ex = w.explode;
    if (!ex) return;
    this.shake = Math.max(this.shake, 1);
    this.emit({ type: 'blast', x, y, r: ex.radius, weapon: w });
    for (const f of this.fighters) {
      if (f.side === p.owner) continue;
      let d = Infinity;
      for (const part of f.rag.parts) {
        const c = part.body.getPosition();
        d = Math.min(d, Math.hypot(c.x - x, c.y - y));
      }
      let dmg = this.scaleDamage(this.fighters[p.owner], blastDamage(w, d));
      if (dmg <= 0) continue;
      if (this.blockedByShield(f, f.center().x, f.center().y)) continue;
      if (p.fire) {
        dmg = Math.round(dmg * 1.5);
        f.burnT = 2.6;
      }
      const k = (1 - d / ex.radius) * ex.impulse * 0.1;
      for (const part of f.rag.parts) {
        const c = part.body.getPosition();
        const dx = c.x - x;
        const dy = c.y - y - 0.6;
        const l = Math.hypot(dx, dy) || 1;
        part.body.applyLinearImpulse({ x: (dx / l) * k * part.body.getMass() * 6, y: (dy / l) * k * part.body.getMass() * 6 }, c, true);
      }
      f.rag.hit(1.1);
      f.lastHeavyHitAt = this.time;
      this.damage(f, dmg);
      this.fighters[p.owner].hits++;
      if (f.ko) {
        this.koLaunch(f, f.center().x - x);
        this.startImpactCam(f.side, p);
      }
      this.emit({ type: 'hit', side: f.side, dmg, zone: 'torso', x: f.center().x, y: f.center().y - 0.4, weapon: w, ko: f.ko, fire: p.fire });
    }
    // crumbly chunks nearby fall
    for (const s of [...this.solids]) {
      if (!s.crumble || s.shape.kind !== 'poly') continue;
      if (s.shape.pts.some((q) => Math.hypot(q.x - x, q.y - y) < ex.radius)) this.crumble(s, 0.05);
    }
  }

  private crumbleRandom(): void {
    const options = this.solids.filter((s) => s.crumble && !this.chunks.some((c) => c.solid === s));
    if (options.length) this.crumble(this.rng.pick(options), 0.9);
  }

  /** Starts a chunk shaking; after `delay` it falls into the lava. */
  private crumble(s: Solid, delay: number): void {
    if (this.chunks.some((c) => c.solid === s)) return;
    this.chunks.push({ solid: s, x: 0, y: 0, vy: 0, a: 0, va: (Math.random() - 0.5) * 1.5, shake: delay });
  }

  private updateDebris(dt: number): void {
    for (const d of this.debris) {
      d.vy += GRAVITY * dt;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.a += d.va * dt;
      d.life -= dt;
    }
    this.debris = this.debris.filter((d) => d.life > 0);
    for (const f of this.fighters) {
      const h = f.hat;
      if (!h) continue;
      h.vy += GRAVITY * dt * 0.8;
      h.x += h.vx * dt;
      h.y += h.vy * dt;
      h.a += h.va * dt;
      if (h.y > this.level.floor.y + 6) f.hat = null;
    }
    for (const c of this.chunks) {
      if (c.shake > 0) {
        c.shake -= dt;
        if (c.shake <= 0) {
          // falls now: remove its collision
          const body = this.bodies.get(c.solid.id);
          if (body) this.world.destroyBody(body);
          this.bodies.delete(c.solid.id);
          this.solids.splice(this.solids.indexOf(c.solid), 1);
          this.stuckWorld = this.stuckWorld.filter((st) => !(c.solid.shape.kind === 'poly' && st.part === null && pointNear(c.solid, st)));
          const cc = centroid(c.solid);
          this.emit({ type: 'crumble', x: cc.x, y: cc.y });
        }
        continue;
      }
      c.vy += GRAVITY * dt * 0.8;
      c.y += c.vy * dt;
      c.a += c.va * dt;
    }
    this.chunks = this.chunks.filter((c) => c.y < 20);
  }

  private checkFalls(): void {
    for (const f of this.fighters) {
      if (f.fallen) continue;
      const t = f.rag.torso.getPosition();
      if (t.y <= f.rag.footY + 1.9 && t.y <= this.level.killY) continue;
      const y = Math.min(t.y, this.level.floor.y);
      if (f.ko) {
        // already knocked out: just a funny fall, no respawn
        f.fallen = true;
        this.emit({ type: 'fall', side: f.side, dmg: 0, x: t.x, y, ko: true, ringOut: false });
        continue;
      }
      // a ring-out needs a push: a fall soon after being hit (not a slip or a crumbling edge)
      // only a weakened fighter (≤ 50% HP) can be knocked out of the arena
      if (this.level.ringOut && this.time - f.lastHeavyHitAt < 2.5 && f.hp <= f.maxHp * 0.5) {
        // ring-out: off the platform = instant K.O.
        f.fallen = true;
        f.ringedOut = true;
        this.damage(f, f.hp);
        f.rag.knockOut();
        this.killCam = { victim: f.side, proj: null, phase: 'fall', t: 0 };
        this.emit({ type: 'killcam', victim: f.side });
        this.emit({ type: 'fall', side: f.side, dmg: 0, x: t.x, y, ko: true, ringOut: true });
        continue;
      }
      const dmg = Math.min(FALL_DAMAGE, f.hp);
      this.damage(f, dmg);
      this.emit({ type: 'fall', side: f.side, dmg, x: t.x, y, ko: f.ko, ringOut: false });
      f.stuck = [];
      f.rag.respawn();
      if (f.ko) f.rag.knockOut();
    }
  }

  /** Rewarded revive (boss fights): back up with half HP, player's turn. */
  revive(side: Side): void {
    const f = this.fighters[side];
    f.hp = Math.ceil(f.maxHp * 0.5);
    f.stuck = [];
    f.fallen = false;
    f.rag.state = 'recover';
    f.rag.respawn();
    this.killCam = null;
    this.winner = null;
    this.beginTurn(side, false);
  }

  /** Automation helper: a perfect shot for the current fighter (used by tests/recordings). */
  autoShot(aimHead = false): { angle: number; power: number } | null {
    const foe = this.other(this.current.side);
    const target = aimHead ? foe.rag.head.getPosition() : foe.center();
    return this.autoShotAt({ x: target.x, y: target.y });
  }

  /** Automation helper: a perfect shot at any point (a bonus, for example). */
  autoShotAt(tgt: Vec): { angle: number; power: number } {
    const f = this.current;
    const blocked = this.blocker();
    let sol = solveAim({ from: f.launchPoint(f.restAngle()), target: tgt, weapon: f.def, wind: this.wind, blocked });
    sol = solveAim({ from: f.launchPoint(sol.angle), target: tgt, weapon: f.def, wind: this.wind, blocked });
    return { angle: sol.angle, power: sol.power };
  }

  destroy(): void {
    this.listeners = [];
  }
}

function centroid(s: Solid): Vec {
  if (s.shape.kind === 'circle') return s.shape.c;
  const pts = s.shape.pts;
  return { x: pts.reduce((a, p) => a + p.x, 0) / pts.length, y: pts.reduce((a, p) => a + p.y, 0) / pts.length };
}
function pointNear(s: Solid, st: Stuck): boolean {
  const c = centroid(s);
  return Math.hypot(c.x - st.x, c.y - st.y) < 1.5;
}
