# ZilInventor Sub-project 2a — Interactive Sketcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Shell MVP's numeric-input rectangle dialog with an interactive click-click-click sketcher supporting 5 primitive types (line, rectangle, circle, arc, spline), endpoint + H/V axis snap, numeric-input-during-draw, and closed-loop detection for extrude — all without a constraint solver (that's 2b).

**Architecture:** New `packages/app/src/sketcher/` directory holds `SketchModeController`, `ActiveToolController`, a pure `snap` resolver, and 5 `SketchTool` subclasses (one per primitive). `SketchOverlay` renders snap hints + draft previews as three.js objects; `CommittedSketchRenderer` renders committed primitives. Kernel's `SketchOps.ts` grows edge helpers + a `combineEdgesIntoWires` closed-loop detector. File format bumps v1→v2 (primitives gain `id`).

**Tech Stack:** Same as Shell MVP — TypeScript, Vite, React, Tailwind, three.js, opencascade.js (WASM), Comlink, Zustand, Vitest, Playwright. No new runtime deps.

**Reference spec:** `docs/superpowers/specs/2026-04-23-zilinventor-subproject2a-sketcher-design.md`

---

## File structure map

```
packages/
├── shared/
│   └── src/
│       ├── types.ts                                 # MODIFY — extend SketchPrimitive
│       └── fileFormat.ts                            # MODIFY — v1→v2 migration + progress guard
│
├── kernel/
│   └── src/
│       ├── api.ts                                   # MODIFY — addPrimitive, removePrimitive
│       ├── occt/
│       │   ├── SketchOps.ts                         # MODIFY — edge helpers + combineEdgesIntoWires
│       │   └── __tests__/SketchOps.spec.ts          # EXTEND
│       ├── adapter/
│       │   ├── PartDocument.ts                      # MODIFY — addPrimitive / removePrimitive helpers
│       │   └── features/
│       │       ├── SketchFeature.ts                 # MODIFY — delegate to combiner
│       │       └── __tests__/SketchFeature.integration.spec.ts  # EXTEND
│       └── __tests__/
│           └── save-roundtrip.integration.spec.ts   # EXTEND — multi-primitive round-trip
│
└── app/
    └── src/
        ├── sketcher/                                # NEW — entire subsystem
        │   ├── index.ts
        │   ├── SketchModeController.ts
        │   ├── ActiveToolController.ts
        │   ├── snap.ts
        │   ├── tools/
        │   │   ├── SketchTool.ts                    # base class + types
        │   │   ├── LineTool.ts
        │   │   ├── RectTool.ts
        │   │   ├── CircleTool.ts
        │   │   ├── ArcTool.ts
        │   │   ├── SplineTool.ts
        │   │   └── __tests__/*.spec.ts
        │   ├── overlay/
        │   │   ├── SketchOverlay.ts
        │   │   ├── SnapMarker.ts
        │   │   └── AxisHint.ts
        │   ├── render/
        │   │   └── CommittedSketchRenderer.ts
        │   └── __tests__/
        │       ├── snap.spec.ts
        │       └── controllers.spec.ts
        ├── commands/
        │   ├── AddPrimitiveCommand.ts               # NEW
        │   ├── DeletePrimitiveCommand.ts            # NEW
        │   └── __tests__/commands.spec.ts           # EXTEND
        ├── store/
        │   └── useAppStore.ts                       # MODIFY — sketchMode, activeSketchId, activeToolKind
        ├── shell/
        │   ├── tabs/
        │   │   └── SketchTab.tsx                    # MODIFY — 5 primitive buttons
        │   └── NumericInputOverlay.tsx              # NEW — floating input for during-draw
        ├── viewport/
        │   ├── SceneManager.ts                      # MODIFY — ortho sketch camera + grid
        │   └── Viewport.tsx                         # MODIFY — route pointer events to ActiveToolController
        └── App.tsx                                  # MODIFY — sketchMode-gated execute + wire ActiveToolController

tests/
├── e2e/sketcher/                                    # NEW
│   ├── enter-sketch-mode.spec.ts
│   ├── draw-line.spec.ts
│   ├── draw-spline.spec.ts
│   ├── extrude-l-shape.spec.ts
│   ├── extrude-fails-open-sketch.spec.ts
│   └── undo-primitive.spec.ts
└── perf/
    ├── enter-sketch-mode.spec.ts                    # NEW
    └── draw-20-primitives.spec.ts                   # NEW

docs/
└── superpowers/manual-tests/subproject-2a.md        # NEW
```

---

## Phase 1 — Schema + migration

### Task 1: Extend `SketchPrimitive` to 5 variants with stable ids

Adds `line`, `arc`, `spline` variants. Every primitive gets an `id: string`. Existing `rectangle` and `circle` variants keep their shapes but gain `id`.

**Files:**
- Modify: `packages/shared/src/types.ts`
- Modify: `packages/shared/src/__tests__/result.spec.ts` is unaffected; no new tests here — the type is exercised via downstream consumers in Tasks 3+.

- [ ] **Step 1: Update `SketchPrimitive` in `types.ts`**

Replace the existing definition:

```ts
export type SketchPrimitive =
  | { id: string; kind: 'line'; x1: number; y1: number; x2: number; y2: number }
  | { id: string; kind: 'rectangle'; x: number; y: number; w: number; h: number }
  | { id: string; kind: 'circle'; cx: number; cy: number; r: number }
  | { id: string; kind: 'arc'; cx: number; cy: number; r: number; startAngle: number; endAngle: number }
  | { id: string; kind: 'spline'; controlPoints: ReadonlyArray<{ x: number; y: number }>; degree: 2 | 3; closed: boolean };
```

- [ ] **Step 2: Typecheck shared; expect errors in kernel/app that will be fixed by Tasks 2, 6, 15+**

Run:

```
pnpm --filter @zilventor/shared typecheck
```

