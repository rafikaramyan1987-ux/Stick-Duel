#!/usr/bin/env node
/**
 * Store media from real gameplay of the web build (dist/index.html), on the game's manual clock:
 *
 *   submission/covers/cover-1920x1080.jpg, cover-800x1200.jpg, cover-800x800.jpg   (title, top-left clear)
 *   submission/videos/trailer-1920x1080.mp4, trailer-1080x1920.mp4                  (~18 s, first frame = cover,
 *                                                                                    a big chain reaction in the first 3 s)
 *   submission-gd/thumbnails/thumb-512x384.jpg, -512x512, -200x120, -1280x720, -1280x550
 *   submission-gamepix/icon-256x256.jpg, cover-1360x850.jpg
 *
 *   npm run build && node scripts/media.mjs [--no-video]
 *
 * Every shot replays a solution proven by the level checker (docs/levels-report.json): the scenes are
 * real game situations, not mock-ups. Needs ffmpeg. Optional: PW_CHROMIUM_PATH=/path/to/chromium.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';

const URL = pathToFileURL(resolve('dist/index.html')).href;
const REPORT = JSON.parse(readFileSync('docs/levels-report.json', 'utf8'));
const sol = (id) => REPORT.find((r) => r.id === id)?.solution ?? [];
const SAVE = JSON.stringify({ v: 1, levels: {}, coins: 0, tutorial: true, hints: ['ammo-fire', 'ammo-heavy', 'ammo-bomb', 'ammo-ice', 'wind', 'hint.water', 'hint.lava', 'hint.roofWood', 'hint.roofStone', 'direct'], music: false, sfx: false, lang: 'en', last: null, hat: 'crown', hats: ['headband', 'none', 'crown'], colors: ['blue'], color: 'blue', endlessBest: 0 });
const noVideo = process.argv.includes('--no-video');

/** The scenes: a level, its final (chain-reaction) shot, and how long after the shot to freeze for stills. */
const HERO = process.env.HERO ?? 'desert-2';
const CLIPS = (process.env.CLIPS ?? 'castle-1,forest-3').split(',');

for (const d of ['submission/covers', 'submission/videos', 'submission-gd/thumbnails', 'submission-gamepix']) mkdirSync(d, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.PW_CHROMIUM_PATH || undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

async function open(w, h) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.error('page error:', e.message));
  await page.addInitScript((v) => localStorage.setItem('topple-duel.save.v1', v), SAVE);
  await page.goto(URL);
  await page.waitForFunction(() => !!window.__toppleDuel?.duel, null, { timeout: 60_000 });
  await page.evaluate(() => {
    const a = window.__toppleDuel;
    a.manual = true;
    a.cinematic(true);
  });
  return page;
}

const adv = (page, s, render = true) =>
  page.evaluate(
    ([s, render]) => {
      const a = window.__toppleDuel;
      const n = Math.max(1, Math.round(s * 60));
      for (let i = 0; i < n; i++) a.advance(1 / 60, render && i === n - 1);
    },
    [s, render],
  );

/** Starts a level and plays all but the last proven shot off camera; returns the last shot. */
async function setup(page, id) {
  const shots = sol(id);
  if (!shots.length) throw new Error(`no solution for ${id}`);
  await page.evaluate((id) => {
    const a = window.__toppleDuel;
    a.play(a.levelIds().indexOf(id));
  }, id);
  await adv(page, 0.5, false);
  for (const s of shots.slice(0, -1)) {
    await page.evaluate((s) => window.__toppleDuel.shoot(s.angle, s.power, s.ammo), s);
    await page.evaluate(() => {
      const a = window.__toppleDuel;
      for (let i = 0; i < 60 * 40 && a.duel.phase !== 'aim' && a.duel.phase !== 'over'; i++) a.advance(1 / 60, false);
    });
  }
  await adv(page, 0.6, false);
  const last = shots[shots.length - 1];
  // the archer takes aim (arm and dotted guide in the shot)
  await page.evaluate((s) => window.__toppleDuel.duel.setAim(s.angle, s.power), last);
  return last;
}

/** Fires the shot and advances until a big event (explosion, break or K.O.), plus an offset. */
async function toMoment(page, shot, offset) {
  await page.evaluate((s) => window.__toppleDuel.shoot(s.angle, s.power, s.ammo), shot);
  await page.evaluate((off) => {
    const a = window.__toppleDuel;
    let hit = -1;
    const orig = a.duel.listeners.event;
    a.duel.listeners.event = (e, r) => {
      if (hit < 0 && (e.t === 'explode' || e.t === 'ko' || (e.t === 'break' && e.size > 1))) hit = a.duel.sim.time;
      orig?.(e, r);
    };
    for (let i = 0; i < 60 * 15; i++) {
      a.advance(1 / 60, false);
      if (hit >= 0 && a.duel.sim.time - hit >= off) break;
    }
    a.advance(1 / 60, true);
  }, offset);
}

