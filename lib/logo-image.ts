/**
 * Turn an image the server fetched into the row shape `company_logos` uses.
 *
 * The work happens here rather than on the server because the browser already
 * ships an image decoder and a WebP encoder, and `sharp` would be a new
 * dependency for a path used a handful of times. There is no CORS problem:
 * by the time these bytes arrive they came from our own origin, so the canvas
 * is not tainted.
 *
 * **These rules are a second copy of `ingest/logos.py`.** Two implementations
 * of one rule is the thing this codebase keeps getting caught by, so they are
 * spelled out identically and cross-referenced in both files. If you change
 * `BOX`, `MAX_URI` or `ink` in either, change it in the other — a hand-set
 * logo that obeys different rules from a scraped one is a logo that renders
 * differently for a reason nobody can see.
 */

/**
 * `ingest/logos.py:BOX_W` / `BOX_H` — the panel's own shape at 2x.
 *
 * A rectangle, not a square. Fitting the longest side into 96 spends the whole
 * budget on the width of a wordmark: PST's 800x360 logo came out 96x22 and was
 * then drawn at 48 CSS px tall, upscaled 4.4x on a 2x screen from an original
 * that was sharp. The panel renders `h-12 max-w-[200px]`, so 200x48 CSS is
 * 400x96 device pixels. Square marks are unchanged, because height still binds.
 */
export const BOX_W = 400;
export const BOX_H = 96;
/** `ingest/logos.py:MAX_URI`, and the check constraint on the column. */
export const MAX_URI = 40_000;
/** `ingest/logos.py:MIN_SIDE` — below this it is a bullet, not a mark. */
const MIN_SIDE = 24;
/** Bounds the working canvas. The output is 96px, so this loses nothing. */
const WORK_MAX = 1024;

export type Ink = 'light' | 'dark';

export type ProcessedLogo = {
  dataUri: string;
  ink: Ink;
  width: number | null;
  height: number | null;
};

const HEX = /#([0-9a-f]{3}|[0-9a-f]{6})\b/gi;
const NAMED_LIGHT = /\b(white|whitesmoke|ivory|snow)\b/i;

const lum = (r: number, g: number, b: number) =>
  (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

/**
 * Which way round the mark runs, so the tile behind it can follow.
 *
 * Mirrors `ingest/logos.py:ink`, including the reason for each branch: an
 * image with no transparency anywhere brings its own background, so it cannot
 * be the invisible-white-wordmark case however pale it averages.
 */
function inkFromSvg(svg: string): Ink {
  const lums: number[] = [];
  for (const m of svg.matchAll(HEX)) {
    const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
    lums.push(lum(parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16),
      parseInt(h.slice(4, 6), 16)));
  }
  if (!lums.length) return NAMED_LIGHT.test(svg) ? 'light' : 'dark';
  return lums.reduce((a, b) => a + b, 0) / lums.length > 0.62 ? 'light' : 'dark';
}

function inkFromPixels(d: Uint8ClampedArray): Ink {
  let minAlpha = 255;
  for (let i = 3; i < d.length; i += 4) if (d[i] < minAlpha) minAlpha = d[i];
  if (minAlpha > 240) return 'dark';

  let total = 0;
  let n = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] <= 32) continue;
    total += lum(d[i], d[i + 1], d[i + 2]);
    n += 1;
  }
  if (!n) return 'dark';
  return total / n > 0.72 ? 'light' : 'dark';
}

function load(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('That file could not be decoded as an image.'));
    img.src = src;
  });
}

/** The opaque bounds, so a mark exported with a wide transparent margin does
 *  not render as a speck in an empty box once it is scaled to fit. */
function alphaBounds(d: Uint8ClampedArray, w: number, h: number) {
  let x0 = w; let y0 = h; let x1 = -1; let y1 = -1;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (d[(y * w + x) * 4 + 3] <= 8) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

export async function processLogo(dataUri: string, contentType: string): Promise<ProcessedLogo> {
  // SVG goes through untouched, exactly as the pipeline stores it: it is
  // resolution-independent, so boxing it to 96px would only throw quality
  // away. Rendered through `<img src>` it is a passive image — script inside
  // it does not execute — which is why the panel must keep using `<img>`.
  if (contentType.includes('svg')) {
    if (dataUri.length > MAX_URI) {
      throw new Error('That SVG is too large to store — try a smaller one.');
    }
    const svg = atob(dataUri.split(',')[1] ?? '');
    return { dataUri, ink: inkFromSvg(svg), width: null, height: null };
  }

  const img = await load(dataUri);
  if (!img.naturalWidth || !img.naturalHeight) {
    throw new Error('That image has no size.');
  }

  const scale = Math.min(1, WORK_MAX / Math.max(img.naturalWidth, img.naturalHeight));
  const ww = Math.max(1, Math.round(img.naturalWidth * scale));
  const wh = Math.max(1, Math.round(img.naturalHeight * scale));

  const work = document.createElement('canvas');
  work.width = ww;
  work.height = wh;
  const wctx = work.getContext('2d', { willReadFrequently: true });
  if (!wctx) throw new Error('This browser would not give us a canvas.');
  wctx.drawImage(img, 0, 0, ww, wh);

  let crop = { x: 0, y: 0, w: ww, h: wh };
  const bounds = alphaBounds(wctx.getImageData(0, 0, ww, wh).data, ww, wh);
  if (bounds && bounds.w >= MIN_SIDE && bounds.h >= MIN_SIDE) crop = bounds;

  if (Math.min(crop.w, crop.h) < MIN_SIDE) {
    throw new Error(`That image is only ${crop.w}x${crop.h} — too small to be a logo.`);
  }

  // `thumbnail` semantics: fit inside the box, never enlarge.
  const fit = Math.min(1, BOX_W / crop.w, BOX_H / crop.h);
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(crop.w * fit));
  out.height = Math.max(1, Math.round(crop.h * fit));
  const octx = out.getContext('2d', { willReadFrequently: true });
  if (!octx) throw new Error('This browser would not give us a canvas.');
  octx.drawImage(work, crop.x, crop.y, crop.w, crop.h, 0, 0, out.width, out.height);

  const ink = inkFromPixels(octx.getImageData(0, 0, out.width, out.height).data);

  // WebP keeps the alpha channel and beats optimised PNG about 4:1 at this
  // size — the same choice and the same quality as the pipeline.
  let uri = out.toDataURL('image/webp', 0.8);
  if (!uri.startsWith('data:image/webp')) {
    // Safari below 14 has no WebP encoder and silently hands back a PNG.
    uri = out.toDataURL('image/png');
  }
  if (uri.length > MAX_URI) {
    throw new Error('That image is still too large after resizing — try a simpler one.');
  }
  return { dataUri: uri, ink, width: out.width, height: out.height };
}
