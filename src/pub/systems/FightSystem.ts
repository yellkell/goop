/**
 * FIRE FIGHT in the fight hall — the main game's duel, on display for the
 * whole pub. This is meant to be 1:1 with a QUICK MATCH in the real arena
 * (same physics, effects, colours and chosen cosmetics), just running over the
 * pub's room server instead of the 1v1 bout relay — and in pure VR, no
 * passthrough.
 *
 * Flow: pull the trigger at a corner console to claim that platform (you're
 * teleported onto it). When both corners are claimed the server counts down
 * and the fight is ON — everyone else in the social space can gather round
 * the hazard line and watch, or wander back to the pub.
 *
 * The fireball mechanics are the arena's (src/systems/FireballSystem.ts +
 * CollisionSystem.ts), ported onto pub networking:
 *  - hold trigger/grip → the ball ORBITS your fist, spinning up;
 *  - release mid-punch → it FLIES along your swing (aim-assisted toward the
 *    other fighter), arcs under light gravity, dies on the cage — which in
 *    here is pulled in to FIVE yards from the platform rims so the duel
 *    fits indoors;
 *  - trigger while it's away → it RETURNS to your fist (and can connect on the
 *    way home — the recall-through technique — without being spent).
 *
 * Hits are victim-authoritative (you rule on balls hitting YOUR head/torso —
 * three IK spheres solved exactly like the arena's body — same as the arena's
 * net protocol); each fighter streams their two balls at 20 Hz so spectators
 * see the whole exchange. First to 0 hp loses; leaving your platform forfeits.
 *
 * Colours follow the arena, NOT the corner: from a fighter's own eyes their
 * fire always burns orange and their opponent's blue (pure client-side); only
 * spectators see the fixed ember-vs-blue corner tints.
 */

import { createSystem, InputComponent } from '@iwsdk/core';
import {
  AdditiveBlending,
  CanvasTexture,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  RepeatWrapping,
  Vector3,
} from 'three';
import type { XROrigin } from '@iwsdk/xr-input';
import { ATTACH, BODY_IK, BOUNDARY, FIREBALL, NET, OCTAGON_VERTICES, PALETTE, teamColor } from '../../config.js';
import { buildBoxer, solveTorso, type BoxerRig } from '../../avatar/boxer.js';
import { applyAvatarSkin, platformSkin } from '../../avatar/skins.js';
import { customization, myAvatarSkin } from '../../menu/customization.js';
import {
  createFireVisual,
  emberBurst,
  spawnEmber,
  stampTrail,
  updateFirePools,
  type FireVisual,
} from '../../fx/fire.js';
import { spawnDamagePopup, spawnFireImpact, spawnGestureCue, spawnPopup } from '../../fx/effects.js';
import * as sfx from '../../audio/sfx.js';
import { announce, preloadAnnouncer } from '../../audio/announcer.js';
import { playCash, preloadCash } from '../../audio/cash.js';
import { playLanding, preloadLanding } from '../../audio/landing.js';
import { addCoins } from '../../menu/wallet.js';
import { pulseHand } from '../../input/haptics.js';
import { FIGHT } from '../config.js';
import { pubSendEvent, pubSendRaw } from '../net.js';
import type { FightNet, FireballNet } from '../protocol.js';
import { bus, pub } from '../state.js';
import { Panel } from '../panel.js';
import { UI, fitStencilText, metalText, plate, solidBar, stencilFont } from '../../ui/industrial.js';
import { teleportPlayer } from './TeleportSystem.js';

const HANDS = ['left', 'right'] as const;
type Hand = 0 | 1;

// Wire ball states (FireballNet[3]).
const HOVER = 0;
const ORBIT = 1;
const FLYING = 2;
const RETURNING = 3;
const DEAD = 4;

// Fighters stream their fireballs at the SAME rate quick match streams poses
// (NET.poseRateHz), and the foe's balls ease in at the arena's NET.smoothing —
// so a pub bout tracks as smoothly as a quick match. Only the two fighters
// stream, so the denser rate costs the room nothing.
const STREAM_INTERVAL = 1 / NET.poseRateHz;
const FIST_TOUCH_DISTANCE = 0.32;
const FIST_LANE_RADIUS = 0.34;
const FIST_CLOSING_SPEED = 1.35;
const FIST_LOCAL_HAND_SPEED = 1.2;

/** Ring buffer of recent hand positions → smoothed punch velocity. */
class VelocityTracker {
  private samples: { pos: Vector3; t: number }[] = [];

  push(pos: Vector3, t: number): void {
    this.samples.push({ pos: pos.clone(), t });
    while (this.samples.length > 12) this.samples.shift();
  }

  velocity(out: Vector3, now: number): Vector3 {
    out.set(0, 0, 0);
    const newest = this.samples[this.samples.length - 1];
    if (!newest) return out;
    let oldest = newest;
    for (const s of this.samples) {
      if (now - s.t <= 0.11) {
        oldest = s;
        break;
      }
    }
    const dt = newest.t - oldest.t;
    if (dt < 1e-3) return out;
    return out.copy(newest.pos).sub(oldest.pos).multiplyScalar(1 / dt);
  }

  reset(): void {
    this.samples.length = 0;
  }
}

interface LocalBall {
  state: number;
  visual: FireVisual;
  pos: Vector3;
  vel: Vector3;
  phase: number;
  spin: number;
  elapsed: number;
  heat: number;
  trailAcc: number;
  recallLock: number;
  /** Equipped ball-loadout effect on THIS recall (ATTACH.*; 0 = none). */
  attach: number;
  /** Size scale (grow > 1, shrink < 1) + damage scale carried by the effect. */
  scl: number;
  dmgScale: number;
  /** Fan slot for a split recall (0 = the main ball; shards take 1..N-1). */
  shardIndex: number;
}

/** A split recall's extra returning ball — homes to its fist, fanning out. */
interface ShardBall {
  visual: FireVisual;
  pos: Vector3;
  hand: Hand;
  shardIndex: number;
  heat: number;
  trailAcc: number;
}

/** A foe's streamed split shard, rendered + checked for recall-through hits. */
interface GhostShard {
  visual: FireVisual;
  pos: Vector3;
  heat: number;
  trailAcc: number;
  hitCooldown: number;
}

interface RemoteBall {
  visual: FireVisual;
  target: Vector3;
  state: number;
  heat: number;
  trailAcc: number;
  /** Victim-side per-ball re-hit guard. */
  hitCooldown: number;
  /** One connect per return leg — the recall-through guard (arena parity). */
  returnHit: number;
  hasTarget: boolean;
  /** Loadout size + damage scale streamed from the owner (1 = a plain ball). */
  scl: number;
  dmgScale: number;
  /**
   * Throw-blend window (seconds): on a fresh throw the ball eases onto the
   * owner's authoritative trajectory at the gentle NET.throwBlend rate instead
   * of the stiff NET.smoothing rate, so the launch doesn't snap. Quick-match
   * parity — see NET.throwBlend in config.ts.
   */
  blend: number;
}

/** The local player's ball loadout per fist ([left, right]; 0 none / 1 split /
 *  2 grow / 3 shrink) — the SAME 'ff-ballattach' the arena menu writes, so your
 *  chosen attachments carry into a pub bout. */
function loadBallAttach(): [number, number] {
  try {
    const parts = (localStorage.getItem('ff-ballattach') ?? '').split(',').map((s) => parseInt(s, 10));
    const clamp = (n: number): number => (Number.isFinite(n) && n >= 0 && n <= 3 ? n : 0);
    return [clamp(parts[0]), clamp(parts[1])];
  } catch {
    return [0, 0];
  }
}

const _grip = new Vector3();
const _gripQ = new Quaternion();
const _vel = new Vector3();
const _dir = new Vector3();
const _target = new Vector3();
const _perp1 = new Vector3();
const _perp2 = new Vector3();
const _aim = new Vector3();
const _offset = new Vector3();
const _camQ = new Quaternion();
const _head = new Vector3();
const _headQ = new Quaternion();
const _myFist = new Vector3();
const _oppFist = new Vector3();
const _ggMid = new Vector3();
const _ggLift = new Vector3();
const _rimLocal = new Vector3();

/** One octagon-edge wall of the rim barrier (local to the platform group). */
interface RimEdge {
  ax: number;
  az: number;
  nx: number;
  nz: number;
  mat: MeshBasicMaterial;
  glow: number;
}

/** Soft grid texture for the rim-barrier panels (same as the arena guardian). */
function rimGridTexture(): CanvasTexture {
  const S = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = S;
  const ctx = canvas.getContext('2d')!;
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = 2;
  for (let i = 0; i <= 4; i++) {
    const p = (i / 4) * S;
    ctx.beginPath();
    ctx.moveTo(p, 0);
    ctx.lineTo(p, S);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, p);
    ctx.lineTo(S, p);
    ctx.stroke();
  }
  const tex = new CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = RepeatWrapping;
  return tex;
}

