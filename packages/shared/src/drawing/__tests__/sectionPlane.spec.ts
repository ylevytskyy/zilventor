import { describe, it, expect } from 'vitest';
import { deriveSplitPlane, sideOfSectionLine, type Plane } from '../sectionPlane';
import type { Mat4 } from '../viewMatrix';

// Front-view matrix: camera at (0,0,1000) looking at origin, up = +Y.
// right=+X, trueUp=+Y, fwd=+Z → row-major view matrix rows are [right | -dot], [trueUp | -dot], [-fwd | dot]
// right=(1,0,0), trueUp=(0,1,0), fwd=(0,0,1)
// Row 0: [1, 0, 0, 0]  (right; -dot(right,(0,0,1000)) = 0)
// Row 1: [0, 1, 0, 0]  (trueUp; -dot(trueUp,(0,0,1000)) = 0)
// Row 2: [0, 0, -1, 1000] (-fwd; dot(fwd,(0,0,1000)) = 1000)
// Row 3: [0, 0, 0, 1]
const FRONT_VIEW_MATRIX: Mat4 = [
  1, 0,  0,    0,
  0, 1,  0,    0,
  0, 0, -1, 1000,
  0, 0,  0,    1,
];

// Top-view matrix: camera at (0,1000,0) looking at origin, up = -Z (world).
// fwd = normalize((0,-1000,0)) = (0,-1,0)
// right = normalize(cross(fwd,up)) = cross((0,-1,0),(0,0,-1)) = (1,0,0)
// trueUp = cross(right,fwd) = cross((1,0,0),(0,-1,0)) = (0,0,-1)
// Row0=[1,0,0,-dot((1,0,0),(0,1000,0))]=[1,0,0,0]
// Row1=[0,0,-1,-dot((0,0,-1),(0,1000,0))]=[0,0,-1,0]
// Row2=[-fwd.x,-fwd.y,-fwd.z,dot(fwd,(0,1000,0))]=[0,1,0,dot((0,-1,0),(0,1000,0))]=[0,1,0,-1000]
// Row3=[0,0,0,1]
const TOP_VIEW_MATRIX: Mat4 = [
  1,  0,  0,     0,
  0,  0, -1,     0,
  0,  1,  0, -1000,
  0,  0,  0,     1,
];

function approx(a: number, b: number, tol = 1e-5): boolean {
  return Math.abs(a - b) < tol;
}

function normLen(v: { x: number; y: number; z: number }): number {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}

