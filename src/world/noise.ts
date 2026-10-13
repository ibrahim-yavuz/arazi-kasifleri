/** Small deterministic 2D gradient noise + fBm (no dependencies, works in Node). */

function hash2(ix: number, iz: number, seed: number): number {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iz, 668265263) ^ Math.imul(seed, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return h >>> 0;
}

const GRADS: Array<[number, number]> = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [0.7071, 0.7071], [-0.7071, 0.7071], [0.7071, -0.7071], [-0.7071, -0.7071],
];

function grad(ix: number, iz: number, seed: number, dx: number, dz: number): number {
  const g = GRADS[hash2(ix, iz, seed) & 7];
  return g[0] * dx + g[1] * dz;
}

const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);

/** Perlin-style gradient noise in roughly [-1, 1]. */
export function noise2(x: number, z: number, seed = 1): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const u = fade(fx);
  const v = fade(fz);
  const a = grad(ix, iz, seed, fx, fz);
  const b = grad(ix + 1, iz, seed, fx - 1, fz);
  const c = grad(ix, iz + 1, seed, fx, fz - 1);
  const d = grad(ix + 1, iz + 1, seed, fx - 1, fz - 1);
  const ab = a + (b - a) * u;
  const cd = c + (d - c) * u;
  return (ab + (cd - ab) * v) * 1.41;
}

export function fbm(x: number, z: number, octaves: number, seed = 1, lacunarity = 2, gain = 0.5): number {
  let sum = 0;
  let amp = 1;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise2(x * freq, z * freq, seed + i * 17);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}
