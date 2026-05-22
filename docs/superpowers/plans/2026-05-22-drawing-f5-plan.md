# Drawing F5 — Baseline / Ordinate / Angular Dimension Styles · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/superpowers/specs/2026-05-22-drawing-f5-design.md` (committed at `2a6b399`).

**Goal:** Land three new ANSI dimension layout styles — Baseline (datum-stacked linear dims), Ordinate (origin-based coordinate dims with L-leaders), and Angular (arc dims for line-line and arc-sweep angles) — including AutoDim extension for `dim-angle` sketch constraints.

**Architecture:** Additive on manifest v18. Three new variants in the `DrawingDimension` discriminated union (`baseline`, `ordinate`, `angular`) plus a new `DimensionGroup[]` collection on `DrawingSheet` for baseline/ordinate group-level state (datum, spacing, origin, column offsets). Baseline members carry an explicit 0-indexed `slot` field for deterministic stack ordering. All new kinds inherit the F4 cascade-text pattern (`textOverride` / `sourceParameterName` / computed). Three new `ToolMode`s with multi-click sessions in `DrawingCanvas.tsx`. AutoDimCommand gets a third constraint-handler branch (`dim-angle` → angular dim). Manifest unchanged.

**Tech Stack:** TypeScript strict, React (Zustand store), Vite, Vitest (unit), Playwright (E2E + perf), pnpm workspaces, 5 packages (`shared`, `sketcher-worker`, `kernel`, `app`, + project root). Test infra: existing 2232 unit tests + 11 drawing E2E (T-6-1..T-6-11) + 9 perf specs.

**Total scope:** 3 batches, 35 tasks (F5-T1..F5-T34 + verify), ~6070 lines of plan. Mirrors F4 cadence.

---

## Cross-part reconciliation notes (READ BEFORE STARTING)

The plan was authored by three parallel Sonnet writers (one per batch). Each writer self-critiqued and flagged the following risks. Implementers and reviewers MUST address them:

1. **(Part 1) `renderDimensionGroup` signature change.** Task F5-T8 adds a `dimensionGroups` parameter to a render helper. If any unverified call site of this helper exists outside `renderDrawingSvg.ts`, the implementer hits a compile error. **Action:** before starting F5-T8, grep `renderDimensionGroup\|renderBaselineDim\|renderOrdinateDim` across `packages/app/src/` to confirm no external callers. If found, update them in the same task.

2. **(Part 2) Batch ordering dependency.** All Batch 2 commands import `DimensionGroup` and the new dim kinds from Batch 1's types. **Batch 1 MUST land on the working branch (committed) before Batch 2 begins.** If parallel batches are attempted, Batch 2 will fail typecheck. The subagent-driven-development orchestrator should enforce serial Batch 1 → Batch 2 → Batch 3 ordering. Per-batch reviewers gate this.

3. **(Part 3) `data-edge-kind="arc"` attribute.** Task F5-T27 (angular session) branches on whether a clicked edge is an arc to dispatch the single-click `ref: 'arc'` variant vs the two-click `ref: 'two-edges'` variant. The plan assumes `ViewElement` renders arc-kind edges with `data-edge-kind="arc"`. **Action:** before starting F5-T27, grep `data-edge-kind` in `packages/app/src/drawing/ViewElement.tsx` (or wherever edges are rendered). If absent, add the attribute as a small additional step in F5-T27 (read `Edge2D.kind` from the projection, emit the attribute). The implementer must verify before greening the test.

4. **(General) Plan size.** 6070 lines + 35 tasks. Per-batch review policy: Batches 1-2 get full 2-stage review (spec compliance + code quality, separate dispatches); Batch 3 gets combined spec+code review (single dispatch). Final-pass review is **mandatory** before FF merge.

5. **(General) Mid-flight Playwright verification** for Batch 3 UI work is mandatory per CLAUDE.md §6 + `feedback_drive_ui_mid_flight`. Controller MUST `Read` the screenshots back; do not accept implementer's claim sight-unseen.

---

## Worktree setup (before starting Batch 1)

```bash
git worktree add .worktrees/drawing-f5 -b feature/drawing-f5
cd .worktrees/drawing-f5
```

All implementation occurs in the worktree. Branch finalization (§ Branch finalization at end of Batch 3) FF-merges back to `master`.

---

## Batch 1 — Types + Render + Unit tests

**Goal:** Land all type changes, math helpers, and render switch cases. Pure shared-package + render-only work. No commands, no UI.

**Owner per task:** Sonnet implementer subagent.

---

### F5-T1 — Add `DimensionGroup` discriminated union type

**Red step first. Commit last.**

#### Step 1.1 — Write failing test

File: `packages/shared/src/drawing/__tests__/dimensionGroups.spec.ts` (create new file)

```ts
// packages/shared/src/drawing/__tests__/dimensionGroups.spec.ts
import { describe, it, expect } from 'vitest';
import type { DimensionGroup } from '../types';

describe('DimensionGroup type — HS-DG-1: baseline group shape', () => {
  it('can construct a baseline DimensionGroup literal', () => {
    const g: DimensionGroup = {
      kind: 'baseline',
      id: 'g1',
      viewId: 'v1',
      datum: { kind: 'edge-endpoint', edgeId: 'e1', end: 'start' },
      direction: 'h',
      baseOffsetMm: 20,
      spacingMm: 10,
    };
    expect(g.kind).toBe('baseline');
  });
});

describe('DimensionGroup type — HS-DG-2: ordinate group shape', () => {
  it('can construct an ordinate DimensionGroup literal', () => {
    const g: DimensionGroup = {
      kind: 'ordinate',
      id: 'g2',
      viewId: 'v1',
      origin: { kind: 'edge-endpoint', edgeId: 'e2', end: 'start' },
      xColumnOffsetMm: 30,
      yColumnOffsetMm: 25,
    };
    expect(g.kind).toBe('ordinate');
  });
});
```

Run: `pnpm --filter @zilventor/shared test:unit --run packages/shared/src/drawing/__tests__/dimensionGroups.spec.ts`

Expected failure: `Cannot find module '../types'` will succeed with import but TypeScript will emit `Type 'DimensionGroup' does not exist` — either a compile error or a runtime `undefined` if running in transpile-only mode. The test file imports a type that does not yet exist, so TypeScript strict mode rejects it during type-check, and the test runner will report a type or import error.

#### Step 1.2 — Add `DimensionGroup` type to `packages/shared/src/drawing/types.ts`

Insert after line 233 (after the `DrawingDimension` union closing `;`), before `DrawingAnnotation`:

```ts
// ---------------------------------------------------------------------------
// EdgeRef — used by angular/radial/diametric dimensions to reference edges
// ---------------------------------------------------------------------------

export type EdgeRef = {
  readonly viewId: string;
  readonly edgeId: string;
};

// ---------------------------------------------------------------------------
// DimensionGroup — baseline and ordinate group-level state (F5)
// ---------------------------------------------------------------------------

export type DimensionGroup =
  | {
      readonly kind: 'baseline';
      readonly id: string;
      readonly viewId: string;
      readonly datum: PointRef;
      readonly direction: 'h' | 'v';
      readonly baseOffsetMm: number;
      readonly spacingMm: number;
    }
  | {
      readonly kind: 'ordinate';
      readonly id: string;
      readonly viewId: string;
      readonly origin: PointRef;
      readonly xColumnOffsetMm: number;
      readonly yColumnOffsetMm: number;
    };
```

Run: `pnpm --filter @zilventor/shared test:unit --run packages/shared/src/drawing/__tests__/dimensionGroups.spec.ts`

Expected: both tests pass (green).

#### Step 1.3 — Export from `packages/shared/src/index.ts`

In the `DrawingDocument, DrawingSheet, ...` re-export line (near the bottom of the file), add `DimensionGroup` and `EdgeRef` to the named type export list.

Exact change — find this line:
```ts
export type { DrawingDocument, DrawingSource, DrawingSheet, SheetSize, DrawingView, BaseView, ProjectedView, IsoView, ViewScale, DrawingDimension, DrawingAnnotation, TitleBlockOverrides, SectionView, HatchSegment, Vec2, DetailView, RegionParent, BreakRegion } from './drawing/types';
```

Replace with:
```ts
export type { DrawingDocument, DrawingSource, DrawingSheet, SheetSize, DrawingView, BaseView, ProjectedView, IsoView, ViewScale, DrawingDimension, DrawingAnnotation, TitleBlockOverrides, SectionView, HatchSegment, Vec2, DetailView, RegionParent, BreakRegion, DimensionGroup, EdgeRef } from './drawing/types';
```

Run: `pnpm -r typecheck` — should remain green.

#### Step 1.4 — Commit

Files: `packages/shared/src/drawing/types.ts`, `packages/shared/src/index.ts`, `packages/shared/src/drawing/__tests__/dimensionGroups.spec.ts`

```
feat(drawing-f5): add DimensionGroup + EdgeRef types (T1)
```

---

### F5-T2 — Add `baseline`, `ordinate`, `angular` kinds to `DrawingDimension`

#### Step 2.1 — Write failing tests

Add to `packages/shared/src/drawing/__tests__/dimensionGroups.spec.ts`:

```ts
import type { DrawingDimension } from '../types';

describe('DrawingDimension — HS-DD-1: baseline kind shape', () => {
  it('can construct a baseline DrawingDimension literal', () => {
    const d: DrawingDimension = {
      kind: 'baseline',
      id: 'd1',
      viewId: 'v1',
      groupId: 'g1',
      slot: 0,
      to: { kind: 'edge-endpoint', edgeId: 'e1', end: 'end' },
    };
    expect(d.kind).toBe('baseline');
  });
});

describe('DrawingDimension — HS-DD-2: ordinate kind shape', () => {
  it('can construct an ordinate DrawingDimension literal', () => {
    const d: DrawingDimension = {
      kind: 'ordinate',
      id: 'd2',
      viewId: 'v1',
      groupId: 'g2',
      to: { kind: 'edge-endpoint', edgeId: 'e2', end: 'end' },
      axis: 'x',
    };
    expect(d.kind).toBe('ordinate');
  });
});

describe('DrawingDimension — HS-DD-3: angular kind (two-edges)', () => {
  it('can construct an angular DrawingDimension with two-edges ref', () => {
    const d: DrawingDimension = {
      kind: 'angular',
      id: 'd3',
      viewId: 'v1',
      ref: {
        kind: 'two-edges',
        edge1: { viewId: 'v1', edgeId: 'e1' },
        edge2: { viewId: 'v1', edgeId: 'e2' },
      },
      arcSide: 'inside',
      offsetMm: 15,
    };
    expect(d.kind).toBe('angular');
  });
});

describe('DrawingDimension — HS-DD-4: angular kind (arc)', () => {
  it('can construct an angular DrawingDimension with arc ref', () => {
    const d: DrawingDimension = {
      kind: 'angular',
      id: 'd4',
      viewId: 'v1',
      ref: { kind: 'arc', edge: { viewId: 'v1', edgeId: 'e-arc' } },
      arcSide: 'outside',
      offsetMm: 8,
    };
    expect(d.kind).toBe('angular');
  });
});
```

Run: `pnpm --filter @zilventor/shared test:unit --run packages/shared/src/drawing/__tests__/dimensionGroups.spec.ts`

Expected failure: TypeScript/ts-jest/vitest will reject `kind: 'baseline'` because it is not a member of the current `DrawingDimension` union. Error message: `Type '"baseline"' is not assignable to type '"linear-h" | "linear-v" | "aligned" | "radial" | "diametric"'`.

#### Step 2.2 — Extend `DrawingDimension` union

In `packages/shared/src/drawing/types.ts`, replace the closing `;` of the `DrawingDimension` union with three new variants. The current union ends at line 233:

```ts
  | { readonly id: string; readonly kind: 'diametric'; readonly viewId: string; readonly edgeId: string; readonly offsetMm: number; readonly angleDeg: number };
```

Change to (append the new variants before the `;`):

```ts
  | { readonly id: string; readonly kind: 'diametric'; readonly viewId: string; readonly edgeId: string; readonly offsetMm: number; readonly angleDeg: number }
  | {
      readonly kind: 'baseline';
      readonly id: string;
      readonly viewId: string;
      readonly groupId: string;
      readonly slot: number;
      readonly to: PointRef;
      readonly sourceParameterName?: string;
      readonly textOverride?: string;
    }
  | {
      readonly kind: 'ordinate';
      readonly id: string;
      readonly viewId: string;
      readonly groupId: string;
      readonly to: PointRef;
      readonly axis: 'x' | 'y';
      readonly sourceParameterName?: string;
      readonly textOverride?: string;
    }
  | {
      readonly kind: 'angular';
      readonly id: string;
      readonly viewId: string;
      readonly ref:
        | { readonly kind: 'two-edges'; readonly edge1: EdgeRef; readonly edge2: EdgeRef }
        | { readonly kind: 'arc';       readonly edge: EdgeRef };
      readonly arcSide: 'inside' | 'outside';
      readonly offsetMm: number;
      readonly sourceParameterName?: string;
      readonly textOverride?: string;
    };
```

Run: `pnpm --filter @zilventor/shared test:unit --run packages/shared/src/drawing/__tests__/dimensionGroups.spec.ts`

Expected: all 6 tests (2 from T1 + 4 new) pass.

Run: `pnpm -r typecheck` — green.

#### Step 2.3 — Commit

Files: `packages/shared/src/drawing/types.ts`, `packages/shared/src/drawing/__tests__/dimensionGroups.spec.ts`

```
feat(drawing-f5): extend DrawingDimension with baseline/ordinate/angular kinds (T2)
```

---

### F5-T3 — Add `dimensionGroups` to `DrawingSheet`; JSON-parse default `[]`

#### Step 3.1 — Write failing test

Add to `packages/shared/src/drawing/__tests__/dimensionGroups.spec.ts`:

```ts
import type { DrawingSheet } from '../types';

describe('DrawingSheet — HS-DS-1: dimensionGroups field present', () => {
  it('DrawingSheet type accepts dimensionGroups field', () => {
    const sheet: DrawingSheet = {
      id: 's1',
      name: 'Sheet 1',
      size: { kind: 'iso', size: 'A3' },
      orientation: 'landscape',
      views: [],
      dimensions: [],
      annotations: [],
      titleBlock: {},
      dimensionGroups: [],
    };
    expect(sheet.dimensionGroups).toHaveLength(0);
  });
});
```

Run: `pnpm --filter @zilventor/shared test:unit --run packages/shared/src/drawing/__tests__/dimensionGroups.spec.ts`

Expected failure: `Object literal may only specify known properties, and 'dimensionGroups' does not exist in type 'DrawingSheet'`.

#### Step 3.2 — Add `dimensionGroups` to `DrawingSheet` in `packages/shared/src/drawing/types.ts`

Find the `DrawingSheet` type (currently lines 265–274). Add one field:

```ts
export type DrawingSheet = {
  readonly id: string;
  readonly name: string;
  readonly size: SheetSize;
  readonly orientation: 'landscape' | 'portrait';
  readonly views: readonly DrawingView[];
  readonly dimensions: readonly DrawingDimension[];
  readonly annotations: readonly DrawingAnnotation[];
  readonly titleBlock: TitleBlockOverrides;
  readonly dimensionGroups: readonly DimensionGroup[];   // F5: additive on v18; defaults to [] on load
};
```

#### Step 3.3 — Add JSON-parse default in `packages/shared/src/fileFormat.ts`

Find the function `migrateManifest` (or wherever `DrawingSheet` is constructed from raw JSON). Grep confirms there is no dedicated sheet parser — sheets are deserialized directly from JSON. The place to add the default is in the `normalizeKind` / post-migration normalization, or in a new `normalizeDrawingDoc` helper called from `migrateManifest`.

The correct pattern (matching how other additive v18 fields work) is to add a post-migration normalization step. Add this helper **before** `migrateManifest`:

```ts
function backfillDrawingF5(m: AnyManifest): AnyManifest {
  const anyM = m as { kind?: string; document?: { sheets?: Array<Record<string, unknown>> } };
  if (anyM.kind !== 'drawing' || !anyM.document?.sheets) return m;
  for (const sheet of anyM.document.sheets) {
    if (!Array.isArray(sheet['dimensionGroups'])) {
      sheet['dimensionGroups'] = [];
    }
  }
  return m;
}
```

Then in `migrateManifest`, add `backfillDrawingF5` to the final normalization pipeline (the last `return` statement currently reads):

```ts
return migrateSketchPlanes(injectOriginFeatures(backfillAssembly4b(normalizeKind(current))));
```

Change to:

```ts
return backfillDrawingF5(migrateSketchPlanes(injectOriginFeatures(backfillAssembly4b(normalizeKind(current)))));
```

Run: `pnpm --filter @zilventor/shared test:unit --run packages/shared/src/drawing/__tests__/dimensionGroups.spec.ts`

Expected: 7 tests pass.

Run: `pnpm -r typecheck` — green.

#### Step 3.4 — Commit

Files: `packages/shared/src/drawing/types.ts`, `packages/shared/src/fileFormat.ts`, `packages/shared/src/drawing/__tests__/dimensionGroups.spec.ts`

```
feat(drawing-f5): add dimensionGroups to DrawingSheet + JSON-parse default [] (T3)
```

---

### F5-T4 — Math helper `intersectLines`

#### Step 4.1 — Write failing test

Create `packages/shared/src/drawing/__tests__/dimensionMath.spec.ts`:

```ts
// packages/shared/src/drawing/__tests__/dimensionMath.spec.ts
import { describe, it, expect } from 'vitest';
import { intersectLines } from '../dimensionMath';

describe('intersectLines — HS-MATH-1: perpendicular lines', () => {
  it('returns intersection of horizontal and vertical line', () => {
    const result = intersectLines(
      { p0: { x: 0, y: 5 }, p1: { x: 10, y: 5 } },   // horizontal y=5
      { p0: { x: 3, y: 0 }, p1: { x: 3, y: 10 } },   // vertical x=3
    );
    expect(result).not.toBeNull();
    expect(result!.x).toBeCloseTo(3, 6);
    expect(result!.y).toBeCloseTo(5, 6);
  });
});

describe('intersectLines — HS-MATH-2: parallel lines return null', () => {
  it('returns null for parallel horizontal lines', () => {
    const result = intersectLines(
      { p0: { x: 0, y: 0 }, p1: { x: 10, y: 0 } },
      { p0: { x: 0, y: 5 }, p1: { x: 10, y: 5 } },
    );
    expect(result).toBeNull();
  });
});

describe('intersectLines — HS-MATH-3: diagonal lines', () => {
  it('returns intersection of two diagonal lines', () => {
    // y = x  (p0=(0,0), p1=(1,1))
    // y = -x + 4  (p0=(0,4), p1=(4,0))
    // Intersection: x = 2, y = 2
    const result = intersectLines(
      { p0: { x: 0, y: 0 }, p1: { x: 1, y: 1 } },
      { p0: { x: 0, y: 4 }, p1: { x: 4, y: 0 } },
    );
    expect(result).not.toBeNull();
    expect(result!.x).toBeCloseTo(2, 6);
    expect(result!.y).toBeCloseTo(2, 6);
  });
});

describe('intersectLines — HS-MATH-4: collinear lines return null', () => {
  it('returns null for collinear (same line) inputs', () => {
    const result = intersectLines(
      { p0: { x: 0, y: 0 }, p1: { x: 5, y: 0 } },
      { p0: { x: 1, y: 0 }, p1: { x: 8, y: 0 } },
    );
    expect(result).toBeNull();
  });
});
```

Run: `pnpm --filter @zilventor/shared test:unit --run packages/shared/src/drawing/__tests__/dimensionMath.spec.ts`

Expected failure: `Cannot find module '../dimensionMath'`.

#### Step 4.2 — Create `packages/shared/src/drawing/dimensionMath.ts`

```ts
// packages/shared/src/drawing/dimensionMath.ts

export type Point2 = { readonly x: number; readonly y: number };
export type Vec2D  = { readonly x: number; readonly y: number };

const EPSILON = 1e-10;

/**
 * Computes the intersection of two infinite lines defined by two points each.
 * Returns null when the lines are parallel or collinear (determinant ≈ 0).
 */
export function intersectLines(
  line1: { readonly p0: Point2; readonly p1: Point2 },
  line2: { readonly p0: Point2; readonly p1: Point2 },
): Point2 | null {
  const dx1 = line1.p1.x - line1.p0.x;
  const dy1 = line1.p1.y - line1.p0.y;
  const dx2 = line2.p1.x - line2.p0.x;
  const dy2 = line2.p1.y - line2.p0.y;

  const det = dx1 * dy2 - dy1 * dx2;
  if (Math.abs(det) < EPSILON) return null;   // parallel or collinear

  const diffX = line2.p0.x - line1.p0.x;
  const diffY = line2.p0.y - line1.p0.y;
  const t = (diffX * dy2 - diffY * dx2) / det;

  return {
    x: line1.p0.x + t * dx1,
    y: line1.p0.y + t * dy1,
  };
}
```

Run: `pnpm --filter @zilventor/shared test:unit --run packages/shared/src/drawing/__tests__/dimensionMath.spec.ts`

Expected: 4 tests pass.

#### Step 4.3 — Commit

Files: `packages/shared/src/drawing/dimensionMath.ts`, `packages/shared/src/drawing/__tests__/dimensionMath.spec.ts`

```
feat(drawing-f5): add intersectLines math helper (T4)
```

---

### F5-T5 — Math helper `subtendedAngle`

#### Step 5.1 — Write failing tests

Add to `packages/shared/src/drawing/__tests__/dimensionMath.spec.ts`:

```ts
import { subtendedAngle } from '../dimensionMath';

describe('subtendedAngle — HS-MATH-5: same direction (0°)', () => {
  it('returns insideRad ≈ 0 for identical unit vectors', () => {
    const result = subtendedAngle({ x: 1, y: 0 }, { x: 1, y: 0 });
    expect(result.insideRad).toBeCloseTo(0, 6);
    expect(result.outsideRad).toBeCloseTo(2 * Math.PI, 5);
  });
});

describe('subtendedAngle — HS-MATH-6: perpendicular (90°)', () => {
  it('returns insideRad ≈ π/2 for perpendicular vectors', () => {
    const result = subtendedAngle({ x: 1, y: 0 }, { x: 0, y: 1 });
    expect(result.insideRad).toBeCloseTo(Math.PI / 2, 6);
    expect(result.outsideRad).toBeCloseTo(3 * Math.PI / 2, 6);
  });
});

describe('subtendedAngle — HS-MATH-7: opposite directions (180°)', () => {
  it('returns insideRad ≈ π for anti-parallel vectors', () => {
    const result = subtendedAngle({ x: 1, y: 0 }, { x: -1, y: 0 });
    expect(result.insideRad).toBeCloseTo(Math.PI, 5);
    expect(result.outsideRad).toBeCloseTo(Math.PI, 5);
  });
});
```

Run: `pnpm --filter @zilventor/shared test:unit --run packages/shared/src/drawing/__tests__/dimensionMath.spec.ts`

Expected failure: `subtendedAngle is not a function`.

#### Step 5.2 — Add `subtendedAngle` to `packages/shared/src/drawing/dimensionMath.ts`

Append to the file:

```ts
/**
 * Returns inside and outside subtended angles between two unit (or non-unit) direction vectors.
 * `insideRad` = acos(dot(d1, d2)) — always in [0, π].
 * `outsideRad` = 2π − insideRad.
 */
export function subtendedAngle(
  d1: Vec2D,
  d2: Vec2D,
): { readonly insideRad: number; readonly outsideRad: number } {
  const dot = d1.x * d2.x + d1.y * d2.y;
  const len1 = Math.sqrt(d1.x * d1.x + d1.y * d1.y);
  const len2 = Math.sqrt(d2.x * d2.x + d2.y * d2.y);
  const cosA = len1 * len2 > EPSILON ? dot / (len1 * len2) : 1;
  const insideRad = Math.acos(Math.max(-1, Math.min(1, cosA)));  // clamp against floating-point overshoot
  return { insideRad, outsideRad: 2 * Math.PI - insideRad };
}
```

Run: `pnpm --filter @zilventor/shared test:unit --run packages/shared/src/drawing/__tests__/dimensionMath.spec.ts`

Expected: all tests pass.

#### Step 5.3 — Commit

Files: `packages/shared/src/drawing/dimensionMath.ts`, `packages/shared/src/drawing/__tests__/dimensionMath.spec.ts`

```
feat(drawing-f5): add subtendedAngle math helper (T5)
```

---

### F5-T6 — Math helper `formatAngleDeg`

#### Step 6.1 — Write failing tests

Add to `packages/shared/src/drawing/__tests__/dimensionMath.spec.ts`:

```ts
import { formatAngleDeg } from '../dimensionMath';

describe('formatAngleDeg — HS-FMT-1: exact integer', () => {
  it('formats π/4 rad as "45°"', () => {
    expect(formatAngleDeg(Math.PI / 4)).toBe('45°');
  });
});

describe('formatAngleDeg — HS-FMT-2: one decimal', () => {
  it('formats 30.5 degrees without trailing zeros', () => {
    expect(formatAngleDeg(30.5 * Math.PI / 180)).toBe('30.5°');
  });
});

describe('formatAngleDeg — HS-FMT-3: three decimal max', () => {
  it('caps at 3 decimals', () => {
    // 1/3 degrees = 0.3333... → trimmed to "0.333°"
    const rad = (1 / 3) * Math.PI / 180;
    const result = formatAngleDeg(rad);
    expect(result).toBe('0.333°');
  });
});

describe('formatAngleDeg — HS-FMT-4: explicit decimals param', () => {
  it('respects explicit decimals=1 override', () => {
    // π/6 = 30.000° → with decimals=1 → "30°"
    expect(formatAngleDeg(Math.PI / 6, 1)).toBe('30°');
  });
});

describe('formatAngleDeg — HS-FMT-5: zero radians', () => {
  it('formats 0 radians as "0°"', () => {
    expect(formatAngleDeg(0)).toBe('0°');
  });
});
```

Run: `pnpm --filter @zilventor/shared test:unit --run packages/shared/src/drawing/__tests__/dimensionMath.spec.ts`

Expected failure: `formatAngleDeg is not a function`.

#### Step 6.2 — Add `formatAngleDeg` to `packages/shared/src/drawing/dimensionMath.ts`

Append to the file:

```ts
/**
 * Converts radians to a human-readable degree string, e.g. "45°", "30.5°".
 * Trailing zeros after the decimal are trimmed. Maximum `decimals` digits (default 3).
 */
export function formatAngleDeg(rad: number, decimals = 3): string {
  const deg = rad * (180 / Math.PI);
  const formatted = deg.toFixed(decimals);
  // Remove trailing zeros and optional trailing dot
  const trimmed = formatted.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  return `${trimmed}°`;
}
```

Run: `pnpm --filter @zilventor/shared test:unit --run packages/shared/src/drawing/__tests__/dimensionMath.spec.ts`

Expected: all tests pass.

#### Step 6.3 — Commit

Files: `packages/shared/src/drawing/dimensionMath.ts`, `packages/shared/src/drawing/__tests__/dimensionMath.spec.ts`

```
feat(drawing-f5): add formatAngleDeg math helper (T6)
```

---

### F5-T7 — Math helpers `computeBaselineMemberOffset` and `nextBaselineSlot`

#### Step 7.1 — Write failing tests

Add to `packages/shared/src/drawing/__tests__/dimensionMath.spec.ts`:

```ts
import { computeBaselineMemberOffset, nextBaselineSlot } from '../dimensionMath';

describe('computeBaselineMemberOffset — HS-OFF-1: first member (slot=0)', () => {
  it('returns baseOffsetMm + 0 * spacingMm for slot 0', () => {
    expect(computeBaselineMemberOffset(20, 0, 10)).toBe(20);
  });
});

describe('computeBaselineMemberOffset — HS-OFF-2: third member (slot=2)', () => {
  it('returns 20 + 2 * 10 = 40 for slot 2', () => {
    expect(computeBaselineMemberOffset(20, 2, 10)).toBe(40);
  });
});

describe('nextBaselineSlot — HS-SLOT-1: empty group', () => {
  it('returns 0 when no existing slots', () => {
    expect(nextBaselineSlot([])).toBe(0);
  });
});

describe('nextBaselineSlot — HS-SLOT-2: existing slots [0, 1, 2]', () => {
  it('returns 3 for slots [0, 1, 2]', () => {
    expect(nextBaselineSlot([0, 1, 2])).toBe(3);
  });
});

describe('nextBaselineSlot — HS-SLOT-3: non-contiguous slots after undo', () => {
  it('returns max+1 even when slots have gaps', () => {
    // slots [0, 2] (slot 1 was undone) → next = 3
    expect(nextBaselineSlot([0, 2])).toBe(3);
  });
});

describe('nextBaselineSlot — HS-SLOT-4: single slot [5]', () => {
  it('returns 6 for slots [5]', () => {
    expect(nextBaselineSlot([5])).toBe(6);
  });
});
```

Run: `pnpm --filter @zilventor/shared test:unit --run packages/shared/src/drawing/__tests__/dimensionMath.spec.ts`

Expected failure: `computeBaselineMemberOffset is not a function` / `nextBaselineSlot is not a function`.

#### Step 7.2 — Add helpers to `packages/shared/src/drawing/dimensionMath.ts`

Append to the file:

```ts
/**
 * Computes the perpendicular offset (mm) for a baseline dimension member.
 * offset = baseOffsetMm + slot * spacingMm
 */
export function computeBaselineMemberOffset(
  baseOffsetMm: number,
  slot: number,
  spacingMm: number,
): number {
  return baseOffsetMm + slot * spacingMm;
}

/**
 * Returns the next slot index to assign when adding a new baseline member.
 * Spec invariant: slot = max(existing slots, -1) + 1
 * This means first member gets slot 0; subsequent members get max+1.
 * Holes from undo are intentional — slot reuse is not performed.
 */
export function nextBaselineSlot(existingSlots: readonly number[]): number {
  if (existingSlots.length === 0) return 0;
  return Math.max(...existingSlots) + 1;
}
```

Run: `pnpm --filter @zilventor/shared test:unit --run packages/shared/src/drawing/__tests__/dimensionMath.spec.ts`

Expected: all tests pass.

#### Step 7.3 — Commit

Files: `packages/shared/src/drawing/dimensionMath.ts`, `packages/shared/src/drawing/__tests__/dimensionMath.spec.ts`

```
feat(drawing-f5): add computeBaselineMemberOffset + nextBaselineSlot helpers (T7)
```

---

### F5-T8 — Render `baseline` dims in `renderDrawingSvg.ts`

#### Step 8.1 — Write failing test

Create `packages/app/src/drawing/__tests__/renderBaselineDim.spec.ts`:

