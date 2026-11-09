# Crunch Rally

A multiplayer kart racer for the browser and phones. Snack mascots race low-poly karts around giant-food worlds. Drift to charge boosts, grab crates for items, and use your racer's own special ability.

Play at **https://crunch.parbs.online** (once it's live). Race the CPUs on your own, or create a room and send friends the 4-letter code. CPU racers fill the empty seats.

## Controls

| | Keyboard | Gamepad | Touch |
| --- | --- | --- | --- |
| Drive | `↑` `↓` `←` `→` / `WASD` | stick, A / RT gas, B / LT brake | drag on the left half (gas is automatic) |
| Hop / drift | `Space` or `Shift` (hold while turning, let go to boost) | RB / LB | DRIFT |
| Item | `E` | X | ITEM |
| Ability | `Q` | Y | ★ |
| Emotes | `1`-`8` | | menu |

Hold the gas just before **GO** for a rocket start. Press drift in the air off a ramp for a trick boost.

## Running it

```sh
npm install
npm run dev        # the page on :5173 (solo races work without the server)
npm run server     # builds and runs the room server on :8792; the dev page proxies /ws to it
npm test           # physics, laps, items, CPU races, rooms
npm run shots      # headless screenshots (needs the dev server; URL=... to pick one)
node scripts/mp.mjs  # two headless browsers in one online room (needs npm run build + npm run server)
```

## Layout

- `src/sim` holds the game rules: tracks, kart physics, items, CPU drivers and the race itself. It's free of Three.js and the DOM, so the server runs it as-is.
- `src/net` holds the protocol, the room (lobby and race host) and the page's link to it. A link is either a WebSocket or a room running inside the page for solo play.
- `src/game` has the page's view of a race, which predicts your own kart and interpolates the others, plus input.
- `src/render` is the Three.js drawing code. All models, props and the track mesh are built in code.
- `src/audio` has synthesized sound effects and music.
- `server` is the HTTP and WebSocket server, a single file once bundled.

See [ROADMAP.md](ROADMAP.md) for what's planned and [docs/hosting.md](docs/hosting.md) for the server setup.
