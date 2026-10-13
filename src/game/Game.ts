import { Color, Vector3 } from 'three';
import { FollowCamera } from '../camera/FollowCamera';
import type { CameraTarget } from '../camera/FollowCamera';
import { VEHICLES, getVehicleInfo } from '../data/vehicles';
import { NetClient } from '../net/NetClient';
import { normalizeRoomCode, sanitizeName } from '../net/protocol';
import type { RaceStart, RoomInfo, ServerMessage, Standing as NetStanding } from '../net/protocol';
import { OnlineMenu, RoomScreen } from '../ui/OnlineScreens';
import { PhysicsDebug } from '../physics/PhysicsDebug';
import { GROUP_STATIC, PhysicsWorld, initRapier, interactionGroups, safeRayDir } from '../physics/PhysicsWorld';
import type { Rapier } from '../physics/PhysicsWorld';
import { Renderer } from '../render/Renderer';
import { MainMenu, OptionsMenu, HowToPlay, ScoreBoard } from '../ui/MainMenu';
import { QuestionPanel } from '../ui/QuestionPanel';
import { RaceHUD, TrackIntro } from '../ui/RaceHUD';
import { PauseMenu, ResultsScreen } from '../ui/ResultsScreen';
import type { RaceResult } from '../ui/ResultsScreen';
import { TuningPanel } from '../ui/TuningPanel';
import { VehicleSelection } from '../ui/VehicleSelection';
import { el } from '../ui/dom';
import type { Nav, Screen } from '../ui/dom';
import { DustSystem } from '../vehicles/DustSystem';
import { GarageScene } from '../vehicles/GarageScene';
import type { Vehicle } from '../vehicles/Vehicle';
import { RACE_TRACK } from '../world/TrackData';
import { VALIDATION_TRACK } from '../world/ValidationTrackData';
import { World, nextFrame } from '../world/World';
import { AudioManager } from './AudioManager';
import { GameLoop } from './GameLoop';
import { ENGINE_PULSES, WORLD_PHASES, isDevMode } from './GameState';
import type { Phase } from './GameState';
import { InputManager } from './InputManager';
import { RaceSession, soloEntries } from './RaceSession';
import type { CarEntry } from './RaceSession';
import { addScore, loadScores, loadSettings, saveSettings } from './Settings';
import type { Settings } from './Settings';
import { TestScene } from './TestScene';

const ROUTE_TOAST: Record<string, string> = { hiz: 'HIZ yolu', bilgi: 'BİLGİ yolu', cesaret: 'CESARET yolu' };

/** Top-level orchestration: phases, screens, loop, camera, audio. */
export class Game {
  private readonly renderer: Renderer;
  private readonly input = new InputManager();
  private readonly audio = new AudioManager();
  private settings: Settings = loadSettings();
  private phase: Phase = 'loading';
  private prevPhase: Phase = 'menu';
  private rapier!: Rapier;
  private physics!: PhysicsWorld;
  private world!: World;
  private session: RaceSession | null = null;
  private test: TestScene | null = null;
  private garage: GarageScene;
  private followCam!: FollowCamera;
  private readonly dust = new DustSystem();
  private debug!: PhysicsDebug;
  private readonly tuning: TuningPanel;
  private readonly loop: GameLoop;
  private readonly dev = isDevMode();
  private selected = 0;
  private raceCount = 0;
  private finishTimer = 0;
  private resultsShown = false;
  private time = 0;
  private fps = 60;
  private introT = 0;
  private stepped = false;
  private countdownHideAt = 0;
  // Online
  private net: NetClient | null = null;
  private room: RoomInfo | null = null;
  private onlineStandings: NetStanding[] = [];
  private onlineFinal = false;
  private finishReported = false;
  private readonly onlineMenu: OnlineMenu;
  private readonly roomScreen: RoomScreen;
  private readonly camTarget: CameraTarget = { position: new Vector3(), rotation: null as never, velocity: new Vector3(), airborne: false, speed: 0 };

  // UI
  private readonly ui: HTMLElement;
  private readonly screens: Partial<Record<Phase, Screen>> = {};
  private readonly menu: MainMenu;
  private readonly options: OptionsMenu;
  private readonly howto: HowToPlay;
  private readonly scores: ScoreBoard;
  private readonly select: VehicleSelection;
  private readonly intro: TrackIntro;
  private readonly hud: RaceHUD;
  private readonly question: QuestionPanel;
  private readonly pause: PauseMenu;
  private readonly results: ResultsScreen;
  private readonly testHelp: HTMLElement;

