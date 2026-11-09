# Handoff

This is the state as of **v0.1.0, live at https://crunch.parbs.online since 2026-11-09**. It's written for whoever picks the project up next. README.md covers running it, ROADMAP.md the plan and decisions, and docs/hosting.md the server.

## Where it stands

Everything under v0.1 in ROADMAP.md is built, pushed and deployed:
- 8 racers, each with a signature ability
- 6 crate items
- 2 tracks: Picnic Park, and Nacho Volcano (a figure-eight that crosses itself on a bridge)
- CPU drivers
- solo races, plus online rooms with 4-letter codes
- keyboard, gamepad and touch controls
- synthesized sound and music

How each part was checked:

| Check | Result |
| --- | --- |
| `npm test` (11 tests) | Passes. Covers track geometry, drift tiers, shields, lap counting, item odds, full 8-CPU races on both tracks, and room flow: host-only settings, a whole race with one player who reports and one who leaves, and teleport rejection |
| Headless screenshots (`npm run shots`) | Title, lobby, both tracks, phone at 640x360 and 360x640. No console errors |
| Two browsers in one room (`scripts/mp.mjs`) | Passed against a local server **and against the live site** through Cloudflare |
| Docker image | Builds and answers `/health`. The VM runs it as `crunch-rally-crunch-1` |

**Not checked yet:**
- **No human has played it.** Drift feel, turn rates, wall bounce, item odds and ability strength are first guesses. In CPU-only races Hotshot Hal wins most of the time.
- **Nobody has listened to the sound.** `src/audio/sfx.ts` was written blind.
- **The racer models were only seen in screenshots.** Kernel Pop reads poorly from behind: it looks like popcorn on a black box, and the red-and-white bucket is hidden.

## How it fits together

```
src/sim     rules, no Three.js and no DOM; the server bundles it
  track.ts    centerline sampled every ~2 m; locate() gives distance along the lap and sideways offset
  tracks.ts   the two layouts: control points [x, z, height, width, edge, bridge], item rows, pads, theme
  kart.ts     physics, drift, hits, buffs, laps; stepKart() runs one 1/60 s step
  race.ts     authoritative race: CPUs, crates, items, abilities, hits, standings, finish, snapshots
  bot.ts      CPU driving and item tactics
src/net
  protocol.ts message types and PROTOCOL_VERSION
  room.ts     lobby, host, settings, starting races; ticks the Race and sends snapshots at 20 Hz
  link.ts     WsLink (online) or LocalLink (a Room running inside the page for solo play)
src/game
  raceClient.ts  the page's view of a race: my kart predicted locally, others interpolated
  input.ts       keyboard, gamepad, touch
src/render   world.ts (scene, camera, effects), trackMesh.ts, models.ts, props.ts
src/main.ts  screens, HUD, minimap, sound triggers, main loop
server/index.ts  HTTP + WebSocket, rooms by code, limits; 60 Hz tick for all rooms
```

**Netcode in one paragraph:** each page runs its own kart's physics and reports position 20 times a second (`st` messages). The server trusts the report except for teleports. The server's `Race` owns everything else: CPU karts, crates, projectiles, hazards, abilities, hit decisions, lap counting from reported positions, places, and the finish. It sends snapshots at 20 Hz. Pages draw other karts 100 ms in the past and interpolate between snapshots. When the server decides you were hit, it sends a `hit` event and your page applies it to your kart. Solo play uses exactly the same path, with the `Room` running in the page.

## Things that will bite you

- **Conventions:**
  - Forward is `(cos h, sin h)` in x,z.
  - Steering +1 turns right, which makes `h` grow.
  - Sideways offset `lat` is positive to the right; the right-hand normal is `(-tz, tx)`.
  - Models face +Z, so `rotation.y = PI/2 - h`.
