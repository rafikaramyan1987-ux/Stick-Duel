# Stick Duel

A juicy, child-friendly **2D physics duel**: two stick-figure ragdolls stand on platforms and take turns
shooting arrows, throwing axes, spears, bombs and boomerangs at each other. Drag back, release, *bonk!*
Hits make the ragdolls flop, stagger and fall over; arrows stay stuck; headshots do extra damage.
No blood or gore — sparks, stars and comic damage numbers instead (aimed at PEGI 7–12).

**Play:** GitHub Pages deploys `main` automatically (Settings → Pages → Source: GitHub Actions).

## Features

- **6 worlds × 10 levels**, each with its own parallax background (sky + 3 layers), palette, ambience,
  obstacles, platform shapes, enemy type and a **boss** at level 10:

  | World | Feel | Enemy | Boss & special weapon |
  |---|---|---|---|
  | Whispering Forest | trees with branches that block shots, falling leaves, birds | Ranger | Oakheart — triple arrow volley |
  | Castle Ramparts | towers, battlements to hide behind, banners, torches | Knight | Sir Ironclad — cannonball |
  | Windy Peaks | high cliffs, big height differences, wind gusts | Viking | Jarl Stormbeard — giant axe |
  | Sunscorch Desert | dunes, cacti, heat shimmer, shifting sandstorm wind | Nomad | The Sand King — twin boomerangs |
  | Frostbite Lake | snowfall, slippery ice floes, frozen lake, snowmen | Yeti | Frostfang — giant snowball |
  | Magma Mountain | lava, smoke, ash, platforms that crumble | Fire golem | Magmor — meteor |

- Difficulty rises smoothly over the 60 levels: distance, height difference, obstacles, wind, AI accuracy.
- **Weapons** with their own physics: bow (fast, sticks), throwing axe (spins), spear (heavy, barely
  affected by wind), bomb (arc + blast knockback), boomerang (curves back), magic staff (ignores wind).
- **Modes:** Adventure vs AI, **2 players** on one device, **Endless** survival with a best score.
- **Progression:** world map, 1–3 stars per level (win · keep half your HP · win within par shots),
  coins, a shop for weapons, hats and colours. The next world unlocks after its boss.
- **AI** solves the real flight equations (same integrator as the game) and adds human-like error that
  shrinks with the level — it is never perfect.
- English + French (auto-detected, switchable in Settings). Sound + music toggles.
- Desktop (mouse/keyboard) and mobile (touch), landscape and portrait — the camera always frames both
  fighters (tighter in phone portrait). `devicePixelRatio` aware (capped at 2 for performance).
- **First-time tutorial** on level 1: an animated hand shows the drag, the first shot follows a glowing
  path, and short tips appear the first time something happens (a hit, wind, several weapons).
  Skippable, shown once.
- **"One more try" extras:** a slow-motion **kill cam** on the final hit (tap to skip), short slow-mo on
  headshots; **floating bonuses** (balloons, crates, golden birds) that give coins or a one-shot power-up
  (fire arrow, triple shot, shield, +20 HP) — the AI grabs them too; **ring-outs** (a heavy hit can knock a
  weakened fighter off the platform for an instant K.O., never on levels 1–3); hats that fly off on
  headshots, comic word bubbles, boss taunts, dizzy stars on low HP.
- **Daily chest + 3 daily missions**, Perfect / Sharpshooter / headshot-streak bonus coins, 15 hats and
  12 colours in the shop.
- **Gentle start:** on levels 1–3 the AI never headshots, always misses its first shot and hits softly;
  nothing stands near the player's line of fire.

## Controls

- **Drag back and release** anywhere to shoot (like a slingshot). The dotted line shows the start of the
  flight, the arc around your fighter shows the power. Wind is shown at the top.
- Pick a weapon with the buttons in the corner (or keys **1–6**).
- Keyboard: **↑/↓** aim, **←/→** power, **Space/Enter** fire, **P/Esc** pause.

## Tech

