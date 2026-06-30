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
import { BOOTH_CENTRES, FIGHT, PUB, SURFACES, type Surface } from '../config.js';
import type { PubEvent, Vec3T } from '../protocol.js';
import { clearRestCircle, resolveOverlap, restCirclesByPrefix, setRestCircle, type RestCircle } from '../restCircles.js';

const WRIST_TOUCH = 0.13; // how close a hand must come to a wrist to grab/bank
const COIN_GRAB = 0.2; // direct touch-grab reach for a coin
const INSERT_R = 0.7; // hold a coin roughly this close to a machine to feed it
// Range grab — aim at a settled coin and squeeze to pull it in from afar, the
// same forgiving cone the pints and darts use (PropSystem).
const RANGE_GRAB_MAX = 1.0;
const RANGE_GRAB_CONE_COS = Math.cos((30 * Math.PI) / 180);
const COIN_R = 0.032;
const COIN_THICK = 0.01;
const GRAVITY = 9.8;
const MOVE_INTERVAL = 1 / 15; // stream a falling coin's position at 15 Hz
const TAG_W = 0.1;
const TAG_H = 0.13;

/**
 * Where a dropped coin may come to rest: the floor, plus the same bar/booth
 * tops glasses use, the four bar stools AND the booth seats — so you can set a
 * coin down on any table, chair or the bar instead of only the floor. Read-only
 * reuse of the glass SURFACES (never mutated, so glass behaviour is untouched).
 */
