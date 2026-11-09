// A room: up to 8 players, a host who picks the track and laps, and a race when they start.
// No sockets here: the server wraps each connection as a Peer, and solo play uses one local Peer.

import { CHARACTERS, charById } from '../sim/characters';
import { Race, DT, type Entrant } from '../sim/race';
import { TRACKS, trackById } from '../sim/tracks';
import { MAX_RACERS, cleanName, type ClientMsg, type PlayerInfo, type RoomSettings, type ServerMsg } from './protocol';

export interface Peer {
  id: string;
  send(m: ServerMsg): void;
}

interface Member {
  peer: Peer;
  name: string;
  char: string;
  racing: boolean;
  lastEmote: number;
}

const SNAP_EVERY = 3; // ticks between snapshots (20 a second)

export class Room {
  readonly members = new Map<string, Member>();
  host = '';
  settings: RoomSettings = { track: TRACKS[0].id, laps: 3, fill: true };
  race: Race | null = null;
  private ticks = 0;
  private seed = 1;
  private now = 0;
  emptySince = 0;

  constructor(readonly code: string) {}

  get size(): number {
    return this.members.size;
  }

  add(peer: Peer, name: string, char: string): boolean {
    if (this.members.size >= MAX_RACERS) return false;
    this.members.set(peer.id, { peer, name: cleanName(name), char: validChar(char), racing: false, lastEmote: -9 });
    if (!this.host) this.host = peer.id;
    this.broadcastRoom();
    return true;
  }

  remove(id: string): void {
    if (!this.members.delete(id)) return;
    this.race?.takeOver(id);
    if (this.host === id) this.host = this.members.keys().next().value ?? '';
    if (this.race && ![...this.members.values()].some((m) => m.racing)) this.race = null;
    this.broadcastRoom();
  }

  handle(id: string, m: ClientMsg): void {
    const me = this.members.get(id);
    if (!me) return;
    const race = this.race;
    switch (m.t) {
      case 'char':
        if (!me.racing) {
          me.char = validChar(m.char);
          this.broadcastRoom();
        }
        break;
      case 'settings':
        if (id !== this.host || !m.settings) return;
        this.settings = {
          track: trackById(String(m.settings.track)).id,
          laps: Math.max(1, Math.min(5, Math.round(Number(m.settings.laps)) || 3)),
          fill: !!m.settings.fill,
        };
        this.broadcastRoom();
        break;
      case 'start':
        if (id === this.host && !this.race) this.start();
        break;
      case 'st':
        if (race && me.racing && m.s) race.report(id, m.s);
        break;
      case 'mt':
        if (race && me.racing) race.driftBoost(id, Number(m.tier));
        break;
      case 'use':
        if (race && me.racing) race.useItem(id);
        break;
      case 'ab':
        if (race && me.racing) race.useAbility(id);
        break;
      case 'emote': {
        const e = Math.round(Number(m.e));
        if (!(e >= 0 && e < 8) || this.now - me.lastEmote < 1.5) return;
        me.lastEmote = this.now;
        this.broadcast({ t: 'emote', id, e });
        break;
      }
    }
  }

  start(): void {
    const entrants: Entrant[] = [];
    for (const [id, m] of this.members) {
      m.racing = true;
      entrants.push({ id, name: m.name, char: m.char, bot: false });
    }
    if (this.settings.fill) {
      // CPUs take the characters nobody picked first, then repeats.
      const taken = new Set(entrants.map((e) => e.char));
      const pool = [...CHARACTERS.filter((c) => !taken.has(c.id)), ...CHARACTERS];
      let i = 0;
      while (entrants.length < MAX_RACERS) {
        const c = pool[i++ % pool.length];
        entrants.push({ id: 'cpu' + i, name: c.name, char: c.id, bot: true });
      }
    }
    // Players start at the back; CPUs fill the front of the grid.
    entrants.sort((a, b) => Number(a.bot ? 0 : 1) - Number(b.bot ? 0 : 1));
    this.seed = (this.seed * 1103515245 + 12345 + Date.now()) >>> 0;
    this.race = new Race(this.settings.track, this.settings.laps, entrants, this.seed, (e) => this.broadcast({ t: 'ev', e }, true));
    this.ticks = 0;
    this.broadcast({ t: 'race', track: this.settings.track, laps: this.settings.laps, entrants }, true);
    this.broadcastRoom();
  }


  tick(dt = DT): void {
    this.now += dt;
    const race = this.race;
    if (!race) return;
    race.tick(dt);
    if (++this.ticks % SNAP_EVERY === 0 || race.phase === 'done') this.broadcast({ t: 'snap', s: race.snapshot() }, true);
    if (race.phase === 'done') {
      this.race = null;
      for (const m of this.members.values()) m.racing = false;
      this.broadcastRoom();
    }
  }

  broadcastRoom(): void {
    const players: PlayerInfo[] = [...this.members].map(([id, m]) => ({ id, name: m.name, char: m.char, racing: m.racing }));
    for (const [id, m] of this.members) {
      m.peer.send({ t: 'room', code: this.code, you: id, host: this.host, phase: this.race ? 'race' : 'lobby', settings: this.settings, players });
    }
  }

  private broadcast(msg: ServerMsg, racersOnly = false): void {
    for (const m of this.members.values()) if (!racersOnly || m.racing) m.peer.send(msg);
  }
}

function validChar(c: unknown): string {
  return charById(String(c)).id;
}
