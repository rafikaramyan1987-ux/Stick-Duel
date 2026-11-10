// Checks an open-portal web zip (scripts/web/zip.mjs) the way a portal hosts it: unzipped on a static server and
// shown in an iframe. Fails if
//  - index.html is not at the zip root, or a path in the zip is absolute / leaves the zip,
//  - "crazygames", "gamedistribution", "gamepix" or "googlesyndication" appears in any file of the bundle,
//  - index.html references an http(s) script / stylesheet / font / image, or uses root-absolute paths,
//  - any http(s) / ws(s) request leaves the local server at runtime (boot, first level, every iframe size),
//  - the game has an external link (<a href="http…">, window.open) or writes an unknown localStorage key,
//  - a rewarded-ad button is visible (scripts/web/game.mjs `adSelector`),
//  - at 640x480, 960x600, 1280x720 or 390x844 the iframe document scrolls, or the canvas is not centred, sticks
//    out of the frame or fills neither its width nor its height (fresh load at each size, and a live resize).
// It plays the first level at every size (scripts/web/game.mjs `play`). With --shots <dir> it saves one
// screenshot per size (<dir>/iframe-<w>x<h>.png) of the host page with the iframe.
// --static: only the zip / file checks, no browser.
// Usage: node scripts/web/check.mjs [zip] [--static] [--shots submission-web/checks] [--sizes 640x480,960x600]
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from '@playwright/test';
import game from './game.mjs';
import { serve } from './serve.mjs';

const args = process.argv.slice(2);
const opt = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined);
const zip = resolve(args[0] && !args[0].startsWith('--') ? args[0] : `submission-web/${game.slug}-web-v1.zip`);
const shots = opt('--shots');
const SIZES = (opt('--sizes') ?? '640x480,960x600,1280x720,390x844').split(',').map((s) => s.split('x').map(Number));
const BANNED = ['crazygames', 'gamedistribution', 'gamepix', 'googlesyndication'];
const CANVAS = game.canvasSelector ?? 'canvas';
const errors = [];
const fail = (m) => {
  errors.push(m);
  console.info(`  ✗ ${m}`);
};
const ok = (m) => console.info(`  ✓ ${m}`);
/** report one check: `bad` true → fail(badMsg), else ok(okMsg) */
const check = (bad, badMsg, okMsg) => (bad ? fail(badMsg) : ok(okMsg));

// ---------------------------------------------------------------- static checks
console.info(`zip: ${zip} (${(statSync(zip).size / 1024).toFixed(0)} KB)`);
const entries = execFileSync('unzip', ['-Z1', zip], { encoding: 'utf8' }).split('\n').filter(Boolean);
check(!entries.includes('index.html'), 'index.html is not at the zip root', 'index.html at the zip root');
const unsafe = entries.filter((e) => e.startsWith('/') || e.split('/').includes('..') || e.includes('\\'));
check(unsafe.length, `unsafe paths in the zip: ${unsafe.join(', ')}`, `${entries.length} files, all relative`);

