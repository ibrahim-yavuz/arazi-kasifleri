import type RAPIER from '@dimforge/rapier3d-compat';
import { Quaternion, Vector3 } from 'three';
import { Drivetrain } from './Drivetrain';
import { PHYSICS_SETTINGS, GROUP_PROP, GROUP_STATIC, GROUP_VEHICLE, interactionGroups, safeRayDir } from './PhysicsWorld';
import type { FixedStepParticipant, PhysicsWorld } from './PhysicsWorld';
import { SURFACES, Surface } from './Surfaces';
import type { SurfaceQuery } from './Surfaces';
import { antiRollForce, suspensionForce } from './Suspension';
import { SimpleTireModel, createTireOutput } from './TireModel';
import type { TireModel, TireSolveInput } from './TireModel';
import { boxInertia, buildWheelLayout } from './VehicleConfig';
import type { VehicleConfig, WheelLayout } from './VehicleConfig';
import { DEG2RAD, MS_TO_KMH, clamp, lerp, moveTowards } from './math';

/** Continuous control state sampled once per fixed step. */
export interface VehicleControls {
  /** Accelerate key 0..1. */
  throttle: number;
  /** Brake/reverse key 0..1. */
  brake: number;
  /** −1 (left) .. +1 (right). */
  steer: number;
  handbrake: boolean;
}

export function createControls(): VehicleControls {
  return { throttle: 0, brake: 0, steer: 0, handbrake: false };
}

export interface WheelState {
  layout: WheelLayout;
  inContact: boolean;
  /** Current spring length (m), restLength when airborne. */
  suspensionLength: number;
  prevSuspensionLength: number;
  compression: number;
  compressionVelocity: number;
  suspensionForce: number;
  load: number;
  hardpointWorld: Vector3;
  contactPoint: Vector3;
  contactNormal: Vector3;
  rayLength: number;
  steerAngle: number;
  omega: number;
  /** Accumulated spin angle (rad) for the visual wheel. */
  rotation: number;
  prevRotation: number;
  slipRatio: number;
  slipAngle: number;
  saturation: number;
  locked: boolean;
  surface: Surface;
  fx: number;
  fy: number;
  /** Contact-patch velocity in the wheel frame (m/s), for debugging. */
  vLong: number;
  vLat: number;
  tyreImpulse: Vector3;
  tyreImpulsePoint: Vector3;
  /** Static-friction anchor (contact point captured when the patch came to rest). */
  anchored: boolean;
  anchor: Vector3;
  /** ABS modulation of the service brake on this wheel (0..1). */
  absScale: number;
}

export interface VehicleTelemetry {
  speed: number;
  forwardSpeed: number;
  speedKmh: number;
  rpm: number;
  gear: number;
  throttle: number;
  brake: number;
  wheelsInContact: number;
  airborne: boolean;
  airTime: number;
  /** Largest unexplained velocity change in the last step (m/s), i.e. a collision. */
  impact: number;
  maxSlip: number;
  upDot: number;
  steerAngle: number;
}

export interface SpawnPose {
  position: Vec3Like;
  /** Heading in radians around +Y; 0 = facing −Z. */
  yaw: number;
}

interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

const WORLD_UP = new Vector3(0, 1, 0);

const tmpV = new Vector3();
const tmpV2 = new Vector3();

/**
 * Raycast vehicle: one rigid chassis in Rapier + four independently simulated
 * suspension/tyre contact points. Every force is applied to the chassis as an impulse
 * before the Rapier step; the chassis pose is never written during normal driving.
 */
export class VehiclePhysics implements FixedStepParticipant {
  readonly body: RAPIER.RigidBody;
  readonly colliders: RAPIER.Collider[] = [];
  readonly wheels: WheelState[];
  readonly drivetrain: Drivetrain;
  readonly controls: VehicleControls = createControls();
  readonly telemetry: VehicleTelemetry;
  cfg: VehicleConfig;
  tireModel: TireModel;
  /** Set by gameplay while a turbo pickup is active. */
  turboActive = false;
  /** When false the vehicle ignores controls (countdown, finished, paused AI). */
  inputEnabled = true;
  /**
   * Extra forward acceleration (m/s², may be negative) applied to the chassis while at
   * least two wheels touch the ground. Used by the start equaliser (LaunchEqualizer).
   */
  assistAccel = 0;

