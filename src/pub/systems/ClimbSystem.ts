/**
 * Wall climbing — FIGHT HALL ONLY.
 *
 * Spectators can haul themselves up the steel walls of the fight hall, hand
 * over hand, to perch high above the pit and watch the duel from the rafters.
 * (The pub proper has no climbing — you'd just bonk the low ceiling.)
 *
 * The mechanic is the classic VR "grab the world" trick, no physics needed:
 * squeeze the grip while your hand is near a hall wall and that world point is
 * pinned under your hand. As you then move your real hand DOWN, we translate
 * the whole rig UP by the same amount (the hand stays welded to the hold), so
 * you winch yourself up. Grab with the other hand and it takes over as the
 * anchor — alternate hands to climb. Let go of both and you FALL: gravity
 * pulls the rig back down to the hall floor (grab again to arrest it).
 *
 * Any of the four hall perimeter walls is climbable, each with a thick inward
 * grab zone (REACH) so latching on is forgiving. Gated to the fight hall, so
 * the low-ceilinged pub proper stays climb-free.
 */

import { createSystem, InputComponent } from '@iwsdk/core';
import { Vector3 } from 'three';
import { FIGHT } from '../config.js';
import { pulseHand } from '../../input/haptics.js';

const HANDS = ['left', 'right'] as const;
type Hand = (typeof HANDS)[number];

const REACH = 0.7; // how close the grip must be to a wall to latch on (m) — generous
const GRIP_ON = 0.5; // squeeze value that latches a hand
const GRIP_OFF = 0.35; // squeeze value that releases it (hysteresis)
const MIN_GRAB_Y = 0.1; // can't latch below this — grab the wall, not the floor
const MAX_HEAD_Y = FIGHT.hall.height - 1.4; // stop the head short of the ceiling
const GRAVITY = 16; // m/s² once you let go of the wall
const TERMINAL = 9; // m/s cap so the drop never gets sickening

const _grip = new Vector3();
const _head = new Vector3();

export class ClimbSystem extends createSystem({}) {
  private active: Hand | null = null;
  private gripping: Record<Hand, boolean> = { left: false, right: false };
  private anchor = new Vector3();
  private fallVel = 0;
  private dbgTimer = 0;

  update(delta: number): void {
    const player = this.player;
    if (!player) return;

    player.head.getWorldPosition(_head);
    // The fight hall is everything west of the pub's shared wall.
    const inHall = _head.x < FIGHT.hall.maxX;

    for (const hand of HANDS) {
      const gp = this.input.xr.gamepads[hand];
      const grip = player.gripSpaces[hand];
      if (!gp || !grip) {
        this.gripping[hand] = false;
        continue;
      }
      const squeeze = gp.getButtonValue(InputComponent.Squeeze);

      if (!this.gripping[hand]) {
        // Latch on: squeezing, in the hall, with the hand against a wall.
        if (squeeze >= GRIP_ON && inHall) {
          grip.getWorldPosition(_grip);
          if (this.nearWall(_grip)) {
            this.gripping[hand] = true;
            this.active = hand; // the newest grab drives the climb
            this.anchor.copy(_grip);
            this.fallVel = 0; // grabbing on arrests any fall
            pulseHand(this.world.session, hand, 0.5, 50);
            // eslint-disable-next-line no-console
            console.info(`[climb] ${hand} latched at`, _grip.x.toFixed(2), _grip.y.toFixed(2), _grip.z.toFixed(2));
          } else {
            this.reportMiss(_grip, delta);
          }
        }
      } else if (squeeze < GRIP_OFF) {
        // Let go: hand the climb to the other hand if it's still on the wall.
        this.gripping[hand] = false;
        if (this.active === hand) {
          const other: Hand = hand === 'left' ? 'right' : 'left';
          if (this.gripping[other]) {
            this.active = other;
            player.gripSpaces[other].getWorldPosition(this.anchor);
          } else {
            this.active = null;
          }
        }
      }
    }

    // Drive the climb: move the rig so the active grip sits back on its anchor.
    if (this.active && this.gripping[this.active]) {
      const grip = player.gripSpaces[this.active];
      grip.getWorldPosition(_grip);
      player.position.x += this.anchor.x - _grip.x;
      player.position.y += this.anchor.y - _grip.y;
      player.position.z += this.anchor.z - _grip.z;

      // Don't punch through the floor or the ceiling.
      if (player.position.y < 0) player.position.y = 0;
      player.head.getWorldPosition(_head);
      if (_head.y > MAX_HEAD_Y) player.position.y -= _head.y - MAX_HEAD_Y;
      this.fallVel = 0;
    } else if (player.position.y > 0) {
      // Nothing gripped and we're off the floor — fall back down to the hall.
      this.fallVel = Math.min(TERMINAL, this.fallVel + GRAVITY * delta);
      player.position.y -= this.fallVel * delta;
      if (player.position.y <= 0) {
        player.position.y = 0;
        this.fallVel = 0;
        pulseHand(this.world.session, 'left', 0.3, 40);
        pulseHand(this.world.session, 'right', 0.3, 40);
      }
    }
  }

  /**
   * True if the grip is within reach of any fight-hall perimeter wall. REACH
   * gives each wall a thick inward grab zone, so you can latch on without
   * pressing your hand exactly onto the plane.
   */
  private nearWall(g: Vector3): boolean {
    if (g.y < MIN_GRAB_Y) return false;
    const h = FIGHT.hall;
    const nearX = Math.abs(g.x - h.minX) < REACH || Math.abs(g.x - h.maxX) < REACH;
    const nearZ = Math.abs(g.z - h.minZ) < REACH || Math.abs(g.z - h.maxZ) < REACH;
    const insideX = g.x > h.minX - REACH && g.x < h.maxX + REACH;
    const insideZ = g.z > h.minZ - REACH && g.z < h.maxZ + REACH;
    // Near a side wall (E/W) while within the depth span, or near an end wall
    // (N/S) while within the width span.
    return (nearX && insideZ) || (nearZ && insideX);
  }

  /** Throttled log when a squeeze in the hall finds no wall — climb debugging. */
  private reportMiss(g: Vector3, delta: number): void {
    this.dbgTimer -= delta;
    if (this.dbgTimer > 0) return;
    this.dbgTimer = 0.5;
    const h = FIGHT.hall;
    // eslint-disable-next-line no-console
    console.info(
      `[climb] no wall in reach — hand x=${g.x.toFixed(2)} z=${g.z.toFixed(2)} y=${g.y.toFixed(2)} ` +
        `(walls x ${h.minX}/${h.maxX}, z ${h.minZ}/${h.maxZ}; reach ${REACH}m)`,
    );
  }
}
