/**
 * Integration test: per-solid color extraction for a real-world STRUCTURED
 * XCAF assembly STEP file (Autodesk Inventor 2012, AP214).
 *
 * The file binds color via STYLED_ITEM on MANIFOLD_SOLID_BREP entities (not on
 * instance/component labels). Before the fix, readStep() returned all-null
 * solidColors for this file. This test guards the fix.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadOcct, type OcctInstance } from '../occtLoader';
import { readStep } from '../StepIO';
import { disposeShape } from '../SolidOps';

const FIXTURES = resolve(__dirname, 'fixtures/step');

describe('readStep — Inventor 2012 structured-assembly color extraction', () => {
  let oc: OcctInstance;
  beforeAll(async () => { oc = await loadOcct(); }, 120_000);

  it('extracts ≥40 non-null solidColors and ≥4 distinct color values', () => {
    const raw = readFileSync(resolve(FIXTURES, 'inventor-2012-body-color.step'));
    const bytes = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer;
    const res = readStep(oc, bytes);
    try {
      // File has 48 MANIFOLD_SOLID_BREP entities
      expect(res.solidCount).toBeGreaterThanOrEqual(40);

      const nonNull = res.solidColors.filter((c) => c !== null);
      // At least 40 solids must carry a non-null color (file has ~6 distinct colors)
      expect(nonNull.length).toBeGreaterThanOrEqual(40);

      // Must have ≥4 distinct non-null color values (proves per-body, not uniform gray)
      const distinct = new Set(nonNull);
      expect(distinct.size).toBeGreaterThanOrEqual(4);
    } finally {
      disposeShape(res.shape);
    }
  });
});
