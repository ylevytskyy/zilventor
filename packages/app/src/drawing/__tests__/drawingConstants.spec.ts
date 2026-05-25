// packages/app/src/drawing/__tests__/drawingConstants.spec.ts
import { describe, it, expect } from 'vitest';
import { MIN_DETAIL_RADIUS_MM, MIN_DETAIL_RECT_MM } from '../drawingConstants';

describe('drawingConstants', () => {
  it('MIN_DETAIL_RADIUS_MM is 1.0', () => {
    expect(MIN_DETAIL_RADIUS_MM).toBe(1.0);
  });

  it('MIN_DETAIL_RECT_MM is 1.0', () => {
    expect(MIN_DETAIL_RECT_MM).toBe(1.0);
  });
});
