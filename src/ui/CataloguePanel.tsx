import { useRef, useState } from 'react';
import { CATALOGUE_CSV_HEADER, DEFAULT_CATALOGUE, csvEscape, parseCatalogueCsv, type Product } from '../core/catalogue';
import { SIGN_KINDS, SIGN_KIND_LABEL, type SignKind } from '../core/types';
import { download, readAsDataUrl } from '../io';
import type { Project } from '../model';

interface Props {
  project: Project;
  update: (fn: (p: Project) => Project) => void;
  onError: (msg: string | null) => void;
}

export function CataloguePanel({ project, update, onError }: Props) {
  const csvInput = useRef<HTMLInputElement>(null);
  const imgInput = useRef<HTMLInputElement>(null);
  const [imgFor, setImgFor] = useState<string | null>(null);
  const cat = project.catalogue;

  const used = new Map<string, number>();
  // Count usage per product code (explicit or automatic) – computed lazily by the caller's export helpers.
  for (const f of project.floors) for (const s of f.signs) if (s.productCode) used.set(s.productCode, (used.get(s.productCode) ?? 0) + 1);

  async function importCsv(file: File) {
    try {
      const products = parseCatalogueCsv(await file.text());
      const replace = window.confirm(`Found ${products.length} products. OK to replace the catalogue, Cancel to add them to it.`);
      update((p) => ({ ...p, catalogue: replace ? products : mergeProducts(p.catalogue, products) }));
      onError(null);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  }

  async function attachImages(files: FileList) {
    const list = [...files];
    const byCode = new Map<string, string>();
    for (const f of list) {
      const url = await readAsDataUrl(f);
      if (imgFor && list.length === 1) byCode.set(imgFor, url);
      else byCode.set(f.name.replace(/\.[^.]+$/, '').toLowerCase(), url);
    }
    update((p) => ({ ...p, catalogue: p.catalogue.map((c) => (byCode.has(c.code) ? { ...c, image: byCode.get(c.code) } : byCode.has(c.code.toLowerCase()) ? { ...c, image: byCode.get(c.code.toLowerCase()) } : c)) }));
    setImgFor(null);
  }

  function exportCatalogue() {
    const rows = cat.map((c) => [c.code, c.name, c.kinds.join('|'), c.heightMm, c.widthMm, c.mount ?? '', c.material ?? '', c.price ?? '', c.image?.startsWith('data:') ? '' : c.image ?? ''].map(csvEscape).join(','));
    download('sign-catalogue.csv', [CATALOGUE_CSV_HEADER, ...rows].join('\r\n'), 'text/csv');
  }

  return (
    <div className="pane">
      <section className="card">
        <h3>Your signage catalogue</h3>
        <p className="muted">Import your product range as CSV so every sign on the plan is matched to a product you stock. Columns: <code>code, name, kinds, height_mm, width_mm, mount, material, price, image</code>. “kinds” is one or more of exit, ahead, left, right, stair-down, stair-up (separate with |).</p>
        <div className="row">
          <button className="small" onClick={() => csvInput.current?.click()}>Import CSV…</button>
          <button className="small" onClick={exportCatalogue}>Download as CSV</button>
          <button className="small" onClick={() => { setImgFor(null); imgInput.current?.click(); }} title="Images are matched to products by file name = product code">Add product images…</button>
          <button className="small" onClick={() => window.confirm('Replace the catalogue with the starter products?') && update((p) => ({ ...p, catalogue: DEFAULT_CATALOGUE.map((c) => ({ ...c })), kindDefaults: {} }))}>Reset</button>
        </div>
        <input ref={csvInput} type="file" accept=".csv,text/csv" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) importCsv(f); }} />
        <input ref={imgInput} type="file" accept="image/*" multiple hidden onChange={(e) => { if (e.target.files) attachImages(e.target.files); e.target.value = ''; }} />
      </section>

      <section className="card">
        <h3>Default product per sign type</h3>
        {SIGN_KINDS.map((k) => {
          const options = cat.filter((c) => c.kinds.includes(k));
          return (
            <label key={k} className="setting">
              <span>{SIGN_KIND_LABEL[k]}</span>
              <select value={project.kindDefaults[k] ?? ''} onChange={(e) => update((p) => ({ ...p, kindDefaults: { ...p.kindDefaults, [k]: e.target.value || undefined } }))}>
                <option value="">{options.length ? 'Automatic' : 'No matching product'}</option>
                {options.map((c) => <option key={c.code} value={c.code}>{c.code} – {c.name}</option>)}
              </select>
            </label>
          );
        })}
        <small className="muted">Suspended signs use a suspended product when the catalogue has one.</small>
      </section>

      <section className="card">
        <h3>Products ({cat.length})</h3>
        <ul className="products">
          {cat.map((c) => (
            <li key={c.code}>
              <button className="thumb" title="Click to set image" onClick={() => { setImgFor(c.code); imgInput.current?.click(); }}>
                {c.image ? <img src={c.image} alt="" /> : <span>+ img</span>}
              </button>
              <div>
                <strong>{c.code}</strong> {used.get(c.code) ? <span className="tag">{used.get(c.code)} set manually</span> : null}
                <div>{c.name}</div>
                <small className="muted">{c.kinds.map((k: SignKind) => SIGN_KIND_LABEL[k].replace(/ \(.*\)/, '')).join(', ')} · {c.heightMm}×{c.widthMm} mm{c.mount ? ` · ${c.mount}` : ''}{c.price != null ? ` · £${c.price.toFixed(2)}` : ''}</small>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function mergeProducts(a: Product[], b: Product[]): Product[] {
  const m = new Map(a.map((p) => [p.code, p]));
  for (const p of b) m.set(p.code, { ...m.get(p.code), ...p });
  return [...m.values()];
}
