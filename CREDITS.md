# Credits

## Art and sound (all CC0 — public domain)

Every third-party asset in Topple Duel comes from the Kenney packs below, uploaded to this repository
and unpacked unchanged into `assets-src/<pack>/` (each folder keeps its `License.txt`). Only the files
the game actually uses are copied into `src/assets/` by `scripts/pack-assets.mjs` (sounds converted to
mono MP3 and loudness-normalised); nothing else is downloaded.

| Pack | Version | Author | License | Folder | Used for |
|---|---|---|---|---|---|
| Castle Kit | 2.0 | Kenney (www.kenney.nl) | CC0 1.0 | `assets-src/castle-kit/` | walls, towers, beams, banners, background castle |
| Nature Kit | 2.1 | Kenney (www.kenney.nl) | CC0 1.0 | `assets-src/nature-kit/` | trees, logs, rocks, cacti, palms, grass, flowers, bushes |
| Platformer Kit | 4.1 | Kenney (www.kenney.nl) | CC0 1.0 | `assets-src/platformer-kit/` | crates, wooden barrels, platforms |
| Impact Sounds | 1.0 | Kenney (www.kenney.nl) | CC0 1.0 | `assets-src/impact-sounds/` | wood, stone, metal, glass, punch and soft impacts, breaking |
| Interface Sounds | 1.0 | Kenney (www.kenney.nl) | CC0 1.0 | `assets-src/interface-sounds/` | menu clicks, toggles, stars, bow pluck |

License: <http://creativecommons.org/publicdomain/zero/1.0/> — crediting Kenney is not required, but
we gladly do. Nature Kit colours are tinted slightly in code to match the game's palette.

## Made for this game (in code)

- Fighters (chunky cartoon characters, faces, hats, bows), ropes and chains, chandeliers, TNT barrels,
  wooden planks and posts, ice and glass blocks, broken chunks, terrain, sky and clouds: procedural
  low-poly meshes in `src/render/`.
- Particles (dust, splinters, sparks, fire, smoke, ice shards, confetti): `src/render/fx.ts`.
- Music loops, explosions, whooshes and jingles: synthesised with the Web Audio API (`src/audio/sfx.ts`).
- Icons: inline SVG (`src/ui/icons.ts`).

## Libraries and fonts

| Name | License |
|---|---|
| [three.js](https://threejs.org/) | MIT |
| [Planck.js](https://piqnt.com/planck.js/) (Box2D port) | MIT |
| [Fredoka](https://fonts.google.com/specimen/Fredoka) via @fontsource/fredoka | SIL Open Font License 1.1 |
