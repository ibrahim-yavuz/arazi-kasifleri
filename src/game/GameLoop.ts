import { PHYSICS_SETTINGS } from '../physics/PhysicsWorld';

export interface AdvanceResult {
  steps: number;
  /** Interpolation factor between the previous and current fixed step (0..1). */
  alpha: number;
  /** Real time discarded because of the frame-time clamp or the step cap (s). */
  dropped: number;
}

/**
 * Fixed-timestep accumulator. Rendering can run at any rate; simulation always advances
 * in exact `fixedDt` increments. Excess time after a stall is clamped (no spiral of death).
 */
export class FixedStepAccumulator {
  accumulator = 0;

  constructor(
    readonly fixedDt = PHYSICS_SETTINGS.fixedDt,
    readonly maxFrameTime = PHYSICS_SETTINGS.maxFrameTime,
    readonly maxSteps = PHYSICS_SETTINGS.maxStepsPerFrame,
  ) {}

  advance(frameDt: number, step: (dt: number) => void): AdvanceResult {
    let dropped = 0;
    let dt = frameDt;
    if (!(dt >= 0)) dt = 0;
    if (dt > this.maxFrameTime) {
      dropped += dt - this.maxFrameTime;
      dt = this.maxFrameTime;
    }
    this.accumulator += dt;
    let steps = 0;
    while (this.accumulator >= this.fixedDt - 1e-9 && steps < this.maxSteps) {
      step(this.fixedDt);
      this.accumulator -= this.fixedDt;
      steps++;
    }
    if (this.accumulator >= this.fixedDt) {
      dropped += this.accumulator - (this.accumulator % this.fixedDt);
      this.accumulator %= this.fixedDt;
    }
    if (this.accumulator < 0) this.accumulator = 0;
    return { steps, alpha: this.accumulator / this.fixedDt, dropped };
  }

  reset(): void {
    this.accumulator = 0;
  }
}

/** requestAnimationFrame driver around the accumulator. */
export class GameLoop {
  private rafId = 0;
  private last = 0;
  private running = false;
  private errors = 0;
  readonly accumulator = new FixedStepAccumulator();

  constructor(
    private readonly fixedUpdate: (dt: number) => void,
    private readonly render: (alpha: number, frameDt: number) => void,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const tick = (now: number) => {
      if (!this.running) return;
      // Schedule first so an unexpected error cannot stop the game permanently.
      this.rafId = requestAnimationFrame(tick);
      const frameDt = (now - this.last) / 1000;
      this.last = now;
      try {
        const r = this.accumulator.advance(frameDt, this.fixedUpdate);
        this.render(r.alpha, Math.min(frameDt, PHYSICS_SETTINGS.maxFrameTime));
      } catch (e) {
        if (this.errors++ < 5) console.error('[GameLoop]', e);
        this.accumulator.reset();
      }
    };
    this.rafId = requestAnimationFrame(tick);
  }

  /** Resets timing after a pause so no stale time is simulated. */
  resync(): void {
    this.last = performance.now();
    this.accumulator.reset();
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }
}
