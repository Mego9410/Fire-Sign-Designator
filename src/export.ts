import { jsPDF } from 'jspdf';
import { csvEscape, pickProduct, type Product } from './core/catalogue';
import { MOUNT_LABEL, SIGN_KINDS, SIGN_KIND_LABEL, SIGN_KIND_SHORT, type SignKind } from './core/types';
import { download, loadImage, slug } from './io';
import { levelCode, orderedSigns, signLabel, type Floor, type FloorOverlay, type PlacedSign, type Project } from './model';
import { BRAND, drawOverlays, drawSignIcon } from './ui/draw';

export interface ScheduleRow {
  ref: string;
  floor: Floor;
  sign: PlacedSign;
  product?: Product;
}

export function productFor(project: Project, s: PlacedSign): Product | undefined {
  if (s.productCode) {
    const p = project.catalogue.find((c) => c.code === s.productCode);
    if (p) return p;
  }
  return pickProduct(project.catalogue, s.kind, s.mount, project.kindDefaults);
}

export function scheduleRows(project: Project): ScheduleRow[] {
  return sortedFloors(project).flatMap((floor) =>
    orderedSigns(floor).map((sign, i) => ({ ref: signLabel(floor, i), floor, sign, product: productFor(project, sign) })),
  );
}

export const sortedFloors = (p: Project) => [...p.floors].sort((a, b) => b.level - a.level);

export function countsByKind(floor: Floor): Record<SignKind, number> {
  const c = Object.fromEntries(SIGN_KINDS.map((k) => [k, 0])) as Record<SignKind, number>;
  for (const s of floor.signs) c[s.kind]++;
  return c;
}

export function productTotals(rows: ScheduleRow[]) {
  const m = new Map<string, { product?: Product; code: string; qty: number; byFloor: Map<string, number> }>();
  for (const r of rows) {
    const code = r.product?.code ?? `(no product: ${r.sign.kind})`;
    if (!m.has(code)) m.set(code, { product: r.product, code, qty: 0, byFloor: new Map() });
    const e = m.get(code)!;
    e.qty++;
    e.byFloor.set(r.floor.id, (e.byFloor.get(r.floor.id) ?? 0) + 1);
  }
  return [...m.values()].sort((a, b) => a.code.localeCompare(b.code));
}

export function exportCsv(project: Project) {
  const rows = scheduleRows(project);
  const lines = [
    ['Ref', 'Floor', 'Level', 'Sign type', 'Mounting', 'Product code', 'Product', 'Size (mm)', 'X (m)', 'Y (m)', 'Reason', 'Note'].join(','),
    ...rows.map((r) => {
      const mm = r.floor.mmPerPx ?? 0;
      return [
        r.ref, r.floor.name, r.floor.level, SIGN_KIND_LABEL[r.sign.kind], MOUNT_LABEL[r.sign.mount], r.product?.code ?? '', r.product?.name ?? '',
        r.product ? `${r.product.heightMm}x${r.product.widthMm}` : '', ((r.sign.p.x * mm) / 1000).toFixed(2), ((r.sign.p.y * mm) / 1000).toFixed(2),
        r.sign.reason, r.sign.note ?? '',
      ].map(csvEscape).join(',');
    }),
  ];
  download(`${slug(project.name)}-sign-schedule.csv`, lines.join('\r\n'), 'text/csv');
}

/** Renders a floor with its signs to a canvas (for PDF pages and image export). */
export async function renderFloor(floor: Floor, overlay: FloorOverlay | undefined, maxSide = 3600, withRoutes = true): Promise<HTMLCanvasElement> {
  const img = await loadImage(floor.src);
  const crop = floor.crop ?? { x: 0, y: 0, w: floor.width, h: floor.height };
  const pad = Math.min(crop.w, crop.h) * 0.03;
  const box = { x: Math.max(0, crop.x - pad), y: Math.max(0, crop.y - pad), w: 0, h: 0 };
  box.w = Math.min(floor.width, crop.x + crop.w + pad) - box.x;
  box.h = Math.min(floor.height, crop.y + crop.h + pad) - box.y;
  const scale = maxSide / Math.max(box.w, box.h);
  const c = document.createElement('canvas');
  c.width = Math.round(box.w * scale);
  c.height = Math.round(box.h * scale);
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.globalAlpha = 0.75;
  ctx.drawImage(img, box.x, box.y, box.w, box.h, 0, 0, c.width, c.height);
  ctx.globalAlpha = 1;
  const view = { scale, ox: -box.x * scale, oy: -box.y * scale };
  const icon = Math.max(22, maxSide / 55);
  drawOverlays(ctx, { ...floor, crop: null }, overlay, view, {
    layers: { walls: false, footprint: false, routes: withRoutes, signs: true, labels: true, markers: false },
    iconSize: icon,
  });
  return c;
}

