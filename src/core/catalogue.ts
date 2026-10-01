import type { Mount, SignKind } from './types';
import { SIGN_KINDS } from './types';

export interface Product {
  code: string;
  name: string;
  /** Which sign kinds this product can be used for. */
  kinds: SignKind[];
  heightMm: number;
  widthMm: number;
  /** Preferred mounting, if the product is mount-specific (e.g. a suspended double-sided sign). */
  mount?: Mount;
  material?: string;
  price?: number;
  /** Data URL or http(s) URL of the product artwork. */
  image?: string;
}

const generic = (code: string, name: string, kinds: SignKind[], mount?: Mount, size: [number, number] = [150, 300]): Product => ({
  code,
  name,
  kinds,
  heightMm: size[0],
  widthMm: size[1],
  mount,
  material: 'Photoluminescent rigid PVC',
});

/** Starter catalogue; replace it with your own via CSV import. */
export const DEFAULT_CATALOGUE: Product[] = [
  generic('FE-150-DN', 'Fire exit – arrow down (final exit)', ['exit']),
  generic('FE-150-UP', 'Fire exit – arrow up (straight on)', ['ahead']),
  generic('FE-150-LT', 'Fire exit – arrow left', ['left']),
  generic('FE-150-RT', 'Fire exit – arrow right', ['right']),
  generic('FE-150-DL', 'Fire exit – arrow down-left (stair down)', ['stair-down']),
  generic('FE-150-UL', 'Fire exit – arrow up-left (stair up)', ['stair-up']),
  generic('FE-150-UP-DS', 'Fire exit – arrow up, double-sided suspended', ['ahead'], 'suspended'),
  generic('FE-150-LR-DS', 'Fire exit – left/right, double-sided suspended', ['left', 'right'], 'suspended'),
];

export const CATALOGUE_CSV_HEADER = 'code,name,kinds,height_mm,width_mm,mount,material,price,image';

/**
 * CSV columns (header row required, any order):
 *   code, name, kinds (e.g. "left" or "left|right"), height_mm, width_mm, mount, material, price, image
 */
export function parseCatalogueCsv(text: string): Product[] {
  const rows = parseCsv(text).filter((r) => r.some((c) => c.trim() !== ''));
  if (rows.length < 2) throw new Error('The catalogue CSV needs a header row and at least one product.');
  const header = rows[0].map((h) => h.trim().toLowerCase().replace(/[\s-]+/g, '_'));
  const col = (name: string, ...alts: string[]) => {
    for (const n of [name, ...alts]) {
      const i = header.indexOf(n);
      if (i >= 0) return i;
    }
    return -1;
  };
  const ci = {
    code: col('code', 'sku', 'product_code'),
    name: col('name', 'description', 'title'),
    kinds: col('kinds', 'kind', 'direction', 'arrow'),
    h: col('height_mm', 'height'),
    w: col('width_mm', 'width'),
    mount: col('mount', 'mounting'),
    material: col('material'),
    price: col('price', 'cost', 'unit_price'),
    image: col('image', 'image_url', 'picture'),
  };
  if (ci.code < 0 || ci.kinds < 0) throw new Error('The catalogue CSV must have "code" and "kinds" (or "direction") columns.');
  const out: Product[] = [];
  for (const r of rows.slice(1)) {
    const get = (i: number) => (i >= 0 ? (r[i] ?? '').trim() : '');
    const kinds = get(ci.kinds)
      .toLowerCase()
      .split(/[|;/ ]+/)
      .map(normaliseKind)
      .filter((k): k is SignKind => !!k);
    if (!get(ci.code) || !kinds.length) continue;
    const mount = get(ci.mount).toLowerCase();
    out.push({
      code: get(ci.code),
      name: get(ci.name) || get(ci.code),
      kinds,
      heightMm: Number(get(ci.h)) || 150,
      widthMm: Number(get(ci.w)) || 300,
      mount: mount.startsWith('susp') || mount.startsWith('ceil') || mount.startsWith('hang') ? 'suspended' : mount.startsWith('door') ? 'door-head' : mount.startsWith('wall') ? 'wall' : undefined,
      material: get(ci.material) || undefined,
      price: get(ci.price) ? Number(get(ci.price).replace(/[£$€,]/g, '')) : undefined,
      image: get(ci.image) || undefined,
    });
  }
  if (!out.length) throw new Error('No usable products found – check the "kinds" column uses exit, ahead, left, right, stair-down or stair-up.');
  return out;
}

function normaliseKind(s: string): SignKind | null {
  const k = s.trim();
  if ((SIGN_KINDS as string[]).includes(k)) return k as SignKind;
  const map: Record<string, SignKind> = {
    down: 'exit', final: 'exit', 'final-exit': 'exit', up: 'ahead', straight: 'ahead', forward: 'ahead',
    l: 'left', r: 'right', 'stairs-down': 'stair-down', 'down-left': 'stair-down', 'down-right': 'stair-down',
    'stairs-up': 'stair-up', 'up-left': 'stair-up', 'up-right': 'stair-up',
  };
  return map[k] ?? null;
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else q = false;
      } else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

export function csvEscape(v: unknown): string {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Picks the best product for a sign: matching kind, then matching mount, then the default for that kind. */
export function pickProduct(catalogue: Product[], kind: SignKind, mount: Mount, defaults: Partial<Record<SignKind, string>>): Product | undefined {
  const fits = catalogue.filter((p) => p.kinds.includes(kind));
  const byMount = fits.filter((p) => p.mount === mount);
  if (byMount.length) return byMount[0];
  const def = defaults[kind] && fits.find((p) => p.code === defaults[kind]);
  if (def) return def;
  return fits.find((p) => !p.mount) ?? fits[0];
}
