/**
 * Iron Balls Boxing tunables — the game is FIRE FIGHT: bare-knuckle boxing at
 * a distance with flaming iron balls. Numbers the gameplay feel depends on
 * live here so they are easy to find and adjust. Dimensions are in metres and
 * follow the Blaston "Play Space Dimensions" layout — two octagonal platforms
 * facing each other — pulled slightly CLOSER together for that in-your-face
 * boxing feel.
 *
 * The fantasy: two flaming iron balls orbit your fists while you hold the
 * triggers; you whip a punch to hurl one at your opponent, and a trigger pull
 * calls it roaring back to your hand.
 */

import type { Vector2Tuple } from 'three';

export const GAME_TITLE = 'FIRE FIGHT';

/**
 * Progression — the Bronze→Overlord ladder. XP is cumulative across every
 * mode (Aim Training, Quick/bot, Ranked) and only climbs; it sets the rank
 * badge (emblems in src/assets/ranks). A flat ~250-point ladder, Overlord at
 * 2000+. Skill rating (ELO) is separate and lives in the leaderboard.
 */
export const PROGRESSION = {
  // Tiers are paced in GAMES, not flat XP: an average real bout banks ~25 XP
  // (win 35 / loss 15), so the thresholds below land each rank at roughly —
  //   Silver 4 · Gold 15 · Plat 30 · Diamond 50 · Master 80
  //   Grandmaster 120 · Legendary 170 · Overlord 270   (games played)
  // Early ranks come quick; the climb stretches toward Overlord.
  tiers: [
    { name: 'BRONZE', xp: 0 },
    { name: 'SILVER', xp: 100 },
    { name: 'GOLD', xp: 375 },
    { name: 'PLATINUM', xp: 750 },
    { name: 'DIAMOND', xp: 1250 },
    { name: 'MASTER', xp: 2000 },
    { name: 'GRANDMASTER', xp: 3000 },
    { name: 'LEGENDARY', xp: 4250 },
    { name: 'OVERLORD', xp: 6750 },
  ],

  // A real 1v1: 25 to show up, +25 to win → 25 on a loss, 50 on a win.
  matchPlay: 25,
  matchWin: 25,
  // A completed Aim Training run banks a flat 25 (the run score still sets your
  // training-board best; it just doesn't scale the XP).
  trainingRun: 25,
  // Quick match vs the bot: a flat 25, win or lose.
  quickMatch: 25,
  // Arcade 2v2 / FFA: a flat 25 for taking part, win or lose.
  arcade: 25,
  // An ARCADE campaign titan bout: the same flat 25, win or lose — but the
  // FIRST time each titan is felled, XP and coins pay DOUBLE (see
  // net/leaderboard.ts reportCampaign).
  campaign: 25,
};

/**
 * The bolt-dollar currency — a riveted "$" earned at the SAME moments as XP
 * (every match, bot bout, arcade brawl and training run; see net/leaderboard).
 * A flat amount per completed game, win or loss, so the shop prices read as
 * round "games of play": a platform recolour or the GOLD RUSH premium pad
 * costs 10 games. The wallet itself lives in src/menu/wallet.ts (a
 * localStorage number shared by the arena and the pub, since both pages are
 * same-origin).
 */
export const CURRENCY = {
  /** Coins banked per completed game (any mode, win or loss). */
  perGame: 10,
};

/**
 * Where the IRON BALLS CLUB social area lives. It builds side by side with
 * the arena in this same app (see vite.config.ts rollup inputs: pub.html),
 * so the lobby button is one page hop away. Override with ?pub=<url>.
 */
export function pubUrl(): string {
  return new URLSearchParams(location.search).get('pub') ?? 'pub.html';
}

/**
 * The player's octagonal dodge box, same footprint as Blaston's play-space
 * diagram: overall ~1.72 m wide x 1.5 m deep, with a 0.75 m straight
 * front/back edge and ~0.6 m chamfered corners. Vertices are listed clockwise
 * in the floor plane (x = left/right, z = forward/back, -z faces the opponent).
 */
export const OCTAGON_HALF_WIDTH = 0.86; // 1.72 m / 2
export const OCTAGON_HALF_DEPTH = 0.75; // 1.5 m / 2
const EDGE_HALF = 0.375; // half of the 0.75 m straight edge
const CHAMFER = 0.375; // corner inset, giving ~0.6 m diagonal segments

