/**
 * The fight HUD, third draft — everything on the WALL.
 *
 *  - WallBoard: one big fixed panel mounted at wall distance behind the
 *    creature's corner, like the gym's fight board: both health bars, the
 *    round pips, the clock, and the centre stage for countdown plates,
 *    round-rest cards and verdict art. Nothing floats over the creature;
 *    the board doesn't chase your head — it's furniture.
 *  - WristHud: YOUR health duplicated on the back of your left wrist,
 *    glanceable in guard, flashing when you've just been tagged.
 *
 * Canvases redraw on state changes plus a 1 Hz clock tick, and every draw
 * marks its texture dirty (its predecessor forgot — the "health bar that
 * never worked" was one missing needsUpdate).
 */

import {
  CanvasTexture,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SRGBColorSpace,
  Vector3,
} from 'three';
import { COMBAT, GAME_TITLE } from '../config.js';
import { match, MAX_ROUNDS } from '../state.js';
import { countdownArt } from './countdownArt.js';
import { verdictArt } from './verdictArt.js';

function makeCanvasPlane(
  w: number,
  h: number,
  meshW: number,
): { mesh: Mesh; canvas: HTMLCanvasElement; g: CanvasRenderingContext2D; tex: CanvasTexture } {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d')!;
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  const mesh = new Mesh(
    new PlaneGeometry(meshW, meshW * (h / w)),
    new MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }),
  );
  mesh.renderOrder = 5;
  return { mesh, canvas, g, tex };
}

// ------------------------------------------------------------------- wall

const W = 1440;
const H = 620;

export class WallBoard {
  readonly group = new Group();
  private board = makeCanvasPlane(W, H, 2.9);
  private clockShown = -1;

  constructor() {
    this.group.add(this.board.mesh);
    this.draw();
  }

  /** Redraw when the match says so, or when the clock ticks. */
  update(): void {
    const clock = Math.ceil(match.timeLeft);
    if (match.boardDirty || (match.phase === 'fighting' && clock !== this.clockShown)) {
      this.clockShown = clock;
      match.boardDirty = false;
      this.draw();
    }
  }

  /**
   * One fighter's health bar with its NAME ABOVE it. Fills are mirrored
   * fighting-game style: the two bars drain toward the centre of the board
   * (goop anchored left, you anchored right).
   */
  private bar(
    x: number,
    y: number,
    w: number,
    h: number,
    frac: number,
    color: string,
    label: string,
    anchor: 'left' | 'right',
  ): void {
    const g = this.board.g;
    // Name above the bar, aligned to the bar's outer edge.
    g.fillStyle = 'rgba(238, 250, 238, 0.98)';
    g.font = '800 40px system-ui, sans-serif';
    g.textBaseline = 'alphabetic';
    g.textAlign = anchor;
    g.shadowColor = 'rgba(0, 0, 0, 0.75)';
    g.shadowBlur = 12;
    g.fillText(label, anchor === 'left' ? x + 4 : x + w - 4, y - 18);
    g.shadowBlur = 0;

    // Trough.
    g.fillStyle = 'rgba(10, 18, 12, 0.9)';
    g.beginPath();
    g.roundRect(x, y, w, h, h / 2);
    g.fill();
    g.strokeStyle = 'rgba(140, 255, 150, 0.25)';
    g.lineWidth = 3;
    g.stroke();

    // Fill, drawn from the anchored (outer) edge toward the centre.
    const fw = Math.max(0, Math.min(1, frac)) * (w - 12);
    if (fw > 2) {
      const fx = anchor === 'left' ? x + 6 : x + w - 6 - fw;
      const grad = g.createLinearGradient(x, y, x, y + h);
      grad.addColorStop(0, color);
      grad.addColorStop(1, 'rgba(0,0,0,0.35)');
      g.fillStyle = grad;
      g.beginPath();
      g.roundRect(fx, y + 6, fw, h - 12, (h - 12) / 2);
      g.fill();
    }
  }

