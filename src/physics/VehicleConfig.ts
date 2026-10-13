/**
 * Centralised vehicle parameter schema.
 *
 * Coordinate convention (chassis local space): +X = right, +Y = up, −Z = forward.
 * The chassis rigid-body origin sits at the centre of the wheelbase/track rectangle at the
 * height of the suspension hardpoints minus `hardpointHeight`.
 *
 * All values are SI units (kg, m, s, N, N·m, rad) unless a field name says otherwise.
 * The parameter values for the four cars live in `src/data/vehicles.ts` and are design
 * approximations.
 */

export type DrivetrainLayout = 'RWD' | 'FWD' | 'AWD';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface TorquePoint {
  rpm: number;
  torque: number;
}

export interface ChassisConfig {
  mass: number;
  /** Centre of mass relative to the chassis origin. */
  centerOfMass: Vec3;
  /** Box used to derive principal inertia (full dimensions w,h,l). */
  inertiaBox: Vec3;
  /** Multiplier on the derived principal inertia (x = pitch axis... per local axis). */
  inertiaScale: Vec3;
  /** Collision box half-extents and offset relative to chassis origin. */
  colliderHalfExtents: Vec3;
  colliderOffset: Vec3;
  /** Upper body/cabin collision box (optional). */
  cabinHalfExtents: Vec3 | null;
  cabinOffset: Vec3;
  colliderFriction: number;
  colliderRestitution: number;
  /** Tiny numerical damping; real damping comes from tyres/suspension/aero. */
  linearDamping: number;
  angularDamping: number;
}

export interface GeometryConfig {
  wheelbase: number;
  /** Track width measured between wheel centre planes. */
  trackWidth: number;
  /** Rear track override (0 = same as front). */
  rearTrackWidth: number;
  /** Height of the suspension top mount relative to chassis origin. */
  hardpointHeight: number;
  wheelRadius: number;
  /** Optional larger rear wheels (0 = same as front). */
  rearWheelRadius: number;
  wheelWidth: number;
  /** Rotational inertia of one wheel + hub + brake (kg·m²). */
  wheelInertia: number;
}

export interface SuspensionConfig {
  /** Spring length at zero force (fully extended). */
  restLength: number;
  /** Usable compression travel before the bump stop. */
  travel: number;
  /** Spring rate per wheel (N/m). */
  stiffness: number;
  /** Rear spring rate multiplier (balance). */
  rearStiffnessScale: number;
  /** Damping while compressing (N per m/s). */
  compressionDamping: number;
  /** Damping while extending (N per m/s). */
  reboundDamping: number;
  /** Extra stiffness once travel is exceeded. */
  bumpStopStiffness: number;
  /** Anti-roll bar rate per axle (N/m of compression difference). */
  antiRollFront: number;
  antiRollRear: number;
  /** Max suspension force per wheel (safety clamp against numeric spikes). */
  maxForce: number;
  /**
   * Where tyre forces act, as a stand-in for the suspension roll centre: 1 = at the contact
   * patch, 0 = at centre-of-mass height. The usual raycast-vehicle "roll influence" parameter.
   */
  rollInfluence: number;
}

export interface TireConfig {
  /** Peak friction coefficient on the reference surface (dirt). */
  friction: number;
  /** Slip ratio at which longitudinal force peaks. */
  peakSlipRatio: number;
  /** Slip angle (degrees) at which lateral force peaks. */
  peakSlipAngleDeg: number;
  /** Fraction of peak force left when fully sliding. */
  slideFriction: number;
  /** Speed below which slip is computed against this reference speed (m/s). */
  lowSpeedRef: number;
  /** Rear lateral grip multiplier (balance tuning). */
  rearLateralScale: number;
  /** Longitudinal vs lateral friction ellipse ratio. */
  longitudinalScale: number;
  /** Load sensitivity: effective mu drops as load rises above nominal (0 = none). */
  loadSensitivity: number;
}

export interface SteeringConfig {
  maxAngleDeg: number;
  /** Steering rate toward input (deg/s). */
  rateDegPerSec: number;
  /** Steering rate when returning to centre (deg/s). */
  returnRateDegPerSec: number;
  /**
   * Speed-dependent steering limit: at `highSpeedRef` (m/s) the available lock is
   * multiplied by `highSpeedFactor`. Input filter only; turning still comes from tyre forces.
   */
  highSpeedRef: number;
  highSpeedFactor: number;
  /** 0 = parallel steer, 1 = full Ackermann. */
  ackermann: number;
}

export interface EngineConfig {
  idleRPM: number;
  maxRPM: number;
  /** Torque (N·m) at full throttle vs RPM, ascending RPM. */
  torqueCurve: TorquePoint[];
  /** Engine braking torque at max RPM with zero throttle (N·m, at the crank). */
  engineBrakeTorque: number;
  /** Crank-side rotating inertia (kg·m²), reflected to driven wheels through the gearing. */
  inertia: number;
  /** Engine RPM held by the slipping clutch when launching. */
  launchRPM: number;
}

