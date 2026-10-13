# Physics validation and tuning report

All numbers come from `npm run validate` (headless Node, the same `VehiclePhysics`/Rapier
code as the browser, 60 Hz fixed step) on the validation track (`?scene=test` in the
browser). The full generated tables are in [`PHYSICS_RESULTS.md`](PHYSICS_RESULTS.md) and
the raw JSON in `validation-output/physics-results.json`.

**On targets.** There is no external ground truth for an arcade off-road game, so the
"expected behaviour" column holds qualitative design goals. Where there is no specific
goal, the target is a plausible off-road vehicle.

Vehicles: P = Panter (AWD SUV), Ö = Örümcek (RWD buggy), B = Boğa (AWD pickup),
A = Akrep (RWD hot-rod). Assists during validation: traction control **on** (it is part
of the shipped configs), ABS **on**, turn assist 0.8 and stability control **on** (added after
playtest feedback, see section 4), upright torque / air control / yaw damping **off**.

## 1. Comparison table

| # | Test | Expected behaviour | Implemented behaviour | Measured (P / Ö / B / A) | Difference | Next tuning change |
|---|---|---|---|---|---|---|
| 1 | Acceleration from rest | Cars reach a brisk pace within seconds after "BAŞLA" | Torque curve → automatic gearbox → open diffs → implicit wheel/tyre solve; clutch slip at launch | 0–50 km/h: 2.55 / 2.10 / 2.48 / 2.10 s · 0–100: 7.9 / 6.3 / 8.1 / 5.5 s | Feels arcade-quick | If the race feels too fast, reduce `finalDrive` or torque by about 10 % |
| 2 | Top speed (level dirt) | Speedometer needle mostly in the lower half of a 0–200 dial | Power/drag/rolling-resistance limited; Boğa limited by its 4-speed box | 148 / 139 / 132 / 171 km/h | Top speeds are higher than typical on-track speeds (60–110 km/h), which is intended so straights matter | Lower `dragFactor` for less difference between cars, or cap Akrep at about 160 |
| 3 | Braking from 80 km/h | Not observable | Service brake with front bias and ABS | 21.3 / 19.8 / 20.8 / 21.1 m · ≈1.2 g · locked fraction 0–2 % | Arcade grip (μ 1.3 after the handling rework) | Without ABS the same test locks 94 % of the time (measured before ABS) |
| 3b | Handbrake-only from 50 km/h | – | Rear brake torque + reduced rear lateral grip | 18–21 m, straight line | – | – |
| 4 | Turning radius vs speed | Cars take the tight fork turns at moderate speed | Tyre forces + yaw-rate turn assist (section 4); speed-dependent steering *input* limit (`highSpeedFactor` 0.55) | Full lock at 15 km/h: 4.6 / 4.1 / 5.7 / 4.9 m (kinematic 4.1 / 3.6 / 5.2 / 4.4); 30 km/h: 5.1–6.3 m at 1.0–1.14 g; 45 km/h full lock: 11.5–14.3 m (was 16.5–26.2 m before the rework); no rollovers | Radius > kinematic radius at low speed = slip angles, as expected | – |
| 5 | Suspension compression and rebound | Visible body pitch/roll on berms | Spring + bump/rebound damping on measured compression rate, bump stop, anti-roll bars | Static sag: predicted 0.101/0.100/0.099/0.089 m, measured 0.099/0.096/0.095/0.089 m; 0.5 m drop: peak 0.24–0.27 m, settles in 0.85–0.92 s with 1–2 reversals; 1.6 Hz natural frequency | Sag error ≤ 5 mm; damping ratio about 0.35 bump / 0.5 rebound | – |
| 6 | Jump stability (kicker ramp, 1.6 m) | Cars fly in a ballistic arc over crests and keep their attitude | No upright correction, no air control; gravity + angular momentum only | 50 km/h: 0.58 s air, 7.6 m, 2.3 m high, takeoff pitch ≈ +3°, landing pitch −23 to −28° · 70 km/h: 0.78 s, 14 m, landing −15 to −16° | Shows the physical "lip effect" (front leaves first, rear is still pushed up), worse at low speed | Track design compensates: landings on downslopes. If needed: `airControlTorque` ≈ 1500 (subtle, off by default) |
| 7 | Landing response | – | Suspension takes the load; bump stop beyond travel | Peak compression 0.41–0.51 m (past the 0.28–0.42 m travel, so bump stop engaged); back to 4 wheels level in 0.12–0.23 s (A: 1.13 s at 50 km/h); never upside down | Bottoming out on a 2.3 m drop is physically expected | Increase `travel` for Boğa/Akrep if landings feel harsh |
| 8 | Uneven terrain (moguls, rough zone) | Bumpy dirt roads with soft response | Diagonal mogul field (phase offset left/right) and fBm rough zone in the heightfield | Moguls 30 km/h: FR wheel contact 79–86 %, max roll 3.4–3.7°, RMS vertical accel 4.3–4.6 m/s²; 50 km/h: 6–13 % of time airborne, never inverted; rough zone 35 km/h: roll ≤ 4.5° | Wheels unload independently (FL≠FR), as required | – |
| 8b | Side slope (12°) at 40 km/h | Cars lean on side hills | – | Roll 12.3° (car follows the slope), all wheels in contact, completes | – | – |
| 8c | Slope: hold and hill start (≈8–9°) | – | Static-friction anchor for stopped contact patches | Handbrake creep 0–1 mm in 3 s; climbs 80 m in 4.2–4.9 s | Before the anchor: 0.6 m creep | – |
| 8d | Low grip (ice μ×0.2, mud μ×0.45) | – (design: risky surfaces on Cesaret) | Surface multiplier on grip and rolling resistance | Ice 0–50: 6.4 / 13.8 / 6.2 / 12.5 s (AWD vs RWD); braking 50→0 on ice 39–42 m; body slip on a 25 km/h half-lock turn 10–16° | Physically consistent (μ·g·driven-axle share) | – |
| 9 | Frame-rate independence | – | Fixed 1/60 s step, accumulator, interpolated rendering; input sampled per render frame | Same 10 s scripted run: 120 fps and 144 fps (±30 % jitter) give **0.000 m** difference from 60 fps; 30 fps gives 0.54–0.70 m because input is sampled once per 33 ms frame; a 0.6 s stall drops 0.467 s and the result is unchanged | Physics identical; only input latency quantisation differs at 30 fps | Optional: sample keyboard on events with timestamps |
| 9b | Determinism | – | – | Two identical runs: 0.000000 m difference | – | – |
| 10 | Recovery after rolling over / stuck | A reset key gets the player back on track | No automatic flip. R resets to the last checkpoint. AI respawns after 3 s stuck or 2.5 s off course | Flipped car stays inverted (upDot −1, assist off); after R: 4 wheels down, 36–41 km/h 2 s later | – | `uprightTorque` is available but off |
| – | Airborne ballistics | Ballistic arcs | Only gravity, drag and Rapier's tiny angular damping | Vertical accel −9.75 to −9.77 m/s² (drag); spin rate 1.154 → 1.078 rad/s over 1 s (damping 0.05 plus gyroscopic exchange) | – | – |

