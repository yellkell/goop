/**
 * Lobby music — the "Dune Train Convoy" track that rides under the main menu.
 * It starts the moment you enter VR from the landing page (a user gesture, so
 * autoplay is allowed) and loops while you're in the LOBBY. It pauses the
 * instant you start a bout or aim training, and resumes when you land back in
 * the menu. A mute button on the lobby HUD toggles it, and the choice is
 * REMEMBERED in localStorage — mute it once and it stays silent on every future
 * visit until you un-mute.
 *
 * Plain HTMLAudioElement (not the WebAudio SFX graph): it's a long looping
 * track that just needs play/pause, nothing spatial. Playback is the AND of
 * three gates — entered VR, in the lobby, not muted — funnelled through sync().
 */

import musicUrl from '../assets/music/dune-train-convoy.mp3?url';

const MUTE_KEY = 'ibb-music-muted';

let audio: HTMLAudioElement | null = null;
let entered = false; // has the player entered VR (the autoplay-unlocking gesture)?
let lobbyActive = true; // are we in the menu/lobby (vs a bout or training)?

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

/** Play only when we've entered VR, are in the lobby, and aren't muted —
 *  otherwise pause. Every state change funnels through here. */
function sync(): void {
  if (entered && lobbyActive && !isMusicMuted()) {
    void ensureAudio().play().catch(() => {
      /* autoplay blocked or decode failed — stay silent */
    });
  } else {
    audio?.pause();
  }
}

/**
 * Start the lobby music — call once, inside the enter-VR click gesture, so the
 * browser allows playback. No-op if the player muted it on a previous visit or
 * isn't in the lobby.
 */
export function enterMenuMusic(): void {
  entered = true;
  sync();
}

/** Mark whether the player is in the lobby; pauses the music during a bout or
 *  aim training and resumes it on the way back to the menu. */
export function setMenuMusicActive(inLobby: boolean): void {
  lobbyActive = inLobby;
  sync();
}

/** Flip mute (persisted). Returns the new muted state for the HUD glyph. */
export function toggleMusicMuted(): boolean {
  const muted = !isMusicMuted();
  setMuted(muted);
  sync();
  return muted;
}
