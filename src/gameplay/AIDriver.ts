import { Vector3 } from 'three';
import { CollectibleSystem } from './CollectibleSystem';
import { simulateQuiz } from './QuizSystem';
import type { VehiclePhysics } from '../physics/VehiclePhysics';
import { DEG2RAD, clamp, lerp, mulberry32 } from '../physics/math';
import type { BuiltTrack } from '../world/TrackBuilder';
import { routesLabel } from '../world/TrackTypes';
import type { ChoiceRoute } from '../world/TrackTypes';

export interface AISkill {
  /** Lateral acceleration used for corner speed (m/s²). */
  cornerAccel: number;
  /** Fraction of the car's straight-line speed it is willing to use. */
  speedFactor: number;
  /** Probability of answering a question correctly. */
  quizAccuracy: number;
}

interface LinePoint {
  x: number;
  y: number;
  z: number;
  /** Distance along the racing line. */
  s: number;
  /** Source path id ('' for plaza bridges) and the distance along that path. */
  path: string;
  localS: number;
}

/**
 * Continuous racing line through the course for one road choice per fork: connector →
 * fork road → connector → … → final, with straight links across the plazas where one path
 * ends and the next begins (they do not touch).
 */
export class RacingLine {
  readonly pts: LinePoint[] = [];
  readonly finishS: number;

  constructor(track: BuiltTrack, routes: ChoiceRoute[]) {
    const ids: string[] = [];
    track.connectors.forEach((c, i) => {
      ids.push(c);
      const leg = track.legs[i];
      if (leg) ids.push(leg.paths[routes[i] ?? 'bilgi']);
    });
    const chain = ids.map((id) => track.paths.get(id)!);
    const finalId = track.def.finishLine.path;
    let finishS = 0;
    for (const sp of chain) {
      const first = sp.samples[0];
      const last = this.pts[this.pts.length - 1];
      if (last) {
        const gap = Math.hypot(first.x - last.x, first.z - last.z);
        for (let d = 1; d < gap; d += 1) {
          const k = d / gap;
          this.push(last.x + (first.x - last.x) * k, last.y + (first.y - last.y) * k, last.z + (first.z - last.z) * k, '', 0);
        }
      }
      for (const sm of sp.samples) this.push(sm.x, sm.y, sm.z, sp.def.id, sm.s);
      if (sp.def.id === finalId) {
        const idx = this.pts.findIndex((p) => p.path === finalId && p.localS >= track.def.finishLine.at);
        finishS = idx >= 0 ? this.pts[idx].s : this.pts[this.pts.length - 1].s;
      }
    }
    this.finishS = finishS;
  }

  private push(x: number, y: number, z: number, path: string, localS: number): void {
    const prev = this.pts[this.pts.length - 1];
    const s = prev ? prev.s + Math.hypot(x - prev.x, z - prev.z) : 0;
    if (prev && s - prev.s < 0.05) return;
    this.pts.push({ x, y, z, s, path, localS });
  }

  get length(): number {
    return this.pts[this.pts.length - 1].s;
  }

