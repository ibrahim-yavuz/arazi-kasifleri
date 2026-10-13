import { Surface } from '../physics/Surfaces';
import { mulberry32, smoothstep } from '../physics/math';
import { fbm, noise2 } from './noise';
import { SampledPath } from './PathSampler';
import type { PathSample } from './PathSampler';
import { TerrainData } from './TerrainData';
import type {
  CheckpointPlacement,
  CollectibleKind,
  NaturalTerrainParams,
  PathDef,
  ChoiceRoute,
  RiverDef,
  RouteId,
  TrackDef,
} from './TrackTypes';
import { CHOICE_ROUTES } from './TrackTypes';

/** A directional gate (checkpoint, start or finish line). */
export interface Gate {
  id: string;
  route: RouteId;
  /** Path the gate is on. */
  path: string;
  index: number;
  x: number;
  y: number;
  z: number;
  /** Horizontal unit direction the player must cross in. */
  tx: number;
  tz: number;
  halfWidth: number;
}

export interface BuiltCollectible {
  id: string;
  kind: CollectibleKind;
  route: RouteId;
  x: number;
  y: number;
  z: number;
}

export interface RampGeometry {
  id: string;
  positions: Float32Array;
  indices: Uint32Array;
  /** Lip position (for gameplay/AI). */
  lip: { x: number; y: number; z: number };
}

export interface FenceSegment {
  ax: number; ay: number; az: number;
  bx: number; by: number; bz: number;
}

export interface SceneryInstance {
  x: number;
  y: number;
  z: number;
  scale: number;
  rot: number;
  /** Gets a static collider (near the track). */
  solid: boolean;
}

export interface BuiltScenery {
  pines: SceneryInstance[];
  leafy: SceneryInstance[];
  rocks: SceneryInstance[];
  grass: SceneryInstance[];
  /** Small stones lying on rough roads (render only). */
  pebbles: SceneryInstance[];
}

/** A bridge carrying a road across a river (auto-detected where a road crosses water). */
export interface BridgeGeometry {
  id: string;
  path: string;
  from: number;
  to: number;
  /** Deck as flat-shaded quads (render mesh and triangle-mesh collider). */
  positions: Float32Array;
  indices: Uint32Array;
  /** Railing segments on both sides (solid). */
  railings: FenceSegment[];
  /** Support pillars (render only). */
  pillars: Array<{ x: number; z: number; bottom: number; top: number }>;
}

export interface BuiltTrack {
  def: TrackDef;
  terrain: TerrainData;
  paths: Map<string, SampledPath>;
  pathList: SampledPath[];
  ramps: RampGeometry[];
  startGate: Gate;
  finishGate: Gate;
  /** Per fork: the gates of each road and the merge gate. */
  legs: Array<{ paths: Record<ChoiceRoute, string>; routes: Record<ChoiceRoute, Gate[]>; merge: Gate }>;
  connectors: string[];
  collectibles: BuiltCollectible[];
  fences: FenceSegment[];
  scenery: BuiltScenery;
  bridges: BridgeGeometry[];
  /** Bridge spans per path id (distances along the path). */
  bridgeSpans: Map<string, Array<{ from: number; to: number }>>;
}

// ------------------------------------------------------------------------------------
// Road profile
// ------------------------------------------------------------------------------------

