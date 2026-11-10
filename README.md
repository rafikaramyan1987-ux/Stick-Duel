# Topple Duel

A turn-based **2.5D physics duel** where you win by using the environment, not by direct hits.
Your rival hides behind walls and roofs; a direct arrow only scratches them. So you shoot the world
instead: cut the rope that holds a log, drop the chandelier, set off the barrels — and let gravity do the rest.

Media: covers and ~18 s trailers in [`submission/`](submission/), the level checker's report in
[`docs/levels-report.md`](docs/levels-report.md), the Phase A preview in [`docs/preview/`](docs/preview/).

## How it plays

- **Drag back and release** to shoot (mouse or touch). A dotted line shows the first part of the flight
  (the whole arc in the tutorial) and a power meter sits above your archer. Keyboard: arrows aim / power,
  **Space** shoots, **1–5** pick the ammo, **P** pauses (`KeyboardEvent.code`: QWERTY and AZERTY; Escape and
  Ctrl/Cmd are never used).
- **Damage comes from things that fall or fly**, scaled by their mass and impact speed. A direct arrow does
  6–15 points; a dropped chandelier does over 200. Ropes and chains snap when shot, wood and stone break into
  chunky pieces, fire spreads to touching wood, TNT sets off its neighbours.
- **Ammo**, unlocked over time: arrow (cuts ropes, small push) → fire arrow (burns wood, lights barrels,
  forest 4) → heavy bolt (big push, cracks stone, castle) → bomb (area blast, mountains) → ice arrow (freezes
  water into a bridge, makes bodies slippery, frozen lake). Each level gives a limited set.
- **Six worlds × (8 levels + a boss arena)** = 54 levels: forest (ropes, logs, rams), castle (chandeliers,
  stone roofs), mountains (boulders on cliffs, wind), desert (sand, hanging barrels), frozen lake (ponds to
  freeze, sliding ice blocks), volcano (lava, stilts). Levels 1–3 have one obvious solution; from level 4
  the rival is protected (a roof that only fire removes, a door two heavy bolts crack…), so par grows to 2–3
  shots and the order matters. Every 4th level is a tricky one.
- **The rival** takes turns and uses the environment against you (a crate over your head, a barrel next to
  you); its accuracy grows from world to world.
- **Stars:** win · within par · a trick shot (a chain reaction, or a win without any direct hit). The winning
  chain reaction is replayed in slow motion.
- **2 players** on one device (six symmetric arenas), **Endless** (random arenas from proven hazards, HP
  carries over, best score saved), **shop** with 10 hats and 9 colours for coins.
- **10 languages** (en, fr, de, it, es, pt, nl, pl, tr, ru), one JSON file each; the language comes from the
  platform (GamePix.lang(), CrazyGames locale, browser language) and can be changed in Settings.
- **Juice:** camera shake, short slow motion on collapses and explosions, comic damage bubbles, expressive
  faces, particles made in code.

## Level checker

`npm run levels:check` runs a bot over every level with the real game (fixed 60 Hz step, seed 1, rival turns
included): it tries every candidate first shot (aimed at every rope, body and the rival, flat and lobbed, at
several speeds, plus a grid of angles × powers, for every ammo type) and searches the most promising states for
a win within par. Every win is replayed from scratch before it counts. It also plays a direct-hit-only
strategy and computes the most damage direct hits could ever do. The run fails if a level has no win within
par, if a level after the first three can be won in one shot, or if direct hits alone win from level 3 on.
Results: [`docs/levels-report.md`](docs/levels-report.md) (+ `.json`, whose solutions the e2e tests replay).
Rival HP values come from measured hazard damage (`src/levels/tuning.ts`).

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
src/levels    the 54 arenas (one file per world), building blocks (kit.ts), versus arenas, Endless generator,
              level checker (checker.ts), tuned rival HP
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
