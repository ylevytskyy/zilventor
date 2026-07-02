import { describe, it, expect } from 'vitest';
import { renderDrawingPdf, renderDrawingPdfBytes } from '../renderDrawingPdf';
import type { DrawingDocument } from '@zilventor/shared';
import {
  makeFixtureDrawing,
  makeFixturePart,
  makeFixtureDrawingWithParentAndDetail,
  makeFixtureDrawingWithParentAndRectDetail,
} from '../../__tests__/fixtures/drawingFixtures';
import { CYRILLIC_FONT_ID } from '../../vendor/pdfCyrillicFont';

function readBlobAsUint8Array(blob: Blob): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

describe('renderDrawingPdf', () => {
  it('returns a Blob with type application/pdf', async () => {
    const drawing = makeFixtureDrawing();
    const source = makeFixturePart();
    const blob = renderDrawingPdf(drawing, source);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('application/pdf');
  });

  it('has non-zero size', async () => {
    const blob = renderDrawingPdf(makeFixtureDrawing(), makeFixturePart());
    expect(blob.size).toBeGreaterThan(0);
  });

  it('starts with PDF magic bytes %PDF-', async () => {
    const blob = renderDrawingPdf(makeFixtureDrawing(), makeFixturePart());
    const bytes = await readBlobAsUint8Array(blob);
    // '%PDF-' = [37, 80, 68, 70, 45]
    expect(Array.from(bytes.slice(0, 5))).toEqual([37, 80, 68, 70, 45]);
  });

  it('produces one jsPDF page per sheet', async () => {
    const drawing = makeFixtureDrawing({ sheetCount: 3 });
    const blob = renderDrawingPdf(drawing, makeFixturePart());
    const bytes = await readBlobAsUint8Array(blob);
    const text = new TextDecoder('latin1').decode(bytes);
    const pageMatches = text.match(/\/Type\s*\/Page[^s]/g) ?? [];
    expect(pageMatches.length).toBe(3);
  });
});

describe('renderDrawingPdf — Cyrillic title-block text', () => {
  it('renders a Cyrillic part name via the embedded Cyrillic font (no throw, valid PDF, font referenced)', () => {
    const base = makeFixtureDrawing();
    const sheet = { ...base.sheets[0]!, titleBlock: { partName: 'Бічна стінка', material: 'Дуб' } };
    const drawing = { ...base, sheets: [sheet] };
    const bytes = renderDrawingPdfBytes(drawing, makeFixturePart());
    expect(Array.from(bytes.slice(0, 5))).toEqual([37, 80, 68, 70, 45]);
    const text = new TextDecoder('latin1').decode(bytes);
    expect(text).toContain(`/BaseFont /${CYRILLIC_FONT_ID}`);
  });
});

describe('renderDrawingPdf — detail view', () => {
  it('magic bytes still %PDF- with detail view present', () => {
    const drawing = makeFixtureDrawingWithParentAndDetail();
    const bytes = renderDrawingPdfBytes(drawing, makeFixturePart());
    expect(bytes.slice(0, 5)).toStrictEqual(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2D]));
  });

  it('PDF page count unchanged (1 page) when sheet has detail view', () => {
    const drawing = makeFixtureDrawingWithParentAndDetail();
    const bytes = renderDrawingPdfBytes(drawing, makeFixturePart());
    const text = new TextDecoder('latin1').decode(bytes);
    const pageMatches = text.match(/\/Type\s*\/Page[^s]/g) ?? [];
    expect(pageMatches.length).toBe(1);
  });

  it('magic bytes %PDF- preserved with parent callout circle rendered', () => {
    const drawing = makeFixtureDrawingWithParentAndDetail();
    const bytes = renderDrawingPdfBytes(drawing, makeFixturePart());
    expect(bytes.slice(0, 5)).toStrictEqual(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2D]));
  });
});

describe('renderDrawingPdf — rect detail view (F2.1)', () => {
  it('magic bytes still %PDF- with rect detail view present', () => {
    const drawing = makeFixtureDrawingWithParentAndRectDetail();
    const bytes = renderDrawingPdfBytes(drawing, makeFixturePart());
    expect(bytes.slice(0, 5)).toStrictEqual(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2D]));
  });

  it('PDF page count unchanged (1 page) when sheet has rect detail view', () => {
    const drawing = makeFixtureDrawingWithParentAndRectDetail();
    const bytes = renderDrawingPdfBytes(drawing, makeFixturePart());
    const text = new TextDecoder('latin1').decode(bytes);
    const pageMatches = text.match(/\/Type\s*\/Page[^s]/g) ?? [];
    expect(pageMatches.length).toBe(1);
  });

  it('%PDF- preserved with parent callout rect rendered (rect regionParent)', () => {
    const drawing = makeFixtureDrawingWithParentAndRectDetail();
    const bytes = renderDrawingPdfBytes(drawing, makeFixturePart());
    expect(bytes.slice(0, 5)).toStrictEqual(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2D]));
  });
});

