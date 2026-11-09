# Handoff

State as of v0.1.0 (2026-11-09).

## Done

- Everything listed under v0.1 in ROADMAP.md: 8 racers with abilities, 6 items, 2 tracks, CPU drivers, solo races and online rooms, desktop, gamepad and touch controls, and synthesized sound.
- Tests (`npm test`): track geometry, drift tiers, shields, lap counting, item odds, full 8-CPU races on both tracks, and room flow (host rules, a whole race with one reporting player and one who leaves, teleport rejection).
- Checked in headless Chrome: title, lobby, a race on both tracks, phone landscape and portrait, and a two-browser online room through the real server (`scripts/mp.mjs`). The Docker image builds and answers `/health`.

## Not done yet

- **Not deployed.** The VM still needs the clone, the deploy script and key, and the Cloudflare hostname. The steps are in docs/hosting.md.
- **No human playtest yet.** Drift feel, turn rates, item odds and ability strength are first guesses. In CPU-only sims Hotshot Hal wins most races.
- **Sounds and music** were written blind and haven't been listened to.

## Where things are

- Drift tuning: `DRIFT_TIERS` and `DRIFT_BOOST` in `src/sim/kart.ts`, plus `statsFor()` for how racer stats become speed, acceleration, turning and weight.
- Item odds: the `odds` arrays in `src/sim/items.ts`. Ability effects: `useAbility()` in `src/sim/race.ts`.
- Track layouts: `src/sim/tracks.ts`. Control points are `[x, z, height, width, edge, bridge]`. Run `npm test` after editing, because the CPU races catch layouts karts can't finish.