describe('deriveSplitPlane (HS-SP-1..HS-SP-4)', () => {
  // HS-SP-1: Front view, horizontal line (0,50)→(200,50), cutSide +1
  // lineDir=(1,0,0), splitNormal2D={x:-0*1, y:1*1}=(0,1,0) in view space
  // Front-view inverse maps view-Y → world-Y → normal ≈ (0,+1,0)
  it('HS-SP-1: front view, horizontal line, cutSide +1 → normal.y > 0', () => {
    const result: Plane = deriveSplitPlane(
      { p0: { x: 0, y: 50 }, p1: { x: 200, y: 50 } },
      FRONT_VIEW_MATRIX, 1,
    );
    expect(approx(normLen(result.normal), 1.0)).toBe(true);
    expect(approx(result.normal.x, 0)).toBe(true);
    expect(result.normal.y).toBeGreaterThan(0.9);
    expect(approx(result.normal.z, 0, 1e-4)).toBe(true);
    expect(approx(result.origin.x, 100, 1e-3)).toBe(true);
    expect(approx(result.origin.y, 50, 1e-3)).toBe(true);
  });

  // HS-SP-2: Same geometry, cutSide -1 → normal flips to -Y
  it('HS-SP-2: front view, horizontal line, cutSide -1 → normal.y < 0', () => {
    const result: Plane = deriveSplitPlane(
      { p0: { x: 0, y: 50 }, p1: { x: 200, y: 50 } },
      FRONT_VIEW_MATRIX, -1,
    );
    expect(approx(normLen(result.normal), 1.0)).toBe(true);
    expect(result.normal.y).toBeLessThan(-0.9);
  });

  // HS-SP-3: Top view, vertical line (100,0)→(100,200), cutSide +1
  // lineDir=(0,1,0) in view space, splitNormal2D={x:-1*1, y:0}=(-1,0,0)
  // Top-view matrix row0=[1,0,0,0] → view-X direction is world-X direction
  // applyRowMajorDir on (-1,0,0): row0 col=(1,0,0) → x=-1; row1 col=(0,0,-1) → y=0; row2 col=(0,1,0) → z=0
  // So world normal ≈ (-1, 0, 0). Use structural check (sign of x component).
  it('HS-SP-3: top view, vertical line, cutSide +1 → normal.x < 0 (structural check)', () => {
    const result: Plane = deriveSplitPlane(
      { p0: { x: 100, y: 0 }, p1: { x: 100, y: 200 } },
      TOP_VIEW_MATRIX, 1,
    );
    expect(approx(normLen(result.normal), 1.0)).toBe(true);
    // Structural check: for vertical line in top view, cutSide=+1 means right of p0→p1 direction in view.
    // lineDir=(0,1) in view; splitNormal2D = (-1, 0) in view; view-X = world-X → normal.x < 0.
    // Sign robustness: we verify the cross-product sign rather than hardcoding the value.
    // For top view: applyRowMajorDir on (0,1,0): x=0*0+0*1+0*0=0; y=0*0+0*1+(-1)*0=0; z=0*0+1*1+0*0=1
    // So lineDir in world = (0,0,1). Cross(lineDir, normal) should have cutSide sign.
    // The main verification: normal.x should be negative (left side of world X axis)
    expect(result.normal.x).toBeLessThan(-0.5);
  });

  // HS-SP-4: Front view, 45° line (0,0)→(100,100), cutSide +1
  // lineDir=(1,1,0)/√2; splitNormal2D={x:-1/√2, y:1/√2}; through front inv → world=(-1/√2, 1/√2, 0)
  it('HS-SP-4: front view, 45° line, cutSide +1 → normal perpendicular to line, unit length', () => {
    const result: Plane = deriveSplitPlane(
      { p0: { x: 0, y: 0 }, p1: { x: 100, y: 100 } },
      FRONT_VIEW_MATRIX, 1,
    );
    expect(approx(normLen(result.normal), 1.0)).toBe(true);
    const lineDirX = 1 / Math.sqrt(2);
    const lineDirY = 1 / Math.sqrt(2);
    const dot = result.normal.x * lineDirX + result.normal.y * lineDirY + result.normal.z * 0;
    expect(approx(dot, 0, 1e-6)).toBe(true);
    expect(result.normal.x).toBeLessThan(-0.5);
    expect(result.normal.y).toBeGreaterThan(0.5);
    expect(approx(result.normal.z, 0, 1e-4)).toBe(true);
  });
});

describe('deriveSplitPlane degenerate (HS-SP-6)', () => {
  // HS-SP-6: degenerate zero-length section line returns plane at world midpoint of p0/p1
  // p0 = p1 = (10, 5) → midView = (10, 5, 0)
  // FRONT_VIEW_MATRIX inverse: identity in XY, z_world = 1000 - z_view = 1000
  // applyRowMajor(invFront, {x:10,y:5,z:0}) = {x:10, y:5, z:1000}
  it('HS-SP-6: degenerate zero-length section line returns plane at world midpoint of p0/p1', () => {
    const result: Plane = deriveSplitPlane(
      { p0: { x: 10, y: 5 }, p1: { x: 10, y: 5 } },
      FRONT_VIEW_MATRIX, 1,
    );
    // Origin should be world-space transform of (10, 5, 0) via invFront
    // invFront of FRONT_VIEW_MATRIX: since it's an orthographic matrix,
    // applyRowMajor(invM, {x:10,y:5,z:0}) = {x:10, y:5, z:1000}
    expect(approx(result.origin.x, 10, 1e-3)).toBe(true);
    expect(approx(result.origin.y, 5, 1e-3)).toBe(true);
    expect(approx(result.origin.z, 1000, 1e-3)).toBe(true);
    // Normal must be a unit vector (any direction is acceptable in the degenerate case)
    expect(approx(normLen(result.normal), 1.0)).toBe(true);
  });
});

