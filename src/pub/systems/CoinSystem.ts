/**
 * Coins in the pub — the bolt-dollar currency made physical.
 *
 * Every punter wears their balance above each wrist (the riveted "$" symbol
 * with the count over it). Touch one wrist with your OTHER hand and pull the
 * trigger to draw a coin out into that hand; let go to drop it and it falls to
 * the floor, where anyone can pick it up (trigger near it). Bring a held coin
 * up to your other wrist and release to bank it — it vanishes into your wallet.
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
import { CylinderGeometry, Mesh, MeshStandardMaterial, Vector3 } from 'three';
import { Panel } from '../panel.js';
import { coinImage } from '../../menu/coinIcon.js';
import { addCoins, coins as wallet, spendCoins } from '../../menu/wallet.js';
import { pubSendEvent } from '../net.js';
import { bus, pub } from '../state.js';
import type { PubEvent, Vec3T } from '../protocol.js';

const WRIST_TOUCH = 0.13; // how close a hand must come to a wrist to pull/bank
const COIN_GRAB = 0.11; // reach for picking a coin off the floor
const COIN_R = 0.032;
const COIN_THICK = 0.01;
const GRAVITY = 9.8;
const FLOOR_Y = COIN_THICK; // a coin rests just proud of the floor
const MOVE_INTERVAL = 1 / 15; // stream a falling coin's position at 15 Hz
const BAL_INTERVAL = 2; // re-announce my balance every couple of seconds
const TAG_W = 0.1;
const TAG_H = 0.13;

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

export class CoinSystem extends createSystem({}) {
  private held: { left: HeldCoin | null; right: HeldCoin | null } = { left: null, right: null };
  private prevTrig: { left: boolean; right: boolean } = { left: false, right: false };
  private prevHand: { left: Vector3; right: Vector3 } = { left: new Vector3(), right: new Vector3() };
  private floor = new Map<string, FloorCoin>();
  private localTags: [WristTag, WristTag] | null = null;
  private punterTags = new Map<string, [WristTag, WristTag]>();
  private punterBal = new Map<string, number>();
  private counter = 0;
  private moveTimer = 0;
  private balTimer = 0;
  private lastBal = -1;
  private artReady = false;

  init(): void {
    this.cleanupFuncs.push(
      bus.on('gameEvent', ({ from, ev }) => this.onEvent(from, ev)),
      // Re-announce my balance to anyone who just walked in.
      bus.on('joined', () => this.broadcastBalance(true)),
      bus.on('left', (id) => this.dropPunterTags(id)),
    );
  }

  update(delta: number): void {
    // Coin art may finish decoding after the first tags are drawn — force a
    // one-time repaint the frame it lands so the symbol appears.
    if (!this.artReady && coinImage()) {
      this.artReady = true;
      if (this.localTags) for (const t of this.localTags) t.shown = -1;
      for (const tags of this.punterTags.values()) for (const t of tags) t.shown = -1;
    }

    this.camera.getWorldPosition(_cam);
    this.updateLocalTags();
    this.updatePunterTags();
    this.handleHands(delta);
    this.simulateMyCoins(delta);

    // Keep the room (and late joiners) in sync with my wallet.
    this.balTimer -= delta;
    if (this.balTimer <= 0 || wallet.balance !== this.lastBal) this.broadcastBalance(false);
  }

  // --- wrist readouts -------------------------------------------------------

  private updateLocalTags(): void {
    const grips = this.player.gripSpaces;
    if (!grips?.left || !grips.right) return;
    if (!this.localTags) {
      this.localTags = [makeTag(), makeTag()];
      for (const t of this.localTags) this.scene.add(t.panel.mesh);
    }
    const sides = [grips.left, grips.right] as const;
    for (let i = 0; i < 2; i++) {
      const tag = this.localTags[i];
      sides[i].getWorldPosition(_a);
      tag.panel.mesh.position.copy(_a);
      tag.panel.mesh.position.y += 0.05;
      tag.panel.mesh.lookAt(_cam);
      if (tag.shown !== wallet.balance) drawTag(tag, wallet.balance);
    }
  }

  private updatePunterTags(): void {
    // Drop tags for anyone who's left.
    for (const id of [...this.punterTags.keys()]) {
      if (!pub.punters.has(id)) this.dropPunterTags(id);
    }
    for (const punter of pub.punters.values()) {
      let tags = this.punterTags.get(punter.id);
      if (!tags) {
        tags = [makeTag(), makeTag()];
        for (const t of tags) this.scene.add(t.panel.mesh);
        this.punterTags.set(punter.id, tags);
      }
      const bal = this.punterBal.get(punter.id) ?? 0;
      for (let i = 0; i < 2; i++) {
        const glove = punter.rig.gloves[i];
        tags[i].panel.mesh.position.copy(glove.position);
        tags[i].panel.mesh.position.y += 0.05;
        tags[i].panel.mesh.lookAt(_cam);
        if (tags[i].shown !== bal) drawTag(tags[i], bal);
      }
    }
  }

  private dropPunterTags(id: string): void {
    const tags = this.punterTags.get(id);
    if (!tags) return;
    for (const t of tags) {
      this.scene.remove(t.panel.mesh);
      t.panel.dispose();
    }
    this.punterTags.delete(id);
  }

  // --- the hands: pull, hold, drop, pick up, bank ---------------------------

  private handleHands(delta: number): void {
    const grips = this.player.gripSpaces;
    if (!grips?.left || !grips.right) return;

    (['left', 'right'] as const).forEach((hand) => {
      const other = hand === 'left' ? 'right' : 'left';
      const gp = this.input.xr.gamepads[hand];
      const grip = grips[hand]!;
      const otherGrip = grips[other]!;
      if (!gp) return;

      grip.getWorldPosition(_a); // this hand
      otherGrip.getWorldPosition(_b); // the other wrist
      const atWrist = _a.distanceTo(_b) <= WRIST_TOUCH;

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
            this.broadcastBalance(true);
          }
        }
      } else if (justUp && held) {
        if (atWrist) {
          // Bank it.
          addCoins(1);
          this.scene.remove(held.mesh);
          (held.mesh.material as MeshStandardMaterial).dispose();
          held.mesh.geometry.dispose();
          this.held[hand] = null;
          this.broadcastBalance(true);
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

      // A held coin rides in the hand.
      if (this.held[hand]) {
        this.held[hand]!.mesh.position.copy(_a);
        this.held[hand]!.mesh.rotation.y += delta * 3;
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
      coin.vel.y -= GRAVITY * delta;
      coin.mesh.position.addScaledVector(coin.vel, delta);
      coin.mesh.rotation.x += delta * 4;
      const p = coin.mesh.position;
      if (p.y <= FLOOR_Y) {
        p.y = FLOOR_Y;
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
      case 'COIN_BAL':
        this.punterBal.set(from, ev.n ?? 0);
        break;
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

  private broadcastBalance(force: boolean): void {
    this.balTimer = BAL_INTERVAL;
    if (!force && wallet.balance === this.lastBal) return;
    this.lastBal = wallet.balance;
    pubSendEvent({ e: 'COIN_BAL', n: wallet.balance });
  }

  private newId(): string {
    return `${pub.myId || 'me'}:${++this.counter}`;
  }
}
