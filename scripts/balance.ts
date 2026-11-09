// Many CPU-only races with a shuffled grid and fixed skill, to compare racers fairly.
// npx esbuild scripts/balance.ts --bundle --platform=node --format=esm --outfile=$TEMP/balance.mjs && node $TEMP/balance.mjs [races]
import { CHARACTERS } from '../src/sim/characters';
import { Race } from '../src/sim/race';
const N = Number(process.argv[2] ?? 24);
for (const id of ['picnic', 'nacho']) {
  const pts: Record<string, number> = {}, wins: Record<string, number> = {};
  for (const c of CHARACTERS) (pts[c.id] = 0), (wins[c.id] = 0);
  let laps = 0, lapN = 0;
  for (let i = 0; i < N; i++) {
    const order = [...CHARACTERS].sort(() => Math.random() - 0.5);
    const race = new Race(id, 3, order.map((c) => ({ id: c.id, name: c.name, char: c.id, bot: true })), i + 1, () => {});
    for (const r of race.racers) if (r.brain) r.brain.skill = r.kart.mul = 0.96;
    let n = 0;
    while (race.phase !== 'done' && n++ < 60 * 400) race.tick();
    for (const r of race.results) {
      pts[r.char] += r.place;
      if (r.place === 1) wins[r.char]++;
      if (r.time) (laps += r.time / 3), lapN++;
    }
  }
  console.log(id, 'avg lap', (laps / lapN).toFixed(1));
  for (const c of CHARACTERS) console.log('  ', c.id.padEnd(7), 'wins', String(wins[c.id]).padStart(3), 'avg place', (pts[c.id] / N).toFixed(2));
}
