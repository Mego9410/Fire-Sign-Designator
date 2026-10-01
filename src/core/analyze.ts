import { edtSq } from './raster';
import { detectStairs } from './stairs';
import type {
  AnalysisResult,
  AnalysisSettings,
  FloorInput,
  FloorResult,
  Mount,
  Pt,
  SignKind,
  SignOut,
} from './types';
import { detectWalls } from './walls';

/** Navigation grid for one floor. */
interface Grid {
  floor: FloorInput;
  index: number;
  offset: number; // first global node id
  gw: number;
  gh: number;
  cellPx: number;
  walkable: Uint8Array;
  clearanceM: Float32Array; // distance to nearest wall, metres
  walls: Uint8Array;
  footprint: Uint8Array;
}

const SQRT2 = Math.SQRT2;
const KIND_PRIORITY: Record<SignKind, number> = {
  exit: 5,
  'stair-down': 4,
  'stair-up': 4,
  left: 3,
  right: 3,
  ahead: 1,
};

export function analyzeProject(floors: FloorInput[], s: AnalysisSettings): AnalysisResult {
  const warnings: string[] = [];
  const grids: Grid[] = [];
  const results: FloorResult[] = [];
  let offset = 0;

  floors.forEach((floor, index) => {
    const { width: w, height: h, mmPerPx } = floor;
    const det = detectWalls(floor.gray, w, h, mmPerPx, s, floor.wallAdd, floor.wallErase);
    const wallDist = edtSq(det.walls, w, h);
    const cellPx = s.cellMm / mmPerPx;
    const gw = Math.max(1, Math.floor(w / cellPx));
    const gh = Math.max(1, Math.floor(h / cellPx));
    const walkable = new Uint8Array(gw * gh);
    const clearanceM = new Float32Array(gw * gh);
    const minClear = s.minPassageMm / 2000;
    for (let gy = 0; gy < gh; gy++) {
      for (let gx = 0; gx < gw; gx++) {
        const px = Math.min(w - 1, Math.floor((gx + 0.5) * cellPx));
        const py = Math.min(h - 1, Math.floor((gy + 0.5) * cellPx));
        const i = py * w + px;
        const c = Math.max(0, (Math.sqrt(wallDist[i]) - 0.5) * mmPerPx) / 1000;
        clearanceM[gy * gw + gx] = c;
        walkable[gy * gw + gx] = det.footprint[i] && c >= minClear ? 1 : 0;
      }
    }
    grids.push({ floor, index, offset, gw, gh, cellPx, walkable, clearanceM, walls: det.walls, footprint: det.footprint });
    offset += gw * gh;
    results.push({
      id: floor.id,
      walls: det.walls,
      footprint: det.footprint,
      routes: [],
      signs: [],
      stairSuggestions: detectStairs(det.thin, det.footprint, w, h, mmPerPx),
      warnings: [],
    });
  });

  const total = offset;
  const nodeGrid = (n: number) => {
    for (let i = grids.length - 1; i >= 0; i--) if (n >= grids[i].offset) return grids[i];
    throw new Error('bad node');
  };
  const cellCentre = (g: Grid, cell: number): Pt => {
    const gx = cell % g.gw;
    const gy = (cell - gx) / g.gw;
    return { x: (gx + 0.5) * g.cellPx, y: (gy + 0.5) * g.cellPx };
  };
  const snap = (g: Grid, p: Pt, maxM: number): number => {
    const cx = Math.floor(p.x / g.cellPx);
    const cy = Math.floor(p.y / g.cellPx);
    const maxR = Math.ceil((maxM * 1000) / g.floor.mmPerPx / g.cellPx);
    let best = -1;
    let bestD = Infinity;
    for (let dy = -maxR; dy <= maxR; dy++) {
      for (let dx = -maxR; dx <= maxR; dx++) {
        const x = cx + dx, y = cy + dy;
        if (x < 0 || y < 0 || x >= g.gw || y >= g.gh) continue;
        if (!g.walkable[y * g.gw + x]) continue;
        const d = dx * dx + dy * dy;
        if (d < bestD) { bestD = d; best = y * g.gw + x; }
      }
    }
    return best;
  };

  // ---- Exits and stair links -------------------------------------------------------------
  const exitNodes = new Set<number>();
  for (const g of grids) {
    const res = results[g.index];
    g.floor.exits.forEach((e, k) => {
      const c = snap(g, e, 2);
      if (c < 0) res.warnings.push(`Final exit ${k + 1} is not next to any walkable space – move it into the doorway.`);
      else exitNodes.add(g.offset + c);
    });
  }
  if (exitNodes.size === 0) warnings.push('Mark at least one final exit to the street to calculate escape routes.');

  const links = new Map<number, { to: number; cost: number }[]>();
  const stairNode = new Map<number, { stairId: string }>();
  const byStair = new Map<string, { g: Grid; node: number }[]>();
  for (const g of grids) {
    for (const st of g.floor.stairs) {
      const c = snap(g, st.p, 2.5);
      if (c < 0) {
        results[g.index].warnings.push(`Stair ${st.stairId} marker is not on walkable floor – move it onto the stair.`);
        continue;
      }
      const node = g.offset + c;
      stairNode.set(node, { stairId: st.stairId });
      if (!byStair.has(st.stairId)) byStair.set(st.stairId, []);
      byStair.get(st.stairId)!.push({ g, node });
    }
  }
  for (const [id, list] of byStair) {
    list.sort((a, b) => a.g.floor.level - b.g.floor.level);
    if (list.length < 2) {
      warnings.push(`Stair ${id} is only marked on one floor – mark it on the floors it connects.`);
      continue;
    }
    for (let i = 0; i + 1 < list.length; i++) {
      const a = list[i], b = list[i + 1];
      const cost = Math.max(1, b.g.floor.level - a.g.floor.level) * s.floorHeightM * 2;
      if (!links.has(a.node)) links.set(a.node, []);
      if (!links.has(b.node)) links.set(b.node, []);
      links.get(a.node)!.push({ to: b.node, cost });
      links.get(b.node)!.push({ to: a.node, cost });
    }
  }

  // ---- Multi-floor Dijkstra from the final exits ------------------------------------------
  const dist = new Float64Array(total).fill(Infinity);
  const parent = new Int32Array(total).fill(-1);
  const order: number[] = [];
  const heap = new MinHeap();
  for (const n of exitNodes) { dist[n] = 0; heap.push(n, 0); }
  // Keep routes off the walls, and prefer circulation space over cutting through rooms:
  // every doorway passed adds roughly s.doorPenaltyM of equivalent travel.
  const doorClear = 0.5;
  const doorCells = Math.max(1, 600 / s.cellMm);
  const hug = (c: number) =>
    (c < 0.75 ? ((0.75 - c) / 0.75) * 1.5 : 0) + (c < doorClear ? s.doorPenaltyM / doorCells / (s.cellMm / 1000) : 0);
  while (heap.size) {
    const [n, d] = heap.pop();
    if (d > dist[n]) continue;
    order.push(n);
    const g = nodeGrid(n);
    const cell = n - g.offset;
    const gx = cell % g.gw;
    const gy = (cell - gx) / g.gw;
    const stepM = s.cellMm / 1000;
    const relax = (m: number, cost: number) => {
      const nd = d + cost;
      if (nd < dist[m]) { dist[m] = nd; parent[m] = n; heap.push(m, nd); }
    };
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const x = gx + dx, y = gy + dy;
        if (x < 0 || y < 0 || x >= g.gw || y >= g.gh) continue;
        const c2 = y * g.gw + x;
        if (!g.walkable[c2]) continue;
        if (dx && dy && (!g.walkable[gy * g.gw + x] || !g.walkable[y * g.gw + gx])) continue;
        const pen = 1 + (hug(g.clearanceM[cell]) + hug(g.clearanceM[c2])) / 2;
        relax(g.offset + c2, (dx && dy ? SQRT2 : 1) * stepM * pen);
      }
    }
    const l = links.get(n);
    if (l) for (const { to, cost } of l) relax(to, cost);
  }

  // ---- Floor area served by every cell ----------------------------------------------------
  const flow = new Float64Array(total);
  for (const g of grids) {
    const cellArea = (s.cellMm / 1000) ** 2;
    let unreached = 0;
    for (let c = 0; c < g.gw * g.gh; c++) {
      if (!g.walkable[c]) continue;
      if (dist[g.offset + c] < Infinity) flow[g.offset + c] = cellArea;
      else unreached += cellArea;
    }
    if (exitNodes.size && unreached > 4) {
      results[g.index].warnings.push(
        `${Math.round(unreached)} m² of floor has no route to a final exit – check stairs are marked and linked, and that doorways show as gaps.`,
      );
    }
  }
  for (let i = order.length - 1; i >= 0; i--) {
    const n = order[i];
    if (parent[n] >= 0) flow[parent[n]] += flow[n];
  }

  // ---- Route network & leaves --------------------------------------------------------------
  const inNet = (n: number) => flow[n] >= s.minFlowM2;
  const netChildren = new Map<number, number[]>();
  for (const n of order) {
    if (!inNet(n) || parent[n] < 0) continue;
    const p = parent[n];
    if (!netChildren.has(p)) netChildren.set(p, []);
    netChildren.get(p)!.push(n);
  }
  const leaves = order.filter((n) => inNet(n) && !netChildren.has(n));

  const candidates: (SignOut & { floor: number })[] = [];
  const add = (g: Grid, sign: SignOut) => candidates.push({ ...sign, floor: g.index });

  // Junctions in corridors where another signed route joins: straight-ahead sign.
  for (const [n, kids] of netChildren) {
    if (kids.length < 2) continue;
    const g = nodeGrid(n);
    if (g.clearanceM[n - g.offset] * 2 > s.corridorMaxWidthM) continue;
    const main = kids.reduce((a, b) => (flow[a] >= flow[b] ? a : b));
    // Only a true intersection of circulation routes counts: a side route that arrives through a
    // doorway is a room exit (it gets its own turn sign), not a corridor junction.
    const sideIsCorridor = kids.some((k) => k !== main && minClearanceBack(k, g, 2, netChildren, flow, s.cellMm) > 0.5);
    if (!sideIsCorridor) continue;
    const before = walkBack(main, g, 1.5, netChildren, flow, s.cellMm);
    const after = walkForward(n, g, 1.5, parent, s.cellMm);
    if (before === n || after === n) continue;
    const a = angleOf(cellCentre(g, before - g.offset), cellCentre(g, n - g.offset));
    const b = angleOf(cellCentre(g, n - g.offset), cellCentre(g, after - g.offset));
    if (Math.abs(angleDiff(a, b)) < (s.turnAngleDeg * Math.PI) / 180) {
      add(g, { kind: 'ahead', p: cellCentre(g, n - g.offset), travel: b, mount: 'suspended', reason: 'Corridor junction – straight on', flowM2: flow[n] });
    }
  }

  const routes: Pt[][][] = grids.map(() => []);
  const turnRad = (s.turnAngleDeg * Math.PI) / 180;

  for (const leaf of leaves) {
    // Full path to the exit, possibly across floors.
    const path: number[] = [];
    for (let n = leaf; n >= 0; n = parent[n]) path.push(n);
    // Split into runs on the same floor.
    let start = 0;
    while (start < path.length) {
      const g = nodeGrid(path[start]);
      let end = start;
      while (end + 1 < path.length && nodeGrid(path[end + 1]) === g) end++;
      const run = path.slice(start, end + 1);
      const nextNode = end + 1 < path.length ? path[end + 1] : -1;
      handleRun(g, run, nextNode);
      start = end + 1;
    }
  }

  function handleRun(g: Grid, run: number[], nextNode: number) {
    const cells = run.map((n) => n - g.offset);
    const pts = cells.map((c) => cellCentre(g, c));
    const last = run[run.length - 1];
    const mmPerPx = g.floor.mmPerPx;
    const pxPerM = 1000 / mmPerPx;
    // Vertices of the straightened route (indices into pts), leaf → root.
    const vIdx = simplify(g, cells);
    const verts = vIdx.map((i) => pts[i]);
    if (verts.length >= 2) routes[g.index].push(verts);

    const placed: { arc: number; sign: SignOut }[] = [];
    const arcAt = cumulativeArc(pts);
    const totalArc = arcAt[arcAt.length - 1];

    // Root sign: final exit or stair.
    const rootTravel = verts.length >= 2 ? angleOf(verts[verts.length - 2], verts[verts.length - 1]) : 0;
    if (exitNodes.has(last)) {
      placed.push({ arc: totalArc, sign: { kind: 'exit', p: pts[pts.length - 1], travel: rootTravel, mount: 'door-head', reason: 'Final exit', flowM2: flow[last] } });
    } else if (nextNode >= 0 && stairNode.has(last)) {
      const nextLevel = nodeGrid(nextNode).floor.level;
      const kind: SignKind = nextLevel < g.floor.level ? 'stair-down' : 'stair-up';
      const stairId = stairNode.get(last)!.stairId;
      placed.push({
        arc: totalArc,
        sign: { kind, p: pts[pts.length - 1], travel: rootTravel, mount: 'door-head', reason: `Stair ${stairId} – escape ${kind === 'stair-down' ? 'down' : 'up'}`, flowM2: flow[last], stairId },
      });
    }

    // Changes of direction.
    for (let k = 1; k < verts.length - 1; k++) {
      const a = angleOf(verts[k - 1], verts[k]);
      const b = angleOf(verts[k], verts[k + 1]);
      const turn = angleDiff(a, b);
      if (Math.abs(turn) < turnRad) continue;
      const kind: SignKind = turn > 0 ? 'right' : 'left';
      const hit = raycastWall(g, verts[k], a, s.wallSearchM * pxPerM);
      const p = hit ?? verts[k];
      const mount: Mount = hit ? 'wall' : 'suspended';
      placed.push({ arc: arcAt[vIdx[k]], sign: { kind, p, travel: b, mount, reason: 'Change of direction', flowM2: flow[run[vIdx[k]]] } });
    }

    // Doors on the route: local narrowings of the passage.
    const windowCells = Math.max(3, Math.round(1500 / s.cellMm));
    for (let i = 1; i < cells.length - 1; i++) {
      const c = g.clearanceM[cells[i]];
      if (c > 0.6) continue;
      if (flow[run[i]] < s.doorFlowM2) continue;
      if (g.clearanceM[cells[i - 1]] < c || g.clearanceM[cells[i + 1]] < c) continue;
      let wider = 0;
      for (let j = Math.max(0, i - windowCells); j <= Math.min(cells.length - 1, i + windowCells); j++) {
        wider = Math.max(wider, g.clearanceM[cells[j]]);
      }
      if (wider - c < 0.15) continue;
      const a = pts[Math.max(0, i - 5)];
      const b = pts[Math.min(pts.length - 1, i + 5)];
      placed.push({ arc: arcAt[i], sign: { kind: 'ahead', p: pts[i], travel: angleOf(a, b), mount: 'door-head', reason: 'Door on escape route', flowM2: flow[run[i]] } });
    }

    // Line of sight: the next sign must always be within viewing distance.
    const maxGap = s.viewingDistanceM * pxPerM * 0.95;
    placed.sort((x, y) => y.arc - x.arc);
    const fill: typeof placed = [];
    let prevArc = placed.length && placed[0].arc >= totalArc - maxGap ? placed[0].arc : totalArc;
    const marks = [...placed.map((p) => p.arc), 0];
    for (const arc of marks) {
      while (prevArc - arc > maxGap) {
        prevArc -= maxGap;
        const i = indexAtArc(arcAt, prevArc);
        const a = pts[Math.max(0, i - 5)];
        const b = pts[Math.min(pts.length - 1, i + 5)];
        fill.push({ arc: prevArc, sign: { kind: 'ahead', p: pts[i], travel: angleOf(a, b), mount: 'suspended', reason: 'Keeps the next sign within viewing distance', flowM2: flow[run[i]] } });
      }
      prevArc = arc;
    }
    for (const p of [...placed, ...fill]) add(g, p.sign);
  }

  // ---- De-duplicate: many routes share the same corners ----------------------------------
  candidates.sort((a, b) => KIND_PRIORITY[b.kind] - KIND_PRIORITY[a.kind] || b.flowM2 - a.flowM2);
  const kept: (SignOut & { floor: number })[] = [];
  for (const c of candidates) {
    const g = grids[c.floor];
    const r = (s.dedupRadiusM * 1000) / g.floor.mmPerPx;
    const clash = kept.some((k) => {
      if (k.floor !== c.floor) return false;
      const d = Math.hypot(k.p.x - c.p.x, k.p.y - c.p.y);
      // A straight-on sign is redundant right next to an exit or stair sign.
      const big = c.kind === 'ahead' && (k.kind === 'exit' || k.kind.startsWith('stair'));
      if (d > (big ? r * 2 : r)) return false;
      if (KIND_PRIORITY[k.kind] > KIND_PRIORITY[c.kind]) return true;
      return k.kind === c.kind && (k.kind === 'exit' || k.kind.startsWith('stair') || Math.abs(angleDiff(k.travel, c.travel)) < Math.PI / 4);
    });
    if (!clash) kept.push(c);
  }
  for (const k of kept) {
    const { floor, ...sign } = k;
    results[floor].signs.push(sign);
  }
  grids.forEach((g) => (results[g.index].routes = dedupRoutes(routes[g.index])));
  return { floors: results, warnings };
}

