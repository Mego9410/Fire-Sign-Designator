import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Pt, SignKind } from './core/types';
import { MOUNT_LABEL, SIGN_KINDS, SIGN_KIND_LABEL, viewingDistanceForHeight, type Mount } from './core/types';
import { countsByKind, exportCsv, exportPdf, productFor, sortedFloors } from './export';
import { buildOverlay, demoProjectFloors, importFiles, loadProjectFile, prepareAnalysis, runAnalysis, saveProject } from './io';
import { levelCode, newProject, nextStairId, orderedSigns, signLabel, uid, type Floor, type FloorOverlay, type PlacedSign, type Project } from './model';
import { CataloguePanel } from './ui/CataloguePanel';
import { BRAND, drawSignIcon, type Layers } from './ui/draw';
import { PlanCanvas, type Tool } from './ui/PlanCanvas';
import { SettingsPanel } from './ui/SettingsPanel';
import { loadAutosave, saveAutosave } from './ui/storage';

type Tab = 'signs' | 'catalogue' | 'settings';
/** Which screen is showing on phones (on desktop all three columns are visible). */
type MobileView = 'plan' | 'floors' | 'panel';

const TOOLS: { id: Tool; label: string; hint: string }[] = [
  { id: 'select', label: 'Select', hint: 'Tap or click to select, drag to move. Drag empty space to pan; pinch or scroll to zoom. Tap a dashed “Stair?” box to accept it.' },
  { id: 'exit', label: 'Final exit', hint: 'Click in the doorway of each final exit to the street (usually on the ground floor).' },
  { id: 'stair', label: 'Stair', hint: 'Click on the stair landing. Use the same stair letter on every floor it serves so floors link up.' },
  { id: 'wall', label: 'Draw wall', hint: 'Paint over walls the detector missed (e.g. glazed screens or hatched walls) or to block a route.' },
  { id: 'erase', label: 'Erase wall', hint: 'Paint over false walls (e.g. bold text or furniture) or to open a doorway.' },
  { id: 'sign', label: 'Add sign', hint: 'Click to place a sign manually. Rotate it in the panel on the right.' },
  { id: 'scale', label: 'Set scale', hint: 'Drag along a dimension you know (e.g. a dimension line), then enter its real length.' },
  { id: 'crop', label: 'Analysis area', hint: 'Drag a box around the building to ignore the title block, key plan and notes.' },
];

const GLYPH: Record<SignKind, string> = { exit: '↓', ahead: '↑', left: '←', right: '→', 'stair-down': '↙', 'stair-up': '↖' };

