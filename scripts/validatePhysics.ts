/**
 * Headless, repeatable physics validation. Runs the same VehiclePhysics/Rapier code as the
 * game on the validation track and writes:
 *   validation-output/physics-results.json      (machine-readable, one record per test)
 *   docs/PHYSICS_RESULTS.md                      (generated tables)
 *
 * Usage: npm run validate            (all vehicles)
 *        npm run validate -- panter  (one vehicle)
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { Quaternion, Vector3 } from 'three';
import { VEHICLES } from '../src/data/vehicles';
import type { VehicleInfo } from '../src/data/vehicles';
import { FixedStepAccumulator } from '../src/game/GameLoop';
import { SimHarness } from '../src/physics/SimHarness';
import { suspensionCharacteristics } from '../src/physics/Suspension';
import { cloneVehicleConfig } from '../src/physics/VehicleConfig';
import type { VehicleConfig } from '../src/physics/VehicleConfig';
import { RAD2DEG } from '../src/physics/math';
import { buildTrack } from '../src/world/TrackBuilder';
import { FEATURES_LAYOUT as FL, VALIDATION_TRACK } from '../src/world/ValidationTrackData';

const DT = 1 / 60;
const track = buildTrack(VALIDATION_TRACK);
const features = track.paths.get('features')!;
const lowgrip = track.paths.get('lowgrip')!;

type Rec = Record<string, number | string | boolean | null>;
const results: Record<string, Record<string, Rec>> = {};
function record(vehicle: string, test: string, data: Rec): void {
  (results[vehicle] ??= {})[test] = data;
  console.log(JSON.stringify({ vehicle, test, ...data }));
}

const r2 = (v: number, d = 2) => (Number.isFinite(v) ? Number(v.toFixed(d)) : null);

function attitude(q: Quaternion) {
  const f = new Vector3(0, 0, -1).applyQuaternion(q);
  const r = new Vector3(1, 0, 0).applyQuaternion(q);
  const u = new Vector3(0, 1, 0).applyQuaternion(q);
  return {
    pitch: Math.asin(Math.max(-1, Math.min(1, f.y))) * RAD2DEG,
    roll: Math.atan2(r.y, u.y) * RAD2DEG,
    upDot: u.y,
    yaw: Math.atan2(-f.x, -f.z),
  };
}

async function sim(cfg: VehicleConfig, x: number, z: number, yaw = 0, holdHandbrake = false): Promise<SimHarness> {
  const s = await SimHarness.create(track, cfg, { position: { x, y: 5, z }, yaw });
  s.vehicle.reset(s.groundSpawn(x, z, yaw));
  s.vehicle.controls.handbrake = holdHandbrake;
  s.step(90); // settle
  return s;
}

/** Simple speed hold (throttle/brake P controller) used by several manoeuvres. */
function cruise(s: SimHarness, targetKmh: number): void {
  const v = s.vehicle.telemetry.forwardSpeed * 3.6;
  const e = targetKmh - v;
  s.vehicle.controls.throttle = Math.max(0, Math.min(1, e * 0.15));
  s.vehicle.controls.brake = e < -3 ? Math.min(1, -e * 0.05) : 0;
}

/** Steers along a path centreline (pure pursuit), for straight-line tests on features/lowgrip. */
function followPath(s: SimHarness, path: typeof features, lookahead = 10): void {
  const p = s.vehicle.position;
  const near = path.nearest(p.x, p.z);
  const tgt = path.at(path.samples[near.index].s + lookahead);
  const yaw = s.vehicle.heading;
  const desired = Math.atan2(-(tgt.x - p.x), -(tgt.z - p.z));
  let err = desired - yaw;
  while (err > Math.PI) err -= 2 * Math.PI;
  while (err < -Math.PI) err += 2 * Math.PI;
  s.vehicle.controls.steer = Math.max(-1, Math.min(1, -err * 2.5));
}

