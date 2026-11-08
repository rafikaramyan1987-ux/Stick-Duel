import type { Fighter, Stuck } from '../game/duel';
import type { PartName } from '../game/ragdoll';
import { drawBow, drawItem, drawStaff, line, star } from './items';
import { HERO_COLORS, OUTLINE } from './theme';

type Ctx = CanvasRenderingContext2D;

interface Look {
  body: string;
  back: string;
  skin: string;
  thick: number;
}

const shade = (hex: string, k: number): string => {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * k);
  const g = Math.round(((n >> 8) & 255) * k);
  const b = Math.round((n & 255) * k);
  return `rgb(${Math.min(255, r)},${Math.min(255, g)},${Math.min(255, b)})`;
};

/** The rainbow skin cycles through the hues. */
function rainbow(): string {
  const h = Math.round((performance.now() / 12) % 360);
  const c = (n: number) => {
    const k = (n + h / 30) % 12;
    return Math.round(255 * (0.62 - 0.38 * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return `#${[c(0), c(8), c(4)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

function lookOf(f: Fighter): Look {
  const s = f.setup;
  let body: string;
  let skin = '#ffe6cc';
  let thick = 1;
  switch (s.look) {
    case 'hero':
    case 'hero2':
      body = s.color === 'rainbow' ? rainbow() : (HERO_COLORS[s.color] ?? '#3d7bff');
      break;
    case 'ranger':
      body = '#4c9a3c';
      break;
    case 'knight':
      body = '#8d9bb0';
      break;
    case 'viking':
      body = '#c8692a';
      skin = '#ffd9b8';
      break;
    case 'nomad':
      body = '#3aa6a0';
      skin = '#e8b386';
      break;
    case 'yeti':
      body = '#f2f7ff';
      skin = '#a9d8f5';
      thick = 1.45;
      break;
    case 'golem':
      body = '#5b4640';
      skin = '#6b544d';
      thick = 1.35;
      break;
  }
  if (s.boss && s.look === 'ranger') body = '#2f7a35';
  return { body, back: shade(body, 0.72), skin, thick };
}

const BACK: PartName[] = ['uArmB', 'lArmB', 'thighB', 'shinB'];
const ORDER: PartName[] = ['uArmB', 'lArmB', 'thighB', 'shinB', 'torso', 'thighF', 'shinF', 'head', 'uArmF', 'lArmF'];

export function drawFighter(ctx: Ctx, f: Fighter, lw: number, time: number, phaseAim: boolean): void {
  const L = lookOf(f);
  const r = f.rag;
  const sc = r.scale;
  const limbW = 0.12 * sc * L.thick;
  const torsoW = 0.19 * sc * L.thick;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const ends = (name: PartName) => {
    const p = r.byName[name];
    const a = p.body.getWorldPoint({ x: 0, y: -p.spec.hh });
    const b = p.body.getWorldPoint({ x: 0, y: p.spec.hh });
    return [a, b] as const;
  };
  const head = r.byName.head;
  const hp = head.body.getPosition();
  const hr = (head.spec.circle ?? 0.2) * (f.setup.look === 'yeti' || f.setup.look === 'golem' ? 1.1 : 1);

  // back gear (quiver, cape) behind the body
  drawBackGear(ctx, f, lw);

  // 1) outline pass for the whole silhouette
  ctx.strokeStyle = OUTLINE;
  for (const n of ORDER) {
    if (n === 'head') continue;
    const [a, b] = ends(n);
    ctx.lineWidth = (n === 'torso' ? torsoW : limbW) + lw * 2;
    line(ctx, a.x, a.y, b.x, b.y);
  }
  ctx.fillStyle = OUTLINE;
  ctx.beginPath();
  ctx.arc(hp.x, hp.y, hr + lw, 0, Math.PI * 2);
  ctx.fill();

  // 2) colour pass
  for (const n of ORDER) {
    if (n === 'head') {
      ctx.fillStyle = L.skin;
      ctx.beginPath();
      ctx.arc(hp.x, hp.y, hr, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }
    const [a, b] = ends(n);
    ctx.strokeStyle = BACK.includes(n) ? L.back : L.body;
    ctx.lineWidth = n === 'torso' ? torsoW : limbW;
    line(ctx, a.x, a.y, b.x, b.y);
    if (n === 'torso') {
      // belt + highlight
      ctx.strokeStyle = 'rgba(255,255,255,0.28)';
      ctx.lineWidth = torsoW * 0.28;
      line(ctx, a.x - (b.y - a.y) * 0.06, a.y + (b.x - a.x) * 0.06, b.x - (b.y - a.y) * 0.06, b.y + (b.x - a.x) * 0.06);
      const m = { x: a.x + (b.x - a.x) * 0.78, y: a.y + (b.y - a.y) * 0.78 };
      ctx.fillStyle = f.setup.look === 'golem' ? '#ff8a2a' : 'rgba(30,26,43,0.55)';
      ctx.beginPath();
      ctx.arc(m.x, m.y, torsoW * 0.32, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  if (f.setup.look === 'golem') drawLavaVeins(ctx, f, time);

  // 3) face & headgear in head space
  ctx.save();
  ctx.translate(hp.x, hp.y);
  ctx.rotate(head.body.getAngle());
  ctx.scale(f.facing, 1);
  drawFace(ctx, f, hr, lw, time);
  if (f.burnT > 0) {
    // cartoon soot after a fire arrow
    ctx.fillStyle = `rgba(40,30,30,${Math.min(0.45, f.burnT * 0.2)})`;
    ctx.beginPath();
    ctx.arc(-hr * 0.2, -hr * 0.3, hr * 0.55, 0, Math.PI * 2);
    ctx.fill();
  }
  if (!f.hatLost) drawHeadgear(ctx, f, hr, lw, time);
  ctx.restore();

  // the knocked-off hat, flying away
  if (f.hat) {
    ctx.save();
    ctx.translate(f.hat.x, f.hat.y);
    ctx.rotate(f.hat.a);
    ctx.scale(f.facing, 1);
    drawHeadgear(ctx, f, hr, lw, time);
    ctx.restore();
  }

  // 4) stuck projectiles
  for (const s of f.stuck) {
    if (!s.part) continue;
    const body = r.byName[s.part].body;
    const p = body.getWorldPoint({ x: s.x, y: s.y });
    drawStuck(ctx, s, p.x, p.y, body.getAngle() + s.a, lw, time);
  }

  // 5) weapon in hand
  drawHeld(ctx, f, lw, time, phaseAim);

  // shield bubble
  if (f.shield && !f.ko) {
    const c = r.torso.getPosition();
    const R = 1.25 * sc;
    const g = ctx.createRadialGradient(c.x, c.y - 0.2 * sc, R * 0.6, c.x, c.y - 0.2 * sc, R);
    g.addColorStop(0, 'rgba(120,220,255,0.05)');
    g.addColorStop(1, `rgba(120,220,255,${0.35 + Math.sin(time * 4) * 0.08})`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(c.x, c.y - 0.2 * sc, R, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = lw;
    ctx.stroke();
  }

  // knocked out or very low on HP: dizzy stars
  const dizzy = !f.ko && f.hp / f.maxHp < 0.25;
  if (f.ko || dizzy) {
    for (let i = 0; i < (f.ko ? 3 : 2); i++) {
      const a = time * (f.ko ? 3 : 2.2) + (i * Math.PI * 2) / (f.ko ? 3 : 2);
      ctx.fillStyle = '#ffd23d';
      star(ctx, hp.x + Math.cos(a) * hr * 1.5, hp.y - hr * 1.1 + Math.sin(a) * hr * 0.45, hr * 0.38, hr * 0.16, 5, a);
      ctx.fill();
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = lw * 0.7;
      ctx.stroke();
    }
  }
}

export function drawStuck(ctx: Ctx, s: Stuck, x: number, y: number, a: number, lw: number, time: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(a);
  const tip = s.look === 'arrow' ? 0.1 : s.look === 'spear' ? 0.36 : s.look === 'axe' ? 0.32 : 0;
  ctx.translate(-tip * s.size, 0);
  drawItem(ctx, s.look, s.size, lw, time);
  ctx.restore();
}

function drawFace(ctx: Ctx, f: Fighter, r: number, lw: number, time: number): void {
  const look = f.setup.look;
  const eyeY = -r * 0.08;
  const ex1 = r * 0.18;
  const ex2 = r * 0.58;
  const eyeR = r * 0.13;
  ctx.lineCap = 'round';
  if (look === 'golem') {
    ctx.fillStyle = '#ffb347';
    for (const ex of [ex1, ex2]) {
      ctx.beginPath();
      ctx.arc(ex, eyeY, eyeR * 1.1, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = '#ff8a2a';
    ctx.lineWidth = lw * 1.1;
    line(ctx, ex1 - r * 0.05, r * 0.42, ex2 + r * 0.05, r * 0.38);
    return;
  }
  const dark = OUTLINE;
  if (f.ko) {
    ctx.strokeStyle = dark;
    ctx.lineWidth = lw * 1.1;
    for (const ex of [ex1, ex2]) {
      line(ctx, ex - eyeR, eyeY - eyeR, ex + eyeR, eyeY + eyeR);
      line(ctx, ex - eyeR, eyeY + eyeR, ex + eyeR, eyeY - eyeR);
    }
    ctx.beginPath();
    ctx.ellipse(r * 0.38, r * 0.45, r * 0.16, r * 0.1, 0, 0, Math.PI * 2);
    ctx.fillStyle = dark;
    ctx.fill();
    return;
  }
  if (f.hurtT > 0) {
    ctx.strokeStyle = dark;
    ctx.lineWidth = lw * 1.1;
    for (const [ex, s] of [[ex1, 1], [ex2, -1]] as const) {
      line(ctx, ex - eyeR * s, eyeY - eyeR, ex + eyeR * s, eyeY);
      line(ctx, ex + eyeR * s, eyeY, ex - eyeR * s, eyeY + eyeR);
    }
    ctx.fillStyle = dark;
    ctx.beginPath();
    ctx.arc(r * 0.4, r * 0.45, r * 0.13, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  const blink = (time + f.side * 1.7) % 3.4 < 0.12;
  ctx.fillStyle = dark;
  for (const ex of [ex1, ex2]) {
    ctx.beginPath();
    if (blink) ctx.ellipse(ex, eyeY, eyeR, eyeR * 0.25, 0, 0, Math.PI * 2);
    else ctx.ellipse(ex, eyeY, eyeR * 0.85, eyeR * 1.15, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  if (!blink) {
    ctx.fillStyle = '#fff';
    for (const ex of [ex1, ex2]) {
      ctx.beginPath();
      ctx.arc(ex + eyeR * 0.3, eyeY - eyeR * 0.4, eyeR * 0.35, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  const nomadScarf = look === 'nomad';
  if (!nomadScarf && look !== 'viking') {
    ctx.strokeStyle = dark;
    ctx.lineWidth = lw * 0.9;
    ctx.beginPath();
    if (f.aim) {
      line(ctx, r * 0.22, r * 0.42, r * 0.55, r * 0.4);
    } else {
      ctx.arc(r * 0.38, r * 0.3, r * 0.2, 0.35, Math.PI - 0.35);
      ctx.stroke();
    }
  }
  // determined brows when aiming / for enemies
  if (f.aim || f.setup.ai) {
    ctx.strokeStyle = dark;
    ctx.lineWidth = lw;
    line(ctx, ex1 - eyeR, eyeY - eyeR * 2.1, ex1 + eyeR, eyeY - eyeR * 1.5);
    line(ctx, ex2 - eyeR, eyeY - eyeR * 1.5, ex2 + eyeR, eyeY - eyeR * 2.1);
  }
  // cheeks
  ctx.fillStyle = 'rgba(255,120,120,0.35)';
  ctx.beginPath();
  ctx.arc(r * 0.68, r * 0.28, r * 0.12, 0, Math.PI * 2);
  ctx.fill();
}

function outlined(ctx: Ctx, fill: string, lw: number): void {
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = lw;
  ctx.stroke();
}

function drawHeadgear(ctx: Ctx, f: Fighter, r: number, lw: number, time: number): void {
  const s = f.setup;
  const boss = !!s.boss;
  const hat = s.look === 'hero' || s.look === 'hero2' ? s.hat : s.look;
  ctx.lineJoin = 'round';
  switch (hat) {
    case 'cap':
      ctx.beginPath();
      ctx.arc(0, -r * 0.25, r * 0.95, Math.PI, 0);
      ctx.closePath();
      outlined(ctx, '#ff4d4d', lw);
      ctx.beginPath();
      ctx.ellipse(r * 0.85, -r * 0.27, r * 0.55, r * 0.14, 0, 0, Math.PI * 2);
      outlined(ctx, '#d93636', lw);
      break;
    case 'headband':
      ctx.beginPath();
      ctx.rect(-r, -r * 0.55, r * 2, r * 0.3);
      outlined(ctx, '#ff3d5a', lw);
      ctx.beginPath();
      ctx.moveTo(-r * 0.95, -r * 0.42);
      ctx.quadraticCurveTo(-r * 1.6, -r * 0.6 + Math.sin(time * 8) * r * 0.15, -r * 1.9, -r * 0.2);
      ctx.lineWidth = r * 0.16;
      ctx.strokeStyle = '#ff3d5a';
      ctx.stroke();
      break;
    case 'tophat':
      ctx.beginPath();
      ctx.rect(-r * 0.62, -r * 2.05, r * 1.24, r * 1.25);
      outlined(ctx, '#2b2838', lw);
      ctx.beginPath();
      ctx.rect(-r * 0.62, -r * 1.12, r * 1.24, r * 0.25);
      outlined(ctx, '#ff4d6d', lw);
      ctx.beginPath();
      ctx.ellipse(0, -r * 0.82, r * 1.05, r * 0.16, 0, 0, Math.PI * 2);
      outlined(ctx, '#2b2838', lw);
      break;
    case 'pirate':
      ctx.beginPath();
      ctx.moveTo(-r * 1.25, -r * 0.6);
      ctx.quadraticCurveTo(0, -r * 2.2, r * 1.25, -r * 0.6);
      ctx.quadraticCurveTo(0, -r * 0.95, -r * 1.25, -r * 0.6);
      outlined(ctx, '#2b2838', lw);
      ctx.fillStyle = '#ffd23d';
      star(ctx, 0, -r * 1.15, r * 0.24, r * 0.1, 5);
      ctx.fill();
      break;
    case 'wizard':
      ctx.beginPath();
      ctx.moveTo(-r * 0.9, -r * 0.62);
      ctx.quadraticCurveTo(r * 0.1, -r * 2.2, -r * 0.7, -r * 2.75);
      ctx.quadraticCurveTo(r * 0.4, -r * 2.0, r * 0.9, -r * 0.62);
      ctx.closePath();
      outlined(ctx, '#5b4bff', lw);
      ctx.fillStyle = '#ffe14d';
      star(ctx, r * 0.05, -r * 1.25, r * 0.2, r * 0.08, 5);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(0, -r * 0.62, r * 1.15, r * 0.18, 0, 0, Math.PI * 2);
      outlined(ctx, '#5b4bff', lw);
      break;
    case 'viking':
      drawHorns(ctx, r, lw, false);
      ctx.beginPath();
      ctx.arc(0, -r * 0.3, r * 0.98, Math.PI, 0);
      ctx.closePath();
      outlined(ctx, boss ? '#ffc83d' : '#a9b3c2', lw);
      ctx.beginPath();
      ctx.rect(-r, -r * 0.42, r * 2, r * 0.22);
      outlined(ctx, boss ? '#d9a12a' : '#7f8a99', lw);
      if (!(s.look === 'hero' || s.look === 'hero2')) {
        // big orange beard
        ctx.beginPath();
        ctx.moveTo(-r * 0.2, r * 0.15);
        ctx.quadraticCurveTo(r * 0.4, r * (boss ? 1.9 : 1.4), r * 1.0, r * 0.15);
        ctx.quadraticCurveTo(r * 0.4, r * 0.55, -r * 0.2, r * 0.15);
        outlined(ctx, boss ? '#e8e8f0' : '#ff8f2e', lw);
      }
      break;
    case 'crown':
      ctx.beginPath();
      ctx.moveTo(-r * 0.75, -r * 0.7);
      ctx.lineTo(-r * 0.85, -r * 1.55);
      ctx.lineTo(-r * 0.4, -r * 1.1);
      ctx.lineTo(0, -r * 1.7);
      ctx.lineTo(r * 0.4, -r * 1.1);
      ctx.lineTo(r * 0.85, -r * 1.55);
      ctx.lineTo(r * 0.75, -r * 0.7);
      ctx.closePath();
      outlined(ctx, '#ffc83d', lw);
      ctx.fillStyle = '#ff3d6e';
      ctx.beginPath();
      ctx.arc(0, -r * 0.95, r * 0.13, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'propeller':
      ctx.beginPath();
      ctx.arc(0, -r * 0.3, r * 0.95, Math.PI, 0);
      ctx.closePath();
      outlined(ctx, '#3cc4ff', lw);
      ctx.beginPath();
      ctx.arc(0, -r * 0.3, r * 0.95, Math.PI, Math.PI * 1.5);
      ctx.lineTo(0, -r * 0.3);
      ctx.closePath();
      ctx.fillStyle = '#ffd23d';
      ctx.fill();
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = lw;
      line(ctx, 0, -r * 1.25, 0, -r * 1.55);
      {
        const w = Math.cos(time * 25) * r * 0.9;
        ctx.beginPath();
        ctx.ellipse(0, -r * 1.58, Math.abs(w) + r * 0.05, r * 0.1, 0, 0, Math.PI * 2);
        outlined(ctx, '#ff4d4d', lw);
      }
      break;
    case 'chef':
      ctx.beginPath();
      ctx.rect(-r * 0.75, -r * 1.05, r * 1.5, r * 0.5);
      outlined(ctx, '#ffffff', lw);
      ctx.beginPath();
      for (const [x, y, rr] of [[-0.45, -1.35, 0.42], [0.05, -1.55, 0.5], [0.5, -1.35, 0.42]] as const) {
        ctx.moveTo(r * (x + rr), r * y);
        ctx.arc(r * x, r * y, r * rr, 0, Math.PI * 2);
      }
      outlined(ctx, '#ffffff', lw);
      break;
    case 'cowboy':
      ctx.beginPath();
      ctx.ellipse(0, -r * 0.72, r * 1.45, r * 0.22, 0, 0, Math.PI * 2);
      outlined(ctx, '#b0703a', lw);
      ctx.beginPath();
      ctx.moveTo(-r * 0.7, -r * 0.75);
      ctx.quadraticCurveTo(-r * 0.75, -r * 1.65, -r * 0.2, -r * 1.45);
      ctx.quadraticCurveTo(0, -r * 1.3, r * 0.2, -r * 1.45);
      ctx.quadraticCurveTo(r * 0.75, -r * 1.65, r * 0.7, -r * 0.75);
      ctx.closePath();
      outlined(ctx, '#c98446', lw);
      ctx.fillStyle = '#6b3d1f';
      ctx.fillRect(-r * 0.7, -r * 0.98, r * 1.4, r * 0.16);
      break;
    case 'party':
      ctx.beginPath();
      ctx.moveTo(-r * 0.6, -r * 0.7);
      ctx.lineTo(r * 0.05, -r * 2.1);
      ctx.lineTo(r * 0.65, -r * 0.7);
      ctx.closePath();
      outlined(ctx, '#ff6fb5', lw);
      ctx.fillStyle = '#ffd23d';
      for (const [x, y] of [[-0.25, -1.0], [0.25, -1.25], [0, -1.6]] as const) {
        ctx.beginPath();
        ctx.arc(r * x, r * y, r * 0.11, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.beginPath();
      ctx.arc(r * 0.05, -r * 2.15, r * 0.18, 0, Math.PI * 2);
      outlined(ctx, '#3cc4ff', lw);
      break;
    case 'beanie':
      ctx.beginPath();
      ctx.arc(0, -r * 0.35, r * 0.98, Math.PI, 0);
      ctx.closePath();
      outlined(ctx, '#3cc46a', lw);
      ctx.beginPath();
      ctx.rect(-r * 1.02, -r * 0.5, r * 2.04, r * 0.3);
      outlined(ctx, '#2a9a52', lw);
      ctx.beginPath();
      ctx.arc(0, -r * 1.42, r * 0.25, 0, Math.PI * 2);
      outlined(ctx, '#ffffff', lw);
      break;
    case 'ninja':
      ctx.beginPath();
      ctx.rect(-r * 1.0, -r * 0.62, r * 2.0, r * 0.32);
      outlined(ctx, '#2b2838', lw);
      ctx.strokeStyle = '#2b2838';
      ctx.lineWidth = r * 0.16;
      ctx.beginPath();
      ctx.moveTo(-r * 0.95, -r * 0.46);
      ctx.quadraticCurveTo(-r * 1.5, -r * 0.3 + Math.sin(time * 9) * r * 0.2, -r * 2.0, -r * 0.55);
      ctx.moveTo(-r * 0.95, -r * 0.46);
      ctx.quadraticCurveTo(-r * 1.4, -r * 0.05, -r * 1.85, r * 0.05 + Math.cos(time * 8) * r * 0.15);
      ctx.stroke();
      ctx.fillStyle = '#ff4d5a';
      ctx.beginPath();
      ctx.arc(r * 0.05, -r * 0.46, r * 0.1, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'astronaut':
      ctx.fillStyle = 'rgba(190,230,255,0.35)';
      ctx.beginPath();
      ctx.arc(0, -r * 0.05, r * 1.32, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = lw * 1.2;
      ctx.stroke();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = r * 0.14;
      ctx.beginPath();
      ctx.arc(0, -r * 0.05, r * 1.15, -2.4, -1.6);
      ctx.stroke();
      ctx.beginPath();
      ctx.rect(-r * 0.9, r * 0.95, r * 1.8, r * 0.35);
      outlined(ctx, '#e8edf5', lw);
      ctx.beginPath();
      ctx.moveTo(r * 0.6, -r * 1.25);
      ctx.lineTo(r * 0.9, -r * 1.8);
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = lw;
      ctx.stroke();
      ctx.fillStyle = '#ff4d5a';
      ctx.beginPath();
      ctx.arc(r * 0.9, -r * 1.85, r * 0.13, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'flowercrown':
      ctx.strokeStyle = '#3c9a46';
      ctx.lineWidth = r * 0.13;
      ctx.beginPath();
      ctx.ellipse(0, -r * 0.62, r * 1.0, r * 0.25, 0, Math.PI, 0);
      ctx.stroke();
      for (let i = 0; i < 5; i++) {
        const a = Math.PI + (i + 0.5) * (Math.PI / 5);
        const x = Math.cos(a) * r * 1.0;
        const y = -r * 0.62 + Math.sin(a) * r * 0.25;
        ctx.fillStyle = ['#ff6fb5', '#ffd23d', '#ffffff', '#9b7bff', '#ff8a2a'][i] as string;
        star(ctx, x, y, r * 0.24, r * 0.12, 5, time * 0.5 + i);
        ctx.fill();
        ctx.fillStyle = '#ffd23d';
        ctx.beginPath();
        ctx.arc(x, y, r * 0.07, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    case 'ranger':
      ctx.beginPath();
      ctx.moveTo(-r * 1.15, r * 0.5);
      ctx.quadraticCurveTo(-r * 1.3, -r * 1.3, r * 0.1, -r * 1.25);
      ctx.quadraticCurveTo(r * 0.9, -r * 1.1, r * 1.05, -r * 0.3);
      ctx.quadraticCurveTo(r * 0.1, -r * 0.75, -r * 0.35, -r * 0.1);
      ctx.quadraticCurveTo(-r * 0.6, r * 0.4, -r * 1.15, r * 0.5);
      outlined(ctx, boss ? '#2a6b2f' : '#3c8a34', lw);
      if (boss) {
        // leafy antler crown
        ctx.strokeStyle = '#7a4a26';
        ctx.lineWidth = r * 0.16;
        for (const sx of [-0.5, 0.45]) {
          ctx.beginPath();
          ctx.moveTo(r * sx, -r * 1.05);
          ctx.lineTo(r * (sx - 0.2), -r * 1.9);
          ctx.moveTo(r * (sx - 0.1), -r * 1.5);
          ctx.lineTo(r * (sx + 0.35), -r * 1.85);
          ctx.stroke();
        }
        ctx.fillStyle = '#7fd14a';
        for (const [lx, ly] of [[-0.75, -1.95], [0.1, -1.8], [0.9, -1.85], [-0.2, -2.0]] as const) {
          ctx.beginPath();
          ctx.ellipse(r * lx, r * ly, r * 0.22, r * 0.12, 0.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      break;
    case 'knight':
      ctx.beginPath();
      ctx.arc(0, -r * 0.05, r * 1.06, Math.PI * 0.95, Math.PI * 0.05 + Math.PI * 2);
      ctx.lineTo(r * 1.0, r * 0.55);
      ctx.lineTo(-r * 1.0, r * 0.55);
      ctx.closePath();
      outlined(ctx, boss ? '#c9cfda' : '#aab4c4', lw);
      ctx.fillStyle = OUTLINE;
      ctx.fillRect(r * 0.05, -r * 0.18, r * 0.95, r * 0.16);
      ctx.fillStyle = '#ffd23d';
      ctx.fillRect(-r * 0.1, -r * 1.0, r * 0.2, r * 1.0);
      // plume
      ctx.beginPath();
      ctx.moveTo(-r * 0.05, -r * 1.0);
      ctx.quadraticCurveTo(-r * 1.2, -r * (boss ? 2.4 : 1.9), -r * 1.6, -r * 0.6);
      ctx.quadraticCurveTo(-r * 0.8, -r * 1.2, -r * 0.05, -r * 1.0);
      outlined(ctx, '#e8384a', lw);
      if (boss) {
        ctx.beginPath();
        ctx.moveTo(-r * 0.6, -r * 1.0);
        ctx.lineTo(-r * 0.5, -r * 1.45);
        ctx.lineTo(-r * 0.2, -r * 1.15);
        ctx.lineTo(r * 0.1, -r * 1.55);
        ctx.lineTo(r * 0.35, -r * 1.15);
        ctx.lineTo(r * 0.6, -r * 1.45);
        ctx.lineTo(r * 0.65, -r * 1.0);
        ctx.closePath();
        outlined(ctx, '#ffc83d', lw);
      }
      break;
    case 'nomad':
      // scarf over the mouth
      ctx.beginPath();
      ctx.moveTo(-r * 0.6, r * 0.1);
      ctx.lineTo(r * 1.0, r * 0.1);
      ctx.quadraticCurveTo(r * 0.8, r * 0.95, -r * 0.1, r * 0.85);
      ctx.closePath();
      outlined(ctx, boss ? '#7b3dd6' : '#2e8c87', lw);
      // turban
      ctx.beginPath();
      ctx.ellipse(-r * 0.05, -r * 0.6, r * 1.05, r * 0.62, 0, Math.PI, 0);
      ctx.closePath();
      outlined(ctx, boss ? '#ffe7a8' : '#f4efe6', lw);
      ctx.beginPath();
      ctx.ellipse(0, -r * 1.15, r * 0.7, r * 0.42, 0, 0, Math.PI * 2);
      outlined(ctx, boss ? '#ffe7a8' : '#f4efe6', lw);
      if (boss) {
        ctx.beginPath();
        ctx.arc(r * 0.35, -r * 0.8, r * 0.18, 0, Math.PI * 2);
        outlined(ctx, '#ff3d6e', lw * 0.7);
        ctx.beginPath();
        ctx.moveTo(r * 0.35, -r * 0.95);
        ctx.quadraticCurveTo(r * 0.9, -r * 2.2, r * 0.1, -r * 2.0);
        ctx.strokeStyle = '#ffd23d';
        ctx.lineWidth = r * 0.12;
        ctx.stroke();
      }
      break;
    case 'yeti':
      drawHorns(ctx, r, lw, true);
      ctx.fillStyle = '#ffffff';
      for (let i = 0; i < 5; i++) {
        ctx.beginPath();
        ctx.arc(-r * 0.7 + i * r * 0.35, -r * 0.85 + Math.abs(i - 2) * r * 0.12, r * 0.3, 0, Math.PI * 2);
        ctx.fill();
      }
      if (boss) {
        ctx.beginPath();
        ctx.moveTo(-r * 0.7, -r * 1.0);
        ctx.lineTo(-r * 0.5, -r * 1.7);
        ctx.lineTo(-r * 0.2, -r * 1.2);
        ctx.lineTo(r * 0.1, -r * 1.9);
        ctx.lineTo(r * 0.4, -r * 1.2);
        ctx.lineTo(r * 0.7, -r * 1.7);
        ctx.lineTo(r * 0.8, -r * 1.0);
        ctx.closePath();
        outlined(ctx, '#9fe3ff', lw);
      }
      break;
    case 'golem':
      ctx.beginPath();
      ctx.moveTo(-r * 0.95, -r * 0.3);
      ctx.lineTo(-r * 0.6, -r * 1.05);
      ctx.lineTo(-r * 0.1, -r * 0.85);
      ctx.lineTo(r * 0.3, -r * 1.2);
      ctx.lineTo(r * 0.85, -r * 0.6);
      ctx.lineTo(r * 1.0, -r * 0.25);
      ctx.closePath();
      outlined(ctx, '#4a3833', lw);
      if (boss) {
        // flaming crown
        for (let i = 0; i < 5; i++) {
          const x = -r * 0.8 + i * r * 0.4;
          const h = r * (0.7 + 0.35 * Math.sin(time * 9 + i * 1.7));
          ctx.beginPath();
          ctx.moveTo(x - r * 0.2, -r * 0.9);
          ctx.quadraticCurveTo(x, -r * 0.9 - h * 1.6, x + r * 0.2, -r * 0.9);
          ctx.fillStyle = i % 2 ? '#ffb347' : '#ff6a2a';
          ctx.fill();
        }
      }
      break;
    default:
      break;
  }
}

function drawHorns(ctx: Ctx, r: number, lw: number, yeti: boolean): void {
  for (const sx of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(sx * r * 0.7, -r * 0.55);
    ctx.quadraticCurveTo(sx * r * 1.55, -r * 0.7, sx * r * 1.35, -r * (yeti ? 1.2 : 1.55));
    ctx.quadraticCurveTo(sx * r * 1.15, -r * 0.95, sx * r * 0.55, -r * 0.85);
    ctx.closePath();
    outlined(ctx, yeti ? '#cfd6e6' : '#fff6e0', lw);
  }
}

function drawBackGear(ctx: Ctx, f: Fighter, lw: number): void {
  const look = f.setup.look;
  if (look !== 'ranger' && !(f.weapon === 'bow' || f.weapon === 'volley')) return;
  const t = f.rag.byName.torso.body;
  const p = t.getWorldPoint({ x: -0.12 * f.facing * f.rag.scale, y: -0.05 * f.rag.scale });
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(t.getAngle() + 0.35 * f.facing);
  const s = f.rag.scale;
  ctx.beginPath();
  ctx.rect(-0.07 * s, -0.25 * s, 0.14 * s, 0.42 * s);
  outlined(ctx, '#8a5a3b', lw);
  ctx.fillStyle = '#ff5a5a';
  for (const dx of [-0.04, 0.03]) {
    ctx.beginPath();
    ctx.moveTo(dx * s, -0.25 * s);
    ctx.lineTo((dx - 0.04) * s, -0.36 * s);
    ctx.lineTo((dx + 0.04) * s, -0.36 * s);
    ctx.fill();
  }
  ctx.restore();
}

function drawLavaVeins(ctx: Ctx, f: Fighter, time: number): void {
  const t = f.rag.byName.torso;
  const a = t.body.getWorldPoint({ x: 0, y: -t.spec.hh * 0.7 });
  const b = t.body.getWorldPoint({ x: 0, y: t.spec.hh * 0.5 });
  ctx.strokeStyle = `rgba(255,${140 + Math.round(Math.sin(time * 4) * 40)},40,0.9)`;
  ctx.lineWidth = 0.035 * f.rag.scale;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo((a.x + b.x) / 2 + 0.05 * f.rag.scale, (a.y + b.y) / 2);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}

function drawHeld(ctx: Ctx, f: Fighter, lw: number, time: number, phaseAim: boolean): void {
  if (f.ko) return;
  const r = f.rag;
  const sc = r.scale;
  const look = f.def.look;
  const aiming = !!f.aim && (phaseAim || f.throwT < 0.3);
  const front = r.hand(true);
  const back = r.hand(false);
  const fa = r.byName.lArmF.body.getAngle() + Math.PI / 2;
  const ba = r.byName.lArmB.body.getAngle() + Math.PI / 2;
  if (look === 'arrow') {
    const angle = aiming && f.aim ? f.aim.angle : fa;
    ctx.save();
    ctx.translate(front.x, front.y);
    ctx.rotate(aiming ? angle : (f.facing === 1 ? -0.2 : Math.PI + 0.2));
    if (!aiming && f.facing === -1) ctx.scale(1, -1);
    const tips = drawBow(ctx, lw, 0, sc * (f.def.size > 1 ? 1.2 : 1));
    const pull = aiming && f.aim ? (0.12 + f.aim.power * 0.38) * sc : 0;
    // string
    ctx.strokeStyle = '#f4efe6';
    ctx.lineWidth = Math.max(lw * 0.6, 0.015);
    ctx.beginPath();
    ctx.moveTo(tips.top.x, tips.top.y);
    ctx.lineTo(-pull, 0);
    ctx.lineTo(tips.bottom.x, tips.bottom.y);
    ctx.stroke();
    if (aiming && f.throwT > 0.3) {
      ctx.translate(-pull + 0.62 * f.def.size * 0.9, 0);
      drawItem(ctx, 'arrow', 1, lw, time);
    }
    ctx.restore();
    return;
  }
  if (look === 'bolt') {
    ctx.save();
    ctx.translate(front.x, front.y);
    ctx.rotate(aiming && f.aim ? f.aim.angle : fa);
    drawStaff(ctx, lw, sc, time);
    ctx.restore();
    return;
  }
  if (f.throwT < 1.2 && !phaseAim) return; // just thrown
  ctx.save();
  ctx.translate(back.x, back.y);
  ctx.rotate(ba);
  if (look === 'spear') ctx.translate(0.3 * sc, 0);
  if (look === 'axe') ctx.rotate(-Math.PI / 2 * f.facing * -1);
  drawItem(ctx, look, f.def.size * sc, lw, time);
  ctx.restore();
}