export class FightSystem extends createSystem({}) {
  private time = 0;
  private streamTimer = 0;
  private myBalls: [LocalBall, LocalBall] | null = null;
  /** My live split shards (extra returning balls from a split recall). */
  private myShards: ShardBall[] = [];
  /** Each foe's streamed split shards (rendered + hit-checked locally). */
  private remoteShards = new Map<string, GhostShard[]>();
  /** This fighter's ball loadout per fist (refreshed when a pair is created). */
  private loadout: [number, number] = [0, 0];
  private trackers: [VelocityTracker, VelocityTracker] = [new VelocityTracker(), new VelocityTracker()];
  /** Remote fighters' streamed balls, keyed by player id. */
  private remoteBalls = new Map<string, [RemoteBall, RemoteBall]>();
  private myHp: number = FIGHT.hpMax;
  private lastPhase: FightNet['phase'] = 'idle';
  private consoleCooldown = 0;
  /** My own iron torso — rendered while I fight (so I see my machine) and
   *  solved each frame for the head/chest/pelvis hit spheres, arena-style. */
  private bodyRig?: BoxerRig;
  private myChest = new Vector3();
  private myPelvis = new Vector3();
  /** The arena-style match card that hangs above the opponent — only the two
   *  fighters see it (spectators read the wall scoreboards). */
  private matchBoard?: Panel;
  private boardSide: 0 | 1 | -1 = -1;
  private boardKey = '';
  /** Locally-ticked round clock. The server owns the authoritative timer, but
   *  it only broadcasts on whole-second changes (and an out-of-date room server
   *  may not send it at all — which left the HUD frozen at 0:00). So we count
   *  down here and snap to the server's value whenever a live one arrives. */
  private roundClock = 0;
  private lastServerTimer = -1;
  /** Last countdown second spoken, so the announcer fires once per beat. */
  private lastCountdown = -1;
  /** Throttle glove-touches so one bump pops a single GG. */
  private fistBumpCooldown = 0;
  /** Cooldown on the B-button GG salute (a deliberate one-shot). */
  private selfGgCooldown = 0;
  private fistPose: [Vector3, Vector3] = [new Vector3(), new Vector3()];
  private prevFistPose: [Vector3, Vector3] = [new Vector3(), new Vector3()];
  private hasPrevFistPose = false;
  /** My round-one stake on each corner's fighter (local only — bets never cross
   *  the wire; a winning side pays the holder 2× their stake). */
  private bets: [number, number] = [0, 0];
  /** Guard so a match pays my bets out exactly once. */
  private betSettled = false;
  /** Per-tablet redraw guard (skip the canvas re-paint when nothing changed). */
  private consoleKey: [string, string] = ['', ''];
  /** The rim barrier (the arena's guardian, ported): grid walls around MY
   *  platform that glow as my head nears the edge — the forfeit warning. */
  private rimGroup: Group | null = null;
  private rimEdges: RimEdge[] = [];
  private rimSide: -1 | 0 | 1 = -1;

  init(): void {
    preloadAnnouncer(); // decode 3/2/1/FIGHT so the countdown speaks like the arena
    preloadCash(); // the cash chime for a winning bet
    preloadLanding(); // the landing chimes for an arena-thrown bet
    // The local fighter's body: an ember (team 0) torso wearing my avatar
    // skin, exactly like the arena's PlayerBodySystem. Only the torso joins
    // the scene (my gloves are the controllers; my own head stays unseen).
    const mySkin = myAvatarSkin(); // chosen shape + custom colour
    this.bodyRig = buildBoxer(0, mySkin.id); // only my skin — never switches mid-pub
    this.bodyRig.torso.name = 'pub-fighter-torso';
    this.bodyRig.torso.visible = false;
    applyAvatarSkin(this.bodyRig.torso, mySkin);
    this.scene.add(this.bodyRig.torso);

    this.cleanupFuncs.push(
      bus.on('fight', (f) => this.onFight(f)),
      bus.on('gameEvent', ({ from, ev }) => {
        switch (ev.e) {
          case 'FIGHT_FB':
            this.onRemoteBalls(from, ev.balls, ev.shards);
            break;
          case 'FIGHT_HIT':
            // My ball connected on their side.
            if (this.amFighter() && this.myBalls) {
              const dmg = ev.dmg ?? FIREBALL.damage;
              const ball = this.myBalls[ev.ball];
              if (ev.ret) {
                // Return-pass: it keeps homing, never spent on the connect.
              } else if (ball.state === FLYING || ball.state === RETURNING) {
                this.spendLocalBall(ball);
              }
              spawnFireImpact(this.world, ball.pos, 0);
              spawnDamagePopup(this.world, ball.pos, dmg);
              sfx.hitDealt();
            }
            break;
          case 'FIGHT_DEFLECT':
            // Only spend + clap the block if our ball is STILL a live threat —
            // a stale deflect mustn't sound a phantom block (or kill a ball we
            // already caught back). Matches FIGHT_CLASH below.
            if (this.amFighter() && this.myBalls) {
              const ball = this.myBalls[ev.ball];
              if (ball.state === FLYING || ball.state === RETURNING) {
                this.spendLocalBall(ball);
                sfx.deflect();
              }
            }
            break;
          case 'FIGHT_CLASH':
            // One of my thrown balls met one of theirs — both die.
            if (this.amFighter() && this.myBalls) {
              const ball = this.myBalls[ev.ball];
              if (ball.state === FLYING || ball.state === RETURNING) {
                this.spendLocalBall(ball);
                emberBurst(ball.pos, 14, false);
                emberBurst(ball.pos, 14, true);
                spawnFireImpact(this.world, ball.pos, 0, 1.2);
                sfx.ballClash();
              }
            }
            break;
          case 'FIGHT_GG':
            // Someone landed a glove-touch: pop GG for the whole room at the
            // spot they sent (one side detecting is enough for everyone to see
            // it). Our own bumps pop locally and set the cooldown, so this
            // skips the echo of a bump we just made.
            if (this.fistBumpCooldown <= 0) {
              _ggMid.set(ev.pos[0], ev.pos[1], ev.pos[2]);
              this.popGg(_ggMid);
              this.fistBumpCooldown = 1.25;
            }
            break;
          default:
            break;
        }
      }),
      bus.on('left', (id) => this.dropRemote(id)),
      bus.on('coinInserted', (slot) => this.onBet(slot)),
      bus.on('betThrow', (side) => this.onArenaBet(side)),
    );
    this.renderConsoles();
    this.renderDisplay();
  }

  /** A coin was fed into a betting tablet — stake it on that corner's fighter.
   *  CoinSystem only offers the slot while bets are open and the corner is
   *  filled; we re-check here so a stray event can't bank a phantom stake. */
  private onBet(slot: string): void {
    const side: 0 | 1 | null = slot === 'bet0' ? 0 : slot === 'bet1' ? 1 : null;
    if (side === null) return;
    const f = pub.fight;
    const open = f.round === 1 && (f.phase === 'starting' || f.phase === 'fighting');
    if (!open || !f.sides[side] || this.amFighter()) return;
    this.bets[side] += 1;
    sfx.uiClick();
    this.renderConsoles();
  }

  /** A coin was THROWN into the pit and settled on a fighter's half — stake it
   *  on that corner, ringing a random landing chime as the confirmation. Same
   *  guards as the tablet bet; CoinSystem already re-checks before it consumes
   *  the coin, but we re-check here so a stray event can't bank a phantom stake. */
  private onArenaBet(side: 0 | 1): void {
    const f = pub.fight;
    const open = f.round === 1 && (f.phase === 'starting' || f.phase === 'fighting');
    if (!open || !f.sides[side] || this.amFighter()) return;
    this.bets[side] += 1;
    playLanding();
    this.renderConsoles();
  }

  /** Settle my round-one bets when the match ends: the winning corner pays the
   *  holder 2× their stake (losing stakes are gone — already debited at the
   *  tablet). The wrist counter rolls the payout up; the cash chime rings. */
  private settleBets(f: FightNet): void {
    if (this.betSettled) return;
    this.betSettled = true;
    const total = this.bets[0] + this.bets[1];
    if (total === 0) return;
    let payout = 0;
    if (f.winner) {
      const winSide: 0 | 1 | null = f.sides[0] === f.winner ? 0 : f.sides[1] === f.winner ? 1 : null;
      if (winSide !== null) payout = this.bets[winSide] * 2;
    } else {
      payout = total; // no winner (shouldn't happen best-of-5) — refund stakes
    }
    if (payout > 0) {
      addCoins(payout);
      playCash();
    }
  }

  /** Clear bets for a fresh match. */
  private resetBets(): void {
    this.bets[0] = 0;
    this.bets[1] = 0;
    this.betSettled = false;
  }

  private rimKey = '';
  /** Each slab's native deck colour, captured before any skin re-tint. */
  private slabBase: number[] = [];

  /**
   * Dress each platform rim AND slab in its claimant's PLATFORM skin the moment
   * a corner locks in (back to corner colours when it frees up) — your arena
   * cosmetics follow you onto the fight-hall floor.
   */
  private dressRims(): void {
    const rims = pub.refs?.fightRims;
    const slabs = pub.refs?.fightSlabs;
    if (!rims) return;
    const pfFor = (side: 0 | 1): string => {
      const id = pub.fight.sides[side];
      if (!id) return '';
      if (id === pub.myId) return customization.platform;
      return pub.punters.get(id)?.pf ?? '';
    };
    const key = `${pfFor(0)}|${pfFor(1)}`;
    if (key === this.rimKey) return;
    this.rimKey = key;
    ([0, 1] as const).forEach((side) => {
      const pf = pfFor(side);
      const skin = pf ? platformSkin(pf) : null;
      const colour = skin ? skin.neon : teamColor(side);
      const mat = rims[side].material as MeshStandardMaterial;
      mat.color.setHex(colour);
      mat.emissive.setHex(colour);
      if (slabs) {
        const sm = slabs[side].material as MeshStandardMaterial;
        if (this.slabBase[side] === undefined) this.slabBase[side] = sm.color.getHex();
        sm.emissive.setHex(colour);
        // Premium pads carry an explicit deck tint (gold deck, XD black) — apply
        // it so the arena's slab look follows the claimant in; otherwise keep the
        // hall's native gunmetal deck.
        sm.color.setHex(skin?.slab ?? this.slabBase[side]);
      }
    });
  }

