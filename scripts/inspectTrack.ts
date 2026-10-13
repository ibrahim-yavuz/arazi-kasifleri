/** Prints path lengths, bridges, feature positions and scenery counts of the race track (dev tool). */
import { buildTrack } from '../src/world/TrackBuilder';
import { RACE_TRACK } from '../src/world/TrackData';
const t0 = performance.now();
const t = buildTrack(RACE_TRACK);
console.log('build ms', (performance.now() - t0).toFixed(0));
for (const p of t.pathList) {
  console.log(p.def.id, 'length', p.length.toFixed(0), 'bridges', JSON.stringify((t.bridgeSpans.get(p.def.id) ?? []).map((b) => [Math.round(b.from), Math.round(b.to)])));
  if (process.argv[2] === p.def.id) {
    const row = [];
    for (let s = 0; s <= p.length; s += 25) {
      const a = p.at(s);
      const b = p.at(Math.min(p.length, s + 12));
      const c = p.at(Math.max(0, s - 12));
      let dh = Math.atan2(b.tx, b.tz) - Math.atan2(c.tx, c.tz);
      while (dh > Math.PI) dh -= 2 * Math.PI;
      while (dh < -Math.PI) dh += 2 * Math.PI;
      row.push(`${s}:(${a.x.toFixed(0)},${a.z.toFixed(0)}) y${a.y.toFixed(0)} turn${(dh * 57.3 / 24 * 10).toFixed(0)}°/10m`);
    }
    console.log('  ' + row.join('\n  '));
  }
}
console.log('bridges', t.bridges.length, 'scenery', Object.fromEntries(Object.entries(t.scenery).map(([k, v]) => [k, v.length])));
