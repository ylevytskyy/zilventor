# DXF Phase 4c (session slice) — Curved transform + annotation render — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make imported DXF curves correct under any INSERT transform (rotation/scale/reflection + POINT-OCS), and render the 2D text annotations that Phase 4b already stores.

**Architecture:** Slice A is pure TypeScript in `packages/shared/src/dxf/toSketch.ts`: a single `transformEllipse` routine applies an INSERT's 2×2 linear map to every curve treated as a parametric ellipse (Rytz's construction), and `transformPrimitive` dispatches circle/arc/ellipse through it, simplifying back to circle/arc when the image is isotropic. Slice B is app-side Three.js: `CommittedSketchRenderer` gains a canvas-texture in-plane mesh per `TextAnnotation`.

**Tech Stack:** TypeScript, Vitest (unit), Three.js `^0.165`, Playwright (e2e, Chromium).

## Global Constraints

- Branch: `feat/dxf-support` (off master `8112434a`, NOT merged). Commit but do NOT `git push`.
- NO manifest bump (Slice A emits only existing v32 SketchPrimitive shapes; Slice B is pure rendering).
- NO kernel change, NO WASM rebuild, NO new npm dependency (raw `three@^0.165` only).
- Spec: `docs/superpowers/specs/2026-06-22-dxf-phase4c-curved-transform-annotation-render-design.md`.
- Per-package test commands run from INSIDE the package: `cd packages/shared && npx vitest run <file>`, `cd packages/app && npx vitest run <file>`. e2e from repo root: `npx playwright test --project=chromium tests/e2e/drawing/<file>`.
- tsc DIRECT per package (`pnpm -r typecheck` can mask). `pnpm lint` must stay 0 real errors.
- `Affine = { a; b; c; d; e; f }` is the column-major 2D affine already defined in `toSketch.ts`; `afApply(m,x,y)` and `afMul(m,n)` already exist. `freshId()` already exists.
- DXF ARC angles are stored in degrees and already converted to radians by `mapEntity`; DXF ELLIPSE params are already radians. `SketchPrimitive` arc/ellipse angle fields are radians. `TextAnnotation.rotation` is radians.

---

## File Structure

- `packages/shared/src/dxf/toSketch.ts` — add `transformEllipse` + a small `buildCurveFromEllipse` helper; rewrite the curve cases of `transformPrimitive`; add `ocsXY` to the POINT branch of `mapEntity`.
- `packages/shared/src/dxf/__tests__/toSketch.spec.ts` — flip the pinning test; add curve-transform + POINT-OCS tests.
- `packages/app/src/sketcher/render/CommittedSketchRenderer.ts` — `buildAnnotation` + `update(primitives, annotations)` + cache key + disposal.
- `packages/app/src/sketcher/render/__tests__/CommittedSketchRenderer.spec.ts` — annotation render tests.
- `packages/app/src/App.tsx:1951` — pass `sketch.annotations` to `r.update`.
- `tests/e2e/drawing/dxf-phase4c.spec.ts` (+ fixture) — §6 e2e.

---

## Task 1: `transformEllipse` pure helper

**Files:**
- Modify: `packages/shared/src/dxf/toSketch.ts` (add the helper near the other affine helpers, ~after `insertMatrix`)
- Test: `packages/shared/src/dxf/__tests__/toSketch.spec.ts` (new `describe('transformEllipse')`)

**Interfaces:**
- Consumes: existing `Affine` type and the module-local math (`Math.*`) only.
- Produces:
```ts
function transformEllipse(
  m: Affine,
  cx: number, cy: number,
  rx: number, ry: number,
  rotation: number,
  startParam?: number,
  endParam?: number,
): {
  cx: number; cy: number; rx: number; ry: number; rotation: number;
  startAngle?: number; endAngle?: number; isotropic: boolean;
};
```
Returns the image ellipse's center, principal semi-axes `rx=A ≥ ry=B`, major-axis angle `rotation=φ` (radians), and `startAngle/endAngle` as **principal-frame parameters** of the image (present only when both `startParam` and `endParam` are given; already swapped when the affine reflects). `isotropic` is true when `A ≈ B`.

- [ ] **Step 1: Write the failing tests**

Add to `packages/shared/src/dxf/__tests__/toSketch.spec.ts` (top-level, importing `transformEllipse`; export it from `toSketch.ts` for the test — see Step 3):