  /** Build the eight octagon-edge barrier walls once (local to a platform-sized
   *  group we then reposition onto whichever corner I'm fighting from). */
  private buildRimBarrier(): void {
    const group = new Group();
    group.name = 'pub-rim-barrier';
    group.visible = false;
    const tex = rimGridTexture();
    const n = OCTAGON_VERTICES.length;
    for (let i = 0; i < n; i++) {
      const [ax, az] = OCTAGON_VERTICES[i];
      const [bx, bz] = OCTAGON_VERTICES[(i + 1) % n];
      const dx = bx - ax;
      const dz = bz - az;
      const len = Math.hypot(dx, dz);
      let nx = -dz / len;
      let nz = dx / len;
      const midx = (ax + bx) / 2;
      const midz = (az + bz) / 2;
      if (nx * midx + nz * midz < 0) {
        nx = -nx;
        nz = -nz;
      }
      const mat = new MeshBasicMaterial({
        map: tex,
        color: PALETTE.ember,
        transparent: true,
        opacity: 0,
        side: DoubleSide,
        blending: AdditiveBlending,
        depthWrite: false,
      });
      mat.map!.repeat.set(Math.max(1, Math.round(len * 3)), Math.round(BOUNDARY.wallHeight * 3));
      const mesh = new Mesh(new PlaneGeometry(len, BOUNDARY.wallHeight), mat);
      mesh.position.set(midx, BOUNDARY.wallHeight / 2, midz);
      mesh.rotation.y = -Math.atan2(dz, dx);
      group.add(mesh);
      this.rimEdges.push({ ax, az, nx, nz, mat, glow: 0 });
    }
    this.scene.add(group);
    this.rimGroup = group;
  }

  /** Glow MY platform's rim walls as my head nears the edge (red once I've
   *  leant out past it — the last warning before leaving forfeits). Local
   *  only, exactly like the arena guardian: spectators see no barrier. */
  private updateRimBarrier(delta: number): void {
    if (!this.rimGroup) this.buildRimBarrier();
    const group = this.rimGroup!;
    const f = pub.fight;
    const side = this.mySide();
    const show =
      side !== -1 && pub.online && (f.phase === 'starting' || f.phase === 'fighting' || f.phase === 'roundOver');
    group.visible = show;
    if (!show) {
      this.rimSide = -1;
      for (const e of this.rimEdges) {
        e.glow = 0;
        e.mat.opacity = 0;
      }
      return;
    }
    if (this.rimSide !== side) {
      this.rimSide = side as 0 | 1;
      const z = side === 0 ? FIGHT.platformZ : -FIGHT.platformZ;
      group.position.set(FIGHT.centerX, -FIGHT.pitDepth, z);
      group.rotation.y = side === 0 ? 0 : Math.PI; // match the slab's facing
      group.updateMatrixWorld();
    }
    this.player.head.getWorldPosition(_rimLocal);
    group.worldToLocal(_rimLocal); // head in platform-local space
    let outside = false;
    for (const e of this.rimEdges) {
      const d = (_rimLocal.x - e.ax) * e.nx + (_rimLocal.z - e.az) * e.nz;
      const target = d > -BOUNDARY.warnDistance ? Math.min(1, 1 + d / BOUNDARY.warnDistance) * 0.6 + 0.08 : 0;
      e.glow += (target - e.glow) * Math.min(1, delta * 8);
      e.mat.opacity = e.glow;
      if (d > BOUNDARY.graceDepth) outside = true;
    }
    const hex = outside ? PALETTE.danger : PALETTE.ember;
    for (const e of this.rimEdges) e.mat.color.setHex(hex);
  }

  update(delta: number): void {
    this.time += delta;
    this.consoleCooldown = Math.max(0, this.consoleCooldown - delta);
    updateFirePools(delta);
    this.camera.getWorldQuaternion(_camQ);

    this.checkConsoles();
    this.dressRims();
    this.renderConsoles(); // cheap — the key guard skips the redraw unless it changed
    this.updateRimBarrier(delta); // my platform's guardian walls (forfeit warning)

    const f = pub.fight;
    const fighting = f.phase === 'fighting';
    // Between rounds (roundOver) the fighters stay embodied with their balls
    // hovering — only KO-gated throws pause — so keep the body/ball sim live.
    const live = f.phase === 'starting' || f.phase === 'roundOver' || fighting;

    // Round clock: adopt the server's value whenever it sends a fresh live one,
    // otherwise tick down locally so it always moves (a stale room server that
    // never broadcasts the clock used to leave it stuck at 0:00).
    if (f.roundTimer !== this.lastServerTimer) {
      this.lastServerTimer = f.roundTimer;
      if (f.roundTimer > 0) this.roundClock = f.roundTimer;
    }
    // Tick locally through both the live round AND the pre-round 3-2-1 so the
    // clock/countdown always moves between the server's whole-second snaps.
    if (fighting || f.phase === 'starting') this.roundClock = Math.max(0, this.roundClock - delta);

    this.updateMatchBoard();
    this.tryFistBump(delta);
    this.trySelfGg(delta);

    if (this.amFighter() && live) {
      this.solveMyBody();
      this.ensureMyBalls();
      this.updateMyBalls(delta, fighting);
      this.updateMyShards(delta);
      // Only hold fighters to their platform while a round is actually LIVE.
      // During the pre-bell countdown and the between-round pause the leash
      // was still armed, so a half-step after winning round 1 was read as
      // walking off — forfeiting the whole best-of-5 before round 2 rang.
      if (fighting) this.checkForfeit();
      this.checkIncomingHits(fighting);
      this.streamBalls(delta);
    } else {
      if (this.bodyRig) this.bodyRig.torso.visible = false;
      if (this.myBalls && f.phase === 'idle') this.disposeMyBalls();
    }

    // Remote fighters' balls: ease to targets, drive the fire look.
    for (const [id, balls] of this.remoteBalls) {
      if (f.phase === 'idle' || !f.sides.includes(id)) {
        for (const b of balls) b.visual.dispose();
        for (const b of balls) this.scene.remove(b.visual.group);
        this.remoteBalls.delete(id);
        this.dropRemoteShards(id);
        continue;
      }
      const cool = this.teamFor(id) === 1;
      for (const b of balls) {
        b.hitCooldown = Math.max(0, b.hitCooldown - delta);
        // Throw-blend (quick-match parity): for a short window after a throw the
        // ball eases onto the owner's authoritative line at the gentle
        // NET.throwBlend rate, otherwise it tracks tightly at NET.smoothing.
        const rate = b.blend > 0 ? NET.throwBlend : NET.smoothing;
        b.blend = Math.max(0, b.blend - delta);
        const k = 1 - Math.exp(-rate * delta);
        if (b.hasTarget) {
          // A real teleport (round reset, a respawn) still snaps — but never
          // during the blend window, where a big gap is the launch easing in.
          if (b.blend <= 0 && b.visual.group.position.distanceToSquared(b.target) > 9) {
            b.visual.group.position.copy(b.target);
          } else {
            b.visual.group.position.lerp(b.target, k);
          }
        }
        this.driveFireLook(b.visual, b.visual.group.position, b.state, b, delta, cool);
      }
    }

    // Foes' split shards: render the streamed fan (hit-checked in checkIncomingHits).
    for (const [id, shards] of this.remoteShards) {
      if (f.phase === 'idle' || !f.sides.includes(id)) {
        this.dropRemoteShards(id);
        continue;
      }
      const cool = this.teamFor(id) === 1;
      for (const g of shards) {
        g.hitCooldown = Math.max(0, g.hitCooldown - delta);
        g.visual.group.position.copy(g.pos);
        this.driveFireLook(g.visual, g.pos, RETURNING, g, delta, cool);
      }
    }
  }

  // --- consoles / lifecycle -----------------------------------------------------

  private mySide(): 0 | 1 | -1 {
    if (pub.fight.sides[0] === pub.myId) return 0;
    if (pub.fight.sides[1] === pub.myId) return 1;
    return -1;
  }

  private amFighter(): boolean {
    return this.mySide() !== -1;
  }

  /**
   * Render team (0 = ember/orange, 1 = blue) for a fighter id FROM MY EYES.
   * A fighter always sees their own fire orange and their foe's blue (arena
   * parity); a spectator sees the fixed corner tints.
   */
  private teamFor(id: string | null): 0 | 1 {
    if (!id) return 0;
    if (this.amFighter()) return id === pub.myId ? 0 : 1;
    return pub.fight.sides[1] === id ? 1 : 0;
  }

  private checkConsoles(): void {
    if (this.consoleCooldown > 0) return;
    let pressed = false;
    for (const hand of HANDS) {
      if (this.input.xr.gamepads[hand]?.getButtonDown(InputComponent.Trigger)) pressed = true;
    }
    if (!pressed) return;

    this.player.head.getWorldPosition(_head);
    for (const side of [0, 1] as const) {
      const [cx, , cz] = FIGHT.consoles[side];
      if (Math.hypot(_head.x - cx, _head.z - cz) > 1.3) continue;
      this.consoleCooldown = 0.5;
      if (!pub.online) return; // consoles need the room server
      const f = pub.fight;
      if (f.sides[side] === pub.myId && (f.phase === 'idle' || f.phase === 'starting')) {
        pubSendRaw({ t: 'leave-fight' }); // step back down
        sfx.uiClick();
      } else if (f.sides[side] === null && f.phase === 'idle' && !this.amFighter()) {
        pubSendRaw({ t: 'claim-fight', side });
        sfx.uiClick();
        // Take your corner: feet on the platform, DOWN in the pit, facing your
        // opponent across the pit. Side 0 sits at +z with its rival at −z (so it
        // faces −z = yaw 0); side 1 is the mirror. Facing the rival on arrival
        // means no 180° physical turn — your real body stays centred in its
        // playspace. (Any later teleport restores stands level.)
        const z = side === 0 ? FIGHT.platformZ : -FIGHT.platformZ;
        teleportPlayer(this.player as XROrigin, FIGHT.centerX, z, side === 0 ? 0 : Math.PI);
        (this.player as XROrigin).position.y = -FIGHT.pitDepth;
      }
      return;
    }
  }

