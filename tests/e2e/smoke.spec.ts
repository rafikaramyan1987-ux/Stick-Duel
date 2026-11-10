import { expect, test } from '@playwright/test';
import { APP, RETURNING, SAVE_KEY, finishDuel, trackExternal, winCurrentLevel } from './helpers';

test('first visit: in level 1 within 5 s, tutorial hand on the rope, drag back and release to shoot', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  const external = trackExternal(page);
  const t0 = Date.now();
  await page.goto('/');
  await expect(page.locator('.hud')).toBeVisible({ timeout: 5_000 });
  expect(Date.now() - t0).toBeLessThan(5_000);
  await expect(page.locator('.tutorial .hand')).toBeVisible();
  await expect(page.locator('.tutorial .tip b')).toHaveText('Aim at your rival!');
  await expect(page.locator('.hp.p1 .val')).toHaveText('100');
  // normal arrows are unlimited
  await expect(page.locator('.ab[data-ammo="arrow"] .cnt')).toHaveText('∞');

  // drag back (down-left) and release: shoots up and to the right
  const vp = page.viewportSize()!;
  const x0 = vp.width * 0.5;
  const y0 = vp.height * 0.5;
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(x0 - i * 14, y0 + i * 8);
  await page.mouse.up();
  await page.waitForFunction(`${APP}.duel.shotsUsed === 1`);
  // the first shot ends the tutorial for good, with the damage per zone
  await expect(page.locator('.tutorial .tip b')).toHaveText('Head 35 · Body 20 · Arms and legs 10');
  expect(await page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? '{}').tutorial, SAVE_KEY)).toBe(true);
  await finishDuel(page);
  expect(external).toEqual([]);
  expect(errors).toEqual([]);
});

test('winning a level: slow-motion replay, stars, next level; progress is saved', async ({ page }) => {
  await page.addInitScript(([k, v]) => localStorage.setItem(k!, v!), [SAVE_KEY, RETURNING]);
  await page.goto('/');
  await page.locator('#play').click();
  await expect(page.locator('.hud')).toBeVisible();
  // the replay starts on its own after the K.O. (checked in the unit tests); here: the result
  await winCurrentLevel(page);
  await expect(page.locator('#next')).toBeVisible();
  const save = await page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? '{}'), SAVE_KEY);
  const stars = save.levels['forest-1'].stars as boolean[];
  expect(stars[0]).toBe(true);
  await expect(page.locator('.star.on')).toHaveCount(stars.filter(Boolean).length);
  // 10 coins for the win, 5 per star
  expect(save.coins).toBe(10 + 5 * stars.filter(Boolean).length);
  await page.locator('#next').click();
  await expect(page.locator('.lvname')).toContainText('Forest 2');
});

test('main menu, worlds, settings (language, reset with confirmation), pause menu, keyboard', async ({ page }) => {
  await page.addInitScript(([k, v]) => localStorage.setItem(k!, v!), [SAVE_KEY, RETURNING]);
  await page.goto('/');
  await expect(page.locator('.logo')).toContainText('TOPPLE');
  for (const id of ['#play', '#worlds', '#versus', '#endless', '#settings']) await expect(page.locator(id)).toBeVisible();

  await page.locator('#worlds').click();
  await expect(page.locator('.lvl')).toHaveCount(54);
  await expect(page.locator('.lvl.locked')).toHaveCount(53);
  await expect(page.locator('.lvl.boss')).toHaveCount(6);
  await page.locator('#back').click();

  await page.locator('#settings').click();
  await page.locator('[data-lang="fr"]').click();
  await expect(page.locator('.settings h2')).toHaveText('Réglages');
  await page.locator('[data-lang="en"]').click();
  await page.locator('#music').click();
  await expect(page.locator('#music')).not.toHaveClass(/on/);
  await page.locator('#reset').click();
  await expect(page.locator('.confirm p')).toContainText('Reset all progress?');
  await page.locator('#reset-no').click();
  await page.locator('#settings-back').click();

  await page.locator('#play').click();
  await expect(page.locator('.hud')).toBeVisible();
  // keyboard: digits pick ammo, arrows aim, P pauses (KeyboardEvent.code, layout independent)
  await page.waitForFunction(`${APP}.duel.phase === 'aim'`);
  const a0 = (await page.evaluate(`${APP}.duel.aim.angle`)) as number;
  await page.keyboard.press('ArrowUp');
  expect((await page.evaluate(`${APP}.duel.aim.angle`)) as number).toBeLessThan(a0);
  await page.keyboard.press('KeyP');
  await expect(page.locator('.pausecard')).toBeVisible();
  await page.locator('#resume').click();
  await expect(page.locator('.pausecard')).toHaveCount(0);
  await page.locator('#pause').click();
  await page.locator('#pause-menu').click();
  await expect(page.locator('#play')).toBeVisible();
  // the web build has no ads at all
  await page.locator('#play').click();
  await expect(page.locator('#ad-fire')).toHaveCount(0);
});

