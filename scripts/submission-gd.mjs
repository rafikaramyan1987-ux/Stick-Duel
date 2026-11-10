// Packs the GameDistribution build for upload: submission-gd/topple-duel-gd-v1.zip with
// index.html at the ROOT of the zip (GD requirement), under 50 MB.
// Usage: npm run build:gd && npm run submission:gd   (thumbnails: npm run thumbnails:gd)
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { unzipSync, zipSync } from 'fflate';

const DIR = 'dist-gd';
const OUT = 'submission-gd/topple-duel-gd-v1.zip';
const html = readFileSync(`${DIR}/index.html`);
const text = html.toString('utf8');
if (!text.includes('html5.api.gamedistribution.com/main.min.js') || !text.includes('f09f3bd24a744eefb2580b8c8f977edc')) {
  console.error(`${DIR}/index.html is not the GameDistribution build — run \`npm run build:gd\` first.`);
  process.exit(1);
}
if (/crazygames/i.test(text)) {
  console.error(`${DIR}/index.html mentions CrazyGames — the GD build must not include another portal's SDK or branding.`);
  process.exit(1);
}
const files = {};
for (const f of readdirSync(DIR)) files[f] = readFileSync(`${DIR}/${f}`);
mkdirSync('submission-gd', { recursive: true });
writeFileSync(OUT, zipSync(files, { level: 9 }));
// verify what we wrote
const entries = unzipSync(readFileSync(OUT));
const names = Object.keys(entries);
const total = Object.values(entries).reduce((n, b) => n + b.length, 0);
if (!names.includes('index.html')) {
  console.error(`index.html is not at the zip root: ${names.join(', ')}`);
  process.exit(1);
}
if (total > 50 * 1024 * 1024 || statSync(OUT).size > 50 * 1024 * 1024) {
  console.error(`zip is over the 50 MB GD limit (${total} bytes unpacked)`);
  process.exit(1);
}
const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
console.info(`${OUT}: ${names.join(', ')} (${kb(total)} unpacked, ${kb(statSync(OUT).size)} zipped)`);
for (const f of ['thumb-512x512', 'thumb-512x384', 'thumb-200x120', 'thumb-1280x720', 'thumb-1280x550']) {
  if (!existsSync(`submission-gd/thumbnails/${f}.png`)) console.warn(`missing submission-gd/thumbnails/${f}.png`);
}
if (!existsSync('submission-gd/README.md')) console.warn('missing submission-gd/README.md');
