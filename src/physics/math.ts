export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const saturate = (v: number): number => clamp(v, 0, 1);

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = saturate((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/** Moves `current` toward `target` by at most `maxDelta`. */
export function moveTowards(current: number, target: number, maxDelta: number): number {
  const d = target - current;
  if (Math.abs(d) <= maxDelta) return target;
  return current + Math.sign(d) * maxDelta;
}

/** Frame-rate independent exponential smoothing factor for a given sharpness (1/s). */
export function dampFactor(sharpness: number, dt: number): number {
  return 1 - Math.exp(-sharpness * dt);
}

export const DEG2RAD = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;
export const MS_TO_KMH = 3.6;
export const RADS_TO_RPM = 60 / (2 * Math.PI);

/** Deterministic PRNG (mulberry32), used for scenery placement and tests. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
