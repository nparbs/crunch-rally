// Arcade kart physics. Forward is (cos h, sin h) in x,z; steering +1 turns right (h grows).
// The same code drives the player's own kart in the page and the CPU karts on the server.

import { charById } from './characters';
import { approach, clamp, wrapAngle } from './math';
import { SHOULDER, type Track } from './track';

export interface Input {
  throttle: number; // -1 brake/reverse .. 1 gas
  steer: number; // -1 left .. 1 right
  drift: boolean; // held
}

export const NO_INPUT: Input = { throttle: 0, steer: 0, drift: false };

/** Drift charge needed for each spark tier, and how long each tier's boost lasts. */
export const DRIFT_TIERS = [0, 0.75, 1.6, 2.6];
export const DRIFT_BOOST = [0, 0.6, 1.3, 2.1];
export const GRAVITY = 30;

export interface Kart {
  id: string;
  char: string;
  x: number;
  y: number;
  z: number;
  h: number;
  speed: number;
  vy: number;
  air: boolean;
  si: number; // last track sample (search hint)
  steerVis: number; // smoothed steer for the wheels
  driftHeld: boolean;
  drift: number; // -1, 0, 1
  driftT: number; // charge
  tier: number; // 0..3 sparks showing
  boostT: number;
  boostMul: number;
  spinT: number;
  invulnT: number;
  shieldT: number;
  slowT: number;
  slickT: number;
  blindT: number;
  sugarT: number; // Sugar Rush: rams spin people out
  fireT: number; // Ghost Pepper: dropping flames
  grapT: number; // Gummy Grapple pull
  grapX: number;
  grapZ: number;
  rampAir: boolean; // airborne off a ramp, tricks allowed
  trick: boolean;
  fallT: number; // > 0 while falling into something and being fished out
  safeS: number; // last distance along the lap on solid road
  wrongT: number;
  // Race progress
  lap: number;
  mask: number; // sectors visited this lap (4 bits)
  s: number;
  lat: number;
  finished: boolean;
  finishTime: number;
  t: number; // own clock, for wobble
  mul: number; // top-speed multiplier (CPU skill and catch-up)
}

export type KartEvent =
  | { k: 'mt'; tier: number } // drift boost fired
  | { k: 'tier'; tier: number } // sparks changed color
  | { k: 'hop' }
  | { k: 'land' }
  | { k: 'trick' }
  | { k: 'wall'; power: number }
  | { k: 'fall' }
  | { k: 'respawn' }
  | { k: 'pad' }
  | { k: 'ramp' }
  | { k: 'lap'; lap: number };

export function newKart(id: string, char: string): Kart {
  return {
    id, char, x: 0, y: 0, z: 0, h: 0, speed: 0, vy: 0, air: false, si: -1, steerVis: 0,
    driftHeld: false, drift: 0, driftT: 0, tier: 0, boostT: 0, boostMul: 1.3,
    spinT: 0, invulnT: 0, shieldT: 0, slowT: 0, slickT: 0, blindT: 0, sugarT: 0, fireT: 0,
    grapT: 0, grapX: 0, grapZ: 0, rampAir: false, trick: false, fallT: 0, safeS: 0, wrongT: 0,
    lap: 0, mask: 15, s: 0, lat: 0, finished: false, finishTime: 0, t: 0, mul: 1,
  };
}

export interface Stats {
  max: number;
  accel: number;
  turn: number;
  weight: number;
}

export function statsFor(char: string): Stats {
  const c = charById(char);
  return {
    max: 26 + (c.speed - 3) * 0.55,
    accel: 15 + (c.accel - 3) * 3,
    turn: 1.95 + (c.handling - 3) * 0.17,
    weight: 1 + (c.weight - 3) * 0.2,
  };
}

