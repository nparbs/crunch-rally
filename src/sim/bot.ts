// CPU drivers: follow the road with a lane preference, drift through bends, use items when it
// makes sense. Same physics as players; skill only sets top speed, lines and timing.

import { charById } from './characters';
import type { Input } from './kart';
import { clamp, wrapAngle } from './math';
import type { Race, Racer } from './race';

export interface Brain {
  skill: number; // top-speed multiplier
  lane: number; // preferred sideways offset, -1..1 of the usable half width
  laneT: number;
  driftTarget: number; // spark tier it tries to reach
  holdT: number; // countdown throttle hold, for rocket starts
  startAt: number; // seconds before GO it presses the gas
  itemWait: number;
  abilityWait: number;
  sloppy: number; // steering noise
}

export function newBrain(rand: () => number): Brain {
  return {
    skill: 0.93 + rand() * 0.06,
    lane: rand() * 1.4 - 0.7,
    laneT: 2 + rand() * 4,
    driftTarget: rand() < 0.5 ? 2 : 1,
    holdT: 0,
    startAt: 0.3 + rand() * 1.3, // some get a rocket start, some don't
    itemWait: 0.6 + rand() * 2,
    abilityWait: 0.5 + rand() * 3,
    sloppy: 0.05 + rand() * 0.12,
  };
}

export function botThink(r: Racer, race: Race): { input: Input; useItem: boolean; useAbility: boolean } {
  const b = r.brain!;
  const k = r.kart;
  const tr = race.track;
  const dt = 1 / 60;

  b.laneT -= dt;
  if (b.laneT <= 0) {
    b.laneT = 2 + Math.random() * 4;
    b.lane = clamp(b.lane + (Math.random() - 0.5) * 0.8, -0.8, 0.8);
  }

  const loc = tr.locate(k.x, k.z, k.si, k.y);
  const look = 7 + Math.max(0, k.speed) * 0.5;
  // Cut the inside of bends a little.
  const bend = tr.turnAhead(loc.i, 30);
  const half = tr.w[loc.i] / 2 - 2;
  const lane = clamp(b.lane * half + clamp(bend * 5, -half * 0.6, half * 0.6), -half, half);
  const p = tr.pointAt(loc.s + look, lane);
  const want = Math.atan2(p.z - k.z, p.x - k.x);
  const err = wrapAngle(want - k.h);
  let steer = clamp(err * 2.6 + Math.sin(k.t * 1.7 + b.lane * 9) * b.sloppy, -1, 1);
  let throttle = Math.abs(err) > 1.3 ? 0.3 : 1;
  if (k.speed < 2 && Math.abs(err) > 2.2) {
    throttle = -1; // stuck facing a wall: back up
    steer = -steer;
  }

  // Drift through bends that are sharp enough to be worth it.
  let drift = false;
  const sharp = Math.abs(tr.turnAhead(loc.i, 22));
  if (k.drift !== 0) {
    const overshoot = err * k.drift < -0.35;
    const easing = Math.abs(tr.turnAhead(loc.i, 10)) < 0.12 && k.tier >= 1;
    drift = !(overshoot || (k.tier >= b.driftTarget && easing) || (k.tier >= 3 && easing));
  } else if (sharp > 0.55 && k.speed > 15 && Math.abs(err) > 0.12 && Math.abs(err) < 0.9) {
    drift = true;
  }

  // Items.
  let useItem = false;
  if (r.item && r.rolling <= 0) {
    b.itemWait -= dt;
    if (b.itemWait <= 0) {
      useItem = wantsItem(r, race, Math.abs(bend) < 0.3);
      if (useItem || b.itemWait < -8) {
        useItem = true;
        b.itemWait = 0.6 + Math.random() * 2;
      }
    }
  }

  // Ability.
  let useAbility = false;
  if (r.meter >= 1) {
    b.abilityWait -= dt;
    if (b.abilityWait <= 0) {
      useAbility = wantsAbility(r, race) || b.abilityWait < -10;
      if (useAbility) b.abilityWait = 0.5 + Math.random() * 3;
    }
  }

  // Keep the grapple aimed at whoever it grabbed.
  const g = race.grappleTarget(k);
  if (g) {
    k.grapX = g.x;
    k.grapZ = g.z;
  }

  return { input: { throttle, steer, drift }, useItem, useAbility };
}

function nearby(r: Racer, race: Race, range: number, cone: number): Racer[] {
  const k = r.kart;
  const fx = Math.cos(k.h), fz = Math.sin(k.h);
  return race.racers.filter((o) => {
    if (o === r) return false;
    const dx = o.kart.x - k.x, dz = o.kart.z - k.z;
    const d = Math.hypot(dx, dz);
    return d < range && (dx * fx + dz * fz) / (d || 1) > cone;
  });
}

function wantsItem(r: Racer, race: Race, straight: boolean): boolean {
  switch (r.item) {
    case 'jawbreaker':
      return nearby(r, race, 45, 0.93).length > 0;
    case 'taffy':
      return r.place > 0;
    case 'butter':
      return nearby(r, race, 25, -2).some((o) => o.place > r.place);
    case 'espresso':
      return straight;
    default:
      return true;
  }
}

function wantsAbility(r: Racer, race: Race): boolean {
  switch (charById(r.char).ability) {
    case 'popBurst':
      return nearby(r, race, 11, -2).length > 0;
    case 'healthKick':
      return nearby(r, race, 30, 0.3).length > 0;
    case 'gummyGrapple':
      return nearby(r, race, 60, 0.6).length > 0;
    case 'colaRocket':
      return r.place > 0;
    case 'brineWave':
    case 'ghostPepper':
      return race.racers.some((o) => o.place === r.place + 1);
    default:
      return true;
  }
}