- Vite + TypeScript, Canvas 2D, [Planck.js](https://piqnt.com/planck.js/) (Box2D) for the ragdolls:
  revolute joints with limits and motors make an *active ragdoll* that stands, flops when hit and gets
  back up. Projectiles use their own deterministic integrator (`src/core/trajectory.ts`), shared by the
  aim preview, the AI and the real shot.
- Everything is drawn in code (no image assets); all sounds and the per-world music loops are
  synthesised with the Web Audio API (`src/audio/sfx.ts`). The Fredoka font is bundled from npm.
- **Single-file build** (`vite-plugin-singlefile`): `dist/index.html` is the whole game (~0.5 MB),
  no extra requests.

```
src/core      pure maths: trajectory, damage/stars/coins, AI aiming, geometry, RNG, weapons
src/game      levels (procedural, seeded), duel runtime, ragdoll, progress/save, worlds
src/render    backgrounds, scenery, fighters, weapons, particles, camera
src/ui        DOM screens + HUD, input, game flow
src/platform  CrazyGames SDK v3, GameDistribution and GamePix SDK v3 adapters, storage
```

## Builds per platform

A build-time flag picks the platform: `VITE_PLATFORM=crazygames | gd | gamepix | web` (or `vite build --mode
crazygames|gd|gamepix`). Each build only bundles its own SDK adapter; the other portal's code and SDK are dropped.

| Build | Command | Output | SDK |
|---|---|---|---|
| Web (GitHub Pages) | `npm run build` | `dist/index.html` | none, no external request |
| CrazyGames | `npm run build:crazygames` | `dist-crazygames/index.html` | CrazyGames SDK v3 (`<head>` script) |
| GameDistribution | `npm run build:gd` | `dist-gd/index.html` | GD HTML5 SDK (injected while booting) |
| GamePix | `npm run build:gamepix` | `dist-gamepix/index.html` | GamePix SDK v3 (`<head>` script, manual lifecycle) |

`node scripts/check-build.mjs <web|crazygames|gd|gamepix>` checks a build: single file, size, no external links,
no other portal's SDK or branding.

## GameDistribution integration

`src/platform/gamedistribution.ts` sets `window.GD_OPTIONS` and loads `main.min.js` once while booting.
`SDK_GAME_PAUSE`/`SDK_GAME_START` pause/mute and resume the game; interstitials only on the first Play click
(pre-roll) and result-screen buttons (mid-roll); rewarded ads grant only after `SDK_REWARDED_WATCH_COMPLETE`,
and every request settles once (completion, error/cancel, or an 8 s start timeout). Saves use localStorage.
If the SDK cannot load, the game plays without ads. Submission files: `submission-gd/` (see its README).

## GamePix integration (SDK v3)

`index.html` loads `gamepix.sdk.js` (with `GamePixConfig = { lifecycle: 'manual' }`) only in the `gamepix`
build; `src/platform/gamepix.ts` drives it: `lifecycle.loading` during boot, `await lifecycle.loaded()` before
the menu, `lifecycle.gameStart()` once on the first duel. The SDK `pause`/`resume` events and a hidden tab
pause the game, block input and mute all audio (window blur does not). Interstitials (`ads.interstitial()`)
only at the same natural breaks as the other portals (no pre-roll); rewarded ads (`ads.reward()`) grant only
on `{ success: true }`. `happyMoment` / `sadMoment` on level complete, boss defeated, high score, level
failed and game over; the locale comes from `GamePix.lang()`. Saves use plain localStorage (synced by the
SDK). Submission files: `submission-gamepix/` (see its README); `node scripts/check-gamepix-zip.mjs` checks
the upload zip (CI).

## CrazyGames integration (SDK v3)

The SDK script is only injected in the `crazygames` build (`npm run build:crazygames`); the Pages build
makes no external request. All calls go through `src/platform/crazygames.ts` and are no-ops elsewhere.

- `loadingStart/Stop` around boot, `gameplayStart/Stop` around actual duels (stopped in menus, pause,
  results and ads; never duplicated), `happytime` when a boss is beaten.
- **Midgame ads only at natural breaks**: when leaving a win/defeat screen, before the next level
  (throttled to one every 2 minutes). Never during a duel.
- **Rewarded ads, always optional**: revive once in a boss fight, double the coins of a level, try a
  locked weapon for one duel. If an ad fails or is unavailable the game simply continues.
- Progress (stars, coins, unlocks, equipment, settings) is saved with the **Data module**, falling back
  to `localStorage` outside CrazyGames. The SDK mute setting is respected (and audio is muted during ads).

## Development

```bash
npm install
npm run dev          # local dev server
npm run check        # lint + typecheck + unit tests
npm run build        # dist/index.html (single file)
npm run build:crazygames && npm run build:gd
npm run test:e2e     # Playwright e2e against the web, CrazyGames and GD builds
npm run build:crazygames && npm run zip   # stick-duel-crazygames.zip
npm run build:gd && npm run thumbnails:gd && npm run submission:gd   # submission-gd/
npm run build:gamepix && npm run submission:gamepix && node scripts/check-gamepix-zip.mjs   # submission-gamepix/
npm run test:e2e:gamepix   # Playwright e2e against the GamePix build (mock SDK)
```

Difficulty is tuned with an automated playtest (no build needed):

- `node scripts/playtest/run.mjs` — a headless bot plays every level of every world and Endless with
  beginner / average / good profiles, aiming only from what a player sees (the dotted no-wind preview,
  the wind arrow, the scenery, its previous miss). Writes `docs/playtest.md` (win rate, turns, duel
  length, shots blocked near the player, AI damage per turn). The knobs live in `TUNING` in
  `src/game/levels.ts`; `--tune '{"skill":[0.3,0.9]}'` tries values without editing code, and
  `--worlds 1 --levels 1,2,3 --runs 6` runs a quick subset.

Tooling scripts (need a build first):

- `node scripts/qa-playthrough.mjs <dir>` — plays level 1 and the boss of every world with a
  perfect-aim bot, asserts victory and saves screenshots.
- `npm run covers` — renders the three store covers from a real duel into `submission/covers`.
- `npm run videos` — records the two trailers (1920×1080 and 2:3 1080×1620) into `submission/videos` (needs ffmpeg).
- `npm run build:crazygames && npm run submission` — `submission/stick-duel-v1.zip` (unzips to `stick-duel-v1/index.html`).
- `npm run check:build` — single file, < 50 MB, no external links (see `docs/crazygames-checklist.md`).

CI (`.github/workflows/ci.yml`) runs lint, typecheck, unit tests, the build-size check and the Playwright
smoke test on every PR; `pages.yml` deploys `dist` from `main` (Node 24).
