import { describe, it, expect } from 'vitest';
import { renderDrawingSvg } from '../renderDrawingSvg';
import {
  makeFixtureDrawing,
  makeFixturePart,
  makeFixtureDrawingWithDetailView,
  makeFixtureDrawingWithParentAndDetail,
  makeFixtureDrawingWithRectDetailView,
  makeFixtureDrawingWithParentAndRectDetail,
} from '../../__tests__/fixtures/drawingFixtures';
import type { DetailView, DrawingDocument, DrawingSheet, DrawingView, SectionView } from '@zilventor/shared';

describe('renderDrawingSvg', () => {
  it('returns a string starting with <svg', () => {
    const drawing = makeFixtureDrawing();
    const sheet = drawing.sheets[0]!;
    const result = renderDrawingSvg(drawing, sheet, makeFixturePart());
    expect(typeof result).toBe('string');
    expect(result.trimStart()).toMatch(/^<svg/);
  });

  it('includes a closing </svg> tag', () => {
    const drawing = makeFixtureDrawing();
    const sheet = drawing.sheets[0]!;
    const result = renderDrawingSvg(drawing, sheet, makeFixturePart());
    expect(result).toContain('</svg>');
  });

  it('parses as valid XML', () => {
    const drawing = makeFixtureDrawing();
    const sheet = drawing.sheets[0]!;
    const result = renderDrawingSvg(drawing, sheet, makeFixturePart());
    const parser = new DOMParser();
    const doc = parser.parseFromString(result, 'image/svg+xml');
    const parseError = doc.querySelector('parsererror');
    expect(parseError).toBeNull();
  });

  it('contains a view group for each view in the sheet', () => {
    const drawing = makeFixtureDrawing({ viewCount: 2 });
    const sheet = drawing.sheets[0]!;
    const result = renderDrawingSvg(drawing, sheet, makeFixturePart());
    const viewGroups = result.match(/data-view-id="[^"]+"/g) ?? [];
    expect(viewGroups.length).toBeGreaterThanOrEqual(2);
  });

  it('includes a title block group', () => {
    const drawing = makeFixtureDrawing();
    const sheet = drawing.sheets[0]!;
    const result = renderDrawingSvg(drawing, sheet, makeFixturePart());
    expect(result).toContain('data-title-block');
  });
});

describe('renderDrawingSvg — detail view', () => {
  it('emits <circle data-role="detail-border"> for a detail view', () => {
    const drawing = makeFixtureDrawingWithDetailView();
    const sheet = drawing.sheets[0]!;
    const svg = renderDrawingSvg(drawing, sheet, makeFixturePart());
    expect(svg).toContain('data-role="detail-border"');
  });

  it('emits <text data-role="detail-caption"> containing DETAIL A', () => {
    const drawing = makeFixtureDrawingWithDetailView();
    const sheet = drawing.sheets[0]!;
    const svg = renderDrawingSvg(drawing, sheet, makeFixturePart());
    expect(svg).toContain('data-role="detail-caption"');
    expect(svg).toContain('DETAIL A');
  });

  it('emits scale ratio "2:1" inside the detail caption', () => {
    const drawing = makeFixtureDrawingWithDetailView();
    const sheet = drawing.sheets[0]!;
    const svg = renderDrawingSvg(drawing, sheet, makeFixturePart());
    expect(svg).toContain('2:1');
  });

  it('renders detail view visible edges as <polyline> without any <clipPath>', () => {
    const drawing = makeFixtureDrawingWithDetailView();
    const sheet = drawing.sheets[0]!;
    const svg = renderDrawingSvg(drawing, sheet, makeFixturePart());
    expect(svg).toContain('data-edge-id="de0"');
    expect(svg).not.toContain('<clipPath');
  });

  it('renders detail hidden edges with dashed stroke', () => {
    const base = makeFixtureDrawing({ viewCount: 1 });
    const baseSheet = base.sheets[0]!;
    const detailWithHidden: DetailView = {
      id: 'detail-hidden', kind: 'detail',
      parentViewId: 'view-sheet-1-0',
      regionParent: { kind: 'circle', center: { x: 25, y: 15 }, radiusMm: 10 },
      label: 'B',
      positionMm: { x: 200, y: 150 },
      scale: { numerator: 2, denominator: 1 },
      showHidden: true,
      projection: {
        visibleEdges: [{ id: 'dh-vis', kind: 'outline' as const, points: [[0, 0], [4, 0]] as ReadonlyArray<readonly [number, number]> }],
        hiddenEdges: [{ id: 'dh-hid', kind: 'outline' as const, points: [[0, 3], [4, 3]] as ReadonlyArray<readonly [number, number]> }],
        bbox: { minX: 0, minY: 0, maxX: 4, maxY: 3 },
      },
      inputFingerprint: 'fp-dh',
    };
    const updatedSheet = { ...baseSheet, views: [...baseSheet.views, detailWithHidden] };
    const drawing = {
      ...base,
      sheets: [updatedSheet],
    };
    const svg = renderDrawingSvg(drawing, updatedSheet, makeFixturePart());
    expect(svg).toContain('data-edge-id="dh-hid"');
    expect(svg).toContain('stroke-dasharray');
  });
});

