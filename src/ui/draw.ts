import type { SignKind } from '../core/types';
import { orderedSigns, signLabel, type Floor, type FloorOverlay } from '../model';

export const BRAND = {
  red: '#E5101B',
  black: '#1A1712',
  green: '#00843d', // safety-sign green (ISO 3864)
  route: '#0a7d3e',
};

export interface Layers {
  walls: boolean;
  footprint: boolean;
  routes: boolean;
  signs: boolean;
  labels: boolean;
  markers: boolean;
}

export interface View {
  /** Screen px per source px. */
  scale: number;
  ox: number;
  oy: number;
}

/** Arrow direction as printed on the sign (radians, 0 = pointing right, screen coordinates). */
const ARROW_ANGLE: Record<SignKind, number> = {
  exit: Math.PI / 2,
  ahead: -Math.PI / 2,
  left: Math.PI,
  right: 0,
  'stair-down': (3 * Math.PI) / 4,
  'stair-up': (-3 * Math.PI) / 4,
};

/** Draws a fire-exit sign icon: green panel, white arrow, small running figure. */
export function drawSignIcon(ctx: CanvasRenderingContext2D, kind: SignKind, cx: number, cy: number, size: number) {
  const w = size * 1.5;
  const h = size;
  const x = cx - w / 2;
  const y = cy - h / 2;
  ctx.save();
  ctx.fillStyle = BRAND.green;
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = Math.max(1, size * 0.06);
  roundRect(ctx, x, y, w, h, size * 0.12);
  ctx.fill();
  ctx.stroke();
  // Running figure (simplified) on the left half.
  const fx = x + w * 0.3;
  const fy = cy;
  const u = size * 0.09;
  ctx.strokeStyle = '#fff';
  ctx.fillStyle = '#fff';
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(1, u * 0.9);
  ctx.beginPath();
  ctx.arc(fx + u * 0.9, fy - u * 3, u * 0.9, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(fx + u * 0.5, fy - u * 1.8);
  ctx.lineTo(fx - u * 0.3, fy + u * 0.8);
  ctx.moveTo(fx - u * 0.3, fy + u * 0.8);
  ctx.lineTo(fx + u * 1.3, fy + u * 1.8);
  ctx.lineTo(fx + u * 1.1, fy + u * 3.4);
  ctx.moveTo(fx - u * 0.3, fy + u * 0.8);
  ctx.lineTo(fx - u * 1.6, fy + u * 3.2);
  ctx.moveTo(fx - u * 1.8, fy - u * 0.6);
  ctx.lineTo(fx + u * 0.2, fy - u * 1.6);
  ctx.lineTo(fx + u * 1.8, fy - u * 0.4);
  ctx.stroke();
  // Arrow on the right half.
  drawArrow(ctx, x + w * 0.72, cy, size * 0.62, ARROW_ANGLE[kind], '#fff');
  ctx.restore();
}

export function drawArrow(ctx: CanvasRenderingContext2D, cx: number, cy: number, len: number, angle: number, color: string) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle);
  ctx.fillStyle = color;
  const l = len / 2;
  const t = len * 0.14;
  ctx.beginPath();
  ctx.moveTo(-l, -t);
  ctx.lineTo(l * 0.15, -t);
  ctx.lineTo(l * 0.15, -t * 2.6);
  ctx.lineTo(l, 0);
  ctx.lineTo(l * 0.15, t * 2.6);
  ctx.lineTo(l * 0.15, t);
  ctx.lineTo(-l, t);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export interface SceneOptions {
  layers: Layers;
  selectedId?: string | null;
  /** On-screen icon size in px. */
  iconSize: number;
  hoverSuggestion?: number;
}