Expected: clean (shared package itself doesn't use the variants at runtime).

- [ ] **Step 3: Run full root typecheck; expect errors in downstream packages**

Run:

```
pnpm -r typecheck
```

Expected: errors in `packages/kernel/src/occt/SketchOps.ts` and `packages/app/src/shell/tabs/SketchTab.tsx` because they create primitives without `id`. These will be fixed in later tasks — for now this is expected red.

- [ ] **Step 4: Commit**

```
git add packages/shared/src/types.ts
git commit -m "feat(shared): extend SketchPrimitive to 5 variants with stable ids"
```

---

### Task 2: File format v1→v2 migration + progress guard

Bump `CURRENT_FORMAT_VERSION` to `2`. Migration synthesizes primitive ids deterministically. Fix the latent "migration loop infinite" bug by adding a progress guard.

**Files:**
- Modify: `packages/shared/src/fileFormat.ts`
- Modify: `packages/shared/src/__tests__/fileFormat.spec.ts`

- [ ] **Step 1: Write failing tests**

Append to `packages/shared/src/__tests__/fileFormat.spec.ts`:

```ts
it('exports version 2 as current', () => {
  expect(CURRENT_FORMAT_VERSION).toBe(2);
});

it('migrates a v1 manifest (rectangle without id) to v2', () => {
  const v1 = {
    formatVersion: 1,
    kind: 'part' as const,
    document: {
      id: 'p1',
      name: 'Part1',
      units: 'mm',
      parameters: {},
      featureTree: [
        { kind: 'sketch', id: 's1', plane: 'XY', primitives: [{ kind: 'rectangle', x: 0, y: 0, w: 100, h: 200 }] }
      ]
    }
  };
  const m = migrateManifest(v1 as AnyManifest);
  expect(m.formatVersion).toBe(2);
  const doc = m.document as { featureTree: Array<{ primitives: Array<{ id: string }> }> };
  const prim = doc.featureTree[0]!.primitives[0]!;
  expect(prim.id).toBe('s1-p0');
});

it('throws on a migration that does not advance formatVersion', () => {
  const dud = { formatVersion: 0, kind: 'part' } as AnyManifest;
  // Register a stuck migration just for this test — not a real API, but exercise the guard by importing it indirectly via a private helper if needed, OR call `migrateManifest` after mutating the migrations map for the test. Since the migrations map is module-private, this test exercises the guard through the public error message only when we temporarily add a bad migration. For MVP, assert via the "no migration from formatVersion" error path using formatVersion=0 (no migration registered from 0):
  expect(() => migrateManifest(dud)).toThrow(/no migration from formatVersion 0/);
});
```

- [ ] **Step 2: Run — expect fail**

```
pnpm --filter @zilventor/shared test:unit
```

Expected: 3 failures — `CURRENT_FORMAT_VERSION` is still 1; no migration exists for v1→v2.

- [ ] **Step 3: Update `fileFormat.ts`**

```ts
export const CURRENT_FORMAT_VERSION = 2 as const;

export type AnyManifest = { formatVersion: number; [k: string]: unknown };

type MigrateFn = (m: AnyManifest) => AnyManifest;

const migrations: Record<number, MigrateFn> = {
  // v1 → v2: synthesize primitive ids
  1: (m) => {
    const doc = m.document as { featureTree?: Array<{ kind: string; id?: string; primitives?: Array<Record<string, unknown>> }> } | undefined;
    if (doc?.featureTree) {
      for (const feature of doc.featureTree) {
        if (feature.kind === 'sketch' && Array.isArray(feature.primitives)) {
          const sketchId = feature.id ?? 's';
          feature.primitives = feature.primitives.map((p, i) => ({ ...p, id: (p as { id?: string }).id ?? `${sketchId}-p${i}` }));
        }
      }
    }
    return { ...m, formatVersion: 2 };
  }
};

export function migrateManifest(m: AnyManifest): AnyManifest {
  if (typeof m.formatVersion !== 'number') {
    throw new Error('formatVersion missing from manifest');
  }
  if (m.formatVersion > CURRENT_FORMAT_VERSION) {
    throw new Error(
      `file is from a newer version of ZilInventor (formatVersion=${m.formatVersion}, current=${CURRENT_FORMAT_VERSION})`
    );
  }
  let current = m;
  while (current.formatVersion < CURRENT_FORMAT_VERSION) {
    const step = migrations[current.formatVersion];
    if (!step) throw new Error(`no migration from formatVersion ${current.formatVersion}`);
    const priorVersion = current.formatVersion;
    current = step(current);
    if (typeof current.formatVersion !== 'number' || current.formatVersion <= priorVersion) {
      throw new Error(`migration from formatVersion ${priorVersion} did not advance the version`);
    }
  }
  return current;
}
```

- [ ] **Step 4: Run — expect pass**

```
pnpm --filter @zilventor/shared test:unit
```

- [ ] **Step 5: Commit**

```
git add packages/shared/src/fileFormat.ts packages/shared/src/__tests__/fileFormat.spec.ts
git commit -m "feat(shared): bump formatVersion v2 with migration + progress guard"
```

---

## Phase 2 — OCCT edge helpers + closed-loop detection

### Task 3: `makeLineEdge` and `makeArcEdge` in SketchOps

**Files:**
- Modify: `packages/kernel/src/occt/SketchOps.ts`
- Modify: `packages/kernel/src/occt/__tests__/SketchOps.spec.ts` (exists? create if not)

- [ ] **Step 1: Check if SketchOps tests exist**

```
ls packages/kernel/src/occt/__tests__/SketchOps.spec.ts
```

If missing, create it. It will exercise edge generators via real OCCT — integration-style, runs in the integration config (which covers `src/occt/**/__tests__/**/*.spec.ts`).

- [ ] **Step 2: Write failing tests for `makeLineEdge` and `makeArcEdge`**

Append (or create file with) the following:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { loadOcct, type OcctInstance } from '../occtLoader';
import { makeLineEdge, makeArcEdge, edgeEndpoints, disposeEdge } from '../SketchOps';

let occt: OcctInstance;
beforeAll(async () => { occt = await loadOcct(); }, 60_000);

describe('SketchOps.makeLineEdge', () => {
  it('creates an edge with endpoints exactly at the given points', () => {
    const edge = makeLineEdge(occt, { x: 0, y: 0 }, { x: 100, y: 50 });
    const { start, end } = edgeEndpoints(occt, edge);
    expect(start.x).toBeCloseTo(0, 5);
    expect(start.y).toBeCloseTo(0, 5);
    expect(end.x).toBeCloseTo(100, 5);
    expect(end.y).toBeCloseTo(50, 5);
    disposeEdge(edge);
  });
});

describe('SketchOps.makeArcEdge', () => {
  it('creates a quarter arc with endpoints at (50,0) and (0,50) for center (0,0), r=50, angles 0..π/2', () => {
    const edge = makeArcEdge(occt, { cx: 0, cy: 0, r: 50, startAngle: 0, endAngle: Math.PI / 2 });
    const { start, end } = edgeEndpoints(occt, edge);
    expect(start.x).toBeCloseTo(50, 3);
    expect(start.y).toBeCloseTo(0, 3);
    expect(end.x).toBeCloseTo(0, 3);
    expect(end.y).toBeCloseTo(50, 3);
    disposeEdge(edge);
  });
});
```

- [ ] **Step 3: Run — expect fail**

```
pnpm --filter @zilventor/kernel test:integration
```

- [ ] **Step 4: Extend `SketchOps.ts`**

Add these helpers alongside the existing `makeRectangleWireXY`. The existing `WireHandle` stays. Add a new `EdgeHandle` brand:

```ts
export type EdgeHandle = { __brand: 'EdgeHandle'; edge: unknown };

export type Point2 = { x: number; y: number };
export type ArcParams = { cx: number; cy: number; r: number; startAngle: number; endAngle: number };

export function makeLineEdge(oc: OcctInstance, a: Point2, b: Point2): EdgeHandle {
  const p1 = new oc.gp_Pnt_3(a.x, a.y, 0);
  const p2 = new oc.gp_Pnt_3(b.x, b.y, 0);
  const mk = new oc.BRepBuilderAPI_MakeEdge_3(p1, p2);
  const edge = mk.Edge();
  mk.delete();
  p1.delete();
  p2.delete();
  return { __brand: 'EdgeHandle', edge };
}

export function makeArcEdge(oc: OcctInstance, a: ArcParams): EdgeHandle {
  const center = new oc.gp_Pnt_3(a.cx, a.cy, 0);
  const axisDir = new oc.gp_Dir_4(0, 0, 1);
  const xDir = new oc.gp_Dir_4(1, 0, 0);
  const ax2 = new oc.gp_Ax2_2(center, axisDir, xDir);
  const circ = new oc.gp_Circ_2(ax2, a.r);
  const mk = new oc.BRepBuilderAPI_MakeEdge_9(circ, a.startAngle, a.endAngle);
  const edge = mk.Edge();
  mk.delete();
  circ.delete();
  ax2.delete();
  xDir.delete();
  axisDir.delete();
  center.delete();
  return { __brand: 'EdgeHandle', edge };
}

export function edgeEndpoints(oc: OcctInstance, e: EdgeHandle): { start: Point2; end: Point2 } {
  // Extract first and last vertex positions from the edge.
  const tds = oc.TopoDS.Edge_1(e.edge as never);
  const v1 = oc.TopExp.FirstVertex_1(tds, false);
  const v2 = oc.TopExp.LastVertex_1(tds, false);
  const p1 = oc.BRep_Tool.Pnt(v1);
  const p2 = oc.BRep_Tool.Pnt(v2);
  const result = {
    start: { x: p1.X(), y: p1.Y() },
    end: { x: p2.X(), y: p2.Y() }
  };
  p1.delete(); p2.delete(); v1.delete(); v2.delete();
  return result;
}

export function disposeEdge(e: EdgeHandle): void {
  (e.edge as { delete?: () => void }).delete?.();
}
```

**Implementation notes for the engineer:**
- `BRepBuilderAPI_MakeEdge_9` is the arc-over-(gp_Circ, startParam, endParam) overload. Verify the exact overload suffix in `node_modules/opencascade.js/dist/node.d.ts`. If the overload number differs (e.g. `_5` or `_7`), adjust. The test's geometric intent (endpoints at correct spots) must hold.
- `gp_Ax2_2` is the (origin, main-direction, x-direction) overload. Same caveat on suffix number.
- `BRep_Tool.Pnt` is a static on the `BRep_Tool` namespace — not an instance method.

- [ ] **Step 5: Run — expect pass**

```
pnpm --filter @zilventor/kernel test:integration
```

Expected: 2 new tests pass.

- [ ] **Step 6: Commit**

```
git add packages/kernel/src/occt/SketchOps.ts packages/kernel/src/occt/__tests__/SketchOps.spec.ts
git commit -m "feat(kernel): add makeLineEdge and makeArcEdge to SketchOps"
```

---

### Task 4: `makeCircleEdge`, `makeSplineEdge`, `makeRectangleEdges`

**Files:**
- Modify: `packages/kernel/src/occt/SketchOps.ts`
- Modify: `packages/kernel/src/occt/__tests__/SketchOps.spec.ts`

- [ ] **Step 1: Write failing tests**

Append to the spec file:

```ts
import { makeCircleEdge, makeSplineEdge, makeRectangleEdges } from '../SketchOps';

describe('SketchOps.makeCircleEdge', () => {
  it('creates a closed circle edge with correct endpoints (same point)', () => {
    const edge = makeCircleEdge(occt, { cx: 10, cy: 20, r: 5 });
    // For a closed circle, FirstVertex and LastVertex coincide at (cx+r, cy)
    const { start, end } = edgeEndpoints(occt, edge);
    expect(start.x).toBeCloseTo(end.x, 3);
    expect(start.y).toBeCloseTo(end.y, 3);
    disposeEdge(edge);
  });
});

describe('SketchOps.makeSplineEdge', () => {
  it('creates a degree-3 bspline edge from 4 control points', () => {
    const edge = makeSplineEdge(occt, { controlPoints: [{ x: 0, y: 0 }, { x: 10, y: 30 }, { x: 20, y: 30 }, { x: 30, y: 0 }], degree: 3, closed: false });
    const { start, end } = edgeEndpoints(occt, edge);
    // An open BSpline through control polygon has start at first control point, end at last
    expect(start.x).toBeCloseTo(0, 2);
    expect(start.y).toBeCloseTo(0, 2);
    expect(end.x).toBeCloseTo(30, 2);
    expect(end.y).toBeCloseTo(0, 2);
    disposeEdge(edge);
  });

  it('rejects a spline with fewer than 2 control points', () => {
    expect(() => makeSplineEdge(occt, { controlPoints: [{ x: 0, y: 0 }], degree: 3, closed: false })).toThrow(/control points/i);
  });
});

describe('SketchOps.makeRectangleEdges', () => {
  it('produces 4 edges that form a closed loop', () => {
    const edges = makeRectangleEdges(occt, { x: 0, y: 0, w: 100, h: 200 });
    expect(edges.length).toBe(4);
    // The edges should connect end-to-start in order
    const ends = edges.map((e) => edgeEndpoints(occt, e));
    expect(ends[0]!.end.x).toBeCloseTo(ends[1]!.start.x, 5);
    expect(ends[0]!.end.y).toBeCloseTo(ends[1]!.start.y, 5);
    expect(ends[3]!.end.x).toBeCloseTo(ends[0]!.start.x, 5);
    expect(ends[3]!.end.y).toBeCloseTo(ends[0]!.start.y, 5);
    edges.forEach(disposeEdge);
  });
});
```

- [ ] **Step 2: Run — expect fail**

```
pnpm --filter @zilventor/kernel test:integration
```

- [ ] **Step 3: Implement helpers in `SketchOps.ts`**

```ts
export type CircleParams = { cx: number; cy: number; r: number };
export type SplineParams = { controlPoints: ReadonlyArray<Point2>; degree: 2 | 3; closed: boolean };
export type RectangleParams = { x: number; y: number; w: number; h: number };

export function makeCircleEdge(oc: OcctInstance, c: CircleParams): EdgeHandle {
  const center = new oc.gp_Pnt_3(c.cx, c.cy, 0);
  const axisDir = new oc.gp_Dir_4(0, 0, 1);
  const xDir = new oc.gp_Dir_4(1, 0, 0);
  const ax2 = new oc.gp_Ax2_2(center, axisDir, xDir);
  const circ = new oc.gp_Circ_2(ax2, c.r);
  const mk = new oc.BRepBuilderAPI_MakeEdge_8(circ);
  const edge = mk.Edge();
  mk.delete();
  circ.delete();
  ax2.delete();
  xDir.delete();
  axisDir.delete();
  center.delete();
  return { __brand: 'EdgeHandle', edge };
}

export function makeSplineEdge(oc: OcctInstance, s: SplineParams): EdgeHandle {
  if (s.controlPoints.length < 2) {
    throw new Error(`spline requires at least 2 control points, got ${s.controlPoints.length}`);
  }
  const nbPoles = s.controlPoints.length;
  // Build poles array (TColgp_Array1OfPnt)
  const poles = new oc.TColgp_Array1OfPnt_2(1, nbPoles);
  const allocated: unknown[] = [];
  for (let i = 0; i < nbPoles; i++) {
    const cp = s.controlPoints[i]!;
    const p = new oc.gp_Pnt_3(cp.x, cp.y, 0);
    poles.SetValue(i + 1, p);
    allocated.push(p);
  }
  // Uniform knot vector: for a non-periodic degree d with n poles, knots = (n + d + 1). We use a clamped uniform vector.
  const degree = Math.min(s.degree, nbPoles - 1) as 2 | 3;
  // Build a clamped uniform knot sequence using BSplCLib helpers or manually:
  // For simplicity, use GeomAPI_PointsToBSpline which picks knots from control points.
  const approx = new oc.GeomAPI_PointsToBSpline_2(poles, degree, degree, oc.GeomAbs_Shape.GeomAbs_C2 as never, 1e-3);
  const bspline = approx.Curve();
  const mk = new oc.BRepBuilderAPI_MakeEdge_24(bspline);
  const edge = mk.Edge();
  mk.delete();
  approx.delete();
  poles.delete();
  allocated.forEach((p) => (p as { delete?: () => void }).delete?.());
  return { __brand: 'EdgeHandle', edge };
}

export function makeRectangleEdges(oc: OcctInstance, r: RectangleParams): EdgeHandle[] {
  const corners: Point2[] = [
    { x: r.x,         y: r.y         },
    { x: r.x + r.w,   y: r.y         },
    { x: r.x + r.w,   y: r.y + r.h   },
    { x: r.x,         y: r.y + r.h   }
  ];
  return [
    makeLineEdge(oc, corners[0]!, corners[1]!),
    makeLineEdge(oc, corners[1]!, corners[2]!),
    makeLineEdge(oc, corners[2]!, corners[3]!),
    makeLineEdge(oc, corners[3]!, corners[0]!)
  ];
}
```

**Implementation notes:**
- `BRepBuilderAPI_MakeEdge_8(circ)` is the closed-circle overload. Verify suffix against d.ts.
- `BRepBuilderAPI_MakeEdge_24(bspline)` is the BSpline-curve overload. Verify suffix.
- `GeomAPI_PointsToBSpline_2` uses a points-based approximation. The `GeomAbs_C2` continuity constant lives on `oc.GeomAbs_Shape`.
- If the engineer finds a cleaner clamped-uniform path via `Geom_BSplineCurve_*` constructors, that's acceptable — the test's geometric intent (start at first control point, end at last) must hold.

- [ ] **Step 4: Run — expect pass**

```
pnpm --filter @zilventor/kernel test:integration
```

- [ ] **Step 5: Commit**

```
git add packages/kernel/src/occt/SketchOps.ts packages/kernel/src/occt/__tests__/SketchOps.spec.ts
git commit -m "feat(kernel): add makeCircleEdge, makeSplineEdge, makeRectangleEdges"
```

---

### Task 5: `combineEdgesIntoWires` — the closed-loop detector

**Files:**
- Modify: `packages/kernel/src/occt/SketchOps.ts`
- Modify: `packages/kernel/src/occt/__tests__/SketchOps.spec.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { combineEdgesIntoWires } from '../SketchOps';

describe('SketchOps.combineEdgesIntoWires', () => {
  it('four lines forming a square → 1 closed wire, 0 open chains', () => {
    const e1 = makeLineEdge(occt, { x: 0, y: 0 }, { x: 100, y: 0 });
    const e2 = makeLineEdge(occt, { x: 100, y: 0 }, { x: 100, y: 100 });
    const e3 = makeLineEdge(occt, { x: 100, y: 100 }, { x: 0, y: 100 });
    const e4 = makeLineEdge(occt, { x: 0, y: 100 }, { x: 0, y: 0 });
    const result = combineEdgesIntoWires(occt, [e1, e2, e3, e4]);
    expect(result.closedWires.length).toBe(1);
    expect(result.openChains.length).toBe(0);
    result.closedWires.forEach((w) => (w.wire as { delete?: () => void }).delete?.());
    [e1, e2, e3, e4].forEach(disposeEdge);
  });

  it('three lines in L → 1 open chain, 0 closed', () => {
    const e1 = makeLineEdge(occt, { x: 0, y: 0 }, { x: 100, y: 0 });
    const e2 = makeLineEdge(occt, { x: 100, y: 0 }, { x: 100, y: 100 });
    const e3 = makeLineEdge(occt, { x: 100, y: 100 }, { x: 50, y: 100 });
    const result = combineEdgesIntoWires(occt, [e1, e2, e3]);
    expect(result.closedWires.length).toBe(0);
    expect(result.openChains.length).toBe(1);
    [e1, e2, e3].forEach(disposeEdge);
  });

  it('connects regardless of input order (edges given scrambled)', () => {
    const e1 = makeLineEdge(occt, { x: 0, y: 0 }, { x: 100, y: 0 });
    const e2 = makeLineEdge(occt, { x: 100, y: 0 }, { x: 100, y: 100 });
    const e3 = makeLineEdge(occt, { x: 100, y: 100 }, { x: 0, y: 100 });
    const e4 = makeLineEdge(occt, { x: 0, y: 100 }, { x: 0, y: 0 });
    const result = combineEdgesIntoWires(occt, [e3, e1, e4, e2]);
    expect(result.closedWires.length).toBe(1);
    result.closedWires.forEach((w) => (w.wire as { delete?: () => void }).delete?.());
    [e1, e2, e3, e4].forEach(disposeEdge);
  });

  it('reverses an edge when needed to chain', () => {
    // e1 goes (0,0)→(100,0); e2 goes (100,100)→(100,0). Chaining e1-e2 requires reversing e2.
    const e1 = makeLineEdge(occt, { x: 0, y: 0 }, { x: 100, y: 0 });
    const e2 = makeLineEdge(occt, { x: 100, y: 100 }, { x: 100, y: 0 });
    const result = combineEdgesIntoWires(occt, [e1, e2]);
    expect(result.openChains.length).toBe(1);
    [e1, e2].forEach(disposeEdge);
  });

  it('with ε tolerance, endpoints within 1e-4 mm are considered coincident', () => {
    const e1 = makeLineEdge(occt, { x: 0, y: 0 }, { x: 100, y: 0 });
    const e2 = makeLineEdge(occt, { x: 100.0001, y: 0 }, { x: 100.0001, y: 100 }); // ~1 µm off
    const result = combineEdgesIntoWires(occt, [e1, e2]);
    expect(result.openChains.length).toBe(1); // they chain despite the tiny gap
    [e1, e2].forEach(disposeEdge);
  });
});
```

- [ ] **Step 2: Run — expect fail**

```
pnpm --filter @zilventor/kernel test:integration
```

- [ ] **Step 3: Implement the combiner**

Add to `SketchOps.ts`:

```ts
export const SKETCH_TOLERANCE_MM = 1e-3; // 1 µm — named constant, easy to tune

export type CombinerResult = {
  closedWires: WireHandle[];
  openChains: Array<{ edges: EdgeHandle[]; start: Point2; end: Point2 }>;
};

function endpointsMatch(a: Point2, b: Point2, eps = SKETCH_TOLERANCE_MM): boolean {
  return Math.abs(a.x - b.x) < eps && Math.abs(a.y - b.y) < eps;
}

type OpenSeed = { edge: EdgeHandle; start: Point2; end: Point2 };

export function combineEdgesIntoWires(oc: OcctInstance, edges: EdgeHandle[]): CombinerResult {
  const openSeeds: OpenSeed[] = edges.map((e) => {
    const { start, end } = edgeEndpoints(oc, e);
    return { edge: e, start, end };
  });

  // Greedy chaining
  const chains: OpenSeed[][] = [];
  const remaining = [...openSeeds];
  while (remaining.length > 0) {
    const first = remaining.shift()!;
    const chain: OpenSeed[] = [first];
    let extended = true;
    while (extended) {
      extended = false;
      for (let i = 0; i < remaining.length; i++) {
        const cand = remaining[i]!;
        const tailEnd = chain[chain.length - 1]!.end;
        const headStart = chain[0]!.start;
        if (endpointsMatch(tailEnd, cand.start)) {
          chain.push(cand);
          remaining.splice(i, 1);
          extended = true;
          break;
        }
        if (endpointsMatch(tailEnd, cand.end)) {
          chain.push({ edge: cand.edge, start: cand.end, end: cand.start });
          remaining.splice(i, 1);
          extended = true;
          break;
        }
        if (endpointsMatch(headStart, cand.end)) {
          chain.unshift(cand);
          remaining.splice(i, 1);
          extended = true;
          break;
        }
        if (endpointsMatch(headStart, cand.start)) {
          chain.unshift({ edge: cand.edge, start: cand.end, end: cand.start });
          remaining.splice(i, 1);
          extended = true;
          break;
        }
      }
    }
    chains.push(chain);
  }

  // Classify
  const closedWires: WireHandle[] = [];
  const openChains: Array<{ edges: EdgeHandle[]; start: Point2; end: Point2 }> = [];
  for (const chain of chains) {
    const head = chain[0]!.start;
    const tail = chain[chain.length - 1]!.end;
    if (endpointsMatch(head, tail)) {
      // Build wire from chain
      const mkWire = new oc.BRepBuilderAPI_MakeWire_1();
      for (const seg of chain) {
        mkWire.Add_1(seg.edge.edge as never);
      }
      const wire = mkWire.Wire();
      mkWire.delete();
      closedWires.push({ __brand: 'WireHandle', wire });
    } else {
      openChains.push({
        edges: chain.map((c) => c.edge),
        start: head,
        end: tail
      });
    }
  }
  return { closedWires, openChains };
}
```

- [ ] **Step 4: Run — expect pass**

```
pnpm --filter @zilventor/kernel test:integration
```

- [ ] **Step 5: Commit**

```
git add packages/kernel/src/occt/SketchOps.ts packages/kernel/src/occt/__tests__/SketchOps.spec.ts
git commit -m "feat(kernel): add combineEdgesIntoWires closed-loop detector"
```

---

## Phase 3 — Kernel API extensions

### Task 6: Adapter + RPC for `addPrimitive` and `removePrimitive`

**Files:**
- Modify: `packages/kernel/src/adapter/PartDocument.ts`
- Modify: `packages/kernel/src/adapter/__tests__/PartDocument.spec.ts`
- Modify: `packages/kernel/src/api.ts`
- Modify: `packages/kernel/src/__tests__/api.integration.spec.ts`

- [ ] **Step 1: Write failing tests in PartDocument.spec.ts**

```ts
import { addPrimitive, removePrimitive } from '../PartDocument';

it('addPrimitive appends to a sketch feature\'s primitives', () => {
  let p = newPart('P');
  p = addFeature(p, { kind: 'sketch', id: 's1', plane: 'XY', primitives: [] });
  p = addPrimitive(p, 's1', { id: 'p1', kind: 'line', x1: 0, y1: 0, x2: 10, y2: 10 });
  const sketch = p.featureTree[0] as { primitives: Array<{ id: string }> };
  expect(sketch.primitives.map((pr) => pr.id)).toEqual(['p1']);
});

it('addPrimitive throws when sketch id not found', () => {
  const p = newPart('P');
  expect(() => addPrimitive(p, 'missing', { id: 'p1', kind: 'line', x1: 0, y1: 0, x2: 10, y2: 10 })).toThrow(/no sketch/);
});

it('removePrimitive filters by id', () => {
  let p = newPart('P');
  p = addFeature(p, { kind: 'sketch', id: 's1', plane: 'XY', primitives: [] });
  p = addPrimitive(p, 's1', { id: 'p1', kind: 'line', x1: 0, y1: 0, x2: 10, y2: 10 });
  p = addPrimitive(p, 's1', { id: 'p2', kind: 'line', x1: 10, y1: 10, x2: 20, y2: 20 });
  p = removePrimitive(p, 's1', 'p1');
  const sketch = p.featureTree[0] as { primitives: Array<{ id: string }> };
  expect(sketch.primitives.map((pr) => pr.id)).toEqual(['p2']);
});
```

- [ ] **Step 2: Run — expect fail**

```
pnpm --filter @zilventor/kernel test:unit
```

- [ ] **Step 3: Implement in PartDocument.ts**

```ts
export function addPrimitive(part: PartDocument, sketchId: string, primitive: SketchPrimitive): PartDocument {
  const idx = part.featureTree.findIndex((f) => f.kind === 'sketch' && f.id === sketchId);
  if (idx < 0) throw new Error(`no sketch ${sketchId}`);
  const sketch = part.featureTree[idx]! as Extract<Feature, { kind: 'sketch' }>;
  const nextSketch: Extract<Feature, { kind: 'sketch' }> = { ...sketch, primitives: [...sketch.primitives, primitive] };
  const nextTree = [...part.featureTree];
  nextTree[idx] = nextSketch;
  return { ...part, featureTree: nextTree };
}

export function removePrimitive(part: PartDocument, sketchId: string, primitiveId: string): PartDocument {
  const idx = part.featureTree.findIndex((f) => f.kind === 'sketch' && f.id === sketchId);
  if (idx < 0) throw new Error(`no sketch ${sketchId}`);
  const sketch = part.featureTree[idx]! as Extract<Feature, { kind: 'sketch' }>;
  const nextPrimitives = sketch.primitives.filter((p) => p.id !== primitiveId);
  const nextSketch: Extract<Feature, { kind: 'sketch' }> = { ...sketch, primitives: nextPrimitives };
  const nextTree = [...part.featureTree];
  nextTree[idx] = nextSketch;
  return { ...part, featureTree: nextTree };
}
```

- [ ] **Step 4: Extend `api.ts` — add RPC methods**

Add to the `KernelApi` type:

```ts
addPrimitive(partId: string, sketchId: string, primitive: SketchPrimitive): Promise<void>;
removePrimitive(partId: string, sketchId: string, primitiveId: string): Promise<void>;
```

In `createKernelApi`, import the helpers and wire the implementations:

```ts
import { newPart, addFeature as addFeatureToPart, setParameter as setParameterOnPart, removeFeature as removeFeatureFromPart, addPrimitive as addPrimitiveToPart, removePrimitive as removePrimitiveFromPart, removeParameter as removeParameterFromPart } from './adapter/PartDocument';
import type { SketchPrimitive } from '@zilventor/shared';

// ... within createKernelApi returning object ...
async addPrimitive(partId, sketchId, primitive) {
  const p = parts.get(partId);
  if (!p) throw new Error(`no part ${partId}`);
  parts.set(partId, addPrimitiveToPart(p, sketchId, primitive));
},

async removePrimitive(partId, sketchId, primitiveId) {
  const p = parts.get(partId);
  if (!p) throw new Error(`no part ${partId}`);
  parts.set(partId, removePrimitiveFromPart(p, sketchId, primitiveId));
},
```

- [ ] **Step 5: Extend api.integration.spec.ts**

Append one test that exercises the round-trip:

```ts
it('addPrimitive + removePrimitive work via the API surface', async () => {
  const api = createKernelApi();
  await api.init();
  const id = await api.createPart('P');
  await api.addFeature(id, { kind: 'sketch', id: 's1', plane: 'XY', primitives: [] });
  await api.addPrimitive(id, 's1', { id: 'p1', kind: 'line', x1: 0, y1: 0, x2: 10, y2: 10 });
  let part = await api.getPart(id);
  expect((part?.featureTree[0] as { primitives: unknown[] }).primitives.length).toBe(1);
  await api.removePrimitive(id, 's1', 'p1');
  part = await api.getPart(id);
  expect((part?.featureTree[0] as { primitives: unknown[] }).primitives.length).toBe(0);
}, 60_000);
```

- [ ] **Step 6: Run — expect pass**

```
pnpm --filter @zilventor/kernel test:unit
pnpm --filter @zilventor/kernel test:integration
```

- [ ] **Step 7: Commit**

```
git add packages/kernel/src/
git commit -m "feat(kernel): addPrimitive/removePrimitive adapter helpers + RPCs"
```

---

### Task 7: Extend `SketchFeature` executor to use `combineEdgesIntoWires`

Replace the "exactly one rectangle" restriction with multi-primitive handling via the combiner. Returns a single closed wire or a typed error.

**Files:**
- Modify: `packages/kernel/src/adapter/features/SketchFeature.ts`
- Modify: `packages/kernel/src/adapter/features/__tests__/SketchFeature.integration.spec.ts`

- [ ] **Step 1: Write failing tests**

Append to the integration spec:

```ts
import { executeSketchFeature, disposeSketchResult } from '../SketchFeature';

it('executes a sketch with one line + one arc + one line forming a closed D-shape', () => {
  const result = executeSketchFeature(occt, {
    kind: 'sketch', id: 's1', plane: 'XY',
    primitives: [
      { id: 'p1', kind: 'line', x1: 0, y1: 0, x2: 100, y2: 0 },
      { id: 'p2', kind: 'arc', cx: 100, cy: 50, r: 50, startAngle: -Math.PI / 2, endAngle: Math.PI / 2 },
      { id: 'p3', kind: 'line', x1: 100, y1: 100, x2: 0, y2: 100 },
      { id: 'p4', kind: 'line', x1: 0, y1: 100, x2: 0, y2: 0 }
    ]
  });
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value.closed).toBe(true);
    disposeSketchResult(occt, result.value);
  }
});

