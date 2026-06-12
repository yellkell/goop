/**
 * Wire protocol for a bout. Everything is small JSON over a WebSocket relay
 * (see /server). The relay pairs two players and forwards `{t:'msg'}`
 * payloads verbatim, so both clients speak this peer-to-peer dialect.
 *
 * Coordinates are always sent in the SENDER's world space (their rig at the
 * origin, -z toward their opponent). The receiver mirrors them across the
 * arena: (x,y,z) → (-x, y, -z - ARENA_GAP), quaternions pre-multiplied by a
 * 180° yaw — see `mirror` in net/client.ts.
 */

/** [x, y, z, qx, qy, qz, qw] */
export type PoseTuple = [number, number, number, number, number, number, number];

export type PeerMessage =
  /** ~20 Hz body pose: head, left hand, right hand, trigger-orbit flags, hp. */
  | { k: 'pose'; head: PoseTuple; left: PoseTuple; right: PoseTuple; orbit: [boolean, boolean]; hp: number }
  /** I punched my `hand` ball: it left from `pos` with velocity `vel`. */
  | { k: 'throw'; hand: 0 | 1; pos: [number, number, number]; vel: [number, number, number] }
  /** I recalled my `hand` ball. */
  | { k: 'recall'; hand: 0 | 1 }
  /**
   * Your `hand` ball HIT me (victim-authoritative) for `dmg`. `ret` means it
   * connected mid-RETURN (you recalled it through me) — the ball is not
   * spent and keeps homing back to your fist.
   */
  | { k: 'hit'; hand: 0 | 1; dmg: number; ret?: boolean }
  /** I parried your `hand` ball out of the air. */
  | { k: 'deflect'; hand: 0 | 1 }
  /**
   * Our flying balls BLOCKED each other mid-air on my sim: my `mine` ball
   * and your `yours` ball are both spent. (Ball hand indices are always the
   * sender's own — same convention as `throw`.)
   */
  | { k: 'clash'; mine: 0 | 1; yours: 0 | 1 }
  /** I want a rematch (sent from the FIGHT OVER panel; both sides → restart). */
  | { k: 'rematch' }
  /** Who I am, once per bout: leaderboard callsign + hidden ELO (so the
   *  winner can weight their score gain by rival quality) + my skin picks
   *  so you see me dressed the way I chose. */
  | { k: 'iam'; name: string; elo: number; av?: string; pf?: string }
  /** Host → guest match-state echo. Scores are in the HOST's perspective. */
  | {
      k: 'state';
      phase: 'playing' | 'roundOver' | 'matchOver';
      round: number;
      hostScore: number;
      guestScore: number;
      timer: number;
      msg: string;
      reset: number;
    };

/** Client → relay server envelope. */
export type ClientEnvelope =
  | { t: 'queue' }
  | { t: 'cancel' }
  | { t: 'msg'; d: PeerMessage };

/** Relay server → client envelope. */
export type ServerEnvelope =
  | { t: 'waiting' }
  | { t: 'matched'; side: 0 | 1 }
  | { t: 'peer-left' }
  | { t: 'msg'; d: PeerMessage };
