// A synthetic two-storey office plan used for the in-app example and the tests.
// All dimensions are millimetres from the top-left of the sheet.

export type Prim =
  | { t: 'rect'; x: number; y: number; w: number; h: number }
  | { t: 'line'; ax: number; ay: number; bx: number; by: number }
  | { t: 'arc'; cx: number; cy: number; r: number; a0: number; a1: number }
  | { t: 'text'; x: number; y: number; text: string; size: number };

export interface DemoFloor {
  name: string;
  level: number;
  prims: Prim[];
  exits: { x: number; y: number }[];
  stairs: { stairId: string; x: number; y: number }[];
}

export const DEMO_SHEET = { widthMm: 32000, heightMm: 20000 };
const O = 1000; // sheet margin
const EXT = 300;
const INT = 120;

function wallH(prims: Prim[], y: number, x1: number, x2: number, t: number, openings: [number, number][] = [], swing: 1 | -1 = 1) {
  let x = x1;
  for (const [a, b] of [...openings].sort((p, q) => p[0] - q[0])) {
    if (a > x) prims.push({ t: 'rect', x: O + x, y: O + y, w: a - x, h: t });
    door(prims, O + a, O + y + (swing > 0 ? t : 0), b - a, 'h', swing);
    x = b;
  }
  if (x2 > x) prims.push({ t: 'rect', x: O + x, y: O + y, w: x2 - x, h: t });
}

function wallV(prims: Prim[], x: number, y1: number, y2: number, t: number, openings: [number, number][] = [], swing: 1 | -1 = 1) {
  let y = y1;
  for (const [a, b] of [...openings].sort((p, q) => p[0] - q[0])) {
    if (a > y) prims.push({ t: 'rect', x: O + x, y: O + y, w: t, h: a - y });
    door(prims, O + x + (swing > 0 ? t : 0), O + a, b - a, 'v', swing);
    y = b;
  }
  if (y2 > y) prims.push({ t: 'rect', x: O + x, y: O + y, w: t, h: y2 - y });
}

/** Door leaf drawn open at 90° plus its swing arc (thin lines, like a real plan). */
function door(prims: Prim[], x: number, y: number, width: number, dir: 'h' | 'v', swing: 1 | -1) {
  if (dir === 'h') {
    prims.push({ t: 'line', ax: x, ay: y, bx: x, by: y + swing * width });
    prims.push({ t: 'arc', cx: x, cy: y, r: width, a0: swing > 0 ? 0 : -Math.PI / 2, a1: swing > 0 ? Math.PI / 2 : 0 });
  } else {
    prims.push({ t: 'line', ax: x, ay: y, bx: x + swing * width, by: y });
    prims.push({ t: 'arc', cx: x, cy: y, r: width, a0: swing > 0 ? 0 : Math.PI / 2, a1: swing > 0 ? Math.PI / 2 : Math.PI });
  }
}

function stairFlight(prims: Prim[], x: number, y1: number, y2: number, width: number) {
  prims.push({ t: 'line', ax: O + x, ay: O + y1, bx: O + x, by: O + y2 });
  prims.push({ t: 'line', ax: O + x + width, ay: O + y1, bx: O + x + width, by: O + y2 });
  for (let y = y1; y <= y2 + 1; y += 275) prims.push({ t: 'line', ax: O + x, ay: O + y, bx: O + x + width, by: O + y });
}

function shell(prims: Prim[], ground: boolean) {
  const W = 30000, H = 18000;
  // External envelope.
  wallH(prims, 0, 0, W, EXT);
  wallH(prims, H - EXT, 0, W, EXT, ground ? [[12300, 13500]] : [], -1);
  wallV(prims, 0, 0, H, EXT);
  wallV(prims, W - EXT, 0, H, EXT);
  // Main corridor (y 8000–9800).
  wallH(prims, 8000 - INT, EXT, 25000, INT, [[5800, 6700], [13800, 14700], [21800, 22700]], -1);
  wallH(prims, 9800, EXT, W - EXT, INT, ground ? [[9000, 9900], [12000, 13800], [20000, 20900], [26000, 26900]] : [[9000, 9900], [20000, 20900], [26000, 26900]]);
  // Partitions between north offices.
  wallV(prims, 8000, EXT, 8000 - INT, INT);
  wallV(prims, 16000, EXT, 8000 - INT, INT);
  // Stair core (north-east).
  wallV(prims, 25000, EXT, 8000, INT);
  wallH(prims, 8000 - INT, 25000, W - EXT, INT, [[26900, 27900]], -1);
  stairFlight(prims, 25500, 1300, 5400, 1300);
  stairFlight(prims, 28000, 1300, 5400, 1300);
  prims.push({ t: 'line', ax: O + 26800, ay: O + 1300, bx: O + 26800, by: O + 5400 });
  if (ground) {
    // Escape corridor to the street (x 12000–13800).
    wallV(prims, 12000 - INT, 9800, H - EXT, INT, [[15000, 15900]], -1);
    wallV(prims, 13800, 9800, H - EXT, INT, [[11000, 11900]]);
  } else {
    wallV(prims, 12000, 9800, H - EXT, INT);
  }
  wallV(prims, 25000, 9800, H - EXT, INT);

  const label = (x: number, y: number, text: string) => prims.push({ t: 'text', x: O + x, y: O + y, text, size: 420 });
  label(1500, 4000, 'OFFICE');
  label(9500, 4000, 'MEETING');
  label(18000, 4000, 'OFFICE');
  label(25600, 7000, 'STAIR A');
  label(4000, 9000, 'CORRIDOR');
  label(4000, 14000, ground ? 'RECEPTION' : 'OPEN PLAN');
  label(17000, 14000, 'OPEN PLAN');
  label(26000, 14000, 'STORE');
  // Dimension line along the top (thin ink that must not be read as wall).
  prims.push({ t: 'line', ax: O, ay: O - 500, bx: O + W, by: O - 500 });
  prims.push({ t: 'text', x: O + W / 2 - 600, y: O - 650, text: '30000', size: 350 });
}