```ts
import { transformEllipse } from '../toSketch';

describe('transformEllipse', () => {
  // Pure 90° CCW rotation about origin: M = [[0,-1,0],[1,0,0]] (a=0,b=1,c=-1,d=0,e=0,f=0)
  const rot90: { a: number; b: number; c: number; d: number; e: number; f: number } =
    { a: 0, b: 1, c: -1, d: 0, e: 0, f: 0 };

  it('rotates a circular arc: center and params move by +90°, stays isotropic', () => {
    const r = transformEllipse(rot90, 3, 4, 2, 2, 0, Math.PI / 6, (2 * Math.PI) / 3);
    expect(r.cx).toBeCloseTo(-4, 9);
    expect(r.cy).toBeCloseTo(3, 9);
    expect(r.rx).toBeCloseTo(2, 9);
    expect(r.ry).toBeCloseTo(2, 9);
    expect(r.isotropic).toBe(true);
    // principal-frame params + the returned rotation reconstruct the TRUE angles 2π/3 and 7π/6
    expect(r.startAngle! + r.rotation).toBeCloseTo((2 * Math.PI) / 3, 6);
    expect(r.endAngle! + r.rotation).toBeCloseTo((7 * Math.PI) / 6, 6);
  });

  it('non-uniform scale of a circle yields an axis-aligned ellipse', () => {
    // M = scale(2,1): a=2,d=1
    const m = { a: 2, b: 0, c: 0, d: 1, e: 0, f: 0 };
    const r = transformEllipse(m, 0, 0, 3, 3, 0);
    expect(r.isotropic).toBe(false);
    expect(r.rx).toBeCloseTo(6, 9); // 3*2
    expect(r.ry).toBeCloseTo(3, 9); // 3*1
    expect(r.rotation).toBeCloseTo(0, 9);
  });

  it('reflection (negative x-scale) swaps start/end of an arc', () => {
    // M = scale(-1,1): mirror across Y axis. det = -1 < 0.
    const m = { a: -1, b: 0, c: 0, d: 1, e: 0, f: 0 };
    const r = transformEllipse(m, 0, 0, 2, 2, 0, 0, Math.PI / 2);
    // start point (2,0) -> (-2,0) true angle π ; end point (0,2)->(0,2) true angle π/2
    // reflected => swap so emitted start is the old end-image, end is old start-image
    expect(r.isotropic).toBe(true);
    expect(r.startAngle! + r.rotation).toBeCloseTo(Math.PI / 2, 6);
    expect(r.endAngle! + r.rotation).toBeCloseTo(Math.PI, 6);
  });
});
```

- [ ] **Step 2: Run the tests — verify they fail**

Run: `cd packages/shared && npx vitest run src/dxf/__tests__/toSketch.spec.ts -t transformEllipse`
Expected: FAIL — `transformEllipse is not exported` / not defined.

- [ ] **Step 3: Implement `transformEllipse` (and export it)**

In `packages/shared/src/dxf/toSketch.ts`, add (and add `export` so the unit test can import it directly):