/** Road surface height at a centreline sample with a lateral offset (m, + = right). */
export function roadHeightAt(path: PathDef, sm: PathSample, lateral: number): number {
  let h = sm.y;
  const s = sm.s;
  if (!path.features) return h;
  for (const f of path.features) {
    switch (f.type) {
      case 'moguls': {
        if (s < f.from || s > f.to) break;
        const env = smoothstep(f.from, f.from + f.wavelength, s) * (1 - smoothstep(f.to - f.wavelength, f.to, s));
        // Diagonal phase so left and right wheels hit bumps at different times.
        const ph = ((s - f.from + lateral * 0.6) / f.wavelength) * Math.PI * 2;
        h += f.amplitude * 0.5 * (1 - Math.cos(ph)) * env;
        break;
      }
      case 'sideSlope': {
        if (s < f.from || s > f.to) break;
        const env = smoothstep(f.from, f.from + 12, s) * (1 - smoothstep(f.to - 12, f.to, s));
        h -= Math.tan((f.angleDeg * Math.PI) / 180) * lateral * env;
        break;
      }
      case 'rough': {
        if (s < f.from || s > f.to) break;
        const env = smoothstep(f.from, f.from + 6, s) * (1 - smoothstep(f.to - 6, f.to, s));
        const px = sm.x + sm.rx * lateral;
        const pz = sm.z + sm.rz * lateral;
        h += f.amplitude * fbm(px * f.scale, pz * f.scale, 2, 77) * env;
        break;
      }
      case 'bump': {
        const d = Math.abs(s - f.at);
        if (d < f.length / 2) h += f.height * 0.5 * (1 + Math.cos((Math.PI * d) / (f.length / 2)));
        break;
      }
      default:
        break;
    }
  }
  return h;
}

function surfaceOverride(path: PathDef, s: number): Surface {
  if (path.features) {
    for (const f of path.features) {
      if (f.type === 'surface' && s >= f.from && s <= f.to) return f.surface;
    }
  }
  return path.surface;
}

function canyonAt(path: PathDef, s: number): { wallHeight: number; wallWidth: number } | null {
  if (!path.features) return null;
  for (const f of path.features) {
    if (f.type === 'canyon' && s >= f.from && s <= f.to) {
      const env = smoothstep(f.from, f.from + 15, s) * (1 - smoothstep(f.to - 15, f.to, s));
      return { wallHeight: f.wallHeight * env, wallWidth: f.wallWidth };
    }
  }
  return null;
}

/** Banks of a river rise from the water channel to natural ground over this width (m). */
const RIVER_BANK = 16;

/** Distance from (x,z) to the nearest river centreline, and that river. */
export function riverDistance(p: NaturalTerrainParams, x: number, z: number): { d: number; river: RiverDef | null } {
  let best = Infinity;
  let river: RiverDef | null = null;
  for (const r of p.rivers ?? []) {
    for (let i = 1; i < r.points.length; i++) {
      const a = r.points[i - 1];
      const b = r.points[i];
      const vx = b.x - a.x;
      const vz = b.z - a.z;
      const t = Math.max(0, Math.min(1, ((x - a.x) * vx + (z - a.z) * vz) / (vx * vx + vz * vz)));
      const d = Math.hypot(x - (a.x + vx * t), z - (a.z + vz * t));
      if (d < best) {
        best = d;
        river = r;
      }
    }
  }
  return { d: best, river };
}

export function naturalHeight(p: NaturalTerrainParams, x: number, z: number): number {
  if (p.flat) return p.baseHeight;
  let h = p.baseHeight + p.hillAmplitude * fbm(x / p.hillScale, z / p.hillScale, 4, p.seed);
  h += p.detailAmplitude * noise2(x / 9, z / 9, p.seed + 5);
  const edge = Math.max(Math.abs(x), Math.abs(z)) - p.mountainStart;
  if (edge > 0) {
    h += p.mountainHeight * smoothstep(0, 70, edge) * (0.65 + 0.35 * fbm(x / 60, z / 60, 3, p.seed + 9));
  }
  if (p.rivers) {
    const { d, river } = riverDistance(p, x, z);
    if (river) {
      const t = 1 - smoothstep(river.width / 2, river.width / 2 + RIVER_BANK, d);
      h += (river.bedHeight - h) * t;
    }
  }
  return h;
}

