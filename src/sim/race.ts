// One race: the authoritative side. The server runs this for online rooms and the page runs it
// for solo races. CPU karts are simulated here; players' karts are moved by their own page and
// reported in, and this decides crates, items, abilities, hits, standings and the finish.

import { charById, type AbilityId } from './characters';
import {
  applyBuff, applyHit, bump, newKart, padsFor, placeOnGrid, progressOf, stepKart, tickTimers, updateProgress,
  type BuffKind, type HitKind, type Input, type Kart, type PadRuntime,
} from './kart';
import { rollItem, type ItemId } from './items';
import { clamp, rng, wrapAngle } from './math';
import { SHOULDER, getTrack, type Track } from './track';
import { trackById } from './tracks';
import { botThink, newBrain, type Brain } from './bot';

export const DT = 1 / 60;
export const COUNTDOWN = 3.2;
const BOX_RESPAWN = 2.2;
const METER_PASSIVE = 0.012;
export const METER_DRIFT = [0, 0.09, 0.16, 0.25];
const METER_HIT = 0.15;
const FINISH_GRACE = 45; // seconds after the first player finishes before the race closes

export type ObjKind = 'jawbreaker' | 'taffy' | 'butter' | 'rocket' | 'flame' | 'puddle' | 'stink';

export interface Obj {
  id: number;
  kind: ObjKind;
  owner: string;
  x: number;
  y: number;
  z: number;
  vx: number;
  vz: number;
  r: number;
  life: number;
  age: number;
  si: number;
  target: string;
}

export interface Box {
  x: number;
  y: number;
  z: number;
  t: number; // 0 = ready, otherwise seconds until back
}

export interface Entrant {
  id: string;
  name: string;
  char: string;
  bot: boolean;
}

export interface Racer extends Entrant {
  kart: Kart;
  input: Input;
  item: ItemId | null;
  count: number;
  meter: number;
  place: number;
  brain: Brain | null;
  lastReport: number;
  rolling: number; // item roulette time left; item is hidden until it ends
}

export type RaceEvent =
  | { k: 'item'; id: string; item: ItemId | null; count: number; roll: number }
  | { k: 'hit'; id: string; kind: HitKind; by: string; x: number; z: number }
  | { k: 'blocked'; id: string; x: number; z: number }
  | { k: 'buff'; id: string; buff: BuffKind; x?: number; z?: number; target?: string }
  | { k: 'ability'; id: string; ability: AbilityId }
  | { k: 'box'; i: number }
  | { k: 'pop'; x: number; y: number; z: number; r: number } // a burst effect
  | { k: 'go' }
  | { k: 'finish'; id: string; place: number; time: number }
  | { k: 'done'; results: Result[] };

export interface Result {
  id: string;
  name: string;
  char: string;
  bot: boolean;
  place: number;
  time: number | null; // null if the race closed before they finished
}

/** What a player's page reports about its own kart, about 20 times a second. */
export interface KartReport {
  x: number;
  y: number;
  z: number;
  h: number;
  sp: number;
  dr: number;
  tr: number;
  air: boolean;
  boost: boolean;
  fall: boolean;
}

export const enum Flag {
  Spin = 1, Shield = 2, Invuln = 4, Slow = 8, Fire = 16, Boost = 32, Air = 64, Sugar = 128,
  Grapple = 256, Fall = 512, Blind = 1024, Slick = 2048, Finished = 4096,
}

export interface Snapshot {
  t: number;
  k: (string | number)[][]; // [id, x, y, z, h, speed, drift, tier, flags, place, lap, meter]
  o: (number | string)[][]; // [id, kind, x, y, z]
  b: string; // '1' = crate ready, per crate
}

/** Rows of four snack crates across the road. */
export function crateSpots(track: Track): { x: number; y: number; z: number }[] {
  const out: { x: number; y: number; z: number }[] = [];
  for (const at of track.def.itemRows) {
    const s = at * track.length;
    const half = track.w[track.indexAt(s)] / 2;
    for (let j = 0; j < 4; j++) {
      const p = track.pointAt(s, (j - 1.5) * Math.min(4, (half * 2 - 3) / 4));
      out.push({ x: p.x, y: p.y, z: p.z });
    }
  }
  return out;
}

