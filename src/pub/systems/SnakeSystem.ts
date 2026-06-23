/**
 * IRON SNAKE — the corner arcade cabinet.
 *
 * One punter plays at a time (the server brokers the claim); everyone else
 * sees the same screen live, because the player streams the grid state every
 * tick. Walk up to the cabinet and pull the trigger to put your coin in,
 * then steer with the CABINET'S OWN JOYSTICK — put your hand on the red
 * ball and push it around; the stick tilts under your palm. (Arrow keys
 * still work on desktop. The thumbstick is reserved for teleporting.)
 * The high score is the server's — it survives restarts in
 * server/pub-data.json. Offline you still get the game, with the high score
 * kept in localStorage.
 */

import { createSystem } from '@iwsdk/core';
import { CanvasTexture, MeshBasicMaterial, SRGBColorSpace, Vector3 } from 'three';
import { uiClick, wallThud } from '../../audio/sfx.js';
import { pubSendEvent, pubSendRaw } from '../net.js';
import { bus, pub } from '../state.js';

const COLS = 20;
const ROWS = 13;
const CELL = 16;
const HEADER = 48;
const W = COLS * CELL; // 320
const H = HEADER + ROWS * CELL; // 256

const TICK = 0.16; // seconds per snake step
const REACH = 1.6; // how close you must stand to play
const STICK_GRIP_RADIUS = 0.16; // hand within this of the joystick ball steers
const STICK_DEADZONE = 0.025; // metres of push before it counts
const STICK_TILT = 4.5; // push → visual tilt factor
const STICK_TILT_MAX = 0.45; // radians

type Phase = 'attract' | 'playing' | 'dead' | 'watching';
type Cell = [number, number];

const _cab = new Vector3();
const _head = new Vector3();
const _hand = new Vector3();

export class SnakeSystem extends createSystem({}) {
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private texture!: CanvasTexture;

  private phase: Phase = 'attract';
  private snake: Cell[] = [];
  private dir: Cell = [1, 0];
  private nextDir: Cell = [1, 0];
  private food: Cell = [10, 6];
  private score = 0;
  private tickTimer = 0;
  private deadTimer = 0;
  private attractTimer = 0;
  private pendingClaim = false;
  private keyDir: Cell | null = null;
  private keyStart = false;
  /** Whether the last attract redraw showed the coin-hover highlight. */
  private hoverShown = false;

  init(): void {
    this.canvas = document.createElement('canvas');
    this.canvas.width = W;
    this.canvas.height = H;
    this.ctx = this.canvas.getContext('2d')!;
    this.texture = new CanvasTexture(this.canvas);
    this.texture.colorSpace = SRGBColorSpace;
    const screen = pub.refs!.arcadeScreen;
    (screen.material as MeshBasicMaterial).map = this.texture;
    (screen.material as MeshBasicMaterial).color.set(0xffffff);
    (screen.material as MeshBasicMaterial).needsUpdate = true;

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
      // A coin fed into the cabinet buys one game.
      bus.on('coinInserted', (target) => {
        if (target === 'snake') this.insertCoin();
      }),
      bus.on('gameEvent', ({ from, ev }) => {
        if (ev.e !== 'SNAKE_STATE' || from === pub.myId) return;
        this.phase = 'watching';
        this.snake = ev.cells;
        this.food = ev.food;
        this.score = ev.score;
        this.drawGame(ev.dead);
        if (ev.dead) this.phase = 'attract';
      }),
    );

