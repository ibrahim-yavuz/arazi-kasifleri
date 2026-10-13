/**
 * Checks the start equaliser: a car starting `gap` m behind the front row, driven with the
 * same inputs, should end level with an identical front-row car (difference ≈ 0 m).
 * Usage: npm run check:launch [gap]
 */
import { VEHICLES } from '../src/data/vehicles';
import { LaunchEqualizer } from '../src/physics/LaunchEqualizer';
import { initRapier } from '../src/physics/PhysicsWorld';
import { SimHarness } from '../src/physics/SimHarness';
import { buildTrack } from '../src/world/TrackBuilder';
import { VALIDATION_TRACK } from '../src/world/ValidationTrackData';

const track = buildTrack(VALIDATION_TRACK);
const gap = Number(process.argv[2] ?? 13);
const R = await initRapier();

type Script = (t: number) => { throttle: number; brake: number };
const SCRIPTS: Record<string, Script> = {
  full: () => ({ throttle: 1, brake: 0 }),
  liftAndBrake: (t) => (t > 3 && t < 4 ? { throttle: 0, brake: 0 } : t > 6 && t < 6.6 ? { throttle: 0, brake: 1 } : { throttle: 1, brake: 0 }),
};

async function run(vi: number, startZ: number, withEq: boolean, script: Script, times: number[]) {
  const sim = await SimHarness.create(track, VEHICLES[vi].config, { position: { x: 0, y: 3, z: startZ }, yaw: 0 });
  sim.vehicle.reset(sim.groundSpawn(0, startZ));
  sim.step(120);
  const eq = withEq ? new LaunchEqualizer(R, VEHICLES[vi].config, sim.vehicle, startZ - 450, { x: 0, z: -1 }, { x: 0, z: startZ }) : null;
  const out: number[] = [];
  let t = 0;
  for (const target of times) {
    while (t < target - 1e-9) {
      Object.assign(sim.vehicle.controls, script(t));
      eq?.update(1 / 60);
      sim.step();
      t += 1 / 60;
    }
    out.push(450 - sim.vehicle.position.z);
  }
  eq?.dispose();
  sim.dispose();
  return out;
}

const times = [2, 4, 6, 8, 10, 15, 20];
for (const [name, script] of Object.entries(SCRIPTS)) {
  console.log(`inputs: ${name}, gap ${gap} m: back − front (m) at ${times.join('/')} s`);
  for (let vi = 0; vi < VEHICLES.length; vi++) {
    const front = await run(vi, 450, false, script, times);
    const back = await run(vi, 450 + gap, true, script, times);
    console.log(`  ${VEHICLES[vi].id.padEnd(8)} ${times.map((_, i) => (back[i] - front[i]).toFixed(2).padStart(6)).join(' ')}`);
  }
}
