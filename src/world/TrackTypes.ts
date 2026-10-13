import type { Surface } from '../physics/Surfaces';

/** Route identifiers. 'start', 'mid' and 'final' are shared roads; the three choices repeat per leg. */
export type RouteId = 'start' | 'hiz' | 'bilgi' | 'cesaret' | 'mid' | 'final';
export type ChoiceRoute = 'hiz' | 'bilgi' | 'cesaret';
export const CHOICE_ROUTES: ChoiceRoute[] = ['hiz', 'bilgi', 'cesaret'];

export const ROUTE_LABELS: Record<RouteId, string> = {
  start: 'Başlangıç',
  hiz: 'Hız',
  bilgi: 'Bilgi',
  cesaret: 'Cesaret',
  mid: 'Ara Yol',
  final: 'Bitiş Yolu',
};

/** "Hız → Cesaret" style label for the roads chosen at each fork (null = not chosen yet). */
export function routesLabel(routes: Array<ChoiceRoute | null>): string {
  const chosen = routes.filter((r): r is ChoiceRoute => r !== null);
  return chosen.length ? chosen.map((r) => ROUTE_LABELS[r]).join(' → ') : '-';
}

/** Control point of a road centreline. y = road surface elevation (m). */
export interface PathPoint {
  x: number;
  z: number;
  y: number;
}

export type PathFeature =
  /** Sinusoidal bumps across the road between distances `from`..`to` (m along path). */
  | { type: 'moguls'; from: number; to: number; amplitude: number; wavelength: number }
  /** Road cross-fall: right side lower by tan(angle)·lateral. */
  | { type: 'sideSlope'; from: number; to: number; angleDeg: number }
  /** Override road surface. */
  | { type: 'surface'; from: number; to: number; surface: Surface }
  /** Steep walls either side of the road. */
  | { type: 'canyon'; from: number; to: number; wallHeight: number; wallWidth: number }
  /** Random small-scale unevenness on the road. */
  | { type: 'rough'; from: number; to: number; amplitude: number; scale: number }
  /** A single smooth hump across the road. */
  | { type: 'bump'; at: number; length: number; height: number }
  /** Solid boulders just outside the road edges, alternating sides every `spacing` m. */
  | { type: 'boulders'; from: number; to: number; spacing: number };

export interface PathDef {
  id: string;
  route: RouteId;
  points: PathPoint[];
  /** Road width (m). */
  width: number;
  /** Width of the blended shoulder (m). */
  shoulder: number;
  surface: Surface;
  features?: PathFeature[];
  /** Fence along both sides at this distance from the road edge (m); omit for none. */
  fenceOffset?: number;
  /** Ranges (m along path) where fences are placed. */
  fenceRanges?: Array<[number, number]>;
  /** Decorative stones on the road surface per 100 m (visual ruggedness, no collision). */
  pebbles?: number;
}

/** Flattened circular area (start grid, route fork, merge plaza). */
export interface PlazaDef {
  id: string;
  x: number;
  z: number;
  y: number;
  radius: number;
  shoulder: number;
  surface: Surface;
}

/** Wooden kicker ramp placed on a path (static triangle-mesh collider). */
export interface RampDef {
  path: string;
  at: number;
  length: number;
  width: number;
  height: number;
  /** Lateral offset from the centreline (m). */
  offset?: number;
  /** Height profile exponent: 1 = straight incline, >1 = progressive kicker. */
  profile?: number;
}

/** 'question' = a "?" sign on the Bilgi road; each one adds a question to the end-of-race quiz. */
export type CollectibleKind = 'hourglass' | 'sign' | 'turbo' | 'question';

export interface CollectibleDef {
  kind: CollectibleKind;
  path: string;
  at: number;
  offset?: number;
  /** Height above the road surface (m). */
  height?: number;
}

export interface CheckpointPlacement {
  path: string;
  at: number;
  /** Extra width beyond the road width on each side (m). */
  margin?: number;
}

export interface BannerDef {
  path: string;
  at: number;
  text: string;
  color?: string;
}

export interface SignpostDef {
  x: number;
  z: number;
  /** Rotation around Y (rad). */
  yaw: number;
  arrows: Array<{ text: string; dir: 'left' | 'right' }>;
}

/** A river or creek: carved into the natural terrain; roads crossing it get bridges. */
export interface RiverDef {
  points: Array<{ x: number; z: number }>;
  /** Width of the water channel (m). */
  width: number;
  /** Height of the riverbed and of the water surface (absolute, m). */
  bedHeight: number;
  waterHeight: number;
}

export interface NaturalTerrainParams {
  baseHeight: number;
  hillAmplitude: number;
  hillScale: number;
  detailAmplitude: number;
  /** Mountains rise beyond this distance from the centre (m). */
  mountainStart: number;
  mountainHeight: number;
  seed: number;
  /** Where natural ground is sand instead of grass (noise threshold, 1 = never). */
  sandThreshold: number;
  flat?: boolean;
  rivers?: RiverDef[];
}

export interface SceneryParams {
  seed: number;
  pineCount: number;
  leafyCount: number;
  rockCount: number;
  grassCount: number;
  /** Trees closer than this to a road edge get physics colliders. */
  colliderRange: number;
}

/**
 * One fork of the course: three roads (Hız, Bilgi, Cesaret) that split at a clearing and
 * merge again. The first checkpoint of each road is its entry gate.
 */
export interface LegDef {
  paths: Record<ChoiceRoute, string>;
  checkpoints: Record<ChoiceRoute, CheckpointPlacement[]>;
  /** Gate after the three roads have merged. */
  merge: CheckpointPlacement;
}

export interface TrackDef {
  id: string;
  name: string;
  worldSize: number;
  segments: number;
  natural: NaturalTerrainParams;
  paths: PathDef[];
  plazas: PlazaDef[];
  ramps: RampDef[];
  /** Spawn grid (first slot is the player). */
  grid: Array<{ x: number; z: number; yaw: number }>;
  startLine: CheckpointPlacement;
  /** The forks of the course, in driving order. */
  legs: LegDef[];
  /** Shared roads: before the first fork, between forks, after the last (legs.length + 1). */
  connectors: string[];
  finishLine: CheckpointPlacement;
  collectibles: CollectibleDef[];
  banners: BannerDef[];
  signposts: SignpostDef[];
  scenery: SceneryParams;
}
