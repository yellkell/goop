# FIRE FIGHT 🔥🥊

Bare-knuckle boxing at a distance, in WebXR passthrough. Two flaming iron
balls orbit your fists — **hold the trigger** and a ball roars in orbit around
your hand, **whip a punch and release** to hurl it at your opponent, **pull
the trigger again** to call it blazing back to your palm. A recalled ball
that passes **through** your opponent (or a training target) on its way home
still counts as a hit — recalling through them is a real technique. Your
orbiting ball is also your shield: it parries incoming fire out of the air.

The look is industrial future fight club — 90s UK robot-wars: gunmetal
plate, hazard-amber striping, riveted smoked-glass UI you can see your room
through, shoulder-heavy mech avatars and chunky mechanical gauntlets, with a
synthesised metal-on-metal soundscape (servos, pistons, anvil clangs). An
invisible cage stands ~10 yards out from each platform on every side; stray
fire bursts against it instead of sailing off into your house, and every
ball drags a thick FlamethrowerXR comet trail.

Built on Meta's [Immersive Web SDK](https://iwsdk.dev/) (Three.js + ECS).
Play space dimensions follow Blaston's layout — two octagonal platforms
(~1.72 × 1.5 m) facing each other — pulled slightly closer (3.4 m) for that
in-your-face boxing feel.

## Modes

- **TUTORIAL** — the guided basics for a brand-new boxer: activate, throw,
  recall, block and move, taught one paced pop-up at a time, then a quick
  graduation knockdown against a half-health bot. It rides an ordinary vs-bot
  duel that a standalone `TutorialSystem` paces with pop-ups and a calmed,
  weakened opponent — it adds nothing to any combat system, so the regular
  game is untouched.
- **CAMPAIGN** — the ARCADE panel's titan gauntlet, right under TUTORIAL:
  five single-player boss machines fought left to right on the line-up
  (~1.9 m up to ~3.9 m of plate), each a BESPOKE chassis — RUSTHOOK's
  hunched rust-brown wreck with a crane-hook arm, PISTONKAISER's anvil head,
  smokestacks and hammer-block fists, VULTURE's hooded one-eyed skull with
  swept wing plates and talons, JUGGERNAUT's squat dome-headed fortress in
  skirt armour, GOLIATH's near-black gold-crowned king — with its own
  pit-lane intro (klaxon, strobes, a bespoke entrance — RUSTHOOK winches up
  crooked in seizing jerks, PISTONKAISER press-drops from above in slam
  strokes, VULTURE swoops in off the flank, JUGGERNAUT rolls out of the dark
  at ground level, GOLIATH's rise stalls and resumes on his own clock — then
  name reveal, bell) and its own death (keel sideways / pancake in jolts /
  topple backward off a wing / sink scuttled and listing / kneel, hold, fall
  forward). Titans never throw balls: they wind up **melee and ranged strikes
  whose kill zones charge up visibly on YOUR platform** — a ghost hammer
  descends onto each slam disc so you always know where it lands, sweeps
  send a blade you watch travel, beams rake marked strips (VULTURE's track
  you and lock late), and pod **VOLLEYS** hurl fireballs straight at you —
  the one attack you can **BLOCK**: catch the shot on an ARMED fist (a ball
  roaring in orbit, trigger/grip held — the same parry law as a duel) and it
  bursts harmlessly; a bare hand takes the hit. GOLIATH enrages at half
  health. Damage runs on **per-boss weak-point patterns** — whatever
  is vulnerable **blinks** (the visor tell, the chest core, the low-blow
  emblem, GOLIATH's shoulder lamps): RUSTHOOK keeps head AND core open,
  PISTONKAISER flips head↔core every hit, VULTURE wants two hits per point,
  JUGGERNAUT cycles head → core → **low blow**, and GOLIATH is the exam —
  a five-point **crown circuit** (head → his left shoulder → core → his
  right shoulder → low) walked **three full loops** to kill, quickening with every
  closed loop, with its own attack: the **NOVA**, fire flooding the whole
  platform except one marked safe wedge — the only telegraph that means
  *stand here*. Everything else clanks. Wins bank coins + XP at the flat
  per-game rate; the **first fell of each titan pays double**, and the first
  fell of GOLIATH awards the **CHAMPION platform** (a locker exclusive the
  shop only teases). Fell all five and the line-up opens **THE GAUNTLET
  RUN** — all five back to back on a fight-time-only clock, best times on
  the line-up's boards — and finishing it unlocks **HARDCORE** (no healing,
  its own board). The in-fight HUD is floating text and bare bars — no
  boards, no lectures. The lobby **leaderboard's ARCADE tab** carries the
  online PvE run-time boards — **GAUNTLET / HARDCORE / RAID / RAID HC**,
  each ranking whole runs by the shortest cumulative fight time (raids show
  the whole squad on one row, the group ranked together on their run) —
  alongside the AIM board.
