// Checks the GamePix upload zip (CI): index.html at the zip root, the GamePix SDK v3 referenced
// as an external <script src>, no CrazyGames / GameDistribution code or strings, and no http(s)
// URL other than the GamePix SDK. The only other URL-shaped string allowed is the SVG XML
// namespace identifier (http://www.w3.org/2000/svg, http://www.w3.org/1999/xhtml), which is never requested nor shown.
// The game code must assign the legacy GamePix.soundOff / GamePix.soundOn handlers and call GamePix.lang()
// (the GamePix player checks both).
// Usage: node scripts/check-gamepix-zip.mjs [zip=the newest submission-gamepix/topple-duel-gamepix-v<N>.zip]
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { strFromU8, unzipSync } from 'fflate';

const newest = () => {
  const v = readdirSync('submission-gamepix')
    .map((f) => /^topple-duel-gamepix-v(\d+)\.zip$/.exec(f))
    .filter(Boolean)
    .sort((a, b) => Number(b[1]) - Number(a[1]))[0];
  return v ? `submission-gamepix/${v[0]}` : 'submission-gamepix/topple-duel-gamepix-v1.zip';
};
const ZIP = process.argv[2] ?? newest();
/** what the GamePix player checks for in the game code */
const REQUIRED = [
  [/GamePix\.soundOff\s*=[^=]/, 'GamePix.soundOff assignment'],
  [/GamePix\.soundOn\s*=[^=]/, 'GamePix.soundOn assignment'],
  [/GamePix\.lang\(\)/, 'GamePix.lang() call'],
];
const SDK = 'https://integration.gamepix.com/sdk/v3/gamepix.sdk.js';
const NOT_A_LINK = new Set(['http://www.w3.org/2000/svg', 'http://www.w3.org/1999/xhtml']);
const fail = (msg) => {
  console.error(`✗ ${msg}`);
  process.exitCode = 1;
};
const entries = unzipSync(readFileSync(ZIP));
const names = Object.keys(entries);
if (!names.includes('index.html')) fail(`index.html is not at the zip root: ${names.join(', ')}`);
let urls = new Set();
let code = '';
for (const [name, data] of Object.entries(entries)) {
  if (!/\.(html|js|css|json|txt|svg)$/i.test(name)) continue;
  const text = strFromU8(data);
  if (/\.(html|js)$/i.test(name)) code += text;
  for (const re of [/crazygames/i, /gamedistribution/i, /gdsdk/, /GD_OPTIONS/]) if (re.test(text)) fail(`${name} mentions another portal (${re})`);
  for (const u of text.match(/https?:\/\/[a-zA-Z0-9.-]+[a-zA-Z0-9./_?=&%-]*/g) ?? []) urls.add(u);
}
for (const [re, what] of REQUIRED) if (!re.test(code)) fail(`the game code has no ${what}`);
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
