# DXF Milestone M1 — Phase 3: Sketch-Model Extension (ellipse + degree-n spline) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the sketch model with a first-class `ellipse` primitive and widen spline `degree` from `2|3` to `number`, plumbed through shared types + serialization, the OCCT kernel (real elliptical edges, not faceted), the planegcs sketcher, and every per-`kind` switch — so Phase 4's DXF importer can land ellipses and high-degree splines as **editable, lossless** sketch geometry.

**Architecture:** Additive union member + one widened field. `shared` owns the type + serialization (manifest **v30→v31**); `kernel` builds the real OCCT edge (`gp_Elips_2` + `BRepBuilderAPI_MakeEdge_12`/`_13`); `sketcher-worker` decomposes the ellipse to defining points for the solver (exactly as splines do — the curve is not solved, its points are); `app` adds an `ellipse` branch to each sketcher `kind` switch. No new import command in this phase (that is Phase 4).

**Tech Stack:** TypeScript (pnpm monorepo: `packages/shared`, `packages/kernel`, `packages/app`, `packages/sketcher-worker`), opencascade.js `2.0.0-beta`, planegcs WASM, Vitest, Three.js (2D render).

## Global Constraints

- **Manifest bump v30→v31** — `CURRENT_FORMAT_VERSION = 30` → `31` in `packages/shared/src/fileFormat.ts:4`. Add a migration entry keyed `30` returning `formatVersion: 31`. It is a **no-op structural migration** (existing splines are already valid `degree:number`; no ellipses exist in any saved doc). Old docs need no mutation.
- **Ellipse model (locked by design spec §4.3):** `{ id: string; kind: 'ellipse'; cx: number; cy: number; rx: number; ry: number; rotation: number; startAngle?: number; endAngle?: number; construction?: boolean }`. `rx`/`ry` are radii along the local (pre-rotation) x/y axes. `rotation` (radians) rotates the whole ellipse in-plane. `startAngle`/`endAngle` (radians) are **eccentric parameters in the local frame**; both omitted ⇒ full ellipse, otherwise an elliptical arc. This matches OCCT's `gp_Elips` parameterization and DXF ELLIPSE group 41/42.
- **Spline degree widened** `2 | 3` → `number` in BOTH `packages/shared/src/types.ts` AND `packages/kernel/src/occt/SketchOps.ts` (`SplineParams`). The existing clamp `Math.min(s.degree, nbPoles - 1)` stays; the `as 2 | 3` cast at `SketchOps.ts:313` must change (it becomes a `number`).
- **No new runtime deps in `shared`** (zero-dep package — unchanged).
- **Transient cross-package red is expected mid-migration:** widening the `SketchPrimitive` union in Task 1 makes `kernel`/`app` value-returning switches fail `tsc` until Tasks 2–4 land their `ellipse` branches. Each task leaves **its own package** green; the whole monorepo is green only after Task 4. Reviewers: do not treat transient kernel/app red between tasks as a regression.
- **TEST CWD (load-bearing):** run each package's suite from inside the package — `cd packages/shared && npx vitest run`; `cd packages/kernel && npx vitest run` (unit, EXCLUDES `*.integration.spec.ts`); `cd packages/kernel && npx vitest run --config vitest.integration.config.ts` (real-OCCT); `cd packages/app && npx vitest run`; `cd packages/sketcher-worker && npx vitest run`. Run `tsc` **directly per package** (`pnpm -r typecheck` can mask). `pnpm lint` (root `eslint .`) must stay 0.
- **OCCT verification rule:** headless renders the viewport black — assert geometry via real-OCCT bounding-box / centroid oracles, never pixels. Never delete a returned/shared shape; balance `new`/`delete` on intermediate OCCT objects (follow the exact delete pattern in `makeArcEdge`).

---

## File Structure

| File | Responsibility | Change |
|------|----------------|--------|
| `packages/shared/src/types.ts` | `SketchPrimitive` union | Add `ellipse` variant; widen spline `degree` to `number` |
| `packages/shared/src/inferFromGeometry.ts` | `endpointsOf` per-kind (constraint inference) | Add `ellipse` case |
| `packages/shared/src/fileFormat.ts` | manifest version + migrations | `30`→`31`; add no-op migration keyed `30`; version-assert churn |
| `packages/kernel/src/occt/SketchOps.ts` | OCCT edge builders + param types | Widen `SplineParams.degree`; fix `as 2\|3` cast; add `EllipseParams` + `makeEllipseEdge` |
| `packages/kernel/src/adapter/features/SketchFeature.ts` | primitive→edge dispatch switch | Add `case 'ellipse'` |
| `packages/sketcher-worker/src/GcsSystem.ts` | solver decomposition switch | Add `case 'ellipse'` (decompose to defining points) |
| `packages/app/src/sketcher/snap.ts` | `primitiveEndpoints` switch | Add `ellipse` case |
| `packages/app/src/sketcher/tools/SelectTool.ts` | `hitTest` if/else chain | Add `ellipse` branch |
| `packages/app/src/sketcher/tools/ConstraintTool.ts` | `pickAt` if/else chain | Add `ellipse` branch |
| `packages/app/src/model/ProfilePickController.ts` | `primitivesBbox` switch | Add `ellipse` case |
| `packages/app/src/sketcher/render/CommittedSketchRenderer.ts` | `buildGeometry` if-chain | Add `ellipse` render branch |
| `packages/app/src/sketcher/tools/OffsetTool.ts` | `samplePrimitive`/`signedDist` | Add `ellipse` (stub-tolerant, matches existing spline stub) |

