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
| `stick-duel-playgama-v1.zip` | the Playgama build: `index.html` at the zip root (the game, everything inlined), `playgama-bridge.js` (Bridge 2.4.1) + `playgama-bridge-config.json` beside it; relative paths only |
| `cover-800x800.png`, `cover-1080x1920.png`, `cover-1920x1080.png` | the three covers Playgama's form takes (square, portrait, landscape), made with Playgama's own covers script from 1200x1200 / 1080x1920 / 1920x1080 screenshots of real play (Mountains level 4) and the game's title font (Fredoka 700) |
| `icon-512x512.png` | icon (same as submission-web/) |

## Playgama Bridge

- **Version: 2.4.1** (pinned): the official standalone `playgama` build from github.com/Playgama/bridge tag `v2.4.1`,
  vendored in `vendor/playgama-bridge/` (sha256 `b016a8d6…adc25`, checked in CI, reproducible with
  `bash scripts/playgama/build-bridge.sh`). Shipped inside the zip, so the game loads nothing from outside.
- `bridge.initialize()` before the save is read and the menu shows (capped at 10 s); `game_ready` once the boot screen
  is gone; language from `platform.language` (English fallback); progress through Bridge Storage only (key
  `stick-duel.save.v1`, one `storage.get` at start); `level_started` / `level_completed` / `level_failed`;
  interstitials only between levels (result-screen buttons, at most one per 2 minutes, no pre-roll); rewarded ads
  only from the labelled "▶ Double coins", "▶ Try <weapon> for this duel" and "▶ Revive & keep fighting" buttons (hidden where Bridge has no
  rewarded ads), with the reward only after Bridge's `rewarded` state; sound muted and the game paused during ads, on
  Bridge's pause state and when the page is hidden; Bridge's audio state mutes.

## Rebuild

```sh
npm ci
npm run submission:playgama   # vite build --mode playgama → submission-playgama/stick-duel-playgama-v1.zip
npm run check:playgama        # zip checks + Playgama's precheck
npm run test:playgama         # Bridge mock + stubbed Playgama SDK test (Playwright)
node scripts/playgama/shots.mjs <dir>   # gameplay shots for the covers (then Playgama's covers.mjs)
```