describe('sideOfSectionLine (HS-SP-5)', () => {
  it('HS-SP-5a: horizontal line — mouse below (y<0) returns +1', () => {
    expect(sideOfSectionLine({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: -10 })).toBe(1);
  });
  it('HS-SP-5b: horizontal line — mouse above (y>0) returns -1', () => {
    expect(sideOfSectionLine({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 10 })).toBe(-1);
  });
  it('HS-SP-5c: vertical line — mouse right (x>50) returns +1', () => {
    expect(sideOfSectionLine({ x: 50, y: 0 }, { x: 50, y: 100 }, { x: 60, y: 50 })).toBe(1);
  });
  it('HS-SP-5d: vertical line — mouse left (x<50) returns -1', () => {
    expect(sideOfSectionLine({ x: 50, y: 0 }, { x: 50, y: 100 }, { x: 40, y: 50 })).toBe(-1);
  });
  it('HS-SP-5e: diagonal line — mouse on each side', () => {
    expect(sideOfSectionLine({ x: 0, y: 0 }, { x: 100, y: 100 }, { x: 80, y: 20 })).toBe(1);
    expect(sideOfSectionLine({ x: 0, y: 0 }, { x: 100, y: 100 }, { x: 20, y: 80 })).toBe(-1);
  });
  it('HS-SP-5f: mouse on line → +1 (tie-break, cross === 0)', () => {
    expect(sideOfSectionLine({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 0 })).toBe(1);
  });
});

// --- Stepped-section validator (Drawing F1.2) ---

import { validateSteppedInvariant } from '../sectionPlane';
import type { SectionView } from '../types';

// NOTE (F1.2 adaptation): exactOptionalPropertyTypes is true in tsconfig.base,
// so we model the validator-input shape with explicit `| undefined` rather than
// `Pick<SectionView, ...>` — the test cases need to pass `undefined` literals to
// the validator to exercise each clause's "absent" branch.
type SteppedValidatorInput = {
  mode: SectionView['mode'];
  stepSegments: SectionView['stepSegments'] | undefined;
  cutSide: SectionView['cutSide'] | undefined;
  splitPlane: SectionView['splitPlane'] | undefined;
};

describe('SectionView — stepped mode + stepSegments shape (F1.2 type extension)', () => {
  it("SectionView accepts mode: 'stepped' with stepSegments and no cutSide/splitPlane", () => {
    const sv: SectionView = {
      id: 'sv-step',
      kind: 'section',
      parentViewId: 'v1',
      sectionLine: { p0: { x: 0, y: 0 }, p1: { x: 10, y: 10 } },
      arrowDirection: 1,
      label: 'A',
      positionMm: { x: 10, y: 130 },
      scale: { numerator: 1, denominator: 1 },
      showHidden: false,
      mode: 'stepped',
      stepSegments: [
        { startSheet: { x: 0,  y: 0 }, endSheet: { x: 10, y: 0  } },
        { startSheet: { x: 10, y: 0 }, endSheet: { x: 10, y: 10 } },
      ],
      hatchSegments: [],
      fingerprint: '',
    };
    expect(sv.mode).toBe('stepped');
    expect(sv.stepSegments).toHaveLength(2);
    expect(sv.cutSide).toBeUndefined();
    expect(sv.splitPlane).toBeUndefined();
  });
});