  private onFight(f: FightNet): void {
    if (f.phase !== this.lastPhase) {
      switch (f.phase) {
        case 'starting':
          // Open the 3-2-1: count down locally to the bell. The announcer below
          // speaks each beat (room-wide), exactly like the arena.
          this.roundClock = FIGHT.startCountdown;
          this.lastServerTimer = f.roundTimer;
          this.lastCountdown = -1;
          // A fresh match's first countdown opens the betting books.
          if (f.round === 1) this.resetBets();
          break;
        case 'fighting':
          // Every round opens with the bell + full health + balls back at fists.
          sfx.roundBell();
          announce('fight'); // the ring announcer, heard across the whole pub
          this.lastCountdown = -1;
          this.myHp = FIGHT.hpMax;
          // Start the local clock at a full round; the server's live ticks (if
          // it sends them) snap it from here in update().
          this.roundClock = FIGHT.roundTime;
          this.lastServerTimer = -1;
          if (this.amFighter() && this.myBalls) this.resetMyBalls();
          break;
        case 'roundOver': {
          // A round (not the match) was decided — winner takes the pip.
          const cue = !f.winner ? 'draw' : f.winner === pub.myId;
          if (this.amFighter()) sfx.roundEnd(cue);
          else sfx.roundEnd(!f.winner ? 'draw' : true);
          break;
        }
        case 'over': {
          const iWon = f.winner === pub.myId;
          if (this.amFighter()) sfx.matchEnd(iWon);
          else sfx.roundEnd(true);
          this.settleBets(f); // pay out winning bets (rolls the wrist up + chimes)
          break;
        }
        case 'idle':
          this.resetBets();
          break;
      }
      this.lastPhase = f.phase;
    }

    // Pre-round 3-2-1: the ring announcer speaks each beat on EVERY client in
    // the room (the clips play non-spatially, so the whole pub hears a match
    // kick off), not just the two fighters — driven off the server's whole-
    // second snaps so everyone counts together.
    if (f.phase === 'starting') {
      const n = Math.round(f.roundTimer);
      if (n >= 1 && n <= 3 && n !== this.lastCountdown) {
        this.lastCountdown = n;
        announce(String(n) as '1' | '2' | '3');
      }
    } else {
      this.lastCountdown = -1;
    }
    this.renderConsoles();
    this.renderDisplay();
  }

  /** Fighters must hold their platform — wander off and you forfeit. */
  private checkForfeit(): void {
    const side = this.mySide();
    if (side === -1) return;
    this.player.head.getWorldPosition(_head);
    const z = side === 0 ? FIGHT.platformZ : -FIGHT.platformZ;
    if (Math.hypot(_head.x - FIGHT.centerX, _head.z - z) > FIGHT.forfeitRadius) {
      pubSendRaw({ t: 'leave-fight' });
    }
  }

  // --- glove-touch (fist bump the other fighter) ------------------------------

  /**
   * Touch gloves with your opponent between rounds and after the bell. The
   * fighters stand a pit apart, so a literal hand-to-hand isn't possible —
   * instead BOTH reaching a clenched fist out over the pit (toward centre,
   * roughly aligned) reads as a bump, the same trick the arena uses across its
   * gap. Closing right up also counts, for when the corners free up and you can
   * actually meet. We pop GG locally and broadcast it so everyone sees it.
   */
  private tryFistBump(delta: number): void {
    this.fistBumpCooldown = Math.max(0, this.fistBumpCooldown - delta);
    if (this.fistBumpCooldown > 0) return;
    const side = this.mySide();
    if (side === -1) {
      this.hasPrevFistPose = false;
      return;
    }
    // The moments you actually want it: the pre-bell stare-down, between rounds
    // and after the match — never mid-exchange.
    const phase = pub.fight.phase;
    if (phase !== 'starting' && phase !== 'roundOver' && phase !== 'over') {
      this.hasPrevFistPose = false;
      return;
    }

    const oppId = pub.fight.sides[side === 0 ? 1 : 0];
    const opp = oppId ? pub.punters.get(oppId) : null;
    if (!opp || delta <= 0) {
      this.hasPrevFistPose = false;
      return;
    }
    const oppSide: 0 | 1 = side === 0 ? 1 : 0;

    for (const hand of [0, 1] as const) {
      const grip = this.player.gripSpaces[HANDS[hand]];
      if (!grip) {
        this.hasPrevFistPose = false;
        return;
      }
      grip.getWorldPosition(this.fistPose[hand]);
    }

    if (!this.hasPrevFistPose) {
      this.rememberFistPose();
      return;
    }

    for (const hand of [0, 1] as const) {
      if (!this.localFistPressed(hand)) continue;
      _myFist.copy(this.fistPose[hand]);
      const localSpeed = _myFist.distanceTo(this.prevFistPose[hand]) / delta;
      const iReach = this.reachingToCentre(_myFist.z, side);

      for (const oh of [opp.left, opp.right]) {
        _oppFist.set(oh[0], oh[1], oh[2]);
        const contact = _myFist.distanceTo(_oppFist);
        const lane = Math.hypot(_myFist.x - _oppFist.x, _myFist.y - _oppFist.y);
        const bothReach = iReach && this.reachingToCentre(_oppFist.z, oppSide) && lane < FIST_LANE_RADIUS;
        if (contact > FIST_TOUCH_DISTANCE && !bothReach) continue;
        const closingSpeed = (this.prevFistPose[hand].distanceTo(_oppFist) - contact) / delta;
        if (closingSpeed < FIST_CLOSING_SPEED && localSpeed < FIST_LOCAL_HAND_SPEED) continue;

        _ggMid.copy(_myFist).add(_oppFist).multiplyScalar(0.5);
        this.popGg(_ggMid);
        pubSendEvent({ e: 'FIGHT_GG', pos: [_ggMid.x, _ggMid.y, _ggMid.z] });
        pulseHand(this.world.session, HANDS[hand], 0.6, 90);
        this.fistBumpCooldown = 1.25;
        this.rememberFistPose();
        return;
      }
    }

    this.rememberFistPose();
  }

  private localFistPressed(hand: 0 | 1): boolean {
    const gp = this.input.xr.gamepads[HANDS[hand]];
    return (
      (gp?.getButtonPressed(InputComponent.Squeeze) ?? false) &&
      (gp?.getButtonPressed(InputComponent.Trigger) ?? false)
    );
  }

  private rememberFistPose(): void {
    this.prevFistPose[0].copy(this.fistPose[0]);
    this.prevFistPose[1].copy(this.fistPose[1]);
    this.hasPrevFistPose = true;
  }

  /** A fist `z` that has reached out over the pit toward the centreline. */
  private reachingToCentre(z: number, side: 0 | 1): boolean {
    const t = FIGHT.platformZ * 0.5; // crossed halfway in toward the centre
    return side === 0 ? z < t : z > -t;
  }

  /** The celebratory GG: a spark, a big floating GG and the metal donk. */
  /** Press B (right controller) to throw a solo GG salute over your own glove —
   *  the arena's B-button GG, ported. Broadcast so the whole room sees it; a
   *  long cooldown keeps it a deliberate gesture, not a spammed pop. */
  private trySelfGg(delta: number): void {
    this.selfGgCooldown = Math.max(0, this.selfGgCooldown - delta);
    if (this.selfGgCooldown > 0 || !this.amFighter()) return;
    if (!(this.input.xr.gamepads.right?.getButtonDown(InputComponent.B_Button) ?? false)) return;
    const grip = this.player.gripSpaces.right;
    if (!grip) return;
    grip.getWorldPosition(_ggMid);
    _ggMid.y += 0.05;
    this.popGg(_ggMid);
    pubSendEvent({ e: 'FIGHT_GG', pos: [_ggMid.x, _ggMid.y, _ggMid.z] });
    // Share the bump guard so my own broadcast echoing back can't double-pop.
    this.fistBumpCooldown = 1.25;
    this.selfGgCooldown = 10;
  }

  private popGg(pos: Vector3): void {
    spawnGestureCue(this.world, pos, 0.32);
    _ggLift.copy(pos);
    _ggLift.y += 0.18;
    spawnPopup(this.world, _ggLift, 'GG', '#ffffff', 'rgba(255,255,255,0.95)', 2.6);
    sfx.fistBump();
  }

  /**
   * Solve and show my own torso, mirroring the arena's PlayerBodySystem. The
   * pit drops the rig a level (player.y = -pitDepth), so we lift the head into
   * "floor at 0" space for the pinned-hip solve and drop the result back down.
   */
  private solveMyBody(): void {
    const rig = this.bodyRig;
    if (!rig) return;
    const side = this.mySide();
    if (side === -1) {
      rig.torso.visible = false;
      return;
    }
    rig.torso.visible = true;
    this.player.head.getWorldPosition(_head);
    this.player.head.getWorldQuaternion(_headQ);
    _head.y += FIGHT.pitDepth;
    const z = side === 0 ? FIGHT.platformZ : -FIGHT.platformZ;
    solveTorso(rig, _head, _headQ, FIGHT.centerX, z, this.myChest, this.myPelvis);
    rig.chest.position.y -= FIGHT.pitDepth;
    rig.pelvis.position.y -= FIGHT.pitDepth;
    this.myChest.y -= FIGHT.pitDepth;
    this.myPelvis.y -= FIGHT.pitDepth;
  }

