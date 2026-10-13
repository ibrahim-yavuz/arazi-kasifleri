import { Group } from 'three';
import type { Mesh } from 'three';
import { createMountainBackdrop } from '../render/Backdrop';
import { SKY } from '../render/Renderer';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import { TerrainCollision } from '../physics/TerrainCollision';
import { CollectibleVisuals } from './CollectibleVisuals';
import { Scenery } from './Scenery';
import { TerrainMesh } from './Terrain';
import { TrackVisuals } from './Track';
import { buildTrack } from './TrackBuilder';
import type { BuiltTrack } from './TrackBuilder';
import type { TrackDef } from './TrackTypes';

/** Assembles one drivable environment: visuals (Three.js) + static colliders (Rapier). */
export class World {
  readonly group = new Group();
  readonly track: BuiltTrack;
  readonly collision: TerrainCollision;
  readonly terrainMesh: TerrainMesh;
  readonly scenery: Scenery;
  readonly visuals: TrackVisuals;
  readonly collectibles: CollectibleVisuals;
  private readonly backdrop: Mesh | null;

  private constructor(def: TrackDef, physics: PhysicsWorld, quality: number) {
    this.track = buildTrack(def);
    this.collision = new TerrainCollision(physics, this.track);
    // Splat resolution scales with quality (the 1.6 km course needs more texels per metre).
    this.terrainMesh = new TerrainMesh(this.track.terrain, [1536, 2048, 3072][quality] ?? 2048);
    this.scenery = new Scenery(this.track.scenery, quality);
    this.visuals = new TrackVisuals(this.track);
    this.collectibles = new CollectibleVisuals(this.track.collectibles);
    this.group.add(this.terrainMesh.group, this.scenery.group, this.visuals.group, this.collectibles.group);
    this.backdrop = def.natural.flat ? null : createMountainBackdrop(def.worldSize * 0.9, SKY.horizon);
    if (this.backdrop) this.group.add(this.backdrop);
  }

  /** Distance culling of terrain chunks and scenery regions (call every frame). */
  cull(camX: number, camZ: number): void {
    const range = SKY.fogFar + 40;
    this.terrainMesh.cull(camX, camZ, range);
    this.scenery.cull(camX, camZ, range);
  }

  /** Builds the world in stages, yielding to the browser so the loading screen can update. */
  static async create(def: TrackDef, physics: PhysicsWorld, quality: number, progress?: (t: string) => void): Promise<World> {
    progress?.('Arazi hazırlanıyor...');
    await nextFrame();
    const w = new World(def, physics, quality);
    progress?.('Hazır');
    return w;
  }

  dispose(): void {
    if (this.backdrop) {
      this.backdrop.geometry.dispose();
      (this.backdrop.material as { dispose(): void }).dispose();
    }
    this.terrainMesh.dispose();
    this.scenery.dispose();
    this.visuals.dispose();
    this.collectibles.dispose();
    this.collision.dispose();
  }
}

export function nextFrame(): Promise<void> {
  return new Promise((r) => requestAnimationFrame(() => r()));
}
