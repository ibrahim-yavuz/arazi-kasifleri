/**
 * Road balance check: a "pro" and an "average" bot drive each road at both forks with every
 * car. Prints per-fork driving time, pickups and net time (hourglasses and quiz included).
 * Goal: for each skill level the three roads end up close; better driving always wins.
 * Usage: npm run check:balance
 */
import { VEHICLES } from '../src/data/vehicles';
import { COLLECTIBLE_RULES } from '../src/gameplay/CollectibleSystem';
import { QUIZ_RULES } from '../src/gameplay/QuizSystem';
import type { ChoiceRoute } from '../src/world/TrackTypes';
import { AVERAGE, PRO, runBot } from './botDriver';

const ROUTES: ChoiceRoute[] = ['hiz', 'bilgi', 'cesaret'];
/** Net time for a fork with a given share of right answers. */
const net = (l: { t: number; hg: number; q: number }, right: number) =>
  l.t - l.hg * COLLECTIBLE_RULES.hourglassBonusSeconds - l.q * (right * QUIZ_RULES.correctBonus - (1 - right) * QUIZ_RULES.wrongPenalty);

for (const [name, skill] of [['pro', PRO], ['average', AVERAGE]] as const) {
  console.log(`\n== ${name} driver ==   fork: drive s | hourglass | ? | net (quiz 100% / 60%)`);
  for (const r of ROUTES) {
    const acc = [0, 1].map(() => ({ t: 0, hg: 0, q: 0, n100: 0, n60: 0, resets: 0 }));
    for (let vi = 0; vi < VEHICLES.length; vi++) {
      const res = await runBot([r, r], vi, skill);
      res.legs.forEach((l, i) => {
        const a = acc[i];
        a.t += l.t / VEHICLES.length;
        a.hg += l.hg / VEHICLES.length;
        a.q += l.q / VEHICLES.length;
        a.n100 += net(l, 1) / VEHICLES.length;
        a.n60 += net(l, 0.6) / VEHICLES.length;
      });
      acc[0].resets += res.resets;
    }
    const cols = acc.map((a, i) => `fork${i + 1} ${a.t.toFixed(1)}s hg=${a.hg.toFixed(1)} ?=${a.q.toFixed(1)} net=${a.n100.toFixed(1)}/${a.n60.toFixed(1)}`);
    const tot100 = acc[0].n100 + acc[1].n100;
    const tot60 = acc[0].n60 + acc[1].n60;
    console.log(`${r.padEnd(8)} ${cols.join('  |  ')}  ||  total net ${tot100.toFixed(1)} / ${tot60.toFixed(1)}  resets=${acc[0].resets}`);
  }
}