/** 0 outside a bridge, 1 on its main span (terrain under it keeps the river shape). */
function bridgeSpanFactor(spans: Array<{ from: number; to: number }> | undefined, s: number): number {
  if (!spans) return 0;
  for (const b of spans) {
    if (s > b.from && s < b.to) return smoothstep(b.from, b.from + 8, s) * (1 - smoothstep(b.to - 8, b.to, s));
  }
  return 0;
}

function nearBridge(spans: Array<{ from: number; to: number }> | undefined, s: number): boolean {
  return !!spans?.some((b) => s > b.from - 4 && s < b.to + 4);
}

/** Finds where each path crosses a river: those ranges become bridges. */
function detectBridges(nat: NaturalTerrainParams, pathList: SampledPath[]): Map<string, Array<{ from: number; to: number }>> {
  const out = new Map<string, Array<{ from: number; to: number }>>();
  if (!nat.rivers?.length) return out;
  for (const sp of pathList) {
    const spans: Array<{ from: number; to: number }> = [];
    let start = -1;
    for (let i = 0; i < sp.samples.length; i++) {
      const sm = sp.samples[i];
      const { d, river } = riverDistance(nat, sm.x, sm.z);
      const wet = !!river && d < river.width / 2 + RIVER_BANK * 0.75 && sm.y > river.waterHeight + 2;
      if (wet && start < 0) start = sm.s;
      if ((!wet || i === sp.samples.length - 1) && start >= 0) {
        spans.push({ from: Math.max(0, start - 6), to: Math.min(sp.length, sm.s + 6) });
        start = -1;
      }
    }
    if (spans.length) out.set(sp.def.id, spans);
  }
  return out;
}

// ------------------------------------------------------------------------------------
// Builder
// ------------------------------------------------------------------------------------

