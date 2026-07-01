/**
 * OCTO HUNT — the corner arcade cabinet (replaces IRON SNAKE).
 *
 * A light-gun shooter: NO joystick. You point your controller at the screen and
 * pull the trigger — a crosshair tracks your aim, scrap drones fly across the
 * glass, and you blast them before they escape. Walk up, feed a coin (trigger
 * near the slot, same as before), and one player holds the cabinet while the
 * whole room watches the screen live (the player streams it).
 *
 * It reuses the SNAKE_* broker wholesale: the server's single-player claim
 * (claim-snake / snake-player), the persisted house record (SNAKE_OVER →
 * pub.snakeHi), and the coin slot id 'snake'. Only the on-screen game + its
 * spectator stream (HUNT_STATE) are new, so no server change is needed.
 */

import { createSystem, InputComponent } from '@iwsdk/core';
import { CanvasTexture, MeshBasicMaterial, Quaternion, Raycaster, SRGBColorSpace, Vector3 } from 'three';
import { huntEscape, huntHit, huntOver, huntShot, uiClick } from '../../audio/sfx.js';
import { pubSendEvent, pubSendRaw } from '../net.js';
import { bus, pub } from '../state.js';

const W = 384;
const H = 300; // ~matches the 0.46 × 0.36 screen plane
const HEADER = 40;

const REACH = 1.7; // how close you must stand to play
const START_LIVES = 3;
const STREAM_HZ = 12; // spectator stream rate
const DEAD_HOLD = 3.6; // seconds the GAME OVER screen lingers
const FORGIVE = 5; // px of aim forgiveness added to a drone's hit radius

/** Drone archetypes: [radius px, speed px/s, points, body colour, eye colour]. */
const KINDS = [
  { r: 19, speed: 66, points: 10, body: '#c24a2e', eye: '#ffd0a0' }, // grunt — common
  { r: 12, speed: 124, points: 25, body: '#1f9fd0', eye: '#d6f4ff' }, // scout — fast, small
  { r: 27, speed: 40, points: 5, body: '#b98410', eye: '#ffe9a0' }, // hauler — big, slow
] as const;
/** Spawn weighting (indices into KINDS) — grunts most, then scouts, then haulers. */
const SPAWN_BAG = [0, 0, 0, 0, 1, 1, 2];

interface Drone {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  kind: number;
  points: number;
}

interface Burst {
  x: number;
  y: number;
  t: number; // seconds alive
  color: string;
}

type Phase = 'attract' | 'playing' | 'dead' | 'watching';
type Hand = 'left' | 'right';
const HANDS: Hand[] = ['left', 'right'];

const _cab = new Vector3();
const _head = new Vector3();
const _o = new Vector3();
const _dir = new Vector3();
const _q = new Quaternion();

export class DroneHuntSystem extends createSystem({}) {
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private texture!: CanvasTexture;
  private ray = new Raycaster();

  private phase: Phase = 'attract';
  private drones: Drone[] = [];
  private bursts: Burst[] = [];
  private cross: [number, number] | null = null;
  private muzzle = 0; // seconds left on the muzzle flash
  private score = 0;
  private lives = START_LIVES;
  private combo = 0;
  private spawnTimer = 0;
  private streamTimer = 0;
  private deadTimer = 0;
  private attractTimer = 0;
  private pendingClaim = false;
  private hoverShown = false;
  /** Per-hand screen hit this frame (canvas px) while aiming, or null. */
  private aim: Record<Hand, [number, number] | null> = { left: null, right: null };
  private startKey = false;