/** Place a kart on the grid: slot 0 is pole position. */
export function placeOnGrid(k: Kart, track: Track, slot: number): void {
  const row = Math.floor(slot / 2), col = slot % 2;
  const s = track.length - 6 - row * 5.5;
  const half = track.w[track.indexAt(s)] / 2;
  const lat = (col === 0 ? -1 : 1) * Math.min(3.2, half * 0.4) + (row % 2 ? 0.8 : -0.8);
  const p = track.pointAt(s, lat);
  Object.assign(k, { x: p.x, y: p.y, z: p.z, h: p.h, speed: 0, vy: 0, air: false, lap: 0, mask: 15, finished: false });
  k.si = track.locate(k.x, k.z, -1, k.y).i;
  k.s = s;
  k.safeS = s;
}

const TIMERS = ['boostT', 'spinT', 'invulnT', 'shieldT', 'slowT', 'slickT', 'blindT', 'sugarT', 'fireT'] as const;

/** Count down effect timers. The server does only this for players' karts, whose movement comes from their page. */
export function tickTimers(k: Kart, dt: number): void {
  k.t += dt;
  for (const key of TIMERS) if (k[key] > 0) k[key] = Math.max(0, k[key] - dt);
}

/** One physics step. Returns what happened, for sounds and effects. */
export function stepKart(k: Kart, inp: Input, track: Track, dt: number, pads: PadRuntime[]): KartEvent[] {
  const ev: KartEvent[] = [];
  const st = statsFor(k.char);
  tickTimers(k, dt);

  // Being fished out after a fall: sink, then put back on the road.
  if (k.fallT > 0) {
    k.fallT -= dt;
    k.y -= 6 * dt;
    k.speed = 0;
    if (k.fallT <= 0) {
      respawn(k, track);
      ev.push({ k: 'respawn' });
    }
    return ev;
  }

  const finished = k.finished;
  const spinning = k.spinT > 0;
  let throttle = spinning ? 0 : inp.throttle;
  let steer = spinning ? 0 : clamp(inp.steer, -1, 1);
  if (finished) throttle = Math.min(throttle, 0.5);
  if (k.slickT > 0) steer = clamp(steer + Math.sin(k.t * 7) * 0.7, -1, 1);

  const loc = track.locate(k.x, k.z, k.si, k.y);
  k.si = loc.i;
  const offroad = Math.abs(loc.lat) > loc.half + 0.6 && !k.air;

  // Top speed for this moment.
  let max = st.max * k.mul;
  if (k.slowT > 0) max *= 0.68;
  if (k.fireT > 0) max *= 1.08;
  if (offroad && k.boostT <= 0) max *= 0.55;
  if (k.boostT > 0) max = st.max * k.mul * k.boostMul;

  // Gas, brake, coast.
  if (k.grapT > 0) {
    k.grapT -= dt;
    const want = Math.atan2(k.grapZ - k.z, k.grapX - k.x);
    k.h += clamp(wrapAngle(want - k.h), -6 * dt, 6 * dt);
    k.speed = approach(k.speed, st.max * 1.6, 60 * dt);
    if (k.grapT <= 0 || Math.hypot(k.grapX - k.x, k.grapZ - k.z) < 4) {
      k.grapT = 0;
      k.boostT = Math.max(k.boostT, 1.2);
    }
  } else if (k.boostT > 0) {
    k.speed = approach(k.speed, max, 45 * dt);
  } else if (k.speed > max) {
    k.speed = approach(k.speed, max, (offroad ? 30 : 14) * dt);
  } else if (throttle > 0) {
    const f = Math.max(0.15, 1 - (k.speed / max) ** 2);
    k.speed = Math.min(max, k.speed + st.accel * throttle * f * dt * 1.25);
  } else if (throttle < 0) {
    if (k.speed > 0) k.speed = Math.max(0, k.speed + throttle * 32 * dt);
    else k.speed = Math.max(-9, k.speed + throttle * 12 * dt);
  } else {
    k.speed = approach(k.speed, 0, 7 * dt);
  }
  if (spinning) k.speed = approach(k.speed, 0, 22 * dt);

  // Hop and drift.
  const pressed = inp.drift && !k.driftHeld;
  k.driftHeld = inp.drift;
  if (pressed && k.rampAir && !k.trick && k.air) {
    k.trick = true;
    ev.push({ k: 'trick' });
  } else if (pressed && !k.air && !spinning) {
    k.vy = 4.2;
    k.air = true;
    ev.push({ k: 'hop' });
  }
  if (k.drift === 0 && inp.drift && !spinning && !k.air && Math.abs(steer) > 0.3 && k.speed > 10) {
    k.drift = Math.sign(steer);
    k.driftT = 0;
    k.tier = 0;
  }
  if (k.drift !== 0) {
    const end = !inp.drift || k.speed < 7 || spinning || k.grapT > 0;
    if (end) {
      if (k.tier > 0 && !spinning) {
        k.boostT = Math.max(k.boostT, DRIFT_BOOST[k.tier]);
        k.boostMul = 1.3;
        ev.push({ k: 'mt', tier: k.tier });
      }
      k.drift = 0;
      k.driftT = 0;
      k.tier = 0;
    } else {
      const into = Math.max(0, steer * k.drift);
      if (!offroad) k.driftT += dt * (0.65 + 0.7 * into);
      let tier = 0;
      for (let i = 1; i < DRIFT_TIERS.length; i++) if (k.driftT >= DRIFT_TIERS[i]) tier = i;
      if (tier !== k.tier) {
        k.tier = tier;
        ev.push({ k: 'tier', tier });
      }
    }
  }

  // Turning.
  const spd = Math.abs(k.speed);
  let turn: number;
  if (k.drift !== 0) {
    const factor = 0.95 + 0.55 * steer * k.drift; // steer into the drift to tighten it
    turn = k.drift * st.turn * 0.95 * factor;
  } else {
    const sf = clamp(spd / 9, 0, 1) * (1 - 0.18 * clamp((spd - 20) / 10, 0, 1));
    turn = steer * st.turn * sf;
  }
  if (k.slickT > 0) turn *= 0.6;
  if (k.air && !k.rampAir) turn *= 0.8;
  if (k.grapT <= 0) k.h = wrapAngle(k.h + turn * dt * (k.speed >= 0 ? 1 : -1));
  k.steerVis += (steer - k.steerVis) * Math.min(1, dt * 10);

  // Move. Drifting slides the kart a little toward the outside of the turn.
  const fx = Math.cos(k.h), fz = Math.sin(k.h);
  k.x += fx * k.speed * dt;
  k.z += fz * k.speed * dt;
  if (k.drift !== 0) {
    const slide = -k.drift * 2.4 * dt;
    k.x += -fz * slide;
    k.z += fx * slide;
  }

  // Road edges.
  const loc2 = track.locate(k.x, k.z, k.si, k.y);
  k.si = loc2.i;
  const edgeLimit = loc2.half + SHOULDER[loc2.edge];
  if (Math.abs(loc2.lat) > edgeLimit) {
    if (loc2.edge === 'kill' && !k.air) {
      k.fallT = 1.5;
      k.drift = 0;
      k.tier = 0;
      ev.push({ k: 'fall' });
      return ev;
    }
    if (loc2.edge !== 'kill') {
      const sign = Math.sign(loc2.lat);
      const over = Math.abs(loc2.lat) - edgeLimit;
      // Push back inside along the road's sideways normal (right = (-tz, tx)).
      const nx = -track.tz[loc2.i], nz = track.tx[loc2.i];
      k.x -= nx * sign * (over + 0.05);
      k.z -= nz * sign * (over + 0.05);
      const into = Math.abs(Math.sin(wrapAngle(k.h - track.heading(loc2.i))));
      const power = into * Math.abs(k.speed);
      k.speed *= 1 - 0.55 * into;
      // Nudge the nose back along the road so the kart scrapes instead of sticking.
      const along = Math.cos(wrapAngle(k.h - track.heading(loc2.i))) >= 0 ? track.heading(loc2.i) : track.heading(loc2.i) + Math.PI;
      k.h = wrapAngle(k.h + wrapAngle(along - k.h) * 0.35);
      if (power > 4) ev.push({ k: 'wall', power });
    }
  }

  // Height: follow the road, or fly.
  if (k.air) {
    k.vy -= GRAVITY * dt;
    k.y += k.vy * dt;
    if (k.y <= loc2.y) {
      k.y = loc2.y;
      k.air = false;
      k.vy = 0;
      if (k.rampAir) {
        if (k.trick) {
          k.boostT = Math.max(k.boostT, 0.9);
          k.boostMul = 1.3;
        }
        k.rampAir = false;
        k.trick = false;
        ev.push({ k: 'land' });
      }
      if (Math.abs(loc2.lat) > edgeLimit && loc2.edge === 'kill') {
        k.fallT = 1.5;
        ev.push({ k: 'fall' });
        return ev;
      }
    }
  } else {
    k.y = loc2.y;
  }

  // Boost pads and ramps.
  for (const p of pads) {
    let ds = loc2.s - p.s;
    if (ds < 0) ds += track.length;
    if (ds > 3.5 || Math.abs(loc2.lat - p.lat) > p.w / 2) continue;
    if (p.kind === 'boost' && k.boostT < 0.9) {
      k.boostT = 1.1;
      k.boostMul = 1.35;
      ev.push({ k: 'pad' });
    } else if (p.kind === 'ramp' && !k.air && k.speed > 8) {
      k.vy = 8.5;
      k.air = true;
      k.rampAir = true;
      k.trick = false;
      k.boostT = Math.max(k.boostT, 0.5);
      ev.push({ k: 'ramp' });
    }
  }

  if (!k.air && Math.abs(loc2.lat) <= loc2.half) k.safeS = loc2.s;
  const dir = Math.cos(wrapAngle(k.h - track.heading(loc2.i)));
  k.wrongT = dir < -0.3 && k.speed > 3 ? k.wrongT + dt : 0;
  const lapEv = updateProgress(k, loc2.s, loc2.lat, track);
  if (lapEv) ev.push(lapEv);
  return ev;
}