describe('renderDrawingSvg — rect detail view (F2.1)', () => {
  it('emits <rect data-role="detail-border"> for a rect detail view', () => {
    const drawing = makeFixtureDrawingWithRectDetailView();
    const sheet = drawing.sheets[0]!;
    const svg = renderDrawingSvg(drawing, sheet, makeFixturePart());
    expect(svg).toContain('data-role="detail-border"');
    const rectBorderCount = (svg.match(/<rect[^>]*data-role="detail-border"[^>]*>/g) ?? []).length;
    expect(rectBorderCount).toBe(1);
    const circleBorderCount = (svg.match(/<circle[^>]*data-role="detail-border"[^>]*>/g) ?? []).length;
    expect(circleBorderCount).toBe(0);
  });

  it('rect border is centered at origin: x=-widthMm/2, y=-heightMm/2, w=widthMm, h=heightMm', () => {
    // Fixture: widthMm=20, heightMm=12, detail scale=2:1
    // Group has transform="translate(posX,posY) scale(vScale)" — rect coords are in local space
    // (scale(vScale) is applied by SVG). So x=-10, y=-6, width=20, height=12
    const drawing = makeFixtureDrawingWithRectDetailView();
    const sheet = drawing.sheets[0]!;
    const svg = renderDrawingSvg(drawing, sheet, makeFixturePart());
    const borderRectMatch = svg.match(/<rect[^>]*data-role="detail-border"[^>]*/);
    expect(borderRectMatch).not.toBeNull();
    const attrs = borderRectMatch![0]!;
    expect(attrs).toContain('x="-10"');
    expect(attrs).toContain('y="-6"');
    expect(attrs).toContain('width="20"');
    expect(attrs).toContain('height="12"');
  });

  it('emits <text data-role="detail-caption"> containing DETAIL B', () => {
    const drawing = makeFixtureDrawingWithRectDetailView();
    const sheet = drawing.sheets[0]!;
    const svg = renderDrawingSvg(drawing, sheet, makeFixturePart());
    expect(svg).toContain('data-role="detail-caption"');
    expect(svg).toContain('DETAIL B');
  });
});

describe('renderDrawingSvg — rect detail callout overlay (F2.1)', () => {
  it('emits <rect data-role="detail-callout-label"> on parent for rect region', () => {
    const drawing = makeFixtureDrawingWithParentAndRectDetail();
    const sheet = drawing.sheets[0]!;
    const svg = renderDrawingSvg(drawing, sheet, makeFixturePart());
    const borderCount = (svg.match(/data-role="detail-border"/g) ?? []).length;
    const calloutCount = (svg.match(/data-role="detail-callout-label"/g) ?? []).length;
    expect(borderCount).toBe(1);
    expect(calloutCount).toBeGreaterThanOrEqual(1);
    const calloutRectCount = (svg.match(/<rect[^>]*data-role="detail-callout-label"[^>]*/g) ?? []).length;
    expect(calloutRectCount).toBeGreaterThanOrEqual(1);
  });

  it('emits <text data-role="detail-callout-label"> with letter "B" on the parent', () => {
    const drawing = makeFixtureDrawingWithParentAndRectDetail();
    const sheet = drawing.sheets[0]!;
    const svg = renderDrawingSvg(drawing, sheet, makeFixturePart());
    const textMatches = svg.match(/<text[^>]*data-role="detail-callout-label"[^>]*>B<\/text>/);
    expect(textMatches).not.toBeNull();
  });

  it('callout rect x/y/width/height are in parent sheet-space', () => {
    // parent positionMm={x:80,y:80}, parentScale=1, center={x:30,y:20}, widthMm=20, heightMm=12
    // cx = 80 + 30*1 = 110, cy = 80 + 20*1 = 100
    // w = 20*1 = 20, h = 12*1 = 12
    // x = 110 - 10 = 100, y = 100 - 6 = 94
    const drawing = makeFixtureDrawingWithParentAndRectDetail();
    const sheet = drawing.sheets[0]!;
    const svg = renderDrawingSvg(drawing, sheet, makeFixturePart());
    const calloutRectMatch = svg.match(/<rect[^>]*data-role="detail-callout-label"[^>]*/);
    expect(calloutRectMatch).not.toBeNull();
    const attrs = calloutRectMatch![0]!;
    expect(attrs).toContain('x="100"');
    expect(attrs).toContain('y="94"');
    expect(attrs).toContain('width="20"');
    expect(attrs).toContain('height="12"');
  });

  it('circle-region detail unchanged: still emits <circle> detail-border and <circle> callout', () => {
    const drawing = makeFixtureDrawingWithParentAndDetail();
    const sheet = drawing.sheets[0]!;
    const svg = renderDrawingSvg(drawing, sheet, makeFixturePart());
    const circleBorder = (svg.match(/<circle[^>]*data-role="detail-border"/g) ?? []).length;
    const circleCallout = (svg.match(/<circle[^>]*data-role="detail-callout-label"/g) ?? []).length;
    expect(circleBorder).toBe(1);
    expect(circleCallout).toBeGreaterThanOrEqual(1);
  });
});

