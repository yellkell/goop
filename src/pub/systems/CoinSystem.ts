/**
 * Coins in the pub — the bolt-dollar currency made physical.
 *
 * You wear your balance above your LEFT wrist (the riveted "$" symbol with the
 * count over it) — private, only you see it. Bring your RIGHT hand to that
 * wrist and pull the trigger to draw a coin out into it; let go to drop it and
 * it falls to the floor, where anyone can pick it up (trigger near it). Bring a
 * held coin back to your left wrist and release to bank it into your wallet.
 *
 * A coin is a BEARER TOKEN: pulling one debits a coin from your wallet there
 * and then; banking one credits whoever's holding it. So a coin abandoned on
 * the floor is money you literally dropped, and a coin caught and banked is
 * money found — the room conserves coins without any server bookkeeping.
 *
 * It's networked entirely with relayed events (see protocol's COIN_* events):
 * the pub server forwards anything it doesn't recognise, so this needs no
 * server state. The coin's owner simulates its fall and streams its position;
 * everyone else just renders it. Picking a coin up broadcasts COIN_TAKE so it
 * leaves every other view at once. Trigger is used throughout — props grab on
 * squeeze, so the two never fight.
 */

import { createSystem, InputComponent } from '@iwsdk/core';
import { CylinderGeometry, Mesh, MeshStandardMaterial, Quaternion, Vector3 } from 'three';
import { Panel } from '../panel.js';
import { coinImage } from '../../menu/coinIcon.js';
import { addCoins, coins as wallet, spendCoins } from '../../menu/wallet.js';
import { pubSendEvent } from '../net.js';
import { bus, pub } from '../state.js';
import { PUB, SURFACES, type Surface } from '../config.js';
import type { PubEvent, Vec3T } from '../protocol.js';

const WRIST_TOUCH = 0.13; // how close a hand must come to a wrist to pull/bank
const COIN_GRAB = 0.11; // reach for picking a coin off the floor
const INSERT_R = 0.42; // hold a coin this close to a machine's slot to feed it
const COIN_R = 0.032;
const COIN_THICK = 0.01;
const GRAVITY = 9.8;
const MOVE_INTERVAL = 1 / 15; // stream a falling coin's position at 15 Hz
const TAG_W = 0.1;
const TAG_H = 0.13;

/**
 * Where a dropped coin may come to rest: the floor, plus the same bar/booth
 * tops glasses use AND the four bar stools — so you can set a coin down on
 * tables, chairs and the bar instead of only the floor. Read-only reuse of the
 * glass SURFACES (never mutated, so glass behaviour is untouched).
 */
const STOOL_R = 0.17;
const COIN_SURFACES: Surface[] = [
  ...SURFACES,
  ...[-1.6, -0.8, 0.8, 1.6].map((x) => ({
    y: 0.69, // bar-stool seat top (environment.ts: puck at y≈0.65)
    minX: x - STOOL_R,
    maxX: x + STOOL_R,
    minZ: PUB.bar.z + 0.45 - STOOL_R,
    maxZ: PUB.bar.z + 0.45 + STOOL_R,
  })),
];

/** Centre height a coin rests at when it lands at (x,z), having fallen from
 *  `fromY`: the highest surface beneath it within reach, else the floor. */
function coinRestY(x: number, z: number, fromY: number): number {
  let top = 0; // the floor
  for (const s of COIN_SURFACES) {
    if (x >= s.minX && x <= s.maxX && z >= s.minZ && z <= s.maxZ && s.y <= fromY + 0.02 && s.y > top) top = s.y;
  }
  return top + COIN_THICK * 0.5;
}

/** A coin riding in a hand: a small gold disc that follows the grip. */
interface HeldCoin {
  mesh: Mesh;
  id: string;
}

/** A coin loose in the room — mine to simulate (owner 'me') or someone else's
 *  (owner 'remote', placed from the wire). */
interface FloorCoin {
  mesh: Mesh;
  id: string;
  owner: 'me' | 'remote';
  vel: Vector3;
  resting: boolean;
}

