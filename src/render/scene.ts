import { clamp, damp, lerp } from '../core/math';
import { Rng } from '../core/rng';
import { previewDots } from '../core/trajectory';
import type { Duel, Fighter } from '../game/duel';
import type { Deco, Solid } from '../game/levels';
import { Backdrop } from './backdrop';
import { drawFighter, drawStuck } from './fighter';
import { Fx } from './fx';
import { drawItem, line, star } from './items';
import { OUTLINE, type Theme } from './theme';

type Ctx = CanvasRenderingContext2D;

export interface View {
  /** Device pixels. */
  w: number;
  h: number;
  dpr: number;
  /** Screen padding (device px) kept free for the HUD. */
  padTop: number;
  padBottom: number;
}

export class Camera {
  x = 0;
  y = -2;
  zoom = 40;
  private init = false;

  /** Frames both fighters (and the flying projectile) with margins. */
  update(duel: Duel, view: View, dt: number, snap = false): void {
    const [a, b] = duel.fighters;
    // phone portrait: the width limits the zoom, so keep the side margins tight
    const portrait = view.h > view.w * 1.15;
    const side = portrait ? 0.8 : 2.6;
    let minX = Math.min(a.rag.homeX, b.rag.homeX) - side;
    let maxX = Math.max(a.rag.homeX, b.rag.homeX) + side;
    let minY = Math.min(a.rag.footY - 2.6 * a.rag.scale, b.rag.footY - 2.6 * b.rag.scale) - 0.6;
    let maxY = Math.max(a.rag.footY, b.rag.footY) + 1.4;
    // show the lava / icy lake / ground when it is close below the fighters
    const floor = duel.level.floor;
    if (floor.kind !== 'abyss' && floor.kind !== 'courtyard' && floor.y - maxY < 6) maxY = Math.max(maxY, floor.y + 0.9);
    // keep floating bonuses (crate + balloons) in view, below the HUD
    for (const b of duel.bonuses) {
      if (!b.alive) continue;
      minY = Math.min(minY, b.y - 1.5);
    }
    for (const p of duel.projectiles) {
      minX = Math.min(minX, p.f.x - (portrait ? 0.6 : 1.5));
      maxX = Math.max(maxX, p.f.x + (portrait ? 0.6 : 1.5));
      minY = Math.min(minY, Math.max(p.f.y - 1.5, maxY - 30));
    }
    const usableH = view.h - view.padTop - view.padBottom;
    const zoom = clamp(Math.min(view.w / (maxX - minX), usableH / (maxY - minY)), 6 * view.dpr, 90 * view.dpr);
    const viewHWorld = usableH / zoom;
    const extra = Math.max(0, viewHWorld - (maxY - minY));
    // spare vertical room: landscape keeps it mostly above (sky for the arcs);
    // portrait puts more of it below (platforms, ground) so the sky isn't empty
    let cy = (minY + maxY) / 2 - extra * 0.28;
    if (portrait) {
      // width-limited: centre the fighters themselves a little above the middle,
      // showing their platforms below rather than a tall empty sky
      const top = Math.min(a.rag.footY - 2.4 * a.rag.scale, b.rag.footY - 2.4 * b.rag.scale);
      const feet = Math.max(a.rag.footY, b.rag.footY);
      cy = (top + feet) / 2 + viewHWorld * 0.07;
      // keep a high arc in view
      for (const p of duel.projectiles) cy = Math.min(cy, p.f.y - 1 + viewHWorld / 2);
    } else {
      // never show far below the floor
      const bottom = cy + viewHWorld / 2;
      const floorLimit = duel.level.floor.y + 3.5;
      if (bottom > floorLimit) cy -= bottom - floorLimit;
    }
    const cx = (minX + maxX) / 2;
    // centre of the usable band
    const offsetY = (view.padTop - view.padBottom) / 2 / zoom;
    const ty = cy - offsetY;
    if (!this.init || snap) {
      this.x = cx;
      this.y = ty;
      this.zoom = zoom;
      this.init = true;
      return;
    }
    // kill cam: follow the lethal shot, then the knocked-out fighter, zoomed in
    const kc = duel.killCam;
    if (kc) {
      const victim = duel.fighters[kc.victim];
      const proj = kc.proj && kc.proj.alive ? kc.proj : null;
      const t = proj ? { x: proj.f.x, y: proj.f.y } : victim.center();
      const fy = Math.min(t.y, duel.level.floor.y - 1);
      const kz = Math.min(zoom * 1.9, 90 * view.dpr);
      const kk = damp(5, dt);
      this.x = lerp(this.x, t.x, kk);
      this.y = lerp(this.y, fy, kk);
      this.zoom = lerp(this.zoom, kz, damp(3, dt));
      return;
    }
    const k = damp(3.2, dt);
    this.x = lerp(this.x, cx, k);
    this.y = lerp(this.y, ty, k);
    this.zoom = lerp(this.zoom, zoom, damp(2.4, dt));
  }
}

/** Decorations hanging on / sitting over solids are drawn after them. */
const OVER_SOLIDS = new Set<Deco['kind']>(['canopy', 'banner', 'torch', 'icicles', 'snowman', 'flag']);

interface SolidCache {
  cracks: Array<[number, number, number, number]>;
  bricks: boolean;
}

export class SceneRenderer {
  readonly fx = new Fx();
  readonly cam = new Camera();
  private backdrop: Backdrop;
  private theme: Theme;
  private cache = new Map<number, SolidCache>();
  private ambientT = 0;
  private birds: Array<{ x: number; y: number; vx: number; ph: number; s: number }> = [];
  time = 0;
  /** Hide aim UI (cover renders). */
  clean = false;
  /** Tutorial: the glowing path of a good first shot. */
  ghost: Array<{ x: number; y: number }> | null = null;
  /** Tutorial: show the whole aim preview instead of its start. */
  fullPreview = false;
  /** Comic speech bubbles above the fighters. */
  private bubbles: Array<{ side: 0 | 1; text: string; t: number; life: number }> = [];

  /** Removes all speech bubbles (cover renders: title only). */
  clearBubbles(): void {
    this.bubbles = [];
  }

  /** A short comic word bubble above a fighter. */
  say(side: 0 | 1, text: string, life = 1.6): void {
    this.bubbles = this.bubbles.filter((b) => b.side !== side);
    this.bubbles.push({ side, text, t: 0, life });
  }

  constructor(private duel: Duel) {
    this.backdrop = new Backdrop(duel.level.world.id, duel.level.seed % 1000);
    this.theme = this.backdrop.theme;
    const rng = new Rng(duel.level.seed);
    if (duel.level.world.id === 'forest') {
      for (let i = 0; i < 5; i++) this.birds.push({ x: rng.range(-0.2, 1.2), y: rng.range(0.08, 0.3), vx: rng.range(0.025, 0.05), ph: rng.range(0, 6), s: rng.range(0.7, 1.1) });
    }
  }

  setDuel(duel: Duel): void {
    this.duel = duel;
    this.backdrop = new Backdrop(duel.level.world.id, duel.level.seed % 1000);
    this.theme = this.backdrop.theme;
    this.cache.clear();
    this.fx.list = [];
    this.ghost = null;
    this.fullPreview = false;
    this.bubbles = [];
  }

  toScreen = (x: number, y: number, view: View): [number, number] => [
    (x - this.cam.x) * this.cam.zoom + view.w / 2,
    (y - this.cam.y) * this.cam.zoom + view.h / 2,
  ];

