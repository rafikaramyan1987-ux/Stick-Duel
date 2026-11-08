// Records the CrazyGames gameplay videos by playing the real game in Chromium.
// 15–20 s (about 18 s), no sound, 1080p landscape (1920×1080) and 2:3 portrait (1080×1620), first
// frame = the cover. Several worlds, a headshot, a bonus balloon, a bomb and a boss K.O. (kill cam).
//
// Frames come from the DevTools screencast with their real timestamps (nothing is
// sped up), each clip starts once the camera has settled, and ffmpeg opens on the
// cover and encodes H.264 without audio.
//
// Usage: npm run build && npm run videos   (needs ffmpeg on the PATH)
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { preview } from 'vite';
import { chromium } from '@playwright/test';
import { renderCover } from './covers.mjs';

const OUT_DIR = process.env.VIDEO_OUT ?? 'submission/videos';
const FPS = 30;
const COVER_S = 0.9;
const FADE_S = 0.35;
const TOTAL_S = 19.5;

const FORMATS = [
  { name: 'trailer-1920x1080', w: 960, h: 540, dsf: 2, cover: 'landscape' },
  { name: 'trailer-1080x1620', w: 540, h: 810, dsf: 2, cover: 'portrait' }, // 2:3 portrait
];

/** world, level, what happens, how long to keep recording after the shot (s). */
const CLIPS = [
  { world: 2, level: 4, head: true, weapon: 'bow', hold: 2.3 },
  { world: 3, level: 6, head: false, weapon: 'axe', hold: 2.3 },
  { world: 4, level: 5, head: false, weapon: 'bow', hold: 1.9, bonus: true },
  { world: 5, level: 7, head: false, weapon: 'bomb', hold: 2.4 },
  { world: 6, level: 10, head: true, weapon: 'bow', hold: 3.4, finish: true },
];

async function recordClip(page, cdp, clip) {
  await page.evaluate(({ world, level, finish }) => {
    const app = window.__stickDuel;
    app.save.weapons = ['bow', 'axe', 'spear', 'bomb', 'boomerang', 'staff'];
    app.save.tutorial = true;
    app.save.settings.sound = false;
    app.save.settings.music = false;
    app.intro(world, level);
    app.fight();
    if (finish) {
      app.duel.fighters[1].hp = 20;
      // keep the line of fire clear for the finishing blow (and its kill cam)
      app.duel.bonuses = [];
    }
  }, clip);
  await page.waitForTimeout(900); // camera settles, "your turn" toast pops
  const frames = [];
  const onFrame = async ({ data, metadata, sessionId }) => {
    frames.push({ data, t: metadata.timestamp });
    try {
      await cdp.send('Page.screencastFrameAck', { sessionId });
    } catch {
      /* closing */
    }
  };
  cdp.on('Page.screencastFrame', onFrame);
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, everyNthFrame: 1 });
  await page.waitForTimeout(250);
  await page.evaluate(async ({ head, weapon, bonus }) => {
    const app = window.__stickDuel;
    window.__clip = { headshot: false, hits: 0, bonus: null, killcam: false };
    app.duel.on((e) => {
      if (e.type === 'hit') window.__clip.hits++;
      if (e.type === 'bonus') window.__clip.bonus = e.reward;
      if (e.type === 'killcam') window.__clip.killcam = true;
      if (e.type === 'hit' && e.zone === 'head') window.__clip.headshot = true;
    });
    const b = bonus ? app.duel.bonuses.find((x) => x.alive) : null;
    await app.demoShot(head, weapon, b ? { x: b.x, y: b.y } : undefined);
  }, clip);
  await page.waitForTimeout(clip.hold * 1000);
  const result = await page.evaluate(() => ({ ...window.__clip, enemyHp: window.__stickDuel.duel.fighters[1].hp }));
  await cdp.send('Page.stopScreencast');
  cdp.off('Page.screencastFrame', onFrame);
  return { frames, result };
}

async function record(browser, base, f, work) {
  const context = await browser.newContext({ viewport: { width: f.w, height: f.h }, deviceScaleFactor: f.dsf, locale: 'en-US' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base);
  await page.waitForSelector('#play');
  const cdp = await context.newCDPSession(page);
  const dir = join(work, f.name);
  mkdirSync(dir, { recursive: true });
  let list = 'ffconcat version 1.0\n';
  let n = 0;
  let total = 0;
  const summary = [];
  for (const clip of CLIPS) {
    const { frames, result } = await recordClip(page, cdp, clip);
    summary.push({ world: clip.world, level: clip.level, frames: frames.length, ...result });
    frames.forEach((fr, i) => {
      const file = join(dir, `f${String(n++).padStart(5, '0')}.jpg`);
      writeFileSync(file, Buffer.from(fr.data, 'base64'));
      const next = frames[i + 1]?.t ?? fr.t + 1 / FPS;
      const dur = Math.max(0.001, Math.min(0.2, next - fr.t));
      total += dur;
      list += `file '${file}'\nduration ${dur.toFixed(4)}\n`;
    });
  }
  list += `file '${join(dir, `f${String(n - 1).padStart(5, '0')}.jpg`)}'\n`;
  writeFileSync(join(dir, 'frames.ffconcat'), list);
  await context.close();
  if (errors.length) throw new Error(`page errors: ${errors.join(' | ')}`);
  console.info(f.name, JSON.stringify(summary), `${total.toFixed(1)}s of gameplay`);

  const coverPng = join(dir, 'cover.png');
  await renderCover(browser, base, { css: [f.w, f.h], dsf: f.dsf, title: f.cover }, coverPng);

  const W = f.w * f.dsf;
  const H = f.h * f.dsf;
  const out = join(OUT_DIR, `${f.name}.mp4`);
  const scale = `scale=${W}:${H}:flags=lanczos,setsar=1,fps=${FPS},format=yuv420p`;
  execFileSync('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-loop', '1', '-t', String(COVER_S + FADE_S), '-i', coverPng,
    '-f', 'concat', '-safe', '0', '-i', join(dir, 'frames.ffconcat'),
    '-filter_complex', `[0:v]${scale}[c];[1:v]${scale}[g];[c][g]xfade=transition=fade:duration=${FADE_S}:offset=${COVER_S},trim=duration=${TOTAL_S}[v]`,
    '-map', '[v]', '-an',
    '-c:v', 'libx264', '-profile:v', 'high', '-preset', 'slow', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
    out,
  ], { stdio: 'inherit' });
  const mb = statSync(out).size / 1024 / 1024;
  console.info(`${out}: ${W}x${H}, ${mb.toFixed(1)} MB`);
}

mkdirSync(OUT_DIR, { recursive: true });
const work = mkdtempSync(join(process.env.VIDEO_WORK ?? tmpdir(), 'stick-duel-videos-'));
const server = await preview({ preview: { port: 4194, strictPort: true }, logLevel: 'error' });
const base = 'http://localhost:4194/';
const browser = await chromium.launch(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {});
try {
  for (const f of FORMATS) await record(browser, base, f, work);
} finally {
  await browser.close();
  await server.close();
  rmSync(work, { recursive: true, force: true });
}
