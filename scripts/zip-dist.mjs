// Packs a build folder into a zip with index.html at the zip root (CrazyGames and
// GameDistribution both expect that).
// Usage: node scripts/zip-dist.mjs [dir=dist-crazygames] [out=topple-duel-crazygames.zip]
// (npm run build:crazygames && npm run zip)
import { readdirSync, readFileSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { zipSync } from 'fflate';

const dist = process.argv[2] ?? 'dist-crazygames';
const out = process.argv[3] ?? 'topple-duel-crazygames.zip';
if (!existsSync(join(dist, 'index.html'))) {
  console.error(`${dist}/index.html not found — run a build first.`);
  process.exit(1);
}
const files = {};
let total = 0;
let count = 0;
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else {
      const data = readFileSync(p);
      files[relative(dist, p).split('\\').join('/')] = data;
      total += data.length;
      count += 1;
    }
  }
})(dist);
const zip = zipSync(files, { level: 9 });
writeFileSync(out, zip);
const mb = (n) => (n / 1024 / 1024).toFixed(2);
console.info(`${out}: ${count} files, ${mb(total)} MB unpacked, ${mb(zip.length)} MB zipped`);
if (total > 5 * 1024 * 1024) {
  console.error('Build is over the 5 MB budget!');
  process.exit(1);
}
