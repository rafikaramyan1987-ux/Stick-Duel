// Playgama build as a zip with index.html at the root (run `npm run build:playgama` first).
// Usage: node scripts/playgama/zip.mjs [out.zip]   (default submission-playgama/<slug>-playgama-v<game.version>.zip)
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import game from './game.mjs';

const out = resolve(process.argv[2] ?? `submission-playgama/${game.slug}-playgama-v${game.version}.zip`);
const dist = resolve(game.dist);
if (!existsSync(`${dist}/index.html`)) throw new Error(`${game.dist}/index.html missing: run \`npm run build:playgama\` first`);
mkdirSync(dirname(out), { recursive: true });
rmSync(out, { force: true });
// the folder's contents (cwd = dist), so index.html is at the root; -X no extra attributes, -D no directory entries
execFileSync('zip', ['-r', '-9', '-X', '-D', '-q', out, '.', ...(game.exclude?.length ? ['-x', ...game.exclude] : [])], { cwd: dist, stdio: 'inherit' });
console.info(`${out} (${statSync(out).size} bytes, ${(statSync(out).size / 1024).toFixed(0)} KB)`);
