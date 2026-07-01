/**
 * ARCADE — the titan gauntlet. Owns a campaign bout end to end:
 *
 *  INTRO   : klaxon + strobing pit light, the titan grinds up out of the
 *            floor behind the far platform, name card + roar, FIGHT, bell.
 *            (Squeeze a trigger to skip the ceremony.)
 *  FIGHT   : the titan cycles telegraphed attacks — every kill zone charges
 *            visibly ON YOUR PLATFORM (see campaign/telegraphs.ts): fist
 *            SLAMS (step out of the disc), horizontal SWEEPS (duck the
 *            blade), eye BEAMS (sidestep the strip) and mortar BARRAGES
 *            (thread the footprints). Its armour clanks your fire away;
 *            damage goes in through the visor, the pauldron pods while a
 *            barrage cooks, and — double — the chest core that vents open
 *            after every melee swing. Dodge, then punish.
 *  VICTORY : collapse, payout card (double scrap/XP on a first fell).
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
  CylinderGeometry,
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
  sweepTelegraph,
  type Telegraph,
} from '../campaign/telegraphs.js';
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
import { playVictory, startBattleMusic, stopBattleTrack } from '../audio/battleMusic.js';
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
  CURRENCY,
  OCTAGON_HALF_DEPTH,
  OCTAGON_HALF_WIDTH,
  PROGRESSION,
} from '../config.js';

const ROMAN = ['I', 'II', 'III', 'IV', 'V'];

type Phase = 'idle' | 'intro' | 'fight' | 'victory' | 'defeat';

type Zone =
  | { kind: 'circle'; x: number; z: number; r: number }
  | { kind: 'beam'; x: number; z: number; dx: number; dz: number; halfW: number }
  | { kind: 'sweep'; y: number };

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
  /** WIDOWMAKER's law: beams re-aim at you until the late lock. */
  tracks: boolean;
  /** Per-beam lateral offsets, kept so tracking re-aims stay parallel. */
  beamOffsets: number[];
}