/** A wrist readout: the symbol + count, redrawn only when the count changes. */
interface WristTag {
  panel: Panel;
  shown: number;
}

function buildCoinMesh(): Mesh {
  const geo = new CylinderGeometry(COIN_R, COIN_R, COIN_THICK, 20);
  const mat = new MeshStandardMaterial({
    color: 0xffc23a,
    metalness: 1,
    roughness: 0.3,
    emissive: 0x4a3200,
    emissiveIntensity: 0.4,
  });
  return new Mesh(geo, mat);
}

function makeTag(): WristTag {
  const panel = new Panel(TAG_W, TAG_H, 1024);
  return { panel, shown: -1 };
}

/** Paint a wrist tag: count on top, the bolt-dollar symbol beneath it. */
function drawTag(tag: WristTag, count: number): void {
  tag.shown = count;
  tag.panel.drawBare((ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `800 ${Math.round(h * 0.3)}px system-ui, sans-serif`;
    ctx.fillStyle = '#ffd54a';
    ctx.shadowColor = 'rgba(0,0,0,0.85)';
    ctx.shadowBlur = 7;
    ctx.fillText(String(count), w / 2, h * 0.22);
    ctx.shadowBlur = 0;
    const img = coinImage();
    const s = h * 0.52;
    if (img) {
      ctx.drawImage(img, (w - s) / 2, h * 0.4, s, s);
    } else {
      ctx.font = `900 ${Math.round(h * 0.5)}px Georgia, serif`;
      ctx.fillStyle = '#ffd54a';
      ctx.fillText('$', w / 2, h * 0.66);
    }
  });
}

const _a = new Vector3();
const _b = new Vector3();
const _cam = new Vector3();
const _off = new Vector3();
const _qh = new Quaternion();

export class CoinSystem extends createSystem({}) {
  private held: { left: HeldCoin | null; right: HeldCoin | null } = { left: null, right: null };
  private prevTrig: { left: boolean; right: boolean } = { left: false, right: false };
  private prevHand: { left: Vector3; right: Vector3 } = { left: new Vector3(), right: new Vector3() };
  private floor = new Map<string, FloorCoin>();
  private localTag: WristTag | null = null;
  private counter = 0;
  private moveTimer = 0;
  private time = 0;
  private artReady = false;

  init(): void {
    // Your wallet is your own business — the only coin traffic we listen to is
    // the physical coins others drop and pick up. Nobody broadcasts a balance,
    // so nobody can see anyone else's stash.
    this.cleanupFuncs.push(bus.on('gameEvent', ({ from, ev }) => this.onEvent(from, ev)));
  }

  update(delta: number): void {
    this.time += delta;
    // Coin art may finish decoding after the first tags are drawn — force a
    // one-time repaint the frame it lands so the symbol appears.
    if (!this.artReady && coinImage()) {
      this.artReady = true;
      if (this.localTag) this.localTag.shown = -1;
    }

    this.camera.getWorldPosition(_cam);
    this.updateLocalTags();
    this.handleHands(delta);
    this.updateCoinHover();
    this.simulateMyCoins(delta);
  }

  // --- coin-operated machines (snake cabinet + jukebox) ---------------------

  /** Insert-slot anchors, resolved once from the built scene. */
  private slotCache: { id: string; pos: Vector3 }[] | null = null;
  private slots(): { id: string; pos: Vector3 }[] {
    if (this.slotCache) return this.slotCache;
    const refs = pub.refs;
    if (!refs) return [];
    const juke = new Vector3();
    refs.jukebox.getWorldPosition(juke);
    juke.y += 1.0;
    this.slotCache = [
      { id: 'snake', pos: new Vector3(refs.arcadePos[0], 1.0, refs.arcadePos[2]) },
      { id: 'jukebox', pos: juke },
    ];
    return this.slotCache;
  }

  /** The machine slot within reach of `at`, or null. */
  private nearestSlot(at: Vector3): string | null {
    let best: string | null = null;
    let bestD = INSERT_R;
    for (const s of this.slots()) {
      const d = s.pos.distanceTo(at);
      if (d <= bestD) {
        best = s.id;
        bestD = d;
      }
    }
    return best;
  }

