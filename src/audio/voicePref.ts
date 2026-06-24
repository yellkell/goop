/**
 * Voice-chat preference — one global on/off the player sets in the main menu,
 * persisted to localStorage so BOTH the arena (quick-match / mesh voice) and the
 * pub (spatial room voice) honour it. ON by default. When off, the player's mic
 * is muted (nothing transmitted) and incoming voice is dropped (you hear no one).
 *
 * Read at the moment voice starts (a match connecting, the pub loading) — the
 * toggle lives in the lobby, so there's no mid-bout flipping to worry about.
 */

const KEY = 'ff-voice';

/** Voice chat enabled? Defaults to TRUE (only an explicit '0' turns it off). */
export function voiceEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) !== '0';
  } catch {
    return true;
  }
}

export function setVoiceEnabled(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? '1' : '0');
  } catch {
    /* private mode — the choice just won't persist */
  }
}
