export interface TimeAdjustment {
  /** Race-clock time at which it happened (s). */
  at: number;
  /** Positive = penalty (adds time), negative = bonus. */
  delta: number;
  reason: string;
}

/**
 * Race clock. Advanced only by the fixed-step game update (never by animations), so it
 * pauses with the simulation. The displayed race time is elapsed + adjustments.
 */
export class TimerSystem {
  elapsed = 0;
  running = false;
  readonly adjustments: TimeAdjustment[] = [];

  start(): void {
    this.running = true;
  }

  stop(): void {
    this.running = false;
  }

  reset(): void {
    this.elapsed = 0;
    this.running = false;
    this.adjustments.length = 0;
  }

  update(dt: number): void {
    if (this.running && dt > 0) this.elapsed += dt;
  }

  addPenalty(seconds: number, reason: string): void {
    this.adjustments.push({ at: this.elapsed, delta: Math.abs(seconds), reason });
  }

  addBonus(seconds: number, reason: string): void {
    this.adjustments.push({ at: this.elapsed, delta: -Math.abs(seconds), reason });
  }

  get bonusTotal(): number {
    return -this.adjustments.filter((a) => a.delta < 0).reduce((s, a) => s + a.delta, 0);
  }

  get penaltyTotal(): number {
    return this.adjustments.filter((a) => a.delta > 0).reduce((s, a) => s + a.delta, 0);
  }

  /** Race time shown to the player (never negative). */
  get total(): number {
    return Math.max(0, this.elapsed + this.penaltyTotal - this.bonusTotal);
  }
}

/** Formats seconds as mm:ss:cc for the HUD ("00:08:44"). */
export function formatRaceTime(seconds: number): string {
  const s = Math.max(0, seconds);
  const totalCs = Math.floor(s * 100 + 1e-6);
  const cs = totalCs % 100;
  const sec = Math.floor(totalCs / 100) % 60;
  const min = Math.floor(totalCs / 6000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(min)}:${p(sec)}:${p(cs)}`;
}
