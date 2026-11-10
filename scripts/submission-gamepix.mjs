// Packs the GamePix build for upload: submission-gamepix/topple-duel-gamepix-v1.zip with
// index.html at the ROOT of the zip and nothing else outside the build (dist-gamepix/).
// Usage: npm run build:gamepix && npm run submission:gamepix
// (then: node scripts/check-gamepix-zip.mjs — the same check CI runs)
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { zipSync } from 'fflate';

const DIR = 'dist-gamepix';
const OUT = 'submission-gamepix/topple-duel-gamepix-v1.zip';
const text = readFileSync(`${DIR}/index.html`, 'utf8');
if (!text.includes('integration.gamepix.com/sdk/v3/gamepix.sdk.js')) {
  console.error(`${DIR}/index.html is not the GamePix build — run \`npm run build:gamepix\` first.`);
  process.exit(1);
}
const files = {};
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else files[relative(DIR, p).split('\\').join('/')] = readFileSync(p);
  }
})(DIR);
mkdirSync('submission-gamepix', { recursive: true });
// fixed timestamp: the same build always gives the same zip
const mtime = new Date('2026-01-01T00:00:00Z');
writeFileSync(OUT, zipSync(files, { level: 9, mtime }));
console.info(`${OUT}: ${Object.keys(files).join(', ')} (${(statSync(OUT).size / 1024).toFixed(0)} KB zipped)`);
