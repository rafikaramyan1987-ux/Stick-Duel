// CrazyGames build self-check: dist/ must be a single index.html (< 50 MB; our budget 5 MB),
// with no external requests or links except the CrazyGames SDK script, no popups, no logins.
// Usage: npm run build[:crazygames] && node scripts/check-build.mjs
import { readdirSync, readFileSync, statSync } from 'node:fs';

const files = readdirSync('dist');
const fail = (msg) => {
  console.error(`✗ ${msg}`);
  process.exitCode = 1;
};
if (files.length !== 1 || files[0] !== 'index.html') fail(`dist must contain only index.html, found: ${files.join(', ')}`);
const size = statSync('dist/index.html').size;
if (size > 50 * 1024 * 1024) fail(`build is ${size} bytes (CrazyGames limit 50 MB)`);
if (size > 5 * 1024 * 1024) fail(`build is ${size} bytes (budget 5 MB)`);
const html = readFileSync('dist/index.html', 'utf8');
const allowed = new Set(['https://sdk.crazygames.com/crazygames-sdk-v3.js', 'http://www.w3.org/2000/svg']);
const urls = [...new Set(html.match(/https?:\/\/[a-zA-Z0-9.-]+[a-zA-Z0-9./_-]*/g) ?? [])];
for (const u of urls) if (!allowed.has(u)) fail(`external URL in the build: ${u}`);
for (const [re, what] of [[/window\.open\s*\(/, 'window.open (popup / external link)'], [/<a\s[^>]*href=/i, 'an <a href> link'], [/target=["']_blank/i, 'a target=_blank link']]) {
  if (re.test(html)) fail(`build contains ${what}`);
}
if (!process.exitCode) console.info(`✓ dist/index.html: ${(size / 1024).toFixed(0)} KB, single file, no external links (${urls.length} allowed URL${urls.length === 1 ? '' : 's'})`);
