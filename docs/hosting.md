# Hosting at crunch.parbs.online

One Docker container serves the game page, the WebSocket the page talks to, and every race room. It runs on the Debian VM next to Scrap Riot and reaches the internet through Scrap Riot's existing Cloudflare Tunnel, the same way as Permafrost, Trailer Park Tamers and Rift Daily.

```
player ──https──> Cloudflare ──tunnel──> cloudflared (Scrap Riot's) ──> crunch:8792 (this container)
                                                                         ├─ /        the game page
                                                                         ├─ /ws      race rooms
                                                                         └─ /health  status
```

## What it stores

Nothing. Rooms live in memory and disappear a minute after the last player leaves. There is no database or volume, and the container runs read-only. Solo races run entirely in the browser and never touch the server.

## First-time setup on the VM

1. **Clone the repo.** It's public, so plain HTTPS works:

   ```sh
   git clone https://github.com/nparbs/crunch-rally.git ~/crunch-rally
   cd ~/crunch-rally
   cp .env.example .env
   ```

2. **Check the tunnel network name.** The container joins the network Scrap Riot's `cloudflared` is on. It's normally `scrap-riot_default`:

   ```sh
   sg docker -c "docker network ls" | grep scrap
   ```

   If it's different, set `TUNNEL_NETWORK` in `.env`.

3. **Start it.**

   ```sh
   sg docker -c "docker compose up -d --build"
   sg docker -c "docker compose ps"
   sg docker -c "docker compose exec crunch node -e \"fetch('http://127.0.0.1:8792/health').then(r=>r.text()).then(console.log)\""
   ```

4. **Add the hostname in Cloudflare.** In the Cloudflare dashboard, open Zero Trust, then Networks, then Tunnels, and edit the tunnel Scrap Riot uses. Under Public Hostnames, add:

   | Field | Value |
   | --- | --- |
   | Subdomain | `crunch` |
   | Domain | `parbs.online` |
   | Service | `HTTP`, `crunch:8792` |

   Cloudflare creates the DNS record itself. WebSockets work through tunnels by default.

5. **Check from anywhere:** `curl https://crunch.parbs.online/health` should return something like `{"ok":true,"version":"0.1.0","online":0,"rooms":0,"racing":0}`.

## Deploying updates

Same pattern as the other games: a key on the PC that can only run the deploy script.

```sh
cp deploy/deploy-crunch-rally.sh ~/deploy-crunch-rally.sh && chmod +x ~/deploy-crunch-rally.sh
# In ~/.ssh/authorized_keys, one line for the PC's crunch-rally-deploy key:
# command="/home/deb/deploy-crunch-rally.sh",no-port-forwarding,no-agent-forwarding,no-X11-forwarding,no-pty ssh-ed25519 AAAA... crunch-rally-deploy
```

Then from the PC, `npm run ship` checks, pushes, deploys and waits for `/health` to report the new version. It reads the VM address and key from `.deploy.local.json`, which git ignores (see the top of `scripts/ship.mjs`). `npm run ship -- patch` bumps the version first.

A rebuild ends any races in progress and sends those players back to the title screen. When `PROTOCOL_VERSION` in `src/net/protocol.ts` changes, pages left open are told to refresh when they next create or join a room.

## Limits and notes

- 6 connections per IP address, 80 players online at once (`MAX_ONLINE`) and 20 rooms (`MAX_ROOMS`). Each connection also has a message rate limit.
- Rooms hold up to 8 racers. Each running race costs about 0.1 ms of CPU per tick at 60 ticks a second, so 20 rooms fit easily in the 384 MB, single-core-ish budget.
- Names are cleaned to 14 letters, digits and simple punctuation. There's no chat, only 8 fixed emotes.
- Players' own kart positions are trusted within limits (teleports are ignored). That's fine for friends' rooms, but see the roadmap before adding anything ranked.
- The container is on Scrap Riot's Docker network, as the other games are.

## Running it locally

```sh
npm run server   # builds and runs the server on :8792, serving dist/ (run npm run build first)
npm run dev      # the page on :5173, which forwards /ws to the server
node scripts/mp.mjs   # two headless browsers in one room, against :8792
```

To try the production image: `docker network create scrap-riot_default` once, then `ALLOWED_ORIGINS= docker compose up --build` and reach it from another container on that network, or temporarily add `ports: ["8792:8792"]`.
