// The page's side of a race. My kart is simulated here every frame (so it feels instant) and
// reported to the room; everyone else is drawn about 100 ms in the past, smoothly interpolated.

import {
  applyBuff, applyHit, bump, newKart, padsFor, placeOnGrid, stepKart, type Input, type Kart, type KartEvent, type PadRuntime,
} from '../sim/kart';
import type { ItemId } from '../sim/items';
import { lerp, wrapAngle } from '../sim/math';
import { COUNTDOWN, DT, Flag, type Entrant, type RaceEvent, type Result, type Snapshot } from '../sim/race';
import { getTrack, type Track } from '../sim/track';
import { trackById } from '../sim/tracks';
import type { ClientMsg } from '../net/protocol';

const INTERP_DELAY = 0.1;
const REPORT_EVERY = 0.05;

export interface ObjView {
  id: number;
  kind: string;
  x: number;
  y: number;
  z: number;
  seen: number;
}

export interface Other {
  id: string;
  kart: Kart;
  place: number;
  meter: number;
  flags: number;
}

export type ClientEvent = KartEvent | RaceEvent;

export class RaceClient {
  readonly track: Track;
  readonly pads: PadRuntime[];
  readonly me: Kart;
  readonly others = new Map<string, Other>();
  readonly objs = new Map<number, ObjView>();
  readonly entrants: Entrant[];
  boxes = '';
  clock = -COUNTDOWN; // local race clock
  item: ItemId | null = null;
  count = 0;
  rollT = 0; // roulette time left
  meter = 0;
  place = 0;
  finishPlace = 0;
  results: Result[] | null = null;
  started = false;
  private holdT = 0;
  private acc = 0;
  private reportT = 0;
  private snaps: { at: number; s: Snapshot }[] = [];
  private serverT = -COUNTDOWN; // best guess at the room's race clock
  private grapId = '';
  private lastWall = 0;

  constructor(
    trackId: string,
    readonly laps: number,
    entrants: Entrant[],
    readonly myId: string,
    private send: (m: ClientMsg) => void,
    private onEvent: (e: ClientEvent, mine: boolean) => void,
  ) {
    this.track = getTrack(trackById(trackId));
    this.pads = padsFor(this.track);
    this.entrants = entrants;
    let mine: Kart | null = null;
    entrants.forEach((e, slot) => {
      const k = newKart(e.id, e.char);
      placeOnGrid(k, this.track, slot);
      if (e.id === myId) mine = k;
      else this.others.set(e.id, { id: e.id, kart: k, place: slot, meter: 0, flags: 0 });
    });
    this.me = mine ?? newKart(myId, 'hal');
    this.place = entrants.findIndex((e) => e.id === myId);
  }

  /** Everyone, me included, for drawing. */
  allKarts(): Kart[] {
    return [this.me, ...[...this.others.values()].map((o) => o.kart)];
  }

  entrant(id: string): Entrant | undefined {
    return this.entrants.find((e) => e.id === id);
  }

  update(dt: number, inp: Input): void {
    this.clock += dt;
    this.serverT += dt;
    if (this.rollT > 0) this.rollT = Math.max(0, this.rollT - dt);

    this.acc = Math.min(this.acc + dt, 0.2);
    while (this.acc >= DT) {
      this.acc -= DT;
      this.step(inp);
    }

    this.reportT -= dt;
    if (this.reportT <= 0 && this.started) {
      this.reportT = REPORT_EVERY;
      const k = this.me;
      const r2 = (v: number) => Math.round(v * 100) / 100;
      this.send({
        t: 'st',
        s: { x: r2(k.x), y: r2(k.y), z: r2(k.z), h: r2(k.h), sp: r2(k.speed), dr: k.drift, tr: k.tier, air: k.air, boost: k.boostT > 0, fall: k.fallT > 0 },
      });
    }
    this.interpolate();
  }

  private step(inp: Input): void {
    const k = this.me;
    if (this.clock < 0) {
      // Countdown: hold the gas at the right moment for a rocket start.
      this.holdT = inp.throttle > 0.5 ? this.holdT + DT : 0;
      k.steerVis += (inp.steer - k.steerVis) * 0.15;
      return;
    }
    if (!this.started) {
      this.started = true;
      if (this.holdT > 0.25 && this.holdT < 1.1) {
        applyBuff(k, 'start');
        this.onEvent({ k: 'mt', tier: 2 }, true);
      }
    }
    if (this.grapId) {
      const t = this.others.get(this.grapId)?.kart;
      if (t && k.grapT > 0) {
        k.grapX = t.x;
        k.grapZ = t.z;
      } else this.grapId = '';
    }
    const ev = stepKart(k, k.finished ? { throttle: 0.6, steer: autoSteer(this.track, k), drift: false } : inp, this.track, DT, this.pads);
    for (const e of ev) {
      if (e.k === 'mt') this.send({ t: 'mt', tier: e.tier });
      if (e.k === 'wall') {
        if (this.clock - this.lastWall < 0.4) continue;
        this.lastWall = this.clock;
      }
      if (e.k === 'lap' && e.lap > this.laps) k.finished = true;
      this.onEvent(e, true);
    }
    for (const o of this.others.values()) {
      if (!(o.flags & Flag.Fall)) bump(k, o.kart, true, false);
    }
  }

  useItem(): void {
    if (this.item && this.rollT <= 0 && this.started) this.send({ t: 'use' });
  }