  /** Interpolation buffers (previous and current fixed-step poses). */
  readonly prevPosition = new Vector3();
  readonly currPosition = new Vector3();
  readonly prevRotation = new Quaternion();
  readonly currRotation = new Quaternion();

  private steerAngle = 0;
  /** Traction-control torque scale (0..1). */
  private tcScale = 1;
  private expectedVel = new Vector3();
  private readonly ray: RAPIER.Ray;
  private readonly tireIn: TireSolveInput;
  private readonly tireOut = createTireOutput();
  private readonly rayGroups = interactionGroups(0xffff, GROUP_STATIC | GROUP_VEHICLE | GROUP_PROP);
  private lastSafe = { pos: new Vector3(), rot: new Quaternion() };

  // Per-step frame vectors (world space).
  private readonly pos = new Vector3();
  private readonly rot = new Quaternion();
  private readonly up = new Vector3();
  private readonly fwd = new Vector3();
  private readonly right = new Vector3();

  constructor(
    private readonly physics: PhysicsWorld,
    cfg: VehicleConfig,
    private readonly surfaces: SurfaceQuery,
    spawn: SpawnPose,
    tireModel: TireModel = new SimpleTireModel(),
  ) {
    this.cfg = cfg;
    this.tireModel = tireModel;
    const R = physics.rapier;
    const q = new Quaternion().setFromAxisAngle(WORLD_UP, spawn.yaw);
    const desc = R.RigidBodyDesc.dynamic()
      .setTranslation(spawn.position.x, spawn.position.y, spawn.position.z)
      .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
      .setCanSleep(false)
      .setCcdEnabled(true)
      .setLinearDamping(cfg.chassis.linearDamping)
      .setAngularDamping(cfg.chassis.angularDamping);
    this.body = physics.world.createRigidBody(desc);
    this.buildColliders();
    this.applyMassProperties();

    this.wheels = buildWheelLayout(cfg).map((layout) => ({
      layout,
      inContact: false,
      suspensionLength: cfg.suspension.restLength,
      prevSuspensionLength: cfg.suspension.restLength,
      compression: 0,
      compressionVelocity: 0,
      suspensionForce: 0,
      load: 0,
      hardpointWorld: new Vector3(),
      contactPoint: new Vector3(),
      contactNormal: new Vector3(0, 1, 0),
      rayLength: 0,
      steerAngle: 0,
      omega: 0,
      rotation: 0,
      prevRotation: 0,
      slipRatio: 0,
      slipAngle: 0,
      saturation: 0,
      locked: false,
      surface: Surface.Dirt,
      fx: 0,
      fy: 0,
      vLong: 0,
      vLat: 0,
      tyreImpulse: new Vector3(),
      tyreImpulsePoint: new Vector3(),
      anchored: false,
      anchor: new Vector3(),
      absScale: 1,
    }));
    this.drivetrain = new Drivetrain(cfg.engine, cfg.transmission);
    this.ray = new R.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
    this.tireIn = {
      load: 0, mu: 1, vLong: 0, vLat: 0, omega: 0, radius: 0.4, inertia: 1, driveTorque: 0,
      brakeTorque: 0, lateralScale: 1, maxDampingCoef: 1e9, dt: PHYSICS_SETTINGS.fixedDt,
    };
    this.telemetry = {
      speed: 0, forwardSpeed: 0, speedKmh: 0, rpm: cfg.engine.idleRPM, gear: 1, throttle: 0, brake: 0,
      wheelsInContact: 0, airborne: false, airTime: 0, impact: 0, maxSlip: 0, upDot: 1, steerAngle: 0,
    };
    this.syncPoseBuffers(true);
    physics.add(this);
  }

