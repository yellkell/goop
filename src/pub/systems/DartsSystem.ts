/**
 * Darts scoring + the chalkboard. PropSystem rules on the physics (your own
 * dart raycasts into the board and emits `dartScored`); this system turns
 * that into score popups and keeps the communal leaderboard panel fresh.
 * Online the SERVER owns the board (DART_HIT events mutate it, `board`
 * pushes render it); offline you get a local board so practice still counts.
 */

import { createSystem } from '@iwsdk/core';
import { uiClick } from '../../audio/sfx.js';
import { Panel } from '../panel.js';
import type { BoardRow } from '../protocol.js';
import { pubSendEvent } from '../net.js';
import { bus, pub } from '../state.js';

interface Popup {
  panel: Panel;
  life: number;
}

export class DartsSystem extends createSystem({}) {
  private popups: Popup[] = [];
  private localBoard = new Map<string, BoardRow>();

  init(): void {
    this.cleanupFuncs.push(
      bus.on('dartScored', ({ segment, score }) => {
        uiClick();
        this.showPopup(pub.myName || 'YOU', pub.myAccent, segment, score);
        if (pub.online) {
          pubSendEvent({ e: 'DART_HIT', segment, score });
        } else {
          this.localScore(score);
        }
      }),
      bus.on('gameEvent', ({ from, ev }) => {
        if (ev.e !== 'DART_HIT' || from === pub.myId) return;
        const punter = pub.punters.get(from);
        this.showPopup(punter?.name ?? '???', punter?.accent ?? 0x9aa7bd, ev.segment, ev.score);
      }),
      bus.on('board', (rows) => this.renderBoard(rows)),
    );
    this.renderBoard([]);
  }

  update(delta: number): void {
    for (let i = this.popups.length - 1; i >= 0; i--) {
      const p = this.popups[i];
      p.life -= delta;
      p.panel.mesh.position.y += delta * 0.1;
      if (p.life <= 0) {
        this.scene.remove(p.panel.mesh);
        p.panel.dispose();
        this.popups.splice(i, 1);
      }
    }
  }

  private showPopup(name: string, accent: number, segment: string, score: number): void {
    const refs = pub.refs;
    if (!refs) return;
    const panel = new Panel(0.65, 0.14, 448);
    const hex = `#${accent.toString(16).padStart(6, '0')}`;
    panel.setLines([
      { text: `${name.toUpperCase()} — ${segment} — ${score} PTS`, size: 34, colour: hex, bold: true },
    ]);
    panel.mesh.position.copy(refs.dartboard.position);
    panel.mesh.position.y += 0.62;
    panel.mesh.position.x -= 0.1;
    panel.mesh.rotation.y = -Math.PI / 2;
    this.scene.add(panel.mesh);
    this.popups.push({ panel, life: 2.0 });
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
      ctx.font = '900 44px "Arial Black", system-ui, sans-serif';
      ctx.fillStyle = '#ffb000';
      ctx.textAlign = 'left';
      ctx.fillText('HOUSE DARTS', 28, 62);
      ctx.fillStyle = 'rgba(172,182,198,0.5)';
      ctx.fillRect(28, 78, w - 56, 3);
      ctx.font = '28px "Arial Narrow", system-ui, sans-serif';
      top.forEach((row, i) => {
        const y = 124 + i * 40;
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
        ctx.fillText('no arrows thrown yet', 28, 124);
      }
    });
  }
}
