/**
 * Wire protocol for IRON BALLS PUB — the pub social scene. JSON over a
 * WebSocket to server/pub.mjs: one shared room, up to 12 punters.
 *
 * Unlike the 1v1 bout relay, the pub server holds real state:
 *   - who is in the room and their latest pose (snapshotted to everyone at 20 Hz);
 *   - who OWNS each shared prop (pint glasses, darts) — the owner's client
 *     simulates it and streams its transform, everyone else interpolates;
 *   - the darts leaderboard (session) and the snake high score (persisted).
 *
 * All coordinates are plain pub world space — everyone stands in the same
 * room, so no mirroring (unlike the arena protocol).
 */

/** [x, y, z, qx, qy, qz, qw] */
export type PoseTuple = [number, number, number, number, number, number, number];
export type Vec3T = [number, number, number];
export type QuatT = [number, number, number, number];

export type PropKind = 'glass' | 'dart';

/**
 * A shared prop as the server sees it. `pos`/`quat` are the last known
 * transform (`null` until someone first moves it — clients then place the
 * prop at its built-in home slot, so the layout never has to live on the
 * server).
 */
export interface PropNet {
  id: number;
  kind: PropKind;
  /** Player simulating it (held in hand OR mid-flight after a throw). */
  holder: string | null;
  mode: 'rest' | 'held' | 'flight';
  pos: Vec3T | null;
  quat: QuatT | null;
  /**
   * Glasses only: false until the barkeep has brought this one out from the
   * back (the pub opens with 8 on the bar and he restocks up to 15).
   */
  active: boolean;
}

export interface PubPlayerNet {
  id: string;
  name: string;
  /** Accent colour (0xRRGGBB) assigned by join order — tints the boxer rig. */
  accent: number;
  head: PoseTuple;
  left: PoseTuple;
  right: PoseTuple;
  /** Main-game cosmetics carried into the pub (skin ids + custom armour hue). */
  av?: string;
  pf?: string;
  /** Custom armour hue (0..1), or -1/absent for the skin's default palette. */
  avc?: number;
}

export interface BoardRow {
  id: string;
  name: string;
  accent: number;
  score: number;
  darts: number;
}

export interface SnakeHi {
  name: string;
  score: number;
}

/** Fight-hall match lifecycle (server-driven). */
export type FightPhase = 'idle' | 'starting' | 'fighting' | 'roundOver' | 'over';

export interface FightNet {
  phase: FightPhase;
  /** Player ids holding side 0 (south platform) and side 1 (north). */
  sides: [string | null, string | null];
  hp: [number, number];
  /** Round wins so far this match — first to FIGHT.winTarget takes it. */
  score: [number, number];
  /** Current round number (1-based). */
  round: number;
  /** Seconds left in the live round (drives the match-UI clock). */
  roundTimer: number;
  /**
   * During `roundOver` this is the ROUND winner; during `over` it's the MATCH
   * winner. Null otherwise.
   */
  winner: string | null;
}

/**
 * A fighter's fireball on the wire: position (x,y,z) + state index
 * (0 hover, 1 orbit, 2 flying, 3 returning, 4 dead) + the ball-loadout SIZE
 * scale and DAMAGE scale (1 = a plain ball; a recalled grow/shrink ball carries
 * `scl`≠1 so the foe sees it the right size and takes the right damage).
 */
export type FireballNet = [number, number, number, number, number, number];

/** Fan-out game events (relayed verbatim; some also mutate server state). */
export type PubEvent =
  | { e: 'DART_HIT'; segment: string; score: number }
  | { e: 'DARTS_RESET' }
  /** Fighter streaming both fireballs (~20 Hz) so the crowd sees the duel. The
   *  optional `shards` carry a SPLIT recall's extra returning balls (positions
   *  only; size + damage are the fixed ATTACH.split constants) so the foe sees
   *  the three-ball fan and can take recall-through hits off each. */
  | { e: 'FIGHT_FB'; balls: [FireballNet, FireballNet]; shards?: Vec3T[] }
  /**
   * Victim-authoritative: YOUR ball `ball` hit me — it's spent. `ret` marks a
   * RETURN-PASS connect (a recalled ball caught me on its way home): it keeps
   * homing instead of dying, exactly like the arena's recall-through technique.
   */
  | { e: 'FIGHT_HIT'; ball: 0 | 1; dmg?: number; ret?: boolean }
  /** I parried your ball `ball` out of the air. */
  | { e: 'FIGHT_DEFLECT'; ball: 0 | 1 }
  /** Your ball `ball` clashed mid-air with one of mine — both are spent. */
  | { e: 'FIGHT_CLASH'; ball: 0 | 1 }
  /** Fighter reporting their own hp after taking a hit. */
  | { e: 'FIGHT_HP'; hp: number }
  /** A fighter touched gloves with their opponent — pop GG for the whole room
   *  at `pos` (one side detecting is enough for everyone to see it). */
  | { e: 'FIGHT_GG'; pos: Vec3T }
  /** Streamed by the player at the arcade machine so spectators see the screen. */
  | {
      e: 'SNAKE_STATE';
      cells: [number, number][];
      food: [number, number];
      score: number;
      dead: boolean;
    }
  | { e: 'SNAKE_OVER'; score: number }
  /* --- Coin trading (the bolt-dollar currency on your wrist) ---------------
   * Pure relayed events — the pub server forwards anything it doesn't
   * recognise verbatim (handleEvent's default case), so coins need NO server
   * state. A coin is a bearer token: debited from your wallet when you pull it
   * off your wrist, credited to whoever banks it at theirs. Balances are
   * PRIVATE — only the physical coins are networked, never anyone's total. */
  /** I dropped coin `id` into the room at `pos` with velocity `vel`; I now
   *  simulate its fall and stream COIN_MOVE / COIN_REST until it lands. */
  | { e: 'COIN_DROP'; id: string; pos: Vec3T; vel: Vec3T }
  /** The coin I own is here (streamed while it falls). */
  | { e: 'COIN_MOVE'; id: string; pos: Vec3T }
  /** The coin I own has come to rest here — anyone may pick it up. */
  | { e: 'COIN_REST'; id: string; pos: Vec3T }
  /** I picked coin `id` up off the floor — everyone else drop it from view. */
  | { e: 'COIN_TAKE'; id: string };

