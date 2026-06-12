/**
 * Customisation state: which avatar/platform skin you wear, persisted in
 * localStorage. `version` bumps on every change so systems (mirror, gloves,
 * torso, platform) can cheaply notice and re-apply. `open` = the lobby
 * customisation panel + avatar mirror are showing.
 */

import { avatarSkin, platformSkin } from '../avatar/skins.js';

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

export const customization = {
  avatar: avatarSkin(load('ff-skin-avatar', 'crimson')).id,
  platform: platformSkin(load('ff-skin-platform', 'ember')).id,
  /** Bumped on every change — consumers re-apply when they see it move. */
  version: 1,
  /** The customisation panel (and the avatar mirror) is up in the lobby. */
  open: false,
};

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
