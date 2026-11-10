# Topple Duel

A turn-based **2.5D physics archery duel**. You and your rival take turns shooting at each other from
behind cover that wears down under the arrows, and the arena is full of traps: cut the rope that holds a
rock, light a barrel, free a boulder, knock your rival into the lake.

Media: covers and ~20 s trailers in [`submission/`](submission/), the level checker's report in
[`docs/levels-report.md`](docs/levels-report.md), the Phase A preview in [`docs/preview/`](docs/preview/).

## How it plays

- **Drag back and release** to shoot (mouse or touch). A dotted line shows the first part of the flight
  (the whole arc in the tutorial) and a power meter sits above your archer. Keyboard: arrows aim / power,
  **Space** shoots, **1–5** pick the ammo, **P** pauses (`KeyboardEvent.code`: QWERTY and AZERTY; Escape and
  Ctrl/Cmd are never used).
- **A real duel:** both fighters have 100 HP and take turns. Direct hits do damage by zone: **head 35, body
  20, arm/leg 10**, scaled by the arrow's speed, so a duel takes about 4–8 hits. Hits make the fighter
  flinch and stagger, a headshot knocks the hat off, and comic damage numbers pop up (no blood).
- **Cover wears down:** wooden walls, stone blocks, crates and shields stop arrows; arrows stick in and
  break them (wood about 3 arrows, stone about 6 or 2 heavy bolts).
- **Traps** (ropes holding rocks, logs or chandeliers, explosive barrels, logs on slopes, ice pillars,
  boulders behind a stopper, swinging rams) do 40–80 damage, but need a small target, two steps or the
  right ammo. Environment hits less than 6 s apart (even across turns) are one "trap moment": the first hit
  counts in full, what piles up after it (the fall, debris, fire, lava) 35 %, and **a trap moment never does
  more than 80**, so it can never K.O. a full-HP fighter on its own. Falling into water, lava or out of the
  arena costs 30 HP and puts you back on your spot.
- **The rival** plays by the same rules: it shoots at you and through your cover, and from world 2 on it
  also shoots the traps on your side. Its accuracy grows by world and by level.
- **Ammo:** normal arrows are unlimited; special ammo is limited per level and unlocks over time: fire
  arrow (burns wood, lights barrels, forest 5), heavy bolt (big push, cracks stone, castle), bomb (area
  blast, mountains), ice arrow (freezes water, makes bodies slide, frozen lake).
- **Six worlds × (8 levels + a boss)** = 54 levels: forest, castle (chandeliers), mountains (wind,
  boulders), desert (wind, sand, barrels), frozen lake (ice pillars, sliding blocks, the lake), volcano
  (lava). Levels 1–3 teach direct shooting, cover and the first easy trap; from level 4 on traps need
  precision or two steps. Moving targets (swinging chandeliers, logs, barrels) from castle 5. Every 4th
  level is a tricky one. Bosses have 160–220 HP and a special weapon (a 3-arrow volley, heavy bolts, fire
  arrows or bombs).
- **Stars:** win · win with more than half your HP · a trap K.O. or a chain reaction. The final blow is
  replayed in slow motion.
- **2 players** on one device (six symmetric arenas with cover and traps on both sides), **Endless**
  (random arenas from proven modules, HP carries over, best score saved), **shop** with 10 hats and 9
  colours for coins.
- **10 languages** (en, fr, de, it, es, pt, nl, pl, tr, ru), one JSON file each; the language comes from the
  platform (GamePix.lang(), CrazyGames locale, browser language) and can be changed in Settings.
- **Juice:** camera shake, short slow motion on K.O.s and explosions, comic damage bubbles, expressive
  faces, particles made in code.

## Level checker

`npm run levels:check` plays every level as a real duel with the game's own code (fixed 60 Hz step, rival
turns and rival AI included):

- a **sharp bot** tries every candidate shot each turn on a copy of the game (aimed at the rival's head and
  body, every rope, every named body and the water, flat and lobbed, several speeds, every ammo it has) and
  plays the best one for real; its real playthrough proves the level can be won, is replayed from scratch,
  and is what the e2e tests replay;
- five **human bots** make the same choices with a player's aim errors;
- every candidate shot measures the trap damage done to each fighter in that shot.

The run fails if the sharp bot does not win, if a trap ever does more than 80 in one shot, or if the human
bots' winning duels last fewer than 4 player shots on average. Results:
[`docs/levels-report.md`](docs/levels-report.md) (+ `.json`). In CI the six worlds run as parallel jobs and a
last job builds the report.

## Tech

