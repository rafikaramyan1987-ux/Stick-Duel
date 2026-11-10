#!/usr/bin/env node
/**
 * Preview material from real gameplay of the web build (dist/index.html):
 *   docs/preview/desktop-*.jpg  (1920×1080)   docs/preview/phone-*.jpg  (390×844)
 *   docs/preview/topple-duel-preview.mp4      (390×844, ~30 s: the three levels, one slow-motion chain reaction)
 *
 *   npm run build && node scripts/preview.mjs [--no-video]
 *
 * The game runs on its manual clock (window.__toppleDuel.advance), so every video frame is exactly
 * 1/30 s of game time, whatever the speed of the machine. Shots are aimed with the game's own
 * ballistic solve and fired with a real mouse drag. Needs ffmpeg for the video.
 * Optional: PW_CHROMIUM_PATH=/path/to/chromium.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';

const OUT = 'docs/preview';
const URL = pathToFileURL(resolve('dist/index.html')).href;
const SAVE_KEY = 'topple-duel.save.v1';
const RETURNING = JSON.stringify({ v: 1, levels: {}, coins: 0, tutorial: true, hints: [], music: true, sfx: true, lang: 'en', last: null });
const SOLUTIONS = [
  ['rope', 'arrow'],
  ['chain', 'arrow'],
  ['tntHigh', 'fire'],
];
const noVideo = process.argv.includes('--no-video');
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.PW_CHROMIUM_PATH || undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'],
});

async function open(w, h, returning) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.error('page error:', e.message));
  if (returning) await page.addInitScript(([k, v]) => localStorage.setItem(k, v), [SAVE_KEY, RETURNING]);
  await page.goto(URL);
  await page.waitForFunction(() => !!window.__toppleDuel?.duel, null, { timeout: 60_000 });
  await page.evaluate(() => {
    window.__toppleDuel.manual = true;
  });
  return page;
}

/** Advances game time (rendering only the last frame). */
const adv = (page, s) =>
  page.evaluate((s) => {
    const a = window.__toppleDuel;
    const n = Math.max(1, Math.round(s * 60));
    for (let i = 0; i < n; i++) a.advance(1 / 60, i === n - 1);
  }, s);

/** Advances until a condition on the duel is true (max seconds). */
const until = (page, cond, max = 15) =>
  page.evaluate(
    ([cond, max]) => {
      const a = window.__toppleDuel;
      const f = new Function('a', 'd', `return (${cond});`);
      for (let i = 0; i < max * 60 && !f(a, a.duel); i++) a.advance(1 / 60, false);
      a.advance(1 / 60, true);
    },
    [cond, max],
  );

/** The drag (screen start → end) that fires the shot the game's solver found for a target. */
async function plannedDrag(page, target, ammo) {
  return page.evaluate(
    ([target, ammo]) => {
      const a = window.__toppleDuel;
      if (!a.aimAtTarget(target, ammo)) throw new Error(`no aim for ${target}`);
      const { angle, power } = a.duel.aim;
      const w = a.stage.width;
      const h = a.stage.height;
      const full = Math.min(w, h) * 0.36;
      const x0 = w * 0.55;
      const y0 = h * (h > w ? 0.5 : 0.45);
      return { x0, y0, x1: x0 - Math.cos(angle) * power * full, y1: y0 - Math.sin(angle) * power * full };
    },
    [target, ammo],
  );
}

const shot = (page, name) => page.screenshot({ path: join(OUT, name), type: 'jpeg', quality: 88 });

