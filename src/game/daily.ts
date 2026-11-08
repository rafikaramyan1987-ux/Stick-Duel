import { hashSeed, Rng } from '../core/rng';
import { HAT_PRICE, HATS, type HatId, type SaveData } from './progress';

/**
 * Daily chest + 3 daily missions. Everything is stored in the save (CrazyGames
 * Data module or localStorage) and refreshed when the local date changes.
 */
export type MissionKind = 'headshots' | 'flawless' | 'bonuses' | 'wins' | 'ringout' | 'sharpshooter' | 'stars';

export interface Mission {
  kind: MissionKind;
  goal: number;
  progress: number;
  reward: number;
  claimed: boolean;
}

export interface DailyState {
  /** Local date (YYYY-MM-DD) the missions and chest belong to. */
  day: string;
  chestClaimed: boolean;
  /** Days in a row the chest was opened. */
  streak: number;
  lastChest: string;
  missions: Mission[];
}

export const MISSIONS: Record<MissionKind, { goal: number; reward: number }> = {
  headshots: { goal: 3, reward: 40 },
  wins: { goal: 3, reward: 40 },
  bonuses: { goal: 5, reward: 50 },
  stars: { goal: 6, reward: 50 },
  flawless: { goal: 1, reward: 60 },
  ringout: { goal: 1, reward: 60 },
  sharpshooter: { goal: 1, reward: 70 },
};
export const MISSION_KINDS = Object.keys(MISSIONS) as MissionKind[];

export const newDaily = (): DailyState => ({ day: '', chestClaimed: false, streak: 0, lastChest: '', missions: [] });

export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function previousDay(day: string): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return dayKey(new Date(y, m - 1, d - 1));
}

/** Today's 3 missions: always one easy one (wins or headshots), all different. */
export function missionsFor(day: string, exclude: MissionKind[] = []): Mission[] {
  const rng = new Rng(hashSeed(...day.split('-').map(Number)));
  const easy: MissionKind = rng.chance(0.5) ? 'wins' : 'headshots';
  const rest = MISSION_KINDS.filter((k) => k !== easy && !exclude.includes(k));
  const picks: MissionKind[] = [easy];
  while (picks.length < 3) {
    const k = rng.pick(rest);
    if (!picks.includes(k)) picks.push(k);
  }
  return picks.map((kind) => ({ kind, goal: MISSIONS[kind].goal, progress: 0, reward: MISSIONS[kind].reward, claimed: false }));
}

/** New day → new missions and a fresh chest. Returns true if something changed. */
export function refreshDaily(s: SaveData, now: Date): boolean {
  const today = dayKey(now);
  if (s.daily.day === today) return false;
  s.daily.day = today;
  s.daily.chestClaimed = false;
  // a ring-out needs a heavy weapon: not offered while the player only has the bow
  const heavy = s.weapons.some((w) => w === 'spear' || w === 'bomb' || w === 'axe');
  s.daily.missions = missionsFor(today, heavy ? [] : ['ringout']);
  return true;
}

export const chestReady = (s: SaveData): boolean => !s.daily.chestClaimed;
export const missionReady = (m: Mission): boolean => !m.claimed && m.progress >= m.goal;
/** Red dot on the title screen. */
export const dailyHasReady = (s: SaveData): boolean => chestReady(s) || s.daily.missions.some(missionReady);

/** Opens today's chest: coins (more with a streak), sometimes a hat you don't have. */
export function claimChest(s: SaveData, rng: Rng): { coins: number; hat: HatId | null } | null {
  if (!chestReady(s)) return null;
  const d = s.daily;
  d.streak = d.lastChest === previousDay(d.day) ? d.streak + 1 : 1;
  d.lastChest = d.day;
  d.chestClaimed = true;
  const coins = 30 + Math.min(d.streak - 1, 6) * 10 + rng.int(0, 20);
  s.coins += coins;
  let hat: HatId | null = null;
  const cheap = HATS.filter((h) => h !== 'none' && !s.hats.includes(h) && HAT_PRICE[h] <= 160);
  if (cheap.length && rng.chance(0.25)) {
    hat = rng.pick(cheap);
    s.hats.push(hat);
  }
  return { coins, hat };
}

export function addProgress(s: SaveData, kind: MissionKind, n = 1): Mission[] {
  const done: Mission[] = [];
  if (n <= 0) return done;
  for (const m of s.daily.missions) {
    if (m.kind !== kind || m.claimed || m.progress >= m.goal) continue;
    m.progress = Math.min(m.goal, m.progress + n);
    if (m.progress >= m.goal) done.push(m);
  }
  return done;
}

export function claimMission(s: SaveData, index: number): number {
  const m = s.daily.missions[index];
  if (!m || !missionReady(m)) return 0;
  m.claimed = true;
  s.coins += m.reward;
  return m.reward;
}

/** Validates the daily part of a save. */
export function sanitizeDaily(raw: unknown): DailyState {
  const base = newDaily();
  if (!raw || typeof raw !== 'object') return base;
  const d = raw as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '');
  const missions = Array.isArray(d.missions)
    ? d.missions
        .filter((m): m is Record<string, unknown> => !!m && typeof m === 'object' && MISSION_KINDS.includes((m as { kind: MissionKind }).kind))
        .slice(0, 3)
        .map((m) => {
          const kind = m.kind as MissionKind;
          const goal = MISSIONS[kind].goal;
          const progress = typeof m.progress === 'number' && Number.isFinite(m.progress) ? Math.max(0, Math.min(goal, Math.floor(m.progress))) : 0;
          return { kind, goal, progress, reward: MISSIONS[kind].reward, claimed: m.claimed === true };
        })
    : [];
  return {
    day: str(d.day),
    chestClaimed: d.chestClaimed === true,
    streak: typeof d.streak === 'number' && Number.isFinite(d.streak) ? Math.max(0, Math.min(999, Math.floor(d.streak))) : 0,
    lastChest: str(d.lastChest),
    missions,
  };
}
