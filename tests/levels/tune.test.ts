import { writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { LEVELS } from '../../src/levels';
import { measure } from '../../src/levels/checker';
import { AMMO } from '../../src/physics/sim';
import type { AmmoId } from '../../src/levels/types';

/** Dev tool: measures every hazard and proposes rival HP. LV=forest OUT=file.json */
it('tune', () => {
  const only = process.env.LV ? process.env.LV.split(',') : null;
  const out: Record<string, { hp: number; note: string }> = {};
  for (const lv of LEVELS) {
    if (only && !only.some((o) => lv.id.startsWith(o))) continue;
    const m = measure(lv);
    const all = m.map((x) => x.damage);
    const named = m.filter((x) => x.target !== 'grid' && !x.target.startsWith('rival'));
    const top1 = all[0] ?? 0;
    const top2 = named.find((x) => x.damage < top1 || named.indexOf(x) > 0)?.damage ?? 0;
    const top3 = named[2]?.damage ?? 0;
    let bound = 0;
    for (const [a, n] of Object.entries(lv.ammo) as Array<[AmmoId, number]>) bound += AMMO[a].direct * 1.5 * n;
    let hp: number;
    let note = '';
    if (lv.par === 1) {
      hp = Math.max(Math.round(bound) + 6, Math.min(100, Math.floor(top1 * 0.6)));
      if (top1 < hp * 1.3) note = 'weak hazard';
    } else if (lv.par === 2) {
      hp = Math.max(lv.boss ? 160 : 100, Math.round(bound) + 6, Math.ceil(top1 * 1.1 + 5));
      if (top1 + top2 < hp * 1.15) note = `two hazards too weak (${top1}+${top2})`;
    } else {
      hp = Math.max(lv.boss ? 160 : 100, Math.round(bound) + 6, Math.ceil((top1 + top2) * 1.05 + 5));
      if (top1 + top2 + top3 < hp * 1.1) note = `three hazards too weak (${top1}+${top2}+${top3})`;
    }
    out[lv.id] = { hp, note };
    console.info(lv.id.padEnd(12), `par ${lv.par} hp→${hp}`, note, '|', m.slice(0, 6).map((x) => `${x.target}:${Math.round(x.damage)}(${x.shot.ammo})`).join('  '));
  }
  if (process.env.OUT) writeFileSync(process.env.OUT, JSON.stringify(out, null, 1));
}, 3600000);