```ts
/**
 * Apply an INSERT affine to a curve treated as a parametric ellipse and recover
 * the image ellipse's principal form via Rytz's construction.
 *
 * Source point at parameter s: P(s) = center + R(rotation)·(rx·cos s, ry·sin s).
 * The affine image of an ellipse is an ellipse; perpendicular source semi-axes map
 * to (generally non-perpendicular) conjugate semi-diameters u',v', from which Rytz
 * gives the principal semi-axes A ≥ B and major-axis angle φ.
 *
 * start/end are returned as PARAMETERS in the image's principal frame (matching the
 * `ellipse` primitive convention). For an isotropic image emitted as circle/arc, the
 * caller converts to a true angle by adding `rotation` (invariant under the arbitrary
 * φ Rytz returns for a circle).
 */
export function transformEllipse(
  m: Affine,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  rotation: number,
  startParam?: number,
  endParam?: number,
): {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  rotation: number;
  startAngle?: number;
  endAngle?: number;
  isotropic: boolean;
} {
  const cosR = Math.cos(rotation);
  const sinR = Math.sin(rotation);
  // source semi-axis vectors  u = R(rot)·(rx,0),  v = R(rot)·(0,ry)
  const ux = rx * cosR;
  const uy = rx * sinR;
  const vx = -ry * sinR;
  const vy = ry * cosR;
  // linear part of the affine applied to u,v (translation dropped)
  const u1x = m.a * ux + m.c * uy;
  const u1y = m.b * ux + m.d * uy;
  const v1x = m.a * vx + m.c * vy;
  const v1y = m.b * vx + m.d * vy;
  // Rytz: principal axes from conjugate semi-diameters u1,v1
  const dotuv = u1x * v1x + u1y * v1y;
  const dotuu = u1x * u1x + u1y * u1y;
  const dotvv = v1x * v1x + v1y * v1y;
  const t = 0.5 * Math.atan2(2 * dotuv, dotuu - dotvv);
  const cosT = Math.cos(t);
  const sinT = Math.sin(t);
  const px = u1x * cosT + v1x * sinT;
  const py = u1y * cosT + v1y * sinT;
  const qx = -u1x * sinT + v1x * cosT;
  const qy = -u1y * sinT + v1y * cosT;
  const lenP = Math.hypot(px, py);
  const lenQ = Math.hypot(qx, qy);
  let A: number;
  let B: number;
  let majx: number;
  let majy: number;
  if (lenP >= lenQ) {
    A = lenP;
    B = lenQ;
    majx = px;
    majy = py;
  } else {
    A = lenQ;
    B = lenP;
    majx = qx;
    majy = qy;
  }
  const phi = Math.atan2(majy, majx);
  const cx1 = m.a * cx + m.c * cy + m.e;
  const cy1 = m.b * cx + m.d * cy + m.f;
  const isotropic = Math.abs(A - B) <= 1e-9 * (A || 1);
  const reflected = m.a * m.d - m.b * m.c < 0;

  const out: {
    cx: number; cy: number; rx: number; ry: number; rotation: number;
    startAngle?: number; endAngle?: number; isotropic: boolean;
  } = { cx: cx1, cy: cy1, rx: A, ry: B, rotation: phi, isotropic };

  if (startParam !== undefined && endParam !== undefined) {
    const cphi = Math.cos(phi);
    const sphi = Math.sin(phi);
    const mapParam = (s: number): number => {
      const lx = rx * Math.cos(s);
      const ly = ry * Math.sin(s);
      const wx = cx + cosR * lx - sinR * ly;
      const wy = cy + sinR * lx + cosR * ly;
      const tx = m.a * wx + m.c * wy + m.e;
      const ty = m.b * wx + m.d * wy + m.f;
      const dx = tx - cx1;
      const dy = ty - cy1;
      // R(-phi)·(dx,dy)
      const ex = cphi * dx + sphi * dy;
      const ey = -sphi * dx + cphi * dy;
      return Math.atan2(ey / B, ex / A);
    };
    let sa = mapParam(startParam);
    let ea = mapParam(endParam);
    if (reflected) {
      const tmp = sa;
      sa = ea;
      ea = tmp;
    }
    out.startAngle = sa;
    out.endAngle = ea;
  }
  return out;
}
```

- [ ] **Step 4: Run the tests — verify they pass**

Run: `cd packages/shared && npx vitest run src/dxf/__tests__/toSketch.spec.ts -t transformEllipse`
Expected: PASS (3 tests).

- [ ] **Step 5: Typecheck + commit**

Run: `cd packages/shared && npx tsc --noEmit` → Expected: 0 errors.
```bash
git add packages/shared/src/dxf/toSketch.ts packages/shared/src/dxf/__tests__/toSketch.spec.ts
git commit -m "feat(dxf): transformEllipse — linear-map-of-ellipse via Rytz (Phase 4c task A1)"
```

---

## Task 2: Dispatch curves through `transformEllipse` in `transformPrimitive` + flip the pinning test

**Files:**
- Modify: `packages/shared/src/dxf/toSketch.ts` (the `circle`/`arc`/`ellipse` cases of `transformPrimitive`; remove the `// 4b LIMITATION` block; add a `buildCurveFromEllipse` helper)
- Test: `packages/shared/src/dxf/__tests__/toSketch.spec.ts` (flip the pinning test; add cases)

**Interfaces:**
- Consumes: `transformEllipse` (Task 1), existing `freshId()`, `Affine`.
- Produces: corrected `transformPrimitive` behavior (same signature). Curve emission rule:
  - isotropic + had angles → `arc` with `startAngle = sa + rotation`, `endAngle = ea + rotation`
  - isotropic + no angles → `circle`
  - anisotropic + had angles → `ellipse` (with `startAngle`/`endAngle` = principal params)
  - anisotropic + no angles → `ellipse` (no start/end)

