/**
 * Darts scoring + the chalkboard. PropSystem rules on the physics (your own
 * dart raycasts into the board and emits `dartScored`); this system turns
 * that into score popups and keeps the communal leaderboard panel fresh.
 * Online the SERVER owns the board (DART_HIT events mutate it, `board`
 * pushes render it); offline you get a local board so practice still counts.
 */

import { createSystem, InputComponent } from '@iwsdk/core';
import { CanvasTexture, LinearFilter, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, Quaternion, SRGBColorSpace, Vector3 } from 'three';
import { uiClick } from '../../audio/sfx.js';
import type { BoardRow } from '../protocol.js';
import { pubSendEvent } from '../net.js';
import { bus, pub } from '../state.js';

interface Popup {
  mesh: Mesh;
  mat: MeshBasicMaterial;
  life: number;
}

const HANDS = ['left', 'right'] as const;
const _btn = new Vector3();
const _o = new Vector3();
const _dir = new Vector3();
const _toBtn = new Vector3();
const _bq = new Quaternion();
// The RESET button only lights when a hand's aim cone falls on it from CLOSE —
// you walk up and press it, so the reach is short (it used to light from across
// the room). Cap glow at rest vs. when aimed.
const RESET_AIM_MAX = 1.3;
const RESET_AIM_CONE_COS = Math.cos((22 * Math.PI) / 180);
const RESET_GLOW_REST = 0.45;
const RESET_GLOW_HOT = 1.9;

export class DartsSystem extends createSystem({}) {
  private popups: Popup[] = [];
  private localBoard = new Map<string, BoardRow>();
  private _camQ = new Quaternion();
  /** Whether a hand is currently aimed at the RESET button (drives its glow). */
  private resetHover = false;

  init(): void {
    this.cleanupFuncs.push(
      bus.on('dartScored', ({ segment, score }) => {
        uiClick();
        this.showPopup(pub.myAccent, score);
        if (pub.online) {
          pubSendEvent({ e: 'DART_HIT', segment, score });
        } else {
          this.localScore(score);
        }
      }),
      bus.on('gameEvent', ({ from, ev }) => {
        if (ev.e !== 'DART_HIT' || from === pub.myId) return;
        const punter = pub.punters.get(from);
        this.showPopup(punter?.accent ?? 0x9aa7bd, ev.score);
      }),
      bus.on('board', (rows) => this.renderBoard(rows)),
    );
    this.renderBoard([]);
  }

  update(delta: number): void {
    this.updateResetButton();
    if (this.popups.length) this.camera.getWorldQuaternion(this._camQ);
    for (let i = this.popups.length - 1; i >= 0; i--) {
      const p = this.popups[i];
      p.life -= delta;
      p.mesh.position.y += delta * 0.28; // drift up
      p.mesh.quaternion.copy(this._camQ); // billboard — always readable
      p.mat.opacity = Math.min(1, p.life * 1.5); // fade out at the end
      if (p.life <= 0) {
        this.scene.remove(p.mesh);
        p.mat.map?.dispose();
        p.mat.dispose();
        p.mesh.geometry.dispose();
        this.popups.splice(i, 1);
      }
    }
  }

  /** Brighten the red button when a hand aims at it from close; a trigger pull
   *  wipes the board (server-authoritative online, local offline). */
  private updateResetButton(): void {
    const btn = pub.refs?.dartsResetButton;
    if (!btn || !this.player) return;
    btn.getWorldPosition(_btn);

    const aimed: Record<'left' | 'right', boolean> = { left: false, right: false };
    for (const hand of HANDS) {
      const ray = this.player.raySpaces[hand];
      if (!ray) continue;
      ray.getWorldPosition(_o);
      ray.getWorldQuaternion(_bq);
      _dir.set(0, 0, -1).applyQuaternion(_bq).normalize();
      _toBtn.copy(_btn).sub(_o);
      const dist = _toBtn.length();
      if (dist < 1e-3 || dist > RESET_AIM_MAX) continue;
      if (_toBtn.divideScalar(dist).dot(_dir) < RESET_AIM_CONE_COS) continue;
      aimed[hand] = true;
    }

    const hot = aimed.left || aimed.right;
    if (hot !== this.resetHover) {
      this.resetHover = hot;
      (btn.material as MeshStandardMaterial).emissiveIntensity = hot ? RESET_GLOW_HOT : RESET_GLOW_REST;
    }

    for (const hand of HANDS) {
      const gp = this.input.xr.gamepads[hand];
      if (aimed[hand] && gp?.getButtonDown(InputComponent.Trigger)) {
        this.resetBoard();
        break;
      }
    }
  }

  private resetBoard(): void {
    uiClick();
    if (pub.online) {
      pubSendEvent({ e: 'DARTS_RESET' }); // server clears + broadcasts an empty board
    } else {
      this.localBoard.clear();
      this.renderBoard([]);
    }
  }

  /** A flicked-up score NUMBER at the board — just the points, no panel,
   *  billboarded to the thrower, tinted to whoever landed it. */
  private showPopup(accent: number, score: number): void {
    const refs = pub.refs;
    if (!refs) return;
    const hex = `#${accent.toString(16).padStart(6, '0')}`;
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 160;
    const ctx = canvas.getContext('2d')!;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = "900 110px 'Arial Black', system-ui, sans-serif";
    ctx.lineWidth = 14;
    ctx.strokeStyle = 'rgba(8,9,12,0.92)';
    ctx.strokeText(String(score), 128, 84);
    ctx.fillStyle = hex;
    ctx.shadowColor = hex;
    ctx.shadowBlur = 26;
    ctx.fillText(String(score), 128, 84);
    const tex = new CanvasTexture(canvas);
    tex.colorSpace = SRGBColorSpace;
    tex.minFilter = LinearFilter;
    const mat = new MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false });
    const mesh = new Mesh(new PlaneGeometry(0.34, 0.21), mat);
    mesh.renderOrder = 60; // always on top, never hidden behind the board
    mesh.position.copy(refs.dartboard.position);
    mesh.position.z += 0.18; // proud of the board, toward the throwers
    mesh.position.y += 0.12;
    this.scene.add(mesh);
    this.popups.push({ mesh, mat, life: 1.6 });
  }

  private localScore(score: number): void {
    const row = this.localBoard.get('local') ?? {
      id: 'local',
      name: pub.myName || 'YOU',
      accent: pub.myAccent,
      score: 0,
      darts: 0,
    };
    row.score += score;
    row.darts += 1;
    this.localBoard.set('local', row);
    this.renderBoard([...this.localBoard.values()]);
  }

  private renderBoard(rows: BoardRow[]): void {
    const panel = pub.refs?.dartsBoardPanel;
    if (!panel) return;
    const top = rows
      .filter((r) => r.darts > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 9);
    panel.draw((ctx, w) => {
      ctx.font = '30px "Arial Narrow", system-ui, sans-serif';
      top.forEach((row, i) => {
        const y = 64 + i * 42;
        ctx.fillStyle = `#${row.accent.toString(16).padStart(6, '0')}`;
        ctx.beginPath();
        ctx.arc(40, y - 9, 9, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#e8ecf2';
        ctx.textAlign = 'left';
        ctx.fillText(row.name.slice(0, 14).toUpperCase(), 62, y);
        ctx.textAlign = 'right';
        ctx.fillText(`${row.score}  (${row.darts})`, w - 30, y);
      });
      if (top.length === 0) {
        ctx.fillStyle = 'rgba(232,236,242,0.55)';
        ctx.textAlign = 'left';
        ctx.fillText('no arrows thrown yet', 28, 64);
      }
    });
  }
}
