/**
 * ARCADE — the titan gauntlet. Owns a campaign bout end to end:
 *
 *  INTRO   : klaxon + strobing pit light, the titan grinds up out of the
 *            floor behind the far platform, name card + roar, FIGHT, bell.
 *            (Squeeze a trigger to skip the ceremony.)
 *  FIGHT   : the titan cycles telegraphed attacks — every kill zone charges
 *            visibly ON YOUR PLATFORM (see campaign/telegraphs.ts): fist
 *            SLAMS (a ghost hammer descends onto the disc — step out),
 *            horizontal SWEEPS (duck the travelling blade), eye BEAMS
 *            (sidestep the strip) and pod VOLLEYS (fireballs hurled straight
 *            at you — dodge them or BLOCK with a fist). Damage runs on
 *            per-boss WEAK-POINT PATTERNS
 *            (BossDef.weakPattern): whatever is vulnerable BLINKS — the
 *            visor tell, the chest core, the low emblem — and everything
 *            else is armour that clanks. Dodge, re-aim, punish, repeat.
 *  VICTORY : collapse, floating payout line (double coins/XP on a first fell).
 *  DEFEAT  : SCRAPPED. The titan stands. Consolation pay.
 *
 * The titan is NOT the pose-bus opponent — OpponentSystem stands down in
 * campaign mode and this system drives its own rig + weak-point hitboxes
 * (CollisionSystem's damageScale law does the rest). GameStateSystem also
 * stands down: a titan bout is one long round with no timer.
 */

import { createSystem, InputComponent, Vector3, type Entity } from '@iwsdk/core';
import {
  AdditiveBlending,
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PointLight,
} from 'three';
import { BOSSES, buildTitan, type AttackKind, type BossDef, type TitanRig } from '../campaign/bosses.js';
import {
  campaign,
  campaignProgress,
  fmtRunTime,
  recordRunTime,
  saveCampaignProgress,
} from '../campaign/campaignState.js';
import {
  beamTelegraph,
  circleTelegraph,
  novaTelegraph,
  sweepTelegraph,
  type Telegraph,
} from '../campaign/telegraphs.js';
import { BallState, Fireball } from '../components/Fireball.js';
import { Combatant } from '../components/Combatant.js';
import { Health } from '../components/Health.js';
import { Hitbox } from '../components/Hitbox.js';
import { PlayerBodyPart } from '../components/PlayerBodyPart.js';
import { match } from '../combat/matchState.js';
import { applyRoster, fighterAt } from '../combat/setup.js';
import { applyArenaLayout } from '../arena/arena.js';
import { app, saveStats } from '../menu/appState.js';
import { ownPlatform, platformOwned, setPlatformSkin } from '../menu/customization.js';
import { reportCampaign } from '../net/leaderboard.js';
import { announce } from '../audio/announcer.js';
import { playCash } from '../audio/cash.js';
import { BOSS_BATTLE_VOLUME, playVictory, startBattleMusic, stopBattleTrack } from '../audio/battleMusic.js';
import { emberBurst } from '../fx/fire.js';
import { spawnFireImpact } from '../fx/effects.js';
import { feedback } from '../fx/feedback.js';
import { glowSprite } from '../materials/glow.js';
import { pulseHand } from '../input/haptics.js';
import * as sfx from '../audio/sfx.js';
import { createCampaignHud, type CampaignHud } from '../ui/campaignHud.js';
import {
  ARENA_GAP,
  CAMPAIGN,
  COMBAT,
  OCTAGON_HALF_DEPTH,
  OCTAGON_HALF_WIDTH,
} from '../config.js';


type Phase = 'idle' | 'intro' | 'fight' | 'victory' | 'defeat';

type Zone =
  | { kind: 'circle'; x: number; z: number; r: number }
  | { kind: 'beam'; x: number; z: number; dx: number; dz: number; halfW: number }
  | { kind: 'sweep'; y: number }
  /** One volley shot: launches from the pod on `side` when its stagger hits. */
  | { kind: 'shot'; side: -1 | 1 }
  /** GOLIATH's nova: everything burns EXCEPT the safe wedge at `angle`. */
  | { kind: 'nova'; angle: number; halfAngle: number };

/** A weak point a pattern can light. The crown circuit uses all five. */
type WeakSpot = 'head' | 'core' | 'low' | 'shoulderL' | 'shoulderR';

/** GOLIATH's ring order — one full loop of the crown. `shoulderL` is the
 *  KING's left (the lamp on YOUR right as you face him), so the circuit
 *  reads head → his left shoulder → core → his right shoulder → low. */
const CROWN_RING: WeakSpot[] = ['head', 'shoulderL', 'core', 'shoulderR', 'low'];

interface ActiveAttack {
  kind: AttackKind;
  zones: Zone[];
  telegraphs: (Telegraph | null)[];
  /** Seconds after the charge completes at which each zone detonates. */
  staggers: number[];
  resolved: boolean[];
  time: number;
  chargeTime: number;
  arm: 0 | 1;
  /** VULTURE's law: beams re-aim at you until the late lock. */
  tracks: boolean;
  /** Per-beam lateral offsets, kept so tracking re-aims stay parallel. */
  beamOffsets: number[];
  /**
   * Slam attacks only: a ghost hammer hovering over each marked disc,
   * descending as its countdown fills — so "arm goes up" visibly connects to
   * "THIS spot gets hit". Disposed at that zone's detonation.
   */
  markers: (Group | null)[];
}

/** One volley fireball in flight — dodge it, or put a fist in its path. */
interface VolleyShot {
  pos: Vector3;
  vel: Vector3;
  age: number;
  group: Group;
  trail: number;
}

/** A short-lived strike visual driven by a closure. */
interface Strike {
  age: number;
  life: number;
  update(age: number): void;
  dispose(): void;
}

const _v = new Vector3();
const _p = new Vector3();
const _head = new Vector3();

const rand = (lo: number, hi: number): number => lo + Math.random() * (hi - lo);
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