describe('validateSteppedInvariant — α-invariant clauses (SS-SP-4)', () => {
  // SS-SP-4a — clause 1: stepSegments !== undefined
  it('SS-SP-4a: throws when mode === stepped but stepSegments is undefined', () => {
    const view: SteppedValidatorInput = {
      mode: 'stepped',
      stepSegments: undefined,
      cutSide: undefined,
      splitPlane: undefined,
    };
    expect(() => validateSteppedInvariant(view)).toThrow(/stepped-section-invariant-violated:.*stepSegments must be defined/);
  });

  it('does not throw when mode !== stepped (validator is a no-op for full/half)', () => {
    const fullView: SteppedValidatorInput = {
      mode: 'full',
      stepSegments: undefined,
      cutSide: undefined,
      splitPlane: undefined,
    };
    expect(() => validateSteppedInvariant(fullView)).not.toThrow();
    const halfView: SteppedValidatorInput = {
      mode: 'half',
      stepSegments: undefined,
      cutSide: 1,
      splitPlane: { origin: { x: 0, y: 0, z: 0 }, normal: { x: 1, y: 0, z: 0 } },
    };
    expect(() => validateSteppedInvariant(halfView)).not.toThrow();
  });

  // SS-SP-4b — clause 2: stepSegments.length >= 2
  it('SS-SP-4b: throws when stepSegments has only 1 segment (use full Section tool instead)', () => {
    const view: SteppedValidatorInput = {
      mode: 'stepped',
      stepSegments: [
        { startSheet: { x: 0, y: 0 }, endSheet: { x: 10, y: 0 } },
      ],
      cutSide: undefined,
      splitPlane: undefined,
    };
    expect(() => validateSteppedInvariant(view)).toThrow(/stepped-section-invariant-violated:.*stepSegments\.length must be >= 2/);
  });

  // SS-SP-4c — clause 3: stepSegments.length <= 8
  it('SS-SP-4c: throws when stepSegments has 9 segments (max is 8 = 7 jogs)', () => {
    // 9 axis-aligned alternating segments, each sharing endpoints — only clause 3 should catch this.
    const view: SteppedValidatorInput = {
      mode: 'stepped',
      stepSegments: [
        { startSheet: { x:  0, y:  0 }, endSheet: { x: 10, y:  0 } }, // H
        { startSheet: { x: 10, y:  0 }, endSheet: { x: 10, y: 10 } }, // V
        { startSheet: { x: 10, y: 10 }, endSheet: { x: 20, y: 10 } }, // H
        { startSheet: { x: 20, y: 10 }, endSheet: { x: 20, y: 20 } }, // V
        { startSheet: { x: 20, y: 20 }, endSheet: { x: 30, y: 20 } }, // H
        { startSheet: { x: 30, y: 20 }, endSheet: { x: 30, y: 30 } }, // V
        { startSheet: { x: 30, y: 30 }, endSheet: { x: 40, y: 30 } }, // H
        { startSheet: { x: 40, y: 30 }, endSheet: { x: 40, y: 40 } }, // V
        { startSheet: { x: 40, y: 40 }, endSheet: { x: 50, y: 40 } }, // H — 9th segment
      ],
      cutSide: undefined,
      splitPlane: undefined,
    };
    expect(() => validateSteppedInvariant(view)).toThrow(/stepped-section-invariant-violated:.*stepSegments\.length must be <= 8/);
  });

  // SS-SP-4d — clause 4: every segment is axis-aligned (dx===0 XOR dy===0)
  it('SS-SP-4d: throws when any segment is oblique (dx !== 0 AND dy !== 0)', () => {
    // Length 2 (clauses 2,3 pass). First segment is oblique: dx=10, dy=10.
    const view: SteppedValidatorInput = {
      mode: 'stepped',
      stepSegments: [
        { startSheet: { x:  0, y:  0 }, endSheet: { x: 10, y: 10 } }, // OBLIQUE
        { startSheet: { x: 10, y: 10 }, endSheet: { x: 10, y: 20 } }, // V (irrelevant — clause 4 should fail on seg 0 first)
      ],
      cutSide: undefined,
      splitPlane: undefined,
    };
    expect(() => validateSteppedInvariant(view)).toThrow(/stepped-section-invariant-violated:.*segments must be axis-aligned/);
  });

  // SS-SP-4e — clause 5: consecutive segments share an endpoint
  it('SS-SP-4e: throws when two axis-aligned segments do not share an endpoint', () => {
    // seg0 is horizontal (H), seg1 is vertical (V) — different axes, so clause 6 won't catch.
    // Both axis-aligned (clause 4 passes). Length 2 (clauses 2,3 pass). They DO NOT touch:
    // seg0 ends at (10,0); seg1 starts at (20,5).
    const view: SteppedValidatorInput = {
      mode: 'stepped',
      stepSegments: [
        { startSheet: { x:  0, y: 0 }, endSheet: { x: 10, y:  0 } }, // H, ends at (10,0)
        { startSheet: { x: 20, y: 5 }, endSheet: { x: 20, y: 15 } }, // V, starts at (20,5)
      ],
      cutSide: undefined,
      splitPlane: undefined,
    };
    expect(() => validateSteppedInvariant(view)).toThrow(/stepped-section-invariant-violated:.*consecutive segments must share an endpoint/);
  });

  // SS-SP-4f — clause 6: consecutive segments alternate axes (H-V-H-V-...)
  it('SS-SP-4f: throws when two consecutive segments are both on the same axis', () => {
    // Both segments horizontal, share endpoint at (10,0) — clauses 1-5 all pass.
    // Equivalent to a single H segment from (0,0) to (20,0) — invalid (no jog).
    const view: SteppedValidatorInput = {
      mode: 'stepped',
      stepSegments: [
        { startSheet: { x:  0, y: 0 }, endSheet: { x: 10, y: 0 } }, // H
        { startSheet: { x: 10, y: 0 }, endSheet: { x: 20, y: 0 } }, // H — same axis as previous
      ],
      cutSide: undefined,
      splitPlane: undefined,
    };
    expect(() => validateSteppedInvariant(view)).toThrow(/stepped-section-invariant-violated:.*consecutive segments must alternate axes/);
  });

  // SS-SP-4g — clause 7: cutSide and splitPlane must be undefined for stepped mode
  it('SS-SP-4g: throws when stepped view also carries cutSide (stepped+half combo rejected)', () => {
    // 2 valid axis-aligned alternating segments sharing endpoints — clauses 1-6 all pass.
    // cutSide is set → clause 7 must catch.
    const view: SteppedValidatorInput = {
      mode: 'stepped',
      stepSegments: [
        { startSheet: { x:  0, y: 0 }, endSheet: { x: 10, y:  0 } },
        { startSheet: { x: 10, y: 0 }, endSheet: { x: 10, y: 10 } },
      ],
      cutSide: 1, // <— forbidden in stepped mode (deferred to F1.2.2)
      splitPlane: undefined,
    };
    expect(() => validateSteppedInvariant(view)).toThrow(/stepped-section-invariant-violated:.*cutSide and splitPlane must be undefined/);
  });

  it('SS-SP-4g (bis): throws when stepped view also carries splitPlane', () => {
    const view: SteppedValidatorInput = {
      mode: 'stepped',
      stepSegments: [
        { startSheet: { x:  0, y: 0 }, endSheet: { x: 10, y:  0 } },
        { startSheet: { x: 10, y: 0 }, endSheet: { x: 10, y: 10 } },
      ],
      cutSide: undefined,
      splitPlane: { origin: { x: 5, y: 0, z: 0 }, normal: { x: 0, y: 1, z: 0 } }, // <— forbidden
    };
    expect(() => validateSteppedInvariant(view)).toThrow(/stepped-section-invariant-violated:.*cutSide and splitPlane must be undefined/);
  });
});