  constructor(private readonly container: HTMLElement, ui: HTMLElement) {
    this.ui = ui;
    this.renderer = new Renderer(container, this.settings.quality);
    this.audio.setVolume(this.settings.volume, this.settings.muted);
    this.garage = new GarageScene(VEHICLES);
    this.garage.scene.background = new Color(0x0c0d0e);
    this.tuning = new TuningPanel(ui);

    this.menu = new MainMenu(ui, {
      newGame: () => this.setPhase('select'),
      online: () => void this.openOnline(),
      options: () => this.setPhase('options'),
      howTo: () => this.setPhase('howto'),
      scores: () => this.setPhase('scores'),
      click: () => this.audio.click(),
    });
    this.options = new OptionsMenu(ui, () => this.settings, (s) => this.applySettings(s), () => this.setPhase(this.prevPhase === 'paused' ? 'paused' : 'menu'));
    this.howto = new HowToPlay(ui, () => this.setPhase('menu'));
    this.scores = new ScoreBoard(ui, loadScores, () => this.setPhase('menu'));
    this.select = new VehicleSelection(
      ui,
      VEHICLES,
      (i) => {
        this.selected = i;
        this.garage.select(i);
        this.audio.click();
      },
      (i) => this.startRace(i),
      () => this.setPhase('menu'),
    );
    this.intro = new TrackIntro(ui, () => this.beginCountdown(), () => this.leaveRace('select'));
    this.hud = new RaceHUD(ui);
    this.question = new QuestionPanel(ui, (c) => this.session?.answer(c));
    this.pause = new PauseMenu(ui, {
      resume: () => this.resume(),
      restart: () => {
        this.resume();
        this.restartRace();
      },
      toggleSound: () => {
        this.settings.muted = !this.settings.muted;
        this.audio.setVolume(this.settings.volume, this.settings.muted);
        saveSettings(this.settings);
        return !this.settings.muted;
      },
      menu: () => this.leaveRace('menu'),
      leaveRoom: () => this.leaveRoom(),
    });
    this.results = new ResultsScreen(ui, {
      replay: () => this.restartRace(),
      change: () => this.leaveRace('select'),
      menu: () => this.leaveRace('menu'),
      backToRoom: () => this.backToRoom(),
      leaveRoom: () => this.leaveRoom(),
    });
    this.onlineMenu = new OnlineMenu(ui, {
      setName: (n) => this.setPlayerName(n),
      create: (isPublic, fillAI) => this.net?.send({ type: 'createRoom', isPublic, fillAI }),
      join: (code) => this.net?.send({ type: 'joinRoom', code }),
      refresh: () => this.net?.send({ type: 'listRooms' }),
      back: () => this.closeOnline(),
    });
    this.roomScreen = new RoomScreen(ui, VEHICLES, {
      vehicle: (d) => {
        const cur = VEHICLES.findIndex((v) => v.id === this.roomScreen.vehicleId);
        const next = VEHICLES[(Math.max(0, cur) + d + VEHICLES.length) % VEHICLES.length];
        this.net?.send({ type: 'setVehicle', vehicleId: next.id });
        this.audio.click();
      },
      toggleReady: () => {
        const me = this.room?.players.find((p) => p.id === this.net?.id);
        this.net?.send({ type: 'setReady', ready: !me?.ready });
      },
      start: () => this.net?.send({ type: 'startRace' }),
      options: (isPublic, fillAI) => this.net?.send({ type: 'setOptions', isPublic, fillAI }),
      rename: (n) => this.setPlayerName(n),
      leave: () => this.leaveRoom(),
    });
    this.testHelp = el('div', 'test-help', '', ui);
    this.testHelp.hidden = true;
    Object.assign(this.screens, {
      menu: this.menu,
      options: this.options,
      howto: this.howto,
      scores: this.scores,
      select: this.select,
      intro: this.intro,
      paused: this.pause,
      results: this.results,
      quiz: this.question,
      online: this.onlineMenu,
      room: this.roomScreen,
    });
    this.pause.setSound(!this.settings.muted);

    this.loop = new GameLoop(
      (dt) => this.fixedUpdate(dt),
      (alpha, dt) => this.render(alpha, dt),
    );
    window.addEventListener('resize', this.onResize);
    window.addEventListener('blur', this.onBlur);
    document.addEventListener('visibilitychange', this.onVisibility);
    window.addEventListener('keydown', this.unlockAudio);
    window.addEventListener('pointerdown', this.unlockAudio);
  }

  // --------------------------------------------------------------------------------------
  // Startup
  // --------------------------------------------------------------------------------------