/* ------------------------------------------------------------------ */
/* Screenshots                                                         */
/* ------------------------------------------------------------------ */
{
  // desktop: title, castle chandelier drop, desert chain explosion
  const page = await open(1920, 1080, true);
  await adv(page, 1.5);
  await shot(page, 'desktop-1-title.jpg');
  await page.evaluate(() => window.__toppleDuel.play(1));
  await adv(page, 2.2);
  await page.evaluate(() => {
    window.__toppleDuel.aimAtTarget('chain', 'arrow');
    window.__toppleDuel.autoFire();
  });
  await until(page, "d.sim.ropes[0] && !d.sim.ropes[0].joint", 5);
  await adv(page, 0.32);
  await shot(page, 'desktop-2-castle-chandelier.jpg');
  await page.evaluate(() => {
    const a = window.__toppleDuel;
    a.save.hints = ['castle-1', 'desert-1'];
    a.play(2);
  });
  await adv(page, 2.2);
  await page.evaluate(() => {
    window.__toppleDuel.aimAtTarget('tntHigh', 'fire');
    window.__toppleDuel.autoFire();
  });
  await until(page, 'd.sim.stats && d.sim.stats.explosions >= 2', 8);
  await adv(page, 0.12);
  await shot(page, 'desktop-3-desert-chain-reaction.jpg');
  await page.close();
}
{
  // phone: first-visit tutorial, the log rolling, the win screen
  const page = await open(390, 844, false);
  await adv(page, 2.2);
  const d = await plannedDrag(page, 'rope', 'arrow');
  await page.mouse.move(d.x0, d.y0);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) {
    await page.mouse.move(d.x0 + ((d.x1 - d.x0) * i) / 8, d.y0 + ((d.y1 - d.y0) * i) / 8);
    await adv(page, 0.05);
  }
  await adv(page, 0.6);
  await shot(page, 'phone-1-tutorial-aim.jpg');
  await page.mouse.up();
  await until(page, '!d.sim.fighters[1].alive', 10);
  await adv(page, 0.15);
  await shot(page, 'phone-2-log-knockout.jpg');
  await page.evaluate(() => window.__toppleDuel.play(2));
  await adv(page, 2.2);
  await page.evaluate(() => {
    window.__toppleDuel.aimAtTarget('tntHigh', 'fire');
    window.__toppleDuel.autoFire();
  });
  await until(page, "a.screen === 'result'", 30);
  await adv(page, 1.4);
  await shot(page, 'phone-3-win-stars.jpg');
  await page.close();
}
console.info('screenshots done');

/* ------------------------------------------------------------------ */
/* Video                                                               */
/* ------------------------------------------------------------------ */
if (!noVideo) {
  const FPS = 30;
  const tmp = mkdtempSync(join(tmpdir(), 'topple-video-'));
  const page = await open(390, 844, false);
  let n = 0;
  const frame = async () => {
    await page.evaluate((dt) => window.__toppleDuel.advance(dt, true), 1 / FPS);
    await page.screenshot({ path: join(tmp, `${String(n++).padStart(5, '0')}.png`) });
  };
  const hold = async (s) => {
    for (let i = 0; i < Math.round(s * FPS); i++) await frame();
  };
  const holdUntil = async (cond, max) => {
    for (let i = 0; i < max * FPS; i++) {
      if (await page.evaluate((c) => new Function('a', 'd', `return (${c});`)(window.__toppleDuel, window.__toppleDuel.duel), cond)) return;
      await frame();
    }
  };
  const dragShot = async (target, ammo, seconds) => {
    const d = await plannedDrag(page, target, ammo);
    await page.mouse.move(d.x0, d.y0);
    await page.mouse.down();
    const k = Math.round(seconds * FPS);
    for (let i = 1; i <= k; i++) {
      const e = 1 - Math.pow(1 - i / k, 2);
      await page.mouse.move(d.x0 + (d.x1 - d.x0) * e, d.y0 + (d.y1 - d.y0) * e);
      await frame();
    }
    await hold(0.25);
    await page.mouse.up();
  };
  for (const [i, [target, ammo]] of SOLUTIONS.entries()) {
    if (i > 0) {
      await page.evaluate((i) => {
        const a = window.__toppleDuel;
        a.save.hints = [];
        a.play(i);
      }, i);
    }
    await hold(i === 0 ? 1.5 : 0.9);
    if (i === 2) {
      await page.evaluate(() => window.__toppleDuel.pickAmmo('fire'));
      await hold(0.3);
    }
    await dragShot(target, ammo, 0.8);
    await holdUntil("d.phase === 'replay' || d.phase === 'over'", 14);
    if (i < 2) {
      // levels 1 and 2: straight to the result; level 3: the full slow-motion replay of the chain reaction
      await page.evaluate(() => window.__toppleDuel.duel.skipReplay());
    }
    await holdUntil("a.screen === 'result'", 12);
    await hold(i === 2 ? 1.8 : 0.8);
  }
  const out = join(OUT, 'topple-duel-preview.mp4');
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-framerate', String(FPS), '-i', join(tmp, '%05d.png'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-preset', 'slow', '-movflags', '+faststart', out]);
  rmSync(tmp, { recursive: true, force: true });
  console.info(`video: ${out} (${(n / FPS).toFixed(1)} s)`);
  await page.close();
}
await browser.close();
