/**
 * Tutorial music — the "Breakcore" track that loops for the whole guided
 * basics tutorial. The tutorial rides a bot bout, during which the lobby
 * music is paused (you've left the menu) and the battle score is suppressed
 * (`if (!app.tutorial) startBattleMusic()`), so nothing else is playing — this
 * fills that gap. TutorialSystem starts it when the tutorial begins and stops
 * it when the tutorial ends (graduation KO, forfeit, or bail).
 *
 * Plain HTMLAudioElement, honours the same persisted mute as the lobby music.
 */

import { isMusicMuted } from './menuMusic.js';
import breakcoreUrl from '../assets/music/breakcore.mp3?url';

const VOLUME = 0.4;

let audio: HTMLAudioElement | null = null;

/** Loop the tutorial track from the top. No-op if muted. */
export function startTutorialMusic(): void {
  if (isMusicMuted()) return;
  if (!audio) {
    audio = new Audio(breakcoreUrl);
    audio.loop = true;
  }
  audio.volume = VOLUME;
  audio.currentTime = 0;
  void audio.play().catch(() => {
    /* autoplay blocked or decode failed — stay silent */
  });
}

/** Stop the tutorial track (the lobby music comes back up on the way out). */
export function stopTutorialMusic(): void {
  audio?.pause();
}
