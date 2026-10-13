import { Vector3 } from 'three';
import type { Object3D } from 'three';
import { QUESTIONS } from '../data/questions';
import { VEHICLES, getVehicleInfo } from '../data/vehicles';
import type { VehicleInfo } from '../data/vehicles';
import { AIDriver, RacingLine } from '../gameplay/AIDriver';
import { CollectibleSystem } from '../gameplay/CollectibleSystem';
import type { CollectResult } from '../gameplay/CollectibleSystem';
import { QuizSystem } from '../gameplay/QuizSystem';
import type { QuizAnswer } from '../gameplay/QuizSystem';
import { RaceManager } from '../gameplay/RaceManager';
import type { RaceEvent } from '../gameplay/RaceManager';
import { TimerSystem } from '../gameplay/TimerSystem';
import type { CarSnapshot } from '../net/protocol';
import { LaunchEqualizer } from '../physics/LaunchEqualizer';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import type { VehiclePhysics } from '../physics/VehiclePhysics';
import { mulberry32 } from '../physics/math';
import type { DustSystem } from '../vehicles/DustSystem';
import { RemoteVehicle } from '../vehicles/RemoteVehicle';
import type { Vehicle } from '../vehicles/Vehicle';
import { createVehicle, groundSpawn } from '../vehicles/VehicleFactory';
import { routesLabel } from '../world/TrackTypes';
import type { ChoiceRoute } from '../world/TrackTypes';
import type { World } from '../world/World';
import type { InputState } from './InputManager';

export type SessionPhase = 'countdown' | 'racing' | 'finished';

export interface SessionCallbacks {
  raceEvent(e: RaceEvent): void;
  collected(r: CollectResult): void;
  answered(r: QuizAnswer): void;
  impact(strength: number): void;
  countdownTick(n: number): void;
  wrongWay(): void;
  /** Online: snapshots of the cars this browser simulates (~20 Hz). */
  snapshot?(cars: CarSnapshot[]): void;
  /** Online: an AI car simulated here finished (time includes its pickups and quiz). */
  aiFinished?(carId: string, time: number, route: string): void;
}

/** One car on the grid. */
export interface CarEntry {
  carId: string;
  /** local = this player, ai = simulated here by AIDriver, remote = another browser. */
  kind: 'local' | 'ai' | 'remote';
  vehicleId: string;
  name: string;
  slot: number;
}

interface RaceCar {
  entry: CarEntry;
  vehicle: Vehicle | null;
  driver: AIDriver | null;
  remote: RemoteVehicle | null;
  equalizer: LaunchEqualizer | null;
  reportedFinish: boolean;
}

export interface Standing {
  carId: string;
  name: string;
  vehicle: string;
  route: string;
  time: number | null;
  progress: number;
  me: boolean;
}

const COUNTDOWN_SECONDS = 3;
const SNAPSHOT_EVERY = 3; // fixed steps (60 Hz / 3 = 20 Hz)
const tmp = new Vector3();

/** Solo race: the player plus three AI rivals in a random grid order. */
export function soloEntries(playerVehicle: string, seed: number): CarEntry[] {
  const rnd = mulberry32(seed);
  const slots = [0, 1, 2, 3];
  for (let i = slots.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [slots[i], slots[j]] = [slots[j], slots[i]];
  }
  const rivals = VEHICLES.filter((v) => v.id !== playerVehicle);
  return [
    { carId: 'me', kind: 'local', vehicleId: playerVehicle, name: 'Sen', slot: slots[0] },
    ...rivals.map((v, i) => ({ carId: `ai-${i}`, kind: 'ai' as const, vehicleId: v.id, name: `Rakip ${v.name}`, slot: slots[i + 1] })),
  ];
}

/**
 * One race: the local player's car, AI rivals and (online) remote cars; timing and
 * progression. Everything here runs in the fixed step; rendering only reads the state.
 */