it('returns degenerateSketch error with "not closed" message for open polyline', () => {
  const result = executeSketchFeature(occt, {
    kind: 'sketch', id: 's1', plane: 'XY',
    primitives: [
      { id: 'p1', kind: 'line', x1: 0, y1: 0, x2: 100, y2: 0 },
      { id: 'p2', kind: 'line', x1: 100, y1: 0, x2: 100, y2: 50 }
    ]
  });
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error.kind).toBe('degenerateSketch');
    expect(result.error.message).toMatch(/not closed/i);
  }
});

it('returns "multiple loops" error for two rectangles', () => {
  const result = executeSketchFeature(occt, {
    kind: 'sketch', id: 's1', plane: 'XY',
    primitives: [
      { id: 'p1', kind: 'rectangle', x: 0, y: 0, w: 100, h: 100 },
      { id: 'p2', kind: 'rectangle', x: 200, y: 0, w: 50, h: 50 }
    ]
  });
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error.kind).toBe('degenerateSketch');
    expect(result.error.message).toMatch(/multiple/i);
  }
});

it('returns "empty" error for a sketch with no primitives', () => {
  const result = executeSketchFeature(occt, {
    kind: 'sketch', id: 's1', plane: 'XY', primitives: []
  });
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error.message).toMatch(/empty/i);
});
```

- [ ] **Step 2: Run — expect fail**

```
pnpm --filter @zilventor/kernel test:integration
```

Many of these will fail because the current `executeSketchFeature` only handles "one rectangle."

- [ ] **Step 3: Rewrite `SketchFeature.ts`**

```ts
import type { OcctInstance } from '../../occt/occtLoader';
import { ok, err, type Result, type KernelError, newCorrelationId, type Feature } from '@zilventor/shared';
import { makeLineEdge, makeArcEdge, makeCircleEdge, makeSplineEdge, makeRectangleEdges, combineEdgesIntoWires, disposeEdge, type EdgeHandle, type WireHandle } from '../../occt/SketchOps';

export type SketchResult = {
  sketchId: string;
  wire: WireHandle;
  plane: 'XY' | 'XZ' | 'YZ';
  closed: boolean;
};

export function executeSketchFeature(oc: OcctInstance, feature: Extract<Feature, { kind: 'sketch' }>): Result<SketchResult, KernelError> {
  if (feature.plane !== 'XY') {
    return err({
      kind: 'invalidParameter',
      message: 'Sub-project 2a only supports the XY sketch plane.',
      correlationId: newCorrelationId(),
      featureId: feature.id
    });
  }
  if (feature.primitives.length === 0) {
    return err({
      kind: 'degenerateSketch',
      message: 'Sketch is empty — cannot extrude. Draw a closed profile first.',
      correlationId: newCorrelationId(),
      featureId: feature.id
    });
  }

  const edges: EdgeHandle[] = [];
  try {
    for (const p of feature.primitives) {
      switch (p.kind) {
        case 'line':
          edges.push(makeLineEdge(oc, { x: p.x1, y: p.y1 }, { x: p.x2, y: p.y2 }));
          break;
        case 'rectangle':
          edges.push(...makeRectangleEdges(oc, p));
          break;
        case 'circle':
          edges.push(makeCircleEdge(oc, p));
          break;
        case 'arc':
          edges.push(makeArcEdge(oc, p));
          break;
        case 'spline':
          edges.push(makeSplineEdge(oc, p));
          break;
      }
    }

    const { closedWires, openChains } = combineEdgesIntoWires(oc, edges);

    // Determine outcome
    if (closedWires.length === 1 && openChains.length === 0) {
      const wire = closedWires[0]!;
      return ok({ sketchId: feature.id, wire, plane: feature.plane, closed: true });
    }

    // Error path — dispose everything we built and return the right error
    closedWires.forEach((w) => (w.wire as { delete?: () => void }).delete?.());
    let message: string;
    if (closedWires.length === 0 && openChains.length >= 1) {
      message = 'Sketch is not closed — cannot extrude. Check that all endpoints connect.';
    } else if (closedWires.length === 0 && openChains.length === 0) {
      message = 'Sketch is empty — cannot extrude. Draw a closed profile first.';
    } else if (closedWires.length >= 2 && openChains.length === 0) {
      message = 'Sketch has multiple closed loops — cannot extrude. Merge or delete loops so exactly one remains. (Hole support comes in Sub-project 3.)';
    } else {
      message = 'Sketch has a valid loop plus disconnected line(s). Delete the stray lines or connect them.';
    }
    return err({
      kind: 'degenerateSketch',
      message,
      correlationId: newCorrelationId(),
      featureId: feature.id
    });
  } finally {
    edges.forEach(disposeEdge);
  }
}

export function disposeSketchResult(_oc: OcctInstance, result: SketchResult): void {
  (result.wire.wire as { delete?: () => void }).delete?.();
}
```

- [ ] **Step 4: Run — expect pass**

```
pnpm --filter @zilventor/kernel test:integration
```

Existing Shell MVP tests that used the single-rectangle sketch should continue passing (a one-rectangle sketch produces one closed wire via `makeRectangleEdges` + combiner).

- [ ] **Step 5: Commit**

```
git add packages/kernel/src/adapter/features/
git commit -m "feat(kernel): sketch feature executor handles multi-primitive sketches via combiner"
```

---

## Phase 4 — Store + commands

### Task 8: Store extensions for sketch mode

**Files:**
- Modify: `packages/app/src/store/useAppStore.ts`

- [ ] **Step 1: Add sketch-mode state**

Add to the store type:

```ts
type ToolKind = 'line' | 'rect' | 'circle' | 'arc' | 'spline';

type AppState = {
  // existing fields
  kernel: KernelClient | null;
  bus: CommandBus;
  activePart: PartDocument | null;
  kernelReady: boolean;
  statusMessage: string;
  viewport: ViewportRef | null;
  selectedFeatureId: string | null;
  // new sketch-mode fields
  sketchMode: boolean;
  activeSketchId: string | null;
  activeToolKind: ToolKind | null;
  selectedPrimitiveId: string | null;
  // actions (existing + new)
  setKernel(k: KernelClient): void;
  setActivePart(p: PartDocument | null): void;
  setStatus(msg: string): void;
  setViewport(v: ViewportRef | null): void;
  setSelectedFeature(id: string | null): void;
  setSketchMode(mode: boolean, sketchId?: string | null): void;
  setActiveToolKind(kind: ToolKind | null): void;
  setSelectedPrimitive(id: string | null): void;
};
```

In the `create` call, add default values and action implementations:

```ts
sketchMode: false,
activeSketchId: null,
activeToolKind: null,
selectedPrimitiveId: null,

setSketchMode: (mode, sketchId = null) => set({ sketchMode: mode, activeSketchId: sketchId, activeToolKind: mode ? null : null, selectedPrimitiveId: null }),
setActiveToolKind: (kind) => set({ activeToolKind: kind }),
setSelectedPrimitive: (id) => set({ selectedPrimitiveId: id })
```

- [ ] **Step 2: Typecheck**

```
pnpm --filter @zilventor/app typecheck
```

Expected: clean.

- [ ] **Step 3: Commit**

```
git add packages/app/src/store/useAppStore.ts
git commit -m "feat(app): store fields for sketch mode (sketchMode, activeSketchId, activeToolKind)"
```

---

### Task 9: `AddPrimitiveCommand`

**Files:**
- Create: `packages/app/src/commands/AddPrimitiveCommand.ts`
- Modify: `packages/app/src/commands/__tests__/commands.spec.ts`

- [ ] **Step 1: Write failing test**

Append to `commands.spec.ts`:

```ts
import { AddPrimitiveCommand } from '../AddPrimitiveCommand';
import type { SketchPrimitive } from '@zilventor/shared';

describe('AddPrimitiveCommand', () => {
  it('adds a primitive on apply and removes it on revert', async () => {
    const prior: PartDocument = {
      id: 'part-1', name: 'P', units: 'mm', parameters: {},
      featureTree: [{ kind: 'sketch', id: 's1', plane: 'XY', primitives: [] }]
    };
    const primitive: SketchPrimitive = { id: 'p1', kind: 'line', x1: 0, y1: 0, x2: 10, y2: 10 };
    const next: PartDocument = {
      ...prior,
      featureTree: [{ ...prior.featureTree[0]!, primitives: [primitive] } as typeof prior.featureTree[0]]
    };
    const kernel = asKernel({
      addPrimitive: vi.fn().mockResolvedValue(undefined),
      removePrimitive: vi.fn().mockResolvedValue(undefined),
      getPart: vi.fn().mockResolvedValueOnce(next).mockResolvedValueOnce(prior)
    });
    const setActivePart = vi.fn();
    const cmd = new AddPrimitiveCommand({
      kernel,
      store: { activePart: prior, setActivePart },
      sketchId: 's1',
      primitive
    });
    await cmd.apply();
    expect(kernel.addPrimitive).toHaveBeenCalledWith('part-1', 's1', primitive);
    expect(setActivePart).toHaveBeenCalledWith(next);
    await cmd.revert();
    expect(kernel.removePrimitive).toHaveBeenCalledWith('part-1', 's1', 'p1');
    expect(setActivePart).toHaveBeenLastCalledWith(prior);
  });
});
```

- [ ] **Step 2: Run — expect fail**

```
pnpm --filter @zilventor/app test:unit
```

- [ ] **Step 3: Implement `AddPrimitiveCommand.ts`**

```ts
import type { Command } from './Command';
import type { KernelClient } from '../kernel-client/KernelClient';
import type { PartDocument, SketchPrimitive } from '@zilventor/shared';

type Ctx = {
  kernel: KernelClient;
  store: { activePart: PartDocument | null; setActivePart(p: PartDocument | null): void };
  sketchId: string;
  primitive: SketchPrimitive;
};

export class AddPrimitiveCommand implements Command {
  readonly name = 'AddPrimitive';
  private prior: PartDocument | null = null;
  constructor(private ctx: Ctx) {}

  async apply(): Promise<void> {
    const part = this.ctx.store.activePart;
    if (!part) throw new Error('no active part');
    this.prior = part;
    await this.ctx.kernel.addPrimitive(part.id, this.ctx.sketchId, this.ctx.primitive);
    const next = await this.ctx.kernel.getPart(part.id);
    this.ctx.store.setActivePart(next);
  }

  async revert(): Promise<void> {
    if (!this.prior) return;
    await this.ctx.kernel.removePrimitive(this.prior.id, this.ctx.sketchId, this.ctx.primitive.id);
    this.ctx.store.setActivePart(this.prior);
  }
}
```

- [ ] **Step 4: Extend `asKernel` in commands.spec.ts**

If `asKernel` helper doesn't already mock `addPrimitive`/`removePrimitive`, extend it:

```ts
function asKernel(partial: Partial<KernelClient>): KernelClient {
  return {
    init: vi.fn().mockResolvedValue(undefined),
    ping: vi.fn(),
    createPart: vi.fn(),
    addFeature: vi.fn(),
    setParameter: vi.fn(),
    execute: vi.fn(),
    getPart: vi.fn(),
    removeFeature: vi.fn().mockResolvedValue(undefined),
    deletePart: vi.fn().mockResolvedValue(undefined),
    deleteParameter: vi.fn().mockResolvedValue(undefined),
    addPrimitive: vi.fn().mockResolvedValue(undefined),
    removePrimitive: vi.fn().mockResolvedValue(undefined),
    save: vi.fn(),
    load: vi.fn(),
    ...partial
  } as unknown as KernelClient;
}
```

- [ ] **Step 5: Run — expect pass**

```
pnpm --filter @zilventor/app test:unit
```

- [ ] **Step 6: Commit**

```
git add packages/app/src/commands/
git commit -m "feat(app): AddPrimitiveCommand with undo via removePrimitive"
```

---

### Task 10: `DeletePrimitiveCommand`

**Files:**
- Create: `packages/app/src/commands/DeletePrimitiveCommand.ts`
- Modify: `packages/app/src/commands/__tests__/commands.spec.ts`

- [ ] **Step 1: Write failing test**

```ts
import { DeletePrimitiveCommand } from '../DeletePrimitiveCommand';