export interface TransmissionConfig {
  layout: DrivetrainLayout;
  /** AWD only: fraction of drive torque to the front axle. */
  frontSplit: number;
  /** Forward gear ratios (1st first). */
  gears: number[];
  reverseRatio: number;
  finalDrive: number;
  efficiency: number;
  upshiftRPM: number;
  downshiftRPM: number;
  /** Seconds of torque interruption during a shift. */
  shiftTime: number;
}

export interface BrakeConfig {
  /** Max total brake torque across all wheels (N·m). */
  maxTorque: number;
  /** Fraction of brake torque on the front axle. */
  frontBias: number;
  /** Handbrake torque on each rear wheel (N·m). */
  handbrakeTorque: number;
  /** Rear lateral grip multiplier while handbrake is held. */
  handbrakeRearGrip: number;
  /** Simple anti-lock modulation of the service brake (not the handbrake). */
  abs: boolean;
}

export interface AeroConfig {
  /** 0.5·ρ·Cd·A (N per (m/s)²). */
  dragFactor: number;
  /** Downforce N per (m/s)². */
  downforceFactor: number;
}

/** Optional driving aids. All default to off/subtle; the physics validation runs with them off. */
export interface AssistConfig {
  /** Self-righting torque when upside down / heavily rolled (N·m). 0 disables. */
  uprightTorque: number;
  /** Player pitch/roll torque while airborne (N·m). 0 disables. */
  airControlTorque: number;
  /** Extra yaw damping (N·m per rad/s) applied only while grounded. 0 disables. */
  yawDamping: number;
  /**
   * Traction control strength 0..1: drive torque is trimmed while driven wheels spin past
   * the tyre's peak slip ratio (keyboard throttle is on/off). 0 disables.
   */
  tractionControl: number;
  /**
   * Yaw-rate assist 0..1: adds yaw torque toward the yaw rate the steering asks for
   * (kinematic bicycle model, capped by available grip). Makes keyboard steering responsive.
   */
  turnAssist: number;
  /**
   * Stability control 0..1: counter-yaw torque and throttle cut when the body slip angle
   * exceeds `stabilitySlipDeg`, so the car recovers instead of spinning.
   */
  stability: number;
  stabilitySlipDeg: number;
}

export interface TurboConfig {
  /** Drive-force multiplier while a turbo pickup is active. */
  multiplier: number;
}

export interface VehicleConfig {
  id: string;
  name: string;
  chassis: ChassisConfig;
  geometry: GeometryConfig;
  suspension: SuspensionConfig;
  tire: TireConfig;
  steering: SteeringConfig;
  engine: EngineConfig;
  transmission: TransmissionConfig;
  brakes: BrakeConfig;
  aero: AeroConfig;
  assists: AssistConfig;
  turbo: TurboConfig;
}

export interface WheelLayout {
  index: number;
  /** Hardpoint (suspension top mount) in chassis local space. */
  hardpoint: Vec3;
  front: boolean;
  left: boolean;
  steerable: boolean;
  driven: boolean;
  radius: number;
}

export const WHEEL_NAMES = ['FL', 'FR', 'RL', 'RR'] as const;

/** Builds the four-wheel layout from the configuration. Order: FL, FR, RL, RR. */
export function buildWheelLayout(cfg: VehicleConfig): WheelLayout[] {
  const g = cfg.geometry;
  const layout = cfg.transmission.layout;
  const halfWb = g.wheelbase / 2;
  const rearTrack = g.rearTrackWidth > 0 ? g.rearTrackWidth : g.trackWidth;
  const rearRadius = g.rearWheelRadius > 0 ? g.rearWheelRadius : g.wheelRadius;
  const defs: Array<[boolean, boolean]> = [
    [true, true],
    [true, false],
    [false, true],
    [false, false],
  ];
  return defs.map(([front, left], index) => {
    const track = front ? g.trackWidth : rearTrack;
    return {
      index,
      hardpoint: { x: (left ? -1 : 1) * track * 0.5, y: g.hardpointHeight, z: front ? -halfWb : halfWb },
      front,
      left,
      steerable: front,
      driven: layout === 'AWD' || (layout === 'FWD' ? front : !front),
      radius: front ? g.wheelRadius : rearRadius,
    };
  });
}

/** Principal inertia of a solid box (x = width, y = height, z = length), scaled. */
export function boxInertia(cfg: ChassisConfig): Vec3 {
  const { x: w, y: h, z: l } = cfg.inertiaBox;
  const m = cfg.mass;
  return {
    x: (m / 12) * (h * h + l * l) * cfg.inertiaScale.x,
    y: (m / 12) * (w * w + l * l) * cfg.inertiaScale.y,
    z: (m / 12) * (w * w + h * h) * cfg.inertiaScale.z,
  };
}

