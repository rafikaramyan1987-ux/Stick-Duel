// GameMonetize thumbnails: the game's cover scene (the castle boss duel of scripts/covers.mjs: the hero's arrow about
// to hit the boss) rendered at the three GameMonetize sizes WITHOUT the title logo (GameMonetize: no text or logo on
// the images), at 2x, then downscaled to JPG under 300 KB.
// Usage: npm run build && node scripts/gamemonetize/images.mjs
// Out: submission-gamemonetize/stick-duel-{512x384,512x512,512x340}.jpg
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, statSync } from 'node:fs';
import { preview } from 'vite';
import { chromium } from '@playwright/test';

const OUT = 'submission-gamemonetize';
/** framing of App.coverShot: the wide shot for the 4:3 and 3:2 images, the closer square shot for 512x512 */
const SIZES = [
  { w: 512, h: 384, framing: 'landscape' },
  { w: 512, h: 512, framing: 'square' },
  { w: 512, h: 340, framing: 'landscape' },
];
const WORLD = 2;
const LEVEL = 10;

mkdirSync(OUT, { recursive: true });
const server = await preview({ preview: { port: 4199, strictPort: true }, logLevel: 'error' });
const browser = await chromium.launch(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {});
try {
  for (const { w, h, framing } of SIZES) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    await page.goto('http://localhost:4199/');
    await page.waitForSelector('#play');
    await page.evaluate(([wd, l, t]) => window.__stickDuel.coverShot(wd, l, t), [WORLD, LEVEL, framing]);
    // no text or logo: drop the cover title and every other overlay above the canvas
    await page.evaluate(() => {
      for (const sel of ['.layer', '.hud', '.banner']) document.querySelectorAll(sel).forEach((e) => (e.style.display = 'none'));
    });
    await page.waitForTimeout(300);
    const png = `${OUT}/.tmp-${w}x${h}.png`;
    await page.screenshot({ path: png });
    await ctx.close();
    const jpg = `${OUT}/stick-duel-${w}x${h}.jpg`;
    execFileSync('convert', [png, '-filter', 'Lanczos', '-resize', `${w}x${h}!`, '-strip', '-sampling-factor', '4:2:0', '-quality', '90', '-interlace', 'JPEG', jpg]);
    rmSync(png);
    const size = statSync(jpg).size;
    if (size >= 300 * 1024) throw new Error(`${jpg}: ${size} bytes (limit 300 KB)`);
    console.info(`${jpg} (${(size / 1024).toFixed(0)} KB)`);
  }
} finally {
  await browser.close();
  await server.close();
}
