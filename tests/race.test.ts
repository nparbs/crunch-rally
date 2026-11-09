import { describe, expect, it } from 'vitest';
import { CHARACTERS } from '../src/sim/characters';
import { DRAFT_TIME, DRIFT_BOOST, applyHit, newKart, padsFor, placeOnGrid, slipstream, stepKart, updateProgress } from '../src/sim/kart';
import { rollItem } from '../src/sim/items';
import { Race, type RaceEvent } from '../src/sim/race';
import { getTrack } from '../src/sim/track';
import { TRACKS } from '../src/sim/tracks';

function botRace(trackId: string, laps = 2, seed = 7) {
  const events: RaceEvent[] = [];
  const entrants = CHARACTERS.map((c, i) => ({ id: 'b' + i, name: c.name, char: c.id, bot: true }));
  const race = new Race(trackId, laps, entrants, seed, (e) => events.push(e));
  let steps = 0;
  while (race.phase !== 'done' && steps < 60 * 400) {
    race.tick();
    steps++;
  }
  return { race, events, seconds: steps / 60 };
}

describe('tracks', () => {
  for (const def of TRACKS) {
    it(`${def.id} is a sensible size and locates its own centerline`, () => {
      const t = getTrack(def);
      expect(t.length).toBeGreaterThan(500);
      expect(t.length).toBeLessThan(1200);
      for (let i = 0; i < t.n; i += 7) {
        const loc = t.locate(t.x[i], t.z[i], -1, t.y[i]);
        expect(Math.abs(loc.lat)).toBeLessThan(0.5);
        const ds = Math.abs(loc.s - t.s[i]);
        expect(Math.min(ds, t.length - ds)).toBeLessThan(3);
      }
    });
  }
});

describe('kart', () => {
  it('a held drift charges up to the top tier and fires a boost on release', () => {
    const t = getTrack(TRACKS[0]);
    const k = newKart('a', 'dill');
    placeOnGrid(k, t, 0);
    const pads = padsFor(t);
    for (let i = 0; i < 120; i++) stepKart(k, { throttle: 1, steer: 0, drift: false }, t, 1 / 60, pads);
    expect(k.speed).toBeGreaterThan(15);
    for (let i = 0; i < 30; i++) stepKart(k, { throttle: 1, steer: 1, drift: true }, t, 1 / 60, pads);
    expect(k.drift).toBe(1);
    k.driftT = 3; // skip ahead: fully charged
    stepKart(k, { throttle: 1, steer: 1, drift: true }, t, 1 / 60, pads);
    expect(k.tier).toBe(3);
    const ev = stepKart(k, { throttle: 1, steer: 0, drift: false }, t, 1 / 60, pads);
    expect(ev.some((e) => e.k === 'mt' && e.tier === 3)).toBe(true);
    expect(k.boostT).toBeCloseTo(DRIFT_BOOST[3], 1);
  });

  it('a shield blocks one spin, invulnerability blocks everything', () => {
    const k = newKart('a', 'hal');
    k.shieldT = 5;
    expect(applyHit(k, 'spin')).toBe('blocked');
    expect(k.shieldT).toBe(0);
    k.invulnT = 0;
    expect(applyHit(k, 'spin')).toBe('hit');
    k.spinT = 0;
    k.invulnT = 1;
    expect(applyHit(k, 'slow')).toBe('immune');
  });

  it('laps only count after passing every sector', () => {
    const t = getTrack(TRACKS[0]);
    const k = newKart('a', 'hal');
    placeOnGrid(k, t, 0);
    const L = t.length;
    updateProgress(k, 1, 0, t); // cross the line from the grid
    expect(k.lap).toBe(1);
    updateProgress(k, L - 1, 0, t); // back over the line
    expect(k.lap).toBe(0);
    updateProgress(k, 2, 0, t);
    expect(k.lap).toBe(1);
    for (const f of [0.3, 0.55, 0.8, 0.99]) updateProgress(k, f * L, 0, t);
    updateProgress(k, 1, 0, t);
    expect(k.lap).toBe(2);
  });
});

describe('items', () => {
  it('leaders never get Sugar Crash and the back gets triple espresso', () => {
    for (let i = 0; i < 200; i++) expect(rollItem(0, i / 200).item).not.toBe('sugarCrash');
    const back = Array.from({ length: 200 }, (_, i) => rollItem(1, i / 200));
    expect(back.some((r) => r.item === 'espresso' && r.count === 3)).toBe(true);
  });
});

describe('a race of CPUs', () => {
  for (const def of TRACKS) {
    it(`finishes on ${def.id} with everyone done at a sane pace`, () => {
      const { race, events, seconds } = botRace(def.id, 2);
      expect(race.phase).toBe('done');
      const finished = race.results.filter((r) => r.time !== null);
      expect(finished.length).toBe(8);
      const best = Math.min(...finished.map((r) => r.time!));
      // Two laps: roughly 25-45 seconds a lap.
      expect(best / 2).toBeGreaterThan(20);
      expect(best / 2).toBeLessThan(45);
      expect(seconds).toBeLessThan(200);
      // The race was lively: items were used and somebody got hit.
      expect(events.some((e) => e.k === 'item')).toBe(true);
      expect(events.some((e) => e.k === 'hit')).toBe(true);
      expect(events.some((e) => e.k === 'ability')).toBe(true);
    });
  }

  it('slipstream boosts a kart that stays tucked in behind another', () => {
    const me = newKart('me', 'dill'), them = newKart('them', 'hal');
    Object.assign(me, { x: 0, z: 0, h: 0, speed: 24 });
    Object.assign(them, { x: 7, z: 0.4, h: 0, speed: 24 });
    let fired = 0;
    for (let t = 0; t < DRAFT_TIME + 0.1; t += 1 / 60) if (slipstream(me, [me, them], 1 / 60)) fired++;
    expect(fired).toBe(1);
    expect(me.boostT).toBeGreaterThan(0.9);
    // Off to the side: no draft.
    const side = newKart('side', 'dill');
    Object.assign(side, { x: 0, z: 5, h: 0, speed: 24 });
    for (let t = 0; t < 3; t += 1 / 60) expect(slipstream(side, [side, them], 1 / 60)).toBeNull();
    expect(side.draftT).toBe(0);
  });
});
