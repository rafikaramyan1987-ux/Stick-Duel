import { Rng } from '../core/rng';
import type { WorldId } from '../game/worlds';
import { THEMES, type Theme } from './theme';

/**
 * Parallax background: a sky gradient plus three silhouette layers, each
 * pre-rendered once per screen size into a horizontally tiling canvas.
 */
type Ctx = CanvasRenderingContext2D;

interface Layer {
  canvas: HTMLCanvasElement;
  factor: number;
  /** Fraction of the tile height where the layer's ground line sits. */
  base: number;
}

const ridge = (ctx: Ctx, w: number, h: number, rng: Rng, y0: number, amp: number, steps: number, sharp = 0): number[] => {
  const ys: number[] = [];
  const phase = rng.range(0, 10);
  const f1 = (Math.PI * 2 * rng.int(1, 2)) / w;
  const f2 = (Math.PI * 2 * rng.int(3, 5)) / w;
  const f3 = (Math.PI * 2 * rng.int(7, 11)) / w;
  ctx.beginPath();
  ctx.moveTo(0, h);
  for (let i = 0; i <= steps; i++) {
    const x = (i / steps) * w;
    let n = Math.sin(x * f1 + phase) * 0.5 + Math.sin(x * f2 + phase * 2) * 0.3 + Math.sin(x * f3 + phase * 3) * 0.2;
    if (sharp) n = n * (1 - sharp) + (1 - Math.abs(Math.sin(x * f2 * 0.5 + phase))) * sharp;
    const y = y0 - n * amp;
    ys.push(y);
    ctx.lineTo(x, y);
  }
  ctx.lineTo(w, h);
  ctx.closePath();
  return ys;
};

const vgrad = (ctx: Ctx, y0: number, y1: number, a: string, b: string) => {
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  g.addColorStop(0, a);
  g.addColorStop(1, b);
  return g;
};

/** Tile width while painting: shapes crossing an edge are repeated on the other side so tiles join seamlessly. */
let WRAP = 0;

function blob(ctx: Ctx, x: number, y: number, r: number): void {
  for (const dx of WRAP ? [0, -WRAP, WRAP] : [0]) {
    if (dx && Math.abs(x + dx - WRAP / 2) > WRAP / 2 + r) continue;
    ctx.moveTo(x + dx + r, y);
    ctx.arc(x + dx, y, r, 0, Math.PI * 2);
  }
}

function pine(ctx: Ctx, x: number, base: number, h: number): void {
  for (const dx of WRAP ? [0, -WRAP, WRAP] : [0]) {
    if (dx && Math.abs(x + dx - WRAP / 2) > WRAP / 2 + h * 0.4) continue;
    pine1(ctx, x + dx, base, h);
  }
}

function pine1(ctx: Ctx, x: number, base: number, h: number): void {
  const w = h * 0.36;
  ctx.moveTo(x, base - h);
  for (let i = 0; i < 3; i++) {
    const t = (i + 1) / 3;
    ctx.lineTo(x + w * t, base - h + h * t * 0.85);
    ctx.lineTo(x + w * t * 0.45, base - h + h * t * 0.85);
  }
  ctx.lineTo(x + w * 0.15, base);
  ctx.lineTo(x - w * 0.15, base);
  for (let i = 2; i >= 0; i--) {
    const t = (i + 1) / 3;
    ctx.lineTo(x - w * t * 0.45, base - h + h * t * 0.85);
    ctx.lineTo(x - w * t, base - h + h * t * 0.85);
  }
  ctx.closePath();
}

// ───────────── layer painters (w × h tile, ground near h * base) ─────────────

type Painter = (ctx: Ctx, w: number, h: number, th: Theme, rng: Rng, layer: 0 | 1 | 2) => void;

const forest: Painter = (ctx, w, h, th, rng, layer) => {
  if (layer === 0) {
    ridge(ctx, w, h, rng, h * 0.55, h * 0.14, 80);
    ctx.fillStyle = vgrad(ctx, h * 0.35, h, th.farTop, th.far);
    ctx.fill();
    return;
  }
  if (layer === 1) {
    ctx.fillStyle = vgrad(ctx, h * 0.45, h, th.midTop, th.mid);
    ctx.beginPath();
    ridge(ctx, w, h, rng, h * 0.72, h * 0.05, 60);
    for (let x = 0; x < w + 40; x += rng.range(18, 34)) blob(ctx, x, h * 0.66 - rng.range(0, h * 0.06), rng.range(h * 0.05, h * 0.09));
    ctx.fill();
    ctx.beginPath();
    for (let i = 0; i < 9; i++) pine(ctx, rng.range(0, w), h * 0.7, rng.range(h * 0.16, h * 0.26));
    ctx.fill();
    return;
  }
  // a low hedge row only: tall trees here would look like real (hittable) obstacles
  ctx.fillStyle = vgrad(ctx, h * 0.72, h, th.nearTop, th.near);
  ctx.beginPath();
  ridge(ctx, w, h, rng, h * 0.88, h * 0.02, 40);
  for (let x = 0; x < w + 30; x += rng.range(16, 30)) blob(ctx, x, h * 0.85 - rng.range(0, h * 0.02), rng.range(h * 0.035, h * 0.06));
  ctx.fill();
};