  // --- my fireballs (the arena state machine, pub coordinates) --------------------

  private ensureMyBalls(): void {
    if (this.myBalls) return;
    this.loadout = loadBallAttach(); // your arena ball loadout walks into the pub
    const team = this.teamFor(pub.myId); // a fighter's own fire is always ember
    const mk = (hand: Hand): LocalBall => {
      const visual = createFireVisual(team);
      this.scene.add(visual.group);
      this.handPose(hand);
      return {
        state: HOVER,
        visual,
        pos: visual.group.position.copy(_grip),
        vel: new Vector3(),
        phase: hand * Math.PI,
        spin: 0,
        elapsed: 0,
        heat: 0.8,
        trailAcc: 0,
        recallLock: 0,
        attach: 0,
        scl: 1,
        dmgScale: 1,
        shardIndex: 0,
      };
    };
    this.myBalls = [mk(0), mk(1)];
    this.trackers[0].reset();
    this.trackers[1].reset();
    sfx.ignite();
  }

  private disposeMyBalls(): void {
    this.clearMyShards();
    if (!this.myBalls) return;
    for (const b of this.myBalls) {
      this.scene.remove(b.visual.group);
      b.visual.dispose();
    }
    this.myBalls = null;
  }

  private dropRemoteShards(id: string): void {
    const shards = this.remoteShards.get(id);
    if (!shards) return;
    for (const g of shards) {
      this.scene.remove(g.visual.group);
      g.visual.dispose();
    }
    this.remoteShards.delete(id);
  }

  private resetMyBalls(): void {
    if (!this.myBalls) return;
    for (const b of this.myBalls) {
      b.state = HOVER;
      b.spin = 0;
      b.elapsed = 0;
      b.recallLock = 0;
      this.revertBall(b);
    }
    this.clearMyShards();
  }

  private spendLocalBall(ball: LocalBall): void {
    ball.state = DEAD;
    ball.vel.set(0, 0, 0);
    ball.recallLock = FIREBALL.recallLockout;
    this.revertBall(ball);
  }

  /**
   * Apply the equipped ball-loadout effect the instant a still-FLYING ball is
   * recalled — grow/shrink scale the ball's size and damage with how far out it
   * was, exactly like the arena. (Split is not networked yet, so it's left as a
   * plain recall.) The size + damage scale ride the FIGHT_FB stream so the foe
   * sees the right ball and takes the right hit.
   */
  private applyAttachment(ball: LocalBall, hand: Hand): void {
    const type = this.loadout[hand];
    if (!type) return;
    if (type === ATTACH.split) {
      // Three lighter, smaller balls fanning home — the main one plus two shards.
      ball.attach = ATTACH.split;
      ball.shardIndex = 0;
      ball.scl = ATTACH.splitSize;
      ball.dmgScale = 1 / ATTACH.splitCount;
      ball.visual.group.scale.setScalar(ATTACH.splitSize);
      const team = this.teamFor(pub.myId);
      for (let i = 1; i < ATTACH.splitCount; i++) {
        const visual = createFireVisual(team);
        visual.group.scale.setScalar(ATTACH.splitSize);
        visual.group.position.copy(ball.pos);
        this.scene.add(visual.group);
        this.myShards.push({ visual, pos: ball.pos.clone(), hand, shardIndex: i, heat: 0.8, trailAcc: 0 });
      }
      return;
    }
    const t = Math.min(1, Math.max(0, ball.pos.distanceTo(_grip) / ATTACH.fullRange));
    if (type === ATTACH.grow) {
      ball.scl = 1 + (ATTACH.growSize - 1) * t;
      ball.dmgScale = (FIREBALL.damage - ATTACH.damageSwing * t) / FIREBALL.damage;
    } else {
      ball.scl = 1 - (1 - ATTACH.shrinkSize) * t;
      ball.dmgScale = (FIREBALL.damage + ATTACH.damageSwing * t) / FIREBALL.damage;
    }
    ball.attach = type;
    ball.visual.group.scale.setScalar(ball.scl);
  }

  /** Strip any attachment back off a ball (caught, spent or round reset). Its
   *  shards self-clean next frame (they only live while the main ball splits). */
  private revertBall(ball: LocalBall): void {
    ball.attach = 0;
    ball.scl = 1;
    ball.dmgScale = 1;
    ball.shardIndex = 0;
    ball.visual.group.scale.setScalar(1);
  }

  /** Move `pos` toward the fist `grip`; a split ball/shard fans around the path,
   *  the fan collapsing to the fist as it closes (arena parity). Returns dist. */
  private homeToward(pos: Vector3, grip: Vector3, split: boolean, shardIndex: number, delta: number): number {
    _target.copy(grip);
    if (split) {
      _dir.copy(grip).sub(pos);
      const d = _dir.length();
      if (d > 1e-3) {
        _dir.multiplyScalar(1 / d);
        _perp1.set(0, 1, 0).cross(_dir);
        if (_perp1.lengthSq() < 1e-4) _perp1.set(1, 0, 0);
        _perp1.normalize();
        _perp2.copy(_dir).cross(_perp1).normalize();
        const ang = (shardIndex * Math.PI * 2) / ATTACH.splitCount;
        const fan = ATTACH.splitSpread * Math.min(1, d / ATTACH.splitSpreadRange);
        _target.addScaledVector(_perp1, Math.cos(ang) * fan).addScaledVector(_perp2, Math.sin(ang) * fan);
      }
    }
    _dir.copy(_target).sub(pos);
    const dist = _dir.length();
    const speed = Math.min(FIREBALL.returnSpeed, 3 + dist * 7);
    pos.addScaledVector(_dir.normalize(), Math.min(speed * delta, dist));
    return pos.distanceTo(grip);
  }

  /** Simulate my live split shards: home to their fist, despawn once caught or
   *  once the main ball is no longer a split recall. */
  private updateMyShards(delta: number): void {
    if (!this.myShards.length) return;
    const cool = this.teamFor(pub.myId) === 1;
    for (let i = this.myShards.length - 1; i >= 0; i--) {
      const s = this.myShards[i];
      const main = this.myBalls?.[s.hand];
      const alive = !!main && main.state === RETURNING && main.attach === ATTACH.split;
      this.handPose(s.hand);
      const dist = alive ? this.homeToward(s.pos, _grip, true, s.shardIndex, delta) : 0;
      if (!alive || dist <= FIREBALL.catchRadius) {
        this.scene.remove(s.visual.group);
        s.visual.dispose();
        this.myShards.splice(i, 1);
        continue;
      }
      s.visual.group.position.copy(s.pos);
      this.driveFireLook(s.visual, s.pos, RETURNING, s, delta, cool);
    }
  }

  private clearMyShards(): void {
    for (const s of this.myShards) {
      this.scene.remove(s.visual.group);
      s.visual.dispose();
    }
    this.myShards.length = 0;
  }

  private handPose(hand: Hand): void {
    const grip = this.player.gripSpaces[HANDS[hand]];
    const ray = this.player.raySpaces[HANDS[hand]];
    grip.getWorldPosition(_grip);
    (ray ?? grip).getWorldQuaternion(_gripQ);
  }

  private updateMyBalls(delta: number, fighting: boolean): void {
    if (!this.myBalls) return;
    const cool = this.teamFor(pub.myId) === 1; // my own fire (ember from my view)

    for (const hand of [0, 1] as const) {
      const ball = this.myBalls[hand];
      ball.recallLock = Math.max(0, ball.recallLock - delta);
      this.handPose(hand);
      this.trackers[hand].push(_grip, this.time);

      const gp = this.input.xr.gamepads[HANDS[hand]];
      const pressedNow =
        (gp?.getButtonPressed(InputComponent.Trigger) ?? false) ||
        (gp?.getButtonPressed(InputComponent.Squeeze) ?? false);
      const down =
        (gp?.getButtonDown(InputComponent.Trigger) ?? false) ||
        (gp?.getButtonDown(InputComponent.Squeeze) ?? false);
      const released =
        (gp?.getButtonUp(InputComponent.Trigger) ?? false) ||
        (gp?.getButtonUp(InputComponent.Squeeze) ?? false);

      if (down) {
        if (ball.state === HOVER || (ball.state !== DEAD && ball.pos.distanceTo(_grip) <= FIREBALL.nearHandRadius)) {
          if (ball.state !== ORBIT) {
            ball.state = ORBIT;
            ball.spin = 0;
            sfx.ignite();
            pulseHand(this.world.session, HANDS[hand], 0.4, 60);
          }
        } else if (ball.state === FLYING || (ball.state === DEAD && ball.recallLock <= 0)) {
          const wasFlying = ball.state === FLYING;
          ball.state = RETURNING;
          ball.recallLock = 0;
          sfx.recall();
          if (wasFlying) this.applyAttachment(ball, hand); // grow/shrink on a live recall
        }
      }

      if (released && ball.state === ORBIT) {
        this.trackers[hand].velocity(_vel, this.time);
        const speed = _vel.length();
        // Throws only count once the bell has gone.
        if (fighting && speed >= FIREBALL.minPunchSpeed) {
          this.throwBall(ball, hand, speed);
        } else {
          ball.state = HOVER;
        }
      }

      if (ball.state === RETURNING && ball.pos.distanceTo(_grip) <= FIREBALL.catchRadius) {
        ball.state = pressedNow ? ORBIT : HOVER;
        ball.spin = 0;
        this.revertBall(ball); // back to a plain ball once it's home
        sfx.catchBall();
        pulseHand(this.world.session, HANDS[hand], 0.5, 70);
      }

      // Integrate.
      switch (ball.state) {
        case HOVER: {
          _offset.set(...FIREBALL.hoverOffset).applyQuaternion(_gripQ);
          const k = 1 - Math.exp(-FIREBALL.hoverLerp * delta);
          ball.pos.lerp(_offset.add(_grip), k);
          break;
        }
        case ORBIT: {
          ball.spin += delta;
          const rate =
            FIREBALL.orbitSpeedMin +
            (FIREBALL.orbitSpeedMax - FIREBALL.orbitSpeedMin) *
              Math.min(1, ball.spin / FIREBALL.orbitSpinUp);
          ball.phase += rate * delta;
          _offset
            .set(Math.cos(ball.phase) * FIREBALL.orbitRadius, Math.sin(ball.phase) * FIREBALL.orbitRadius, 0)
            .applyQuaternion(_gripQ);
          ball.pos.copy(_grip).add(_offset);
          break;
        }
        case FLYING: {
          ball.vel.y -= FIREBALL.gravity * delta;
          ball.pos.addScaledVector(ball.vel, delta);
          if (this.clampToCage(ball.pos)) {
            emberBurst(ball.pos, 14, cool);
            sfx.wallThud();
            this.spendLocalBall(ball);
            break;
          }
          ball.elapsed += delta;
          // The duel floor is the PIT floor, a level below the stands.
          if (ball.elapsed >= FIREBALL.lifetime || ball.pos.y <= FIREBALL.radius - FIGHT.pitDepth) {
            this.spendLocalBall(ball);
            ball.pos.y = Math.max(ball.pos.y, FIREBALL.radius - FIGHT.pitDepth);
          }
          break;
        }
        case RETURNING: {
          this.homeToward(ball.pos, _grip, ball.attach === ATTACH.split, ball.shardIndex, delta);
          break;
        }
        case DEAD:
          if (ball.pos.y > FIREBALL.radius - FIGHT.pitDepth) {
            ball.pos.y = Math.max(FIREBALL.radius - FIGHT.pitDepth, ball.pos.y - 2.5 * delta);
          }
          break;
      }

      ball.visual.group.position.copy(ball.pos);
      this.driveFireLook(ball.visual, ball.pos, ball.state, ball, delta, cool);
    }
  }