- **Physics:** [Planck.js](https://piqnt.com/planck.js/) (Box2D) in one vertical plane, fixed 60 Hz step, fully
  deterministic (no `Math.random` in the simulation). The same code runs in the game, the rival AI and the
  tests (Node), so a level the tests solve can be solved in the game. `src/physics/`
- **Rendering:** [three.js](https://threejs.org/), perspective side view with a narrow FOV, soft directional
  light with PCF shadows, fog and parallax layers. Static scenery is merged into a few meshes per material
  (≈100 draw calls). `src/render/`
- **Art:** Kenney CC0 Castle Kit, Nature Kit and Platformer Kit models (only the ones used are shipped),
  plus procedural low-poly meshes in the same style (fighters, ropes, chandeliers, TNT, chunks); particles in code.
- **Audio:** Kenney Impact Sounds and Interface Sounds (MP3, normalised), synthesised explosions and looping music.
- **UI:** DOM overlay (HUD, menus, bubbles), Fredoka font bundled, all text from `src/i18n/<lang>.json`.
- **Single-file build** (`vite-plugin-singlefile`): `dist/index.html` is the whole game (≈1.9 MB, ≈0.6 MB zipped).

```
src/physics   simulation (sim.ts: ropes, fire, explosions, water/ice, lava, wind), ragdoll, materials, aiming
src/levels    the 54 arenas (one file per world), building blocks (kit.ts: cover, traps), versus arenas,
              Endless generator, level checker (checker.ts: duel bots)
src/game      duel/turn controller (incl. 2 players), rival AI, save data, cosmetics, frame capture for replays
src/render    stage (renderer, camera, lights), Kenney model loader, props, characters, terrain, backdrop, particles
src/ui        app (screens, HUD, input, tutorial, ads), icons
src/platform  CrazyGames SDK v3, GameDistribution and GamePix SDK v3 adapters, storage
src/assets    Kenney models and sounds actually used (generated by scripts/pack-assets.mjs from assets-src/)
```

## Builds per platform

A build-time flag picks the platform: `VITE_PLATFORM=crazygames | gd | gamepix | web` (or `vite build --mode …`).
Each build only bundles its own SDK adapter.

| Build | Command | Output | SDK |
|---|---|---|---|
| Web (GitHub Pages) | `npm run build` | `dist/index.html` | none, no external request, no ads |
| CrazyGames | `npm run build:crazygames` | `dist-crazygames/index.html` | CrazyGames SDK v3 |
| GameDistribution | `npm run build:gd` | `dist-gd/index.html` | GD HTML5 SDK (game ID unchanged) |
| GamePix | `npm run build:gamepix` | `dist-gamepix/index.html` | GamePix SDK v3 (manual lifecycle) |

`node scripts/check-build.mjs <web|crazygames|gd|gamepix>` checks a build (single file, < 8 MB, no external
links, no other portal's SDK).

**Ads** (portal builds only, none in the web build): interstitials only between levels (at most one every
2 minutes, pre-roll on Play for GameDistribution), never during a duel. Rewarded ads only from labelled
buttons with a TV icon, reward only after the ad really completed: "Watch an ad: extra fire arrow" (once per
level), "Watch an ad: double coins" (win screen), "Watch an ad: continue with 1 HP" (defeat, once per level).
8 s start timeout and "No ad available right now, try later" for 2.5 s. GamePix: `pause`/`resume` and
`soundOff`/`soundOn` events (plus the legacy `GamePix.soundOff()`/`soundOn()` callbacks), visibility pause,
all idempotent and unit-tested when they overlap with each other and with ads; `happyMoment`/`sadMoment`;
locale from `GamePix.lang()`.

**Submission packages:** `submission/topple-duel-v1.zip` (CrazyGames) with covers and trailers,
`submission-gd/topple-duel-gd-v1.zip` with thumbnails and description, `submission-gamepix/topple-duel-gamepix-v1.zip`
with icon, cover, description and how-to-play. The old Stick Duel packages are in `submission-legacy/`.

## Development

```bash
npm ci
npm run dev            # http://localhost:5173
npm run check          # lint + typecheck + unit tests
npm run build && npm run build:crazygames && npm run build:gd && npm run test:e2e
npm run build:gamepix && npm run test:e2e:gamepix
npm run assets         # re-copy the used Kenney models/sounds from assets-src/ (needs ffmpeg)
npm run levels:check   # level checker → docs/levels-report.md
npm run media          # covers, trailers, thumbnails from real gameplay (needs ffmpeg)
```

GitHub Pages deploys `main` automatically (Settings → Pages → Source: GitHub Actions).

Credits: see [CREDITS.md](CREDITS.md).