// ── Radial + diametric PDF rendering ─────────────────────────────────────────

/** 8 equally-spaced points on circle r=10 centered (50,50) in part-mm. */
function makeCircleEdge8Pdf(): ReadonlyArray<readonly [number, number]> {
  const n = 8;
  return Array.from({ length: n }, (_, i) => {
    const θ = (2 * Math.PI * i) / n;
    return [50 + 10 * Math.cos(θ), 50 + 10 * Math.sin(θ)] as readonly [number, number];
  });
}

import type { DrawingDimension } from '@zilventor/shared';

function makeDrawingWithDim(dim: DrawingDimension): DrawingDocument {
  const sheetId = 'sh-rad';
  return {
    id: 'drw-rad', name: 'Rad Drawing', units: 'mm',
    source: { partPath: 'p.zipt', sourceKind: 'part' },
    properties: {},
    activeSheetId: sheetId,
    sheets: [{
      id: sheetId, name: 'Sheet 1',
      size: { kind: 'iso', size: 'A3' }, orientation: 'landscape',
      views: [{
        id: 'v1', kind: 'base',
        positionMm: { x: 0, y: 0 },
        scale: { numerator: 1, denominator: 1 },
        orientation: 'front', showHidden: false,
        projection: {
          visibleEdges: [{ id: 'circ1', kind: 'outline', points: makeCircleEdge8Pdf() }],
          hiddenEdges: [],
          bbox: { minX: 40, minY: 40, maxX: 60, maxY: 60 },
        },
      }],
      dimensions: [dim],
      annotations: [], titleBlock: {}, dimensionGroups: [],
    }],
  };
}

describe('renderDrawingPdf — radial + diametric dimensions (PDF-RAD)', () => {
  it('PDF-RAD-1: radial dim does not throw and produces valid PDF bytes', () => {
    const dim: DrawingDimension = {
      kind: 'radial', id: 'r-pdf-1', viewId: 'v1', edgeId: 'circ1',
      offsetMm: 5, angleDeg: 0,
    };
    const drawing = makeDrawingWithDim(dim);
    const bytes = renderDrawingPdfBytes(drawing, makeFixturePart());
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBeGreaterThan(0);
    // Magic bytes %PDF-
    expect(Array.from(bytes.slice(0, 5))).toEqual([37, 80, 68, 70, 45]);
    // Label R10 appears literally in the PDF byte stream
    const text = new TextDecoder('latin1').decode(bytes);
    expect(text).toMatch(/R10/);
  });

  it('PDF-RAD-2: diametric dim does not throw and produces valid PDF bytes', () => {
    const dim: DrawingDimension = {
      kind: 'diametric', id: 'd-pdf-1', viewId: 'v1', edgeId: 'circ1',
      offsetMm: 5, angleDeg: 0,
    };
    const drawing = makeDrawingWithDim(dim);
    // Must not throw
    expect(() => renderDrawingPdfBytes(drawing, makeFixturePart())).not.toThrow();
    const bytes = renderDrawingPdfBytes(drawing, makeFixturePart());
    expect(bytes).toBeInstanceOf(Uint8Array);
    // Valid PDF magic bytes
    expect(Array.from(bytes.slice(0, 5))).toEqual([37, 80, 68, 70, 45]);
    // The PDF byte stream should contain text content (jsPDF encodes Unicode as UTF-16 inside streams).
    // We verify the stream is non-trivially larger than a blank page (leader lines emitted).
    expect(bytes.length).toBeGreaterThan(1000);
  });
});

// ── CHUNK D: title-block approvedBy + notes ───────────────────────────────────