export class CampaignSystem extends createSystem({
  playerParts: { required: [Hitbox, PlayerBodyPart] },
  combatants: { required: [Combatant, Health] },
  balls: { required: [Fireball] },
}) {
  private hud!: CampaignHud;
  private light!: PointLight;

  private phase: Phase = 'idle';
  private t = 0;
  private time = 0; // global clock for shader pulses
  private def: BossDef = BOSSES[0];
  private rig?: TitanRig;

  // Boss weak-point spheres (created once, repositioned per stage/frame).
  private boxes: {
    body?: Entity;
    pelvis?: Entity;
    head?: Entity;
    core?: Entity;
    shoulderL?: Entity;
    shoulderR?: Entity;
    pods: Entity[];
  } = { pods: [] };

  private attack: ActiveAttack | null = null;
  private cooldown = 2.5;
  private lastKind: AttackKind | null = null;
  private strikes: Strike[] = [];
  private shots: VolleyShot[] = [];
  /**
   * The weak-point pattern (BossDef.weakPattern) drives which point(s) BLINK
   * live right now: `cycleIdx` walks the boss's sequence, `hitsOnPoint`
   * counts landed hits on the current stop (VULTURE needs two per stop).
   * No text prompts — the blink IS the tell.
   */
  private cycleIdx = 0;
  private hitsOnPoint = 0;
  private invuln = 0; // player i-frames after eating a strike
  private strikeSwing: [number, number] = [0, 0]; // post-strike arm follow-through
  private flinch = 0;
  private enraged = false;
  private lastBossHp = 0;
  private hudTimer = 0;
  private emberTimer = 0;
  private cardTimer = 0; // auto-clear for transient cards (ENRAGED)
  // Gauntlet runs: fight-time-only clock, and whether this victory chains on.
  private runClock = 0;
  private advanceAfterVictory = false;
  private victoryDelay = CAMPAIGN.victoryDelay;
  // Beat counters for the staged entrances/deaths (press strokes, winch
  // jerks, the king's stalls) — they gate the one-shot sfx per beat.
  private introStep = 0;
  private outroStep = 0;

  init(): void {
    this.hud = createCampaignHud(this.scene);
    this.light = new PointLight(0xffffff, 0, 16);
    this.light.visible = false;
    this.scene.add(this.light);
  }

  update(delta: number): void {
    this.time += delta;
    const live = app.state === 'playing' && app.mode === 'campaign';

    if (!live) {
      if (this.phase !== 'idle') this.teardown();
      return;
    }
    if (this.phase === 'idle') this.begin();

    this.t += delta;
    this.updateStrikes(delta);

    switch (this.phase) {
      case 'intro':
        this.intro(delta);
        break;
      case 'fight':
        this.fight(delta);
        break;
      case 'victory':
      case 'defeat':
        this.outro(delta);
        break;
    }

    if (this.rig) this.animateTitan(delta);
    this.placeHitboxes();
    this.refreshHud(delta);
  }

  // --- lifecycle -------------------------------------------------------------

  private runMode(): boolean {
    return app.campaignMode !== 'single';
  }

  private begin(): void {
    this.runClock = 0;
    this.hud.setVisible(true);
    this.light.visible = true;
    // Stamp the classic 1v1 platforms/roster (the last bout may have been an
    // FFA cross), then stand the slot-1 humanoid down — the titan replaces it.
    app.arcade = '1v1';
    applyRoster();
    applyArenaLayout(this.scene);
    this.stageSetup(true, 'a titan approaches the pit');
  }

  /** Chain to the next titan mid-run — no lobby, straight into its intro. */
  private advanceRun(): void {
    app.campaignStage += 1;
    // GAUNTLET refits you between titans; HARDCORE sends you in as you are.
    this.stageSetup(app.campaignMode === 'gauntlet', 'the next titan approaches');
  }

  /** Everything one titan bout needs: rig, pools, weak points, intro cue. */
  private stageSetup(healPlayer: boolean, warning: string): void {
    this.def = BOSSES[clamp(app.campaignStage, 0, BOSSES.length - 1)];
    this.rig?.dispose();
    this.rig = buildTitan(this.def);
    // The rig's face (visor/core) sits on local −Z, same as the duel boxer —
    // yaw the whole machine to face the player across the gap. Each chassis
    // then stages its OWN entrance mark (the pit, the sky, the flank, the
    // dark): entrancePose(0) parks it there until the klaxon ends.
    this.rig.root.rotation.set(0, Math.PI, 0);
    this.scene.add(this.rig.root);
    this.introStep = 0;
    this.entrancePose(0);

    // Health pools: the titan borrows the slot-1 fighter's Health — while its
    // HUMANOID stands down (Combatant.active 0 parks OpponentSystem's rig and
    // hitboxes; our own titan hitboxes point at the same Health owner).
    const boss = fighterAt(1);
    boss?.setValue(Combatant, 'active', 0);
    boss?.setValue(Health, 'max', this.def.health);
    boss?.setValue(Health, 'current', this.def.health);
    if (healPlayer) {
      const me = fighterAt(0);
      me?.setValue(Health, 'current', me.getValue(Health, 'max') ?? COMBAT.playerHealth);
    }
    this.lastBossHp = this.def.health;

    this.ensureHitboxes();
    this.disposeShots();
    this.disposeAttack();
    this.cycleIdx = 0; // every pattern opens on the head
    this.hitsOnPoint = 0;
    this.invuln = 0;
    this.enraged = false;
    this.cardTimer = 0;
    this.cooldown = this.attackCooldown() + 0.8;
    this.lastKind = null;
    campaign.coreOpen = false;
    this.hud.setBoss(this.def.name, this.accentCss(), '');

    // Collisions and rim-drain stay off until the bell (phase 'roundOver').
    match.phase = 'roundOver';
    match.message = '';
    match.resetCount += 1; // park the fireballs at your fists

    this.light.color.setHex(this.def.accent);
    this.light.position.set(0, this.rig.height * 0.8 + 1, this.bossZ() + 1.2);
    this.light.intensity = 0;

    this.phase = 'intro';
    this.t = 0;
    this.hud.title('WARNING', warning, '#ffb000');
    sfx.klaxon();
  }

  /** Tear down the live attack: telegraphs AND any ghost hammer markers. */
  private disposeAttack(): void {
    const a = this.attack;
    if (!a) return;
    a.telegraphs.forEach((t) => t?.dispose());
    a.markers.forEach((m) => this.disposeMarker(m));
    this.attack = null;
  }

  private disposeMarker(m: Group | null): void {
    if (!m) return;
    m.traverse((o) => {
      const mesh = o as Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const mat = mesh.material as MeshBasicMaterial | undefined;
      mat?.dispose?.();
    });
    m.removeFromParent();
  }

  private teardown(): void {
    this.phase = 'idle';
    this.disposeAttack();
    this.disposeShots();
    for (const s of this.strikes) s.dispose();
    this.strikes = [];
    this.rig?.dispose();
    this.rig = undefined;
    this.light.visible = false;
    this.hud.setVisible(false);
    this.hud.title('', '');
    campaign.coreOpen = false;
    campaign.aimPoint.set(0, 1.25, -ARENA_GAP);
    this.parkHitboxes();
    stopBattleTrack(); // a forfeit mid-bout leaves the score running otherwise
    // Hand the slot-1 fighter back to human-sized bouts: restore its pool,
    // then re-stamp the roster (reactivates it for the current layout).
    const boss = fighterAt(1);
    boss?.setValue(Health, 'max', COMBAT.playerHealth);
    boss?.setValue(Health, 'current', COMBAT.playerHealth);
    applyRoster();
  }

  // --- intro ceremony ---------------------------------------------------------

  private intro(delta: number): void {
    // Runs get the condensed ceremony — the clock only ticks in fights, but
    // nobody speedruns for the klaxon.
    const T = this.runMode()
      ? CAMPAIGN.runIntro
      : { klaxon: CAMPAIGN.klaxonTime, rise: CAMPAIGN.riseTime, title: CAMPAIGN.titleTime, fightCard: CAMPAIGN.fightCardTime };
    const { klaxon: klaxonTime, rise: riseTime, title: titleTime, fightCard: fightCardTime } = T;
    const rig = this.rig!;

    // Strobing pit light while the klaxon sounds; steady key light after.
    const strobing = this.t < klaxonTime;
    this.light.intensity = strobing ? (Math.sin(this.time * 26) > 0 ? 9 : 1) : 5;

    // The arrival — each chassis makes its entrance its own way (see
    // entrancePose): the hook grinds up crooked, the press drops in strokes,
    // the vulture swoops the flank, the fortress rolls out of the dark, the
    // king rises on his own clock.
    const riseStart = klaxonTime;
    if (this.t >= riseStart && this.t < riseStart + riseTime + 0.2) {
      if (this.t - delta < riseStart) {
        this.introStep = 0;
        if (this.def.style === 'vulture') sfx.sweepWhoosh();
        else sfx.titanRise();
      }
      const k = clamp((this.t - riseStart) / riseTime, 0, 1);
      this.entrancePose(k);

      // Per-chassis beats: the sounds that sell the motion.
      if (this.def.style === 'piston') {
        // Every press stroke seats with a slam and a splash of sparks.
        const seg = Math.min(2, Math.floor(k * 3));
        if (seg > this.introStep) {
          this.introStep = seg;
          sfx.slamImpact();
          _v.set(0, 0.1, this.bossZ());
          emberBurst(_v, 22, true);
        }
      } else if (this.def.style === 'hook') {
        // Each jerk of the winch bites with a clank.
        const seg = Math.min(4, Math.floor(k * 5));
        if (seg > this.introStep) {
          this.introStep = seg;
          sfx.armorClank();
        }
      } else if (this.def.style === 'king') {
        // The ascent stalls twice — each hold breaks with a deeper roar.
        const seg = k < 0.45 ? 0 : k < 0.8 ? 1 : 2;
        if (seg > this.introStep) {
          this.introStep = seg;
          sfx.bossRoar(this.def.scale * 0.5);
        }
      }

      this.emberTimer -= delta;
      if (this.emberTimer <= 0 && k < 1) {
        if (this.def.style === 'vulture') {
          // Sparks stream off the banking wing on the way in.
          this.emberTimer = 0.22;
          _v.set(
            rig.root.position.x + rand(-0.4, 0.4),
            rig.root.position.y + rig.height * rand(0.5, 0.8),
            rig.root.position.z,
          );
          emberBurst(_v, 5, true);
        } else if (this.def.style === 'fortress') {
          // A grinding wake kicked up along the roll-in.
          this.emberTimer = 0.1;
          _v.set(rand(-0.9, 0.9), 0.1, rig.root.position.z + rand(-0.3, 0.6));
          emberBurst(_v, 8, true);
        } else {
          // Pit eruption under the climbers.
          this.emberTimer = 0.12;
          _v.set(rig.root.position.x + rand(-0.8, 0.8), 0.1, this.bossZ() + rand(-0.4, 0.4));
          emberBurst(_v, 8, true);
        }
      }
    }

    // Name reveal + roar once it stands.
    const titleStart = klaxonTime + riseTime;
    if (this.t >= titleStart && this.t - delta < titleStart) {
      this.entrancePose(1);
      this.hud.title(this.def.name, this.def.epithet, this.accentCss());
      sfx.bossRoar(this.def.scale * 0.8);
    }

    // FIGHT flash, then the bell — the same neon FIGHT plate the ring
    // countdown shows. Re-asserted every frame of the beat (the HUD guards on
    // content, so it's a no-op once drawn) so the art swaps in the moment its
    // PNG finishes decoding, even if that lands a frame or two late.
    const fightStart = titleStart + titleTime;
    if (this.t >= fightStart && this.t < fightStart + fightCardTime) {
      this.hud.title('FIGHT', '', '#ffc04d');
    }

    const skip = this.triggerDown();
    if (this.t >= fightStart + fightCardTime || skip) {
      this.startFight();
    }
  }

  /**
   * The entrance, per chassis — k runs 0 (staged at its mark) → 1 (standing
   * ready at the boss line). Sets the FULL root transform, so a trigger-skip
   * from any mid-entrance pose lands clean via startFight's reset.
   */
  private entrancePose(k: number): void {
    const rig = this.rig!;
    const h = rig.height;
    const z = this.bossZ();
    const root = rig.root;
    root.rotation.set(0, Math.PI, 0);
    root.scale.setScalar(1);
    switch (this.def.style) {
      case 'hook': {
        // RUSTHOOK grinds up CROOKED, in seizing winch-jerks, and only
        // straightens with a lurch at the top — salvage, not ceremony.
        const steps = 5;
        const seg = Math.floor(k * steps);
        const bite = Math.min(1, (k * steps - seg) / 0.55); // jerk early, hold
        const e = Math.min(1, (seg + bite) / steps);
        root.position.set(0, -(h + 0.4) * (1 - e), z);
        root.rotation.z = 0.3 * (1 - e * e) + Math.sin(this.time * 34) * 0.015 * (1 - k);
        break;
      }
      case 'piston': {
        // PISTON arrives from ABOVE — the press comes down in strokes, and
        // the last stroke is the slam that seats it on its mark.
        const strokes = 3;
        const seg = Math.floor(k * strokes);
        const drop = Math.min(1, (k * strokes - seg) / 0.4); // fast fall, long hold
        const e = Math.min(1, (seg + drop * drop) / strokes);
        root.position.set(0, (h * 0.8 + 2.2) * (1 - e), z);
        break;
      }
      case 'vulture': {
        // VULTURE swoops in high off the flank, banking through the dive
        // and flaring level at the mark.
        const e = k * k * (3 - 2 * k); // smoothstep
        root.position.set(3.4 * (1 - e), 2.6 * (1 - e) * (1 - e), z - 1.6 * (1 - e));
        root.rotation.z = -0.5 * Math.sin(e * Math.PI);
        break;
      }
      case 'fortress': {
        // JUGGERNAUT was never below the floor — it rolls up out of the
        // dark at ground level, rattling on its own tracks.
        const e = k * k * (3 - 2 * k);
        root.position.set(
          0,
          Math.abs(Math.sin(this.time * 22)) * 0.03 * (1 - k),
          z - 3.8 * (1 - e),
        );
        break;
      }
      default: {
        // GOLIATH rises the old way but on HIS clock — the ascent stalls
        // twice, holds, and resumes. A king does not hurry.
        let e: number;
        if (k < 0.3) e = (k / 0.3) * 0.42;
        else if (k < 0.45) e = 0.42;
        else if (k < 0.7) e = 0.42 + ((k - 0.45) / 0.25) * 0.36;
        else if (k < 0.8) e = 0.78;
        else e = 0.78 + ((k - 0.8) / 0.2) * 0.22;
        root.position.set(0, -(h + 0.4) * (1 - e), z);
        break;
      }
    }
  }

  private triggerDown(): boolean {
    for (const hand of ['left', 'right'] as const) {
      if (this.input.xr.gamepads[hand]?.getButtonDown(InputComponent.Trigger)) return true;
    }
    return false;
  }

  private startFight(): void {
    this.phase = 'fight';
    this.t = 0;
    // Snap to the rest pose — a trigger-skip can land mid-swoop/mid-stroke.
    const root = this.rig!.root;
    root.position.set(0, 0, this.bossZ());
    root.rotation.set(0, Math.PI, 0);
    root.scale.setScalar(1);
    match.phase = 'playing';
    this.hud.title('', '');
    this.light.intensity = 5; // steady key light (a skip can leave a strobe)
    startBattleMusic(BOSS_BATTLE_VOLUME); // a score loud enough to carry over the titan's SFX
    announce('fight');
    sfx.roundBell();
  }

  /** Which points blink live right now, per the boss's weak pattern. */
  private litPoints(): WeakSpot[] {
    switch (this.def.weakPattern) {
      case 'both':
        return ['head', 'core']; // any order, all fight
      case 'triple':
        return [(['head', 'core', 'low'] as const)[this.cycleIdx % 3]];
      case 'crown':
        return [CROWN_RING[this.cycleIdx % CROWN_RING.length]];
      default: // 'alternate' and 'double' walk head↔core
        return [this.cycleIdx % 2 === 0 ? 'head' : 'core'];
    }
  }

  /** GOLIATH's kill condition: total ring hits to fell the crown. */
  private crownTarget(): number {
    return CROWN_RING.length * CAMPAIGN.crownLoops;
  }

  // --- the fight --------------------------------------------------------------

  private fight(delta: number): void {
    this.invuln = Math.max(0, this.invuln - delta);
    if (this.runMode()) this.runClock += delta; // fights only — intros are free

    // Transient title (ENRAGED) auto-clears.
    if (this.cardTimer > 0) {
      this.cardTimer -= delta;
      if (this.cardTimer <= 0) this.hud.title('', '');
    }

    this.updateShots(delta);

    // Watch the health pools.
    const boss = fighterAt(1);
    let bossHp = boss?.getValue(Health, 'current') ?? 0;
    const bossMax = boss?.getValue(Health, 'max') ?? 1;
    const meHp = fighterAt(0)?.getValue(Health, 'current') ?? 0;
    if (bossHp < this.lastBossHp) {
      this.flinch = 0.35;
      this.hudTimer = 0; // instant bar update on damage
      // Walk the weak-point pattern: RUSTHOOK's stays put (both open),
      // VULTURE needs two hits per stop, the others advance every hit. The
      // servo cue + the blink say where — no words.
      if (this.def.weakPattern === 'crown') {
        // GOLIATH: the ring hit is the unit of damage. The bar steps down
        // one notch per stop, so the kill is EXACTLY three full loops no
        // matter what the ball would have dealt.
        this.cycleIdx += 1;
        bossHp = bossMax * Math.max(0, 1 - this.cycleIdx / this.crownTarget());
        boss?.setValue(Health, 'current', bossHp);
        if (bossHp > 0) {
          sfx.coreExposed();
          if (this.cycleIdx % CROWN_RING.length === 0) {
            // A full loop closed: the king roars and quickens.
            this.flinch = 0.5;
            sfx.bossRoar(this.def.scale * 1.1);
          }
        }
      } else if (bossHp > 0 && this.def.weakPattern !== 'both') {
        this.hitsOnPoint += 1;
        const perStop = this.def.weakPattern === 'double' ? 2 : 1;
        if (this.hitsOnPoint >= perStop) {
          this.hitsOnPoint = 0;
          this.cycleIdx += 1;
          sfx.coreExposed();
        }
      }
    }
    this.lastBossHp = bossHp;

    // GOLIATH's law: wound it deep enough and it stops playing fair.
    if (!this.enraged && this.def.enrageAt > 0 && bossHp > 0 && bossHp / bossMax <= this.def.enrageAt) {
      this.enraged = true;
      this.flinch = 0.35;
      this.hud.title('ENRAGED', '', this.accentCss());
      this.cardTimer = 1.3;
      sfx.bossRoar(this.def.scale * 1.1);
    }

    if (bossHp <= 0) {
      this.toVictory();
      return;
    }
    if (meHp <= 0) {
      this.toDefeat();
      return;
    }

    // Attack scheduling.
    if (!this.attack) {
      this.cooldown -= delta;
      if (this.cooldown <= 0) this.startAttack();
    } else {
      this.advanceAttack(delta);
    }
  }

  // --- the volley: blockable fireballs -----------------------------------------

  /** Pod muzzle world position on `side` (matches the pod bonus hitboxes). */
  private podPos(side: -1 | 1, out: Vector3): void {
    const s = this.def.scale;
    const root = this.rig!.root.position;
    out.set(root.x + side * 0.37 * s, root.y + 1.44 * s, root.z);
  }

  /** Hurl one fireball from the pod on `side`, aimed at your head RIGHT NOW
   *  — after launch it flies straight: step off the line, or block it. */
  private launchShot(side: -1 | 1): void {
    this.podPos(side, _v);
    this.playerHead(_head);
    const group = new Group();
    group.add(glowSprite(this.def.accent, 0.55));
    const core = glowSprite(0xffe9c2, 0.26);
    group.add(core);
    group.position.copy(_v);
    this.scene.add(group);
    const vel = new Vector3().copy(_head).sub(_v).normalize().multiplyScalar(CAMPAIGN.volleySpeed);
    this.shots.push({ pos: _v.clone(), vel, age: 0, group, trail: 0 });
    sfx.mortarThump();
  }

  private updateShots(delta: number): void {
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const shot = this.shots[i];
      shot.age += delta;
      shot.pos.addScaledVector(shot.vel, delta);
      shot.group.position.copy(shot.pos);
      shot.trail -= delta;
      if (shot.trail <= 0) {
        shot.trail = 0.07;
        emberBurst(shot.pos, 2, true);
      }

      // BLOCKED: a fist in the path detonates the shot harmlessly — but ONLY
      // an ARMED fist. Same law as the main game's parry: your ball must be
      // roaring in ORBIT (trigger/grip held) or homing back (RETURNING). A
      // bare, un-orbited hand passes straight through and takes the hit.
      let blocked = false;
      for (const hand of ['left', 'right'] as const) {
        const idx: 0 | 1 = hand === 'left' ? 0 : 1;
        if (!this.handArmed(idx)) continue;
        const grip = this.world.playerSpaceEntities.gripSpaces[hand]?.object3D;
        if (!grip) continue;
        grip.getWorldPosition(_p);
        if (_p.distanceTo(shot.pos) <= CAMPAIGN.volleyBlockRadius) {
          spawnFireImpact(this.world, shot.pos, 1, 0.9);
          emberBurst(shot.pos, 20, true);
          sfx.deflect();
          pulseHand(this.world.session, hand, 0.8, 90);
          blocked = true;
          break;
        }
      }
      if (blocked) {
        this.disposeShot(i);
        continue;
      }

      // HIT: the shot core reaching any body sphere burns like any strike.
      let hit = false;
      for (const part of this.queries.playerParts.entities) {
        const obj = part.object3D;
        if (!obj) continue;
        obj.getWorldPosition(_p);
        const r = part.getValue(Hitbox, 'radius') ?? 0.15;
        if (_p.distanceTo(shot.pos) <= CAMPAIGN.volleyHitRadius + r * 0.8) {
          hit = true;
          break;
        }
      }
      if (hit) {
        spawnFireImpact(this.world, shot.pos, 1, 1.2);
        if (this.invuln <= 0) {
          this.invuln = 0.7;
          this.damagePlayer(CAMPAIGN.attackDamage);
        }
        this.disposeShot(i);
        continue;
      }

      // Missed everything: let it sail past and gutter out.
      if (shot.age > 3.5 || shot.pos.z > 2 || shot.pos.y < -0.4) this.disposeShot(i);
    }
  }

  private disposeShot(i: number): void {
    const shot = this.shots[i];
    shot.group.traverse((o) => {
      const mesh = o as Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      (mesh.material as MeshBasicMaterial | undefined)?.dispose?.();
    });
    shot.group.removeFromParent();
    this.shots.splice(i, 1);
  }

  private disposeShots(): void {
    for (let i = this.shots.length - 1; i >= 0; i--) this.disposeShot(i);
  }

  /** Is this hand's ball ARMED to parry — roaring in orbit or homing back?
   *  (The same states CollisionSystem lets deflect an enemy ball.) */
  private handArmed(hand: 0 | 1): boolean {
    for (const e of this.queries.balls.entities) {
      if ((e.getValue(Fireball, 'owner') ?? 0) !== 0) continue;
      if ((e.getValue(Fireball, 'hand') ?? 0) !== hand) continue;
      if ((e.getValue(Fireball, 'transient') ?? 0) !== 0) continue;
      const st = e.getValue(Fireball, 'state') ?? 0;
      return st === BallState.Orbit || st === BallState.Returning;
    }
    return false;
  }

  /** Pick a weighted attack (avoiding an immediate repeat) and telegraph it. */
  private startAttack(): void {
    const kinds: AttackKind[] = ['slam', 'sweep', 'beam', 'volley', 'nova'];
    let total = 0;
    const pool: Array<[AttackKind, number]> = [];
    for (const k of kinds) {
      let w = this.def.weights[k];
      if (w <= 0) continue;
      if (k === this.lastKind) w *= 0.35; // discourage repeats
      pool.push([k, w]);
      total += w;
    }
    let roll = Math.random() * total;
    let kind: AttackKind = pool[0]?.[0] ?? 'slam';
    for (const [k, w] of pool) {
      roll -= w;
      if (roll <= 0) {
        kind = k;
        break;
      }
    }
    this.lastKind = kind;

    this.playerHead(_head);
    const chargeTime = this.def.charge[kind] * (this.enraged ? CAMPAIGN.enrageChargeMult : 1);
    const zones: Zone[] = [];
    const telegraphs: (Telegraph | null)[] = [];
    const staggers: number[] = [];
    const beamOffsets: number[] = [];
    const markers: (Group | null)[] = [];
    // Strike with the nearer arm. The root carries a π yaw, so arm 0
    // (local −X) hangs on the world +X side.
    const arm: 0 | 1 = _head.x < 0 ? 1 : 0;

    if (kind === 'slam') {
      const r = CAMPAIGN.slamRadius + this.def.scale * 0.02;
      const x0 = clamp(_head.x, -OCTAGON_HALF_WIDTH + 0.15, OCTAGON_HALF_WIDTH - 0.15);
      const z0 = clamp(_head.z, -OCTAGON_HALF_DEPTH + 0.1, OCTAGON_HALF_DEPTH - 0.1);
      const count = this.def.slamStyle === 'single' ? 1 : Math.max(1, this.def.slamCount);
      // A marching drumline steps toward the open side of the platform.
      const marchDir = x0 > 0 ? -1 : 1;
      for (let i = 0; i < count; i++) {
        const x =
          this.def.slamStyle === 'march' && i > 0
            ? clamp(x0 + marchDir * CAMPAIGN.marchStep * i, -OCTAGON_HALF_WIDTH + 0.15, OCTAGON_HALF_WIDTH - 0.15)
            : x0; // 'rehit' re-marks the SAME crater
        zones.push({ kind: 'circle', x, z: z0, r });
        const tg = circleTelegraph(r);
        tg.group.position.set(x, CAMPAIGN.decalY, z0);
        this.scene.add(tg.group);
        telegraphs.push(tg);
        // A breath of extra hang on top of the charge, so the fist lands a
        // touch later than the disc fills — a fairer window to clear it.
        staggers.push(CAMPAIGN.slamImpactDelay + i * (this.def.slamStyle === 'rehit' ? CAMPAIGN.rehitDelay : CAMPAIGN.marchDelay));
        // The ghost hammer: hangs over the disc and descends with the
        // countdown, so the raised arm connects to THIS spot on the floor.
        markers.push(this.makeHammerMarker(x, z0));
      }
    } else if (kind === 'sweep') {
      // A horizontal blade slice just under head height: duck it. Never
      // below 1.3 m — the pelvis is pinned near 0.95 m, so lower slices
      // would clip a standing body no matter what; 1.3 keeps "deep duck"
      // as the honest answer.
      const y = clamp(_head.y - 0.12, 1.3, 1.55);
      zones.push({ kind: 'sweep', y });
      const tg = sweepTelegraph(OCTAGON_HALF_WIDTH * 2 + 0.5, OCTAGON_HALF_DEPTH * 2 + 0.3, y, CAMPAIGN.sweepThickness);
      tg.group.position.set(0, 0, 0);
      this.scene.add(tg.group);
      telegraphs.push(tg);
      staggers.push(0);
    } else if (kind === 'beam') {
      for (let i = 0; i < this.def.beams; i++) {
        // A strip through (or beside) the player, raked from the titan.
        const offset = i === 0 ? 0 : (Math.random() < 0.5 ? -1 : 1) * rand(0.5, 0.8);
        const zone: Zone = { kind: 'beam', x: 0, z: 0, dx: 0, dz: 1, halfW: CAMPAIGN.beamHalfWidth };
        const tg = beamTelegraph(CAMPAIGN.beamHalfWidth, 3.2);
        this.scene.add(tg.group);
        zones.push(zone);
        telegraphs.push(tg);
        beamOffsets.push(offset);
        staggers.push(i * 0.35);
        this.aimBeam(zone, tg, offset); // initial aim (tracking re-aims later)
      }
    } else if (kind === 'nova') {
      // GOLIATH's nova: everything burns EXCEPT one safe wedge — and the
      // wedge opens roughly OPPOSITE where you stand, so you must cross the
      // platform while the flood charges. Run to the marked ground.
      const playerAng = Math.hypot(_head.x, _head.z) > 0.15 ? Math.atan2(_head.x, _head.z) : rand(-Math.PI, Math.PI);
      const angle = playerAng + Math.PI + rand(-0.5, 0.5);
      const halfAngle = this.enraged ? CAMPAIGN.novaEnragedHalfAngle : CAMPAIGN.novaHalfAngle;
      zones.push({ kind: 'nova', angle, halfAngle });
      const tg = novaTelegraph(CAMPAIGN.novaRadius, angle, halfAngle);
      tg.group.position.set(0, CAMPAIGN.decalY, 0);
      this.scene.add(tg.group);
      telegraphs.push(tg);
      staggers.push(0);
    } else {
      // The VOLLEY: no floor marks at all — the shoulder pods spool up
      // (watch the muzzle glows swell through the windup) and then hurl
      // blockable fireballs straight at you, alternating pods. Each shot is
      // aimed where your head is at ITS launch: keep moving, or catch it
      // on a fist.
      for (let i = 0; i < this.def.volleyCount; i++) {
        const side = (i % 2 === 0 ? -1 : 1) as -1 | 1;
        zones.push({ kind: 'shot', side });
        telegraphs.push(null);
        staggers.push(i * CAMPAIGN.volleyInterval);
        markers.push(this.makeMuzzleGlow(side));
      }
    }

    this.attack = {
      kind,
      zones,
      telegraphs,
      staggers,
      resolved: zones.map(() => false),
      time: 0,
      chargeTime,
      arm,
      tracks: kind === 'beam' && this.def.beamTracks,
      beamOffsets,
      markers,
    };
    sfx.chargeWhine(chargeTime);
  }

  /**
   * The ghost hammer: a translucent accent block + glow hanging over a slam
   * disc. advanceAttack lowers it with the countdown; the crash replaces it.
   */
  private makeHammerMarker(x: number, z: number): Group {
    const s = this.def.scale;
    const g = new Group();
    const block = new Mesh(
      new BoxGeometry(0.24 * s, 0.2 * s, 0.24 * s),
      new MeshBasicMaterial({
        color: this.def.accent,
        transparent: true,
        opacity: 0.45,
        blending: AdditiveBlending,
        depthWrite: false,
      }),
    );
    g.add(block);
    const halo = glowSprite(this.def.accent, 0.5 * s);
    halo.position.y = -0.05 * s;
    g.add(halo);
    g.position.set(x, this.markerStartY(), z);
    this.scene.add(g);
    return g;
  }

  /** Where a ghost hammer starts its descent (well above head height). */
  private markerStartY(): number {
    return 2.1 + this.def.scale * 0.35;
  }

  /** The volley's windup tell: a glow swelling at the pod muzzle while the
   *  shot cooks (advanceAttack scales it with the charge fill). */
  private makeMuzzleGlow(side: -1 | 1): Group {
    const g = new Group();
    g.add(glowSprite(this.def.accent, 0.34));
    this.podPos(side, _v);
    g.position.copy(_v);
    g.scale.setScalar(0.4);
    this.scene.add(g);
    return g;
  }

  /** Aim one beam zone (and its telegraph) at the player, offset sideways. */
  private aimBeam(zone: Zone & { kind: 'beam' }, tg: Telegraph, offset: number): void {
    this.playerHead(_head);
    const px = clamp(_head.x + offset, -OCTAGON_HALF_WIDTH, OCTAGON_HALF_WIDTH);
    const pz = clamp(_head.z, -OCTAGON_HALF_DEPTH + 0.1, OCTAGON_HALF_DEPTH - 0.1);
    // Direction from the titan through that point, flattened to XZ.
    _v.set(px - this.rig!.root.position.x, 0, pz - this.bossZ()).normalize();
    zone.x = px;
    zone.z = pz;
    zone.dx = _v.x;
    zone.dz = _v.z;
    // Group origin at the NEAR (player-side) end; local −Z runs back
    // toward the titan.
    tg.group.position.set(px + _v.x * 1.5, CAMPAIGN.decalY, pz + _v.z * 1.5);
    tg.group.rotation.y = Math.atan2(_v.x, _v.z); // local −Z → −dir
  }

  private advanceAttack(delta: number): void {
    const a = this.attack!;
    a.time += delta;

    // VULTURE's law: the beam strips FOLLOW you until the late lock —
    // dodging early just tells it where you were.
    if (a.tracks && a.time < a.chargeTime * CAMPAIGN.beamLockAt) {
      for (let i = 0; i < a.zones.length; i++) {
        const zone = a.zones[i];
        const tg = a.telegraphs[i];
        if (zone.kind === 'beam' && tg) this.aimBeam(zone, tg, a.beamOffsets[i] ?? 0);
      }
    }

    // Each zone runs its OWN countdown to its own detonation — a marching
    // drumline or a staggered volley reads as a sequence of beats, not one.
    let allDone = true;
    for (let i = 0; i < a.zones.length; i++) {
      if (a.resolved[i]) continue;
      const dueAt = a.chargeTime + a.staggers[i];
      if (a.time >= dueAt) {
        a.resolved[i] = true;
        a.telegraphs[i]?.dispose();
        a.telegraphs[i] = null;
        // The ghost hammer's hover spot feeds the crash, then it's gone.
        const m = a.markers[i] ?? null;
        this.disposeMarker(m);
        a.markers[i] = null;
        this.detonate(a.kind, a.zones[i]);
      } else {
        const fill = clamp(a.time / dueAt, 0, 1);
        a.telegraphs[i]?.update(fill, this.time);
        const m = a.markers[i];
        const zone = a.zones[i];
        if (m && zone.kind === 'shot') {
          // The muzzle glow rides its pod (the titan sways) and swells.
          this.podPos(zone.side, _v);
          m.position.copy(_v);
          m.scale.setScalar(0.4 + fill * 1.1);
        } else if (m) {
          // Lower the ghost hammer with the countdown — a spinning descent.
          m.position.y = this.markerStartY() * (1 - fill * fill) + 0.55;
          m.rotation.y += delta * 3;
        }
        allDone = false;
      }
    }

    if (allDone && a.time >= a.chargeTime + (a.staggers[a.zones.length - 1] ?? 0) + 0.4) {
      this.disposeAttack();
      this.cooldown = this.attackCooldown();
    }
  }

  /** Seconds until the next attack: enrage quickens it, and every closed
   *  crown loop quickens GOLIATH further — the last loop is a storm. */
  private attackCooldown(): number {
    let mult = this.enraged ? CAMPAIGN.enrageCooldownMult : 1;
    if (this.def.weakPattern === 'crown') {
      mult *= Math.pow(CAMPAIGN.crownHaste, Math.floor(this.cycleIdx / CROWN_RING.length));
    }
    return rand(this.def.cooldownMin, this.def.cooldownMax) * mult;
  }

  /** A zone goes off: strike visual + sound, and damage if you're in it.
   *  (A volley zone "detonating" is its LAUNCH — the shot itself judges
   *  blocks and hits in flight, in updateShots.) */
  private detonate(kind: AttackKind, zone: Zone): void {
    const hit = this.zoneTouchesPlayer(zone);

    if (kind === 'slam') {
      sfx.slamImpact();
      if (zone.kind === 'circle') this.spawnFistCrash(zone.x, zone.z);
      this.strikeSwing[this.attack!.arm] = 0.6;
    } else if (kind === 'sweep') {
      sfx.sweepWhoosh();
      if (zone.kind === 'sweep') this.spawnBladeSweep(zone.y, this.attack!.arm);
      this.strikeSwing[this.attack!.arm] = 0.6;
    } else if (kind === 'beam') {
      sfx.beamBlast();
      if (zone.kind === 'beam') this.spawnBeamColumn(zone);
    } else if (kind === 'nova') {
      sfx.beamBlast();
      sfx.slamImpact();
      if (zone.kind === 'nova') this.spawnNovaWave(zone.angle, zone.halfAngle);
    } else {
      if (zone.kind === 'shot') this.launchShot(zone.side);
    }

    if (hit && this.invuln <= 0) {
      this.invuln = 0.7;
      this.damagePlayer(CAMPAIGN.attackDamage);
    }
  }

  /** Any of the player's three body spheres inside the zone? */
  private zoneTouchesPlayer(zone: Zone): boolean {
    // The nova judges the HEAD alone (angular test) — body spheres trail the
    // head by design, and clipping someone who reached the wedge feels rigged.
    if (zone.kind === 'nova') {
      this.playerHead(_p);
      const ang = Math.atan2(_p.x, _p.z);
      const d = Math.abs(((ang - zone.angle + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      return d > zone.halfAngle;
    }
    for (const part of this.queries.playerParts.entities) {
      const obj = part.object3D;
      if (!obj) continue;
      obj.getWorldPosition(_p);
      const r = part.getValue(Hitbox, 'radius') ?? 0.15;
      if (zone.kind === 'circle') {
        const d = Math.hypot(_p.x - zone.x, _p.z - zone.z);
        if (d <= zone.r + r * 0.7) return true;
      } else if (zone.kind === 'beam') {
        // Distance from the sphere to the beam line in XZ.
        const relX = _p.x - zone.x;
        const relZ = _p.z - zone.z;
        const along = relX * zone.dx + relZ * zone.dz;
        const perpX = relX - along * zone.dx;
        const perpZ = relZ - along * zone.dz;
        if (Math.hypot(perpX, perpZ) <= zone.halfW + r * 0.7) return true;
      } else if (zone.kind === 'sweep') {
        if (Math.abs(_p.y - zone.y) <= CAMPAIGN.sweepThickness + r * 0.6) return true;
      }
    }
    return false;
  }

  private damagePlayer(amount: number): void {
    const me = fighterAt(0);
    if (!me) return;
    me.setValue(Health, 'current', Math.max(0, (me.getValue(Health, 'current') ?? 0) - amount));
    sfx.hitTaken();
    feedback.playerHitFlash = 1;
    // The blow came from the titan's side of the arena.
    this.playerHead(_p);
    _v.set(this.rig!.root.position.x - _p.x, 0.4, this.bossZ() - _p.z).normalize();
    feedback.srcX = _v.x;
    feedback.srcY = _v.y;
    feedback.srcZ = _v.z;
    pulseHand(this.world.session, 'left', 0.9, 140);
    pulseHand(this.world.session, 'right', 0.9, 140);
  }

  // --- strike visuals ----------------------------------------------------------

  private spawnFistCrash(x: number, z: number): void {
    // The hammer LANDS: a solid accent block crashes the last half-metre in
    // a few frames, buries itself in the disc, and erupts — a floor flash,
    // a double burst and a spray of sparks. You SEE the platform get hit.
    const s = this.def.scale;
    const fist = new Mesh(
      new BoxGeometry(0.26 * s, 0.22 * s, 0.26 * s),
      new MeshBasicMaterial({ color: this.def.accent, transparent: true, opacity: 0.95 }),
    );
    this.scene.add(fist);
    const flash = glowSprite(0xfff3cf, 1.5 * s, 0.95);
    flash.position.set(x, 0.12, z);
    flash.visible = false;
    this.scene.add(flash);
    const startY = this.markerStartY() * 0.35 + 0.55; // pick up where the ghost left off
    const world = this.world;
    let burst = false;
    this.strikes.push({
      age: 0,
      life: 0.7,
      update(age) {
        const drop = Math.min(1, age / 0.08); // near-instant, brutal
        fist.position.set(x, startY * (1 - drop) + 0.11 * s, z);
        if (drop >= 1 && !burst) {
          burst = true;
          _v.set(x, 0.12, z);
          spawnFireImpact(world, _v, 1, 2.0);
          emberBurst(_v, 34, true);
          flash.visible = true;
        }
        if (burst) {
          const settle = Math.min(1, (age - 0.08) / 0.62);
          (fist.material as MeshBasicMaterial).opacity = 0.95 * (1 - settle);
          flash.material.opacity = 0.95 * (1 - settle) * (1 - settle);
          flash.scale.setScalar(1.5 * s * (1 + settle * 1.6));
        }
      },
      dispose() {
        fist.geometry.dispose();
        (fist.material as MeshBasicMaterial).dispose();
        fist.removeFromParent();
        flash.material.dispose();
        flash.removeFromParent();
      },
    });
  }

  private spawnBladeSweep(y: number, arm: 0 | 1): void {
    // The SLICE: a tall glowing blade wall scythes across the whole platform
    // at the marked height, shedding sparks as it goes — a cut you can watch
    // travel, not a flicker.
    const s = this.def.scale;
    const blade = new Mesh(
      new BoxGeometry(0.09, 0.4, OCTAGON_HALF_DEPTH * 2 + 0.7),
      new MeshBasicMaterial({
        color: this.def.accent,
        transparent: true,
        opacity: 0.9,
        blending: AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.scene.add(blade);
    const edge = glowSprite(this.def.accent, 0.5 * s);
    this.scene.add(edge);
    const from = arm === 0 ? 1 : -1; // the striking arm's world side (see yaw)
    const span = OCTAGON_HALF_WIDTH + 0.7;
    let emberClock = 0;
    this.strikes.push({
      age: 0,
      life: 0.42,
      update(age) {
        const k = Math.min(1, age / 0.34); // slow enough to watch it travel
        const bx = from * span * (1 - 2 * k);
        blade.position.set(bx, y, 0);
        edge.position.set(bx, y, 0);
        (blade.material as MeshBasicMaterial).opacity = 0.9 * (1 - k * k * k);
        // Sparks shed along the cut.
        if (age > emberClock) {
          emberClock = age + 0.045;
          _v.set(bx, y - 0.1, rand(-OCTAGON_HALF_DEPTH, OCTAGON_HALF_DEPTH));
          emberBurst(_v, 4, true);
        }
      },
      dispose() {
        blade.geometry.dispose();
        (blade.material as MeshBasicMaterial).dispose();
        blade.removeFromParent();
        edge.material.dispose();
        edge.removeFromParent();
      },
    });
  }

  private spawnBeamColumn(zone: Zone & { kind: 'beam' }): void {
    // A blinding column from the titan's visor raking down the strip.
    const rig = this.rig!;
    rig.head.getWorldPosition(_v);
    const from = _v.clone();
    const to = new Vector3(zone.x - zone.dx * 1.2, 0.05, zone.z - zone.dz * 1.2);
    const far = new Vector3(zone.x + zone.dx * 1.6, 0.05, zone.z + zone.dz * 1.6);
    const len = from.distanceTo(far);
    const beam = new Mesh(
      new CylinderGeometry(0.07, 0.12, len, 10),
      new MeshBasicMaterial({
        color: this.def.accent,
        transparent: true,
        opacity: 0.9,
        blending: AdditiveBlending,
        depthWrite: false,
      }),
    );
    beam.position.copy(from).add(far).multiplyScalar(0.5);
    beam.lookAt(far);
    beam.rotateX(Math.PI / 2); // cylinder axis onto the look direction
    this.scene.add(beam);
    const world = this.world;
    let burst = false;
    this.strikes.push({
      age: 0,
      life: 0.35,
      update(age) {
        if (!burst) {
          burst = true;
          spawnFireImpact(world, to, 1);
          spawnFireImpact(world, far, 1);
        }
        (beam.material as MeshBasicMaterial).opacity = 0.9 * (1 - (age / 0.35) ** 2);
      },
      dispose() {
        beam.geometry.dispose();
        (beam.material as MeshBasicMaterial).dispose();
        beam.removeFromParent();
      },
    });
  }

  /** The nova lands: fire sweeps the platform, sparing only the wedge. */
  private spawnNovaWave(angle: number, halfAngle: number): void {
    const ring = new Mesh(
      new CylinderGeometry(1, 1, 0.06, 32, 1, true),
      new MeshBasicMaterial({
        color: this.def.accent,
        transparent: true,
        opacity: 0.9,
        blending: AdditiveBlending,
        depthWrite: false,
        side: 2, // DoubleSide — the open tube must show both faces
      }),
    );
    ring.position.set(0, 0.1, 0);
    this.scene.add(ring);
    const world = this.world;
    let burstClock = 0;
    this.strikes.push({
      age: 0,
      life: 0.45,
      update(age) {
        const k = Math.min(1, age / 0.38);
        ring.scale.set(0.15 + k * CAMPAIGN.novaRadius, 1, 0.15 + k * CAMPAIGN.novaRadius);
        (ring.material as MeshBasicMaterial).opacity = 0.9 * (1 - k * k);
        // Fire erupts along the expanding front — everywhere but the wedge.
        if (age > burstClock) {
          burstClock = age + 0.05;
          for (let i = 0; i < 3; i++) {
            const a = rand(-Math.PI, Math.PI);
            const d = Math.abs(((a - angle + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
            if (d <= halfAngle) continue; // the safe ground stays safe
            const rr = 0.15 + k * CAMPAIGN.novaRadius * 0.85;
            _v.set(Math.sin(a) * rr, 0.12, Math.cos(a) * rr);
            emberBurst(_v, 6, true);
            if (i === 0 && k > 0.4) spawnFireImpact(world, _v, 1, 0.8);
          }
        }
      },
      dispose() {
        ring.geometry.dispose();
        (ring.material as MeshBasicMaterial).dispose();
        ring.removeFromParent();
      },
    });
  }

  private updateStrikes(delta: number): void {
    for (let i = this.strikes.length - 1; i >= 0; i--) {
      const s = this.strikes[i];
      s.age += delta;
      if (s.age >= s.life) {
        s.dispose();
        this.strikes.splice(i, 1);
      } else {
        s.update(s.age);
      }
    }
  }

  // --- titan animation ---------------------------------------------------------

  private animateTitan(delta: number): void {
    const rig = this.rig!;
    const fighting = this.phase === 'fight';

    // Idle drift + hover bob — fight only: the entrance and the fall own
    // the root transform outright (a sway lerp would drag the vulture's
    // swoop back to centre, and the flinch snap would erase the fortress's
    // roll-in). Enraged machines pace.
    if (fighting) {
      const swayRate = this.enraged ? 0.85 : 0.45;
      const sway = Math.sin(this.time * swayRate) * this.def.swayAmp;
      rig.root.position.x += (sway - rig.root.position.x) * Math.min(1, delta * 1.6);
      rig.root.position.y = Math.sin(this.time * 1.1) * 0.04 * this.def.scale;
    }

    // Flinch: the whole chassis rocks back when the core takes fire.
    this.flinch = Math.max(0, this.flinch - delta);
    if (fighting) {
      rig.root.position.z = this.bossZ() + (this.flinch > 0 ? -0.18 * (this.flinch / 0.35) : 0);
    }

    // The head tracks you (lookAt aims +Z; the visor lives on −Z, so flip).
    this.playerHead(_head);
    rig.head.lookAt(_head.x, _head.y, _head.z);
    rig.head.rotateY(Math.PI);

    // Whatever is vulnerable BLINKS — a hard on/off wink, not a breath, so
    // it reads as a signal: the head's visor tell, the chest core, the low
    // emblem. Beams still superheat the eye while they cook; enrage keeps
    // the eye furious throughout.
    const lit = fighting ? this.litPoints() : [];
    const wink = this.time % 0.5 < 0.3 ? 1 : 0;
    const beamCharging = this.attack?.kind === 'beam' ? clamp(this.attack.time / this.attack.chargeTime, 0, 1) : 0;
    // The eye blink is the loudest tell in the fight: near-dark on the off
    // beat, a flare on the on beat — a hard strobe you can't miss.
    rig.visorMat.emissiveIntensity =
      (lit.includes('head') ? 0.25 + wink * 4.6 : 0.7) +
      beamCharging * 3.2 +
      (this.enraged ? 1.6 + Math.sin(this.time * 10) * 0.6 : 0);
    const coreLit = lit.includes('core');
    rig.coreMat.emissiveIntensity = coreLit ? 0.5 + wink * 2.8 : 0.25;
    rig.core.scale.setScalar(coreLit ? 1 + wink * 0.16 : 1);
    const lowLit = lit.includes('low');
    rig.lowMat.emissiveIntensity = lowLit ? 0.5 + wink * 2.8 : 0.2;
    rig.low.scale.setScalar(lowLit ? 1 + wink * 0.18 : 1);
    for (const [i, spot] of (['shoulderL', 'shoulderR'] as const).entries()) {
      const on = lit.includes(spot);
      // The shoulder lamps sit small and off to the sides, so they get the
      // LOUDEST strobe of all the tells — near-dark to a hard flare, and a
      // big scale pulse — or GOLIATH's ring stop is easy to miss.
      rig.shoulderMats[i].emissiveIntensity = on ? 0.2 + wink * 6.0 : 0.2;
      rig.shoulders[i].scale.setScalar(on ? 1 + wink * 0.55 : 1);
    }

    // Pods glow while a volley cooks.
    const volleying = this.attack?.kind === 'volley';
    for (const mat of rig.podMats) {
      mat.emissiveIntensity += ((volleying ? 2.4 : 0.2) - mat.emissiveIntensity) * Math.min(1, delta * 6);
    }

    // Arms: wind up with the charge, whip through on the strike, ease home.
    // The sweep winds OUT wide and whips ACROSS; the slam hoists sky-high
    // and hammers DOWN — two silhouettes you can tell apart at a glance.
    const a = this.attack;
    for (const i of [0, 1] as const) {
      const arm = rig.arms[i];
      this.strikeSwing[i] = Math.max(0, this.strikeSwing[i] - delta);
      let targetX = arm.restX;
      let targetZ = arm.restZ;
      if (a && a.kind === 'nova') {
        // The nova: BOTH arms hoist together — the whole machine coils.
        const fill = clamp(a.time / a.chargeTime, 0, 1);
        targetX = arm.restX - 2.2 * fill;
        targetZ = arm.restZ * (1 + fill);
      } else if (a && a.arm === i && (a.kind === 'slam' || a.kind === 'sweep')) {
        const fill = clamp(a.time / a.chargeTime, 0, 1);
        if (a.kind === 'slam') {
          targetX = arm.restX - 2.5 * fill; // hoist the fist sky-high
        } else {
          targetZ = arm.restZ + (i === 0 ? -1 : 1) * 1.7 * fill; // wind out wide
          targetX = arm.restX - 0.4 * fill;
        }
      } else if (this.strikeSwing[i] > 0) {
        const k = this.strikeSwing[i] / 0.6;
        // Follow-through: hammered down-and-through, or swung hard across.
        if (this.lastKind === 'sweep') {
          targetZ = arm.restZ + (i === 0 ? 1 : -1) * 1.4 * k; // crossed the body
          targetX = arm.restX + 0.3 * k;
        } else {
          targetX = arm.restX + 1.3 * k; // buried in the floor
          targetZ = arm.restZ * (1 - k);
        }
      }
      const ease = Math.min(1, delta * (this.strikeSwing[i] > 0.45 ? 26 : 7));
      arm.pivot.rotation.x += (targetX - arm.pivot.rotation.x) * ease;
      arm.pivot.rotation.z += (targetZ - arm.pivot.rotation.z) * ease;
    }
  }

  // --- weak-point hitboxes -------------------------------------------------------

  private ensureHitboxes(): void {
    const owner = fighterAt(1);
    if (!owner || this.boxes.body) {
      this.sizeHitboxes();
      return;
    }
    const make = (): Entity => {
      const e = this.world.createTransformEntity(new Object3D(), { persistent: true });
      e.addComponent(Hitbox, { radius: 0.2, team: 1, owner, damageScale: 0 });
      return e;
    };
    this.boxes.body = make();
    this.boxes.pelvis = make();
    this.boxes.head = make();
    this.boxes.core = make();
    this.boxes.shoulderL = make();
    this.boxes.shoulderR = make();
    this.boxes.pods = [make(), make()];
    this.sizeHitboxes();
  }

  private sizeHitboxes(): void {
    const s = this.def.scale;
    // Armour spheres hug the VISIBLE chassis (the trunk is only ~0.3·s
    // wide) — an inflated armour sphere used to eat balls out of the air
    // before they could ever reach the core, which made the "hit the core"
    // prompt a lie. Weak points sit proud of the plate.
    this.boxes.body?.setValue(Hitbox, 'radius', 0.32 * s);
    this.boxes.pelvis?.setValue(Hitbox, 'radius', 0.2 * s);
    this.boxes.head?.setValue(Hitbox, 'radius', 0.24 * s);
    this.boxes.core?.setValue(Hitbox, 'radius', 0.22 * s);
    this.boxes.shoulderL?.setValue(Hitbox, 'radius', 0.18 * s);
    this.boxes.shoulderR?.setValue(Hitbox, 'radius', 0.18 * s);
    for (const pod of this.boxes.pods) pod.setValue(Hitbox, 'radius', 0.15 * s);
  }

  /** Glue the spheres to the rig and apply the head↔core cycle every frame. */
  private placeHitboxes(): void {
    const rig = this.rig;
    if (!rig || this.phase === 'idle') return;
    if (this.phase !== 'fight') {
      this.parkHitboxes();
      return;
    }
    const s = this.def.scale;
    const root = rig.root.position;
    const lit = this.litPoints();

    rig.head.getWorldPosition(_v);
    this.boxes.head?.object3D?.position.copy(_v);
    this.boxes.head?.setValue(Hitbox, 'damageScale', lit.includes('head') ? CAMPAIGN.headScale : 0);

    rig.core.getWorldPosition(_v);
    this.boxes.core?.object3D?.position.copy(_v);
    this.boxes.core?.setValue(Hitbox, 'damageScale', lit.includes('core') ? CAMPAIGN.coreScale : 0);

    this.boxes.body?.object3D?.position.set(root.x, root.y + 1.05 * s, root.z);
    this.boxes.body?.setValue(Hitbox, 'damageScale', 0);
    // The pelvis sphere doubles as the LOW-BLOW target when the pattern
    // calls it; otherwise it's armour like the trunk.
    rig.low.getWorldPosition(_v);
    this.boxes.pelvis?.object3D?.position.copy(_v);
    this.boxes.pelvis?.setValue(Hitbox, 'damageScale', lit.includes('low') ? CAMPAIGN.lowScale : 0);

    // Shoulder emblems — the crown circuit's ring stops.
    rig.shoulders[0].getWorldPosition(_v);
    this.boxes.shoulderL?.object3D?.position.copy(_v);
    this.boxes.shoulderL?.setValue(Hitbox, 'damageScale', lit.includes('shoulderL') ? CAMPAIGN.podScale : 0);
    rig.shoulders[1].getWorldPosition(_v);
    this.boxes.shoulderR?.object3D?.position.copy(_v);
    this.boxes.shoulderR?.setValue(Hitbox, 'damageScale', lit.includes('shoulderR') ? CAMPAIGN.podScale : 0);

    // Pods pay bonus during a volley — except on the crown, where stray pod
    // hits would skip ring stops out of order.
    const volleying = this.attack?.kind === 'volley' && this.def.weakPattern !== 'crown';
    this.boxes.pods.forEach((pod, i) => {
      const side = i === 0 ? -1 : 1;
      pod.object3D?.position.set(root.x + side * 0.37 * s, root.y + 1.44 * s, root.z);
      pod.setValue(Hitbox, 'damageScale', volleying ? CAMPAIGN.podScale : 0);
    });

    // Aim assist rides the live point (crown: whichever ring stop blinks).
    if (lit.includes('core')) rig.core.getWorldPosition(campaign.aimPoint);
    else if (lit.includes('head')) rig.head.getWorldPosition(campaign.aimPoint);
    else if (lit.includes('shoulderL')) rig.shoulders[0].getWorldPosition(campaign.aimPoint);
    else if (lit.includes('shoulderR')) rig.shoulders[1].getWorldPosition(campaign.aimPoint);
    else rig.low.getWorldPosition(campaign.aimPoint);
    campaign.coreOpen = lit.includes('core');
  }

  private parkHitboxes(): void {
    const all = [
      this.boxes.body,
      this.boxes.pelvis,
      this.boxes.head,
      this.boxes.core,
      this.boxes.shoulderL,
      this.boxes.shoulderR,
      ...this.boxes.pods,
    ];
    for (const e of all) {
      e?.object3D?.position.set(0, -100, 0);
      e?.setValue(Hitbox, 'damageScale', 0);
    }
  }

  // --- endings -------------------------------------------------------------------

  private toVictory(): void {
    this.phase = 'victory';
    this.t = 0;
    this.outroStep = 0;
    match.phase = 'matchOver';
    this.disposeAttack();
    this.disposeShots();
    campaign.coreOpen = false;
    this.parkHitboxes();

    app.stats.wins += 1;
    saveStats();
    const lastStage = app.campaignStage === BOSSES.length - 1;
    const run = this.runMode();

    // Coins + XP at the flat per-game rate — DOUBLE on a titan's first fell.
    const firstClear = campaignProgress.cleared[app.campaignStage] !== true;
    if (firstClear) {
      campaignProgress.cleared[app.campaignStage] = true;
      saveCampaignProgress();
    }
    reportCampaign(true, firstClear);

    // Felling the king crowns you: the CHAMPION pad joins your locker.
    // (Also granted retroactively to saves that beat GOLIATH pre-reward.)
    const crowned = lastStage && !platformOwned('champion');
    if (crowned) {
      ownPlatform('champion');
      setPlatformSkin('champion');
      playCash();
    }

    // Mid-run fells chain straight to the next titan after a short collapse.
    this.advanceAfterVictory = run && !lastStage;
    this.victoryDelay = this.advanceAfterVictory ? CAMPAIGN.runVictoryDelay : CAMPAIGN.victoryDelay;

    if (this.advanceAfterVictory) {
      this.hud.title('FELLED', BOSSES[app.campaignStage + 1].name, this.accentCss());
      sfx.roundEnd(true); // the full fanfare waits for the end of the run
      sfx.bossRoar(this.def.scale * 1.0);
      return;
    }

    if (run && lastStage) {
      // The run is complete: the clock goes on the board.
      const hardcore = app.campaignMode === 'hardcore';
      const record = recordRunTime(hardcore, this.runClock);
      if (!hardcore && !campaignProgress.hardcoreUnlocked) {
        campaignProgress.hardcoreUnlocked = true;
        saveCampaignProgress();
      }
      this.hud.title(
        hardcore ? 'HARDCORE' : 'GAUNTLET',
        `${fmtRunTime(this.runClock)}${record ? ' · NEW RECORD' : ''}`,
        this.accentCss(),
      );
    } else {
      // No payout readout — just the fell (and the one-time crown unlock).
      this.hud.title('TITAN FELLED', crowned ? 'CHAMPION PLATFORM UNLOCKED' : '', this.accentCss());
    }
    playVictory(); // stops the battle score and rings the end-of-game sting
    sfx.matchEnd(true);
    sfx.bossRoar(this.def.scale * 1.0); // the death bellow
  }

  private toDefeat(): void {
    this.phase = 'defeat';
    this.t = 0;
    match.phase = 'matchOver';
    this.disposeAttack();
    this.disposeShots();
    campaign.coreOpen = false;
    this.parkHitboxes();

    app.stats.losses += 1;
    saveStats();
    reportCampaign(false, false); // the consolation rate, same as a bot loss
    if (this.runMode()) {
      // A run dies where you do — no continues, back to the line-up.
      this.hud.title('RUN OVER', `${app.campaignStage} of ${BOSSES.length}`, '#e8352a');
    } else {
      this.hud.title('SCRAPPED', '', '#e8352a');
    }
    playVictory(); // stops the battle score and rings the end sting
    sfx.matchEnd(false);
    sfx.bossRoar(this.def.scale * 1.2); // it laughs, kind of
  }

  private outro(delta: number): void {
    const rig = this.rig!;
    if (this.phase === 'victory') {
      // Each chassis dies its own death (see deathPose), shedding fire.
      const k = clamp(this.t / Math.min(3.2, this.victoryDelay), 0, 1);
      this.deathPose(k);
      this.emberTimer -= delta;
      if (this.emberTimer <= 0 && k < 1) {
        this.emberTimer = 0.16;
        _v.set(
          rig.root.position.x + rand(-0.6, 0.6) * this.def.scale,
          rand(0.4, 1.4) * this.def.scale,
          this.bossZ() + rand(-0.3, 0.3),
        );
        emberBurst(_v, 12, true);
        spawnFireImpact(this.world, _v, 1);
      }
      this.light.intensity = Math.max(0, 5 * (1 - k));
      if (this.t >= this.victoryDelay) {
        if (this.advanceAfterVictory) this.advanceRun();
        else this.finish();
      }
    } else {
      // Defeat: it looms and powers down the show.
      this.light.intensity = Math.max(0, 5 - this.t);
      if (this.t >= CAMPAIGN.defeatDelay) this.finish();
    }
  }

  /**
   * The fall, per chassis — k runs 0 (killing blow) → 1 (down). Owns the
   * full root transform for the collapse; sign conventions under the π yaw:
   * +X pitch tips the face DOWN toward the player, −X tips it backward.
   */
  private deathPose(k: number): void {
    const rig = this.rig!;
    const h = rig.height;
    const z = this.bossZ();
    const root = rig.root;
    switch (this.def.style) {
      case 'hook': {
        // RUSTHOOK keels over SIDEWAYS — a slow list past the point of no
        // return, then the crash.
        const lean = k < 0.45 ? (k / 0.45) * 0.3 : 0.3 + ((k - 0.45) / 0.55) ** 2 * 1.15;
        root.rotation.z = lean;
        root.position.set(lean * 0.5, -h * 0.3 * k * k, z);
        if (k >= 0.95 && this.outroStep === 0) {
          this.outroStep = 1;
          sfx.slamImpact();
        }
        break;
      }
      case 'piston': {
        // The press pancakes STRAIGHT DOWN, one jolt at a time, until the
        // chassis is a stack of plates.
        const steps = 4;
        const seg = Math.floor(k * steps);
        const jolt = Math.min(1, (k * steps - seg) / 0.35);
        const e = Math.min(1, (seg + jolt) / steps);
        root.scale.y = 1 - 0.55 * e;
        root.position.set(0, 0, z);
        if (seg > this.outroStep && k < 1) {
          this.outroStep = seg;
          sfx.slamImpact();
        }
        break;
      }
      case 'vulture': {
        // Shot out of its hover: topples BACKWARD, rolling off one wing.
        root.rotation.x = -0.85 * k * k;
        root.rotation.z = 0.7 * k * k;
        root.position.set(-0.4 * k, -h * 0.45 * k * k, z - 0.5 * k);
        break;
      }
      case 'fortress': {
        // Scuttled at anchor — sinks listing back into the floor, rattling
        // as the magazine cooks off.
        const e = k * k;
        root.rotation.z = -0.3 * e;
        root.position.set(Math.sin(this.time * 26) * 0.02 * (1 - k), -(h + 0.5) * e, z);
        break;
      }
      default: {
        // GOLIATH kneels, HOLDS — long enough to mean it — then falls
        // forward at the player's feet.
        if (k < 0.35) {
          const e = k / 0.35;
          root.rotation.x = 0.12 * e;
          root.position.set(0, -h * 0.16 * e, z);
        } else if (k < 0.6) {
          root.rotation.x = 0.12;
          root.position.set(0, -h * 0.16, z);
        } else {
          const e = ((k - 0.6) / 0.4) ** 2;
          root.rotation.x = 0.12 + 0.75 * e;
          root.position.set(0, -h * (0.16 + 0.38 * e), z);
          if (this.outroStep === 0) {
            this.outroStep = 1;
            sfx.bossRoar(this.def.scale * 0.9); // the last breath as he goes
          }
        }
        break;
      }
    }
  }

  private finish(): void {
    // Back to the titan line-up, not the main arc — win or lose, the
    // gauntlet is where you pick your next fight (or your rematch).
    app.campaignOpen = true;
    app.state = 'menu';
    this.teardown();
  }

  // --- helpers ---------------------------------------------------------------------

  private refreshHud(delta: number): void {
    this.hudTimer -= delta;
    if (this.hudTimer > 0) return;
    this.hudTimer = 0.15;
    const boss = fighterAt(1);
    const me = fighterAt(0);
    this.hud.setBoss(this.def.name, this.accentCss(), this.runMode() ? fmtRunTime(this.runClock) : '');
    this.hud.setBars(
      (boss?.getValue(Health, 'current') ?? 0) / (boss?.getValue(Health, 'max') ?? 1),
      (me?.getValue(Health, 'current') ?? 0) / (me?.getValue(Health, 'max') ?? 1),
      this.accentCss(),
    );
  }

  private accentCss(): string {
    return `#${this.def.accent.toString(16).padStart(6, '0')}`;
  }

  private bossZ(): number {
    return -ARENA_GAP - this.def.zOffset;
  }

  private playerHead(out: Vector3): void {
    const headObj = this.playerHeadEntity?.object3D;
    if (headObj) headObj.getWorldPosition(out);
    else out.set(0, 1.6, 0);
  }
}
