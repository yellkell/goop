/**
 * Pickable skins for the avatar and the platform — pure visuals, applied by
 * recolouring role-tagged materials (boxer.ts / arena.ts tag every material
 * with `userData.role`). Hitboxes are never touched: the VALKYRIE silhouette
 * slims the chest/pelvis GROUP scales only, the BODY_IK spheres stay as-is.
 *
 * Three launch skins per slot (blue / red / one more) plus a locked
 * COMING SOON chip. The rival's picks arrive in the `iam` message and are
 * applied to their rig/pad; bot bouts keep the team-blue default look.
 */

import { Color, Mesh, MeshStandardMaterial, type Object3D } from 'three';
import { PALETTE } from '../config.js';

export interface AvatarSkin {
  id: string;
  name: string;
  locked?: boolean;
  /** Panel steel. */
  chassis: number;
  /** Dark trim pieces. */
  trim: number;
  /** Visor / reactor / trim glow. */
  accent: number;
  /** Sleeker silhouette (visual group scale only — hitboxes untouched). */
  slim?: boolean;
}

export interface PlatformSkin {
  id: string;
  name: string;
  locked?: boolean;
  /** Neon rim piping + slab emissive tint. */
  neon: number;
}

export const AVATAR_SKINS: AvatarSkin[] = [
  { id: 'cobalt', name: 'COBALT', chassis: 0x141d2c, trim: 0x0c1018, accent: 0x4fb7ff },
  { id: 'crimson', name: 'CRIMSON', chassis: 0x271114, trim: 0x14090b, accent: 0xff3b4e },
  { id: 'valkyrie', name: 'VALKYRIE', chassis: 0x211a29, trim: 0x100d15, accent: 0xff9ad5, slim: true },
  { id: 'soon-av', name: 'SOON', locked: true, chassis: 0, trim: 0, accent: 0 },
];

export const PLATFORM_SKINS: PlatformSkin[] = [
  { id: 'azure', name: 'AZURE', neon: 0x4fb7ff },
  { id: 'inferno', name: 'INFERNO', neon: 0xff3b30 },
  { id: 'ember', name: 'EMBER', neon: PALETTE.ember },
  { id: 'soon-pf', name: 'SOON', locked: true, neon: 0 },
];

/** How the OPPONENT looks when they haven't picked (bot bouts): team blue. */
export const OPPONENT_DEFAULT_AVATAR: AvatarSkin = {
  id: 'opp-default', name: '', chassis: 0x1c1f25, trim: 0x121419, accent: PALETTE.coolFlame,
};
export const OPPONENT_DEFAULT_PLATFORM: PlatformSkin = {
  id: 'opp-default', name: '', neon: PALETTE.coolFlame,
};

export function avatarSkin(id: string): AvatarSkin {
  const s = AVATAR_SKINS.find((x) => x.id === id);
  return s && !s.locked ? s : AVATAR_SKINS[1]; // crimson default
}

export function platformSkin(id: string): PlatformSkin {
  const s = PLATFORM_SKINS.find((x) => x.id === id);
  return s && !s.locked ? s : PLATFORM_SKINS[2]; // ember default
}

const _white = new Color(0xffffff);

/**
 * Recolour an avatar (rig piece, whole torso, glove, the mirror…) to a skin.
 * Glove LEDs (materials carrying `litIntensity`) keep their TEAM colour —
 * the squeeze tell must stay readable whatever the fashion.
 */
export function applyAvatarSkin(root: Object3D, skin: AvatarSkin): void {
  if (skin.locked) return;
  root.traverse((o) => {
    const m = (o as Mesh).material as MeshStandardMaterial | undefined;
    if (!m || Array.isArray(m) || !m.userData?.role) return;
    switch (m.userData.role) {
      case 'chassis':
        m.color.setHex(skin.chassis);
        if (m.emissiveIntensity > 0 && m.userData.litIntensity === undefined) {
          m.emissive.setHex(skin.accent);
        }
        break;
      case 'trim':
        m.color.setHex(skin.trim);
        break;
      case 'glow':
        if (m.userData.litIntensity !== undefined) break; // team LED — leave it
        m.color.setHex(skin.accent);
        m.emissive.setHex(skin.accent);
        break;
    }
  });
  // Silhouette: VALKYRIE runs a slimmer chest/pelvis. Group scale only.
  const chest = root.getObjectByName('opponent-chest');
  const pelvis = root.getObjectByName('opponent-pelvis');
  if (chest) chest.scale.set(skin.slim ? 0.82 : 1, 1, skin.slim ? 0.88 : 1);
  if (pelvis) pelvis.scale.set(skin.slim ? 0.86 : 1, 1, skin.slim ? 0.9 : 1);
}

/** Recolour a platform group's neon piping + slab tint to a skin. */
export function applyPlatformSkin(root: Object3D, skin: PlatformSkin): void {
  if (skin.locked) return;
  root.traverse((o) => {
    const m = (o as Mesh).material as MeshStandardMaterial | undefined;
    if (!m || Array.isArray(m) || !m.userData?.role) return;
    switch (m.userData.role) {
      case 'slab':
        m.emissive.setHex(skin.neon);
        break;
      case 'neon-core':
        m.color.copy(new Color(skin.neon).lerp(_white, 0.45));
        break;
      case 'neon-halo':
        m.color.setHex(skin.neon);
        break;
    }
  });
}
