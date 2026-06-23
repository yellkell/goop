/**
 * Customisation state: which avatar/platform skin you wear, persisted in
 * localStorage. `version` bumps on every change so systems (mirror, gloves,
 * torso, platform) can cheaply notice and re-apply. `open` = the lobby
 * customisation panel + avatar mirror are showing.
 */

import {
  type AvatarSkin,
  avatarSkin,
  FREE_PLATFORMS,
  platformSkin,
  resolveAvatarSkin,
} from '../avatar/skins.js';

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

/** Platform skins the player has unlocked: the free trio plus anything bought
 *  in the shop ('ff-owned-platforms', a JSON id array). */
function loadOwnedPlatforms(): Set<string> {
  const owned = new Set(FREE_PLATFORMS);
  try {
    const raw = localStorage.getItem('ff-owned-platforms');
    if (raw) for (const id of JSON.parse(raw) as string[]) owned.add(id);
  } catch {
    /* fresh wallet — just the free trio */
  }
  return owned;
}

const ownedPlatforms = loadOwnedPlatforms();

/** Has the player unlocked this platform skin (free or purchased)? */
export function platformOwned(id: string): boolean {
  return ownedPlatforms.has(id);
}

/** Record a shop purchase: mark the platform owned and persist it. The coin
 *  debit is the caller's job (see wallet.spendCoins). */
export function ownPlatform(id: string): void {
  if (ownedPlatforms.has(id)) return;
  ownedPlatforms.add(id);
  try {
    localStorage.setItem(
      'ff-owned-platforms',
      JSON.stringify([...ownedPlatforms].filter((p) => !FREE_PLATFORMS.includes(p))),
    );
  } catch {
    /* session-only ownership */
  }
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
  /** The SHOP face is up (a sub-modal of customisation); false = the LOCKER. */
  shopOpen: false,
  /** Which tab the shop / locker shows. 'colour' is locker-only (the sliders). */
  tab: 'avatars' as 'avatars' | 'platforms' | 'colour',
};

/** Set the custom armour hue (0..1), or -1 to revert to the skin's default. */
export function setAvatarColor(hue: number): void {
  const h = hue < 0 ? -1 : ((hue % 1) + 1) % 1;
  if (h === customization.colorHue) return;
  customization.colorHue = h;
  save('ff-skin-color', String(h));
  customization.version += 1;
}

/** The fully-resolved skin the LOCAL player wears: chosen shape + custom colour. */
export function myAvatarSkin(): AvatarSkin {
  return resolveAvatarSkin(customization.avatar, customization.colorHue);
}

export function setAvatarSkin(id: string): void {
  const skin = avatarSkin(id);
  if (skin.id === customization.avatar) return;
  customization.avatar = skin.id;
  save('ff-skin-avatar', skin.id);
  customization.version += 1;
}

export function setPlatformSkin(id: string): void {
  // Only equip skins you actually own (free trio + shop unlocks).
  if (!platformOwned(id)) return;
  const skin = platformSkin(id);
  if (skin.id === customization.platform) return;
  customization.platform = skin.id;
  save('ff-skin-platform', skin.id);
  customization.version += 1;
}
