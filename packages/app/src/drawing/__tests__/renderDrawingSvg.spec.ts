import { describe, it, expect } from 'vitest';
import { renderDrawingSvg } from '../renderDrawingSvg';
import { makeFixtureDrawing, makeFixturePart } from '../../__tests__/fixtures/drawingFixtures';

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
