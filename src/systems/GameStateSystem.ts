/**
 * Owns the match: round timer, scoring, win/lose and reset. Reads/writes the
 * shared `match` state and refreshes the scoreboards every frame.
 *
 * Two authorities live here:
 *  - the classic DUEL (1v1) — a round ends when a boxer's Health hits 0 (KO) or
 *    the timer expires (higher Health wins); first to MATCH.winTarget round
 *    wins takes it. ONLINE the HOST (side 0) runs this and echoes `state`; the
 *    GUEST applies the echoes. This path is unchanged.
 *  - the ARCADE brawls (2v2 / FFA) — a team survival rule: a round ends when
 *    only one team has anyone left standing (or the timer expires, top team
 *    health wins), that team banks the round, first team to winTarget wins.
 *    Arcade bouts run against bots, so there is always a single local
 *    authority — no echo.
 */

import { createSystem, type Entity } from '@iwsdk/core';
import { Combatant } from '../components/Combatant.js';
import { Health } from '../components/Health.js';
import { match } from '../combat/matchState.js';
import { applyRoster } from '../combat/setup.js';
import { applyArenaLayout } from '../arena/arena.js';
import { app, saveStats, training, type AppMode } from '../menu/appState.js';
import * as sfx from '../audio/sfx.js';
import { playVictory, startBattleMusic, stopBattleMusic } from '../audio/battleMusic.js';
import { announce, preloadAnnouncer } from '../audio/announcer.js';
import { MATCH, modeTeams, teamColor, type ArcadeMode } from '../config.js';
import { createScoreboard, type FighterHud, type Scoreboard } from '../ui/scoreboard.js';
import { UI } from '../ui/industrial.js';
import { net } from '../net/client.js';
import { reportArcade, reportBotResult, reportResult, rival, myName } from '../net/leaderboard.js';

interface Boxers {
  me: Entity;
  them: Entity;
}

type RoundResult = 'ko' | 'time';
type RoundOutcome = 'win' | 'loss' | 'draw';

function hexColor(n: number): string {
  return `#${n.toString(16).padStart(6, '0')}`;
}

/** HUD tint for a team — keeps the duel's exact ember/blue, tints FFA 2/3. */
function teamNeon(team: number): string {
  if (team === 0) return UI.emberBright;
  if (team === 1) return UI.cool;
  return hexColor(teamColor(team));
}

function displayName(name: string, fallback: string): string {
  const clean = name.trim();
  return clean ? clean.toUpperCase() : fallback;
}

