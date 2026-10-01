import { useEffect, useRef, useState } from 'react';
import type { Pt, SignKind } from '../core/types';
import { loadImage } from '../io';
import { uid, type Floor, type FloorOverlay } from '../model';
import { BRAND, drawOverlays, grow, inside, type Layers, type View } from './draw';

export type Tool = 'select' | 'scale' | 'crop' | 'exit' | 'stair' | 'wall' | 'erase' | 'sign';

interface Props {
  floor: Floor;
  overlay?: FloorOverlay;
  layers: Layers;
  tool: Tool;
  stairId: string;
  signKind: SignKind;
  brushMm: number;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onChange: (fn: (f: Floor) => Floor) => void;
  onScaleLine: (a: Pt, b: Pt) => void;
  onAcceptStair: (p: Pt) => void;
}

type Drag =
  | { kind: 'pan'; sx: number; sy: number; ox: number; oy: number }
  | { kind: 'move'; id: string; dx: number; dy: number; moved: boolean }
  | { kind: 'stroke'; mode: 'wall' | 'erase'; points: Pt[] }
  | { kind: 'crop'; a: Pt; b: Pt }
  | { kind: 'scale'; a: Pt; b: Pt };

const ICON = 26;

export function PlanCanvas(p: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [view, setView] = useState<View>({ scale: 1, ox: 0, oy: 0 });
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [drag, setDrag] = useState<Drag | null>(null);
  const [cursor, setCursor] = useState<Pt | null>(null);
  const [hoverSug, setHoverSug] = useState(-1);
  const fitted = useRef<string | null>(null);

  useEffect(() => {
    let live = true;
    loadImage(p.floor.src).then((i) => live && setImg(i));
    return () => { live = false; };
  }, [p.floor.src]);

  useEffect(() => {
    const el = wrap.current!;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Fit to the window when a new floor is shown.
  useEffect(() => {
    if (!img || fitted.current === p.floor.id || size.w < 10) return;
    fitted.current = p.floor.id;
    const s = Math.min(size.w / p.floor.width, size.h / p.floor.height) * 0.95;
    setView({ scale: s, ox: (size.w - p.floor.width * s) / 2, oy: (size.h - p.floor.height * s) / 2 });
  }, [img, p.floor.id, p.floor.width, p.floor.height, size]);

  const toSrc = (e: { clientX: number; clientY: number }): Pt => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left - view.ox) / view.scale, y: (e.clientY - r.top - view.oy) / view.scale };
  };

  // Draw.
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(size.w * dpr);
    c.height = Math.round(size.h * dpr);
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#e9e9ec';
    ctx.fillRect(0, 0, size.w, size.h);
    if (img) {
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.15)';
      ctx.shadowBlur = 12;
      ctx.fillStyle = '#fff';
      ctx.fillRect(view.ox, view.oy, p.floor.width * view.scale, p.floor.height * view.scale);
      ctx.restore();
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, view.ox, view.oy, p.floor.width * view.scale, p.floor.height * view.scale);
    }
    drawOverlays(ctx, p.floor, p.overlay, view, { layers: p.layers, selectedId: p.selectedId, iconSize: ICON, hoverSuggestion: hoverSug });
    const S = (q: Pt) => ({ x: q.x * view.scale + view.ox, y: q.y * view.scale + view.oy });
    // Wall edit strokes.
    if (p.layers.walls) {
      for (const [list, color] of [[p.floor.wallAdd, 'rgba(226,0,26,0.75)'], [p.floor.wallErase, 'rgba(0,140,255,0.45)']] as const) {
        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        for (const s of list) {
          ctx.lineWidth = Math.max(2, s.radius * 2 * view.scale);
          ctx.beginPath();
          s.points.forEach((q, i) => (i ? ctx.lineTo(S(q).x, S(q).y) : ctx.moveTo(S(q).x, S(q).y)));
          if (s.points.length === 1) ctx.lineTo(S(s.points[0]).x + 0.1, S(s.points[0]).y);
          ctx.stroke();
        }
        ctx.restore();
      }
    }
    if (drag?.kind === 'stroke') {
      ctx.save();
      ctx.strokeStyle = drag.mode === 'wall' ? 'rgba(226,0,26,0.75)' : 'rgba(0,140,255,0.45)';
      ctx.lineCap = 'round';
      ctx.lineWidth = Math.max(2, brushPx() * 2 * view.scale);
      ctx.beginPath();
      drag.points.forEach((q, i) => (i ? ctx.lineTo(S(q).x, S(q).y) : ctx.moveTo(S(q).x, S(q).y)));
      ctx.stroke();
      ctx.restore();
    }
    if (drag?.kind === 'crop') {
      const a = S(drag.a), b = S(drag.b);
      ctx.save();
      ctx.strokeStyle = BRAND.red;
      ctx.setLineDash([8, 5]);
      ctx.lineWidth = 2;
      ctx.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      ctx.restore();
    }
    if (drag?.kind === 'scale') {
      const a = S(drag.a), b = S(drag.b);
      ctx.save();
      ctx.strokeStyle = BRAND.red;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      for (const q of [a, b]) { ctx.beginPath(); ctx.arc(q.x, q.y, 4, 0, Math.PI * 2); ctx.fillStyle = BRAND.red; ctx.fill(); }
      ctx.restore();
    }
    if (cursor && (p.tool === 'wall' || p.tool === 'erase')) {
      const c2 = S(cursor);
      ctx.save();
      ctx.strokeStyle = p.tool === 'wall' ? BRAND.red : '#08f';
      ctx.beginPath();
      ctx.arc(c2.x, c2.y, Math.max(2, brushPx() * view.scale), 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  });

  const brushPx = () => (p.floor.mmPerPx ? p.brushMm / 2 / p.floor.mmPerPx : 4);

  const hit = (q: Pt): string | null => {
    const r = (ICON * 0.8) / view.scale;
    const d = (a: Pt) => Math.hypot(a.x - q.x, a.y - q.y);
    for (const s of [...p.floor.signs].reverse()) if (d(s.p) < r) return s.id;
    for (const e of p.floor.exits) if (d(e.p) < r * 0.7) return e.id;
    for (const s of p.floor.stairs) if (d(s.p) < r * 0.7) return s.id;
    return null;
  };

  const posOf = (id: string): Pt | null =>
    p.floor.signs.find((s) => s.id === id)?.p ?? p.floor.exits.find((s) => s.id === id)?.p ?? p.floor.stairs.find((s) => s.id === id)?.p ?? null;

  const onDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture(e.pointerId);
    const q = toSrc(e);
    if (e.button === 1 || e.button === 2 || e.shiftKey && p.tool === 'select') {
      setDrag({ kind: 'pan', sx: e.clientX, sy: e.clientY, ox: view.ox, oy: view.oy });
      return;
    }
    switch (p.tool) {
      case 'select': {
        const id = hit(q);
        if (id) {
          const at = posOf(id)!;
          p.onSelect(id);
          setDrag({ kind: 'move', id, dx: q.x - at.x, dy: q.y - at.y, moved: false });
        } else {
          const sg = p.overlay?.stairSuggestions.findIndex((s) => inside(q, s.box) && !p.floor.stairs.some((st) => inside(st.p, grow(s.box, Math.max(s.box.w, s.box.h) * 0.3)))) ?? -1;
          if (sg >= 0 && p.layers.markers) { p.onAcceptStair(p.overlay!.stairSuggestions[sg].center); return; }
          p.onSelect(null);
          setDrag({ kind: 'pan', sx: e.clientX, sy: e.clientY, ox: view.ox, oy: view.oy });
        }
        break;
      }
      case 'exit': {
        const id = uid('x');
        p.onChange((f) => ({ ...f, exits: [...f.exits, { id, p: q }] }));
        p.onSelect(id);
        break;
      }
      case 'stair': {
        const id = uid('s');
        p.onChange((f) => ({ ...f, stairs: [...f.stairs, { id, stairId: p.stairId, p: q }] }));
        p.onSelect(id);
        break;
      }
      case 'sign': {
        const id = uid('g');
        const kind = p.signKind;
        const travel = kind === 'left' ? Math.PI : kind === 'right' ? 0 : kind === 'exit' ? Math.PI / 2 : -Math.PI / 2;
        p.onChange((f) => ({
          ...f,
          signs: [...f.signs, { id, kind, p: q, travel, mount: kind === 'exit' ? 'door-head' : 'wall', reason: 'Added manually', flowM2: 0, manual: true }],
        }));
        p.onSelect(id);
        break;
      }
      case 'wall':
      case 'erase':
        setDrag({ kind: 'stroke', mode: p.tool, points: [q] });
        break;
      case 'crop':
        setDrag({ kind: 'crop', a: q, b: q });
        break;
      case 'scale':
        setDrag({ kind: 'scale', a: q, b: q });
        break;
    }
  };

  const onMove = (e: React.PointerEvent) => {
    const q = toSrc(e);
    setCursor(q);
    if (!drag) {
      if (p.tool === 'select' && p.overlay) setHoverSug(p.overlay.stairSuggestions.findIndex((s) => inside(q, s.box)));
      return;
    }
    if (drag.kind === 'pan') setView((v) => ({ ...v, ox: drag.ox + e.clientX - drag.sx, oy: drag.oy + e.clientY - drag.sy }));
    else if (drag.kind === 'move') {
      const np = { x: q.x - drag.dx, y: q.y - drag.dy };
      const id = drag.id;
      if (!drag.moved) setDrag({ ...drag, moved: true });
      p.onChange((f) => ({
        ...f,
        signs: f.signs.map((s) => (s.id === id ? { ...s, p: np, manual: true } : s)),
        exits: f.exits.map((s) => (s.id === id ? { ...s, p: np } : s)),
        stairs: f.stairs.map((s) => (s.id === id ? { ...s, p: np } : s)),
      }));
    } else if (drag.kind === 'stroke') setDrag({ ...drag, points: [...drag.points, q] });
    else if (drag.kind === 'crop' || drag.kind === 'scale') setDrag({ ...drag, b: q });
  };

  const onUp = () => {
    if (!drag) return;
    if (drag.kind === 'stroke') {
      const stroke = { points: drag.points, radius: brushPx() };
      p.onChange((f) => (drag.mode === 'wall' ? { ...f, wallAdd: [...f.wallAdd, stroke] } : { ...f, wallErase: [...f.wallErase, stroke] }));
    } else if (drag.kind === 'crop') {
      const x = Math.max(0, Math.min(drag.a.x, drag.b.x));
      const y = Math.max(0, Math.min(drag.a.y, drag.b.y));
      const w = Math.min(p.floor.width, Math.max(drag.a.x, drag.b.x)) - x;
      const h = Math.min(p.floor.height, Math.max(drag.a.y, drag.b.y)) - y;
      if (w > 20 && h > 20) p.onChange((f) => ({ ...f, crop: { x, y, w, h } }));
    } else if (drag.kind === 'scale') {
      if (Math.hypot(drag.b.x - drag.a.x, drag.b.y - drag.a.y) > 5) p.onScaleLine(drag.a, drag.b);
    }
    setDrag(null);
  };

  const onWheel = (e: React.WheelEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    const f = Math.exp(-e.deltaY * 0.0015);
    setView((v) => {
      const s = Math.min(20, Math.max(0.02, v.scale * f));
      const k = s / v.scale;
      return { scale: s, ox: mx - (mx - v.ox) * k, oy: my - (my - v.oy) * k };
    });
  };

  const fit = () => {
    const s = Math.min(size.w / p.floor.width, size.h / p.floor.height) * 0.95;
    setView({ scale: s, ox: (size.w - p.floor.width * s) / 2, oy: (size.h - p.floor.height * s) / 2 });
  };
  const zoom = (f: number) =>
    setView((v) => {
      const s = Math.min(20, Math.max(0.02, v.scale * f));
      const k = s / v.scale;
      return { scale: s, ox: size.w / 2 - (size.w / 2 - v.ox) * k, oy: size.h / 2 - (size.h / 2 - v.oy) * k };
    });

  const cursorStyle = drag?.kind === 'pan' ? 'grabbing' : p.tool === 'select' ? 'default' : p.tool === 'wall' || p.tool === 'erase' ? 'none' : 'crosshair';

  return (
    <div className="plan" ref={wrap}>
      <canvas
        ref={canvas}
        style={{ width: size.w, height: size.h, cursor: cursorStyle }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerLeave={() => setCursor(null)}
        onWheel={onWheel}
        onContextMenu={(e) => e.preventDefault()}
        data-testid="plan-canvas"
      />
      <div className="zoom">
        <button onClick={() => zoom(1.25)} title="Zoom in">+</button>
        <button onClick={() => zoom(0.8)} title="Zoom out">−</button>
        <button onClick={fit} title="Fit drawing">Fit</button>
      </div>
      {cursor && p.floor.mmPerPx && (
        <div className="coords">
          {((cursor.x * p.floor.mmPerPx) / 1000).toFixed(2)} m, {((cursor.y * p.floor.mmPerPx) / 1000).toFixed(2)} m
        </div>
      )}
    </div>
  );
}