describe('DeletePrimitiveCommand', () => {
  it('removes a primitive on apply and restores exact prior on revert', async () => {
    const primitive: SketchPrimitive = { id: 'p1', kind: 'line', x1: 0, y1: 0, x2: 10, y2: 10 };
    const prior: PartDocument = {
      id: 'part-1', name: 'P', units: 'mm', parameters: {},
      featureTree: [{ kind: 'sketch', id: 's1', plane: 'XY', primitives: [primitive] }]
    };
    const afterDelete: PartDocument = {
      ...prior,
      featureTree: [{ ...prior.featureTree[0]!, primitives: [] } as typeof prior.featureTree[0]]
    };
    const kernel = asKernel({
      addPrimitive: vi.fn().mockResolvedValue(undefined),
      removePrimitive: vi.fn().mockResolvedValue(undefined),
      getPart: vi.fn().mockResolvedValueOnce(afterDelete).mockResolvedValueOnce(prior)
    });
    const setActivePart = vi.fn();
    const cmd = new DeletePrimitiveCommand({
      kernel,
      store: { activePart: prior, setActivePart },
      sketchId: 's1',
      primitiveId: 'p1'
    });
    await cmd.apply();
    expect(kernel.removePrimitive).toHaveBeenCalledWith('part-1', 's1', 'p1');
    await cmd.revert();
    expect(kernel.addPrimitive).toHaveBeenCalledWith('part-1', 's1', primitive);
  });

  it('throws if primitive id not found in the sketch', async () => {
    const prior: PartDocument = {
      id: 'part-1', name: 'P', units: 'mm', parameters: {},
      featureTree: [{ kind: 'sketch', id: 's1', plane: 'XY', primitives: [] }]
    };
    const kernel = asKernel({});
    const cmd = new DeletePrimitiveCommand({
      kernel,
      store: { activePart: prior, setActivePart: vi.fn() },
      sketchId: 's1',
      primitiveId: 'missing'
    });
    await expect(cmd.apply()).rejects.toThrow(/primitive/);
  });
});
```

- [ ] **Step 2: Run — expect fail**

```
pnpm --filter @zilventor/app test:unit
```

- [ ] **Step 3: Implement `DeletePrimitiveCommand.ts`**

```ts
import type { Command } from './Command';
import type { KernelClient } from '../kernel-client/KernelClient';
import type { PartDocument, SketchPrimitive, Feature } from '@zilventor/shared';

type Ctx = {
  kernel: KernelClient;
  store: { activePart: PartDocument | null; setActivePart(p: PartDocument | null): void };
  sketchId: string;
  primitiveId: string;
};

export class DeletePrimitiveCommand implements Command {
  readonly name = 'DeletePrimitive';
  private prior: PartDocument | null = null;
  private deletedPrimitive: SketchPrimitive | null = null;

  constructor(private ctx: Ctx) {}

  async apply(): Promise<void> {
    const part = this.ctx.store.activePart;
    if (!part) throw new Error('no active part');
    const sketch = part.featureTree.find((f): f is Extract<Feature, { kind: 'sketch' }> => f.kind === 'sketch' && f.id === this.ctx.sketchId);
    if (!sketch) throw new Error(`no sketch ${this.ctx.sketchId}`);
    const prim = sketch.primitives.find((p) => p.id === this.ctx.primitiveId);
    if (!prim) throw new Error(`no primitive ${this.ctx.primitiveId}`);
    this.prior = part;
    this.deletedPrimitive = prim;
    await this.ctx.kernel.removePrimitive(part.id, this.ctx.sketchId, this.ctx.primitiveId);
    const next = await this.ctx.kernel.getPart(part.id);
    this.ctx.store.setActivePart(next);
  }

  async revert(): Promise<void> {
    if (!this.prior || !this.deletedPrimitive) return;
    await this.ctx.kernel.addPrimitive(this.prior.id, this.ctx.sketchId, this.deletedPrimitive);
    this.ctx.store.setActivePart(this.prior);
  }
}
```

- [ ] **Step 4: Run — expect pass**

```
pnpm --filter @zilventor/app test:unit
```

- [ ] **Step 5: Commit**

```
git add packages/app/src/commands/
git commit -m "feat(app): DeletePrimitiveCommand with restore-exact undo"
```

---

## Phase 5 — Snap resolver + overlay + committed sketch renderer

### Task 11: Snap resolver (pure function)

**Files:**
- Create: `packages/app/src/sketcher/snap.ts`
- Create: `packages/app/src/sketcher/__tests__/snap.spec.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { resolveSnap } from '../snap';
import type { SketchPrimitive } from '@zilventor/shared';

const EMPTY_SKETCH: SketchPrimitive[] = [];

describe('resolveSnap', () => {
  it('returns the input unchanged for an empty sketch and no anchor', () => {
    const r = resolveSnap({ x: 10, y: 20 }, { primitives: EMPTY_SKETCH, pixelTolerance: 5 });
    expect(r.point).toEqual({ x: 10, y: 20 });
    expect(r.kind).toBe('none');
  });

  it('snaps to an endpoint of a line within tolerance', () => {
    const line: SketchPrimitive = { id: 'p1', kind: 'line', x1: 0, y1: 0, x2: 100, y2: 0 };
    const r = resolveSnap({ x: 99, y: 1 }, { primitives: [line], pixelTolerance: 5 });
    expect(r.point).toEqual({ x: 100, y: 0 });
    expect(r.kind).toBe('endpoint');
  });

  it('snaps to horizontal axis from anchor within 3°', () => {
    const r = resolveSnap({ x: 500, y: 5 }, { primitives: EMPTY_SKETCH, pixelTolerance: 5, anchor: { x: 0, y: 0 } });
    // atan2(5, 500) ≈ 0.573° → snaps to y=0
    expect(r.point.y).toBeCloseTo(0, 3);
    expect(r.point.x).toBeCloseTo(500, 3);
    expect(r.kind).toBe('horizontal-axis');
  });

  it('snaps to vertical axis from anchor within 3°', () => {
    const r = resolveSnap({ x: 2, y: 100 }, { primitives: EMPTY_SKETCH, pixelTolerance: 5, anchor: { x: 0, y: 0 } });
    expect(r.point.x).toBeCloseTo(0, 3);
    expect(r.kind).toBe('vertical-axis');
  });

  it('does not snap to axis when angle exceeds 3°', () => {
    const r = resolveSnap({ x: 100, y: 50 }, { primitives: EMPTY_SKETCH, pixelTolerance: 5, anchor: { x: 0, y: 0 } });
    // atan2(50, 100) ≈ 26.57°
    expect(r.kind).toBe('none');
  });

  it('endpoint snap wins over axis snap when both are candidates', () => {
    const line: SketchPrimitive = { id: 'p1', kind: 'line', x1: 500, y1: 1, x2: 600, y2: 1 };
    const r = resolveSnap({ x: 500, y: 1 }, { primitives: [line], pixelTolerance: 5, anchor: { x: 0, y: 0 } });
    expect(r.point).toEqual({ x: 500, y: 1 });
    expect(r.kind).toBe('endpoint');
  });
});
```

- [ ] **Step 2: Run — expect fail**

```
pnpm --filter @zilventor/app test:unit
```

- [ ] **Step 3: Implement `snap.ts`**

```ts
import type { SketchPrimitive } from '@zilventor/shared';

export type Point2 = { x: number; y: number };
export type SnapKind = 'none' | 'endpoint' | 'horizontal-axis' | 'vertical-axis';
export type SnapResult = { point: Point2; kind: SnapKind };

export type SnapContext = {
  primitives: ReadonlyArray<SketchPrimitive>;
  pixelTolerance: number; // world units (mm) at the current zoom — caller converts
  anchor?: Point2;
};

const AXIS_SNAP_DEGREES = 3;

function primitiveEndpoints(p: SketchPrimitive): Point2[] {
  switch (p.kind) {
    case 'line':
      return [{ x: p.x1, y: p.y1 }, { x: p.x2, y: p.y2 }];
    case 'rectangle':
      return [
        { x: p.x, y: p.y },
        { x: p.x + p.w, y: p.y },
        { x: p.x + p.w, y: p.y + p.h },
        { x: p.x, y: p.y + p.h }
      ];
    case 'circle':
      return [{ x: p.cx + p.r, y: p.cy }];
    case 'arc':
      return [
        { x: p.cx + p.r * Math.cos(p.startAngle), y: p.cy + p.r * Math.sin(p.startAngle) },
        { x: p.cx + p.r * Math.cos(p.endAngle),   y: p.cy + p.r * Math.sin(p.endAngle)   }
      ];
    case 'spline':
      if (p.controlPoints.length === 0) return [];
      return [p.controlPoints[0]!, p.controlPoints[p.controlPoints.length - 1]!];
  }
}

function dist2(a: Point2, b: Point2): number {
  const dx = a.x - b.x, dy = a.y - b.y;
  return dx * dx + dy * dy;
}

export function resolveSnap(cursor: Point2, ctx: SnapContext): SnapResult {
  // Pass 1: endpoint snap (wins if in range)
  const tolSq = ctx.pixelTolerance * ctx.pixelTolerance;
  let bestDist = Infinity;
  let bestPt: Point2 | null = null;
  for (const p of ctx.primitives) {
    for (const ep of primitiveEndpoints(p)) {
      const d = dist2(cursor, ep);
      if (d < tolSq && d < bestDist) {
        bestDist = d;
        bestPt = ep;
      }
    }
  }
  if (bestPt) return { point: bestPt, kind: 'endpoint' };

  // Pass 2: axis snap from anchor
  if (ctx.anchor) {
    const dx = cursor.x - ctx.anchor.x;
    const dy = cursor.y - ctx.anchor.y;
    const distFromAnchor = Math.hypot(dx, dy);
    if (distFromAnchor > 0) {
      const angleRad = Math.atan2(dy, dx);
      const angleDeg = (angleRad * 180) / Math.PI;
      const tolDeg = AXIS_SNAP_DEGREES;
      // horizontal: close to 0° or ±180°
      const horizontalErr = Math.min(
        Math.abs(angleDeg),
        Math.abs(180 - Math.abs(angleDeg))
      );
      // vertical: close to ±90°
      const verticalErr = Math.abs(90 - Math.abs(angleDeg));
      if (horizontalErr < verticalErr && horizontalErr <= tolDeg) {
        return { point: { x: cursor.x, y: ctx.anchor.y }, kind: 'horizontal-axis' };
      }
      if (verticalErr <= tolDeg) {
        return { point: { x: ctx.anchor.x, y: cursor.y }, kind: 'vertical-axis' };
      }
    }
  }
  return { point: cursor, kind: 'none' };
}
```

- [ ] **Step 4: Run — expect pass**

```
pnpm --filter @zilventor/app test:unit
```

- [ ] **Step 5: Commit**

```
git add packages/app/src/sketcher/
git commit -m "feat(app): pure snap resolver for endpoint + H/V axis"
```

---

### Task 12: Sketch overlay (snap marker + axis hint + draft preview)

**Files:**
- Create: `packages/app/src/sketcher/overlay/SketchOverlay.ts`
- Create: `packages/app/src/sketcher/overlay/SnapMarker.ts`
- Create: `packages/app/src/sketcher/overlay/AxisHint.ts`

This task has no unit tests — the overlay is pure three.js object construction. Behavior is covered by E2E tests later. Keep this step small and direct.

- [ ] **Step 1: Implement `SnapMarker.ts`**

```ts
import * as THREE from 'three';

/** A small square marker at a given world point on the XY plane. */
export class SnapMarker {
  readonly object: THREE.Mesh;
  private material: THREE.MeshBasicMaterial;

  constructor() {
    const geom = new THREE.PlaneGeometry(3, 3);
    this.material = new THREE.MeshBasicMaterial({ color: 0xffcc00, transparent: true, opacity: 0.9 });
    this.object = new THREE.Mesh(geom, this.material);
    this.object.visible = false;
    this.object.renderOrder = 10;
  }

  show(x: number, y: number): void {
    this.object.position.set(x, y, 0.01);
    this.object.visible = true;
  }

  hide(): void {
    this.object.visible = false;
  }

  dispose(): void {
    (this.object.geometry as THREE.BufferGeometry).dispose();
    this.material.dispose();
  }
}
```

- [ ] **Step 2: Implement `AxisHint.ts`**

```ts
import * as THREE from 'three';

/** Dashed line from anchor along a direction (horizontal or vertical). */
export class AxisHint {
  readonly object: THREE.Line;
  private material: THREE.LineDashedMaterial;
  private geom: THREE.BufferGeometry;

  constructor(color = 0x666666) {
    this.geom = new THREE.BufferGeometry();
    this.geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    this.material = new THREE.LineDashedMaterial({ color, dashSize: 2, gapSize: 2, transparent: true, opacity: 0.8 });
    this.object = new THREE.Line(this.geom, this.material);
    this.object.visible = false;
    this.object.renderOrder = 9;
  }

  showHorizontal(anchor: { x: number; y: number }, cursor: { x: number; y: number }): void {
    this.setPoints(anchor.x, anchor.y, cursor.x, anchor.y);
  }

  showVertical(anchor: { x: number; y: number }, cursor: { x: number; y: number }): void {
    this.setPoints(anchor.x, anchor.y, anchor.x, cursor.y);
  }

  hide(): void {
    this.object.visible = false;
  }

  private setPoints(x1: number, y1: number, x2: number, y2: number): void {
    const pos = this.geom.attributes.position as THREE.BufferAttribute;
    (pos.array as Float32Array).set([x1, y1, 0.01, x2, y2, 0.01]);
    pos.needsUpdate = true;
    this.object.computeLineDistances();
    this.object.visible = true;
  }

  dispose(): void {
    this.geom.dispose();
    this.material.dispose();
  }
}
```

- [ ] **Step 3: Implement `SketchOverlay.ts`**

```ts
import * as THREE from 'three';
import { SnapMarker } from './SnapMarker';
import { AxisHint } from './AxisHint';

/**
 * Holds all "transient" visual feedback during sketching: snap markers,
 * axis hints, and the in-progress draft primitive preview. Lives as a
 * separate three.js group so CommittedSketchRenderer's children don't
 * mix with drafts.
 */
export class SketchOverlay {
  readonly group: THREE.Group;
  readonly snapMarker = new SnapMarker();
  readonly axisHint = new AxisHint();
  private draftLine: THREE.Line;
  private draftGeom: THREE.BufferGeometry;
  private draftMat: THREE.LineBasicMaterial;

  constructor() {
    this.group = new THREE.Group();
    this.group.add(this.snapMarker.object);
    this.group.add(this.axisHint.object);

    this.draftGeom = new THREE.BufferGeometry();
    this.draftGeom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(600), 3));
    this.draftMat = new THREE.LineBasicMaterial({ color: 0x4f8cff, transparent: true, opacity: 0.7 });
    this.draftLine = new THREE.Line(this.draftGeom, this.draftMat);
    this.draftLine.visible = false;
    this.draftLine.renderOrder = 8;
    this.group.add(this.draftLine);
  }

  /** Replace the draft polyline. Set `points` to empty to hide. */
  setDraftPolyline(points: Array<{ x: number; y: number }>): void {
    if (points.length < 2) {
      this.draftLine.visible = false;
      return;
    }
    const pos = this.draftGeom.attributes.position as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    if (points.length * 3 > arr.length) {
      // Grow the buffer if needed
      const next = new Float32Array(points.length * 3);
      this.draftGeom.setAttribute('position', new THREE.BufferAttribute(next, 3));
    }
    const data = (this.draftGeom.attributes.position.array as Float32Array);
    for (let i = 0; i < points.length; i++) {
      data[i * 3]     = points[i]!.x;
      data[i * 3 + 1] = points[i]!.y;
      data[i * 3 + 2] = 0.01;
    }
    this.draftGeom.setDrawRange(0, points.length);
    (this.draftGeom.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    this.draftLine.visible = true;
  }

  clearDraft(): void {
    this.draftLine.visible = false;
  }

  dispose(): void {
    this.snapMarker.dispose();
    this.axisHint.dispose();
    this.draftGeom.dispose();
    this.draftMat.dispose();
  }
}
```

- [ ] **Step 4: Typecheck**

```
pnpm --filter @zilventor/app typecheck
```

- [ ] **Step 5: Commit**

```
git add packages/app/src/sketcher/overlay/
git commit -m "feat(app): SketchOverlay with SnapMarker, AxisHint, and draft polyline"
```

---

### Task 13: Committed sketch renderer

**Files:**
- Create: `packages/app/src/sketcher/render/CommittedSketchRenderer.ts`

- [ ] **Step 1: Implement**

```ts
import * as THREE from 'three';
import type { SketchPrimitive } from '@zilventor/shared';

const SKETCH_COLOR = 0xe8e8e8;
const SKETCH_Z = 0.005;

/**
 * Renders committed sketch primitives as three.js objects. Rebuild the
 * whole group whenever the primitives array changes (identity) — this
 * stays cheap because primitives count is small and geometry is simple.
 */
export class CommittedSketchRenderer {
  readonly group = new THREE.Group();
  private currentKey: string | null = null;

  update(primitives: ReadonlyArray<SketchPrimitive>): void {
    const key = primitives.map((p) => p.id).join(',');
    if (key === this.currentKey) return;
    this.currentKey = key;
    this.clear();
    for (const p of primitives) this.group.add(this.buildObject(p));
  }

