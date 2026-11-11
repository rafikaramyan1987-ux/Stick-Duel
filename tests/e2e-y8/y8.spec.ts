import { expect, test, type Page } from '@playwright/test';

/**
 * Y8 build (dist-y8/) smoke test. y8.min.js (Y8's CDN) is intercepted and served a stub: it fires `y8sdk.ready` on
 * load (and again on emitReadyEvent); showAd() records the call (flagged BEFORE-INIT if init() had not run) and plays
 * the documented callbacks: beforeAd → (reward: adViewed / adDismissed) → afterAd → adBreakDone, or only
 * adBreakDone({ breakStatus: 'noAdPreloaded' }).
 */
const Y8_SDK = 'https://cdn.y8.com/minimal-sdk/2-0/y8.min.js';
const APP_ID = '6af4b1f4ca1c6869a74e0a2f';
const GAME_ID = '292551';
const app = 'window.__stickDuel';

interface Y8Stub {
  calls: string[];
  mode: 'viewed' | 'dismissed' | 'noAd';
  pausedDuringAd: boolean[];
}
declare global {
  interface Window {
    __y8?: Y8Stub;
  }
}

const STUB = `(() => {
  const g = (window.__y8 = window.__y8 || { calls: [], mode: 'viewed', pausedDuringAd: [] });
  let inited = false;
  const sdk = {
    init(appConfig, adConfig) {
      g.calls.push('init:' + appConfig.appId + ':' + appConfig.autoLogin + ':' + adConfig.gameId + ':' + adConfig.preloadAdBreaks + ':' + adConfig.sound);
      inited = true;
      setTimeout(() => adConfig.onReady && adConfig.onReady(), 0);
    },
    onAuth(cb) { setTimeout(() => cb(null, null), 0); },
    showAd(o) {
      g.calls.push((inited ? '' : 'BEFORE-INIT:') + o.type);
      return new Promise((res) => {
        if (g.mode === 'noAd') { o.adBreakDone && o.adBreakDone({ breakStatus: 'noAdPreloaded' }); return res(); }
        const play = () => {
          o.beforeAd && o.beforeAd();
          setTimeout(() => {
            g.pausedDuringAd.push(window.__stickDuel.adPlaying);
            if (o.type === 'reward') (g.mode === 'viewed' ? o.adViewed : o.adDismissed)();
            o.afterAd && o.afterAd();
            o.adBreakDone && o.adBreakDone({ breakStatus: g.mode });
            res();
          }, 300);
        };
        if (o.type === 'reward') o.beforeReward(play); else play();
      });
    },
  };
  const ready = () => window.dispatchEvent(new Event('y8sdk.ready'));
  window.y8 = { sdk: () => sdk, emitReadyEvent: ready };
  ready();
})();`;

async function boot(page: Page, sdk: 'stub' | 'blocked' = 'stub') {
  const errors: string[] = [];
  const external: string[] = [];
  let sdkRequests = 0;
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !(sdk === 'blocked' && /Failed to load resource/.test(m.text()))) errors.push(m.text());
  });
  page.on('request', (r) => {
    const u = r.url();
    if (u === Y8_SDK) return void (sdkRequests += 1);
    if (!u.startsWith('http://localhost') && !u.startsWith('data:') && !u.startsWith('blob:')) external.push(u);
  });
  await page.route(Y8_SDK, (r) => (sdk === 'stub' ? r.fulfill({ contentType: 'application/javascript', body: STUB }) : r.abort()));
  await page.goto('/');
  await expect(page.locator('#play')).toBeVisible();
  return { errors, external, sdkRequests: () => sdkRequests };
}

const calls = (page: Page) => page.evaluate(() => (window.__y8?.calls ?? []).slice());

/** level 1 of world 1: one real drag shot, then the game's perfect-aim helper finishes the duel */
async function playLevel(page: Page, level = 1) {
  await page.locator(`.node[data-level="${level}"]`).click();
  await expect(page.locator('#fight')).toBeVisible();
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
  await expect(page.locator('.card.result.won')).toBeVisible({ timeout: 30_000 });
}

test('y8.min.js from the CDN (async, once), initialized with the App ID + Game ID, no ad before init or before Play', async ({ page }) => {
  const b = await boot(page);
  expect(await page.locator(`head script[src="${Y8_SDK}"][async]`).count()).toBe(1);
  expect(b.sdkRequests()).toBe(1);
  expect(await page.evaluate(`${app}.platform.name`)).toBe('y8');
  await expect.poll(() => calls(page)).toEqual([`init:${APP_ID}:true:${GAME_ID}:on:on`]);
  await page.waitForTimeout(500);
  expect(await calls(page)).toEqual([`init:${APP_ID}:true:${GAME_ID}:on:on`]);
  expect(b.external).toEqual([]);
  expect(b.errors).toEqual([]);
});

