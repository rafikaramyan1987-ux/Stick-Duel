import { clamp } from '../core/math';
import type { AmmoId, LevelDef } from '../levels/types';
import { DT, Sim, type Side, type SimEvent } from '../physics/sim';
import { captureFrame, type Frame } from './frame';
import { planRivalShot, type RivalShot } from './ai';

/**
 * One duel: turns, shots and ammo, the rival's turn, slow motion on big moments, the recording of
 * the player's shot for the winning replay, and the stars. Rendering and UI listen to it.
 */
export type Phase = 'aim' | 'flight' | 'rivalAim' | 'rivalFlight' | 'replay' | 'over';

export interface DuelResult {
  win: boolean;
  reason: 'ko' | 'shots';
  stars: [boolean, boolean, boolean];
  shotsUsed: number;
  chain: boolean;
  noDirect: boolean;
}

export const AMMO_ORDER: AmmoId[] = ['arrow', 'fire', 'heavy', 'ice', 'bomb'];

interface Recording {
  frames: Frame[];
  events: Array<{ i: number; e: SimEvent }>;
  koIndex: number;
  firstEnv: number;
}

export class Duel {
  readonly sim: Sim;
  phase: Phase = 'aim';
  turn: Side = 0;
  shotsUsed = 0;
  ammo: Record<AmmoId, number>;
  selected: AmmoId = 'arrow';
  aim = { angle: -0.45, power: 0.7 };
  /** Rival's arm while it aims. */
  rivalAim: { from: number; shot: RivalShot; t: number } | null = null;
  rivalAmmo: Partial<Record<AmmoId, number>>;
  rivalTurns = 0;
  private acc = 0;
  private phaseTime = 0;
  private koTime = -1;
  slowT = 0;
  /** Chain reaction seen in one of the player's shots. */
  chain = false;
  /** Damage the player's arrows did to the rival directly. */
  directOnRival = 0;
  private rec: Recording | null = null;
  private replay: { rec: Recording; pos: number; end: number; speed: number; emitted: number } | null = null;
  result: DuelResult | null = null;
  paused = false;
  listeners: { event?: (e: SimEvent, replay: boolean) => void; phase?: (p: Phase) => void; over?: (r: DuelResult) => void } = {};

  /** No frame recording and no replay (rival AI look-ahead, level checker). */
  readonly headless: boolean;
  /** Two players on one device: both sides are human, turns alternate, unlimited arrows. */
  readonly versus: boolean;
  /** The side that is not shooting keeps its ammo, aim and selection here (versus). */
  private other: { ammo: Record<AmmoId, number>; aim: { angle: number; power: number }; selected: AmmoId } | null = null;

  constructor(
    readonly level: LevelDef,
    readonly seed = 1,
    opts: { headless?: boolean; sim?: Sim; versus?: boolean } = {},
  ) {
    this.headless = !!opts.headless;
    this.versus = !!opts.versus;
    if (opts.sim) this.sim = opts.sim;
    else {
      this.sim = new Sim(level, seed);
      this.sim.warmUp();
    }
    this.ammo = { arrow: 0, fire: 0, heavy: 0, ice: 0, bomb: 0, ...level.ammo };
    this.rivalAmmo = {};
    for (const a of level.rivalAmmo ?? []) this.rivalAmmo[a] = (this.rivalAmmo[a] ?? 0) + 1;
    const facing = level.rival.x >= level.player.x ? 1 : -1;
    this.aim.angle = facing === 1 ? -0.45 : -Math.PI + 0.45;
    this.sim.setAim(0, this.aim.angle);
    if (this.versus) this.other = { ammo: { ...this.ammo }, aim: { angle: -Math.PI + 0.45, power: 0.7 }, selected: 'arrow' };
  }

  /** Versus: hands the bow to the other player. */
  private swapTurn(): void {
    if (!this.other) return;
    const mine = { ammo: this.ammo, aim: this.aim, selected: this.selected };
    this.ammo = this.other.ammo;
    this.aim = this.other.aim;
    this.selected = this.other.selected;
    this.other = mine;
    this.sim.setAim(this.turn, null);
    this.turn = this.turn === 0 ? 1 : 0;
    this.sim.setAim(this.turn, this.aim.angle);
  }

  get shotsLeft(): number {
    return AMMO_ORDER.reduce((n, a) => n + (this.ammo[a] ?? 0), 0);
  }

  /** Facing of the side whose turn it is. */
  get facing(): 1 | -1 {
    const right = this.level.rival.x >= this.level.player.x;
    return (this.turn === 0) === right ? 1 : -1;
  }

  setAim(angle: number, power: number): void {
    // keep the aim in front of the fighter
    const f = this.facing;
    const a = f === 1 ? clamp(angle, -1.55, 1.1) : angle > 0 ? clamp(angle, Math.PI - 1.1, Math.PI) : clamp(angle, -Math.PI, -Math.PI + 1.55);
    this.aim = { angle: a, power: clamp(power, 0, 1) };
    if (this.phase === 'aim') this.sim.setAim(this.turn, a);
  }