  nearest(x: number, z: number, hint: number, window: number): { index: number; dist: number } {
    let best = hint;
    let bestD = Infinity;
    const lo = Math.max(0, hint - window);
    const hi = Math.min(this.pts.length - 1, hint + window);
    for (let i = lo; i <= hi; i++) {
      const p = this.pts[i];
      const d = (p.x - x) ** 2 + (p.z - z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return { index: best, dist: Math.sqrt(bestD) };
  }

  /** Index of the first point at or after distance s. */
  indexAt(s: number): number {
    let lo = 0;
    let hi = this.pts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.pts[mid].s < s) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  at(s: number): LinePoint {
    return this.pts[this.indexAt(Math.min(Math.max(s, 0), this.length))];
  }
}

const tmp = new Vector3();

/**
 * Opponent controller. Drives a VehiclePhysics with the same controls a player has
 * (throttle/brake/steer) along the racing line, using pure-pursuit steering and a
 * curvature-based target speed.
 */
export class AIDriver {
  readonly line: RacingLine;
  private hint = 0;
  private stuckTime = 0;
  private offTime = 0;
  finished = false;
  finishTime = 0;
  /** Time adjustments from pickups and the quiz (negative = time saved). */
  penalties = 0;
  /** Rivals collect pickups by the same rules as the player. */
  readonly collectibles: CollectibleSystem;
  private turboTime = 0;
  private readonly rnd: () => number;

  constructor(
    readonly name: string,
    readonly vehicle: VehiclePhysics,
    /** Road taken at each fork. */
    readonly routes: ChoiceRoute[],
    private readonly track: BuiltTrack,
    readonly skill: AISkill,
    seed: number,
  ) {
    this.line = new RacingLine(track, routes);
    this.collectibles = new CollectibleSystem(track.collectibles);
    this.rnd = mulberry32(seed);
  }

  /** "Hız → Cesaret" style label of the roads taken. */
  get routeLabel(): string {
    return routesLabel(this.routes);
  }

  reset(): void {
    this.hint = 0;
    this.stuckTime = 0;
    this.offTime = 0;
    this.finished = false;
    this.finishTime = 0;
    this.penalties = 0;
    this.turboTime = 0;
    this.collectibles.reset();
    this.vehicle.turboActive = false;
  }

  /** Distance driven along the racing line (m). */
  get distance(): number {
    return this.line.pts[this.hint].s;
  }

  /** Progress along the race (0..1, >1 once finished) for position ranking. */
  progress(): number {
    if (this.finished) return 1 + (1e4 - this.finishTime) * 1e-6;
    return Math.min(0.999, this.distance / this.line.finishS);
  }

  /** Called every fixed step while the race runs. */
  update(dt: number, raceTime: number): void {
    const v = this.vehicle;
    const c = v.controls;
    if (this.finished) {
      // Stop with the handbrake (holding the brake key at standstill would select reverse).
      c.throttle = 0;
      c.brake = 0;
      c.steer = 0;
      c.handbrake = true;
      return;
    }
    const p = v.position;
    const near = this.line.nearest(p.x, p.z, this.hint, 40);
    this.hint = near.index;
    const here = this.line.pts[this.hint];
    if (here.s >= this.line.finishS) {
      this.finished = true;
      this.penalties += simulateQuiz(this.collectibles.counts.question, this.skill.quizAccuracy, this.rnd);
      this.finishTime = Math.max(0, raceTime + this.penalties);
      return;
    }
    for (const r of this.collectibles.update(p.x, p.y, p.z)) {
      this.penalties -= r.timeBonus;
      if (r.turboSeconds > 0) this.turboTime = r.turboSeconds;
    }
    this.turboTime = Math.max(0, this.turboTime - dt);
    v.turboActive = this.turboTime > 0;

    const speed = Math.max(0, v.telemetry.forwardSpeed);
    const look = Math.max(7, speed * 0.6);
    const target = this.line.at(here.s + look);
    const heading = v.heading;
    const desired = Math.atan2(-(target.x - p.x), -(target.z - p.z));
    let alpha = desired - heading;
    while (alpha > Math.PI) alpha -= Math.PI * 2;
    while (alpha < -Math.PI) alpha += Math.PI * 2;
    // Pure pursuit: curvature = 2 sin(α) / L, wheel angle = atan(curvature · wheelbase).
    const L = Math.hypot(target.x - p.x, target.z - p.z);
    const steerAngle = Math.atan((2 * Math.sin(-alpha) * v.cfg.geometry.wheelbase) / Math.max(1, L));
    const st = v.cfg.steering;
    const lock = st.maxAngleDeg * DEG2RAD * lerp(1, st.highSpeedFactor, clamp(speed / st.highSpeedRef, 0, 1));
    c.steer = clamp(steerAngle / lock, -1, 1);
    c.handbrake = false;

    // Target speed from the curvature of the line ahead (with braking distance).
    let vmax = 45 * this.skill.speedFactor;
    const step = 6;
    for (let d = 4; d <= 70; d += step) {
      const a = this.line.at(here.s + d);
      const b = this.line.at(here.s + d + step);
      const cc = this.line.at(here.s + d + 2 * step);
      const h1 = Math.atan2(b.x - a.x, b.z - a.z);
      const h2 = Math.atan2(cc.x - b.x, cc.z - b.z);
      let dh = Math.abs(h2 - h1);
      if (dh > Math.PI) dh = Math.PI * 2 - dh;
      const kappa = dh / step;
      if (kappa > 1e-4) {
        const vc = Math.sqrt(this.skill.cornerAccel / kappa);
        vmax = Math.min(vmax, Math.sqrt(vc * vc + 2 * 5.5 * d));
      }
      // Slow before steep drops (crest jumps).
      if (cc.y - b.y < -1.0) vmax = Math.min(vmax, 17);
    }
    // Take the ramps at a controlled speed (positions come from the track data).
    for (const r of this.track.def.ramps) {
      if (here.path === r.path && here.localS > r.at - 50 && here.localS < r.at + r.length / 2) vmax = Math.min(vmax, 19);
    }
    const err = vmax - speed;
    let throttle = clamp(err * 0.4, 0, 1);
    // Lift under heavy steering (prevents power oversteer on rear-drive cars).
    if (speed > 6) throttle *= 1 - 0.55 * Math.abs(c.steer);
    c.throttle = throttle;
    // Brake only while moving: holding brake at a standstill would engage reverse.
    c.brake = err < -2 && speed > 2.5 ? clamp(-err * 0.15, 0, 1) : 0;

    // Stuck / off-course recovery.
    if (speed < 1.2 && raceTime > 4) this.stuckTime += dt;
    else this.stuckTime = 0;
    if (near.dist > 22 || v.telemetry.upDot < 0.3) this.offTime += dt;
    else this.offTime = 0;
    if (this.stuckTime > 3 || this.offTime > 2.5) this.respawn();
  }

  /** Puts the car back on the racing line a little ahead (same as the player's R reset). */
  respawn(): void {
    const s = this.distance + 6;
    const a = this.line.at(s);
    const b = this.line.at(s + 3);
    const yaw = Math.atan2(-(b.x - a.x), -(b.z - a.z));
    const cfg = this.vehicle.cfg;
    // On bridges the racing line is above the terrain (riverbed): use the higher one.
    const y = Math.max(this.track.terrain.heightAt(a.x, a.z), a.y) + cfg.geometry.wheelRadius + cfg.suspension.restLength - cfg.geometry.hardpointHeight + 0.3;
    this.vehicle.reset({ position: tmp.set(a.x, y, a.z), yaw });
    this.hint = this.line.indexAt(s);
    this.stuckTime = 0;
    this.offTime = 0;
  }
}