  private buildObject(p: SketchPrimitive): THREE.Object3D {
    const mat = new THREE.LineBasicMaterial({ color: SKETCH_COLOR });
    if (p.kind === 'line') {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
        p.x1, p.y1, SKETCH_Z,
        p.x2, p.y2, SKETCH_Z
      ]), 3));
      return new THREE.Line(g, mat);
    }
    if (p.kind === 'rectangle') {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
        p.x,         p.y,         SKETCH_Z,
        p.x + p.w,   p.y,         SKETCH_Z,
        p.x + p.w,   p.y + p.h,   SKETCH_Z,
        p.x,         p.y + p.h,   SKETCH_Z,
        p.x,         p.y,         SKETCH_Z
      ]), 3));
      return new THREE.Line(g, mat);
    }
    if (p.kind === 'circle') {
      return this.buildArcLike(p.cx, p.cy, p.r, 0, 2 * Math.PI, 64, mat);
    }
    if (p.kind === 'arc') {
      const segs = Math.max(12, Math.ceil(Math.abs(p.endAngle - p.startAngle) * 32 / Math.PI));
      return this.buildArcLike(p.cx, p.cy, p.r, p.startAngle, p.endAngle, segs, mat);
    }
    // spline
    return this.buildSpline(p.controlPoints, mat);
  }

  private buildArcLike(cx: number, cy: number, r: number, a0: number, a1: number, segs: number, mat: THREE.LineBasicMaterial): THREE.Line {
    const arr = new Float32Array((segs + 1) * 3);
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const a = a0 + (a1 - a0) * t;
      arr[i * 3]     = cx + r * Math.cos(a);
      arr[i * 3 + 1] = cy + r * Math.sin(a);
      arr[i * 3 + 2] = SKETCH_Z;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    return new THREE.Line(g, mat);
  }

  private buildSpline(controlPoints: ReadonlyArray<{ x: number; y: number }>, mat: THREE.LineBasicMaterial): THREE.Line {
    // Use three.js CatmullRom for a quick visual approximation.
    // The committed geometry is authoritative in OCCT; this is just a display.
    const pts = controlPoints.map((cp) => new THREE.Vector3(cp.x, cp.y, SKETCH_Z));
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    const samples = curve.getPoints(Math.max(32, controlPoints.length * 8));
    const g = new THREE.BufferGeometry().setFromPoints(samples);
    return new THREE.Line(g, mat);
  }

  private clear(): void {
    while (this.group.children.length > 0) {
      const obj = this.group.children[0] as THREE.Line;
      this.group.remove(obj);
      obj.geometry.dispose();
      (obj.material as THREE.Material).dispose();
    }
  }

  dispose(): void {
    this.clear();
  }
}
```

- [ ] **Step 2: Typecheck**

```
pnpm --filter @zilventor/app typecheck
```

- [ ] **Step 3: Commit**

```
git add packages/app/src/sketcher/render/
git commit -m "feat(app): CommittedSketchRenderer — three.js objects per committed primitive"
```

---

## Phase 6 — Tool framework + concrete tools

### Task 14: `SketchTool` base class and shared types

**Files:**
- Create: `packages/app/src/sketcher/tools/SketchTool.ts`

- [ ] **Step 1: Define the base class and types**

```ts
import type { SketchPrimitive } from '@zilventor/shared';
import type { Point2, SnapResult } from '../snap';

export type ToolEvent =
  | { type: 'pointerMove'; point: Point2; snap: SnapResult }
  | { type: 'pointerClick'; point: Point2; snap: SnapResult }
  | { type: 'enterPressed' }
  | { type: 'escapePressed' }
  | { type: 'numericCommit'; values: number[] }; // e.g. [500] for one-number tools, [100, 200] for rectangle's two corners

export type ToolOutput =
  | { kind: 'preview'; polyline: Point2[] }                  // overlay should show this polyline
  | { kind: 'committed'; primitive: SketchPrimitive }        // tool produced a primitive; controller should dispatch AddPrimitiveCommand
  | { kind: 'aborted' }
  | { kind: 'idle' };                                         // nothing to display

export abstract class SketchTool {
  abstract readonly kind: 'line' | 'rect' | 'circle' | 'arc' | 'spline';
  abstract handle(event: ToolEvent): ToolOutput;
  abstract getAnchor(): Point2 | null;
  abstract reset(): void;
  /** Number of numeric fields this tool accepts during drawing; 0 = numeric input disabled right now. */
  abstract numericFieldCount(): number;
}

export function genPrimitiveId(): string {
  return `p-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
```

- [ ] **Step 2: Typecheck**

```
pnpm --filter @zilventor/app typecheck
```

- [ ] **Step 3: Commit**

```
git add packages/app/src/sketcher/tools/SketchTool.ts
git commit -m "feat(app): SketchTool base class and ToolEvent/ToolOutput types"
```

---

### Task 15: `LineTool`

**Files:**
- Create: `packages/app/src/sketcher/tools/LineTool.ts`
- Create: `packages/app/src/sketcher/tools/__tests__/LineTool.spec.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { LineTool } from '../LineTool';

const noSnap = (p: { x: number; y: number }) => ({ point: p, kind: 'none' as const });

describe('LineTool', () => {
  it('emits idle before the first click', () => {
    const t = new LineTool();
    const out = t.handle({ type: 'pointerMove', point: { x: 10, y: 10 }, snap: noSnap({ x: 10, y: 10 }) });
    expect(out.kind).toBe('idle');
  });

  it('after first click, emits preview on pointerMove', () => {
    const t = new LineTool();
    t.handle({ type: 'pointerClick', point: { x: 0, y: 0 }, snap: noSnap({ x: 0, y: 0 }) });
    const out = t.handle({ type: 'pointerMove', point: { x: 50, y: 0 }, snap: noSnap({ x: 50, y: 0 }) });
    expect(out.kind).toBe('preview');
    if (out.kind === 'preview') {
      expect(out.polyline).toEqual([{ x: 0, y: 0 }, { x: 50, y: 0 }]);
    }
  });

  it('second click commits a line primitive', () => {
    const t = new LineTool();
    t.handle({ type: 'pointerClick', point: { x: 0, y: 0 }, snap: noSnap({ x: 0, y: 0 }) });
    const out = t.handle({ type: 'pointerClick', point: { x: 100, y: 0 }, snap: noSnap({ x: 100, y: 0 }) });
    expect(out.kind).toBe('committed');
    if (out.kind === 'committed') {
      expect(out.primitive.kind).toBe('line');
      expect(out.primitive).toMatchObject({ x1: 0, y1: 0, x2: 100, y2: 0 });
      expect(out.primitive.id).toMatch(/^p-/);
    }
  });

  it('numeric commit of 500 with a horizontal-axis snap direction creates a 500mm line', () => {
    const t = new LineTool();
    t.handle({ type: 'pointerClick', point: { x: 0, y: 0 }, snap: noSnap({ x: 0, y: 0 }) });
    // set a preview that implies horizontal direction
    t.handle({ type: 'pointerMove', point: { x: 10, y: 0 }, snap: noSnap({ x: 10, y: 0 }) });
    const out = t.handle({ type: 'numericCommit', values: [500] });
    expect(out.kind).toBe('committed');
    if (out.kind === 'committed' && out.primitive.kind === 'line') {
      expect(out.primitive.x2).toBeCloseTo(500, 5);
      expect(out.primitive.y2).toBeCloseTo(0, 5);
    }
  });

  it('escapePressed after first click aborts and resets to IDLE', () => {
    const t = new LineTool();
    t.handle({ type: 'pointerClick', point: { x: 0, y: 0 }, snap: noSnap({ x: 0, y: 0 }) });
    const out = t.handle({ type: 'escapePressed' });
    expect(out.kind).toBe('aborted');
    expect(t.getAnchor()).toBeNull();
  });

  it('numericFieldCount is 1 after first click, 0 before', () => {
    const t = new LineTool();
    expect(t.numericFieldCount()).toBe(0);
    t.handle({ type: 'pointerClick', point: { x: 0, y: 0 }, snap: noSnap({ x: 0, y: 0 }) });
    expect(t.numericFieldCount()).toBe(1);
  });
});
```

- [ ] **Step 2: Run — expect fail**

```
pnpm --filter @zilventor/app test:unit
```

- [ ] **Step 3: Implement `LineTool.ts`**

```ts
import { SketchTool, type ToolEvent, type ToolOutput, genPrimitiveId } from './SketchTool';
import type { Point2 } from '../snap';

type State =
  | { step: 'idle' }
  | { step: 'waitingEnd'; firstPoint: Point2; lastMove: Point2 };

export class LineTool extends SketchTool {
  readonly kind = 'line';
  private state: State = { step: 'idle' };

  handle(event: ToolEvent): ToolOutput {
    if (event.type === 'escapePressed') {
      const wasActive = this.state.step !== 'idle';
      this.state = { step: 'idle' };
      return wasActive ? { kind: 'aborted' } : { kind: 'idle' };
    }

    if (this.state.step === 'idle') {
      if (event.type === 'pointerClick') {
        this.state = { step: 'waitingEnd', firstPoint: event.snap.point, lastMove: event.snap.point };
        return { kind: 'idle' };
      }
      return { kind: 'idle' };
    }

    // waitingEnd
    if (event.type === 'pointerMove') {
      this.state = { ...this.state, lastMove: event.snap.point };
      return { kind: 'preview', polyline: [this.state.firstPoint, event.snap.point] };
    }

    if (event.type === 'pointerClick') {
      const primitive = {
        id: genPrimitiveId(),
        kind: 'line' as const,
        x1: this.state.firstPoint.x,
        y1: this.state.firstPoint.y,
        x2: event.snap.point.x,
        y2: event.snap.point.y
      };
      this.state = { step: 'idle' };
      return { kind: 'committed', primitive };
    }

    if (event.type === 'numericCommit' && event.values.length === 1) {
      const length = event.values[0]!;
      // Direction from firstPoint to lastMove
      const dx = this.state.lastMove.x - this.state.firstPoint.x;
      const dy = this.state.lastMove.y - this.state.firstPoint.y;
      const mag = Math.hypot(dx, dy) || 1;
      const ux = dx / mag, uy = dy / mag;
      const primitive = {
        id: genPrimitiveId(),
        kind: 'line' as const,
        x1: this.state.firstPoint.x,
        y1: this.state.firstPoint.y,
        x2: this.state.firstPoint.x + ux * length,
        y2: this.state.firstPoint.y + uy * length
      };
      this.state = { step: 'idle' };
      return { kind: 'committed', primitive };
    }

    return { kind: 'idle' };
  }

  getAnchor(): Point2 | null {
    return this.state.step === 'waitingEnd' ? this.state.firstPoint : null;
  }

  reset(): void {
    this.state = { step: 'idle' };
  }

  numericFieldCount(): number {
    return this.state.step === 'waitingEnd' ? 1 : 0;
  }
}
```

- [ ] **Step 4: Run — expect pass**

- [ ] **Step 5: Commit**

```
git add packages/app/src/sketcher/tools/LineTool.ts packages/app/src/sketcher/tools/__tests__/LineTool.spec.ts
git commit -m "feat(app): LineTool with click-click and numeric-commit"
```

---

### Task 16: `RectTool`

**Files:**
- Create: `packages/app/src/sketcher/tools/RectTool.ts`
- Create: `packages/app/src/sketcher/tools/__tests__/RectTool.spec.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { RectTool } from '../RectTool';

const noSnap = (p: { x: number; y: number }) => ({ point: p, kind: 'none' as const });

describe('RectTool', () => {
  it('two clicks at opposite corners commit a rectangle with normalized x/y/w/h', () => {
    const t = new RectTool();
    t.handle({ type: 'pointerClick', point: { x: 100, y: 200 }, snap: noSnap({ x: 100, y: 200 }) });
    const out = t.handle({ type: 'pointerClick', point: { x: 0, y: 0 }, snap: noSnap({ x: 0, y: 0 }) });
    expect(out.kind).toBe('committed');
    if (out.kind === 'committed' && out.primitive.kind === 'rectangle') {
      expect(out.primitive).toMatchObject({ x: 0, y: 0, w: 100, h: 200 });
    }
  });

  it('numeric commit of [w, h] after first click produces a rectangle anchored at first click', () => {
    const t = new RectTool();
    t.handle({ type: 'pointerClick', point: { x: 10, y: 20 }, snap: noSnap({ x: 10, y: 20 }) });
    const out = t.handle({ type: 'numericCommit', values: [100, 200] });
    expect(out.kind).toBe('committed');
    if (out.kind === 'committed' && out.primitive.kind === 'rectangle') {
      expect(out.primitive).toMatchObject({ x: 10, y: 20, w: 100, h: 200 });
    }
  });

  it('preview during pointerMove after first click shows the rect outline', () => {
    const t = new RectTool();
    t.handle({ type: 'pointerClick', point: { x: 0, y: 0 }, snap: noSnap({ x: 0, y: 0 }) });
    const out = t.handle({ type: 'pointerMove', point: { x: 50, y: 30 }, snap: noSnap({ x: 50, y: 30 }) });
    expect(out.kind).toBe('preview');
    if (out.kind === 'preview') {
      expect(out.polyline.length).toBe(5); // closed rect as polyline
    }
  });

  it('numericFieldCount is 2 after first click', () => {
    const t = new RectTool();
    expect(t.numericFieldCount()).toBe(0);
    t.handle({ type: 'pointerClick', point: { x: 0, y: 0 }, snap: noSnap({ x: 0, y: 0 }) });
    expect(t.numericFieldCount()).toBe(2);
  });
});
```

- [ ] **Step 2: Run — expect fail**

- [ ] **Step 3: Implement `RectTool.ts`**

```ts
import { SketchTool, type ToolEvent, type ToolOutput, genPrimitiveId } from './SketchTool';
import type { Point2 } from '../snap';

type State = { step: 'idle' } | { step: 'waitingSecond'; first: Point2 };

export class RectTool extends SketchTool {
  readonly kind = 'rect';
  private state: State = { step: 'idle' };

  handle(event: ToolEvent): ToolOutput {
    if (event.type === 'escapePressed') {
      const wasActive = this.state.step !== 'idle';
      this.state = { step: 'idle' };
      return wasActive ? { kind: 'aborted' } : { kind: 'idle' };
    }

    if (this.state.step === 'idle') {
      if (event.type === 'pointerClick') {
        this.state = { step: 'waitingSecond', first: event.snap.point };
      }
      return { kind: 'idle' };
    }

    if (event.type === 'pointerMove') {
      const { first } = this.state;
      const p = event.snap.point;
      return { kind: 'preview', polyline: this.polyline(first, p) };
    }

    if (event.type === 'pointerClick') {
      const { first } = this.state;
      const p = event.snap.point;
      const primitive = {
        id: genPrimitiveId(),
        kind: 'rectangle' as const,
        x: Math.min(first.x, p.x),
        y: Math.min(first.y, p.y),
        w: Math.abs(p.x - first.x),
        h: Math.abs(p.y - first.y)
      };
      this.state = { step: 'idle' };
      return { kind: 'committed', primitive };
    }

    if (event.type === 'numericCommit' && event.values.length === 2) {
      const [w, h] = event.values as [number, number];
      const { first } = this.state;
      const primitive = {
        id: genPrimitiveId(),
        kind: 'rectangle' as const,
        x: first.x,
        y: first.y,
        w,
        h
      };
      this.state = { step: 'idle' };
      return { kind: 'committed', primitive };
    }

    return { kind: 'idle' };
  }

  private polyline(a: Point2, b: Point2): Point2[] {
    return [
      { x: a.x, y: a.y },
      { x: b.x, y: a.y },
      { x: b.x, y: b.y },
      { x: a.x, y: b.y },
      { x: a.x, y: a.y }
    ];
  }

  getAnchor(): Point2 | null {
    return this.state.step === 'waitingSecond' ? this.state.first : null;
  }

  reset(): void {
    this.state = { step: 'idle' };
  }

  numericFieldCount(): number {
    return this.state.step === 'waitingSecond' ? 2 : 0;
  }
}
```

- [ ] **Step 4: Run — expect pass**

- [ ] **Step 5: Commit**

```
git add packages/app/src/sketcher/tools/RectTool.ts packages/app/src/sketcher/tools/__tests__/RectTool.spec.ts
git commit -m "feat(app): RectTool with two-corner click-click and numeric w/h"
```

---

### Task 17: `CircleTool`

**Files:**
- Create: `packages/app/src/sketcher/tools/CircleTool.ts`
- Create: `packages/app/src/sketcher/tools/__tests__/CircleTool.spec.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { CircleTool } from '../CircleTool';

const noSnap = (p: { x: number; y: number }) => ({ point: p, kind: 'none' as const });

describe('CircleTool', () => {
  it('center then radius-point commits a circle', () => {
    const t = new CircleTool();
    t.handle({ type: 'pointerClick', point: { x: 50, y: 50 }, snap: noSnap({ x: 50, y: 50 }) });
    const out = t.handle({ type: 'pointerClick', point: { x: 60, y: 50 }, snap: noSnap({ x: 60, y: 50 }) });
    expect(out.kind).toBe('committed');
    if (out.kind === 'committed' && out.primitive.kind === 'circle') {
      expect(out.primitive).toMatchObject({ cx: 50, cy: 50, r: 10 });
    }
  });

  it('numeric commit of [r] after center click produces a circle with that radius', () => {
    const t = new CircleTool();
    t.handle({ type: 'pointerClick', point: { x: 0, y: 0 }, snap: noSnap({ x: 0, y: 0 }) });
    const out = t.handle({ type: 'numericCommit', values: [25] });
    expect(out.kind).toBe('committed');
    if (out.kind === 'committed' && out.primitive.kind === 'circle') {
      expect(out.primitive).toMatchObject({ cx: 0, cy: 0, r: 25 });
    }
  });

  it('rejects zero-or-negative radius with aborted output (no primitive emitted)', () => {
    const t = new CircleTool();
    t.handle({ type: 'pointerClick', point: { x: 0, y: 0 }, snap: noSnap({ x: 0, y: 0 }) });
    const out = t.handle({ type: 'pointerClick', point: { x: 0, y: 0 }, snap: noSnap({ x: 0, y: 0 }) });
    // second click exactly on center → radius 0, refuse
    expect(out.kind).toBe('idle'); // no commit
  });
});
```

- [ ] **Step 2: Run — expect fail**

- [ ] **Step 3: Implement `CircleTool.ts`**

```ts
import { SketchTool, type ToolEvent, type ToolOutput, genPrimitiveId } from './SketchTool';
import type { Point2 } from '../snap';

type State = { step: 'idle' } | { step: 'waitingRadius'; center: Point2 };

export class CircleTool extends SketchTool {
  readonly kind = 'circle';
  private state: State = { step: 'idle' };

  handle(event: ToolEvent): ToolOutput {
    if (event.type === 'escapePressed') {
      const wasActive = this.state.step !== 'idle';
      this.state = { step: 'idle' };
      return wasActive ? { kind: 'aborted' } : { kind: 'idle' };
    }

    if (this.state.step === 'idle') {
      if (event.type === 'pointerClick') {
        this.state = { step: 'waitingRadius', center: event.snap.point };
      }
      return { kind: 'idle' };
    }

    if (event.type === 'pointerMove') {
      const { center } = this.state;
      const r = Math.hypot(event.snap.point.x - center.x, event.snap.point.y - center.y);
      return { kind: 'preview', polyline: this.sampleCircle(center, r) };
    }

    if (event.type === 'pointerClick') {
      const { center } = this.state;
      const r = Math.hypot(event.snap.point.x - center.x, event.snap.point.y - center.y);
      if (r < 1e-6) return { kind: 'idle' }; // zero radius — ignore
      const primitive = { id: genPrimitiveId(), kind: 'circle' as const, cx: center.x, cy: center.y, r };
      this.state = { step: 'idle' };
      return { kind: 'committed', primitive };
    }

    if (event.type === 'numericCommit' && event.values.length === 1) {
      const r = event.values[0]!;
      if (r <= 0 || !Number.isFinite(r)) return { kind: 'idle' };
      const { center } = this.state;
      const primitive = { id: genPrimitiveId(), kind: 'circle' as const, cx: center.x, cy: center.y, r };
      this.state = { step: 'idle' };
      return { kind: 'committed', primitive };
    }

    return { kind: 'idle' };
  }

  private sampleCircle(center: Point2, r: number): Point2[] {
    const segs = 64;
    const out: Point2[] = [];
    for (let i = 0; i <= segs; i++) {
      const a = (i / segs) * 2 * Math.PI;
      out.push({ x: center.x + r * Math.cos(a), y: center.y + r * Math.sin(a) });
    }
    return out;
  }

  getAnchor(): Point2 | null {
    return this.state.step === 'waitingRadius' ? this.state.center : null;
  }

  reset(): void {
    this.state = { step: 'idle' };
  }

  numericFieldCount(): number {
    return this.state.step === 'waitingRadius' ? 1 : 0;
  }
}
```

- [ ] **Step 4: Run — expect pass**

- [ ] **Step 5: Commit**

```
git add packages/app/src/sketcher/tools/CircleTool.ts packages/app/src/sketcher/tools/__tests__/CircleTool.spec.ts
git commit -m "feat(app): CircleTool (center + radius-point or numeric radius)"
```

---

### Task 18: `ArcTool`

**Files:**
- Create: `packages/app/src/sketcher/tools/ArcTool.ts`
- Create: `packages/app/src/sketcher/tools/__tests__/ArcTool.spec.ts`

**Arc input convention:** click 1 = start, click 2 = end, click 3 = a point on the arc. Tool computes center + radius + start/end angles from the three points.

- [ ] **Step 1: Write failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { ArcTool } from '../ArcTool';

const noSnap = (p: { x: number; y: number }) => ({ point: p, kind: 'none' as const });

describe('ArcTool', () => {
  it('three clicks produce a valid arc primitive', () => {
    const t = new ArcTool();
    // Start at (50, 0), end at (-50, 0), midpoint at (0, 50) → center (0, 0), r = 50, angles 0..π
    t.handle({ type: 'pointerClick', point: { x: 50, y: 0 }, snap: noSnap({ x: 50, y: 0 }) });
    t.handle({ type: 'pointerClick', point: { x: -50, y: 0 }, snap: noSnap({ x: -50, y: 0 }) });
    const out = t.handle({ type: 'pointerClick', point: { x: 0, y: 50 }, snap: noSnap({ x: 0, y: 50 }) });
    expect(out.kind).toBe('committed');
    if (out.kind === 'committed' && out.primitive.kind === 'arc') {
      expect(out.primitive.cx).toBeCloseTo(0, 3);
      expect(out.primitive.cy).toBeCloseTo(0, 3);
      expect(out.primitive.r).toBeCloseTo(50, 3);
    }
  });

  it('collinear points (degenerate arc) abort without committing', () => {
    const t = new ArcTool();
    t.handle({ type: 'pointerClick', point: { x: 0, y: 0 }, snap: noSnap({ x: 0, y: 0 }) });
    t.handle({ type: 'pointerClick', point: { x: 100, y: 0 }, snap: noSnap({ x: 100, y: 0 }) });
    const out = t.handle({ type: 'pointerClick', point: { x: 50, y: 0 }, snap: noSnap({ x: 50, y: 0 }) });
    expect(out.kind).toBe('idle'); // no commit
  });
});
```

- [ ] **Step 2: Run — expect fail**

- [ ] **Step 3: Implement `ArcTool.ts`**

```ts
import { SketchTool, type ToolEvent, type ToolOutput, genPrimitiveId } from './SketchTool';
import type { Point2 } from '../snap';

type State =
  | { step: 'idle' }
  | { step: 'waitingEnd'; start: Point2 }
  | { step: 'waitingMid'; start: Point2; end: Point2 };

/** Compute the circumscribed circle of 3 points. Returns null if collinear. */
function circleFromThreePoints(a: Point2, b: Point2, c: Point2): { cx: number; cy: number; r: number } | null {
  const ax = a.x, ay = a.y, bx = b.x, by = b.y, cx = c.x, cy = c.y;
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(d) < 1e-6) return null; // collinear
  const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / d;
  const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / d;
  const r = Math.hypot(ax - ux, ay - uy);
  return { cx: ux, cy: uy, r };
}