export class Race {
  readonly track: Track;
  readonly pads: PadRuntime[];
  readonly racers: Racer[] = [];
  readonly objs: Obj[] = [];
  readonly boxes: Box[] = [];
  readonly laps: number;
  phase: 'countdown' | 'racing' | 'done' = 'countdown';
  time = -COUNTDOWN; // race clock; 0 is GO
  private nextObj = 1;
  private rand: () => number;
  private firstFinish = -1;
  private flameDrop = new Map<string, number>();
  private grapIds = new Map<string, string>();
  results: Result[] = [];

  constructor(trackId: string, laps: number, entrants: Entrant[], seed: number, private emit: (e: RaceEvent) => void) {
    this.track = getTrack(trackById(trackId));
    this.pads = padsFor(this.track);
    this.laps = laps;
    this.rand = rng(seed);
    entrants.forEach((e, slot) => {
      const kart = newKart(e.id, e.char);
      placeOnGrid(kart, this.track, slot);
      const r: Racer = {
        ...e, kart, input: { throttle: 0, steer: 0, drift: false }, item: null, count: 0, meter: 0,
        place: slot, brain: e.bot ? newBrain(this.rand) : null, lastReport: 0, rolling: 0,
      };
      if (r.brain) kart.mul = r.brain.skill;
      this.racers.push(r);
    });
    for (const p of crateSpots(this.track)) this.boxes.push({ ...p, t: 0 });
  }

  racer(id: string): Racer | undefined {
    return this.racers.find((r) => r.id === id);
  }

  /** A player's page told us where its kart is. */
  report(id: string, s: KartReport): void {
    const r = this.racer(id);
    if (!r || r.bot || this.phase === 'done') return;
    const k = r.kart;
    if (![s.x, s.y, s.z, s.h, s.sp].every(Number.isFinite)) return;
    // Ignore teleports, except respawns which land back on the road.
    const jump = Math.hypot(s.x - k.x, s.z - k.z);
    if (jump > 30 && !s.fall && !(k.fallT > 0)) {
      const loc = this.track.locate(s.x, s.z, -1, s.y);
      if (Math.abs(loc.lat) > 1 || Math.abs(loc.s - k.safeS) > 40) return;
    }
    k.x = s.x;
    k.y = s.y;
    k.z = s.z;
    k.h = s.h;
    k.speed = clamp(s.sp, -12, 60);
    k.drift = Math.sign(s.dr);
    k.tier = clamp(Math.round(s.tr), 0, 3);
    k.air = !!s.air;
    k.fallT = s.fall ? 1 : 0;
    if (s.boost && k.boostT <= 0) k.boostT = 0.15;
    if (this.phase === 'racing' && !k.finished) {
      const loc = this.track.locate(k.x, k.z, k.si, k.y);
      k.si = loc.i;
      if (!k.air && Math.abs(loc.lat) <= loc.half) k.safeS = loc.s;
      updateProgress(k, loc.s, loc.lat, this.track);
    }
    r.lastReport = this.time;
  }

  /** A player's page fired a drift boost; it charges their ability. */
  driftBoost(id: string, tier: number): void {
    const r = this.racer(id);
    if (r && tier >= 1 && tier <= 3) r.meter = Math.min(1, r.meter + METER_DRIFT[tier]);
  }

  tick(dt = DT): void {
    if (this.phase === 'done') return;
    const was = this.time;
    this.time += dt;
    if (this.phase === 'countdown') {
      for (const r of this.racers) if (r.brain) r.brain.holdT = this.time > -r.brain.startAt ? r.brain.holdT + dt : 0;
      if (this.time >= 0 && was < 0) {
        this.phase = 'racing';
        this.emit({ k: 'go' });
        for (const r of this.racers) {
          if (r.brain && r.brain.holdT > 0.25 && r.brain.holdT < 1.1) {
            applyBuff(r.kart, 'start');
          }
        }
      }
      return;
    }

    // Karts.
    for (const r of this.racers) {
      const k = r.kart;
      if (r.bot) {
        const think = botThink(r, this);
        const ev = stepKart(k, think.input, this.track, dt, this.pads);
        for (const e of ev) if (e.k === 'mt') r.meter = Math.min(1, r.meter + METER_DRIFT[e.tier]);
        if (think.useItem) this.useItem(r.id);
        if (think.useAbility) this.useAbility(r.id);
      } else {
        tickTimers(k, dt);
      }
      if (!k.finished && k.lap > this.laps) this.finish(r);
      r.meter = Math.min(1, r.meter + METER_PASSIVE * dt);
      if (r.rolling > 0) r.rolling = Math.max(0, r.rolling - dt);
    }

    // Bots bump each other and players; players' pages handle their own bumps.
    for (let i = 0; i < this.racers.length; i++) {
      for (let j = i + 1; j < this.racers.length; j++) {
        const a = this.racers[i], b = this.racers[j];
        if (!a.bot && !b.bot) {
          this.ramCheck(a, b);
          continue;
        }
        if (bump(a.kart, b.kart, a.bot, b.bot)) this.ramCheck(a, b);
      }
    }

    this.updateBoxes(dt);
    this.updateObjs(dt);
    this.dropFlames(dt);
    this.rank();
    this.catchUp();

    if (this.firstFinish >= 0) {
      const humans = this.racers.filter((r) => !r.bot);
      const allHumansDone = humans.length > 0 && humans.every((r) => r.kart.finished);
      const allDone = this.racers.every((r) => r.kart.finished);
      if (allHumansDone || allDone || this.time - this.firstFinish > FINISH_GRACE) this.close();
    }
  }