describe('renderDrawingSvg — detail callout overlay', () => {
  it('emits two circle elements: one detail-border, one detail-callout-label on parent', () => {
    const drawing = makeFixtureDrawingWithParentAndDetail();
    const sheet = drawing.sheets[0]!;
    const svg = renderDrawingSvg(drawing, sheet, makeFixturePart());
    const borderMatches = svg.match(/data-role="detail-border"/g) ?? [];
    const calloutMatches = svg.match(/data-role="detail-callout-label"/g) ?? [];
    expect(borderMatches.length).toBe(1);
    expect(calloutMatches.length).toBeGreaterThanOrEqual(1);
  });

  it('emits <text data-role="detail-callout-label"> with letter "A" on the parent', () => {
    const drawing = makeFixtureDrawingWithParentAndDetail();
    const sheet = drawing.sheets[0]!;
    const svg = renderDrawingSvg(drawing, sheet, makeFixturePart());
    const textMatches = svg.match(/<text[^>]*data-role="detail-callout-label"[^>]*>A<\/text>/);
    expect(textMatches).not.toBeNull();
  });
});

// ── CHUNK D: title-block approvedBy + notes ───────────────────────────────────

describe('renderDrawingSvg — title-block approvedBy + notes (CHUNK-D)', () => {
  function makeDrawingWithTitleBlockOverrides(): { drawing: DrawingDocument; sheet: DrawingSheet } {
    const drawing = makeFixtureDrawing();
    const sheet = {
      ...drawing.sheets[0]!,
      titleBlock: { approvedBy: 'J. Smith', notes: 'Rev A initial release' },
    };
    const updatedDrawing = { ...drawing, sheets: [sheet] };
    return { drawing: updatedDrawing, sheet };
  }

  it('SVG-D-1: title block emits "Approved by:" label', () => {
    const { drawing, sheet } = makeDrawingWithTitleBlockOverrides();
    const svg = renderDrawingSvg(drawing, sheet, makeFixturePart());
    expect(svg).toContain('Approved by:');
  });

  it('SVG-D-2: title block emits the approvedBy value "J. Smith"', () => {
    const { drawing, sheet } = makeDrawingWithTitleBlockOverrides();
    const svg = renderDrawingSvg(drawing, sheet, makeFixturePart());
    expect(svg).toContain('J. Smith');
  });

  it('SVG-D-3: title block emits "Notes:" label', () => {
    const { drawing, sheet } = makeDrawingWithTitleBlockOverrides();
    const svg = renderDrawingSvg(drawing, sheet, makeFixturePart());
    expect(svg).toContain('Notes:');
  });

  it('SVG-D-4: title block emits the notes value "Rev A initial release"', () => {
    const { drawing, sheet } = makeDrawingWithTitleBlockOverrides();
    const svg = renderDrawingSvg(drawing, sheet, makeFixturePart());
    expect(svg).toContain('Rev A initial release');
  });
});

// ── CHUNK C: view labels + scale, section headings ────────────────────────────

