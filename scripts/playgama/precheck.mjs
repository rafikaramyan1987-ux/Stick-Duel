#!/usr/bin/env node
// Vendored unchanged (apart from this header) from Playgama's official agent plugin, skill `playgama-publish`:
// https://github.com/Playgama/playgama-plugins, skills/playgama-publish/scripts/precheck.mjs at commit
// 4547df6cc6da884d24a1416db4cde02c4d32f069. Copyright Playgama, Apache License 2.0
// (https://www.apache.org/licenses/LICENSE-2.0). Used by scripts/playgama/check.mjs.
// Checks a web game's build folder against the parts of Playgama's game requirements that the files themselves can
// show, before anything is uploaded. The numbers are the requirements' own (get_game_checklist, or the game requirements
// page of Playgama's wiki); SDK marks a required step of the Bridge SDK (the `api` page). It reads files only: it runs
// nothing and sends nothing.
//
//   node precheck.mjs <build folder> [--json]
//
// FAIL: the upload will be refused or the game breaks a requirement. WARN: look at it; a text search can be wrong
// (a URL inside a library's licence comment is not a request). Exits 1 when something fails. What only playing the
// game can show is listed at the end: play it in the QA Tool for those.
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';

const dir = process.argv.slice(2).find((a) => !a.startsWith('--'));
if (!dir || !existsSync(dir) || !statSync(dir).isDirectory()) {
  console.error('usage: node precheck.mjs <build folder>   (the folder that holds index.html, e.g. dist/)');
  process.exit(2);
}
const root = path.resolve(dir);
const MAX = 300 * 1024 * 1024;
const JUNK = /^(\.DS_Store|Thumbs\.db|desktop\.ini|\.git|__MACOSX)$/;
const TEXT = /\.(html?|m?js|cjs|css|json|txt|xml|svg)$/i;

const files = [];
(function walk(d) {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else files.push({ rel: path.relative(root, p).split(path.sep).join('/'), size: statSync(p).size, abs: p });
  }
})(root);

const rows = [];
const add = (level, item, text, detail = []) => rows.push({ level, item, text, detail });
const read = (f) => (f.size < 40 * 1024 * 1024 ? readFileSync(f.abs, 'utf8') : '');
const texts = files.filter((f) => TEXT.test(f.rel)).map((f) => ({ ...f, body: read(f) }));
const bridgeFile = (f) => /playgama-bridge[^/]*\.js$/i.test(f.rel);
// the Bridge itself carries every platform's SDK address (and Facebook's pixel): it is not the game's own code,
// whether it ships as its own file or bundled into one
const bridgeCode = (f) => bridgeFile(f) || (/playgama-bridge-config\.json/.test(f.body) && /crazy_games/.test(f.body));
const gameCode = texts.filter((f) => !bridgeCode(f));
const where = (re, list = gameCode) => list.filter((f) => re.test(f.body)).map((f) => f.rel);

