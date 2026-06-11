import { describe, expect, it } from 'vitest';
import { buildCutListCsv } from '../buildCutListCsv';
import type { CutListResult } from '@zilventor/shared/src/cutListRow';
import type { HardwareRow } from '../../assembly/walkers/aggregateHardwareRecursive';
import type { ConnectorBomRow } from '../../shell/ConnectorBomTable';

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

const hardwareRows: HardwareRow[] = [
  { skuId: 'hinge-35mm-cup-full', name: '35mm Cup Hinge — Full Overlay', category: 'hinges',    qty: 2, notes: 'Requires 35mm Forstner bit' },
  { skuId: 'shelf-pin-5mm-steel', name: '5mm Shelf Pin — Steel',          category: 'shelfPins', qty: 8, notes: 'Press-fit into 5mm shelf-pin hole; steel' },
];

const emptyResult = { rows: [], bandTotals: [], excluded: { componentCount: 0, partCount: 0 } };

describe('buildCutListCsv — hardware section', () => {
  it('produces 4 sections: panel rows, edge-band totals, hardware, excluded summary', () => {
    const csv = buildCutListCsv(emptyResult, hardwareRows);
    const sections = csv.split('\n\n');
    // sections[0] = panel header + rows (possibly just header)
    // sections[1] = band header + rows
    // sections[2] = hardware header + rows
    // sections[3] = excluded line
    expect(sections.length).toBeGreaterThanOrEqual(4);
  });

  it('hardware section starts with "# Hardware"', () => {
    const csv = buildCutListCsv(emptyResult, hardwareRows);
    expect(csv).toContain('# Hardware');
  });

  it('hardware section header row is SKU,Name,Category,Qty,Notes', () => {
    const csv = buildCutListCsv(emptyResult, hardwareRows);
    expect(csv).toContain('SKU,Name,Category,Qty,Notes');
  });

  it('hardware data rows contain SKU id and qty', () => {
    const csv = buildCutListCsv(emptyResult, hardwareRows);
    expect(csv).toContain('hinge-35mm-cup-full');
    expect(csv).toContain(',2,');
    expect(csv).toContain('shelf-pin-5mm-steel');
    expect(csv).toContain(',8,');
  });

  it('empty hardwareRows produces a hardware section with header but no data rows', () => {
    const csv = buildCutListCsv(emptyResult, []);
    expect(csv).toContain('# Hardware');
    // Only the header row, no data — slice just the hardware section block.
    const hwIdx = csv.indexOf('# Hardware');
    const nextBlank = csv.indexOf('\n\n', hwIdx);
    const hwSection = csv.slice(hwIdx, nextBlank === -1 ? undefined : nextBlank);
    const lines = hwSection.split('\n').filter((l) => l.trim());
    expect(lines).toHaveLength(2); // "# Hardware" + column header
  });
});

const connectorRows: ConnectorBomRow[] = [
  { kind: 'confirmat', name: 'Confirmat 7×50', qty: 4, notes: 'Ø7 face + Ø5 edge' },
  { kind: 'shelfPin',  name: 'Shelf pin Ø5',   qty: 16, notes: 'система-32' },
];

describe('buildCutListCsv — присадка / Connectors section', () => {
  it('emits "# присадка / Connectors" section header when connectorRows provided', () => {
    const csv = buildCutListCsv(emptyResult, [], connectorRows);
    expect(csv).toContain('# присадка / Connectors');
  });

  it('emits connector column header: Type,Name,Qty,Notes', () => {
    const csv = buildCutListCsv(emptyResult, [], connectorRows);
    expect(csv).toContain('Type,Name,Qty,Notes');
  });

  it('emits connector data rows with correct fields (plain r.kind, no csvCell wrapping)', () => {
    const csv = buildCutListCsv(emptyResult, [], connectorRows);
    expect(csv).toContain('confirmat,Confirmat 7×50,4,Ø7 face + Ø5 edge');
    expect(csv).toContain('shelfPin,Shelf pin Ø5,16,система-32');
  });

  it('does not emit connector section when connectorRows is empty (default)', () => {
    const csv = buildCutListCsv(emptyResult, []);
    expect(csv).not.toContain('# присадка / Connectors');
    expect(csv).not.toContain('Type,Name,Qty,Notes');
  });

  it('CSV-escapes names containing commas', () => {
    const rows: ConnectorBomRow[] = [
      { kind: 'confirmat', name: 'Confirmat, 7×50', qty: 1, notes: '' },
    ];
    const csv = buildCutListCsv(emptyResult, [], rows);
    expect(csv).toContain('"Confirmat, 7×50"');
  });
});
