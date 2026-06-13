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
  /** Main-game cosmetics carried into the pub (skin ids). */
  av?: string;
  pf?: string;
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
export type FightPhase = 'idle' | 'starting' | 'fighting' | 'over';

export interface FightNet {
  phase: FightPhase;
  /** Player ids holding side 0 (south platform) and side 1 (north). */
  sides: [string | null, string | null];
  hp: [number, number];
  winner: string | null;
}

/**
 * A fighter's fireball on the wire: position + state index
 * (0 hover, 1 orbit, 2 flying, 3 returning, 4 dead).
 */
export type FireballNet = [number, number, number, number];

/** Fan-out game events (relayed verbatim; some also mutate server state). */
export type PubEvent =
  | { e: 'DART_HIT'; segment: string; score: number }
  | { e: 'DARTS_RESET' }
  /** Fighter streaming both fireballs (~20 Hz) so the crowd sees the duel. */
  | { e: 'FIGHT_FB'; balls: [FireballNet, FireballNet] }
  /**
   * Victim-authoritative: YOUR ball `ball` hit me — it's spent. `ret` marks a
   * RETURN-PASS connect (a recalled ball caught me on its way home): it keeps
   * homing instead of dying, exactly like the arena's recall-through technique.
   */
  | { e: 'FIGHT_HIT'; ball: 0 | 1; ret?: boolean }
  /** I parried your ball `ball` out of the air. */
  | { e: 'FIGHT_DEFLECT'; ball: 0 | 1 }
  /** Your ball `ball` clashed mid-air with one of mine — both are spent. */
  | { e: 'FIGHT_CLASH'; ball: 0 | 1 }
  /** Fighter reporting their own hp after taking a hit. */
  | { e: 'FIGHT_HP'; hp: number }
  /** Streamed by the player at the arcade machine so spectators see the screen. */
  | {
      e: 'SNAKE_STATE';
      cells: [number, number][];
      food: [number, number];
      score: number;
      dead: boolean;
    }
  | { e: 'SNAKE_OVER'; score: number };

export type PubClientMsg =
  | { t: 'hello'; name: string; av?: string; pf?: string }
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
  | { t: 'ev'; from: string; ev: PubEvent };

export const PUB_MAX_PLAYERS = 12;
export const PUB_TICK_MS = 50; // 20 Hz pose snapshots

/**
 * VOICE CHAT rides this same socket as BINARY frames (everything above is
 * JSON text). Spatial Opus voice, fanned out by the server with the match
 * bubble applied — while a bout is live each fighter hears only their
 * opponent, never the bar; spectators hear everyone.
 *
 *   client → server :  [8-byte LE float64 timestamp µs][opus frame]
 *   server → client :  [1-byte id length][ascii sender id]<the above>
 *
 * See src/pub/voice/ (capture + spatial playback) and relayVoice/canHear in
 * server/pub.mjs.
 */
export const PUB_VOICE_SAMPLE_RATE = 48000;
