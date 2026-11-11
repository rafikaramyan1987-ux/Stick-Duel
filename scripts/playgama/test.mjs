// Local test of the Playgama zip with the real Playgama Bridge (from Playgama's CDN, as in the zip), in two modes:
//  1. Bridge's mock platform (what Bridge runs outside Playgama, e.g. on localhost): the game boots, sends game_ready,
//     plays the first level, saves through Bridge Storage, shows no rewarded buttons (mock has no rewarded ads) and its
//     between-levels interstitial fails cleanly (the next level opens); no request leaves the local server.
//  2. Bridge's `playgama` platform (`?platform_id=playgama`) against a stub of the Playgama platform SDK that Bridge
//     loads (https://playgama.com/platform-sdk/v1.js is answered locally by Playwright, nothing goes out): the
//     language comes from the platform, a rewarded ad that is cancelled gives nothing (and says so), one watched to
//     the end gives the reward, the interstitial between levels shows, and the game is muted and paused while each
//     ad is open (scripts/playgama/game.mjs `silenced`), and audible again after.
// Usage: node scripts/playgama/test.mjs [zip] [--only mock|playgama]
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from '@playwright/test';
import game from './game.mjs';
import { serve } from '../web/serve.mjs';

const args = process.argv.slice(2);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
const zip = resolve(args[0] && !args[0].startsWith('--') ? args[0] : `submission-playgama/${game.slug}-playgama-v${game.version}.zip`);
const dir = mkdtempSync(join(tmpdir(), 'playgama-test-'));
execFileSync('unzip', ['-q', zip, '-d', dir]);
const server = await serve(dir);
const errors = [];
const fail = (m) => {
  errors.push(m);
  console.info(`  ✗ ${m}`);
};
const ok = (m) => console.info(`  ✓ ${m}`);
const expect = (cond, msg, detail = '') => (cond ? ok(msg) : fail(`${msg}${detail ? ` (${detail})` : ''}`));

/** the Playgama platform SDK as Bridge's playgama adapter uses it; ads open for 1.5 s, the rewarded outcome is set by the test */
const STUB = `(() => {
  let cb = () => {};
  const log = (window.__stubLog = []);
  window.__rewardedOutcome = 'complete';
  window.PLAYGAMA_SDK = {
    platformService: {
      getLanguage: () => '${game.platformLang}',
      isReady: Promise.resolve(),
      getIsPaymentsSupported: () => false,
      getIsPlayerAuthorizationSupported: () => false,
      getIsCloudSaveSupported: () => false,
      getAdditionalParams: () => ({}),
    },
    advService: {
      configureAdFrequency: async () => true,
      subscribeToAdStateChanges: (f) => (cb = f),
      showInterstitial() {
        log.push('showInterstitial');
        setTimeout(() => cb('interstitial', 'open'), 50);
        setTimeout(() => cb('interstitial', 'close'), 1500);
      },
      showRewarded() {
        const outcome = window.__rewardedOutcome;
        log.push('showRewarded:' + outcome);
        setTimeout(() => cb('rewarded', 'open'), 50);
        if (outcome === 'complete') setTimeout(() => cb('rewarded', 'rewarded'), 1400);
        setTimeout(() => cb('rewarded', 'close'), 1500);
      },
      showAdvancedBanners: async () => {},
      hideAdvancedBanners() {},
      checkAdBlock: async () => false,
    },
    gameService: { gameReady: () => log.push('gameReady'), sendMessage: (m) => log.push('sendMessage:' + m) },
    cloudSaveApi: { getState: async () => ({}), setItems: async () => {} },
  };
})();`;

const browser = await chromium.launch({
  args: game.browserArgs ?? ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});