export function buildTrack(def: TrackDef): BuiltTrack {
  const terrain = new TerrainData(def.worldSize, def.segments);
  const n1 = terrain.vertsPerSide;
  const count = n1 * n1;
  const nat = def.natural;

  const pathList = def.paths.map((p) => new SampledPath(p, 1));
  const paths = new Map(pathList.map((p) => [p.def.id, p]));

  // Nearest centreline sample per vertex (rasterised).
  const bestD2 = new Float32Array(count).fill(Infinity);
  const bestPath = new Int16Array(count).fill(-1);
  const bestSample = new Int32Array(count).fill(-1);
  const bestLat = new Float32Array(count);
  pathList.forEach((sp, pi) => {
    const hw = sp.def.width / 2;
    const reach = hw + sp.def.shoulder + 14;
    const rCells = Math.ceil(reach / terrain.cell);
    for (let si = 0; si < sp.samples.length; si++) {
      const sm = sp.samples[si];
      const cx = Math.round((sm.x + terrain.half) / terrain.cell);
      const cz = Math.round((sm.z + terrain.half) / terrain.cell);
      for (let iz = Math.max(0, cz - rCells); iz <= Math.min(def.segments, cz + rCells); iz++) {
        const vz = terrain.vertexZ(iz);
        for (let ix = Math.max(0, cx - rCells); ix <= Math.min(def.segments, cx + rCells); ix++) {
          const vx = terrain.vertexX(ix);
          const dx = vx - sm.x;
          const dz = vz - sm.z;
          const d2 = dx * dx + dz * dz;
          const idx = iz * n1 + ix;
          if (d2 < bestD2[idx]) {
            bestD2[idx] = d2;
            bestPath[idx] = pi;
            bestSample[idx] = si;
            bestLat[idx] = dx * sm.rx + dz * sm.rz;
          }
        }
      }
    }
  });

  const bridgeSpans = detectBridges(nat, pathList);
  const isCanyonWall = new Uint8Array(count);
  for (let iz = 0; iz <= def.segments; iz++) {
    const z = terrain.vertexZ(iz);
    for (let ix = 0; ix <= def.segments; ix++) {
      const x = terrain.vertexX(ix);
      const idx = iz * n1 + ix;
      const hNat = naturalHeight(nat, x, z);
      let weight = 0;
      let target = hNat;
      let edge = 1e4;
      let surf: Surface | null = null;
      let pathIdx = -1;

      if (bestPath[idx] >= 0) {
        const sp = pathList[bestPath[idx]];
        const pd = sp.def;
        const sm = sp.samples[bestSample[idx]];
        const hw = pd.width / 2;
        const lat = bestLat[idx];
        const e = Math.sqrt(bestD2[idx]) - hw;
        const latClamped = Math.max(-hw, Math.min(hw, lat));
        const rh = roadHeightAt(pd, sm, latClamped);
        // Under a bridge the ground keeps its river shape; the deck carries the road.
        const span = bridgeSpanFactor(bridgeSpans.get(pd.id), sm.s);
        const w = (1 - smoothstep(0, pd.shoulder, e)) * (1 - span);
        if (w > weight) {
          weight = w;
          target = rh;
        }
        edge = span > 0.5 ? 1e4 : e;
        pathIdx = bestPath[idx];
        if (span > 0.5) surf = null;
        else if (e < 0) surf = surfaceOverride(pd, sm.s);
        else if (e < 2.5) surf = surfaceOverride(pd, sm.s) === Surface.Sand ? Surface.Sand : Surface.Dirt;
        const canyon = canyonAt(pd, sm.s);
        if (canyon && e > 0.5) {
          const wall = rh + canyon.wallHeight * smoothstep(0.5, 0.5 + canyon.wallWidth * 0.45, e);
          const blended = target * weight + hNat * (1 - weight);
          if (wall > blended && e < canyon.wallWidth + 8) {
            const fade = 1 - smoothstep(canyon.wallWidth, canyon.wallWidth + 8, e);
            target = blended + (wall - blended) * fade;
            weight = 1;
            isCanyonWall[idx] = 1;
          }
        }
      }

      for (const pz of def.plazas) {
        const d = Math.hypot(x - pz.x, z - pz.z) - pz.radius;
        if (d > pz.shoulder) continue;
        const w = 1 - smoothstep(0, pz.shoulder, d);
        if (w > weight || (w === weight && d < edge)) {
          weight = w;
          target = pz.y;
        }
        if (d < edge) {
          edge = d;
          pathIdx = -1;
          surf = d < 0 ? pz.surface : d < 2.5 ? Surface.Dirt : surf;
        }
      }

      terrain.heights[idx] = hNat + (target - hNat) * weight;
      terrain.roadEdge[idx] = edge;
      terrain.roadPath[idx] = pathIdx;
      const rv = nat.rivers ? riverDistance(nat, x, z) : null;
      if (rv?.river && rv.d < rv.river.width / 2 + 4 && weight < 0.5) {
        // Riverbed and wet banks.
        terrain.surface[idx] = rv.d < rv.river.width / 2 ? Surface.Mud : Surface.Sand;
      } else if (surf !== null) {
        terrain.surface[idx] = surf;
      } else {
        const sandN = fbm(x / 70, z / 70, 2, nat.seed + 31);
        terrain.surface[idx] = sandN > nat.sandThreshold ? Surface.Sand : Surface.Grass;
      }
    }
  }

  // Steep slopes and canyon walls are rock.
  const nrm = { x: 0, y: 1, z: 0 };
  for (let iz = 0; iz <= def.segments; iz++) {
    for (let ix = 0; ix <= def.segments; ix++) {
      const idx = iz * n1 + ix;
      if (terrain.roadEdge[idx] < 0) continue;
      terrain.normalAt(terrain.vertexX(ix), terrain.vertexZ(iz), nrm);
      if (nrm.y < 0.72 || (isCanyonWall[idx] && nrm.y < 0.9)) terrain.surface[idx] = Surface.Rock;
    }
  }

  /** Driving-surface height on a path: the bridge deck on bridges, else the terrain. */
  const surfaceY = (sp: SampledPath, s: number, x: number, z: number): number =>
    bridgeSpanFactor(bridgeSpans.get(sp.def.id), s) > 0.01 ? Math.max(sp.at(s).y + DECK_OFFSET, terrain.heightAt(x, z)) : terrain.heightAt(x, z);

  const gate = (cp: CheckpointPlacement, route: RouteId, index: number, id: string): Gate => {
    const sp = paths.get(cp.path);
    if (!sp) throw new Error(`Unknown path ${cp.path}`);
    const sm = sp.at(cp.at);
    return {
      id,
      route,
      path: cp.path,
      index,
      x: sm.x,
      y: surfaceY(sp, cp.at, sm.x, sm.z),
      z: sm.z,
      tx: sm.tx,
      tz: sm.tz,
      halfWidth: sp.def.width / 2 + (cp.margin ?? 8),
    };
  };

  const legs = def.legs.map((leg, li) => {
    const routes = {} as Record<ChoiceRoute, Gate[]>;
    for (const r of CHOICE_ROUTES) routes[r] = leg.checkpoints[r].map((cp, i) => gate(cp, r, i, `${r}${li + 1}-${i}`));
    return { paths: leg.paths, routes, merge: gate(leg.merge, 'mid', 0, `merge${li + 1}`) };
  });

  const collectibles: BuiltCollectible[] = def.collectibles.map((c, i) => {
    const sp = paths.get(c.path)!;
    const sm = sp.at(c.at);
    const off = c.offset ?? 0;
    const x = sm.x + sm.rx * off;
    const z = sm.z + sm.rz * off;
    return { id: `${c.kind}-${i}`, kind: c.kind, route: sp.def.route, x, y: surfaceY(sp, c.at, x, z) + (c.height ?? 1.3), z };
  });

  const ramps = def.ramps.map((r, i) => buildRamp(terrain, paths.get(r.path)!, r.at, r.length, r.width, r.height, r.offset ?? 0, `ramp-${i}`, r.profile ?? 1));
  const fences = buildFences(terrain, pathList, nat);
  const scenery = placeScenery(def, terrain, pathList, bridgeSpans);
  const bridges: BridgeGeometry[] = [];
  for (const [pid, spans] of bridgeSpans) {
    const sp = paths.get(pid)!;
    spans.forEach((b, i) => bridges.push(buildBridge(sp, b.from, b.to, nat, `bridge-${pid}-${i}`)));
  }

  return {
    def,
    terrain,
    paths,
    pathList,
    ramps,
    startGate: gate(def.startLine, 'start', 0, 'start'),
    finishGate: gate(def.finishLine, 'final', 99, 'finish'),
    legs,
    connectors: def.connectors,
    collectibles,
    fences,
    scenery,
    bridges,
    bridgeSpans,
  };
}