  async start(progress: (t: string) => void): Promise<void> {
    progress('Fizik motoru yükleniyor...');
    this.rapier = await initRapier();
    this.physics = new PhysicsWorld(this.rapier);
    const testMode = new URLSearchParams(window.location.search).get('scene') === 'test';
    progress(testMode ? 'Test alanı hazırlanıyor...' : 'Arazi hazırlanıyor...');
    await nextFrame();
    this.world = await World.create(testMode ? VALIDATION_TRACK : RACE_TRACK, this.physics, this.settings.quality, progress);
    this.renderer.add(this.world.group);
    this.renderer.add(this.dust.points);
    this.followCam = new FollowCamera(this.renderer.camera, {
      heightAt: (x, z) => this.world.track.terrain.heightAt(x, z),
      occlusion: (from, to) => this.occlusion(from, to),
    });
    this.followCam.setMode(this.settings.cameraMode);
    this.debug = new PhysicsDebug(this.renderer.scene, this.ui);
    this.onResize();
    // Warm up the GPU with one render of the world so the first race frame does not stall.
    const fork = this.forkCenter();
    this.renderer.camera.position.set(fork.x, 40, fork.z + 80);
    this.renderer.camera.lookAt(fork);
    this.renderer.render();
    if (testMode) {
      this.test = new TestScene(this.world, this.physics, this.renderer.scene, this.dust, VEHICLES[0]);
      this.debug.setEnabled(true);
      this.setPhase('test');
      this.hud.show();
      this.followCam.snap(this.cameraTargetFor(this.test.vehicle));
    } else {
      this.setPhase('menu');
      // Shared room link: ?oda=KOD joins that room directly.
      const code = normalizeRoomCode(new URLSearchParams(window.location.search).get('oda') ?? '');
      if (code) void this.openOnline(code);
    }
    this.loop.start();
  }

  /** Centre of the route fork clearing (intro flyover target). */
  private forkCenter(): Vector3 {
    const p = this.world.track.def.plazas.find((x) => x.id === 'fork') ?? this.world.track.def.plazas[0];
    return new Vector3(p?.x ?? 0, p?.y ?? 0, p?.z ?? 0);
  }

  private readonly unlockAudio = () => {
    this.audio.unlock();
  };

  private occlusion(from: Vector3, to: Vector3): number | null {
    const dir = { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z };
    const len = Math.hypot(dir.x, dir.y, dir.z);
    if (len < 1e-3) return null;
    dir.x /= len;
    dir.y /= len;
    dir.z /= len;
    const ray = new this.rapier.Ray(from, safeRayDir(dir));
    const hit = this.physics.world.castRay(ray, len, true, undefined, interactionGroups(0xffff, GROUP_STATIC));
    return hit ? hit.timeOfImpact : null;
  }

  // --------------------------------------------------------------------------------------
  // Phases
  // --------------------------------------------------------------------------------------

  private setPhase(p: Phase): void {
    if (p !== this.phase) this.prevPhase = this.phase;
    this.phase = p;
    for (const [k, s] of Object.entries(this.screens)) {
      if (k === p) s!.show();
      else s!.hide();
    }
    const inRace = p === 'race' || p === 'paused' || p === 'quiz' || p === 'results';
    if (!inRace && p !== 'test') this.hud.hide();
    if (p === 'select') this.garage.select(this.selected);
    if (p === 'online') this.net?.send({ type: 'listRooms' });
    this.testHelp.hidden = p !== 'test';
    if (p !== 'race' && p !== 'test') this.audio.stopEngine();
    this.renderer.renderer.domElement.style.visibility = p === 'select' || p === 'room' || WORLD_PHASES.has(p) ? 'visible' : 'hidden';
  }

  private startRace(vehicleIndex: number): void {
    this.selected = vehicleIndex;
    this.session?.dispose();
    this.raceCount++;
    this.session = this.createSession(soloEntries(VEHICLES[vehicleIndex].id, this.raceCount * 7919), this.raceCount * 7919, false);
    this.intro.showControls(!this.settings.seenControls);
    this.introT = 0;
    this.setPhase('intro');
  }

