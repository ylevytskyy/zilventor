// packages/shared/src/nesting/__tests__/fingerprint.spec.ts
import { describe, it, expect } from 'vitest';
import { computeNestFingerprint } from '../fingerprint';
import type { CutListRow } from '../../cutListRow';
import type { MaterialEntry } from '../../material';

const cutRow = (o: Partial<CutListRow>): CutListRow => ({
  rowKey: 'r1', itemNumber: 1, qty: 1,
  length: 600, width: 400, thickness: 18,
  materialId: 'm1', materialName: 'Birch', grain: 'length',
  edgeBands: { front: null, back: null, left: null, right: null },
  partPath: 'p.zipt', partName: 'P', componentPathKeys: ['c1'],
  ...o,
});

const mat = (o: Partial<MaterialEntry> & { id: string }): MaterialEntry => ({
  id: o.id, name: o.name ?? o.id, defaultThickness: 18, color: '#aabbcc',
  ...(o.sheetLengthMm !== undefined ? { sheetLengthMm: o.sheetLengthMm } : {}),
  ...(o.sheetWidthMm !== undefined ? { sheetWidthMm: o.sheetWidthMm } : {}),
});

describe('computeNestFingerprint', () => {
  const m = [mat({ id: 'm1', sheetLengthMm: 2440, sheetWidthMm: 1220 })];

  it('same inputs → same hash', async () => {
    const a = await computeNestFingerprint([cutRow({})], m, 3);
    const b = await computeNestFingerprint([cutRow({})], m, 3);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('renumbering (different itemNumber, same rowKey) → same hash', async () => {
    const a = await computeNestFingerprint([cutRow({ itemNumber: 1 })], m, 3);
    const b = await computeNestFingerprint([cutRow({ itemNumber: 99 })], m, 3);
    expect(a).toBe(b);
  });

  it('edge-band changes → same hash (we do not include edges)', async () => {
    const a = await computeNestFingerprint([cutRow({})], m, 3);
    const b = await computeNestFingerprint([cutRow({
      edgeBands: { front: { materialId: 'b1', materialName: 'Band' }, back: null, left: null, right: null },
    })], m, 3);
    expect(a).toBe(b);
  });

  it('kerf change → different hash', async () => {
    const a = await computeNestFingerprint([cutRow({})], m, 3);
    const b = await computeNestFingerprint([cutRow({})], m, 5);
    expect(a).not.toBe(b);
  });

  it('sheet-stock change → different hash', async () => {
    const a = await computeNestFingerprint([cutRow({})], [mat({ id: 'm1', sheetLengthMm: 2440, sheetWidthMm: 1220 })], 3);
    const b = await computeNestFingerprint([cutRow({})], [mat({ id: 'm1', sheetLengthMm: 3000, sheetWidthMm: 1500 })], 3);
    expect(a).not.toBe(b);
  });

  it('row order does not affect hash', async () => {
    const r1 = cutRow({ rowKey: 'a' });
    const r2 = cutRow({ rowKey: 'b' });
    const a = await computeNestFingerprint([r1, r2], m, 3);
    const b = await computeNestFingerprint([r2, r1], m, 3);
    expect(a).toBe(b);
  });
});
