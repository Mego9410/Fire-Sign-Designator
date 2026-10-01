import * as pdfjs from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { DEMO_SHEET, demoFloors, drawPrims } from './core/demo';
import type { AnalysisResult, AnalysisSettings, FloorInput, Rect } from './core/types';
import { uid, type Floor, type FloorOverlay, type Project } from './model';

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const MAX_SIDE = 6000;
const MAX_PIXELS = 24e6;

function guessLevel(name: string, fallback: number): number {
  const s = name.toLowerCase();
  if (/basement|lower ground|\blg\b|\bb\d/.test(s)) return -Number(/b(\d)/.exec(s)?.[1] ?? 1);
  if (/ground|\bgf\b/.test(s)) return 0;
  const m = /(?:level|floor|lvl|\bl)\s*(\d+)/.exec(s) ?? /(\d+)(?:st|nd|rd|th)/.exec(s);
  if (m) return Number(m[1]);
  const words = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth'];
  const i = words.findIndex((w) => s.includes(w));
  return i >= 0 ? i + 1 : fallback;
}

function emptyFloor(name: string, level: number, src: string, width: number, height: number): Floor {
  return { id: uid('f'), name, level, src, width, height, mmPerPx: null, crop: null, exits: [], stairs: [], wallAdd: [], wallErase: [], signs: [] };
}

/** Imports PDFs (one floor per page) and images (one floor per file). */
export async function importFiles(files: File[], startLevel: number, onProgress?: (msg: string) => void): Promise<Floor[]> {
  const out: Floor[] = [];
  let level = startLevel;
  for (const file of files) {
    const base = file.name.replace(/\.[^.]+$/, '');
    if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
      const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
      for (let n = 1; n <= doc.numPages; n++) {
        onProgress?.(`Rendering ${file.name} page ${n} of ${doc.numPages}…`);
        const page = await doc.getPage(n);
        const vp1 = page.getViewport({ scale: 1 });
        let scale = Math.min(MAX_SIDE / Math.max(vp1.width, vp1.height), Math.sqrt(MAX_PIXELS / (vp1.width * vp1.height)));
        scale = Math.max(1, scale);
        const vp = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.width = Math.floor(vp.width);
        canvas.height = Math.floor(vp.height);
        const ctx = canvas.getContext('2d')!;
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvas, canvasContext: ctx, viewport: vp }).promise;
        const name = doc.numPages > 1 ? `${base} – p${n}` : base;
        const f = emptyFloor(name, guessLevel(name, level), canvas.toDataURL('image/png'), canvas.width, canvas.height);
        f.paperMmPerPx = 25.4 / 72 / scale;
        f.mmPerPx = f.paperMmPerPx * 100;
        f.scaleNote = '1:100 assumed from PDF – check with “Set scale”';
        out.push(f);
        level = f.level + 1;
      }
    } else if (file.type.startsWith('image/')) {
      onProgress?.(`Loading ${file.name}…`);
      const src = await readAsDataUrl(file);
      const img = await loadImage(src);
      const f = emptyFloor(base, guessLevel(base, level), src, img.naturalWidth, img.naturalHeight);
      f.scaleNote = 'Scale not set – use “Set scale” on a known dimension';
      out.push(f);
      level = f.level + 1;
    } else {
      throw new Error(`${file.name}: please upload PDF, PNG or JPG drawings. (Export DWG/DXF to PDF first.)`);
    }
  }
  return out;
}

export function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = () => rej(r.error);
    r.readAsDataURL(file);
  });
}

const imageCache = new Map<string, Promise<HTMLImageElement>>();
export function loadImage(src: string): Promise<HTMLImageElement> {
  let p = imageCache.get(src);
  if (!p) {
    p = new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = () => rej(new Error('Could not load image'));
      img.src = src;
    });
    imageCache.set(src, p);
  }
  return p;
}

export function demoProjectFloors(): Floor[] {
  const pxPerMm = 1 / 20;
  return demoFloors().map((d) => {
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(DEMO_SHEET.widthMm * pxPerMm);
    canvas.height = Math.round(DEMO_SHEET.heightMm * pxPerMm);
    drawPrims(canvas.getContext('2d')!, d.prims, pxPerMm);
    const f = emptyFloor(d.name, d.level, canvas.toDataURL('image/png'), canvas.width, canvas.height);
    f.mmPerPx = 1 / pxPerMm;
    f.scaleNote = 'Example drawing – scale known';
    f.exits = d.exits.map((e) => ({ id: uid('x'), p: { x: e.x * pxPerMm, y: e.y * pxPerMm } }));
    f.stairs = d.stairs.map((s) => ({ id: uid('s'), stairId: s.stairId, p: { x: s.x * pxPerMm, y: s.y * pxPerMm } }));
    return f;
  });
}

