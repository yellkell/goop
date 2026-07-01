/**
 * Online bouts. Pumps the relay client once per frame:
 *
 *  OUT — your pose (head + both hands + trigger flags + hp) at ~20 Hz.
 *        Throw/recall/hit/deflect events are sent at the moment they happen
 *        by FireballSystem / CollisionSystem.
 *
 *  IN  — drains the inbox and:
 *        - smooths the rival's mirrored pose onto the opponent bus,
 *        - queues their throw/recall as ball commands,
 *        - applies `hit` reports (their client ruled our ball landed — they
 *          are the authority on hits against themselves),
 *        - applies `deflect` reports (they parried our ball),
 *        - applies host `state` echoes when we are the guest.
 *
 * Coordinates arrive in the SENDER's space and are mirrored across the arena
 * here (see net/client.ts). All mutation happens in update() — never in a
 * socket callback — so the sim stays deterministic within a frame.
 */

import { createSystem, Quaternion, Vector3, type Entity } from '@iwsdk/core';
import { Combatant } from '../components/Combatant.js';
import { Health } from '../components/Health.js';
import { BallState, Fireball } from '../components/Fireball.js';
import { ballCommands, opponent } from '../combat/opponentBus.js';
import { match } from '../combat/matchState.js';
import { app, saveStats } from '../menu/appState.js';
import { mirrorPos, mirrorQuat, mirrorVel, net, packPose } from '../net/client.js';
import { myElo, myName, reportResult, rival } from '../net/leaderboard.js';
import { customization } from '../menu/customization.js';
import { setSpeakerPosition, updateListener } from '../net/voice.js';
import type { PeerMessage, PoseTuple } from '../net/protocol.js';
import { spawnDamagePopup, spawnFireImpact, spawnGestureCue, spawnPopup } from '../fx/effects.js';
import { fistBumpEchoSuppressed, markFistBumpShown } from './PlayerGestureSystem.js';
import * as sfx from '../audio/sfx.js';
import { playVictory, startBattleMusic } from '../audio/battleMusic.js';
import { InputComponent } from '@iwsdk/core';
import { FIREBALL, NET } from '../config.js';

const HANDS = ['left', 'right'] as const;

const _p = new Vector3();
const _q = new Quaternion();
const _v = new Vector3();

/** Pose targets we smooth toward (raw network poses jitter). */
const target = {
  fresh: false,
  headPos: new Vector3(),
  headQuat: new Quaternion(),
  handPos: [new Vector3(), new Vector3()] as [Vector3, Vector3],
  handQuat: [new Quaternion(), new Quaternion()] as [Quaternion, Quaternion],
};

