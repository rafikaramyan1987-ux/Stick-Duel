import { expect, test, type Page } from '@playwright/test';
import { APP, RETURNING, SAVE_KEY, loseCurrentLevel, winCurrentLevel } from '../e2e/helpers';

/**
 * GamePix build (dist-gamepix/) end to end. The real SDK URL is intercepted and served a mock
 * that behaves like the GamePix SDK v3 local simulator: 'pause' before an ad, 'resume' after it,
 * then the ad promise resolves with { success }.
 */
const GPX_SDK = 'https://integration.gamepix.com/sdk/v3/gamepix.sdk.js';
test.use({ baseURL: 'http://localhost:4196' });

/** success: ad shown / reward earned; fail: { success: false } (no fill, cancelled) */
type AdMode = 'success' | 'fail';

const MOCK_SDK = `(() => {
  const log = (window.__gpxLog = window.__gpxLog || []);
  log.push('sdk-loaded:' + JSON.stringify(window.GamePixConfig));
  const handlers = { pause: [], resume: [] };
  const emit = (n) => { log.push(n); handlers[n].forEach((f) => f()); };
  const later = (ms) => new Promise((r) => setTimeout(r, ms));
  const ad = async (kind) => {
    log.push('ad:' + kind);
    emit('pause');
    await later(300);
    window.__gpxDuringAd = { adPlaying: window.__toppleDuel.adPlaying };
    emit('resume');
    return (window.__gpxMode || 'success') === 'success' ? { success: true } : { success: false, message: 'No ad available' };
  };
  window.GamePix = {
    lifecycle: {
      loading: (n) => log.push('loading:' + n),
      loaded: () => { log.push('loaded'); return later(50).then(() => ({})); },
      gameStart: () => log.push('gameStart'),
    },
    events: { on: (n, f) => handlers[n].push(f) },
    ads: { interstitial: () => ad('interstitial'), reward: () => ad('reward') },
    happyMoment: (n) => log.push('happy:' + n),
    sadMoment: (n) => log.push('sad:' + n),
    lang: () => window.__gpxLang || 'en',
  };
})();`;

async function boot(page: Page, mode: AdMode = 'success', lang = 'en') {
  const external: string[] = [];
  page.on('request', (r) => {
    const u = r.url();
    if (u === GPX_SDK) return;
    if (!u.startsWith('http://localhost') && !u.startsWith('data:') && !u.startsWith('blob:')) external.push(u);
  });
  await page.addInitScript(([m, l, k, v]) => {
    Object.assign(window, { __gpxMode: m, __gpxLang: l });
    localStorage.setItem(k!, v!);
  }, [mode, lang, SAVE_KEY, RETURNING]);
  await page.route(GPX_SDK, (r) => r.fulfill({ contentType: 'text/javascript', body: MOCK_SDK }));
  await page.goto('/');
  await expect(page.locator('#play')).toBeVisible();
  return { external };
}

const log = (page: Page) => page.evaluate(() => ((window as unknown as { __gpxLog?: string[] }).__gpxLog ?? []).slice());