```ts
// packages/app/src/drawing/__tests__/renderBaselineDim.spec.ts
import { describe, it, expect } from 'vitest';
import { renderDrawingSvg } from '../renderDrawingSvg';
import type { DrawingDocument, DrawingSheet } from '@zilventor/shared';
import type { PartDocument } from '@zilventor/shared';

function makeMinimalSource(): PartDocument {
  return {
    id: 'p1',
    name: 'Part',
    featureTree: [],
    parameters: {},
    properties: {},
    materials: [],
  } as unknown as PartDocument;
}

function makeBaseDrawing(sheets: DrawingSheet[]): DrawingDocument {
  return {
    id: 'drw1',
    name: 'Drawing 1',
    units: 'mm',
    source: { partPath: 'p.zipt', sourceKind: 'part' },
    properties: {},
    sheets,
    activeSheetId: sheets[0]!.id,
  };
}

describe('renderBaselineDim — HS-REND-1: data-dim-kind baseline present', () => {
  it('emits data-dim-kind="baseline" attribute for a baseline dim', () => {
    const edge1: import('@zilventor/shared').Edge2D = {
      id: 'e1', kind: 'outline', points: [[0, 0], [0, 30]],
    };
    const edge2: import('@zilventor/shared').Edge2D = {
      id: 'e2', kind: 'outline', points: [[50, 0], [50, 30]],
    };
    const sheet: DrawingSheet = {
      id: 's1', name: 'S1',
      size: { kind: 'iso', size: 'A3' },
      orientation: 'landscape',
      views: [{
        id: 'v1', kind: 'base',
        positionMm: { x: 50, y: 50 },
        scale: { numerator: 1, denominator: 1 },
        orientation: 'front',
        showHidden: false,
        projection: {
          visibleEdges: [edge1, edge2],
          hiddenEdges: [],
          bbox: { minX: 0, minY: 0, maxX: 50, maxY: 30 },
        },
      }],
      dimensions: [{
        kind: 'baseline',
        id: 'd-base-1',
        viewId: 'v1',
        groupId: 'g1',
        slot: 0,
        to: { kind: 'edge-endpoint', edgeId: 'e2', end: 'start' },
      }],
      annotations: [],
      titleBlock: {},
      dimensionGroups: [{
        kind: 'baseline',
        id: 'g1',
        viewId: 'v1',
        datum: { kind: 'edge-endpoint', edgeId: 'e1', end: 'start' },
        direction: 'h',
        baseOffsetMm: 15,
        spacingMm: 10,
      }],
    };
    const svg = renderDrawingSvg(makeBaseDrawing([sheet]), sheet, makeMinimalSource());
    expect(svg).toContain('data-dim-kind="baseline"');
  });
});

describe('renderBaselineDim — HS-REND-2: data-slot attribute', () => {
  it('emits data-slot="0" for slot=0 member', () => {
    const edge1: import('@zilventor/shared').Edge2D = {
      id: 'e1', kind: 'outline', points: [[0, 0], [0, 30]],
    };
    const edge2: import('@zilventor/shared').Edge2D = {
      id: 'e2', kind: 'outline', points: [[50, 0], [50, 30]],
    };
    const sheet: DrawingSheet = {
      id: 's1', name: 'S1',
      size: { kind: 'iso', size: 'A3' },
      orientation: 'landscape',
      views: [{
        id: 'v1', kind: 'base',
        positionMm: { x: 50, y: 50 },
        scale: { numerator: 1, denominator: 1 },
        orientation: 'front',
        showHidden: false,
        projection: {
          visibleEdges: [edge1, edge2],
          hiddenEdges: [],
          bbox: { minX: 0, minY: 0, maxX: 50, maxY: 30 },
        },
      }],
      dimensions: [{
        kind: 'baseline',
        id: 'd-base-1',
        viewId: 'v1',
        groupId: 'g1',
        slot: 0,
        to: { kind: 'edge-endpoint', edgeId: 'e2', end: 'start' },
      }],
      annotations: [],
      titleBlock: {},
      dimensionGroups: [{
        kind: 'baseline',
        id: 'g1',
        viewId: 'v1',
        datum: { kind: 'edge-endpoint', edgeId: 'e1', end: 'start' },
        direction: 'h',
        baseOffsetMm: 15,
        spacingMm: 10,
      }],
    };
    const svg = renderDrawingSvg(makeBaseDrawing([sheet]), sheet, makeMinimalSource());
    expect(svg).toContain('data-slot="0"');
  });
});

describe('renderBaselineDim — HS-REND-3: data-group-id attribute', () => {
  it('emits data-group-id matching the groupId', () => {
    const edge1: import('@zilventor/shared').Edge2D = {
      id: 'e1', kind: 'outline', points: [[0, 0], [0, 30]],
    };
    const edge2: import('@zilventor/shared').Edge2D = {
      id: 'e2', kind: 'outline', points: [[50, 0], [50, 30]],
    };
    const sheet: DrawingSheet = {
      id: 's1', name: 'S1',
      size: { kind: 'iso', size: 'A3' },
      orientation: 'landscape',
      views: [{
        id: 'v1', kind: 'base',
        positionMm: { x: 50, y: 50 },
        scale: { numerator: 1, denominator: 1 },
        orientation: 'front',
        showHidden: false,
        projection: {
          visibleEdges: [edge1, edge2],
          hiddenEdges: [],
          bbox: { minX: 0, minY: 0, maxX: 50, maxY: 30 },
        },
      }],
      dimensions: [{
        kind: 'baseline',
        id: 'd-base-1',
        viewId: 'v1',
        groupId: 'grp-abc',
        slot: 0,
        to: { kind: 'edge-endpoint', edgeId: 'e2', end: 'start' },
      }],
      annotations: [],
      titleBlock: {},
      dimensionGroups: [{
        kind: 'baseline',
        id: 'grp-abc',
        viewId: 'v1',
        datum: { kind: 'edge-endpoint', edgeId: 'e1', end: 'start' },
        direction: 'h',
        baseOffsetMm: 15,
        spacingMm: 10,
      }],
    };
    const svg = renderDrawingSvg(makeBaseDrawing([sheet]), sheet, makeMinimalSource());
    expect(svg).toContain('data-group-id="grp-abc"');
  });
});
```

Run: `pnpm --filter @zilventor/app test:unit --run packages/app/src/drawing/__tests__/renderBaselineDim.spec.ts`

Expected failure: `renderDimensionGroup` returns `''` for `kind === 'baseline'` (hits the final `return ''`), so SVG output does not contain `data-dim-kind="baseline"`. Test fails with `Expected string containing 'data-dim-kind="baseline"'`.

#### Step 8.2 — Extend `renderDimensionGroup` in `packages/app/src/drawing/renderDrawingSvg.ts`

Import the new types at the top of the file. The existing import on line 2:
```ts
import type { DrawingDimension } from '@zilventor/shared';
```
Becomes:
```ts
import type { DrawingDimension, DimensionGroup } from '@zilventor/shared';
```

The `renderDimensionGroup` function signature must gain access to `dimensionGroups`. Change its signature:

```ts
function renderDimensionGroup(
  dim: DrawingDimension,
  views: readonly DrawingView[],
  dimensionGroups: readonly DimensionGroup[],
): string {
```

Update the call site in `renderDrawingSvg` (line ~39):
```ts
const dimGroups = sheet.dimensions.map((d) => renderDimensionGroup(d, sheet.views, sheet.dimensionGroups)).join('\n');
```

Now, inside `renderDimensionGroup`, after the existing `if (dim.kind === 'linear-h' || ...)` block and before the final `return ''`, add the baseline case:

```ts
  if (dim.kind === 'baseline') {
    const group = dimensionGroups.find((g) => g.id === dim.groupId);
    if (!group || group.kind !== 'baseline') return '';
    if (!view?.projection) return '';

    const datumPt = resolvePointRef(group.datum, view.projection);
    const toPt    = resolvePointRef(dim.to, view.projection);
    if (!datumPt || !toPt) return '';

    const vScale = view.scale.numerator / view.scale.denominator;
    const vx = view.positionMm.x;
    const vy = view.positionMm.y;

    const dx = vx + datumPt[0] * vScale;
    const dy = vy + datumPt[1] * vScale;
    const tx = vx + toPt[0] * vScale;
    const ty = vy + toPt[1] * vScale;

    const offset = group.baseOffsetMm + dim.slot * group.spacingMm;
    const midX = (dx + tx) / 2;

    if (group.direction === 'h') {
      const dimY = dy - offset;
      const distMm = Math.round(Math.abs(toPt[0] - datumPt[0]));
      return `  <g data-dim-id="${escapeAttr(dim.id)}" data-dim-kind="baseline" data-group-id="${escapeAttr(dim.groupId)}" data-slot="${dim.slot}" stroke="#00c" stroke-width="0.2" fill="none">
      <line x1="${dx}" y1="${dimY}" x2="${tx}" y2="${dimY}"/>
      <line x1="${dx}" y1="${dy}" x2="${dx}" y2="${dimY}"/>
      <line x1="${tx}" y1="${ty}" x2="${tx}" y2="${dimY}"/>
      <text x="${midX}" y="${dimY - 1}" font-size="3.5" text-anchor="middle" fill="#00c" stroke="none">${distMm}</text>
    </g>`;
    } else {
      const dimX = dx + offset;
      const midY = (dy + ty) / 2;
      const distMm = Math.round(Math.abs(toPt[1] - datumPt[1]));
      return `  <g data-dim-id="${escapeAttr(dim.id)}" data-dim-kind="baseline" data-group-id="${escapeAttr(dim.groupId)}" data-slot="${dim.slot}" stroke="#00c" stroke-width="0.2" fill="none">
      <line x1="${dimX}" y1="${dy}" x2="${dimX}" y2="${ty}"/>
      <line x1="${dx}" y1="${dy}" x2="${dimX}" y2="${dy}"/>
      <line x1="${tx}" y1="${ty}" x2="${dimX}" y2="${ty}"/>
      <text x="${dimX + 1}" y="${midY}" font-size="3.5" fill="#00c" stroke="none">${distMm}</text>
    </g>`;
    }
  }
```

Run: `pnpm --filter @zilventor/app test:unit --run packages/app/src/drawing/__tests__/renderBaselineDim.spec.ts`

Expected: all 3 tests pass.

Run: `pnpm -r typecheck` — green.

#### Step 8.3 — Commit

Files: `packages/app/src/drawing/renderDrawingSvg.ts`, `packages/app/src/drawing/__tests__/renderBaselineDim.spec.ts`

```
feat(drawing-f5): render baseline dims in renderDrawingSvg (T8)
```

---

### F5-T9 — Render `ordinate` dims in `renderDrawingSvg.ts`

#### Step 9.1 — Write failing test

Create `packages/app/src/drawing/__tests__/renderOrdinateDim.spec.ts`:

```ts
// packages/app/src/drawing/__tests__/renderOrdinateDim.spec.ts
import { describe, it, expect } from 'vitest';
import { renderDrawingSvg } from '../renderDrawingSvg';
import type { DrawingDocument, DrawingSheet } from '@zilventor/shared';
import type { PartDocument } from '@zilventor/shared';

function makeMinimalSource(): PartDocument {
  return { id: 'p1', name: 'Part', featureTree: [], parameters: {}, properties: {}, materials: [] } as unknown as PartDocument;
}

function makeBaseDrawing(sheets: DrawingSheet[]): DrawingDocument {
  return { id: 'drw1', name: 'D', units: 'mm', source: { partPath: 'p.zipt', sourceKind: 'part' }, properties: {}, sheets, activeSheetId: sheets[0]!.id };
}

function makeOrdinateSheet(axis: 'x' | 'y'): DrawingSheet {
  const originEdge: import('@zilventor/shared').Edge2D = { id: 'e-origin', kind: 'outline', points: [[0, 0], [0, 1]] };
  const toEdge:     import('@zilventor/shared').Edge2D = { id: 'e-to',     kind: 'outline', points: [[40, 20], [40, 21]] };
  return {
    id: 's1', name: 'S1',
    size: { kind: 'iso', size: 'A3' }, orientation: 'landscape',
    views: [{
      id: 'v1', kind: 'base',
      positionMm: { x: 20, y: 20 },
      scale: { numerator: 1, denominator: 1 },
      orientation: 'front', showHidden: false,
      projection: {
        visibleEdges: [originEdge, toEdge],
        hiddenEdges: [],
        bbox: { minX: 0, minY: 0, maxX: 50, maxY: 40 },
      },
    }],
    dimensions: [{
      kind: 'ordinate',
      id: 'd-ord-1',
      viewId: 'v1',
      groupId: 'og1',
      to: { kind: 'edge-endpoint', edgeId: 'e-to', end: 'start' },
      axis,
    }],
    annotations: [],
    titleBlock: {},
    dimensionGroups: [{
      kind: 'ordinate',
      id: 'og1',
      viewId: 'v1',
      origin: { kind: 'edge-endpoint', edgeId: 'e-origin', end: 'start' },
      xColumnOffsetMm: 25,
      yColumnOffsetMm: 25,
    }],
  };
}

describe('renderOrdinateDim — HS-REND-4: data-dim-kind="ordinate"', () => {
  it('emits data-dim-kind="ordinate" for axis=x member', () => {
    const sheet = makeOrdinateSheet('x');
    const svg = renderDrawingSvg(makeBaseDrawing([sheet]), sheet, makeMinimalSource());
    expect(svg).toContain('data-dim-kind="ordinate"');
  });
});

describe('renderOrdinateDim — HS-REND-5: data-axis attribute', () => {
  it('emits data-axis="x" for axis=x member', () => {
    const sheet = makeOrdinateSheet('x');
    const svg = renderDrawingSvg(makeBaseDrawing([sheet]), sheet, makeMinimalSource());
    expect(svg).toContain('data-axis="x"');
  });

  it('emits data-axis="y" for axis=y member', () => {
    const sheet = makeOrdinateSheet('y');
    const svg = renderDrawingSvg(makeBaseDrawing([sheet]), sheet, makeMinimalSource());
    expect(svg).toContain('data-axis="y"');
  });
});

describe('renderOrdinateDim — HS-REND-6: L-leader path has two segments', () => {
  it('SVG output contains two <line> elements inside the ordinate group', () => {
    const sheet = makeOrdinateSheet('x');
    const svg = renderDrawingSvg(makeBaseDrawing([sheet]), sheet, makeMinimalSource());
    // Ordinate L-leader = vertical leg + horizontal leg = 2 <line> elements
    const groupMatch = svg.match(/<g data-dim-kind="ordinate"[^>]*>([\s\S]*?)<\/g>/);
    expect(groupMatch).not.toBeNull();
    const groupContent = groupMatch![1];
    const lineCount = (groupContent.match(/<line /g) ?? []).length;
    expect(lineCount).toBeGreaterThanOrEqual(2);
  });
});
```

Run: `pnpm --filter @zilventor/app test:unit --run packages/app/src/drawing/__tests__/renderOrdinateDim.spec.ts`

Expected failure: SVG does not contain `data-dim-kind="ordinate"` (returns `''`).

#### Step 9.2 — Add ordinate case in `renderDimensionGroup`

After the baseline `if` block, before `return ''`, add:

```ts
  if (dim.kind === 'ordinate') {
    const group = dimensionGroups.find((g) => g.id === dim.groupId);
    if (!group || group.kind !== 'ordinate') return '';
    if (!view?.projection) return '';

    const originPt = resolvePointRef(group.origin, view.projection);
    const toPt     = resolvePointRef(dim.to, view.projection);
    if (!originPt || !toPt) return '';

    const vScale = view.scale.numerator / view.scale.denominator;
    const vx = view.positionMm.x;
    const vy = view.positionMm.y;

    const ox = vx + originPt[0] * vScale;
    const oy = vy + originPt[1] * vScale;
    const tx = vx + toPt[0] * vScale;
    const ty = vy + toPt[1] * vScale;

    let leg1x1: number, leg1y1: number, leg1x2: number, leg1y2: number;
    let leg2x1: number, leg2y1: number, leg2x2: number, leg2y2: number;
    let textX: number, textY: number;
    let delta: number;

    if (dim.axis === 'x') {
      // Vertical leg: from feature point up/down to column line Y
      const colY = oy + group.xColumnOffsetMm;
      leg1x1 = tx; leg1y1 = ty; leg1x2 = tx; leg1y2 = colY;
      // Horizontal leg: from elbow to text position
      leg2x1 = tx; leg2y1 = colY; leg2x2 = ox; leg2y2 = colY;
      textX = ox - 1; textY = colY - 1;
      delta = toPt[0] - originPt[0];
    } else {
      // Horizontal leg: from feature point left/right to column line X
      const colX = ox + group.yColumnOffsetMm;
      leg1x1 = tx; leg1y1 = ty; leg1x2 = colX; leg1y2 = ty;
      // Vertical leg: from elbow to text position
      leg2x1 = colX; leg2y1 = ty; leg2x2 = colX; leg2y2 = oy;
      textX = colX + 1; textY = oy - 1;
      delta = toPt[1] - originPt[1];
    }

    const label = `${Math.abs(delta).toFixed(2)}`;
    return `  <g data-dim-id="${escapeAttr(dim.id)}" data-dim-kind="ordinate" data-group-id="${escapeAttr(dim.groupId)}" data-axis="${dim.axis}" stroke="#00c" stroke-width="0.2" fill="none">
      <line x1="${leg1x1}" y1="${leg1y1}" x2="${leg1x2}" y2="${leg1y2}"/>
      <line x1="${leg2x1}" y1="${leg2y1}" x2="${leg2x2}" y2="${leg2y2}"/>
      <text x="${textX}" y="${textY}" font-size="3.5" fill="#00c" stroke="none">${label}</text>
    </g>`;
  }
```

Run: `pnpm --filter @zilventor/app test:unit --run packages/app/src/drawing/__tests__/renderOrdinateDim.spec.ts`

Expected: all 4 tests pass.

#### Step 9.3 — Commit

Files: `packages/app/src/drawing/renderDrawingSvg.ts`, `packages/app/src/drawing/__tests__/renderOrdinateDim.spec.ts`

```
feat(drawing-f5): render ordinate dims in renderDrawingSvg (T9)
```

---

### F5-T10 — Render `angular` dims in `renderDrawingSvg.ts`

#### Step 10.1 — Write failing tests

Create `packages/app/src/drawing/__tests__/renderAngularDim.spec.ts`:

```ts
// packages/app/src/drawing/__tests__/renderAngularDim.spec.ts
import { describe, it, expect } from 'vitest';
import { renderDrawingSvg } from '../renderDrawingSvg';
import type { DrawingDocument, DrawingSheet } from '@zilventor/shared';
import type { PartDocument } from '@zilventor/shared';

function makeMinimalSource(): PartDocument {
  return { id: 'p1', name: 'Part', featureTree: [], parameters: {}, properties: {}, materials: [] } as unknown as PartDocument;
}

function makeBaseDrawing(sheets: DrawingSheet[]): DrawingDocument {
  return { id: 'drw1', name: 'D', units: 'mm', source: { partPath: 'p.zipt', sourceKind: 'part' }, properties: {}, sheets, activeSheetId: sheets[0]!.id };
}

/**
 * Two edges meeting at origin: edge1 along +X, edge2 along +Y.
 * Expected apex = (0,0), inside angle = 90°.
 */
function makeAngularSheet(arcSide: 'inside' | 'outside' = 'inside'): DrawingSheet {
  const edge1: import('@zilventor/shared').Edge2D = { id: 'ea1', kind: 'outline', points: [[0, 0], [30, 0]] };
  const edge2: import('@zilventor/shared').Edge2D = { id: 'ea2', kind: 'outline', points: [[0, 0], [0, 30]] };
  return {
    id: 's1', name: 'S1',
    size: { kind: 'iso', size: 'A3' }, orientation: 'landscape',
    views: [{
      id: 'v1', kind: 'base',
      positionMm: { x: 50, y: 50 },
      scale: { numerator: 1, denominator: 1 },
      orientation: 'front', showHidden: false,
      projection: {
        visibleEdges: [edge1, edge2],
        hiddenEdges: [],
        bbox: { minX: 0, minY: 0, maxX: 30, maxY: 30 },
      },
    }],
    dimensions: [{
      kind: 'angular',
      id: 'd-ang-1',
      viewId: 'v1',
      ref: { kind: 'two-edges', edge1: { viewId: 'v1', edgeId: 'ea1' }, edge2: { viewId: 'v1', edgeId: 'ea2' } },
      arcSide,
      offsetMm: 15,
    }],
    annotations: [],
    titleBlock: {},
    dimensionGroups: [],
  };
}

describe('renderAngularDim — HS-REND-7: data-dim-kind="angular"', () => {
  it('emits data-dim-kind="angular" for two-edges angular dim', () => {
    const sheet = makeAngularSheet();
    const svg = renderDrawingSvg(makeBaseDrawing([sheet]), sheet, makeMinimalSource());
    expect(svg).toContain('data-dim-kind="angular"');
  });
});

describe('renderAngularDim — HS-REND-8: SVG arc path contains "A"', () => {
  it('dim arc path d attribute contains the SVG arc instruction "A"', () => {
    const sheet = makeAngularSheet();
    const svg = renderDrawingSvg(makeBaseDrawing([sheet]), sheet, makeMinimalSource());
    // The arc path must use the SVG arc instruction (uppercase A = absolute arc)
    const pathMatch = svg.match(/data-dim-kind="angular"[\s\S]*?<path[^>]*d="([^"]*)"/);
    expect(pathMatch).not.toBeNull();
    expect(pathMatch![1]).toContain('A');
  });
});

describe('renderAngularDim — HS-REND-9: data-arc-side attribute', () => {
  it('emits data-arc-side="inside" when arcSide=inside', () => {
    const sheet = makeAngularSheet('inside');
    const svg = renderDrawingSvg(makeBaseDrawing([sheet]), sheet, makeMinimalSource());
    expect(svg).toContain('data-arc-side="inside"');
  });

  it('emits data-arc-side="outside" when arcSide=outside', () => {
    const sheet = makeAngularSheet('outside');
    const svg = renderDrawingSvg(makeBaseDrawing([sheet]), sheet, makeMinimalSource());
    expect(svg).toContain('data-arc-side="outside"');
  });
});

describe('renderAngularDim — HS-REND-10: parallel edges fallback', () => {
  it('returns non-empty output (fallback text) for parallel edges', () => {
    // Two horizontal edges — parallel, no intersection → fallback
    const edge1: import('@zilventor/shared').Edge2D = { id: 'ep1', kind: 'outline', points: [[0, 0], [30, 0]] };
    const edge2: import('@zilventor/shared').Edge2D = { id: 'ep2', kind: 'outline', points: [[0, 10], [30, 10]] };
    const sheet: DrawingSheet = {
      id: 's1', name: 'S1',
      size: { kind: 'iso', size: 'A3' }, orientation: 'landscape',
      views: [{
        id: 'v1', kind: 'base',
        positionMm: { x: 50, y: 50 },
        scale: { numerator: 1, denominator: 1 },
        orientation: 'front', showHidden: false,
        projection: {
          visibleEdges: [edge1, edge2], hiddenEdges: [],
          bbox: { minX: 0, minY: 0, maxX: 30, maxY: 10 },
        },
      }],
      dimensions: [{
        kind: 'angular', id: 'd-par', viewId: 'v1',
        ref: { kind: 'two-edges', edge1: { viewId: 'v1', edgeId: 'ep1' }, edge2: { viewId: 'v1', edgeId: 'ep2' } },
        arcSide: 'inside', offsetMm: 10,
      }],
      annotations: [], titleBlock: {}, dimensionGroups: [],
    };
    const svg = renderDrawingSvg(makeBaseDrawing([sheet]), sheet, makeMinimalSource());
    // Fallback renders a text element with "—" (em dash) per spec
    expect(svg).toContain('data-dim-kind="angular"');
    expect(svg).toContain('—');
  });
});
```

Run: `pnpm --filter @zilventor/app test:unit --run packages/app/src/drawing/__tests__/renderAngularDim.spec.ts`

Expected failure: SVG does not contain `data-dim-kind="angular"` (hits `return ''`).

#### Step 10.2 — Import math helpers in `renderDrawingSvg.ts`

At the top of `packages/app/src/drawing/renderDrawingSvg.ts`, add after the existing imports:

```ts
import { intersectLines, subtendedAngle, formatAngleDeg } from '@zilventor/shared/src/drawing/dimensionMath';
```

Note: the `dimensionMath.ts` file lives in `packages/shared/src/drawing/`. Since `renderDrawingSvg.ts` already imports from `@zilventor/shared/src/drawing/types` using the direct path, the same pattern applies. If the monorepo build tool resolves `@zilventor/shared/src/...` paths (confirmed by existing imports), this will work. If not, use `../../shared/src/drawing/dimensionMath` relative to the app package — verify which pattern the existing deep imports use at line 4 of `renderDrawingSvg.ts` (`from '@zilventor/shared/src/drawing/types'`), and use the identical prefix.

#### Step 10.3 — Add angular case in `renderDimensionGroup`

After the ordinate case, before `return ''`, add:

```ts
  if (dim.kind === 'angular') {
    if (!view?.projection) return '';

    const vScale = view.scale.numerator / view.scale.denominator;
    const vx = view.positionMm.x;
    const vy = view.positionMm.y;

    if (dim.ref.kind === 'arc') {
      // Arc edge: sweep angle of the arc itself
      const arcEdge = view.projection.visibleEdges.find((e) => e.id === dim.ref.edge.edgeId)
        ?? view.projection.hiddenEdges.find((e) => e.id === dim.ref.edge.edgeId);
      if (!arcEdge || arcEdge.points.length < 3) return '';

      // Estimate arc center, radius, start/end angles from first, mid, last polyline points
      const pts = arcEdge.points;
      const pStart = pts[0]!;
      const pEnd   = pts[pts.length - 1]!;
      const pMid   = pts[Math.floor(pts.length / 2)]!;

      // Arc center via circumcircle of 3 points
      const cx_arc = circumcenterX(pStart, pMid, pEnd);
      const cy_arc = circumcenterY(pStart, pMid, pEnd);
      const r_arc = Math.sqrt((pStart[0] - cx_arc) ** 2 + (pStart[1] - cy_arc) ** 2);

      const startAngle = Math.atan2(pStart[1] - cy_arc, pStart[0] - cx_arc);
      const endAngle   = Math.atan2(pEnd[1]   - cy_arc, pEnd[0]   - cx_arc);

      const arcR = r_arc + dim.offsetMm;  // outward from edge
      const sweepRad = normalizeAngle(endAngle - startAngle);

      const asx = vx + (cx_arc + arcR * Math.cos(startAngle)) * vScale;
      const asy = vy + (cy_arc + arcR * Math.sin(startAngle)) * vScale;
      const aex = vx + (cx_arc + arcR * Math.cos(endAngle)) * vScale;
      const aey = vy + (cy_arc + arcR * Math.sin(endAngle)) * vScale;
      const largeArc = sweepRad > Math.PI ? 1 : 0;
      const arcRScaled = arcR * vScale;

      const midAngle = startAngle + sweepRad / 2;
      const textX = vx + (cx_arc + (arcR + 1.5) * Math.cos(midAngle)) * vScale;
      const textY = vy + (cy_arc + (arcR + 1.5) * Math.sin(midAngle)) * vScale;
      const label = formatAngleDeg(sweepRad);

      return `  <g data-dim-id="${escapeAttr(dim.id)}" data-dim-kind="angular" data-arc-side="${dim.arcSide}" stroke="#00c" stroke-width="0.2" fill="none">
      <path d="M ${asx} ${asy} A ${arcRScaled} ${arcRScaled} 0 ${largeArc} 1 ${aex} ${aey}"/>
      <text x="${textX}" y="${textY}" font-size="3.5" text-anchor="middle" fill="#00c" stroke="none">${label}</text>
    </g>`;
    }

    // two-edges case
    const edge1 = view.projection.visibleEdges.find((e) => e.id === dim.ref.edge1.edgeId)
      ?? view.projection.hiddenEdges.find((e) => e.id === dim.ref.edge1.edgeId);
    const edge2 = view.projection.visibleEdges.find((e) => e.id === dim.ref.edge2.edgeId)
      ?? view.projection.hiddenEdges.find((e) => e.id === dim.ref.edge2.edgeId);
    if (!edge1 || !edge2 || edge1.points.length < 2 || edge2.points.length < 2) return '';

    const e1p0 = { x: edge1.points[0]![0], y: edge1.points[0]![1] };
    const e1p1 = { x: edge1.points[edge1.points.length - 1]![0], y: edge1.points[edge1.points.length - 1]![1] };
    const e2p0 = { x: edge2.points[0]![0], y: edge2.points[0]![1] };
    const e2p1 = { x: edge2.points[edge2.points.length - 1]![0], y: edge2.points[edge2.points.length - 1]![1] };

    const apex = intersectLines({ p0: e1p0, p1: e1p1 }, { p0: e2p0, p1: e2p1 });

    if (!apex) {
      // Parallel edges fallback: text "—" at midpoint of bounding box
      const midX = vx + ((e1p0.x + e1p1.x + e2p0.x + e2p1.x) / 4) * vScale;
      const midY = vy + ((e1p0.y + e1p1.y + e2p0.y + e2p1.y) / 4) * vScale;
      return `  <g data-dim-id="${escapeAttr(dim.id)}" data-dim-kind="angular" data-arc-side="${dim.arcSide}" stroke="#00c" stroke-width="0.2" fill="none">
      <text x="${midX}" y="${midY}" font-size="3.5" text-anchor="middle" fill="#00c" stroke="none">—</text>
    </g>`;
    }

    // Direction vectors from apex toward each edge's far endpoint
    const d1 = unitVec({ x: e1p1.x - apex.x, y: e1p1.y - apex.y });
    const d2 = unitVec({ x: e2p1.x - apex.x, y: e2p1.y - apex.y });

    const { insideRad, outsideRad } = subtendedAngle(d1, d2);
    const sweepRad = dim.arcSide === 'inside' ? insideRad : outsideRad;
    const label = formatAngleDeg(sweepRad);

    const startAngle = Math.atan2(d1.y, d1.x);
    const endAngle   = Math.atan2(d2.y, d2.x);
    const arcR = dim.offsetMm;
    const arcRScaled = arcR * vScale;

    const apexSvgX = vx + apex.x * vScale;
    const apexSvgY = vy + apex.y * vScale;

    const asx = apexSvgX + arcRScaled * Math.cos(startAngle);
    const asy = apexSvgY + arcRScaled * Math.sin(startAngle);
    const aex = apexSvgX + arcRScaled * Math.cos(endAngle);
    const aey = apexSvgY + arcRScaled * Math.sin(endAngle);

    const largeArc = sweepRad > Math.PI ? 1 : 0;
    // sweep-flag: 1 = counter-clockwise in SVG coordinates (y-down), matching the
    // angle from d1 to d2 going counter-clockwise.
    const sweepFlag = dim.arcSide === 'inside' ? 1 : 0;

    const midAngle = startAngle + (dim.arcSide === 'inside' ? insideRad : outsideRad) / 2;
    const textR = arcR + 1.5;
    const textX = apexSvgX + textR * vScale * Math.cos(midAngle);
    const textY = apexSvgY + textR * vScale * Math.sin(midAngle);

    return `  <g data-dim-id="${escapeAttr(dim.id)}" data-dim-kind="angular" data-arc-side="${dim.arcSide}" stroke="#00c" stroke-width="0.2" fill="none">
      <path d="M ${asx} ${asy} A ${arcRScaled} ${arcRScaled} 0 ${largeArc} ${sweepFlag} ${aex} ${aey}"/>
      <text x="${textX}" y="${textY}" font-size="3.5" text-anchor="middle" fill="#00c" stroke="none">${label}</text>
    </g>`;
  }
```

Also add the private helper functions (outside `renderDimensionGroup`, near the other utility functions like `escapeAttr`):

