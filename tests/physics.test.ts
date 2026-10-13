import { describe, expect, it } from 'vitest';
import { VEHICLES } from '../src/data/vehicles';
import { FixedStepAccumulator } from '../src/game/GameLoop';
import { Drivetrain } from '../src/physics/Drivetrain';
import { SimHarness } from '../src/physics/SimHarness';
import { safeRayDir } from '../src/physics/PhysicsWorld';
import { antiRollForce, suspensionCharacteristics, suspensionForce } from '../src/physics/Suspension';
import { SimpleTireModel, createTireOutput, lateralCurve } from '../src/physics/TireModel';
import { buildWheelLayout, cloneVehicleConfig, torqueAt, validateVehicleConfig } from '../src/physics/VehicleConfig';
import { RADS_TO_RPM } from '../src/physics/math';
import { VALIDATION_TRACK } from '../src/world/ValidationTrackData';

const base = VEHICLES[0].config;

describe('vehicle configuration', () => {
  it('all shipped vehicles validate', () => {
    for (const v of VEHICLES) expect(validateVehicleConfig(v.config), v.id).toEqual([]);
  });

  it('the four vehicles are physically different, not recolours', () => {
    const sig = VEHICLES.map((v) => [v.config.chassis.mass, v.config.geometry.wheelbase, v.config.suspension.stiffness, v.config.transmission.layout].join('/'));
    expect(new Set(sig).size).toBe(4);
  });

  it('rejects invalid configurations', () => {
    const c = cloneVehicleConfig(base);
    c.chassis.mass = -1;
    c.transmission.gears = [1, 2];
    const errs = validateVehicleConfig(c);
    expect(errs.some((e) => e.includes('mass'))).toBe(true);
    expect(errs.some((e) => e.includes('descending'))).toBe(true);
    const soft = cloneVehicleConfig(base);
    soft.suspension.stiffness = 100; // far too soft to carry the car
    expect(validateVehicleConfig(soft).some((e) => e.includes('sag'))).toBe(true);
  });

  it('builds a symmetric FL/FR/RL/RR wheel layout with the right driven wheels', () => {
    const w = buildWheelLayout(base);
    expect(w.map((x) => [x.front, x.left])).toEqual([[true, true], [true, false], [false, true], [false, false]]);
    expect(w[0].hardpoint.x).toBeCloseTo(-w[1].hardpoint.x);
    expect(w[0].hardpoint.z).toBeLessThan(0); // front is −Z
    const rwd = cloneVehicleConfig(base);
    rwd.transmission.layout = 'RWD';
    expect(buildWheelLayout(rwd).map((x) => x.driven)).toEqual([false, false, true, true]);
  });
});

describe('suspension', () => {
  const s = base.suspension;
  it('spring force is k·x plus direction-dependent damping, never pulling', () => {
    expect(suspensionForce(0.1, 0, s)).toBeCloseTo(s.stiffness * 0.1);
    expect(suspensionForce(0.1, 0.5, s)).toBeCloseTo(s.stiffness * 0.1 + s.compressionDamping * 0.5);
    expect(suspensionForce(0.1, -0.2, s)).toBeCloseTo(s.stiffness * 0.1 - s.reboundDamping * 0.2);
    expect(suspensionForce(0.01, -5, s)).toBe(0);
    expect(suspensionForce(0, 1, s)).toBe(0);
  });
  it('adds bump-stop force beyond travel and clamps to maxForce', () => {
    const over = s.travel + 0.05;
    expect(suspensionForce(over, 0, s)).toBeCloseTo(s.stiffness * over + s.bumpStopStiffness * 0.05);
    expect(suspensionForce(5, 10, s)).toBe(s.maxForce);
  });
  it('anti-roll bar opposes roll and characteristics are sane', () => {
    expect(antiRollForce(0.2, 0.1, 1000)).toBeCloseTo(100);
    const c = suspensionCharacteristics(s, base.chassis.mass / 4);
    expect(c.frequencyHz).toBeGreaterThan(1);
    expect(c.frequencyHz).toBeLessThan(3);
    expect(c.reboundRatio).toBeGreaterThan(c.compressionRatio);
  });
});

