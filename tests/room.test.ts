import { describe, expect, it } from 'vitest';
import type { ServerMsg } from '../src/net/protocol';
import { Room } from '../src/net/room';
import { getTrack } from '../src/sim/track';
import { trackById } from '../src/sim/tracks';

function peer(id: string) {
  const got: ServerMsg[] = [];
  return { p: { id, send: (m: ServerMsg) => got.push(m) }, got, last: <T extends ServerMsg['t']>(t: T) => [...got].reverse().find((m) => m.t === t) as Extract<ServerMsg, { t: T }> | undefined };
}

describe('room', () => {
  it('first player hosts; only the host changes settings and starts', () => {
    const room = new Room('ABCD');
    const a = peer('a'), b = peer('b');
    room.add(a.p, 'Ann', 'hal');
    room.add(b.p, 'Bo<b>', 'nope');
    const info = b.last('room')!;
    expect(info.host).toBe('a');
    expect(info.players.map((p) => p.name)).toEqual(['Ann', 'Bob']);
    expect(info.players[1].char).toBe('hal'); // unknown character falls back
    room.handle('b', { t: 'settings', settings: { track: 'nacho', laps: 9, fill: false } });
    expect(room.settings.track).toBe('picnic');
    room.handle('a', { t: 'settings', settings: { track: 'nacho', laps: 9, fill: true } });
    expect(room.settings).toEqual({ track: 'nacho', laps: 5, fill: true });
    room.handle('b', { t: 'start' });
    expect(room.race).toBeNull();
    room.handle('a', { t: 'start' });
    expect(room.race).not.toBeNull();
    const race = b.last('race')!;
    expect(race.entrants.length).toBe(8);
    expect(race.entrants.filter((e) => !e.bot).map((e) => e.id)).toEqual(['a', 'b']);
  });

  it('a whole race with two reporting players reaches results, and the host passes on', () => {
    const room = new Room('WXYZ');
    const a = peer('a'), b = peer('b');
    room.add(a.p, 'Ann', 'glaze');
    room.add(b.p, 'Bob', 'fizz');
    room.handle('a', { t: 'settings', settings: { track: 'picnic', laps: 1, fill: true } });
    room.handle('a', { t: 'start' });
    const race = room.race!;
    const tr = getTrack(trackById('picnic'));
    // Player "a" drives the centerline at 24 m/s; "b" leaves mid-race and a CPU takes over.
    const ka = race.racer('a')!.kart;
    let s = ka.s;
    let ticks = 0;
    while (room.race && ticks < 60 * 200) {
      room.tick();
      ticks++;
      if (race.time > 0) {
        s += 24 / 60;
        const p = tr.pointAt(s, 0);
        if (ticks % 3 === 0) room.handle('a', { t: 'st', s: { x: p.x, y: p.y, z: p.z, h: p.h, sp: 24, dr: 0, tr: 0, air: false, boost: false, fall: false } });
      }
      if (ticks === 60 * 10) room.remove('b');
    }
    expect(room.race).toBeNull();
    const done = a.got.find((m) => m.t === 'ev' && m.e.k === 'done');
    expect(done).toBeTruthy();
    const results = (done as { e: { results: { id: string; time: number | null }[] } }).e.results;
    expect(results.find((r) => r.id === 'a')!.time).toBeGreaterThan(25);
    expect(a.got.some((m) => m.t === 'snap')).toBe(true);
    expect(a.last('room')!.phase).toBe('lobby');
    room.remove('a');
    expect(room.size).toBe(0);
  });

  it('ignores teleporting reports', () => {
    const room = new Room('TELE');
    const a = peer('a');
    room.add(a.p, 'Ann', 'hal');
    room.handle('a', { t: 'start' });
    const k = room.race!.racer('a')!.kart;
    const x = k.x;
    room.handle('a', { t: 'st', s: { x: x + 500, y: 0, z: k.z + 500, h: 0, sp: 10, dr: 0, tr: 0, air: false, boost: false, fall: false } });
    expect(k.x).toBe(x);
  });
});