// ---------------------------------------------------------------------------------------------

function walkBack(n: number, g: Grid, m: number, kids: Map<number, number[]>, flow: Float64Array, cellMm: number) {
  let steps = Math.round((m * 1000) / cellMm);
  let cur = n;
  while (steps-- > 0) {
    const k = kids.get(cur);
    if (!k || !k.length) break;
    const nxt = k.reduce((a, b) => (flow[a] >= flow[b] ? a : b));
    if (nxt < g.offset || nxt >= g.offset + g.gw * g.gh) break;
    cur = nxt;
  }
  return cur;
}

function minClearanceBack(n: number, g: Grid, m: number, kids: Map<number, number[]>, flow: Float64Array, cellMm: number) {
  let steps = Math.round((m * 1000) / cellMm);
  let cur = n;
  let min = g.clearanceM[n - g.offset];
  while (steps-- > 0) {
    const k = kids.get(cur);
    if (!k || !k.length) break;
    const nxt = k.reduce((a, b) => (flow[a] >= flow[b] ? a : b));
    if (nxt < g.offset || nxt >= g.offset + g.gw * g.gh) break;
    cur = nxt;
    min = Math.min(min, g.clearanceM[cur - g.offset]);
  }
  return min;
}

function walkForward(n: number, g: Grid, m: number, parent: Int32Array, cellMm: number) {
  let steps = Math.round((m * 1000) / cellMm);
  let cur = n;
  while (steps-- > 0 && parent[cur] >= 0) {
    const nxt = parent[cur];
    if (nxt < g.offset || nxt >= g.offset + g.gw * g.gh) break;
    cur = nxt;
  }
  return cur;
}

