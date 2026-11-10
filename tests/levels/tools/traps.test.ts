import { it } from 'vitest';
import { appendFileSync } from 'node:fs';
import { WORLD_LEVELS } from '../../../src/levels';
import { Duel } from '../../../src/game/duel';
import { candidates, evaluate, Stats } from '../../../src/levels/checker';
import type { WorldId } from '../../../src/levels/types';

// dev tool: strongest single-shot trap damage per level (rival HP out of reach, no rival turn)
const W = (process.env.W ?? 'forest') as WorldId;
for (const lv of WORLD_LEVELS[W]) {
  it(lv.id, () => {
    const l = { ...lv, rival: { ...lv.rival, hp: 9999 }, player: { ...lv.player, hp: 9999 } };
    const d = new Duel(l, 1, { headless: true });
    d.sim.trapCap = 1e9;
    const st = new Stats();
    for (const c of candidates(d)) evaluate(d, c, st);
    appendFileSync('/tmp/claude-0/-home-user-Stick-Duel/5414698e-610c-5c40-a176-8e45577eb474/scratchpad/traps.log', `${lv.id} best ${Math.round(st.bestTrap.damage)} ${st.bestTrap.target} maxAny ${Math.round(st.maxTrap)}\n`);
  });
}