  /** Re-creates chassis colliders (e.g. after tuning collider dimensions). */
  buildColliders(): void {
    const R = this.physics.rapier;
    for (const c of this.colliders) this.physics.world.removeCollider(c, false);
    this.colliders.length = 0;
    const ch = this.cfg.chassis;
    const groups = interactionGroups(GROUP_VEHICLE, GROUP_STATIC | GROUP_VEHICLE | GROUP_PROP);
    const make = (he: { x: number; y: number; z: number }, off: { x: number; y: number; z: number }) =>
      this.physics.world.createCollider(
        R.ColliderDesc.roundCuboid(Math.max(0.05, he.x - 0.08), Math.max(0.05, he.y - 0.08), Math.max(0.05, he.z - 0.08), 0.08)
          .setTranslation(off.x, off.y, off.z)
          .setDensity(0)
          .setFriction(ch.colliderFriction)
          .setRestitution(ch.colliderRestitution)
          .setCollisionGroups(groups),
        this.body,
      );
    this.colliders.push(make(ch.colliderHalfExtents, ch.colliderOffset));
    if (ch.cabinHalfExtents) this.colliders.push(make(ch.cabinHalfExtents, ch.cabinOffset));
  }

  /** Applies mass, centre of mass and inertia from the config (call after tuning them). */
  applyMassProperties(): void {
    const ch = this.cfg.chassis;
    const inertia = boxInertia(ch);
    this.body.setAdditionalMassProperties(ch.mass, ch.centerOfMass, inertia, { x: 0, y: 0, z: 0, w: 1 }, true);
    this.body.setLinearDamping(ch.linearDamping);
    this.body.setAngularDamping(ch.angularDamping);
  }

  /** Explicit reset (player pressed R, race restart). The only place the pose is written. */
  reset(pose: SpawnPose): void {
    const q = new Quaternion().setFromAxisAngle(WORLD_UP, pose.yaw);
    this.body.setTranslation(pose.position, true);
    this.body.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    for (const w of this.wheels) {
      w.omega = 0;
      w.inContact = false;
      w.suspensionLength = this.cfg.suspension.restLength;
      w.prevSuspensionLength = w.suspensionLength;
      w.compression = 0;
      w.anchored = false;
      w.absScale = 1;
    }
    this.steerAngle = 0;
    this.tcScale = 1;
    this.assistAccel = 0;
    this.drivetrain.reset();
    this.turboActive = false;
    this.telemetry.airTime = 0;
    this.syncPoseBuffers(true);
  }

  private syncPoseBuffers(snap: boolean): void {
    const t = this.body.translation();
    const r = this.body.rotation();
    if (snap) {
      this.prevPosition.set(t.x, t.y, t.z);
      this.prevRotation.set(r.x, r.y, r.z, r.w);
    } else {
      this.prevPosition.copy(this.currPosition);
      this.prevRotation.copy(this.currRotation);
    }
    this.currPosition.set(t.x, t.y, t.z);
    this.currRotation.set(r.x, r.y, r.z, r.w);
    for (const w of this.wheels) {
      if (snap) w.prevRotation = w.rotation;
    }
  }

  /** Interpolated chassis transform for rendering. */
  getInterpolatedPose(alpha: number, outPos: Vector3, outRot: Quaternion): void {
    outPos.lerpVectors(this.prevPosition, this.currPosition, alpha);
    outRot.slerpQuaternions(this.prevRotation, this.currRotation, alpha);
  }