/** String-pulls a cell path, anchored from the root end so that shared trunks give shared corners. */
function simplify(g: Grid, cells: number[]): number[] {
  const n = cells.length;
  if (n <= 2) return n === 1 ? [0] : [0, 1];
  const out = [n - 1];
  let cur = n - 1;
  while (cur > 0) {
    let best = cur - 1;
    for (let j = cur - 2; j >= 0; j--) {
      if (lineOfSight(g, cells[cur], cells[j])) best = j;
      else break;
    }
    out.push(best);
    cur = best;
  }
  return out.reverse();
}

function lineOfSight(g: Grid, a: number, b: number): boolean {
  let x0 = a % g.gw, y0 = (a - x0) / g.gw;
  const x1 = b % g.gw, y1 = (b - x1) / g.gw;
  const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  for (;;) {
    if (!g.walkable[y0 * g.gw + x0]) return false;
    if (x0 === x1 && y0 === y1) return true;
    const e2 = 2 * err;
    if (e2 > -dy && e2 < dx) {
      // Diagonal step: both side cells must be open, otherwise the line clips a corner.
      if (!g.walkable[y0 * g.gw + x0 + sx] || !g.walkable[(y0 + sy) * g.gw + x0]) return false;
    }
    if (e2 > -dy) { err -= dy; x0 += sx; }
    if (e2 < dx) { err += dx; y0 += sy; }
  }
}