/** Octagon outline (clockwise), centred on the player rig at the origin. */
export const OCTAGON_VERTICES: Vector2Tuple[] = [
  [-EDGE_HALF, -OCTAGON_HALF_DEPTH], // front-left
  [EDGE_HALF, -OCTAGON_HALF_DEPTH], // front-right
  [OCTAGON_HALF_WIDTH, -CHAMFER], // right-front chamfer
  [OCTAGON_HALF_WIDTH, CHAMFER], // right-back chamfer
  [EDGE_HALF, OCTAGON_HALF_DEPTH], // back-right
  [-EDGE_HALF, OCTAGON_HALF_DEPTH], // back-left
  [-OCTAGON_HALF_WIDTH, CHAMFER], // left-back chamfer
  [-OCTAGON_HALF_WIDTH, -CHAMFER], // left-front chamfer
];

/**
 * Distance between the two pads, centre to centre. Blaston sits around 3.8 m;
 * boxing wants you closer, so the gap is tightened — punches connect faster
 * and dodges get twitchier.
 */
export const ARENA_GAP = 3.0;

/**
 * The fireball — the whole game. Two per player, one bonded to each fist.
 *
 *  - Hold the trigger and the ball ORBITS your fist, roaring hot.
 *  - Release the trigger mid-punch and it FLIES along your swing.
 *  - Pull the trigger while it's away and it RETURNS to your hand.
 */
export const FIREBALL = {
  radius: 0.09, // iron core radius (also the collision radius)
  damage: 20, // damage per landed hit — five clean hits is a knockout
  headDamage: 25, // clean headshots hit harder

  // Orbit (trigger held): the ball circles the fist.
  orbitRadius: 0.17, // distance from the fist while orbiting
  orbitSpeedMin: 6.0, // rad/s when the orbit starts
  orbitSpeedMax: 13.0, // rad/s after fully spun up
  orbitSpinUp: 1.2, // seconds of trigger-hold to reach max orbit speed

  // Hover (idle): the ball floats just over your knuckles.
  hoverOffset: [0, 0.05, -0.09] as [number, number, number], // grip-local
  hoverLerp: 14, // exponential smoothing rate toward the hover anchor

  // Throw (trigger released during a punch).
  minPunchSpeed: 1.1, // hand speed (m/s) below which a release just hovers
  throwSpeedMin: 4.2, // slowest launch — readable and dodgeable, Blaston-style
  throwSpeedMax: 8.5, // a genuinely fast haymaker
  punchGain: 1.7, // hand speed → ball speed multiplier
  aimAssist: 0.4, // 0..1 blend of your swing direction toward the opponent
  gravity: 1.1, // gentle arc so throws feel thrown, not shot
  lifetime: 3.0, // seconds of flight before the ball dies out

  // Recall (trigger pulled while the ball is away).
  returnSpeed: 9.5, // homing speed back to the fist
  catchRadius: 0.16, // how close counts as "back in hand"
  nearHandRadius: 0.35, // trigger within this of the ball = orbit, not recall
  recallLockout: 0.5, // seconds a spent ball must cool before it can be recalled

  // Defence: an orbiting or returning ball of YOURS knocks an incoming
  // enemy ball out of the air on contact.
  deflectBonus: 0.05, // extra contact radius for the parry check
};

/**
 * Per-ball attachments (the BALL LOADOUT panel). Each of your two balls can
 * carry one. The effect fires the instant you RECALL a still-FLYING ball — a
 * dead ball on the floor returns plain — and lasts only until you catch it,
 * after which the ball is normal again. Grow/shrink scale with the recall
 * distance: the farther out the ball was when you pulled it back, the bigger
 * the swing, up to the caps below. Split is a fixed fan of three.
 */
export const ATTACH = {
  none: 0,
  split: 1,
  grow: 2,
  shrink: 3,
  /**
   * Recall distance (m) at which grow/shrink reach their FULL size/damage
   * swing — set FAR out (past how deep a ball usually survives) so the effect
   * ramps very gradually with travel. A normal recall (the ball near your
   * opponent, ~3 m) barely changes it; even a long throw well past your
   * opponent only gets part-way, and you need close to the longest possible
   * shot — the ball sailing deep toward the back cage — to approach the max.
   */
  fullRange: 14.0,
  growSize: 3.0, // up to triple size on a long recall
  shrinkSize: 1 / 3, // down to a third of the size on a long recall
  damageSwing: 10, // ±10 damage at full range
  splitCount: 3, // total balls a split becomes
  splitSize: 0.62, // each shard's size vs a normal ball
  splitSpread: 0.26, // lateral fan radius (m) mid-return
  splitSpreadRange: 1.4, // distance (m) over which the fan collapses to the hand
} as const;