describe('renderDrawingSvg — view labels + section headings (CHUNK-C)', () => {
  it('SVG-C-1: base view emits a scale label matching /SCALE\\s*1:1/', () => {
    const drawing = makeFixtureDrawing();
    const sheet = drawing.sheets[0]!;
    const svg = renderDrawingSvg(drawing, sheet, makeFixturePart());
    expect(svg).toMatch(/SCALE\s*1:1/);
  });

  it('SVG-C-2: section view emits a "SECTION A-A" heading below the cut', () => {
    const base = makeFixtureDrawing({ viewCount: 1 });
    const baseSheet = base.sheets[0]!;
    const sectionView: SectionView = {
      id: 'sv-c', kind: 'section',
      parentViewId: 'view-sheet-1-0',
      sectionLine: { p0: { x: 0, y: 50 }, p1: { x: 100, y: 50 } },
      arrowDirection: 1 as -1 | 1,
      label: 'A',
      positionMm: { x: 50, y: 150 },
      scale: { numerator: 1, denominator: 1 },
      showHidden: false,
      mode: 'full',
      hatchSegments: [],
      fingerprint: 'fp-c',
      projection: {
        visibleEdges: [{ id: 'sv-c-e1', kind: 'outline' as const, points: [[0, 0], [100, 0], [100, 100], [0, 100]] as ReadonlyArray<readonly [number, number]> }],
        hiddenEdges: [],
        bbox: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
      },
      inputFingerprint: 'fp-c',
    };
    const updatedSheet = { ...baseSheet, views: [...baseSheet.views, sectionView] };
    const drawing = { ...base, sheets: [updatedSheet] };
    const svg = renderDrawingSvg(drawing, updatedSheet, makeFixturePart());
    expect(svg).toContain('SECTION A-A');
  });
});

// ── CHUNK B2: first-angle ISO projection symbol ───────────────────────────────

describe('renderDrawingSvg — first-angle projection symbol (CHUNK-B2)', () => {
  it('SVG-B2-1: title block contains an element with data-role="projection-symbol"', () => {
    const drawing = makeFixtureDrawing();
    const sheet = drawing.sheets[0]!;
    const svg = renderDrawingSvg(drawing, sheet, makeFixturePart());
    expect(svg).toContain('data-role="projection-symbol"');
  });

  it('SVG-B2-2: projection symbol contains a circle element', () => {
    const drawing = makeFixtureDrawing();
    const sheet = drawing.sheets[0]!;
    const svg = renderDrawingSvg(drawing, sheet, makeFixturePart());
    // Expect a circle within the projection symbol group
    const psIdx = svg.indexOf('data-role="projection-symbol"');
    const afterPs = svg.slice(psIdx, psIdx + 400);
    expect(afterPs).toContain('<circle');
  });

  it('SVG-B2-3: projection symbol contains a trapezoid path element', () => {
    const drawing = makeFixtureDrawing();
    const sheet = drawing.sheets[0]!;
    const svg = renderDrawingSvg(drawing, sheet, makeFixturePart());
    const psIdx = svg.indexOf('data-role="projection-symbol"');
    const afterPs = svg.slice(psIdx, psIdx + 600);
    expect(afterPs).toContain('<path');
  });

  it('SVG-B2-4: correct first-angle orientation — circles to the RIGHT of the trapezoid', () => {
    // ISO 128-30 first-angle: trapezoid on LEFT, concentric circles on RIGHT.
    // In the SVG, circle cx must be GREATER than the trapezoid's rightmost x.
    const drawing = makeFixtureDrawing();
    const sheet = drawing.sheets[0]!;
    const svg = renderDrawingSvg(drawing, sheet, makeFixturePart());

    // Extract the projection symbol group
    const psIdx = svg.indexOf('data-role="projection-symbol"');
    const afterPs = svg.slice(psIdx, psIdx + 800);

    // Extract circle cx
    const circleMatch = afterPs.match(/<circle[^>]*cx="([0-9.eE+\-]+)"/);
    expect(circleMatch, 'circle element with cx attribute not found').not.toBeNull();
    const circleCx = parseFloat(circleMatch![1]!);

    // Extract trapezoid path — parse all x values from the M/L commands
    const pathMatch = afterPs.match(/<path[^>]*d="([^"]+)"/);
    expect(pathMatch, 'trapezoid path not found').not.toBeNull();
    const dAttr = pathMatch![1]!;
    // Parse all numeric tokens after M or L commands (pairs: x y)
    const coords = [...dAttr.matchAll(/[ML]\s*([-\d.]+)\s+([-\d.]+)/g)].map(m => parseFloat(m[1]!));
    const trapMaxX = Math.max(...coords);

    // CORRECT first-angle: circle is to the RIGHT → circleCx > trapMaxX
    expect(circleCx).toBeGreaterThan(trapMaxX);
  });

  it('SVG-B2-5: correct first-angle orientation — trapezoid wide (tall) edge on RIGHT toward circles', () => {
    // The trapezoid right vertical edge height must be GREATER than left vertical edge height.
    const drawing = makeFixtureDrawing();
    const sheet = drawing.sheets[0]!;
    const svg = renderDrawingSvg(drawing, sheet, makeFixturePart());

    const psIdx = svg.indexOf('data-role="projection-symbol"');
    const afterPs = svg.slice(psIdx, psIdx + 800);

    const pathMatch = afterPs.match(/<path[^>]*d="([^"]+)"/);
    expect(pathMatch, 'trapezoid path not found').not.toBeNull();
    const dAttr = pathMatch![1]!;

    // Parse coordinate pairs from M/L commands: [[x,y], ...]
    const pts = [...dAttr.matchAll(/[ML]\s*([-\d.]+)\s+([-\d.]+)/g)].map(m => ({
      x: parseFloat(m[1]!),
      y: parseFloat(m[2]!),
    }));
    // 4 corners: find leftmost and rightmost x values
    const minX = Math.min(...pts.map(p => p.x));
    const maxX = Math.max(...pts.map(p => p.x));
    const leftPts  = pts.filter(p => p.x === minX);
    const rightPts = pts.filter(p => p.x === maxX);
    expect(leftPts.length,  'expected 2 points at left edge').toBe(2);
    expect(rightPts.length, 'expected 2 points at right edge').toBe(2);
    const leftHeight  = Math.abs(leftPts[0]!.y  - leftPts[1]!.y);
    const rightHeight = Math.abs(rightPts[0]!.y - rightPts[1]!.y);
    // CORRECT first-angle: right edge (toward circles) is TALLER
    expect(rightHeight).toBeGreaterThan(leftHeight);
  });
});

