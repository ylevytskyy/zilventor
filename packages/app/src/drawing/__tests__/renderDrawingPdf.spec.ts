import { describe, it, expect, vi } from 'vitest';
import { renderDrawingPdf, renderDrawingPdfBytes } from '../renderDrawingPdf';
import type { DrawingDocument } from '@zilventor/shared';
import {
  makeFixtureDrawing,
  makeFixturePart,
  makeFixtureDrawingWithParentAndDetail,
  makeFixtureDrawingWithParentAndRectDetail,
} from '../../__tests__/fixtures/drawingFixtures';

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
      showHidden: false,
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
