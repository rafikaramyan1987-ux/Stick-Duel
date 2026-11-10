/** Small seeded PRNG (mulberry32) so every level layout is reproducible. */
export class Rng {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0 || 1;
  }
  /** Internal state (for cloning a simulation). */
  get state(): number {
    return this.s;
  }
  set state(v: number) {
    this.s = v >>> 0;
  }
  next(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a: number, b: number): number {
    return a + (b - a) * this.next();
  }
  int(a: number, b: number): number {
    return Math.floor(this.range(a, b + 1));
  }
  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)] as T;
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
  /** Approximately normal (sum of 3 uniforms), mean 0, sd ≈ 1. */
  gauss(): number {
    return (this.next() + this.next() + this.next() - 1.5) * 2;
  }
}

export function hashSeed(...parts: number[]): number {
  let h = 2166136261;
  for (const p of parts) {
    h ^= p + 0x9e3779b9;
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
