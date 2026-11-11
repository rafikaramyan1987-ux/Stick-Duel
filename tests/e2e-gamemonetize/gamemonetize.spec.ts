import { expect, test, type Page } from '@playwright/test';

/**
 * GameMonetize build (dist-gamemonetize/) smoke test. The real SDK URL is intercepted and served a stub that drives
 * SDK_OPTIONS.onEvent like the official SDK: SDK_READY on load, then for each sdk.showBanner()
 * SDK_GAME_PAUSE → (ad) → SDK_GAME_START.
 */
const GM_SDK = 'https://api.gamemonetize.com/sdk.js';
const GAME_ID = 'qgdkibss7nawv209v2pfh8txf4p94eas';
const app = 'window.__stickDuel';

/** complete: a full ad; never: showBanner() does nothing at all */
type AdMode = 'complete' | 'never';

const STUB = `(() => {
  const opts = window.SDK_OPTIONS;
  const log = (window.__gmLog = window.__gmLog || []);
  log.push('sdk-loaded:' + (opts && opts.gameId));
  const emit = (name) => { log.push(name); opts.onEvent({ name }); };
  window.sdk = {
    showBanner() {
      log.push('showBanner');
      if ((window.__gmMode || 'complete') === 'never') return;
      setTimeout(() => {
        emit('SDK_GAME_PAUSE');
        setTimeout(() => {
          window.__gmPausedDuringAd = window.__stickDuel.adPlaying;
          emit('SDK_GAME_START');
        }, 300);
      }, 50);
    },
  };
  setTimeout(() => emit('SDK_READY'), 0);
})();`;

async function boot(page: Page, mode: AdMode = 'complete', opts: { sdkFails?: boolean } = {}) {
  const errors: string[] = [];
  const external: string[] = [];
  let sdkRequests = 0;
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    // a blocked SDK shows up as a failed resource load: that is the case under test, not a game error
    if (m.type() === 'error' && !(opts.sdkFails && /Failed to load resource/.test(m.text()))) errors.push(m.text());
  });
  page.on('request', (r) => {
    const u = r.url();
    if (u === GM_SDK) return void (sdkRequests += 1);
    if (!u.startsWith('http://localhost') && !u.startsWith('data:') && !u.startsWith('blob:')) external.push(u);
  });
  await page.addInitScript((m) => ((window as unknown as { __gmMode: string }).__gmMode = m), mode);
  await page.route(GM_SDK, (r) => (opts.sdkFails ? r.abort() : r.fulfill({ contentType: 'text/javascript', body: STUB })));
  await page.goto('/');
  await expect(page.locator('#play')).toBeVisible();
  return { errors, external, sdkRequests: () => sdkRequests };
}

const log = (page: Page) => page.evaluate(() => ((window as unknown as { __gmLog?: string[] }).__gmLog ?? []).slice());

/** level 1 of world 1: one real drag shot, then the game's perfect-aim helper finishes the duel */
async function playLevel(page: Page) {
  await page.locator('.node[data-level="1"]').click();
  await expect(page.locator('#fight')).toBeVisible();
  await expect(page.locator('.btn.ad')).toHaveCount(0); // no "try a weapon" rewarded offer
  await page.locator('#fight').click();
  await expect(page.locator('.hud')).toBeVisible();
  await page.waitForFunction(`${app}.duel?.humanAiming`);
  const vp = page.viewportSize()!;
  const x0 = vp.width * 0.5;
  const y0 = vp.height * 0.55;
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(x0 - i * 12, y0 + i * 9);
  await page.mouse.up();
  await page.waitForFunction(`${app}.duel.fighters[0].shots === 1`);
  await page.evaluate(`${app}.speed = 3`);
  await page.waitForFunction(`${app}.duel.humanAiming || ${app}.duel.phase === 'over'`, null, { timeout: 30_000 });
  await page.evaluate(`(() => { const a = ${app}; a.duel.fighters[1].hp = 1; a.autoFire(false); })()`);
  await expect(page.locator('.card.result')).toBeVisible({ timeout: 30_000 });
}

test('loads the SDK once at boot, pre-roll on Play (paused + muted), a level plays, no rewarded buttons, no ad in a duel', async ({ page }) => {
  const b = await boot(page);
  // SDK_OPTIONS set before sdk.js, loaded during boot (no click yet), exactly once, with the game id
  await expect.poll(() => log(page)).toEqual([`sdk-loaded:${GAME_ID}`, 'SDK_READY']);
  expect(b.sdkRequests()).toBe(1);
  expect(await page.locator('script#gamemonetize-sdk').count()).toBe(1);
  expect(await page.evaluate(`${app}.platform.name`)).toBe('gamemonetize');

  await page.locator('#play').click();
  await expect(page.locator('.node[data-level="1"]')).toBeVisible();
  expect(await log(page)).toEqual([`sdk-loaded:${GAME_ID}`, 'SDK_READY', 'showBanner', 'SDK_GAME_PAUSE', 'SDK_GAME_START']);
  expect(await page.evaluate(() => (window as unknown as { __gmPausedDuringAd: boolean }).__gmPausedDuringAd)).toBe(true);
  expect(await page.evaluate(`${app}.adPlaying`)).toBe(false);

  const before = (await log(page)).length;
  await playLevel(page);
  expect((await log(page)).slice(before)).toEqual([]); // nothing during the duel
  await expect(page.locator('.btn.ad')).toHaveCount(0); // no ×2 coins / revive

  // a result-screen break right after the pre-roll: no second ad within ~2 minutes
  await page.locator('#retry').click();
  await expect(page.locator('#fight')).toBeVisible();
  expect((await log(page)).slice(before)).toEqual([]);

  expect(await page.evaluate(() => localStorage.getItem('stick-duel.save.v1'))).toContain('"tutorial":true');
  expect(b.external).toEqual([]);
  expect(b.errors).toEqual([]);
});

test('a result-screen break once ~2 minutes have passed: one interstitial, then the game goes on', async ({ page }) => {
  const b = await boot(page);
  await page.locator('#play').click();
  await expect(page.locator('.node[data-level="1"]')).toBeVisible();
  await playLevel(page);
  // as if two minutes had passed since the pre-roll (the game's throttle and the adapter's gap)
  await page.evaluate(`(() => { const a = ${app}; a.throttle.last = 0; a.platform.lastAd = -Infinity; })()`);
  const before = (await log(page)).length;
  await page.locator('#to-map').click();
  await expect(page.locator('.node[data-level="1"]')).toBeVisible();
  expect((await log(page)).slice(before)).toEqual(['showBanner', 'SDK_GAME_PAUSE', 'SDK_GAME_START']);
  expect(b.errors).toEqual([]);
});

test('an ad that never starts: gives up after 8 s, the game continues', async ({ page }) => {
  await page.clock.install();
  await boot(page, 'never');
  await page.clock.runFor(500);
  await page.locator('#play').click();
  await page.clock.runFor(7_000);
  await expect(page.locator('.node[data-level="1"]')).toHaveCount(0);
  await page.clock.runFor(1_200); // > 8 s
  await expect(page.locator('.node[data-level="1"]')).toBeVisible();
});

test('SDK blocked (ad blocker): fully playable, no ad call, no console errors', async ({ page }) => {
  const b = await boot(page, 'complete', { sdkFails: true });
  await page.locator('#play').click();
  await expect(page.locator('.node[data-level="1"]')).toBeVisible();
  await playLevel(page);
  expect(await log(page)).toEqual([]);
  expect(b.errors).toEqual([]);
});
