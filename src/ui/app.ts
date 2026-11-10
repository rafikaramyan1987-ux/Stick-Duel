import { World } from 'planck';
import { audio } from '../audio/sfx';
import { coinsFor, starsFor } from '../core/damage';
import { clamp, len } from '../core/math';
import { Rng } from '../core/rng';
import { launch, pullToAim, SIM_DT, speedFor, step } from '../core/trajectory';
import { PLAYER_WEAPONS, WEAPONS, type WeaponId } from '../core/weapons';
import { Duel, Fighter, type DuelEvent, type FighterSetup, type Mode, type Side } from '../game/duel';
import { endlessLevel, generateLevel, type LevelDef } from '../game/levels';
import {
  buy,
  COLOR_PRICE,
  COLORS,
  equip,
  furthestWorld,
  HAT_PRICE,
  HATS,
  itemLocked,
  levelUnlocked,
  owns,
  priceOf,
  recordLevel,
  starsOf,
  worldStars,
  worldUnlocked,
  type ColorId,
  type HatId,
  type SaveData,
  type ShopItem,
  type TipId,
} from '../game/progress';
import { Ragdoll } from '../game/ragdoll';
import { writeSave } from '../game/save';
import { addProgress, chestReady, claimChest, claimMission, dailyHasReady, missionReady, refreshDaily } from '../game/daily';
import { LEVELS_PER_WORLD, WORLDS, worldByIndex } from '../game/worlds';
import { getLang, setLang, t, detectLang, type Key } from '../i18n';
import { GameplayTracker, MidgameThrottle, type Platform } from '../platform/ads';
import { drawFighter } from '../render/fighter';
import { weaponIcon } from '../render/items';
import { SceneRenderer, type View } from '../render/scene';
import { clear, h } from './dom';

interface Session {
  mode: Mode;
  world: number;
  level: number;
  L: LevelDef;
  tryWeapon: WeaponId | null;
  revived: boolean;
  wave: number;
  endlessHp: number;
  attract: boolean;
}

const MAX_DPR = 2;
/** How long a rewarded button shows "no ad available" before it can be tried again. */
export const AD_FAIL_MS = 2500;

export class App {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private layer: HTMLElement;
  private hud: HTMLElement;
  private banner: HTMLElement;
  private view: View = { w: 1, h: 1, dpr: 1, padTop: 0, padBottom: 0 };
  private duel: Duel | null = null;
  private scene: SceneRenderer | null = null;
  private session: Session | null = null;
  private tracker: GameplayTracker;
  private throttle = new MidgameThrottle();
  /** An interstitial (pre-roll / midgame) is being requested from a button. */
  private adBreak = false;
  private paused = false;
  private adPlaying = false;
  private last = performance.now();
  private drag: { id: number; x0: number; y0: number; x: number; y: number } | null = null;
  private icons = new Map<string, string>();
  private overTimer = 0;
  private hudRefs: Record<string, HTMLElement> = {};
  private mapWorld = 1;
  private versusWorld = 1;
  /** Shown result screen awaiting input. */
  private resultShown = false;
  /** Simulation speed multiplier (automation only). */
  speed = 1;
  /** Stops the simulation but keeps rendering (cover renders). */
  freeze = false;
  /** First-time tutorial running (level 1-1). */
  private tutorialActive = false;
  private tutEl: HTMLElement | null = null;
  private tipQueue: string[] = [];
  private tipShown: HTMLElement | null = null;

