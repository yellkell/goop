/**
 * The fight HUD, second draft — information lives where you're looking:
 *
 *  - CreatureHud.bar: a slim status strip floating just above the goop
 *    (its health, the round pips, the clock). It rides the creature, so
 *    reading it never means looking away from the thing punching you.
 *  - CreatureHud.plate: the ceremony board — 3/2/1/FIGHT plates, the
 *    round-rest card, the verdict art + score — billboarded on the line
 *    between you and the creature, only present when there's ceremony.
 *  - WristHud: YOUR health on the back of your left wrist, glanceable in
 *    guard position, flashing when you've just been tagged.
 *
 * All canvases are small and redraw only on state changes (plus a 1 Hz
 * clock tick) — canvas texture uploads are a real hitch source on Quest.
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
import { COMBAT } from '../config.js';
import type { GelCreature } from '../creature/GelCreature.js';
import { match, MAX_ROUNDS } from '../state.js';
import { countdownArt } from './countdownArt.js';
import { verdictArt } from './verdictArt.js';

const _pos = new Vector3();

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

// ---------------------------------------------------------------- creature

const BAR_W = 512;
const BAR_H = 110;
const PLATE_W = 768;
const PLATE_H = 460;

export class CreatureHud {
  readonly group = new Group();
  private bar = makeCanvasPlane(BAR_W, BAR_H, 0.66);
  private plate = makeCanvasPlane(PLATE_W, PLATE_H, 0.92);
  private clockShown = -1;
  private barY = 1.6;

  constructor() {
    this.group.add(this.bar.mesh);
    this.group.add(this.plate.mesh);
    this.drawBar();
    this.drawPlate();
  }

  update(dt: number, playerHead: Vector3, creature: GelCreature | null): void {
    const inFight = match.phase !== 'lobby';
    const ceremony =
      match.phase === 'countdown' || match.phase === 'roundEnd' || match.phase === 'verdict';
    this.bar.mesh.visible = inFight && !!creature;
    this.plate.mesh.visible = ceremony && !!creature;
    if (!creature) return;

    // The bar floats a hand above the creature's current crown, riding its
    // form changes smoothly (never diving into the puddle with it).
    creature.headWorld(_pos);
    const targetY = Math.max(1.45, _pos.y + 0.42);
    this.barY += (targetY - this.barY) * Math.min(1, dt * 5);
    this.bar.mesh.position.set(creature.position.x, this.barY, creature.position.z);
    this.bar.mesh.lookAt(playerHead);

    // The ceremony plate sits on the line between you and it, chest height.
    if (this.plate.mesh.visible) {
      _pos.set(playerHead.x - creature.position.x, 0, playerHead.z - creature.position.z);
      const len = Math.max(_pos.length(), 1e-3);
      _pos.multiplyScalar(0.55 / len);
      this.plate.mesh.position.set(
        creature.position.x + _pos.x,
        1.45,
        creature.position.z + _pos.z,
      );
      this.plate.mesh.lookAt(playerHead);
    }

    const clock = Math.ceil(match.timeLeft);
    if (match.boardDirty || (match.phase === 'fighting' && clock !== this.clockShown)) {
      this.clockShown = clock;
      match.boardDirty = false;
      this.drawBar();
      this.drawPlate();
    }
  }

  private drawBar(): void {
    const g = this.bar.g;
    g.clearRect(0, 0, BAR_W, BAR_H);

    // Backing pill.
    g.fillStyle = 'rgba(8, 14, 10, 0.72)';
    g.beginPath();
    g.roundRect(4, 4, BAR_W - 8, BAR_H - 8, 26);
    g.fill();
    g.strokeStyle = 'rgba(109, 255, 126, 0.45)';
    g.lineWidth = 3;
    g.stroke();

    // Goop health trough + fill.
    const bx = 18;
    const by = 16;
    const bw = BAR_W - 36;
    const bh = 44;
    g.fillStyle = 'rgba(10, 18, 12, 0.9)';
    g.beginPath();
    g.roundRect(bx, by, bw, bh, bh / 2);
    g.fill();
    const frac = Math.max(0, match.creatureHp / COMBAT.creatureHealth);
    if (frac > 0.01) {
      const grad = g.createLinearGradient(0, by, 0, by + bh);
      grad.addColorStop(0, 'rgba(94, 240, 112, 0.95)');
      grad.addColorStop(1, 'rgba(30, 130, 52, 0.95)');
      g.fillStyle = grad;
      g.beginPath();
      g.roundRect(bx + 4, by + 4, (bw - 8) * frac, bh - 8, (bh - 8) / 2);
      g.fill();
    }
    g.fillStyle = 'rgba(238, 250, 238, 0.95)';
    g.font = '800 26px system-ui, sans-serif';
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.fillText('THE GOOP', bx + 16, by + bh / 2 + 1);

    // Bottom strip: its round pips · round + clock · your round pips.
    const y2 = 86;
    g.textAlign = 'center';
    g.font = '800 24px system-ui, sans-serif';
    g.fillStyle = 'rgba(238, 250, 238, 0.85)';
    const clock = match.phase === 'fighting' ? ` · ${Math.max(0, Math.ceil(match.timeLeft))}` : '';
    g.fillText(`R${Math.min(match.round, MAX_ROUNDS)}${clock}`, BAR_W / 2, y2);
    const pip = (x: number, won: boolean, color: string) => {
      g.beginPath();
      g.arc(x, y2, 9, 0, Math.PI * 2);
      g.fillStyle = won ? color : 'rgba(238, 250, 238, 0.18)';
      g.fill();
    };
    for (let i = 0; i < MAX_ROUNDS - 1; i++) {
      pip(46 + i * 30, i < match.creatureRounds, 'rgba(94, 240, 112, 0.95)');
      pip(BAR_W - 46 - i * 30, i < match.playerRounds, 'rgba(255, 176, 58, 0.95)');
    }
  }

  private drawPlate(): void {
    const g = this.plate.g;
    g.clearRect(0, 0, PLATE_W, PLATE_H);
    if (!this.plate.mesh.visible && match.phase === 'fighting') return;

    const cx = PLATE_W / 2;
    const cy = PLATE_H / 2;

    if (match.phase === 'countdown') {
      const beat = Math.min(3, Math.floor(match.countdownT / COMBAT.countdownBeat));
      const msg = ['3', '2', '1', 'FIGHT'][beat];
      const art = countdownArt(msg);
      if (art) {
        const s = Math.min(320 / art.height, 700 / art.width);
        g.drawImage(art, cx - (art.width * s) / 2, cy - (art.height * s) / 2, art.width * s, art.height * s);
      } else {
        g.font = '900 220px system-ui, sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillStyle = '#f2fff0';
        g.shadowColor = 'rgba(0,0,0,0.6)';
        g.shadowBlur = 24;
        g.fillText(msg, cx, cy);
        g.shadowBlur = 0;
      }
    } else if (match.phase === 'roundEnd') {
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.font = '900 64px system-ui, sans-serif';
      g.fillStyle =
        match.lastRound === 'player' ? '#ffb03a' : match.lastRound === 'creature' ? '#6dff7e' : '#f2fff0';
      g.shadowColor = 'rgba(0,0,0,0.7)';
      g.shadowBlur = 18;
      g.fillText(
        match.lastRound === 'player'
          ? `YOU TAKE ROUND ${match.round}`
          : match.lastRound === 'creature'
            ? `THE GOOP TAKES ROUND ${match.round}`
            : `ROUND ${match.round} IS EVEN`,
        cx,
        cy - 30,
      );
      g.font = '700 34px system-ui, sans-serif';
      g.fillStyle = 'rgba(238, 250, 238, 0.85)';
      g.fillText('breathe — it certainly isn’t', cx, cy + 50);
      g.shadowBlur = 0;
    } else if (match.phase === 'verdict' && match.verdict) {
      const key = match.verdict === 'win' ? 'win' : match.verdict === 'draw' ? 'draw' : 'ko';
      const art = verdictArt(key);
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      if (art) {
        const s = Math.min(240 / art.height, 700 / art.width);
        g.drawImage(art, cx - (art.width * s) / 2, cy - 70 - (art.height * s) / 2, art.width * s, art.height * s);
      } else {
        g.font = '900 160px system-ui, sans-serif';
        g.fillStyle = key === 'ko' ? '#ff7a5c' : '#f2fff0';
        g.fillText(key.toUpperCase(), cx, cy - 70);
      }
      g.shadowColor = 'rgba(0,0,0,0.7)';
      g.shadowBlur = 14;
      g.font = '700 36px system-ui, sans-serif';
      g.fillStyle = 'rgba(238, 250, 238, 0.9)';
      g.fillText(
        match.verdict === 'win' ? 'THE GOOP IS DOWN' : match.verdict === 'ko' ? 'THE GOOP TAKES IT' : 'NOBODY TAKES IT',
        cx,
        cy + 78,
      );
      g.font = '900 46px system-ui, sans-serif';
      g.fillStyle = '#f2fff0';
      g.fillText(`ROUNDS ${match.playerRounds} – ${match.creatureRounds}`, cx, cy + 138);
      g.shadowBlur = 0;
    }
    this.plate.tex.needsUpdate = true;
  }
}

// ------------------------------------------------------------------ wrist

const WRIST_W = 256;
const WRIST_H = 88;

export class WristHud {
  readonly mesh: Mesh;
  private hud = makeCanvasPlane(WRIST_W, WRIST_H, 0.11);
  private hpShown = -1;
  private flashShown = 0;

  constructor() {
    this.mesh = this.hud.mesh;
    // Back of the left wrist, tilted up toward your face in guard.
    this.mesh.position.set(0, 0.045, 0.1);
    this.mesh.rotation.set(-Math.PI / 2.4, 0, 0);
    this.draw();
  }

  update(): void {
    this.mesh.visible = match.phase !== 'lobby';
    const flash = match.playerFlash > 0.03 ? 1 : 0;
    if (Math.ceil(match.playerHp) !== this.hpShown || flash !== this.flashShown) {
      this.hpShown = Math.ceil(match.playerHp);
      this.flashShown = flash;
      this.draw();
    }
  }

  private draw(): void {
    const g = this.hud.g;
    g.clearRect(0, 0, WRIST_W, WRIST_H);
    g.fillStyle = 'rgba(8, 14, 10, 0.78)';
    g.beginPath();
    g.roundRect(2, 2, WRIST_W - 4, WRIST_H - 4, 20);
    g.fill();
    g.strokeStyle = this.flashShown ? 'rgba(255, 84, 60, 0.95)' : 'rgba(255, 176, 58, 0.5)';
    g.lineWidth = this.flashShown ? 6 : 3;
    g.stroke();

    const bx = 14;
    const by = 30;
    const bw = WRIST_W - 28;
    const bh = 34;
    g.fillStyle = 'rgba(10, 18, 12, 0.9)';
    g.beginPath();
    g.roundRect(bx, by, bw, bh, bh / 2);
    g.fill();
    const frac = Math.max(0, match.playerHp / COMBAT.playerHealth);
    if (frac > 0.01) {
      g.fillStyle = frac > 0.35 ? 'rgba(255, 176, 58, 0.95)' : 'rgba(255, 84, 60, 0.95)';
      g.beginPath();
      g.roundRect(bx + 3, by + 3, (bw - 6) * frac, bh - 6, (bh - 6) / 2);
      g.fill();
    }
    g.font = '800 18px system-ui, sans-serif';
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.fillStyle = 'rgba(238, 250, 238, 0.9)';
    g.fillText('YOU', bx + 2, 16);
    g.textAlign = 'right';
    g.fillText(String(Math.max(0, Math.ceil(match.playerHp))), WRIST_W - 16, 16);
    this.hud.tex.needsUpdate = true;
  }
}
