// packages/app/src/drawing/__tests__/dxfWriter.color.spec.ts
import { describe, it, expect } from 'vitest';
import { createDxfDocument, hexToAci } from '../dxfWriter';
import { renderDrawingDxf } from '../renderDrawingDxf';
import type { DrawingDocument, DrawingSheet, SectionView } from '@zilventor/shared';

// ── hexToAci palette mapping ─────────────────────────────────────────────────

describe('hexToAci — primary-color mapping', () => {
  it('maps #ff0000 (red) to ACI 1', () => {
    expect(hexToAci('#ff0000')).toBe(1);
  });
  it('maps #00ff00 (green) to ACI 3', () => {
    expect(hexToAci('#00ff00')).toBe(3);
  });
  it('maps #0000ff (blue) to ACI 5', () => {
    expect(hexToAci('#0000ff')).toBe(5);
  });
  it('maps #ffffff (white) to ACI 7', () => {
    expect(hexToAci('#ffffff')).toBe(7);
  });
  it('maps #000000 (near-black) to ACI 7 (default layer)', () => {
    expect(hexToAci('#000000')).toBe(7);
  });
  it('returns 7 for invalid hex string', () => {
    expect(hexToAci('notacolor')).toBe(7);
  });
});

// ── line() with optional ACI color ───────────────────────────────────────────

describe('line() — optional ACI color (group 62)', () => {
  it('emits group 62 when aci arg is provided', () => {
    const doc = createDxfDocument();
    doc.line('SECTION-HATCH', 0, 0, 10, 10, 1);
    const out = doc.toString();
    // group 62 must appear with value 1 in the LINE entity
    expect(/\n\s*62\n\s*1\n/.test(out)).toBe(true);
  });

  it('does NOT emit group 62 when no color arg is given', () => {
    const doc = createDxfDocument();
    doc.line('SECTION-HATCH', 0, 0, 10, 10);
    const out = doc.toString();
    // The ENTITIES section must not contain any group-62 code for entities
    // (group 62 may appear in TABLES for layer colors — so we check the ENTITIES section only)
    const entitiesStart = out.indexOf('\nENTITIES\n');
    const entitiesSection = out.slice(entitiesStart);
    expect(/ 62\n/.test(entitiesSection)).toBe(false);
  });

  it('emits group 62 before the coordinates (between layer group 8 and group 10)', () => {
    const doc = createDxfDocument();
    doc.line('SECTION-HATCH', 0, 0, 10, 10, 3);
    const out = doc.toString();
    const lines = out.split('\n');
    const lineIdx = lines.findIndex((l) => l.trim() === 'LINE');
    expect(lineIdx).toBeGreaterThan(-1);
    const entityBlock = lines.slice(lineIdx, lineIdx + 20).join('\n');
    // group 62 should appear with value 3
    expect(/ 62\n\s*3/.test(entityBlock)).toBe(true);
  });
});

// ── renderDrawingDxf — hatch color passes ACI to SECTION-HATCH LINE entities ─

function makeColoredSectionSheet(): DrawingSheet {
  const sectionView: SectionView = {
    id: 'sv1',
    kind: 'section',
    label: 'A',
    parentViewId: 'base1',
    sectionLine: { p0: { x: 0, y: 25 }, p1: { x: 50, y: 25 } },
    arrowDirection: 1,
    positionMm: { x: 50, y: 50 },
    scale: { numerator: 1, denominator: 1 },
    showHidden: false,
    mode: 'full',
    hatchSegments: [
      { p0: { x: 0, y: 0 }, p1: { x: 5, y: 5 }, materialId: 'm1', color: '#ff0000' }, // ACI 1
    ],
    fingerprint: 'fp1',
    projection: {
      visibleEdges: [{ id: 'e1', kind: 'outline', points: [[0, 0], [10, 10]] }],
      hiddenEdges: [],
      bbox: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    },
  };
  return {
    id: 'sh1',
    name: 'Sheet 1',
    size: { kind: 'iso', size: 'A4' },
    orientation: 'landscape',
    views: [sectionView],
    dimensions: [],
    annotations: [],
    titleBlock: {},
    dimensionGroups: [],
  };
}

function makeDrawing(sheet: DrawingSheet): DrawingDocument {
  return {
    id: 'd1', name: 'DxfColorTest', units: 'mm',
    source: { partPath: 'parts/p1.zipt', sourceKind: 'part' },
    properties: {},
    sheets: [sheet],
    activeSheetId: sheet.id,
  };
}

describe('renderDrawingDxf — hatch ACI color (Task 8)', () => {
  it('a #ff0000 hatch segment produces a SECTION-HATCH LINE with group 62 = 1', () => {
    const sheet = makeColoredSectionSheet();
    const out = renderDrawingDxf(makeDrawing(sheet), sheet, null);

    expect(out).toContain('SECTION-HATCH');
    // Find the SECTION-HATCH LINE entity block and check for group 62 = 1
    const lines = out.split('\n');
    // Look for LINE entities on SECTION-HATCH layer
    let found = false;
    for (let i = 0; i < lines.length - 4; i++) {
      if (lines[i]!.trim() === 'LINE' &&
          lines[i + 1]!.trim() === '8' &&
          lines[i + 2]!.trim() === 'SECTION-HATCH') {
        // Found a SECTION-HATCH LINE entity; look for group 62 within next 10 lines
        const block = lines.slice(i, i + 15).join('\n');
        if (/ 62\n\s*1\n/.test(block)) {
          found = true;
          break;
        }
      }
    }
    expect(found, 'Expected to find SECTION-HATCH LINE with group 62=1').toBe(true);
  });

  it('a color-less hatch segment produces a SECTION-HATCH LINE without group 62', () => {
    const sectionView: SectionView = {
      id: 'sv1', kind: 'section', label: 'A', parentViewId: 'base1',
      sectionLine: { p0: { x: 0, y: 25 }, p1: { x: 50, y: 25 } },
      arrowDirection: 1,
      positionMm: { x: 50, y: 50 },
      scale: { numerator: 1, denominator: 1 },
      showHidden: false, mode: 'full',
      hatchSegments: [
        { p0: { x: 0, y: 0 }, p1: { x: 5, y: 5 }, materialId: 'm1' }, // no color
      ],
      fingerprint: 'fp1',
      projection: {
        visibleEdges: [{ id: 'e1', kind: 'outline', points: [[0, 0], [10, 10]] }],
        hiddenEdges: [],
        bbox: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
      },
    };
    const sheet: DrawingSheet = {
      id: 'sh1', name: 'Sheet 1',
      size: { kind: 'iso', size: 'A4' }, orientation: 'landscape',
      views: [sectionView], dimensions: [], annotations: [], titleBlock: {}, dimensionGroups: [],
    };
    const out = renderDrawingDxf(makeDrawing(sheet), sheet, null);
    const lines = out.split('\n');
    let entityHasColor = false;
    for (let i = 0; i < lines.length - 4; i++) {
      if (lines[i]!.trim() === 'LINE' &&
          lines[i + 1]!.trim() === '8' &&
          lines[i + 2]!.trim() === 'SECTION-HATCH') {
        const block = lines.slice(i, i + 15).join('\n');
        if (/ 62\n/.test(block)) {
          entityHasColor = true;
        }
      }
    }
    expect(entityHasColor, 'Color-less hatch should NOT emit group 62').toBe(false);
  });
});
