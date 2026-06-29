/**
 * Proves that executeTree uses ImportedFeature.solidColors when no in-memory
 * lookupImportedColors is provided — i.e. the reload path works correctly
 * because colors are persisted on the feature rather than in the session cache.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { loadOcct, type OcctInstance } from '../occt/occtLoader';
import { readStep } from '../occt/StepIO';
import { executeTree } from '../adapter/FeatureTree';
import { disposeShape } from '../occt/SolidOps';
import { makeColoredBoxStepBytes } from '../occt/__tests__/stepColor.helper';
import type { PartDocument } from '@zilventor/shared';

let oc: OcctInstance;
beforeAll(async () => { oc = await loadOcct(); }, 120_000);

describe('executeTree — feature.solidColors reload path', () => {
  it('renders per-solid colors from feature.solidColors when lookupImportedColors is absent', async () => {
    // Build a 2-solid colored STEP compound (disjoint boxes).
    const stepBytes = makeColoredBoxStepBytes(oc, ['#ff0000', '#00ff00']);

    // Read the STEP to get the compound OcctShape + the ground-truth solidColors.
    const { shape, solidColors } = readStep(oc, stepBytes);
    // Sanity: readStep extracted at least 2 non-null colors.
    expect(solidColors.filter(Boolean)).toHaveLength(2);

    const bodyRef = 'test-bodyRef-reload';

    // Build a minimal PartDocument with the ImportedFeature carrying solidColors.
    const part: PartDocument = {
      id: 'p-reload',
      name: 'ReloadTest',
      units: 'mm',
      parameters: {},
      properties: {},
      materials: [],
      hardware: [],
      featureTree: [
        // Minimal origin features (workAxis/workPlane/workPoint) are optional for
        // executeTree — the imported feature alone drives the solid, so we skip them.
        {
          kind: 'imported',
          id: 'f-imported',
          sourceStep: 'test.step',
          bodyRef,
          // solidColors persisted on the feature — the field under test.
          solidColors,
        },
      ],
    };

    // Simulate "reload session": lookupImportedShape returns the shape (brep
    // was restored from .zipt), but lookupImportedColors is undefined (the
    // in-memory importedColorCache was NOT restored — that's the KNOWN GAP
    // this fix closes).
    const result = await executeTree(
      oc,
      part,
      (ref) => ref === bodyRef ? shape : undefined,
      undefined, // <-- explicitly absent cache; colors must come from feature.solidColors
    );

    // Dispose the original shape (executeTree copies it internally).
    disposeShape(shape);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`executeTree failed: ${result.error.message}`);

    const { mesh } = result.value;
    disposeShape(result.value.finalSolid);

    // The mesh must carry per-vertex colors (Float32Array, R/G/B per vertex).
    expect(mesh.colors).toBeDefined();
    expect(mesh.colors!.length).toBeGreaterThan(0);
    // Must be a multiple of 3 (R,G,B tuples).
    expect(mesh.colors!.length % 3).toBe(0);

    // Collect distinct (R,G,B) triples rounded to 2 dp to compare per-solid hues.
    const triples = new Set<string>();
    for (let i = 0; i < mesh.colors!.length; i += 3) {
      const r = mesh.colors![i]!.toFixed(2);
      const g = mesh.colors![i + 1]!.toFixed(2);
      const b = mesh.colors![i + 2]!.toFixed(2);
      triples.add(`${r},${g},${b}`);
    }
    // At least 2 distinct RGB triples — one per box color.
    expect(triples.size).toBeGreaterThanOrEqual(2);
  });
});