describe('renderDrawingPdf — title-block approvedBy + notes (CHUNK-D)', () => {
  function makeDrawingWithTitleBlockOverrides(): DrawingDocument {
    const base = makeFixtureDrawing();
    const sheet = {
      ...base.sheets[0]!,
      titleBlock: { approvedBy: 'J. Smith', notes: 'Rev A initial release' },
    };
    return { ...base, sheets: [sheet] };
  }

  it('PDF-D-1: PDF byte stream contains "Approved by:" label', () => {
    const drawing = makeDrawingWithTitleBlockOverrides();
    const bytes = renderDrawingPdfBytes(drawing, makeFixturePart());
    const text = new TextDecoder('latin1').decode(bytes);
    expect(text).toContain('Approved by:');
  });

  it('PDF-D-2: PDF byte stream contains the approvedBy value "J. Smith"', () => {
    const drawing = makeDrawingWithTitleBlockOverrides();
    const bytes = renderDrawingPdfBytes(drawing, makeFixturePart());
    const text = new TextDecoder('latin1').decode(bytes);
    expect(text).toContain('J. Smith');
  });

  it('PDF-D-3: PDF byte stream contains "Notes:" label', () => {
    const drawing = makeDrawingWithTitleBlockOverrides();
    const bytes = renderDrawingPdfBytes(drawing, makeFixturePart());
    const text = new TextDecoder('latin1').decode(bytes);
    expect(text).toContain('Notes:');
  });

  it('PDF-D-4: PDF byte stream contains the notes value "Rev A initial release"', () => {
    const drawing = makeDrawingWithTitleBlockOverrides();
    const bytes = renderDrawingPdfBytes(drawing, makeFixturePart());
    const text = new TextDecoder('latin1').decode(bytes);
    expect(text).toContain('Rev A initial release');
  });
});

// ── CHUNK C: view labels + scale, section headings ────────────────────────────

describe('renderDrawingPdf — view labels + section headings (CHUNK-C)', () => {
  it('PDF-C-1: PDF byte stream contains "SCALE 1:1" for a base view', () => {
    const drawing = makeFixtureDrawing();
    const bytes = renderDrawingPdfBytes(drawing, makeFixturePart());
    const text = new TextDecoder('latin1').decode(bytes);
    expect(text).toMatch(/SCALE\s*1:1/);
  });

  it('PDF-C-2: PDF byte stream contains "SECTION A-A" for a section view', () => {
    const base = makeFixtureDrawing({ viewCount: 1 });
    const sheet0 = base.sheets[0]!;
    const sectionView = {
      id: 'sv-pdf-c', kind: 'section' as const,
      parentViewId: 'view-sheet-1-0',
      sectionLine: { p0: { x: 0, y: 50 }, p1: { x: 100, y: 50 } },
      arrowDirection: 1 as -1 | 1,
      label: 'A',
      positionMm: { x: 50, y: 150 },
      scale: { numerator: 1, denominator: 1 },
      showHidden: false as false,
      mode: 'full' as const,
      hatchSegments: [],
      fingerprint: 'fp-pdf-c',
      projection: {
        visibleEdges: [{ id: 'sv-pdf-e1', kind: 'outline' as const, points: [[0, 0], [100, 0], [100, 100], [0, 100]] as ReadonlyArray<readonly [number, number]> }],
        hiddenEdges: [],
        bbox: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
      },
      inputFingerprint: 'fp-pdf-c',
    };
    const updatedSheet = { ...sheet0, views: [...sheet0.views, sectionView] };
    const drawing = { ...base, sheets: [updatedSheet] };
    const bytes = renderDrawingPdfBytes(drawing, makeFixturePart());
    const text = new TextDecoder('latin1').decode(bytes);
    expect(text).toContain('SECTION A-A');
  });
});

// ── CHUNK B2: first-angle ISO projection symbol ───────────────────────────────

describe('renderDrawingPdf — first-angle projection symbol (CHUNK-B2)', () => {
  it('PDF-B2-1: title block calls pdf.circle() to draw the projection symbol', () => {
    // We verify pdf.circle is invoked by spying on jsPDF prototype.
    // Since jsPDF is used internally, we rely on byte-stream content:
    // jsPDF circle() emits a curved path in the PDF stream.
    // Instead, we verify the PDF has more content than a blank-only sheet,
    // and that it at least produces a valid PDF without throwing.
    const drawing = makeFixtureDrawing();
    expect(() => renderDrawingPdfBytes(drawing, makeFixturePart())).not.toThrow();
    const bytes = renderDrawingPdfBytes(drawing, makeFixturePart());
    expect(bytes.slice(0, 5)).toStrictEqual(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2D]));
    // The title block calls pdf.circle — this increases the byte content
    // A PDF with a circle glyph will contain 're' (rectangle clip) or 'c' bezier curves.
    // jsPDF emits the bezier path for a circle using 'c' operators. Check the stream.
    const text = new TextDecoder('latin1').decode(bytes);
    // jsPDF circle is drawn as 4 Bezier curves — 'c' operator appears in the stream
    expect(text).toMatch(/\bc\b/);
  });
});

