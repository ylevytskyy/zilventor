// packages/app/src/drawing/__tests__/DimensionElementCascade.spec.tsx
// Tests cascade text resolution for new F5 dim kinds (no DOM render; pure function tests).
import { describe, it, expect, beforeEach } from 'vitest';
import { resolveF5DimText } from '../DimensionElementF5Utils';
import { useAppStore } from '../../store/useAppStore';
import type { PartDocument } from '@zilventor/shared';

function makePart(): PartDocument {
  return {
    id: 'p1', name: 'Box', units: 'mm',
    parameters: {
      width: { name: 'width', expression: '50', value: 50, unit: 'mm' },
      angle: { name: 'angle', expression: '45', value: 45, unit: 'deg' },
    },
    featureTree: [], properties: {}, materials: [], hardware: [],
  } as unknown as PartDocument;
}

beforeEach(() => {
  useAppStore.setState({ activePart: makePart() } as never);
});

describe('resolveF5DimText — cascade for new F5 dim kinds', () => {
  it('(a) textOverride takes priority', () => {
    expect(resolveF5DimText({ textOverride: 'MY LABEL', sourceParameterName: 'width' }, 99)).toBe('MY LABEL');
  });

  it('(b) sourceParameterName resolves to param value', () => {
    expect(resolveF5DimText({ sourceParameterName: 'width' }, 99)).toBe('50');
  });

  it('(c) sourceParameterName for angle param returns deg value', () => {
    expect(resolveF5DimText({ sourceParameterName: 'angle' }, 99)).toBe('45');
  });

  it('(d) orphaned sourceParameterName falls back to computed value', () => {
    expect(resolveF5DimText({ sourceParameterName: 'missing' }, 42.7)).toBe('42.7');
  });

  it('(e) neither textOverride nor sourceParameterName → computed value', () => {
    expect(resolveF5DimText({}, 37.5)).toBe('37.5');
  });
});
