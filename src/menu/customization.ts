/**
 * Customisation state: which avatar/platform skin you wear, persisted in
 * localStorage. `version` bumps on every change so systems (mirror, gloves,
 * torso, platform) can cheaply notice and re-apply. `open` = the lobby
 * customisation panel + avatar mirror are showing.
 */

import { type AvatarSkin, avatarSkin, platformSkin, resolveAvatarSkin } from '../avatar/skins.js';
import { app } from './appState.js';

function load(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function save(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* session-only */
  }
}

function loadHue(): number {
  const n = parseFloat(load('ff-skin-color', ''));
  return Number.isFinite(n) ? n : -1;
}

export const customization = {
  avatar: avatarSkin(load('ff-skin-avatar', 'crimson')).id,
  platform: platformSkin(load('ff-skin-platform', 'ember')).id,
  /** Custom armour hue (0..1) from the colour picker, or -1 to keep the
   *  avatar's own default palette. */
  colorHue: loadHue(),
  /** Bumped on every change — consumers re-apply when they see it move. */
  version: 1,
  /** The customisation panel (and the avatar mirror) is up in the lobby. */
  open: false,
};

/** Set the custom armour hue (0..1), or -1 to revert to the skin's default. */
export function setAvatarColor(hue: number): void {
  const h = hue < 0 ? -1 : ((hue % 1) + 1) % 1;
  if (h === customization.colorHue) return;
  customization.colorHue = h;
  save('ff-skin-color', String(h));
  customization.version += 1;
}

/**
 * The fully-resolved skin the LOCAL player wears: chosen shape + colour. The
 * steel takes your custom ARMOUR colour, or — if you've left that on default —
 * your AVATAR ACCENT hue, so the colour you picked is the colour you wear in
 * fights, instead of the skin's stock red/blue resetting onto your body.
 */
export function myAvatarSkin(): AvatarSkin {
  const hue = customization.colorHue >= 0 ? customization.colorHue : app.accentHue;
  return resolveAvatarSkin(customization.avatar, hue);
}

export function setAvatarSkin(id: string): void {
  const skin = avatarSkin(id);
  if (skin.id === customization.avatar) return;
  customization.avatar = skin.id;
  save('ff-skin-avatar', skin.id);
  customization.version += 1;
}

export function setPlatformSkin(id: string): void {
  const skin = platformSkin(id);
  if (skin.id === customization.platform) return;
  customization.platform = skin.id;
  save('ff-skin-platform', skin.id);
  customization.version += 1;
}
