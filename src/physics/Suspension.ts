import type { SuspensionConfig } from './VehicleConfig';

/**
 * Spring + damper force for one wheel, along the suspension axis.
 *
 * @param compression  restLength − currentLength (m). ≥ 0 while in contact.
 * @param compressionVelocity  d(compression)/dt (m/s), positive while compressing.
 * @param stiffnessScale  per-axle spring multiplier.
 * @returns force (N) pushing the chassis away from the ground, never negative (tyres can't pull).
 */
export function suspensionForce(
  compression: number,
  compressionVelocity: number,
  cfg: SuspensionConfig,
  stiffnessScale = 1,
): number {
  if (compression <= 0) return 0;
  let f = cfg.stiffness * stiffnessScale * compression;
  if (compression > cfg.travel) {
    f += cfg.bumpStopStiffness * (compression - cfg.travel);
  }
  const c = compressionVelocity > 0 ? cfg.compressionDamping : cfg.reboundDamping;
  f += c * compressionVelocity;
  if (f < 0) return 0;
  return f > cfg.maxForce ? cfg.maxForce : f;
}

/** Anti-roll bar force for an axle: positive adds load to the left wheel, removes from the right. */
export function antiRollForce(compressionLeft: number, compressionRight: number, rate: number): number {
  return (compressionLeft - compressionRight) * rate;
}

/** Natural frequency (Hz) and damping ratios for a corner, useful for tuning reports. */
export function suspensionCharacteristics(cfg: SuspensionConfig, cornerMass: number, stiffnessScale = 1) {
  const k = cfg.stiffness * stiffnessScale;
  const omega = Math.sqrt(k / cornerMass);
  const critical = 2 * Math.sqrt(k * cornerMass);
  return {
    frequencyHz: omega / (2 * Math.PI),
    compressionRatio: cfg.compressionDamping / critical,
    reboundRatio: cfg.reboundDamping / critical,
    staticSag: (cornerMass * 9.81) / k,
  };
}