- **RAID** — the four-player group campaign, right under CAMPAIGN in the
  ARCADE panel. Matchmaking works like RANKED: hosting raises a **visible
  lobby** other boxers join from a browser; the host holds a **HARDCORE**
  breaker (no healing between titans) and the START switch, and the whole
  squad drops in together. Four platforms stand on a **semicircular arc**
  around the titan's pit — the seat-relative layout puts the boss dead ahead
  of every raider while your squadmates (avatars, voice, live health bars)
  flank you on the curve. Same five titans, raid-cut: **bigger, far tougher
  (well over 4× the health)** — and the targeting ESCALATES stage by stage:
  RUSTHOOK hunts one raider at a time (the chassis visibly squares up to its
  mark), PISTONKAISER marks TWO at once with a two-fisted hoist, and from
  VULTURE on every swing marks the WHOLE squad — hammer ghosts on every
  platform, a fan of beams, a **fireball barrage** raining rounds across
  every raider at once, novas with per-raider wedges. **Sweeps always catch everyone**: the titan winds both
  arms out wide and whips a full-turn spinning lash, the blade cascading
  around the arc platform by platform. It always runs gauntlet-style — all
  five in a row, no lobby between, until it's beaten or the whole squad is
  down (a downed raider spectates; a refit between titans stands them back
  up unless hardcore). GOLIATH ends it with two raid-only cards: the
  **DECREE** (novas bloom on EVERY platform around one shared safe bearing —
  the squad rotates together or burns) and **the resurrection** — he falls,
  lies still, shakes… and rises over six seconds to a bespoke anthem
  ("BrAîN 3AtęŘ") as his health bar refills, the second fight landing on the
  drop: crown circuit in REVERSE, enrage locked on, until he stays down.
  First full raid clear pays double.
