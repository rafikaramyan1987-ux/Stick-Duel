// File checks of the Playgama zip (scripts/playgama/zip.mjs). Fails if
//  - index.html is not at the zip root, or a path is absolute / leaves the zip,
//  - the first script in <head> is not Playgama's CDN Bridge (https://bridge.playgama.com/v2/stable/playgama-bridge.js,
//    wiki.playgama.com/playgama/bridge-sdk/setup) loaded normally (not async / defer / module),
//  - index.html does not call bridge.initialize() in a classic script right after it, or the game bundle is not held
//    (<script type="text/plain" data-playgama-game>) until initialize() has settled (scripts/playgama/boot.js),
//  - the game code does not send the documented ready message, platform.sendMessage('game_ready'),
//  - a failed initialize() would be silent (boot.js must console.error it),
//  - playgama-bridge-config.json is missing / not JSON, or a playgama-bridge.js is shipped (Bridge comes from the CDN),
//  - "crazygames", "gamedistribution" or "gamepix" appears in any file of the zip,
//  - index.html loads anything from outside the zip except the Bridge CDN,
//  - the zip is over Playgama's 300 MB limit, or Playgama's own precheck (scripts/playgama/precheck.mjs, from the
//    official playgama-publish skill) reports a FAIL or a WARN.
// Usage: node scripts/playgama/check.mjs [zip]
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import game from './game.mjs';

const BRIDGE_CDN = 'https://bridge.playgama.com/v2/stable/playgama-bridge.js';
const BANNED = ['crazygames', 'gamedistribution', 'gamepix'];
const zip = resolve(process.argv[2] ?? `submission-playgama/${game.slug}-playgama-v${game.version}.zip`);
const errors = [];
const fail = (m) => {
  errors.push(m);
  console.info(`  ✗ ${m}`);
};
const ok = (m) => console.info(`  ✓ ${m}`);
const check = (bad, badMsg, okMsg) => (bad ? fail(badMsg) : ok(okMsg));

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
  const head = html.slice(0, html.search(/<\/head>/i));
  const scripts = [...head.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].map((m) => ({ attrs: m[1], body: m[2], tag: `<script${m[1]}>` }));
  const [first, second] = scripts;
  check(
    !first || first.attrs.trim() !== `src="${BRIDGE_CDN}"`,
    `the first script in <head> is not a plain <script src="${BRIDGE_CDN}">: ${first?.tag}`,
    `Bridge from Playgama's CDN is the first script in <head>, loaded normally: ${first?.tag}`,
  );
  check(
    !second || second.attrs.trim() !== '' || !/window\.bridge\.initialize\(\)/.test(second.body),
    `the second script in <head> is not the inline boot calling bridge.initialize(): ${second?.tag}`,
    'bridge.initialize() is called right after it, in a classic inline script (boot.js)',
  );
  check(!/console\.error\(/.test(second?.body ?? ''), 'a failed bridge.initialize() would be silent (no console.error in boot)', 'a failed bridge.initialize() is logged with console.error');
  const modules = [...html.matchAll(/<script\b[^>]*type=["']module["'][^>]*>/gi)].map((m) => m[0]);
  const held = [...html.matchAll(/<script type="text\/plain" data-playgama-game\b[^>]*>([\s\S]*?)<\/script>/g)];
  check(
    modules.length || !held.length,
    `the game bundle runs before bridge.initialize() settles (module scripts: ${modules.join(', ') || 'none'}, held: ${held.length})`,
    `the game bundle is held until bridge.initialize() has settled (${held.length} held script)`,
  );
  const game = held.map((m) => m[1]).join('\n') + entries.filter((e) => /\.m?js$/.test(e)).map((e) => readFileSync(join(dir, e), 'utf8')).join('\n');
  check(
    !/["'`]game_ready["'`]/.test(game) || !/\.sendMessage\(/.test(game),
    "the game code never sends platform.sendMessage('game_ready')",
    "the game code sends platform.sendMessage('game_ready')",
  );
  const ext = [...html.matchAll(/(?:src|href)\s*=\s*["']((?:\/(?!\/)|https?:|\/\/)[^"']*)/gi)].map((m) => m[1]).filter((u) => u !== BRIDGE_CDN);
  check(ext.length, `index.html has absolute / external paths: ${ext.join(', ')}`, 'index.html: relative paths only (and the Bridge CDN)');
}
check(entries.some((e) => /playgama-bridge[^/]*\.js$/.test(e)), 'a playgama-bridge.js is shipped in the zip: Bridge comes from the CDN', 'no Bridge copy in the zip (Bridge comes from the CDN)');
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
check(lines.some((l) => /^warn\s/.test(l)), "Playgama's precheck reports a WARN", "Playgama's precheck: no WARN");

console.info(errors.length ? `\nFAILED: ${errors.length} problem(s)` : '\nall checks passed');
process.exit(errors.length ? 1 : 0);
