export interface Pt {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Stroke {
  points: Pt[];
  radius: number;
}

/**
 * Sign kinds, named by the arrow the viewer sees (BS 5499 / ISO 7010 conventions):
 *  - exit:  arrow down, above the final exit door (go straight through this exit)
 *  - ahead: arrow up, straight on / through this door
 *  - left / right: change of direction at a decision point
 *  - stair-down / stair-up: at a stair entry or landing, continue down / up the stair
 */
export type SignKind = 'exit' | 'ahead' | 'left' | 'right' | 'stair-down' | 'stair-up';

export const SIGN_KINDS: SignKind[] = ['exit', 'ahead', 'left', 'right', 'stair-down', 'stair-up'];

export const SIGN_KIND_LABEL: Record<SignKind, string> = {
  exit: 'Final exit (↓)',
  ahead: 'Straight ahead (↑)',
  left: 'Turn left (←)',
  right: 'Turn right (→)',
  'stair-down': 'Stair down',
  'stair-up': 'Stair up',
};

/** Plain labels (no arrow glyphs) for PDF output, whose built-in fonts lack arrows. */
export const SIGN_KIND_SHORT: Record<SignKind, string> = {
  exit: 'Final exit',
  ahead: 'Straight on',
  left: 'Turn left',
  right: 'Turn right',
  'stair-down': 'Stair down',
  'stair-up': 'Stair up',
};

export type Mount = 'door-head' | 'wall' | 'suspended';

export const MOUNT_LABEL: Record<Mount, string> = {
  'door-head': 'Above door head',
  wall: 'Wall, 1.7–2.0 m AFF',
  suspended: 'Suspended / projecting',
};

export interface AnalysisSettings {
  /** Grey level (0–255) below which a pixel counts as ink. */
  darkThreshold: number;
  /** Ink thinner than this is treated as annotation (text, dimensions, door swings, treads). */
  minWallThicknessMm: number;
  /** If > 0, close gaps up to this size before wall detection (fills hatched walls). */
  fillHatchMm: number;
  minWallAreaM2: number;
  /** Openings up to this width in the external envelope are bridged when finding the building footprint. */
  envelopeGapMm: number;
  cellMm: number;
  /** Narrowest gap a person is routed through. */
  minPassageMm: number;
  /** A route branch is signed once it serves at least this much floor area. */
  minFlowM2: number;
  /** Doors on the route get a straight-ahead sign once they serve this much floor area. */
  doorFlowM2: number;
  turnAngleDeg: number;
  /** Maximum viewing distance between consecutive signs. */
  viewingDistanceM: number;
  floorHeightM: number;
  /** Extra equivalent distance for passing through a doorway, so routes prefer corridors to rooms. */
  doorPenaltyM: number;
  dedupRadiusM: number;
  wallSearchM: number;
  /** Corridors up to this width get straight-ahead signs where another route joins. */
  corridorMaxWidthM: number;
}

export const DEFAULT_SETTINGS: AnalysisSettings = {
  darkThreshold: 150,
  minWallThicknessMm: 70,
  fillHatchMm: 0,
  minWallAreaM2: 0.03,
  envelopeGapMm: 2400,
  cellMm: 100,
  minPassageMm: 600,
  minFlowM2: 25,
  doorFlowM2: 60,
  turnAngleDeg: 35,
  viewingDistanceM: 17,
  floorHeightM: 3.5,
  doorPenaltyM: 6,
  dedupRadiusM: 1.5,
  wallSearchM: 4,
  corridorMaxWidthM: 2.4,
};

/** Maximum viewing distance for a sign of the given height (100 mm → 17 m, capped at 30 m). */
export function viewingDistanceForHeight(heightMm: number): number {
  return Math.min(30, Math.round(heightMm * 0.17 * 10) / 10);
}

export interface StairMarker {
  stairId: string;
  p: Pt;
}

/** One floor prepared for analysis. All coordinates are analysis-raster pixels. */
export interface FloorInput {
  id: string;
  level: number;
  width: number;
  height: number;
  gray: Uint8Array;
  mmPerPx: number;
  exits: Pt[];
  stairs: StairMarker[];
  wallAdd: Stroke[];
  wallErase: Stroke[];
}

export interface SignOut {
  kind: SignKind;
  p: Pt;
  /** Direction of travel on plan, radians (image coordinates, y down). */
  travel: number;
  mount: Mount;
  reason: string;
  flowM2: number;
  stairId?: string;
}

export interface StairSuggestion {
  box: Rect;
  center: Pt;
}

export interface FloorResult {
  id: string;
  walls: Uint8Array;
  footprint: Uint8Array;
  routes: Pt[][];
  signs: SignOut[];
  stairSuggestions: StairSuggestion[];
  warnings: string[];
}

export interface AnalysisResult {
  floors: FloorResult[];
  warnings: string[];
}
