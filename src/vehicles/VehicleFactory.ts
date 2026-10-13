import type { VehicleInfo } from '../data/vehicles';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import type { SurfaceQuery } from '../physics/Surfaces';
import { buildWheelLayout, cloneVehicleConfig } from '../physics/VehicleConfig';
import { VehiclePhysics } from '../physics/VehiclePhysics';
import type { SpawnPose } from '../physics/VehiclePhysics';
import type { DustSystem } from './DustSystem';
import { Vehicle } from './Vehicle';
import { createVehicleModel } from './VehicleModels';

/** Creates a complete vehicle (own copy of the config so tuning one car affects only it). */
export function createVehicle(
  info: VehicleInfo,
  physics: PhysicsWorld,
  surfaces: SurfaceQuery,
  spawn: SpawnPose,
  dust: DustSystem | null,
): Vehicle {
  const cfg = cloneVehicleConfig(info.config);
  const vp = new VehiclePhysics(physics, cfg, surfaces, spawn);
  const model = createVehicleModel(info, buildWheelLayout(cfg));
  return new Vehicle(info, vp, model, dust);
}

/** Spawn pose resting just above the ground at (x, z). */
export function groundSpawn(heightAt: (x: number, z: number) => number, info: VehicleInfo, x: number, z: number, yaw: number): SpawnPose {
  const c = info.config;
  const y = heightAt(x, z) + c.geometry.wheelRadius + c.suspension.restLength - c.geometry.hardpointHeight + 0.15;
  return { position: { x, y, z }, yaw };
}
