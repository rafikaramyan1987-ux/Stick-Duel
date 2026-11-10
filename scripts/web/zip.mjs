// Open-portal web build (itch.io, Newgrounds, Y8, Playgama): zips the ad-free web build so that index.html is at
// the zip root (no wrapping folder). Run the web build first (see scripts/web/game.mjs `build`).
// Usage: node scripts/web/zip.mjs [out.zip]   (default submission-web/<slug>-web-v1.zip)
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import game from './game.mjs';

const out = resolve(process.argv[2] ?? `submission-web/${game.slug}-web-v1.zip`);
const dist = resolve(game.dist);
if (!existsSync(`${dist}/index.html`)) throw new Error(`${game.dist}/index.html missing: run \`${game.build}\` first`);
mkdirSync(dirname(out), { recursive: true });
rmSync(out, { force: true });
// zip the folder's *contents* (cwd = dist), so index.html sits at the root; -X: no extra attributes, -D: no dir entries
execFileSync('zip', ['-r', '-9', '-X', '-D', '-q', out, '.', ...(game.exclude?.length ? ['-x', ...game.exclude] : [])], { cwd: dist, stdio: 'inherit' });
console.info(`${out} (${(statSync(out).size / 1024).toFixed(0)} KB)`);
