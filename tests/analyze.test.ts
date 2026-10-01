import { describe, expect, it } from 'vitest';
import { analyzeProject } from '../src/core/analyze';
import { demoFloors, rasterize } from '../src/core/demo';
import { DEFAULT_SETTINGS, type FloorInput } from '../src/core/types';

const MM = 25;

function demoInput(): FloorInput[] {
  return demoFloors().map((f, i) => {
    const r = rasterize(f.prims, MM);
    return {
      id: `f${i}`,
      level: f.level,
      width: r.width,
      height: r.height,
      gray: r.gray,
      mmPerPx: MM,
      exits: f.exits.map((e) => ({ x: e.x / MM, y: e.y / MM })),
      stairs: f.stairs.map((s) => ({ stairId: s.stairId, p: { x: s.x / MM, y: s.y / MM } })),
      wallAdd: [],
      wallErase: [],
    };
  });
}

describe('analyzeProject on the demo building', () => {
  const res = analyzeProject(demoInput(), DEFAULT_SETTINGS);
  const [gf, ff] = res.floors;
  const count = (f: typeof gf, k: string) => f.signs.filter((s) => s.kind === k).length;

  it('detects walls but not thin annotation', () => {
    const at = (x: number, y: number) => gf.walls[Math.round((1000 + y) / MM) * Math.ceil(32000 / MM) + Math.round((1000 + x) / MM)];
    expect(at(150, 5000)).toBe(1); // external wall
    expect(at(5000, 7940)).toBe(1); // corridor partition
    expect(at(6000, 7940)).toBe(0); // door opening
    expect(at(26000, 3000)).toBe(0); // stair tread (thin)
  });

  it('finds the stair', () => {
    for (const f of res.floors) {
      expect(f.stairSuggestions.length).toBeGreaterThanOrEqual(1);
      const s = f.stairSuggestions[0];
      expect(s.center.x * MM).toBeGreaterThan(1000 + 25000);
    }
  });

  it('has no warnings', () => {
    expect(res.warnings).toEqual([]);
    expect(gf.warnings).toEqual([]);
    expect(ff.warnings).toEqual([]);
  });

  it('places signs per floor', () => {
    expect(count(gf, 'exit')).toBe(1);
    expect(count(ff, 'stair-down')).toBe(1);
    expect(count(gf, 'left') + count(gf, 'right')).toBeGreaterThanOrEqual(2);
    // From the east end of the GF corridor people turn left (south) into the exit corridor.
    const turnsNearExitCorridor = gf.signs.filter((s) => (s.kind === 'left' || s.kind === 'right') && Math.abs(s.p.x * MM - 1000 - 12900) < 2500 && s.p.y * MM - 1000 > 7500 && s.p.y * MM - 1000 < 10000);
    expect(turnsNearExitCorridor.map((s) => s.kind).sort()).toEqual(['left', 'right']);
  });
});
