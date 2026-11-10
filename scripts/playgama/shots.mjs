// Gameplay screenshots for Playgama's covers (square 800x800, portrait 1080x1920, landscape 1920x1080, made from
// real play): renders one of the store shots of scripts/web/game.mjs (default: the mid-level one) from the web zip
// (same game, no SDK) at a landscape, a portrait and a square size. Then Playgama's own covers script makes the covers:
//   node <playgama-publish skill>/scripts/covers.mjs --shot <out>/landscape.png --portrait <out>/portrait.png --square <out>/square.png \
//     --title "<title>" --font <the game's title font> --out submission-playgama
// Usage: node scripts/playgama/shots.mjs <out dir> [--shot 2]
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from '@playwright/test';
import web from '../web/game.mjs';
import { serve } from '../web/serve.mjs';

const args = process.argv.slice(2);
const out = resolve(args[0] ?? 'playgama-shots');
const n = args.includes('--shot') ? +args[args.indexOf('--shot') + 1] : 2;
const shot = web.shots[n - 1];
mkdirSync(out, { recursive: true });
const dir = mkdtempSync(join(tmpdir(), 'playgama-shots-'));
execFileSync('unzip', ['-q', resolve(`submission-web/${web.slug}-web-v1.zip`), '-d', dir]);
const server = await serve(dir);
const browser = await chromium.launch({ args: web.browserArgs ?? ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
// a square shot too: the square cover cropped from the wide shot would cut both fighters off
for (const [name, w, h] of [['landscape', 1920, 1080], ['portrait', 1080, 1920], ['square', 1200, 1200]]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: h > w });
  const page = await ctx.newPage();
  if (shot.save) await page.addInitScript(shot.save);
  await page.goto(`${server.origin}/game/index.html${shot.query ?? ''}`);
  await web.ready(page.mainFrame(), page);
  await shot.run(page.mainFrame(), page);
  await page.screenshot({ path: join(out, `${name}.png`) });
  console.info(`${join(out, `${name}.png`)}: ${shot.name}`);
  await ctx.close();
}
await browser.close();
server.close();