- [ ] **Step 1: Flip the pinning test + add dispatch tests**

In `packages/shared/src/dxf/__tests__/toSketch.spec.ts`, find the describe block
`'toSketch INSERT arc-angle pinning (4b limitation)'` and REPLACE its single `it(...)` with the
corrected expectation (rename the describe to drop "pinning/limitation"):

```ts
describe('toSketch INSERT arc-angle under rotated INSERT (4c)', () => {
  it('rotates arc start/end angles under a 90° rotated INSERT', () => {
    // (keep the existing fixture/setup that builds a block with ARC center (3,4) r=2
    //  start 30° end 120° and inserts it with rotation=90°, unit scale, base (0,0))
    // Center rotates (3,4) -> (-4,3); angles rotate +90°.
    expect(arc.kind).toBe('arc');
    expect(arc.cx).toBeCloseTo(-4, 9);
    expect(arc.cy).toBeCloseTo(3, 9);
    expect(arc.startAngle).toBeCloseTo((2 * Math.PI) / 3, 6);   // 30°+90° = 120°
    expect(arc.endAngle).toBeCloseTo((7 * Math.PI) / 6, 6);     // 120°+90° = 210°
  });
});
```

Then add a new describe exercising `transformPrimitive` (import it; export from `toSketch.ts` if
not already) directly on primitives, mirroring the `transformEllipse` oracles but at the primitive
level:

```ts
import { transformPrimitive } from '../toSketch';

describe('transformPrimitive curves (4c)', () => {
  const rot90 = { a: 0, b: 1, c: -1, d: 0, e: 0, f: 0 };
  const scale21 = { a: 2, b: 0, c: 0, d: 1, e: 0, f: 0 };

  it('circle under non-uniform scale becomes an axis-aligned ellipse', () => {
    const out = transformPrimitive(scale21, { id: 'c1', kind: 'circle', cx: 0, cy: 0, r: 3 });
    expect(out.kind).toBe('ellipse');
    if (out.kind === 'ellipse') {
      expect(out.rx).toBeCloseTo(6, 9);
      expect(out.ry).toBeCloseTo(3, 9);
      expect(out.rotation).toBeCloseTo(0, 9);
      expect(out.startAngle).toBeUndefined();
    }
  });

  it('circle under pure rotation stays a circle', () => {
    const out = transformPrimitive(rot90, { id: 'c2', kind: 'circle', cx: 1, cy: 0, r: 2 });
    expect(out.kind).toBe('circle');
    if (out.kind === 'circle') {
      expect(out.cx).toBeCloseTo(0, 9);
      expect(out.cy).toBeCloseTo(1, 9);
      expect(out.r).toBeCloseTo(2, 9);
    }
  });

  it('preserves construction flag through the transform', () => {
    const out = transformPrimitive(rot90, { id: 'c3', kind: 'circle', cx: 1, cy: 0, r: 2, construction: true });
    expect(out.construction).toBe(true);
  });
});
```

- [ ] **Step 2: Run — verify failures**

Run: `cd packages/shared && npx vitest run src/dxf/__tests__/toSketch.spec.ts -t "4c"`
Expected: FAIL (old `transformPrimitive` keeps circles as circles / leaves arc angles unchanged).

- [ ] **Step 3: Rewrite the curve cases + add the builder**

In `packages/shared/src/dxf/toSketch.ts`: delete the `// 4b LIMITATION` comment block, then add this
helper (above `transformPrimitive`) and replace the `circle`/`arc`/`ellipse` cases.

```ts
// Build the right SketchPrimitive from a transformEllipse result, simplifying an
// isotropic image back to circle/arc. `hadAngles` is true for arc / elliptical-arc.
function buildCurveFromEllipse(
  e: ReturnType<typeof transformEllipse>,
  hadAngles: boolean,
  construction: boolean | undefined,
): SketchPrimitive {
  const cons = construction ? { construction: true } : {};
  if (e.isotropic) {
    if (hadAngles) {
      return {
        id: freshId(),
        kind: 'arc',
        cx: e.cx,
        cy: e.cy,
        r: e.rx,
        startAngle: e.startAngle! + e.rotation,
        endAngle: e.endAngle! + e.rotation,
        ...cons,
      };
    }
    return { id: freshId(), kind: 'circle', cx: e.cx, cy: e.cy, r: e.rx, ...cons };
  }
  const base = { id: freshId(), kind: 'ellipse' as const, cx: e.cx, cy: e.cy, rx: e.rx, ry: e.ry, rotation: e.rotation };
  return hadAngles
    ? { ...base, startAngle: e.startAngle!, endAngle: e.endAngle!, ...cons }
    : { ...base, ...cons };
}
```