```ts
function unitVec(v: { x: number; y: number }): { x: number; y: number } {
  const len = Math.sqrt(v.x * v.x + v.y * v.y);
  if (len < 1e-12) return { x: 1, y: 0 };
  return { x: v.x / len, y: v.y / len };
}

function normalizeAngle(a: number): number {
  let r = a % (2 * Math.PI);
  if (r < 0) r += 2 * Math.PI;
  return r;
}

function circumcenterX(
  p0: readonly [number, number],
  p1: readonly [number, number],
  p2: readonly [number, number],
): number {
  const ax = p0[0], ay = p0[1];
  const bx = p1[0], by = p1[1];
  const cx = p2[0], cy = p2[1];
  const D = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(D) < 1e-12) return (ax + bx + cx) / 3;
  return ((ax*ax + ay*ay) * (by - cy) + (bx*bx + by*by) * (cy - ay) + (cx*cx + cy*cy) * (ay - by)) / D;
}

function circumcenterY(
  p0: readonly [number, number],
  p1: readonly [number, number],
  p2: readonly [number, number],
): number {
  const ax = p0[0], ay = p0[1];
  const bx = p1[0], by = p1[1];
  const cx = p2[0], cy = p2[1];
  const D = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(D) < 1e-12) return (ay + by + cy) / 3;
  return ((ax*ax + ay*ay) * (cx - bx) + (bx*bx + by*by) * (ax - cx) + (cx*cx + cy*cy) * (bx - ax)) / D;
}
```

Run: `pnpm --filter @zilventor/app test:unit --run packages/app/src/drawing/__tests__/renderAngularDim.spec.ts`

Expected: all 5 tests pass.

Run: `pnpm -r typecheck` — green.

#### Step 10.3 — Commit

Files: `packages/app/src/drawing/renderDrawingSvg.ts`, `packages/app/src/drawing/__tests__/renderAngularDim.spec.ts`

```
feat(drawing-f5): render angular dims (two-edges + arc fallback) in renderDrawingSvg (T10)
```

---

### F5-T-batch1-verify — Full suite green check

#### Step V.1 — Typecheck entire monorepo

```
pnpm -r typecheck
```

Expected: 0 errors.

#### Step V.2 — Run shared package unit tests

```
pnpm --filter @zilventor/shared test:unit
```

Expected: all existing tests pass + new tests from dimensionGroups.spec.ts and dimensionMath.spec.ts (approximately 20–25 new tests). The baseline count before Batch 1 should be verified in the implementer's terminal; the total count will grow by that delta.

#### Step V.3 — Run app package unit tests

```
pnpm --filter @zilventor/app test:unit
```

Expected: all existing tests pass + new tests from renderBaselineDim.spec.ts, renderOrdinateDim.spec.ts, renderAngularDim.spec.ts (approximately 12 new tests).

#### Step V.4 — Check test count delta

The pre-Batch-1 baseline is 2232 tests (from spec). Confirm:
- `pnpm -r test:unit 2>&1 | tail -5` shows pass count ≥ 2232 + new tests.
- Zero failures.
- Zero skipped (unless pre-existing skips).

If any test fails: diagnose per CLAUDE.md §4b before marking done. Do not mark `STATUS: DONE` until the terminal output confirms all tests pass.

---


---

## Batch 2 — Commands + AutoDim extension

**Goal:** Land all 5 new commands, updates to existing Delete/Move commands, and the AutoDim `dim-angle` branch. Wire cascade-text for new dim kinds.

**Owner per task:** Sonnet implementer subagent.

---

### F5-T11: `AddDimensionGroupCommand`

**Slice goal:** One command handles both `kind: 'baseline'` and `kind: 'ordinate'` groups (discriminated by the `group` payload). Appends to `sheet.dimensionGroups[]`. Revert removes by `group.id`.

**Failing test step (RED):**

File: `packages/app/src/commands/__tests__/AddDimensionGroupCommand.spec.ts`

```ts
// packages/app/src/commands/__tests__/AddDimensionGroupCommand.spec.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { AddDimensionGroupCommand } from '../AddDimensionGroupCommand';
import { useAppStore } from '../../store/useAppStore';
import type { DrawingDocument } from '@zilventor/shared';
import type { DimensionGroup } from '@zilventor/shared/src/drawing/types';

type DrawingActive = { kind: 'drawing'; document: DrawingDocument };

function makeDrawingDoc(): DrawingDocument {
  return {
    id: 'dw1', name: 'Test', units: 'mm',
    source: { partPath: 'parts/box.zipt', sourceKind: 'part' },
    properties: {}, activeSheetId: 'sh1',
    sheets: [{
      id: 'sh1', name: 'Sheet 1',
      size: { kind: 'iso', size: 'A3' }, orientation: 'landscape',
      views: [], dimensions: [], dimensionGroups: [], annotations: [], titleBlock: {},
    }],
  };
}

const baselineGroup: DimensionGroup = {
  kind: 'baseline', id: 'bg1', viewId: 'v1',
  datum: { kind: 'edge-endpoint', edgeId: 'e1', end: 'start' },
  direction: 'h', baseOffsetMm: 20, spacingMm: 10,
};

const ordinateGroup: DimensionGroup = {
  kind: 'ordinate', id: 'og1', viewId: 'v1',
  origin: { kind: 'edge-endpoint', edgeId: 'e2', end: 'start' },
  xColumnOffsetMm: 30, yColumnOffsetMm: 25,
};

beforeEach(() => {
  useAppStore.setState({
    activeDocument: { kind: 'drawing', document: makeDrawingDoc() },
  } as never);
});

describe('AddDimensionGroupCommand', () => {
  it('(a) apply appends baseline group to dimensionGroups', async () => {
    const cmd = new AddDimensionGroupCommand({ sheetId: 'sh1', group: baselineGroup });
    await cmd.apply();
    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    const groups = doc.sheets[0]!.dimensionGroups;
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ kind: 'baseline', id: 'bg1' });
  });

  it('(b) apply appends ordinate group to dimensionGroups', async () => {
    const cmd = new AddDimensionGroupCommand({ sheetId: 'sh1', group: ordinateGroup });
    await cmd.apply();
    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    const groups = doc.sheets[0]!.dimensionGroups;
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ kind: 'ordinate', id: 'og1' });
  });

  it('(c) revert removes the group by id', async () => {
    const cmd = new AddDimensionGroupCommand({ sheetId: 'sh1', group: baselineGroup });
    await cmd.apply();
    await cmd.revert();
    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    expect(doc.sheets[0]!.dimensionGroups).toHaveLength(0);
  });

  it('(d) apply throws invalid-view-id when viewId not in sheet.views', async () => {
    // Note: AddDimensionGroupCommand does NOT validate viewId in v1 — group can be
    // created before view projection exists. This test documents future behavior if
    // validation is added. For now, it must NOT throw.
    const cmd = new AddDimensionGroupCommand({ sheetId: 'sh1', group: baselineGroup });
    await expect(cmd.apply()).resolves.toBeUndefined();
  });
});
```

**Expected failure:** `Cannot find module '../AddDimensionGroupCommand'` (file does not exist yet).

Run: `pnpm --filter @zilventor/app test:unit -- AddDimensionGroupCommand`

---

**Implementation step (GREEN):**

First, ensure `DimensionGroup` type exists in `packages/shared/src/drawing/types.ts` (added by Batch 1). This task references it — if Batch 1 is not yet merged, stub it locally and reconcile at batch merge.

File: `packages/app/src/commands/AddDimensionGroupCommand.ts`

```ts
import type { Command } from './Command';
import type { DrawingDocument } from '@zilventor/shared';
import type { DimensionGroup } from '@zilventor/shared/src/drawing/types';
import { useAppStore } from '../store/useAppStore';

export class AddDimensionGroupCommand implements Command {
  readonly name = 'AddDimensionGroupCommand';

  constructor(private readonly opts: { sheetId: string; group: DimensionGroup }) {}

  async apply(): Promise<void> {
    const state = useAppStore.getState();
    const doc = state.activeDocument;
    if (!doc || doc.kind !== 'drawing') return;

    const next: DrawingDocument = {
      ...doc.document,
      sheets: doc.document.sheets.map((sh) =>
        sh.id === this.opts.sheetId
          ? { ...sh, dimensionGroups: [...(sh.dimensionGroups ?? []), this.opts.group] }
          : sh,
      ),
    };
    useAppStore.setState({
      activeDocument: { kind: 'drawing', document: next },
      activeDrawing: next,
    });
  }

  async revert(): Promise<void> {
    const state = useAppStore.getState();
    const doc = state.activeDocument;
    if (!doc || doc.kind !== 'drawing') return;

    const next: DrawingDocument = {
      ...doc.document,
      sheets: doc.document.sheets.map((sh) =>
        sh.id === this.opts.sheetId
          ? {
              ...sh,
              dimensionGroups: (sh.dimensionGroups ?? []).filter(
                (g) => g.id !== this.opts.group.id,
              ),
            }
          : sh,
      ),
    };
    useAppStore.setState({
      activeDocument: { kind: 'drawing', document: next },
      activeDrawing: next,
    });
  }
}
```

**Refactor:** None needed. The `?? []` fallback is defensive for v18 sheets loaded before Batch 1 type change lands — remove once `dimensionGroups` is required on `DrawingSheet`.

**Commit:** `feat(drawing-f5): F5-T11 AddDimensionGroupCommand`

---

### F5-T12: `AddBaselineMemberCommand`

**Slice goal:** Appends a `kind: 'baseline'` dim to `sheet.dimensions[]`. Computes `slot = max(existing slots for this groupId, -1) + 1`. Validates group exists, is `kind: 'baseline'`, and shares `viewId`. Uses `nextBaselineSlot` helper from Batch 1 (`@zilventor/shared/src/drawing/dimensionMath`).

**Failing test step (RED):**

File: `packages/app/src/commands/__tests__/AddBaselineMemberCommand.spec.ts`

```ts
// packages/app/src/commands/__tests__/AddBaselineMemberCommand.spec.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { AddBaselineMemberCommand } from '../AddBaselineMemberCommand';
import { useAppStore } from '../../store/useAppStore';
import type { DrawingDocument, DrawingDimension } from '@zilventor/shared';
import type { DimensionGroup } from '@zilventor/shared/src/drawing/types';

type DrawingActive = { kind: 'drawing'; document: DrawingDocument };

const baselineGroup: DimensionGroup = {
  kind: 'baseline', id: 'bg1', viewId: 'v1',
  datum: { kind: 'edge-endpoint', edgeId: 'e0', end: 'start' },
  direction: 'h', baseOffsetMm: 20, spacingMm: 10,
};

function makeDoc(extraDims: DrawingDimension[] = []): DrawingDocument {
  return {
    id: 'dw1', name: 'Test', units: 'mm',
    source: { partPath: 'parts/box.zipt', sourceKind: 'part' },
    properties: {}, activeSheetId: 'sh1',
    sheets: [{
      id: 'sh1', name: 'Sheet 1',
      size: { kind: 'iso', size: 'A3' }, orientation: 'landscape',
      views: [{ id: 'v1', kind: 'base', positionMm: { x: 0, y: 0 },
        scale: { numerator: 1, denominator: 1 }, orientation: 'front', showHidden: false }],
      dimensions: extraDims,
      dimensionGroups: [baselineGroup],
      annotations: [], titleBlock: {},
    }],
  };
}

const toRef = { kind: 'edge-endpoint' as const, edgeId: 'e1', end: 'end' as const };

beforeEach(() => {
  useAppStore.setState({ activeDocument: { kind: 'drawing', document: makeDoc() } } as never);
});

describe('AddBaselineMemberCommand', () => {
  it('(a) first member gets slot 0', async () => {
    const cmd = new AddBaselineMemberCommand({ sheetId: 'sh1', groupId: 'bg1', to: toRef });
    await cmd.apply();
    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    const dims = doc.sheets[0]!.dimensions;
    expect(dims).toHaveLength(1);
    expect(dims[0]).toMatchObject({ kind: 'baseline', groupId: 'bg1', slot: 0, viewId: 'v1' });
  });

  it('(b) second member gets slot 1 (max+1)', async () => {
    // Pre-seed a slot-0 member
    const existing: DrawingDimension = {
      id: 'bm-0', kind: 'baseline', viewId: 'v1', groupId: 'bg1', slot: 0,
      to: toRef,
    } as unknown as DrawingDimension;
    useAppStore.setState({
      activeDocument: { kind: 'drawing', document: makeDoc([existing]) },
    } as never);
    const cmd = new AddBaselineMemberCommand({ sheetId: 'sh1', groupId: 'bg1', to: toRef });
    await cmd.apply();
    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    const dims = doc.sheets[0]!.dimensions;
    const newDim = dims.find((d) => d.id !== 'bm-0')!;
    expect((newDim as unknown as { slot: number }).slot).toBe(1);
  });

  it('(c) revert removes the appended dim', async () => {
    const cmd = new AddBaselineMemberCommand({ sheetId: 'sh1', groupId: 'bg1', to: toRef });
    await cmd.apply();
    await cmd.revert();
    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    expect(doc.sheets[0]!.dimensions).toHaveLength(0);
  });

  it('(d) group-not-found throws', async () => {
    const cmd = new AddBaselineMemberCommand({ sheetId: 'sh1', groupId: 'no-such', to: toRef });
    await expect(cmd.apply()).rejects.toThrow('group-not-found');
  });

  it('(e) wrong-kind throws when group is ordinate', async () => {
    const ordinateGroup: DimensionGroup = {
      kind: 'ordinate', id: 'og1', viewId: 'v1',
      origin: toRef, xColumnOffsetMm: 20, yColumnOffsetMm: 20,
    };
    const doc = makeDoc();
    const sheet = doc.sheets[0]!;
    const patchedDoc: DrawingDocument = {
      ...doc,
      sheets: [{ ...sheet, dimensionGroups: [...(sheet.dimensionGroups ?? []), ordinateGroup] }],
    };
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: patchedDoc } } as never);
    const cmd = new AddBaselineMemberCommand({ sheetId: 'sh1', groupId: 'og1', to: toRef });
    await expect(cmd.apply()).rejects.toThrow('wrong-kind');
  });

  it('(f) stores sourceParameterName when provided', async () => {
    const cmd = new AddBaselineMemberCommand({
      sheetId: 'sh1', groupId: 'bg1', to: toRef,
      opts: { sourceParameterName: 'width' },
    });
    await cmd.apply();
    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    const dim = doc.sheets[0]!.dimensions[0]!;
    expect((dim as unknown as { sourceParameterName: string }).sourceParameterName).toBe('width');
  });
});
```

**Expected failure:** `Cannot find module '../AddBaselineMemberCommand'`

Run: `pnpm --filter @zilventor/app test:unit -- AddBaselineMemberCommand`

---

**Implementation step (GREEN):**

File: `packages/app/src/commands/AddBaselineMemberCommand.ts`

```ts
import type { Command } from './Command';
import type { DrawingDocument, DrawingDimension } from '@zilventor/shared';
import type { PointRef } from '@zilventor/shared/src/drawing/types';
import { useAppStore } from '../store/useAppStore';
import { assertDimensionGroupInvariants } from './dimensionGroupInvariants';

export class AddBaselineMemberCommand implements Command {
  readonly name = 'AddBaselineMemberCommand';
  private placedId: string | null = null;

  constructor(private readonly opts: {
    sheetId: string;
    groupId: string;
    to: PointRef;
    opts?: { sourceParameterName?: string; textOverride?: string };
  }) {}

  async apply(): Promise<void> {
    const state = useAppStore.getState();
    const doc = state.activeDocument;
    if (!doc || doc.kind !== 'drawing') return;

    const sheet = doc.document.sheets.find((s) => s.id === this.opts.sheetId);
    if (!sheet) throw new Error('sheet-not-found');

    const groups = sheet.dimensionGroups ?? [];
    const group = groups.find((g) => g.id === this.opts.groupId);
    if (!group) throw new Error('group-not-found');
    if (group.kind !== 'baseline') throw new Error('wrong-kind');

    // Compute next slot: max of existing member slots for this groupId, then +1
    const existingSlots = (sheet.dimensions as unknown as Array<{ kind: string; groupId: string; slot: number }>)
      .filter((d) => d.kind === 'baseline' && d.groupId === this.opts.groupId)
      .map((d) => d.slot);
    const slot = existingSlots.length === 0 ? 0 : Math.max(...existingSlots) + 1;

    const id = crypto.randomUUID();
    this.placedId = id;

    const newDim = {
      id,
      kind: 'baseline' as const,
      viewId: group.viewId,
      groupId: this.opts.groupId,
      slot,
      to: this.opts.to,
      ...(this.opts.opts?.sourceParameterName !== undefined
        ? { sourceParameterName: this.opts.opts.sourceParameterName }
        : {}),
      ...(this.opts.opts?.textOverride !== undefined
        ? { textOverride: this.opts.opts.textOverride }
        : {}),
    } as unknown as DrawingDimension;

    const nextSheet = { ...sheet, dimensions: [...sheet.dimensions, newDim] };
    const nextDoc: DrawingDocument = {
      ...doc.document,
      sheets: doc.document.sheets.map((s) => s.id === this.opts.sheetId ? nextSheet : s),
    };

    assertDimensionGroupInvariants({ ...nextSheet, dimensionGroups: groups } as typeof nextSheet);

    useAppStore.setState({
      activeDocument: { kind: 'drawing', document: nextDoc },
      activeDrawing: nextDoc,
    });
  }

  async revert(): Promise<void> {
    if (!this.placedId) return;
    const state = useAppStore.getState();
    const doc = state.activeDocument;
    if (!doc || doc.kind !== 'drawing') return;

    const id = this.placedId;
    const nextDoc: DrawingDocument = {
      ...doc.document,
      sheets: doc.document.sheets.map((s) =>
        s.id === this.opts.sheetId
          ? { ...s, dimensions: s.dimensions.filter((d) => d.id !== id) }
          : s,
      ),
    };
    this.placedId = null;
    useAppStore.setState({
      activeDocument: { kind: 'drawing', document: nextDoc },
      activeDrawing: nextDoc,
    });
  }
}
```

**Commit:** `feat(drawing-f5): F5-T12 AddBaselineMemberCommand`

---

### F5-T13: `AddOrdinateMemberCommand`

**Slice goal:** Same pattern as T12 but for `kind: 'ordinate'` dims. Adds mandatory `axis: 'x' | 'y'` field. Group validation: must be `kind: 'ordinate'`. No slot — ordinate members have no implicit order.

**Failing test step (RED):**

File: `packages/app/src/commands/__tests__/AddOrdinateMemberCommand.spec.ts`

```ts
// packages/app/src/commands/__tests__/AddOrdinateMemberCommand.spec.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { AddOrdinateMemberCommand } from '../AddOrdinateMemberCommand';
import { useAppStore } from '../../store/useAppStore';
import type { DrawingDocument, DrawingDimension } from '@zilventor/shared';
import type { DimensionGroup } from '@zilventor/shared/src/drawing/types';

type DrawingActive = { kind: 'drawing'; document: DrawingDocument };

const ordinateGroup: DimensionGroup = {
  kind: 'ordinate', id: 'og1', viewId: 'v1',
  origin: { kind: 'edge-endpoint', edgeId: 'e0', end: 'start' },
  xColumnOffsetMm: 30, yColumnOffsetMm: 25,
};

const baselineGroup: DimensionGroup = {
  kind: 'baseline', id: 'bg1', viewId: 'v1',
  datum: { kind: 'edge-endpoint', edgeId: 'e0', end: 'start' },
  direction: 'h', baseOffsetMm: 20, spacingMm: 10,
};

function makeDoc(): DrawingDocument {
  return {
    id: 'dw1', name: 'Test', units: 'mm',
    source: { partPath: 'parts/box.zipt', sourceKind: 'part' },
    properties: {}, activeSheetId: 'sh1',
    sheets: [{
      id: 'sh1', name: 'Sheet 1',
      size: { kind: 'iso', size: 'A3' }, orientation: 'landscape',
      views: [], dimensions: [],
      dimensionGroups: [ordinateGroup, baselineGroup],
      annotations: [], titleBlock: {},
    }],
  };
}

const toRef = { kind: 'edge-endpoint' as const, edgeId: 'e1', end: 'end' as const };

beforeEach(() => {
  useAppStore.setState({ activeDocument: { kind: 'drawing', document: makeDoc() } } as never);
});

describe('AddOrdinateMemberCommand', () => {
  it('(a) apply appends ordinate dim with axis=x', async () => {
    const cmd = new AddOrdinateMemberCommand({ sheetId: 'sh1', groupId: 'og1', to: toRef, axis: 'x' });
    await cmd.apply();
    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    const dims = doc.sheets[0]!.dimensions;
    expect(dims).toHaveLength(1);
    expect(dims[0]).toMatchObject({ kind: 'ordinate', groupId: 'og1', axis: 'x', viewId: 'v1' });
  });

  it('(b) apply appends ordinate dim with axis=y', async () => {
    const cmd = new AddOrdinateMemberCommand({ sheetId: 'sh1', groupId: 'og1', to: toRef, axis: 'y' });
    await cmd.apply();
    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    expect((doc.sheets[0]!.dimensions[0] as unknown as { axis: string }).axis).toBe('y');
  });

  it('(c) revert removes the appended dim', async () => {
    const cmd = new AddOrdinateMemberCommand({ sheetId: 'sh1', groupId: 'og1', to: toRef, axis: 'x' });
    await cmd.apply();
    await cmd.revert();
    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    expect(doc.sheets[0]!.dimensions).toHaveLength(0);
  });

  it('(d) group-not-found throws', async () => {
    const cmd = new AddOrdinateMemberCommand({ sheetId: 'sh1', groupId: 'missing', to: toRef, axis: 'x' });
    await expect(cmd.apply()).rejects.toThrow('group-not-found');
  });

  it('(e) wrong-kind throws when group is baseline', async () => {
    const cmd = new AddOrdinateMemberCommand({ sheetId: 'sh1', groupId: 'bg1', to: toRef, axis: 'x' });
    await expect(cmd.apply()).rejects.toThrow('wrong-kind');
  });

  it('(f) sourceParameterName stored when provided', async () => {
    const cmd = new AddOrdinateMemberCommand({
      sheetId: 'sh1', groupId: 'og1', to: toRef, axis: 'y',
      opts: { sourceParameterName: 'height' },
    });
    await cmd.apply();
    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    const dim = doc.sheets[0]!.dimensions[0]!;
    expect((dim as unknown as { sourceParameterName: string }).sourceParameterName).toBe('height');
  });
});
```

**Expected failure:** `Cannot find module '../AddOrdinateMemberCommand'`

---

**Implementation step (GREEN):**

File: `packages/app/src/commands/AddOrdinateMemberCommand.ts`

```ts
import type { Command } from './Command';
import type { DrawingDocument, DrawingDimension } from '@zilventor/shared';
import type { PointRef } from '@zilventor/shared/src/drawing/types';
import { useAppStore } from '../store/useAppStore';
import { assertDimensionGroupInvariants } from './dimensionGroupInvariants';

export class AddOrdinateMemberCommand implements Command {
  readonly name = 'AddOrdinateMemberCommand';
  private placedId: string | null = null;

  constructor(private readonly opts: {
    sheetId: string;
    groupId: string;
    to: PointRef;
    axis: 'x' | 'y';
    opts?: { sourceParameterName?: string; textOverride?: string };
  }) {}

  async apply(): Promise<void> {
    const state = useAppStore.getState();
    const doc = state.activeDocument;
    if (!doc || doc.kind !== 'drawing') return;

    const sheet = doc.document.sheets.find((s) => s.id === this.opts.sheetId);
    if (!sheet) throw new Error('sheet-not-found');

    const groups = sheet.dimensionGroups ?? [];
    const group = groups.find((g) => g.id === this.opts.groupId);
    if (!group) throw new Error('group-not-found');
    if (group.kind !== 'ordinate') throw new Error('wrong-kind');

    const id = crypto.randomUUID();
    this.placedId = id;

    const newDim = {
      id,
      kind: 'ordinate' as const,
      viewId: group.viewId,
      groupId: this.opts.groupId,
      to: this.opts.to,
      axis: this.opts.axis,
      ...(this.opts.opts?.sourceParameterName !== undefined
        ? { sourceParameterName: this.opts.opts.sourceParameterName }
        : {}),
      ...(this.opts.opts?.textOverride !== undefined
        ? { textOverride: this.opts.opts.textOverride }
        : {}),
    } as unknown as DrawingDimension;

    const nextSheet = { ...sheet, dimensions: [...sheet.dimensions, newDim] };
    const nextDoc: DrawingDocument = {
      ...doc.document,
      sheets: doc.document.sheets.map((s) => s.id === this.opts.sheetId ? nextSheet : s),
    };

    assertDimensionGroupInvariants(nextSheet);

    useAppStore.setState({
      activeDocument: { kind: 'drawing', document: nextDoc },
      activeDrawing: nextDoc,
    });
  }

  async revert(): Promise<void> {
    if (!this.placedId) return;
    const state = useAppStore.getState();
    const doc = state.activeDocument;
    if (!doc || doc.kind !== 'drawing') return;

    const id = this.placedId;
    const nextDoc: DrawingDocument = {
      ...doc.document,
      sheets: doc.document.sheets.map((s) =>
        s.id === this.opts.sheetId
          ? { ...s, dimensions: s.dimensions.filter((d) => d.id !== id) }
          : s,
      ),
    };
    this.placedId = null;
    useAppStore.setState({
      activeDocument: { kind: 'drawing', document: nextDoc },
      activeDrawing: nextDoc,
    });
  }
}
```

**Commit:** `feat(drawing-f5): F5-T13 AddOrdinateMemberCommand`

---

### F5-T14: `AddAngularDimCommand`

**Slice goal:** Single-shot command (no group). Accepts `ref: { kind: 'two-edges'; edge1: EdgeRef; edge2: EdgeRef } | { kind: 'arc'; edge: EdgeRef }`. Defaults `arcSide = 'inside'`, `offsetMm = max(15, viewBboxMm.height * 0.1)`. Validates ref edges exist in `view.projection`. Reverts by dim id.

**Important:** `EdgeRef` in the spec is `{ viewId: string; edgeId: string }`. Because `DrawingDimension` currently only has radial/diametric using `edgeId: string` at top level, and the new `angular` kind is being added by Batch 1, use the shape inline here with `as unknown as DrawingDimension` cast until Batch 1 type lands.

**Failing test step (RED):**

File: `packages/app/src/commands/__tests__/AddAngularDimCommand.spec.ts`

```ts
// packages/app/src/commands/__tests__/AddAngularDimCommand.spec.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { AddAngularDimCommand } from '../AddAngularDimCommand';
import { useAppStore } from '../../store/useAppStore';
import type { DrawingDocument } from '@zilventor/shared';

type DrawingActive = { kind: 'drawing'; document: DrawingDocument };

function makeEdge2D(id: string) {
  return { id, kind: 'feature' as const, points: [[0, 0], [10, 10]] as ReadonlyArray<readonly [number, number]> };
}

function makeDoc() {
  return {
    id: 'dw1', name: 'Test', units: 'mm',
    source: { partPath: 'parts/box.zipt', sourceKind: 'part' },
    properties: {}, activeSheetId: 'sh1',
    sheets: [{
      id: 'sh1', name: 'Sheet 1',
      size: { kind: 'iso', size: 'A3' }, orientation: 'landscape',
      views: [{
        id: 'v1', kind: 'base', positionMm: { x: 0, y: 0 },
        scale: { numerator: 1, denominator: 1 }, orientation: 'front', showHidden: false,
        projection: {
          visibleEdges: [makeEdge2D('e1'), makeEdge2D('e2')],
          hiddenEdges: [],
          bbox: { minX: 0, minY: 0, maxX: 100, maxY: 80 },
        },
      }],
      dimensions: [], dimensionGroups: [], annotations: [], titleBlock: {},
    }],
  } satisfies DrawingDocument;
}

const twoEdgesRef = {
  kind: 'two-edges' as const,
  edge1: { viewId: 'v1', edgeId: 'e1' },
  edge2: { viewId: 'v1', edgeId: 'e2' },
};

beforeEach(() => {
  useAppStore.setState({ activeDocument: { kind: 'drawing', document: makeDoc() } } as never);
});

describe('AddAngularDimCommand', () => {
  it('(a) two-edges happy path appends angular dim', async () => {
    const cmd = new AddAngularDimCommand({ sheetId: 'sh1', viewId: 'v1', ref: twoEdgesRef });
    await cmd.apply();
    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    const dims = doc.sheets[0]!.dimensions;
    expect(dims).toHaveLength(1);
    expect(dims[0]).toMatchObject({ kind: 'angular', viewId: 'v1' });
  });

  it('(b) default arcSide is inside', async () => {
    const cmd = new AddAngularDimCommand({ sheetId: 'sh1', viewId: 'v1', ref: twoEdgesRef });
    await cmd.apply();
    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    const dim = doc.sheets[0]!.dimensions[0]! as unknown as { arcSide: string };
    expect(dim.arcSide).toBe('inside');
  });

  it('(c) default offsetMm = max(15, bboxHeight * 0.1) = max(15, 8) = 15 when bbox.height=80', async () => {
    const cmd = new AddAngularDimCommand({ sheetId: 'sh1', viewId: 'v1', ref: twoEdgesRef });
    await cmd.apply();
    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    const dim = doc.sheets[0]!.dimensions[0]! as unknown as { offsetMm: number };
    // bbox height = 80, 80*0.1=8, max(15,8)=15
    expect(dim.offsetMm).toBe(15);
  });

  it('(c2) offsetMm = bboxHeight*0.1 when bbox height is large (200)', async () => {
    const doc = makeDoc();
    const sheet = doc.sheets[0]!;
    const view = sheet.views[0]!;
    const bigDoc: DrawingDocument = {
      ...doc,
      sheets: [{
        ...sheet,
        views: [{
          ...view,
          projection: { ...view.projection!, bbox: { minX: 0, minY: 0, maxX: 100, maxY: 200 } },
        }],
      }],
    };
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: bigDoc } } as never);
    const cmd = new AddAngularDimCommand({ sheetId: 'sh1', viewId: 'v1', ref: twoEdgesRef });
    await cmd.apply();
    const state = useAppStore.getState();
    const doc2 = (state.activeDocument as unknown as DrawingActive).document;
    const dim = doc2.sheets[0]!.dimensions[0]! as unknown as { offsetMm: number };
    expect(dim.offsetMm).toBeCloseTo(20, 5); // max(15, 200*0.1=20) = 20
  });

  it('(d) explicit arcSide=outside is stored', async () => {
    const cmd = new AddAngularDimCommand({ sheetId: 'sh1', viewId: 'v1', ref: twoEdgesRef, arcSide: 'outside' });
    await cmd.apply();
    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    const dim = doc.sheets[0]!.dimensions[0]! as unknown as { arcSide: string };
    expect(dim.arcSide).toBe('outside');
  });

  it('(e) edge-not-in-view throws for unknown edgeId', async () => {
    const badRef = { kind: 'two-edges' as const, edge1: { viewId: 'v1', edgeId: 'NO' }, edge2: { viewId: 'v1', edgeId: 'e2' } };
    const cmd = new AddAngularDimCommand({ sheetId: 'sh1', viewId: 'v1', ref: badRef });
    await expect(cmd.apply()).rejects.toThrow('edge-not-in-view');
  });

  it('(f) revert removes the placed dim', async () => {
    const cmd = new AddAngularDimCommand({ sheetId: 'sh1', viewId: 'v1', ref: twoEdgesRef });
    await cmd.apply();
    await cmd.revert();
    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    expect(doc.sheets[0]!.dimensions).toHaveLength(0);
  });

  it('(g) arc-kind ref happy path', async () => {
    const arcRef = { kind: 'arc' as const, edge: { viewId: 'v1', edgeId: 'e1' } };
    const cmd = new AddAngularDimCommand({ sheetId: 'sh1', viewId: 'v1', ref: arcRef });
    await cmd.apply();
    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    expect(doc.sheets[0]!.dimensions[0]).toMatchObject({ kind: 'angular' });
  });
});
```

