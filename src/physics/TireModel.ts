import type { TireConfig } from './VehicleConfig';
import { DEG2RAD, smoothstep } from './math';

/** Per-wheel inputs for one fixed physics step. */
export interface TireSolveInput {
  /** Normal load (N). */
  load: number;
  /** Effective peak friction (tyre × surface × load sensitivity). */
  mu: number;
  /** Contact patch velocity along the wheel's rolling direction (m/s). */
  vLong: number;
  /** Contact patch velocity along the wheel's lateral axis (m/s). */
  vLat: number;
  /** Current wheel angular velocity (rad/s, positive = rolling forward). */
  omega: number;
  radius: number;
  /** Effective rotational inertia (wheel + reflected drivetrain). */
  inertia: number;
  /** Drive torque on this wheel (signed). */
  driveTorque: number;
  /** Brake torque magnitude (always opposes rotation). */
  brakeTorque: number;
  /** Lateral grip multiplier (rear balance, handbrake). */
  lateralScale: number;
  /**
   * Upper bound on the linearised force/velocity coefficient (N per m/s) so that a single
   * step can never more than cancel the contact velocity (keeps explicit coupling stable).
   */
  maxDampingCoef: number;
  dt: number;
}

export interface TireSolveOutput {
  fx: number;
  fy: number;
  omega: number;
  slipRatio: number;
  slipAngle: number;
  /** 0 = full grip, 1 = fully saturated (friction circle reached). */
  saturation: number;
  locked: boolean;
}

/**
 * Tyre model interface. The vehicle only depends on this, so a full Pacejka or brush model
 * can replace `SimpleTireModel` without touching the chassis/suspension code.
 */
export interface TireModel {
  solve(input: TireSolveInput, cfg: TireConfig, out: TireSolveOutput): void;
}

/** Normalised lateral curve: smooth rise to 1 at x=1, then falls to `slide` by x=3. */
export function lateralCurve(x: number, slide: number): number {
  const ax = Math.abs(x);
  if (ax <= 1) return ax * (2 - ax);
  return 1 - (1 - slide) * smoothstep(1, 3, ax);
}

/** Normalised longitudinal curve beyond the linear region: 1 at peak, falls to `slide` by 4×peak. */
export function longitudinalSlideCurve(x: number, slide: number): number {
  const ax = Math.abs(x);
  if (ax <= 1) return 1;
  return 1 - (1 - slide) * smoothstep(1, 4, ax);
}

/**
 * Simplified physically based tyre:
 * - Longitudinal: linear slip-velocity stiffness up to the peak slip ratio, solved
 *   implicitly together with the wheel spin ODE (stable at any wheel inertia), then
 *   saturating with a falloff into sliding friction.
 * - Lateral: slip-angle based curve with a peak and falloff.
 * - Combined: friction ellipse; when saturated, wheel spin is re-integrated with the
 *   reduced longitudinal force so power-on oversteer and lock-ups emerge naturally.
 */
export class SimpleTireModel implements TireModel {
  solve(i: TireSolveInput, cfg: TireConfig, out: TireSolveOutput): void {
    const { load, mu, vLong, vLat, radius: r, inertia: I, dt } = i;
    const vRef = Math.max(Math.abs(vLong), cfg.lowSpeedRef);
    const fMaxX = mu * load * cfg.longitudinalScale;
    const fMaxY = mu * load * i.lateralScale;

    // --- Longitudinal: implicit wheel + linear tyre ---------------------------------
    let cx = fMaxX / (cfg.peakSlipRatio * vRef); // N per (m/s) of slip velocity
    if (cx > i.maxDampingCoef) cx = i.maxDampingCoef;

    const freeOmega = (I * i.omega + dt * (i.driveTorque + r * cx * vLong)) / (I + dt * r * r * cx);
    const dir = Math.abs(freeOmega) > 1e-4 ? Math.sign(freeOmega) : Math.sign(i.omega) || Math.sign(vLong) || 1;
    let omega = (I * i.omega + dt * (i.driveTorque - i.brakeTorque * dir + r * cx * vLong)) / (I + dt * r * r * cx);
    let locked = false;
    if (i.brakeTorque > 0 && Math.sign(omega) !== dir && omega !== 0) {
      omega = 0;
      locked = true;
    }
    let fx = cx * (omega * r - vLong);

    if (Math.abs(fx) > fMaxX) {
      // Sliding regime: bounded force, explicit spin integration is stable.
      const slip = (i.omega * r - vLong) / vRef;
      const sgn = Math.sign(omega * r - vLong) || Math.sign(slip) || 1;
      fx = sgn * fMaxX * longitudinalSlideCurve(slip / cfg.peakSlipRatio, cfg.slideFriction);
      omega = this.integrateExplicit(i, fx, i.omega);
      locked = omega === 0 && i.brakeTorque > 0;
    }

    // --- Lateral -------------------------------------------------------------------
    const slipAngle = Math.atan2(vLat, vRef);
    const peakAngle = cfg.peakSlipAngleDeg * DEG2RAD;
    let fy = -Math.sign(vLat) * fMaxY * lateralCurve(slipAngle / peakAngle, cfg.slideFriction);
    const fyCap = i.maxDampingCoef * Math.abs(vLat);
    if (Math.abs(fy) > fyCap) fy = Math.sign(fy) * fyCap;

    // --- Combined slip (friction ellipse) -------------------------------------------
    let saturation = 0;
    if (fMaxX > 0 && fMaxY > 0) {
      const ex = fx / fMaxX;
      const ey = fy / fMaxY;
      const e = Math.sqrt(ex * ex + ey * ey);
      saturation = Math.min(1, e);
      if (e > 1) {
        fx /= e;
        fy /= e;
        omega = this.integrateExplicit(i, fx, i.omega);
        if (locked) omega = 0;
      }
    }

    out.fx = fx;
    out.fy = fy;
    out.omega = omega;
    out.slipRatio = (omega * r - vLong) / vRef;
    out.slipAngle = slipAngle;
    out.saturation = saturation;
    out.locked = locked;
  }

  /** ω' = ω + dt (T_drive − T_brake·sgn(ω) − r·Fx) / I, with brakes unable to reverse spin. */
  private integrateExplicit(i: TireSolveInput, fx: number, omega0: number): number {
    const noBrake = omega0 + (i.dt * (i.driveTorque - i.radius * fx)) / i.inertia;
    if (i.brakeTorque <= 0) return noBrake;
    const dir = Math.sign(noBrake) || 1;
    const withBrake = noBrake - (i.dt * i.brakeTorque * dir) / i.inertia;
    return Math.sign(withBrake) !== dir ? 0 : withBrake;
  }
}

export function createTireOutput(): TireSolveOutput {
  return { fx: 0, fy: 0, omega: 0, slipRatio: 0, slipAngle: 0, saturation: 0, locked: false };
}