const castle: Painter = (ctx, w, h, th, rng, layer) => {
  if (layer === 0) {
    ridge(ctx, w, h, rng, h * 0.6, h * 0.08, 60);
    ctx.fillStyle = vgrad(ctx, h * 0.4, h, th.farTop, th.far);
    ctx.fill();
    // distant castle on a hill
    const cx = w * rng.range(0.3, 0.7);
    const by = h * 0.55;
    ctx.fillStyle = th.far;
    ctx.beginPath();
    ctx.rect(cx - h * 0.12, by - h * 0.12, h * 0.24, h * 0.13);
    for (const dx of [-0.13, -0.04, 0.05, 0.12]) {
      const tx = cx + dx * h;
      const tw = h * 0.035;
      const tt = by - h * rng.range(0.18, 0.28);
      ctx.rect(tx - tw, tt, tw * 2, by - tt);
      ctx.moveTo(tx - tw * 1.3, tt);
      ctx.lineTo(tx, tt - h * 0.06);
      ctx.lineTo(tx + tw * 1.3, tt);
    }
    ctx.fill();
    return;
  }
  if (layer === 1) {
    ctx.fillStyle = vgrad(ctx, h * 0.5, h, th.midTop, th.mid);
    ctx.beginPath();
    ctx.rect(0, h * 0.7, w, h * 0.3);
    // town roofs and towers
    for (let x = 0; x < w; ) {
      const bw = rng.range(h * 0.06, h * 0.12);
      const bh = rng.range(h * 0.06, h * 0.14);
      ctx.rect(x, h * 0.7 - bh, bw, bh);
      ctx.moveTo(x - 2, h * 0.7 - bh);
      ctx.lineTo(x + bw / 2, h * 0.7 - bh - bw * 0.6);
      ctx.lineTo(x + bw + 2, h * 0.7 - bh);
      x += bw + rng.range(0, h * 0.03);
    }
    ctx.fill();
    // lit windows
    ctx.fillStyle = 'rgba(255,200,110,0.85)';
    for (let i = 0; i < 26; i++) ctx.fillRect(rng.range(0, w), h * rng.range(0.6, 0.72), h * 0.008, h * 0.012);
    return;
  }
  // near: crenellated wall
  ctx.fillStyle = vgrad(ctx, h * 0.75, h, th.nearTop, th.near);
  ctx.beginPath();
  ctx.rect(0, h * 0.84, w, h * 0.16);
  const mw = h * 0.04;
  for (let x = 0; x < w; x += mw * 2) ctx.rect(x, h * 0.81, mw, h * 0.04);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.18)';
  ctx.lineWidth = 1;
  for (let y = h * 0.87; y < h; y += h * 0.03) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
};

const mountains: Painter = (ctx, w, h, th, rng, layer) => {
  if (layer === 0) {
    const ys = ridge(ctx, w, h, rng, h * 0.4, h * 0.22, 40, 0.6);
    ctx.fillStyle = vgrad(ctx, h * 0.15, h, '#c9dcf2', th.far);
    ctx.fill();
    // snow caps
    ctx.fillStyle = th.farTop;
    ctx.beginPath();
    ys.forEach((y, i) => {
      const x = (i / (ys.length - 1)) * w;
      if (y < h * 0.36) {
        ctx.moveTo(x - h * 0.03, y + h * 0.05);
        ctx.lineTo(x, y);
        ctx.lineTo(x + h * 0.03, y + h * 0.05);
      }
    });
    ctx.fill();
    return;
  }
  if (layer === 1) {
    const ys = ridge(ctx, w, h, rng, h * 0.58, h * 0.16, 30, 0.75);
    ctx.fillStyle = vgrad(ctx, h * 0.35, h, '#8da1bd', th.mid);
    ctx.fill();
    ctx.fillStyle = th.midTop;
    ctx.beginPath();
    ys.forEach((y, i) => {
      const x = (i / (ys.length - 1)) * w;
      if (y < h * 0.52) {
        ctx.moveTo(x - h * 0.04, y + h * 0.045);
        ctx.lineTo(x, y);
        ctx.lineTo(x + h * 0.04, y + h * 0.045);
      }
    });
    ctx.fill();
    return;
  }
  ctx.fillStyle = th.near;
  ctx.beginPath();
  ridge(ctx, w, h, rng, h * 0.85, h * 0.04, 30);
  for (let x = 0; x < w; x += rng.range(8, 20)) pine(ctx, x, h * 0.86, rng.range(h * 0.08, h * 0.16));
  ctx.fill();
};