Replace the three curve cases inside `transformPrimitive`:

```ts
    case 'circle': {
      const e = transformEllipse(m, p.cx, p.cy, p.r, p.r, 0);
      return buildCurveFromEllipse(e, false, p.construction);
    }
    case 'arc': {
      const e = transformEllipse(m, p.cx, p.cy, p.r, p.r, 0, p.startAngle, p.endAngle);
      return buildCurveFromEllipse(e, true, p.construction);
    }
    case 'ellipse': {
      const hadAngles = p.startAngle !== undefined && p.endAngle !== undefined;
      const e = transformEllipse(
        m, p.cx, p.cy, p.rx, p.ry, p.rotation,
        hadAngles ? p.startAngle : undefined,
        hadAngles ? p.endAngle : undefined,
      );
      return buildCurveFromEllipse(e, hadAngles, p.construction);
    }
```

(Leave `line`, `spline`, `point`, `rectangle` cases as-is. Add `export` to `transformPrimitive` if
the test import requires it.)

- [ ] **Step 4: Run — verify pass + no regressions in the file**

Run: `cd packages/shared && npx vitest run src/dxf/__tests__/toSketch.spec.ts`
Expected: PASS (all toSketch tests, including the flipped pinning test and new 4c cases).

- [ ] **Step 5: Typecheck + commit**

Run: `cd packages/shared && npx tsc --noEmit` → 0 errors.
```bash
git add packages/shared/src/dxf/toSketch.ts packages/shared/src/dxf/__tests__/toSketch.spec.ts
git commit -m "feat(dxf): curves correct under INSERT transform; flip arc-angle pinning test (Phase 4c task A2)"
```

---

## Task 3: POINT OCS extrusion in `mapEntity`

**Files:**
- Modify: `packages/shared/src/dxf/toSketch.ts` (the `POINT` branch of `mapEntity`, ~line 314)
- Test: `packages/shared/src/dxf/__tests__/toSketch.spec.ts`

**Interfaces:**
- Consumes: existing `ocsXY(ext, px, py)` helper (already in the file from 4a).
- Produces: POINT coordinates projected OCS→WCS before unit-scale, parallel to CIRCLE/ARC.

- [ ] **Step 1: Write the failing test**

```ts
describe('toSketch POINT OCS (4c)', () => {
  it('mirrors a POINT under extrusion (0,0,-1)', () => {
    // Build a minimal ParsedDxf with one POINT at (5,7) extrusion (0,0,-1), $INSUNITS unitless.
    // (mirror the existing POINT test setup in this file; add extrusion 210/220/230 = 0/0/-1)
    // ocsXY with extrusion (0,0,-1) negates x: (5,7) -> (-5,7)
    expect(pt.kind).toBe('point');
    expect(pt.x).toBeCloseTo(-5, 9);
    expect(pt.y).toBeCloseTo(7, 9);
  });
});
```

- [ ] **Step 2: Run — verify it fails**

Run: `cd packages/shared && npx vitest run src/dxf/__tests__/toSketch.spec.ts -t "POINT OCS"`
Expected: FAIL — current code returns raw `(5,7)`.

- [ ] **Step 3: Implement**

In the `POINT` case of `mapEntity` (currently `return { id: freshId(), kind: 'point', x: e.x * s, y: e.y * s, ...cons };`), project through OCS first:

```ts
    case 'POINT': {
      const wp = ocsXY(e.extrusion, e.x, e.y);
      return { id: freshId(), kind: 'point', x: wp.x * s, y: wp.y * s, ...cons };
    }
```

(Match the exact field name the entity uses for extrusion — the implementer must check how CIRCLE/ARC read it in this file, e.g. `e.extrusion` vs a parsed `ext`; use the SAME accessor.)

- [ ] **Step 4: Run — verify pass**

Run: `cd packages/shared && npx vitest run src/dxf/__tests__/toSketch.spec.ts`
Expected: PASS (full file).

- [ ] **Step 5: Typecheck + commit**

