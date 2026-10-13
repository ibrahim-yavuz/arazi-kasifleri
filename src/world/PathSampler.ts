import { CatmullRomCurve3, Vector3 } from 'three';
import type { PathDef } from './TrackTypes';

/** One arc-length sample of a road centreline. */
export interface PathSample {
  s: number;
  x: number;
  y: number;
  z: number;
  /** Horizontal unit tangent. */
  tx: number;
  tz: number;
  /** Horizontal unit right vector (tangent rotated −90° about +Y). */
  rx: number;
  rz: number;
}

/** Arc-length sampled centreline (1 sample per `spacing` metres). */
export class SampledPath {
  readonly def: PathDef;
  readonly samples: PathSample[];
  readonly length: number;
  readonly spacing: number;

  constructor(def: PathDef, spacing = 1) {
    this.def = def;
    this.spacing = spacing;
    const curve = new CatmullRomCurve3(
      def.points.map((p) => new Vector3(p.x, p.y, p.z)),
      false,
      'centripetal',
    );
    // Arc length in XZ dominates; CatmullRomCurve3 arc-length includes y which is fine.
    curve.arcLengthDivisions = Math.max(200, def.points.length * 60);
    const length = curve.getLength();
    this.length = length;
    const n = Math.max(2, Math.ceil(length / spacing) + 1);
    this.samples = [];
    const p = new Vector3();
    const t = new Vector3();
    for (let i = 0; i < n; i++) {
      const u = i / (n - 1);
      curve.getPointAt(u, p);
      curve.getTangentAt(u, t);
      const hl = Math.hypot(t.x, t.z) || 1;
      const tx = t.x / hl;
      const tz = t.z / hl;
      this.samples.push({ s: u * length, x: p.x, y: p.y, z: p.z, tx, tz, rx: -tz, rz: tx });
    }
  }

  /** Interpolated sample at distance s (clamped). */
  at(s: number): PathSample {
    const f = Math.min(Math.max(s / this.length, 0), 1) * (this.samples.length - 1);
    const i = Math.min(Math.floor(f), this.samples.length - 2);
    const a = this.samples[i];
    const b = this.samples[i + 1];
    const k = f - i;
    const tx = a.tx + (b.tx - a.tx) * k;
    const tz = a.tz + (b.tz - a.tz) * k;
    const tl = Math.hypot(tx, tz) || 1;
    return {
      s,
      x: a.x + (b.x - a.x) * k,
      y: a.y + (b.y - a.y) * k,
      z: a.z + (b.z - a.z) * k,
      tx: tx / tl,
      tz: tz / tl,
      rx: -tz / tl,
      rz: tx / tl,
    };
  }

  /** Nearest sample index to a point (linear scan; use for occasional queries only). */
  nearest(x: number, z: number, hint = -1, window = 60): { index: number; dist: number } {
    let best = 0;
    let bestD = Infinity;
    const n = this.samples.length;
    const valid = hint >= 0 && hint < n;
    const lo = valid ? Math.max(0, hint - window) : 0;
    const hi = valid ? Math.min(n - 1, hint + window) : n - 1;
    for (let i = lo; i <= hi; i++) {
      const sm = this.samples[i];
      const d = (sm.x - x) ** 2 + (sm.z - z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return { index: best, dist: Math.sqrt(bestD) };
  }
}