  preStep(dt: number): void {
    const cfg = this.cfg;
    const body = this.body;
    const world = this.physics.world;
    const t = body.translation();
    const r = body.rotation();
    this.pos.set(t.x, t.y, t.z);
    this.rot.set(r.x, r.y, r.z, r.w);
    this.up.set(0, 1, 0).applyQuaternion(this.rot);
    this.fwd.set(0, 0, -1).applyQuaternion(this.rot);
    this.right.set(1, 0, 0).applyQuaternion(this.rot);
    const lv = body.linvel();
    const av0 = body.angvel();
    const forwardSpeed = lv.x * this.fwd.x + lv.y * this.fwd.y + lv.z * this.fwd.z;
    const lateralSpeed = lv.x * this.right.x + lv.y * this.right.y + lv.z * this.right.z;
    // Body slip angle (velocity direction relative to heading), positive = sliding right.
    const bodySlip = forwardSpeed > 2 ? Math.atan2(lateralSpeed, forwardSpeed) : 0;
    const slipExcess = Math.max(0, Math.abs(bodySlip) - cfg.assists.stabilitySlipDeg * DEG2RAD);

    // --- Inputs → pedals and steering ------------------------------------------------
    const c = this.inputEnabled ? this.controls : { throttle: 0, brake: 0, steer: 0, handbrake: false };
    const pedals = this.inputEnabled
      ? this.drivetrain.mapPedals(c.throttle, c.brake, forwardSpeed, dt)
      : { throttle: 0, brake: 1 };
    const st = cfg.steering;
    const lockScale = lerp(1, st.highSpeedFactor, clamp(Math.abs(forwardSpeed) / st.highSpeedRef, 0, 1));
    const targetSteer = clamp(c.steer, -1, 1) * st.maxAngleDeg * DEG2RAD * lockScale;
    const returning = Math.abs(targetSteer) < Math.abs(this.steerAngle) || Math.sign(targetSteer) !== Math.sign(this.steerAngle);
    const rate = (returning ? st.returnRateDegPerSec : st.rateDegPerSec) * DEG2RAD;
    this.steerAngle = moveTowards(this.steerAngle, targetSteer, rate * dt);

    // --- Suspension raycasts -----------------------------------------------------------
    const sus = cfg.suspension;
    for (const w of this.wheels) {
      const L = w.layout;
      w.hardpointWorld.set(L.hardpoint.x, L.hardpoint.y, L.hardpoint.z).applyQuaternion(this.rot).add(this.pos);
      const maxToi = sus.restLength + L.radius;
      this.ray.origin = w.hardpointWorld;
      this.ray.dir = safeRayDir({ x: -this.up.x, y: -this.up.y, z: -this.up.z });
      const hit = world.castRayAndGetNormal(this.ray, maxToi, true, undefined, this.rayGroups, undefined, body);
      const wasInContact = w.inContact;
      w.prevSuspensionLength = w.suspensionLength;
      if (hit) {
        const toi = hit.timeOfImpact;
        w.inContact = true;
        w.rayLength = toi;
        w.suspensionLength = Math.max(0, toi - L.radius);
        w.contactPoint.copy(w.hardpointWorld).addScaledVector(this.up, -toi);
        w.contactNormal.set(hit.normal.x, hit.normal.y, hit.normal.z);
        w.surface = this.surfaces.surfaceAt(w.contactPoint.x, w.contactPoint.z, hit.collider.handle);
        w.compression = sus.restLength - w.suspensionLength;
        w.compressionVelocity = wasInContact
          ? clamp((w.prevSuspensionLength - w.suspensionLength) / dt, -12, 12)
          : clamp(-(lv.x * this.up.x + lv.y * this.up.y + lv.z * this.up.z), -12, 12);
        const scale = L.front ? 1 : sus.rearStiffnessScale;
        w.suspensionForce = suspensionForce(w.compression, w.compressionVelocity, sus, scale);
      } else {
        w.inContact = false;
        w.rayLength = maxToi;
        // Unloaded wheel relaxes toward full droop.
        w.suspensionLength = Math.min(sus.restLength, w.suspensionLength + 2.5 * dt);
        w.compression = 0;
        w.compressionVelocity = 0;
        w.suspensionForce = 0;
        w.contactPoint.copy(w.hardpointWorld).addScaledVector(this.up, -maxToi);
        w.contactNormal.copy(this.up);
      }
    }
    // Anti-roll bars (front pair 0/1, rear pair 2/3).
    this.applyAntiRoll(0, 1, sus.antiRollFront);
    this.applyAntiRoll(2, 3, sus.antiRollRear);

    // --- Drivetrain --------------------------------------------------------------------
    let drivenOmega = 0;
    let drivenCount = 0;
    let drivenGrounded = false;
    for (const w of this.wheels) {
      if (!w.layout.driven) continue;
      drivenOmega += w.omega;
      drivenCount++;
      if (w.inContact) drivenGrounded = true;
    }
    drivenOmega = drivenCount > 0 ? drivenOmega / drivenCount : 0;
    const roadOmega = forwardSpeed / (cfg.transmission.layout === 'FWD' ? cfg.geometry.wheelRadius : this.wheels[2].layout.radius);
    // Traction control: back off drive torque while driven wheels spin past peak slip.
    const tc = cfg.assists.tractionControl;
    if (tc > 0) {
      let spin = 0;
      for (const w of this.wheels) {
        if (w.layout.driven && w.inContact) spin = Math.max(spin, Math.abs(w.slipRatio));
      }
      const sliding = cfg.assists.stability > 0 && slipExcess > 0.02;
      if ((spin > cfg.tire.peakSlipRatio * 1.3 || sliding) && pedals.throttle > 0) this.tcScale = Math.max(1 - 0.75 * tc, this.tcScale - 5 * dt);
      else this.tcScale = Math.min(1, this.tcScale + 2.5 * dt);
    } else {
      this.tcScale = 1;
    }
    let driveTotal = this.drivetrain.update(pedals.throttle * this.tcScale, drivenOmega, drivenGrounded, dt, roadOmega);
    if (this.turboActive && pedals.throttle > 0) driveTotal *= cfg.turbo.multiplier;
    const reflected = this.drivetrain.reflectedInertia();
    const tr = cfg.transmission;

    const nominalLoad = (cfg.chassis.mass * PHYSICS_SETTINGS.gravity) / 4;
    const maxDampingCoef = (0.8 * (cfg.chassis.mass / 4)) / dt;
    const brakeTotal = pedals.brake * cfg.brakes.maxTorque;
    const ackermann = this.ackermannAngles(this.steerAngle);

    let contactCount = 0;
    let maxSlip = 0;
    const comWorld = body.worldCom();
    for (const w of this.wheels) {
      const L = w.layout;
      // Torque split (open differentials).
      let share = 0;
      if (L.driven) {
        if (tr.layout === 'AWD') share = (L.front ? tr.frontSplit : 1 - tr.frontSplit) * 0.5;
        else share = 0.5;
      }
      const driveTorque = driveTotal * share;
      const inertia = cfg.geometry.wheelInertia + reflected * share;
      // ABS: back off the service brake on a wheel that is locking up.
      if (cfg.brakes.abs && brakeTotal > 0 && w.inContact && Math.abs(w.vLong) > 1.5 && w.slipRatio < -cfg.tire.peakSlipRatio * 1.3) {
        w.absScale = Math.max(0.15, w.absScale - 8 * dt);
      } else {
        w.absScale = Math.min(1, w.absScale + 5 * dt);
      }
      const absScale = cfg.brakes.abs ? w.absScale : 1;
      let brakeTorque = brakeTotal * (L.front ? cfg.brakes.frontBias : 1 - cfg.brakes.frontBias) * 0.5 * absScale;
      if (!L.front && c.handbrake && this.inputEnabled) brakeTorque += cfg.brakes.handbrakeTorque;
      w.steerAngle = L.steerable ? (L.left ? ackermann.left : ackermann.right) : 0;
      w.prevRotation = w.rotation;

      if (!w.inContact) {
        // Free-spinning wheel: drive and brake torque only, slight bearing drag.
        let om = w.omega + (dt * driveTorque) / inertia;
        if (brakeTorque > 0) {
          const d = Math.sign(om) || 1;
          const nb = om - (dt * brakeTorque * d) / inertia;
          om = Math.sign(nb) !== d ? 0 : nb;
        }
        w.omega = om * (1 - 0.3 * dt);
        w.rotation += w.omega * dt;
        w.load = 0;
        w.fx = 0;
        w.fy = 0;
        w.slipRatio = 0;
        w.slipAngle = 0;
        w.saturation = 0;
        w.locked = false;
        w.anchored = false;
        continue;
      }
      contactCount++;

      const n = w.contactNormal;
      const normalDot = Math.max(0, this.up.dot(n));
      w.load = w.suspensionForce * normalDot;

      // Wheel rolling direction projected onto the contact plane.
      const wheelFwd = tmpV.copy(this.fwd).applyAxisAngle(this.up, -w.steerAngle);
      wheelFwd.addScaledVector(n, -wheelFwd.dot(n)).normalize();
      const wheelSide = tmpV2.crossVectors(wheelFwd, n).normalize();

      const vp = this.body.velocityAtPoint(w.contactPoint);
      const vLong = vp.x * wheelFwd.x + vp.y * wheelFwd.y + vp.z * wheelFwd.z;
      const vLat = vp.x * wheelSide.x + vp.y * wheelSide.y + vp.z * wheelSide.z;
      w.vLong = vLong;
      w.vLat = vLat;

      const surf = SURFACES[w.surface];
      const loadRatio = w.load / nominalLoad;
      const loadMu = clamp(1 - cfg.tire.loadSensitivity * (loadRatio - 1), 0.6, 1.25);
      let lateralScale = L.front ? 1 : cfg.tire.rearLateralScale;
      if (!L.front && c.handbrake && this.inputEnabled) lateralScale *= cfg.brakes.handbrakeRearGrip;

      const ti = this.tireIn;
      ti.load = w.load;
      ti.mu = cfg.tire.friction * surf.grip * loadMu;
      ti.vLong = vLong;
      ti.vLat = vLat;
      ti.omega = w.omega;
      ti.radius = L.radius;
      ti.inertia = inertia;
      ti.driveTorque = driveTorque;
      ti.brakeTorque = brakeTorque;
      ti.lateralScale = lateralScale;
      ti.maxDampingCoef = maxDampingCoef;
      ti.dt = dt;
      this.tireModel.solve(ti, cfg.tire, this.tireOut);
      const o = this.tireOut;
      w.omega = o.omega;
      w.rotation += w.omega * dt;
      w.fx = o.fx;
      w.fy = o.fy;
      w.slipRatio = o.slipRatio;
      w.slipAngle = o.slipAngle;
      w.saturation = o.saturation;
      w.locked = o.locked;
      const slipMag = Math.abs(vLat) + Math.abs(w.omega * L.radius - vLong);
      if (slipMag > maxSlip) maxSlip = slipMag;

      // Rolling resistance and soft-surface sink drag act along the rolling direction.
      const rr = surf.rollingResistance * w.load * Math.tanh(vLong / 0.5);
      const sink = surf.sinkDrag * (w.load / 1000) * vLong;
      let fLong = o.fx - rr - sink;
      let fLat = o.fy;

      // Static friction: a patch at rest is held by a stiff spring to where it stopped
      // (longitudinally only when the wheel is braked and locked), until the spring force
      // exceeds the available friction. Removes the slow creep of a pure slip-velocity model.
      const holdLong = brakeTorque > 0 && w.omega === 0 && Math.abs(vLong) < 0.25;
      const holdLat = Math.abs(vLat) < 0.15 && Math.abs(vLong) < 0.5;
      if (holdLong || holdLat) {
        if (!w.anchored) {
          w.anchor.copy(w.contactPoint);
          w.anchored = true;
        }
        const k = (0.25 * (cfg.chassis.mass / 4)) / (dt * dt);
        const dx = w.contactPoint.x - w.anchor.x;
        const dy = w.contactPoint.y - w.anchor.y;
        const dz = w.contactPoint.z - w.anchor.z;
        const sx = holdLong ? -k * (dx * wheelFwd.x + dy * wheelFwd.y + dz * wheelFwd.z) : 0;
        const sy = holdLat ? -k * (dx * wheelSide.x + dy * wheelSide.y + dz * wheelSide.z) : 0;
        if (Math.hypot(sx, sy) > ti.mu * w.load) {
          w.anchored = false;
        } else {
          fLong += sx;
          fLat += sy;
        }
      } else {
        w.anchored = false;
      }

      // Tyre forces act at a point between contact patch and CoM height (roll influence).
      const contactToCom = (comWorld.x - w.contactPoint.x) * this.up.x + (comWorld.y - w.contactPoint.y) * this.up.y + (comWorld.z - w.contactPoint.z) * this.up.z;
      const appHeight = (1 - sus.rollInfluence) * Math.max(0, contactToCom);
      const ax = w.contactPoint.x + this.up.x * appHeight;
      const ay = w.contactPoint.y + this.up.y * appHeight;
      const az = w.contactPoint.z + this.up.z * appHeight;

      // Forces are only recorded here and applied after all wheels have been evaluated,
      // so every wheel sees the same pre-step chassis velocity (order independent).
      w.tyreImpulse.set(
        (wheelFwd.x * fLong + wheelSide.x * fLat) * dt,
        (wheelFwd.y * fLong + wheelSide.y * fLat) * dt,
        (wheelFwd.z * fLong + wheelSide.z * fLat) * dt,
      );
      w.tyreImpulsePoint.set(ax, ay, az);
    }

    for (const w of this.wheels) {
      if (!w.inContact) continue;
      body.applyImpulseAtPoint(w.tyreImpulse, w.tyreImpulsePoint, true);
      // Suspension force along the suspension axis at the contact point.
      const fs = w.suspensionForce * dt;
      body.applyImpulseAtPoint({ x: this.up.x * fs, y: this.up.y * fs, z: this.up.z * fs }, w.contactPoint, true);
    }

    // --- Aerodynamics ------------------------------------------------------------------
    const lv2 = body.linvel();
    const speed = Math.sqrt(lv2.x * lv2.x + lv2.y * lv2.y + lv2.z * lv2.z);
    const drag = cfg.aero.dragFactor * speed * dt;
    const down = cfg.aero.downforceFactor * speed * speed * dt;
    body.applyImpulse(
      { x: -lv2.x * drag - this.up.x * down, y: -lv2.y * drag - this.up.y * down, z: -lv2.z * drag - this.up.z * down },
      true,
    );

    // --- Start catch-up boost (rear grid slots) ------------------------------------------
    if (this.assistAccel !== 0 && contactCount >= 2) {
      const imp = cfg.chassis.mass * this.assistAccel * dt;
      body.applyImpulse({ x: this.fwd.x * imp, y: this.fwd.y * imp, z: this.fwd.z * imp }, true);
    }

    // --- Driving assists (configurable per vehicle) ------------------------------------
    const as = cfg.assists;
    const av = body.angvel();
    if ((as.turnAssist > 0 || as.stability > 0) && contactCount >= 2 && forwardSpeed > 2) {
      const iy = boxInertia(cfg.chassis).y;
      const yawRate = av0.x * this.up.x + av0.y * this.up.y + av0.z * this.up.z;
      // Steering right (positive) means a negative yaw rate about +Y.
      let desired = (-forwardSpeed * Math.tan(this.steerAngle)) / cfg.geometry.wheelbase;
      const maxRate = (cfg.tire.friction * PHYSICS_SETTINGS.gravity * 1.1) / Math.max(forwardSpeed, 1);
      desired = clamp(desired, -maxRate, maxRate);
      let torque = as.turnAssist * iy * 5 * (desired - yawRate);
      if (slipExcess > 0) torque -= Math.sign(bodySlip) * as.stability * iy * 9 * slipExcess;
      const k = torque * dt;
      body.applyTorqueImpulse({ x: this.up.x * k, y: this.up.y * k, z: this.up.z * k }, true);
    }
    if (as.yawDamping > 0 && contactCount > 0) {
      const yawRate = av.x * this.up.x + av.y * this.up.y + av.z * this.up.z;
      const k = -yawRate * as.yawDamping * dt;
      body.applyTorqueImpulse({ x: this.up.x * k, y: this.up.y * k, z: this.up.z * k }, true);
    }
    if (as.airControlTorque > 0 && contactCount === 0 && this.inputEnabled) {
      const pitch = (c.throttle - c.brake) * as.airControlTorque * dt;
      const roll = c.steer * as.airControlTorque * 0.6 * dt;
      body.applyTorqueImpulse(
        { x: this.right.x * -pitch + this.fwd.x * -roll, y: this.right.y * -pitch + this.fwd.y * -roll, z: this.right.z * -pitch + this.fwd.z * -roll },
        true,
      );
    }
    if (as.uprightTorque > 0) {
      const upDot = this.up.dot(WORLD_UP);
      if (upDot < 0.5) {
        const axis = tmpV.crossVectors(this.up, WORLD_UP);
        const len = axis.length();
        if (len > 1e-3) {
          axis.multiplyScalar((as.uprightTorque * (1 - upDot) * dt) / len);
          body.applyTorqueImpulse({ x: axis.x, y: axis.y, z: axis.z }, true);
        }
      }
    }

    // Expected velocity if nothing but our impulses and gravity acted (collision detection).
    const lv3 = body.linvel();
    this.expectedVel.set(lv3.x, lv3.y - PHYSICS_SETTINGS.gravity * dt, lv3.z);

    // Telemetry.
    const tel = this.telemetry;
    tel.forwardSpeed = forwardSpeed;
    tel.speed = speed;
    tel.speedKmh = Math.abs(forwardSpeed) * MS_TO_KMH;
    tel.rpm = this.drivetrain.rpm;
    tel.gear = this.drivetrain.gear;
    tel.throttle = pedals.throttle;
    tel.brake = pedals.brake;
    tel.wheelsInContact = contactCount;
    tel.airborne = contactCount === 0;
    tel.airTime = tel.airborne ? tel.airTime + dt : 0;
    tel.maxSlip = maxSlip;
    tel.upDot = this.up.dot(WORLD_UP);
    tel.steerAngle = this.steerAngle;
  }

