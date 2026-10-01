import { analyzeProject } from './core/analyze';
import type { AnalysisSettings, FloorInput } from './core/types';

self.onmessage = (e: MessageEvent<{ floors: FloorInput[]; settings: AnalysisSettings }>) => {
  try {
    const result = analyzeProject(e.data.floors, e.data.settings);
    const transfer: Transferable[] = [];
    for (const f of result.floors) transfer.push(f.walls.buffer, f.footprint.buffer);
    (self as unknown as Worker).postMessage({ ok: true, result }, transfer);
  } catch (err) {
    (self as unknown as Worker).postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
