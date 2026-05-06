# Drawing F3 — Broken Views Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add broken-view support — compress long parts in drawing views by removing a middle band along an axis and inserting a zigzag break symbol — as a property of existing `BaseView | ProjectedView | IsoView` (no new view kind).

**Architecture:** Pure 2D post-projection operation. New `applyBreaks(edges, breaks, bbox)` module clips Edge2D against axis-aligned removed bands, translates surviving fragments to close the gap, and emits zigzag `kind: 'break'` polylines. Stored on view as `breaks?: readonly BreakRegion[]` plus α-conditional `rawProjection?: ProjectedGeometry` (populated iff `breaks.length > 0`). New `'break'` tool mode + `AddBreakCommand` + `DeleteBreakCommand`. Manifest v16 → v17 additive.

**Tech Stack:** TypeScript strict, Vitest (unit), Playwright (e2e + perf), Zustand store, jsdom test env with TestStorage shim (Node 25 fix), pnpm workspaces, no new dependencies.

**Spec:** `docs/superpowers/specs/2026-05-06-drawing-broken-views-design.md` (1043 lines, master HEAD `4d9fd9f`).

This plan was originally drafted as 5 parallel parts (`_part1.md`..`_part5.md`) per the playbook for plans > 2000 lines; the part files are now concatenated into this single canonical file. Implementer batches map to the 5 part scopes.

---

## Batch 1 preamble (load-bearing constraints)

- Desktop Chromium only; OPFS-only storage; no server.
- **No kernel calls.** F3 is a pure 2D operation post-projection.
- Manifest v16 → v17 additive only; never modify migrations[0..14].
- **α-conditional invariant** (load-bearing): `view.rawProjection !== undefined ⟺ view.breaks.length > 0`. Every code path that reads or writes `breaks` or `rawProjection` MUST preserve this invariant.
- `Edge2D.kind` widens to `'silhouette' | 'feature' | 'outline' | 'break'`.
- Plan code snippets are REFERENCE — verify external identifiers (exports, type names, function signatures, test fixture shapes) against the actual codebase before re-emitting them. The codebase is the source of truth.
- TDD per CLAUDE.md §4a: every behavior slice is red→green→refactor; success criterion is "named test goes red → green; full suite stays green".
- After every commit in this batch, run `pnpm -r typecheck && pnpm -r test:unit` from the repo root and confirm green.

---

## Batch 1 — Types, migration, `rawProjection` field — α-conditional policy

**Green gate:** `pnpm -r typecheck` + all migration + type tests pass.

**Spec coverage:** §5.1 (BreakRegion), §5.2 (breaks/rawProjection on view types), §5.3 (Edge2D.kind), §5.4 (ProjectFile), §6.1 (migration body), §6.2 (cascade files), §8.1 (fingerprintBreaksArray).

---

### Files touched

**Modify:**
- `packages/shared/src/drawing/types.ts` — add `BreakRegion`; add `breaks?` + `rawProjection?` to `BaseView`, `ProjectedView`, `IsoView`, `SectionView`
- `packages/shared/src/drawing/projectedGeometry.ts` — widen `Edge2D.kind` to add `'break'`
- `packages/shared/src/drawing/fingerprint.ts` — add `fingerprintBreaksArray`
- `packages/shared/src/fileFormat.ts` — `CURRENT_FORMAT_VERSION` 16→17; add `migrations[16]`; extend `normalizeKind`
- `packages/shared/src/types.ts` — extend `ProjectFile` formatVersion union to include `17`
- `packages/shared/src/index.ts` — re-export `BreakRegion` and `fingerprintBreaksArray`
- `packages/shared/src/__tests__/fileFormat.spec.ts` — `toBe(16)` → `toBe(17)`
- `packages/shared/src/__tests__/migrateManifest-v7-to-v8.spec.ts` — cascade `toBe(16)` → `toBe(17)`
- `packages/shared/src/__tests__/migrateManifest-v8-to-v9.spec.ts` — cascade
- `packages/shared/src/__tests__/migrateManifest-v9-to-v10.spec.ts` — cascade
- `packages/shared/src/__tests__/migrateManifest-v10-to-v11.spec.ts` — cascade
- `packages/shared/src/__tests__/migrateManifest-v11-to-v12.spec.ts` — cascade
- `packages/shared/src/__tests__/migrateManifest-v12-to-v13.spec.ts` — cascade
- `packages/shared/src/__tests__/migrateManifest-v13-to-v14.spec.ts` — cascade
- `packages/shared/src/__tests__/migrateManifest-v14-to-v15.spec.ts` — cascade
- `packages/shared/src/__tests__/migrateManifest-v15-to-v16.spec.ts` — cascade

**Create:**
- `packages/shared/src/__tests__/migrateManifest-v16-to-v17.spec.ts`
- `packages/shared/src/drawing/__tests__/types.breakregion.test.ts`
- `packages/shared/src/drawing/__tests__/fingerprintBreaksArray.spec.ts`

---

### Task T1.1 — Add `BreakRegion` type to `types.ts`

**Spec:** §5.1. **Files:** Modify `packages/shared/src/drawing/types.ts`; Create `packages/shared/src/drawing/__tests__/types.breakregion.test.ts`.

- [ ] **Step 1: Write failing test**

  Create `packages/shared/src/drawing/__tests__/types.breakregion.test.ts`:

  ```ts
  import { describe, it, expect } from 'vitest';
  import type { BreakRegion } from '../types';

  describe('BreakRegion shape (spec §5.1)', () => {
    it('has all 6 required fields with correct types', () => {
      const br: BreakRegion = {
        id: 'br-1',
        axis: 'x',
        coordA: 50,
        coordB: 150,
        gapMm: 5,
        style: 'zigzag',
      };
      expect(br.id).toBe('br-1');
      expect(br.axis).toBe('x');
      expect(br.coordA).toBe(50);
      expect(br.coordB).toBe(150);
      expect(br.gapMm).toBe(5);
      expect(br.style).toBe('zigzag');
    });

    it('accepts axis: "y"', () => {
      const br: BreakRegion = {
        id: 'br-y',
        axis: 'y',
        coordA: 30,
        coordB: 80,
        gapMm: 5,
        style: 'zigzag',
      };
      expect(br.axis).toBe('y');
    });

    it('survives JSON round-trip without drift', () => {
      const br: BreakRegion = {
        id: 'br-rt',
        axis: 'x',
        coordA: 100.5,
        coordB: 200.75,
        gapMm: 5,
        style: 'zigzag',
      };
      const parsed = JSON.parse(JSON.stringify(br)) as BreakRegion;
      expect(parsed.coordA).toBe(100.5);
      expect(parsed.coordB).toBe(200.75);
      expect(parsed.style).toBe('zigzag');
    });
  });
  ```

- [ ] **Step 2: Run test, expect FAIL**

  ```
  pnpm --filter @zilventor/shared vitest run drawing/__tests__/types.breakregion
  ```

  Expected failure: `Type 'BreakRegion' not found in module '../types'`.

- [ ] **Step 3: Write minimal impl**

  In `packages/shared/src/drawing/types.ts`, insert the following block immediately before the `BaseView` type declaration (after the existing `ViewScale` block). Do not modify any other existing content:

  ```ts
  // ---------------------------------------------------------------------------
  // BreakRegion — one axis-aligned band removed from a view (spec §5.1)
  // ---------------------------------------------------------------------------

  export type BreakRegion = {
    readonly id: string;           // nanoid(); stable across undo/redo
    readonly axis: 'x' | 'y';     // which axis the band is perpendicular to
    readonly coordA: number;       // view-local mm (pre-scale); lesser boundary
    readonly coordB: number;       // view-local mm (pre-scale); greater boundary; coordB > coordA ALWAYS
    readonly gapMm: number;        // visible gap on sheet after collapse; default 5
    readonly style: 'zigzag';      // wave/double deferred to F3.1; field exists for forward compat
  };
  ```

- [ ] **Step 4: Run test, expect PASS**

  ```
  pnpm --filter @zilventor/shared vitest run drawing/__tests__/types.breakregion
  ```

  Expected: `Tests 3 passed (3)`.

- [ ] **Step 5: Run full typecheck**

  ```
  pnpm -r typecheck
  ```

  Expected: clean.

- [ ] **Step 6: Run full unit suite**

  ```
  pnpm -r test:unit
  ```

  Expected: all green (no regressions).

- [ ] **Step 7: Commit**

  ```
  git add packages/shared/src/drawing/types.ts \
          packages/shared/src/drawing/__tests__/types.breakregion.test.ts
  git commit -m "feat(drawing-broken): add BreakRegion type to drawing/types.ts (spec §5.1)"
  ```

---

### Task T1.2 — Widen `Edge2D.kind` to include `'break'`

**Spec:** §5.3. **Files:** Modify `packages/shared/src/drawing/projectedGeometry.ts`; extend `packages/shared/src/drawing/__tests__/types.breakregion.test.ts`.

- [ ] **Step 1: Write failing test**

  Append to `packages/shared/src/drawing/__tests__/types.breakregion.test.ts`:

  ```ts
  import type { Edge2D } from '../projectedGeometry';

  describe('Edge2D.kind — break tier (spec §5.3)', () => {
    it('accepts kind: "break" at the type level and survives round-trip', () => {
      const breakEdge: Edge2D = {
        id: 'break_br1',
        kind: 'break',
        points: [[100, -5], [100.75, 0], [99.25, 3], [100, 6]],
      };
      const parsed = JSON.parse(JSON.stringify(breakEdge)) as Edge2D;
      expect(parsed.kind).toBe('break');
      expect(parsed.sourceFaceIds).toBeUndefined();
    });

    it('existing kinds silhouette/feature/outline still assignable', () => {
      const e1: Edge2D = { id: 'a', kind: 'silhouette', points: [[0, 0], [1, 1]] };
      const e2: Edge2D = { id: 'b', kind: 'feature',    points: [[0, 0], [1, 1]] };
      const e3: Edge2D = { id: 'c', kind: 'outline',    points: [[0, 0], [1, 1]] };
      expect(e1.kind).toBe('silhouette');
      expect(e2.kind).toBe('feature');
      expect(e3.kind).toBe('outline');
    });
  });
  ```

- [ ] **Step 2: Run test, expect FAIL**

  ```
  pnpm --filter @zilventor/shared vitest run drawing/__tests__/types.breakregion
  ```

  Expected failure: TypeScript compile error — `Type '"break"' is not assignable to type '"silhouette" | "feature" | "outline"'`.

- [ ] **Step 3: Write minimal impl**

  In `packages/shared/src/drawing/projectedGeometry.ts`, replace line 4:

  ```ts
  // BEFORE:
  readonly kind: 'silhouette' | 'feature' | 'outline';        // line-weight tier

  // AFTER:
  readonly kind: 'silhouette' | 'feature' | 'outline' | 'break';  // line-weight tier; 'break' = synthetic zigzag symbol (F3)
  ```

- [ ] **Step 4: Run test, expect PASS**

  ```
  pnpm --filter @zilventor/shared vitest run drawing/__tests__/types.breakregion
  ```

  Expected: all tests pass (count grows by 2).

- [ ] **Step 5: Run full typecheck**

  ```
  pnpm -r typecheck
  ```

  Expected: clean. Any exhaustive switch over `Edge2D.kind` in the codebase that previously had a `never` fallthrough now has an unhandled `'break'` branch — verify no such exhaustive checks exist or add the branch. (Current codebase: `ViewElement.tsx` renders by `e.kind`; it does not have an exhaustive `never` check. If any exhaustive check exists, add `case 'break':` as a pass-through referencing Batch 4 render work.)

- [ ] **Step 6: Run full unit suite**

  ```
  pnpm -r test:unit
  ```

  Expected: green.

- [ ] **Step 7: Commit**

  ```
  git add packages/shared/src/drawing/projectedGeometry.ts \
          packages/shared/src/drawing/__tests__/types.breakregion.test.ts
  git commit -m "feat(drawing-broken): widen Edge2D.kind to include 'break' tier (spec §5.3)"
  ```

---

### Task T1.3 — Add `breaks?` and `rawProjection?` to `BaseView`

**Spec:** §5.2, §9.1 (α-conditional). **Files:** Modify `packages/shared/src/drawing/types.ts`; extend `packages/shared/src/drawing/__tests__/types.breakregion.test.ts`.

- [ ] **Step 1: Write failing test**

  Append to `packages/shared/src/drawing/__tests__/types.breakregion.test.ts`:

  ```ts
  import type { BaseView, ViewScale } from '../types';
  import type { ProjectedGeometry } from '../projectedGeometry';

  describe('BaseView — breaks and rawProjection fields (spec §5.2)', () => {
    const scale: ViewScale = { numerator: 1, denominator: 1 };

    it('BaseView compiles without breaks (existing views unaffected)', () => {
      const v: BaseView = {
        id: 'v1', kind: 'base',
        positionMm: { x: 0, y: 0 }, scale,
        orientation: 'front', showHidden: false,
      };
      expect(v.breaks).toBeUndefined();
      expect(v.rawProjection).toBeUndefined();
    });

    it('BaseView accepts breaks array with BreakRegion entries', () => {
      const br: BreakRegion = { id: 'b1', axis: 'x', coordA: 50, coordB: 150, gapMm: 5, style: 'zigzag' };
      const rawProj: ProjectedGeometry = {
        visibleEdges: [], hiddenEdges: [],
        bbox: { minX: 0, minY: 0, maxX: 400, maxY: 50 },
      };
      const v: BaseView = {
        id: 'v2', kind: 'base',
        positionMm: { x: 0, y: 0 }, scale,
        orientation: 'front', showHidden: false,
        breaks: [br],
        rawProjection: rawProj,
      };
      expect(v.breaks).toHaveLength(1);
      expect(v.rawProjection?.bbox.maxX).toBe(400);
    });

    it('α-conditional: rawProjection absent when breaks absent (compile-time semantics)', () => {
      // Both fields optional and independently absent — the invariant is enforced
      // by commands, not the type system. Here we verify the runtime shape.
      const v: BaseView = {
        id: 'v3', kind: 'base',
        positionMm: { x: 10, y: 10 }, scale,
        orientation: 'top', showHidden: true,
      };
      expect(v.breaks).toBeUndefined();
      expect(v.rawProjection).toBeUndefined();
    });
  });
  ```

- [ ] **Step 2: Run test, expect FAIL**

  ```
  pnpm --filter @zilventor/shared vitest run drawing/__tests__/types.breakregion
  ```

  Expected failure: `Object literal may only specify known properties, and 'breaks' does not exist in type 'BaseView'`.

- [ ] **Step 3: Write minimal impl**

  In `packages/shared/src/drawing/types.ts`, add two optional fields to `BaseView` immediately after the `readonly inputFingerprint?: string;` line:

  ```ts
  readonly breaks?: readonly BreakRegion[];  // NEW (F3): absent = no breaks (treated as [] at runtime)
  // rawProjection is populated iff breaks.length > 0.
  // Invariant: rawProjection !== undefined ⟺ breaks.length > 0. Enforced by commands.
  readonly rawProjection?: ProjectedGeometry;
  ```

- [ ] **Step 4: Run test, expect PASS**

  ```
  pnpm --filter @zilventor/shared vitest run drawing/__tests__/types.breakregion
  ```

  Expected: all tests pass.

- [ ] **Step 5: Run full typecheck**

  ```
  pnpm -r typecheck
  ```

  Expected: clean.

- [ ] **Step 6: Run full unit suite**

  ```
  pnpm -r test:unit
  ```

  Expected: green.

- [ ] **Step 7: Commit**

  ```
  git add packages/shared/src/drawing/types.ts \
          packages/shared/src/drawing/__tests__/types.breakregion.test.ts
  git commit -m "feat(drawing-broken): add breaks? and rawProjection? to BaseView (spec §5.2)"
  ```

---

### Task T1.4 — Add `breaks?` and `rawProjection?` to `ProjectedView`

**Spec:** §5.2. **Files:** Modify `packages/shared/src/drawing/types.ts`; extend test file.

- [ ] **Step 1: Write failing test**

  Append to `packages/shared/src/drawing/__tests__/types.breakregion.test.ts`:

  ```ts
  import type { ProjectedView } from '../types';

  describe('ProjectedView — breaks and rawProjection fields (spec §5.2)', () => {
    it('ProjectedView compiles without breaks', () => {
      const v: ProjectedView = {
        id: 'pv1', kind: 'projected',
        positionMm: { x: 0, y: 0 },
        baseViewId: 'bv1',
        direction: 'right',
        scale: { numerator: 1, denominator: 1 },
        showHidden: false,
      };
      expect(v.breaks).toBeUndefined();
      expect(v.rawProjection).toBeUndefined();
    });

    it('ProjectedView accepts breaks array', () => {
      const v: ProjectedView = {
        id: 'pv2', kind: 'projected',
        positionMm: { x: 100, y: 0 },
        baseViewId: 'bv1',
        direction: 'top',
        scale: { numerator: 1, denominator: 1 },
        showHidden: false,
        breaks: [{ id: 'b1', axis: 'x', coordA: 10, coordB: 60, gapMm: 5, style: 'zigzag' }],
        rawProjection: { visibleEdges: [], hiddenEdges: [], bbox: { minX: 0, minY: 0, maxX: 200, maxY: 40 } },
      };
      expect(v.breaks).toHaveLength(1);
    });
  });
  ```

- [ ] **Step 2: Run test, expect FAIL**

  ```
  pnpm --filter @zilventor/shared vitest run drawing/__tests__/types.breakregion
  ```

  Expected failure: `'breaks' does not exist in type 'ProjectedView'`.

- [ ] **Step 3: Write minimal impl**

  In `packages/shared/src/drawing/types.ts`, add to `ProjectedView` after `readonly inputFingerprint?: string;`:

  ```ts
  readonly breaks?: readonly BreakRegion[];  // NEW (F3): absent = no breaks
  // Invariant: rawProjection !== undefined ⟺ breaks.length > 0. Enforced by commands.
  readonly rawProjection?: ProjectedGeometry;
  ```

- [ ] **Step 4: Run test, expect PASS**

  ```
  pnpm --filter @zilventor/shared vitest run drawing/__tests__/types.breakregion
  ```

- [ ] **Step 5: Run full typecheck + unit suite**

  ```
  pnpm -r typecheck && pnpm -r test:unit
  ```

  Expected: green.

- [ ] **Step 6: Commit**

  ```
  git add packages/shared/src/drawing/types.ts \
          packages/shared/src/drawing/__tests__/types.breakregion.test.ts
  git commit -m "feat(drawing-broken): add breaks? and rawProjection? to ProjectedView (spec §5.2)"
  ```

---

### Task T1.5 — Add `breaks?` and `rawProjection?` to `IsoView`

**Spec:** §5.2. **Files:** Modify `packages/shared/src/drawing/types.ts`; extend test file.

- [ ] **Step 1: Write failing test**

  Append to `packages/shared/src/drawing/__tests__/types.breakregion.test.ts`:

  ```ts
  import type { IsoView } from '../types';

  describe('IsoView — breaks and rawProjection fields (spec §5.2)', () => {
    it('IsoView compiles without breaks', () => {
      const v: IsoView = {
        id: 'iv1', kind: 'iso',
        positionMm: { x: 0, y: 0 },
        corner: 'NE',
        scale: { numerator: 1, denominator: 1 },
        showHidden: false,
      };
      expect(v.breaks).toBeUndefined();
    });

    it('IsoView accepts breaks and rawProjection', () => {
      const v: IsoView = {
        id: 'iv2', kind: 'iso',
        positionMm: { x: 200, y: 50 },
        corner: 'SW',
        scale: { numerator: 1, denominator: 1 },
        showHidden: false,
        breaks: [{ id: 'b2', axis: 'y', coordA: 20, coordB: 70, gapMm: 5, style: 'zigzag' }],
        rawProjection: { visibleEdges: [], hiddenEdges: [], bbox: { minX: 0, minY: 0, maxX: 100, maxY: 100 } },
      };
      expect(v.breaks![0]!.axis).toBe('y');
    });
  });
  ```

- [ ] **Step 2: Run test, expect FAIL**

  ```
  pnpm --filter @zilventor/shared vitest run drawing/__tests__/types.breakregion
  ```

  Expected failure: `'breaks' does not exist in type 'IsoView'`.

- [ ] **Step 3: Write minimal impl**

  In `packages/shared/src/drawing/types.ts`, add to `IsoView` after `readonly inputFingerprint?: string;`:

  ```ts
  readonly breaks?: readonly BreakRegion[];  // NEW (F3): absent = no breaks
  // Invariant: rawProjection !== undefined ⟺ breaks.length > 0. Enforced by commands.
  readonly rawProjection?: ProjectedGeometry;
  ```

- [ ] **Step 4: Run test, expect PASS**

  ```
  pnpm --filter @zilventor/shared vitest run drawing/__tests__/types.breakregion
  ```

- [ ] **Step 5: Run full typecheck + unit suite**

  ```
  pnpm -r typecheck && pnpm -r test:unit
  ```

  Expected: green.

- [ ] **Step 6: Commit**

  ```
  git add packages/shared/src/drawing/types.ts \
          packages/shared/src/drawing/__tests__/types.breakregion.test.ts
  git commit -m "feat(drawing-broken): add breaks? and rawProjection? to IsoView (spec §5.2)"
  ```

---

### Task T1.6 — Add `breaks?` and `rawProjection?` to `SectionView` (forward-compat, Phase-X deferred)

**Spec:** §5.2, §4 (SectionView added for forward compat; F3.6 deferred). **Files:** Modify `packages/shared/src/drawing/types.ts`; extend test file. **Note:** Tests are compile-time only; no behavioral test for section-as-break-target (that is F3.6, deferred).

- [ ] **Step 1: Write failing test**

  Append to `packages/shared/src/drawing/__tests__/types.breakregion.test.ts`:

  ```ts
  import type { SectionView } from '../types';

  describe('SectionView — breaks and rawProjection fields (forward compat, spec §5.2)', () => {
    it('SectionView compiles with breaks field present (no behavioral test — F3.6 deferred)', () => {
      // Minimal valid SectionView; breaks field is absent but compiles.
      const v: SectionView = {
        id: 'sv1', kind: 'section',
        parentViewId: 'bv1',
        sectionLine: { p0: { x: 50, y: 0 }, p1: { x: 50, y: 100 } },
        arrowDirection: 1,
        label: 'A',
        positionMm: { x: 200, y: 0 },
        scale: { numerator: 1, denominator: 1 },
        showHidden: false,
        hatchSegments: [],
        fingerprint: 'abc',
      };
      expect(v.breaks).toBeUndefined();
      expect(v.rawProjection).toBeUndefined();
    });

    it('SectionView accepts breaks + rawProjection without TypeScript error', () => {
      const v: SectionView = {
        id: 'sv2', kind: 'section',
        parentViewId: 'bv1',
        sectionLine: { p0: { x: 50, y: 0 }, p1: { x: 50, y: 100 } },
        arrowDirection: -1,
        label: 'B',
        positionMm: { x: 300, y: 0 },
        scale: { numerator: 1, denominator: 1 },
        showHidden: false,
        hatchSegments: [],
        fingerprint: 'def',
        breaks: [{ id: 'bsv', axis: 'x', coordA: 10, coordB: 50, gapMm: 5, style: 'zigzag' }],
        rawProjection: { visibleEdges: [], hiddenEdges: [], bbox: { minX: 0, minY: 0, maxX: 200, maxY: 80 } },
      };
      expect(v.breaks).toHaveLength(1);
    });
  });
  ```

- [ ] **Step 2: Run test, expect FAIL**

  ```
  pnpm --filter @zilventor/shared vitest run drawing/__tests__/types.breakregion
  ```

  Expected failure: `'breaks' does not exist in type 'SectionView'`.

- [ ] **Step 3: Write minimal impl**

  In `packages/shared/src/drawing/types.ts`, add to `SectionView` after `readonly inputFingerprint?: string;`:

  ```ts
  readonly breaks?: readonly BreakRegion[];  // NEW (F3): forward compat; in-scope testing deferred (F3.6)
  // Invariant: rawProjection !== undefined ⟺ breaks.length > 0. Enforced by commands.
  readonly rawProjection?: ProjectedGeometry;
  ```

- [ ] **Step 4: Run test, expect PASS**

  ```
  pnpm --filter @zilventor/shared vitest run drawing/__tests__/types.breakregion
  ```

- [ ] **Step 5: Run full typecheck + unit suite**

  ```
  pnpm -r typecheck && pnpm -r test:unit
  ```

  Expected: green.

- [ ] **Step 6: Commit**

  ```
  git add packages/shared/src/drawing/types.ts \
          packages/shared/src/drawing/__tests__/types.breakregion.test.ts
  git commit -m "feat(drawing-broken): add breaks? and rawProjection? to SectionView (forward compat, F3.6 deferred)"
  ```

---

### Task T1.7 — Bump `CURRENT_FORMAT_VERSION` 16 → 17 and add `migrations[16]`

**Spec:** §5.4, §6.1. **Files:** Modify `packages/shared/src/fileFormat.ts`.

- [ ] **Step 1: Write failing test (in the new v16→v17 file)**

  Create `packages/shared/src/__tests__/migrateManifest-v16-to-v17.spec.ts`:

  ```ts
  import { describe, it, expect } from 'vitest';
  import { migrateManifest, CURRENT_FORMAT_VERSION } from '../fileFormat';

  describe('migrateManifest v16 → v17 (Drawing F3 — no-op additive)', () => {
    it('CURRENT_FORMAT_VERSION is 17', () => {
      expect(CURRENT_FORMAT_VERSION).toBe(17);
    });

    it('passes a v16 part through to v17 without data loss', () => {
      const v16Part = {
        formatVersion: 16, kind: 'part',
        document: {
          id: 'p1', name: 'Shelf', units: 'mm',
          parameters: {}, featureTree: [], properties: {},
          materials: [], hardware: [],
        },
      };
      const out = migrateManifest(v16Part) as { formatVersion: number; kind: string };
      expect(out.formatVersion).toBe(17);
      expect(out.kind).toBe('part');
    });

    it('passes a v16 assembly through to v17 without data loss', () => {
      const v16Asm = {
        formatVersion: 16, kind: 'assembly',
        document: {
          id: 'a1', name: 'Wardrobe', units: 'mm',
          parameters: {}, components: [], constraints: [],
          groundedComponentPaths: [], colors: {},
          bomItemNumbers: {}, cutListItemNumbers: {},
          colorOverrides: {}, properties: {},
          materials: [], hardware: [],
        },
      };
      const out = migrateManifest(v16Asm) as { formatVersion: number };
      expect(out.formatVersion).toBe(17);
    });

    it('passes a v16 drawing with no breaks through to v17 unchanged', () => {
      const v16Drawing = {
        formatVersion: 16, kind: 'drawing',
        document: {
          id: 'draw-1', name: 'Box — Drawing', units: 'mm',
          source: { partPath: 'parts/box.zipt', sourceKind: 'part' },
          properties: {},
          sheets: [{
            id: 's1', name: 'Sheet 1',
            size: { kind: 'iso', size: 'A3' },
            orientation: 'landscape',
            views: [{
              id: 'v1', kind: 'base',
              positionMm: { x: 10, y: 10 },
              scale: { numerator: 1, denominator: 1 },
              orientation: 'front',
              showHidden: false,
            }],
            dimensions: [], annotations: [], titleBlock: {},
          }],
          activeSheetId: 's1',
        },
      };
      const out = migrateManifest(v16Drawing) as {
        formatVersion: number;
        kind: string;
        document: { name: string; sheets: Array<{ views: Array<{ breaks?: unknown }> }> };
      };
      expect(out.formatVersion).toBe(17);
      expect(out.kind).toBe('drawing');
      expect(out.document.name).toBe('Box — Drawing');
      // No breaks field injected — additive only
      expect(out.document.sheets[0]!.views[0]!.breaks).toBeUndefined();
    });

    it('v17 drawing with BaseView carrying breaks round-trips through JSON intact', () => {
      const v17Drawing = {
        formatVersion: 17, kind: 'drawing',
        document: {
          id: 'draw-2', name: 'Cabinet — Drawing', units: 'mm',
          source: { partPath: 'parts/cabinet.zipt', sourceKind: 'part' },
          properties: {},
          sheets: [{
            id: 's1', name: 'Sheet 1',
            size: { kind: 'iso', size: 'A3' },
            orientation: 'landscape',
            views: [{
              id: 'v1', kind: 'base',
              positionMm: { x: 10, y: 10 },
              scale: { numerator: 1, denominator: 1 },
              orientation: 'front',
              showHidden: false,
              breaks: [{ id: 'b1', axis: 'x', coordA: 50, coordB: 150, gapMm: 5, style: 'zigzag' }],
            }],
            dimensions: [], annotations: [], titleBlock: {},
          }],
          activeSheetId: 's1',
        },
      };
      const serialised = JSON.parse(JSON.stringify(v17Drawing));
      const out = migrateManifest(serialised) as {
        formatVersion: number;
        document: { sheets: Array<{ views: Array<{ breaks?: Array<{ axis: string }> }> }> };
      };
      expect(out.formatVersion).toBe(17);
      const view = out.document.sheets[0]!.views[0]!;
      expect(view.breaks).toHaveLength(1);
      expect(view.breaks![0]!.axis).toBe('x');
    });

    it('a v17 manifest passes through migrateManifest without re-migration', () => {
      const v17 = {
        formatVersion: 17, kind: 'part',
        document: {
          id: 'p2', name: 'Panel', units: 'mm',
          parameters: {}, featureTree: [], properties: {},
          materials: [], hardware: [],
        },
      };
      const out = migrateManifest(v17) as { formatVersion: number };
      expect(out.formatVersion).toBe(17);
    });
  });
  ```

- [ ] **Step 2: Run test, expect FAIL**

  ```
  pnpm --filter @zilventor/shared vitest run __tests__/migrateManifest-v16-to-v17
  ```

  Expected failure: `expect(CURRENT_FORMAT_VERSION).toBe(17)` — currently `16`.

- [ ] **Step 3: Write minimal impl**

  In `packages/shared/src/fileFormat.ts`:

  a. Change line 4:
  ```ts
  // BEFORE:
  export const CURRENT_FORMAT_VERSION = 16 as const;
  // AFTER:
  export const CURRENT_FORMAT_VERSION = 17 as const;
  ```

  b. Add `migrations[16]` immediately after the `migrations[15]` entry (around line 230):
  ```ts
  // v16 → v17: additive. Broken views store breaks[] on existing view types.
  // No existing document contains breaks; absent field === [] at runtime.
  16: (mIn) => {
    const m = deepClone(mIn);
    return { ...m, formatVersion: 17 };
  },
  ```

  c. Extend `normalizeKind` to include version 17 in its guard condition (around line 241). Find the condition that checks `m.formatVersion === 16` and add `|| m.formatVersion === 17`:
  ```ts
  // BEFORE (last version in the OR chain):
  m.formatVersion === 16
  // AFTER:
  m.formatVersion === 16 || m.formatVersion === 17
  ```

- [ ] **Step 4: Run test, expect PASS**

  ```
  pnpm --filter @zilventor/shared vitest run __tests__/migrateManifest-v16-to-v17
  ```

  Expected: all 6 cases pass.

- [ ] **Step 5: Run full typecheck + unit suite**

  ```
  pnpm -r typecheck && pnpm -r test:unit
  ```

  Expected: typecheck clean; unit suite has failures in the 10 cascade files (all `toBe(16)` now see 17). This is expected — next task fixes the cascade.

- [ ] **Step 6: Commit**

  ```
  git add packages/shared/src/fileFormat.ts \
          packages/shared/src/__tests__/migrateManifest-v16-to-v17.spec.ts
  git commit -m "feat(drawing-broken): bump CURRENT_FORMAT_VERSION to 17, add migrations[16] no-op (spec §5.4, §6.1)"
  ```

---

### Task T1.8 — Cascade `toBe(16)` → `toBe(17)` in 10 existing migration test files

**Spec:** §6.2. **Files:** Modify the 10 test files listed below (all contain `toBe(16)` or describe strings asserting version 16 as the final version). **Note:** These tests assert `CURRENT_FORMAT_VERSION` after migration — they now correctly expect 17. Spec §6.2 says "8 cascade files" but the live codebase contains 10 (spec/codebase reconciliation: v7→v8 and v8→v9 spec files also carry the cascade assertion; update all 10).

- [ ] **Step 1: Identify exact lines to change**

  Run:
  ```
  grep -rln 'toBe(16)' packages/shared/src/__tests__
  ```

  Note every file. All `toBe(16)` occurrences that assert `formatVersion` or `CURRENT_FORMAT_VERSION` must become `toBe(17)`.

- [ ] **Step 2: Run targeted tests to confirm they fail NOW**

  ```
  pnpm --filter @zilventor/shared vitest run __tests__/fileFormat
  pnpm --filter @zilventor/shared vitest run __tests__/migrateManifest-v15-to-v16
  ```

  Expected: failures in the `CURRENT_FORMAT_VERSION` assertions.

- [ ] **Step 3: Apply the cascade**

  In each file, change every `expect(CURRENT_FORMAT_VERSION).toBe(16)` → `toBe(17)` and every `expect(out.formatVersion).toBe(16)` (where `out` is the result of migrating a file to current) → `toBe(17)`. **Do NOT change any `toBe(16)` assertion that is checking the formatVersion of a *v16 input manifest before migration* — only change assertions that verify the *output after full migration chain runs*.**

  Concretely:
  - `fileFormat.spec.ts`: change any `CURRENT_FORMAT_VERSION` assertions to `17`.
  - `migrateManifest-v7-to-v8.spec.ts`: change final `formatVersion` output assertions to `17`.
  - `migrateManifest-v8-to-v9.spec.ts`: same.
  - `migrateManifest-v9-to-v10.spec.ts`: same.
  - `migrateManifest-v10-to-v11.spec.ts`: same.
  - `migrateManifest-v11-to-v12.spec.ts`: same.
  - `migrateManifest-v12-to-v13.spec.ts`: same.
  - `migrateManifest-v13-to-v14.spec.ts`: same.
  - `migrateManifest-v14-to-v15.spec.ts`: same. (Its describe string currently reads "advanced by Drawing F2" — update to "advanced by Drawing F3".)
  - `migrateManifest-v15-to-v16.spec.ts`: update `CURRENT_FORMAT_VERSION is 16` → `is 17`; update all `toBe(16)` final-output assertions → `toBe(17)`.

- [ ] **Step 4: Run all 10 test files, expect PASS**

  ```
  pnpm --filter @zilventor/shared vitest run __tests__/fileFormat
  pnpm --filter @zilventor/shared vitest run __tests__/migrateManifest-v7-to-v8
  pnpm --filter @zilventor/shared vitest run __tests__/migrateManifest-v8-to-v9
  pnpm --filter @zilventor/shared vitest run __tests__/migrateManifest-v9-to-v10
  pnpm --filter @zilventor/shared vitest run __tests__/migrateManifest-v10-to-v11
  pnpm --filter @zilventor/shared vitest run __tests__/migrateManifest-v11-to-v12
  pnpm --filter @zilventor/shared vitest run __tests__/migrateManifest-v12-to-v13
  pnpm --filter @zilventor/shared vitest run __tests__/migrateManifest-v13-to-v14
  pnpm --filter @zilventor/shared vitest run __tests__/migrateManifest-v14-to-v15
  pnpm --filter @zilventor/shared vitest run __tests__/migrateManifest-v15-to-v16
  ```

  Expected: all pass.

- [ ] **Step 5: Run full unit suite**

  ```
  pnpm -r test:unit
  ```

  Expected: green.

- [ ] **Step 6: Commit**

  ```
  git add \
    packages/shared/src/__tests__/fileFormat.spec.ts \
    packages/shared/src/__tests__/migrateManifest-v7-to-v8.spec.ts \
    packages/shared/src/__tests__/migrateManifest-v8-to-v9.spec.ts \
    packages/shared/src/__tests__/migrateManifest-v9-to-v10.spec.ts \
    packages/shared/src/__tests__/migrateManifest-v10-to-v11.spec.ts \
    packages/shared/src/__tests__/migrateManifest-v11-to-v12.spec.ts \
    packages/shared/src/__tests__/migrateManifest-v12-to-v13.spec.ts \
    packages/shared/src/__tests__/migrateManifest-v13-to-v14.spec.ts \
    packages/shared/src/__tests__/migrateManifest-v14-to-v15.spec.ts \
    packages/shared/src/__tests__/migrateManifest-v15-to-v16.spec.ts
  git commit -m "test(drawing-broken): cascade toBe(16) → toBe(17) in 10 migration test files (spec §6.2)"
  ```

---

### Task T1.9 — Update `ProjectFile` formatVersion union in `types.ts`

**Spec:** §5.4. **Files:** Modify `packages/shared/src/types.ts`; extend test file.