/** Deck top sits this far above the path centreline height. */
const DECK_OFFSET = 0.05;

/** Bridge deck (top, sides, bottom), railings and pillars along a path range. */
export function buildBridge(sp: SampledPath, from: number, to: number, nat: NaturalTerrainParams, id: string): BridgeGeometry {
  const hw = sp.def.width / 2 + 0.4;
  const thick = 0.8;
  const step = 2;
  const pos: number[] = [];
  const idx: number[] = [];
  const quad = (a: number[], b: number[], c: number[], d: number[], outward: [number, number, number]) => {
    const base = pos.length / 3;
    pos.push(...a, ...b, ...c, ...d);
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const nx = e1[1] * e2[2] - e1[2] * e2[1];
    const ny = e1[2] * e2[0] - e1[0] * e2[2];
    const nz = e1[0] * e2[1] - e1[1] * e2[0];
    if (nx * outward[0] + ny * outward[1] + nz * outward[2] >= 0) idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    else idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
  };
  const edge = (s: number, side: number, dy: number): number[] => {
    const sm = sp.at(s);
    return [sm.x + sm.rx * hw * side, sm.y + DECK_OFFSET + dy, sm.z + sm.rz * hw * side];
  };
  const railings: FenceSegment[] = [];
  const pillars: BridgeGeometry['pillars'] = [];
  const n = Math.max(1, Math.ceil((to - from) / step));
  for (let i = 0; i < n; i++) {
    const s0 = from + ((to - from) * i) / n;
    const s1 = from + ((to - from) * (i + 1)) / n;
    const sm = sp.at(s0);
    const right: [number, number, number] = [sm.rx, 0, sm.rz];
    const left: [number, number, number] = [-sm.rx, 0, -sm.rz];
    quad(edge(s0, -1, 0), edge(s1, -1, 0), edge(s1, 1, 0), edge(s0, 1, 0), [0, 1, 0]);
    quad(edge(s0, -1, -thick), edge(s1, -1, -thick), edge(s1, 1, -thick), edge(s0, 1, -thick), [0, -1, 0]);
    quad(edge(s0, 1, 0), edge(s1, 1, 0), edge(s1, 1, -thick), edge(s0, 1, -thick), right);
    quad(edge(s0, -1, 0), edge(s1, -1, 0), edge(s1, -1, -thick), edge(s0, -1, -thick), left);
  }
  // Railings every ~3 m on both sides, starting right at the bridge ends so no railing
  // end sticks out into the approach.
  const railFrom = from + 1.5;
  const railTo = to - 1.5;
  const rn = Math.max(1, Math.ceil((railTo - railFrom) / 3));
  for (const side of [-1, 1]) {
    for (let i = 0; i < rn; i++) {
      const a = edge(railFrom + ((railTo - railFrom) * i) / rn, side, 0);
      const b = edge(railFrom + ((railTo - railFrom) * (i + 1)) / rn, side, 0);
      railings.push({ ax: a[0] - sp.at(railFrom).rx * 0.15 * side, ay: a[1], az: a[2], bx: b[0], by: b[1], bz: b[2] });
    }
  }
  // Pillars every ~14 m down to the riverbed.
  for (let s = from + 7; s < to - 4; s += 14) {
    const sm = sp.at(s);
    const { river } = riverDistance(nat, sm.x, sm.z);
    const bottom = (river?.bedHeight ?? sm.y - 10) - 1;
    for (const side of [-1, 1]) {
      const off = (hw - 1.2) * side;
      pillars.push({ x: sm.x + sm.rx * off, z: sm.z + sm.rz * off, bottom, top: sm.y + DECK_OFFSET - thick });
    }
  }
  return { id, path: sp.def.id, from, to, positions: new Float32Array(pos), indices: new Uint32Array(idx), railings, pillars };
}

