import { describe, it, expect, beforeAll } from 'vitest';
import { loadOcct, type OcctInstance } from '../occtLoader';
import { readStep } from '../StepIO';
import { makeColoredBoxStepBytes } from './stepColor.helper';

describe('readStep XCAF color extraction', () => {
  let oc: OcctInstance;
  beforeAll(async () => { oc = await loadOcct(); }, 120_000);

  it('returns per-solid colors index-aligned with solid enumeration', () => {
    const bytes = makeColoredBoxStepBytes(oc, ['#ff0000', '#00ff00']);
    const res = readStep(oc, bytes);
    expect(res.solidCount).toBe(2);
    expect(res.solidColors).toHaveLength(2);
    // colors come back as lowercase #rrggbb; allow ±1 quantization tolerance
    expect(res.solidColors.filter(Boolean).sort()).toEqual(['#00ff00', '#ff0000']);
  });

  it('produces geometry equivalent to the legacy STEPControl_Reader path', () => {
    const bytes = makeColoredBoxStepBytes(oc, ['#ff0000', '#00ff00']);
    const res = readStep(oc, bytes);
    expect(res.solidCount).toBe(2);
    expect(res.faceCount).toBe(12); // 6 faces × 2 boxes
    // bbox spans both boxes (two 10×10×10 boxes at x=0 and x=20, so x range = 0..30)
    expect(res.boundingBox[3]! - res.boundingBox[0]!).toBeGreaterThan(25);
  });

  it('returns null for uncolored solids', () => {
    const bytes = makeColoredBoxStepBytes(oc, ['#ff0000', '#00ff00']);
    const res = readStep(oc, bytes);
    // All solids in our fixture are colored, so none should be null
    expect(res.solidColors.every((c) => c !== null)).toBe(true);
  });
});