  /** `realDt` (unscaled by slow motion) drives the camera so the kill cam zooms in promptly. */
  update(dt: number, view: View, realDt = dt): void {
    this.time += dt;
    this.cam.update(this.duel, view, realDt);
    this.fx.update(dt);
    this.ambient(dt, view);
    for (const b of this.bubbles) b.t += dt;
    this.bubbles = this.bubbles.filter((b) => b.t < b.life);
    // smoke from a fighter hit by a fire arrow, flames on fire arrows
    for (const f of this.duel.fighters) {
      if (f.burnT <= 0 || Math.random() > dt * 14) continue;
      const c = f.rag.head.getPosition();
      this.fx.add({ kind: 'puff', x: c.x + (Math.random() - 0.5) * 0.3, y: c.y - 0.2, vy: -1.2, vx: (Math.random() - 0.5) * 0.4, size: 0.12, color: 'rgba(90,80,85,0.55)', life: 0.9, drag: 1 });
    }
    for (const p of this.duel.projectiles) {
      if (!p.fire || Math.random() > dt * 40) continue;
      this.fx.add({ kind: 'ember', x: p.f.x, y: p.f.y, vx: (Math.random() - 0.5) * 0.8, vy: -0.6, size: 0.1, color: Math.random() < 0.5 ? '#ffb347' : '#ff6a1f', life: 0.45 });
    }
  }

