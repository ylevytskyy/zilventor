// packages/shared/src/drawing/__tests__/holeTable.spec.ts
import { describe, it, expect } from 'vitest';
import type { HoleTableAnnotation, DrawingAnnotation } from '../types';

// ---------------------------------------------------------------------------
// HT-TYPE-1: HoleTableAnnotation structural shape + union membership
// ---------------------------------------------------------------------------

describe('HoleTableAnnotation — HT-TYPE-1: structural shape', () => {
  it('has kind holeTable and all required fields', () => {
    // This runtime check proves the type is usable as a DrawingAnnotation.
    // TypeScript type-checks the assignment at build/typecheck time.
    const ann = {
      kind: 'holeTable' as const,
      id: 'ht-1',
      viewId: 'v1',
      datum: { kind: 'edge-endpoint' as const, edgeId: 'e1', end: 'start' as const },
      positionMm: { x: 10, y: 20 },
      entries: [{ holeFeatureId: 'H1', tag: 'A1' }],
    } satisfies HoleTableAnnotation;

    const asAnnotation: DrawingAnnotation = ann;
    expect(asAnnotation.kind).toBe('holeTable');
    expect(ann.id).toBe('ht-1');
    expect(ann.viewId).toBe('v1');
    expect(ann.datum.kind).toBe('edge-endpoint');
    expect(ann.positionMm).toEqual({ x: 10, y: 20 });
    expect(ann.entries).toHaveLength(1);
    const firstEntry = ann.entries[0];
    expect(firstEntry?.tag).toBe('A1');
  });
});
