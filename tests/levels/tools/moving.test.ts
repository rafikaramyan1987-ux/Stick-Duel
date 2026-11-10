import { it } from 'vitest';
import { appendFileSync } from 'node:fs';
import { LEVELS } from '../../../src/levels';
import { Sim } from '../../../src/physics/sim';
// dev tool: what keeps an arena from coming to rest (ID=level)
it('moving', () => {
  const lv = LEVELS.find((l) => l.id === process.env.ID)!;
  const s = new Sim(lv, 1);
  s.warmUp();
  for (let i = 0; i < 300; i++) s.step();
  const o = s.liveEnts().filter((e) => e.body.isAwake() && !e.desc.fixed).map((e) => `${e.name ?? e.desc.look}@${e.body.getPosition().x.toFixed(1)},${e.body.getPosition().y.toFixed(1)} v${Math.hypot(e.body.getLinearVelocity().x, e.body.getLinearVelocity().y).toFixed(2)} w${e.body.getAngularVelocity().toFixed(2)} b${e.burning} f${e.fuse}`);
  appendFileSync('/tmp/claude-0/-home-user-Stick-Duel/5414698e-610c-5c40-a176-8e45577eb474/scratchpad/moving.log', `${lv.id}: ${o.join(' | ')}\n`);
});
