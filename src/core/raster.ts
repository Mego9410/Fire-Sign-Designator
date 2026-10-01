// Low-level raster helpers: binary masks are Uint8Array (0/1), row-major.

import type { Pt, Stroke } from './types';

const INF = 1e20;

function dt1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array) {
  let k = 0;
  v[0] = 0;
  z[0] = -INF;
  z[1] = INF;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const dq = q - v[k];
    d[q] = dq * dq + f[v[k]];
  }
}

/**
 * Exact squared Euclidean distance transform (Felzenszwalb & Huttenlocher).
 * Returns, for every pixel, the squared distance to the nearest pixel where mask == 1.
 */
export function edtSq(mask: Uint8Array, w: number, h: number): Float32Array {
  const out = new Float32Array(w * h);
  const n = Math.max(w, h);
  const f = new Float64Array(n);
  const d = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  const tmp = new Float64Array(w * h);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = mask[y * w + x] ? 0 : INF;
    dt1d(f, h, d, v, z);
    for (let y = 0; y < h; y++) tmp[y * w + x] = d[y];
  }
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) f[x] = tmp[row + x];
    dt1d(f, w, d, v, z);
    for (let x = 0; x < w; x++) out[row + x] = d[x];
  }
  return out;
}

export function invert(mask: Uint8Array): Uint8Array {
  const out = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) out[i] = mask[i] ? 0 : 1;
  return out;
}

export function dilate(mask: Uint8Array, w: number, h: number, r: number): Uint8Array {
  if (r <= 0) return mask.slice();
  const d = edtSq(mask, w, h);
  const r2 = r * r;
  const out = new Uint8Array(mask.length);
  for (let i = 0; i < out.length; i++) out[i] = d[i] <= r2 ? 1 : 0;
  return out;
}

export function erode(mask: Uint8Array, w: number, h: number, r: number): Uint8Array {
  if (r <= 0) return mask.slice();
  const d = edtSq(invert(mask), w, h);
  const r2 = r * r;
  const out = new Uint8Array(mask.length);
  for (let i = 0; i < out.length; i++) out[i] = mask[i] && d[i] >= r2 ? 1 : 0;
  return out;
}

export const open = (m: Uint8Array, w: number, h: number, r: number) => dilate(erode(m, w, h, r), w, h, r - 1);
export const close = (m: Uint8Array, w: number, h: number, r: number) => erode(dilate(m, w, h, r), w, h, r);

/** Removes 4-connected components smaller than minArea pixels (in place). */
export function removeSmall(mask: Uint8Array, w: number, h: number, minArea: number) {
  if (minArea <= 1) return;
  const seen = new Uint8Array(mask.length);
  const stack = new Int32Array(mask.length);
  const comp: number[] = [];
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i] || seen[i]) continue;
    comp.length = 0;
    let sp = 0;
    stack[sp++] = i;
    seen[i] = 1;
    while (sp > 0) {
      const p = stack[--sp];
      comp.push(p);
      const x = p % w;
      const y = (p - x) / w;
      if (x > 0 && mask[p - 1] && !seen[p - 1]) { seen[p - 1] = 1; stack[sp++] = p - 1; }
      if (x < w - 1 && mask[p + 1] && !seen[p + 1]) { seen[p + 1] = 1; stack[sp++] = p + 1; }
      if (y > 0 && mask[p - w] && !seen[p - w]) { seen[p - w] = 1; stack[sp++] = p - w; }
      if (y < h - 1 && mask[p + w] && !seen[p + w]) { seen[p + w] = 1; stack[sp++] = p + w; }
    }
    if (comp.length < minArea) for (const p of comp) mask[p] = 0;
  }
}

/** Flood fills pixels where mask == 0, starting from every border pixel. Returns 1 for reached pixels. */
export function floodFromBorder(mask: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(mask.length);
  const stack = new Int32Array(mask.length);
  let sp = 0;
  const push = (p: number) => {
    if (!mask[p] && !out[p]) { out[p] = 1; stack[sp++] = p; }
  };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  while (sp > 0) {
    const p = stack[--sp];
    const x = p % w;
    if (x > 0) push(p - 1);
    if (x < w - 1) push(p + 1);
    if (p >= w) push(p - w);
    if (p < (h - 1) * w) push(p + w);
  }
  return out;
}

/** Paints thick polylines into a mask with the given value. */
export function paintStrokes(mask: Uint8Array, w: number, h: number, strokes: Stroke[], value: 0 | 1) {
  for (const s of strokes) {
    const pts = s.points.length === 1 ? [s.points[0], s.points[0]] : s.points;
    for (let i = 0; i < pts.length - 1; i++) paintSegment(mask, w, h, pts[i], pts[i + 1], s.radius, value);
  }
}

function paintSegment(mask: Uint8Array, w: number, h: number, a: Pt, b: Pt, r: number, value: 0 | 1) {
  const x0 = Math.max(0, Math.floor(Math.min(a.x, b.x) - r));
  const x1 = Math.min(w - 1, Math.ceil(Math.max(a.x, b.x) + r));
  const y0 = Math.max(0, Math.floor(Math.min(a.y, b.y) - r));
  const y1 = Math.min(h - 1, Math.ceil(Math.max(a.y, b.y) + r));
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const r2 = r * r;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      let t = len2 > 0 ? ((x - a.x) * dx + (y - a.y) * dy) / len2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const ex = a.x + t * dx - x;
      const ey = a.y + t * dy - y;
      if (ex * ex + ey * ey <= r2) mask[y * w + x] = value;
    }
  }
}
