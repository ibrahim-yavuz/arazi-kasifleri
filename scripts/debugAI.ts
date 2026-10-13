/** Drives every route with every car using the AI and reports respawns (dev tool). */
import { VEHICLES } from '../src/data/vehicles';
import { AIDriver } from '../src/gameplay/AIDriver';
import { SimHarness } from '../src/physics/SimHarness';
import { buildTrack } from '../src/world/TrackBuilder';
import { RACE_TRACK } from '../src/world/TrackData';
import type { ChoiceRoute } from '../src/world/TrackTypes';
const track = buildTrack(RACE_TRACK);
for (const route of ['hiz', 'bilgi', 'cesaret'] as ChoiceRoute[]) {
  for (const info of VEHICLES) {
    const slot = track.def.grid[0];
    const sim = await SimHarness.create(track, info.config, { position: { x: slot.x, y: 10, z: slot.z }, yaw: 0 });
    sim.vehicle.reset(sim.groundSpawn(slot.x, slot.z, 0));
    sim.step(60);
    const ai = new AIDriver('t', sim.vehicle, [route, route], track, { cornerAccel: 6.5, speedFactor: 0.9, quizAccuracy: 1 }, 7);
    const v = sim.vehicle;
    const orig = ai.respawn.bind(ai);
    const resp: string[] = [];
    ai.respawn = () => {
      const p = ai.line.pts[ai.line.indexAt(ai.distance)];
      resp.push(`${p.path || 'bridge'}@${p.localS.toFixed(0)} up=${v.telemetry.upDot.toFixed(2)} v=${v.telemetry.forwardSpeed.toFixed(1)}`);
      orig();
    };
    let t = 0;
    let maxRoll = 0;
    while (t < 300 && !ai.finished) {
      ai.update(1 / 60, t);
      sim.step();
      t += 1 / 60;
      maxRoll = Math.max(maxRoll, Math.acos(Math.min(1, v.telemetry.upDot)) * 57.3);
    }
    console.log(`${route.padEnd(8)} ${info.id.padEnd(8)} finished=${ai.finished} t=${t.toFixed(1)}s maxTilt=${maxRoll.toFixed(0)}° respawns=${resp.length} ${resp.join(' | ')}`);
    sim.dispose();
  }
}