/** A burning floor patch left by JUGGERNAUT's mortars — the ground war. */
interface BurnPatch {
  x: number;
  z: number;
  ttl: number;
  tg: Telegraph;
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
}) {
  private hud!: CampaignHud;
  private light!: PointLight;

  private phase: Phase = 'idle';
  private t = 0;
  private time = 0; // global clock for shader pulses
  private def: BossDef = BOSSES[0];
  private rig?: TitanRig;

  // Boss weak-point spheres (created once, repositioned per stage/frame).
  private boxes: { body?: Entity; pelvis?: Entity; head?: Entity; core?: Entity; pods: Entity[] } = { pods: [] };

  private attack: ActiveAttack | null = null;
  private cooldown = 2.5;
  private lastKind: AttackKind | null = null;
  private strikes: Strike[] = [];
  private patches: BurnPatch[] = [];
  private coreOpen = 0; // seconds left on the vented-core window
  private invuln = 0; // player i-frames after eating a strike
  private strikeSwing: [number, number] = [0, 0]; // post-strike arm follow-through
  private flinch = 0;
  private enraged = false;
  private lastBossHp = 0;
  private hudTimer = 0;
  private emberTimer = 0;
  private cardTimer = 0; // auto-clear for transient cards (ENRAGED)
  private payoutLines: string[] = [];
  // Gauntlet runs: fight-time-only clock, and whether this victory chains on.
  private runClock = 0;
  private advanceAfterVictory = false;
  private victoryDelay = CAMPAIGN.victoryDelay;

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
    this.rig.root.position.set(0, -this.rig.height - 0.4, this.bossZ());
    // The rig's face (visor/core) sits on local −Z, same as the duel boxer —
    // yaw the whole machine to face the player across the gap.
    this.rig.root.rotation.set(0, Math.PI, 0);
    this.scene.add(this.rig.root);

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
    this.clearPatches();
    this.attack = null;
    this.coreOpen = 0;
    this.invuln = 0;
    this.enraged = false;
    this.cardTimer = 0;
    this.cooldown = rand(this.def.cooldownMin, this.def.cooldownMax) + 0.8;
    this.lastKind = null;
    campaign.coreOpen = false;

    // Collisions and rim-drain stay off until the bell (phase 'roundOver').
    match.phase = 'roundOver';
    match.message = '';
    match.resetCount += 1; // park the fireballs at your fists

    this.light.color.setHex(this.def.accent);
    this.light.position.set(0, this.rig.height * 0.8 + 1, this.bossZ() + 1.2);
    this.light.intensity = 0;

    this.phase = 'intro';
    this.t = 0;
    this.hud.showCard('WARNING', [warning], '#ffb000');
    sfx.klaxon();
  }

  private teardown(): void {
    this.phase = 'idle';
    this.attack?.telegraphs.forEach((t) => t?.dispose());
    this.attack = null;
    this.clearPatches();
    for (const s of this.strikes) s.dispose();
    this.strikes = [];
    this.rig?.dispose();
    this.rig = undefined;
    this.light.visible = false;
    this.hud.setVisible(false);
    this.hud.showCard('', []);
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

    // The rise: grind up out of the pit with an ember eruption.
    const riseStart = klaxonTime;
    if (this.t >= riseStart && this.t < riseStart + riseTime + 0.2) {
      if (this.t - delta < riseStart) sfx.titanRise();
      const k = clamp((this.t - riseStart) / riseTime, 0, 1);
      const e = 1 - (1 - k) * (1 - k); // ease-out
      rig.root.position.y = -(rig.height + 0.4) * (1 - e);
      this.emberTimer -= delta;
      if (this.emberTimer <= 0 && k < 1) {
        this.emberTimer = 0.12;
        _v.set(rig.root.position.x + rand(-0.8, 0.8), 0.1, this.bossZ() + rand(-0.4, 0.4));
        emberBurst(_v, 8, true);
      }
    }

    // Name card + roar once it stands.
    const titleStart = klaxonTime + riseTime;
    if (this.t >= titleStart && this.t - delta < titleStart) {
      rig.root.position.y = 0;
      this.hud.showCard(
        this.def.name,
        [`stage ${ROMAN[app.campaignStage]} — ${this.def.epithet}`, this.def.taunt],
        this.accentCss(),
      );
      sfx.bossRoar(this.def.scale * 0.55);
    }

    // FIGHT flash, then the bell.
    const fightStart = titleStart + titleTime;
    if (this.t >= fightStart && this.t - delta < fightStart) {
      this.hud.showCard('FIGHT', [], '#ffc04d');
    }

    const skip = this.triggerDown();
    if (this.t >= fightStart + fightCardTime || skip) {
      rig.root.position.y = 0;
      this.startFight();
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
    match.phase = 'playing';
    this.hud.showCard('', []);
    this.light.intensity = 5; // steady key light (a skip can leave a strobe)
    startBattleMusic(); // the quiet background score, same as any bout
    announce('fight');
    sfx.roundBell();
  }

  // --- the fight --------------------------------------------------------------

  private fight(delta: number): void {
    this.invuln = Math.max(0, this.invuln - delta);
    if (this.runMode()) this.runClock += delta; // fights only — intros are free

    // Transient card (ENRAGED) auto-clears.
    if (this.cardTimer > 0) {
      this.cardTimer -= delta;
      if (this.cardTimer <= 0) this.hud.showCard('', []);
    }

    // The vented-core punish window.
    if (this.coreOpen > 0) {
      this.coreOpen -= delta;
      if (this.coreOpen <= 0) campaign.coreOpen = false;
    }

    this.updatePatches(delta);

    // Watch the health pools.
    const boss = fighterAt(1);
    const bossHp = boss?.getValue(Health, 'current') ?? 0;
    const bossMax = boss?.getValue(Health, 'max') ?? 1;
    const meHp = fighterAt(0)?.getValue(Health, 'current') ?? 0;
    if (bossHp < this.lastBossHp) {
      this.flinch = 0.35;
      this.hudTimer = 0; // instant bar update on damage
    }
    this.lastBossHp = bossHp;

    // GOLIATH's law: wound it deep enough and it stops playing fair.
    if (!this.enraged && this.def.enrageAt > 0 && bossHp > 0 && bossHp / bossMax <= this.def.enrageAt) {
      this.enraged = true;
      this.flinch = 0.35;
      this.hud.showCard('ENRAGED', [], this.accentCss());
      this.cardTimer = 1.3;
      sfx.bossRoar(this.def.scale * 0.9);
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

  // --- burning ground (JUGGERNAUT / GOLIATH) ---------------------------------

  private spawnPatch(x: number, z: number): void {
    const tg = circleTelegraph(CAMPAIGN.patchRadius);
    tg.group.position.set(x, 0.013, z);
    this.scene.add(tg.group);
    this.patches.push({ x, z, ttl: CAMPAIGN.patchTime, tg });
  }

  private updatePatches(delta: number): void {
    for (let i = this.patches.length - 1; i >= 0; i--) {
      const p = this.patches[i];
      p.ttl -= delta;
      if (p.ttl <= 0) {
        p.tg.dispose();
        this.patches.splice(i, 1);
        continue;
      }
      p.tg.update(1, this.time); // full fill = the fast red pulse
      if (this.invuln <= 0 && this.zoneTouchesPlayer({ kind: 'circle', x: p.x, z: p.z, r: CAMPAIGN.patchRadius })) {
        this.invuln = 0.7;
        this.damagePlayer(CAMPAIGN.attackDamage);
      }
    }
  }

  private clearPatches(): void {
    for (const p of this.patches) p.tg.dispose();
    this.patches = [];
  }

  /** Pick a weighted attack (avoiding an immediate repeat) and telegraph it. */
  private startAttack(): void {
    const kinds: AttackKind[] = ['slam', 'sweep', 'beam', 'barrage'];
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
    // Strike with the nearer arm. The root carries a π yaw, so arm 0
    // (local −X) hangs on the world +X side.
    const arm: 0 | 1 = _head.x < 0 ? 1 : 0;

    if (kind === 'slam') {
      const r = CAMPAIGN.slamRadius + this.def.scale * 0.04;
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
        tg.group.position.set(x, 0.014, z0);
        this.scene.add(tg.group);
        telegraphs.push(tg);
        staggers.push(i * (this.def.slamStyle === 'rehit' ? CAMPAIGN.rehitDelay : CAMPAIGN.marchDelay));
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
    } else {
      // Barrage: first shell on your feet, the rest scattered, landing in a
      // ripple — keep moving.
      for (let i = 0; i < this.def.barrageCount; i++) {
        const x = i === 0 ? clamp(_head.x, -0.7, 0.7) : rand(-OCTAGON_HALF_WIDTH + 0.2, OCTAGON_HALF_WIDTH - 0.2);
        const z = i === 0 ? clamp(_head.z, -0.55, 0.55) : rand(-OCTAGON_HALF_DEPTH + 0.15, OCTAGON_HALF_DEPTH - 0.15);
        zones.push({ kind: 'circle', x, z, r: CAMPAIGN.mortarRadius });
        const tg = circleTelegraph(CAMPAIGN.mortarRadius);
        tg.group.position.set(x, 0.014, z);
        this.scene.add(tg.group);
        telegraphs.push(tg);
        staggers.push(i * 0.28);
      }
      sfx.mortarThump(); // the launch thump from the pods
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
    };
    sfx.chargeWhine(chargeTime);
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
    tg.group.position.set(px + _v.x * 1.5, 0.014, pz + _v.z * 1.5);
    tg.group.rotation.y = Math.atan2(_v.x, _v.z); // local −Z → −dir
  }

  private advanceAttack(delta: number): void {
    const a = this.attack!;
    a.time += delta;

    // WIDOWMAKER's law: the beam strips FOLLOW you until the late lock —
    // dodging early just tells it where you were.
    if (a.tracks && a.time < a.chargeTime * CAMPAIGN.beamLockAt) {
      for (let i = 0; i < a.zones.length; i++) {
        const zone = a.zones[i];
        const tg = a.telegraphs[i];
        if (zone.kind === 'beam' && tg) this.aimBeam(zone, tg, a.beamOffsets[i] ?? 0);
      }
    }

    // Each zone runs its OWN countdown to its own detonation — a marching
    // drumline or a staggered barrage reads as a sequence of fills, not one.
    let allDone = true;
    for (let i = 0; i < a.zones.length; i++) {
      if (a.resolved[i]) continue;
      const dueAt = a.chargeTime + a.staggers[i];
      if (a.time >= dueAt) {
        a.resolved[i] = true;
        a.telegraphs[i]?.dispose();
        a.telegraphs[i] = null;
        this.detonate(a.kind, a.zones[i], i === 0);
      } else {
        a.telegraphs[i]?.update(clamp(a.time / dueAt, 0, 1), this.time);
        allDone = false;
      }
    }

    if (allDone && a.time >= a.chargeTime + (a.staggers[a.zones.length - 1] ?? 0) + 0.4) {
      // A finished melee pattern is the punish cue: the core vents AFTER the
      // last hit of the chain, never in the middle of it.
      if (a.kind === 'slam' || a.kind === 'sweep') this.openCore();
      this.attack = null;
      this.cooldown = rand(this.def.cooldownMin, this.def.cooldownMax) * (this.enraged ? CAMPAIGN.enrageCooldownMult : 1);
    }
  }

  /** A zone goes off: strike visual + sound, and damage if you're in it. */
  private detonate(kind: AttackKind, zone: Zone, first: boolean): void {
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
    } else {
      if (first || Math.random() < 0.6) sfx.mortarThump();
      if (zone.kind === 'circle') {
        this.spawnMortarBurst(zone.x, zone.z);
        // The fortress doctrine: every shell claims the ground it hit.
        if (this.def.burnPatches) this.spawnPatch(zone.x, zone.z);
      }
    }

    if (hit && this.invuln <= 0) {
      this.invuln = 0.7;
      this.damagePlayer(CAMPAIGN.attackDamage);
    }
  }

  /** Any of the player's three body spheres inside the zone? */
  private zoneTouchesPlayer(zone: Zone): boolean {
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
      } else {
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

  /** A melee swing always vents the core — the souls-like punish window. */
  private openCore(): void {
    this.coreOpen = this.def.coreOpenTime;
    if (!campaign.coreOpen) sfx.coreExposed();
    campaign.coreOpen = true;
  }

  // --- strike visuals ----------------------------------------------------------

  private spawnFistCrash(x: number, z: number): void {
    // A shadow gauntlet plunges out of the sky onto the marked disc.
    const s = this.def.scale;
    const fist = new Mesh(
      new CylinderGeometry(0.16 * s, 0.2 * s, 0.26 * s, 8),
      new MeshBasicMaterial({ color: this.def.accent, transparent: true, opacity: 0.85 }),
    );
    this.scene.add(fist);
    const startY = 2.6 + s * 0.4;
    const world = this.world;
    let burst = false;
    this.strikes.push({
      age: 0,
      life: 0.55,
      update(age) {
        const drop = Math.min(1, age / 0.12);
        fist.position.set(x, startY * (1 - drop * drop) + 0.12, z);
        if (drop >= 1 && !burst) {
          burst = true;
          _v.set(x, 0.1, z);
          spawnFireImpact(world, _v, 1);
          emberBurst(_v, 20, true);
        }
        (fist.material as MeshBasicMaterial).opacity = 0.85 * (1 - Math.max(0, (age - 0.25) / 0.3));
      },
      dispose() {
        fist.geometry.dispose();
        (fist.material as MeshBasicMaterial).dispose();
        fist.removeFromParent();
      },
    });
  }

  private spawnBladeSweep(y: number, arm: 0 | 1): void {
    // A white-hot bar scythes across the platform at the marked height.
    const bar = new Mesh(
      new CylinderGeometry(0.05, 0.05, OCTAGON_HALF_DEPTH * 2 + 0.6, 8),
      new MeshBasicMaterial({
        color: this.def.accent,
        transparent: true,
        opacity: 0.95,
        blending: AdditiveBlending,
        depthWrite: false,
      }),
    );
    bar.rotation.x = Math.PI / 2; // lie along Z
    this.scene.add(bar);
    const from = arm === 0 ? 1 : -1; // the striking arm's world side (see yaw)
    const span = OCTAGON_HALF_WIDTH + 0.6;
    this.strikes.push({
      age: 0,
      life: 0.3,
      update(age) {
        const k = Math.min(1, age / 0.22);
        bar.position.set(from * span * (1 - 2 * k), y, 0);
        (bar.material as MeshBasicMaterial).opacity = 0.95 * (1 - k * k);
      },
      dispose() {
        bar.geometry.dispose();
        (bar.material as MeshBasicMaterial).dispose();
        bar.removeFromParent();
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

  private spawnMortarBurst(x: number, z: number): void {
    // The shell drops fast out of the sky and bursts on the disc.
    const shell = glowSprite(this.def.accent, 0.34);
    this.scene.add(shell);
    const world = this.world;
    let burst = false;
    this.strikes.push({
      age: 0,
      life: 0.42,
      update(age) {
        const drop = Math.min(1, age / 0.14);
        shell.position.set(x, 3.4 * (1 - drop * drop) + 0.1, z);
        if (drop >= 1 && !burst) {
          burst = true;
          _v.set(x, 0.12, z);
          spawnFireImpact(world, _v, 1);
        }
        shell.material.opacity = drop >= 1 ? Math.max(0, 1 - (age - 0.14) / 0.28) : 1;
      },
      dispose() {
        shell.material.dispose();
        shell.removeFromParent();
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

    // Idle drift + hover bob (frozen mid-collapse). Enraged machines pace.
    if (fighting || this.phase === 'intro') {
      const swayRate = this.enraged ? 0.85 : 0.45;
      const sway = fighting ? Math.sin(this.time * swayRate) * this.def.swayAmp : 0;
      rig.root.position.x += (sway - rig.root.position.x) * Math.min(1, delta * 1.6);
      if (fighting) rig.root.position.y = Math.sin(this.time * 1.1) * 0.04 * this.def.scale;
    }

    // Flinch: the whole chassis rocks back when the core takes fire.
    this.flinch = Math.max(0, this.flinch - delta);
    rig.root.position.z = this.bossZ() + (this.flinch > 0 ? -0.18 * (this.flinch / 0.35) : 0);

    // The head tracks you (lookAt aims +Z; the visor lives on −Z, so flip).
    this.playerHead(_head);
    rig.head.lookAt(_head.x, _head.y, _head.z);
    rig.head.rotateY(Math.PI);

    // Visor heat: calm → blazing while a beam cooks; permanently furious
    // once enraged.
    const beamCharging = this.attack?.kind === 'beam' ? clamp(this.attack.time / this.attack.chargeTime, 0, 1) : 0;
    rig.visorMat.emissiveIntensity =
      1.8 + beamCharging * 3.2 + (this.enraged ? 1.6 + Math.sin(this.time * 10) * 0.6 : Math.sin(this.time * 3) * 0.2);

    // Core shutters: dim steel until it vents, then it blazes and breathes.
    const open = this.coreOpen > 0;
    rig.coreMat.emissiveIntensity = open ? 2.6 + Math.sin(this.time * 9) * 0.7 : 0.25;
    rig.core.scale.setScalar(open ? 1.12 + Math.sin(this.time * 9) * 0.06 : 1);

    // Pods glow while a barrage cooks.
    const barraging = this.attack?.kind === 'barrage';
    for (const mat of rig.podMats) {
      mat.emissiveIntensity += ((barraging ? 2.4 : 0.2) - mat.emissiveIntensity) * Math.min(1, delta * 6);
    }

    // Arms: wind up with the charge, whip through on the strike, ease home.
    const a = this.attack;
    for (const i of [0, 1] as const) {
      const arm = rig.arms[i];
      this.strikeSwing[i] = Math.max(0, this.strikeSwing[i] - delta);
      let targetX = arm.restX;
      let targetZ = arm.restZ;
      if (a && a.arm === i && (a.kind === 'slam' || a.kind === 'sweep')) {
        const fill = clamp(a.time / a.chargeTime, 0, 1);
        if (a.kind === 'slam') {
          targetX = arm.restX - 2.3 * fill; // raise the fist sky-high
        } else {
          targetZ = arm.restZ + (i === 0 ? -1 : 1) * 1.5 * fill; // wind out wide
          targetX = arm.restX - 0.5 * fill;
        }
      } else if (this.strikeSwing[i] > 0) {
        const k = this.strikeSwing[i] / 0.6;
        targetX = arm.restX + 1.1 * k; // followed through, down and across
        targetZ = arm.restZ * (1 - k);
      }
      const ease = Math.min(1, delta * (this.strikeSwing[i] > 0.45 ? 22 : 7));
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
    this.boxes.pods = [make(), make()];
    this.sizeHitboxes();
  }

  private sizeHitboxes(): void {
    const s = this.def.scale;
    this.boxes.body?.setValue(Hitbox, 'radius', 0.5 * s);
    this.boxes.pelvis?.setValue(Hitbox, 'radius', 0.3 * s);
    this.boxes.head?.setValue(Hitbox, 'radius', 0.21 * s);
    this.boxes.core?.setValue(Hitbox, 'radius', 0.17 * s);
    for (const pod of this.boxes.pods) pod.setValue(Hitbox, 'radius', 0.15 * s);
  }

  /** Glue the spheres to the rig and apply the weak-point law every frame. */
  private placeHitboxes(): void {
    const rig = this.rig;
    if (!rig || this.phase === 'idle') return;
    if (this.phase !== 'fight') {
      this.parkHitboxes();
      return;
    }
    const s = this.def.scale;
    const root = rig.root.position;

    rig.head.getWorldPosition(_v);
    this.boxes.head?.object3D?.position.copy(_v);
    this.boxes.head?.setValue(Hitbox, 'damageScale', CAMPAIGN.headScale);

    rig.core.getWorldPosition(_v);
    this.boxes.core?.object3D?.position.copy(_v);
    const coreScale = this.coreOpen > 0 ? CAMPAIGN.coreScale : 0;
    this.boxes.core?.setValue(Hitbox, 'damageScale', coreScale);

    this.boxes.body?.object3D?.position.set(root.x, root.y + 1.05 * s, root.z);
    this.boxes.body?.setValue(Hitbox, 'damageScale', 0);
    this.boxes.pelvis?.object3D?.position.set(root.x, root.y + 0.55 * s, root.z);
    this.boxes.pelvis?.setValue(Hitbox, 'damageScale', 0);

    const barraging = this.attack?.kind === 'barrage';
    this.boxes.pods.forEach((pod, i) => {
      const side = i === 0 ? -1 : 1;
      pod.object3D?.position.set(root.x + side * 0.37 * s, root.y + 1.44 * s, root.z);
      pod.setValue(Hitbox, 'damageScale', barraging ? CAMPAIGN.podScale : 0);
    });

    // Keep the aim assist on the current sweet spot.
    if (this.coreOpen > 0) rig.core.getWorldPosition(campaign.aimPoint);
    else rig.head.getWorldPosition(campaign.aimPoint);
  }

  private parkHitboxes(): void {
    for (const e of [this.boxes.body, this.boxes.pelvis, this.boxes.head, this.boxes.core, ...this.boxes.pods]) {
      e?.object3D?.position.set(0, -100, 0);
      e?.setValue(Hitbox, 'damageScale', 0);
    }
  }

  // --- endings -------------------------------------------------------------------

  private toVictory(): void {
    this.phase = 'victory';
    this.t = 0;
    match.phase = 'matchOver';
    this.attack?.telegraphs.forEach((t) => t?.dispose());
    this.attack = null;
    this.clearPatches();
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
      this.hud.showCard(
        'TITAN FELLED',
        [`clock ${fmtRunTime(this.runClock)}`, `next: ${BOSSES[app.campaignStage + 1].name}`],
        this.accentCss(),
      );
      sfx.roundEnd(true); // the full fanfare waits for the end of the run
      sfx.bossRoar(this.def.scale * 0.8);
      return;
    }

    if (run && lastStage) {
      // The run is complete: the clock goes on the board.
      const hardcore = app.campaignMode === 'hardcore';
      const record = recordRunTime(hardcore, this.runClock);
      const best = (hardcore ? campaignProgress.runTimesHardcore : campaignProgress.runTimesGauntlet)[0];
      this.payoutLines = [
        `time ${fmtRunTime(this.runClock)}`,
        record ? '★ NEW RECORD ★' : `best ${fmtRunTime(best)}`,
      ];
      if (!hardcore && !campaignProgress.hardcoreUnlocked) {
        campaignProgress.hardcoreUnlocked = true;
        saveCampaignProgress();
        this.payoutLines.push('HARDCORE UNLOCKED — no healing, no mercy');
      }
      this.hud.showCard(hardcore ? 'HARDCORE COMPLETE' : 'GAUNTLET COMPLETE', this.payoutLines, this.accentCss());
    } else {
      const mult = firstClear ? 2 : 1;
      this.payoutLines = [
        `+${CURRENCY.perGame * mult} COINS  ·  +${PROGRESSION.campaign * mult} XP`,
        firstClear ? 'FIRST FELL — DOUBLE PAYOUT' : 'already felled — standard payout',
      ];
      if (crowned) this.payoutLines.push('★ CHAMPION PLATFORM UNLOCKED ★');
      this.hud.showCard('TITAN FELLED', this.payoutLines, this.accentCss());
    }
    playVictory(); // stops the battle score and rings the end-of-game sting
    sfx.matchEnd(true);
    sfx.bossRoar(this.def.scale * 0.8); // the death bellow
  }

  private toDefeat(): void {
    this.phase = 'defeat';
    this.t = 0;
    match.phase = 'matchOver';
    this.attack?.telegraphs.forEach((t) => t?.dispose());
    this.attack = null;
    this.clearPatches();
    campaign.coreOpen = false;
    this.parkHitboxes();

    app.stats.losses += 1;
    saveStats();
    reportCampaign(false, false); // the consolation rate, same as a bot loss
    if (this.runMode()) {
      // A run dies where you do — no continues, back to the line-up.
      this.hud.showCard(
        'RUN OVER',
        [`felled ${app.campaignStage} of ${BOSSES.length}`, `clock ${fmtRunTime(this.runClock)}`],
        '#e8352a',
      );
    } else {
      this.hud.showCard(
        'SCRAPPED',
        ['the titan stands', `+${CURRENCY.perGame} coins · +${PROGRESSION.campaign} xp`],
        '#e8352a',
      );
    }
    playVictory(); // stops the battle score and rings the end sting
    sfx.matchEnd(false);
    sfx.bossRoar(this.def.scale); // it laughs, kind of
  }

  private outro(delta: number): void {
    const rig = this.rig!;
    if (this.phase === 'victory') {
      // Collapse: pitch forward (toward the player — the root carries a π
      // yaw, so positive X pitch tips the face down), sink, shed fire.
      const k = clamp(this.t / Math.min(3.2, this.victoryDelay), 0, 1);
      rig.root.rotation.x = 0.45 * k * k;
      rig.root.position.y = -rig.height * 0.55 * k * k;
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
    this.hud.updateBoards({
      stageLabel: `STAGE ${ROMAN[app.campaignStage]}`,
      bossName: this.def.name,
      accent: this.accentCss(),
      bossHp: boss?.getValue(Health, 'current') ?? 0,
      bossMax: boss?.getValue(Health, 'max') ?? 1,
      playerHp: me?.getValue(Health, 'current') ?? 0,
      playerMax: me?.getValue(Health, 'max') ?? 1,
      coreOpen: this.coreOpen > 0,
      hint: this.def.hint,
      timer: this.runMode() ? fmtRunTime(this.runClock) : '',
    });
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
