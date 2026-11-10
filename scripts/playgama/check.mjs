// File checks of the Playgama zip (scripts/playgama/zip.mjs). Fails if
//  - index.html is not at the zip root, or a path is absolute / leaves the zip,
//  - index.html does not load ./playgama-bridge.js as its first script (normally: not async / defer / module),
//  - playgama-bridge.js is not the pinned Bridge 2.4.1 build (vendor/playgama-bridge/, sha256) or
//    playgama-bridge-config.json is missing / not JSON,
//  - "crazygames", "gamedistribution" or "gamepix" appears in any file of the zip,
//  - the zip is over Playgama's 300 MB limit, or Playgama's own precheck (scripts/playgama/precheck.mjs, from the
//    official playgama-publish skill) reports a FAIL.
// Usage: node scripts/playgama/check.mjs [zip]
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import game from './game.mjs';

const BRIDGE_SHA256 = 'b016a8d62eeb3a5c3704f392d0ac9d4504eb6b02338042cd539e2da6a73adc25';
const BANNED = ['crazygames', 'gamedistribution', 'gamepix'];
const zip = resolve(process.argv[2] ?? `submission-playgama/${game.slug}-playgama-v1.zip`);
const errors = [];
const fail = (m) => {
  errors.push(m);
  console.info(`  ✗ ${m}`);
};
const ok = (m) => console.info(`  ✓ ${m}`);
const check = (bad, badMsg, okMsg) => (bad ? fail(badMsg) : ok(okMsg));
const sha = (buf) => createHash('sha256').update(buf).digest('hex');

const size = statSync(zip).size;
console.info(`zip: ${zip} (${size} bytes)`);
check(size > 300 * 1024 * 1024, 'zip over 300 MB', `${(size / 1024).toFixed(0)} KB, under Playgama's 300 MB limit`);
const entries = execFileSync('unzip', ['-Z1', zip], { encoding: 'utf8' }).split('\n').filter(Boolean);
check(!entries.includes('index.html'), 'index.html is not at the zip root', 'index.html at the zip root');
const unsafe = entries.filter((e) => e.startsWith('/') || e.split('/').includes('..') || e.includes('\\') || /[^\x20-\x7e]/.test(e));
check(unsafe.length, `unsafe / non-Latin paths: ${unsafe.join(', ')}`, `${entries.length} files, relative Latin paths`);
const dir = mkdtempSync(join(tmpdir(), 'playgama-'));
execFileSync('unzip', ['-q', zip, '-d', dir]);

if (entries.includes('index.html')) {
  const html = readFileSync(join(dir, 'index.html'), 'utf8');
  const first = html.match(/<script\b[^>]*>/i)?.[0] ?? '';
  const head = html.slice(0, html.search(/<\/head>/i));
  check(
    !/src=["']\.\/playgama-bridge\.js["']/.test(first) || /\b(async|defer)\b|type=["']module/i.test(first) || !head.includes(first),
    `the first script in <head> is not a plain <script src="./playgama-bridge.js">: ${first}`,
    'Bridge is referenced: <script src="./playgama-bridge.js"> is the first script in <head>, loaded normally',
  );
  const abs = [...html.matchAll(/(?:src|href)\s*=\s*["'](?:\/(?!\/)|https?:|\/\/)[^"']*/gi)].map((m) => m[0]);
  check(abs.length, `index.html has absolute / external paths: ${abs.join(', ')}`, 'index.html: relative paths only');
}
if (entries.includes('playgama-bridge.js')) {
  const got = sha(readFileSync(join(dir, 'playgama-bridge.js')));
  const vendored = sha(readFileSync('vendor/playgama-bridge/playgama-bridge.js'));
  check(got !== BRIDGE_SHA256 || vendored !== BRIDGE_SHA256, `playgama-bridge.js is not the pinned Bridge 2.4.1 build (zip ${got}, vendor ${vendored})`, 'playgama-bridge.js = Bridge 2.4.1 standalone playgama build (sha256 pinned)');
} else fail('playgama-bridge.js missing from the zip');
try {
  JSON.parse(readFileSync(join(dir, 'playgama-bridge-config.json'), 'utf8'));
  ok('playgama-bridge-config.json beside index.html, valid JSON');
} catch (e) {
  fail(`playgama-bridge-config.json missing or invalid: ${e.message}`);
}

const files = [];
const walk = (d) => readdirSync(d, { withFileTypes: true }).forEach((e) => (e.isDirectory() ? walk(join(d, e.name)) : files.push(join(d, e.name))));
walk(dir);
const hits = [];
for (const f of files) {
  const s = readFileSync(f).toString('latin1').toLowerCase();
  for (const b of BANNED) if (s.includes(b)) hits.push(`${f.slice(dir.length + 1)}: "${b}"`);
}
hits.forEach((h) => fail(`banned string in ${h}`));
if (!hits.length) ok(`no ${BANNED.join(' / ')} in any file of the zip (Bridge included)`);

console.info("Playgama's precheck (scripts/playgama/precheck.mjs):");
const pre = spawnSync(process.execPath, ['scripts/playgama/precheck.mjs', dir], { encoding: 'utf8' });
const lines = pre.stdout.split('\n').filter((l) => /^(ok|warn|FAIL|note)\s/.test(l) || /^\s{13}\S/.test(l));
console.info(lines.map((l) => `    ${l}`).join('\n'));
check(pre.status !== 0, "Playgama's precheck reports FAIL", "Playgama's precheck: no FAIL");

console.info(errors.length ? `\nFAILED: ${errors.length} problem(s)` : '\nall checks passed');
process.exit(errors.length ? 1 : 0);