  init(): void {
    this.canvas = document.createElement('canvas');
    this.canvas.width = W;
    this.canvas.height = H;
    this.ctx = this.canvas.getContext('2d')!;
    this.texture = new CanvasTexture(this.canvas);
    this.texture.colorSpace = SRGBColorSpace;
    const screen = pub.refs!.arcadeScreen;
    const mat = screen.material as MeshBasicMaterial;
    mat.map = this.texture;
    mat.color.set(0xffffff);
    mat.needsUpdate = true;

    // No joystick on this cabinet any more — hide the (hated) stick.
    pub.refs!.snakeStick.visible = false;

    window.addEventListener('keydown', this.onKey);

    this.cleanupFuncs.push(
      () => window.removeEventListener('keydown', this.onKey),
      bus.on('snakePlayer', (id) => {
        if (this.pendingClaim && id === pub.myId) {
          this.pendingClaim = false;
          this.startGame();
        } else if (id && id !== pub.myId) {
          this.phase = 'watching';
        } else if (!id && this.phase === 'watching') {
          this.phase = 'attract';
        }
      }),
      bus.on('snakeHi', () => {
        if (this.phase === 'attract') this.drawAttract();
      }),
      // A coin fed into the cabinet buys one game (slot id is still 'snake').
      bus.on('coinInserted', (target) => {
        if (target === 'snake') this.insertCoin();
      }),
      bus.on('gameEvent', ({ from, ev }) => {
        if (ev.e !== 'HUNT_STATE' || from === pub.myId) return;
        // If I'm the one holding the cabinet, ignore stray stream packets so a
        // late one can't bump me out of my own game.
        if (this.phase === 'playing' || this.phase === 'dead' || pub.snakePlayer === pub.myId) return;
        this.phase = ev.dead ? 'attract' : 'watching';
        this.drones = ev.drones.map(([x, y, r, kind]) => ({ x, y, vx: 0, vy: 0, r, kind, points: 0 }));
        this.cross = ev.cross;
        this.score = ev.score;
        this.lives = ev.lives;
        this.combo = ev.combo;
        this.bursts.length = 0;
        this.muzzle = 0;
        this.drawGame(ev.dead);
      }),
    );

    this.drawAttract();
  }

  update(delta: number): void {
    switch (this.phase) {
      case 'attract': {
        this.attractTimer += delta;
        const hovering = pub.coinHover === 'snake';
        if (this.attractTimer > 0.5 || hovering !== this.hoverShown) {
          this.attractTimer = 0;
          this.hoverShown = hovering;
          this.drawAttract();
        }
        if (this.startKey && this.nearCabinet()) this.insertCoin();
        break;
      }
      case 'playing':
        this.stepGame(delta);
        break;
      case 'dead': {
        this.deadTimer += delta;
        this.fadeBursts(delta);
        if (this.deadTimer > DEAD_HOLD) {
          this.phase = 'attract';
          if (pub.online) pubSendRaw({ t: 'leave-snake' });
        }
        break;
      }
      case 'watching':
        break;
    }
    this.startKey = false;
  }

  // --- claiming the machine ---------------------------------------------------

  private nearCabinet(): boolean {
    const [cx, , cz] = pub.refs!.arcadePos;
    _cab.set(cx, 0, cz);
    this.player.head.getWorldPosition(_head);
    _head.y = 0;
    return _head.distanceTo(_cab) < REACH;
  }

  private insertCoin(): void {
    if (this.phase !== 'attract') return;
    if (pub.snakePlayer && pub.snakePlayer !== pub.myId) return; // occupied
    uiClick();
    if (!pub.online) {
      this.startGame();
      return;
    }
    this.pendingClaim = true;
    pubSendRaw({ t: 'claim-snake' });
  }

  private startGame(): void {
    this.drones = [];
    this.bursts = [];
    this.cross = null;
    this.muzzle = 0;
    this.score = 0;
    this.lives = START_LIVES;
    this.combo = 0;
    this.spawnTimer = 0.4;
    this.streamTimer = 0;
    this.phase = 'playing';
    this.drawGame(false);
  }

  // --- the game ---------------------------------------------------------------

  private stepGame(delta: number): void {
    this.readAim();
    this.fire();

    // Difficulty ramps with score: drones come faster and quicker.
    const speedK = 1 + Math.min(1.1, this.score / 4000);
    const interval = Math.max(0.45, 1.35 - this.score / 1800);
    this.spawnTimer -= delta;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = interval;
      this.spawnDrone(speedK);
    }