/** Combat tuning: health pools shared by the IK body parts. */
export const COMBAT = {
  playerHealth: 100,
};

/**
 * The invisible cage around the whole arena: a wall ~10 yards (9.1 m) out
 * from each platform's rim on every side, plus a ceiling. A flying ball that
 * reaches it bursts against it and drops dead there — fire never sails off
 * into your real room forever.
 */
export const ARENA_BOUNDS = {
  halfWidth: OCTAGON_HALF_WIDTH + 9.1, // left/right of both platforms
  zBack: OCTAGON_HALF_DEPTH + 9.1, // behind YOUR platform (+z)
  zFront: -ARENA_GAP - OCTAGON_HALF_DEPTH - 9.1, // behind THEIR platform (−z)
  ceiling: 9.0,
};

/**
 * Head-driven IK body. The hitbox is not one sphere — it is a spine solved
 * each frame from the tracked head down to pinned hips, with three hitbox
 * spheres along it. Leaning/ducking the head swings the torso, so dodging is
 * a whole-body act. Radii in metres; `hipHeight` is the pinned pelvis height.
 */
export const BODY_IK = {
  hipHeight: 0.95,
  /** Fraction along hips→head where the chest sphere sits. */
  chestAlong: 0.55,
  /**
   * How far the spine hangs BEHIND the head along its yaw — your face sits
   * forward of your spine. Looking down you see the front of your chest,
   * not the base of your own neck, and the torso stops blocking your view
   * of the ball at your fists.
   */
  spineSetBack: 0.16,
  headRadius: 0.13,
  chestRadius: 0.2,
  pelvisRadius: 0.17,
};

/** The practice bot: an iron boxer that bobs, weaves and throws fireballs. */
export const BOT = {
  headY: 1.45, // relaxed head height
  headYMin: 1.0, // deepest duck
  headYMax: 1.62, // tallest stand
  padHalfWidth: 0.7, // lateral roaming range on its pad
  moveSpeed: 1.5, // m/s strafe
  duckSpeed: 2.0, // m/s vertical bob
  reactDistance: 1.5, // dodges your ball inside this range
  throwInterval: 2.3, // seconds between throws (alternates hands)
  windup: 0.7, // orbit/wind-up time before the ball leaves
  throwSpeed: 4.4, // a touch slower than yours → readable and dodgeable
  damage: 20, // every landed hit is 20, theirs included
  aimError: 0.16, // metres of aim slop at the target
  recallDelay: 1.4, // seconds after a throw before it recalls the ball
  headPitchMax: 0.32, // radians the head tilts up/down to track you — no owl-necking
  headTurnSpeed: 8, // how fast the head eases toward facing you
};

/**
 * ARCADE CAMPAIGN — the titan gauntlet. Five bosses, each bigger than the
 * last; they never throw fireballs. Instead they wind up melee and ranged
 * strikes whose kill zones charge up visibly ON YOUR PLATFORM — read the
 * floor, move, and punish the weak points that open up after their attacks.
 * Dark-souls pacing on a two-metre stage. Per-boss numbers (and each titan's
 * signature mechanic) live in campaign/bosses.ts.
 */