describe('tyre model', () => {
  const tm = new SimpleTireModel();
  const tire = base.tire;
  const input = (o: Partial<Parameters<SimpleTireModel['solve']>[0]>) => ({
    load: 4000, mu: 1, vLong: 10, vLat: 0, omega: 10 / 0.46, radius: 0.46, inertia: 1.5,
    driveTorque: 0, brakeTorque: 0, lateralScale: 1, maxDampingCoef: 1e9, dt: 1 / 60, ...o,
  });
  it('free rolling produces no force', () => {
    const out = createTireOutput();
    tm.solve(input({}), tire, out);
    expect(Math.abs(out.fx)).toBeLessThan(1);
    expect(Math.abs(out.fy)).toBeLessThan(1);
  });
  it('lateral force opposes lateral slip and saturates near μ·N', () => {
    const out = createTireOutput();
    tm.solve(input({ vLat: 1 }), tire, out);
    expect(out.fy).toBeLessThan(0);
    tm.solve(input({ vLat: -1 }), tire, out);
    expect(out.fy).toBeGreaterThan(0);
    tm.solve(input({ vLat: 20, vLong: 10 }), tire, out);
    expect(Math.abs(out.fy)).toBeLessThanOrEqual(4000 * 1 + 1e-6);
    expect(lateralCurve(1, 0.7)).toBeCloseTo(1);
    expect(lateralCurve(3, 0.7)).toBeCloseTo(0.7);
  });
  it('drive torque produces forward force bounded by friction; brake locks with enough torque', () => {
    const out = createTireOutput();
    tm.solve(input({ driveTorque: 800 }), tire, out);
    expect(out.fx).toBeGreaterThan(0);
    tm.solve(input({ driveTorque: 1e6 }), tire, out);
    expect(out.fx).toBeLessThanOrEqual(4000 + 1e-6);
    tm.solve(input({ omega: 0.5, brakeTorque: 1e5 }), tire, out);
    expect(out.locked).toBe(true);
    expect(out.omega).toBe(0);
    expect(out.fx).toBeLessThan(0);
  });
  it('combined slip stays inside the friction ellipse', () => {
    const out = createTireOutput();
    tm.solve(input({ vLat: 3, driveTorque: 1e5 }), tire, out);
    const e = Math.hypot(out.fx / (4000 * tire.longitudinalScale), out.fy / 4000);
    expect(e).toBeLessThanOrEqual(1 + 1e-6);
  });
});

describe('drivetrain', () => {
  it('interpolates the torque curve', () => {
    const c = [{ rpm: 1000, torque: 100 }, { rpm: 3000, torque: 300 }];
    expect(torqueAt(c, 500)).toBe(100);
    expect(torqueAt(c, 2000)).toBe(200);
    expect(torqueAt(c, 9000)).toBe(300);
  });
  it('upshifts with road speed, cuts torque while shifting and limits RPM', () => {
    const d = new Drivetrain({ ...base.engine }, { ...base.transmission });
    const dt = 1 / 60;
    const omegaFor = (rpm: number) => rpm / (d.ratio * RADS_TO_RPM);
    for (let i = 0; i < 60; i++) d.update(1, omegaFor(3000), true, dt);
    expect(d.gear).toBe(1);
    const tq = d.update(1, omegaFor(base.engine.maxRPM * 0.99), true, dt);
    expect(d.gear).toBe(2);
    expect(tq).toBe(0); // torque interrupted during the shift
    const d2 = new Drivetrain({ ...base.engine }, { ...base.transmission });
    for (let i = 0; i < 120; i++) d2.update(1, omegaFor(base.engine.maxRPM * 1.1), false, dt); // airborne: no shift
    expect(d2.gear).toBe(1);
    expect(d2.update(1, omegaFor(base.engine.maxRPM * 1.1), false, dt)).toBe(0); // limiter
  });
  it('does not upshift on wheelspin when road speed is low', () => {
    const d = new Drivetrain({ ...base.engine }, { ...base.transmission });
    const w = base.engine.maxRPM * 0.9 / (d.ratio * RADS_TO_RPM);
    for (let i = 0; i < 120; i++) d.update(1, w, true, 1 / 60, w * 0.3);
    expect(d.gear).toBe(1);
  });
  it('engages reverse after holding brake at standstill and back to drive on throttle', () => {
    const d = new Drivetrain({ ...base.engine }, { ...base.transmission });
    for (let i = 0; i < 30; i++) d.mapPedals(0, 1, 0, 1 / 60);
    expect(d.gear).toBe(-1);
    expect(d.mapPedals(0, 1, -1, 1 / 60)).toEqual({ throttle: 1, brake: 0 });
    for (let i = 0; i < 10; i++) d.mapPedals(1, 0, -0.2, 1 / 60);
    expect(d.gear).toBe(1);
  });
});