// what made the build: engine builds compile the game's own code, so the code searches below only fit plain JS
const has = (re) => files.some((f) => re.test(f.rel));
const engine = has(/(^|\/)Build\/.*\.(loader|framework)\.js$/i) ? 'Unity'
  : has(/\.pck$/i) ? 'Godot'
  : has(/(^|\/)(c3runtime|c3main)\.js$/i) || has(/(^|\/)scripts\/c3/i) ? 'Construct 3'
  : has(/(^|\/)(gdjs|pixi-renderers)\//i) ? 'GDevelop'
  : has(/(^|\/)dmloader\.js$/i) ? 'Defold'
  : has(/(^|\/)html5game\//i) ? 'GameMaker'
  : has(/(^|\/)cocos(2d)?-js|(^|\/)cocos-js\//i) ? 'Cocos Creator'
  : 'plain JS';
const codeChecks = engine === 'plain JS';

// 1.3.2 index.html at the root, Latin names
if (files.some((f) => f.rel === 'index.html')) add('PASS', '1.3.2', 'index.html is at the root');
else {
  const nested = files.filter((f) => /(^|\/)index\.html$/i.test(f.rel)).map((f) => f.rel);
  add('FAIL', '1.3.2', 'no index.html at the root of the build' + (nested.length ? ': pack the folder that holds it' : ''), nested);
}
const nonLatin = files.filter((f) => /[^\x20-\x7e]/.test(f.rel)).map((f) => f.rel);
if (nonLatin.length) add('FAIL', '1.3.2', 'file or folder names with non-Latin characters', nonLatin);
else add('PASS', '1.3.2', 'every file and folder name is Latin');

// 1.3.1 size (the zip comes out smaller; pack.mjs prints its exact size)
const total = files.reduce((s, f) => s + f.size, 0);
const mb = (n) => (n / 1024 / 1024).toFixed(1) + ' MB';
if (total <= MAX) add('PASS', '1.3.1', `${mb(total)} unpacked, under the 300 MB limit`);
else add('WARN', '1.3.1', `${mb(total)} unpacked: pack it and check that the zip is 300 MB or less`);
const junk = files.filter((f) => f.rel.split('/').some((s) => JUNK.test(s))).map((f) => f.rel);
if (junk.length) add('WARN', '', 'system files in the build (pack.mjs leaves them out)', junk.slice(0, 8));
const maps = files.filter((f) => /\.map$/i.test(f.rel));
if (maps.length) add('WARN', '', `${maps.length} source map file(s), ${mb(maps.reduce((s, f) => s + f.size, 0))}: not needed by players`);

// 1.1.1 Bridge: present, and new enough for the sandbox (2.2.0); SDK: its config beside index.html
const index = texts.find((f) => f.rel === 'index.html');
const cdn = [...new Set(texts.flatMap((f) => f.body.match(/https?:\/\/bridge\.playgama\.com\/[^\s"'<>)]+/g) || []))];
const local = files.filter(bridgeFile).map((f) => f.rel);
const anyBridge = cdn.length || local.length || where(/@playgama\/bridge|bridge\.initialize\s*\(/).length;
if (!anyBridge) add('FAIL', '1.1.1', 'no Playgama Bridge SDK found: every game needs it, the sandbox included (playgama-bridge skill)');
else {
  const v1 = cdn.filter((u) => /\/v1\//.test(u));
  if (v1.length) add('FAIL', '1.1.1', 'Bridge v1 from the CDN: the sandbox takes 2.2.0 or newer (wiki: migration-v1-to-v2)', v1);
  else add('PASS', '1.1.1', 'Playgama Bridge is in the build', [...cdn, ...local]);
  for (const f of texts.filter(bridgeFile)) {
    const v = (f.body.match(/\bversion\s*[:=]\s*["'](\d+)\.(\d+)\.(\d+)["']/) || []).slice(1).map(Number);
    if (v.length === 3) {
      const ok = v[0] > 2 || (v[0] === 2 && v[1] >= 2);
      add(ok ? 'PASS' : 'FAIL', '1.1.1', `${f.rel} reads as Bridge ${v.join('.')}` + (ok ? '' : ': the sandbox takes 2.2.0 or newer'));
    }
  }
  if (!files.some((f) => /(^|\/)playgama-bridge-config\.json$/.test(f.rel)))
    add('WARN', 'SDK', 'no playgama-bridge-config.json: Bridge loads it from beside index.html (wiki: config)');
}

// root-absolute paths break when the build is served from a sub-folder
if (index) {
  const abs = [...index.body.matchAll(/\b(?:src|href)\s*=\s*["']\/(?!\/)([^"']*)["']/gi)].map((m) => '/' + m[1]);
  if (abs.length) add('WARN', '', 'index.html loads files by root-absolute paths: use relative ones (Vite: base: \'./\')', abs.slice(0, 6));
}

// 1.2.5 nothing external but the Bridge itself; 1.2.4 no external analytics; 1.2.6 links out only where allowed
const SAFE = /^(bridge\.playgama\.com|www\.w3\.org|w3\.org|localhost|127\.0\.0\.1|example\.(com|org)|schemas\.|ns\.adobe\.com|purl\.org|json-schema\.org)/;
const hosts = new Map();
for (const f of gameCode) {
  for (const m of f.body.matchAll(/https?:\/\/([a-z0-9.-]+\.[a-z]{2,})(?=[/:"'\s)<>]|$)/gi)) {
    const h = m[1].toLowerCase();
    if (SAFE.test(h)) continue;
    if (!hosts.has(h)) hosts.set(h, new Set());
    hosts.get(h).add(f.rel);
  }
}
if (!hosts.size) add('PASS', '1.2.5', 'no addresses outside the build except the Bridge CDN');
else add('WARN', '1.2.5', `${hosts.size} outside address(es) in the code: nothing may load from outside but the Bridge (a URL in a licence comment is fine)`,
  [...hosts].slice(0, 10).map(([h, fs]) => `${h}  (${[...fs].slice(0, 2).join(', ')})`));
const ANALYTICS = /googletagmanager\.com|google-analytics\.com|\bgtag\s*\(|connect\.facebook\.net|\bfbq\s*\(|mc\.yandex\.ru|cdn\.segment\.com|api\.amplitude\.com|cdn\.mxpnl\.com|static\.hotjar\.com|clarity\.ms/i;
const an = where(ANALYTICS);
if (an.length) add('FAIL', '1.2.4', 'external analytics in the build: send events through Bridge analytics instead', an);
else add('PASS', '1.2.4', 'no external analytics');
const SOCIAL = /https?:\/\/(www\.)?(facebook\.com|twitter\.com|x\.com|instagram\.com|tiktok\.com|discord\.gg|discord\.com\/invite|t\.me|youtube\.com|youtu\.be|vk\.com|reddit\.com)\//i;
const so = where(SOCIAL, gameCode.filter((f) => /\.(html?|m?js)$/i.test(f.rel)));
if (so.length) add('WARN', '1.2.6', 'links to social networks or other sites: show them only when platform.isExternalLinksAllowed is true', so.slice(0, 6));

// what the game's own code does with Bridge (plain JS only)
if (codeChecks && anyBridge) {
  const check = (item, re, ok, bad) => {
    const found = where(re);
    add(found.length ? 'PASS' : 'WARN', item, found.length ? ok : bad);
  };
  // calls where a minifier keeps them, not just names: a bundle can carry Bridge's constants without using them, and
  // can inline their values. game_ready often goes through the game's own wrapper (n(l.GAME_READY)), so it counts
  // when the name is there and some code calls sendMessage
  const ready = where(/game_ready|GAME_READY/).length && where(/sendMessage\s*\(/).length;
  add(ready ? 'PASS' : 'WARN', 'SDK', ready ? 'sends game_ready'
    : 'no game_ready message found: send platform.sendMessage(\'game_ready\') once the player can play');
  check('3.3.4', /\.on\(\s*[^,()]{0,80}(PAUSE_STATE_CHANGED|pause_state_changed)/, 'listens to the pause state', 'no PAUSE_STATE_CHANGED listener found: pause the game when the platform asks');
  check('3.3.4', /\.on\(\s*[^,()]{0,80}(AUDIO_STATE_CHANGED|audio_state_changed)|isAudioEnabled/, 'follows the audio state', 'no audio state handling found: read platform.isAudioEnabled and listen to AUDIO_STATE_CHANGED');
  check('3.2.1', /\bstorage\.(?:get|delete)\s*\(|\bstorage\.set\s*\(/, 'saves through Bridge storage', 'no bridge storage calls found: save progress through Storage (or the game saves nothing)');
  check('2.1.2', /showInterstitial\s*\(/, 'shows interstitial ads', 'no showInterstitial call found: interstitial ads are required, called at every natural pause');
  check('3.4.2', /platform\.language/, 'reads platform.language', 'platform.language is never read: use it to pick the game\'s language');
  const ls = where(/\blocalStorage\b/);
  if (ls.length) add('WARN', '3.2.1', 'localStorage in the game\'s code: progress goes through Bridge Storage only', ls.slice(0, 6));
} else if (!codeChecks) {
  add('NOTE', '', `a ${engine} build: its own code is compiled, so game_ready, storage, ads and pause can only be checked by playing it in the QA Tool`);
}

const ICON = { PASS: 'ok  ', WARN: 'warn', FAIL: 'FAIL', NOTE: 'note' };
if (process.argv.includes('--json')) console.log(JSON.stringify({ build: root, engine, bytes: total, rows }, null, 2));
else {
  console.log(`${root}  (${engine}, ${files.length} files, ${mb(total)})\n`);
  for (const r of rows) {
    console.log(`${ICON[r.level]}  ${String(r.item).padStart(5)}  ${r.text}`);
    for (const d of r.detail.slice(0, 10)) console.log(`             ${d}`);
  }
  console.log(`
Only playing the game shows the rest: ads at natural pauses and never under the finger (2.1.3-2.1.5), rewards only
for a watched ad (2.2.5), saves surviving a reload, a rotation and an ad (3.2.3), layout and fonts at every size and a
square window, no page scrollbar (1.6), touch, long press and mobile full screen (1.4), desktop controls without Esc
(1.5), real sound, a mute button and silence when hidden (3.3), a full play-through, rotation, resizing and tab
switching (1.7).
Serve the build and open get_local_game_qa_tool_link: the QA Tool runs it in the Bridge harness.`);
}
process.exit(rows.some((r) => r.level === 'FAIL') ? 1 : 0);
