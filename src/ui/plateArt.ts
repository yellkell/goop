/**
 * Shared helper for drawing the neon-metal art plates (the countdown
 * 3/2/1/FIGHT PNGs) at a consistent VISIBLE size. Each PNG carries a lot of
 * transparent padding, so we measure the opaque content box once per image and
 * size by the WORD/digit — not the padded frame — so the art reads the same
 * whatever canvas it lands on (the match scoreboard AND the campaign HUD).
 */

interface ContentBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

const contentBoxCache = new WeakMap<HTMLImageElement, ContentBox>();

/** Opaque-content bounding box of a decoded plate, in image pixels — measured
 *  once (the art sits inside a lot of transparent padding). Cached. */
export function contentBox(img: HTMLImageElement): ContentBox {
  const cached = contentBoxCache.get(img);
  if (cached) return cached;
  const iw = img.naturalWidth;
  const ih = img.naturalHeight;
  let box: ContentBox = { x: 0, y: 0, w: iw, h: ih };
  const c = document.createElement('canvas');
  c.width = iw;
  c.height = ih;
  const cx = c.getContext('2d');
  if (cx) {
    cx.drawImage(img, 0, 0);
    const data = cx.getImageData(0, 0, iw, ih).data;
    let minX = iw,
      minY = ih,
      maxX = -1,
      maxY = -1;
    for (let y = 0; y < ih; y++) {
      for (let x = 0; x < iw; x++) {
        if (data[(y * iw + x) * 4 + 3] > 16) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX >= minX && maxY >= minY) box = { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
  }
  contentBoxCache.set(img, box);
  return box;
}

/**
 * Draw an art plate centred on a `cw`×`ch` canvas, sized so its VISIBLE glyph
 * (not the padded frame) is `targetH` tall — but never larger than the canvas'
 * safe area (`margin` inset), so the whole glyph always stays on screen.
 */
export function drawContentPlate(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  cw: number,
  ch: number,
  targetH: number,
  margin: number,
): void {
  const box = contentBox(img);
  let scale = targetH / box.h;
  const maxW = cw - 2 * margin;
  const maxH = ch - 2 * margin;
  if (box.w * scale > maxW) scale = maxW / box.w;
  if (box.h * scale > maxH) scale = maxH / box.h;
  const bx = (box.x + box.w / 2) * scale;
  const by = (box.y + box.h / 2) * scale;
  ctx.drawImage(img, cw / 2 - bx, ch / 2 - by, img.naturalWidth * scale, img.naturalHeight * scale);
}
