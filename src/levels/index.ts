import { CASTLE } from './castle';
import { DESERT } from './desert';
import { FOREST } from './forest';
import { FROZEN } from './frozen';
import { MOUNTAINS } from './mountains';
import type { LevelDef, WorldId } from './types';
import { VOLCANO } from './volcano';

/** Six worlds × (8 levels + a boss arena), in play order. */
export const WORLD_LEVELS: Record<WorldId, LevelDef[]> = { forest: FOREST, castle: CASTLE, mountains: MOUNTAINS, desert: DESERT, frozen: FROZEN, volcano: VOLCANO };
export const WORLD_ORDER: WorldId[] = ['forest', 'castle', 'mountains', 'desert', 'frozen', 'volcano'];
export const LEVELS: LevelDef[] = WORLD_ORDER.flatMap((w) => WORLD_LEVELS[w]);

export function levelById(id: string): LevelDef | undefined {
  return LEVELS.find((l) => l.id === id);
}
