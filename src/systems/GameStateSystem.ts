/**
 * Owns the match: round timer, scoring, win/lose and reset. Reads/writes the
 * shared `match` state and refreshes the scoreboards every frame.
 *
 * A round ends when a boxer's Health hits 0 (knockout) or the timer expires
 * (higher Health wins). First to MATCH.winTarget round wins takes the match.
 *
 * ONLINE: the HOST (side 0) is the sole authority — it runs exactly this
 * logic and echoes `state` packets; the GUEST applies those echoes instead
 * of deciding anything itself (NetworkSystem feeds them into `match`).
 */

import { createSystem, type Entity } from '@iwsdk/core';
import { Combatant } from '../components/Combatant.js';
import { Health } from '../components/Health.js';
import { match } from '../combat/matchState.js';
import { app, saveStats, training, type AppMode } from '../menu/appState.js';
import * as sfx from '../audio/sfx.js';
import { MATCH } from '../config.js';
import { createScoreboard, type Scoreboard } from '../ui/scoreboard.js';
import { net } from '../net/client.js';
import { reportBotResult, reportResult, rival } from '../net/leaderboard.js';

interface Boxers {
  me: Entity;
  them: Entity;
}

type RoundResult = 'ko' | 'time';
type RoundOutcome = 'win' | 'loss' | 'draw';

