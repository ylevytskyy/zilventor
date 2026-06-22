/**
 * Task 7 — TextAnnotation round-trip tests.
 *
 * Serialization path: structuredClone (deepClone in fileFormat.ts) — fully
 * structural, no kind-whitelist. annotations? round-trips automatically.
 * The round-trip helper mirrors the two-way JSON→migrateManifest pattern used
 * throughout the shared test suite (e.g. v23-absent-not-reified.spec.ts).
 */
import { describe, it, expect } from 'vitest';
import { migrateManifest, type AnyManifest } from '../fileFormat';
import type { TextAnnotation } from '../types';

/** Wraps a sketch feature in a minimal v31 part manifest and round-trips it
 *  through JSON.stringify → JSON.parse → migrateManifest (no-op at v31).
 *  Returns the sketch feature from the output featureTree. */
function roundTripSketch(sketchFeature: object): Record<string, unknown> {
  const manifest: AnyManifest = {
    formatVersion: 31,
    kind: 'part',
    document: {
      id: 'p1',
      name: 'P',
      units: 'mm',
      parameters: {},
      // Wrap in origin.XY so injectOriginFeatures is a no-op (hasOrigin=true)
      featureTree: [
        { kind: 'workAxis', id: 'origin.X', visible: false, source: { mode: 'origin', axis: 'X' } },
        { kind: 'workAxis', id: 'origin.Y', visible: false, source: { mode: 'origin', axis: 'Y' } },
        { kind: 'workAxis', id: 'origin.Z', visible: false, source: { mode: 'origin', axis: 'Z' } },
        { kind: 'workPlane', id: 'origin.XY', visible: false, source: { mode: 'origin', plane: 'XY' } },
        { kind: 'workPlane', id: 'origin.YZ', visible: false, source: { mode: 'origin', plane: 'YZ' } },
        { kind: 'workPlane', id: 'origin.XZ', visible: false, source: { mode: 'origin', plane: 'XZ' } },
        { kind: 'workPoint', id: 'origin.O', visible: false, source: { mode: 'origin' } },
        sketchFeature,
      ],
      properties: {},
      materials: [],
      hardware: [],
    },
  };

  const json = JSON.stringify(manifest);
  const parsed = JSON.parse(json) as AnyManifest;
  const out = migrateManifest(parsed);
  const tree = (out.document as { featureTree: Array<Record<string, unknown>> }).featureTree;
  const sketch = tree.find((f) => f['kind'] === 'sketch');
  if (!sketch) throw new Error('sketch feature not found in output');
  return sketch;
}

describe('sketch feature TextAnnotation round-trip', () => {
  it('round-trips a sketch feature with text annotations', () => {
    const annotations: TextAnnotation[] = [
      { id: 'a1', x: 1, y: 2, height: 3, value: 'HELLO', rotation: 0 },
    ];
    const sketchFeature = {
      kind: 'sketch' as const,
      id: 's1',
      plane: { source: 'workPlane' as const, featureId: 'origin.XY' },
      primitives: [],
      constraints: [],
      annotations,
    };

    const out = roundTripSketch(sketchFeature);

    expect(out['annotations']).toEqual(annotations);
  });

  it('omits annotations key when absent (exactOptionalPropertyTypes contract)', () => {
    const sketchFeature = {
      kind: 'sketch' as const,
      id: 's2',
      plane: { source: 'workPlane' as const, featureId: 'origin.XY' },
      primitives: [],
      constraints: [],
      // annotations intentionally absent
    };

    const out = roundTripSketch(sketchFeature);

    // Key must be absent — not undefined, not [], not null
    expect('annotations' in out).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(out, 'annotations')).toBe(false);
  });
});
