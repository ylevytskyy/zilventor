import { describe, it, expect, beforeAll } from 'vitest';
import { loadOcct, type OcctInstance } from '../../../occt/occtLoader';
import { executeSketchFeature } from '../SketchFeature';
import { executeExtrudeFeature } from '../ExtrudeFeature';
import { computeBoundingBox, disposeShape } from '../../../occt/SolidOps';

/** Computes the volume of a solid shape via OCCT's BRepGProp (same pattern as
 *  cutBySectionPlane.ts shapeVolume). The shape is NOT disposed. */
function solidVolume(oc: OcctInstance, shape: unknown): number {
  const props = new oc.GProp_GProps_1();
  try {
    oc.BRepGProp.VolumeProperties_1(shape as never, props, true as never, false as never, false as never);
    return props.Mass();
  } finally {
    props.delete();
  }
}

let occt: OcctInstance;
beforeAll(async () => { occt = await loadOcct(); }, 60_000);

describe('ExtrudeFeature', () => {
  it('extrudes a 100x200 rect by 50 to a 100x200x50 solid', () => {
    const sketch = executeSketchFeature(occt, {
      kind: 'sketch', id: 's1', plane: { source: 'workPlane', featureId: 'origin.XY' }, primitives: [{ id: 'p1', kind: 'rectangle', x: 0, y: 0, w: 100, h: 200 }], constraints: []
    });
    expect(sketch.ok).toBe(true);
    if (!sketch.ok) return;

    const ex = executeExtrudeFeature(occt, sketch.value, {
      kind: 'extrude', id: 'e1', sketchRef: 's1', distanceParam: 'd1', direction: 'forward', operation: 'new'
    }, 50);
    expect(ex.ok).toBe(true);
    if (!ex.ok) return;

    const bb = computeBoundingBox(occt, ex.value.solid);
    expect(bb[0]).toBeCloseTo(0, 5);
    expect(bb[1]).toBeCloseTo(0, 5);
    expect(bb[2]).toBeCloseTo(0, 5);
    expect(bb[3]).toBeCloseTo(100, 5);
    expect(bb[4]).toBeCloseTo(200, 5);
    expect(bb[5]).toBeCloseTo(50, 5);
    disposeShape(ex.value.solid);
  });

  it('executeExtrudeFeature labels 6 faces for a rectangle prism', () => {
    const sketch = executeSketchFeature(occt, {
      kind: 'sketch', id: 's1', plane: { source: 'workPlane', featureId: 'origin.XY' }, primitives: [{ id: 'p1', kind: 'rectangle', x: 0, y: 0, w: 100, h: 200 }], constraints: []
    });
    expect(sketch.ok).toBe(true);
    if (!sketch.ok) return;

    const ex = executeExtrudeFeature(occt, sketch.value, {
      kind: 'extrude', id: 'e1', sketchRef: 's1', distanceParam: 'd1', direction: 'forward', operation: 'new'
    }, 50);
    expect(ex.ok).toBe(true);
    if (!ex.ok) return;

    expect(ex.value.named.faceNames).toHaveLength(6);
    const roles = ex.value.named.faceNames.map((f) => f.name.role).sort();
    expect(roles).toContain('top');
    expect(roles).toContain('bottom');
    expect(roles.filter((r) => r === 'side')).toHaveLength(4);
    disposeShape(ex.value.solid);
  });

  it('rejects non-positive extrude distance', () => {
    const sketch = executeSketchFeature(occt, {
      kind: 'sketch', id: 's1', plane: { source: 'workPlane', featureId: 'origin.XY' }, primitives: [{ id: 'p1', kind: 'rectangle', x: 0, y: 0, w: 100, h: 200 }], constraints: []
    });
    expect(sketch.ok).toBe(true);
    if (!sketch.ok) return;

    const ex = executeExtrudeFeature(occt, sketch.value, {
      kind: 'extrude', id: 'e1', sketchRef: 's1', distanceParam: 'd1', direction: 'forward', operation: 'new'
    }, 0);
    expect(ex.ok).toBe(false);
    if (!ex.ok) expect(ex.error.kind).toBe('invalidParameter');
  });

  // ── Slice-1 sketch productivity tools: integration gate ─────────────────────
  //
  // Profile: a 50×50 square with one corner (at origin) replaced by a fillet arc
  // of radius r=2. The closed loop is:
  //   line1  (2,0)→(50,0)
  //   line2  (50,0)→(50,50)
  //   line3  (50,50)→(0,50)
  //   line4  (0,50)→(0,2)
  //   arc    center=(2,2) r=2 startAngle=−π endAngle=−π/2   [CCW quarter-arc]
  //
  // The arc angles match what computeFillet() produces:
  //   t1=(0,2) → a1=atan2(0−2, 0−2)=π → normalized to −π (startAngle)
  //   t2=(2,0) → a2=atan2(0−2, 2−2)=−π/2                   (endAngle)
  //   CCW sweep: −π → −π/2 = +π/2 rad (a correct quarter-circle).
  //
  // A construction line (diagonal) is also present; it MUST be excluded from
  // the profile by SketchFeature's `if (p.construction) continue` guard.
  //
  // Expected volume: slightly less than 50×50×10=25000 mm³ (fillet removes a
  // quarter-disc slice of area = r² − π·r²/4 = 4−π ≈ 0.858 mm²).
  it('extrudes a filleted-corner profile (slice-1 fillet arc) to a valid solid with correct volume', () => {
    // Arc angles: startAngle = −π (point (0,2)), endAngle = −π/2 (point (2,0)).
    // OCCT BRepBuilderAPI_MakeEdge_9 sweeps CCW from startAngle to endAngle.
    // −π → −π/2 CCW = +π/2 rad = one quarter turn. Correct short-arc fillet.
    const sketch = executeSketchFeature(occt, {
      kind: 'sketch',
      id: 's-fillet',
      plane: { source: 'workPlane', featureId: 'origin.XY' },
      primitives: [
        // Real profile edges (CCW winding, fillet at origin corner).
        { id: 'l1', kind: 'line', x1: 2,  y1: 0,  x2: 50, y2: 0  },
        { id: 'l2', kind: 'line', x1: 50, y1: 0,  x2: 50, y2: 50 },
        { id: 'l3', kind: 'line', x1: 50, y1: 50, x2: 0,  y2: 50 },
        { id: 'l4', kind: 'line', x1: 0,  y1: 50, x2: 0,  y2: 2  },
        // Fillet arc: center=(2,2) r=2, tangent to l4 at (0,2) and to l1 at (2,0).
        // startAngle=−π → (0,2), endAngle=−π/2 → (2,0); CCW sweep = +π/2.
        {
          id: 'a1',
          kind: 'arc',
          cx: 2,
          cy: 2,
          r: 2,
          startAngle: -Math.PI,      // −π: point (0,2)
          endAngle:   -Math.PI / 2,  // −π/2: point (2,0)
        },
        // Construction diagonal: MUST be excluded from the wire.
        { id: 'c1', kind: 'line', x1: 0, y1: 0, x2: 50, y2: 50, construction: true },
      ],
      constraints: [],
    });

    expect(sketch.ok, sketch.ok ? 'ok' : sketch.error.message).toBe(true);
    if (!sketch.ok) return;
    expect(sketch.value.closed).toBe(true);

    const ex = executeExtrudeFeature(occt, sketch.value, {
      kind: 'extrude', id: 'e-fillet', sketchRef: 's-fillet', distanceParam: 'h1',
      direction: 'forward', operation: 'new',
    }, 10);

    expect(ex.ok, ex.ok ? 'ok' : ex.error.message).toBe(true);
    if (!ex.ok) return;

    // Volume must be positive.
    const vol = solidVolume(occt, ex.value.solid.handle);
    expect(vol).toBeGreaterThan(0);

    // Must be LESS than the un-filleted box (25000 mm³) — the corner was trimmed.
    const boxVol = 50 * 50 * 10; // 25000
    expect(vol).toBeLessThan(boxVol);

    // Must not be drastically less — the removed wedge is only ~8.58 mm³.
    // Slack of 50 mm³ allows for OCCT tessellation rounding while still catching
    // an inverted arc (which would produce a huge or degenerate solid).
    expect(vol).toBeGreaterThan(boxVol - 50);

    disposeShape(ex.value.solid);
  });

  // ── Regression guard: fillet arc startAngle < endAngle invariant ─────────────
  //
  // Root cause (fixed in fillet.ts): computeFillet() produced startAngle=-π/2,
  // endAngle=-π (inverted order) for the standard right-angle corner. OCCT's
  // BRepBuilderAPI_MakeEdge_9 adds 2π to endAngle when endAngle < startAngle,
  // sweeping 270° CCW (reflex arc) instead of the correct 90° fillet arc.
  // The empirical proof: the inverted angles produced volume ≈24865.75 mm³
  // (removed ~134 mm³ instead of ~8.6 mm³ for the correct quarter-disc fillet).
  //
  // After the fix (if a1 > a2 swap in fillet.ts), computeFillet() outputs:
  //   startAngle = −π  → point (0,2)  [angle of t2 from center (2,2)]
  //   endAngle   = −π/2 → point (2,0) [angle of t1 from center (2,2)]
  // CCW sweep −π → −π/2 = +π/2 rad = correct quarter-arc fillet.
  //
  // These angles match what computeFillet() produces AFTER the startAngle<endAngle
  // ordering fix (see fillet.ts). They are identical to the slice-1 fillet test
  // above, confirming both tests agree on the correct geometry.
  it('regression: fillet arc with computeFillet canonical angles (-π,-π/2) extrudes to correct volume', () => {
    const sketch = executeSketchFeature(occt, {
      kind: 'sketch',
      id: 's-fillet-regression',
      plane: { source: 'workPlane', featureId: 'origin.XY' },
      primitives: [
        { id: 'l1', kind: 'line', x1: 2,  y1: 0,  x2: 50, y2: 0  },
        { id: 'l2', kind: 'line', x1: 50, y1: 0,  x2: 50, y2: 50 },
        { id: 'l3', kind: 'line', x1: 50, y1: 50, x2: 0,  y2: 50 },
        { id: 'l4', kind: 'line', x1: 0,  y1: 50, x2: 0,  y2: 2  },
        // These match computeFillet's output AFTER the startAngle<endAngle ordering fix (see fillet.ts).
        // startAngle=−π → point (0,2) [angle of t2=(0,2) from center (2,2): atan2(0,−2)=−π]
        // endAngle=−π/2 → point (2,0) [angle of t1=(2,0) from center (2,2): atan2(−2,0)=−π/2]
        // CCW sweep −π → −π/2 = +π/2 rad = correct quarter-arc fillet.
        {
          id: 'a1',
          kind: 'arc',
          cx: 2,
          cy: 2,
          r: 2,
          startAngle: -Math.PI,      // −π: point (0,2)
          endAngle:   -Math.PI / 2,  // −π/2: point (2,0)
        },
      ],
      constraints: [],
    });

    expect(sketch.ok, sketch.ok ? 'ok' : sketch.error.message).toBe(true);
    if (!sketch.ok) return;
    expect(sketch.value.closed).toBe(true);

    const ex = executeExtrudeFeature(occt, sketch.value, {
      kind: 'extrude', id: 'e-fillet-regression', sketchRef: 's-fillet-regression', distanceParam: 'h1',
      direction: 'forward', operation: 'new',
    }, 10);

    expect(ex.ok, ex.ok ? 'ok' : ex.error.message).toBe(true);
    if (!ex.ok) return;

    const vol = solidVolume(occt, ex.value.solid.handle);
    expect(vol).toBeGreaterThan(0);

    // Must be in the correct range: slightly less than 50×50×10=25000 mm³.
    // Buggy (270° reflex) arc produced ~24865.75 mm³ (removed ~134 mm³ instead of ~8.6 mm³).
    // Correct (90°) arc removes only the quarter-disc: area = r²−π·r²/4 ≈ 0.858 mm²,
    // giving volume ≈ 25000 − 0.858×10 = 24991.4 mm³.
    expect(vol).toBeGreaterThan(24950);
    expect(vol).toBeLessThan(25000);

    disposeShape(ex.value.solid);
  });
});
