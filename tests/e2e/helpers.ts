import { readFileSync } from 'node:fs';
import { expect, type Page } from '@playwright/test';

/** Automation hook name (src/ui/app.ts). */
export const APP = 'window.__toppleDuel';
export const SAVE_KEY = 'topple-duel.save.v1';

/** A returning player (tutorial done): the game opens on the main menu. */
export const RETURNING = JSON.stringify({ v: 1, levels: {}, coins: 0, tutorial: true, hints: ['hint.cover', 'hint.trap', 'hint.trapHard', 'hint.rivalTraps', 'ammo-fire', 'ammo-heavy'], music: true, sfx: true, lang: null, last: null });

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

/** Plays the manual clock until it is the player's turn again (or the duel is over). */
async function untilAim(page: Page): Promise<void> {
  await page.evaluate(`(() => {
    const a = ${APP};
    a.manual = true;
    for (let i = 0; i < 60 * 40 && a.duel.phase !== 'aim' && a.duel.phase !== 'over'; i++) a.advance(1 / 60, false);
    a.advance(1 / 60, true);
    a.manual = false;
  })()`);
}

/**
 * Wins the current level: replays the level checker's winning duel shot by shot; if the browser's
 * timing made the duel drift (the world keeps moving while you aim), it goes on with aimed headshots.
 */
export async function winCurrentLevel(page: Page): Promise<void> {
  await page.waitForFunction(`${APP}.duel && ${APP}.duel.phase === 'aim'`);
  const id = (await page.evaluate(`${APP}.duel.level.id`)) as string;
  const shots = solutionOf(id);
  expect(shots.length, `no solution for ${id}`).toBeGreaterThan(0);
  for (const s of shots) {
    if ((await page.evaluate(`${APP}.duel.phase`)) !== 'aim') break;
    expect(await page.evaluate(`${APP}.shoot(${s.angle}, ${s.power}, ${JSON.stringify(s.ammo)})`)).toBe(true);
    await untilAim(page);
  }
  for (let i = 0; i < 20 && (await page.evaluate(`${APP}.duel.phase`)) === 'aim'; i++) {
    await page.evaluate(`(() => { const a = ${APP}; a.duel.sim.fighters[0].hp = 100; a.aimAtTarget('rival head'); a.autoFire(); })()`);
    await untilAim(page);
  }
  await finishDuel(page);
  await expect(page.locator('.card.result.won')).toBeVisible({ timeout: 10_000 });
}

/** Loses the current level: down to 1 HP, then a bomb at your own feet. */
export async function loseCurrentLevel(page: Page): Promise<void> {
  await page.waitForFunction(`${APP}.duel && ${APP}.duel.phase === 'aim'`);
  await page.evaluate(`(() => { const d = ${APP}.duel; d.sim.fighters[0].hp = 1; d.ammo.bomb = 1; d.selectAmmo('bomb'); d.setAim(1.0, 0); ${APP}.autoFire(); })()`);
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