/** Draws overlays in screen space (the plan image itself is drawn by the caller). */
export function drawOverlays(ctx: CanvasRenderingContext2D, floor: Floor, overlay: FloorOverlay | undefined, view: View, o: SceneOptions) {
  const S = (p: { x: number; y: number }) => ({ x: p.x * view.scale + view.ox, y: p.y * view.scale + view.oy });
  const { layers } = o;

  if (overlay) {
    const { crop } = overlay;
    const sx = crop.x * view.scale + view.ox;
    const sy = crop.y * view.scale + view.oy;
    const sw = crop.w * view.scale;
    const sh = crop.h * view.scale;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    if (layers.footprint) ctx.drawImage(overlay.footprint, sx, sy, sw, sh);
    if (layers.walls) ctx.drawImage(overlay.walls, sx, sy, sw, sh);
    ctx.restore();

    if (layers.routes) {
      ctx.save();
      ctx.strokeStyle = BRAND.route;
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = Math.max(1.5, o.iconSize * 0.12);
      ctx.setLineDash([o.iconSize * 0.4, o.iconSize * 0.25]);
      ctx.lineJoin = 'round';
      for (const r of overlay.routes) {
        ctx.beginPath();
        r.forEach((p, i) => {
          const s = S(p);
          if (i) ctx.lineTo(s.x, s.y);
          else ctx.moveTo(s.x, s.y);
        });
        ctx.stroke();
      }
      ctx.restore();
    }

    if (layers.markers) {
      overlay.stairSuggestions.forEach((sg, i) => {
        if (floor.stairs.some((s) => inside(s.p, grow(sg.box, Math.max(sg.box.w, sg.box.h) * 0.3)))) return;
        const a = S(sg.box);
        ctx.save();
        ctx.setLineDash([6, 4]);
        ctx.strokeStyle = BRAND.red;
        ctx.lineWidth = o.hoverSuggestion === i ? 3 : 1.5;
        ctx.strokeRect(a.x, a.y, sg.box.w * view.scale, sg.box.h * view.scale);
        ctx.setLineDash([]);
        label(ctx, 'Stair? Click to add', a.x + 4, a.y - 6, BRAND.red);
        ctx.restore();
      });
    }
  }

  if (floor.crop) {
    const a = S(floor.crop);
    ctx.save();
    ctx.strokeStyle = BRAND.black;
    ctx.setLineDash([10, 6]);
    ctx.lineWidth = 1.5;
    ctx.strokeRect(a.x, a.y, floor.crop.w * view.scale, floor.crop.h * view.scale);
    ctx.restore();
  }

  if (layers.markers) {
    for (const e of floor.exits) {
      const s = S(e.p);
      marker(ctx, s.x, s.y, o.iconSize * 0.75, BRAND.green, 'EXIT', e.id === o.selectedId);
    }
    for (const st of floor.stairs) {
      const s = S(st.p);
      marker(ctx, s.x, s.y, o.iconSize * 0.75, BRAND.black, `ST ${st.stairId}`, st.id === o.selectedId);
    }
  }

  if (layers.signs) {
    const ordered = orderedSigns(floor);
    ordered.forEach((sg, i) => {
      const s = S(sg.p);
      const sel = sg.id === o.selectedId;
      // Travel direction on plan.
      ctx.save();
      ctx.strokeStyle = BRAND.green;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      const L = o.iconSize * 1.3;
      ctx.lineTo(s.x + Math.cos(sg.travel) * L, s.y + Math.sin(sg.travel) * L);
      ctx.stroke();
      drawArrow(ctx, s.x + Math.cos(sg.travel) * L, s.y + Math.sin(sg.travel) * L, o.iconSize * 0.5, sg.travel, BRAND.green);
      ctx.restore();
      if (sel) {
        ctx.save();
        ctx.strokeStyle = BRAND.red;
        ctx.lineWidth = 3;
        ctx.strokeRect(s.x - o.iconSize * 0.9, s.y - o.iconSize * 0.62, o.iconSize * 1.8, o.iconSize * 1.24);
        ctx.restore();
      }
      drawSignIcon(ctx, sg.kind, s.x, s.y, o.iconSize);
      if (layers.labels) label(ctx, signLabel(floor, i) + (sg.manual ? '*' : ''), s.x + o.iconSize * 0.85, s.y - o.iconSize * 0.45, BRAND.black);
    });
  }
}

function marker(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, text: string, selected: boolean) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r * 0.55, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = selected ? 4 : 2;
  ctx.strokeStyle = selected ? BRAND.red : '#fff';
  ctx.stroke();
  ctx.restore();
  label(ctx, text, x + r * 0.7, y + r * 0.2, color);
}

function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string) {
  ctx.save();
  ctx.font = '600 12px Archivo, "Helvetica Neue", Arial, sans-serif';
  const m = ctx.measureText(text);
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.fillRect(x - 3, y - 11, m.width + 6, 15);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  ctx.restore();
}

export const grow = (r: { x: number; y: number; w: number; h: number }, d: number) => ({ x: r.x - d, y: r.y - d, w: r.w + 2 * d, h: r.h + 2 * d });

export const inside = (p: { x: number; y: number }, r: { x: number; y: number; w: number; h: number }) =>
  p.x >= r.x && p.y >= r.y && p.x <= r.x + r.w && p.y <= r.y + r.h;