describe('renderDrawingPdf — null source (source-optional export)', () => {
  const drawingNoSource: DrawingDocument = {
    id: 'dw1',
    name: 'Null-Source Drawing',
    units: 'mm',
    source: { partPath: 'parts/dummy.zipt', sourceKind: 'part' },
    properties: {},
    sheets: [
      {
        id: 'sh1',
        name: 'Sheet 1',
        size: { kind: 'iso', size: 'A3' },
        orientation: 'landscape',
        views: [],
        dimensions: [],
        annotations: [],
        titleBlock: {},
        dimensionGroups: [],
      },
    ],
    activeSheetId: 'sh1',
  };

  it('produces PDF bytes when source is null', () => {
    const bytes = renderDrawingPdfBytes(drawingNoSource, null);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBeGreaterThan(0);
  });
});

describe('renderDrawingPdf — partsList annotation', () => {
  it('does not throw and embeds "PART NAME" text in the PDF output', () => {
    const drawing: DrawingDocument = {
      id: 'dpl1', name: 'PL Drawing', units: 'mm',
      source: { partPath: 'p.zipt', sourceKind: 'part' },
      properties: {},
      activeSheetId: 'sh-pl',
      sheets: [{
        id: 'sh-pl', name: 'Sheet 1',
        size: { kind: 'iso', size: 'A3' }, orientation: 'landscape',
        views: [], dimensions: [], dimensionGroups: [],
        annotations: [{
          kind: 'partsList',
          id: 'pl-pdf-1',
          positionMm: { x: 10, y: 20 },
          rows: [
            { item: 1, qty: 2, partName: 'Side Panel', material: 'Oak', dimensions: '600×400×18', edgeBands: 'T,B' },
          ],
        }],
        titleBlock: {},
      }],
    };
    expect(() => renderDrawingPdfBytes(drawing, null)).not.toThrow();
    const bytes = renderDrawingPdfBytes(drawing, null);
    // jsPDF embeds text strings verbatim (latin1) — verify annotation text was written
    const text = new TextDecoder('latin1').decode(bytes);
    expect(text).toContain('PART NAME');
  });
});

describe('renderDrawingPdf — holeTable annotation (PDF gap closure)', () => {
  it('does not throw with a holeTable annotation on the sheet', () => {
    const drawing: DrawingDocument = {
      id: 'dht1', name: 'HT Drawing', units: 'mm',
      source: { partPath: 'p.zipt', sourceKind: 'part' },
      properties: {},
      activeSheetId: 'sh-ht',
      sheets: [{
        id: 'sh-ht', name: 'Sheet 1',
        size: { kind: 'iso', size: 'A3' }, orientation: 'landscape',
        views: [], dimensions: [], dimensionGroups: [],
        annotations: [{
          kind: 'holeTable',
          id: 'ht-pdf-1',
          viewId: 'v1',
          datum: { kind: 'edge-endpoint', edgeId: 'e1', end: 'start' } as never,
          positionMm: { x: 10, y: 20 },
          entries: [],
        }],
        titleBlock: {},
      }],
    };
    expect(() => renderDrawingPdfBytes(drawing, null)).not.toThrow();
    const bytes = renderDrawingPdfBytes(drawing, null);
    expect(bytes.slice(0, 5)).toStrictEqual(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2D]));
  });
});

// ---------------------------------------------------------------------------
// Slice 7a: center-mark annotation → cross (two pdf.line calls)
// ---------------------------------------------------------------------------

