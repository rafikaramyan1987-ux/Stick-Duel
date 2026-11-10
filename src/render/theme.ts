import type { WorldId } from '../levels/types';

/** One bright palette per world (matches the Kenney kits' warm, soft look). */
export interface Theme {
  skyTop: number;
  skyBottom: number;
  fog: number;
  fogNear: number;
  fogFar: number;
  sun: number;
  sunIntensity: number;
  hemiSky: number;
  hemiGround: number;
  /** Terrain top surface and sides. */
  top: Record<'grass' | 'stone' | 'sand' | 'snow' | 'dark', number>;
  side: number;
  sideDark: number;
  /** Ground plane stretching into the distance. */
  far: number;
  hills: number[];
}

export const THEMES: Record<WorldId, Theme> = {
  forest: {
    skyTop: 0x5fb8ff,
    skyBottom: 0xdff4ff,
    fog: 0xcfeefc,
    fogNear: 30,
    fogFar: 95,
    sun: 0xfff1d6,
    sunIntensity: 2.4,
    hemiSky: 0xd9f0ff,
    hemiGround: 0x7a9a55,
    top: { grass: 0x7dd54f, stone: 0xb9b3a8, sand: 0xf2d38a, snow: 0xf4fbff, dark: 0x5b5048 },
    side: 0xb87c4c,
    sideDark: 0x8e5a35,
    far: 0x8fd35c,
    hills: [0x86cf5d, 0x6fbf55, 0x5aa94e],
  },
  castle: {
    skyTop: 0x76a8ff,
    skyBottom: 0xffe8cc,
    fog: 0xf6e3cf,
    fogNear: 30,
    fogFar: 95,
    sun: 0xffe2b8,
    sunIntensity: 2.4,
    hemiSky: 0xe7e6ff,
    hemiGround: 0x9a8670,
    top: { grass: 0x86cf5a, stone: 0xd9c4a4, sand: 0xf2d38a, snow: 0xf4fbff, dark: 0x5b5048 },
    side: 0xb79c7c,
    sideDark: 0x8f765b,
    far: 0x9bcf6a,
    hills: [0x9ccc6c, 0x86ba60, 0x74a85a],
  },
  mountains: {
    skyTop: 0x6aa8f0,
    skyBottom: 0xe6f0ff,
    fog: 0xdbe7f5,
    fogNear: 30,
    fogFar: 100,
    sun: 0xfff4e0,
    sunIntensity: 2.3,
    hemiSky: 0xdfeaff,
    hemiGround: 0x7d8a90,
    top: { grass: 0x8ccf5e, stone: 0xb7b8bd, sand: 0xf2d38a, snow: 0xf4fbff, dark: 0x5b5048 },
    side: 0x9a8f88,
    sideDark: 0x766c66,
    far: 0x9ccf74,
    hills: [0xa3acb8, 0x8e98a6, 0x7b8595],
  },
  desert: {
    skyTop: 0x4fb0ff,
    skyBottom: 0xffeab8,
    fog: 0xffe6bd,
    fogNear: 28,
    fogFar: 90,
    sun: 0xfff0c8,
    sunIntensity: 2.6,
    hemiSky: 0xfff3dc,
    hemiGround: 0xc49a5c,
    top: { grass: 0x9ccf5a, stone: 0xd8a476, sand: 0xf5d08a, snow: 0xf4fbff, dark: 0x5b5048 },
    side: 0xe0a862,
    sideDark: 0xbf8546,
    far: 0xf4cc85,
    hills: [0xf2c27a, 0xe8b06a, 0xd99c5c],
  },
  frozen: {
    skyTop: 0x7fbfff,
    skyBottom: 0xeaf7ff,
    fog: 0xe4f3ff,
    fogNear: 30,
    fogFar: 95,
    sun: 0xf4f8ff,
    sunIntensity: 2.2,
    hemiSky: 0xeaf6ff,
    hemiGround: 0x9ab4c8,
    top: { grass: 0x8ccf5e, stone: 0xb7c2cc, sand: 0xf2d38a, snow: 0xf6fcff, dark: 0x5b5048 },
    side: 0x9fb6c9,
    sideDark: 0x7d96ab,
    far: 0xf0f8ff,
    hills: [0xdcecf8, 0xc8deef, 0xb3cfe6],
  },
  volcano: {
    skyTop: 0x7a5a8a,
    skyBottom: 0xffb27a,
    fog: 0xe8a07a,
    fogNear: 28,
    fogFar: 85,
    sun: 0xffc89a,
    sunIntensity: 2.2,
    hemiSky: 0xffd2b0,
    hemiGround: 0x5a3b33,
    top: { grass: 0x7aa04a, stone: 0x6d5a52, sand: 0xc9a06a, snow: 0xf4fbff, dark: 0x4a3b36 },
    side: 0x5e4740,
    sideDark: 0x47342f,
    far: 0x6a4f45,
    hills: [0x6b4c48, 0x583d3b, 0x47302f],
  },
};