const desert: Painter = (ctx, w, h, th, rng, layer) => {
  if (layer === 0) {
    ctx.fillStyle = vgrad(ctx, h * 0.4, h, th.farTop, th.far);
    ctx.beginPath();
    ctx.rect(0, h * 0.62, w, h * 0.38);
    for (let i = 0; i < 3; i++) {
      const x = rng.range(0, w);
      const mw = rng.range(h * 0.12, h * 0.3);
      const mh = rng.range(h * 0.08, h * 0.16);
      ctx.moveTo(x - mw * 0.6, h * 0.62);
      ctx.lineTo(x - mw * 0.45, h * 0.62 - mh);
      ctx.lineTo(x + mw * 0.45, h * 0.62 - mh);
      ctx.lineTo(x + mw * 0.6, h * 0.62);
    }
    ctx.fill();
    return;
  }
  if (layer === 1) {
    ctx.fillStyle = vgrad(ctx, h * 0.55, h, th.midTop, th.mid);
    ctx.beginPath();
    ctx.moveTo(0, h);
    for (let x = 0; x <= w; x += 6) ctx.lineTo(x, h * 0.72 - Math.abs(Math.sin((x / w) * Math.PI * 3 + 1)) * h * 0.08);
    ctx.lineTo(w, h);
    ctx.fill();
    return;
  }
  ctx.fillStyle = vgrad(ctx, h * 0.7, h, th.nearTop, th.near);
  ctx.beginPath();
  ctx.moveTo(0, h);
  for (let x = 0; x <= w; x += 6) ctx.lineTo(x, h * 0.86 - Math.pow(Math.abs(Math.sin((x / w) * Math.PI * 2 + 2)), 3) * h * 0.08);
  ctx.lineTo(w, h);
  ctx.fill();
  // tiny far palms
  ctx.fillStyle = '#7a4a26';
  for (let i = 0; i < 2; i++) {
    const x = rng.range(0, w);
    ctx.beginPath();
    ctx.moveTo(x, h * 0.87);
    ctx.quadraticCurveTo(x + h * 0.02, h * 0.8, x + h * 0.01, h * 0.74);
    ctx.lineWidth = h * 0.008;
    ctx.strokeStyle = '#7a4a26';
    ctx.stroke();
    ctx.fillStyle = '#4f8a3a';
    for (let k = 0; k < 5; k++) {
      ctx.beginPath();
      const a = -Math.PI / 2 + (k - 2) * 0.7;
      ctx.ellipse(x + h * 0.01 + Math.cos(a) * h * 0.025, h * 0.74 + Math.sin(a) * h * 0.012 + h * 0.01, h * 0.03, h * 0.008, a, 0, Math.PI * 2);
      ctx.fill();
    }
  }
};

const snow: Painter = (ctx, w, h, th, rng, layer) => {
  if (layer === 0) {
    const ys = ridge(ctx, w, h, rng, h * 0.48, h * 0.18, 30, 0.7);
    ctx.fillStyle = vgrad(ctx, h * 0.2, h, '#7a8fc4', th.far);
    ctx.fill();
    ctx.fillStyle = th.farTop;
    ctx.beginPath();
    ys.forEach((y, i) => {
      const x = (i / (ys.length - 1)) * w;
      if (y < h * 0.44) {
        ctx.moveTo(x - h * 0.05, y + h * 0.07);
        ctx.lineTo(x, y);
        ctx.lineTo(x + h * 0.05, y + h * 0.07);
      }
    });
    ctx.fill();
    return;
  }
  if (layer === 1) {
    ctx.fillStyle = vgrad(ctx, h * 0.55, h, '#c8d6f5', '#8aa0d0');
    ctx.beginPath();
    ridge(ctx, w, h, rng, h * 0.72, h * 0.05, 40);
    ctx.fill();
    ctx.fillStyle = th.mid;
    ctx.beginPath();
    for (let x = 0; x < w; x += rng.range(10, 26)) pine(ctx, x, h * 0.72, rng.range(h * 0.1, h * 0.18));
    ctx.fill();
    ctx.fillStyle = 'rgba(240,246,255,0.9)';
    ctx.beginPath();
    for (let x = 0; x < w; x += rng.range(10, 26)) blob(ctx, x, h * 0.73, rng.range(h * 0.015, h * 0.03));
    ctx.fill();
    return;
  }
  ctx.fillStyle = vgrad(ctx, h * 0.78, h, th.nearTop, '#b9cdf0');
  ctx.beginPath();
  ridge(ctx, w, h, rng, h * 0.87, h * 0.03, 30);
  ctx.fill();
};