export type PubClientMsg =
  | { t: 'hello'; name: string; av?: string; pf?: string; avc?: number; cid?: string }
  | { t: 'pose'; head: PoseTuple; left: PoseTuple; right: PoseTuple }
  /** I want to hold prop `id` (fresh grab or a mid-air catch). */
  | { t: 'grab'; id: number }
  /** I let go of prop `id` — it is now in flight, still mine to simulate. */
  | { t: 'release'; id: number }
  /** Owner streaming a held/flying prop's transform (~20 Hz). */
  | { t: 'prop'; id: number; pos: Vec3T; quat: QuatT }
  /** My prop came to rest here — anyone may pick it up now. */
  | { t: 'settle'; id: number; pos: Vec3T; quat: QuatT }
  | { t: 'claim-snake' }
  | { t: 'leave-snake' }
  /** Take a corner in the fight hall (side 0 south, 1 north). */
  | { t: 'claim-fight'; side: 0 | 1 }
  /** Step down / forfeit. */
  | { t: 'leave-fight' }
  /** Flip the jukebox to `station` (−1 = off) for the whole room. */
  | { t: 'music'; station: number }
  /** Admin: remove punter `id` and block their rejoin. Needs the admin key. */
  | { t: 'admin-ban'; token: string; id: string }
  | { t: 'ev'; ev: PubEvent };

export type PubServerMsg =
  | {
      t: 'welcome';
      id: string;
      accent: number;
      players: PubPlayerNet[];
      props: PropNet[];
      board: BoardRow[];
      snakeHi: SnakeHi;
      snakePlayer: string | null;
      fight: FightNet;
      /** Jukebox station the room is currently on (−1 = off). */
      music: number;
    }
  | { t: 'full' }
  | { t: 'join'; player: PubPlayerNet }
  | { t: 'leave'; id: string }
  /** 20 Hz pose snapshot for every player except the recipient. */
  | { t: 'snap'; poses: [string, PoseTuple, PoseTuple, PoseTuple][] }
  /**
   * Prop `id` is now held by `holder`. Sent to everyone on a granted grab —
   * if you asked and the holder isn't you, your grab lost the race: yield.
   */
  | { t: 'grabbed'; id: number; holder: string }
  | { t: 'released'; id: number; holder: string }
  | { t: 'prop'; id: number; pos: Vec3T; quat: QuatT }
  | { t: 'settled'; id: number; pos: Vec3T; quat: QuatT }
  | { t: 'board'; rows: BoardRow[] }
  | { t: 'snake-player'; id: string | null }
  | { t: 'snake-hi'; hi: SnakeHi }
  /** Full fight state — sent on every lifecycle change and hp update. */
  | { t: 'fight'; fight: FightNet }
  /** The barkeep is bringing glass `id` out — it lands on the bar shortly. */
  | { t: 'glass-out'; id: number }
  /** The room's jukebox is now on `station` (−1 = off). */
  | { t: 'music'; station: number }
  /** You've been removed by an admin (sent just before the socket closes). */
  | { t: 'banned' }
  /** Result of an admin action, sent back to the admin who asked. */
  | { t: 'admin-result'; ok: boolean; msg: string }
  | { t: 'ev'; from: string; ev: PubEvent };

export const PUB_MAX_PLAYERS = 12;
export const PUB_TICK_MS = 50; // 20 Hz pose snapshots

/**
 * VOICE CHAT rides this same socket as BINARY frames (everything above is
 * JSON text). Spatial voice — plain Int16 PCM, NOT Opus/WebCodecs, which was
 * unreliable on the headset browsers — fanned out by the server to the WHOLE
 * room: fighters and crowd alike always hear everyone (the open pub never goes
 * quiet, even mid-bout). Spatial falloff in the client keeps distance readable.
 *
 *   client → server :  [8-byte LE float64 sample rate][Int16 LE mono PCM]
 *   server → client :  [1-byte id length][ascii sender id]<the above>
 *
 * See src/pub/voice/ (capture + spatial playback) and relayVoice in
 * server/pub.mjs.
 */
export const PUB_VOICE_SAMPLE_RATE = 48000;
