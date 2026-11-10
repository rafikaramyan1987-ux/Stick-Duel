# Stick Duel — CrazyGames submission

## Short description
Drag back, release, bonk! Turn-based physics duels with floppy stick figures across six worlds and six bosses.

## Description
Stick Duel is a juicy turn-based physics duel. Drag back and release to fire arrows, throw axes, spears, bombs
and boomerangs at your stick-figure rival. Every hit makes the ragdoll flop and stagger, hats fly off on
headshots, and the final blow plays in a slow-motion kill cam. Pop floating balloons and crates for coins and
power-ups (fire arrows, triple shots, shields, hearts) — or knock a weakened rival right off the platform!

Travel through six worlds — a whispering forest, castle ramparts, windy mountain peaks, a sandstorm desert,
a slippery frozen lake and a crumbling volcano — each with its own obstacles, wind, enemies and a boss with a
special weapon. Earn up to three stars per level, open the daily chest, complete daily missions and spend your
coins on new weapons, 15 hats and 12 colours. Duel a friend on the same device, or see how many enemies you can
beat in Endless mode. A short guided tutorial gets new players started.

No blood, no gore: just sparks, stars and comic word bubbles.

## Controls
- **Mouse / touch:** drag back anywhere and release to shoot — the dotted line shows your aim, the arc around
  your fighter shows the power. Tap a weapon in the corner to switch. Tap during the slow-motion kill cam to skip it.
- **Keyboard:** ↑/↓ aim, ←/→ power, Space/Enter fire, 1–6 pick a weapon, P/Esc pause.

## Tags
archery, stickman, physics, ragdoll, turn based, 2 player, bow, boss, shooting, casual

## Age rating
PEGI 7 friendly: cartoon slapstick, no blood; hits show sparks, stars and comic numbers.

## Files in this folder
| What | File |
|---|---|
| Game build — unzips to a folder `stick-duel-v1/` with `index.html` (single file, ~0.5 MB, CrazyGames SDK v3 included, no other external requests) | `stick-duel-v1.zip` |
| Cover 16:9 (1920×1080) | `covers/cover-1920x1080.png` |
| Cover 2:3 (800×1200) | `covers/cover-800x1200.png` |
| Cover 1:1 (800×800) | `covers/cover-800x800.png` |
| Trailer, landscape 1920×1080, ~18.7 s, no sound | `videos/trailer-1920x1080.mp4` |
| Trailer, portrait 2:3 1080×1620, ~18.7 s, no sound | `videos/trailer-1080x1620.mp4` |

- **Covers:** title only, top-left corner kept clear, rendered from a real duel (castle boss, the hero's arrow
  about to land).
- **Trailers:** recorded in real time from real gameplay in Chromium (no fast-forward): castle headshot,
  mountains axe throw, desert fire-balloon pickup, snow bomb with a triple-shot bonus, and the volcano boss K.O. in
  the slow-motion kill cam. The first frame is the cover.

## SDK integration (checked, see `docs/crazygames-checklist.md`)
loadingStart/Stop around boot · gameplayStart/Stop around real play only (stopped in menus, pause, results and
ads) · happytime when a boss is beaten · midgame ads only between levels · optional rewarded ads (revive once in a
boss fight, ×2 coins, try a locked weapon) that never block the game · SDK mute setting respected · progress
saved with the Data Module (localStorage fallback) · no external links or logins.

## Rebuild
```bash
npm ci
npm run build && npm run covers && npm run videos     # covers + trailers (needs ffmpeg)
npm run build:crazygames && npm run submission         # stick-duel-v1.zip
```