  postStep(_dt: number): void {
    const lv = this.body.linvel();
    const dv = tmpV.set(lv.x, lv.y, lv.z).sub(this.expectedVel).length();
    this.telemetry.impact = dv;
    const t = this.body.translation();
    if (!Number.isFinite(t.x + t.y + t.z)) {
      // Numerical blow-up guard: restore the last finite pose.
      this.body.setTranslation(this.lastSafe.pos, true);
      this.body.setRotation(this.lastSafe.rot, true);
      this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    } else {
      this.lastSafe.pos.set(t.x, t.y, t.z);
      const r = this.body.rotation();
      this.lastSafe.rot.set(r.x, r.y, r.z, r.w);
    }
    this.syncPoseBuffers(false);
  }

  private applyAntiRoll(li: number, ri: number, rate: number): void {
    if (rate <= 0) return;
    const l = this.wheels[li];
    const r = this.wheels[ri];
    const f = antiRollForce(l.compression, r.compression, rate);
    if (l.inContact) l.suspensionForce = Math.max(0, l.suspensionForce + f);
    if (r.inContact) r.suspensionForce = Math.max(0, r.suspensionForce - f);
  }

  /** Left/right road-wheel angles for a centre steer angle (positive = right). */
  private ackermannAngles(delta: number): { left: number; right: number } {
    const a = this.cfg.steering.ackermann;
    if (Math.abs(delta) < 1e-4 || a <= 0) return { left: delta, right: delta };
    const L = this.cfg.geometry.wheelbase;
    const T = this.cfg.geometry.trackWidth;
    const R = L / Math.tan(Math.abs(delta));
    const inner = Math.atan(L / (R - T / 2));
    const outer = Math.atan(L / (R + T / 2));
    const s = Math.sign(delta);
    const innerA = lerp(Math.abs(delta), inner, a) * s;
    const outerA = lerp(Math.abs(delta), outer, a) * s;
    // Turning right: the right wheel is on the inside.
    return delta > 0 ? { left: outerA, right: innerA } : { left: innerA, right: outerA };
  }

