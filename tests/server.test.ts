import { describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { RoomManager } from '../server/RoomManager';
import { startServer } from '../server/index';
import type { ClientMessage, ServerMessage } from '../src/net/protocol';
import { normalizeRoomCode, sanitizeName } from '../src/net/protocol';

function setup() {
  let t = 1000;
  const rm = new RoomManager(() => t, (() => {
    let s = 7;
    return () => ((s = (s * 16807) % 2147483647) / 2147483647);
  })());
  const inbox = new Map<string, ServerMessage[]>();
  const connect = (id: string, name: string) => {
    inbox.set(id, []);
    rm.connect({ id, name, roomCode: null, send: (m) => inbox.get(id)!.push(m) });
    rm.handle(id, { type: 'hello', name });
  };
  const last = <T extends ServerMessage['type']>(id: string, type: T) =>
    [...inbox.get(id)!].reverse().find((m) => m.type === type) as Extract<ServerMessage, { type: T }> | undefined;
  const send = (id: string, m: ClientMessage) => rm.handle(id, m);
  return { rm, connect, last, send, inbox, advance: (ms: number) => (t += ms) };
}

describe('RoomManager', () => {
  it('creates a private room, joins by code, hides private rooms from the list', () => {
    const { connect, send, last } = setup();
    connect('a', 'Ali');
    connect('b', 'Ayşe');
    send('a', { type: 'createRoom', isPublic: false, fillAI: true });
    const room = last('a', 'room')!.room;
    expect(room.code).toHaveLength(5);
    expect(room.players[0]).toMatchObject({ name: 'Ali', host: true });
    send('b', { type: 'listRooms' });
    expect(last('b', 'roomList')!.rooms).toHaveLength(0);
    send('b', { type: 'joinRoom', code: room.code.toLowerCase() });
    const joined = last('b', 'room')!.room;
    expect(joined.players.map((p) => p.name)).toEqual(['Ali', 'Ayşe']);
    expect(new Set(joined.players.map((p) => p.vehicleId)).size).toBe(2); // different default cars
  });

  it('lists public rooms and limits rooms to 4 players', () => {
    const { connect, send, last } = setup();
    for (const id of ['a', 'b', 'c', 'd', 'e']) connect(id, id.toUpperCase());
    send('a', { type: 'createRoom', isPublic: true, fillAI: false });
    const code = last('a', 'room')!.room.code;
    send('e', { type: 'listRooms' });
    expect(last('e', 'roomList')!.rooms[0]).toMatchObject({ code, hostName: 'A', players: 1 });
    for (const id of ['b', 'c', 'd']) send(id, { type: 'joinRoom', code });
    send('e', { type: 'joinRoom', code });
    expect(last('e', 'error')!.message).toContain('dolu');
    send('e', { type: 'listRooms' });
    expect(last('e', 'roomList')!.rooms).toHaveLength(0); // full rooms are not listed
  });

  it('only the host starts, others must be ready, AI fills the grid with shuffled slots', () => {
    const { connect, send, last } = setup();
    connect('a', 'A');
    connect('b', 'B');
    send('a', { type: 'createRoom', isPublic: false, fillAI: true });
    const code = last('a', 'room')!.room.code;
    send('b', { type: 'joinRoom', code });
    send('b', { type: 'startRace' });
    expect(last('b', 'error')!.message).toContain('oda sahibi');
    send('a', { type: 'startRace' });
    expect(last('a', 'error')!.message).toContain('Hazır olmayan');
    send('b', { type: 'setReady', ready: true });
    send('a', { type: 'startRace' });
    const start = last('b', 'raceStart')!.start;
    expect(start.grid).toHaveLength(4);
    expect(start.grid.filter((g) => g.playerId === null)).toHaveLength(2);
    expect(new Set(start.grid.map((g) => g.slot))).toEqual(new Set([0, 1, 2, 3]));
    expect(start.aiHostId).toBe('a');
    expect(last('a', 'room')!.room.phase).toBe('racing');
  });

  it('relays snapshots only for cars the sender owns', () => {
    const { connect, send, last, inbox } = setup();
    connect('a', 'A');
    connect('b', 'B');
    send('a', { type: 'createRoom', isPublic: false, fillAI: true });
    const code = last('a', 'room')!.room.code;
    send('b', { type: 'joinRoom', code });
    send('b', { type: 'setReady', ready: true });
    send('a', { type: 'startRace' });
    const start = last('a', 'raceStart')!.start;
    const snap = (carId: string) => ({ carId, t: 1, p: [0, 0, 0], q: [0, 0, 0, 1], v: [0, 0, 0], sl: [0, 0, 0, 0], wr: [0, 0, 0, 0], st: 0, f: 0, rpm: 0, prog: 0 }) as never;
    const ai = start.grid.find((g) => g.playerId === null)!.carId;
    inbox.get('a')!.length = 0;
    send('b', { type: 'snapshot', raceId: start.raceId, cars: [snap('p-b'), snap(ai), snap('p-a')] });
    const relayed = last('a', 'snapshot')!.cars.map((c) => c.carId);
    expect(relayed).toEqual(['p-b']); // b may not speak for the AI or for a
    send('a', { type: 'snapshot', raceId: start.raceId, cars: [snap(ai)] });
    expect(last('b', 'snapshot')!.cars[0].carId).toBe(ai); // the AI host may
  });

  it('builds standings, finalises when every car finished, then returns to the lobby', () => {
    const { connect, send, last } = setup();
    connect('a', 'A');
    connect('b', 'B');
    send('a', { type: 'createRoom', isPublic: false, fillAI: false });
    const code = last('a', 'room')!.room.code;
    send('b', { type: 'joinRoom', code });
    send('b', { type: 'setReady', ready: true });
    send('a', { type: 'startRace' });
    const raceId = last('a', 'raceStart')!.start.raceId;
    send('b', { type: 'finish', raceId, reports: [{ carId: 'p-b', time: 50.5, route: 'Hız' }] });
    let st = last('a', 'standings')!;
    expect(st.final).toBe(false);
    expect(st.standings[0]).toMatchObject({ name: 'B', time: 50.5 });
    send('a', { type: 'finish', raceId, reports: [{ carId: 'p-a', time: 44, route: 'Cesaret' }, { carId: 'p-b', time: 1, route: 'x' }] });
    st = last('b', 'standings')!;
    expect(st.final).toBe(true);
    expect(st.standings.map((s) => s.name)).toEqual(['A', 'B']); // a cannot overwrite b's time
    expect(last('a', 'room')!.room.phase).toBe('results');
    send('b', { type: 'backToLobby' });
    expect(last('a', 'room')!.room.phase).toBe('lobby');
  });

  it('moves the host when the host leaves and deletes empty rooms', () => {
    const { rm, connect, send, last } = setup();
    connect('a', 'A');
    connect('b', 'B');
    send('a', { type: 'createRoom', isPublic: true, fillAI: true });
    const code = last('a', 'room')!.room.code;
    send('b', { type: 'joinRoom', code });
    rm.disconnect('a');
    expect(last('b', 'room')!.room.players).toEqual([expect.objectContaining({ id: 'b', host: true })]);
    send('b', { type: 'leaveRoom' });
    expect(rm.rooms.size).toBe(0);
  });

  it('times out slow finishers', () => {
    const { connect, send, last, advance, rm } = setup();
    connect('a', 'A');
    connect('b', 'B');
    send('a', { type: 'createRoom', isPublic: false, fillAI: false });
    const code = last('a', 'room')!.room.code;
    send('b', { type: 'joinRoom', code });
    send('b', { type: 'setReady', ready: true });
    send('a', { type: 'startRace' });
    const raceId = last('a', 'raceStart')!.start.raceId;
    send('a', { type: 'finish', raceId, reports: [{ carId: 'p-a', time: 40, route: 'Hız' }] });
    advance(91_000);
    rm.tick();
    const st = last('b', 'standings')!;
    expect(st.final).toBe(true);
    expect(st.standings[1].time).toBeNull();
  });

  it('sanitises names and codes', () => {
    expect(sanitizeName('  <b>Ali</b>  ')).toBe('bAli/b');
    expect(sanitizeName('')).toBe('Kaşif');
    expect(sanitizeName('x'.repeat(40))).toHaveLength(16);
    expect(normalizeRoomCode(' ab-c12x ')).toBe('ABC12');
  });
});

describe('server over WebSocket', () => {
  it('two clients create/join a room and see each other', async () => {
    const srv = await startServer(0);
    const url = `ws://localhost:${srv.port}/ws`;
    const open = (name: string) =>
      new Promise<{ ws: WebSocket; msgs: ServerMessage[] }>((done) => {
        const ws = new WebSocket(url);
        const msgs: ServerMessage[] = [];
        ws.on('message', (d) => msgs.push(JSON.parse(String(d))));
        ws.on('open', () => {
          ws.send(JSON.stringify({ type: 'hello', name }));
          done({ ws, msgs });
        });
      });
    const wait = (msgs: ServerMessage[], pred: (m: ServerMessage) => boolean) =>
      new Promise<ServerMessage>((done, fail) => {
        const t0 = Date.now();
        const poll = () => {
          const m = msgs.find(pred);
          if (m) return done(m);
          if (Date.now() - t0 > 3000) return fail(new Error('timeout'));
          setTimeout(poll, 10);
        };
        poll();
      });
    const a = await open('Ali');
    const b = await open('Veli');
    a.ws.send(JSON.stringify({ type: 'createRoom', isPublic: true, fillAI: true }));
    const room = (await wait(a.msgs, (m) => m.type === 'room')) as Extract<ServerMessage, { type: 'room' }>;
    b.ws.send(JSON.stringify({ type: 'joinRoom', code: room.room.code }));
    const seen = await wait(a.msgs, (m) => m.type === 'room' && m.room.players.length === 2);
    expect((seen as Extract<ServerMessage, { type: 'room' }>).room.players.map((p) => p.name)).toEqual(['Ali', 'Veli']);
    const res = await fetch(`http://localhost:${srv.port}/healthz`);
    expect(await res.text()).toBe('ok');
    a.ws.close();
    b.ws.close();
    await srv.close();
  });
});
