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
  /**
   * ~20 Hz body pose: head, left hand, right hand, trigger-orbit flags, hp.
   * Optional `fist` drives fist-bump tells; optional `acc`/`acl` sync the
   * avatar neon hue + lightness.
   */
  | {
      k: 'pose';
      head: PoseTuple;
      left: PoseTuple;
      right: PoseTuple;
      orbit: [boolean, boolean];
      fist?: [boolean, boolean];
      hp: number;
      acc?: number;
      acl?: number;
    }
  /** I punched my `hand` ball: it left from `pos` with velocity `vel`. */
  | { k: 'throw'; hand: 0 | 1; pos: [number, number, number]; vel: [number, number, number]; curl?: [number, number, number] }
  /**
   * I recalled my `hand` ball. If it carried an attachment that fired (a live
   * recall, not a dead ball), `att` is the effect (ATTACH.*), `dmg` the
   * resulting per-ball damage and `scl` the size multiplier — sent so your
   * copy of my ball splits/scales and deals the same damage you'd take.
   */
  | { k: 'recall'; hand: 0 | 1; att?: number; dmg?: number; scl?: number }
  /**
   * Your `hand` ball HIT me (victim-authoritative) for `dmg`. `ret` means it
   * connected mid-RETURN (you recalled it through me) — the ball is not
   * spent and keeps homing back to your fist. `by` (arcade mesh only) is the
   * attacker's canonical seat, so in a brawl only that attacker acts on it.
   */
  | { k: 'hit'; hand: 0 | 1; dmg: number; ret?: boolean; by?: number }
  /**
   * Arcade mesh only — the HOST's authoritative match-state echo. `scores` is
   * indexed by CANONICAL team; `win` is the canonical team that just took the
   * round/match (-1 = none yet) so each guest can localise its own verdict.
   */
  | {
      k: 'astate';
      phase: 'countdown' | 'playing' | 'roundOver' | 'matchOver';
      round: number;
      scores: number[];
      win: number;
      timer: number;
      reset: number;
    }
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
  /**
   * I threw you a GG. `bump` marks a glove-touch fist bump (mirror it so we
   * BOTH see the GG — detection is one-sided too often to rely on each client
   * catching the same contact); without it, it's the B-button salute. Either
   * way, pop it over my avatar's head.
   */
  | { k: 'gg'; bump?: boolean }
  /** Who I am, once per bout: leaderboard callsign + hidden ELO (so the
   *  winner can weight their score gain by rival quality) + my skin picks
   *  so you see me dressed the way I chose. */
  | { k: 'iam'; name: string; elo: number; av?: string; pf?: string; avc?: number; avl?: number }
  /** Host → guest match-state echo. Scores are in the HOST's perspective. */
  | {
      k: 'state';
      phase: 'countdown' | 'playing' | 'roundOver' | 'matchOver';
      round: number;
      hostScore: number;
      guestScore: number;
      timer: number;
      msg: string;
      reset: number;
    }
  /**
   * RAID (host → all): the titan starts an attack. `seat` is the TARGET's
   * canonical seat; coordinates are in the TARGET's local frame (their
   * platform at their origin), so every client can transform + render the
   * telegraph on the right platform while only the target judges damage.
   * 'decree' is GOLIATH's group attack: novas on EVERY platform, `a` being
   * the shared CANONICAL safe bearing.
   */
  | {
      k: 'ratk';
      kind: 'slam' | 'sweep' | 'beam' | 'volley' | 'nova' | 'decree';
      seat: number;
      x?: number;
      z?: number;
      y?: number;
      a?: number;
    }
  /** RAID (client → host): my ball landed on the titan's weak point `spot`
   *  for `pts` damage. The host validates the spot is LIVE and applies it. */
  | { k: 'rdmg'; spot: string; pts: number }
  /**
   * RAID (host → all, ~3 Hz + on change): the authoritative boss state.
   * `ph`: 0 idle · 1 intro · 2 fight · 3 stage-felled · 4 wipe · 5 resurrect.
   * `t` is the host's clock within the phase (guests sync their sequences),
   * `cyc`/`hits` the weak-point pattern cursor, `p2` GOLIATH's second life.
   */
  | {
      k: 'rst';
      ph: number;
      t: number;
      stage: number;
      hp: number;
      max: number;
      cyc: number;
      hits: number;
      enr: 0 | 1;
      p2: 0 | 1;
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
