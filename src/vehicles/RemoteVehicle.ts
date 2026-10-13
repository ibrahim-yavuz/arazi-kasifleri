import type RAPIER from '@dimforge/rapier3d-compat';
import { Quaternion, Vector3 } from 'three';
import type { VehicleInfo } from '../data/vehicles';
import type { CarSnapshot } from '../net/protocol';
import { GROUP_PROP, GROUP_STATIC, GROUP_VEHICLE, interactionGroups } from '../physics/PhysicsWorld';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import { buildWheelLayout } from '../physics/VehicleConfig';
import type { WheelLayout } from '../physics/VehicleConfig';
import { createVehicleModel, updateLinks } from './VehicleModels';
import type { VehicleModel } from './VehicleModels';

/** Render remote cars this far in the past so two snapshots are usually available. */
export const REMOTE_DELAY = 0.15;
/** Never extrapolate further than this past the newest snapshot (s). */
const MAX_EXTRAPOLATION = 0.3;

const qa = new Quaternion();
const qb = new Quaternion();

/**
 * A car simulated in another player's browser. Shown from interpolated snapshots and
 * represented in the local physics world by a kinematic body with the chassis boxes, so
 * the local car can bump into it.
 */
export class RemoteVehicle {
  readonly model: VehicleModel;
  readonly body: RAPIER.RigidBody;
  readonly renderPosition = new Vector3();
  readonly renderRotation = new Quaternion();
  private readonly buffer: CarSnapshot[] = [];
  private readonly layout: WheelLayout[];
  /** Latest progress fraction reported by the owner. */
  progress = 0;
  latest: CarSnapshot | null = null;
  /**
   * Sender clock − local clock (s). Clocks drift apart when a tab was in the background, so
   * snapshots are timed on the sender's clock and mapped through this smoothed offset.
   */
  private clockOffset: number | null = null;

  constructor(
    readonly carId: string,
    readonly name: string,
    readonly info: VehicleInfo,
    private readonly physics: PhysicsWorld,
    spawn: { x: number; y: number; z: number; yaw: number },
  ) {
    const R = physics.rapier;
    const cfg = info.config;
    this.layout = buildWheelLayout(cfg);
    this.model = createVehicleModel(info, this.layout);
    const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), spawn.yaw);
    this.body = physics.world.createRigidBody(
      R.RigidBodyDesc.kinematicPositionBased().setTranslation(spawn.x, spawn.y, spawn.z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }),
    );
    const groups = interactionGroups(GROUP_VEHICLE, GROUP_STATIC | GROUP_VEHICLE | GROUP_PROP);
    const ch = cfg.chassis;
    const box = (he: { x: number; y: number; z: number }, off: { x: number; y: number; z: number }) =>
      physics.world.createCollider(
        R.ColliderDesc.cuboid(he.x, he.y, he.z).setTranslation(off.x, off.y, off.z).setFriction(ch.colliderFriction).setCollisionGroups(groups),
        this.body,
      );
    box(ch.colliderHalfExtents, ch.colliderOffset);
    if (ch.cabinHalfExtents) box(ch.cabinHalfExtents, ch.cabinOffset);
    this.renderPosition.set(spawn.x, spawn.y, spawn.z);
    this.renderRotation.copy(q);
    const restLen = cfg.suspension.restLength - (cfg.chassis.mass * 9.81) / 4 / cfg.suspension.stiffness;
    this.layout.forEach((w, i) => this.model.wheelPivots[i].position.set(w.hardpoint.x, w.hardpoint.y - restLen, w.hardpoint.z));
    this.applyPose();
  }

  push(s: CarSnapshot, localClock: number): void {
    if (this.latest && s.t <= this.latest.t) return;
    const off = s.t - localClock;
    // Snap on large jumps (tab was suspended); otherwise follow slowly to hide jitter.
    if (this.clockOffset === null || Math.abs(off - this.clockOffset) > 0.5) this.clockOffset = off;
    else this.clockOffset += (off - this.clockOffset) * 0.05;
    this.latest = s;
    this.progress = s.prog;
    this.buffer.push(s);
    while (this.buffer.length > 40) this.buffer.shift();
  }

  /** Pose at render time `t` (sender clock): interpolation, else bounded extrapolation. */
  private sample(t: number): { a: CarSnapshot; b: CarSnapshot; k: number } | null {
    const buf = this.buffer;
    if (buf.length === 0) return null;
    if (t <= buf[0].t) return { a: buf[0], b: buf[0], k: 0 };
    for (let i = buf.length - 1; i > 0; i--) {
      if (buf[i - 1].t <= t && t <= buf[i].t) {
        const a = buf[i - 1];
        const b = buf[i];
        return { a, b, k: (t - a.t) / Math.max(1e-6, b.t - a.t) };
      }
    }
    const last = buf[buf.length - 1];
    return { a: last, b: last, k: Math.min(t - last.t, MAX_EXTRAPOLATION) };
  }

  /** Fixed step: moves the kinematic collider to the delayed pose. */
  /** Local race time → sender time to render. */
  private senderTime(raceTime: number): number {
    return raceTime + (this.clockOffset ?? 0) - REMOTE_DELAY;
  }

  fixedUpdate(raceTime: number): void {
    this.computePose(this.senderTime(raceTime));
    this.body.setNextKinematicTranslation(this.renderPosition);
    this.body.setNextKinematicRotation(this.renderRotation);
  }

  private computePose(t: number): void {
    const s = this.sample(t);
    if (!s) return;
    const { a, b, k } = s;
    if (a === b) {
      // Extrapolate with velocity (k = seconds past the newest snapshot).
      this.renderPosition.set(a.p[0] + a.v[0] * k, a.p[1] + a.v[1] * k, a.p[2] + a.v[2] * k);
      this.renderRotation.set(a.q[0], a.q[1], a.q[2], a.q[3]);
      return;
    }
    this.renderPosition.set(a.p[0] + (b.p[0] - a.p[0]) * k, a.p[1] + (b.p[1] - a.p[1]) * k, a.p[2] + (b.p[2] - a.p[2]) * k);
    qa.set(a.q[0], a.q[1], a.q[2], a.q[3]);
    qb.set(b.q[0], b.q[1], b.q[2], b.q[3]);
    this.renderRotation.slerpQuaternions(qa, qb, k);
  }

  /** Render: pose, wheels, steering and lights from the snapshots. */
  syncVisual(raceTime: number): void {
    this.computePose(this.senderTime(raceTime));
    this.applyPose();
    const s = this.latest;
    if (!s) return;
    this.layout.forEach((w, i) => {
      this.model.wheelPivots[i].position.set(w.hardpoint.x, w.hardpoint.y - s.sl[i], w.hardpoint.z);
      this.model.wheelSteer[i].rotation.y = w.steerable ? -s.st : 0;
      this.model.wheelSpin[i].rotation.x = -s.wr[i];
    });
    if (this.model.steeringWheel) this.model.steeringWheel.rotation.z = -s.st * 6;
    updateLinks(this.model);
    this.model.brakeLights.emissiveIntensity = s.f & 1 ? 2.2 : 0.15;
    this.model.reverseLights.emissiveIntensity = s.f & 2 ? 1.5 : 0;
  }

  private applyPose(): void {
    this.model.root.position.copy(this.renderPosition);
    this.model.root.quaternion.copy(this.renderRotation);
  }

  dispose(): void {
    this.model.root.removeFromParent();
    this.model.dispose();
    this.physics.world.removeRigidBody(this.body);
  }
}
