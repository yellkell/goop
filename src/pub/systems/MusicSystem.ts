/**
 * The pub JUKEBOX — server-synced web radio.
 *
 * The pub server holds ONE station the whole room shares (pub.music, −1 = off).
 * Walk up to the cabinet and pull the trigger to cycle off → station 0 → 1 →
 * off; that asks the server, which broadcasts the new station to everyone, so
 * the room always hears the same thing (and late joiners catch whatever's on).
 *
 * Each station is a plain <audio> element pointed at an Icecast/SHOUTcast MP3
 * (see JUKEBOX.stations). We deliberately DON'T route it through Web Audio: a
 * cross-origin radio stream only survives a MediaElementSource if the station
 * sends CORS headers (most don't), so instead we just roll the element's own
 * `volume` with distance to the cabinet and duck it while anyone's talking.
 * Not true HRTF panning, but it gives the walk-up "louder up close" feel with
 * any stream, no CORS surprises.
 */

import { createSystem, InputComponent } from '@iwsdk/core';
import { Mesh, MeshStandardMaterial, Vector3 } from 'three';
import { uiClick } from '../../audio/sfx.js';
import { JUKEBOX } from '../config.js';
import { pubSendRaw } from '../net.js';
import { bus, pub } from '../state.js';
import { anyPubVoiceSpeaking } from '../voice/playback.js';

const HANDS = ['left', 'right'] as const;

const _cam = new Vector3();
const _box = new Vector3();
const _hand = new Vector3();

export class MusicSystem extends createSystem({}) {
  /** One <audio> per station, created the first time that station is selected. */
  private audios: (HTMLAudioElement | null)[] = JUKEBOX.stations.map(() => null);
  /** Station currently playing locally (−1 = off) — mirrors pub.music. */
  private station = -1;
  /** A play() the browser blocked (autoplay policy) — retry on the next trigger. */
  private pendingPlay = false;
  /** Connection state of the active station, for the marquee readout. */
  private signal: 'connecting' | 'live' | 'nosignal' = 'connecting';
  /** True while a hand is close enough to interact — the cabinet flares up. */
  private lit = false;

  init(): void {
    // The room (or another punter) chose a station: switch to match.
    this.cleanupFuncs.push(bus.on('music', (s) => this.setStation(s)));
    // Adopt whatever's already on (if welcome landed before us).
    this.setStation(pub.music);
  }

  update(): void {
    if (!this.player || !pub.refs) return;
    pub.refs.jukebox.getWorldPosition(_box);

    // Light the cabinet up when a hand is close enough to use it — the same
    // "you can interact with this" cue the grabbable props (beer, darts) give.
    let near = false;
    for (const hand of HANDS) {
      const grip = this.player.gripSpaces[hand];
      if (!grip) continue;
      grip.getWorldPosition(_hand);
      if (nearXZ(_hand, _box, JUKEBOX.reach * 1.4)) {
        near = true;
        break;
      }
    }
    this.setLit(near);

    // Walk-up control: a trigger pull with a hand near the cabinet flips station.
    let triggered = false;
    for (const hand of HANDS) {
      const gp = this.input.xr.gamepads[hand];
      if (!gp || !gp.getButtonDown(InputComponent.Trigger)) continue;
      triggered = true; // any trigger is a fresh gesture (may unblock autoplay)
      const grip = this.player.gripSpaces[hand];
      if (grip) {
        grip.getWorldPosition(_hand);
        if (nearXZ(_hand, _box, JUKEBOX.reach)) {
          this.flip();
          break;
        }
      }
    }
    if (this.pendingPlay && triggered) this.resume();

    // Distance volume + voice duck on the active station.
    const audio = this.station >= 0 ? this.audios[this.station] : null;
    if (audio) {
      this.camera.getWorldPosition(_cam);
      const d = Math.hypot(_cam.x - _box.x, _cam.z - _box.z);
      const fade = (JUKEBOX.hearFar - d) / (JUKEBOX.hearFar - JUKEBOX.hearNear);
      let vol = JUKEBOX.volume * Math.max(0, Math.min(1, fade));
      if (anyPubVoiceSpeaking()) vol *= JUKEBOX.duck;
      audio.volume = vol;
    }
  }