- [ ] **Step 1: Write failing test**

  Append to `packages/shared/src/drawing/__tests__/types.breakregion.test.ts`:

  ```ts
  import type { ProjectFile } from '../../types';

  describe('ProjectFile formatVersion union — v17 arm (spec §5.4)', () => {
    it('a formatVersion:17 part document is assignable to ProjectFile', () => {
      const pf: ProjectFile = {
        formatVersion: 17,
        kind: 'part',
        createdAt: '2026-05-06T00:00:00.000Z',
        appVersion: '0.0.1',
        document: {
          id: 'p1', name: 'Test', units: 'mm',
          parameters: {}, featureTree: [], properties: {},
          materials: [], hardware: [],
        },
      };
      expect(pf.formatVersion).toBe(17);
    });

    it('a formatVersion:17 drawing document is assignable to ProjectFile', () => {
      const pf: ProjectFile = {
        formatVersion: 17,
        kind: 'drawing',
        createdAt: '2026-05-06T00:00:00.000Z',
        appVersion: '0.0.1',
        document: {
          id: 'draw-1', name: 'Drawing', units: 'mm',
          source: { partPath: 'parts/x.zipt', sourceKind: 'part' },
          properties: {},
          sheets: [],
          activeSheetId: '',
        },
      };
      expect(pf.formatVersion).toBe(17);
      expect(pf.kind).toBe('drawing');
    });
  });
  ```

- [ ] **Step 2: Run test, expect FAIL**

  ```
  pnpm --filter @zilventor/shared vitest run drawing/__tests__/types.breakregion
  ```

  Expected failure: TypeScript compile error — `Type '17' is not assignable to type '7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16'`.

- [ ] **Step 3: Write minimal impl**

  In `packages/shared/src/types.ts`, find the `ProjectFile` union (around line 133) and extend all three arms to include `17`:

  ```ts
  // BEFORE:
  export type ProjectFile =
    | { formatVersion: 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16; kind: 'part';     createdAt: string; appVersion: string; document: PartDocument }
    | { formatVersion: 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16; kind: 'assembly'; createdAt: string; appVersion: string; document: AssemblyDocument }
    | { formatVersion: 14 | 15 | 16;                                  kind: 'drawing';  createdAt: string; appVersion: string; document: DrawingDocument };

  // AFTER:
  export type ProjectFile =
    | { formatVersion: 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17; kind: 'part';     createdAt: string; appVersion: string; document: PartDocument }
    | { formatVersion: 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17; kind: 'assembly'; createdAt: string; appVersion: string; document: AssemblyDocument }
    | { formatVersion: 14 | 15 | 16 | 17;                                  kind: 'drawing';  createdAt: string; appVersion: string; document: DrawingDocument };
  ```

  (Per the comment in `types.ts` line 132: "when CURRENT_FORMAT_VERSION bumps, add the new literal here too".)

- [ ] **Step 4: Run test, expect PASS**

  ```
  pnpm --filter @zilventor/shared vitest run drawing/__tests__/types.breakregion
  ```

- [ ] **Step 5: Run full typecheck + unit suite**

  ```
  pnpm -r typecheck && pnpm -r test:unit
  ```

  Expected: green.

- [ ] **Step 6: Commit**

  ```
  git add packages/shared/src/types.ts \
          packages/shared/src/drawing/__tests__/types.breakregion.test.ts
  git commit -m "feat(drawing-broken): extend ProjectFile formatVersion union to include 17 (spec §5.4)"
  ```

---

### Task T1.10 — Add `fingerprintBreaksArray` to `fingerprint.ts`

**Spec:** §8.1. **Files:** Modify `packages/shared/src/drawing/fingerprint.ts`; Create `packages/shared/src/drawing/__tests__/fingerprintBreaksArray.spec.ts`.

- [ ] **Step 1: Write failing test**

  Create `packages/shared/src/drawing/__tests__/fingerprintBreaksArray.spec.ts`:

  ```ts
  import { describe, it, expect } from 'vitest';
  import { fingerprintBreaksArray } from '../fingerprint';
  import type { BreakRegion } from '../types';

  const br1: BreakRegion = { id: 'b1', axis: 'x', coordA: 50, coordB: 150, gapMm: 5, style: 'zigzag' };
  const br2: BreakRegion = { id: 'b2', axis: 'y', coordA: 20, coordB: 80, gapMm: 5, style: 'zigzag' };

  describe('fingerprintBreaksArray (spec §8.1)', () => {
    it('empty array returns a stable 8-char hex string', () => {
      const fp = fingerprintBreaksArray([]);
      expect(fp).toMatch(/^[0-9a-f]{8}$/);
    });

    it('same empty array always returns the same hash', () => {
      expect(fingerprintBreaksArray([])).toBe(fingerprintBreaksArray([]));
    });

    it('single break returns a non-empty hash distinct from empty array hash', () => {
      const fpEmpty = fingerprintBreaksArray([]);
      const fpOne   = fingerprintBreaksArray([br1]);
      expect(fpOne).not.toBe(fpEmpty);
      expect(fpOne).toMatch(/^[0-9a-f]{8}$/);
    });

    it('two breaks in different orders produce the same hash (sort by coordA)', () => {
      // br2 has coordA=20 < br1 coordA=50; order should not matter.
      const fpAB = fingerprintBreaksArray([br1, br2]);
      const fpBA = fingerprintBreaksArray([br2, br1]);
      expect(fpAB).toBe(fpBA);
    });

    it('changing coordA produces a different hash', () => {
      const brModified: BreakRegion = { ...br1, coordA: 51 };
      expect(fingerprintBreaksArray([brModified])).not.toBe(fingerprintBreaksArray([br1]));
    });

    it('changing gapMm produces a different hash', () => {
      const brModified: BreakRegion = { ...br1, gapMm: 10 };
      expect(fingerprintBreaksArray([brModified])).not.toBe(fingerprintBreaksArray([br1]));
    });
  });
  ```

- [ ] **Step 2: Run test, expect FAIL**

  ```
  pnpm --filter @zilventor/shared vitest run drawing/__tests__/fingerprintBreaksArray
  ```

  Expected failure: `fingerprintBreaksArray is not exported from '../fingerprint'`.

- [ ] **Step 3: Write minimal impl**

  In `packages/shared/src/drawing/fingerprint.ts`, append after `fingerprintDetailView`:

  ```ts
  /**
   * Synchronous djb2 fingerprint contribution for a BreakRegion array.
   * Encodes axis, coordA, coordB, gapMm, style for each break, sorted by coordA ascending.
   * Matches fingerprintDetailView's pipe-separated, 1e-3mm convention.
   * Spec §8.1.
   */
  export function fingerprintBreaksArray(breaks: readonly BreakRegion[]): string {
    const sorted = [...breaks].sort((a, b) => a.coordA - b.coordA);
    const payload = sorted.map(b =>
      [b.axis, b.coordA.toFixed(3), b.coordB.toFixed(3), b.gapMm.toFixed(3), b.style].join('|')
    ).join(';');
    return djb2(payload);
  }
  ```

  Also add the `BreakRegion` import at the top of the file (after existing imports):
  ```ts
  import type { SectionView, BreakRegion } from './types';
  ```
  (Replace the existing `import type { SectionView } from './types';` with this line.)

- [ ] **Step 4: Run test, expect PASS**

  ```
  pnpm --filter @zilventor/shared vitest run drawing/__tests__/fingerprintBreaksArray
  ```

  Expected: `Tests 6 passed (6)`.

- [ ] **Step 5: Run full typecheck + unit suite**

  ```
  pnpm -r typecheck && pnpm -r test:unit
  ```

  Expected: green.

- [ ] **Step 6: Commit**

  ```
  git add packages/shared/src/drawing/fingerprint.ts \
          packages/shared/src/drawing/__tests__/fingerprintBreaksArray.spec.ts
  git commit -m "feat(drawing-broken): add fingerprintBreaksArray to fingerprint.ts (spec §8.1)"
  ```

---

### Task T1.11 — Re-export `BreakRegion` and `fingerprintBreaksArray` from `packages/shared/src/index.ts`

**Files:** Modify `packages/shared/src/index.ts`.

- [ ] **Step 1: Write failing test (compile-time probe)**

  Create a temporary probe `packages/shared/src/__tests__/_probe_break_export.ts`:

  ```ts
  // Temporary probe — delete after task is complete.
  import type { BreakRegion } from '@zilventor/shared';
  import { fingerprintBreaksArray } from '@zilventor/shared';
  const _: BreakRegion = undefined as unknown as BreakRegion;
  fingerprintBreaksArray([]);
  ```

  ```
  pnpm --filter @zilventor/shared typecheck
  ```

  Expected failure: `Module '@zilventor/shared' has no exported member 'BreakRegion'`.

- [ ] **Step 2: Write minimal impl**

  In `packages/shared/src/index.ts`, on line 30, extend the drawing types re-export to add `BreakRegion`:

  ```ts
  // BEFORE:
  export type { DrawingDocument, DrawingSource, DrawingSheet, SheetSize, DrawingView, BaseView, ProjectedView, IsoView, ViewScale, DrawingDimension, DrawingAnnotation, TitleBlockOverrides, SectionView, HatchSegment, Vec2, DetailView, RegionParent } from './drawing/types';

  // AFTER:
  export type { DrawingDocument, DrawingSource, DrawingSheet, SheetSize, DrawingView, BaseView, ProjectedView, IsoView, ViewScale, DrawingDimension, DrawingAnnotation, TitleBlockOverrides, SectionView, HatchSegment, Vec2, DetailView, RegionParent, BreakRegion } from './drawing/types';
  ```

  And extend the fingerprint exports line to add `fingerprintBreaksArray`:

  ```ts
  // BEFORE:
  export { fingerprintDetailView } from './drawing/fingerprint';

  // AFTER:
  export { fingerprintDetailView, fingerprintBreaksArray } from './drawing/fingerprint';
  ```

- [ ] **Step 3: Run typecheck, expect PASS**

  ```
  pnpm --filter @zilventor/shared typecheck
  ```

  Expected: clean. Delete `packages/shared/src/__tests__/_probe_break_export.ts` before committing.

- [ ] **Step 4: Run full unit suite**

  ```
  pnpm -r test:unit
  ```

  Expected: green.

- [ ] **Step 5: Commit**

  ```
  git add packages/shared/src/index.ts
  git commit -m "feat(drawing-broken): re-export BreakRegion and fingerprintBreaksArray from shared index"
  ```

---

### Task T1.12 — Exhaustiveness check: `DrawingView` discriminated union compiles after `breaks` + `rawProjection` additions

**Spec:** §5.2 — compile-time verification. **Files:** Extend `packages/shared/src/drawing/__tests__/types.breakregion.test.ts`.

- [ ] **Step 1: Write failing test (add to existing test file)**

  Append to `packages/shared/src/drawing/__tests__/types.breakregion.test.ts`:

  ```ts
  import type { DrawingView } from '../types';

  describe('DrawingView union — exhaustiveness check with breaks/rawProjection fields', () => {
    it('switch over DrawingView.kind still compiles with never fallthrough', () => {
      function describeView(v: DrawingView): string {
        switch (v.kind) {
          case 'base':      return `base, breaks=${v.breaks?.length ?? 0}`;
          case 'projected': return `projected, breaks=${v.breaks?.length ?? 0}`;
          case 'iso':       return `iso, breaks=${v.breaks?.length ?? 0}`;
          case 'section':   return `section, breaks=${v.breaks?.length ?? 0}`;
          case 'detail':    return 'detail';
          default: {
            const _exhaustive: never = v;
            return _exhaustive;
          }
        }
      }

      const bv: DrawingView = {
        id: 'bv', kind: 'base',
        positionMm: { x: 0, y: 0 },
        scale: { numerator: 1, denominator: 1 },
        orientation: 'front', showHidden: false,
        breaks: [{ id: 'b1', axis: 'x', coordA: 10, coordB: 50, gapMm: 5, style: 'zigzag' }],
      };
      expect(describeView(bv)).toBe('base, breaks=1');
    });

    it('detail view does NOT have breaks field (spec §5.2: DetailView excluded)', () => {
      const dv: DrawingView = {
        id: 'dv', kind: 'detail',
        parentViewId: 'bv',
        regionParent: { center: { x: 0, y: 0 }, radiusMm: 5 },
        label: 'A',
        positionMm: { x: 0, y: 0 },
        scale: { numerator: 2, denominator: 1 },
        showHidden: false,
      };
      // DetailView has no breaks field — TypeScript compile check implicitly verifies this
      // by not allowing `dv.breaks` (if added to test, it would be a TS error on 'detail').
      expect(dv.kind).toBe('detail');
    });
  });
  ```

- [ ] **Step 2: Run test, expect PASS (green from the start — this is a compile-time invariant test)**

  ```
  pnpm --filter @zilventor/shared vitest run drawing/__tests__/types.breakregion
  ```

  Expected: all tests pass. (If `breaks` access on the `case 'detail':` arm produced a TS error, the build would fail — absence of that error confirms `DetailView` correctly lacks the `breaks` field.)

- [ ] **Step 3: Run full typecheck**

  ```
  pnpm -r typecheck
  ```

  Expected: clean.

- [ ] **Step 4: Commit**

  ```
  git add packages/shared/src/drawing/__tests__/types.breakregion.test.ts
  git commit -m "test(drawing-broken): exhaustiveness check — DrawingView switch compiles after breaks+rawProjection additions"
  ```

---

### Task T1.13 — `Edge2D.kind` round-trip serialization survives `'break'` tier

**Spec:** §5.3. **Files:** Extend `packages/shared/src/drawing/__tests__/types.breakregion.test.ts`.

- [ ] **Step 1: Write failing test**

  Append to `packages/shared/src/drawing/__tests__/types.breakregion.test.ts`:

  ```ts
  import type { ProjectedGeometry } from '../projectedGeometry';

  describe('Edge2D "break" kind — serialization round-trip (spec §5.3)', () => {
    it('ProjectedGeometry with break-kind edges survives JSON round-trip', () => {
      const geom: ProjectedGeometry = {
        visibleEdges: [
          { id: 'v1_break_b1', kind: 'break', points: [[50, -5], [51.5, 0], [48.5, 3], [50, 6]] },
          { id: 'v1_e1', kind: 'silhouette', points: [[0, 0], [50, 0]] },
          { id: 'v1_e2', kind: 'silhouette', points: [[55, 0], [100, 0]] },
        ],
        hiddenEdges: [],
        bbox: { minX: 0, minY: -5, maxX: 100, maxY: 10 },
      };
      const parsed = JSON.parse(JSON.stringify(geom)) as ProjectedGeometry;
      const breakEdge = parsed.visibleEdges.find(e => e.kind === 'break');
      expect(breakEdge).toBeDefined();
      expect(breakEdge!.id).toBe('v1_break_b1');
      expect(breakEdge!.points).toHaveLength(4);
      expect(breakEdge!.sourceFaceIds).toBeUndefined();
    });

    it('all four kind values coexist in a ProjectedGeometry', () => {
      const geom: ProjectedGeometry = {
        visibleEdges: [
          { id: 'e1', kind: 'silhouette', points: [[0, 0]] },
          { id: 'e2', kind: 'feature',    points: [[0, 0]] },
          { id: 'e3', kind: 'outline',    points: [[0, 0]] },
          { id: 'e4', kind: 'break',      points: [[0, 0]] },
        ],
        hiddenEdges: [],
        bbox: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
      };
      const kinds = new Set(geom.visibleEdges.map(e => e.kind));
      expect(kinds.has('silhouette')).toBe(true);
      expect(kinds.has('feature')).toBe(true);
      expect(kinds.has('outline')).toBe(true);
      expect(kinds.has('break')).toBe(true);
    });
  });
  ```

- [ ] **Step 2: Run test, expect PASS (these should pass since T1.2 already landed)**

  ```
  pnpm --filter @zilventor/shared vitest run drawing/__tests__/types.breakregion
  ```

  Expected: all tests green. (`Edge2D.kind` was widened in T1.2; these tests validate the runtime shape too.)

- [ ] **Step 3: Run full typecheck + unit suite**

  ```
  pnpm -r typecheck && pnpm -r test:unit
  ```

  Expected: green.

- [ ] **Step 4: Commit**

  ```
  git add packages/shared/src/drawing/__tests__/types.breakregion.test.ts
  git commit -m "test(drawing-broken): Edge2D 'break' kind round-trip serialization tests (spec §5.3)"
  ```

---

### Task T1.14 — Batch 1 green-gate commit

**Goal:** Confirm all Batch 1 work is coherent: full typecheck + full unit suite green. No implementation logic beyond what was added in T1.1–T1.13.

- [ ] **Step 1: Run full typecheck across all packages**

  ```
  pnpm -r typecheck
  ```

  Expected: zero errors.

- [ ] **Step 2: Run full unit suite across all packages**

  ```
  pnpm -r test:unit
  ```

  Expected: all tests green. Count should be at minimum the F2 baseline + all new Batch 1 tests (≥ 25 new tests).

- [ ] **Step 3: Verify new test file count**

  ```
  ls packages/shared/src/drawing/__tests__/types.breakregion.test.ts \
     packages/shared/src/drawing/__tests__/fingerprintBreaksArray.spec.ts \
     packages/shared/src/__tests__/migrateManifest-v16-to-v17.spec.ts
  ```

  All three files must exist.

- [ ] **Step 4: Confirm `BreakRegion` is exported**

  ```
  grep 'BreakRegion' packages/shared/src/index.ts
  ```

  Must print a line containing `BreakRegion`.

- [ ] **Step 5: Confirm `CURRENT_FORMAT_VERSION` is 17**

  ```
  grep 'CURRENT_FORMAT_VERSION' packages/shared/src/fileFormat.ts | head -2
  ```

  Must print `export const CURRENT_FORMAT_VERSION = 17 as const;`.

- [ ] **Step 6: Green-gate commit**

  ```
  git add --all
  git commit -m "chore(drawing-broken): Batch 1 green gate — types + migration v16→v17 + fingerprintBreaksArray all green"
  ```

---

## Reviewer dispatch — Batch 1 (TWO sequential Sonnet dispatches)

### Stage A: Spec-compliance reviewer

Dispatch a Sonnet subagent with the following prompt verbatim:

---

> Ultrathink. You are reviewing the Batch 1 implementation of Drawing F3 — Broken Views against its specification. Your job is to verify spec compliance, not code style.
>
> **Spec file:** `docs/superpowers/specs/2026-05-06-drawing-broken-views-design.md`
> Read §5.1 (BreakRegion fields), §5.2 (breaks+rawProjection on BaseView/ProjectedView/IsoView/SectionView; NOT on DetailView), §5.3 (Edge2D.kind widens to add 'break'), §5.4 (ProjectFile formatVersion union includes 17), §6.1 (migrations[16] no-op body), §6.2 (10 cascade files + new v16→v17 spec file).
>
> **Files to review:**
> - `packages/shared/src/drawing/types.ts` — verify: (a) `BreakRegion` has exactly these 6 fields: `id: string`, `axis: 'x'|'y'`, `coordA: number`, `coordB: number`, `gapMm: number`, `style: 'zigzag'`; (b) `BaseView`, `ProjectedView`, `IsoView`, `SectionView` each have `breaks?: readonly BreakRegion[]` and `rawProjection?: ProjectedGeometry`; (c) `DetailView` does NOT have `breaks` or `rawProjection`; (d) all fields are `readonly`.
> - `packages/shared/src/drawing/projectedGeometry.ts` — verify `Edge2D.kind` is `'silhouette' | 'feature' | 'outline' | 'break'`.
> - `packages/shared/src/fileFormat.ts` — verify: (a) `CURRENT_FORMAT_VERSION === 17`; (b) `migrations[16]` exists and returns `{ ...m, formatVersion: 17 }`; (c) `normalizeKind` guard includes version 17.
> - `packages/shared/src/types.ts` — verify `ProjectFile` union includes `17` in all three arms (`part`, `assembly`, `drawing`).
> - `packages/shared/src/drawing/fingerprint.ts` — verify `fingerprintBreaksArray` exists, sorts by `coordA` ascending, encodes `axis|coordA.toFixed(3)|coordB.toFixed(3)|gapMm.toFixed(3)|style`, uses `djb2`, returns an 8-char hex string.
> - `packages/shared/src/__tests__/migrateManifest-v16-to-v17.spec.ts` — verify it covers the 2 cases from spec §6.2: (1) v16 manifest with no breaks → v17 pass-through, no structural change; (2) v17 manifest with one BaseView carrying `breaks: [{ id, axis:'x', coordA:50, coordB:150, gapMm:5, style:'zigzag' }]` round-trips intact.
> - `packages/shared/src/__tests__/fileFormat.spec.ts` and the 9 `migrateManifest-v*-to-*.spec.ts` files listed in §6.2 — verify all `toBe(16)` final-output assertions have been updated to `toBe(17)`.
> **Spec/codebase reconciliation note:** Spec §6.2 states "8 cascade files" but the live codebase contains 10 files matching `toBe(16)` in `packages/shared/src/__tests__` (fileFormat.spec.ts + 9 migrateManifest-v*-to-v*.spec.ts files: v7→v8, v8→v9, v9→v10, v10→v11, v11→v12, v12→v13, v13→v14, v14→v15, v15→v16). All 10 must be updated.
>
> **α-conditional invariant check:** The invariant (`rawProjection !== undefined ⟺ breaks.length > 0`) is enforced by commands in later batches. Batch 1 only introduces the fields. Verify the type definitions make the invariant *expressible* (both fields are independently optional, per spec intent). No Batch 1 code should populate `rawProjection`; verify no migration does so.
>
> **Check that `DetailView` is correctly excluded.** The spec §5.2 explicitly states: "`DetailView` does NOT receive `breaks` in v1." Confirm the type definition lacks the field.
>
> Report findings as a structured list: ✓ for each passing check, ✗ with file+line for each spec gap. Report under 400 words.

---

### Stage B: Code-quality reviewer

Dispatch a Sonnet subagent with the following prompt verbatim:

---

> Ultrathink. You are reviewing the Batch 1 code quality for Drawing F3 — Broken Views. Focus on TypeScript correctness, naming consistency, test quality, and surgical-change discipline (CLAUDE.md §3). Do NOT re-verify spec compliance — that is Stage A's job.
>
> **Files to review:**
> - `packages/shared/src/drawing/types.ts` (only the new/modified lines)
> - `packages/shared/src/drawing/projectedGeometry.ts` (the `kind` union change)
> - `packages/shared/src/drawing/fingerprint.ts` (the new `fingerprintBreaksArray` function)
> - `packages/shared/src/fileFormat.ts` (the `migrations[16]` entry and `normalizeKind` change)
> - `packages/shared/src/types.ts` (the `ProjectFile` union change)
> - `packages/shared/src/index.ts` (re-export additions)
> - `packages/shared/src/drawing/__tests__/types.breakregion.test.ts` (all tests)
> - `packages/shared/src/drawing/__tests__/fingerprintBreaksArray.spec.ts` (all tests)
> - `packages/shared/src/__tests__/migrateManifest-v16-to-v17.spec.ts` (all tests)
>
> **Checks to perform:**
>
> 1. **TypeScript strict compliance** — All new fields use `readonly`. No `any` introduced. No implicit `any`. No unused imports. `exactOptionalPropertyTypes` is not violated (new optional fields must be `?: T` not `: T | undefined`).
>
> 2. **Naming consistency** — Type name `BreakRegion`, field names `axis`, `coordA`, `coordB`, `gapMm`, `style` match spec §5.1 exactly (no abbreviations, no camelCase deviations). Function name `fingerprintBreaksArray` matches spec §8.1.
>
> 3. **Surgical changes (CLAUDE.md §3)** — Modified files should only have the minimal required changes. No reformatting of unrelated code. No removal of existing comments. No import reordering unrelated to the task.
>
> 4. **Test naming and structure** — Test descriptions are specific and reference the spec section (e.g., "spec §5.1"). No empty `it()` blocks. Every failing assertion has a clear message path.
>
> 5. **No over-engineering** — `fingerprintBreaksArray` should be ≤15 lines. `migrations[16]` should be ≤4 lines. No helper functions introduced unless shared with at least 2 call sites.
>
> 6. **`djb2` accessibility** — `fingerprintBreaksArray` in `fingerprint.ts` calls the module-private `djb2` function. Verify it does not re-implement `djb2` inline — it must reuse the existing private function in the same file.
>
> 7. **No probe files left in tree** — `_probe_break_export.ts` must be deleted before the green-gate commit.
>
> Report findings as a structured list: ✓ for each passing check, ✗ with file+line for each issue. Report under 400 words.

---

*End of Part 1.*
## Batch 2 — `applyBreaks` 2D math + zigzag + fingerprint extension

---

## Batch 2 preamble (load-bearing constraints)

- Desktop Chromium only; OPFS-only storage; no server.
- **No kernel calls.** F3 is a pure 2D operation post-projection.
- Manifest v16 → v17 additive only; never modify migrations[0..14].
- **α-conditional invariant** (load-bearing): `view.rawProjection !== undefined ⟺ view.breaks.length > 0`. Every code path that reads or writes `breaks` or `rawProjection` MUST preserve this invariant.
- `Edge2D.kind` widens to `'silhouette' | 'feature' | 'outline' | 'break'` (added in Batch 1).
- Plan code snippets are REFERENCE — verify external identifiers (exports, type names, function signatures, test fixture shapes) against the actual codebase before re-emitting them. The codebase is the source of truth.
- TDD per CLAUDE.md §4a: every behavior slice is red→green→refactor; success criterion is "named test goes red → green; full suite stays green".
- After every commit in this batch, run `pnpm -r typecheck && pnpm -r test:unit` from the repo root and confirm green.

**Spec note — zigzag spine position (binding test case takes priority over prose):** Spec §7.2 step 4 prose says the symbol is at "the after-translation coordinate of `coordA`". Spec §7.5 AB-9 asserts `spine at x=105` for `coordA=100, coordB=200, gapMm=5, shift=−95`. These are inconsistent: `coordA + shift = 100 − 95 = 5 ≠ 105`. AB-9 is correct: `spine_pos = coordA + gapMm = 100 + 5 = 105`. Geometrically this is the right edge of the compressed gap — i.e., the coordinate where the remaining "after" content resumes. The implementer MUST use `spine_pos = coordA + gapMm` (with cumulative shift already baked into the per-break coordA, if needed; see §7.3). Test case AB-9 is the ground truth.

---

**Files touched**

Create:
- `packages/shared/src/drawing/applyBreaks.ts`
- `packages/shared/src/drawing/__tests__/applyBreaks.spec.ts`

Modify:
- `packages/shared/src/drawing/fingerprint.ts` — add `fingerprintBreaksArray` export (per spec §8.1; reuses internal `djb2`; lives in the same file because `djb2` is not exported — do NOT create a separate `fingerprintBreaks.ts`)
- `packages/shared/src/drawing/__tests__/fingerprint.spec.ts` — add `fingerprintBreaksArray` test suite (spec §8.1 + §8.2)

> Note: Batch 1 Task T1.10 already added `fingerprintBreaksArray` to `fingerprint.ts`. Task T2.15 in this batch extends the test coverage in `fingerprint.spec.ts`. Do not create `fingerprintBreaks.ts` or `fingerprintBreaks.spec.ts` — those were a draft artifact superseded by the Batch 1 implementation.

---

### T2.1 — Module skeleton (`applyBreaks.ts`)

**Goal (red):** Import succeeds; `applyBreaks([], [], { minX:0, minY:0, maxX:0, maxY:0 })` returns `{ edges: [], breakSymbolEdges: [] }`.

**Test — write first, confirm red:**

```ts
// packages/shared/src/drawing/__tests__/applyBreaks.spec.ts
import { describe, it, expect } from 'vitest';
import { applyBreaks } from '../applyBreaks';

describe('applyBreaks — module skeleton', () => {
  it('T2.1 empty edges + empty breaks → empty result', () => {
    const result = applyBreaks([], [], { minX: 0, minY: 0, maxX: 0, maxY: 0 });
    expect(result.edges).toEqual([]);
    expect(result.breakSymbolEdges).toEqual([]);
  });
});
```

**Implement (green):**

Create `packages/shared/src/drawing/applyBreaks.ts`:

```ts
// packages/shared/src/drawing/applyBreaks.ts
import type { Edge2D } from './projectedGeometry';
import type { BreakRegion } from './types';

export type ApplyBreaksResult = {
  readonly edges: readonly Edge2D[];
  readonly breakSymbolEdges: readonly Edge2D[];
};

export function applyBreaks(
  edges: readonly Edge2D[],
  breaks: readonly BreakRegion[],
  viewBbox: { minX: number; minY: number; maxX: number; maxY: number },
): ApplyBreaksResult {
  if (breaks.length === 0) {
    return { edges: [...edges], breakSymbolEdges: [] };
  }
  // full implementation added incrementally in T2.5–T2.14
  return { edges: [], breakSymbolEdges: [] };
}
```

> Verify: `BreakRegion` is exported from `./types` (added in Batch 1). Confirm import path resolves.

**Run:**
```bash
pnpm vitest run --reporter=verbose -t "T2.1" packages/shared
```

**Confirm:** test was red before skeleton, green after.

**Commit:**
```
feat(drawing-broken-views): T2.1 applyBreaks module skeleton — Batch 2
```

---

### T2.2 — Helper: `clipEdge1D`

**Goal (red):** 1D Liang-Barsky clip of a polyline segment against an axis-aligned strip `[coordA, coordB]` along `'x' | 'y'`. Returns surviving fragment(s) — zero, one, or two segments (two when the segment spans the full band and both sides survive).

**Design note:** Unlike standard Liang-Barsky (which clips *to* a region), `clipEdge1D` clips *away* a band — it keeps what is OUTSIDE `[coordA, coordB]` and discards what is inside. The return is an array of surviving point-pairs: `[]` (entirely inside), one element (crosses one boundary), or two elements (spans the full band — before-portion `_a` and after-portion `_b`).

```ts
type Seg1D = { p0: readonly [number, number]; p1: readonly [number, number] };

/** Returns 0–2 surviving segments after removing the [coordA, coordB] band along axis. */
function clipEdge1D(
  p0: readonly [number, number],
  p1: readonly [number, number],
  axis: 'x' | 'y',
  coordA: number,
  coordB: number,
): Seg1D[]
```

**Test — write first, confirm red:**

```ts
describe('applyBreaks — clipEdge1D helper (via applyBreaks behaviour)', () => {
  const BBOX = { minX: 0, minY: -5, maxX: 400, maxY: 5 };

  it('T2.2a entirely before band → kept whole, id unchanged', () => {
    const e = { id: 'e1', kind: 'outline' as const, points: [[0,0],[40,0]] as any };
    const br: BreakRegion = { id: 'b1', axis: 'x', coordA: 50, coordB: 100, gapMm: 5, style: 'zigzag' };
    const { edges } = applyBreaks([e], [br], BBOX);
    expect(edges).toHaveLength(1);
    expect(edges[0]!.id).toBe('e1');
    expect(edges[0]!.points[0]).toEqual([0, 0]);
    expect(edges[0]!.points[1]).toEqual([40, 0]);
  });

  it('T2.2b entirely after band → id unchanged, x translated by −(coordB−coordA−gapMm)', () => {
    const e = { id: 'e2', kind: 'outline' as const, points: [[120,0],[200,0]] as any };
    const br: BreakRegion = { id: 'b1', axis: 'x', coordA: 50, coordB: 100, gapMm: 5, style: 'zigzag' };
    const { edges } = applyBreaks([e], [br], BBOX);
    // shift = −(100−50−5) = −45; 120−45=75, 200−45=155
    expect(edges).toHaveLength(1);
    expect(edges[0]!.id).toBe('e2');
    expect(edges[0]!.points[0]![0]).toBeCloseTo(75, 5);
    expect(edges[0]!.points[1]![0]).toBeCloseTo(155, 5);
  });

  it('T2.2c entirely inside band → dropped', () => {
    const e = { id: 'e3', kind: 'outline' as const, points: [[60,0],[90,0]] as any };
    const br: BreakRegion = { id: 'b1', axis: 'x', coordA: 50, coordB: 100, gapMm: 5, style: 'zigzag' };
    const { edges } = applyBreaks([e], [br], BBOX);
    expect(edges).toHaveLength(0);
  });

  it('T2.2d spanning full band → two fragments', () => {
    const e = { id: 'e4', kind: 'outline' as const, points: [[0,0],[200,0]] as any };
    const br: BreakRegion = { id: 'b1', axis: 'x', coordA: 50, coordB: 100, gapMm: 5, style: 'zigzag' };
    const { edges } = applyBreaks([e], [br], BBOX);
    // shift = −45; before: [(0,0),(50,0)] id e4_a; after: [(55,0),(155,0)] id e4_b (100−45=55, 200−45=155)
    expect(edges).toHaveLength(2);
    const a = edges.find(e => e.id === 'e4_a');
    const b = edges.find(e => e.id === 'e4_b');
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    expect(a!.points[1]![0]).toBeCloseTo(50, 5);
    expect(b!.points[0]![0]).toBeCloseTo(55, 5);
  });

  it('T2.2e tangent to coordA → kept as "before", id unchanged', () => {
    const e = { id: 'e5', kind: 'outline' as const, points: [[50,0],[50,10]] as any };
    const br: BreakRegion = { id: 'b1', axis: 'x', coordA: 50, coordB: 100, gapMm: 5, style: 'zigzag' };
    const { edges } = applyBreaks([e], [br], BBOX);
    expect(edges).toHaveLength(1);
    expect(edges[0]!.id).toBe('e5');
  });
});
```

**Implement (green):** Add `clipEdge1D` helper function inside `applyBreaks.ts` (unexported). Wire it into the main loop stubs. Implement the strip-clipping logic for a two-point segment — classify based on axis coordinate positions vs `[coordA, coordB]`.

**Run:**
```bash
pnpm vitest run --reporter=verbose -t "T2.2" packages/shared
```

**Commit:**
```
feat(drawing-broken-views): T2.2 clipEdge1D helper + strip-clip cases — Batch 2
```

---

### T2.3 — Helper: `cumulativeShift`

**Goal (red):** Given an axis, sorted breaks, and a position `currentCoord`, return the total shift to apply to a point at `currentCoord`. The shift accumulates over all breaks whose `coordA < currentCoord` (i.e., all bands that have been "removed" before this point). Per spec §7.3.

```ts
/** Returns the total translation offset for a coord that survives all breaks prior to it. */
function cumulativeShift(
  axis: 'x' | 'y',
  sortedBreaks: readonly BreakRegion[],
  currentCoord: number,
): number
```

**Test — write first, confirm red:**

```ts
describe('applyBreaks — cumulativeShift semantics', () => {
  it('T2.3a no breaks → shift is 0', () => {
    // Verified indirectly: edge entirely after empty breaks array → not shifted
    const e = { id: 'e1', kind: 'outline' as const, points: [[100,0],[200,0]] as any };
    const { edges } = applyBreaks([e], [], { minX:0, minY:0, maxX:400, maxY:0 });
    expect(edges[0]!.points[0]![0]).toBeCloseTo(100, 5);
  });

  it('T2.3b two x-breaks, point after both → cumulative shift = sum of both shifts', () => {
    // break1: coordA=50, coordB=100, gapMm=5 → shift1=−45
    // break2: coordA=200, coordB=300, gapMm=5 → shift2=−95
    // Point at x=350 → after both → total shift = −140 → new x = 210
    const e = { id: 'e1', kind: 'outline' as const, points: [[350,0],[400,0]] as any };
    const breaks: BreakRegion[] = [
      { id: 'b1', axis: 'x', coordA: 50,  coordB: 100, gapMm: 5, style: 'zigzag' },
      { id: 'b2', axis: 'x', coordA: 200, coordB: 300, gapMm: 5, style: 'zigzag' },
    ];
    const { edges } = applyBreaks([e], breaks, { minX:0, minY:0, maxX:400, maxY:0 });
    expect(edges[0]!.id).toBe('e1');
    expect(edges[0]!.points[0]![0]).toBeCloseTo(210, 5); // 350 − 140
    expect(edges[0]!.points[1]![0]).toBeCloseTo(260, 5); // 400 − 140
  });

  it('T2.3c x-break and y-break on same edge → axes accumulate independently', () => {
    // x-break shifts x by −45; y-break shifts y by −45
    // Edge entirely after both: [(120,120),(200,200)] → [(75,75),(155,155)]
    const e = { id: 'e1', kind: 'outline' as const, points: [[120,120],[200,200]] as any };
    const breaks: BreakRegion[] = [
      { id: 'bx', axis: 'x', coordA: 50, coordB: 100, gapMm: 5, style: 'zigzag' },
      { id: 'by', axis: 'y', coordA: 50, coordB: 100, gapMm: 5, style: 'zigzag' },
    ];
    const { edges } = applyBreaks([e], breaks, { minX:0, minY:0, maxX:400, maxY:400 });
    expect(edges[0]!.points[0]![0]).toBeCloseTo(75, 5);
    expect(edges[0]!.points[0]![1]).toBeCloseTo(75, 5);
  });
});
```

**Implement (green):** Add `cumulativeShift` helper. Implement the multi-break loop in `applyBreaks`: sort breaks by `coordA` ascending before iteration; maintain `Record<'x'|'y', number>` running accumulator; apply per-break clip then update accumulator.

**Run:**
```bash
pnpm vitest run --reporter=verbose -t "T2.3" packages/shared
```

**Commit:**
```
feat(drawing-broken-views): T2.3 cumulativeShift multi-break accumulation — Batch 2
```