**Expected failure:** `Cannot find module '../AddAngularDimCommand'`

---

**Implementation step (GREEN):**

File: `packages/app/src/commands/AddAngularDimCommand.ts`

```ts
import type { Command } from './Command';
import type { DrawingDocument, DrawingDimension, DrawingView } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';

type EdgeRef = { readonly viewId: string; readonly edgeId: string };
type AngularRef =
  | { readonly kind: 'two-edges'; readonly edge1: EdgeRef; readonly edge2: EdgeRef }
  | { readonly kind: 'arc';       readonly edge: EdgeRef };

function findEdgeInView(view: DrawingView, edgeId: string): boolean {
  const proj = view.projection;
  if (!proj) return false;
  return (
    proj.visibleEdges.some((e) => e.id === edgeId) ||
    proj.hiddenEdges.some((e) => e.id === edgeId)
  );
}

export class AddAngularDimCommand implements Command {
  readonly name = 'AddAngularDimCommand';
  private placedId: string | null = null;

  constructor(private readonly opts: {
    sheetId: string;
    viewId: string;
    ref: AngularRef;
    arcSide?: 'inside' | 'outside';
    offsetMm?: number;
    opts?: { sourceParameterName?: string; textOverride?: string };
  }) {}

  async apply(): Promise<void> {
    const state = useAppStore.getState();
    const doc = state.activeDocument;
    if (!doc || doc.kind !== 'drawing') return;

    const sheet = doc.document.sheets.find((s) => s.id === this.opts.sheetId);
    if (!sheet) throw new Error('sheet-not-found');

    const view = sheet.views.find((v) => v.id === this.opts.viewId) as DrawingView | undefined;
    if (!view) throw new Error('view-not-found');

    // Validate edges exist in view
    const ref = this.opts.ref;
    if (ref.kind === 'two-edges') {
      if (!findEdgeInView(view, ref.edge1.edgeId)) throw new Error('edge-not-in-view');
      if (!findEdgeInView(view, ref.edge2.edgeId)) throw new Error('edge-not-in-view');
    } else {
      if (!findEdgeInView(view, ref.edge.edgeId)) throw new Error('edge-not-in-view');
    }

    // Compute offsetMm default: max(15, bbox.height * 0.1)
    const proj = view.projection;
    const bboxH = proj ? proj.bbox.maxY - proj.bbox.minY : 0;
    const offsetMm = this.opts.offsetMm ?? Math.max(15, bboxH * 0.1);
    const arcSide = this.opts.arcSide ?? 'inside';

    const id = crypto.randomUUID();
    this.placedId = id;

    const newDim = {
      id,
      kind: 'angular' as const,
      viewId: this.opts.viewId,
      ref,
      arcSide,
      offsetMm,
      ...(this.opts.opts?.sourceParameterName !== undefined
        ? { sourceParameterName: this.opts.opts.sourceParameterName }
        : {}),
      ...(this.opts.opts?.textOverride !== undefined
        ? { textOverride: this.opts.opts.textOverride }
        : {}),
    } as unknown as DrawingDimension;

    const nextDoc: DrawingDocument = {
      ...doc.document,
      sheets: doc.document.sheets.map((s) =>
        s.id === this.opts.sheetId
          ? { ...s, dimensions: [...s.dimensions, newDim] }
          : s,
      ),
    };
    useAppStore.setState({
      activeDocument: { kind: 'drawing', document: nextDoc },
      activeDrawing: nextDoc,
    });
  }

  async revert(): Promise<void> {
    if (!this.placedId) return;
    const state = useAppStore.getState();
    const doc = state.activeDocument;
    if (!doc || doc.kind !== 'drawing') return;

    const id = this.placedId;
    const nextDoc: DrawingDocument = {
      ...doc.document,
      sheets: doc.document.sheets.map((s) =>
        s.id === this.opts.sheetId
          ? { ...s, dimensions: s.dimensions.filter((d) => d.id !== id) }
          : s,
      ),
    };
    this.placedId = null;
    useAppStore.setState({
      activeDocument: { kind: 'drawing', document: nextDoc },
      activeDrawing: nextDoc,
    });
  }
}
```

**Commit:** `feat(drawing-f5): F5-T14 AddAngularDimCommand`

---

### F5-T15: `DeleteDimensionGroupCommand`

**Slice goal:** Remove a group AND all its member dims in one atomic operation. Revert restores both group and members in their original insertion order.

**Failing test step (RED):**

File: `packages/app/src/commands/__tests__/DeleteDimensionGroupCommand.spec.ts`

```ts
// packages/app/src/commands/__tests__/DeleteDimensionGroupCommand.spec.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { DeleteDimensionGroupCommand } from '../DeleteDimensionGroupCommand';
import { useAppStore } from '../../store/useAppStore';
import type { DrawingDocument, DrawingDimension } from '@zilventor/shared';
import type { DimensionGroup } from '@zilventor/shared/src/drawing/types';

type DrawingActive = { kind: 'drawing'; document: DrawingDocument };

const group: DimensionGroup = {
  kind: 'baseline', id: 'bg1', viewId: 'v1',
  datum: { kind: 'edge-endpoint', edgeId: 'e0', end: 'start' },
  direction: 'h', baseOffsetMm: 20, spacingMm: 10,
};

// Two members belonging to the group
const mem0 = {
  id: 'bm0', kind: 'baseline', viewId: 'v1', groupId: 'bg1', slot: 0,
  to: { kind: 'edge-endpoint', edgeId: 'e1', end: 'end' },
} as unknown as DrawingDimension;

const mem1 = {
  id: 'bm1', kind: 'baseline', viewId: 'v1', groupId: 'bg1', slot: 1,
  to: { kind: 'edge-endpoint', edgeId: 'e2', end: 'end' },
} as unknown as DrawingDimension;

// A dim belonging to a DIFFERENT group (must survive cascade)
const unrelated: DrawingDimension = {
  id: 'lh1', kind: 'linear-h', viewId: 'v1',
  from: { kind: 'edge-endpoint', edgeId: 'e3', end: 'start' },
  to:   { kind: 'edge-endpoint', edgeId: 'e4', end: 'end' },
  offsetMm: 10,
};

function makeDoc(): DrawingDocument {
  return {
    id: 'dw1', name: 'Test', units: 'mm',
    source: { partPath: 'parts/box.zipt', sourceKind: 'part' },
    properties: {}, activeSheetId: 'sh1',
    sheets: [{
      id: 'sh1', name: 'Sheet 1',
      size: { kind: 'iso', size: 'A3' }, orientation: 'landscape',
      views: [],
      dimensions: [mem0, mem1, unrelated],
      dimensionGroups: [group],
      annotations: [], titleBlock: {},
    }],
  };
}

beforeEach(() => {
  useAppStore.setState({ activeDocument: { kind: 'drawing', document: makeDoc() } } as never);
});

describe('DeleteDimensionGroupCommand', () => {
  it('(a) apply removes the group', async () => {
    const cmd = new DeleteDimensionGroupCommand({ sheetId: 'sh1', groupId: 'bg1' });
    await cmd.apply();
    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    expect(doc.sheets[0]!.dimensionGroups).toHaveLength(0);
  });

  it('(b) apply cascade-removes all member dims', async () => {
    const cmd = new DeleteDimensionGroupCommand({ sheetId: 'sh1', groupId: 'bg1' });
    await cmd.apply();
    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    const dims = doc.sheets[0]!.dimensions;
    expect(dims.every((d) => (d as unknown as { groupId?: string }).groupId !== 'bg1')).toBe(true);
  });

  it('(c) cascade does NOT remove unrelated dims', async () => {
    const cmd = new DeleteDimensionGroupCommand({ sheetId: 'sh1', groupId: 'bg1' });
    await cmd.apply();
    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    const dims = doc.sheets[0]!.dimensions;
    expect(dims.some((d) => d.id === 'lh1')).toBe(true);
  });

  it('(d) revert restores group and members in original order', async () => {
    const cmd = new DeleteDimensionGroupCommand({ sheetId: 'sh1', groupId: 'bg1' });
    await cmd.apply();
    await cmd.revert();
    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    const sheet = doc.sheets[0]!;
    // Group restored
    expect(sheet.dimensionGroups).toHaveLength(1);
    expect(sheet.dimensionGroups[0]!.id).toBe('bg1');
    // Members restored (order: bm0 before bm1)
    const memberIds = sheet.dimensions
      .filter((d) => (d as unknown as { groupId?: string }).groupId === 'bg1')
      .map((d) => d.id);
    expect(memberIds).toEqual(['bm0', 'bm1']);
  });

  it('(e) group-not-found throws', async () => {
    const cmd = new DeleteDimensionGroupCommand({ sheetId: 'sh1', groupId: 'missing' });
    await expect(cmd.apply()).rejects.toThrow('group-not-found');
  });
});
```

**Expected failure:** `Cannot find module '../DeleteDimensionGroupCommand'`

---

**Implementation step (GREEN):**

File: `packages/app/src/commands/DeleteDimensionGroupCommand.ts`

```ts
import type { Command } from './Command';
import type { DrawingDocument, DrawingDimension } from '@zilventor/shared';
import type { DimensionGroup } from '@zilventor/shared/src/drawing/types';
import { useAppStore } from '../store/useAppStore';

export class DeleteDimensionGroupCommand implements Command {
  readonly name = 'DeleteDimensionGroupCommand';

  // Saved for revert
  private savedGroup: DimensionGroup | null = null;
  private savedMembers: DrawingDimension[] = [];
  private savedMemberIndices: number[] = [];
  private savedGroupIndex = -1;

  constructor(private readonly opts: { sheetId: string; groupId: string }) {}

  async apply(): Promise<void> {
    const state = useAppStore.getState();
    const doc = state.activeDocument;
    if (!doc || doc.kind !== 'drawing') return;

    const sheet = doc.document.sheets.find((s) => s.id === this.opts.sheetId);
    if (!sheet) throw new Error('sheet-not-found');

    const groupIdx = (sheet.dimensionGroups ?? []).findIndex((g) => g.id === this.opts.groupId);
    if (groupIdx === -1) throw new Error('group-not-found');

    this.savedGroup = (sheet.dimensionGroups ?? [])[groupIdx]!;
    this.savedGroupIndex = groupIdx;

    // Identify member dims (baseline or ordinate with matching groupId)
    const memberIndices: number[] = [];
    const members: DrawingDimension[] = [];
    sheet.dimensions.forEach((d, i) => {
      const gd = d as unknown as { groupId?: string };
      if (gd.groupId === this.opts.groupId) {
        memberIndices.push(i);
        members.push(d);
      }
    });
    this.savedMembers = members;
    this.savedMemberIndices = memberIndices;

    const memberIdSet = new Set(members.map((m) => m.id));

    const nextSheet = {
      ...sheet,
      dimensionGroups: (sheet.dimensionGroups ?? []).filter((g) => g.id !== this.opts.groupId),
      dimensions: sheet.dimensions.filter((d) => !memberIdSet.has(d.id)),
    };
    const nextDoc: DrawingDocument = {
      ...doc.document,
      sheets: doc.document.sheets.map((s) => s.id === this.opts.sheetId ? nextSheet : s),
    };
    useAppStore.setState({
      activeDocument: { kind: 'drawing', document: nextDoc },
      activeDrawing: nextDoc,
    });
  }

  async revert(): Promise<void> {
    if (!this.savedGroup) return;
    const state = useAppStore.getState();
    const doc = state.activeDocument;
    if (!doc || doc.kind !== 'drawing') return;

    const sheet = doc.document.sheets.find((s) => s.id === this.opts.sheetId);
    if (!sheet) return;

    // Restore group at original index
    const groups = [...(sheet.dimensionGroups ?? [])];
    groups.splice(this.savedGroupIndex, 0, this.savedGroup!);

    // Restore members at their original indices (splice in reverse to preserve positions)
    const dims = [...sheet.dimensions];
    const sorted = this.savedMembers
      .map((m, i) => ({ m, idx: this.savedMemberIndices[i]! }))
      .sort((a, b) => a.idx - b.idx);
    for (const { m, idx } of sorted) {
      dims.splice(idx, 0, m);
    }

    const nextSheet = { ...sheet, dimensionGroups: groups, dimensions: dims };
    const nextDoc: DrawingDocument = {
      ...doc.document,
      sheets: doc.document.sheets.map((s) => s.id === this.opts.sheetId ? nextSheet : s),
    };
    this.savedGroup = null;
    this.savedMembers = [];
    this.savedMemberIndices = [];
    this.savedGroupIndex = -1;
    useAppStore.setState({
      activeDocument: { kind: 'drawing', document: nextDoc },
      activeDrawing: nextDoc,
    });
  }
}
```

**Commit:** `feat(drawing-f5): F5-T15 DeleteDimensionGroupCommand`

---

### F5-T16: Update `DeleteDrawingDimensionCommand` for new kinds

**Slice goal:** When deleting a `baseline` or `ordinate` dim that is the last member of its group, the group is NOT cascade-deleted — it remains empty. The angular kind has no group, so it deletes like any other dim. Existing tests must still pass.

**Failing test step (RED):**

Extend `packages/app/src/commands/__tests__/DeleteDrawingDimensionCommand.spec.ts` with:

```ts
// Append inside the existing describe block at bottom of the existing file
import type { DimensionGroup } from '@zilventor/shared/src/drawing/types';

describe('DeleteDrawingDimensionCommand — F5 new kinds', () => {
  function makeDocWithGroup(): DrawingDocument {
    const group: DimensionGroup = {
      kind: 'baseline', id: 'bg1', viewId: 'v1',
      datum: { kind: 'edge-endpoint', edgeId: 'e0', end: 'start' },
      direction: 'h', baseOffsetMm: 20, spacingMm: 10,
    };
    const mem: DrawingDimension = {
      id: 'bm0', kind: 'baseline', viewId: 'v1', groupId: 'bg1', slot: 0,
      to: { kind: 'edge-endpoint', edgeId: 'e1', end: 'end' },
    } as unknown as DrawingDimension;
    return {
      id: 'dw1', name: 'Test', units: 'mm',
      source: { partPath: 'parts/box.zipt', sourceKind: 'part' },
      properties: {}, activeSheetId: 'sh1',
      sheets: [{
        id: 'sh1', name: 'Sheet 1',
        size: { kind: 'iso', size: 'A3' }, orientation: 'landscape',
        views: [], dimensions: [mem], dimensionGroups: [group], annotations: [], titleBlock: {},
      }],
    };
  }

  it('deleting last baseline member leaves group intact (non-cascade)', async () => {
    useAppStore.setState({
      activeDocument: { kind: 'drawing', document: makeDocWithGroup() },
    } as never);
    const cmd = new DeleteDrawingDimensionCommand({ sheetId: 'sh1', dimId: 'bm0' });
    await cmd.apply();
    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    const sheet = doc.sheets[0]!;
    expect(sheet.dimensions).toHaveLength(0);
    // Group MUST still be present
    expect(sheet.dimensionGroups).toHaveLength(1);
    expect(sheet.dimensionGroups![0]!.id).toBe('bg1');
  });

  it('deleting an angular dim removes it; no group side-effects', async () => {
    const angularDim: DrawingDimension = {
      id: 'ang1', kind: 'angular', viewId: 'v1',
      ref: { kind: 'two-edges', edge1: { viewId: 'v1', edgeId: 'e1' }, edge2: { viewId: 'v1', edgeId: 'e2' } },
      arcSide: 'inside', offsetMm: 15,
    } as unknown as DrawingDimension;
    const doc: DrawingDocument = {
      id: 'dw1', name: 'Test', units: 'mm',
      source: { partPath: 'parts/box.zipt', sourceKind: 'part' },
      properties: {}, activeSheetId: 'sh1',
      sheets: [{
        id: 'sh1', name: 'Sheet 1',
        size: { kind: 'iso', size: 'A3' }, orientation: 'landscape',
        views: [], dimensions: [angularDim], dimensionGroups: [], annotations: [], titleBlock: {},
      }],
    };
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: doc } } as never);
    const cmd = new DeleteDrawingDimensionCommand({ sheetId: 'sh1', dimId: 'ang1' });
    await cmd.apply();
    const state = useAppStore.getState();
    const doc2 = (state.activeDocument as unknown as DrawingActive).document;
    expect(doc2.sheets[0]!.dimensions).toHaveLength(0);
  });
});
```

**Expected failure:** Tests fail because `DeleteDrawingDimensionCommand` does not write `dimensionGroups` back (only mutates `dimensions`). The group-presence assertion fails because existing code doesn't carry `dimensionGroups` through in its store write.

---

**Implementation step (GREEN):**

Edit `packages/app/src/commands/DeleteDrawingDimensionCommand.ts`. The existing `apply` maps `sheets.map(sh => sh.id !== opts.sheetId ? sh : {...sh, dimensions: filtered})`. If the current sheet has no `dimensionGroups`, the spread carries it anyway. The tests fail because the fixture adds `dimensionGroups` to the sheet and the existing code doesn't touch it — but if `DrawingSheet` type doesn't yet include `dimensionGroups`, the spread may drop it.

The fix is minimal: the existing spread `{ ...sh, dimensions }` already preserves any extra fields if TypeScript allows them. No code change is needed IF `DrawingSheet` already has `dimensionGroups: readonly DimensionGroup[]` from Batch 1. If Batch 1 is not yet merged, add a defensive `dimensionGroups: sh.dimensionGroups ?? []` to the spread.

After Batch 1 merge, verify no code change is needed and mark the test green. If a change is needed:

```ts
// In apply(), replace the sheet spread:
return {
  ...sh,
  dimensions,
  dimensionGroups: sh.dimensionGroups ?? [],  // carry through unchanged
};
```

Similarly in `revert()`:
```ts
return {
  ...sh,
  dimensions: dims,
  dimensionGroups: sh.dimensionGroups ?? [],
};
```

The intent is clear: `DeleteDrawingDimensionCommand` does NOT touch `dimensionGroups`. The group stays. The test verifies this invariant.

**Commit:** `feat(drawing-f5): F5-T16 DeleteDrawingDimensionCommand handles new dim kinds`

---

### F5-T17: Update `MoveDrawingDimensionCommand` for baseline/ordinate/angular

**Slice goal:** Extend `MoveDrawingDimensionCommand` so that:
- Dragging a `baseline` dim mutates `group.baseOffsetMm` on its group (not `dim.offsetMm`).
- Dragging an `ordinate` dim mutates `group.xColumnOffsetMm` or `group.yColumnOffsetMm` based on `dim.axis`.
- Dragging an `angular` dim mutates `dim.offsetMm` directly (same as existing behavior).

The `opts` interface gains an optional `newGroupOffsetMm` field to carry the new group-level offset for baseline/ordinate drags. The command inspects `dim.kind` to route the mutation.

**Failing test step (RED):**

File: `packages/app/src/commands/__tests__/MoveDrawingDimensionCommand.spec.ts` — append new describe block:

```ts
// Append after existing describe block
import type { DimensionGroup } from '@zilventor/shared/src/drawing/types';

describe('MoveDrawingDimensionCommand — F5 new kinds', () => {
  function makeDocWithBaseline(): DrawingDocument {
    const group: DimensionGroup = {
      kind: 'baseline', id: 'bg1', viewId: 'v1',
      datum: { kind: 'edge-endpoint', edgeId: 'e0', end: 'start' },
      direction: 'h', baseOffsetMm: 20, spacingMm: 10,
    };
    const mem: DrawingDimension = {
      id: 'bm0', kind: 'baseline', viewId: 'v1', groupId: 'bg1', slot: 0,
      to: { kind: 'edge-endpoint', edgeId: 'e1', end: 'end' },
    } as unknown as DrawingDimension;
    return {
      id: 'dw1', name: 'Test', units: 'mm',
      source: { partPath: 'parts/box.zipt', sourceKind: 'part' },
      properties: {}, activeSheetId: 'sh1',
      sheets: [{
        id: 'sh1', name: 'Sheet 1',
        size: { kind: 'iso', size: 'A3' }, orientation: 'landscape',
        views: [], dimensions: [mem], dimensionGroups: [group], annotations: [], titleBlock: {},
      }],
    };
  }

  function makeDocWithOrdinate(axis: 'x' | 'y'): DrawingDocument {
    const group: DimensionGroup = {
      kind: 'ordinate', id: 'og1', viewId: 'v1',
      origin: { kind: 'edge-endpoint', edgeId: 'e0', end: 'start' },
      xColumnOffsetMm: 30, yColumnOffsetMm: 25,
    };
    const mem: DrawingDimension = {
      id: 'om0', kind: 'ordinate', viewId: 'v1', groupId: 'og1', axis,
      to: { kind: 'edge-endpoint', edgeId: 'e1', end: 'end' },
    } as unknown as DrawingDimension;
    return {
      id: 'dw1', name: 'Test', units: 'mm',
      source: { partPath: 'parts/box.zipt', sourceKind: 'part' },
      properties: {}, activeSheetId: 'sh1',
      sheets: [{
        id: 'sh1', name: 'Sheet 1',
        size: { kind: 'iso', size: 'A3' }, orientation: 'landscape',
        views: [], dimensions: [mem], dimensionGroups: [group], annotations: [], titleBlock: {},
      }],
    };
  }

  it('(a) baseline drag mutates group.baseOffsetMm', async () => {
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: makeDocWithBaseline() } } as never);
    const cmd = new MoveDrawingDimensionCommand({ sheetId: 'sh1', dimId: 'bm0', offsetMm: 35 });
    await cmd.apply();
    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    const group = doc.sheets[0]!.dimensionGroups![0]! as unknown as { baseOffsetMm: number };
    expect(group.baseOffsetMm).toBe(35);
  });

  it('(b) baseline drag revert restores group.baseOffsetMm', async () => {
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: makeDocWithBaseline() } } as never);
    const cmd = new MoveDrawingDimensionCommand({ sheetId: 'sh1', dimId: 'bm0', offsetMm: 35 });
    await cmd.apply();
    await cmd.revert();
    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    const group = doc.sheets[0]!.dimensionGroups![0]! as unknown as { baseOffsetMm: number };
    expect(group.baseOffsetMm).toBe(20);
  });

  it('(c) ordinate axis=x drag mutates group.xColumnOffsetMm', async () => {
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: makeDocWithOrdinate('x') } } as never);
    const cmd = new MoveDrawingDimensionCommand({ sheetId: 'sh1', dimId: 'om0', offsetMm: 50 });
    await cmd.apply();
    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    const group = doc.sheets[0]!.dimensionGroups![0]! as unknown as { xColumnOffsetMm: number; yColumnOffsetMm: number };
    expect(group.xColumnOffsetMm).toBe(50);
    expect(group.yColumnOffsetMm).toBe(25); // unchanged
  });

  it('(d) ordinate axis=y drag mutates group.yColumnOffsetMm', async () => {
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: makeDocWithOrdinate('y') } } as never);
    const cmd = new MoveDrawingDimensionCommand({ sheetId: 'sh1', dimId: 'om0', offsetMm: 60 });
    await cmd.apply();
    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    const group = doc.sheets[0]!.dimensionGroups![0]! as unknown as { yColumnOffsetMm: number };
    expect(group.yColumnOffsetMm).toBe(60);
  });

  it('(e) angular drag mutates dim.offsetMm directly', async () => {
    const angularDim: DrawingDimension = {
      id: 'ang1', kind: 'angular', viewId: 'v1',
      ref: { kind: 'two-edges', edge1: { viewId: 'v1', edgeId: 'e1' }, edge2: { viewId: 'v1', edgeId: 'e2' } },
      arcSide: 'inside', offsetMm: 15,
    } as unknown as DrawingDimension;
    const doc: DrawingDocument = {
      id: 'dw1', name: 'Test', units: 'mm',
      source: { partPath: 'parts/box.zipt', sourceKind: 'part' },
      properties: {}, activeSheetId: 'sh1',
      sheets: [{
        id: 'sh1', name: 'Sheet 1',
        size: { kind: 'iso', size: 'A3' }, orientation: 'landscape',
        views: [], dimensions: [angularDim], dimensionGroups: [], annotations: [], titleBlock: {},
      }],
    };
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: doc } } as never);
    const cmd = new MoveDrawingDimensionCommand({ sheetId: 'sh1', dimId: 'ang1', offsetMm: 30 });
    await cmd.apply();
    const state = useAppStore.getState();
    const doc2 = (state.activeDocument as unknown as DrawingActive).document;
    const dim = doc2.sheets[0]!.dimensions[0]! as unknown as { offsetMm: number };
    expect(dim.offsetMm).toBe(30);
  });
});
```

**Expected failure:** The 'baseline drag mutates group.baseOffsetMm' test fails because `MoveDrawingDimensionCommand` currently only modifies `dimensions`, not `dimensionGroups`.

---

**Implementation step (GREEN):**

Replace `packages/app/src/commands/MoveDrawingDimensionCommand.ts` entirely:

```ts
import type { Command } from './Command';
import type { DrawingDocument, DrawingDimension } from '@zilventor/shared';
import type { DimensionGroup } from '@zilventor/shared/src/drawing/types';
import { useAppStore } from '../store/useAppStore';

type BaselineDim  = DrawingDimension & { kind: 'baseline';  groupId: string };
type OrdinateDim  = DrawingDimension & { kind: 'ordinate';  groupId: string; axis: 'x' | 'y' };

export class MoveDrawingDimensionCommand implements Command {
  readonly name = 'MoveDrawingDimension';

  // Prior state for revert — one of three cases:
  private prevDimOffsetMm: number | undefined;
  private prevDimAngleDeg: number | undefined;
  private prevGroupOffsetMm: number | undefined;   // for baseline
  private prevXColumnOffsetMm: number | undefined; // for ordinate x
  private prevYColumnOffsetMm: number | undefined; // for ordinate y
  private movedKind: 'dim' | 'baseline-group' | 'ordinate-x' | 'ordinate-y' = 'dim';
  private movedGroupId: string | undefined;

  constructor(private readonly opts: {
    sheetId: string;
    dimId: string;
    offsetMm: number;
    angleDeg?: number;
  }) {}

  async apply(): Promise<void> {
    const state = useAppStore.getState();
    const doc = state.activeDocument;
    if (!doc || doc.kind !== 'drawing') return;

    const sheet = doc.document.sheets.find((s) => s.id === this.opts.sheetId);
    if (!sheet) return;

    const dim = sheet.dimensions.find((d) => d.id === this.opts.dimId);
    if (!dim) return;

    if (dim.kind === 'baseline') {
      const bd = dim as unknown as BaselineDim;
      const groups = sheet.dimensionGroups ?? [];
      const gIdx = groups.findIndex((g) => g.id === bd.groupId);
      if (gIdx === -1) return;
      const group = groups[gIdx] as Extract<DimensionGroup, { kind: 'baseline' }>;
      this.prevGroupOffsetMm = group.baseOffsetMm;
      this.movedKind = 'baseline-group';
      this.movedGroupId = bd.groupId;

      const nextGroup = { ...group, baseOffsetMm: this.opts.offsetMm };
      const nextGroups = groups.map((g, i) => i === gIdx ? nextGroup : g);
      const nextDoc: DrawingDocument = {
        ...doc.document,
        sheets: doc.document.sheets.map((s) =>
          s.id === this.opts.sheetId ? { ...s, dimensionGroups: nextGroups } : s,
        ),
      };
      useAppStore.setState({ activeDocument: { kind: 'drawing', document: nextDoc }, activeDrawing: nextDoc });
      return;
    }

    if (dim.kind === 'ordinate') {
      const od = dim as unknown as OrdinateDim;
      const groups = sheet.dimensionGroups ?? [];
      const gIdx = groups.findIndex((g) => g.id === od.groupId);
      if (gIdx === -1) return;
      const group = groups[gIdx] as Extract<DimensionGroup, { kind: 'ordinate' }>;
      this.movedGroupId = od.groupId;

      let nextGroup: DimensionGroup;
      if (od.axis === 'x') {
        this.prevXColumnOffsetMm = group.xColumnOffsetMm;
        this.movedKind = 'ordinate-x';
        nextGroup = { ...group, xColumnOffsetMm: this.opts.offsetMm };
      } else {
        this.prevYColumnOffsetMm = group.yColumnOffsetMm;
        this.movedKind = 'ordinate-y';
        nextGroup = { ...group, yColumnOffsetMm: this.opts.offsetMm };
      }

      const nextGroups = groups.map((g, i) => i === gIdx ? nextGroup : g);
      const nextDoc: DrawingDocument = {
        ...doc.document,
        sheets: doc.document.sheets.map((s) =>
          s.id === this.opts.sheetId ? { ...s, dimensionGroups: nextGroups } : s,
        ),
      };
      useAppStore.setState({ activeDocument: { kind: 'drawing', document: nextDoc }, activeDrawing: nextDoc });
      return;
    }

    // angular and all legacy dim kinds: mutate dim.offsetMm (and optionally angleDeg)
    this.movedKind = 'dim';
    this.prevDimOffsetMm = (dim as { offsetMm: number }).offsetMm;
    this.prevDimAngleDeg = (dim as { angleDeg?: number }).angleDeg;

    const sheets = doc.document.sheets.map((sh) => {
      if (sh.id !== this.opts.sheetId) return sh;
      const dimensions = sh.dimensions.map((d) => {
        if (d.id !== this.opts.dimId) return d;
        const updated = { ...d, offsetMm: this.opts.offsetMm } as DrawingDimension;
        if (this.opts.angleDeg !== undefined && 'angleDeg' in d) {
          return { ...updated, angleDeg: this.opts.angleDeg } as DrawingDimension;
        }
        return updated;
      });
      return { ...sh, dimensions };
    });
    const nextDoc: DrawingDocument = { ...doc.document, sheets };
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: nextDoc }, activeDrawing: nextDoc });
  }

  async revert(): Promise<void> {
    const state = useAppStore.getState();
    const doc = state.activeDocument;
    if (!doc || doc.kind !== 'drawing') return;

    if (this.movedKind === 'baseline-group' && this.movedGroupId !== undefined && this.prevGroupOffsetMm !== undefined) {
      const prevOffset = this.prevGroupOffsetMm;
      const groupId = this.movedGroupId;
      const sheets = doc.document.sheets.map((sh) => {
        if (sh.id !== this.opts.sheetId) return sh;
        const dimensionGroups = (sh.dimensionGroups ?? []).map((g) =>
          g.id === groupId && g.kind === 'baseline'
            ? { ...g, baseOffsetMm: prevOffset }
            : g,
        );
        return { ...sh, dimensionGroups };
      });
      const nextDoc: DrawingDocument = { ...doc.document, sheets };
      this.prevGroupOffsetMm = undefined;
      useAppStore.setState({ activeDocument: { kind: 'drawing', document: nextDoc }, activeDrawing: nextDoc });
      return;
    }

    if ((this.movedKind === 'ordinate-x' || this.movedKind === 'ordinate-y') && this.movedGroupId !== undefined) {
      const kind = this.movedKind;
      const groupId = this.movedGroupId;
      const prevX = this.prevXColumnOffsetMm;
      const prevY = this.prevYColumnOffsetMm;
      const sheets = doc.document.sheets.map((sh) => {
        if (sh.id !== this.opts.sheetId) return sh;
        const dimensionGroups = (sh.dimensionGroups ?? []).map((g) => {
          if (g.id !== groupId || g.kind !== 'ordinate') return g;
          if (kind === 'ordinate-x' && prevX !== undefined) return { ...g, xColumnOffsetMm: prevX };
          if (kind === 'ordinate-y' && prevY !== undefined) return { ...g, yColumnOffsetMm: prevY };
          return g;
        });
        return { ...sh, dimensionGroups };
      });
      const nextDoc: DrawingDocument = { ...doc.document, sheets };
      this.prevXColumnOffsetMm = undefined;
      this.prevYColumnOffsetMm = undefined;
      useAppStore.setState({ activeDocument: { kind: 'drawing', document: nextDoc }, activeDrawing: nextDoc });
      return;
    }

    // Legacy dim revert
    if (this.prevDimOffsetMm === undefined) return;
    const prevOffsetMm = this.prevDimOffsetMm;
    const prevAngleDeg = this.prevDimAngleDeg;
    const sheets = doc.document.sheets.map((sh) => {
      if (sh.id !== this.opts.sheetId) return sh;
      const dimensions = sh.dimensions.map((d) => {
        if (d.id !== this.opts.dimId) return d;
        const restored = { ...d, offsetMm: prevOffsetMm } as DrawingDimension;
        if (prevAngleDeg !== undefined && 'angleDeg' in d) {
          return { ...restored, angleDeg: prevAngleDeg } as DrawingDimension;
        }
        return restored;
      });
      return { ...sh, dimensions };
    });
    const nextDoc: DrawingDocument = { ...doc.document, sheets };
    this.prevDimOffsetMm = undefined;
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: nextDoc }, activeDrawing: nextDoc });
  }
}
```