  private draw(): void {
    const g = this.board.g;
    g.clearRect(0, 0, W, H);
    // No panel — everything floats on transparent canvas. A soft dark glow
    // under each mark keeps it legible against passthrough.
    const cx = W / 2;

    // Title + round state, centred at the top.
    g.textAlign = 'center';
    g.textBaseline = 'top';
    g.shadowColor = 'rgba(0, 0, 0, 0.75)';
    g.shadowBlur = 14;
    g.font = '900 58px system-ui, sans-serif';
    g.fillStyle = '#6dff7e';
    g.fillText(GAME_TITLE, cx, 22);

    const inMatch = match.phase !== 'lobby';
    if (inMatch) {
      g.font = '800 34px system-ui, sans-serif';
      g.textBaseline = 'middle';
      g.fillStyle = 'rgba(238, 250, 238, 0.9)';
      const clock = match.phase === 'fighting' ? ` · ${Math.max(0, Math.ceil(match.timeLeft))}` : '';
      g.fillText(`ROUND ${Math.min(match.round, MAX_ROUNDS)} OF ${MAX_ROUNDS}${clock}`, cx, 108);
    }
    g.shadowBlur = 0;

    // --- SEPARATED health bars, side by side, names above ---
    const barW = 560;
    const barH = 84;
    const barY = 210;
    // Goop on the left (drains toward centre), you on the right.
    this.bar(70, barY, barW, barH, match.creatureHp / COMBAT.creatureHealth, 'rgba(74, 222, 96, 0.95)', 'THE GOOP', 'left');
    this.bar(W - 70 - barW, barY, barW, barH, match.playerHp / COMBAT.playerHealth, 'rgba(255, 176, 58, 0.95)', 'YOU', 'right');

    // Round pips under each bar (goop left, you right).
    if (inMatch) {
      const pip = (px: number, py: number, won: boolean, color: string) => {
        g.beginPath();
        g.arc(px, py, 12, 0, Math.PI * 2);
        g.fillStyle = won ? color : 'rgba(238, 250, 238, 0.16)';
        g.fill();
        g.strokeStyle = 'rgba(238, 250, 238, 0.4)';
        g.lineWidth = 2;
        g.stroke();
      };
      const pipY = barY + barH + 30;
      for (let i = 0; i < MAX_ROUNDS - 1; i++) {
        pip(84 + i * 40, pipY, i < match.creatureRounds, 'rgba(74, 222, 96, 0.95)');
        pip(W - 84 - i * 40, pipY, i < match.playerRounds, 'rgba(255, 176, 58, 0.95)');
      }
    }

    // Centre stage — countdown / round-rest / verdict, in the lower middle.
    // Text carries a soft dark glow so it reads while floating over the room.
    const cy = 468;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.shadowColor = 'rgba(0, 0, 0, 0.75)';
    g.shadowBlur = 16;
    if (match.phase === 'countdown') {
      const beat = Math.min(3, Math.floor(match.countdownT / COMBAT.countdownBeat));
      const msg = ['3', '2', '1', 'FIGHT'][beat];
      const art = countdownArt(msg);
      if (art) {
        const s = Math.min(300 / art.height, 1240 / art.width);
        g.drawImage(art, cx - (art.width * s) / 2, cy - (art.height * s) / 2, art.width * s, art.height * s);
      } else {
        g.font = '900 240px system-ui, sans-serif';
        g.fillStyle = '#f2fff0';
        g.fillText(msg, cx, cy);
      }
    } else if (match.phase === 'roundEnd') {
      g.font = '900 68px system-ui, sans-serif';
      g.fillStyle =
        match.lastRound === 'player' ? '#ffb03a' : match.lastRound === 'creature' ? '#6dff7e' : '#f2fff0';
      g.fillText(
        match.lastRound === 'player'
          ? `YOU TAKE ROUND ${match.round}`
          : match.lastRound === 'creature'
            ? `THE GOOP TAKES ROUND ${match.round}`
            : `ROUND ${match.round} IS EVEN`,
        cx,
        cy - 25,
      );
      g.font = '700 34px system-ui, sans-serif';
      g.fillStyle = 'rgba(238, 250, 238, 0.7)';
      g.fillText('breathe — it certainly isn’t', cx, cy + 50);
    } else if (match.phase === 'verdict' && match.verdict) {
      const key = match.verdict === 'win' ? 'win' : match.verdict === 'draw' ? 'draw' : 'ko';
      const art = verdictArt(key);
      if (art) {
        const s = Math.min(280 / art.height, 1100 / art.width);
        g.drawImage(art, cx - (art.width * s) / 2, cy - 70 - (art.height * s) / 2, art.width * s, art.height * s);
      } else {
        g.font = '900 190px system-ui, sans-serif';
        g.fillStyle = key === 'ko' ? '#ff7a5c' : '#f2fff0';
        g.fillText(key.toUpperCase(), cx, cy - 70);
      }
      g.font = '700 40px system-ui, sans-serif';
      g.fillStyle = 'rgba(238, 250, 238, 0.9)';
      g.fillText(
        match.verdict === 'win' ? 'THE GOOP IS DOWN' : match.verdict === 'ko' ? 'THE GOOP TAKES IT' : 'NOBODY TAKES IT',
        cx,
        cy + 78,
      );
      g.font = '900 52px system-ui, sans-serif';
      g.fillStyle = '#f2fff0';
      g.fillText(`ROUNDS ${match.playerRounds} – ${match.creatureRounds}`, cx, cy + 140);
    } else if (match.phase === 'fighting') {
      // Fighting: the strip above already carries round + clock; keep the
      // stage clear so the wall reads calm mid-brawl.
    } else {
      g.font = '800 46px system-ui, sans-serif';
      g.fillStyle = 'rgba(238, 250, 238, 0.85)';
      g.fillText('WARM UP ON THE GOOP', cx, cy - 20);
      g.font = '600 30px system-ui, sans-serif';
      g.fillStyle = 'rgba(238, 250, 238, 0.5)';
      g.fillText('start from the menu · A also works', cx, cy + 40);
    }
    g.shadowBlur = 0;

    this.board.tex.needsUpdate = true;
  }
}

