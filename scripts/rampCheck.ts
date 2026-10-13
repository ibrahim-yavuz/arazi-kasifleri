/** Jumps every car off each Cesaret ramp at several speeds and reports flips (dev tool). */
import { VEHICLES } from '../src/data/vehicles';
import { RacingLine } from '../src/gameplay/AIDriver';
import { SimHarness } from '../src/physics/SimHarness';
import { buildTrack } from '../src/world/TrackBuilder';
import { RACE_TRACK } from '../src/world/TrackData';

const track = buildTrack(RACE_TRACK);
const line = new RacingLine(track, ['cesaret', 'cesaret']);
for (const ramp of track.def.ramps) {
  const path = track.paths.get(ramp.path)!;
  for (const kmh of [50, 70, 90, 110]) {
    const row: string[] = [];
    for (const v of VEHICLES) {
      const st = path.at(ramp.at - 40);
      const nx = path.at(ramp.at - 37);
      const sim = await SimHarness.create(track, v.config, { position: { x: st.x, y: 30, z: st.z }, yaw: 0 });
      const yaw = Math.atan2(-(nx.x - st.x), -(nx.z - st.z));
      sim.vehicle.reset(sim.groundSpawn(st.x, st.z, yaw));
      sim.step(30);
      sim.setForwardSpeed(kmh / 3.6);
      let hint = line.nearest(st.x, st.z, 0, 100000).index;
      let minUp = 1;
      for (let i = 0; i < 60 * 5; i++) {
        const p = sim.vehicle.position;
        hint = line.nearest(p.x, p.z, hint, 40).index;
        const tgt = line.at(line.pts[hint].s + 10);
        let err = Math.atan2(-(tgt.x - p.x), -(tgt.z - p.z)) - sim.vehicle.heading;
        while (err > Math.PI) err -= 2 * Math.PI;
        while (err < -Math.PI) err += 2 * Math.PI;
        sim.vehicle.controls.steer = Math.max(-1, Math.min(1, -err * 2));
        sim.vehicle.controls.throttle = sim.vehicle.telemetry.speedKmh < kmh ? 1 : 0;
        sim.step();
        minUp = Math.min(minUp, sim.vehicle.telemetry.upDot);
      }
      row.push(`${v.id}:${minUp < 0.3 ? 'FLIP' : Math.round(Math.acos(Math.min(1, minUp)) * 57.3) + '°'}`);
      sim.dispose();
    }
    console.log(`ramp@${ramp.at} ${kmh} km/h  ${row.join('  ')}`);
  }
}
