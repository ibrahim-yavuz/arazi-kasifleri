import {
  MAX_PLAYERS,
  RESULTS_TIMEOUT,
  normalizeRoomCode,
  randomRoomCode,
  sanitizeName,
} from '../src/net/protocol';
import type {
  ClientMessage,
  FinishReport,
  GridEntry,
  PlayerInfo,
  RaceStart,
  RoomInfo,
  RoomPhase,
  RoomSummary,
  ServerMessage,
  Standing,
} from '../src/net/protocol';

export const VEHICLE_IDS = ['panter', 'orumcek', 'boga', 'akrep'];
const VEHICLE_NAMES: Record<string, string> = { panter: 'Panter', orumcek: 'Örümcek', boga: 'Boğa', akrep: 'Akrep' };

export interface Connection {
  id: string;
  name: string;
  roomCode: string | null;
  send(msg: ServerMessage): void;
}

interface Member {
  id: string;
  name: string;
  vehicleId: string;
  ready: boolean;
  joinedAt: number;
}

interface RaceState {
  start: RaceStart;
  reports: Map<string, FinishReport>;
  firstFinishAt: number | null;
  final: boolean;
}

class Room {
  readonly members = new Map<string, Member>();
  hostId: string;
  phase: RoomPhase = 'lobby';
  raceId = 0;
  race: RaceState | null = null;
  lastActive = Date.now();

  constructor(
    readonly code: string,
    public isPublic: boolean,
    public fillAI: boolean,
    host: Member,
  ) {
    this.hostId = host.id;
    this.members.set(host.id, host);
  }

  info(): RoomInfo {
    const players: PlayerInfo[] = [...this.members.values()]
      .sort((a, b) => a.joinedAt - b.joinedAt)
      .map((m) => ({ id: m.id, name: m.name, vehicleId: m.vehicleId, ready: m.ready, host: m.id === this.hostId }));
    return { code: this.code, isPublic: this.isPublic, fillAI: this.fillAI, phase: this.phase, players, raceId: this.raceId };
  }
}

/**
 * All room/lobby/race-coordination rules (no networking). The server owns rooms, the grid,
 * the start signal and the standings; each browser simulates its own car (and the host's
 * browser the AI cars) and relays snapshots through the server.
 */