async function logoDataUrl(): Promise<string | null> {
  try {
    const img = await loadImage('./brand/8build-logo-dark.jpeg');
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    c.getContext('2d')!.drawImage(img, 0, 0);
    return c.toDataURL('image/jpeg', 0.92);
  } catch {
    return null;
  }
}

export async function exportPdf(project: Project, overlays: Record<string, FloorOverlay>) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a3' });
  const W = 420, H = 297;
  const rows = scheduleRows(project);
  const floors = sortedFloors(project);
  const date = new Date().toLocaleDateString('en-GB');
  const logo = await logoDataUrl();

  const header = (title: string) => {
    doc.setFillColor(BRAND.black);
    doc.rect(0, 0, W, 18, 'F');
    doc.setFillColor(BRAND.red);
    doc.rect(0, 18, W, 1.2, 'F');
    doc.setTextColor('#F7F5F0');
    if (logo) doc.addImage(logo, 'JPEG', 8, 1.5, 8.8, 15);
    else {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(18);
      doc.text('8build', 10, 12);
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setCharSpace(1.2);
    doc.text('FIRE EXIT SIGNAGE LAYOUT', 24, 11);
    doc.setCharSpace(0);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    doc.text(`${project.name}  ·  ${title}  ·  ${date}`, W - 10, 12, { align: 'right' });
    doc.setTextColor('#000000');
  };
  const footer = (n: number) => {
    doc.setFontSize(8);
    doc.setTextColor('#666666');
    doc.text(
      'Proposed layout generated with 8build Fire Sign Designator. Signs to BS 5499-4 / BS ISO 7010; mount 1.7–2.0 m AFF or above door heads, never on door leaves. To be verified on site by a competent person against the fire strategy.',
      10, H - 6,
    );
    doc.text(`Page ${n}`, W - 10, H - 6, { align: 'right' });
    doc.setTextColor('#000000');
  };

  let page = 1;
  // Cover / summary.
  header('Summary');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(22);
  doc.text(project.name, 14, 36);
  doc.setFontSize(12);
  doc.setFont('helvetica', 'normal');
  doc.text(`Fire exit sign count by floor and direction · max viewing distance ${project.settings.viewingDistanceM} m (${project.signHeightMm} mm signs)`, 14, 44);
  const cols = ['Floor', ...SIGN_KINDS.map((k) => SIGN_KIND_SHORT[k]), 'Total'];
  const colX = [14, 80, 120, 160, 200, 240, 280, 320];
  let y = 58;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  cols.forEach((c, i) => doc.text(c, colX[i], y));
  doc.setDrawColor(BRAND.red);
  doc.line(14, y + 2, 340, y + 2);
  doc.setFont('helvetica', 'normal');
  const totals = Object.fromEntries(SIGN_KINDS.map((k) => [k, 0])) as Record<SignKind, number>;
  for (const f of floors) {
    y += 8;
    const c = countsByKind(f);
    doc.text(`${levelCode(f.level)} · ${f.name}`.slice(0, 34), colX[0], y);
    SIGN_KINDS.forEach((k, i) => { doc.text(String(c[k]), colX[i + 1], y); totals[k] += c[k]; });
    doc.text(String(f.signs.length), colX[7], y);
  }
  y += 4;
  doc.setDrawColor('#999999');
  doc.line(14, y, 340, y);
  y += 6;
  doc.setFont('helvetica', 'bold');
  doc.text('Total', colX[0], y);
  SIGN_KINDS.forEach((k, i) => doc.text(String(totals[k]), colX[i + 1], y));
  doc.text(String(rows.length), colX[7], y);

  // Legend with icons.
  y += 18;
  doc.setFontSize(12);
  doc.text('Sign types', 14, y);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  SIGN_KINDS.forEach((k, i) => {
    const ic = document.createElement('canvas');
    ic.width = 96; ic.height = 64;
    drawSignIcon(ic.getContext('2d')!, k, 48, 32, 60);
    const x = 14 + (i % 3) * 110;
    const yy = y + 6 + Math.floor(i / 3) * 18;
    doc.addImage(ic.toDataURL('image/png'), 'PNG', x, yy, 18, 12);
    doc.text(SIGN_KIND_SHORT[k], x + 22, yy + 7.5);
  });

  // Product totals.
  y += 50;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('Products required', 14, y);
  doc.setFontSize(10);
  y += 8;
  const pcols = [14, 60, 200, 240, ...floors.map((_, i) => 270 + i * 22)];
  ['Code', 'Product', 'Size (mm)', 'Qty', ...floors.map((f) => levelCode(f.level))].forEach((c, i) => doc.text(c, pcols[i], y));
  doc.line(14, y + 2, Math.max(340, pcols[pcols.length - 1] + 15), y + 2);
  doc.setFont('helvetica', 'normal');
  for (const t of productTotals(rows)) {
    y += 7;
    if (y > H - 20) break;
    doc.text(t.code, pcols[0], y);
    doc.text((t.product?.name ?? '').slice(0, 70), pcols[1], y);
    doc.text(t.product ? `${t.product.heightMm} × ${t.product.widthMm}` : '', pcols[2], y);
    doc.text(String(t.qty), pcols[3], y);
    floors.forEach((f, i) => doc.text(String(t.byFloor.get(f.id) ?? 0), pcols[4 + i], y));
  }
  footer(page);

  // One page per floor.
  for (const f of floors) {
    doc.addPage('a3', 'landscape');
    page++;
    header(`${levelCode(f.level)} · ${f.name}`);
    const c = await renderFloor(f, overlays[f.id]);
    const maxW = 300, maxH = H - 40;
    const s = Math.min(maxW / c.width, maxH / c.height);
    doc.addImage(c.toDataURL('image/jpeg', 0.88), 'JPEG', 10, 25, c.width * s, c.height * s);
    // Side panel: counts.
    const x = 318;
    let yy = 30;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.text(`${f.name}`, x, yy);
    yy += 8;
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    const cnt = countsByKind(f);
    for (const k of SIGN_KINDS) {
      const ic = document.createElement('canvas');
      ic.width = 96; ic.height = 64;
      drawSignIcon(ic.getContext('2d')!, k, 48, 32, 60);
      doc.addImage(ic.toDataURL('image/png'), 'PNG', x, yy - 5, 10.5, 7);
      doc.text(`${SIGN_KIND_SHORT[k]}`, x + 13, yy);
      doc.text(String(cnt[k]), W - 12, yy, { align: 'right' });
      yy += 9;
    }
    doc.setFont('helvetica', 'bold');
    doc.text('Total', x + 13, yy);
    doc.text(String(f.signs.length), W - 12, yy, { align: 'right' });
    yy += 10;
    doc.setFontSize(8.5);
    doc.setFont('helvetica', 'bold');
    doc.text('Ref   Type / mount / product', x, yy);
    doc.setFont('helvetica', 'normal');
    const floorRows = rows.filter((r) => r.floor.id === f.id);
    for (const r of floorRows) {
      yy += 4.6;
      if (yy > H - 14) { doc.text(`…and ${floorRows.length - floorRows.indexOf(r)} more (see schedule)`, x, yy); break; }
      doc.text(`${r.ref}  ${SIGN_KIND_SHORT[r.sign.kind]} · ${r.sign.mount} · ${r.product?.code ?? '—'}`, x, yy);
    }
    footer(page);
  }

  // Full schedule.
  doc.addPage('a3', 'landscape');
  page++;
  header('Sign schedule');
  let yy = 30;
  const sc = [10, 34, 90, 140, 190, 240, 330];
  const head = () => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    ['Ref', 'Floor', 'Sign type', 'Mounting', 'Product code', 'Product', 'Reason'].forEach((t, i) => doc.text(t, sc[i], yy));
    doc.line(10, yy + 1.5, W - 10, yy + 1.5);
    doc.setFont('helvetica', 'normal');
  };
  head();
  for (const r of rows) {
    yy += 5.5;
    if (yy > H - 14) {
      footer(page);
      doc.addPage('a3', 'landscape');
      page++;
      header('Sign schedule (cont.)');
      yy = 30;
      head();
      yy += 5.5;
    }
    [r.ref, r.floor.name.slice(0, 28), SIGN_KIND_SHORT[r.sign.kind], MOUNT_LABEL[r.sign.mount].replace('–', '-'), r.product?.code ?? '—', (r.product?.name ?? '').slice(0, 48), (r.sign.reason + (r.sign.note ? ` – ${r.sign.note}` : '')).slice(0, 50)]
      .forEach((t, i) => doc.text(String(t), sc[i], yy));
  }
  footer(page);
  doc.save(`${slug(project.name)}-fire-signage.pdf`);
}