export class RaceSession {
  readonly cars: RaceCar[] = [];
  readonly player: Vehicle;
  readonly playerInfo: VehicleInfo;
  readonly playerCarId: string;
  readonly timer = new TimerSystem();
  readonly race: RaceManager;
  readonly collectibles: CollectibleSystem;
  /** End-of-race quiz, created at the finish when "?" signs were collected. */
  quiz: QuizSystem | null = null;
  phase: SessionPhase = 'countdown';
  countdown = COUNTDOWN_SECONDS;
  turboTime = 0;
  /** Race clock including the countdown (negative before the green light). */
  clock = -COUNTDOWN_SECONDS;
  private lastCountdownShown = -1;
  private prevPos = new Vector3();
  private wrongWayTime = 0;
  private resetCooldown = 0;
  private airTime = 0;
  private impactCooldown = 0;
  /** Racing line through the player's chosen roads (Bilgi assumed for forks not reached). */
  private playerLine: RacingLine;
  private playerHint = 0;
  private raceSeed: number;
  private stepCount = 0;
  /** Development/testing aid: lets an AI controller drive the player's car. */
  playerAutopilot: AIDriver | null = null;

  constructor(
    private readonly world: World,
    private readonly physics: PhysicsWorld,
    parent: Object3D,
    entries: CarEntry[],
    private readonly dust: DustSystem,
    private readonly cb: SessionCallbacks,
    seed: number,
    /** Online races cannot be restarted locally and report to the server. */
    readonly online = false,
  ) {
    const track = world.track;
    this.raceSeed = seed;
    const rnd = mulberry32(seed);
    // Each fork gets its own shuffle, so the AI rivals spread over the roads differently.
    const shuffled = (): ChoiceRoute[] => {
      const r: ChoiceRoute[] = ['hiz', 'bilgi', 'cesaret'];
      for (let i = r.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        [r[i], r[j]] = [r[j], r[i]];
      }
      return r;
    };
    const perLeg = track.legs.map(() => shuffled());
    let aiIndex = 0;
    for (const e of entries) {
      const info = getVehicleInfo(e.vehicleId);
      const pose = this.spawnPose(info, e.slot);
      const car: RaceCar = { entry: e, vehicle: null, driver: null, remote: null, equalizer: null, reportedFinish: false };
      if (e.kind === 'remote') {
        car.remote = new RemoteVehicle(e.carId, e.name, info, physics, { ...pose.position, yaw: pose.yaw });
        parent.add(car.remote.model.root);
      } else {
        car.vehicle = createVehicle(info, physics, world.collision, pose, dust);
        parent.add(car.vehicle.model.root);
        if (e.kind === 'ai') {
          const skill = { cornerAccel: 6.4 + rnd() * 1.2, speedFactor: 0.8 + rnd() * 0.12, quizAccuracy: 0.65 + rnd() * 0.2 };
          const k = aiIndex++;
          car.driver = new AIDriver(e.name, car.vehicle.physics, perLeg.map((r) => r[k % r.length]), track, skill, seed + aiIndex * 31);
        }
      }
      this.cars.push(car);
    }
    const local = this.cars.find((c) => c.entry.kind === 'local');
    if (!local?.vehicle) throw new Error('RaceSession needs a local car');
    this.player = local.vehicle;
    this.playerInfo = local.vehicle.info;
    this.playerCarId = local.entry.carId;
    this.race = new RaceManager({ startGate: track.startGate, finishGate: track.finishGate, legs: track.legs });
    this.collectibles = new CollectibleSystem(track.collectibles);
    this.playerLine = new RacingLine(track, track.legs.map(() => 'bilgi'));
    this.restart();
  }

  private spawnPose(info: VehicleInfo, slot: number) {
    const track = this.world.track;
    const g = track.def.grid[slot % track.def.grid.length];
    return groundSpawn((x, z) => track.terrain.heightAt(x, z), info, g.x, g.z, g.yaw);
  }

  /** Metres a grid slot starts behind the front row, along the start direction. */
  private gridGap(slot: number): number {
    const grid = this.world.track.def.grid;
    const g = grid[slot % grid.length];
    const dir = { x: -Math.sin(g.yaw), z: -Math.cos(g.yaw) };
    const front = Math.max(...grid.map((s) => s.x * dir.x + s.z * dir.z));
    return front - (g.x * dir.x + g.z * dir.z);
  }

  /** All cars simulated in this browser (player + AI). */
  get allVehicles(): Vehicle[] {
    return this.cars.filter((c) => c.vehicle).map((c) => c.vehicle!);
  }

