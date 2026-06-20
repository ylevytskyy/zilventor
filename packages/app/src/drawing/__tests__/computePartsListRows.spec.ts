// packages/app/src/drawing/__tests__/computePartsListRows.spec.ts
// SLICE 1 RED: computePartsListRows unit tests
import { describe, it, expect } from 'vitest';
import type { AssemblyDocument, PartInfo } from '@zilventor/shared';
import type { MaterialEntry } from '@zilventor/shared/src/material';
import type { PanelSpec } from '@zilventor/shared/src/panel-feature';
import { computePartsListRows } from '../computePartsListRows';

function makeAssembly(overrides: Partial<AssemblyDocument> = {}): AssemblyDocument {
  return {
    id: 'asm1',
    name: 'Cabinet',
    units: 'mm',
    parameters: {},
    components: [
      { id: 'c1', partPath: 'parts/side.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
      { id: 'c2', partPath: 'parts/side.zipt', position: { x: 600, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
      { id: 'c3', partPath: 'parts/shelf.zipt', position: { x: 0, y: 300, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
      { id: 'c4', partPath: 'hardware/hinge.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
    ],
    constraints: [],
    groundedComponentPaths: [],
    colors: {},
    bomItemNumbers: {},
    cutListItemNumbers: {},
    colorOverrides: {},
    properties: {},
    materials: [
      { id: 'mat-oak', name: 'Oak', hatchAngleDeg: 45, hatchSpacingMm: 2, color: '#a0522d' },
    ] as MaterialEntry[],
    hardware: [],
    ...overrides,
  };
}

function makeSubAsmCache() {
  return { get: (_p: string) => undefined };
}

function makePanelSpecs(): Map<string, PanelSpec | null> {
  return new Map([
    ['parts/side.zipt', {
      length: 720, width: 400, thickness: 18,
      materialId: 'mat-oak',
      grain: 'length' as const,
      edgeBands: { front: null, back: null, left: null, right: { materialId: 'mat-oak', thickness: 0.4 } },
    }],
    ['parts/shelf.zipt', {
      length: 564, width: 380, thickness: 18,
      materialId: 'mat-oak',
      grain: 'none' as const,
      edgeBands: { front: { materialId: 'mat-oak', thickness: 0.4 }, back: null, left: null, right: null },
    }],
    // hardware/hinge.zipt NOT in panelSpecs → hardware row
  ]);
}

function makePartInfo(): Map<string, PartInfo> {
  return new Map([
    ['parts/side.zipt', { name: 'Side Panel', path: 'parts/side.zipt' }],
    ['parts/shelf.zipt', { name: 'Shelf', path: 'parts/shelf.zipt' }],
    ['hardware/hinge.zipt', { name: 'Hinge M6', path: 'hardware/hinge.zipt' }],
  ]);
}

describe('computePartsListRows', () => {
  it('returns one row per unique panel spec, sorted by item number', () => {
    const rows = computePartsListRows(
      makeAssembly(),
      makeSubAsmCache(),
      makePanelSpecs(),
      makePartInfo(),
    );
    // side (qty 2), shelf (qty 1), hinge (qty 1 — hardware/cold)
    expect(rows.length).toBe(3);
    // sorted by item number ascending
    expect(rows[0]!.item).toBeLessThanOrEqual(rows[1]!.item);
    expect(rows[1]!.item).toBeLessThanOrEqual(rows[2]!.item);
  });

  it('accumulates qty correctly (two sides → qty 2)', () => {
    const rows = computePartsListRows(
      makeAssembly(),
      makeSubAsmCache(),
      makePanelSpecs(),
      makePartInfo(),
    );
    const sideRow = rows.find((r) => r.partName === 'Side Panel');
    expect(sideRow).toBeDefined();
    expect(sideRow!.qty).toBe(2);
  });

  it('populates material name from the panel spec', () => {
    const rows = computePartsListRows(
      makeAssembly(),
      makeSubAsmCache(),
      makePanelSpecs(),
      makePartInfo(),
    );
    const sideRow = rows.find((r) => r.partName === 'Side Panel');
    expect(sideRow!.material).toBe('Oak');
  });

  it('formats dimensions as LxWxT (no grain normalisation in display)', () => {
    const rows = computePartsListRows(
      makeAssembly(),
      makeSubAsmCache(),
      makePanelSpecs(),
      makePartInfo(),
    );
    const sideRow = rows.find((r) => r.partName === 'Side Panel');
    // Expect "720×400×18" — L=length, W=width, T=thickness
    expect(sideRow!.dimensions).toMatch(/720/);
    expect(sideRow!.dimensions).toMatch(/18/);
  });

  it('hardware row (not in panelSpecs) has empty material and dimensions', () => {
    const rows = computePartsListRows(
      makeAssembly(),
      makeSubAsmCache(),
      makePanelSpecs(),
      makePartInfo(),
    );
    const hwRow = rows.find((r) => r.partName === 'Hinge M6');
    expect(hwRow).toBeDefined();
    expect(hwRow!.material).toBe('');
    expect(hwRow!.dimensions).toBe('');
  });

  it('cold-cache fallback: empty panelSpecs → all rows have empty material/dims, but BOM rows still present', () => {
    const rows = computePartsListRows(
      makeAssembly(),
      makeSubAsmCache(),
      new Map(), // empty cache
      makePartInfo(),
    );
    // all 3 unique part paths present as BOM rows
    expect(rows.length).toBe(3);
    // all have empty material/dims (cold cache)
    for (const row of rows) {
      expect(row.material).toBe('');
      expect(row.dimensions).toBe('');
    }
  });

  it('includes edgeBands summary string when at least one edge is banded', () => {
    const rows = computePartsListRows(
      makeAssembly(),
      makeSubAsmCache(),
      makePanelSpecs(),
      makePartInfo(),
    );
    // shelf has front edge band
    const shelfRow = rows.find((r) => r.partName === 'Shelf');
    expect(shelfRow!.edgeBands).not.toBe('');
    // hinge (hardware) has no edge bands
    const hwRow = rows.find((r) => r.partName === 'Hinge M6');
    expect(hwRow!.edgeBands).toBe('');
  });

  it('returns item numbers as consecutive positive integers starting from 1', () => {
    const rows = computePartsListRows(
      makeAssembly(),
      makeSubAsmCache(),
      makePanelSpecs(),
      makePartInfo(),
    );
    const items = rows.map((r) => r.item).sort((a, b) => a - b);
    expect(items[0]).toBe(1);
    expect(items.every((n, i) => n === i + 1)).toBe(true);
  });
});
