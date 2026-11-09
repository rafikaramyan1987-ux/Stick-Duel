// Renders the GameDistribution thumbnails from the real GD build (dist-gd/, SDK request blocked):
// a real duel scene (castle boss, the hero's arrow about to hit) with the game title only.
// Usage: npm run build:gd && npm run thumbnails:gd
import { mkdirSync } from 'node:fs';
import { preview } from 'vite';
import { chromium } from '@playwright/test';

const OUT = process.env.THUMB_OUT ?? 'submission-gd/thumbnails';
const WORLD = Number(process.argv[2] ?? 2);
const LEVEL = Number(process.argv[3] ?? 10);
// size = css × dsf: the UI is laid out at a readable CSS size, then rendered at the exact pixel size
export const THUMBS = [
  { name: 'thumb-512x512', css: [400, 400], dsf: 1.28, title: 'square' },
  { name: 'thumb-512x384', css: [512, 384], dsf: 1, title: 'landscape' },
  { name: 'thumb-200x120', css: [400, 240], dsf: 0.5, title: 'landscape' },
  { name: 'thumb-1280x720', css: [640, 360], dsf: 2, title: 'landscape' },
  { name: 'thumb-1280x550', css: [640, 275], dsf: 2, title: 'landscape' },
];

mkdirSync(OUT, { recursive: true });
const server = await preview({ mode: 'gd', build: { outDir: 'dist-gd' }, preview: { port: 4195, strictPort: true }, logLevel: 'error' });
const browser = await chromium.launch(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {});
try {
  for (const { name, css, dsf, title } of THUMBS) {
    const ctx = await browser.newContext({ viewport: { width: css[0], height: css[1] }, deviceScaleFactor: dsf });
    const page = await ctx.newPage();
    await page.route('https://html5.api.gamedistribution.com/**', (r) => r.abort());
    await page.goto('http://localhost:4195/');
    await page.waitForSelector('#play');
    await page.evaluate(([w, l, t]) => window.__stickDuel.coverShot(w, l, t), [WORLD, LEVEL, title]);
    await page.waitForTimeout(300);
    const path = `${OUT}/${name}.png`;
    await page.screenshot({ path });
    await ctx.close();
    console.info(path);
  }
} finally {
  await browser.close();
  await server.close();
}
