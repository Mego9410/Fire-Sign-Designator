import type { AnalysisSettings } from '../core/types';
import { DEFAULT_SETTINGS, viewingDistanceForHeight } from '../core/types';
import type { Project } from '../model';

interface Field {
  key: keyof AnalysisSettings;
  label: string;
  unit: string;
  step: number;
  help: string;
}

const ROUTE_FIELDS: Field[] = [
  { key: 'turnAngleDeg', label: 'Change of direction', unit: '°', step: 5, help: 'A bend sharper than this gets a left/right sign.' },
  { key: 'minFlowM2', label: 'Sign routes serving at least', unit: 'm²', step: 5, help: 'Smaller rooms where the way out is obvious are not signed.' },
  { key: 'doorFlowM2', label: 'Sign doors serving at least', unit: 'm²', step: 10, help: 'Doors on the route get a straight-on sign above them.' },
  { key: 'doorPenaltyM', label: 'Prefer corridors over rooms by', unit: 'm', step: 1, help: 'Extra distance counted for each doorway, so routes avoid cutting through rooms.' },
  { key: 'minPassageMm', label: 'Narrowest passable gap', unit: 'mm', step: 50, help: 'Gaps narrower than this are treated as closed.' },
  { key: 'floorHeightM', label: 'Floor-to-floor height', unit: 'm', step: 0.1, help: 'Used to weigh stair travel against walking distance.' },
  { key: 'dedupRadiusM', label: 'Merge signs closer than', unit: 'm', step: 0.1, help: 'Duplicate signs for the same decision point are merged.' },
];

const DETECT_FIELDS: Field[] = [
  { key: 'darkThreshold', label: 'Ink darkness threshold', unit: '0–255', step: 5, help: 'Raise if walls are drawn in grey; lower if a grey background is picked up.' },
  { key: 'minWallThicknessMm', label: 'Minimum wall thickness', unit: 'mm', step: 10, help: 'Lines thinner than this (text, dimensions, door swings) are ignored.' },
  { key: 'fillHatchMm', label: 'Fill hatched walls up to', unit: 'mm', step: 10, help: 'Set to ~60 if walls are drawn as hatching rather than solid fill.' },
  { key: 'envelopeGapMm', label: 'Bridge envelope openings up to', unit: 'mm', step: 100, help: 'Doors and windows in the outside wall narrower than this are closed to find the building outline.' },
];

export function SettingsPanel({ project, onChange }: { project: Project; onChange: (s: AnalysisSettings, signHeightMm: number) => void }) {
  const s = project.settings;
  const set = (k: keyof AnalysisSettings, v: number) => onChange({ ...s, [k]: v }, project.signHeightMm);
  const render = (f: Field) => (
    <label key={f.key} className="setting">
      <span>{f.label}</span>
      <span className="input-unit">
        <input type="number" step={f.step} value={s[f.key]} onChange={(e) => set(f.key, Number(e.target.value))} />
        <em>{f.unit}</em>
      </span>
      <small>{f.help}</small>
    </label>
  );
  return (
    <div className="pane">
      <section className="card">
        <h3>Signs</h3>
        <label className="setting">
          <span>Sign height</span>
          <span className="input-unit">
            <select value={project.signHeightMm} onChange={(e) => onChange(s, Number(e.target.value))}>
              {[100, 150, 200, 300, 450].map((h) => <option key={h} value={h}>{h} mm</option>)}
            </select>
          </span>
          <small>Maximum viewing distance {viewingDistanceForHeight(project.signHeightMm)} m. Signs are added so the next one is always within this distance.</small>
        </label>
      </section>
      <section className="card">
        <h3>Escape routes</h3>
        {ROUTE_FIELDS.map(render)}
      </section>
      <section className="card">
        <h3>Drawing detection</h3>
        {DETECT_FIELDS.map(render)}
      </section>
      <button className="small" onClick={() => onChange({ ...DEFAULT_SETTINGS }, 100)}>Reset to defaults</button>
      <p className="muted">Changes apply the next time you press “Analyse &amp; place signs”.</p>
    </div>
  );
}
