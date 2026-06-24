/**
 * Arcade (2v2 / FFA) online bouts over the WebRTC mesh (see net/mesh.ts).
 * Mirrors what NetworkSystem does for the duel, but for up to three other
 * fighters at once and against the mesh instead of the 1v1 client — so the
 * classic NetworkSystem path stays untouched.
 *
 *  - While a room is still filling, the bout runs locally vs bots; once every
 *    seat is a human this flips the bout to 'net'.
 *  - OUT: my pose (head + hands + flags + hp) is broadcast to every peer,
 *    stamped with my seat. Throw/recall/hit events ride the same mesh.
 *  - IN: each peer's pose is placed onto its opponent-bus slot via the
 *    seat-relative transforms (combat/layout.ts); their throws/recalls become
 *    ball commands; a `hit` I caused spends my ball.
 *  - The HOST (seat 0) runs the match authority in GameStateSystem and echoes
 *    an `astate`; guests apply it.
 *
 * Built without a live multi-client rig: it type-checks/builds but needs real
 * peers to validate and tune. Never runs for the duel or bot bouts.
 */

import { createSystem, InputComponent, Quaternion, Vector3, type Entity } from '@iwsdk/core';
import { Combatant } from '../components/Combatant.js';
import { Health } from '../components/Health.js';
import { BallState, Fireball } from '../components/Fireball.js';
import { ballCommands, opponents, MAX_OPPONENTS } from '../combat/opponentBus.js';
import { localIndexOf, localLayout, peerPos, peerQuat, peerVel } from '../combat/layout.js';
import { match } from '../combat/matchState.js';
import { app, saveStats } from '../menu/appState.js';
import { mesh } from '../net/mesh.js';
import { packPose } from '../net/client.js';
import { attachMeshVoice, detachAllMeshVoice, detachMeshVoice, setMeshSpeaker, updateListener } from '../net/voice.js';
import { reportArcade } from '../net/leaderboard.js';
import type { PeerMessage, PoseTuple } from '../net/protocol.js';
import { spawnDamagePopup, spawnFireImpact } from '../fx/effects.js';
import * as sfx from '../audio/sfx.js';
import { FIREBALL, MODE_LAYOUT, NET } from '../config.js';

const HANDS = ['left', 'right'] as const;
const _p = new Vector3();
const _q = new Quaternion();
const _v = new Vector3();

interface PoseTarget {
  fresh: boolean;
  headPos: Vector3;
  headQuat: Quaternion;
  handPos: [Vector3, Vector3];
  handQuat: [Quaternion, Quaternion];
}

function makeTarget(): PoseTarget {
  return {
    fresh: false,
    headPos: new Vector3(),
    headQuat: new Quaternion(),
    handPos: [new Vector3(), new Vector3()],
    handQuat: [new Quaternion(), new Quaternion()],
  };
}

