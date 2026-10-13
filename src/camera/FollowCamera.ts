import { MathUtils, Vector3 } from 'three';
import type { PerspectiveCamera, Quaternion } from 'three';
import { clamp, dampFactor } from '../physics/math';

/** Camera tuning (all modes). */
export interface CameraTuning {
  fov: number;
  /** Extra FOV at 40 m/s (subtle; 0 disables). */
  speedFov: number;
  distance: number;
  height: number;
  /** Look target height above the chassis origin. */
  lookHeight: number;
  /** Seconds of horizontal velocity added to the look target (look-ahead). */
  lookAheadTime: number;
  maxLookAhead: number;
  /** Heading follow sharpness (1/s) on the ground and in the air. */
  yawSharpness: number;
  airYawSharpness: number;
  /** Vertical follow sharpness (1/s): absorbs suspension bounce. */
  heightSharpness: number;
  /** Minimum clearance above terrain (m). */
  groundClearance: number;
  /** How fast the camera recovers distance after an occlusion (1/s). */
  occlusionRecover: number;
}

export const CAMERA_MODES: Array<{ name: string; tuning: Partial<CameraTuning>; hood?: boolean }> = [
  { name: 'Yakın takip', tuning: {} },
  { name: 'Uzak takip', tuning: { distance: 9.5, height: 3.8, lookHeight: 1.2 } },
  { name: 'Kaput', tuning: { fov: 70 }, hood: true },
];

export const DEFAULT_CAMERA: CameraTuning = {
  fov: 60,
  speedFov: 3,
  distance: 7.0,
  height: 2.8,
  lookHeight: 1.0,
  lookAheadTime: 0.12,
  maxLookAhead: 3.5,
  yawSharpness: 6,
  airYawSharpness: 1.8,
  heightSharpness: 7,
  groundClearance: 0.9,
  occlusionRecover: 3,
};

export interface CameraEnvironment {
  heightAt(x: number, z: number): number;
  /** Distance along from→to to the first static obstacle, or null. */
  occlusion(from: Vector3, to: Vector3): number | null;
}

export interface CameraTarget {
  position: Vector3;
  rotation: Quaternion;
  velocity: Vector3;
  airborne: boolean;
  speed: number;
}

const tmpF = new Vector3();
const tmpL = new Vector3();
const tmpD = new Vector3();

function angleDiff(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/**
 * Third-person follow camera driven by the (interpolated) physical vehicle state. It is
 * never parented to the chassis: heading is smoothed, height is smoothed, but the camera
 * keeps a fixed distance behind the car so it does not lag at speed.
 */
export class FollowCamera {
  tuning: CameraTuning = { ...DEFAULT_CAMERA };
  mode = 0;
  private yaw = 0;
  private camY = 0;
  private distScale = 1;
  private initialised = false;
  private readonly look = new Vector3();

  constructor(private readonly camera: PerspectiveCamera, private readonly env: CameraEnvironment) {}

  setMode(mode: number): void {
    this.mode = ((mode % CAMERA_MODES.length) + CAMERA_MODES.length) % CAMERA_MODES.length;
    this.tuning = { ...DEFAULT_CAMERA, ...CAMERA_MODES[this.mode].tuning };
    this.camera.fov = this.tuning.fov;
    this.camera.updateProjectionMatrix();
  }

  /** Snap behind the car (after reset/restart). */
  snap(target: CameraTarget): void {
    this.initialised = false;
    this.update(target, 0);
  }

  update(target: CameraTarget, dt: number): void {
    const t = this.tuning;
    tmpF.set(0, 0, -1).applyQuaternion(target.rotation);
    const carYaw = Math.atan2(-tmpF.x, -tmpF.z);

    if (CAMERA_MODES[this.mode].hood) {
      tmpL.set(0, 1.35, -0.35).applyQuaternion(target.rotation).add(target.position);
      this.camera.position.copy(tmpL);
      tmpD.copy(tmpF).multiplyScalar(20).add(tmpL);
      tmpD.y = tmpL.y + tmpF.y * 20 - 0.6;
      this.camera.lookAt(tmpD);
      this.initialised = false;
      return;
    }

    if (!this.initialised) {
      this.yaw = carYaw;
      this.camY = target.position.y + t.height;
      this.distScale = 1;
      this.initialised = true;
    } else {
      const k = dampFactor(target.airborne ? t.airYawSharpness : t.yawSharpness, dt);
      this.yaw += angleDiff(carYaw, this.yaw) * k;
    }

    // Look target: slightly ahead along the horizontal velocity.
    const vx = target.velocity.x * t.lookAheadTime;
    const vz = target.velocity.z * t.lookAheadTime;
    const la = Math.hypot(vx, vz);
    const laScale = la > t.maxLookAhead ? t.maxLookAhead / la : 1;
    this.look.set(target.position.x + vx * laScale, target.position.y + t.lookHeight, target.position.z + vz * laScale);

    const backX = Math.sin(this.yaw);
    const backZ = Math.cos(this.yaw);
    const desiredY = target.position.y + t.height;
    this.camY += (desiredY - this.camY) * (dt > 0 ? dampFactor(t.heightSharpness, dt) : 1);

    // Occlusion: pull in towards the car if terrain/obstacles block the view.
    const full = tmpD.set(target.position.x + backX * t.distance, this.camY, target.position.z + backZ * t.distance);
    const hit = this.env.occlusion(this.look, full);
    const fullLen = this.look.distanceTo(full);
    const wanted = hit !== null ? clamp((hit - 0.4) / fullLen, 0.25, 1) : 1;
    if (wanted < this.distScale || dt === 0) this.distScale = wanted;
    else this.distScale += (wanted - this.distScale) * dampFactor(t.occlusionRecover, dt);

    const d = t.distance * this.distScale;
    let cx = target.position.x + backX * d;
    let cz = target.position.z + backZ * d;
    let cy = this.camY;
    const ground = this.env.heightAt(cx, cz) + t.groundClearance;
    if (cy < ground) {
      cy = ground;
      this.camY = Math.max(this.camY, ground);
    }
    if (!Number.isFinite(cx + cy + cz)) {
      cx = target.position.x;
      cy = target.position.y + 3;
      cz = target.position.z + 6;
    }
    this.camera.position.set(cx, cy, cz);
    this.camera.lookAt(this.look);

    const targetFov = t.fov + t.speedFov * clamp(target.speed / 40, 0, 1);
    if (Math.abs(this.camera.fov - targetFov) > 0.05) {
      this.camera.fov = MathUtils.lerp(this.camera.fov, targetFov, dt > 0 ? dampFactor(3, dt) : 1);
      this.camera.updateProjectionMatrix();
    }
  }
}
