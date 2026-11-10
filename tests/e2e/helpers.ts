import { readFileSync } from 'node:fs';
import { expect, type Page } from '@playwright/test';

/** Automation hook name (src/ui/app.ts). */
export const APP = 'window.__toppleDuel';
export const SAVE_KEY = 'topple-duel.save.v1';

/** A returning player (tutorial done): the game opens on the main menu. */
export const RETURNING = JSON.stringify({ v: 1, levels: {}, coins: 0, tutorial: true, hints: ['castle-1', 'desert-1', 'direct'], music: true, sfx: true, lang: null, last: null });

/** Winning shots proven by the level checker (docs/levels-report.json). */
interface Shot {
  ammo: string;
  angle: number;
  power: number;
}
const REPORT = JSON.parse(readFileSync(new URL('../../docs/levels-report.json', import.meta.url), 'utf8')) as Array<{ id: string; solution: Shot[] | null }>;
export const solutionOf = (id: string): Shot[] => REPORT.find((r) => r.id === id)?.solution ?? [];

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

/** Wins the current level by replaying the level checker's solution, shot by shot. */
export async function winCurrentLevel(page: Page): Promise<void> {
  await page.waitForFunction(`${APP}.duel && ${APP}.duel.phase === 'aim'`);
  const id = (await page.evaluate(`${APP}.duel.level.id`)) as string;
  const shots = solutionOf(id);
  expect(shots.length, `no solution for ${id}`).toBeGreaterThan(0);
  for (const s of shots) {
    await page.waitForFunction(`${APP}.duel.phase === 'aim'`);
    expect(await page.evaluate(`${APP}.shoot(${s.angle}, ${s.power}, ${JSON.stringify(s.ammo)})`)).toBe(true);
    await page.evaluate(`(() => {
      const a = ${APP};
      a.manual = true;
      for (let i = 0; i < 60 * 40 && a.duel.phase !== 'aim' && a.duel.phase !== 'over'; i++) a.advance(1 / 60, false);
      a.advance(1 / 60, true);
      a.manual = false;
    })()`);
  }
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
