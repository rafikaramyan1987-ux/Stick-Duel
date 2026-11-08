import { describe, expect, it } from 'vitest';
import { Rng } from '../../src/core/rng';
import { addProgress, chestReady, claimChest, claimMission, dailyHasReady, dayKey, missionsFor, refreshDaily, sanitizeDaily } from '../../src/game/daily';
import { newSave, sanitize } from '../../src/game/progress';

describe('daily chest and missions', () => {
  it('3 different missions per day, the same for everyone on that day', () => {
    for (const day of ['2026-11-06', '2026-11-07', '2027-01-01']) {
      const m = missionsFor(day);
      expect(m).toHaveLength(3);
      expect(new Set(m.map((x) => x.kind)).size).toBe(3);
      expect(['wins', 'headshots']).toContain(m[0]!.kind);
      expect(missionsFor(day)).toEqual(m);
    }
  });

  it('chest once per day, streak grows on consecutive days', () => {
    const s = newSave();
    refreshDaily(s, new Date(2026, 10, 6));
    expect(chestReady(s)).toBe(true);
    expect(dailyHasReady(s)).toBe(true);
    const a = claimChest(s, new Rng(1))!;
    expect(a.coins).toBeGreaterThanOrEqual(30);
    expect(s.coins).toBe(a.coins);
    expect(claimChest(s, new Rng(1))).toBeNull();
    expect(refreshDaily(s, new Date(2026, 10, 6))).toBe(false);
    refreshDaily(s, new Date(2026, 10, 7));
    claimChest(s, new Rng(2));
    expect(s.daily.streak).toBe(2);
    refreshDaily(s, new Date(2026, 10, 10));
    claimChest(s, new Rng(3));
    expect(s.daily.streak).toBe(1);
  });

  it('missions progress, complete and pay once', () => {
    const s = newSave();
    refreshDaily(s, new Date(2026, 10, 6));
    s.daily.chestClaimed = true;
    const m = s.daily.missions[0]!;
    expect(dailyHasReady(s)).toBe(false);
    addProgress(s, m.kind, m.goal - 1);
    expect(claimMission(s, 0)).toBe(0);
    const done = addProgress(s, m.kind, 5);
    expect(done).toHaveLength(1);
    expect(m.progress).toBe(m.goal);
    expect(dailyHasReady(s)).toBe(true);
    expect(claimMission(s, 0)).toBe(m.reward);
    expect(claimMission(s, 0)).toBe(0);
    expect(s.coins).toBe(m.reward);
  });

  it('no ring-out mission while the player only has the bow', () => {
    for (let d = 1; d <= 28; d++) {
      const s = newSave();
      refreshDaily(s, new Date(2026, 1, d));
      expect(s.daily.missions.map((m) => m.kind)).not.toContain('ringout');
    }
  });

  it('the date key is local and zero-padded', () => {
    expect(dayKey(new Date(2026, 0, 5))).toBe('2026-01-05');
  });

  it('sanitizes daily data in saves', () => {
    expect(sanitizeDaily({ day: 'x', missions: [{ kind: 'hack', progress: 9 }, { kind: 'wins', progress: 99, claimed: true }] })).toEqual({
      day: '',
      chestClaimed: false,
      streak: 0,
      lastChest: '',
      missions: [{ kind: 'wins', goal: 3, progress: 3, reward: 40, claimed: true }],
    });
    const s = sanitize({ version: 1, daily: { day: '2026-11-06', chestClaimed: true, streak: 4 } });
    expect(s.daily.streak).toBe(4);
  });
});
