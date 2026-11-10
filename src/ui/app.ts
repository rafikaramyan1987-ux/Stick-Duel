import { audio, type MusicTrack, type SampleGroup } from '../audio/sfx';
import { clamp } from '../core/math';
import { AMMO_ORDER, Duel, type DuelResult, type Phase } from '../game/duel';
import { starCount, writeSave, freshSave, type SaveData } from '../game/save';
import { detectLang, getLang, LANGS, setLang, t, type Key } from '../i18n';
import { LEVELS } from '../levels';
import type { AmmoId, LevelDef, WorldId } from '../levels/types';
import { aimsAt } from '../physics/aim';
import type { SimEvent } from '../physics/sim';
import { GameplayTracker, MidgameThrottle, type Platform } from '../platform/ads';
import { Stage } from '../render/stage';
import { View } from '../render/view';
import { clear, h } from './dom';
import { ICONS } from './icons';

/** How long a rewarded button shows "no ad available" before it can be tried again. */
export const AD_FAIL_MS = 2500;

const WORLDS: WorldId[] = ['forest', 'castle', 'mountains', 'desert', 'frozen', 'volcano'];
/** Width of the play area a phone in portrait shows (metres). */
const PORTRAIT_WIDTH = 12.5;
const MUSIC: Record<WorldId, MusicTrack> = { forest: 'forest', castle: 'castle', mountains: 'mountains', desert: 'desert', frozen: 'snow', volcano: 'volcano' };

type Screen = 'title' | 'worlds' | 'play' | 'result';

export class App {
  private readonly canvas: HTMLCanvasElement;
  private readonly stage: Stage;
  private readonly view: View;
  private readonly hud: HTMLElement;
  private readonly layer: HTMLElement;
  private readonly bubbles: HTMLElement;
  private readonly aimLine: HTMLElement;
  private readonly banner: HTMLElement;
  private tutEl: HTMLElement | null = null;
  duel: Duel | null = null;
  levelIndex = 0;
  screen: Screen = 'title';
  private tracker: GameplayTracker;
  private throttle = new MidgameThrottle();
  private adBreak = false;
  paused = false;
  adPlaying = false;
  private last = performance.now();
  private drag: { id: number; x0: number; y0: number; x: number; y: number; angle0: number } | null = null;
  private hudRefs: Record<string, HTMLElement> = {};
  /** Tutorial step: 0 off, 1 aim at the rope, 2 watch. */
  tutorial = 0;
  private soundBudget = 0;
  private koFocus: { x: number; y: number } | null = null;
  private menuTime = 0;
  /** Simulation speed multiplier (automation / recordings). */
  speed = 1;

