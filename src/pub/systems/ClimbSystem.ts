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
 * Only the three tall solid walls are climbable (west, north, south); the
 * shared east/door wall isn't, so nobody can shimmy over into the pub.
 */

import { createSystem, InputComponent } from '@iwsdk/core';
import { Vector3 } from 'three';
import { FIGHT } from '../config.js';
import { pulseHand } from '../../input/haptics.js';

const HANDS = ['left', 'right'] as const;
type Hand = (typeof HANDS)[number];

const REACH = 0.4; // how close the grip must be to a wall to latch on (m)
const GRIP_ON = 0.6; // squeeze value that latches a hand
const GRIP_OFF = 0.4; // squeeze value that releases it (hysteresis)
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
            pulseHand(this.world.session, hand, 0.45, 45);
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

  /** True if the grip is within reach of a climbable hall wall. */
  private nearWall(g: Vector3): boolean {
    if (g.y < MIN_GRAB_Y) return false;
    const h = FIGHT.hall;
    // West wall (the far end of the hall).
    if (Math.abs(g.x - h.minX) < REACH && g.z > h.minZ && g.z < h.maxZ) return true;
    // North / south walls — only along the hall's own x-span, never the
    // shared east/door wall (so you can't climb across into the pub).
    if (g.x > h.minX && g.x < h.maxX) {
      if (Math.abs(g.z - h.minZ) < REACH) return true;
      if (Math.abs(g.z - h.maxZ) < REACH) return true;
    }
    return false;
  }
}
