// Checks the GamePix upload zip (CI): index.html at the zip root, the GamePix SDK v3 referenced
// as an external <script src>, no CrazyGames / GameDistribution code or strings, and no http(s)
// URL other than the GamePix SDK. The only other URL-shaped string allowed is the SVG XML
// namespace identifier (http://www.w3.org/2000/svg), which is never requested nor shown.
// Usage: node scripts/check-gamepix-zip.mjs [zip=submission-gamepix/stick-duel-gamepix-v1.zip]
import { readFileSync, statSync } from 'node:fs';
import { strFromU8, unzipSync } from 'fflate';

const ZIP = process.argv[2] ?? 'submission-gamepix/stick-duel-gamepix-v1.zip';
const SDK = 'https://integration.gamepix.com/sdk/v3/gamepix.sdk.js';
const NOT_A_LINK = new Set(['http://www.w3.org/2000/svg']);
const fail = (msg) => {
  console.error(`✗ ${msg}`);
  process.exitCode = 1;
};
const entries = unzipSync(readFileSync(ZIP));
const names = Object.keys(entries);
if (!names.includes('index.html')) fail(`index.html is not at the zip root: ${names.join(', ')}`);
let urls = new Set();
for (const [name, data] of Object.entries(entries)) {
  if (!/\.(html|js|css|json|txt|svg)$/i.test(name)) continue;
  const text = strFromU8(data);
  for (const re of [/crazygames/i, /gamedistribution/i, /gdsdk/, /GD_OPTIONS/]) if (re.test(text)) fail(`${name} mentions another portal (${re})`);
  for (const u of text.match(/https?:\/\/[a-zA-Z0-9.-]+[a-zA-Z0-9./_?=&%-]*/g) ?? []) urls.add(u);
}
urls = [...urls];
for (const u of urls) if (u !== SDK && !NOT_A_LINK.has(u)) fail(`URL other than the GamePix SDK: ${u}`);
const html = entries['index.html'] ? strFromU8(entries['index.html']) : '';
if (!html.includes(`<script src="${SDK}"></script>`)) fail('index.html does not load gamepix.sdk.js with an external <script src>');
if (!html.includes("window.GamePixConfig = { lifecycle: 'manual' }")) fail("index.html does not set GamePixConfig { lifecycle: 'manual' }");
if (html.indexOf(SDK) > html.indexOf('<script type="module"')) fail('the GamePix SDK must be loaded before the game bundle');
const total = Object.values(entries).reduce((n, b) => n + b.length, 0);
if (!process.exitCode) {
  console.info(`✓ ${ZIP}: ${names.join(', ')} at the root, ${(total / 1024).toFixed(0)} KB unpacked, ${(statSync(ZIP).size / 1024).toFixed(0)} KB zipped; GamePix SDK only (${urls.length} URL-shaped strings: ${urls.join(', ')})`);
}