export function demoFloors(): DemoFloor[] {
  const g: Prim[] = [];
  shell(g, true);
  g.push({ t: 'text', x: O, y: O + 18000 + 800, text: 'GROUND FLOOR PLAN  1:100', size: 500 });
  const f: Prim[] = [];
  shell(f, false);
  f.push({ t: 'text', x: O, y: O + 18000 + 800, text: 'FIRST FLOOR PLAN  1:100', size: 500 });
  const stair = { stairId: 'A', x: O + 27400, y: O + 6600 };
  return [
    { name: 'Ground floor', level: 0, prims: g, exits: [{ x: O + 12900, y: O + 17850 }], stairs: [stair] },
    { name: 'First floor', level: 1, prims: f, exits: [], stairs: [stair] },
  ];
}

/** Rasterises primitives at the given resolution (used by tests; the app draws on a canvas). */
export function rasterize(prims: Prim[], mmPerPx: number): { gray: Uint8Array; width: number; height: number } {
  const width = Math.ceil(DEMO_SHEET.widthMm / mmPerPx);
  const height = Math.ceil(DEMO_SHEET.heightMm / mmPerPx);
  const gray = new Uint8Array(width * height).fill(255);
  const dot = (x: number, y: number) => {
    const px = Math.round(x / mmPerPx), py = Math.round(y / mmPerPx);
    if (px >= 0 && py >= 0 && px < width && py < height) gray[py * width + px] = 0;
  };
  const line = (ax: number, ay: number, bx: number, by: number) => {
    const n = Math.ceil(Math.hypot(bx - ax, by - ay) / (mmPerPx / 2)) + 1;
    for (let i = 0; i <= n; i++) dot(ax + ((bx - ax) * i) / n, ay + ((by - ay) * i) / n);
  };
  for (const p of prims) {
    if (p.t === 'rect') {
      for (let y = Math.round(p.y / mmPerPx); y < Math.round((p.y + p.h) / mmPerPx); y++)
        for (let x = Math.round(p.x / mmPerPx); x < Math.round((p.x + p.w) / mmPerPx); x++) gray[y * width + x] = 0;
    } else if (p.t === 'line') line(p.ax, p.ay, p.bx, p.by);
    else if (p.t === 'arc') {
      const n = 40;
      for (let i = 0; i < n; i++) {
        const a = p.a0 + ((p.a1 - p.a0) * i) / n, b = p.a0 + ((p.a1 - p.a0) * (i + 1)) / n;
        line(p.cx + p.r * Math.cos(a), p.cy + p.r * Math.sin(a), p.cx + p.r * Math.cos(b), p.cy + p.r * Math.sin(b));
      }
    }
  }
  return { gray, width, height };
}

export function drawPrims(ctx: CanvasRenderingContext2D, prims: Prim[], pxPerMm: number) {
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.fillStyle = '#000';
  ctx.strokeStyle = '#000';
  ctx.lineWidth = Math.max(1, 18 * pxPerMm);
  for (const p of prims) {
    if (p.t === 'rect') ctx.fillRect(p.x * pxPerMm, p.y * pxPerMm, p.w * pxPerMm, p.h * pxPerMm);
    else if (p.t === 'line') {
      ctx.beginPath();
      ctx.moveTo(p.ax * pxPerMm, p.ay * pxPerMm);
      ctx.lineTo(p.bx * pxPerMm, p.by * pxPerMm);
      ctx.stroke();
    } else if (p.t === 'arc') {
      ctx.beginPath();
      ctx.arc(p.cx * pxPerMm, p.cy * pxPerMm, p.r * pxPerMm, p.a0, p.a1);
      ctx.stroke();
    } else {
      ctx.font = `${p.size * pxPerMm}px Arial, sans-serif`;
      ctx.fillText(p.text, p.x * pxPerMm, p.y * pxPerMm);
    }
  }
}