// --- deriveStepPlanes happy-path (SS-SP-1 .. SS-SP-3) ---

import { deriveStepPlanes } from '../sectionPlane';

describe('deriveStepPlanes (SS-SP-1..SS-SP-3)', () => {
  // SS-SP-1 — Front view, 2 axis-aligned segments, arrowDirection +1
  //   seg0 horizontal (0,0)→(60,0): lineDir=(1,0,0) view; splitNormal2D=(0,1,0); world ≈ (0,1,0).
  //   seg1 vertical   (60,0)→(60,30): lineDir=(0,1,0) view; splitNormal2D=(-1,0,0); world ≈ (-1,0,0).
  it('SS-SP-1: front view, 2 axis-aligned segments → 2 orthogonal planes with normals along world-Y and world-X', () => {
    const planes = deriveStepPlanes(
      [
        { startSheet: { x:  0, y: 0 }, endSheet: { x: 60, y:  0 } }, // H
        { startSheet: { x: 60, y: 0 }, endSheet: { x: 60, y: 30 } }, // V
      ],
      FRONT_VIEW_MATRIX,
      1,
    );
    expect(planes).toHaveLength(2);

    // plane 0: normal along +Y in world
    expect(approx(normLen(planes[0]!.normal), 1.0)).toBe(true);
    expect(approx(planes[0]!.normal.x, 0, 1e-4)).toBe(true);
    expect(planes[0]!.normal.y).toBeGreaterThan(0.9);
    expect(approx(planes[0]!.normal.z, 0, 1e-4)).toBe(true);

    // plane 1: normal along -X in world
    expect(approx(normLen(planes[1]!.normal), 1.0)).toBe(true);
    expect(planes[1]!.normal.x).toBeLessThan(-0.9);
    expect(approx(planes[1]!.normal.y, 0, 1e-4)).toBe(true);
    expect(approx(planes[1]!.normal.z, 0, 1e-4)).toBe(true);

    // Orthogonality cross-check: dot(plane0.normal, plane1.normal) ≈ 0
    const dot = planes[0]!.normal.x * planes[1]!.normal.x
              + planes[0]!.normal.y * planes[1]!.normal.y
              + planes[0]!.normal.z * planes[1]!.normal.z;
    expect(approx(dot, 0, 1e-6)).toBe(true);
  });

  // SS-SP-2 — Same geometry, arrowDirection -1 → all normals negated relative to SS-SP-1.
  it('SS-SP-2: arrowDirection -1 → all planes’ normals flipped', () => {
    const planesPos = deriveStepPlanes(
      [
        { startSheet: { x:  0, y: 0 }, endSheet: { x: 60, y:  0 } },
        { startSheet: { x: 60, y: 0 }, endSheet: { x: 60, y: 30 } },
      ],
      FRONT_VIEW_MATRIX,
      1,
    );
    const planesNeg = deriveStepPlanes(
      [
        { startSheet: { x:  0, y: 0 }, endSheet: { x: 60, y:  0 } },
        { startSheet: { x: 60, y: 0 }, endSheet: { x: 60, y: 30 } },
      ],
      FRONT_VIEW_MATRIX,
      -1,
    );
    expect(planesNeg).toHaveLength(2);

    for (let i = 0; i < 2; i++) {
      const np = planesPos[i]!.normal;
      const nn = planesNeg[i]!.normal;
      expect(approx(nn.x, -np.x, 1e-6)).toBe(true);
      expect(approx(nn.y, -np.y, 1e-6)).toBe(true);
      expect(approx(nn.z, -np.z, 1e-6)).toBe(true);
      // Origins are identical (same segment midpoints; not affected by arrowDirection).
      expect(approx(planesNeg[i]!.origin.x, planesPos[i]!.origin.x, 1e-6)).toBe(true);
      expect(approx(planesNeg[i]!.origin.y, planesPos[i]!.origin.y, 1e-6)).toBe(true);
      expect(approx(planesNeg[i]!.origin.z, planesPos[i]!.origin.z, 1e-6)).toBe(true);
    }
  });

  // SS-SP-3 — Top view, 2 axis-aligned segments → planes correctly transformed into world space.
  // Structural check: unit-length normals, perpendicular to each other.
  it('SS-SP-3: top view, 2 axis-aligned segments → planes transformed into world space (structural check)', () => {
    const planes = deriveStepPlanes(
      [
        { startSheet: { x:  0, y: 0 }, endSheet: { x: 50, y:  0 } }, // H in top view
        { startSheet: { x: 50, y: 0 }, endSheet: { x: 50, y: 40 } }, // V in top view
      ],
      TOP_VIEW_MATRIX,
      1,
    );
    expect(planes).toHaveLength(2);

    // Both normals unit-length
    expect(approx(normLen(planes[0]!.normal), 1.0)).toBe(true);
    expect(approx(normLen(planes[1]!.normal), 1.0)).toBe(true);

    // Top-view sees XZ plane: view-Y on screen = world -Z. Plane normals therefore live in the
    // world XZ subspace (i.e., world Y component ≈ 0).
    expect(approx(planes[0]!.normal.y, 0, 1e-4)).toBe(true);
    expect(approx(planes[1]!.normal.y, 0, 1e-4)).toBe(true);

    // Orthogonality of normals
    const dot = planes[0]!.normal.x * planes[1]!.normal.x
              + planes[0]!.normal.y * planes[1]!.normal.y
              + planes[0]!.normal.z * planes[1]!.normal.z;
    expect(approx(dot, 0, 1e-6)).toBe(true);
  });
});
