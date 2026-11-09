// Build self-check: the build folder must be a single index.html (< 50 MB portal limit; our budget 5 MB),
// with no external requests or links except the platform's own SDK script, no popups, no logins,
// and no trace of the other portal's SDK or branding.
// Usage: node scripts/check-build.mjs [web|crazygames|gd]   (default web → dist/)
import { readdirSync, readFileSync, statSync } from 'node:fs';

const platform = process.argv[2] ?? 'web';
const PLATFORMS = {
  web: { dir: 'dist', sdk: [], forbid: [/crazygames/i, /gamedistribution/i, /gdsdk/] },
  crazygames: { dir: 'dist-crazygames', sdk: ['https://sdk.crazygames.com/crazygames-sdk-v3.js'], forbid: [/gamedistribution/i, /gdsdk/, /GD_OPTIONS/] },
  gd: { dir: 'dist-gd', sdk: ['https://html5.api.gamedistribution.com/main.min.js'], forbid: [/crazygames/i, /CrazyGames/] },
};
const cfg = PLATFORMS[platform];
if (!cfg) {
  console.error(`unknown platform "${platform}" (web | crazygames | gd)`);
  process.exit(1);
}
const { dir } = cfg;
const fail = (msg) => {
  console.error(`✗ ${msg}`);
  process.exitCode = 1;
};
const files = readdirSync(dir);
if (files.length !== 1 || files[0] !== 'index.html') fail(`${dir} must contain only index.html, found: ${files.join(', ')}`);
const size = statSync(`${dir}/index.html`).size;
if (size > 50 * 1024 * 1024) fail(`build is ${size} bytes (portal limit 50 MB)`);
if (size > 5 * 1024 * 1024) fail(`build is ${size} bytes (budget 5 MB)`);
const html = readFileSync(`${dir}/index.html`, 'utf8');
const allowed = new Set([...cfg.sdk, 'http://www.w3.org/2000/svg']);
const urls = [...new Set(html.match(/https?:\/\/[a-zA-Z0-9.-]+[a-zA-Z0-9./_-]*/g) ?? [])];
for (const u of urls) if (!allowed.has(u)) fail(`external URL in the build: ${u}`);
for (const u of cfg.sdk) if (!urls.includes(u)) fail(`the ${platform} SDK (${u}) is missing from the build`);
for (const [re, what] of [[/window\.open\s*\(/, 'window.open (popup / external link)'], [/<a\s[^>]*href=/i, 'an <a href> link'], [/target=["']_blank/i, 'a target=_blank link']]) {
  if (re.test(html)) fail(`build contains ${what}`);
}
for (const re of cfg.forbid) if (re.test(html)) fail(`the ${platform} build mentions another portal (${re})`);
if (!process.exitCode) console.info(`✓ ${dir}/index.html (${platform}): ${(size / 1024).toFixed(0)} KB, single file, no external links (${urls.length} allowed URL${urls.length === 1 ? '' : 's'})`);
