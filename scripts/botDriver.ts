/**
 * Bot driver with keyboard-style (on/off) inputs, like a human on a keyboard: steer is
 * −1/0/+1, throttle and brake are 0/1. Shared by check:keyboard and check:balance.
 */
import { Vector3 } from 'three';
import { VEHICLES } from '../src/data/vehicles';
import { RacingLine } from '../src/gameplay/AIDriver';
import { CollectibleSystem } from '../src/gameplay/CollectibleSystem';
import { SimHarness } from '../src/physics/SimHarness';
import { RAD2DEG } from '../src/physics/math';
import { buildTrack } from '../src/world/TrackBuilder';
import { RACE_TRACK } from '../src/world/TrackData';
import type { ChoiceRoute } from '../src/world/TrackTypes';

const track = buildTrack(RACE_TRACK);

export interface BotSkill {
  /** Lateral acceleration the bot plans corners with (m/s²). */
  cornerAccel: number;
  /** Steering dead band (rad): bigger = sloppier line. */
  deadband: number;
  /** Look-ahead per m/s of speed (s). */
  lookahead: number;
  topSpeed: number;
}
export const PRO: BotSkill = { cornerAccel: 9, deadband: 0.06, lookahead: 0.7, topSpeed: 40 };
export const AVERAGE: BotSkill = { cornerAccel: 6, deadband: 0.1, lookahead: 0.8, topSpeed: 33 };

export async function runBot(routes: ChoiceRoute[], vi: number, skill: BotSkill = PRO) {
  const info = VEHICLES[vi];
  const line = new RacingLine(track, routes);
  const slot = track.def.grid[0];
  const sim = await SimHarness.create(track, info.config, { position: { x: slot.x, y: 10, z: slot.z }, yaw: 0 });
  sim.vehicle.reset(sim.groundSpawn(slot.x, slot.z, 0));
  sim.step(60);
  const v = sim.vehicle;
  const c = v.controls;
  let hint = 0;
  const connIndex = new Map(track.def.connectors.map((id, i) => [id, i]));
  let lastConn = -1;
  const splits: Array<{ path: string; t: number; hg: number; q: number }> = [];
  const legStarts: Array<{ t: number; hg: number; q: number }> = [];
  let t = 0;
  let spins = 0;
  let spinning = false;
  let offRoad = 0;
  let resets = 0;
  let maxBeta = 0;
  let stuck = 0;
  const why: string[] = [];
  const cs = new CollectibleSystem(track.collectibles);
  let maxTilt = 0;
  const lv = new Vector3();
  const fw = new Vector3();
  while (t < 180) {
    const p = v.position;
    const near = line.nearest(p.x, p.z, hint, 40);
    hint = near.index;
    const here = line.pts[hint];
    if (here.s >= line.finishS) break;
    // Fork split times and pickups (fork = between leaving one connector and reaching the next).
    const conn = connIndex.get(here.path);
    if (conn !== undefined && conn !== lastConn) {
      if (lastConn !== -1 && conn === lastConn + 1) splits.push({ path: here.path, t, hg: cs.counts.hourglass, q: cs.counts.question });
      lastConn = conn;
    }
    if (conn === undefined && lastConn !== -1 && splits.length === legStarts.length) legStarts.push({ t, hg: cs.counts.hourglass, q: cs.counts.question });
    const speed = Math.max(0, v.telemetry.forwardSpeed);
    const target = line.at(here.s + Math.max(8, speed * skill.lookahead));
    let err = Math.atan2(-(target.x - p.x), -(target.z - p.z)) - v.heading;
    while (err > Math.PI) err -= 2 * Math.PI;
    while (err < -Math.PI) err += 2 * Math.PI;
    // Digital steering with a small dead band (a human tapping A/D).
    c.steer = err > skill.deadband ? -1 : err < -skill.deadband ? 1 : 0;
    // Corner speed estimate from the line ahead, digital throttle/brake.
    let vmax = skill.topSpeed;
    for (let d = 6; d <= 60; d += 6) {
      const a = line.at(here.s + d);
      const b = line.at(here.s + d + 6);
      const cc = line.at(here.s + d + 12);
      let dh = Math.abs(Math.atan2(cc.x - b.x, cc.z - b.z) - Math.atan2(b.x - a.x, b.z - a.z));
      if (dh > Math.PI) dh = 2 * Math.PI - dh;
      if (dh > 1e-3) vmax = Math.min(vmax, Math.sqrt(Math.sqrt(skill.cornerAccel / (dh / 6)) ** 2 + 2 * 6 * d));
    }
    c.throttle = speed < vmax ? 1 : 0;
    c.brake = speed > vmax + 4 ? 1 : 0;
    c.handbrake = false;
    sim.step();
    t += 1 / 60;
    cs.update(v.position.x, v.position.y, v.position.z);
    maxTilt = Math.max(maxTilt, Math.acos(Math.min(1, v.telemetry.upDot)) * RAD2DEG);
    v.linearVelocity(lv);
    v.forwardVector(fw);
    const sp = Math.hypot(lv.x, lv.z);
    if (sp > 5) {
      const beta = Math.abs(Math.atan2(lv.x * fw.z - lv.z * fw.x, lv.x * fw.x + lv.z * fw.z)) * RAD2DEG;
      maxBeta = Math.max(maxBeta, beta);
      if (beta > 35 && !spinning) {
        spins++;
        spinning = true;
      }
      if (beta < 15) spinning = false;
    }
    const roadHalf = (track.paths.get(here.path)?.def.width ?? 16) / 2;
    if (near.dist > roadHalf + 1.5) offRoad += 1 / 60;
    stuck = speed < 1 ? stuck + 1 / 60 : 0;
    if (stuck > 3 || v.telemetry.upDot < 0.3) {
      resets++;
      why.push(`${stuck > 3 ? 'stuck' : 'flipped'}@${here.path}:${here.localS.toFixed(0)}`);
      const a = line.at(here.s + 5);
      const b = line.at(here.s + 8);
      const sp = sim.groundSpawn(a.x, a.z, Math.atan2(-(b.x - a.x), -(b.z - a.z)));
      sp.position.y = Math.max(sp.position.y, a.y + (sp.position.y - track.terrain.heightAt(a.x, a.z)));
      v.reset(sp);
      stuck = 0;
    }
  }
  sim.dispose();
  const legs = splits.map((e, i) => {
    const s0 = legStarts[i] ?? { t: 0, hg: 0, q: 0 };
    return { route: routes[i], t: e.t - s0.t, hg: e.hg - s0.hg, q: e.q - s0.q };
  });
  return { legs, t, spins, offRoad, resets, maxBeta, why, hg: cs.counts.hourglass, q: cs.counts.question, maxTilt };
}