  /** Light a machine's INSERT COIN cue while a held coin hovers at its slot. */
  private updateCoinHover(): void {
    let hover: string | null = null;
    const grips = this.player.gripSpaces;
    for (const hand of ['left', 'right'] as const) {
      if (!this.held[hand] || !grips?.[hand]) continue;
      grips[hand]!.getWorldPosition(_a);
      const s = this.nearestSlot(_a);
      if (s) {
        hover = s;
        break;
      }
    }
    pub.coinHover = hover;
  }

  private disposeCoinMesh(mesh: Mesh): void {
    this.scene.remove(mesh);
    (mesh.material as MeshStandardMaterial).dispose();
    mesh.geometry.dispose();
  }

  // --- wrist readouts -------------------------------------------------------

  private updateLocalTags(): void {
    const grips = this.player.gripSpaces;
    if (!grips?.left) return;
    if (!this.localTag) {
      this.localTag = makeTag();
      this.scene.add(this.localTag.panel.mesh);
    }
    const tag = this.localTag;
    grips.left.getWorldPosition(_a); // the wallet rides on the LEFT wrist
    tag.panel.mesh.position.copy(_a);
    tag.panel.mesh.position.y += 0.05;
    tag.panel.mesh.lookAt(_cam);
    if (tag.shown !== wallet.balance) drawTag(tag, wallet.balance);
  }

  // --- the hands: pull, hold, drop, pick up, bank ---------------------------

  private handleHands(delta: number): void {
    const grips = this.player.gripSpaces;
    if (!grips?.left || !grips.right) return;

    // The wallet lives on the LEFT wrist, so only the RIGHT hand reaches it to
    // pull a coin out or bank one back. (Either hand can still pick coins off
    // the floor — that's not a wrist gesture.)
    grips.left.getWorldPosition(_b); // the left wrist (the wallet)

    (['left', 'right'] as const).forEach((hand) => {
      const gp = this.input.xr.gamepads[hand];
      const grip = grips[hand]!;
      if (!gp) return;

      grip.getWorldPosition(_a); // this hand
      const atWrist = hand === 'right' && _a.distanceTo(_b) <= WRIST_TOUCH;

      const pressed = gp.getButtonPressed(InputComponent.Trigger);
      const justDown = gp.getButtonDown(InputComponent.Trigger);
      const justUp = this.prevTrig[hand] && !pressed;
      this.prevTrig[hand] = pressed;

      const held = this.held[hand];

      if (justDown && !held) {
        // Floor coin within reach takes priority over pulling a fresh one.
        const picked = this.pickFloorCoin(_a);
        if (picked) {
          pubSendEvent({ e: 'COIN_TAKE', id: picked.id });
          this.held[hand] = { mesh: picked.mesh, id: picked.id };
        } else if (atWrist && wallet.balance > 0) {
          if (spendCoins(1)) {
            const mesh = buildCoinMesh();
            mesh.position.copy(_a);
            this.scene.add(mesh);
            this.held[hand] = { mesh, id: this.newId() };
          }
        }
      } else if (justUp && held) {
        const slot = this.nearestSlot(_a);
        if (atWrist) {
          // Bank it.
          addCoins(1);
          this.disposeCoinMesh(held.mesh);
          this.held[hand] = null;
        } else if (slot) {
          // Feed it into the machine — the coin is spent (not banked, not
          // dropped); the machine pays out a go.
          this.disposeCoinMesh(held.mesh);
          this.held[hand] = null;
          bus.emit('coinInserted', slot);
        } else {
          // Drop it — hand velocity becomes its launch speed.
          const vel = _a.clone().sub(this.prevHand[hand]).divideScalar(Math.max(delta, 1e-3));
          if (vel.length() > 6) vel.setLength(6); // keep tosses sane
          this.floor.set(held.id, { mesh: held.mesh, id: held.id, owner: 'me', vel, resting: false });
          this.held[hand] = null;
          pubSendEvent({
            e: 'COIN_DROP',
            id: held.id,
            pos: [_a.x, _a.y, _a.z],
            vel: [vel.x, vel.y, vel.z],
          });
        }
      }

      // A held coin sits UP at the fingertips (not buried in the palm): offset
      // forward toward the fingers and up, in the hand's own frame, and stood
      // on edge so it reads as pinched between the fingers.
      if (this.held[hand]) {
        const m = this.held[hand]!.mesh;
        grip.getWorldQuaternion(_qh);
        _off.set(0, 0.03, -0.07).applyQuaternion(_qh); // up + toward the fingertips
        m.position.copy(_a).add(_off);
        m.quaternion.copy(_qh);
        m.rotateX(Math.PI / 2); // stand the disc up to face out of the hand
        m.rotateZ(this.time * 2.2); // lazy spin for life
      }
      this.prevHand[hand].copy(_a);
    });
  }

