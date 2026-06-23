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

- **AIM TRAINING** — the heart of the game. Bullseye discs and humanoid
  cutouts pop up across the gap; land your fire while they're up. Streaks
  multiply your score and the cadence ramps. Flip **targets shoot back** on
  and the cutouts return blue fire so you train dodging between throws.
- **VS BOT** — spar an iron boxer that strafes, ducks, reactively dodges your
  throws and hurls fire back on a cadence.
- **1V1 QUICK MATCH** — competitive online duels through the bundled relay
  server. Best of 5 rounds, 60 s each, knockout or higher health at the bell.
  P2P matches carry **directional voice chat**: your rival's mic is
  spatialised onto their avatar's head (HRTF), so their trash talk pans and
  ducks with them. Mic permission is asked when you queue; declining still
  lets you hear them.

## Coins & the platform shop

Every bout, brawl and training run banks **coins** (the riveted bolt-dollar
"$") alongside your XP — a flat amount per completed game. Your balance shows
beside the newspaper button in the lobby. Spend it in the **platform shop**
(open it from CUSTOMISE): the three launch pads are free, two recolours
(TOXIC, PLASMA) cost the equivalent of ten games, and the premium **GOLD
RUSH** pad — gold piping and a gold-tinted slab — costs a hundred. The wallet
is shared with the pub (same browser), where coins become physical.

## The rules of the platform

You see your platform beneath you — and its **rim barrier**. Guardian-style
walls glow awake as your head nears the edge; lean your head out past the rim
and the arena's fire drains your health *fast*. Dodge with your body, but stay
on your platform.

Match UI is arena-style: angled neon scoreboards flank the gap (your board
orange, theirs blue) with big health bars, round pips and the timer, plus a
stats board hung behind you that you can glance back at mid-bout.

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

## Iron Balls Pub (pub social scene — `/pub.html`)

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
  own wrists as the "$" symbol with the count over it — **private**, only you
  see your total. Touch a wrist with your other hand and pull the trigger to
  draw a coin out into that hand; let go and it drops to the floor, where
  anyone can pick it up. Carry a coin to your other wrist and release to bank
  it. A coin is a bearer token — pulling debits your wallet, banking credits
  whoever's holding it — and only the physical coins are networked (relayed
  events, no server state), so a balance never crosses the wire and the room
  still conserves coins on its own. See `src/pub/systems/CoinSystem.ts`.
- **House darts** — communal board (ported from the old vrstreet project and
  fixed: the meshes now carry fat invisible grab proxies so they are actually
  grabbable), regulation scoring off the board texture's UVs, score popups,
  and a server-owned leaderboard.
- **Directional voice chat** — open-mic spatial voice for the whole room.
  Each punter's voice comes from where their iron skull stands (HRTF panner on
  their head, listener on your camera) and falls off with distance, so the bar
  has a natural hubbub. Opus frames (WebCodecs) ride the pub WebSocket as
  binary; the server fans them out and enforces the **match bubble** — while a
  bout is live the two fighters hear ONLY each other, not the crowd, until the
  match ends, while spectators still hear everyone (so a fight is fun to watch).
  Left **Y** mutes your mic; a punter's name tag swells while they're talking.
  See `src/pub/voice/` and `relayVoice`/`canHear` in `server/pub.mjs`.
- **IRON SNAKE** — an arcade cabinet in the corner. One player at a time
  (trigger to claim, then steer with the cabinet's own joystick — put your
  hand on the red ball and push; arrows/Enter on desktop), everyone sees the
  screen live, and the high score is persisted by the server in
  `server/pub-data.json`.
- **The fight hall** — through the door in the west wall: the full FIRE
  FIGHT duel on display. Both arena platforms (ember vs blue corners), claim
  consoles (pull the trigger at one to take that platform — you're planted
  on it facing your opponent), and when both corners fill the server counts
  down and the bout runs on the arena's own fireball mechanics: orbit on
  trigger, punch to throw, trigger to recall, parries, victim-ruled hits,
  100 hp at 20 a hit. Everyone in the social space can gather round the
  hazard line and watch (both fighters stream their fireballs live) or
  wander back to the pub. The invisible cage is pulled in to FIVE yards from
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