async function logo(page, w, h, pos) {
  await page.evaluate(
    ([w, h, pos]) => {
      document.querySelector('.coverlogo')?.remove();
      const el = document.createElement('div');
      el.className = 'coverlogo';
      el.innerHTML = '<span class="l1">TOPPLE</span><span class="l2">DUEL</span>';
      const size = Math.min(w, h) * (pos === 'icon' ? 0.27 : 0.17);
      el.style.fontSize = `${size}px`;
      if (pos === 'bottom') {
        el.style.left = '50%';
        el.style.bottom = `${h * 0.06}px`;
        el.style.transform = 'translateX(-50%) rotate(-4deg)';
      } else if (pos === 'icon') {
        el.style.left = '50%';
        el.style.top = '50%';
        el.style.transform = 'translate(-50%, -50%) rotate(-4deg)';
      } else {
        el.style.right = `${w * 0.05}px`;
        el.style.top = `${h * 0.08}px`;
      }
      document.getElementById('app').append(el);
    },
    [w, h, pos],
  );
}

const jpg = (src, out, w, h) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', src, '-vf', `scale=${w}:${h}:flags=lanczos`, '-q:v', '3', out]);

/** A still of the hero scene at w×h (rendered at `scale`× then resized), logo placed at `pos`. */
async function still(w, h, scale, pos, out) {
  const W = Math.round(w * scale);
  const H = Math.round(h * scale);
  const page = await open(W, H);
  const last = await setup(page, HERO);
  await toMoment(page, last, 0.12);
  await logo(page, W, H, pos);
  const tmp = join(tmpdir(), `still-${W}x${H}.png`);
  await page.screenshot({ path: tmp });
  jpg(tmp, out, w, h);
  await page.close();
  console.info(out);
  return tmp;
}

// covers: title away from the top-left corner
await still(1920, 1080, 1, 'right', 'submission/covers/cover-1920x1080.jpg');
await still(800, 1200, 1, 'bottom', 'submission/covers/cover-800x1200.jpg');
await still(800, 800, 1, 'bottom', 'submission/covers/cover-800x800.jpg');
// GameDistribution thumbnails
await still(512, 384, 2, 'right', 'submission-gd/thumbnails/thumb-512x384.jpg');
await still(512, 512, 2, 'bottom', 'submission-gd/thumbnails/thumb-512x512.jpg');
await still(200, 120, 4, 'right', 'submission-gd/thumbnails/thumb-200x120.jpg');
await still(1280, 720, 1, 'right', 'submission-gd/thumbnails/thumb-1280x720.jpg');
await still(1280, 550, 1, 'right', 'submission-gd/thumbnails/thumb-1280x550.jpg');
// GamePix
await still(1360, 850, 1, 'right', 'submission-gamepix/cover-1360x850.jpg');
await still(256, 256, 3, 'icon', 'submission-gamepix/icon-256x256.jpg');

/* ------------------------------------------------------------------ */
/* Trailers                                                            */
/* ------------------------------------------------------------------ */
async function trailer(w, h, out) {
  const FPS = 30;
  const tmp = mkdtempSync(join(tmpdir(), 'topple-trailer-'));
  const page = await open(w, h);
  let n = 0;
  const frame = async () => {
    await page.evaluate((dt) => window.__toppleDuel.advance(dt, true), 1 / FPS);
    await page.screenshot({ path: join(tmp, `${String(n++).padStart(5, '0')}.png`) });
  };
  const hold = async (s) => {
    for (let i = 0; i < Math.round(s * FPS); i++) await frame();
  };
  const until = async (cond, max) => {
    for (let i = 0; i < max * FPS; i++) {
      if (await page.evaluate((c) => new Function('a', 'd', `return (${c});`)(window.__toppleDuel, window.__toppleDuel.duel), cond)) return;
      await frame();
    }
  };
  // 1) first frame = the cover: the hero scene just before the shot, with the title
  let shot = await setup(page, HERO);
  await adv(page, 0.05);
  await logo(page, w, h, h > w ? 'bottom' : 'right');
  await page.screenshot({ path: join(tmp, `${String(n++).padStart(5, '0')}.png`) });
  await hold(0.4);
  await page.evaluate(() => document.querySelector('.coverlogo')?.remove());
  // 2) the chain reaction, inside the first 3 seconds, and its slow-motion replay
  await page.evaluate((s) => window.__toppleDuel.shoot(s.angle, s.power, s.ammo), shot);
  await until("d.phase === 'replay' || d.phase === 'over'", 6);
  await hold(3.2);
  await page.evaluate(() => window.__toppleDuel.duel.skipReplay());
  // 3) two more levels, each with its winning shot
  for (const id of CLIPS) {
    shot = await setup(page, id);
    await hold(0.8);
    await page.evaluate((s) => window.__toppleDuel.shoot(s.angle, s.power, s.ammo), shot);
    await until("d.phase === 'replay' || d.phase === 'over'", 6);
    await hold(0.6);
    await page.evaluate(() => window.__toppleDuel.duel.skipReplay());
  }
  // 4) end card: the title over the last scene
  await logo(page, w, h, h > w ? 'bottom' : 'right');
  await hold(1.5);
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-framerate', String(FPS), '-i', join(tmp, '%05d.png'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '21', '-preset', 'slow', '-movflags', '+faststart', out]);
  rmSync(tmp, { recursive: true, force: true });
  console.info(`${out}: ${(n / FPS).toFixed(1)} s`);
  await page.close();
}

if (!noVideo) {
  await trailer(1920, 1080, 'submission/videos/trailer-1920x1080.mp4');
  await trailer(1080, 1920, 'submission/videos/trailer-1080x1920.mp4');
}
await browser.close();
