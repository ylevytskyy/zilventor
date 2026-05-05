import { describe, it, expect } from 'vitest';
import { renderDrawingSvg } from '../renderDrawingSvg';
import {
  makeFixtureDrawing,
  makeFixturePart,
  makeFixtureDrawingWithDetailView,
  makeFixtureDrawingWithParentAndDetail,
} from '../../__tests__/fixtures/drawingFixtures';
import type { DetailView } from '@zilventor/shared';

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
      regionParent: { center: { x: 25, y: 15 }, radiusMm: 10 },
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
