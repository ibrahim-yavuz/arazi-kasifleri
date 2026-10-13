import type RAPIER from '@dimforge/rapier3d-compat';
import { Surface } from './Surfaces';
import type { SurfaceQuery } from './Surfaces';
import { GROUP_PROP, GROUP_STATIC, GROUP_VEHICLE, interactionGroups } from './PhysicsWorld';
import type { PhysicsWorld } from './PhysicsWorld';
import type { BuiltTrack } from '../world/TrackBuilder';

const STATIC_GROUPS = interactionGroups(GROUP_STATIC, GROUP_VEHICLE | GROUP_PROP);

/**
 * Creates every static collider of a built track: one heightfield for the terrain, one
 * triangle mesh per ramp, thin walls for fences, cylinders/balls for trees and rocks.
 * Also answers surface queries for the wheels.
 */
export class TerrainCollision implements SurfaceQuery {
  readonly body: RAPIER.RigidBody;
  readonly terrainCollider: RAPIER.Collider;
  private readonly rampHandles = new Set<number>();
  private readonly obstacleHandles = new Set<number>();

  constructor(
    private readonly physics: PhysicsWorld,
    private readonly track: BuiltTrack,
  ) {
    const R = physics.rapier;
    const world = physics.world;
    this.body = world.createRigidBody(R.RigidBodyDesc.fixed());
    const t = track.terrain;
    this.terrainCollider = world.createCollider(
      R.ColliderDesc.heightfield(t.segments, t.segments, t.toRapierHeights(), { x: t.size, y: 1, z: t.size })
        .setFriction(0.6)
        .setRestitution(0)
        .setCollisionGroups(STATIC_GROUPS),
      this.body,
    );

    for (const r of track.ramps) {
      const c = world.createCollider(
        R.ColliderDesc.trimesh(r.positions, r.indices).setFriction(0.6).setCollisionGroups(STATIC_GROUPS),
        this.body,
      );
      this.rampHandles.add(c.handle);
    }

    // Bridges: deck (triangle mesh, wooden surface) and solid railings.
    for (const b of track.bridges) {
      const deck = world.createCollider(R.ColliderDesc.trimesh(b.positions, b.indices).setFriction(0.6).setCollisionGroups(STATIC_GROUPS), this.body);
      this.rampHandles.add(deck.handle);
    }
    const walls = [...track.fences, ...track.bridges.flatMap((b) => b.railings)];
    for (const f of walls) {
      const dx = f.bx - f.ax;
      const dz = f.bz - f.az;
      const len = Math.hypot(dx, dz);
      if (len < 0.5) continue;
      const yaw = Math.atan2(dx, dz);
      const q = { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
      const c = world.createCollider(
        R.ColliderDesc.cuboid(0.08, 1.0, len / 2)
          .setTranslation((f.ax + f.bx) / 2, (f.ay + f.by) / 2 + 0.6, (f.az + f.bz) / 2)
          .setRotation(q)
          .setFriction(0.2)
          .setCollisionGroups(STATIC_GROUPS),
        this.body,
      );
      this.obstacleHandles.add(c.handle);
    }

    // Invisible walls at the world edge (behind the mountains).
    const h = t.half - 1;
    for (const [x, z, hx, hz] of [[h, 0, 1, t.half], [-h, 0, 1, t.half], [0, h, t.half, 1], [0, -h, t.half, 1]]) {
      const c = world.createCollider(
        R.ColliderDesc.cuboid(hx, 120, hz).setTranslation(x, 60, z).setFriction(0.2).setCollisionGroups(STATIC_GROUPS),
        this.body,
      );
      this.obstacleHandles.add(c.handle);
    }

    const sc = track.scenery;
    for (const tr of [...sc.pines, ...sc.leafy]) {
      if (!tr.solid) continue;
      const c = world.createCollider(
        R.ColliderDesc.cylinder(2.5, 0.28 * tr.scale + 0.1)
          .setTranslation(tr.x, tr.y + 2.3, tr.z)
          .setFriction(0.3)
          .setCollisionGroups(STATIC_GROUPS),
        this.body,
      );
      this.obstacleHandles.add(c.handle);
    }
    for (const rk of sc.rocks) {
      if (!rk.solid) continue;
      const c = world.createCollider(
        R.ColliderDesc.ball(0.75 * rk.scale)
          .setTranslation(rk.x, rk.y + 0.1 * rk.scale, rk.z)
          .setFriction(0.5)
          .setCollisionGroups(STATIC_GROUPS),
        this.body,
      );
      this.obstacleHandles.add(c.handle);
    }
  }

  surfaceAt(x: number, z: number, colliderHandle: number): Surface {
    if (this.rampHandles.has(colliderHandle)) return Surface.Wood;
    if (this.obstacleHandles.has(colliderHandle)) return Surface.Rock;
    if (colliderHandle !== this.terrainCollider.handle) return Surface.Dirt;
    return this.track.terrain.surfaceAt(x, z);
  }

  get colliderCount(): number {
    return 1 + this.rampHandles.size + this.obstacleHandles.size;
  }

  dispose(): void {
    this.physics.world.removeRigidBody(this.body);
  }
}