const STOOL_R = 0.17;
const PD = PUB.halfDepth;
// The continuous banquette bench runs the full booth span (environment.ts
// buildBanquette): x0/x1 = first/last centre ± 1.0.
const BOOTH_X0 = BOOTH_CENTRES[0] - 1.0;
const BOOTH_X1 = BOOTH_CENTRES[BOOTH_CENTRES.length - 1] + 1.0;
const COIN_SURFACES: Surface[] = [
  ...SURFACES,
  ...[-1.6, -0.8, 0.8, 1.6].map((x) => ({
    y: 0.69, // bar-stool seat top (environment.ts: puck at y≈0.65)
    minX: x - STOOL_R,
    maxX: x + STOOL_R,
    minZ: PUB.bar.z + 0.45 - STOOL_R,
    maxZ: PUB.bar.z + 0.45 + STOOL_R,
  })),
  // The continuous banquette bench cushion against the south wall (top ≈ 0.54).
  { y: 0.54, minX: BOOTH_X0, maxX: BOOTH_X1, minZ: PD - 0.8, maxZ: PD - 0.3 },
  // The freestanding bench across each booth table (pad top ≈ 0.395).
  ...BOOTH_CENTRES.map((cx) => ({
    y: 0.395,
    minX: cx - 0.43,
    maxX: cx + 0.43,
    minZ: PD - 2.13,
    maxZ: PD - 1.77,
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

/** Glow a coin warm (or back to its rest sheen) — its "you can grab me" cue,
 *  matching how the pints and darts light up. */
function setCoinGlow(mesh: Mesh, on: boolean): void {
  const m = mesh.material as MeshStandardMaterial & { userData: { glowBase?: number } };
  if (on) {
    if (m.userData.glowBase === undefined) m.userData.glowBase = m.emissiveIntensity;
    m.emissive.setHex(0xfff2dc);
    m.emissiveIntensity = 1.15;
  } else if (m.userData.glowBase !== undefined) {
    m.emissive.setHex(0x4a3200);
    m.emissiveIntensity = m.userData.glowBase;
    m.userData.glowBase = undefined;
  }
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
const _rayO = new Vector3();
const _rayDir = new Vector3();
const _toCoin = new Vector3();
const _qh = new Quaternion();
const _qr = new Quaternion();

export class CoinSystem extends createSystem({}) {
  private held: { left: HeldCoin | null; right: HeldCoin | null } = { left: null, right: null };
  private prevSq: { left: boolean; right: boolean } = { left: false, right: false };
  private prevHand: { left: Vector3; right: Vector3 } = { left: new Vector3(), right: new Vector3() };
  private floor = new Map<string, FloorCoin>();
  private localTag: WristTag | null = null;
  /** Eased wrist count for the roll-up (−1 = not yet initialised). */
  private tagDisplay = -1;
  private counter = 0;
  private moveTimer = 0;
  private time = 0;
  private artReady = false;
  /** The floor coin currently glowing as a grab target (or null). */
  private litCoin: FloorCoin | null = null;

  init(): void {
    // Your wallet is your own business — the only coin traffic we listen to is
    // the physical coins others drop and pick up. Nobody broadcasts a balance,
    // so nobody can see anyone else's stash.
    this.cleanupFuncs.push(
      bus.on('gameEvent', ({ from, ev }) => this.onEvent(from, ev)),
      // A player who disconnects mid-throw (after COIN_DROP, before COIN_REST)
      // leaves no further coin events for us to clean up after — sweep any of
      // their still-loose coins now so a dropped connection never leaves a
      // permanent phantom coin on the floor.
      bus.on('left', (id) => {
        const theirs = [...this.floor.keys()].filter((coinId) => coinId.startsWith(`${id}:`));
        for (const coinId of theirs) this.removeFloorCoin(coinId);
      }),
    );
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
    this.updateLocalTags(delta);
    this.handleHands(delta);
    this.updateCoinHover();
    this.updateGrabHighlight();
    this.simulateMyCoins(delta);
  }

  /** Glow whichever floor coin an empty hand could grab right now (touch or
   *  aim), so coins light up when grabbable just like the pints and darts. */
  private updateGrabHighlight(): void {
    let target: FloorCoin | null = null;
    for (const hand of ['left', 'right'] as const) {
      if (this.held[hand]) continue; // a full hand isn't shopping for a coin
      target = this.grabCandidate(hand);
      if (target) break;
    }
    if (target === this.litCoin) return;
    if (this.litCoin && this.floor.has(this.litCoin.id)) setCoinGlow(this.litCoin.mesh, false);
    this.litCoin = target;
    if (target) setCoinGlow(target.mesh, true);
  }

  // --- coin-operated slots (snake cabinet + jukebox + the fight tablets) -----

  /** Every insert-slot anchor, resolved once from the built scene. The two
   *  fight-hall betting tablets are included but only OFFERED while bets are
   *  open (see slots()). */
  private slotCache: { id: string; pos: Vector3 }[] | null = null;
  private allSlots(): { id: string; pos: Vector3 }[] {
    if (this.slotCache) return this.slotCache;
    const refs = pub.refs;
    if (!refs) return [];
    const juke = new Vector3();
    refs.jukebox.getWorldPosition(juke);
    juke.y += 1.0;
    this.slotCache = [
      { id: 'snake', pos: new Vector3(refs.arcadePos[0], 1.0, refs.arcadePos[2]) },
      { id: 'jukebox', pos: juke },
      { id: 'bet0', pos: new Vector3(FIGHT.consoles[0][0], 1.34, FIGHT.consoles[0][2]) },
      { id: 'bet1', pos: new Vector3(FIGHT.consoles[1][0], 1.34, FIGHT.consoles[1][2]) },
    ];
    return this.slotCache;
  }

  /** True while the fight-hall tablets are taking bets (first round only). */
  private betsOpen(): boolean {
    const f = pub.fight;
    return f.round === 1 && (f.phase === 'starting' || f.phase === 'fighting');
  }

  /** The slots a held coin can currently be fed into — the machines always, the
   *  two betting tablets only when their corner is filled and bets are open. */
  private slots(): { id: string; pos: Vector3 }[] {
    const open = this.betsOpen();
    const f = pub.fight;
    return this.allSlots().filter((s) => {
      if (s.id === 'bet0') return open && !!f.sides[0];
      if (s.id === 'bet1') return open && !!f.sides[1];
      return true;
    });
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

  private updateLocalTags(delta: number): void {
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
    // Roll the displayed count toward the real balance so a credit (a banked
    // coin, a winning bet payout) ticks up satisfyingly instead of snapping.
    const target = wallet.balance;
    if (this.tagDisplay < 0) {
      this.tagDisplay = target; // first paint — no animation from zero
    } else if (this.tagDisplay !== target) {
      this.tagDisplay += (target - this.tagDisplay) * (1 - Math.exp(-9 * delta));
      if (Math.abs(target - this.tagDisplay) < 0.5) this.tagDisplay = target;
    }
    const show = Math.round(this.tagDisplay);
    if (tag.shown !== show) drawTag(tag, show);
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

      // Coins grab on EITHER the squeeze (like pints/darts) or the trigger —
      // one combined "hold", same as the arena's fireball controls.
      const pressed =
        gp.getButtonPressed(InputComponent.Squeeze) || gp.getButtonPressed(InputComponent.Trigger);
      const justDown =
        gp.getButtonDown(InputComponent.Squeeze) || gp.getButtonDown(InputComponent.Trigger);
      const justUp = this.prevSq[hand] && !pressed;
      this.prevSq[hand] = pressed;

      const held = this.held[hand];

      if (justDown && !held) {
        if (atWrist && wallet.balance > 0) {
          // Grab a fresh coin off your wrist.
          if (spendCoins(1)) {
            const mesh = buildCoinMesh();
            mesh.position.copy(_a);
            this.scene.add(mesh);
            this.held[hand] = { mesh, id: this.newId() };
          }
        } else {
          // Everywhere else: touch-grab a coin underhand, or RANGE-grab one you
          // aim at from up to a metre away — pints-and-darts style.
          const picked = this.grabCandidate(hand);
          if (picked) {
            this.floor.delete(picked.id);
            clearRestCircle(`coin:${picked.id}`);
            if (this.litCoin === picked) this.litCoin = null;
            setCoinGlow(picked.mesh, false);
            pubSendEvent({ e: 'COIN_TAKE', id: picked.id });
            this.held[hand] = { mesh: picked.mesh, id: picked.id };
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

  /** The nearest loose coin within touch reach of `at` (not removed). */
  private findTouchCoin(at: Vector3): FloorCoin | null {
    let best: FloorCoin | null = null;
    let bestD = COIN_GRAB;
    for (const coin of this.floor.values()) {
      const d = coin.mesh.position.distanceTo(at);
      if (d <= bestD) {
        best = coin;
        bestD = d;
      }
    }
    return best;
  }

  /** The settled coin this hand is aiming at within a forgiving cone (≤1 m),
   *  picked nearest the aim — mirrors PropSystem's range grab (not removed). */
  private findRangeCoin(hand: 'left' | 'right'): FloorCoin | null {
    const ray = this.player.raySpaces?.[hand];
    if (!ray) return null;
    ray.getWorldPosition(_rayO);
    ray.getWorldQuaternion(_qr);
    _rayDir.set(0, 0, -1).applyQuaternion(_qr).normalize();

    let best: FloorCoin | null = null;
    let bestScore = -Infinity;
    for (const coin of this.floor.values()) {
      if (!coin.resting) continue; // only settled coins are aim-grabbable
      _toCoin.copy(coin.mesh.position).sub(_rayO);
      const dist = _toCoin.length();
      if (dist < 1e-3 || dist > RANGE_GRAB_MAX) continue;
      const aim = _toCoin.divideScalar(dist).dot(_rayDir);
      if (aim < RANGE_GRAB_CONE_COS) continue; // outside the aim cone
      const score = aim - dist * 0.1; // most on-axis wins, nearer breaks ties
      if (score > bestScore) {
        bestScore = score;
        best = coin;
      }
    }
    return best;
  }

  /** The coin `hand` could grab right now — touch first, else range — or null. */
  private grabCandidate(hand: 'left' | 'right'): FloorCoin | null {
    const grip = this.player.gripSpaces?.[hand];
    if (grip) {
      grip.getWorldPosition(_a);
      const touch = this.findTouchCoin(_a);
      if (touch) return touch;
    }
    return this.findRangeCoin(hand);
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
        coin.mesh.rotation.set(0, Math.random() * Math.PI * 2, 0); // lie flat on the surface
        // Bet eligibility (pit bounds + which corner's half) is decided on the
        // coin's ACTUAL landing spot — check it before any overlap nudge could
        // shift it across the pit boundary or the corner midline.
        if (this.tryArenaBet(coin, p)) continue; // landed in the pit → spent as a bet
        this.resolveCoinRest(coin, p); // nudge clear of any coin/glass already there
        setRestCircle(`coin:${coin.id}`, p.x, p.y, p.z, COIN_R);
        pubSendEvent({ e: 'COIN_REST', id: coin.id, pos: [p.x, p.y, p.z] });
      } else if (stream) {
        pubSendEvent({ e: 'COIN_MOVE', id: coin.id, pos: [p.x, p.y, p.z] });
      }
    }
  }

  /**
   * A coin of mine just settled — if it came down INSIDE the fight pit (the
   * cage rect) while bets are open, it's a wager on whichever fighter's half it
   * landed on: the +z half backs side 0 (south corner), the −z half side 1
   * (north). The stake is staked + a landing chime rings (FightSystem), and the
   * coin is spent — pulled from the room everywhere. Returns true if consumed.
   *
   * A coin resting on an empty corner's half, or while bets are shut, just lies
   * there like any dropped coin (pick it back up). Fighters can't bet on their
   * own bout, so their coins lie there too.
   */
  private tryArenaBet(coin: FloorCoin, p: Vector3): boolean {
    const c = FIGHT.cage;
    if (p.x < c.minX || p.x > c.maxX || p.z < c.minZ || p.z > c.maxZ) return false;
    if (!this.betsOpen()) return false;
    const f = pub.fight;
    if (f.sides[0] === pub.myId || f.sides[1] === pub.myId) return false; // a fighter can't bet
    const side: 0 | 1 = p.z >= 0 ? 0 : 1; // pit midline (z=0) splits the two corners' halves
    if (!f.sides[side]) return false; // that corner's empty — nobody to back
    bus.emit('betThrow', side); // stake it + ring the confirmation chime
    pubSendEvent({ e: 'COIN_TAKE', id: coin.id }); // the coin is spent — clear it for everyone
    if (this.litCoin?.id === coin.id) this.litCoin = null;
    this.disposeCoinMesh(coin.mesh);
    this.floor.delete(coin.id);
    clearRestCircle(`coin:${coin.id}`);
    return true;
  }

  /** Nudge a just-landed coin's (x,z) clear of any other resting coin OR pint
   *  glass already sitting there, so coins never visually overlap each other
   *  or a glass — they end up lying side by side instead. Coin-vs-coin checks
   *  this.floor directly (always fresh); coin-vs-glass reads the shared
   *  registry, since PropSystem's glasses are a different module's state. */
  private resolveCoinRest(coin: FloorCoin, p: Vector3): void {
    const obstacles: RestCircle[] = [];
    for (const other of this.floor.values()) {
      if (other === coin || !other.resting) continue;
      obstacles.push({ id: other.id, x: other.mesh.position.x, y: other.mesh.position.y, z: other.mesh.position.z, r: COIN_R });
    }
    obstacles.push(...restCirclesByPrefix('glass:'));
    const resolved = resolveOverlap(p.x, p.y, p.z, COIN_R, obstacles, (x, z, fromY) => coinRestY(x, z, fromY));
    p.set(resolved.x, resolved.y, resolved.z);
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
        let coin = this.floor.get(ev.id);
        if (coin) {
          coin.mesh.position.set(ev.pos[0], ev.pos[1], ev.pos[2]);
        } else {
          // First we've ever heard of this coin (e.g. we joined mid-flight and
          // missed its COIN_DROP) — place it now so a bare COIN_REST still
          // resolves below instead of silently creating an un-rested orphan.
          this.remotePlace(ev.id, ev.pos);
          coin = this.floor.get(ev.id)!;
        }
        if (ev.e === 'COIN_REST') {
          coin.resting = true;
          coin.mesh.rotation.set(0, coin.mesh.rotation.y, 0); // settle flat
          // The owner already resolved overlap before sending this — just
          // mirror their final resting spot into the shared registry so OUR
          // glasses (PropSystem) know to avoid it too.
          setRestCircle(`coin:${coin.id}`, ev.pos[0], ev.pos[1], ev.pos[2], COIN_R);
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
    if (this.litCoin?.id === id) this.litCoin = null;
    this.scene.remove(coin.mesh);
    (coin.mesh.material as MeshStandardMaterial).dispose();
    coin.mesh.geometry.dispose();
    this.floor.delete(id);
    clearRestCircle(`coin:${id}`);
  }

  private newId(): string {
    return `${pub.myId || 'me'}:${++this.counter}`;
  }
}