  private ramCheck(a: Racer, b: Racer): void {
    const d = Math.hypot(a.kart.x - b.kart.x, a.kart.z - b.kart.z);
    if (d > 2.4 || Math.abs(a.kart.y - b.kart.y) > 2) return;
    if (a.kart.sugarT > 0 && b.kart.sugarT <= 0) this.hit(b, 'spin', a.id);
    else if (b.kart.sugarT > 0 && a.kart.sugarT <= 0) this.hit(a, 'spin', b.id);
  }

  private finish(r: Racer): void {
    const k = r.kart;
    k.finished = true;
    k.finishTime = this.time;
    const place = this.racers.filter((o) => o.kart.finished).length;
    if (this.firstFinish < 0 && !r.bot) this.firstFinish = this.time;
    if (this.firstFinish < 0 && this.racers.every((o) => o.bot)) this.firstFinish = this.time;
    this.emit({ k: 'finish', id: r.id, place, time: this.time });
  }

  private close(): void {
    this.rank();
    this.phase = 'done';
    this.results = [...this.racers]
      .sort((a, b) => a.place - b.place)
      .map((r) => ({ id: r.id, name: r.name, char: r.char, bot: r.bot, place: r.place + 1, time: r.kart.finished ? r.kart.finishTime : null }));
    this.emit({ k: 'done', results: this.results });
  }

  /** Remove a player who left mid-race; a bot takes over their kart. */
  takeOver(id: string): void {
    const r = this.racer(id);
    if (!r || r.bot) return;
    r.bot = true;
    r.brain = newBrain(this.rand);
    r.kart.mul = r.brain.skill;
  }

  private rank(): void {
    const sorted = [...this.racers].sort((a, b) => {
      if (a.kart.finished !== b.kart.finished) return a.kart.finished ? -1 : 1;
      if (a.kart.finished) return a.kart.finishTime - b.kart.finishTime;
      return progressOf(b.kart, this.track) - progressOf(a.kart, this.track);
    });
    sorted.forEach((r, i) => (r.place = i));
  }

  /** Gentle catch-up so CPUs stay in the mix without feeling like cheaters. */
  private catchUp(): void {
    const humans = this.racers.filter((r) => !r.bot);
    if (!humans.length) return;
    const lead = Math.max(...humans.map((h) => progressOf(h.kart, this.track)));
    const last = Math.min(...humans.map((h) => progressOf(h.kart, this.track)));
    for (const r of this.racers) {
      if (!r.brain) continue;
      const p = progressOf(r.kart, this.track);
      let m = r.brain.skill;
      if (p < lead - 90) m += 0.05;
      if (p > last + 120) m -= 0.04;
      r.kart.mul = m;
    }
  }

  private updateBoxes(dt: number): void {
    this.boxes.forEach((b, i) => {
      if (b.t > 0) {
        b.t = Math.max(0, b.t - dt);
        return;
      }
      for (const r of this.racers) {
        const k = r.kart;
        if (k.fallT > 0 || k.finished) continue;
        if (Math.hypot(k.x - b.x, k.z - b.z) < 2.3 && Math.abs(k.y - b.y) < 2.5) {
          b.t = BOX_RESPAWN;
          this.emit({ k: 'box', i });
          if (!r.item && r.rolling <= 0) {
            const n = this.racers.length;
            const pos = n > 1 ? r.place / (n - 1) : 0;
            const got = rollItem(pos, this.rand());
            r.item = got.item;
            r.count = got.count;
            r.rolling = 1.4;
            this.emit({ k: 'item', id: r.id, item: r.item, count: r.count, roll: r.rolling });
          }
          break;
        }
      }
    });
  }