// ---- Analysis --------------------------------------------------------------------------------

const ANALYSIS_MM = 20;
const ANALYSIS_MAX_PX = 9e6;

export interface Prepared {
  inputs: FloorInput[];
  frames: { floorId: string; k: number; crop: Rect }[];
}

export async function prepareAnalysis(floors: Floor[]): Promise<Prepared> {
  const inputs: FloorInput[] = [];
  const frames: Prepared['frames'] = [];
  for (const f of floors) {
    if (!f.mmPerPx) continue;
    const crop = f.crop ?? { x: 0, y: 0, w: f.width, h: f.height };
    const cropMm2 = crop.w * crop.h * f.mmPerPx * f.mmPerPx;
    const aMm = Math.max(ANALYSIS_MM, Math.sqrt(cropMm2 / ANALYSIS_MAX_PX));
    const k = f.mmPerPx / aMm;
    const w = Math.max(1, Math.round(crop.w * k));
    const h = Math.max(1, Math.round(crop.h * k));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(await loadImage(f.src), crop.x, crop.y, crop.w, crop.h, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;
    const gray = new Uint8Array(w * h);
    for (let i = 0; i < gray.length; i++) gray[i] = (data[i * 4] * 77 + data[i * 4 + 1] * 150 + data[i * 4 + 2] * 29) >> 8;
    const toA = (p: { x: number; y: number }) => ({ x: (p.x - crop.x) * k, y: (p.y - crop.y) * k });
    inputs.push({
      id: f.id,
      level: f.level,
      width: w,
      height: h,
      gray,
      mmPerPx: aMm,
      exits: f.exits.map((e) => toA(e.p)),
      stairs: f.stairs.map((s) => ({ stairId: s.stairId, p: toA(s.p) })),
      wallAdd: f.wallAdd.map((s) => ({ radius: s.radius * k, points: s.points.map(toA) })),
      wallErase: f.wallErase.map((s) => ({ radius: s.radius * k, points: s.points.map(toA) })),
    });
    frames.push({ floorId: f.id, k, crop });
  }
  return { inputs, frames };
}

let worker: Worker | null = null;
export function runAnalysis(inputs: FloorInput[], settings: AnalysisSettings): Promise<AnalysisResult> {
  worker ??= new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  const w = worker;
  return new Promise((resolve, reject) => {
    w.onmessage = (e) => (e.data.ok ? resolve(e.data.result) : reject(new Error(e.data.error)));
    w.onerror = (e) => reject(new Error(e.message || 'Analysis failed'));
    w.postMessage({ floors: inputs, settings }, inputs.map((i) => i.gray.buffer));
  });
}

export function maskCanvas(mask: Uint8Array, w: number, h: number, rgba: [number, number, number, number]): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(w, h);
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    img.data[i * 4] = rgba[0];
    img.data[i * 4 + 1] = rgba[1];
    img.data[i * 4 + 2] = rgba[2];
    img.data[i * 4 + 3] = rgba[3];
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

export function buildOverlay(res: AnalysisResult['floors'][number], frame: Prepared['frames'][number], w: number, h: number): FloorOverlay {
  const { k, crop } = frame;
  const toS = (p: { x: number; y: number }) => ({ x: crop.x + p.x / k, y: crop.y + p.y / k });
  return {
    walls: maskCanvas(res.walls, w, h, [229, 16, 27, 150]),
    footprint: maskCanvas(res.footprint, w, h, [0, 132, 61, 28]),
    k,
    crop,
    routes: res.routes.map((r) => r.map(toS)),
    stairSuggestions: res.stairSuggestions.map((s) => ({
      center: toS(s.center),
      box: { x: crop.x + s.box.x / k, y: crop.y + s.box.y / k, w: s.box.w / k, h: s.box.h / k },
    })),
    warnings: res.warnings,
  };
}

// ---- Save / load -----------------------------------------------------------------------------

export function download(name: string, data: Blob | string, type = 'application/octet-stream') {
  const blob = typeof data === 'string' ? new Blob([data], { type }) : data;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

export function saveProject(p: Project) {
  download(`${slug(p.name)}.firesigns.json`, JSON.stringify(p), 'application/json');
}

export async function loadProjectFile(file: File): Promise<Project> {
  const p = JSON.parse(await file.text()) as Project;
  if (p.version !== 1 || !Array.isArray(p.floors)) throw new Error('This is not a Fire Sign Designator project file.');
  return p;
}

export const slug = (s: string) => s.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'project';