  private throwBall(ball: LocalBall, hand: Hand, handSpeed: number): void {
    _dir.copy(_vel).normalize();
    // Aim assist: blend toward the other fighter's chest.
    this.opponentChest(_aim);
    _aim.sub(ball.pos).normalize();
    _dir.lerp(_aim, FIREBALL.aimAssist).normalize();
    const speed = Math.min(
      FIREBALL.throwSpeedMax,
      Math.max(FIREBALL.throwSpeedMin, handSpeed * FIREBALL.punchGain),
    );
    ball.vel.copy(_dir).multiplyScalar(speed);
    ball.state = FLYING;
    ball.elapsed = 0;
    ball.recallLock = 0;
    sfx.throwWhoosh();
    pulseHand(this.world.session, HANDS[hand], 0.8, 110);
  }

  private opponentChest(out: Vector3): void {
    const side = this.mySide();
    const oppId = pub.fight.sides[side === 0 ? 1 : 0];
    const opp = oppId ? pub.punters.get(oppId) : null;
    if (opp) {
      out.set(opp.head[0], opp.head[1] - 0.35, opp.head[2]);
    } else {
      out.set(FIGHT.centerX, 1.25, side === 0 ? -FIGHT.platformZ : FIGHT.platformZ);
    }
  }

  /** The 5-yard cage: clamp + report so balls burst on the invisible wall. */
  private clampToCage(p: Vector3): boolean {
    const c = FIGHT.cage;
    let hit = false;
    if (p.x < c.minX) { p.x = c.minX; hit = true; }
    else if (p.x > c.maxX) { p.x = c.maxX; hit = true; }
    if (p.z < c.minZ) { p.z = c.minZ; hit = true; }
    else if (p.z > c.maxZ) { p.z = c.maxZ; hit = true; }
    if (p.y > c.ceiling) { p.y = c.ceiling; hit = true; }
    return hit;
  }

  // --- hits (victim-authoritative, like the arena) --------------------------------

  private checkIncomingHits(fighting: boolean): void {
    if (!fighting) return;
    const side = this.mySide();
    const oppId = pub.fight.sides[side === 0 ? 1 : 0];

    this.player.head.getWorldPosition(_head);
    // Head, chest and pelvis spheres — the SAME three IK volumes (and radii)
    // the arena solves, so dodging plays identically.
    const spheres: [Vector3, number, number][] = [
      [_head, BODY_IK.headRadius, FIREBALL.headDamage],
      [this.myChest, BODY_IK.chestRadius, FIREBALL.damage],
      [this.myPelvis, BODY_IK.pelvisRadius, FIREBALL.damage],
    ];

    // A foe's split shards passing through me on their way home — each lands one
    // recall-through hit for its share of the damage (no main ball to spend).
    const shards = oppId ? this.remoteShards.get(oppId) : undefined;
    if (shards) {
      for (const g of shards) {
        if (g.hitCooldown > 0) continue;
        for (const [centre, radius, baseDamage] of spheres) {
          if (g.pos.distanceTo(centre) <= radius + FIREBALL.radius * ATTACH.splitSize) {
            g.hitCooldown = 0.8;
            const damage = Math.max(1, Math.round(baseDamage / ATTACH.splitCount));
            this.myHp = Math.max(0, this.myHp - damage);
            spawnFireImpact(this.world, g.pos, 1, 1.2);
            sfx.hitTaken();
            pulseHand(this.world.session, 'left', 0.8, 120);
            pulseHand(this.world.session, 'right', 0.8, 120);
            pubSendEvent({ e: 'FIGHT_HP', hp: this.myHp });
            break;
          }
        }
      }
    }

    const balls = oppId ? this.remoteBalls.get(oppId) : undefined;
    if (!balls) return;

    for (const idx of [0, 1] as const) {
      const enemy = balls[idx];
      const returning = enemy.state === RETURNING;
      if (enemy.state !== FLYING && !returning) continue;
      if (!enemy.hasTarget || enemy.hitCooldown > 0) continue;
      // One connect per return leg — a return-pass that already landed is inert.
      if (returning && enemy.returnHit === 1) continue;
      const ePos = enemy.visual.group.position;

      // Clash: my thrown ball meeting theirs cancels both (flying-vs-flying;
      // a returning ball is already leaving).
      if (!returning && this.tryClash(enemy, idx, ePos)) continue;

      // Parry: my orbiting/returning ball knocks it out of the air.
      if (this.tryParry(enemy, idx, ePos)) continue;

      // Body: head/chest/pelvis. A grow/shrink ball is bigger/smaller to clip,
      // and its loadout damage scale rides along (grow hits softer, shrink harder).
      for (const [centre, radius, baseDamage] of spheres) {
        if (ePos.distanceTo(centre) <= radius + FIREBALL.radius * enemy.scl) {
          const damage = Math.round(baseDamage * enemy.dmgScale);
          enemy.hitCooldown = 0.8;
          this.myHp = Math.max(0, this.myHp - damage);
          // Taking a hit is the loudest moment: oversized fiery burst, hard
          // double-hand buzz (arena's spawnFireImpact at 1.7). The damage NUMBER
          // belongs to the ATTACKER — they spawn it via their FIGHT_HIT handler
          // — so we don't pop one up on ourselves.
          spawnFireImpact(this.world, ePos, 1, 1.7);
          sfx.hitTaken();
          pulseHand(this.world.session, 'left', 1, 160);
          pulseHand(this.world.session, 'right', 1, 160);
          // A return-pass keeps homing home; a thrown ball is spent on contact.
          if (returning) {
            enemy.returnHit = 1;
            pubSendEvent({ e: 'FIGHT_HIT', ball: idx, dmg: damage, ret: true });
          } else {
            enemy.state = DEAD;
            pubSendEvent({ e: 'FIGHT_HIT', ball: idx, dmg: damage });
          }
          pubSendEvent({ e: 'FIGHT_HP', hp: this.myHp });
          break;
        }
      }
    }
  }

  /** My orbiting/returning ball slaps an incoming enemy ball from the air. */
  private tryParry(enemy: RemoteBall, idx: 0 | 1, ePos: Vector3): boolean {
    if (!this.myBalls) return false;
    for (const hand of [0, 1] as const) {
      const mine = this.myBalls[hand];
      if (mine.state !== ORBIT && mine.state !== RETURNING) continue;
      const reach = FIREBALL.radius * (mine.scl + enemy.scl) + FIREBALL.deflectBonus;
      if (mine.pos.distanceTo(ePos) > reach) continue;
      enemy.hitCooldown = 0.6;
      enemy.state = DEAD;
      emberBurst(ePos, 22, true);
      spawnFireImpact(this.world, ePos, 1);
      sfx.deflect();
      pulseHand(this.world.session, HANDS[hand], 0.9, 120);
      pubSendEvent({ e: 'FIGHT_DEFLECT', ball: idx });
      return true;
    }
    return false;
  }

  /** Two thrown balls (one mine, one theirs) meeting mid-air block each other. */
  private tryClash(enemy: RemoteBall, idx: 0 | 1, ePos: Vector3): boolean {
    if (!this.myBalls) return false;
    for (const mine of this.myBalls) {
      if (mine.state !== FLYING) continue;
      const reach = FIREBALL.radius * (mine.scl + enemy.scl) + FIREBALL.deflectBonus;
      if (mine.pos.distanceTo(ePos) > reach) continue;
      // Both balls die where they met — iron on iron, sparks in both colours.
      this.spendLocalBall(mine);
      enemy.hitCooldown = 0.6;
      enemy.state = DEAD;
      emberBurst(ePos, 14, true);
      emberBurst(ePos, 14, false);
      spawnFireImpact(this.world, ePos, 0, 1.2);
      sfx.ballClash();
      // Their copy of MY ball dies via my stream; tell them THEIR ball clashed.
      pubSendEvent({ e: 'FIGHT_CLASH', ball: idx });
      return true;
    }
    return false;
  }

