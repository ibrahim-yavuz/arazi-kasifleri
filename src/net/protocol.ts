/**
 * Client ⇄ server messages (JSON over one WebSocket at /ws). Shared by the browser client
 * and the Node server, so both sides agree on the shapes.
 */

export const MAX_PLAYERS = 4;
export const MAX_NAME = 16;
export const ROOM_CODE_LENGTH = 5;
/** Seconds between the start message and the green light (countdown). */
export const COUNTDOWN_SECONDS = 3;
/** Seconds the server waits for slower players after the first finisher reports. */
export const RESULTS_TIMEOUT = 90;

export type RoomPhase = 'lobby' | 'racing' | 'results';

export interface PlayerInfo {
  id: string;
  name: string;
  vehicleId: string;
  ready: boolean;
  host: boolean;
}

export interface RoomInfo {
  code: string;
  isPublic: boolean;
  fillAI: boolean;
  phase: RoomPhase;
  players: PlayerInfo[];
  /** Increments every race, so stale race messages can be ignored. */
  raceId: number;
}

export interface RoomSummary {
  code: string;
  hostName: string;
  players: number;
  phase: RoomPhase;
}

/** One car on the grid. `playerId` null = AI driven by the host's browser. */
export interface GridEntry {
  carId: string;
  playerId: string | null;
  name: string;
  vehicleId: string;
  slot: number;
}

export interface RaceStart {
  raceId: number;
  seed: number;
  grid: GridEntry[];
  /** The player whose browser simulates the AI cars. */
  aiHostId: string;
}

/** Compact car state sent ~20 times per second by the client that simulates the car. */
export interface CarSnapshot {
  carId: string;
  /** Race clock of the sender (s since the green light, may be negative in the countdown). */
  t: number;
  p: [number, number, number];
  q: [number, number, number, number];
  v: [number, number, number];
  /** Suspension lengths, wheel spin angles (rad), steer angle (rad). */
  sl: [number, number, number, number];
  wr: [number, number, number, number];
  st: number;
  /** Flags: 1 = braking, 2 = reversing, 4 = turbo. */
  f: number;
  rpm: number;
  /** Distance along the course (m) for live positions. */
  prog: number;
}

export interface FinishReport {
  carId: string;
  /** Final race time after pickups and the quiz (s). */
  time: number;
  route: string;
}

export interface Standing {
  carId: string;
  name: string;
  vehicleId: string;
  route: string;
  time: number | null;
  ai: boolean;
}

export type ClientMessage =
  | { type: 'hello'; name: string }
  | { type: 'listRooms' }
  | { type: 'createRoom'; isPublic: boolean; fillAI: boolean }
  | { type: 'joinRoom'; code: string }
  | { type: 'leaveRoom' }
  | { type: 'setVehicle'; vehicleId: string }
  | { type: 'setReady'; ready: boolean }
  | { type: 'setOptions'; isPublic: boolean; fillAI: boolean }
  | { type: 'startRace' }
  | { type: 'snapshot'; raceId: number; cars: CarSnapshot[] }
  | { type: 'finish'; raceId: number; reports: FinishReport[] }
  | { type: 'backToLobby' };

export type ServerMessage =
  | { type: 'welcome'; id: string }
  | { type: 'roomList'; rooms: RoomSummary[] }
  | { type: 'room'; room: RoomInfo }
  | { type: 'leftRoom'; reason?: string }
  | { type: 'raceStart'; start: RaceStart }
  | { type: 'snapshot'; cars: CarSnapshot[] }
  | { type: 'standings'; raceId: number; standings: Standing[]; final: boolean }
  | { type: 'error'; message: string };

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function randomRoomCode(rnd: () => number = Math.random): string {
  let s = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) s += CODE_ALPHABET[Math.floor(rnd() * CODE_ALPHABET.length)];
  return s;
}

export function normalizeRoomCode(code: string): string {
  return code
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, ROOM_CODE_LENGTH);
}

export function sanitizeName(name: string): string {
  const n = String(name ?? '')
    .replace(/[<>"'`\\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_NAME);
  return n || 'Kaşif';
}