  constructor(
    private readonly root: HTMLElement,
    public save: SaveData,
    private readonly platform: Platform,
  ) {
    this.tracker = new GameplayTracker(platform);
    clear(root);
    this.canvas = h<'canvas'>('canvas#game');
    this.hud = h('div.hud.hidden');
    this.bubbles = h('div.bubbles');
    this.aimLine = h('div.aimline.hidden', {}, h('i.knob'), h('b.power'));
    this.banner = h('div.banner');
    this.layer = h('div.layer');
    root.append(this.canvas, this.bubbles, this.aimLine, this.hud, this.banner, this.layer);
    this.stage = new Stage(this.canvas);
    this.view = new View(this.stage);
    this.applySettings();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.bindInput();
    platform.onPlatformMuteChange(() => this.applyAudio());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.isPlaying()) this.pause();
    });
    requestAnimationFrame((t0) => this.frame(t0));
    // automation hooks (Playwright tests, screenshots and the preview video)
    (window as unknown as { __toppleDuel: unknown }).__toppleDuel = this;
  }

  /* ───────────── settings, audio, platform ───────────── */

  private applySettings(): void {
    setLang(this.save.lang ?? detectLang(this.platform.locale(), ...(navigator.languages ?? []), navigator.language));
    this.applyAudio();
  }

  private applyAudio(): void {
    audio.setSfxEnabled(this.save.sfx);
    audio.setMusicEnabled(this.save.music);
    audio.setMuted(this.adPlaying || this.platform.platformMuted());
  }

  /** Called by the platform: true while an ad plays or the portal pauses the game, false after. */
  onAdPause(paused: boolean): void {
    this.adPlaying = paused;
    if (paused) {
      this.drag = null;
      this.aimLine.classList.add('hidden');
    }
    this.applyAudio();
    if (!paused) this.last = performance.now();
  }

  private persist(): void {
    writeSave(this.save);
  }

  private resize(): void {
    this.stage.resize();
    const portrait = this.stage.height > this.stage.width;
    this.root.classList.toggle('is-portrait', portrait);
    this.stage.insetTop = portrait ? 118 : 74;
    this.stage.insetBottom = portrait ? 96 : 84;
    if (this.duel) this.frameCamera(true);
  }

  private isPlaying(): boolean {
    return this.screen === 'play' && !!this.duel && this.duel.phase !== 'over' && !this.paused;
  }

  private ui(group: SampleGroup): void {
    audio.sample(group, { volume: 0.7 });
  }

  /* ───────────── main loop ───────────── */

  /** Manual clock (recordings): the game only advances through advance(). */
  manual = false;

  private frame(now: number): void {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    if (!this.manual) this.step(dt);
    requestAnimationFrame((t0) => this.frame(t0));
  }

  private gameTime = 0;
  private animsHeld = false;
  private timers: Array<{ id: number; t: number; fn: () => void }> = [];
  private timerId = 0;

  /** setTimeout on game time when the clock is manual (recordings stay in sync), real time otherwise. */
  private later(fn: () => void, ms: number): number {
    const id = ++this.timerId;
    if (!this.manual) {
      const h = window.setTimeout(() => {
        this.timers = this.timers.filter((x) => x.id !== id);
        fn();
      }, ms);
      this.timers.push({ id, t: -h, fn });
    } else this.timers.push({ id, t: this.gameTime + ms / 1000, fn });
    return id;
  }

  private cancel(id: number): void {
    const x = this.timers.find((tm) => tm.id === id);
    if (x && x.t < 0) window.clearTimeout(-x.t);
    this.timers = this.timers.filter((tm) => tm.id !== id);
  }

  /** Advances the game by exactly dt seconds and renders (used by the preview recorder). */
  advance(dt: number, render = true): void {
    this.step(dt, render);
  }

  private step(dt: number, render = true): void {
    this.gameTime += dt;
    const due = this.timers.filter((x) => x.t >= 0 && x.t <= this.gameTime);
    if (due.length) {
      this.timers = this.timers.filter((x) => !due.includes(x));
      for (const x of due) x.fn();
    }
    if (this.manual) {
      // CSS animations and transitions follow the manual clock too
      for (const a of document.getAnimations()) {
        a.pause();
        a.currentTime = (Number(a.currentTime) || 0) + dt * 1000;
      }
      this.animsHeld = true;
    } else if (this.animsHeld) {
      this.animsHeld = false;
      for (const a of document.getAnimations()) if (a.playState === 'paused') a.play();
    }
    this.soundBudget = Math.min(6, this.soundBudget + dt * 14);
    const d = this.duel;
    if (d) {
      const running = !this.paused && !this.adPlaying;
      if (running) {
        if (this.screen === 'title' || this.screen === 'worlds') {
          this.menuTime += dt;
          d.sim.step();
          d.sim.events.length = 0;
        } else {
          for (let i = 0; i < this.speed; i++) d.update(dt);
        }
      }
      const fxDt = running ? dt * (d.phase === 'replay' ? 0.45 : d.timeScale) : 0;
      this.view.sync(d.frame(), fxDt);
      if (running && this.screen === 'play') this.tick(dt);
      this.frameCamera(false);
    }
    this.stage.update(this.adPlaying || this.paused ? 0 : dt, d?.phase === 'replay' ? 2 : 3);
    if (render) this.stage.render();
  }

  private frameCamera(instant: boolean): void {
    const d = this.duel;
    if (!d) return;
    const v = d.level.view;
    if (this.screen === 'title' || this.screen === 'worlds') {
      const sway = Math.sin(this.menuTime * 0.15) * 1.2;
      this.stage.frame(v.x0 + sway, v.x1 + sway, v.y0 - 1, v.y1, instant);
      return;
    }
    if (this.koFocus && (d.phase === 'replay' || d.phase === 'flight' || d.phase === 'rivalFlight')) {
      const k = this.koFocus;
      this.stage.frame(k.x - 5, k.x + 5, k.y - 4.2, k.y + 1.5, instant);
      return;
    }
    if (this.stage.height > this.stage.width * 1.05) {
      const [x0, x1] = this.portraitFocus(d);
      const cx = (x0 + x1) / 2;
      const w = x1 - x0;
      this.camX = instant || this.camX === null ? cx : this.camX + (cx - this.camX) * 0.12;
      this.camW = instant || this.camW === null ? w : this.camW + (w - this.camW) * 0.1;
      this.stage.frame(this.camX - this.camW / 2, this.camX + this.camW / 2, v.y0, v.y1, instant);
      return;
    }
    this.stage.frame(v.x0, v.x1, v.y0, v.y1, instant);
  }

  private camX: number | null = null;
  private camW: number | null = null;
  /** Portrait: seconds left of the opening shot of the rival's side. */
  private establishT = 0;

  /**
   * On a phone held upright the arena is wider than the screen, so the camera shows a 14 m window:
   * the rival's side first, then the player with a look-ahead that grows with the shot power,
   * the arrow in flight, and wherever things are moving.
   */
  private portraitFocus(d: Duel): [number, number] {
    const v = d.level.view;
    const half = PORTRAIT_WIDTH / 2;
    const f = d.facing;
    const p = d.sim.fighters[0].rag.torso.getPosition().x;
    const r = d.sim.fighters[1].rag.torso.getPosition().x;
    const span = (a: number, b: number): [number, number] => {
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      return hi - lo >= PORTRAIT_WIDTH ? [lo, hi] : [(lo + hi) / 2 - half, (lo + hi) / 2 + half];
    };
    let box = span(p - f * 1.2, p + f * (PORTRAIT_WIDTH - 1.2));
    if (d.phase === 'aim') {
      if (this.establishT > 0) box = span(r + f * 1.5, r - f * (PORTRAIT_WIDTH - 1.5));
      else if (this.drag || this.keyAiming > 0 || this.tutorial === 1) {
        // zoom out just enough to keep the archer and the start of the flight path in view
        let far = p;
        for (const q of d.preview(this.tutorial === 1 ? 1.2 : 0.42)) far = f === 1 ? Math.max(far, q.x) : Math.min(far, q.x);
        if (this.tutorial === 1 && d.level.hintTarget) {
          const rope = d.sim.rope(d.level.hintTarget);
          if (rope) far = f === 1 ? Math.max(far, rope.def.anchor.x) : Math.min(far, rope.def.anchor.x);
        }
        box = span(p - f * 1.2, far + f * 1.2);
        if (Math.abs(box[1] - box[0]) <= PORTRAIT_WIDTH) box = span(p - f * 1.2, p + f * (PORTRAIT_WIDTH - 1.2));
      }
    } else if (d.phase === 'rivalAim') {
      box = span(r + f * 1.2, r - f * (PORTRAIT_WIDTH - 1.2));
    } else if (d.phase === 'flight' || d.phase === 'rivalFlight') {
      const a = d.sim.arrows[0];
      let cx: number;
      if (a) cx = a.body.getPosition().x;
      else {
        let sx = 0;
        let sw = 0;
        for (const e of d.sim.ents) {
          if (e.dead || e.desc.fixed) continue;
          const vel = e.body.getLinearVelocity();
          const sp = Math.hypot(vel.x, vel.y);
          if (sp < 0.8) continue;
          sx += e.body.getPosition().x * sp * e.body.getMass();
          sw += sp * e.body.getMass();
        }
        cx = sw > 0 ? sx / sw : d.phase === 'flight' ? r : p;
      }
      box = [cx - half, cx + half];
    }
    // stay inside the arena
    let [x0, x1] = box;
    if (x0 < v.x0) [x0, x1] = [v.x0, x1 + (v.x0 - x0)];
    if (x1 > v.x1) [x0, x1] = [x0 - (x1 - v.x1), v.x1];
    return [Math.max(x0, v.x0 - 1), Math.min(x1, v.x1 + 1)];
  }


  /** Per-frame game UI: HUD, aim preview, tutorial. */
  private tick(_dt: number): void {
    const d = this.duel!;
    const aiming = d.phase === 'aim';
    if (aiming && (this.drag || this.tutorial === 1 || this.keyAiming > 0)) {
      this.view.showPath(d.preview(this.tutorial === 1 ? 1.2 : 0.42), d.selected === 'fire' ? 0xffb347 : 0xffffff);
    } else this.view.showPath(null);
    if (this.keyAiming > 0) this.keyAiming -= _dt;
    if (this.establishT > 0) this.establishT -= _dt;
    this.updateHud();
    if (this.tutorial === 1) this.positionTutorial();
  }

  private keyAiming = 0;

  /* ───────────── screens ───────────── */

  /** Background arena for the menus (a live, idle level). */
  private menuBackdrop(): void {
    if (this.duel && this.screen !== 'play' && this.screen !== 'result') return;
    const lv = LEVELS[Math.min(this.save.last ? LEVELS.findIndex((l) => l.id === this.save.last) : 0, LEVELS.length - 1)] ?? LEVELS[0]!;
    this.loadDuel(lv);
    audio.music('menu');
  }

  title(): void {
    this.tracker.stop();
    this.screen = 'title';
    this.paused = false;
    this.hud.classList.add('hidden');
    this.clearTutorial();
    this.menuBackdrop();
    this.koFocus = null;
    const cont = !!this.save.last && Object.keys(this.save.levels).length > 0;
    clear(this.layer);
    const menu = h(
      'div.screen.title',
      {},
      h('div.logo', {}, h('span.l1', {}, 'TOPPLE'), h('span.l2', {}, 'DUEL')),
      h('div.tagline', {}, t('title.tagline')),
      h(
        'div.menu',
        {},
        this.btn(cont ? t('menu.continue') : t('menu.play'), () => void this.prerollThen(() => this.play(this.nextLevelIndex())), 'primary big', { id: 'play' }, ICONS.play),
        this.btn(t('menu.worlds'), () => this.worlds(), '', { id: 'worlds' }, ICONS.map),
        this.btn(t('menu.versus'), () => this.toast(t('menu.soon')), 'soon', { id: 'versus', 'aria-disabled': 'true' }, ICONS.users, t('menu.soon')),
        this.btn(t('menu.endless'), () => this.toast(t('menu.soon')), 'soon', { id: 'endless', 'aria-disabled': 'true' }, ICONS.infinity, t('menu.soon')),
        this.btn(t('menu.settings'), () => this.settings(() => this.title()), '', { id: 'settings' }, ICONS.gear),
      ),
      h('div.coins', {}, h('span.coin'), String(this.save.coins)),
    );
    this.layer.append(menu);
  }

  private nextLevelIndex(): number {
    const i = LEVELS.findIndex((l) => !this.save.levels[l.id]?.stars[0]);
    if (i >= 0) return i;
    const last = LEVELS.findIndex((l) => l.id === this.save.last);
    return last >= 0 ? last : 0;
  }

  private unlocked(i: number): boolean {
    return i === 0 || !!this.save.levels[LEVELS[i - 1]!.id]?.stars[0];
  }

  worlds(): void {
    this.screen = 'worlds';
    this.ui('ui_open');
    clear(this.layer);
    const grid = h('div.worldgrid');
    for (const w of WORLDS) {
      const levels = LEVELS.map((l, i) => ({ l, i })).filter((x) => x.l.world === w);
      const card = h(`div.world.w-${w}${levels.length ? '' : '.locked'}`, {}, h('div.wname', {}, t(`world.${w}` as Key)));
      const row = h('div.levels');
      for (const { l, i } of levels) {
        const open = this.unlocked(i);
        const stars = starCount(this.save, l.id);
        const b = h(
          `button.lvl${open ? '' : '.locked'}`,
          { 'data-level': l.id, 'aria-label': `${t(`world.${w}` as Key)} ${t('worlds.level', { n: l.n })}`, onclick: () => (open ? void this.prerollThen(() => this.play(i)) : this.ui('ui_error')) },
          h('b', {}, String(l.n)),
          h('span.stars', {}, '★'.repeat(stars) + '☆'.repeat(3 - stars)),
        );
        row.append(b);
      }
      if (!levels.length) row.append(h('div.soonnote', {}, t('worlds.soon')));
      card.append(row);
      grid.append(card);
    }
    this.layer.append(h('div.screen.worlds', {}, h('div.topbar', {}, this.btn(t('common.back'), () => this.title(), 'small', { id: 'back' }, ICONS.back), h('h2', {}, t('worlds.title'))), grid));
  }

  private loadDuel(level: LevelDef): void {
    this.duel = new Duel(level, 1);
    this.view.build(level, this.duel.sim);
    this.duel.listeners = {
      event: (e, replay) => this.onEvent(e, replay),
      phase: (p) => this.onPhase(p),
      over: (r) => this.onOver(r),
    };
    this.frameCamera(true);
  }

  play(index: number): void {
    const level = LEVELS[clamp(index, 0, LEVELS.length - 1)]!;
    this.levelIndex = LEVELS.indexOf(level);
    this.adFireUsed = false;
    this.clearTutorial();
    this.screen = 'play';
    this.paused = false;
    this.koFocus = null;
    this.save.last = level.id;
    this.persist();
    clear(this.layer);
    clear(this.bubbles);
    this.loadDuel(level);
    this.camX = null;
    this.establishT = this.stage.height > this.stage.width * 1.05 ? 1.8 : 0;
    this.frameCamera(true);
    this.buildHud();
    this.hud.classList.remove('hidden');
    audio.music(MUSIC[level.world]);
    this.tracker.start();
    if (level.id === 'forest-1' && !this.save.tutorial) this.startTutorial();
    else {
      this.flashBanner(`${t(`world.${level.world}` as Key)} · ${t(level.name as Key)}`, 1.6);
      this.showHint(level);
    }
  }

  /* ───────────── HUD ───────────── */

  private buildHud(): void {
    const d = this.duel!;
    clear(this.hud);
    const hp = (cls: string, name: string) =>
      h(`div.hp.${cls}`, {}, h('div.name', {}, name), h('div.bar', {}, h('i'), h('span.val')));
    const ammo = h('div.ammo');
    AMMO_ORDER.forEach((a, i) => {
      if (!(d.level.ammo[a] ?? 0) && !(d.ammo[a] ?? 0)) return;
      const b = h(
        `button.ab.a-${a}`,
        { 'data-ammo': a, 'aria-label': t(`ammo.${a}` as Key), title: `${t(`ammo.${a}` as Key)} (${i + 1})`, onclick: (ev: Event) => { ev.stopPropagation(); this.pickAmmo(a); } },
        h('span.ic', { html: ICONS[`ammo_${a}` as keyof typeof ICONS] }),
        h('span.lbl', {}, t(`ammo.${a}` as Key)),
        h('b.cnt'),
        h('kbd', {}, String(i + 1)),
      );
      ammo.append(b);
    });
    this.hud.append(
      h(
        'div.top',
        {},
        h('button.round#pause', { 'aria-label': t('hud.pause'), onclick: () => this.pause(), html: ICONS.pause }),
        hp('p0', t('hud.you')),
        h('div.info', {}, h('div.lvname', {}, `${t(`world.${d.level.world}` as Key)} ${d.level.n} · ${t(d.level.name as Key)}`), h('div.shots', {}, h('span.k', {}, t('hud.shots')), h('b.sv'), h('span.par', {}, t('hud.par', { n: d.level.par })))),
        hp('p1', t('hud.rival')),
      ),
      h('div.turn'),
      h('div.bottom', {}, ammo),
    );
    // rewarded: one extra fire arrow per level (not in the web build, not when ads are unavailable)
    if (this.platform.name !== 'none' && this.platform.adsUnavailable() === null && !this.adFireUsed && d.phase !== 'over') {
      const b = this.adButton(t('ad.fire'), () => {
        this.adFireUsed = true;
        d.ammo.fire = (d.ammo.fire ?? 0) + 1;
        d.selectAmmo('fire');
        this.ui('ui_confirm');
        this.buildHud();
      }, { id: 'ad-fire' });
      b.classList.add('adfire');
      this.hud.append(b);
    }
    this.hudRefs = {
      p0: this.hud.querySelector('.hp.p0') as HTMLElement,
      p1: this.hud.querySelector('.hp.p1') as HTMLElement,
      shots: this.hud.querySelector('.shots .sv') as HTMLElement,
      turn: this.hud.querySelector('.turn') as HTMLElement,
    };
    this.updateHud(true);
  }

  private hudCache = '';
  /** The rewarded extra fire arrow was used in this level. */
  private adFireUsed = false;
  private updateHud(force = false): void {
    const d = this.duel;
    if (!d) return;
    const f = d.sim.fighters;
    const key = `${f[0].hp}|${f[1].hp}|${d.shotsLeft}|${d.phase}|${d.selected}|${AMMO_ORDER.map((a) => d.ammo[a]).join(',')}|${getLang()}`;
    if (!force && key === this.hudCache) return;
    this.hudCache = key;
    for (const s of [0, 1] as const) {
      const el = this.hudRefs[`p${s}`];
      if (!el) continue;
      const k = f[s].hp / f[s].maxHp;
      (el.querySelector('.bar i') as HTMLElement).style.transform = `scaleX(${clamp(k, 0, 1)})`;
      (el.querySelector('.val') as HTMLElement).textContent = `${f[s].hp}`;
      el.classList.toggle('low', k < 0.34);
    }
    if (this.hudRefs.shots) this.hudRefs.shots.textContent = String(d.shotsLeft);
    for (const b of Array.from(this.hud.querySelectorAll<HTMLButtonElement>('.ab'))) {
      const a = b.dataset.ammo as AmmoId;
      const n = d.ammo[a] ?? 0;
      (b.querySelector('.cnt') as HTMLElement).textContent = String(n);
      b.classList.toggle('sel', d.selected === a);
      b.disabled = n <= 0;
    }
    const turn = this.hudRefs.turn;
    if (turn) {
      const mine = d.phase === 'aim';
      const rival = d.phase === 'rivalAim' || d.phase === 'rivalFlight';
      turn.textContent = mine ? t('hud.yourTurn') : rival ? t('hud.rivalTurn') : '';
      turn.className = `turn ${mine ? 'mine' : rival ? 'rival' : 'none'}`;
    }
  }

  private pickAmmo(a: AmmoId): void {
    const d = this.duel;
    if (!d || this.paused) return;
    if (d.selectAmmo(a)) this.ui('ui_switch');
    else this.ui('ui_error');
    this.updateHud(true);
  }

  /* ───────────── events → juice ───────────── */

  private onEvent(e: SimEvent, replay: boolean): void {
    this.view.event(e);
    const sound = (g: SampleGroup, v: number, pitch = 1) => {
      if (this.soundBudget < 1) return;
      this.soundBudget -= 1;
      audio.sample(g, { volume: clamp(v, 0.05, 1), pitch: replay ? pitch * 0.8 : pitch });
    };
    switch (e.t) {
      case 'shot':
        audio.sample('ui_pluck', { volume: 0.9, pitch: 0.7 });
        audio.play('whoosh', { volume: 0.5 });
        break;
      case 'impact': {
        const s = e.strength;
        if (e.sound === 'wood') sound(s > 0.6 ? 'wood_heavy' : s > 0.25 ? 'wood_med' : 'wood_light', 0.4 + s * 0.6);
        else if (e.sound === 'stone') sound(s > 0.5 ? 'plate_heavy' : 'stone', 0.4 + s * 0.6);
        else if (e.sound === 'metal') sound(s > 0.4 ? 'metal_heavy' : 'metal_light', 0.4 + s * 0.6);
        else if (e.sound === 'glass') sound('glass', 0.5 + s * 0.5);
        else sound(s > 0.5 ? 'soft_heavy' : 'soft_med', 0.35 + s * 0.6);
        if (s > 0.55) this.stage.shake(0.12 + s * 0.25, 0.3);
        break;
      }
      case 'break':
        sound(e.mat === 'stone' ? 'stone' : 'plank', 1);
        if (e.mat === 'stone') audio.play('crumble', { volume: 0.7 });
        this.stage.shake(0.12 + Math.min(e.size, 2) * 0.1, 0.3);
        break;
      case 'ropeCut':
        sound('wood_light', 0.8, 1.3);
        audio.play('twang', { volume: 0.5, pitch: 1.3 });
        break;
      case 'ignite':
        audio.play('magic', { volume: 0.4, pitch: 0.6 });
        break;
      case 'explode':
        audio.play('explosion', { volume: 1 });
        sound('plate_heavy', 0.8, 0.7);
        this.stage.shake(0.9, 0.6);
        if (!replay) this.bubbleWord(t('bubble.boom'), e.x, e.y - 1, 'boom');
        break;
      case 'stick':
        if (e.sound === 'punch') sound('punch_med', 0.8);
        else if (e.sound === 'wood') sound('wood_light', 0.6);
        else if (e.sound === 'stone') sound('stone', 0.5, 1.3);
        else if (e.sound === 'metal') sound('metal_light', 0.6);
        else sound('soft_med', 0.4);
        break;
      case 'damage':
        if (!replay) this.damageBubble(e.amount, e.x, e.y, e.direct, e.side);
        sound(e.direct ? 'punch_med' : 'punch_heavy', e.direct ? 0.6 : 1);
        this.view.chars?.[e.side].setFace('hurt', 0.8);
        if (!e.direct && e.amount > 20) this.stage.shake(0.35, 0.35);
        if (!replay && e.direct && e.side === 1 && !this.save.hints.includes('direct') && this.duel?.level.id !== 'forest-1') {
          this.save.hints.push('direct');
          this.persist();
          this.later(() => this.flashBanner(t('hint.direct'), 3), 600);
        }
        break;
      case 'ko':
        audio.play('ko', { volume: 0.9 });
        this.view.chars?.[e.side].setFace('ko');
        this.view.chars?.[e.side === 0 ? 1 : 0].setFace('happy', 99);
        this.koFocus = { x: e.x, y: e.y };
        if (!replay) this.bubbleWord(t('bubble.ko'), e.x, e.y - 1.6, 'ko');
        this.stage.shake(0.5, 0.4);
        break;
      case 'fall':
        audio.play('whoosh', { volume: 0.6, pitch: 0.6 });
        break;
    }
  }

  private onPhase(p: Phase): void {
    const d = this.duel;
    if (!d || this.screen !== 'play') return;
    if (p === 'aim') {
      d.sim.setAim(0, d.aim.angle);
      this.view.chars?.[0].setFace('normal');
      if (this.view.chars) this.view.chars[0].nocked.visible = true;
    } else {
      if (this.view.chars) this.view.chars[0].nocked.visible = false;
    }
    if (p === 'rivalAim') {
      this.view.chars?.[1].setFace('aim', 1);
      audio.play('turn', { volume: 0.3 });
    }
    if (p === 'flight' && this.tutorial === 1) {
      this.tutorial = 2;
      this.showTutorialStep(t('tut.watch'), false);
      this.save.tutorial = true;
      this.persist();
      this.later(() => this.clearTutorial(), 2600);
    }
    if (p === 'replay') {
      this.tracker.stop();
      this.banner.classList.add('replay');
      this.banner.replaceChildren(h('b', {}, `▶ ${t('replay.label')}`), h('small', {}, t('replay.skip')));
      this.banner.classList.add('show');
    }
    if (p === 'over') this.banner.classList.remove('show', 'replay');
    this.updateHud(true);
  }

  private onOver(r: DuelResult): void {
    const d = this.duel!;
    this.tracker.stop();
    this.view.showPath(null);
    const id = d.level.id;
    const prev = this.save.levels[id]?.stars ?? [false, false, false];
    const stars: [boolean, boolean, boolean] = [prev[0] || r.stars[0], prev[1] || r.stars[1], prev[2] || r.stars[2]];
    const coins = r.win ? 10 + r.stars.filter(Boolean).length * 5 : 0;
    if (r.win) {
      this.save.levels[id] = { stars };
      this.save.coins += coins;
      if (import.meta.env.VITE_PLATFORM === 'gamepix') this.platform.happyMoment?.('level_complete');
      if (this.levelIndex === LEVELS.length - 1) this.platform.happytime();
    } else if (import.meta.env.VITE_PLATFORM === 'gamepix') this.platform.sadMoment?.('level_failed');
    this.persist();
    this.later(() => this.result(r, coins), r.win ? 300 : 900);
  }

  private result(r: DuelResult, coins: number): void {
    if (this.screen !== 'play') return;
    this.screen = 'result';
    audio.play(r.win ? 'win' : 'lose', { volume: 0.8 });
    const last = this.levelIndex >= LEVELS.length - 1;
    const labels: Key[] = ['star.win', 'star.par', 'star.trick'];
    const stars = h('div.stars3');
    r.stars.forEach((s, i) => {
      const el = h(`div.star${s ? '.on' : ''}`, { style: `animation-delay:${0.15 + i * 0.22}s` }, h('i', { html: ICONS.star }), h('span', {}, t(labels[i]!)));
      stars.append(el);
      if (s) this.later(() => audio.sample('ui_star', { volume: 0.7, pitch: 1 + i * 0.12 }), 150 + i * 220);
    });
    const title = r.win ? t('result.win') : r.reason === 'shots' ? t('result.outOfShots') : t('result.lose');
    const buttons = h('div.row');
    if (r.win && !last) buttons.append(this.btn(t('result.next'), () => void this.breakThen(() => this.play(this.levelIndex + 1)), 'primary big', { id: 'next' }, ICONS.play));
    buttons.append(this.btn(t('result.retry'), () => void this.breakThen(() => this.play(this.levelIndex)), r.win ? '' : 'primary big', { id: 'retry' }, ICONS.retry));
    buttons.append(this.btn(t('result.menu'), () => void this.breakThen(() => this.title()), '', { id: 'menu' }, ICONS.home));
    const card = h(
      `div.card.result.${r.win ? 'won' : 'lost'}`,
      {},
      h('h2', {}, title),
      r.win ? stars : null,
      r.win && r.chain ? h('div.tag', {}, t('bubble.chain')) : null,
      r.win ? h('div.coinsgot', {}, h('span.coin'), t('result.coins', { n: coins })) : null,
      r.win && last ? h('div.note', {}, t('result.allDone')) : null,
      buttons,
    );
    clear(this.layer);
    this.layer.append(h('div.screen.dim', {}, card));
  }

  /* ───────────── comic bubbles ───────────── */

  private damageBubble(amount: number, x: number, y: number, direct: boolean, side: number): void {
    const p = this.stage.toScreen(x, y - 0.6);
    const big = !direct && amount >= 20;
    const word = direct ? '' : amount >= 60 ? t('bubble.crash') : amount >= 20 ? t('bubble.bonk') : '';
    const el = h(`div.bubble${direct ? '.small' : ''}${big ? '.big' : ''}${side === 0 ? '.mine' : ''}`, { style: `left:${p.x}px;top:${p.y}px` }, word ? h('em', {}, word) : null, h('b', {}, `-${amount}`));
    this.bubbles.append(el);
    this.later(() => el.remove(), 1500);
  }

  private bubbleWord(text: string, x: number, y: number, cls: string): void {
    const p = this.stage.toScreen(x, y);
    const el = h(`div.bubble.word.${cls}`, { style: `left:${clamp(p.x, 80, this.stage.width - 80)}px;top:${clamp(p.y, 90, this.stage.height - 60)}px` }, h('b', {}, text));
    this.bubbles.append(el);
    this.later(() => el.remove(), 1600);
  }

  private flashBanner(text: string, seconds: number): void {
    if (this.banner.classList.contains('replay')) return;
    this.banner.replaceChildren(h('b', {}, text));
    this.banner.classList.add('show');
    this.cancel(this.bannerTimer);
    this.bannerTimer = this.later(() => this.banner.classList.remove('show'), seconds * 1000);
  }
  private bannerTimer = 0;

  private toast(text: string): void {
    this.ui('ui_error');
    const el = h('div.toast', {}, text);
    this.root.append(el);
    this.later(() => el.remove(), 1800);
  }

  /* ───────────── tutorial & hints ───────────── */

  private startTutorial(): void {
    this.tutorial = 1;
    this.showTutorialStep(t('tut.aim'), true);
  }

  private showTutorialStep(text: string, hand: boolean): void {
    this.tutEl?.remove();
    const el = h(
      'div.tutorial',
      {},
      hand ? h('div.ring') : null,
      hand ? h('div.hand', { html: ICONS.hand }) : null,
      h('div.tip', {}, h('b', {}, text), hand ? h('small', {}, t('tut.drag')) : null, hand ? h('button.skip#tut-skip', { onclick: (e: Event) => { e.stopPropagation(); this.skipTutorial(); } }, t('tut.skip')) : null),
    );
    this.root.append(el);
    this.tutEl = el;
    this.positionTutorial();
  }

  private positionTutorial(): void {
    const d = this.duel;
    const el = this.tutEl;
    if (!d || !el) return;
    const ring = el.querySelector('.ring') as HTMLElement | null;
    const hand = el.querySelector('.hand') as HTMLElement | null;
    const rope = d.level.hintTarget ? d.sim.rope(d.level.hintTarget) : undefined;
    if (rope && ring) {
      const [a, b] = d.sim.ropeEnds(rope);
      const p = this.stage.toScreen((a.x + b.x) / 2, (a.y + b.y) / 2);
      ring.style.left = `${p.x}px`;
      ring.style.top = `${p.y}px`;
    }
    if (hand) {
      const sp = d.sim.fighters[0].rag.shoulder();
      const p = this.stage.toScreen(sp.x, sp.y);
      hand.style.left = `${p.x + 20}px`;
      hand.style.top = `${p.y + 10}px`;
    }
  }

  private skipTutorial(): void {
    this.save.tutorial = true;
    this.persist();
    this.clearTutorial();
  }

  private clearTutorial(): void {
    this.tutorial = 0;
    this.tutEl?.remove();
    this.tutEl = null;
  }

  private showHint(level: LevelDef): void {
    const key = level.id === 'castle-1' ? 'hint.castle1' : level.id === 'desert-1' ? 'hint.desert1' : null;
    if (!key || this.save.hints.includes(level.id)) return;
    this.save.hints.push(level.id);
    this.persist();
    this.later(() => this.flashBanner(t(key), 3.5), 1700);
  }

  /* ───────────── input ───────────── */

  private bindInput(): void {
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => {
      audio.unlock();
      if (this.duel?.phase === 'replay') {
        this.duel.skipReplay();
        return;
      }
      const d = this.duel;
      if (!d || this.screen !== 'play' || this.paused || this.adPlaying || d.phase !== 'aim') return;
      c.setPointerCapture?.(e.pointerId);
      this.drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, angle0: d.aim.angle };
      this.updateDrag();
    });
    c.addEventListener('pointermove', (e) => {
      if (!this.drag || e.pointerId !== this.drag.id) return;
      this.drag.x = e.clientX;
      this.drag.y = e.clientY;
      this.updateDrag();
    });
    const end = (e: PointerEvent, cancel: boolean) => {
      const dr = this.drag;
      if (!dr || e.pointerId !== dr.id) return;
      this.drag = null;
      this.aimLine.classList.add('hidden');
      const d = this.duel;
      if (cancel || !d) return;
      const len = Math.hypot(dr.x - dr.x0, dr.y - dr.y0);
      if (len < 14) return;
      this.fire();
    };
    c.addEventListener('pointerup', (e) => end(e, false));
    c.addEventListener('pointercancel', (e) => end(e, true));
    document.addEventListener('pointerdown', () => audio.unlock(), { capture: true });
    window.addEventListener('keydown', (e) => this.onKey(e));
  }

  private updateDrag(): void {
    const dr = this.drag;
    const d = this.duel;
    if (!dr || !d) return;
    const dx = dr.x0 - dr.x;
    const dy = dr.y0 - dr.y;
    const len = Math.hypot(dx, dy);
    const full = Math.min(this.stage.width, this.stage.height) * 0.36;
    const power = clamp(len / full, 0, 1);
    if (len > 6) d.setAim(Math.atan2(dy, dx), power);
    const ln = this.aimLine;
    ln.classList.toggle('hidden', len < 6);
    ln.style.left = `${dr.x0}px`;
    ln.style.top = `${dr.y0}px`;
    ln.style.width = `${Math.min(len, full)}px`;
    const ang = Math.atan2(dr.y - dr.y0, dr.x - dr.x0);
    ln.style.transform = `rotate(${ang}rad)`;
    const pw = ln.querySelector('.power') as HTMLElement;
    pw.textContent = `${Math.round(d.aim.power * 100)}%`;
    pw.style.transform = `rotate(${-ang}rad)`;
    ln.style.setProperty('--p', String(d.aim.power));
  }

  private fire(): void {
    const d = this.duel;
    if (!d) return;
    if (d.fire()) {
      this.view.chars?.[0].setFace('aim', 0.4);
      this.updateHud(true);
    }
  }

  private onKey(e: KeyboardEvent): void {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const d = this.duel;
    if (e.code === 'KeyP' && this.screen === 'play') {
      e.preventDefault();
      if (this.paused) this.resume();
      else this.pause();
      return;
    }
    if (!d || this.screen !== 'play' || this.paused || this.adPlaying) return;
    if (d.phase === 'replay' && (e.code === 'Space' || e.code === 'Enter')) {
      e.preventDefault();
      d.skipReplay();
      return;
    }
    const digit = /^(?:Digit|Numpad)([1-5])$/.exec(e.code);
    if (digit) {
      e.preventDefault();
      const a = AMMO_ORDER[Number(digit[1]) - 1]!;
      if (d.level.ammo[a]) this.pickAmmo(a);
      return;
    }
    if (d.phase !== 'aim') return;
    const f = d.facing;
    let handled = true;
    switch (e.code) {
      case 'ArrowUp':
        d.setAim(d.aim.angle - f * 0.025, d.aim.power);
        break;
      case 'ArrowDown':
        d.setAim(d.aim.angle + f * 0.025, d.aim.power);
        break;
      case 'ArrowRight':
        d.setAim(d.aim.angle, d.aim.power + 0.02);
        break;
      case 'ArrowLeft':
        d.setAim(d.aim.angle, d.aim.power - 0.02);
        break;
      case 'Space':
        audio.unlock();
        this.fire();
        break;
      default:
        handled = false;
    }
    if (handled) {
      e.preventDefault();
      this.keyAiming = 2.5;
    }
  }

  /* ───────────── pause & settings ───────────── */

  pause(): void {
    if (this.screen !== 'play' || this.paused) return;
    this.paused = true;
    this.drag = null;
    this.aimLine.classList.add('hidden');
    if (this.duel) this.duel.paused = true;
    this.tracker.stop();
    this.ui('ui_open');
    clear(this.layer);
    this.layer.append(
      h(
        'div.screen.dim',
        {},
        h(
          'div.card.pausecard',
          {},
          h('h2', {}, t('pause.title')),
          this.btn(t('pause.resume'), () => this.resume(), 'primary big', { id: 'resume' }, ICONS.play),
          this.btn(t('pause.settings'), () => this.settings(() => this.reopenPause()), '', { id: 'pause-settings' }, ICONS.gear),
          this.btn(t('pause.menu'), () => this.title(), '', { id: 'pause-menu' }, ICONS.home),
        ),
      ),
    );
  }

  private reopenPause(): void {
    this.paused = false;
    this.pause();
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    if (this.duel) this.duel.paused = false;
    clear(this.layer);
    this.last = performance.now();
    this.ui('ui_close');
    if (this.duel && this.duel.phase !== 'over') this.tracker.start();
  }

  settings(back: () => void): void {
    this.ui('ui_open');
    clear(this.layer);
    const toggle = (label: string, id: string, on: boolean, set: (v: boolean) => void) => {
      const b = h<'button'>(`button.toggle#${id}${on ? '.on' : ''}`, { 'aria-pressed': String(on) }, h('span', {}, label), h('b', {}, on ? t('settings.on') : t('settings.off')));
      b.addEventListener('click', () => {
        const v = !b.classList.contains('on');
        set(v);
        this.persist();
        this.applyAudio();
        this.ui('ui_toggle');
        this.settings(back);
      });
      return b;
    };
    const langs = h('div.langs');
    for (const l of LANGS) {
      langs.append(
        h(`button.lang${getLang() === l.code ? '.on' : ''}`, {
          'data-lang': l.code,
          onclick: () => {
            this.save.lang = l.code;
            setLang(l.code);
            this.persist();
            this.ui('ui_select');
            this.settings(back);
            if (this.screen === 'play') this.buildHud();
          },
        }, l.name),
      );
    }
    const card = h(
      'div.card.settings',
      {},
      h('h2', {}, t('settings.title')),
      toggle(t('settings.music'), 'music', this.save.music, (v) => (this.save.music = v)),
      toggle(t('settings.sfx'), 'sfx', this.save.sfx, (v) => (this.save.sfx = v)),
      h('div.label', {}, t('settings.language')),
      langs,
      this.btn(t('settings.reset'), () => this.confirmReset(back), 'danger small', { id: 'reset' }, ICONS.trash),
      this.btn(t('common.back'), back, 'primary', { id: 'settings-back' }, ICONS.back),
    );
    this.layer.append(h('div.screen.dim', {}, card));
  }

  private confirmReset(back: () => void): void {
    clear(this.layer);
    const card = h(
      'div.card.confirm',
      {},
      h('p', {}, t('settings.resetConfirm')),
      h(
        'div.row',
        {},
        this.btn(t('settings.yes'), () => {
          const keep = { music: this.save.music, sfx: this.save.sfx, lang: this.save.lang };
          this.save = { ...freshSave(), ...keep };
          this.persist();
          this.ui('ui_confirm');
          this.settings(back);
        }, 'danger', { id: 'reset-yes' }),
        this.btn(t('settings.no'), () => this.settings(back), 'primary', { id: 'reset-no' }),
      ),
    );
    this.layer.append(h('div.screen.dim', {}, card));
  }

  /* ───────────── ads (wrappers kept from the platform layer) ───────────── */

  /** Natural break between levels: a midgame ad (at most one every 2 minutes) before continuing. */
  private async breakThen(next: () => void): Promise<void> {
    if (this.adBreak) return;
    this.ui('ui_click');
    this.tracker.stop();
    if (this.throttle.canShow()) {
      this.throttle.markShown();
      this.adBreak = true;
      try {
        await this.platform.midgame();
      } catch {
        /* the game always continues */
      } finally {
        this.adBreak = false;
      }
    }
    next();
  }

  /** Leaving the title for a game: the platform's pre-roll, if any (GameDistribution). */
  private async prerollThen(next: () => void): Promise<void> {
    if (this.adBreak) return;
    this.ui('ui_click');
    audio.unlock();
    this.adBreak = true;
    try {
      await this.platform.preroll();
    } catch {
      /* the game always continues */
    } finally {
      this.adBreak = false;
    }
    next();
  }

  /**
   * A rewarded-ad button (TV icon): disabled while the ad is requested; the reward is only given
   * when the ad really completed; otherwise it says "No ad available right now, try later" for 2.5 s.
   */
  adButton(label: string, onReward: () => void, attrs: Record<string, string>): HTMLButtonElement {
    const b = this.btn(label, () => {
      if (b.disabled) return;
      b.disabled = true;
      b.classList.add('waiting');
      this.tracker.stop();
      void this.platform
        .rewarded()
        .catch(() => false)
        .then((ok) => {
          b.classList.remove('waiting');
          if (this.isPlaying()) this.tracker.start();
          if (ok) return onReward();
          const lbl = b.querySelector('.t') as HTMLElement;
          lbl.textContent = t('ad.none');
          b.classList.add('failed');
          window.setTimeout(() => {
            lbl.textContent = label;
            b.classList.remove('failed');
            b.disabled = false;
          }, AD_FAIL_MS);
        });
    }, 'ad', attrs, ICONS.tv);
    return b;
  }

  /* ───────────── helpers ───────────── */

  private btn(label: string, onClick: () => void, cls = '', attrs: Record<string, string> = {}, icon?: string, badge?: string): HTMLButtonElement {
    const b = h<'button'>(`button.btn${cls ? '.' + cls.split(' ').join('.') : ''}`, attrs, icon ? h('span.ic', { html: icon }) : null, h('span.t', {}, label), badge ? h('span.badge', {}, badge) : null);
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      audio.unlock();
      if (!cls.includes('soon')) this.ui('ui_click');
      onClick();
    });
    return b;
  }

  /* ───────────── automation (tests, screenshots, preview video) ───────────── */

  /** Aims at a named rope or body using the real ballistic solve; returns false if no aim works. */
  aimAtTarget(name: string, ammo: AmmoId = 'arrow', pick: 'flat' | 'high' = 'flat'): boolean {
    const d = this.duel;
    if (!d || d.phase !== 'aim') return false;
    let target: { x: number; y: number } | null = null;
    const rope = d.sim.rope(name);
    if (rope) {
      const [a, b] = d.sim.ropeEnds(rope);
      target = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    } else {
      const e = d.sim.entByName(name);
      if (e) target = { x: e.body.getPosition().x, y: e.body.getPosition().y };
    }
    if (!target) return false;
    const aims = aimsAt(d.sim, 0, target);
    const aim = pick === 'flat' ? aims.filter((a) => a.angle > -0.9).sort((a, b) => b.power - a.power)[0] : aims.find((a) => a.angle < -0.9);
    if (!aim) return false;
    d.selectAmmo(ammo);
    d.setAim(aim.angle, aim.power);
    this.keyAiming = 3;
    return true;
  }

  autoFire(): boolean {
    const ok = this.duel?.fire() ?? false;
    if (ok) this.updateHud(true);
    return ok;
  }
}
