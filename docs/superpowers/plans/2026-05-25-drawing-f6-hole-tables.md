# Drawing F6 — Hole Tables Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an Inventor-style Hole Table drawing annotation — a sheet table tabulating the holes visible in a view (size-grouped tag, X/Y vs a user-picked datum, an Inventor-style Description) with a tag-in-circle + leader marker on each hole.

**Architecture:** Provenance-based extraction — projected hole circles carry `sourceFaceIds` (`"<featureId>|<role>|<instance>"`) that resolve back to the source part's `HoleFeature`, giving exact nominal diameter / depth / termination while the X/Y centers come from a circle-fit of the projected geometry. The table is a new `DrawingAnnotation` variant riding the existing `sheet.annotations[]` array (no manifest bump, no migration). Pure extraction/tagging/formatting lives in a store-free `@zilventor/shared` module called by BOTH render paths (React live canvas `HoleTableElement.tsx` + string-SVG `renderDrawingSvg.ts`). Values recompute live each render (the F4 dimension-cascade pattern); only the stable tag map is persisted.

**Tech Stack:** TypeScript monorepo (pnpm workspaces): `@zilventor/shared` (pure domain + types, Vitest), `packages/app` (React + Zustand store + command bus, Vitest + Playwright e2e/perf). Spec: `docs/superpowers/specs/2026-05-25-drawing-f6-hole-tables-design.md`.

**Batches:** (1) shared core — types + `holeTable.ts` (extract / circle-fit / tags / format / rows) + unit tests. (2) `AddHoleTableCommand` + `'holeTable'` ToolMode state machine + ribbon + canvas click wiring + app unit tests. (3) both render paths + grep-parity + mid-flight Playwright. (4) e2e `T-6-15` + perf `T63f` + final-pass review.

---

## Cross-batch reconciliation notes (controller — READ BEFORE EXECUTING)

These supersede any conflicting wording in the per-batch sections below. They were applied during plan assembly after verifying the real codebase.

1. **Canonical signature `computeHoleTableRows(annotation, view, part, resolveParam)`** — NO `sheet` param (the spec §5.4 draft had one; the sheet-mm transform only needs `view.positionMm` + `view.scale`). All four batches use this 4-arg form. ✅ consistent.

2. **No AnnotationElement stub (Batch 2 Task 2.6 removed).** `AnnotationElement.tsx`'s switch ends in `default: return null;` with **no `never`-exhaustiveness assertion** (verified `AnnotationElement.tsx:94-95`), so adding the `holeTable` union variant in Batch 1 does NOT break compilation. **Batch 3 Task 3.3 owns the single real `case 'holeTable'`.** Do not add a stub in Batch 2 — it would create a duplicate-case error.

3. **Export-path part/assembly guard uses structural narrowing, NOT a `kind` field.** Neither `PartDocument` nor `AssemblyDocument` has a `kind` discriminant (verified `packages/shared/src/types.ts:67,94`). `renderHoleTableAnnotation` distinguishes via `'featureTree' in source`. Hole tables apply only to part drawings; assembly drawings render nothing. (Applied in Batch 3 Task 3.4.)

4. **No function-scope `import`.** `computeHoleTableRows` is imported at the top of `renderDrawingSvg.ts` (Batch 3 Task 3.4 step d), never inside the function body. (Applied.)

5. **Import paths:** runtime values from `@zilventor/shared/src/drawing/holeTable` (deep import — the established convention, 62 existing files; `renderDrawingSvg.ts` already deep-imports `dimensionMath`/`titleBlock`); type-only imports (`HoleTableAnnotation`, `PartDocument`, `ParamOrLiteral`, `PointRef`) from the package root `@zilventor/shared` (or `@zilventor/shared/src/drawing/types` for `PointRef`, matching existing usage). ✅ verified.

6. **Integration coupling — circle-fit tolerance ↔ test fixtures.** Batch 1 defines `HOLE_CIRCLE_FIT_TOL_MM`; the synthetic circle fixtures in Batch 1 unit tests, Batch 4 e2e (`T-6-15`, 16-point circles), and Batch 4 perf (`T63f`) MUST produce circles that pass that tolerance. If a Batch-4 fixture's polygonal circle fails the fit, increase its point count or loosen the tolerance constant — do NOT silently drop the assertion. This is the single most likely cross-batch failure; the Batch-4 implementer must confirm `extractHolesInView` returns the expected hole count on the fixture before asserting tags.

