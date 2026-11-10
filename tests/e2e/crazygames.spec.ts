import { expect, test, type Page } from '@playwright/test';
import { APP, RETURNING, SAVE_KEY, loseCurrentLevel, trackExternal, winCurrentLevel } from './helpers';

/**
 * CrazyGames SDK v3 checklist, end to end, on the real CrazyGames build (dist-crazygames/),
 * with a fake SDK injected before the game boots. The real SDK script is intercepted.
 */
const CG_SDK = 'https://sdk.crazygames.com/crazygames-sdk-v3.js';
test.use({ baseURL: 'http://localhost:4174' });
test.beforeEach(async ({ page }) => {
  await page.route(CG_SDK, (r) => r.fulfill({ contentType: 'text/javascript', body: '/* fake SDK already installed */' }));
});
type AdMode = 'finish' | 'error' | 'never';

async function fakeSdk(page: Page, opts: { ad?: AdMode; muted?: boolean; returning?: boolean } = {}) {
  await page.addInitScript(({ ad, muted, save, key }) => {
    const w = window as unknown as Record<string, unknown>;
    const calls: string[] = [];
    const data = new Map<string, string>();
    if (save) data.set(key, save);
    w.__cgCalls = calls;
    w.__cgData = data;
    w.CrazyGames = {
      SDK: {
        environment: 'crazygames',
        init: async () => void calls.push('init'),
        game: {
          loadingStart: () => calls.push('loadingStart'),
          loadingStop: () => calls.push('loadingStop'),
          gameplayStart: () => calls.push('gameplayStart'),
          gameplayStop: () => calls.push('gameplayStop'),
          happytime: () => calls.push('happytime'),
          settings: { muteAudio: muted },
          addSettingsChangeListener: () => undefined,
        },
        ad: {
          requestAd: (type: string, cb: { adStarted?: () => void; adFinished?: () => void; adError?: (e: unknown) => void }) => {
            calls.push(`ad:${type}`);
            if (ad === 'never') return;
            if (ad === 'error') return void setTimeout(() => cb.adError?.({ code: 'unfilled' }), 50);
            setTimeout(() => {
              cb.adStarted?.();
              setTimeout(() => cb.adFinished?.(), 100);
            }, 50);
          },
          hasAdblock: async () => false,
        },
        data: { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k) },
        user: { systemInfo: { locale: 'en-US' } },
      },
    };
  }, { ad: opts.ad ?? 'finish', muted: opts.muted ?? false, save: opts.returning === false ? '' : RETURNING, key: SAVE_KEY });
}

const calls = (page: Page) => page.evaluate(() => (window as unknown as { __cgCalls: string[] }).__cgCalls.slice());

test('first visit: straight into level 1, gameplayStart right after loading', async ({ page }) => {
  await fakeSdk(page, { returning: false });
  await page.goto('/');
  await expect(page.locator('.hud')).toBeVisible();
  expect(await calls(page)).toEqual(['init', 'loadingStart', 'loadingStop', 'gameplayStart']);
});

test('SDK lifecycle: gameplay only during real play, happytime after a boss, Data Module saves', async ({ page }) => {
  const external = trackExternal(page, [CG_SDK]);
  await fakeSdk(page);
  await page.goto('/');
  await expect(page.locator('#play')).toBeVisible();
  expect(await calls(page)).toEqual(['init', 'loadingStart', 'loadingStop']);

  // menus are not gameplay
  await page.locator('#worlds').click();
  expect(await calls(page)).not.toContain('gameplayStart');
  await page.locator('#back').click();

  await page.locator('#play').click();
  await expect(page.locator('.hud')).toBeVisible();
  expect((await calls(page)).filter((c) => c === 'gameplayStart')).toHaveLength(1);
  await page.locator('#pause').click();
  expect((await calls(page)).at(-1)).toBe('gameplayStop');
  await page.locator('#resume').click();
  expect((await calls(page)).at(-1)).toBe('gameplayStart');

  // win the three levels; midgame ads only between levels (throttled to one every 2 minutes)
  for (let i = 0; i < 3; i++) {
    await page.evaluate(`${APP}.throttle.last = 0`);
    await winCurrentLevel(page);
    const c = await calls(page);
    expect(c.lastIndexOf('gameplayStop')).toBeGreaterThan(c.lastIndexOf('gameplayStart'));
    if (i < 2) {
      const n = c.length;
      await page.locator('#next').click();
      await expect(page.locator('.hud')).toBeVisible();
      const after = (await calls(page)).slice(n);
      expect(after.slice(0, 1)).toEqual(['ad:midgame']);
    }
  }
  expect(await calls(page)).not.toContain('happytime'); // ordinary levels: no happytime
  // the forest boss: happytime when he is beaten
  await page.evaluate(`(() => { const a = ${APP}; a.throttle.last = Date.now(); a.play(8); })()`);
  await winCurrentLevel(page);
  const c = await calls(page);
  expect(c).toContain('happytime');
  // starts and stops are balanced, never twice in a row
  const gp = c.filter((x) => x.startsWith('gameplay'));
  for (let i = 1; i < gp.length; i++) expect(gp[i]).not.toBe(gp[i - 1]);
  // no ad ever started during a duel: every midgame follows a gameplayStop
  for (let i = 0; i < c.length; i++) if (c[i] === 'ad:midgame') expect(c.slice(0, i).filter((x) => x.startsWith('gameplay')).at(-1)).toBe('gameplayStop');

  // progress is saved in the Data Module, not in localStorage
  const saved = await page.evaluate((k) => (window as unknown as { __cgData: Map<string, string> }).__cgData.get(k), SAVE_KEY);
  expect(saved).toContain('"forest-9"');
  expect(await page.evaluate((k) => localStorage.getItem(k), SAVE_KEY)).toBeNull();
  expect(external).toEqual([]);
});

