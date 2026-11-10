import { expect, test, type Page } from '@playwright/test';
import { APP, RETURNING, SAVE_KEY, winCurrentLevel } from './helpers';

/**
 * GameDistribution build (dist-gd/) end to end. The real SDK URL is intercepted and served
 * a mock gdsdk that drives GD_OPTIONS.onEvent like the official SDK does.
 */
const GD_SDK = 'https://html5.api.gamedistribution.com/main.min.js';
const GAME_ID = 'f09f3bd24a744eefb2580b8c8f977edc';
test.use({ baseURL: 'http://localhost:4175' });

/** complete: full ad; error: AD_ERROR + rejection; close: rewarded closed early; never: nothing at all */
type AdMode = 'complete' | 'error' | 'close' | 'never';

const MOCK_SDK = `(() => {
  const opts = window.GD_OPTIONS;
  const log = (window.__gdLog = window.__gdLog || []);
  log.push('sdk-loaded:' + (opts && opts.gameId));
  const emit = (name) => { log.push(name); opts.onEvent({ name, message: name, status: 'success' }); };
  const later = (ms) => new Promise((r) => setTimeout(r, ms));
  window.gdsdk = {
    showAd: async (type) => {
      const mode = window.__gdMode || 'complete';
      log.push('showAd:' + (type || 'interstitial'));
      if (mode === 'never') return new Promise(() => {});
      if (mode === 'error') { await later(50); emit('AD_ERROR'); throw new Error('No fill'); }
      await later(50);
      emit('SDK_GAME_PAUSE');
      emit('STARTED');
      await later(300);
      window.__gdPausedDuringAd = window.__toppleDuel.adPlaying;
      if (type === 'rewarded' && mode === 'complete') emit('SDK_REWARDED_WATCH_COMPLETE');
      emit('SDK_GAME_START');
    },
  };
})();`;

async function boot(page: Page, mode: AdMode = 'complete', opts: { sdkFails?: boolean } = {}) {
  const external: string[] = [];
  let sdkRequests = 0;
  page.on('request', (r) => {
    const u = r.url();
    if (u === GD_SDK) return void (sdkRequests += 1);
    if (!u.startsWith('http://localhost') && !u.startsWith('data:') && !u.startsWith('blob:')) external.push(u);
  });
  await page.addInitScript(([m, k, v]) => {
    (window as unknown as { __gdMode: string }).__gdMode = m!;
    localStorage.setItem(k!, v!);
  }, [mode, SAVE_KEY, RETURNING]);
  await page.route(GD_SDK, (r) => (opts.sdkFails ? r.abort() : r.fulfill({ contentType: 'text/javascript', body: MOCK_SDK })));
  await page.goto('/');
  await expect(page.locator('#play')).toBeVisible();
  return { external, sdkRequests: () => sdkRequests };
}

const log = (page: Page) => page.evaluate(() => ((window as unknown as { __gdLog?: string[] }).__gdLog ?? []).slice());

test('loads the GD SDK once while booting, pre-roll on Play, mid-roll between levels, never during a duel', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const net = await boot(page);
  await expect.poll(() => log(page)).toContain(`sdk-loaded:${GAME_ID}`);
  expect(net.sdkRequests()).toBe(1);
  expect(await page.locator('script#gamedistribution-jssdk').count()).toBe(1);
  expect(await page.evaluate(() => 'CrazyGames' in window)).toBe(false);
  expect(await page.evaluate(`${APP}.platform.name`)).toBe('gamedistribution');

  // pre-roll: Play → interstitial (game paused/muted while it plays) → level 1
  await page.locator('#play').click();
  await expect(page.locator('.hud')).toBeVisible();
  expect(await log(page)).toEqual([`sdk-loaded:${GAME_ID}`, 'showAd:interstitial', 'SDK_GAME_PAUSE', 'STARTED', 'SDK_GAME_START']);
  expect(await page.evaluate(() => (window as unknown as { __gdPausedDuringAd: boolean }).__gdPausedDuringAd)).toBe(true);
  expect(await page.evaluate(`${APP}.adPlaying`)).toBe(false);

  // a duel: no ad at all while it runs
  const before = (await log(page)).length;
  await page.evaluate(`${APP}.throttle.last = 0`);
  await winCurrentLevel(page);
  expect((await log(page)).slice(before)).toEqual([]);

  // mid-roll on Next
  await page.locator('#next').click();
  await expect(page.locator('.lvname')).toContainText('Grand Hall');
  expect((await log(page)).slice(before)).toEqual(['showAd:interstitial', 'SDK_GAME_PAUSE', 'STARTED', 'SDK_GAME_START']);

  // progress saved in localStorage
  expect(await page.evaluate((k) => localStorage.getItem(k), SAVE_KEY)).toContain('"forest-1"');
  expect(net.external).toEqual([]);
  expect(errors).toEqual([]);
});

test('rewarded ad completed: the reward is granted after SDK_REWARDED_WATCH_COMPLETE', async ({ page }) => {
  await boot(page, 'complete');
  await page.locator('#play').click();
  await page.locator('#ad-fire').click();
  await expect(page.locator('#ad-fire')).toHaveCount(0);
  await expect(page.locator('.ab.a-fire .cnt')).toHaveText('1');
  expect(await log(page)).toContain('SDK_REWARDED_WATCH_COMPLETE');
  expect(await page.evaluate(`${APP}.adPlaying`)).toBe(false);
});

test('rewarded ad closed early: no reward, "no ad" message, button back', async ({ page }) => {
  await boot(page, 'close');
  await page.locator('#play').click();
  const btn = page.locator('#ad-fire');
  await btn.click();
  await expect(btn.locator('.t')).toHaveText('No ad available right now, try later');
  await expect(btn).toBeEnabled({ timeout: 4_000 });
  expect(await page.evaluate(`${APP}.duel.ammo.fire`)).toBe(0);
});

test('rewarded ad error: message for 2.5 s, then the button comes back', async ({ page }) => {
  await boot(page, 'error');
  await page.locator('#play').click(); // the pre-roll fails too: the game just continues
  const btn = page.locator('#ad-fire');
  await btn.click();
  await expect(btn.locator('.t')).toHaveText('No ad available right now, try later');
  await expect(btn).toBeDisabled();
  await expect(btn.locator('.t')).toHaveText('Watch an ad: extra fire arrow', { timeout: 4_000 });
  await expect(btn).toBeEnabled();
});

test('ad that never starts: gives up after 8 s, game continues', async ({ page }) => {
  await page.clock.install();
  await boot(page, 'never');
  await page.evaluate(`${APP}.manual = true`); // no rendering while the fake clock runs
  await page.clock.runFor(500);
  await page.locator('#play').click();
  await page.clock.runFor(7_000);
  await expect(page.locator('.hud')).toBeHidden();
  await page.clock.runFor(1_200); // > 8 s
  await expect(page.locator('.hud')).toBeVisible();
});

test('SDK fails to load: fully playable without ads', async ({ page }) => {
  await boot(page, 'complete', { sdkFails: true });
  await page.locator('#play').click();
  await expect(page.locator('.hud')).toBeVisible();
  await expect(page.locator('#ad-fire')).toHaveCount(0); // no rewarded offers without the SDK
});
