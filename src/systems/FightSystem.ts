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
import { Color, Mesh, PlaneGeometry, ShaderMaterial, Vector2, Vector3 } from 'three';
import { announce, type Call } from '../audio/announcer.js';
import { backToLobbyMusic, cancelMusicHandoff, playVictoryThenLobby, startBattleMusic } from '../audio/music.js';
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

/**
 * A DIRECTIONAL rim glow — a head-locked full-view quad whose colour creeps
 * in from the edge of your vision on the side a hit/block came from. `uDir`
 * is the screen-space direction (x right, y up) toward the impact; the rim
 * lights up strongest there, with a faint wash all round so it still reads.
 */
function rimGlowMaterial(color: number): ShaderMaterial {
  return new ShaderMaterial({
    transparent: true,
    depthTest: false,
    depthWrite: false,
    uniforms: {
      uColor: { value: new Color(color) },
      uStrength: { value: 0 },
      uDir: { value: new Vector2(0, -1) },
    },
    vertexShader: /* glsl */ `
      varying vec2 vP;
      void main() {
        vP = position.xy / 1.4; // plane is 2.8 wide → ±1 across the view
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision mediump float;
      varying vec2 vP;
      uniform vec3 uColor;
      uniform float uStrength;
      uniform vec2 uDir;
      void main() {
        float r = length(vP);
        float rim = smoothstep(0.5, 1.05, r); // glow only near the edges
        float dir = dot(normalize(vP + 1e-5), normalize(uDir));
        float lean = mix(0.12, 1.0, clamp(dir * 0.5 + 0.5, 0.0, 1.0)); // strongest toward uDir
        float a = rim * lean * uStrength;
        gl_FragColor = vec4(uColor, a);
      }
    `,
  });
}

export class FightSystem extends createSystem({}) {
  private board!: WallBoard;
  private countdown!: CountdownPlate;
  private lastBeat = -1;
  private hitVig?: Mesh; // red — you got hit
  private blockVig?: Mesh; // white — you blocked

  init(): void {
    this.board = new WallBoard();
    this.board.group.position.set(ARENA.wall[0], ARENA.wall[1], ARENA.wall[2]);
    this.scene.add(this.board.group);

    this.countdown = new CountdownPlate();
    this.scene.add(this.countdown.mesh);
  }

  private mkVignette(mat: ShaderMaterial, z: number): Mesh {
    const m = new Mesh(new PlaneGeometry(2.8, 2.8), mat);
    m.position.set(0, 0, z);
    m.renderOrder = 999;
    m.visible = false;
    return m;
  }

  private ensureVignette(): void {
    if (this.hitVig) return;
    const headObj = this.playerHeadEntity?.object3D;
    if (!headObj) return;
    this.hitVig = this.mkVignette(rimGlowMaterial(0xd21e14), -0.6);
    this.blockVig = this.mkVignette(rimGlowMaterial(0xf2fff6), -0.62);
    headObj.add(this.hitVig);
    headObj.add(this.blockVig);
  }

  update(delta: number): void {
    const headObj = this.playerHeadEntity?.object3D;
    if (headObj) headObj.getWorldPosition(_head);
    else _head.set(0, 1.6, 0);

    this.ensureVignette();
    if (this.hitVig && this.blockVig) {
      // Red hit flash fades slowly (lingers so you register it).
      match.playerFlash = Math.max(0, match.playerFlash - delta * 1.7);
      const hm = this.hitVig.material as ShaderMaterial;
      hm.uniforms.uStrength.value = match.playerFlash;
      (hm.uniforms.uDir.value as Vector2).set(match.hitDirX, match.hitDirY);
      this.hitVig.visible = match.playerFlash > 0.01;
      // White block flash is snappier.
      match.blockFlash = Math.max(0, match.blockFlash - delta * 3.0);
      const bm = this.blockVig.material as ShaderMaterial;
      bm.uniforms.uStrength.value = match.blockFlash;
      (bm.uniforms.uDir.value as Vector2).set(match.blockDirX, match.blockDirY);
      this.blockVig.visible = match.blockFlash > 0.01;
    }

    switch (match.phase) {
      case 'lobby': {
        const aPressed = this.input.xr.gamepads.right?.getButtonDown(InputComponent.A_Button) ?? false;
        if (match.startRequested || aPressed) {
          if (aPressed) uiClick();
          match.startRequested = false;
          cancelMusicHandoff(); // a stale victory→lobby timer must not fire mid-bout
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
          // To the cards: whoever has more of their HEALTH BAR left takes the
          // round — compared as a fraction of each fighter's own max, so the
          // goop's huge HP pool doesn't hand it every decision.
          const pFrac = match.playerHp / COMBAT.playerHealth;
          const cFrac = match.creatureHp / COMBAT.creatureHealth;
          if (Math.abs(pFrac - cFrac) < 0.005) this.endRound('draw');
          else this.endRound(pFrac > cFrac ? 'player' : 'creature');
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

    // The wall board is match furniture — it only exists once FIGHT is
    // pressed; the lobby is just you, the goop and the menu.
    this.board.group.visible = match.phase !== 'lobby';
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