  /** Creates a race session (solo or online) with the HUD/audio callbacks. */
  private createSession(entries: CarEntry[], seed: number, online: boolean): RaceSession {
    this.pause.setOnline(online);
    this.results.setOnline(online);
    return new RaceSession(
      this.world,
      this.physics,
      this.renderer.scene,
      entries,
      this.dust,
      {
        raceEvent: (e) => this.onRaceEvent(e),
        collected: (c) => {
          this.world.collectibles.burst(c.item);
          this.audio.collect(c.item.kind);
          if (c.item.kind === 'hourglass') this.hud.toast(`Kum saati −${c.timeBonus} sn`, 'good');
          else if (c.item.kind === 'sign') this.hud.toast(`Trafik işareti +${c.points}`, 'good');
          else if (c.item.kind === 'question') this.hud.toast('Soru işareti! Bitişte sorulacak', 'info');
          else this.hud.toast('TURBO!', 'info');
        },
        answered: (r) => this.audio.answer(r.correct),
        impact: (s) => this.audio.impact(s),
        countdownTick: (n) => {
          if (n > 0) {
            this.hud.countdown(String(n));
            this.audio.countdown(false);
          } else {
            this.hud.countdown('BAŞLA!');
            this.audio.countdown(true);
            this.countdownHideAt = this.time + 1;
          }
        },
        wrongWay: () => this.hud.toast('Ters yöndesin!', 'bad'),
        snapshot: online ? (cars) => this.net?.send({ type: 'snapshot', raceId: this.room?.raceId ?? 0, cars }) : undefined,
        aiFinished: online
          ? (carId, time, route) => this.net?.send({ type: 'finish', raceId: this.room?.raceId ?? 0, reports: [{ carId, time, route }] })
          : undefined,
      },
      seed,
      online,
    );
  }

  private beginCountdown(): void {
    if (!this.session) return;
    this.settings.seenControls = true;
    saveSettings(this.settings);
    this.session.restart();
    this.prepareRaceView();
    this.setPhase('race');
    this.audio.startEngine();
  }

  private prepareRaceView(): void {
    this.finishTimer = 0;
    this.resultsShown = false;
    this.hud.clearToasts();
    this.hud.showFinish(false);
    this.hud.countdown(null);
    this.hud.show();
    this.loop.resync();
    if (this.session) {
      this.session.syncVisuals(1, 0);
      this.followCam.snap(this.cameraTargetFor(this.session.player));
    }
  }

  private restartRace(): void {
    if (!this.session) return;
    this.session.restart();
    this.prepareRaceView();
    this.setPhase('race');
    this.audio.startEngine();
  }

  private leaveRace(to: Phase): void {
    this.session?.dispose();
    this.session = null;
    this.tuning.close();
    this.audio.suspend(false);
    this.setPhase(to);
  }

  private pauseGame(): void {
    if (this.phase !== 'race') return;
    this.setPhase('paused');
    // Online the race keeps running: only the solo game is actually paused.
    if (!this.session?.online) this.audio.suspend(true);
  }

  private resume(): void {
    if (this.phase !== 'paused') return;
    this.audio.suspend(false);
    if (!this.session?.online) this.loop.resync();
    this.setPhase('race');
  }

  // --------------------------------------------------------------------------------------
  // Online rooms
  // --------------------------------------------------------------------------------------

  private setPlayerName(n: string): void {
    this.settings.playerName = sanitizeName(n);
    saveSettings(this.settings);
    this.onlineMenu.setName(this.settings.playerName);
    this.net?.send({ type: 'hello', name: this.settings.playerName });
  }

  private async openOnline(joinCode?: string): Promise<void> {
    this.onlineMenu.setName(this.settings.playerName || '');
    this.setPhase('online');
    if (!this.net) {
      this.net = new NetClient();
      this.net.onMessage((m) => this.onServerMessage(m));
      this.net.onClose((reason) => this.onDisconnected(reason));
    }
    if (!this.net.connected) {
      this.onlineMenu.setStatus('Sunucuya bağlanılıyor...');
      try {
        await this.net.connect();
      } catch (e) {
        this.onlineMenu.setStatus(`${(e as Error).message} Sunucu çalışıyor mu? (npm run dev / npm start)`, true);
        return;
      }
      this.net.send({ type: 'hello', name: this.settings.playerName || 'Kaşif' });
      this.onlineMenu.setStatus('Bağlandı.');
    }
    this.net.send({ type: 'listRooms' });
    if (joinCode) this.net.send({ type: 'joinRoom', code: joinCode });
  }

  private closeOnline(): void {
    this.leaveRoom(false);
    this.net?.close();
    this.net = null;
    this.setPhase('menu');
  }

  private leaveRoom(toOnlineMenu = true): void {
    this.net?.send({ type: 'leaveRoom' });
    this.room = null;
    if (this.session?.online) {
      this.session.dispose();
      this.session = null;
    }
    this.audio.suspend(false);
    if (window.location.search.includes('oda=')) window.history.replaceState(null, '', window.location.pathname);
    if (toOnlineMenu) this.setPhase('online');
  }