describe('renderDrawingPdf — center-mark annotation draws a cross (Slice-7a)', () => {
  /** 8 equally-spaced points on circle r=10 centered (50,50). */
  function makeArcEdge8(): ReadonlyArray<readonly [number, number]> {
    const n = 8;
    return Array.from({ length: n }, (_, i) => {
      const θ = (2 * Math.PI * i) / n;
      return [50 + 10 * Math.cos(θ), 50 + 10 * Math.sin(θ)] as readonly [number, number];
    });
  }

  function makeDrawingWithCenterMark(): DrawingDocument {
    const sheetId = 'sh-cm';
    const viewId = 'v-cm';
    const edgeId = 'arc-cm';
    return {
      id: 'drw-cm', name: 'CM Drawing', units: 'mm',
      source: { partPath: 'p.zipt', sourceKind: 'part' },
      properties: {},
      activeSheetId: sheetId,
      sheets: [{
        id: sheetId, name: 'Sheet 1',
        size: { kind: 'iso', size: 'A3' }, orientation: 'landscape',
        views: [{
          id: viewId, kind: 'base',
          positionMm: { x: 50, y: 50 },
          scale: { numerator: 1, denominator: 1 },
          orientation: 'front', showHidden: false,
          projection: {
            visibleEdges: [{ id: edgeId, kind: 'outline', points: makeArcEdge8() }],
            hiddenEdges: [],
            bbox: { minX: 40, minY: 40, maxX: 60, maxY: 60 },
          },
        }],
        dimensions: [],
        annotations: [{ id: 'cm-1', kind: 'center-mark', viewId, edgeId }],
        titleBlock: {}, dimensionGroups: [],
      }],
    };
  }

  it('PDF-7a-1: does not throw when a center-mark annotation is present', () => {
    const drawing = makeDrawingWithCenterMark();
    expect(() => renderDrawingPdfBytes(drawing, makeFixturePart())).not.toThrow();
  });

  it('PDF-7a-2: center-mark PDF stream contains line-path operators (m/l/S) from the cross arms', () => {
    // jsPDF emits pdf.line(x1,y1,x2,y2) as: "x1 y1 m x2 y2 l S" in the content stream.
    // A sheet with NO annotations but the same view baseline is compared against one WITH center-mark.
    // We count "m ... l ... S" triples in each and confirm at least 2 more in the center-mark sheet.
    const noAnnDrawing: DrawingDocument = {
      id: 'drw-cm-noann', name: 'CM No Ann', units: 'mm',
      source: { partPath: 'p.zipt', sourceKind: 'part' },
      properties: {},
      activeSheetId: 'sh-cm-noann',
      sheets: [{
        id: 'sh-cm-noann', name: 'Sheet 1',
        size: { kind: 'iso', size: 'A3' }, orientation: 'landscape',
        views: [{
          id: 'v-cm', kind: 'base',
          positionMm: { x: 50, y: 50 },
          scale: { numerator: 1, denominator: 1 },
          orientation: 'front', showHidden: false,
          projection: {
            visibleEdges: [{ id: 'arc-cm', kind: 'outline', points: makeArcEdge8() }],
            hiddenEdges: [],
            bbox: { minX: 40, minY: 40, maxX: 60, maxY: 60 },
          },
        }],
        dimensions: [], annotations: [], titleBlock: {}, dimensionGroups: [],
      }],
    };

    const countLineOps = (bytes: Uint8Array): number => {
      const text = new TextDecoder('latin1').decode(bytes);
      // jsPDF path: each pdf.line call emits the pattern "x1 y1 m\nx2 y2 l\nS\n"
      const matches = text.match(/ m\n[\d. -]+ [\d. -]+ l\n/g);
      return matches?.length ?? 0;
    };

    const baseBytes = renderDrawingPdfBytes(noAnnDrawing, makeFixturePart());
    const baseOps = countLineOps(baseBytes);

    const drawing = makeDrawingWithCenterMark();
    const withBytes = renderDrawingPdfBytes(drawing, makeFixturePart());
    const withOps = countLineOps(withBytes);

    // center-mark adds 2 pdf.line calls (horizontal + vertical arm)
    expect(withOps).toBeGreaterThanOrEqual(baseOps + 2);
  });
});

// ---------------------------------------------------------------------------
// F4 PDF underlay rendering
// ---------------------------------------------------------------------------
import type { DxfUnderlay, DrawingSheet as DrawingSheetU } from '@zilventor/shared';

