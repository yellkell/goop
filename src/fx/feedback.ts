/**
 * Shared feedback bus. CollisionSystem raises a pulse + the world-space
 * direction the hit came from when the player is struck; PlayerFeedbackSystem
 * consumes it to draw a directional damage vignette.
 */

export const feedback = {
  /** 0..1 — set to 1 on a player hit, decays each frame. */
  playerHitFlash: 0,
  /** 0..1 — stronger full-screen buzz while boundary damage is active. */
  boundaryBuzz: 0,
  /** World-space unit direction from the player toward the hit's origin. */
  srcX: 0,
  srcY: 0,
  srcZ: -1,
};