async function testSuspensionDrop(v: VehicleInfo) {
  const s = await SimHarness.create(track, v.config, { position: { x: 0, y: 5, z: 400 }, yaw: 0 });
  const spawn = s.groundSpawn(0, 400, 0, 0.5);
  s.vehicle.reset(spawn);
  const corner = v.config.chassis.mass / 4;
  const ch = suspensionCharacteristics(v.config.suspension, corner);
  let maxComp = 0;
  let firstContact = -1;
  const comps: number[] = [];
  for (let i = 0; i < 60 * 4; i++) {
    s.step();
    const c = s.vehicle.wheels.reduce((a, w) => a + w.compression, 0) / 4;
    comps.push(c);
    if (c > 0 && firstContact < 0) firstContact = i;
    maxComp = Math.max(maxComp, c);
  }
  const finalComp = comps[comps.length - 1];
  // Settle time: last time compression was outside ±5 % of final (after first contact).
  let settle = 0;
  for (let i = comps.length - 1; i >= 0; i--) {
    if (Math.abs(comps[i] - finalComp) > 0.05 * finalComp) {
      settle = (i - firstContact) * DT;
      break;
    }
  }
  let reversals = 0;
  for (let i = firstContact + 2; i < comps.length; i++) {
    const a = comps[i - 1] - comps[i - 2];
    const b = comps[i] - comps[i - 1];
    if (Math.sign(a) !== Math.sign(b) && Math.abs(b) > 1e-4) reversals++;
  }
  record(v.id, 'suspension_drop', {
    dropHeight_m: 0.5,
    predictedSag_m: r2(ch.staticSag, 3),
    measuredStaticComp_m: r2(finalComp, 3),
    peakComp_m: r2(maxComp, 3),
    travel_m: v.config.suspension.travel,
    bottomedOut: maxComp > v.config.suspension.travel,
    overshootRatio: r2(maxComp / finalComp, 2),
    settleTime_s: r2(settle, 2),
    directionReversals: reversals,
    naturalFreq_Hz: r2(ch.frequencyHz, 2),
    dampingRatioBump: r2(ch.compressionRatio, 2),
    dampingRatioRebound: r2(ch.reboundRatio, 2),
  });
  s.dispose();
}

async function testAccelTopSpeed(v: VehicleInfo) {
  const s = await sim(v.config, 0, 455);
  const veh = s.vehicle;
  const z0 = veh.position.z;
  veh.controls.throttle = 1;
  let t50 = NaN, t100 = NaN, d100 = NaN, vmax = 0;
  const hist: number[] = [];
  let t = 0;
  while (veh.position.z > -455 && t < 60) {
    s.step();
    t += DT;
    const k = veh.telemetry.speedKmh;
    hist.push(k);
    vmax = Math.max(vmax, k);
    if (Number.isNaN(t50) && k >= 50) t50 = t;
    if (Number.isNaN(t100) && k >= 100) {
      t100 = t;
      d100 = z0 - veh.position.z;
    }
  }
  const last3 = hist.length > 180 ? hist[hist.length - 1] - hist[hist.length - 181] : NaN;
  const att = attitude(veh.rotation);
  record(v.id, 'accel_topspeed', {
    t0to50_s: r2(t50), t0to100_s: r2(t100), dist0to100_m: r2(d100, 1),
    topSpeed_kmh: r2(vmax, 1), distance_m: r2(z0 - veh.position.z, 0), time_s: r2(t, 1),
    gainLast3s_kmh: r2(last3, 1), finalGear: veh.telemetry.gear,
    lateralDrift_m: r2(Math.abs(veh.position.x), 2), maxPitchAtEnd_deg: r2(att.pitch, 1),
  });
  s.dispose();
}

