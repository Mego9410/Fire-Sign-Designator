import { DEFAULT_CATALOGUE, type Product } from './core/catalogue';
import {
  DEFAULT_SETTINGS,
  type AnalysisSettings,
  type Mount,
  type Pt,
  type Rect,
  type SignKind,
  type Stroke,
  type StairSuggestion,
} from './core/types';

export interface StairMark {
  id: string;
  stairId: string;
  p: Pt;
}

export interface ExitMark {
  id: string;
  p: Pt;
}

export interface PlacedSign {
  id: string;
  kind: SignKind;
  p: Pt;
  /** Plan direction of travel, radians (image coords). */
  travel: number;
  mount: Mount;
  reason: string;
  flowM2: number;
  stairId?: string;
  /** Added or moved by the user – kept when signs are regenerated. */
  manual?: boolean;
  productCode?: string;
  note?: string;
}

/** One drawing sheet = one building level. All coordinates are source-image pixels. */
export interface Floor {
  id: string;
  name: string;
  level: number;
  src: string;
  width: number;
  height: number;
  /** Real-world millimetres per source pixel (null until the scale is set). */
  mmPerPx: number | null;
  /** For PDF sheets: paper millimetres per pixel, so a drawing scale (1:N) can be applied. */
  paperMmPerPx?: number;
  scaleNote?: string;
  crop: Rect | null;
  exits: ExitMark[];
  stairs: StairMark[];
  wallAdd: Stroke[];
  wallErase: Stroke[];
  signs: PlacedSign[];
}

export interface Project {
  version: 1;
  name: string;
  floors: Floor[];
  settings: AnalysisSettings;
  signHeightMm: number;
  catalogue: Product[];
  kindDefaults: Partial<Record<SignKind, string>>;
}

/** Runtime-only analysis output for a floor (not saved). */
export interface FloorOverlay {
  walls: HTMLCanvasElement;
  footprint: HTMLCanvasElement;
  /** Analysis raster → source px: src = crop.xy + p / k */
  k: number;
  crop: Rect;
  routes: Pt[][];
  stairSuggestions: StairSuggestion[];
  warnings: string[];
}

export const newProject = (): Project => ({
  version: 1,
  name: 'Untitled project',
  floors: [],
  settings: { ...DEFAULT_SETTINGS },
  signHeightMm: 100,
  catalogue: DEFAULT_CATALOGUE.map((p) => ({ ...p })),
  kindDefaults: {},
});

let seq = 0;
export const uid = (prefix = 'id') => `${prefix}${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export function levelCode(level: number): string {
  if (level === 0) return 'GF';
  if (level < 0) return `B${-level}`;
  return `L${level}`;
}

export function signLabel(floor: Floor, index: number) {
  return `${levelCode(floor.level)}-${String(index + 1).padStart(2, '0')}`;
}

/** Signs in a stable order (by kind, then top-to-bottom, left-to-right) so labels are predictable. */
export function orderedSigns(floor: Floor): PlacedSign[] {
  const order: SignKind[] = ['exit', 'stair-down', 'stair-up', 'left', 'right', 'ahead'];
  return [...floor.signs].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || a.p.y - b.p.y || a.p.x - b.p.x);
}

export function nextStairId(floors: Floor[]): string {
  const used = new Set(floors.flatMap((f) => f.stairs.map((s) => s.stairId)));
  for (let i = 0; i < 26; i++) {
    const id = String.fromCharCode(65 + i);
    if (!used.has(id)) return id;
  }
  return `S${used.size + 1}`;
}
