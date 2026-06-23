/**
 * Punters. Streams the local player's head/hand poses to the pub server at
 * 20 Hz and embodies every remote player as a full iron boxer — the SAME rig
 * as the main game's opponent (buildBoxer + solveTorso), so the pub crowd
 * looks exactly like the fighters you meet in the arena. Each punter gets a
 * unique accent tint (assigned by join order) and a name tag.
 */

import { createSystem, InputComponent } from '@iwsdk/core';
import { Color, Group, MeshStandardMaterial, Quaternion, Vector3 } from 'three';
import { buildBoxer } from '../../avatar/boxer.js';
import { buildHand, HAND_ADDUCTION, setHandCurl } from '../../avatar/hands.js';
import { applyAvatarSkin, resolveAvatarSkin } from '../../avatar/skins.js';
import { myAvatarSkin } from '../../menu/customization.js';
import { solveTorso } from '../../avatar/boxer.js';
import { NET, PALETTE, teamColor } from '../../config.js';
import { spawnGestureCue } from '../../fx/effects.js';
import { pulseHand } from '../../input/haptics.js';
import { audioContext, clap, micToggle, saloonEntry } from '../../audio/sfx.js';
import { onSnap, onSpawn, onVoice, pubSendRaw, pubSendVoice } from '../net.js';
import { startVoiceCapture, stopVoiceCapture, toggleVoiceMuted } from '../voice/capture.js';
import {
  isSpeaking,
  pushVoiceFrame,
  removeVoiceSpeaker,
  setVoiceSpeakerPosition,
  updateVoiceListener,
} from '../voice/playback.js';
import { Panel } from '../panel.js';
import type { PoseTuple, PubPlayerNet } from '../protocol.js';
import { bus, pub, type RemotePunter } from '../state.js';

const SEND_INTERVAL = 0.05; // 20 Hz
const EASE = 14; // exponential smoothing rate for remote pose targets
// How far a punter's spine hangs behind their head. The default (BODY_IK's
// 0.16) is tuned so your OWN torso doesn't block your downward view; on the
// crowd you watch, that much set-back just reads as the head floating ahead of
// the body, so we seat it closer over the shoulders.
const PUNTER_SET_BACK = 0.05;
const CLAP_DISTANCE = 0.13;
// Hands have to come together with real intent — a slow drift between resting
// hands shouldn't read as applause.
const CLAP_CLOSING_SPEED = 1.45;
const CLAP_COMBINED_SPEED = 2.1;
const CLAP_COOLDOWN = 0.55;

const _pos = new Vector3();
const _quat = new Quaternion();
const _head = new Vector3();
const _headQ = new Quaternion();
const _chest = new Vector3();
const _pelvis = new Vector3();
const _cam = new Vector3();
const _camQ = new Quaternion();
const _left = new Vector3();
const _right = new Vector3();
const _mid = new Vector3();

function packWorldPose(obj: { getWorldPosition(v: Vector3): Vector3; getWorldQuaternion(q: Quaternion): Quaternion }): PoseTuple {
  obj.getWorldPosition(_pos);
  obj.getWorldQuaternion(_quat);
  return [_pos.x, _pos.y, _pos.z, _quat.x, _quat.y, _quat.z, _quat.w];
}

/**
 * Re-tint a boxer rig built for team 1 (blue) to an arbitrary accent: every
 * material that used the team colour — chassis emissives, glow parts, glove
 * LED colour ramps — is swapped to the punter's own colour. (Also used by
 * the barkeep, who runs house amber.)
 */
export function retintRig(groups: Group[], accent: number): void {
  const teamHex = teamColor(1);
  const accentColor = new Color(accent);
  const seen = new Set<MeshStandardMaterial>();
  for (const group of groups) {
    group.traverse((o) => {
      const m = (o as { material?: MeshStandardMaterial }).material;
      if (!m || !(m as MeshStandardMaterial).isMaterial || seen.has(m)) return;
      seen.add(m);
      if (m.color?.getHex() === teamHex) m.color.copy(accentColor);
      if (m.emissive?.getHex() === teamHex) m.emissive.copy(accentColor);
      // Glove LED ramps store their own base/lit colours.
      if (m.userData.baseColor instanceof Color) m.userData.baseColor.copy(accentColor);
      if (m.userData.litColor instanceof Color) {
        m.userData.litColor.copy(accentColor).lerp(new Color(PALETTE.white), 0.7);
      }
    });
  }
}