  // --- streaming + remote rendering -------------------------------------------------

  private streamBalls(delta: number): void {
    if (!pub.online || !this.myBalls) return;
    this.streamTimer += delta;
    if (this.streamTimer < STREAM_INTERVAL) return;
    this.streamTimer = 0;
    const pack = (b: LocalBall): FireballNet => [b.pos.x, b.pos.y, b.pos.z, b.state, b.scl, b.dmgScale];
    const shards = this.myShards.length
      ? this.myShards.map((s) => [s.pos.x, s.pos.y, s.pos.z] as [number, number, number])
      : undefined;
    pubSendEvent({ e: 'FIGHT_FB', balls: [pack(this.myBalls[0]), pack(this.myBalls[1])], shards });
  }

  private onRemoteBalls(from: string, balls: [FireballNet, FireballNet], shards?: [number, number, number][]): void {
    if (from === pub.myId) return;
    this.syncRemoteShards(from, shards);
    let rec = this.remoteBalls.get(from);
    if (!rec) {
      const team = this.teamFor(from);
      const mk = (): RemoteBall => {
        const visual = createFireVisual(team);
        this.scene.add(visual.group);
        return {
          visual,
          target: new Vector3(),
          state: HOVER,
          heat: 0.8,
          trailAcc: 0,
          hitCooldown: 0,
          returnHit: 0,
          hasTarget: false,
          scl: 1,
          dmgScale: 1,
          blend: 0,
        };
      };
      rec = [mk(), mk()];
      this.remoteBalls.set(from, rec);
    }
    for (const idx of [0, 1] as const) {
      const [x, y, z, state, scl, dmg] = balls[idx];
      const prev = rec[idx].state;
      rec[idx].target.set(x, y, z);
      // The owner's ball-loadout size + damage scale (default 1 for a plain ball).
      rec[idx].scl = typeof scl === 'number' ? scl : 1;
      rec[idx].dmgScale = typeof dmg === 'number' ? dmg : 1;
      rec[idx].visual.group.scale.setScalar(rec[idx].scl);
      if (!rec[idx].hasTarget) {
        rec[idx].visual.group.position.set(x, y, z);
        rec[idx].hasTarget = true;
      }
      // Don't resurrect a ball we already ruled dead (hit/parry/clash) until the
      // owner's stream agrees it's back in play.
      if (!(prev === DEAD && state === FLYING && rec[idx].hitCooldown > 0)) {
        rec[idx].state = state;
      }
      // Fresh throw: open the throw-blend window so the launch eases onto the
      // owner's line instead of snapping (~3/throwBlend ≈ 0.35 s to settle).
      if (rec[idx].state === FLYING && prev !== FLYING) rec[idx].blend = 0.35;
      // A fresh return leg re-arms the recall-through hit.
      if (rec[idx].state === RETURNING && prev !== RETURNING) rec[idx].returnHit = 0;
    }
  }

  private dropRemote(id: string): void {
    this.dropRemoteShards(id);
    const balls = this.remoteBalls.get(id);
    if (!balls) return;
    for (const b of balls) {
      this.scene.remove(b.visual.group);
      b.visual.dispose();
    }
    this.remoteBalls.delete(id);
  }

  /** Reconcile a foe's streamed split shards with our ghost copies (the fan we
   *  render + hit-check). No shards on the wire → none on the floor. */
  private syncRemoteShards(from: string, shards?: [number, number, number][]): void {
    if (from === pub.myId) return;
    if (!shards || !shards.length) {
      this.dropRemoteShards(from);
      return;
    }
    let list = this.remoteShards.get(from);
    if (!list) {
      list = [];
      this.remoteShards.set(from, list);
    }
    const team = this.teamFor(from);
    while (list.length < shards.length) {
      const visual = createFireVisual(team);
      visual.group.scale.setScalar(ATTACH.splitSize);
      this.scene.add(visual.group);
      list.push({ visual, pos: new Vector3(), heat: 0.8, trailAcc: 0, hitCooldown: 0 });
    }
    while (list.length > shards.length) {
      const g = list.pop()!;
      this.scene.remove(g.visual.group);
      g.visual.dispose();
    }
    for (let i = 0; i < shards.length; i++) {
      list[i].pos.set(shards[i][0], shards[i][1], shards[i][2]);
    }
  }

  /** Shared heat/trail/ember styling for any ball, local or streamed. */
  private driveFireLook(
    visual: FireVisual,
    pos: Vector3,
    state: number,
    rec: { heat: number; trailAcc: number },
    delta: number,
    cool: boolean,
  ): void {
    const target =
      state === ORBIT ? 1.45 : state === FLYING ? 1.25 : state === RETURNING ? 1.35 : state === DEAD ? 0.18 : 0.8;
    rec.heat += (target - rec.heat) * Math.min(1, delta * 6);
    visual.update(this.time, rec.heat, _camQ);

    if (state === FLYING || state === RETURNING) {
      rec.trailAcc += delta;
      // Dense stamp (arena cadence) so the fat core particles overlap into one
      // thick molten rope.
      if (rec.trailAcc >= 0.009) {
        rec.trailAcc = 0;
        stampTrail(pos, cool);
      }
    } else if (state === ORBIT) {
      rec.trailAcc += delta;
      if (rec.trailAcc >= 0.09) {
        rec.trailAcc = 0;
        spawnEmber(pos, 0.5, cool);
      }
    }
  }

  // --- panels -------------------------------------------------------------------------

  private nameOf(id: string | null): string {
    if (!id) return '—';
    if (id === pub.myId) return pub.myName || 'YOU';
    return pub.punters.get(id)?.name ?? '???';
  }

  private renderConsoles(): void {
    const refs = pub.refs;
    if (!refs) return;
    const f = pub.fight;
    const betsOpen = f.round === 1 && (f.phase === 'starting' || f.phase === 'fighting');
    for (const side of [0, 1] as const) {
      const holder = f.sides[side];
      const corner = side === 0 ? 'EMBER CORNER' : 'BLUE CORNER';
      const colour = side === 0 ? '#ff7a18' : '#4fb7ff';
      const stake = this.bets[side];
      const lit = pub.coinHover === `bet${side}`;
      const canBet = betsOpen && !this.amFighter();

      // Redraw guard: only re-paint the canvas when something visible changed.
      const key = `${pub.online ? 1 : 0}|${holder ?? ''}|${f.phase}|${f.round}|${f.winner ?? ''}|${stake}|${lit ? 1 : 0}|${canBet ? 1 : 0}|${holder === pub.myId ? 1 : 0}`;
      if (key === this.consoleKey[side]) continue;
      this.consoleKey[side] = key;

      const lines: import('../panel.js').PanelLine[] = [{ text: corner, size: 40, colour, bold: true }];
      if (!pub.online) {
        lines.push({ text: 'SERVER OFFLINE', size: 28, colour: '#e8352a' });
      } else if (!holder) {
        if (f.phase === 'idle') {
          lines.push({ text: 'PULL TRIGGER', size: 28, colour: '#ffb000', bold: true });
          lines.push({ text: 'TO TAKE THIS CORNER', size: 20, colour: '#9aa3b2' });
        } else {
          lines.push({ text: 'EMPTY CORNER', size: 24, colour: '#9aa3b2' });
        }
      } else {
        lines.push({ text: this.nameOf(holder).toUpperCase(), size: 32, colour: '#e8ecf2', bold: true });
        if (holder === pub.myId && f.phase === 'idle') {
          lines.push({ text: 'TRIGGER TO STEP DOWN', size: 20, colour: '#9aa3b2' });
        } else if (canBet) {
          // Round-one books are open — feed a coin to back this fighter.
          lines.push({
            text: lit ? 'DROP COIN TO BET' : 'INSERT COIN TO BET',
            size: 22,
            colour: lit ? '#ffd54a' : '#ffb000',
            bold: true,
          });
          lines.push({
            text: stake > 0 ? `YOUR BET ${stake} · PAYS 2X` : 'WINNER PAYS 2X',
            size: 18,
            colour: '#9aa3b2',
          });
        } else if (f.phase === 'over' && stake > 0) {
          const won = f.winner === holder;
          lines.push({
            text: won ? `BET WON +${stake * 2}` : 'BET LOST',
            size: 24,
            colour: won ? '#39d98a' : '#e8352a',
            bold: true,
          });
        } else if (stake > 0) {
          lines.push({ text: `YOUR BET: ${stake}`, size: 20, colour: '#ffd54a' });
          lines.push({ text: 'BETS CLOSED', size: 18, colour: '#9aa3b2' });
        } else if (f.phase !== 'idle') {
          lines.push({ text: 'BOUT IN PROGRESS', size: 22, colour: '#9aa3b2' });
        }
      }
      refs.consolePanels[side].setLines(lines);
    }
  }

  // --- floating match card (arena-style, above the opponent) ------------------

