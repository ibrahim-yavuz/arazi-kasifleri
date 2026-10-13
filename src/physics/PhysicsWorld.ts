import RAPIER from '@dimforge/rapier3d-compat';

export type Rapier = typeof RAPIER;

/** Global physics settings (single source of truth for timestep/gravity). */
export const PHYSICS_SETTINGS = {
  fixedDt: 1 / 60,
  gravity: 9.81,
  /** Max fixed steps per rendered frame before dropping time (spiral-of-death guard). */
  maxStepsPerFrame: 8,
  /** Max real time accumulated per frame (s), e.g. after a suspended tab. */
  maxFrameTime: 0.25,
  solverIterations: 6,
};

/** Collision groups (16-bit membership << 16 | 16-bit filter). */
export const GROUP_STATIC = 0x0001;
export const GROUP_VEHICLE = 0x0002;
export const GROUP_PROP = 0x0004;

export function interactionGroups(membership: number, filter: number): number {
  return ((membership & 0xffff) << 16) | (filter & 0xffff);
}

/**
 * Workaround: Rapier 0.21 heightfield ray casts miss for exactly vertical rays at many
 * positions (~17 % in tests/physics.test.ts). A negligible horizontal component avoids
 * the degenerate traversal (position error < 0.1 mm).
 */
export function safeRayDir<T extends { x: number; y: number; z: number }>(d: T): T {
  if (Math.abs(d.x) < 1e-6 && Math.abs(d.z) < 1e-6) {
    d.x = 1e-6;
    d.z = 0.7e-6;
  }
  return d;
}

let rapierReady: Promise<Rapier> | null = null;

/** Initialises the Rapier WASM module once. */
export function initRapier(): Promise<Rapier> {
  if (!rapierReady) {
    rapierReady = RAPIER.init().then(() => RAPIER);
  }
  return rapierReady;
}

export interface FixedStepParticipant {
  /** Called before world.step(): apply forces/impulses. */
  preStep(dt: number): void;
  /** Called after world.step(): read back state. */
  postStep(dt: number): void;
}

/** Thin wrapper around a Rapier world with explicit fixed stepping. */
export class PhysicsWorld {
  readonly world: RAPIER.World;
  readonly rapier: Rapier;
  private participants: FixedStepParticipant[] = [];
  stepCount = 0;

  constructor(rapier: Rapier) {
    this.rapier = rapier;
    this.world = new rapier.World({ x: 0, y: -PHYSICS_SETTINGS.gravity, z: 0 });
    this.world.timestep = PHYSICS_SETTINGS.fixedDt;
    this.world.numSolverIterations = PHYSICS_SETTINGS.solverIterations;
  }

  add(p: FixedStepParticipant): void {
    this.participants.push(p);
  }

  remove(p: FixedStepParticipant): void {
    this.participants = this.participants.filter((x) => x !== p);
  }

  /** Executes exactly one fixed step. */
  step(): void {
    const dt = this.world.timestep;
    for (const p of this.participants) p.preStep(dt);
    this.world.step();
    for (const p of this.participants) p.postStep(dt);
    this.stepCount++;
  }

  dispose(): void {
    this.participants = [];
    this.world.free();
  }
}