  selectAmmo(a: AmmoId): boolean {
    if ((this.ammo[a] ?? 0) <= 0) return false;
    this.selected = a;
    return true;
  }

  canFire(): boolean {
    return this.phase === 'aim' && !this.paused && (this.ammo[this.selected] ?? 0) > 0;
  }

  fire(): boolean {
    if (!this.canFire()) return false;
    if ((this.ammo[this.selected] ?? 0) <= 0) return false;
    this.ammo[this.selected]--;
    this.shotsUsed++;
    this.rec = { frames: [], events: [], koIndex: -1, firstEnv: -1 };
    this.sim.fire(this.turn, this.aim.angle, this.aim.power, this.selected);
    this.drainEvents();
    this.setPhase('flight');
    // pick the next available ammo if this one ran out
    if ((this.ammo[this.selected] ?? 0) <= 0) {
      const next = AMMO_ORDER.find((a) => (this.ammo[a] ?? 0) > 0);
      if (next) this.selected = next;
    }
    return true;
  }

  private setPhase(p: Phase): void {
    this.phase = p;
    this.phaseTime = 0;
    this.listeners.phase?.(p);
  }

  /** Preview of the shot path (the first part only, so aiming stays a skill). */
  preview(fraction = 0.42): Array<{ x: number; y: number }> {
    return this.sim.previewPath(this.turn, this.aim.angle, this.aim.power, 1.6 * fraction + 0.2);
  }

  /** Current frame to draw (live, or the replay). */
  frame(): Frame {
    if (this.replay) {
      const r = this.replay;
      return r.rec.frames[Math.min(r.rec.frames.length - 1, Math.floor(r.pos))]!;
    }
    return captureFrame(this.sim);
  }

  get timeScale(): number {
    return this.slowT > 0 ? 0.33 : 1;
  }

  slowMo(seconds: number): void {
    this.slowT = Math.max(this.slowT, seconds);
  }

  update(dtReal: number): void {
    if (this.paused) return;
    const dt = Math.min(dtReal, 0.1);
    if (this.replay) {
      this.updateReplay(dt);
      return;
    }
    if (this.slowT > 0) this.slowT -= dt;
    this.phaseTime += dt;
    this.acc += dt * this.timeScale;
    let n = 0;
    while (this.acc >= DT && n < 8) {
      this.acc -= DT;
      n++;
      this.tick();
      if (this.phase === 'over' || this.replay) {
        this.acc = 0;
        break;
      }
    }
  }

  private tick(): void {
    if (this.phase === 'rivalAim' && this.rivalAim) {
      const ra = this.rivalAim;
      ra.t += DT;
      const k = clamp(ra.t / 0.75, 0, 1);
      const e = k * k * (3 - 2 * k);
      this.sim.setAim(1, ra.from + (ra.shot.angle - ra.from) * e);
      if (ra.t >= 0.95) {
        if (ra.shot.ammo !== 'arrow') this.rivalAmmo[ra.shot.ammo] = (this.rivalAmmo[ra.shot.ammo] ?? 1) - 1;
        this.sim.fire(1, ra.shot.angle, ra.shot.power, ra.shot.ammo);
        this.rivalTurns++;
        this.rivalAim = null;
        this.setPhase('rivalFlight');
      }
    }
    this.sim.step();
    const flying = this.phase === 'flight' || this.phase === 'rivalFlight';
    if (this.phase === 'flight' && this.rec && !this.headless) this.rec.frames.push(captureFrame(this.sim));
    this.drainEvents();
    if (!flying) return;
    const anyDead = !this.sim.fighters[0].alive || !this.sim.fighters[1].alive;
    const settled = this.sim.isSettled() && this.phaseTime > 1;
    const timeout = this.phaseTime > 11;
    const koDone = anyDead && this.koTime >= 0 && this.sim.time - this.koTime > 2.4;
    if (!(settled || timeout || koDone)) return;
    this.endShot();
  }

  private drainEvents(): void {
    const evs = this.sim.events.splice(0);
    for (const e of evs) {
      if (this.rec && this.phase === 'flight') {
        const i = Math.max(0, this.rec.frames.length - 1);
        this.rec.events.push({ i, e });
        if (this.rec.firstEnv < 0 && (e.t === 'ropeCut' || e.t === 'ignite' || e.t === 'break' || e.t === 'explode')) this.rec.firstEnv = i;
        if (e.t === 'ko' && e.side === 1 && this.rec.koIndex < 0) this.rec.koIndex = i;
      }
      if (e.t === 'ko') {
        this.koTime = this.sim.time;
        this.slowMo(1.1);
      }
      if (e.t === 'explode' || (e.t === 'break' && e.size > 0.9)) this.slowMo(0.45);
      this.listeners.event?.(e, false);
    }
  }