**Commit:** `feat(drawing-f5): F5-T17 MoveDrawingDimensionCommand handles baseline/ordinate/angular`

---

### F5-T18: `assertDimensionGroupInvariants` helper

**Slice goal:** Export a pure function that throws with a specific message when group invariants are violated. Called from `apply()` in each new command that modifies `dimensionGroups` or member dims. Lives at `packages/app/src/commands/dimensionGroupInvariants.ts` (app-layer helper; depends on store shape but not store itself).

Three invariants:
1. **Orphaned member** — a `baseline` or `ordinate` dim whose `groupId` does not resolve to any group.
2. **Mismatched kind** — a `baseline` dim whose group is `kind: 'ordinate'` (or vice versa).
3. **Mismatched viewId** — a `baseline`/`ordinate` dim whose `viewId` differs from its group's `viewId`.

The function takes a partial sheet shape `{ dimensions: readonly DrawingDimension[]; dimensionGroups?: readonly DimensionGroup[] }`.

**Failing test step (RED):**

File: `packages/app/src/commands/__tests__/dimensionGroupInvariants.spec.ts`

```ts
// packages/app/src/commands/__tests__/dimensionGroupInvariants.spec.ts
import { describe, it, expect } from 'vitest';
import { assertDimensionGroupInvariants } from '../dimensionGroupInvariants';
import type { DrawingDimension } from '@zilventor/shared';
import type { DimensionGroup } from '@zilventor/shared/src/drawing/types';

const baselineGroup: DimensionGroup = {
  kind: 'baseline', id: 'bg1', viewId: 'v1',
  datum: { kind: 'edge-endpoint', edgeId: 'e0', end: 'start' },
  direction: 'h', baseOffsetMm: 20, spacingMm: 10,
};

const ordinateGroup: DimensionGroup = {
  kind: 'ordinate', id: 'og1', viewId: 'v1',
  origin: { kind: 'edge-endpoint', edgeId: 'e0', end: 'start' },
  xColumnOffsetMm: 30, yColumnOffsetMm: 25,
};

function validBaselineMem(id: string): DrawingDimension {
  return {
    id, kind: 'baseline', viewId: 'v1', groupId: 'bg1', slot: 0,
    to: { kind: 'edge-endpoint', edgeId: 'e1', end: 'end' },
  } as unknown as DrawingDimension;
}

describe('assertDimensionGroupInvariants', () => {
  it('(a) passes for valid baseline group + member', () => {
    expect(() => assertDimensionGroupInvariants({
      dimensions: [validBaselineMem('bm0')],
      dimensionGroups: [baselineGroup],
    })).not.toThrow();
  });

  it('(b) throws orphaned-member when groupId not found', () => {
    const orphan: DrawingDimension = {
      id: 'bm-orphan', kind: 'baseline', viewId: 'v1', groupId: 'missing', slot: 0,
      to: { kind: 'edge-endpoint', edgeId: 'e1', end: 'end' },
    } as unknown as DrawingDimension;
    expect(() => assertDimensionGroupInvariants({
      dimensions: [orphan],
      dimensionGroups: [baselineGroup],
    })).toThrow('orphaned-member');
  });

  it('(c) throws mismatched-kind when baseline dim references ordinate group', () => {
    const badKindDim: DrawingDimension = {
      id: 'bm-bad', kind: 'baseline', viewId: 'v1', groupId: 'og1', slot: 0,
      to: { kind: 'edge-endpoint', edgeId: 'e1', end: 'end' },
    } as unknown as DrawingDimension;
    expect(() => assertDimensionGroupInvariants({
      dimensions: [badKindDim],
      dimensionGroups: [ordinateGroup],
    })).toThrow('mismatched-kind');
  });

  it('(d) throws mismatched-viewId when dim.viewId differs from group.viewId', () => {
    const badViewDim: DrawingDimension = {
      id: 'bm-badview', kind: 'baseline', viewId: 'v2', groupId: 'bg1', slot: 0,
      to: { kind: 'edge-endpoint', edgeId: 'e1', end: 'end' },
    } as unknown as DrawingDimension;
    expect(() => assertDimensionGroupInvariants({
      dimensions: [badViewDim],
      dimensionGroups: [baselineGroup],
    })).toThrow('mismatched-viewId');
  });

  it('(e) non-member dim kinds (linear-h, angular) are not checked', () => {
    const linearDim: DrawingDimension = {
      id: 'lh1', kind: 'linear-h', viewId: 'v1',
      from: { kind: 'edge-endpoint', edgeId: 'e1', end: 'start' },
      to: { kind: 'edge-endpoint', edgeId: 'e2', end: 'end' },
      offsetMm: 10,
    };
    expect(() => assertDimensionGroupInvariants({
      dimensions: [linearDim],
      dimensionGroups: [],
    })).not.toThrow();
  });
});
```

**Expected failure:** `Cannot find module '../dimensionGroupInvariants'`

---

**Implementation step (GREEN):**

File: `packages/app/src/commands/dimensionGroupInvariants.ts`

```ts
import type { DrawingDimension } from '@zilventor/shared';
import type { DimensionGroup } from '@zilventor/shared/src/drawing/types';

type SheetLike = {
  dimensions: readonly DrawingDimension[];
  dimensionGroups?: readonly DimensionGroup[];
};

type GroupMemberDim = DrawingDimension & { groupId: string };

function isGroupMember(d: DrawingDimension): d is GroupMemberDim {
  return (d.kind === 'baseline' || d.kind === 'ordinate') &&
    typeof (d as unknown as { groupId?: string }).groupId === 'string';
}

/**
 * Assert F5 DimensionGroup invariants for a sheet.
 * Throws with a specific error string if any invariant is violated.
 * Called from command apply() to catch programming errors early.
 *
 * Invariants:
 *   1. orphaned-member — baseline/ordinate dim.groupId must resolve to a group.
 *   2. mismatched-kind — dim.kind must match group.kind.
 *   3. mismatched-viewId — dim.viewId must match group.viewId.
 */
export function assertDimensionGroupInvariants(sheet: SheetLike): void {
  const groups = sheet.dimensionGroups ?? [];
  const groupMap = new Map(groups.map((g) => [g.id, g]));

  for (const d of sheet.dimensions) {
    if (!isGroupMember(d)) continue;
    const gd = d as unknown as { groupId: string };

    const group = groupMap.get(gd.groupId);
    if (!group) {
      throw new Error(`orphaned-member: dim ${d.id} references missing group ${gd.groupId}`);
    }
    if (group.kind !== d.kind) {
      throw new Error(
        `mismatched-kind: dim ${d.id} kind=${d.kind} but group ${group.id} kind=${group.kind}`,
      );
    }
    if (d.viewId !== group.viewId) {
      throw new Error(
        `mismatched-viewId: dim ${d.id} viewId=${d.viewId} but group ${group.id} viewId=${group.viewId}`,
      );
    }
  }
}
```

**Commit:** `feat(drawing-f5): F5-T18 assertDimensionGroupInvariants helper`

---

### F5-T19: Extend `AutoDimCommand` with `dim-angle` branch

**Slice goal:** Add a `case 'dim-angle':` branch to `AutoDimCommand._apply()`. Look up `line1` and `line2` sketch primitives, call `findMatchingEdge2D` for each, push an `angular` candidate that bypasses `greedyPlaceDims`. Angular candidates are appended directly with their own `offsetMm` default; linear candidates continue through `greedyPlaceDims` as before.

**Key constraint:** The `dimConstraints` filter currently only passes `dim-length` and `dim-distance`. We must also pass `dim-angle`. Update the filter type guard. The `for (const c of dimConstraints)` loop then gets a third case.

**Failing test step (RED):**

Extend `packages/app/src/commands/__tests__/AutoDimCommand.spec.ts` — add new describe block:

```ts
// Append at bottom of existing AutoDimCommand.spec.ts

describe('AutoDimCommand — F5-T19: dim-angle branch', () => {
  function makeDocWithAngularView(): DrawingDocument {
    // Two edges: e-line1 and e-line2 — will be matched by findMatchingEdge2D for the two lines
    // Using the same front-view coordinate derivation as existing tests but with two separate lines.
    // prim-line1: (0,0)→(50,0), projected via BOX_BBOX → (-25,-15)→(25,-15) (matches edge-line1)
    // prim-line2: (0,0)→(0,30), projected → (-25,-15)→(-25,15) (matches edge-line2)
    return {
      id: 'dw1', name: 'Test Drawing', units: 'mm',
      source: { partPath: 'parts/box.zipt', sourceKind: 'part' },
      properties: {}, activeSheetId: 'sh1',
      sheets: [{
        id: 'sh1', name: 'Sheet 1',
        size: { kind: 'iso', size: 'A3' }, orientation: 'landscape',
        views: [{
          id: 'view1', kind: 'base' as const,
          positionMm: { x: 0, y: 0 },
          scale: { numerator: 1, denominator: 1 },
          orientation: 'front' as const, showHidden: false,
          projection: {
            visibleEdges: [
              { id: 'edge-line1', kind: 'feature' as const, points: [[-25, -15], [25, -15]] as ReadonlyArray<readonly [number, number]> },
              { id: 'edge-line2', kind: 'feature' as const, points: [[-25, -15], [-25, 15]] as ReadonlyArray<readonly [number, number]> },
            ],
            hiddenEdges: [],
            bbox: { minX: 0, minY: 0, maxX: 50, maxY: 30 },
          },
        }],
        dimensions: [], dimensionGroups: [], annotations: [], titleBlock: {},
      }],
    };
  }

  function makePartWithAngle(): PartDocument {
    const sketchFeature: Feature = {
      kind: 'sketch', id: 'sketch1',
      plane: { source: 'workPlane', featureId: 'origin.XY' },
      primitives: [
        { id: 'prim-line1', kind: 'line', x1: 0, y1: 0, x2: 50, y2: 0 },
        { id: 'prim-line2', kind: 'line', x1: 0, y1: 0, x2: 0,  y2: 30 },
      ],
      constraints: [
        {
          id: 'dc-angle', kind: 'dim-angle',
          line1: 'prim-line1', line2: 'prim-line2',
          paramName: 'cornerAngle',
          value: { kind: 'param', paramName: 'cornerAngle' },
        },
      ],
    };
    const extrudeFeature: Feature = {
      kind: 'extrude', id: 'extrude1', sketchRef: 'sketch1',
      distanceParam: 'depth', direction: 'forward', operation: 'new',
    };
    return {
      id: 'part1', name: 'Angled', units: 'mm',
      parameters: {
        cornerAngle: { name: 'cornerAngle', expression: '90', value: 90, unit: 'deg' },
        depth:       { name: 'depth',       expression: '20', value: 20, unit: 'mm'  },
      },
      featureTree: [sketchFeature, extrudeFeature],
      properties: {}, materials: [], hardware: [],
    };
  }

  beforeEach(() => {
    useAppStore.setState({
      activeDocument: { kind: 'drawing', document: makeDocWithAngularView() },
      activeDrawing:  makeDocWithAngularView(),
      activePart:     makePartWithAngle(),
    } as never);
  });

  it('(a) places one angular dim candidate from dim-angle constraint', async () => {
    const cmd = new AutoDimCommand({ drawingId: 'dw1', sheetId: 'sh1', viewId: 'view1' });
    await cmd.apply();
    const state = useAppStore.getState();
    const doc = (state.activeDocument as { kind: 'drawing'; document: DrawingDocument }).document;
    const sheet = doc.sheets[0]!;
    expect(sheet.dimensions.some((d) => d.kind === 'angular')).toBe(true);
  });

  it('(b) angular candidate has sourceParameterName === paramName', async () => {
    const cmd = new AutoDimCommand({ drawingId: 'dw1', sheetId: 'sh1', viewId: 'view1' });
    await cmd.apply();
    const state = useAppStore.getState();
    const doc = (state.activeDocument as { kind: 'drawing'; document: DrawingDocument }).document;
    const angularDims = doc.sheets[0]!.dimensions.filter((d) => d.kind === 'angular');
    expect(angularDims).toHaveLength(1);
    const angDim = angularDims[0]! as unknown as { sourceParameterName: string };
    expect(angDim.sourceParameterName).toBe('cornerAngle');
  });

  it('(c) angular candidate has ref.kind === two-edges with correct edgeIds', async () => {
    const cmd = new AutoDimCommand({ drawingId: 'dw1', sheetId: 'sh1', viewId: 'view1' });
    await cmd.apply();
    const state = useAppStore.getState();
    const doc = (state.activeDocument as { kind: 'drawing'; document: DrawingDocument }).document;
    const angDim = doc.sheets[0]!.dimensions.find((d) => d.kind === 'angular')! as unknown as {
      ref: { kind: string; edge1: { edgeId: string }; edge2: { edgeId: string } };
    };
    expect(angDim.ref.kind).toBe('two-edges');
    const edgeIds = [angDim.ref.edge1.edgeId, angDim.ref.edge2.edgeId];
    expect(edgeIds).toContain('edge-line1');
    expect(edgeIds).toContain('edge-line2');
  });

  it('(d) angular dim has arcSide=inside and offsetMm=max(15, bboxH*0.1)', async () => {
    const cmd = new AutoDimCommand({ drawingId: 'dw1', sheetId: 'sh1', viewId: 'view1' });
    await cmd.apply();
    const state = useAppStore.getState();
    const doc = (state.activeDocument as { kind: 'drawing'; document: DrawingDocument }).document;
    const angDim = doc.sheets[0]!.dimensions.find((d) => d.kind === 'angular')! as unknown as {
      arcSide: string; offsetMm: number;
    };
    expect(angDim.arcSide).toBe('inside');
    // bbox height = 30, 30*0.1=3, max(15,3)=15
    expect(angDim.offsetMm).toBe(15);
  });

  it('(e) revert removes the angular dim', async () => {
    const cmd = new AutoDimCommand({ drawingId: 'dw1', sheetId: 'sh1', viewId: 'view1' });
    await cmd.apply();
    await cmd.revert();
    const state = useAppStore.getState();
    const doc = (state.activeDocument as { kind: 'drawing'; document: DrawingDocument }).document;
    expect(doc.sheets[0]!.dimensions.filter((d) => d.kind === 'angular')).toHaveLength(0);
  });

  it('(f) silent skip when line1 primitive not found', async () => {
    const partBadLine: PartDocument = {
      ...makePartWithAngle(),
      featureTree: [
        {
          kind: 'sketch' as const, id: 'sketch1',
          plane: { source: 'workPlane', featureId: 'origin.XY' },
          primitives: [{ id: 'prim-line2', kind: 'line', x1: 0, y1: 0, x2: 0, y2: 30 }],
          constraints: [{
            id: 'dc-angle', kind: 'dim-angle' as const,
            line1: 'prim-line1-MISSING', line2: 'prim-line2',
            paramName: 'cornerAngle',
            value: { kind: 'literal' as const, value: 90 },
          }],
        },
        {
          kind: 'extrude' as const, id: 'extrude1', sketchRef: 'sketch1',
          distanceParam: 'depth', direction: 'forward' as const, operation: 'new' as const,
        },
      ],
    };
    useAppStore.setState({
      activeDocument: { kind: 'drawing', document: makeDocWithAngularView() },
      activeDrawing:  makeDocWithAngularView(),
      activePart:     partBadLine,
    } as never);
    const cmd = new AutoDimCommand({ drawingId: 'dw1', sheetId: 'sh1', viewId: 'view1' });
    await cmd.apply(); // must NOT throw
    const state = useAppStore.getState();
    const doc = (state.activeDocument as { kind: 'drawing'; document: DrawingDocument }).document;
    expect(doc.sheets[0]!.dimensions.filter((d) => d.kind === 'angular')).toHaveLength(0);
  });
});
```

**Expected failure:** The angular dim tests fail because `AutoDimCommand` filter only passes `dim-length` and `dim-distance`.

---

**Implementation step (GREEN):**

Edit `packages/app/src/commands/AutoDimCommand.ts`:

1. Broaden the constraint filter to include `dim-angle`:

```ts
// Line ~71 — replace the filter:
const dimConstraints = (sketchFeature.constraints as DimensionConstraint[]).filter(
  (c): c is DimensionConstraint =>
    c.kind === 'dim-length' || c.kind === 'dim-distance' || c.kind === 'dim-angle',
);
```

2. After the `dim-distance` branch in the `for` loop, add:

```ts
} else if (c.kind === 'dim-angle') {
  const line1 = sketchFeature.primitives.find((p) => p.id === c.line1);
  const line2 = sketchFeature.primitives.find((p) => p.id === c.line2);
  if (!line1 || !line2) continue;  // silent skip — spec §AutoDim

  const edge1 = findMatchingEdge2D(line1, extrudeDepth, viewOrientation, view);
  const edge2 = findMatchingEdge2D(line2, extrudeDepth, viewOrientation, view);
  if (!edge1 || !edge2) continue;  // silent skip

  const bboxH = view.projection!.bbox.maxY - view.projection!.bbox.minY;
  const offsetMm = Math.max(15, bboxH * 0.1);

  candidates.push({
    id: '',
    kind: 'angular' as unknown as never,  // type cast until Batch 1 union lands
    viewId: this.payload.viewId,
    ref: {
      kind: 'two-edges',
      edge1: { viewId: this.payload.viewId, edgeId: edge1.id },
      edge2: { viewId: this.payload.viewId, edgeId: edge2.id },
    },
    arcSide: 'inside',
    offsetMm,
    sourceParameterName: c.paramName,
  } as unknown as DrawingDimension);
}
```

3. After `greedyPlaceDims`, separate angular candidates from linear ones. Angular bypass greedy:

```ts
// Separate angular candidates — they bypass greedyPlaceDims
const linearCandidates = candidates.filter((c) => c.kind !== 'angular');
const angularCandidates = candidates.filter((c) => c.kind === 'angular');

// Run greedy placement for linear dims only
const placed = greedyPlaceDims(linearCandidates, view.projection.bbox);

// Combine: placed linear + angular with their pre-computed offsetMm
const allPlaced = [...placed, ...angularCandidates];

// Assign stable IDs
const placedDims: DrawingDimension[] = allPlaced.map((d) => ({
  ...d,
  id: crypto.randomUUID(),
}));
```

Adjust `this.placedIds` and the store write to use `placedDims` instead of the old `placed.map(...)`.

**Commit:** `feat(drawing-f5): F5-T19 AutoDimCommand dim-angle branch`

---

### F5-T20: Cascade text wiring in `DimensionElement.tsx`

**Slice goal:** Extend the switch in `DimensionElement.tsx` to render `baseline`, `ordinate`, and `angular` dims. Each applies the same three-mode cascade as F4 `LinearDimension`:
1. `textOverride` set → verbatim.
2. `sourceParameterName` + param exists → `${value} ${unit}` (unit from `activePart.parameters`).
3. Otherwise → computed value (distance for baseline/ordinate, degrees for angular).

**Critical gotcha (from spec + F4 pattern):**
- **Do NOT add `useStore` subscriptions inside these new components.** Use `useAppStore.getState()` snapshot, same as `LinearDimension`. The parent `DrawingCanvas` re-renders on every relevant store change; a subscription here would be redundant and would bypass the `React.memo` protection gap that F4 already works around. Any future refactor adding `React.memo` to `DrawingCanvas` MUST account for this.

**New components in `DimensionElement.tsx`:**
- `BaselineDimension` — resolves group + datum, renders like a linear dim at computed offset.
- `OrdinateDimension` — resolves group + origin, renders L-leader.
- `AngularDimension` — resolves two edges or arc edge, renders arc + arrowheads.

For Batch 2 purposes, the rendering geometry for these three kinds is provided by the render helpers defined in Batch 1 (`packages/shared/src/drawing/dimensionGroups.ts`). Batch 2 wires the cascade text cascade — the rendering geometry itself is already covered by Batch 1's render tests.

The **failing test** for T20 is a targeted unit test on the cascade logic, not a visual render test.

**Failing test step (RED):**

File: `packages/app/src/drawing/__tests__/DimensionElementCascade.spec.tsx`

```tsx
// packages/app/src/drawing/__tests__/DimensionElementCascade.spec.tsx
// Tests cascade text resolution for new F5 dim kinds (no DOM render; pure function tests).
import { describe, it, expect, beforeEach } from 'vitest';
import { resolveF5DimText } from '../DimensionElementF5Utils';
import { useAppStore } from '../../store/useAppStore';
import type { PartDocument } from '@zilventor/shared';

function makePart(): PartDocument {
  return {
    id: 'p1', name: 'Box', units: 'mm',
    parameters: {
      width: { name: 'width', expression: '50', value: 50, unit: 'mm' },
      angle: { name: 'angle', expression: '45', value: 45, unit: 'deg' },
    },
    featureTree: [], properties: {}, materials: [], hardware: [],
  };
}

beforeEach(() => {
  useAppStore.setState({ activePart: makePart() } as never);
});

describe('resolveF5DimText — cascade for new F5 dim kinds', () => {
  it('(a) textOverride takes priority', () => {
    expect(resolveF5DimText({ textOverride: 'MY LABEL', sourceParameterName: 'width' }, 99)).toBe('MY LABEL');
  });

  it('(b) sourceParameterName resolves to param value', () => {
    expect(resolveF5DimText({ sourceParameterName: 'width' }, 99)).toBe('50');
  });

  it('(c) sourceParameterName for angle param returns deg value', () => {
    expect(resolveF5DimText({ sourceParameterName: 'angle' }, 99)).toBe('45');
  });

  it('(d) orphaned sourceParameterName falls back to computed value', () => {
    expect(resolveF5DimText({ sourceParameterName: 'missing' }, 42.7)).toBe('42.7');
  });

  it('(e) neither textOverride nor sourceParameterName → computed value', () => {
    expect(resolveF5DimText({}, 37.5)).toBe('37.5');
  });
});
```

**Expected failure:** `Cannot find module '../DimensionElementF5Utils'`

---

**Implementation step (GREEN):**

File: `packages/app/src/drawing/DimensionElementF5Utils.ts`

```ts
// packages/app/src/drawing/DimensionElementF5Utils.ts
// Shared cascade-text resolver for F5 dim kinds: baseline, ordinate, angular.
// Uses getState() snapshot — no useStore subscription. See note in DimensionElement.tsx.
import { useAppStore } from '../store/useAppStore';

type CascadeFields = {
  textOverride?: string;
  sourceParameterName?: string;
};

/**
 * Resolve display text for a F5 dim (baseline / ordinate / angular).
 *
 * Three-mode cascade (same as F4 LinearDimension):
 *   1. textOverride set → use verbatim.
 *   2. sourceParameterName set + param exists in activePart → use param.value formatted.
 *   3. Otherwise → use computedValue (distance in mm or angle in degrees).
 *
 * NOTE: Uses getState() snapshot, NOT useStore subscription.
 * DrawingCanvas re-renders on every store change, so this function is re-called
 * on each render. Adding a subscription here would be redundant and would add
 * render churn. Never add useStore() calls to components rendered inside DrawingCanvas
 * without first verifying that DrawingCanvas does NOT have React.memo applied.
 */
export function resolveF5DimText(
  dim: CascadeFields,
  computedValue: number,
): string {
  if (typeof dim.textOverride === 'string') {
    return dim.textOverride;
  }
  if (typeof dim.sourceParameterName === 'string') {
    const activePart = useAppStore.getState().activePart;
    const param = activePart?.parameters[dim.sourceParameterName];
    if (param !== undefined) {
      return String(Math.round(param.value * 10) / 10);
    }
    // Orphan fallback (F4.5 pattern)
    return String(Math.round(computedValue * 10) / 10);
  }
  return String(Math.round(computedValue * 10) / 10);
}
```