  useItem(id: string): void {
    const r = this.racer(id);
    if (!r || !r.item || r.rolling > 0 || this.phase !== 'racing' || r.kart.fallT > 0) return;
    const k = r.kart;
    const fx = Math.cos(k.h), fz = Math.sin(k.h);
    switch (r.item) {
      case 'jawbreaker':
        this.spawn('jawbreaker', r.id, k.x + fx * 2.6, k.y + 0.5, k.z + fz * 2.6, fx * 44 + fx * Math.max(0, k.speed) * 0.4, fz * 44 + fz * Math.max(0, k.speed) * 0.4, 0.8, 7);
        break;
      case 'taffy': {
        const ahead = this.racers.find((o) => o.place === r.place - 1);
        const o = this.spawn('taffy', r.id, k.x + fx * 2.6, k.y + 0.6, k.z + fz * 2.6, fx * 46, fz * 46, 0.8, 9);
        o.target = ahead?.id ?? '';
        break;
      }
      case 'butter':
        this.spawn('butter', r.id, k.x - fx * 2.6, k.y, k.z - fz * 2.6, 0, 0, 1.2, 40);
        break;
      case 'espresso':
        applyBuff(k, 'espresso');
        this.emit({ k: 'buff', id: r.id, buff: 'espresso' });
        break;
      case 'gum':
        applyBuff(k, 'gum');
        this.emit({ k: 'buff', id: r.id, buff: 'gum' });
        break;
      case 'sugarCrash':
        for (const o of this.racers) if (o.place < r.place) this.hit(o, 'slow', r.id);
        this.emit({ k: 'pop', x: k.x, y: k.y, z: k.z, r: 0 });
        break;
    }
    r.count--;
    if (r.count <= 0) r.item = null;
    this.emit({ k: 'item', id: r.id, item: r.item, count: r.count, roll: 0 });
  }

  useAbility(id: string): void {
    const r = this.racer(id);
    if (!r || r.meter < 1 || this.phase !== 'racing' || r.kart.fallT > 0 || r.kart.spinT > 0) return;
    const k = r.kart;
    const ab = charById(r.char).ability;
    r.meter = 0;
    this.emit({ k: 'ability', id: r.id, ability: ab });
    const fx = Math.cos(k.h), fz = Math.sin(k.h);
    switch (ab) {
      case 'ghostPepper':
        applyBuff(k, 'ghostPepper');
        applyBuff(k, 'espresso');
        this.emit({ k: 'buff', id: r.id, buff: 'ghostPepper' });
        this.emit({ k: 'buff', id: r.id, buff: 'espresso' });
        break;
      case 'brineWave':
        this.spawn('puddle', r.id, k.x - fx * 6, k.y, k.z - fz * 6, 0, 0, 6.5, 9);
        break;
      case 'sugarRush':
        applyBuff(k, 'sugarRush');
        this.emit({ k: 'buff', id: r.id, buff: 'sugarRush' });
        break;
      case 'popBurst':
        for (const o of this.racers) {
          if (o === r) continue;
          if (Math.hypot(o.kart.x - k.x, o.kart.z - k.z) < 13 && Math.abs(o.kart.y - k.y) < 4) this.hit(o, 'spin', r.id);
        }
        this.emit({ k: 'pop', x: k.x, y: k.y, z: k.z, r: 13 });
        break;
      case 'stinkBomb': {
        const loc = this.track.locate(k.x, k.z, k.si, k.y);
        const p = this.track.pointAt(loc.s + 42, clamp(loc.lat, -3, 3));
        this.spawn('stink', r.id, p.x, p.y, p.z, 0, 0, 7.5, 7);
        break;
      }
      case 'colaRocket': {
        const leader = this.racers.find((o) => o.place === 0 && o !== r) ?? this.racers.find((o) => o.place === 1 && o !== r);
        const o = this.spawn('rocket', r.id, k.x, k.y + 1.5, k.z, fx * 55, fz * 55, 1, 20);
        o.target = leader?.id ?? '';
        break;
      }
      case 'gummyGrapple': {
        let best: Racer | null = null, bestD = 70;
        for (const o of this.racers) {
          if (o === r || o.kart.finished) continue;
          const dx = o.kart.x - k.x, dz = o.kart.z - k.z;
          const d = Math.hypot(dx, dz);
          if (d < bestD && (dx * fx + dz * fz) / (d || 1) > 0.55) {
            best = o;
            bestD = d;
          }
        }
        if (best) {
          applyBuff(k, 'grapple', best.kart.x, best.kart.z);
          this.emit({ k: 'buff', id: r.id, buff: 'grapple', x: best.kart.x, z: best.kart.z, target: best.id });
          this.grapIds.set(r.id, best.id);
        } else {
          applyBuff(k, 'espresso');
          this.emit({ k: 'buff', id: r.id, buff: 'espresso' });
        }
        break;
      }
      case 'healthKick':
        for (const o of this.racers) {
          if (o === r) continue;
          const dx = o.kart.x - k.x, dz = o.kart.z - k.z;
          const d = Math.hypot(dx, dz);
          if (d < 34 && (dx * fx + dz * fz) / (d || 1) > 0.2) this.hit(o, 'slow', r.id);
        }
        this.emit({ k: 'pop', x: k.x + fx * 15, y: k.y, z: k.z + fz * 15, r: 17 });
        break;
    }
  }

