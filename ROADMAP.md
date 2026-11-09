# Crunch Rally roadmap

Crunch Rally is an original multiplayer kart racer for the browser and phones. Living snack mascots race low-poly karts around giant-food worlds. It plays like the classic arcade kart racers: drift to charge a boost, grab item crates, and use each racer's own special ability. All the names, characters, items and tracks are its own.

## Decisions so far

| Topic | Decision |
| --- | --- |
| Theme | Original snack mascots (hot sauce, pickle, donut, popcorn, cheese, soda, gummy bear, broccoli) |
| Look | Low-poly 3D in Three.js. Every model is built in code, with no model or image files |
| Platforms | Desktop (keyboard or gamepad) and phones (touch). The smallest supported screens are 640x360 and 360x640 |
| Online | Rooms with 4-letter codes, up to 8 racers, CPUs fill empty seats. No public matchmaking yet |
| Hosting | crunch.parbs.online: one container on the Debian VM behind Scrap Riot's Cloudflare Tunnel, like Permafrost |
| Netcode | Your own kart is simulated in your browser and reported to the server 20 times a second. The server owns CPUs, crates, items, abilities, hits, standings and the finish. Other karts are drawn 100 ms in the past and interpolated |

## v0.1: first playable (done)

- **Driving:** arcade physics with hills, off-road slowdown, walls you scrape along, and salsa you fall into (a respawn sets you back on the road).
- **Drift boosts:** hop and drift, steer into the turn to charge faster, and let go for a boost. There are three spark tiers (cyan, orange, magenta) with boosts of 0.6, 1.3 and 2.1 s.
- **Rocket start:** hold the gas at the right moment in the countdown.
- **Ramps:** a ramp launches you, and pressing drift in the air does a trick for a landing boost.
- **Boost pads.**
- **Eight racers,** each with stats and a signature ability. The ability meter fills from drift boosts, hits on rivals, and slowly by itself.

  | Racer | Ability | What it does |
  | --- | --- | --- |
  | Hotshot Hal (hot sauce) | Ghost Pepper | Speed burst, with a fire trail that spins people out |
  | Dill Pickleton (pickle) | Brine Wave | A big slippery puddle behind you |
  | Glaze (donut) | Sugar Rush | 3 s of invincible boost; ramming spins people out |
  | Kernel Pop (popcorn) | Pop Burst | Spins out everyone close by |
  | Big Brie (cheese) | Stink Bomb | A cloud down the road that slows and blinds |
  | Fizz (soda) | Cola Rocket | Homing rocket aimed at whoever is in first |
  | Gummo (gummy bear) | Gummy Grapple | Grab the kart ahead and slingshot past |
  | Professor Brock (broccoli) | Health Kick | Slows everyone just ahead |

- **Six crate items, weighted by position:** Jawbreaker, which bounces off walls; Homing Taffy; Butter Pat, a trap; Espresso Shot, which comes as three near the back; Bubble Gum, a shield; and Sugar Crash, a catch-up item that slows everyone ahead. Projectiles and traps cancel each other out.
- **Two tracks:**
  - **Picnic Park:** a wide beginner loop with a hill jump and grass shoulders.
  - **Nacho Volcano:** a figure-eight that crosses itself on a bridge, with salsa drop-offs.
- **CPU drivers:**
  - They take racing lines, drift through bends and get rocket starts some of the time.
  - They use items and abilities with simple tactics.
  - Mild catch-up keeps them in contention.
- **Rooms:** a host picks the track, laps (1-5) and whether CPUs fill empty seats. There are invite links (`?room=CODE`). A player who leaves mid-race is taken over by a CPU.
- **Solo races** run in the browser with no server.
- **HUD:**
  - Place, lap and timer.
  - Item roulette and the ability meter.
  - A minimap, countdown, "wrong way" and "final lap" warnings, and a results table.
- **Controls and effects:**
  - Emotes in online rooms.
  - Touch controls: drag to steer, automatic gas, and drift, item, ability and brake buttons.
  - Gamepad support.
  - Sound effects and music, all synthesized in code.

## v0.2: feel and fairness (next)

These are the most fun for the least work. Most come from what makes the classic kart racers feel good.