  useAbility(): void {
    if (this.meter >= 1 && this.started) this.send({ t: 'ab' });
  }

  snapshot(s: Snapshot): void {
    this.snaps.push({ at: s.t, s });
    if (this.snaps.length > 12) this.snaps.shift();
    // Pull the clock estimate toward what the room says, gently.
    this.serverT = Math.abs(this.serverT - s.t) > 0.5 ? s.t : lerp(this.serverT, s.t, 0.1);
    this.boxes = s.b;
    for (const row of s.k) {
      const id = row[0] as string;
      if (id === this.myId) {
        this.place = row[9] as number;
        this.meter = row[11] as number;
      }
    }
  }

  private interpolate(): void {
    const t = this.serverT - INTERP_DELAY;
    const S = this.snaps;
    if (!S.length) return;
    let a = S[0], b = S[0];
    for (let i = 0; i < S.length - 1; i++) {
      if (S[i].at <= t && S[i + 1].at >= t) {
        a = S[i];
        b = S[i + 1];
        break;
      }
      if (S[i + 1].at < t) a = b = S[i + 1];
    }
    const f = b.at > a.at ? Math.max(0, Math.min(1, (t - a.at) / (b.at - a.at))) : 1;
    const rowsA = new Map(a.s.k.map((r) => [r[0] as string, r]));
    for (const rb of b.s.k) {
      const id = rb[0] as string;
      const o = this.others.get(id);
      if (!o) continue;
      const ra = rowsA.get(id) ?? rb;
      const k = o.kart;
      const prevH = k.h;
      const n = (i: number) => lerp(ra[i] as number, rb[i] as number, f);
      k.x = n(1);
      k.y = n(2);
      k.z = n(3);
      k.h = (ra[4] as number) + wrapAngle((rb[4] as number) - (ra[4] as number)) * f;
      k.speed = n(5);
      k.drift = rb[6] as number;
      k.tier = rb[7] as number;
      const fl = rb[8] as number;
      o.flags = fl;
      o.place = rb[9] as number;
      k.lap = rb[10] as number;
      o.meter = rb[11] as number;
      k.spinT = fl & Flag.Spin ? Math.max(k.spinT, 0.01) : 0;
      k.shieldT = fl & Flag.Shield ? 1 : 0;
      k.invulnT = fl & Flag.Invuln ? 1 : 0;
      k.slowT = fl & Flag.Slow ? 1 : 0;
      k.fireT = fl & Flag.Fire ? 1 : 0;
      k.boostT = fl & Flag.Boost ? 1 : 0;
      k.air = !!(fl & Flag.Air);
      k.sugarT = fl & Flag.Sugar ? 1 : 0;
      k.grapT = fl & Flag.Grapple ? 1 : 0;
      k.fallT = fl & Flag.Fall ? 1 : 0;
      k.finished = !!(fl & Flag.Finished);
      k.steerVis += (Math.max(-1, Math.min(1, wrapAngle(k.h - prevH) * 25)) - k.steerVis) * 0.2;
      k.t += 1 / 60;
    }
    // Objects: interpolate ones present in both snapshots.
    const objA = new Map(a.s.o.map((r) => [r[0] as number, r]));
    const seen = new Set<number>();
    for (const rb of b.s.o) {
      const id = rb[0] as number;
      const ra = objA.get(id) ?? rb;
      seen.add(id);
      let v = this.objs.get(id);
      if (!v) this.objs.set(id, (v = { id, kind: rb[1] as string, x: 0, y: 0, z: 0, seen: 0 }));
      v.x = lerp(ra[2] as number, rb[2] as number, f);
      v.y = lerp(ra[3] as number, rb[3] as number, f);
      v.z = lerp(ra[4] as number, rb[4] as number, f);
    }
    for (const id of this.objs.keys()) if (!seen.has(id)) this.objs.delete(id);
  }

  event(e: RaceEvent): void {
    const k = this.me;
    let mine = false;
    switch (e.k) {
      case 'item':
        if (e.id !== this.myId) return;
        mine = true;
        this.item = e.item;
        this.count = e.count;
        if (e.roll > 0) this.rollT = e.roll;
        break;
      case 'hit':
        if (e.id === this.myId) {
          mine = true;
          applyHit(k, e.kind);
        }
        break;
      case 'blocked':
        if (e.id === this.myId) {
          mine = true;
          k.shieldT = 0;
        }
        break;
      case 'buff':
        if (e.id === this.myId) {
          mine = true;
          applyBuff(k, e.buff, e.x, e.z);
          if (e.buff === 'grapple') this.grapId = e.target ?? '';
        }
        break;
      case 'ability':
        mine = e.id === this.myId;
        break;
      case 'finish':
        if (e.id === this.myId) {
          mine = true;
          this.finishPlace = e.place;
          k.finished = true;
        }
        break;
      case 'done':
        this.results = e.results;
        break;
    }
    this.onEvent(e, mine);
  }
}

/** After the finish line, the kart drives itself. */
function autoSteer(track: Track, k: Kart): number {
  const loc = track.locate(k.x, k.z, k.si, k.y);
  const p = track.pointAt(loc.s + 12, 0);
  return Math.max(-1, Math.min(1, wrapAngle(Math.atan2(p.z - k.z, p.x - k.x) - k.h) * 2));
}
