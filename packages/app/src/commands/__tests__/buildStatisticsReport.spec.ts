// @vitest-environment node
/**
 * buildStatisticsReport — TDD spec (P4 W3, ABF-parity five-category cost report).
 *
 * Hand-computed fixture covers all 5 categories, per-doc price override beating
 * the app-global default price book, an unpriced line in two categories, and
 * the linear-material per-piece breakdown surviving onto the report line.
 */
import { describe, it, expect } from 'vitest';
import { buildStatisticsReport } from '../buildStatisticsReport';
import type { HardwareRow } from '../../assembly/walkers/aggregateHardwareRecursive';
import type { ConnectorBomRow } from '../../shell/ConnectorBomTable';
import type { CutListRow, EdgeBandTotal } from '@zilventor/shared/src/cutListRow';
import type { LinearMaterialBreakdown } from '@zilventor/shared/src/linearMaterial';

const baseRow = (overrides: Partial<CutListRow> = {}): CutListRow => ({
  rowKey: 'k1',
  itemNumber: 1,
  qty: 1,
  length: 600,
  width: 400,
  thickness: 18,
  materialId: 'm1',
  materialName: 'Birch',
  grain: 'length',
  edgeBands: { front: null, back: null, left: null, right: null },
  partPath: 'p.zipt',
  partName: 'Side',
  componentPathKeys: ['c1'],
  ...overrides,
});

describe('buildStatisticsReport', () => {
  const hardwareRows: HardwareRow[] = [
    { skuId: 'h1', name: 'Hinge 110deg', category: 'hinges', qty: 4, notes: '' },
    { skuId: 'h2', name: 'Slide 500mm', category: 'drawerSlides', qty: 2, notes: '' },
  ];

  const connectorRows: ConnectorBomRow[] = [
    { kind: 'confirmat', name: 'Confirmat 7x50', qty: 10, notes: '' },
    { kind: 'dowel', name: 'Dowel 8x30', qty: 6, notes: '' },
  ];

  const bandTotals: EdgeBandTotal[] = [
    { materialId: 'eb1', materialName: 'PVC White', totalLengthMm: 1200 },
  ];

  const linearBreakdowns: LinearMaterialBreakdown[] = [
    {
      materialId: 'lm1',
      materialName: 'Aluminium rod',
      pieces: [{ lengthMm: 958, qty: 1 }, { lengthMm: 466, qty: 2 }],
      totalPieceCount: 3,
      totalLengthMm: 1890,
    },
  ];

  const panelRows: CutListRow[] = [
    baseRow({ rowKey: 'panel-a', itemNumber: 1, materialId: 'm1', materialName: 'Birch', length: 600, width: 400, qty: 2 }),
    baseRow({ rowKey: 'panel-b', itemNumber: 2, materialId: 'm1', materialName: 'Birch', length: 300, width: 200, qty: 1 }),
  ];

  const unitPrices: Record<string, number> = {
    'hardware:h1': 5.5,       // overrides the default price book below
    'edgeband:eb1': 0.02,     // per-mm
    'material:m1': 50,        // per m²
  };

  const defaultPriceBook: Record<string, number> = {
    'hardware:h1': 5.0,       // beaten by per-doc override
    'connector:confirmat': 0.8,
    'linear:lm1': 0.01,       // per-mm
  };

  it('assembles 5 priced sections with correct per-line math, subtotals, grand total, unpriced count', () => {
    const report = buildStatisticsReport({
      hardwareRows,
      connectorRows,
      bandTotals,
      linearBreakdowns,
      panelRows,
      unitPrices,
      defaultPriceBook,
    });

    expect(report.sections).toHaveLength(5);
    const byCategory = Object.fromEntries(report.sections.map((s) => [s.category, s]));
    expect(Object.keys(byCategory).sort()).toEqual(
      ['connectors', 'edgeband', 'hardware', 'linear', 'panels'].sort(),
    );

    // --- hardware: h1 priced via per-doc override (beats default), h2 unpriced ---
    const hw = byCategory.hardware!;
    expect(hw.lines).toEqual([
      { key: 'hardware:h1', label: 'Hinge 110deg', qty: 4, unit: 'ea', unitPrice: 5.5, lineTotal: 22 },
      { key: 'hardware:h2', label: 'Slide 500mm', qty: 2, unit: 'ea' },
    ]);
    expect(hw.subtotal).toBe(22);

    // --- connectors: confirmat priced via default book, dowel unpriced ---
    const conn = byCategory.connectors!;
    expect(conn.lines).toEqual([
      { key: 'connector:confirmat', label: 'Confirmat 7x50', qty: 10, unit: 'ea', unitPrice: 0.8, lineTotal: 8 },
      { key: 'connector:dowel', label: 'Dowel 8x30', qty: 6, unit: 'ea' },
    ]);
    expect(conn.subtotal).toBe(8);

    // --- edgeband: priced per-mm via per-doc override ---
    const eb = byCategory.edgeband!;
    expect(eb.lines).toEqual([
      { key: 'edgeband:eb1', label: 'PVC White', qty: 1200, unit: 'mm', unitPrice: 0.02, lineTotal: 24 },
    ]);
    expect(eb.subtotal).toBe(24);

    // --- linear: priced per-mm via default book; pieces[] survives for R5.5 detail ---
    const lin = byCategory.linear!;
    expect(lin.lines).toHaveLength(1);
    expect(lin.lines[0]).toMatchObject({
      key: 'linear:lm1',
      label: 'Aluminium rod',
      qty: 1890,
      unit: 'mm',
      unitPrice: 0.01,
      pieces: [{ lengthMm: 958, qty: 1 }, { lengthMm: 466, qty: 2 }],
    });
    expect(lin.lines[0]!.lineTotal).toBeCloseTo(18.9, 6);
    expect(lin.subtotal).toBeCloseTo(18.9, 6);

    // --- panels: grouped by material, area in m^2 (600*400*2 + 300*200*1) / 1e6 = 0.54 ---
    const panels = byCategory.panels!;
    expect(panels.lines).toEqual([
      { key: 'material:m1', label: 'Birch', qty: 0.54, unit: 'm2', unitPrice: 50, lineTotal: 27 },
    ]);
    expect(panels.subtotal).toBe(27);

    // --- grand total === sum of subtotals === hand-computed value ---
    expect(report.grandTotal).toBeCloseTo(22 + 8 + 24 + 18.9 + 27, 6);
    expect(report.grandTotal).toBeCloseTo(
      report.sections.reduce((s, sec) => s + sec.subtotal, 0),
      6,
    );

    // --- unpriced: h2 + dowel = 2 ---
    expect(report.unpricedLineCount).toBe(2);
  });

  it('always emits all 5 sections with subtotal 0 when there is no data at all', () => {
    const report = buildStatisticsReport({
      hardwareRows: [],
      connectorRows: [],
      bandTotals: [],
      linearBreakdowns: [],
      panelRows: [],
      unitPrices: {},
      defaultPriceBook: {},
    });
    expect(report.sections).toHaveLength(5);
    for (const section of report.sections) {
      expect(section.lines).toEqual([]);
      expect(section.subtotal).toBe(0);
    }
    expect(report.grandTotal).toBe(0);
    expect(report.unpricedLineCount).toBe(0);
  });
});