test("'start' on Play (paused + muted during it), a level plays with no ad, 'next' on every result button", async ({ page }) => {
  const b = await boot(page);
  await expect.poll(() => calls(page)).toHaveLength(1);
  await page.locator('#play').click();
  await expect(page.locator('.node[data-level="1"]')).toBeVisible();
  expect((await calls(page)).slice(1)).toEqual(['start']);
  expect(await page.evaluate(() => window.__y8!.pausedDuringAd)).toEqual([true]);
  expect(await page.evaluate(`${app}.adPlaying`)).toBe(false);

  await playLevel(page);
  expect((await calls(page)).slice(1)).toEqual(['start']); // nothing during the duel
  // Retry, then Next: each a 'next' break, no cap of the game's own
  await page.locator('#retry').click();
  await expect(page.locator('#fight')).toBeVisible();
  await page.locator('#fight').click();
  await page.waitForFunction(`${app}.duel?.humanAiming`);
  await page.evaluate(`(() => { const a = ${app}; a.duel.fighters[1].hp = 1; a.autoFire(false); })()`);
  await expect(page.locator('.card.result.won')).toBeVisible({ timeout: 30_000 });
  await page.locator('#next').click();
  await expect(page.locator('#fight')).toBeVisible();
  expect((await calls(page)).slice(1)).toEqual(['start', 'next', 'next']);
  expect(await page.evaluate(() => window.__y8!.pausedDuringAd)).toEqual([true, true, true]);
  expect((await calls(page)).some((c) => c.startsWith('BEFORE-INIT'))).toBe(false);
  expect(await page.evaluate(() => localStorage.getItem('stick-duel.save.v1'))).toContain('"1-1"');
  expect(b.errors).toEqual([]);
});

test('rewarded: explained button; no ad → "No ad available", dismissed → no reward, viewed → reward', async ({ page }) => {
  const b = await boot(page);
  await page.locator('#play').click();
  await page.locator('.node[data-level="1"]').click();
  const btn = page.locator('#try-weapon');
  await expect(btn).toContainText('Try');
  await page.evaluate(() => (window.__y8!.mode = 'noAd'));
  await btn.click();
  await expect(btn).toHaveText('No ad available right now, try later');
  await expect(btn).toBeEnabled({ timeout: 5_000 });
  await page.evaluate(() => (window.__y8!.mode = 'dismissed'));
  await btn.click();
  await expect(btn).toHaveText('No ad available right now, try later');
  await expect(btn).toBeEnabled({ timeout: 5_000 });
  await expect(page.locator('.weaponpick .wbtn')).toHaveCount(1);
  await page.evaluate(() => (window.__y8!.mode = 'viewed'));
  await btn.click();
  await expect(page.locator('#try-weapon')).toHaveCount(0);
  await expect(page.locator('.weaponpick .wbtn')).toHaveCount(2);
  expect((await calls(page)).filter((c) => c === 'reward')).toHaveLength(3);
  expect(await page.evaluate(`${app}.adPlaying`)).toBe(false);
  expect(b.errors).toEqual([]);
});

test('pauses + mutes on window blur / hidden page, resumes on return', async ({ page }) => {
  const b = await boot(page);
  await page.locator('#play').click();
  await page.locator('.node[data-level="1"]').click();
  await page.locator('#fight').click();
  await page.waitForFunction(`${app}.duel?.humanAiming`);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  expect(await page.evaluate(`${app}.adPlaying`)).toBe(true);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  expect(await page.evaluate(`${app}.adPlaying`)).toBe(false);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  expect(await page.evaluate(`${app}.adPlaying`)).toBe(true);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  expect(await page.evaluate(`${app}.adPlaying`)).toBe(false);
  expect(await page.evaluate(`${app}.paused`)).toBe(false); // back in the duel, no menu in the way
  expect(b.errors).toEqual([]);
});

test('SDK blocked (ad blocker): fully playable, no rewarded buttons, no ad call', async ({ page }) => {
  const b = await boot(page, 'blocked');
  await page.locator('#play').click();
  await expect(page.locator('.node[data-level="1"]')).toBeVisible();
  await expect(page.locator('.btn.ad')).toHaveCount(0);
  await playLevel(page);
  await expect(page.locator('.btn.ad')).toHaveCount(0);
  await page.locator('#next').click();
  await expect(page.locator('#fight')).toBeVisible();
  expect(await calls(page)).toEqual([]);
  expect(b.errors).toEqual([]);
});