async function testBraking(v: VehicleInfo, fromKmh: number, mode: 'brake' | 'handbrake' | 'ice') {
  const onIce = mode === 'ice';
  const s = onIce ? await sim(v.config, lowgrip.at(160).x, lowgrip.at(160).z) : await sim(v.config, 0, 300);
  const veh = s.vehicle;
  s.setForwardSpeed(fromKmh / 3.6);
  s.step(2);
  const p0 = veh.position.clone();
  const yaw0 = veh.heading;
  let t = 0;
  let lockedSteps = 0;
  veh.controls.throttle = 0;
  if (mode === 'handbrake') veh.controls.handbrake = true;
  else veh.controls.brake = 1;
  let v0 = veh.telemetry.speedKmh;
  while (t < 20) {
    // Stop before the brake key would engage reverse.
    if (veh.telemetry.forwardSpeed < 0.3) break;
    s.step();
    t += DT;
    lockedSteps += veh.wheels.filter((w) => w.locked).length;
  }
  const dist = Math.hypot(veh.position.x - p0.x, veh.position.z - p0.z);
  const vms = v0 / 3.6;
  let dyaw = (veh.heading - yaw0) * RAD2DEG;
  if (dyaw > 180) dyaw -= 360;
  if (dyaw < -180) dyaw += 360;
  record(v.id, `braking_${mode}_${fromKmh}`, {
    fromSpeed_kmh: r2(v0, 1), distance_m: r2(dist, 2), time_s: r2(t, 2),
    avgDecel_g: r2((vms * vms) / (2 * dist) / 9.81, 2),
    lockedWheelFraction: r2(lockedSteps / Math.max(1, (t / DT) * 4), 2),
    headingChange_deg: r2(dyaw, 1), surface: onIce ? 'ice' : 'dirt',
  });
  s.dispose();
}

async function testTurning(v: VehicleInfo, kmh: number, steer: number) {
  const s = await sim(v.config, -220, 80);
  const veh = s.vehicle;
  s.setForwardSpeed(kmh / 3.6);
  const yawRates: number[] = [];
  const speeds: number[] = [];
  const slips: number[] = [];
  let maxRoll = 0;
  let t = 0;
  let rolled = false;
  const av = new Vector3();
  const lv = new Vector3();
  const fw = new Vector3();
  while (t < 8) {
    cruise(s, kmh);
    veh.controls.steer = steer;
    s.step();
    t += DT;
    const att = attitude(veh.rotation);
    if (att.upDot < 0.3) rolled = true;
    if (t > 4) {
      veh.angularVelocity(av);
      yawRates.push(av.y);
      veh.linearVelocity(lv);
      const sp = Math.hypot(lv.x, lv.z);
      speeds.push(sp);
      veh.forwardVector(fw);
      const beta = Math.atan2(lv.x * fw.z - lv.z * fw.x, lv.x * fw.x + lv.z * fw.z);
      slips.push(Math.abs(beta) * RAD2DEG);
      maxRoll = Math.max(maxRoll, Math.abs(att.roll));
    }
  }
  const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
  const w = Math.abs(mean(yawRates));
  const sp = mean(speeds);
  const R = sp / Math.max(1e-6, w);
  // Kinematic (low-speed) reference radius from geometry.
  const Rgeo = v.config.geometry.wheelbase / Math.tan((v.config.steering.maxAngleDeg * steer * Math.PI) / 180);
  record(v.id, `turn_${kmh}kmh_steer${steer}`, {
    targetSpeed_kmh: kmh, achievedSpeed_kmh: r2(sp * 3.6, 1), radius_m: r2(R, 1),
    kinematicRadius_m: r2(Rgeo, 1), lateralAccel_g: r2((sp * sp) / R / 9.81, 2),
    yawRate_degps: r2(w * RAD2DEG, 1), bodySlip_deg: r2(mean(slips), 1), maxRoll_deg: r2(maxRoll, 1), rolledOver: rolled,
  });
  s.dispose();
}

async function testSlope(v: VehicleInfo) {
  // 1) Hold on the slope with the brake, 2) hill start from rest.
  const mid = features.at((FL.slopeStart + FL.slopeTop) / 2);
  const s = await sim(v.config, mid.x, mid.z, 0, true);
  const veh = s.vehicle;
  const att0 = attitude(veh.rotation);
  // Handbrake hold (the brake key at standstill would select reverse).
  veh.controls.handbrake = true;
  const p0 = veh.position.clone();
  s.step(60 * 3);
  const creep = veh.position.distanceTo(p0);
  veh.controls.handbrake = false;
  veh.controls.throttle = 1;
  let t = 0;
  const startS = features.nearest(veh.position.x, veh.position.z).index;
  let topT = NaN;
  while (t < 15) {
    followPath(s, features);
    s.step();
    t += DT;
    const si = features.nearest(veh.position.x, veh.position.z, startS, 200).index;
    if (features.samples[si].s >= FL.slopeTop && Number.isNaN(topT)) {
      topT = t;
      break;
    }
  }
  record(v.id, 'slope_hold_and_climb', {
    slopeAngle_deg: r2(att0.pitch, 1), creepIn3s_m: r2(creep, 3),
    climbToTop_s: r2(topT, 2), speedAtTop_kmh: r2(veh.telemetry.speedKmh, 1),
  });
  s.dispose();
}