/** Engine torque at full throttle for a given RPM (linear interpolation on the curve). */
export function torqueAt(curve: TorquePoint[], rpm: number): number {
  if (curve.length === 0) return 0;
  if (rpm <= curve[0].rpm) return curve[0].torque;
  for (let i = 1; i < curve.length; i++) {
    const a = curve[i - 1];
    const b = curve[i];
    if (rpm <= b.rpm) {
      const t = (rpm - a.rpm) / (b.rpm - a.rpm);
      return a.torque + (b.torque - a.torque) * t;
    }
  }
  return curve[curve.length - 1].torque;
}

/** Returns a list of human-readable problems; empty means the config is usable. */
export function validateVehicleConfig(cfg: VehicleConfig): string[] {
  const errs: string[] = [];
  const pos = (v: number, name: string) => {
    if (!(Number.isFinite(v) && v > 0)) errs.push(`${name} must be > 0 (got ${v})`);
  };
  const frac = (v: number, name: string) => {
    if (!(Number.isFinite(v) && v >= 0 && v <= 1)) errs.push(`${name} must be within [0,1] (got ${v})`);
  };
  pos(cfg.chassis.mass, 'chassis.mass');
  pos(cfg.geometry.wheelbase, 'geometry.wheelbase');
  pos(cfg.geometry.trackWidth, 'geometry.trackWidth');
  pos(cfg.geometry.wheelRadius, 'geometry.wheelRadius');
  pos(cfg.geometry.wheelInertia, 'geometry.wheelInertia');
  pos(cfg.suspension.restLength, 'suspension.restLength');
  pos(cfg.suspension.travel, 'suspension.travel');
  pos(cfg.suspension.stiffness, 'suspension.stiffness');
  pos(cfg.tire.friction, 'tire.friction');
  pos(cfg.tire.peakSlipRatio, 'tire.peakSlipRatio');
  pos(cfg.tire.peakSlipAngleDeg, 'tire.peakSlipAngleDeg');
  pos(cfg.tire.lowSpeedRef, 'tire.lowSpeedRef');
  frac(cfg.tire.slideFriction, 'tire.slideFriction');
  frac(cfg.brakes.frontBias, 'brakes.frontBias');
  frac(cfg.transmission.frontSplit, 'transmission.frontSplit');
  frac(cfg.transmission.efficiency, 'transmission.efficiency');
  frac(cfg.steering.ackermann, 'steering.ackermann');
  frac(cfg.suspension.rollInfluence, 'suspension.rollInfluence');
  if (cfg.suspension.travel > cfg.suspension.restLength) {
    errs.push('suspension.travel must not exceed suspension.restLength');
  }
  if (cfg.suspension.compressionDamping < 0 || cfg.suspension.reboundDamping < 0) {
    errs.push('suspension damping must be >= 0');
  }
  if (cfg.transmission.gears.length === 0) errs.push('transmission.gears must not be empty');
  for (let i = 1; i < cfg.transmission.gears.length; i++) {
    if (cfg.transmission.gears[i] >= cfg.transmission.gears[i - 1]) {
      errs.push('transmission.gears must be strictly descending');
      break;
    }
  }
  if (cfg.transmission.gears.some((g) => !(g > 0))) errs.push('transmission.gears must be > 0');
  if (cfg.transmission.upshiftRPM > cfg.engine.maxRPM) errs.push('upshiftRPM must be <= engine.maxRPM');
  if (cfg.transmission.downshiftRPM >= cfg.transmission.upshiftRPM) {
    errs.push('downshiftRPM must be < upshiftRPM');
  }
  // Downshift must not immediately re-trigger after an upshift (gear hunting).
  const gears = cfg.transmission.gears;
  for (let i = 0; i < gears.length - 1; i++) {
    const rpmAfterUpshift = cfg.transmission.upshiftRPM * (gears[i + 1] / gears[i]);
    if (rpmAfterUpshift <= cfg.transmission.downshiftRPM) {
      errs.push(`gear ${i + 1}->${i + 2}: rpm after upshift (${rpmAfterUpshift.toFixed(0)}) <= downshiftRPM`);
    }
  }
  const curve = cfg.engine.torqueCurve;
  if (curve.length < 2) errs.push('engine.torqueCurve needs at least 2 points');
  for (let i = 1; i < curve.length; i++) {
    if (curve[i].rpm <= curve[i - 1].rpm) {
      errs.push('engine.torqueCurve rpm must be ascending');
      break;
    }
  }
  if (cfg.engine.idleRPM >= cfg.engine.maxRPM) errs.push('engine.idleRPM must be < maxRPM');
  // Static sag sanity: the car must be able to hold itself up within travel.
  const cornerLoad = (cfg.chassis.mass * 9.81) / 4;
  const sag = cornerLoad / cfg.suspension.stiffness;
  if (sag > cfg.suspension.travel * 0.9) {
    errs.push(`static sag ${sag.toFixed(3)} m exceeds 90% of travel; springs too soft`);
  }
  return errs;
}

/** Deep-clones a config so tuning one instance does not affect others. */
export function cloneVehicleConfig(cfg: VehicleConfig): VehicleConfig {
  return JSON.parse(JSON.stringify(cfg)) as VehicleConfig;
}