- **Playtest pass:** tune drift charge times, turn rates, wall bounce, the item odds table and the ability charge rate. Find out whether Hotshot Hal's top speed is too strong. In CPU-only sims he wins most races.
- **Slipstream:** after about 1.5 s right behind another kart, get a short boost. Show wind lines.
- **Hold items behind you:** hold the item button to trail a Butter Pat or Jawbreaker behind you as a shield, and let go to drop or throw it.
- **Throw items backward:** hold down or brake while firing.
- **CPU difficulty setting** (Easy, Normal or Hard) in the room settings.
- **Touch assists:** optional auto-drift (drift starts when you steer hard) and optional tilt steering.
- **Rematch flow:** a "Race again" button on results that keeps the room. Track voting: everyone votes and a random vote wins.
- **Podium:** a short podium scene with the top 3 mascots.
- **Server checks** on reported speed and laps, beyond the current teleport check.
- **Rejoin a room after a short disconnect** instead of a CPU keeping your kart.
- **Remote kart sounds:** engine and drift sounds for nearby karts, not only your own.

## v0.3: more to race

- **Grand Prix cups:** 4 races, with points 15/12/10/8/6/4/2/1 and a final podium.
- **New tracks** (2-3 per release):
  - **Freezer Aisle:** ice-cream ice with slippery patches, popsicle-stick bridges and frozen-pea hazards.
  - **Conveyor Sushi Bar:** conveyor belts that push karts, and chopstick gates that open and close.
  - **Vending Machine Tower:** a vertical climb through a giant vending machine, with coil spirals and a drop chute shortcut.
  - **Midnight Diner:** a night track with neon, a jukebox and a griddle section that's hot to touch.
- **Mirror mode** and a faster "Extra Crispy" speed class.
- **Shortcuts on existing tracks,** some of which need a boost to make.

## v0.4: battle mode

- **Crumb Battle** in small arenas: each racer has 3 crumbs, a hit knocks one off, and the last kart with crumbs wins.
- **Golden Pretzel:** hold the pretzel for 30 s total to win. A hit makes you drop it.
- **Two arena maps:** Lunchbox and Bakery Rooftop.

## v0.5: time trials and dailies

- **Time trial** with ghost replays. Record inputs, replay them deterministically, and race your best ghost.
- **Daily challenge:** a fixed track, racer and conditions each day, with a leaderboard, like Rift Daily.
- **Server-side best times per track** (SQLite, like Permafrost).

## v0.6: make it yours

- **Kart cosmetics:** paint, wheels, horns, exhaust trails and decals, unlocked with Crumbs earned by racing. There are no stat changes, so it stays fair.
- **Profile code** (like Permafrost) so unlocks follow you between devices, with no accounts or passwords.
- **Challenges:** "hit 3 rivals with Jawbreakers" and similar, which award Crumbs.

## v0.7: Crunch pickups

- **Crunch pickups:** collectible crumbs scattered along the racing line. Holding 10 makes your items Extra Crispy. Jawbreakers get bigger, Taffy turns faster and Butter becomes a slick.
- **Top speed bonus:** a small top-speed bonus per crumb held, all lost when you're hit.

## Later

- **Four more racers:**
  - Mallow, a toasted marshmallow whose Campfire ability leaves a sticky goo trail.
  - Twist, a pretzel who can Tie the Knot and loop a kart back behind.
  - Spud, a potato chip bag who Pops the Bag to burst into chip shrapnel.
  - Nori, a sushi roll who Rolls Up into an armored ball.
- **Team races** (2v2 or 4v4) with team colors and team slipstreams.
- **Public quick match,** once there are enough players to fill it.
- **Spectating** a race in progress, plus a camera that follows the leader after you finish.
- **Ranked rating and seasons.**
- **Adventure mode:** a hub world, boss races against giant mascots, and keys to unlock tracks.
- **Better art:** smoother karts, more crowd and track props, and weather (rain on Picnic Park).

## Known issues and limits (v0.1)

- **Trusted positions:** your own kart's position is trusted within limits, so a modified page could cheat. That's fine for friends' rooms. Ranked play would need server checks.
- **Lag:** on a laggy connection, hits land up to about 150 ms after you'd expect.
- **Low frame rates:** the page runs its own kart physics per frame. Below 20 fps (very old phones) it plays in slow motion.
- **No ground collision:** there's no collision with the bridge from below. Nothing tall drives under it yet.