  /** Flare the whole cabinet's neon up (or back to rest) when in reach. */
  private setLit(on: boolean): void {
    if (on === this.lit) return;
    this.lit = on;
    const juke = pub.refs?.jukebox;
    if (!juke) return;
    juke.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const mat of mats) {
        const m = mat as MeshStandardMaterial;
        const base = m.userData?.baseGlow as number | undefined;
        if (typeof base === 'number') m.emissiveIntensity = base * (on ? 1.85 : 1);
      }
    });
  }

  /** Cycle off → 0 → 1 → … → off, tell the room, and apply locally right away. */
  private flip(): void {
    const next = this.station + 1 >= JUKEBOX.stations.length ? -1 : this.station + 1;
    uiClick();
    if (pub.online) pubSendRaw({ t: 'music', station: next });
    pub.music = next;
    this.setStation(next); // optimistic; the server's echo is idempotent
  }

  /** Switch to `s` (−1 = off): stop the old stream, start the new, redraw the marquee. */
  private setStation(s: number): void {
    if (s === this.station) return;
    const old = this.station >= 0 ? this.audios[this.station] : null;
    old?.pause();
    this.station = s;
    this.pendingPlay = false;
    this.signal = 'connecting';
    if (s >= 0 && s < JUKEBOX.stations.length) {
      const audio = this.ensureAudio(s);
      audio.volume = 0; // the update loop sets the real level from distance
      audio.play().catch((e: unknown) => this.onPlayReject(e));
    }
    this.drawMarquee();
  }

  /** Retry a play() the autoplay policy blocked — driven by a fresh trigger gesture. */
  private resume(): void {
    this.pendingPlay = false;
    const audio = this.station >= 0 ? this.audios[this.station] : null;
    audio?.play().catch((e: unknown) => this.onPlayReject(e));
  }

  /** Tell an autoplay block (retry on a gesture) from a dead stream (show it). */
  private onPlayReject(e: unknown): void {
    if ((e as { name?: string })?.name === 'NotAllowedError') this.pendingPlay = true;
    else this.setSignal('nosignal');
  }

  private setSignal(s: 'connecting' | 'live' | 'nosignal'): void {
    if (this.signal === s) return;
    this.signal = s;
    this.drawMarquee();
  }

  private ensureAudio(s: number): HTMLAudioElement {
    let audio = this.audios[s];
    if (!audio) {
      audio = new Audio(JUKEBOX.stations[s].url);
      audio.preload = 'none';
      audio.crossOrigin = null; // plain element playback — never tainted, no CORS need
      audio.volume = 0;
      // A dead/blocked SomaFM mount shows "no signal" (skippable) instead of
      // silent dead air; a real connect flips the marquee to live.
      audio.addEventListener('playing', () => {
        if (s === this.station) this.setSignal('live');
      });
      audio.addEventListener('error', () => {
        if (s === this.station) this.setSignal('nosignal');
      });
      this.audios[s] = audio;
    }
    return audio;
  }

  private drawMarquee(): void {
    const panel = pub.refs?.jukeboxPanel;
    if (!panel) return;
    if (this.station < 0) {
      panel.setLines([
        { text: 'JUKEBOX', size: 58, colour: '#ffb000', bold: true },
        { text: 'pull trigger to play', size: 30, colour: '#aeb6c2' },
      ]);
      return;
    }
    const st = JUKEBOX.stations[this.station];
    const sub =
      this.signal === 'nosignal' ? 'no signal — trigger to skip'
      : this.signal === 'connecting' ? 'connecting…'
      : st.sub;
    panel.setLines([
      { text: `♪ ${st.name}`, size: 54, colour: '#ffb000', bold: true },
      { text: sub, size: 30, colour: this.signal === 'nosignal' ? '#e8352a' : '#aeb6c2' },
    ]);
  }
}

function nearXZ(a: Vector3, b: Vector3, r: number): boolean {
  return (a.x - b.x) ** 2 + (a.z - b.z) ** 2 <= r * r;
}
