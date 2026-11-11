// Game-specific settings for the Playgama zip (scripts/playgama/zip.mjs) and its tests (scripts/playgama/test.mjs).
import web from '../web/game.mjs';

export default {
  slug: web.slug,
  title: 'Stick Duel',
  dist: 'dist-playgama',
  /** the submission zip's version: submission-playgama/<slug>-playgama-v<version>.zip (v1 kept for reference) */
  version: 2,
  exclude: web.exclude,
  query: '',
  /** a 2D-canvas game: plain Chromium (scripts/web/game.mjs `browserArgs`) */
  browserArgs: web.browserArgs,
  /** the rewarded button's "no ad available" text in the platform language (src/i18n result.adFail) */
  adFail: /pas de pub|no ad/i,
  /** the save key the game writes through Bridge Storage (src/game/progress.ts SAVE_KEY) */
  saveKey: web.storageKeys[0],
  /** the language the stubbed Playgama SDK reports (one the game has: en / fr) */
  platformLang: 'fr',
  ready: web.ready,
  /** world 1 level 1, played to its result screen (as in scripts/web/check.mjs) */
  play: web.play,
  /** the labelled rewarded button on the win screen ("▶ Double coins") and what it gives */
  reward: {
    selector: '.card.result .btn.ad#double',
    /** the value the reward changes: the player's coins */
    value: (frame) => frame.evaluate(() => window.__stickDuel.save.coins),
  },
  /** after the result screen: Next (the between-levels interstitial slot), then the next level's intro opens */
  async next(frame) {
    await frame.evaluate(() => (window.__stickDuel.speed = 1));
    await frame.locator('.card.result #next').click({ force: true });
  },
  async nextLevelOpened(frame) {
    await frame.waitForFunction(() => window.__stickDuel.session?.level === 2 && !!document.querySelector('#fight'), null, { timeout: 60_000 });
  },
  /**
   * the game silenced for the platform: the Playgama platform reports muted and the game's ad pause is on (app.ts
   * onAdPause → audio.setMuted(true): the master gain of its WebAudio graph goes to 0, the simulation stops)
   */
  silenced: (frame) => frame.evaluate(() => ({ muted: window.__playgama.muted, adPause: window.__stickDuel.adPlaying === true })),
};