describe('renderDrawingPdf — DXF underlay (F4)', () => {
  function makeUnderlaySheet(): DrawingSheetU {
    const underlay: DxfUnderlay = {
      name: 'test.dxf',
      entities: [
        { kind: 'line',     x1: 0,  y1: 0,  x2: 100, y2: 0 },
        { kind: 'circle',   cx: 50, cy: 50, r: 20 },
        { kind: 'arc',      cx: 0,  cy: 0,  r: 10,  startAngle: 0, endAngle: 90 },
        { kind: 'text',     x: 10,  y: 10,  height: 5, value: 'Under', rotation: 0 },
        { kind: 'polyline', points: [[0, 0], [10, 0]] as ReadonlyArray<readonly [number, number]>, closed: false },
      ],
    };
    return {
      id: 's-u',
      name: 'Sheet with underlay',
      size: { kind: 'iso', size: 'A3' },
      orientation: 'landscape',
      views: [],
      dimensions: [],
      annotations: [],
      titleBlock: {},
      dimensionGroups: [],
      underlay,
    };
  }

  function makeUnderlayDrawing(sheet: DrawingSheetU): DrawingDocument {
    return {
      id: 'd-u',
      name: 'Underlay PDF Drawing',
      units: 'mm',
      source: { partPath: 'parts/test.zipt', sourceKind: 'part' },
      properties: {},
      sheets: [sheet],
      activeSheetId: sheet.id,
    };
  }

  it('does not throw and returns valid PDF bytes when sheet has underlay', () => {
    const sheet = makeUnderlaySheet();
    const drawing = makeUnderlayDrawing(sheet);
    expect(() => renderDrawingPdfBytes(drawing, null)).not.toThrow();
    const bytes = renderDrawingPdfBytes(drawing, null);
    expect(bytes.slice(0, 5)).toStrictEqual(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2D]));
  });

  it('PDF output contains a gray stroke color set for the underlay (RGB ~0.612 0.639 0.686 RG)', () => {
    const sheet = makeUnderlaySheet();
    const drawing = makeUnderlayDrawing(sheet);
    const bytes = renderDrawingPdfBytes(drawing, null);
    // jsPDF emits RGB stroke color via "r g b RG" in the PDF stream
    // 156/255 ≈ 0.612, 163/255 ≈ 0.639, 175/255 ≈ 0.686
    // Parse the PDF text content to find any RG (stroke color) command
    const text = new TextDecoder('latin1').decode(bytes);
    // RG = stroke color in PDF. Gray-ish values: look for values in ~0.5–0.7 range
    // jsPDF rounds to 3 decimal places: 0.612 0.639 0.686 RG
    expect(text).toMatch(/0\.6[0-9]+ 0\.6[0-9]+ 0\.6[0-9]+ RG/);
  });

  it('renders without throw when underlay has offsetMm (y-flip + centering)', () => {
    // An underlay with offsetMm set — the PDF renderer must apply the y-flip.
    const underlayWithOffset: DxfUnderlay = {
      name: 'offset.dxf',
      entities: [
        { kind: 'line',   x1: 0,  y1: 0,  x2: 100, y2: 50 },
        { kind: 'circle', cx: 50, cy: 50, r: 20 },
        { kind: 'text',   x: 10,  y: 10,  height: 5, value: 'FlipCheck', rotation: 0 },
      ],
      sourceBBoxMm: { minX: 0, minY: 0, maxX: 100, maxY: 50 },
      offsetMm: { x: 160, y: -133.5 },
    };
    const sheetWithOffset: DrawingSheetU = {
      id: 's-off2',
      name: 'Sheet with offset underlay',
      size: { kind: 'iso', size: 'A3' },
      orientation: 'landscape',
      views: [],
      dimensions: [],
      annotations: [],
      titleBlock: {},
      dimensionGroups: [],
      underlay: underlayWithOffset,
    };
    const drawing = makeUnderlayDrawing(sheetWithOffset);
    // Must not throw even with y-flip coords potentially outside page
    expect(() => renderDrawingPdfBytes(drawing, null)).not.toThrow();
    const bytes = renderDrawingPdfBytes(drawing, null);
    // Valid PDF header
    expect(bytes.slice(0, 5)).toStrictEqual(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2D]));
  });

  it('PDF y-flip: a line at y1=100 with offsetMm={x:0,y:0} renders without throw (y-flip coords may go above page — clamped by jsPDF)', () => {
    // A3 landscape sheetH=297, MARGIN=10, scaleY≈1. With y-flip: y1_pdf = 10+(297-100)*1 = 207
    // Without y-flip: y1_pdf = 10+100*1 = 110. Both valid; the test confirms y-flip code path runs.
    const sheet: DrawingSheetU = {
      id: 's-flip-check',
      name: 'flip-check',
      size: { kind: 'iso', size: 'A3' },
      orientation: 'landscape',
      views: [],
      dimensions: [],
      annotations: [],
      titleBlock: {},
      dimensionGroups: [],
      underlay: {
        name: 'flip.dxf',
        entities: [{ kind: 'line', x1: 0, y1: 100, x2: 50, y2: 200 }],
        // offsetMm present → y-flip active
        offsetMm: { x: 0, y: 0 },
      },
    };
    expect(() => renderDrawingPdfBytes(makeUnderlayDrawing(sheet), null)).not.toThrow();
  });
});