test('respects the SDK mute setting', async ({ page }) => {
  await fakeSdk(page, { muted: true });
  await page.goto('/');
  await expect(page.locator('#play')).toBeVisible();
  expect(await page.evaluate(`${APP}.platform.platformMuted()`)).toBe(true);
});

test('rewarded ad that never starts: button disabled, gives up after 8 s, message 2.5 s, then usable again', async ({ page }) => {
  await page.clock.install();
  await fakeSdk(page, { ad: 'never' });
  await page.goto('/');
  await page.clock.runFor(2_000);
  await page.locator('#play').click();
  // no rendering while the fake clock runs (software WebGL would make every frame slow)
  await page.evaluate(`${APP}.manual = true`);
  const btn = page.locator('#ad-fire');
  const label = page.locator('#ad-fire .t');
  await expect(label).toHaveText('Watch an ad: extra fire arrow');
  await btn.click();
  await expect(btn).toBeDisabled();
  await page.clock.runFor(7_000);
  await expect(btn).toBeDisabled();
  await page.clock.runFor(1_200); // > 8 s: the request is abandoned
  await expect(label).toHaveText('No ad available right now, try later');
  await expect(btn).toBeDisabled();
  await page.clock.runFor(2_600);
  await expect(label).toHaveText('Watch an ad: extra fire arrow');
  await expect(btn).toBeEnabled();
  // the game never waited on the ad
  expect(await page.evaluate(`${APP}.duel.phase`)).toBe('aim');
});

test('rewarded ad error: message, then the button comes back, no reward', async ({ page }) => {
  await fakeSdk(page, { ad: 'error' });
  await page.goto('/');
  await page.locator('#play').click();
  await page.locator('#ad-fire').click();
  await expect(page.locator('#ad-fire .t')).toHaveText('No ad available right now, try later');
  await expect(page.locator('#ad-fire')).toBeEnabled({ timeout: 4_000 });
  expect(await page.evaluate(`${APP}.duel.ammo.fire`)).toBe(0);
});

test('rewarded ad finished: one extra fire arrow, offer gone for this level', async ({ page }) => {
  await fakeSdk(page, { ad: 'finish' });
  await page.goto('/');
  await page.locator('#play').click();
  await page.locator('#ad-fire').click();
  await expect(page.locator('#ad-fire')).toHaveCount(0);
  await expect(page.locator('.ab.a-fire .cnt')).toHaveText('1');
  expect(await page.evaluate(`${APP}.duel.selected`)).toBe('fire');
});

test('rewarded on the win screen: double coins, only after the ad finished', async ({ page }) => {
  await fakeSdk(page, { ad: 'finish' });
  await page.goto('/');
  await page.locator('#play').click();
  await winCurrentLevel(page);
  const before = (await page.evaluate(`${APP}.save.coins`)) as number;
  await expect(page.locator('#ad-double .t')).toHaveText('Watch an ad: double coins');
  await page.locator('#ad-double').click();
  await expect(page.locator('#ad-double')).toHaveCount(0);
  expect(await page.evaluate(`${APP}.save.coins`)).toBe(before * 2);
});

test('rewarded on defeat: continue with 1 HP, once per level', async ({ page }) => {
  await fakeSdk(page, { ad: 'finish' });
  await page.goto('/');
  await page.locator('#play').click();
  await loseCurrentLevel(page);
  await page.locator('#ad-continue').click();
  await expect(page.locator('.hud')).toBeVisible();
  await page.waitForFunction(`${APP}.duel.phase === 'aim'`);
  expect(await page.evaluate(`${APP}.duel.playerHp`)).toBe(1);
  await loseCurrentLevel(page);
  await expect(page.locator('#ad-continue')).toHaveCount(0); // once per level
});