const dir = mkdtempSync(join(tmpdir(), 'webzip-'));
execFileSync('unzip', ['-q', zip, '-d', dir]);
const files = [];
const walk = (d) => readdirSync(d, { withFileTypes: true }).forEach((e) => (e.isDirectory() ? walk(join(d, e.name)) : files.push(join(d, e.name))));
walk(dir);
const hits = [];
for (const f of files) {
  const s = readFileSync(f).toString('latin1').toLowerCase();
  for (const b of BANNED) if (s.includes(b)) hits.push(`${f.slice(dir.length + 1)}: "${b}"`);
}
hits.forEach((h) => fail(`banned string in ${h}`));
if (!hits.length) ok(`no ${BANNED.join(' / ')} in the bundle`);
if (!entries.includes('index.html')) {
  console.info(`\nFAILED: ${errors.length} problem(s)`);
  process.exit(1);
}
const html = readFileSync(join(dir, 'index.html'), 'utf8');
const ext = [
  ...html.matchAll(/(?:src|href|content)\s*=\s*["']?\s*((?:https?:)?\/\/[^"'\s>]+)/gi),
  ...html.matchAll(/(?:@import\s+|url\()\s*["']?((?:https?:)?\/\/[^"')\s]+)/gi),
].map((m) => m[1]);
check(ext.length, `index.html references external URLs: ${ext.join(', ')}`, 'index.html: no external script / style / font / image URLs');
const abs = [...html.matchAll(/(?:src|href)\s*=\s*["']\/(?!\/)[^"']*/gi)].map((m) => m[0]);
check(abs.length, `index.html has root-absolute paths: ${abs.join(', ')}`, 'index.html: relative paths only');

if (args.includes('--static')) {
  console.info(errors.length ? `\nFAILED: ${errors.length} problem(s)` : '\nstatic checks passed');
  process.exit(errors.length ? 1 : 0);
}

// ---------------------------------------------------------------- static server + iframe host page
const server = await serve(dir);
const origin = server.origin;

const GL = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'];
// game.mjs `browserArgs` replaces the software-WebGL flags (a 2D-canvas game does not need them)
const browser = await chromium.launch({ args: game.browserArgs ?? GL });
const external = new Set();
const notFound = new Set();

/** the iframe document does not scroll; its biggest visible canvas is centred, inside the frame, and fills it on one axis */
async function layout(frame, w, h, tag) {
  const m = await frame.evaluate((sel) => {
    const de = document.documentElement, b = document.body;
    const vis = [...document.querySelectorAll(sel)].map((c) => c.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0);
    const c = vis.sort((p, q) => q.width * q.height - p.width * p.height)[0];
    const cs = getComputedStyle(de), bs = getComputedStyle(b);
    return {
      iw: innerWidth, ih: innerHeight,
      sw: Math.max(de.scrollWidth, b.scrollWidth), sh: Math.max(de.scrollHeight, b.scrollHeight),
      // a scrollbar can only show when overflow is not hidden / clip on both html and body
      scrollable: ![cs.overflowX, bs.overflowX].some((o) => o === 'hidden' || o === 'clip') || ![cs.overflowY, bs.overflowY].some((o) => o === 'hidden' || o === 'clip'),
      sx: scrollX, sy: scrollY,
      c: c && { l: c.left, t: c.top, r: c.right, b: c.bottom, w: c.width, h: c.height },
    };
  }, CANVAS);
  const n = errors.length;
  if (m.iw !== w || m.ih !== h) fail(`${tag}: the game sees ${m.iw}x${m.ih}`);
  if (m.sx || m.sy || (m.scrollable && (m.sw > m.iw + 1 || m.sh > m.ih + 1))) fail(`${tag}: the document scrolls (${m.sw}x${m.sh} in ${m.iw}x${m.ih}, at ${m.sx},${m.sy})`);
  if (!m.c) return fail(`${tag}: no visible canvas`);
  const { l, t, r, b, w: cw, h: ch } = m.c;
  const R = Math.round;
  if (l < -1 || t < -1 || r > w + 1 || b > h + 1) fail(`${tag}: canvas ${R(cw)}x${R(ch)} at ${R(l)},${R(t)} sticks out of the frame`);
  if (Math.abs(l - (w - r)) > 2 || Math.abs(t - (h - b)) > 2) fail(`${tag}: canvas not centred (${R(l)},${R(t)} – ${R(r)},${R(b)})`);
  if (Math.abs(cw - w) > 2 && Math.abs(ch - h) > 2) fail(`${tag}: canvas ${R(cw)}x${R(ch)} fills neither the width nor the height`);
  if (errors.length === n) ok(`${tag}: no scrollbars, canvas ${R(cw)}x${R(ch)} centred`);
}

async function noAdButtons(frame, tag) {
  if (!game.adSelector) return;
  const vis = await frame.evaluate((sel) => [...document.querySelectorAll(sel)].filter((e) => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden').map((e) => e.textContent.trim().slice(0, 40)), game.adSelector);
  check(vis.length, `${tag}: rewarded-ad buttons visible: ${vis.join(' | ')}`, `${tag}: no rewarded-ad buttons`);
}

async function open(w, h) {
  const ctx = await browser.newContext({ viewport: { width: w + 40, height: h + 40 }, deviceScaleFactor: 1, hasTouch: w < h });
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('request', (r) => {
    const u = r.url();
    if (/^(https?|wss?):/i.test(u) && !u.startsWith(origin)) external.add(u);
  });
  page.on('response', (r) => r.status() === 404 && notFound.add(r.url().slice(origin.length)));
  await page.addInitScript(() => {
    // a link out of the game: window.open / navigating the top window
    window.__opened = [];
    window.open = (u) => (window.__opened.push(String(u)), null);
  });
  await page.goto(`${origin}/?w=${w}&h=${h}&q=${encodeURIComponent(game.query ?? '')}`);
  const frame = await (await page.waitForSelector('#f')).contentFrame();
  await frame.waitForLoadState('load');
  return { ctx, page, frame, pageErrors };
}

async function finish({ frame, pageErrors }, tag) {
  const links = await frame.evaluate(() =>
    [...document.querySelectorAll('a[href], area[href], form[action]')]
      .map((a) => a.href || a.action)
      .filter((h) => /^(https?:)?\/\//i.test(h) && !h.startsWith(location.origin)),
  );
  const opened = await frame.evaluate(() => window.__opened ?? []);
  check(links.length || opened.length, `${tag}: external links ${[...links, ...opened].join(', ')}`, `${tag}: no external links`);
  const keys = await frame.evaluate(() => Object.keys(localStorage));
  const unknown = keys.filter((k) => !game.storageKeys.some((p) => (p.endsWith('*') ? k.startsWith(p.slice(0, -1)) : k === p)));
  check(unknown.length, `${tag}: unknown localStorage keys ${unknown.join(', ')}`, `${tag}: localStorage keys: ${keys.join(', ') || '(none)'}`);
  const errs = pageErrors.filter((e) => !(game.ignoreErrors ?? []).some((re) => re.test(e)));
  check(errs.length, `${tag}: page errors: ${errs.join(' | ')}`, `${tag}: no page errors`);
}

// ---------------------------------------------------------------- fresh load + first level at each size
if (shots) mkdirSync(shots, { recursive: true });
for (const [w, h] of SIZES) {
  const tag = `${w}x${h}`;
  console.info(`iframe ${tag}`);
  const s = await open(w, h);
  try {
    await game.ready(s.frame, s.page);
    await layout(s.frame, w, h, `${tag} boot`);
    await noAdButtons(s.frame, `${tag} boot`);
    const res = await game.play(s.frame, s.page, { w, h });
    check(res?.won === false, `${tag}: the first level was not won (${res?.why ?? ''})`, `${tag}: first level played${res?.note ? ` (${res.note})` : ''}`);
    await layout(s.frame, w, h, `${tag} end`);
    await noAdButtons(s.frame, `${tag} end`);
    if (shots) await s.page.screenshot({ path: join(shots, `iframe-${tag}.png`) });
    await finish(s, tag);
  } catch (e) {
    fail(`${tag}: ${e.message.split('\n')[0]}`);
  }
  await s.ctx.close();
}

// ---------------------------------------------------------------- live resize of one iframe through every size
{
  console.info('live resize');
  const [w0, h0] = SIZES[0];
  const s = await open(Math.max(...SIZES.map((z) => z[0])), Math.max(...SIZES.map((z) => z[1])));
  try {
    await game.ready(s.frame, s.page);
    for (const [w, h] of [...SIZES.slice(1), [w0, h0]]) {
      await s.page.evaluate(([w, h]) => Object.assign(document.getElementById('f'), { width: w, height: h }), [w, h]);
      await s.page.waitForTimeout(700);
      await layout(s.frame, w, h, `resize→${w}x${h}`);
    }
    await finish(s, 'resize');
  } catch (e) {
    fail(`resize: ${e.message.split('\n')[0]}`);
  }
  await s.ctx.close();
}

await browser.close();
server.close();
check(external.size, `external requests at runtime: ${[...external].join(', ')}`, 'no external (http/https/ws) requests at runtime');
if (notFound.size) console.info(`  note: 404s: ${[...notFound].join(', ')}`);
console.info(errors.length ? `\nFAILED: ${errors.length} problem(s)` : '\nall checks passed');
process.exit(errors.length ? 1 : 0);