  draw(ctx: Ctx, view: View): void {
    const { cam, duel } = this;
    const z = cam.zoom;
    const sh = duel.shake;
    const sx = sh > 0 ? Math.sin(this.time * 70) * sh * 6 * view.dpr : 0;
    const sy = sh > 0 ? Math.cos(this.time * 53) * sh * 5 * view.dpr : 0;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.backdrop.resize(view.w, view.h);
    const floorScreen = (duel.level.floor.y - cam.y) * z + view.h / 2;
    this.backdrop.draw(ctx, cam.x, z, floorScreen, this.time);
    this.drawBirds(ctx, view);

    ctx.setTransform(z, 0, 0, z, view.w / 2 - cam.x * z + sx, view.h / 2 - cam.y * z + sy);
    const px = 1 / z;
    const lw = Math.max(view.dpr * 1.6, 0.045 * z) * px;
    const left = cam.x - view.w / 2 / z - 1;
    const right = cam.x + view.w / 2 / z + 1;
    const bottom = cam.y + view.h / 2 / z + 1;

    this.drawFloor(ctx, left, right, bottom, lw, false);
    for (const c of duel.chunks) {
      if (c.shake > 0) continue;
      ctx.save();
      ctx.translate(0, c.y);
      this.drawSolid(ctx, c.solid, lw);
      ctx.restore();
    }
    for (const d of duel.level.decos) if (!d.front && !OVER_SOLIDS.has(d.kind)) this.drawDeco(ctx, d, lw);
    for (const s of duel.solids) {
      const ch = duel.chunks.find((c) => c.solid === s);
      if (ch) {
        ctx.save();
        ctx.translate(Math.sin(this.time * 60) * 0.03, 0);
        this.drawSolid(ctx, s, lw, true);
        ctx.restore();
      } else this.drawSolid(ctx, s, lw);
    }
    for (const d of duel.level.decos) if (!d.front && OVER_SOLIDS.has(d.kind)) this.drawDeco(ctx, d, lw);
    for (const s of duel.stuckWorld) drawStuck(ctx, s, s.x, s.y, s.a, lw, this.time);

    const aimPhase = duel.phase === 'aim';
    if (this.ghost && !this.clean) this.drawGhost(ctx, this.ghost, px);
    for (const f of duel.fighters) drawFighter(ctx, f, lw, this.time, (aimPhase && duel.current === f) || f.showAim);
    if (!this.clean && aimPhase && duel.current.aim) this.drawAim(ctx, duel.current, lw, px);
    if (!this.clean && aimPhase) this.drawTurnMarker(ctx, duel.current, lw);

    for (const b of duel.bonuses) if (b.alive) this.drawBonus(ctx, b.def.kind, b.def.reward, b.x, b.y, lw);
    for (const p of duel.projectiles) {
      this.drawTrail(ctx, p.trail, p.fire ? 'meteor' : p.w.look, lw);
      ctx.save();
      ctx.translate(p.f.x, p.f.y);
      ctx.rotate(p.angle);
      drawItem(ctx, p.w.look, p.w.size, lw, this.time);
      ctx.restore();
    }
    for (const d of duel.debris) {
      ctx.save();
      ctx.globalAlpha = clamp(d.life * 2, 0, 1);
      ctx.translate(d.x, d.y);
      ctx.rotate(d.a);
      drawItem(ctx, d.look, d.size, lw, this.time);
      ctx.restore();
    }
    for (const d of duel.level.decos) if (d.front) this.drawDeco(ctx, d, lw);
    this.drawFloor(ctx, left, right, bottom, lw, true);
    this.fx.draw(ctx, px);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (duel.level.world.id === 'desert') this.heatShimmer(ctx, view, floorScreen);
    if (duel.level.world.id === 'volcano') {
      const g = ctx.createLinearGradient(0, view.h * 0.5, 0, view.h);
      g.addColorStop(0, 'rgba(255,90,30,0)');
      g.addColorStop(1, `rgba(255,90,30,${0.16 + Math.sin(this.time * 2) * 0.04})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, view.h * 0.5, view.w, view.h * 0.5);
    }
    // vignette
    const vg = ctx.createRadialGradient(view.w / 2, view.h / 2, Math.min(view.w, view.h) * 0.45, view.w / 2, view.h / 2, Math.max(view.w, view.h) * 0.78);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(10,6,20,0.28)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, view.w, view.h);
    this.fx.drawTexts(ctx, (x, y) => this.toScreen(x, y, view), z, view.dpr);
    this.drawBubbles(ctx, view);
  }

  private drawBubbles(ctx: Ctx, view: View): void {
    const d = view.dpr;
    ctx.font = `700 ${Math.round(15 * d)}px Fredoka, "Trebuchet MS", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const b of this.bubbles) {
      const f = this.duel.fighters[b.side];
      if (f.fallen) continue;
      const h = f.rag.head.getPosition();
      const [sx, sy0] = this.toScreen(h.x, h.y - 0.55 * f.rag.scale, view);
      const pop = Math.min(1, b.t * 8);
      const fade = Math.min(1, (b.life - b.t) * 4);
      const w = ctx.measureText(b.text).width + 18 * d;
      const hh = 28 * d;
      const x = Math.max(w / 2 + 4 * d, Math.min(view.w - w / 2 - 4 * d, sx + (b.side === 0 ? 1 : -1) * 18 * d));
      const y = Math.max(hh + 70 * d, sy0 - 22 * d);
      ctx.save();
      ctx.globalAlpha = fade;
      ctx.translate(x, y);
      ctx.scale(pop, pop);
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = 2.5 * d;
      ctx.beginPath();
      // roundRect is missing on older Safari: plain rectangle there
      if (typeof ctx.roundRect === 'function') ctx.roundRect(-w / 2, -hh / 2, w, hh, 10 * d);
      else ctx.rect(-w / 2, -hh / 2, w, hh);
      ctx.moveTo(-6 * d * (b.side === 0 ? 1 : -1), hh / 2);
      ctx.lineTo(-14 * d * (b.side === 0 ? 1 : -1), hh / 2 + 10 * d);
      ctx.lineTo(4 * d * (b.side === 0 ? 1 : -1), hh / 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(-14 * d, hh / 2 - 3 * d, 22 * d, 4 * d);
      ctx.fillStyle = OUTLINE;
      ctx.fillText(b.text, 0, 1 * d);
      ctx.restore();
    }
  }

  /** Floating bonus: a balloon, a crate held by two balloons, or a (golden) bird. */
  drawBonus(ctx: Ctx, kind: string, reward: string, x: number, y: number, lw: number): void {
    const col: Record<string, string> = { coins: '#ffd23d', fire: '#ff6a1f', triple: '#3cc4ff', shield: '#7be0ff', heal: '#ff6fb5' };
    const c = col[reward] ?? '#ffd23d';
    const t = this.time;
    ctx.save();
    ctx.translate(x, y);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    const balloon = (bx: number, by: number, r: number, fill: string) => {
      ctx.strokeStyle = 'rgba(30,26,43,0.7)';
      ctx.lineWidth = lw * 0.6;
      ctx.beginPath();
      ctx.moveTo(bx, by + r);
      ctx.quadraticCurveTo(bx + Math.sin(t * 3) * 0.08, by + r + 0.3, bx, by + r + 0.55);
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(bx, by, r * 0.85, r, 0, 0, Math.PI * 2);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = lw;
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.beginPath();
      ctx.ellipse(bx - r * 0.3, by - r * 0.35, r * 0.18, r * 0.3, -0.5, 0, Math.PI * 2);
      ctx.fill();
    };
    if (kind === 'balloon') {
      balloon(0, -0.1, 0.36, c);
      this.drawRewardIcon(ctx, reward, 0, -0.12, 0.17, lw);
    } else if (kind === 'crate') {
      balloon(-0.28, -0.85, 0.26, c);
      balloon(0.28, -0.9, 0.26, c);
      ctx.fillStyle = '#c98b4a';
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = lw;
      ctx.beginPath();
      ctx.rect(-0.34, -0.3, 0.68, 0.6);
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = '#8a5a3b';
      ctx.lineWidth = lw * 0.9;
      line(ctx, -0.3, -0.26, 0.3, 0.26);
      line(ctx, -0.3, 0.26, 0.3, -0.26);
      ctx.fillStyle = '#fff6dd';
      ctx.beginPath();
      ctx.arc(0, 0, 0.17, 0, Math.PI * 2);
      ctx.fill();
      this.drawRewardIcon(ctx, reward, 0, 0, 0.13, lw);
    } else {
      // a friendly golden bird carrying a little bag
      const flap = Math.sin(t * 14) * 0.25;
      const dir = Math.cos(t * 0.7) >= 0 ? 1 : -1;
      ctx.scale(dir, 1);
      ctx.fillStyle = '#ffd23d';
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = lw;
      ctx.beginPath();
      ctx.ellipse(0, 0, 0.3, 0.2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0.26, -0.12, 0.13, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#ff8a2a';
      ctx.beginPath();
      ctx.moveTo(0.37, -0.12);
      ctx.lineTo(0.5, -0.08);
      ctx.lineTo(0.37, -0.04);
      ctx.fill();
      ctx.fillStyle = OUTLINE;
      ctx.beginPath();
      ctx.arc(0.29, -0.15, 0.03, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffe98a';
      ctx.beginPath();
      ctx.moveTo(-0.05, -0.05);
      ctx.lineTo(-0.25, -0.3 - flap);
      ctx.lineTo(0.12, -0.08);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.scale(dir, 1);
      ctx.fillStyle = '#fff6dd';
      ctx.beginPath();
      ctx.arc(0, 0.32, 0.14, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = OUTLINE;
      ctx.stroke();
      this.drawRewardIcon(ctx, reward, 0, 0.32, 0.1, lw);
    }
    ctx.restore();
  }

  /** Small icon for a reward: coin, flame, triple arrows, shield, heart. */
  drawRewardIcon(ctx: Ctx, reward: string, x: number, y: number, r: number, lw: number): void {
    ctx.save();
    ctx.translate(x, y);
    ctx.lineWidth = lw * 0.7;
    ctx.strokeStyle = OUTLINE;
    switch (reward) {
      case 'coins':
        ctx.fillStyle = '#ffc21d';
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#fff3a0';
        ctx.fillRect(-r * 0.15, -r * 0.55, r * 0.3, r * 1.1);
        break;
      case 'fire':
        ctx.fillStyle = '#ff6a1f';
        ctx.beginPath();
        ctx.moveTo(0, -r * 1.2);
        ctx.quadraticCurveTo(r * 1.1, -r * 0.1, 0, r);
        ctx.quadraticCurveTo(-r * 1.1, -r * 0.1, 0, -r * 1.2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#ffd23d';
        ctx.beginPath();
        ctx.ellipse(0, r * 0.3, r * 0.35, r * 0.5, 0, 0, Math.PI * 2);
        ctx.fill();
        break;
      case 'triple':
        ctx.strokeStyle = '#1e5fa8';
        ctx.lineWidth = r * 0.28;
        // three arrows fanning out
        for (const a of [-0.5, 0, 0.5]) {
          const ex = -r + Math.cos(a) * r * 2;
          const ey = Math.sin(a) * r * 2;
          ctx.beginPath();
          ctx.moveTo(-r, 0);
          ctx.lineTo(ex, ey);
          ctx.stroke();
        }
        break;
      case 'shield':
        ctx.fillStyle = '#7be0ff';
        ctx.beginPath();
        ctx.moveTo(0, -r);
        ctx.lineTo(r * 0.9, -r * 0.6);
        ctx.quadraticCurveTo(r * 0.8, r * 0.6, 0, r);
        ctx.quadraticCurveTo(-r * 0.8, r * 0.6, -r * 0.9, -r * 0.6);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        break;
      default:
        ctx.fillStyle = '#ff4d6d';
        ctx.beginPath();
        ctx.moveTo(0, r * 0.9);
        ctx.bezierCurveTo(-r * 1.4, -r * 0.1, -r * 0.6, -r * 1.2, 0, -r * 0.4);
        ctx.bezierCurveTo(r * 0.6, -r * 1.2, r * 1.4, -r * 0.1, 0, r * 0.9);
        ctx.fill();
        ctx.stroke();
    }
    ctx.restore();
  }

  // ───────────── floor ─────────────

  private drawFloor(ctx: Ctx, left: number, right: number, bottom: number, lw: number, front: boolean): void {
    const L = this.duel.level;
    const y = L.floor.y;
    const th = this.theme;
    const t = this.time;
    if (bottom < y) return;
    switch (L.floor.kind) {
      case 'lava': {
        if (!front) {
          const g = ctx.createLinearGradient(0, y - 0.2, 0, y + 3);
          g.addColorStop(0, '#ffd04a');
          g.addColorStop(0.25, '#ff7a1f');
          g.addColorStop(1, '#a8231a');
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.moveTo(left, bottom);
          for (let x = left; x <= right; x += 0.5) ctx.lineTo(x, y + Math.sin(x * 0.9 + t * 1.6) * 0.12 + Math.sin(x * 2.3 - t) * 0.05);
          ctx.lineTo(right, bottom);
          ctx.closePath();
          ctx.fill();
          ctx.strokeStyle = '#fff1a0';
          ctx.lineWidth = lw * 1.4;
          ctx.stroke();
          // crust plates
          ctx.fillStyle = 'rgba(90,30,20,0.5)';
          const rng = new Rng(4);
          for (let i = 0; i < 26; i++) {
            const x = left + ((rng.next() * (right - left) + t * 0.15 * (i % 3)) % (right - left));
            ctx.beginPath();
            ctx.ellipse(x, y + 0.5 + rng.next() * 2, 0.5 + rng.next() * 0.6, 0.1, 0, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        break;
      }
      case 'lake': {
        if (front) break;
        const g = ctx.createLinearGradient(0, y, 0, y + 4);
        g.addColorStop(0, '#bfe6ff');
        g.addColorStop(1, '#4f86c2');
        ctx.fillStyle = g;
        ctx.fillRect(left, y, right - left, bottom - y);
        ctx.strokeStyle = 'rgba(255,255,255,0.6)';
        ctx.lineWidth = lw * 0.8;
        const rng = new Rng(8);
        for (let i = 0; i < 18; i++) {
          const x = left + rng.next() * (right - left);
          const yy = y + 0.3 + rng.next() * 3;
          line(ctx, x, yy, x + 0.6 + rng.next(), yy + (rng.next() - 0.5) * 0.3);
        }
        // shimmer highlights
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        for (let x = Math.floor(left); x < right; x += 3) ctx.fillRect(x + ((t * 0.4 + x) % 3), y + 0.08, 0.8, 0.05);
        ctx.strokeStyle = OUTLINE;
        ctx.lineWidth = lw;
        line(ctx, left, y, right, y);
        break;
      }
      case 'abyss': {
        if (front) {
          const g = ctx.createLinearGradient(0, y - 8, 0, y);
          g.addColorStop(0, 'rgba(235,245,255,0)');
          g.addColorStop(1, 'rgba(235,245,255,0.95)');
          ctx.fillStyle = g;
          ctx.fillRect(left, y - 8, right - left, bottom - y + 8);
          ctx.fillStyle = 'rgba(255,255,255,0.8)';
          for (let x = Math.floor(left / 3) * 3; x < right; x += 3) {
            ctx.beginPath();
            ctx.arc(x + ((t * 0.3) % 3), y - 1 + Math.sin(x + t * 0.5) * 0.3, 1.4, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        break;
      }
      default: {
        if (front) break;
        const top = L.floor.kind === 'courtyard' ? '#6f9a48' : L.floor.kind === 'sandplain' ? th.floor : th.floor;
        const g = ctx.createLinearGradient(0, y, 0, y + 3);
        g.addColorStop(0, top);
        g.addColorStop(1, th.floorDark);
        ctx.fillStyle = g;
        ctx.fillRect(left, y, right - left, bottom - y);
        ctx.strokeStyle = OUTLINE;
        ctx.lineWidth = lw;
        line(ctx, left, y, right, y);
        if (L.floor.kind === 'sandplain') {
          ctx.strokeStyle = 'rgba(160,100,40,0.35)';
          for (let i = 0; i < 6; i++) {
            ctx.beginPath();
            for (let x = left; x <= right; x += 0.6) ctx.lineTo(x, y + 0.4 + i * 0.5 + Math.sin(x * 0.8 + i) * 0.08);
            ctx.stroke();
          }
        }
      }
    }
  }

  // ───────────── solids ─────────────

  private solidCache(s: Solid): SolidCache {
    let c = this.cache.get(s.id);
    if (c) return c;
    const rng = new Rng(s.id * 97 + this.duel.level.seed);
    const cracks: SolidCache['cracks'] = [];
    if (s.shape.kind === 'poly') {
      const xs = s.shape.pts.map((p) => p.x);
      const ys = s.shape.pts.map((p) => p.y);
      const x0 = Math.min(...xs);
      const x1 = Math.max(...xs);
      const y0 = Math.min(...ys);
      const y1 = Math.min(Math.max(...ys), y0 + 14);
      const n = Math.round((x1 - x0) * (y1 - y0) * 0.5) + 2;
      for (let i = 0; i < Math.min(n, 60); i++) {
        const x = rng.range(x0, x1);
        const y = rng.range(y0 + 0.3, y1);
        cracks.push([x, y, x + rng.range(-0.4, 0.4), y + rng.range(0.15, 0.5)]);
      }
    }
    c = { cracks, bricks: s.mat === 'stone' };
    this.cache.set(s.id, c);
    return c;
  }

  private pathSolid(ctx: Ctx, s: Solid): void {
    ctx.beginPath();
    if (s.shape.kind === 'circle') ctx.arc(s.shape.c.x, s.shape.c.y, s.shape.r, 0, Math.PI * 2);
    else {
      const pts = s.shape.pts;
      ctx.moveTo((pts[0] as { x: number }).x, (pts[0] as { y: number }).y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo((pts[i] as { x: number }).x, (pts[i] as { y: number }).y);
      ctx.closePath();
    }
  }

  private drawSolid(ctx: Ctx, s: Solid, lw: number, shaking = false): void {
    const th = this.theme;
    const c = this.solidCache(s);
    const b = boundsOf(s);
    const grad = (a: string, z: string) => {
      const g = ctx.createLinearGradient(b.x0, b.y0, b.x1, Math.min(b.y1, b.y0 + 6));
      g.addColorStop(0, a);
      g.addColorStop(1, z);
      return g;
    };
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    this.pathSolid(ctx, s);
    switch (s.mat) {
      case 'grass':
        ctx.fillStyle = grad(th.body, th.bodyDark);
        break;
      case 'wood':
        ctx.fillStyle = grad('#9a6a43', '#6a4429');
        break;
      case 'stone':
        ctx.fillStyle = grad(th.top, th.bodyDark);
        break;
      case 'rock':
        ctx.fillStyle = grad('#9d968a', '#5b5650');
        break;
      case 'sand':
        ctx.fillStyle = grad(th.top, th.bodyDark);
        break;
      case 'sandstone':
        ctx.fillStyle = grad('#e9a463', '#a8602e');
        break;
      case 'cactus':
        ctx.fillStyle = grad('#5cbf5a', '#2f8a43');
        break;
      case 'ice':
        ctx.fillStyle = grad('rgba(225,247,255,0.97)', 'rgba(110,185,230,0.97)');
        break;
      case 'snow':
        ctx.fillStyle = '#f7fbff';
        break;
      case 'basalt':
        ctx.fillStyle = grad('#4d3f42', '#221a1c');
        break;
    }
    ctx.fill();
    // texture, clipped to the shape
    ctx.save();
    this.pathSolid(ctx, s);
    ctx.clip();
    this.texture(ctx, s, c, b, lw, shaking);
    ctx.restore();
    this.pathSolid(ctx, s);
    ctx.strokeStyle = s.mat === 'ice' ? '#2b5f8a' : this.theme.outline;
    ctx.lineWidth = lw;
    ctx.stroke();
    this.surface(ctx, s, lw);
  }

  private texture(ctx: Ctx, s: Solid, c: SolidCache, b: Bounds, lw: number, shaking: boolean): void {
    switch (s.mat) {
      case 'stone': {
        ctx.strokeStyle = 'rgba(40,36,50,0.32)';
        ctx.lineWidth = lw * 0.7;
        const bh = 0.42;
        const bw = 0.8;
        ctx.beginPath();
        for (let y = b.y0 + bh, row = 0; y < Math.min(b.y1, b.y0 + 16); y += bh, row++) {
          ctx.moveTo(b.x0, y);
          ctx.lineTo(b.x1, y);
          for (let x = b.x0 + (row % 2 ? bw / 2 : 0); x < b.x1; x += bw) {
            ctx.moveTo(x, y - bh);
            ctx.lineTo(x, y);
          }
        }
        ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.12)';
        ctx.fillRect(b.x0, b.y0, (b.x1 - b.x0) * 0.25, b.y1 - b.y0);
        break;
      }
      case 'wood': {
        ctx.strokeStyle = 'rgba(60,35,20,0.4)';
        ctx.lineWidth = lw * 0.6;
        ctx.beginPath();
        for (const [x0, y0, , y1] of c.cracks) {
          ctx.moveTo(x0, y0);
          ctx.lineTo(x0 + (y1 - y0) * 0.1, y1 + 0.3);
        }
        ctx.stroke();
        break;
      }
      case 'rock':
      case 'basalt': {
        ctx.strokeStyle = s.mat === 'basalt' ? `rgba(255,${110 + (shaking ? 80 : 0)},40,${shaking ? 0.95 : 0.55})` : 'rgba(40,36,30,0.35)';
        ctx.lineWidth = lw * (s.mat === 'basalt' ? 0.9 : 0.7);
        ctx.beginPath();
        for (const [x0, y0, x1, y1] of c.cracks) {
          ctx.moveTo(x0, y0);
          ctx.lineTo(x1, y1);
          ctx.lineTo(x1 + (x1 - x0) * 0.5, y1 + 0.2);
        }
        ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.08)';
        ctx.fillRect(b.x0, b.y0, (b.x1 - b.x0) * 0.3, b.y1 - b.y0);
        break;
      }
      case 'sand': {
        ctx.strokeStyle = 'rgba(170,110,45,0.35)';
        ctx.lineWidth = lw * 0.7;
        for (let i = 0; i < 8; i++) {
          ctx.beginPath();
          const yy = b.y0 + 0.5 + i * 0.45;
          for (let x = b.x0; x <= b.x1; x += 0.4) ctx.lineTo(x, yy + Math.sin(x * 1.4 + i) * 0.07);
          ctx.stroke();
        }
        break;
      }
      case 'sandstone': {
        ctx.fillStyle = 'rgba(120,60,30,0.22)';
        for (let y = b.y0 + 0.5; y < b.y1; y += 0.9) ctx.fillRect(b.x0, y, b.x1 - b.x0, 0.28);
        break;
      }
      case 'cactus': {
        ctx.strokeStyle = 'rgba(30,90,40,0.6)';
        ctx.lineWidth = lw * 0.7;
        const cx = (b.x0 + b.x1) / 2;
        const w = b.x1 - b.x0;
        if (b.y1 - b.y0 > w) {
          ctx.beginPath();
          ctx.moveTo(cx - w * 0.18, b.y0);
          ctx.lineTo(cx - w * 0.18, b.y1);
          ctx.moveTo(cx + w * 0.18, b.y0);
          ctx.lineTo(cx + w * 0.18, b.y1);
          ctx.stroke();
        }
        ctx.fillStyle = '#fff6c8';
        for (const [x, y] of c.cracks.slice(0, 10)) ctx.fillRect(x, y, 0.035, 0.035);
        break;
      }
      case 'ice': {
        ctx.strokeStyle = 'rgba(255,255,255,0.7)';
        ctx.lineWidth = lw * 0.9;
        ctx.beginPath();
        for (const [x0, y0, x1, y1] of c.cracks.slice(0, 8)) {
          ctx.moveTo(x0, y0);
          ctx.lineTo(x1, y1);
        }
        ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.beginPath();
        ctx.moveTo(b.x0 + 0.2, b.y0);
        ctx.lineTo(b.x0 + 0.6, b.y0);
        ctx.lineTo(b.x0 + 0.1, b.y1);
        ctx.lineTo(b.x0 - 0.3, b.y1);
        ctx.fill();
        break;
      }
      case 'snow': {
        ctx.fillStyle = 'rgba(150,190,230,0.45)';
        if (s.shape.kind === 'circle') {
          ctx.beginPath();
          ctx.arc(s.shape.c.x + s.shape.r * 0.25, s.shape.c.y + s.shape.r * 0.25, s.shape.r * 0.85, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      }
      case 'grass': {
        ctx.fillStyle = 'rgba(50,25,10,0.25)';
        for (const [x, y] of c.cracks) {
          ctx.beginPath();
          ctx.ellipse(x, y + 0.4, 0.14, 0.08, 0, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      }
    }
  }

  /** Grass / snow caps on upward-facing edges. */
  private surface(ctx: Ctx, s: Solid, lw: number): void {
    if (s.shape.kind !== 'poly') return;
    const cap = s.mat === 'grass' ? this.theme.top : s.mat === 'ice' || (s.mat === 'rock' && this.duel.level.world.id === 'snow') ? '#ffffff' : s.mat === 'rock' ? '#8fbf5a' : null;
    if (!cap) return;
    const pts = s.shape.pts;
    ctx.lineCap = 'round';
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i] as { x: number; y: number };
      const b = pts[(i + 1) % pts.length] as { x: number; y: number };
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const l = Math.hypot(dx, dy);
      if (l < 0.05) continue;
      // outward normal must point up (either winding)
      const ny1 = -dx / l;
      const midY = (a.y + b.y) / 2;
      const cy = boundsOf(s).y0 + (boundsOf(s).y1 - boundsOf(s).y0) / 2;
      const up = Math.abs(dy) / l < 0.75 && midY < cy && Math.abs(ny1) > 0.5;
      if (!up) continue;
      const thick = s.mat === 'grass' ? 0.28 : 0.2;
      ctx.strokeStyle = this.theme.outline;
      ctx.lineWidth = thick + lw * 2;
      line(ctx, a.x, a.y + thick * 0.3, b.x, b.y + thick * 0.3);
      ctx.strokeStyle = cap;
      ctx.lineWidth = thick;
      line(ctx, a.x, a.y + thick * 0.3, b.x, b.y + thick * 0.3);
      if (s.mat === 'grass') {
        // little scallops + blades
        ctx.fillStyle = cap;
        const n = Math.floor(l / 0.35);
        for (let k = 0; k <= n; k++) {
          const t = k / Math.max(1, n);
          ctx.beginPath();
          ctx.arc(a.x + dx * t, a.y + dy * t + thick * 0.55, 0.11, 0, Math.PI);
          ctx.fill();
        }
        ctx.strokeStyle = this.theme.accent;
        ctx.lineWidth = lw * 0.7;
        for (let k = 0; k < n; k += 2) {
          const t = (k + 0.5) / Math.max(1, n);
          line(ctx, a.x + dx * t, a.y + dy * t + 0.02, a.x + dx * t + 0.04, a.y + dy * t - 0.12);
        }
      }
    }
  }

  // ───────────── decorations ─────────────

  private drawDeco(ctx: Ctx, d: Deco, lw: number): void {
    const t = this.time;
    const s = d.s;
    ctx.save();
    ctx.translate(d.x, d.y);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    const out = (fill: string) => {
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.strokeStyle = this.theme.outline;
      ctx.lineWidth = lw;
      ctx.stroke();
    };
    const rng = new Rng(d.seed);
    switch (d.kind) {
      case 'canopy': {
        const sway = Math.sin(t * 1.2 + d.seed) * 0.05;
        ctx.translate(sway, 0);
        const blobs: Array<[number, number, number]> = [];
        for (let i = 0; i < 7; i++) blobs.push([rng.range(-0.9, 0.9) * s, rng.range(-0.55, 0.45) * s, rng.range(0.45, 0.7) * s]);
        ctx.beginPath();
        for (const [x, y, r] of blobs) {
          ctx.moveTo(x + r + lw, y);
          ctx.arc(x, y, r + lw, 0, Math.PI * 2);
        }
        ctx.fillStyle = this.theme.outline;
        ctx.fill();
        ctx.beginPath();
        for (const [x, y, r] of blobs) {
          ctx.moveTo(x + r, y);
          ctx.arc(x, y, r, 0, Math.PI * 2);
        }
        ctx.fillStyle = '#3f9a4a';
        ctx.fill();
        ctx.beginPath();
        for (const [x, y, r] of blobs) {
          ctx.moveTo(x + r * 0.6, y - r * 0.25);
          ctx.arc(x - r * 0.15, y - r * 0.25, r * 0.6, 0, Math.PI * 2);
        }
        ctx.fillStyle = '#5cbf5a';
        ctx.fill();
        ctx.fillStyle = '#8fdc6a';
        for (const [x, y, r] of blobs.slice(0, 4)) {
          ctx.beginPath();
          ctx.arc(x - r * 0.35, y - r * 0.45, r * 0.18, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      }
      case 'bush': {
        // one merged silhouette: outline pass, then fill, then highlights
        const blobs = [-1.5, -0.5, 0.5, 1.5].map((i) => [i * 0.42 * s, -0.22 * s - (Math.abs(i) < 1 ? 0.12 * s : 0), (Math.abs(i) < 1 ? 0.46 : 0.38) * s] as const);
        ctx.beginPath();
        for (const [x, y, r] of blobs) {
          ctx.moveTo(x + r + lw, y);
          ctx.arc(x, y, r + lw, 0, Math.PI * 2);
        }
        ctx.fillStyle = this.theme.outline;
        ctx.fill();
        ctx.beginPath();
        for (const [x, y, r] of blobs) {
          ctx.moveTo(x + r, y);
          ctx.arc(x, y, r, 0, Math.PI * 2);
        }
        ctx.fillStyle = '#3d8a45';
        ctx.fill();
        ctx.fillStyle = '#56a85a';
        for (const [x, y, r] of blobs) {
          ctx.beginPath();
          ctx.arc(x - r * 0.2, y - r * 0.25, r * 0.5, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      }
      case 'flowers': {
        for (let i = 0; i < 4; i++) {
          const x = (i - 1.5) * 0.25 * s;
          const h = rng.range(0.2, 0.35) * s;
          ctx.strokeStyle = '#2f7a35';
          ctx.lineWidth = lw * 0.8;
          line(ctx, x, 0, x, -h);
          ctx.fillStyle = rng.pick(['#ff6fb5', '#ffd23d', '#ffffff', '#9b7bff']);
          star(ctx, x, -h, 0.07 * s, 0.035 * s, 5, t * 0.5);
          ctx.fill();
        }
        break;
      }
      case 'mushroom': {
        ctx.beginPath();
        ctx.rect(-0.06 * s, -0.22 * s, 0.12 * s, 0.22 * s);
        out('#fff1dc');
        ctx.beginPath();
        ctx.arc(0, -0.22 * s, 0.2 * s, Math.PI, 0);
        ctx.closePath();
        out('#ff4d4d');
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(-0.07 * s, -0.3 * s, 0.035 * s, 0, Math.PI * 2);
        ctx.arc(0.08 * s, -0.27 * s, 0.03 * s, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'grass': {
        ctx.strokeStyle = '#3c8a3a';
        ctx.lineWidth = lw * 0.9;
        for (let i = 0; i < 6; i++) {
          const x = (i - 3) * 0.08 * s;
          line(ctx, x, 0.05, x + Math.sin(t * 2 + i) * 0.04, -0.22 * s);
        }
        break;
      }
      case 'banner': {
        const w = 0.7 * s;
        const h = 1.5 * s;
        const wave = Math.sin(t * 2 + d.seed) * 0.06;
        ctx.beginPath();
        ctx.moveTo(-w / 2, 0);
        ctx.lineTo(w / 2, 0);
        ctx.lineTo(w / 2 + wave, h);
        ctx.lineTo(wave, h - 0.25 * s);
        ctx.lineTo(-w / 2 + wave, h);
        ctx.closePath();
        out(d.seed % 2 ? '#d8473f' : '#3f6ad8');
        ctx.fillStyle = '#ffd23d';
        star(ctx, wave * 0.5, h * 0.4, 0.18 * s, 0.08 * s, 5);
        ctx.fill();
        ctx.strokeStyle = '#ffd23d';
        ctx.lineWidth = lw;
        line(ctx, -w / 2 - 0.05, 0, w / 2 + 0.05, 0);
        break;
      }
      case 'torch': {
        ctx.beginPath();
        ctx.rect(-0.05 * s, -0.1 * s, 0.1 * s, 0.4 * s);
        out('#6a4429');
        const fl = 1 + Math.sin(t * 17 + d.seed) * 0.12;
        const g = ctx.createRadialGradient(0, -0.25 * s, 0, 0, -0.25 * s, 1.2 * s);
        g.addColorStop(0, 'rgba(255,200,90,0.45)');
        g.addColorStop(1, 'rgba(255,160,60,0)');
        ctx.fillStyle = g;
        ctx.fillRect(-1.2 * s, -1.45 * s, 2.4 * s, 2.4 * s);
        ctx.beginPath();
        ctx.moveTo(-0.12 * s, -0.1 * s);
        ctx.quadraticCurveTo(-0.14 * s, -0.4 * s * fl, 0, -0.55 * s * fl);
        ctx.quadraticCurveTo(0.14 * s, -0.4 * s * fl, 0.12 * s, -0.1 * s);
        ctx.closePath();
        ctx.fillStyle = '#ff8a2a';
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(0, -0.22 * s, 0.06 * s, 0.13 * s * fl, 0, 0, Math.PI * 2);
        ctx.fillStyle = '#fff1a0';
        ctx.fill();
        break;
      }
      case 'flag': {
        ctx.strokeStyle = this.theme.outline;
        ctx.lineWidth = lw * 1.6;
        line(ctx, 0, 0, 0, -1.6 * s);
        const wave = Math.sin(t * 3 + d.seed) * 0.1;
        ctx.beginPath();
        ctx.moveTo(0, -1.6 * s);
        ctx.quadraticCurveTo(0.4 * s, -1.75 * s + wave, 0.8 * s, -1.5 * s + wave);
        ctx.lineTo(0, -1.15 * s);
        ctx.closePath();
        out('#ffd23d');
        break;
      }
      case 'pine': {
        ctx.beginPath();
        ctx.rect(-0.08 * s, -0.4 * s, 0.16 * s, 0.4 * s);
        out('#6a4429');
        for (let i = 0; i < 3; i++) {
          const y = -0.3 * s - i * 0.45 * s;
          const w = (0.6 - i * 0.14) * s;
          ctx.beginPath();
          ctx.moveTo(-w, y);
          ctx.lineTo(0, y - 0.75 * s);
          ctx.lineTo(w, y);
          ctx.closePath();
          out(this.duel.level.world.id === 'snow' ? '#2f6b5a' : '#2f7a45');
          if (this.duel.level.world.id === 'snow') {
            ctx.beginPath();
            ctx.moveTo(-w * 0.55, y - 0.32 * s);
            ctx.lineTo(0, y - 0.75 * s);
            ctx.lineTo(w * 0.55, y - 0.32 * s);
            ctx.closePath();
            ctx.fillStyle = '#ffffff';
            ctx.fill();
          }
        }
        break;
      }
      case 'boulder': {
        ctx.beginPath();
        ctx.ellipse(0, -0.25 * s, 0.45 * s, 0.3 * s, 0, 0, Math.PI * 2);
        out('#8c8579');
        break;
      }
      case 'skullrock': {
        ctx.beginPath();
        ctx.moveTo(-0.6 * s, 0);
        ctx.lineTo(-0.4 * s, -0.4 * s);
        ctx.lineTo(0.1 * s, -0.55 * s);
        ctx.lineTo(0.55 * s, -0.25 * s);
        ctx.lineTo(0.65 * s, 0);
        ctx.closePath();
        out('#c98a4c');
        break;
      }
      case 'palm': {
        ctx.strokeStyle = this.theme.outline;
        ctx.lineWidth = 0.22 * s + lw * 2;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.quadraticCurveTo(0.5 * s, -2 * s, 0.2 * s, -3.6 * s);
        ctx.stroke();
        ctx.strokeStyle = '#a8703c';
        ctx.lineWidth = 0.22 * s;
        ctx.stroke();
        ctx.translate(0.2 * s, -3.6 * s);
        for (let i = 0; i < 6; i++) {
          const a = -Math.PI / 2 + (i - 2.5) * 0.62 + Math.sin(t * 1.5 + i) * 0.04;
          ctx.save();
          ctx.rotate(a);
          ctx.beginPath();
          ctx.ellipse(0.75 * s, 0, 0.8 * s, 0.17 * s, 0.25, 0, Math.PI * 2);
          out('#4f9e3a');
          ctx.restore();
        }
        break;
      }
      case 'pot': {
        ctx.beginPath();
        ctx.moveTo(-0.2 * s, -0.5 * s);
        ctx.lineTo(0.2 * s, -0.5 * s);
        ctx.quadraticCurveTo(0.42 * s, -0.25 * s, 0.25 * s, 0);
        ctx.lineTo(-0.25 * s, 0);
        ctx.quadraticCurveTo(-0.42 * s, -0.25 * s, -0.2 * s, -0.5 * s);
        out('#d9773a');
        ctx.strokeStyle = '#ffe0a0';
        ctx.lineWidth = lw;
        line(ctx, -0.3 * s, -0.25 * s, 0.3 * s, -0.25 * s);
        break;
      }
      case 'snowman': {
        // face, nose, hat on the solid snowballs
        ctx.fillStyle = OUTLINE;
        for (const ex of [-0.1, 0.1]) {
          ctx.beginPath();
          ctx.arc(ex, -2.1, 0.04, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.beginPath();
        ctx.moveTo(0, -2.02);
        ctx.lineTo(-0.3, -1.98);
        ctx.lineTo(0, -1.94);
        out('#ff8a2a');
        ctx.beginPath();
        ctx.rect(-0.22, -2.62, 0.44, 0.32);
        out('#2b2838');
        ctx.beginPath();
        ctx.rect(-0.32, -2.32, 0.64, 0.07);
        out('#2b2838');
        ctx.strokeStyle = '#ff3d5a';
        ctx.lineWidth = 0.1;
        line(ctx, -0.32, -1.72, 0.32, -1.72);
        ctx.fillStyle = OUTLINE;
        for (const y of [-1.5, -1.3]) {
          ctx.beginPath();
          ctx.arc(0, y, 0.04, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      }
      case 'icicles': {
        ctx.fillStyle = 'rgba(230,248,255,0.95)';
        ctx.strokeStyle = '#2b5f8a';
        ctx.lineWidth = lw * 0.7;
        for (let x = -s + 0.2; x < s - 0.1; x += 0.35) {
          const h = 0.2 + ((x * 7.3) % 0.25);
          ctx.beginPath();
          ctx.moveTo(x - 0.08, 0);
          ctx.lineTo(x, h);
          ctx.lineTo(x + 0.08, 0);
          ctx.fill();
          ctx.stroke();
        }
        break;
      }
      case 'crystal': {
        for (const [dx, h, a] of [[-0.3, 0.8, -0.3], [0, 1.2, 0], [0.3, 0.7, 0.35]] as const) {
          ctx.save();
          ctx.translate(dx * s, 0);
          ctx.rotate(a);
          ctx.beginPath();
          ctx.moveTo(-0.12 * s, 0);
          ctx.lineTo(-0.12 * s, -h * s * 0.75);
          ctx.lineTo(0, -h * s);
          ctx.lineTo(0.12 * s, -h * s * 0.75);
          ctx.lineTo(0.12 * s, 0);
          ctx.closePath();
          out('rgba(150,220,255,0.9)');
          ctx.restore();
        }
        break;
      }
      case 'vent': {
        // lava bubble spot
        const ph = (t * 0.6 + (d.seed % 100) / 100) % 1;
        ctx.fillStyle = '#ffd04a';
        ctx.beginPath();
        ctx.arc(0, -0.05 - ph * 0.3, 0.15 * s * (1 - ph), 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      default:
        break;
    }
    ctx.restore();
  }

  // ───────────── aiming ─────────────

  private drawAim(ctx: Ctx, f: Fighter, lw: number, px: number): void {
    const aim = f.aim;
    if (!aim) return;
    const w = f.def;
    const speed = w.speedMin + (w.speedMax - w.speedMin) * aim.power;
    const from = f.launchPoint(aim.angle);
    const dots = previewDots(from, aim.angle, speed, w, this.fullPreview ? 2.6 : this.duel.level.preview * (0.5 + aim.power * 0.7));
    dots.forEach((d, i) => {
      const k = 1 - i / dots.length;
      ctx.globalAlpha = 0.35 + k * 0.65;
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = px * 2;
      ctx.beginPath();
      ctx.arc(d.x, d.y, 0.05 + k * 0.05, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    });
    ctx.globalAlpha = 1;
    // power arc around the shoulder
    const s = f.rag.shoulder();
    const R = 1.25 * f.rag.scale;
    const spanA = 1.1;
    const a0 = aim.angle - spanA / 2;
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(30,26,43,0.45)';
    ctx.lineWidth = 0.2;
    ctx.beginPath();
    ctx.arc(s.x, s.y, R, a0, a0 + spanA);
    ctx.stroke();
    const col = aim.power < 0.5 ? lerpColor('#6cf06a', '#ffd23d', aim.power * 2) : lerpColor('#ffd23d', '#ff4d4d', (aim.power - 0.5) * 2);
    ctx.strokeStyle = col;
    ctx.lineWidth = 0.12;
    ctx.beginPath();
    ctx.arc(s.x, s.y, R, a0, a0 + spanA * Math.max(0.02, aim.power));
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.arc(s.x, s.y, R + 0.12, a0, a0 + spanA);
    ctx.stroke();
  }

  private drawGhost(ctx: Ctx, pts: Array<{ x: number; y: number }>, px: number): void {
    const pulse = 0.55 + Math.sin(this.time * 5) * 0.25;
    ctx.fillStyle = `rgba(255,214,61,${pulse})`;
    ctx.strokeStyle = 'rgba(30,26,43,0.5)';
    ctx.lineWidth = px * 1.5;
    pts.forEach((p, i) => {
      if (i % 2) return;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 0.09, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    });
  }

  private drawTurnMarker(ctx: Ctx, f: Fighter, lw: number): void {
    const h = f.rag.head.getPosition();
    const y = h.y - 0.75 * f.rag.scale - Math.abs(Math.sin(this.time * 4)) * 0.15;
    ctx.beginPath();
    ctx.moveTo(h.x - 0.2, y - 0.25);
    ctx.lineTo(h.x + 0.2, y - 0.25);
    ctx.lineTo(h.x, y);
    ctx.closePath();
    ctx.fillStyle = f.setup.ai ? '#ff5a5a' : '#ffd23d';
    ctx.fill();
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = lw;
    ctx.stroke();
  }

  private drawTrail(ctx: Ctx, trail: { x: number; y: number }[], look: string, lw: number): void {
    if (trail.length < 2) return;
    ctx.lineCap = 'round';
    const col = look === 'bolt' ? 'rgba(190,120,255,' : look === 'meteor' ? 'rgba(255,140,50,' : 'rgba(255,255,255,';
    for (let i = 1; i < trail.length; i++) {
      const a = trail[i - 1] as { x: number; y: number };
      const b = trail[i] as { x: number; y: number };
      ctx.strokeStyle = `${col}${(i / trail.length) * 0.5})`;
      ctx.lineWidth = lw * (look === 'bolt' || look === 'meteor' ? 4 : 1.6) * (i / trail.length);
      line(ctx, a.x, a.y, b.x, b.y);
    }
  }

  // ───────────── ambience ─────────────

  private ambient(dt: number, view: View): void {
    const L = this.duel.level;
    const z = this.cam.zoom;
    const hw = view.w / 2 / z;
    const hh = view.h / 2 / z;
    const x0 = this.cam.x - hw;
    const y0 = this.cam.y - hh;
    const rnd = Math.random;
    this.ambientT += dt;
    const wind = this.duel.wind;
    const every = (rate: number) => {
      let n = 0;
      const p = rate * dt;
      if (rnd() < p - Math.floor(p)) n++;
      return n + Math.floor(p);
    };
    switch (this.theme.ambient) {
      case 'leaves':
        for (let i = every(2.5); i > 0; i--)
          this.fx.add({ kind: 'leaf', x: x0 + rnd() * hw * 2, y: y0 - 0.5, vx: 0.4 + wind * 0.3, vy: 0.9, size: 0.12, color: rnd() < 0.5 ? '#7fd14a' : '#f2b13d', life: 9, vr: 1.5 });
        break;
      case 'embers':
        for (const d of L.decos) {
          if (d.kind !== 'torch' || rnd() > dt * 5) continue;
          this.fx.add({ kind: 'ember', x: d.x + (rnd() - 0.5) * 0.1, y: d.y - 0.5, vx: (rnd() - 0.5) * 0.4 + wind * 0.2, vy: -1.2, size: 0.05, color: '#ffb347', life: 1.2 });
        }
        break;
      case 'clouds':
      case 'sand':
        for (let i = every(Math.abs(wind) * (this.theme.ambient === 'sand' ? 7 : 3) + 1); i > 0; i--)
          this.fx.add({
            kind: 'streak',
            x: wind >= 0 ? x0 - 1 : x0 + hw * 2 + 1,
            y: y0 + rnd() * hh * 2,
            vx: (wind >= 0 ? 1 : -1) * (6 + Math.abs(wind) * 4),
            vy: 0.2,
            size: this.theme.ambient === 'sand' ? 0.3 : 0.25,
            color: this.theme.ambient === 'sand' ? 'rgba(255,225,160,0.55)' : 'rgba(255,255,255,0.6)',
            life: (hw * 2 + 2) / (6 + Math.abs(wind) * 4),
          });
        break;
      case 'snow':
        for (let i = every(14); i > 0; i--)
          this.fx.add({ kind: 'snow', x: x0 - 2 + rnd() * (hw * 2 + 4), y: y0 - 0.3, vx: wind * 0.6, vy: 0.8 + rnd() * 0.6, size: 0.03 + rnd() * 0.04, color: 'rgba(255,255,255,0.9)', life: hh * 2 / 1 + 1 });
        break;
      case 'ash':
        for (let i = every(8); i > 0; i--)
          this.fx.add({ kind: 'ash', x: x0 - 2 + rnd() * (hw * 2 + 4), y: y0 - 0.3, vx: wind * 0.5, vy: 0.5 + rnd() * 0.4, size: 0.025 + rnd() * 0.03, color: 'rgba(80,70,75,0.8)', life: hh * 2 + 2 });
        for (let i = every(4); i > 0; i--)
          this.fx.add({ kind: 'ember', x: x0 + rnd() * hw * 2, y: L.floor.y, vx: wind * 0.3, vy: -1.5 - rnd(), size: 0.06, color: '#ffb347', life: 2.5 });
        break;
    }
    for (const b of this.birds) {
      b.x += b.vx * dt;
      if (b.x > 1.25) b.x = -0.25;
      b.ph += dt * 9;
    }
  }

  private drawBirds(ctx: Ctx, view: View): void {
    if (!this.birds.length) return;
    ctx.strokeStyle = '#2a3a40';
    ctx.lineWidth = 2 * view.dpr;
    ctx.lineCap = 'round';
    for (const b of this.birds) {
      const x = b.x * view.w;
      const y = b.y * view.h + Math.sin(b.ph * 0.15) * 6 * view.dpr;
      const s = 9 * view.dpr * b.s;
      const flap = Math.sin(b.ph) * s * 0.5;
      ctx.beginPath();
      ctx.moveTo(x - s, y - flap);
      ctx.quadraticCurveTo(x - s * 0.4, y - s * 0.2, x, y);
      ctx.quadraticCurveTo(x + s * 0.4, y - s * 0.2, x + s, y - flap);
      ctx.stroke();
    }
  }

  private heatShimmer(ctx: Ctx, view: View, floorScreen: number): void {
    const band = Math.round(view.h * 0.12);
    const top = Math.max(0, Math.min(view.h - band, Math.round(floorScreen - band * 1.2)));
    const step = Math.max(3, Math.round(4 * view.dpr));
    const canvas = ctx.canvas;
    for (let y = top; y < top + band; y += step) {
      const off = Math.sin(y * 0.09 + this.time * 5) * 1.4 * view.dpr;
      ctx.drawImage(canvas, 0, y, view.w, step, off, y, view.w, step);
    }
  }
}

interface Bounds {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
function boundsOf(s: Solid): Bounds {
  if (s.shape.kind === 'circle') return { x0: s.shape.c.x - s.shape.r, y0: s.shape.c.y - s.shape.r, x1: s.shape.c.x + s.shape.r, y1: s.shape.c.y + s.shape.r };
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of s.shape.pts) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  return { x0, y0, x1, y1 };
}

function lerpColor(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (s: number) => Math.round(((pa >> s) & 255) + ((((pb >> s) & 255) - ((pa >> s) & 255)) * clamp(t, 0, 1)));
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}