---

## Task 1: Shared model + serialization (foundational)

**Files:**
- Modify: `packages/shared/src/types.ts:30-35` (`SketchPrimitive` union)
- Modify: `packages/shared/src/inferFromGeometry.ts:6-24` (`endpointsOf`)
- Modify: `packages/shared/src/fileFormat.ts:4` (version) + migrations table
- Test: `packages/shared/src/__tests__/inferFromGeometry.spec.ts`
- Test: `packages/shared/src/__tests__/fileFormat.spec.ts` (or wherever migration/version asserts live — find with grep)

**Interfaces:**
- Produces: the `ellipse` member of `SketchPrimitive` (exact shape in Global Constraints); spline `degree: number`; `CURRENT_FORMAT_VERSION = 31`. Tasks 2–4 consume the `ellipse` shape.

**Current code (verbatim, `types.ts:30-35`):**
```typescript
export type SketchPrimitive =
  | { id: string; kind: 'line'; x1: number; y1: number; x2: number; y2: number; construction?: boolean }
  | { id: string; kind: 'rectangle'; x: number; y: number; w: number; h: number; construction?: boolean }
  | { id: string; kind: 'circle'; cx: number; cy: number; r: number; construction?: boolean }
  | { id: string; kind: 'arc'; cx: number; cy: number; r: number; startAngle: number; endAngle: number; construction?: boolean }
  | { id: string; kind: 'spline'; controlPoints: ReadonlyArray<{ x: number; y: number }>; degree: 2 | 3; closed: boolean; construction?: boolean };
```

- [ ] **Step 1: Write the failing test — `endpointsOf` for an ellipse**

