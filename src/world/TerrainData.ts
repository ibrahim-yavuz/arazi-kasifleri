import { Surface } from '../physics/Surfaces';

/**
 * Square height grid centred on the origin. Shared by the Rapier heightfield collider and
 * the rendered terrain mesh, so both use identical vertices AND the same cell
 * triangulation (Rapier splits each cell along the (x+,z−)–(x−,z+) diagonal; verified in
 * tests/terrain.test.ts).
 */
export class TerrainData {
  readonly size: number;
  readonly segments: number;
  readonly cell: number;
  readonly half: number;
  /** Heights, row-major: index = iz * (segments + 1) + ix. */
  readonly heights: Float32Array;
  /** Surface type per vertex. */
  readonly surface: Uint8Array;
  /** Signed distance to the nearest road edge per vertex (negative = on the road). */
  readonly roadEdge: Float32Array;
  /** Index of the nearest path per vertex (−1 = none / plaza). */
  readonly roadPath: Int16Array;

  constructor(size: number, segments: number) {
    this.size = size;
    this.segments = segments;
    this.cell = size / segments;
    this.half = size / 2;
    const n = (segments + 1) * (segments + 1);
    this.heights = new Float32Array(n);
    this.surface = new Uint8Array(n).fill(Surface.Grass);
    this.roadEdge = new Float32Array(n).fill(1e4);
    this.roadPath = new Int16Array(n).fill(-1);
  }

  get vertsPerSide(): number {
    return this.segments + 1;
  }

  index(ix: number, iz: number): number {
    return iz * (this.segments + 1) + ix;
  }

  vertexX(ix: number): number {
    return -this.half + ix * this.cell;
  }

  vertexZ(iz: number): number {
    return -this.half + iz * this.cell;
  }

  /** Height at a world position, using the same triangle interpolation as the collider. */
  heightAt(x: number, z: number): number {
    const n = this.segments;
    const gx = Math.min(Math.max((x + this.half) / this.cell, 0), n - 1e-6);
    const gz = Math.min(Math.max((z + this.half) / this.cell, 0), n - 1e-6);
    const ix = Math.floor(gx);
    const iz = Math.floor(gz);
    const u = gx - ix;
    const v = gz - iz;
    const h00 = this.heights[this.index(ix, iz)];
    const h10 = this.heights[this.index(ix + 1, iz)];
    const h01 = this.heights[this.index(ix, iz + 1)];
    const h11 = this.heights[this.index(ix + 1, iz + 1)];
    if (u + v <= 1) return h00 + u * (h10 - h00) + v * (h01 - h00);
    return h11 + (1 - u) * (h01 - h11) + (1 - v) * (h10 - h11);
  }

  /** Smooth normal (central differences), written into out = [x, y, z]. */
  normalAt(x: number, z: number, out: { x: number; y: number; z: number }): void {
    const e = this.cell;
    const hl = this.heightAt(x - e, z);
    const hr = this.heightAt(x + e, z);
    const hd = this.heightAt(x, z - e);
    const hu = this.heightAt(x, z + e);
    const nx = hl - hr;
    const nz = hd - hu;
    const ny = 2 * e;
    const len = Math.hypot(nx, ny, nz);
    out.x = nx / len;
    out.y = ny / len;
    out.z = nz / len;
  }

  private nearestIndex(x: number, z: number): number {
    const n = this.segments;
    const ix = Math.min(n, Math.max(0, Math.round((x + this.half) / this.cell)));
    const iz = Math.min(n, Math.max(0, Math.round((z + this.half) / this.cell)));
    return this.index(ix, iz);
  }

  surfaceAt(x: number, z: number): Surface {
    return this.surface[this.nearestIndex(x, z)] as Surface;
  }

  /** Bilinear road-edge distance (sub-cell precision for texturing and gameplay). */
  roadEdgeAt(x: number, z: number): number {
    const n = this.segments;
    const gx = Math.min(Math.max((x + this.half) / this.cell, 0), n - 1e-6);
    const gz = Math.min(Math.max((z + this.half) / this.cell, 0), n - 1e-6);
    const ix = Math.floor(gx);
    const iz = Math.floor(gz);
    const u = gx - ix;
    const v = gz - iz;
    const a = this.roadEdge[this.index(ix, iz)];
    const b = this.roadEdge[this.index(ix + 1, iz)];
    const c = this.roadEdge[this.index(ix, iz + 1)];
    const d = this.roadEdge[this.index(ix + 1, iz + 1)];
    return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
  }

  /** Heights in the column-major layout Rapier's heightfield expects (index = iz + ix·(n+1)). */
  toRapierHeights(): Float32Array {
    const n1 = this.segments + 1;
    const out = new Float32Array(n1 * n1);
    for (let ix = 0; ix < n1; ix++) {
      for (let iz = 0; iz < n1; iz++) {
        out[iz + ix * n1] = this.heights[iz * n1 + ix];
      }
    }
    return out;
  }

  contains(x: number, z: number, margin = 0): boolean {
    return Math.abs(x) <= this.half - margin && Math.abs(z) <= this.half - margin;
  }
}