  private backToRoom(): void {
    this.net?.send({ type: 'backToLobby' });
    if (this.session?.online) {
      this.session.dispose();
      this.session = null;
    }
    if (this.room) this.showRoom();
  }

  private showRoom(): void {
    if (!this.room || !this.net?.id) return;
    this.roomScreen.update(this.room, this.net.id);
    const vid = this.roomScreen.vehicleId;
    const idx = VEHICLES.findIndex((v) => v.id === vid);
    if (idx >= 0) this.selected = idx;
    if (this.phase !== 'room') this.setPhase('room');
    this.garage.select(this.selected);
  }

  private onServerMessage(m: ServerMessage): void {
    switch (m.type) {
      case 'roomList':
        this.onlineMenu.setRooms(m.rooms);
        break;
      case 'room': {
        const wasIn = !!this.room;
        this.room = m.room;
        if (!wasIn) window.history.replaceState(null, '', `${window.location.pathname}?oda=${m.room.code}`);
        const inRace = this.session?.online && ['race', 'paused', 'quiz', 'results'].includes(this.phase);
        if (!inRace || (this.phase === 'results' && m.room.phase === 'lobby')) {
          if (this.phase === 'results' && this.session?.online) {
            this.session.dispose();
            this.session = null;
          }
          this.showRoom();
        } else if (this.net?.id) {
          this.roomScreen.update(m.room, this.net.id);
        }
        break;
      }
      case 'leftRoom':
        this.room = null;
        break;
      case 'raceStart':
        this.startOnlineRace(m.start);
        break;
      case 'snapshot':
        this.session?.receiveSnapshots(m.cars);
        break;
      case 'standings':
        if (!this.room || m.raceId !== this.room.raceId) break;
        this.onlineStandings = m.standings;
        this.onlineFinal = m.final;
        if (this.phase === 'results') this.results.setStandings(this.onlineRows(), m.final);
        break;
      case 'error':
        if (this.phase === 'room') this.roomScreen.setStatus(m.message, true);
        else this.onlineMenu.setStatus(m.message, true);
        break;
      default:
        break;
    }
  }

  private onDisconnected(reason: string): void {
    this.room = null;
    if (this.session?.online) {
      this.session.dispose();
      this.session = null;
    }
    this.net = null;
    this.setPhase('online');
    this.onlineMenu.setStatus(`${reason} Tekrar bağlanmak için Ana Menü → ÇOK OYUNCULU.`, true);
  }

  private startOnlineRace(start: RaceStart): void {
    const myId = this.net?.id;
    if (!myId) return;
    const entries: CarEntry[] = start.grid.map((g) => ({
      carId: g.carId,
      kind: g.playerId === myId ? 'local' : g.playerId === null && start.aiHostId === myId ? 'ai' : 'remote',
      vehicleId: getVehicleInfo(g.vehicleId) ? g.vehicleId : 'panter',
      name: g.playerId === myId ? 'Sen' : g.name,
      slot: g.slot,
    }));
    if (!entries.some((e) => e.kind === 'local')) return;
    this.session?.dispose();
    this.session = this.createSession(entries, start.seed, true);
    this.onlineStandings = [];
    this.onlineFinal = false;
    this.finishReported = false;
    this.prepareRaceView();
    this.setPhase('race');
    this.audio.startEngine();
  }

  /** Online: report the local finish (after the quiz) to the server. */
  private reportFinish(): void {
    const s = this.session;
    if (!s?.online || this.finishReported) return;
    this.finishReported = true;
    this.net?.send({
      type: 'finish',
      raceId: this.room?.raceId ?? 0,
      reports: [{ carId: s.playerCarId, time: s.timer.total, route: s.routeLabel }],
    });
  }

  /** Server standings with live progress for cars still racing. */
  private onlineRows(): RaceResult['standings'] {
    const s = this.session;
    const rows = this.onlineStandings.length
      ? this.onlineStandings.map((x) => ({
          name: s && x.carId === s.playerCarId ? 'Sen' : x.name,
          vehicle: getVehicleInfo(x.vehicleId)?.name ?? x.vehicleId,
          route: x.route || '-',
          time: x.time,
          me: !!s && x.carId === s.playerCarId,
        }))
      : (s?.standings() ?? []).map((x) => ({ name: x.name, vehicle: x.vehicle, route: x.route, time: x.time, me: x.me }));
    return rows;
  }

