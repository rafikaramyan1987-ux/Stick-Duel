import { it } from 'vitest';
import { appendFileSync } from 'node:fs';
import { LEVELS } from '../../../src/levels';
import { Duel } from '../../../src/game/duel';
import { candidates, playShot } from '../../../src/levels/checker';

// dev tool: what happens when you shoot at a target (ID=level T=target substring)
const out = (s: string) => appendFileSync('/tmp/claude-0/-home-user-Stick-Duel/5414698e-610c-5c40-a176-8e45577eb474/scratchpad/aim.log', s + '\n');
it('aim', () => {
  const lv = LEVELS.find((l) => l.id === process.env.ID)!;
  const base = new Duel({ ...lv, rival: { ...lv.rival, hp: 9999 } }, 1, { headless: true });
  const cs = candidates(base);
  out(`${lv.id} targets: ${[...new Set(cs.map((c) => c.target))].join(', ')}`);
  for (const c of cs.filter((x) => x.target.includes(process.env.T ?? 'rope'))) {
    const d = base.clone();
    const ev: string[] = [];
    d.listeners.event = (e) => {
      if (e.t === 'ropeCut') ev.push(`cut:${e.id}`);
      else if (e.t === 'break') ev.push(`break:${e.mat}`);
      else if (e.t === 'damage') ev.push(`dmg${e.side}:${e.amount}${e.direct ? 'd' : ''}`);
      else if (e.t === 'explode' || e.t === 'ignite') ev.push(e.t);
      else if (e.t === 'stick') ev.push(`stick@${e.x.toFixed(1)},${e.y.toFixed(1)}`);
    };
    playShot(d, c, true);
    out(`  ${c.ammo} ${c.target} a${c.angle.toFixed(2)} p${c.power.toFixed(2)}: ${ev.join(' ')}`);
  }
});
