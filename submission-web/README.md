# Stick Duel

**Tagline:** Drag back, release, bonk! Turn-based physics duels with floppy stick figures.

## Description

A juicy turn-based physics duel. Drag back and release to fire arrows, axes, spears and bombs at your stick-figure rival: ragdolls flop, hats fly off on headshots and the final blow plays in a slow-motion kill cam. Six worlds, six bosses, wind, power-ups, stars, coins, 15 hats and 12 colours, daily missions, Endless mode and 2-player duels on one device. No blood, just sparks and comic bubbles.

## Controls

- **Mouse / touch:** drag back anywhere and release to shoot; the dotted line shows your aim, the arc around your
  fighter shows the power. Tap a weapon in the corner to switch. Tap during the slow-motion kill cam to skip it.
- **Keyboard:** Up / Down aim, Left / Right power, Space / Enter fire, 1–6 pick a weapon, P / Esc pause.

## Genre

Action / physics shooter (turn-based, casual, 2D)

## Tags

stickman, archery, physics, ragdoll, turn-based, 2 player, bow, boss, shooting, casual

## Ad-free build

This web build contains **no ads and no portal SDK**: no interstitials, no rewarded-ad buttons (the optional
"try a weapon", "×2 coins" and "revive" offers are not shown; the game is fully playable without them), no
analytics, no external requests (fonts and all assets are inlined in `index.html`), no external links.

## Files

| File | What |
|---|---|
| `stick-duel-web-v1.zip` | the game: a single `index.html` at the zip root (everything inlined, ~0.5 MB unzipped); upload as an HTML5 game, "played in the browser" |
| `cover-630x500.png` | itch.io cover, from the main cover art (`submission/covers/cover-1920x1080.png`) |
| `icon-512x512.png` | icon |
| `screenshot-1.png` … `screenshot-4.png` | 1280x720 gameplay: world 1 level 1 start (tutorial), mid-level (Mountains 3-4, an arrow in flight), aiming with the drag (castle boss), win screen |
| `checks/iframe-<w>x<h>.png` | the zip in an iframe at 640x480, 960x600, 1280x720 and 390x844 after world 1 level 1 was won (scripts/web/check.mjs) |

- **Embed size:** any; the game fills its frame (landscape and portrait). Suggested itch.io viewport 960x600,
  "mobile friendly" on, no fullscreen button needed (the game has none of its own; itch.io's works).
- **Saves:** localStorage, key `stick-duel.save.v1` only (a JSON document: progress, coins, unlocks, settings,
  daily missions).

## Rebuild

```sh
npm ci
npm run submission:web     # web build (vite build --mode web → dist-web/) → submission-web/stick-duel-web-v1.zip
npm run check:web -- submission-web/stick-duel-web-v1.zip --shots submission-web/checks
npm run store:web          # cover, icon and the four screenshots
```