Run: `cd packages/shared && npx tsc --noEmit` → 0 errors.
```bash
git add packages/shared/src/dxf/toSketch.ts packages/shared/src/dxf/__tests__/toSketch.spec.ts
git commit -m "feat(dxf): apply OCS extrusion to POINT entities (Phase 4c task A3)"
```

---

## Task 4: Render text annotations in `CommittedSketchRenderer`

**Files:**
- Modify: `packages/app/src/sketcher/render/CommittedSketchRenderer.ts`
- Modify: `packages/app/src/App.tsx:1951`
- Test: `packages/app/src/sketcher/render/__tests__/CommittedSketchRenderer.spec.ts`

**Interfaces:**
- Consumes: `TextAnnotation` from `@zilventor/shared` (or the existing shared import alias used in this file); the existing `SKETCH_Z` constant and group/cache machinery in the renderer.
- Produces: `update(primitives, annotations?)` — annotations rendered as `THREE.Mesh` (PlaneGeometry + CanvasTexture + transparent MeshBasicMaterial), in-plane, `rotation.z = ann.rotation`, world-height = `ann.height`.

- [ ] **Step 1: Write the failing tests**

Add to `packages/app/src/sketcher/render/__tests__/CommittedSketchRenderer.spec.ts` (import `THREE`,
the renderer, and `TextAnnotation`):

```ts
describe('CommittedSketchRenderer annotations (4c)', () => {
  it('renders a text annotation as a THREE.Mesh with a CanvasTexture', () => {
    const r = new CommittedSketchRenderer();
    r.update([], [{ id: 'a1', x: 10, y: 20, height: 3, value: 'HELLO', rotation: 0 }]);
    expect(r.group.children).toHaveLength(1);
    const child = r.group.children[0];
    expect(child).toBeInstanceOf(THREE.Mesh);
    const mat = (child as THREE.Mesh).material as THREE.MeshBasicMaterial;
    expect(mat.map).toBeInstanceOf(THREE.CanvasTexture);
  });

  it('applies rotation and height to the annotation mesh', () => {
    const r = new CommittedSketchRenderer();
    r.update([], [{ id: 'a2', x: 0, y: 0, height: 5, value: 'X', rotation: Math.PI / 4 }]);
    const mesh = r.group.children[0] as THREE.Mesh;
    expect(mesh.rotation.z).toBeCloseTo(Math.PI / 4, 9);
    mesh.geometry.computeBoundingBox();
    const bb = mesh.geometry.boundingBox!;
    expect(bb.max.y - bb.min.y).toBeCloseTo(5, 6); // plane world-height == ann.height
  });

  it('renders primitives and annotations together', () => {
    const r = new CommittedSketchRenderer();
    r.update(
      [{ id: 'l1', kind: 'line', x1: 0, y1: 0, x2: 1, y2: 1 }],
      [{ id: 'a3', x: 0, y: 0, height: 2, value: 'T', rotation: 0 }],
    );
    expect(r.group.children).toHaveLength(2);
  });

  it('omitting annotations keeps primitives-only behavior (back-compat)', () => {
    const r = new CommittedSketchRenderer();
    r.update([{ id: 'l2', kind: 'line', x1: 0, y1: 0, x2: 1, y2: 1 }]);
    expect(r.group.children).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run — verify failures**

Run: `cd packages/app && npx vitest run src/sketcher/render/__tests__/CommittedSketchRenderer.spec.ts -t "annotations (4c)"`
Expected: FAIL — `update` takes one arg / no Mesh produced.

- [ ] **Step 3: Implement the renderer change**

In `packages/app/src/sketcher/render/CommittedSketchRenderer.ts`:

1. Import the type: `import type { SketchPrimitive, TextAnnotation } from '@zilventor/shared';` (match the existing import path/alias used for `SketchPrimitive` in this file).

2. Change the signature and fold annotations into the cache key + rebuild:

```ts
  update(
    primitives: ReadonlyArray<SketchPrimitive>,
    annotations: ReadonlyArray<TextAnnotation> = [],
  ): void {
    const key =
      primitives.map((p) => `${p.id}:${p.construction ? 'c' : 'n'}`).join('|') +
      '##' +
      annotations.map((a) => `${a.id}:${a.value}:${a.height}:${a.rotation}`).join('|');
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.clear(); // existing disposal of group children (geometry+material+texture)
    for (const p of primitives) {
      const obj = this.buildObject(p);
      if (obj) this.group.add(obj);
    }
    for (const a of annotations) {
      this.group.add(this.buildAnnotation(a));
    }
  }