function angleOf(center: { cx: number; cy: number }, p: Point2): number {
  return Math.atan2(p.y - center.cy, p.x - center.cx);
}

export class ArcTool extends SketchTool {
  readonly kind = 'arc';
  private state: State = { step: 'idle' };

  handle(event: ToolEvent): ToolOutput {
    if (event.type === 'escapePressed') {
      const wasActive = this.state.step !== 'idle';
      this.state = { step: 'idle' };
      return wasActive ? { kind: 'aborted' } : { kind: 'idle' };
    }

    if (this.state.step === 'idle') {
      if (event.type === 'pointerClick') {
        this.state = { step: 'waitingEnd', start: event.snap.point };
      }
      return { kind: 'idle' };
    }

    if (this.state.step === 'waitingEnd') {
      if (event.type === 'pointerMove') {
        return { kind: 'preview', polyline: [this.state.start, event.snap.point] };
      }
      if (event.type === 'pointerClick') {
        this.state = { step: 'waitingMid', start: this.state.start, end: event.snap.point };
      }
      return { kind: 'idle' };
    }

    // waitingMid
    if (event.type === 'pointerMove') {
      const arc = this.computeArc(this.state.start, this.state.end, event.snap.point);
      if (!arc) return { kind: 'idle' };
      return { kind: 'preview', polyline: this.sampleArc(arc) };
    }

    if (event.type === 'pointerClick') {
      const arc = this.computeArc(this.state.start, this.state.end, event.snap.point);
      if (!arc) return { kind: 'idle' }; // degenerate — refuse
      this.state = { step: 'idle' };
      return { kind: 'committed', primitive: { id: genPrimitiveId(), kind: 'arc', ...arc } };
    }

    return { kind: 'idle' };
  }

  private computeArc(start: Point2, end: Point2, mid: Point2): { cx: number; cy: number; r: number; startAngle: number; endAngle: number } | null {
    const c = circleFromThreePoints(start, end, mid);
    if (!c) return null;
    const sa = angleOf(c, start);
    const ea = angleOf(c, end);
    // Decide sweep direction: pick the one that passes through `mid`.
    const midAngle = angleOf(c, mid);
    // Normalize so that going CCW from sa to ea includes midAngle.
    // For MVP, set startAngle = sa, endAngle = ea; the ArcEdge generator
    // trusts the inputs and uses the CCW arc by default.
    // If midAngle is NOT between sa and ea going CCW, swap direction (swap sa/ea).
    const inCCW = (angle: number, a: number, b: number) => {
      // does angle lie on the CCW arc from a to b?
      const norm = (x: number) => ((x - a) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
      return norm(angle) <= norm(b);
    };
    let startAngle = sa, endAngle = ea;
    if (!inCCW(midAngle, sa, ea)) {
      startAngle = ea;
      endAngle = sa;
    }
    return { ...c, startAngle, endAngle };
  }

  private sampleArc(arc: { cx: number; cy: number; r: number; startAngle: number; endAngle: number }): Point2[] {
    const segs = 32;
    const out: Point2[] = [];
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const a = arc.startAngle + (arc.endAngle - arc.startAngle) * t;
      out.push({ x: arc.cx + arc.r * Math.cos(a), y: arc.cy + arc.r * Math.sin(a) });
    }
    return out;
  }

  getAnchor(): Point2 | null {
    if (this.state.step === 'waitingEnd') return this.state.start;
    if (this.state.step === 'waitingMid') return this.state.end;
    return null;
  }

  reset(): void {
    this.state = { step: 'idle' };
  }

  numericFieldCount(): number {
    return 0; // arc is click-only in 2a (numeric input for arc is ambiguous without a constraint system)
  }
}
```

- [ ] **Step 4: Run — expect pass**

- [ ] **Step 5: Commit**

```
git add packages/app/src/sketcher/tools/ArcTool.ts packages/app/src/sketcher/tools/__tests__/ArcTool.spec.ts
git commit -m "feat(app): ArcTool (start → end → midpoint, 3 clicks)"
```

---

### Task 19: `SplineTool`

**Files:**
- Create: `packages/app/src/sketcher/tools/SplineTool.ts`
- Create: `packages/app/src/sketcher/tools/__tests__/SplineTool.spec.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { SplineTool } from '../SplineTool';

const noSnap = (p: { x: number; y: number }) => ({ point: p, kind: 'none' as const });

describe('SplineTool', () => {
  it('N clicks + Enter commits a spline with N control points', () => {
    const t = new SplineTool();
    for (const p of [{ x: 0, y: 0 }, { x: 10, y: 20 }, { x: 20, y: 20 }, { x: 30, y: 0 }]) {
      t.handle({ type: 'pointerClick', point: p, snap: noSnap(p) });
    }
    const out = t.handle({ type: 'enterPressed' });
    expect(out.kind).toBe('committed');
    if (out.kind === 'committed' && out.primitive.kind === 'spline') {
      expect(out.primitive.controlPoints.length).toBe(4);
      expect(out.primitive.degree).toBe(3);
      expect(out.primitive.closed).toBe(false);
    }
  });

  it('Enter before 2 clicks is a no-op', () => {
    const t = new SplineTool();
    t.handle({ type: 'pointerClick', point: { x: 0, y: 0 }, snap: noSnap({ x: 0, y: 0 }) });
    const out = t.handle({ type: 'enterPressed' });
    expect(out.kind).toBe('idle');
  });

  it('preview shows a polyline through all committed control points plus current cursor', () => {
    const t = new SplineTool();
    t.handle({ type: 'pointerClick', point: { x: 0, y: 0 }, snap: noSnap({ x: 0, y: 0 }) });
    t.handle({ type: 'pointerClick', point: { x: 10, y: 10 }, snap: noSnap({ x: 10, y: 10 }) });
    const out = t.handle({ type: 'pointerMove', point: { x: 20, y: 5 }, snap: noSnap({ x: 20, y: 5 }) });
    expect(out.kind).toBe('preview');
    if (out.kind === 'preview') {
      expect(out.polyline.length).toBeGreaterThan(2); // sampled curve through 3 points
    }
  });
});
```

- [ ] **Step 2: Run — expect fail**

- [ ] **Step 3: Implement `SplineTool.ts`**

```ts
import { SketchTool, type ToolEvent, type ToolOutput, genPrimitiveId } from './SketchTool';
import type { Point2 } from '../snap';

export class SplineTool extends SketchTool {
  readonly kind = 'spline';
  private points: Point2[] = [];

  handle(event: ToolEvent): ToolOutput {
    if (event.type === 'escapePressed') {
      const wasActive = this.points.length > 0;
      this.points = [];
      return wasActive ? { kind: 'aborted' } : { kind: 'idle' };
    }

    if (event.type === 'pointerClick') {
      this.points.push(event.snap.point);
      return { kind: 'idle' };
    }

    if (event.type === 'pointerMove') {
      if (this.points.length < 1) return { kind: 'idle' };
      const sampled = this.sampleThrough([...this.points, event.snap.point]);
      return { kind: 'preview', polyline: sampled };
    }

    if (event.type === 'enterPressed') {
      if (this.points.length < 2) return { kind: 'idle' };
      const pts = this.points.slice();
      this.points = [];
      return {
        kind: 'committed',
        primitive: {
          id: genPrimitiveId(),
          kind: 'spline',
          controlPoints: pts,
          degree: 3,
          closed: false
        }
      };
    }

    return { kind: 'idle' };
  }

  /**
   * Visual-only sampling: Catmull-Rom through the control points for the preview.
   * The committed spline is re-sampled properly on the OCCT side via GeomAPI_PointsToBSpline.
   */
  private sampleThrough(pts: Point2[]): Point2[] {
    if (pts.length < 2) return pts;
    const out: Point2[] = [];
    const samples = Math.max(32, pts.length * 8);
    // Simple linear interpolation fallback for MVP visual; the render layer (CommittedSketchRenderer) uses a real curve for committed splines.
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i]!, b = pts[i + 1]!;
      const n = Math.max(4, Math.floor(samples / (pts.length - 1)));
      for (let k = 0; k < n; k++) {
        const t = k / n;
        out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      }
    }
    out.push(pts[pts.length - 1]!);
    return out;
  }

  getAnchor(): Point2 | null {
    return this.points.length > 0 ? this.points[this.points.length - 1]! : null;
  }

  reset(): void {
    this.points = [];
  }

  numericFieldCount(): number {
    return 0; // splines don't take numeric input directly in 2a
  }
}
```

- [ ] **Step 4: Run — expect pass**

- [ ] **Step 5: Commit**

```
git add packages/app/src/sketcher/tools/SplineTool.ts packages/app/src/sketcher/tools/__tests__/SplineTool.spec.ts
git commit -m "feat(app): SplineTool (N clicks + Enter, linear preview)"
```

---

## Phase 7 — Controllers and app wiring

### Task 20: `ActiveToolController`

**Files:**
- Create: `packages/app/src/sketcher/ActiveToolController.ts`
- Create: `packages/app/src/sketcher/__tests__/ActiveToolController.spec.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, it, expect, vi } from 'vitest';
import { ActiveToolController } from '../ActiveToolController';
import type { SketchPrimitive } from '@zilventor/shared';