/** Builds a kicker ramp as flat-shaded quads (shared by render mesh and trimesh collider). */
export function buildRamp(
  terrain: TerrainData,
  path: SampledPath,
  at: number,
  length: number,
  width: number,
  height: number,
  offset: number,
  id: string,
  profileExp = 1,
): RampGeometry {
  const sm = path.at(at);
  const cx = sm.x + sm.rx * offset;
  const cz = sm.z + sm.rz * offset;
  const segs = 8;
  const pos: number[] = [];
  const idx: number[] = [];
  const profile = (u: number) => Math.pow(u, profileExp);
  const pt = (u: number, v: number, top: boolean): [number, number, number] => {
    const x = cx + sm.tx * (u - 0.5) * length + sm.rx * v * width * 0.5;
    const z = cz + sm.tz * (u - 0.5) * length + sm.rz * v * width * 0.5;
    const g = terrain.heightAt(x, z);
    return [x, top ? g + height * profile(u) + 0.02 : g - 0.6, z];
  };
  const quad = (a: number[], b: number[], c: number[], d: number[], outward: [number, number, number]) => {
    const base = pos.length / 3;
    pos.push(...a, ...b, ...c, ...d);
    // Orient triangles so the face normal points along `outward`.
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const nx = e1[1] * e2[2] - e1[2] * e2[1];
    const ny = e1[2] * e2[0] - e1[0] * e2[2];
    const nz = e1[0] * e2[1] - e1[1] * e2[0];
    if (nx * outward[0] + ny * outward[1] + nz * outward[2] >= 0) idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    else idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
  };
  const up: [number, number, number] = [0, 1, 0];
  const right: [number, number, number] = [sm.rx, 0, sm.rz];
  const left: [number, number, number] = [-sm.rx, 0, -sm.rz];
  const back: [number, number, number] = [sm.tx, 0, sm.tz];
  for (let i = 0; i < segs; i++) {
    const u0 = i / segs;
    const u1 = (i + 1) / segs;
    quad(pt(u0, -1, true), pt(u1, -1, true), pt(u1, 1, true), pt(u0, 1, true), up);
    quad(pt(u0, 1, true), pt(u1, 1, true), pt(u1, 1, false), pt(u0, 1, false), right);
    quad(pt(u0, -1, true), pt(u1, -1, true), pt(u1, -1, false), pt(u0, -1, false), left);
  }
  quad(pt(1, -1, true), pt(1, 1, true), pt(1, 1, false), pt(1, -1, false), back);
  const lip = pt(1, 0, true);
  return { id, positions: new Float32Array(pos), indices: new Uint32Array(idx), lip: { x: lip[0], y: lip[1], z: lip[2] } };
}