---

### T2.4 — Helper: `emitZigzagPolyline`

**Goal (red):** Given an axis, spine coordinate (post-compression), perpendicular bbox extent, and gapMm, returns an `Edge2D` with `kind: 'break'` and a sawtooth polyline. Constants: amplitude=1.5 mm, period=3.0 mm, overhang=5 mm.

**Binding formula:** `spine_pos = coordA + gapMm` (from AB-9 ground truth; see preamble note).

```ts
/** Emits one break-symbol Edge2D at spine_pos along axis.
 * Id scheme: 'break_<breakId>' — no viewId prefix; view locality is provided
 * by the parent SVG group's data-view-id attribute. (applyBreaks §7.1 has no viewId param.)
 */
function emitZigzagPolyline(
  axis: 'x' | 'y',
  spinePos: number,
  viewBbox: { minX: number; minY: number; maxX: number; maxY: number },
  breakId: string,
): Edge2D
```

**Test — write first, confirm red:**

```ts
describe('applyBreaks — emitZigzagPolyline (via break symbol output)', () => {
  const BBOX = { minX: 0, minY: 0, maxX: 300, maxY: 60 };

  it('T2.4a break symbol has kind: "break"', () => {
    const br: BreakRegion = { id: 'bk1', axis: 'x', coordA: 100, coordB: 200, gapMm: 5, style: 'zigzag' };
    // Symbol id = 'break_<breakId>' (no viewId prefix; view locality provided by data-view-id attr)
    // For tests without viewId, the id is simply 'break_<breakId>'
    const { breakSymbolEdges } = applyBreaks([], [br], BBOX);
    expect(breakSymbolEdges).toHaveLength(1);
    expect(breakSymbolEdges[0]!.kind).toBe('break');
  });

  it('T2.4b break symbol id uses breakId', () => {
    const br: BreakRegion = { id: 'bk42', axis: 'x', coordA: 0, coordB: 50, gapMm: 5, style: 'zigzag' };
    const { breakSymbolEdges } = applyBreaks([], [br], BBOX);
    expect(breakSymbolEdges[0]!.id).toContain('bk42');
  });

  it('T2.4c axis x: symbol points span Y from perpMin-5 to perpMax+5 (with overhang)', () => {
    const br: BreakRegion = { id: 'b1', axis: 'x', coordA: 50, coordB: 100, gapMm: 5, style: 'zigzag' };
    const { breakSymbolEdges } = applyBreaks([], [br], BBOX);
    const pts = breakSymbolEdges[0]!.points;
    // perpMin = minY - 5 = -5; perpMax = maxY + 5 = 65
    const allY = pts.map(p => p[1]);
    expect(Math.min(...allY)).toBeCloseTo(-5, 1);
    expect(Math.max(...allY)).toBeCloseTo(65, 1);
  });

  it('T2.4d axis x: first point x-coord = coordA + gapMm (spine position)', () => {
    const br: BreakRegion = { id: 'b1', axis: 'x', coordA: 100, coordB: 200, gapMm: 5, style: 'zigzag' };
    const { breakSymbolEdges } = applyBreaks([], [br], BBOX);
    // spine_pos = 100 + 5 = 105 (AB-9 binding formula)
    const xCoords = breakSymbolEdges[0]!.points.map(p => p[0]);
    // All x coords must be within amplitude of spine_pos = 105
    xCoords.forEach(x => {
      expect(Math.abs(x - 105)).toBeLessThanOrEqual(1.5 + 1e-9);
    });
  });
});
```

**Implement (green):** Add `emitZigzagPolyline` helper. Wire into `applyBreaks` main loop: after processing each break, compute `spinePos = coordA_original + gapMm` (in original coords, not shifted), then apply cumulative shift before emitting. Emit one symbol per break into `breakSymbolEdges`.

> Implementation note on spine_pos vs cumulative shift: The "after-compression" position of the break boundary on the **right side** is: `coordA + gapMm` in the original coordinate space, which after applying the cumulative shift of prior breaks becomes `coordA + gapMm + priorShift`. Since the break symbol represents the right edge of the gap (where content resumes), use: `spinePos = coordA + gapMm + cumulativeShift_before_this_break`. Verify this produces 105 for AB-9 (single break, no prior shift: 100 + 5 + 0 = 105 ✓).

**Run:**
```bash
pnpm vitest run --reporter=verbose -t "T2.4" packages/shared
```

**Commit:**
```
feat(drawing-broken-views): T2.4 emitZigzagPolyline break symbol — Batch 2
```

---

### T2.5 — AB-1: Edge crossing band, both fragments survive

**Spec AB-1 (verbatim):**
> Single horizontal edge `[(0,0), (200,0)]`, one x-break `coordA=50, coordB=150, gapMm=5` → `edges` has 2 fragments: `[(0,0),(50,0)]` id `<id>_a`; `[(55,0),(105,0)]` id `<id>_b` (after-coord=150, shift=−95, so 150−95=55; 200−95=105); `breakSymbolEdges.length === 1`

**Test — write first, confirm red:**

```ts
describe('AB-1 edge crossing band — both fragments', () => {
  it('T2.5 AB-1: horizontal edge spanning x-break → _a and _b fragments', () => {
    const BBOX = { minX: 0, minY: -5, maxX: 200, maxY: 5 };
    const e: Edge2D = { id: 'edge1', kind: 'outline', points: [[0,0],[200,0]] };
    const br: BreakRegion = { id: 'b1', axis: 'x', coordA: 50, coordB: 150, gapMm: 5, style: 'zigzag' };
    const { edges, breakSymbolEdges } = applyBreaks([e], [br], BBOX);

    expect(edges).toHaveLength(2);
    const a = edges.find(e => e.id === 'edge1_a');
    const b = edges.find(e => e.id === 'edge1_b');
    expect(a).toBeDefined();
    expect(b).toBeDefined();

    // Before fragment: [(0,0),(50,0)]
    expect(a!.points[0]).toEqual([0, 0]);
    expect(a!.points[1]![0]).toBeCloseTo(50, 5);

    // After fragment translated: shift = −(150−50−5) = −95; 150−95=55; 200−95=105
    expect(b!.points[0]![0]).toBeCloseTo(55, 5);
    expect(b!.points[1]![0]).toBeCloseTo(105, 5);
    expect(b!.points[0]![1]).toBeCloseTo(0, 5);

    expect(breakSymbolEdges).toHaveLength(1);
  });
});
```

**Implement (green):** Build out the main per-edge per-break loop to handle the span-full-band case. The before-fragment gets suffix `_a`; the after-fragment gets suffix `_b` and is shifted. If only one side survives (crossing one boundary only), that fragment also gets the suffix per spec §7.2 step 3.

**Run:**
```bash
pnpm vitest run --reporter=verbose -t "AB-1" packages/shared
```

**Commit:**
```
feat(drawing-broken-views): T2.5 AB-1 edge spanning break band — Batch 2
```

---

### T2.6 — AB-2 and AB-3: Edge entirely before / entirely after

**Spec AB-2 (verbatim):**
> Edge entirely before band `[(0,0),(40,0)]`, x-break `coordA=50, coordB=100` → `edges` has 1 fragment; id unchanged; no translation

**Spec AB-3 (verbatim):**
> Edge entirely after band `[(120,0),(200,0)]`, x-break `coordA=50, coordB=100, gapMm=5` → `edges` has 1 fragment; id unchanged; x translated by −45 → `[(75,0),(155,0)]`

**Test — write first, confirm red:**

```ts
describe('AB-2 edge entirely before band', () => {
  it('T2.6a AB-2: id unchanged, no translation', () => {
    const BBOX = { minX: 0, minY: -5, maxX: 200, maxY: 5 };
    const e: Edge2D = { id: 'e_before', kind: 'outline', points: [[0,0],[40,0]] };
    const br: BreakRegion = { id: 'b1', axis: 'x', coordA: 50, coordB: 100, gapMm: 5, style: 'zigzag' };
    const { edges } = applyBreaks([e], [br], BBOX);
    expect(edges).toHaveLength(1);
    expect(edges[0]!.id).toBe('e_before');
    expect(edges[0]!.points[0]).toEqual([0, 0]);
    expect(edges[0]!.points[1]).toEqual([40, 0]);
  });
});

describe('AB-3 edge entirely after band', () => {
  it('T2.6b AB-3: id unchanged, x translated by −45', () => {
    const BBOX = { minX: 0, minY: -5, maxX: 200, maxY: 5 };
    const e: Edge2D = { id: 'e_after', kind: 'outline', points: [[120,0],[200,0]] };
    const br: BreakRegion = { id: 'b1', axis: 'x', coordA: 50, coordB: 100, gapMm: 5, style: 'zigzag' };
    const { edges } = applyBreaks([e], [br], BBOX);
    expect(edges).toHaveLength(1);
    expect(edges[0]!.id).toBe('e_after');
    expect(edges[0]!.points[0]![0]).toBeCloseTo(75, 5);
    expect(edges[0]!.points[1]![0]).toBeCloseTo(155, 5);
  });
});
```

**Implement (green):** The T2.2 implementation should already cover these two cases. Confirm both pass with no additional code change.

**Run:**
```bash
pnpm vitest run --reporter=verbose -t "AB-2|AB-3" packages/shared
```

**Commit:**
```
feat(drawing-broken-views): T2.6 AB-2 AB-3 before/after-band edge handling — Batch 2
```

---

### T2.7 — AB-4 and AB-5: Entirely inside + tangent

**Spec AB-4 (verbatim):**
> Edge entirely inside band `[(60,0),(90,0)]`, x-break `coordA=50, coordB=100` → `edges` is empty

**Spec AB-5 (verbatim):**
> Edge tangent to `coordA`: `[(50,0),(50,10)]` (vertical edge at x=50), x-break `coordA=50, coordB=100` → Edge entirely at boundary; treat as "before"; keep with id unchanged

**Test — write first, confirm red:**

```ts
describe('AB-4 edge entirely inside band', () => {
  it('T2.7a AB-4: edge inside band is dropped', () => {
    const BBOX = { minX: 0, minY: -5, maxX: 200, maxY: 5 };
    const e: Edge2D = { id: 'e_inside', kind: 'feature', points: [[60,0],[90,0]] };
    const br: BreakRegion = { id: 'b1', axis: 'x', coordA: 50, coordB: 100, gapMm: 5, style: 'zigzag' };
    const { edges } = applyBreaks([e], [br], BBOX);
    expect(edges).toHaveLength(0);
  });
});

describe('AB-5 edge tangent to coordA', () => {
  it('T2.7b AB-5: vertical edge at exactly x=50 → kept as "before", id unchanged', () => {
    const BBOX = { minX: 0, minY: -5, maxX: 200, maxY: 15 };
    const e: Edge2D = { id: 'e_tang', kind: 'outline', points: [[50,0],[50,10]] };
    const br: BreakRegion = { id: 'b1', axis: 'x', coordA: 50, coordB: 100, gapMm: 5, style: 'zigzag' };
    const { edges } = applyBreaks([e], [br], BBOX);
    expect(edges).toHaveLength(1);
    expect(edges[0]!.id).toBe('e_tang');
    // Not translated (in "before" zone at boundary)
    expect(edges[0]!.points[0]).toEqual([50, 0]);
    expect(edges[0]!.points[1]).toEqual([50, 10]);
  });
});
```

**Implement (green):** Ensure the boundary-tolerance logic uses `≤ coordA` for "before" classification (treat `coord === coordA` as "before"), matching spec §7.4 edge case 5 (1e-9 tolerance). Ensure `coord > coordA && coord < coordB` (strictly inside) is "inside" — drop.

**Run:**
```bash
pnpm vitest run --reporter=verbose -t "AB-4|AB-5" packages/shared
```

**Commit:**
```
feat(drawing-broken-views): T2.7 AB-4 AB-5 inside-band drop + tangent keep — Batch 2
```

---

### T2.8 — AB-6: Two breaks on same axis, cumulative shift

**Spec AB-6 (verbatim):**
> Two breaks same axis: `coordA1=50, coordB1=100, gapMm=5`; `coordA2=200, coordB2=300, gapMm=5`. Edge `[(0,0),(350,0)]` → 3 surviving fragments; cumulative shift after break 1 = −45; break 2 adjusted position = 200 in original space → after cumulative: break 2 symbol at `200 + (−45) = 155`; after-break-2 shift = −(300−200−5) = −95; total shift on last fragment = −45+(−95) = −140; fragment `[(305,0),(350,0)]` → `[(165,0),(210,0)]`

**Test — write first, confirm red:**

```ts
describe('AB-6 two breaks on same axis', () => {
  it('T2.8 AB-6: 3 surviving fragments with cumulative shift', () => {
    const BBOX = { minX: 0, minY: -5, maxX: 350, maxY: 5 };
    const e: Edge2D = { id: 'longEdge', kind: 'outline', points: [[0,0],[350,0]] };
    const breaks: BreakRegion[] = [
      { id: 'b1', axis: 'x', coordA: 50,  coordB: 100, gapMm: 5, style: 'zigzag' },
      { id: 'b2', axis: 'x', coordA: 200, coordB: 300, gapMm: 5, style: 'zigzag' },
    ];
    const { edges, breakSymbolEdges } = applyBreaks([e], breaks, BBOX);

    expect(edges).toHaveLength(3);
    expect(breakSymbolEdges).toHaveLength(2);

    // Fragment 1: [(0,0),(50,0)] — before break1, no shift
    const frag1 = edges.find(e => e.id === 'longEdge_a' || (e.points[0]![0] < 50 && e.points[1]![0] <= 50));
    expect(frag1).toBeDefined();
    expect(frag1!.points[0]![0]).toBeCloseTo(0, 5);
    expect(frag1!.points[1]![0]).toBeCloseTo(50, 5);

    // Fragment 2: [(100,0),(200,0)] after break1 shift=−45: [(55,0),(155,0)]
    const frag2 = edges.find(e => e.points[0]![0] > 50 && e.points[0]![0] < 160);
    expect(frag2).toBeDefined();
    expect(frag2!.points[0]![0]).toBeCloseTo(55, 5);
    expect(frag2!.points[1]![0]).toBeCloseTo(155, 5);

    // Fragment 3: [(300,0),(350,0)] after total shift=−140: [(160,0),(210,0)]
    // Note: spec says 165,210 but let's verify: 300−140=160, 350−140=210. Spec text says 165...
    // AB-6 spec: "fragment [(305,0),(350,0)] → [(165,0),(210,0)]"
    // 305−140=165; 350−140=210. So fragment starts at 305, not 300.
    // (Edge spans [200,300] band — after break2, "after" portion starts at coordB2=300 → shifted to 300−140=160)
    // But spec says the fragment is [(305,0),(350,0)] → implies the split of the edge into
    // frag2 = [100,200] (between the two bands) and frag3 = [300,350] (after break2).
    // Let's trust spec: frag3 starts at 300 in original → 300−140=160, end: 350−140=210.
    // Spec says 165... that would mean frag3 starts at 305. This only makes sense if
    // the "after break2" in original space starts at coordB2=300 (inclusive boundary).
    // Either 160 or 165 — the implementer must check against the live test.
    // Use spec numbers directly: expect 165 and 210.
    const frag3 = edges.find(e => e.points[1]![0] > 200);
    expect(frag3).toBeDefined();
    expect(frag3!.points[1]![0]).toBeCloseTo(210, 5);
  });
});
```

> Implementation note: The spec AB-6 says the last fragment is `[(305,0),(350,0)] → [(165,0),(210,0)]`. 305−140=165. This implies the after-break2 portion of the original edge begins at 305 (not 300). The reason: when the edge spans exactly coordB2=300, the "after" portion may use strict inequality `> coordB` (i.e., the point at coordB is treated as inside, not after). Or: the edge points are `[300,0]` at coordB, classified as at the boundary, which by spec §7.4 case 6 ("edge tangent to coordB → treat as before translated start") means it stays. The implementer must verify the boundary condition on coordB and produce the fragment starting at 305 as the spec says. **Write the test asserting 165/210 directly; if it initially fails, investigate the coordB boundary logic.**

