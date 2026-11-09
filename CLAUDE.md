# Crunch Rally

An original multiplayer snack-mascot kart racer (Three.js, TypeScript, Vite, Node + ws). See README.md for the layout and ROADMAP.md for the plan and the decisions made so far.

## Working here

- Keep it original. It's in the same genre as the classic kart racers, but don't use their names, characters, items, tracks, art or music.
- `src/sim` must stay free of Three.js and the DOM, because the server runs it.
- All models are built in code (`src/render/models.ts`, `props.ts`, `trackMesh.ts`) and all sound in `src/audio/sfx.ts`. Don't add model, image or audio files.
- Run `npm test` after changing physics, items, tracks or rooms. The CPU race tests catch broken tracks (karts that can't finish) and hit loops.
- To try balance quickly, run `npx esbuild scripts/simrace.ts --bundle --platform=node --format=esm --outfile=$TEMP/simrace.mjs && node $TEMP/simrace.mjs`. It prints full CPU races. `scripts/balance.ts` (same build command) runs many shuffled-grid races to compare racers fairly.
- For a headless check, start `npm run dev`, then run `URL=http://localhost:PORT/ npm run shots`. `window.cr` exposes `rc` (the race client), `room`, `world` and `screen`. Headless Chrome renders slowly, so the game clock runs slow in screenshots.
- Phone layouts: check at 640x360 and 360x640 at the smallest. Nothing smaller needs to work.
- Tone: bright, silly cartoon snack world. Rivalry is friendly and slapstick.
- When `ClientMsg`/`ServerMsg` change in a way old pages can't handle, bump `PROTOCOL_VERSION` in `src/net/protocol.ts`.

## Hosting

One container on the Debian VM, joined to Scrap Riot's `scrap-riot_default` network so Scrap Riot's Cloudflare Tunnel can route crunch.parbs.online to `crunch:8792`. This is the same setup as Permafrost, Trailer Park Tamers and Rift Daily. Keep LAN addresses and secrets out of the repo: `.deploy.local.json` is git-ignored. Ship with `npm run ship`, only when asked.