// -------------------------------------------------------------- countdown

const CD_W = 640;
const CD_H = 512;

/**
 * The big 3 / 2 / 1 / FIGHT, floating BARE in the air between you and the
 * goop during the countdown — just the glowing glyph, no panel, no frame.
 * Billboards to face you, draws over everything (no depth test) so it's
 * always readable, pops on each beat, and vanishes when the fight starts.
 */
export class CountdownPlate {
  readonly mesh: Mesh;
  private cd = makeCanvasPlane(CD_W, CD_H, 1.7);
  private beatShown = -2;
  /** True once the neon PNG (not the text fallback) was drawn for this beat. */
  private artDrawn = false;

  constructor() {
    this.mesh = this.cd.mesh;
    (this.mesh.material as MeshBasicMaterial).depthTest = false;
    this.mesh.renderOrder = 30;
    this.mesh.visible = false;
    this.draw();
  }

  update(playerHead: Vector3, creaturePos: Vector3): void {
    const on = match.phase === 'countdown';
    this.mesh.visible = on;
    if (!on) {
      this.beatShown = -2;
      return;
    }
    // Hang it in the space between you and the goop, at eye height.
    this.mesh.position.set(
      playerHead.x + (creaturePos.x - playerHead.x) * 0.5,
      1.5,
      playerHead.z + (creaturePos.z - playerHead.z) * 0.5,
    );
    this.mesh.lookAt(playerHead);

    const beat = Math.min(3, Math.floor(match.countdownT / COMBAT.countdownBeat));
    // Redraw on a beat change OR until the PNG finally decodes (so it never
    // stays stuck on the text fallback — that was "the 3 that isn't our png").
    if (beat !== this.beatShown || !this.artDrawn) {
      this.beatShown = beat;
      this.draw();
    }
    // A punchy pop at the top of each beat that settles quickly.
    const localT = match.countdownT - beat * COMBAT.countdownBeat;
    const pop = 1 + 0.35 * Math.max(0, 1 - localT / 0.28) ** 2;
    this.mesh.scale.set(pop, pop, pop);
  }

  private draw(): void {
    const g = this.cd.g;
    g.clearRect(0, 0, CD_W, CD_H);
    const beat = Math.max(0, Math.min(3, this.beatShown));
    const msg = ['3', '2', '1', 'FIGHT'][beat];
    const cx = CD_W / 2;
    const cy = CD_H / 2;
    const art = countdownArt(msg);
    if (art) {
      // The harvested plates are already transparent neon glyphs — just draw
      // the glyph big; the canvas stays transparent so it floats on its own.
      const s = Math.min((CD_H * 0.94) / art.height, (CD_W * 0.98) / art.width);
      g.drawImage(art, cx - (art.width * s) / 2, cy - (art.height * s) / 2, art.width * s, art.height * s);
      this.artDrawn = true;
    } else {
      // Fallback until the PNG decodes: bare glowing text, still no panel.
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      const green = msg === 'FIGHT';
      g.font = `900 ${green ? 210 : 400}px system-ui, sans-serif`;
      g.shadowColor = green ? 'rgba(109,255,126,0.9)' : 'rgba(180,255,190,0.85)';
      g.shadowBlur = 40;
      g.fillStyle = green ? '#6dff7e' : '#ffffff';
      g.fillText(msg, cx, cy);
      g.shadowBlur = 0;
      this.artDrawn = false;
    }
    this.cd.tex.needsUpdate = true;
  }
}
