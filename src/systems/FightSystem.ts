/**
 * The referee — match phases, the harvested FIRE FIGHT ceremony, and your
 * pain. Lobby (warm-up punches arm the bout, or the A button skips straight
 * in) → countdown (3/2/1/FIGHT plates + the ring announcer + the bell,
 * battle music up) → fighting (the clock runs, health settles it) →
 * verdict (WIN/KO/TIME/DRAW art, victory sting or the walk of shame) →
 * back to the lobby for the rematch.
 *
 * Also owns the red hit-vignette: a soft ring that flashes over your view
 * when the creature's fist lands, fading over half a second.
 */

import { createSystem, InputComponent } from '@iwsdk/core';
import {
  CanvasTexture,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Vector3,
} from 'three';
import { announce, type Call } from '../audio/announcer.js';
import { backToLobbyMusic, playVictoryThenLobby, startBattleMusic } from '../audio/music.js';
import { matchEnd, roundBell, roundEnd, uiClick } from '../audio/sfx.js';
import { ARENA, COMBAT } from '../config.js';
import {
  getCreature,
  match,
  MAX_ROUNDS,
  resetForMatch,
  resetForRound,
  REST_SECONDS,
  ROUNDS_TO_WIN,
  type RoundWinner,
} from '../state.js';
import { CountdownPlate, WallBoard } from '../ui/hud.js';

const BEATS: Call[] = ['3', '2', '1', 'fight'];
const VERDICT_SECONDS = 5.5;

const _head = new Vector3();
const _cpos = new Vector3();

/** A soft edge-vignette texture in the given rgb — dark→transparent from the
 *  rim inward, so a flash reads as colour creeping in from the screen edges. */
function vignetteTexture(r: number, g: number, b: number): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d')!;
  const grad = ctx.createRadialGradient(128, 128, 50, 128, 128, 138);
  grad.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0)`);
  grad.addColorStop(0.7, `rgba(${r}, ${g}, ${b}, 0.5)`);
  grad.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0.95)`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 256);
  return new CanvasTexture(c);
}

export class FightSystem extends createSystem({}) {
  private board!: WallBoard;
  private countdown!: CountdownPlate;
  private lastBeat = -1;
  private vignette?: Mesh; // red — you got hit
  private blockVig?: Mesh; // white — you blocked

  init(): void {
    this.board = new WallBoard();
    this.board.group.position.set(ARENA.wall[0], ARENA.wall[1], ARENA.wall[2]);
    this.scene.add(this.board.group);

    this.countdown = new CountdownPlate();
    this.scene.add(this.countdown.mesh);
  }

  private mkVignette(tex: CanvasTexture, z: number): Mesh {
    const m = new Mesh(
      new PlaneGeometry(2.8, 2.8),
      new MeshBasicMaterial({ map: tex, transparent: true, opacity: 0, depthTest: false, depthWrite: false }),
    );
    m.position.set(0, 0, z);
    m.renderOrder = 999;
    m.visible = false;
    return m;
  }

  private ensureVignette(): void {
    if (this.vignette) return;
    const headObj = this.playerHeadEntity?.object3D;
    if (!headObj) return;
    this.vignette = this.mkVignette(vignetteTexture(210, 30, 20), -0.6);
    this.blockVig = this.mkVignette(vignetteTexture(230, 255, 240), -0.62);
    headObj.add(this.vignette);
    headObj.add(this.blockVig);
  }

