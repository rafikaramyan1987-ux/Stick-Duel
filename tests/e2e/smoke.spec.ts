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
  await expect(page.locator('.tutorial .tip b')).toHaveText('Aim at the rope!');
  await expect(page.locator('.hp.p1 .val')).toHaveText('80');
  await expect(page.locator('.shots .sv')).toHaveText('5');

  // drag back (down-left) and release: shoots up and to the right
  const vp = page.viewportSize()!;
  const x0 = vp.width * 0.5;
  const y0 = vp.height * 0.5;
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(x0 - i * 14, y0 + i * 8);
  await page.mouse.up();
  await page.waitForFunction(`${APP}.duel.shotsUsed === 1`);
  await expect(page.locator('.shots .sv')).toHaveText('4');
  // the first shot ends the tutorial for good
  await expect(page.locator('.tutorial .tip b')).toHaveText('Gravity does the rest…');
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
  await expect(page.locator('.star.on')).toHaveCount(3);
  await expect(page.locator('#next')).toBeVisible();
  const save = await page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? '{}'), SAVE_KEY);
  expect(save.levels['forest-1'].stars).toEqual([true, true, true]);
  expect(save.coins).toBe(25);
  await page.locator('#next').click();
  await expect(page.locator('.lvname')).toContainText('Grand Hall');
});

test('main menu, worlds, settings (language, reset with confirmation), pause menu, keyboard', async ({ page }) => {
  await page.addInitScript(([k, v]) => localStorage.setItem(k!, v!), [SAVE_KEY, RETURNING]);
  await page.goto('/');
  await expect(page.locator('.logo')).toContainText('TOPPLE');
  for (const id of ['#play', '#worlds', '#versus', '#endless', '#settings']) await expect(page.locator(id)).toBeVisible();

  await page.locator('#worlds').click();
  await expect(page.locator('.lvl')).toHaveCount(3);
  await expect(page.locator('.lvl.locked')).toHaveCount(2);
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
  for (const sel of ['#pause', '.hp.p0', '.hp.p1', '.shots', '.ab']) await inside(sel);
});
