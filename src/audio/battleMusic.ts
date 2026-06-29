/**
 * Battle music — quiet background score for a live bout. When a match starts we
 * pick ONE of the battle tracks at random and loop it under the fight; when the
 * match ends we stop it and ring a victory sting (both players hear it).
 *
 * The end-of-match handoff is the fiddly bit: the sting keeps playing as you
 * return to the lobby, rings out a few more seconds there (if it has more to
 * give), then FADES, a short PAUSE, and only THEN does the lobby music come up —
 * so the sting and the lobby music never overlap. Everything sits well under the
 * lobby music (it's background). Plain HTMLAudioElements.
 */

import { fadeInMenuMusic, isMusicMuted } from './menuMusic.js';
import victoryUrl from '../assets/music/victory.mp3?url';

// Auto-discovered battle tracks — drop more .mp3s in assets/music/battle.
const battleUrls = Object.values(
  import.meta.glob('../assets/music/battle/*.mp3', { eager: true, query: '?url', import: 'default' }) as Record<
    string,
    string
  >,
);

const BATTLE_VOLUME = 0.18; // quiet background, well under the lobby music (0.5)
const VICTORY_VOLUME = 0.26;

// Post-match handoff timings.
const VICTORY_LOBBY_MS = 6500; // extra airtime in the lobby if the sting has more
const VICTORY_FADE_MS = 1500; // fade the sting out over this
const VICTORY_PAUSE_MS = 1000; // silence between the sting and the lobby music

let battle: HTMLAudioElement | null = null;
let victory: HTMLAudioElement | null = null;
let timers: number[] = [];
let handoffActive = false;

/** Cancel any in-flight victory→lobby handoff (timers + the ended listener). */
function clearHandoff(): void {
  for (const t of timers) {
    clearTimeout(t);
    clearInterval(t);
  }
  timers = [];
  handoffActive = false;
  if (victory) victory.onended = null;
}

/** Start a random battle track (looping). Call when a bout begins. */
export function startBattleMusic(): void {
  clearHandoff(); // a new bout abandons any victory handoff
  victory?.pause();
  if (isMusicMuted() || battleUrls.length === 0) return;
  if (battle && !battle.paused) return; // already scoring this bout
  const url = battleUrls[Math.floor(Math.random() * battleUrls.length)];
  if (!battle) {
    battle = new Audio();
    battle.loop = true;
  }
  if (battle.src !== url) battle.src = url;
  battle.volume = BATTLE_VOLUME;
  battle.currentTime = 0;
  void battle.play().catch(() => {
    /* autoplay blocked or decode failed — stay silent */
  });
}

/** Stop ONLY the looping battle track. The victory sting is handed off
 *  separately, so leaving a bout doesn't cut it short. */
export function stopBattleTrack(): void {
  battle?.pause();
}

/** Match over: duck the battle track and ring the victory sting once. */
export function playVictory(): void {
  battle?.pause();
  if (isMusicMuted()) return;
  if (!victory) victory = new Audio(victoryUrl);
  victory.onended = null;
  victory.volume = VICTORY_VOLUME;
  victory.currentTime = 0;
  void victory.play().catch(() => {
    /* blocked or decode failed — no sting */
  });
}

/**
 * Back in the lobby. Stop the battle track, then: if the victory sting still has
 * more to play, let it ring ~6–7 s more, fade it out, pause, and only then bring
 * the lobby music up. If the sting is already done, the lobby music comes up
 * straight away. Either way they never overlap.
 */
export function handoffToLobby(): void {
  clearHandoff();
  battle?.pause();

  const v = victory;
  if (!v || v.paused || v.ended) {
    fadeInMenuMusic(); // nothing ringing — bring the lobby music up
    return;
  }

  handoffActive = true;
  // Finish = pause the sting, wait a beat of silence, then fade the lobby in.
  const finish = (): void => {
    if (!handoffActive) return;
    handoffActive = false;
    v.onended = null;
    v.pause();
    v.volume = VICTORY_VOLUME; // reset for next time
    timers.push(window.setTimeout(() => fadeInMenuMusic(), VICTORY_PAUSE_MS));
  };

  v.onended = finish; // sting ran out early → straight to pause + lobby music

  // Otherwise, after its lobby airtime, fade the sting out then finish.
  timers.push(
    window.setTimeout(() => {
      if (!handoffActive) return;
      const start = v.volume;
      const steps = Math.max(1, Math.round(VICTORY_FADE_MS / 50));
      let i = 0;
      const fade = window.setInterval(() => {
        i += 1;
        v.volume = Math.max(0, start * (1 - i / steps));
        if (i >= steps) {
          clearInterval(fade);
          finish();
        }
      }, 50);
      timers.push(fade);
    }, VICTORY_LOBBY_MS),
  );
}
