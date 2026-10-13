import { PhysicsWorld, GROUP_STATIC, GROUP_PROP, GROUP_VEHICLE, interactionGroups } from './PhysicsWorld';
import type { Rapier } from './PhysicsWorld';
import { Surface } from './Surfaces';
import { VehiclePhysics } from './VehiclePhysics';
import type { VehicleConfig } from './VehicleConfig';
import { cloneVehicleConfig } from './VehicleConfig';
import { clamp, smoothstep } from './math';

/** Tuning of the start equaliser (design values). */
export const LAUNCH_EQUALIZER = {
  /** The extra distance is phased in over this many seconds after the green light. */
  window: 7,
  /** Keep correcting a little longer so position and speed settle, then switch off. */
  settle: 2.5,
  /** Bounded push/pull on the real car (m/s²). */
  maxAccel: 3,
  kp: 1.6,
  kd: 2.6,
};

/**
 * Fair start for cars that start further back on the grid. A "ghost" copy of the car, fed
 * the same inputs, drives on a flat plane as if it had started on the front row. A bounded
 * push/pull steers the real car toward the ghost's distance plus the grid gap, so after a
 * few seconds the car is exactly where it would have been from the front row, at the same
 * speed. This does not depend on the other players, so nobody can be pulled back by a
 * slow leader.
 */
export class LaunchEqualizer {
  private readonly physics: PhysicsWorld;
  private readonly ghost: VehiclePhysics;
  private t = 0;
  done = false;

  constructor(
    rapier: Rapier,
    cfg: VehicleConfig,
    private readonly car: VehiclePhysics,
    /** Metres the car starts behind the front row (measured along the start direction). */
    private readonly gap: number,
    /** Unit start direction on the ground plane, and the car's start position. */
    private readonly dir: { x: number; z: number },
    private readonly start: { x: number; z: number },
  ) {
    this.physics = new PhysicsWorld(rapier);
    const R = rapier;
    const ground = this.physics.world.createRigidBody(R.RigidBodyDesc.fixed());
    this.physics.world.createCollider(
      R.ColliderDesc.cuboid(2000, 1, 2000).setTranslation(0, -1, 0).setCollisionGroups(interactionGroups(GROUP_STATIC, GROUP_VEHICLE | GROUP_PROP)),
      ground,
    );
    const c = cloneVehicleConfig(cfg);
    const y = c.geometry.wheelRadius + c.suspension.restLength - c.geometry.hardpointHeight + 0.15;
    this.ghost = new VehiclePhysics(this.physics, c, { surfaceAt: () => Surface.Dirt }, { position: { x: 0, y, z: 0 }, yaw: 0 });
    this.ghost.inputEnabled = false;
    // Let the ghost settle on its springs like the real car does during the countdown.
    for (let i = 0; i < 120; i++) this.physics.step();
  }

  /** Call every fixed step after the green light, before the real physics step. */
  update(dt: number): void {
    if (this.done) return;
    const car = this.car;
    if (this.gap <= 0.05) {
      this.finish();
      return;
    }
    // Ghost mirrors the real driver's inputs (and the same input gating).
    this.ghost.inputEnabled = car.inputEnabled;
    Object.assign(this.ghost.controls, car.controls);
    this.physics.step();
    this.t += dt;

    const L = LAUNCH_EQUALIZER;
    const sGhost = -this.ghost.position.z; // ghost drives along −Z from the origin
    const vGhost = -this.ghost.body.linvel().z;
    const p = car.position;
    const sReal = (p.x - this.start.x) * this.dir.x + (p.z - this.start.z) * this.dir.z;
    const lv = car.body.linvel();
    const vReal = lv.x * this.dir.x + lv.z * this.dir.z;
    const w = smoothstep(0, L.window, this.t);
    const dw = this.t < L.window ? (6 * (this.t / L.window) * (1 - this.t / L.window)) / L.window : 0;
    const err = sGhost + this.gap * w - sReal;
    const derr = vGhost + this.gap * dw - vReal;
    car.assistAccel = clamp(L.kp * err + L.kd * derr, -L.maxAccel, L.maxAccel);
    if (this.t > L.window + L.settle) this.finish();
  }

  private finish(): void {
    this.done = true;
    this.car.assistAccel = 0;
    this.ghost.dispose();
    this.physics.dispose();
  }

  dispose(): void {
    if (!this.done) this.finish();
  }
}