async function testFeatureRun(v: VehicleInfo, name: string, fromS: number, toS: number, kmh: number) {
  const st = features.at(fromS);
  const s = await sim(v.config, st.x, st.z);
  const veh = s.vehicle;
  s.setForwardSpeed(kmh / 3.6);
  let t = 0;
  let maxComp = 0;
  let bottomed = 0;
  let maxRoll = 0;
  let maxPitch = 0;
  let maxRollRate = 0;
  let airborneSteps = 0;
  let steps = 0;
  const contact = [0, 0, 0, 0];
  const vy: number[] = [];
  let lastVy = 0;
  let accSq = 0;
  let maxImpact = 0;
  const av = new Vector3();
  const lv = new Vector3();
  let hint = features.nearest(veh.position.x, veh.position.z).index;
  let upsideDown = false;
  while (t < 20) {
    cruise(s, kmh);
    followPath(s, features);
    s.step();
    t += DT;
    steps++;
    hint = features.nearest(veh.position.x, veh.position.z, hint, 40).index;
    if (features.samples[hint].s > toS) break;
    const att = attitude(veh.rotation);
    if (att.upDot < 0) upsideDown = true;
    maxRoll = Math.max(maxRoll, Math.abs(att.roll));
    maxPitch = Math.max(maxPitch, Math.abs(att.pitch));
    veh.angularVelocity(av);
    maxRollRate = Math.max(maxRollRate, Math.abs(av.dot(veh.forwardVector(new Vector3()))) * RAD2DEG);
    veh.wheels.forEach((w, i) => {
      if (w.inContact) contact[i]++;
      maxComp = Math.max(maxComp, w.compression);
      if (w.compression > v.config.suspension.travel) bottomed++;
    });
    if (veh.telemetry.airborne) airborneSteps++;
    veh.linearVelocity(lv);
    const a = (lv.y - lastVy) / DT;
    lastVy = lv.y;
    if (steps > 2) accSq += a * a;
    vy.push(lv.y);
    maxImpact = Math.max(maxImpact, veh.telemetry.impact);
  }
  record(v.id, name, {
    speed_kmh: kmh, achievedSpeed_kmh: r2(veh.telemetry.speedKmh, 1),
    contactFL: r2(contact[0] / steps), contactFR: r2(contact[1] / steps), contactRL: r2(contact[2] / steps), contactRR: r2(contact[3] / steps),
    airborneFraction: r2(airborneSteps / steps), maxCompression_m: r2(maxComp, 3), bottomOutSteps: bottomed,
    maxRoll_deg: r2(maxRoll, 1), maxPitch_deg: r2(maxPitch, 1), maxRollRate_degps: r2(maxRollRate, 0),
    rmsVertAccel_ms2: r2(Math.sqrt(accSq / Math.max(1, steps - 2)), 2), chassisImpacts_ms: r2(maxImpact, 2),
    upsideDown, completed: features.samples[hint].s > toS,
  });
  s.dispose();
}

