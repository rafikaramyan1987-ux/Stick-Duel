import { expect, test } from '@playwright/test';

interface Hook {
  duel: { phase: string; turn: number; turnNumber: number; fighters: Array<{ shots: number; hp: number }>; projectiles: unknown[] } | null;
}
const state = () => {
  const app = (window as unknown as { __stickDuel: Hook }).__stickDuel;
  const d = app.duel;
  return d ? { phase: d.phase, turn: d.turn, turns: d.turnNumber, shots: d.fighters[0]!.shots, enemyHp: d.fighters[1]!.hp, flying: d.projectiles.length } : null;
};

test('loads, starts level 1 and fires a shot by dragging', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('request', (r) => {
    const url = r.url();
    if (!url.startsWith('http://localhost') && !url.startsWith('data:')) errors.push(`external request: ${url}`);
  });

  await page.goto('/');
  await expect(page.locator('#play')).toBeVisible();
  await expect(page.locator('.logo')).toContainText('Stick');
  await page.locator('#play').click();
  await page.locator('.node[data-level="1"]').click();
  await expect(page.locator('#fight')).toBeVisible();
  await page.locator('#fight').click();
  await expect(page.locator('.hud')).toBeVisible();
  await page.waitForFunction(() => {
    const d = (window as unknown as { __stickDuel: Hook }).__stickDuel.duel;
    return d?.phase === 'aim' && d.turn === 0;
  });
  // first time on level 1: the tutorial hand shows the drag
  await expect(page.locator('.tutorial .hand')).toBeVisible();

  // drag back (down-left) and release: shoots up and to the right
  const vp = page.viewportSize()!;
  const x0 = vp.width * 0.5;
  const y0 = vp.height * 0.55;
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(x0 - i * 12, y0 + i * 9);
  await page.mouse.up();

  await page.waitForFunction(() => {
    const d = (window as unknown as { __stickDuel: Hook }).__stickDuel.duel;
    return !!d && d.fighters[0]!.shots === 1;
  });
  const s1 = await page.evaluate(state);
  expect(s1?.shots).toBe(1);
  // the guided first shot ends the tutorial, and it is saved
  await expect(page.locator('.tutorial')).toHaveCount(0);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('stick-duel.save.v1') ?? '{}').tutorial)).toBe(true);
  // the shot resolves and the turn passes to the enemy (or the enemy is hit)
  await page.waitForFunction(() => {
    const d = (window as unknown as { __stickDuel: Hook }).__stickDuel.duel;
    return !!d && (d.turn === 1 || d.phase === 'over');
  }, null, { timeout: 15_000 });
  expect(errors).toEqual([]);
});

test('every screen opens: map, shop, settings, 2 players, endless', async ({ page }) => {
  await page.goto('/');
  await page.locator('#shop').click();
  await expect(page.locator('.shopgrid .item')).toHaveCount(6);
  await page.locator('.topbar .btn').first().click();
  await page.locator('#settings').click();
  await page.locator('[data-lang="fr"]').click();
  await expect(page.locator('.settings h2')).toHaveText('Réglages');
  await page.locator('[data-lang="en"]').click();
  await page.locator('.topbar .btn').first().click();
  await page.locator('#versus').click();
  await page.locator('[data-world="3"]').click();
  await page.locator('#versus-start').click();
  await page.locator('#fight').click();
  await expect(page.locator('.hud .hp.s1 .name')).toHaveText('P2');
  await page.locator('#pause').click();
  await page.locator('.pausecard .btn').last().click();
  await page.locator('#endless').click();
  await page.locator('#endless-start').click();
  await expect(page.locator('#fight')).toBeVisible();
});

test('the tutorial can be skipped and is shown only once', async ({ page }) => {
  await page.goto('/');
  await page.locator('#play').click();
  await page.locator('.node[data-level="1"]').click();
  await page.locator('#fight').click();
  await page.locator('#skip-tutorial').click();
  await expect(page.locator('.tutorial')).toHaveCount(0);
  await page.reload();
  await page.locator('#play').click();
  await page.locator('.node[data-level="1"]').click();
  await page.locator('#fight').click();
  await page.waitForTimeout(800);
  await expect(page.locator('.tutorial')).toHaveCount(0);
});

test('daily rewards: open the chest once, 3 missions', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#daily .dot')).toBeVisible();
  await page.locator('#daily').click();
  await expect(page.locator('.mission')).toHaveCount(3);
  const before = Number(await page.locator('.coins').first().textContent());
  await page.locator('#open-chest').click();
  await expect(page.locator('#open-chest')).toHaveCount(0);
  const after = Number(await page.locator('.coins').first().textContent());
  expect(after).toBeGreaterThan(before);
  await page.locator('.topbar .btn').first().click();
  await expect(page.locator('#daily .dot')).toHaveCount(0);
});

test('tip boxes are fully readable and never cover a floating bonus or a fighter (desktop, 375 px portrait and landscape)', async ({ page }) => {
  for (const vp of [{ width: 1280, height: 720 }, { width: 375, height: 667 }, { width: 667, height: 375 }]) {
    await page.setViewportSize(vp);
    await page.goto('/');
    await expect(page.locator('#play')).toBeVisible(); // the app exists once the title is shown
    await page.evaluate(`(() => { const a = window.__stickDuel; a.save.tutorial = true; a.save.tips = []; a.intro(2, 5); a.fight(); })()`);
    const tip = page.locator('.tipbubble');
    for (let n = 0; n < 2; n++) {
      await expect(tip).toBeVisible({ timeout: 6_000 });
      const box = await tip.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height, clipped: el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1 };
      });
      expect(box.clipped, `${vp.width}x${vp.height} text clipped`).toBe(false);
      expect(box.x, `${vp.width}x${vp.height}`).toBeGreaterThanOrEqual(0);
      expect(box.x + box.w).toBeLessThanOrEqual(vp.width);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y + box.h).toBeLessThanOrEqual(vp.height);
      // screen rectangles of the floating bonuses (crate + its balloons)
      const bonuses = (await page.evaluate(`(() => {
        const a = window.__stickDuel, d = a.duel, s = a.scene, v = a.view;
        const box = (ax, ay, bx, by) => {
          const [x0, y0] = s.toScreen(ax, ay, v);
          const [x1, y1] = s.toScreen(bx, by, v);
          return { x0: x0 / v.dpr, y0: y0 / v.dpr, x1: x1 / v.dpr, y1: y1 / v.dpr };
        };
        // the bonuses (crate + balloons) and the two fighters' bodies
        return [
          ...d.bonuses.filter((b) => b.alive).map((b) => box(b.x - 0.6, b.y - 1.25, b.x + 0.6, b.y + 0.45)),
          ...d.fighters.map((f) => box(f.rag.homeX - 0.4, f.rag.footY - 2.0 * f.rag.scale, f.rag.homeX + 0.4, f.rag.footY)),
        ];
      })()`)) as Array<{ x0: number; y0: number; x1: number; y1: number }>;
      expect(bonuses.length).toBeGreaterThan(0);
      for (const b of bonuses) {
        const overlap = box.x < b.x1 && box.x + box.w > b.x0 && box.y < b.y1 && box.y + box.h > b.y0;
        expect(overlap, `${vp.width}x${vp.height} tip over a bonus or a fighter`).toBe(false);
      }
      // dismiss it: the next tip (if any) takes its place
      await tip.click();
      await page.waitForTimeout(400);
      if (!(await tip.count())) break;
    }
  }
});
