import type { EngineConfig, TransmissionConfig } from './VehicleConfig';
import { torqueAt } from './VehicleConfig';
import { RADS_TO_RPM, clamp } from './math';

export interface PedalState {
  /** 0..1 engine throttle after direction logic. */
  throttle: number;
  /** 0..1 service brake after direction logic. */
  brake: number;
}

/**
 * Engine + automatic gearbox.
 * gear: −1 = reverse, 1..n = forward gears. (There is no neutral during normal driving.)
 */
export class Drivetrain {
  gear = 1;
  rpm: number;
  private shiftTimer = 0;
  private reverseTimer = 0;
  /** Time since the last gear change (prevents hunting). */
  private gearTime = 0;
  /** Minimum time between automatic shifts (s). */
  static readonly MIN_GEAR_TIME = 0.6;
  /** Crank torque produced on the last update (for audio/telemetry). */
  engineTorque = 0;
  /** Throttle actually applied on the last update. */
  throttle = 0;

  constructor(
    public engine: EngineConfig,
    public trans: TransmissionConfig,
  ) {
    this.rpm = engine.idleRPM;
  }

  reset(): void {
    this.gear = 1;
    this.rpm = this.engine.idleRPM;
    this.shiftTimer = 0;
    this.reverseTimer = 0;
    this.gearTime = 0;
    this.engineTorque = 0;
    this.throttle = 0;
  }

  get isShifting(): boolean {
    return this.shiftTimer > 0;
  }

  /** Total ratio between crank and wheel (signed; negative in reverse). */
  get ratio(): number {
    const g = this.gear < 0 ? -this.trans.reverseRatio : this.trans.gears[this.gear - 1];
    return g * this.trans.finalDrive;
  }

  /**
   * Maps the player's accelerate/brake keys to throttle/brake taking the current direction
   * into account. Holding brake at (near) standstill selects reverse; holding accelerate
   * while reversing slowly selects drive again.
   */
  mapPedals(accelerate: number, brakeKey: number, forwardSpeed: number, dt: number): PedalState {
    const standstill = 0.8; // m/s
    if (this.gear > 0) {
      if (brakeKey > 0.1 && accelerate < 0.1 && forwardSpeed < standstill) {
        this.reverseTimer += dt;
        if (this.reverseTimer > 0.25) {
          this.gear = -1;
          this.reverseTimer = 0;
        }
      } else {
        this.reverseTimer = 0;
      }
    } else if (accelerate > 0.1 && brakeKey < 0.1 && forwardSpeed > -standstill) {
      this.reverseTimer += dt;
      if (this.reverseTimer > 0.1) {
        this.gear = 1;
        this.reverseTimer = 0;
      }
    } else {
      this.reverseTimer = 0;
    }
    return this.gear > 0 ? { throttle: accelerate, brake: brakeKey } : { throttle: brakeKey, brake: accelerate };
  }

  /**
   * Advances the engine/gearbox one step.
   * @param throttle 0..1
   * @param drivenOmega mean angular velocity of driven wheels (rad/s, + = forward)
   * @param grounded whether any driven wheel touches the ground (no shifts while airborne)
   * @param roadOmega wheel angular velocity implied by the vehicle's ground speed (rad/s);
   *        shift points use it so wheelspin does not cause gear hunting.
   * @returns total drive torque at the wheels (signed, N·m), to be split over driven wheels.
   */
  update(throttle: number, drivenOmega: number, grounded: boolean, dt: number, roadOmega = drivenOmega): number {
    const e = this.engine;
    const t = this.trans;
    const ratio = this.ratio;
    const wheelRpm = drivenOmega * ratio * RADS_TO_RPM; // + when turning the "right" way for this gear
    const shiftRpm = Math.min(wheelRpm, roadOmega * ratio * RADS_TO_RPM);

    if (this.shiftTimer > 0) this.shiftTimer = Math.max(0, this.shiftTimer - dt);
    this.gearTime += dt;

    // Automatic shifting (forward gears only). Upshift once past upshiftRPM if the next
    // gear delivers at least as much wheel torque (or at the limiter); downshift below
    // downshiftRPM or on full-throttle kick-down when the lower gear is clearly stronger.
    if (this.gear > 0 && this.shiftTimer === 0 && grounded && this.gearTime > Drivetrain.MIN_GEAR_TIME) {
      const gi = this.gear - 1;
      const g = t.gears;
      const wheelTq = (gear: number, rpm: number) => torqueAt(e.torqueCurve, rpm) * g[gear];
      if (this.gear < g.length && shiftRpm > t.upshiftRPM) {
        const rpmNext = shiftRpm * (g[gi + 1] / g[gi]);
        if (wheelRpm > e.maxRPM * 0.97 || wheelTq(gi + 1, rpmNext) >= wheelTq(gi, shiftRpm)) {
          this.gear++;
          this.shiftTimer = t.shiftTime;
          this.gearTime = 0;
        }
      } else if (this.gear > 1) {
        const rpmPrev = shiftRpm * (g[gi - 1] / g[gi]);
        const kickdown = throttle > 0.9 && rpmPrev < t.upshiftRPM * 0.92 && wheelTq(gi - 1, rpmPrev) > wheelTq(gi, shiftRpm) * 1.2;
        if (shiftRpm < t.downshiftRPM || kickdown) {
          this.gear--;
          this.shiftTimer = t.shiftTime * 0.6;
          this.gearTime = 0;
        }
      }
    }

    // Clutch model: below launch RPM the clutch slips and holds the engine at a
    // throttle-dependent RPM; above it the engine is locked to the wheels.
    const launch = e.idleRPM + (e.launchRPM - e.idleRPM) * throttle;
    const targetRpm = Math.max(wheelRpm, throttle > 0.01 ? launch : e.idleRPM);
    // Engine RPM follows with a short lag (flywheel); free-revving when clutch is open.
    const follow = this.shiftTimer > 0 ? 6 : 25;
    this.rpm += (clamp(targetRpm, e.idleRPM * 0.9, e.maxRPM * 1.02) - this.rpm) * Math.min(1, follow * dt);

    let crank: number;
    if (throttle > 0.01) {
      crank = this.rpm >= e.maxRPM ? 0 : throttle * torqueAt(e.torqueCurve, this.rpm);
    } else if (wheelRpm > e.idleRPM) {
      const k = (wheelRpm - e.idleRPM) / (e.maxRPM - e.idleRPM);
      crank = -e.engineBrakeTorque * clamp(k, 0, 1.2);
    } else {
      crank = 0;
    }
    if (this.shiftTimer > 0) crank = 0;
    this.engineTorque = crank;
    this.throttle = throttle;
    return crank * ratio * t.efficiency;
  }

  /** Engine inertia reflected to the wheels (sum over all driven wheels), 0 while shifting. */
  reflectedInertia(): number {
    if (this.shiftTimer > 0) return 0;
    const r = this.ratio;
    return this.engine.inertia * r * r;
  }
}