In `packages/shared/src/__tests__/inferFromGeometry.spec.ts` add:
```typescript
it('infers endpoints for a full ellipse (center only)', () => {
  const out = inferFromGeometry([
    { id: 'e1', kind: 'ellipse', cx: 10, cy: 20, rx: 5, ry: 3, rotation: 0 },
  ]);
  // full ellipse contributes a coincidence-eligible center anchor and never crashes
  expect(out).toBeInstanceOf(Array);
});

it('infers start/end + center endpoints for an elliptical arc', () => {
  // local-frame eccentric params: start at param 0 → (cx+rx, cy); end at param π/2 → (cx, cy+ry)
  const out = inferFromGeometry([
    { id: 'a', kind: 'line', x1: 15, y1: 20, x2: 99, y2: 99 }, // endpoint to coincide with ellipse start
    { id: 'e2', kind: 'ellipse', cx: 10, cy: 20, rx: 5, ry: 3, rotation: 0, startAngle: 0, endAngle: Math.PI / 2 },
  ]);
  // line.start (15,20) coincides with ellipse start (cx+rx=15, cy=20) → a coincident constraint is inferred
  expect(out.some((c) => c.kind === 'coincident')).toBe(true);
});
```
(If `inferFromGeometry`'s constraint kind name differs from `'coincident'`, grep the existing spec for the real kind and match it.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/shared && npx vitest run inferFromGeometry`
Expected: FAIL — `tsc`/runtime rejects `kind: 'ellipse'` (not in union) and/or `endpointsOf` has no ellipse case.

- [ ] **Step 3: Add the `ellipse` variant + widen spline degree (`types.ts`)**

Replace the spline line and append the ellipse variant:
```typescript
  | { id: string; kind: 'arc'; cx: number; cy: number; r: number; startAngle: number; endAngle: number; construction?: boolean }
  | { id: string; kind: 'spline'; controlPoints: ReadonlyArray<{ x: number; y: number }>; degree: number; closed: boolean; construction?: boolean }
  | { id: string; kind: 'ellipse'; cx: number; cy: number; rx: number; ry: number; rotation: number; startAngle?: number; endAngle?: number; construction?: boolean };
```

- [ ] **Step 4: Add the `ellipse` case to `endpointsOf` (`inferFromGeometry.ts`)**

Add before the closing `}` of the switch (model the start/end on the local-frame eccentric param, mirroring the `arc` case but with `rx`/`ry` and `rotation`):
```typescript
    case 'ellipse': {
      const out: Array<{ anchor: PointRef['anchor']; x: number; y: number }> = [
        { anchor: 'center', x: p.cx, y: p.cy },
      ];
      if (p.startAngle !== undefined && p.endAngle !== undefined) {
        const cr = Math.cos(p.rotation), sr = Math.sin(p.rotation);
        const pt = (t: number) => {
          const lx = p.rx * Math.cos(t), ly = p.ry * Math.sin(t);
          return { x: p.cx + lx * cr - ly * sr, y: p.cy + lx * sr + ly * cr };
        };
        const s = pt(p.startAngle), e = pt(p.endAngle);
        out.push({ anchor: 'start', x: s.x, y: s.y }, { anchor: 'end', x: e.x, y: e.y });
      }
      return out;
    }
```

- [ ] **Step 5: Run the endpointsOf tests — confirm green**

Run: `cd packages/shared && npx vitest run inferFromGeometry`
Expected: PASS.

- [ ] **Step 6: Write the failing migration test (v30→v31)**

Find the migration/version spec (`grep -rn "CURRENT_FORMAT_VERSION\|formatVersion: 30\|toBe(30)" packages/shared/src`). Add to the migration spec file:
```typescript
it('migrates a v30 document to v31 (no-op structural bump)', () => {
  const v30doc = { kind: 'part', formatVersion: 30, document: { configurations: [] } };
  const out = migrateToCurrent(v30doc as never); // use the real migrate entry point name
  expect(out.formatVersion).toBe(31);
});
```
(Use the actual migrate-to-current function name — grep the existing spec; it is the same helper the v29→v30 tests call.)

- [ ] **Step 7: Run it — verify it fails**

Run: `cd packages/shared && npx vitest run fileFormat`
Expected: FAIL — `CURRENT_FORMAT_VERSION` is still 30; no migration keyed `30`.

- [ ] **Step 8: Bump version + add migration (`fileFormat.ts`)**

At `fileFormat.ts:4`: `export const CURRENT_FORMAT_VERSION = 31 as const;`

Add to the migrations table (model on the no-op v14/v15 entries already present):
```typescript
  // v30 → v31: DXF Phase 3 sketch-model extension. Additive: introduces the
  // `ellipse` SketchPrimitive kind and widens spline `degree` 2|3 → number.
  // No existing document needs mutation (no ellipses exist; existing spline
  // degrees are valid numbers). The bump pins the new schema. (DXF M1 Phase 3)
  30: (mIn) => {
    const m = deepClone(mIn);
    return { ...m, formatVersion: 31 };
  },
```

- [ ] **Step 9: Fix the version-assert churn**

Many tests assert the current version. Run `grep -rn "toBe(30)\|=== 30\|: 30\b\|formatVersion: 30" packages/shared/src` and update every assertion that means "migrate-to-current output" or "current version is" from `30`→`31`. **Do NOT** change fixtures that are deliberate *inputs* representing an old-version doc (e.g. a v29 or v30 starting document) — only the expected-current outputs. (Memory note: prior bumps had ~1 "input straggler" that was wrongly swept — re-read each hit.)

- [ ] **Step 10: Run the full shared suite + tsc**

Run: `cd packages/shared && npx vitest run` then `cd packages/shared && npx tsc --noEmit`
Expected: all shared tests PASS, shared `tsc` 0 errors.

- [ ] **Step 11: Commit**

```bash
git add packages/shared/src/types.ts packages/shared/src/inferFromGeometry.ts packages/shared/src/fileFormat.ts packages/shared/src/__tests__/
git commit -m "feat(dxf): add ellipse SketchPrimitive + degree-n spline + manifest v30→v31 (Phase 3 shared)"
```

---

## Task 2: Kernel OCCT ellipse edge + degree-n spline

**Files:**
- Modify: `packages/kernel/src/occt/SketchOps.ts` (`SplineParams` type:236-240; cast:313; new `EllipseParams` + `makeEllipseEdge`)
- Modify: `packages/kernel/src/adapter/features/SketchFeature.ts:99-115` (dispatch switch)
- Test: `packages/kernel/src/occt/__tests__/SketchOps.integration.spec.ts` (real-OCCT — find the real path with `grep -rln "makeArcEdge" packages/kernel/src/**/*.integration.spec.ts`; if none, add to the nearest existing SketchOps integration spec)

**Interfaces:**
- Consumes: the shared `ellipse` shape + `spline` `degree: number` (Task 1).
- Produces: `makeEllipseEdge(oc, e: EllipseParams, frame?: SketchFrame): EdgeHandle`; `EllipseParams = { cx; cy; rx; ry; rotation; startAngle?; endAngle? }`. `SketchFeature` dispatches `'ellipse'` to it.

**Current code (verbatim):**
- `makeArcEdge` (`SketchOps.ts:176-196`) — the pattern to mirror:
```typescript
  const c3 = frameTo3D(frame, a.cx, a.cy);
  const center = new oc.gp_Pnt_3(c3.x, c3.y, c3.z);
  const axisDir = new oc.gp_Dir_4(frame.n.x, frame.n.y, frame.n.z);
  const xDir = new oc.gp_Dir_4(frame.u.x, frame.u.y, frame.u.z);
  const ax2 = new oc.gp_Ax2_2(center, axisDir, xDir);
  const circ = new oc.gp_Circ_2(ax2, a.r);
  const mk = new oc.BRepBuilderAPI_MakeEdge_9(circ, a.startAngle, a.endAngle);
  const edge = mk.Edge();
  mk.delete(); circ.delete(); ax2.delete(); xDir.delete(); axisDir.delete(); center.delete();
  return { __brand: 'EdgeHandle', edge };
```
- spline degree cast (`SketchOps.ts:313`): `const degree = Math.min(s.degree, nbPoles - 1) as 2 | 3;`
- `SplineParams` (`SketchOps.ts:236-240`): `{ controlPoints: ReadonlyArray<Point2>; degree: 2 | 3; closed: boolean }`
- `SketchFeature` switch (`:99-115`) handles `line/rectangle/circle/arc/spline`, **no `default`**.

**Verified OCCT bindings (from `opencascade.full.d.ts`):**
- `gp_Elips_2(theA2: gp_Ax2, theMajorRadius: Standard_Real, theMinorRadius: Standard_Real)` — **requires major ≥ minor** (OCCT throws otherwise).
- `BRepBuilderAPI_MakeEdge_12(L: gp_Elips)` — full ellipse.
- `BRepBuilderAPI_MakeEdge_13(L: gp_Elips, p1: Standard_Real, p2: Standard_Real)` — elliptical arc by parameter.

- [ ] **Step 1: Write the failing real-OCCT test — full ellipse bbox**

Add to the SketchOps integration spec (model on existing `makeArcEdge` integration tests; reuse their bbox helper / `Bnd_Box` oracle):
```typescript
it('makeEllipseEdge builds a real elliptical edge with correct axis-aligned bbox', async () => {
  const oc = await getOc(); // use the spec's existing OCCT loader
  const e = makeEllipseEdge(oc, { cx: 0, cy: 0, rx: 8, ry: 3, rotation: 0 });
  const bbox = edgeBbox(oc, e.edge); // existing helper: returns {xmin,xmax,ymin,ymax}
  expect(bbox.xmax - bbox.xmin).toBeCloseTo(16, 2); // 2*rx
  expect(bbox.ymax - bbox.ymin).toBeCloseTo(6, 2);  // 2*ry
});

it('makeEllipseEdge handles ry > rx (swap branch) without throwing + correct bbox', async () => {
  const oc = await getOc();
  const e = makeEllipseEdge(oc, { cx: 0, cy: 0, rx: 3, ry: 8, rotation: 0 });
  const bbox = edgeBbox(oc, e.edge);
  expect(bbox.xmax - bbox.xmin).toBeCloseTo(6, 2);  // 2*rx
  expect(bbox.ymax - bbox.ymin).toBeCloseTo(16, 2); // 2*ry
});

it('makeSplineEdge accepts degree > 3', async () => {
  const oc = await getOc();
  const pts = [{x:0,y:0},{x:1,y:2},{x:2,y:-1},{x:3,y:2},{x:4,y:0},{x:5,y:1}];
  const e = makeSplineEdge(oc, { controlPoints: pts, degree: 5, closed: false });
  expect(e.edge).toBeDefined();
});
```
(If the spec exposes no `edgeBbox`/`getOc` helper, use the same `Bnd_Box`/loader the neighbouring `makeArcEdge` integration test uses — match it exactly.)

- [ ] **Step 2: Run it — verify it fails**

Run: `cd packages/kernel && npx vitest run --config vitest.integration.config.ts SketchOps`
Expected: FAIL — `makeEllipseEdge` undefined; `degree: 5` rejected by `SplineParams` type.

- [ ] **Step 3: Widen `SplineParams.degree` + fix the cast (`SketchOps.ts`)**

`:236-240` → `degree: number;`. At `:313` change:
```typescript
  const degree = Math.min(s.degree, nbPoles - 1);
```
(remove `as 2 | 3`). `GeomAPI_PointsToBSpline_2` takes `Standard_Real`, so a plain `number` is correct.

- [ ] **Step 4: Add `EllipseParams` + `makeEllipseEdge` (`SketchOps.ts`)**

Add the type near `CircleParams` and the function near `makeArcEdge` (mirror its delete discipline exactly):
```typescript
export type EllipseParams = {
  cx: number; cy: number; rx: number; ry: number; rotation: number;
  startAngle?: number; endAngle?: number;
};

/**
 * Builds a real elliptical edge (full ellipse or elliptical arc) in the sketch
 * frame. OCCT's gp_Elips requires majorRadius >= minorRadius, so when ry > rx we
 * swap the axes and rotate the major-axis direction by +90°. Arc parameters are
 * given in the LOCAL (rx-along-x) frame; in the swap branch they shift by -90°.
 */
export function makeEllipseEdge(
  oc: OcctInstance,
  e: EllipseParams,
  frame: SketchFrame = XY_FRAME,
): EdgeHandle {
  const swap = e.ry > e.rx;
  const major = swap ? e.ry : e.rx;
  const minor = swap ? e.rx : e.ry;
  const baseAngle = e.rotation + (swap ? Math.PI / 2 : 0);

  // major-axis direction expressed in 3D via the frame's u/v basis
  const ca = Math.cos(baseAngle), sa = Math.sin(baseAngle);
  const ux = frame.u.x * ca + frame.v.x * sa;
  const uy = frame.u.y * ca + frame.v.y * sa;
  const uz = frame.u.z * ca + frame.v.z * sa;

  const c3 = frameTo3D(frame, e.cx, e.cy);
  const center = new oc.gp_Pnt_3(c3.x, c3.y, c3.z);
  const axisDir = new oc.gp_Dir_4(frame.n.x, frame.n.y, frame.n.z);
  const xDir = new oc.gp_Dir_4(ux, uy, uz);
  const ax2 = new oc.gp_Ax2_2(center, axisDir, xDir);
  const elips = new oc.gp_Elips_2(ax2, major, minor);

  let edge: unknown;
  if (e.startAngle !== undefined && e.endAngle !== undefined) {
    const off = swap ? -Math.PI / 2 : 0;
    const mk = new oc.BRepBuilderAPI_MakeEdge_13(elips, e.startAngle + off, e.endAngle + off);
    edge = mk.Edge();
    mk.delete();
  } else {
    const mk = new oc.BRepBuilderAPI_MakeEdge_12(elips);
    edge = mk.Edge();
    mk.delete();
  }
  elips.delete(); ax2.delete(); xDir.delete(); axisDir.delete(); center.delete();
  return { __brand: 'EdgeHandle', edge };
}
```
(`SketchFrame` exposes `u`, `v`, `n` — confirm `frame.v` exists at `SketchOps.ts:11-24`; if the field is named differently, use the real name. `makeArcEdge` only used `u`/`n`, so verify `v` before relying on it.)

- [ ] **Step 5: Add the dispatch case (`SketchFeature.ts`)**

After the `'spline'` case (`:113-114`), add:
```typescript
        case 'ellipse':
          edges.push(makeEllipseEdge(oc, p, frame));
          break;
```
and add `makeEllipseEdge` to the import from `../../occt/SketchOps` (or the real relative path used for `makeArcEdge`).

- [ ] **Step 6: Run integration + unit + tsc**

Run: `cd packages/kernel && npx vitest run --config vitest.integration.config.ts SketchOps`
Expected: the 3 new tests PASS (real elliptical bbox, swap branch, degree-5 spline).
Run: `cd packages/kernel && npx vitest run` (unit) and `cd packages/kernel && npx tsc --noEmit`
Expected: unit green, kernel `tsc` 0.

- [ ] **Step 7: Commit**

```bash
git add packages/kernel/src/occt/SketchOps.ts packages/kernel/src/adapter/features/SketchFeature.ts packages/kernel/src/occt/__tests__/
git commit -m "feat(dxf): OCCT makeEllipseEdge + degree-n spline + SketchFeature dispatch (Phase 3 kernel)"
```

---

## Task 3: planegcs solver decomposition

**Files:**
- Modify: `packages/sketcher-worker/src/GcsSystem.ts` (the per-kind switch; spline case is the template, ~`:170-180`)
- Test: `packages/sketcher-worker/src/__tests__/GcsSystem.spec.ts` (find with `grep -rln "describe" packages/sketcher-worker/src`; if a different test path, match it)

**Interfaces:**
- Consumes: shared `ellipse` shape (Task 1).
- Produces: an `ellipse` decomposition entry in `this.decomp` keyed by `p.id` with `pointIds` for `center` + axis endpoints. (The solver does NOT constrain the ellipse as a curve — only its defining points exist, exactly like splines.)

**Current spline template (verbatim, `GcsSystem.ts`):**
```typescript
      case 'spline': {
        const pointIds: Record<string, string> = {};
        for (let i = 0; i < p.controlPoints.length; i++) {
          const cp = p.controlPoints[i]!;
          const id = pId(`cp${i}`);
          into.push({ id, type: 'point', x: cp.x, y: cp.y, fixed: false });
          pointIds[`cp${i}`] = id;
        }
        this.decomp.set(p.id, { pointIds, primitiveId: p.id });
        break;
      }
```

- [ ] **Step 1: Write the failing test — ellipse decomposes to defining points**

```typescript
it('decomposes an ellipse into solver points without throwing', () => {
  const sys = new GcsSystem(); // match the spec's existing construction/setup
  const into: unknown[] = [];
  sys.pushPrimitive(  // use the REAL method name the spline test calls (grep the spec)
    { id: 'el1', kind: 'ellipse', cx: 4, cy: 5, rx: 6, ry: 2, rotation: 0 },
    into as never,
  );
  // 5 defining points pushed: center + 4 axis endpoints
  const pts = (into as Array<{ type: string }>).filter((e) => e.type === 'point');
  expect(pts.length).toBe(5);
});
```
(Match the exact method name + arguments the existing `spline`/`arc` tests use to feed a primitive — this plan does not invent an API.)

- [ ] **Step 2: Run it — verify it fails**

Run: `cd packages/sketcher-worker && npx vitest run GcsSystem`
Expected: FAIL — no `ellipse` case (switch falls through; 0 points pushed) and/or `tsc` rejects the `ellipse` kind.

- [ ] **Step 3: Add the `ellipse` case (`GcsSystem.ts`)**

After the `'spline'` case, add (4 axis endpoints in world coords + center, all `fixed:false`, matching the arc case's point style):
```typescript
      case 'ellipse': {
        const cr = Math.cos(p.rotation), sr = Math.sin(p.rotation);
        const at = (lx: number, ly: number) => ({
          x: p.cx + lx * cr - ly * sr,
          y: p.cy + lx * sr + ly * cr,
        });
        const c = pId('center');
        const xp = pId('xpos'), xn = pId('xneg'), yp = pId('ypos'), yn = pId('yneg');
        const pxp = at(p.rx, 0), pxn = at(-p.rx, 0), pyp = at(0, p.ry), pyn = at(0, -p.ry);
        into.push({ id: c, type: 'point', x: p.cx, y: p.cy, fixed: false });
        into.push({ id: xp, type: 'point', x: pxp.x, y: pxp.y, fixed: false });
        into.push({ id: xn, type: 'point', x: pxn.x, y: pxn.y, fixed: false });
        into.push({ id: yp, type: 'point', x: pyp.x, y: pyp.y, fixed: false });
        into.push({ id: yn, type: 'point', x: pyn.x, y: pyn.y, fixed: false });
        this.decomp.set(p.id, {
          pointIds: { center: c, xpos: xp, xneg: xn, ypos: yp, yneg: yn },
          primitiveId: p.id,
        });
        break;
      }
```

- [ ] **Step 4: Run tests + tsc**

Run: `cd packages/sketcher-worker && npx vitest run GcsSystem` → PASS.
Run: `cd packages/sketcher-worker && npx tsc --noEmit` → 0 errors.

- [ ] **Step 5: Commit**

```bash
git add packages/sketcher-worker/src/GcsSystem.ts packages/sketcher-worker/src/__tests__/
git commit -m "feat(dxf): planegcs ellipse decomposition to defining points (Phase 3 solver)"
```

---

## Task 4: App sketcher `kind` switches

**Files:**
- Modify: `packages/app/src/sketcher/snap.ts` (`primitiveEndpoints`, switch ~:15-37)
- Modify: `packages/app/src/sketcher/tools/SelectTool.ts` (`hitTest`, if/else ~:20-48)
- Modify: `packages/app/src/sketcher/tools/ConstraintTool.ts` (`pickAt`, if/else ~:45-73)
- Modify: `packages/app/src/model/ProfilePickController.ts` (`primitivesBbox`, switch ~:54-94)
- Modify: `packages/app/src/sketcher/render/CommittedSketchRenderer.ts` (`buildGeometry`, if-chain ~:36-65)
- Modify: `packages/app/src/sketcher/tools/OffsetTool.ts` (`samplePrimitive`/`signedDist`, ~:13-85)
- Test: co-located specs for snap, ProfilePickController, CommittedSketchRenderer (find with `grep -rln "primitiveEndpoints\|primitivesBbox\|buildGeometry" packages/app/src`); add an ellipse case to each existing spec, or create `*.spec.ts` next to the source if none exists.

**Interfaces:**
- Consumes: shared `ellipse` shape (Task 1). No new exports.

**Helper (use in snap/render/offset — local const per file, DRY within file):**
```typescript
// point on the ellipse at local eccentric param t
const ellipsePt = (p: Extract<SketchPrimitive, { kind: 'ellipse' }>, t: number) => {
  const cr = Math.cos(p.rotation), sr = Math.sin(p.rotation);
  const lx = p.rx * Math.cos(t), ly = p.ry * Math.sin(t);
  return { x: p.cx + lx * cr - ly * sr, y: p.cy + lx * sr + ly * cr };
};
```

- [ ] **Step 1: Write the failing tests (one per behavioural site)**

`snap` spec — endpoints for an ellipse:
```typescript
it('primitiveEndpoints returns center for a full ellipse', () => {
  const out = primitiveEndpoints({ id:'e', kind:'ellipse', cx:2, cy:3, rx:5, ry:1, rotation:0 });
  expect(out).toContainEqual({ x: 2, y: 3 });
});
```
`ProfilePickController` spec — bbox of an ellipse (axis-aligned, rotation 0):
```typescript
it('primitivesBbox bounds an axis-aligned ellipse', () => {
  const b = primitivesBbox([{ id:'e', kind:'ellipse', cx:0, cy:0, rx:8, ry:3, rotation:0 }]);
  expect(b).toMatchObject({ xmin: -8, xmax: 8, ymin: -3, ymax: 3 });
});
```
`CommittedSketchRenderer` spec — builds a Three object for an ellipse (no crash, returns a renderable):
```typescript
it('buildGeometry returns a renderable for an ellipse', () => {
  const obj = renderer.buildGeometry({ id:'e', kind:'ellipse', cx:0, cy:0, rx:4, ry:2, rotation:0 });
  expect(obj).toBeTruthy();
});
```
(Match the real constructor/setup the existing specs use; if a site has no spec file, create one mirroring the nearest existing sketcher spec.)

- [ ] **Step 2: Run them — verify they fail**

Run: `cd packages/app && npx vitest run snap ProfilePickController CommittedSketchRenderer`
Expected: FAIL — no ellipse handling; some sites also fail `tsc` (value-returning switches now have an uncovered union member).

- [ ] **Step 3: Add the ellipse branch to each site**

**`snap.ts` `primitiveEndpoints`** — add a case:
```typescript
    case 'ellipse': {
      const cr = Math.cos(p.rotation), sr = Math.sin(p.rotation);
      const pt = (lx: number, ly: number) => ({ x: p.cx + lx*cr - ly*sr, y: p.cy + lx*sr + ly*cr });
      if (p.startAngle !== undefined && p.endAngle !== undefined) {
        return [pt(p.rx*Math.cos(p.startAngle)/1, p.ry*Math.sin(p.startAngle)),
                pt(p.rx*Math.cos(p.endAngle), p.ry*Math.sin(p.endAngle))];
      }
      return [{ x: p.cx + p.rx*cr, y: p.cy + p.rx*sr }]; // major-axis endpoint, mirrors circle's single snap pt
    }
```

**`SelectTool.ts` `hitTest`** — add an `else if` next to `circle || arc` (center anchor):
```typescript
} else if (prim.kind === 'ellipse') {
  candidates.push({ ref: { primitiveId: prim.id, anchor: 'center' }, x: prim.cx, y: prim.cy });
}
```

**`ConstraintTool.ts` `pickAt`** — add an `else if` (center anchor; bodyDist conservative = distance to bounding circle of major radius, acceptable for pick like the spline branch leaving bodyDist):
```typescript
} else if (prim.kind === 'ellipse') {
  endpoints.push({ ref: { primitiveId: prim.id, anchor: 'center' }, x: prim.cx, y: prim.cy });
  bodyDist = Math.abs(Math.hypot(p.x - prim.cx, p.y - prim.cy) - Math.max(prim.rx, prim.ry));
}
```

**`ProfilePickController.ts` `primitivesBbox`** — add a case. For correctness under rotation use the exact rotated-ellipse extent (half-widths `√((rx·cosθ)²+(ry·sinθ)²)` and `√((rx·sinθ)²+(ry·cosθ)²)`):
```typescript
  case 'ellipse': {
    const cr = Math.cos(p.rotation), sr = Math.sin(p.rotation);
    const hx = Math.hypot(p.rx * cr, p.ry * sr);
    const hy = Math.hypot(p.rx * sr, p.ry * cr);
    xmin = Math.min(xmin, p.cx - hx); xmax = Math.max(xmax, p.cx + hx);
    ymin = Math.min(ymin, p.cy - hy); ymax = Math.max(ymax, p.cy + hy);
    touched = true;
    break;
  }
```

**`CommittedSketchRenderer.ts` `buildGeometry`** — add a branch before the spline fallthrough. Tessellate the ellipse to a polyline and reuse the existing line-building style (match how `buildArcLike`/`buildSpline` return a `THREE.Line`):
```typescript
if (p.kind === 'ellipse') {
  const cr = Math.cos(p.rotation), sr = Math.sin(p.rotation);
  const t0 = p.startAngle ?? 0;
  const t1 = p.endAngle ?? Math.PI * 2;
  const segs = 64;
  const verts: number[] = [];
  for (let i = 0; i <= segs; i++) {
    const t = t0 + (t1 - t0) * (i / segs);
    const lx = p.rx * Math.cos(t), ly = p.ry * Math.sin(t);
    verts.push(p.cx + lx*cr - ly*sr, p.cy + lx*sr + ly*cr, SKETCH_Z);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts), 3));
  return new THREE.Line(g, mat);
}
```

**`OffsetTool.ts`** — match the existing **spline stub** (spline returns `[]` from `samplePrimitive` and `0` from `signedDist`). Offsetting an ellipse is out of Phase-3 scope, so make `ellipse` behave like the spline stub so it compiles and never throws. If the if-chains already end in `return []`/`return 0` and ellipse falls through to those, **no edit is required** — verify by reading the function tails; only add an explicit `if (p.kind === 'ellipse') return [];` / `return 0;` if a tsc exhaustiveness error appears.

- [ ] **Step 4: Run the app tests + tsc**

Run: `cd packages/app && npx vitest run snap ProfilePickController CommittedSketchRenderer` → PASS.
Run: `cd packages/app && npx tsc --noEmit` → 0 errors (all switches now cover `ellipse`).

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/sketcher packages/app/src/model/ProfilePickController.ts
git commit -m "feat(dxf): ellipse branch in app sketcher kind-switches (Phase 3 app)"
```

---

## Task 5: Whole-phase gate + cleanup

**Files:** none (verification task).

- [ ] **Step 1: Full monorepo typecheck (direct per package)**

```bash
cd packages/shared && npx tsc --noEmit && cd ../kernel && npx tsc --noEmit && cd ../app && npx tsc --noEmit && cd ../sketcher-worker && npx tsc --noEmit
```
Expected: 0 errors in every package.

- [ ] **Step 2: Full suites**

```bash
cd packages/shared && npx vitest run
cd packages/kernel && npx vitest run
cd packages/kernel && npx vitest run --config vitest.integration.config.ts
cd packages/app && npx vitest run
cd packages/sketcher-worker && npx vitest run
```
Expected: green (allow only the documented pre-existing app flakes — App.spec `frameToModel`; confirm any failure reproduces on a clean tree before blaming it on this work).

- [ ] **Step 3: Lint gate**

Run: `pnpm lint`
Expected: 0.

- [ ] **Step 4: §6 cross-package smoke (real OCCT round-trip)**

Confirm the integration bbox test from Task 2 is the §6 proof for this phase: an imported-style ellipse primitive → real OCCT elliptical edge with correct 2·rx × 2·ry extent (NOT faceted), and a degree-5 spline bakes. (Phase 4 adds the importer + the real-browser DXF→sketch e2e; Phase 3's verifiable deliverable is the kernel geometry + the green type-level plumbing.)

- [ ] **Step 5: Update SDD ledger + commit any test-only fixups**

Append the 5 tasks to `.superpowers/sdd/progress.md`. Commit only if there are uncommitted test/lint fixups:
```bash
git add -A && git commit -m "chore(dxf): Phase 3 gate green — typecheck/tests/lint (manifest v31)"
```

---

## Self-Review

**1. Spec coverage (design spec §4.3):**
- ✅ `types.ts` ellipse variant + widen spline degree → Task 1.
- ✅ OCCT `makeEllipseEdge` via `gp_Elips_2` + `MakeEdge` + dispatch case → Task 2 (verified overloads `_12` full / `_13` arc; verified `gp_Elips_2(ax2, major, minor)` needs major≥minor → swap branch added; spline clamp unchanged, cast fixed).
- ✅ planegcs decompose-to-points → Task 3.
- ✅ `kind` switches — spec listed `SelectTool/snap/ConstraintTool/ProfilePickController/CommittedSketchRenderer/inferFromGeometry/SketchFeature`. **Correction vs spec:** `endpointsOf` lives in `inferFromGeometry.ts` in **`packages/shared`** (Task 1), not app. **Addition vs spec:** `OffsetTool.ts` is an extra kind-switch site the spec missed (Task 4, stub-tolerant like its existing spline stub).
- ✅ Manifest v30→v31 no-op migration → Task 1.

**2. Placeholder scan:** No TBD/TODO/"handle edge cases" — every code step has concrete code. The only deliberately conditional step is OffsetTool Step 3 ("only add explicit return if tsc complains") — justified because the existing spline stub already falls through to `return []`/`return 0`; the executor reads the tails to decide. Flagged, not hidden.

**3. Type consistency:** `makeEllipseEdge(oc, e, frame?)` / `EllipseParams` used identically in Task 2 def and `SketchFeature` call. Ellipse field names `cx,cy,rx,ry,rotation,startAngle?,endAngle?` identical across Tasks 1–4. `CURRENT_FORMAT_VERSION = 31` set once (Task 1). Spline `degree: number` widened in both shared (Task 1) and kernel `SplineParams` (Task 2) — the `SketchFeature` call `makeSplineEdge(oc, p)` passes a shared `degree:number` into a kernel `degree:number` ⇒ consistent.

**Risk callouts for the executor:**
- **OCCT swap-branch arc params (Task 2)** is the single riskiest piece — the `-π/2` offset for `ry>rx` elliptical arcs is asserted only indirectly (full-ellipse + swap bbox tests cover the common cases). If Phase 4/5 surfaces a mis-oriented elliptical *arc*, revisit the param offset with a dedicated quarter-arc-endpoint oracle.
- **`SketchFrame.v`** — `makeArcEdge` used only `u`/`n`. Verify `frame.v` exists (`SketchOps.ts:11-24`) before relying on it in `makeEllipseEdge`; if absent, derive `v = n × u`.
- **Version churn (Task 1 Step 9)** — re-read every `30`-literal hit; do not sweep input fixtures (prior bumps had one straggler).