describe('renderDrawingSvg — null source (source-optional export)', () => {
  const sheetWithHoleTable: DrawingSheet = {
    id: 'sh1',
    name: 'Sheet 1',
    size: { kind: 'iso', size: 'A3' },
    orientation: 'landscape',
    views: [],
    dimensions: [],
    annotations: [
      {
        kind: 'holeTable',
        id: 'ht1',
        viewId: 'v1',
        datum: { kind: 'edge-endpoint', edgeId: 'e1', end: 'start' },
        positionMm: { x: 100, y: 50 },
        entries: [],
      },
    ],
    titleBlock: {},
    dimensionGroups: [],
  };
  const drawingWithHoleTable: DrawingDocument = {
    id: 'dw1',
    name: 'Null-Source Drawing',
    units: 'mm',
    source: { partPath: 'parts/dummy.zipt', sourceKind: 'part' },
    properties: {},
    sheets: [sheetWithHoleTable],
    activeSheetId: 'sh1',
  };

  it('renders without throwing and skips the hole table when source is null', () => {
    expect(() => renderDrawingSvg(drawingWithHoleTable, sheetWithHoleTable, null)).not.toThrow();
    const svg = renderDrawingSvg(drawingWithHoleTable, sheetWithHoleTable, null);
    expect(svg).toContain('</svg>');
    expect(svg).not.toContain('data-ann-kind="holeTable"');
  });
});

// ---------------------------------------------------------------------------
// F3 SVG underlay (DXF underlay backdrop)
// ---------------------------------------------------------------------------
import type { DxfUnderlay, DrawingSheet as DrawingSheetType } from '@zilventor/shared';

