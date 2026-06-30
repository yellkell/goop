/**
 * Wall signage that prefers a real PNG but never depends on one.
 *
 * `buildSign` returns a plane showing a procedurally-drawn neon fallback
 * immediately, then tries to load the given image URL (e.g. the hand-made
 * IRON BALLS sign in public/signs/) and swaps it in if it loads. Drop the
 * art into public/signs/ and redeploy — no code change, the real sign just
 * appears. Transparent PNGs work as-is (the plane material is transparent).
 */

import {
  CanvasTexture,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  SRGBColorSpace,
  TextureLoader,
} from 'three';
import { stencilFont } from '../ui/industrial.js';

/** A neon IRON BALLS plate drawn on canvas — the stand-in until the PNG lands. */
function fallbackTexture(): CanvasTexture {
  const w = 1024;
  const h = 460;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;

  // Dark riveted backing plate (rounded), transparent margins around it.
  const px = 40;
  const py = 30;
  ctx.fillStyle = 'rgba(14,12,12,0.92)';
  ctx.strokeStyle = 'rgba(120,70,40,0.8)';
  ctx.lineWidth = 6;
  const r = 26;
  ctx.beginPath();
  ctx.moveTo(px + r, py);
  ctx.arcTo(w - px, py, w - px, h - py, r);
  ctx.arcTo(w - px, h - py, px, h - py, r);
  ctx.arcTo(px, h - py, px, py, r);
  ctx.arcTo(px, py, w - px, py, r);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // "IRON BALLS" — ember neon with an outer glow.
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = stencilFont(150);
  ctx.fillStyle = '#ffb37a';
  ctx.shadowColor = '#ff7a18';
  ctx.shadowBlur = 38;
  ctx.fillText('IRON BALLS', w / 2, 175);
  ctx.shadowBlur = 0;
  // Bright inner core.
  ctx.fillStyle = '#fff2e6';
  ctx.font = stencilFont(150);
  ctx.shadowColor = '#ff7a18';
  ctx.shadowBlur = 10;
  ctx.fillText('IRON BALLS', w / 2, 175);
  ctx.shadowBlur = 0;

  // Subtitle bar.
  ctx.font = '700 56px "Arial Narrow", system-ui, sans-serif';
  ctx.fillStyle = '#ffcf9a';
  ctx.shadowColor = '#ff7a18';
  ctx.shadowBlur = 18;
  ctx.fillText('BAR & FIGHT CLUB   ·   EST. 2026', w / 2, 340);
  ctx.shadowBlur = 0;

  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.minFilter = LinearFilter;
  return tex;
}

/** A sign plane: neon fallback now, real PNG swapped in once it loads. */
export function buildSign(url: string, wMeters: number, hMeters: number): Mesh {
  const mat = new MeshBasicMaterial({ map: fallbackTexture(), transparent: true });
  const mesh = new Mesh(new PlaneGeometry(wMeters, hMeters), mat);
  mesh.name = 'pub-sign';
  new TextureLoader().load(
    url,
    (tex) => {
      tex.colorSpace = SRGBColorSpace;
      tex.minFilter = LinearFilter;
      mat.map?.dispose();
      mat.map = tex;
      mat.needsUpdate = true;
      // Letterbox-fit the art inside the w×h box so it's never stretched,
      // whatever the image's aspect (the plane shrinks on one axis, centred).
      const img = tex.image as { width?: number; height?: number } | undefined;
      if (img?.width && img.height) {
        const imgAspect = img.width / img.height;
        const boxAspect = wMeters / hMeters;
        if (imgAspect > boxAspect) mesh.scale.y = boxAspect / imgAspect;
        else mesh.scale.x = imgAspect / boxAspect;
      }
    },
    undefined,
    () => {
      /* no PNG yet — keep the neon fallback */
    },
  );
  return mesh;
}

/**
 * A printed POSTER on the wall: a matte, LIT plane (not glowing signage like
 * buildSign) tinted down a touch so it sits back into the gloom instead of
 * shouting. `tilt` rolls it a few degrees for a hand-stuck-on wonky look. The
 * art letterbox-fits the w×h box (never stretched). Returns the mesh facing +z;
 * the caller orients it onto a wall (e.g. inside a Group rotated to face in).
 */
export function buildPoster(url: string, wMeters: number, hMeters: number, tilt = 0): Mesh {
  // Dark matte stand-in until the image loads — a missing file is just a dim
  // rectangle, never a bright blank.
  const mat = new MeshStandardMaterial({ color: 0x14141a, roughness: 0.95, metalness: 0 });
  const mesh = new Mesh(new PlaneGeometry(wMeters, hMeters), mat);
  mesh.name = 'pub-poster';
  mesh.rotation.z = tilt; // in-plane roll (the wonk) — applied before the wall facing
  new TextureLoader().load(
    url,
    (tex) => {
      tex.colorSpace = SRGBColorSpace;
      tex.minFilter = LinearFilter;
      mat.map = tex;
      mat.color.setHex(0xa8a8a8); // knock the print back so it doesn't stand out
      mat.needsUpdate = true;
      const img = tex.image as { width?: number; height?: number } | undefined;
      if (img?.width && img.height) {
        const imgAspect = img.width / img.height;
        const boxAspect = wMeters / hMeters;
        if (imgAspect > boxAspect) mesh.scale.y = boxAspect / imgAspect;
        else mesh.scale.x = imgAspect / boxAspect;
      }
    },
    undefined,
    () => {
      /* image not present — leave the dim plate */
    },
  );
  return mesh;
}
