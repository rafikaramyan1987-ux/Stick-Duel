# Stick Duel — GamePix submission

## Name
Stick Duel

## Short description
Drag back, release, bonk! Stick Duel is a turn-based physics duel with floppy stick-figure ragdolls. Fire arrows, axes, spears and bombs across six worlds, beat six bosses, earn stars and coins, and unlock new weapons, hats and colours. Play the adventure, duel a friend on the same device, or survive as long as you can in Endless mode.

## Long description
Stick Duel is a juicy turn-based physics duel. Drag back and release to fire arrows, throw axes, spears,
bombs and boomerangs at your stick-figure rival. Every hit makes the ragdoll flop and stagger, hats fly off on
headshots, and the final blow plays in a slow-motion kill cam. Pop floating balloons and crates for coins and
power-ups (fire arrows, triple shots, shields, hearts), or knock a weakened rival right off the platform!

Travel through six worlds: a whispering forest, castle ramparts, windy mountain peaks, a sandstorm desert, a
slippery frozen lake and a crumbling volcano, each with its own obstacles, wind, enemies and a boss with a
special weapon. Earn up to three stars per level, open the daily chest, complete daily missions and spend your
coins on new weapons, 15 hats and 12 colours. Duel a friend on the same device, or see how many enemies you can
beat in Endless mode. A short guided tutorial gets new players started.

No blood, no gore: just sparks, stars and comic word bubbles. Plays in landscape and portrait, on desktop and
mobile. Progress is saved automatically. Available in English and French.

## Controls
- **Mouse / touch:** drag back anywhere and release to shoot. The dotted line shows your aim, the arc around
  your fighter shows the power. Tap a weapon in the corner to switch. Tap during the slow-motion kill cam to skip it.
- **Keyboard:** Up / Down aim, Left / Right power, Space / Enter fire, 1–6 pick a weapon, P / Esc pause.

## Tags
stickman, archery, physics, 2 players, boss, ragdoll, shooting, turn-based

## Files in this folder
| What | File |
|---|---|
| Game build: `index.html` at the zip root (single file, everything inlined, GamePix SDK v3 only, no other external request) | `stick-duel-gamepix-v1.zip` |
| Icon 512×512 | `icon-512x512.png` |
| Cover 1280×720 | `cover-1280x720.png` |
| Gameplay capture (start, one level, a rewarded ad, a fake interstitial from the SDK simulator) | `stick-duel-gamepix-gameplay.mp4` |

Rebuild: `npm run build:gamepix && npm run submission:gamepix && node scripts/check-gamepix-zip.mjs`.

## GamePix integration
- SDK v3 loaded in `<head>` before the game, `GamePixConfig = { lifecycle: 'manual' }`.
- `lifecycle.loading` during boot (integer, increasing, up to 100), `await lifecycle.loaded()` before the menu,
  `lifecycle.gameStart()` once, when the first duel starts.
- `pause` / `resume` events and a hidden tab pause the game (physics, timers, input) and mute all audio; the
  player's own sound / music settings are kept on resume. Window blur does not pause.
- Interstitials only at natural breaks (leaving a result screen, at most one every 2 minutes); no pre-roll.
- Rewarded ads only from buttons that say the reward (try a locked weapon, double the coins, revive once in a
  boss fight); granted only on `{ success: true }`, otherwise "No ad available right now, try later".
- `happyMoment`: `level_complete`, `boss_defeated`, `high_score`; `sadMoment`: `level_failed`, `game_over`.
- Language from `GamePix.lang()` (English or French, English otherwise). Saves in plain localStorage.
- No external links, no "more games", no other SDK, no quit button, no rotate-device prompt.
