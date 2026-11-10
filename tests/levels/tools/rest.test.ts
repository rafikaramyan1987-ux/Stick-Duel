import { it } from 'vitest';
import { appendFileSync } from 'node:fs';
import { LEVELS } from '../../../src/levels';
import { Sim } from '../../../src/physics/sim';
it('rest', () => {
  for (const lv of LEVELS) {
    const s = new Sim(lv, 1);
    s.warmUp();
    const before = s.fighters.map((f) => f.rag.torso.getPosition().x);
    for (let i = 0; i < 240; i++) s.step();
    const bad: string[] = [];
    s.fighters.forEach((f, i) => { if (f.hp !== f.maxHp || Math.abs(f.rag.torso.getPosition().x - before[i]!) > 0.3) bad.push(`f${i} hp${f.hp} dx${(f.rag.torso.getPosition().x - before[i]!).toFixed(2)}`); });
    if (!s.isSettled()) {
      const moving = s.liveEnts().filter((e) => !e.desc.fixed && !e.swinging && e.body.isAwake() && Math.hypot(e.body.getLinearVelocity().x, e.body.getLinearVelocity().y) > 0.25).map((e) => e.name);
      bad.push(`unsettled ${moving.join(',')} rag ${s.fighters.map((f) => f.rag.maxSpeed().toFixed(2)).join('/')}`);
    }
    if (bad.length) appendFileSync('/tmp/claude-0/-home-user-Stick-Duel/5414698e-610c-5c40-a176-8e45577eb474/scratchpad/rest.log', `${lv.id}: ${bad.join(' ; ')}\n`);
  }
});
