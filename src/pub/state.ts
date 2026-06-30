/**
 * Shared mutable pub state + a tiny typed event bus. Systems import this
 * instead of threading everything through ECS component data — same pattern
 * the rest of the codebase uses for app-level state.
 */

import type { Group, Mesh, MeshStandardMaterial, Object3D } from 'three';
import type { BoxerRig } from '../avatar/boxer.js';
import type { BoardRow, FightNet, PoseTuple, PropNet, PubEvent, SnakeHi } from './protocol.js';
import type { Panel } from './panel.js';

export interface RemotePunter {
  id: string;
  name: string;
  accent: number;
  /** Their main-game skin picks (empty = default look). */
  av: string;
  pf: string;
  rig: BoxerRig;
  nameTag: Panel;
  /** Latest network pose; rigs ease toward these each frame. */
  head: PoseTuple;
  left: PoseTuple;
  right: PoseTuple;
}

/** Scene references built by environment.ts, consumed by the systems. */
export interface PubRefs {
  root: Group;
  dartboard: Mesh;
  corkSurround: Mesh;
  /** Extra dart-stick targets (walls/cabinet) so strays embed somewhere. */
  dartCatchers: Object3D[];
  dartRackSlots: [number, number, number][];
  /** World-space dispenser volume: grip inside this box to pull a house dart. */
  dartBox: { center: [number, number, number]; half: [number, number, number] };
  /** The crate-wall material — its emissive lifts to glow the box when a hand
   *  can pull a dart (set by PropSystem). */
  dartBoxMat: MeshStandardMaterial;
  glassSlots: [number, number, number][];
  dartsBoardPanel: Panel;
  /** The red RESET push-button beneath the leaderboard — wipes the chalkboard.
   *  Its cap material brightens on the aim cone. */
  dartsResetButton: Mesh;
  arcadeScreen: Mesh;
  arcadePos: [number, number, number];
  /** The cabinet root + its joystick stick (pivot at the deck). */
  arcadeCabinet: Group;
  snakeStick: Group;
  /** Fight hall: each platform's glowing rim — re-skinned per claimant. */
  fightRims: [Mesh, Mesh];
  /** Fight hall: each platform's slab — its underglow follows the claimant's
   *  chosen platform skin (alongside the rim). */
  fightSlabs: [Mesh, Mesh];
  /** Fight hall: claim console panels (side 0, side 1) + the big display. */
  consolePanels: [Panel, Panel];
  fightDisplay: Panel;
  /** Mirror scoreboard above the door — same health, other side of the pit. */
  fightDisplay2: Panel;
  /** The jukebox cabinet root (its origin = world position) + its marquee. */
  jukebox: Group;
  jukeboxPanel: Panel;
  /** The fight-hall disco ball — spun by MusicSystem. */
  discoball: Group;
}

interface Events {
  connected: undefined;
  disconnected: undefined;
  /** The room turned us away — it's already at 12/12. */
  full: undefined;
  joined: RemotePunter;
  left: string;
  board: BoardRow[];
  propGrabbed: { id: number; holder: string };
  propReleased: { id: number; holder: string };
  propMoved: { id: number; pos: [number, number, number]; quat: [number, number, number, number] };
  propSettled: { id: number; pos: [number, number, number]; quat: [number, number, number, number] };
  snakePlayer: string | null;
  snakeHi: SnakeHi;
  gameEvent: { from: string; ev: PubEvent };
  /** Local dart stuck in the board — DartsSystem scores it. */
  dartScored: { segment: string; score: number };
  /** Fight lifecycle/hp pushed from the server. */
  fight: FightNet;
  /** The barkeep is fetching glass `id` — it lands on the bar shortly. */
  glassOut: number;
  /** The room's selected jukebox station (−1 = off), server-synced. */
  music: number;
  /** An admin removed us from the room. */
  banned: undefined;
  /** Reply to an admin action we issued (ban succeeded / was refused). */
  adminResult: { ok: boolean; msg: string };
  /** A coin was fed into a machine ('snake' / 'jukebox') — it pays for a go. */
  coinInserted: string;
  /** A coin was THROWN into the fight pit and settled on side 0/1's half —
   *  the thrower's stake on that corner's fighter (arena-throw betting). */
  betThrow: 0 | 1;
}

type Handler<T> = (payload: T) => void;

class Bus {
  private handlers = new Map<keyof Events, Set<Handler<never>>>();

  on<K extends keyof Events>(event: K, fn: Handler<Events[K]>): () => void {
    let set = this.handlers.get(event);
    if (!set) this.handlers.set(event, (set = new Set()));
    set.add(fn as Handler<never>);
    return () => void this.handlers.get(event)?.delete(fn as Handler<never>);
  }

  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    this.handlers.get(event)?.forEach((fn) => (fn as Handler<Events[K]>)(payload));
  }
}

export const bus = new Bus();

/** A fresh, fully-formed fight card — every field present, arrays the right
 *  length. The single source of truth for what a FightNet must look like. */
export function defaultFight(): FightNet {
  return {
    phase: 'idle',
    sides: [null, null],
    hp: [100, 100],
    score: [0, 0],
    round: 1,
    roundTimer: 0,
    winner: null,
  };
}

/**
 * Coerce whatever the room server sent into a complete FightNet, filling any
 * missing field from {@link defaultFight}. The client and the room server
 * deploy from separate pipelines, so a server even one version behind can omit
 * newer fields (hp/score/round/roundTimer). Without this, the match HUD would
 * read `f.hp[side]` on `undefined` the instant a player takes the match pad and
 * throw every frame — killing the WebXR render loop (a whole-game freeze).
 */
export function normalizeFight(f: Partial<FightNet> | null | undefined): FightNet {
  const d = defaultFight();
  if (!f) return d;
  const pair = <T>(v: unknown, fallback: [T, T]): [T, T] =>
    Array.isArray(v) && v.length >= 2 ? [v[0] as T, v[1] as T] : fallback;
  return {
    phase: f.phase ?? d.phase,
    sides: pair(f.sides, d.sides),
    hp: pair(f.hp, d.hp),
    score: pair(f.score, d.score),
    round: typeof f.round === 'number' ? f.round : d.round,
    roundTimer: typeof f.roundTimer === 'number' ? f.roundTimer : d.roundTimer,
    winner: f.winner ?? null,
  };
}

export const pub = {
  myId: '',
  myName: '',
  myAccent: 0xff7a18,
  online: false,
  punters: new Map<string, RemotePunter>(),
  /** Server view of every shared prop, kept current from the wire. */
  props: new Map<number, PropNet>(),
  board: [] as BoardRow[],
  snakeHi: { name: '—', score: 0 } as SnakeHi,
  snakePlayer: null as string | null,
  fight: defaultFight(),
  /** Selected jukebox station, −1 = off (server-synced; whole room shares it). */
  music: -1,
  /** A coin-operated machine the local player is currently holding a coin up
   *  to ('snake' / 'jukebox' / null) — the machine lights its INSERT COIN cue. */
  coinHover: null as string | null,
  refs: null as PubRefs | null,
};