describe('renderDrawingSvg — DXF underlay (F3)', () => {
  function makeUnderlaySheet(): DrawingSheetType {
    const underlay: DxfUnderlay = {
      name: 'test.dxf',
      entities: [
        { kind: 'line',     x1: 0,  y1: 0,  x2: 100, y2: 0 },
        { kind: 'polyline', points: [[0, 0], [50, 0], [50, 50]] as ReadonlyArray<readonly [number, number]>, closed: false },
        { kind: 'circle',   cx: 50, cy: 50, r: 20 },
        { kind: 'arc',      cx: 0,  cy: 0,  r: 10,   startAngle: 0, endAngle: 90 },
        { kind: 'text',     x: 10,  y: 10,  height: 5, value: 'Label', rotation: 0 },
      ],
    };
    return {
      id: 's-underlay',
      name: 'Sheet with underlay',
      size: { kind: 'iso', size: 'A3' },
      orientation: 'landscape',
      views: [
        {
          id: 'v-ul-1',
          kind: 'base',
          positionMm: { x: 50, y: 50 },
          scale: { numerator: 1, denominator: 1 },
          orientation: 'front',
          showHidden: false,
          projection: {
            visibleEdges: [{ id: 'e1', kind: 'outline', points: [[0, 0], [10, 0]] as ReadonlyArray<readonly [number, number]> }],
            hiddenEdges: [],
            bbox: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
          },
        },
      ],
      dimensions: [],
      annotations: [],
      titleBlock: {},
      dimensionGroups: [],
      underlay,
    };
  }

  function makeUnderlayDrawing(sheet: DrawingSheetType): DrawingDocument {
    return {
      id: 'd-ul',
      name: 'Underlay Drawing',
      units: 'mm',
      source: { partPath: 'parts/test.zipt', sourceKind: 'part' },
      properties: {},
      sheets: [sheet],
      activeSheetId: sheet.id,
    };
  }

  it('emits <g data-underlay> when sheet has an underlay', () => {
    const sheet = makeUnderlaySheet();
    const svg = renderDrawingSvg(makeUnderlayDrawing(sheet), sheet, makeFixturePart());
    expect(svg).toContain('data-underlay');
  });

  it('underlay group has pointer-events="none"', () => {
    const sheet = makeUnderlaySheet();
    const svg = renderDrawingSvg(makeUnderlayDrawing(sheet), sheet, makeFixturePart());
    // The group must carry pointer-events="none"
    expect(svg).toMatch(/data-underlay[^>]*pointer-events="none"|pointer-events="none"[^>]*data-underlay/);
  });

  it('underlay group contains a <line> for the line entity', () => {
    const sheet = makeUnderlaySheet();
    const svg = renderDrawingSvg(makeUnderlayDrawing(sheet), sheet, makeFixturePart());
    // Line entity should produce a <line> element inside the underlay group
    const underlayStart = svg.indexOf('data-underlay');
    const underlayEnd = svg.indexOf('</g>', underlayStart);
    const underlaySection = svg.slice(underlayStart, underlayEnd);
    expect(underlaySection).toContain('<line');
  });

  it('underlay group contains a <circle> for the circle entity', () => {
    const sheet = makeUnderlaySheet();
    const svg = renderDrawingSvg(makeUnderlayDrawing(sheet), sheet, makeFixturePart());
    const underlayStart = svg.indexOf('data-underlay');
    const underlayEnd = svg.indexOf('</g>', underlayStart);
    const underlaySection = svg.slice(underlayStart, underlayEnd);
    expect(underlaySection).toContain('<circle');
  });

  it('underlay group contains a <path> for the arc entity', () => {
    const sheet = makeUnderlaySheet();
    const svg = renderDrawingSvg(makeUnderlayDrawing(sheet), sheet, makeFixturePart());
    const underlayStart = svg.indexOf('data-underlay');
    const underlayEnd = svg.indexOf('</g>', underlayStart);
    const underlaySection = svg.slice(underlayStart, underlayEnd);
    expect(underlaySection).toContain('<path');
  });

  it('underlay group contains a <text> for the text entity', () => {
    const sheet = makeUnderlaySheet();
    const svg = renderDrawingSvg(makeUnderlayDrawing(sheet), sheet, makeFixturePart());
    const underlayStart = svg.indexOf('data-underlay');
    const underlayEnd = svg.indexOf('</g>', underlayStart);
    const underlaySection = svg.slice(underlayStart, underlayEnd);
    expect(underlaySection).toContain('<text');
    expect(underlaySection).toContain('Label');
  });

  it('underlay group appears BEFORE the first data-view-id in document order', () => {
    const sheet = makeUnderlaySheet();
    const svg = renderDrawingSvg(makeUnderlayDrawing(sheet), sheet, makeFixturePart());
    const underlayPos = svg.indexOf('data-underlay');
    const firstViewPos = svg.indexOf('data-view-id=');
    expect(underlayPos).toBeGreaterThan(0);
    expect(underlayPos).toBeLessThan(firstViewPos);
  });

  it('sheet without underlay emits no data-underlay group', () => {
    const drawing = makeFixtureDrawing();
    const sheet = drawing.sheets[0]!;
    const svg = renderDrawingSvg(drawing, sheet, makeFixturePart());
    expect(svg).not.toContain('data-underlay');
  });

  // --- fit-to-sheet centering + y-flip transform tests ---

  it('underlay group carries a transform that encodes the y-flip (scale(1,-1))', () => {
    // An underlay with offsetMm must have scale(1,-1) in its group transform
    const underlayWithOffset: DxfUnderlay = {
      name: 'offset-test.dxf',
      entities: [{ kind: 'line', x1: 0, y1: 0, x2: 10, y2: 0 }],
      sourceBBoxMm: { minX: 0, minY: 0, maxX: 10, maxY: 0 },
      offsetMm: { x: 160, y: -133.5 },
    };
    const sheet: DrawingSheetType = {
      id: 's-off', name: 'Sheet', size: { kind: 'iso', size: 'A3' },
      orientation: 'landscape', views: [], dimensions: [], annotations: [],
      titleBlock: {}, dimensionGroups: [], underlay: underlayWithOffset,
    };
    const drawing = makeUnderlayDrawing(sheet);
    const svg = renderDrawingSvg(drawing, sheet, makeFixturePart());
    // The underlay group must contain scale(1,-1) to y-flip DXF coords
    expect(svg).toMatch(/data-underlay[^>]*transform="[^"]*scale\(1,-1\)/);
  });

  it('underlay group transform produces correct sheet-y for a text entity at known DXF coords', () => {
    // Underlay: text at DXF (10, 20) with offsetMm = {x:5, y:-7}
    // sheetH = 297 (A3 landscape)
    // Expected: the transform "translate(5, 297 + (-7)) scale(1,-1)" = translate(5, 290) scale(1,-1)
    // After transform: x_sheet = 5 + 10 = 15, y_sheet = 290 + (-20) = 270 (because scale flips y)
    // The <text> element's y attribute stays as 20 (DXF), and the group transform handles flipping.
    const underlayWithOffset: DxfUnderlay = {
      name: 'text-test.dxf',
      entities: [{ kind: 'text', x: 10, y: 20, height: 5, value: 'ORIENT_CHECK', rotation: 0 }],
      sourceBBoxMm: { minX: 10, minY: 20, maxX: 10, maxY: 20 },
      offsetMm: { x: 5, y: -7 },
    };
    const sheet: DrawingSheetType = {
      id: 's-txt', name: 'Sheet', size: { kind: 'iso', size: 'A3' },
      orientation: 'landscape', views: [], dimensions: [], annotations: [],
      titleBlock: {}, dimensionGroups: [], underlay: underlayWithOffset,
    };
    const drawing = makeUnderlayDrawing(sheet);
    const svg = renderDrawingSvg(drawing, sheet, makeFixturePart());
    // Group transform: translate(offsetMm.x, sheetH + offsetMm.y) scale(1,-1)
    // sheetH = 297, offsetMm = {x:5, y:-7} → translate(5, 290) scale(1,-1)
    expect(svg).toContain('translate(5,290)');
    // text element keeps DXF coords: x=10, y=20
    expect(svg).toContain('ORIENT_CHECK');
  });

  it('text entity in y-flipped underlay has counter-scale(1,-1) so glyphs read upright', () => {
    // When offsetMm is present → group has scale(1,-1) → text needs counter-flip on element
    const underlayWithText: DxfUnderlay = {
      name: 'text-flip.dxf',
      entities: [{ kind: 'text', x: 10, y: 20, height: 5, value: 'ReadableText', rotation: 0 }],
      offsetMm: { x: 0, y: 0 },
    };
    const sheet: DrawingSheetType = {
      id: 's-txt2', name: 'Sheet', size: { kind: 'iso', size: 'A3' },
      orientation: 'landscape', views: [], dimensions: [], annotations: [],
      titleBlock: {}, dimensionGroups: [], underlay: underlayWithText,
    };
    const drawing = makeUnderlayDrawing(sheet);
    const svg = renderDrawingSvg(drawing, sheet, makeFixturePart());
    // The text element must contain a transform with scale(1,-1)
    expect(svg).toContain('ReadableText');
    // Find the text element's transform — it should have a scale(1,-1) counter-flip
    const textMatch = svg.match(/<text[^>]*ReadableText|ReadableText[^<]*<\/text>/);
    // The <text> tag should have a transform with scale(1,-1)
    const textTagEnd = svg.indexOf('ReadableText');
    const textTagStart = svg.lastIndexOf('<text', textTagEnd);
    const textTag = svg.slice(textTagStart, textTagEnd + 15);
    expect(textTag).toContain('scale(1,-1)');
  });

  it('underlay group with offsetMm={0,0} uses translate(0, sheetH) scale(1,-1)', () => {
    // This pins the behavior for the y-flip-only case (no centering displacement)
    const underlayZero: DxfUnderlay = {
      name: 'zero-offset.dxf',
      entities: [{ kind: 'line', x1: 0, y1: 0, x2: 10, y2: 0 }],
      offsetMm: { x: 0, y: 0 },
    };
    const sheet: DrawingSheetType = {
      id: 's-z', name: 'Sheet', size: { kind: 'iso', size: 'A3' },
      orientation: 'landscape', views: [], dimensions: [], annotations: [],
      titleBlock: {}, dimensionGroups: [], underlay: underlayZero,
    };
    const drawing = makeUnderlayDrawing(sheet);
    const svg = renderDrawingSvg(drawing, sheet, makeFixturePart());
    // A3 landscape sheetH = 297 → translate(0, 297) scale(1,-1)
    expect(svg).toContain('translate(0,297)');
    expect(svg).toContain('scale(1,-1)');
  });
});

