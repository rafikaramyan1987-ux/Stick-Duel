import type { AmmoId } from '../levels/types';
import type { PartName } from '../physics/ragdoll';
import type { EntDesc, Sim } from '../physics/sim';

/** A snapshot of everything visible: taken from the live simulation, or from a replay recording. */
export interface FrameEnt {
  id: number;
  desc: EntDesc;
  x: number;
  y: number;
  a: number;
  burning: boolean;
  fuse: boolean;
  charred: boolean;
}
export interface PartState {
  x: number;
  y: number;
  a: number;
}
export interface Frame {
  ents: FrameEnt[];
  parts: [Record<PartName, PartState>, Record<PartName, PartState>];
  ropes: Array<{ id: string; kind: 'rope' | 'chain'; ax: number; ay: number; bx: number; by: number; cut: boolean }>;
  arrows: Array<{ id: number; ammo: AmmoId; x: number; y: number; a: number }>;
  stuck: Array<{ id: number; ammo: AmmoId; x: number; y: number; a: number }>;
}

export function captureFrame(sim: Sim): Frame {
  const ents: FrameEnt[] = [];
  for (const e of sim.ents) {
    if (e.dead) continue;
    const p = e.body.getPosition();
    ents.push({ id: e.id, desc: e.desc, x: p.x, y: p.y, a: e.body.getAngle(), burning: e.burning >= 0, fuse: e.fuse >= 0, charred: e.charred });
  }
  const parts = sim.fighters.map((f) => {
    const r = {} as Record<PartName, PartState>;
    for (const p of f.rag.parts) {
      const q = p.body.getPosition();
      r[p.name] = { x: q.x, y: q.y, a: p.body.getAngle() };
    }
    return r;
  }) as Frame['parts'];
  const ropes = sim.ropes.map((r) => {
    const [a, b] = sim.ropeEnds(r);
    return { id: r.id, kind: r.def.kind ?? 'rope', ax: a.x, ay: a.y, bx: b.x, by: b.y, cut: !r.joint };
  });
  const arrows = sim.arrows.map((a) => {
    const p = a.body.getPosition();
    const v = a.body.getLinearVelocity();
    return { id: a.id, ammo: a.ammo, x: p.x, y: p.y, a: Math.atan2(v.y, v.x) };
  });
  const stuck: Frame['stuck'] = [];
  for (const s of sim.stuck) {
    let host: { getWorldPoint(v: { x: number; y: number }): { x: number; y: number }; getAngle(): number } | null = null;
    if (s.ent) host = s.ent.body;
    else if (s.part) host = sim.fighters[s.part.side].rag.byName[s.part.name].body;
    if (host) {
      const w = host.getWorldPoint(s.local);
      stuck.push({ id: s.id, ammo: s.ammo, x: w.x, y: w.y, a: s.angle + host.getAngle() });
    } else stuck.push({ id: s.id, ammo: s.ammo, x: s.local.x, y: s.local.y, a: s.angle });
  }
  return { ents, parts, ropes, arrows, stuck };
}