describe('fixed-step accumulator', () => {
  it('runs the same number of steps regardless of frame rate', () => {
    for (const fps of [30, 60, 120, 144]) {
      const acc = new FixedStepAccumulator(1 / 60, 0.25, 8);
      let steps = 0;
      for (let i = 0; i < fps * 2; i++) acc.advance(1 / fps, () => steps++);
      expect(Math.abs(steps - 120)).toBeLessThanOrEqual(1);
    }
  });
  it('clamps huge frame times (no spiral of death)', () => {
    const acc = new FixedStepAccumulator(1 / 60, 0.25, 8);
    let steps = 0;
    const r = acc.advance(5, () => steps++);
    expect(steps).toBe(8);
    expect(r.dropped).toBeGreaterThan(4.5);
    expect(r.alpha).toBeGreaterThanOrEqual(0);
    expect(r.alpha).toBeLessThan(1);
  });
});

describe('vehicle simulation (headless Rapier)', () => {
  it('settles at the predicted static sag on all four wheels', async () => {
    const sim = await SimHarness.create(VALIDATION_TRACK, base, { position: { x: 0, y: 3, z: 450 }, yaw: 0 });
    sim.vehicle.reset(sim.groundSpawn(0, 450));
    sim.step(180);
    const sag = suspensionCharacteristics(base.suspension, base.chassis.mass / 4).staticSag;
    for (const w of sim.vehicle.wheels) {
      expect(w.inContact).toBe(true);
      expect(Math.abs(w.compression - sag)).toBeLessThan(0.03);
    }
    sim.dispose();
  });

  it('is deterministic and drives straight without input asymmetry', async () => {
    const run = async () => {
      const sim = await SimHarness.create(VALIDATION_TRACK, base, { position: { x: 0, y: 3, z: 450 }, yaw: 0 });
      sim.vehicle.reset(sim.groundSpawn(0, 450));
      sim.step(60);
      sim.vehicle.controls.throttle = 1;
      sim.step(600);
      const p = sim.vehicle.position.clone();
      const kmh = sim.vehicle.telemetry.speedKmh;
      sim.dispose();
      return { p, kmh };
    };
    const a = await run();
    const b = await run();
    expect(a.p.distanceTo(b.p)).toBe(0);
    expect(Math.abs(a.p.x)).toBeLessThan(0.05);
    expect(a.kmh).toBeGreaterThan(80);
  });

  it('safeRayDir avoids the vertical-ray heightfield miss', async () => {
    const sim = await SimHarness.create(VALIDATION_TRACK, base, { position: { x: 0, y: 50, z: 0 }, yaw: 0 });
    sim.step(1);
    const R = sim.physics.rapier;
    let miss = 0;
    for (let x = -480; x <= 480; x += 37) {
      for (let z = -480; z <= 480; z += 41) {
        if (Math.abs(x) < 5 && Math.abs(z) < 5) continue;
        const h = sim.physics.world.castRay(new R.Ray({ x, y: 100, z }, safeRayDir({ x: 0, y: -1, z: 0 })), 400, true);
        if (!h) miss++;
      }
    }
    expect(miss).toBe(0);
    sim.dispose();
  });

  it('heightfield collider matches TerrainData.heightAt (render/collision alignment)', async () => {
    const sim = await SimHarness.create(VALIDATION_TRACK, base, { position: { x: 0, y: 50, z: 0 }, yaw: 0 });
    const R = sim.physics.rapier;
    const t = sim.track.terrain;
    sim.step(1); // Rapier builds its query structures during the first step
    // Sample the bump/moguls area and the ramp-free strip on non-flat ground.
    for (const [x, z] of [[120, 60], [121.3, 55.7], [118.2, -10.5], [123.9, -40.1], [0, 0], [-219.3, 13.7]]) {
      const hit = sim.physics.world.castRay(new R.Ray({ x, y: 200, z }, safeRayDir({ x: 0, y: -1, z: 0 })), 400, true, undefined, undefined, undefined, sim.vehicle.body);
      expect(hit).not.toBeNull();
      expect(200 - hit!.timeOfImpact).toBeCloseTo(t.heightAt(x, z), 3);
    }
    sim.dispose();
  });
});