  private endShot(): void {
    const st = this.sim.stats;
    if (st && st.side === 0) {
      const envEvents = st.ropes + st.breaks + st.explosions + st.ignites;
      if (envEvents >= 2 && st.env > 0) this.chain = true;
      this.directOnRival += st.direct;
    }
    const p = this.sim.fighters[0];
    const r = this.sim.fighters[1];
    if (!r.alive && p.alive) return this.finish(true, 'ko');
    if (!p.alive) return this.finish(false, 'ko');
    if (this.phase === 'flight') {
      if (this.versus) {
        this.swapTurn();
        this.setPhase('aim');
        return;
      }
      if (this.shotsLeft <= 0) return this.finish(false, 'shots');
      this.startRival();
    } else {
      this.sim.setAim(1, null);
      this.sim.setAim(0, this.aim.angle);
      this.setPhase('aim');
    }
  }

  private startRival(): void {
    this.sim.setAim(0, null);
    const shot = planRivalShot(this.sim, this.level, this.seed, this.rivalTurns, this.rivalAmmo);
    const facing = this.level.player.x >= this.level.rival.x ? 1 : -1;
    this.rivalAim = { from: facing === 1 ? -0.2 : -Math.PI + 0.2, shot, t: 0 };
    this.setPhase('rivalAim');
  }

  private finish(win: boolean, reason: DuelResult['reason']): void {
    const noDirect = this.directOnRival === 0;
    this.result = {
      win,
      reason,
      shotsUsed: this.shotsUsed,
      chain: this.chain,
      noDirect,
      stars: [win, win && this.shotsUsed <= this.level.par, win && (this.chain || noDirect)],
    };
    const rec = this.rec;
    if (win && rec && rec.koIndex >= 0 && rec.frames.length > 10 && !this.headless) {
      const start = Math.max(0, Math.max(rec.firstEnv - 20, rec.koIndex - 240));
      const end = Math.min(rec.frames.length - 1, rec.koIndex + 80);
      const frames = end - start;
      const speed = clamp(frames / 60 / 5, 0.32, 1);
      this.replay = { rec, pos: start, end, speed, emitted: rec.events.findIndex((x) => x.i >= start) };
      if (this.replay.emitted < 0) this.replay.emitted = rec.events.length;
      this.setPhase('replay');
      return;
    }
    this.setPhase('over');
    this.listeners.over?.(this.result);
  }

  private updateReplay(dt: number): void {
    const r = this.replay!;
    r.pos += dt * 60 * r.speed;
    const evs = r.rec.events;
    while (r.emitted < evs.length && evs[r.emitted]!.i <= r.pos) {
      this.listeners.event?.(evs[r.emitted]!.e, true);
      r.emitted++;
    }
    if (r.pos >= r.end) this.skipReplay();
  }

  skipReplay(): void {
    if (!this.replay) return;
    this.replay = null;
    this.setPhase('over');
    if (this.result) this.listeners.over?.(this.result);
  }

  /** A headless copy of this duel at rest (player's turn), for look-ahead searches. */
  clone(): Duel {
    const d = new Duel(this.level, this.seed, { headless: true, sim: this.sim.clone() });
    d.phase = this.phase;
    d.shotsUsed = this.shotsUsed;
    Object.assign(d.ammo, this.ammo);
    d.selected = this.selected;
    d.aim = { ...this.aim };
    d.rivalAmmo = { ...this.rivalAmmo };
    d.rivalTurns = this.rivalTurns;
    d.chain = this.chain;
    d.directOnRival = this.directOnRival;
    return d;
  }

  /** Rewarded "continue with 1 HP": the player gets back up and it is their turn again. */
  revive(): void {
    const f = this.sim.fighters[0];
    f.hp = 1;
    f.alive = true;
    f.rag.state = 'stand';
    f.rag.strength = 1;
    f.rag.stateTime = 0;
    f.rag.placeAt(this.level.player.x, this.level.player.y);
    if (this.shotsLeft <= 0) this.ammo.arrow = (this.ammo.arrow ?? 0) + 2;
    if (!this.selectAmmo(this.selected)) this.selectAmmo(AMMO_ORDER.find((a) => (this.ammo[a] ?? 0) > 0) ?? 'arrow');
    this.result = null;
    this.replay = null;
    this.koTime = -1;
    this.turn = 0;
    this.sim.setAim(1, null);
    this.sim.setAim(0, this.aim.angle);
    this.setPhase('aim');
  }

  /** Rewarded "continue with 1 HP" (Phase B) and tests. */
  get playerHp(): number {
    return this.sim.fighters[0].hp;
  }
  get rivalHp(): number {
    return this.sim.fighters[1].hp;
  }
}
