import { Color, Quaternion, Vector3 } from 'three';
import type { VehicleInfo } from '../data/vehicles';
import { SURFACES, Surface } from '../physics/Surfaces';
import type { VehiclePhysics } from '../physics/VehiclePhysics';
import { mulberry32 } from '../physics/math';
import type { DustSystem } from './DustSystem';
import { updateLinks } from './VehicleModels';
import type { VehicleModel } from './VehicleModels';

const DUST_COLORS: Partial<Record<Surface, Color>> = {
  [Surface.Dirt]: new Color(0.72, 0.46, 0.3),
  [Surface.Sand]: new Color(0.86, 0.75, 0.55),
  [Surface.Mud]: new Color(0.4, 0.3, 0.2),
};

const tmpV2 = new Vector3();

/**
 * A vehicle in the game: physics (authoritative) + visual model (follows interpolated
 * physics state) + wheel effects.
 */
export class Vehicle {
  readonly renderPosition = new Vector3();
  readonly renderRotation = new Quaternion();
  private readonly rnd = mulberry32(17);
  private dustAcc = 0;

  constructor(
    readonly info: VehicleInfo,
    readonly physics: VehiclePhysics,
    readonly model: VehicleModel,
    private readonly dust: DustSystem | null,
  ) {}

  /** Updates the visual model from the interpolated physics state. */
  syncVisual(alpha: number, frameDt: number): void {
    const ph = this.physics;
    ph.getInterpolatedPose(alpha, this.renderPosition, this.renderRotation);
    this.model.root.position.copy(this.renderPosition);
    this.model.root.quaternion.copy(this.renderRotation);
    ph.wheels.forEach((w, i) => {
      ph.wheelLocalCenter(w, alpha, this.model.wheelPivots[i].position);
      this.model.wheelSteer[i].rotation.y = -w.steerAngle;
      const rot = w.prevRotation + (w.rotation - w.prevRotation) * alpha;
      this.model.wheelSpin[i].rotation.x = -rot;
    });
    if (this.model.steeringWheel) this.model.steeringWheel.rotation.z = -ph.telemetry.steerAngle * 6;
    updateLinks(this.model);
    const braking = ph.telemetry.brake > 0.05 || (ph.controls.handbrake && ph.inputEnabled);
    this.model.brakeLights.emissiveIntensity = braking ? 2.2 : 0.15;
    this.model.reverseLights.emissiveIntensity = ph.telemetry.gear < 0 ? 1.5 : 0;
    this.emitDust(frameDt);
  }

  private emitDust(dt: number): void {
    if (!this.dust || dt <= 0) return;
    const ph = this.physics;
    const speed = ph.telemetry.speed;
    this.dustAcc += dt;
    const interval = 1 / 40;
    if (this.dustAcc < interval) return;
    this.dustAcc = 0;
    for (const w of ph.wheels) {
      if (!w.inContact) continue;
      const surf = SURFACES[w.surface];
      if (!surf.dust) continue;
      const slip = Math.abs(w.vLat) + Math.abs(w.omega * w.layout.radius - w.vLong);
      const intensity = Math.min(1, speed / 25 + slip / 4);
      if (intensity < 0.12 || this.rnd() > intensity) continue;
      const col = DUST_COLORS[w.surface] ?? DUST_COLORS[Surface.Dirt]!;
      ph.linearVelocity(tmpV2).multiplyScalar(0.25);
      const p = w.contactPoint;
      this.dust.emit(
        p.x + (this.rnd() - 0.5) * 0.4,
        p.y + 0.15,
        p.z + (this.rnd() - 0.5) * 0.4,
        tmpV2.x + (this.rnd() - 0.5) * 1.5,
        0.6 + this.rnd() * 1.2,
        tmpV2.z + (this.rnd() - 0.5) * 1.5,
        col,
        0.8 + intensity * 1.4,
        0.7 + intensity * 0.9,
      );
    }
  }

  /** Chassis forward on the ground plane (render pose). */
  renderForward(out: Vector3): Vector3 {
    return out.set(0, 0, -1).applyQuaternion(this.renderRotation);
  }

  dispose(): void {
    this.model.root.removeFromParent();
    this.model.dispose();
    this.physics.dispose();
  }
}

