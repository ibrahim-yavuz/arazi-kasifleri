import { Vector3 } from 'three';
import { PhysicsWorld, initRapier } from './PhysicsWorld';
import { TerrainCollision } from './TerrainCollision';
import { VehiclePhysics } from './VehiclePhysics';
import type { SpawnPose } from './VehiclePhysics';
import type { VehicleConfig } from './VehicleConfig';
import { cloneVehicleConfig } from './VehicleConfig';
import { buildTrack } from '../world/TrackBuilder';
import type { BuiltTrack } from '../world/TrackBuilder';
import type { TrackDef } from '../world/TrackTypes';

/**
 * Headless simulation (no rendering): physics world + terrain + one vehicle. Used by
 * `npm run validate` and the automated tests, with exactly the same code the game runs.
 */
export class SimHarness {
  private constructor(
    readonly physics: PhysicsWorld,
    readonly track: BuiltTrack,
    readonly terrain: TerrainCollision,
    readonly vehicle: VehiclePhysics,
  ) {}

  static async create(trackDef: TrackDef | BuiltTrack, cfg: VehicleConfig, spawn: SpawnPose): Promise<SimHarness> {
    const R = await initRapier();
    const physics = new PhysicsWorld(R);
    const track = 'terrain' in trackDef ? trackDef : buildTrack(trackDef);
    const terrain = new TerrainCollision(physics, track);
    const vehicle = new VehiclePhysics(physics, cloneVehicleConfig(cfg), terrain, spawn);
    return new SimHarness(physics, track, terrain, vehicle);
  }

  get time(): number {
    return this.physics.stepCount * this.physics.world.timestep;
  }

  step(n = 1): void {
    for (let i = 0; i < n; i++) this.physics.step();
  }

  /** Spawn pose with the car resting just above the terrain at (x, z). */
  groundSpawn(x: number, z: number, yaw = 0, clearance = 0.15): SpawnPose {
    const g = this.track.terrain.heightAt(x, z);
    const c = this.vehicle.cfg;
    const y = g + c.geometry.wheelRadius + c.suspension.restLength - c.geometry.hardpointHeight + clearance;
    return { position: { x, y, z }, yaw };
  }

  /**
   * Test-only initial condition: gives the car a forward speed with matching wheel spin,
   * so a manoeuvre can start at a known speed without a long run-up.
   */
  setForwardSpeed(v: number): void {
    const veh = this.vehicle;
    const f = veh.forwardVector(new Vector3());
    veh.body.setLinvel({ x: f.x * v, y: f.y * v, z: f.z * v }, true);
    for (const w of veh.wheels) w.omega = v / w.layout.radius;
  }

  dispose(): void {
    this.vehicle.dispose();
    this.physics.dispose();
  }
}