export const CAMPAIGN = {
  stages: 5,

  // Intro staging: klaxon + strobes, the titan rises, the title card, FIGHT.
  klaxonTime: 1.2, // warning strobes before anything moves
  riseTime: 2.6, // seconds the titan takes to surface
  titleTime: 2.4, // name card + roar hold
  fightCardTime: 0.9, // the FIGHT flash before the bell

  attackDamage: 20, // every landed titan strike is 20 — same law as fireballs
  victoryDelay: 8, // seconds of collapse + payout card before the line-up
  defeatDelay: 5, // seconds of SCRAPPED card before the line-up

  // Weak-point law (Hitbox.damageScale): armour clanks; whatever BLINKS is
  // live. Each titan opens its points its own way (BossDef.weakPattern):
  // both at once, alternating, two-hits-then-swap, or the three-point cycle
  // that ends in the low blow.
  headScale: 1.5,
  coreScale: 2.0,
  lowScale: 2.0, // the low blow — hard to hit, pays like the core
  podScale: 1.5,

  // GOLIATH's crown circuit: five stops (head → right shoulder → core →
  // left shoulder → low) walked this many full loops to kill. The health
  // bar steps down one notch per ring hit, so the count is exact whatever
  // the ball's damage.
  crownLoops: 3,
  // Each completed loop multiplies GOLIATH's attack cooldowns by this.
  crownHaste: 0.85,

  // The NOVA (GOLIATH only): fire floods the whole platform except one safe
  // wedge — run to the marked ground. Wedge half-width in radians (narrower
  // once enraged).
  novaRadius: 1.15,
  novaHalfAngle: 0.52,
  novaEnragedHalfAngle: 0.4,

  // Strike-zone geometry defaults (per-boss defs tune sizes/cadence).
  // Floor decals hover HERE, clear of the deck furniture — the rim glow bars
  // top out near 0.032 and the corner bolts near 0.035, so anything lower
  // reads as "under the platform" and the warning goes unseen.
  decalY: 0.05,
  slamRadius: 0.32, // tight discs — a slam threatens a spot, not half the pad
  slamImpactDelay: 0.14, // a breath of extra hang before the fist lands — a fairer dodge
  beamHalfWidth: 0.22,
  sweepThickness: 0.19, // half-height of the horizontal blade slice

  // Signature-mechanic tuning (which titans use which lives in bosses.ts).
  rehitDelay: 0.85, // seconds between a rehit slam's two detonations
  marchStep: 0.6, // metres between marching slam discs
  marchDelay: 0.55, // seconds between marching detonations — the drumbeat
  beamLockAt: 0.72, // tracking beams freeze at this charge fraction
  // The VOLLEY: shoulder pods spool up, then hurl fireballs straight at you
  // — the one titan attack you can BLOCK: put a fist in its path.
  volleySpeed: 4.2, // projectile speed (m/s) — roughly a one-second flight
  volleyInterval: 0.45, // seconds between shots in a volley
  volleyBlockRadius: 0.32, // a fist this close deflects the shot
  volleyHitRadius: 0.22, // shot core radius vs your body spheres
  enrageCooldownMult: 0.65, // enraged titans attack this much sooner…
  enrageChargeMult: 0.85, // …and charge that much faster

  // THE GAUNTLET RUN — all five back to back, unlocked once all are felled.
  // The clock only counts fight time, so intros/collapses cost you nothing.
  runIntro: { klaxon: 0.5, rise: 1.4, title: 1.3, fightCard: 0.6 },
  runVictoryDelay: 3.2, // collapse pause between bosses mid-run
  leaderboardSize: 5, // times kept per mode (gauntlet / hardcore)
};

/**
 * RAID — the four-player group campaign. Same five titans as the gauntlet but
 * built for a SQUAD: bigger, far tougher, attacks split across four platforms,
 * and GOLIATH does not stay down. The host runs the boss (attack picks, health,
 * weak-point pattern) and echoes state; every client renders every attack and
 * judges only the strikes aimed at ITS OWN platform.
 */
export const RAID = {
  /** Titan growth over the solo campaign versions. */
  scaleMult: 1.22,
  /** Boss health multiplier — "more than 4x": four raiders, and then some. */
  healthMult: 4.6,
  /**
   * Attack cadence multiplier PER STAGE, tuned to how many raiders each
   * swing marks: stage I rotates ONE target (so it swings fast to keep the
   * squad honest), stage II marks TWO, stage III+ mark EVERYONE — the pace
   * eases back toward solo, because now every raider dodges every swing.
   */
  cooldownMult: [0.62, 0.72, 0.9, 0.92, 0.88],
  /** Charge-time multiplier — slightly snappier telegraphs. */
  chargeMult: 0.92,
  /** Seconds between blade landings as a squad sweep cascades around the
   *  arc — one continuous spinning cut, platform after platform. */
  sweepCascade: 0.12,
  /** The titan's full-turn lash while a squad sweep detonates (rad/s). */
  sweepSpinRate: 11,
  /** A SQUAD volley is a BARRAGE: this many rounds of fire, one shot per
   *  marked raider each round — so a four-strong squad eats ~this×4 balls. */
  volleySquadRounds: 6,
  /** Rounds hammer out this fast in a squad barrage (shorter than the solo
   *  volley interval — it's a storm, not a metronome). */
  volleySquadInterval: 0.34,
  /** GOLIATH's crown ring stops take this many hits each in a raid (a squad
   *  shreds single-hit stops too fast). */
  crownPerStop: 2,
  /** The DECREE — GOLIATH's raid-only GROUP attack: novas bloom on EVERY
   *  platform at once around one shared canonical bearing, so the whole squad
   *  must rotate to the same compass point together. */
  decreeWeight: 4, // vs his other attacks once it unlocks
  decreeCharge: 2.4, // seconds — the longest windup in the game
  /** THE RESURRECTION (raid GOLIATH only) — beats in seconds:
   *  fallen still → a shake → he rises over `riseTime` while his health bar
   *  refills, timed so the fight resumes ON the drop of the bespoke track. */
  resStillTime: 3.0,
  resShakeTime: 1.4,
  resRiseTime: 6.0,
  /** Phase 2: the crown walked in REVERSE, this many loops, enrage locked on. */
  phase2Loops: 2,
  /** Host state-echo cadence (seconds). */
  stateEcho: 0.3,
};