async function open(query, { stub = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 640 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const external = [];
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => {
    const u = route.request().url();
    if (u.startsWith('https://bridge.playgama.com/')) return route.continue();
    if (stub && u === 'https://playgama.com/platform-sdk/v1.js') return route.fulfill({ contentType: 'text/javascript', body: STUB });
    external.push(u);
    return route.abort();
  });
  // every AudioContext the game makes, to see it suspended during ads
  await page.addInitScript(() => {
    const AC = window.AudioContext;
    window.__ctxs = [];
    window.AudioContext = class extends AC {
      constructor(...a) {
        super(...a);
        window.__ctxs.push(this);
      }
    };
  });
  await page.goto(`${server.origin}/?w=960&h=600&q=${encodeURIComponent('?' + query)}`);
  const frame = await (await page.waitForSelector('#f')).contentFrame();
  return { ctx, page, frame, external, pageErrors };
}

/** what the game and Bridge were doing when a step failed */
const debug = (frame) =>
  frame
    .evaluate(() => JSON.stringify({ log: window.__playgama?.log, stub: window.__stubLog, session: window.__stickDuel?.session && [window.__stickDuel.session.world, window.__stickDuel.session.level], phase: window.__stickDuel?.duel?.phase, interstitial: window.bridge?.advertisement.interstitialState }))
    .catch((e) => `debug failed: ${e.message}`);

const state = (frame) => game.silenced(frame);

// ---------------------------------------------------------------- 1. Bridge mock platform
if (only !== 'playgama') {
  console.info('Bridge mock platform (no platform_id, localhost)');
  const s = await open(game.query);
  const { frame } = s;
  try {
    await game.ready(frame, s.page);
    const info = await frame.evaluate(() => ({ id: window.bridge.platform.id, lang: document.documentElement.lang, platform: window.__playgama.name }));
    expect(info.id === 'mock' && info.platform === 'playgama', 'Bridge initialized (mock platform) before the game', JSON.stringify(info));
    await frame.waitForFunction(() => window.__playgama.log.includes('game_ready'), null, { timeout: 10_000 }).catch(() => {});
    const log0 = await frame.evaluate(() => window.__playgama.log.slice());
    expect(log0.includes('game_ready'), 'game_ready sent after the loading screen', log0.join(','));
    expect(info.lang === 'en', 'language from Bridge platform.language (browser language in mock) → English', info.lang);
    const res = await game.play(frame, s.page, { w: 960, h: 600 });
    expect(res?.won !== false, 'first level played to its result screen');
    const log1 = await frame.evaluate(() => window.__playgama.log.slice());
    expect(log1.includes('level_started') && log1.includes('level_completed'), 'level_started / level_completed sent', log1.join(','));
    expect((await frame.locator(game.reward.selector).count()) === 0, 'no rewarded buttons (mock: isRewardedSupported = false)');
    await frame.waitForTimeout(800);
    const saved = await frame.evaluate(async (key) => {
      const [v] = await window.bridge.storage.get([key]);
      return { v: typeof v === 'string' ? v.slice(0, 40) : v };
    }, game.saveKey);
    expect(saved.v, 'progress saved through Bridge Storage (bridge.storage.get returns the save)', JSON.stringify(saved));
    await game.skipGap(frame);
    await game.next(frame);
    await game.nextLevelOpened(frame);
    const log2 = await frame.evaluate(() => window.__playgama.log.slice());
    const sup = await frame.evaluate(() => window.bridge.advertisement.isInterstitialSupported);
    expect(!log2.some((x) => x.startsWith('interstitial:opened')), `between-levels slot: no interstitial (mock isInterstitialSupported = ${sup}), the next level opened`, log2.join(','));
    expect(!s.external.length, 'no external requests (mock)', s.external.join(', '));
    expect(!s.pageErrors.length, 'no page errors (mock)', s.pageErrors.join(' | '));
  } catch (e) {
    fail(`mock: ${e.message.split('\n')[0]}`);
    console.info(await debug(frame));
  }
  await s.ctx.close();
}