  /** The nearest loose coin within reach of `at`, or null. */
  private pickFloorCoin(at: Vector3): FloorCoin | null {
    let best: FloorCoin | null = null;
    let bestD = COIN_GRAB;
    for (const coin of this.floor.values()) {
      const d = coin.mesh.position.distanceTo(at);
      if (d <= bestD) {
        best = coin;
        bestD = d;
      }
    }
    if (best) this.floor.delete(best.id);
    return best;
  }

  // --- physics for the coins I own ------------------------------------------

  private simulateMyCoins(delta: number): void {
    this.moveTimer -= delta;
    const stream = this.moveTimer <= 0;
    if (stream) this.moveTimer = MOVE_INTERVAL;
    for (const coin of this.floor.values()) {
      if (coin.owner !== 'me' || coin.resting) continue;
      const p = coin.mesh.position;
      const prevY = p.y;
      coin.vel.y -= GRAVITY * delta;
      p.addScaledVector(coin.vel, delta);
      coin.mesh.rotation.x += delta * 4;
      // Land on the highest table / chair / bar top beneath it, else the floor.
      const restY = coinRestY(p.x, p.z, prevY);
      if (coin.vel.y <= 0 && p.y <= restY) {
        p.y = restY;
        coin.vel.set(0, 0, 0);
        coin.resting = true;
        pubSendEvent({ e: 'COIN_REST', id: coin.id, pos: [p.x, p.y, p.z] });
      } else if (stream) {
        pubSendEvent({ e: 'COIN_MOVE', id: coin.id, pos: [p.x, p.y, p.z] });
      }
    }
  }

  // --- inbound events -------------------------------------------------------

  private onEvent(from: string, ev: PubEvent): void {
    if (from === pub.myId) return;
    switch (ev.e) {
      case 'COIN_DROP':
        this.remotePlace(ev.id, ev.pos);
        break;
      case 'COIN_MOVE':
      case 'COIN_REST': {
        const coin = this.floor.get(ev.id);
        if (coin) {
          coin.mesh.position.set(ev.pos[0], ev.pos[1], ev.pos[2]);
          if (ev.e === 'COIN_REST') coin.resting = true;
        } else {
          this.remotePlace(ev.id, ev.pos);
        }
        break;
      }
      case 'COIN_TAKE':
        this.removeFloorCoin(ev.id);
        break;
    }
  }

  /** Create or move a coin someone else owns (we render, never simulate it). */
  private remotePlace(id: string, pos: Vec3T): void {
    let coin = this.floor.get(id);
    if (!coin) {
      const mesh = buildCoinMesh();
      this.scene.add(mesh);
      coin = { mesh, id, owner: 'remote', vel: new Vector3(), resting: false };
      this.floor.set(id, coin);
    }
    coin.mesh.position.set(pos[0], pos[1], pos[2]);
  }

  private removeFloorCoin(id: string): void {
    const coin = this.floor.get(id);
    if (!coin) return;
    this.scene.remove(coin.mesh);
    (coin.mesh.material as MeshStandardMaterial).dispose();
    coin.mesh.geometry.dispose();
    this.floor.delete(id);
  }

  private newId(): string {
    return `${pub.myId || 'me'}:${++this.counter}`;
  }
}
