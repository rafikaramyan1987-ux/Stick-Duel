// Y8 media (docs.y8.com/studio/media), all into submission-y8/media/, from the real game (the web build, dist/):
//  - screenshot-760x570-{1..4}.jpg (Standard Screenshot) and screenshot-1280x720-{1..4}.jpg (Widescreen Screenshot):
//    four gameplay moments (no menus, no title screen), each rendered natively at both sizes
//  - promo-landscape-1920x1080.jpg, promo-portrait-1080x1920.jpg, promo-card-760x570.jpg: the game's cover scene with
//    the logo (App.coverShot, as scripts/covers.mjs) rendered at those sizes
//  - gameplay-1280x720.mp4: ONE continuous, unedited take of real play (Desert boss, the player's shots by the game's
//    own "drag back and release" helper demoShot, the boss by the game's AI), 30 fps, every frame rendered, no sound.
//    The first frame is already gameplay; the headshot knockout with its kill cam lands well inside the first 20 s.
//  - gameplay-960x720.mp4: the same take for the 4:3 slot, scaled to 960x540 over a blurred fill of itself (so the
//    HUD and both fighters stay in frame; a 4:3 crop would cut them)
// The game runs on Playwright's fake clock, paused and stepped 1/30 s per frame, so the video plays at the real game speed
// however long a screenshot takes; CSS animations (toasts, stars) are stepped with it.
// Usage: npm run build && node scripts/y8/media.mjs [--only shots,promos,video] [--shot 3]
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, statSync } from 'node:fs';
import { preview } from 'vite';
import { chromium } from '@playwright/test';

const args = process.argv.slice(2);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1].split(',') : ['shots', 'promos', 'video'];
const pick = args.includes('--shot') ? +args[args.indexOf('--shot') + 1] : 0;
const OUT = 'submission-y8/media';
const MB = 1024 * 1024;
const PORT = 4189;
const BASE = `http://localhost:${PORT}/`;
mkdirSync(OUT, { recursive: true });

const jpg = (png, out, limit, extra = []) => {
  execFileSync('convert', [png, ...extra, '-strip', '-sampling-factor', '4:2:0', '-quality', '90', '-interlace', 'JPEG', out]);
  const s = statSync(out).size;
  if (s >= limit) throw new Error(`${out}: ${s} bytes, limit ${limit}`);
  console.info(`${out} (${(s / 1024).toFixed(0)} KB)`);
};

/** a returning player with every world open and every weapon (no first-visit tutorial, no tip boxes); sound off */
function returning() {
  const stars = {};
  for (let w = 1; w <= 6; w++) for (let l = 1; l <= 10; l++) stars[`${w}-${l}`] = 3;
  localStorage.setItem(
    'stick-duel.save.v1',
    JSON.stringify({
      version: 1,
      coins: 1240,
      stars,
      tutorial: true,
      tips: ['none', 'head', 'wind', 'weapons', 'bonus'],
      lastWorld: 6,
      weapons: ['bow', 'axe', 'spear', 'bomb', 'boomerang', 'staff'],
      settings: { sound: false, music: false, lang: 'en' },
    }),
  );
}

/** opens the game on the fake clock, ready on the title screen */
async function open(browser, w, h) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, locale: 'en-US' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.clock.install({ time: 0 });
  await page.addInitScript(returning);
  await page.goto(BASE);
  for (let i = 0; i < 40 && !(await page.locator('#play').count()); i++) await page.clock.runFor(250);
  await page.waitForSelector('#play');
  // freeze the clock: from here on only step() / runFor() move game time (an installed clock otherwise keeps
  // flowing in real time, so slow screenshots would speed the game up)
  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 100);
  return { ctx, page, errors };
}

/** one game frame of 1/30 s, CSS animations stepped with it */
async function step(page, ms = 1000 / 30) {
  await page.clock.runFor(ms);
  await page.evaluate((ms) => {
    for (const a of document.getAnimations()) {
      if (a.playState !== 'paused') a.pause();
      a.currentTime = (Number(a.currentTime) || 0) + ms;
    }
  }, ms);
}

