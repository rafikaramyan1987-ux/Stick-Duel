// Static checks of a Y8 zip (scripts/y8/zip.mjs) and the media in submission-y8/media (docs.y8.com/studio/media).
// Fails if
//  - index.html is not at the zip root, or a path in the zip is absolute / leaves the zip,
//  - index.html references a file by a non-relative path, or the bundle names another URL than Y8's CDN SDK,
//  - y8.min.js is not loaded from https://cdn.y8.com/minimal-sdk/2-0/y8.min.js with `async` in <head>, or the App ID /
//    Game ID / `y8sdk.ready` / emitReadyEvent / the ad callbacks are missing,
//  - another portal / ad network (crazygames, gamedistribution, gamepix, playgama, gamemonetize, googlesyndication,
//    adBreak), an <iframe>, an <a href> or window.open is in the bundle,
//  - a media file is missing, not the exact size, over its size limit (2 MB for 760x570, 5 MB for the rest, 50 MB for
//    videos) or a video is not MP4 H.264, 1280x720 / 960x720, 20–30 s.
// Usage: node scripts/y8/check.mjs [zip] [--no-media]
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const zip = resolve(args[0] && !args[0].startsWith('--') ? args[0] : 'submission-y8/stick-duel-y8-v1.zip');
const SDK = 'https://cdn.y8.com/minimal-sdk/2-0/y8.min.js';
const BANNED = ['crazygames', 'gamedistribution', 'gdsdk', 'gamepix', 'playgama', 'gamemonetize', 'googlesyndication', 'adbreak(', '<iframe', '<a href', 'window.open'];
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

const dir = mkdtempSync(join(tmpdir(), 'y8zip-'));
execFileSync('unzip', ['-q', zip, '-d', dir]);
const files = [];
const walk = (d) => readdirSync(d, { withFileTypes: true }).forEach((e) => (e.isDirectory() ? walk(join(d, e.name)) : files.push(join(d, e.name))));
walk(dir);
const text = files.filter((f) => /\.(html|js|css|json)$/.test(f)).map((f) => [f.slice(dir.length + 1), readFileSync(f, 'utf8')]);
const all = text.map(([, s]) => s).join('\n');

if (existsSync(join(dir, 'index.html'))) {
  const html = readFileSync(join(dir, 'index.html'), 'utf8');
  const refs = [...html.matchAll(/\s(?:src|href)="([^"]*)"/g)].map((m) => m[1]).filter((r) => r !== SDK);
  const bad = refs.filter((r) => !r.startsWith('./') && !r.startsWith('data:') && !r.startsWith('#'));
  check(bad.length, `index.html references non-relative paths: ${bad.join(', ')}`, `index.html: ${refs.length} game references, all relative (./)`);
  const head = html.slice(0, html.indexOf('</head>'));
  check(!head.includes(`<script src="${SDK}" async></script>`), `no <script src="${SDK}" async> in <head>`, 'y8.min.js from the Y8 CDN, async, in <head>');
}
const hits = [];
for (const [f, s] of text) for (const b of BANNED) if (s.toLowerCase().includes(b)) hits.push(`${f}: "${b}"`);
check(hits.length, `banned strings: ${hits.join('; ')}`, `no ${BANNED.join(' / ')} in the bundle`);
const urls = [...new Set(all.match(/https?:\/\/[A-Za-z0-9.\-_/]+/g) ?? [])].filter((u) => !NAMESPACE.test(u));
const other = urls.filter((u) => u !== SDK);
check(other.length, `external URLs other than the Y8 SDK: ${other.join(', ')}`, `the only external URL is ${SDK}`);
check(files.some((f) => /y8(\.min)?\.js$/i.test(f)), 'a copy of the Y8 SDK is bundled', 'no bundled copy of the Y8 SDK');
for (const [needle, what] of [
  ['6af4b1f4ca1c6869a74e0a2f', 'App ID'],
  ['292551', 'Game ID'],
  ['y8sdk.ready', '"y8sdk.ready" listener'],
  ['emitReadyEvent', 'emitReadyEvent()'],
  ['beforeAd', 'beforeAd'],
  ['afterAd', 'afterAd'],
  ['adBreakDone', 'adBreakDone'],
  ['beforeReward', 'beforeReward'],
  ['adViewed', 'adViewed'],
  ['visibilitychange', 'visibilitychange pause'],
]) check(!all.includes(needle), `${what} missing`, `${what} in the bundle`);

if (!args.includes('--no-media')) {
  const M = 'submission-y8/media';
  const MB = 1024 * 1024;
  const imgs = [
    ...[1, 2, 3, 4].map((i) => [`screenshot-760x570-${i}.jpg`, 760, 570, 2 * MB]),
    ...[1, 2, 3, 4].map((i) => [`screenshot-1280x720-${i}.jpg`, 1280, 720, 5 * MB]),
    ['promo-landscape-1920x1080.jpg', 1920, 1080, 5 * MB],
    ['promo-portrait-1080x1920.jpg', 1080, 1920, 5 * MB],
    ['promo-card-760x570.jpg', 760, 570, 2 * MB],
  ];
  for (const [f, w, h, limit] of imgs) {
    const p = `${M}/${f}`;
    if (!existsSync(p)) {
      check(true, `${p} missing`, '');
      continue;
    }
    const [iw, ih, fmt] = execFileSync('identify', ['-format', '%w %h %m', p], { encoding: 'utf8' }).trim().split(' ');
    const size = statSync(p).size;
    check(+iw !== w || +ih !== h || fmt !== 'JPEG' || size >= limit, `${p}: ${iw}x${ih} ${fmt}, ${size} bytes (want ${w}x${h} JPEG < ${limit / MB} MB)`, `${p}: ${w}x${h} JPEG, ${(size / 1024).toFixed(0)} KB`);
  }
  for (const [f, w, h] of [
    ['gameplay-1280x720.mp4', 1280, 720],
    ['gameplay-960x720.mp4', 960, 720],
  ]) {
    const p = `${M}/${f}`;
    if (!existsSync(p)) {
      check(true, `${p} missing`, '');
      continue;
    }
    const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', p], { encoding: 'utf8' }));
    const v = probe.streams.find((s) => s.codec_type === 'video');
    const dur = +probe.format.duration;
    const size = statSync(p).size;
    const ok = v && v.codec_name === 'h264' && v.width === w && v.height === h && dur >= 20 && dur <= 30 && size < 50 * MB && /mp4/.test(probe.format.format_name);
    check(!ok, `${p}: ${v?.codec_name} ${v?.width}x${v?.height}, ${dur}s, ${size} bytes (want H.264 MP4 ${w}x${h}, 20–30 s, < 50 MB)`, `${p}: H.264 MP4 ${w}x${h}, ${dur.toFixed(1)} s, ${(size / MB).toFixed(1)} MB`);
  }
}

if (errors.length) {
  console.info(`\nFAILED: ${errors.length} problem(s)`);
  process.exit(1);
}
console.info('\nOK');