  constructor(
    private readonly root: HTMLElement,
    public save: SaveData,
    private readonly platform: Platform,
  ) {
    this.tracker = new GameplayTracker(platform);
    clear(root);
    this.canvas = h<'canvas'>('canvas#game');
    this.ctx = this.canvas.getContext('2d', { alpha: false }) as CanvasRenderingContext2D;
    this.hud = h('div.hud.hidden');
    this.layer = h('div.layer');
    this.banner = h('div.banner');
    root.append(this.canvas, this.hud, this.banner, this.layer);
    this.applySettings();
    this.mapWorld = clamp(save.lastWorld, 1, furthestWorld(save));
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.bindInput();
    this.buildIcons();
    platform.onPlatformMuteChange(() => this.applyAudio());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.isPlaying()) this.pause();
    });
    requestAnimationFrame((t0) => this.frame(t0));
    // debug / automation hooks (used by the Playwright smoke test and recordings)
    (window as unknown as { __stickDuel: unknown }).__stickDuel = this;
  }

  // ───────────── setup ─────────────

  private applySettings(): void {
    const l = this.save.settings.lang;
    setLang(l === 'auto' ? detectLang(this.platform.locale(), navigator.language) : l);
    this.applyAudio();
  }

  private applyAudio(): void {
    audio.setSfxEnabled(this.save.settings.sound);
    audio.setMusicEnabled(this.save.settings.music);
    audio.setMuted(this.adPlaying || this.platform.platformMuted());
  }

  /** Called by the platform: true while an ad plays (audio muted, game paused), false after. */
  onAdPause(paused: boolean): void {
    this.adPlaying = paused;
    if (import.meta.env.VITE_PLATFORM === 'gamepix' && paused) {
      // GamePix pause (ad, player menu, hidden tab): drop the aim in progress, input stays blocked
      this.drag = null;
      this.duel?.cancelAim();
    }
    this.applyAudio();
    if (!paused) this.last = performance.now();
  }

  private persist(): void {
    writeSave(this.save);
  }

  private buildIcons(): void {
    const dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
    for (const w of Object.values(WEAPONS)) this.icons.set(w.id, weaponIcon(w.look, 56, dpr).toDataURL());
  }

  private resize(): void {
    const dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(window.innerWidth * dpr));
    const hgt = Math.max(1, Math.round(window.innerHeight * dpr));
    this.canvas.width = w;
    this.canvas.height = hgt;
    const portrait = hgt > w;
    this.view = { w, h: hgt, dpr, padTop: (portrait ? 92 : 64) * dpr, padBottom: (portrait ? 96 : 70) * dpr };
    this.root.classList.toggle('is-portrait', portrait);
  }

  private isPlaying(): boolean {
    return !!this.session && !this.session.attract && !!this.duel && this.duel.phase !== 'over' && this.duel.phase !== 'intro' && !this.paused;
  }

  // ───────────── main loop ─────────────

  private frame(now: number): void {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    if (this.duel && this.scene && !this.paused && !this.adPlaying && !this.freeze) {
      for (let i = 0; i < this.speed; i++) {
        // kill cam / headshot slow motion
        const slow = this.duel.timeScale;
        this.duel.update(dt * slow);
        this.scene.update(dt * slow, this.view, dt);
      }
      if (this.session?.attract) this.attractTick();
      else this.duelTick(dt);
    }
    if (this.scene) {
      this.scene.draw(this.ctx, this.view);
      this.drawDrag();
    }
    requestAnimationFrame((t0) => this.frame(t0));
  }

  private drawDrag(): void {
    const d = this.drag;
    if (!d || !this.duel?.humanAiming) return;
    const c = this.ctx;
    const k = this.view.dpr;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.lineCap = 'round';
    c.strokeStyle = 'rgba(255,255,255,0.75)';
    c.lineWidth = 4 * k;
    c.setLineDash([2 * k, 10 * k]);
    c.beginPath();
    c.moveTo(d.x0 * k, d.y0 * k);
    c.lineTo(d.x * k, d.y * k);
    c.stroke();
    c.setLineDash([]);
    c.fillStyle = 'rgba(255,255,255,0.35)';
    c.strokeStyle = 'rgba(255,255,255,0.9)';
    c.lineWidth = 3 * k;
    c.beginPath();
    c.arc(d.x0 * k, d.y0 * k, 14 * k, 0, Math.PI * 2);
    c.fill();
    c.stroke();
    c.beginPath();
    c.arc(d.x * k, d.y * k, 9 * k, 0, Math.PI * 2);
    c.fillStyle = '#ffd23d';
    c.fill();
    c.stroke();
  }

  // ───────────── input ─────────────

  private maxPull(): number {
    return clamp(Math.min(window.innerWidth, window.innerHeight) * 0.32, 110, 260);
  }

  private bindInput(): void {
    const cv = this.canvas;
    cv.addEventListener('pointerdown', (e) => {
      if (import.meta.env.VITE_PLATFORM === 'gamepix' && this.adPlaying) return;
      audio.unlock();
      // tap to skip the kill cam
      if (this.duel?.killCam && !this.session?.attract) {
        this.duel.skipKillCam();
        return;
      }
      if (!this.duel?.humanAiming || this.paused || this.drag) return;
      cv.setPointerCapture(e.pointerId);
      this.drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY };
    });
    cv.addEventListener('pointermove', (e) => {
      const d = this.drag;
      if (!d || d.id !== e.pointerId || !this.duel) return;
      d.x = e.clientX;
      d.y = e.clientY;
      const dx = d.x - d.x0;
      const dy = d.y - d.y0;
      if (len(dx, dy) < 10) {
        this.duel.cancelAim();
        return;
      }
      const a = pullToAim(dx, dy, this.maxPull(), this.duel.current.def);
      this.duel.setAim(a.angle, a.power);
    });
    const end = (e: PointerEvent) => {
      const d = this.drag;
      if (!d || d.id !== e.pointerId) return;
      this.drag = null;
      if (!this.duel) return;
      if (len(d.x - d.x0, d.y - d.y0) < 14 || !this.duel.fire()) this.duel.cancelAim();
    };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', (e) => {
      if (this.drag?.id === e.pointerId) {
        this.drag = null;
        this.duel?.cancelAim();
      }
    });
    window.addEventListener('keydown', (e) => {
      if (import.meta.env.VITE_PLATFORM === 'gamepix' && this.adPlaying) return;
      audio.unlock();
      const duel = this.duel;
      // Playgama 1.5.2: Esc is left to the browser (exit full screen); P pauses
      if ((e.key === 'Escape' && import.meta.env.VITE_PLATFORM !== 'playgama') || e.key === 'p' || e.key === 'P') {
        if (this.isPlaying()) this.pause();
        else if (this.paused) this.resume();
        return;
      }
      if (!duel?.humanAiming || this.paused) return;
      const f = duel.current;
      const aim = f.aim ?? { angle: f.restAngle(), power: 0.55 };
      const up = f.facing === 1 ? -1 : 1;
      let handled = true;
      if (e.key === 'ArrowUp') duel.setAim(aim.angle + up * 0.03, aim.power);
      else if (e.key === 'ArrowDown') duel.setAim(aim.angle - up * 0.03, aim.power);
      else if (e.key === 'ArrowRight') duel.setAim(aim.angle, aim.power + 0.02 * f.facing);
      else if (e.key === 'ArrowLeft') duel.setAim(aim.angle, aim.power - 0.02 * f.facing);
      else if (e.key === ' ' || e.key === 'Enter') {
        if (!f.aim) duel.setAim(aim.angle, aim.power);
        else duel.fire();
      } else if (/^[1-6]$/.test(e.key)) {
        const id = f.setup.weapons[Number(e.key) - 1];
        if (id && duel.selectWeapon(id)) this.refreshWeapons();
      } else handled = false;
      if (handled) e.preventDefault();
    });
  }

  // ───────────── screens ─────────────

  private show(...nodes: HTMLElement[]): void {
    clear(this.layer);
    this.layer.append(...nodes);
  }

  private btn(label: string, onclick: () => void, cls = '', attrs: Record<string, string> = {}): HTMLButtonElement {
    return h<'button'>(`button.btn${cls ? '.' + cls.split(' ').join('.') : ''}`, {
      ...attrs,
      onclick: () => {
        audio.unlock();
        audio.play('click');
        onclick();
      },
    }, label);
  }

  private coinsBadge(): HTMLElement {
    return h('div.coins', {}, h('span.coin'), String(this.save.coins));
  }

  /** Two AIs duel quietly behind the menus. */
  private attract(world: number): void {
    const level = 4 + Math.floor(Math.random() * 4);
    const L = generateLevel(world, level, { seed: Math.floor(Math.random() * 1e9), forceBoss: false });
    const setupL: FighterSetup = { look: 'hero', hat: this.save.equipped.hat, color: this.save.equipped.color, weapons: ['bow'], weapon: 'bow', hp: 9999, ai: true };
    const setupR: FighterSetup = { look: L.world.enemy, hat: 'none', color: 'red', weapons: L.world.enemyWeapons, weapon: L.world.enemyWeapons[0] ?? 'bow', hp: 9999, ai: true };
    this.session = { mode: 'adventure', world, level, L, tryWeapon: null, revived: false, wave: 0, endlessHp: 100, attract: true };
    this.setDuel(new Duel(L, { mode: 'adventure', left: setupL, right: setupR }));
    this.duel?.start();
    this.hud.classList.add('hidden');
  }

  private attractTick(): void {
    if (this.duel && this.duel.turnNumber > 14) this.attract(this.session?.world ?? 1);
  }

  private setDuel(d: Duel): void {
    this.duel?.destroy();
    this.duel = d;
    if (this.scene) this.scene.setDuel(d);
    else this.scene = new SceneRenderer(d);
    this.scene.cam.update(d, this.view, 0, true);
    d.on((e) => this.onEvent(e));
  }

  private dailyButton(): HTMLElement {
    if (refreshDaily(this.save, new Date())) this.persist();
    const b = this.btn(t('menu.daily'), () => this.daily(), 'daily', { id: 'daily' });
    if (dailyHasReady(this.save)) b.append(h('span.dot', { 'aria-label': '!' }));
    return b;
  }

  /** Daily chest + 3 daily missions. */
  daily(): void {
    if (refreshDaily(this.save, new Date())) this.persist();
    const d = this.save.daily;
    const ready = chestReady(this.save);
    const chest = h(`div.chest${ready ? '.ready' : '.open'}`, { html: CHEST_SVG });
    const chestBtn = ready
      ? this.btn(t('daily.open'), () => {
          const got = claimChest(this.save, new Rng(Date.now()));
          if (!got) return;
          this.persist();
          audio.play('coin');
          window.setTimeout(() => audio.play('star', { index: 2 }), 200);
          this.flash(got.hat ? t('daily.hat', { h: t(`hat.${got.hat}` as Key) }) : t('daily.got', { n: got.coins }), 'info', 1800);
          this.daily();
        }, 'primary', { id: 'open-chest' })
      : h('div.sub', {}, t('daily.opened'));
    const missions = h('div.missions', {}, ...d.missions.map((m, i) => {
      const pct = Math.round((m.progress / m.goal) * 100);
      const action = m.claimed
        ? h('span.tag.eq', {}, t('daily.claimed'))
        : missionReady(m)
          ? this.btn(`${t('daily.claim')} +${m.reward}`, () => {
              if (claimMission(this.save, i) > 0) {
                this.persist();
                audio.play('coin');
                this.daily();
              }
            }, 'small buy', { 'data-mission': m.kind })
          : h('span.tag', {}, `${m.progress}/${m.goal}`);
      return h(`div.mission${m.claimed ? '.done' : ''}`, {},
        h('div.mtext', {}, h('b', {}, t(`mission.${m.kind}` as Key, { n: m.goal })), h('div.mbar', {}, h('i', { style: `width:${pct}%` }))),
        action,
      );
    }));
    this.show(
      h('div.screen.setup', {},
        h('div.topbar', {}, this.btn('‹ ' + t('common.back'), () => this.title(), 'small'), this.coinsBadge()),
        h('div.card.dailycard', {},
          h('h2', {}, t('daily.title')),
          h('div.chestrow', {}, chest, h('div', {}, h('b', {}, t('daily.chest')), d.streak > 0 ? h('div.sub', {}, t('daily.streak', { n: d.streak })) : null, chestBtn)),
          h('div.label', {}, t('daily.missions')),
          missions,
        ),
      ),
    );
  }

  title(): void {
    this.paused = false;
    this.resultShown = false;
    this.tracker.stop();
    audio.music('menu');
    if (!this.session?.attract || !this.duel) this.attract(this.mapWorld);
    const logo = h('div.logo', {}, h('span.l1', {}, 'Stick'), h('span.l2', {}, 'Duel'));
    this.show(
      h('div.screen.title', {},
        h('div.topbar', {}, h('span'), this.coinsBadge()),
        logo,
        h('p.tagline', {}, t('title.tagline')),
        h('div.menu', {},
          this.btn(t('menu.play'), () => this.prerollThen(() => this.map()), 'primary big', { id: 'play' }),
          h('div.row', {},
            this.btn(t('menu.versus'), () => this.prerollThen(() => this.versusSetup()), '', { id: 'versus' }),
            this.btn(t('menu.endless'), () => this.prerollThen(() => this.endlessSetup()), '', { id: 'endless' }),
          ),
          h('div.row', {},
            this.btn(t('menu.shop'), () => this.shop('weapon'), '', { id: 'shop' }),
            this.dailyButton(),
            this.btn(t('menu.settings'), () => this.settings(() => this.title()), '', { id: 'settings' }),
          ),
        ),
      ),
    );
  }

  map(world = this.mapWorld): void {
    this.mapWorld = world;
    this.save.lastWorld = world;
    this.persist();
    audio.music('menu');
    if (!this.session?.attract || this.session.world !== world) this.attract(world);
    const W = worldByIndex(world);
    const unlocked = worldUnlocked(this.save, world);
    const path = h('div.path', {});
    for (let l = 1; l <= LEVELS_PER_WORLD; l++) {
      const open = levelUnlocked(this.save, world, l);
      const stars = starsOf(this.save, world, l);
      const node = h<'button'>(`button.node${l === LEVELS_PER_WORLD ? '.boss' : ''}${open ? '' : '.locked'}${stars ? '.done' : ''}`, {
        'data-level': l,
        'aria-label': t('intro.level', { n: l }),
        disabled: !open,
        onclick: () => {
          audio.play('click');
          this.intro(world, l);
        },
      },
        h('span.num', {}, l === LEVELS_PER_WORLD ? '★' : String(l)),
        h('span.stars', {}, ...[1, 2, 3].map((i) => h(`i${i <= stars ? '.on' : ''}`))),
      );
      path.append(node);
    }
    const tabs = h('div.tabs', {}, ...WORLDS.map((w) =>
      h<'button'>(`button.tab${w.index === world ? '.on' : ''}${worldUnlocked(this.save, w.index) ? '' : '.locked'}`, {
        'data-world': w.index,
        onclick: () => {
          audio.play('click');
          this.map(w.index);
        },
      }, String(w.index)),
    ));
    this.show(
      h('div.screen.map', {},
        h('div.topbar', {}, this.btn('‹ ' + t('common.back'), () => this.title(), 'small'), this.coinsBadge()),
        h('div.card.mapcard', {},
          h('div.maphead', {},
            this.btn('‹', () => this.map(Math.max(1, world - 1)), 'round', { 'aria-label': 'previous world' }),
            h('div', {}, h('h2', {}, t(`world.${W.id}` as Key)), h('div.sub', {}, `★ ${t('map.stars', { n: worldStars(this.save, world) })}`)),
            this.btn('›', () => this.map(Math.min(WORLDS.length, world + 1)), 'round', { 'aria-label': 'next world' }),
          ),
          tabs,
          unlocked ? path : h('div.lockmsg', {}, h('div.lockicon'), t('map.unlock', { boss: t(`boss.${worldByIndex(world - 1).boss.id}.name` as Key) })),
        ),
      ),
    );
    if (unlocked) requestAnimationFrame(() => drawPath(path));
  }

  private enemyName(L: LevelDef): string {
    return L.boss ? t(`boss.${L.world.boss.id}.name` as Key) : t(`enemy.${L.world.enemy}` as Key);
  }

  intro(world: number, level: number, mode: Mode = 'adventure'): void {
    const L = generateLevel(world, level);
    this.session = { mode, world, level, L, tryWeapon: null, revived: false, wave: 0, endlessHp: 100, attract: false };
    this.prepareDuel();
    this.showIntro();
  }

  private prepareDuel(): void {
    const s = this.session;
    if (!s) return;
    // Playgama: a level left from the pause menu (map / retry) ends there; after a result screen this does nothing
    if (import.meta.env.VITE_PLATFORM === 'playgama') this.platform.levelEnd?.(false);
    const L = s.L;
    const weapons = [...this.save.weapons];
    if (s.tryWeapon && !weapons.includes(s.tryWeapon)) weapons.push(s.tryWeapon);
    const weapon = s.tryWeapon ?? (weapons.includes(this.save.equipped.weapon) ? this.save.equipped.weapon : 'bow');
    const left: FighterSetup = { look: 'hero', hat: this.save.equipped.hat, color: this.save.equipped.color, weapons, weapon, hp: s.mode === 'endless' ? s.endlessHp : L.playerHp, maxHp: L.playerHp, ai: false };
    let right: FighterSetup;
    if (s.mode === 'versus') {
      right = { look: 'hero2', hat: 'cap', color: this.save.equipped.color === 'red' ? 'green' : 'red', weapons, weapon: 'bow', hp: 100, ai: false };
    } else {
      right = { look: L.enemy.kind, hat: 'none', color: 'red', weapons: L.enemy.weapons, weapon: L.enemy.weapons[0] ?? 'bow', hp: L.enemy.hp, ai: true, scale: L.enemy.scale, boss: L.enemy.boss };
    }
    this.setDuel(new Duel(L, { mode: s.mode, left, right }));
    audio.music(L.world.id);
    this.hud.classList.add('hidden');
  }

  private showIntro(): void {
    const s = this.session;
    const duel = this.duel;
    if (!s || !duel) return;
    const L = s.L;
    const W = L.world;
    const wind = Math.abs(L.wind.base) < 0.05 && L.wind.gust < 0.05 ? t('intro.calm') : `${windLabel(L.wind.base)}${L.wind.gust > 0.5 ? ' ~' : ''}`;
    const weaponRow = h('div.weaponpick', {});
    const left = duel.fighters[0];
    const rebuild = () => {
      clear(weaponRow);
      for (const id of left.setup.weapons) {
        weaponRow.append(h<'button'>(`button.wbtn${left.weapon === id ? '.on' : ''}`, {
          'data-weapon': id,
          title: t(`weapon.${id}` as Key),
          onclick: () => {
            audio.play('click');
            left.weapon = id;
            this.save.equipped.weapon = this.save.weapons.includes(id) ? id : this.save.equipped.weapon;
            this.persist();
            rebuild();
          },
        }, h('img', { src: this.icons.get(id) ?? '', alt: '' })));
      }
    };
    rebuild();
    // offer to try one locked weapon with a rewarded ad
    const locked = PLAYER_WEAPONS.find((id) => !this.save.weapons.includes(id) && id !== s.tryWeapon);
    let tryBtn: HTMLElement | null = null;
    if (s.mode === 'adventure' && locked && !s.tryWeapon && this.platform.adsUnavailable() === null) {
      tryBtn = this.adButton(`▶ ${t('intro.try', { w: t(`weapon.${locked}` as Key) })}`, () => {
        s.tryWeapon = locked;
        this.prepareDuel();
        this.showIntro();
      }, 'ad small', { id: 'try-weapon' });
    }
    const bossIntro = L.boss ? h('p.bossline', {}, `“${t(`boss.${W.boss.id}.intro` as Key)}”`) : null;
    const header = s.mode === 'endless' ? t('hud.wave', { n: s.wave + 1 }) : s.mode === 'versus' ? t('versus.title') : L.boss ? t('intro.boss') : t('intro.level', { n: L.level });
    const card = h(`div.card.intro${L.boss ? '.isboss' : ''}`, {},
      h('div.introhead', {}, h('span.worldname', {}, t(`world.${W.id}` as Key)), h('h2', {}, header)),
      h('div.vs', {},
        h('div.side', {}, h('img.portrait', { src: this.portrait(left), alt: '' }), h('b', {}, s.mode === 'versus' ? t('hud.p1') : t('hud.you'))),
        h('span.vstext', {}, t('intro.vs')),
        h('div.side', {}, h('img.portrait', { src: this.portrait(duel.fighters[1]), alt: '' }), h('b', {}, s.mode === 'versus' ? t('hud.p2') : this.enemyName(L))),
      ),
      bossIntro,
      h('div.info', {}, h('span', {}, `${t('intro.wind')}: ${wind}`), s.mode === 'versus' ? null : h('span', {}, `❤ ${duel.fighters[1].hp}`)),
      h('div.label', {}, t('intro.weapon')),
      weaponRow,
      tryBtn,
      !this.save.tutorial && s.mode === 'adventure' ? h('p.tip', {}, t('intro.tutorial')) : null,
      h('div.row', {},
        this.btn('‹', () => (s.mode === 'adventure' ? this.map(s.world) : this.title()), 'round', { 'aria-label': t('common.back') }),
        this.btn(t('intro.fight'), () => this.fight(), 'primary big', { id: 'fight' }),
      ),
    );
    if (L.boss) audio.play('boss');
    this.show(h('div.screen.introscreen', {}, card));
  }

  private portrait(f: Fighter): string {
    return fighterPortrait(f.setup, 96);
  }

  fight(): void {
    const duel = this.duel;
    if (!duel || !this.session) return;
    this.show();
    this.resultShown = false;
    this.buildHud();
    this.hud.classList.remove('hidden');
    const s = this.session;
    this.tutorialActive = s.mode === 'adventure' && s.world === 1 && s.level === 1 && !this.save.tutorial;
    duel.start();
    this.tracker.start();
    if (!this.save.tutorial && !this.tutorialActive) this.flash(t('hud.dragHint'), 'hint', 2600);
    if (s.L.boss && s.mode === 'adventure') this.scene?.say(1, t(`taunt.${s.L.world.boss.id}` as Key), 2.6);
    if (duel.bonuses.length && !this.tutorialActive) this.tip('bonus', t('tip.bonus'), 1600);
  }

  /** A random line from a "a|b|c" translation. */
  private line(key: Key): string {
    const opts = t(key).split('|');
    return opts[Math.floor(Math.random() * opts.length)] ?? '';
  }

  /** Power-up badge icons (fire / triple / shield), drawn once. */
  private powerIcon(kind: string): string {
    const key = `power-${kind}`;
    const hit = this.icons.get(key);
    if (hit) return hit;
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const ctx = c.getContext('2d') as CanvasRenderingContext2D;
    ctx.translate(32, 32);
    ctx.scale(110, 110);
    this.scene?.drawRewardIcon(ctx, kind, 0, 0, 0.2, 0.03);
    const url = c.toDataURL();
    this.icons.set(key, url);
    return url;
  }

  // ───────────── tutorial & tips ─────────────

  /** Level 1-1, first time: an animated hand shows the drag, a glowing path shows a good shot. */
  private showTutorial(): void {
    const duel = this.duel;
    const scene = this.scene;
    if (!duel || !scene || !duel.humanAiming) return;
    const shot = duel.autoShot(false);
    if (!shot) return;
    const me = duel.current;
    const foe = duel.other(me.side);
    // the ghost path: the real flight of that shot, up to the enemy
    const f = launch(me.launchPoint(shot.angle), shot.angle, speedFor(shot.power, me.def));
    const pts: Array<{ x: number; y: number }> = [];
    const fx = foe.center().x;
    for (let i = 0; i < 240 * 4 && (f.x - fx) * me.facing < 0; i++) {
      step(f, me.def, { wind: duel.wind }, SIM_DT);
      if (i % 12 === 0) pts.push({ x: f.x, y: f.y });
    }
    scene.ghost = pts;
    scene.fullPreview = true;
    // the hand: presses beside the hero and pulls back along the right drag
    const dpr = this.view.dpr;
    const sh = me.rag.shoulder();
    const [sx, sy] = scene.toScreen(sh.x, sh.y, this.view);
    const pull = shot.power * this.maxPull();
    const x0 = clamp(sx / dpr + 110, 40, window.innerWidth - 60);
    const y0 = clamp(sy / dpr - 10, 120, window.innerHeight - 160);
    const dx = -Math.cos(shot.angle) * pull;
    const dy = -Math.sin(shot.angle) * pull;
    this.tutEl?.remove();
    this.tutEl = h('div.tutorial', {},
      h('div.tutbubble', {}, h('b', {}, t('tut.drag')), h('span', {}, t('tut.follow'))),
      h('div.hand', { style: `left:${x0}px;top:${y0}px;--dx:${dx.toFixed(0)}px;--dy:${dy.toFixed(0)}px`, html: HAND_SVG }),
      h('div.handtrail', { style: `left:${x0}px;top:${y0}px;--dx:${dx.toFixed(0)}px;--dy:${dy.toFixed(0)}px` }),
      h<'button'>('button.btn.small.skip#skip-tutorial', { onclick: () => this.endTutorial() }, t('tut.skip')),
    );
    this.hud.append(this.tutEl);
  }

  private endTutorial(): void {
    this.tutorialActive = false;
    this.tutEl?.remove();
    this.tutEl = null;
    if (this.scene) {
      this.scene.ghost = null;
      this.scene.fullPreview = false;
    }
    if (!this.save.tutorial) {
      this.save.tutorial = true;
      this.persist();
    }
  }

  /** A short tip, shown only the first time (saved). One at a time: later tips wait their turn. */
  private tip(id: TipId, text: string, delay = 0): void {
    if (this.save.tips.includes(id) || this.session?.attract) return;
    this.save.tips.push(id);
    this.persist();
    window.setTimeout(() => {
      this.tipQueue.push(text);
      this.nextTip();
    }, delay);
  }

  private nextTip(): void {
    if (this.tipShown) return;
    const text = this.tipQueue.shift();
    if (!text) return;
    const el = h('div.tipbubble', { role: 'status' }, text);
    let done = false;
    const close = () => {
      if (done) return;
      done = true;
      el.remove();
      this.tipShown = null;
      window.setTimeout(() => this.nextTip(), 250);
    };
    el.addEventListener('click', close);
    this.tipShown = el;
    this.hud.append(el);
    this.placeTip(el);
    window.setTimeout(close, 4800);
  }

  /** Puts a tip where it covers no fighter, floating bonus or HUD element (tries a few spots). */
  private placeTip(el: HTMLElement): void {
    const avoid = this.screenObstacles();
    const hudBottom = this.hud.querySelector('.hudtop')?.getBoundingClientRect().bottom ?? 90;
    el.style.setProperty('--hud-h', `${Math.round(hudBottom + 8)}px`);
    const spots = ['pos-bottom', 'pos-top', 'pos-corner'];
    let best = spots[0] as string;
    let bestArea = Infinity;
    for (const spot of spots) {
      el.classList.remove(...spots);
      el.classList.add(spot);
      const r = el.getBoundingClientRect();
      let area = 0;
      for (const o of avoid) {
        const w = Math.min(r.right, o.x1) - Math.max(r.left, o.x0);
        const hh = Math.min(r.bottom, o.y1) - Math.max(r.top, o.y0);
        if (w > 0 && hh > 0) area += w * hh;
      }
      if (r.left < 0 || r.top < 0 || r.right > window.innerWidth || r.bottom > window.innerHeight) area += 1e9;
      if (area < bestArea) {
        best = spot;
        bestArea = area;
      }
      if (area === 0) break;
    }
    el.classList.remove(...spots);
    el.classList.add(best);
  }

  /** Screen rectangles (CSS px) of the fighters, floating bonuses and HUD widgets. */
  private screenObstacles(): Array<{ x0: number; y0: number; x1: number; y1: number }> {
    const out: Array<{ x0: number; y0: number; x1: number; y1: number }> = [];
    const duel = this.duel;
    const scene = this.scene;
    const v = this.view;
    if (duel && scene) {
      const box = (x0: number, y0: number, x1: number, y1: number) => {
        const [a, b] = scene.toScreen(x0, y0, v);
        const [c, d] = scene.toScreen(x1, y1, v);
        out.push({ x0: a / v.dpr, y0: b / v.dpr, x1: c / v.dpr, y1: d / v.dpr });
      };
      for (const f of duel.fighters) {
        const s = f.rag.scale;
        box(f.rag.homeX - 0.8 * s, f.rag.footY - 2.4 * s, f.rag.homeX + 0.8 * s, f.rag.footY + 0.1);
      }
      for (const b of duel.bonuses) if (b.alive) box(b.x - 0.6, b.y - 1.25, b.x + 0.6, b.y + 0.45);
    }
    for (const sel of ['.hudtop', '.weapons', '.pause']) {
      const e = this.hud.querySelector(sel);
      if (!e) continue;
      const r = e.getBoundingClientRect();
      if (r.width > 0) out.push({ x0: r.left, y0: r.top, x1: r.right, y1: r.bottom });
    }
    return out;
  }

  // ───────────── HUD ─────────────

  private buildHud(): void {
    const duel = this.duel;
    const s = this.session;
    if (!duel || !s) return;
    clear(this.hud);
    this.tipShown = null;
    this.tutEl = null;
    const bar = (side: Side, name: string) => {
      const fill = h('i');
      const num = h('span.num', {}, String(duel.fighters[side].hp));
      this.hudRefs[`hp${side}`] = fill;
      this.hudRefs[`num${side}`] = num;
      const power = h('div.power', {});
      this.hudRefs[`power${side}`] = power;
      return h(`div.hp.s${side}`, {}, h('img.mini', { src: this.portrait(duel.fighters[side]), alt: '' }), h('div.col', {}, h('span.name', {}, name), h('div.bar', {}, fill)), num, power);
    };
    const label = s.mode === 'endless' ? t('hud.wave', { n: s.wave + 1 }) : s.mode === 'versus' ? '2P' : `${s.world}-${s.level}`;
    const wind = h('div.wind', {}, h('span.arrow'), h('span.val'));
    this.hudRefs.wind = wind;
    const timer = h('div.timer', {});
    this.hudRefs.timer = timer;
    const weapons = h('div.weapons', {});
    this.hudRefs.weapons = weapons;
    const toast = h('div.toast', {});
    this.hudRefs.toast = toast;
    const skip = h('div.skiphint', {}, t('hud.tapSkip'));
    this.hudRefs.skip = skip;
    this.hud.append(
      h('div.hudtop', {},
        bar(0, s.mode === 'versus' ? t('hud.p1') : t('hud.you')),
        h('div.mid', {}, h('div.lvl', {}, label), wind, timer),
        bar(1, s.mode === 'versus' ? t('hud.p2') : this.enemyName(s.L)),
      ),
      h<'button'>('button.pause', { 'aria-label': t('pause.title'), id: 'pause', onclick: () => this.pause() }, h('span'), h('span')),
      toast,
      weapons,
      skip,
    );
    this.refreshWeapons();
    this.updateHud();
  }

  private refreshWeapons(): void {
    const el = this.hudRefs.weapons;
    const duel = this.duel;
    if (!el || !duel) return;
    clear(el);
    const f = duel.current;
    if (f.setup.ai || duel.phase === 'over') return;
    f.setup.weapons.forEach((id, i) => {
      el.append(h<'button'>(`button.wbtn${f.weapon === id ? '.on' : ''}`, {
        'data-weapon': id,
        title: `${t(`weapon.${id}` as Key)} (${i + 1})`,
        onpointerdown: (e: Event) => e.stopPropagation(),
        onclick: () => {
          if (duel.selectWeapon(id)) {
            audio.play('click');
            this.refreshWeapons();
          }
        },
      }, h('img', { src: this.icons.get(id) ?? '', alt: t(`weapon.${id}` as Key) })));
    });
    el.classList.toggle('right', duel.turn === 1);
  }

  private updateHud(): void {
    const duel = this.duel;
    if (!duel) return;
    for (const side of [0, 1] as const) {
      const f = duel.fighters[side];
      const fill = this.hudRefs[`hp${side}`];
      const num = this.hudRefs[`num${side}`];
      if (fill) {
        fill.style.width = `${(f.hp / f.maxHp) * 100}%`;
        fill.classList.toggle('low', f.hp / f.maxHp < 0.3);
      }
      if (num) num.textContent = String(f.hp);
      const pw = this.hudRefs[`power${side}`];
      if (pw) {
        const kinds = [f.power, f.shield ? 'shield' : null].filter((k): k is string => !!k);
        const key = kinds.join(',');
        if (pw.dataset.k !== key) {
          pw.dataset.k = key;
          clear(pw);
          for (const k of kinds) pw.append(h('img', { src: this.powerIcon(k), alt: t(`power.${k}` as Key) }));
        }
      }
    }
    const skip = this.hudRefs.skip;
    if (skip) skip.classList.toggle('on', !!duel.killCam);
    const wind = this.hudRefs.wind;
    if (wind) {
      const v = duel.wind;
      wind.classList.toggle('calm', Math.abs(v) < 0.05);
      wind.style.setProperty('--dir', v < 0 ? '-1' : '1');
      wind.style.setProperty('--str', String(Math.min(1, Math.abs(v) / 3.5)));
      const val = wind.querySelector('.val');
      if (val) val.textContent = Math.abs(v) < 0.05 ? t('intro.calm') : windLabel(v);
    }
    const timer = this.hudRefs.timer;
    if (timer) {
      const show = duel.humanAiming && duel.turnLeft < 8;
      timer.textContent = show ? String(Math.ceil(duel.turnLeft)) : '';
      timer.classList.toggle('on', show);
    }
  }

  private toast(text: string, cls = ''): void {
    const el = this.hudRefs.toast;
    if (!el) return;
    el.textContent = text;
    el.className = `toast show ${cls}`;
    window.clearTimeout(Number(el.dataset.timer));
    el.dataset.timer = String(window.setTimeout(() => el.classList.remove('show'), 1300));
  }

  private flash(text: string, cls: string, ms = 1100): void {
    const b = this.banner;
    b.textContent = text;
    b.className = `banner show ${cls}`;
    window.clearTimeout(Number(b.dataset.timer));
    b.dataset.timer = String(window.setTimeout(() => (b.className = 'banner'), ms));
  }

  // ───────────── duel events ─────────────

  private onEvent(e: DuelEvent): void {
    const duel = this.duel;
    const scene = this.scene;
    if (!duel || !scene) return;
    const quiet = !!this.session?.attract;
    const fx = scene.fx;
    const vol = quiet ? 0 : 1;
    const snd = (n: Parameters<typeof audio.play>[0], o: { pitch?: number; volume?: number } = {}) => {
      if (!quiet) audio.play(n, { ...o, volume: (o.volume ?? 1) * vol });
    };
    switch (e.type) {
      case 'fire':
        snd(e.weapon.sound, { pitch: 0.9 + Math.random() * 0.2 });
        if (e.weapon.spin) snd('spin');
        if (!quiet) this.refreshWeapons();
        if (e.side === 0 && !quiet && (this.tutorialActive || !this.save.tutorial)) this.endTutorial();
        break;
      case 'hit': {
        const head = e.zone === 'head';
        fx.hit(e.x, e.y, head);
        fx.text(e.x, e.y - 0.4, `-${e.dmg}`, head ? '#ffd23d' : '#ffffff', head);
        snd('hit', { pitch: head ? 1.15 : 0.9 + Math.random() * 0.2 });
        if (head) {
          snd('headshot');
          if (!quiet) this.flash(t('hud.headshot'), 'headshot');
        }
        if (e.ko) {
          snd('ko');
          if (!quiet) window.setTimeout(() => this.flash(t('hud.ko'), 'ko', 1400), head ? 500 : 0);
        }
        if (e.weapon.look === 'snowball') fx.burst('snow', e.x, e.y, 18, { speed: 4, size: 0.07, color: '#ffffff', life: 0.8, g: 6 });
        if (e.weapon.look === 'bolt') fx.burst('magic', e.x, e.y, 16, { speed: 4, size: 0.08, color: ['#d6a8ff', '#ffffff'], life: 0.6, g: 0 });
        if (e.fire) fx.burst('ember', e.x, e.y, 14, { speed: 3.5, size: 0.1, color: ['#ffb347', '#ff6a1f', '#ffd23d'], life: 0.7, g: -1 });
        if (!quiet) this.updateHud();
        if (!quiet && e.side === 1 && this.session?.mode !== 'versus') this.tip('head', t('tip.head'), head ? 1300 : 700);
        // comic reactions (never on the K.O. itself: the kill cam takes over)
        if (!e.ko && (head || Math.random() < 0.55)) scene.say(e.side, this.line('say.hit'));
        {
          const shooter = duel.other(e.side);
          if (!quiet && head && !shooter.setup.ai && shooter.headStreak >= 2) {
            window.setTimeout(() => this.toast(t('hud.streak', { n: shooter.headStreak }), 'p1'), 700);
          }
        }
        break;
      }
      case 'hat':
        // the kill cam speaks for itself on a K.O.
        if (!duel.fighters[e.side].ko) scene.say(e.side, this.line('say.hat'), 1.8);
        snd('whoosh', { pitch: 1.4, volume: 0.6 });
        break;
      case 'bonus': {
        const col: Record<string, string[]> = { coins: ['#ffd23d', '#fff3a0'], fire: ['#ff6a1f', '#ffd23d'], triple: ['#3cc4ff', '#ffffff'], shield: ['#7be0ff', '#ffffff'], heal: ['#ff6fb5', '#ffffff'] };
        fx.burst('star', e.x, e.y, 8, { speed: 4, size: 0.16, color: col[e.reward] ?? ['#ffd23d'], life: 0.9, g: 3 });
        fx.burst('spark', e.x, e.y, 12, { speed: 6, size: 0.08, color: col[e.reward] ?? ['#ffffff'], life: 0.4, g: 0 });
        fx.add({ kind: 'ring', x: e.x, y: e.y, size: 0.8, life: 0.3, color: '#ffffff' });
        const label = e.reward === 'coins' ? t('power.coins', { n: e.coins }) : t(`power.${e.reward}` as Key);
        fx.text(e.x, e.y - 0.5, label, (col[e.reward] ?? ['#ffd23d'])[0] as string, true);
        snd(e.reward === 'coins' ? 'coin' : 'magic', { pitch: 1.2 });
        if (!quiet) this.updateHud();
        break;
      }
      case 'shield':
        fx.add({ kind: 'ring', x: e.x, y: e.y, size: 1.4, life: 0.4, color: '#7be0ff' });
        fx.burst('spark', e.x, e.y, 14, { speed: 5, size: 0.08, color: ['#7be0ff', '#ffffff'], life: 0.4, g: 0 });
        fx.text(e.x, e.y - 0.6, t('hud.blocked'), '#7be0ff', true);
        snd('clink', { pitch: 1.4 });
        if (!quiet) this.updateHud();
        break;
      case 'killcam':
        if (!quiet) this.updateHud();
        break;
      case 'blast':
        fx.blast(e.x, e.y, e.r, e.weapon.look === 'meteor');
        snd('explosion');
        break;
      case 'thud': {
        const colors: Record<string, string[]> = {
          grass: ['#6cc24a', '#8a5a3b'], wood: ['#c98b4a', '#8a5a3b'], sand: ['#f5cf7d', '#e3ab5c'], sandstone: ['#e9a463'], cactus: ['#5cbf5a'], snow: ['#ffffff'],
        };
        fx.burst('dust', e.x, e.y, 8, { speed: 2.5, size: 0.08, color: colors[e.mat] ?? ['#d9d2c5'], life: 0.5, g: 5 });
        if (duel.level.floor.kind === 'lava' && e.y >= duel.level.floor.y - 0.1) {
          fx.burst('ember', e.x, e.y, 10, { speed: 3, size: 0.08, color: ['#ffb347', '#ff6a1f'], life: 0.7, g: 3 });
          snd('splash', { pitch: 0.7 });
        } else if (duel.level.floor.kind === 'lake' && e.y >= duel.level.floor.y - 0.1) {
          fx.burst('snow', e.x, e.y, 10, { speed: 3, size: 0.06, color: '#dff4ff', life: 0.6, g: 6 });
          snd('splash');
        } else snd('thud');
        break;
      }
      case 'clink':
        fx.burst('spark', e.x, e.y, 6, { speed: 4, size: 0.06, color: ['#ffffff', '#fff2a8'], life: 0.25, g: 0 });
        if (e.mat === 'ice') fx.burst('shard', e.x, e.y, 5, { speed: 3, size: 0.07, color: '#cfefff', life: 0.6, g: 8 });
        snd('clink');
        break;
      case 'burst':
        fx.burst(e.weapon.look === 'snowball' ? 'snow' : 'magic', e.x, e.y, 16, { speed: 4, size: 0.08, color: e.weapon.look === 'snowball' ? '#ffffff' : ['#d6a8ff', '#ffffff'], life: 0.7, g: 4 });
        snd(e.weapon.look === 'snowball' ? 'thud' : 'magic', { pitch: 1.3 });
        break;
      case 'leaves':
        fx.burst('leaf', e.x, e.y, 5, { speed: 2, size: 0.12, color: ['#7fd14a', '#4f9e3a', '#f2b13d'], life: 1.8, g: 1.5 });
        break;
      case 'miss':
        if (!quiet && duel.fighters[e.side] && !duel.fighters[e.side].setup.ai) {
          this.toast(t('hud.miss'));
          if (Math.random() < 0.35 && this.session?.mode !== 'versus') scene.say(1, this.line('say.miss'), 1.3);
        }
        break;
      case 'fall': {
        const kind = duel.level.floor.kind;
        const lava = kind === 'lava';
        const water = kind === 'lake';
        if (lava) {
          // a hot-foot hop: smoke puffs, embers and stars (no harm shown)
          fx.burst('puff', e.x, e.y, 12, { speed: 3, size: 0.35, color: ['#7a6a70', '#9a8a90', '#ffffff'], life: 1.2, g: -2 });
          fx.burst('ember', e.x, e.y, 20, { speed: 5, size: 0.1, color: ['#ffb347', '#ff6a1f'], life: 0.9, g: 3 });
        } else if (water) {
          fx.burst('snow', e.x, e.y, 26, { speed: 6, size: 0.12, color: ['#ffffff', '#bfe6ff', '#8fc6e6'], life: 1, g: 9, up: 3 });
          fx.add({ kind: 'ring', x: e.x, y: e.y, size: 1.4, life: 0.5, color: '#ffffff' });
        } else {
          fx.burst('puff', e.x, e.y, 10, { speed: 2.5, size: 0.4, color: ['#ffffff', '#f2eee6'], life: 1.1, g: -1 });
        }
        fx.burst('star', e.x, e.y - 0.5, 6, { speed: 4, size: 0.2, color: ['#ffd23d'], life: 1.1, g: 2, up: 2 });
        if (e.dmg > 0) fx.text(e.x, e.y - 1, `-${e.dmg}`, '#ffffff');
        snd('splash', { pitch: lava ? 0.8 : 1 });
        if (!quiet) {
          if (e.ringOut) {
            snd('ko');
            this.flash(t('hud.ringout'), 'ko', 1600);
          } else if (!e.ko) this.toast(t('hud.fall'));
          this.updateHud();
        }
        break;
      }
      case 'crumble':
        fx.burst('dust', e.x, e.y, 14, { speed: 2, size: 0.15, color: ['#4d3f42', '#ff7a2a'], life: 0.9, g: 4 });
        snd('crumble');
        break;
      case 'turn':
        if (quiet) break;
        this.refreshWeapons();
        this.updateHud();
        if (this.session?.mode === 'versus') this.toast(e.side === 0 ? t('hud.p1Turn') : t('hud.p2Turn'), e.side === 0 ? 'p1' : 'p2');
        else if (e.side === 0) this.toast(t('hud.yourTurn'), 'p1');
        else this.toast(t('hud.enemyTurn'), 'p2');
        if (!duel.fighters[e.side].setup.ai) snd('turn');
        if (e.side === 0 && this.tutorialActive) window.setTimeout(() => this.tutorialActive && this.showTutorial(), 350);
        if (e.side === 0 && this.session?.mode !== 'versus') {
          if (Math.abs(duel.wind) >= 0.3) this.tip('wind', t('tip.wind'), 900);
          else if (duel.fighters[0].setup.weapons.length > 1) this.tip('weapons', t('tip.weapons'), 900);
        }
        if (Math.abs(duel.wind) > 1.5 && duel.level.wind.gust > 0) snd('wind', { volume: 0.6 });
        break;
      case 'timeout':
        if (!quiet) this.toast(t('hud.timeout'));
        break;
      case 'over':
        if (quiet) break;
        this.overTimer = 1.8;
        this.refreshWeapons();
        break;
    }
  }

  private duelTick(dt: number): void {
    const duel = this.duel;
    if (!duel) return;
    this.updateHud();
    if (duel.phase === 'over' && this.overTimer > 0 && !this.resultShown) {
      this.overTimer -= dt;
      if (this.overTimer <= 0) this.result();
    }
  }

  // ───────────── pause / results ─────────────

  pause(): void {
    if (!this.duel || !this.session || this.session.attract || this.paused || this.resultShown) return;
    this.paused = true;
    this.drag = null;
    this.duel.cancelAim();
    this.tracker.stop();
    const s = this.session;
    this.show(
      h('div.screen.dim', {},
        h('div.card.pausecard', {},
          h('h2', {}, t('pause.title')),
          this.btn(t('pause.resume'), () => this.resume(), 'primary big', { id: 'resume' }),
          this.btn(t('pause.restart'), () => {
            this.paused = false;
            if (s.mode === 'endless') this.endlessStart();
            else this.restartLevel();
          }),
          this.toggleRow('settings.sound', 'sound'),
          this.toggleRow('settings.music', 'music'),
          this.btn(t('pause.quit'), () => {
            this.paused = false;
            if (s.mode === 'adventure') this.map(s.world);
            else this.title();
          }),
        ),
      ),
    );
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    this.show();
    this.last = performance.now();
    if (this.duel && this.duel.phase !== 'over') this.tracker.start();
  }

  private restartLevel(): void {
    const s = this.session;
    if (!s) return;
    s.revived = false;
    s.tryWeapon = null;
    this.prepareDuel();
    this.showIntro();
  }

  private async rewarded(): Promise<boolean> {
    this.tracker.stop();
    try {
      return await this.platform.rewarded();
    } catch {
      return false;
    }
  }

  /**
   * A rewarded-ad button: disabled while the ad is requested; if no ad comes, it says so
   * for 2.5 s, then gets its label back and can be tried again. The game never waits on it.
   */
  private adButton(label: string, onReward: () => void, cls: string, attrs: Record<string, string>): HTMLButtonElement {
    const b = this.btn(label, () => {
      if (b.disabled) return;
      b.disabled = true;
      b.classList.add('waiting');
      b.setAttribute('aria-busy', 'true');
      void this.rewarded().then((ok) => {
        b.classList.remove('waiting');
        b.removeAttribute('aria-busy');
        if (ok) {
          onReward();
          return;
        }
        b.textContent = t('result.adFail');
        b.classList.add('failed');
        window.setTimeout(() => {
          b.textContent = label;
          b.classList.remove('failed');
          b.disabled = false;
        }, AD_FAIL_MS);
      });
    }, cls, attrs);
    return b;
  }

  /** Natural break: a midgame ad (throttled) before continuing. */
  private async breakThen(next: () => void): Promise<void> {
    if (this.adBreak) return; // a second click while the ad is requested
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

  /** Leaving the title for a game (Play / Versus / Endless): the platform's pre-roll, if any. */
  private async prerollThen(next: () => void): Promise<void> {
    if (this.adBreak) return;
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

  private result(): void {
    const duel = this.duel;
    const s = this.session;
    if (!duel || !s) return;
    this.resultShown = true;
    this.tracker.stop();
    this.hud.classList.add('hidden');
    const won = duel.winner === 0;
    if (import.meta.env.VITE_PLATFORM === 'playgama') this.platform.levelEnd?.(won);
    if (s.mode === 'versus') return this.versusResult();
    if (s.mode === 'endless') return this.endlessResult(won);
    const me = duel.fighters[0];
    const L = s.L;
    const stars = starsFor(won, me.hp, me.maxHp, me.shots, L.par);
    const replay = starsOf(this.save, s.world, s.level) > 0;
    const coins = coinsFor(s.world, s.level, stars, L.boss, replay);
    const res = recordLevel(this.save, s.world, s.level, stars, coins);
    const extra = this.duelExtras(won, s.world);
    this.trackMissions(won, stars);
    this.persist();
    if (won && L.boss) this.platform.happytime();
    if (import.meta.env.VITE_PLATFORM === 'gamepix') {
      if (won && !L.boss) this.platform.happyMoment?.('level_complete');
      if (!won) this.platform.sadMoment?.('level_failed');
    }
    audio.play(won ? 'win' : 'lose');
    const starsEl = h('div.bigstars', {}, ...[1, 2, 3].map((i) => h(`i${i <= stars ? '.on' : ''}`, { style: `animation-delay:${0.25 + i * 0.3}s` })));
    if (won) for (let i = 0; i < stars; i++) window.setTimeout(() => audio.play('star', { index: i }), 550 + i * 300);
    const coinLine = h('div.coinline', {}, h('span.coin'), t('result.coins', { n: coins }));
    let doubled = false;
    const buttons = h('div.row', {});
    if (won) {
      const nextLevel = s.level < LEVELS_PER_WORLD ? s.level + 1 : null;
      buttons.append(
        this.btn(t('result.map'), () => this.breakThen(() => this.map(s.world)), '', { id: 'to-map' }),
        this.btn(t('result.retry'), () => this.breakThen(() => this.restartLevel()), '', { id: 'retry' }),
        nextLevel
          ? this.btn(t('result.next'), () => this.breakThen(() => this.intro(s.world, nextLevel)), 'primary', { id: 'next' })
          : this.btn(t('result.next'), () => this.breakThen(() => this.map(Math.min(WORLDS.length, s.world + 1))), 'primary', { id: 'next' }),
      );
    } else {
      buttons.append(
        this.btn(t('result.map'), () => this.breakThen(() => this.map(s.world)), '', { id: 'to-map' }),
        this.btn(t('result.retry'), () => this.breakThen(() => this.restartLevel()), 'primary', { id: 'retry' }),
      );
    }
    const extras = h('div.extras', {});
    if (won && coins > 0 && this.platform.adsUnavailable() === null) {
      const dbl = this.adButton(`▶ ${t('result.double')}`, () => {
        if (doubled) return;
        doubled = true;
        this.save.coins += coins;
        this.persist();
        coinLine.lastChild!.textContent = t('result.coins', { n: coins * 2 });
        dbl.remove();
        audio.play('coin');
        this.flash(t('result.doubled'), 'info');
        this.refreshCoins();
      }, 'ad', { id: 'double' });
      extras.append(dbl);
    }
    if (!won && L.boss && !s.revived && this.platform.adsUnavailable() === null) {
      extras.append(this.adButton(`▶ ${t('result.revive')}`, () => {
        s.revived = true;
        this.show();
        this.resultShown = false;
        duel.revive(0);
        this.hud.classList.remove('hidden');
        this.updateHud();
        this.refreshWeapons();
        this.tracker.start();
      }, 'ad', { id: 'revive' }));
    }
    this.show(
      h('div.screen.dim', {},
        h(`div.card.result${won ? '.won' : '.lost'}`, {},
          h('h2', {}, won ? t('result.win') : t('result.lose')),
          starsEl,
          h('div.stats', {}, h('span', {}, t('result.hp', { n: me.hp })), h('span', {}, t('result.shots', { n: me.shots, p: L.par }))),
          coinLine,
          extra.lines.length ? h('div.combos', {}, ...extra.lines.map((l) => h('span', {}, l))) : null,
          res.unlockedWorld ? h('div.unlocked', {}, t('result.unlocked', { w: t(`world.${worldByIndex(res.unlockedWorld).id}` as Key) })) : null,
          extras,
          buttons,
        ),
      ),
    );
  }

  /** Combo rewards (Perfect, Sharpshooter, headshot streak) and coins picked up in the duel. */
  private duelExtras(won: boolean, world: number): { coins: number; lines: string[] } {
    const me = this.duel?.fighters[0];
    if (!me) return { coins: 0, lines: [] };
    const lines: string[] = [];
    let coins = 0;
    if (me.coins > 0) {
      coins += me.coins;
      lines.push(t('result.bonusCoins', { n: me.coins }));
    }
    if (won && me.damageTaken === 0) {
      const n = 20 + world * 3;
      coins += n;
      lines.push(t('result.perfect', { n }));
    }
    if (won && me.shots === 1) {
      coins += 30;
      lines.push(t('result.sharpshooter', { n: 30 }));
    }
    if (me.bestHeadStreak >= 2) {
      const n = me.bestHeadStreak * 5;
      coins += n;
      lines.push(t('result.streak', { s: me.bestHeadStreak, n }));
    }
    this.save.coins += coins;
    return { coins, lines };
  }

  /** Daily mission progress from a duel against the AI. */
  private trackMissions(won: boolean, stars: number): void {
    const duel = this.duel;
    if (!duel) return;
    const [me, foe] = duel.fighters;
    refreshDaily(this.save, new Date());
    const done = [
      ...(won ? addProgress(this.save, 'wins') : []),
      ...addProgress(this.save, 'headshots', me.headshots),
      ...addProgress(this.save, 'bonuses', me.bonuses),
      ...addProgress(this.save, 'stars', stars),
      ...(won && me.damageTaken === 0 ? addProgress(this.save, 'flawless') : []),
      ...(won && foe.ringedOut ? addProgress(this.save, 'ringout') : []),
      ...(won && me.shots === 1 ? addProgress(this.save, 'sharpshooter') : []),
    ];
    if (done.length) window.setTimeout(() => this.flash(t('result.missionDone'), 'info', 1600), 900);
  }

  private refreshCoins(): void {
    for (const el of Array.from(this.layer.querySelectorAll('.coins'))) el.lastChild!.textContent = String(this.save.coins);
  }

  // ───────────── 2 players ─────────────

  versusSetup(): void {
    if (!this.session?.attract || this.session.world !== this.versusWorld) this.attract(this.versusWorld);
    const grid = h('div.worldgrid', {}, ...WORLDS.map((w) =>
      h<'button'>(`button.worldbtn.w-${w.id}${this.versusWorld === w.index ? '.on' : ''}`, {
        'data-world': w.index,
        onclick: () => {
          audio.play('click');
          this.versusWorld = w.index;
          this.versusSetup();
        },
      }, t(`world.${w.id}` as Key)),
    ));
    this.show(
      h('div.screen.setup', {},
        h('div.topbar', {}, this.btn('‹ ' + t('common.back'), () => this.title(), 'small'), h('span')),
        h('div.card', {},
          h('h2', {}, t('versus.title')),
          h('p.sub', {}, t('versus.hint')),
          h('div.label', {}, t('versus.pick')),
          grid,
          this.btn(t('versus.start'), () => this.versusStart(), 'primary big', { id: 'versus-start' }),
        ),
      ),
    );
  }

  private versusStart(): void {
    const level = 5;
    const L = generateLevel(this.versusWorld, level, { seed: Math.floor(Math.random() * 1e9), forceBoss: false });
    this.session = { mode: 'versus', world: this.versusWorld, level, L, tryWeapon: null, revived: false, wave: 0, endlessHp: 100, attract: false };
    this.prepareDuel();
    this.showIntro();
  }

  private versusResult(): void {
    const duel = this.duel;
    if (!duel) return;
    audio.play('win');
    this.show(
      h('div.screen.dim', {},
        h('div.card.result.won', {},
          h('h2', {}, duel.winner === 0 ? t('result.p1wins') : t('result.p2wins')),
          h('img.portrait.big', { src: this.portrait(duel.fighters[duel.winner ?? 0]), alt: '' }),
          h('div.row', {},
            this.btn(t('result.menu'), () => this.breakThen(() => this.title()), '', { id: 'to-menu' }),
            this.btn(t('result.rematch'), () => this.breakThen(() => this.versusStart()), 'primary', { id: 'rematch' }),
          ),
        ),
      ),
    );
  }

  // ───────────── endless ─────────────

  endlessSetup(): void {
    this.show(
      h('div.screen.setup', {},
        h('div.topbar', {}, this.btn('‹ ' + t('common.back'), () => this.title(), 'small'), this.coinsBadge()),
        h('div.card', {},
          h('h2', {}, t('endless.title')),
          h('p.sub', {}, t('endless.hint')),
          h('div.best', {}, t('result.best', { n: this.save.endlessBest })),
          this.btn(t('endless.start'), () => this.endlessStart(), 'primary big', { id: 'endless-start' }),
        ),
      ),
    );
  }

  private endlessStart(): void {
    this.session = null;
    this.endlessWave(0, 100);
  }

  private endlessWave(wave: number, hp: number): void {
    const L = endlessLevel(wave, furthestWorld(this.save), new Rng(Date.now() + wave));
    const world = L.world.index;
    const level = L.level;
    this.session = { mode: 'endless', world, level, L, tryWeapon: null, revived: false, wave, endlessHp: hp, attract: false };
    this.prepareDuel();
    this.showIntro();
  }

  private endlessResult(won: boolean): void {
    const duel = this.duel;
    const s = this.session;
    if (!duel || !s) return;
    const me = duel.fighters[0];
    if (won) {
      const coins = 5 + s.wave * 2;
      this.save.coins += coins;
      this.duelExtras(true, s.world);
      this.trackMissions(true, 0);
      this.save.endlessBest = Math.max(this.save.endlessBest, s.wave + 1);
      this.persist();
      if (import.meta.env.VITE_PLATFORM === 'gamepix') this.platform.happyMoment?.('level_complete');
      audio.play('win');
      const hp = Math.min(me.maxHp, me.hp + 25);
      this.show(
        h('div.screen.dim', {},
          h('div.card.result.won', {},
            h('h2', {}, t('result.win')),
            h('div.stats', {}, h('span', {}, t('result.waves', { n: s.wave + 1 })), h('span', {}, `❤ ${hp}`)),
            h('div.coinline', {}, h('span.coin'), t('result.coins', { n: coins })),
            h('div.row', {},
              this.btn(t('result.menu'), () => this.breakThen(() => this.title()), '', { id: 'to-menu' }),
              this.btn(t('result.continue'), () => this.breakThen(() => this.endlessWave(s.wave + 1, hp)), 'primary', { id: 'next' }),
            ),
          ),
        ),
      );
      return;
    }
    this.trackMissions(false, 0);
    const score = s.wave;
    const best = score >= this.save.endlessBest && score > 0;
    this.save.endlessBest = Math.max(this.save.endlessBest, score);
    this.persist();
    if (import.meta.env.VITE_PLATFORM === 'gamepix') {
      if (best) this.platform.happyMoment?.('high_score');
      this.platform.sadMoment?.('game_over');
    }
    audio.play('lose');
    this.show(
      h('div.screen.dim', {},
        h('div.card.result.lost', {},
          h('h2', {}, t('result.lose')),
          h('div.stats', {}, h('span', {}, t('result.waves', { n: score })), h('span', {}, best ? t('result.newBest') : t('result.best', { n: this.save.endlessBest }))),
          h('div.row', {},
            this.btn(t('result.menu'), () => this.breakThen(() => this.title()), '', { id: 'to-menu' }),
            this.btn(t('result.retry'), () => this.breakThen(() => this.endlessStart()), 'primary', { id: 'retry' }),
          ),
        ),
      ),
    );
  }

  // ───────────── shop & settings ─────────────

  shop(tab: ShopItem['type']): void {
    const items: ShopItem[] =
      tab === 'weapon' ? PLAYER_WEAPONS.map((id) => ({ type: 'weapon', id })) : tab === 'hat' ? HATS.map((id) => ({ type: 'hat', id })) : COLORS.map((id) => ({ type: 'color', id }));
    const grid = h('div.shopgrid', {});
    for (const it of items) {
      const own = owns(this.save, it);
      const locked = itemLocked(this.save, it);
      const price = priceOf(it);
      const equipped =
        (it.type === 'weapon' && this.save.equipped.weapon === it.id) || (it.type === 'hat' && this.save.equipped.hat === it.id) || (it.type === 'color' && this.save.equipped.color === it.id);
      const name = it.type === 'weapon' ? t(`weapon.${it.id}` as Key) : it.type === 'hat' ? t(`hat.${it.id}` as Key) : t(`color.${it.id}` as Key);
      const img =
        it.type === 'weapon'
          ? (this.icons.get(it.id) ?? '')
          : fighterPortrait({ look: 'hero', hat: it.type === 'hat' ? it.id : this.save.equipped.hat, color: it.type === 'color' ? it.id : this.save.equipped.color, weapons: [], weapon: 'bow', hp: 1, ai: false }, 88);
      let action: HTMLElement;
      if (equipped) action = h('span.tag.eq', {}, t('shop.equipped'));
      else if (own)
        action = this.btn(t('shop.equip'), () => {
          equip(this.save, it);
          this.persist();
          this.shop(tab);
        }, 'small');
      else if (locked) action = h('span.tag.lock', {}, t('shop.requires', { n: it.type === 'weapon' ? WEAPONS[it.id].requires : 0 }));
      else
        action = this.btn(`${price}`, () => {
          if (buy(this.save, it)) {
            audio.play('coin');
            this.persist();
            this.shop(tab);
          }
        }, `small buy${this.save.coins < price ? ' poor' : ''}`, { 'data-buy': it.id });
      grid.append(
        h(`div.item${equipped ? '.equipped' : ''}${!own && locked ? '.locked' : ''}`, {},
          h('img', { src: img, alt: '' }),
          h('b', {}, name),
          it.type === 'weapon' ? h('small', {}, t(`wdesc.${it.id}` as Key)) : null,
          action,
        ),
      );
    }
    const tabBtn = (ty: ShopItem['type'], key: Key) =>
      h<'button'>(`button.tab.wide${tab === ty ? '.on' : ''}`, { onclick: () => { audio.play('click'); this.shop(ty); } }, t(key));
    this.show(
      h('div.screen.shop', {},
        h('div.topbar', {}, this.btn('‹ ' + t('common.back'), () => this.title(), 'small'), this.coinsBadge()),
        h('div.card.shopcard', {},
          h('h2', {}, t('shop.title')),
          h('div.tabs', {}, tabBtn('weapon', 'shop.weapons'), tabBtn('hat', 'shop.hats'), tabBtn('color', 'shop.colors')),
          grid,
        ),
      ),
    );
    void HAT_PRICE;
    void COLOR_PRICE;
  }

  private toggleRow(key: Key, field: 'sound' | 'music'): HTMLElement {
    const on = this.save.settings[field];
    const b = h<'button'>(`button.toggle${on ? '.on' : ''}`, {
      'data-setting': field,
      onclick: () => {
        audio.unlock();
        this.save.settings[field] = !this.save.settings[field];
        this.persist();
        this.applyAudio();
        audio.play('click');
        b.classList.toggle('on', this.save.settings[field]);
        b.textContent = this.save.settings[field] ? t('settings.on') : t('settings.off');
      },
    }, on ? t('settings.on') : t('settings.off'));
    return h('div.setrow', {}, h('span', {}, t(key)), b);
  }

  settings(back: () => void): void {
    const langs: Array<['auto' | 'en' | 'fr', string]> = [['auto', t('settings.auto')], ['en', 'English'], ['fr', 'Français']];
    this.show(
      h('div.screen.setup', {},
        h('div.topbar', {}, this.btn('‹ ' + t('common.back'), back, 'small'), h('span')),
        h('div.card.settings', {},
          h('h2', {}, t('settings.title')),
          this.toggleRow('settings.sound', 'sound'),
          this.toggleRow('settings.music', 'music'),
          h('div.setrow', {}, h('span', {}, t('settings.lang')),
            h('div.seg', {}, ...langs.map(([code, label]) =>
              h<'button'>(`button${this.save.settings.lang === code ? '.on' : ''}`, {
                'data-lang': code,
                onclick: () => {
                  audio.play('click');
                  this.save.settings.lang = code;
                  this.persist();
                  this.applySettings();
                  this.settings(back);
                },
              }, label),
            )),
          ),
          h('p.credits', {}, `Stick Duel · ${getLang().toUpperCase()}`),
        ),
      ),
    );
  }

  // ───────────── automation helpers (tests, screenshots, recordings) ─────────────

  /**
   * Cover art from a real duel: the hero's arrow is about to hit the boss, who is
   * drawing his own weapon. Freezes on that frame with the HUD hidden and the title shown.
   */
  async coverShot(world: number, level: number, title: 'landscape' | 'portrait' | 'square' | 'none'): Promise<void> {
    this.intro(world, level);
    this.fight();
    this.hud.classList.add('hidden');
    this.banner.className = 'banner';
    this.banner.style.display = 'none';
    const duel = this.duel as Duel;
    const scene = this.scene as SceneRenderer;
    scene.clean = true;
    const [hero, boss] = duel.fighters;
    // a few earlier hits make the boss look battle-worn
    boss.hp = Math.round(boss.maxHp * 0.35);
    hero.hp = 64;
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    await wait(400);
    duel.wind = 0;
    this.autoFire(true);
    boss.aim = { angle: boss.restAngle() - 0.15, power: 0.85 };
    boss.showAim = true;
    // freeze just before impact
    for (let i = 0; i < 400; i++) {
      const p = duel.projectiles[0];
      if (!p) break;
      const hp = boss.rag.head.getPosition();
      if (Math.hypot(p.f.x - hp.x, p.f.y - hp.y) < 2.2 * boss.rag.scale) break;
      await wait(16);
    }
    this.freeze = true;
    // title only on covers: no speech bubbles, no floating bonuses (top-left corner stays clear)
    scene.clearBubbles();
    scene.fx.list = scene.fx.list.filter((p) => p.kind !== 'text');
    duel.bonuses = [];
    hero.aim = { angle: hero.restAngle() - 0.1, power: 0.15 };
    hero.showAim = true;
    // tighter, more dramatic framing than the gameplay camera
    const cam = scene.cam;
    const hh = hero.rag.head.getPosition();
    const bh = boss.rag.head.getPosition();
    const v = this.view;
    if (title === 'landscape' || title === 'none') {
      const spanX = Math.abs(bh.x - hh.x) + 4.2;
      cam.zoom = v.w / spanX;
      cam.x = (hh.x + bh.x) / 2;
      cam.y = (hh.y + bh.y) / 2 + 0.4 * (v.h / cam.zoom / 12);
    } else {
      // narrow formats: close on the boss with the arrow flying in
      const spanX = title === 'portrait' ? 7.5 : 8.5;
      cam.zoom = v.w / spanX;
      cam.x = bh.x - spanX * 0.2;
      cam.y = bh.y + (title === 'portrait' ? 2.2 : 1.6);
    }
    clear(this.layer);
    if (title !== 'none') this.layer.append(h(`div.covertitle.ct-${title}`, {}, h('div.logo', {}, h('span.l1', {}, 'Stick'), h('span.l2', {}, 'Duel'))));
    await wait(100);
  }

  /** Like a player: pulls back over ~0.7 s (aim preview + power arc visible), then releases. */
  async demoShot(head = false, weapon?: WeaponId, target?: { x: number; y: number }): Promise<boolean> {
    const d = this.duel;
    if (!d?.humanAiming) return false;
    if (weapon) d.selectWeapon(weapon);
    this.refreshWeapons();
    const s = target ? d.autoShotAt(target) : d.autoShot(head);
    if (!s) return false;
    const f = d.current;
    const t0 = performance.now();
    await new Promise<void>((done) => {
      const step = () => {
        const k = Math.min(1, (performance.now() - t0) / 750);
        const e = 1 - (1 - k) * (1 - k);
        d.setAim(f.restAngle() + (s.angle - f.restAngle()) * Math.min(1, e * 1.3), s.power * e);
        if (k < 1) requestAnimationFrame(step);
        else done();
      };
      step();
    });
    d.setAim(s.angle, s.power);
    return d.fire();
  }

  /** Fires a perfect shot for the human whose turn it is. */
  autoFire(head = false, power = 1): boolean {
    const d = this.duel;
    if (!d?.humanAiming) return false;
    const s = d.autoShot(head);
    if (!s) return false;
    d.setAim(s.angle, s.power * power);
    return d.fire();
  }
}

const CHEST_SVG = `<svg viewBox="0 0 96 80" width="96" height="80" aria-hidden="true"><g stroke="#1e1a2b" stroke-width="4" stroke-linejoin="round"><path class="lid" d="M10 34 Q10 10 48 10 Q86 10 86 34 Z" fill="#c98b4a"/><rect x="10" y="34" width="76" height="38" rx="6" fill="#a8703c"/><rect x="42" y="30" width="12" height="18" rx="3" fill="#ffd23d"/><path d="M10 50 H86" stroke-width="3"/></g><g class="sparkle" fill="#ffd23d"><circle cx="20" cy="12" r="3"/><circle cx="80" cy="8" r="2.5"/><circle cx="72" cy="24" r="2"/></g></svg>`;

const HAND_SVG = `<svg viewBox="0 0 64 64" width="64" height="64" aria-hidden="true"><path d="M24 30V10a5 5 0 0 1 10 0v16l2-1a5 5 0 0 1 6 2l1-1a5 5 0 0 1 7 3l1 0a5 5 0 0 1 6 5v9c0 9-6 17-16 17h-6c-6 0-10-3-13-8l-8-13a5 5 0 0 1 8-6z" fill="#fff" stroke="#1e1a2b" stroke-width="4" stroke-linejoin="round"/></svg>`;

/** Dashed trail linking the level nodes in order (drawn behind them). */
function drawPath(path: HTMLElement): void {
  const box = path.getBoundingClientRect();
  const pts = Array.from(path.querySelectorAll<HTMLElement>('.node'))
    .sort((a, b) => Number(a.dataset.level) - Number(b.dataset.level))
    .map((n) => {
      const r = n.getBoundingClientRect();
      return `${(r.left + r.width / 2 - box.left).toFixed(1)},${(r.top + r.height / 2 - box.top).toFixed(1)}`;
    });
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('class', 'trail');
  svg.setAttribute('width', String(box.width));
  svg.setAttribute('height', String(box.height));
  for (const [cls, w] of [['trail-bg', 12], ['trail-fg', 5]] as const) {
    const pl = document.createElementNS(ns, 'polyline');
    pl.setAttribute('points', pts.join(' '));
    pl.setAttribute('class', cls);
    pl.setAttribute('stroke-width', String(w));
    svg.append(pl);
  }
  path.prepend(svg);
}

function windLabel(v: number): string {
  return `${v < 0 ? '←' : '→'} ${Math.round(Math.abs(v) * 5)}`;
}

/** A small standing fighter rendered to an image (HUD, intro, shop). */
const portraitCache = new Map<string, string>();
export function fighterPortrait(setup: FighterSetup, px: number): string {
  const key = `${setup.look}|${setup.hat}|${setup.color}|${setup.boss ? 1 : 0}|${px}`;
  const hit = portraitCache.get(key);
  if (hit) return hit;
  const dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
  const c = document.createElement('canvas');
  c.width = c.height = Math.round(px * dpr);
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  const world = new World({ gravity: { x: 0, y: 0 } });
  const rag = new Ragdoll(world, 0, 0, 1, 1, -1);
  const f = new Fighter(0, { ...setup, scale: 1, weapon: 'bow' }, rag);
  f.weapon = setup.look === 'hero' || setup.look === 'hero2' ? 'bow' : 'axe';
  // head-and-shoulders crop: ragdoll feet at y = 0, head centre at about -1.73 m
  const z = c.height * 1.05;
  ctx.setTransform(z, 0, 0, z, c.width / 2, c.height * 0.5 + 1.73 * z);
  drawFighter(ctx, f, 2.2 / z, 0, false);
  const url = c.toDataURL();
  portraitCache.set(key, url);
  return url;
}

export type { HatId, ColorId };