- **AIM TRAINING** — the heart of the game. Bullseye discs and humanoid
  cutouts pop up across the gap; land your fire while they're up. Streaks
  multiply your score and the cadence ramps. Flip **targets shoot back** on
  and the cutouts return blue fire so you train dodging between throws. In
  the **last 30 seconds**, gold **octa drones** join the mix — small spinning
  octagon plates (the pub's octa-hunt targets, ported to the range) that
  strafe their lane, demand a led shot and pay 300 a pop.
- **VS BOT** — spar an iron boxer that strafes, ducks, reactively dodges your
  throws and hurls fire back on a cadence.
- **1V1 QUICK MATCH** — competitive online duels through the bundled relay
  server. Best of 5 rounds, 60 s each, knockout or higher health at the bell.
  P2P matches carry **directional voice chat**: your rival's mic is
  spatialised onto their avatar's head (HRTF), so their trash talk pans and
  ducks with them. Mic permission is asked when you queue; declining still
  lets you hear them.

## Coins, the shop & the locker

Every bout, brawl and training run banks **coins** (the riveted bolt-dollar
"$") alongside your XP — a flat amount per completed game. Your balance shows
beside the newspaper button in the lobby. CUSTOMISE opens a two-faced cosmetics
plate, each item shown as a picture (an animal silhouette — a shield for the
KNIGHT — for avatars, a little coloured pad for platforms):

- the **SHOP** (tabs: AVATARS / PLATFORMS) lists everything with prices;
  buying auto-equips it and stocks your locker. The four avatars are free, the
  three launch pads are free, the two recolours (TOXIC, PLASMA) and the
  premium **GOLD RUSH** pad each cost ten games' worth, and the top-shelf
  **XD** pad — a jet-black deck with a white XD grin — five hundred. The
  **CHAMPION** pad is never sold: its tile just says FELL GOLIATH — beat the
  campaign to claim it.
- the **LOCKER** is your inventory: equip anything you own, and a COLOUR tab
  carries the armour-suit and neon-accent hue sliders.

The wallet is shared with the pub (same browser), where coins become physical —
and feed the snake cabinet and jukebox.

## The rules of the platform

You see your platform beneath you — and its **rim barrier**. Guardian-style
walls glow awake as your head nears the edge; lean your head out past the rim
and the arena's fire drains your health *fast*. Dodge with your body, but stay
on your platform.

The lobby's left panel is **BATTLE** — every live fight in one place: the 1v1
modes (Ranked / Quick / Private) and the 2V2 / FFA brawls. The **ARCADE** panel
keeps the solo stuff (Tutorial, the titan Campaign, Aim Training). Your **arena
backdrop** — bare AR passthrough, the papercraft desert, or the old factory —
lives in the loadout's **ARENA** tab, and a round **passthrough disc** above the
BATTLE panel flips the backdrop off to your real room and back, so you can size
up your play space at a glance. The **leaderboard** groups the same way: a
**BATTLE** tab fronts the 1V1 / 2V2 / FFA boards, ARCADE fronts the aim board.

Match UI is arena-style: angled boards flank the gap (your board orange,
theirs blue) — steel-white names haloed in team neon over corner tubing and a
fading neon rule, health in a slim neon-edged track (red when nearly out),
round pips, and the bare round clock floating boxless between the bars —
plus a stats board hung behind you that you can glance back at mid-bout.

## Run it

```bash
npm install
npm run dev        # client on https://localhost:5173 (IWSDK desktop emulator included)
npm run server     # optional: the 1v1 relay on :8787
```

On a Quest, open the dev URL in the headset browser and accept the "Enter AR"
offer. On desktop, the IWSDK dev plugin provides a WebXR emulator
(WASD + mouse, controller simulation).

### Online play

Two transports, one protocol — `src/net/` picks automatically:

1. **Serverless (default)** — Firebase Firestore handles matchmaking + WebRTC
   signaling (the repurposed `arfi-b68f9` project, see
   `src/net/firebaseConfig.ts`), then ALL game traffic flows **peer-to-peer
   over RTCDataChannels**: poses on an unordered/no-retransmit channel,
   events on a reliable one. Firebase never sees a pose packet — that's the
   latency upgrade over relaying game state through a realtime database.
   One-time setup in the [Firebase console](https://console.firebase.google.com/project/arfi-b68f9):
   enable **Cloud Firestore** and allow read/write on the `lobbies`
   collection (rules sketch in `firebaseConfig.ts`).
2. **WebSocket relay** — `npm run server` (~100 lines, zero game logic) and
   point clients at it with `?server=wss://your-relay-host:8787`. Lowest
   latency when hosted near both players; also the LAN/dev fallback.

`?net=p2p` / `?net=ws` force a transport. Netcode in both cases: each client
is **authoritative for hits against itself** (dodge-fair under latency), the
host client owns match state and echoes it, poses stream at 20 Hz with
exponential smoothing, and all coordinates are mirrored across the arena
(`(x,y,z) → (-x, y, -z-3.4)`, 180° yaw) so both players stand at their own
world origin.

## Controls

| Input | Action |
| --- | --- |
| Hold trigger | Ball orbits that fist (spins up over ~1 s) |
| Release mid-punch | Throw — speed and direction follow your swing |
| Trigger (ball away) | Recall the ball to that fist |
| Recall through a body/target | Counts as a hit (once per recall) |
| Your orbit/recall path | Parries enemy balls on contact |
| Head past the rim | Rapid health drain — get back on the platform |

## Project shape

```
src/
  config.ts            every gameplay tunable, documented
  components/          ECS components (Fireball, Hitbox, TrainingTarget, …)
  systems/             FireballSystem (the state machine), Collision,
                       Boundary, Bot, Network, Training, GameState, Menu, FX…
  fx/fire.ts           the ported FlamethrowerXR fire: simplex-noise molten
                       core + additive corona shaders, GPU ember/trail pools
  avatar/boxer.ts      head + IK torso + floating gloves (no legs — on brand)
  net/                 protocol + relay client (frame-synced inbox)
  ui/scoreboard.ts     arena-style flanking health boards + back stats board
server/index.mjs       the relay
```

Lineage: forked gameplay skeleton from `yellkell/glasston` (Blaston-style
play space, IK body hitboxes, match flow) and the fire rendering from
`yellkell/flamethrowerxr`, rebuilt into one game.

## Iron Balls Club (pub social scene — `/pub.html`)

A separate 10–12 player social hangout that ships alongside the arena: an
English pub done in the same gritty diamond-plate / gunmetal / hazard-amber
language, with the SAME iron-boxer avatars (each punter gets their own accent
tint). Low steel ceiling with I-beams, a bar with taps, booths and stools,
and three things to actually do:

- **The Landlord** — UNIT-86, the robot barkeep, works the aisle behind the
  bar non-stop: wiping the counter, pulling pints at the taps, polishing
  glasses, and glancing at whoever's nearest. You can't interact with him —
  he's pure theatre — except that every ~25 s he trundles a FRESH GLASS out
  from the back and sets it on the bar, restocking the house up to 15. The
  restock is server-announced so the new pint lands at the same moment for
  everyone (and survives for late joiners).
- **Pints** — 8 glasses on the bar at opening, up to 15 once the Landlord
  has done his rounds. Grab, drink, stack them, or throw one
  across the room; everything is networked with single-owner simulation, so
  every punter sees the same glass in the same place — and a thrown glass
  (or dart) can be CAUGHT mid-air by anyone, transferring ownership.
- **Coins** — your bolt-dollar balance (earned in the arena) rides above your
  **left** wrist as the "$" symbol with the count over it — **private**, only
  you see your total. Bring your right hand to that wrist and **grab** (squeeze)
  to draw a coin out into it (held up at the fingertips); let go and it drops —
  landing flat on whatever's beneath it, a table, a bar stool or the bar top as
  readily as the floor. A loose coin is picked up like a pint or dart: touch it
  and grab, or **range-grab** one you aim at from up to a metre away. Carry a
  coin back to your left wrist and release to bank it. A loose coin glows warm
  when a hand can grab it, the way the pints and darts light up.
  A coin is a bearer token — pulling debits your wallet, banking credits
  whoever's holding it — and only the physical coins are networked (relayed
  events, no server state), so a balance never crosses the wire and the room
  still conserves coins on its own. See `src/pub/systems/CoinSystem.ts`.
- **House darts** — communal board (ported from the old vrstreet project and
  fixed: the meshes now carry fat invisible grab proxies so they are actually
  grabbable), regulation scoring off the board texture's UVs, score popups,
  and a server-owned leaderboard. The always-stocked dart crate glows amber
  when a hand is in reach to pull one.
- **Directional voice chat** — open-mic spatial voice for the whole room.
  Each punter's voice comes from where their iron skull stands (HRTF panner on
  their head, listener on your camera) and falls off with distance, so the bar
  has a natural hubbub. Opus frames (WebCodecs) ride the pub WebSocket as
  binary; the server fans them out and enforces the **match bubble** — while a
  bout is live the two fighters hear ONLY each other, not the crowd, until the
  match ends, while spectators still hear everyone (so a fight is fun to watch).
  Left **Y** mutes your mic; a punter's name tag swells while they're talking.
  See `src/pub/voice/` and `relayVoice`/`canHear` in `server/pub.mjs`.
