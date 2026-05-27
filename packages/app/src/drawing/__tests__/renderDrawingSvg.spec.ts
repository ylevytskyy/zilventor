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
import type { DetailView, DrawingDocument, DrawingSheet } from '@zilventor/shared';

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