const volcano: Painter = (ctx, w, h, th, rng, layer) => {
  if (layer === 0) {
    ctx.fillStyle = vgrad(ctx, h * 0.3, h, th.farTop, th.far);
    ctx.beginPath();
    ctx.rect(0, h * 0.7, w, h * 0.3);
    const cx = w * 0.5;
    ctx.moveTo(cx - h * 0.6, h * 0.72);
    ctx.lineTo(cx - h * 0.09, h * 0.24);
    ctx.lineTo(cx + h * 0.09, h * 0.24);
    ctx.lineTo(cx + h * 0.6, h * 0.72);
    ctx.fill();
    // glowing crater + lava streams
    const g = ctx.createRadialGradient(cx, h * 0.24, 0, cx, h * 0.24, h * 0.16);
    g.addColorStop(0, 'rgba(255,190,80,0.9)');
    g.addColorStop(1, 'rgba(255,90,30,0)');
    ctx.fillStyle = g;
    ctx.fillRect(cx - h * 0.2, h * 0.08, h * 0.4, h * 0.3);
    ctx.strokeStyle = 'rgba(255,120,40,0.85)';
    ctx.lineWidth = h * 0.008;
    ctx.lineCap = 'round';
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      let x = cx + rng.range(-h * 0.07, h * 0.07);
      let y = h * 0.25;
      ctx.moveTo(x, y);
      while (y < h * 0.6) {
        y += h * 0.04;
        x += rng.range(-h * 0.03, h * 0.03) + (x - cx) * 0.18;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    return;
  }
  if (layer === 1) {
    ctx.beginPath();
    ridge(ctx, w, h, rng, h * 0.72, h * 0.1, 26, 0.8);
    ctx.fillStyle = vgrad(ctx, h * 0.5, h, th.midTop, th.mid);
    ctx.fill();
    return;
  }
  ctx.beginPath();
  ridge(ctx, w, h, rng, h * 0.86, h * 0.05, 22, 0.9);
  ctx.fillStyle = th.near;
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,110,40,0.5)';
  ctx.lineWidth = 2;
  ctx.stroke();
};

const PAINTERS: Record<WorldId, Painter> = { forest, castle, mountains, desert, snow, volcano };
const FACTORS = [0.08, 0.2, 0.38];

export class Backdrop {
  private layers: Layer[] = [];
  private w = 0;
  private h = 0;
  readonly theme: Theme;

  constructor(
    readonly world: WorldId,
    private readonly seed = 1,
  ) {
    this.theme = THEMES[world];
  }

  /** (Re)renders the layer tiles for a canvas of w × h device pixels. */
  resize(w: number, h: number): void {
    if (w === this.w && h === this.h && this.layers.length) return;
    this.w = w;
    this.h = h;
    const th = Math.max(64, Math.round(h * 0.8));
    const tw = Math.max(256, Math.round(th * 2.2));
    this.layers = [0, 1, 2].map((i) => {
      const c = document.createElement('canvas');
      c.width = tw;
      c.height = th;
      const ctx = c.getContext('2d') as Ctx;
      const rng = new Rng(this.seed * 31 + i * 7 + 3);
      ctx.save();
      WRAP = tw;
      PAINTERS[this.world](ctx, tw, th, this.theme, rng, i as 0 | 1 | 2);
      WRAP = 0;
      ctx.restore();
      return { canvas: c, factor: FACTORS[i] as number, base: 1 };
    });
  }

