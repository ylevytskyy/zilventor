import { describe, it, expect } from 'vitest';
import { resolveSectionSource } from '../resolveSectionSource';
import type { DrawingDocument } from '../../index';

describe('resolveSectionSource', () => {
  const baseDoc: DrawingDocument = {
    id: 'draw-1', name: 'Test', units: 'mm',
    source: { partPath: 'parts/box.zipt', sourceKind: 'part' },
    properties: {},
    sheets: [{
      id: 's1', name: 'Sheet 1',
      size: { kind: 'iso', size: 'A3' },
      orientation: 'landscape',
      views: [
        {
          id: 'v1', kind: 'base',
          positionMm: { x: 0, y: 0 },
          scale: { numerator: 1, denominator: 1 },
          orientation: 'front',
          showHidden: false,
        },
        {
          id: 'v2', kind: 'base',
          positionMm: { x: 200, y: 0 },
          scale: { numerator: 1, denominator: 1 },
          orientation: 'front',
          showHidden: false,
        },
      ],
      dimensions: [], annotations: [], titleBlock: {}, dimensionGroups: [],
    }],
    activeSheetId: 's1',
  };

  it('resolves a section view whose parent is a base view on a part-source drawing', () => {
    const sv = {
      id: 'sv1', kind: 'section' as const,
      parentViewId: 'v1',
      sectionLine: { p0: { x: 0, y: 50 }, p1: { x: 100, y: 50 } },
      arrowDirection: 1 as const, label: 'A',
      positionMm: { x: 0, y: 150 },
      scale: { numerator: 1, denominator: 1 },
      showHidden: false as const, mode: 'full' as const, hatchSegments: [], fingerprint: '',
    };
    const result = resolveSectionSource(sv, baseDoc);
    expect(result.kind).toBe('part');
    expect(result.id).toBe('parts/box.zipt');
  });

  it('resolves correctly when drawing source is assembly', () => {
    const asmDoc: DrawingDocument = {
      ...baseDoc,
      source: { partPath: 'assemblies/wardrobe.ziasm', sourceKind: 'assembly' },
    };
    const sv = {
      id: 'sv2', kind: 'section' as const,
      parentViewId: 'v1',
      sectionLine: { p0: { x: 0, y: 0 }, p1: { x: 1, y: 0 } },
      arrowDirection: -1 as const, label: 'B',
      positionMm: { x: 0, y: 0 },
      scale: { numerator: 1, denominator: 1 },
      showHidden: false as const, mode: 'full' as const, hatchSegments: [], fingerprint: '',
    };
    const result = resolveSectionSource(sv, asmDoc);
    expect(result.kind).toBe('assembly');
    expect(result.id).toBe('assemblies/wardrobe.ziasm');
  });

  it('throws when parentViewId does not exist on any sheet', () => {
    const sv = {
      id: 'sv3', kind: 'section' as const,
      parentViewId: 'no-such-view',
      sectionLine: { p0: { x: 0, y: 0 }, p1: { x: 1, y: 0 } },
      arrowDirection: 1 as const, label: 'C',
      positionMm: { x: 0, y: 0 },
      scale: { numerator: 1, denominator: 1 },
      showHidden: false as const, mode: 'full' as const, hatchSegments: [], fingerprint: '',
    };
    expect(() => resolveSectionSource(sv, baseDoc)).toThrow('parentViewId');
  });
});
