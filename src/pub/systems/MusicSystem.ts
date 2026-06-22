/**
 * The pub JUKEBOX — server-synced local songs.
 *
 * Songs live in src/pub/songs (drop in `.mp3` files, see songs.ts). The pub
 * server holds ONE track the whole room shares (pub.music, −1 = off). Walk up
 * to the cabinet and pull the trigger to cycle off → track 0 → 1 → … → off;
 * that asks the server, which broadcasts the choice to everyone, so the room
 * always hears the same thing (and late joiners catch whatever's on).
 *
 * Each track is a plain <audio> element pointed at the bundled file. The
 * selected song LOOPS until you flip. We roll the element's own `volume` with
 * distance to the cabinet and duck it while anyone's talking — the walk-up
 * "louder up close" feel, no Web Audio routing needed for same-origin files.
 */

import { createSystem, InputComponent } from '@iwsdk/core';
import { Mesh, MeshStandardMaterial, Quaternion, Vector3 } from 'three';
import { uiClick } from '../../audio/sfx.js';
import { JUKEBOX } from '../config.js';
import { TRACKS } from '../songs.js';
import { pubSendRaw } from '../net.js';
import { bus, pub } from '../state.js';
import { anyPubVoiceSpeaking } from '../voice/playback.js';

const HANDS = ['left', 'right'] as const;

const _cam = new Vector3();
const _box = new Vector3();
const _aim = new Vector3();
const _rayO = new Vector3();
const _rayDir = new Vector3();
const _toJuke = new Vector3();
const _q = new Quaternion();

// The jukebox is "actionable" exactly when a hand's AIM CONE falls on it —
// the same forgiving touch-cone cue the grabbable props (beer, darts) use,
// rather than mere proximity. Matched to PropSystem's range-grab cone.
const JUKE_AIM_MAX = 1.6; // how far you can stand and still aim at it (m)
const JUKE_AIM_CONE_COS = Math.cos((32 * Math.PI) / 180);
const JUKE_AIM_Y = 1.1; // aim at the cabinet body, not its floor-level origin

export class MusicSystem extends createSystem({}) {
  /** One <audio> per track, created the first time that track is selected. */
  private audios: (HTMLAudioElement | null)[] = TRACKS.map(() => null);
  /** Track currently playing locally (−1 = off) — mirrors pub.music. */
  private station = -1;
  /** A play() the browser blocked (autoplay policy) — retry on the next trigger. */
  private pendingPlay = false;
  /** Playback state of the active track, for the marquee readout. */
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
    pub.refs.jukebox.getWorldPosition(_box); // floor centre — for distance volume
    _aim.copy(_box);
    _aim.y += JUKE_AIM_Y; // the point on the cabinet a hand aims at

    // Light the cabinet up when a hand's aim cone falls on it — the same
    // "you can interact with this" cue the grabbable props (beer, darts) give.
    const handAimed: Record<'left' | 'right', boolean> = { left: false, right: false };
    let aimed = false;
    for (const hand of HANDS) {
      const ray = this.player.raySpaces[hand];
      if (!ray) continue;
      ray.getWorldPosition(_rayO);
      ray.getWorldQuaternion(_q);
      _rayDir.set(0, 0, -1).applyQuaternion(_q).normalize();
      _toJuke.copy(_aim).sub(_rayO);
      const dist = _toJuke.length();
      if (dist < 1e-3 || dist > JUKE_AIM_MAX) continue;
      if (_toJuke.divideScalar(dist).dot(_rayDir) < JUKE_AIM_CONE_COS) continue;
      handAimed[hand] = true;
      aimed = true;
    }
    this.setLit(aimed);

    // Walk-up control: a trigger pull while a hand is aimed at it flips station.
    let triggered = false;
    for (const hand of HANDS) {
      const gp = this.input.xr.gamepads[hand];
      if (!gp || !gp.getButtonDown(InputComponent.Trigger)) continue;
      triggered = true; // any trigger is a fresh gesture (may unblock autoplay)
      if (handAimed[hand]) {
        this.flip();
        break;
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
    if (TRACKS.length === 0) return; // no songs committed yet — nothing to play
    const next = this.station + 1 >= TRACKS.length ? -1 : this.station + 1;
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
    if (s >= 0 && s < TRACKS.length) {
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
      audio = new Audio(TRACKS[s].url);
      audio.preload = 'none';
      audio.loop = true; // the chosen song plays on a loop until you flip
      audio.crossOrigin = null; // same-origin bundled file — no CORS need
      audio.volume = 0;
      // A file that won't decode shows "no signal" (skippable); a real start
      // flips the marquee to playing.
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
    if (TRACKS.length === 0) {
      panel.setLines([
        { text: 'JUKEBOX', size: 58, colour: '#ffb000', bold: true },
        { text: 'add songs to src/pub/songs', size: 26, colour: '#aeb6c2' },
      ]);
      return;
    }
    if (this.station < 0) {
      panel.setLines([
        { text: 'JUKEBOX', size: 58, colour: '#ffb000', bold: true },
        { text: 'pull trigger to play', size: 30, colour: '#aeb6c2' },
      ]);
      return;
    }
    const t = TRACKS[this.station];
    const sub =
      this.signal === 'nosignal' ? "can't play this file — trigger to skip"
      : this.signal === 'connecting' ? 'loading…'
      : `track ${this.station + 1} of ${TRACKS.length}`;
    panel.setLines([
      { text: `♪ ${t.name}`, size: 50, colour: '#ffb000', bold: true },
      { text: sub, size: 28, colour: this.signal === 'nosignal' ? '#e8352a' : '#aeb6c2' },
    ]);
  }
}