test('2 players: pick an arena, turns alternate; Endless: a rival to topple; shop: buy and wear a hat', async ({ page }) => {
  await page.addInitScript(([k, v]) => localStorage.setItem(k!, v!.replace('"coins":0', '"coins":100')), [SAVE_KEY, RETURNING]);
  await page.goto('/');
  await page.locator('#versus').click();
  await expect(page.locator('.arena')).toHaveCount(6);
  await page.locator('[data-arena="desert"]').click();
  await expect(page.locator('.hp.p1 .name')).toHaveText('Player 2');
  await expect(page.locator('.turn')).toHaveText("Player 1's turn");
  await page.evaluate(`${APP}.shoot(1.0, 0, 'arrow')`);
  await page.evaluate(`(() => { const a = ${APP}; a.manual = true; for (let i = 0; i < 1200 && !(a.duel.phase === 'aim' && a.duel.turn === 1); i++) a.advance(1 / 60, false); a.advance(1 / 60, true); a.manual = false; })()`);
  await expect(page.locator('.turn')).toHaveText("Player 2's turn");
  await page.locator('#pause').click();
  await page.locator('#pause-menu').click();

  await page.locator('#endless').click();
  await expect(page.locator('.lvname')).toHaveText('Rival 1');
  await page.locator('#pause').click();
  await page.locator('#pause-menu').click();

  await page.locator('#shop').click();
  await page.locator('.item[data-item="cap"]').click();
  await expect(page.locator('.item[data-item="cap"]')).toHaveClass(/worn/);
  const save = await page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? '{}'), SAVE_KEY);
  expect(save.hat).toBe('cap');
  expect(save.coins).toBe(60);
  await page.locator('#tab-colors').click();
  await expect(page.locator('.item')).toHaveCount(9);
});

for (const lang of ['de', 'ru']) {
  test(`${lang}: every label fits at 390×844 and 1920×1080 (menus, settings, shop, HUD)`, async ({ page }) => {
    await page.addInitScript(([k, v, l]) => localStorage.setItem(k!, v!.replace('"lang":null', `"lang":"${l}"`)), [SAVE_KEY, RETURNING, lang]);
    for (const vp of [{ width: 390, height: 844 }, { width: 1920, height: 1080 }]) {
    await page.setViewportSize(vp);
    await page.goto('/');
    const overflow = () =>
      page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('.btn, .ab, .toggle, .lang, .tab, .item, .hp .name, .lvname, .turn, .card h2')]
          .filter((e) => e.offsetParent !== null && (e.scrollWidth > e.clientWidth + 2 || e.getBoundingClientRect().right > window.innerWidth + 1))
          .map((e) => `${e.className}: ${e.textContent}`),
      );
    expect(await overflow()).toEqual([]);
    await page.locator('#settings').click();
    expect(await overflow()).toEqual([]);
    await page.locator('#settings-back').click();
    await page.locator('#shop').click();
    expect(await overflow()).toEqual([]);
    await page.locator('#back').click();
    await page.locator('#play').click();
    await expect(page.locator('.hud')).toBeVisible();
    expect(await overflow()).toEqual([]);
    await page.locator('#pause').click();
    expect(await overflow()).toEqual([]);
    }
  });
}

test('all HUD and menu buttons are on screen without scrolling', async ({ page }) => {
  await page.addInitScript(([k, v]) => localStorage.setItem(k!, v!), [SAVE_KEY, RETURNING]);
  await page.goto('/');
  const vp = page.viewportSize()!;
  const inside = async (sel: string) => {
    const b = await page.locator(sel).first().boundingBox();
    expect(b, sel).not.toBeNull();
    expect(b!.x).toBeGreaterThanOrEqual(0);
    expect(b!.y).toBeGreaterThanOrEqual(0);
    expect(b!.x + b!.width).toBeLessThanOrEqual(vp.width + 1);
    expect(b!.y + b!.height).toBeLessThanOrEqual(vp.height + 1);
  };
  for (const id of ['#play', '#worlds', '#versus', '#endless', '#settings']) await inside(id);
  await page.locator('#play').click();
  for (const sel of ['#pause', '.hp.p0', '.hp.p1', '.ab']) await inside(sel);
});
