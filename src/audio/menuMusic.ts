/**
 * Lobby music — the "Dune Train Convoy" track that rides under the main menu.
 * It starts the moment you enter VR from the landing page (a user gesture, so
 * autoplay is allowed) and loops. A mute button on the lobby HUD (left of the
 * newspaper) toggles it, and the choice is REMEMBERED in localStorage — mute it
 * once and it stays silent on every future visit until you un-mute.
 *
 * Plain HTMLAudioElement (not the WebAudio SFX graph): it's a long looping
 * track that just needs play/pause, nothing spatial.
 */

import musicUrl from '../assets/music/dune-train-convoy.mp3?url';

const MUTE_KEY = 'ibb-music-muted';

let audio: HTMLAudioElement | null = null;
let entered = false;

export function isMusicMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

function setMuted(muted: boolean): void {
  try {
    localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
  } catch {
    /* private mode — the choice just won't persist */
  }
}

function ensureAudio(): HTMLAudioElement {
  if (!audio) {
    audio = new Audio(musicUrl);
    audio.loop = true;
    audio.volume = 0.5;
  }
  return audio;
}

/**
 * Start the lobby music — call once, inside the enter-VR click gesture, so the
 * browser allows playback. No-op if the player muted it on a previous visit.
 */
export function enterMenuMusic(): void {
  entered = true;
  if (isMusicMuted()) return;
  void ensureAudio().play().catch(() => {
    /* autoplay blocked or decode failed — stay silent */
  });
}

/** Flip mute (persisted). Returns the new muted state for the HUD glyph. */
export function toggleMusicMuted(): boolean {
  const muted = !isMusicMuted();
  setMuted(muted);
  if (muted) {
    audio?.pause();
  } else if (entered) {
    void ensureAudio().play().catch(() => {});
  }
  return muted;
}