  get remotes(): RemoteVehicle[] {
    return this.cars.filter((c) => c.remote).map((c) => c.remote!);
  }

  get aiCars(): RaceCar[] {
    return this.cars.filter((c) => c.driver);
  }

  /** Dev/test: drive the player's car with the AI controller (one road, or one per fork). */
  enableAutopilot(route: ChoiceRoute | ChoiceRoute[] | null): void {
    const routes = route === null ? null : Array.isArray(route) ? route : this.world.track.legs.map(() => route);
    this.playerAutopilot = routes
      ? new AIDriver('Otopilot', this.player.physics, routes, this.world.track, { cornerAccel: 6.5, speedFactor: 0.9, quizAccuracy: 1 }, 1)
      : null;
  }

  /** Label of the roads the player has chosen so far. */
  get routeLabel(): string {
    return routesLabel(this.race.routes);
  }

  /** Puts everything back on the grid and resets all gameplay state. */
  restart(): void {
    for (const c of this.cars) {
      c.equalizer?.dispose();
      c.equalizer = null;
      c.reportedFinish = false;
      if (c.vehicle) {
        c.vehicle.physics.reset(this.spawnPose(c.vehicle.info, c.entry.slot));
        c.vehicle.physics.inputEnabled = false;
      }
      c.driver?.reset();
    }
    this.timer.reset();
    this.race.reset();
    this.collectibles.reset();
    this.raceSeed++;
    this.quiz = null;
    this.phase = 'countdown';
    this.countdown = COUNTDOWN_SECONDS;
    this.clock = -COUNTDOWN_SECONDS;
    this.lastCountdownShown = -1;
    this.turboTime = 0;
    this.wrongWayTime = 0;
    this.airTime = 0;
    this.prevPos.copy(this.player.physics.position);
    this.playerLine = new RacingLine(this.world.track, this.world.track.legs.map(() => 'bilgi'));
    this.playerHint = 0;
    this.playerAutopilot?.reset();
    this.dust.clear();
  }

  /** R key: back to the last checkpoint passed, facing the course. */
  resetPlayer(): void {
    if (this.resetCooldown > 0 || this.phase !== 'racing') return;
    const g = this.race.lastGate;
    const yaw = Math.atan2(-g.tx, -g.tz);
    // g.y is the driving surface (bridge deck or ground), the terrain may be a riverbed.
    const height = (x: number, z: number) => Math.max(this.world.track.terrain.heightAt(x, z), g.y);
    this.player.physics.reset(groundSpawn(height, this.playerInfo, g.x, g.z, yaw));
    this.player.physics.inputEnabled = true;
    const me = this.cars.find((c) => c.entry.kind === 'local');
    me?.equalizer?.dispose(); // the start equaliser ends with a manual reset
    this.prevPos.copy(this.player.physics.position);
    this.resetCooldown = 1;
  }

  /** Starts the end-of-race quiz (one question per collected "?" sign). */
  startQuiz(): QuizSystem | null {
    const n = this.collectibles.counts.question;
    this.quiz = n > 0 ? new QuizSystem(QUESTIONS, n, this.raceSeed * 31) : null;
    return this.quiz;
  }

  answer(choice: 0 | 1): void {
    const a = this.quiz?.answer(choice);
    if (!a) return;
    if (a.correct) this.timer.addBonus(-a.delta, 'Doğru cevap');
    else this.timer.addPenalty(a.delta, 'Yanlış cevap');
    this.cb.answered(a);
  }

  /** Online: incoming snapshots for remote cars. */
  receiveSnapshots(snaps: CarSnapshot[]): void {
    for (const s of snaps) {
      const c = this.cars.find((x) => x.entry.carId === s.carId);
      c?.remote?.push(s, this.clock);
    }
  }

