/**
 * ARCADE campaign state — two things live here:
 *
 *  1. The LIVE bout bus: CampaignSystem writes it, FireballSystem reads the
 *     aim-assist point (a titan's sweet spot moves — head when the core is
 *     shuttered, the vented core when it's open — and it sits far higher than
 *     a human boxer's chest).
 *
 *  2. The persisted PROGRESS: which titans have been felled (stages unlock
 *     left to right), the gauntlet-run leaderboards (best fight-time clocks,
 *     gauntlet + hardcore), and whether hardcore has been earned. One
 *     localStorage blob ('ff-campaign'), separate from the lifetime stats.
 */

import { Vector3 } from 'three';
import { ARENA_GAP, CAMPAIGN } from '../config.js';
import type { PeerMessage } from '../net/protocol.js';

export const campaign = {
  /** World point player throws are aim-assisted toward during a titan bout. */
  aimPoint: new Vector3(0, 1.25, -ARENA_GAP),
  /** True while the titan's core is vented open (the punish window). */
  coreOpen: false,
};

/** RAID wire traffic (ratk / rdmg / rst), routed here by MeshSystem so
 *  CampaignSystem can drain it without owning the mesh plumbing. */
export const raidInbox: Array<{ seat: number; msg: PeerMessage }> = [];

/** Gauntlet-run clock formatting: m:ss.t — shared by the HUD and the boards. */
export function fmtRunTime(seconds: number): string {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  const ss = String(Math.floor(s % 60)).padStart(2, '0');
  const tenths = Math.floor((s * 10) % 10);
  return `${m}:${ss}.${tenths}`;
}

// --- persisted progress -------------------------------------------------------

export interface CampaignProgress {
  /** One flag per stage: true once that titan has been felled. */
  cleared: boolean[];
  /** Best GAUNTLET RUN times (seconds of fight time), ascending, capped. */
  runTimesGauntlet: number[];
  /** Best HARDCORE run times — no healing between titans. */
  runTimesHardcore: number[];
  /** Set by finishing your first gauntlet run: hardcore opens. */
  hardcoreUnlocked: boolean;
  /** True once a RAID has been fully beaten (GOLIATH's second life included). */
  raidCleared: boolean;
}

const KEY = 'ff-campaign';

function fresh(): CampaignProgress {
  return {
    cleared: new Array(CAMPAIGN.stages).fill(false),
    runTimesGauntlet: [],
    runTimesHardcore: [],
    hardcoreUnlocked: false,
    raidCleared: false,
  };
}

function load(): CampaignProgress {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const p = { ...fresh(), ...JSON.parse(raw) } as CampaignProgress;
      // Older saves (or a future stage-count bump) may carry a short array.
      while (p.cleared.length < CAMPAIGN.stages) p.cleared.push(false);
      return p;
    }
  } catch {
    /* fresh gauntlet */
  }
  return fresh();
}

export const campaignProgress: CampaignProgress = load();

export function saveCampaignProgress(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(campaignProgress));
  } catch {
    /* storage unavailable — progress stays in-memory */
  }
}

/** An arcade stage is open once every stage before it has been cleared. */
export function stageUnlocked(stage: number): boolean {
  if (stage <= 0) return true;
  return campaignProgress.cleared[stage - 1] === true;
}

/** The gauntlet run opens once every titan has been felled at least once. */
export function gauntletUnlocked(): boolean {
  return campaignProgress.cleared.every((c) => c === true);
}

/**
 * Bank a finished run's clock on its board (ascending, top-N kept). Returns
 * true when it's the new best.
 */
export function recordRunTime(hardcore: boolean, seconds: number): boolean {
  const board = hardcore ? campaignProgress.runTimesHardcore : campaignProgress.runTimesGauntlet;
  board.push(seconds);
  board.sort((a, b) => a - b);
  board.splice(CAMPAIGN.leaderboardSize);
  saveCampaignProgress();
  return board[0] === seconds;
}
