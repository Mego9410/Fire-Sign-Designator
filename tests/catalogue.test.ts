import { describe, expect, it } from 'vitest';
import { DEFAULT_CATALOGUE, parseCatalogueCsv, pickProduct } from '../src/core/catalogue';

describe('catalogue CSV', () => {
  it('parses flexible headers, quoted fields and kind aliases', () => {
    const csv = 'SKU,Description,Direction,Height,Width,Mounting,Price\n' +
      'A1,"Exit, arrow left",left,150,300,wall,£4.50\n' +
      'A2,Final exit,down,200,400,,\n' +
      'A3,Hanging sign,left|right,150,450,suspended,12\n';
    const p = parseCatalogueCsv(csv);
    expect(p).toHaveLength(3);
    expect(p[0]).toMatchObject({ code: 'A1', name: 'Exit, arrow left', kinds: ['left'], heightMm: 150, mount: 'wall', price: 4.5 });
    expect(p[1].kinds).toEqual(['exit']);
    expect(p[2].kinds).toEqual(['left', 'right']);
  });

  it('rejects a CSV without a kinds column', () => {
    expect(() => parseCatalogueCsv('code,name\nX,Y\n')).toThrow(/kinds/);
  });

  it('prefers a mount-specific product, then the chosen default', () => {
    expect(pickProduct(DEFAULT_CATALOGUE, 'left', 'suspended', {})?.code).toBe('FE-150-LR-DS');
    expect(pickProduct(DEFAULT_CATALOGUE, 'left', 'wall', {})?.code).toBe('FE-150-LT');
    expect(pickProduct(DEFAULT_CATALOGUE, 'ahead', 'wall', { ahead: 'FE-150-UP-DS' })?.code).toBe('FE-150-UP-DS');
  });
});
