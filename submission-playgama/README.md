# Stick Duel — Playgama

## Description

Stick Duel is a juicy turn-based physics duel. Drag back and release to fire arrows, axes, spears and bombs at your stick-figure rival: ragdolls flop, hats fly off on headshots and the final blow plays in a slow-motion kill cam. Six worlds, six bosses, wind, power-ups, stars and coins, 15 hats and 12 colours, daily missions, Endless mode and 2-player duels on one device. No blood, just sparks and comic bubbles.

## Controls

- **Mouse / touch:** drag back anywhere and release to shoot; the dotted line shows your aim, the arc around your
  fighter shows the power. Tap a weapon in the corner to switch. Tap during the slow-motion kill cam to skip it.
- **Keyboard:** Up / Down aim, Left / Right power, Space / Enter fire, 1–6 pick a weapon, P pause. No Esc key is used
  in this build.

## Tags

stickman, archery, physics, ragdoll, turn-based, 2 player, bow, boss, shooting, casual

## Languages / orientation

English (default and fallback) and French, from Bridge's `platform.language`. Landscape and portrait.

## Files

| File | What |
|---|---|
| `stick-duel-playgama-v2.zip` | **upload this one.** The Playgama build: `index.html` at the zip root (the game, everything inlined), `playgama-bridge-config.json` beside it; Playgama Bridge from Playgama's CDN, initialized before the game bundle runs; otherwise relative paths only |
| `stick-duel-playgama-v1.zip` | the previous build, kept for reference: **do not upload**. Its vendored single-platform Bridge build had no `qa_tool` adapter, so Playgama's archive check reported "Playgama Bridge never initialized in this archive" (see below) |
| `cover-800x800.png`, `cover-1080x1920.png`, `cover-1920x1080.png` | the three covers Playgama's form takes (square, portrait, landscape), made with Playgama's own covers script from 1200x1200 / 1080x1920 / 1920x1080 screenshots of real play (Mountains level 4) and the game's title font (Fredoka 700) |
| `icon-512x512.png` | icon (same as submission-web/) |

## Playgama Bridge

- **Include:** `<script src="https://bridge.playgama.com/v2/stable/playgama-bridge.js"></script>`, the first script
  in `<head>`, loaded normally: the CDN option Playgama's setup page recommends (wiki.playgama.com/playgama/bridge-sdk/setup;
  `v2/stable` served Bridge 2.4.1 when v2 was built). It loads the adapter of the platform the game runs on, including
  the QA Tool's `qa_tool` adapter that Playgama's archive check uses. Requirement 1.2.5 allows the Bridge, and only it,
  from Playgama's CDN.
- **Why v1 failed the archive check:** v1 shipped a custom single-platform build (`build-dist.ts --type=standalone
  --platform=playgama`), which bundles only the `playgama`, `standalone` and `playgama_sandbox` adapters. Playgama's
  archive check and QA Tool run the game with `?platform_id=qa_tool`; that build has no `qa_tool` adapter, so Bridge fell
  back to its generic base platform (`platform.id` "mock") and never sent the QA Tool its `initialize` handshake. The
  game's own 10 s `Promise.race` (with only a console.warn on failure) hid this.
- **Initialization:** index.html's inline boot (scripts/playgama/boot.js) calls `bridge.initialize()` right after the
  Bridge script; the game bundle is held (`<script type="text/plain" data-playgama-game>`) and starts only once
  initialize() has settled, so nothing of the game runs or loads before it (Playgama's required step 2). There is no
  timeout of the game's own (a console.warn after 15 s if it is still pending). If initialize() fails, or the Bridge
  script does not load, `console.error("[Playgama Bridge] bridge.initialize() failed; the game runs WITHOUT Playgama
  Bridge …")` and the game plays on with no ads and no Bridge storage.
- **Config:** `playgama-bridge-config.json` beside `index.html` (Bridge loads `./playgama-bridge-config.json`).
- The save is read and the menu shows after initialization; `game_ready` once the boot screen
  is gone; language from `platform.language` (English fallback); progress through Bridge Storage only (key
  `stick-duel.save.v1`, one `storage.get` at start); `level_started` / `level_completed` / `level_failed`;
  interstitials only between levels (result-screen buttons, at most one per 2 minutes, no pre-roll); rewarded ads
  only from the labelled "▶ Double coins", "▶ Try <weapon> for this duel" and "▶ Revive & keep fighting" buttons (hidden where Bridge has no
  rewarded ads), with the reward only after Bridge's `rewarded` state; sound muted and the game paused during ads, on
  Bridge's pause state and when the page is hidden; Bridge's audio state mutes.

## Rebuild

```sh
npm ci
npm run submission:playgama   # vite build --mode playgama → submission-playgama/stick-duel-playgama-v2.zip
npm run check:playgama        # zip checks + Playgama's precheck (no FAIL, no WARN)
npm run qa:playgama           # Playgama QA Tool harness: ?platform_id=qa_tool, Bridge's initialize handshake, game_ready
npm run test:playgama         # Bridge mock + stubbed Playgama SDK test (Playwright)
node scripts/playgama/shots.mjs <dir>   # gameplay shots for the covers (then Playgama's covers.mjs)
```