export class MeshSystem extends createSystem({
  combatants: { required: [Combatant, Health] },
  balls: { required: [Fireball] },
}) {
  private targets: PoseTarget[] = Array.from({ length: MAX_OPPONENTS }, makeTarget);
  private sendTimer = 0;
  private stateTimer = 0;
  private lastReset = -1;
  private guestOverTimer = 0;
  /** Host: seconds a short-handed FFA (3 players) has waited for a 4th. */
  private ffaGraceTimer = 0;
  /** Seats whose spatial voice we've hooked up this bout. */
  private voiced = new Set<number>();

  update(delta: number): void {
    // The duel is NetworkSystem's job; the mesh only ever runs the brawls.
    if (app.arcade === '1v1') {
      this.clearVoice();
      return;
    }

    if (app.state !== 'playing') {
      if (mesh.inbox.length) mesh.inbox.length = 0;
      this.clearVoice();
      return;
    }

    if (app.mode === 'bot') {
      // Still playing the local bot bout while the room fills. Drop any chatter
      // so it can't pile up, and flip to the live bout once it's ready:
      //  - 2v2 waits for a FULL room (4 humans) — until then you fight bots;
      //  - FFA starts at FULL, or the host locks it 10 s after a 3rd arrives,
      //    leaving that window for a 4th. The live bout is all-humans; any
      //    unfilled FFA seat just sits empty (see applyRoster).
      if (mesh.inbox.length) mesh.inbox.length = 0;
      this.clearVoice(); // voice only plays in the live bout, not while filling
      if (mesh.joined) {
        const humans = mesh.occupants.filter(Boolean).length;
        if (mesh.isHost() && app.arcade === 'ffa' && !mesh.locked && humans >= 3 && humans < mesh.capacity) {
          this.ffaGraceTimer += delta;
          if (this.ffaGraceTimer >= 10) mesh.lock();
        } else {
          this.ffaGraceTimer = 0;
        }
        const enough = app.arcade === '2v2' ? humans >= mesh.capacity : humans >= 3;
        if (mesh.locked && enough) {
          app.mode = 'net';
          app.side = mesh.isHost() ? 0 : 1;
          app.mySlot = mesh.mySeat;
          this.lastReset = -1;
        }
      }
      return;
    }

    // app.mode === 'net' (a live mesh bout).
    if (!mesh.joined) {
      // The mesh fell out from under us — drop back to bots.
      app.mode = 'bot';
      app.side = 0;
      app.mySlot = 0;
      this.clearVoice();
      return;
    }
    app.side = mesh.isHost() ? 0 : 1;

    this.receive();
    this.smooth(delta);
    this.sendPose(delta);
    this.updateVoice();
    if (mesh.isHost()) this.echoState(delta);
    else this.guestTimers(delta);
  }

  /** Spatial voice: listener on the camera, each peer pinned to their head. */
  private updateVoice(): void {
    this.world.camera.getWorldPosition(_p);
    this.world.camera.getWorldQuaternion(_q);
    updateListener(_p, _q);
    for (const [seat, stream] of mesh.voice) {
      if (!this.voiced.has(seat)) {
        attachMeshVoice(seat, stream);
        this.voiced.add(seat);
      }
      const li = localIndexOf(seat);
      if (li > 0) setMeshSpeaker(seat, opponents[li - 1].headPos);
    }
    for (const seat of [...this.voiced]) {
      if (!mesh.voice.has(seat)) {
        detachMeshVoice(seat);
        this.voiced.delete(seat);
      }
    }
  }

  private clearVoice(): void {
    if (this.voiced.size === 0) return;
    detachAllMeshVoice();
    this.voiced.clear();
  }

  // --- outgoing ------------------------------------------------------------

  private sendPose(delta: number): void {
    this.sendTimer -= delta;
    if (this.sendTimer > 0) return;
    this.sendTimer = 1 / NET.poseRateHz;

    const head = this.playerHeadEntity?.object3D;
    if (!head) return;
    head.getWorldPosition(_p);
    head.getWorldQuaternion(_q);
    const headPose = packPose(_p, _q);

    const hands: [PoseTuple, PoseTuple] = [headPose, headPose];
    const orbit: [boolean, boolean] = [false, false];
    const fist: [boolean, boolean] = [false, false];
    for (const hand of [0, 1] as const) {
      const grip = this.world.playerSpaceEntities.gripSpaces[HANDS[hand]]?.object3D;
      const ray = this.world.playerSpaceEntities.raySpaces[HANDS[hand]]?.object3D;
      if (grip) {
        grip.getWorldPosition(_p);
        (ray ?? grip).getWorldQuaternion(_q);
        hands[hand] = packPose(_p, _q);
      }
      const gp = this.input.xr.gamepads[HANDS[hand]];
      orbit[hand] =
        (gp?.getButtonPressed(InputComponent.Trigger) ?? false) ||
        (gp?.getButtonPressed(InputComponent.Squeeze) ?? false);
      fist[hand] =
        (gp?.getButtonPressed(InputComponent.Squeeze) ?? false) &&
        (gp?.getButtonPressed(InputComponent.Trigger) ?? false);
    }

    mesh.send({ k: 'pose', head: headPose, left: hands[0], right: hands[1], orbit, fist, hp: this.myHp(), acc: app.accentHue, acl: app.accentLight });
  }

  /** HOST → guests: the authoritative match state on a cadence + on resets. */
  private echoState(delta: number): void {
    this.stateTimer -= delta;
    const resetChanged = match.resetCount !== this.lastReset;
    if (this.stateTimer > 0 && !resetChanged) return;
    this.stateTimer = 0.4;
    this.lastReset = match.resetCount;
    mesh.send({
      k: 'astate',
      phase: match.phase,
      round: match.round,
      scores: match.teamScores.slice(),
      win: match.roundWinnerTeam,
      timer: match.roundTimer,
      reset: match.resetCount,
    });
  }

  // --- incoming ------------------------------------------------------------

  private receive(): void {
    for (const { seat, msg } of mesh.inbox.splice(0)) this.apply(seat, msg);
  }

  private apply(seat: number, msg: PeerMessage): void {
    if (msg.k === 'astate') {
      if (!mesh.isHost()) this.applyHostState(msg);
      return;
    }

    const localIdx = localIndexOf(seat);
    if (localIdx <= 0) return; // me, or a seat I don't know yet
    const oppIdx = localIdx - 1;
    const pose = opponents[oppIdx];

    switch (msg.k) {
      case 'pose': {
        const t = this.targets[oppIdx];
        peerPos(t.headPos, seat, msg.head[0], msg.head[1], msg.head[2]);
        peerQuat(t.headQuat, seat, msg.head[3], msg.head[4], msg.head[5], msg.head[6]);
        peerPos(t.handPos[0], seat, msg.left[0], msg.left[1], msg.left[2]);
        peerQuat(t.handQuat[0], seat, msg.left[3], msg.left[4], msg.left[5], msg.left[6]);
        peerPos(t.handPos[1], seat, msg.right[0], msg.right[1], msg.right[2]);
        peerQuat(t.handQuat[1], seat, msg.right[3], msg.right[4], msg.right[5], msg.right[6]);
        pose.orbiting[0] = msg.orbit[0];
        pose.orbiting[1] = msg.orbit[1];
        pose.fisting[0] = msg.fist?.[0] ?? false;
        pose.fisting[1] = msg.fist?.[1] ?? false;
        if (typeof msg.acc === 'number') pose.accentHue = msg.acc;
        if (typeof msg.acl === 'number') pose.accentLight = msg.acl;
        this.setHp(localIdx, msg.hp);
        t.fresh = true;
        break;
      }
      case 'throw': {
        peerPos(_p, seat, msg.pos[0], msg.pos[1], msg.pos[2]);
        peerVel(_v, seat, msg.vel[0], msg.vel[1], msg.vel[2]);
        ballCommands.push({ type: 'throw', slot: oppIdx, hand: msg.hand, pos: _p.clone(), vel: _v.clone() });
        break;
      }
      case 'recall':
        ballCommands.push({ type: 'recall', slot: oppIdx, hand: msg.hand, att: msg.att, dmg: msg.dmg, scl: msg.scl });
        break;
      case 'hit': {
        // Their body reports my ball landed. Only the named attacker acts: burst
        // and spend my ball (their health is synced through their pose hp).
        if (msg.by !== mesh.mySeat || match.phase !== 'playing') break;
        const ball = this.findMyBall(msg.hand);
        if (ball?.object3D) {
          spawnFireImpact(this.world, ball.object3D.position, 0);
          spawnDamagePopup(this.world, ball.object3D.position, msg.dmg);
          if (!msg.ret) this.spendMyBall(ball);
        }
        sfx.hitDealt();
        app.stats.hitsLanded += 1;
        break;
      }
      default:
        break; // iam/gg/deflect/clash/rematch/state — not wired for the mesh yet
    }
  }

  /** Guest: adopt the host's authoritative arcade state. */
  private applyHostState(msg: Extract<PeerMessage, { k: 'astate' }>): void {
    const prevPhase = match.phase;
    match.phase = msg.phase;
    match.round = msg.round;
    match.roundTimer = msg.timer;
    match.resetCount = msg.reset;

    // Scores arrive by CANONICAL team; remap onto my LOCAL team labels for the HUD.
    const canonical = MODE_LAYOUT[app.arcade];
    const local = [0, 0, 0, 0];
    for (const slot of localLayout()) {
      const canonTeam = canonical[slot.canonical]?.team ?? 0;
      local[slot.team] = msg.scores[canonTeam] ?? 0;
    }
    match.teamScores = local;

    const myCanonTeam = canonical[app.mySlot]?.team ?? 0;
    if (msg.phase === 'countdown') {
      match.message = msg.timer <= 3 && msg.timer > 0 ? String(Math.ceil(msg.timer)) : '';
    } else if (msg.phase === 'playing') {
      match.message = prevPhase !== 'playing' ? 'FIGHT' : match.message === 'FIGHT' && msg.timer > 1.2 ? 'FIGHT' : '';
    } else if (msg.phase === 'roundOver') {
      match.message = msg.win < 0 ? 'DRAW' : msg.win === myCanonTeam ? 'WIN' : 'LOSS';
    } else {
      match.message = msg.win === myCanonTeam ? 'YOU WIN' : 'YOU LOSE';
    }

    if (msg.phase !== prevPhase) {
      if (msg.phase === 'playing') sfx.roundBell();
      else if (msg.phase === 'matchOver') {
        const win = msg.win === myCanonTeam;
        if (win) app.stats.wins += 1;
        else app.stats.losses += 1;
        saveStats();
        reportArcade(app.arcade, win); // guests bank their own +25 / win board
        sfx.matchEnd(win);
        this.guestOverTimer = 6;
      }
    }

    // Fresh round: restore every fighter's health locally.
    if (msg.reset !== this.lastReset) {
      this.lastReset = msg.reset;
      for (const e of this.queries.combatants.entities) {
        if ((e.getValue(Combatant, 'active') ?? 0) === 1) e.setValue(Health, 'current', e.getValue(Health, 'max') ?? 100);
      }
    }
  }

  /** Guests have no authority — bring them home a beat after FIGHT OVER. */
  private guestTimers(delta: number): void {
    if (match.phase !== 'matchOver' || this.guestOverTimer <= 0) return;
    this.guestOverTimer -= delta;
    if (this.guestOverTimer <= 0) {
      mesh.cancel();
      app.mode = 'bot';
      app.mySlot = 0;
      app.state = 'menu';
    }
  }

  // --- helpers -------------------------------------------------------------

  private smooth(delta: number): void {
    const k = Math.min(1, delta * NET.smoothing);
    for (let i = 0; i < MAX_OPPONENTS; i++) {
      const t = this.targets[i];
      if (!t.fresh) continue;
      const pose = opponents[i];
      pose.headPos.lerp(t.headPos, k);
      pose.headQuat.slerp(t.headQuat, k);
      for (const hand of [0, 1] as const) {
        pose.handPos[hand].lerp(t.handPos[hand], k);
        pose.handQuat[hand].slerp(t.handQuat[hand], k);
      }
    }
  }

  private myHp(): number {
    for (const e of this.queries.combatants.entities) {
      if ((e.getValue(Combatant, 'slot') ?? -1) === 0) return e.getValue(Health, 'current') ?? 100;
    }
    return 100;
  }

  private setHp(slot: number, hp: number): void {
    if (match.phase !== 'playing') return;
    for (const e of this.queries.combatants.entities) {
      if ((e.getValue(Combatant, 'slot') ?? -1) === slot) {
        e.setValue(Health, 'current', hp);
        return;
      }
    }
  }

  private findMyBall(hand: number): Entity | undefined {
    for (const e of this.queries.balls.entities) {
      if (
        (e.getValue(Fireball, 'owner') ?? 0) === 0 &&
        (e.getValue(Fireball, 'hand') ?? 0) === hand &&
        (e.getValue(Fireball, 'transient') ?? 0) === 0
      ) {
        return e;
      }
    }
    return undefined;
  }

  private spendMyBall(ball: Entity): void {
    ball.setValue(Fireball, 'state', BallState.Dead);
    ball.setValue(Fireball, 'recallLock', FIREBALL.recallLockout);
    const v = ball.getVectorView(Fireball, 'velocity');
    v[0] = 0;
    v[1] = 0;
    v[2] = 0;
  }
}
