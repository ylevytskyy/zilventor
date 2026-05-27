// packages/app/src/drawing/__tests__/renderDrawingSvg.hatch.spec.ts
import { describe, it, expect } from 'vitest';
import { renderDrawingSvg } from '../renderDrawingSvg';
import type { DrawingDocument, DrawingSheet, SectionView } from '@zilventor/shared';

function makePart() {
  return {
    id: 'p1', name: 'TestPart', units: 'mm',
    parameters: {}, featureTree: [], properties: {},
    materials: [], hardware: [],
  } as never;
}

function makeSectionSheet(hatchSegments: SectionView['hatchSegments']): DrawingSheet {
  const sectionView: SectionView = {
    id: 'sv1',
    kind: 'section',
    label: 'A',
    parentViewId: 'base1',
    sectionLine: { p0: { x: 0, y: 25 }, p1: { x: 50, y: 25 } },
    arrowDirection: 1,
    positionMm: { x: 100, y: 50 },
    scale: { numerator: 1, denominator: 1 },
    showHidden: false,
    mode: 'full',
    hatchSegments,
    projection: {
      visibleEdges: [
        { id: 'e0', kind: 'outline', points: [[0, 0], [50, 0], [50, 50], [0, 50], [0, 0]] },
      ],
      hiddenEdges: [],
      bbox: { minX: 0, minY: 0, maxX: 50, maxY: 50 },
    },
    fingerprint: 'fp-svg-hatch',
  };

  return {
    id: 'sh1',
    name: 'Sheet 1',
    size: { kind: 'iso', size: 'A3' },
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
    id: 'd1',
    name: 'HatchColorTest',
    units: 'mm',
    source: { partPath: 'parts/p1.zipt', sourceKind: 'part' },
    properties: {},
    sheets: [sheet],
    activeSheetId: sheet.id,
  };
}

describe('renderDrawingSvg — material-colored hatch (Task 7)', () => {
  it('emits <line data-role="hatch"> with stroke matching segment color', () => {
    const sheet = makeSectionSheet([
      { p0: { x: 5, y: 10 }, p1: { x: 45, y: 10 }, materialId: 'mat-color', color: '#0a0b0c' },
    ]);
    const svg = renderDrawingSvg(makeDrawing(sheet), sheet, makePart());
    expect(svg).toContain('data-role="hatch"');
    expect(svg).toContain('stroke="#0a0b0c"');
  });

  it('emits <line data-role="hatch"> with stroke="#000" when color is absent (legacy fallback)', () => {
    const sheet = makeSectionSheet([
      { p0: { x: 5, y: 10 }, p1: { x: 45, y: 10 }, materialId: 'mat-nocolor' },
    ]);
    const svg = renderDrawingSvg(makeDrawing(sheet), sheet, makePart());
    expect(svg).toContain('data-role="hatch"');
    expect(svg).toContain('stroke="#000"');
  });

  it('emits hatch data-material attribute matching materialId', () => {
    const sheet = makeSectionSheet([
      { p0: { x: 5, y: 10 }, p1: { x: 45, y: 10 }, materialId: 'oak-42', color: '#aabbcc' },
    ]);
    const svg = renderDrawingSvg(makeDrawing(sheet), sheet, makePart());
    expect(svg).toContain('data-material="oak-42"');
  });

  it('emits one hatch line per segment', () => {
    const sheet = makeSectionSheet([
      { p0: { x: 5, y: 10 }, p1: { x: 45, y: 10 }, materialId: 'm1', color: '#111111' },
      { p0: { x: 5, y: 15 }, p1: { x: 45, y: 15 }, materialId: 'm2' },
    ]);
    const svg = renderDrawingSvg(makeDrawing(sheet), sheet, makePart());
    const hatchCount = (svg.match(/data-role="hatch"/g) ?? []).length;
    expect(hatchCount).toBe(2);
  });

  it('does not emit hatch markup for non-section views', () => {
    // A base view (not section) should not produce any hatch markup
    const baseSheet: DrawingSheet = {
      id: 'sh-base',
      name: 'Sheet 1',
      size: { kind: 'iso', size: 'A3' },
      orientation: 'landscape',
      views: [{
        id: 'bv1',
        kind: 'base',
        positionMm: { x: 50, y: 50 },
        scale: { numerator: 1, denominator: 1 },
        orientation: 'front',
        showHidden: false,
        projection: {
          visibleEdges: [{ id: 'e1', kind: 'outline', points: [[0, 0], [10, 0]] }],
          hiddenEdges: [],
          bbox: { minX: 0, minY: 0, maxX: 10, maxY: 0 },
        },
        inputFingerprint: 'fp-base',
      }],
      dimensions: [],
      annotations: [],
      titleBlock: {},
      dimensionGroups: [],
    };
    const drawing = makeDrawing(baseSheet);
    const svg = renderDrawingSvg(drawing, baseSheet, makePart());
    expect(svg).not.toContain('data-role="hatch"');
  });
});
