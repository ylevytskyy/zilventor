import { describe, it, expect } from 'vitest';
import { handleBoreUV } from '../hardware/handleScrewMath';
import type { BoreOp } from '../bore';

describe('handleBoreUV', () => {
  // PC-1 (AUTHORITATIVE): Top face: uDir=+X=length=front.height, vDir=+Y=width=front.width
  //   u = front.height / 2  — CONSTANT (vertical center) for BOTH screws
  //   v = front.width  / 2 ± cc/2  — screws split along WIDTH

  it('returns two bores for bar-pull-96 centered on a 500×200 front', () => {
    // front: length(height)=500, width=200, cc=96, Ø5
    // u (height-center) = 500/2 = 250  → same for both bores
    // v (width-center)  = 200/2 = 100; half-cc = 48
    //   v0 = 100 - 48 = 52
    //   v1 = 100 + 48 = 148
    // depth = 'throughAll'  (PC-3)
    const result = handleBoreUV({
      frontHeight: 500,
      frontWidth: 200,
      cc: 96,
    });
    expect(result).toHaveLength(2);
    const [b0, b1] = result as [BoreOp, BoreOp];

    // Both bores share the same u (height center)
    expect(b0.u).toBeCloseTo(250, 5);
    expect(b1.u).toBeCloseTo(250, 5);

    // Screws split symmetrically along v (width)
    expect(b0.v).toBeCloseTo(52, 5);
    expect(b1.v).toBeCloseTo(148, 5);

    // Bore properties
    expect(b0.diameter).toBe(5);
    expect(b1.diameter).toBe(5);
    expect(b0.depth).toBe('throughAll');   // PC-3
    expect(b1.depth).toBe('throughAll');   // PC-3
    expect(b0.role).toBe('handleScrew-face');
    expect(b1.role).toBe('handleScrew-face');
    expect(b0.connectorKind).toBe('handleScrew');
    expect(b1.connectorKind).toBe('handleScrew');

    // Face: Top, panel feature
    expect(b0.face).toMatchObject({ featureId: 'panel', role: 'Top', instance: 0 });
    expect(b1.face).toMatchObject({ featureId: 'panel', role: 'Top', instance: 0 });

    // Both bores have IDs and connectorIds
    expect(typeof b0.id).toBe('string');
    expect(typeof b1.id).toBe('string');
    expect(typeof b0.connectorId).toBe('string');
    expect(typeof b1.connectorId).toBe('string');

    // §13.4 / PC-1: The two bores are DISTINCT ids AND DISTINCT connectorIds
    // (BOM counts 2 screws per pull = 2N, so connectorIds must differ for deduplication).
    expect(b0.id).not.toBe(b1.id);
    expect(b0.connectorId).not.toBe(b1.connectorId);
    // Both connectorIds must be non-empty strings
    expect(b0.connectorId.length).toBeGreaterThan(0);
    expect(b1.connectorId.length).toBeGreaterThan(0);
  });

  it('returns two bores for cc=128 on a 600×300 front', () => {
    // front: length(height)=600, width=300, cc=128
    // u = 600/2 = 300  — both bores
    // v-center = 300/2 = 150; half-cc = 64
    //   v0 = 150 - 64 = 86
    //   v1 = 150 + 64 = 214
    const result = handleBoreUV({
      frontHeight: 600,
      frontWidth: 300,
      cc: 128,
    });
    expect(result).toHaveLength(2);
    const [b0, b1] = result as [BoreOp, BoreOp];

    expect(b0.u).toBeCloseTo(300, 5);
    expect(b1.u).toBeCloseTo(300, 5);

    expect(b0.v).toBeCloseTo(86, 5);
    expect(b1.v).toBeCloseTo(214, 5);

    // Symmetry check: v values are equidistant from width center
    const vCenter = 300 / 2;
    expect(Math.abs(b0.v - vCenter)).toBeCloseTo(Math.abs(b1.v - vCenter), 5);
    // and they are NOT both at center (would indicate the v-split is missing)
    expect(b0.v).not.toBeCloseTo(b1.v, 1);
  });

  it('width guard: throws when cc + Ø5 >= front.width (width=100, cc=96)', () => {
    // 96 + 5 = 101 >= 100 → must throw mentioning width
    expect(() =>
      handleBoreUV({
        frontHeight: 400,
        frontWidth: 100,
        cc: 96,
      }),
    ).toThrow(/width/i);
  });

  it('width guard: throws for cc=160 on a 160-wide front (cc + Ø5 = 165 >= 160)', () => {
    expect(() =>
      handleBoreUV({
        frontHeight: 500,
        frontWidth: 160,
        cc: 160,
      }),
    ).toThrow(/width/i);
  });

  it('width guard: does NOT throw when cc + Ø5 just fits (width=200, cc=96)', () => {
    // 96 + 5 = 101 < 200 — should pass
    expect(() =>
      handleBoreUV({
        frontHeight: 500,
        frontWidth: 200,
        cc: 96,
      }),
    ).not.toThrow();
  });
});
