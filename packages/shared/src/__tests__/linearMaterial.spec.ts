import { describe, expect, it } from 'vitest';
import { partitionLinearMaterial } from '../linearMaterial';
import type { CutListRow } from '../cutListRow';
import type { MaterialEntry } from '../material';

const baseRow = (overrides: Partial<CutListRow> = {}): CutListRow => ({
  rowKey: 'L=600|W=400|T=18|M=m-birch|G=length',
  itemNumber: 1,
  qty: 1,
  length: 600,
  width: 400,
  thickness: 18,
  materialId: 'm-birch',
  materialName: 'Birch',
  grain: 'length',
  edgeBands: { front: null, back: null, left: null, right: null },
  partPath: 'p.zipt',
  partName: 'Side',
  componentPathKeys: ['c1'],
  ...overrides,
});

const materials: MaterialEntry[] = [
  { id: 'm-birch', name: 'Birch', defaultThickness: 18, color: '#d8c896' },
  { id: 'm-mdf', name: 'MDF', defaultThickness: 16, color: '#c8a878' },
  { id: 'm-rod-alu', name: 'Aluminium rod', defaultThickness: 0, color: '#cccccc', kind: 'linear' },
  { id: 'm-rod-brass', name: 'Brass rod', defaultThickness: 0, color: '#b5a642', kind: 'linear' },
];

describe('partitionLinearMaterial', () => {
  it('splits panel rows from linear-material rows and builds an ABF-style cut-piece breakdown', () => {
    const panelRow1 = baseRow({ rowKey: 'panel-1', itemNumber: 1, materialId: 'm-birch', materialName: 'Birch' });
    const panelRow2 = baseRow({ rowKey: 'panel-2', itemNumber: 2, materialId: 'm-mdf', materialName: 'MDF' });
    // Aluminium rod: one row length=958mm qty=1, another length=466mm qty=2 -> "3 rods: 1x958mm, 2x466mm"
    const rodRow958 = baseRow({
      rowKey: 'rod-958', itemNumber: 3, materialId: 'm-rod-alu', materialName: 'Aluminium rod',
      length: 958, width: 20, qty: 1,
    });
    const rodRow466 = baseRow({
      rowKey: 'rod-466', itemNumber: 4, materialId: 'm-rod-alu', materialName: 'Aluminium rod',
      length: 466, width: 20, qty: 2,
    });
    // Brass rod: single length
    const rodRowBrass = baseRow({
      rowKey: 'rod-brass', itemNumber: 5, materialId: 'm-rod-brass', materialName: 'Brass rod',
      length: 300, width: 15, qty: 4,
    });

    const rows = [panelRow1, panelRow2, rodRow958, rodRow466, rodRowBrass];
    const result = partitionLinearMaterial(rows, materials);

    expect(result.panelRows).toEqual([panelRow1, panelRow2]);

    expect(result.linearBreakdowns).toHaveLength(2);

    const alu = result.linearBreakdowns.find((b) => b.materialId === 'm-rod-alu');
    expect(alu).toEqual({
      materialId: 'm-rod-alu',
      materialName: 'Aluminium rod',
      pieces: [
        { lengthMm: 958, qty: 1 },
        { lengthMm: 466, qty: 2 },
      ],
      totalPieceCount: 3,
      totalLengthMm: 958 + 466 * 2,
    });

    const brass = result.linearBreakdowns.find((b) => b.materialId === 'm-rod-brass');
    expect(brass).toEqual({
      materialId: 'm-rod-brass',
      materialName: 'Brass rod',
      pieces: [{ lengthMm: 300, qty: 4 }],
      totalPieceCount: 4,
      totalLengthMm: 1200,
    });
  });

  it('uses the longer planar dimension as the cut length when width exceeds length', () => {
    const rodRow = baseRow({
      rowKey: 'rod-wide', materialId: 'm-rod-alu', materialName: 'Aluminium rod',
      length: 20, width: 500, qty: 1,
    });
    const result = partitionLinearMaterial([rodRow], materials);
    expect(result.linearBreakdowns[0]!.pieces).toEqual([{ lengthMm: 500, qty: 1 }]);
  });

  it('returns empty outputs for empty rows', () => {
    const result = partitionLinearMaterial([], materials);
    expect(result.panelRows).toEqual([]);
    expect(result.linearBreakdowns).toEqual([]);
  });

  it('treats a row whose materialId is not found in the registry as sheet (default)', () => {
    const unknownRow = baseRow({ materialId: 'm-unknown', materialName: 'Unknown' });
    const result = partitionLinearMaterial([unknownRow], materials);
    expect(result.panelRows).toEqual([unknownRow]);
    expect(result.linearBreakdowns).toEqual([]);
  });

  it('keeps a row with an explicit kind: "sheet" material in panelRows', () => {
    const sheetRow = baseRow({ materialId: 'm-birch', materialName: 'Birch' });
    const result = partitionLinearMaterial([sheetRow], materials);
    expect(result.panelRows).toEqual([sheetRow]);
    expect(result.linearBreakdowns).toEqual([]);
  });
});