  /**
   * Hang the match UI above and behind the OPPONENT's platform, facing me —
   * names, health bars, round-win pips and the clock, just like a quick match.
   * Only the two fighters get it; spectators read the wall scoreboards.
   */
  private updateMatchBoard(): void {
    const side = this.mySide();
    const f = pub.fight;
    const show =
      side !== -1 &&
      pub.online &&
      (f.phase === 'starting' || f.phase === 'fighting' || f.phase === 'roundOver' || f.phase === 'over');

    if (!show) {
      if (this.matchBoard) this.matchBoard.mesh.visible = false;
      return;
    }

    if (!this.matchBoard) {
      // Wide plate echoing quick match's layout: YOU (left) + clock + RIVAL
      // (right) side by side, hung behind the opponent.
      this.matchBoard = new Panel(3.4, 1.05);
      this.scene.add(this.matchBoard.mesh);
      this.boardSide = -1;
    }
    this.matchBoard.mesh.visible = true;

    // Position once per side: above + behind the opponent's platform, facing me.
    if (this.boardSide !== side) {
      this.boardSide = side;
      const oppZ = side === 0 ? -FIGHT.platformZ : FIGHT.platformZ;
      const behindZ = oppZ + Math.sign(oppZ) * 1.1;
      this.matchBoard.mesh.position.set(FIGHT.centerX, 1.95, behindZ);
      this.matchBoard.mesh.rotation.y = side === 0 ? 0 : Math.PI; // face the fighter
      this.boardKey = ''; // force a redraw at the new station
    }

    this.drawMatchBoard(side);
  }

  private drawMatchBoard(side: 0 | 1): void {
    const board = this.matchBoard;
    if (!board) return;
    const f = pub.fight;
    const opp = side === 0 ? 1 : 0;
    const myName = this.nameOf(pub.myId);
    const oppName = this.nameOf(f.sides[opp]);
    const myHp = Math.max(0, f.hp[side]) / FIGHT.hpMax;
    const oppHp = Math.max(0, f.hp[opp]) / FIGHT.hpMax;
    const counting = f.phase === 'starting';
    const secs = Math.max(0, Math.ceil(this.roundClock));
    // During the 3-2-1 the headline IS the count and the clock shows the round.
    const clk = counting
      ? `R${f.round}`
      : `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
    const headline = counting
      ? secs > 0
        ? `${secs}`
        : 'FIGHT'
      : f.phase === 'fighting'
        ? 'FIGHT'
        : f.phase === 'roundOver'
          ? !f.winner
            ? 'DRAW'
            : f.winner === pub.myId
            ? 'WIN'
            : 'LOSS'
          : f.winner === pub.myId
            ? 'YOU WIN'
            : 'YOU LOSE';

    // Skip the canvas redraw + GPU upload when nothing visible changed.
    const key = `${myName}|${oppName}|${f.hp[side]}|${f.hp[opp]}|${f.score[side]}|${f.score[opp]}|${clk}|${headline}`;
    if (key === this.boardKey) return;
    this.boardKey = key;

    const headlineColour =
      f.phase === 'fighting' ? UI.danger
      : f.phase === 'starting' ? UI.cool // 3-2-1 countdown in neon blue
      : !f.winner ? UI.amber
      : f.winner === pub.myId ? UI.emberBright
      : UI.cool;

    // Painted on a TRANSPARENT canvas in quick match's layout: two flanking
    // boards — YOU (ember, left) and RIVAL (blue, right) — with the round clock
    // and the verdict headline between them.
    board.drawBare((ctx, w, h) => {
      ctx.textBaseline = 'middle';

      // The two flanking fighter boards: name + chamfered round pips + a
      // segmented health bar, each on its own chamfered plate (the arena's pair).
      const boardW = w * 0.36;
      const boardY = h * 0.2;
      const boardH = h * 0.66;
      const cols: [number, string, string, number, number, 'left' | 'right'][] = [
        [w * 0.02, myName, UI.emberBright, myHp, f.score[side], 'left'],
        [w * 0.62, oppName, UI.cool, oppHp, f.score[opp], 'right'],
      ];
      for (const [x, name, colour, hp, pips] of cols) {
        plate(ctx, x, boardY, boardW, boardH, { cut: 26, fill: UI.ink, stroke: UI.steel, rivets: false });
        ctx.textAlign = 'left';
        ctx.font = stencilFont(44);
        ctx.fillStyle = colour;
        ctx.fillText(name.toUpperCase().slice(0, 12), x + 28, boardY + 56);
        this.drawPips(ctx, x + boardW - 26, boardY + 52, pips, colour);
        solidBar(ctx, x + 28, boardY + 92, boardW - 56, 58, hp, colour);
      }

      // Centre column: the verdict headline above a big round clock on its own
      // plate, tinted to the moment.
      const cx = w * 0.5;
      ctx.textAlign = 'center';
      const headlinePx = fitStencilText(ctx, headline, w * 0.22, 64, 40);
      metalText(ctx, headline, cx, h * 0.22, headlinePx, headlineColour, 'center');
      const tW = w * 0.2;
      const tH = h * 0.42;
      const tX = cx - tW / 2;
      const tY = h * 0.44;
      plate(ctx, tX, tY, tW, tH, { cut: 20, fill: UI.ink, stroke: headlineColour, rivets: false });
      ctx.font = stencilFont(64);
      ctx.fillStyle = UI.text;
      ctx.fillText(clk, cx, tY + tH / 2);
    });
  }

  /** Round-win pips as chamfered studs, ending at rightX (arena scoreboard
   *  language): filled + glowing once taken, hollow steel otherwise. */
  private drawPips(ctx: CanvasRenderingContext2D, rightX: number, y: number, won: number, colour: string): void {
    const n = FIGHT.winTarget;
    const gap = 52;
    for (let i = 0; i < n; i++) {
      const px = rightX - (n - 1 - i) * gap;
      ctx.save();
      ctx.translate(px, y);
      ctx.rotate(Math.PI / 4);
      if (i < won) {
        ctx.fillStyle = colour;
        ctx.shadowColor = colour;
        ctx.shadowBlur = 12;
        ctx.fillRect(-13, -13, 26, 26);
        ctx.shadowBlur = 0;
      } else {
        ctx.lineWidth = 3;
        ctx.strokeStyle = UI.steelDim;
        ctx.strokeRect(-13, -13, 26, 26);
      }
      ctx.restore();
    }
  }

  private renderDisplay(): void {
    // Both scoreboards (far wall + above the door) show the same thing — the
    // IRON BALLS sign hangs above each as its own image, so no title here,
    // just the two health bars and the status line, laid out by fraction so
    // it fits whatever panel height it's drawn on.
    for (const panel of [pub.refs?.fightDisplay, pub.refs?.fightDisplay2]) {
      if (panel) this.drawBoard(panel);
    }
  }

  private drawBoard(panel: import('../panel.js').Panel): void {
    const f = pub.fight;
    panel.draw((ctx, w, h) => {
      const names = [this.nameOf(f.sides[0]), this.nameOf(f.sides[1])];
      const colours = ['#ff7a18', '#4fb7ff'];
      const barW = w * 0.4;
      const nameY = h * 0.28;
      const barY = h * 0.38;
      const barH = h * 0.2;
      for (const side of [0, 1] as const) {
        const x = side === 0 ? w * 0.05 : w * 0.55;
        ctx.textAlign = side === 0 ? 'left' : 'right';
        ctx.font = `900 ${Math.round(h * 0.14)}px "Arial Black", system-ui, sans-serif`;
        ctx.fillStyle = colours[side];
        ctx.fillText(names[side].toUpperCase().slice(0, 12), side === 0 ? x : x + barW, nameY);
        ctx.fillStyle = 'rgba(172,182,198,0.25)';
        ctx.fillRect(x, barY, barW, barH);
        const hp = Math.max(0, f.hp[side]) / FIGHT.hpMax;
        ctx.fillStyle = colours[side];
        const fillW = barW * hp;
        ctx.fillRect(side === 0 ? x : x + barW - fillW, barY, fillW, barH);
        ctx.strokeStyle = 'rgba(232,236,242,0.6)';
        ctx.lineWidth = 3;
        ctx.strokeRect(x, barY, barW, barH);
      }

      // Round/score line between the bars (best of 5, first to FIGHT.winTarget).
      if (f.phase !== 'idle') {
        ctx.textAlign = 'center';
        ctx.font = `800 ${Math.round(h * 0.12)}px "Arial Black", system-ui, sans-serif`;
        ctx.fillStyle = '#e8ecf2';
        ctx.fillText(`${f.score[0]}–${f.score[1]}`, w / 2, nameY + h * 0.02);
        ctx.font = `700 ${Math.round(h * 0.07)}px "Arial Narrow", system-ui, sans-serif`;
        ctx.fillStyle = '#9aa3b2';
        ctx.fillText(`ROUND ${f.round} · BEST OF ${FIGHT.winTarget * 2 - 1}`, w / 2, barY + barH + h * 0.1);
      }

      ctx.textAlign = 'center';
      const winnerSide = f.sides[1] === f.winner ? 1 : 0;
      const winnerName = this.nameOf(f.winner).toUpperCase().slice(0, 10);
      const count = Math.max(0, Math.ceil(f.roundTimer)); // the pre-round 3-2-1
      const status =
        f.phase === 'idle'
          ? 'OPEN'
          : f.phase === 'starting'
            ? count > 0
              ? `${count}`
              : 'FIGHT'
            : f.phase === 'fighting'
              ? 'FIGHT'
              : f.phase === 'roundOver'
                ? f.winner
                  ? `${winnerName} KO`
                  : 'DRAW'
                : `${winnerName} WINS`;
      const statusAccent =
        f.phase === 'fighting' ? UI.danger
        : f.phase === 'starting' ? UI.cool // 3-2-1 countdown in neon blue
        : f.phase === 'idle' ? UI.coolBright
        : !f.winner ? UI.amber
        : colours[winnerSide];
      const statusPx = fitStencilText(ctx, status, w * 0.9, Math.round(h * 0.2), 28);
      metalText(ctx, status, w / 2, h * 0.82, statusPx, statusAccent);
    });
  }
}
