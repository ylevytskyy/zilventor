// packages/app/src/drawing/__tests__/drawingCanvasStaleness.spec.ts
// Tests the staleness comparison logic exercised by the DrawingCanvas useEffect.
// Mirrors the logic without mounting React; the useEffect body is extracted into a
// pure helper `computeStaleViewIds` for testability.
import { describe, it, expect } from 'vitest';
import { computeStaleViewIds } from '../computeStaleViewIds';
import type { DrawingView } from '@zilventor/shared';

function makeView(id: string, opts: { hasProjection?: boolean; inputFingerprint?: string }): DrawingView {
  return {
    id,
    kind: 'base',
    positionMm: { x: 0, y: 0 },
    orientation: 'front',
    scale: { numerator: 1, denominator: 1 },
    showHidden: false,
    ...(opts.hasProjection ? { projection: { visibleEdges: [], hiddenEdges: [], bbox: { minX: 0, minY: 0, maxX: 10, maxY: 10 } } } : {}),
    ...(opts.inputFingerprint !== undefined ? { inputFingerprint: opts.inputFingerprint } : {}),
  } as unknown as DrawingView;
}

describe('computeStaleViewIds', () => {
  it('returns empty set when activeDrawingSourceFingerprint is null (source not loaded yet) — even for a view WITH a fingerprint', () => {
    // View has inputFingerprint 'fp-a' but we cannot compare it to null source fp → no stale.
    // When the source part hasn't been loaded yet, we cannot determine staleness: no-op.
    const views = [makeView('v1', { hasProjection: true, inputFingerprint: 'fp-a' })];
    expect(computeStaleViewIds(views, null)).toEqual(new Set());
  });

  it('condition (a): view with projection but no inputFingerprint is stale', () => {
    const views = [makeView('v1', { hasProjection: true })];
    const result = computeStaleViewIds(views, 'current-fp');
    expect(result).toEqual(new Set(['v1']));
  });

  it('condition (b): view inputFingerprint !== activeDrawingSourceFingerprint → stale (SOURCE EDIT DETECTED)', () => {
    // This is the primary staleness condition the original plan BROKE by using djb2(kernelId).
    // A kernel UUID never changes → djb2(kernelId) === djb2(kernelId) always → never stale.
    // activeDrawingSourceFingerprint changes on source edit (bytes changed) → this test fires.
    const views = [makeView('v1', { hasProjection: true, inputFingerprint: 'fp-old-bytes' })];
    const result = computeStaleViewIds(views, 'fp-new-bytes');
    expect(result).toEqual(new Set(['v1']));
  });

  it('condition (b) does NOT fire when fingerprints match (source unchanged)', () => {
    const views = [makeView('v1', { hasProjection: true, inputFingerprint: 'fp-same' })];
    const result = computeStaleViewIds(views, 'fp-same');
    expect(result).toEqual(new Set());
  });

  it('views without projection are never stale', () => {
    const views = [makeView('v1', { hasProjection: false })];
    const result = computeStaleViewIds(views, 'fp-a');
    expect(result).toEqual(new Set());
  });

  it('handles mixed views correctly', () => {
    const views = [
      makeView('stale-a', { hasProjection: true }), // condition (a)
      makeView('stale-b', { hasProjection: true, inputFingerprint: 'fp-old' }), // condition (b)
      makeView('fresh', { hasProjection: true, inputFingerprint: 'fp-current' }), // not stale
      makeView('no-proj', { hasProjection: false }), // unprojected
    ];
    const result = computeStaleViewIds(views, 'fp-current');
    expect(result).toEqual(new Set(['stale-a', 'stale-b']));
  });
});