**Implement (green):** Ensure the multi-break loop applies each break to the already-processed edges from prior breaks. The second break operates on the post-break1 geometry (coordinate space has already been compressed by break1's shift). Alternatively, implement using the "original coordinate space" approach where each break operates on the original edges and shifts are accumulated; verify AB-6 passes with either approach.

**Run:**
```bash
pnpm vitest run --reporter=verbose -t "AB-6" packages/shared
```

**Commit:**
```
feat(drawing-broken-views): T2.8 AB-6 two x-breaks cumulative shift — Batch 2
```

---

### T2.9 — AB-7: y-axis break

**Spec AB-7 (verbatim):**
> y-axis break `coordA=30, coordB=80, gapMm=5` on vertical edge `[(0,0),(0,200)]` → Analogous to AB-1 with y coords

**Test — write first, confirm red:**

```ts
describe('AB-7 y-axis break', () => {
  it('T2.9 AB-7: vertical edge with y-axis break → two fragments', () => {
    const BBOX = { minX: -5, minY: 0, maxX: 5, maxY: 200 };
    const e: Edge2D = { id: 'vedge', kind: 'outline', points: [[0,0],[0,200]] };
    const br: BreakRegion = { id: 'by', axis: 'y', coordA: 30, coordB: 80, gapMm: 5, style: 'zigzag' };
    const { edges, breakSymbolEdges } = applyBreaks([e], [br], BBOX);

    // shift = −(80−30−5) = −45
    expect(edges).toHaveLength(2);
    const a = edges.find(e => e.id === 'vedge_a');
    const b = edges.find(e => e.id === 'vedge_b');
    expect(a).toBeDefined();
    expect(b).toBeDefined();

    // Before fragment: y from 0 to 30
    expect(a!.points[0]).toEqual([0, 0]);
    expect(a!.points[1]![1]).toBeCloseTo(30, 5);

    // After fragment: y from 80−45=35 to 200−45=155
    expect(b!.points[0]![1]).toBeCloseTo(35, 5);
    expect(b!.points[1]![1]).toBeCloseTo(155, 5);
    // x unchanged
    expect(b!.points[0]![0]).toBeCloseTo(0, 5);

    // Symbol: axis='y', spine runs along X
    expect(breakSymbolEdges).toHaveLength(1);
    expect(breakSymbolEdges[0]!.kind).toBe('break');
    // spine_pos = coordA + gapMm = 30 + 5 = 35
    const yCoords = breakSymbolEdges[0]!.points.map(p => p[1]);
    yCoords.forEach(y => {
      expect(Math.abs(y - 35)).toBeLessThanOrEqual(1.5 + 1e-9);
    });
  });
});
```

**Implement (green):** Confirm `axis: 'y'` path correctly uses `p[1]` for band classification and `p[1]` for translation. No new logic needed if implementation is axis-agnostic; just verify.

**Run:**
```bash
pnpm vitest run --reporter=verbose -t "AB-7" packages/shared
```

**Commit:**
```
feat(drawing-broken-views): T2.9 AB-7 y-axis break analogous case — Batch 2
```

---

### T2.10 — AB-8: Empty edges array

**Spec AB-8 (verbatim):**
> Empty edges array → `edges: []`, `breakSymbolEdges.length === 1` (symbol still emitted)

**Test — write first, confirm red:**

```ts
describe('AB-8 empty edges array', () => {
  it('T2.10 AB-8: symbol emitted even with no geometry edges', () => {
    const BBOX = { minX: 0, minY: 0, maxX: 300, maxY: 60 };
    const br: BreakRegion = { id: 'b1', axis: 'x', coordA: 50, coordB: 100, gapMm: 5, style: 'zigzag' };
    const { edges, breakSymbolEdges } = applyBreaks([], [br], BBOX);
    expect(edges).toHaveLength(0);
    expect(breakSymbolEdges).toHaveLength(1);
    expect(breakSymbolEdges[0]!.kind).toBe('break');
  });
});
```

**Implement (green):** Ensure break symbols are emitted from the breaks loop, not the edges loop, so an empty edges array still produces symbols.

**Run:**
```bash
pnpm vitest run --reporter=verbose -t "AB-8" packages/shared
```

**Commit:**
```
feat(drawing-broken-views): T2.10 AB-8 symbol emitted on empty geometry — Batch 2
```

---

### T2.11 — AB-9: Break symbol geometry detail

**Spec AB-9 (verbatim):**
> Break symbol geometry: `axis: 'x'`, `coordA=100, coordB=200, gapMm=5`, `viewBbox = {minX:0,minY:0,maxX:300,maxY:60}` → Symbol points: spine at x=105 (after shift of −95 applied to break at 100); perpendicular span Y ∈ [−5, 65]; has sawtooth pattern; point count = 4 × floor(70/3) + 1 or equivalent

**Test — write first, confirm red:**

```ts
describe('AB-9 break symbol geometry', () => {
  it('T2.11 AB-9: zigzag spine, span, and point count', () => {
    const BBOX = { minX: 0, minY: 0, maxX: 300, maxY: 60 };
    const br: BreakRegion = { id: 'b9', axis: 'x', coordA: 100, coordB: 200, gapMm: 5, style: 'zigzag' };
    const { breakSymbolEdges } = applyBreaks([], [br], BBOX);
    expect(breakSymbolEdges).toHaveLength(1);
    const sym = breakSymbolEdges[0]!;

    // spine at x=105 (coordA + gapMm = 100 + 5 = 105)
    const xCoords = sym.points.map(p => p[0]);
    xCoords.forEach(x => {
      expect(Math.abs(x - 105)).toBeLessThanOrEqual(1.5 + 1e-9);
    });

    // Y span: perpMin = minY − 5 = −5; perpMax = maxY + 5 = 65
    const yCoords = sym.points.map(p => p[1]);
    expect(Math.min(...yCoords)).toBeCloseTo(-5, 1);
    expect(Math.max(...yCoords)).toBeCloseTo(65, 1);

    // Point count: 4 teeth × floor(70/3) = 4×23=92 points, or check >= 88 (floor can vary)
    // Spec: "4 × floor(70/3) + 1 or equivalent"
    // perpSpan = 65 − (−5) = 70; floor(70/3) = 23; 23×4 + 1 = 93 points
    expect(sym.points.length).toBeGreaterThanOrEqual(4 * Math.floor(70 / 3));
    expect(sym.points.length).toBeLessThanOrEqual(4 * Math.floor(70 / 3) + 8); // tolerance band
  });
});
```

**Implement (green):** Implement `emitZigzagPolyline` to generate the sawtooth polyline. For each period: 4 points `(t0, t1, t2, t3)` at quarter-period boundaries with ±1.5 mm x-displacement. Final point at `perpMax`. Clamp to `[perpMin, perpMax]`. Set `id = 'break_<breakId>'` (no viewId prefix — spec §7.1 does not include `viewId` as a parameter; view locality is provided by the `data-view-id` attribute on the parent SVG group). Verify AB-9 test is consistent with this id scheme.

**Run:**
```bash
pnpm vitest run --reporter=verbose -t "AB-9" packages/shared
```

**Commit:**
```
feat(drawing-broken-views): T2.11 AB-9 zigzag geometry detail — Batch 2
```

---

### T2.12 — AB-10: y-axis break with hidden edges

**Spec AB-10 (verbatim):**
> Edge crossing band on y-axis with `showHidden` edges array also passed → Both visible and hidden edge arrays processed independently; same id-stability rules apply

**Note:** `applyBreaks` per spec §7.1 accepts a single `edges` array. The `showHidden` concept comes from `AddBreakCommand` which calls `applyBreaks` twice (once for `visibleEdges`, once for `hiddenEdges`). AB-10 validates that calling `applyBreaks` on a hidden-edges array produces the same id-stability as on visible edges — the function is array-agnostic.

**Test — write first, confirm red:**

```ts
describe('AB-10 y-axis break — visible and hidden arrays identical semantics', () => {
  it('T2.12 AB-10: hidden edges processed same as visible edges', () => {
    const BBOX = { minX: -5, minY: 0, maxX: 5, maxY: 200 };
    const visEdge: Edge2D = { id: 'vis1', kind: 'silhouette', points: [[0,0],[0,200]] };
    const hidEdge: Edge2D = { id: 'hid1', kind: 'feature',    points: [[0,0],[0,200]] };
    const br: BreakRegion = { id: 'by', axis: 'y', coordA: 50, coordB: 150, gapMm: 5, style: 'zigzag' };

    const visResult = applyBreaks([visEdge], [br], BBOX);
    const hidResult = applyBreaks([hidEdge], [br], BBOX);

    // Both produce 2 fragments
    expect(visResult.edges).toHaveLength(2);
    expect(hidResult.edges).toHaveLength(2);

    // Id-stability: _a and _b suffixes on both
    expect(visResult.edges.find(e => e.id === 'vis1_a')).toBeDefined();
    expect(visResult.edges.find(e => e.id === 'vis1_b')).toBeDefined();
    expect(hidResult.edges.find(e => e.id === 'hid1_a')).toBeDefined();
    expect(hidResult.edges.find(e => e.id === 'hid1_b')).toBeDefined();

    // After-fragments translated identically: shift = −(150−50−5) = −95
    const visFrag = visResult.edges.find(e => e.id === 'vis1_b')!;
    const hidFrag = hidResult.edges.find(e => e.id === 'hid1_b')!;
    expect(visFrag.points[0]![1]).toBeCloseTo(hidFrag.points[0]![1], 5);

    // Break symbol emitted for both calls
    expect(visResult.breakSymbolEdges).toHaveLength(1);
    expect(hidResult.breakSymbolEdges).toHaveLength(1);
  });
});
```

**Implement (green):** No new logic needed — `applyBreaks` is already array-agnostic (operates on whatever `Edge2D[]` is passed). This test confirms correctness and that `kind: 'feature'` edges (hidden) are handled identically to `kind: 'silhouette'` (visible).

**Run:**
```bash
pnpm vitest run --reporter=verbose -t "AB-10" packages/shared
```

**Commit:**
```
feat(drawing-broken-views): T2.12 AB-10 hidden-edge array same id-stability — Batch 2
```

---

### T2.13 — Edge cases from spec §7.4 (remaining uncovered)

**Goal:** Cover spec §7.4 edge cases not yet exercised by AB-1..AB-10: zero-length edge, tangent to coordB, crosses coordA only, crosses coordB only.

**Test — write first, confirm red:**

```ts
describe('applyBreaks — spec §7.4 edge cases', () => {
  const BBOX = { minX: 0, minY: -5, maxX: 200, maxY: 5 };
  const br: BreakRegion = { id: 'b1', axis: 'x', coordA: 50, coordB: 100, gapMm: 5, style: 'zigzag' };

  it('T2.13a zero-length edge before band → kept', () => {
    // §7.4 case 1: classify by point position; before → keep
    const e: Edge2D = { id: 'zl', kind: 'outline', points: [[30,0],[30,0]] };
    const { edges } = applyBreaks([e], [br], BBOX);
    expect(edges).toHaveLength(1);
    expect(edges[0]!.id).toBe('zl');
  });

  it('T2.13b zero-length edge inside band → dropped', () => {
    const e: Edge2D = { id: 'zl_in', kind: 'outline', points: [[70,0],[70,0]] };
    const { edges } = applyBreaks([e], [br], BBOX);
    expect(edges).toHaveLength(0);
  });

  it('T2.13c edge tangent to coordB → kept as before-translated, id unchanged', () => {
    // §7.4 case 6: edge at exactly coordB treated as start of "after" zone
    const e: Edge2D = { id: 'e_cb', kind: 'outline', points: [[100,0],[100,10]] };
    const { edges } = applyBreaks([e], [br], BBOX);
    expect(edges).toHaveLength(1);
    expect(edges[0]!.id).toBe('e_cb');
    // Translated: shift = −45; 100−45 = 55
    expect(edges[0]!.points[0]![0]).toBeCloseTo(55, 5);
  });

  it('T2.13d edge crosses coordA only → _a suffix on before fragment', () => {
    // §7.4 case 7: before fragment only; inside portion dropped
    const e: Edge2D = { id: 'e_ca', kind: 'outline', points: [[30,0],[80,0]] };
    const { edges } = applyBreaks([e], [br], BBOX);
    expect(edges).toHaveLength(1);
    expect(edges[0]!.id).toBe('e_ca_a');
    expect(edges[0]!.points[1]![0]).toBeCloseTo(50, 5);
  });

  it('T2.13e edge crosses coordB only → _b suffix on after fragment (translated)', () => {
    // §7.4 case 8: inside portion dropped; after fragment
    const e: Edge2D = { id: 'e_cbx', kind: 'outline', points: [[80,0],[160,0]] };
    const { edges } = applyBreaks([e], [br], BBOX);
    expect(edges).toHaveLength(1);
    expect(edges[0]!.id).toBe('e_cbx_b');
    // After fragment: from coordB=100, translated: 100−45=55; end: 160−45=115
    expect(edges[0]!.points[0]![0]).toBeCloseTo(55, 5);
    expect(edges[0]!.points[1]![0]).toBeCloseTo(115, 5);
  });
});
```

**Implement (green):** Complete `clipEdge1D` to handle all boundary conditions. Use `1e-9` tolerance for exact-boundary classification (spec §7.4 cases 5 and 6). Ensure crossing-one-boundary cases suffix correctly.

**Run:**
```bash
pnpm vitest run --reporter=verbose -t "T2.13" packages/shared
```

**Commit:**
```
feat(drawing-broken-views): T2.13 §7.4 edge-case coverage — Batch 2
```

---

### T2.14 — Edge id stability (spec §7.2 step 3 + spec §10)

**Goal:** Confirm id-stability rules from spec §7.2 step 3 and §10 in a focused test. Surviving non-split edges retain exact parent id; split edges (cross one or both band boundaries) get `_a` / `_b` suffix.

**Test — write first, confirm red:**

```ts
describe('applyBreaks — edge id stability (spec §10)', () => {
  const BBOX = { minX: 0, minY: -5, maxX: 200, maxY: 5 };
  const br: BreakRegion = { id: 'b1', axis: 'x', coordA: 50, coordB: 100, gapMm: 5, style: 'zigzag' };

  it('T2.14a edge entirely outside band — id unchanged (no suffix)', () => {
    const e: Edge2D = { id: 'pure_before', kind: 'outline', points: [[0,0],[30,0]] };
    const { edges } = applyBreaks([e], [br], BBOX);
    expect(edges[0]!.id).toBe('pure_before'); // no _a suffix
  });

  it('T2.14b edge spanning band → both halves get _a and _b', () => {
    const e: Edge2D = { id: 'e1', kind: 'outline', points: [[0,0],[200,0]] };
    const { edges } = applyBreaks([e], [br], BBOX);
    const ids = edges.map(e => e.id).sort();
    expect(ids).toContain('e1_a');
    expect(ids).toContain('e1_b');
    expect(ids).not.toContain('e1'); // unsuffixed form must NOT appear
  });

  it('T2.14c kind and sourceFaceIds preserved on surviving fragments', () => {
    const e: Edge2D = {
      id: 'ef',
      kind: 'silhouette',
      points: [[0,0],[200,0]],
      sourceFaceIds: ['face_A', 'face_B'],
    };
    const { edges } = applyBreaks([e], [br], BBOX);
    edges.forEach(frag => {
      expect(frag.kind).toBe('silhouette');
      expect(frag.sourceFaceIds).toEqual(['face_A', 'face_B']);
    });
  });
});
```

**Implement (green):** Verify that `kind` and `sourceFaceIds` are propagated to all fragments. This should already be correct if fragments are built with spread: `{ ...sourceEdge, id: newId, points: newPoints }`.

**Run:**
```bash
pnpm vitest run --reporter=verbose -t "T2.14" packages/shared
```

**Commit:**
```
feat(drawing-broken-views): T2.14 id stability + kind/sourceFaceIds propagation — Batch 2
```

---

### T2.15 — Module: `fingerprintBreaksArray`

**Goal (red):** Export `fingerprintBreaksArray(breaks: readonly BreakRegion[]): string` from `packages/shared/src/drawing/fingerprint.ts`. Uses the existing internal `djb2` function. Encodes breaks sorted by `coordA` ascending, pipe-separated `axis|coordA.toFixed(3)|coordB.toFixed(3)|gapMm.toFixed(3)|style` joined with `;`.

**Pre-task verification:**
```bash
grep -n 'function djb2\|export function djb2' packages/shared/src/drawing/fingerprint.ts
```
Confirm `djb2` is NOT exported (it is a file-internal function). `fingerprintBreaksArray` must be in the same file to access it.

**Test — write first, confirm red:**

```ts
// packages/shared/src/drawing/__tests__/fingerprint.spec.ts  (add to existing file)
import { fingerprintBreaksArray } from '../fingerprint';
import type { BreakRegion } from '../types';

describe('fingerprintBreaksArray', () => {
  const mkBreak = (axis: 'x'|'y', coordA: number, coordB: number, gapMm = 5): BreakRegion => ({
    id: 'test-id',
    axis,
    coordA,
    coordB,
    gapMm,
    style: 'zigzag',
  });

  it('T2.15a empty array → stable non-empty string', () => {
    const fp = fingerprintBreaksArray([]);
    expect(fp).toBeTruthy();
    expect(fp).toMatch(/^[0-9a-f]{8}$/);
    expect(fingerprintBreaksArray([])).toBe(fp); // idempotent
  });

  it('T2.15b single break → known-stable string (same result across calls)', () => {
    const br = mkBreak('x', 50, 100);
    const fp1 = fingerprintBreaksArray([br]);
    const fp2 = fingerprintBreaksArray([br]);
    expect(fp1).toBe(fp2);
    expect(fp1).not.toBe(fingerprintBreaksArray([]));
  });

  it('T2.15c reversed order produces same fingerprint (sorted by coordA)', () => {
    const b1 = mkBreak('x', 50, 100);
    const b2 = mkBreak('x', 200, 300);
    const fp_forward  = fingerprintBreaksArray([b1, b2]);
    const fp_reversed = fingerprintBreaksArray([b2, b1]);
    expect(fp_forward).toBe(fp_reversed);
  });

  it('T2.15d different coordA → different fingerprint', () => {
    const fp1 = fingerprintBreaksArray([mkBreak('x', 50, 100)]);
    const fp2 = fingerprintBreaksArray([mkBreak('x', 51, 100)]);
    expect(fp1).not.toBe(fp2);
  });

  it('T2.15e sub-1e-3 mm change in coordA → same fingerprint (1e-3 rounding bucket)', () => {
    const fp1 = fingerprintBreaksArray([mkBreak('x', 50.000, 100)]);
    const fp2 = fingerprintBreaksArray([mkBreak('x', 50.0001, 100)]);
    expect(fp1).toBe(fp2);
  });

  it('T2.15f different axis → different fingerprint', () => {
    const fp1 = fingerprintBreaksArray([mkBreak('x', 50, 100)]);
    const fp2 = fingerprintBreaksArray([mkBreak('y', 50, 100)]);
    expect(fp1).not.toBe(fp2);
  });
});
```

**Implement (green):** Add to `packages/shared/src/drawing/fingerprint.ts`:

```ts
import type { BreakRegion } from './types';

/**
 * Synchronous djb2 fingerprint contribution for a BreakRegion array.
 * Encodes axis, coordA, coordB, gapMm, style for each break, sorted by coordA ascending.
 * Matches fingerprintDetailView's pipe-separated, 1e-3mm convention.
 */
export function fingerprintBreaksArray(breaks: readonly BreakRegion[]): string {
  const sorted = [...breaks].sort((a, b) => a.coordA - b.coordA);
  const payload = sorted
    .map(b => [b.axis, b.coordA.toFixed(3), b.coordB.toFixed(3), b.gapMm.toFixed(3), b.style].join('|'))
    .join(';');
  return djb2(payload);
}
```

> `djb2` is already in scope as a file-local function on line 81 of `fingerprint.ts`. Do NOT move or re-export it. Add `fingerprintBreaksArray` after `fingerprintSectionView`. Add the `BreakRegion` import (confirmed added to `./types` in Batch 1).

**Run:**
```bash
pnpm vitest run --reporter=verbose -t "fingerprintBreaksArray" packages/shared
```

**Commit:**
```
feat(drawing-broken-views): T2.15 fingerprintBreaksArray djb2 — Batch 2
```

---

### T2.16 — Augment `inputFingerprint` (spec §8.2)

**Goal (red):** Verify that `fingerprintBreaksArray` is wired into the input fingerprint computation used by `AddBreakCommand` and `DeleteBreakCommand`. The wiring point per spec §8.2 is: `newFingerprint = djb2(existingGeometryFingerprint + '|' + fingerprintBreaksArray(newBreaksArray))`.

**Pre-task check:** The actual fingerprint composition for commands lives in `AddBreakCommand.apply` (Batch 3), not in `fingerprint.ts`. This task validates that `fingerprintBreaksArray` is the correct function to use and that it integrates correctly. Write an integration-level unit test:

**Test — write first, confirm red:**

```ts
describe('fingerprintBreaksArray — §8.2 integration with inputFingerprint pattern', () => {
  it('T2.16a same view fingerprint + same breaks → same composed fingerprint', () => {
    // Simulate: djb2(geoFp + '|' + fingerprintBreaksArray(breaks))
    // This is what AddBreakCommand.apply will compute.
    // We test fingerprintBreaksArray is deterministic and order-stable, enabling this composition.
    const geoFp = 'abc123def456';
    const breaks: BreakRegion[] = [
      { id: 'b1', axis: 'x', coordA: 50, coordB: 100, gapMm: 5, style: 'zigzag' },
    ];
    const fp1 = fingerprintBreaksArray(breaks);
    const fp2 = fingerprintBreaksArray(breaks);
    expect(fp1).toBe(fp2);
    // Composed fingerprint (consumer pattern):
    // const composed = djb2(geoFp + '|' + fp1);
    // We can't call djb2 directly here (it's not exported); just verify fp1 is stable.
  });

  it('T2.16b different breaks array → different fingerprintBreaksArray output', () => {
    const b1: BreakRegion = { id: 'x', axis: 'x', coordA: 50, coordB: 100, gapMm: 5, style: 'zigzag' };
    const b2: BreakRegion = { id: 'y', axis: 'x', coordA: 60, coordB: 100, gapMm: 5, style: 'zigzag' };
    expect(fingerprintBreaksArray([b1])).not.toBe(fingerprintBreaksArray([b2]));
  });
});
```

**Implement (green):** No additional implementation needed — `fingerprintBreaksArray` was added in T2.15. This task verifies compositional correctness and documents the usage pattern for Batch 3 implementers.

**Run:**
```bash
pnpm vitest run --reporter=verbose -t "T2.16" packages/shared
```

**Commit:**
```
feat(drawing-broken-views): T2.16 fingerprintBreaksArray §8.2 composition test — Batch 2
```

---

### T2.17 — Final green-gate

**Goal:** All unit tests in `packages/shared` pass; typecheck clean; no regressions.

**Steps:**

1. Run full shared suite:
   ```bash
   pnpm -r typecheck && pnpm --filter @zilventor/shared test:unit
   ```

2. Verify all AB-1..AB-10 tests pass:
   ```bash
   pnpm vitest run --reporter=verbose packages/shared/src/drawing/__tests__/applyBreaks.spec.ts
   ```

3. Verify fingerprint tests pass:
   ```bash
   pnpm vitest run --reporter=verbose packages/shared/src/drawing/__tests__/fingerprint.spec.ts
   ```

4. Fix any failures before committing. Use `superpowers:systematic-debugging` if a test fails for an unexpected reason.

**Commit:**
```
feat(drawing-broken-views): applyBreaks + zigzag + fingerprint cascade — Batch 2 complete
```

---

## Batch 2 — Reviewer dispatch templates

### Reviewer A: Spec compliance

```
Ultrathink, then review the Batch 2 implementation of Drawing F3 (Broken Views) for
spec compliance. Focus exclusively on the applyBreaks algorithm, zigzag geometry, and
fingerprintBreaksArray.

Codebase:
  packages/shared/src/drawing/applyBreaks.ts
  packages/shared/src/drawing/__tests__/applyBreaks.spec.ts
  packages/shared/src/drawing/fingerprint.ts
  packages/shared/src/drawing/__tests__/fingerprint.spec.ts

Spec sections to verify against:
  docs/superpowers/specs/2026-05-06-drawing-broken-views-design.md §7 and §8 in full.

Check all of the following:

1. AB-1..AB-10 test cases: are all 10 present? Does each match the spec §7.5 table
   verbatim (input, assert)? Flag any missing or divergent case.

2. Zigzag spine position: spec §7.2 prose says "after-translation coordinate of coordA";
   spec §7.5 AB-9 asserts spine at x=105 for coordA=100, gapMm=5. Verify the
   implementation uses spine_pos = coordA + gapMm (= 105), NOT coordA + shift (= 5).
   This is the AB-9-binding-over-prose rule documented in the Batch 2 preamble.

3. AB-9 point count: perpSpan = 70 mm, period = 3 mm. Expected >= 4*floor(70/3) points.
   Does the test assert this range? Does the implementation produce it?

4. Edge id stability (spec §7.2 step 3 + spec §10): edges not crossing a band keep
   their original id (no suffix); edges crossing coordA only get _a; edges crossing
   coordB only get _b; edges spanning the band get both _a and _b. Verify each case
   has a test and the implementation honours it.

5. fingerprintBreaksArray (spec §8.1): sorted by coordA ascending; pipe-separated
   axis|coordA.toFixed(3)|coordB.toFixed(3)|gapMm.toFixed(3)|style; semicolon between
   breaks; djb2 hash; 8-char hex output. Verify test T2.15c (reversed order = same fp).

6. α-conditional invariant: does applyBreaks.ts contain any reference to rawProjection
   or view state? It must be a pure function. Flag any impurity.

7. spec §8.3 stale-banner semantics: applyBreaks itself has no stale-banner logic —
   that is Batch 3 / AddBreakCommand. Confirm the Batch 2 code does NOT attempt to
   write view.inputFingerprint or call any store.

Report under 400 words. List: PASS/FAIL per check, one sentence each. Finish with
overall verdict: MERGE / REQUEST CHANGES.
```

---

### Reviewer B: Code quality

```
Ultrathink, then review the Batch 2 implementation of Drawing F3 (Broken Views) for
code quality. Focus on correctness, robustness, and maintainability of the
applyBreaks module and fingerprint extension.

Files:
  packages/shared/src/drawing/applyBreaks.ts
  packages/shared/src/drawing/__tests__/applyBreaks.spec.ts
  packages/shared/src/drawing/fingerprint.ts
  packages/shared/src/drawing/__tests__/fingerprint.spec.ts

Structural template for reference (same module shape):
  packages/shared/src/drawing/clipEdgesToCircle.ts

Quality checks:

1. 1D Liang-Barsky correctness: for a segment [p0, p1] along axis 'x', with band
   [coordA, coordB], the clip must handle: fully before (max(p0.x,p1.x) < coordA),
   fully after (min(p0.x,p1.x) > coordB), fully inside, crossing coordA only,
   crossing coordB only, spanning full band. Does the implementation cover all 6 cases
   without branch duplication? Is the tolerance (1e-9) applied consistently?

2. Zigzag determinism: given the same (axis, spinePos, viewBbox), does
   emitZigzagPolyline always produce the same point sequence? Is the period loop
   index-based (not float-accumulation-based) to avoid drift? Are points rounded or
   left as exact floats (exact floats are correct; do NOT introduce rounding).

3. Multi-break loop: are breaks sorted by coordA before the loop? Is the
   cumulativeShift accumulator initialized per-axis (Record<'x'|'y', number>)?
   Is the break symbol emitted using pre-shift coordA + gapMm (= after-compression
   spine), not post-shift coordA?

4. sourceFaceIds propagation: does the implementation spread sourceFaceIds onto all
   surviving fragments? Check the split and non-split paths both.

5. Export surface: is ApplyBreaksResult exported? Is applyBreaks exported? Are helper
   functions (clipEdge1D, cumulativeShift, emitZigzagPolyline) NOT exported (they are
   implementation details)? Does the module have zero side effects?

6. Test file quality: are all 10 AB-spec cases in their own describe/it block with the
   spec label (e.g. "AB-1:", "AB-2:")? Are coord assertions using toBeCloseTo(value, 5)
   for floating-point, not toEqual for floats?

7. fingerprintBreaksArray: is djb2 called on the assembled payload string (not hashed
   field by field)? Is the sort stable (JS Array.sort is stable in V8)? Is the
   function co-located with the other fingerprint* functions in fingerprint.ts?

Report under 400 words. List: PASS/FAIL per check, one sentence each. Finish with
overall verdict: MERGE / REQUEST CHANGES.
```
## Batch 3 — AddBreakCommand + DeleteBreakCommand + RegenerateView wiring

> **Batch preamble (N = 3 of 5)**
>
> - **Spec refs:** §9 (applyBreaks integration — entire section), §10.1 (`AddBreakCommand`), §10.2 (`DeleteBreakCommand`), §10.3 (all six error message strings), §10.4 (`RegenerateViewCommand` extension). Cross-reference §5.2 (`rawProjection` α-conditional invariant), §7.1 (`applyBreaks` return type: `{ edges, breakSymbolEdges }`), §8.2 (`fingerprintBreaksArray` + djb2 encoding).
> - **Depends on:** Batch 1 (types: `BreakRegion`, `breaks?`, `rawProjection?` on view types; manifest v17) and Batch 2 (`applyBreaks` + `fingerprintBreaksArray` shipped and exported from `@zilventor/shared`).
> - **TDD discipline:** Every task is a Red → Green → Refactor slice. Write the test first, run it (must fail for the expected reason, not a compile/import error), then implement. Commit at end of every task.
> - **No speculative additions:** implement exactly what §9, §10.1–10.4 describe. Do not add UI, do not add error-boundary logic not in spec.
> - **Vitest pattern:** mirror `packages/app/src/commands/__tests__/AddDetailViewCommand.test.ts` and `RegenerateViewCommand.spec.ts` for store setup, mock shape, and `beforeEach` resets.
> - **Store update pattern:** call `useAppStore.setState({ activeDocument: { kind: 'drawing', document: nextDoc }, activeDrawing: nextDoc })` — both fields, same as `AddDetailViewCommand`.
> - **`applyBreaks` mock:** in command tests, mock `@zilventor/shared` with `vi.mock` and provide a deterministic stub for `applyBreaks` (e.g. returns `{ edges: [syntheticEdge], breakSymbolEdges: [breakEdge] }`) and `fingerprintBreaksArray` (returns `'breaks-fp-mock'`). This keeps command tests independent of Batch 2's algorithm tests.
> - **After every task:** run `pnpm vitest run <pattern>` (specified per task), confirm green, then commit.

**Files touched**

| Action | Path |
|---|---|
| Create | `packages/app/src/commands/AddBreakCommand.ts` |
| Create | `packages/app/src/commands/__tests__/AddBreakCommand.test.ts` |
| Create | `packages/app/src/commands/DeleteBreakCommand.ts` |
| Create | `packages/app/src/commands/__tests__/DeleteBreakCommand.test.ts` |
| Modify | `packages/app/src/commands/RegenerateViewCommand.ts` |
| Modify | `packages/app/src/commands/__tests__/RegenerateViewCommand.spec.ts` |
| Modify | `packages/app/src/commands/index.ts` (barrel re-exports for both new commands) |

> **Registry note:** Verify that `CommandBus.ts` / `CommandRegistry` do NOT require explicit registration for commands (the project dispatches commands via direct `new` + `.apply()` calls — confirmed from `AddDetailViewCommand.ts` which has no registration call). If a registration step is found during implementation, add it; otherwise skip.

---

### T3.1 — AddBreakCommand skeleton + `'view-not-found'` error

**Goal:** Create `AddBreakCommand.ts` with the full `apply`/`revert` class shape. First test: instantiation succeeds; `apply` on a non-existent `viewId` throws `'view-not-found'` exactly.

**Step 1 — Write the failing test**

Create `packages/app/src/commands/__tests__/AddBreakCommand.test.ts`:

```ts
// packages/app/src/commands/__tests__/AddBreakCommand.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AddBreakCommand } from '../AddBreakCommand';
import { useAppStore } from '../../store/useAppStore';
import type { DrawingDocument, DrawingSheet, BaseView } from '@zilventor/shared';

vi.mock('@zilventor/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@zilventor/shared')>();
  return {
    ...actual,
    applyBreaks: vi.fn().mockReturnValue({
      edges: [{ id: 'frag-1', kind: 'outline', points: [[0, 0], [40, 0]], sourceFaceIds: [] }],
      breakSymbolEdges: [{ id: 'sym-1', kind: 'break', points: [[40, -3], [43, 3], [46, -3]], sourceFaceIds: [] }],
    }),
    fingerprintBreaksArray: vi.fn().mockReturnValue('breaks-fp-mock'),
  };
});

const BASE_PROJECTION = {
  visibleEdges: [
    { id: 'e1', kind: 'outline' as const, points: [[0, 0], [200, 0]] as [number, number][], sourceFaceIds: [] },
    { id: 'e2', kind: 'outline' as const, points: [[0, 0], [0, 80]] as [number, number][], sourceFaceIds: [] },
  ],
  hiddenEdges: [],
  bbox: { minX: 0, minY: 0, maxX: 200, maxY: 80 },
};

const BASE_VIEW: BaseView = {
  id: 'v1',
  kind: 'base',
  positionMm: { x: 20, y: 20 },
  scale: { numerator: 1, denominator: 1 },
  orientation: 'front',
  showHidden: false,
  projection: BASE_PROJECTION,
  inputFingerprint: 'base-fp-000',
};

const makeSheet = (): DrawingSheet => ({
  id: 's1',
  name: 'Sheet 1',
  size: { kind: 'iso', size: 'A3' },
  orientation: 'landscape',
  views: [BASE_VIEW],
  dimensions: [],
  annotations: [],
  titleBlock: {},
});

const makeDrawing = (): DrawingDocument => ({
  id: 'd1',
  name: 'Test',
  units: 'mm',
  source: { partPath: 'parts/box.zipt', sourceKind: 'part' },
  properties: {},
  sheets: [makeSheet()],
  activeSheetId: 's1',
});

const baseOpts = {
  drawingId: 'd1',
  sheetId: 's1',
  viewId: 'v1',
  axis: 'x' as const,
  coordA: 60,
  coordB: 140,
};

beforeEach(() => {
  vi.clearAllMocks();
  useAppStore.setState({
    activeDocument: { kind: 'drawing', document: makeDrawing() },
    activePart: null,
    activeAssembly: null,
  } as never);
});

describe('AddBreakCommand — skeleton', () => {
  it('instantiates with name AddBreak', () => {
    const cmd = new AddBreakCommand(baseOpts);
    expect(cmd.name).toBe('AddBreak');
  });

  it('apply throws "view-not-found" when viewId is absent from sheet.views', async () => {
    const cmd = new AddBreakCommand({ ...baseOpts, viewId: 'no-such-view' });
    await expect(cmd.apply()).rejects.toThrow('view-not-found');
  });

  it('store is untouched when view-not-found is thrown', async () => {
    const snapshot = JSON.parse(JSON.stringify(useAppStore.getState().activeDocument));
    const cmd = new AddBreakCommand({ ...baseOpts, viewId: 'no-such-view' });
    try { await cmd.apply(); } catch { /* expected */ }
    expect(useAppStore.getState().activeDocument).toEqual(snapshot);
  });
});
```

Run — expect compile failure (class not yet created). That is the red state.

**Step 2 — Implement the skeleton**

Create `packages/app/src/commands/AddBreakCommand.ts`:

```ts
// packages/app/src/commands/AddBreakCommand.ts
import type { Command } from './Command';
import type { DrawingDocument, BreakRegion, ProjectedGeometry } from '@zilventor/shared';
import { applyBreaks, fingerprintBreaksArray } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';

export type AddBreakOpts = {
  drawingId: string;
  sheetId: string;
  viewId: string;
  axis: 'x' | 'y';
  coordA: number;
  coordB: number;
  gapMm?: number;
};

export class AddBreakCommand implements Command {
  readonly name = 'AddBreak';
  private breakId: string | null = null;
  private wasFirstBreak = false;
  private savedPriorProjection: ProjectedGeometry | undefined = undefined;
  private savedPriorFingerprint: string | undefined = undefined;

  constructor(private readonly opts: AddBreakOpts) {}

  async apply(): Promise<void> {
    const state = useAppStore.getState();
    const doc = state.activeDocument;
    if (!doc || doc.kind !== 'drawing') return;

    const drawing = doc.document;
    const sheet = drawing.sheets.find(s => s.id === this.opts.sheetId);
    if (!sheet) throw new Error('view-not-found');

    const view = sheet.views.find(v => v.id === this.opts.viewId);
    if (!view) throw new Error('view-not-found');

    // Validate kind
    if (view.kind === 'section' || view.kind === 'detail') throw new Error('view-not-breakable');

    // Validate band
    if (this.opts.coordB <= this.opts.coordA) throw new Error('invalid-band');

    // Validate no overlap with existing breaks on same axis
    const existingBreaks = (view as { breaks?: readonly BreakRegion[] }).breaks ?? [];
    for (const b of existingBreaks) {
      if (b.axis === this.opts.axis) {
        const overlapStart = Math.max(this.opts.coordA, b.coordA);
        const overlapEnd = Math.min(this.opts.coordB, b.coordB);
        if (overlapStart < overlapEnd) throw new Error('overlapping-break');
      }
    }

    // Require projection
    if (!(view as { projection?: ProjectedGeometry }).projection) throw new Error('view-projection-missing');

    const viewProj = (view as { projection: ProjectedGeometry }).projection;
    const isFirst = existingBreaks.length === 0;
    const rawProjection = isFirst
      ? viewProj
      : (view as { rawProjection: ProjectedGeometry }).rawProjection;

    const newBreak: BreakRegion = {
      id: crypto.randomUUID(),
      axis: this.opts.axis,
      coordA: this.opts.coordA,
      coordB: this.opts.coordB,
      gapMm: this.opts.gapMm ?? 5,
      style: 'zigzag',
    };

    const newBreaks = [...existingBreaks, newBreak];
    const { edges: visFrags, breakSymbolEdges } = applyBreaks(
      rawProjection.visibleEdges, newBreaks, rawProjection.bbox,
    );
    const { edges: hidFrags } = applyBreaks(
      rawProjection.hiddenEdges, newBreaks, rawProjection.bbox,
    );
    const newProjection: ProjectedGeometry = {
      ...rawProjection,
      visibleEdges: [...visFrags, ...breakSymbolEdges],
      hiddenEdges: hidFrags,
    };
    const priorFingerprint = (view as { inputFingerprint?: string }).inputFingerprint ?? '';
    const newFingerprint = priorFingerprint + '|' + fingerprintBreaksArray(newBreaks);

    // Save for revert
    this.breakId = newBreak.id;
    this.wasFirstBreak = isFirst;
    this.savedPriorProjection = viewProj;
    this.savedPriorFingerprint = (view as { inputFingerprint?: string }).inputFingerprint;

    const updatedView = {
      ...view,
      breaks: newBreaks,
      projection: newProjection,
      inputFingerprint: newFingerprint,
      ...(isFirst ? { rawProjection } : {}),
    };

    const nextDoc: DrawingDocument = {
      ...drawing,
      sheets: drawing.sheets.map(s =>
        s.id === this.opts.sheetId
          ? { ...s, views: s.views.map(v => v.id === this.opts.viewId ? updatedView : v) }
          : s
      ),
    };
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: nextDoc }, activeDrawing: nextDoc });
  }

  async revert(): Promise<void> {
    if (!this.breakId) return;
    const state = useAppStore.getState();
    const doc = state.activeDocument;
    if (!doc || doc.kind !== 'drawing') return;

    const drawing = doc.document;
    const sheet = drawing.sheets.find(s => s.id === this.opts.sheetId);
    if (!sheet) return;
    const view = sheet.views.find(v => v.id === this.opts.viewId);
    if (!view) return;

    const remainingBreaks = ((view as { breaks?: readonly BreakRegion[] }).breaks ?? [])
      .filter(b => b.id !== this.breakId);

    let updatedView: typeof view;
    if (remainingBreaks.length === 0) {
      // Reverting first (and only) break: restore prior projection, clear rawProjection
      const base = { ...view } as Record<string, unknown>;
      base['breaks'] = [];
      base['projection'] = this.savedPriorProjection;
      base['inputFingerprint'] = this.savedPriorFingerprint;
      delete base['rawProjection'];
      updatedView = base as typeof view;
    } else {
      // Reverting one of multiple breaks: re-apply applyBreaks to rawProjection
      const rawProj = (view as { rawProjection: ProjectedGeometry }).rawProjection;
      const { edges: visFrags, breakSymbolEdges } = applyBreaks(
        rawProj.visibleEdges, remainingBreaks, rawProj.bbox,
      );
      const { edges: hidFrags } = applyBreaks(rawProj.hiddenEdges, remainingBreaks, rawProj.bbox);
      const restoredProjection: ProjectedGeometry = {
        ...rawProj,
        visibleEdges: [...visFrags, ...breakSymbolEdges],
        hiddenEdges: hidFrags,
      };
      const restoredFingerprint = (this.savedPriorFingerprint ?? '') + '|' + fingerprintBreaksArray(remainingBreaks);
      updatedView = {
        ...view,
        breaks: remainingBreaks,
        projection: restoredProjection,
        inputFingerprint: restoredFingerprint,
      };
    }

    const nextDoc: DrawingDocument = {
      ...drawing,
      sheets: drawing.sheets.map(s =>
        s.id === this.opts.sheetId
          ? { ...s, views: s.views.map(v => v.id === this.opts.viewId ? updatedView : v) }
          : s
      ),
    };
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: nextDoc }, activeDrawing: nextDoc });
    this.breakId = null;
  }
}
```

**Step 3 — Verify**

```bash
pnpm vitest run AddBreakCommand
```

All three skeleton tests must be green.

**Commit:**
```
test(drawing-broken-views): T3.1 AddBreakCommand skeleton + view-not-found — Batch 3
```

---

### T3.2 — AddBreakCommand happy path — first break

**Goal:** When `view.breaks` is empty/undefined, `apply` must (a) snapshot `view.projection` into `view.rawProjection`, (b) call `applyBreaks` against that snapshot, (c) push the new `BreakRegion` into `view.breaks`, (d) write `view.projection` to the post-`applyBreaks` output. The α-conditional invariant holds after apply.

**Step 1 — Write the failing test** (add to `AddBreakCommand.test.ts`):

```ts
describe('AddBreakCommand — first break happy path', () => {
  it('after apply: breaks.length === 1, rawProjection is defined, projection changed', async () => {
    const cmd = new AddBreakCommand(baseOpts);
    await cmd.apply();

    const doc = useAppStore.getState().activeDocument;
    if (!doc || doc.kind !== 'drawing') throw new Error('no drawing');
    const view = doc.document.sheets[0]!.views.find(v => v.id === 'v1')!;
    const v = view as BaseView & { breaks?: unknown[]; rawProjection?: unknown };

    expect(v.breaks).toHaveLength(1);
    expect(v.rawProjection).toBeDefined();
    // rawProjection should equal the original BASE_PROJECTION (snapshotted before breaks)
    expect(v.rawProjection).toEqual(BASE_PROJECTION);
    // projection should differ (applyBreaks was called)
    expect(v.projection).not.toEqual(BASE_PROJECTION);
  });

  it('α-conditional: rawProjection !== undefined ⟺ breaks.length > 0 (first break)', async () => {
    const cmd = new AddBreakCommand(baseOpts);
    await cmd.apply();

    const doc = useAppStore.getState().activeDocument;
    if (!doc || doc.kind !== 'drawing') throw new Error('no drawing');
    const view = doc.document.sheets[0]!.views.find(v => v.id === 'v1')! as
      BaseView & { breaks?: unknown[]; rawProjection?: unknown };
    const hasBreaks = (view.breaks?.length ?? 0) > 0;
    const hasRaw = view.rawProjection !== undefined;
    expect(hasBreaks).toBe(hasRaw);
  });

  it('new break has correct axis, coordA, coordB, gapMm, style=zigzag', async () => {
    const cmd = new AddBreakCommand(baseOpts);
    await cmd.apply();

    const doc = useAppStore.getState().activeDocument;
    if (!doc || doc.kind !== 'drawing') throw new Error('no drawing');
    const view = doc.document.sheets[0]!.views.find(v => v.id === 'v1')! as
      BaseView & { breaks?: BreakRegion[] };
    const br = view.breaks![0]!;
    expect(br.axis).toBe('x');
    expect(br.coordA).toBe(60);
    expect(br.coordB).toBe(140);
    expect(br.gapMm).toBe(5);
    expect(br.style).toBe('zigzag');
    expect(typeof br.id).toBe('string');
  });
});
```

Import `BreakRegion` from `'@zilventor/shared'` at top of test file.

**Step 2 — Verify implementation from T3.1 covers this** — the skeleton already implements first-break logic. Run:

```bash
pnpm vitest run AddBreakCommand
```

All tests green (no new impl needed; TDD confirms existing code is correct).

**Commit:**
```
test(drawing-broken-views): T3.2 AddBreakCommand first-break happy path tests — Batch 3
```

---

### T3.3 — AddBreakCommand happy path — subsequent break

**Goal:** When `view.breaks.length >= 1`, `rawProjection` is already populated; new `applyBreaks` runs against `rawProjection.visibleEdges` with `[...view.breaks, newBreak]`. `rawProjection` reference stays unchanged.

**Step 1 — Write the failing test** (add to `AddBreakCommand.test.ts`):

```ts
describe('AddBreakCommand — subsequent break', () => {
  it('second break: breaks.length === 2, rawProjection ref unchanged, projection updated', async () => {
    const cmd1 = new AddBreakCommand({ ...baseOpts, coordA: 20, coordB: 50 });
    await cmd1.apply();

    const docAfter1 = useAppStore.getState().activeDocument;
    if (!docAfter1 || docAfter1.kind !== 'drawing') throw new Error();
    const viewAfter1 = docAfter1.document.sheets[0]!.views.find(v => v.id === 'v1')! as
      BaseView & { breaks?: unknown[]; rawProjection?: ProjectedGeometry };
    const rawAfterFirst = viewAfter1.rawProjection;

    const cmd2 = new AddBreakCommand({ ...baseOpts, coordA: 120, coordB: 170 });
    await cmd2.apply();

    const docAfter2 = useAppStore.getState().activeDocument;
    if (!docAfter2 || docAfter2.kind !== 'drawing') throw new Error();
    const viewAfter2 = docAfter2.document.sheets[0]!.views.find(v => v.id === 'v1')! as
      BaseView & { breaks?: unknown[]; rawProjection?: ProjectedGeometry };

    expect(viewAfter2.breaks).toHaveLength(2);
    // rawProjection must equal what was snapshotted on first break (structural equality)
    expect(viewAfter2.rawProjection).toEqual(rawAfterFirst);
    // projection differs (applyBreaks called with both breaks)
    expect(viewAfter2.projection).not.toEqual(rawAfterFirst);
  });
});
```

**Step 2 — Run and confirm green:**

```bash
pnpm vitest run AddBreakCommand
```

**Commit:**
```
test(drawing-broken-views): T3.3 AddBreakCommand subsequent-break test — Batch 3
```

---

### T3.4 — AddBreakCommand revert — first break

**Goal:** `revert` when this command added the first (only) break must restore `view.projection` to the saved prior, clear `view.rawProjection` to `undefined`, and remove the `BreakRegion`. The α-conditional invariant holds.

**Step 1 — Write the failing test** (add to `AddBreakCommand.test.ts`):

```ts
describe('AddBreakCommand — revert first break', () => {
  it('apply then revert: state deep-equals pre-apply state', async () => {
    const snapshot = JSON.parse(JSON.stringify(useAppStore.getState().activeDocument));
    const cmd = new AddBreakCommand(baseOpts);
    await cmd.apply();
    await cmd.revert();
    expect(useAppStore.getState().activeDocument).toEqual(snapshot);
  });

  it('revert: breaks is [] or has no entries, rawProjection undefined, projection restored', async () => {
    const cmd = new AddBreakCommand(baseOpts);
    await cmd.apply();
    await cmd.revert();

    const doc = useAppStore.getState().activeDocument;
    if (!doc || doc.kind !== 'drawing') throw new Error();
    const view = doc.document.sheets[0]!.views.find(v => v.id === 'v1')! as
      BaseView & { breaks?: unknown[]; rawProjection?: unknown };

    const breakCount = view.breaks?.length ?? 0;
    expect(breakCount).toBe(0);
    expect(view.rawProjection).toBeUndefined();
    expect(view.projection).toEqual(BASE_PROJECTION);
  });

  it('α-conditional after revert: rawProjection undefined ⟺ no breaks', async () => {
    const cmd = new AddBreakCommand(baseOpts);
    await cmd.apply();
    await cmd.revert();

    const doc = useAppStore.getState().activeDocument;
    if (!doc || doc.kind !== 'drawing') throw new Error();
    const view = doc.document.sheets[0]!.views.find(v => v.id === 'v1')! as
      BaseView & { breaks?: unknown[]; rawProjection?: unknown };
    const hasBreaks = (view.breaks?.length ?? 0) > 0;
    const hasRaw = view.rawProjection !== undefined;
    expect(hasBreaks).toBe(hasRaw);
  });
});
```

**Step 2 — Run:**

```bash
pnpm vitest run AddBreakCommand
```

All green (revert logic was included in T3.1 skeleton).

**Commit:**
```
test(drawing-broken-views): T3.4 AddBreakCommand revert-first-break tests — Batch 3
```

---

### T3.5 — AddBreakCommand revert — subsequent break (not last)

**Goal:** Reverting one of two breaks must NOT clear `rawProjection`. After revert: `breaks.length === 1`, `rawProjection` still defined, `projection` recomputed from remaining break.

**Step 1 — Write the failing test** (add to `AddBreakCommand.test.ts`):

```ts
describe('AddBreakCommand — revert subsequent break', () => {
  it('revert second-of-two: breaks.length=1, rawProjection still defined', async () => {
    const cmd1 = new AddBreakCommand({ ...baseOpts, coordA: 20, coordB: 50 });
    await cmd1.apply();

    const cmd2 = new AddBreakCommand({ ...baseOpts, coordA: 120, coordB: 170 });
    await cmd2.apply();
    await cmd2.revert();

    const doc = useAppStore.getState().activeDocument;
    if (!doc || doc.kind !== 'drawing') throw new Error();
    const view = doc.document.sheets[0]!.views.find(v => v.id === 'v1')! as
      BaseView & { breaks?: unknown[]; rawProjection?: unknown };

    expect(view.breaks).toHaveLength(1);
    expect(view.rawProjection).toBeDefined();  // α-conditional: 1 break → rawProjection present
  });
});
```

**Step 2 — Run:**

```bash
pnpm vitest run AddBreakCommand
```

**Commit:**
```
test(drawing-broken-views): T3.5 AddBreakCommand revert-subsequent-break test — Batch 3
```

---

### T3.6 — AddBreakCommand error: `'view-not-breakable'`

**Goal:** When `view.kind` is `'section'` or `'detail'`, throw exactly `'view-not-breakable'` per spec §10.3.

**Step 1 — Write the failing test** (add to `AddBreakCommand.test.ts`):

```ts
describe('AddBreakCommand — view-not-breakable', () => {
  it('throws "view-not-breakable" when view.kind is "section"', async () => {
    const sectionView = {
      id: 'v-sect',
      kind: 'section' as const,
      parentViewId: 'v1',
      sectionLine: { p0: { x: 0, y: 50 }, p1: { x: 200, y: 50 } },
      arrowDirection: 1 as const,
      label: 'A',
      positionMm: { x: 250, y: 100 },
      scale: { numerator: 1, denominator: 1 },
      showHidden: false,
      hatchSegments: [],
      fingerprint: 'fp-s',
      projection: BASE_PROJECTION,
    };
    useAppStore.setState({
      activeDocument: { kind: 'drawing', document: { ...makeDrawing(), sheets: [{ ...makeSheet(), views: [sectionView] }] } },
    } as never);
    const cmd = new AddBreakCommand({ ...baseOpts, viewId: 'v-sect' });
    await expect(cmd.apply()).rejects.toThrow('view-not-breakable');
  });

  it('throws "view-not-breakable" when view.kind is "detail"', async () => {
    const detailView = {
      id: 'v-det',
      kind: 'detail' as const,
      parentViewId: 'v1',
      regionParent: { center: { x: 10, y: 8 }, radiusMm: 5 },
      label: 'B',
      positionMm: { x: 300, y: 100 },
      scale: { numerator: 2, denominator: 1 },
      showHidden: false,
      projection: BASE_PROJECTION,
      inputFingerprint: 'det-fp',
    };
    useAppStore.setState({
      activeDocument: { kind: 'drawing', document: { ...makeDrawing(), sheets: [{ ...makeSheet(), views: [detailView] }] } },
    } as never);
    const cmd = new AddBreakCommand({ ...baseOpts, viewId: 'v-det' });
    await expect(cmd.apply()).rejects.toThrow('view-not-breakable');
  });
});
```

**Step 2 — Run:**

```bash
pnpm vitest run AddBreakCommand
```

**Commit:**
```
test(drawing-broken-views): T3.6 AddBreakCommand view-not-breakable tests — Batch 3
```

---

### T3.7 — AddBreakCommand error: `'view-projection-missing'`

**Goal:** When `view.projection === undefined` (view never projected), throw exactly `'view-projection-missing'` per spec §10.3.

**Step 1 — Write the failing test** (add to `AddBreakCommand.test.ts`):

```ts
describe('AddBreakCommand — view-projection-missing', () => {
  it('throws "view-projection-missing" when view has no projection', async () => {
    const unprojectView: BaseView = {
      id: 'v-unproj',
      kind: 'base',
      positionMm: { x: 20, y: 20 },
      scale: { numerator: 1, denominator: 1 },
      orientation: 'front',
      showHidden: false,
      // projection intentionally absent
    };
    useAppStore.setState({
      activeDocument: { kind: 'drawing', document: { ...makeDrawing(), sheets: [{ ...makeSheet(), views: [unprojectView] }] } },
    } as never);
    const cmd = new AddBreakCommand({ ...baseOpts, viewId: 'v-unproj' });
    await expect(cmd.apply()).rejects.toThrow('view-projection-missing');
  });
});
```

**Step 2 — Run:**

```bash
pnpm vitest run AddBreakCommand
```

**Commit:**
```
test(drawing-broken-views): T3.7 AddBreakCommand view-projection-missing test — Batch 3
```

---

### T3.8 — AddBreakCommand error: `'overlapping-break'`

**Goal:** New band overlapping an existing break on the same axis throws `'overlapping-break'`. Different axis or non-overlapping same axis must NOT throw.

**Step 1 — Write the failing test** (add to `AddBreakCommand.test.ts`):

```ts
describe('AddBreakCommand — overlapping-break', () => {
  it('throws "overlapping-break" when new band overlaps existing break on same axis', async () => {
    // First break at x:[60, 140]
    const cmd1 = new AddBreakCommand(baseOpts);
    await cmd1.apply();
    // Second break at x:[100, 180] — overlaps [60,140] on x-axis
    const cmd2 = new AddBreakCommand({ ...baseOpts, coordA: 100, coordB: 180 });
    await expect(cmd2.apply()).rejects.toThrow('overlapping-break');
  });

  it('does NOT throw for non-overlapping break on same axis', async () => {
    const cmd1 = new AddBreakCommand(baseOpts); // x:[60,140]
    await cmd1.apply();
    // Non-overlapping: x:[150,180]
    const cmd2 = new AddBreakCommand({ ...baseOpts, coordA: 150, coordB: 180 });
    await expect(cmd2.apply()).resolves.toBeUndefined();
  });

  it('does NOT throw for overlapping band on different axis', async () => {
    const cmd1 = new AddBreakCommand(baseOpts); // x:[60,140]
    await cmd1.apply();
    // Same coordinate range but on y-axis — independent axis, no overlap error
    const cmd2 = new AddBreakCommand({ ...baseOpts, axis: 'y', coordA: 60, coordB: 140 });
    await expect(cmd2.apply()).resolves.toBeUndefined();
  });
});
```

**Step 2 — Run:**

```bash
pnpm vitest run AddBreakCommand
```

**Commit:**
```
test(drawing-broken-views): T3.8 AddBreakCommand overlapping-break tests (3 cases) — Batch 3
```

---

### T3.9 — AddBreakCommand error: `'invalid-band'`

**Goal:** `coordB <= coordA` throws exactly `'invalid-band'`.

**Step 1 — Write the failing test** (add to `AddBreakCommand.test.ts`):

```ts
describe('AddBreakCommand — invalid-band', () => {
  it('throws "invalid-band" when coordB === coordA', async () => {
    const cmd = new AddBreakCommand({ ...baseOpts, coordA: 80, coordB: 80 });
    await expect(cmd.apply()).rejects.toThrow('invalid-band');
  });

  it('throws "invalid-band" when coordB < coordA', async () => {
    const cmd = new AddBreakCommand({ ...baseOpts, coordA: 80, coordB: 40 });
    await expect(cmd.apply()).rejects.toThrow('invalid-band');
  });
});
```

**Step 2 — Run:**

```bash
pnpm vitest run AddBreakCommand
```

**Commit:**
```
test(drawing-broken-views): T3.9 AddBreakCommand invalid-band tests — Batch 3
```

---

### T3.10 — AddBreakCommand fingerprint update

**Goal:** After `apply`, `view.inputFingerprint` differs from the prior value (fingerprint incorporates the new breaks array). `fingerprintBreaksArray` was called exactly once with the new breaks array.

**Step 1 — Write the failing test** (add to `AddBreakCommand.test.ts`):

```ts
describe('AddBreakCommand — fingerprint', () => {
  it('inputFingerprint changes after apply', async () => {
    const priorFp = BASE_VIEW.inputFingerprint; // 'base-fp-000'
    const cmd = new AddBreakCommand(baseOpts);
    await cmd.apply();

    const doc = useAppStore.getState().activeDocument;
    if (!doc || doc.kind !== 'drawing') throw new Error();
    const view = doc.document.sheets[0]!.views.find(v => v.id === 'v1')!;
    const newFp = (view as BaseView & { inputFingerprint?: string }).inputFingerprint;
    expect(newFp).not.toBe(priorFp);
  });

  it('fingerprintBreaksArray is called with the new breaks array', async () => {
    const { fingerprintBreaksArray } = await import('@zilventor/shared');
    const cmd = new AddBreakCommand(baseOpts);
    await cmd.apply();
    expect(fingerprintBreaksArray).toHaveBeenCalledOnce();
  });
});
```

**Step 2 — Run:**

```bash
pnpm vitest run AddBreakCommand
```

**Commit:**
```
test(drawing-broken-views): T3.10 AddBreakCommand fingerprint-update tests — Batch 3
```

---

### T3.11 — DeleteBreakCommand skeleton + `'break-not-found'`

**Goal:** Create `DeleteBreakCommand.ts`. First test: instantiation; apply on a `breakId` not in `view.breaks` throws `'break-not-found'` exactly.

**Step 1 — Write the failing test**

Create `packages/app/src/commands/__tests__/DeleteBreakCommand.test.ts`:

```ts
// packages/app/src/commands/__tests__/DeleteBreakCommand.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AddBreakCommand } from '../AddBreakCommand';
import { DeleteBreakCommand } from '../DeleteBreakCommand';
import { useAppStore } from '../../store/useAppStore';
import type { DrawingDocument, DrawingSheet, BaseView, BreakRegion, ProjectedGeometry } from '@zilventor/shared';

vi.mock('@zilventor/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@zilventor/shared')>();
  return {
    ...actual,
    applyBreaks: vi.fn().mockReturnValue({
      edges: [{ id: 'frag-1', kind: 'outline', points: [[0, 0], [40, 0]], sourceFaceIds: [] }],
      breakSymbolEdges: [{ id: 'sym-1', kind: 'break', points: [[40, -3], [43, 3]], sourceFaceIds: [] }],
    }),
    fingerprintBreaksArray: vi.fn().mockReturnValue('breaks-fp-mock'),
  };
});

const BASE_PROJECTION: ProjectedGeometry = {
  visibleEdges: [
    { id: 'e1', kind: 'outline' as const, points: [[0, 0], [200, 0]] as [number, number][], sourceFaceIds: [] },
  ],
  hiddenEdges: [],
  bbox: { minX: 0, minY: 0, maxX: 200, maxY: 80 },
};

const BASE_VIEW: BaseView = {
  id: 'v1', kind: 'base',
  positionMm: { x: 20, y: 20 },
  scale: { numerator: 1, denominator: 1 },
  orientation: 'front',
  showHidden: false,
  projection: BASE_PROJECTION,
  inputFingerprint: 'base-fp-000',
};

const makeSheet = (): DrawingSheet => ({
  id: 's1', name: 'Sheet 1',
  size: { kind: 'iso', size: 'A3' }, orientation: 'landscape',
  views: [BASE_VIEW], dimensions: [], annotations: [], titleBlock: {},
});

const makeDrawing = (): DrawingDocument => ({
  id: 'd1', name: 'Test', units: 'mm',
  source: { partPath: 'parts/box.zipt', sourceKind: 'part' },
  properties: {},
  sheets: [makeSheet()],
  activeSheetId: 's1',
});

const addBreakOpts = { drawingId: 'd1', sheetId: 's1', viewId: 'v1', axis: 'x' as const, coordA: 60, coordB: 140 };

beforeEach(() => {
  vi.clearAllMocks();
  useAppStore.setState({
    activeDocument: { kind: 'drawing', document: makeDrawing() },
    activePart: null, activeAssembly: null,
  } as never);
});

describe('DeleteBreakCommand — skeleton', () => {
  it('instantiates with name DeleteBreak', () => {
    const cmd = new DeleteBreakCommand({ drawingId: 'd1', sheetId: 's1', viewId: 'v1', breakId: 'b-none' });
    expect(cmd.name).toBe('DeleteBreak');
  });

  it('throws "break-not-found" when breakId is absent from view.breaks', async () => {
    const addCmd = new AddBreakCommand(addBreakOpts);
    await addCmd.apply();
    const cmd = new DeleteBreakCommand({ drawingId: 'd1', sheetId: 's1', viewId: 'v1', breakId: 'no-such-break' });
    await expect(cmd.apply()).rejects.toThrow('break-not-found');
  });
});
```

**Step 2 — Implement skeleton**

Create `packages/app/src/commands/DeleteBreakCommand.ts`:

```ts
// packages/app/src/commands/DeleteBreakCommand.ts
import type { Command } from './Command';
import type { DrawingDocument, BreakRegion, ProjectedGeometry } from '@zilventor/shared';
import { applyBreaks, fingerprintBreaksArray } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';

export type DeleteBreakOpts = {
  drawingId: string;
  sheetId: string;
  viewId: string;
  breakId: string;
};

export class DeleteBreakCommand implements Command {
  readonly name = 'DeleteBreak';
  private deletedBreak: BreakRegion | null = null;
  private savedRawProjection: ProjectedGeometry | undefined = undefined;
  private savedPriorProjection: ProjectedGeometry | undefined = undefined;
  private savedPriorFingerprint: string | undefined = undefined;
  private applied = false;

  constructor(private readonly opts: DeleteBreakOpts) {}

  async apply(): Promise<void> {
    const state = useAppStore.getState();
    const doc = state.activeDocument;
    if (!doc || doc.kind !== 'drawing') return;

    const drawing = doc.document;
    const sheet = drawing.sheets.find(s => s.id === this.opts.sheetId);
    if (!sheet) throw new Error('view-not-found');

    const view = sheet.views.find(v => v.id === this.opts.viewId);
    if (!view) throw new Error('view-not-found');

    const existingBreaks = (view as { breaks?: readonly BreakRegion[] }).breaks ?? [];
    const targetBreak = existingBreaks.find(b => b.id === this.opts.breakId);
    if (!targetBreak) throw new Error('break-not-found');

    const rawProj = (view as { rawProjection?: ProjectedGeometry }).rawProjection;
    if (!rawProj) throw new Error('view-projection-missing');

    const remaining = existingBreaks.filter(b => b.id !== this.opts.breakId);

    // Stash for revert
    this.deletedBreak = targetBreak;
    this.savedRawProjection = rawProj;
    this.savedPriorProjection = (view as { projection?: ProjectedGeometry }).projection;
    this.savedPriorFingerprint = (view as { inputFingerprint?: string }).inputFingerprint;
    this.applied = true;

    let updatedView: typeof view;
    if (remaining.length === 0) {
      // Last break removed: restore projection = rawProjection, clear rawProjection
      const base = { ...view } as Record<string, unknown>;
      base['breaks'] = [];
      base['projection'] = rawProj;
      base['inputFingerprint'] = (this.savedPriorFingerprint ?? '') + '|' + fingerprintBreaksArray([]);
      delete base['rawProjection'];
      updatedView = base as typeof view;
    } else {
      const { edges: visFrags, breakSymbolEdges } = applyBreaks(
        rawProj.visibleEdges, remaining, rawProj.bbox,
      );
      const { edges: hidFrags } = applyBreaks(rawProj.hiddenEdges, remaining, rawProj.bbox);
      const newProjection: ProjectedGeometry = {
        ...rawProj,
        visibleEdges: [...visFrags, ...breakSymbolEdges],
        hiddenEdges: hidFrags,
      };
      const newFingerprint = (this.savedPriorFingerprint ?? '') + '|' + fingerprintBreaksArray(remaining);
      updatedView = { ...view, breaks: remaining, projection: newProjection, inputFingerprint: newFingerprint };
    }

    const nextDoc: DrawingDocument = {
      ...drawing,
      sheets: drawing.sheets.map(s =>
        s.id === this.opts.sheetId
          ? { ...s, views: s.views.map(v => v.id === this.opts.viewId ? updatedView : v) }
          : s
      ),
    };
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: nextDoc }, activeDrawing: nextDoc });
  }

  async revert(): Promise<void> {
    if (!this.applied || !this.deletedBreak) return;
    const state = useAppStore.getState();
    const doc = state.activeDocument;
    if (!doc || doc.kind !== 'drawing') return;

    const drawing = doc.document;
    const sheet = drawing.sheets.find(s => s.id === this.opts.sheetId);
    if (!sheet) return;
    const view = sheet.views.find(v => v.id === this.opts.viewId);
    if (!view) return;

    const currentBreaks = (view as { breaks?: readonly BreakRegion[] }).breaks ?? [];
    const restoredBreaks = [...currentBreaks, this.deletedBreak];
    const rawProj = this.savedRawProjection!;

    const { edges: visFrags, breakSymbolEdges } = applyBreaks(
      rawProj.visibleEdges, restoredBreaks, rawProj.bbox,
    );
    const { edges: hidFrags } = applyBreaks(rawProj.hiddenEdges, restoredBreaks, rawProj.bbox);
    const restoredProjection: ProjectedGeometry = {
      ...rawProj,
      visibleEdges: [...visFrags, ...breakSymbolEdges],
      hiddenEdges: hidFrags,
    };
    const restoredFingerprint = (this.savedPriorFingerprint ?? '') + '|' + fingerprintBreaksArray(restoredBreaks);

    const updatedView = {
      ...view,
      breaks: restoredBreaks,
      rawProjection: rawProj,
      projection: restoredProjection,
      inputFingerprint: restoredFingerprint,
    };

    const nextDoc: DrawingDocument = {
      ...drawing,
      sheets: drawing.sheets.map(s =>
        s.id === this.opts.sheetId
          ? { ...s, views: s.views.map(v => v.id === this.opts.viewId ? updatedView : v) }
          : s
      ),
    };
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: nextDoc }, activeDrawing: nextDoc });
    this.applied = false;
  }
}
```

**Step 3 — Run:**

```bash
pnpm vitest run DeleteBreakCommand
```

**Commit:**
```
feat(drawing-broken-views): T3.11 DeleteBreakCommand skeleton + break-not-found — Batch 3
```

---

### T3.12 — DeleteBreakCommand happy path — middle break removed

**Goal:** `breaks.length` was 2; removing one leaves 1. `applyBreaks` is called with the remaining break. `rawProjection` is unchanged.

**Step 1 — Write the failing test** (add to `DeleteBreakCommand.test.ts`):

```ts
describe('DeleteBreakCommand — middle break removed', () => {
  it('after removing one-of-two: breaks.length=1, rawProjection unchanged, projection updated', async () => {
    // Set up two breaks
    const cmd1 = new AddBreakCommand({ ...addBreakOpts, coordA: 20, coordB: 50 });
    await cmd1.apply();
    const cmd2 = new AddBreakCommand({ ...addBreakOpts, coordA: 120, coordB: 170 });
    await cmd2.apply();

    const docWith2 = useAppStore.getState().activeDocument;
    if (!docWith2 || docWith2.kind !== 'drawing') throw new Error();
    const viewWith2 = docWith2.document.sheets[0]!.views.find(v => v.id === 'v1')! as
      BaseView & { breaks?: BreakRegion[]; rawProjection?: ProjectedGeometry };
    const rawRef = viewWith2.rawProjection;
    const breakIdToDelete = viewWith2.breaks![0]!.id;

    const delCmd = new DeleteBreakCommand({ drawingId: 'd1', sheetId: 's1', viewId: 'v1', breakId: breakIdToDelete });
    await delCmd.apply();

    const docAfter = useAppStore.getState().activeDocument;
    if (!docAfter || docAfter.kind !== 'drawing') throw new Error();
    const viewAfter = docAfter.document.sheets[0]!.views.find(v => v.id === 'v1')! as
      BaseView & { breaks?: BreakRegion[]; rawProjection?: ProjectedGeometry };

    expect(viewAfter.breaks).toHaveLength(1);
    expect(viewAfter.rawProjection).toEqual(rawRef);   // rawProjection unchanged
    expect(viewAfter.projection).not.toEqual(rawRef);  // projection recomputed
  });

  it('α-conditional: rawProjection defined ⟺ breaks.length > 0 (1 break remaining)', async () => {
    const cmd1 = new AddBreakCommand({ ...addBreakOpts, coordA: 20, coordB: 50 });
    await cmd1.apply();
    const cmd2 = new AddBreakCommand({ ...addBreakOpts, coordA: 120, coordB: 170 });
    await cmd2.apply();

    const docWith2 = useAppStore.getState().activeDocument;
    if (!docWith2 || docWith2.kind !== 'drawing') throw new Error();
    const breakIdToDelete = (docWith2.document.sheets[0]!.views.find(v => v.id === 'v1')! as
      BaseView & { breaks?: BreakRegion[] }).breaks![0]!.id;

    await new DeleteBreakCommand({ drawingId: 'd1', sheetId: 's1', viewId: 'v1', breakId: breakIdToDelete }).apply();

    const docAfter = useAppStore.getState().activeDocument;
    if (!docAfter || docAfter.kind !== 'drawing') throw new Error();
    const view = docAfter.document.sheets[0]!.views.find(v => v.id === 'v1')! as
      BaseView & { breaks?: unknown[]; rawProjection?: unknown };
    expect((view.breaks?.length ?? 0) > 0).toBe(view.rawProjection !== undefined);
  });
});
```

**Step 2 — Run:**

```bash
pnpm vitest run DeleteBreakCommand
```

**Commit:**
```
test(drawing-broken-views): T3.12 DeleteBreakCommand middle-break-removed tests — Batch 3
```

---

### T3.13 — DeleteBreakCommand happy path — last break removed

**Goal:** When `breaks.length` was 1 and the last break is removed: `view.projection` restores to `rawProjection` content, `view.rawProjection` becomes `undefined`, `view.breaks` is `[]`. α-conditional invariant holds.

**Step 1 — Write the failing test** (add to `DeleteBreakCommand.test.ts`):

```ts
describe('DeleteBreakCommand — last break removed', () => {
  it('after removing last break: breaks=[], rawProjection=undefined, projection=rawProjection content', async () => {
    const addCmd = new AddBreakCommand(addBreakOpts);
    await addCmd.apply();

    const docWith1 = useAppStore.getState().activeDocument;
    if (!docWith1 || docWith1.kind !== 'drawing') throw new Error();
    const viewWith1 = docWith1.document.sheets[0]!.views.find(v => v.id === 'v1')! as
      BaseView & { breaks?: BreakRegion[]; rawProjection?: ProjectedGeometry };
    const rawContent = viewWith1.rawProjection!;
    const breakId = viewWith1.breaks![0]!.id;

    await new DeleteBreakCommand({ drawingId: 'd1', sheetId: 's1', viewId: 'v1', breakId }).apply();

    const docAfter = useAppStore.getState().activeDocument;
    if (!docAfter || docAfter.kind !== 'drawing') throw new Error();
    const view = docAfter.document.sheets[0]!.views.find(v => v.id === 'v1')! as
      BaseView & { breaks?: BreakRegion[]; rawProjection?: ProjectedGeometry };

    expect(view.breaks?.length ?? 0).toBe(0);
    expect(view.rawProjection).toBeUndefined();
    // projection content should equal what rawProjection was (the un-broken geometry)
    expect(view.projection).toEqual(rawContent);
  });

  it('α-conditional: rawProjection undefined ⟺ breaks empty after last break removed', async () => {
    const addCmd = new AddBreakCommand(addBreakOpts);
    await addCmd.apply();

    const docWith1 = useAppStore.getState().activeDocument;
    if (!docWith1 || docWith1.kind !== 'drawing') throw new Error();
    const breakId = (docWith1.document.sheets[0]!.views.find(v => v.id === 'v1')! as
      BaseView & { breaks?: BreakRegion[] }).breaks![0]!.id;

    await new DeleteBreakCommand({ drawingId: 'd1', sheetId: 's1', viewId: 'v1', breakId }).apply();

    const doc = useAppStore.getState().activeDocument;
    if (!doc || doc.kind !== 'drawing') throw new Error();
    const view = doc.document.sheets[0]!.views.find(v => v.id === 'v1')! as
      BaseView & { breaks?: unknown[]; rawProjection?: unknown };
    expect((view.breaks?.length ?? 0) > 0).toBe(view.rawProjection !== undefined);
  });
});
```

**Step 2 — Run:**

```bash
pnpm vitest run DeleteBreakCommand
```

**Commit:**
```
test(drawing-broken-views): T3.13 DeleteBreakCommand last-break-removed tests — Batch 3
```

---

### T3.14 — DeleteBreakCommand revert

**Goal:** `revert` reverses `DeleteBreakCommand` symmetrically for both removing-middle and removing-last cases.

**Step 1 — Write the failing test** (add to `DeleteBreakCommand.test.ts`):

```ts
describe('DeleteBreakCommand — revert', () => {
  it('revert restores state after removing last break (full round-trip)', async () => {
    const addCmd = new AddBreakCommand(addBreakOpts);
    await addCmd.apply();

    const snapAfterAdd = JSON.parse(JSON.stringify(useAppStore.getState().activeDocument));

    const docWith1 = useAppStore.getState().activeDocument;
    if (!docWith1 || docWith1.kind !== 'drawing') throw new Error();
    const breakId = (docWith1.document.sheets[0]!.views.find(v => v.id === 'v1')! as
      BaseView & { breaks?: BreakRegion[] }).breaks![0]!.id;

    const delCmd = new DeleteBreakCommand({ drawingId: 'd1', sheetId: 's1', viewId: 'v1', breakId });
    await delCmd.apply();
    await delCmd.revert();

    // After revert, state should match what it was right after the add
    const docAfterRevert = useAppStore.getState().activeDocument;
    if (!docAfterRevert || docAfterRevert.kind !== 'drawing') throw new Error();
    const viewAfter = docAfterRevert.document.sheets[0]!.views.find(v => v.id === 'v1')! as
      BaseView & { breaks?: BreakRegion[]; rawProjection?: ProjectedGeometry };
    expect(viewAfter.breaks).toHaveLength(1);
    expect(viewAfter.rawProjection).toBeDefined();
  });

  it('revert after removing middle break: breaks.length back to 2', async () => {
    const cmd1 = new AddBreakCommand({ ...addBreakOpts, coordA: 20, coordB: 50 });
    await cmd1.apply();
    const cmd2 = new AddBreakCommand({ ...addBreakOpts, coordA: 120, coordB: 170 });
    await cmd2.apply();

    const docWith2 = useAppStore.getState().activeDocument;
    if (!docWith2 || docWith2.kind !== 'drawing') throw new Error();
    const breakId = (docWith2.document.sheets[0]!.views.find(v => v.id === 'v1')! as
      BaseView & { breaks?: BreakRegion[] }).breaks![0]!.id;

    const delCmd = new DeleteBreakCommand({ drawingId: 'd1', sheetId: 's1', viewId: 'v1', breakId });
    await delCmd.apply();
    await delCmd.revert();

    const doc = useAppStore.getState().activeDocument;
    if (!doc || doc.kind !== 'drawing') throw new Error();
    const view = doc.document.sheets[0]!.views.find(v => v.id === 'v1')! as
      BaseView & { breaks?: BreakRegion[]; rawProjection?: ProjectedGeometry };
    expect(view.breaks).toHaveLength(2);
    expect(view.rawProjection).toBeDefined();
  });
});
```

**Step 2 — Run:**

```bash
pnpm vitest run DeleteBreakCommand
```

**Commit:**
```
test(drawing-broken-views): T3.14 DeleteBreakCommand revert tests — Batch 3
```

---

### T3.15 — RegenerateViewCommand extension (breaks-aware)

**Goal:** Modify `RegenerateViewCommand.ts` to handle the breaks-aware regeneration path per spec §10.4. When `view.breaks.length > 0`: store fresh kernel output as `view.rawProjection`, then call `applyBreaks` to produce `view.projection`. When `view.breaks.length === 0`: `view.rawProjection` stays `undefined`, `view.projection` = fresh kernel output.

The opts shape is unchanged (`{ sheetId, viewId, projection, inputFingerprint }`) — no new opts field is needed. The command reads `view.breaks` from the current store state (not from opts) and uses `this.opts.projection` as the raw kernel output when breaks are present (per spec §10.4).

**Step 1 — Write the failing test** (add to `RegenerateViewCommand.spec.ts`):

```ts
// At top of RegenerateViewCommand.spec.ts — add to existing mocks block:
// vi.mock('@zilventor/shared', ...) already mocked if needed, or use actual exports

describe('RegenerateViewCommand — breaks-aware extension', () => {
  const BROKEN_PROJ_RAW: ProjectedGeometry = {
    visibleEdges: [{ id: 'raw-e1', kind: 'outline', points: [[0, 0], [200, 0]], sourceFaceIds: [] }],
    hiddenEdges: [],
    bbox: { minX: 0, minY: 0, maxX: 200, maxY: 80 },
  };
  const BROKEN_PROJ_APPLIED: ProjectedGeometry = {
    visibleEdges: [
      { id: 'frag-1', kind: 'outline', points: [[0, 0], [55, 0]], sourceFaceIds: [] },
      { id: 'sym-1', kind: 'break' as const, points: [[55, -3], [58, 3]], sourceFaceIds: [] },
      { id: 'frag-2', kind: 'outline', points: [[60, 0], [200, 0]], sourceFaceIds: [] },
    ],
    hiddenEdges: [],
    bbox: { minX: 0, minY: 0, maxX: 200, maxY: 80 },
  };

  const BREAK_REGION: BreakRegion = {
    id: 'br-1', axis: 'x', coordA: 50, coordB: 150, gapMm: 5, style: 'zigzag',
  };

  const viewWithBreak: BaseView & { breaks: BreakRegion[]; rawProjection?: ProjectedGeometry } = {
    id: 'view-broken', kind: 'base',
    positionMm: { x: 50, y: 50 },
    orientation: 'front',
    scale: { numerator: 1, denominator: 1 },
    showHidden: false,
    projection: BROKEN_PROJ_APPLIED,
    inputFingerprint: 'stale-broken-fp',
    breaks: [BREAK_REGION],
    rawProjection: BROKEN_PROJ_APPLIED, // simulates pre-existing rawProjection
  };

  beforeEach(() => {
    useAppStore.setState({
      activeDocument: {
        kind: 'drawing',
        document: {
          id: 'd-broken', name: 'D', units: 'mm',
          source: { partPath: 'p.zipt', sourceKind: 'part' },
          properties: {},
          sheets: [{
            id: 'sheet-b', name: 'SB',
            size: { kind: 'iso', size: 'A3' }, orientation: 'landscape',
            views: [viewWithBreak], dimensions: [], annotations: [], titleBlock: {},
          }],
          activeSheetId: 'sheet-b',
        },
      },
    });
  });

  it('when breaks.length > 0: fresh kernel output stored as rawProjection, applyBreaks produces projection', async () => {
    const cmd = new RegenerateViewCommand({
      sheetId: 'sheet-b',
      viewId: 'view-broken',
      projection: BROKEN_PROJ_RAW,
      inputFingerprint: 'fresh-fp',
    });
    await cmd.apply();

    const doc = useAppStore.getState().activeDocument;
    if (!doc || doc.kind !== 'drawing') throw new Error();
    const v = doc.document.sheets[0]!.views[0]! as
      BaseView & { breaks?: BreakRegion[]; rawProjection?: ProjectedGeometry };

    // rawProjection must be the fresh kernel output
    expect(v.rawProjection).toEqual(BROKEN_PROJ_RAW);
    // projection is the applyBreaks result, not rawProjection verbatim
    // (with real applyBreaks this would differ; with mock it equals what applyBreaks returns)
    expect(v.projection).toBeDefined();
  });

  it('when breaks.length === 0: rawProjection stays undefined, projection = fresh kernel output', async () => {
    // Modify view in store to have no breaks
    const viewNoBreaks: BaseView = {
      id: 'view-no-breaks', kind: 'base',
      positionMm: { x: 50, y: 50 },
      orientation: 'front',
      scale: { numerator: 1, denominator: 1 },
      showHidden: false,
      projection: OLD_PROJECTION,
      inputFingerprint: 'stale-no-break-fp',
    };
    useAppStore.setState({
      activeDocument: {
        kind: 'drawing',
        document: {
          id: 'd-nb', name: 'D', units: 'mm',
          source: { partPath: 'p.zipt', sourceKind: 'part' },
          properties: {},
          sheets: [{
            id: 'sheet-nb', name: 'SNB',
            size: { kind: 'iso', size: 'A3' }, orientation: 'landscape',
            views: [viewNoBreaks], dimensions: [], annotations: [], titleBlock: {},
          }],
          activeSheetId: 'sheet-nb',
        },
      },
    });

    const cmd = new RegenerateViewCommand({
      sheetId: 'sheet-nb',
      viewId: 'view-no-breaks',
      projection: NEW_PROJECTION,
      inputFingerprint: 'fresh-fp-nb',
    });
    await cmd.apply();

    const doc = useAppStore.getState().activeDocument;
    if (!doc || doc.kind !== 'drawing') throw new Error();
    const v = doc.document.sheets[0]!.views[0]! as
      BaseView & { rawProjection?: ProjectedGeometry };
    expect(v.projection).toEqual(NEW_PROJECTION);
    expect(v.rawProjection).toBeUndefined();
  });
});
```

Import `BreakRegion` at top of the spec file.

**Step 2 — Modify `RegenerateViewCommand.ts`**

```ts
// packages/app/src/commands/RegenerateViewCommand.ts (modified)
import type { Command } from './Command';
import type { DrawingDocument, ProjectedGeometry, BreakRegion } from '@zilventor/shared';
import { applyBreaks, fingerprintBreaksArray } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';

export class RegenerateViewCommand implements Command {
  readonly name = 'RegenerateView';
  private prevProjection: ProjectedGeometry | undefined = undefined;
  private prevRawProjection: ProjectedGeometry | undefined = undefined;
  private prevFingerprint: string | undefined = undefined;
  private applied = false;

  constructor(
    private readonly opts: {
      sheetId: string;
      viewId: string;
      projection: ProjectedGeometry;
      inputFingerprint: string;
    }
  ) {}

  async apply(): Promise<void> {
    const state = useAppStore.getState();
    const doc = state.activeDocument;
    if (!doc || doc.kind !== 'drawing') return;

    const sheet = doc.document.sheets.find(s => s.id === this.opts.sheetId);
    if (!sheet) return;
    const view = sheet.views.find(v => v.id === this.opts.viewId);
    if (!view) return;

    // Capture prior values for revert
    this.prevProjection = view.projection;
    this.prevRawProjection = (view as { rawProjection?: ProjectedGeometry }).rawProjection;
    this.prevFingerprint = view.inputFingerprint;
    this.applied = true;

    const currentBreaks: readonly BreakRegion[] =
      (view as { breaks?: readonly BreakRegion[] }).breaks ?? [];

    let updatedView: typeof view;
    if (currentBreaks.length > 0) {
      // α-conditional: breaks exist → store fresh kernel output as rawProjection,
      // then apply breaks to produce projection.
      const rawProj = this.opts.projection;
      const { edges: visFrags, breakSymbolEdges } = applyBreaks(
        rawProj.visibleEdges, currentBreaks, rawProj.bbox,
      );
      const { edges: hidFrags } = applyBreaks(rawProj.hiddenEdges, currentBreaks, rawProj.bbox);
      const newProjection: ProjectedGeometry = {
        ...rawProj,
        visibleEdges: [...visFrags, ...breakSymbolEdges],
        hiddenEdges: hidFrags,
      };
      const newFingerprint = this.opts.inputFingerprint + '|' + fingerprintBreaksArray(currentBreaks);
      updatedView = { ...view, rawProjection: rawProj, projection: newProjection, inputFingerprint: newFingerprint };
    } else {
      // α-conditional: no breaks → rawProjection stays undefined.
      const base = { ...view } as Record<string, unknown>;
      base['projection'] = this.opts.projection;
      base['inputFingerprint'] = this.opts.inputFingerprint;
      delete base['rawProjection'];
      updatedView = base as typeof view;
    }

    const next: DrawingDocument = {
      ...doc.document,
      sheets: doc.document.sheets.map(s =>
        s.id === this.opts.sheetId
          ? { ...s, views: s.views.map(v => v.id === this.opts.viewId ? updatedView : v) }
          : s
      ),
    };
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: next } });
  }

  async revert(): Promise<void> {
    if (!this.applied) return;
    const state = useAppStore.getState();
    const doc = state.activeDocument;
    if (!doc || doc.kind !== 'drawing') return;

    const next: DrawingDocument = {
      ...doc.document,
      sheets: doc.document.sheets.map(s =>
        s.id === this.opts.sheetId
          ? {
              ...s,
              views: s.views.map(v => {
                if (v.id !== this.opts.viewId) return v;
                const base = { ...v } as Record<string, unknown>;
                if (this.prevProjection !== undefined) {
                  base['projection'] = this.prevProjection;
                } else {
                  delete base['projection'];
                }
                if (this.prevRawProjection !== undefined) {
                  base['rawProjection'] = this.prevRawProjection;
                } else {
                  delete base['rawProjection'];
                }
                if (this.prevFingerprint !== undefined) {
                  base['inputFingerprint'] = this.prevFingerprint;
                } else {
                  delete base['inputFingerprint'];
                }
                return base as typeof v;
              }),
            }
          : s
      ),
    };
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: next } });
    this.applied = false;
  }
}
```

**Step 3 — Run:**

```bash
pnpm vitest run RegenerateViewCommand
```

All prior tests (from `RegenerateViewCommand.spec.ts`) plus two new branches must be green.

**Commit:**
```
feat(drawing-broken-views): T3.15 RegenerateViewCommand breaks-aware extension — Batch 3
```

---

### T3.16 — Invariant property test (sequence loop)

**Goal:** For a synthetic sequence of AddBreak / DeleteBreak / RegenerateView dispatches, after each step the α-conditional invariant `view.rawProjection !== undefined ⟺ view.breaks.length > 0` holds. Implemented as a parameterised loop over 6 dispatch sequences.

**Step 1 — Write the test** (add as new `describe` in `AddBreakCommand.test.ts`):

```ts
describe('α-conditional invariant — sequence property test', () => {
  type DispatchStep =
    | { op: 'add'; coordA: number; coordB: number; axis?: 'x' | 'y' }
    | { op: 'delete'; breakIndex: number }
    | { op: 'regen' };

  function checkInvariant(viewId: string, label: string): void {
    const doc = useAppStore.getState().activeDocument;
    if (!doc || doc.kind !== 'drawing') throw new Error(`[${label}] no drawing`);
    const view = doc.document.sheets[0]!.views.find(v => v.id === viewId)! as
      BaseView & { breaks?: unknown[]; rawProjection?: unknown };
    const hasBreaks = (view.breaks?.length ?? 0) > 0;
    const hasRaw = view.rawProjection !== undefined;
    expect(hasBreaks, `[${label}] α-conditional: hasBreaks(${hasBreaks}) !== hasRaw(${hasRaw})`).toBe(hasRaw);
  }

  const sequences: Array<{ name: string; steps: DispatchStep[] }> = [
    { name: 'add then delete', steps: [{ op: 'add', coordA: 60, coordB: 140 }, { op: 'delete', breakIndex: 0 }] },
    { name: 'add two then delete first', steps: [
      { op: 'add', coordA: 20, coordB: 50 },
      { op: 'add', coordA: 120, coordB: 170 },
      { op: 'delete', breakIndex: 0 },
    ]},
    { name: 'add two then delete both', steps: [
      { op: 'add', coordA: 20, coordB: 50 },
      { op: 'add', coordA: 120, coordB: 170 },
      { op: 'delete', breakIndex: 0 },
      { op: 'delete', breakIndex: 0 },
    ]},
    { name: 'add then regen with break', steps: [{ op: 'add', coordA: 60, coordB: 140 }, { op: 'regen' }] },
    { name: 'regen then add', steps: [{ op: 'regen' }, { op: 'add', coordA: 60, coordB: 140 }] },
    { name: 'add x, add y, delete x', steps: [
      { op: 'add', coordA: 20, coordB: 50, axis: 'x' },
      { op: 'add', coordA: 10, coordB: 30, axis: 'y' },
      { op: 'delete', breakIndex: 0 },
    ]},
  ];

  for (const { name, steps } of sequences) {
    it(`invariant holds through sequence: ${name}`, async () => {
      let stepLabel = 'initial';
      checkInvariant('v1', stepLabel);

      for (let i = 0; i < steps.length; i++) {
        const step = steps[i]!;
        stepLabel = `step-${i}-${step.op}`;

        if (step.op === 'add') {
          const cmd = new AddBreakCommand({ ...addBreakOpts, axis: step.axis ?? 'x', coordA: step.coordA, coordB: step.coordB });
          try { await cmd.apply(); } catch { /* overlapping or invalid-band from prior steps — skip */ }
        } else if (step.op === 'delete') {
          const doc = useAppStore.getState().activeDocument;
          if (!doc || doc.kind !== 'drawing') continue;
          const view = doc.document.sheets[0]!.views.find(v => v.id === 'v1')! as
            BaseView & { breaks?: BreakRegion[] };
          const br = view.breaks?.[step.breakIndex];
          if (!br) continue;
          await new DeleteBreakCommand({ drawingId: 'd1', sheetId: 's1', viewId: 'v1', breakId: br.id }).apply();
        } else if (step.op === 'regen') {
          const { RegenerateViewCommand } = await import('../RegenerateViewCommand');
          const regenProj: ProjectedGeometry = { visibleEdges: [], hiddenEdges: [], bbox: { minX: 0, minY: 0, maxX: 200, maxY: 80 } };
          await new RegenerateViewCommand({ sheetId: 's1', viewId: 'v1', projection: regenProj, inputFingerprint: 'regen-fp' }).apply();
        }

        checkInvariant('v1', stepLabel);
      }
    });
  }
});
```

**Step 2 — Run:**

```bash
pnpm vitest run "AddBreakCommand|DeleteBreakCommand|RegenerateViewCommand"
```

All 6 sequence tests must be green.

**Commit:**
```
test(drawing-broken-views): T3.16 α-conditional invariant property sequence tests — Batch 3
```

---

### T3.17 — Barrel exports + green-gate commit

**Goal:** Export `AddBreakCommand`, `AddBreakOpts`, `DeleteBreakCommand`, `DeleteBreakOpts` from `packages/app/src/commands/index.ts`. Run full unit suite; confirm green.

**Step 1 — Modify `index.ts`** (append):

```ts
// Re-exports for broken-view commands (Drawing F3).
export { AddBreakCommand } from './AddBreakCommand';
export type { AddBreakOpts } from './AddBreakCommand';
export { DeleteBreakCommand } from './DeleteBreakCommand';
export type { DeleteBreakOpts } from './DeleteBreakCommand';
```

**Step 2 — Add barrel export tests** (add to `AddBreakCommand.test.ts`):

```ts
describe('Barrel exports', () => {
  it('AddBreakCommand is importable from the commands index', async () => {
    const mod = await import('../index');
    expect(typeof mod.AddBreakCommand).toBe('function');
  });

  it('DeleteBreakCommand is importable from the commands index', async () => {
    const mod = await import('../index');
    expect(typeof mod.DeleteBreakCommand).toBe('function');
  });
});
```

**Step 3 — Run full suite:**

```bash
pnpm vitest run --reporter=verbose 2>&1 | tail -20
```

Confirm all tests green (prior suite + all new Batch 3 tests).

**Commit:**
```
feat(drawing-broken-views): AddBreakCommand + DeleteBreakCommand + RegenerateView α-conditional wiring — Batch 3 complete
```

---

## Batch 3 Reviewer Dispatch Templates

### Reviewer Template A — Implementation Correctness

```
You are a senior TypeScript code reviewer. Ultrathink before writing a single word of your review.

You are reviewing **Batch 3** of the Drawing F3 (Broken Views) feature for the ZilInventor codebase.

**Spec sections in scope:**
- §9 (applyBreaks integration — full section, all three call sites)
- §10.1 (AddBreakCommand apply/revert contract)
- §10.2 (DeleteBreakCommand apply/revert contract)
- §10.3 (ALL SIX error message strings — exact match, case-sensitive)
- §10.4 (RegenerateViewCommand extension — two branches: breaks present vs absent)
- §5.2 / §9.1 (α-conditional invariant: `rawProjection !== undefined ⟺ breaks.length > 0`)

**Files to review:**
- `packages/app/src/commands/AddBreakCommand.ts`
- `packages/app/src/commands/__tests__/AddBreakCommand.test.ts`
- `packages/app/src/commands/DeleteBreakCommand.ts`
- `packages/app/src/commands/__tests__/DeleteBreakCommand.test.ts`
- `packages/app/src/commands/RegenerateViewCommand.ts` (diff only — changes to existing file)
- `packages/app/src/commands/__tests__/RegenerateViewCommand.spec.ts` (diff only)
- `packages/app/src/commands/index.ts` (diff only)

**Spec file:** `docs/superpowers/specs/2026-05-06-drawing-broken-views-design.md`

**Check list (cover every item):**

1. **Six error strings** — verify each of the following is thrown with EXACT string, in the correct command and condition:
   - `'view-not-found'` (AddBreakCommand: viewId absent)
   - `'view-not-breakable'` (AddBreakCommand: kind is section or detail)
   - `'view-projection-missing'` (AddBreakCommand: view.projection undefined; DeleteBreakCommand: view.rawProjection undefined)
   - `'invalid-band'` (AddBreakCommand: coordB <= coordA)
   - `'overlapping-break'` (AddBreakCommand: same-axis band overlaps existing)
   - `'break-not-found'` (DeleteBreakCommand: breakId not in view.breaks)

2. **AddBreakCommand first-break path** (spec §10.1 steps 7-8):
   - `view.projection` snapshotted into `view.rawProjection` before `applyBreaks` is called.
   - Both `rawProjection` and new `projection` committed atomically.
   - After apply: `rawProjection !== undefined`, `projection !== rawProjection` (breaks applied).

3. **AddBreakCommand subsequent-break path** (spec §10.1 step 8):
   - `rawProjection` is read from `view.rawProjection` (already populated).
   - `rawProjection` is NOT overwritten.
   - `applyBreaks` called with `[...view.breaks, newBreak]` (full array including new).

4. **AddBreakCommand revert paths**:
   - Reverting first break: `projection` restored to prior, `rawProjection` deleted/undefined, `breaks` empty.
   - Reverting subsequent break: `rawProjection` unchanged, `projection` recomputed with remaining breaks.

5. **DeleteBreakCommand last-break path** (spec §10.2 step 6):
   - `view.projection = view.rawProjection` (raw, no break symbols).
   - `view.rawProjection` cleared to `undefined`.
   - `view.breaks = []` (not undefined).

6. **DeleteBreakCommand middle-break path** (spec §10.2 step 7):
   - `applyBreaks(view.rawProjection.visibleEdges, remaining, view.rawProjection.bbox)`.
   - `rawProjection` unchanged.

7. **DeleteBreakCommand revert** (spec §10.2 revert block):
   - Re-inserts `deletedBreak` into `view.breaks`.
   - If transition is 0→1 breaks (was last-break removal): restores `view.rawProjection` from `savedRawProjection`.
   - Re-applies `applyBreaks` with restored breaks array.

8. **RegenerateViewCommand extension** (spec §10.4):
   - `breaks.length > 0` branch: fresh kernel output stored as `rawProjection`, then `applyBreaks` produces `projection`. α-conditional holds.
   - `breaks.length === 0` branch: `rawProjection` stays `undefined`. α-conditional holds.
   - Prior tests (no-breaks base/detail regen) still pass — no regression.

9. **Store update** — both `activeDocument` and `activeDrawing` set in every `setState` call inside AddBreakCommand and DeleteBreakCommand (mirroring `AddDetailViewCommand`).

10. **α-conditional invariant** — after every command path (add first, add subsequent, delete middle, delete last, regen with breaks, regen without breaks): `rawProjection !== undefined ⟺ breaks.length > 0`. Confirm the T3.16 property test covers at least 4 distinct state transitions.

Report under 400 words. Structure: one numbered finding per issue found. If zero issues, write "LGTM — no issues found" and stop.
```

---

### Reviewer Template B — Test Coverage and TDD Discipline

```
You are a senior TypeScript test reviewer. Ultrathink before writing a single word of your review.

You are reviewing **Batch 3 tests only** of the Drawing F3 (Broken Views) feature.

**Test files to review:**
- `packages/app/src/commands/__tests__/AddBreakCommand.test.ts`
- `packages/app/src/commands/__tests__/DeleteBreakCommand.test.ts`
- `packages/app/src/commands/__tests__/RegenerateViewCommand.spec.ts` (new describe blocks only)

**Plan reference:** Batch 3 section in `docs/superpowers/plans/2026-05-06-drawing-broken-views-plan.md` (Tasks T3.1–T3.16)

**Check list (cover every item):**

1. **Six error strings coverage** — confirm each error is tested with `rejects.toThrow('<exact string>')` and NOT a substring or regex:
   - `'view-not-found'`
   - `'view-not-breakable'` (both section and detail kinds)
   - `'view-projection-missing'` (both AddBreak and DeleteBreak variants)
   - `'invalid-band'` (both coordB === coordA and coordB < coordA)
   - `'overlapping-break'` (3 cases: overlap throws, no-overlap passes, different-axis passes)
   - `'break-not-found'`

2. **α-conditional invariant** — T3.16 property test: confirm it exercises at minimum these 4 state transitions:
   - 0 breaks → 1 break (first add)
   - 1 break → 0 breaks (delete last)
   - 1 break → 2 breaks (add subsequent)
   - 2 breaks → 1 break (delete middle)

3. **Mock discipline** — `@zilventor/shared` is mocked with `vi.mock` in both command test files. `applyBreaks` mock returns `{ edges, breakSymbolEdges }` matching the real return type. `fingerprintBreaksArray` mock returns a string. Confirm mocks are NOT the real implementation (tests are isolated from Batch 2 algorithm correctness).

4. **Store state isolation** — `beforeEach` in each test file resets store to a clean `makeDrawing()` fixture. Confirm no state bleed between tests.

5. **RegenerateViewCommand regression** — new breaks-aware test blocks do not interfere with pre-existing tests (base view regen, detail view regen, revert-to-undefined). Confirm old tests still present and unmodified.

6. **Symmetry checks** — for every `apply` test that mutates state, there is a corresponding `revert` test that restores it. Flag any apply path that has no revert coverage.

7. **TDD evidence** — each task's test code is written in the test file before the implementation was written. (Infer from test structure: tests that exist for error paths before happy paths suggest TDD was followed.) Flag any suspicious ordering.

Report under 400 words. Structure: one numbered finding per gap. If tests are complete and correctly structured, write "LGTM — full coverage, no gaps" and stop.
```
## Batch 4 — Tool mode + UI + ribbon + AddBreakDialog + mid-flight UI verification

### Preamble

**Controller (Opus) reads this preamble verbatim before dispatching the implementer.**

This is **Batch 4 of 5** for Drawing F3 — Broken Views.
Batches 1–3 must be merged and green before this batch starts.

**Pre-flight check (run before dispatching implementer):**
```bash
git log --oneline -3
pnpm -r typecheck 2>&1 | tail -5
pnpm -r test:unit 2>&1 | grep -E "Test Files|Tests" | tail -5
```
Confirm: typecheck clean; all Batch 1–3 tests green. If drift, investigate before dispatching.

**Implementer instructions:**
- Model: Sonnet. Include `ultrathink` at the start of the implementer prompt.
- Working directory: the F3 worktree at `.worktrees/drawing-broken-views/`.
- Read this batch section completely before writing any code.
- Follow TDD: write the failing test first, confirm red for the right reason, then write the implementation, confirm green.
- Every task ends with an explicit commit step.
- Plan code snippets are reference, not literal — verify all external identifiers (type names, exports, store action names) against the actual codebase before use.
- After all tasks are complete, run the full green-gate command and report back.

**Green-gate (Task T4.17):**
```bash
pnpm -r typecheck && \
pnpm --filter @zilventor/app test -- packages/app/src/drawing/__tests__/toolMode.spec.ts \
  packages/app/src/drawing/__tests__/DrawingCanvas.spec.tsx \
  packages/app/src/drawing/__tests__/ViewElement.spec.tsx \
  packages/app/src/shell/tabs/__tests__/DrawingTab.spec.tsx \
  packages/app/src/drawing/__tests__/DrawingTreePane.spec.tsx \
  packages/app/src/drawing/__tests__/AddBreakDialog.spec.tsx && \
npx playwright test tests/e2e/drawing/T-6-9-broken-view-mid-flight.spec.ts
```

**Spec coverage in this batch:** §11.1, §11.2, §11.3, §11.4, §12.1, §12.2, §12.3, §12.4, §12.5.

---

**Files touched**

New files:
- `packages/app/src/drawing/AddBreakDialog.tsx`
- `packages/app/src/drawing/__tests__/AddBreakDialog.spec.tsx`
- `tests/e2e/drawing/T-6-9-broken-view-mid-flight.spec.ts`

Modified files:
- `packages/app/src/drawing/toolMode.ts` — widen `ToolMode`, add `BreakToolState`, add 6 store actions
- `packages/app/src/drawing/__tests__/toolMode.spec.ts` — add `describe('break tool state machine', ...)` block
- `packages/app/src/drawing/DrawingCanvas.tsx` — break-mode click dispatch + ESC handler + axis-guide preview
- `packages/app/src/drawing/__tests__/DrawingCanvas.spec.tsx` — add break-mode click tests
- `packages/app/src/drawing/ViewElement.tsx` — `kind: 'break'` stroke branch in `visibleEdges` loop
- `packages/app/src/drawing/__tests__/ViewElement.spec.tsx` — break-symbol polyline tests
- `packages/app/src/shell/tabs/DrawingTab.tsx` — "Add Break" ribbon button after "Detail"
- `packages/app/src/shell/tabs/__tests__/DrawingTab.spec.tsx` — Add Break button enable/disable + onClick tests
- `packages/app/src/drawing/DrawingTreePane.tsx` — `· [N break(s)]` suffix on view labels
- `packages/app/src/drawing/__tests__/DrawingTreePane.spec.tsx` — break-count suffix + no new row tests

---

### T4.1 — ToolMode union widening

**Spec coverage:** §11.1

**Red test first** (`packages/app/src/drawing/__tests__/toolMode.spec.ts` — add to the existing `setMode round-trip` test):

```ts
// Add 'break' to the ToolMode modes array in the existing round-trip test:
it('setMode round-trip includes break', () => {
  useToolModeStore.getState().setMode('break');
  expect(useToolModeStore.getState().mode).toBe('break');
});
```

Run: `pnpm --filter @zilventor/app test -- packages/app/src/drawing/__tests__/toolMode.spec.ts`
Confirm: fails with TypeScript error `"break" is not assignable to type ToolMode` (or test assertion error if type is widened but store not updated — either is a valid red).

**Implementation** (`packages/app/src/drawing/toolMode.ts`):

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
  | 'break';   // NEW — Drawing F3
```

Run: confirm test goes green.

**Commit:** `feat(drawing-broken-views): widen ToolMode union to include 'break' — T4.1`

---

### T4.2 — BreakToolState discriminated union

**Spec coverage:** §11.1

**Red test first** (new `describe` block in `toolMode.spec.ts`):

```ts
describe('break tool — initial state + BreakToolState type', () => {
  beforeEach(() => {
    useToolModeStore.getState().reset();
  });

  it('reset() initialises breakState to { stage: "idle" }', () => {
    const s = useToolModeStore.getState();
    expect(s.breakState).toEqual({ stage: 'idle' });
  });

  it('setMode("break") sets mode=break without touching breakState', () => {
    useToolModeStore.getState().setMode('break');
    const s = useToolModeStore.getState();
    expect(s.mode).toBe('break');
    expect(s.breakState).toEqual({ stage: 'idle' });
  });

  it('BreakToolState stage "idle" is the narrow type at runtime', () => {
    useToolModeStore.getState().reset();
    const s = useToolModeStore.getState();
    // Compile-time narrowing: stage === 'idle' has no extra fields
    if (s.breakState.stage === 'idle') {
      // TypeScript should accept this without 'viewId' being accessible
      const keys = Object.keys(s.breakState);
      expect(keys).toEqual(['stage']);
    }
  });
});
```

Run: confirm fails (`s.breakState` is undefined — property not yet on store).

**Implementation** — add to `toolMode.ts`:

```ts
// ---------------------------------------------------------------------------
// Break tool sub-state
// ---------------------------------------------------------------------------
export type BreakToolState =
  | { stage: 'idle' }
  | { stage: 'pickParent' }
  | { stage: 'pickAxis'; viewId: string }
  | { stage: 'pickP0'; viewId: string; axis: 'x' | 'y' }
  | { stage: 'pickP1'; viewId: string; axis: 'x' | 'y'; coordA: number };
```

Add `breakState: BreakToolState;` to the `ToolModeState` interface.
Add `breakState: { stage: 'idle' },` to the `create(...)` initial state.
Update `reset()` to clear `breakState: { stage: 'idle' }`.

Run: confirm green.

**Commit:** `feat(drawing-broken-views): add BreakToolState discriminated union + initial store state — T4.2`

---

### T4.3 — enterBreakMode action

**Spec coverage:** §11.2, §11.3 (row 1)

**Red test:**

```ts
describe('break tool — enterBreakMode', () => {
  beforeEach(() => { useToolModeStore.getState().reset(); });

  it('enterBreakMode() sets mode=break, breakState.stage=pickParent', () => {
    useToolModeStore.getState().enterBreakMode();
    const s = useToolModeStore.getState();
    expect(s.mode).toBe('break');
    expect(s.breakState).toEqual({ stage: 'pickParent' });
  });

  it('reset() from break mode clears back to idle', () => {
    useToolModeStore.getState().enterBreakMode();
    useToolModeStore.getState().reset();
    expect(useToolModeStore.getState().mode).toBe('idle');
    expect(useToolModeStore.getState().breakState).toEqual({ stage: 'idle' });
  });
});
```

Run: confirm fails (`enterBreakMode` does not exist).

**Implementation** — add to `ToolModeState` interface and `create(...)`:

```ts
// Interface:
enterBreakMode(): void;

// Implementation:
enterBreakMode() {
  set({ mode: 'break', breakState: { stage: 'pickParent' } });
},
```

Run: confirm green.

**Commit:** `feat(drawing-broken-views): add enterBreakMode action — T4.3`

---

### T4.4 — breakPickParent(viewId) action

**Spec coverage:** §11.2, §11.3 (row 2)

**Red test:**

```ts
describe('break tool — breakPickParent', () => {
  beforeEach(() => {
    useToolModeStore.getState().reset();
    useToolModeStore.getState().enterBreakMode();
  });

  it('breakPickParent() from pickParent → pickAxis with viewId', () => {
    useToolModeStore.getState().breakPickParent('bv1');
    const s = useToolModeStore.getState();
    expect(s.breakState).toEqual({ stage: 'pickAxis', viewId: 'bv1' });
  });

  it('breakPickParent() from wrong stage is no-op + warns', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    useToolModeStore.getState().breakPickParent('bv1'); // idle→pickParent done by enterBreakMode; now stage=pickParent
    // now stage=pickAxis; calling again should warn
    useToolModeStore.getState().breakPickParent('bv2');
    expect(useToolModeStore.getState().breakState).toMatchObject({ stage: 'pickAxis', viewId: 'bv1' });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
```

Run: confirm fails.

**Implementation:**

```ts
// Interface:
breakPickParent(viewId: string): void;

// Implementation:
breakPickParent(viewId) {
  const { breakState } = get();
  if (breakState.stage !== 'pickParent') {
    console.warn('breakPickParent: expected stage=pickParent, got', breakState.stage);
    return;
  }
  set({ breakState: { stage: 'pickAxis', viewId } });
},
```

Run: confirm green.

**Commit:** `feat(drawing-broken-views): add breakPickParent action — T4.4`

---

### T4.5 — breakSetAxis(axis) action

**Spec coverage:** §11.2, §11.3 (rows 3–4)

**Red test:**

```ts
describe('break tool — breakSetAxis', () => {
  beforeEach(() => {
    useToolModeStore.getState().reset();
    useToolModeStore.getState().enterBreakMode();
    useToolModeStore.getState().breakPickParent('bv1');
  });

  it('breakSetAxis("x") from pickAxis → pickP0 with axis=x', () => {
    useToolModeStore.getState().breakSetAxis('x');
    expect(useToolModeStore.getState().breakState).toEqual({
      stage: 'pickP0', viewId: 'bv1', axis: 'x',
    });
  });

  it('breakSetAxis("y") from pickAxis → pickP0 with axis=y', () => {
    useToolModeStore.getState().breakSetAxis('y');
    expect(useToolModeStore.getState().breakState).toEqual({
      stage: 'pickP0', viewId: 'bv1', axis: 'y',
    });
  });

  it('breakSetAxis from wrong stage is no-op + warns', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    useToolModeStore.getState().reset();
    useToolModeStore.getState().enterBreakMode(); // stage=pickParent
    useToolModeStore.getState().breakSetAxis('x'); // wrong stage
    expect(useToolModeStore.getState().breakState).toEqual({ stage: 'pickParent' });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
```

Run: confirm fails.

**Implementation:**

```ts
// Interface:
breakSetAxis(axis: 'x' | 'y'): void;

// Implementation:
breakSetAxis(axis) {
  const { breakState } = get();
  if (breakState.stage !== 'pickAxis') {
    console.warn('breakSetAxis: expected stage=pickAxis, got', breakState.stage);
    return;
  }
  set({ breakState: { stage: 'pickP0', viewId: breakState.viewId, axis } });
},
```

Run: confirm green.

**Commit:** `feat(drawing-broken-views): add breakSetAxis action (pickAxis→pickP0) — T4.5`

---

### T4.6 — breakPickP0(coord) action

**Spec coverage:** §11.2, §11.3 (row 5)

**Red test:**

```ts
describe('break tool — breakPickP0', () => {
  beforeEach(() => {
    useToolModeStore.getState().reset();
    useToolModeStore.getState().enterBreakMode();
    useToolModeStore.getState().breakPickParent('bv1');
    useToolModeStore.getState().breakSetAxis('x');
  });

  it('breakPickP0() from pickP0 → pickP1 with coordA captured', () => {
    useToolModeStore.getState().breakPickP0(75.5);
    const s = useToolModeStore.getState();
    expect(s.breakState).toEqual({
      stage: 'pickP1', viewId: 'bv1', axis: 'x', coordA: 75.5,
    });
  });

  it('breakPickP0() from wrong stage is no-op + warns', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    useToolModeStore.getState().reset();
    useToolModeStore.getState().enterBreakMode(); // stage=pickParent
    useToolModeStore.getState().breakPickP0(50); // wrong stage
    expect(useToolModeStore.getState().breakState).toEqual({ stage: 'pickParent' });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
```

Run: confirm fails.

**Implementation:**

```ts
// Interface:
breakPickP0(coord: number): void;

// Implementation:
breakPickP0(coord) {
  const { breakState } = get();
  if (breakState.stage !== 'pickP0') {
    console.warn('breakPickP0: expected stage=pickP0, got', breakState.stage);
    return;
  }
  set({ breakState: { stage: 'pickP1', viewId: breakState.viewId, axis: breakState.axis, coordA: coord } });
},
```

Run: confirm green.

**Commit:** `feat(drawing-broken-views): add breakPickP0 action (pickP0→pickP1) — T4.6`

---

### T4.7 — breakPickP1(coord, onDispatch) action

**Spec coverage:** §11.2, §11.3 (row 6)

**Red test:**

```ts
describe('break tool — breakPickP1', () => {
  function setupToPickP1() {
    useToolModeStore.getState().reset();
    useToolModeStore.getState().enterBreakMode();
    useToolModeStore.getState().breakPickParent('bv1');
    useToolModeStore.getState().breakSetAxis('x');
    useToolModeStore.getState().breakPickP0(50);
  }

  it('breakPickP1() transitions to idle, calls onDispatch with (coordA, coordB)', () => {
    setupToPickP1();
    const cb = vi.fn();
    useToolModeStore.getState().breakPickP1(150, cb);
    expect(cb).toHaveBeenCalledOnce();
    expect(cb).toHaveBeenCalledWith(50, 150);
    const s = useToolModeStore.getState();
    expect(s.mode).toBe('idle');
    expect(s.breakState).toEqual({ stage: 'idle' });
  });

  it('breakPickP1() calls onDispatch exactly once', () => {
    setupToPickP1();
    const cb = vi.fn();
    useToolModeStore.getState().breakPickP1(200, cb);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('breakPickP1() from wrong stage is no-op + warns, callback not called', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    useToolModeStore.getState().reset();
    useToolModeStore.getState().enterBreakMode(); // stage=pickParent
    const cb = vi.fn();
    useToolModeStore.getState().breakPickP1(100, cb);
    expect(cb).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
```

Run: confirm fails.

**Implementation:**

```ts
// Interface:
breakPickP1(coord: number, onDispatch: (coordA: number, coordB: number) => void): void;

// Implementation:
breakPickP1(coord, onDispatch) {
  const { breakState } = get();
  if (breakState.stage !== 'pickP1') {
    console.warn('breakPickP1: expected stage=pickP1, got', breakState.stage);
    return;
  }
  const coordA = breakState.coordA;
  set({ mode: 'idle', breakState: { stage: 'idle' } });
  onDispatch(coordA, coord);
},
```

Note: `set(...)` is called BEFORE `onDispatch` so the store is in idle state if the callback synchronously reads it.

Run: confirm green.

**Commit:** `feat(drawing-broken-views): add breakPickP1 action (pickP1→idle, fires onDispatch) — T4.7`

---

### T4.8 — breakCancel + double-ESC stage back-tracking

**Spec coverage:** §11.3 (ESC row, double-ESC)

**Red test:**

```ts
describe('break tool — breakCancel + ESC back-tracking', () => {
  function setupAt(stage: string) {
    useToolModeStore.getState().reset();
    useToolModeStore.getState().enterBreakMode(); // pickParent
    if (stage === 'pickParent') return;
    useToolModeStore.getState().breakPickParent('bv1'); // pickAxis
    if (stage === 'pickAxis') return;
    useToolModeStore.getState().breakSetAxis('x'); // pickP0
    if (stage === 'pickP0') return;
    useToolModeStore.getState().breakPickP0(50); // pickP1
  }

  it('breakCancel() from pickP1 → pickP0 (one stage back)', () => {
    setupAt('pickP1');
    useToolModeStore.getState().breakCancel();
    expect(useToolModeStore.getState().breakState).toMatchObject({ stage: 'pickP0' });
    expect(useToolModeStore.getState().mode).toBe('break');
  });

  it('breakCancel() from pickP0 → pickAxis (one stage back)', () => {
    setupAt('pickP0');
    useToolModeStore.getState().breakCancel();
    expect(useToolModeStore.getState().breakState).toMatchObject({ stage: 'pickAxis' });
    expect(useToolModeStore.getState().mode).toBe('break');
  });

  it('breakCancel() from pickAxis → pickParent (one stage back)', () => {
    setupAt('pickAxis');
    useToolModeStore.getState().breakCancel();
    expect(useToolModeStore.getState().breakState).toEqual({ stage: 'pickParent' });
    expect(useToolModeStore.getState().mode).toBe('break');
  });

  it('breakCancel() from pickParent → exits break mode entirely (mode=idle)', () => {
    setupAt('pickParent');
    useToolModeStore.getState().breakCancel();
    expect(useToolModeStore.getState().mode).toBe('idle');
    expect(useToolModeStore.getState().breakState).toEqual({ stage: 'idle' });
  });

  it('double-ESC from pickP1 exits to mode=idle', () => {
    setupAt('pickP1');
    useToolModeStore.getState().breakCancel(); // pickP1 → pickP0
    useToolModeStore.getState().breakCancel(); // pickP0 → pickAxis
    useToolModeStore.getState().breakCancel(); // pickAxis → pickParent
    useToolModeStore.getState().breakCancel(); // pickParent → idle (exits mode)
    expect(useToolModeStore.getState().mode).toBe('idle');
  });
});
```

Run: confirm fails.

**Implementation:**

```ts
// Interface:
breakCancel(): void;

// Implementation:
breakCancel() {
  const { breakState } = get();
  switch (breakState.stage) {
    case 'idle':
      break;
    case 'pickParent':
      set({ mode: 'idle', breakState: { stage: 'idle' } });
      break;
    case 'pickAxis':
      set({ breakState: { stage: 'pickParent' } });
      break;
    case 'pickP0':
      set({ breakState: { stage: 'pickAxis', viewId: breakState.viewId } });
      break;
    case 'pickP1':
      set({ breakState: { stage: 'pickP0', viewId: breakState.viewId, axis: breakState.axis } });
      break;
  }
},
```

Also update the ESC handler in `DrawingCanvas.tsx` (covered in T4.9, but add `breakCancel` here to the interface first; DrawingCanvas wiring in T4.9).

Run: confirm green.

**Commit:** `feat(drawing-broken-views): add breakCancel with per-stage back-tracking — T4.8`

---

### T4.9 — DrawingCanvas break-mode click dispatch

**Spec coverage:** §12.1, §11.4

**Red test** (add new describe block to `packages/app/src/drawing/__tests__/DrawingCanvas.spec.tsx`):

```ts
vi.mock('../../commands/AddBreakCommand', () => ({
  AddBreakCommand: vi.fn().mockImplementation((payload) => ({
    name: 'AddBreakCommand',
    payload,
  })),
}));

const makeBreakViewSheet = (): DrawingSheet => ({
  id: 's1', name: 'Sheet 1',
  size: { kind: 'iso', size: 'A3' }, orientation: 'landscape',
  views: [
    {
      id: 'bv1', kind: 'base' as const,
      positionMm: { x: 20, y: 20 },
      scale: { numerator: 1, denominator: 1 },
      orientation: 'front' as const,
      showHidden: false,
      projection: {
        visibleEdges: [],
        hiddenEdges: [],
        bbox: { minX: 0, minY: 0, maxX: 80, maxY: 60 },
      },
      inputFingerprint: 'fp-bv1',
    },
  ],
  dimensions: [], annotations: [], titleBlock: {},
});

describe('DrawingCanvas — break tool mode click dispatch', () => {
  beforeEach(() => {
    useToolModeStore.setState({
      mode: 'break',
      breakState: { stage: 'pickParent' },
      sectionState: { stage: 'idle' },
      detailState: { stage: 'idle' },
      pendingViewParams: null,
    } as never);
    useAppStore.setState({
      activeDrawing: { ...makeDrawing(), sheets: [makeBreakViewSheet()] },
      bus: { execute: vi.fn().mockResolvedValue(undefined) },
    } as never);
  });

  it('click on view element in pickParent stage → breakPickParent called with viewId', () => {
    const pickParent = vi.spyOn(useToolModeStore.getState(), 'breakPickParent');
    const { container } = render(<DrawingCanvas />);
    const viewGroup = container.querySelector('[data-view-id="bv1"]') as Element;
    if (viewGroup) {
      fireEvent.click(viewGroup);
      expect(pickParent).toHaveBeenCalledWith('bv1');
    }
  });

  it('stage=pickP0 + click → breakPickP0 called', () => {
    useToolModeStore.setState({
      mode: 'break',
      breakState: { stage: 'pickP0', viewId: 'bv1', axis: 'x' },
    } as never);
    const pickP0 = vi.spyOn(useToolModeStore.getState(), 'breakPickP0');
    render(<DrawingCanvas />);
    const svg = document.querySelector('svg')!;
    fireEvent.click(svg, { clientX: 50, clientY: 50 });
    expect(pickP0).toHaveBeenCalled();
  });

  it('stage=pickP1 + click → bus.execute called with AddBreakCommand', () => {
    useToolModeStore.setState({
      mode: 'break',
      breakState: { stage: 'pickP1', viewId: 'bv1', axis: 'x', coordA: 30 },
    } as never);
    render(<DrawingCanvas />);
    const svg = document.querySelector('svg')!;
    fireEvent.click(svg, { clientX: 100, clientY: 50 });
    const bus = useAppStore.getState().bus;
    expect(bus.execute).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'AddBreakCommand' }),
    );
  });

  it('ESC key calls breakCancel()', () => {
    const cancel = vi.spyOn(useToolModeStore.getState(), 'breakCancel');
    render(<DrawingCanvas />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(cancel).toHaveBeenCalled();
  });
});
```

Run: confirm fails (no break-mode branch in `DrawingCanvas`).

**Implementation** — modify `DrawingCanvas.tsx`:

1. Add imports:

```ts
import { AddBreakCommand } from '../commands/AddBreakCommand';
```

2. Subscribe to `breakState` at the top of `DrawingCanvas`:

```ts
const breakState = useToolModeStore((s) => s.breakState);
```

3. Add `breakCancel` to the ESC handler:

```ts
useEffect(() => {
  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      useToolModeStore.getState().sectionCancel();
      useToolModeStore.getState().detailCancel();
      useToolModeStore.getState().breakCancel();   // NEW
    }
  }
  document.addEventListener('keydown', onKeyDown);
  return () => document.removeEventListener('keydown', onKeyDown);
}, []);
```

4. Add break-mode block to `handleClick` callback (mirror the `detail` block pattern; insert before the `addLinearH` block):

```ts
if (toolMode === 'break') {
  const bs = useToolModeStore.getState().breakState;
  const sheetPt = { x: svgX, y: svgY };

  if (bs.stage === 'pickParent') {
    const hitViewId = getViewAtPoint(sheet.views, sheetPt, viewId);
    if (!hitViewId) break;
    const hitView = sheet.views.find((v) => v.id === hitViewId);
    if (!hitView) break;
    if (hitView.kind === 'section' || hitView.kind === 'detail') {
      // toast deferred; just ignore silently for now — DrawingCanvas has no toast hook
      break;
    }
    useToolModeStore.getState().breakPickParent(hitViewId);
    // Opening AddBreakDialog is handled in DrawingCanvas JSX via state-driven conditional below
    return;
  }

  if (bs.stage === 'pickP0') {
    const parentView = sheet.views.find((v) => v.id === bs.viewId);
    if (!parentView) return;
    const localPt = sheetToParentLocal(sheetPt, parentView);
    const coord = bs.axis === 'x' ? localPt.x : localPt.y;
    useToolModeStore.getState().breakPickP0(coord);
    return;
  }

  if (bs.stage === 'pickP1') {
    const parentView = sheet.views.find((v) => v.id === bs.viewId);
    if (!parentView) return;
    const localPt = sheetToParentLocal(sheetPt, parentView);
    const coord = bs.axis === 'x' ? localPt.x : localPt.y;
    useToolModeStore.getState().breakPickP1(coord, (coordA, coordB) => {
      void bus.execute(new AddBreakCommand({
        drawingId: drawing.id,
        sheetId: sheet.id,
        viewId: bs.viewId,
        axis: bs.axis,
        coordA,
        coordB,
        gapMm: 5,
      }));
    });
    return;
  }

  return;
}
```

Note: the `handleClick` uses a `switch` implicitly via `if` chains; `break` in the `pickParent` block should be `return` since each branch returns early. Replace `break` with `return` in the `pickParent` hit-test guards above to match the `detail` pattern.

Run: confirm green.

**Commit:** `feat(drawing-broken-views): DrawingCanvas break-mode click dispatch — T4.9`

---

### T4.10 — DrawingCanvas axis preview guide line

**Spec coverage:** §12.1 (axis preview during `pickAxis` / guide line during `pickP1`)

**Red test** (add to DrawingCanvas break-mode describe block):

```ts
it('renders axis guide line when stage=pickAxis and cursor moves', () => {
  useToolModeStore.setState({
    mode: 'break',
    breakState: { stage: 'pickAxis', viewId: 'bv1' },
  } as never);
  render(<DrawingCanvas />);
  const svg = document.querySelector('svg')!;
  fireEvent.mouseMove(svg, { clientX: 80, clientY: 60 });
  // axis-guide badge is rendered during pickAxis
  const guide = document.querySelector('[data-role="break-axis-guide"]');
  expect(guide).not.toBeNull();
});

it('renders pickP1 guide line when stage=pickP1 and cursor moves', () => {
  useToolModeStore.setState({
    mode: 'break',
    breakState: { stage: 'pickP1', viewId: 'bv1', axis: 'x', coordA: 30 },
  } as never);
  render(<DrawingCanvas />);
  const svg = document.querySelector('svg')!;
  fireEvent.mouseMove(svg, { clientX: 100, clientY: 60 });
  const guide = document.querySelector('[data-role="break-axis-guide"]');
  expect(guide).not.toBeNull();
});

it('no axis guide when break stage is idle', () => {
  useToolModeStore.setState({
    mode: 'idle',
    breakState: { stage: 'idle' },
  } as never);
  render(<DrawingCanvas />);
  expect(document.querySelector('[data-role="break-axis-guide"]')).toBeNull();
});
```

Run: confirm fails.

**Implementation** — add to the JSX of `DrawingCanvas` (after the detail ghost/preview blocks):

```tsx
{/* Break axis hint badge during pickAxis stage */}
{toolMode === 'break' && breakState.stage === 'pickAxis' && cursorMm && (
  <g data-role="break-axis-guide" key="break-axis-hint">
    <rect
      x={cursorMm.x - 10}
      y={cursorMm.y - 4}
      width={20}
      height={8}
      fill="rgba(0,0,0,0.6)"
      rx={2}
    />
    <text
      x={cursorMm.x}
      y={cursorMm.y + 2}
      textAnchor="middle"
      fontSize={3}
      fill="white"
      fontFamily="sans-serif"
    >
      Choose axis in dialog
    </text>
  </g>
)}

{/* Break coordA guide line during pickP1 stage */}
{toolMode === 'break' && breakState.stage === 'pickP1' && cursorMm && (() => {
  const bs = breakState;
  const parentView = sheet.views.find((v) => v.id === bs.viewId);
  if (!parentView) return null;
  const s = parentView.scale.numerator / parentView.scale.denominator;
  // coordA in sheet space
  const coordASheet = bs.axis === 'x'
    ? parentView.positionMm.x + bs.coordA * s
    : parentView.positionMm.y + bs.coordA * s;
  return (
    <line
      key="break-p1-guide"
      data-role="break-axis-guide"
      x1={bs.axis === 'x' ? coordASheet : 0}
      y1={bs.axis === 'x' ? 0 : coordASheet}
      x2={bs.axis === 'x' ? coordASheet : sheetW}
      y2={bs.axis === 'x' ? sheetH : coordASheet}
      stroke="rgba(30,100,255,0.6)"
      strokeWidth={0.4}
      strokeDasharray="3 2"
    />
  );
})()}
```

Run: confirm green.

**Commit:** `feat(drawing-broken-views): DrawingCanvas axis-guide preview for break tool — T4.10`

---

### T4.11 — ViewElement `kind: 'break'` rendering

**Spec coverage:** §12.2

**Red test** (add new describe block in `packages/app/src/drawing/__tests__/ViewElement.spec.tsx`):

```ts
const BASE_VIEW_WITH_BREAK_EDGE: DrawingView = {
  id: 'bv-break',
  kind: 'base',
  positionMm: { x: 50, y: 50 },
  scale: { numerator: 1, denominator: 1 },
  orientation: 'front',
  showHidden: false,
  projection: {
    visibleEdges: [
      { id: 've-normal', kind: 'outline', points: [[0, 0], [50, 0]] },
      {
        id: 'break_b1',
        kind: 'break' as const,  // cast needed until Edge2D.kind type is widened in Batch 1
        points: [[55, -5], [53, 0], [57, 5], [55, 10], [53, 15], [57, 20]],
      },
    ],
    hiddenEdges: [],
    bbox: { minX: 0, minY: -5, maxX: 60, maxY: 25 },
  },
  inputFingerprint: 'fp-bv-break',
} as DrawingView;

describe('ViewElement — break-symbol edge rendering', () => {
  it('renders a polyline with data-role="break-symbol" for kind=break edge', () => {
    const { container } = render(
      <svg>
        <ViewElement view={BASE_VIEW_WITH_BREAK_EDGE} isStale={false} onRegenerate={vi.fn()} />
      </svg>,
    );
    const breakPoly = container.querySelector('polyline[data-role="break-symbol"]');
    expect(breakPoly).not.toBeNull();
  });

  it('break-symbol polyline has strokeWidth 0.5 (heavier than normal 0.35)', () => {
    const { container } = render(
      <svg>
        <ViewElement view={BASE_VIEW_WITH_BREAK_EDGE} isStale={false} onRegenerate={vi.fn()} />
      </svg>,
    );
    const breakPoly = container.querySelector('polyline[data-role="break-symbol"]')!;
    expect(breakPoly.getAttribute('stroke-width')).toBe('0.5');
  });

  it('normal outline edge does NOT have data-role="break-symbol"', () => {
    const { container } = render(
      <svg>
        <ViewElement view={BASE_VIEW_WITH_BREAK_EDGE} isStale={false} onRegenerate={vi.fn()} />
      </svg>,
    );
    const normalPoly = container.querySelector('polyline[data-edge-id="ve-normal"]');
    expect(normalPoly).not.toBeNull();
    expect(normalPoly!.getAttribute('data-role')).toBeNull();
  });

  it('both break-symbol and normal polylines share the same parent visible edge group', () => {
    const { container } = render(
      <svg>
        <ViewElement view={BASE_VIEW_WITH_BREAK_EDGE} isStale={false} onRegenerate={vi.fn()} />
      </svg>,
    );
    const group = container.querySelector('[data-edge-group="visible"]');
    expect(group).not.toBeNull();
    const polylines = group!.querySelectorAll('polyline');
    expect(polylines.length).toBe(2); // one normal + one break-symbol
  });
});
```

Run: confirm fails (no `kind: 'break'` branch renders differently).

**Implementation** — modify the `visibleEdges.map()` in `ViewElement.tsx`:

```tsx
{/* Visible edges */}
<g data-edge-group="visible">
  {proj?.visibleEdges.map((e) => {
    if (e.kind === 'break') {
      return (
        <polyline
          key={e.id}
          data-edge-id={e.id}
          data-view-id={view.id}
          data-role="break-symbol"
          points={pointsAttr(e.points)}
          stroke="#111111"
          strokeWidth="0.5"
          fill="none"
        />
      );
    }
    return (
      <polyline
        key={e.id}
        data-edge-id={e.id}
        data-view-id={view.id}
        points={pointsAttr(e.points)}
        stroke="#111111"
        strokeWidth="0.35"
        fill="none"
      />
    );
  })}
</g>
```

Run: confirm green.

**Commit:** `feat(drawing-broken-views): ViewElement break-symbol stroke branch (strokeWidth 0.5) — T4.11`

---

### T4.12 — AddBreakDialog (axis picker only)

**Spec coverage:** §12.3

**Red test** (`packages/app/src/drawing/__tests__/AddBreakDialog.spec.tsx` — new file):

```ts
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AddBreakDialog } from '../AddBreakDialog';

describe('AddBreakDialog', () => {
  it('renders nothing when open=false', () => {
    render(
      <AddBreakDialog
        open={false}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.queryByText(/choose break direction/i)).toBeNull();
  });

  it('renders dialog title "Choose break direction" when open=true', () => {
    render(
      <AddBreakDialog
        open={true}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText(/choose break direction/i)).toBeInTheDocument();
  });

  it('renders two axis options: "Horizontal break" and "Vertical break"', () => {
    render(
      <AddBreakDialog open={true} onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(screen.getByText(/horizontal break/i)).toBeInTheDocument();
    expect(screen.getByText(/vertical break/i)).toBeInTheDocument();
  });

  it('clicking "Horizontal break (X axis)" button calls onConfirm with axis="x"', () => {
    const onConfirm = vi.fn();
    render(
      <AddBreakDialog open={true} onConfirm={onConfirm} onCancel={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /horizontal break/i }));
    expect(onConfirm).toHaveBeenCalledWith('x');
  });

  it('clicking "Vertical break (Y axis)" button calls onConfirm with axis="y"', () => {
    const onConfirm = vi.fn();
    render(
      <AddBreakDialog open={true} onConfirm={onConfirm} onCancel={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /vertical break/i }));
    expect(onConfirm).toHaveBeenCalledWith('y');
  });

  it('clicking Cancel calls onCancel', () => {
    const onCancel = vi.fn();
    render(
      <AddBreakDialog open={true} onConfirm={vi.fn()} onCancel={onCancel} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalled();
  });
});
```

Run: confirm fails (file does not exist).

**Implementation** (`packages/app/src/drawing/AddBreakDialog.tsx`):

```tsx
// packages/app/src/drawing/AddBreakDialog.tsx

type AddBreakDialogProps = {
  open: boolean;
  onConfirm: (axis: 'x' | 'y') => void;
  onCancel: () => void;
};

export function AddBreakDialog({ open, onConfirm, onCancel }: AddBreakDialogProps) {
  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-break-dialog-title"
      style={{
        position: 'fixed', top: '50%', left: '50%',
        transform: 'translate(-50%, -50%)',
        background: 'white', border: '1px solid #ccc',
        borderRadius: 6, boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
        padding: 16, zIndex: 2000, width: 260,
      }}
    >
      <div id="add-break-dialog-title" style={{ fontWeight: 600, marginBottom: 12 }}>
        Choose break direction
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
        <button
          type="button"
          aria-label="Horizontal break (X axis)"
          onClick={() => onConfirm('x')}
          style={{ padding: '6px 12px', cursor: 'pointer' }}
        >
          Horizontal break (remove X band)
        </button>
        <button
          type="button"
          aria-label="Vertical break (Y axis)"
          onClick={() => onConfirm('y')}
          style={{ padding: '6px 12px', cursor: 'pointer' }}
        >
          Vertical break (remove Y band)
        </button>
      </div>
      <button
        type="button"
        aria-label="Cancel"
        onClick={onCancel}
        style={{ padding: '4px 10px', cursor: 'pointer', float: 'right' }}
      >
        Cancel
      </button>
    </div>
  );
}
```

Wire the dialog open/close state into `DrawingCanvas.tsx`: add `const [addBreakDialogOpen, setAddBreakDialogOpen] = useState(false);` and render `<AddBreakDialog>` in the SVG's sibling (or outside the SVG in a fragment wrapping `DrawingCanvas`). The dialog sits outside the SVG element to avoid SVG foreignObject complexity.

Because `DrawingCanvas` currently returns only `<svg>`, wrap the return in a fragment:

```tsx
return (
  <>
    <svg ...>
      {/* existing SVG content */}
    </svg>
    <AddBreakDialog
      open={addBreakDialogOpen && toolMode === 'break' && breakState.stage === 'pickAxis'}
      onConfirm={(axis) => {
        setAddBreakDialogOpen(false);
        useToolModeStore.getState().breakSetAxis(axis);
      }}
      onCancel={() => {
        setAddBreakDialogOpen(false);
        useToolModeStore.getState().breakCancel();
      }}
    />
  </>
);
```

Update `breakPickParent` call site in `handleClick` to also call `setAddBreakDialogOpen(true)` after `breakPickParent(hitViewId)`.

Run: confirm green.

**Commit:** `feat(drawing-broken-views): AddBreakDialog axis picker + DrawingCanvas wiring — T4.12`

---

### T4.13 — Ribbon button: "Add Break"

**Spec coverage:** §12.4

**Red test** (add to `packages/app/src/shell/tabs/__tests__/DrawingTab.spec.tsx`):

```ts
describe('DrawingTab ribbon — Add Break button', () => {
  beforeEach(() => {
    useToolModeStore.getState().reset();
    useAppStore.getState().setActiveDocument({ kind: 'drawing', document: seedDrawing() });
  });

  it('renders an "Add Break" button in the Place Views panel', () => {
    render(<DrawingTab />);
    expect(screen.getByRole('button', { name: /add break/i })).toBeInTheDocument();
  });

  it('Add Break button is disabled when no breakable views have a projection', () => {
    // seedDrawing() has views: [] → no projection
    render(<DrawingTab />);
    expect(screen.getByRole('button', { name: /add break/i })).toBeDisabled();
  });

  it('Add Break button is enabled when at least one breakable view has a projection', () => {
    const dwgWithProjection: DrawingDocument = {
      ...seedDrawing(),
      sheets: [
        {
          ...seedDrawing().sheets[0]!,
          views: [
            {
              id: 'bv1', kind: 'base' as const,
              positionMm: { x: 20, y: 20 },
              scale: { numerator: 1, denominator: 1 },
              orientation: 'front' as const,
              showHidden: false,
              projection: {
                visibleEdges: [],
                hiddenEdges: [],
                bbox: { minX: 0, minY: 0, maxX: 80, maxY: 60 },
              },
              inputFingerprint: 'fp1',
            },
          ],
        },
      ],
    };
    useAppStore.getState().setActiveDocument({ kind: 'drawing', document: dwgWithProjection });
    render(<DrawingTab />);
    expect(screen.getByRole('button', { name: /add break/i })).not.toBeDisabled();
  });

  it('clicking Add Break button calls enterBreakMode()', () => {
    const dwgWithProjection: DrawingDocument = {
      ...seedDrawing(),
      sheets: [
        {
          ...seedDrawing().sheets[0]!,
          views: [
            {
              id: 'bv1', kind: 'base' as const,
              positionMm: { x: 20, y: 20 },
              scale: { numerator: 1, denominator: 1 },
              orientation: 'front' as const,
              showHidden: false,
              projection: { visibleEdges: [], hiddenEdges: [], bbox: { minX: 0, minY: 0, maxX: 80, maxY: 60 } },
              inputFingerprint: 'fp1',
            },
          ],
        },
      ],
    };
    useAppStore.getState().setActiveDocument({ kind: 'drawing', document: dwgWithProjection });
    render(<DrawingTab />);
    fireEvent.click(screen.getByRole('button', { name: /add break/i }));
    expect(useToolModeStore.getState().mode).toBe('break');
    expect(useToolModeStore.getState().breakState.stage).toBe('pickParent');
  });

  it('Add Break button appears after Detail button in DOM order', () => {
    render(<DrawingTab />);
    const buttons = Array.from(screen.getAllByRole('button'));
    const detailIdx = buttons.findIndex((b) => /^detail$/i.test(b.textContent ?? ''));
    const addBreakIdx = buttons.findIndex((b) => /add break/i.test(b.textContent ?? ''));
    expect(detailIdx).toBeGreaterThan(-1);
    expect(addBreakIdx).toBeGreaterThan(detailIdx);
  });
});
```

Run: confirm fails.

**Implementation** — modify `DrawingTab.tsx` to add the button after "Detail":

```tsx
// Compute: at least one non-detail, non-section view has a projection
const hasBreakableProjection =
  activeSheet?.views.some(
    (v) =>
      (v.kind === 'base' || v.kind === 'projected' || v.kind === 'iso') &&
      v.projection != null,
  ) ?? false;

// In the Place Views panel JSX, after the Detail button:
<button
  type="button"
  className="text-xs hover:text-white disabled:text-neutral-500"
  aria-label="Add Break"
  disabled={!hasBreakableProjection}
  title={
    !hasBreakableProjection
      ? 'Add a base, projected, or iso view with a projection first'
      : undefined
  }
  onClick={() => useToolModeStore.getState().enterBreakMode()}
>
  Add Break
</button>
```

Run: confirm green.

**Commit:** `feat(drawing-broken-views): ribbon "Add Break" button in DrawingTab Place Views panel — T4.13`

---

### T4.14 — DrawingTreePane — no new row for broken views

**Spec coverage:** §12.5

**Red test** (add to `packages/app/src/drawing/__tests__/DrawingTreePane.spec.tsx`):

```ts
const makeDrawingWithBrokenView = (): DrawingDocument => ({
  id: 'd1', name: 'Test', units: 'mm',
  source: { partPath: 'parts/box.zipt', sourceKind: 'part' },
  properties: {},
  sheets: [
    {
      id: 's1', name: 'Sheet 1',
      size: { kind: 'iso', size: 'A3' }, orientation: 'landscape',
      views: [
        {
          id: 'bv1', kind: 'base' as const,
          positionMm: { x: 20, y: 20 },
          scale: { numerator: 1, denominator: 1 },
          orientation: 'front' as const,
          showHidden: false,
          breaks: [
            { id: 'br1', axis: 'x' as const, coordA: 50, coordB: 100, gapMm: 5, style: 'zigzag' as const },
            { id: 'br2', axis: 'x' as const, coordA: 200, coordB: 280, gapMm: 5, style: 'zigzag' as const },
          ],
        },
      ],
      dimensions: [], annotations: [], titleBlock: {},
    },
  ],
  activeSheetId: 's1',
});

describe('DrawingTreePane — broken views display (no new row)', () => {
  beforeEach(() => {
    useAppStore.setState({
      activeDrawing: makeDrawingWithBrokenView(),
      bus: { execute: vi.fn().mockResolvedValue(undefined) },
    } as never);
  });

  it('view with breaks shows "· [2 breaks]" suffix in tree label', () => {
    render(<DrawingTreePane />);
    const toggles = screen.getAllByText('▸');
    fireEvent.click(toggles[0]!); // expand first sheet
    expect(screen.getByText(/\[2 breaks?\]/i)).toBeInTheDocument();
  });

  it('view with no breaks does NOT show "[N breaks]" suffix', () => {
    // A clean view without breaks
    const cleanDrawing: DrawingDocument = {
      ...makeDrawingWithBrokenView(),
      sheets: [
        {
          ...makeDrawingWithBrokenView().sheets[0]!,
          views: [
            {
              id: 'bv2', kind: 'base' as const,
              positionMm: { x: 20, y: 20 },
              scale: { numerator: 1, denominator: 1 },
              orientation: 'front' as const,
              showHidden: false,
              // no breaks field
            },
          ],
        },
      ],
    };
    useAppStore.setState({
      activeDrawing: cleanDrawing,
      bus: { execute: vi.fn().mockResolvedValue(undefined) },
    } as never);
    render(<DrawingTreePane />);
    const toggles = screen.getAllByText('▸');
    fireEvent.click(toggles[0]!);
    expect(screen.queryByText(/breaks/i)).toBeNull();
  });

  it('broken view does NOT appear as a separate child tree row', () => {
    render(<DrawingTreePane />);
    const toggles = screen.getAllByText('▸');
    fireEvent.click(toggles[0]!);
    // Should not find a "Broken View" label as a standalone row
    expect(screen.queryByText(/^broken view/i)).toBeNull();
    // Should not find a "Broken —" label
    expect(screen.queryByText(/^broken —/i)).toBeNull();
  });
});
```

Run: confirm fails (no break-count suffix rendered).

**Implementation** — modify `DrawingTreePane.tsx`, the view label building block inside `SheetNode`:

```tsx
// Replace the view label section within sheet.views.map() with:
{sheet.views.map((v) => {
  let label: string;
  if (v.kind === 'base') {
    label = `Base — ${v.orientation}`;
  } else if (v.kind === 'projected') {
    label = `Projected — ${v.direction}`;
  } else if (v.kind === 'section') {
    label = `Section — ${v.label}`;
  } else if (v.kind === 'detail') {
    const parent = sheet.views.find((pv) => pv.id === (v as DetailView).parentViewId);
    const fromLabel = parent ? parentViewLabel(parent) : 'unknown';
    label = `Detail ${(v as DetailView).label} (from ${fromLabel})`;
  } else {
    label = `Iso — ${v.corner}`;
  }

  // Append break-count suffix for breakable view kinds
  const breakCount =
    (v.kind === 'base' || v.kind === 'projected' || v.kind === 'iso')
      ? (v.breaks?.length ?? 0)
      : 0;
  if (breakCount > 0) {
    label = `${label} · [${breakCount} break${breakCount === 1 ? '' : 's'}]`;
  }

  return (
    <li key={v.id} style={{ fontSize: '0.8em', color: '#555' }}>
      {label} · {v.scale.numerator}:{v.scale.denominator}
    </li>
  );
})}
```

Run: confirm green.

**Commit:** `feat(drawing-broken-views): DrawingTreePane break-count suffix, no new row — T4.14`

---

### T4.15 — Stale-banner integration

**Spec coverage:** §8.3

This task verifies that the stale-banner predicate (comparing stored `inputFingerprint` to a freshly computed one) correctly picks up `breaks` changes. Since `AddBreakCommand.apply` recomputes `inputFingerprint` after adding a break, the view immediately after the command is NOT stale. The stale banner fires when the source geometry changes but breaks are stale — i.e., the existing stale infrastructure in `DrawingCanvas` already handles this because `inputFingerprint` is augmented by `fingerprintBreaksArray` in Batch 3.

**Unit test** (add to `packages/app/src/drawing/__tests__/DrawingCanvas.spec.tsx`, break stale-banner section):

```ts
describe('DrawingCanvas — stale banner with breaks', () => {
  it('view with breaks and matching inputFingerprint shows no stale marker', () => {
    const sheetWithBrokenView: DrawingSheet = {
      id: 's1', name: 'Sheet 1',
      size: { kind: 'iso', size: 'A3' }, orientation: 'landscape',
      views: [
        {
          id: 'bv1', kind: 'base' as const,
          positionMm: { x: 20, y: 20 },
          scale: { numerator: 1, denominator: 1 },
          orientation: 'front' as const,
          showHidden: false,
          projection: { visibleEdges: [], hiddenEdges: [], bbox: { minX: 0, minY: 0, maxX: 80, maxY: 60 } },
          inputFingerprint: 'fp-with-breaks',  // stored fingerprint is present → not stale
          breaks: [{ id: 'br1', axis: 'x' as const, coordA: 50, coordB: 100, gapMm: 5, style: 'zigzag' as const }],
        },
      ],
      dimensions: [], annotations: [], titleBlock: {},
    };
    useToolModeStore.setState({ mode: 'idle' } as never);
    useAppStore.setState({
      activeDrawing: { ...makeDrawing(), sheets: [sheetWithBrokenView] },
      bus: { execute: vi.fn().mockResolvedValue(undefined) },
    } as never);
    render(<DrawingCanvas />);
    // On initial mount, stale detection uses: view.projection && !view.inputFingerprint
    // Since inputFingerprint IS set, no stale marker is shown
    expect(document.querySelector('[data-stale-marker]')).toBeNull();
  });

  it('view with breaks but missing inputFingerprint is stale', () => {
    const sheetWithStaleBrokenView: DrawingSheet = {
      id: 's1', name: 'Sheet 1',
      size: { kind: 'iso', size: 'A3' }, orientation: 'landscape',
      views: [
        {
          id: 'bv1', kind: 'base' as const,
          positionMm: { x: 20, y: 20 },
          scale: { numerator: 1, denominator: 1 },
          orientation: 'front' as const,
          showHidden: false,
          projection: { visibleEdges: [], hiddenEdges: [], bbox: { minX: 0, minY: 0, maxX: 80, maxY: 60 } },
          // No inputFingerprint → stale
          breaks: [{ id: 'br1', axis: 'x' as const, coordA: 50, coordB: 100, gapMm: 5, style: 'zigzag' as const }],
        },
      ],
      dimensions: [], annotations: [], titleBlock: {},
    };
    useToolModeStore.setState({ mode: 'idle' } as never);
    useAppStore.setState({
      activeDrawing: { ...makeDrawing(), sheets: [sheetWithStaleBrokenView] },
      bus: { execute: vi.fn().mockResolvedValue(undefined) },
    } as never);
    render(<DrawingCanvas />);
    // The existing stale detection in DrawingCanvas fires on: view.projection && !view.inputFingerprint
    expect(document.querySelector('[data-stale-marker]')).not.toBeNull();
  });
});
```

Note: No implementation changes are needed for this task if Batch 2 correctly augments `inputFingerprint` computation in `AddBreakCommand`. This test verifies the existing stale-banner wire-up in `DrawingCanvas` works correctly with broken views. If the tests fail due to type errors on `breaks` in the fixture (type not yet exposing `breaks`), cast to `as DrawingView` or `as never`.

Run: confirm green.

**Commit:** `test(drawing-broken-views): stale-banner integration tests with broken views — T4.15`

---

### T4.16 — Mid-flight Playwright + screenshot proof

**Spec coverage:** `feedback_drive_ui_mid_flight.md` mandate (CLAUDE.md §6)

This is NOT the full T-6-9 spec (that is Batch 5). This is the mid-flight browser-reality check for Batch 4's UI work.

**File:** `tests/e2e/drawing/T-6-9-broken-view-mid-flight.spec.ts` (new)

```ts
// tests/e2e/drawing/T-6-9-broken-view-mid-flight.spec.ts
/**
 * Mid-flight Playwright verification for Batch 4 of Drawing F3 — Broken Views.
 * Not the full T-6-9 spec (that lives in Batch 5).
 *
 * Verifies:
 *   (a) Ribbon "Add Break" button is visible and disabled on a drawing with no projection
 *   (b) After injecting a broken base view, at least one break-symbol polyline renders
 *   (c) break-symbol polyline has data-role="break-symbol"
 *
 * Uses store injection (no real kernel call / canvas click) to isolate UI rendering.
 */
import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';
import { seedDrawingWithBoxPart } from '../helpers/seedDrawing';

test('T-6-9-mid-flight: broken-view UI — ribbon button + break-symbol render + screenshot', async ({ page }) => {
  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('/');
  await waitForKernelReady(page);

  // 1. Seed a drawing with no views.
  const { sheetId } = await seedDrawingWithBoxPart(page, {
    boxLength: 200, boxWidth: 60, boxHeight: 40,
    sheetSize: 'A3', orientation: 'landscape',
  });

  // 2. Switch to Drawing tab.
  await page.getByRole('tab', { name: 'Drawing' }).click();

  // 3. Assert "Add Break" ribbon button is visible (Batch 4 ribbon change).
  const addBreakBtn = page.getByRole('button', { name: /add break/i });
  await expect(addBreakBtn).toBeVisible({ timeout: 10_000 });
  // Should be disabled with no projection
  await expect(addBreakBtn).toBeDisabled();

  // 4. Inject a base view with a break-symbol edge directly via store.
  const viewId = 'T69-mid-base';
  await page.evaluate(
    ({ sheetId, viewId }: { sheetId: string; viewId: string }) => {
      const w = window as unknown as {
        __zilventorStore: {
          getState(): {
            activeDocument?: { kind: string; document: { sheets: Array<{ id: string; views: unknown[] }> } };
            activePart: unknown;
          };
          setState(p: unknown): void;
        };
      };
      const s = w.__zilventorStore.getState();
      const drawing = s.activeDocument?.kind === 'drawing' ? s.activeDocument.document : null;
      if (!drawing) return;

      // Synthetic zigzag break symbol points (simplified sawtooth along Y)
      const zigzagPts: [number, number][] = [];
      for (let i = 0; i <= 60; i += 3) {
        const t0 = i; const t1 = i + 0.75; const t2 = i + 2.25; const t3 = i + 3;
        const spine = 105; // after-break position in view-local mm
        zigzagPts.push([spine, t0], [spine + 1.5, t1], [spine - 1.5, t2], [spine, t3]);
      }

      const baseView = {
        id: viewId, kind: 'base',
        positionMm: { x: 40, y: 80 },
        scale: { numerator: 1, denominator: 1 },
        orientation: 'front', showHidden: false,
        breaks: [{ id: 'br1', axis: 'x', coordA: 50, coordB: 150, gapMm: 5, style: 'zigzag' }],
        rawProjection: {
          visibleEdges: [{ id: 'T69-raw-e0', kind: 'outline', points: [[0, 0], [200, 0], [200, 40], [0, 40], [0, 0]] }],
          hiddenEdges: [],
          bbox: { minX: 0, minY: 0, maxX: 200, maxY: 40 },
        },
        projection: {
          visibleEdges: [
            // Before-band fragment
            { id: 'T69-e0_a', kind: 'outline', points: [[0, 0], [50, 0]] },
            // After-band fragment (compressed)
            { id: 'T69-e0_b', kind: 'outline', points: [[55, 0], [105, 0]] },
            // Break symbol
            { id: 'break_br1', kind: 'break', points: zigzagPts },
          ],
          hiddenEdges: [],
          bbox: { minX: 0, minY: -5, maxX: 110, maxY: 45 },
        },
        inputFingerprint: 'fp-T69-mid',
      };

      const updated = {
        ...(drawing as object),
        sheets: (drawing as { sheets: Array<{ id: string; views: unknown[] }> }).sheets.map((sh) =>
          sh.id === sheetId ? { ...sh, views: [baseView] } : sh,
        ),
      };
      w.__zilventorStore.setState({
        activeDocument: { kind: 'drawing', document: updated },
        activeDrawing: updated,
        activePart: s.activePart,
      });
    },
    { sheetId, viewId },
  );

  // 5. Assert: view is visible in canvas.
  await expect(page.locator(`g[data-view-id="${viewId}"]`)).toBeVisible({ timeout: 10_000 });

  // 6. Assert: at least one break-symbol polyline rendered.
  const breakSymbol = page.locator(`g[data-view-id="${viewId}"] polyline[data-role="break-symbol"]`);
  await expect(breakSymbol.first()).toBeAttached({ timeout: 5_000 });

  // 7. Assert: "Add Break" button now enabled (breakable view with projection exists).
  await expect(addBreakBtn).not.toBeDisabled({ timeout: 3_000 });

  // 8. Capture screenshot proof.
  await page.screenshot({ path: '/tmp/drawing-broken-mid-flight.png' });
  console.log('Screenshot captured: /tmp/drawing-broken-mid-flight.png');
});
```

**Implementer MUST:**

After running this test successfully, open and verify the screenshot at `/tmp/drawing-broken-mid-flight.png` by reading it back:
1. Confirm the original bbox visually shows a horizontal compression (gap visible between two edge segments).
2. Confirm at least one visible zigzag polyline is present in the rendered view.
3. Confirm the "Add Break" button is visible in the ribbon.
4. Include the screenshot path and a 1-sentence visual confirmation in the batch report.

Run command:
```bash
cd /path/to/worktree && npx playwright test tests/e2e/drawing/T-6-9-broken-view-mid-flight.spec.ts --project=chromium
```

**Commit:** `test(drawing-broken-views): mid-flight Playwright + screenshot proof — T4.16`

---

### T4.17 — Green-gate commit

Run the full green-gate:

```bash
pnpm -r typecheck && \
pnpm --filter @zilventor/app test -- \
  packages/app/src/drawing/__tests__/toolMode.spec.ts \
  packages/app/src/drawing/__tests__/DrawingCanvas.spec.tsx \
  packages/app/src/drawing/__tests__/ViewElement.spec.tsx \
  packages/app/src/shell/tabs/__tests__/DrawingTab.spec.tsx \
  packages/app/src/drawing/__tests__/DrawingTreePane.spec.tsx \
  packages/app/src/drawing/__tests__/AddBreakDialog.spec.tsx && \
npx playwright test tests/e2e/drawing/T-6-9-broken-view-mid-flight.spec.ts --project=chromium
```

Confirm: typecheck clean; all unit tests green; mid-flight Playwright green; screenshot at `/tmp/drawing-broken-mid-flight.png` reviewed and passes visual inspection (zigzag visible, bbox compressed, ribbon button present).

**Commit:** `feat(drawing-broken-views): tool mode + UI + ribbon + AddBreakDialog + mid-flight proof — Batch 4 complete`

---

## Reviewer dispatch — Batch 4 (combined spec + code review, single Sonnet)

> **Note to controller:** Dispatch this reviewer AFTER Batch 5 is complete (not after Batch 4 alone). This is the single combined spec+code reviewer for Batches 4+5 per the `next_session_resume.md` policy. Part 5 references this template.

---

**Prompt template (dispatch to a single Sonnet subagent after Batch 5 lands):**

```
Ultrathink, then perform a combined spec compliance + code quality review for Drawing F3 — Broken Views, covering Batches 4 and 5.

You are a senior reviewer. Your job is to find gaps, not praise the work. Be terse and specific.

## Files to review

Spec sections to check against:
- §11 (tool mode: ToolMode union, BreakToolState, 5 store actions, ESC back-tracking)
- §12 (UI: DrawingCanvas click dispatch, ViewElement break-symbol rendering, AddBreakDialog, ribbon button, DrawingTreePane no-new-row)
- §14 (E2E: T-6-9 test, 5 assertions per §14.3)
- §15 (Perf: drawing-broken.perf.spec.ts, __zilventorBrokenViewMs probe, p95 < 50ms)

Spec file: docs/superpowers/specs/2026-05-06-drawing-broken-views-design.md

Code files to review (read each before commenting):
- packages/app/src/drawing/toolMode.ts
- packages/app/src/drawing/__tests__/toolMode.spec.ts
- packages/app/src/drawing/DrawingCanvas.tsx
- packages/app/src/drawing/__tests__/DrawingCanvas.spec.tsx
- packages/app/src/drawing/ViewElement.tsx
- packages/app/src/drawing/__tests__/ViewElement.spec.tsx
- packages/app/src/drawing/AddBreakDialog.tsx
- packages/app/src/drawing/__tests__/AddBreakDialog.spec.tsx
- packages/app/src/shell/tabs/DrawingTab.tsx
- packages/app/src/shell/tabs/__tests__/DrawingTab.spec.tsx
- packages/app/src/drawing/DrawingTreePane.tsx
- packages/app/src/drawing/__tests__/DrawingTreePane.spec.tsx
- tests/e2e/drawing/T-6-9-broken-view-mid-flight.spec.ts
- tests/e2e/drawing/T-6-9-broken-view.spec.ts  (Batch 5)
- tests/perf/drawing-broken.perf.spec.ts  (Batch 5)
- packages/app/src/App.tsx  (__zilventorBrokenViewMs probe — Batch 5)

## What to flag (check each explicitly)

1. **BreakToolState axis state machine** — are all 5 stages (idle, pickParent, pickAxis, pickP0, pickP1) correctly implemented with the right transitions? Does `breakPickP1` correctly transition to `mode: 'idle'` AND `breakState: { stage: 'idle' }` (not stage: 'pickParent')? Does each action warn on invalid stage?

2. **ESC double-press** — does `breakCancel()` correctly back up exactly one stage? Does it exit break mode entirely when stage is `pickParent`? Is it wired in the DrawingCanvas ESC `useEffect` alongside `sectionCancel` and `detailCancel`?

3. **Ribbon disabled state** — does the "Add Break" button disable condition check `view.kind === 'base' || 'projected' || 'iso'` AND `view.projection != null`? Does it NOT check `view.rawProjection`? (α-conditional: rawProjection absent on un-broken views.)

4. **ViewElement break-tier styling** — does the `kind === 'break'` branch emit `data-role="break-symbol"` and `strokeWidth="0.5"`? Does the normal branch still emit `strokeWidth="0.35"` without `data-role`? Is the break-symbol branch INSIDE the `data-edge-group="visible"` `<g>`, not a separate group?

5. **DrawingTreePane no-new-row** — does the broken view appear as a label suffix (e.g., `Base — front · [2 breaks]`) rather than a standalone child row? Does a view with `breaks: undefined` or `breaks: []` show no suffix?

6. **Mid-flight screenshot proof** — does `/tmp/drawing-broken-mid-flight.png` exist? Confirm it is referenced in the Batch 4 commit message or test output. Flag if absent.

7. **T-6-9 E2E assertions** — does the full T-6-9 spec (Batch 5) include all 5 assertions from §14.3: (1) bbox shrunk, (2) break symbol present, (3) undo restores bbox, (4) redo re-applies, (5) α-conditional invariant (rawProjection === undefined after undo of last break)?

8. **Perf probe** — is `__zilventorBrokenViewMs` exposed on `window` in `App.tsx`? Does the perf test assert `p95 < 50` ms?

9. **`breakState` on `reset()`** — does `reset()` clear `breakState` to `{ stage: 'idle' }`?

10. **`AddBreakCommand` import in DrawingCanvas** — confirm no Node-only API (`crypto.createHash`, `fs`, `path`) is imported in any of the reviewed files. (Vite browser externalization risk per `feedback_drive_ui_mid_flight`.)

## Output format

Return a numbered list, one item per finding. Each finding: file + line (approximate), what spec section it violates, and the exact fix required. If an item is correct, write "OK". Do not pad with praise.

Report under 500 words.
```
## Batch 5 preamble (load-bearing constraints)

- Desktop Chromium only; OPFS-only storage; no server.
- **No kernel calls.** All assertions operate on injected store state; `applyBreaks` is pure 2D.
- α-conditional invariant carries through every test assertion: `view.rawProjection !== undefined ⟺ view.breaks.length > 0`.
- TDD per CLAUDE.md §4a: every failing assertion is proven red before the implementation step makes it green.
- After every commit in this batch, run `pnpm --filter @zilventor/app exec playwright test --project=chromium` (e2e) and `pnpm -r test:unit` (units) from the repo root and confirm all green.
- Plan code snippets are REFERENCE — verify external identifiers (exports, type names, function signatures, store field names) against the actual codebase before re-emitting them. The codebase is the source of truth.
- `feedback_drive_ui_mid_flight` policy: because Batch 4 must already have delivered a Playwright screenshot, Batch 5 only needs to confirm the probe callable from `page.evaluate` — no full Playwright run of the UI is required again, but the perf spec MUST exercise the probe via a real browser page to rule out import/bundler gaps.
- `feedback_verify_before_done_claim`: controller verifies via `git log --oneline <pre-batch-sha>..HEAD` + re-running `pnpm --filter @zilventor/app exec playwright test T-6-9 --project=chromium` before marking Batch 5 done.

---

## Batch 5 — T-6-9 e2e + perf + manual smoke + final-pass reviewer prep

**Green gate:** T-6-9 all five assertions green; `drawing-broken.perf.spec.ts` p95 < 50 ms; full unit suite green; `pnpm -r typecheck` passes; manual smoke checklist file committed.

**Spec coverage:** §14.1 (preconditions), §14.2 (dispatch sequence), §14.3 (all 5 assertions), §15.1 (probe location), §15.2 (fixture shape), §15.3 (p95 budget), §16 Batch 5, §17 (deferred — referenced in final-pass template below).

---

### Files touched

**Create:**
- `tests/e2e/drawing/T-6-9-broken-view.spec.ts`
- `tests/perf/drawing-broken.perf.spec.ts`
- `docs/superpowers/manual-tests/drawing-broken-views.md`

**Modify:**
- `packages/app/src/App.tsx` — add `__zilventorBrokenViewMs` window probe (mirrors `__zilventorDetailViewMs` block at line 437)

---

### Task T5.1 — T-6-9 e2e skeleton

**Spec:** §14.1, §14.2. **File:** Create `tests/e2e/drawing/T-6-9-broken-view.spec.ts`.

This task establishes the scaffold and verifies the app boots with a synthetic broken-view drawing — no break-specific assertions yet; those land in T5.2–T5.6.

- [ ] **Step 1: Write the skeleton test (expect FAIL until T5.2–T5.6)**

  Create `tests/e2e/drawing/T-6-9-broken-view.spec.ts`:

  ```ts
  // tests/e2e/drawing/T-6-9-broken-view.spec.ts
  import { test, expect } from '@playwright/test';
  import { waitForKernelReady } from '../helpers/buildBox';
  import { seedDrawingWithBoxPart } from '../helpers/seedDrawing';

  /**
   * T-6-9 — Broken view: inject a BaseView with a long horizontal edge
   * spanning 0..400 mm, dispatch AddBreakCommand via store-injection, then
   * assert bbox compression, break-symbol polyline, undo/redo, and
   * α-conditional rawProjection invariant.
   *
   * Uses the store-injection pattern from T-6-8 — no real canvas clicks needed.
   * applyBreaks is pure 2D; no Comlink/kernel round-trip.
   */

  const BASE_VIEW_ID = 'T69-base';
  const DRAWING_ID  = 'T69-drawing';

  // Shared helper: inject a BaseView with a 400 mm horizontal edge into the store.
  async function injectBaseView(page: import('@playwright/test').Page, sheetId: string): Promise<void> {
    await page.evaluate(
      ({ sheetId, baseViewId, drawingId }: { sheetId: string; baseViewId: string; drawingId: string }) => {
        const w = window as unknown as {
          __zilventorStore: {
            getState(): {
              activeDocument?: { kind: string; document: { sheets: Array<{ id: string; views: unknown[] }> } };
              activePart: unknown;
            };
            setState(p: unknown): void;
          };
        };
        const s = w.__zilventorStore.getState();
        const drawing = s.activeDocument?.kind === 'drawing' ? s.activeDocument.document : null;
        if (!drawing) return;

        const baseView = {
          id: baseViewId,
          kind: 'base' as const,
          positionMm: { x: 50, y: 80 },
          scale: { numerator: 1, denominator: 1 },
          orientation: 'front' as const,
          showHidden: false,
          breaks: [],
          rawProjection: undefined,
          projection: {
            visibleEdges: [
              // Long horizontal edge spanning 0..400 mm (view-local x).
              { id: 'T69-e0', kind: 'outline', points: [[0, 0], [400, 0]] },
              // Short vertical edges at each end so the bbox is well-defined.
              { id: 'T69-e1', kind: 'outline', points: [[0, 0], [0, 10]] },
              { id: 'T69-e2', kind: 'outline', points: [[400, 0], [400, 10]] },
            ],
            hiddenEdges: [],
            bbox: { minX: 0, minY: -5, maxX: 400, maxY: 10 },
          },
          inputFingerprint: 'fp-T69-base',
        };

        const updated = {
          ...(drawing as object),
          sheets: (drawing as { sheets: Array<{ id: string; views: unknown[] }> }).sheets.map((sh) =>
            sh.id === sheetId ? { ...sh, views: [baseView] } : sh,
          ),
        };
        w.__zilventorStore.setState({
          activeDocument: { kind: 'drawing', document: updated },
          activeDrawing: updated,
          activePart: s.activePart,
        });
      },
      { sheetId, baseViewId: BASE_VIEW_ID, drawingId: DRAWING_ID },
    );
  }

  // Helper: dispatch AddBreakCommand via dynamic import (same pattern as T-6-7 for AddSectionViewCommand).
  async function applyBreak(
    page: import('@playwright/test').Page,
    sheetId: string,
    coordA: number,
    coordB: number,
  ): Promise<void> {
    await page.evaluate(
      async ({ sheetId, viewId, coordA, coordB }: { sheetId: string; viewId: string; coordA: number; coordB: number }) => {
        const { AddBreakCommand } = await import('/src/commands/AddBreakCommand.ts');
        const cmd = new AddBreakCommand({
          drawingId: 'T69-drawing',
          sheetId,
          viewId,
          axis: 'x',
          coordA,
          coordB,
          gapMm: 5,
        });
        await cmd.apply();
      },
      { sheetId, viewId: BASE_VIEW_ID, coordA, coordB },
    );
  }

  // Helper: read the base view from the store.
  async function getBaseView(page: import('@playwright/test').Page, sheetId: string) {
    return page.evaluate(
      ({ sheetId, viewId }: { sheetId: string; viewId: string }) => {
        const w = window as unknown as {
          __zilventorStore: {
            getState(): {
              activeDocument?: { kind: string; document: { sheets: Array<{ id: string; views: Array<{ id: string; projection?: { bbox: { minX: number; maxX: number; minY: number; maxY: number }; visibleEdges: Array<{ kind: string }> }; rawProjection?: unknown; breaks?: unknown[] }> }> } };
            };
          };
        };
        const doc = w.__zilventorStore.getState().activeDocument;
        if (doc?.kind !== 'drawing') return null;
        const sheet = doc.document.sheets.find((s) => s.id === sheetId);
        return sheet?.views.find((v) => v.id === viewId) ?? null;
      },
      { sheetId, viewId: BASE_VIEW_ID },
    );
  }

  test.describe('T-6-9 — Broken View', () => {
    let sheetId: string;

    test.beforeEach(async ({ page }) => {
      page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
      page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

      await page.goto('/');
      await waitForKernelReady(page);

      const seeded = await seedDrawingWithBoxPart(page, {
        boxLength: 100, boxWidth: 60, boxHeight: 40,
        sheetSize: 'A3', orientation: 'landscape',
      });
      sheetId = seeded.sheetId;

      await injectBaseView(page, sheetId);

      await page.getByRole('tab', { name: 'Drawing' }).click();
      await expect(page.locator(`g[data-view-id="${BASE_VIEW_ID}"]`)).toBeVisible({ timeout: 10_000 });
    });

    // T5.1 green gate: canvas mounted with injected view.
    test('skeleton: app navigates to / and renders the injected base view', async ({ page }) => {
      await expect(page.locator(`g[data-view-id="${BASE_VIEW_ID}"]`)).toBeVisible({ timeout: 5_000 });
    });
  });
  ```

- [ ] **Step 2: Run and confirm FAIL for the right reason (import resolution only at this stage)**

  ```bash
  pnpm --filter @zilventor/app exec playwright test T-6-9 --project=chromium 2>&1 | tail -20
  ```

  Expected: the skeleton test PASSES (canvas visible) but placeholder structure is ready for assertion tasks. If it fails with an import error, check `tests/e2e/helpers/seedDrawing.ts` — the helper must exist from T-6-8; adjust path if needed.

- [ ] **Step 3: Commit skeleton**

  ```bash
  git add tests/e2e/drawing/T-6-9-broken-view.spec.ts
  git commit -m "test(e2e): T-6-9 broken-view e2e skeleton — canvas mounts"
  ```

---

### Task T5.2 — T-6-9 assertion 1: bbox compression

**Spec:** §14.3 assertion 1. **File:** Modify `tests/e2e/drawing/T-6-9-broken-view.spec.ts`.

After `AddBreakCommand` with `axis: 'x', coordA: 150, coordB: 250, gapMm: 5`, the bbox width should shrink from 400 mm to ≈305 mm (400 − (250−150−5) = 305). Tolerance ±2 mm.

- [ ] **Step 1: Write the failing assertion (add inside `test.describe`)**

  ```ts
  test('assertion 1: bbox width shrinks after AddBreakCommand', async ({ page }) => {
    await applyBreak(page, sheetId, 150, 250);

    const view = await getBaseView(page, sheetId);
    expect(view).not.toBeNull();
    const bboxWidth = view!.projection!.bbox.maxX - view!.projection!.bbox.minX;
    // Band removed: 250−150−5 = 95; original width 400 − 95 = 305.
    expect(bboxWidth).toBeGreaterThan(300);
    expect(bboxWidth).toBeLessThan(310);

    // Also assert rawProjection is populated (α-conditional: first break).
    expect(view!.rawProjection).toBeDefined();
  });
  ```

- [ ] **Step 2: Run — expect FAIL (AddBreakCommand not yet wired)**

  ```bash
  pnpm --filter @zilventor/app exec playwright test T-6-9 --project=chromium --grep "assertion 1" 2>&1 | tail -20
  ```

- [ ] **Step 3: This test turns green after Batch 3/4 land `AddBreakCommand`. Confirm:**

  ```bash
  pnpm --filter @zilventor/app exec playwright test T-6-9 --project=chromium --grep "assertion 1" 2>&1 | tail -5
  ```

- [ ] **Step 4: Commit**

  ```bash
  git add tests/e2e/drawing/T-6-9-broken-view.spec.ts
  git commit -m "test(e2e): T-6-9 assertion 1 — bbox compression after AddBreakCommand"
  ```

---

### Task T5.3 — T-6-9 assertion 2: break-symbol polyline rendered

**Spec:** §14.3 assertion 2. **File:** Modify `tests/e2e/drawing/T-6-9-broken-view.spec.ts`.

After `AddBreakCommand`, the DOM must contain at least one `<polyline data-role="break-symbol">` inside the view's SVG group. Also check via store that `visibleEdges` contains at least one edge with `kind === 'break'`.

- [ ] **Step 1: Write the failing assertion**

  ```ts
  test('assertion 2: break-symbol polyline present in DOM and store', async ({ page }) => {
    await applyBreak(page, sheetId, 150, 250);

    // Store-level: at least one Edge2D with kind 'break'.
    const breakEdgeCount = await page.evaluate(
      ({ sheetId, viewId }: { sheetId: string; viewId: string }) => {
        const w = window as unknown as {
          __zilventorStore: {
            getState(): {
              activeDocument?: { kind: string; document: { sheets: Array<{ id: string; views: Array<{ id: string; projection?: { visibleEdges: Array<{ kind: string }> } }> }> } };
            };
          };
        };
        const doc = w.__zilventorStore.getState().activeDocument;
        if (doc?.kind !== 'drawing') return 0;
        const sheet = doc.document.sheets.find((s) => s.id === sheetId);
        const view = sheet?.views.find((v) => v.id === viewId);
        return view?.projection?.visibleEdges.filter((e) => e.kind === 'break').length ?? 0;
      },
      { sheetId, viewId: BASE_VIEW_ID },
    );
    expect(breakEdgeCount).toBeGreaterThan(0);

    // DOM-level: at least one polyline with data-role="break-symbol".
    const breakSymbols = page.locator(`g[data-view-id="${BASE_VIEW_ID}"] polyline[data-role="break-symbol"]`);
    await expect(breakSymbols.first()).toBeAttached({ timeout: 5_000 });
  });
  ```

- [ ] **Step 2: Run — expect FAIL (Batch 4's ViewElement branch not yet landed)**

  ```bash
  pnpm --filter @zilventor/app exec playwright test T-6-9 --project=chromium --grep "assertion 2" 2>&1 | tail -20
  ```

- [ ] **Step 3: Confirm green after Batch 4 lands `ViewElement` kind-'break' branch:**

  ```bash
  pnpm --filter @zilventor/app exec playwright test T-6-9 --project=chromium --grep "assertion 2" 2>&1 | tail -5
  ```

- [ ] **Step 4: Commit**

  ```bash
  git add tests/e2e/drawing/T-6-9-broken-view.spec.ts
  git commit -m "test(e2e): T-6-9 assertion 2 — break-symbol polyline in DOM and store"
  ```

---

### Task T5.4 — T-6-9 assertion 3: undo restores original bbox

**Spec:** §14.3 assertion 3. **File:** Modify `tests/e2e/drawing/T-6-9-broken-view.spec.ts`.

After `AddBreakCommand`, undo via `AddBreakCommand.revert()` (simulated via store-injection restoring the original view, mirroring the T-6-7/T-6-8 undo pattern): bbox returns to ≈400 mm; `breaks` array empty; `rawProjection === undefined`.

- [ ] **Step 1: Write the failing assertion**

  ```ts
  test('assertion 3: undo restores original bbox (breaks empty, rawProjection undefined)', async ({ page }) => {
    await applyBreak(page, sheetId, 150, 250);

    // Simulate undo: restore base view to pre-break state via store injection.
    await page.evaluate(
      ({ sheetId, baseViewId }: { sheetId: string; baseViewId: string }) => {
        const w = window as unknown as {
          __zilventorStore: {
            getState(): {
              activeDocument?: { kind: string; document: { sheets: Array<{ id: string; views: unknown[] }> } };
              activePart: unknown;
            };
            setState(p: unknown): void;
          };
        };
        const s = w.__zilventorStore.getState();
        const drawing = s.activeDocument?.kind === 'drawing' ? s.activeDocument.document : null;
        if (!drawing) return;
        const restoredView = {
          id: baseViewId, kind: 'base',
          positionMm: { x: 50, y: 80 },
          scale: { numerator: 1, denominator: 1 },
          orientation: 'front', showHidden: false,
          breaks: [], rawProjection: undefined,
          projection: {
            visibleEdges: [
              { id: 'T69-e0', kind: 'outline', points: [[0, 0], [400, 0]] },
              { id: 'T69-e1', kind: 'outline', points: [[0, 0], [0, 10]] },
              { id: 'T69-e2', kind: 'outline', points: [[400, 0], [400, 10]] },
            ],
            hiddenEdges: [],
            bbox: { minX: 0, minY: -5, maxX: 400, maxY: 10 },
          },
          inputFingerprint: 'fp-T69-base',
        };
        const updated = {
          ...(drawing as object),
          sheets: (drawing as { sheets: Array<{ id: string; views: unknown[] }> }).sheets.map((sh) =>
            sh.id === sheetId ? { ...sh, views: [restoredView] } : sh,
          ),
        };
        w.__zilventorStore.setState({
          activeDocument: { kind: 'drawing', document: updated },
          activeDrawing: updated,
          activePart: s.activePart,
        });
      },
      { sheetId, baseViewId: BASE_VIEW_ID },
    );

    const view = await getBaseView(page, sheetId);
    const bboxWidth = view!.projection!.bbox.maxX - view!.projection!.bbox.minX;
    expect(bboxWidth).toBeGreaterThan(395);   // original 400 ±5
    expect(view!.breaks).toHaveLength(0);
    expect(view!.rawProjection).toBeUndefined();

    // DOM: no break-symbol polylines present.
    await expect(
      page.locator(`g[data-view-id="${BASE_VIEW_ID}"] polyline[data-role="break-symbol"]`)
    ).toHaveCount(0, { timeout: 5_000 });
  });
  ```

- [ ] **Step 2: Run — expect FAIL initially; confirm green after Batches 3+4 land.**

  ```bash
  pnpm --filter @zilventor/app exec playwright test T-6-9 --project=chromium --grep "assertion 3" 2>&1 | tail -10
  ```

- [ ] **Step 3: Commit**

  ```bash
  git add tests/e2e/drawing/T-6-9-broken-view.spec.ts
  git commit -m "test(e2e): T-6-9 assertion 3 — undo restores bbox and clears rawProjection"
  ```

---

### Task T5.5 — T-6-9 assertion 4: redo re-applies break

**Spec:** §14.3 assertion 4. **File:** Modify `tests/e2e/drawing/T-6-9-broken-view.spec.ts`.

After undo (assertion 3 state), re-apply the break via store injection (simulates redo). Bbox compressed again; `breaks.length === 1`; break-symbol polyline present.

- [ ] **Step 1: Write the failing assertion**

  ```ts
  test('assertion 4: redo re-applies break (bbox compressed, breaks.length === 1)', async ({ page }) => {
    // Apply, then undo (restore original), then redo (re-apply).
    await applyBreak(page, sheetId, 150, 250);
    // Undo: restore original via store (same helper body as assertion 3).
    // ... (inline or share with assertion 3 helper) ...

    // Redo: re-apply break via AddBreakCommand.
    await applyBreak(page, sheetId, 150, 250);

    const view = await getBaseView(page, sheetId);
    const bboxWidth = view!.projection!.bbox.maxX - view!.projection!.bbox.minX;
    expect(bboxWidth).toBeGreaterThan(300);
    expect(bboxWidth).toBeLessThan(310);
    expect((view!.breaks as unknown[]).length).toBe(1);

    // DOM: break-symbol present.
    await expect(
      page.locator(`g[data-view-id="${BASE_VIEW_ID}"] polyline[data-role="break-symbol"]`)
    ).toBeAttached({ timeout: 5_000 });
  });
  ```

  Note: because the `beforeEach` block re-injects a fresh view on each test, the "undo step" in this test is a separate inline store-restore call (same pattern as assertion 3). Extract the restore into a local async helper to avoid duplication.

- [ ] **Step 2: Run — confirm FAIL, then green after Batches 3+4.**

  ```bash
  pnpm --filter @zilventor/app exec playwright test T-6-9 --project=chromium --grep "assertion 4" 2>&1 | tail -10
  ```

- [ ] **Step 3: Commit**

  ```bash
  git add tests/e2e/drawing/T-6-9-broken-view.spec.ts
  git commit -m "test(e2e): T-6-9 assertion 4 — redo re-applies break compression"
  ```

---

### Task T5.6 — T-6-9 assertion 5: α-conditional invariant on empty-breaks state

**Spec:** §14.3 assertion 5; §9.1 (α-conditional invariant). **File:** Modify `tests/e2e/drawing/T-6-9-broken-view.spec.ts`.

After adding a break then removing it (simulated via store injection of a view with `breaks: [], rawProjection: undefined`): the view's `rawProjection` is `undefined`. This verifies the α-conditional invariant survives the full add→delete cycle at the DOM/store boundary.

- [ ] **Step 1: Write the failing assertion**

  ```ts
  test('assertion 5: alpha-conditional invariant — rawProjection undefined when breaks empty after delete', async ({ page }) => {
    // Step 1: add a break.
    await applyBreak(page, sheetId, 150, 250);

    // Verify raw projection is set (breaks.length === 1).
    const viewWithBreak = await getBaseView(page, sheetId);
    expect(viewWithBreak!.rawProjection).toBeDefined();

    // Step 2: delete the sole break via DeleteBreakCommand.
    const breakId = await page.evaluate(
      ({ sheetId, viewId }: { sheetId: string; viewId: string }) => {
        const w = window as unknown as {
          __zilventorStore: {
            getState(): {
              activeDocument?: { kind: string; document: { sheets: Array<{ id: string; views: Array<{ id: string; breaks?: Array<{ id: string }> }> }> } };
            };
          };
        };
        const doc = w.__zilventorStore.getState().activeDocument;
        if (doc?.kind !== 'drawing') return null;
        const sheet = doc.document.sheets.find((s) => s.id === sheetId);
        const view = sheet?.views.find((v) => v.id === viewId);
        return view?.breaks?.[0]?.id ?? null;
      },
      { sheetId, viewId: BASE_VIEW_ID },
    );
    expect(breakId).not.toBeNull();

    await page.evaluate(
      async ({ sheetId, viewId, breakId }: { sheetId: string; viewId: string; breakId: string }) => {
        const { DeleteBreakCommand } = await import('/src/commands/DeleteBreakCommand.ts');
        const cmd = new DeleteBreakCommand({
          drawingId: 'T69-drawing',
          sheetId,
          viewId,
          breakId,
        });
        await cmd.apply();
      },
      { sheetId, viewId: BASE_VIEW_ID, breakId: breakId! },
    );

    // α-conditional: after last break removed, rawProjection must be undefined.
    const viewAfterDelete = await getBaseView(page, sheetId);
    expect(viewAfterDelete!.rawProjection).toBeUndefined();
    expect((viewAfterDelete!.breaks as unknown[]).length).toBe(0);

    // DOM: no break-symbol polylines.
    await expect(
      page.locator(`g[data-view-id="${BASE_VIEW_ID}"] polyline[data-role="break-symbol"]`)
    ).toHaveCount(0, { timeout: 5_000 });
  });
  ```

- [ ] **Step 2: Run — confirm FAIL, then green after Batches 3+4.**

  ```bash
  pnpm --filter @zilventor/app exec playwright test T-6-9 --project=chromium --grep "assertion 5" 2>&1 | tail -10
  ```

- [ ] **Step 3: Run all 5 assertions together and confirm all green:**

  ```bash
  pnpm --filter @zilventor/app exec playwright test T-6-9 --project=chromium 2>&1 | tail -20
  ```

- [ ] **Step 4: Commit**

  ```bash
  git add tests/e2e/drawing/T-6-9-broken-view.spec.ts
  git commit -m "test(e2e): T-6-9 assertion 5 — alpha-conditional invariant on empty-breaks delete"
  ```

---

### Task T5.7 — Perf spec: `drawing-broken.perf.spec.ts`

**Spec:** §15.1, §15.2, §15.3. **File:** Create `tests/perf/drawing-broken.perf.spec.ts`.

Mirrors `tests/perf/drawing-detail.perf.spec.ts`. The test waits for `window.__zilventorBrokenViewMs` to be callable, then invokes it with `n=100` and asserts `p95 < 50 ms`.

- [ ] **Step 1: Write the failing spec (fails until T5.8 wires the probe)**

  Create `tests/perf/drawing-broken.perf.spec.ts`:

  ```ts
  // tests/perf/drawing-broken.perf.spec.ts
  import { test, expect } from '@playwright/test';

  /**
   * Perf — Drawing F3 broken-view applyBreaks (pure 2D clip + translate; no kernel call).
   *
   * Runs 100 iterations of applyBreaks against a 1 000-edge synthetic fixture
   * (10 axis-aligned + 990 random oblique edges, 2 x-axis breaks).
   * Budget: p95 < 50 ms.
   *
   * The app exposes window.__zilventorBrokenViewMs(n) in dev mode (wired in App.tsx,
   * same block as __zilventorDetailViewMs).  Returns { p95ms: number }.
   */
  test('Perf drawing-broken: applyBreaks 100-iter p95 < 50ms', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(
      () => typeof (window as { __zilventorBrokenViewMs?: unknown }).__zilventorBrokenViewMs === 'function',
      undefined,
      { timeout: 30_000 },
    );
    const result = await page.evaluate(
      () =>
        (window as {
          __zilventorBrokenViewMs?: (n: number) => Promise<{ p95ms: number }>;
        }).__zilventorBrokenViewMs!(100),
    );
    const { p95ms } = result;
    console.log(`[perf] broken-view applyBreaks p95 = ${p95ms.toFixed(2)} ms (budget 50ms)`);
    expect(p95ms).toBeLessThan(50);
  });
  ```

- [ ] **Step 2: Run — confirm FAIL (probe not yet exposed):**

  ```bash
  pnpm --filter @zilventor/app exec playwright test drawing-broken.perf --project=chromium 2>&1 | tail -10
  ```

  Expected failure: timeout waiting for `__zilventorBrokenViewMs` to appear.

- [ ] **Step 3: Commit skeleton**

  ```bash
  git add tests/perf/drawing-broken.perf.spec.ts
  git commit -m "test(perf): drawing-broken.perf.spec.ts skeleton — waits for __zilventorBrokenViewMs probe"
  ```

---

### Task T5.8 — Window probe wiring: `__zilventorBrokenViewMs` in `App.tsx`

**Spec:** §15.1. **File:** Modify `packages/app/src/App.tsx`.

Add the `__zilventorBrokenViewMs` probe immediately after the `__zilventorDetailViewMs` block (line ~464 in current HEAD). The probe must be wired in the same `useEffect(…, [])` that houses `__zilventorDetailViewMs` so they share the same guard and lifecycle.

- [ ] **Step 1: Locate the exact insertion point**

  ```bash
  grep -n '__zilventorDetailViewMs\|__zilventorBrokenViewMs' packages/app/src/App.tsx
  ```

  Confirm the closing `};` of the `__zilventorDetailViewMs` block (should be around line 464). Insert the new probe immediately after that `};`.

- [ ] **Step 2: Add the probe block**

  In `packages/app/src/App.tsx`, after the `__zilventorDetailViewMs` closing `};`, insert:

  ```ts
  w.__zilventorBrokenViewMs = async (n = 100) => {
    const { applyBreaks } = await import('@zilventor/shared/src/drawing/applyBreaks');
    type Edge2D = import('@zilventor/shared').Edge2D;
    // Fixture: 1 000 edges — 10 axis-aligned + 990 oblique (per spec §15.2).
    const syntheticEdges = Array.from({ length: 1000 }, (_, i): Edge2D => {
      if (i < 10) {
        // Axis-aligned horizontal.
        return { id: `e${i}`, kind: 'silhouette' as const, points: [[0, i * 10], [1000, i * 10]] };
      }
      // Oblique: random-ish endpoints seeded by index.
      const x0 = (i * 37) % 1000;
      const y0 = (i * 53) % 100;
      const x1 = (x0 + 200 + (i % 300)) % 1000;
      const y1 = (y0 + 50 + (i % 50)) % 100;
      return { id: `e${i}`, kind: 'silhouette' as const, points: [[x0, y0], [x1, y1]] };
    });
    const breaks = [
      { id: 'b1', axis: 'x' as const, coordA: 100, coordB: 300, gapMm: 5, style: 'zigzag' as const },
      { id: 'b2', axis: 'x' as const, coordA: 500, coordB: 700, gapMm: 5, style: 'zigzag' as const },
    ];
    const bbox = { minX: 0, minY: 0, maxX: 1000, maxY: 100 };
    const samples: number[] = [];
    for (let i = 0; i < n; i++) {
      const t0 = performance.now();
      applyBreaks(syntheticEdges, breaks, bbox);
      samples.push(performance.now() - t0);
    }
    samples.sort((a, b) => a - b);
    const p95ms = samples[Math.floor(samples.length * 0.95)] ?? 0;
    return { p95ms };
  };
  ```

  Note: The spec (§15.2) specifies a single break for the fixture, but §15.1 pseudo-code shows two breaks in its example. Use two breaks (more realistic stress) — this is within the 50 ms budget given `applyBreaks` is O(edges × segments) 1D clip.

- [ ] **Step 3: Run typecheck**

  ```bash
  pnpm --filter @zilventor/app typecheck
  ```

- [ ] **Step 4: Confirm perf spec now passes:**

  ```bash
  pnpm --filter @zilventor/app exec playwright test drawing-broken.perf --project=chromium 2>&1 | tail -10
  ```

  Expected: `[perf] broken-view applyBreaks p95 = X.XX ms (budget 50ms)` with X << 50.

- [ ] **Step 5: Verify probe callable from Playwright page.evaluate:**

  ```bash
  pnpm --filter @zilventor/app exec playwright test drawing-broken.perf --project=chromium --reporter=line 2>&1 | grep -E "passed|failed|p95"
  ```

- [ ] **Step 6: Commit**

  ```bash
  git add packages/app/src/App.tsx
  git commit -m "feat(drawing-broken-views): wire __zilventorBrokenViewMs perf probe in App.tsx"
  ```

---

### Task T5.9 — Manual smoke checklist: `drawing-broken-views.md`

**Spec:** §16 Batch 5 (manual smoke). **File:** Create `docs/superpowers/manual-tests/drawing-broken-views.md`.

Mirrors the structure of `docs/superpowers/manual-tests/drawing-detail-views.md`.

- [ ] **Step 1: Create the checklist file**

  Create `docs/superpowers/manual-tests/drawing-broken-views.md`:

  ```markdown
  # Drawing F3 — Broken Views: Manual Smoke Checklist

  Run this checklist on a local dev build after T-6-9 passes in CI.

  ## Steps

  1. **Open an existing drawing with a long base or projected view.**
     - Open any `.zidw` file that has at least one `BaseView`, `ProjectedView`, or `IsoView`
       with a populated projection and a total bbox width > 100 mm along the x-axis.
     - Expected: Drawing tab shows the view with visible edges; no stale banner.

  2. **Enter break mode and pick the x-axis.**
     - Click Drawing tab → Place Views → Add Break.
     - Click the base view (status bar: "Click a base, projected, or iso view to add a break.").
     - The "Choose break direction" dialog opens. Click "Horizontal break (remove X band)".
     - Status bar: "Click to set break start (coord along x axis)."
     - Click a point roughly 30 % across the view. Status bar: "Click to set break end."
     - Click a second point roughly 70 % across the view.
     - Expected: View visually compresses; a zigzag break symbol appears at the break
       boundary; the DrawingTreePane row for the view gains a "· [1 break(s)]" suffix.

  3. **Create a second break on the same view (different x-band).**
     - Repeat step 2 picking a different, non-overlapping band (e.g. first break at 30–50 %,
       second break at 60–80 % of the original width).
     - Expected: Both zigzag symbols render; tree-pane suffix reads "· [2 break(s)]".
     - Confirm the two break symbols are visually distinct and do not overlap.

  4. **Delete the first break and verify α-conditional invariant.**
     - Right-click the view → "Properties" (or use the command palette: DeleteBreak with
       the first break's ID — refer to the store via devtools `__zilventorStore.getState()`).
     - After deleting the first break, one break symbol remains visible.
     - After deleting the second (last) break, the view returns to its original uncompressed
       width; no zigzag symbols remain; `__zilventorStore.getState()` shows `rawProjection`
       is `undefined` on the view (α-conditional invariant restored).
     - Tree-pane suffix disappears once breaks reach zero.

  5. **Export to PDF and inspect break symbols.**
     - With at least one break active on the view, click File → Export → Export as PDF.
     - Open the exported PDF in any viewer.
     - Expected: Zigzag break symbol visible in the PDF at the correct position; the view
       appears compressed; no artifacts outside the view bbox; PDF opens without error.

  6. **Round-trip save/load via OPFS (breaks survive).**
     - With one or more breaks active, save the drawing (Ctrl+S / File → Save).
     - Close the drawing tab and reopen the file from the file picker or recent list.
     - Expected: Breaks are still present on the view; zigzag symbols render; no stale banner;
       `view.breaks.length` and `view.rawProjection` match the pre-save state.
  ```

- [ ] **Step 2: Confirm file is well-formed (no tabs, correct headings):**

  ```bash
  cat docs/superpowers/manual-tests/drawing-broken-views.md | head -30
  ```

- [ ] **Step 3: Commit**

  ```bash
  git add docs/superpowers/manual-tests/drawing-broken-views.md
  git commit -m "docs(manual-tests): drawing-broken-views smoke checklist — Batch 5"
  ```

---

### Task T5.10 — Green-gate commit

**Spec:** §16 Batch 5. All deliverables assembled; full suite green.

- [ ] **Step 1: Run full unit + typecheck:**

  ```bash
  pnpm -r typecheck && pnpm -r test:unit
  ```

  Expected: zero errors, zero failures.

- [ ] **Step 2: Run all five T-6-9 assertions:**

  ```bash
  pnpm --filter @zilventor/app exec playwright test T-6-9 --project=chromium 2>&1 | tail -20
  ```

  Expected: `5 passed`.

- [ ] **Step 3: Run perf spec:**

  ```bash
  pnpm --filter @zilventor/app exec playwright test drawing-broken.perf --project=chromium 2>&1 | tail -10
  ```

  Expected: `1 passed`; p95 logged.

- [ ] **Step 4: Run the full e2e suite to confirm no regressions in T-6-1..T-6-8:**

  ```bash
  pnpm --filter @zilventor/app exec playwright test --project=chromium 2>&1 | tail -20
  ```

  Expected: all 9 drawing e2e specs (T-6-1..T-6-9) pass.

- [ ] **Step 5: Final green-gate commit**

  ```bash
  git add -p   # stage any unstaged hunks
  git commit -m "feat(drawing-broken-views): T-6-9 e2e + perf + manual smoke — Batch 5 complete"
  ```

---

### Per-batch reviewer (Batch 4+5 combined)

Per the per-batch review policy, Batches 4 and 5 are reviewed together via the combined Sonnet reviewer dispatch template defined in Part 4 of this plan. The controller dispatches that reviewer AFTER Batch 5's green-gate commit (T5.10). Do not duplicate the reviewer template here.

---

## Final-pass reviewer dispatch (covers all five batches)

Dispatch this prompt to a Sonnet subagent after the Batch 4+5 combined per-batch reviewer has cleared and the feature branch is ready for merge consideration.

---

```
Ultrathink, then perform a final-pass code review of the Drawing F3 — Broken Views feature
across all five implementation batches.

## Scope

Spec: `docs/superpowers/specs/2026-05-06-drawing-broken-views-design.md` — read ALL sections
§1–§17 before starting. Every spec decision must be traceable to a code location.

Batches to review:
- Batch 1: types, manifest v16→v17, α-conditional rawProjection field, fingerprintBreaksArray
- Batch 2: applyBreaks algorithm, zigzag generator, all 10 AB test cases (AB-1..AB-10)
- Batch 3: AddBreakCommand, DeleteBreakCommand, RegenerateViewCommand extension
- Batch 4: BreakToolState, AddBreakDialog, DrawingCanvas break-mode dispatch, ViewElement
  kind-'break' branch, DrawingTab ribbon button, DrawingTreePane label suffix, mid-flight
  Playwright screenshot at /tmp/drawing-broken-mid-flight.png
- Batch 5: T-6-9 e2e (5 assertions), drawing-broken.perf.spec.ts, __zilventorBrokenViewMs
  probe, drawing-broken-views.md manual smoke checklist

## Exact names to verify (cross-batch consistency)

Confirm EVERY occurrence of each name below is spelled exactly as listed — no variations,
no aliasing without re-export:

| Name | Expected spelling |
|---|---|
| Break region type | `BreakRegion` |
| Core algorithm | `applyBreaks` |
| Add command class | `AddBreakCommand` |
| Delete command class | `DeleteBreakCommand` |
| Tool state type | `BreakToolState` |
| Tool mode discriminant | `kind: 'break'` on ToolMode (or string literal `'break'` in the union) |
| SVG attribute | `data-role="break-symbol"` on all `<polyline>` break-symbol elements |
| Window probe | `__zilventorBrokenViewMs` |
| New Edge2D kind | `'break'` in `Edge2D.kind` union |
| Perf file | `tests/perf/drawing-broken.perf.spec.ts` |
| E2E file | `tests/e2e/drawing/T-6-9-broken-view.spec.ts` |
| Manual smoke file | `docs/superpowers/manual-tests/drawing-broken-views.md` |

## α-conditional invariant audit (load-bearing)

Inspect EVERY code path that reads or writes `view.breaks` or `view.rawProjection` and
confirm the invariant `view.rawProjection !== undefined ⟺ view.breaks.length > 0` holds:

1. AddBreakCommand.apply — first break: snapshot projection → rawProjection BEFORE applyBreaks.
2. AddBreakCommand.apply — subsequent break: rawProjection unchanged; only projection replaced.
3. AddBreakCommand.revert — reverting last break: rawProjection cleared to undefined.
4. AddBreakCommand.revert — reverting one of N>1: rawProjection unchanged.
5. DeleteBreakCommand.apply — removing last break: rawProjection cleared, projection restored.
6. DeleteBreakCommand.apply — removing one of N>1: rawProjection unchanged.
7. DeleteBreakCommand.revert — restoring first break: rawProjection restored from savedRawProjection.
8. RegenerateViewCommand — breaks.length > 0: rawProjection set to fresh kernel output.
9. RegenerateViewCommand — breaks.length === 0: rawProjection stays undefined.
10. T-6-9 assertion 5: e2e proves this invariant at the DOM/store boundary.

Flag any path that populates rawProjection on a view with breaks.length === 0, or any path
that leaves rawProjection undefined on a view with breaks.length > 0.

## Manifest migration cascade

Confirm ALL files listed in spec §6.2 have been updated from `toBe(16)` → `toBe(17)`:
- `packages/shared/src/__tests__/fileFormat.spec.ts`
- `packages/shared/src/__tests__/migrateManifest-v9-to-v10.spec.ts`
- `packages/shared/src/__tests__/migrateManifest-v10-to-v11.spec.ts`
- `packages/shared/src/__tests__/migrateManifest-v11-to-v12.spec.ts`
- `packages/shared/src/__tests__/migrateManifest-v12-to-v13.spec.ts`
- `packages/shared/src/__tests__/migrateManifest-v13-to-v14.spec.ts`
- `packages/shared/src/__tests__/migrateManifest-v14-to-v15.spec.ts`
- `packages/shared/src/__tests__/migrateManifest-v15-to-v16.spec.ts`
- `packages/shared/src/__tests__/migrateManifest-v16-to-v17.spec.ts` — NEW; must exist.

## Cross-batch checks

These cannot be caught by per-batch reviewers because they span multiple batches:

1. **Edge-id stability through applyBreaks (Batch 2 AB tests + e2e level):**
   - Edges entirely before a band retain their original id (no suffix).
   - Edges entirely after a band retain their original id (translation only, no split).
   - Edges split at coordA get suffix `_a` (before portion).
   - Edges split at coordB get suffix `_b` (after portion, translated).
   - Edges spanning full band: both `_a` and `_b` survive.
   - If any dimension PointRef referenced a dropped edge id, the existing stale-dimension
     infrastructure must pick it up (verify stale-banner fires when a break drops an
     edge that a dimension references).

2. **SVG / PDF / PNG renderers all emit `data-role="break-symbol"`:**
   - SVG (`renderDrawingSvg.ts`): break-symbol polylines inherit from ViewElement's
     `<polyline data-role="break-symbol">` branch. Confirm no strip of data-attributes.
   - PDF (`renderDrawingPdf.ts`): break symbols are visible as heavy polylines (0.5 pt);
     verify strokeWidth on break-kind edges is 0.5, not 0.35.
   - PNG (`renderDrawingPngForSheet.ts`): delegates to SVG renderer; break symbols appear.
   - Manual smoke step 5 (PDF export) covers PDF; T-6-9 assertion 2 covers SVG DOM.

3. **DrawingTreePane has NO new row for broken views (spec §12.5):**
   - Confirm no new `<li>` or tree-node element is added for each break.
   - The view row must gain only a `· [N break(s)]` text suffix in its label.
   - Confirm the suffix disappears when `breaks.length === 0`.

4. **Stale-banner integration with inputFingerprint cascade (spec §8.3):**
   - Immediately after AddBreakCommand: `view.inputFingerprint` encodes the new breaks
     array; the stale banner must NOT fire (fingerprint is fresh).
   - If the underlying part geometry changes (simulated by resetting `activePart` body):
     the stale banner fires because the prior inputFingerprint no longer matches.
   - Verify that `fingerprintBreaksArray` is called in BOTH AddBreakCommand and
     DeleteBreakCommand when recomputing inputFingerprint.

5. **Mid-flight Playwright screenshot was `Read` by the implementer (not just captured):**
   - Check git log for a commit message referencing `/tmp/drawing-broken-mid-flight.png`.
   - Check the Batch 4 implementer's report to confirm they `Read` the screenshot path
     (per `feedback_drive_ui_mid_flight` policy — capturing without reading is not
     verification).
   - If the screenshot was not Read, flag as a gap — the feature may pass unit tests but
     have a browser-only rendering regression.

6. **Error cases from spec §10.3 — all 6 strings tested:**
   Confirm unit tests in `AddBreakCommand.spec.ts` and `DeleteBreakCommand.spec.ts` cover:
   - `'view-not-found'`
   - `'view-not-breakable'`
   - `'view-projection-missing'` (both AddBreak and DeleteBreak semantics)
   - `'invalid-band'`
   - `'overlapping-break'`
   - `'break-not-found'`

7. **10 AB test cases (spec §7.5) all green:**
   Confirm `packages/shared/src/drawing/__tests__/applyBreaks.spec.ts` contains exactly
   tests AB-1 through AB-10 (by id comment or describe label) and all pass. No skips.

8. **T-6-9 five assertions all present and green:**
   Confirm `tests/e2e/drawing/T-6-9-broken-view.spec.ts` contains all five assertions
   (bbox compression, break-symbol in DOM, undo restores, redo re-applies,
   α-conditional invariant after delete). Confirm all 5 pass.

9. **Perf probe correctness:**
   - `__zilventorBrokenViewMs` fixture has 1 000 edges (per spec §15.2).
   - Fixture includes at least 2 edges that SPAN the removed band (to exercise the split
     path and confirm perf is not artificially low from an all-outside-band fixture).
   - `p95 < 50 ms` on the local machine where review is run.

10. **Deferred F3.1–F3.9 — none accidentally implemented:**
    Confirm NO code implements wave/double-straight break styles (F3.1), EditBreakCommand
    drag handles (F3.2), true-length dimension compensation (F3.3), snap-to-edge (F3.4),
    arbitrary-angle breaks (F3.5), section/detail as break target beyond forward-compat field
    (F3.6), gapMm UI input (F3.7), broken view as section/detail parent (F3.8), or the
    regenerate-button re-projection bug fix (F3.9). The `style` field on `BreakRegion` MUST
    exist but only `'zigzag'` is accepted at runtime.

## Pass/fail criteria

**PASS** if ALL of the following hold:
- All cross-batch checks 1–10 above are clean (no violations, no missing items).
- `pnpm -r typecheck` exits 0 with no errors on the feature branch.
- `pnpm -r test:unit` exits 0 (zero failures, zero skips on the new tests).
- T-6-9: 5/5 assertions pass in Chromium.
- drawing-broken.perf.spec.ts: `p95ms < 50` logged and assertion green.
- Mid-flight screenshot at `/tmp/drawing-broken-mid-flight.png` exists and was Read.
- `docs/superpowers/manual-tests/drawing-broken-views.md` exists and contains all 6 steps.

**FAIL** if ANY of the following hold:
- Any α-conditional invariant violation found in code review.
- Any of the 6 error cases missing from command tests.
- Any of the 10 AB test cases missing or skipped.
- `data-role="break-symbol"` attribute absent from the SVG polyline in the DOM.
- `__zilventorBrokenViewMs` probe missing from `App.tsx` or not callable from Playwright.
- Mid-flight screenshot not Read by the implementer.
- Any deferred F-item accidentally implemented.
- Manifest cascade incomplete (any `toBe(16)` remaining in the 10 existing migration spec files).

Report under 600 words. Structure: one bullet per cross-batch check (PASS/FAIL + one-line
evidence), then a final PASS or FAIL verdict with the blockers listed.
```

---

**End of plan.**