- **Hit loops.** The first version spun karts out about 550 times a race, because a kart sitting in a flame trail or on butter got hit again every tick. Now `applyHit()` returns `'hit' | 'blocked' | 'immune'`, a spinning kart can't be spun again, and a spin gives 1.7 s of invulnerability afterwards. If you add a hazard that stays in the world, check the hit counts with the sim script below.
- **Bridge crossing.** `locate()` with a hint only searches ±30 samples (about 60 m) around the last position, and penalizes height differences over 4 m. That's what keeps karts on the right level where Nacho Volcano crosses itself. A search without a hint (`-1`) covers the whole track and can pick the wrong level, so pass a height.
- **Crate positions** come only from `crateSpots()` in `race.ts`. The renderer uses it too, so the indices match the snapshot's crate bitmask. Don't place crates anywhere else.
- **Other karts' lap progress.** Snapshots carry position, lap and place, but not the distance along the lap. On the page, `kart.s` for other karts stays at its grid value. Use `place` for ordering, not `s`.
- **Salsa height.** `props.ts` builds the salsa plane at y = -0.6, and `world.ts` lifts it by 0.6 after building, because the ground plane would hide it otherwise. If you regenerate props, keep that in mind.
- **Headless Chrome is slow.** The game caps a frame at 0.05 s, so at a few frames per second the countdown and your own kart run in slow motion in screenshots and in `mp.mjs`. That's the test environment, not a bug. The same cap means real phones below 20 fps play in slow motion too.
- **Countdown timing.** Each page starts its countdown when the `race` message arrives, so on a laggy connection a player starts a little after the CPUs.
- **Randomness.** CPUs use `Math.random()` for lane changes and item timing, so races aren't reproducible. Tests check outcomes across a whole race, not exact numbers.
- **No reconnect.** A server rebuild (`npm run ship`) ends races in progress, and players land back on the title screen with "Lost connection". Permafrost's page reconnects; this one doesn't yet.
- **Protocol version.** Bump `PROTOCOL_VERSION` in `src/net/protocol.ts` whenever old pages can't understand the new messages. Old pages are told to refresh when they next create or join a room.
- **Small cleanup:** `main.ts` reads the renderer's private `preview` field (`world['preview']`). It should get a public getter.

## Tuning knobs

| What | Where |
| --- | --- |
| Drift charge thresholds and boost lengths | `DRIFT_TIERS`, `DRIFT_BOOST` in `src/sim/kart.ts` |
| How stats become speed, acceleration, turning, weight | `statsFor()` in `src/sim/kart.ts` |
| Off-road slowdown, wall bounce, hop height, ramp launch | inside `stepKart()` |
| Item odds by position | the `odds` arrays in `src/sim/items.ts` |
| Item and ability effects | `useItem()` and `useAbility()` in `src/sim/race.ts` |
| Ability charge rates | `METER_PASSIVE`, `METER_DRIFT`, `METER_HIT` in `src/sim/race.ts` |
| CPU skill and catch-up | `newBrain()` in `src/sim/bot.ts`, `catchUp()` in `src/sim/race.ts` |
| Track layouts | `src/sim/tracks.ts` (run `npm test` after: the CPU races catch layouts karts can't finish) |
| Race end | the room closes when every player has finished, or 45 s after the first player finishes (`FINISH_GRACE`) |

To see the effect of a balance change without a browser, run a full CPU race and print the results, hit counts and ability uses:

```sh
npx esbuild scripts/simrace.ts --bundle --platform=node --format=esm --outfile=$TEMP/simrace.mjs && node $TEMP/simrace.mjs
```

A healthy result is laps of about 28-30 s on both tracks, all 8 karts finishing, and roughly 30-45 hits per 3-lap race.

## Shipping

- `npm run ship` checks git, runs the typecheck, tests and builds, pushes `main`, deploys over the locked SSH key, and waits for `/health` to show the new version. `npm run ship -- patch` bumps the version first.
- It only works from the home network. The VM address and key path are in `.deploy.local.json`, which git ignores.
- Only ship when the user asks, because it ends races in progress.
- After shipping, `URL=https://crunch.parbs.online/ node scripts/mp.mjs` is a quick end-to-end check of rooms through Cloudflare.

## Suggested next steps

1. **Get a playtest from the user** on desktop and on a phone, then tune using the knobs above. Hotshot Hal's speed and the drift feel come first.
2. **Fix what the playtest turns up,** plus the Kernel Pop model from behind.
3. **Add page reconnect** after a dropped connection: rejoin the same room, and take your kart back from the CPU if the race is still on. Server rebuilds currently end everyone's race.
4. **Start v0.2 from ROADMAP.md:** slipstream, holding items behind you, a CPU difficulty setting, and rematch voting.
