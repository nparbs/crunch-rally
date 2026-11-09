// Messages between a page and a room. The same messages are used for online rooms (over a
// WebSocket) and solo races (a room running inside the page).

import type { KartReport, RaceEvent, Snapshot, Entrant } from '../sim/race';
import type { CpuLevel } from '../sim/bot';

/** Bump when old pages can no longer talk to the server; open pages are told to refresh. */
export const PROTOCOL_VERSION = 1;
export const MAX_RACERS = 8;

export interface RoomSettings {
  track: string;
  laps: number; // 1..5
  fill: boolean; // fill empty seats with CPU racers
  cpu: CpuLevel; // CPU difficulty
}

export interface PlayerInfo {
  id: string;
  name: string;
  char: string;
  racing: boolean; // in the current race (false = waiting for the next one)
}

export type ClientMsg =
  | { t: 'create'; v: number; name: string; char: string }
  | { t: 'join'; v: number; code: string; name: string; char: string }
  | { t: 'char'; char: string }
  | { t: 'settings'; settings: RoomSettings }
  | { t: 'start' }
  | { t: 'st'; s: KartReport }
  | { t: 'mt'; tier: number }
  | { t: 'use' }
  | { t: 'ab' }
  | { t: 'emote'; e: number }
  | { t: 'leave' };

export type ServerMsg =
  | { t: 'room'; code: string; you: string; host: string; phase: 'lobby' | 'race'; settings: RoomSettings; players: PlayerInfo[] }
  | { t: 'race'; track: string; laps: number; entrants: Entrant[] }
  | { t: 'snap'; s: Snapshot }
  | { t: 'ev'; e: RaceEvent }
  | { t: 'emote'; id: string; e: number }
  | { t: 'error'; msg: string; refresh?: boolean };

export const EMOTES = ['👍', '😂', '😱', '😤', '🔥', '🍿', '🥨', 'GG'];

/** Room codes avoid letters that read alike. */
export const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ';

export function cleanName(s: unknown): string {
  const n = String(s ?? '').replace(/[^\p{L}\p{N} _.'-]/gu, '').trim().slice(0, 14);
  return n || 'Racer';
}
