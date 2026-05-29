// packages/app/src/drawing/__tests__/underlayTransform.spec.ts
// TDD: computeUnderlayOffset — centers a DXF bbox on the sheet's drawable area (above title block).
import { describe, it, expect } from 'vitest';
import { computeUnderlayOffset } from '../underlayTransform';

describe('computeUnderlayOffset', () => {
  // A3 landscape: sheetW=420, sheetH=297, MARGIN=10, TITLE_H=20
  // drawableCx = 10 + (420 - 20)/2 = 10 + 200 = 210
  // drawableCy = 10 + (297 - 20 - 20)/2 = 10 + 128.5 = 138.5
  // After y-flip: a bbox [minX, minY, maxX, maxY] = [0,0,100,50]
  //   bboxCenterX_dxf = 50, bboxCenterY_dxf = 25
  //   flippedCy = sheetH - bboxCenterY_dxf = 297 - 25 = 272
  //   offsetX = drawableCx - bboxCenterX_dxf = 210 - 50 = 160
  //   offsetY = drawableCy - flippedCy = 138.5 - 272 = -133.5

  it('returns {0,0} when sourceBBoxMm is undefined', () => {
    const offset = computeUnderlayOffset(undefined, 420, 297, 10, 20);
    expect(offset).toEqual({ x: 0, y: 0 });
  });

  it('centers a 100×50 bbox at origin on A3 landscape (drawableCx=210, drawableCy=138.5)', () => {
    const bbox = { minX: 0, minY: 0, maxX: 100, maxY: 50 };
    const offset = computeUnderlayOffset(bbox, 420, 297, 10, 20);
    // drawableCx = 210, bboxCenterX = 50 → offsetX = 160
    expect(offset.x).toBeCloseTo(160, 4);
    // drawableCy = 138.5, flippedCy = 297-25=272 → offsetY = 138.5-272 = -133.5
    expect(offset.y).toBeCloseTo(-133.5, 4);
  });

  it('centers a bbox that is already at the drawable center → small offset', () => {
    // bbox centered at drawableCx=210, drawableCy (flipped back to DXF) = sheetH - drawableCy
    // drawableCy = 10 + (297-20-20)/2 = 138.5 → dxfCy = 297 - 138.5 = 158.5
    const drawableCx = 210;
    const dxfCy = 297 - 138.5; // = 158.5
    const bbox = { minX: drawableCx - 50, minY: dxfCy - 25, maxX: drawableCx + 50, maxY: dxfCy + 25 };
    const offset = computeUnderlayOffset(bbox, 420, 297, 10, 20);
    expect(offset.x).toBeCloseTo(0, 4);
    expect(offset.y).toBeCloseTo(0, 4);
  });

  it('works correctly for a bbox larger than the drawable area (still valid center)', () => {
    // bbox 500×400 at origin — larger than A3 landscape drawable (400×247mm)
    const bbox = { minX: 0, minY: 0, maxX: 500, maxY: 400 };
    const offset = computeUnderlayOffset(bbox, 420, 297, 10, 20);
    // drawableCx = 210, bboxCenterX = 250 → offsetX = -40
    expect(offset.x).toBeCloseTo(-40, 4);
    // drawableCy = 138.5, flippedCy = 297-200=97 → offsetY = 138.5-97 = 41.5
    expect(offset.y).toBeCloseTo(41.5, 4);
  });

  it('works for a bbox at a distant DXF origin (e.g. minX=1000, minY=2000)', () => {
    // bbox [1000,2000, 1100,2050] center = (1050, 2025)
    const bbox = { minX: 1000, minY: 2000, maxX: 1100, maxY: 2050 };
    const offset = computeUnderlayOffset(bbox, 420, 297, 10, 20);
    // offsetX = 210 - 1050 = -840
    expect(offset.x).toBeCloseTo(210 - 1050, 4);
    // flippedCy = 297 - 2025 = -1728, drawableCy = 138.5 → offsetY = 138.5 - (-1728) = 1866.5
    expect(offset.y).toBeCloseTo(138.5 - (297 - 2025), 4);
  });
});
