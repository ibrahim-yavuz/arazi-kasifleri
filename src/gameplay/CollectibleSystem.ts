import type { CollectibleKind } from '../world/TrackTypes';

export interface CollectibleItem {
  id: string;
  kind: CollectibleKind;
  x: number;
  y: number;
  z: number;
}

/**
 * Effect values (design choices). "?" signs have no
 * immediate effect: each one adds a question to the end-of-race quiz.
 */
export const COLLECTIBLE_RULES = {
  /** Pickup radius around the item centre, measured from the car's centre (m). */
  radius: 2.8,
  hourglassBonusSeconds: 3,
  signPoints: 100,
  turboSeconds: 2.5,
};

export interface CollectResult {
  item: CollectibleItem;
  /** Time bonus to apply (s, positive = time saved). */
  timeBonus: number;
  points: number;
  turboSeconds: number;
}

/**
 * Trigger detection by distance (deterministic, evaluated in the fixed step). Each item
 * can be collected once per race; reset() makes all items available again.
 */
export class CollectibleSystem {
  private readonly collected = new Set<string>();
  score = 0;
  counts: Record<CollectibleKind, number> = { hourglass: 0, sign: 0, turbo: 0, question: 0 };

  constructor(readonly items: CollectibleItem[]) {}

  reset(): void {
    this.collected.clear();
    this.score = 0;
    this.counts = { hourglass: 0, sign: 0, turbo: 0, question: 0 };
  }

  isCollected(id: string): boolean {
    return this.collected.has(id);
  }

  get totalCollected(): number {
    return this.collected.size;
  }

  /** Checks the car position; returns the items collected during this step. */
  update(x: number, y: number, z: number): CollectResult[] {
    const out: CollectResult[] = [];
    const r2 = COLLECTIBLE_RULES.radius * COLLECTIBLE_RULES.radius;
    for (const it of this.items) {
      if (this.collected.has(it.id)) continue;
      const dx = it.x - x;
      const dy = (it.y - y) * 0.8; // slightly more forgiving vertically
      const dz = it.z - z;
      if (dx * dx + dy * dy + dz * dz > r2) continue;
      this.collected.add(it.id);
      this.counts[it.kind]++;
      const res: CollectResult = { item: it, timeBonus: 0, points: 0, turboSeconds: 0 };
      if (it.kind === 'hourglass') res.timeBonus = COLLECTIBLE_RULES.hourglassBonusSeconds;
      if (it.kind === 'sign') res.points = COLLECTIBLE_RULES.signPoints;
      if (it.kind === 'turbo') res.turboSeconds = COLLECTIBLE_RULES.turboSeconds;
      this.score += res.points;
      out.push(res);
    }
    return out;
  }
}
