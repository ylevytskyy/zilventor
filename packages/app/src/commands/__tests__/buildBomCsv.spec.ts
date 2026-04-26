import { describe, it, expect } from 'vitest';
import { buildBomCsv } from '../buildBomCsv';
import type { BomRow } from '@zilventor/shared/src/bomRow';

describe('buildBomCsv', () => {
  it('produces a header-only CSV when there are no rows', () => {
    expect(buildBomCsv([])).toBe('Item#,QTY,Part Name,Color,Part Path\n');
  });

  it('writes palette name in Color cell', () => {
    const row: BomRow = { rowKey: 'X::palette:Maple', itemNumber: 1, qty: 2, partPath: 'parts/cube.zipt', partName: 'cube', color: { kind: 'palette', name: 'Maple' }, componentIds: ['C1', 'C2'] };
    expect(buildBomCsv([row])).toBe('Item#,QTY,Part Name,Color,Part Path\n1,2,cube,Maple,parts/cube.zipt\n');
  });

  it('writes hex string in Color cell', () => {
    const row: BomRow = { rowKey: 'X::hex:#abc', itemNumber: 1, qty: 1, partPath: 'parts/cube.zipt', partName: 'cube', color: { kind: 'hex', hex: '#abc' }, componentIds: ['C1'] };
    expect(buildBomCsv([row])).toContain(',cube,#abc,parts/cube.zipt');
  });

  it('escapes commas and quotes per RFC-4180', () => {
    const row: BomRow = { rowKey: 'X::none', itemNumber: 1, qty: 1, partPath: 'parts/odd, name.zipt', partName: 'has "quote", and comma', color: undefined, componentIds: ['C1'] };
    const csv = buildBomCsv([row]);
    expect(csv).toContain('"has ""quote"", and comma"');
    expect(csv).toContain('"parts/odd, name.zipt"');
  });
});
