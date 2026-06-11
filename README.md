# FIRE FIGHT 🔥🥊

Bare-knuckle boxing at a distance, in WebXR passthrough. Two flaming iron
balls orbit your fists — **hold the trigger** and a ball roars in orbit around
your hand, **whip a punch and release** to hurl it at your opponent, **pull
the trigger again** to call it blazing back to your palm. Your orbiting ball
is also your shield: it parries incoming fire out of the air.

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