export default function App() {
  const [project, setProject] = useState<Project>(newProject);
  const [history, setHistory] = useState<Project[]>([]);
  const [floorId, setFloorId] = useState<string | null>(null);
  const [overlays, setOverlays] = useState<Record<string, FloorOverlay>>({});
  const [tool, setTool] = useState<Tool>('select');
  const [tab, setTab] = useState<Tab>('signs');
  const [mview, setMView] = useState<MobileView>('plan');
  const [menuOpen, setMenuOpen] = useState(false);
  const [stairId, setStairId] = useState('A');
  const [signKind, setSignKind] = useState<SignKind>('ahead');
  const [brushMm, setBrushMm] = useState(200);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [layers, setLayers] = useState<Layers>({ walls: true, footprint: false, routes: true, signs: true, labels: true, markers: true });
  const fileInput = useRef<HTMLInputElement>(null);
  const projectInput = useRef<HTMLInputElement>(null);
  const loaded = useRef(false);

  const floor = project.floors.find((f) => f.id === floorId) ?? null;
  const floors = useMemo(() => sortedFloors(project), [project]);

  // Autosave (IndexedDB) – restores the last session on reload.
  useEffect(() => {
    loadAutosave().then((p) => {
      if (p && p.floors.length) {
        setProject(p);
        setFloorId(sortedFloors(p).at(-1)?.id ?? null);
        setNotice('Restored your last session.');
      }
      loaded.current = true;
    });
  }, []);
  useEffect(() => {
    if (!loaded.current) return;
    const t = setTimeout(() => saveAutosave(project), 800);
    return () => clearTimeout(t);
  }, [project]);

  // Success messages clear themselves; warnings stay until dismissed.
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 7000);
    return () => clearTimeout(t);
  }, [notice]);

  const update = useCallback((fn: (p: Project) => Project, undoable = true) => {
    setProject((p) => {
      if (undoable) setHistory((h) => [...h.slice(-40), p]);
      return fn(p);
    });
  }, []);
  const updateFloor = useCallback(
    (id: string, fn: (f: Floor) => Floor, undoable = true) => update((p) => ({ ...p, floors: p.floors.map((f) => (f.id === id ? fn(f) : f)) }), undoable),
    [update],
  );
  const undo = useCallback(() => {
    setHistory((h) => {
      if (!h.length) return h;
      setProject(h[h.length - 1]);
      return h.slice(0, -1);
    });
  }, []);

  // Keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, select, textarea')) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); return; }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId && floor) { deleteSelected(); return; }
      if (e.key === 'Escape') { setTool('select'); setSelectedId(null); }
      if (e.key.toLowerCase() === 'r' && selectedSign) rotateSelected(e.shiftKey ? -45 : 45);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const selectedSign = floor?.signs.find((s) => s.id === selectedId) ?? null;
  const selectedExit = floor?.exits.find((s) => s.id === selectedId) ?? null;
  const selectedStair = floor?.stairs.find((s) => s.id === selectedId) ?? null;

  function deleteSelected() {
    if (!floor || !selectedId) return;
    updateFloor(floor.id, (f) => ({
      ...f,
      signs: f.signs.filter((s) => s.id !== selectedId),
      exits: f.exits.filter((s) => s.id !== selectedId),
      stairs: f.stairs.filter((s) => s.id !== selectedId),
    }));
    setSelectedId(null);
  }
  function editSign(patch: Partial<PlacedSign>) {
    if (!floor || !selectedSign) return;
    updateFloor(floor.id, (f) => ({ ...f, signs: f.signs.map((s) => (s.id === selectedSign.id ? { ...s, ...patch, manual: true } : s)) }));
  }
  function rotateSelected(deg: number) {
    if (selectedSign) editSign({ travel: selectedSign.travel + (deg * Math.PI) / 180 });
  }

  async function onFiles(files: FileList | null) {
    if (!files?.length) return;
    setError(null);
    try {
      setBusy('Importing drawings…');
      const start = project.floors.length ? Math.max(...project.floors.map((f) => f.level)) + 1 : 0;
      const added = await importFiles([...files], start, setBusy);
      update((p) => ({ ...p, floors: [...p.floors, ...added] }));
      if (added[0]) setFloorId(added[0].id);
      setMView('plan');
      setNotice(`Added ${added.length} floor${added.length === 1 ? '' : 's'}. Check each floor’s level and scale, then draw an analysis area around the building.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  function loadExample() {
    const fl = demoProjectFloors();
    setHistory([]);
    setOverlays({});
    setProject({ ...newProject(), name: 'Example office – 2 storeys', floors: fl });
    setFloorId(fl[0].id);
    setSelectedId(null);
    setMView('plan');
    setNotice('Example loaded: the final exit and Stair A are already marked. Press “Analyse & place signs”.');
  }

  async function analyse() {
    setError(null);
    const missing = project.floors.filter((f) => !f.mmPerPx);
    if (missing.length === project.floors.length) {
      setError('Set the scale of at least one floor first (Set scale tool).');
      return;
    }
    try {
      setBusy('Detecting walls and stairs, finding escape routes…');
      const prep = await prepareAnalysis(project.floors);
      const t0 = performance.now();
      const res = await runAnalysis(prep.inputs, project.settings);
      const newOverlays: Record<string, FloorOverlay> = { ...overlays };
      const signsByFloor = new Map<string, PlacedSign[]>();
      res.floors.forEach((r, i) => {
        const frame = prep.frames[i];
        const inp = prep.inputs[i];
        newOverlays[r.id] = buildOverlay(r, frame, inp.width, inp.height);
        signsByFloor.set(
          r.id,
          r.signs.map((s) => ({ id: uid('g'), kind: s.kind, p: { x: frame.crop.x + s.p.x / frame.k, y: frame.crop.y + s.p.y / frame.k }, travel: s.travel, mount: s.mount, reason: s.reason, flowM2: Math.round(s.flowM2), stairId: s.stairId })),
        );
      });
      setOverlays(newOverlays);
      update((p) => ({
        ...p,
        floors: p.floors.map((f) => {
          const auto = signsByFloor.get(f.id);
          if (!auto) return f;
          const manual = f.signs.filter((s) => s.manual);
          const r = f.mmPerPx ? (p.settings.dedupRadiusM * 2000) / f.mmPerPx : 0;
          const fresh = auto.filter((a) => !manual.some((m) => m.kind === a.kind && Math.hypot(m.p.x - a.p.x, m.p.y - a.p.y) < r));
          return { ...f, signs: [...manual, ...fresh] };
        }),
      }));
      const total = res.floors.reduce((a, f) => a + f.signs.length, 0);
      const warn = [...res.warnings, ...res.floors.flatMap((f) => f.warnings.map((w) => `${project.floors.find((x) => x.id === f.id)?.name}: ${w}`))];
      setNotice(`Placed ${total} signs across ${res.floors.length} floor${res.floors.length === 1 ? '' : 's'} in ${((performance.now() - t0) / 1000).toFixed(1)} s.` + (missing.length ? ` Skipped ${missing.length} floor(s) with no scale.` : ''));
      setError(warn.length ? warn.join('\n') : null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  function onScaleLine(a: Pt, b: Pt) {
    if (!floor) return;
    const px = Math.hypot(b.x - a.x, b.y - a.y);
    const current = floor.mmPerPx ? Math.round(px * floor.mmPerPx) : '';
    const v = window.prompt('Real length of the line you drew, in millimetres:', String(current));
    const mm = Number(v);
    if (!v || !(mm > 0)) return;
    updateFloor(floor.id, (f) => ({ ...f, mmPerPx: mm / px, scaleNote: `Measured: ${Math.round(px)} px = ${mm} mm` }));
    setTool('select');
  }

  function setDrawingScale(n: number) {
    if (!floor?.paperMmPerPx || !(n > 0)) return;
    updateFloor(floor.id, (f) => ({ ...f, mmPerPx: f.paperMmPerPx! * n, scaleNote: `1:${n} from PDF sheet size` }));
  }

  const totals = useMemo(() => {
    const t = Object.fromEntries(SIGN_KINDS.map((k) => [k, 0])) as Record<SignKind, number>;
    for (const f of project.floors) for (const s of f.signs) t[s.kind]++;
    return t;
  }, [project.floors]);
  const grandTotal = Object.values(totals).reduce((a, b) => a + b, 0);
  const stairIds = [...new Set([...project.floors.flatMap((f) => f.stairs.map((s) => s.stairId)), stairId])].sort();
  const step = !project.floors.length ? 1 : project.floors.some((f) => !f.mmPerPx) ? 2 : !project.floors.some((f) => f.exits.length) ? 3 : grandTotal ? 5 : 4;

  return (
    <div className="app" data-mview={mview}>
      <header className="top">
        <div className="brand">
          <img src="./brand/8build-logo-dark.jpeg" alt="8build" className="logo" />
          <span className="product">Fire Sign Designator</span>
        </div>
        <input className="project-name" value={project.name} onChange={(e) => update((p) => ({ ...p, name: e.target.value }), false)} aria-label="Project name" />
        <button className="menu-btn" aria-label="Menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((o) => !o)}>{menuOpen ? 'Close' : 'Menu'}</button>
        <div className={`actions ${menuOpen ? 'open' : ''}`} onClick={() => setMenuOpen(false)}>
          <button className="ghost" onClick={loadExample}>Load example</button>
          <button className="ghost" onClick={() => projectInput.current?.click()}>Open</button>
          <button className="ghost" onClick={() => saveProject(project)} disabled={!project.floors.length}>Save</button>
          <button className="ghost" onClick={() => exportCsv(project)} disabled={!grandTotal}>Schedule CSV</button>
          <button className="primary" onClick={async () => { setBusy('Building PDF…'); try { await exportPdf(project, overlays); } catch (e) { setError(String(e)); } finally { setBusy(null); } }} disabled={!grandTotal}>Export PDF</button>
        </div>
        <input ref={projectInput} type="file" accept=".json" hidden onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          try { const p = await loadProjectFile(f); setProject(p); setHistory([]); setOverlays({}); setFloorId(sortedFloors(p).at(-1)?.id ?? null); } catch (err) { setError(String(err)); }
        }} />
      </header>

      <aside className="left">
        <section className="steps">
          {['Upload plan drawings', 'Set the scale of each floor', 'Mark final exits & stairs', 'Analyse & place signs', 'Review, assign products, export'].map((s, i) => (
            <div key={s} className={`step ${step === i + 1 ? 'now' : step > i + 1 ? 'done' : ''}`}>
              <span>{step > i + 1 ? '✓' : i + 1}</span>{s}
            </div>
          ))}
        </section>

        <section>
          <div className="section-head">
            <h3>Floors</h3>
            <button className="small" onClick={() => fileInput.current?.click()}>+ Add drawings</button>
            <input ref={fileInput} type="file" multiple accept=".pdf,image/*" hidden onChange={(e) => { onFiles(e.target.files); e.target.value = ''; }} />
          </div>
          {!project.floors.length && (
            <div className="drop" onClick={() => fileInput.current?.click()} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); onFiles(e.dataTransfer.files); }}>
              <strong>Drop plan drawings here</strong>
              <span>PDF (one floor per page), PNG or JPG</span>
              <button className="link" onClick={(e) => { e.stopPropagation(); loadExample(); }}>or load the example building</button>
            </div>
          )}
          <ul className="floors">
            {floors.map((f) => (
              <li key={f.id} className={f.id === floorId ? 'active' : ''} onClick={() => { setFloorId(f.id); setSelectedId(null); }}>
                <span className="lvl">{levelCode(f.level)}</span>
                <span className="fname">{f.name}</span>
                <span className="meta">{f.signs.length ? `${f.signs.length} signs` : f.mmPerPx ? '' : 'no scale'}</span>
              </li>
            ))}
          </ul>
        </section>

        {floor && (
          <section className="props">
            <h3>Floor details</h3>
            <label>Name<input value={floor.name} onChange={(e) => updateFloor(floor.id, (f) => ({ ...f, name: e.target.value }), false)} /></label>
            <label>Level<input type="number" value={floor.level} onChange={(e) => updateFloor(floor.id, (f) => ({ ...f, level: Number(e.target.value) }))} /></label>
            <div className="hint">Ground = 0, first floor = 1, basement = −1. Stairs link floors in level order.</div>
            {floor.paperMmPerPx && (
              <label>Drawing scale 1:
                <input type="number" defaultValue={Math.round((floor.mmPerPx ?? 0) / floor.paperMmPerPx) || 100} key={floor.id + floor.mmPerPx} onBlur={(e) => setDrawingScale(Number(e.target.value))} onKeyDown={(e) => e.key === 'Enter' && setDrawingScale(Number((e.target as HTMLInputElement).value))} />
              </label>
            )}
            <div className={`scale ${floor.mmPerPx ? '' : 'warn'}`}>
              {floor.mmPerPx ? `1 px = ${floor.mmPerPx.toFixed(1)} mm · sheet ≈ ${((floor.width * floor.mmPerPx) / 1000).toFixed(0)} × ${((floor.height * floor.mmPerPx) / 1000).toFixed(0)} m` : 'Scale not set'}
              <small>{floor.scaleNote}</small>
            </div>
            <div className="row">
              <button className="small" onClick={() => setTool('scale')}>Set scale…</button>
              <button className="small" onClick={() => setTool('crop')}>Analysis area…</button>
              {floor.crop && <button className="small" onClick={() => updateFloor(floor.id, (f) => ({ ...f, crop: null }))}>Clear area</button>}
            </div>
            <div className="row">
              {(floor.wallAdd.length > 0 || floor.wallErase.length > 0) && (
                <button className="small" onClick={() => updateFloor(floor.id, (f) => ({ ...f, wallAdd: [], wallErase: [] }))}>Clear wall edits</button>
              )}
              <button className="small danger" onClick={() => {
                if (!window.confirm(`Remove ${floor.name} from the project?`)) return;
                update((p) => ({ ...p, floors: p.floors.filter((f) => f.id !== floor.id) }));
                setFloorId(null);
              }}>Remove floor</button>
            </div>
          </section>
        )}
      </aside>

      <main className="centre">
        <div className="toolbar">
          <div className="tools">
          {TOOLS.map((t) => (
            <button key={t.id} className={tool === t.id ? 'on' : ''} onClick={() => setTool(t.id)} title={t.hint} disabled={!floor}>{t.label}</button>
          ))}
          <span className="sep" />
          {tool === 'stair' && (
            <label className="inline">Stair
              <select value={stairId} onChange={(e) => (e.target.value === '+' ? setStairId(nextStairId(project.floors)) : setStairId(e.target.value))}>
                {stairIds.map((s) => <option key={s}>{s}</option>)}
                <option value="+">New…</option>
              </select>
            </label>
          )}
          {tool === 'sign' && (
            <label className="inline">Type
              <select value={signKind} onChange={(e) => setSignKind(e.target.value as SignKind)}>
                {SIGN_KINDS.map((k) => <option key={k} value={k}>{SIGN_KIND_LABEL[k]}</option>)}
              </select>
            </label>
          )}
          {(tool === 'wall' || tool === 'erase') && (
            <label className="inline">Brush
              <select value={brushMm} onChange={(e) => setBrushMm(Number(e.target.value))}>
                {[100, 200, 300, 500, 1000].map((v) => <option key={v} value={v}>{v} mm</option>)}
              </select>
            </label>
          )}
          </div>
          <button className="primary analyse" onClick={analyse} disabled={!project.floors.length || !!busy}><span className="long">Analyse &amp; place signs</span><span className="short">Analyse</span></button>
        </div>
        <div className="hintbar">{TOOLS.find((t) => t.id === tool)?.hint}</div>
        <div className="canvas-wrap">
          {floor ? (
            <PlanCanvas
              key={floor.id}
              floor={floor}
              overlay={overlays[floor.id]}
              layers={layers}
              tool={tool}
              stairId={stairId}
              signKind={signKind}
              brushMm={brushMm}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onChange={(fn) => updateFloor(floor.id, fn)}
              onScaleLine={onScaleLine}
              onAcceptStair={(p) => {
                const near = project.floors.flatMap((f) => (f.id !== floor.id && f.mmPerPx ? f.stairs : []))[0];
                const id = near?.stairId ?? nextStairId(project.floors);
                const sid = uid('s');
                updateFloor(floor.id, (f) => ({ ...f, stairs: [...f.stairs, { id: sid, stairId: id, p }] }));
                setSelectedId(sid);
                setNotice(`Stair ${id} added. Change its letter in the panel if it is a different stair.`);
              }}
            />
          ) : (
            <div className="empty">
              <h2>Plan your fire exit signage before you get to site</h2>
              <p>Upload the plan drawings for each level. The designator finds walls and stairwells, follows the escape routes from every part of the building to the final exits you mark, and places fire exit signs at every change of direction, junction, doorway and stair, with a count per floor and direction.</p>
              <div className="row center">
                <button className="primary" onClick={() => fileInput.current?.click()}>Upload drawings</button>
                <button className="ghost dark" onClick={loadExample}>Try the example building</button>
              </div>
            </div>
          )}
          {busy && <div className="busy"><div className="spinner" />{busy}</div>}
          {(notice || error) && (
            <div className="toast mobile-only" onClick={() => { setNotice(null); setError(null); }}>
              {error ? <div className="error">{error.split('\n')[0]}{error.includes('\n') ? ' (+ more)' : ''}</div> : <div className="notice">{notice}</div>}
            </div>
          )}
          {floor && (selectedSign || selectedExit || selectedStair) && (
            <div className="sel-bar mobile-only">
              <span>
                {selectedSign ? <><b>{signLabel(floor, orderedSigns(floor).findIndex((s) => s.id === selectedSign.id))}</b> {SIGN_KIND_LABEL[selectedSign.kind].replace(/ \(.*\)/, '')}</> : selectedExit ? <b>Final exit</b> : <b>Stair {selectedStair!.stairId}</b>}
              </span>
              {selectedSign && <button className="small" onClick={() => rotateSelected(-45)} aria-label="Rotate anticlockwise">⟲</button>}
              {selectedSign && <button className="small" onClick={() => rotateSelected(45)} aria-label="Rotate clockwise">⟳</button>}
              <button className="small" onClick={() => { setTab('signs'); setMView('panel'); }}>Edit</button>
              <button className="small danger" onClick={deleteSelected}>Delete</button>
            </div>
          )}
        </div>
        <div className="layers">
          {(Object.keys(layers) as (keyof Layers)[]).map((k) => (
            <label key={k}><input type="checkbox" checked={layers[k]} onChange={(e) => setLayers({ ...layers, [k]: e.target.checked })} />{{ walls: 'Detected walls', footprint: 'Building area', routes: 'Escape routes', signs: 'Signs', labels: 'Sign refs', markers: 'Exits & stairs' }[k]}</label>
          ))}
          <span className="grow" />
          <button className="link" onClick={undo} disabled={!history.length}>Undo</button>
        </div>
      </main>

      <aside className="right">
        <nav className="tabs">
          {(['signs', 'catalogue', 'settings'] as Tab[]).map((t) => (
            <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{{ signs: 'Signs & counts', catalogue: 'Catalogue', settings: 'Settings' }[t]}</button>
          ))}
        </nav>
        {(notice || error) && (
          <div className="messages">
            {notice && <div className="notice" onClick={() => setNotice(null)}>{notice}</div>}
            {error && <div className="error" onClick={() => setError(null)}>{error.split('\n').map((l, i) => <div key={i}>{l}</div>)}</div>}
          </div>
        )}

        {tab === 'signs' && (
          <div className="pane">
            {selectedSign && floor && (
              <section className="card selected">
                <div className="sel-head">
                  <canvas width={60} height={40} ref={(c) => { if (c) { const x = c.getContext('2d')!; x.clearRect(0, 0, 60, 40); drawSignIcon(x, selectedSign.kind, 30, 20, 36); } }} />
                  <div>
                    <strong>{signLabel(floor, orderedSigns(floor).findIndex((s) => s.id === selectedSign.id))}</strong>
                    <div className="muted">{selectedSign.reason}{selectedSign.flowM2 ? ` · serves ≈${selectedSign.flowM2} m²` : ''}</div>
                  </div>
                </div>
                <label>Sign type<select value={selectedSign.kind} onChange={(e) => editSign({ kind: e.target.value as SignKind, productCode: undefined })}>{SIGN_KINDS.map((k) => <option key={k} value={k}>{SIGN_KIND_LABEL[k]}</option>)}</select></label>
                <label>Mounting<select value={selectedSign.mount} onChange={(e) => editSign({ mount: e.target.value as Mount })}>{(Object.keys(MOUNT_LABEL) as Mount[]).map((m) => <option key={m} value={m}>{MOUNT_LABEL[m]}</option>)}</select></label>
                <label>Product
                  <select value={selectedSign.productCode ?? ''} onChange={(e) => editSign({ productCode: e.target.value || undefined })}>
                    <option value="">Auto – {productFor(project, { ...selectedSign, productCode: undefined })?.code ?? 'none in catalogue'}</option>
                    {project.catalogue.filter((c) => c.kinds.includes(selectedSign.kind)).map((c) => <option key={c.code} value={c.code}>{c.code} – {c.name}</option>)}
                  </select>
                </label>
                {(() => { const pr = productFor(project, selectedSign); return pr?.image ? <img className="product-img" src={pr.image} alt={pr.name} /> : null; })()}
                <div className="row">
                  <span className="muted">Travel direction</span>
                  <button className="small" onClick={() => rotateSelected(-45)} title="Rotate anticlockwise (Shift+R)">⟲ 45°</button>
                  <button className="small" onClick={() => rotateSelected(45)} title="Rotate clockwise (R)">⟳ 45°</button>
                </div>
                <label>Note<input value={selectedSign.note ?? ''} placeholder="e.g. fix to column, check door swing" onChange={(e) => editSign({ note: e.target.value })} /></label>
                <button className="small danger" onClick={deleteSelected}>Delete sign</button>
              </section>
            )}
            {selectedExit && floor && (
              <section className="card selected">
                <strong>Final exit</strong>
                <p className="muted">Escape routes are traced to this point. Drag it to move it.</p>
                <button className="small danger" onClick={deleteSelected}>Remove exit</button>
              </section>
            )}
            {selectedStair && floor && (
              <section className="card selected">
                <strong>Stair {selectedStair.stairId}</strong>
                <label>Stair letter
                  <input value={selectedStair.stairId} onChange={(e) => updateFloor(floor.id, (f) => ({ ...f, stairs: f.stairs.map((s) => (s.id === selectedStair.id ? { ...s, stairId: e.target.value.toUpperCase() } : s)) }))} />
                </label>
                <p className="muted">Mark the same letter on every floor this stair serves.</p>
                <button className="small danger" onClick={deleteSelected}>Remove stair</button>
              </section>
            )}

            <section className="card">
              <h3>Sign count</h3>
              <table className="counts">
                <thead>
                  <tr><th>Floor</th>{SIGN_KINDS.map((k) => <th key={k} title={SIGN_KIND_LABEL[k]}>{GLYPH[k]}</th>)}<th>Total</th></tr>
                </thead>
                <tbody>
                  {floors.map((f) => {
                    const c = countsByKind(f);
                    return (
                      <tr key={f.id} className={f.id === floorId ? 'active' : ''} onClick={() => setFloorId(f.id)}>
                        <td>{levelCode(f.level)}</td>
                        {SIGN_KINDS.map((k) => <td key={k}>{c[k] || '·'}</td>)}
                        <td><strong>{f.signs.length}</strong></td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr><td>Total</td>{SIGN_KINDS.map((k) => <td key={k}>{totals[k]}</td>)}<td><strong>{grandTotal}</strong></td></tr>
                </tfoot>
              </table>
              <div className="legend">
                {SIGN_KINDS.map((k) => <span key={k}><b>{GLYPH[k]}</b> {SIGN_KIND_LABEL[k].replace(/ \(.*\)/, '')}</span>)}
              </div>
            </section>

            {floor && floor.signs.length > 0 && (
              <section className="card">
                <h3>{floor.name} – signs</h3>
                <ul className="sign-list">
                  {orderedSigns(floor).map((s, i) => (
                    <li key={s.id} className={s.id === selectedId ? 'active' : ''} onClick={() => { setSelectedId(s.id); setTool('select'); setMView('plan'); }}>
                      <span className="ref">{signLabel(floor, i)}</span>
                      <span className="glyph" style={{ background: BRAND.green }}>{GLYPH[s.kind]}</span>
                      <span className="desc">{SIGN_KIND_LABEL[s.kind].replace(/ \(.*\)/, '')}<small>{productFor(project, s)?.code ?? '—'} · {s.mount}</small></span>
                      {s.manual && <span className="tag">edited</span>}
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <section className="card guidance">
              <h3>Placement rules applied</h3>
              <ul>
                <li><b>Decision points</b>: a sign at every change of direction, corridor junction, level change and route door.</li>
                <li><b>Line of sight</b>: extra “straight on” signs so the next sign is never more than {project.settings.viewingDistanceM} m away ({project.signHeightMm} mm signs).</li>
                <li><b>Height</b>: 1.7–2.0 m above floor on walls, or directly above door heads. Never on door leaves.</li>
                <li><b>Arrows</b>: ↓ above final exit doors, ↑ straight on / through, ← → at turns.</li>
              </ul>
            </section>
          </div>
        )}
        {tab === 'catalogue' && <CataloguePanel project={project} update={update} onError={setError} />}
        {tab === 'settings' && (
          <SettingsPanel
            project={project}
            onChange={(settings, signHeightMm) => update((p) => ({ ...p, settings: { ...settings, viewingDistanceM: viewingDistanceForHeight(signHeightMm) }, signHeightMm }), false)}
          />
        )}
      </aside>

      <nav className="mobile-nav" aria-label="Screens">
        {([
          ['plan', null, 'Plan'],
          ['floors', null, 'Floors'],
          ['panel', 'signs', `Signs${grandTotal ? ` (${grandTotal})` : ''}`],
          ['panel', 'catalogue', 'Catalogue'],
          ['panel', 'settings', 'Settings'],
        ] as [MobileView, Tab | null, string][]).map(([v, t, label]) => (
          <button key={label} className={mview === v && (!t || tab === t) ? 'on' : ''} onClick={() => { setMView(v); if (t) setTab(t); }}>{label}</button>
        ))}
      </nav>
    </div>
  );
}