  private onRaceEvent(e: import('../gameplay/RaceManager').RaceEvent): void {
    switch (e.type) {
      case 'routeSelected':
        this.hud.toast(e.switched ? `Yol değişti: ${ROUTE_TOAST[e.route]}` : `${e.leg + 1}. ayrım: ${ROUTE_TOAST[e.route]} seçildi`, 'info');
        this.audio.notice();
        break;
      case 'checkpoint':
        if (e.index > 0) {
          this.hud.toast(`Kontrol noktası ${e.index + 1}/${e.total}`, 'info');
          this.audio.notice();
        }
        break;
      case 'missedCheckpoint':
        this.hud.toast('Kontrol noktasını kaçırdın! (R: geri dön)', 'bad');
        break;
      case 'merge':
        this.hud.toast(e.leg + 1 < (this.session?.race.legCount ?? 1) ? 'Yollar birleşti, sıradaki ayrıma!' : 'Son düzlük!', 'info');
        this.audio.notice();
        break;
      case 'finish':
        this.hud.showFinish(true);
        this.audio.finish();
        this.audio.stopEngine();
        break;
      case 'finishRejected':
        this.hud.toast(e.reason === 'wrongDirection' ? 'Bitişe ters yönden girdin!' : 'Önce seçtiğin yolu tamamla!', 'bad');
        break;
      default:
        break;
    }
  }

  private showResults(): void {
    const s = this.session;
    if (!s) return;
    const route = s.routeLabel;
    const rank = s.online ? 0 : addScore({
      time: s.timer.total,
      vehicle: s.playerInfo.name,
      route,
      collected: s.collectibles.totalCollected,
      date: new Date().toLocaleDateString('tr-TR'),
    });
    const r: RaceResult = {
      totalTime: s.timer.total,
      rawTime: s.timer.elapsed,
      bonus: s.timer.bonusTotal,
      penalty: s.timer.penaltyTotal,
      route,
      vehicle: s.playerInfo.name,
      collected: s.collectibles.totalCollected,
      hourglasses: s.collectibles.counts.hourglass,
      signs: s.collectibles.counts.sign,
      turbos: s.collectibles.counts.turbo,
      correct: s.quiz?.correctCount ?? 0,
      wrong: s.quiz?.wrongCount ?? 0,
      score: s.collectibles.score + (s.quiz?.correctCount ?? 0) * 50,
      rank,
      standings: s.standings().map((x) => ({ name: x.name, vehicle: x.vehicle, route: x.route, time: x.time, me: x.me })),
    };
    if (s.online) {
      this.reportFinish();
      r.standings = this.onlineRows();
      r.rank = 0;
    }
    this.results.setResult(r);
    if (s.online) this.results.setStandings(r.standings, this.onlineFinal);
    this.resultsShown = true;
    this.setPhase('results');
  }

  private applySettings(s: Settings): void {
    this.settings = { ...s };
    saveSettings(this.settings);
    this.renderer.applyQuality(s.quality);
    this.audio.setVolume(s.volume, s.muted);
    this.pause.setSound(!s.muted);
    this.onResize();
  }

  // --------------------------------------------------------------------------------------
  // Loop
  // --------------------------------------------------------------------------------------

  private fixedUpdate(dt: number): void {
    if (this.phase === 'test' && this.test) {
      this.test.fixedStep(dt, this.input.state);
      this.stepped = true;
      return;
    }
    const s = this.session;
    if (!s) return;
    // Online races never pause (the other players keep driving).
    if (this.phase === 'race' || this.phase === 'quiz' || this.phase === 'results' || (this.phase === 'paused' && s.online)) {
      s.fixedStep(dt, this.input.state);
      this.stepped = true;
      if (s.phase === 'finished') this.finishTimer += dt;
    }
  }