  /** Where the grapple is pulling: keep it on the target kart. */
  grappleTarget(k: Kart): Kart | null {
    const id = this.grapIds.get(k.id);
    if (!id || k.grapT <= 0) return null;
    return this.racer(id)?.kart ?? null;
  }

  private spawn(kind: ObjKind, owner: string, x: number, y: number, z: number, vx: number, vz: number, r: number, life: number): Obj {
    const o: Obj = { id: this.nextObj++, kind, owner, x, y, z, vx, vz, r, life, age: 0, si: -1, target: '' };
    o.si = this.track.locate(x, z, -1, y).i;
    this.objs.push(o);
    if (this.objs.length > 80) this.objs.splice(this.objs.findIndex((q) => q.kind === 'butter' || q.kind === 'flame'), 1);
    return o;
  }

  private dropFlames(dt: number): void {
    for (const r of this.racers) {
      if (r.kart.fireT <= 0) continue;
      const t = (this.flameDrop.get(r.id) ?? 0) - dt;
      if (t <= 0) {
        const k = r.kart;
        this.spawn('flame', r.id, k.x - Math.cos(k.h) * 2.4, k.y, k.z - Math.sin(k.h) * 2.4, 0, 0, 1.5, 3);
        this.flameDrop.set(r.id, 0.09);
      } else this.flameDrop.set(r.id, t);
    }
  }

  private updateObjs(dt: number): void {
    const tr = this.track;
    for (let i = this.objs.length - 1; i >= 0; i--) {
      const o = this.objs[i];
      o.age += dt;
      o.life -= dt;
      let dead = o.life <= 0;
      if (o.kind === 'jawbreaker' || o.kind === 'taffy' || o.kind === 'rocket') {
        if (o.kind !== 'jawbreaker') this.steerSeeker(o, dt);
        o.x += o.vx * dt;
        o.z += o.vz * dt;
        const loc = tr.locate(o.x, o.z, o.si, o.y);
        o.si = loc.i;
        o.y = loc.y + (o.kind === 'rocket' ? 1.5 : 0.6);
        const lim = loc.half + Math.min(SHOULDER[loc.edge], 2);
        if (Math.abs(loc.lat) > lim) {
          if (o.kind === 'jawbreaker' && loc.edge !== 'kill') {
            // Bounce: flip the sideways part of the velocity.
            const nx = -tr.tz[loc.i], nz = tr.tx[loc.i];
            const vn = o.vx * nx + o.vz * nz;
            if (vn * loc.lat > 0) {
              o.vx -= 2 * vn * nx;
              o.vz -= 2 * vn * nz;
            }
            const back = Math.abs(loc.lat) - lim + 0.05;
            o.x -= nx * Math.sign(loc.lat) * back;
            o.z -= nz * Math.sign(loc.lat) * back;
          } else if (o.kind === 'jawbreaker') dead = true;
        }
      }
      if (!dead) {
        for (const r of this.racers) {
          const k = r.kart;
          if (r.id === o.owner && o.age < (o.kind === 'butter' || o.kind === 'puddle' || o.kind === 'stink' || o.kind === 'flame' ? 99 : 0.6)) continue;
          if (o.kind === 'rocket' && r.id !== o.target) continue;
          if (k.fallT > 0) continue;
          const rr = o.r + 1.1;
          const dx = k.x - o.x, dz = k.z - o.z;
          if (dx * dx + dz * dz > rr * rr || Math.abs(k.y - o.y) > 3.5) continue;
          if (o.kind === 'puddle') {
            if (k.slickT < 0.3) this.hit(r, 'slick', o.owner);
            continue;
          }
          if (o.kind === 'stink') {
            if (k.blindT < 0.3) this.hit(r, 'blind', o.owner);
            continue;
          }
          this.hit(r, o.kind === 'rocket' ? 'pop' : 'spin', o.owner);
          if (o.kind !== 'flame') {
            dead = true;
            break;
          }
        }
      }
      if (!dead && (o.kind === 'jawbreaker' || o.kind === 'taffy' || o.kind === 'butter')) {
        // Projectiles and traps knock each other out.
        for (const p of this.objs) {
          if (p === o || (p.kind !== 'jawbreaker' && p.kind !== 'taffy' && p.kind !== 'butter')) continue;
          if (o.kind === 'butter' && p.kind === 'butter') continue;
          if (Math.hypot(p.x - o.x, p.z - o.z) < o.r + p.r) {
            dead = true;
            p.life = 0;
            this.emit({ k: 'pop', x: o.x, y: o.y, z: o.z, r: 0 });
            break;
          }
        }
      }
      if (dead) this.objs.splice(i, 1);
    }
  }

