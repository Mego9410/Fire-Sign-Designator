import { close, dilate, floodFromBorder, open, paintStrokes, removeSmall } from './raster';
import type { AnalysisSettings, Stroke } from './types';

export interface WallDetection {
  /** Thick ink: walls, columns, solid partitions. */
  walls: Uint8Array;
  /** Thin ink left after removing walls: text, dimensions, door swings, stair treads. */
  thin: Uint8Array;
  /** Inside of the building envelope. */
  footprint: Uint8Array;
}

export function detectWalls(
  gray: Uint8Array,
  w: number,
  h: number,
  mmPerPx: number,
  s: AnalysisSettings,
  wallAdd: Stroke[] = [],
  wallErase: Stroke[] = [],
): WallDetection {
  const dark = new Uint8Array(w * h);
  for (let i = 0; i < dark.length; i++) dark[i] = gray[i] < s.darkThreshold ? 1 : 0;

  let ink: Uint8Array = dark;
  if (s.fillHatchMm > 0) ink = close(dark, w, h, Math.max(1, Math.round(s.fillHatchMm / 2 / mmPerPx)));

  // A line T px thick has interior pixels at most floor((T + 1) / 2) from the background.
  const r = Math.max(1, Math.floor((Math.ceil(s.minWallThicknessMm / mmPerPx) + 1) / 2));
  const walls = open(ink, w, h, r);
  removeSmall(walls, w, h, (s.minWallAreaM2 * 1e6) / (mmPerPx * mmPerPx));
  paintStrokes(walls, w, h, wallAdd, 1);
  paintStrokes(walls, w, h, wallErase, 0);

  const near = dilate(walls, w, h, 1.5);
  const thin = new Uint8Array(w * h);
  for (let i = 0; i < thin.length; i++) thin[i] = dark[i] && !near[i] ? 1 : 0;

  const gapR = Math.max(1, Math.round(s.envelopeGapMm / 2 / mmPerPx));
  // Pad so that closing can bridge openings near the raster edge.
  const pad = gapR + 2;
  const pw = w + 2 * pad;
  const ph = h + 2 * pad;
  const padded = new Uint8Array(pw * ph);
  for (let y = 0; y < h; y++) padded.set(walls.subarray(y * w, y * w + w), (y + pad) * pw + pad);
  const closed = close(padded, pw, ph, gapR);
  const outside = floodFromBorder(closed, pw, ph);
  const footprint = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) footprint[y * w + x] = outside[(y + pad) * pw + x + pad] ? 0 : 1;
  }
  return { walls, thin, footprint };
}