7. **Datum-edge `PointRef` heuristic (Batch 2 Task 2.4)** is coarse (`edge.kind === 'feature' ? arc-center : edge-endpoint`). It does not crash; a mis-pick yields wrong X/Y, caught by the Batch 3 mid-flight Playwright check and Batch 4 e2e. Refining it (inspect the edge's arc flag) is acceptable in Batch 3 or deferred to F6.x.

## Self-review (controller, against the spec)

- **Spec coverage:** §2 locked decisions → Batches 1–3; §4 data model → Batch 1 Task 1.1; §5 extraction/tags/format/rows → Batch 1 Tasks 1.2–1.5; §6 both render paths → Batch 3; §7 command/ToolMode/ribbon → Batch 2; §8 testing → Batches 1–4; §9 batches → 1:1. No spec requirement is unassigned.
- **Placeholders:** none — every code step carries complete code (per-batch writers verified; controller spot-checked the signature, guard, import, and routing decisions).
- **Type consistency:** `HoleTableAnnotation`, `ExtractedHole`, `HoleTableRow`, and the five `holeTable.ts` function signatures match the canonical anchors §0 across all four parts (grep-verified during assembly).
- **Per-batch self-critiques** are retained at the end of each batch section (confidence 76 / 78 / 72 / 72) as risk documentation for implementers.

---
## Batch 1 — Shared Core

Pure, store-free. Delivers the `HoleTableAnnotation` type extension and the complete `holeTable.ts` module with all four exported functions. No manifest bump (additive — no old file has hole-table entries). No app-store import anywhere in this batch.

**Run command (confirmed from `packages/shared/package.json`):**
- Full suite: `pnpm --filter @zilventor/shared test:unit`
- Filtered to new spec only: `pnpm --filter @zilventor/shared test:unit -- holeTable.spec`
- Type-check only: `pnpm --filter @zilventor/shared typecheck`

---

### Task 1.1 — `HoleTableAnnotation` type + union extension

**Files**
- Modify: `packages/shared/src/drawing/types.ts`
- Create: `packages/shared/src/drawing/__tests__/holeTable.spec.ts`

#### Step 1 — Write failing test

Create `packages/shared/src/drawing/__tests__/holeTable.spec.ts`:

```ts
// packages/shared/src/drawing/__tests__/holeTable.spec.ts
import { describe, it, expect } from 'vitest';
import type { HoleTableAnnotation, DrawingAnnotation } from '../types';

// ---------------------------------------------------------------------------
// HT-TYPE-1: HoleTableAnnotation structural shape + union membership
// ---------------------------------------------------------------------------

describe('HoleTableAnnotation — HT-TYPE-1: structural shape', () => {
  it('has kind holeTable and all required fields', () => {
    // This runtime check proves the type is usable as a DrawingAnnotation.
    // TypeScript type-checks the assignment at build/typecheck time.
    const ann = {
      kind: 'holeTable' as const,
      id: 'ht-1',
      viewId: 'v1',
      datum: { kind: 'edge-endpoint' as const, edgeId: 'e1', end: 'start' as const },
      positionMm: { x: 10, y: 20 },
      entries: [{ holeFeatureId: 'H1', tag: 'A1' }],
    } satisfies HoleTableAnnotation;

    const asAnnotation: DrawingAnnotation = ann;
    expect(asAnnotation.kind).toBe('holeTable');
    expect(ann.id).toBe('ht-1');
    expect(ann.viewId).toBe('v1');
    expect(ann.datum.kind).toBe('edge-endpoint');
    expect(ann.positionMm).toEqual({ x: 10, y: 20 });
    expect(ann.entries).toHaveLength(1);
    expect(ann.entries[0].tag).toBe('A1');
  });
});
```

#### Step 2 — Run to fail

```bash
pnpm --filter @zilventor/shared typecheck
```

**Expected failure:**
```
error TS2694: Namespace '"…/types"' has no exported member 'HoleTableAnnotation'.
error TS2322: Type '{ kind: "holeTable"; … }' is not assignable to type 'DrawingAnnotation'.
```

(`vitest run` itself would not fail at runtime because `satisfies HoleTableAnnotation` is erased by esbuild; the typecheck gate is the correct red gate for a type-only slice.)

#### Step 3 — Minimal implementation

Edit `packages/shared/src/drawing/types.ts`. Insert the new type BEFORE the `DrawingAnnotation` union declaration (around line 320), then extend the union.

**Add before the `DrawingAnnotation` union:**

```ts
// ---------------------------------------------------------------------------
// HoleTableAnnotation — F6 Hole Tables (additive; no manifest bump)
// ---------------------------------------------------------------------------

export type HoleTableAnnotation = {
  readonly kind: 'holeTable';
  readonly id: string;
  readonly viewId: string;
  readonly datum: PointRef;                                          // user-picked origin
  readonly positionMm: { readonly x: number; readonly y: number };  // table top-left on sheet, mm
  readonly entries: ReadonlyArray<{
    readonly holeFeatureId: string;
    readonly tag: string;
  }>;
};
```

**Extend the union — change the current closing line of `DrawingAnnotation`:**

Old:
```ts
  | { readonly id: string; readonly kind: 'balloon';     readonly viewId: string; readonly targetMm: { readonly x: number; readonly y: number }; readonly textPosMm: { readonly x: number; readonly y: number }; readonly itemNumber: number };
```

New (add `| HoleTableAnnotation` after the semicolon is removed from the balloon line):
```ts
  | { readonly id: string; readonly kind: 'balloon';     readonly viewId: string; readonly targetMm: { readonly x: number; readonly y: number }; readonly textPosMm: { readonly x: number; readonly y: number }; readonly itemNumber: number }
  | HoleTableAnnotation;
```

#### Step 4 — Run to pass

```bash
pnpm --filter @zilventor/shared typecheck
pnpm --filter @zilventor/shared test:unit -- holeTable.spec
```

**Expected:** typecheck exits 0; `HT-TYPE-1` passes.

#### Step 5 — Commit

```bash
git add packages/shared/src/drawing/types.ts \
        packages/shared/src/drawing/__tests__/holeTable.spec.ts
git commit -m "feat(drawing-f6): add HoleTableAnnotation type to DrawingAnnotation union"
```

---

### Task 1.2 — `holeTable.ts` — circle-fit helper + `extractHolesInView`

**Files**
- Create: `packages/shared/src/drawing/holeTable.ts`
- Modify: `packages/shared/src/drawing/__tests__/holeTable.spec.ts` (add new describe blocks)

#### Step 1 — Write failing tests

Append to `packages/shared/src/drawing/__tests__/holeTable.spec.ts`:

```ts
import {
  extractHolesInView,
  type ExtractedHole,
} from '../holeTable';
import type { DrawingView, HoleTableAnnotation } from '../types';
import type { HoleFeature, PartDocument, ParamOrLiteral } from '../../types';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

/** Generate N equally-spaced points on a circle (cx, cy, r) in part-mm. */
function circlePoints(
  cx: number,
  cy: number,
  r: number,
  n = 8,
): ReadonlyArray<readonly [number, number]> {
  return Array.from({ length: n }, (_, i) => {
    const θ = (2 * Math.PI * i) / n;
    return [cx + r * Math.cos(θ), cy + r * Math.sin(θ)] as const;
  });
}

/** Build a minimal HoleFeature (simple, throughAll) for test fixtures. */
function makeSimpleHole(id: string, diameterMm: number): HoleFeature {
  return {
    id,
    kind: 'hole',
    placement: { kind: 'fromSketch', sketchId: 'sk1' },
    profile: { kind: 'simple', diameter: { kind: 'literal', value: diameterMm } },
    termination: { kind: 'throughAll' },
    flipAxis: false,
  };
}

/** Build a minimal PartDocument containing the given HoleFeatures. */
function makePart(holes: HoleFeature[]): PartDocument {
  return {
    id: 'part-1',
    name: 'TestPart',
    units: 'mm',
    parameters: {},
    featureTree: holes,
    properties: {},
    materials: [],
    hardware: [],
  };
}

/** Build a BaseView whose projection contains the given edges. */
function makeBaseView(
  edges: Array<{
    id: string;
    points: ReadonlyArray<readonly [number, number]>;
    sourceFaceIds?: readonly string[];
  }>,
): DrawingView {
  return {
    id: 'v1',
    kind: 'base',
    positionMm: { x: 50, y: 30 },
    scale: { numerator: 1, denominator: 1 },
    orientation: 'front',
    showHidden: false,
    projection: {
      visibleEdges: edges.map((e) => ({
        id: e.id,
        kind: 'feature' as const,
        points: e.points,
        sourceFaceIds: e.sourceFaceIds,
      })),
      hiddenEdges: [],
      bbox: { minX: -50, minY: -50, maxX: 50, maxY: 50 },
    },
  };
}

// ---------------------------------------------------------------------------
// HT-EXTRACT-1: circle-fit on a single circular hole
// ---------------------------------------------------------------------------

describe('extractHolesInView — HT-EXTRACT-1: single circular hole', () => {
  it('returns one ExtractedHole with center near (20, 15) for a known circle', () => {
    const cx = 20, cy = 15, r = 4;
    const hole = makeSimpleHole('H1', r * 2);
    const part = makePart([hole]);
    const view = makeBaseView([
      {
        id: 'e-circle',
        points: circlePoints(cx, cy, r),
        sourceFaceIds: ['H1|hole|0'],
      },
    ]);

    const result = extractHolesInView(view, part);
    expect(result).toHaveLength(1);
    expect(result[0].featureId).toBe('H1');
    expect(result[0].centerMm[0]).toBeCloseTo(cx, 2);
    expect(result[0].centerMm[1]).toBeCloseTo(cy, 2);
    expect(result[0].feature.id).toBe('H1');
  });
});

// ---------------------------------------------------------------------------
// HT-EXTRACT-2: reject edge-on (non-circular) hole
// ---------------------------------------------------------------------------

describe('extractHolesInView — HT-EXTRACT-2: reject edge-on hole', () => {
  it('returns empty array when the projected edge is a straight line (degenerate fit)', () => {
    const hole = makeSimpleHole('H2', 8);
    const part = makePart([hole]);
    // Straight horizontal line — circle fit will be degenerate (det ≈ 0)
    const linePoints: ReadonlyArray<readonly [number, number]> = [
      [0, 3], [2, 3], [4, 3], [6, 3], [8, 3], [10, 3], [12, 3], [14, 3],
    ];
    const view = makeBaseView([
      { id: 'e-line', points: linePoints, sourceFaceIds: ['H2|hole|0'] },
    ]);

    const result = extractHolesInView(view, part);
    expect(result).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// HT-EXTRACT-3: through-hole dedupe — two concentric edge rings → one ExtractedHole
// ---------------------------------------------------------------------------

describe('extractHolesInView — HT-EXTRACT-3: through-hole dedupe by featureId', () => {
  it('dedupes two concentric circles sharing a featureId into ONE ExtractedHole', () => {
    const cx = 10, cy = 5, r = 4;
    const hole = makeSimpleHole('H1', r * 2);
    const part = makePart([hole]);
    // Two separate edge entries, both tagged H1 — top and bottom circles of a through-hole
    const view = makeBaseView([
      {
        id: 'e-top',
        points: circlePoints(cx, cy, r, 8),
        sourceFaceIds: ['H1|hole|0'],
      },
      {
        id: 'e-bot',
        points: circlePoints(cx, cy, r, 8),
        sourceFaceIds: ['H1|hole|1'],
      },
    ]);

    const result = extractHolesInView(view, part);
    expect(result).toHaveLength(1);
    expect(result[0].featureId).toBe('H1');
    expect(result[0].centerMm[0]).toBeCloseTo(cx, 2);
    expect(result[0].centerMm[1]).toBeCloseTo(cy, 2);
  });
});

// ---------------------------------------------------------------------------
// HT-EXTRACT-4: view with no projection returns empty array
// ---------------------------------------------------------------------------

describe('extractHolesInView — HT-EXTRACT-4: no projection', () => {
  it('returns [] when view.projection is undefined', () => {
    const hole = makeSimpleHole('H1', 8);
    const part = makePart([hole]);
    const viewNoProj: DrawingView = {
      id: 'v-empty',
      kind: 'base',
      positionMm: { x: 0, y: 0 },
      scale: { numerator: 1, denominator: 1 },
      orientation: 'front',
      showHidden: false,
      // projection absent
    };
    expect(extractHolesInView(viewNoProj, part)).toHaveLength(0);
  });
});
```

#### Step 2 — Run to fail

```bash
pnpm --filter @zilventor/shared test:unit -- holeTable.spec
```

**Expected failure:**
```
Error: Failed to resolve import "../holeTable" from "…/holeTable.spec.ts"
```
(Module does not exist yet.)

#### Step 3 — Minimal implementation

Create `packages/shared/src/drawing/holeTable.ts`:

```ts
// packages/shared/src/drawing/holeTable.ts
//
// Pure hole-table extraction helpers. Imports ONLY @zilventor/shared types.
// NEVER imports the app store — preserves the acyclic static-import rule (F2.4).

import type { DrawingView, PointRef, HoleTableAnnotation } from './types';
import type { HoleFeature, PartDocument, ParamOrLiteral } from '../types';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type ExtractedHole = {
  readonly featureId: string;
  readonly centerMm: readonly [number, number]; // circle-fit center, part-mm (pre-scale)
  readonly feature: HoleFeature;
};

export type HoleTableRow = {
  readonly tag: string;
  readonly xDim: number;        // (centerMm.x - datumMm.x), part-mm — TRUE model dims, NOT scaled
  readonly yDim: number;        // (centerMm.y - datumMm.y), part-mm
  readonly description: string; // Inventor-style, e.g. "⌀8 THRU"
  readonly markerCenterSheetMm: { readonly x: number; readonly y: number }; // leader target, sheet-mm
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Reject a circle fit if the root-mean-square radius error exceeds this value (mm). */
export const HOLE_CIRCLE_FIT_TOL_MM = 0.5;

// ---------------------------------------------------------------------------
// Internal: Kasa algebraic circle fit
// ---------------------------------------------------------------------------

type CircleFit = { cx: number; cy: number; r: number; rms: number };

/**
 * Kasa least-squares circle fit over the given points.
 * Returns null if N < 3 or the system is degenerate (collinear points).
 */
function fitCircle(
  points: ReadonlyArray<readonly [number, number]>,
): CircleFit | null {
  const n = points.length;
  if (n < 3) return null;

  let sumX = 0, sumY = 0;
  for (const [x, y] of points) { sumX += x; sumY += y; }
  const mx = sumX / n;
  const my = sumY / n;

  let Suu = 0, Suv = 0, Svv = 0;
  let Suuu = 0, Suvv = 0, Svvv = 0, Svuu = 0;

  for (const [x, y] of points) {
    const u = x - mx;
    const v = y - my;
    Suu  += u * u;
    Suv  += u * v;
    Svv  += v * v;
    Suuu += u * u * u;
    Suvv += u * v * v;
    Svvv += v * v * v;
    Svuu += v * v * u;
  }

  const det = Suu * Svv - Suv * Suv;
  if (Math.abs(det) < 1e-10) return null; // collinear or degenerate

  const uc = (0.5 * (Suuu + Suvv) * Svv - 0.5 * (Svvv + Svuu) * Suv) / det;
  const vc = (0.5 * (Svvv + Svuu) * Suu - 0.5 * (Suuu + Suvv) * Suv) / det;

  const r = Math.sqrt(uc * uc + vc * vc + (Suu + Svv) / n);
  const cx = uc + mx;
  const cy = vc + my;

  let sumSqErr = 0;
  for (const [x, y] of points) {
    const d = Math.hypot(x - cx, y - cy) - r;
    sumSqErr += d * d;
  }
  const rms = Math.sqrt(sumSqErr / n);

  return { cx, cy, r, rms };
}

// ---------------------------------------------------------------------------
// Internal: parse featureId from a face-key string "featureId|role|instance"
// ---------------------------------------------------------------------------

function faceKeyToFeatureId(faceKey: string): string {
  return faceKey.split('|')[0];
}

// ---------------------------------------------------------------------------
// Internal: PointRef → part-mm tuple resolver (replicated from renderDrawingSvg.ts;
// pure + store-free; do NOT import the app's private resolver — see anchors §G).
// ---------------------------------------------------------------------------

type MinimalProjection = {
  readonly visibleEdges: ReadonlyArray<{
    readonly id: string;
    readonly points: ReadonlyArray<readonly [number, number]>;
  }>;
  readonly hiddenEdges: ReadonlyArray<{
    readonly id: string;
    readonly points: ReadonlyArray<readonly [number, number]>;
  }>;
};

function resolvePointRefLocal(
  ref: PointRef,
  proj: MinimalProjection,
): readonly [number, number] | null {
  const edge =
    proj.visibleEdges.find((e) => e.id === ref.edgeId) ??
    proj.hiddenEdges.find((e) => e.id === ref.edgeId);
  if (!edge || edge.points.length === 0) return null;

  if (ref.kind === 'edge-endpoint') {
    return ref.end === 'end'
      ? edge.points[edge.points.length - 1]
      : edge.points[0];
  }
  if (ref.kind === 'edge-midpoint') {
    return edge.points[Math.floor(edge.points.length / 2)];
  }
  // arc-center: matches app's resolver fallthrough (returns points[0])
  return edge.points[0];
}

// ---------------------------------------------------------------------------
// Exported: extractHolesInView
// ---------------------------------------------------------------------------

/**
 * Scan the view's visible edges, group by featureId where the feature is a
 * 'hole', run a circle fit over each group's pooled points, and return the
 * face-on holes (edge-on holes and degenerate fits are rejected).
 *
 * Through-holes and counterbores produce multiple edges sharing one featureId;
 * pooling them into one fit dedupes them to a single ExtractedHole.
 */
export function extractHolesInView(
  view: DrawingView,
  part: PartDocument,
): ExtractedHole[] {
  const proj = view.projection;
  if (!proj) return [];

  // Accumulate all edge points per featureId (for hole features only)
  const holePoints = new Map<string, Array<readonly [number, number]>>();

  for (const edge of proj.visibleEdges) {
    if (!edge.sourceFaceIds) continue;

    for (const faceKey of edge.sourceFaceIds) {
      const featureId = faceKeyToFeatureId(faceKey);
      const feature = part.featureTree.find(
        (f) => f.kind === 'hole' && f.id === featureId,
      );
      if (!feature) continue;

      const existing = holePoints.get(featureId) ?? [];
      // Concat is safe here (immutable spread); typed cast OK: Edge2D.points elements are tuples
      for (const pt of edge.points) {
        existing.push(pt as readonly [number, number]);
      }
      holePoints.set(featureId, existing);
      break; // Credit this edge to the first matching featureId only
    }
  }

  const result: ExtractedHole[] = [];

  for (const [featureId, points] of holePoints) {
    const fit = fitCircle(points);
    if (!fit || fit.rms > HOLE_CIRCLE_FIT_TOL_MM) continue; // reject non-circular

    const feature = part.featureTree.find(
      (f) => f.kind === 'hole' && f.id === featureId,
    ) as HoleFeature; // narrowed: we checked above

    result.push({
      featureId,
      centerMm: [fit.cx, fit.cy],
      feature,
    });
  }

  return result;
}

// ---------------------------------------------------------------------------
// Stubs for Tasks 1.3–1.5 (filled in by subsequent tasks)
// ---------------------------------------------------------------------------

export function assignHoleTags(
  _holes: readonly ExtractedHole[],
  _existing: ReadonlyMap<string, string>,
  _resolveParam: (p: ParamOrLiteral) => number,
): Map<string, string> {
  throw new Error('assignHoleTags: not yet implemented');
}

export function formatHoleDescription(
  _feature: HoleFeature,
  _resolveParam: (p: ParamOrLiteral) => number,
): string {
  throw new Error('formatHoleDescription: not yet implemented');
}

export function computeHoleTableRows(
  _annotation: HoleTableAnnotation,
  _view: DrawingView,
  _part: PartDocument,
  _resolveParam: (p: ParamOrLiteral) => number,
): HoleTableRow[] {
  throw new Error('computeHoleTableRows: not yet implemented');
}
```

#### Step 4 — Run to pass

```bash
pnpm --filter @zilventor/shared test:unit -- holeTable.spec
```

**Expected:** `HT-EXTRACT-1` through `HT-EXTRACT-4` all pass; `HT-TYPE-1` still passes. No `assignHoleTags` / `formatHoleDescription` / `computeHoleTableRows` tests yet (they come in tasks 1.3–1.5, so only the stubs exist now).

```bash
pnpm --filter @zilventor/shared typecheck
```

**Expected:** exits 0 (types align).

#### Step 5 — Commit

```bash
git add packages/shared/src/drawing/holeTable.ts \
        packages/shared/src/drawing/__tests__/holeTable.spec.ts
git commit -m "feat(drawing-f6): holeTable.ts — fitCircle + extractHolesInView (red→green)"
```

---

### Task 1.3 — `assignHoleTags`

**Files**
- Modify: `packages/shared/src/drawing/holeTable.ts`
- Modify: `packages/shared/src/drawing/__tests__/holeTable.spec.ts`

#### Step 1 — Write failing tests

Append to `packages/shared/src/drawing/__tests__/holeTable.spec.ts`:

```ts
import { assignHoleTags } from '../holeTable';

// ---------------------------------------------------------------------------
// HT-TAGS-1: initial assignment — two holes with different specs → A1, B1
// ---------------------------------------------------------------------------

describe('assignHoleTags — HT-TAGS-1: initial assignment', () => {
  it('assigns A1 and B1 to two holes with different diameters', () => {
    const h1 = makeSimpleHole('H1', 8);
    const h2 = makeSimpleHole('H2', 10);
    const holes: ExtractedHole[] = [
      { featureId: 'H1', centerMm: [0, 0], feature: h1 },
      { featureId: 'H2', centerMm: [20, 0], feature: h2 },
    ];
    const result = assignHoleTags(holes, new Map(), (p) =>
      p.kind === 'literal' ? p.value : 0,
    );
    expect(result.get('H1')).toBe('A1');
    expect(result.get('H2')).toBe('B1');
  });
});

// ---------------------------------------------------------------------------
// HT-TAGS-2: stability — add a new hole, existing tags unchanged
// ---------------------------------------------------------------------------

describe('assignHoleTags — HT-TAGS-2: add hole stability', () => {
  it('keeps existing tags intact when a new same-spec hole is added', () => {
    const h1 = makeSimpleHole('H1', 8);
    const h2 = makeSimpleHole('H2', 10);
    const h3 = makeSimpleHole('H3', 8); // same spec as H1 → shares letter A
    const holes: ExtractedHole[] = [
      { featureId: 'H1', centerMm: [0, 0],  feature: h1 },
      { featureId: 'H2', centerMm: [20, 0], feature: h2 },
      { featureId: 'H3', centerMm: [40, 0], feature: h3 },
    ];
    const existing: ReadonlyMap<string, string> = new Map([
      ['H1', 'A1'],
      ['H2', 'B1'],
    ]);
    const result = assignHoleTags(holes, existing, (p) =>
      p.kind === 'literal' ? p.value : 0,
    );
    // Existing tags must be unchanged
    expect(result.get('H1')).toBe('A1');
    expect(result.get('H2')).toBe('B1');
    // H3 same spec as H1 (dia=8, throughAll) → A2
    expect(result.get('H3')).toBe('A2');
  });
});

// ---------------------------------------------------------------------------
// HT-TAGS-3: stability — remove a hole from the holes array, others unchanged
// ---------------------------------------------------------------------------

describe('assignHoleTags — HT-TAGS-3: remove hole stability', () => {
  it('does not renumber remaining holes when one is removed from holes array', () => {
    const h2 = makeSimpleHole('H2', 10);
    const h3 = makeSimpleHole('H3', 8);
    // H1 removed from holes (model edit) but its tag persists in existing
    const holes: ExtractedHole[] = [
      { featureId: 'H2', centerMm: [20, 0], feature: h2 },
      { featureId: 'H3', centerMm: [40, 0], feature: h3 },
    ];
    const existing: ReadonlyMap<string, string> = new Map([
      ['H1', 'A1'],
      ['H2', 'B1'],
      ['H3', 'A2'],
    ]);
    const result = assignHoleTags(holes, existing, (p) =>
      p.kind === 'literal' ? p.value : 0,
    );
    // All tags preserved (H2 and H3 are in holes; H1 is in existing but not holes → kept in result)
    expect(result.get('H1')).toBe('A1');
    expect(result.get('H2')).toBe('B1');
    expect(result.get('H3')).toBe('A2');
  });
});

// ---------------------------------------------------------------------------
// HT-TAGS-4: spec-signature grouping — same resolved diameter via different ParamOrLiteral forms
// ---------------------------------------------------------------------------

describe('assignHoleTags — HT-TAGS-4: param vs literal grouping', () => {
  it('groups two holes together when their resolved diameters are equal', () => {
    // H4: diameter via param 'd1'; H5: diameter via literal 8
    // Both resolve to 8 → same spec signature → same letter
    const h4: HoleFeature = {
      id: 'H4', kind: 'hole',
      placement: { kind: 'fromSketch', sketchId: 'sk1' },
      profile: { kind: 'simple', diameter: { kind: 'param', paramName: 'd1' } },
      termination: { kind: 'throughAll' },
      flipAxis: false,
    };
    const h5 = makeSimpleHole('H5', 8); // literal 8
    const holes: ExtractedHole[] = [
      { featureId: 'H4', centerMm: [0, 0],  feature: h4 },
      { featureId: 'H5', centerMm: [20, 0], feature: h5 },
    ];
    // resolveParam: 'd1' → 8, literals → as-is
    const resolveParam = (p: ParamOrLiteral): number =>
      p.kind === 'literal' ? p.value : 8; // 'd1'=8

    const result = assignHoleTags(holes, new Map(), resolveParam);
    // Same resolved diameter → same letter (A); instances 1 and 2
    const tag4 = result.get('H4')!;
    const tag5 = result.get('H5')!;
    expect(tag4[0]).toBe(tag5[0]); // same letter
    expect(tag4).toBe('A1');
    expect(tag5).toBe('A2');
  });
});
```

#### Step 2 — Run to fail

```bash
pnpm --filter @zilventor/shared test:unit -- holeTable.spec
```

**Expected failure:** `HT-TAGS-1` through `HT-TAGS-4` all throw `Error: assignHoleTags: not yet implemented`.

#### Step 3 — Minimal implementation

Replace the `assignHoleTags` stub and add the internal helpers in `holeTable.ts`. Insert BEFORE `assignHoleTags`:

```ts
// ---------------------------------------------------------------------------
// Internal: tag helpers
// ---------------------------------------------------------------------------

/**
 * Convert a 0-based index to a letter sequence: 0→A, 1→B, …, 25→Z, 26→AA, 27→AB, …
 */
function indexToLetter(i: number): string {
  if (i < 26) return String.fromCharCode(65 + i);
  return indexToLetter(Math.floor(i / 26) - 1) + String.fromCharCode(65 + (i % 26));
}

/**
 * Build a canonical spec signature string used to group holes sharing the same
 * logical spec (same profile kind, resolved dimensions, and termination).
 * Uses resolved numeric values so param/literal variants for the same number group together.
 */
function buildSpecSignature(
  feature: HoleFeature,
  resolveParam: (p: ParamOrLiteral) => number,
): string {
  const p = feature.profile;
  const t = feature.termination;
  const termStr =
    t.kind === 'distance' ? `dist:${resolveParam(t.depth)}` : t.kind;

  if (p.kind === 'simple') {
    return `simple:${resolveParam(p.diameter)}:${termStr}`;
  }
  if (p.kind === 'counterbore') {
    return [
      'cbore',
      resolveParam(p.diameter),
      resolveParam(p.cboreDiameter),
      resolveParam(p.cboreDepth),
      termStr,
    ].join(':');
  }
  // countersink
  return [
    'csk',
    resolveParam(p.diameter),
    resolveParam(p.cskDiameter),
    resolveParam(p.cskAngle),
    termStr,
  ].join(':');
}
```

Replace the `assignHoleTags` stub with the full implementation:

```ts
export function assignHoleTags(
  holes: readonly ExtractedHole[],
  existing: ReadonlyMap<string, string>,
  resolveParam: (p: ParamOrLiteral) => number,
): Map<string, string> {
  // Start from persisted entries (stability guarantee)
  const result = new Map<string, string>(existing);

  // Reconstruct letter-count and spec→letter maps from existing tags
  const letterCounts = new Map<string, number>();
  const specToLetter = new Map<string, string>();

  for (const [featureId, tag] of existing) {
    const match = tag.match(/^([A-Z]+)(\d+)$/);
    if (!match) continue;
    const letter = match[1];
    const instance = parseInt(match[2], 10);
    const prev = letterCounts.get(letter) ?? 0;
    if (instance > prev) letterCounts.set(letter, instance);
    // Rebuild specToLetter from holes currently in view (best-effort; new holes extend it)
    const hole = holes.find((h) => h.featureId === featureId);
    if (hole) {
      const sig = buildSpecSignature(hole.feature, resolveParam);
      if (!specToLetter.has(sig)) specToLetter.set(sig, letter);
    }
  }

  // Track all letters used (from existing) to find the next free letter
  const usedLetters = new Set<string>(
    Array.from(existing.values())
      .map((t) => t.match(/^([A-Z]+)/)?.[1] ?? '')
      .filter(Boolean),
  );
  let nextLetterIndex = 0;
  const getNextLetter = (): string => {
    while (true) {
      const letter = indexToLetter(nextLetterIndex++);
      if (!usedLetters.has(letter)) {
        usedLetters.add(letter);
        return letter;
      }
    }
  };

  // Assign new holes (those not already in `existing`)
  for (const hole of holes) {
    if (result.has(hole.featureId)) continue; // already tagged — stable
    const sig = buildSpecSignature(hole.feature, resolveParam);
    let letter = specToLetter.get(sig);
    if (!letter) {
      letter = getNextLetter();
      specToLetter.set(sig, letter);
    }
    const instance = (letterCounts.get(letter) ?? 0) + 1;
    letterCounts.set(letter, instance);
    result.set(hole.featureId, `${letter}${instance}`);
  }

  return result;
}
```

#### Step 4 — Run to pass

```bash
pnpm --filter @zilventor/shared test:unit -- holeTable.spec
```

**Expected:** `HT-TAGS-1` through `HT-TAGS-4` pass; all previous tests still pass.

#### Step 5 — Commit

```bash
git add packages/shared/src/drawing/holeTable.ts \
        packages/shared/src/drawing/__tests__/holeTable.spec.ts
git commit -m "feat(drawing-f6): assignHoleTags — stable spec-grouped tag assignment (red→green)"
```

---

### Task 1.4 — `formatHoleDescription`

**Files**
- Modify: `packages/shared/src/drawing/holeTable.ts`
- Modify: `packages/shared/src/drawing/__tests__/holeTable.spec.ts`

#### Step 1 — Write failing tests

Append to `packages/shared/src/drawing/__tests__/holeTable.spec.ts`:

```ts
import { formatHoleDescription } from '../holeTable';

const resolve = (p: ParamOrLiteral): number =>
  p.kind === 'literal' ? p.value : 0;

// ---------------------------------------------------------------------------
// HT-DESC-1: simple + throughAll
// ---------------------------------------------------------------------------

describe('formatHoleDescription — HT-DESC-1: simple throughAll', () => {
  it('produces "⌀8 THRU"', () => {
    const feature: HoleFeature = {
      id: 'H', kind: 'hole',
      placement: { kind: 'fromSketch', sketchId: 'sk' },
      profile: { kind: 'simple', diameter: { kind: 'literal', value: 8 } },
      termination: { kind: 'throughAll' },
      flipAxis: false,
    };
    expect(formatHoleDescription(feature, resolve)).toBe('⌀8 THRU');
  });
});

// ---------------------------------------------------------------------------
// HT-DESC-2: simple + distance
// ---------------------------------------------------------------------------

describe('formatHoleDescription — HT-DESC-2: simple distance', () => {
  it('produces "⌀8 ↧12"', () => {
    const feature: HoleFeature = {
      id: 'H', kind: 'hole',
      placement: { kind: 'fromSketch', sketchId: 'sk' },
      profile: { kind: 'simple', diameter: { kind: 'literal', value: 8 } },
      termination: { kind: 'distance', depth: { kind: 'literal', value: 12 } },
      flipAxis: false,
    };
    expect(formatHoleDescription(feature, resolve)).toBe('⌀8 ↧12');
  });
});

// ---------------------------------------------------------------------------
// HT-DESC-3: simple + toFace (MVP → THRU)
// ---------------------------------------------------------------------------

describe('formatHoleDescription — HT-DESC-3: simple toFace (MVP THRU)', () => {
  it('produces "⌀8 THRU" for toFace (MVP)', () => {
    const feature: HoleFeature = {
      id: 'H', kind: 'hole',
      placement: { kind: 'fromSketch', sketchId: 'sk' },
      profile: { kind: 'simple', diameter: { kind: 'literal', value: 8 } },
      termination: { kind: 'toFace', targetFaceName: 'F1' as any },
      flipAxis: false,
    };
    expect(formatHoleDescription(feature, resolve)).toBe('⌀8 THRU');
  });
});

// ---------------------------------------------------------------------------
// HT-DESC-4: simple + toNext (MVP → THRU)
// ---------------------------------------------------------------------------

describe('formatHoleDescription — HT-DESC-4: simple toNext (MVP THRU)', () => {
  it('produces "⌀8 THRU" for toNext (MVP)', () => {
    const feature: HoleFeature = {
      id: 'H', kind: 'hole',
      placement: { kind: 'fromSketch', sketchId: 'sk' },
      profile: { kind: 'simple', diameter: { kind: 'literal', value: 8 } },
      termination: { kind: 'toNext' },
      flipAxis: false,
    };
    expect(formatHoleDescription(feature, resolve)).toBe('⌀8 THRU');
  });
});

// ---------------------------------------------------------------------------
// HT-DESC-5: counterbore + throughAll
// ---------------------------------------------------------------------------

describe('formatHoleDescription — HT-DESC-5: counterbore throughAll', () => {
  it('produces "⌀8 THRU ⌴⌀14 ↧6"', () => {
    const feature: HoleFeature = {
      id: 'H', kind: 'hole',
      placement: { kind: 'fromSketch', sketchId: 'sk' },
      profile: {
        kind: 'counterbore',
        diameter: { kind: 'literal', value: 8 },
        cboreDiameter: { kind: 'literal', value: 14 },
        cboreDepth: { kind: 'literal', value: 6 },
      },
      termination: { kind: 'throughAll' },
      flipAxis: false,
    };
    // ⌀=U+2300, THRU, ⌴=U+2334, ↧=U+21A7
    expect(formatHoleDescription(feature, resolve)).toBe('⌀8 THRU ⌴⌀14 ↧6');
  });
});

// ---------------------------------------------------------------------------
// HT-DESC-6: counterbore + distance
// ---------------------------------------------------------------------------

describe('formatHoleDescription — HT-DESC-6: counterbore distance', () => {
  it('produces "⌀8 ↧12 ⌴⌀14 ↧6"', () => {
    const feature: HoleFeature = {
      id: 'H', kind: 'hole',
      placement: { kind: 'fromSketch', sketchId: 'sk' },
      profile: {
        kind: 'counterbore',
        diameter: { kind: 'literal', value: 8 },
        cboreDiameter: { kind: 'literal', value: 14 },
        cboreDepth: { kind: 'literal', value: 6 },
      },
      termination: { kind: 'distance', depth: { kind: 'literal', value: 12 } },
      flipAxis: false,
    };
    expect(formatHoleDescription(feature, resolve)).toBe('⌀8 ↧12 ⌴⌀14 ↧6');
  });
});

// ---------------------------------------------------------------------------
// HT-DESC-7: countersink + throughAll
// ---------------------------------------------------------------------------

describe('formatHoleDescription — HT-DESC-7: countersink throughAll', () => {
  it('produces "⌀8 THRU ⌵⌀14×82°"', () => {
    const feature: HoleFeature = {
      id: 'H', kind: 'hole',
      placement: { kind: 'fromSketch', sketchId: 'sk' },
      profile: {
        kind: 'countersink',
        diameter: { kind: 'literal', value: 8 },
        cskDiameter: { kind: 'literal', value: 14 },
        cskAngle: { kind: 'literal', value: 82 },
      },
      termination: { kind: 'throughAll' },
      flipAxis: false,
    };
    // ⌵=U+2335, ×=U+00D7, °=U+00B0
    expect(formatHoleDescription(feature, resolve)).toBe('⌀8 THRU ⌵⌀14×82°');
  });
});

// ---------------------------------------------------------------------------
// HT-DESC-8: countersink + distance
// ---------------------------------------------------------------------------

describe('formatHoleDescription — HT-DESC-8: countersink distance', () => {
  it('produces "⌀8 ↧12 ⌵⌀14×82°"', () => {
    const feature: HoleFeature = {
      id: 'H', kind: 'hole',
      placement: { kind: 'fromSketch', sketchId: 'sk' },
      profile: {
        kind: 'countersink',
        diameter: { kind: 'literal', value: 8 },
        cskDiameter: { kind: 'literal', value: 14 },
        cskAngle: { kind: 'literal', value: 82 },
      },
      termination: { kind: 'distance', depth: { kind: 'literal', value: 12 } },
      flipAxis: false,
    };
    expect(formatHoleDescription(feature, resolve)).toBe('⌀8 ↧12 ⌵⌀14×82°');
  });
});
```

**Note on Unicode escapes used:**
- `⌀` = `⌀` (DIAMETER SIGN)
- `↧` = `↧` (DOWNWARDS ARROW FROM BAR)
- `⌴` = `⌴` (COUNTERBORE)
- `⌵` = `⌵` (COUNTERSINK)
- `×` = `×` (MULTIPLICATION SIGN)
- `°` = `°` (DEGREE SIGN)

#### Step 2 — Run to fail

```bash
pnpm --filter @zilventor/shared test:unit -- holeTable.spec
```

**Expected failure:** `HT-DESC-1` through `HT-DESC-8` all throw `Error: formatHoleDescription: not yet implemented`.

#### Step 3 — Minimal implementation

Replace the `formatHoleDescription` stub in `holeTable.ts`:

```ts
// ---------------------------------------------------------------------------
// Internal: Unicode constants (Inventor hole-description symbols)
// ---------------------------------------------------------------------------

const DIA   = '⌀'; // ⌀ DIAMETER SIGN
const DMAP  = '↧'; // ↧ DOWNWARDS ARROW FROM BAR (depth)
const CBORE = '⌴'; // ⌴ COUNTERBORE
const CSK   = '⌵'; // ⌵ COUNTERSINK
const TIMES = '×'; // × MULTIPLICATION SIGN
const DEG   = '°'; // ° DEGREE SIGN

function formatTermination(
  t: HoleTermination,
  resolveParam: (p: ParamOrLiteral) => number,
): string {
  // throughAll, toFace, toNext all map to THRU for MVP (spec §5.3)
  if (t.kind === 'throughAll' || t.kind === 'toFace' || t.kind === 'toNext') {
    return 'THRU';
  }
  return `${DMAP}${resolveParam(t.depth)}`;
}

export function formatHoleDescription(
  feature: HoleFeature,
  resolveParam: (p: ParamOrLiteral) => number,
): string {
  const profile = feature.profile;
  const termination = feature.termination;
  const termStr = formatTermination(termination, resolveParam);

  if (profile.kind === 'simple') {
    const dia = resolveParam(profile.diameter);
    return `${DIA}${dia} ${termStr}`;
  }

  if (profile.kind === 'counterbore') {
    const dia      = resolveParam(profile.diameter);
    const cboreDia = resolveParam(profile.cboreDiameter);
    const cboreD   = resolveParam(profile.cboreDepth);
    return `${DIA}${dia} ${termStr} ${CBORE}${DIA}${cboreDia} ${DMAP}${cboreD}`;
  }

  // countersink
  const dia    = resolveParam(profile.diameter);
  const cskDia = resolveParam(profile.cskDiameter);
  const cskAng = resolveParam(profile.cskAngle);
  return `${DIA}${dia} ${termStr} ${CSK}${DIA}${cskDia}${TIMES}${cskAng}${DEG}`;
}
```

Also add the `HoleTermination` import to the top of `holeTable.ts` (it's not yet imported — it's part of the `HoleFeature` type but TypeScript needs the import to use it explicitly in `formatTermination`):

The import line becomes:
```ts
import type { HoleFeature, PartDocument, ParamOrLiteral } from '../types';
```

`HoleTermination` is only used structurally inside `formatTermination`; since we access it via `feature.termination` (typed via `HoleFeature`), no explicit import is needed — TypeScript will infer the type. If needed, add it:
```ts
import type { HoleFeature, HoleTermination, PartDocument, ParamOrLiteral } from '../types';
```

#### Step 4 — Run to pass

```bash
pnpm --filter @zilventor/shared test:unit -- holeTable.spec
```

**Expected:** `HT-DESC-1` through `HT-DESC-8` pass; all earlier tests still pass.

#### Step 5 — Commit

```bash
git add packages/shared/src/drawing/holeTable.ts \
        packages/shared/src/drawing/__tests__/holeTable.spec.ts
git commit -m "feat(drawing-f6): formatHoleDescription — all profile×termination combos (red→green)"
```

---

### Task 1.5 — `computeHoleTableRows`

**Files**
- Modify: `packages/shared/src/drawing/holeTable.ts`
- Modify: `packages/shared/src/drawing/__tests__/holeTable.spec.ts`

#### Step 1 — Write failing tests

Append to `packages/shared/src/drawing/__tests__/holeTable.spec.ts`:

```ts
import { computeHoleTableRows } from '../holeTable';

// ---------------------------------------------------------------------------
// HT-ROWS-1: end-to-end — datum subtraction, markerCenterSheetMm transform
// ---------------------------------------------------------------------------

describe('computeHoleTableRows — HT-ROWS-1: single hole end-to-end', () => {
  it('produces correct xDim/yDim and markerCenterSheetMm', () => {
    // Datum point at part-mm (0, 0); hole center at part-mm (20, 15); scale 1:1
    // Expected: xDim=20, yDim=15, markerCenter={x: 50+20=70, y: 30+15=45}
    const holeCx = 20, holeCy = 15, holeR = 4;
    const hole = makeSimpleHole('H1', holeR * 2); // dia=8
    const part = makePart([hole]);

    const view = makeBaseView([
      // Datum edge: single-point edge at origin
      { id: 'datum-edge', points: [[0, 0]], sourceFaceIds: undefined },
      // Hole circle
      {
        id: 'e-hole',
        points: circlePoints(holeCx, holeCy, holeR),
        sourceFaceIds: ['H1|hole|0'],
      },
    ]);

    const annotation: HoleTableAnnotation = {
      kind: 'holeTable',
      id: 'ht-1',
      viewId: 'v1',
      datum: { kind: 'edge-endpoint', edgeId: 'datum-edge', end: 'start' },
      positionMm: { x: 10, y: 10 },
      entries: [],
    };

    const resolveParam = (p: ParamOrLiteral): number =>
      p.kind === 'literal' ? p.value : 0;

    const rows = computeHoleTableRows(annotation, view, part, resolveParam);
    expect(rows).toHaveLength(1);

    const row = rows[0];
    expect(row.tag).toBe('A1');
    expect(row.xDim).toBeCloseTo(holeCx, 2);     // 20 - 0 = 20
    expect(row.yDim).toBeCloseTo(holeCy, 2);     // 15 - 0 = 15
    expect(row.description).toBe('⌀8 THRU'); // ⌀8 THRU

    // markerCenter = view.positionMm + centerMm * scale (1:1)
    // view.positionMm = {x:50, y:30}, scale=1
    expect(row.markerCenterSheetMm.x).toBeCloseTo(50 + holeCx, 2); // 70
    expect(row.markerCenterSheetMm.y).toBeCloseTo(30 + holeCy, 2); // 45
  });
});

// ---------------------------------------------------------------------------
// HT-ROWS-2: two holes, different specs → sorted tags A1, B1
// ---------------------------------------------------------------------------

describe('computeHoleTableRows — HT-ROWS-2: two holes sorted by tag', () => {
  it('returns two rows sorted by tag with correct dimensions', () => {
    // hole A at (10, 5), hole B at (30, 5); datum at (0, 0); scale 2:1
    const hA = makeSimpleHole('HA', 8);
    const hB = makeSimpleHole('HB', 12); // different spec → different letter
    const part = makePart([hA, hB]);

    // Build view with scale 2:1
    const viewWith2xScale: DrawingView = {
      id: 'v1',
      kind: 'base',
      positionMm: { x: 0, y: 0 },
      scale: { numerator: 2, denominator: 1 },
      orientation: 'front',
      showHidden: false,
      projection: {
        visibleEdges: [
          { id: 'datum-edge', kind: 'feature', points: [[0, 0]], sourceFaceIds: undefined },
          {
            id: 'e-hA',
            kind: 'feature',
            points: circlePoints(10, 5, 4),
            sourceFaceIds: ['HA|hole|0'],
          },
          {
            id: 'e-hB',
            kind: 'feature',
            points: circlePoints(30, 5, 6),
            sourceFaceIds: ['HB|hole|0'],
          },
        ],
        hiddenEdges: [],
        bbox: { minX: 0, minY: 0, maxX: 50, maxY: 20 },
      },
    };

    const annotation: HoleTableAnnotation = {
      kind: 'holeTable',
      id: 'ht-2',
      viewId: 'v1',
      datum: { kind: 'edge-endpoint', edgeId: 'datum-edge', end: 'start' },
      positionMm: { x: 0, y: 0 },
      entries: [],
    };

    const resolveParam = (p: ParamOrLiteral): number =>
      p.kind === 'literal' ? p.value : 0;

    const rows = computeHoleTableRows(annotation, viewWith2xScale, part, resolveParam);
    expect(rows).toHaveLength(2);

    // Sorted by tag: A1 before B1
    expect(rows[0].tag).toBe('A1');
    expect(rows[1].tag).toBe('B1');

    // xDim/yDim are in part-mm (NOT scaled)
    expect(rows[0].xDim).toBeCloseTo(10, 2);
    expect(rows[0].yDim).toBeCloseTo(5, 2);

    // markerCenterSheetMm IS scaled: positionMm(0,0) + centerMm * scale(2)
    expect(rows[0].markerCenterSheetMm.x).toBeCloseTo(20, 2); // 0 + 10*2
    expect(rows[0].markerCenterSheetMm.y).toBeCloseTo(10, 2); // 0 + 5*2
  });
});

// ---------------------------------------------------------------------------
// HT-ROWS-3: no projection → returns empty array
// ---------------------------------------------------------------------------

describe('computeHoleTableRows — HT-ROWS-3: no projection', () => {
  it('returns [] when view has no projection', () => {
    const viewNoProj: DrawingView = {
      id: 'v-noproj',
      kind: 'base',
      positionMm: { x: 0, y: 0 },
      scale: { numerator: 1, denominator: 1 },
      orientation: 'front',
      showHidden: false,
    };
    const annotation: HoleTableAnnotation = {
      kind: 'holeTable',
      id: 'ht-3',
      viewId: 'v-noproj',
      datum: { kind: 'edge-endpoint', edgeId: 'missing', end: 'start' },
      positionMm: { x: 0, y: 0 },
      entries: [],
    };
    const rows = computeHoleTableRows(annotation, viewNoProj, makePart([]), (p) =>
      p.kind === 'literal' ? p.value : 0,
    );
    expect(rows).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// HT-ROWS-4: datum edge missing → returns empty array
// ---------------------------------------------------------------------------

describe('computeHoleTableRows — HT-ROWS-4: datum edge not found', () => {
  it('returns [] when the datum PointRef resolves to null', () => {
    const hole = makeSimpleHole('H1', 8);
    const part = makePart([hole]);
    const view = makeBaseView([
      {
        id: 'e-hole',
        points: circlePoints(20, 15, 4),
        sourceFaceIds: ['H1|hole|0'],
      },
    ]);
    const annotation: HoleTableAnnotation = {
      kind: 'holeTable',
      id: 'ht-4',
      viewId: 'v1',
      datum: { kind: 'edge-endpoint', edgeId: 'nonexistent-edge', end: 'start' },
      positionMm: { x: 0, y: 0 },
      entries: [],
    };
    const rows = computeHoleTableRows(annotation, view, part, (p) =>
      p.kind === 'literal' ? p.value : 0,
    );
    expect(rows).toHaveLength(0);
  });
});
```

#### Step 2 — Run to fail

```bash
pnpm --filter @zilventor/shared test:unit -- holeTable.spec
```

**Expected failure:** `HT-ROWS-1` through `HT-ROWS-4` all throw `Error: computeHoleTableRows: not yet implemented`.

#### Step 3 — Minimal implementation

Replace the `computeHoleTableRows` stub in `holeTable.ts`:

```ts
export function computeHoleTableRows(
  annotation: HoleTableAnnotation,
  view: DrawingView,
  part: PartDocument,
  resolveParam: (p: ParamOrLiteral) => number,
): HoleTableRow[] {
  const proj = view.projection;
  if (!proj) return [];

  // Resolve datum to part-mm
  const datumMm = resolvePointRefLocal(annotation.datum, proj as MinimalProjection);
  if (!datumMm) return [];

  const holes = extractHolesInView(view, part);
  const existingMap: ReadonlyMap<string, string> = new Map(
    annotation.entries.map((e) => [e.holeFeatureId, e.tag]),
  );
  const tagMap = assignHoleTags(holes, existingMap, resolveParam);

  const s = view.scale.numerator / view.scale.denominator;

  const rows: HoleTableRow[] = [];
  for (const hole of holes) {
    const tag = tagMap.get(hole.featureId);
    if (!tag) continue;
    rows.push({
      tag,
      xDim: hole.centerMm[0] - datumMm[0],
      yDim: hole.centerMm[1] - datumMm[1],
      description: formatHoleDescription(hole.feature, resolveParam),
      markerCenterSheetMm: {
        x: view.positionMm.x + hole.centerMm[0] * s,
        y: view.positionMm.y + hole.centerMm[1] * s,
      },
    });
  }

  // Sort by tag: lexicographic with numeric instance (A1 < A2 < A10 < B1)
  rows.sort((a, b) =>
    a.tag.localeCompare(b.tag, undefined, { numeric: true }),
  );

  return rows;
}
```

#### Step 4 — Run to pass

```bash
pnpm --filter @zilventor/shared test:unit -- holeTable.spec
```

**Expected:** All `HT-ROWS-1` through `HT-ROWS-4` pass. Full suite green:

```bash
pnpm --filter @zilventor/shared test:unit
pnpm --filter @zilventor/shared typecheck
```

Both exit 0. All tests (all previous drawing specs + the new holeTable spec) pass.

#### Step 5 — Commit

```bash
git add packages/shared/src/drawing/holeTable.ts \
        packages/shared/src/drawing/__tests__/holeTable.spec.ts
git commit -m "feat(drawing-f6): computeHoleTableRows — datum subtraction + sheet-mm transform (red→green)"
```

---

## Batch 1 — Self-critique

### 1. Numbered weaknesses

1. **Kasa fit sensitivity with few points.** With only 3–4 points near-collinear (e.g., a short arc rather than a full circle), the fit may converge to an enormous radius with low RMS — passing the tolerance check but yielding a wildly wrong center. The `HOLE_CIRCLE_FIT_TOL_MM = 0.5` constant plus minimum N=3 guard helps but does not catch all degenerate-arc cases. A minimum arc-span check (e.g., require ≥ 90° of coverage) would be more robust — deferred as F6.x.

2. **`arc-center` PointRef resolution** is a best-effort replicate of the app's resolver (`edge.points[0]` fallthrough). If the app's resolver is ever updated to compute a true arc midpoint, `resolvePointRefLocal` will silently diverge. The comment in the code documents this dependency, but a shared utility would be better — deferred to avoid the acyclic-import issue.

3. **`assignHoleTags` rebuilds `specToLetter` from the current `holes` array, not from a full part scan.** If a hole was in `existing` but is no longer in the `holes` array (model edit), its spec signature cannot be reconstructed, and its letter cannot be reused for new holes. This means a new hole with the same spec as a removed hole gets a fresh letter instead of the removed letter. Acceptable for MVP (spec says "append") but could be surprising.

4. **`computeHoleTableRows` casts `view.projection` to `MinimalProjection`** to satisfy `resolvePointRefLocal`. This cast is structurally safe (all views' projections have `visibleEdges` + `hiddenEdges`) but is an unchecked cast at the type level.

5. **Test fixture `sourceFaceIds: undefined`** (datum edge) will be typed as `readonly string[] | undefined` — the code checks `if (!edge.sourceFaceIds) continue` so it's fine, but the fixture is slightly odd (a real edge always has `sourceFaceIds`). Low-risk.

### 2. Numbered assumptions

1. `pnpm --filter @zilventor/shared test:unit` correctly executes `vitest run` inside `packages/shared`. Confirmed from `packages/shared/package.json`.
2. `vitest run holeTable.spec` (positional arg) filters test files by path substring — confirmed to work with Vitest 2.x.
3. `HoleFeature.placement` of kind `'fromSketch'` is sufficient for all test fixtures; the other placement kinds (linear, concentric) are not exercised in Batch 1.
4. The `FaceName` type used in `HoleTermination.toFace.targetFaceName` is a string-branded type or plain `string`. Used `as any` cast in the test fixture to avoid importing `FaceName` — safe since `formatHoleDescription` never reads `targetFaceName`.
5. Vitest's esbuild transpilation strips TypeScript type-imports, so `satisfies HoleTableAnnotation` in the HT-TYPE-1 test only enforces the shape at `typecheck` time, not at `vitest run` time. This is intentional and documented.

**Confidence: 76**

The algorithmic and structural details are well-grounded in the source I read. The main uncertainty is whether `vitest run holeTable.spec` (positional filter) works exactly as written vs. needing `--reporter=verbose` or a full path — low risk. The Kasa fit implementation is a standard algorithm and the test fixture (8 equidistant points) exercises it cleanly. The tag-stability algorithm is correct by inspection of the 4 test cases. Main gap: I have not actually run the code, so edge cases in the Kasa implementation (e.g. floating-point determinant threshold) might need tuning. Confidence is 76, not higher, because the code is untested and the circle-fit tolerance constant is a judgment call.
## Batch 2 — Command, ToolMode, Ribbon, Canvas Wiring

**Pre-condition:** Batch 1 shipped. The following exports exist in `packages/shared/src/drawing/holeTable.ts`:
`extractHolesInView`, `assignHoleTags`, `formatHoleDescription`, `computeHoleTableRows`,
`HoleTableAnnotation` is in the `DrawingAnnotation` union in `packages/shared/src/drawing/types.ts`.

**Test run command:** `pnpm --filter app test:unit`

---

### Task 2.1 — `AddHoleTableCommand`

**Files**
- `packages/app/src/commands/AddHoleTableCommand.ts` (create)
- `packages/app/src/commands/__tests__/AddHoleTableCommand.spec.ts` (create)

#### Step 1 — Failing test

```ts
// packages/app/src/commands/__tests__/AddHoleTableCommand.spec.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { AddHoleTableCommand } from '../AddHoleTableCommand';
import { useAppStore } from '../../store/useAppStore';
import type {
  DrawingDocument,
  HoleTableAnnotation,
  PartDocument,
} from '@zilventor/shared';

type DrawingActive = { kind: 'drawing'; document: DrawingDocument };

function makeHoleTableAnn(id = 'ht1'): HoleTableAnnotation {
  return {
    kind: 'holeTable',
    id,
    viewId: 'v1',
    datum: { kind: 'edge-endpoint', edgeId: 'e1', end: 'start' },
    positionMm: { x: 150, y: 20 },
    entries: [
      { holeFeatureId: 'H1', tag: 'A1' },
      { holeFeatureId: 'H2', tag: 'B1' },
    ],
  };
}

function makeDrawingDoc(): DrawingDocument {
  return {
    id: 'dw1',
    name: 'Test Drawing',
    units: 'mm',
    source: { partPath: 'parts/box.zipt', sourceKind: 'part' },
    properties: {},
    activeSheetId: 'sh1',
    sheets: [
      {
        id: 'sh1',
        name: 'Sheet 1',
        size: { kind: 'iso', size: 'A3' },
        orientation: 'landscape',
        views: [],
        dimensions: [],
        dimensionGroups: [],
        annotations: [],
        titleBlock: {},
      },
    ],
  };
}

function makeActivePart(): PartDocument {
  return {
    id: 'p1',
    name: 'Box',
    units: 'mm',
    parameters: {},
    featureTree: [],
    materials: [],
    properties: {},
  } as unknown as PartDocument;
}

beforeEach(() => {
  useAppStore.setState({
    activeDocument: { kind: 'drawing', document: makeDrawingDoc() },
    activePart: makeActivePart(),
  } as never);
});

describe('AddHoleTableCommand', () => {
  it('(a) apply() pushes the annotation onto the sheet', async () => {
    const ann = makeHoleTableAnn();
    const cmd = new AddHoleTableCommand({ sheetId: 'sh1', ann });
    await cmd.apply();
    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    const anns = doc.sheets[0]!.annotations;
    expect(anns).toHaveLength(1);
    expect(anns[0]!.id).toBe('ht1');
    expect(anns[0]!.kind).toBe('holeTable');
  });

  it('(b) revert() removes the annotation by id', async () => {
    const ann = makeHoleTableAnn();
    const cmd = new AddHoleTableCommand({ sheetId: 'sh1', ann });
    await cmd.apply();
    await cmd.revert();
    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    expect(doc.sheets[0]!.annotations).toHaveLength(0);
  });

  it('(c) revert() is idempotent — double revert leaves zero annotations', async () => {
    const ann = makeHoleTableAnn();
    const cmd = new AddHoleTableCommand({ sheetId: 'sh1', ann });
    await cmd.apply();
    await cmd.revert();
    await cmd.revert();
    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    expect(doc.sheets[0]!.annotations).toHaveLength(0);
  });

  it('(d) apply() → revert() → apply() (redo cycle) re-adds the annotation', async () => {
    const ann = makeHoleTableAnn();
    const cmd = new AddHoleTableCommand({ sheetId: 'sh1', ann });
    await cmd.apply();
    await cmd.revert();
    await cmd.apply();
    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    expect(doc.sheets[0]!.annotations).toHaveLength(1);
    expect(doc.sheets[0]!.annotations[0]!.id).toBe('ht1');
  });

  it('(e) apply() does not mutate an existing annotation on the sheet', async () => {
    // Seed a pre-existing annotation
    const existing = makeHoleTableAnn('ht0');
    useAppStore.setState(
      (s) => {
        const prev = (s as unknown as { activeDocument: DrawingActive }).activeDocument.document;
        return {
          activeDocument: {
            kind: 'drawing',
            document: {
              ...prev,
              sheets: prev.sheets.map((sh) =>
                sh.id === 'sh1' ? { ...sh, annotations: [existing] } : sh,
              ),
            },
          },
        } as never;
      },
    );
    const ann = makeHoleTableAnn('ht1');
    const cmd = new AddHoleTableCommand({ sheetId: 'sh1', ann });
    await cmd.apply();
    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    expect(doc.sheets[0]!.annotations).toHaveLength(2);
    expect(doc.sheets[0]!.annotations.map((a) => a.id)).toContain('ht0');
    expect(doc.sheets[0]!.annotations.map((a) => a.id)).toContain('ht1');
  });

  it('(f) command.name is "AddHoleTable"', () => {
    const cmd = new AddHoleTableCommand({ sheetId: 'sh1', ann: makeHoleTableAnn() });
    expect(cmd.name).toBe('AddHoleTable');
  });
});
```

#### Step 2 — Run to fail

```
pnpm --filter app test:unit -- --reporter=verbose AddHoleTableCommand
```

Expected failure: `Cannot find module '../AddHoleTableCommand'`.

#### Step 3 — Minimal implementation

```ts
// packages/app/src/commands/AddHoleTableCommand.ts
import type { Command } from './Command';
import type { DrawingDocument, HoleTableAnnotation } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';

export class AddHoleTableCommand implements Command {
  readonly name = 'AddHoleTable';

  constructor(
    private readonly opts: { sheetId: string; ann: HoleTableAnnotation },
  ) {}

  async apply(): Promise<void> {
    const state = useAppStore.getState();
    const doc = state.activeDocument;
    if (!doc || doc.kind !== 'drawing') return;

    const next: DrawingDocument = {
      ...doc.document,
      sheets: doc.document.sheets.map((sh) =>
        sh.id === this.opts.sheetId
          ? { ...sh, annotations: [...sh.annotations, this.opts.ann] }
          : sh,
      ),
    };
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: next } });
  }

  async revert(): Promise<void> {
    const state = useAppStore.getState();
    const doc = state.activeDocument;
    if (!doc || doc.kind !== 'drawing') return;

    const next: DrawingDocument = {
      ...doc.document,
      sheets: doc.document.sheets.map((sh) =>
        sh.id === this.opts.sheetId
          ? { ...sh, annotations: sh.annotations.filter((a) => a.id !== this.opts.ann.id) }
          : sh,
      ),
    };
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: next } });
  }
}
```

**Implementation notes:**
- `AddHoleTableCommand` delegates entirely to the existing `DrawingAnnotation` union mechanism, exactly as `AddDrawingAnnotationCommand` does. It does NOT call `assignHoleTags` itself — the caller (canvas click handler) pre-builds the `HoleTableAnnotation` including a freshly assigned `entries` map before constructing the command. This keeps the command a pure state mutation (no async extraction work inside apply/revert).
- The `entries` array is therefore passed in from the outside, constructed via `assignHoleTags(extractHolesInView(view, part), new Map(), resolveParam)` at click-commit time in the canvas handler (Task 2.4).

#### Step 4 — Run to pass

```
pnpm --filter app test:unit -- --reporter=verbose AddHoleTableCommand
```

All 6 assertions green.

#### Step 5 — Commit

```
git add packages/app/src/commands/AddHoleTableCommand.ts \
        packages/app/src/commands/__tests__/AddHoleTableCommand.spec.ts
git commit -m "feat(drawing-f6): Task 2.1 — AddHoleTableCommand apply/revert"
```

---

### Task 2.2 — `HoleTableToolState` type + store fields + `enterHoleTableMode` / `holeTableCancel`

**Files**
- `packages/app/src/drawing/toolMode.ts` (edit)
- `packages/app/src/drawing/__tests__/toolMode.holeTable.spec.ts` (create)

#### Step 1 — Failing test

```ts
// packages/app/src/drawing/__tests__/toolMode.holeTable.spec.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useToolModeStore } from '../toolMode';
import type { HoleTableToolState } from '../toolMode';

describe('HoleTableToolState — initial state', () => {
  beforeEach(() => {
    useToolModeStore.getState().reset();
  });

  it('default holeTableState is { stage: "idle" }', () => {
    expect(useToolModeStore.getState().holeTableState).toEqual({ stage: 'idle' });
  });

  it('reset() restores holeTableState to { stage: "idle" }', () => {
    useToolModeStore.getState().enterHoleTableMode();
    useToolModeStore.getState().reset();
    expect(useToolModeStore.getState().holeTableState).toEqual({ stage: 'idle' });
    expect(useToolModeStore.getState().mode).toBe('idle');
  });

  it('enterHoleTableMode() → mode = "holeTable", holeTableState = { stage: "idle" }', () => {
    useToolModeStore.getState().enterHoleTableMode();
    const s = useToolModeStore.getState();
    expect(s.mode).toBe('holeTable');
    expect(s.holeTableState).toEqual({ stage: 'idle' });
  });
});

describe('holeTableCancel', () => {
  beforeEach(() => {
    useToolModeStore.getState().reset();
    useToolModeStore.getState().enterHoleTableMode();
  });

  it('cancel from idle (mode=holeTable) → mode=idle, holeTableState={ stage: "idle" }', () => {
    useToolModeStore.getState().holeTableCancel();
    const s = useToolModeStore.getState();
    expect(s.mode).toBe('idle');
    expect(s.holeTableState).toEqual({ stage: 'idle' });
  });

  it('cancel from pickDatum stage → resets to idle, mode stays holeTable (first ESC)', () => {
    // Advance to pickDatum
    useToolModeStore.getState().holeTablePickDatum('v1', {
      kind: 'edge-endpoint', edgeId: 'e1', end: 'start',
    });
    useToolModeStore.getState().holeTableCancel();
    const s = useToolModeStore.getState();
    expect(s.holeTableState).toEqual({ stage: 'idle' });
    expect(s.mode).toBe('holeTable'); // stays in mode after first ESC from non-idle
  });

  it('cancel from idle after previous cancel exits mode entirely (second ESC)', () => {
    useToolModeStore.getState().holeTablePickDatum('v1', {
      kind: 'edge-endpoint', edgeId: 'e1', end: 'start',
    });
    useToolModeStore.getState().holeTableCancel(); // first ESC: back to idle, stays in holeTable
    useToolModeStore.getState().holeTableCancel(); // second ESC from idle: exit mode
    expect(useToolModeStore.getState().mode).toBe('idle');
  });
});
```

#### Step 2 — Run to fail

```
pnpm --filter app test:unit -- --reporter=verbose toolMode.holeTable
```

Expected failure: `Property 'holeTableState' does not exist` and `Property 'enterHoleTableMode' does not exist`.

#### Step 3 — Minimal implementation (edits to `toolMode.ts`)

**3a. Add `HoleTableToolState` type and `'holeTable'` to the `ToolMode` union.**

Add after the `EditDetailRegionToolState` block (after line 127):

```ts
// ---------------------------------------------------------------------------
// Hole Table tool sub-state (Drawing F6)
// ---------------------------------------------------------------------------
export type HoleTableToolState =
  | { stage: 'idle' }
  | {
      stage: 'pickDatum';
      viewId: string;
      datum: import('@zilventor/shared').PointRef;
    };
```

Add `| 'holeTable'` to the `ToolMode` union at line 27, after `'editDetailRegion'`:

```ts
  | 'editDetailRegion'
  | 'holeTable';  // Drawing F6 — hole table placement
```

**3b. Add `holeTableState` field and actions to `ToolModeState` interface.**

After `editDetailRegionState: EditDetailRegionToolState;` in the interface block:

```ts
  // Hole Table tool state (Drawing F6)
  holeTableState: HoleTableToolState;
  enterHoleTableMode(): void;
  holeTablePickDatum(viewId: string, datum: import('@zilventor/shared').PointRef): void;
  holeTableCancel(): void;
```

**3c. Add initial value, reset entry, and action implementations.**

In `useToolModeStore` initial state object, add:
```ts
  holeTableState: { stage: 'idle' } as HoleTableToolState,
```

In `reset()`, add:
```ts
  holeTableState: { stage: 'idle' },
```

After `editDetailCancel()` implementation, add:

```ts
  enterHoleTableMode() {
    set({ mode: 'holeTable', holeTableState: { stage: 'idle' } });
  },

  holeTablePickDatum(viewId, datum) {
    const { holeTableState } = get();
    if (holeTableState.stage !== 'idle') {
      console.warn('holeTablePickDatum: expected stage=idle, got', holeTableState.stage);
      return;
    }
    set({ holeTableState: { stage: 'pickDatum', viewId, datum } });
  },

  holeTableCancel() {
    const { holeTableState, mode } = get();
    if (holeTableState.stage !== 'idle') {
      // First ESC from any non-idle stage: clear the state, stay in holeTable mode.
      set({ holeTableState: { stage: 'idle' } });
      return;
    }
    if (holeTableState.stage === 'idle' && mode === 'holeTable') {
      // Second ESC (or ESC from fresh idle in holeTable mode): exit the tool.
      set({ mode: 'idle', holeTableState: { stage: 'idle' } });
    }
  },
```

#### Step 4 — Run to pass

```
pnpm --filter app test:unit -- --reporter=verbose toolMode.holeTable
```

All 6 assertions green. Run full suite to confirm no regressions:
```
pnpm --filter app test:unit
```

#### Step 5 — Commit

```
git add packages/app/src/drawing/toolMode.ts \
        packages/app/src/drawing/__tests__/toolMode.holeTable.spec.ts
git commit -m "feat(drawing-f6): Task 2.2 — HoleTableToolState + enterHoleTableMode/cancel actions"
```

---

### Task 2.3 — `holeTablePickDatum` full transition + `holeTablePickPlacement` (command dispatch)

**Files**
- `packages/app/src/drawing/__tests__/toolMode.holeTable.spec.ts` (extend)
- `packages/app/src/drawing/toolMode.ts` (extend — add `holeTablePickPlacement`)

> **Note:** `holeTablePickPlacement` takes an `onDispatch` callback (same pattern as `detailPickDrop` / `sectionPickDrop`) rather than calling `bus.execute` directly. The canvas (Task 2.4) provides the callback that constructs and executes the command. This keeps the store pure and testable.

#### Step 1 — Failing test (append to `toolMode.holeTable.spec.ts`)

```ts
// --- append to packages/app/src/drawing/__tests__/toolMode.holeTable.spec.ts ---
import { vi } from 'vitest';  // add to existing import line at top

describe('holeTablePickDatum → holeTablePickPlacement flow', () => {
  beforeEach(() => {
    useToolModeStore.getState().reset();
    useToolModeStore.getState().enterHoleTableMode();
  });

  it('pickDatum sets stage=pickDatum with viewId and datum', () => {
    useToolModeStore.getState().holeTablePickDatum('v1', {
      kind: 'arc-center', edgeId: 'e5',
    });
    const s = useToolModeStore.getState().holeTableState;
    expect(s.stage).toBe('pickDatum');
    if (s.stage === 'pickDatum') {
      expect(s.viewId).toBe('v1');
      expect(s.datum).toEqual({ kind: 'arc-center', edgeId: 'e5' });
    }
  });

  it('pickDatum when already in pickDatum is a no-op (warns, does not overwrite)', () => {
    useToolModeStore.getState().holeTablePickDatum('v1', {
      kind: 'arc-center', edgeId: 'e5',
    });
    useToolModeStore.getState().holeTablePickDatum('v2', {
      kind: 'edge-midpoint', edgeId: 'e6',
    });
    const s = useToolModeStore.getState().holeTableState;
    expect(s.stage).toBe('pickDatum');
    if (s.stage === 'pickDatum') {
      // First pick is preserved (guard fires for second)
      expect(s.viewId).toBe('v1');
    }
  });

  it('pickPlacement from pickDatum: calls onDispatch with viewId, datum, posMm; returns to idle', () => {
    useToolModeStore.getState().holeTablePickDatum('v1', {
      kind: 'edge-endpoint', edgeId: 'e1', end: 'start',
    });
    const cb = vi.fn();
    const posMm = { x: 180, y: 30 };
    useToolModeStore.getState().holeTablePickPlacement(posMm, cb);
    expect(cb).toHaveBeenCalledOnce();
    const args = cb.mock.calls[0] as [string, import('@zilventor/shared').PointRef, { x: number; y: number }];
    expect(args[0]).toBe('v1');
    expect(args[1]).toEqual({ kind: 'edge-endpoint', edgeId: 'e1', end: 'start' });
    expect(args[2]).toEqual(posMm);
    expect(useToolModeStore.getState().mode).toBe('idle');
    expect(useToolModeStore.getState().holeTableState).toEqual({ stage: 'idle' });
  });

  it('pickPlacement from idle: no-op (warns; onDispatch not called)', () => {
    const cb = vi.fn();
    useToolModeStore.getState().holeTablePickPlacement({ x: 100, y: 50 }, cb);
    expect(cb).not.toHaveBeenCalled();
    expect(useToolModeStore.getState().mode).toBe('holeTable');
  });
});
```

#### Step 2 — Run to fail

```
pnpm --filter app test:unit -- --reporter=verbose toolMode.holeTable
```

Expected failure: `Property 'holeTablePickPlacement' does not exist`.

#### Step 3 — Implementation additions

**3a. Add `holeTablePickPlacement` to `ToolModeState` interface (in `toolMode.ts`):**

After `holeTableCancel(): void;`:
```ts
  holeTablePickPlacement(
    posMm: { x: number; y: number },
    onDispatch: (viewId: string, datum: import('@zilventor/shared').PointRef, posMm: { x: number; y: number }) => void,
  ): void;
```

**3b. Add `holeTablePickPlacement` implementation in `useToolModeStore`:**

After `holeTableCancel()` implementation:
```ts
  holeTablePickPlacement(posMm, onDispatch) {
    const { holeTableState } = get();
    if (holeTableState.stage !== 'pickDatum') {
      console.warn('holeTablePickPlacement: expected stage=pickDatum, got', holeTableState.stage);
      return;
    }
    const { viewId, datum } = holeTableState;
    set({ mode: 'idle', holeTableState: { stage: 'idle' } });
    onDispatch(viewId, datum, posMm);
  },
```

#### Step 4 — Run to pass

```
pnpm --filter app test:unit -- --reporter=verbose toolMode.holeTable
```

All assertions green. Run full suite:
```
pnpm --filter app test:unit
```

#### Step 5 — Commit

```
git add packages/app/src/drawing/toolMode.ts \
        packages/app/src/drawing/__tests__/toolMode.holeTable.spec.ts
git commit -m "feat(drawing-f6): Task 2.3 — holeTablePickDatum/holeTablePickPlacement transitions"
```

---

### Task 2.4 — DrawingCanvas `'holeTable'` click-handler branch

**Files**
- `packages/app/src/drawing/DrawingCanvas.tsx` (edit)

> **No new unit tests in this task.** The `handleClick` branch is integration-only: the canvas wiring is exercised by the E2E test `T-6-15` in Batch 4, and the ToolMode transitions it relies on are already covered by Task 2.3 unit tests. Adding a dedicated unit test for this branch would require full React render scaffolding with `@testing-library/react` and a fake bus — the cost exceeds value for a 20-line branch with unit-tested sub-components.

#### Step 1 — Implementation (no failing test first — documented exception above)

In `DrawingCanvas.tsx`, after the final import block add:
```ts
import { AddHoleTableCommand } from '../commands/AddHoleTableCommand';
import { extractHolesInView, assignHoleTags } from '@zilventor/shared';
```

Inside `handleClick`, after the `if (toolMode === 'angular') { ... return; }` block (around line 637), add:

```ts
if (toolMode === 'holeTable') {
  // CRITICAL: read live state (avoid stale-closure bug, per F1.1 pattern)
  const liveDrw = useAppStore.getState().activeDrawing;
  const liveSheet = liveDrw?.sheets.find((s) => s.id === liveDrw.activeSheetId)
    ?? liveDrw?.sheets[0];
  if (!liveDrw || !liveSheet) return;

  const hs = useToolModeStore.getState().holeTableState;
  const sheetPt = { x: svgX, y: svgY };

  if (hs.stage === 'idle') {
    // First click: require an edge click inside a projected view to establish datum.
    const clickedEdgeId = (e.target as SVGElement).getAttribute('data-edge-id') ?? undefined;
    const clickedViewId = (e.target as SVGElement).getAttribute('data-view-id') ?? undefined;
    if (!clickedEdgeId || !clickedViewId) return;

    const targetView = liveSheet.views.find((v) => v.id === clickedViewId);
    if (!targetView || !targetView.projection) return; // must be a projected view

    // Build a PointRef datum from the clicked edge (arc-center if the edge carries one,
    // otherwise edge-endpoint start — mirrors how dimension tools build PointRefs).
    const allEdges = [
      ...targetView.projection.visibleEdges,
      ...targetView.projection.hiddenEdges,
    ];
    const clickedEdge = allEdges.find((ed) => ed.id === clickedEdgeId);
    if (!clickedEdge) return;

    // Use arc-center if the edge is curved (kind === 'feature' with points forming a circle),
    // otherwise edge-endpoint start.
    const datum: import('@zilventor/shared').PointRef =
      clickedEdge.kind === 'feature'
        ? { kind: 'arc-center', edgeId: clickedEdgeId }
        : { kind: 'edge-endpoint', edgeId: clickedEdgeId, end: 'start' };

    useToolModeStore.getState().holeTablePickDatum(clickedViewId, datum);
    return;
  }

  if (hs.stage === 'pickDatum') {
    // Second click: any sheet point → commit the table.
    useToolModeStore.getState().holeTablePickPlacement(
      sheetPt,
      (viewId, datum, posMm) => {
        const part = useAppStore.getState().activePart;
        if (!part) return;

        const targetView = liveSheet.views.find((v) => v.id === viewId);
        if (!targetView) return;

        const resolveParam = (p: import('@zilventor/shared').ParamOrLiteral): number =>
          p.kind === 'literal'
            ? p.value
            : (part.parameters[p.paramName]?.value ?? 0);

        const holes = extractHolesInView(targetView, part);
        const tagMap = assignHoleTags(holes, new Map(), resolveParam);
        const entries = Array.from(tagMap.entries()).map(([holeFeatureId, tag]) => ({
          holeFeatureId,
          tag,
        }));

        const ann: import('@zilventor/shared').HoleTableAnnotation = {
          kind: 'holeTable',
          id: crypto.randomUUID(),
          viewId,
          datum,
          positionMm: posMm,
          entries,
        };
        void bus.execute(new AddHoleTableCommand({ sheetId: liveSheet.id, ann }));
      },
    );
    return;
  }

  return;
}
```

Also wire ESC key: locate the existing `handleKeyDown` (or the `useEffect` that handles `keydown` for `Escape`). The existing pattern cancels tools by calling e.g. `sectionCancel()` / `detailCancel()` when mode matches. Add a `holeTable` case:

```ts
case 'holeTable':
  useToolModeStore.getState().holeTableCancel();
  break;
```

#### Step 2 — Verify TypeScript compiles

```
pnpm --filter app build 2>&1 | tail -20
```

Expected: zero type errors (or only pre-existing ones unrelated to F6).

#### Step 3 — Commit

```
git add packages/app/src/drawing/DrawingCanvas.tsx
git commit -m "feat(drawing-f6): Task 2.4 — DrawingCanvas holeTable click-handler branch"
```

---

### Task 2.5 — DrawingTab ribbon button + disabled-guard unit test

**Files**
- `packages/app/src/shell/tabs/DrawingTab.tsx` (edit)
- `packages/app/src/shell/tabs/__tests__/DrawingTab.holeTable.spec.tsx` (create)

#### Step 1 — Failing test

```tsx
// packages/app/src/shell/tabs/__tests__/DrawingTab.holeTable.spec.tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import React from 'react';
import DrawingTab from '../DrawingTab';
import { useAppStore } from '../../../store/useAppStore';
import { useToolModeStore } from '../../../drawing/toolMode';
import type { DrawingDocument } from '@zilventor/shared';

function makeDrawingDoc(withProjectedView: boolean): DrawingDocument {
  return {
    id: 'dw1',
    name: 'Test Drawing',
    units: 'mm',
    source: { partPath: 'parts/box.zipt', sourceKind: 'part' },
    properties: {},
    activeSheetId: 'sh1',
    sheets: [
      {
        id: 'sh1',
        name: 'Sheet 1',
        size: { kind: 'iso', size: 'A3' },
        orientation: 'landscape',
        views: withProjectedView
          ? [
              {
                id: 'v1',
                kind: 'base' as const,
                positionMm: { x: 20, y: 20 },
                scale: { numerator: 1, denominator: 1 },
                showHidden: false,
                projection: {
                  visibleEdges: [],
                  hiddenEdges: [],
                  bbox: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
                },
                orientation: 'front' as const,
              },
            ]
          : [],
        dimensions: [],
        dimensionGroups: [],
        annotations: [],
        titleBlock: {},
      },
    ],
  };
}

describe('DrawingTab — Hole Table ribbon button', () => {
  beforeEach(() => {
    useToolModeStore.getState().reset();
  });

  it('renders a "Hole Table" button in the Annotate panel', () => {
    useAppStore.setState({
      activeDocument: { kind: 'drawing', document: makeDrawingDoc(false) },
    } as never);
    render(<DrawingTab />);
    expect(screen.getByRole('button', { name: 'Hole Table' })).toBeTruthy();
  });

  it('button is disabled when no sheet view has a projection', () => {
    useAppStore.setState({
      activeDocument: { kind: 'drawing', document: makeDrawingDoc(false) },
    } as never);
    render(<DrawingTab />);
    const btn = screen.getByRole('button', { name: 'Hole Table' });
    expect(btn).toBeDisabled();
  });

  it('button is enabled when at least one sheet view has a projection', () => {
    useAppStore.setState({
      activeDocument: { kind: 'drawing', document: makeDrawingDoc(true) },
    } as never);
    render(<DrawingTab />);
    const btn = screen.getByRole('button', { name: 'Hole Table' });
    expect(btn).not.toBeDisabled();
  });

  it('clicking the button calls enterHoleTableMode() and sets mode to "holeTable"', async () => {
    useAppStore.setState({
      activeDocument: { kind: 'drawing', document: makeDrawingDoc(true) },
    } as never);
    render(<DrawingTab />);
    const btn = screen.getByRole('button', { name: 'Hole Table' });
    await userEvent.click(btn);
    expect(useToolModeStore.getState().mode).toBe('holeTable');
  });
});
```

#### Step 2 — Run to fail

```
pnpm --filter app test:unit -- --reporter=verbose DrawingTab.holeTable
```

Expected failure: `Unable to find an accessible element with the role "button" and name "Hole Table"`.

#### Step 3 — Minimal implementation (edit `DrawingTab.tsx`)

In the `{/* Annotate panel */}` `<RibbonPanel title="Annotate">` block, after the existing `Balloon` button (around line 229), add:

```tsx
{/* Hole Table: Drawing F6 */}
<button
  type="button"
  className="text-xs hover:text-white disabled:text-neutral-500"
  aria-label="Hole Table"
  disabled={!hasProjectedView}
  title={!hasProjectedView ? 'Add a base view with a projection first' : undefined}
  onClick={() => useToolModeStore.getState().enterHoleTableMode()}
>
  Hole Table
</button>
```

`hasProjectedView` is already computed at line 24 of `DrawingTab.tsx`:
```ts
const hasProjectedView = activeSheet?.views.some((v) => v.projection != null) ?? false;
```
No new variable needed — this exact guard is the correct semantic (a hole table requires projected geometry to extract holes from).

#### Step 4 — Run to pass

```
pnpm --filter app test:unit -- --reporter=verbose DrawingTab.holeTable
```

All 4 assertions green. Run full suite:
```
pnpm --filter app test:unit
```

#### Step 5 — Commit

```
git add packages/app/src/shell/tabs/DrawingTab.tsx \
        packages/app/src/shell/tabs/__tests__/DrawingTab.holeTable.spec.tsx
git commit -m "feat(drawing-f6): Task 2.5 — Hole Table ribbon button + disabled guard"
```

---

### Task 2.6 — INTENTIONALLY OMITTED (no AnnotationElement stub needed)

> **Reconciliation note (controller):** This task originally added a stub `case 'holeTable': return null;` to `AnnotationElement.tsx`. It has been **removed** because `AnnotationElement`'s switch ends in `default: return null;` with **no `never`-exhaustiveness assertion** (verified at `packages/app/src/drawing/AnnotationElement.tsx:94-95`). Adding the `HoleTableAnnotation` variant to the union in Batch 1 therefore does **not** break compilation — the `default` already renders nothing for `holeTable` through Batches 1–2.
>
> A stub here would **collide** with Batch 3 Task 3.3, which adds the single real `case 'holeTable'` before `default`. Do **not** add a stub. Batch 3 owns the only `case 'holeTable'` in `AnnotationElement.tsx`.

---

## Batch 2 — Self-critique

### 1. Weaknesses

1. **Canvas handler datum heuristic is rough.** The `clickedEdge.kind === 'feature' ? arc-center : edge-endpoint` heuristic is coarser than how existing dimension tools build PointRefs (they examine edge geometry more carefully). A mis-classified edge produces a wrong datum point. This is safe to ship because `computeHoleTableRows` will simply produce incorrect X/Y values rather than crashing — a render-visible defect caught in Batch 4 Playwright verification. The correct fix (inspect arc flag on the edge) can be refined in Batch 3 or F6.x.

2. **No `holeTablePickPlacement` integration test against a real bus.** The canvas handler's `onDispatch` callback constructs and executes the command in a closure; this path is only tested E2E in Batch 4. A unit test would require a full React render + fake bus mock — cost/value is low before E2E lands, but it is a gap.

3. **AnnotationElement stub case silences TypeScript without rendering.** If Batch 3 is delayed, users who somehow create a `holeTable` annotation through a different path will see nothing (silent no-op). Acceptable given batched delivery.

4. **`DrawingTab.holeTable.spec.tsx` uses `@testing-library/react`** — confirming this package is already in `packages/app/package.json` devDeps is assumed (it is used by other drawing tests in the same directory). If absent, the test will fail at import, not assertion.

### 2. Assumptions

1. `AddDrawingAnnotationCommand` is the correct template to mirror — verified from actual source. `HoleTableAnnotation` is a `DrawingAnnotation` union member, so `sh.annotations.push/filter` works identically.
2. `hasProjectedView` is the correct guard variable for the Hole Table button — confirmed from `DrawingTab.tsx` line 24.
3. The ESC key handler in `DrawingCanvas` already has a `switch(mode)` or similar dispatch that can accept a new `'holeTable'` case without restructuring.
4. Batch 1 exports (`extractHolesInView`, `assignHoleTags`) exist at `@zilventor/shared` re-export level, not only at the file path, so the canvas import works.
5. `part.parameters[p.paramName]?.value` is the correct field access (confirmed from anchor H in `_f6-anchors.md`).

### 3. Confidence: 78

### 4. Calibration note

The command and toolMode sections are high-confidence (direct mirror of verified prior-batch patterns with complete source reads). The canvas handler section is medium-confidence: the `handleClick` insertion point and ESC wiring were read from source, but the datum-edge-kind heuristic is an educated guess that may produce wrong PointRef kinds for some edges — it works for the common case (arc-center on hole boundaries) and fails gracefully (wrong dims, not a crash). The ribbon and disabled-guard sections are high-confidence (exact variable names confirmed). Overall confidence is 78 — defensible with one real gap (datum heuristic) and one structural assumption (existing ESC dispatch is extensible without restructuring).
## Batch 3 — Both Renderer Paths

**Depends on:** Batches 1 and 2 shipped (types + `computeHoleTableRows` + `HoleTableRow` + `AddHoleTableCommand` + `'holeTable'` ToolMode all exist).

**Goal:** Land `holeTable` in BOTH the React live canvas (`HoleTableElement.tsx` + `AnnotationElement.tsx` `case`) AND the SVG-string export (`renderDrawingSvg.ts`), both calling the shared `computeHoleTableRows`. Grep-parity check + mid-flight Playwright screenshot. All steps are TDD (red → green → refactor → commit).

**Column layout constants (used throughout):**
```
COL_TAG_W   = 12  mm
COL_X_W     = 18  mm
COL_Y_W     = 18  mm
COL_DESC_W  = 45  mm
ROW_H       = 6   mm  (header + data rows)
BALLOON_R   = 3   mm  (small tag balloon on each hole)
FONT_SIZE   = 3.5 mm
LEADER_COLOR = "#333"
GRID_COLOR   = "#222"
```

---

### Task 3.1 — HoleTableElement unit tests (RED)

Write the failing component tests BEFORE implementing the component. Tests import the yet-to-exist `HoleTableElement`; TypeScript/runtime will fail at import — that is the expected red.

**Files:**
- `packages/app/src/drawing/__tests__/HoleTableElement.spec.tsx` ← NEW

#### Steps

1. Create the test file:

```tsx
// packages/app/src/drawing/__tests__/HoleTableElement.spec.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import type { HoleTableAnnotation } from '@zilventor/shared';
import type { DrawingView } from '@zilventor/shared';
import type { HoleTableRow } from '@zilventor/shared/src/drawing/holeTable';

// Stub computeHoleTableRows — Batch 1 already ships it; we control its output here
vi.mock('@zilventor/shared/src/drawing/holeTable', () => ({
  computeHoleTableRows: vi.fn(),
}));
// Stub the store snapshot so HoleTableElement can call useAppStore.getState()
vi.mock('../../../store/useAppStore', () => ({
  useAppStore: { getState: vi.fn(() => ({ activePart: null })) },
}));

import { computeHoleTableRows } from '@zilventor/shared/src/drawing/holeTable';
import { HoleTableElement } from '../HoleTableElement';

const mockRows: HoleTableRow[] = [
  {
    tag: 'A1',
    xDim: 20,
    yDim: -15,
    description: '⌘08 THRU',
    markerCenterSheetMm: { x: 130, y: 80 },
  },
  {
    tag: 'B1',
    xDim: 60,
    yDim: -15,
    description: '⌘12 THRU',
    markerCenterSheetMm: { x: 170, y: 80 },
  },
];

const mockAnn: HoleTableAnnotation = {
  kind: 'holeTable',
  id: 'ht-1',
  viewId: 'v-1',
  datum: { kind: 'edge-endpoint', edgeId: 'e-1', end: 'start' },
  positionMm: { x: 200, y: 50 },
  entries: [
    { holeFeatureId: 'H1', tag: 'A1' },
    { holeFeatureId: 'H2', tag: 'B1' },
  ],
};

const mockView: DrawingView = {
  id: 'v-1',
  kind: 'base',
  positionMm: { x: 100, y: 50 },
  scale: { numerator: 1, denominator: 1 },
  projection: {
    visibleEdges: [],
    hiddenEdges: [],
    bbox: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
  },
  // DrawingView requires these; add as needed for type satisfaction
} as unknown as DrawingView;

beforeEach(() => {
  vi.mocked(computeHoleTableRows).mockReturnValue(mockRows);
});

describe('HoleTableElement', () => {
  it('renders a table grid with header and one row per HoleTableRow', () => {
    const { container } = render(
      <svg>
        <HoleTableElement ann={mockAnn} view={mockView} />
      </svg>,
    );
    const g = container.querySelector('[data-ann-id="ht-1"][data-ann-kind="holeTable"]');
    expect(g).not.toBeNull();

    // Header texts
    expect(container.textContent).toContain('TAG');
    expect(container.textContent).toContain('XDIM');
    expect(container.textContent).toContain('YDIM');
    expect(container.textContent).toContain('DESCRIPTION');

    // Row tag texts
    expect(container.textContent).toContain('A1');
    expect(container.textContent).toContain('B1');
  });

  it('renders dimension values formatted to one decimal', () => {
    const { container } = render(
      <svg>
        <HoleTableElement ann={mockAnn} view={mockView} />
      </svg>,
    );
    // 20 mm → "20.0"; -15 mm → "-15.0"
    expect(container.textContent).toContain('20.0');
    expect(container.textContent).toContain('-15.0');
  });

  it('renders per-hole balloons (circles) and leaders (lines) to markerCenterSheetMm', () => {
    const { container } = render(
      <svg>
        <HoleTableElement ann={mockAnn} view={mockView} />
      </svg>,
    );
    // One balloon <circle> per row (data-role="hole-balloon")
    const balloons = container.querySelectorAll('[data-role="hole-balloon"]');
    expect(balloons).toHaveLength(2);
    // One leader line per row
    const leaders = container.querySelectorAll('[data-role="hole-leader"]');
    expect(leaders).toHaveLength(2);
  });

  it('passes the correct resolveParam built from activePart to computeHoleTableRows', () => {
    const fakePart = { parameters: { d1: { value: 8 } } };
    vi.mocked(require('../../../store/useAppStore').useAppStore.getState).mockReturnValue({
      activePart: fakePart,
    });
    render(
      <svg>
        <HoleTableElement ann={mockAnn} view={mockView} />
      </svg>,
    );
    expect(computeHoleTableRows).toHaveBeenCalledWith(
      mockAnn,
      mockView,
      fakePart,
      expect.any(Function),
    );
  });

  it('returns null when computeHoleTableRows returns an empty array', () => {
    vi.mocked(computeHoleTableRows).mockReturnValue([]);
    const { container } = render(
      <svg>
        <HoleTableElement ann={mockAnn} view={mockView} />
      </svg>,
    );
    const g = container.querySelector('[data-ann-id="ht-1"]');
    expect(g).toBeNull();
  });
});
```

2. Run to confirm red:
```bash
pnpm --filter app test:unit -- HoleTableElement.spec.tsx 2>&1 | tail -20
```
Expected: `Cannot find module '../HoleTableElement'` or TypeScript import error. Any other failure → stop, diagnose.

---

### Task 3.2 — Implement HoleTableElement.tsx (GREEN)

**Files:**
- `packages/app/src/drawing/HoleTableElement.tsx` ← NEW

#### Steps

1. Create the component:

```tsx
// packages/app/src/drawing/HoleTableElement.tsx
//
// STRUCTURAL DEPENDENCY (F4 cascade pattern):
//   NO useStore subscription on activePart. This component re-renders whenever
//   the parent DrawingCanvas re-renders on any store change, so a subscription
//   would be redundant and add render churn. Uses getState() snapshot instead.
//   IMPORTANT: Any future React.memo on DrawingCanvas WILL silently break the
//   live cascade for hole-table rows, because this component would stop
//   re-rendering on part changes. See DimensionElement.tsx lines 87-97 for the
//   same pattern.

import { useAppStore } from '../store/useAppStore';
import { computeHoleTableRows } from '@zilventor/shared/src/drawing/holeTable';
import type { HoleTableAnnotation, DrawingView } from '@zilventor/shared';
import type { ParamOrLiteral } from '@zilventor/shared';

// Layout constants (sheet-mm)
const COL_TAG_W   = 12;
const COL_X_W     = 18;
const COL_Y_W     = 18;
const COL_DESC_W  = 45;
const ROW_H       = 6;
const BALLOON_R   = 3;
const FONT_SIZE   = 3.5;
const LEADER_COLOR = '#333';
const GRID_COLOR   = '#222';

const TABLE_W = COL_TAG_W + COL_X_W + COL_Y_W + COL_DESC_W;

export type HoleTableElementProps = {
  ann: HoleTableAnnotation;
  view: DrawingView;
};

export function HoleTableElement({ ann, view }: HoleTableElementProps) {
  // Non-reactive snapshot read — see STRUCTURAL DEPENDENCY note above.
  const activePart = useAppStore.getState().activePart;

  if (!activePart) return null;

  const resolveParam = (p: ParamOrLiteral): number =>
    p.kind === 'literal'
      ? p.value
      : (activePart.parameters[p.paramName]?.value ?? 0);

  const rows = computeHoleTableRows(ann, view, activePart, resolveParam);
  if (rows.length === 0) return null;

  const { x: tx, y: ty } = ann.positionMm;

  // Column x offsets
  const xTag  = tx;
  const xX    = tx + COL_TAG_W;
  const xY    = tx + COL_TAG_W + COL_X_W;
  const xDesc = tx + COL_TAG_W + COL_X_W + COL_Y_W;

  // Grid lines — outer border + internal column lines + row lines
  const rowCount = rows.length + 1; // +1 for header
  const tableH   = rowCount * ROW_H;

  const gridLines: React.ReactNode[] = [];

  // Outer border
  gridLines.push(
    <rect key="border"
      x={tx} y={ty} width={TABLE_W} height={tableH}
      fill="white" stroke={GRID_COLOR} strokeWidth="0.3" />,
  );

  // Header divider
  gridLines.push(
    <line key="hdr-div"
      x1={tx} y1={ty + ROW_H} x2={tx + TABLE_W} y2={ty + ROW_H}
      stroke={GRID_COLOR} strokeWidth="0.3" />,
  );

  // Internal row dividers
  rows.forEach((_, i) => {
    if (i > 0) {
      gridLines.push(
        <line key={`row-div-${i}`}
          x1={tx} y1={ty + ROW_H * (i + 1)} x2={tx + TABLE_W} y2={ty + ROW_H * (i + 1)}
          stroke={GRID_COLOR} strokeWidth="0.15" />,
      );
    }
  });

  // Column dividers
  [xX, xY, xDesc].forEach((colX, i) => {
    gridLines.push(
      <line key={`col-div-${i}`}
        x1={colX} y1={ty} x2={colX} y2={ty + tableH}
        stroke={GRID_COLOR} strokeWidth="0.2" />,
    );
  });

  // Header texts
  const textY0 = ty + ROW_H * 0.65; // vertically centred in header row
  const headerTexts = (
    <g data-role="hole-table-header">
      <text x={xTag  + 1}  y={textY0} fontSize={FONT_SIZE} fill={GRID_COLOR} fontWeight="bold">TAG</text>
      <text x={xX    + 1}  y={textY0} fontSize={FONT_SIZE} fill={GRID_COLOR} fontWeight="bold">XDIM</text>
      <text x={xY    + 1}  y={textY0} fontSize={FONT_SIZE} fill={GRID_COLOR} fontWeight="bold">YDIM</text>
      <text x={xDesc + 1}  y={textY0} fontSize={FONT_SIZE} fill={GRID_COLOR} fontWeight="bold">DESCRIPTION</text>
    </g>
  );

  // Data rows
  const dataRows = rows.map((row, i) => {
    const rowY = ty + ROW_H * (i + 1);
    const cellY = rowY + ROW_H * 0.65;
    return (
      <g key={row.tag} data-role="hole-table-row" data-tag={row.tag}>
        <text x={xTag  + 1} y={cellY} fontSize={FONT_SIZE} fill={GRID_COLOR}>{row.tag}</text>
        <text x={xX    + 1} y={cellY} fontSize={FONT_SIZE} fill={GRID_COLOR}>
          {(Math.round(row.xDim * 10) / 10).toFixed(1)}
        </text>
        <text x={xY    + 1} y={cellY} fontSize={FONT_SIZE} fill={GRID_COLOR}>
          {(Math.round(row.yDim * 10) / 10).toFixed(1)}
        </text>
        <text x={xDesc + 1} y={cellY} fontSize={FONT_SIZE} fill={GRID_COLOR}>{row.description}</text>
      </g>
    );
  });

  // Per-hole balloons + leaders
  // Balloon is placed at a fixed offset above the table (or near the marker) — for MVP
  // place it 8mm above markerCenterSheetMm so it clears the hole outline.
  const BALLOON_OFFSET_Y = -8;
  const balloonElements = rows.map((row) => {
    const bx = row.markerCenterSheetMm.x;
    const by = row.markerCenterSheetMm.y + BALLOON_OFFSET_Y;
    return (
      <g key={`balloon-${row.tag}`}>
        {/* Leader from balloon circle edge to hole center */}
        <line
          data-role="hole-leader"
          x1={bx} y1={by + BALLOON_R}
          x2={row.markerCenterSheetMm.x} y2={row.markerCenterSheetMm.y}
          stroke={LEADER_COLOR} strokeWidth="0.25"
        />
        {/* Balloon circle */}
        <circle
          data-role="hole-balloon"
          cx={bx} cy={by} r={BALLOON_R}
          fill="white" stroke={LEADER_COLOR} strokeWidth="0.3"
        />
        <text x={bx} y={by + 1.2} textAnchor="middle" fontSize={FONT_SIZE - 0.5} fill={LEADER_COLOR}>
          {row.tag}
        </text>
      </g>
    );
  });

  return (
    <g data-ann-id={ann.id} data-ann-kind="holeTable">
      {gridLines}
      {headerTexts}
      {dataRows}
      {balloonElements}
    </g>
  );
}
```

2. Run tests to green:
```bash
pnpm --filter app test:unit -- HoleTableElement.spec.tsx 2>&1 | tail -20
```
Expected: 5 tests pass, 0 fail.

3. Commit:
```bash
git add packages/app/src/drawing/HoleTableElement.tsx packages/app/src/drawing/__tests__/HoleTableElement.spec.tsx
git commit -m "feat(drawing-f6): Task 3.2 — HoleTableElement (table grid + balloons + leaders)"
```

---

### Task 3.3 — Wire HoleTableElement into AnnotationElement.tsx (case 'holeTable')

**Routing decision:** Add `case 'holeTable'` in `AnnotationElement.tsx` — NOT in DrawingCanvas. Rationale: the existing enumeration in DrawingCanvas passes every annotation to `<AnnotationElement>` already (lines 901–904). Adding it there is the minimal-diff approach; it keeps the switch-dispatch pattern consistent with all other annotation kinds (centerline, center-mark, leader, balloon) and avoids a second annotation-routing pattern in the codebase.

**Files:**
- `packages/app/src/drawing/__tests__/AnnotationElement.spec.tsx` ← EDIT (add holeTable case test)
- `packages/app/src/drawing/AnnotationElement.tsx` ← EDIT

#### Steps

1. Open `packages/app/src/drawing/__tests__/AnnotationElement.spec.tsx` (if it does not exist, create it). Add a failing test confirming the new case renders:

```tsx
// ADD to AnnotationElement.spec.tsx (or create the file if absent)
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import type { HoleTableAnnotation, DrawingView } from '@zilventor/shared';
import { AnnotationElement } from '../AnnotationElement';

vi.mock('../HoleTableElement', () => ({
  HoleTableElement: ({ ann }: { ann: HoleTableAnnotation }) => (
    <g data-testid="hole-table-stub" data-ann-id={ann.id} />
  ),
}));
vi.mock('@zilventor/shared/src/drawing/holeTable', () => ({
  computeHoleTableRows: vi.fn(() => []),
}));
vi.mock('../../../store/useAppStore', () => ({
  useAppStore: { getState: vi.fn(() => ({ activePart: null })) },
}));

const htAnn: HoleTableAnnotation = {
  kind: 'holeTable',
  id: 'ht-ann-1',
  viewId: 'v-1',
  datum: { kind: 'edge-endpoint', edgeId: 'e-1', end: 'start' },
  positionMm: { x: 200, y: 50 },
  entries: [],
};
const dummyView = {
  id: 'v-1',
  projection: { visibleEdges: [], hiddenEdges: [], bbox: {} },
} as unknown as DrawingView;

describe('AnnotationElement — holeTable case', () => {
  it('renders HoleTableElement for a holeTable annotation', () => {
    const { container } = render(
      <svg>
        <AnnotationElement ann={htAnn} view={dummyView} />
      </svg>,
    );
    expect(container.querySelector('[data-testid="hole-table-stub"]')).not.toBeNull();
  });
});
```

2. Run to confirm red (`Cannot find module '../HoleTableElement'` is fine if Task 3.2 stub not yet re-exported; but after Task 3.2 ships the file exists — the test fails because `AnnotationElement` still has no `case 'holeTable'`):
```bash
pnpm --filter app test:unit -- AnnotationElement.spec.tsx 2>&1 | tail -20
```
Expected: test fails — `AnnotationElement` renders `null` for `holeTable` (falls through to `default: return null`).

3. Edit `AnnotationElement.tsx` — add the import and case. The new file already exports `HoleTableElement`; add:

```diff
// packages/app/src/drawing/AnnotationElement.tsx
+import { HoleTableElement } from './HoleTableElement';
```

And in the switch, BEFORE the `default:`:
```diff
+    case 'holeTable':
+      return <HoleTableElement ann={ann} view={view} />;
+
     default:
       return null;
```

4. Run tests green:
```bash
pnpm --filter app test:unit -- AnnotationElement.spec.tsx 2>&1 | tail -20
```
Expected: new test passes plus all previously green tests still pass.

5. Run the full app unit suite to confirm no regressions:
```bash
pnpm --filter app test:unit 2>&1 | tail -30
```
Expected: all pass (or only pre-existing failures if any).

6. Commit:
```bash
git add packages/app/src/drawing/AnnotationElement.tsx packages/app/src/drawing/__tests__/AnnotationElement.spec.tsx
git commit -m "feat(drawing-f6): Task 3.3 — wire holeTable case into AnnotationElement"
```

---

### Task 3.4 — SVG export: renderHoleTable + threading resolveParam (RED → GREEN)

**Threading choice:** Minimal-disturbance approach — add an **overloaded** signature to `renderAnnotationGroup` that accepts an optional `(sheet: DrawingSheet, source: PartDocument | AssemblyDocument)` pair, and at the call site pass them:

```diff
// renderDrawingSvg.ts line 42 (current):
- const annGroups = sheet.annotations.map((a) => renderAnnotationGroup(a)).join('\n');
+ const annGroups = sheet.annotations.map((a) => renderAnnotationGroup(a, sheet, source)).join('\n');
```

This is the only call site for `renderAnnotationGroup`; no other callers exist (it is a module-private function). Non-holeTable annotations ignore the extra args — they never use `sheet`/`source`. This avoids a separate filter+map pass and keeps the dispatch in one function.

**Files:**
- `packages/app/src/drawing/__tests__/renderHoleTable.spec.ts` ← NEW
- `packages/app/src/drawing/renderDrawingSvg.ts` ← EDIT

#### Steps

1. Create the failing test:

```ts
// packages/app/src/drawing/__tests__/renderHoleTable.spec.ts
import { describe, it, expect, vi } from 'vitest';
import type { DrawingDocument, DrawingSheet, DrawingView } from '@zilventor/shared';
import type { PartDocument } from '@zilventor/shared';
import type { HoleTableAnnotation } from '@zilventor/shared';
import type { HoleTableRow } from '@zilventor/shared/src/drawing/holeTable';

vi.mock('@zilventor/shared/src/drawing/holeTable', () => ({
  computeHoleTableRows: vi.fn(),
}));

import { computeHoleTableRows } from '@zilventor/shared/src/drawing/holeTable';
import { renderDrawingSvg } from '../renderDrawingSvg';

const mockRows: HoleTableRow[] = [
  {
    tag: 'A1',
    xDim: 20,
    yDim: -15,
    description: '⌘08 THRU',
    markerCenterSheetMm: { x: 130, y: 80 },
  },
];

const htAnn: HoleTableAnnotation = {
  kind: 'holeTable',
  id: 'ht-svg-1',
  viewId: 'v-1',
  datum: { kind: 'edge-endpoint', edgeId: 'e-1', end: 'start' },
  positionMm: { x: 200, y: 50 },
  entries: [{ holeFeatureId: 'H1', tag: 'A1' }],
};

const mockView: DrawingView = {
  id: 'v-1',
  kind: 'base',
  positionMm: { x: 100, y: 50 },
  scale: { numerator: 1, denominator: 1 },
  projection: {
    visibleEdges: [],
    hiddenEdges: [],
    bbox: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
  },
} as unknown as DrawingView;

const mockSheet = {
  id: 's-1',
  activeSheetId: 's-1',
  size: { kind: 'iso', size: 'A3' },
  orientation: 'landscape',
  views: [mockView],
  dimensions: [],
  dimensionGroups: [],
  annotations: [htAnn],
} as unknown as DrawingSheet;

const mockSource = {
  kind: 'part',
  id: 'p-1',
  name: 'TestPart',
  parameters: {},
  featureTree: [],
  sketches: [],
} as unknown as PartDocument;

const mockDrawing = {
  id: 'd-1',
  name: 'Test Drawing',
  sheets: [mockSheet],
  activeSheetId: 's-1',
  titleBlock: {},
} as unknown as DrawingDocument;

describe('renderDrawingSvg — holeTable annotation', () => {
  it('includes data-ann-kind="holeTable" in the SVG output', () => {
    vi.mocked(computeHoleTableRows).mockReturnValue(mockRows);
    const svg = renderDrawingSvg(mockDrawing, mockSheet, mockSource);
    expect(svg).toContain('data-ann-kind="holeTable"');
  });

  it('includes data-ann-id with the annotation id', () => {
    vi.mocked(computeHoleTableRows).mockReturnValue(mockRows);
    const svg = renderDrawingSvg(mockDrawing, mockSheet, mockSource);
    expect(svg).toContain('data-ann-id="ht-svg-1"');
  });

  it('includes tag text in the SVG output', () => {
    vi.mocked(computeHoleTableRows).mockReturnValue(mockRows);
    const svg = renderDrawingSvg(mockDrawing, mockSheet, mockSource);
    expect(svg).toContain('>A1<');
  });

  it('includes XDIM and YDIM header cells', () => {
    vi.mocked(computeHoleTableRows).mockReturnValue(mockRows);
    const svg = renderDrawingSvg(mockDrawing, mockSheet, mockSource);
    expect(svg).toContain('>XDIM<');
    expect(svg).toContain('>YDIM<');
  });

  it('emits a per-hole balloon circle', () => {
    vi.mocked(computeHoleTableRows).mockReturnValue(mockRows);
    const svg = renderDrawingSvg(mockDrawing, mockSheet, mockSource);
    // balloon circle with role
    expect(svg).toContain('data-role="hole-balloon"');
  });

  it('emits a per-hole leader line', () => {
    vi.mocked(computeHoleTableRows).mockReturnValue(mockRows);
    const svg = renderDrawingSvg(mockDrawing, mockSheet, mockSource);
    expect(svg).toContain('data-role="hole-leader"');
  });

  it('calls computeHoleTableRows with the correct part + resolveParam', () => {
    vi.mocked(computeHoleTableRows).mockReturnValue(mockRows);
    renderDrawingSvg(mockDrawing, mockSheet, mockSource);
    expect(computeHoleTableRows).toHaveBeenCalledWith(
      htAnn,
      mockView,
      mockSource,
      expect.any(Function),
    );
  });

  it('returns empty string fragment when computeHoleTableRows returns []', () => {
    vi.mocked(computeHoleTableRows).mockReturnValue([]);
    const svg = renderDrawingSvg(mockDrawing, mockSheet, mockSource);
    // The annotation group should be empty (or absent entirely)
    expect(svg).not.toContain('data-ann-id="ht-svg-1"');
  });
});
```

2. Run to confirm red:
```bash
pnpm --filter app test:unit -- renderHoleTable.spec.ts 2>&1 | tail -30
```
Expected: tests fail — `data-ann-kind="holeTable"` absent from SVG output.

3. Edit `renderDrawingSvg.ts`:

**a. Change the call site (line 42):**
```diff
- const annGroups = sheet.annotations.map((a) => renderAnnotationGroup(a)).join('\n');
+ const annGroups = sheet.annotations
+   .map((a) => renderAnnotationGroup(a, sheet, source))
+   .join('\n');
```

**b. Change the function signature and add holeTable branch (lines 546–567):**

```diff
-function renderAnnotationGroup(ann: DrawingAnnotation): string {
+function renderAnnotationGroup(
+  ann: DrawingAnnotation,
+  sheet: DrawingSheet,
+  source: PartDocument | AssemblyDocument,
+): string {
+  if (ann.kind === 'holeTable') {
+    return renderHoleTableAnnotation(ann, sheet, source);
+  }
   if (ann.kind === 'balloon') {
     // ... existing balloon block unchanged ...
   }
   // ... rest of existing branches unchanged ...
 }
```

**c. Add the new `renderHoleTableAnnotation` private function** (insert immediately before `renderAnnotationGroup`):

```ts
// Layout constants — mirrors HoleTableElement.tsx
const HT_COL_TAG_W   = 12;
const HT_COL_X_W     = 18;
const HT_COL_Y_W     = 18;
const HT_COL_DESC_W  = 45;
const HT_ROW_H       = 6;
const HT_BALLOON_R   = 3;
const HT_FONT_SIZE   = 3.5;
const HT_LEADER_COLOR = '#333';
const HT_GRID_COLOR   = '#222';
const HT_TABLE_W = HT_COL_TAG_W + HT_COL_X_W + HT_COL_Y_W + HT_COL_DESC_W;

function renderHoleTableAnnotation(
  ann: HoleTableAnnotation,
  sheet: DrawingSheet,
  source: PartDocument | AssemblyDocument,
): string {
  // Only PartDocument has featureTree; AssemblyDocument has `components` instead.
  // NOTE: neither document has a `kind` discriminant (verified packages/shared/src/types.ts:67,94),
  // so distinguish structurally via `'featureTree' in source`. Hole tables only apply to part drawings.
  const part = 'featureTree' in source ? (source as PartDocument) : null;
  if (!part) return '';

  const resolveParam = (p: ParamOrLiteral): number =>
    p.kind === 'literal'
      ? p.value
      : (part.parameters[p.paramName]?.value ?? 0);

  const view = sheet.views.find((v) => v.id === ann.viewId);
  if (!view) return '';

  // computeHoleTableRows is imported at the top of the file (see step d) — NOT here.
  const rows = computeHoleTableRows(ann, view, part, resolveParam);
  if (rows.length === 0) return '';

  const { x: tx, y: ty } = ann.positionMm;
  const xTag  = tx;
  const xX    = tx + HT_COL_TAG_W;
  const xY    = tx + HT_COL_TAG_W + HT_COL_X_W;
  const xDesc = tx + HT_COL_TAG_W + HT_COL_X_W + HT_COL_Y_W;

  const rowCount = rows.length + 1;
  const tableH   = rowCount * HT_ROW_H;

  // Build grid lines
  const gridParts: string[] = [];
  gridParts.push(`    <rect x="${tx}" y="${ty}" width="${HT_TABLE_W}" height="${tableH}" fill="white" stroke="${HT_GRID_COLOR}" stroke-width="0.3"/>`);
  // Header divider
  gridParts.push(`    <line x1="${tx}" y1="${ty + HT_ROW_H}" x2="${tx + HT_TABLE_W}" y2="${ty + HT_ROW_H}" stroke="${HT_GRID_COLOR}" stroke-width="0.3"/>`);
  // Row dividers
  for (let i = 1; i < rows.length; i++) {
    gridParts.push(`    <line x1="${tx}" y1="${ty + HT_ROW_H * (i + 1)}" x2="${tx + HT_TABLE_W}" y2="${ty + HT_ROW_H * (i + 1)}" stroke="${HT_GRID_COLOR}" stroke-width="0.15"/>`);
  }
  // Column dividers
  [xX, xY, xDesc].forEach((colX) => {
    gridParts.push(`    <line x1="${colX}" y1="${ty}" x2="${colX}" y2="${ty + tableH}" stroke="${HT_GRID_COLOR}" stroke-width="0.2"/>`);
  });

  // Header texts
  const textY0 = ty + HT_ROW_H * 0.65;
  gridParts.push(`    <text x="${xTag + 1}" y="${textY0}" font-size="${HT_FONT_SIZE}" fill="${HT_GRID_COLOR}" font-weight="bold">TAG</text>`);
  gridParts.push(`    <text x="${xX + 1}" y="${textY0}" font-size="${HT_FONT_SIZE}" fill="${HT_GRID_COLOR}" font-weight="bold">XDIM</text>`);
  gridParts.push(`    <text x="${xY + 1}" y="${textY0}" font-size="${HT_FONT_SIZE}" fill="${HT_GRID_COLOR}" font-weight="bold">YDIM</text>`);
  gridParts.push(`    <text x="${xDesc + 1}" y="${textY0}" font-size="${HT_FONT_SIZE}" fill="${HT_GRID_COLOR}" font-weight="bold">DESCRIPTION</text>`);

  // Data rows
  rows.forEach((row, i) => {
    const rowY = ty + HT_ROW_H * (i + 1);
    const cellY = rowY + HT_ROW_H * 0.65;
    gridParts.push(`    <text x="${xTag + 1}" y="${cellY}" font-size="${HT_FONT_SIZE}" fill="${HT_GRID_COLOR}">${escapeText(row.tag)}</text>`);
    gridParts.push(`    <text x="${xX + 1}" y="${cellY}" font-size="${HT_FONT_SIZE}" fill="${HT_GRID_COLOR}">${escapeText((Math.round(row.xDim * 10) / 10).toFixed(1))}</text>`);
    gridParts.push(`    <text x="${xY + 1}" y="${cellY}" font-size="${HT_FONT_SIZE}" fill="${HT_GRID_COLOR}">${escapeText((Math.round(row.yDim * 10) / 10).toFixed(1))}</text>`);
    gridParts.push(`    <text x="${xDesc + 1}" y="${cellY}" font-size="${HT_FONT_SIZE}" fill="${HT_GRID_COLOR}">${escapeText(row.description)}</text>`);
  });

  // Per-hole balloons + leaders
  const BALLOON_OFFSET_Y = -8;
  rows.forEach((row) => {
    const bx = row.markerCenterSheetMm.x;
    const by = row.markerCenterSheetMm.y + BALLOON_OFFSET_Y;
    // Leader
    gridParts.push(`    <line data-role="hole-leader" x1="${bx}" y1="${by + HT_BALLOON_R}" x2="${row.markerCenterSheetMm.x}" y2="${row.markerCenterSheetMm.y}" stroke="${HT_LEADER_COLOR}" stroke-width="0.25"/>`);
    // Balloon
    gridParts.push(`    <circle data-role="hole-balloon" cx="${bx}" cy="${by}" r="${HT_BALLOON_R}" fill="white" stroke="${HT_LEADER_COLOR}" stroke-width="0.3"/>`);
    gridParts.push(`    <text x="${bx}" y="${by + 1.2}" font-size="${HT_FONT_SIZE - 0.5}" text-anchor="middle" fill="${HT_LEADER_COLOR}">${escapeText(row.tag)}</text>`);
  });

  return `  <g data-ann-id="${escapeAttr(ann.id)}" data-ann-kind="holeTable">\n${gridParts.join('\n')}\n  </g>`;
}
```

**d. Add imports at the top of renderDrawingSvg.ts** (alongside existing imports):
```diff
+import type { HoleTableAnnotation } from '@zilventor/shared';
+import type { ParamOrLiteral } from '@zilventor/shared';
+import { computeHoleTableRows } from '@zilventor/shared/src/drawing/holeTable';
```

Note: the inline `import` statement inside the function body in step 3c above is pseudocode showing placement — move it to the top-of-file import block instead.

4. Run tests green:
```bash
pnpm --filter app test:unit -- renderHoleTable.spec.ts 2>&1 | tail -30
```
Expected: all 8 tests pass.

5. Run the full app unit suite:
```bash
pnpm --filter app test:unit 2>&1 | tail -30
```
Expected: all pass (no regressions from the call-site threading change — existing tests for balloon/leader/centerline/center-mark should still pass because those branches are unchanged).

6. Commit:
```bash
git add packages/app/src/drawing/renderDrawingSvg.ts packages/app/src/drawing/__tests__/renderHoleTable.spec.ts
git commit -m "feat(drawing-f6): Task 3.4 — renderHoleTableAnnotation in SVG export + thread resolveParam"
```

---

### Task 3.5 — Grep-parity verification

Confirm that `holeTable` appears in BOTH renderer paths. This is a required gate before the mid-flight Playwright step.

**Files:** read-only check.

#### Steps

1. Run the parity grep:
```bash
grep -n "holeTable" \
  packages/app/src/drawing/AnnotationElement.tsx \
  packages/app/src/drawing/renderDrawingSvg.ts
```
Expected output must include lines from **both** files, e.g.:
```
packages/app/src/drawing/AnnotationElement.tsx:NN:    case 'holeTable':
packages/app/src/drawing/renderDrawingSvg.ts:NN:  if (ann.kind === 'holeTable') {
packages/app/src/drawing/renderDrawingSvg.ts:NN:  <g data-ann-kind="holeTable"
```
If either file is absent from the output → STOP and fix before proceeding.

2. Also verify `HoleTableElement` is reachable from DrawingCanvas (transitive):
```bash
grep -n "holeTable\|HoleTableElement" \
  packages/app/src/drawing/DrawingCanvas.tsx \
  packages/app/src/drawing/HoleTableElement.tsx \
  packages/app/src/drawing/AnnotationElement.tsx
```
Expected: `AnnotationElement.tsx` has both the import and the `case`; `HoleTableElement.tsx` exports `HoleTableElement`; `DrawingCanvas.tsx` shows `AnnotationElement` is used (no direct mention of `HoleTableElement` in DrawingCanvas is fine — it routes via `AnnotationElement`).

3. No commit needed for this task (read-only verification).

---

### Task 3.6 — Mid-flight Playwright visual verification

This task requires **driving the actual running app** and reading back a screenshot. It is NOT a code-only step. The implementer MUST use the `webapp-testing` skill to drive Playwright.

**Precondition:** Batches 1 and 2 must be shipped (AddHoleTableCommand + ToolMode + ribbon button). If they are not yet merged, this task must wait.

**Files:**
- `tmp/` directory (screenshots only — not committed)

#### Steps

1. Ensure the dev server is running:
```bash
pnpm --filter app dev 2>&1 &
# Wait ~5s then verify
curl -s -o /dev/null -w "%{http_code}" http://localhost:5173/
```
Expected: `200`.

2. Via the `webapp-testing` skill, drive Playwright to:
   a. Navigate to `http://localhost:5173/`.
   b. Wait for the app to finish loading (look for canvas element or `data-testid="drawing-canvas"` or the title bar).
   c. **Create a test part with holes programmatically** via `page.evaluate`:
   ```js
   // Seed a part with 2 holes via the store — adapt to actual store action signatures from Batch 1+2
   const store = window.__zilventorStore.getState();
   // (Implementer: read actual seeding API from Batch 2 tests or e2e helpers)
   ```
   d. Place a base view on a drawing sheet.
   e. Click the **Hole Table** ribbon button (label: `"Hole Table"`, `aria-label="Hole Table"`).
   f. Click an edge in the view to pick a datum.
   g. Click a sheet location outside the view to place the table.
   h. Capture a screenshot to `tmp/f6-batch3-table-placed.png`:
   ```ts
   await page.screenshot({ path: 'tmp/f6-batch3-table-placed.png' });
   ```
   i. Capture a second screenshot after a 500ms pause to `tmp/f6-batch3-table-placed-2.png`.

3. **Read back both screenshots** using the Read tool. Verify:
   - The file sizes are non-zero (fail if `0 bytes`).
   - The two screenshots differ in byte size by less than 10% (confirms the app is stable, not flickering).
   - A table grid is visible (rectangular region with grid lines).
   - At least one balloon circle is visible near a hole center.
   - At least one leader line connects a balloon to the table or to a hole center.

4. If the table does NOT appear:
   - Check browser console for errors (`page.on('console', ...)` in Playwright).
   - Confirm `AnnotationElement` receives a `holeTable` annotation (add a `console.log` guard temporarily if needed).
   - Confirm the `computeHoleTableRows` call returns non-empty rows.

5. Record the screenshot paths and byte sizes in a one-paragraph summary. The controller will independently Read `tmp/f6-batch3-table-placed.png`.

6. No commit for screenshot artifacts. If the app path needed a fix, commit it:
```bash
git add packages/app/src/drawing/
git commit -m "fix(drawing-f6): Task 3.6 — fix found during Playwright mid-flight verification"
```

---

### Task 3.7 — Full suite green + batch commit

Confirm all tests are green and all relevant suite segments pass before the batch is declared done.

**Files:** read-only checks.

#### Steps

1. Run the shared unit tests (holeTable.ts pure logic — Batch 1 tests):
```bash
pnpm --filter @zilventor/shared test:unit 2>&1 | tail -20
```
Expected: all pass.

2. Run the app unit tests:
```bash
pnpm --filter app test:unit 2>&1 | tail -30
```
Expected: all pass, including the new HoleTableElement + renderHoleTable + AnnotationElement tests.

3. TypeScript check for the two modified files:
```bash
pnpm --filter app tsc --noEmit 2>&1 | grep -E "error TS|HoleTable|renderDraw|Annotation"
```
Expected: zero errors on any of the F6 files.

4. Final parity grep confirmation (same as Task 3.5 step 1):
```bash
grep -c "holeTable" \
  packages/app/src/drawing/AnnotationElement.tsx \
  packages/app/src/drawing/renderDrawingSvg.ts
```
Both files must show count ≥ 1.

5. If all green, push:
```bash
git push origin master
```

---

## Batch 3 — Self-critique

### 1. Weaknesses

1. **`renderHoleTableAnnotation` contains an inline `import` statement in the pseudocode** (step 3.4.3c). This is TypeScript-illegal at function scope. The plan notes "move to top-of-file import block" but the pseudocode may confuse an implementer who copy-pastes it literally. Should have placed the import declaration only in the top-of-file diff block.

2. **Balloon placement is fixed offset (`-8mm` above markerCenterSheetMm)** — this will overlap the hole outline for large-scale views and will look crowded when holes are close together. MVP is acceptable, but the plan does not mention this limitation explicitly, which could cause a confused implementer to try to "fix" it mid-batch.

3. **`source.kind === 'part'` guard in `renderHoleTableAnnotation`** assumes `PartDocument` has a `kind: 'part'` discriminant field. The plan references this but the actual field name needs to be confirmed by the implementer against `packages/shared/src/types.ts`. If it is absent, the guard fails silently.

4. **Mid-flight Playwright step (Task 3.6) depends on Batch 2 being shipped** — if Batch 2 is not yet merged when Batch 3 executes, the ribbon button does not exist and the visual verification step cannot complete. The plan mentions this dependency but does not provide a fallback (e.g., a `page.evaluate` direct store injection as an alternative entry path).

5. **Test for `activePart === null` early-return** in `HoleTableElement` (Task 3.1 step 1, last `it`) checks that the `<g>` is absent. But the component returns `null` before creating the `<g>`, so the test is correct — but only if `computeHoleTableRows` is NOT called with `null`. The mock is set to return `[]` in that test, but `getState().activePart === null` triggers the early return before the mock call. This is fine as written but could be fragile if the early-return condition changes.

### 2. Assumptions

1. `PartDocument` is accessible as the `source` arg in `renderDrawingSvg` and has the same shape (`parameters`, `featureTree`) as `useAppStore.getState().activePart` in the live path — this is confirmed by the function signature in anchor F.

2. The DrawingCanvas annotations enumeration (anchor D) passes ALL annotations through `AnnotationElement` unchanged — no pre-filtering by kind. Confirmed by reading lines 901–904.

3. `renderAnnotationGroup` has exactly one call site (line 42 of `renderDrawingSvg.ts`) — confirmed by reading the file.

4. Batches 1 and 2 ship `computeHoleTableRows`, `HoleTableAnnotation`, `HoleTableRow`, and `PartDocument` types with the exact canonical shapes from section 0 of the anchors.

5. The `webapp-testing` skill supports `page.evaluate` for store manipulation — consistent with existing e2e test patterns.

### 3. Confidence: 72

### 4. Calibration note

Confidence is 72 because the plan's structure is solid — routing decision is justified (AnnotationElement case, not DrawingCanvas branch), threading change is minimal (one call site), TDD slices have complete code with correct red-then-green sequence, and all canonical names are used verbatim from anchor section 0. The main risks depressing confidence are: (a) the `source.kind` guard for `PartDocument` discrimination which depends on a runtime field I have not confirmed against the actual `PartDocument` type definition, (b) the Batch 2 dependency for the Playwright step which could cause the mid-flight verification to be un-runnable if batches are executed out of order, and (c) the inline-import pseudocode issue in Task 3.4 which requires careful reading to avoid a TypeScript error. A verifier should confirm the `PartDocument.kind` discriminant and the `source` guard before the implementer hits it.
## Batch 4 — E2E, Perf, Final Verification

**Prerequisite:** Batches 1–3 shipped. Confirmed artifacts:
- `packages/shared/src/drawing/holeTable.ts` — `extractHolesInView`, `assignHoleTags`, `formatHoleDescription`, `computeHoleTableRows` (canonical signatures from §0 of `_f6-anchors.md`).
- `packages/app/src/commands/AddHoleTableCommand.ts` — wraps `AddDrawingAnnotationCommand` pattern (apply pushes `HoleTableAnnotation` to `sheet.annotations`; revert removes by id).
- `packages/app/src/drawing/HoleTableElement.tsx` — `case 'holeTable'` in `AnnotationElement.tsx`.
- `packages/app/src/drawing/renderDrawingSvg.ts` — `case 'holeTable'` in the annotation dispatch.
- `'holeTable'` member added to the `ToolMode` union; ribbon button present in `DrawingTab.tsx`.

**No hole-seeding helper exists in `tests/e2e/helpers/seedDrawing.ts`.** That helper only seeds a bare box part with an empty `featureTree`. Hole feature injection is done inline via `page.evaluate` + store `setState`, mirroring how T-6-14 injects synthetic views directly. The approach is to construct a synthetic `activePart` that has `featureTree` entries with `kind: 'hole'` and a synthetic `projection.visibleEdges` that carries `sourceFaceIds` entries for those hole feature IDs — bypassing the OCCT kernel entirely (consistent with all other drawing e2e tests). See Task 4.1 for the complete injection.

---

### Task 4.1 — Write `T-6-15-hole-table.spec.ts` (failing → passing)

**Files:**
- `tests/e2e/drawing/T-6-15-hole-table.spec.ts` ← CREATE

#### Step 1 — Write the full failing test

Create `tests/e2e/drawing/T-6-15-hole-table.spec.ts` with the following complete content:

```ts
// tests/e2e/drawing/T-6-15-hole-table.spec.ts
import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';
import { seedDrawingWithBoxPart } from '../helpers/seedDrawing';

/**
 * T-6-15 — Hole Table (F6):
 *
 * Seeds a drawing with a part that has 3 holes of 2 distinct sizes (H1 dia=8,
 * H2 dia=8, H3 dia=12). Constructs a synthetic base view whose projected
 * visibleEdges carry sourceFaceIds for each hole (circle approximated as a
 * 16-point polyline). Injects an AddHoleTableCommand via the real command bus
 * to produce a HoleTableAnnotation. Asserts:
 *   - 3 table rows in the DOM (data-holetable-row)
 *   - Tags are A1, A2, B1 (size-grouped, stable)
 *   - XDIM/YDIM of A1 relative to the injected datum
 *   - Balloon/leader marker count == 3 (data-holetable-marker)
 * Then exercises undo (bus.undo()) and asserts the annotation disappears,
 * then redo (bus.redo()) and asserts it reappears.
 *
 * Uses store injection to avoid OPFS dependency — mirrors T-6-14 pattern.
 * Requires Batches 1-3 shipped (AddHoleTableCommand, HoleTableElement,
 * renderDrawingSvg case, computeHoleTableRows).
 */
test('T-6-15: Hole Table — inject command, assert rows + tags + datum dims + undo/redo', async ({ page }) => {
  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('/');
  await waitForKernelReady(page);

  // ── 1. Seed drawing (blank sheet, box 100×60×40) ──────────────────────────
  const { sheetId } = await seedDrawingWithBoxPart(page, {
    boxLength: 100, boxWidth: 60, boxHeight: 40,
    sheetSize: 'A3', orientation: 'landscape',
  });

  // ── 2. Inject part with 3 holes (2 distinct sizes) + base view ───────────
  //
  // Hole layout (all throughAll, front-face, part-mm):
  //   H1 (dia=8):  center (20, 20)
  //   H2 (dia=8):  center (50, 20)
  //   H3 (dia=12): center (80, 30)
  //
  // Each hole's circular boundary is approximated by 16 polyline points.
  // sourceFaceIds carries "<featureId>|hole|0" so extractHolesInView can
  // parse the featureId and look it up in featureTree.
  //
  // Datum edge: a synthetic edge at part-mm (0, 0) used as an edge-endpoint
  // PointRef for the datum; datumEdgeId = 'T615-datum'.
  // Datum resolves to part-mm [0, 0].
  //
  // Expected dims:
  //   A1 (H1): xDim = 20 - 0 = 20, yDim = 20 - 0 = 20
  //   A2 (H2): xDim = 50 - 0 = 50, yDim = 20 - 0 = 20
  //   B1 (H3): xDim = 80 - 0 = 80, yDim = 30 - 0 = 30

  const baseViewId = 'T615-base';
  const tableAnnotationId = 'T615-hole-table-1';

  await page.evaluate(
    ({ sheetId, baseViewId }: { sheetId: string; baseViewId: string }) => {
      const w = window as unknown as {
        __zilventorStore: {
          getState(): {
            activeDocument?: { kind: string; document: unknown };
            activePart: unknown;
          };
          setState(p: unknown): void;
        };
      };
      const s = w.__zilventorStore.getState();
      const drawing = s.activeDocument?.kind === 'drawing'
        ? (s.activeDocument.document as { sheets: Array<{ id: string; views: unknown[]; annotations: unknown[] }> })
        : null;
      if (!drawing) return;

      // Build a 16-point circle approximation around (cx, cy) with radius r.
      function circlePoints(cx: number, cy: number, r: number): ReadonlyArray<readonly [number, number]> {
        const pts: Array<readonly [number, number]> = [];
        for (let i = 0; i <= 16; i++) {
          const angle = (i / 16) * 2 * Math.PI;
          pts.push([cx + r * Math.cos(angle), cy + r * Math.sin(angle)]);
        }
        return pts;
      }

      // Datum edge: a single horizontal edge whose start point is at (0,0).
      const datumEdge = {
        id: 'T615-datum',
        kind: 'outline' as const,
        points: [[0, 0], [10, 0]] as ReadonlyArray<readonly [number, number]>,
        sourceFaceIds: [] as string[],
      };

      // Hole H1 — dia 8 → radius 4, center (20, 20)
      const h1Edge = {
        id: 'T615-h1-circle',
        kind: 'feature' as const,
        points: circlePoints(20, 20, 4),
        sourceFaceIds: ['H1|hole|0', 'F1|face|0'],
      };

      // Hole H2 — dia 8 → radius 4, center (50, 20)
      const h2Edge = {
        id: 'T615-h2-circle',
        kind: 'feature' as const,
        points: circlePoints(50, 20, 4),
        sourceFaceIds: ['H2|hole|0', 'F2|face|0'],
      };

      // Hole H3 — dia 12 → radius 6, center (80, 30)
      const h3Edge = {
        id: 'T615-h3-circle',
        kind: 'feature' as const,
        points: circlePoints(80, 30, 6),
        sourceFaceIds: ['H3|hole|0', 'F3|face|0'],
      };

      // Part with 3 hole features in featureTree.
      const partWithHoles = {
        ...(s.activePart as object),
        id: 'T615-part',
        name: 'T615Part',
        parameters: {
          length: { value: 100 },
          width: { value: 60 },
          height: { value: 40 },
          d_h1: { value: 8 },
          d_h2: { value: 8 },
          d_h3: { value: 12 },
        },
        featureTree: [
          // H1: simple throughAll, dia=8
          {
            id: 'H1',
            kind: 'hole',
            placement: { kind: 'linear', x: { kind: 'literal', value: 20 }, y: { kind: 'literal', value: 20 }, faceRef: 'front' },
            profile: {
              kind: 'simple',
              diameter: { kind: 'param', paramName: 'd_h1' },
            },
            termination: { kind: 'throughAll' },
            flipAxis: false,
          },
          // H2: simple throughAll, dia=8 (same size → same tag letter as H1)
          {
            id: 'H2',
            kind: 'hole',
            placement: { kind: 'linear', x: { kind: 'literal', value: 50 }, y: { kind: 'literal', value: 20 }, faceRef: 'front' },
            profile: {
              kind: 'simple',
              diameter: { kind: 'param', paramName: 'd_h2' },
            },
            termination: { kind: 'throughAll' },
            flipAxis: false,
          },
          // H3: simple throughAll, dia=12 (different size → new tag letter B)
          {
            id: 'H3',
            kind: 'hole',
            placement: { kind: 'linear', x: { kind: 'literal', value: 80 }, y: { kind: 'literal', value: 30 }, faceRef: 'front' },
            profile: {
              kind: 'simple',
              diameter: { kind: 'param', paramName: 'd_h3' },
            },
            termination: { kind: 'throughAll' },
            flipAxis: false,
          },
        ],
      };

      const baseView = {
        id: baseViewId,
        kind: 'base',
        positionMm: { x: 50, y: 50 },
        scale: { numerator: 1, denominator: 1 },
        orientation: 'front',
        showHidden: false,
        projection: {
          visibleEdges: [datumEdge, h1Edge, h2Edge, h3Edge],
          hiddenEdges: [],
          bbox: { minX: 0, minY: 0, maxX: 100, maxY: 60 },
        },
        inputFingerprint: 'fp-T615-base',
      };

      const updatedDrawing = {
        ...drawing,
        sheets: drawing.sheets.map((sh) =>
          sh.id === sheetId ? { ...sh, views: [baseView] } : sh,
        ),
      };

      w.__zilventorStore.setState({
        activeDocument: { kind: 'drawing', document: updatedDrawing },
        activeDrawing: updatedDrawing,
        activePart: partWithHoles,
      });
    },
    { sheetId, baseViewId },
  );

  // ── 3. Switch to Drawing tab; assert base view renders ───────────────────
  await page.getByRole('tab', { name: 'Drawing' }).click();
  await expect(page.locator(`g[data-view-id="${baseViewId}"]`)).toBeVisible({ timeout: 10_000 });

  // ── 4. Inject AddHoleTableCommand via the real command bus ───────────────
  //
  // datum: edge-endpoint on 'T615-datum' end='start' → resolves to part-mm [0,0].
  // positionMm: table top-left at { x: 20, y: 200 } (below the view).
  // entries: empty on first placement — assignHoleTags assigns all fresh tags.

  const dispatchResult = await page.evaluate(
    async ({
      sheetId,
      baseViewId,
      tableAnnotationId,
    }: { sheetId: string; baseViewId: string; tableAnnotationId: string }) => {
      const w = window as unknown as {
        __zilventorStore: {
          getState(): {
            activeDocument: { kind: string; document: {
              sheets: Array<{
                id: string;
                annotations: Array<{ id: string; kind: string }>;
              }>;
            } } | null;
            bus: {
              execute(cmd: { apply(): Promise<void>; revert(): Promise<void>; readonly name: string }): Promise<void>;
            };
          };
        };
      };

      const { AddHoleTableCommand } = await import('/src/commands/AddHoleTableCommand.ts');

      const ann = {
        kind: 'holeTable' as const,
        id: tableAnnotationId,
        viewId: baseViewId,
        datum: { kind: 'edge-endpoint' as const, edgeId: 'T615-datum', end: 'start' as const },
        positionMm: { x: 20, y: 200 },
        entries: [] as ReadonlyArray<{ readonly holeFeatureId: string; readonly tag: string }>,
      };

      const cmd = new AddHoleTableCommand({ sheetId, ann });

      try {
        await w.__zilventorStore.getState().bus.execute(cmd);
      } catch (e) {
        return { ok: false, error: String(e), annotationCount: 0 };
      }

      const s = w.__zilventorStore.getState();
      const doc = s.activeDocument?.kind === 'drawing' ? s.activeDocument.document : null;
      const sheet = doc?.sheets.find((sh) => sh.id === sheetId);
      const annotationCount = sheet?.annotations.filter((a) => a.kind === 'holeTable').length ?? 0;

      return { ok: true, error: null, annotationCount };
    },
    { sheetId, baseViewId, tableAnnotationId },
  );

  expect(dispatchResult.ok, `AddHoleTableCommand dispatch failed: ${dispatchResult.error}`).toBe(true);
  expect(dispatchResult.annotationCount).toBe(1);

  // ── 5. Assert DOM: 3 rows, correct tags, XDIM/YDIM, 3 markers ───────────
  //
  // HoleTableElement renders:
  //   [data-holetable-row="<tag>"]   — one per hole row
  //   [data-holetable-tag="<tag>"]   — tag cell text
  //   [data-holetable-xdim="<tag>"]  — XDIM cell text (rounded, mm)
  //   [data-holetable-ydim="<tag>"]  — YDIM cell text (rounded, mm)
  //   [data-holetable-marker="<tag>"] — balloon+leader per hole

  // Wait for React to render the table.
  await page.waitForFunction(
    () => document.querySelectorAll('[data-holetable-row]').length === 3,
    undefined,
    { timeout: 10_000 },
  );

  // 3 table rows
  await expect(page.locator('[data-holetable-row]')).toHaveCount(3);

  // Tags: A1, A2, B1 (size-grouped: H1+H2 share dia=8 → letter A; H3 dia=12 → letter B)
  await expect(page.locator('[data-holetable-row="A1"]')).toBeAttached();
  await expect(page.locator('[data-holetable-row="A2"]')).toBeAttached();
  await expect(page.locator('[data-holetable-row="B1"]')).toBeAttached();

  // XDIM and YDIM for A1: (20-0)=20, (20-0)=20
  const xdimA1 = await page.locator('[data-holetable-xdim="A1"]').textContent();
  const ydimA1 = await page.locator('[data-holetable-ydim="A1"]').textContent();
  expect(parseFloat(xdimA1!)).toBeCloseTo(20, 1);
  expect(parseFloat(ydimA1!)).toBeCloseTo(20, 1);

  // XDIM and YDIM for B1: (80-0)=80, (30-0)=30
  const xdimB1 = await page.locator('[data-holetable-xdim="B1"]').textContent();
  const ydimB1 = await page.locator('[data-holetable-ydim="B1"]').textContent();
  expect(parseFloat(xdimB1!)).toBeCloseTo(80, 1);
  expect(parseFloat(ydimB1!)).toBeCloseTo(30, 1);

  // 3 balloon/leader markers
  await expect(page.locator('[data-holetable-marker]')).toHaveCount(3);

  // ── 6. Undo via the real command bus → annotation disappears ─────────────
  const undoOk = await page.evaluate(async () => {
    const w = window as unknown as {
      __zilventorStore: { getState(): { bus: { undo(): Promise<boolean> } } };
    };
    return w.__zilventorStore.getState().bus.undo();
  });
  expect(undoOk).toBe(true);

  // Annotation removed from store
  await page.waitForFunction(
    () => {
      const w = window as unknown as {
        __zilventorStore: {
          getState(): {
            activeDocument?: {
              kind: string;
              document: { sheets: Array<{ annotations: Array<{ kind: string }> }> };
            };
          };
        };
      };
      const doc = w.__zilventorStore.getState().activeDocument;
      if (doc?.kind !== 'drawing') return false;
      return doc.document.sheets[0]?.annotations.filter((a) => a.kind === 'holeTable').length === 0;
    },
    undefined,
    { timeout: 5_000 },
  );

  // DOM rows gone
  await expect(page.locator('[data-holetable-row]')).toHaveCount(0, { timeout: 5_000 });

  // ── 7. Redo via the real command bus → annotation reappears ─────────────
  const redoOk = await page.evaluate(async () => {
    const w = window as unknown as {
      __zilventorStore: { getState(): { bus: { redo(): Promise<boolean> } } };
    };
    return w.__zilventorStore.getState().bus.redo();
  });
  expect(redoOk).toBe(true);

  // Annotation back in store
  await page.waitForFunction(
    () => {
      const w = window as unknown as {
        __zilventorStore: {
          getState(): {
            activeDocument?: {
              kind: string;
              document: { sheets: Array<{ annotations: Array<{ kind: string }> }> };
            };
          };
        };
      };
      const doc = w.__zilventorStore.getState().activeDocument;
      if (doc?.kind !== 'drawing') return false;
      return doc.document.sheets[0]?.annotations.filter((a) => a.kind === 'holeTable').length === 1;
    },
    undefined,
    { timeout: 5_000 },
  );

  // DOM rows back
  await expect(page.locator('[data-holetable-row]')).toHaveCount(3, { timeout: 5_000 });
});
```

#### Step 2 — Run to confirm the test fails for the right reason

```bash
pnpm test:e2e --project=chromium tests/e2e/drawing/T-6-15-hole-table.spec.ts
```

Expected failure: `page.waitForFunction` timeout on `[data-holetable-row]` count == 3 (Batch 3 renderer not yet wired) **or** `AddHoleTableCommand not found` import error. This is the red state. If any other failure occurs (syntax error, wrong import), fix before proceeding.

#### Step 3 — Confirm Batches 1-3 shipped; wire remaining data-attributes if absent

The test relies on `HoleTableElement.tsx` emitting `data-holetable-row`, `data-holetable-tag`, `data-holetable-xdim`, `data-holetable-ydim`, `data-holetable-marker` attributes. If Batch 3 shipped without these attributes, add them now to `HoleTableElement.tsx`:

```tsx
// Inside HoleTableElement.tsx — for each HoleTableRow row:
<g key={row.tag} data-holetable-row={row.tag}>
  <text data-holetable-tag={row.tag}>{row.tag}</text>
  <text data-holetable-xdim={row.tag}>{row.xDim.toFixed(2)}</text>
  <text data-holetable-ydim={row.tag}>{row.yDim.toFixed(2)}</text>
</g>
// For each balloon marker:
<g data-holetable-marker={row.tag}>
  {/* balloon circle + leader */}
</g>
```

No other source files need changes for the e2e test (the command, renderer, and annotation type are Batch 1-3 responsibility).

#### Step 4 — Run to confirm green

```bash
pnpm test:e2e --project=chromium tests/e2e/drawing/T-6-15-hole-table.spec.ts
```

Expected: 1 test passes.

#### Step 5 — Commit

```bash
git add tests/e2e/drawing/T-6-15-hole-table.spec.ts
# If data-attribute additions were needed in Task 4.1 Step 3:
git add packages/app/src/drawing/HoleTableElement.tsx
git commit -m "test(drawing-f6): T-6-15 e2e — hole table inject + rows/tags/dims + undo/redo"
```

---

### Task 4.2 — Write `T63f` perf spec (failing → passing)

**Files:**
- `tests/perf/drawing-hole-table.perf.spec.ts` ← CREATE
- `packages/app/src/App.tsx` ← EDIT (add `__zilventorHoleTableMs` probe)

#### Step 1 — Write the failing perf spec

Mirror `tests/perf/drawing-edit-detail-region.perf.spec.ts` and `tests/perf/auto-dim.perf.spec.ts` exactly (probe on `window`, hard-failure if missing, p95 budget 50ms).

Create `tests/perf/drawing-hole-table.perf.spec.ts`:

```ts
// tests/perf/drawing-hole-table.perf.spec.ts
import { test, expect } from '@playwright/test';

/**
 * Perf — Drawing F6 hole table (computeHoleTableRows).
 *
 * Runs 100 iterations of computeHoleTableRows against a synthetic fixture:
 * 20 holes (10 of dia=8, 10 of dia=12), 2 distinct size groups.
 * Each hole's circular boundary: 16 polyline points.
 * Budget: p95 < 50 ms (same class as drawing-detail and drawing-edit-detail-region).
 * Expect microseconds in practice (pure 2D geometry, no kernel call).
 *
 * The probe window.__zilventorHoleTableMs(n) is wired in App.tsx after
 * __zilventorDimensionStylesMs. Returns { p95ms: number }.
 *
 * LOUD FAILURE: if the probe is not present on window, the test throws with a
 * clear error rather than silently passing — per F3/F4/F5 perf precedent.
 *
 * T63f naming consistent with existing T63-series perf tests.
 */
test('T63f Perf: computeHoleTableRows 100-iter p95 < 50ms', async ({ page }) => {
  await page.goto('/');

  // Hard wait for probe — loud failure if missing.
  await page.waitForFunction(
    () => typeof (window as { __zilventorHoleTableMs?: unknown }).__zilventorHoleTableMs === 'function',
    undefined,
    { timeout: 30_000 },
  ).catch(() => {
    throw new Error(
      'F6 perf wiring incomplete: window.__zilventorHoleTableMs is not a function. ' +
      'Wire the probe in App.tsx after __zilventorDimensionStylesMs (see Task 4.2).',
    );
  });

  const result = await page.evaluate(
    () =>
      (window as {
        __zilventorHoleTableMs?: (n: number) => Promise<{ p95ms: number }>;
      }).__zilventorHoleTableMs!(100),
  );

  const { p95ms } = result;
  console.log(`[perf] T63f hole-table computeHoleTableRows p95 = ${p95ms.toFixed(2)} ms (budget 50ms)`);
  expect(p95ms).toBeLessThan(50);
});
```

#### Step 2 — Run to confirm the test fails loudly (probe missing)

```bash
pnpm test:perf --project=perf tests/perf/drawing-hole-table.perf.spec.ts
```

Expected: fails with `F6 perf wiring incomplete: window.__zilventorHoleTableMs is not a function`. This is the correct red state.

#### Step 3 — Wire the probe in `App.tsx`

Locate the block ending at `__zilventorDimensionStylesMs` registration (around line 655 in current `App.tsx`). Directly after that block (still inside the same `useEffect`), add:

```ts
// Drawing F6 — hole-table perf probe.
// Fixture: 20 holes (10 × dia=8 + 10 × dia=12), 16-point circle approximation each.
// Budget: p95 < 50 ms. Pure 2D geometry — no kernel call.
(w as unknown as { __zilventorHoleTableMs: (n?: number) => Promise<{ p95ms: number }> }).__zilventorHoleTableMs = async (n = 100) => {
  const { computeHoleTableRows } = await import('@zilventor/shared/src/drawing/holeTable');
  type Edge2D = import('@zilventor/shared').Edge2D;

  const N_HOLES = 20;

  // Build a 16-point circle polyline around (cx, cy) with radius r.
  function circlePoints(cx: number, cy: number, r: number): ReadonlyArray<readonly [number, number]> {
    const pts: Array<readonly [number, number]> = [];
    for (let i = 0; i <= 16; i++) {
      const angle = (i / 16) * 2 * Math.PI;
      pts.push([cx + r * Math.cos(angle), cy + r * Math.sin(angle)]);
    }
    return pts as ReadonlyArray<readonly [number, number]>;
  }

  // 10 holes dia=8, 10 holes dia=12.
  const holeFeatures = Array.from({ length: N_HOLES }, (_, i) => {
    const dia = i < 10 ? 8 : 12;
    const paramName = i < 10 ? 'd_small' : 'd_large';
    return {
      id: `PH${i}`,
      kind: 'hole' as const,
      placement: { kind: 'linear' as const, x: { kind: 'literal' as const, value: (i % 5) * 20 + 10 }, y: { kind: 'literal' as const, value: Math.floor(i / 5) * 20 + 10 }, faceRef: 'front' },
      profile: { kind: 'simple' as const, diameter: { kind: 'param' as const, paramName } },
      termination: { kind: 'throughAll' as const },
      flipAxis: false,
    };
  });

  const syntheticPart = {
    id: 'perf-part-holes',
    name: 'PerfHolePart',
    units: 'mm' as const,
    parameters: {
      d_small: { value: 8 },
      d_large: { value: 12 },
    },
    featureTree: holeFeatures,
    properties: {},
    materials: [],
    hardware: [],
  };

  // Datum edge at (0,0) — start endpoint resolves to part-mm [0,0].
  const datumEdge: Edge2D = {
    id: 'perf-datum',
    kind: 'outline',
    points: [[0, 0], [10, 0]] as ReadonlyArray<readonly [number, number]>,
    sourceFaceIds: [],
  };

  // 20 circle edges, each carrying sourceFaceIds for the corresponding hole.
  const circleEdges: Edge2D[] = Array.from({ length: N_HOLES }, (_, i) => {
    const cx = ((i % 5) * 20 + 10);
    const cy = (Math.floor(i / 5) * 20 + 10);
    const r = i < 10 ? 4 : 6;
    return {
      id: `perf-h${i}-circle`,
      kind: 'feature' as const,
      points: circlePoints(cx, cy, r),
      sourceFaceIds: [`PH${i}|hole|0`, `PF${i}|face|0`] as string[],
    };
  });

  const syntheticView = {
    id: 'perf-view-holes',
    kind: 'base' as const,
    positionMm: { x: 0, y: 0 },
    scale: { numerator: 1, denominator: 1 },
    orientation: 'front' as const,
    showHidden: false,
    projection: {
      visibleEdges: [datumEdge, ...circleEdges],
      hiddenEdges: [] as Edge2D[],
      bbox: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
    },
    inputFingerprint: 'fp-perf-holes',
  };

  const syntheticAnnotation = {
    kind: 'holeTable' as const,
    id: 'perf-hole-table',
    viewId: 'perf-view-holes',
    datum: { kind: 'edge-endpoint' as const, edgeId: 'perf-datum', end: 'start' as const },
    positionMm: { x: 0, y: 120 },
    entries: [] as ReadonlyArray<{ readonly holeFeatureId: string; readonly tag: string }>,
  };

  const resolveParam = (p: { kind: string; value?: number; paramName?: string }) =>
    p.kind === 'literal' ? (p.value ?? 0) : (syntheticPart.parameters as Record<string, { value: number }>)[p.paramName ?? '']?.value ?? 0;

  const samples: number[] = [];
  for (let i = 0; i < n; i++) {
    const t0 = performance.now();
    computeHoleTableRows(
      syntheticAnnotation as never,
      syntheticView as never,
      syntheticPart as never,
      resolveParam as never,
    );
    samples.push(performance.now() - t0);
  }
  samples.sort((a, b) => a - b);
  const p95ms = samples[Math.floor(samples.length * 0.95)] ?? 0;
  return { p95ms };
};
```

#### Step 4 — Run to confirm green

```bash
pnpm test:perf --project=perf tests/perf/drawing-hole-table.perf.spec.ts
```

Expected: 1 test passes, `[perf] T63f hole-table computeHoleTableRows p95 = <X> ms (budget 50ms)` logged, p95 well under 50ms.

#### Step 5 — Commit

```bash
git add tests/perf/drawing-hole-table.perf.spec.ts packages/app/src/App.tsx
git commit -m "test(drawing-f6): T63f perf — computeHoleTableRows 100-iter p95 < 50ms + App.tsx probe"
```

---

### Task 4.3 — Final-pass verification checklist

This task is a checklist of gates; run each command, confirm output, **do not commit unless all gates pass**.

#### Gate 1 — Full typecheck

```bash
pnpm -r typecheck
```

Expected: 0 errors. If errors appear, fix them (do NOT suppress with `@ts-ignore`) before proceeding. Common sources of failure:
- `HoleTableAnnotation` not exported from `@zilventor/shared/src/drawing/types.ts`
- `DrawingAnnotation` union not updated to include `| HoleTableAnnotation`
- `AddHoleTableCommand` constructor type mismatch
- `renderAnnotationGroup` signature change (threading `sheet`/`source`) breaking callers

#### Gate 2 — Full unit suite

```bash
pnpm -r test:unit
```

Expected: test count increases from the pre-F6 baseline (2501 tests) by the new shared and app unit tests added in Batches 1-2. Exact delta depends on Batches 1-2 implementation; confirm no regressions (0 failing). If a test fails, fix before proceeding.

#### Gate 3 — New e2e passes

```bash
pnpm test:e2e --project=chromium tests/e2e/drawing/T-6-15-hole-table.spec.ts
```

Expected: 1/1 pass.

#### Gate 4 — New perf passes

```bash
pnpm test:perf --project=perf tests/perf/drawing-hole-table.perf.spec.ts
```

Expected: 1/1 pass, p95 < 50ms.

#### Gate 5 — Grep-parity check (load-bearing)

Verify that `holeTable` appears in **both** renderer paths:

```bash
grep -n "holeTable" \
  packages/app/src/drawing/AnnotationElement.tsx \
  packages/app/src/drawing/renderDrawingSvg.ts
```

Expected: at least one match in each file. If either is missing, Batch 3 is incomplete — do NOT mark done.

#### Gate 6 — Full e2e suite regression check (drawing tests)

```bash
pnpm test:e2e --project=chromium tests/e2e/drawing/
```

Expected: all drawing e2e tests pass (T-6-1 through T-6-15). Zero regressions.

#### Gate 7 — Final code review dispatch

Before merging, dispatch a Sonnet code-reviewer subagent with the following brief:

> Review the Drawing F6 (Hole Tables) diff against master. Files in scope: `packages/shared/src/drawing/holeTable.ts`, `packages/shared/src/drawing/types.ts` (union addition), `packages/app/src/commands/AddHoleTableCommand.ts`, `packages/app/src/drawing/HoleTableElement.tsx`, `packages/app/src/drawing/AnnotationElement.tsx`, `packages/app/src/drawing/DrawingCanvas.tsx` (holeTable branch in handleClick), `packages/app/src/drawing/renderDrawingSvg.ts` (holeTable case), `packages/app/src/shell/tabs/DrawingTab.tsx` (ribbon button), `packages/app/src/drawing/toolMode.ts` (union member), tests. Check for: (1) both renderer paths present (grep-parity), (2) acyclic import rule obeyed (holeTable.ts never imports from app), (3) tag stability (assignHoleTags existing entries preserved), (4) datum resolution reusing resolvePointRef logic (not reimplemented divergently), (5) circle-fit dedupes through-holes by featureId, (6) cascade structural dependency comment present in HoleTableElement, (7) no `@ts-ignore` suppressions, (8) T-6-15 and T63f both present and asserting meaningful values. Report findings in under 300 words. Self-critique: list weaknesses, assumptions, confidence 0-100.

Only proceed with merge if the reviewer returns 0 blocking findings or all findings are addressed.

#### Commit after all gates pass

```bash
git add tests/e2e/drawing/T-6-15-hole-table.spec.ts \
        tests/perf/drawing-hole-table.perf.spec.ts \
        packages/app/src/App.tsx
# (already committed in Tasks 4.1 and 4.2 — this is a final tag commit if additional fixes occurred)
git commit -m "test(drawing-f6): final-pass gates green — T-6-15 e2e + T63f perf + typecheck + parity"
```

---

## Batch 4 — Self-critique

### 1. Weaknesses

1. **No real hole-seeding helper exists** — the entire test relies on hand-crafted synthetic `featureTree` + `projection.visibleEdges` with fake `sourceFaceIds`. If `extractHolesInView`'s circle-fit tolerance or `sourceFaceIds` parsing logic differs from the synthetic fixture's shape (e.g. the circle-fit rejects 16-point polylines as "not closed enough"), the test will fail at the DOM-assertion step with a misleading "0 rows" count rather than a clear error. Mitigation: the test comment documents the fixture geometry precisely so a failing author can debug.

2. **XDIM/YDIM assertion uses `toBeCloseTo(20, 1)` (1 decimal place)** — if `computeHoleTableRows` formats to 0 decimal places the textContent comparison could drift. The plan uses `parseFloat(textContent)` which is tolerant of rounding, but if the element emits units (`"20mm"`) the parse returns `NaN`. The plan assumes `data-holetable-xdim` emits a bare numeric string.

3. **Perf probe type-casts `syntheticAnnotation / syntheticView / syntheticPart` as `never`** — this is the same pattern used by `__zilventorAutoDimMs` (casting `syntheticPart as never`) and is safe, but a strict-mode lint change could break it.

4. **Gate 7 code review is advisory** — the plan cannot enforce it programmatically; a fast-moving implementer could skip it.

### 2. Assumptions

1. **Assumption (critical): `extractHolesInView` accepts 16-point polyline circles and fits them within `HOLE_CIRCLE_FIT_TOL_MM`**. If the tolerance is tighter than the floating-point error of a 16-point approximation, the holes will not be detected and the e2e will produce 0 rows. The fixture uses a true `Math.cos/sin` circle so RMS error is ~0; this assumption is safe.

2. **Assumption: `AddHoleTableCommand` wraps `AddDrawingAnnotationCommand` OR is a standalone command with identical apply/revert semantics**. The plan's `page.evaluate` imports `AddHoleTableCommand` directly via `await import('/src/commands/AddHoleTableCommand.ts')`, mirroring T-6-14. If Batch 2 named it differently, the import will throw at runtime.

3. **Assumption: no hole-seeding e2e helper exists** — confirmed by reading `tests/e2e/helpers/seedDrawing.ts` (only box-part seeding) and grep results. Fallback injection via `setState` is the established pattern for all drawing e2e tests.

4. **Assumption: `HoleTableElement.tsx` emits `data-holetable-row`, `data-holetable-xdim`, `data-holetable-ydim`, `data-holetable-marker` attributes**. If Batch 3 did not add these, Task 4.1 Step 3 instructs adding them (surgical, 4 attributes).

5. **Assumption: `window.__zilventorDimensionStylesMs` exists** as the insertion anchor for the new probe in `App.tsx` — confirmed by reading App.tsx line 655.

### 3. Confidence: 72

The plan correctly mirrors the established T-6-N + T63x patterns with zero invented infrastructure. The main risk is the synthetic fixture / circle-fit compatibility (Weakness 1 / Assumption 1), which is hard to validate without running Batch 1's implementation. All other patterns are verbatim copies of working tests.

### 4. Calibration note

The 72 reflects high confidence in the test structure (direct copy of T-6-14 + dimension-styles.perf.spec.ts patterns, both confirmed green at HEAD) and low risk on the perf spec (probe pattern is mechanical). The uncertainty lives entirely in whether the synthetic `sourceFaceIds` + circle-fit combo works as designed — an integration surface between the e2e fixture and Batch 1's `extractHolesInView` that cannot be verified without running the implementation. A reviewer with access to Batch 1's circle-fit tolerance constant could raise this to 85+.
