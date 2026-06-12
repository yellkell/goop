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
import { app, saveStats, training } from '../menu/appState.js';
import * as sfx from '../audio/sfx.js';
import { MATCH } from '../config.js';
import { createScoreboard, type Scoreboard } from '../ui/scoreboard.js';
import { net } from '../net/client.js';
import { reportResult, rival } from '../net/leaderboard.js';

interface Boxers {
  me: Entity;
  them: Entity;
}

export class GameStateSystem extends createSystem({
  combatants: { required: [Combatant, Health] },
}) {
  private scoreboard?: Scoreboard;
  private wasPlaying = false;
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

    // Entering a match: reset scores/round/health and kick off round 1.
    if (!this.wasPlaying) {
      this.startMatch(c);
      this.scoreboard?.setVisible(true);
      this.wasPlaying = true;
    }

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
    if (match.phase === 'playing') {
      match.roundTimer = Math.max(0, match.roundTimer - delta);
      if (oHp <= 0) this.endRound(true, 'KNOCKOUT');
      else if (pHp <= 0) this.endRound(false, 'KNOCKED OUT');
      else if (match.roundTimer <= 0) this.endRound(pHp >= oHp, 'TIME');
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
            this.beginRound(c);
          }
        } else {
          // matchOver (bot bouts) → back to the lobby.
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

  private endRound(iWon: boolean, how: string): void {
    if (iWon) match.myScore += 1;
    else match.oppScore += 1;
    match.phase = 'roundOver';
    match.resultTimer = MATCH.roundOverDelay;
    match.message = iWon ? (how === 'TIME' ? 'ROUND WON' : 'KNOCKOUT') : how === 'TIME' ? 'ROUND LOST' : 'KNOCKED OUT';
    sfx.roundEnd(iWon);
    if (app.mode === 'net') this.echoState();
  }

  private toMatchOver(): void {
    match.phase = 'matchOver';
    match.resultTimer = MATCH.matchOverDelay;
    const win = match.myScore > match.oppScore;
    match.message = win ? 'YOU WIN THE FIGHT' : 'YOU LOSE';
    if (win) app.stats.wins += 1;
    else app.stats.losses += 1;
    saveStats();
    // Only real 1v1s feed the leaderboard — no farming the bot.
    if (app.mode === 'net') reportResult(win, rival.elo);
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
    if (app.mode === 'bot' || app.side === 0) this.beginRound(c);
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
