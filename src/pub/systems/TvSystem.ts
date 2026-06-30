/**
 * The bar TV — live Discord chat.
 *
 * The pub server polls a Discord channel with a bot token (server-side only,
 * never the browser) and relays each message to the room; this system paints
 * them on the TV hung over the bar (pub.refs.pubTv) in a Discord-dark chat
 * style. It redraws only when the chat changes (a bus event), never per frame —
 * a canvas repaint is cheap but not free, and the TV is static between messages.
 *
 * With no relay configured (no token on the server) the screen just shows a
 * quiet "waiting" card, so the TV is never a bright blank.
 */

import { createSystem } from '@iwsdk/core';
import type { DiscordMsg } from '../protocol.js';
import { bus, pub } from '../state.js';

const HEADER_H = 58;
const PAD = 20;
const LINE_H = 30;
const FONT_PX = 23;

interface Token {
  text: string;
  color: string;
  bold: boolean;
}

function hex(n: number): string {
  return `#${(n & 0xffffff).toString(16).padStart(6, '0')}`;
}

const fontFor = (bold: boolean): string =>
  `${bold ? '700 ' : ''}${FONT_PX}px 'Arial Narrow', system-ui, sans-serif`;

/** Greedily wrap a message's coloured runs (author then content) into lines of
 *  tokens that each fit `maxW`. Keeps each word's colour/weight. */
function wrapMessage(ctx: CanvasRenderingContext2D, m: DiscordMsg, maxW: number): Token[][] {
  const tokens: Token[] = [{ text: m.author, color: hex(m.color), bold: true }];
  for (const w of m.content.split(/\s+/).filter(Boolean)) {
    tokens.push({ text: w, color: '#c9ccd1', bold: false });
  }
  const lines: Token[][] = [];
  let line: Token[] = [];
  let w = 0;
  for (const tok of tokens) {
    ctx.font = fontFor(tok.bold);
    const tw = ctx.measureText(tok.text + ' ').width;
    if (w + tw > maxW && line.length) {
      lines.push(line);
      line = [];
      w = 0;
    }
    line.push(tok);
    w += tw;
  }
  if (line.length) lines.push(line);
  return lines;
}

export class TvSystem extends createSystem({}) {
  init(): void {
    this.cleanupFuncs.push(
      bus.on('discord', () => this.render()),
      bus.on('connected', () => this.render()),
      bus.on('disconnected', () => this.render()),
    );
    this.render();
  }

  update(): void {
    /* static between messages — all redraws are event-driven */
  }

  private render(): void {
    const tv = pub.refs?.pubTv;
    if (!tv) return;
    tv.drawBare((ctx, w, h) => {
      // Screen body (Discord dark).
      ctx.fillStyle = '#1e1f22';
      ctx.fillRect(0, 0, w, h);

      // Header bar — blurple, channel label, a live dot.
      ctx.fillStyle = '#5865f2';
      ctx.fillRect(0, 0, w, HEADER_H);
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      ctx.fillStyle = '#ffffff';
      ctx.font = "700 26px 'Arial Narrow', system-ui, sans-serif";
      ctx.fillText('#  discord', PAD, HEADER_H / 2 + 2);
      const live = pub.online && pub.discord.length > 0;
      ctx.fillStyle = live ? '#3ba55d' : '#a0a4ab';
      ctx.beginPath();
      ctx.arc(w - PAD - 70, HEADER_H / 2, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.font = "700 20px 'Arial Narrow', system-ui, sans-serif";
      ctx.fillText(live ? 'LIVE' : 'OFF', w - PAD - 56, HEADER_H / 2 + 2);

      const top = HEADER_H + 14;
      const bottom = h - 14;
      const maxW = w - PAD * 2;

      if (pub.discord.length === 0) {
        ctx.textAlign = 'center';
        ctx.fillStyle = '#72767d';
        ctx.font = "400 26px 'Arial Narrow', system-ui, sans-serif";
        ctx.fillText(
          pub.online ? 'waiting for chat…' : 'tv offline — connecting…',
          w / 2,
          (top + bottom) / 2,
        );
        return;
      }

      // Build wrapped lines for every cached message (chronological), then show
      // the most recent that fit — newest at the bottom, like a chat.
      const allLines: Token[][] = [];
      for (const m of pub.discord) allLines.push(...wrapMessage(ctx, m, maxW));
      const maxLines = Math.max(1, Math.floor((bottom - top) / LINE_H));
      const shown = allLines.slice(-maxLines);
      let y = bottom - shown.length * LINE_H + LINE_H / 2;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      for (const line of shown) {
        let x = PAD;
        for (const tok of line) {
          ctx.font = fontFor(tok.bold);
          ctx.fillStyle = tok.color;
          ctx.fillText(tok.text, x, y);
          x += ctx.measureText(tok.text + ' ').width;
        }
        y += LINE_H;
      }
    });
  }
}