```

(Reuse the renderer's EXISTING cache-key field name and clear/dispose method — read the current file
and adapt names; the snippet above shows the shape, not necessarily the exact identifiers.)

3. Add the builder:

```ts
  private buildAnnotation(ann: TextAnnotation): THREE.Mesh {
    const PX_PER_UNIT = 32; // canvas resolution; world size comes from the plane, not this
    const fontPx = Math.max(8, Math.round(ann.height * PX_PER_UNIT));
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    ctx.font = `${fontPx}px sans-serif`;
    const textW = Math.max(1, ctx.measureText(ann.value).width);
    canvas.width = Math.ceil(textW);
    canvas.height = Math.ceil(fontPx * 1.25);
    // re-set font after resize (resizing clears the context state)
    ctx.font = `${fontPx}px sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(ann.value, 0, canvas.height / 2);

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthTest: false });
    const worldH = ann.height;
    const worldW = (canvas.width / canvas.height) * worldH;
    const geometry = new THREE.PlaneGeometry(worldW, worldH);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(ann.x + worldW / 2, ann.y, SKETCH_Z); // PlaneGeometry is centered; left-anchor at ann.x
    mesh.rotation.z = ann.rotation;
    return mesh;
  }
```

(Confirm `SKETCH_Z` (or the equivalent z used by `buildObject`) — reuse the SAME z the other
committed geometry uses. In jsdom/vitest, `document.createElement('canvas').getContext('2d')` returns
a stub; `measureText` returns width 0 there — the `Math.max(1, …)` guards keep geometry valid so the
unit tests pass. The bounding-box height assertion checks `worldH`, which is independent of canvas
metrics.)

4. Ensure `clear()`/`dispose()` disposes annotation `material.map` (the CanvasTexture) as well as
geometry/material — extend the existing disposal loop to call `child.material.map?.dispose()` when
present.

- [ ] **Step 4: Wire the call site**

In `packages/app/src/App.tsx` at line ~1951, change:
```ts
r.update(sketch?.primitives ?? []);
```
to:
```ts
r.update(sketch?.primitives ?? [], sketch?.annotations ?? []);
```

- [ ] **Step 5: Run — verify pass**

Run: `cd packages/app && npx vitest run src/sketcher/render/__tests__/CommittedSketchRenderer.spec.ts`
Expected: PASS (existing primitive/point tests + new annotation tests).

- [ ] **Step 6: Typecheck + commit**

Run: `cd packages/app && npx tsc --noEmit` → 0 errors.
```bash
git add packages/app/src/sketcher/render/CommittedSketchRenderer.ts packages/app/src/sketcher/render/__tests__/CommittedSketchRenderer.spec.ts packages/app/src/App.tsx
git commit -m "feat(dxf): render TextAnnotation as in-plane canvas-texture mesh (Phase 4c task B1)"
```

---

## Task 5: §6 e2e — rotated INSERT arc + text annotation

**Files:**
- Create: `tests/e2e/drawing/dxf-phase4c.spec.ts`
- Reference: existing `tests/e2e/drawing/dxf-import.spec.ts` (mirror its kernel-boot/page-nav/import-hook harness exactly)

**Interfaces:**
- Consumes: DEV hook `window.__zilventorImportDxfNewPart(file: File)`; `window.__zilventorStore`.

- [ ] **Step 1: Write the e2e (this IS the test — it asserts the integrated behavior)**

Create `tests/e2e/drawing/dxf-phase4c.spec.ts`. Mirror the setup of the existing phase4b/4a e2e in
`dxf-import.spec.ts` (kernel ready wait, navigation, the `File` construction + `__zilventorImportDxfNewPart`
call). Use this DXF fixture string (block ARC inserted with rotation=90°, plus a top-level TEXT so the
annotation render path is independent of INSERT-annotation transforms, which are out of scope):

```ts
const DXF = `0
SECTION
2
BLOCKS
0
BLOCK
8
0
2
MYBLK
10
0.0
20
0.0
0
ARC
8
0
10
3.0
20
4.0
40
2.0
50
30.0
51
120.0
0
ENDBLK
0
ENDSEC
0
SECTION
2
ENTITIES
0
INSERT
8
0
2
MYBLK
10
0.0
20
0.0
41
1.0
42
1.0
50
90.0
0
TEXT
8
0
10
1.0
20
1.0
40
2.5
1
HELLO
50
0.0
0
ENDSEC
0
EOF
`;
```

Assertions (read state via `window.__zilventorStore`, never pixels):

```ts
// after import, locate the imported part's sketch feature
const result = await page.evaluate(() => {
  const store = (window as any).__zilventorStore.getState();
  // navigate to the active/imported part document's sketch feature (mirror how the
  // phase4b e2e reaches the imported part — same store path)
  const doc = /* imported PartDocument */;
  const sketch = doc.features.find((f: any) => f.kind === 'sketch');
  const arc = sketch.primitives.find((p: any) => p.kind === 'arc');
  return {
    arcCx: arc?.cx, arcCy: arc?.cy, arcStart: arc?.startAngle, arcEnd: arc?.endAngle,
    annCount: (sketch.annotations ?? []).length,
  };
});
expect(result.arcCx).toBeCloseTo(-4, 3);   // (3,4) rotated 90° -> (-4,3)
expect(result.arcCy).toBeCloseTo(3, 3);
expect(result.arcStart).toBeCloseTo((2 * Math.PI) / 3, 3); // 120°
expect(result.arcEnd).toBeCloseTo((7 * Math.PI) / 6, 3);   // 210°
expect(result.annCount).toBeGreaterThanOrEqual(1);          // TEXT carried as annotation
```

(The exact store path to the imported `PartDocument` MUST match the existing phase4b e2e — read that
test and copy its navigation. If the parser requires a HEADER section or specific group-code spacing,
adapt the fixture to match the format the existing e2e fixtures use.)

NOTE on render proof: headless Chrome renders the viewport black and there is no scene-introspection
probe for annotation meshes, so the annotation RENDER is proven by the Task 4 unit tests; this e2e
proves the annotation survives import into the document (Slice B data path) and the arc transform
(Slice A).

- [ ] **Step 2: Run — verify it fails first if run before A2 (optional) then passes after A2+B1**

Run: `npx playwright test --project=chromium tests/e2e/drawing/dxf-phase4c.spec.ts`
Expected (after A2/A3/B1 merged): PASS — arc angles 2π/3 / 7π/6, center (-4,3), ≥1 annotation.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/drawing/dxf-phase4c.spec.ts
git commit -m "test(dxf): e2e rotated-INSERT arc + text annotation import (Phase 4c task C1)"
```

---

## Final verification (after all tasks)

- [ ] `cd packages/shared && npx vitest run` — green; `npx tsc --noEmit` — 0.
- [ ] `cd packages/app && npx vitest run` — green except the 3 known pre-existing App.spec frameToModel teardown flakes (NOT ours; confirm they pre-date this branch by checking they fail on a stash of these changes); `npx tsc --noEmit` — 0.
- [ ] `cd packages/kernel && npx vitest run` — green (untouched; sanity only).
- [ ] `pnpm lint` — 0 real errors (the ~454 stale `.claude/worktrees` path-noise warnings are pre-existing).
- [ ] `npx playwright test --project=chromium tests/e2e/drawing/dxf-phase4c.spec.ts` — PASS.
- [ ] Confirm NO manifest version change anywhere (`git diff` shows no version bump).
- [ ] Update `.superpowers/sdd/progress.md` with a Phase 4c (session slice) section marked COMPLETE.

## Self-Review (done by plan author)

- **Spec coverage:** Slice A general/exact (A1 helper + A2 dispatch), reflection (A1 test + transformEllipse swap), POINT-OCS (A3), pinning-test flip (A2), Slice B render (B1) + call site (B1 step 4), §6 e2e (C1), no manifest bump (Final). ✓
- **Placeholder scan:** the only deferred-to-implementer items are EXISTING identifiers the implementer must read from the current file (renderer cache-key/clear method names; the entity extrusion accessor; the e2e store path). These are explicitly flagged as "match the existing X", not invented behavior. No "TODO/handle edge cases" placeholders. ✓
- **Type consistency:** `transformEllipse` return shape, `buildCurveFromEllipse(e, hadAngles, construction)`, and `update(primitives, annotations)` are used identically across tasks. Arc-angle conversion (`+ rotation`) is consistent between A1's test (`startAngle + rotation`) and A2's builder. ✓
- **Out of scope** explicitly fenced (DIMENSION/HATCH/etc.) so no task drifts. ✓
