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
  /**
   * Shop price in coins (the bolt-dollar currency). Omitted = free / owned by
   * default (the three launch skins). 100 = a basic recolour (≈10 games of
   * play), 1000 = the fancier premium pad (≈100 games).
   */
  price?: number;
  /**
   * Premium platforms repaint the diamond-plate SLAB base too (not just the
   * neon), for a look the plain recolours don't get. Omitted = the default
   * gunmetal steel (DEFAULT_SLAB_TINT).
   */
  slab?: number;
}

/** The makePlatform() slab base tint — restored when a non-premium skin is worn. */
export const DEFAULT_SLAB_TINT = 0x9aa0ab;

/** Platform skins owned from the start (no purchase needed). */
export const FREE_PLATFORMS = ['azure', 'inferno', 'ember'];

export const AVATAR_SKINS: AvatarSkin[] = [
  // ids are stable (saved prefs + per-skin geometry tags key off them); the
  // display names follow the metallic-animal heads buildBoxer gives each one.
  { id: 'cobalt', name: 'BEAR', chassis: 0x122039, trim: 0x0a111e, accent: 0x4fb7ff },
  { id: 'crimson', name: 'PANTHER', chassis: 0x2e1013, trim: 0x170809, accent: 0xff3b4e },
  // No slimmer silhouette: the visual body must match the shared hitbox so no
  // skin is harder to hit than another.
  { id: 'valkyrie', name: 'EAGLE', chassis: 0x261b33, trim: 0x120d1a, accent: 0xff9ad5 },
  // Polished steel knight in heraldic gold.
  { id: 'knight', name: 'KNIGHT', chassis: 0x2d333d, trim: 0x14181f, accent: 0xffcf6e },
];

export const PLATFORM_SKINS: PlatformSkin[] = [
  // The three launch skins — free, owned from the start.
  { id: 'azure', name: 'AZURE', neon: 0x4fb7ff },
  { id: 'inferno', name: 'INFERNO', neon: 0xff3b30 },
  { id: 'ember', name: 'EMBER', neon: PALETTE.ember },
  // Shop: two basic recolours…
  { id: 'toxic', name: 'TOXIC', neon: PALETTE.venom, price: 100 },
  { id: 'plasma', name: 'PLASMA', neon: PALETTE.violet, price: 100 },
  // …the fancier premium pad — gold piping AND a gold-tinted slab.
  { id: 'goldrush', name: 'GOLD RUSH', neon: 0xffc23a, slab: 0xb8902c, price: 1000 },
  // …and the top-shelf flex: a jet-black deck with a white XD grin painted on
  // it (X eyes, a capital-D mouth). The face mesh is built into every platform,
  // tagged with this id and shown only when it's worn.
  { id: 'xdface', name: 'XD', neon: 0xf4f6fb, slab: 0x080808, price: 5000 },
];

/** How the OPPONENT looks when they haven't picked (bot bouts): team blue. */
export const OPPONENT_DEFAULT_AVATAR: AvatarSkin = {
  // id matches the PANTHER tag so an unskinned opponent (the bot) still gets a
  // full animal head — in the default cool-blue team colours.
  id: 'crimson', name: '', chassis: 0x1c1f25, trim: 0x121419, accent: PALETTE.coolFlame,
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

/**
 * A cohesive "tinted steel" palette from a single hue (0..1): a dark armour
 * body, a darker trim, and a vivid accent — so one colour repaints the WHOLE
 * suit yet still reads as forged metal lit from within, not a flat fill.
 */
export function colorPalette(hue: number): { chassis: number; trim: number; accent: number } {
  const h = ((hue % 1) + 1) % 1;
  return {
    chassis: new Color().setHSL(h, 0.5, 0.16).getHex(),
    trim: new Color().setHSL(h, 0.45, 0.08).getHex(),
    accent: new Color().setHSL(h, 0.9, 0.56).getHex(),
  };
}

/** A skin recoloured to a custom hue — keeps the SHAPE (id/name/slim), repaints
 *  the whole armour. */
export function tintSkin(base: AvatarSkin, hue: number): AvatarSkin {
  return { ...base, ...colorPalette(hue) };
}

/** The skin to actually wear: the chosen shape, recoloured to `hue` when one is
 *  set (hue < 0 keeps the shape's own default palette). */
export function resolveAvatarSkin(id: string, hue: number): AvatarSkin {
  const base = avatarSkin(id);
  return hue >= 0 && !base.locked ? tintSkin(base, hue) : base;
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
    // Per-skin ornament geometry (antennas, horns, plumes, winglets…):
    // each piece carries the id of the ONE skin it belongs to.
    if (o.userData?.skinTag) o.visible = o.userData.skinTag === skin.id;
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
      case 'hand':
        // The hands tint to the skin's steel but stay near-black at rest;
        // the white active bloom is owned by setGloveLit.
        m.color.setHex(skin.chassis);
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
    if (o.userData?.skinTag) o.visible = o.userData.skinTag === skin.id;
    const m = (o as Mesh).material as MeshStandardMaterial | undefined;
    if (!m || Array.isArray(m) || !m.userData?.role) return;
    switch (m.userData.role) {
      case 'slab':
        m.emissive.setHex(skin.neon);
        // Premium pads repaint the steel; plain recolours restore the default.
        m.color.setHex(skin.slab ?? DEFAULT_SLAB_TINT);
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
