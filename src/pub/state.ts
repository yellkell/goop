/**
 * Shared mutable pub state + a tiny typed event bus. Systems import this
 * instead of threading everything through ECS component data — same pattern
 * the rest of the codebase uses for app-level state.
 */

import type { Group, Mesh, Object3D } from 'three';
import type { BoxerRig } from '../avatar/boxer.js';
import type { BoardRow, FightNet, PoseTuple, PropNet, PubEvent, SnakeHi } from './protocol.js';
import type { Panel } from './panel.js';

export interface RemotePunter {
  id: string;
  name: string;
  accent: number;
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
  glassSlots: [number, number, number][];
  dartsBoardPanel: Panel;
  arcadeScreen: Mesh;
  arcadePos: [number, number, number];
  hiScorePanel: Panel;
  /** The cabinet root + its joystick stick (pivot at the deck). */
  arcadeCabinet: Group;
  snakeStick: Group;
  /** Fight hall: claim console panels (side 0, side 1) + the big display. */
  consolePanels: [Panel, Panel];
  fightDisplay: Panel;
}

interface Events {
  connected: undefined;
  disconnected: undefined;
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
  fight: { phase: 'idle', sides: [null, null], hp: [100, 100], winner: null } as FightNet,
  refs: null as PubRefs | null,
};
