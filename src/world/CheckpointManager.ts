import type { Gate } from './TrackBuilder';

export interface XZ {
  x: number;
  z: number;
}

export type CrossDirection = 'forward' | 'backward';

/**
 * Detects whether the segment prev→curr crossed a gate line. The gate is a line through
 * (x,z) perpendicular to its direction (tx,tz), limited to ±halfWidth.
 */
export function crossGate(gate: Gate, prev: XZ, curr: XZ): CrossDirection | null {
  const d0 = (prev.x - gate.x) * gate.tx + (prev.z - gate.z) * gate.tz;
  const d1 = (curr.x - gate.x) * gate.tx + (curr.z - gate.z) * gate.tz;
  if ((d0 < 0 && d1 < 0) || (d0 > 0 && d1 > 0) || d0 === d1) return null;
  const t = d0 / (d0 - d1);
  const ix = prev.x + (curr.x - prev.x) * t;
  const iz = prev.z + (curr.z - prev.z) * t;
  // Lateral offset along the gate line (right vector = (-tz, tx)).
  const lateral = (ix - gate.x) * -gate.tz + (iz - gate.z) * gate.tx;
  if (Math.abs(lateral) > gate.halfWidth) return null;
  if (d0 <= 0 && d1 > 0) return 'forward';
  if (d0 >= 0 && d1 < 0) return 'backward';
  return null;
}