/** Match format: best-of rounds, Blaston-style pacing. */
export const MATCH = {
  startDelay: 7, // quick-match pre-fight hold before the first live round
  roundTime: 60, // seconds per round
  winTarget: 3, // first to N round wins takes the match
  roundOverDelay: 5, // breather between rounds before the next round's countdown
  roundCountdown: 3, // the 3-2-1 that opens every round AFTER the first
  matchOverDelay: 6, // pause after the match before returning to the lobby
};

/** The visible platform slab under each boxer. */
export const PLATFORM = {
  thickness: 0.14, // slab depth below the floor line — reads as a pedestal
  rimLift: 0.012, // neon rim line height above the floor
};

/**
 * The rim barrier — your platform's guardian. Translucent walls fade in as
 * your head nears the rim; lean your head out past it and the fire of the
 * arena eats your health FAST. Stay on your platform.
 */
export const BOUNDARY = {
  wallHeight: 2.2, // barrier wall height above the platform — clears the head
  warnDistance: 0.3, // walls start glowing when the head is this close (m)
  drainPerSec: 38, // hp/s while your head is outside the rim
  graceDepth: 0.06, // head may poke this far past the rim before draining
};

/** Aim Training: pop-up targets across the gap; optionally they shoot back. */
export const TRAINING = {
  sessionTime: 90, // seconds per training run
  spawnInterval: 1.6, // base seconds between target pops (speeds up)
  minInterval: 0.75, // fastest spawn cadence at full ramp
  rampTime: 60, // seconds to ramp from base to fastest
  maxLive: 4, // most targets up at once
  holdTime: 2.6, // seconds a target stays up before retreating
  discRadius: 0.18, // bullseye disc hit radius
  cutoutRadius: 0.24, // humanoid cutout chest hit radius
  discPoints: 100,
  cutoutPoints: 150,
  streakBonus: 25, // extra points per current streak step
  // The OCTA DRONE: a small strafing gold octagon plate (pub octa-hunt style)
  // that only joins the mix in the closing stretch — lead the shot, bank big.
  bonusWindow: 30, // drones appear when this many seconds remain
  droneChance: 0.35, // spawn roll share once the window opens
  dronePoints: 300,
  droneRadius: 0.13, // small — a genuine skill shot
  droneHold: 2.2, // up for less time than the static targets
  droneDriftAmp: 0.55, // strafe half-range (m)
  droneDriftRate: 2.4, // strafe angular rate (rad/s)
  // Shoot-back: cutouts hurl a blue ball at you while they're up.
  shootChance: 0.55, // chance a cutout takes its shot
  shootDelay: 0.7, // aim time before it fires
  shotSpeed: 4.0,
  shotDamage: 20, // every landed hit is 20 — training regen softens it
  regenDelay: 2.5, // seconds after damage before training regen kicks in
  regenPerSec: 9, // training-only health regen
};

/** Networking. The relay server lives in /server (npm run server). */
export const NET = {
  poseRateHz: 30, // pose packets per second — denser input = smoother rival
  stateRateHz: 2, // host match-state echoes per second
  smoothing: 24, // exponential smoothing rate for the remote avatar
  /**
   * Convergence rate for a remote throw's launch-position correction: the
   * ball leaves from where OUR smoothed sim had it and eases onto the
   * sender's authoritative trajectory instead of teleporting (the smoothed
   * hand lags the real one by ~30 cm at full punch speed).
   */
  throwBlend: 9,
  /** ws:// URL — override with ?server=wss://host:port, else localStorage. */
  defaultPort: 8787,
};