  private handleInput(dt: number): void {
    const st = this.input.state;
    const navMap: Array<[Parameters<typeof st.consume>[0], Nav]> = [
      ['accelerate', 'up'],
      ['brake', 'down'],
      ['left', 'left'],
      ['right', 'right'],
      ['confirm', 'confirm'],
      ['pause', 'back'],
    ];
    const screen = this.screens[this.phase];
    if (screen?.onNav && this.phase !== 'race' && this.phase !== 'quiz') {
      const phase = this.phase;
      for (const [a, n] of navMap) {
        if (!st.consume(a)) continue;
        screen.onNav(n);
        if (this.phase !== phase) return; // the screen changed: drop the remaining presses
      }
      if (phase !== 'results') return;
    }
    if (this.phase === 'race' && this.session) {
      const s = this.session;
      if (st.consume('pause')) this.pauseGame();
      if (st.consume('reset')) s.resetPlayer();
      if (this.resultsShown === false && s.phase === 'finished' && st.consume('confirm')) this.finishTimer = 99;
    }
    if (this.phase === 'quiz' && this.session?.quiz) {
      const s = this.session;
      if (st.consumeCode('KeyA') || st.consumeCode('Digit1') || st.consumeCode('Numpad1')) s.answer(0);
      else if (st.consumeCode('KeyB') || st.consumeCode('Digit2') || st.consumeCode('Numpad2')) s.answer(1);
      s.quiz!.update(dt);
      if (s.quiz!.finished) this.showResults();
    }
    if (this.phase === 'test' && this.test) {
      for (let i = 0; i < 8; i++) {
        if (st.consumeCode(`Digit${i + 1}`)) this.test.teleport(i);
      }
      if (st.consumeCode('KeyV')) {
        this.selected = (this.selected + 1) % VEHICLES.length;
        this.test.setVehicle(VEHICLES[this.selected]);
        if (this.tuning.visible) this.tuning.open(this.test.vehicle.physics, this.followCam);
      }
      if (st.consume('reset')) this.test.teleport(0);
      if (st.consume('pause')) window.location.href = window.location.pathname;
    }
    if (WORLD_PHASES.has(this.phase) && this.followCam) {
      if (st.consume('camera')) {
        this.followCam.setMode(this.followCam.mode + 1);
        this.settings.cameraMode = this.followCam.mode;
        saveSettings(this.settings);
      }
      if (this.dev && st.consume('debug')) this.debug.setEnabled(!this.debug.enabled);
      if (this.dev && st.consume('tuning')) {
        const v = this.test?.vehicle ?? this.session?.player;
        if (v) this.tuning.toggle(v.physics, this.followCam);
      }
    }
  }

  private cameraTargetFor(v: Vehicle): CameraTarget {
    const t = this.camTarget;
    t.position.copy(v.renderPosition);
    t.rotation = v.renderRotation;
    v.physics.linearVelocity(t.velocity);
    t.airborne = v.physics.telemetry.airborne;
    t.speed = v.physics.telemetry.speed;
    return t;
  }

  private render(alpha: number, frameDt: number): void {
    this.time += frameDt;
    if (frameDt > 0) this.fps += (1 / frameDt - this.fps) * 0.05;
    this.handleInput(frameDt);
    // When the simulation did not advance (paused / question), render the latest state.
    const a = this.stepped ? alpha : 1;
    this.stepped = false;

    if (this.phase === 'select' || this.phase === 'room') {
      this.garage.update(frameDt);
      this.renderer.render(this.garage.scene, this.garage.camera);
    } else if (WORLD_PHASES.has(this.phase)) {
      this.renderWorld(a, frameDt);
    }
    if (this.session && this.phase === 'race' && this.finishTimer > 3 && !this.resultsShown) {
      // One question per "?" sign collected on the Bilgi road, then the results.
      if (this.session.startQuiz()) this.setPhase('quiz');
      else this.showResults();
    }
    this.input.state.endFrame();
  }

  private renderWorld(alpha: number, frameDt: number): void {
    const s = this.session;
    const active = this.test?.vehicle ?? s?.player;
    if (s) s.syncVisuals(alpha, this.phase === 'paused' ? 0 : frameDt);
    if (this.test) this.test.vehicle.syncVisual(alpha, frameDt);

    if (this.phase === 'intro') {
      this.introT += frameDt;
      const a = this.introT * 0.12;
      const cam = this.renderer.camera;
      const fork = this.forkCenter();
      cam.position.set(fork.x + Math.sin(a) * 95, fork.y + 38, fork.z + Math.cos(a) * 95);
      cam.lookAt(fork.x, fork.y, fork.z - 20);
    } else if (active) {
      this.followCam.update(this.cameraTargetFor(active), this.phase === 'paused' ? 0 : frameDt);
    }
    const focus = active ? active.renderPosition : this.renderer.camera.position;
    this.renderer.followShadows(focus);
    this.world.cull(this.renderer.camera.position.x, this.renderer.camera.position.z);
    if (s) this.world.collectibles.update(this.time, frameDt, s.collectibles);
    if (this.phase !== 'paused') this.dust.update(frameDt);

    if (active && (this.phase === 'race' || this.phase === 'test')) {
      const t = active.physics.telemetry;
      this.audio.updateEngine({
        rpm: t.rpm,
        maxRpm: active.physics.cfg.engine.maxRPM,
        throttle: t.throttle,
        speed: t.speed,
        slip: t.maxSlip,
        grounded: t.wheelsInContact / 4,
        pulses: ENGINE_PULSES[active.info.id] ?? 3,
      });
    }

    if (s && (this.phase === 'race' || this.phase === 'paused' || this.phase === 'quiz' || this.phase === 'results')) {
      const pt = s.player.physics.telemetry;
      this.hud.update({
        time: s.timer.total,
        speedKmh: pt.speedKmh,
        rpm: pt.rpm,
        maxRpm: s.player.physics.cfg.engine.maxRPM,
        gear: pt.gear,
        route: s.race.routes.some((r) => r) ? s.routeLabel : 'Seçilmedi',
        position: s.playerPosition(),
        racers: s.cars.length,
        collected: s.collectibles.totalCollected,
        score: s.collectibles.score,
        questions: s.collectibles.counts.question,
        turbo: s.turboTime,
        progress: s.race.progressFraction(),
      });
      if (this.countdownHideAt > 0 && this.time > this.countdownHideAt) {
        this.hud.countdown(null);
        this.countdownHideAt = 0;
      }
      if (this.phase === 'quiz' && s.quiz) this.question.update(s.quiz);
    }
    if (this.phase === 'test' && this.test) {
      const t = this.test.vehicle.physics.telemetry;
      this.hud.update({
        time: 0,
        speedKmh: t.speedKmh,
        rpm: t.rpm,
        maxRpm: this.test.vehicle.physics.cfg.engine.maxRPM,
        gear: t.gear,
        route: 'Test',
        position: 1,
        racers: 1,
        collected: 0,
        score: 0,
        questions: 0,
        turbo: 0,
        progress: 0,
      });
      this.testHelp.innerHTML = this.test.readout();
    }
    if (this.debug.enabled && active) {
      const list = this.test ? [this.test.vehicle.physics] : s ? s.allVehicles.map((v) => v.physics) : [];
      this.debug.update(list, this.fps);
    }
    this.renderer.render();
  }

