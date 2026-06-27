/**
 * The guided BASICS tutorial — activate, throw, recall, block, move — then a
 * quick graduation knockdown against a half-health bot.
 *
 * SAFETY: this rides a perfectly ordinary vs-bot duel (app.state 'playing',
 * mode 'bot') and adds NOTHING to any combat system. It only reads/writes
 * SHARED state the combat systems already use — health, the round timer, the
 * opponent command bus — and it does so ONLY while `app.tutorial` is true. In
 * every normal bout that flag is false and this system early-returns on the
 * first line, so the regular game is byte-for-byte untouched.
 *
 * How the "pause" works without freezing the engine: while a lesson pop-up is
 * up the system (a) clears the bot's queued attacks from the command bus
 * before FireballSystem drains them — so the bot stands and guards but never
 * fires — (b) pins both fighters' health (the bot to 55), and (c) keeps the
 * round clock topped up so the round never ends. The player can still orbit,
 * throw and recall freely (that only needs match.phase === 'playing', which is
 * never changed). Registered just before FireballSystem so its command-bus
 * edits land before the balls are simulated.
 */

import { createSystem, type Entity, InputComponent } from '@iwsdk/core';
import {
  BufferGeometry,
  CanvasTexture,
  Line,
  LineBasicMaterial,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Raycaster,
  SphereGeometry,
  Vector3,
} from 'three';
import { Fireball, BallState } from '../components/Fireball.js';
import { Combatant } from '../components/Combatant.js';
import { Health } from '../components/Health.js';
import { match } from '../combat/matchState.js';
import { ballCommands, opponents } from '../combat/opponentBus.js';
import { app } from '../menu/appState.js';
import { MATCH } from '../config.js';
import { UI, plate, stencilFont } from '../ui/industrial.js';

/** The bot's health in tutorial — deliberately low so a beginner can win. */
const TUT_BOT_HP = 55;
const POP_W = 512;
const POP_H = 280;
const GREEN = '#57e389';
// The READY button drawn on the intro card (canvas px), pointed at + clicked.
const READY_BTN = { x: 156, y: 210, w: 200, h: 50 };

type StepKind = 'intro' | 'orbit' | 'flying' | 'returning' | 'block' | 'move';
interface Step {
  title: string;
  body: string[];
  hint: string;
  kind: StepKind;
}

const STEPS: Step[] = [
  { title: 'SET UP', kind: 'intro', hint: '', body: ['Clear a 1.8m x 1.8m area', 'and centre yourself in it.', 'Hold the recenter button.'] },
  { title: 'ACTIVATE', kind: 'orbit', hint: 'hold the trigger', body: ['Hold the trigger to', 'spin up a ball that', 'orbits your fist.'] },
  { title: 'THROW', kind: 'flying', hint: 'punch and release', body: ['Punch and release the', 'trigger to throw the ball', 'at your opponent.'] },
  { title: 'RECALL', kind: 'returning', hint: 'pull the trigger', body: ['Pull the trigger again', 'to call the ball back', 'to your hand.'] },
  { title: 'BLOCK', kind: 'block', hint: 'spin a ball to guard', body: ['An orbiting ball blocks', 'shots. Spin one up', 'to guard.'] },
  { title: 'MOVE', kind: 'move', hint: 'step off the line', body: ['Step and lean to dodge.', 'Move your body out', 'of the way.'] },
];

const _head = new Vector3();
const _v = new Vector3();
const _origin = new Vector3();
const _dir = new Vector3();
const _end = new Vector3();

interface Pointer {
  line: Line;
  dot: Mesh;
}