- **IRON SNAKE** — an arcade cabinet in the corner. It's **coin-operated**:
  pull a coin off your wrist and hold it up to the cabinet's slot (the screen
  reads INSERT COIN and lights up) — release within reach to drop it in and
  start a game (one coin, one go; Enter on desktop). One player at a time, then
  steer with the cabinet's own joystick — put your hand on the red ball and
  push. Everyone sees the screen live, and the high score is persisted by the
  server in `server/pub-data.json`.
- **The jukebox** is coin-operated too: hold a coin to its slot and release to
  feed it — each coin advances the room's track (off → 1 → 2 → … → off). The
  marquee reads INSERT COIN until you pay.
- **Behind the bar** — you can now teleport into the barkeep's aisle behind the
  counter if you fancy pulling a pose at the taps.
- **The fight hall** — through the door in the west wall: the full FIRE
  FIGHT duel on display. Both arena platforms (ember vs blue corners), claim
  consoles (pull the trigger at one to take that platform — you're planted
  on it facing your opponent), and when both corners fill the server counts
  down and the bout runs on the arena's own fireball mechanics: orbit on
  trigger, punch to throw, trigger to recall, parries, victim-ruled hits,
  100 hp at 20 a hit. It's tuned to play 1:1 with QUICK MATCH — the same
  physics, your ball loadout (split / grow / shrink) carried in from the
  arena, and the ring-announcer 3-2-1 countdown, which the WHOLE pub hears
  when a match kicks off. Everyone in the social space can gather round the
  hazard line and watch (both fighters stream their fireballs — split fans
  and all — live) or wander back to the pub. The invisible cage is pulled in to FIVE yards from
  the platform rims (the arena uses ten) so the duel fits indoors. Leaving
  your platform mid-bout forfeits.

Movement is **teleport only**: deflect either thumbstick and a ballistic arc
curves from that controller to the floor, ending in an octagonal marker with
an arrow inside it. Move the controller to move the landing spot, roll the
thumbstick to spin the arrow — that's the way you'll be facing when you
arrive — and release to go. Landing is restricted to real floor (pub,
doorway, fight hall); the marker burns red anywhere else.

```
npm run dev          # open http://localhost:5173/pub.html
npm run server:pub   # the pub room server on :8788 (?server=wss://… to point elsewhere)
```

`?name=CALLSIGN` sets your name tag. The main game is untouched — the pub is
its own entry point (`src/pub/`), its own server, its own protocol
(`src/pub/protocol.ts`).
