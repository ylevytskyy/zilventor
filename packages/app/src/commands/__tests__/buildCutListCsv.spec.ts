import { describe, expect, it } from 'vitest';
import { buildCutListCsv } from '../buildCutListCsv';
import type { CutListResult } from '@zilventor/shared/src/cutListRow';

const empty: CutListResult = { rows: [], bandTotals: [], excluded: { componentCount: 0, partCount: 0 } };

describe('buildCutListCsv', () => {
  it('emits headers + exclusion line for an empty result', () => {
    const csv = buildCutListCsv(empty);
    expect(csv).toContain('Item#,QTY,Material,L (mm),W (mm),T (mm),Grain,Front,Back,Left,Right,Part Name,Part Path');
    expect(csv).toContain('Edge Band Material,Total Length (mm),Total Length (m)');
    expect(csv).toContain('Excluded from cut list,0 components,0 distinct parts');
  });

  it('emits a panel-rows section + band-totals + exclusion footer', () => {
    const result: CutListResult = {
      rows: [{
        rowKey: 'k1', itemNumber: 1, qty: 3,
        length: 600, width: 400, thickness: 18,
        materialId: 'm-birch', materialName: 'Birch 18mm',
        grain: 'length',
        edgeBands: {
          front: { materialId: 'm-pvc', materialName: 'PVC 1mm white' },
          back: null, left: null,
          right: { materialId: 'm-pvc', materialName: 'PVC 1mm white' },
        },
        partPath: 'parts/side.zipt', partName: 'Side',
        componentPathKeys: [],
      }],
      bandTotals: [{ materialId: 'm-pvc', materialName: 'PVC 1mm white', totalLengthMm: 3000 }],
      excluded: { componentCount: 5, partCount: 2 },
    };
    const csv = buildCutListCsv(result);
    expect(csv).toContain('1,3,Birch 18mm,600,400,18,length,PVC 1mm white,,,PVC 1mm white,Side,parts/side.zipt');
    expect(csv).toContain('PVC 1mm white,3000,3.000');
    expect(csv).toContain('Excluded from cut list,5 components,2 distinct parts');
  });

  it('RFC-4180 quotes cells containing commas, quotes, or newlines', () => {
    const result: CutListResult = {
      ...empty,
      rows: [{
        rowKey: 'k', itemNumber: 1, qty: 1, length: 600, width: 400, thickness: 18,
        materialId: 'm', materialName: 'Comma, name',
        grain: 'length',
        edgeBands: { front: null, back: null, left: null, right: null },
        partPath: 'p', partName: 'Quoted "X"',
        componentPathKeys: [],
      }],
    };
    const csv = buildCutListCsv(result);
    expect(csv).toContain('"Comma, name"');
    expect(csv).toContain('"Quoted ""X"""');
  });

  it('serialises numeric columns without trailing zeros', () => {
    const result: CutListResult = {
      ...empty,
      rows: [{
        rowKey: 'k', itemNumber: 1, qty: 1,
        length: 600, width: 400.5, thickness: 18,
        materialId: 'm', materialName: 'M',
        grain: 'none',
        edgeBands: { front: null, back: null, left: null, right: null },
        partPath: 'p', partName: 'P',
        componentPathKeys: [],
      }],
    };
    const csv = buildCutListCsv(result);
    expect(csv).toContain(',600,400.5,18,');
  });

  it('formats band-totals m to 3 decimal places', () => {
    const result: CutListResult = {
      ...empty,
      bandTotals: [{ materialId: 'm', materialName: 'X', totalLengthMm: 3600 }],
    };
    expect(buildCutListCsv(result)).toContain('X,3600,3.600');
  });
});
