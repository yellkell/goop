/**
 * Spawners for transient visual effects: fiery impact bursts (flash +
 * shockwave + glowing ember chunks + a spray of spark particles). Cheap,
 * self-destructing entities the FXSystem animates.
 */

import {
  CanvasTexture,
  Color,
  IcosahedronGeometry,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Vector3,
  type World,
} from '@iwsdk/core';
import { Effect, EffectKind } from '../components/Effect.js';
import { glowSprite } from '../materials/glow.js';
import { emberBurst } from './fire.js';
import { teamColor } from '../config.js';

const SHARD_GEO = new IcosahedronGeometry(0.025, 0);
const POPUP_GEO = new PlaneGeometry(0.26, 0.13);

/** "20" etc. rendered once per distinct damage value, then reused. */
const popupTextures = new Map<number, CanvasTexture>();

function damageTexture(dmg: number): CanvasTexture {
  let tex = popupTextures.get(dmg);
  if (tex) return tex;
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `900 96px 'Arial Black', system-ui, sans-serif`;
  ctx.lineWidth = 14;
  ctx.strokeStyle = 'rgba(10,11,14,0.95)';
  ctx.strokeText(String(dmg), 128, 68);
  ctx.fillStyle = '#ff1605';
  ctx.shadowColor = 'rgba(255,30,10,1)';
  ctx.shadowBlur = 22;
  ctx.fillText(String(dmg), 128, 68);
  tex = new CanvasTexture(canvas);
  tex.minFilter = LinearFilter;
  popupTextures.set(dmg, tex);
  return tex;
}

/** A little red damage number that pops at the impact, rises and fades. */
export function spawnDamagePopup(world: World, pos: Vector3, dmg: number): void {
  const mesh = new Mesh(
    POPUP_GEO,
    new MeshBasicMaterial({
      map: damageTexture(dmg),
      transparent: true,
      depthTest: false, // reads through the avatar it just hit
      depthWrite: false,
    }),
  );
  mesh.renderOrder = 60;
  const e = world.createTransformEntity(mesh);
  e.object3D!.position.copy(pos);
  e.object3D!.position.y += 0.1;
  e.addComponent(Effect, { kind: EffectKind.Popup, life: 0.9, baseScale: 1 });
}

/**
 * A fiery burst where a ball lands, is parried, or burns out. `scale` grows
 * the whole event (flash, ring, sparks, shard count) — body hits on the
 * player use ~1.7 so taking a hit FEELS like taking a hit.
 */
export function spawnFireImpact(world: World, pos: Vector3, team: number, scale = 1): void {
  const color = teamColor(team);
  const cool = team === 1;

  // Bright central pop.
  const flash = glowSprite(color, 0.5);
  const fe = world.createTransformEntity(flash);
  fe.object3D!.position.copy(pos);
  fe.addComponent(Effect, { kind: EffectKind.Flash, life: 0.16, baseScale: 0.5 * scale });

  // Expanding shockwave.
  const ring = glowSprite(0xfff3cf, 0.3, 0.8);
  const re = world.createTransformEntity(ring);
  re.object3D!.position.copy(pos);
  re.addComponent(Effect, { kind: EffectKind.Ring, life: 0.35, baseScale: 0.3 * scale });

  // Spark spray from the shared ember pool.
  emberBurst(pos, Math.round(16 * scale), cool);

  // A few glowing ember chunks that pop and tumble outward.
  const tint = new Color(color);
  for (let i = 0; i < Math.round(6 * scale); i++) {
    const mat = new MeshStandardMaterial({
      color: 0x1a1208,
      emissive: tint,
      emissiveIntensity: 1.4,
      transparent: true,
      roughness: 0.6,
    });
    const shard = new Mesh(SHARD_GEO, mat);
    const e = world.createTransformEntity(shard);
    e.object3D!.position.copy(pos);
    const dir = new Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
    const speed = 1.4 + Math.random() * 1.8;
    e.addComponent(Effect, {
      kind: EffectKind.Shard,
      life: 0.5 + Math.random() * 0.35,
      baseScale: 0.7 + Math.random() * 0.8,
      velocity: [dir.x * speed, dir.y * speed + 0.6, dir.z * speed],
      spin: (Math.random() - 0.5) * 12,
    });
  }
}
