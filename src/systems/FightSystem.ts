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
import { matchEnd, roundBell, uiClick } from '../audio/sfx.js';
import { ARENA, COMBAT } from '../config.js';
import { match, resetForBout } from '../state.js';
import { ScoreBoard } from '../ui/board.js';

const BEATS: Call[] = ['3', '2', '1', 'fight'];
const VERDICT_SECONDS = 5.5;

const _head = new Vector3();

function vignetteTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(128, 128, 60, 128, 128, 128);
  grad.addColorStop(0, 'rgba(200, 30, 20, 0)');
  grad.addColorStop(0.75, 'rgba(200, 30, 20, 0.45)');
  grad.addColorStop(1, 'rgba(160, 15, 10, 0.9)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  return new CanvasTexture(c);
}

export class FightSystem extends createSystem({}) {
  private board!: ScoreBoard;
  private lastBeat = -1;
  private vignette?: Mesh;

  init(): void {
    this.board = new ScoreBoard();
    this.board.group.position.set(ARENA.board[0], ARENA.board[1], ARENA.board[2]);
    this.scene.add(this.board.group);
  }

  private ensureVignette(): void {
    if (this.vignette) return;
    const headObj = this.playerHeadEntity?.object3D;
    if (!headObj) return;
    this.vignette = new Mesh(
      new PlaneGeometry(2.6, 2.6),
      new MeshBasicMaterial({
        map: vignetteTexture(),
        transparent: true,
        opacity: 0,
        depthTest: false,
        depthWrite: false,
      }),
    );
    this.vignette.position.set(0, 0, -0.6);
    this.vignette.renderOrder = 999;
    headObj.add(this.vignette);
  }

  update(delta: number): void {
    const headObj = this.playerHeadEntity?.object3D;
    if (headObj) headObj.getWorldPosition(_head);
    else _head.set(0, 1.6, 0);

    this.ensureVignette();
    if (this.vignette) {
      match.playerFlash = Math.max(0, match.playerFlash - delta * 2.1);
      (this.vignette.material as MeshBasicMaterial).opacity = match.playerFlash * 0.65;
      this.vignette.visible = match.playerFlash > 0.01;
    }

    switch (match.phase) {
      case 'lobby': {
        const aPressed = this.input.xr.gamepads.right?.getButtonDown(InputComponent.A_Button) ?? false;
        if (match.startRequested || aPressed) {
          if (aPressed) uiClick();
          match.startRequested = false;
          resetForBout();
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
        if (match.creatureHp <= 0) {
          this.endBout('win');
        } else if (match.playerHp <= 0) {
          this.endBout('ko');
        } else if (match.timeLeft <= 0) {
          if (Math.abs(match.playerHp - match.creatureHp) < 0.5) this.endBout('draw');
          else this.endBout('time');
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

    this.board.update(_head);
  }

  private endBout(verdict: 'win' | 'ko' | 'time' | 'draw'): void {
    match.phase = 'verdict';
    match.verdict = verdict;
    match.verdictT = 0;
    match.boardDirty = true;

    const playerWon = verdict === 'win' || (verdict === 'time' && match.playerHp > match.creatureHp);
    matchEnd(playerWon);
    if (playerWon) playVictoryThenLobby();
    else backToLobbyMusic();
  }
}