/** Lap counting with four sectors, so cutting back over the line doesn't count. */
export function updateProgress(k: Kart, s: number, lat: number, track: Track): KartEvent | null {
  const L = track.length;
  const prev = Math.min(3, Math.floor((k.s / L) * 4));
  const sec = Math.min(3, Math.floor((s / L) * 4));
  k.s = s;
  k.lat = lat;
  let out: KartEvent | null = null;
  if (prev === 3 && sec === 0) {
    if (k.mask === 15) {
      k.lap++;
      k.mask = 1;
      out = { k: 'lap', lap: k.lap };
    } else k.mask |= 1;
  } else if (prev === 0 && sec === 3) {
    if (k.mask === 1 || k.mask === 0) {
      k.lap--;
      k.mask = 15;
    }
  } else if (sec === prev + 1) {
    k.mask |= 1 << sec;
  }
  return out;
}

/** Total distance raced, for standings. */
export function progressOf(k: Kart, track: Track): number {
  return (k.lap - 1) * track.length + k.s;
}

export function respawn(k: Kart, track: Track): void {
  const s = k.safeS - 4;
  const p = track.pointAt(s, 0);
  k.x = p.x;
  k.y = p.y;
  k.z = p.z;
  k.h = p.h;
  k.speed = 0;
  k.vy = 0;
  k.air = false;
  k.rampAir = false;
  k.fallT = 0;
  k.drift = 0;
  k.tier = 0;
  k.invulnT = Math.max(k.invulnT, 1.5);
  k.si = track.indexAt(s);
  const loc = track.locate(k.x, k.z, k.si, k.y);
  k.si = loc.i;
  k.s = loc.s;
}

