/**
 * The lobby menu — controller laser pointers + the floating MenuPanel
 * (FIRE FIGHT's menu-laser pattern, trimmed to one panel and four buttons).
 *
 * Visible only in the LOBBY phase; during countdown/fight/verdict the panel
 * and lasers vanish — your hands are for punching. Hover redraws the panel
 * with a highlight and blips; trigger clicks run the action:
 *
 *   FIGHT       arm the bout (FightSystem consumes match.startRequested)
 *   ROUND       cycle 60s / 120s / 180s
 *   MUSIC       toggle the lobby/battle music (persisted)
 *   DIFFICULTY  CHILL / SCRAP / RUMBLE — creature pacing + punch damage
 */

import { createSystem, InputComponent } from '@iwsdk/core';
import {
  BufferGeometry,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  Raycaster,
  SphereGeometry,
  Vector3,
  type Intersection,
} from 'three';
import { toggleMusicMuted } from '../audio/music.js';
import { uiClick, uiHover } from '../audio/sfx.js';
import { ARENA } from '../config.js';
import { pulseHand } from '../input/haptics.js';
import { DIFFICULTIES, match, ROUND_CHOICES, settings } from '../state.js';
import { MenuPanel, type MenuAction } from '../ui/menuPanel.js';

const HANDS = ['left', 'right'] as const;
type Hand = (typeof HANDS)[number];

interface Pointer {
  line: Line;
  dot: Mesh;
}

const _origin = new Vector3();
const _dir = new Vector3();
const _end = new Vector3();

export class MenuSystem extends createSystem({}) {
  private panel!: MenuPanel;
  private pointers = {} as Record<Hand, Pointer>;
  private ray = new Raycaster();

  init(): void {
    this.panel = new MenuPanel();
    // Between you and the creature's corner, off to the right, eye height —
    // FIXED furniture: angled once toward your start spot, and it stays put
    // (it never turns to follow your head).
    const px = 0.85;
    const pz = ARENA.spawn[2] * 0.55;
    this.panel.group.position.set(px, 1.45, pz);
    this.panel.group.rotation.set(0, Math.atan2(0 - px, 0 - pz), 0);
    this.scene.add(this.panel.group);
    this.pointers.left = this.makePointer();
    this.pointers.right = this.makePointer();
  }

  private makePointer(): Pointer {
    const geo = new BufferGeometry().setFromPoints([new Vector3(), new Vector3(0, 0, -1)]);
    const line = new Line(
      geo,
      new LineBasicMaterial({ color: 0x6dff7e, transparent: true, opacity: 0.8 }),
    );
    line.name = 'menu-pointer';
    line.frustumCulled = false;
    const dot = new Mesh(new SphereGeometry(0.011, 12, 10), new MeshBasicMaterial({ color: 0xbfffca }));
    dot.visible = false;
    line.visible = false;
    this.scene.add(line);
    this.scene.add(dot);
    return { line, dot };
  }

  /** Aim the hand's laser at the panel; snap its end + dot to the hit. */
  private updatePointer(hand: Hand): Intersection | undefined {
    const p = this.pointers[hand];
    const rayObj = this.world.playerSpaceEntities.raySpaces[hand]?.object3D;
    if (!rayObj) {
      p.line.visible = false;
      p.dot.visible = false;
      return undefined;
    }
    rayObj.getWorldPosition(_origin);
    rayObj.getWorldDirection(_dir).negate(); // ray space points down −Z
    this.ray.set(_origin, _dir);
    const hit = this.ray.intersectObject(this.panel.mesh, false)[0];
    _end.copy(hit ? hit.point : _origin.clone().addScaledVector(_dir, 1.2));
    const pos = p.line.geometry.getAttribute('position');
    pos.setXYZ(0, _origin.x, _origin.y, _origin.z);
    pos.setXYZ(1, _end.x, _end.y, _end.z);
    pos.needsUpdate = true;
    p.line.visible = true;
    p.dot.visible = !!hit;
    if (hit) p.dot.position.copy(hit.point);
    return hit;
  }

  private hideAll(): void {
    this.panel.group.visible = false;
    for (const hand of HANDS) {
      this.pointers[hand].line.visible = false;
      this.pointers[hand].dot.visible = false;
    }
  }

  private run(action: MenuAction, hand: Hand): void {
    uiClick();
    pulseHand(this.world.session, hand, 0.3, 40);
    switch (action) {
      case 'fight':
        match.startRequested = true;
        break;
      case 'round': {
        const i = ROUND_CHOICES.indexOf(settings.roundSeconds);
        settings.roundSeconds = ROUND_CHOICES[(i + 1) % ROUND_CHOICES.length];
        break;
      }
      case 'music':
        toggleMusicMuted();
        break;
      case 'difficulty':
        settings.difficulty = (settings.difficulty + 1) % DIFFICULTIES.length;
        break;
    }
    this.panel.refresh();
  }

  update(): void {
    if (match.phase !== 'lobby') {
      this.hideAll();
      return;
    }
    this.panel.group.visible = true;
    // The panel is fixed furniture — set once in init(), never follows you.

    let hover: MenuAction | null = null;
    for (const hand of HANDS) {
      const hit = this.updatePointer(hand);
      const action = hit?.uv ? this.panel.hitTest(hit.uv.x, hit.uv.y) : null;
      if (action) hover = action;
      if (action && (this.input.xr.gamepads[hand]?.getButtonDown(InputComponent.Trigger) ?? false)) {
        this.run(action, hand);
      }
    }
    if (this.panel.setHovered(hover) && hover) uiHover();
  }
}