function buildFences(terrain: TerrainData, pathList: SampledPath[], nat: NaturalTerrainParams): FenceSegment[] {
  const out: FenceSegment[] = [];
  for (const sp of pathList) {
    const d = sp.def;
    if (d.fenceOffset === undefined || !d.fenceRanges) continue;
    const off = d.width / 2 + d.fenceOffset;
    const step = 6;
    for (const [from, to] of d.fenceRanges) {
      for (const side of [-1, 1]) {
        let prev: { x: number; z: number } | null = null;
        for (let s = from; s <= Math.min(to, sp.length); s += step) {
          const sm = sp.at(s);
          const x = sm.x + sm.rx * off * side;
          const z = sm.z + sm.rz * off * side;
          // Skip posts that would end up on another road or in a river.
          const rv = nat.rivers ? riverDistance(nat, x, z) : null;
          if (terrain.roadEdgeAt(x, z) < 1.5 || (rv?.river && rv.d < rv.river.width / 2 + RIVER_BANK)) {
            prev = null;
            continue;
          }
          if (prev) {
            out.push({
              ax: prev.x, ay: terrain.heightAt(prev.x, prev.z), az: prev.z,
              bx: x, by: terrain.heightAt(x, z), bz: z,
            });
          }
          prev = { x, z };
        }
      }
    }
  }
  return out;
}