/** Resolve the relay server URL: ?server= param > localStorage > same host. */
export function serverUrl(): string {
  const param = new URLSearchParams(location.search).get('server');
  if (param) return param;
  const stored = localStorage.getItem('ibb-server');
  if (stored) return stored;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.hostname}:${NET.defaultPort}`;
}

/**
 * Fire palette. YOUR fire burns orange; THEIR fire burns blue — instantly
 * readable in the heat of a duel.
 */
export const PALETTE = {
  ember: 0xff7a18, // your fire
  flame: 0xffc04d,
  whiteHot: 0xfff3cf,
  coolFlame: 0x4fb7ff, // their fire
  coolCore: 0x9fe2ff,
  venom: 0x57e389, // FFA third fighter — toxic green
  violet: 0xb06bff, // FFA fourth fighter — plasma violet
  danger: 0xe8352a,
  iron: 0x3a3d46,
  gunmetal: 0x2c2f36, // robot-wars chassis steel
  gunmetalDark: 0x1e2126,
  amber: 0xffb000, // industrial hazard amber
  charcoal: 0x191b22,
  white: 0xf4f6fb,
};

/**
 * Team → fire tint. 0 = you (orange), 1 = the classic blue rival. Arcade FFA
 * gives every fighter their own team, so teams 2 and 3 get distinct hues so
 * four boxers read apart at a glance; 2v2 only ever uses 0 (your team, orange)
 * and 1 (the enemy team, blue).
 */
export function teamColor(team: number): number {
  switch (team) {
    case 0:
      return PALETTE.ember; // you / your team — orange
    case 1:
      return PALETTE.coolFlame; // rival / enemy team — blue
    case 2:
      return PALETTE.venom; // FFA third fighter — green
    default:
      return PALETTE.violet; // FFA fourth fighter — violet
  }
}

/* ───────────────────────── ARCADE MODES ─────────────────────────────────
 * The lobby's ARCADE panel hosts three brawls that all share the duel's
 * fireball mechanics but differ in how many boxers stand in the pit and how
 * their platforms are laid out. Every mode is described by a ROSTER of
 * platform "slots" — slot 0 is ALWAYS the local player at the world origin
 * (the headset origin), facing -Z exactly like the classic 1v1. The remaining
 * slots are opponents/allies, each with a world position, a yaw so the fighter
 * faces the action, and a team id (0 = your team).
 *
 * Layouts:
 *  - '1v1'  : the original duel — you and one rival across the 3 m gap. The
 *             roster is bit-identical to the hand-built arena, so ranked /
 *             quick / private bouts play exactly as before.
 *  - '2v2'  : teammates SIDE BY SIDE, enemies directly across. The 1v1 gap is
 *             kept; the line is just widened — you + ally on the near side,
 *             two rivals on the far side, each pair facing off across the gap.
 *  - 'ffa'  : a four-way PLUS/CROSS. Your platform is one pinnacle; the other
 *             three sit N / E / W around a shared centre, everyone facing in.
 */

export type ArcadeMode = '1v1' | '2v2' | 'ffa' | 'raid';

/** Centre-to-centre spacing between same-side platforms in 2v2. */
export const TEAM_SPACING = 1.9;

/**
 * FFA plus arm length — distance from the cross centre out to each pinnacle.
 * Half the duel gap keeps the across-the-cross distance equal to the classic
 * 3 m duel; the four arms then sit ~2.1 m from each diagonal neighbour, tight
 * and chaotic — right for a brawl.
 */
export const FFA_ARM = ARENA_GAP / 2;

/** RAID arc seat bearings (radians about the boss anchor): a ~108° semicircle
 *  spread, symmetric, ~1.9 m between neighbouring platforms. */
const RAID_ARC_ANGLES = [-0.9424778, -0.31415927, 0.31415927, 0.9424778];

/** One platform's place in a mode's roster. */
export interface FighterSlot {
  /** Platform-centre world position. Slot 0 is the local player at the origin. */
  pos: [number, number, number];
  /** Yaw (radians about +Y, 0 = facing -Z) so the boxer faces the fight. */
  yaw: number;
  /** Team id — 0 is always your team. FFA gives every slot its own team. */
  team: number;
}

/**
 * Platform rosters per mode. Yaw values face each platform toward the action:
 * a rotation θ about +Y turns the default -Z forward into (-sinθ, 0, -cosθ),
 * so π faces +Z, +π/2 faces -X (east platform looks west into the cross) and
 * -π/2 faces +X (west platform looks east).
 */
export const MODE_LAYOUT: Record<ArcadeMode, FighterSlot[]> = {
  '1v1': [
    { pos: [0, 0, 0], yaw: 0, team: 0 }, // you
    { pos: [0, 0, -ARENA_GAP], yaw: Math.PI, team: 1 }, // rival, across the gap
  ],
  '2v2': [
    { pos: [0, 0, 0], yaw: 0, team: 0 }, // you
    { pos: [TEAM_SPACING, 0, 0], yaw: 0, team: 0 }, // ally beside you
    { pos: [0, 0, -ARENA_GAP], yaw: Math.PI, team: 1 }, // rival across from you
    { pos: [TEAM_SPACING, 0, -ARENA_GAP], yaw: Math.PI, team: 1 }, // rival across from ally
  ],
  ffa: [
    { pos: [0, 0, 0], yaw: 0, team: 0 }, // you — south pinnacle
    { pos: [0, 0, -2 * FFA_ARM], yaw: Math.PI, team: 1 }, // north, faces +Z
    { pos: [FFA_ARM, 0, -FFA_ARM], yaw: Math.PI / 2, team: 2 }, // east, faces -X
    { pos: [-FFA_ARM, 0, -FFA_ARM], yaw: -Math.PI / 2, team: 3 }, // west, faces +X
  ],
  // RAID: four platforms on a semicircular arc around the titan's pit — the
  // pit anchor sits at (0,0,-ARENA_GAP) and every seat stands ON A CIRCLE of
  // radius ARENA_GAP around it, yawed to face it. That geometry is the whole
  // trick: because each seat faces the anchor at the same distance, the titan
  // lands at (0, 0, -ARENA_GAP) in EVERY player's local frame — exactly where
  // the solo campaign puts it — so the entire boss-fight stack (telegraphs on
  // your platform, weak-point aim, dodge geometry) runs unchanged per client,
  // and only the OTHER raiders' attacks/platforms need seat transforms.
  raid: RAID_ARC_ANGLES.map((phi) => ({
    pos: [Math.sin(phi) * ARENA_GAP, 0, -ARENA_GAP + Math.cos(phi) * ARENA_GAP] as [number, number, number],
    yaw: phi,
    team: 0, // one squad — no friendly fire
  })),
};

/** RAID canonical boss anchor — the pit the arc curls around. */
export const RAID_BOSS_ANCHOR: [number, number, number] = [0, 0, -ARENA_GAP];

/** Opponent slots for a mode (everyone but the local player at slot 0). */
export function opponentSlots(mode: ArcadeMode): FighterSlot[] {
  return MODE_LAYOUT[mode].slice(1);
}

/** Every team id present in a mode, deduped (e.g. [0,1] for 2v2, [0,1,2,3] FFA). */
export function modeTeams(mode: ArcadeMode): number[] {
  return [...new Set(MODE_LAYOUT[mode].map((s) => s.team))];
}

/**
 * Map a hue (0..1 around the wheel) to a saturated glow colour for avatar
 * accents. Saturation/lightness are fixed to the ember vibe, so the default
 * hue (≈0.07) reproduces the classic orange — see DEFAULT_ACCENT_HUE.
 */
export function hueToColor(hue: number, light = 0.5): number {
  const h = (((hue % 1) + 1) % 1) * 6;
  const s = 1;
  // light 0..1 (0.5 = neutral) walks the neon's lightness from murky to bright.
  const l = Math.max(0.2, Math.min(0.9, 0.55 + (light - 0.5) * 0.6));
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs((h % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 1) { r = c; g = x; }
  else if (h < 2) { r = x; g = c; }
  else if (h < 3) { g = c; b = x; }
  else if (h < 4) { g = x; b = c; }
  else if (h < 5) { r = x; b = c; }
  else { r = c; b = x; }
  const R = Math.round((r + m) * 255);
  const G = Math.round((g + m) * 255);
  const B = Math.round((b + m) * 255);
  return (R << 16) | (G << 8) | B;
}