export type HitKind = 'spin' | 'pop' | 'slow' | 'slick' | 'blind';

/** Apply a hit. 'blocked' means a gum bubble popped instead; 'immune' means nothing happened. */
export function applyHit(k: Kart, kind: HitKind): 'hit' | 'blocked' | 'immune' {
  if (k.invulnT > 0 || k.fallT > 0) return 'immune';
  const hard = kind === 'spin' || kind === 'pop';
  if (hard && k.spinT > 0) return 'immune';
  if (hard && k.shieldT > 0) {
    k.shieldT = 0;
    k.invulnT = 0.5;
    return 'blocked';
  }
  k.drift = 0;
  k.driftT = 0;
  k.tier = 0;
  switch (kind) {
    case 'spin':
      k.spinT = 1.1;
      k.invulnT = 1.7; // a moment to recover after the spin
      k.speed *= 0.35;
      k.boostT = 0;
      k.grapT = 0;
      break;
    case 'pop':
      k.spinT = 1.4;
      k.invulnT = 2.1;
      k.speed *= 0.2;
      k.vy = 7;
      k.air = true;
      k.boostT = 0;
      k.grapT = 0;
      break;
    case 'slow':
      k.slowT = Math.max(k.slowT, 2.6);
      break;
    case 'slick':
      k.slickT = Math.max(k.slickT, 1.6);
      break;
    case 'blind':
      k.slowT = Math.max(k.slowT, 1.4);
      k.blindT = Math.max(k.blindT, 2.6);
      break;
  }
  return 'hit';
}