  /** Homing: follow the road toward the target, then dive at it when close. */
  private steerSeeker(o: Obj, dt: number): void {
    const t = o.target ? this.racer(o.target)?.kart : undefined;
    const speed = Math.hypot(o.vx, o.vz) || 1;
    let want: number;
    const loc = this.track.locate(o.x, o.z, o.si, o.y);
    if (t && Math.hypot(t.x - o.x, t.z - o.z) < (o.kind === 'rocket' ? 30 : 26)) {
      want = Math.atan2(t.z - o.z, t.x - o.x);
    } else {
      const p = this.track.pointAt(loc.s + 12, o.kind === 'rocket' ? 0 : clamp(loc.lat * 0.5, -3, 3));
      want = Math.atan2(p.z - o.z, p.x - o.x);
    }
    if (!t && o.kind === 'rocket') o.life = Math.min(o.life, 0.01);
    const cur = Math.atan2(o.vz, o.vx);
    const turn = (o.kind === 'rocket' ? 5 : 3.2) * dt;
    const h = cur + clamp(wrapAngle(want - cur), -turn, turn);
    o.vx = Math.cos(h) * speed;
    o.vz = Math.sin(h) * speed;
  }

  hit(r: Racer, kind: HitKind, by: string): void {
    const k = r.kart;
    // The race's copy of a player's kart holds shield and invulnerability timers too.
    const res = applyHit(k, kind);
    if (res === 'blocked') this.emit({ k: 'blocked', id: r.id, x: k.x, z: k.z });
    if (res !== 'hit') return;
    this.emit({ k: 'hit', id: r.id, kind, by, x: k.x, z: k.z });
    const attacker = this.racer(by);
    if (attacker && attacker !== r && (kind === 'spin' || kind === 'pop')) attacker.meter = Math.min(1, attacker.meter + METER_HIT);
  }

  snapshot(): Snapshot {
    const r2 = (v: number) => Math.round(v * 100) / 100;
    return {
      t: r2(this.time),
      k: this.racers.map((r) => {
        const k = r.kart;
        let f = 0;
        if (k.spinT > 0) f |= Flag.Spin;
        if (k.shieldT > 0) f |= Flag.Shield;
        if (k.invulnT > 0) f |= Flag.Invuln;
        if (k.slowT > 0) f |= Flag.Slow;
        if (k.fireT > 0) f |= Flag.Fire;
        if (k.boostT > 0) f |= Flag.Boost;
        if (k.air) f |= Flag.Air;
        if (k.sugarT > 0) f |= Flag.Sugar;
        if (k.grapT > 0) f |= Flag.Grapple;
        if (k.fallT > 0) f |= Flag.Fall;
        if (k.blindT > 0) f |= Flag.Blind;
        if (k.slickT > 0) f |= Flag.Slick;
        if (k.finished) f |= Flag.Finished;
        return [r.id, r2(k.x), r2(k.y), r2(k.z), r2(k.h), r2(k.speed), k.drift, k.tier, f, r.place, k.lap, r2(r.meter)];
      }),
      o: this.objs.map((o) => [o.id, o.kind, r2(o.x), r2(o.y), r2(o.z)]),
      b: this.boxes.map((b) => (b.t > 0 ? '0' : '1')).join(''),
    };
  }
}