  /** One fixed simulation step of the race. */
  fixedStep(dt: number, input: InputState): void {
    const pv = this.player.physics;
    this.resetCooldown = Math.max(0, this.resetCooldown - dt);
    this.clock += dt;

    if (this.phase === 'countdown') {
      this.countdown -= dt;
      const n = Math.ceil(this.countdown);
      if (n !== this.lastCountdownShown) {
        this.lastCountdownShown = n;
        this.cb.countdownTick(n);
      }
      if (this.countdown <= 0) this.greenLight();
    }

    if (this.phase === 'racing' && this.playerAutopilot) {
      this.playerAutopilot.update(dt, this.timer.elapsed);
    } else if (this.phase === 'racing') {
      const d = input.driving();
      pv.controls.throttle = d.throttle;
      pv.controls.brake = d.brake;
      pv.controls.steer = d.steer;
      pv.controls.handbrake = d.handbrake;
    } else if (this.phase === 'finished') {
      pv.controls.throttle = 0;
      pv.controls.brake = 0;
      pv.controls.steer = 0;
      pv.controls.handbrake = true;
    }
    for (const c of this.cars) {
      if (c.driver && this.phase !== 'countdown') {
        c.driver.update(dt, this.clock);
        if (c.driver.finished && !c.reportedFinish) {
          c.reportedFinish = true;
          this.cb.aiFinished?.(c.entry.carId, c.driver.finishTime, c.driver.routeLabel);
        }
      }
      if (c.equalizer && !c.equalizer.done) c.equalizer.update(dt);
      c.remote?.fixedUpdate(this.clock);
    }
    this.turboTime = Math.max(0, this.turboTime - dt);
    pv.turboActive = this.turboTime > 0;

    this.physics.step();
    this.timer.update(dt);

    // --- Gameplay checks on the new state ---------------------------------------------
    const p = pv.position;
    if (this.phase === 'racing') {
      for (const e of this.race.update(this.prevPos, p)) {
        if (e.type === 'routeSelected') {
          this.playerLine = new RacingLine(this.world.track, this.race.routes.map((r) => r ?? 'bilgi'));
          this.playerHint = this.playerLine.nearest(p.x, p.z, 0, 100000).index;
        }
        if (e.type === 'finish') {
          this.phase = 'finished';
          this.timer.stop();
        }
        this.cb.raceEvent(e);
      }
      for (const c of this.collectibles.update(p.x, p.y, p.z)) {
        if (c.timeBonus > 0) this.timer.addBonus(c.timeBonus, 'Kum saati');
        if (c.turboSeconds > 0) this.turboTime = c.turboSeconds;
        this.cb.collected(c);
      }
      this.checkWrongWay(dt);
    }
    this.prevPos.copy(p);
    this.audioEvents(dt);

    if (this.cb.snapshot && ++this.stepCount % SNAPSHOT_EVERY === 0) this.cb.snapshot(this.makeSnapshots());
  }

  private greenLight(): void {
    this.phase = 'racing';
    this.timer.start();
    for (const c of this.cars) {
      if (!c.vehicle) continue;
      c.vehicle.physics.inputEnabled = true;
      // Fair start: cars further back get the ghost-based catch-up (see LaunchEqualizer).
      const gap = this.gridGap(c.entry.slot);
      if (gap > 0.05) {
        const g = this.world.track.def.grid[c.entry.slot % this.world.track.def.grid.length];
        c.equalizer = new LaunchEqualizer(
          this.physics.rapier,
          c.vehicle.physics.cfg,
          c.vehicle.physics,
          gap,
          { x: -Math.sin(g.yaw), z: -Math.cos(g.yaw) },
          { x: c.vehicle.physics.position.x, z: c.vehicle.physics.position.z },
        );
      }
    }
  }

  private audioEvents(dt: number): void {
    const t = this.player.physics.telemetry;
    this.impactCooldown = Math.max(0, this.impactCooldown - dt);
    if (t.airborne) this.airTime += dt;
    else {
      if (this.airTime > 0.35 && this.impactCooldown === 0) {
        this.cb.impact(Math.min(8, 2 + this.airTime * 4));
        this.impactCooldown = 0.3;
      }
      this.airTime = 0;
    }
    if (t.impact > 2.5 && this.impactCooldown === 0) {
      this.cb.impact(t.impact);
      this.impactCooldown = 0.3;
    }
  }