test('lifecycle: loading → loaded before the menu, gameStart once on the first level, interstitial at a break', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const net = await boot(page);
  const boot0 = await log(page);
  expect(boot0[0]).toBe('sdk-loaded:{"lifecycle":"manual"}');
  const loading = boot0.filter((c) => c.startsWith('loading:')).map((c) => Number(c.slice(8)));
  expect(loading.every((n, i) => Number.isInteger(n) && (i === 0 || n > loading[i - 1]!))).toBe(true);
  expect(loading.at(-1)).toBe(100);
  expect(boot0.indexOf('loaded')).toBeGreaterThan(boot0.indexOf('loading:100'));
  expect(boot0).not.toContain('gameStart');
  expect(await page.evaluate(`${APP}.platform.name`)).toBe('gamepix');
  expect(await page.evaluate(() => 'CrazyGames' in window || 'gdsdk' in window || 'GD_OPTIONS' in window)).toBe(false);

  // menus are not gameplay
  await page.locator('#worlds').click();
  expect(await log(page)).not.toContain('gameStart');
  await page.locator('#back').click();
  // no pre-roll on Play
  await page.locator('#play').click();
  await expect(page.locator('.hud')).toBeVisible();
  expect((await log(page)).filter((c) => c.startsWith('ad:'))).toEqual([]);
  expect((await log(page)).filter((c) => c === 'gameStart')).toHaveLength(1);
  await page.locator('#pause').click();
  await page.locator('#resume').click();
  await page.evaluate(`${APP}.throttle.last = 0`);
  const before = (await log(page)).length;
  await winCurrentLevel(page);
  expect((await log(page)).slice(before)).toEqual(['happy:level_complete']); // no ad during the duel

  // interstitial on Next: paused + muted while it plays, resumed after
  await page.locator('#next').click();
  await expect(page.locator('.lvname')).toContainText('Forest 2');
  expect((await log(page)).slice(before + 1)).toEqual(['ad:interstitial', 'pause', 'resume']);
  expect(await page.evaluate(() => (window as unknown as { __gpxDuringAd: unknown }).__gpxDuringAd)).toEqual({ adPlaying: true });
  expect(await page.evaluate(`${APP}.adPlaying`)).toBe(false);
  expect((await log(page)).filter((c) => c === 'gameStart')).toHaveLength(1); // sent only once

  expect(await page.evaluate((k) => localStorage.getItem(k), SAVE_KEY)).toContain('"forest-1"');
  expect(net.external).toEqual([]);
  expect(errors).toEqual([]);
});

test('level failed: sadMoment(level_failed)', async ({ page }) => {
  await boot(page);
  await page.locator('#play').click();
  await loseCurrentLevel(page);
  expect(await log(page)).toContain('sad:level_failed');
});

test('rewarded success: the reward is granted', async ({ page }) => {
  await boot(page, 'success');
  await page.locator('#play').click();
  await page.locator('#ad-fire').click();
  await expect(page.locator('#ad-fire')).toHaveCount(0);
  await expect(page.locator('.ab.a-fire .cnt')).toHaveText('1');
  expect(await log(page)).toContain('ad:reward');
  expect(await page.evaluate(`${APP}.adPlaying`)).toBe(false);
});

test('rewarded cancelled / no fill: no reward, "no ad" message for 2.5 s, button back', async ({ page }) => {
  await boot(page, 'fail');
  await page.locator('#play').click();
  const btn = page.locator('#ad-fire');
  await btn.click();
  await expect(btn.locator('.t')).toHaveText('No ad available right now, try later');
  await expect(btn).toBeDisabled();
  await expect(btn.locator('.t')).toHaveText('Watch an ad: extra fire arrow', { timeout: 4_000 });
  await expect(btn).toBeEnabled();
  expect(await page.evaluate(`${APP}.duel.ammo.fire`)).toBe(0);
  expect(await page.evaluate(`${APP}.adPlaying`)).toBe(false);
});

test('pause + mute when the page is hidden, back when visible; window blur does nothing; GamePix.lang()', async ({ page }) => {
  await boot(page, 'success', 'fr');
  await expect(page.locator('#play .t')).toHaveText('Jouer');
  const setHidden = (hidden: boolean) =>
    page.evaluate((h) => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => h });
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (h ? 'hidden' : 'visible') });
      document.dispatchEvent(new Event('visibilitychange'));
    }, hidden);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  expect(await page.evaluate(`${APP}.adPlaying`)).toBe(false);
  await setHidden(true);
  expect(await page.evaluate(`${APP}.adPlaying`)).toBe(true);
  await setHidden(true);
  await setHidden(false);
  expect(await page.evaluate(`${APP}.adPlaying`)).toBe(false);
});

test('SDK fails to load: fully playable without ads', async ({ page }) => {
  await page.route(GPX_SDK, (r) => r.abort());
  await page.addInitScript(([k, v]) => localStorage.setItem(k!, v!), [SAVE_KEY, RETURNING]);
  await page.goto('/');
  await expect(page.locator('#play')).toBeVisible();
  await page.locator('#play').click();
  await expect(page.locator('.hud')).toBeVisible();
  await expect(page.locator('#ad-fire')).toHaveCount(0);
});