/**
 * Starts level `l` of world `w` (intro card → Fight, as a player would) and a player in the page: on each of the
 * player's turns it waits `think` ms, then the game's demoShot pulls back over ~0.7 s and releases (head shots if
 * `head`, the given weapon order). Events are logged with their game time.
 */
async function startDuel(page, w, l, { head = true, weapons = [], think = 650 } = {}) {
  await page.evaluate(
    ([w, l, head, weapons, think]) => {
      const app = window.__stickDuel;
      app.intro(w, l);
      document.querySelector('#fight').click();
      const t0 = performance.now();
      window.__ev = [];
      app.duel.on((e) => {
        if (['fire', 'hit', 'killcam', 'over', 'bonus', 'blast'].includes(e.type))
          window.__ev.push({ t: (performance.now() - t0) / 1000, type: e.type, side: e.side, zone: e.zone, ko: e.ko, winner: e.winner });
      });
      let busy = false;
      let n = 0;
      window.__driver = setInterval(() => {
        const d = app.duel;
        if (!d || busy || !d.humanAiming || window.__hold) return;
        busy = true;
        const weapon = weapons[n++];
        setTimeout(() => app.demoShot(head, weapon).finally(() => (busy = false)), think);
      }, 50);
    },
    [w, l, head, weapons, think],
  );
}

/** runs the game until `until()` holds in the page (or `maxS` game seconds) */
async function runUntil(page, until, maxS = 40) {
  for (let t = 0; t < maxS * 20; t++) {
    if (await page.evaluate((u) => (0, eval)(`(${u})`)(), String(until))) return true;
    await step(page, 50);
  }
  return false;
}

const SHOTS = [
  {
    name: 'Castle boss: dragging back to aim, dotted aim line and power arc',
    async run(page) {
      await startDuel(page, 2, 10);
      await page.evaluate(() => (window.__hold = true));
      await runUntil(page, () => window.__stickDuel.duel.humanAiming);
      for (let i = 0; i < 70; i++) await step(page);
      await page.evaluate(() => {
        const d = window.__stickDuel.duel;
        const s = d.autoShot(true);
        d.setAim(s.angle, s.power * 0.93);
      });
      for (let i = 0; i < 4; i++) await step(page);
    },
  },
  {
    name: 'Mountains: an arrow in flight across the valley',
    async run(page) {
      await startDuel(page, 3, 6, { head: false });
      await runUntil(page, () => window.__ev.some((e) => e.type === 'fire' && e.side === 0));
      for (let i = 0; i < 14; i++) await step(page);
    },
  },
  {
    name: 'Desert boss: the headshot knockout in the kill cam',
    async run(page) {
      await startDuel(page, 4, 10);
      await runUntil(page, () => window.__ev.some((e) => e.type === 'killcam' && e.side === undefined) && window.__stickDuel.duel.killCam?.phase === 'impact', 60);
      for (let i = 0; i < 3; i++) await step(page);
    },
  },
  {
    name: 'Snow: a bomb blast on the enemy cliff',
    async run(page) {
      await startDuel(page, 5, 6, { head: false, weapons: ['bomb', 'bomb', 'bomb'] });
      await runUntil(page, () => window.__ev.some((e) => e.type === 'blast'), 60);
      for (let i = 0; i < 3; i++) await step(page);
    },
  },
];

const TAKE = { world: 4, level: 10, seconds: 26, fps: 30, killcamBy: 18 };