async function testJump(v: VehicleInfo, kmh: number) {
  const st = features.at(FL.rampAt - 45);
  const s = await sim(v.config, st.x, st.z);
  const veh = s.vehicle;
  s.setForwardSpeed(kmh / 3.6);
  let t = 0;
  let takeoff: Vector3 | null = null;
  let takeoffT = 0;
  let takeoffSpeed = 0;
  let takeoffPitch = 0;
  let landT = NaN;
  let landPitch = 0;
  let landRoll = 0;
  let maxH = 0;
  let peakComp = 0;
  let bottomed = false;
  let maxImpact = 0;
  let recoveredT = NaN;
  let upsideDown = false;
  let airSteps = 0;
  let touchdown: Vector3 | null = null;
  const lip = track.ramps[0].lip;
  while (t < 9) {
    if (!takeoff) cruise(s, kmh);
    else veh.controls.throttle = 0.4;
    followPath(s, features, 12);
    if (takeoff && veh.telemetry.airborne) veh.controls.steer = 0;
    s.step();
    t += DT;
    const p = veh.position;
    const att = attitude(veh.rotation);
    if (att.upDot < 0) upsideDown = true;
    // Takeoff: first airborne step after passing near the lip.
    if (!takeoff && veh.telemetry.airborne && Math.hypot(p.x - lip.x, p.z - lip.z) < 8) {
      takeoff = p.clone();
      takeoffT = t;
      takeoffSpeed = veh.telemetry.speed * 3.6;
      takeoffPitch = att.pitch;
    }
    if (takeoff && Number.isNaN(landT)) {
      if (veh.telemetry.airborne) {
        airSteps++;
        maxH = Math.max(maxH, p.y - track.terrain.heightAt(p.x, p.z));
      } else {
        landT = t;
        touchdown = p.clone();
        landPitch = att.pitch;
        landRoll = att.roll;
      }
    }
    if (!Number.isNaN(landT) && t - landT < 1.0) {
      for (const w of veh.wheels) {
        peakComp = Math.max(peakComp, w.compression);
        if (w.compression > v.config.suspension.travel) bottomed = true;
      }
      maxImpact = Math.max(maxImpact, veh.telemetry.impact);
    }
    if (!Number.isNaN(landT) && Number.isNaN(recoveredT) && veh.telemetry.wheelsInContact === 4 && Math.abs(att.roll) < 8 && Math.abs(att.pitch) < 10) {
      recoveredT = t - landT;
    }
  }
  record(v.id, `jump_${kmh}kmh`, {
    takeoffSpeed_kmh: r2(takeoffSpeed, 1), airTime_s: r2(airSteps * DT, 2), maxHeightAboveGround_m: r2(maxH, 2),
    jumpLength_m: takeoff && touchdown ? r2(Math.hypot(touchdown.x - takeoff.x, touchdown.z - takeoff.z), 1) : null,
    takeoffTime_s: r2(takeoffT, 2),
    takeoffPitch_deg: r2(takeoffPitch, 1), landingPitch_deg: r2(landPitch, 1), landingRoll_deg: r2(landRoll, 1),
    landingPeakCompression_m: r2(peakComp, 3), travel_m: v.config.suspension.travel, bottomedOut: bottomed,
    landingChassisImpact_ms: r2(maxImpact, 2), timeToSettleAfterLanding_s: r2(recoveredT, 2), upsideDown,
  });
  s.dispose();
}

async function testLowGrip(v: VehicleInfo) {
  const st = lowgrip.at(110);
  const s = await sim(v.config, st.x, st.z);
  const veh = s.vehicle;
  veh.controls.throttle = 1;
  let t = 0;
  let t50 = NaN;
  let maxSlip = 0;
  while (t < 30) {
    followPath(s, lowgrip);
    s.step();
    t += DT;
    maxSlip = Math.max(maxSlip, ...veh.wheels.map((w) => Math.abs(w.slipRatio)));
    if (veh.telemetry.speedKmh >= 50) {
      t50 = t;
      break;
    }
  }
  record(v.id, 'lowgrip_ice_accel', { t0to50_s: r2(t50), maxSlipRatio: r2(maxSlip, 2) });
  s.dispose();
  await testBraking(v, 50, 'ice');
  // Circle on ice at 25 km/h, half steer.
  const s2 = await sim(v.config, lowgrip.at(250).x, lowgrip.at(250).z);
  s2.setForwardSpeed(25 / 3.6);
  let maxBeta = 0;
  const lv = new Vector3();
  const fw = new Vector3();
  for (let i = 0; i < 60 * 3; i++) {
    cruise(s2, 25);
    s2.vehicle.controls.steer = 0.5;
    s2.step();
    s2.vehicle.linearVelocity(lv);
    s2.vehicle.forwardVector(fw);
    const beta = Math.abs(Math.atan2(lv.x * fw.z - lv.z * fw.x, lv.x * fw.x + lv.z * fw.z)) * RAD2DEG;
    if (Math.hypot(lv.x, lv.z) > 2) maxBeta = Math.max(maxBeta, beta);
  }
  record(v.id, 'lowgrip_ice_turn_25kmh', { maxBodySlip_deg: r2(maxBeta, 1), surfaceGrip: 0.2 });
  s2.dispose();
}

