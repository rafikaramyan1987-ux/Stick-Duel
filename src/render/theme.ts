import type { WorldId } from '../game/worlds';

export interface Theme {
  sky: [string, string, string];
  sun: { color: string; glow: string; x: number; y: number; r: number } | null;
  far: string;
  farTop: string;
  mid: string;
  midTop: string;
  near: string;
  nearTop: string;
  haze: string;
  outline: string;
  /** Platform colours: top surface, body light, body dark. */
  top: string;
  body: string;
  bodyDark: string;
  accent: string;
  floor: string;
  floorDark: string;
  ambient: 'leaves' | 'embers' | 'clouds' | 'sand' | 'snow' | 'ash';
}

export const OUTLINE = '#1e1a2b';

export const THEMES: Record<WorldId, Theme> = {
  forest: {
    sky: ['#7fd1f0', '#b8ecf5', '#e9f7d7'],
    sun: { color: '#fff8d6', glow: 'rgba(255,248,200,0.55)', x: 0.78, y: 0.16, r: 0.06 },
    far: '#8cc7b0', farTop: '#a6d8c0',
    mid: '#4f9e63', midTop: '#66b873',
    near: '#2f6e45', nearTop: '#3c8452',
    haze: 'rgba(220,245,230,0.35)',
    outline: OUTLINE,
    top: '#6cc24a', body: '#8a5a3b', bodyDark: '#5e3b27', accent: '#a7e05a',
    floor: '#3f8a46', floorDark: '#2b6233',
    ambient: 'leaves',
  },
  castle: {
    sky: ['#3b3a78', '#c0628a', '#ffb877'],
    sun: { color: '#ffd38a', glow: 'rgba(255,170,110,0.55)', x: 0.25, y: 0.55, r: 0.09 },
    far: '#6b4f86', farTop: '#7d5d98',
    mid: '#4a3a66', midTop: '#5a4878',
    near: '#2c2440', nearTop: '#3a3052',
    haze: 'rgba(255,190,150,0.25)',
    outline: OUTLINE,
    top: '#b9b2a6', body: '#9a9387', bodyDark: '#6e685f', accent: '#d8473f',
    floor: '#5c7a3e', floorDark: '#425a2c',
    ambient: 'embers',
  },
  mountains: {
    sky: ['#2f8fe0', '#7cc4f2', '#dff2ff'],
    sun: { color: '#ffffff', glow: 'rgba(255,255,255,0.6)', x: 0.2, y: 0.14, r: 0.05 },
    far: '#a9c6e8', farTop: '#f4f9ff',
    mid: '#6f86a8', midTop: '#e8f0fa',
    near: '#3d5470', nearTop: '#4c6685',
    haze: 'rgba(235,245,255,0.5)',
    outline: OUTLINE,
    top: '#8fa36a', body: '#8c8579', bodyDark: '#5f5a52', accent: '#e9eef5',
    floor: '#cfe2f5', floorDark: '#9bb6d4',
    ambient: 'clouds',
  },
  desert: {
    sky: ['#f6a64a', '#ffd27a', '#fff0c4'],
    sun: { color: '#fffbe8', glow: 'rgba(255,240,180,0.7)', x: 0.7, y: 0.24, r: 0.1 },
    far: '#e8b77e', farTop: '#f2c891',
    mid: '#d7924f', midTop: '#e6a660',
    near: '#b9713a', nearTop: '#c98248',
    haze: 'rgba(255,230,180,0.35)',
    outline: OUTLINE,
    top: '#f5cf7d', body: '#e3ab5c', bodyDark: '#b97c3a', accent: '#4f9e55',
    floor: '#e6b062', floorDark: '#c48a44',
    ambient: 'sand',
  },
  snow: {
    sky: ['#0f1b45', '#28407a', '#6b86c2'],
    sun: { color: '#f4f6ff', glow: 'rgba(200,220,255,0.45)', x: 0.82, y: 0.15, r: 0.045 },
    far: '#5a6fa6', farTop: '#c8d6f5',
    mid: '#3e5288', midTop: '#e6eeff',
    near: '#283a6a', nearTop: '#f2f6ff',
    haze: 'rgba(170,200,255,0.25)',
    outline: '#16223f',
    top: '#f7fbff', body: '#9fd8f5', bodyDark: '#5fa9d6', accent: '#e9f6ff',
    floor: '#8fc6e6', floorDark: '#5d94bd',
    ambient: 'snow',
  },
  volcano: {
    sky: ['#1d0f1f', '#5a1e2a', '#c4482e'],
    sun: null,
    far: '#4a2330', farTop: '#5c2c38',
    mid: '#2e1820', midTop: '#3a1f27',
    near: '#1a1014', nearTop: '#25161b',
    haze: 'rgba(255,120,60,0.18)',
    outline: '#130b0e',
    top: '#4a3b3d', body: '#3a2e31', bodyDark: '#241c1e', accent: '#ff7a2a',
    floor: '#ff6a1f', floorDark: '#c6361a',
    ambient: 'ash',
  },
};

/** Player shirt/limb colours. */
export const HERO_COLORS: Record<string, string> = {
  blue: '#3d7bff',
  red: '#ff4d4d',
  green: '#3cc46a',
  purple: '#9b5cff',
  orange: '#ff9a2e',
  pink: '#ff6fb5',
  black: '#3a3a48',
  gold: '#ffc83d',
  teal: '#2ec4b6',
  lime: '#a3e635',
  navy: '#2c3e8f',
  rainbow: '#ff4d4d',
};
