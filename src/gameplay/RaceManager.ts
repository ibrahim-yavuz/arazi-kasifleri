import { crossGate } from '../world/CheckpointManager';
import type { XZ } from '../world/CheckpointManager';
import type { Gate } from '../world/TrackBuilder';
import { CHOICE_ROUTES } from '../world/TrackTypes';
import type { ChoiceRoute } from '../world/TrackTypes';

export type RaceEvent =
  | { type: 'startLine' }
  | { type: 'routeSelected'; route: ChoiceRoute; leg: number; switched: boolean }
  | { type: 'checkpoint'; route: ChoiceRoute; leg: number; index: number; total: number }
  | { type: 'missedCheckpoint' }
  | { type: 'merge'; leg: number }
  | { type: 'finish' }
  | { type: 'finishRejected'; reason: 'noRoute' | 'routeIncomplete' | 'noMerge' | 'wrongDirection' };

export interface RaceLegGates {
  routes: Record<ChoiceRoute, Gate[]>;
  merge: Gate;
}

export interface RaceGates {
  startGate: Gate;
  finishGate: Gate;
  /** One entry per fork, in driving order. */
  legs: RaceLegGates[];
}

/**
 * Race progression rules (pure logic, independent of rendering and physics). The course
 * has one or more forks ("legs"); at each, the player picks one of three roads:
 * - Crossing a road's entry gate (its first checkpoint) forwards selects it. Crossing another
 *   entry gate of the same fork switches road and restarts that fork's progress.
 * - The chosen road's checkpoints must be crossed forwards, in order.
 * - The fork's merge gate counts only after the chosen road is complete; then the next fork
 *   begins.
 * - The finish counts only after every fork's merge gate, crossed forwards.
 */
export class RaceManager {
  /** Index of the fork being driven (= number of merges passed). */
  leg = 0;
  /** Road chosen at each fork (null = not chosen yet). */
  readonly routes: Array<ChoiceRoute | null>;
  /** Checkpoints passed on each fork's chosen road (entry gate included). */
  readonly progress: number[];
  finished = false;
  startCrossed = false;
  /** Last gate passed (used for the R respawn point). */
  lastGate: Gate;
  readonly passed: string[] = [];

  constructor(private readonly gates: RaceGates) {
    this.lastGate = gates.startGate;
    this.routes = gates.legs.map(() => null);
    this.progress = gates.legs.map(() => 0);
  }

  reset(): void {
    this.leg = 0;
    this.routes.fill(null);
    this.progress.fill(0);
    this.finished = false;
    this.startCrossed = false;
    this.lastGate = this.gates.startGate;
    this.passed.length = 0;
  }

  get legCount(): number {
    return this.gates.legs.length;
  }

  /** Road chosen at the current fork (or the last one once all forks are done). */
  get route(): ChoiceRoute | null {
    return this.routes[Math.min(this.leg, this.legCount - 1)] ?? null;
  }

  get routeGates(): Gate[] {
    const r = this.routes[this.leg];
    return r && this.leg < this.legCount ? this.gates.legs[this.leg].routes[r] : [];
  }

  /** The current fork's chosen road is complete (all its checkpoints passed). */
  get routeComplete(): boolean {
    if (this.leg >= this.legCount) return true;
    return this.routes[this.leg] !== null && this.progress[this.leg] >= this.routeGates.length;
  }

  /** Next gate the player has to drive through (for respawn/AI/HUD). */
  get nextGate(): Gate | null {
    if (this.finished) return null;
    if (this.leg >= this.legCount) return this.gates.finishGate;
    if (!this.routes[this.leg]) return null;
    if (!this.routeComplete) return this.routeGates[this.progress[this.leg]];
    return this.gates.legs[this.leg].merge;
  }

  /** Fraction of all gates done (unchosen forks count with their Bilgi road). */
  progressFraction(): number {
    let total = 1;
    let done = this.finished ? 1 : 0;
    this.gates.legs.forEach((leg, i) => {
      const r = this.routes[i] ?? 'bilgi';
      total += leg.routes[r].length + 1;
      done += (this.routes[i] ? this.progress[i] : 0) + (i < this.leg ? 1 : 0);
    });
    return done / total;
  }

  /** Feed one movement step of the player's car. Returns events that happened. */
  update(prev: XZ, curr: XZ): RaceEvent[] {
    const ev: RaceEvent[] = [];
    if (this.finished) return ev;

    if (!this.startCrossed && crossGate(this.gates.startGate, prev, curr) === 'forward') {
      this.startCrossed = true;
      ev.push({ type: 'startLine' });
    }

    if (this.leg < this.legCount) {
      const L = this.leg;
      const leg = this.gates.legs[L];
      // Entry gates of this fork (selection / switching).
      for (const r of CHOICE_ROUTES) {
        const entry = leg.routes[r][0];
        if (!entry) continue;
        if (crossGate(entry, prev, curr) === 'forward' && !(this.routes[L] === r && this.progress[L] > 0)) {
          const switched = this.routes[L] !== null && this.routes[L] !== r;
          this.routes[L] = r;
          this.progress[L] = 1;
          this.lastGate = entry;
          this.passed.push(entry.id);
          ev.push({ type: 'routeSelected', route: r, leg: L, switched });
          ev.push({ type: 'checkpoint', route: r, leg: L, index: 0, total: leg.routes[r].length });
          return ev;
        }
      }
      const r = this.routes[L];
      if (r && !this.routeComplete) {
        const gates = leg.routes[r];
        const next = gates[this.progress[L]];
        if (crossGate(next, prev, curr) === 'forward') {
          this.progress[L]++;
          this.lastGate = next;
          this.passed.push(next.id);
          ev.push({ type: 'checkpoint', route: r, leg: L, index: this.progress[L] - 1, total: gates.length });
        } else {
          for (let i = this.progress[L] + 1; i < gates.length; i++) {
            if (crossGate(gates[i], prev, curr) === 'forward') {
              ev.push({ type: 'missedCheckpoint' });
              break;
            }
          }
        }
      }
      if (crossGate(leg.merge, prev, curr) === 'forward') {
        if (this.routeComplete) {
          this.lastGate = leg.merge;
          this.passed.push(leg.merge.id);
          this.leg++;
          ev.push({ type: 'merge', leg: L });
        } else {
          ev.push({ type: 'missedCheckpoint' });
        }
      }
    }

    const fin = crossGate(this.gates.finishGate, prev, curr);
    if (fin === 'forward') {
      if (this.leg >= this.legCount) {
        this.finished = true;
        this.passed.push(this.gates.finishGate.id);
        ev.push({ type: 'finish' });
      } else if (!this.routes[this.leg]) ev.push({ type: 'finishRejected', reason: 'noRoute' });
      else if (!this.routeComplete) ev.push({ type: 'finishRejected', reason: 'routeIncomplete' });
      else ev.push({ type: 'finishRejected', reason: 'noMerge' });
    } else if (fin === 'backward') {
      ev.push({ type: 'finishRejected', reason: 'wrongDirection' });
    }
    return ev;
  }
}
