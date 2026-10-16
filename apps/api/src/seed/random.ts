/**
 * Small deterministic random-number toolkit, so the same seed always produces the same demo data.
 */
export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Integer in [min, max], inclusive. */
  int(min: number, max: number): number;
  chance(probability: number): boolean;
  pick<T>(items: readonly T[]): T;
  /** Index chosen with probability proportional to its weight. */
  weightedIndex(weights: readonly number[]): number;
  /** Poisson-distributed count with the given mean. */
  poisson(mean: number): number;
  /** Random string of `length` characters from `alphabet`. */
  string(length: number, alphabet?: string): string;
}

/** mulberry32: tiny, fast, good-enough PRNG for simulation data. */
export function createRng(seed: number): Rng {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const rng: Rng = {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    chance: (p) => next() < p,
    pick: (items) => {
      if (items.length === 0) throw new RangeError('Cannot pick from an empty list');
      return items[Math.floor(next() * items.length)]!;
    },
    weightedIndex: (weights) => {
      const total = weights.reduce((a, b) => a + b, 0);
      if (!(total > 0)) return -1;
      let r = next() * total;
      for (let i = 0; i < weights.length; i++) {
        r -= weights[i]!;
        if (r < 0) return i;
      }
      return weights.length - 1;
    },
    poisson: (mean) => {
      // Knuth's algorithm; fine for the small means used here.
      const limit = Math.exp(-mean);
      let k = 0;
      let p = next();
      while (p > limit) {
        k++;
        p *= next();
      }
      return k;
    },
    string: (length, alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ') => {
      let out = '';
      for (let i = 0; i < length; i++) out += alphabet[Math.floor(next() * alphabet.length)];
      return out;
    },
  };
  return rng;
}
