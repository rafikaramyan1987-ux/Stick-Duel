#!/usr/bin/env node
/**
 * Copies only the Kenney models and sounds the game actually uses from assets-src/ into src/assets/,
 * so the build only ships what it needs (everything is inlined into the single-file build).
 *
 *   node scripts/pack-assets.mjs
 *
 * - Models: GLB files are copied as-is (they are already small, 2–20 KB each). The Castle Kit and
 *   Platformer Kit models reference an external "Textures/colormap.png"; that palette texture is copied
 *   once per kit and wired up at runtime (src/render/assets.ts).
 * - Sounds: OGG files are converted with ffmpeg to mono 64 kbit/s MP3 (plays in every browser,
 *   including older Safari) and loudness-normalised so every sound sits at a consistent volume.
 *
 * The output is committed, so a normal build does not need ffmpeg.
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const SRC = 'assets-src';
const OUT = 'src/assets';

/** kit folder → [model directory, model names] */
const MODELS = {
  nature: [
    'nature-kit/Models/GLTF format',
    [
      'tree_default', 'tree_oak', 'tree_pineTallA', 'tree_pineRoundC', 'tree_fat', 'tree_palmTall', 'tree_palm',
      'log', 'rock_largeC', 'rock_tallA', 'rock_tallC', 'stone_largeA',
      'grass_large', 'grass', 'flower_redA', 'flower_yellowA', 'mushroom_red', 'plant_bush', 'plant_bushLarge',
      'cactus_tall', 'cactus_short',
    ],
  ],
  castle: [
    'castle-kit/Models/GLB format',
    [
      'wall', 'wall-half', 'tower-square-base', 'tower-square-mid', 'tower-square-mid-windows', 'tower-square-top-roof',
      'tower-hexagon-roof', 'flag-banner-long', 'wall-pillar',
    ],
  ],
  platformer: ['platformer-kit/Models/GLB format', ['crate', 'crate-strong', 'barrel']],
};

/** output name → source file (without .ogg) */
const SOUNDS = {
  wood_heavy_0: 'impact-sounds/Audio/impactWood_heavy_000',
  wood_heavy_1: 'impact-sounds/Audio/impactWood_heavy_002',
  wood_med_0: 'impact-sounds/Audio/impactWood_medium_000',
  wood_med_1: 'impact-sounds/Audio/impactWood_medium_003',
  wood_light_0: 'impact-sounds/Audio/impactWood_light_001',
  plank_0: 'impact-sounds/Audio/impactPlank_medium_000',
  plank_1: 'impact-sounds/Audio/impactPlank_medium_002',
  stone_0: 'impact-sounds/Audio/impactMining_000',
  stone_1: 'impact-sounds/Audio/impactMining_003',
  plate_heavy_0: 'impact-sounds/Audio/impactPlate_heavy_000',
  metal_heavy_0: 'impact-sounds/Audio/impactMetal_heavy_000',
  metal_heavy_1: 'impact-sounds/Audio/impactMetal_heavy_003',
  metal_light_0: 'impact-sounds/Audio/impactMetal_light_001',
  punch_med_0: 'impact-sounds/Audio/impactPunch_medium_000',
  punch_med_1: 'impact-sounds/Audio/impactPunch_medium_002',
  punch_heavy_0: 'impact-sounds/Audio/impactPunch_heavy_001',
  soft_heavy_0: 'impact-sounds/Audio/impactSoft_heavy_000',
  soft_med_0: 'impact-sounds/Audio/impactSoft_medium_001',
  glass_0: 'impact-sounds/Audio/impactGlass_medium_001',
  ui_click: 'interface-sounds/Audio/click_002',
  ui_select: 'interface-sounds/Audio/select_002',
  ui_confirm: 'interface-sounds/Audio/confirmation_002',
  ui_open: 'interface-sounds/Audio/open_002',
  ui_close: 'interface-sounds/Audio/close_002',
  ui_error: 'interface-sounds/Audio/error_004',
  ui_switch: 'interface-sounds/Audio/switch_002',
  ui_star: 'interface-sounds/Audio/maximize_006',
  ui_pluck: 'interface-sounds/Audio/pluck_001',
  ui_toggle: 'interface-sounds/Audio/toggle_002',
};

function packModels() {
  const out = join(OUT, 'models');
  rmSync(out, { recursive: true, force: true });
  for (const [kit, [dir, names]] of Object.entries(MODELS)) {
    const kitOut = join(out, kit);
    mkdirSync(kitOut, { recursive: true });
    for (const n of names) {
      const src = join(SRC, dir, `${n}.glb`);
      if (!existsSync(src)) throw new Error(`missing model ${src}`);
      copyFileSync(src, join(kitOut, `${n}.glb`));
    }
    const tex = join(SRC, dir, 'Textures', 'colormap.png');
    if (existsSync(tex)) copyFileSync(tex, join(kitOut, 'colormap.png'));
  }
}

function packSounds() {
  const out = join(OUT, 'sfx');
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  for (const [name, src] of Object.entries(SOUNDS)) {
    const file = join(SRC, `${src}.ogg`);
    if (!existsSync(file)) throw new Error(`missing sound ${file}`);
    execFileSync('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y', '-i', file,
      // trim leading silence, normalise peaks to a consistent level
      '-af', 'silenceremove=start_periods=1:start_threshold=-50dB,loudnorm=I=-16:TP=-1.5:LRA=11',
      '-ac', '1', '-ar', '44100', '-b:a', '64k', join(out, `${name}.mp3`),
    ]);
  }
}

packModels();
packSounds();
const count = (d) => readdirSync(d, { recursive: true }).length;
console.info(`packed ${count(join(OUT, 'models'))} model files and ${count(join(OUT, 'sfx'))} sounds into ${OUT}/`);