export class GameStateSystem extends createSystem({
  combatants: { required: [Combatant, Health] },
}) {
  private scoreboard?: Scoreboard;
  private wasPlaying = false;
  /** Which mode the live bout is running in — a change while playing means a
   *  real opponent just replaced the bot, so the match restarts clean. */
  private lastMode: AppMode = 'bot';
  private stateEchoTimer = 0;

  init(): void {
    this.scoreboard = createScoreboard(this.scene);
    this.scoreboard.setVisible(false);
  }

  update(delta: number): void {
    if (app.state === 'training') {
      // TrainingSystem runs the session; we just keep the boards fresh.
      const c = this.findBoxers();
      if (c) {
        this.scoreboard?.setVisible(true);
        this.scoreboard?.updateTraining(
          c.me.getValue(Health, 'current') ?? 0,
          c.me.getValue(Health, 'max') ?? 1,
        );
      }
      this.wasPlaying = false;
      return;
    }

    if (app.state !== 'playing') {
      this.scoreboard?.setVisible(false);
      this.wasPlaying = false;
      return;
    }

    const c = this.findBoxers();
    if (!c) return;

    // Entering a match — or a real opponent just replaced the bot mid-bout
    // (the background search paired up). Either way: wipe the slate and
    // (re)start clean so the live bout never inherits the practice scores
    // or a half-drained health pool.
    if (!this.wasPlaying || app.mode !== this.lastMode) {
      this.startMatch(c);
      this.scoreboard?.setVisible(true);
      this.wasPlaying = true;
    }
    this.lastMode = app.mode;

    const pHp = c.me.getValue(Health, 'current') ?? 0;
    const pMax = c.me.getValue(Health, 'max') ?? 1;
    const oHp = c.them.getValue(Health, 'current') ?? 0;
    const oMax = c.them.getValue(Health, 'max') ?? 1;

    const authority = app.mode === 'bot' || app.side === 0;
    if (authority) {
      this.runAuthority(c, pHp, oHp, delta);
    }
    // Guests: NetworkSystem writes `match` from host echoes; nothing to run.

    this.scoreboard?.updateMatch(match, pHp, pMax, oHp, oMax);
  }

  // --- authoritative match logic (bot bouts + online host) ----------------

  private runAuthority(c: Boxers, pHp: number, oHp: number, delta: number): void {
    if (match.phase === 'countdown') {
      match.roundTimer = Math.max(0, match.roundTimer - delta);
      match.message = match.roundTimer <= 3 && match.roundTimer > 0 ? String(Math.ceil(match.roundTimer)) : '';
      if (match.roundTimer <= 0) this.beginRound(c);
    } else if (match.phase === 'playing') {
      match.roundTimer = Math.max(0, match.roundTimer - delta);
      if (pHp <= 0 || oHp <= 0) {
        if (pHp <= 0 && oHp <= 0) this.endRound('draw', 'ko');
        else this.endRound(oHp <= 0 ? 'win' : 'loss', 'ko');
      } else if (match.roundTimer <= 0) {
        if (pHp === oHp) this.endRound('draw', 'time');
        else this.endRound(pHp > oHp ? 'win' : 'loss', 'time');
      }
    } else if (match.phase === 'matchOver' && app.mode === 'net') {
      // Net bouts HOLD at FIGHT OVER — the panel decides. Both boxers
      // pressing REMATCH restarts the match; RETURN (or the rival leaving)
      // tears the bout down via MenuSystem / onClosed instead.
      if (match.rematchMine && match.rematchTheirs) {
        this.startMatch(c);
      }
    } else {
      match.resultTimer -= delta;
      if (match.resultTimer <= 0) {
        if (match.phase === 'roundOver') {
          if (match.myScore >= MATCH.winTarget || match.oppScore >= MATCH.winTarget) {
            this.toMatchOver();
          } else {
            match.round += 1;
            // Open the next round on a 3-2-1 countdown, not straight into play.
            this.beginCountdown(c, MATCH.roundCountdown);
          }
        } else {
          // matchOver (bot bouts) → back to the lobby; drop the background
          // search so we're not still queued from the menu.
          net.cancel();
          app.state = 'menu';
          this.wasPlaying = false;
        }
      }
    }

    // Online host: echo the state on a cadence and on every transition.
    if (app.mode === 'net') {
      this.stateEchoTimer -= delta;
      if (this.stateEchoTimer <= 0) {
        this.stateEchoTimer = 0.5;
        this.echoState();
      }
    }
  }

  private endRound(outcome: RoundOutcome, result: RoundResult): void {
    if (outcome === 'win') match.myScore += 1;
    else if (outcome === 'loss') match.oppScore += 1;
    // A match-deciding round lands STRAIGHT on YOU WIN / YOU LOSE — no long
    // round-result hold between the final KO and the verdict.
    if (match.myScore >= MATCH.winTarget || match.oppScore >= MATCH.winTarget) {
      this.toMatchOver();
      return;
    }
    match.phase = 'roundOver';
    match.resultTimer = MATCH.roundOverDelay;
    match.message = outcome === 'draw' ? 'DRAW' : result === 'ko' ? (outcome === 'win' ? 'KO' : "KO'D") : outcome === 'win' ? 'WIN' : 'LOSS';
    sfx.roundEnd(outcome === 'draw' ? 'draw' : outcome === 'win');
    if (app.mode === 'net') this.echoState();
  }

  private toMatchOver(): void {
    match.phase = 'matchOver';
    match.resultTimer = MATCH.matchOverDelay;
    const win = match.myScore > match.oppScore;
    match.message = win ? 'YOU WIN' : 'YOU LOSE';
    if (win) app.stats.wins += 1;
    else app.stats.losses += 1;
    saveStats();
    // Both feed the board now: a real 1v1 win banks +20, a bot win a token +2.
    if (app.mode === 'net') reportResult(win, rival.elo);
    else reportBotResult(win);
    sfx.matchEnd(win);
    if (app.mode === 'net') this.echoState();
  }

  private startMatch(c: Boxers): void {
    match.myScore = 0;
    match.oppScore = 0;
    match.round = 1;
    match.rematchMine = false;
    match.rematchTheirs = false;
    training.active = false;
    // Full pools up front — covers the GUEST, who skips beginRound and would
    // otherwise carry a half-drained bot-bout pool until the host's first
    // echo lands.
    for (const e of [c.me, c.them]) {
      e.setValue(Health, 'current', e.getValue(Health, 'max') ?? 100);
    }
    if (app.mode === 'bot') {
      this.beginRound(c);
    } else if (app.side === 0) {
      this.beginCountdown(c);
    } else {
      match.phase = 'countdown';
      match.roundTimer = MATCH.startDelay;
      match.resultTimer = 0;
      match.message = '';
    }
  }

  /** Pre-round hold + 3-2-1: `duration` is the full lead-in (the count shows
   *  for its last 3 s). The first round squares up over MATCH.startDelay; later
   *  rounds open on a snappier MATCH.roundCountdown. */
  private beginCountdown(c: Boxers, duration = MATCH.startDelay): void {
    for (const e of [c.me, c.them]) {
      e.setValue(Health, 'current', e.getValue(Health, 'max') ?? 100);
    }
    match.phase = 'countdown';
    match.roundTimer = duration;
    match.resultTimer = 0;
    match.message = '';
    match.resetCount += 1; // park balls at fists before the pre-fight hold
    if (app.mode === 'net') this.echoState();
  }

  private beginRound(c: Boxers): void {
    for (const e of [c.me, c.them]) {
      e.setValue(Health, 'current', e.getValue(Health, 'max') ?? 100);
    }
    match.roundTimer = MATCH.roundTime;
    match.resultTimer = 0;
    match.message = '';
    match.phase = 'playing';
    match.resetCount += 1; // FireballSystem parks all balls back at fists
    sfx.roundBell();
    if (app.mode === 'net') this.echoState();
  }

  private echoState(): void {
    // Scores travel in HOST perspective; the guest flips them on receipt.
    net.send({
      k: 'state',
      phase: match.phase,
      round: match.round,
      hostScore: match.myScore,
      guestScore: match.oppScore,
      timer: match.roundTimer,
      msg: match.message,
      reset: match.resetCount,
    });
  }

  private findBoxers(): Boxers | null {
    let me: Entity | undefined;
    let them: Entity | undefined;
    for (const e of this.queries.combatants.entities) {
      if ((e.getValue(Combatant, 'team') ?? 0) === 0) me = e;
      else them = e;
    }
    return me && them ? { me, them } : null;
  }
}