// ---------------------------------------------------------------- 2. Bridge playgama platform + stubbed platform SDK
if (only !== 'mock') {
  console.info('Bridge playgama platform (?platform_id=playgama, stubbed Playgama SDK)');
  const s = await open(`platform_id=playgama&${game.query}`, { stub: true });
  const { frame } = s;
  try {
    await game.ready(frame, s.page);
    const info = await frame.evaluate(() => ({ id: window.bridge.platform.id, lang: document.documentElement.lang, rewarded: window.bridge.advertisement.isRewardedSupported }));
    expect(info.id === 'playgama', 'Bridge runs its playgama adapter', info.id);
    expect(info.lang === game.platformLang, `the game starts in the platform language (${game.platformLang}) from Bridge`, info.lang);
    await frame.waitForFunction(() => window.__stubLog?.includes('gameReady'), null, { timeout: 10_000 }).catch(() => {});
    expect(await frame.evaluate(() => window.__stubLog.includes('gameReady')), 'game_ready reached the platform');
    await game.play(frame, s.page, { w: 960, h: 600 });
    const btn = frame.locator(game.reward.selector);
    expect((await btn.count()) === 1 && /\S/.test(await btn.innerText()), 'labelled rewarded button on the result screen', await btn.innerText().catch(() => ''));

    // cancelled: no reward, "No ad available…" on the button, the game stays playable
    const v0 = await game.reward.value(frame);
    await frame.evaluate(() => (window.__rewardedOutcome = 'cancel'));
    await btn.click();
    await frame.waitForTimeout(700);
    const during1 = await state(frame);
    await frame.waitForFunction(() => window.__playgama.log.includes('rewarded:closed'), null, { timeout: 10_000 });
    await frame.waitForTimeout(300);
    const v1 = await game.reward.value(frame);
    const msg = await btn.innerText().catch(() => '');
    expect(v1 === v0, 'cancelled rewarded ad: no reward', `${v0} → ${v1}`);
    expect(during1.muted && during1.adPause, 'muted + paused while the rewarded ad is open', JSON.stringify(during1));
    expect(game.adFail.test(msg), 'the button says no ad is available, then comes back (2.5 s)', msg);
    await frame.waitForTimeout(2800);

    // watched to the end: the reward
    await frame.evaluate(() => (window.__rewardedOutcome = 'complete'));
    await frame.evaluate(() => (window.__playgama.log.length = 0));
    await btn.click();
    await frame.waitForFunction(() => window.__playgama.log.includes('rewarded:closed'), null, { timeout: 10_000 });
    await frame.waitForTimeout(500);
    const v2 = await game.reward.value(frame);
    const log = await frame.evaluate(() => window.__playgama.log.slice());
    expect(v2 > v1 && log.includes('rewarded:rewarded'), 'completed rewarded ad: reward granted after the `rewarded` state', `${v1} → ${v2}; ${log.join(',')}`);
    const after = await state(frame);
    expect(!after.muted, 'audio back after the ad (player sound settings on)', JSON.stringify(after));

    // between levels: the interstitial (the 2-minute gap is skipped for the test)
    await game.skipGap(frame);
    await game.next(frame);
    await frame.waitForFunction(() => window.__playgama.log.includes('interstitial:opened'), null, { timeout: 10_000 });
    await frame.waitForTimeout(400);
    const during2 = await state(frame);
    expect(during2.muted && during2.adPause, 'muted + paused while the interstitial is open', JSON.stringify(during2));
    await game.nextLevelOpened(frame);
    const log3 = await frame.evaluate(() => window.__playgama.log.slice());
    expect(log3.includes('interstitial:closed'), 'interstitial between levels shown and closed, next level opened', log3.join(','));
    const stub = await frame.evaluate(() => window.__stubLog.slice());
    expect(stub.filter((x) => x === 'showInterstitial').length === 1, 'exactly one interstitial request', stub.join(','));
    expect(!s.external.length, 'no other external requests', s.external.join(', '));
    expect(!s.pageErrors.length, 'no page errors', s.pageErrors.join(' | '));
  } catch (e) {
    fail(`playgama: ${e.message.split('\n')[0]}`);
    console.info(await debug(frame));
  }
  await s.ctx.close();
}

await browser.close();
server.close();
console.info(errors.length ? `\nFAILED: ${errors.length} problem(s)` : '\nall Playgama tests passed');
process.exit(errors.length ? 1 : 0);