const server = await preview({ preview: { port: PORT, strictPort: true }, logLevel: 'error' });
const browser = await chromium.launch(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {});
try {
  if (only.includes('shots')) {
    for (const [w, h, limit] of [
      [1280, 720, 5 * MB],
      [760, 570, 2 * MB],
    ]) {
      for (const [i, s] of SHOTS.entries()) {
        if (pick && pick !== i + 1) continue;
        const { ctx, page, errors } = await open(browser, w, h);
        await s.run(page);
        const png = `${OUT}/.tmp.png`;
        await page.screenshot({ path: png });
        await ctx.close();
        if (errors.length) throw new Error(`page errors: ${errors.join(' | ')}`);
        jpg(png, `${OUT}/screenshot-${w}x${h}-${i + 1}.jpg`, limit);
        rmSync(png);
        console.info(`  ${s.name}`);
      }
    }
  }

  if (only.includes('promos')) {
    for (const [css, framing, file, limit] of [
      [[960, 540], 'landscape', 'promo-landscape-1920x1080.jpg', 5 * MB],
      [[540, 960], 'portrait', 'promo-portrait-1080x1920.jpg', 5 * MB],
      [[380, 285], 'landscape', 'promo-card-760x570.jpg', 2 * MB],
    ]) {
      const ctx = await browser.newContext({ viewport: { width: css[0], height: css[1] }, deviceScaleFactor: 2 });
      const page = await ctx.newPage();
      await page.goto(BASE);
      await page.waitForSelector('#play');
      await page.evaluate((t) => window.__stickDuel.coverShot(2, 10, t), framing);
      await page.waitForTimeout(300);
      const png = `${OUT}/.tmp.png`;
      await page.screenshot({ path: png });
      await ctx.close();
      jpg(png, `${OUT}/${file}`, limit);
      rmSync(png);
    }
  }

  if (only.includes('video')) {
    const dir = `${OUT}/.frames`;
    let ok = false;
    for (let attempt = 1; attempt <= 6 && !ok; attempt++) {
      rmSync(dir, { recursive: true, force: true });
      mkdirSync(dir, { recursive: true });
      const { ctx, page, errors } = await open(browser, 1280, 720);
      await startDuel(page, TAKE.world, TAKE.level);
      const n = TAKE.seconds * TAKE.fps;
      let dropped = false;
      for (let i = 0; i < n; i++) {
        await step(page);
        await page.screenshot({ path: `${dir}/f${String(i).padStart(4, '0')}.jpg`, type: 'jpeg', quality: 95 });
        // a take without the knockout in time (or with the player knocked out) is dropped at once
        if (i % 15 === 0) {
          const s = await page.evaluate(() => ({ kc: window.__ev.some((e) => e.type === 'killcam'), lost: window.__ev.some((e) => e.type === 'over' && e.winner !== 0) }));
          if (s.lost || (!s.kc && i / TAKE.fps > TAKE.killcamBy)) {
            dropped = true;
            break;
          }
        }
      }
      const ev = await page.evaluate(() => window.__ev);
      await ctx.close();
      if (errors.length) throw new Error(`page errors: ${errors.join(' | ')}`);
      const kc = ev.find((e) => e.type === 'killcam');
      const over = ev.find((e) => e.type === 'over');
      console.info(`take ${attempt}: ${ev.map((e) => `${e.t.toFixed(1)}s ${e.type}${e.side !== undefined ? `:${e.side}` : ''}${e.zone ? `:${e.zone}` : ''}${e.ko ? ':KO' : ''}`).join(', ')}`);
      ok = !dropped && !!kc && kc.t <= TAKE.killcamBy && over?.winner === 0 && over.t < TAKE.seconds - 6;
    }
    if (!ok) throw new Error('no take with the knockout inside the first 20 s');
    const enc = ['-c:v', 'libx264', '-profile:v', 'high', '-preset', 'slow', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an'];
    const wide = `${OUT}/gameplay-1280x720.mp4`;
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(TAKE.fps), '-i', `${dir}/f%04d.jpg`, ...enc, wide]);
    const square = `${OUT}/gameplay-960x720.mp4`;
    execFileSync('ffmpeg', [
      '-y', '-loglevel', 'error', '-i', wide,
      '-filter_complex', '[0:v]split[a][b];[a]scale=960:720:force_original_aspect_ratio=increase,crop=960:720,gblur=sigma=24,eq=brightness=-0.12[bg];[b]scale=960:540:flags=lanczos[fg];[bg][fg]overlay=0:90,setsar=1',
      ...enc, square,
    ]);
    rmSync(dir, { recursive: true, force: true });
    for (const f of [wide, square]) {
      const s = statSync(f).size;
      if (s >= 50 * MB) throw new Error(`${f}: ${s} bytes (limit 50 MB)`);
      console.info(`${f} (${(s / MB).toFixed(1)} MB, ${TAKE.seconds} s)`);
    }
  }
} finally {
  await browser.close();
  await server.close();
}
