// Packs the CrazyGames build for upload: submission/topple-duel-v1.zip, which unzips to a
// folder topple-duel-v1/ with index.html (the single-file build, SDK included) inside.
// Usage: npm run build:crazygames && npm run submission
// (covers, trailers and thumbnails: npm run build && npm run media — see scripts/media.mjs)
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { unzipSync, zipSync } from 'fflate';

const NAME = 'topple-duel-v1';
const OUT = `submission/${NAME}.zip`;
const html = readFileSync('dist-crazygames/index.html');
if (!html.includes('sdk.crazygames.com/crazygames-sdk-v3.js')) {
  console.error('dist-crazygames/index.html is not the CrazyGames build — run `npm run build:crazygames` first.');
  process.exit(1);
}
mkdirSync('submission', { recursive: true });
writeFileSync(OUT, zipSync({ [`${NAME}/index.html`]: html }, { level: 9 }));
// verify what we wrote
const entries = Object.keys(unzipSync(readFileSync(OUT)));
if (entries.length !== 1 || entries[0] !== `${NAME}/index.html`) {
  console.error(`unexpected zip content: ${entries.join(', ')}`);
  process.exit(1);
}
const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
console.info(`${OUT}: ${entries[0]} (${kb(html.length)} unpacked, ${kb(statSync(OUT).size)} zipped)`);
for (const f of ['covers/cover-1920x1080.jpg', 'covers/cover-800x1200.jpg', 'covers/cover-800x800.jpg', 'videos/trailer-1920x1080.mp4', 'videos/trailer-1080x1920.mp4', 'README.md']) {
  if (!existsSync(`submission/${f}`)) console.warn(`missing submission/${f}`);
}