  update(delta: number): void {
    const headObj = this.playerHeadEntity?.object3D;
    if (headObj) headObj.getWorldPosition(_head);
    else _head.set(0, 1.6, 0);

    this.ensureVignette();
    if (this.vignette && this.blockVig) {
      // Red hit flash fades slowly (lingers so you register the hit).
      match.playerFlash = Math.max(0, match.playerFlash - delta * 1.7);
      (this.vignette.material as MeshBasicMaterial).opacity = match.playerFlash * 0.7;
      this.vignette.visible = match.playerFlash > 0.01;
      // White block flash is snappier.
      match.blockFlash = Math.max(0, match.blockFlash - delta * 3.2);
      (this.blockVig.material as MeshBasicMaterial).opacity = match.blockFlash * 0.5;
      this.blockVig.visible = match.blockFlash > 0.01;
    }

    switch (match.phase) {
      case 'lobby': {
        const aPressed = this.input.xr.gamepads.right?.getButtonDown(InputComponent.A_Button) ?? false;
        if (match.startRequested || aPressed) {
          if (aPressed) uiClick();
          match.startRequested = false;
          resetForMatch();
          match.phase = 'countdown';
          match.countdownT = 0;
          this.lastBeat = -1;
          match.boardDirty = true;
        }
        break;
      }

      case 'countdown': {
        match.countdownT += delta;
        const beat = Math.min(3, Math.floor(match.countdownT / COMBAT.countdownBeat));
        if (beat !== this.lastBeat) {
          this.lastBeat = beat;
          announce(BEATS[beat]);
          match.boardDirty = true;
          if (beat === 3) {
            roundBell();
            startBattleMusic();
          }
        }
        if (match.countdownT > COMBAT.countdownBeat * 3 + 0.9) {
          match.phase = 'fighting';
          match.boardDirty = true;
        }
        break;
      }

      case 'fighting': {
        match.timeLeft -= delta;
        // Win checks use THIS frame's damage (Fist/Creature systems ran first).
        if (match.creatureHp <= 0) {
          this.endRound('player');
        } else if (match.playerHp <= 0) {
          this.endRound('creature');
        } else if (match.timeLeft <= 0) {
          // To the cards: whoever kept more of themselves takes the round.
          if (Math.abs(match.playerHp - match.creatureHp) < 0.5) this.endRound('draw');
          else this.endRound(match.playerHp > match.creatureHp ? 'player' : 'creature');
        } else {
          // Still going — both fighters trickle a little health back. (After
          // the KO check, so a killing blow is never undone by regen.)
          const r = COMBAT.regenPerSec * delta;
          match.creatureHp = Math.min(COMBAT.creatureHealth, match.creatureHp + r);
          match.playerHp = Math.min(COMBAT.playerHealth, match.playerHp + r);
        }
        break;
      }

      case 'roundEnd': {
        match.roundEndT += delta;
        if (match.roundEndT > REST_SECONDS) {
          match.round++;
          resetForRound();
          match.phase = 'countdown';
          match.countdownT = 0;
          this.lastBeat = -1;
          match.boardDirty = true;
        }
        break;
      }

      case 'verdict': {
        match.verdictT += delta;
        if (match.verdictT > VERDICT_SECONDS) {
          match.phase = 'lobby';
          match.boardDirty = true;
        }
        break;
      }
    }

    this.board.update();

    const creature = getCreature();
    _cpos.copy(creature ? creature.position : _head).setY(0);
    if (!creature) _cpos.set(_head.x, 0, _head.z - 1.5);
    this.countdown.update(_head, _cpos);
  }

  /** A round is settled: score it, then rest or — if the cards are in —
   *  hand the whole contest to the judges. */
  private endRound(winner: Exclude<RoundWinner, ''>): void {
    match.lastRound = winner;
    if (winner === 'player') match.playerRounds++;
    else if (winner === 'creature') match.creatureRounds++;
    match.boardDirty = true;

    const decided =
      match.playerRounds >= ROUNDS_TO_WIN ||
      match.creatureRounds >= ROUNDS_TO_WIN ||
      match.round >= MAX_ROUNDS;

    if (decided) {
      this.endMatch();
    } else {
      roundEnd(winner === 'draw' ? 'draw' : winner === 'player');
      match.phase = 'roundEnd';
      match.roundEndT = 0;
    }
  }

  private endMatch(): void {
    match.phase = 'verdict';
    match.verdictT = 0;
    const playerWon = match.playerRounds > match.creatureRounds;
    match.verdict = match.playerRounds === match.creatureRounds ? 'draw' : playerWon ? 'win' : 'ko';
    match.boardDirty = true;

    matchEnd(playerWon);
    if (playerWon) playVictoryThenLobby();
    else backToLobbyMusic();
  }
}