export class RoomManager {
  readonly conns = new Map<string, Connection>();
  readonly rooms = new Map<string, Room>();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly rnd: () => number = Math.random,
  ) {}

  connect(c: Connection): void {
    this.conns.set(c.id, c);
    c.send({ type: 'welcome', id: c.id });
  }

  disconnect(id: string): void {
    this.leave(id);
    this.conns.delete(id);
  }

  handle(id: string, msg: ClientMessage): void {
    const c = this.conns.get(id);
    if (!c || !msg || typeof msg !== 'object') return;
    const room = c.roomCode ? this.rooms.get(c.roomCode) ?? null : null;
    if (room) room.lastActive = this.now();
    switch (msg.type) {
      case 'hello':
        c.name = sanitizeName(msg.name);
        if (room) {
          const m = room.members.get(id);
          if (m) m.name = c.name;
          this.broadcastRoom(room);
        }
        break;
      case 'listRooms':
        c.send({ type: 'roomList', rooms: this.publicRooms() });
        break;
      case 'createRoom':
        this.createRoom(c, !!msg.isPublic, msg.fillAI !== false);
        break;
      case 'joinRoom':
        this.joinRoom(c, msg.code);
        break;
      case 'leaveRoom':
        this.leave(id);
        c.send({ type: 'leftRoom' });
        break;
      case 'setVehicle':
        if (room && room.phase !== 'racing' && VEHICLE_IDS.includes(msg.vehicleId)) {
          room.members.get(id)!.vehicleId = msg.vehicleId;
          this.broadcastRoom(room);
        }
        break;
      case 'setReady':
        if (room && room.phase !== 'racing') {
          room.members.get(id)!.ready = !!msg.ready;
          this.broadcastRoom(room);
        }
        break;
      case 'setOptions':
        if (room && room.hostId === id) {
          room.isPublic = !!msg.isPublic;
          room.fillAI = !!msg.fillAI;
          this.broadcastRoom(room);
        }
        break;
      case 'startRace':
        if (room) this.startRace(room, c);
        break;
      case 'snapshot':
        if (room && room.race && msg.raceId === room.raceId && Array.isArray(msg.cars)) {
          const owned = msg.cars.filter((s) => this.ownsCar(room, id, s.carId)).slice(0, MAX_PLAYERS);
          if (owned.length) this.broadcast(room, { type: 'snapshot', cars: owned }, id);
        }
        break;
      case 'finish':
        if (room && room.race && msg.raceId === room.raceId && Array.isArray(msg.reports)) {
          for (const r of msg.reports) {
            if (!this.ownsCar(room, id, r.carId) || room.race.reports.has(r.carId)) continue;
            const time = Number(r.time);
            if (!Number.isFinite(time) || time < 0 || time > 3600) continue;
            room.race.reports.set(r.carId, { carId: r.carId, time, route: String(r.route ?? '').slice(0, 16) });
          }
          if (room.race.firstFinishAt === null && room.race.reports.size > 0) room.race.firstFinishAt = this.now();
          this.sendStandings(room);
        }
        break;
      case 'backToLobby':
        if (room && room.phase === 'results') {
          room.phase = 'lobby';
          room.race = null;
          for (const m of room.members.values()) m.ready = false;
          this.broadcastRoom(room);
        }
        break;
      default:
        break;
    }
  }

  /** Call periodically: results time-outs and cleanup of idle rooms. */
  tick(): void {
    const now = this.now();
    for (const room of this.rooms.values()) {
      const r = room.race;
      if (r && !r.final && r.firstFinishAt !== null && now - r.firstFinishAt > RESULTS_TIMEOUT * 1000) {
        r.final = true;
        room.phase = 'results';
        this.sendStandings(room);
      }
    }
  }

  publicRooms(): RoomSummary[] {
    return [...this.rooms.values()]
      .filter((r) => r.isPublic && r.members.size < MAX_PLAYERS && r.phase !== 'racing')
      .slice(0, 50)
      .map((r) => ({ code: r.code, hostName: r.members.get(r.hostId)?.name ?? '?', players: r.members.size, phase: r.phase }));
  }

  private member(c: Connection): Member {
    const used = new Set<string>();
    const room = c.roomCode ? this.rooms.get(c.roomCode) : null;
    if (room) for (const m of room.members.values()) used.add(m.vehicleId);
    return { id: c.id, name: c.name, vehicleId: VEHICLE_IDS.find((v) => !used.has(v)) ?? VEHICLE_IDS[0], ready: false, joinedAt: this.now() };
  }

  private createRoom(c: Connection, isPublic: boolean, fillAI: boolean): void {
    this.leave(c.id);
    let code = randomRoomCode(this.rnd);
    while (this.rooms.has(code)) code = randomRoomCode(this.rnd);
    const room = new Room(code, isPublic, fillAI, this.member(c));
    this.rooms.set(code, room);
    c.roomCode = code;
    this.broadcastRoom(room);
  }

  private joinRoom(c: Connection, rawCode: string): void {
    const code = normalizeRoomCode(String(rawCode ?? ''));
    const room = this.rooms.get(code);
    if (!room) return c.send({ type: 'error', message: 'Oda bulunamadı.' });
    if (room.members.has(c.id)) return this.broadcastRoom(room);
    if (room.members.size >= MAX_PLAYERS) return c.send({ type: 'error', message: 'Oda dolu (en fazla 4 oyuncu).' });
    if (room.phase === 'racing') return c.send({ type: 'error', message: 'Bu odada yarış sürüyor. Biraz sonra tekrar dene.' });
    this.leave(c.id);
    c.roomCode = code;
    room.members.set(c.id, this.member(c));
    this.broadcastRoom(room);
  }

  private leave(id: string): void {
    const c = this.conns.get(id);
    if (!c || !c.roomCode) return;
    const room = this.rooms.get(c.roomCode);
    c.roomCode = null;
    if (!room) return;
    room.members.delete(id);
    if (room.members.size === 0) {
      this.rooms.delete(room.code);
      return;
    }
    if (room.hostId === id) {
      room.hostId = [...room.members.values()].sort((a, b) => a.joinedAt - b.joinedAt)[0].id;
    }
    this.broadcastRoom(room);
    if (room.race && !room.race.final) this.sendStandings(room);
  }

  private startRace(room: Room, c: Connection): void {
    if (room.hostId !== c.id) return c.send({ type: 'error', message: 'Yarışı yalnızca oda sahibi başlatabilir.' });
    if (room.phase === 'racing') return;
    const notReady = [...room.members.values()].filter((m) => m.id !== room.hostId && !m.ready);
    if (notReady.length) return c.send({ type: 'error', message: `Hazır olmayan oyuncular: ${notReady.map((m) => m.name).join(', ')}` });
    room.raceId++;
    const humans = [...room.members.values()].sort((a, b) => a.joinedAt - b.joinedAt);
    const entries: Omit<GridEntry, 'slot'>[] = humans.map((m) => ({ carId: `p-${m.id}`, playerId: m.id, name: m.name, vehicleId: m.vehicleId }));
    if (room.fillAI) {
      const used = new Set(humans.map((m) => m.vehicleId));
      const free = VEHICLE_IDS.filter((v) => !used.has(v));
      let i = 0;
      while (entries.length < MAX_PLAYERS) {
        const v = free[i % Math.max(1, free.length)] ?? VEHICLE_IDS[i % VEHICLE_IDS.length];
        entries.push({ carId: `ai-${i}`, playerId: null, name: `Rakip ${VEHICLE_NAMES[v]}`, vehicleId: v });
        i++;
      }
    }
    // Random grid order every race; rear slots get the launch catch-up boost.
    const slots = entries.map((_, i) => i);
    for (let i = slots.length - 1; i > 0; i--) {
      const j = Math.floor(this.rnd() * (i + 1));
      [slots[i], slots[j]] = [slots[j], slots[i]];
    }
    const grid: GridEntry[] = entries.map((e, i) => ({ ...e, slot: slots[i] }));
    const start: RaceStart = { raceId: room.raceId, seed: Math.floor(this.rnd() * 1e9), grid, aiHostId: room.hostId };
    room.race = { start, reports: new Map(), firstFinishAt: null, final: false };
    room.phase = 'racing';
    for (const m of room.members.values()) m.ready = false;
    this.broadcast(room, { type: 'raceStart', start });
    this.broadcastRoom(room);
  }

  private ownsCar(room: Room, playerId: string, carId: string): boolean {
    const e = room.race?.start.grid.find((g) => g.carId === carId);
    if (!e) return false;
    if (e.playerId === playerId) return true;
    return e.playerId === null && room.race!.start.aiHostId === playerId;
  }

  private standings(room: Room): Standing[] {
    const r = room.race!;
    return r.start.grid
      .map((g) => {
        const rep = r.reports.get(g.carId);
        return { carId: g.carId, name: g.name, vehicleId: g.vehicleId, route: rep?.route ?? '', time: rep ? rep.time : null, ai: g.playerId === null };
      })
      .sort((a, b) => (a.time ?? Infinity) - (b.time ?? Infinity));
  }

  private sendStandings(room: Room): void {
    const r = room.race;
    if (!r) return;
    // Cars still expected: human cars whose player is in the room, and AI cars if the AI host is present.
    const pending = r.start.grid.filter((g) => {
      if (r.reports.has(g.carId)) return false;
      if (g.playerId) return room.members.has(g.playerId);
      return room.members.has(r.start.aiHostId);
    });
    if (pending.length === 0) {
      r.final = true;
      room.phase = 'results';
    }
    this.broadcast(room, { type: 'standings', raceId: r.start.raceId, standings: this.standings(room), final: r.final });
    if (r.final) this.broadcastRoom(room);
  }

  private broadcastRoom(room: Room): void {
    this.broadcast(room, { type: 'room', room: room.info() });
  }

  private broadcast(room: Room, msg: ServerMessage, exceptId?: string): void {
    for (const id of room.members.keys()) {
      if (id === exceptId) continue;
      this.conns.get(id)?.send(msg);
    }
  }
}