export class PubPlayerSystem extends createSystem({}) {
  private sendTimer = 0;
  private localGloves: Group[] = [];
  private localGlovesAttached = false;
  private prevLeft = new Vector3();
  private prevRight = new Vector3();
  private prevDistance = 0;
  private hasPrevHands = false;
  private clapCooldown = 0;
  private voiceStarted = false;
  /** A mic request is in flight (await getUserMedia). */
  private voiceStarting = false;
  /** Seconds to wait before re-asking for the mic after a failed attempt. */
  private voiceRetryCooldown = 0;

  init(): void {
    onSpawn((p) => this.spawn(p));
    // Voice is spatial PCM over the SAME room WebSocket that carries poses (see
    // voice/capture.ts + playback.ts + relayVoice in server/pub.mjs) — no SFU,
    // no peer connections, nothing to configure. Each inbound frame is fed to
    // its speaker's HRTF panner; we auto-join the mic on arrival (ensureVoice).
    onVoice((id, frame) => pushVoiceFrame(id, frame));
    onSnap((poses) => {
      for (const [id, head, left, right] of poses) {
        const punter = pub.punters.get(id);
        if (punter) {
          punter.head = head;
          punter.left = left;
          punter.right = right;
        }
      }
    });
    this.cleanupFuncs.push(
      bus.on('left', (id) => this.despawn(id)),
      bus.on('disconnected', () => stopVoiceCapture()),
      // The server hands out our accent on welcome — restyle our fists to it.
      bus.on('connected', () => {
        for (const glove of this.localGloves) retintLocal(glove, pub.myAccent);
      }),
    );
  }

  update(delta: number): void {
    this.attachLocalGloves();
    this.voiceRetryCooldown = Math.max(0, this.voiceRetryCooldown - delta);
    // A press is a fresh user gesture — use it to unlock audio playback and to
    // retry the mic NOW if the automatic join got blocked by the gesture gate.
    if (this.anyDown(InputComponent.Trigger) || this.anyDown(InputComponent.Squeeze)) {
      void audioContext()?.resume();
      if (!this.voiceStarted) this.voiceRetryCooldown = 0;
    }
    this.ensureVoice();
    this.tryLocalClap(delta);

    // Your fingers track your real squeeze (trigger = index, grip = rest).
    (['left', 'right'] as const).forEach((hand, i) => {
      const glove = this.localGloves[i];
      const gp = this.input.xr.gamepads[hand];
      if (!glove || !gp) return;
      const trig = gp.getButtonValue(InputComponent.Trigger);
      const sq = gp.getButtonValue(InputComponent.Squeeze);
      setHandCurl(glove, Math.max(trig, sq * 0.6), Math.max(sq, trig * 0.45), 0.35 + Math.max(trig, sq) * 0.55);
    });

    // --- outbound pose ------------------------------------------------------
    if (pub.online) {
      this.sendTimer += delta;
      // A fighter in the pit streams at quick-match's denser pose rate so their
      // dodges read crisply across the gap; the casual crowd stays at 20 Hz.
      const interval = pub.fight.sides.includes(pub.myId) ? 1 / NET.poseRateHz : SEND_INTERVAL;
      if (this.sendTimer >= interval) {
        this.sendTimer = 0;
        pubSendRaw({
          t: 'pose',
          head: packWorldPose(this.player.head),
          left: packWorldPose(this.player.gripSpaces.left),
          right: packWorldPose(this.player.gripSpaces.right),
        });
      }
    }

    // --- voice ---------------------------------------------------------------
    // You arrive auto-joined and unmuted; Left Y mutes/unmutes your mic.
    if (this.input.xr.gamepads.left?.getButtonDown(InputComponent.Y_Button)) {
      const muted = toggleVoiceMuted();
      micToggle(!muted);
      pulseHand(this.world.session, 'left', 0.25, muted ? 30 : 60);
    }
    // Glue the listener to your head; each punter's voice is pinned to theirs in
    // the loop below, so the room sounds directional.
    this.camera.getWorldPosition(_cam);
    this.camera.getWorldQuaternion(_camQ);
    updateVoiceListener(_cam, _camQ);

    // --- remote punters -----------------------------------------------------
    if (pub.punters.size === 0) return;
    const crowdK = 1 - Math.exp(-EASE * delta);
    const fighterK = 1 - Math.exp(-NET.smoothing * delta); // arena-grade for the pit

    for (const punter of pub.punters.values()) {
      const rig = punter.rig;
      // A fighter (denser pose stream) eases in at the arena's smoothing so the
      // duel tracks 1:1 with quick match; everyone else stays gently smoothed.
      const k = pub.fight.sides.includes(punter.id) ? fighterK : crowdK;
      // Ease the visible head toward the network target, then solve the torso
      // under it exactly like the arena does.
      _head.set(punter.head[0], punter.head[1], punter.head[2]);
      _headQ.set(punter.head[3], punter.head[4], punter.head[5], punter.head[6]);
      rig.head.position.lerp(_head, k);
      rig.head.quaternion.slerp(_headQ, k);
      // Their voice comes from their iron skull.
      setVoiceSpeakerPosition(punter.id, rig.head.position);
      solveTorso(
        rig,
        rig.head.position,
        rig.head.quaternion,
        rig.head.position.x,
        rig.head.position.z,
        _chest,
        _pelvis,
        // Seat the head over the shoulders for the people we LOOK AT — the
        // first-person view-clearing set-back makes their heads jut forward.
        PUNTER_SET_BACK,
      );
      for (const hand of [0, 1] as const) {
        const tuple = hand === 0 ? punter.left : punter.right;
        const glove = rig.gloves[hand];
        _pos.set(tuple[0], tuple[1], tuple[2]);
        _quat.set(tuple[3], tuple[4], tuple[5], tuple[6]);
        _quat.multiply(HAND_ADDUCTION[hand]);
        glove.position.lerp(_pos, k);
        glove.quaternion.slerp(_quat, k);
      }
      // Name tag floats over the helmet, facing you — and swells a touch while
      // they're talking so you can see who has the floor.
      punter.nameTag.mesh.position.copy(rig.head.position);
      punter.nameTag.mesh.position.y += 0.6; // ride well clear of the helmet
      punter.nameTag.mesh.lookAt(_cam);
      punter.nameTag.mesh.scale.setScalar(isSpeaking(punter.id) ? 1.12 : 1);
    }
  }