// ── Slice 6: center-mark annotation renders a cross ──────────────────────────
describe('renderDrawingSvg — center-mark annotation (Slice 6)', () => {
  /** Build an 8-point arc approximating a circle of radius 5 centered at (10, 15). */
  function arcPoints(): ReadonlyArray<readonly [number, number]> {
    const cx = 10; const cy = 15; const r = 5;
    return Array.from({ length: 8 }, (_, i) => {
      const angle = (i / 8) * 2 * Math.PI;
      return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)] as readonly [number, number];
    });
  }

  function makeDrawingWithCenterMark(): { drawing: DrawingDocument; sheet: DrawingSheet } {
    const arcView: DrawingView = {
      id: 'view-arc',
      kind: 'base' as const,
      positionMm: { x: 50, y: 60 },
      scale: { numerator: 1, denominator: 1 },
      orientation: 'front' as const,
      showHidden: false,
      projection: {
        visibleEdges: [
          { id: 'arc-edge-1', kind: 'outline' as const, points: arcPoints() },
        ],
        hiddenEdges: [],
        bbox: { minX: 5, minY: 10, maxX: 15, maxY: 20 },
      },
    };
    const sheet: DrawingSheet = {
      id: 'sheet-cm',
      name: 'Sheet CM',
      size: { kind: 'iso', size: 'A3' },
      orientation: 'landscape',
      views: [arcView],
      dimensions: [],
      annotations: [
        { id: 'cm-1', kind: 'center-mark', viewId: 'view-arc', edgeId: 'arc-edge-1' },
      ],
      titleBlock: {},
      dimensionGroups: [],
    };
    const drawing: DrawingDocument = {
      id: 'drawing-cm',
      name: 'Center Mark Drawing',
      units: 'mm',
      source: { partPath: 'parts/test.zipt', sourceKind: 'part' },
      properties: {},
      sheets: [sheet],
      activeSheetId: 'sheet-cm',
    };
    return { drawing, sheet };
  }

  it('SVG-CM-1: center-mark annotation emits data-ann-kind="center-mark" with two <line> cross arms (not empty comment stub)', () => {
    const { drawing, sheet } = makeDrawingWithCenterMark();
    const svg = renderDrawingSvg(drawing, sheet, makeFixturePart());

    // Must have the center-mark group
    expect(svg).toContain('data-ann-kind="center-mark"');

    // Extract the center-mark group content
    const groupStart = svg.indexOf('data-ann-kind="center-mark"');
    const groupOpenTag = svg.lastIndexOf('<g', groupStart);
    const groupEnd = svg.indexOf('</g>', groupStart);
    const groupContent = svg.slice(groupOpenTag, groupEnd + 4);

    // Must have at least two <line elements (horizontal + vertical arms of the cross)
    const lineMatches = groupContent.match(/<line/g) ?? [];
    expect(lineMatches.length).toBeGreaterThanOrEqual(2);

    // Must NOT be the empty comment stub
    expect(groupContent).not.toContain('<!-- centerline / center-mark geometry rendered by DrawingCanvas');
  });
});
