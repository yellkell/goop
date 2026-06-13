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
import { buildHand, setHandCurl } from '../../avatar/hands.js';
import { solveTorso } from '../../avatar/boxer.js';
import { PALETTE, teamColor } from '../../config.js';
import { onSnap, onSpawn, pubSendRaw } from '../net.js';
import { Panel } from '../panel.js';
import type { PoseTuple, PubPlayerNet } from '../protocol.js';
import { bus, pub, type RemotePunter } from '../state.js';

const SEND_INTERVAL = 0.05; // 20 Hz
const EASE = 14; // exponential smoothing rate for remote pose targets

const _pos = new Vector3();
const _quat = new Quaternion();
const _head = new Vector3();
const _headQ = new Quaternion();
const _chest = new Vector3();
const _pelvis = new Vector3();
const _cam = new Vector3();

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

  init(): void {
    onSpawn((p) => this.spawn(p));
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
      // The server hands out our accent on welcome — restyle our fists to it.
      bus.on('connected', () => {
        for (const glove of this.localGloves) retintLocal(glove, pub.myAccent);
      }),
    );
  }

  update(delta: number): void {
    this.attachLocalGloves();

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
      if (this.sendTimer >= SEND_INTERVAL) {
        this.sendTimer = 0;
        pubSendRaw({
          t: 'pose',
          head: packWorldPose(this.player.head),
          left: packWorldPose(this.player.gripSpaces.left),
          right: packWorldPose(this.player.gripSpaces.right),
        });
      }
    }

    // --- remote punters -----------------------------------------------------
    if (pub.punters.size === 0) return;
    const k = 1 - Math.exp(-EASE * delta);
    this.camera.getWorldPosition(_cam);

    for (const punter of pub.punters.values()) {
      const rig = punter.rig;
      // Ease the visible head toward the network target, then solve the torso
      // under it exactly like the arena does.
      _head.set(punter.head[0], punter.head[1], punter.head[2]);
      _headQ.set(punter.head[3], punter.head[4], punter.head[5], punter.head[6]);
      rig.head.position.lerp(_head, k);
      rig.head.quaternion.slerp(_headQ, k);
      solveTorso(
        rig,
        rig.head.position,
        rig.head.quaternion,
        rig.head.position.x,
        rig.head.position.z,
        _chest,
        _pelvis,
      );
      for (const [tuple, glove] of [
        [punter.left, rig.gloves[0]],
        [punter.right, rig.gloves[1]],
      ] as const) {
        _pos.set(tuple[0], tuple[1], tuple[2]);
        _quat.set(tuple[3], tuple[4], tuple[5], tuple[6]);
        glove.position.lerp(_pos, k);
        glove.quaternion.slerp(_quat, k);
      }
      // Name tag floats over the helmet, facing you.
      punter.nameTag.mesh.position.copy(rig.head.position);
      punter.nameTag.mesh.position.y += 0.38;
      punter.nameTag.mesh.lookAt(_cam);
    }
  }

  private spawn(p: PubPlayerNet): void {
    if (pub.punters.has(p.id) || p.id === pub.myId) return;
    const rig = buildBoxer(1);
    retintRig(rig.all, p.accent);
    for (const part of rig.all) this.scene.add(part);
    rig.head.position.set(p.head[0], p.head[1] || 1.6, p.head[2]);

    const nameTag = new Panel(0.5, 0.12, 384);
    const hex = `#${p.accent.toString(16).padStart(6, '0')}`;
    nameTag.setLines([{ text: p.name.slice(0, 14).toUpperCase(), size: 30, colour: hex, bold: true }]);
    this.scene.add(nameTag.mesh);

    const punter: RemotePunter = {
      id: p.id,
      name: p.name,
      accent: p.accent,
      rig,
      nameTag,
      head: p.head,
      left: p.left,
      right: p.right,
    };
    pub.punters.set(p.id, punter);
    bus.emit('joined', punter);
  }

  private despawn(id: string): void {
    const punter = pub.punters.get(id);
    if (!punter) return;
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
      retintLocal(glove, pub.myAccent);
      grips[hand].add(glove);
      this.localGloves.push(glove);
    }
    this.localGlovesAttached = true;
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