export class TutorialSystem extends createSystem({
  balls: { required: [Fireball] },
  combatants: { required: [Combatant, Health] },
}) {
  private active = false;
  private phase: 'lessons' | 'grad' | 'fight' = 'lessons';
  private stepIdx = 0;
  private cleared = false; // current lesson just satisfied — showing the ✓ beat
  private clearTimer = 0;
  private gradTimer = 0;
  private blockThrown = false;
  private blockTimer = 0;
  private moveStart = new Vector3();
  private popup: { mesh: Mesh; ctx: CanvasRenderingContext2D; tex: CanvasTexture } | null = null;
  // Controller laser pointers for the intro card's READY button.
  private ray = new Raycaster();
  private pointers: Partial<Record<'left' | 'right', Pointer>> = {};
  private readyHover = false;

  update(delta: number): void {
    if (!app.tutorial) {
      if (this.active) this.end();
      return;
    }
    // The bout ended (KO'd the bot, forfeited, or the match ran out) — leave.
    if (app.state !== 'playing') {
      this.end();
      app.tutorial = false;
      return;
    }
    if (!this.active) this.begin();

    if (this.phase === 'fight') {
      this.capBotHealth();
      // One clean knockdown graduates — bow out before the match machinery
      // banks a result, so the tutorial never touches your stats or coins.
      if (this.fighterHp(0) <= 0 || this.fighterHp(1) <= 0) {
        this.end();
        app.tutorial = false;
        app.state = 'menu';
      }
      return;
    }

    // Lessons + graduation hold: keep the bout calm and frozen.
    this.suppressBot();
    this.pinHealth();
    match.roundTimer = MATCH.roundTime; // the clock never runs down mid-lesson

    if (this.phase === 'grad') {
      this.gradTimer -= delta;
      if (this.gradTimer <= 0) this.startFight();
      return;
    }
    this.runLesson(delta);
  }

  // --- lesson flow ----------------------------------------------------------

  private runLesson(delta: number): void {
    if (this.cleared) {
      this.clearTimer -= delta;
      if (this.clearTimer <= 0) {
        this.stepIdx += 1;
        this.cleared = false;
        if (this.stepIdx >= STEPS.length) {
          this.toGrad();
          return;
        }
        this.enterStep();
      }
      return;
    }

    const step = STEPS[this.stepIdx];
    // The intro card is a click-through: drive a laser pointer at its READY
    // button and hold the player's fire so the click-trigger doesn't spawn a ball.
    if (step.kind === 'intro') {
      app.tutorialHoldFire = true;
      if (this.updateReadyPointer()) {
        app.tutorialHoldFire = false;
        this.hidePointers();
        this.cleared = true;
        this.clearTimer = 0.6;
        this.draw();
      }
      return;
    }
    app.tutorialHoldFire = false;
    if (step.kind === 'block') this.tickBlock(delta);
    if (this.detect(step.kind)) {
      this.cleared = true;
      this.clearTimer = 1.0;
      this.draw();
    }
  }

  /** Aim a laser from each hand at the intro card; light the READY button when
   *  pointed at, and report a click (trigger) on it. */
  private updateReadyPointer(): boolean {
    if (!this.popup) return false;
    if (!this.pointers.left) this.pointers.left = this.makePointer();
    if (!this.pointers.right) this.pointers.right = this.makePointer();
    let hover = false;
    let clicked = false;
    for (const hand of ['left', 'right'] as const) {
      const p = this.pointers[hand]!;
      const rayObj = this.world.playerSpaceEntities.raySpaces[hand]?.object3D;
      if (!rayObj) {
        p.line.visible = false;
        p.dot.visible = false;
        continue;
      }
      rayObj.getWorldPosition(_origin);
      rayObj.getWorldDirection(_dir).negate(); // ray space points down −Z
      this.ray.set(_origin, _dir);
      const hit = this.ray.intersectObject(this.popup.mesh, false)[0];
      _end.copy(hit ? hit.point : _origin.clone().addScaledVector(_dir, 1.6));
      const pos = p.line.geometry.getAttribute('position');
      pos.setXYZ(0, _origin.x, _origin.y, _origin.z);
      pos.setXYZ(1, _end.x, _end.y, _end.z);
      pos.needsUpdate = true;
      p.line.visible = true;
      let over = false;
      if (hit?.uv) {
        const cx = hit.uv.x * POP_W;
        const cy = (1 - hit.uv.y) * POP_H; // canvas y is top-down
        over = cx >= READY_BTN.x && cx <= READY_BTN.x + READY_BTN.w && cy >= READY_BTN.y && cy <= READY_BTN.y + READY_BTN.h;
      }
      if (hit) {
        p.dot.position.copy(hit.point);
        p.dot.visible = true;
      } else {
        p.dot.visible = false;
      }
      if (over) {
        hover = true;
        if (this.input.xr.gamepads[hand]?.getButtonDown(InputComponent.Trigger)) clicked = true;
      }
    }
    if (hover !== this.readyHover) {
      this.readyHover = hover;
      this.draw();
    }
    return clicked;
  }

  private makePointer(): Pointer {
    const geo = new BufferGeometry().setFromPoints([new Vector3(), new Vector3(0, 0, -1)]);
    const line = new Line(geo, new LineBasicMaterial({ color: 0xffa03c, transparent: true, opacity: 0.85 }));
    line.name = 'tutorial-pointer';
    line.frustumCulled = false;
    line.visible = false;
    line.renderOrder = 21;
    const dot = new Mesh(new SphereGeometry(0.012, 12, 10), new MeshBasicMaterial({ color: 0xffc04d }));
    dot.visible = false;
    dot.renderOrder = 21;
    this.scene.add(line, dot);
    return { line, dot };
  }

  private hidePointers(): void {
    for (const hand of ['left', 'right'] as const) {
      const p = this.pointers[hand];
      if (p) {
        p.line.visible = false;
        p.dot.visible = false;
      }
    }
  }

  private removePointers(): void {
    for (const hand of ['left', 'right'] as const) {
      const p = this.pointers[hand];
      if (!p) continue;
      this.scene.remove(p.line, p.dot);
      p.line.geometry.dispose();
      (p.line.material as LineBasicMaterial).dispose();
      p.dot.geometry.dispose();
      (p.dot.material as MeshBasicMaterial).dispose();
    }
    this.pointers = {};
  }

  private enterStep(): void {
    const step = STEPS[this.stepIdx];
    if (step.kind === 'block') {
      this.blockThrown = false;
      this.blockTimer = 0;
    } else if (step.kind === 'move') {
      this.playerHead(this.moveStart);
    }
    this.draw();
  }

  private detect(kind: StepKind): boolean {
    switch (kind) {
      case 'intro':
        return false; // handled by the pointer + READY button, not auto-detection
      case 'orbit':
        return this.playerBallIn(BallState.Orbit);
      case 'flying':
        return this.playerBallIn(BallState.Flying);
      case 'returning':
        return this.playerBallIn(BallState.Returning);
      case 'block':
        return this.blockThrown && this.blockTimer <= 0;
      case 'move':
        this.playerHead(_head);
        _head.y = this.moveStart.y;
        return _head.distanceTo(this.moveStart) > 0.3;
    }
  }

  /** Lob ONE slow ball at the player once they have a shield up to block it. */
  private tickBlock(delta: number): void {
    if (this.blockThrown) {
      this.blockTimer -= delta;
      return;
    }
    if (!this.playerBallIn(BallState.Orbit)) return;
    const from = opponents[0].handPos[0];
    this.playerHead(_v).sub(from);
    _v.y -= 0.1; // aim at the chest
    _v.normalize().multiplyScalar(3.0); // slow and very blockable
    ballCommands.push({ type: 'throw', slot: 0, hand: 0, pos: from.clone(), vel: _v.clone() });
    this.blockThrown = true;
    this.blockTimer = 3.0;
  }

  // --- holding the bout calm ------------------------------------------------

  /** Strip the bot's queued attacks before FireballSystem drains them, and
   *  drop its wind-up glow — it stands and guards but never throws. */
  private suppressBot(): void {
    ballCommands.length = 0;
    opponents[0].orbiting[0] = false;
    opponents[0].orbiting[1] = false;
  }

  private pinHealth(): void {
    const me = this.fighter(0);
    const bot = this.fighter(1);
    if (me) me.setValue(Health, 'current', me.getValue(Health, 'max') ?? 100);
    if (bot) bot.setValue(Health, 'current', TUT_BOT_HP);
  }

  /** Cap the bot at half health each frame (so refills between rounds hold the
   *  handicap) while leaving it fully damageable down to a knockout. */
  private capBotHealth(): void {
    const bot = this.fighter(1);
    if (bot) bot.setValue(Health, 'current', Math.min(bot.getValue(Health, 'current') ?? TUT_BOT_HP, TUT_BOT_HP));
  }

  // --- phase transitions ----------------------------------------------------

  private begin(): void {
    this.active = true;
    this.phase = 'lessons';
    this.stepIdx = 0;
    this.cleared = false;
    this.makePopup();
    this.enterStep();
  }

  private toGrad(): void {
    this.phase = 'grad';
    this.gradTimer = 3.0;
    this.draw();
  }

  private startFight(): void {
    this.phase = 'fight';
    this.removePopup();
  }

  private end(): void {
    this.removePopup();
    this.removePointers();
    app.tutorialHoldFire = false;
    this.readyHover = false;
    this.active = false;
    this.phase = 'lessons';
  }

  // --- queries --------------------------------------------------------------

  private fighter(slot: number): Entity | undefined {
    for (const e of this.queries.combatants.entities) {
      if ((e.getValue(Combatant, 'slot') ?? -1) === slot) return e;
    }
    return undefined;
  }

  private fighterHp(slot: number): number {
    return this.fighter(slot)?.getValue(Health, 'current') ?? 1;
  }

  private playerBallIn(state: number): boolean {
    for (const ball of this.queries.balls.entities) {
      if ((ball.getValue(Fireball, 'owner') ?? 0) === 0 && (ball.getValue(Fireball, 'state') ?? 0) === state) return true;
    }
    return false;
  }

  private playerHead(out: Vector3): Vector3 {
    const obj = this.playerHeadEntity?.object3D;
    if (obj) obj.getWorldPosition(out);
    return out;
  }

  // --- the pop-up -----------------------------------------------------------

  private makePopup(): void {
    const canvas = document.createElement('canvas');
    canvas.width = POP_W;
    canvas.height = POP_H;
    const ctx = canvas.getContext('2d')!;
    const tex = new CanvasTexture(canvas);
    tex.minFilter = LinearFilter;
    const mesh = new Mesh(
      new PlaneGeometry(0.66, (0.66 * POP_H) / POP_W),
      new MeshBasicMaterial({ map: tex, transparent: true }),
    );
    mesh.name = 'tutorial-popup';
    mesh.position.set(0, 1.18, -1.02); // low-centre, facing you, clear of the bot
    mesh.renderOrder = 20;
    this.scene.add(mesh);
    this.popup = { mesh, ctx, tex };
  }

  private removePopup(): void {
    if (!this.popup) return;
    this.scene.remove(this.popup.mesh);
    this.popup.tex.dispose();
    (this.popup.mesh.material as MeshBasicMaterial).dispose();
    this.popup.mesh.geometry.dispose();
    this.popup = null;
  }

  private draw(): void {
    if (!this.popup) return;
    const ctx = this.popup.ctx;
    ctx.clearRect(0, 0, POP_W, POP_H);
    const grad = this.phase === 'grad';
    const accent = this.cleared || grad ? GREEN : UI.emberBright;
    plate(ctx, 8, 8, POP_W - 16, POP_H - 16, {
      cut: 22,
      fill: 'rgba(10,12,16,0.92)',
      stroke: accent,
    });

    const title = grad ? 'YOU’RE READY' : `${this.stepIdx + 1}.  ${STEPS[this.stepIdx].title}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.font = stencilFont(36);
    ctx.fillStyle = accent;
    ctx.fillText(title, 40, 78);

    const body = grad ? ["That's the basics.", 'Now beat the bot.'] : STEPS[this.stepIdx].body;
    ctx.font = '600 25px system-ui, sans-serif';
    ctx.fillStyle = UI.text;
    body.forEach((line, i) => ctx.fillText(line, 40, 124 + i * 36));

    // Footer: the prompt, or the ✓ beat once a lesson lands.
    ctx.font = '800 22px system-ui, sans-serif';
    if (grad) {
      ctx.fillStyle = GREEN;
      ctx.fillText('✓  LET’S GO', 40, POP_H - 38);
    } else if (this.cleared) {
      ctx.fillStyle = GREEN;
      ctx.fillText('✓  DONE', 40, POP_H - 38);
    } else if (STEPS[this.stepIdx].kind === 'intro') {
      // A pointable READY button instead of a text hint.
      const hot = this.readyHover;
      plate(ctx, READY_BTN.x, READY_BTN.y, READY_BTN.w, READY_BTN.h, {
        cut: 10,
        fill: hot ? 'rgba(255,176,0,0.22)' : 'rgba(20,22,30,0.92)',
        stroke: hot ? UI.amber : UI.steel,
        rivets: false,
      });
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = stencilFont(28);
      ctx.fillStyle = hot ? UI.amber : UI.text;
      ctx.fillText('READY', READY_BTN.x + READY_BTN.w / 2, READY_BTN.y + READY_BTN.h / 2 + 1);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
    } else {
      ctx.fillStyle = 'rgba(232,236,242,0.6)';
      ctx.fillText(STEPS[this.stepIdx].hint, 40, POP_H - 38);
    }

    // Progress dots, top-right.
    if (!grad) {
      for (let i = 0; i < STEPS.length; i++) {
        ctx.beginPath();
        ctx.arc(POP_W - 40 - (STEPS.length - 1 - i) * 26, 64, 7, 0, Math.PI * 2);
        ctx.fillStyle = i < this.stepIdx ? GREEN : i === this.stepIdx ? UI.emberBright : 'rgba(150,156,168,0.4)';
        ctx.fill();
      }
    }

    this.popup.tex.needsUpdate = true;
  }
}
