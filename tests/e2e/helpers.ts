import { expect, type Page } from '@playwright/test';

/** Automation hook name (src/ui/app.ts). */
export const APP = 'window.__toppleDuel';
export const SAVE_KEY = 'topple-duel.save.v1';

/** A returning player (tutorial done): the game opens on the main menu. */
export const RETURNING = JSON.stringify({ v: 1, levels: {}, coins: 0, tutorial: true, hints: ['castle-1', 'desert-1', 'direct'], music: true, sfx: true, lang: null, last: null });

/** The intended solution of each preview level: target and ammo. */
export const SOLUTIONS: Array<[string, string]> = [
  ['rope', 'arrow'],
  ['chain', 'arrow'],
  ['tntHigh', 'fire'],
];

/**
 * Runs the current duel on a manual clock (no rendering) until it is over. The software GPU in CI
 * renders a few frames per second, so real-time waiting would be slow; the physics is the same.
 */
export async function finishDuel(page: Page): Promise<void> {
  await page.evaluate(`(() => {
    const a = ${APP};
    a.manual = true;
    for (let i = 0; i < 60 * 40 && a.duel.phase !== 'over'; i++) a.advance(1 / 60, false);
    a.advance(1 / 60, true);
    a.manual = false;
  })()`);
}

/** Wins the current level with its intended environmental shot. */
export async function winCurrentLevel(page: Page): Promise<void> {
  await page.waitForFunction(`${APP}.duel && ${APP}.duel.phase === 'aim'`);
  const idx = (await page.evaluate(`${APP}.levelIndex`)) as number;
  const [target, ammo] = SOLUTIONS[idx]!;
  expect(await page.evaluate(`${APP}.aimAtTarget(${JSON.stringify(target)}, ${JSON.stringify(ammo)})`)).toBe(true);
  expect(await page.evaluate(`${APP}.autoFire()`)).toBe(true);
  await finishDuel(page);
  await expect(page.locator('.card.result.won')).toBeVisible({ timeout: 10_000 });
}

/** Loses the current level by wasting the last shot. */
export async function loseCurrentLevel(page: Page): Promise<void> {
  await page.waitForFunction(`${APP}.duel && ${APP}.duel.phase === 'aim'`);
  await page.evaluate(`(() => { const d = ${APP}.duel; for (const k of Object.keys(d.ammo)) d.ammo[k] = 0; d.ammo.arrow = 1; d.selectAmmo('arrow'); d.setAim(1.0, 0); ${APP}.autoFire(); })()`);
  await finishDuel(page);
  await expect(page.locator('.card.result.lost')).toBeVisible({ timeout: 10_000 });
}

export function trackExternal(page: Page, ignore: string[] = []): string[] {
  const external: string[] = [];
  page.on('request', (r) => {
    const u = r.url();
    if (ignore.includes(u)) return;
    if (!u.startsWith('http://localhost') && !u.startsWith('data:') && !u.startsWith('blob:')) external.push(u);
  });
  return external;
}