    // Move drones; one that fully clears the glass has ESCAPED — costs a life.
    for (let i = this.drones.length - 1; i >= 0; i--) {
      const d = this.drones[i];
      d.x += d.vx * delta;
      d.y += d.vy * delta;
      const m = d.r + 6;
      if (d.x < -m || d.x > W + m || d.y < HEADER - m || d.y > H + m) {
        this.drones.splice(i, 1);
        this.combo = 0;
        this.lives -= 1;
        huntEscape();
        if (this.lives <= 0) {
          this.gameOver();
          return;
        }
      }
    }

    if (this.muzzle > 0) this.muzzle = Math.max(0, this.muzzle - delta);
    this.fadeBursts(delta);
    this.drawGame(false);

    this.streamTimer -= delta;
    if (pub.online && this.streamTimer <= 0) {
      this.streamTimer = 1 / STREAM_HZ;
      this.streamState(false);
    }
  }

  private spawnDrone(speedK: number): void {
    const kind = SPAWN_BAG[Math.floor(Math.random() * SPAWN_BAG.length)];
    const k = KINDS[kind];
    const playH = H - HEADER;
    // Start just off a random edge, aim at a random point in the glass so it
    // crosses through and exits the far side if it isn't shot.
    const edge = Math.floor(Math.random() * 4);
    let x = 0;
    let y = 0;
    if (edge === 0) { x = Math.random() * W; y = HEADER - k.r; }
    else if (edge === 1) { x = W + k.r; y = HEADER + Math.random() * playH; }
    else if (edge === 2) { x = Math.random() * W; y = H + k.r; }
    else { x = -k.r; y = HEADER + Math.random() * playH; }
    const tx = W * (0.25 + Math.random() * 0.5);
    const ty = HEADER + playH * (0.25 + Math.random() * 0.5);
    const dx = tx - x;
    const dy = ty - y;
    const len = Math.hypot(dx, dy) || 1;
    const speed = k.speed * speedK;
    this.drones.push({ x, y, vx: (dx / len) * speed, vy: (dy / len) * speed, r: k.r, kind, points: k.points });
  }

  /** Project both controller rays onto the screen → crosshair (canvas px). */
  private readAim(): void {
    const screen = pub.refs!.arcadeScreen;
    this.aim.left = null;
    this.aim.right = null;
    let cross: [number, number] | null = null;
    for (const hand of HANDS) {
      const rayspace = this.player.raySpaces?.[hand];
      if (!rayspace) continue;
      rayspace.getWorldPosition(_o);
      rayspace.getWorldQuaternion(_q);
      _dir.set(0, 0, -1).applyQuaternion(_q).normalize();
      this.ray.set(_o, _dir);
      this.ray.far = 6;
      const hit = this.ray.intersectObject(screen, false)[0];
      if (!hit || !hit.uv) continue;
      const sx = hit.uv.x * W;
      const sy = (1 - hit.uv.y) * H;
      this.aim[hand] = [sx, sy];
      // Right hand wins the crosshair if both are on the glass.
      if (!cross || hand === 'right') cross = [sx, sy];
    }
    this.cross = cross;
  }

  private fire(): void {
    for (const hand of HANDS) {
      const gp = this.input.xr.gamepads[hand];
      const at = this.aim[hand];
      if (!at || !gp?.getButtonDown(InputComponent.Trigger)) continue;
      huntShot();
      this.muzzle = 0.06;
      // Kill the nearest drone whose body is under the shot.
      let best = -1;
      let bestD = Infinity;
      for (let i = 0; i < this.drones.length; i++) {
        const d = this.drones[i];
        const dd = (d.x - at[0]) ** 2 + (d.y - at[1]) ** 2;
        const reach = d.r + FORGIVE;
        if (dd <= reach * reach && dd < bestD) {
          bestD = dd;
          best = i;
        }
      }
      if (best >= 0) {
        const d = this.drones.splice(best, 1)[0];
        this.combo += 1;
        const mult = Math.min(4, 1 + Math.floor((this.combo - 1) / 4));
        this.score += d.points * mult;
        this.bursts.push({ x: d.x, y: d.y, t: 0, color: KINDS[d.kind].eye });
        huntHit();
      } else {
        this.combo = 0; // a miss breaks the streak
      }
    }
  }

  private gameOver(): void {
    huntOver();
    this.phase = 'dead';
    this.deadTimer = 0;
    this.cross = null;
    this.drawGame(true);
    if (pub.online) {
      this.streamState(true);
      pubSendEvent({ e: 'SNAKE_OVER', score: this.score });
    } else if (this.score > this.localHi().score) {
      localStorage.setItem('ibb-pub-snake-hi', JSON.stringify({ name: pub.myName || 'YOU', score: this.score }));
      pub.snakeHi = this.localHi();
    }
  }

  private streamState(dead: boolean): void {
    pubSendEvent({
      e: 'HUNT_STATE',
      drones: this.drones.map((d) => [Math.round(d.x), Math.round(d.y), d.r, d.kind] as [number, number, number, number]),
      cross: this.cross,
      score: this.score,
      lives: this.lives,
      combo: this.combo,
      dead,
    });
  }

  private fadeBursts(delta: number): void {
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      this.bursts[i].t += delta;
      if (this.bursts[i].t > 0.4) this.bursts.splice(i, 1);
    }
  }

  private localHi(): { name: string; score: number } {
    try {
      const raw = localStorage.getItem('ibb-pub-snake-hi');
      if (raw) return JSON.parse(raw) as { name: string; score: number };
    } catch {
      /* fall through */
    }
    return { name: '—', score: 0 };
  }

  private hi(): { name: string; score: number } {
    return pub.online ? pub.snakeHi : this.localHi();
  }

  // --- drawing ----------------------------------------------------------------

  private drawShell(): void {
    const ctx = this.ctx;
    ctx.fillStyle = '#0a0c12';
    ctx.fillRect(0, 0, W, H);
    // Faint targeting grid in the play area.
    ctx.strokeStyle = 'rgba(80,150,180,0.10)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= W; x += 48) {
      ctx.beginPath();
      ctx.moveTo(x, HEADER);
      ctx.lineTo(x, H);
      ctx.stroke();
    }
    for (let y = HEADER; y <= H; y += 48) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }
    // Header bar.
    ctx.fillStyle = '#11161f';
    ctx.fillRect(0, 0, W, HEADER - 4);
    ctx.strokeStyle = '#ff8c1a';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, W - 2, H - 2);
    // Scanlines.
    ctx.fillStyle = 'rgba(0,0,0,0.16)';
    for (let y = 0; y < H; y += 3) ctx.fillRect(0, y, W, 1);
  }

  private drawDrone(d: { x: number; y: number; r: number; kind: number }): void {
    const ctx = this.ctx;
    const k = KINDS[d.kind];
    ctx.save();
    ctx.translate(d.x, d.y);
    // Octagon body (flat top/bottom) — the "octo" you're hunting.
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      const px = Math.cos(a) * d.r;
      const py = Math.sin(a) * d.r;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle = k.body;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.stroke();
    // Glowing eye.
    ctx.beginPath();
    ctx.arc(0, 0, d.r * 0.4, 0, Math.PI * 2);
    ctx.fillStyle = k.eye;
    ctx.fill();
    ctx.restore();
  }

  private drawGame(dead: boolean): void {
    this.drawShell();
    const ctx = this.ctx;

    // Header: score / combo / lives.
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.font = 'bold 20px "Courier New", monospace';
    ctx.fillStyle = '#ff8c1a';
    ctx.fillText(`${this.score}`, 10, 27);
    if (this.combo >= 4 && !dead) {
      const mult = Math.min(4, 1 + Math.floor((this.combo - 1) / 4));
      ctx.font = 'bold 15px "Courier New", monospace';
      ctx.fillStyle = '#39d0ff';
      ctx.fillText(`x${mult}`, 70, 26);
    }
    // Lives as little pips on the right.
    for (let i = 0; i < START_LIVES; i++) {
      ctx.fillStyle = i < this.lives ? '#ff5a3c' : 'rgba(255,90,60,0.2)';
      ctx.beginPath();
      ctx.arc(W - 18 - i * 18, 18, 6, 0, Math.PI * 2);
      ctx.fill();
    }

    // Clip drones + their explosions to the interior play field, so nothing
    // ever draws over the amber border frame or up into the header — a drone at
    // the edge slides under the frame instead of overlapping it.
    ctx.save();
    ctx.beginPath();
    ctx.rect(3, HEADER, W - 6, H - 3 - HEADER);
    ctx.clip();
    for (const d of this.drones) this.drawDrone(d);
    for (const b of this.bursts) {
      const p = b.t / 0.4;
      ctx.strokeStyle = b.color;
      ctx.globalAlpha = 1 - p;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(b.x, b.y, 6 + p * 22, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.restore();

    if (this.cross && !dead) this.drawCrosshair(this.cross[0], this.cross[1]);

    if (dead) {
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ff5a3c';
      ctx.font = '900 34px "Courier New", monospace';
      ctx.fillText('GAME OVER', W / 2, H / 2 + 2);
      const hi = this.hi();
      const record = this.score >= hi.score && this.score > 0;
      ctx.font = 'bold 18px "Courier New", monospace';
      ctx.fillStyle = record ? '#ff8c1a' : '#9fc4d6';
      ctx.fillText(
        record ? 'NEW HOUSE RECORD!' : `HI ${hi.score} — ${hi.name.slice(0, 10).toUpperCase()}`,
        W / 2,
        H / 2 + 34,
      );
    }
    this.texture.needsUpdate = true;
  }

  private drawCrosshair(x: number, y: number): void {
    const ctx = this.ctx;
    const flash = this.muzzle > 0;
    ctx.strokeStyle = flash ? '#ffffff' : '#ff8c1a';
    ctx.lineWidth = flash ? 3 : 2;
    ctx.beginPath();
    ctx.arc(x, y, 11, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    for (const [dx, dy] of [
      [-18, 0],
      [18, 0],
      [0, -18],
      [0, 18],
    ] as const) {
      ctx.moveTo(x + Math.sign(dx) * 6, y + Math.sign(dy) * 6);
      ctx.lineTo(x + dx, y + dy);
    }
    ctx.stroke();
    if (flash) {
      ctx.fillStyle = 'rgba(255,240,200,0.6)';
      ctx.beginPath();
      ctx.arc(x, y, 7, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawAttract(): void {
    this.drawShell();
    const ctx = this.ctx;
    const hi = this.hi();
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ff8c1a';
    ctx.font = '900 38px "Courier New", monospace';
    ctx.fillText('OCTO HUNT', W / 2, 96);
    ctx.font = '16px "Courier New", monospace';
    ctx.fillStyle = '#9fc4d6';
    ctx.fillText(`HI-SCORE  ${hi.score}  ${hi.name.slice(0, 10).toUpperCase()}`, W / 2, 134);

    const occupied = pub.snakePlayer && pub.snakePlayer !== pub.myId;
    const blink = Math.floor(performance.now() / 600) % 2 === 0;
    const hovering = pub.coinHover === 'snake';
    if (occupied) {
      if (blink) {
        ctx.fillStyle = '#ff5a3c';
        ctx.fillText('MACHINE IN USE', W / 2, 196);
      }
    } else if (hovering || blink) {
      ctx.fillStyle = hovering ? '#ffcf6a' : '#ff8c1a';
      ctx.fillText('INSERT COIN', W / 2, 196);
      if (hovering) {
        ctx.strokeStyle = '#ff8c1a';
        ctx.lineWidth = 2;
        ctx.strokeRect(W / 2 - 104, 178, 208, 30);
      }
    }
    ctx.fillStyle = '#5a7280';
    ctx.font = '15px "Courier New", monospace';
    ctx.fillText('AIM · PULL TRIGGER · DROP THE DRONES', W / 2, 242);
    this.texture.needsUpdate = true;
  }

  // Desktop dev: Enter drops a free coin when stood close.
  private onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Enter') this.startKey = true;
  };
}