export class GameStateSystem extends createSystem({
  combatants: { required: [Combatant, Health] },
}) {
  private scoreboard?: Scoreboard;
  private wasPlaying = false;
  /** Which mode the live bout is running in — a change while playing means a
   *  real opponent just replaced the bot, so the match restarts clean. */
  private lastMode: AppMode = 'bot';
  private lastArcade: ArcadeMode = '1v1';
  private stateEchoTimer = 0;
  /** The countdown beat we last spoke, so the announcer fires once per beat. */
  private lastAnnounced = '';

  init(): void {
    this.scoreboard = createScoreboard(this.scene);
    this.scoreboard.setVisible(false);
    preloadAnnouncer(); // decode the 3/2/1/FIGHT clips ahead of the first bout
  }

  update(delta: number): void {
    if (app.state === 'training') {
      const me = this.localPlayer();
      if (me) {
        this.scoreboard?.setVisible(true);
        this.scoreboard?.updateTraining(me.getValue(Health, 'current') ?? 0, me.getValue(Health, 'max') ?? 1);
      }
      this.wasPlaying = false;
      return;
    }

    if (app.state !== 'playing') {
      this.scoreboard?.setVisible(false);
      if (this.wasPlaying) stopBattleMusic(); // bout ended / left — kill the score
      this.wasPlaying = false;
      return;
    }

    // Entering a bout — or the mode / layout changed mid-bout (the background
    // search paired a human, or a fresh arcade mode was picked). Re-stamp the
    // roster + platforms, wipe the slate and (re)start clean.
    const entering = !this.wasPlaying || app.mode !== this.lastMode || app.arcade !== this.lastArcade;
    if (entering) {
      applyRoster();
      applyArenaLayout(this.scene);
    }

    const actives = this.activeCombatants();
    const me = actives.find((e) => (e.getValue(Combatant, 'slot') ?? -1) === 0);
    if (!me) return;

    if (entering) {
      this.startMatch(actives);
      this.scoreboard?.setVisible(true);
      this.wasPlaying = true;
    }
    this.lastMode = app.mode;
    this.lastArcade = app.arcade;

    const authority = app.mode === 'bot' || app.side === 0;
    if (authority) {
      if (app.arcade === '1v1') {
        const them = actives.find((e) => (e.getValue(Combatant, 'slot') ?? -1) === 1);
        if (them) this.runAuthority({ me, them }, me.getValue(Health, 'current') ?? 0, them.getValue(Health, 'current') ?? 0, delta);
      } else {
        this.runArcadeAuthority(actives, delta);
      }
    }
    // Guests (net 1v1 only): NetworkSystem writes `match` from host echoes.

    this.scoreboard?.updateMatch(match, this.buildHud(actives));
    this.maybeAnnounce();
  }

  // --- HUD -----------------------------------------------------------------

  private buildHud(actives: Entity[]): FighterHud[] {
    const duel = app.arcade === '1v1';
    return actives
      .slice()
      .sort((a, b) => (a.getValue(Combatant, 'slot') ?? 0) - (b.getValue(Combatant, 'slot') ?? 0))
      .map((e) => {
        const slot = e.getValue(Combatant, 'slot') ?? 0;
        const team = e.getValue(Combatant, 'team') ?? 0;
        const hp = e.getValue(Health, 'current') ?? 0;
        const hpMax = e.getValue(Health, 'max') ?? 1;
        const pips = duel ? (slot === 0 ? match.myScore : match.oppScore) : match.teamScores[team] ?? 0;
        let name: string;
        if (slot === 0) name = app.mode === 'net' ? displayName(myName(), 'YOU') : 'YOU';
        else if (duel) name = app.mode === 'net' ? displayName(rival.name, 'RIVAL') : 'BOT';
        else name = team === 0 ? 'ALLY' : 'BOT';
        return { name, neon: teamNeon(team), hpFrac: hp / hpMax, pips, team };
      });
  }

  // --- arcade authority (2v2 / FFA, bot bouts) -----------------------------

  private runArcadeAuthority(actives: Entity[], delta: number): void {
    const teams = modeTeams(app.arcade);
    const teamHp = (t: number): number =>
      actives.reduce((sum, e) => ((e.getValue(Combatant, 'team') ?? 0) === t ? sum + (e.getValue(Health, 'current') ?? 0) : sum), 0);

    if (match.phase === 'countdown') {
      match.roundTimer = Math.max(0, match.roundTimer - delta);
      match.message = match.roundTimer <= 3 && match.roundTimer > 0 ? String(Math.ceil(match.roundTimer)) : '';
      if (match.roundTimer <= 0) this.beginRoundArcade(actives);
    } else if (match.phase === 'playing') {
      match.roundTimer = Math.max(0, match.roundTimer - delta);
      if (match.message === 'FIGHT' && match.roundTimer <= MATCH.roundTime - 1.2) match.message = '';
      const alive = teams.filter((t) => teamHp(t) > 0);
      if (alive.length <= 1) {
        this.endRoundArcade(alive[0], 'ko');
      } else if (match.roundTimer <= 0) {
        this.endRoundArcade(this.topTeam(teams, teamHp), 'time');
      }
    } else if (match.phase === 'roundOver') {
      match.resultTimer -= delta;
      if (match.resultTimer <= 0) {
        if (teams.some((t) => (match.teamScores[t] ?? 0) >= MATCH.winTarget)) this.toMatchOverArcade(teams);
        else {
          match.round += 1;
          this.beginCountdownArcade(actives, MATCH.roundCountdown);
        }
      }
    } else {
      // matchOver → back to the lobby; drop any background search.
      match.resultTimer -= delta;
      if (match.resultTimer <= 0) {
        net.cancel();
        app.state = 'menu';
        this.wasPlaying = false;
      }
    }
  }

  /** Team with the most total health, or undefined on a tie. */
  private topTeam(teams: number[], teamHp: (t: number) => number): number | undefined {
    let best: number | undefined;
    let bestHp = -1;
    let tie = false;
    for (const t of teams) {
      const h = teamHp(t);
      if (h > bestHp) {
        bestHp = h;
        best = t;
        tie = false;
      } else if (h === bestHp) {
        tie = true;
      }
    }
    return tie ? undefined : best;
  }

  private endRoundArcade(winnerTeam: number | undefined, result: RoundResult): void {
    match.roundWinnerTeam = winnerTeam ?? -1;
    if (winnerTeam !== undefined) match.teamScores[winnerTeam] = (match.teamScores[winnerTeam] ?? 0) + 1;
    if (modeTeams(app.arcade).some((t) => (match.teamScores[t] ?? 0) >= MATCH.winTarget)) {
      this.toMatchOverArcade(modeTeams(app.arcade));
      return;
    }
    const iWon = winnerTeam === 0;
    match.phase = 'roundOver';
    match.resultTimer = MATCH.roundOverDelay;
    match.message =
      winnerTeam === undefined ? 'DRAW' : result === 'ko' ? (iWon ? 'KO' : "KO'D") : iWon ? 'WIN' : 'LOSS';
    sfx.roundEnd(winnerTeam === undefined ? 'draw' : iWon);
  }

  private toMatchOverArcade(teams: number[]): void {
    match.phase = 'matchOver';
    match.resultTimer = MATCH.matchOverDelay;
    playVictory(); // stops the battle score and rings the end-of-game sting
    const winner = this.topTeam(teams, (t) => match.teamScores[t] ?? 0);
    match.roundWinnerTeam = winner ?? -1;
    const win = winner === 0;
    match.message = win ? 'YOU WIN' : 'YOU LOSE';
    if (win) app.stats.wins += 1;
    else app.stats.losses += 1;
    saveStats();
    reportArcade(app.arcade, win); // +25 XP for taking part, win → mode board
    sfx.matchEnd(win);
  }

  private beginCountdownArcade(actives: Entity[], duration: number): void {
    this.refill(actives);
    match.phase = 'countdown';
    match.roundTimer = duration;
    match.resultTimer = 0;
    match.message = '';
    match.resetCount += 1;
  }

  private beginRoundArcade(actives: Entity[]): void {
    this.refill(actives);
    match.roundTimer = MATCH.roundTime;
    match.resultTimer = 0;
    match.message = 'FIGHT';
    match.phase = 'playing';
    match.resetCount += 1;
    sfx.roundBell();
  }

  // --- shared bout lifecycle ----------------------------------------------

  private startMatch(actives: Entity[]): void {
    this.lastAnnounced = '';
    match.myScore = 0;
    match.oppScore = 0;
    match.teamScores = [0, 0, 0, 0];
    match.roundWinnerTeam = -1;
    match.round = 1;
    match.rematchMine = false;
    match.rematchTheirs = false;
    training.active = false;
    this.refill(actives);
    if (!app.tutorial) startBattleMusic(); // quiet background score for the bout



    if (app.arcade !== '1v1') {
      this.beginCountdownArcade(actives, MATCH.startDelay); // 2v2 / FFA open on the 3-2-1 too
      return;
    }
    // Classic duel: drive the original 1v1 flow.
    const me = actives.find((e) => (e.getValue(Combatant, 'slot') ?? -1) === 0)!;
    const them = actives.find((e) => (e.getValue(Combatant, 'slot') ?? -1) === 1)!;
    const c = { me, them };
    if (app.mode === 'bot') {
      // The tutorial rides a bot duel but drives its own pacing, so it starts
      // straight away — no countdown. Other bot matches get a snappy 3-2-1
      // (bots have no peer to sync, so skip the long pre-roll and dead air).
      if (app.tutorial) this.beginRound(c);
      else this.beginCountdown(c, MATCH.roundCountdown);
    } else if (app.side === 0) {
      this.beginCountdown(c);
    } else {
      match.phase = 'countdown';
      match.roundTimer = MATCH.startDelay;
      match.resultTimer = 0;
      match.message = '';
    }
  }

  private refill(actives: Entity[]): void {
    for (const e of actives) e.setValue(Health, 'current', e.getValue(Health, 'max') ?? 100);
  }

  /** Fire the announcer once per countdown beat as `match.message` changes. */
  private maybeAnnounce(): void {
    const m = match.message;
    if (m === this.lastAnnounced) return;
    this.lastAnnounced = m;
    if (m === '1' || m === '2' || m === '3') announce(m);
    else if (m === 'FIGHT') announce('fight');
  }

  // --- classic duel authority (1v1, bot + online host) — unchanged ---------

  private runAuthority(c: Boxers, pHp: number, oHp: number, delta: number): void {
    if (match.phase === 'countdown') {
      match.roundTimer = Math.max(0, match.roundTimer - delta);
      const prevMsg = match.message;
      match.message = match.roundTimer <= 3 && match.roundTimer > 0 ? String(Math.ceil(match.roundTimer)) : '';
      if (app.mode === 'net' && match.message && match.message !== prevMsg) this.echoState();
      if (match.roundTimer <= 0) this.beginRound(c);
    } else if (match.phase === 'playing') {
      match.roundTimer = Math.max(0, match.roundTimer - delta);
      if (match.message === 'FIGHT' && match.roundTimer <= MATCH.roundTime - 1.2) {
        match.message = '';
        if (app.mode === 'net') this.echoState();
      }
      if (pHp <= 0 || oHp <= 0) {
        if (pHp <= 0 && oHp <= 0) this.endRound('draw', 'ko');
        else this.endRound(oHp <= 0 ? 'win' : 'loss', 'ko');
      } else if (match.roundTimer <= 0) {
        if (pHp === oHp) this.endRound('draw', 'time');
        else this.endRound(pHp > oHp ? 'win' : 'loss', 'time');
      }
    } else if (match.phase === 'matchOver' && app.mode === 'net') {
      if (match.rematchMine && match.rematchTheirs) {
        this.startMatch(this.activeCombatants());
      }
    } else {
      match.resultTimer -= delta;
      if (match.resultTimer <= 0) {
        if (match.phase === 'roundOver') {
          if (match.myScore >= MATCH.winTarget || match.oppScore >= MATCH.winTarget) {
            this.toMatchOver();
          } else {
            match.round += 1;
            this.beginCountdown(c, MATCH.roundCountdown);
          }
        } else {
          net.cancel();
          app.state = 'menu';
          this.wasPlaying = false;
        }
      }
    }

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
    playVictory(); // stops the battle score and rings the end-of-game sting
    const win = match.myScore > match.oppScore;
    match.message = win ? 'YOU WIN' : 'YOU LOSE';
    if (win) app.stats.wins += 1;
    else app.stats.losses += 1;
    saveStats();
    if (app.mode === 'net') reportResult(win, rival.elo);
    else reportBotResult(win);
    sfx.matchEnd(win);
    if (app.mode === 'net') this.echoState();
  }

  private beginCountdown(c: Boxers, duration = MATCH.startDelay): void {
    for (const e of [c.me, c.them]) e.setValue(Health, 'current', e.getValue(Health, 'max') ?? 100);
    match.phase = 'countdown';
    match.roundTimer = duration;
    match.resultTimer = 0;
    match.message = '';
    match.resetCount += 1;
    if (app.mode === 'net') this.echoState();
  }

  private beginRound(c: Boxers): void {
    for (const e of [c.me, c.them]) e.setValue(Health, 'current', e.getValue(Health, 'max') ?? 100);
    match.roundTimer = MATCH.roundTime;
    match.resultTimer = 0;
    match.message = 'FIGHT';
    match.phase = 'playing';
    match.resetCount += 1;
    sfx.roundBell();
    if (app.mode === 'net') this.echoState();
  }

  private echoState(): void {
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

  // --- queries -------------------------------------------------------------

  private activeCombatants(): Entity[] {
    const out: Entity[] = [];
    for (const e of this.queries.combatants.entities) {
      if ((e.getValue(Combatant, 'active') ?? 0) === 1) out.push(e);
    }
    return out;
  }

  private localPlayer(): Entity | undefined {
    for (const e of this.queries.combatants.entities) {
      if ((e.getValue(Combatant, 'slot') ?? -1) === 0) return e;
    }
    return undefined;
  }
}