## 2. Bugs found by validation and fixed

1. **Order-dependent tyre forces.** Impulses were applied wheel by wheel, so later wheels
   saw an already-changed velocity. The car drifted 99 m sideways over 910 m with no
   steering input. Fixed by computing every wheel from the same pre-step state and applying
   afterwards. Drift is now 0.00 m.
2. **Gear hunting on low grip.** Wheelspin pushed wheel RPM over the upshift point. Shifts
   now use road speed, with a 0.6 s minimum time in gear; the limiter upshift still uses
   wheel RPM.
3. **Brake lock-up.** 94 % of braking time had locked wheels. Added ABS (configurable).
4. **Creep on slopes.** 0.6 m in 3 s under the handbrake. Added a static-friction anchor.
5. **Rapier heightfield ray misses.** Exactly vertical rays missed the heightfield at about
   17 % of positions in Rapier 0.21. Ray directions get a 1e-6 horizontal component
   (`safeRayDir`), which is covered by a test.
6. **Rear-drive spin-outs with keyboard input.** On/off throttle spun the RWD cars in
   corners. Added traction control (configurable) and moved both RWD cars to mild
   understeer. In the all-routes AI check (`scripts/debugAI.ts`), respawns dropped from 12
   to 1 (Örümcek on Cesaret's mud after the ramp).

## 4. Handling rework after playtest feedback

Playtest feedback: the cars **slid and spun out** and **turned too wide / sluggishly**. A
keyboard-style bot (`npm run check:keyboard`) reproduces how a person drives: steering
−1/0/+1, throttle and brake on/off. It drives every car on every route and counts spins
(body slip > 35°), off-road time and resets.

Changes:
- Tyres: friction 1.02–1.05 → 1.3, slide friction 0.68–0.75 → 0.85, rear lateral grip
  ×1.12 (stable balance on every car).
- Steering: rate 120–200 → 240°/s, return 360°/s, high-speed lock factor 0.36–0.42 → 0.55.
- New configurable assists (`VehicleConfig.assists`, F4 panel):
  - `turnAssist` (0.8): yaw torque toward the yaw rate the steering requests (kinematic
    bicycle model, capped at μ·g·1.1 / v), so the car responds to the keys at speed.
  - `stability` (1.0): counter-yaw torque and throttle cut once body slip exceeds 6°.

| Keyboard bot, 12 runs (4 cars × 3 routes) | Spins | Resets | Off-road time | Max body slip |
|---|---|---|---|---|
| Before | 15 | 13 | 0–11.6 s per run | up to 180° |
| Assists only | 6 | 7 | 0–24 s per run | up to 180° |
| Assists + grip/steering tune (old track) | 3 | 0 | 0 except Örümcek/Cesaret 7.5 s | 4–17° (one 180°) |
| Final, on the rebuilt rougher routes | 1 | 2 (both on Cesaret, by design the hardest road) | 0 s | Hız ≤ 6°, Bilgi ≤ 20°, Cesaret ≤ 70° |

The assists are deliberately stronger than "subtle": the first design called for subtle
assistance, but playtesting showed the simulation alone was not fun with keyboard input.
Set `turnAssist` and `stability` to 0 for the raw simulation.

## 5. Known limitations

- **Design approximations.** Every vehicle value is a design approximation tuned by feel.
- **Kicker-ramp landings are nose-down** (−15° to −28°). This is correct rigid-body physics
  for a car leaving a lip, but steeper than ideal for an arcade game. The track puts landings
  on downslopes; air control exists but is off.
- **Wheels have no colliders.** Contact with the ground is by ray only. Side impacts use the
  chassis boxes, which cover the wheel footprint, so a wheel can visually clip a fence post
  or rock edge.
- **Raycast suspension** cannot model a tyre hitting a vertical step with the front of the
  tread. Steps taller than the tyre radius are handled by the chassis collider.
- **Input at 30 fps** is quantised to frames (section 1, row 9). The physics itself is
  frame-rate independent.
- **Rollover is possible** (no upright assist by default). R resets to the last checkpoint.
- The **tyre model** is a simplified slip-ratio/slip-angle model with an ellipse, not a full
  Pacejka model. The `TireModel` interface allows swapping it.
- **AI rivals** use the same physics but ignore pickups. Their quiz answers are simulated
  (random with an accuracy setting).