Then extend `DimensionElement.tsx` switch to include the new cases (stub renderers that call `resolveF5DimText` — full geometry rendered by Batch 3's `renderDrawingSvg.ts` extension; Batch 2 wires the cascade text hook only):

```tsx
// In DimensionElement.tsx — extend the switch in DimensionElement:
case 'baseline':
case 'ordinate':
case 'angular':
  // Rendering delegated to renderDrawingSvg.ts (Batch 1+3).
  // Cascade text is resolved via resolveF5DimText when those renderers run.
  // Return null here — SVG rendering handles these kinds directly.
  return null;
```

This is intentional: `DimensionElement` in Batch 2 returns null for new kinds (SVG renderer handles them), while the cascade utility `resolveF5DimText` is ready to be called from those renderers in Batch 3.

**Commit:** `feat(drawing-f5): F5-T20 DimensionElementF5Utils cascade text for new dim kinds`

---

### F5-T21: AutoDim fixture & cascade unit test for angular

**Slice goal:** Full integration test that exercises the `dim-angle` path end-to-end: sketch fixture → `AutoDimCommand.apply()` → verify angular dim placed → verify `sourceParameterName` → edit parameter → verify cascade text reflects updated value.

This test is appended to the existing `AutoDimCommand.spec.ts`.

**Failing test step (RED):**

The `dim-angle` tests from T19 are the RED for this task. T21 adds a parametric cascade follow-through test on top. Add:

```ts
// Append to the F5-T19 describe block in AutoDimCommand.spec.ts:

it('(g) cascade: after parameter edit, resolveF5DimText returns new value', async () => {
  const cmd = new AutoDimCommand({ drawingId: 'dw1', sheetId: 'sh1', viewId: 'view1' });
  await cmd.apply();

  const state1 = useAppStore.getState();
  const doc1 = (state1.activeDocument as { kind: 'drawing'; document: DrawingDocument }).document;
  const angDim = doc1.sheets[0]!.dimensions.find((d) => d.kind === 'angular')! as unknown as {
    sourceParameterName: string;
  };

  // Verify initial resolved text is '90' (from cornerAngle=90)
  const { resolveF5DimText } = await import('../../drawing/DimensionElementF5Utils');
  const initial = resolveF5DimText({ sourceParameterName: angDim.sourceParameterName }, 45);
  expect(initial).toBe('90');

  // Edit parameter: cornerAngle → 60
  useAppStore.setState({
    activePart: {
      ...state1.activePart!,
      parameters: {
        ...state1.activePart!.parameters,
        cornerAngle: { name: 'cornerAngle', expression: '60', value: 60, unit: 'deg' },
      },
    },
  } as never);

  const updated = resolveF5DimText({ sourceParameterName: angDim.sourceParameterName }, 45);
  expect(updated).toBe('60');
});
```

**Expected failure:** Test passes only after T19 and T20 are green. The test verifies the end-to-end cascade without needing a render.

---

**Implementation step (GREEN):**

No new code — T21 is verified by the combined green state of T19 + T20. Confirm the test passes after both are implemented.

**Commit:** `feat(drawing-f5): F5-T21 cascade integration test angular dim + parameter edit`

---

### F5-T22 (Batch 2 verify)

**Verification step:**

```bash
# Step 1: typecheck all packages
pnpm -r typecheck

# Step 2: run unit tests (app package)
pnpm --filter @zilventor/app test:unit

# Step 3: run shared package unit tests (autoDim.spec.ts is in shared)
pnpm --filter @zilventor/shared test:unit

# Step 4: confirm new test count
pnpm --filter @zilventor/app test:unit -- --reporter=verbose 2>&1 | grep -E "^✓|PASS|FAIL|Tests" | tail -20
```

**Acceptance criteria:**
- `pnpm -r typecheck` exits 0.
- All pre-existing tests (2232 baseline) remain green.
- New tests from T11–T21 pass (~45–55 new assertions):
  - `AddDimensionGroupCommand.spec.ts` — 4 tests
  - `AddBaselineMemberCommand.spec.ts` — 6 tests
  - `AddOrdinateMemberCommand.spec.ts` — 6 tests
  - `AddAngularDimCommand.spec.ts` — 7 tests
  - `DeleteDimensionGroupCommand.spec.ts` — 5 tests
  - `DeleteDrawingDimensionCommand.spec.ts` additions — 2 tests
  - `MoveDrawingDimensionCommand.spec.ts` additions — 5 tests
  - `dimensionGroupInvariants.spec.ts` — 5 tests
  - `AutoDimCommand.spec.ts` additions (T19+T21) — 7 tests
  - `DimensionElementCascade.spec.tsx` — 5 tests
  - **Total new: ~52 tests**
- No `as never` casts that could hide runtime errors — verify each one is a Zustand state-seed cast (the standard pattern in this codebase) or a Batch-1-pending type cast marked with a `// Batch 1 type pending` comment.

If typecheck fails on `angular` / `baseline` / `ordinate` / `DimensionGroup` / `dimensionGroups` references: Batch 1 types are not yet merged. Add local stubs in `packages/shared/src/drawing/types.ts` and mark with `// F5-T11 stub — reconcile on Batch 1 merge`. Do not block Batch 2 progress on Batch 1 merge.

---


---

## Batch 3 — ToolModes + UI + E2E + Perf

**Goal:** Land all 3 new ToolModes with click sessions, ribbon buttons, live preview, the E2E (T-6-12) and perf (dimension-styles.perf) tests. Mid-flight Playwright verification + final batch sign-off.

**Owner per task:** Sonnet implementer subagent; final-pass review by separate Sonnet reviewer.

---

### F5-T23 — Extend `ToolMode` union

### Context

File: `packages/app/src/drawing/toolMode.ts`  
Line 4–21: the current `ToolMode` union ends with `| 'autoDim'`.  
Add three new values: `'baseline'`, `'ordinate'`, `'angular'`.

### Step 1 — Red: write the failing unit test

**File:** `packages/app/src/drawing/__tests__/toolMode.f5.spec.ts` (new file)

```ts
// packages/app/src/drawing/__tests__/toolMode.f5.spec.ts
import { describe, it, expect } from 'vitest';
import type { ToolMode } from '../toolMode';

describe('ToolMode F5 — new union values', () => {
  it('accepts "baseline" as a valid ToolMode', () => {
    const m: ToolMode = 'baseline';
    expect(m).toBe('baseline');
  });

  it('accepts "ordinate" as a valid ToolMode', () => {
    const m: ToolMode = 'ordinate';
    expect(m).toBe('ordinate');
  });

  it('accepts "angular" as a valid ToolMode', () => {
    const m: ToolMode = 'angular';
    expect(m).toBe('angular');
  });
});
```

**Expected failure:**  
`pnpm --filter @zilventor/app test:unit packages/app/src/drawing/__tests__/toolMode.f5.spec.ts`  
→ TypeScript compile error: `Type '"baseline"' is not assignable to type 'ToolMode'`.

### Step 2 — Green: extend the union

**File:** `packages/app/src/drawing/toolMode.ts`

Change lines 4–21:

```ts
export type ToolMode =
  | 'idle'
  | 'placeBase'
  | 'placeProjected'
  | 'placeIso'
  | 'addLinearH'
  | 'addLinearV'
  | 'addAligned'
  | 'addRadial'
  | 'addDiametric'
  | 'addCenterline'
  | 'addCenterMark'
  | 'addLeader'
  | 'addBalloon'
  | 'section'
  | 'detail'
  | 'break'      // Drawing F3
  | 'autoDim'    // Drawing F4 — auto-dimensioning from sketch parameters
  | 'baseline'   // Drawing F5 — baseline dimension group (manual)
  | 'ordinate'   // Drawing F5 — ordinate dimension group (manual)
  | 'angular';   // Drawing F5 — angular dimension (two-edges or arc)
```

**Run:**  
```
pnpm --filter @zilventor/app test:unit packages/app/src/drawing/__tests__/toolMode.f5.spec.ts
```

**Expected:** 3 tests pass.

### Step 3 — Refactor

No refactor needed. Union extension is the minimal change.

**Commit:**  
```
feat(drawing-f5): T23 — extend ToolMode union with 'baseline' | 'ordinate' | 'angular'
```

---

### F5-T24 — Ribbon buttons in DrawingTab

### Context

File: `packages/app/src/shell/tabs/DrawingTab.tsx`  
The Dimension `<RibbonPanel>` block (lines ~139–160) already contains Linear/Aligned/Radial/Diametric/Auto-Dim buttons. Add Baseline, Ordinate, Angular buttons in the same panel, after Auto-Dim.

Pattern: same disabled-when-no-active-drawing logic as Auto-Dim (the component already returns early if `activeDocument?.kind !== 'drawing'`, so all buttons inside are implicitly safe — but add `disabled` prop + `aria-label` + `title` matching the Auto-Dim style for consistency).

### Step 1 — Red: write the failing unit test

**File:** `packages/app/src/shell/tabs/__tests__/DrawingTab.f5.spec.tsx` (new file)

```tsx
// packages/app/src/shell/tabs/__tests__/DrawingTab.f5.spec.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { act } from 'react';
import DrawingTab from '../DrawingTab';
import { useAppStore } from '../../store/useAppStore';
import { useToolModeStore } from '../../drawing/toolMode';

// Minimal drawing doc stub required to bypass the StubTab early return.
const minimalDrawing = {
  id: 'drw-tab-test',
  name: 'Test Drawing',
  units: 'mm',
  source: { partPath: 'part.zipt', sourceKind: 'part' as const },
  properties: {},
  sheets: [{
    id: 'sheet-1',
    name: 'Sheet 1',
    size: { kind: 'iso' as const, size: 'A4' as const },
    orientation: 'landscape' as const,
    views: [],
    dimensions: [],
    dimensionGroups: [],
    annotations: [],
    titleBlock: {},
  }],
  activeSheetId: 'sheet-1',
};

describe('DrawingTab — F5 ribbon buttons', () => {
  beforeEach(() => {
    // Reset tool mode store
    useToolModeStore.getState().setMode('idle');

    // Inject a minimal drawing so the ribbon renders (not StubTab)
    useAppStore.setState({
      activeDocument: { kind: 'drawing', document: minimalDrawing as never },
      activeDrawing: minimalDrawing as never,
    } as never, false);
  });

  it('renders Baseline, Ordinate, Angular buttons in the Dimension panel', () => {
    render(<DrawingTab />);
    expect(screen.getByRole('button', { name: 'Baseline' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Ordinate' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Angular' })).toBeDefined();
  });

  it('clicking Baseline sets toolMode to "baseline"', () => {
    render(<DrawingTab />);
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Baseline' }));
    });
    expect(useToolModeStore.getState().mode).toBe('baseline');
  });

  it('clicking Ordinate sets toolMode to "ordinate"', () => {
    render(<DrawingTab />);
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Ordinate' }));
    });
    expect(useToolModeStore.getState().mode).toBe('ordinate');
  });

  it('clicking Angular sets toolMode to "angular"', () => {
    render(<DrawingTab />);
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Angular' }));
    });
    expect(useToolModeStore.getState().mode).toBe('angular');
  });
});
```

**Run:**  
```
pnpm --filter @zilventor/app test:unit packages/app/src/shell/tabs/__tests__/DrawingTab.f5.spec.tsx
```

**Expected failure:** `Unable to find role "button" with name "Baseline"` (buttons not yet rendered).

### Step 2 — Green: add the three buttons

**File:** `packages/app/src/shell/tabs/DrawingTab.tsx`

After the existing Auto-Dim button (after line ~158), before the closing `</RibbonPanel>` of the Dimension group, add:

```tsx
        {/* Baseline: Drawing F5 — baseline group from datum + stacked members */}
        <button
          type="button"
          className="text-xs hover:text-white"
          aria-label="Baseline"
          title="Place a baseline dimension group — click datum, then click features"
          onClick={() => setMode('baseline')}
        >
          Baseline
        </button>
        {/* Ordinate: Drawing F5 — ordinate group from origin + L-leader members */}
        <button
          type="button"
          className="text-xs hover:text-white"
          aria-label="Ordinate"
          title="Place an ordinate dimension group — click origin, then click features"
          onClick={() => setMode('ordinate')}
        >
          Ordinate
        </button>
        {/* Angular: Drawing F5 — angular dim from two edges or arc edge */}
        <button
          type="button"
          className="text-xs hover:text-white"
          aria-label="Angular"
          title="Place an angular dimension — click two edges (or one arc edge)"
          onClick={() => setMode('angular')}
        >
          Angular
        </button>
```

**Run:**  
```
pnpm --filter @zilventor/app test:unit packages/app/src/shell/tabs/__tests__/DrawingTab.f5.spec.tsx
```

**Expected:** 4 tests pass.

### Step 3 — Refactor

No refactor. Buttons follow existing pattern exactly.

**Commit:**  
```
feat(drawing-f5): T24 — Baseline / Ordinate / Angular ribbon buttons in DrawingTab
```

---

### F5-T25 — DrawingCanvas baseline session

### Context

File: `packages/app/src/drawing/DrawingCanvas.tsx`  
The `handleClick` callback (line ~213) handles tool modes sequentially. After the `autoDim` block (ends ~line 403), add the `baseline` branch.

**Session state** lives in a `useRef` (not `useState`, to avoid triggering re-renders on every phase transition while in the middle of a multi-click flow):

```ts
type BaselineSession =
  | { phase: 'pick-datum' }
  | { phase: 'pick-members'; groupId: string; viewId: string; memberCount: number };
```

**Click logic:**

- Phase `pick-datum`:  
  - Requires a `data-edge-id` on the click target. Reads `edgeId` from `target.getAttribute('data-edge-id')`.  
  - Resolves `viewId` via `getViewAtPoint(liveSheet.views, {x: svgX, y: svgY}, targetViewId)`.  
  - Constructs a `DimensionGroup` of `kind: 'baseline'` with:
    - `id`: `crypto.randomUUID()`
    - `datum`: `{ kind: 'edge-endpoint', edgeId, end: 'start' }` (PointRef)
    - `direction`: `'h'` (default; user creates ordinate for vertical; see spec note on direction inference)
    - `baseOffsetMm`: `20`
    - `spacingMm`: `10`
  - Dispatches `AddDimensionGroupCommand(liveSheet.id, group)`.
  - Advances session ref to `{ phase: 'pick-members', groupId: group.id, viewId, memberCount: 0 }`.

- Phase `pick-members`:  
  - Requires `data-edge-id`. Reads target `edgeId`.  
  - Dispatches `AddBaselineMemberCommand(liveSheet.id, session.groupId, { kind: 'edge-endpoint', edgeId, end: 'start' })`.
  - Increments `session.memberCount`.

**Esc / mode-change cleanup:**  
In the ESC `keydown` handler (line ~164), add:

```ts
if (e.key === 'Escape') {
  // ... existing sectionCancel / detailCancel / breakCancel calls ...
  baselineSessionRef.current = { phase: 'pick-datum' };
  ordinateSessionRef.current = { phase: 'pick-origin' };
  angularSessionRef.current = { phase: 'pick-edge-1' };
}
```

Also, when `toolMode` changes away from `'baseline'`, cancel the session if in `pick-members` with 0 members (dispatch `DeleteDimensionGroupCommand`). This is handled in a `useEffect` watching `toolMode`.

### Step 1 — Red: write the failing unit test

**File:** `packages/app/src/drawing/__tests__/DrawingCanvas.baseline.spec.tsx` (new file)

```tsx
// packages/app/src/drawing/__tests__/DrawingCanvas.baseline.spec.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import { DrawingCanvas } from '../DrawingCanvas';
import { useAppStore } from '../../store/useAppStore';
import { useToolModeStore } from '../toolMode';

// Minimal drawing fixture with one base view + one visible edge.
const edgeId = 'e-baseline-test';
const viewId = 'v-baseline-test';

const minimalDrawing = {
  id: 'drw-baseline',
  name: 'Baseline Drawing',
  units: 'mm' as const,
  source: { partPath: 'part.zipt', sourceKind: 'part' as const },
  properties: {},
  sheets: [{
    id: 'sheet-b',
    name: 'Sheet 1',
    size: { kind: 'iso' as const, size: 'A4' as const },
    orientation: 'landscape' as const,
    views: [{
      id: viewId,
      kind: 'base' as const,
      positionMm: { x: 0, y: 0 },
      scale: { numerator: 1, denominator: 1 },
      orientation: 'front',
      showHidden: false,
      projection: {
        visibleEdges: [{ id: edgeId, kind: 'outline' as const, points: [[-25, -15], [25, -15]] as readonly (readonly [number, number])[] }],
        hiddenEdges: [],
        bbox: { minX: 0, minY: 0, maxX: 50, maxY: 30 },
      },
      inputFingerprint: 'fp-b',
    }],
    dimensions: [],
    dimensionGroups: [],
    annotations: [],
    titleBlock: {},
  }],
  activeSheetId: 'sheet-b',
};

const mockBus = { execute: vi.fn().mockResolvedValue(undefined) };

describe('DrawingCanvas — baseline session', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useToolModeStore.getState().setMode('baseline');
    useAppStore.setState({
      activeDocument: { kind: 'drawing', document: minimalDrawing as never },
      activeDrawing: minimalDrawing as never,
      bus: mockBus as never,
    } as never, false);
  });

  it('dispatches AddDimensionGroupCommand on first click (datum pick)', async () => {
    const { container } = render(<DrawingCanvas />);
    const svg = container.querySelector('svg');
    if (!svg) throw new Error('SVG not found');

    // Simulate click with data-edge-id on the SVG (targeting an edge element)
    await act(async () => {
      const evt = new MouseEvent('click', { bubbles: true, clientX: 10, clientY: 10 });
      Object.defineProperty(evt, 'target', {
        get: () => {
          const el = document.createElementNS('http://www.w3.org/2000/svg', 'line');
          el.setAttribute('data-edge-id', edgeId);
          el.setAttribute('data-view-id', viewId);
          return el;
        },
      });
      svg.dispatchEvent(evt);
    });

    expect(mockBus.execute).toHaveBeenCalledTimes(1);
    const [cmd] = mockBus.execute.mock.calls[0] as [{ constructor: { name: string } }];
    expect(cmd.constructor.name).toBe('AddDimensionGroupCommand');
  });

  it('dispatches AddBaselineMemberCommand on second click (member pick)', async () => {
    const { container } = render(<DrawingCanvas />);
    const svg = container.querySelector('svg');
    if (!svg) throw new Error('SVG not found');

    const makeEdgeEvt = (eid: string) => {
      const evt = new MouseEvent('click', { bubbles: true, clientX: 10, clientY: 10 });
      Object.defineProperty(evt, 'target', {
        get: () => {
          const el = document.createElementNS('http://www.w3.org/2000/svg', 'line');
          el.setAttribute('data-edge-id', eid);
          el.setAttribute('data-view-id', viewId);
          return el;
        },
      });
      return evt;
    };

    // First click: datum pick → AddDimensionGroupCommand
    await act(async () => { svg.dispatchEvent(makeEdgeEvt(edgeId)); });
    // Second click: member pick → AddBaselineMemberCommand
    await act(async () => { svg.dispatchEvent(makeEdgeEvt('e-member-1')); });

    expect(mockBus.execute).toHaveBeenCalledTimes(2);
    const [, cmd2] = mockBus.execute.mock.calls as [[unknown], [{ constructor: { name: string } }]];
    expect(cmd2[0].constructor.name).toBe('AddBaselineMemberCommand');
  });
});
```

**Run:**  
```
pnpm --filter @zilventor/app test:unit packages/app/src/drawing/__tests__/DrawingCanvas.baseline.spec.tsx
```

**Expected failure:** `AddDimensionGroupCommand` constructor not found (toolMode `'baseline'` branch not yet implemented) OR the test never dispatches (click handler falls through).

### Step 2 — Green: add baseline session to DrawingCanvas

**File:** `packages/app/src/drawing/DrawingCanvas.tsx`

#### 2a — Add session ref types at the top of the component (after existing `useRef` declarations, around line ~94)

```ts
// F5 session refs — useRef to avoid triggering re-render on phase transitions
type BaselineSession =
  | { phase: 'pick-datum' }
  | { phase: 'pick-members'; groupId: string; viewId: string; memberCount: number };
type OrdinateSession =
  | { phase: 'pick-origin' }
  | { phase: 'pick-members'; groupId: string; viewId: string; memberCount: number };
type AngularSession =
  | { phase: 'pick-edge-1' }
  | { phase: 'pick-edge-2'; viewId: string; edge1: import('@zilventor/shared').EdgeRef };

const baselineSessionRef = useRef<BaselineSession>({ phase: 'pick-datum' });
const ordinateSessionRef = useRef<OrdinateSession>({ phase: 'pick-origin' });
const angularSessionRef = useRef<AngularSession>({ phase: 'pick-edge-1' });
```

#### 2b — Add imports at top of file

```ts
import { AddDimensionGroupCommand } from '../commands/AddDimensionGroupCommand';
import { AddBaselineMemberCommand } from '../commands/AddBaselineMemberCommand';
import { AddOrdinateMemberCommand } from '../commands/AddOrdinateMemberCommand';
import { AddAngularDimCommand } from '../commands/AddAngularDimCommand';
import { DeleteDimensionGroupCommand } from '../commands/DeleteDimensionGroupCommand';
```

#### 2c — Add useEffect to reset sessions on mode change

```ts
// Reset F5 sessions when tool mode changes away from them
useEffect(() => {
  if (toolMode !== 'baseline') {
    const s = baselineSessionRef.current;
    if (s.phase === 'pick-members' && s.memberCount === 0) {
      // No members added — clean up the empty group
      void bus.execute(new DeleteDimensionGroupCommand(sheetId, s.groupId));
    }
    baselineSessionRef.current = { phase: 'pick-datum' };
  }
  if (toolMode !== 'ordinate') {
    const s = ordinateSessionRef.current;
    if (s.phase === 'pick-members' && s.memberCount === 0) {
      void bus.execute(new DeleteDimensionGroupCommand(sheetId, s.groupId));
    }
    ordinateSessionRef.current = { phase: 'pick-origin' };
  }
  if (toolMode !== 'angular') {
    angularSessionRef.current = { phase: 'pick-edge-1' };
  }
}, [toolMode, bus, sheetId]);
```

#### 2d — Add ESC handling in the keydown effect

In the existing `onKeyDown` handler, extend the final Escape block:

```ts
if (e.key === 'Escape') {
  useToolModeStore.getState().sectionCancel();
  useToolModeStore.getState().detailCancel();
  useToolModeStore.getState().breakCancel();
  // F5 — cancel active sessions
  const bSess = baselineSessionRef.current;
  if (bSess.phase === 'pick-members' && bSess.memberCount === 0) {
    void bus.execute(new DeleteDimensionGroupCommand(sheetId, bSess.groupId));
  }
  baselineSessionRef.current = { phase: 'pick-datum' };
  const oSess = ordinateSessionRef.current;
  if (oSess.phase === 'pick-members' && oSess.memberCount === 0) {
    void bus.execute(new DeleteDimensionGroupCommand(sheetId, oSess.groupId));
  }
  ordinateSessionRef.current = { phase: 'pick-origin' };
  angularSessionRef.current = { phase: 'pick-edge-1' };
  if (toolMode === 'baseline' || toolMode === 'ordinate' || toolMode === 'angular') {
    useToolModeStore.getState().setMode('idle');
  }
}
```

Note: `toolMode` is closed over from the render scope — add it to the ESC effect's dependency array. Alternatively, read live state via `useToolModeStore.getState().mode` to avoid stale closure (preferred — mirrors the `liveState` pattern already used for `sectionState`).

#### 2e — Add baseline click handler in `handleClick` after the `autoDim` block

```ts
if (toolMode === 'baseline') {
  // CRITICAL: read live state to avoid stale closure (see F1.1 pattern)
  const liveDrw = useAppStore.getState().activeDrawing;
  const liveSheet = liveDrw?.sheets.find((s) => s.id === liveDrw.activeSheetId) ?? liveDrw?.sheets[0];
  if (!liveDrw || !liveSheet) return;

  const clickedEdgeId = (e.target as SVGElement).getAttribute('data-edge-id') ?? undefined;
  const clickedViewId = (e.target as SVGElement).getAttribute('data-view-id') ?? undefined;
  if (!clickedEdgeId) return; // require edge click

  const sess = baselineSessionRef.current;

  if (sess.phase === 'pick-datum') {
    const hitViewId = getViewAtPoint(liveSheet.views, { x: svgX, y: svgY }, clickedViewId);
    if (!hitViewId) return;

    const groupId = crypto.randomUUID();
    const group = {
      kind: 'baseline' as const,
      id: groupId,
      viewId: hitViewId,
      datum: { kind: 'edge-endpoint' as const, edgeId: clickedEdgeId, end: 'start' as const },
      direction: 'h' as const,
      baseOffsetMm: 20,
      spacingMm: 10,
    };
    void bus.execute(new AddDimensionGroupCommand(liveSheet.id, group));
    baselineSessionRef.current = { phase: 'pick-members', groupId, viewId: hitViewId, memberCount: 0 };
    return;
  }

  if (sess.phase === 'pick-members') {
    const memberTo = { kind: 'edge-endpoint' as const, edgeId: clickedEdgeId, end: 'start' as const };
    void bus.execute(new AddBaselineMemberCommand(liveSheet.id, sess.groupId, memberTo));
    baselineSessionRef.current = { ...sess, memberCount: sess.memberCount + 1 };
    return;
  }

  return;
}
```

**Run:**  
```
pnpm --filter @zilventor/app test:unit packages/app/src/drawing/__tests__/DrawingCanvas.baseline.spec.tsx
```

**Expected:** 2 tests pass.

### Step 3 — Refactor

No structural refactor needed. The session ref pattern is established by F5's architecture.

**Commit:**  
```
feat(drawing-f5): T25 — DrawingCanvas baseline session (pick-datum → pick-members)
```

---

### F5-T26 — DrawingCanvas ordinate session

### Context

Mirrors the baseline session. `ordinateSessionRef` was already declared in T25. This task adds the `ordinate` click handler branch.

**Axis inference:** if `Math.abs(to.x - origin.x) > Math.abs(to.y - origin.y)` → axis `'y'` (label a horizontal-column leader); else → axis `'x'`. Shift-click flips. Note: at click time we do not have the actual `to` point in world coords — we use the SVG sheet-space click coordinates as a proxy for the relative position to origin. Store the origin's sheet-space click coords in the session.

Type extension — update the ordinate session type to hold the origin's sheet-space position:

```ts
type OrdinateSession =
  | { phase: 'pick-origin' }
  | { phase: 'pick-members'; groupId: string; viewId: string; memberCount: number; originSheetPt: { x: number; y: number } };
```

### Step 1 — Red: write the failing unit test

**File:** `packages/app/src/drawing/__tests__/DrawingCanvas.ordinate.spec.tsx` (new file)

```tsx
// packages/app/src/drawing/__tests__/DrawingCanvas.ordinate.spec.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { DrawingCanvas } from '../DrawingCanvas';
import { useAppStore } from '../../store/useAppStore';
import { useToolModeStore } from '../toolMode';

const edgeId = 'e-ordinate-test';
const viewId = 'v-ordinate-test';

const minimalDrawing = {
  id: 'drw-ordinate',
  name: 'Ordinate Drawing',
  units: 'mm' as const,
  source: { partPath: 'part.zipt', sourceKind: 'part' as const },
  properties: {},
  sheets: [{
    id: 'sheet-o',
    name: 'Sheet 1',
    size: { kind: 'iso' as const, size: 'A4' as const },
    orientation: 'landscape' as const,
    views: [{
      id: viewId,
      kind: 'base' as const,
      positionMm: { x: 0, y: 0 },
      scale: { numerator: 1, denominator: 1 },
      orientation: 'front',
      showHidden: false,
      projection: {
        visibleEdges: [{ id: edgeId, kind: 'outline' as const, points: [[-25, -15], [25, -15]] as readonly (readonly [number, number])[] }],
        hiddenEdges: [],
        bbox: { minX: 0, minY: 0, maxX: 50, maxY: 30 },
      },
      inputFingerprint: 'fp-o',
    }],
    dimensions: [],
    dimensionGroups: [],
    annotations: [],
    titleBlock: {},
  }],
  activeSheetId: 'sheet-o',
};

const mockBus = { execute: vi.fn().mockResolvedValue(undefined) };

describe('DrawingCanvas — ordinate session', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useToolModeStore.getState().setMode('ordinate');
    useAppStore.setState({
      activeDocument: { kind: 'drawing', document: minimalDrawing as never },
      activeDrawing: minimalDrawing as never,
      bus: mockBus as never,
    } as never, false);
  });

  it('dispatches AddDimensionGroupCommand (kind ordinate) on origin pick', async () => {
    const { container } = render(<DrawingCanvas />);
    const svg = container.querySelector('svg');
    if (!svg) throw new Error('SVG not found');

    await act(async () => {
      const evt = new MouseEvent('click', { bubbles: true, clientX: 10, clientY: 10 });
      Object.defineProperty(evt, 'target', {
        get: () => {
          const el = document.createElementNS('http://www.w3.org/2000/svg', 'line');
          el.setAttribute('data-edge-id', edgeId);
          el.setAttribute('data-view-id', viewId);
          return el;
        },
      });
      svg.dispatchEvent(evt);
    });

    expect(mockBus.execute).toHaveBeenCalledTimes(1);
    const [cmd] = mockBus.execute.mock.calls[0] as [{ constructor: { name: string } }];
    expect(cmd.constructor.name).toBe('AddDimensionGroupCommand');
  });

  it('dispatches AddOrdinateMemberCommand on member pick with axis inference', async () => {
    const { container } = render(<DrawingCanvas />);
    const svg = container.querySelector('svg');
    if (!svg) throw new Error('SVG not found');

    const makeEvt = (x: number, y: number, eid: string) => {
      const evt = new MouseEvent('click', { bubbles: true, clientX: x, clientY: y });
      Object.defineProperty(evt, 'target', {
        get: () => {
          const el = document.createElementNS('http://www.w3.org/2000/svg', 'line');
          el.setAttribute('data-edge-id', eid);
          el.setAttribute('data-view-id', viewId);
          return el;
        },
      });
      return evt;
    };

    // Origin pick at (10, 10)
    await act(async () => { svg.dispatchEvent(makeEvt(10, 10, edgeId)); });
    // Member pick at (50, 12) — |dx|=40 > |dy|=2 → axis 'y'
    await act(async () => { svg.dispatchEvent(makeEvt(50, 12, 'e-member-o')); });

    expect(mockBus.execute).toHaveBeenCalledTimes(2);
    const [, cmd2] = mockBus.execute.mock.calls as [[unknown], [{ constructor: { name: string } }]];
    expect(cmd2[0].constructor.name).toBe('AddOrdinateMemberCommand');
  });
});
```

**Run:**  
```
pnpm --filter @zilventor/app test:unit packages/app/src/drawing/__tests__/DrawingCanvas.ordinate.spec.tsx
```

**Expected failure:** `AddDimensionGroupCommand` not dispatched for ordinate mode (branch not yet implemented).

### Step 2 — Green: add ordinate click handler

**File:** `packages/app/src/drawing/DrawingCanvas.tsx`

After the baseline block, add:

```ts
if (toolMode === 'ordinate') {
  const liveDrw = useAppStore.getState().activeDrawing;
  const liveSheet = liveDrw?.sheets.find((s) => s.id === liveDrw.activeSheetId) ?? liveDrw?.sheets[0];
  if (!liveDrw || !liveSheet) return;

  const clickedEdgeId = (e.target as SVGElement).getAttribute('data-edge-id') ?? undefined;
  const clickedViewId = (e.target as SVGElement).getAttribute('data-view-id') ?? undefined;
  if (!clickedEdgeId) return;

  const sess = ordinateSessionRef.current;

  if (sess.phase === 'pick-origin') {
    const hitViewId = getViewAtPoint(liveSheet.views, { x: svgX, y: svgY }, clickedViewId);
    if (!hitViewId) return;

    const groupId = crypto.randomUUID();
    const group = {
      kind: 'ordinate' as const,
      id: groupId,
      viewId: hitViewId,
      origin: { kind: 'edge-endpoint' as const, edgeId: clickedEdgeId, end: 'start' as const },
      xColumnOffsetMm: 20,
      yColumnOffsetMm: 20,
    };
    void bus.execute(new AddDimensionGroupCommand(liveSheet.id, group));
    ordinateSessionRef.current = {
      phase: 'pick-members',
      groupId,
      viewId: hitViewId,
      memberCount: 0,
      originSheetPt: { x: svgX, y: svgY },
    };
    return;
  }

  if (sess.phase === 'pick-members') {
    // Axis inference: greater absolute delta determines axis direction
    const dx = Math.abs(svgX - sess.originSheetPt.x);
    const dy = Math.abs(svgY - sess.originSheetPt.y);
    // Shift-click flips the inferred axis
    let axis: 'x' | 'y' = dx > dy ? 'y' : 'x';
    if (e.shiftKey) axis = axis === 'x' ? 'y' : 'x';

    const memberTo = { kind: 'edge-endpoint' as const, edgeId: clickedEdgeId, end: 'start' as const };
    void bus.execute(new AddOrdinateMemberCommand(liveSheet.id, sess.groupId, memberTo, axis));
    ordinateSessionRef.current = { ...sess, memberCount: sess.memberCount + 1 };
    return;
  }

  return;
}
```

Also update the `OrdinateSession` type in the component to include `originSheetPt`:

```ts
type OrdinateSession =
  | { phase: 'pick-origin' }
  | { phase: 'pick-members'; groupId: string; viewId: string; memberCount: number; originSheetPt: { x: number; y: number } };
```

**Run:**  
```
pnpm --filter @zilventor/app test:unit packages/app/src/drawing/__tests__/DrawingCanvas.ordinate.spec.tsx
```

**Expected:** 2 tests pass.

### Step 3 — Refactor

No structural refactor needed.

**Commit:**  
```
feat(drawing-f5): T26 — DrawingCanvas ordinate session with axis inference + Shift-flip
```

---

### F5-T27 — DrawingCanvas angular session

### Context

`angularSessionRef` was declared in T25. Add the `angular` click handler branch.

Two-click flow for two line-edges; single-click shortcut for arc edges. Arc detection: check if the clicked edge's `kind` attribute is `'arc'` — in SVG, `ViewElement` renders arc edges with `data-edge-kind="arc"`. If `data-edge-kind` is not present, fall back to checking the view's `projection.visibleEdges` array for a matching edge with an arc-shape heuristic (more than 2 points and non-collinear). The simplest safe approach: read `data-edge-kind` from the target element and only auto-complete if it equals `'arc'`.

### Step 1 — Red: write the failing unit test

**File:** `packages/app/src/drawing/__tests__/DrawingCanvas.angular.spec.tsx` (new file)

```tsx
// packages/app/src/drawing/__tests__/DrawingCanvas.angular.spec.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { DrawingCanvas } from '../DrawingCanvas';
import { useAppStore } from '../../store/useAppStore';
import { useToolModeStore } from '../toolMode';

const edge1Id = 'e-ang-1';
const edge2Id = 'e-ang-2';
const viewId = 'v-ang-test';

const minimalDrawing = {
  id: 'drw-angular',
  name: 'Angular Drawing',
  units: 'mm' as const,
  source: { partPath: 'part.zipt', sourceKind: 'part' as const },
  properties: {},
  sheets: [{
    id: 'sheet-a',
    name: 'Sheet 1',
    size: { kind: 'iso' as const, size: 'A4' as const },
    orientation: 'landscape' as const,
    views: [{
      id: viewId,
      kind: 'base' as const,
      positionMm: { x: 0, y: 0 },
      scale: { numerator: 1, denominator: 1 },
      orientation: 'front',
      showHidden: false,
      projection: {
        visibleEdges: [
          { id: edge1Id, kind: 'outline' as const, points: [[0, 0], [30, 0]] as readonly (readonly [number, number])[] },
          { id: edge2Id, kind: 'outline' as const, points: [[0, 0], [0, 30]] as readonly (readonly [number, number])[] },
        ],
        hiddenEdges: [],
        bbox: { minX: 0, minY: 0, maxX: 30, maxY: 30 },
      },
      inputFingerprint: 'fp-a',
    }],
    dimensions: [],
    dimensionGroups: [],
    annotations: [],
    titleBlock: {},
  }],
  activeSheetId: 'sheet-a',
};

const mockBus = { execute: vi.fn().mockResolvedValue(undefined) };

function makeEdgeEvt(eid: string, vid: string, edgeKind = 'outline') {
  const evt = new MouseEvent('click', { bubbles: true, clientX: 10, clientY: 10 });
  Object.defineProperty(evt, 'target', {
    get: () => {
      const el = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      el.setAttribute('data-edge-id', eid);
      el.setAttribute('data-view-id', vid);
      el.setAttribute('data-edge-kind', edgeKind);
      return el;
    },
  });
  return evt;
}

describe('DrawingCanvas — angular session', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useToolModeStore.getState().setMode('angular');
    useAppStore.setState({
      activeDocument: { kind: 'drawing', document: minimalDrawing as never },
      activeDrawing: minimalDrawing as never,
      bus: mockBus as never,
    } as never, false);
  });

  it('two-edges: dispatches AddAngularDimCommand after two line clicks', async () => {
    const { container } = render(<DrawingCanvas />);
    const svg = container.querySelector('svg');
    if (!svg) throw new Error('SVG not found');

    // First click: pick edge 1 (line) — should NOT dispatch yet
    await act(async () => { svg.dispatchEvent(makeEdgeEvt(edge1Id, viewId, 'outline')); });
    expect(mockBus.execute).not.toHaveBeenCalled();

    // Second click: pick edge 2 (line) — dispatches AddAngularDimCommand
    await act(async () => { svg.dispatchEvent(makeEdgeEvt(edge2Id, viewId, 'outline')); });
    expect(mockBus.execute).toHaveBeenCalledTimes(1);
    const [cmd] = mockBus.execute.mock.calls[0] as [{ constructor: { name: string } }];
    expect(cmd.constructor.name).toBe('AddAngularDimCommand');
  });

  it('arc: dispatches AddAngularDimCommand immediately on arc click', async () => {
    const { container } = render(<DrawingCanvas />);
    const svg = container.querySelector('svg');
    if (!svg) throw new Error('SVG not found');

    // Single click on an arc-kind edge
    await act(async () => { svg.dispatchEvent(makeEdgeEvt('e-arc', viewId, 'arc')); });
    expect(mockBus.execute).toHaveBeenCalledTimes(1);
    const [cmd] = mockBus.execute.mock.calls[0] as [{ constructor: { name: string } }];
    expect(cmd.constructor.name).toBe('AddAngularDimCommand');
  });
});
```

**Run:**  
```
pnpm --filter @zilventor/app test:unit packages/app/src/drawing/__tests__/DrawingCanvas.angular.spec.tsx
```

**Expected failure:** angular branch not yet implemented → no commands dispatched.

### Step 2 — Green: add angular click handler

**File:** `packages/app/src/drawing/DrawingCanvas.tsx`

After the ordinate block, add:

```ts
if (toolMode === 'angular') {
  const liveDrw = useAppStore.getState().activeDrawing;
  const liveSheet = liveDrw?.sheets.find((s) => s.id === liveDrw.activeSheetId) ?? liveDrw?.sheets[0];
  if (!liveDrw || !liveSheet) return;

  const clickedEdgeId = (e.target as SVGElement).getAttribute('data-edge-id') ?? undefined;
  const clickedViewId = (e.target as SVGElement).getAttribute('data-view-id') ?? undefined;
  const clickedEdgeKind = (e.target as SVGElement).getAttribute('data-edge-kind') ?? 'outline';
  if (!clickedEdgeId) return;

  const hitViewId = getViewAtPoint(liveSheet.views, { x: svgX, y: svgY }, clickedViewId);
  if (!hitViewId) return;

  const sess = angularSessionRef.current;

  if (sess.phase === 'pick-edge-1') {
    if (clickedEdgeKind === 'arc') {
      // Single-arc shortcut: immediate dispatch
      void bus.execute(new AddAngularDimCommand(
        liveSheet.id,
        hitViewId,
        { kind: 'arc', edge: { viewId: hitViewId, edgeId: clickedEdgeId } },
      ));
      angularSessionRef.current = { phase: 'pick-edge-1' };
      useToolModeStore.getState().setMode('idle');
      return;
    }
    // Line edge: store edge1 and advance to pick-edge-2
    angularSessionRef.current = {
      phase: 'pick-edge-2',
      viewId: hitViewId,
      edge1: { viewId: hitViewId, edgeId: clickedEdgeId },
    };
    return;
  }

  if (sess.phase === 'pick-edge-2') {
    void bus.execute(new AddAngularDimCommand(
      liveSheet.id,
      sess.viewId,
      {
        kind: 'two-edges',
        edge1: sess.edge1,
        edge2: { viewId: hitViewId, edgeId: clickedEdgeId },
      },
    ));
    angularSessionRef.current = { phase: 'pick-edge-1' };
    useToolModeStore.getState().setMode('idle');
    return;
  }

  return;
}
```

**Run:**  
```
pnpm --filter @zilventor/app test:unit packages/app/src/drawing/__tests__/DrawingCanvas.angular.spec.tsx
```

**Expected:** 2 tests pass.

### Step 3 — Refactor

No refactor needed.

**Commit:**  
```
feat(drawing-f5): T27 — DrawingCanvas angular session (two-edges + arc shortcut)
```

---

### F5-T28 — Live preview overlay

### Context

Per-session ghost elements rendered in the SVG body of `DrawingCanvas`. Pattern mirrors `detailState.stage === 'pickRegionRadius'` (circle preview, lines ~544–568) and the break guide line.

Three preview states:
1. **Baseline** — when `toolMode === 'baseline'` and `baselineSessionRef.current.phase === 'pick-members'` and `cursorMm !== null`: show a dashed horizontal dim-line ghost at the next stacked offset. Approximate position: `datum.end` is unknown client-side without resolving the PointRef → use a simpler ghost: a dashed horizontal line across the cursor's Y position within the view bbox.
2. **Ordinate** — when `toolMode === 'ordinate'` and session is `pick-members` and `cursorMm !== null`: show an L-shaped dashed path from cursor toward the column line. Column X ≈ `originSheetPt.x ± xColumnOffsetMm` (approximate).
3. **Angular** — when `toolMode === 'angular'` and session is `pick-edge-2` (edge1 already picked): show a ghost arc at 15mm radius from the cursor.

All ghost elements carry `data-role="dim-preview"` for test assertion.

### Step 1 — Red: write the failing unit test

**File:** `packages/app/src/drawing/__tests__/DrawingCanvas.preview.spec.tsx` (new file)

```tsx
// packages/app/src/drawing/__tests__/DrawingCanvas.preview.spec.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import { DrawingCanvas } from '../DrawingCanvas';
import { useAppStore } from '../../store/useAppStore';
import { useToolModeStore } from '../toolMode';

const viewId = 'v-preview-test';
const edgeId = 'e-preview-test';

const minimalDrawing = {
  id: 'drw-preview',
  name: 'Preview Drawing',
  units: 'mm' as const,
  source: { partPath: 'part.zipt', sourceKind: 'part' as const },
  properties: {},
  sheets: [{
    id: 'sheet-p',
    name: 'Sheet 1',
    size: { kind: 'iso' as const, size: 'A4' as const },
    orientation: 'landscape' as const,
    views: [{
      id: viewId,
      kind: 'base' as const,
      positionMm: { x: 0, y: 0 },
      scale: { numerator: 1, denominator: 1 },
      orientation: 'front',
      showHidden: false,
      projection: {
        visibleEdges: [{ id: edgeId, kind: 'outline' as const, points: [[-25, -15], [25, -15]] as readonly (readonly [number, number])[] }],
        hiddenEdges: [],
        bbox: { minX: 0, minY: 0, maxX: 50, maxY: 30 },
      },
      inputFingerprint: 'fp-p',
    }],
    dimensions: [],
    dimensionGroups: [],
    annotations: [],
    titleBlock: {},
  }],
  activeSheetId: 'sheet-p',
};

const mockBus = { execute: vi.fn().mockResolvedValue(undefined) };

describe('DrawingCanvas — F5 live preview overlay', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({
      activeDocument: { kind: 'drawing', document: minimalDrawing as never },
      activeDrawing: minimalDrawing as never,
      bus: mockBus as never,
    } as never, false);
  });

  it('baseline pick-members: shows dim-preview element on mouse move', async () => {
    useToolModeStore.getState().setMode('baseline');
    const { container } = render(<DrawingCanvas />);
    const svg = container.querySelector('svg');
    if (!svg) throw new Error('SVG not found');

    // First click to advance to pick-members
    await act(async () => {
      const evt = new MouseEvent('click', { bubbles: true, clientX: 10, clientY: 10 });
      Object.defineProperty(evt, 'target', {
        get: () => {
          const el = document.createElementNS('http://www.w3.org/2000/svg', 'line');
          el.setAttribute('data-edge-id', edgeId);
          el.setAttribute('data-view-id', viewId);
          return el;
        },
      });
      svg.dispatchEvent(evt);
    });

    // Mouse move to trigger preview
    await act(async () => {
      fireEvent.mouseMove(svg, { clientX: 50, clientY: 50 });
    });

    const preview = container.querySelector('[data-role="dim-preview"]');
    expect(preview).not.toBeNull();
  });

  it('angular pick-edge-2: shows dim-preview arc after edge1 picked', async () => {
    useToolModeStore.getState().setMode('angular');
    const { container } = render(<DrawingCanvas />);
    const svg = container.querySelector('svg');
    if (!svg) throw new Error('SVG not found');

    // Pick edge1 (line)
    await act(async () => {
      const evt = new MouseEvent('click', { bubbles: true, clientX: 10, clientY: 10 });
      Object.defineProperty(evt, 'target', {
        get: () => {
          const el = document.createElementNS('http://www.w3.org/2000/svg', 'line');
          el.setAttribute('data-edge-id', edgeId);
          el.setAttribute('data-view-id', viewId);
          el.setAttribute('data-edge-kind', 'outline');
          return el;
        },
      });
      svg.dispatchEvent(evt);
    });

    // Mouse move
    await act(async () => {
      fireEvent.mouseMove(svg, { clientX: 80, clientY: 80 });
    });

    const preview = container.querySelector('[data-role="dim-preview"]');
    expect(preview).not.toBeNull();
  });
});
```

**Run:**  
```
pnpm --filter @zilventor/app test:unit packages/app/src/drawing/__tests__/DrawingCanvas.preview.spec.tsx
```

**Expected failure:** `[data-role="dim-preview"]` element not found (previews not yet rendered).

### Step 2 — Green: add preview overlays to DrawingCanvas JSX

**File:** `packages/app/src/drawing/DrawingCanvas.tsx`

In the SVG body, after the break guide line elements and before the closing `</svg>`, add F5 live preview overlays. These must be rendered in the JSX body of the component (not inside `handleClick`), using the live `cursorMm` state and reading the session refs via `.current`.

Note: Because session refs do NOT trigger re-renders on change, the previews will only appear after the next state change that causes a re-render. The `cursorMm` state update (triggered by `onMouseMove`) provides the re-render signal — this is exactly how the detail/break previews work today.

```tsx
{/* F5 — Baseline pick-members ghost dim line */}
{toolMode === 'baseline' && baselineSessionRef.current.phase === 'pick-members' && cursorMm && (() => {
  return (
    <line
      key="baseline-dim-preview"
      data-role="dim-preview"
      x1={0}
      y1={cursorMm.y - 20}
      x2={sheetW}
      y2={cursorMm.y - 20}
      stroke="rgba(30,100,255,0.5)"
      strokeWidth={0.35}
      strokeDasharray="2 1.5"
    />
  );
})()}

{/* F5 — Ordinate pick-members ghost L-leader */}
{toolMode === 'ordinate' && ordinateSessionRef.current.phase === 'pick-members' && cursorMm && (() => {
  const sess = ordinateSessionRef.current;
  if (sess.phase !== 'pick-members') return null;
  const colX = sess.originSheetPt.x + 20;
  return (
    <path
      key="ordinate-leader-preview"
      data-role="dim-preview"
      d={`M ${cursorMm.x} ${cursorMm.y} L ${colX} ${cursorMm.y} L ${colX} ${sess.originSheetPt.y}`}
      fill="none"
      stroke="rgba(30,100,255,0.5)"
      strokeWidth={0.35}
      strokeDasharray="2 1.5"
    />
  );
})()}

{/* F5 — Angular pick-edge-2 ghost arc */}
{toolMode === 'angular' && angularSessionRef.current.phase === 'pick-edge-2' && cursorMm && (() => {
  // Ghost: small dashed circle at cursor position, radius 15mm
  const r = 15;
  return (
    <circle
      key="angular-arc-preview"
      data-role="dim-preview"
      cx={cursorMm.x}
      cy={cursorMm.y}
      r={r}
      fill="none"
      stroke="rgba(30,100,255,0.5)"
      strokeWidth={0.35}
      strokeDasharray="2 1.5"
    />
  );
})()}
```

**Run:**  
```
pnpm --filter @zilventor/app test:unit packages/app/src/drawing/__tests__/DrawingCanvas.preview.spec.tsx
```

**Expected:** 2 tests pass.

### Step 3 — Refactor

Consider whether to extract each preview into a small `React.memo`-wrapped component to avoid full-canvas re-renders. Given the existing baseline of no `React.memo` on `DrawingCanvas` (per F4's documented risk), the inline IIFE approach is consistent. Document the risk:

```ts
// NOTE (F5): Preview overlays re-render on every cursorMm update because DrawingCanvas
// has no React.memo boundary (F4 structural-dependency caveat — see spec §Risks).
// If performance is a concern, extract these into React.memo overlay components.
```

**Commit:**  
```
feat(drawing-f5): T28 — live preview overlays for baseline / ordinate / angular sessions
```

---

### F5-T29 — DimensionElement cascade integration test

### Context

Part 2's T20 extended `DimensionElement.tsx` switch with `baseline`, `ordinate`, `angular` cases. This task adds a UI-level integration test to confirm cascade text propagation works end-to-end (parameter change → re-render → updated dim text) without an explicit re-render trigger. This exercises the same non-reactive `getState()` snapshot pattern as F4.

No new implementation code in T29. Implementation is solely a test.

### Step 1 — Red / Green (test-only task)

**File:** `packages/app/src/drawing/__tests__/DimensionElement.f5cascade.spec.tsx` (new file)

```tsx
// packages/app/src/drawing/__tests__/DimensionElement.f5cascade.spec.tsx
/**
 * Integration test: cascade text update for F5 dim kinds.
 * Renders a DrawingCanvas with a baseline dim (sourceParameterName = 'width'),
 * edits the parameter via store, verifies the dim text updates.
 *
 * TDD note: this test is GREEN immediately if Part 2's T20 is correctly
 * implemented. If T20 is incomplete, this test will fail, exposing the gap.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { DrawingCanvas } from '../DrawingCanvas';
import { useAppStore } from '../../store/useAppStore';
import { useToolModeStore } from '../toolMode';

const DIM_ID = 'dim-baseline-cascade-test';
const GROUP_ID = 'group-cascade-test';
const VIEW_ID = 'view-cascade-test';

const minimalDrawing = (paramValue: number) => ({
  id: 'drw-cascade',
  name: 'Cascade Drawing',
  units: 'mm' as const,
  source: { partPath: 'part.zipt', sourceKind: 'part' as const },
  properties: {},
  sheets: [{
    id: 'sheet-c',
    name: 'Sheet 1',
    size: { kind: 'iso' as const, size: 'A4' as const },
    orientation: 'landscape' as const,
    views: [{
      id: VIEW_ID,
      kind: 'base' as const,
      positionMm: { x: 0, y: 0 },
      scale: { numerator: 1, denominator: 1 },
      orientation: 'front',
      showHidden: false,
      projection: {
        visibleEdges: [
          { id: 'e-datum', kind: 'outline' as const, points: [[-25, -15], [-25, 15]] as readonly (readonly [number, number])[] },
          { id: 'e-to',    kind: 'outline' as const, points: [[25, -15],  [25, 15]]  as readonly (readonly [number, number])[] },
        ],
        hiddenEdges: [],
        bbox: { minX: 0, minY: 0, maxX: 50, maxY: 30 },
      },
      inputFingerprint: 'fp-c',
    }],
    dimensions: [{
      kind: 'baseline' as const,
      id: DIM_ID,
      viewId: VIEW_ID,
      groupId: GROUP_ID,
      slot: 0,
      to: { kind: 'edge-endpoint' as const, edgeId: 'e-to', end: 'start' as const },
      sourceParameterName: 'width',
    }],
    dimensionGroups: [{
      kind: 'baseline' as const,
      id: GROUP_ID,
      viewId: VIEW_ID,
      datum: { kind: 'edge-endpoint' as const, edgeId: 'e-datum', end: 'start' as const },
      direction: 'h' as const,
      baseOffsetMm: 20,
      spacingMm: 10,
    }],
    annotations: [],
    titleBlock: {},
  }],
  activeSheetId: 'sheet-c',
});

const part = (widthValue: number) => ({
  id: 'part-cascade',
  name: 'Cascade Part',
  units: 'mm',
  parameters: {
    width: { name: 'width', value: widthValue, unit: 'mm' },
  },
  featureTree: [],
});

const mockBus = { execute: vi.fn().mockResolvedValue(undefined) };

describe('DimensionElement — F5 cascade text integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useToolModeStore.getState().setMode('idle');
    useAppStore.setState({
      activeDocument: { kind: 'drawing', document: minimalDrawing(50) as never },
      activeDrawing: minimalDrawing(50) as never,
      activePart: part(50) as never,
      bus: mockBus as never,
    } as never, false);
  });

  it('baseline dim text reflects sourceParameterName value initially', () => {
    const { container } = render(<DrawingCanvas />);
    const textEl = container.querySelector(`[data-dim-id="${DIM_ID}"] [data-dim-text]`);
    // Text should contain '50' (the initial width value)
    expect(textEl?.textContent).toContain('50');
  });

  it('baseline dim text updates when activePart.parameters.width changes', async () => {
    const { container } = render(<DrawingCanvas />);

    await act(async () => {
      useAppStore.setState({
        activePart: part(75) as never,
      } as never, false);
    });

    const textEl = container.querySelector(`[data-dim-id="${DIM_ID}"] [data-dim-text]`);
    expect(textEl?.textContent).toContain('75');
  });
});
```

**Run:**  
```
pnpm --filter @zilventor/app test:unit packages/app/src/drawing/__tests__/DimensionElement.f5cascade.spec.tsx
```

**Expected outcome:** If Part 2's T20 is complete, both tests should pass on the first run (GREEN). If they fail, the root cause is an incomplete cascade switch in `DimensionElement.tsx` — diagnose and fix that file before continuing.

### Step 2 — Fix if red

If the cascade tests fail, inspect `packages/app/src/drawing/DimensionElement.tsx` and verify that the switch statement covers `kind === 'baseline'`, `kind === 'ordinate'`, and `kind === 'angular'`. The text resolution logic must be:

1. If `dim.textOverride` is set → use it.
2. If `dim.sourceParameterName` is set → look up in `useAppStore.getState().activePart?.parameters[dim.sourceParameterName]?.value` → format as `${value}`.
3. Otherwise → render computed value string (from rendering math: baseline shows distance, ordinate shows distance, angular shows degrees).

**Commit:**  
```
test(drawing-f5): T29 — cascade integration test for baseline/ordinate/angular DimensionElement
```

---

### F5-T30 — Perf probe in App.tsx

### Context

File: `packages/app/src/App.tsx`  
Locate the `__zilventorAutoDimMs` probe block (lines ~501–649). After its closing `};` line, add the new `__zilventorDimensionStylesMs` probe using the same pattern.

**Probe contract:**  
`window.__zilventorDimensionStylesMs(n: number): Promise<{ p95ms: number }>`

**Fixture:** 1 view with 10 baseline dims (same group), 10 ordinate dims (5 x-axis, 5 y-axis in same group), 10 angular dims (two-edges, distinct pairs). Total 30 dims.

**Measured work:** n iterations of:
1. Set store to drawing with all 30 dims already present (no commands executed in the hot path).
2. Call `renderDrawingSvg(syntheticSheet, syntheticPart)` (import dynamically).
3. Record `performance.now()` delta per iteration.

The measure is the SVG render pipeline (which exercises all three new rendering branches), not the command dispatch path. This matches the spec: "Probe runs n=50 iterations of: re-render with all 30 already present."

### Step 1 — Red: write the failing perf test first

See T31 (the perf spec) — write the spec file before implementing the probe, so the probe absence causes a loud failure.

Actually since the spec file (T31) is the consumer, implement T30's probe code and T31's spec file together as a pair. Treat T31 (spec) as the "red" test and T30 (probe implementation) as the "green" fix.

### Step 2 — Green: add the probe

**File:** `packages/app/src/App.tsx`

After line ~649 (closing `};` of `__zilventorAutoDimMs`), add:

```ts
      // Drawing F5 — dimension-styles perf probe.
      // Fixture: 30 dims (10 baseline + 10 ordinate + 10 angular two-edges).
      // Budget: p95 < 200 ms. Pure SVG render path — no kernel call.
      (w as unknown as { __zilventorDimensionStylesMs: (n?: number) => Promise<{ p95ms: number }> }).__zilventorDimensionStylesMs = async (n = 50) => {
        const { renderDrawingSvg } = await import('./drawing/renderDrawingSvg');
        type Edge2D = import('@zilventor/shared').Edge2D;
        type DimensionGroup = import('@zilventor/shared').DimensionGroup;
        type DrawingDimension = import('@zilventor/shared').DrawingDimension;

        const GROUP_BASELINE = 'perf-group-baseline';
        const GROUP_ORDINATE = 'perf-group-ordinate';
        const VIEW_ID = 'perf-view-f5';

        // 22 synthetic edges: 10 for baseline members + 1 datum + 10 ordinate members + 1 origin
        const syntheticEdges: Edge2D[] = [
          // datum edge for baseline
          { id: 'e-datum', kind: 'outline', points: [[-50, -15] as readonly [number, number], [-50, 15] as readonly [number, number]] as ReadonlyArray<readonly [number, number]> },
          // origin edge for ordinate
          { id: 'e-origin', kind: 'outline', points: [[-50, 0] as readonly [number, number], [0, 0] as readonly [number, number]] as ReadonlyArray<readonly [number, number]> },
          // 10 edges for baseline members
          ...Array.from({ length: 10 }, (_, i): Edge2D => ({
            id: `e-bm-${i}`,
            kind: 'outline',
            points: [[(i + 1) * 10 - 50, -15] as readonly [number, number], [(i + 1) * 10 - 50, 15] as readonly [number, number]] as ReadonlyArray<readonly [number, number]>,
          })),
          // 10 edges for ordinate members (5 x + 5 y)
          ...Array.from({ length: 10 }, (_, i): Edge2D => ({
            id: `e-om-${i}`,
            kind: 'outline',
            points: [[(i < 5 ? (i + 1) * 10 : 0) - 25, i < 5 ? 0 : (i - 4) * 5 - 15] as readonly [number, number], [(i < 5 ? (i + 1) * 10 : 5) - 25, i < 5 ? 5 : (i - 4) * 5 - 10] as readonly [number, number]] as ReadonlyArray<readonly [number, number]>,
          })),
          // 20 edges for angular dims (10 pairs of two lines)
          ...Array.from({ length: 20 }, (_, i): Edge2D => ({
            id: `e-ang-${i}`,
            kind: 'outline',
            points: [[0, 0] as readonly [number, number], [i % 2 === 0 ? 20 : 0, i % 2 === 0 ? 0 : 20] as readonly [number, number]] as ReadonlyArray<readonly [number, number]>,
          })),
        ];

        const baselineGroup: DimensionGroup = {
          kind: 'baseline',
          id: GROUP_BASELINE,
          viewId: VIEW_ID,
          datum: { kind: 'edge-endpoint', edgeId: 'e-datum', end: 'start' },
          direction: 'h',
          baseOffsetMm: 20,
          spacingMm: 10,
        };

        const ordinateGroup: DimensionGroup = {
          kind: 'ordinate',
          id: GROUP_ORDINATE,
          viewId: VIEW_ID,
          origin: { kind: 'edge-endpoint', edgeId: 'e-origin', end: 'start' },
          xColumnOffsetMm: 20,
          yColumnOffsetMm: 20,
        };

        const baselineDims: DrawingDimension[] = Array.from({ length: 10 }, (_, i) => ({
          kind: 'baseline' as const,
          id: `d-bm-${i}`,
          viewId: VIEW_ID,
          groupId: GROUP_BASELINE,
          slot: i,
          to: { kind: 'edge-endpoint' as const, edgeId: `e-bm-${i}`, end: 'start' as const },
        }));

        const ordinateDims: DrawingDimension[] = Array.from({ length: 10 }, (_, i) => ({
          kind: 'ordinate' as const,
          id: `d-om-${i}`,
          viewId: VIEW_ID,
          groupId: GROUP_ORDINATE,
          axis: i < 5 ? ('x' as const) : ('y' as const),
          to: { kind: 'edge-endpoint' as const, edgeId: `e-om-${i}`, end: 'start' as const },
        }));

        const angularDims: DrawingDimension[] = Array.from({ length: 10 }, (_, i) => ({
          kind: 'angular' as const,
          id: `d-ang-${i}`,
          viewId: VIEW_ID,
          ref: {
            kind: 'two-edges' as const,
            edge1: { viewId: VIEW_ID, edgeId: `e-ang-${i * 2}` },
            edge2: { viewId: VIEW_ID, edgeId: `e-ang-${i * 2 + 1}` },
          },
          arcSide: 'inside' as const,
          offsetMm: 15,
        }));

        const syntheticSheet = {
          id: 'perf-sheet-f5',
          name: 'Perf F5',
          size: { kind: 'iso' as const, size: 'A4' as const },
          orientation: 'landscape' as const,
          views: [{
            id: VIEW_ID,
            kind: 'base' as const,
            positionMm: { x: 0, y: 0 },
            scale: { numerator: 1, denominator: 1 },
            orientation: 'front',
            showHidden: false,
            projection: {
              visibleEdges: syntheticEdges,
              hiddenEdges: [] as Edge2D[],
              bbox: { minX: -50, minY: -15, maxX: 150, maxY: 30 },
            },
            inputFingerprint: 'fp-f5-perf',
          }],
          dimensions: [...baselineDims, ...ordinateDims, ...angularDims] as DrawingDimension[],
          dimensionGroups: [baselineGroup, ordinateGroup] as DimensionGroup[],
          annotations: [],
          titleBlock: {},
        };

        const syntheticPart = {
          id: 'perf-part-f5',
          name: 'PerfF5Part',
          units: 'mm',
          parameters: {},
          featureTree: [],
        };

        const dimStyleSamples: number[] = [];
        for (let iter = 0; iter < n; iter++) {
          const t0 = performance.now();
          renderDrawingSvg(syntheticSheet as never, syntheticPart as never);
          dimStyleSamples.push(performance.now() - t0);
        }

        dimStyleSamples.sort((a, b) => a - b);
        const p95ms = dimStyleSamples[Math.floor(dimStyleSamples.length * 0.95)] ?? 0;
        return { p95ms };
      };
```

**Run (typecheck only at this stage — perf test in T31):**  
```
pnpm --filter @zilventor/app typecheck
```

**Expected:** No TS errors.

**Commit:**  
```
feat(drawing-f5): T30 — __zilventorDimensionStylesMs perf probe in App.tsx
```

---

### F5-T31 — Perf spec

### Context

File: `tests/perf/dimension-styles.perf.spec.ts` (new file)  
Mirrors `tests/perf/auto-dim.perf.spec.ts` exactly.

### Step 1 — Red: write the spec before the probe is wired (T30 before T31 in dependency order, but spec is written first as the "red" statement)

**File:** `tests/perf/dimension-styles.perf.spec.ts`

```ts
// tests/perf/dimension-styles.perf.spec.ts
import { test, expect } from '@playwright/test';

/**
 * Perf — Drawing F5 dimension styles (renderDrawingSvg for baseline/ordinate/angular).
 *
 * Runs 50 iterations of renderDrawingSvg against a synthetic fixture:
 * 10 baseline dims + 10 ordinate dims (5x + 5y) + 10 angular dims (two-edges).
 * 30 dims total; budget: p95 < 200 ms.
 *
 * The probe window.__zilventorDimensionStylesMs(n) is wired in App.tsx
 * after __zilventorAutoDimMs. Returns { p95ms: number }.
 *
 * LOUD FAILURE: if the probe is not present on window, the test throws with a
 * clear error rather than silently passing — per F4 perf precedent.
 */
test('Perf drawing-dimension-styles: renderDrawingSvg p95 < 200ms', async ({ page }) => {
  await page.goto('/');

  // Hard wait for probe — loud failure if missing.
  await page.waitForFunction(
    () => typeof (window as { __zilventorDimensionStylesMs?: unknown }).__zilventorDimensionStylesMs === 'function',
    undefined,
    { timeout: 30_000 },
  ).catch(() => {
    throw new Error(
      'F5 perf wiring incomplete: window.__zilventorDimensionStylesMs is not a function. ' +
      'Wire the probe in App.tsx after __zilventorAutoDimMs (see T30).',
    );
  });

  const result = await page.evaluate(
    () =>
      (window as {
        __zilventorDimensionStylesMs?: (n: number) => Promise<{ p95ms: number }>;
      }).__zilventorDimensionStylesMs!(50),
  );

  const { p95ms } = result;
  console.log(`[perf] dimension-styles renderDrawingSvg p95 = ${p95ms.toFixed(2)} ms (budget 200ms)`);
  expect(p95ms).toBeLessThan(200);
});
```

**Run (before T30 probe is wired — expect loud failure):**  
```
pnpm --filter @zilventor/app test:perf tests/perf/dimension-styles.perf.spec.ts
```

**Expected failure:** `F5 perf wiring incomplete: window.__zilventorDimensionStylesMs is not a function.`

After T30 is implemented:

```
pnpm --filter @zilventor/app test:perf tests/perf/dimension-styles.perf.spec.ts
```

**Expected:** `p95ms < 200` — PASS.

### Step 2 — Refactor

No refactor.

**Commit:**  
```
test(drawing-f5): T31 — dimension-styles.perf.spec.ts (p95 < 200ms budget)
```

---

### F5-T32 — E2E spec T-6-12

### Context

File: `tests/e2e/drawing/T-6-12-dimension-styles.spec.ts` (new file)  
Mirrors `tests/e2e/drawing/T-6-11-auto-dim.spec.ts`.

4 assertions:
1. Baseline group: 3 members with `data-slot` 0/1/2 and stacked Y offsets matching `baseOffsetMm + slot * spacingMm`.
2. Ordinate group: 2 X-members + 1 Y-member with correct `data-axis` values.
3. Angular dim (two-edges): SVG contains `<path>` with `data-dim-kind="angular"` and arc command `A` in `d`.
4. Cascade: edit parameter referenced by angular dim's `sourceParameterName`; dim text updates.

**Note on `dimensionGroups`:** The fixture sheet MUST include `dimensionGroups: []` (defaulted) in the initial store injection, and the E2E explicitly dispatches `AddDimensionGroupCommand` + `AddBaselineMemberCommand` etc. via dynamic import — same pattern as T-6-11's `AutoDimCommand.apply()`.

### Step 1 — Red: write spec first (before all F5 render + command code is complete, this will fail)

**File:** `tests/e2e/drawing/T-6-12-dimension-styles.spec.ts`

```ts
// tests/e2e/drawing/T-6-12-dimension-styles.spec.ts
import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';

/**
 * T-6-12 — Dimension styles: baseline / ordinate / angular.
 * Dispatches commands via store injection, asserts SVG DOM output.
 *
 * Pattern: store-injection (same as T-6-11).
 * No real canvas clicks — commands dispatched via page.evaluate dynamic import.
 */
test('T-6-12: Dimension styles — baseline/ordinate/angular dims, cascade text', async ({ page }) => {
  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('/');
  await waitForKernelReady(page);

  // ──────────────────────────────────────────────────────────────────────────
  // 1. Inject drawing with one base view (3 edges for baseline, 2 for ordinate,
  //    2 for angular) + part with 1 parameter for cascade test.
  // ──────────────────────────────────────────────────────────────────────────
  const ids = await page.evaluate(async () => {
    const w = window as unknown as {
      __zilventorStore: { getState(): unknown; setState(p: unknown): void };
    };

    const partId = `part-T612-${Date.now()}`;
    const sheetId = `sheet-T612-${Date.now()}`;
    const baseViewId = `base-T612-${Date.now()}`;
    const drawingId = `drawing-T612-${Date.now()}`;

    const activePart = {
      id: partId,
      name: 'T612 Part',
      units: 'mm',
      parameters: {
        angle: { name: 'angle', value: 45, unit: 'deg' },
      },
      featureTree: [],
    };

    const baseView = {
      id: baseViewId,
      kind: 'base',
      positionMm: { x: 10, y: 10 },
      scale: { numerator: 1, denominator: 1 },
      orientation: 'front',
      showHidden: false,
      projection: {
        visibleEdges: [
          // Baseline fixture: datum + 3 member edges
          { id: 'e-datum',   kind: 'outline', points: [[-50, -15], [-50, 15]]  },
          { id: 'e-bm-0',    kind: 'outline', points: [[-30, -15], [-30, 15]]  },
          { id: 'e-bm-1',    kind: 'outline', points: [[-10, -15], [-10, 15]]  },
          { id: 'e-bm-2',    kind: 'outline', points: [[10, -15],  [10, 15]]   },
          // Ordinate fixture: origin + 3 member edges (2 x-axis, 1 y-axis)
          { id: 'e-origin',  kind: 'outline', points: [[-50, 0],   [0, 0]]     },
          { id: 'e-om-x0',   kind: 'outline', points: [[20, -5],   [20, 5]]    },
          { id: 'e-om-x1',   kind: 'outline', points: [[40, -5],   [40, 5]]    },
          { id: 'e-om-y0',   kind: 'outline', points: [[-5, 20],   [5, 20]]    },
          // Angular fixture: two line edges for two-edges dim
          { id: 'e-ang-1',   kind: 'outline', points: [[0, 0],     [30, 0]]    },
          { id: 'e-ang-2',   kind: 'outline', points: [[0, 0],     [0, 30]]    },
        ],
        hiddenEdges: [],
        bbox: { minX: -50, minY: -15, maxX: 50, maxY: 50 },
      },
      inputFingerprint: `fp-T612-${partId}`,
    };

    const drawing = {
      id: drawingId,
      name: 'T-6-12 Drawing',
      units: 'mm',
      source: { partPath: `${partId}.zipt`, sourceKind: 'part' },
      properties: {},
      sheets: [{
        id: sheetId,
        name: 'Sheet 1',
        size: { kind: 'iso', size: 'A4' },
        orientation: 'landscape',
        views: [baseView],
        dimensions: [],
        dimensionGroups: [],
        annotations: [],
        titleBlock: {},
      }],
      activeSheetId: sheetId,
    };

    w.__zilventorStore.setState({
      activeDocument: { kind: 'drawing', document: drawing },
      activeDrawing: drawing,
      activePart,
    });

    return { sheetId, baseViewId, drawingId, partId };
  });

  await page.getByRole('tab', { name: 'Drawing' }).click();
  await expect(page.locator(`g[data-view-id="${ids.baseViewId}"]`)).toBeVisible({ timeout: 10_000 });

  // ──────────────────────────────────────────────────────────────────────────
  // 2. Dispatch baseline group + 3 members.
  // ──────────────────────────────────────────────────────────────────────────
  const baselineResult = await page.evaluate(
    async ({ sheetId, baseViewId }: { sheetId: string; baseViewId: string }) => {
      const { AddDimensionGroupCommand } = await import('/src/commands/AddDimensionGroupCommand.ts');
      const { AddBaselineMemberCommand } = await import('/src/commands/AddBaselineMemberCommand.ts');

      const groupId = `bg-T612-${Date.now()}`;
      const group = {
        kind: 'baseline' as const,
        id: groupId,
        viewId: baseViewId,
        datum: { kind: 'edge-endpoint' as const, edgeId: 'e-datum', end: 'start' as const },
        direction: 'h' as const,
        baseOffsetMm: 20,
        spacingMm: 10,
      };

      const addGroup = new AddDimensionGroupCommand(sheetId, group);
      await addGroup.apply();

      const m0 = new AddBaselineMemberCommand(sheetId, groupId, { kind: 'edge-endpoint', edgeId: 'e-bm-0', end: 'start' });
      await m0.apply();
      const m1 = new AddBaselineMemberCommand(sheetId, groupId, { kind: 'edge-endpoint', edgeId: 'e-bm-1', end: 'start' });
      await m1.apply();
      const m2 = new AddBaselineMemberCommand(sheetId, groupId, { kind: 'edge-endpoint', edgeId: 'e-bm-2', end: 'start' });
      await m2.apply();

      const w2 = window as unknown as {
        __zilventorStore: { getState(): { activeDocument?: { kind: string; document: { sheets: Array<{ id: string; dimensions: Array<{ id: string; kind: string; groupId?: string; slot?: number }> }> } } } };
      };
      const doc = w2.__zilventorStore.getState().activeDocument;
      if (doc?.kind !== 'drawing') return { ok: false, dims: [] as { id: string; kind: string; groupId?: string; slot?: number }[] };
      const sheet = doc.document.sheets.find((s) => s.id === sheetId);
      const baselineDims = (sheet?.dimensions ?? [])
        .filter((d): d is { id: string; kind: string; groupId?: string; slot?: number } => d.kind === 'baseline');
      return { ok: true, dims: baselineDims, groupId };
    },
    { sheetId: ids.sheetId, baseViewId: ids.baseViewId },
  );

  // ── Assertion 1a: 3 baseline dims placed ─────────────────────────────────
  expect(baselineResult.ok).toBe(true);
  expect(baselineResult.dims.length).toBe(3);

  // ── Assertion 1b: slots are 0, 1, 2 ─────────────────────────────────────
  const slots = baselineResult.dims.map((d) => d.slot).sort((a, b) => (a ?? 0) - (b ?? 0));
  expect(slots).toEqual([0, 1, 2]);

  // ── Assertion 1c: SVG shows 3 [data-dim-kind="baseline"] elements ─────────
  for (const dim of baselineResult.dims) {
    await expect(page.locator(`[data-dim-id="${dim.id}"]`)).toBeVisible({ timeout: 5_000 });
  }

  // ── Assertion 1d: data-slot attribute present ─────────────────────────────
  for (const dim of baselineResult.dims) {
    const el = page.locator(`[data-dim-id="${dim.id}"][data-dim-kind="baseline"]`);
    await expect(el).toBeVisible({ timeout: 3_000 });
    const slotVal = await el.getAttribute('data-slot');
    expect(slotVal).not.toBeNull();
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 3. Dispatch ordinate group + 2 x-axis + 1 y-axis members.
  // ──────────────────────────────────────────────────────────────────────────
  const ordinateResult = await page.evaluate(
    async ({ sheetId, baseViewId }: { sheetId: string; baseViewId: string }) => {
      const { AddDimensionGroupCommand } = await import('/src/commands/AddDimensionGroupCommand.ts');
      const { AddOrdinateMemberCommand } = await import('/src/commands/AddOrdinateMemberCommand.ts');

      const groupId = `og-T612-${Date.now()}`;
      const group = {
        kind: 'ordinate' as const,
        id: groupId,
        viewId: baseViewId,
        origin: { kind: 'edge-endpoint' as const, edgeId: 'e-origin', end: 'start' as const },
        xColumnOffsetMm: 20,
        yColumnOffsetMm: 20,
      };

      await new AddDimensionGroupCommand(sheetId, group).apply();
      await new AddOrdinateMemberCommand(sheetId, groupId, { kind: 'edge-endpoint', edgeId: 'e-om-x0', end: 'start' }, 'x').apply();
      await new AddOrdinateMemberCommand(sheetId, groupId, { kind: 'edge-endpoint', edgeId: 'e-om-x1', end: 'start' }, 'x').apply();
      await new AddOrdinateMemberCommand(sheetId, groupId, { kind: 'edge-endpoint', edgeId: 'e-om-y0', end: 'start' }, 'y').apply();

      const w2 = window as unknown as {
        __zilventorStore: { getState(): { activeDocument?: { kind: string; document: { sheets: Array<{ id: string; dimensions: Array<{ id: string; kind: string; axis?: string }> }> } } } };
      };
      const doc = w2.__zilventorStore.getState().activeDocument;
      if (doc?.kind !== 'drawing') return { ok: false, dims: [] as { id: string; kind: string; axis?: string }[] };
      const sheet = doc.document.sheets.find((s) => s.id === sheetId);
      const ordinateDims = (sheet?.dimensions ?? [])
        .filter((d): d is { id: string; kind: string; axis?: string } => d.kind === 'ordinate');
      return { ok: true, dims: ordinateDims };
    },
    { sheetId: ids.sheetId, baseViewId: ids.baseViewId },
  );

  // ── Assertion 2a: 3 ordinate dims placed ─────────────────────────────────
  expect(ordinateResult.ok).toBe(true);
  expect(ordinateResult.dims.length).toBe(3);

  // ── Assertion 2b: axis values correct (2 'x' + 1 'y') ───────────────────
  const xCount = ordinateResult.dims.filter((d) => d.axis === 'x').length;
  const yCount = ordinateResult.dims.filter((d) => d.axis === 'y').length;
  expect(xCount).toBe(2);
  expect(yCount).toBe(1);

  // ── Assertion 2c: SVG has [data-dim-kind="ordinate"] with correct data-axis ─
  for (const dim of ordinateResult.dims) {
    const el = page.locator(`[data-dim-id="${dim.id}"][data-dim-kind="ordinate"]`);
    await expect(el).toBeVisible({ timeout: 3_000 });
    const axisVal = await el.getAttribute('data-axis');
    expect(axisVal).toBe(dim.axis ?? null);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 4. Dispatch angular dim (two-edges) with sourceParameterName for cascade.
  // ──────────────────────────────────────────────────────────────────────────
  const angularResult = await page.evaluate(
    async ({ sheetId, baseViewId }: { sheetId: string; baseViewId: string }) => {
      const { AddAngularDimCommand } = await import('/src/commands/AddAngularDimCommand.ts');

      const cmd = new AddAngularDimCommand(
        sheetId,
        baseViewId,
        { kind: 'two-edges', edge1: { viewId: baseViewId, edgeId: 'e-ang-1' }, edge2: { viewId: baseViewId, edgeId: 'e-ang-2' } },
        'inside',
        15,
        { sourceParameterName: 'angle' },
      );
      await cmd.apply();

      const w2 = window as unknown as {
        __zilventorStore: { getState(): { activeDocument?: { kind: string; document: { sheets: Array<{ id: string; dimensions: Array<{ id: string; kind: string; sourceParameterName?: string }> }> } } } };
      };
      const doc = w2.__zilventorStore.getState().activeDocument;
      if (doc?.kind !== 'drawing') return { ok: false, dimId: null as string | null };
      const sheet = doc.document.sheets.find((s) => s.id === sheetId);
      const angDim = sheet?.dimensions.find((d) => d.kind === 'angular');
      console.log(`[T-6-12] angular dim id: ${angDim?.id ?? 'none'}`);
      return { ok: !!angDim, dimId: angDim?.id ?? null };
    },
    { sheetId: ids.sheetId, baseViewId: ids.baseViewId },
  );

  // ── Assertion 3a: angular dim placed ─────────────────────────────────────
  expect(angularResult.ok).toBe(true);
  expect(angularResult.dimId).not.toBeNull();

  // ── Assertion 3b: SVG path contains arc command 'A' ──────────────────────
  if (angularResult.dimId) {
    const angEl = page.locator(`[data-dim-id="${angularResult.dimId}"]`);
    await expect(angEl).toBeVisible({ timeout: 5_000 });
    // The angular dim SVG output should contain a <path> with an arc 'A' command
    const pathEl = page.locator(`[data-dim-id="${angularResult.dimId}"] path`);
    const pathD = await pathEl.first().getAttribute('d');
    expect(pathD).toContain('A');
  }

  // ── Mid-flight screenshot ─────────────────────────────────────────────────
  await page.screenshot({ path: '/tmp/drawing-dim-styles-proof.png' });
  console.log('[T-6-12] proof screenshot saved to /tmp/drawing-dim-styles-proof.png');

  // ──────────────────────────────────────────────────────────────────────────
  // 5. Cascade: edit 'angle' parameter, angular dim text updates.
  // ──────────────────────────────────────────────────────────────────────────
  await page.evaluate(({ partId }: { partId: string }) => {
    const w = window as unknown as {
      __zilventorStore: {
        getState(): { activePart: { id: string; parameters: Record<string, { name: string; value: number; unit: string }> } | null };
        setState(p: unknown): void;
      };
    };
    const s = w.__zilventorStore.getState();
    if (!s.activePart || s.activePart.id !== partId) return;
    const updatedPart = {
      ...s.activePart,
      parameters: {
        ...s.activePart.parameters,
        angle: { ...s.activePart.parameters['angle'], value: 60 },
      },
    };
    w.__zilventorStore.setState({ activePart: updatedPart });
  }, { partId: ids.partId });

  // ── Assertion 4: dim text updates to new angle value ─────────────────────
  if (angularResult.dimId) {
    const dimTextLocator = page.locator(`[data-dim-id="${angularResult.dimId}"] [data-dim-text]`);
    await expect(dimTextLocator).toHaveText('60', { timeout: 5_000 });
  }
});
```

**Run (will fail until T32's depended commands + render code from batches 1 & 2 are complete):**  
```
pnpm --filter @zilventor/app test:e2e tests/e2e/drawing/T-6-12-dimension-styles.spec.ts
```

**Expected (when all batches complete):** 4 assertion groups pass.

**Commit:**  
```
test(drawing-f5): T32 — T-6-12 e2e spec (baseline/ordinate/angular/cascade)
```

---

### F5-T33 — Mid-flight Playwright verification

### Context

Per CLAUDE.md §6 and `feedback_drive_ui_mid_flight.md`: the implementer MUST drive the actual Chromium UI and capture screenshots before final-pass review. The controller MUST `Read` the screenshots back.

This is a **manual driver task** — not automated. The implementer subagent launches the dev server, opens Chromium via Playwright, exercises each of the 3 tool modes, and saves screenshots to `/tmp/f5-screenshots/`.

### Step 1 — Pre-requisites

Confirm the following before starting this task:
- `pnpm --filter @zilventor/app typecheck` is green.
- `pnpm --filter @zilventor/app test:unit` is green (all existing + new F5 unit tests).
- T-6-12 e2e passes.
- `dimension-styles.perf.spec.ts` passes.

### Step 2 — Screenshot script

**File:** `/tmp/f5-verify.ts` (temporary, not committed)

The implementer creates and runs this Playwright script:

```ts
// /tmp/f5-verify.ts — Mid-flight F5 verification (Playwright/Node)
// Run: npx playwright test --project=chromium --headed /tmp/f5-verify.ts
// Screenshots saved to /tmp/f5-screenshots/

import { chromium } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';

async function main() {
  fs.mkdirSync('/tmp/f5-screenshots', { recursive: true });
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  await page.goto('http://localhost:5173');
  // Wait for kernel ready (same check as buildBox helper)
  await page.waitForFunction(() => {
    const s = (window as { __zilventorStore?: { getState(): { status?: string } } }).__zilventorStore;
    return s && s.getState().status?.includes('Ready');
  }, undefined, { timeout: 30_000 });

  // ── Inject fixture + navigate to Drawing tab ─────────────────────────────
  const { sheetId, baseViewId, drawingId, partId } = await page.evaluate(async () => {
    const w = window as unknown as { __zilventorStore: { setState(p: unknown): void } };
    const partId = `part-f5v-${Date.now()}`;
    const sheetId = `sheet-f5v-${Date.now()}`;
    const baseViewId = `base-f5v-${Date.now()}`;
    const drawingId = `drawing-f5v-${Date.now()}`;

    const activePart = {
      id: partId, name: 'F5 Verify Part', units: 'mm',
      parameters: { width: { name: 'width', value: 50, unit: 'mm' } },
      featureTree: [],
    };

    const baseView = {
      id: baseViewId, kind: 'base',
      positionMm: { x: 30, y: 60 },
      scale: { numerator: 1, denominator: 1 },
      orientation: 'front', showHidden: false,
      projection: {
        visibleEdges: [
          { id: 'e-datum', kind: 'outline', points: [[-50, -15], [-50, 15]] },
          { id: 'e-m0',    kind: 'outline', points: [[-25, -15], [-25, 15]] },
          { id: 'e-m1',    kind: 'outline', points: [[0,   -15], [0,   15]] },
          { id: 'e-m2',    kind: 'outline', points: [[25,  -15], [25,  15]] },
          { id: 'e-ori',   kind: 'outline', points: [[-50, 0],  [0,   0]]   },
          { id: 'e-omx',   kind: 'outline', points: [[20, -5],  [20,  5]]   },
          { id: 'e-omy',   kind: 'outline', points: [[-5, 20],  [5,   20]]  },
          { id: 'e-a1',    kind: 'outline', points: [[0,  0],   [40,  0]]   },
          { id: 'e-a2',    kind: 'outline', points: [[0,  0],   [0,   40]]  },
        ],
        hiddenEdges: [],
        bbox: { minX: -50, minY: -15, maxX: 50, maxY: 50 },
      },
      inputFingerprint: `fp-f5v`,
    };

    const drawing = {
      id: drawingId, name: 'F5 Verify Drawing', units: 'mm',
      source: { partPath: `${partId}.zipt`, sourceKind: 'part' },
      properties: {},
      sheets: [{
        id: sheetId, name: 'Sheet 1',
        size: { kind: 'iso', size: 'A3' }, orientation: 'landscape',
        views: [baseView],
        dimensions: [], dimensionGroups: [], annotations: [], titleBlock: {},
      }],
      activeSheetId: sheetId,
    };

    w.__zilventorStore.setState({
      activeDocument: { kind: 'drawing', document: drawing },
      activeDrawing: drawing,
      activePart,
    });
    return { sheetId, baseViewId, drawingId, partId };
  });

  await page.getByRole('tab', { name: 'Drawing' }).click();
  await page.locator(`g[data-view-id="${baseViewId}"]`).waitFor({ timeout: 10_000 });

  // ── Screenshot A: initial state + baseline ribbon button visible ──────────
  await page.screenshot({ path: '/tmp/f5-screenshots/a-initial.png', fullPage: false });
  console.log('Saved: a-initial.png — should show Drawing tab with Baseline / Ordinate / Angular ribbon buttons');

  // ── Dispatch baseline group + 3 members ──────────────────────────────────
  await page.evaluate(async ({ sheetId, baseViewId }) => {
    const { AddDimensionGroupCommand } = await import('/src/commands/AddDimensionGroupCommand.ts');
    const { AddBaselineMemberCommand } = await import('/src/commands/AddBaselineMemberCommand.ts');
    const gid = `bg-verify-${Date.now()}`;
    await new AddDimensionGroupCommand(sheetId, { kind: 'baseline', id: gid, viewId: baseViewId, datum: { kind: 'edge-endpoint', edgeId: 'e-datum', end: 'start' }, direction: 'h', baseOffsetMm: 20, spacingMm: 10 }).apply();
    await new AddBaselineMemberCommand(sheetId, gid, { kind: 'edge-endpoint', edgeId: 'e-m0', end: 'start' }).apply();
    await new AddBaselineMemberCommand(sheetId, gid, { kind: 'edge-endpoint', edgeId: 'e-m1', end: 'start' }).apply();
    await new AddBaselineMemberCommand(sheetId, gid, { kind: 'edge-endpoint', edgeId: 'e-m2', end: 'start' }).apply();
  }, { sheetId, baseViewId });

  await page.waitForTimeout(500);
  await page.screenshot({ path: '/tmp/f5-screenshots/b-baseline-3-stacked.png' });
  console.log('Saved: b-baseline-3-stacked.png — should show 3 stacked horizontal baseline dims above the view');

  // ── Dispatch ordinate group + members ────────────────────────────────────
  await page.evaluate(async ({ sheetId, baseViewId }) => {
    const { AddDimensionGroupCommand } = await import('/src/commands/AddDimensionGroupCommand.ts');
    const { AddOrdinateMemberCommand } = await import('/src/commands/AddOrdinateMemberCommand.ts');
    const gid = `og-verify-${Date.now()}`;
    await new AddDimensionGroupCommand(sheetId, { kind: 'ordinate', id: gid, viewId: baseViewId, origin: { kind: 'edge-endpoint', edgeId: 'e-ori', end: 'start' }, xColumnOffsetMm: 20, yColumnOffsetMm: 20 }).apply();
    await new AddOrdinateMemberCommand(sheetId, gid, { kind: 'edge-endpoint', edgeId: 'e-omx', end: 'start' }, 'x').apply();
    await new AddOrdinateMemberCommand(sheetId, gid, { kind: 'edge-endpoint', edgeId: 'e-omy', end: 'start' }, 'y').apply();
  }, { sheetId, baseViewId });

  await page.waitForTimeout(500);
  await page.screenshot({ path: '/tmp/f5-screenshots/c-ordinate-leaders.png' });
  console.log('Saved: c-ordinate-leaders.png — should show L-shaped leaders from feature points to column lines');

  // ── Dispatch angular dim ─────────────────────────────────────────────────
  await page.evaluate(async ({ sheetId, baseViewId }) => {
    const { AddAngularDimCommand } = await import('/src/commands/AddAngularDimCommand.ts');
    await new AddAngularDimCommand(sheetId, baseViewId, { kind: 'two-edges', edge1: { viewId: baseViewId, edgeId: 'e-a1' }, edge2: { viewId: baseViewId, edgeId: 'e-a2' } }, 'inside', 20).apply();
  }, { sheetId, baseViewId });

  await page.waitForTimeout(500);
  await page.screenshot({ path: '/tmp/f5-screenshots/d-angular-arc.png' });
  console.log('Saved: d-angular-arc.png — should show arc dim between the two line edges with degree text');

  // ── Final all-dims screenshot ────────────────────────────────────────────
  await page.screenshot({ path: '/tmp/f5-screenshots/e-all-dims.png' });
  console.log('Saved: e-all-dims.png — all 3 styles visible simultaneously');

  await browser.close();
  console.log('F5 mid-flight verification complete. Check /tmp/f5-screenshots/');
}

main().catch(console.error);
```

### Step 3 — Execution and controller read-back

**Run the script:**  
```bash
cd /Users/lion/Documents/Projects/mine/zilventor
# Start dev server in background
pnpm --filter @zilventor/app dev &
DEV_PID=$!
sleep 5  # wait for server

# Run verification script
npx tsx /tmp/f5-verify.ts

# Screenshot files will be at /tmp/f5-screenshots/
ls -la /tmp/f5-screenshots/
```

**Controller responsibility (MANDATORY per CLAUDE.md §6):**  
After the implementer reports screenshots saved, the controller subagent (or main thread) MUST call `Read` on each screenshot file:

```
Read /tmp/f5-screenshots/a-initial.png
Read /tmp/f5-screenshots/b-baseline-3-stacked.png
Read /tmp/f5-screenshots/c-ordinate-leaders.png
Read /tmp/f5-screenshots/d-angular-arc.png
Read /tmp/f5-screenshots/e-all-dims.png
```

**What each screenshot should show:**

| File | Expected visual |
|------|-----------------|
| `a-initial.png` | Drawing tab open, ribbon shows "Baseline", "Ordinate", "Angular" buttons in the Dimension group |
| `b-baseline-3-stacked.png` | 3 horizontal dim lines above the view, evenly stacked (slots 0/1/2, offset 20/30/40mm), each with extension lines and arrowheads |
| `c-ordinate-leaders.png` | L-shaped leader paths from feature points to a vertical/horizontal column line; coordinate values as text outside the elbow |
| `d-angular-arc.png` | Arc between the two perpendicular line edges (90°), with arrowheads at endpoints and "90" degree text at arc midpoint |
| `e-all-dims.png` | All styles visible simultaneously on the sheet |

**Fail criteria (block final-pass review if any of these are true):**
- Ribbon buttons missing from screenshot A.
- Stacked baseline dims are not parallel or not evenly offset.
- Ordinate leaders are missing or straight (not L-shaped).
- Angular arc is a straight line or missing.
- Degree text is wrong (not "90" for two perpendicular edges).

If any fail criterion is met, diagnose the render code from Batch 1 (T10–T17 rendering functions) before proceeding to final-pass review.

**Commit (after screenshots pass):**  
```
test(drawing-f5): T33 — mid-flight Playwright screenshot verification complete
```

---

### F5-T34 — Final batch-3 verify + final-pass review prep

### Step 1 — Full test suite run

Run in order (each must pass before the next):

```bash
# 1. Typecheck all packages
pnpm -r typecheck

# 2. Unit test suite (all packages)
pnpm -r test:unit

# 3. E2E: T-6-12 specifically
pnpm --filter @zilventor/app test:e2e tests/e2e/drawing/T-6-12-dimension-styles.spec.ts

# 4. Perf: dimension-styles
pnpm --filter @zilventor/app test:perf tests/perf/dimension-styles.perf.spec.ts

# 5. Regression: F4 auto-dim still green
pnpm --filter @zilventor/app test:e2e tests/e2e/drawing/T-6-11-auto-dim.spec.ts
pnpm --filter @zilventor/app test:perf tests/perf/auto-dim.perf.spec.ts

# 6. All 11 drawing e2e
pnpm --filter @zilventor/app test:e2e tests/e2e/drawing/

# 7. All perf specs
pnpm --filter @zilventor/app test:perf tests/perf/
```

### Step 2 — Acceptance criteria checklist

Before declaring Batch 3 DONE, confirm every item:

| Criterion | Command | Pass condition |
|-----------|---------|----------------|
| Typecheck clean | `pnpm -r typecheck` | 0 errors across all 5 packages |
| Unit tests green | `pnpm -r test:unit` | All existing 2232 + new ~50–60 F5 unit tests pass |
| T-6-12 e2e green | `test:e2e T-6-12*` | 4 assertion groups pass |
| F5 perf budget | `test:perf dimension-styles*` | p95 < 200ms |
| F4 regression | `test:e2e T-6-11*` | Still green |
| F4 perf regression | `test:perf auto-dim*` | p95 < 200ms |
| All 11 drawing e2e | `test:e2e drawing/` | All pass |
| All perf specs | `test:perf perf/` | All pass |
| Screenshots read | Controller reads `/tmp/f5-screenshots/*.png` | All 5 visuals correct per T33 criteria |

### Step 3 — Final-pass review dispatch

After the checklist is complete, dispatch a **separate Sonnet reviewer subagent** with the following prompt:

> **F5 final-pass code review.**
>
> Branch: `feature/drawing-f5` (or master if FF-merged).  
> Diff base: `b2bb77f` (HEAD before F5).  
>
> Review scope — Batch 3 only (Batch 1 + 2 were reviewed separately):
> - `packages/app/src/drawing/toolMode.ts` — union extension
> - `packages/app/src/shell/tabs/DrawingTab.tsx` — new ribbon buttons
> - `packages/app/src/drawing/DrawingCanvas.tsx` — session handlers + preview overlays
> - `packages/app/src/App.tsx` — `__zilventorDimensionStylesMs` probe
> - `tests/e2e/drawing/T-6-12-dimension-styles.spec.ts` — e2e spec
> - `tests/perf/dimension-styles.perf.spec.ts` — perf spec
> - New test files in `packages/app/src/drawing/__tests__/`
>
> Check for:
> 1. Stale-closure bugs in `DrawingCanvas.tsx` click handlers (must read live state via `useAppStore.getState()`).
> 2. Session refs not reset when ESC is pressed (all three sessions).
> 3. Empty-group cleanup: if a session ends with 0 members, `DeleteDimensionGroupCommand` must be dispatched.
> 4. Preview overlays: are they guarded by `toolMode ===` check AND the session phase check?
> 5. `AddOrdinateMemberCommand` axis inference: does Shift-flip work correctly?
> 6. Angular arc shortcut: single-click on `data-edge-kind="arc"` dispatches immediately AND resets mode to `'idle'`.
> 7. Perf probe: is `renderDrawingSvg` being called (not command dispatch) in the hot loop?
> 8. E2E spec: are all 4 assertion groups isolated (no cross-contamination from previous assertion's store state)?
>
> Report: numbered findings, each with file + line, severity (BLOCKER/WARNING/SUGGESTION), and exact fix.  
> Self-critique + Confidence: <0–100> with calibration note.

**Commit after final-pass review approves:**  
```
test(drawing-f5): T34 — final batch-3 sign-off: typecheck clean, 11 drawing e2e + 9 perf green
```

---

## Branch finalization

After T34 final-pass review approves and all tests pass:

### FF merge to master

```bash
git checkout master
git merge --ff-only feature/drawing-f5
```

If `--ff-only` fails (non-linear history): do NOT force-merge. Rebase the feature branch first:

```bash
git checkout feature/drawing-f5
git rebase master
git checkout master
git merge --ff-only feature/drawing-f5
```

### Worktree cleanup (if feature used a worktree)

```bash
git worktree remove /path/to/f5-worktree   # path from T0 setup
git branch -d feature/drawing-f5
```

If no worktree was used (direct feature branch), just delete the branch after FF merge:

```bash
git branch -d feature/drawing-f5
```

### Memory update task

Dispatch a **Sonnet writer subagent** to update `/Users/lion/Documents/Projects/mine/zilventor/docs/superpowers/memory/next_session_resume.md`:

> **Memory update task — Drawing F5 shipped.**
>
> File to rewrite: `docs/superpowers/memory/next_session_resume.md`
>
> Replace the existing "Drawing F4 shipped" content with:
>
> ```
> Drawing F5 (Baseline / Ordinate / Angular dimension styles) shipped at HEAD <new sha>.
> On "go on" auto-proceed by invoking `superpowers:brainstorming` with the recommended seed:
> currently F5.1 (drag-baseline-datum / drag-stack-spacing) or F6 (Drawing BOM annotation),
> whichever the user redirects to.
>
> F5 deferred follow-up F-items:
> - F5.1 — Edit-group-spacing UI (drag spacingMm in baseline stack)
> - F5.2 — Drag-baseline-datum / drag-ordinate-origin (mutates group PointRef)
> - F5.3 — Ordinate column-line snap to feature columns
> - F5.4 — Auto-detect baseline opportunities in AutoDim (G3 toggle)
> - F5.5 — Angular dim from apex point + 2 arm points (axis E2)
> - F5.6 — Reflex-angle visual cue (warn when arcSide: 'outside')
> - F5.7 — Edit textOverride for whole group
> - F5.8 — DXF export of new dim kinds
>
> Full superpowers chain mandatory; Sonnet subagents only; UI features need
> Playwright + screenshot proof per CLAUDE.md §6.
> ```
>
> Also update the `[Drawing F4 → Drawing F5](project_drawing_auto_dim_feature.md → project_drawing_f5_feature.md)` pointer in `MEMORY.md`.
> Create `docs/superpowers/memory/project_drawing_f5_feature.md` with:
> - Feature name, shipped date, HEAD sha
> - Brief architecture summary (3 new dim kinds, DimensionGroup collection, 3 ToolModes, 12 new commands)
> - Test counts: ~50–60 new unit tests + T-6-12 e2e (4 assertions) + perf (p95 < 200ms)
> - F5.1–F5.8 deferred list
>
> Report: both files updated + new memory file path.

---

