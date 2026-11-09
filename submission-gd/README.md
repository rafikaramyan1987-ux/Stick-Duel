# Stick Duel — GameDistribution submission

**Game ID:** `f09f3bd24a744eefb2580b8c8f977edc`

## Name
Stick Duel

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

## Instructions
- **Mouse / touch:** drag back anywhere and release to shoot — the dotted line shows your aim, the arc around
  your fighter shows the power. Tap a weapon in the corner to switch. Tap during the slow-motion kill cam to skip it.
- **Keyboard:** ↑/↓ aim, ←/→ power, Space/Enter fire, 1–6 pick a weapon, P/Esc pause.

## Key features
- Floppy ragdoll physics: every hit staggers, headshots knock hats off, ring-outs off the platform
- 6 weapons: bow, axe, spear, bomb, boomerang and magic staff — each with its own arc and feel
- 6 worlds × 10 levels, each world ending with a boss and a special boss weapon
- Slow-motion kill cam, combos (Perfect, Sharpshooter, headshot streaks) and floating bonuses
- 2 players on the same device and an Endless mode
- Daily chest, daily missions, 15 hats and 12 colours to unlock
- Desktop and mobile (portrait and landscape), keyboard, mouse and touch
- Progress saved locally; no logins, no external links

## Tags
archery, stickman, physics, 2players, boss

## Files in this folder
| What | File |
|---|---|
| Game build — `index.html` at the zip root (single file, ~0.5 MB, GameDistribution SDK only, no other external requests) | `stick-duel-gd-v1.zip` |
| Thumbnail 512×512 | `thumbnails/thumb-512x512.png` |
| Thumbnail 512×384 | `thumbnails/thumb-512x384.png` |
| Thumbnail 200×120 | `thumbnails/thumb-200x120.png` |
| Thumbnail 1280×720 | `thumbnails/thumb-1280x720.png` |
| Thumbnail 1280×550 | `thumbnails/thumb-1280x550.png` |

Thumbnails are rendered from the real GD build (castle boss, the hero's arrow about to land), game title only.

## SDK integration
- `window.GD_OPTIONS = { gameId, onEvent }` is set and `main.min.js` (script id `gamedistribution-jssdk`) is
  injected once while the game boots — never from a click.
- `SDK_GAME_PAUSE` pauses the game and mutes all audio; `SDK_GAME_START` resumes and restores audio (the in-game
  sound/music settings are respected).
- Interstitials (`gdsdk.showAd()`) only on user input outside gameplay: pre-roll on the first Play / 2 Players /
  Endless click, mid-rolls on the Next / Retry / Map / Menu / Rematch buttons of the result screens. Never during a duel.
- Rewarded ads (`gdsdk.showAd('rewarded')`) are optional: revive once in a boss fight, ×2 coins, try a locked
  weapon. The reward is granted only after `SDK_REWARDED_WATCH_COMPLETE`. Every request settles once (completion,
  rejection / `AD_ERROR` / `AD_SDK_CANCELED`, or nothing started within 8 s); then the game resumes and the button
  says "No ad available right now, try later" for 2.5 s.
- If the SDK fails to load, the game is fully playable without ads (rewarded offers are hidden).
- Saves: localStorage, with an in-memory fallback. No external links, logins or other portals' branding.

## Rebuild
```bash
npm ci
npm run build:gd && npm run thumbnails:gd && npm run submission:gd
```