  /** Wheel centre in chassis-local space for rendering (suspension axis = local −Y). */
  wheelLocalCenter(w: WheelState, alpha: number, out: Vector3): Vector3 {
    const len = lerp(w.prevSuspensionLength, w.suspensionLength, alpha);
    return out.set(w.layout.hardpoint.x, w.layout.hardpoint.y - len, w.layout.hardpoint.z);
  }

  get position(): Vector3 {
    return this.currPosition;
  }

  get rotation(): Quaternion {
    return this.currRotation;
  }

  /** Heading (yaw) of the chassis forward axis projected on the ground plane. */
  get heading(): number {
    const f = tmpV.set(0, 0, -1).applyQuaternion(this.currRotation);
    return Math.atan2(-f.x, -f.z);
  }

  forwardVector(out: Vector3): Vector3 {
    return out.set(0, 0, -1).applyQuaternion(this.currRotation);
  }

  upVector(out: Vector3): Vector3 {
    return out.set(0, 1, 0).applyQuaternion(this.currRotation);
  }

  linearVelocity(out: Vector3): Vector3 {
    const v = this.body.linvel();
    return out.set(v.x, v.y, v.z);
  }

  angularVelocity(out: Vector3): Vector3 {
    const v = this.body.angvel();
    return out.set(v.x, v.y, v.z);
  }

  /** World-space centre of mass. */
  centerOfMass(out: Vector3): Vector3 {
    const c = this.body.worldCom();
    return out.set(c.x, c.y, c.z);
  }

  dispose(): void {
    this.physics.remove(this);
    this.physics.world.removeRigidBody(this.body);
  }
}