  private spawn(p: PubPlayerNet): void {
    if (pub.punters.has(p.id) || p.id === pub.myId) return;
    // Build ONLY the skin this punter wears (resolves blank/locked → default) —
    // not all three with two hidden. Always apply it so an unskinned punter
    // shows the default body, never an invisible one.
    const skin = resolveAvatarSkin(p.av ?? '', typeof p.avc === 'number' ? p.avc : -1);
    const rig = buildBoxer(1, skin.id);
    retintRig(rig.all, p.accent);
    // Their arena skin rides over the accent tint (LEDs keep the accent).
    for (const part of rig.all) applyAvatarSkin(part, skin);
    for (const part of rig.all) this.scene.add(part);
    rig.head.position.set(p.head[0], p.head[1] || 1.6, p.head[2]);

    // Floating name: plate-free, white, futuristic HUD type, riding high.
    const nameTag = new Panel(0.8, 0.2, 512);
    nameTag.setLabel(p.name.slice(0, 14).toUpperCase(), '#ffffff', 80);
    this.scene.add(nameTag.mesh);

    const punter: RemotePunter = {
      id: p.id,
      name: p.name,
      accent: p.accent,
      av: p.av ?? '',
      pf: p.pf ?? '',
      rig,
      nameTag,
      head: p.head,
      left: p.left,
      right: p.right,
    };
    pub.punters.set(p.id, punter);
    bus.emit('joined', punter);
    saloonEntry(); // swinging doors — someone just walked in
  }

  /**
   * Auto-join the room's voice the moment we're connected — no "press to talk".
   * Capturing the mic wants a user gesture, and entering VR already gave us one
   * (sticky activation), so the first attempt usually takes; if the browser
   * still blocks it, a controller press clears the cooldown and that fresh
   * gesture gets us in. Nothing on the server is needed — frames just ride the
   * pose socket and `relayVoice` fans them out.
   */
  private ensureVoice(): void {
    if (this.voiceStarted || this.voiceStarting) return;
    if (this.voiceRetryCooldown > 0) return;
    if (!pub.online || !pub.myId) return;
    this.voiceStarting = true;
    void startVoiceCapture(pubSendVoice).then((ok) => {
      this.voiceStarting = false;
      this.voiceStarted = ok; // only a real success locks it in
      if (!ok) this.voiceRetryCooldown = 1.5; // retry shortly / on the next press
    });
  }