  // --------------------------------------------------------------------------------------
  // Window events
  // --------------------------------------------------------------------------------------

  private readonly onResize = () => {
    this.renderer.resize();
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.garage.resize(w, h);
    this.dust.setViewportHeight(h * this.renderer.renderer.getPixelRatio());
  };

  private readonly onBlur = () => {
    this.input.state.clear();
    if (!this.session?.online) this.pauseGame();
  };

  private readonly onVisibility = () => {
    if (document.hidden) {
      this.input.state.clear();
      if (!this.session?.online) {
        this.pauseGame();
        this.audio.suspend(true);
      }
    } else {
      this.loop.resync();
      if (this.phase !== 'paused') this.audio.suspend(false);
    }
  };

  /** Dev/test helpers (used from the browser console and automated checks). */
  get debugInfo() {
    const s = this.session;
    return {
      phase: this.phase,
      fps: Math.round(this.fps),
      race: s ? { phase: s.phase, route: s.race.route, routes: s.race.routes.slice(), leg: s.race.leg, progress: s.race.passed.slice(), time: s.timer.total, finished: s.race.finished, question: s.quiz?.current?.id ?? null, questionsCollected: s.collectibles.counts.question } : null,
      player: s ? { pos: s.player.physics.position.toArray().map((x) => +x.toFixed(1)), kmh: +s.player.physics.telemetry.speedKmh.toFixed(1) } : null,
      rivals: s ? s.aiCars.map((c) => ({ name: c.driver!.name, route: c.driver!.routeLabel, progress: +c.driver!.progress().toFixed(3), finished: c.driver!.finished, time: c.driver!.finishTime })) : [],
      online: { connected: !!this.net?.connected, id: this.net?.id ?? null, room: this.room?.code ?? null, roomPhase: this.room?.phase ?? null, players: this.room?.players.length ?? 0, remotes: s ? s.remotes.length : 0, standings: this.onlineStandings.map((x) => `${x.name}:${x.time ?? '-'}`), final: this.onlineFinal },
      drawCalls: this.renderer.renderer.info.render.calls,
      triangles: this.renderer.renderer.info.render.triangles,
    };
  }

  autopilot(route: 'hiz' | 'bilgi' | 'cesaret' | Array<'hiz' | 'bilgi' | 'cesaret'> | null): void {
    this.session?.enableAutopilot(route);
  }

  dispose(): void {
    this.loop.stop();
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('blur', this.onBlur);
    document.removeEventListener('visibilitychange', this.onVisibility);
    window.removeEventListener('keydown', this.unlockAudio);
    window.removeEventListener('pointerdown', this.unlockAudio);
    this.session?.dispose();
    this.test?.dispose();
    this.world?.dispose();
    this.garage.dispose();
    this.dust.dispose();
    this.debug?.dispose();
    this.tuning.close();
    this.input.dispose();
    this.audio.dispose();
    this.physics?.dispose();
    this.renderer.dispose();
  }
}