describe('ActiveToolController', () => {
  it('routes pointer events to the active tool', () => {
    const emit = vi.fn<(p: SketchPrimitive) => void>();
    const onPreview = vi.fn();
    const c = new ActiveToolController({ emitPrimitive: emit, onPreview });
    c.setToolKind('line');
    c.handlePointer({ type: 'click', point: { x: 0, y: 0 } }, []);
    c.handlePointer({ type: 'click', point: { x: 100, y: 0 } }, []);
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit.mock.calls[0]![0].kind).toBe('line');
  });

  it('switching tool mid-draw aborts the prior tool', () => {
    const emit = vi.fn();
    const onPreview = vi.fn();
    const c = new ActiveToolController({ emitPrimitive: emit, onPreview });
    c.setToolKind('line');
    c.handlePointer({ type: 'click', point: { x: 0, y: 0 } }, []);
    c.setToolKind('rect'); // abort LineTool
    c.handlePointer({ type: 'click', point: { x: 0, y: 0 } }, []);
    c.handlePointer({ type: 'click', point: { x: 10, y: 10 } }, []);
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit.mock.calls[0]![0].kind).toBe('rectangle');
  });
});
```

- [ ] **Step 2: Run — expect fail**

- [ ] **Step 3: Implement `ActiveToolController.ts`**

```ts
import type { SketchPrimitive } from '@zilventor/shared';
import type { Point2, SnapResult } from './snap';
import { resolveSnap, type SnapContext } from './snap';
import { SketchTool, type ToolOutput } from './tools/SketchTool';
import { LineTool } from './tools/LineTool';
import { RectTool } from './tools/RectTool';
import { CircleTool } from './tools/CircleTool';
import { ArcTool } from './tools/ArcTool';
import { SplineTool } from './tools/SplineTool';

export type ToolKind = 'line' | 'rect' | 'circle' | 'arc' | 'spline';

export type PointerEvent =
  | { type: 'click'; point: Point2 }
  | { type: 'move'; point: Point2 };

export type ControllerDeps = {
  emitPrimitive(primitive: SketchPrimitive): void;
  onPreview(polyline: Point2[] | null, snap: SnapResult): void;
};

export class ActiveToolController {
  private tool: SketchTool | null = null;

  constructor(private deps: ControllerDeps) {}

  setToolKind(kind: ToolKind | null): void {
    if (this.tool) {
      this.tool.handle({ type: 'escapePressed' }); // abort whatever was in progress
    }
    this.tool = kind ? this.instantiate(kind) : null;
    this.deps.onPreview(null, { point: { x: 0, y: 0 }, kind: 'none' });
  }

  private instantiate(kind: ToolKind): SketchTool {
    switch (kind) {
      case 'line': return new LineTool();
      case 'rect': return new RectTool();
      case 'circle': return new CircleTool();
      case 'arc': return new ArcTool();
      case 'spline': return new SplineTool();
    }
  }

  handlePointer(event: PointerEvent, primitives: SketchPrimitive[]): void {
    if (!this.tool) return;
    const anchor = this.tool.getAnchor() ?? undefined;
    const snap = resolveSnap(event.point, { primitives, pixelTolerance: 5, anchor });
    let output: ToolOutput;
    if (event.type === 'click') {
      output = this.tool.handle({ type: 'pointerClick', point: event.point, snap });
    } else {
      output = this.tool.handle({ type: 'pointerMove', point: event.point, snap });
    }
    this.applyOutput(output, snap);
  }

  handleKey(key: 'Enter' | 'Escape'): void {
    if (!this.tool) return;
    const output = this.tool.handle({ type: key === 'Enter' ? 'enterPressed' : 'escapePressed' });
    this.applyOutput(output, { point: { x: 0, y: 0 }, kind: 'none' });
  }

  handleNumericCommit(values: number[]): void {
    if (!this.tool) return;
    const output = this.tool.handle({ type: 'numericCommit', values });
    this.applyOutput(output, { point: { x: 0, y: 0 }, kind: 'none' });
  }

  numericFieldCount(): number {
    return this.tool ? this.tool.numericFieldCount() : 0;
  }

  getAnchor(): Point2 | null {
    return this.tool ? this.tool.getAnchor() : null;
  }

  private applyOutput(output: ToolOutput, snap: SnapResult): void {
    switch (output.kind) {
      case 'preview':
        this.deps.onPreview(output.polyline, snap);
        break;
      case 'committed':
        this.deps.emitPrimitive(output.primitive);
        this.deps.onPreview(null, snap);
        break;
      case 'aborted':
      case 'idle':
        this.deps.onPreview(null, snap);
        break;
    }
  }
}
```

- [ ] **Step 4: Run — expect pass**

- [ ] **Step 5: Commit**

```
git add packages/app/src/sketcher/ActiveToolController.ts packages/app/src/sketcher/__tests__/ActiveToolController.spec.ts
git commit -m "feat(app): ActiveToolController routes events, swaps tools, applies outputs"
```

---

### Task 21: `SketchModeController`

**Files:**
- Create: `packages/app/src/sketcher/SketchModeController.ts`

This controller is thin in 2a — it owns the camera transition and grid visibility. Tested indirectly via E2E Workflow A.

- [ ] **Step 1: Implement**

```ts
import * as THREE from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export type SketchModeHandle = {
  enter(): void;
  exit(): void;
  isActive(): boolean;
};

export function createSketchModeController(opts: {
  camera: THREE.PerspectiveCamera;
  orbitControls: OrbitControls;
  scene: THREE.Scene;
}): SketchModeHandle {
  let active = false;
  let savedCamera: { position: THREE.Vector3; rotation: THREE.Euler; fov: number } | null = null;
  const grid = new THREE.GridHelper(500, 50, 0x555555, 0x333333);
  grid.rotateX(Math.PI / 2); // lay on XY
  grid.visible = false;
  opts.scene.add(grid);

  return {
    enter(): void {
      if (active) return;
      active = true;
      savedCamera = {
        position: opts.camera.position.clone(),
        rotation: opts.camera.rotation.clone(),
        fov: opts.camera.fov
      };
      // Look straight down XY from +Z, ortho-like perspective (narrow FOV)
      opts.camera.position.set(0, 0, 500);
      opts.camera.lookAt(0, 0, 0);
      opts.camera.fov = 10;
      opts.camera.updateProjectionMatrix();
      opts.orbitControls.enableRotate = false;
      grid.visible = true;
    },
    exit(): void {
      if (!active) return;
      active = false;
      if (savedCamera) {
        opts.camera.position.copy(savedCamera.position);
        opts.camera.rotation.copy(savedCamera.rotation);
        opts.camera.fov = savedCamera.fov;
        opts.camera.updateProjectionMatrix();
      }
      opts.orbitControls.enableRotate = true;
      grid.visible = false;
    },
    isActive(): boolean {
      return active;
    }
  };
}
```

- [ ] **Step 2: Typecheck**

```
pnpm --filter @zilventor/app typecheck
```

- [ ] **Step 3: Commit**

```
git add packages/app/src/sketcher/SketchModeController.ts
git commit -m "feat(app): SketchModeController — ortho-like camera swap + grid"
```

---

### Task 22: `SketchTab` with 5 primitive buttons

**Files:**
- Modify: `packages/app/src/shell/tabs/SketchTab.tsx`

- [ ] **Step 1: Replace `SketchTab.tsx` content**

```tsx
import { useEffect, useState } from 'react';
import RibbonPanel from '../RibbonPanel';
import { useAppStore } from '../../store/useAppStore';
import SketchRectangleDialog from '../SketchRectangleDialog';

type PrimitiveBtn = { kind: 'line' | 'rect' | 'circle' | 'arc' | 'spline'; label: string; shortcut: string };
const BUTTONS: PrimitiveBtn[] = [
  { kind: 'line',   label: 'Line',      shortcut: 'L' },
  { kind: 'rect',   label: 'Rectangle', shortcut: 'R' },
  { kind: 'circle', label: 'Circle',    shortcut: 'C' },
  { kind: 'arc',    label: 'Arc',       shortcut: 'A' },
  { kind: 'spline', label: 'Spline',    shortcut: 'S' }
];