export class NetworkSystem extends createSystem({
  combatants: { required: [Combatant, Health] },
  balls: { required: [Fireball] },
}) {
  private sendTimer = 0;
  private myHp = 100;
  /**
   * Grace window after every round reset during which the rival's reported
   * hp is IGNORED: packets sent before they processed the fresh-round echo
   * still carry the old knockout's 0 hp, and writing that back over the
   * restored pool made the host score the same knockout twice (and end
   * matches early).
   */
  private graceTimer = 0;
  private lastReset = -1;
  private sentIam = false;

  update(delta: number): void {
    // The duel only. Arcade 2v2/FFA online bouts are MeshSystem's job; this
    // path stays exactly as it was for 1v1.
    if (app.mode !== 'net' || app.state !== 'playing' || app.arcade !== '1v1') {
      // Still drain so stale packets never leak into the next bout.
      if (net.inbox.length) net.inbox.length = 0;
      this.sentIam = false;
      return;
    }

    // Introduce myself once per bout: callsign + hidden ELO (so whoever
    // wins can weight their leaderboard score by rival quality) + my skins.
    if (!this.sentIam) {
      this.sentIam = true;
      net.send({
        k: 'iam',
        name: myName(),
        elo: myElo(),
        av: customization.avatar,
        pf: customization.platform,
        avc: customization.colorHue,
        avl: customization.colorLight,
      });
    }

    if (match.resetCount !== this.lastReset) {
      this.lastReset = match.resetCount;
      this.graceTimer = 1.0;
    }
    this.graceTimer = Math.max(0, this.graceTimer - delta);

    this.receive();
    this.smooth(delta);
    this.sendPose(delta);

    // Directional voice: listener on your camera, their voice on their head.
    this.world.camera.getWorldPosition(_p);
    this.world.camera.getWorldQuaternion(_q);
    updateListener(_p, _q);
    setSpeakerPosition(opponent.headPos);
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
      // Fist position from the grip, orientation from the pointing ray — the
      // frame our own gloves are aimed in, so their mirror of us matches.
      const grip = this.world.playerSpaceEntities.gripSpaces[HANDS[hand]]?.object3D;
      const ray = this.world.playerSpaceEntities.raySpaces[HANDS[hand]]?.object3D;
      if (grip) {
        grip.getWorldPosition(_p);
        (ray ?? grip).getWorldQuaternion(_q);
        hands[hand] = packPose(_p, _q);
      }
      // Trigger and grip are one action; either squeeze lights us up for them.
      // A social fist bump is stricter: both must be held so ordinary orbit
      // holds do not accidentally advertise "GG me".
      const gp = this.input.xr.gamepads[HANDS[hand]];
      orbit[hand] =
        (gp?.getButtonPressed(InputComponent.Trigger) ?? false) ||
        (gp?.getButtonPressed(InputComponent.Squeeze) ?? false);
      fist[hand] =
        (gp?.getButtonPressed(InputComponent.Squeeze) ?? false) &&
        (gp?.getButtonPressed(InputComponent.Trigger) ?? false);
    }

    net.send({ k: 'pose', head: headPose, left: hands[0], right: hands[1], orbit, fist, hp: this.myHp, acc: app.accentHue, acl: app.accentLight });
  }

  // --- incoming ------------------------------------------------------------

  private receive(): void {
    for (const msg of net.inbox.splice(0)) this.apply(msg);
  }

  private apply(msg: PeerMessage): void {
    switch (msg.k) {
      case 'pose': {
        this.unpack(msg.head, target.headPos, target.headQuat);
        this.unpack(msg.left, target.handPos[0], target.handQuat[0]);
        this.unpack(msg.right, target.handPos[1], target.handQuat[1]);
        // Mirrored space swaps left/right visually but the indices stay
        // theirs — their flags map straight onto their balls.
        opponent.orbiting[0] = msg.orbit[0];
        opponent.orbiting[1] = msg.orbit[1];
        opponent.fisting[0] = msg.fist?.[0] ?? false;
        opponent.fisting[1] = msg.fist?.[1] ?? false;
        if (typeof msg.acc === 'number') opponent.accentHue = msg.acc;
        if (typeof msg.acl === 'number') opponent.accentLight = msg.acl;
        this.setTheirHp(msg.hp);
        target.fresh = true;
        break;
      }
      case 'throw': {
        mirrorPos(_p, msg.pos[0], msg.pos[1], msg.pos[2]);
        mirrorVel(_v, msg.vel[0], msg.vel[1], msg.vel[2]);
        // The curl axis is an angular velocity — under the 180° mirror it flips
        // the same way as a linear velocity (−x, y, −z).
        const curl =
          msg.curl && (msg.curl[0] || msg.curl[1] || msg.curl[2])
            ? mirrorVel(new Vector3(), msg.curl[0], msg.curl[1], msg.curl[2])
            : undefined;
        ballCommands.push({ type: 'throw', hand: msg.hand, pos: _p.clone(), vel: _v.clone(), curl });
        break;
      }
      case 'recall':
        ballCommands.push({ type: 'recall', hand: msg.hand, att: msg.att, dmg: msg.dmg, scl: msg.scl });
        break;
      case 'hit': {
        // Their client ruled our ball connected: damage them on our side and
        // burst the ball where our sim has it. A return-pass hit (`ret`)
        // doesn't spend the ball — it keeps homing back to our fist.
        // Hits in flight while the round ended are dropped: they must not
        // bleed into the next round's pool or re-score the old one.
        if (match.phase !== 'playing') break;
        this.damageThem(msg.dmg);
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
      case 'deflect': {
        // They parried our ball — but only honour it if our copy is STILL a
        // live threat (in flight or recalling). A stale report mustn't clap a
        // phantom block or, worse, kill a ball we've already caught into hand.
        const ball = this.findMyBall(msg.hand);
        const st = ball ? (ball.getValue(Fireball, 'state') ?? 0) : -1;
        if (ball?.object3D && (st === BallState.Flying || st === BallState.Returning)) {
          spawnFireImpact(this.world, ball.object3D.position, 1);
          this.spendMyBall(ball);
          sfx.deflect();
        }
        break;
      }
      case 'clash': {
        // Their sim ruled our two flying balls blocked each other. `yours`
        // is MY ball in their wording; `mine` is theirs. If my sim already
        // saw the clash itself both balls are dead — skip the echo quietly.
        const ball = this.findMyBall(msg.yours);
        if (ball?.object3D && (ball.getValue(Fireball, 'state') ?? 0) === BallState.Flying) {
          spawnFireImpact(this.world, ball.object3D.position, 0, 1.2);
          sfx.ballClash();
          this.spendMyBall(ball);
        }
        ballCommands.push({ type: 'spend', hand: msg.mine });
        break;
      }
      case 'gg': {
        // A mirrored fist bump we already caught ourselves — don't double-pop.
        if (msg.bump && fistBumpEchoSuppressed()) break;
        // The rival saluted/bumped us — pop their GG over their avatar's head.
        if (msg.bump) markFistBumpShown();
        _p.copy(opponent.headPos);
        _p.y += 0.32;
        spawnGestureCue(this.world, opponent.headPos, 0.3);
        spawnPopup(this.world, _p, 'GG', '#ffffff', 'rgba(255,255,255,0.95)', 2.2);
        sfx.fistBump();
        break;
      }
      case 'rematch':
        match.rematchTheirs = true;
        break;
      case 'iam':
        rival.name = msg.name;
        rival.elo = msg.elo;
        rival.avatarSkin = msg.av ?? '';
        rival.platformSkin = msg.pf ?? '';
        rival.avColor = typeof msg.avc === 'number' ? msg.avc : -1;
        rival.avLight = typeof msg.avl === 'number' ? msg.avl : 0.5;
        break;
      case 'state':
        if (app.side === 1) this.applyHostState(msg);
        break;
    }
  }

  /** Guest: adopt the host's match state (scores flipped to our view). */
  private applyHostState(msg: Extract<PeerMessage, { k: 'state' }>): void {
    const prevPhase = match.phase;
    const prevReset = match.resetCount;
    match.phase = msg.phase;
    match.round = msg.round;
    match.myScore = msg.guestScore;
    match.oppScore = msg.hostScore;
    match.roundTimer = msg.timer;
    match.resetCount = msg.reset;
    match.message = this.flipMessage(msg.msg);

    if (msg.phase !== prevPhase) {
      if (msg.phase === 'playing') sfx.roundBell();
      else if (msg.phase === 'roundOver') sfx.roundEnd(this.roundCue(match.message));
      else if (msg.phase === 'matchOver') {
        playVictory(); // guest side: stop the battle score, ring the sting too
        const win = match.myScore > match.oppScore;
        match.message = win ? 'YOU WIN' : 'YOU LOSE';
        if (win) app.stats.wins += 1;
        else app.stats.losses += 1;
        saveStats();
        reportResult(win, rival.elo); // guest-side leaderboard update
        sfx.matchEnd(win);
      }
    }

    // Fresh round on the guest: restore healths locally too, and clear any
    // rematch handshake (a rematch restart arrives as matchOver -> countdown).
    if (
      (msg.phase === 'countdown' && (prevPhase !== 'countdown' || msg.reset !== prevReset)) ||
      (msg.phase === 'playing' && prevPhase !== 'playing')
    ) {
      match.rematchMine = false;
      match.rematchTheirs = false;
      for (const e of this.queries.combatants.entities) {
        e.setValue(Health, 'current', e.getValue(Health, 'max') ?? 100);
      }
      // Restart the battle score. The guest never runs startMatch, so without
      // this a REMATCH (matchOver -> countdown) left the victory sting ringing
      // out and battle music never came back. startBattleMusic is idempotent:
      // it stops any sting and no-ops if the loop is already playing (a normal
      // between-rounds countdown), so this only truly restarts after a victory.
      if (!app.tutorial) startBattleMusic();
    }
  }

  /** Host messages are host-perspective; mirror the verdict for the guest. */
  private flipMessage(msg: string): string {
    switch (msg) {
      case 'KO': return "KO'D";
      case "KO'D": return 'KO';
      case 'WIN': return 'LOSS';
      case 'LOSS': return 'WIN';
      case 'DRAW': return 'DRAW';
      case 'YOU WIN': return 'YOU LOSE';
      case 'YOU LOSE': return 'YOU WIN';
      // Back-compat for any in-flight peers still running the old copy.
      case 'KNOCKOUT': return "KO'D";
      case 'KNOCKED OUT': return 'KO';
      case 'ROUND WON': return 'LOSS';
      case 'ROUND LOST': return 'WIN';
      case 'YOU WIN THE FIGHT': return 'YOU LOSE';
      default: return msg;
    }
  }

  private roundCue(message: string): boolean | 'draw' {
    if (message === 'DRAW') return 'draw';
    return message === 'KO' || message === 'WIN';
  }

  // --- helpers ---------------------------------------------------------------

  private smooth(delta: number): void {
    if (!target.fresh) return;
    const k = Math.min(1, delta * NET.smoothing);
    opponent.headPos.lerp(target.headPos, k);
    opponent.headQuat.slerp(target.headQuat, k);
    for (const hand of [0, 1] as const) {
      opponent.handPos[hand].lerp(target.handPos[hand], k);
      opponent.handQuat[hand].slerp(target.handQuat[hand], k);
    }
  }

  private unpack(t: PoseTuple, pos: Vector3, quat: Quaternion): void {
    mirrorPos(pos, t[0], t[1], t[2]);
    mirrorQuat(quat, t[3], t[4], t[5], t[6]);
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

  private damageThem(dmg: number): void {
    for (const e of this.queries.combatants.entities) {
      if ((e.getValue(Combatant, 'team') ?? 0) !== 1) continue;
      e.setValue(Health, 'current', Math.max(0, (e.getValue(Health, 'current') ?? 0) - dmg));
    }
  }

  private spendMyBall(ball: Entity): void {
    ball.setValue(Fireball, 'state', BallState.Dead);
    ball.setValue(Fireball, 'recallLock', FIREBALL.recallLockout);
    const v = ball.getVectorView(Fireball, 'velocity');
    v[0] = 0; v[1] = 0; v[2] = 0;
  }

  /** Track my hp for pose packets, and pin theirs from their reports. */
  private setTheirHp(theirReportedHp: number): void {
    for (const e of this.queries.combatants.entities) {
      const team = e.getValue(Combatant, 'team') ?? 0;
      if (team === 0) this.myHp = e.getValue(Health, 'current') ?? 100;
      // Their own hp report is authoritative for their pool (covers rim
      // damage and anything our sim can't see) — but NOT around round
      // transitions, where it's stale (see graceTimer).
      else if (match.phase === 'playing' && this.graceTimer <= 0) {
        e.setValue(Health, 'current', theirReportedHp);
      }
    }
  }
}
