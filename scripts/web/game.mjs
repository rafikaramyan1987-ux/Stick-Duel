// Game-specific settings for the open-portal web zip (scripts/web/zip.mjs) and its checker (scripts/web/check.mjs).
export default {
  slug: 'stick-duel',
  /** the ad-free web build (`vite build --mode web` → dist-web/): no portal SDK, no ads, no rewarded-ad offers */
  build: 'npm run build:web',
  dist: 'dist-web',
  /** the only localStorage key the game writes (src/game/progress.ts SAVE_KEY: progress, settings, daily) */
  storageKeys: ['stick-duel.save.v1'],
  query: '',
  canvasSelector: 'canvas#game',
  /**
   * Chromium flags for the checker / store shots: a 2D-canvas game, so not the software-WebGL (SwiftShader) flags,
   * with which page screenshots of the game in an iframe time out
   */
  browserArgs: ['--autoplay-policy=no-user-gesture-required'],
  /** rewarded-ad buttons: try a locked weapon (intro), ×2 coins (win), revive (boss fight lost) */
  adSelector: '.btn.ad',
  async ready(frame) {
    await frame.waitForFunction(() => !!window.__stickDuel && !!document.querySelector('#play'), null, { timeout: 60_000 });
  },
  /**
   * World 1 level 1 like a new player: Play → level 1 on the map → Fight (with the first-time tutorial), then the
   * game's own perfect-aim helper `autoFire` (the one the QA playthrough uses) takes every shot of the player until
   * the result screen; the AI plays its own turns. Simulation at 3x speed (the QA playthrough's default).
   */
  async play(frame) {
    await frame.locator('#play').click();
    await frame.locator('.node[data-level="1"]').click();
    await frame.locator('#fight').click();
    await frame.evaluate(() => (window.__stickDuel.speed = 3));
    await duel(frame, 120_000);
    await settle(frame);
    const won = await frame.evaluate(() => !!document.querySelector('.card.result.won'));
    const info = await frame.evaluate(() => {
      const d = window.__stickDuel.duel;
      return `${d.fighters[0].shots} shots, ${d.turnNumber} turns, HP ${d.fighters.map((f) => f.hp).join(' vs ')}`;
    });
    return { won, why: info, note: `world 1 level 1 won against the AI: ${info}` };
  },
  // ---------------------------------------------------------------- store images (scripts/web/store.mjs)
  /** the main cover (16:9), cropped to 630:500 around the boss and the title */
  cover: { src: 'submission/covers/cover-1920x1080.png', crop: '1260x1000+640+80' },
  icon: 'submission-gamepix/icon-512x512.png',
  /** 1280x720 shots of the web build, from real duels (the player's shots by the game's `autoFire`) */
  shots: [
    {
      name: 'start: world 1 level 1 for a new player, with the drag tutorial',
      run: async (f) => {
        await f.locator('#play').click();
        await f.locator('.node[data-level="1"]').click();
        await f.locator('#fight').click();
        await f.locator('.tutorial .hand').waitFor();
        await f.waitForTimeout(1200);
      },
    },
    {
      name: 'mid-level: Mountains level 4, an arrow in flight after the first exchange',
      save: returning,
      run: async (f) => {
        await start(f, 3, 4);
        await duel(f, 60_000, () => window.__stickDuel.duel.fighters[0].shots >= 1 && window.__stickDuel.duel.turn === 0 && window.__stickDuel.duel.humanAiming);
        // let the "Your turn!" banner and the floating hit texts of the last exchange fade out first
        await f.waitForTimeout(2200);
        await f.waitForFunction(() => !document.querySelector('.banner.show'), null, { timeout: 10_000 }).catch(() => {});
        await f.evaluate(() => window.__stickDuel.autoFire(false));
        await f.waitForFunction(() => window.__stickDuel.duel.projectiles.length > 0, null, { timeout: 15_000 });
        await f.waitForTimeout(450);
      },
    },
    {
      name: 'a mechanic: drag back to aim (dotted aim line + power arc), castle boss',
      save: returning,
      run: async (f) => {
        await start(f, 2, 10);
        await f.waitForFunction(() => window.__stickDuel.duel?.humanAiming, null, { timeout: 30_000 });
        await f.waitForTimeout(2200);
        await f.evaluate(() => {
          const d = window.__stickDuel.duel, s = d.autoShot(true);
          d.setAim(s.angle, s.power * 0.92);
        });
        await f.waitForTimeout(300);
      },
    },
    {
      name: 'win screen: world 1 level 2, stars and coins',
      save: returning,
      run: async (f) => {
        await start(f, 1, 2);
        await duel(f, 120_000);
        await settle(f);
      },
    },
  ],
};

/** a returning player: tutorial and tips done, the first worlds open (so no first-visit tutorial, no tip boxes) */
function returning() {
  const stars = {};
  for (let w = 1; w <= 3; w++) for (let l = 1; l <= (w < 3 ? 10 : 3); l++) stars[`${w}-${l}`] = 3;
  localStorage.setItem('stick-duel.save.v1', JSON.stringify({ version: 1, coins: 380, stars, tutorial: true, tips: ['none', 'head', 'wind', 'weapons', 'bonus'], lastWorld: 3 }));
}

/** the result screen is in and its toasts ("Mission complete!") are gone */
async function settle(frame) {
  await frame.locator('.card.result').waitFor({ timeout: 15_000 }).catch(() => {});
  await frame.waitForTimeout(2600);
  await frame.waitForFunction(() => !document.querySelector('.banner.show'), null, { timeout: 15_000 }).catch(() => {});
  await frame.waitForTimeout(600);
}

/** open level `l` of world `w` from the game's own hooks (as the e2e tests do) and press Fight */
async function start(frame, w, l) {
  await frame.evaluate(([w, l]) => window.__stickDuel.intro(w, l), [w, l]);
  await frame.locator('#fight').click();
}

/** the player's turns by the game's `autoFire` (head shot every other shot) until the result screen, or `until()` */
async function duel(frame, ms, until) {
  const t0 = Date.now();
  let shot = 0;
  while (Date.now() - t0 < ms) {
    const st = await frame.evaluate((u) => {
      const d = window.__stickDuel.duel;
      return { done: !!document.querySelector('.card.result') || (u ? (0, eval)(`(${u})`)() : false), aiming: d?.humanAiming };
    }, until ? String(until) : null);
    if (st.done) return;
    if (st.aiming) {
      shot++;
      await frame.evaluate((head) => window.__stickDuel.autoFire(head), shot % 2 === 0);
    }
    await frame.waitForTimeout(80);
  }
}
