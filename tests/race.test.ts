import { describe, expect, it } from 'vitest';
import { VEHICLES } from '../src/data/vehicles';
import { AIDriver } from '../src/gameplay/AIDriver';
import { CollectibleSystem } from '../src/gameplay/CollectibleSystem';
import { RaceManager } from '../src/gameplay/RaceManager';
import { SimHarness } from '../src/physics/SimHarness';
import { buildTrack } from '../src/world/TrackBuilder';
import { RACE_TRACK } from '../src/world/TrackData';
import type { ChoiceRoute } from '../src/world/TrackTypes';

/**
 * Integration test on the real course: the AI controller drives the real VehiclePhysics
 * through each route while the real RaceManager judges progression.
 */
const track = buildTrack(RACE_TRACK);

async function driveRoute(routes: ChoiceRoute[], vehicleIndex: number) {
  const info = VEHICLES[vehicleIndex];
  const slot = track.def.grid[0];
  const sim = await SimHarness.create(track, info.config, { position: { x: slot.x, y: 10, z: slot.z }, yaw: slot.yaw });
  sim.vehicle.reset(sim.groundSpawn(slot.x, slot.z, slot.yaw));
  sim.step(60);
  const ai = new AIDriver('test', sim.vehicle, routes, track, { cornerAccel: 6.5, speedFactor: 0.9, quizAccuracy: 1 }, 7);
  const rm = new RaceManager({ startGate: track.startGate, finishGate: track.finishGate, legs: track.legs });
  const cs = new CollectibleSystem(track.collectibles);
  const prev = sim.vehicle.position.clone();
  let t = 0;
  let respawns = 0;
  const events: string[] = [];
  const origRespawn = ai.respawn.bind(ai);
  ai.respawn = () => {
    respawns++;
    origRespawn();
  };
  while (t < 400 && !rm.finished) {
    ai.update(1 / 60, t);
    sim.step();
    t += 1 / 60;
    const p = sim.vehicle.position;
    for (const e of rm.update(prev, p)) events.push(e.type === 'finishRejected' ? `rejected:${e.reason}` : e.type);
    cs.update(p.x, p.y, p.z);
    prev.copy(p);
  }
  sim.dispose();
  return { finished: rm.finished, routes: [...rm.routes], passed: rm.passed, time: t, respawns, events, collected: cs.totalCollected };
}

describe('full race on the real track (AI driver + race rules)', () => {
  const cases: Array<[ChoiceRoute[], number]> = [
    [['hiz', 'hiz'], 0],
    [['bilgi', 'cesaret'], 2],
    [['cesaret', 'bilgi'], 1],
  ];
  for (const [routes, vi] of cases) {
    it(`completes ${routes.join(' → ')} with ${VEHICLES[vi].name}`, async () => {
      const r = await driveRoute(routes, vi);
      console.info(`[race] ${routes.join('>')}/${VEHICLES[vi].id}: finished=${r.finished} time=${r.time.toFixed(1)}s respawns=${r.respawns} collected=${r.collected} passed=${r.passed.join(',')}`);
      expect(r.routes).toEqual(routes);
      expect(r.finished).toBe(true);
      const expected = track.legs.flatMap((leg, i) => [...leg.routes[routes[i]].map((g) => g.id), leg.merge.id]);
      expect(r.passed).toEqual([...expected, track.finishGate.id]);
      expect(r.events.filter((e) => e.startsWith('rejected'))).toHaveLength(0);
      expect(r.respawns).toBeLessThanOrEqual(1);
    }, 240000);
  }
});