async function testFrameRateIndependence(v: VehicleInfo) {
  // Scripted input as a function of time, sampled once per *render* frame (like the game).
  const script = (t: number) => ({
    throttle: t < 4 ? 1 : t < 8 ? 0.5 : 0,
    brake: t >= 8 ? 1 : 0,
    steer: t >= 4 && t < 8 ? 0.6 : 0,
  });
  const out: Record<string, { x: number; z: number; yaw: number; v: number }> = {};
  const configs: Array<[string, number, number]> = [['30fps', 30, 0], ['60fps', 60, 0], ['120fps', 120, 0], ['144fps_jitter', 144, 0.3], ['45fps_stall', 45, 0]];
  for (const [name, fps, jitter] of configs) {
    const s = await sim(v.config, -220, 60);
    const acc = new FixedStepAccumulator();
    let simT = 0;
    let wall = 0;
    let frame = 0;
    let rnd = 12345;
    const rand = () => ((rnd = (rnd * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    let dropped = 0;
    while (simT < 10 - 1e-9) {
      let fdt = 1 / fps;
      if (jitter) fdt *= 1 + (rand() * 2 - 1) * jitter;
      if (name === '45fps_stall' && frame === 100) fdt = 0.6; // tab stall
      wall += fdt;
      frame++;
      const inp = script(simT);
      Object.assign(s.vehicle.controls, inp);
      const res = acc.advance(fdt, () => {
        if (simT < 10 - 1e-9) {
          s.step();
          simT += DT;
        }
      });
      dropped += res.dropped;
    }
    out[name] = { x: s.vehicle.position.x, z: s.vehicle.position.z, yaw: s.vehicle.heading, v: s.vehicle.telemetry.speedKmh };
    if (name === '45fps_stall') record(v.id, 'framerate_stall', { droppedRealTime_s: r2(dropped, 3), wallTime_s: r2(wall, 2), simTime_s: r2(simT, 2) });
    s.dispose();
  }
  const ref = out['60fps'];
  const rec: Rec = {};
  for (const [name, o] of Object.entries(out)) {
    rec[`${name}_posDiff_m`] = r2(Math.hypot(o.x - ref.x, o.z - ref.z), 4);
    rec[`${name}_yawDiff_deg`] = r2((o.yaw - ref.yaw) * RAD2DEG, 3);
  }
  rec.ref60_x = r2(ref.x, 2);
  rec.ref60_z = r2(ref.z, 2);
  record(v.id, 'framerate_independence', rec);
}

async function testDeterminism(v: VehicleInfo) {
  const run = async () => {
    const s = await sim(v.config, -220, 60);
    for (let i = 0; i < 600; i++) {
      s.vehicle.controls.throttle = i < 300 ? 1 : 0.3;
      s.vehicle.controls.steer = i > 200 ? 0.7 : 0;
      s.step();
    }
    const p = s.vehicle.position.clone();
    s.dispose();
    return p;
  };
  const a = await run();
  const b = await run();
  record(v.id, 'determinism', { posDiff_m: r2(a.distanceTo(b), 6) });
}

async function testRolloverRecovery(v: VehicleInfo) {
  const s = await sim(v.config, 0, 200);
  const veh = s.vehicle;
  // Flip: upside down 1 m above ground.
  const q = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI);
  veh.body.setTranslation({ x: 0, y: track.terrain.heightAt(0, 200) + 2.0, z: 200 }, true);
  veh.body.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
  s.step(60 * 3);
  const stuck = attitude(veh.rotation).upDot;
  veh.controls.throttle = 1;
  s.step(60);
  const movedWhileInverted = veh.telemetry.speedKmh;
  veh.controls.throttle = 0;
  veh.reset(s.groundSpawn(0, 200));
  s.step(60);
  const contacts = veh.telemetry.wheelsInContact;
  veh.controls.throttle = 1;
  s.step(120);
  record(v.id, 'rollover_recovery', {
    upDotAfterFlip: r2(stuck, 2), speedWhileInverted_kmh: r2(movedWhileInverted, 1),
    wheelsInContactAfterReset: contacts, speedAfterReset2s_kmh: r2(veh.telemetry.speedKmh, 1),
    uprightAssist: v.config.assists.uprightTorque,
  });
  // Airborne angular momentum: spawn high with a spin; with no contacts angular velocity
  // should only change through the (tiny) angular damping.
  const s2 = await SimHarness.create(track, v.config, { position: { x: 0, y: 80, z: 0 }, yaw: 0 });
  s2.vehicle.body.setAngvel({ x: 1.0, y: 0.5, z: 0.3 }, true);
  s2.step(2);
  const w0 = new Vector3();
  s2.vehicle.angularVelocity(w0);
  const vy0 = s2.vehicle.body.linvel().y;
  s2.step(60);
  const w1 = new Vector3();
  s2.vehicle.angularVelocity(w1);
  const vy1 = s2.vehicle.body.linvel().y;
  record(v.id, 'airborne_ballistics', {
    angVelStart_rads: r2(w0.length(), 3), angVelAfter1s_rads: r2(w1.length(), 3),
    verticalAccel_ms2: r2((vy1 - vy0) / 1.0, 3),
  });
  s.dispose();
  s2.dispose();
}

async function main() {
  const only = process.argv[2];
  const list = VEHICLES.filter((v) => !only || v.id === only);
  const t0 = performance.now();
  for (const v of list) {
    const info = { ...v, config: cloneVehicleConfig(v.config) };
    await testSuspensionDrop(info);
    await testAccelTopSpeed(info);
    await testBraking(info, 80, 'brake');
    await testBraking(info, 50, 'handbrake');
    for (const kmh of [15, 30, 45]) await testTurning(info, kmh, 1);
    await testTurning(info, 45, 0.5);
    await testSlope(info);
    await testFeatureRun(info, 'bump_40kmh', FL.bumpAt - 25, FL.bumpAt + 20, 40);
    await testFeatureRun(info, 'moguls_30kmh', FL.mogulsFrom - 5, FL.mogulsTo, 30);
    await testFeatureRun(info, 'moguls_50kmh', FL.mogulsFrom - 5, FL.mogulsTo, 50);
    await testFeatureRun(info, 'sideslope_40kmh', FL.sideSlopeFrom - 5, FL.sideSlopeTo, 40);
    await testJump(info, 50);
    await testJump(info, 70);
    await testFeatureRun(info, 'rough_landing_zone_35kmh', FL.rampAt + FL.rampLength / 2 + 4, FL.roughTo, 35);
    await testLowGrip(info);
    await testFrameRateIndependence(info);
    await testDeterminism(info);
    await testRolloverRecovery(info);
  }
  console.log(`validation done in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
  mkdirSync('validation-output', { recursive: true });
  writeFileSync('validation-output/physics-results.json', JSON.stringify(results, null, 2));
  writeFileSync('docs/PHYSICS_RESULTS.md', toMarkdown());
}

function toMarkdown(): string {
  const lines: string[] = [
    '# Physics validation results (generated)',
    '',
    'Generated by `npm run validate` (headless, same physics code as the game, 60 Hz fixed step).',
    'Do not edit by hand. See `docs/PHYSICS_VALIDATION.md` for the comparison with the reference.',
    '',
  ];
  const tests = new Set<string>();
  for (const v of Object.values(results)) for (const k of Object.keys(v)) tests.add(k);
  for (const test of tests) {
    lines.push(`## ${test}`, '');
    const vehicles = Object.keys(results).filter((v) => results[v][test]);
    const keys = Object.keys(results[vehicles[0]][test]);
    lines.push(`| metric | ${vehicles.join(' | ')} |`, `|---|${vehicles.map(() => '---').join('|')}|`);
    for (const k of keys) lines.push(`| ${k} | ${vehicles.map((v) => String(results[v][test][k])).join(' | ')} |`);
    lines.push('');
  }
  return lines.join('\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