function placeScenery(def: TrackDef, terrain: TerrainData, pathList: SampledPath[], bridgeSpans: Map<string, Array<{ from: number; to: number }>>): BuiltScenery {
  const p = def.scenery;
  const rnd = mulberry32(p.seed);
  const half = terrain.half - 4;
  const nrm = { x: 0, y: 1, z: 0 };
  const sample = (minEdge: number, maxSlope: number, accept: (x: number, z: number) => boolean) => {
    for (let tries = 0; tries < 40; tries++) {
      const x = (rnd() * 2 - 1) * half;
      const z = (rnd() * 2 - 1) * half;
      const e = terrain.roadEdgeAt(x, z);
      if (e < minEdge) continue;
      const rv = def.natural.rivers ? riverDistance(def.natural, x, z) : null;
      if (rv?.river && rv.d < rv.river.width / 2 + 3) continue;
      terrain.normalAt(x, z, nrm);
      if (nrm.y < maxSlope) continue;
      if (!accept(x, z)) continue;
      return { x, z, e };
    }
    return null;
  };
  const forest = (x: number, z: number) => fbm(x / 90, z / 90, 2, p.seed + 3);
  const pines: SceneryInstance[] = [];
  const leafy: SceneryInstance[] = [];
  const rocks: SceneryInstance[] = [];
  const grass: SceneryInstance[] = [];
  for (let i = 0; i < p.pineCount; i++) {
    const s = sample(6, 0.8, (x, z) => forest(x, z) > -0.15 || rnd() < 0.25);
    if (!s) continue;
    pines.push({ x: s.x, y: terrain.heightAt(s.x, s.z), z: s.z, scale: 0.8 + rnd() * 0.7, rot: rnd() * Math.PI * 2, solid: s.e < p.colliderRange });
  }
  for (let i = 0; i < p.leafyCount; i++) {
    const s = sample(6, 0.85, (x, z) => forest(x, z) < 0.25);
    if (!s) continue;
    leafy.push({ x: s.x, y: terrain.heightAt(s.x, s.z), z: s.z, scale: 0.8 + rnd() * 0.6, rot: rnd() * Math.PI * 2, solid: s.e < p.colliderRange });
  }
  for (let i = 0; i < p.rockCount; i++) {
    const s = sample(3.5, 0.6, () => true);
    if (!s) continue;
    rocks.push({ x: s.x, y: terrain.heightAt(s.x, s.z), z: s.z, scale: 0.5 + rnd() * 1.4, rot: rnd() * Math.PI * 2, solid: s.e < p.colliderRange && rnd() < 0.6 });
  }
  for (let i = 0; i < p.grassCount; i++) {
    const s = sample(0.8, 0.7, (x, z) => terrain.surfaceAt(x, z) === Surface.Grass && terrain.roadEdgeAt(x, z) < 45);
    if (!s) continue;
    grass.push({ x: s.x, y: terrain.heightAt(s.x, s.z), z: s.z, scale: 0.6 + rnd() * 0.8, rot: rnd() * Math.PI * 2, solid: false });
  }
  // Path-driven props: boulders at the road edges and pebbles on rough roads.
  const pebbles: SceneryInstance[] = [];
  for (const sp of pathList) {
    const hw = sp.def.width / 2;
    for (const f of sp.def.features ?? []) {
      if (f.type !== 'boulders') continue;
      let side = 1;
      for (let s = f.from; s <= Math.min(f.to, sp.length); s += f.spacing) {
        const sm = sp.at(s + (rnd() - 0.5) * f.spacing * 0.4);
        if (bridgeSpanFactor(bridgeSpans.get(sp.def.id), sm.s) > 0 || nearBridge(bridgeSpans.get(sp.def.id), sm.s)) continue;
        const off = side * (hw + 0.9 + rnd() * 1.4);
        const x = sm.x + sm.rx * off;
        const z = sm.z + sm.rz * off;
        rocks.push({ x, y: terrain.heightAt(x, z), z, scale: 0.9 + rnd() * 0.7, rot: rnd() * Math.PI * 2, solid: true });
        side = -side;
      }
    }
    const density = sp.def.pebbles ?? 0;
    const count = Math.floor((density * sp.length) / 100);
    for (let i = 0; i < count; i++) {
      const sm = sp.at(rnd() * sp.length);
      if (nearBridge(bridgeSpans.get(sp.def.id), sm.s)) continue;
      const off = (rnd() * 2 - 1) * (hw + 1);
      const x = sm.x + sm.rx * off;
      const z = sm.z + sm.rz * off;
      pebbles.push({ x, y: terrain.heightAt(x, z) + 0.05, z, scale: 0.12 + rnd() * 0.22, rot: rnd() * Math.PI * 2, solid: false });
    }
  }
  return { pines, leafy, rocks, grass, pebbles };
}
