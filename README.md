# Arazi Kaşifleri

A browser-based 3D off-road racing game for 1–4 players. Built with TypeScript, Vite,
Three.js and Rapier. Everything you see and hear is procedural (cars, track, textures,
sounds and UI are made from scratch in code). All player-facing text is in Turkish.

## Run

```bash
npm install
npm run dev        # game on http://localhost:5173 + room server on :8787 (proxied at /ws)
npm run build      # type-check, client build (dist/) and server bundle (dist-server/)
npm start          # production: one Node server for the game and the rooms (PORT, default 8787)
npm test           # automated tests (vitest: gameplay, physics, AI race, room server)
npm run validate   # physics validation; writes docs/PHYSICS_RESULTS.md
npm run check:ai   # AI drives every car on every route; reports times and respawns
npm run check:keyboard  # keyboard-style (on/off input) bot: spins, off-road time, resets
npm run check:launch    # start equaliser: back-row car vs front-row car (should end ≈ 0 m)
```

Requires Node 20.19+ (or 22.12+) and a WebGL2-capable desktop browser.

## Multiplayer (1–4 players)

Main menu → **ÇOK OYUNCULU**:

1. Enter your name, then **ODA KUR** (create a room). Tick "Herkese açık oda" to make it
   public (it appears in everyone's room list), or leave it private. "Boş yerleri yapay
   zekâ doldursun" fills empty slots with AI rivals.
2. Share the link shown in the room (`https://your-site/?oda=KOD`, with a copy button).
   Opening it joins the room directly; friends can also type the 5-letter code or pick a
   public room from the list.
3. Everyone picks a car (← →) and presses **HAZIRIM**; the host presses **YARIŞI BAŞLAT**.
4. After the race the results update live as players finish; **Odaya Dön** goes back to
   the room for the next race.

**Fair start.** The grid order is shuffled every race. Cars that start in the back row
(13 m behind) get a start equaliser: an invisible copy of the car, fed the same inputs, drives
as if it had started on the front row, and a bounded push/pull (max ±3 m/s², first ~9 s)
steers the real car toward that position. After the start, every car is where it would
have been from the front row: measured within about ±1.4 m after 20 s, about 0.05 s
(`npm run check:launch`). It doesn't depend on the other players, so a slow leader cannot
hold anyone back.

**How it works.** Each browser simulates its own car with the full physics (and the host's
browser also simulates the AI cars). It sends compact snapshots about 20 times a second
through the server, which relays them to the room. Other cars are shown about 150 ms in
the past, interpolated, and exist in your physics world as solid kinematic bodies, so you
can bump into them. The server owns the rooms, the grid, the start signal and the
standings.

## Deploy

The game is one Docker image: a Node server that serves `dist/` and the WebSocket rooms on
one port (`PORT`, default 8080 in the image). Any host that runs a Docker container and
allows WebSockets works. Pages served over HTTPS automatically use `wss://`.

```bash
docker build -t arazi-kasifleri .
docker run -p 8080:8080 arazi-kasifleri   # → http://localhost:8080
```

Health check: `GET /healthz`.

- **Render:** New → Web Service → your Git repo → Runtime "Docker". No extra settings needed
  (Render sets `PORT`). Free instances sleep when idle; the first visit then takes
  ~30–50 s.
- **Fly.io:** `fly launch` (detects the Dockerfile; set the internal port to 8080), then
  `fly deploy`. Keep **one machine**: `fly scale count 1`.
- **Railway:** New project → Deploy from repo; it uses the Dockerfile and sets `PORT`.
- **Your own VPS:** run the container behind a reverse proxy (Caddy or nginx) that forwards
  WebSocket upgrades on `/ws`.

Run a **single instance**: rooms live in the server's memory, so two instances would not
see each other's rooms, and a restart ends the open rooms.

Extra URLs:
- `?oda=KOD` joins a multiplayer room directly (this is the share link).
- `?scene=test` is the physics validation scene: flat strip, slope, bump, moguls, ramp,
  rough landing, side slope, ice/mud and a turning pad, with live measurements. Keys 1–8
  teleport, V changes car, F3 shows debug lines, F4 opens the tuning panel.
- `?debug` enables the F3/F4 developer tools in a production build (they are always on
  under `npm run dev`).

## Controls

| Key | Action |
|---|---|
| W / ↑ | Throttle |
| S / ↓ | Brake. Hold it at a standstill to engage reverse. |
| A / ← , D / → | Steer |
| Space | Handbrake |
| A / B or 1 / 2 | Answer the end-of-race questions |
| R | Return the car to the last checkpoint |
| C | Camera: close chase / far chase / bonnet |
| Esc | Pause menu (online the race keeps running) |
| Enter | Confirm in menus |
| F3 / F4 | Physics debug lines / tuning panel (dev only) |

## Game flow

Main menu (TEK OYUNCU, ÇOK OYUNCULU, SEÇENEKLER, NASIL OYNANIR?, SKOR TABLOSU) → garage vehicle
selection → track introduction (with the controls guide before your first race) → 3-2-1
countdown → race → finish → results (standings against three AI rivals, time breakdown,
local leaderboard) → replay / change car / main menu.

The course has **two forks**. At each one you choose one of three roads; the roads merge
again before the next part of the course:

1. **Fork 1** (after the start): **HIZ** (left) · **BİLGİ** (centre) · **CESARET** (right).
2. **Fork 2** (after the first merge): the order is mirrored, **CESARET** (left) ·
   **BİLGİ** (centre) · **HIZ** (right).

You can pick a different road at each fork (for example Cesaret, then Bilgi).

- **HIZ**: the easiest road. About 770 m per fork, 28 m wide, smooth flowing curves,
  fenced, one bridge; almost no hourglasses, a couple of turbos. Safe but slow overall.
- **BİLGİ**: about 580 m per fork of winding, hilly road (20 m wide) with a bridge and
  **?** signs (five in total). The race never stops: after the finish you get one question
  per **?** collected (correct −3 s, wrong +3 s).
- **CESARET**: the hardest road but the best time. About 535 m per fork, 14 m wide, the
  most direct line: tight bends, a bridge, a kicker ramp, boulders, and on fork 2 a sand
  canyon and mud. Five hourglasses per fork on the driving line (up to −30 s in total).

Two rivers cross the valley. Every road that crosses water gets a bridge with a wooden
deck, solid railings and pillars; fall off and you are in the riverbed (R resets you).

Measured with a keyboard-style bot (same road at both forks): Cesaret 88–90 s raw, about
61–66 s net; Bilgi 85–87 s before the quiz (about 70 s even with every answer right); Hız
79–85 s.

Hourglasses take 3 s off your time, traffic signs give 100 points, and turbos add 2.5 s of
extra drive. Rivals collect pickups and answer the quiz by the same rules. A race takes
about 80–95 s. The race only counts if, at each fork, you cross your road's checkpoints in
order and then the merge gate.

## Architecture

```
src/
  main.ts                 bootstrap, WebGL check, loading screen
  game/                   Game (phases/screens/loop), GameLoop (fixed step + interpolation),
                          RaceSession (one race), TestScene, InputManager, AudioManager,
                          Settings, GameState
  physics/                PhysicsWorld (Rapier), VehiclePhysics (raycast vehicle), LaunchEqualizer,
                          VehicleConfig (centralised parameters + validation), TireModel,
                          Suspension, Drivetrain, Surfaces, TerrainCollision, PhysicsDebug,
                          SimHarness (headless)
  vehicles/               Vehicle (physics + visual), VehicleFactory, VehicleModels
                          (procedural cars), GarageScene, DustSystem
  world/                  TrackTypes, TrackData (race course), ValidationTrackData,
                          TrackBuilder (terrain + gates + props, pure data), TerrainData,
                          PathSampler, CheckpointManager, Terrain/Track/Scenery/
                          CollectibleVisuals (rendering), World
  gameplay/               RaceManager (progression rules), TimerSystem, CollectibleSystem,
                          QuestionSystem, AIDriver
  camera/FollowCamera.ts  chase camera with terrain/obstacle avoidance
  render/                 Renderer (lights, sky, fog, shadows), Textures (procedural)
  ui/                     menus, garage overlay, HUD, question panel, pause/results,
                          tuning panel, traffic-sign drawings
  data/                   vehicles.ts, questions.ts
  net/                    protocol.ts (shared client/server messages), NetClient
server/                     RoomManager (rooms, grid, start, standings), index.ts (HTTP + /ws)
scripts/validatePhysics.ts  repeatable headless physics measurements
tests/                      vitest suites (gameplay rules, physics, full AI race)
docs/                       reference analysis, validation report, test checklist
```

Rendering, physics, gameplay rules, UI and data are separate. Physics and gameplay run at
a fixed 60 Hz in `GameLoop`/`RaceSession`; rendering interpolates between the last two
physics states. The physics and track code have no DOM dependency, so the same code runs
in Node for tests and validation.

### Vehicle physics, in short

- One Rapier rigid body per car, with explicit mass, centre of mass and box-derived inertia.
  The pose is never written during driving; only `reset()` (R key / restart) moves it.
- Four suspension raycasts (Rapier). Each gives spring force k·x plus bump and rebound
  damping on the measured compression rate, a bump stop and anti-roll bars. Forces act
  along the suspension axis at the contact point.
- Tyres: per-wheel spin ω integrated implicitly with a linear slip-velocity tyre up to the
  peak slip ratio, then saturation with a fall-off; a lateral slip-angle curve; a friction
  ellipse for combined slip; load sensitivity; surface grip, rolling resistance and sinkage.
  A static-friction anchor stops parked cars creeping. `TireModel` is an interface, so a
  Pacejka or brush model can be dropped in.
- Drivetrain: torque curve, clutch slip at launch, five (or four) gears with automatic
  shifting by road speed, engine braking, rev limiter, open differentials,
  RWD/FWD/AWD with front split, reflected engine inertia.
- Brakes with front/rear bias, optional ABS, and a handbrake on the rear wheels with
  reduced rear lateral grip.
- Assists (`VehicleConfig.assists`, adjustable in the F4 panel): traction control, a
  yaw-rate turn assist (the car turns toward the yaw rate the steering asks for, capped by
  grip) and stability control (counter-torque plus throttle cut above 6° body slip) are
  **on**, because keyboard steering and throttle are on/off. Upright torque, air control
  and yaw damping are **off**.
- All forces are computed from the same pre-step state and then applied, so the result does
  not depend on wheel order.

See `docs/PHYSICS_VALIDATION.md` for measurements, the comparison with the reference and
known limitations.

## Known limitations (multiplayer)

- **Trust:** each browser reports its own finish time and simulates its own car, so a
  modified client could cheat. Fine among friends; not suited to competitive public
  leaderboards.
- **Background tabs:** browsers stop the game loop in hidden tabs. A player who switches
  tab freezes their own car, and if the host does, the AI cars freeze for everyone until
  they come back.
- **Collisions between players are one-sided:** your car bounces off the other car (a
  kinematic body), but you cannot push it; each player's own physics decides their car.
- Rooms are in memory: one server instance; a restart closes all rooms.