  /**
   * Draws sky + layers. camX/camY: camera centre in world metres; zoom: px per metre;
   * horizonY: screen y (device px) of the world floor.
   */
  draw(ctx: Ctx, camX: number, zoom: number, horizonY: number, time: number): void {
    const { w, h, theme } = this;
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, theme.sky[0]);
    sky.addColorStop(0.55, theme.sky[1]);
    sky.addColorStop(1, theme.sky[2]);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);
    this.drawSkyExtras(ctx, time);
    const groundY = Math.min(h * 1.05, Math.max(h * 0.55, horizonY));
    this.layers.forEach((L, i) => {
      const tw = L.canvas.width;
      const th = L.canvas.height;
      const bottom = h * 0.78 + (groundY - h * 0.78) * (0.25 + i * 0.3);
      const top = bottom - th;
      let ox = -((camX * zoom * L.factor) % tw);
      if (ox > 0) ox -= tw;
      for (let x = ox; x < w; x += tw) ctx.drawImage(L.canvas, Math.floor(x), Math.floor(top));
      // fill under the layer
      ctx.fillStyle = i === 0 ? theme.far : i === 1 ? theme.mid : theme.near;
      if (bottom < h) ctx.fillRect(0, Math.floor(bottom) - 1, w, h - bottom + 2);
      if (i === 0) {
        ctx.fillStyle = theme.haze;
        ctx.fillRect(0, 0, w, h);
      }
    });
  }

  private drawSkyExtras(ctx: Ctx, time: number): void {
    const { w, h, theme } = this;
    const s = theme.sun;
    if (s) {
      const x = s.x * w;
      const y = s.y * h;
      const r = s.r * Math.min(w, h * 1.6);
      const g = ctx.createRadialGradient(x, y, r * 0.5, x, y, r * 3.2);
      g.addColorStop(0, s.glow);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - r * 3.2, y - r * 3.2, r * 6.4, r * 6.4);
      ctx.fillStyle = s.color;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      if (this.world === 'snow') {
        // crescent moon
        ctx.fillStyle = theme.sky[0];
        ctx.beginPath();
        ctx.arc(x + r * 0.45, y - r * 0.2, r * 0.85, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    if (this.world === 'snow') {
      // aurora ribbons + stars
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (let k = 0; k < 3; k++) {
        ctx.beginPath();
        const y0 = h * (0.16 + k * 0.07);
        ctx.moveTo(0, y0);
        for (let x = 0; x <= w; x += 20) ctx.lineTo(x, y0 + Math.sin(x * 0.006 + time * 0.3 + k * 2) * h * 0.05);
        ctx.lineWidth = h * 0.05;
        ctx.strokeStyle = k === 1 ? 'rgba(160,90,255,0.10)' : 'rgba(80,255,170,0.12)';
        ctx.stroke();
      }
      ctx.restore();
      const rng = new Rng(9);
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      for (let i = 0; i < 60; i++) {
        const tw = 0.5 + 0.5 * Math.sin(time * 2 + i);
        const sz = (1 + rng.next() * 1.6) * (h / 600);
        ctx.globalAlpha = 0.3 + tw * 0.6;
        ctx.fillRect(rng.next() * w, rng.next() * h * 0.5, sz, sz);
      }
      ctx.globalAlpha = 1;
    }
    if (this.world === 'forest' || this.world === 'mountains' || this.world === 'desert') {
      // soft drifting clouds
      const rng = new Rng(this.world.length * 13);
      ctx.fillStyle = this.world === 'desert' ? 'rgba(255,250,235,0.55)' : 'rgba(255,255,255,0.75)';
      for (let i = 0; i < 4; i++) {
        const cw = h * rng.range(0.18, 0.3);
        const speed = rng.range(4, 10) * (h / 600);
        const x = ((rng.next() * (w + cw * 2) + time * speed) % (w + cw * 2)) - cw;
        const y = h * rng.range(0.06, 0.3);
        ctx.beginPath();
        blob(ctx, x, y, cw * 0.22);
        blob(ctx, x + cw * 0.25, y - cw * 0.08, cw * 0.26);
        blob(ctx, x + cw * 0.52, y, cw * 0.2);
        ctx.rect(x, y - cw * 0.02, cw * 0.52, cw * 0.2);
        ctx.fill();
      }
    }
    if (this.world === 'castle') {
      const rng = new Rng(5);
      ctx.fillStyle = 'rgba(255,240,220,0.7)';
      for (let i = 0; i < 25; i++) {
        const sz = (1 + rng.next()) * (h / 700);
        ctx.fillRect(rng.next() * w, rng.next() * h * 0.3, sz, sz);
      }
    }
    if (this.world === 'volcano') {
      // smoke column
      const cx = w * 0.5;
      ctx.fillStyle = 'rgba(40,20,25,0.35)';
      for (let i = 0; i < 7; i++) {
        const t = (time * 0.05 + i / 7) % 1;
        ctx.beginPath();
        blob(ctx, cx + Math.sin(i * 2 + time * 0.2) * h * 0.05 + t * h * 0.2, h * (0.25 - t * 0.3), h * (0.05 + t * 0.12));
        ctx.fill();
      }
    }
  }
}
