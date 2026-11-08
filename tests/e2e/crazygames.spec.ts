import { expect, test, type Page } from '@playwright/test';

/**
 * CrazyGames SDK v3 checklist, end to end, with a fake SDK injected before the game boots
 * (the Pages build has no SDK script; the adapter picks up window.CrazyGames.SDK).
 */
type AdMode = 'finish' | 'error' | 'never';

async function fakeSdk(page: Page, opts: { ad?: AdMode; muted?: boolean } = {}) {
  await page.addInitScript(({ ad, muted }) => {
    const w = window as unknown as Record<string, unknown>;
    const calls: string[] = [];
    const data = new Map<string, string>();
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
  }, { ad: opts.ad ?? 'finish', muted: opts.muted ?? false });
}

const calls = (page: Page) => page.evaluate(() => (window as unknown as { __cgCalls: string[] }).__cgCalls.slice());
const app = 'window.__stickDuel';

test('SDK lifecycle: loading, gameplay only during real play, happytime on a boss win, Data Module saves', async ({ page }) => {
  const external: string[] = [];
  page.on('request', (r) => {
    if (!r.url().startsWith('http://localhost') && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) external.push(r.url());
  });
  await fakeSdk(page);
  await page.goto('/');
  await expect(page.locator('#play')).toBeVisible();
  expect(await calls(page)).toEqual(['init', 'loadingStart', 'loadingStop']);

  // menus are not gameplay
  await page.locator('#play').click();
  await page.locator('.node[data-level="1"]').click();
  expect(await calls(page)).not.toContain('gameplayStart');

  await page.locator('#fight').click();
  expect((await calls(page)).filter((c) => c === 'gameplayStart')).toHaveLength(1);
  await page.locator('#pause').click();
  expect((await calls(page)).at(-1)).toBe('gameplayStop');
  await page.locator('#resume').click();
  expect((await calls(page)).at(-1)).toBe('gameplayStart');

  // a boss win: gameplayStop once the duel ends, then happytime
  await page.evaluate(`(() => { const a = ${app}; a.speed = 3; a.intro(1, 10); a.fight(); })()`);
  await page.waitForFunction(`${app}.duel.humanAiming`);
  await page.evaluate(`(() => { const a = ${app}; a.duel.fighters[1].hp = 1; a.autoFire(false); })()`);
  await expect(page.locator('.card.result.won')).toBeVisible({ timeout: 20_000 });
  const c = await calls(page);
  expect(c).toContain('happytime');
  expect(c.lastIndexOf('gameplayStop')).toBeGreaterThan(c.lastIndexOf('gameplayStart'));
  // starts and stops are balanced, never twice in a row
  const gp = c.filter((x) => x.startsWith('gameplay'));
  for (let i = 1; i < gp.length; i++) expect(gp[i]).not.toBe(gp[i - 1]);

  // progress is saved in the Data Module, not in localStorage
  const saved = await page.evaluate(() => (window as unknown as { __cgData: Map<string, string> }).__cgData.get('stick-duel.save.v1'));
  expect(saved).toContain('"1-10"');
  expect(await page.evaluate(() => localStorage.getItem('stick-duel.save.v1'))).toBeNull();
  expect(external).toEqual([]);
});

test('respects the SDK mute setting', async ({ page }) => {
  await fakeSdk(page, { muted: true });
  await page.goto('/');
  await expect(page.locator('#play')).toBeVisible();
  expect(await page.evaluate(`${app}.platform.platformMuted()`)).toBe(true);
});

test('rewarded ad that never starts: button disabled, gives up after 8 s, message 2.5 s, then usable again', async ({ page }) => {
  await page.clock.install();
  await fakeSdk(page, { ad: 'never' });
  await page.goto('/');
  await page.clock.runFor(500);
  await page.locator('#play').click();
  await page.locator('.node[data-level="1"]').click();
  const btn = page.locator('#try-weapon');
  const label = await btn.textContent();
  await btn.click();
  await expect(btn).toBeDisabled();
  await page.clock.runFor(7_000);
  await expect(btn).toBeDisabled();
  await page.clock.runFor(1_200); // > 8 s: the request is abandoned
  await expect(btn).toHaveText('No ad available right now, try later');
  await expect(btn).toBeDisabled();
  await page.clock.runFor(2_600);
  await expect(btn).toHaveText(label ?? '');
  await expect(btn).toBeEnabled();
  // the intro is still usable: the game never waited on the ad
  await page.locator('#fight').click();
  await expect(page.locator('.hud')).toBeVisible();
});

test('rewarded ad error: message, then the button comes back; a finished ad grants the reward', async ({ page }) => {
  await fakeSdk(page, { ad: 'error' });
  await page.goto('/');
  await page.locator('#play').click();
  await page.locator('.node[data-level="1"]').click();
  const btn = page.locator('#try-weapon');
  await btn.click();
  await expect(btn).toHaveText('No ad available right now, try later');
  await expect(btn).toBeEnabled({ timeout: 4_000 });
});

test('rewarded ad finished: the reward is granted', async ({ page }) => {
  await fakeSdk(page, { ad: 'finish' });
  await page.goto('/');
  await page.locator('#play').click();
  await page.locator('.node[data-level="1"]').click();
  await page.locator('#try-weapon').click();
  // the intro is rebuilt with the trial weapon selected and no more offer
  await expect(page.locator('#try-weapon')).toHaveCount(0);
  await expect(page.locator('.weaponpick .wbtn')).toHaveCount(2);
});
