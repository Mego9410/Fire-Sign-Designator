import type { StairSuggestion } from './types';

/**
 * Finds stair flights: patches of thin, parallel, evenly spaced lines (treads, ~200–350 mm apart).
 * Works on the "thin ink" mask that is left after the walls are taken out.
 */
export function detectStairs(
  thin: Uint8Array,
  footprint: Uint8Array,
  w: number,
  h: number,
  mmPerPx: number,
): StairSuggestion[] {
  const win = Math.max(8, Math.round(1200 / mmPerPx));
  const step = Math.max(2, Math.round(400 / mmPerPx));
  const minGap = 180 / mmPerPx;
  const maxGap = 380 / mmPerPx;
  const gw = Math.ceil(w / step);
  const gh = Math.ceil(h / step);
  const hit = new Uint8Array(gw * gh);
  const profile = new Int32Array(win);

  for (let gy = 0; gy * step + win <= h; gy++) {
    for (let gx = 0; gx * step + win <= w; gx++) {
      const x0 = gx * step;
      const y0 = gy * step;
      const cy = y0 + (win >> 1);
      const cx = x0 + (win >> 1);
      if (!footprint[cy * w + cx]) continue;
      if (isTreadPattern(thin, w, x0, y0, win, profile, true, minGap, maxGap) ||
          isTreadPattern(thin, w, x0, y0, win, profile, false, minGap, maxGap)) {
        hit[gy * gw + gx] = 1;
      }
    }
  }

  // Group nearby hit windows (both flights of a dog-leg stair) into one suggestion.
  const reach = Math.max(2, Math.ceil(1500 / mmPerPx / step));
  const seen = new Uint8Array(hit.length);
  const out: StairSuggestion[] = [];
  for (let i = 0; i < hit.length; i++) {
    if (!hit[i] || seen[i]) continue;
    const stack = [i];
    seen[i] = 1;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, n = 0;
    while (stack.length) {
      const p = stack.pop()!;
      n++;
      const x = p % gw;
      const y = (p - x) / gw;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      for (let dy = -reach; dy <= reach; dy++) {
        for (let dx = -reach; dx <= reach; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
          const q = ny * gw + nx;
          if (hit[q] && !seen[q]) { seen[q] = 1; stack.push(q); }
        }
      }
    }
    if (n < 2) continue;
    const box = { x: minX * step, y: minY * step, w: (maxX - minX) * step + win, h: (maxY - minY) * step + win };
    const areaM2 = (box.w * box.h * mmPerPx * mmPerPx) / 1e6;
    if (areaM2 < 2) continue;
    out.push({ box, center: { x: box.x + box.w / 2, y: box.y + box.h / 2 } });
  }
  return out;
}

function isTreadPattern(
  thin: Uint8Array,
  w: number,
  x0: number,
  y0: number,
  win: number,
  profile: Int32Array,
  vertical: boolean,
  minGap: number,
  maxGap: number,
): boolean {
  profile.fill(0);
  for (let j = 0; j < win; j++) {
    const row = (y0 + j) * w + x0;
    for (let i = 0; i < win; i++) {
      if (thin[row + i]) profile[vertical ? i : j]++;
    }
  }
  // Lines that run across most of the window.
  const need = win * 0.6;
  const centres: number[] = [];
  let start = -1;
  for (let i = 0; i <= win; i++) {
    const on = i < win && profile[i] >= need;
    if (on && start < 0) start = i;
    if (!on && start >= 0) {
      if (i - start <= Math.max(3, minGap * 0.4)) centres.push((start + i - 1) / 2);
      start = -1;
    }
  }
  if (centres.length < 4) return false;
  const gaps: number[] = [];
  for (let i = 1; i < centres.length; i++) gaps.push(centres[i] - centres[i - 1]);
  const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  if (mean < minGap || mean > maxGap) return false;
  const sd = Math.sqrt(gaps.reduce((a, g) => a + (g - mean) * (g - mean), 0) / gaps.length);
  return sd < mean * 0.2;
}