export type BuffKind = 'espresso' | 'gum' | 'sugarRush' | 'ghostPepper' | 'grapple' | 'start';

export function applyBuff(k: Kart, kind: BuffKind, x = 0, z = 0): void {
  switch (kind) {
    case 'espresso':
      k.boostT = Math.max(k.boostT, 1.5);
      k.boostMul = 1.38;
      break;
    case 'start':
      k.boostT = Math.max(k.boostT, 1.2);
      k.boostMul = 1.3;
      break;
    case 'gum':
      k.shieldT = 12;
      break;
    case 'sugarRush':
      k.boostT = Math.max(k.boostT, 3);
      k.boostMul = 1.32;
      k.invulnT = Math.max(k.invulnT, 3);
      k.sugarT = 3;
      k.spinT = 0;
      k.slowT = 0;
      break;
    case 'ghostPepper':
      k.fireT = 3.5;
      break;
    case 'grapple':
      k.grapT = 1.1;
      k.grapX = x;
      k.grapZ = z;
      break;
  }
}

export interface PadRuntime {
  s: number;
  lat: number;
  w: number;
  kind: 'boost' | 'ramp';
}

export function padsFor(track: Track): PadRuntime[] {
  return track.def.pads.map((p) => ({ s: p.at * track.length, lat: p.lat, w: p.w ?? 4, kind: p.kind }));
}

/**
 * Push two karts apart. Heavier karts shove lighter ones. Returns true if they touched.
 * `moveA`/`moveB` say which karts this side is allowed to move (the page only moves its own).
 */
export function bump(a: Kart, b: Kart, moveA = true, moveB = true): boolean {
  if (a.fallT > 0 || b.fallT > 0 || Math.abs(a.y - b.y) > 2) return false;
  const dx = b.x - a.x, dz = b.z - a.z;
  const d = Math.hypot(dx, dz);
  const R = 1.9;
  if (d >= R || d < 1e-6) return false;
  const wa = statsFor(a.char).weight, wb = statsFor(b.char).weight;
  const push = R - d;
  const nx = dx / d, nz = dz / d;
  const fa = moveB ? wb / (wa + wb) : 1;
  const fb = moveA ? wa / (wa + wb) : 1;
  if (moveA) {
    a.x -= nx * push * fa;
    a.z -= nz * push * fa;
  }
  if (moveB) {
    b.x += nx * push * fb;
    b.z += nz * push * fb;
  }
  return true;
}