    this.drawAttract();
  }

  update(delta: number): void {
    // Spring the joystick back upright whenever nobody is playing.
    if (this.phase !== 'playing') {
      const stick = pub.refs!.snakeStick;
      const k = 1 - Math.exp(-10 * delta);
      stick.rotation.x -= stick.rotation.x * k;
      stick.rotation.z -= stick.rotation.z * k;
    }
    switch (this.phase) {
      case 'attract': {
        this.attractTimer += delta;
        const hovering = pub.coinHover === 'snake';
        if (this.attractTimer > 0.5 || hovering !== this.hoverShown) {
          this.attractTimer = 0;
          this.hoverShown = hovering;
          this.drawAttract();
        }
        // Desktop dev: Enter still drops a free coin when you're stood close.
        if (this.keyStart && this.nearCabinet()) this.insertCoin();
        break;
      }
      case 'playing': {
        this.readSteering(delta);
        this.tickTimer += delta;
        if (this.tickTimer >= TICK) {
          this.tickTimer = 0;
          this.step();
        }
        break;
      }
      case 'dead': {
        this.deadTimer += delta;
        if (this.deadTimer > 3) {
          this.phase = 'attract';
          if (pub.online) pubSendRaw({ t: 'leave-snake' });
        }
        break;
      }
      case 'watching':
        break;
    }
    this.keyStart = false;
  }

  // --- claiming the machine ---------------------------------------------------

  private nearCabinet(): boolean {
    const [cx, , cz] = pub.refs!.arcadePos;
    _cab.set(cx, 0, cz);
    this.player.head.getWorldPosition(_head);
    _head.y = 0;
    return _head.distanceTo(_cab) < REACH;
  }

  /** A coin went in: claim the machine if it's free and we're stood at it. */
  private insertCoin(): void {
    if (this.phase !== 'attract') return;
    if (pub.snakePlayer && pub.snakePlayer !== pub.myId) return; // occupied
    this.tryClaim();
  }

  private tryClaim(): void {
    uiClick();
    if (!pub.online) {
      this.startGame();
      return;
    }
    if (pub.snakePlayer && pub.snakePlayer !== pub.myId) return; // occupied
    this.pendingClaim = true;
    pubSendRaw({ t: 'claim-snake' });
  }

  private startGame(): void {
    this.snake = [
      [4, 6],
      [3, 6],
      [2, 6],
    ];
    this.dir = [1, 0];
    this.nextDir = [1, 0];
    this.score = 0;
    this.spawnFood();
    this.tickTimer = 0;
    this.phase = 'playing';
    this.drawGame(false);
  }

  // --- the game ----------------------------------------------------------------

  /**
   * The cabinet's joystick: find a hand on the stick ball, read its push in
   * CABINET-LOCAL space (so it works whatever way the cabinet faces), tilt
   * the stick mesh under the palm, and turn the dominant axis into a snake
   * direction. Pushing toward the screen is up; cabinet-right is right.
   */
  private readSteering(delta: number): void {
    const refs = pub.refs!;
    const stick = refs.snakeStick;

    let pushX = 0; // cabinet-local right
    let pushZ = 0; // cabinet-local toward player (+) / screen (−)
    for (const hand of ['left', 'right'] as const) {
      const grip = this.player.gripSpaces[hand];
      if (!grip) continue;
      grip.getWorldPosition(_hand);
      refs.arcadeCabinet.worldToLocal(_hand);
      const ox = _hand.x - stick.position.x;
      const oy = _hand.y - (stick.position.y + 0.1); // the ball at the top
      const oz = _hand.z - stick.position.z;
      if (ox * ox + oy * oy + oz * oz <= STICK_GRIP_RADIUS * STICK_GRIP_RADIUS) {
        pushX = ox;
        pushZ = oz;
        break;
      }
    }

    // Stick visual: tilt toward the push, spring back when untouched.
    const tiltX = Math.max(-STICK_TILT_MAX, Math.min(STICK_TILT_MAX, pushZ * STICK_TILT));
    const tiltZ = Math.max(-STICK_TILT_MAX, Math.min(STICK_TILT_MAX, -pushX * STICK_TILT));
    const k = 1 - Math.exp(-18 * delta);
    stick.rotation.x += (tiltX - stick.rotation.x) * k;
    stick.rotation.z += (tiltZ - stick.rotation.z) * k;

    let want: Cell | null = null;
    if (Math.abs(pushX) > STICK_DEADZONE || Math.abs(pushZ) > STICK_DEADZONE) {
      want =
        Math.abs(pushX) > Math.abs(pushZ)
          ? [Math.sign(pushX), 0]
          : [0, pushZ < 0 ? -1 : 1]; // toward the screen = up
    }
    if (this.keyDir) {
      want = this.keyDir;
      this.keyDir = null;
    }
    if (!want) return;
    // No reversing into yourself.
    if (want[0] === -this.dir[0] && want[1] === -this.dir[1]) return;
    this.nextDir = want;
  }

  private step(): void {
    this.dir = this.nextDir;
    const head = this.snake[0];
    // Wrap-around rules: run off one edge, slide in the opposite one —
    // only your own tail kills you.
    const next: Cell = [
      (head[0] + this.dir[0] + COLS) % COLS,
      (head[1] + this.dir[1] + ROWS) % ROWS,
    ];

    const hitSelf = this.snake.some(([x, y]) => x === next[0] && y === next[1]);
    if (hitSelf) {
      this.gameOver();
      return;
    }

    this.snake.unshift(next);
    if (next[0] === this.food[0] && next[1] === this.food[1]) {
      this.score += 10;
      uiClick();
      this.spawnFood();
    } else {
      this.snake.pop();
    }

    this.drawGame(false);
    if (pub.online) {
      pubSendEvent({
        e: 'SNAKE_STATE',
        cells: this.snake,
        food: this.food,
        score: this.score,
        dead: false,
      });
    }
  }

  private spawnFood(): void {
    do {
      this.food = [Math.floor(Math.random() * COLS), Math.floor(Math.random() * ROWS)];
    } while (this.snake.some(([x, y]) => x === this.food[0] && y === this.food[1]));
  }

  private gameOver(): void {
    wallThud();
    this.phase = 'dead';
    this.deadTimer = 0;
    this.drawGame(true);
    if (pub.online) {
      pubSendEvent({ e: 'SNAKE_STATE', cells: this.snake, food: this.food, score: this.score, dead: true });
      pubSendEvent({ e: 'SNAKE_OVER', score: this.score });
    } else if (this.score > this.localHi().score) {
      localStorage.setItem('ibb-pub-snake-hi', JSON.stringify({ name: pub.myName || 'YOU', score: this.score }));
      pub.snakeHi = this.localHi();
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

  // --- CRT drawing ---------------------------------------------------------------

  private hi(): { name: string; score: number } {
    return pub.online ? pub.snakeHi : this.localHi();
  }

  private drawShell(): void {
    const ctx = this.ctx;
    ctx.fillStyle = '#04120a';
    ctx.fillRect(0, 0, W, H);
    // Header bar.
    ctx.fillStyle = '#0a2a14';
    ctx.fillRect(0, 0, W, HEADER - 6);
    ctx.strokeStyle = '#1f8a3f';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, W - 2, H - 2);
    // Scanlines for the CRT feel.
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    for (let y = 0; y < H; y += 4) ctx.fillRect(0, y, W, 1);
  }

  private drawAttract(): void {
    this.drawShell();
    const ctx = this.ctx;
    const hi = this.hi();
    ctx.textAlign = 'center';
    ctx.fillStyle = '#39ff14';
    ctx.font = '900 34px "Courier New", monospace';
    ctx.fillText('IRON SNAKE', W / 2, 78);
    ctx.font = '16px "Courier New", monospace';
    ctx.fillStyle = '#9ee8a0';
    ctx.fillText(`HI-SCORE  ${hi.score}  ${hi.name.slice(0, 10).toUpperCase()}`, W / 2, 116);
    const occupied = pub.snakePlayer && pub.snakePlayer !== pub.myId;
    const blink = Math.floor(performance.now() / 600) % 2 === 0;
    const hovering = pub.coinHover === 'snake';
    if (occupied) {
      if (blink) {
        ctx.fillStyle = '#e8352a';
        ctx.fillText('MACHINE IN USE', W / 2, 170);
      }
    } else if (hovering || blink) {
      // INSERT COIN — steady bright green while a coin is held at the slot.
      ctx.fillStyle = hovering ? '#39ff14' : '#ffb000';
      ctx.fillText('INSERT COIN', W / 2, 170);
      if (hovering) {
        ctx.strokeStyle = '#39ff14';
        ctx.lineWidth = 2;
        ctx.strokeRect(W / 2 - 96, 154, 192, 32);
      }
    }
    ctx.fillStyle = '#3a7a4a';
    ctx.fillText('ONE COIN · ONE GAME', W / 2, 210);
    this.texture.needsUpdate = true;
  }

  private drawGame(dead: boolean): void {
    this.drawShell();
    const ctx = this.ctx;
    ctx.textAlign = 'left';
    ctx.font = 'bold 20px "Courier New", monospace';
    ctx.fillStyle = '#39ff14';
    ctx.fillText(`SCORE ${this.score}`, 10, 30);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#9ee8a0';
    ctx.fillText(`HI ${this.hi().score}`, W - 10, 30);

    // Food.
    ctx.fillStyle = '#ffb000';
    ctx.fillRect(this.food[0] * CELL + 3, HEADER + this.food[1] * CELL + 3, CELL - 6, CELL - 6);

    // Snake.
    this.snake.forEach(([x, y], i) => {
      ctx.fillStyle = dead ? '#e8352a' : i === 0 ? '#aaffa0' : '#39ff14';
      ctx.fillRect(x * CELL + 1, HEADER + y * CELL + 1, CELL - 2, CELL - 2);
    });

    if (dead) {
      ctx.textAlign = 'center';
      ctx.fillStyle = '#e8352a';
      ctx.font = '900 30px "Courier New", monospace';
      ctx.fillText('GAME OVER', W / 2, H / 2 + 10);
      const hi = this.hi();
      ctx.font = 'bold 18px "Courier New", monospace';
      ctx.fillStyle = this.score >= hi.score && this.score > 0 ? '#ffb000' : '#9ee8a0';
      ctx.fillText(
        this.score >= hi.score && this.score > 0
          ? 'NEW HOUSE RECORD!'
          : `HI ${hi.score} — ${hi.name.slice(0, 10).toUpperCase()}`,
        W / 2,
        H / 2 + 40,
      );
    }
    this.texture.needsUpdate = true;
  }

  // Desktop testing: arrows steer, Enter starts (when standing close enough).
  private onKey = (e: KeyboardEvent): void => {
    const dirs: Record<string, Cell> = {
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
    };
    if (dirs[e.key]) {
      this.keyDir = dirs[e.key];
      e.preventDefault();
    } else if (e.key === 'Enter') {
      this.keyStart = true;
    }
  };
}