  private despawn(id: string): void {
    const punter = pub.punters.get(id);
    if (!punter) return;
    removeVoiceSpeaker(id);
    for (const part of punter.rig.all) this.scene.remove(part);
    this.scene.remove(punter.nameTag.mesh);
    punter.nameTag.dispose();
    pub.punters.delete(id);
  }

  /** Your own fists are the main game's gauntlets, tinted your accent. */
  private attachLocalGloves(): void {
    if (this.localGlovesAttached) return;
    const grips = this.player.gripSpaces;
    if (!grips.left || !grips.right) return;
    for (const hand of ['left', 'right'] as const) {
      const glove = buildHand(hand === 'left' ? 1 : -1);
      glove.quaternion.copy(HAND_ADDUCTION[hand === 'left' ? 0 : 1]);
      retintLocal(glove, pub.myAccent);
      applyAvatarSkin(glove, myAvatarSkin()); // your shape + custom colour walk in too
      grips[hand].add(glove);
      this.localGloves.push(glove);
    }
    this.localGlovesAttached = true;
  }

  private tryLocalClap(delta: number): void {
    const leftGrip = this.player.gripSpaces.left;
    const rightGrip = this.player.gripSpaces.right;
    if (!leftGrip || !rightGrip) {
      this.hasPrevHands = false;
      return;
    }

    leftGrip.getWorldPosition(_left);
    rightGrip.getWorldPosition(_right);
    this.clapCooldown = Math.max(0, this.clapCooldown - delta);

    if (
      this.hasPrevHands &&
      this.clapCooldown <= 0 &&
      delta > 0 &&
      !this.anyPressed(InputComponent.Trigger) &&
      !this.anyPressed(InputComponent.Squeeze)
    ) {
      const distance = _left.distanceTo(_right);
      const closingSpeed = (this.prevDistance - distance) / delta;
      const leftSpeed = _left.distanceTo(this.prevLeft) / delta;
      const rightSpeed = _right.distanceTo(this.prevRight) / delta;
      if (
        distance <= CLAP_DISTANCE &&
        (closingSpeed >= CLAP_CLOSING_SPEED || leftSpeed + rightSpeed >= CLAP_COMBINED_SPEED)
      ) {
        _mid.copy(_left).add(_right).multiplyScalar(0.5);
        spawnGestureCue(this.world, _mid, 0.14); // small, quick spark — not a flashbang
        clap();
        pulseHand(this.world.session, 'left', 0.35, 55);
        pulseHand(this.world.session, 'right', 0.35, 55);
        this.clapCooldown = CLAP_COOLDOWN;
      }
    }

    this.prevLeft.copy(_left);
    this.prevRight.copy(_right);
    this.prevDistance = _left.distanceTo(_right);
    this.hasPrevHands = true;
  }

  private anyPressed(button: string): boolean {
    return (
      (this.input.xr.gamepads.left?.getButtonPressed(button) ?? false) ||
      (this.input.xr.gamepads.right?.getButtonPressed(button) ?? false)
    );
  }

  /** True on the frame either hand newly presses `button` (a fresh gesture). */
  private anyDown(button: string): boolean {
    return (
      (this.input.xr.gamepads.left?.getButtonDown(button) ?? false) ||
      (this.input.xr.gamepads.right?.getButtonDown(button) ?? false)
    );
  }
}

function retintLocal(glove: Group, accent: number): void {
  if (accent === teamColor(0)) return; // already ember
  const teamHex = teamColor(0);
  const accentColor = new Color(accent);
  glove.traverse((o) => {
    const m = (o as { material?: MeshStandardMaterial }).material;
    if (!m || !(m as MeshStandardMaterial).isMaterial) return;
    if (m.color?.getHex() === teamHex) m.color.copy(accentColor);
    if (m.emissive?.getHex() === teamHex) m.emissive.copy(accentColor);
    if (m.userData.baseColor instanceof Color) m.userData.baseColor.copy(accentColor);
    if (m.userData.litColor instanceof Color) {
      m.userData.litColor.copy(accentColor).lerp(new Color(PALETTE.white), 0.7);
    }
  });
}
