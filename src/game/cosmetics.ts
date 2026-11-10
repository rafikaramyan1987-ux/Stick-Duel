import type { HatId } from '../render/character';

/** Hats and shirt colours bought with coins (purely cosmetic). */
export interface Cosmetic<T extends string> {
  id: T;
  price: number;
}

export const HATS: Array<Cosmetic<HatId>> = [
  { id: 'headband', price: 0 },
  { id: 'none', price: 0 },
  { id: 'cap', price: 40 },
  { id: 'hood', price: 60 },
  { id: 'turban', price: 70 },
  { id: 'tophat', price: 90 },
  { id: 'helmet', price: 110 },
  { id: 'viking', price: 130 },
  { id: 'wizard', price: 150 },
  { id: 'crown', price: 250 },
];

export type ColorId = 'blue' | 'red' | 'green' | 'orange' | 'purple' | 'pink' | 'teal' | 'black' | 'gold';
export const COLORS: Array<Cosmetic<ColorId> & { shirt: number; pants: number }> = [
  { id: 'blue', price: 0, shirt: 0x3d8bff, pants: 0x2f3e6b },
  { id: 'red', price: 30, shirt: 0xe5483d, pants: 0x4a2b2b },
  { id: 'green', price: 30, shirt: 0x4caf50, pants: 0x2e4a2e },
  { id: 'orange', price: 50, shirt: 0xff9a2e, pants: 0x5a3a1e },
  { id: 'purple', price: 50, shirt: 0x8e5cf2, pants: 0x3a2a5a },
  { id: 'pink', price: 60, shirt: 0xff7eb6, pants: 0x5a2a45 },
  { id: 'teal', price: 60, shirt: 0x1fb5a8, pants: 0x1f4a46 },
  { id: 'black', price: 90, shirt: 0x34343c, pants: 0x1c1c22 },
  { id: 'gold', price: 200, shirt: 0xf5c04a, pants: 0x6a4e1a },
];

export const hatPrice = (id: string): number => HATS.find((h) => h.id === id)?.price ?? 0;
export const colorById = (id: string) => COLORS.find((c) => c.id === id) ?? COLORS[0]!;