  private snapshotOf(carId: string, v: VehiclePhysics, prog: number, turbo: boolean): CarSnapshot {
    const p = v.position;
    const q = v.rotation;
    const lv = v.body.linvel();
    const w = v.wheels;
    const r = (x: number, k = 1000) => Math.round(x * k) / k;
    return {
      carId,
      t: r(this.clock),
      p: [r(p.x), r(p.y), r(p.z)],
      q: [r(q.x, 1e4), r(q.y, 1e4), r(q.z, 1e4), r(q.w, 1e4)],
      v: [r(lv.x, 100), r(lv.y, 100), r(lv.z, 100)],
      sl: [r(w[0].suspensionLength), r(w[1].suspensionLength), r(w[2].suspensionLength), r(w[3].suspensionLength)],
      wr: [r(w[0].rotation, 100), r(w[1].rotation, 100), r(w[2].rotation, 100), r(w[3].rotation, 100)],
      st: r(v.telemetry.steerAngle),
      f: (v.telemetry.brake > 0.05 ? 1 : 0) | (v.telemetry.gear < 0 ? 2 : 0) | (turbo ? 4 : 0),
      rpm: Math.round(v.telemetry.rpm),
      prog: r(prog, 1e4),
    };
  }

  private makeSnapshots(): CarSnapshot[] {
    const out: CarSnapshot[] = [this.snapshotOf(this.playerCarId, this.player.physics, this.playerProgress(), this.turboTime > 0)];
    for (const c of this.aiCars) out.push(this.snapshotOf(c.entry.carId, c.vehicle!.physics, c.driver!.progress(), c.vehicle!.physics.turboActive));
    return out;
  }

  private checkWrongWay(dt: number): void {
    const pv = this.player.physics;
    const p = pv.position;
    const line = this.playerLine;
    const near = line.nearest(p.x, p.z, this.playerHint, 40);
    this.playerHint = near.index;
    const a = line.pts[Math.max(0, near.index - 2)];
    const b = line.pts[Math.min(line.pts.length - 1, near.index + 2)];
    const tl = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    const v = pv.linearVelocity(tmp);
    const along = (v.x * (b.x - a.x) + v.z * (b.z - a.z)) / tl;
    if (near.dist < 15 && along < -4) this.wrongWayTime += dt;
    else this.wrongWayTime = 0;
    if (this.wrongWayTime > 1.5) {
      this.cb.wrongWay();
      this.wrongWayTime = -3;
    }
  }

  /** Progress 0..1 of the player along the course (for ranking). */
  playerProgress(): number {
    if (this.race.finished) return 1 + (1e4 - this.timer.total) * 1e-6;
    const s = this.playerLine.pts[this.playerHint]?.s ?? 0;
    return Math.min(0.999, s / this.playerLine.finishS);
  }

  /** Live standings (online, remote finish times come from the server instead). */
  standings(): Standing[] {
    const list: Standing[] = this.cars.map((c) => {
      if (c.entry.kind === 'local') {
        return {
          carId: c.entry.carId,
          name: c.entry.name,
          vehicle: this.playerInfo.name,
          route: this.routeLabel,
          time: this.race.finished ? this.timer.total : null,
          progress: this.playerProgress(),
          me: true,
        };
      }
      if (c.driver) {
        return {
          carId: c.entry.carId,
          name: c.entry.name,
          vehicle: c.vehicle!.info.name,
          route: c.driver.routeLabel,
          time: c.driver.finished ? c.driver.finishTime : null,
          progress: c.driver.progress(),
          me: false,
        };
      }
      return { carId: c.entry.carId, name: c.entry.name, vehicle: c.remote!.info.name, route: '-', time: null, progress: c.remote!.progress, me: false };
    });
    list.sort((a, b) => {
      if (a.time !== null && b.time !== null) return a.time - b.time;
      if (a.time !== null) return -1;
      if (b.time !== null) return 1;
      return b.progress - a.progress;
    });
    return list;
  }

  playerPosition(): number {
    return this.standings().findIndex((s) => s.me) + 1;
  }

  syncVisuals(alpha: number, frameDt: number): void {
    for (const v of this.allVehicles) v.syncVisual(alpha, frameDt);
    for (const r of this.remotes) r.syncVisual(this.clock - (1 - alpha) * (1 / 60));
  }

  dispose(): void {
    for (const c of this.cars) {
      c.equalizer?.dispose();
      c.vehicle?.dispose();
      c.remote?.dispose();
    }
    this.cars.length = 0;
  }
}