function raycastWall(g: Grid, from: Pt, angle: number, maxPx: number): Pt | null {
  const { width: w, height: h } = g.floor;
  const cx = Math.cos(angle), cy = Math.sin(angle);
  for (let t = 0; t <= maxPx; t += 1) {
    const x = Math.round(from.x + cx * t), y = Math.round(from.y + cy * t);
    if (x < 0 || y < 0 || x >= w || y >= h) return null;
    if (g.walls[y * w + x]) {
      const back = Math.max(0, t - 2);
      return { x: from.x + cx * back, y: from.y + cy * back };
    }
  }
  return null;
}

function cumulativeArc(pts: Pt[]): number[] {
  const out = [0];
  for (let i = 1; i < pts.length; i++) out.push(out[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  return out;
}

function indexAtArc(arc: number[], v: number): number {
  let lo = 0, hi = arc.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arc[mid] < v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function dedupRoutes(routes: Pt[][]): Pt[][] {
  const seen = new Set<string>();
  const out: Pt[][] = [];
  for (const r of routes) {
    const key = r.map((p) => `${Math.round(p.x)},${Math.round(p.y)}`).join(';');
    if (!seen.has(key)) { seen.add(key); out.push(r); }
  }
  return out;
}

export const angleOf = (a: Pt, b: Pt) => Math.atan2(b.y - a.y, b.x - a.x);

/** Signed angle from a to b in (-π, π]; positive is a clockwise (right) turn in image coordinates. */
export function angleDiff(a: number, b: number): number {
  let d = b - a;
  while (d <= -Math.PI) d += 2 * Math.PI;
  while (d > Math.PI) d -= 2 * Math.PI;
  return d;
}

class MinHeap {
  private ids: number[] = [];
  private keys: number[] = [];
  get size() { return this.ids.length; }
  push(id: number, key: number) {
    const { ids, keys } = this;
    let i = ids.length;
    ids.push(id); keys.push(key);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p] <= key) break;
      ids[i] = ids[p]; keys[i] = keys[p];
      i = p;
    }
    ids[i] = id; keys[i] = key;
  }
  pop(): [number, number] {
    const { ids, keys } = this;
    const topId = ids[0], topKey = keys[0];
    const lastId = ids.pop()!, lastKey = keys.pop()!;
    const n = ids.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= n) break;
        const r = l + 1;
        const c = r < n && keys[r] < keys[l] ? r : l;
        if (keys[c] >= lastKey) break;
        ids[i] = ids[c]; keys[i] = keys[c];
        i = c;
      }
      ids[i] = lastId; keys[i] = lastKey;
    }
    return [topId, topKey];
  }
}
