// Static checks of a GameMonetize zip (scripts/gamemonetize/zip.mjs) and the submission images. Fails if
//  - index.html is not at the zip root, or a path in the zip is absolute / leaves the zip,
//  - index.html or the game references a file by an absolute path or another http(s) URL than GameMonetize's sdk.js,
//  - the bundle does not contain the GameMonetize game ID / sdk.js URL, or contains another portal's SDK
//    (crazygames / gamedistribution / gamepix / playgama / Y8 / googlesyndication), an iframe, an <a href> or window.open,
//  - a submission image is missing, not 512x384 / 512x512 / 512x340 JPEG, or 300 KB or more.
// Usage: node scripts/gamemonetize/check.mjs [zip]
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const zip = resolve(process.argv[2] ?? 'submission-gamemonetize/stick-duel-gamemonetize-v1.zip');
const GAME_ID = 'qgdkibss7nawv209v2pfh8txf4p94eas';
const SDK = 'https://api.gamemonetize.com/sdk.js';
const BANNED = ['crazygames', 'gamedistribution', 'gdsdk', 'gamepix', 'playgama', 'cdn.y8.com', 'y8sdk', 'googlesyndication', '<iframe', '<a href', 'window.open'];
/** URLs that are data, not requests (XML namespaces) */
const NAMESPACE = /^https?:\/\/www\.w3\.org\//;
const errors = [];
const check = (bad, badMsg, okMsg) => {
  if (bad) {
    errors.push(badMsg);
    console.info(`  ✗ ${badMsg}`);
  } else console.info(`  ✓ ${okMsg}`);
};

console.info(`zip: ${zip} (${(statSync(zip).size / 1024).toFixed(0)} KB)`);
const entries = execFileSync('unzip', ['-Z1', zip], { encoding: 'utf8' }).split('\n').filter(Boolean);
check(!entries.includes('index.html'), 'index.html is not at the zip root', 'index.html at the zip root');
const unsafe = entries.filter((e) => e.startsWith('/') || e.split('/').includes('..') || e.includes('\\'));
check(unsafe.length, `unsafe paths in the zip: ${unsafe.join(', ')}`, `${entries.length} files, all relative`);
check(statSync(zip).size >= 50 * 1024 * 1024, 'zip is 50 MB or more', 'zip under 50 MB');

const dir = mkdtempSync(join(tmpdir(), 'gmzip-'));
execFileSync('unzip', ['-q', zip, '-d', dir]);
const files = [];
const walk = (d) => readdirSync(d, { withFileTypes: true }).forEach((e) => (e.isDirectory() ? walk(join(d, e.name)) : files.push(join(d, e.name))));
walk(dir);
const text = files.filter((f) => /\.(html|js|css|json)$/.test(f)).map((f) => [f.slice(dir.length + 1), readFileSync(f, 'utf8')]);
const all = text.map(([, s]) => s).join('\n');

if (existsSync(join(dir, 'index.html'))) {
  const html = readFileSync(join(dir, 'index.html'), 'utf8');
  const refs = [...html.matchAll(/\s(?:src|href)="([^"]*)"/g)].map((m) => m[1]);
  const bad = refs.filter((r) => !r.startsWith('./') && !r.startsWith('data:') && !r.startsWith('#'));
  check(bad.length, `index.html references non-relative paths: ${bad.join(', ')}`, `index.html: ${refs.length} references, all relative (./)`);
}
const hits = [];
for (const [f, s] of text) for (const b of BANNED) if (s.toLowerCase().includes(b)) hits.push(`${f}: "${b}"`);
check(hits.length, `banned strings: ${hits.join('; ')}`, `no ${BANNED.join(' / ')} in the bundle`);
const urls = [...new Set(all.match(/https?:\/\/[A-Za-z0-9.\-_/]+/g) ?? [])].filter((u) => !NAMESPACE.test(u));
const other = urls.filter((u) => u !== SDK);
check(other.length, `external URLs other than the SDK: ${other.join(', ')}`, `the only external URL is ${SDK}`);
check(!all.includes(SDK), `${SDK} missing`, 'GameMonetize sdk.js referenced');
check(!all.includes(GAME_ID), `game ID ${GAME_ID} missing`, `game ID ${GAME_ID} in the bundle`);
check(!all.includes('gamemonetize-sdk'), 'loader script id "gamemonetize-sdk" missing', 'README loader id "gamemonetize-sdk"');
check(!all.includes('SDK_GAME_PAUSE') || !all.includes('SDK_GAME_START'), 'SDK_GAME_PAUSE / SDK_GAME_START handling missing', 'SDK_GAME_PAUSE / SDK_GAME_START handled');

for (const [w, h] of [
  [512, 384],
  [512, 512],
  [512, 340],
]) {
  const f = `submission-gamemonetize/stick-duel-${w}x${h}.jpg`;
  if (!existsSync(f)) {
    check(true, `${f} missing`, '');
    continue;
  }
  const b = readFileSync(f);
  // JPEG: SOF0 / SOF2 marker carries height, width
  let i = 2,
    size = null;
  while (i < b.length) {
    const m = b[i + 1];
    const len = b.readUInt16BE(i + 2);
    if (m === 0xc0 || m === 0xc2) {
      size = [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)];
      break;
    }
    i += 2 + len;
  }
  const isJpg = b[0] === 0xff && b[1] === 0xd8;
  check(!isJpg || !size || size[0] !== w || size[1] !== h, `${f}: not a ${w}x${h} JPEG (${size?.join('x')})`, `${f}: ${w}x${h} JPEG`);
  check(b.length >= 300 * 1024, `${f}: ${b.length} bytes (limit 300 KB)`, `${f}: ${(b.length / 1024).toFixed(0)} KB`);
}

if (errors.length) {
  console.info(`\nFAILED: ${errors.length} problem(s)`);
  process.exit(1);
}
console.info('\nOK');
