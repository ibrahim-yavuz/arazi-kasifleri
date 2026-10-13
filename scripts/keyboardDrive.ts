/**
 * Handling check with keyboard-style (on/off) inputs, like a human on a keyboard.
 * Reports spins, off-road time and lap time per car and route. Usage: npm run check:keyboard
 */
import { VEHICLES } from '../src/data/vehicles';
import type { ChoiceRoute } from '../src/world/TrackTypes';
import { runBot } from './botDriver';

const only = process.argv[2];
for (const route of ['hiz', 'bilgi', 'cesaret'] as ChoiceRoute[]) {
  for (let vi = 0; vi < VEHICLES.length; vi++) {
    if (only && VEHICLES[vi].id !== only) continue;
    const r = await runBot([route, route], vi);
    console.log(`${route.padEnd(8)} ${VEHICLES[vi].id.padEnd(8)} time=${r.t.toFixed(1)}s spins=${r.spins} offRoad=${r.offRoad.toFixed(1)}s resets=${r.resets} maxSlip=${r.maxBeta.toFixed(0)}° tilt=${r.maxTilt.toFixed(0)}° hourglass=${r.hg} ?=${r.q} net=${(r.t - 3 * r.hg).toFixed(1)}s ${r.why.join(' ')}`);
  }
}