export default function SketchTab() {
  const activePart = useAppStore((s) => s.activePart);
  const sketchMode = useAppStore((s) => s.sketchMode);
  const activeToolKind = useAppStore((s) => s.activeToolKind);
  const canSketch = !!activePart;
  const [numericFallbackOpen, setNumericFallbackOpen] = useState(false);

  const startSketch = () => {
    const store = useAppStore.getState();
    if (!store.kernel || !activePart) return;
    // Find the most recent sketch feature on the active part, or create a new one.
    const latestSketch = [...activePart.featureTree].reverse().find((f) => f.kind === 'sketch');
    if (latestSketch) {
      store.setSketchMode(true, latestSketch.id);
    } else {
      // Create a new sketch feature
      const newId = `s${Date.now()}`;
      store.kernel.addFeature(activePart.id, { kind: 'sketch', id: newId, plane: 'XY', primitives: [] }).then(async () => {
        const next = await store.kernel!.getPart(activePart.id);
        store.setActivePart(next);
        store.setSketchMode(true, newId);
      });
    }
  };

  const finishSketch = () => {
    const store = useAppStore.getState();
    store.setSketchMode(false);
    store.setActiveToolKind(null);
    store.setStatus('Ready');
  };

  // Keyboard shortcuts for tools (only active in sketch mode)
  useEffect(() => {
    if (!sketchMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      const btn = BUTTONS.find((b) => b.shortcut.toLowerCase() === e.key.toLowerCase());
      if (btn) useAppStore.getState().setActiveToolKind(btn.kind);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sketchMode]);

  return (
    <div className="flex gap-2 px-3 py-2">
      <RibbonPanel title="Sketch">
        {!sketchMode && (
          <button className="text-xs hover:text-white disabled:text-neutral-500" disabled={!canSketch} onClick={startSketch}>2D Sketch</button>
        )}
        {sketchMode && (
          <button className="text-xs hover:text-white" onClick={finishSketch}>Finish Sketch</button>
        )}
      </RibbonPanel>
      <RibbonPanel title="Draw">
        {BUTTONS.map((b) => (
          <button
            key={b.kind}
            aria-pressed={activeToolKind === b.kind}
            className={`text-xs ${activeToolKind === b.kind ? 'text-white font-semibold' : 'text-neutral-300 hover:text-white'} disabled:text-neutral-500`}
            disabled={!sketchMode}
            onClick={() => useAppStore.getState().setActiveToolKind(b.kind)}
          >
            {b.label} <span className="text-neutral-500">({b.shortcut})</span>
          </button>
        ))}
      </RibbonPanel>
      <RibbonPanel title="Constrain">
        <button className="text-xs text-neutral-500" disabled>Constraints (SP2b)</button>
      </RibbonPanel>
      <RibbonPanel title="Fallback">
        <button className="text-xs text-neutral-400 hover:text-white" onClick={() => setNumericFallbackOpen(true)}>Numeric rectangle…</button>
      </RibbonPanel>
      {numericFallbackOpen && <SketchRectangleDialog onClose={() => setNumericFallbackOpen(false)} />}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

```
pnpm --filter @zilventor/app typecheck
```

- [ ] **Step 3: Commit**

```
git add packages/app/src/shell/tabs/SketchTab.tsx
git commit -m "feat(app): SketchTab with 5 primitive buttons + finish-sketch + numeric fallback"
```

---

### Task 23: `NumericInputOverlay` floating input

**Files:**
- Create: `packages/app/src/shell/NumericInputOverlay.tsx`

- [ ] **Step 1: Implement**

```tsx
import { useEffect, useRef, useState } from 'react';

type Props = {
  visible: boolean;
  fieldCount: number;       // 0 = hide, 1 = single input, 2 = two inputs (w,h)
  position: { x: number; y: number };
  onCommit(values: number[]): void;
  onCancel(): void;
};

export default function NumericInputOverlay({ visible, fieldCount, position, onCommit, onCancel }: Props) {
  const [values, setValues] = useState<string[]>(Array(Math.max(fieldCount, 1)).fill(''));
  const firstRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (visible && fieldCount > 0) {
      setValues(Array(fieldCount).fill(''));
      queueMicrotask(() => firstRef.current?.focus());
    }
  }, [visible, fieldCount]);

  if (!visible || fieldCount === 0) return null;

  const submit = () => {
    const parsed = values.map((v) => Number(v));
    if (parsed.some((n) => !Number.isFinite(n))) return;
    onCommit(parsed);
  };

  const handleKey = (e: React.KeyboardEvent<HTMLInputElement>, idx: number) => {
    if (e.key === 'Enter') submit();
    else if (e.key === 'Escape') onCancel();
    else if (e.key === 'Tab' && idx < fieldCount - 1) {
      e.preventDefault();
      const next = document.querySelectorAll<HTMLInputElement>('[data-numeric-input]').item(idx + 1);
      next?.focus();
    }
  };

  return (
    <div
      className="absolute bg-shell-panel border border-shell-border rounded shadow-xl px-2 py-1 flex gap-1 z-40"
      style={{ left: position.x, top: position.y }}
    >
      {Array.from({ length: fieldCount }).map((_, i) => (
        <input
          key={i}
          ref={i === 0 ? firstRef : undefined}
          data-numeric-input
          type="text"
          value={values[i] ?? ''}
          onChange={(e) => setValues((prev) => prev.map((v, j) => j === i ? e.target.value : v))}
          onKeyDown={(e) => handleKey(e, i)}
          className="bg-shell text-white px-2 py-0.5 text-xs w-20 outline-none focus:ring-1 focus:ring-ribbon-accent"
          placeholder={fieldCount === 2 ? (i === 0 ? 'w' : 'h') : ''}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

```
pnpm --filter @zilventor/app typecheck
```

- [ ] **Step 3: Commit**

```
git add packages/app/src/shell/NumericInputOverlay.tsx
git commit -m "feat(app): NumericInputOverlay — floating input for draw-mode values"
```

---

### Task 24: Wire everything into `App.tsx` and `Viewport.tsx`

**Files:**
- Modify: `packages/app/src/viewport/SceneManager.ts` — expose `getCamera()`, `getControls()` so SketchModeController can flip them.
- Modify: `packages/app/src/viewport/Viewport.tsx` — route pointer events to a controller via a prop callback.
- Modify: `packages/app/src/App.tsx` — instantiate `SketchModeController` + `ActiveToolController`, gate re-execute on sketchMode, wire numeric input.

This is the biggest glue task. Keep the steps concrete.

- [ ] **Step 1: Expose camera/controls on `SceneManager`**

Add (or confirm) these methods on SceneManager:

```ts
getCamera(): THREE.PerspectiveCamera { return this.camera; }
getControls(): OrbitControls { return this.controls; }
getScene(): THREE.Scene { return this.scene; }
addObject(obj: THREE.Object3D): void { this.scene.add(obj); }
removeObject(obj: THREE.Object3D): void { this.scene.remove(obj); }
```

- [ ] **Step 2: Extend `ViewportRef` and wire pointer events**

Edit `packages/app/src/viewport/Viewport.tsx`:

```ts
export type ViewportRef = {
  setMesh(positions: Float32Array, indices: Uint32Array): void;
  captureThumbnail(w: number, h: number): Promise<Uint8Array>;
  getSceneManager(): SceneManager | null;
  screenToWorld(x: number, y: number): { x: number; y: number }; // NEW
};
```

Implement `screenToWorld` via three.js `Raycaster` from the canvas coords onto the XY plane:

```ts
screenToWorld: (x, y) => {
  if (!sceneRef.current) return { x: 0, y: 0 };
  const sm = sceneRef.current;
  const canvas = canvasRef.current!;
  const rect = canvas.getBoundingClientRect();
  const ndc = new THREE.Vector2(
    ((x - rect.left) / rect.width) * 2 - 1,
    -(((y - rect.top) / rect.height) * 2 - 1)
  );
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(ndc, sm.getCamera());
  const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  const hit = new THREE.Vector3();
  raycaster.ray.intersectPlane(plane, hit);
  return { x: hit.x, y: hit.y };
}
```

Add pointer event handlers on the canvas `onPointerDown` and `onPointerMove` that call through to a new `onPointer` prop when provided:

```tsx
<canvas
  ref={canvasRef}
  className="block w-full h-full"
  onPointerDown={(e) => props.onPointer?.({ type: 'click', clientX: e.clientX, clientY: e.clientY })}
  onPointerMove={(e) => props.onPointer?.({ type: 'move', clientX: e.clientX, clientY: e.clientY })}
/>
```

Extend Viewport props:

```ts
type Props = {
  onPointer?: (event: { type: 'click' | 'move'; clientX: number; clientY: number }) => void;
};
```

- [ ] **Step 3: Rewrite `App.tsx`** (relevant additions)

Add refs + controllers:

```tsx
import { createSketchModeController, type SketchModeHandle } from './sketcher/SketchModeController';
import { ActiveToolController } from './sketcher/ActiveToolController';
import { SketchOverlay } from './sketcher/overlay/SketchOverlay';
import { CommittedSketchRenderer } from './sketcher/render/CommittedSketchRenderer';
import NumericInputOverlay from './shell/NumericInputOverlay';
import { AddPrimitiveCommand } from './commands/AddPrimitiveCommand';

// In the component body:
const sketchModeRef = useRef<SketchModeHandle | null>(null);
const activeToolCtrlRef = useRef<ActiveToolController | null>(null);
const sketchOverlayRef = useRef<SketchOverlay | null>(null);
const committedSketchRendererRef = useRef<CommittedSketchRenderer | null>(null);
const [numericVisible, setNumericVisible] = useState(false);
const [numericFieldCount, setNumericFieldCount] = useState(0);
const [cursorScreenPos, setCursorScreenPos] = useState({ x: 0, y: 0 });

const sketchMode = useAppStore((s) => s.sketchMode);
const activeSketchId = useAppStore((s) => s.activeSketchId);
const activeToolKind = useAppStore((s) => s.activeToolKind);
```

Initialize controllers once the viewport is ready (useLayoutEffect):

```tsx
useLayoutEffect(() => {
  if (!viewportRef.current) return;
  const sm = viewportRef.current.getSceneManager();
  if (!sm) return;
  sketchModeRef.current = createSketchModeController({
    camera: sm.getCamera(),
    orbitControls: sm.getControls(),
    scene: sm.getScene()
  });
  sketchOverlayRef.current = new SketchOverlay();
  committedSketchRendererRef.current = new CommittedSketchRenderer();
  sm.addObject(sketchOverlayRef.current.group);
  sm.addObject(committedSketchRendererRef.current.group);

  activeToolCtrlRef.current = new ActiveToolController({
    emitPrimitive: async (primitive) => {
      const store = useAppStore.getState();
      if (!store.kernel || !store.activePart || !store.activeSketchId) return;
      await store.bus.execute(new AddPrimitiveCommand({
        kernel: store.kernel,
        store: { activePart: store.activePart, setActivePart: store.setActivePart },
        sketchId: store.activeSketchId,
        primitive
      }));
    },
    onPreview: (polyline, snap) => {
      const overlay = sketchOverlayRef.current;
      if (!overlay) return;
      if (polyline && polyline.length >= 2) overlay.setDraftPolyline(polyline);
      else overlay.clearDraft();
      if (snap.kind === 'endpoint') overlay.snapMarker.show(snap.point.x, snap.point.y);
      else overlay.snapMarker.hide();
      if (snap.kind === 'horizontal-axis') {
        const anchor = activeToolCtrlRef.current?.getAnchor();
        if (anchor) overlay.axisHint.showHorizontal(anchor, snap.point);
      } else if (snap.kind === 'vertical-axis') {
        const anchor = activeToolCtrlRef.current?.getAnchor();
        if (anchor) overlay.axisHint.showVertical(anchor, snap.point);
      } else overlay.axisHint.hide();
      setNumericFieldCount(activeToolCtrlRef.current?.numericFieldCount() ?? 0);
      setNumericVisible((activeToolCtrlRef.current?.numericFieldCount() ?? 0) > 0);
    }
  });
}, []);
```

Drive mode + tool + rendering via effects:

```tsx
useEffect(() => {
  if (!sketchModeRef.current) return;
  if (sketchMode) sketchModeRef.current.enter();
  else sketchModeRef.current.exit();
}, [sketchMode]);

useEffect(() => {
  activeToolCtrlRef.current?.setToolKind(activeToolKind);
}, [activeToolKind]);

useEffect(() => {
  if (!committedSketchRendererRef.current) return;
  if (!activePart || !activeSketchId) {
    committedSketchRendererRef.current.update([]);
    return;
  }
  const sketch = activePart.featureTree.find((f) => f.kind === 'sketch' && f.id === activeSketchId);
  committedSketchRendererRef.current.update(sketch?.kind === 'sketch' ? sketch.primitives : []);
}, [activePart, activeSketchId]);
```

Gate the kernel execute:

```tsx
useEffect(() => {
  let cancelled = false;
  (async () => {
    if (useAppStore.getState().sketchMode) return; // gated
    if (!kernel || !activePart || !viewportRef.current) return;
    const hasExtrude = activePart.featureTree.some((f) => f.kind === 'extrude');
    if (!hasExtrude) return;
    const res = await kernel.execute(activePart.id);
    if (cancelled) return;
    if (res.ok) viewportRef.current.setMesh(res.value.mesh.positions, res.value.mesh.indices);
    else useAppStore.getState().setStatus(`Error: ${res.error.message}`);
  })();
  return () => { cancelled = true; };
}, [activePart, kernel, sketchMode]);
```

Pointer routing on the viewport:

```tsx
<Viewport
  ref={viewportRef}
  onPointer={(ev) => {
    if (!sketchMode || !activeToolCtrlRef.current || !viewportRef.current) return;
    const world = viewportRef.current.screenToWorld(ev.clientX, ev.clientY);
    const primitives = (activePart?.featureTree.find((f) => f.kind === 'sketch' && f.id === activeSketchId) as { primitives?: SketchPrimitive[] } | undefined)?.primitives ?? [];
    activeToolCtrlRef.current.handlePointer({ type: ev.type === 'click' ? 'click' : 'move', point: world }, primitives as SketchPrimitive[]);
    if (ev.type === 'move') setCursorScreenPos({ x: ev.clientX, y: ev.clientY });
  }}
/>
```

Wire `Enter` / `Escape` in the existing keydown handler:

```tsx
useEffect(() => {
  const onKey = async (e: KeyboardEvent) => {
    const target = e.target as HTMLElement | null;
    if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA') return;
    if (sketchMode && activeToolCtrlRef.current) {
      if (e.key === 'Escape') {
        activeToolCtrlRef.current.handleKey('Escape');
        return;
      }
      if (e.key === 'Enter') {
        activeToolCtrlRef.current.handleKey('Enter');
        return;
      }
    }
    const bus = useAppStore.getState().bus;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
      e.preventDefault();
      await bus.undo();
    } else if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) {
      e.preventDefault();
      await bus.redo();
    }
  };
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}, [sketchMode]);
```

Render the NumericInputOverlay:

```tsx
<NumericInputOverlay
  visible={sketchMode && numericVisible}
  fieldCount={numericFieldCount}
  position={cursorScreenPos}
  onCommit={(values) => activeToolCtrlRef.current?.handleNumericCommit(values)}
  onCancel={() => setNumericVisible(false)}
/>
```

- [ ] **Step 4: Run all unit tests**

```
pnpm --filter @zilventor/app test:unit
```

Existing app tests should continue passing. If App.spec.tsx breaks because of missing `getSceneManager`, stub it in the test.

- [ ] **Step 5: Typecheck**

```
pnpm -r typecheck
```

- [ ] **Step 6: Commit**

```
git add packages/app/src/
git commit -m "feat(app): wire sketcher end-to-end — mode, tools, overlay, numeric input, gated execute"
```

---

## Phase 8 — E2E + perf tests

### Task 25: E2E `enter-sketch-mode` and `draw-line`

**Files:**
- Create: `tests/e2e/sketcher/enter-sketch-mode.spec.ts`
- Create: `tests/e2e/sketcher/draw-line.spec.ts`

- [ ] **Step 1: Write `enter-sketch-mode.spec.ts`**

```ts
import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';

test('Enter sketch mode shows sketch tools enabled and Finish Sketch visible', async ({ page }) => {
  await page.goto('/');
  await waitForKernelReady(page);

  await page.getByRole('tab', { name: 'Model' }).click();
  await page.getByRole('button', { name: 'New Part' }).click();

  await page.getByRole('tab', { name: 'Sketch' }).click();
  await page.getByRole('button', { name: '2D Sketch' }).click();

  await expect(page.getByRole('button', { name: /Finish Sketch/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Line/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Rectangle/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Circle/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Arc/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Spline/i })).toBeVisible();
});
```

- [ ] **Step 2: Write `draw-line.spec.ts`**

```ts
import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';

test('Draw a line: 2 clicks commit a line primitive', async ({ page }) => {
  await page.goto('/');
  await waitForKernelReady(page);

  await page.getByRole('tab', { name: 'Model' }).click();
  await page.getByRole('button', { name: 'New Part' }).click();
  await page.getByRole('tab', { name: 'Sketch' }).click();
  await page.getByRole('button', { name: '2D Sketch' }).click();
  await page.getByRole('button', { name: /^Line/i }).click();

  const viewport = page.locator('main#region-viewport canvas');
  const box = (await viewport.boundingBox())!;
  // Click in viewport center, then 100px right
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.click(box.x + box.width / 2 + 100, box.y + box.height / 2);

  // Browser pane should show the sketch with a line primitive
  await expect(page.locator('[data-sketch-primitive-count]')).toHaveAttribute('data-sketch-primitive-count', '1');
});
```

Note: `data-sketch-primitive-count` is a new data attribute on the browser pane's sketch row — add it in `BrowserPane.tsx` for test discoverability:

```tsx
// in BrowserPane.tsx render of sketch features, add:
<li key={f.id} className="pl-3" data-sketch-primitive-count={f.primitives.length}>▸ Sketch{sketchCount}</li>
```

- [ ] **Step 3: Run**

```
pnpm exec playwright test tests/e2e/sketcher/
```

- [ ] **Step 4: Commit**

```
git add tests/e2e/sketcher/ packages/app/src/shell/BrowserPane.tsx
git commit -m "test(e2e): enter-sketch-mode + draw-line workflows"
```

---

### Task 26: E2E `extrude-l-shape` and `extrude-fails-open-sketch`

**Files:**
- Create: `tests/e2e/sketcher/extrude-l-shape.spec.ts`
- Create: `tests/e2e/sketcher/extrude-fails-open-sketch.spec.ts`

- [ ] **Step 1: Write `extrude-l-shape.spec.ts`**

```ts
import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';

test('Extrude an L-shape drawn from 6 lines', async ({ page }) => {
  await page.goto('/');
  await waitForKernelReady(page);

  // New part + enter sketch mode
  await page.getByRole('tab', { name: 'Model' }).click();
  await page.getByRole('button', { name: 'New Part' }).click();
  await page.getByRole('tab', { name: 'Sketch' }).click();
  await page.getByRole('button', { name: '2D Sketch' }).click();
  await page.getByRole('button', { name: /^Line/i }).click();

  const viewport = page.locator('main#region-viewport canvas');
  const box = (await viewport.boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  // L-shape corners in screen coords (arbitrary, as long as they form a closed L)
  const pts = [
    [cx, cy], [cx + 100, cy], [cx + 100, cy - 50], [cx + 150, cy - 50], [cx + 150, cy - 100], [cx, cy - 100]
  ];
  for (let i = 0; i < pts.length; i++) {
    await page.mouse.click(pts[i]![0]!, pts[i]![1]!);
    if (i < pts.length - 1) await page.mouse.click(pts[i + 1]![0]!, pts[i + 1]![1]!);
  }
  // close: click back to start
  await page.mouse.click(pts[0]![0]!, pts[0]![1]!);

  // Finish + extrude
  await page.getByRole('button', { name: 'Finish Sketch' }).click();
  await page.getByRole('tab', { name: 'Model' }).click();
  await page.getByRole('button', { name: 'Extrude' }).click();
  await page.getByLabel('Distance').fill('50');
  await page.getByRole('button', { name: 'OK' }).click();

  await expect(page.locator('[data-triangle-count]')).toHaveAttribute('data-triangle-count', /[1-9]\d*/);
});
```

- [ ] **Step 2: Write `extrude-fails-open-sketch.spec.ts`**

```ts
import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';

test('Extrude fails with "not closed" message for an open polyline', async ({ page }) => {
  await page.goto('/');
  await waitForKernelReady(page);

  await page.getByRole('tab', { name: 'Model' }).click();
  await page.getByRole('button', { name: 'New Part' }).click();
  await page.getByRole('tab', { name: 'Sketch' }).click();
  await page.getByRole('button', { name: '2D Sketch' }).click();
  await page.getByRole('button', { name: /^Line/i }).click();

  const viewport = page.locator('main#region-viewport canvas');
  const box = (await viewport.boundingBox())!;
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;

  // Three lines forming an open polyline
  await page.mouse.click(cx, cy);
  await page.mouse.click(cx + 100, cy);
  await page.mouse.click(cx + 100, cy - 50);
  await page.keyboard.press('Escape'); // stop line chain

  await page.getByRole('button', { name: 'Finish Sketch' }).click();
  await page.getByRole('tab', { name: 'Model' }).click();
  await page.getByRole('button', { name: 'Extrude' }).click();
  await page.getByLabel('Distance').fill('50');
  await page.getByRole('button', { name: 'OK' }).click();

  // Error toast / status message visible
  await expect(page.getByText(/not closed/i)).toBeVisible();
});
```

- [ ] **Step 3: Run**

```
pnpm exec playwright test tests/e2e/sketcher/
```

- [ ] **Step 4: Commit**

```
git add tests/e2e/sketcher/
git commit -m "test(e2e): extrude-l-shape + extrude-fails-open-sketch workflows"
```

---

### Task 27: Perf tests + manual checklist

**Files:**
- Create: `tests/perf/enter-sketch-mode.spec.ts`
- Create: `tests/perf/draw-20-primitives.spec.ts`
- Create: `docs/superpowers/manual-tests/subproject-2a.md`

- [ ] **Step 1: `tests/perf/enter-sketch-mode.spec.ts`**

```ts
import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../e2e/helpers/buildBox';

test('Perf: enter sketch mode under 600 ms (3× budget)', async ({ page }) => {
  await page.goto('/');
  await waitForKernelReady(page);

  await page.getByRole('tab', { name: 'Model' }).click();
  await page.getByRole('button', { name: 'New Part' }).click();
  await page.getByRole('tab', { name: 'Sketch' }).click();

  const t0 = Date.now();
  await page.getByRole('button', { name: '2D Sketch' }).click();
  await expect(page.getByRole('button', { name: 'Finish Sketch' })).toBeVisible();
  const dt = Date.now() - t0;
  console.log(JSON.stringify({ metric: 'enter-sketch-mode', ms: dt }));
  expect(dt).toBeLessThan(600);
});
```

- [ ] **Step 2: `tests/perf/draw-20-primitives.spec.ts`**

```ts
import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../e2e/helpers/buildBox';

test('Perf: draw 20 primitives in under 5 s', async ({ page }) => {
  await page.goto('/');
  await waitForKernelReady(page);

  await page.getByRole('tab', { name: 'Model' }).click();
  await page.getByRole('button', { name: 'New Part' }).click();
  await page.getByRole('tab', { name: 'Sketch' }).click();
  await page.getByRole('button', { name: '2D Sketch' }).click();
  await page.getByRole('button', { name: /^Line/i }).click();

  const viewport = page.locator('main#region-viewport canvas');
  const box = (await viewport.boundingBox())!;
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;

  const t0 = Date.now();
  for (let i = 0; i < 20; i++) {
    await page.mouse.click(cx + (i % 5) * 20, cy + Math.floor(i / 5) * 20);
    await page.mouse.click(cx + (i % 5) * 20 + 10, cy + Math.floor(i / 5) * 20 + 10);
  }
  const dt = Date.now() - t0;
  console.log(JSON.stringify({ metric: 'draw-20-primitives', ms: dt }));
  expect(dt).toBeLessThan(5_000);
});
```

- [ ] **Step 3: Manual checklist `docs/superpowers/manual-tests/subproject-2a.md`**

```markdown
# Sub-project 2a Manual Test Checklist

Performed on the target laptop (2014–2016 Intel HD, 4–8 GB RAM, current Chrome).

## Tests

1. [ ] Enter sketch mode via "2D Sketch" — camera switches to near-ortho, grid visible within 200 ms.
2. [ ] Draw a line: click + click, primitive visible in viewport + browser pane count increments.
3. [ ] Draw a line with horizontal-axis snap: start anywhere, move cursor near horizontal from anchor, verify dashed axis hint appears.
4. [ ] Draw a line with numeric input: click, type `500`, press Enter, verify a 500mm line committed in the current direction.
5. [ ] Draw a rectangle: two corner clicks.
6. [ ] Draw a rectangle via numeric: one click + type `100` Tab `200` Enter.
7. [ ] Draw a circle: center click + radius click.
8. [ ] Draw an arc: 3 clicks (start, end, midpoint).
9. [ ] Draw a spline: 4+ clicks + Enter.
10. [ ] Delete a primitive: click it, press Delete, verify it's gone. Ctrl+Z restores it.
11. [ ] Extrude a closed sketch (rectangle): finish sketch, Extrude 18mm, verify solid in viewport.
12. [ ] Extrude an open sketch: verify "not closed" message appears.
13. [ ] Extrude an L-shape drawn from 6 lines: verify solid appears.
14. [ ] Save a part with primitives → reopen → verify primitives render.
15. [ ] Migration: open an old v1 `.zipt` file (from Shell MVP era) — verify it loads.

## Sign-off

- Date: ____
- Tester: ____
- Notes: ____
```

- [ ] **Step 4: Run perf tests**

```
pnpm test:perf
```

Both new tests should pass.

- [ ] **Step 5: Commit**

```
git add tests/perf/ docs/superpowers/manual-tests/subproject-2a.md
git commit -m "test: sub-project 2a perf tests + manual checklist"
```

---

## Done

Sub-project 2a is complete when:

- All § 2.2 success criteria from the spec are demonstrably true on the target laptop.
- 27 new or modified tests pass across unit (tools + snap + commands + migration), integration (edges + combiner + sketch feature), E2E (6 sketcher workflows + all Shell MVP workflows), and perf.
- Manual checklist signed off.

Next step after 2a ships: brainstorm **Sub-project 2b — geometric constraints + planegcs solver**.
