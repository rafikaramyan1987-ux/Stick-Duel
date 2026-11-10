// Store images for the open portals (itch.io etc.), all into submission-web/:
//  - cover-630x500.png from the main cover art (scripts/web/game.mjs `cover`: source + crop, via ImageMagick)
//  - icon-512x512.png from the existing icon (`icon`)
//  - screenshot-1..4.png at 1280x720 from real gameplay of the web zip (`shots`: start, mid-level, a mechanic, win)
// Usage: node scripts/web/store.mjs [zip] [--only cover,icon,shots] [--shot 3]
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from '@playwright/test';
import game from './game.mjs';
import { serve } from './serve.mjs';

const args = process.argv.slice(2);
const zip = resolve(args[0] && !args[0].startsWith('--') ? args[0] : `submission-web/${game.slug}-web-v1.zip`);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1].split(',') : ['cover', 'icon', 'shots'];
const out = 'submission-web';
mkdirSync(out, { recursive: true });
const magick = (...a) => execFileSync('convert', a, { stdio: 'inherit' });

if (only.includes('cover')) {
  const { src, crop } = game.cover;
  // crop (WxH+X+Y) to the 630:500 shape around the title, then scale; -strip: no metadata
  magick(src, ...(crop ? ['-crop', crop, '+repage'] : []), '-resize', '630x500^', '-gravity', 'center', '-extent', '630x500', '-strip', `${out}/cover-630x500.png`);
  console.info(`${out}/cover-630x500.png`);
}
if (only.includes('icon')) {
  magick(game.icon, '-resize', '512x512^', '-gravity', 'center', '-extent', '512x512', '-strip', `${out}/icon-512x512.png`);
  console.info(`${out}/icon-512x512.png`);
}
if (only.includes('shots')) {
  const dir = mkdtempSync(join(tmpdir(), 'webstore-'));
  execFileSync('unzip', ['-q', zip, '-d', dir]);
  const server = await serve(dir);
  const browser = await chromium.launch({ args: game.browserArgs ?? ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const pick = args.includes('--shot') ? +args[args.indexOf('--shot') + 1] : 0;
  for (const [i, shot] of game.shots.entries()) {
    if (pick && pick !== i + 1) continue;
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.info(`  page error: ${e.message}`));
    if (shot.save) await page.addInitScript(shot.save);
    await page.goto(`${server.origin}/game/index.html${shot.query ?? ''}`);
    await game.ready(page.mainFrame(), page);
    await shot.run(page.mainFrame(), page);
    const file = `${out}/screenshot-${i + 1}.png`;
    await page.screenshot({ path: file });
    console.info(`${file}: ${shot.name}`);
    await ctx.close();
  }
  await browser.close();
  server.close();
}
