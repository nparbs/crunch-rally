import { CHARACTERS } from '../src/sim/characters';
import { Race, type RaceEvent } from '../src/sim/race';
for (const id of ['picnic', 'nacho']) {
  const ev: RaceEvent[] = [];
  const race = new Race(id, 3, CHARACTERS.map((c, i) => ({ id: c.id, name: c.name, char: c.id, bot: true })), 3, (e) => ev.push(e));
  let falls = 0, walls = 0;
  let n = 0;
  while (race.phase !== 'done' && n++ < 60 * 400) race.tick();
  const count = (k: string) => ev.filter((e) => e.k === k).length;
  console.log(id, 'len', race.track.length.toFixed(0), 'secs', (n / 60).toFixed(1));
  console.log(' results', race.results.map((r) => `${r.place}.${r.char} ${r.time?.toFixed(1)}`).join(' | '));
  console.log(' items', count('item'), 'hits', count('hit'), 'blocked', count('blocked'), 'abilities', count('ability'), 'go', count('go'));
  const hitKinds: Record<string, number> = {};
  for (const e of ev) if (e.k === 'hit') hitKinds[e.kind] = (hitKinds[e.kind] ?? 0) + 1;
  console.log(' hit kinds', JSON.stringify(hitKinds));
}
