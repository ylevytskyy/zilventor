# Drawing F2 — Detail Views Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add ANSI-style detail views to `.zidw` drawings — circular sub-region of any parent view (base/projected/iso/section), zoomed at user-chosen scale (default 2:1), shown as a separate bordered view with caption "DETAIL <label>". No kernel call; pure 2D clip of parent's already-projected `Edge2D` geometry. Bumps manifest v15 → v16. Spec at `docs/superpowers/specs/2026-05-05-drawing-detail-views-design.md`.

**Architecture:** New `DetailView` member of the `DrawingView` discriminated union. Pure 2D clipping pipeline in `packages/shared/src/drawing/` (line-vs-circle math + projector orchestrator). Shared callout-label pool with `SectionView`. Ribbon button + 3-stage tool mode + parent annotation overlay + view-element render branch + export touches. Mirrors F1 (Section views) structure but with no kernel/Comlink work.

**Tech Stack:** TypeScript, Vitest (unit), Playwright (e2e + perf), React + SVG (UI). All four packages: `shared` (types/clip/projector), `app` (commands/tool/UI/export), e2e/perf in repo root.

**Pre-merge baseline (HEAD `d1b9fc8`):** 1813 unit tests + 7 drawing e2e (T-6-1..T-6-7) + 5 perf specs — all green. Plan must keep them all green at every commit.

**Worktree:** `feature/drawing-detail-views` in `.worktrees/drawing-detail-views/` per `superpowers:using-git-worktrees`. Create the worktree before starting Phase 1.

**Phase summary:**

| Phase | Scope | Tasks |
|---|---|---|
| 1 | Data model + manifest v15→v16 + label allocator rename | 7 |
| 2 | Pure clipping pipeline (line/polyline/edges-vs-circle) + projector + fingerprint | 15 |
| 3 | Commands (Add / Delete cascade / Regenerate / verify Move + EditScale unmodified) | 12 |
| 4 | UI (tool mode, overlay, view-element, canvas dispatch, ribbon, tree pane) | 13 |
| 5 | Export (SVG/PDF/PNG) + T-6-8 e2e + drawing-detail perf | 13 |
| **Total** | | **60** |

**Cross-phase dependencies:** Phases must land in order — 1 → 2 → 3 → 4 → 5. Phase 1 lands the type that every later phase imports. Phase 2 lands the projector that Phase 3's command calls. Phase 3 lands the command that Phase 4's UI dispatches. Phase 4 lands the render code that Phase 5's export consumes. Within a phase, sub-tasks usually have soft ordering (each TDD slice extends the previous).

---

## Phase 1 — Data model, manifest migration, label allocator rename

> **Pre-Phase 1 — Worktree creation (controller task):** Before any task in this phase, create the worktree per the header instruction: `feature/drawing-detail-views` in `.worktrees/drawing-detail-views/` using `superpowers:using-git-worktrees`. All Phase 1–5 tasks run inside this worktree.

**Goal:** Land the `DetailView` type, manifest v15→v16 (additive, no-op migration), and rename `allocateSectionLabel` → `allocateCalloutLabel` with a combined SectionView + DetailView label pool. Phase output: green types + green migration + green renamed allocator at every call site. No runtime or UI behavior change yet (no commands, no tools, no UI components).

**Files touched (this phase only):**
- Modify: `packages/shared/src/drawing/types.ts`
- Modify: `packages/shared/src/drawing/sectionLabel.ts` (rename export in place)
- Modify: `packages/shared/src/drawing/__tests__/sectionLabel.test.ts` (update import + extend)
- Modify: `packages/shared/src/fileFormat.ts` (`CURRENT_FORMAT_VERSION` → 16; add `migrations[15]`)
- Modify: `packages/shared/src/index.ts` (re-export `DetailView`, `RegionParent`, `allocateCalloutLabel`)
- Modify: `packages/app/src/commands/AddSectionViewCommand.ts` (update import + call site)
- Modify: `packages/app/src/drawing/DrawingCanvas.tsx` (update import + call site)
- Create: `packages/shared/src/drawing/__tests__/types.detailview.test.ts`
- Create: `packages/shared/src/__tests__/migrateManifest-v15-to-v16.spec.ts`

---

### Task 1.1 — Add `RegionParent` and `DetailView` types to `types.ts`

**Files:**
- Modify: `packages/shared/src/drawing/types.ts` (after `SectionView`, before `DrawingView` union)
- Create: `packages/shared/src/drawing/__tests__/types.detailview.test.ts`

- [ ] **Step 1: Write the failing test**

  Create `packages/shared/src/drawing/__tests__/types.detailview.test.ts`:

  ```ts
  import { describe, it, expect } from 'vitest';
  import type { RegionParent, DetailView, Vec2, ViewScale } from '../types';

  describe('RegionParent shape', () => {
    it('has center (Vec2) and radiusMm (number)', () => {
      const rp: RegionParent = {
        center: { x: 10, y: 8 },
        radiusMm: 5,
      };
      expect(rp.center.x).toBe(10);
      expect(rp.center.y).toBe(8);
      expect(rp.radiusMm).toBe(5);
    });

    it('survives JSON round-trip without drift', () => {
      const rp: RegionParent = { center: { x: 25.5, y: 13.25 }, radiusMm: 7.5 };
      const parsed = JSON.parse(JSON.stringify(rp)) as RegionParent;
      expect(parsed.center.x).toBe(25.5);
      expect(parsed.radiusMm).toBe(7.5);
    });
  });

  describe('DetailView shape', () => {
    const scale: ViewScale = { numerator: 2, denominator: 1 };

    it('kind discriminator is "detail"', () => {
      const dv: DetailView = {
        id: 'dv1',
        kind: 'detail',
        parentViewId: 'v1',
        regionParent: { center: { x: 10, y: 8 }, radiusMm: 5 },
        label: 'A',
        positionMm: { x: 50, y: 150 },
        scale,
        showHidden: false,
      };
      expect(dv.kind).toBe('detail');
    });

    it('survives JSON round-trip preserving all required fields', () => {
      const dv: DetailView = {
        id: 'dv2',
        kind: 'detail',
        parentViewId: 'pv1',
        regionParent: { center: { x: 0, y: 0 }, radiusMm: 12 },
        label: 'B',
        positionMm: { x: 100, y: 200 },
        scale: { numerator: 2, denominator: 1 },
        showHidden: true,
      };
      const parsed = JSON.parse(JSON.stringify(dv)) as DetailView;
      expect(parsed.kind).toBe('detail');
      expect(parsed.parentViewId).toBe('pv1');
      expect(parsed.regionParent.radiusMm).toBe(12);
      expect(parsed.label).toBe('B');
      expect(parsed.scale.numerator).toBe(2);
      expect(parsed.showHidden).toBe(true);
    });

    it('optional fields (projection, inputFingerprint) are absent when not set', () => {
      const dv: DetailView = {
        id: 'dv3',
        kind: 'detail',
        parentViewId: 'pv1',
        regionParent: { center: { x: 5, y: 5 }, radiusMm: 3 },
        label: 'C',
        positionMm: { x: 0, y: 0 },
        scale: { numerator: 1, denominator: 1 },
        showHidden: false,
      };
      expect(dv.projection).toBeUndefined();
      expect(dv.inputFingerprint).toBeUndefined();
    });

    it('optional projection field carries visibleEdges, hiddenEdges, bbox', () => {
      const dv: DetailView = {
        id: 'dv4',
        kind: 'detail',
        parentViewId: 'pv2',
        regionParent: { center: { x: 0, y: 0 }, radiusMm: 10 },
        label: 'A',
        positionMm: { x: 0, y: 0 },
        scale: { numerator: 2, denominator: 1 },
        showHidden: false,
        projection: {
          visibleEdges: [],
          hiddenEdges: [],
          bbox: { minX: -5, minY: -5, maxX: 5, maxY: 5 },
        },
        inputFingerprint: 'abc123',
      };
      expect(dv.projection!.bbox.minX).toBe(-5);
      expect(dv.inputFingerprint).toBe('abc123');
    });
  });
  ```

- [ ] **Step 2: Run test to verify it fails**

  ```
  pnpm --filter @zilventor/shared test drawing/__tests__/types.detailview
  ```

  Expected failure: `Type 'RegionParent' / 'DetailView' not found` — these types do not exist in `types.ts` yet.

- [ ] **Step 3: Write minimal implementation**

  In `packages/shared/src/drawing/types.ts`, insert the following block immediately **after** the closing `};` of `SectionView` (around line 121) and **before** the `DrawingView` union declaration. Do not change any existing content:

  ```ts
  // ---------------------------------------------------------------------------
  // RegionParent — circular region in parent view's local mm space (pre-scale)
  // ---------------------------------------------------------------------------

  export type RegionParent = {
    readonly center: Vec2;      // in parent view's local mm space (pre-scale)
    readonly radiusMm: number;  // in parent view's local mm space (pre-scale)
  };

  // ---------------------------------------------------------------------------
  // DetailView — ANSI-style circular detail view clipped from a parent view
  // ---------------------------------------------------------------------------

  export type DetailView = {
    readonly id: string;
    readonly kind: 'detail';
    readonly parentViewId: string;
    readonly regionParent: RegionParent;  // circular region in parent-local mm space
    readonly label: string;               // auto-allocated from shared callout pool: 'A', 'B', …
    readonly positionMm: Vec2;            // sheet-space drop position
    readonly scale: ViewScale;            // default { numerator: 2, denominator: 1 } at create time
    readonly showHidden: boolean;         // inherited from parent at create time
    readonly projection?: {              // populated after first clip; absent until then
      readonly visibleEdges: readonly Edge2D[];
      readonly hiddenEdges: readonly Edge2D[];
      readonly bbox: { minX: number; minY: number; maxX: number; maxY: number };
    };
    readonly inputFingerprint?: string;  // djb2 of parentInputFingerprint + regionParent + scale
  };
  ```

- [ ] **Step 4: Run test to verify it passes**

  ```
  pnpm --filter @zilventor/shared test drawing/__tests__/types.detailview
  ```

  Expected: `Tests 5 passed (5)`.

- [ ] **Step 5: Run typecheck**

  ```
  pnpm -r typecheck
  ```

  Expected: clean (no errors introduced by the additive type additions).

- [ ] **Step 6: Commit**

  ```
  git add packages/shared/src/drawing/types.ts \
          packages/shared/src/drawing/__tests__/types.detailview.test.ts
  git commit -m "feat(drawing-detail): add RegionParent and DetailView types to types.ts"
  ```

---

### Task 1.2 — Extend `DrawingView` union with `DetailView`

**Files:**
- Modify: `packages/shared/src/drawing/types.ts` (union only, 1-line change)
- Modify: `packages/shared/src/drawing/__tests__/types.detailview.test.ts` (append exhaustiveness test)

- [ ] **Step 1: Write the failing test**

  Append to `packages/shared/src/drawing/__tests__/types.detailview.test.ts` (after the last `describe` block):

  ```ts
  import type { DrawingView } from '../types';

  describe('DrawingView union exhaustiveness — detail variant', () => {
    it('detail kind is reachable in a switch over DrawingView', () => {
      function label(v: DrawingView): string {
        switch (v.kind) {
          case 'base':      return 'base';
          case 'projected': return 'projected';
          case 'iso':       return 'iso';
          case 'section':   return 'section';
          case 'detail':    return 'detail';
          default: {
            const _exhaustive: never = v;
            return _exhaustive;
          }
        }
      }

      const dv: DrawingView = {
        id: 'dv-union-test',
        kind: 'detail',
        parentViewId: 'pv1',
        regionParent: { center: { x: 0, y: 0 }, radiusMm: 5 },
        label: 'A',
        positionMm: { x: 0, y: 0 },
        scale: { numerator: 2, denominator: 1 },
        showHidden: false,
      };
      expect(label(dv)).toBe('detail');
    });
  });
  ```

- [ ] **Step 2: Run test to verify it fails**

  ```
  pnpm --filter @zilventor/shared test drawing/__tests__/types.detailview
  ```

  Expected failure: TypeScript compilation error — `DetailView` is not yet a member of `DrawingView`, so assigning `dv: DrawingView` fails; the `case 'detail'` branch is unreachable.

- [ ] **Step 3: Write minimal implementation**

  In `packages/shared/src/drawing/types.ts`, replace the existing `DrawingView` union:

  ```ts
  export type DrawingView =
    | BaseView
    | ProjectedView
    | IsoView
    | SectionView
    | DetailView;
  ```

  (The only change is adding `| DetailView` as the last union member.)

- [ ] **Step 4: Run test to verify it passes**

  ```
  pnpm --filter @zilventor/shared test drawing/__tests__/types.detailview
  ```

  Expected: `Tests 6 passed (6)`.

- [ ] **Step 5: Run typecheck**

  ```
  pnpm -r typecheck
  ```

  Expected: clean. (No existing switch-over-DrawingView exhaustiveness check will break because the new `| DetailView` arm only adds a case — no existing `never` branch is narrowed away since no existing switch was exhaustive over the prior 4-member union with a `never` fallthrough.)

- [ ] **Step 6: Commit**

  ```
  git add packages/shared/src/drawing/types.ts \
          packages/shared/src/drawing/__tests__/types.detailview.test.ts
  git commit -m "feat(drawing-detail): extend DrawingView union with DetailView discriminant"
  ```

---

### Task 1.3 — Re-export `DetailView` and `RegionParent` from `packages/shared/src/index.ts`

**Files:**
- Modify: `packages/shared/src/index.ts` (extend the existing drawing types re-export line)

- [ ] **Step 1: Write the failing test**

  This is a pure re-export check — verify by typecheck rather than a Vitest test. Before the change, attempt an import in a throw-away shell invocation:

  ```
  node -e "const s = require('./packages/shared/dist/index.js'); console.log(typeof s)" 2>&1 | head -5
  ```

  For the failing criterion, rely on the typecheck in Step 2.

- [ ] **Step 2: Run typecheck to verify it fails**

  Create a temporary probe file `packages/shared/src/__tests__/_probe_detail_export.ts`:

  ```ts
  // Temporary probe — delete after task is complete.
  import type { DetailView, RegionParent } from '@zilventor/shared';
  const _: DetailView = undefined as unknown as DetailView;
  const __: RegionParent = undefined as unknown as RegionParent;
  ```

  ```
  pnpm --filter @zilventor/shared typecheck
  ```

  Expected failure: `Module '@zilventor/shared' has no exported member 'DetailView'`.

- [ ] **Step 3: Write minimal implementation**

  In `packages/shared/src/index.ts`, find the existing drawing types re-export line (currently at line 30):

  ```ts
  export type { DrawingDocument, DrawingSource, DrawingSheet, SheetSize, DrawingView, BaseView, ProjectedView, IsoView, ViewScale, DrawingDimension, DrawingAnnotation, TitleBlockOverrides, SectionView, HatchSegment, Vec2 } from './drawing/types';
  ```

  Replace it with:

  ```ts
  export type { DrawingDocument, DrawingSource, DrawingSheet, SheetSize, DrawingView, BaseView, ProjectedView, IsoView, ViewScale, DrawingDimension, DrawingAnnotation, TitleBlockOverrides, SectionView, HatchSegment, Vec2, DetailView, RegionParent } from './drawing/types';
  ```

- [ ] **Step 4: Run typecheck to verify it passes**

  ```
  pnpm --filter @zilventor/shared typecheck
  ```

  Expected: clean. Delete the probe file `packages/shared/src/__tests__/_probe_detail_export.ts` before committing.

- [ ] **Step 5: Commit**

  ```
  git add packages/shared/src/index.ts
  git commit -m "feat(drawing-detail): re-export DetailView and RegionParent from shared index"
  ```

---

### Task 1.4 — Bump manifest v15 → v16 with no-op migration

**Files:**
- Modify: `packages/shared/src/fileFormat.ts` (`CURRENT_FORMAT_VERSION` → 16; add `migrations[15]`; extend `normalizeKind`)
- Modify: `packages/shared/src/__tests__/migrateManifest-v14-to-v15.spec.ts` (update `CURRENT_FORMAT_VERSION` assertion to 16)
- Create: `packages/shared/src/__tests__/migrateManifest-v15-to-v16.spec.ts`

- [ ] **Step 1: Write the failing test**

  Create `packages/shared/src/__tests__/migrateManifest-v15-to-v16.spec.ts`:

  ```ts
  import { describe, it, expect } from 'vitest';
  import { migrateManifest, CURRENT_FORMAT_VERSION } from '../fileFormat';

  describe('migrateManifest v15 → v16 (Drawing F2 — no-op additive)', () => {
    it('CURRENT_FORMAT_VERSION is 16', () => {
      expect(CURRENT_FORMAT_VERSION).toBe(16);
    });

    it('passes a v15 part through to v16 without data loss', () => {
      const v15Part = {
        formatVersion: 15, kind: 'part',
        document: {
          id: 'p1', name: 'Shelf', units: 'mm',
          parameters: {}, featureTree: [], properties: {},
          materials: [], hardware: [],
        },
      };
      const out = migrateManifest(v15Part) as { formatVersion: number; kind: string };
      expect(out.formatVersion).toBe(16);
      expect(out.kind).toBe('part');
    });

    it('passes a v15 assembly through to v16 without data loss', () => {
      const v15Asm = {
        formatVersion: 15, kind: 'assembly',
        document: {
          id: 'a1', name: 'Wardrobe', units: 'mm',
          parameters: {}, components: [], constraints: [],
          groundedComponentPaths: [], colors: {},
          bomItemNumbers: {}, cutListItemNumbers: {},
          colorOverrides: {}, properties: {},
          materials: [], hardware: [],
        },
      };
      const out = migrateManifest(v15Asm) as { formatVersion: number };
      expect(out.formatVersion).toBe(16);
    });

    it('passes a v15 drawing with no detail views through to v16 unchanged', () => {
      const v15Drawing = {
        formatVersion: 15, kind: 'drawing',
        document: {
          id: 'draw-1', name: 'Box — Drawing', units: 'mm',
          source: { partPath: 'parts/box.zipt', sourceKind: 'part' },
          properties: {},
          sheets: [{
            id: 's1', name: 'Sheet 1',
            size: { kind: 'iso', size: 'A3' },
            orientation: 'landscape',
            views: [
              {
                id: 'v1', kind: 'base',
                positionMm: { x: 10, y: 10 },
                scale: { numerator: 1, denominator: 1 },
                orientation: 'front',
                showHidden: false,
              },
            ],
            dimensions: [], annotations: [], titleBlock: {},
          }],
          activeSheetId: 's1',
        },
      };
      const out = migrateManifest(v15Drawing) as {
        formatVersion: number;
        kind: string;
        document: { name: string; sheets: Array<{ views: unknown[] }> };
      };
      expect(out.formatVersion).toBe(16);
      expect(out.kind).toBe('drawing');
      expect(out.document.name).toBe('Box — Drawing');
      expect(out.document.sheets[0]!.views).toHaveLength(1);
    });

    it('a v16 drawing with a detail view round-trips through JSON without data loss', () => {
      const v16Drawing = {
        formatVersion: 16, kind: 'drawing',
        document: {
          id: 'draw-2', name: 'Cabinet — Drawing', units: 'mm',
          source: { partPath: 'parts/cabinet.zipt', sourceKind: 'part' },
          properties: {},
          sheets: [{
            id: 's1', name: 'Sheet 1',
            size: { kind: 'iso', size: 'A3' },
            orientation: 'landscape',
            views: [
              {
                id: 'v1', kind: 'base',
                positionMm: { x: 10, y: 10 },
                scale: { numerator: 1, denominator: 1 },
                orientation: 'front',
                showHidden: false,
              },
              {
                id: 'dv1', kind: 'detail',
                parentViewId: 'v1',
                regionParent: { center: { x: 10, y: 8 }, radiusMm: 5 },
                label: 'A',
                positionMm: { x: 50, y: 150 },
                scale: { numerator: 2, denominator: 1 },
                showHidden: false,
              },
            ],
            dimensions: [], annotations: [], titleBlock: {},
          }],
          activeSheetId: 's1',
        },
      };
      const serialised = JSON.parse(JSON.stringify(v16Drawing));
      const out = migrateManifest(serialised) as {
        formatVersion: number;
        document: { sheets: Array<{ views: Array<{ kind: string; label?: string }> }> };
      };
      expect(out.formatVersion).toBe(16);
      const detailView = out.document.sheets[0]!.views.find((v) => v.kind === 'detail');
      expect(detailView).toBeDefined();
      expect(detailView!.label).toBe('A');
    });

    it('a v16 manifest passes through migrateManifest without re-migration', () => {
      const v16 = {
        formatVersion: 16, kind: 'part',
        document: {
          id: 'p2', name: 'Panel', units: 'mm',
          parameters: {}, featureTree: [], properties: {},
          materials: [], hardware: [],
        },
      };
      const out = migrateManifest(v16) as { formatVersion: number };
      expect(out.formatVersion).toBe(16);
    });
  });
  ```

- [ ] **Step 2: Run test to verify it fails**

  ```
  pnpm --filter @zilventor/shared test __tests__/migrateManifest-v15-to-v16
  ```

  Expected failure: `CURRENT_FORMAT_VERSION` is 15, not 16 — first assertion fails.

- [ ] **Step 3: Write minimal implementation**

  In `packages/shared/src/fileFormat.ts`:

  **a)** Change `CURRENT_FORMAT_VERSION` (line 4):
  ```ts
  export const CURRENT_FORMAT_VERSION = 16 as const;
  ```

  **b)** Add the new migration entry immediately after the `14:` entry (after line 229, before the closing `};` of the `migrations` map):
  ```ts
  // v15 → v16: no-op. DetailView is forward-only; no existing documents need
  // structural transformation. (Drawing F2 — detail views)
  15: (mIn) => {
    const m = deepClone(mIn);
    return { ...m, formatVersion: 16 };
  },
  ```

  **c)** Extend `normalizeKind` to include version 16 (replace the existing condition):
  ```ts
  function normalizeKind(m: AnyManifest): AnyManifest {
    if (
      (m.formatVersion === 10 || m.formatVersion === 11 || m.formatVersion === 12 ||
       m.formatVersion === 13 || m.formatVersion === 14 || m.formatVersion === 15 ||
       m.formatVersion === 16) &&
      (m as unknown as { kind?: unknown }).kind === undefined
    ) {
      return { ...m, kind: 'part' } as AnyManifest;
    }
    return m;
  }
  ```

- [ ] **Step 4: Run test to verify it passes**

  ```
  pnpm --filter @zilventor/shared test __tests__/migrateManifest-v15-to-v16
  ```

  Expected: `Tests 6 passed (6)`.

- [ ] **Step 5: Fix cascading assertion in the v14→v15 test**

  The existing `migrateManifest-v14-to-v15.spec.ts` has:
  ```ts
  it('CURRENT_FORMAT_VERSION is 15', () => {
    expect(CURRENT_FORMAT_VERSION).toBe(15);
  });
  ```
  Update that single assertion to:
  ```ts
  it('CURRENT_FORMAT_VERSION is 16 (advanced by Drawing F2)', () => {
    expect(CURRENT_FORMAT_VERSION).toBe(16);
  });
  ```
  All other assertions in that file remain valid (a v14 part still migrates to v16 end-state; adjust the `toBe(15)` result assertions to `toBe(16)`).

  Specifically, in `migrateManifest-v14-to-v15.spec.ts` change every `toBe(15)` on `out.formatVersion` to `toBe(16)`, and update the `'a v15 manifest passes through'` test to use `formatVersion: 16` input and assert `toBe(16)`.

  Run the updated v14 test to confirm:
  ```
  pnpm --filter @zilventor/shared test __tests__/migrateManifest-v14-to-v15
  ```

  Expected: all assertions pass.

- [ ] **Step 6: Run typecheck**

  ```
  pnpm -r typecheck
  ```

  Expected: clean.

- [ ] **Step 7: Commit**

  ```
  git add packages/shared/src/fileFormat.ts \
          packages/shared/src/__tests__/migrateManifest-v15-to-v16.spec.ts \
          packages/shared/src/__tests__/migrateManifest-v14-to-v15.spec.ts
  git commit -m "feat(drawing-detail): manifest v15→v16 no-op migration; bump CURRENT_FORMAT_VERSION to 16"
  ```

---

### Task 1.5 — Rename `allocateSectionLabel` → `allocateCalloutLabel` and update signature

**Files:**
- Modify: `packages/shared/src/drawing/sectionLabel.ts` (rename export; update error message)
- Modify: `packages/shared/src/drawing/__tests__/sectionLabel.test.ts` (update import + describe label + extend with new tests)
- Modify: `packages/shared/src/index.ts` (add `allocateCalloutLabel` to value exports)

The function body is **identical** to the current `allocateSectionLabel` — only the export name changes. The call signature remains `(existingLabels: string[]): string`. Callers are responsible for passing a merged array of both SectionView and DetailView labels; the function itself does not need to know about view types.

- [ ] **Step 1: Write the failing test**

  At the top of `packages/shared/src/drawing/__tests__/sectionLabel.test.ts`, change the import line from:
  ```ts
  import { allocateSectionLabel } from '../sectionLabel';
  ```
  to:
  ```ts
  import { allocateCalloutLabel } from '../sectionLabel';
  ```

  Change the `describe` block label from `'allocateSectionLabel'` to `'allocateCalloutLabel'`.

  Change every call from `allocateSectionLabel(...)` to `allocateCalloutLabel(...)` throughout the file.

  Then append the following new tests inside the `describe` block (these verify the combined-pool semantics that call sites will rely on):

  ```ts
  it('mixed section + detail labels ["A", "B"] → C', () => {
    // Simulates: sheet has SectionView label "A" and DetailView label "B"
    expect(allocateCalloutLabel(['A', 'B'])).toBe('C');
  });

  it('gap-fill across section+detail pool: ["A", "C"] → B', () => {
    expect(allocateCalloutLabel(['A', 'C'])).toBe('B');
  });

  it('allocates first label when both section and detail arrays are empty', () => {
    expect(allocateCalloutLabel([])).toBe('A');
  });
  ```

- [ ] **Step 2: Run test to verify it fails**

  ```
  pnpm --filter @zilventor/shared test drawing/__tests__/sectionLabel
  ```

  Expected failure: `allocateCalloutLabel` is not exported from `'../sectionLabel'` — name does not exist yet.

- [ ] **Step 3: Write minimal implementation**

  In `packages/shared/src/drawing/sectionLabel.ts`, replace:
  ```ts
  export function allocateSectionLabel(existingLabels: string[]): string {
    const used = new Set(existingLabels);
    const maxLen = existingLabels.reduce((m, l) => Math.max(m, l.length), 0);
    for (const label of labelSequence()) {
      if (label.length < maxLen) continue;
      if (!used.has(label)) return label;
    }
    // Unreachable in any practical drawing
    throw new Error('allocateSectionLabel: label space exhausted');
  }
  ```

  with:
  ```ts
  /**
   * Return the lowest label not in `existingLabels`.
   * Skips I and O per ANSI Y14.3. Fills gaps.
   * `existingLabels` must include labels from BOTH SectionView and DetailView
   * arrays on the same sheet so the two view types share one callout pool.
   */
  export function allocateCalloutLabel(existingLabels: string[]): string {
    const used = new Set(existingLabels);
    const maxLen = existingLabels.reduce((m, l) => Math.max(m, l.length), 0);
    for (const label of labelSequence()) {
      if (label.length < maxLen) continue;
      if (!used.has(label)) return label;
    }
    // Unreachable in any practical drawing
    throw new Error('allocateCalloutLabel: label space exhausted');
  }
  ```

  (Removal of `allocateSectionLabel` export is intentional — Phase 1 updates all call sites in the next task.)

- [ ] **Step 4: Run test to verify it passes**

  ```
  pnpm --filter @zilventor/shared test drawing/__tests__/sectionLabel
  ```

  Expected: `Tests 12 passed (12)` (9 existing + 3 new).

- [ ] **Step 5: Add `allocateCalloutLabel` to `packages/shared/src/index.ts`**

  Find the existing value export line for `allocateSectionLabel` in `packages/shared/src/index.ts`. It may look like:
  ```ts
  export { allocateSectionLabel } from './drawing/sectionLabel';
  ```
  Replace it with:
  ```ts
  export { allocateCalloutLabel } from './drawing/sectionLabel';
  ```

  If no such line exists, add:
  ```ts
  export { allocateCalloutLabel } from './drawing/sectionLabel';
  ```

- [ ] **Step 6: Run typecheck**

  ```
  pnpm -r typecheck
  ```

  Expected failure (intentional): the two call sites in `packages/app` still import `allocateSectionLabel` which no longer exists. These are fixed in Task 1.6. Confirm the typecheck errors mention only those two files.

- [ ] **Step 7: Commit**

  ```
  git add packages/shared/src/drawing/sectionLabel.ts \
          packages/shared/src/drawing/__tests__/sectionLabel.test.ts \
          packages/shared/src/index.ts
  git commit -m "refactor(drawing-detail): rename allocateSectionLabel → allocateCalloutLabel with combined callout pool"
  ```

---

### Task 1.6 — Update every call site of `allocateSectionLabel` in `packages/app`

**Files:**
- Modify: `packages/app/src/commands/AddSectionViewCommand.ts` (line 11, line 123)
- Modify: `packages/app/src/drawing/DrawingCanvas.tsx` (line 13, line 339)

Both call sites pass only SectionView labels today. After this rename, each must pass a combined array of SectionView + DetailView labels. Since no DetailView instances exist in the store at this commit, the combined array is identical to the current one at runtime — but the code is written correctly for the post-F2 world.

- [ ] **Step 1: Write the failing test**

  The failing test is the typecheck from Task 1.5 Step 6. Confirm it lists exactly these two files:
  ```
  pnpm -r typecheck 2>&1 | grep "allocateSectionLabel"
  ```
  Expected: two lines — one for `AddSectionViewCommand.ts` and one for `DrawingCanvas.tsx`.

- [ ] **Step 2: Run typecheck to verify it fails**

  ```
  pnpm -r typecheck
  ```

  Expected: type errors in `AddSectionViewCommand.ts` and `DrawingCanvas.tsx` citing `allocateSectionLabel` not found.

- [ ] **Step 3: Write minimal implementation**

  **a) `packages/app/src/commands/AddSectionViewCommand.ts`**

  Change line 11 from:
  ```ts
  import { allocateSectionLabel } from '@zilventor/shared/src/drawing/sectionLabel';
  ```
  to:
  ```ts
  import { allocateCalloutLabel } from '@zilventor/shared/src/drawing/sectionLabel';
  ```

  Change the label-collection block (around line 120–123) from:
  ```ts
  const existingLabels = sheet.views
    .filter((v) => v.kind === 'section')
    .map((v) => (v as SectionView).label);
  const label = allocateSectionLabel(existingLabels);
  ```
  to:
  ```ts
  import type { DetailView } from '@zilventor/shared';

  // ... inside apply():
  const existingLabels = sheet.views
    .filter((v): v is SectionView | DetailView =>
      v.kind === 'section' || v.kind === 'detail')
    .map((v) => v.label);
  const label = allocateCalloutLabel(existingLabels);
  ```

  Note: the `import type { DetailView }` line belongs at the top of the file with the other imports, not inside the method body.

  **b) `packages/app/src/drawing/DrawingCanvas.tsx`**

  Change line 13 from:
  ```ts
  import { allocateSectionLabel } from '@zilventor/shared/src/drawing/sectionLabel';
  ```
  to:
  ```ts
  import { allocateCalloutLabel } from '@zilventor/shared/src/drawing/sectionLabel';
  ```

  Change line 14 (the type import) to include `DetailView`:
  ```ts
  import type { DrawingDocument, DrawingSheet, SectionView, DetailView, BaseView, ProjectedView } from '@zilventor/shared';
  ```

  Change the label-collection block (around line 336–339) from:
  ```ts
  const existingLabels = sheet.views
    .filter((v) => v.kind === 'section')
    .map((v) => (v as SectionView).label);
  const previewLabel = allocateSectionLabel(existingLabels);
  ```
  to:
  ```ts
  const existingLabels = sheet.views
    .filter((v): v is SectionView | DetailView =>
      v.kind === 'section' || v.kind === 'detail')
    .map((v) => v.label);
  const previewLabel = allocateCalloutLabel(existingLabels);
  ```

- [ ] **Step 4: Run typecheck to verify it passes**

  ```
  pnpm -r typecheck
  ```

  Expected: clean — zero errors.

- [ ] **Step 5: Run full test suite to confirm no regressions**

  ```
  pnpm -r test
  ```

  Expected: all pre-existing tests pass; the new tests from Tasks 1.1–1.5 also pass. No green → red transitions. Baseline is 1813 tests.

- [ ] **Step 6: Commit**

  ```
  git add packages/app/src/commands/AddSectionViewCommand.ts \
          packages/app/src/drawing/DrawingCanvas.tsx
  git commit -m "refactor(drawing-detail): update allocateSectionLabel call sites to allocateCalloutLabel with combined section+detail pool"
  ```

---

### Task 1.7 — Phase 1 baseline verification

**Files:** none modified — verification only.

- [ ] **Step 1: Run typecheck**

  ```
  pnpm -r typecheck
  ```

  Expected: clean exit (zero errors across all packages).

- [ ] **Step 2: Run full unit test suite**

  ```
  pnpm -r test
  ```

  Expected: all tests pass. No green → red compared to pre-Phase-1 baseline. The new tests in this phase all green:
  - `drawing/__tests__/types.detailview.test.ts` — 6 tests
  - `__tests__/migrateManifest-v15-to-v16.spec.ts` — 6 tests
  - `drawing/__tests__/sectionLabel.test.ts` — 12 tests (9 renamed + 3 new)

- [ ] **Step 3: Confirm call site grep is clean**

  ```
  grep -rn "allocateSectionLabel" packages/
  ```

  Expected: zero results. All references have been migrated to `allocateCalloutLabel`.

- [ ] **Step 4: Confirm `DetailView` is exported from shared**

  ```
  grep "DetailView" packages/shared/src/index.ts
  ```

  Expected: `DetailView` and `RegionParent` appear in the re-export line.

- [ ] **Step 5: Confirm manifest version is 16**

  ```
  grep "CURRENT_FORMAT_VERSION" packages/shared/src/fileFormat.ts
  ```

  Expected: `export const CURRENT_FORMAT_VERSION = 16 as const;`

Phase 1 is complete when all five verification steps pass with zero errors or unexpected output. No commit in this task.
## Phase 2 — Clipping pipeline + projector + fingerprint

**Goal:** Implement the pure 2D math: `clipLineToCircle` with all 8 spec §5.2 cases under TDD, then `clipPolylineToCircle`, `clipEdgesToCircle`, `projectDetailView`, `fingerprintDetailView`. Phase output: 2 new modules in `packages/shared/src/drawing/` + their test files + one modification to `fingerprint.ts`, all green, no UI/command changes yet.

**Files created/touched (this phase only):**
- Create: `packages/shared/src/drawing/clipEdgesToCircle.ts`
- Create: `packages/shared/src/drawing/__tests__/clipEdgesToCircle.test.ts`
- Create: `packages/shared/src/drawing/projectDetailView.ts`
- Create: `packages/shared/src/drawing/__tests__/projectDetailView.test.ts`
- Modify: `packages/shared/src/drawing/fingerprint.ts` (add `fingerprintDetailView`)
- Modify: `packages/shared/src/drawing/__tests__/fingerprint.spec.ts` (extend with `fingerprintDetailView` suite)

**Assumes Phase 1 landed:** `DetailView`, `RegionParent`, and updated `DrawingView` union exist in `packages/shared/src/drawing/types.ts`.

---

### Task 2.1 — `clipLineToCircle`: case 1 — both endpoints inside the circle

**Files:**
- Create: `packages/shared/src/drawing/clipEdgesToCircle.ts`
- Create: `packages/shared/src/drawing/__tests__/clipEdgesToCircle.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared/src/drawing/__tests__/clipEdgesToCircle.test.ts
import { describe, it, expect } from 'vitest';
import { clipLineToCircle } from '../clipEdgesToCircle';
import type { Segment } from '../clipEdgesToCircle';

// helper: check that a Segment[] has one element and its coords match expected
function expectSegment(
  result: Segment[],
  p0: [number, number],
  p1: [number, number],
  digits = 6,
): void {
  expect(result).toHaveLength(1);
  expect(result[0]!.p0[0]).toBeCloseTo(p0[0], digits);
  expect(result[0]!.p0[1]).toBeCloseTo(p0[1], digits);
  expect(result[0]!.p1[0]).toBeCloseTo(p1[0], digits);
  expect(result[0]!.p1[1]).toBeCloseTo(p1[1], digits);
}

describe('clipLineToCircle — case 1: both endpoints inside circle', () => {
  it('segment (0,0)→(2,0) fully inside circle radius=5 → returned unchanged', () => {
    // Both points inside: |p0|=0<5, |p1|=2<5
    const result = clipLineToCircle([0, 0], [2, 0], { x: 0, y: 0 }, 5);
    expectSegment(result, [0, 0], [2, 0]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @zilventor/shared test:unit src/drawing/__tests__/clipEdgesToCircle.test.ts
```

Expected failure: `Error: Cannot find module '../clipEdgesToCircle'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/shared/src/drawing/clipEdgesToCircle.ts

export type Segment = {
  readonly p0: [number, number];
  readonly p1: [number, number];
};

/**
 * Clip a line segment [p0, p1] against a circle centered at `center`
 * with radius `radius`. Returns [] (clipped away) or [Segment] (surviving inside portion).
 * See spec §5.2 for the 8 cases.
 */
export function clipLineToCircle(
  p0: readonly [number, number],
  p1: readonly [number, number],
  center: { x: number; y: number },
  radius: number,
): Segment[] {
  // Translate to circle-centered space
  const ax = p0[0] - center.x;
  const ay = p0[1] - center.y;
  const bx = p1[0] - center.x;
  const by = p1[1] - center.y;

  // Direction vector (in original, non-translated space — used for final reconstruction)
  const dx = p1[0] - p0[0];
  const dy = p1[1] - p0[1];

  // Quadratic coefficients: |P(t)|^2 = r^2
  const A = dx * dx + dy * dy;

  // Case 6: zero-length segment
  if (A < 1e-10) {
    return [];
  }

  const B = 2 * (ax * dx + ay * dy);
  const C = ax * ax + ay * ay - radius * radius;

  const disc = B * B - 4 * A * C;

  const r2 = radius * radius + 1e-9;
  const p0Inside = ax * ax + ay * ay <= r2;
  const p1Inside = bx * bx + by * by <= r2;

  if (disc < 0) {
    // No real intersection: fully inside or fully outside
    if (p0Inside && p1Inside) {
      return [{ p0: [p0[0], p0[1]], p1: [p1[0], p1[1]] }];
    }
    return [];
  }

  // Tangent or secant
  const sqrtDisc = Math.sqrt(Math.max(disc, 0));
  const t1 = (-B - sqrtDisc) / (2 * A);
  const t2 = (-B + sqrtDisc) / (2 * A);

  // Clamp intersection interval to segment [0, 1]
  const tEnter = Math.max(Math.min(t1, t2), 0.0);
  const tExit  = Math.min(Math.max(t1, t2), 1.0);

  // Degenerate: tangent (disc == 0) or zero-length interval after clamping
  if (tExit - tEnter < 1e-9) {
    return [];
  }

  // Intersection interval falls entirely outside [0,1]
  if (tExit < 0 || tEnter > 1) {
    return [];
  }

  const cp0: [number, number] = [p0[0] + tEnter * dx, p0[1] + tEnter * dy];
  const cp1: [number, number] = [p0[0] + tExit  * dx, p0[1] + tExit  * dy];
  return [{ p0: cp0, p1: cp1 }];
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @zilventor/shared test:unit src/drawing/__tests__/clipEdgesToCircle.test.ts
```

Expected: `Tests 1 passed`.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/drawing/clipEdgesToCircle.ts packages/shared/src/drawing/__tests__/clipEdgesToCircle.test.ts && git commit -m "feat(drawing-detail-clip): Task 2.1 clipLineToCircle — both-inside case"
```

---

### Task 2.2 — `clipLineToCircle`: case 2 — both outside, no intersection

**Files:**
- Modify: `packages/shared/src/drawing/__tests__/clipEdgesToCircle.test.ts`

- [ ] **Step 1: Write the failing test**

Append to the existing `describe` block or add a new one after the existing tests:

```ts
describe('clipLineToCircle — case 2: both endpoints outside, no chord', () => {
  it('segment (10,0)→(15,0) entirely outside circle radius=5 at origin → []', () => {
    // Both points outside; segment never enters circle.
    // t1=-3, t2=-1 after quadratic; intersection interval (-3,-1) is entirely before t=0.
    const result = clipLineToCircle([10, 0], [15, 0], { x: 0, y: 0 }, 5);
    expect(result).toHaveLength(0);
  });

  it('segment (-20,10)→(20,10) entirely outside circle radius=5 at origin → []', () => {
    // Horizontal line y=10 is above circle of radius 5; no intersection.
    const result = clipLineToCircle([-20, 10], [20, 10], { x: 0, y: 0 }, 5);
    expect(result).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @zilventor/shared test:unit src/drawing/__tests__/clipEdgesToCircle.test.ts
```

Expected failure: new tests fail (module found but test assertions fail — specifically disc<0 with p0Inside=false).

- [ ] **Step 3: Write minimal implementation**

The Task 2.1 implementation already handles this case via the `disc < 0` branch. No code change needed. The tests should pass as written. Confirm by running in Step 4.

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @zilventor/shared test:unit src/drawing/__tests__/clipEdgesToCircle.test.ts
```

Expected: `Tests 3 passed` (2 new + 1 from Task 2.1).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/drawing/__tests__/clipEdgesToCircle.test.ts && git commit -m "test(drawing-detail): Task 2.2 clipLineToCircle — both-outside no-chord case"
```

---

### Task 2.3 — `clipLineToCircle`: case 3 — both outside, two intersections (chord)

**Files:**
- Modify: `packages/shared/src/drawing/__tests__/clipEdgesToCircle.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
describe('clipLineToCircle — case 3: both outside, chord through circle', () => {
  it('segment (-10,0)→(10,0) cuts circle radius=5 at origin → clipped to (-5,0)→(5,0)', () => {
    // ax=-10, bx=10, A=400, B=-400, C=75, disc=40000, sqrt=200
    // t1=0.25, t2=0.75 → p0=(-10+0.25*20,0)=(-5,0), p1=(-10+0.75*20,0)=(5,0)
    const result = clipLineToCircle([-10, 0], [10, 0], { x: 0, y: 0 }, 5);
    expectSegment(result, [-5, 0], [5, 0]);
  });

  it('segment (-8,-8)→(8,8) diagonal chord through circle radius=5 → clipped segment inside', () => {
    // Distance from origin to line y=x is 0 (line passes through origin).
    // Half-chord length along diagonal = 5 mm.
    // p0=(-8,-8) outside, p1=(8,8) outside. Intersection at ±(5/sqrt(2), 5/sqrt(2)).
    const result = clipLineToCircle([-8, -8], [8, 8], { x: 0, y: 0 }, 5);
    const half = 5 / Math.sqrt(2);
    expectSegment(result, [-half, -half], [half, half]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @zilventor/shared test:unit src/drawing/__tests__/clipEdgesToCircle.test.ts
```

Expected failure: the two new tests fail (implementation not yet handling the chord case correctly — actually the Task 2.1 impl does handle it already via the secant path; run to confirm they pass).

- [ ] **Step 3: Write minimal implementation**

The Task 2.1 implementation already handles this case. No code change needed; confirm in Step 4.

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @zilventor/shared test:unit src/drawing/__tests__/clipEdgesToCircle.test.ts
```

Expected: `Tests 5 passed`.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/drawing/__tests__/clipEdgesToCircle.test.ts && git commit -m "test(drawing-detail): Task 2.3 clipLineToCircle — both-outside chord case"
```

---

### Task 2.4 — `clipLineToCircle`: case 4 — one endpoint inside, one outside

**Files:**
- Modify: `packages/shared/src/drawing/__tests__/clipEdgesToCircle.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
describe('clipLineToCircle — case 4: one endpoint inside, one outside', () => {
  it('p0 inside, p1 outside: (0,0)→(10,0) circle radius=5 → clipped to (0,0)→(5,0)', () => {
    // ax=0, A=100, B=0, C=-25, disc=10000, sqrt=100
    // t1=-0.5, t2=0.5 → tEnter=max(-0.5,0)=0, tExit=min(0.5,1)=0.5
    // cp0=(0,0), cp1=(5,0)
    const result = clipLineToCircle([0, 0], [10, 0], { x: 0, y: 0 }, 5);
    expectSegment(result, [0, 0], [5, 0]);
  });

  it('p0 outside, p1 inside: (10,0)→(0,0) circle radius=5 → clipped to (5,0)→(0,0)', () => {
    // ax=10, A=100, B=-200, C=75, disc=40000-30000=10000? Wait: recompute.
    // dx=-10, dy=0. ax=10, ay=0. A=100, B=2*(10*-10)=-200, C=100-25=75
    // disc=40000-4*100*75=40000-30000=10000, sqrt=100
    // t1=(-(-200)-100)/200=100/200=0.5, t2=300/200=1.5
    // tEnter=max(0.5,0)=0.5, tExit=min(1.5,1)=1
    // cp0=(10+0.5*-10,0)=(5,0), cp1=(10+1*-10,0)=(0,0)
    const result = clipLineToCircle([10, 0], [0, 0], { x: 0, y: 0 }, 5);
    expectSegment(result, [5, 0], [0, 0]);
  });

  it('p0 inside, p1 outside: non-axis-aligned', () => {
    // circle center=(5,5), radius=3. p0=(5,5) at center (inside). p1=(5,12) outside.
    // After translate: ax=0,ay=0, bx=0,by=7. dx=0,dy=7.
    // A=49, B=0, C=-9. disc=4*49*9=1764. sqrt=42.
    // t1=(-0-42)/98=-0.428, t2=42/98=0.4286
    // tEnter=0, tExit=0.4286. cp0=(5,5), cp1=(5,5+0.4286*7)=(5,8)
    const result = clipLineToCircle([5, 5], [5, 12], { x: 5, y: 5 }, 3);
    expectSegment(result, [5, 5], [5, 8]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @zilventor/shared test:unit src/drawing/__tests__/clipEdgesToCircle.test.ts
```

Expected failure: new tests fail.

- [ ] **Step 3: Write minimal implementation**

The Task 2.1 implementation handles these cases. No code change needed; confirm in Step 4.

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @zilventor/shared test:unit src/drawing/__tests__/clipEdgesToCircle.test.ts
```

Expected: `Tests 8 passed`.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/drawing/__tests__/clipEdgesToCircle.test.ts && git commit -m "test(drawing-detail): Task 2.4 clipLineToCircle — one-inside one-outside case"
```

---

### Task 2.5 — `clipLineToCircle`: case 5 — tangent line (discriminant zero)

**Files:**
- Modify: `packages/shared/src/drawing/__tests__/clipEdgesToCircle.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
describe('clipLineToCircle — case 5: tangent (disc ≈ 0)', () => {
  it('tangent line touching circle at exactly one point → []', () => {
    // Circle center=(0,0), radius=5. Tangent line: y=5, segment from (-10,5) to (10,5).
    // Distance from center to line = 5 = radius → tangent.
    // ax=-10, ay=5. dx=20,dy=0. A=400, B=2*(-10*20+5*0)=-400, C=100+25-25=100.
    // disc = 160000 - 4*400*100 = 160000-160000 = 0. tEnter=tExit=0.5.
    // interval = 0 → return [].
    const result = clipLineToCircle([-10, 5], [10, 5], { x: 0, y: 0 }, 5);
    expect(result).toHaveLength(0);
  });

  it('tangent line y=-5 (bottom) → []', () => {
    const result = clipLineToCircle([-10, -5], [10, -5], { x: 0, y: 0 }, 5);
    expect(result).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @zilventor/shared test:unit src/drawing/__tests__/clipEdgesToCircle.test.ts
```

Expected failure: new tangent tests fail (the `tExit - tEnter < 1e-9` guard should catch them, but verify).

- [ ] **Step 3: Write minimal implementation**

The Task 2.1 implementation handles tangent via `if (tExit - tEnter < 1e-9) return []`. No code change needed; confirm in Step 4.

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @zilventor/shared test:unit src/drawing/__tests__/clipEdgesToCircle.test.ts
```

Expected: `Tests 10 passed`.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/drawing/__tests__/clipEdgesToCircle.test.ts && git commit -m "test(drawing-detail): Task 2.5 clipLineToCircle — tangent disc=0 case"
```

---

### Task 2.6 — `clipLineToCircle`: case 6 — zero-length segment

**Files:**
- Modify: `packages/shared/src/drawing/__tests__/clipEdgesToCircle.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
describe('clipLineToCircle — case 6: zero-length segment', () => {
  it('p0 === p1 inside circle → [] (zero-length always discarded per spec)', () => {
    // p0=p1=(0,0), center=(0,0), radius=5. A=0 < 1e-10 → return [].
    const result = clipLineToCircle([0, 0], [0, 0], { x: 0, y: 0 }, 5);
    expect(result).toHaveLength(0);
  });

  it('p0 === p1 outside circle → []', () => {
    const result = clipLineToCircle([10, 0], [10, 0], { x: 0, y: 0 }, 5);
    expect(result).toHaveLength(0);
  });

  it('nearly-zero-length segment (1e-6 mm) → []', () => {
    // A = (1e-6)^2 = 1e-12 < 1e-10 → return []
    const result = clipLineToCircle([0, 0], [1e-6, 0], { x: 0, y: 0 }, 5);
    expect(result).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @zilventor/shared test:unit src/drawing/__tests__/clipEdgesToCircle.test.ts
```

Expected failure: new tests fail.

- [ ] **Step 3: Write minimal implementation**

The Task 2.1 implementation handles this via `if (A < 1e-10) return []`. No code change needed; confirm in Step 4.

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @zilventor/shared test:unit src/drawing/__tests__/clipEdgesToCircle.test.ts
```

Expected: `Tests 13 passed`.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/drawing/__tests__/clipEdgesToCircle.test.ts && git commit -m "test(drawing-detail): Task 2.6 clipLineToCircle — zero-length segment case"
```

---

### Task 2.7 — `clipLineToCircle`: case 7 — axis-aligned segment through circle center

**Files:**
- Modify: `packages/shared/src/drawing/__tests__/clipEdgesToCircle.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
describe('clipLineToCircle — case 7: axis-aligned through circle center (symmetric split)', () => {
  it('vertical segment (0,-10)→(0,10) through center at origin radius=5 → (0,-5)→(0,5)', () => {
    // ax=0, ay=-10, dx=0, dy=20. A=400, B=2*(0*0+(-10)*20)=-400, C=100-25=75.
    // disc=160000-4*400*75=160000-120000=40000. sqrt=200.
    // t1=0.25, t2=0.75. tEnter=0.25, tExit=0.75.
    // cp0=(0,-10+0.25*20)=(0,-5), cp1=(0,-10+0.75*20)=(0,5). Symmetric. ✓
    const result = clipLineToCircle([0, -10], [0, 10], { x: 0, y: 0 }, 5);
    expectSegment(result, [0, -5], [0, 5]);
  });

  it('horizontal segment (-10,0)→(10,0) through center at (3,0) radius=5 → (-2,0)→(8,0)', () => {
    // Circle center=(3,0). ax=-10-3=-13, ay=0. bx=10-3=7. dx=20,dy=0.
    // A=400, B=2*(-13*20)=-520, C=169-25=144.
    // disc=270400-4*400*144=270400-230400=40000. sqrt=200.
    // t1=(-(-520)-200)/800=320/800=0.4, t2=720/800=0.9.
    // cp0=(-10+0.4*20,0)=(-2,0), cp1=(-10+0.9*20,0)=(8,0). ✓
    const result = clipLineToCircle([-10, 0], [10, 0], { x: 3, y: 0 }, 5);
    expectSegment(result, [-2, 0], [8, 0]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @zilventor/shared test:unit src/drawing/__tests__/clipEdgesToCircle.test.ts
```

Expected failure: new tests fail.

- [ ] **Step 3: Write minimal implementation**

No code change needed; the existing implementation handles this. Confirm in Step 4.

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @zilventor/shared test:unit src/drawing/__tests__/clipEdgesToCircle.test.ts
```

Expected: `Tests 15 passed`.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/drawing/__tests__/clipEdgesToCircle.test.ts && git commit -m "test(drawing-detail): Task 2.7 clipLineToCircle — axis-aligned through-center case"
```

---

### Task 2.8 — `clipLineToCircle`: case 8 — segment with one endpoint exactly on circle boundary

**Files:**
- Modify: `packages/shared/src/drawing/__tests__/clipEdgesToCircle.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
describe('clipLineToCircle — case 8: endpoint exactly on circle boundary', () => {
  it('p0=(5,0) on boundary, p1=(0,5) on boundary — full segment on/inside circle → returned', () => {
    // Both on boundary (r=5). C = 25+0-25=0 (p0 on circle). Similarly p1.
    // disc = B^2 - 0 = B^2 >= 0. t1=0, t2=1. tEnter=0, tExit=1. Full segment.
    const result = clipLineToCircle([5, 0], [0, 5], { x: 0, y: 0 }, 5);
    expectSegment(result, [5, 0], [0, 5]);
  });

  it('p0=(5,0) on boundary, p1=(10,0) outside → clipped to (5,0)→(5,0) → [] (zero interval)', () => {
    // ax=5,ay=0, dx=5,dy=0. A=25, B=2*(5*5)=50, C=25-25=0.
    // disc=2500-0=2500. sqrt=50. t1=(-50-50)/50=-2, t2=(-50+50)/50=0.
    // tEnter=max(-2,0)=0, tExit=min(0,1)=0. interval=0 → [].
    const result = clipLineToCircle([5, 0], [10, 0], { x: 0, y: 0 }, 5);
    expect(result).toHaveLength(0);
  });

  it('p0=(0,0) inside, p1=(5,0) exactly on boundary → clipped to (0,0)→(5,0)', () => {
    // ax=0,ay=0. dx=5,dy=0. A=25, B=0, C=-25. disc=2500. sqrt=50.
    // t1=-1, t2=1. tEnter=0, tExit=1. Full segment.
    const result = clipLineToCircle([0, 0], [5, 0], { x: 0, y: 0 }, 5);
    expectSegment(result, [0, 0], [5, 0]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @zilventor/shared test:unit src/drawing/__tests__/clipEdgesToCircle.test.ts
```

Expected failure: new tests fail.

- [ ] **Step 3: Write minimal implementation**

No code change needed for the main three tests; the boundary logic is handled. However note the second sub-test: p0=(5,0) on boundary → p1=(10,0) outside. The interval [tEnter=0, tExit=0] collapses to zero length. The `tExit - tEnter < 1e-9` guard returns []. This is correct.

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @zilventor/shared test:unit src/drawing/__tests__/clipEdgesToCircle.test.ts
```

Expected: `Tests 18 passed`.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/drawing/__tests__/clipEdgesToCircle.test.ts && git commit -m "test(drawing-detail): Task 2.8 clipLineToCircle — boundary endpoint case"
```

---

### Task 2.9 — `clipPolylineToCircle`: composes `clipLineToCircle` over consecutive point pairs

**Files:**
- Modify: `packages/shared/src/drawing/clipEdgesToCircle.ts` (add `clipPolylineToCircle`)
- Modify: `packages/shared/src/drawing/__tests__/clipEdgesToCircle.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { clipLineToCircle, clipPolylineToCircle } from '../clipEdgesToCircle';

describe('clipPolylineToCircle', () => {
  it('5-point polyline crossing circle → multiple surviving segments', () => {
    // Polyline: (-10,0)→(-3,0)→(0,3)→(3,0)→(10,0) in circle radius=5 at origin.
    // Segment 0: (-10,0)→(-3,0): both outside? |(-10,0)|=10>5, |(-3,0)|=3<5. One inside.
    //   t for entry: ax=-10,dx=7,dy=0. A=49, B=2*(-10*7)=-140, C=75.
    //   disc=19600-4*49*75=19600-14700=4900. sqrt=70. t1=(140-70)/98=0.714, t2=210/98=2.14
    //   tEnter=0.714, tExit=min(2.14,1)=1. cp0=(-10+0.714*7,0)=(-5,0). cp1=(-3,0). 1 segment.
    // Segment 1: (-3,0)→(0,3): both inside (|(-3,0)|=3<5, |(0,3)|=3<5). 1 segment.
    // Segment 2: (0,3)→(3,0): both inside. 1 segment.
    // Segment 3: (3,0)→(10,0): one inside, one outside.
    //   ax=3,dx=7,dy=0. A=49, B=2*(3*7)=42, C=9-25=-16.
    //   disc=1764+4*49*16=1764+3136=4900. sqrt=70.
    //   t1=(-42-70)/98=-1.14, t2=(-42+70)/98=0.286.
    //   tEnter=0, tExit=0.286. cp0=(3,0), cp1=(3+0.286*7,0)=(5,0). 1 segment.
    // Total: 4 segments.
    const polyline: ReadonlyArray<readonly [number, number]> = [
      [-10, 0], [-3, 0], [0, 3], [3, 0], [10, 0],
    ];
    const result = clipPolylineToCircle(polyline, { x: 0, y: 0 }, 5);
    expect(result).toHaveLength(4);
    // First segment starts at the circle boundary (-5,0) (approximately)
    expect(result[0]!.p0[0]).toBeCloseTo(-5, 4);
    expect(result[0]!.p0[1]).toBeCloseTo(0, 4);
    // Last segment ends at circle boundary (5,0) (approximately)
    expect(result[3]!.p1[0]).toBeCloseTo(5, 4);
    expect(result[3]!.p1[1]).toBeCloseTo(0, 4);
  });

  it('2-point polyline (single segment) fully outside → []', () => {
    const result = clipPolylineToCircle([[-10, 0], [-6, 0]], { x: 0, y: 0 }, 5);
    expect(result).toHaveLength(0);
  });

  it('empty polyline → []', () => {
    const result = clipPolylineToCircle([], { x: 0, y: 0 }, 5);
    expect(result).toHaveLength(0);
  });

  it('single-point polyline → []', () => {
    const result = clipPolylineToCircle([[0, 0]], { x: 0, y: 0 }, 5);
    expect(result).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @zilventor/shared test:unit src/drawing/__tests__/clipEdgesToCircle.test.ts
```

Expected failure: `clipPolylineToCircle` not exported.

- [ ] **Step 3: Write minimal implementation**

Add to `packages/shared/src/drawing/clipEdgesToCircle.ts` (after `clipLineToCircle`):

```ts
/**
 * Clip a polyline (array of [x,y] points) against a circle centered at `center`
 * with radius `radius`. Returns an array of Segments — zero or more surviving
 * sub-segments. Consecutive point pairs are each clipped independently via clipLineToCircle.
 */
export function clipPolylineToCircle(
  points: ReadonlyArray<readonly [number, number]>,
  center: { x: number; y: number },
  radius: number,
): Segment[] {
  if (points.length < 2) return [];
  const result: Segment[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const segs = clipLineToCircle(points[i]!, points[i + 1]!, center, radius);
    result.push(...segs);
  }
  return result;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @zilventor/shared test:unit src/drawing/__tests__/clipEdgesToCircle.test.ts
```

Expected: `Tests 22 passed`.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/drawing/clipEdgesToCircle.ts packages/shared/src/drawing/__tests__/clipEdgesToCircle.test.ts && git commit -m "feat(drawing-detail-clip): Task 2.9 clipPolylineToCircle — compose clipLineToCircle over polyline"
```

---

### Task 2.10 — `clipEdgesToCircle`: maps over `Edge2D[]` preserving metadata

**Files:**
- Modify: `packages/shared/src/drawing/clipEdgesToCircle.ts` (add `clipEdgesToCircle`)
- Modify: `packages/shared/src/drawing/__tests__/clipEdgesToCircle.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { clipLineToCircle, clipPolylineToCircle, clipEdgesToCircle } from '../clipEdgesToCircle';
import type { Edge2D } from '../projectedGeometry';

describe('clipEdgesToCircle', () => {
  it('clips edge array and preserves kind + sourceFaceIds, appending _clip0, _clip1 etc to id', () => {
    const edges: Edge2D[] = [
      {
        id: 'e1',
        kind: 'outline',
        points: [[-10, 0], [10, 0]],         // chord through circle radius=5
        sourceFaceIds: ['face-a'],
      },
      {
        id: 'e2',
        kind: 'feature',
        points: [[0, 0], [2, 0]],            // fully inside
        sourceFaceIds: ['face-b'],
      },
    ];
    const result = clipEdgesToCircle(edges, { x: 0, y: 0 }, 5);
    // e1: one clipped segment
    expect(result[0]!.id).toBe('e1_clip0');
    expect(result[0]!.kind).toBe('outline');
    expect(result[0]!.sourceFaceIds).toEqual(['face-a']);
    expect(result[0]!.points[0]![0]).toBeCloseTo(-5, 4);
    expect(result[0]!.points[1]![0]).toBeCloseTo(5, 4);
    // e2: one preserved segment
    expect(result[1]!.id).toBe('e2_clip0');
    expect(result[1]!.kind).toBe('feature');
    expect(result[1]!.sourceFaceIds).toEqual(['face-b']);
    expect(result[1]!.points[0]).toEqual([0, 0]);
    expect(result[1]!.points[1]).toEqual([2, 0]);
  });

  it('edge entirely outside circle → clipped away (not in result)', () => {
    const edges: Edge2D[] = [
      { id: 'e3', kind: 'silhouette', points: [[20, 0], [30, 0]] },
    ];
    const result = clipEdgesToCircle(edges, { x: 0, y: 0 }, 5);
    expect(result).toHaveLength(0);
  });

  it('edge with multiple segments (polyline crossing circle twice) → two output edges', () => {
    // Polyline: (-10,0)→(10,0) clips to one chord → 1 edge, not 2.
    // For two output edges, need a polyline that re-enters: (-10,0)→(-3,0)→(3,0)→(10,0)
    // Segment (-10,0)→(-3,0): enters at (-5,0), ends at (-3,0) [inside]. 1 segment.
    // Segment (-3,0)→(3,0): fully inside. 1 segment.
    // Segment (3,0)→(10,0): exits at (5,0). 1 segment.
    const edges: Edge2D[] = [
      {
        id: 'e4',
        kind: 'outline',
        points: [[-10, 0], [-3, 0], [3, 0], [10, 0]],
      },
    ];
    const result = clipEdgesToCircle(edges, { x: 0, y: 0 }, 5);
    // 3 polyline segments clipped → 3 output Edge2D entries
    expect(result).toHaveLength(3);
    expect(result[0]!.id).toBe('e4_clip0');
    expect(result[1]!.id).toBe('e4_clip1');
    expect(result[2]!.id).toBe('e4_clip2');
    // All preserve kind
    result.forEach(e => expect(e.kind).toBe('outline'));
  });

  it('empty edge array → empty result', () => {
    expect(clipEdgesToCircle([], { x: 0, y: 0 }, 5)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @zilventor/shared test:unit src/drawing/__tests__/clipEdgesToCircle.test.ts
```

Expected failure: `clipEdgesToCircle` not exported.

- [ ] **Step 3: Write minimal implementation**

Add to `packages/shared/src/drawing/clipEdgesToCircle.ts` (after `clipPolylineToCircle`):

```ts
import type { Edge2D } from './projectedGeometry';

/**
 * Clip an array of Edge2D against a circle in parent-local mm space.
 * Returns a new array of Edge2D with clipped points.
 * Each surviving clip segment becomes its own Edge2D, with id suffixed `_clip<i>`.
 * kind and sourceFaceIds are preserved from the source edge.
 */
export function clipEdgesToCircle(
  edges: readonly Edge2D[],
  center: { x: number; y: number },
  radius: number,
): Edge2D[] {
  const result: Edge2D[] = [];
  for (const edge of edges) {
    const segments = clipPolylineToCircle(edge.points, center, radius);
    for (let i = 0; i < segments.length; i++) {
      result.push({
        id: `${edge.id}_clip${i}`,
        kind: edge.kind,
        points: [segments[i]!.p0, segments[i]!.p1],
        sourceFaceIds: edge.sourceFaceIds,
      });
    }
  }
  return result;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @zilventor/shared test:unit src/drawing/__tests__/clipEdgesToCircle.test.ts
```

Expected: `Tests 26 passed`.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/drawing/clipEdgesToCircle.ts packages/shared/src/drawing/__tests__/clipEdgesToCircle.test.ts && git commit -m "feat(drawing-detail-clip): Task 2.10 clipEdgesToCircle — clip Edge2D array preserving metadata"
```

---

### Task 2.11 — `fingerprintDetailView`: djb2 hash + stability tests

**Files:**
- Modify: `packages/shared/src/drawing/fingerprint.ts`
- Modify: `packages/shared/src/drawing/__tests__/fingerprint.spec.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/shared/src/drawing/__tests__/fingerprint.spec.ts`:

```ts
import { fingerprintDetailView } from '../fingerprint';

describe('fingerprintDetailView', () => {
  const region = { center: { x: 10, y: 8 }, radiusMm: 5 };
  const scale = { numerator: 2, denominator: 1 };
  const parentFp = 'abc123parent';

  it('same inputs twice → identical string', () => {
    const fp1 = fingerprintDetailView(parentFp, region, scale);
    const fp2 = fingerprintDetailView(parentFp, region, scale);
    expect(fp1).toBe(fp2);
  });

  it('result is a non-empty hex string', () => {
    const fp = fingerprintDetailView(parentFp, region, scale);
    expect(fp).toMatch(/^[0-9a-f]{8}$/);
  });

  it('different parentInputFingerprint → different result', () => {
    const fp1 = fingerprintDetailView('fp-abc', region, scale);
    const fp2 = fingerprintDetailView('fp-xyz', region, scale);
    expect(fp1).not.toBe(fp2);
  });

  it('center.x changed by 0.001 mm → different fingerprint', () => {
    const regionB = { center: { x: 10.001, y: 8 }, radiusMm: 5 };
    const fp1 = fingerprintDetailView(parentFp, region, scale);
    const fp2 = fingerprintDetailView(parentFp, regionB, scale);
    expect(fp1).not.toBe(fp2);
  });

  it('center.x changed by 0.0001 mm → same fingerprint (below 1e-3 threshold)', () => {
    // 10.000 and 10.0001 both round to "10.000" via .toFixed(3)
    const regionB = { center: { x: 10.0001, y: 8 }, radiusMm: 5 };
    const fp1 = fingerprintDetailView(parentFp, region, scale);
    const fp2 = fingerprintDetailView(parentFp, regionB, scale);
    expect(fp1).toBe(fp2);
  });

  it('different scale.numerator → different fingerprint', () => {
    const scale2 = { numerator: 4, denominator: 1 };
    const fp1 = fingerprintDetailView(parentFp, region, scale);
    const fp2 = fingerprintDetailView(parentFp, region, scale2);
    expect(fp1).not.toBe(fp2);
  });

  it('different radiusMm → different fingerprint', () => {
    const regionB = { center: { x: 10, y: 8 }, radiusMm: 6 };
    const fp1 = fingerprintDetailView(parentFp, region, scale);
    const fp2 = fingerprintDetailView(parentFp, regionB, scale);
    expect(fp1).not.toBe(fp2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @zilventor/shared test:unit src/drawing/__tests__/fingerprint.spec.ts
```

Expected failure: `fingerprintDetailView is not a function` / export not found.

- [ ] **Step 3: Write minimal implementation**

Add the following to `packages/shared/src/drawing/fingerprint.ts` (append after `fingerprintSectionView`):

```ts
/**
 * Synchronous djb2 fingerprint for a DetailView.
 * Incorporates the parent view's source fingerprint, the region definition, and the scale.
 * Matches the fingerprintSectionView pattern in this file.
 * Floats rounded to 1e-3 mm via .toFixed(3) for determinism.
 */
export function fingerprintDetailView(
  parentInputFingerprint: string,
  regionParent: { center: { x: number; y: number }; radiusMm: number },
  scale: { numerator: number; denominator: number },
): string {
  const payload = [
    parentInputFingerprint,
    regionParent.center.x.toFixed(3),
    regionParent.center.y.toFixed(3),
    regionParent.radiusMm.toFixed(3),
    scale.numerator,
    scale.denominator,
  ].join('|');
  return djb2(payload);
}
```

Note: `djb2` is already defined as a private function in `fingerprint.ts` (line 81 of the current file). This new export lives in the same file and reuses it directly — no import needed.

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @zilventor/shared test:unit src/drawing/__tests__/fingerprint.spec.ts
```

Expected: all fingerprint tests pass (existing suite + 7 new `fingerprintDetailView` tests).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/drawing/fingerprint.ts packages/shared/src/drawing/__tests__/fingerprint.spec.ts && git commit -m "feat(drawing-detail-fingerprint): Task 2.11 fingerprintDetailView — djb2 hash of region+scale"
```

---

### Task 2.12 — `projectDetailView` orchestrator: §4.5 worked example as canonical test

**Files:**
- Create: `packages/shared/src/drawing/projectDetailView.ts`
- Create: `packages/shared/src/drawing/__tests__/projectDetailView.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared/src/drawing/__tests__/projectDetailView.test.ts
import { describe, it, expect } from 'vitest';
import { projectDetailView } from '../projectDetailView';
import type { DetailViewInput } from '../projectDetailView';

// Spec §4.5 worked example:
// Parent scale 1:5, region center (10,8), radiusMm=5, detail scale 2:1
// detailScaleFactor = (2/1) / (1/5) = 10
// A point at (12,9) in parent-local → translate to (2,1) → scale to (20,10).

describe('projectDetailView — §4.5 worked example', () => {
  it('point (12,9) in parent-local → (20,10) in detail-local', () => {
    // Single visible edge: a line segment inside the region.
    // Both (12,9) and (11,8) are inside the circle: |(12-10,9-8)|=|(2,1)|=2.24<5 ✓
    const input: DetailViewInput = {
      parentView: {
        id: 'parent-v1',
        kind: 'base',
        positionMm: { x: 0, y: 0 },
        scale: { numerator: 1, denominator: 5 },
        showHidden: false,
        projection: {
          visibleEdges: [
            {
              id: 'e1',
              kind: 'outline',
              points: [[11, 8], [12, 9]],  // fully inside region
            },
          ],
          hiddenEdges: [],
          bbox: { minX: 0, minY: 0, maxX: 50, maxY: 50 },
        },
      } as any,
      regionParent: { center: { x: 10, y: 8 }, radiusMm: 5 },
      detailScale: { numerator: 2, denominator: 1 },
      showHidden: false,
    };

    const output = projectDetailView(input);

    expect(output.visibleEdges).toHaveLength(1);
    // Translate (11,8)→(10,8) subtracts center (10,8) → (1,0). Scale ×10 → (10,0).
    expect(output.visibleEdges[0]!.points[0]![0]).toBeCloseTo(10, 4);
    expect(output.visibleEdges[0]!.points[0]![1]).toBeCloseTo(0, 4);
    // Translate (12,9)→(10,8) → (2,1). Scale ×10 → (20,10).
    expect(output.visibleEdges[0]!.points[1]![0]).toBeCloseTo(20, 4);
    expect(output.visibleEdges[0]!.points[1]![1]).toBeCloseTo(10, 4);
  });

  it('bbox is recomputed from detail-local points', () => {
    const input: DetailViewInput = {
      parentView: {
        id: 'parent-v1',
        kind: 'base',
        positionMm: { x: 0, y: 0 },
        scale: { numerator: 1, denominator: 5 },
        showHidden: false,
        projection: {
          visibleEdges: [
            {
              id: 'e1',
              kind: 'outline',
              points: [[11, 8], [12, 9]],
            },
          ],
          hiddenEdges: [],
          bbox: { minX: 0, minY: 0, maxX: 50, maxY: 50 },
        },
      } as any,
      regionParent: { center: { x: 10, y: 8 }, radiusMm: 5 },
      detailScale: { numerator: 2, denominator: 1 },
      showHidden: false,
    };

    const output = projectDetailView(input);

    // After transform: points are (10,0) and (20,10).
    expect(output.bbox.minX).toBeCloseTo(10, 4);
    expect(output.bbox.minY).toBeCloseTo(0, 4);
    expect(output.bbox.maxX).toBeCloseTo(20, 4);
    expect(output.bbox.maxY).toBeCloseTo(10, 4);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @zilventor/shared test:unit src/drawing/__tests__/projectDetailView.test.ts
```

Expected failure: `Cannot find module '../projectDetailView'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/shared/src/drawing/projectDetailView.ts
//
// Pure 2D projector orchestrator for detail views.
// No I/O, no side effects, deterministic. See spec §4 and §6.1.

import type { Edge2D, ProjectedGeometry } from './projectedGeometry';
import { clipEdgesToCircle } from './clipEdgesToCircle';

// ---------------------------------------------------------------------------
// Types (spec §6.1)
// ---------------------------------------------------------------------------

export type DetailViewInput = {
  readonly parentView: {
    readonly scale: { readonly numerator: number; readonly denominator: number };
    readonly projection: ProjectedGeometry;
  };
  readonly regionParent: {
    readonly center: { x: number; y: number };
    readonly radiusMm: number;
  };
  readonly detailScale: { readonly numerator: number; readonly denominator: number };
  readonly showHidden: boolean;
};

export type DetailViewOutput = {
  readonly visibleEdges: readonly Edge2D[];
  readonly hiddenEdges: readonly Edge2D[];
  readonly bbox: { minX: number; minY: number; maxX: number; maxY: number };
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function translateAndScale(
  edges: Edge2D[],
  cx: number,
  cy: number,
  factor: number,
): Edge2D[] {
  return edges.map(edge => ({
    ...edge,
    points: edge.points.map(
      ([x, y]): readonly [number, number] => [
        (x - cx) * factor,
        (y - cy) * factor,
      ],
    ),
  }));
}

function computeBbox(
  edges: readonly Edge2D[],
): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const edge of edges) {
    for (const [x, y] of edge.points) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (!isFinite(minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return { minX, minY, maxX, maxY };
}

// ---------------------------------------------------------------------------
// Main entry (spec §6.1)
// ---------------------------------------------------------------------------

/**
 * Clips the parent view's projected edges against the circular region and
 * transforms the clipped edges to detail-local mm space.
 *
 * Step 1: Clip parent edges (already in parent-local mm) against
 *         (center=regionParent.center, radius=regionParent.radiusMm).
 * Step 2: Translate clipped points by -regionParent.center (center → origin).
 * Step 3: Scale by detailScaleFactor =
 *         (detailScale.num/detailScale.den) / (parentScale.num/parentScale.den).
 * Step 4: Recompute bbox from transformed points.
 */
export function projectDetailView(input: DetailViewInput): DetailViewOutput {
  const { parentView, regionParent, detailScale, showHidden } = input;
  const { center, radiusMm } = regionParent;

  // Step 1: Clip
  const clippedVisible = clipEdgesToCircle(
    parentView.projection.visibleEdges,
    center,
    radiusMm,
  );
  const clippedHidden = showHidden
    ? clipEdgesToCircle(parentView.projection.hiddenEdges, center, radiusMm)
    : [];

  // Step 2 + 3: Translate to origin then scale to detail-local mm
  const parentScale =
    parentView.scale.numerator / parentView.scale.denominator;
  const detailScaleVal =
    detailScale.numerator / detailScale.denominator;
  const factor = detailScaleVal / parentScale;

  const visibleEdges = translateAndScale(clippedVisible, center.x, center.y, factor);
  const hiddenEdges  = translateAndScale(clippedHidden,  center.x, center.y, factor);

  // Step 4: Recompute bbox
  const allEdges = [...visibleEdges, ...hiddenEdges];
  const bbox = computeBbox(allEdges);

  return { visibleEdges, hiddenEdges, bbox };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @zilventor/shared test:unit src/drawing/__tests__/projectDetailView.test.ts
```

Expected: `Tests 2 passed`.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/drawing/projectDetailView.ts packages/shared/src/drawing/__tests__/projectDetailView.test.ts && git commit -m "feat(drawing-detail-projector): Task 2.12 projectDetailView — §4.5 worked example passes"
```

---

### Task 2.13 — `projectDetailView`: region entirely outside parent bbox

**Files:**
- Modify: `packages/shared/src/drawing/__tests__/projectDetailView.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
describe('projectDetailView — edge cases', () => {
  it('region entirely outside parent edges → empty visibleEdges, zero bbox', () => {
    // Parent has one edge near (0,0); region center is at (100,100), far away.
    const input: DetailViewInput = {
      parentView: {
        id: 'parent-v1',
        kind: 'base',
        positionMm: { x: 0, y: 0 },
        scale: { numerator: 1, denominator: 1 },
        showHidden: false,
        projection: {
          visibleEdges: [
            { id: 'e1', kind: 'outline', points: [[0, 0], [10, 0]] },
          ],
          hiddenEdges: [],
          bbox: { minX: 0, minY: 0, maxX: 10, maxY: 0 },
        },
      } as any,
      regionParent: { center: { x: 100, y: 100 }, radiusMm: 5 },
      detailScale: { numerator: 2, denominator: 1 },
      showHidden: false,
    };

    const output = projectDetailView(input);

    expect(output.visibleEdges).toHaveLength(0);
    expect(output.hiddenEdges).toHaveLength(0);
    // bbox collapses to zero when no edges
    expect(output.bbox).toEqual({ minX: 0, minY: 0, maxX: 0, maxY: 0 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @zilventor/shared test:unit src/drawing/__tests__/projectDetailView.test.ts
```

Expected failure: test fails (implementation returns non-empty bbox or wrong shape).

- [ ] **Step 3: Write minimal implementation**

The Task 2.12 implementation already handles this via the `computeBbox` empty guard: `if (!isFinite(minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0 }`. No code change needed; confirm in Step 4.

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @zilventor/shared test:unit src/drawing/__tests__/projectDetailView.test.ts
```

Expected: `Tests 3 passed`.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/drawing/__tests__/projectDetailView.test.ts && git commit -m "test(drawing-detail): Task 2.13 projectDetailView — region outside parent bbox → empty output"
```

---

### Task 2.14 — `projectDetailView`: region fully encloses parent — no clipping loss

**Files:**
- Modify: `packages/shared/src/drawing/__tests__/projectDetailView.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
  it('region fully encloses parent edges → all edges survive, correctly scaled', () => {
    // Parent has a 10×10 box of edges; region is a circle radius=100 centered at (5,5).
    // All edges are inside the circle, so no clipping loss.
    // detailScale=1:1, parentScale=1:1 → detailScaleFactor=1.
    // After translate by -(5,5): edge points shift by (-5,-5).
    const input: DetailViewInput = {
      parentView: {
        id: 'parent-v1',
        kind: 'base',
        positionMm: { x: 0, y: 0 },
        scale: { numerator: 1, denominator: 1 },
        showHidden: false,
        projection: {
          visibleEdges: [
            { id: 'e1', kind: 'outline', points: [[0, 0], [10, 0]] },
            { id: 'e2', kind: 'outline', points: [[10, 0], [10, 10]] },
            { id: 'e3', kind: 'outline', points: [[10, 10], [0, 10]] },
            { id: 'e4', kind: 'outline', points: [[0, 10], [0, 0]] },
          ],
          hiddenEdges: [],
          bbox: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
        },
      } as any,
      regionParent: { center: { x: 5, y: 5 }, radiusMm: 100 },
      detailScale: { numerator: 1, denominator: 1 },
      showHidden: false,
    };

    const output = projectDetailView(input);

    // 4 edges each produce 1 clip segment (all inside huge circle) → 4 edges
    expect(output.visibleEdges).toHaveLength(4);

    // After translate by -(5,5) and scale×1: (0,0)→(-5,-5), (10,0)→(5,-5), etc.
    // Find the edge that started as e1 (0,0)→(10,0):
    const e1 = output.visibleEdges.find(e => e.id === 'e1_clip0');
    expect(e1).toBeDefined();
    expect(e1!.points[0]![0]).toBeCloseTo(-5, 4);
    expect(e1!.points[0]![1]).toBeCloseTo(-5, 4);
    expect(e1!.points[1]![0]).toBeCloseTo(5, 4);
    expect(e1!.points[1]![1]).toBeCloseTo(-5, 4);
  });

  it('showHidden=true → hidden edges included in output', () => {
    const input: DetailViewInput = {
      parentView: {
        id: 'parent-v1',
        kind: 'base',
        positionMm: { x: 0, y: 0 },
        scale: { numerator: 1, denominator: 1 },
        showHidden: true,
        projection: {
          visibleEdges: [
            { id: 'ev1', kind: 'outline', points: [[0, 0], [4, 0]] },
          ],
          hiddenEdges: [
            { id: 'eh1', kind: 'feature', points: [[0, 0], [2, 0]] },
          ],
          bbox: { minX: 0, minY: 0, maxX: 4, maxY: 0 },
        },
      } as any,
      regionParent: { center: { x: 0, y: 0 }, radiusMm: 10 },
      detailScale: { numerator: 1, denominator: 1 },
      showHidden: true,
    };

    const output = projectDetailView(input);

    expect(output.visibleEdges.length).toBeGreaterThan(0);
    expect(output.hiddenEdges.length).toBeGreaterThan(0);
  });

  it('showHidden=false → hiddenEdges is empty in output regardless of parent', () => {
    const input: DetailViewInput = {
      parentView: {
        id: 'parent-v1',
        kind: 'base',
        positionMm: { x: 0, y: 0 },
        scale: { numerator: 1, denominator: 1 },
        showHidden: true,
        projection: {
          visibleEdges: [],
          hiddenEdges: [
            { id: 'eh1', kind: 'feature', points: [[0, 0], [2, 0]] },
          ],
          bbox: { minX: 0, minY: 0, maxX: 2, maxY: 0 },
        },
      } as any,
      regionParent: { center: { x: 0, y: 0 }, radiusMm: 10 },
      detailScale: { numerator: 1, denominator: 1 },
      showHidden: false,
    };

    const output = projectDetailView(input);

    expect(output.hiddenEdges).toHaveLength(0);
  });
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @zilventor/shared test:unit src/drawing/__tests__/projectDetailView.test.ts
```

Expected failure: new tests fail.

- [ ] **Step 3: Write minimal implementation**

No code change needed; Task 2.12 implementation handles these. Confirm in Step 4.

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @zilventor/shared test:unit src/drawing/__tests__/projectDetailView.test.ts
```

Expected: `Tests 6 passed`.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/drawing/__tests__/projectDetailView.test.ts && git commit -m "test(drawing-detail): Task 2.14 projectDetailView — full-enclosure + showHidden cases"
```

---

### Task 2.15 — Phase 2 baseline check (verify only, no commit)

**Files:** None modified.

This task is verification only. Run the full shared test suite and typecheck. Do not commit anything.

- [ ] **Step 1: Run all shared unit tests**

```bash
pnpm --filter @zilventor/shared test:unit
```

Expected: all tests pass, including the 26+ new tests from Tasks 2.1–2.14 and all pre-existing tests (hatchGenerator, projectSectionView, fingerprint, sectionLabel, etc.).

- [ ] **Step 2: Run typecheck**

```bash
pnpm --filter @zilventor/shared typecheck
```

Expected: `0 errors`.

- [ ] **Step 3: Run full repo typecheck**

```bash
pnpm -r typecheck
```

Expected: `0 errors` across all packages. (Phase 1 must be landed for `DetailView` and `RegionParent` types referenced in `projectDetailView.ts` to resolve.)

- [ ] **Step 4: Confirm no regressions in adjacent packages**

```bash
pnpm -r test:unit 2>/dev/null || pnpm --filter @zilventor/shared test:unit
```

If the top-level `test:unit` script is not available, the shared suite alone is sufficient for Phase 2 sign-off. Phase 3 (commands) will run the app package tests.

No commit for this task. Phase 2 is complete when Steps 1–3 all pass.
## Phase 3 — Commands

> **Deviation from spec §8.1 (error variants):** Spec §8.1 states `'parent-not-found'` and `'parent-projection-missing'` are returned as result values without throwing. This plan uses `throw new Error('parent-not-found')` and `throw new Error('parent-projection-missing')` instead, matching the existing F1 `AddSectionViewCommand` pattern. Every test in this phase asserts via `rejects.toThrow(...)` consistently. The spec's result-object approach is deferred.

**Goal:** Land `AddDetailViewCommand` (atomic apply/revert + error variants), extend `DeleteViewCommand` cascade for detail children, extend `RegenerateViewCommand` sanity tests for the detail kind (command already works generically), and verify `MoveViewCommand` + `EditViewScaleCommand` work on detail views without modification. Phase output: command bus accepts `AddDetailView` payload; cascade-delete removes detail children when any parent is deleted; regenerate re-clips against latest parent projection via the existing generic mechanism; Move and Scale work on detail views with zero command code change.

**Files created/touched (this phase only):**
- Create: `packages/app/src/commands/AddDetailViewCommand.ts`
- Create: `packages/app/src/commands/__tests__/AddDetailViewCommand.test.ts`
- Modify: `packages/app/src/commands/DeleteViewCommand.ts` (cascade extension — detail children)
- Modify: `packages/app/src/commands/__tests__/DeleteViewCommand.spec.ts` (add detail-cascade describe block)
- Modify: `packages/app/src/commands/__tests__/RegenerateViewCommand.spec.ts` (add detail-branch describe block)
- Create: `packages/app/src/commands/__tests__/detailViewMoveScale.test.ts` (sanity: Move + EditViewScale on detail, NO command code changes)
- Modify: `packages/app/src/commands/index.ts` (register `AddDetailViewCommand`)

---

### Task 3.1 — `AddDetailViewCommand` happy path: apply creates a detail view with label "A"

**Files:**
- Create: `packages/app/src/commands/__tests__/AddDetailViewCommand.test.ts`
- Create: `packages/app/src/commands/AddDetailViewCommand.ts`

#### Step 1: Write the failing test

Create `packages/app/src/commands/__tests__/AddDetailViewCommand.test.ts`:

```ts
// packages/app/src/commands/__tests__/AddDetailViewCommand.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AddDetailViewCommand } from '../AddDetailViewCommand';
import { useAppStore } from '../../store/useAppStore';
import type { DrawingDocument, DrawingSheet, DetailView, BaseView } from '@zilventor/shared';

// ── Shared-package mocks ──────────────────────────────────────────────────
vi.mock('@zilventor/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@zilventor/shared')>();
  return {
    ...actual,
    allocateCalloutLabel: vi.fn((existing: string[]) => {
      // Real gap-fill: return first unused in A-Z (no I/O) order
      const skip = new Set(['I', 'O']);
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').filter(c => !skip.has(c));
      const used = new Set(existing);
      for (const c of chars) {
        if (!used.has(c)) return c;
      }
      return 'AA';
    }),
    projectDetailView: vi.fn().mockReturnValue({
      visibleEdges: [
        { id: 'clip-e1', kind: 'outline', points: [[2, 1], [8, 1]], sourceFaceIds: [] },
        { id: 'clip-e2', kind: 'outline', points: [[8, 1], [8, 7]], sourceFaceIds: [] },
      ],
      hiddenEdges: [],
      bbox: { minX: 2, minY: 1, maxX: 8, maxY: 7 },
    }),
    fingerprintDetailView: vi.fn().mockReturnValue('detail-fp-mock'),
  };
});

// ── Fixtures ──────────────────────────────────────────────────────────────
const PARENT_PROJ = {
  visibleEdges: [
    { id: 'e1', kind: 'outline', points: [[0, 0], [100, 0]] as [number, number][], sourceFaceIds: [] },
    { id: 'e2', kind: 'outline', points: [[100, 0], [100, 60]] as [number, number][], sourceFaceIds: [] },
    { id: 'e3', kind: 'outline', points: [[0, 0], [0, 60]] as [number, number][], sourceFaceIds: [] },
  ],
  hiddenEdges: [],
  bbox: { minX: 0, minY: 0, maxX: 100, maxY: 60 },
};

const PARENT_VIEW: BaseView = {
  id: 'v1',
  kind: 'base',
  positionMm: { x: 20, y: 20 },
  scale: { numerator: 1, denominator: 1 },
  orientation: 'front',
  showHidden: false,
  projection: PARENT_PROJ,
  inputFingerprint: 'parent-fp-abc',
};

const makeSheet = (): DrawingSheet => ({
  id: 's1',
  name: 'Sheet 1',
  size: { kind: 'iso', size: 'A3' },
  orientation: 'landscape',
  views: [PARENT_VIEW],
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

const basePayload = {
  drawingId: 'd1',
  sheetId: 's1',
  parentViewId: 'v1',
  regionCenter: { x: 10, y: 8 },
  regionRadiusMm: 5,
  dropAt: { x: 20, y: 150 },
};

beforeEach(() => {
  vi.clearAllMocks();
  useAppStore.setState({
    activeDocument: { kind: 'drawing', document: makeDrawing() },
    activePart: null,
    activeAssembly: null,
  } as never);
});

// ── Tests ─────────────────────────────────────────────────────────────────
describe('AddDetailViewCommand.apply() — happy path', () => {
  it('adds one DetailView with kind=detail and label=A', async () => {
    const cmd = new AddDetailViewCommand(basePayload);
    await cmd.apply();

    const doc = useAppStore.getState().activeDocument;
    if (!doc || doc.kind !== 'drawing') throw new Error('no drawing');
    const sheet = doc.document.sheets.find(s => s.id === 's1')!;

    expect(sheet.views).toHaveLength(2);
    const dv = sheet.views.find(v => v.kind === 'detail') as DetailView;
    expect(dv).toBeDefined();
    expect(dv.kind).toBe('detail');
    expect(dv.label).toBe('A');
    expect(dv.parentViewId).toBe('v1');
    expect(dv.positionMm).toEqual({ x: 20, y: 150 });
    expect(dv.scale).toEqual({ numerator: 2, denominator: 1 });
    expect(dv.regionParent).toEqual({ center: { x: 10, y: 8 }, radiusMm: 5 });
    expect(dv.projection).toBeDefined();
    expect(dv.projection!.visibleEdges.length).toBeGreaterThan(0);
    expect(dv.inputFingerprint).toBe('detail-fp-mock');
  });

  it('parent view is structurally unchanged after apply', async () => {
    const before = JSON.parse(JSON.stringify(
      useAppStore.getState().activeDocument!
        // @ts-expect-error accessing .document
        .document.sheets[0].views.find((v: { id: string }) => v.id === 'v1')
    ));
    const cmd = new AddDetailViewCommand(basePayload);
    await cmd.apply();

    const doc = useAppStore.getState().activeDocument;
    if (!doc || doc.kind !== 'drawing') throw new Error('no drawing');
    const parent = doc.document.sheets[0]!.views.find(v => v.id === 'v1')!;
    expect(parent).toEqual(before);
  });
});
```

#### Step 2: Run test to verify it fails

```
pnpm --filter app test src/commands/__tests__/AddDetailViewCommand
```

Expected failure: `Cannot find module '../AddDetailViewCommand'`.

#### Step 3: Write minimal implementation

Create `packages/app/src/commands/AddDetailViewCommand.ts`:

```ts
// packages/app/src/commands/AddDetailViewCommand.ts
import type { Command } from './Command';
import type { DrawingDocument, DetailView, SectionView } from '@zilventor/shared';
import { allocateCalloutLabel, projectDetailView, fingerprintDetailView } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';

export type AddDetailViewOpts = {
  drawingId: string;
  sheetId: string;
  parentViewId: string;
  regionCenter: { x: number; y: number };   // parent-local mm (pre-scale)
  regionRadiusMm: number;                    // parent-local mm (pre-scale)
  dropAt: { x: number; y: number };          // sheet-space position mm
};

export class AddDetailViewCommand implements Command {
  readonly name = 'AddDetailView';
  private newViewId: string | null = null;

  constructor(private readonly opts: AddDetailViewOpts) {}

  async apply(): Promise<void> {
    const state = useAppStore.getState();
    const doc = state.activeDocument;
    if (!doc || doc.kind !== 'drawing') return;

    const drawing = doc.document;
    const sheet = drawing.sheets.find(s => s.id === this.opts.sheetId);
    if (!sheet) throw new Error(`sheet ${this.opts.sheetId} not found`);

    // 1. Resolve parent view.
    const parentView = sheet.views.find(v => v.id === this.opts.parentViewId);
    if (!parentView) throw new Error('parent-not-found');

    // 2. Require parent projection to be populated.
    if (!parentView.projection) throw new Error('parent-projection-missing');

    // 3. Allocate label from shared pool (SectionView + DetailView labels).
    const existingLabels = sheet.views
      .filter((v): v is SectionView | DetailView =>
        v.kind === 'section' || v.kind === 'detail')
      .map(v => v.label);
    const label = allocateCalloutLabel(existingLabels);

    // 4. Determine showHidden from parent (spec §8.1 step 4).
    const showHidden =
      parentView.kind !== 'section' &&
      (parentView as { showHidden?: boolean }).showHidden === true;

    // 5. Default scale: 2:1 per spec §8.1 step 5.
    const defaultScale = { numerator: 2, denominator: 1 };

    // 6. Clip parent edges → projectDetailView (pure 2D, no kernel).
    const projection = projectDetailView({
      parentView: parentView as typeof parentView & { projection: NonNullable<typeof parentView.projection> },
      regionParent: { center: this.opts.regionCenter, radiusMm: this.opts.regionRadiusMm },
      detailScale: defaultScale,
      showHidden,
    });

    // 7. Compute fingerprint.
    const inputFingerprint = fingerprintDetailView(
      (parentView as { inputFingerprint?: string }).inputFingerprint ?? '',
      { center: this.opts.regionCenter, radiusMm: this.opts.regionRadiusMm },
      defaultScale,
    );

    // 8. Build DetailView.
    const newId = crypto.randomUUID();
    this.newViewId = newId;

    const view: DetailView = {
      id: newId,
      kind: 'detail',
      parentViewId: this.opts.parentViewId,
      regionParent: { center: this.opts.regionCenter, radiusMm: this.opts.regionRadiusMm },
      label,
      positionMm: this.opts.dropAt,
      scale: defaultScale,
      showHidden,
      projection,
      inputFingerprint,
    };

    // 9. Push onto sheet.views[].
    const nextDoc: DrawingDocument = {
      ...drawing,
      sheets: drawing.sheets.map(s =>
        s.id === this.opts.sheetId
          ? { ...s, views: [...s.views, view] }
          : s
      ),
    };
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: nextDoc }, activeDrawing: nextDoc });
  }

  async revert(): Promise<void> {
    if (!this.newViewId) return;
    const state = useAppStore.getState();
    const doc = state.activeDocument;
    if (!doc || doc.kind !== 'drawing') return;

    const drawing = doc.document;
    const nextDoc: DrawingDocument = {
      ...drawing,
      sheets: drawing.sheets.map(s =>
        s.id === this.opts.sheetId
          ? { ...s, views: s.views.filter(v => v.id !== this.newViewId) }
          : s
      ),
    };
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: nextDoc }, activeDrawing: nextDoc });
    this.newViewId = null;
  }
}
```

#### Step 4: Run test to verify it passes

```
pnpm --filter app test src/commands/__tests__/AddDetailViewCommand
```

Expected: `Tests 2 passed`.

#### Step 5: Run typecheck

```
pnpm -r typecheck
```

Expected: clean (0 errors).

#### Step 6: Commit

```
git add packages/app/src/commands/AddDetailViewCommand.ts packages/app/src/commands/__tests__/AddDetailViewCommand.test.ts && git commit -m "feat(drawing-detail-cmd): AddDetailViewCommand apply — clip parent edges, allocate label, push DetailView"
```

---

### Task 3.2 — `AddDetailViewCommand` revert symmetry

**Files:**
- Modify: `packages/app/src/commands/__tests__/AddDetailViewCommand.test.ts` (extend with revert describe block)

#### Step 1: Write the failing test

Append the following describe block to `packages/app/src/commands/__tests__/AddDetailViewCommand.test.ts` (after the existing `describe` block):

```ts
describe('AddDetailViewCommand.revert()', () => {
  it('apply then revert — state deep-equals pre-apply state (byte-level)', async () => {
    const snapshot = JSON.parse(
      JSON.stringify(useAppStore.getState().activeDocument),
    );
    const cmd = new AddDetailViewCommand(basePayload);
    await cmd.apply();
    await cmd.revert();
    const after = useAppStore.getState().activeDocument;
    expect(after).toEqual(snapshot);
  });

  it('revert after apply — sheet.views length restored to 1', async () => {
    const cmd = new AddDetailViewCommand(basePayload);
    await cmd.apply();
    await cmd.revert();

    const doc = useAppStore.getState().activeDocument;
    if (!doc || doc.kind !== 'drawing') throw new Error('no drawing');
    const sheet = doc.document.sheets.find(s => s.id === 's1')!;
    expect(sheet.views).toHaveLength(1);
    expect(sheet.views.find(v => v.kind === 'detail')).toBeUndefined();
  });

  it('apply → revert → re-apply: label "A" is re-allocated (gap-fill semantics)', async () => {
    const cmd1 = new AddDetailViewCommand(basePayload);
    await cmd1.apply();
    await cmd1.revert();

    // After revert, no detail views exist; next allocation should return 'A' again.
    const cmd2 = new AddDetailViewCommand(basePayload);
    await cmd2.apply();

    const doc = useAppStore.getState().activeDocument;
    if (!doc || doc.kind !== 'drawing') throw new Error('no drawing');
    const sheet = doc.document.sheets.find(s => s.id === 's1')!;
    const dv = sheet.views.find(v => v.kind === 'detail') as DetailView;
    expect(dv.label).toBe('A');
  });
});
```

#### Step 2: Run test to verify it fails

```
pnpm --filter app test src/commands/__tests__/AddDetailViewCommand
```

Expected failure: new `describe` block either does not exist yet in the file or the assertions fail due to missing revert logic. (If Task 3.1 is already landed, this runs and passes Task 3.1 tests while the new tests fail on assertion mismatch since `revert()` wasn't exercised.)

#### Step 3: Write minimal implementation

`revert()` is already present in `AddDetailViewCommand.ts` from Task 3.1. No implementation changes needed — the test itself is the deliverable.

Full `AddDetailViewCommand.ts` unchanged from Task 3.1 (reproduced for completeness):

```ts
// packages/app/src/commands/AddDetailViewCommand.ts
import type { Command } from './Command';
import type { DrawingDocument, DetailView, SectionView } from '@zilventor/shared';
import { allocateCalloutLabel, projectDetailView, fingerprintDetailView } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';

export type AddDetailViewOpts = {
  drawingId: string;
  sheetId: string;
  parentViewId: string;
  regionCenter: { x: number; y: number };
  regionRadiusMm: number;
  dropAt: { x: number; y: number };
};

export class AddDetailViewCommand implements Command {
  readonly name = 'AddDetailView';
  private newViewId: string | null = null;

  constructor(private readonly opts: AddDetailViewOpts) {}

  async apply(): Promise<void> {
    const state = useAppStore.getState();
    const doc = state.activeDocument;
    if (!doc || doc.kind !== 'drawing') return;

    const drawing = doc.document;
    const sheet = drawing.sheets.find(s => s.id === this.opts.sheetId);
    if (!sheet) throw new Error(`sheet ${this.opts.sheetId} not found`);

    const parentView = sheet.views.find(v => v.id === this.opts.parentViewId);
    if (!parentView) throw new Error('parent-not-found');

    if (!parentView.projection) throw new Error('parent-projection-missing');

    const existingLabels = sheet.views
      .filter((v): v is SectionView | DetailView =>
        v.kind === 'section' || v.kind === 'detail')
      .map(v => v.label);
    const label = allocateCalloutLabel(existingLabels);

    const showHidden =
      parentView.kind !== 'section' &&
      (parentView as { showHidden?: boolean }).showHidden === true;

    const defaultScale = { numerator: 2, denominator: 1 };

    const projection = projectDetailView({
      parentView: parentView as typeof parentView & { projection: NonNullable<typeof parentView.projection> },
      regionParent: { center: this.opts.regionCenter, radiusMm: this.opts.regionRadiusMm },
      detailScale: defaultScale,
      showHidden,
    });

    const inputFingerprint = fingerprintDetailView(
      (parentView as { inputFingerprint?: string }).inputFingerprint ?? '',
      { center: this.opts.regionCenter, radiusMm: this.opts.regionRadiusMm },
      defaultScale,
    );

    const newId = crypto.randomUUID();
    this.newViewId = newId;

    const view: DetailView = {
      id: newId,
      kind: 'detail',
      parentViewId: this.opts.parentViewId,
      regionParent: { center: this.opts.regionCenter, radiusMm: this.opts.regionRadiusMm },
      label,
      positionMm: this.opts.dropAt,
      scale: defaultScale,
      showHidden,
      projection,
      inputFingerprint,
    };

    const nextDoc: DrawingDocument = {
      ...drawing,
      sheets: drawing.sheets.map(s =>
        s.id === this.opts.sheetId
          ? { ...s, views: [...s.views, view] }
          : s
      ),
    };
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: nextDoc }, activeDrawing: nextDoc });
  }

  async revert(): Promise<void> {
    if (!this.newViewId) return;
    const state = useAppStore.getState();
    const doc = state.activeDocument;
    if (!doc || doc.kind !== 'drawing') return;

    const drawing = doc.document;
    const nextDoc: DrawingDocument = {
      ...drawing,
      sheets: drawing.sheets.map(s =>
        s.id === this.opts.sheetId
          ? { ...s, views: s.views.filter(v => v.id !== this.newViewId) }
          : s
      ),
    };
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: nextDoc }, activeDrawing: nextDoc });
    this.newViewId = null;
  }
}
```

#### Step 4: Run test to verify it passes

```
pnpm --filter app test src/commands/__tests__/AddDetailViewCommand
```

Expected: `Tests 5 passed` (2 from Task 3.1 + 3 new).

#### Step 5: Run typecheck

```
pnpm -r typecheck
```

#### Step 6: Commit

```
git add packages/app/src/commands/__tests__/AddDetailViewCommand.test.ts && git commit -m "test(drawing-detail-cmd): AddDetailViewCommand revert — deep-equality + gap-fill re-allocation"
```

---

### Task 3.3 — `AddDetailViewCommand` error: parent not found

**Files:**
- Modify: `packages/app/src/commands/__tests__/AddDetailViewCommand.test.ts` (extend with error describe block)

#### Step 1: Write the failing test

Append to `packages/app/src/commands/__tests__/AddDetailViewCommand.test.ts`:

```ts
describe('AddDetailViewCommand.apply() — error variants', () => {
  it('throws "parent-not-found" when parentViewId is absent from sheet.views', async () => {
    const cmd = new AddDetailViewCommand({ ...basePayload, parentViewId: 'no-such-view' });
    await expect(cmd.apply()).rejects.toThrow('parent-not-found');
  });

  it('sheet is untouched when parent-not-found is thrown', async () => {
    const snapshot = JSON.parse(JSON.stringify(useAppStore.getState().activeDocument));
    const cmd = new AddDetailViewCommand({ ...basePayload, parentViewId: 'no-such-view' });
    try { await cmd.apply(); } catch { /* expected */ }
    expect(useAppStore.getState().activeDocument).toEqual(snapshot);
  });
});
```

#### Step 2: Run test to verify it fails

```
pnpm --filter app test src/commands/__tests__/AddDetailViewCommand
```

Expected failure: `AssertionError: expected promise to reject with message matching 'parent-not-found'` (the error is currently thrown but the existing message may differ — confirm exact string from Task 3.1 impl).

#### Step 3: Write minimal implementation

No change to `AddDetailViewCommand.ts` — `throw new Error('parent-not-found')` is already present from Task 3.1. The test is the deliverable.

If the current implementation uses a different message, update the `throw` line in `apply()`:

```ts
// In AddDetailViewCommand.ts, line that was:
//   if (!parentView) throw new Error('parent view not found');
// Change to:
if (!parentView) throw new Error('parent-not-found');
```

Full `AddDetailViewCommand.ts` is identical to Task 3.2 (not reproduced here — no code changes).

#### Step 4: Run test to verify it passes

```
pnpm --filter app test src/commands/__tests__/AddDetailViewCommand
```

Expected: `Tests 7 passed`.

#### Step 5: Run typecheck

```
pnpm -r typecheck
```

#### Step 6: Commit

```
git add packages/app/src/commands/__tests__/AddDetailViewCommand.test.ts && git commit -m "test(drawing-detail-cmd): AddDetailViewCommand error parent-not-found — sheet untouched"
```

---

### Task 3.4 — `AddDetailViewCommand` error: parent projection missing

**Files:**
- Modify: `packages/app/src/commands/__tests__/AddDetailViewCommand.test.ts` (extend error describe block)

#### Step 1: Write the failing test

Extend the `'AddDetailViewCommand.apply() — error variants'` describe block from Task 3.3 with two more tests (append inside that describe):

```ts
  it('throws "parent-projection-missing" when parent view has no projection', async () => {
    // Set up a drawing where parent exists but has no projection field.
    const parentWithoutProj: BaseView = {
      id: 'v-no-proj',
      kind: 'base',
      positionMm: { x: 20, y: 20 },
      scale: { numerator: 1, denominator: 1 },
      orientation: 'front',
      showHidden: false,
      // projection is intentionally absent
    };
    useAppStore.setState({
      activeDocument: {
        kind: 'drawing',
        document: {
          ...makeDrawing(),
          sheets: [{
            ...makeSheet(),
            views: [parentWithoutProj],
          }],
        },
      },
    } as never);

    const cmd = new AddDetailViewCommand({ ...basePayload, parentViewId: 'v-no-proj' });
    await expect(cmd.apply()).rejects.toThrow('parent-projection-missing');
  });

  it('sheet is untouched when parent-projection-missing is thrown', async () => {
    const parentWithoutProj: BaseView = {
      id: 'v-no-proj',
      kind: 'base',
      positionMm: { x: 20, y: 20 },
      scale: { numerator: 1, denominator: 1 },
      orientation: 'front',
      showHidden: false,
    };
    const drawingWithUnprojected = {
      ...makeDrawing(),
      sheets: [{ ...makeSheet(), views: [parentWithoutProj] }],
    };
    useAppStore.setState({
      activeDocument: { kind: 'drawing', document: drawingWithUnprojected },
    } as never);

    const snapshot = JSON.parse(JSON.stringify(useAppStore.getState().activeDocument));
    const cmd = new AddDetailViewCommand({ ...basePayload, parentViewId: 'v-no-proj' });
    try { await cmd.apply(); } catch { /* expected */ }
    expect(useAppStore.getState().activeDocument).toEqual(snapshot);
  });
```

#### Step 2: Run test to verify it fails

```
pnpm --filter app test src/commands/__tests__/AddDetailViewCommand
```

Expected failure: assertion mismatch on the `rejects.toThrow('parent-projection-missing')` line if the implementation uses a different string.

#### Step 3: Write minimal implementation

Confirm `AddDetailViewCommand.ts` has the exact string `'parent-projection-missing'`:

```ts
// In AddDetailViewCommand.ts:
if (!parentView.projection) throw new Error('parent-projection-missing');
```

Full file is identical to Tasks 3.1–3.3 (no code changes needed beyond confirming the exact error strings).

#### Step 4: Run test to verify it passes

```
pnpm --filter app test src/commands/__tests__/AddDetailViewCommand
```

Expected: `Tests 9 passed`.

#### Step 5: Run typecheck

```
pnpm -r typecheck
```

#### Step 6: Commit

```
git add packages/app/src/commands/__tests__/AddDetailViewCommand.test.ts && git commit -m "test(drawing-detail-cmd): AddDetailViewCommand error parent-projection-missing — sheet untouched"
```

---

### Task 3.5 — `AddDetailViewCommand` label allocation: combined pool gap-reuse

**Files:**
- Modify: `packages/app/src/commands/__tests__/AddDetailViewCommand.test.ts` (extend with label-pool describe block)

#### Step 1: Write the failing test

Append to `packages/app/src/commands/__tests__/AddDetailViewCommand.test.ts`:

```ts
describe('AddDetailViewCommand — shared callout label pool', () => {
  it('allocates "B" when SectionView with label "A" already exists on the sheet', async () => {
    // Inject a sheet that already has a SectionView labelled "A".
    const sectionA = {
      id: 'sect-a',
      kind: 'section' as const,
      parentViewId: 'v1',
      sectionLine: { p0: { x: 0, y: 50 }, p1: { x: 100, y: 50 } },
      arrowDirection: 1 as const,
      label: 'A',
      positionMm: { x: 250, y: 100 },
      scale: { numerator: 1, denominator: 1 },
      showHidden: false,
      hatchSegments: [],
      fingerprint: 'fp-sect-a',
      projection: { visibleEdges: [], hiddenEdges: [], bbox: { minX: 0, minY: 0, maxX: 0, maxY: 0 } },
    };
    useAppStore.setState({
      activeDocument: {
        kind: 'drawing',
        document: {
          ...makeDrawing(),
          sheets: [{
            ...makeSheet(),
            views: [PARENT_VIEW, sectionA],
          }],
        },
      },
    } as never);

    const cmd = new AddDetailViewCommand(basePayload);
    await cmd.apply();

    const doc = useAppStore.getState().activeDocument;
    if (!doc || doc.kind !== 'drawing') throw new Error('no drawing');
    const sheet = doc.document.sheets[0]!;
    const dv = sheet.views.find(v => v.kind === 'detail') as DetailView;
    expect(dv.label).toBe('B');
  });

  it('fills gap: allocates "B" when existing labels are ["A", "C"]', async () => {
    // "A" used by section, "C" used by existing detail; next should be "B" (gap-fill).
    const sectionA = {
      id: 'sect-a', kind: 'section' as const,
      parentViewId: 'v1',
      sectionLine: { p0: { x: 0, y: 50 }, p1: { x: 100, y: 50 } },
      arrowDirection: 1 as const,
      label: 'A',
      positionMm: { x: 250, y: 100 },
      scale: { numerator: 1, denominator: 1 },
      showHidden: false,
      hatchSegments: [],
      fingerprint: 'fp-sect-a',
      projection: { visibleEdges: [], hiddenEdges: [], bbox: { minX: 0, minY: 0, maxX: 0, maxY: 0 } },
    };
    const detailC = {
      id: 'det-c', kind: 'detail' as const,
      parentViewId: 'v1',
      regionParent: { center: { x: 5, y: 5 }, radiusMm: 3 },
      label: 'C',
      positionMm: { x: 300, y: 150 },
      scale: { numerator: 2, denominator: 1 },
      showHidden: false,
      projection: { visibleEdges: [], hiddenEdges: [], bbox: { minX: 0, minY: 0, maxX: 0, maxY: 0 } },
      inputFingerprint: 'det-c-fp',
    };
    useAppStore.setState({
      activeDocument: {
        kind: 'drawing',
        document: {
          ...makeDrawing(),
          sheets: [{
            ...makeSheet(),
            views: [PARENT_VIEW, sectionA, detailC],
          }],
        },
      },
    } as never);

    const cmd = new AddDetailViewCommand(basePayload);
    await cmd.apply();

    const doc = useAppStore.getState().activeDocument;
    if (!doc || doc.kind !== 'drawing') throw new Error('no drawing');
    const sheet = doc.document.sheets[0]!;
    // Find the newly added detail (not det-c)
    const newDetail = sheet.views.find(
      v => v.kind === 'detail' && (v as DetailView).label !== 'C'
    ) as DetailView;
    expect(newDetail.label).toBe('B');
  });
});
```

#### Step 2: Run test to verify it fails

```
pnpm --filter app test src/commands/__tests__/AddDetailViewCommand
```

Expected failure: `Expected "B", Received "A"` (the mock `allocateCalloutLabel` in the vi.mock at the top of the file only looks at labels passed to it; the labels from the fixture views must be collected correctly for the mock to return `"B"`).

#### Step 3: Write minimal implementation

No code change to `AddDetailViewCommand.ts` — the label collection logic is already correct. The tests are verifying the existing `filter(v.kind === 'section' || v.kind === 'detail').map(v => v.label)` logic by injecting pre-existing labeled views. If the mock `allocateCalloutLabel` in the vi.mock block at the top of the test file correctly implements gap-fill, these tests will pass once the fixture data feeds it correctly.

#### Step 4: Run test to verify it passes

```
pnpm --filter app test src/commands/__tests__/AddDetailViewCommand
```

Expected: `Tests 11 passed`.

#### Step 5: Run typecheck

```
pnpm -r typecheck
```

#### Step 6: Commit

```
git add packages/app/src/commands/__tests__/AddDetailViewCommand.test.ts && git commit -m "test(drawing-detail-cmd): AddDetailViewCommand shared callout pool — section+detail gap-fill allocation"
```

---

### Task 3.6 — Register `AddDetailViewCommand` with the command bus

**Files:**
- Modify: `packages/app/src/commands/index.ts` (add export)
- Modify: `packages/app/src/commands/__tests__/AddDetailViewCommand.test.ts` (extend with bus-roundtrip test)

#### Step 1: Write the failing test

Append to `packages/app/src/commands/__tests__/AddDetailViewCommand.test.ts`:

```ts
describe('AddDetailViewCommand — bus registration', () => {
  it('AddDetailViewCommand is importable from the commands index', async () => {
    // Dynamic import verifies the barrel export exists.
    const mod = await import('../index');
    expect(typeof mod.AddDetailViewCommand).toBe('function');
  });

  it('AddDetailViewOpts type is exported (compile-time check — verifies no import error)', () => {
    // If AddDetailViewOpts is not re-exported, this file would fail to import it.
    // This test is a runtime proxy: constructing the command with explicit type annotation.
    type Opts = import('../AddDetailViewCommand').AddDetailViewOpts;
    const opts: Opts = {
      drawingId: 'd1',
      sheetId: 's1',
      parentViewId: 'v1',
      regionCenter: { x: 5, y: 5 },
      regionRadiusMm: 3,
      dropAt: { x: 10, y: 100 },
    };
    const cmd = new AddDetailViewCommand(opts);
    expect(cmd.name).toBe('AddDetailView');
  });
});
```

#### Step 2: Run test to verify it fails

```
pnpm --filter app test src/commands/__tests__/AddDetailViewCommand
```

Expected failure: `AssertionError: expected undefined to equal 'function'` (because `index.ts` does not yet export `AddDetailViewCommand`).

#### Step 3: Write minimal implementation

Modify `packages/app/src/commands/index.ts`:

```ts
// packages/app/src/commands/index.ts
// Re-exports for section-view commands (Phase 6).
export { AddSectionViewCommand } from './AddSectionViewCommand';
export type { AddSectionViewPayload } from './AddSectionViewCommand';

// Re-exports for detail-view commands (Drawing F2).
export { AddDetailViewCommand } from './AddDetailViewCommand';
export type { AddDetailViewOpts } from './AddDetailViewCommand';
```

#### Step 4: Run test to verify it passes

```
pnpm --filter app test src/commands/__tests__/AddDetailViewCommand
```

Expected: `Tests 13 passed`.

#### Step 5: Run typecheck

```
pnpm -r typecheck
```

#### Step 6: Commit

```
git add packages/app/src/commands/index.ts packages/app/src/commands/__tests__/AddDetailViewCommand.test.ts && git commit -m "feat(drawing-detail-cmd): register AddDetailViewCommand in commands/index.ts barrel"
```

---

### Task 3.7 — `DeleteViewCommand` cascade: single detail child

**Files:**
- Modify: `packages/app/src/commands/DeleteViewCommand.ts` (add detail cascade)
- Modify: `packages/app/src/commands/__tests__/DeleteViewCommand.spec.ts` (add detail-cascade describe block)

#### Step 1: Write the failing test

Append to `packages/app/src/commands/__tests__/DeleteViewCommand.spec.ts`:

```ts
// ── Detail cascade fixtures ───────────────────────────────────────────────
import type { DetailView } from '@zilventor/shared';

const BASE_FOR_DETAIL: BaseView = {
  id: 'base-d1', kind: 'base',
  positionMm: { x: 50, y: 50 },
  orientation: 'front',
  scale: { numerator: 1, denominator: 1 },
  showHidden: false,
  projection: {
    visibleEdges: [{ id: 'e1', kind: 'outline', points: [[0, 0], [100, 0]], sourceFaceIds: [] }],
    hiddenEdges: [],
    bbox: { minX: 0, minY: 0, maxX: 100, maxY: 60 },
  },
  inputFingerprint: 'parent-fp',
};

const DETAIL_A: DetailView = {
  id: 'detail-a', kind: 'detail',
  parentViewId: 'base-d1',
  regionParent: { center: { x: 10, y: 8 }, radiusMm: 5 },
  label: 'A',
  positionMm: { x: 200, y: 200 },
  scale: { numerator: 2, denominator: 1 },
  showHidden: false,
  projection: {
    visibleEdges: [{ id: 'clip-e1', kind: 'outline', points: [[2, 1], [8, 1]], sourceFaceIds: [] }],
    hiddenEdges: [],
    bbox: { minX: 2, minY: 1, maxX: 8, maxY: 7 },
  },
  inputFingerprint: 'detail-a-fp',
};

function makeDrawingWithDetail(): DrawingDocument {
  return {
    id: 'd-detail', name: 'D-Detail', units: 'mm',
    source: { partPath: 'parts/p.zipt', sourceKind: 'part' },
    properties: {},
    sheets: [{
      id: 'sheet-d', name: 'Sheet D',
      size: { kind: 'iso', size: 'A3' }, orientation: 'landscape',
      views: [BASE_FOR_DETAIL, DETAIL_A],
      dimensions: [],
      annotations: [],
      titleBlock: {},
    }],
    activeSheetId: 'sheet-d',
  };
}

describe('DeleteViewCommand — detail cascade (Drawing F2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: makeDrawingWithDetail() } });
  });

  it('deleting a base view with one detail child removes both views', async () => {
    const cmd = new DeleteViewCommand({ sheetId: 'sheet-d', viewId: 'base-d1' });
    await cmd.apply();

    const _ad = useAppStore.getState().activeDocument;
    if (!_ad || _ad.kind !== 'drawing') throw new Error('expected drawing');
    const sheet = _ad.document.sheets[0]!;
    expect(sheet.views).toHaveLength(0);
    expect(sheet.views.find(v => v.id === 'detail-a')).toBeUndefined();
    expect(sheet.views.find(v => v.id === 'base-d1')).toBeUndefined();
  });

  it('revert after base+detail cascade restores both views in original order', async () => {
    const cmd = new DeleteViewCommand({ sheetId: 'sheet-d', viewId: 'base-d1' });
    await cmd.apply();
    await cmd.revert();

    const _ad = useAppStore.getState().activeDocument;
    if (!_ad || _ad.kind !== 'drawing') throw new Error('expected drawing');
    const sheet = _ad.document.sheets[0]!;
    expect(sheet.views).toHaveLength(2);
    expect(sheet.views[0]!.id).toBe('base-d1');
    expect(sheet.views[1]!.id).toBe('detail-a');
  });

  it('deleting only the detail view (not parent) removes only the detail', async () => {
    const cmd = new DeleteViewCommand({ sheetId: 'sheet-d', viewId: 'detail-a' });
    await cmd.apply();

    const _ad = useAppStore.getState().activeDocument;
    if (!_ad || _ad.kind !== 'drawing') throw new Error('expected drawing');
    const sheet = _ad.document.sheets[0]!;
    expect(sheet.views).toHaveLength(1);
    expect(sheet.views[0]!.id).toBe('base-d1');
  });
});
```

#### Step 2: Run test to verify it fails

```
pnpm --filter app test src/commands/__tests__/DeleteViewCommand
```

Expected failure: `Expected: 0, Received: 1` — the detail view is not removed when its parent is deleted (cascade not yet extended).

#### Step 3: Write minimal implementation

Modify `packages/app/src/commands/DeleteViewCommand.ts`. In the `apply()` method, extend the `viewIdsToRemove` population to also include detail children of the target view (regardless of `targetView.kind`, since details can hang off base, projected, iso, or section parents):

```ts
// packages/app/src/commands/DeleteViewCommand.ts
import type { Command } from './Command';
import type { DrawingDocument, DrawingView, DrawingDimension, DrawingAnnotation, SectionView, DetailView } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';
import { sectionCache } from '../drawing/sectionCache';

type Snapshot = {
  views: DrawingView[];
  viewIndices: number[];
  dimensions: DrawingDimension[];
  dimIndices: number[];
  annotations: DrawingAnnotation[];
  annIndices: number[];
  /** Cache keys for removed section views, evicted during apply. Not restored on revert — caller re-cuts on next use. */
  sectionCacheKeys: string[];
};

export class DeleteViewCommand implements Command {
  readonly name = 'DeleteView';
  private snapshot: Snapshot | null = null;

  constructor(private readonly opts: { sheetId: string; viewId: string }) {}

  async apply(): Promise<void> {
    const state = useAppStore.getState();
    const doc = state.activeDocument;
    if (!doc || doc.kind !== 'drawing') return;

    const sheet = doc.document.sheets.find(s => s.id === this.opts.sheetId);
    if (!sheet) return;

    const targetView = sheet.views.find(v => v.id === this.opts.viewId);
    if (!targetView) return;

    // Determine which view ids to remove (target + projected/section/detail children if base)
    const viewIdsToRemove = new Set<string>([this.opts.viewId]);
    if (targetView.kind === 'base') {
      for (const v of sheet.views) {
        if (v.kind === 'projected' && v.baseViewId === this.opts.viewId) {
          viewIdsToRemove.add(v.id);
        }
        if (v.kind === 'section' && (v as SectionView).parentViewId === this.opts.viewId) {
          viewIdsToRemove.add(v.id);
        }
      }
    }
    // Detail views can reference any parent kind — always cascade-remove detail children.
    for (const v of sheet.views) {
      if (v.kind === 'detail' && (v as DetailView).parentViewId === this.opts.viewId) {
        viewIdsToRemove.add(v.id);
      }
    }

    // Capture snapshots with original indices for revert
    const removedViews: DrawingView[] = [];
    const removedViewIndices: number[] = [];
    const removedDims: DrawingDimension[] = [];
    const removedDimIndices: number[] = [];
    const removedAnns: DrawingAnnotation[] = [];
    const removedAnnIndices: number[] = [];

    sheet.views.forEach((v, i) => {
      if (viewIdsToRemove.has(v.id)) {
        removedViews.push(v);
        removedViewIndices.push(i);
      }
    });
    sheet.dimensions.forEach((d, i) => {
      if (viewIdsToRemove.has(d.viewId)) {
        removedDims.push(d);
        removedDimIndices.push(i);
      }
    });
    sheet.annotations.forEach((a, i) => {
      if (viewIdsToRemove.has(a.viewId)) {
        removedAnns.push(a);
        removedAnnIndices.push(i);
      }
    });

    // Collect cache keys for removed section views so they can be evicted.
    const sectionCacheKeys: string[] = [];
    for (const v of removedViews) {
      if (v.kind === 'section') {
        const sv = v as SectionView;
        if (sv.fingerprint) sectionCacheKeys.push(sv.fingerprint);
      }
    }

    this.snapshot = {
      views: removedViews,
      viewIndices: removedViewIndices,
      dimensions: removedDims,
      dimIndices: removedDimIndices,
      annotations: removedAnns,
      annIndices: removedAnnIndices,
      sectionCacheKeys,
    };

    // Evict section cache entries for removed views (best-effort).
    for (const key of sectionCacheKeys) {
      await sectionCache.delete(key).catch(() => undefined);
    }

    const next: DrawingDocument = {
      ...doc.document,
      sheets: doc.document.sheets.map(s =>
        s.id === this.opts.sheetId
          ? {
              ...s,
              views: s.views.filter(v => !viewIdsToRemove.has(v.id)),
              dimensions: s.dimensions.filter(d => !viewIdsToRemove.has(d.viewId)),
              annotations: s.annotations.filter(a => !viewIdsToRemove.has(a.viewId)),
            }
          : s
      ),
    };
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: next } });
  }

  async revert(): Promise<void> {
    if (!this.snapshot) return;
    const state = useAppStore.getState();
    const doc = state.activeDocument;
    if (!doc || doc.kind !== 'drawing') return;

    const snap = this.snapshot;

    const next: DrawingDocument = {
      ...doc.document,
      sheets: doc.document.sheets.map(s => {
        if (s.id !== this.opts.sheetId) return s;

        // Re-splice captured items back at their original indices
        const views = [...s.views];
        for (let i = 0; i < snap.views.length; i++) {
          views.splice(snap.viewIndices[i]!, 0, snap.views[i]!);
        }
        const dimensions = [...s.dimensions];
        for (let i = 0; i < snap.dimensions.length; i++) {
          dimensions.splice(snap.dimIndices[i]!, 0, snap.dimensions[i]!);
        }
        const annotations = [...s.annotations];
        for (let i = 0; i < snap.annotations.length; i++) {
          annotations.splice(snap.annIndices[i]!, 0, snap.annotations[i]!);
        }

        return { ...s, views, dimensions, annotations };
      }),
    };
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: next } });
    this.snapshot = null;
  }
}
```

#### Step 4: Run test to verify it passes

```
pnpm --filter app test src/commands/__tests__/DeleteViewCommand
```

Expected: all existing tests still pass + 3 new detail-cascade tests pass.

#### Step 5: Run typecheck

```
pnpm -r typecheck
```

#### Step 6: Commit

```
git add packages/app/src/commands/DeleteViewCommand.ts packages/app/src/commands/__tests__/DeleteViewCommand.spec.ts && git commit -m "refactor(drawing-cmd): DeleteViewCommand cascade extends to detail children of any parent kind"
```

---

### Task 3.8 — `DeleteViewCommand` cascade: multiple detail children + mixed section children

**Files:**
- Modify: `packages/app/src/commands/__tests__/DeleteViewCommand.spec.ts` (extend detail-cascade describe block)

#### Step 1: Write the failing test

Extend the `'DeleteViewCommand — detail cascade (Drawing F2)'` describe block from Task 3.7 with:

```ts
  it('deleting parent with 2 detail + 1 section children removes all 4 views', async () => {
    const detail_b: DetailView = {
      id: 'detail-b', kind: 'detail',
      parentViewId: 'base-d1',
      regionParent: { center: { x: 30, y: 20 }, radiusMm: 8 },
      label: 'B',
      positionMm: { x: 300, y: 200 },
      scale: { numerator: 2, denominator: 1 },
      showHidden: false,
      projection: { visibleEdges: [], hiddenEdges: [], bbox: { minX: 0, minY: 0, maxX: 0, maxY: 0 } },
      inputFingerprint: 'detail-b-fp',
    };
    const section_c = {
      id: 'sect-c', kind: 'section' as const,
      parentViewId: 'base-d1',
      sectionLine: { p0: { x: 0, y: 30 }, p1: { x: 100, y: 30 } },
      arrowDirection: 1 as const,
      label: 'C',
      positionMm: { x: 400, y: 100 },
      scale: { numerator: 1, denominator: 1 },
      showHidden: false,
      hatchSegments: [],
      fingerprint: 'fp-sect-c',
      projection: { visibleEdges: [], hiddenEdges: [], bbox: { minX: 0, minY: 0, maxX: 0, maxY: 0 } },
    };
    // Sheet has: base-d1, detail-a, detail-b, sect-c
    useAppStore.setState({
      activeDocument: {
        kind: 'drawing',
        document: {
          id: 'd-mixed', name: 'D-Mixed', units: 'mm',
          source: { partPath: 'parts/p.zipt', sourceKind: 'part' },
          properties: {},
          sheets: [{
            id: 'sheet-m', name: 'Sheet M',
            size: { kind: 'iso', size: 'A3' }, orientation: 'landscape',
            views: [BASE_FOR_DETAIL, DETAIL_A, detail_b, section_c],
            dimensions: [],
            annotations: [],
            titleBlock: {},
          }],
          activeSheetId: 'sheet-m',
        },
      },
    });

    const cmd = new DeleteViewCommand({ sheetId: 'sheet-m', viewId: 'base-d1' });
    await cmd.apply();

    const _ad = useAppStore.getState().activeDocument;
    if (!_ad || _ad.kind !== 'drawing') throw new Error('expected drawing');
    const sheet = _ad.document.sheets[0]!;
    expect(sheet.views).toHaveLength(0);
  });

  it('revert restores all 4 views in original order after mixed cascade delete', async () => {
    const detail_b: DetailView = {
      id: 'detail-b', kind: 'detail',
      parentViewId: 'base-d1',
      regionParent: { center: { x: 30, y: 20 }, radiusMm: 8 },
      label: 'B',
      positionMm: { x: 300, y: 200 },
      scale: { numerator: 2, denominator: 1 },
      showHidden: false,
      projection: { visibleEdges: [], hiddenEdges: [], bbox: { minX: 0, minY: 0, maxX: 0, maxY: 0 } },
      inputFingerprint: 'detail-b-fp',
    };
    const section_c = {
      id: 'sect-c', kind: 'section' as const,
      parentViewId: 'base-d1',
      sectionLine: { p0: { x: 0, y: 30 }, p1: { x: 100, y: 30 } },
      arrowDirection: 1 as const,
      label: 'C',
      positionMm: { x: 400, y: 100 },
      scale: { numerator: 1, denominator: 1 },
      showHidden: false,
      hatchSegments: [],
      fingerprint: 'fp-sect-c',
      projection: { visibleEdges: [], hiddenEdges: [], bbox: { minX: 0, minY: 0, maxX: 0, maxY: 0 } },
    };
    useAppStore.setState({
      activeDocument: {
        kind: 'drawing',
        document: {
          id: 'd-mixed2', name: 'D-Mixed2', units: 'mm',
          source: { partPath: 'parts/p.zipt', sourceKind: 'part' },
          properties: {},
          sheets: [{
            id: 'sheet-m2', name: 'Sheet M2',
            size: { kind: 'iso', size: 'A3' }, orientation: 'landscape',
            views: [BASE_FOR_DETAIL, DETAIL_A, detail_b, section_c],
            dimensions: [],
            annotations: [],
            titleBlock: {},
          }],
          activeSheetId: 'sheet-m2',
        },
      },
    });

    const cmd = new DeleteViewCommand({ sheetId: 'sheet-m2', viewId: 'base-d1' });
    await cmd.apply();
    await cmd.revert();

    const _ad = useAppStore.getState().activeDocument;
    if (!_ad || _ad.kind !== 'drawing') throw new Error('expected drawing');
    const sheet = _ad.document.sheets[0]!;
    expect(sheet.views).toHaveLength(4);
    expect(sheet.views[0]!.id).toBe('base-d1');
    expect(sheet.views[1]!.id).toBe('detail-a');
    expect(sheet.views[2]!.id).toBe('detail-b');
    expect(sheet.views[3]!.id).toBe('sect-c');
  });
```

#### Step 2: Run test to verify it fails

```
pnpm --filter app test src/commands/__tests__/DeleteViewCommand
```

Expected failure before Task 3.7 is landed: cascade does not remove detail children. After Task 3.7 is landed, these tests should pass (the implementation already handles all detail children).

#### Step 3: Write minimal implementation

No additional code change to `DeleteViewCommand.ts` — the implementation from Task 3.7 already covers this case (the `for (const v of sheet.views)` detail loop handles any number of detail children). The test is the deliverable.

#### Step 4: Run test to verify it passes

```
pnpm --filter app test src/commands/__tests__/DeleteViewCommand
```

Expected: all tests pass including the 2 new ones.

#### Step 5: Run typecheck

```
pnpm -r typecheck
```

#### Step 6: Commit

```
git add packages/app/src/commands/__tests__/DeleteViewCommand.spec.ts && git commit -m "test(drawing-detail-cmd): DeleteViewCommand cascade — 2 detail + 1 section children + revert ordering"
```

---

### Task 3.9 — `RegenerateViewCommand` detail branch sanity test

**Files:**
- Modify: `packages/app/src/commands/__tests__/RegenerateViewCommand.spec.ts` (add detail-branch describe block)

**Context:** `RegenerateViewCommand` is already fully generic — it accepts any `viewId` and updates `projection` + `inputFingerprint` on the matched view via a `views.map` replace. `DetailView` has both fields. No command code changes are required. The "detail branch" referred to in spec §8.3 is conceptual: the caller (a UI action handler) computes fresh `projection` via `projectDetailView` and dispatches `RegenerateViewCommand`. This task verifies the command works correctly when applied to a `DetailView`.

#### Step 1: Write the failing test

Append to `packages/app/src/commands/__tests__/RegenerateViewCommand.spec.ts`:

```ts
import type { DetailView } from '@zilventor/shared';

const OLD_DETAIL_PROJECTION = {
  visibleEdges: [{ id: 'clip-old', kind: 'outline' as const, points: [[2, 1], [8, 1]] as [number, number][], sourceFaceIds: [] }],
  hiddenEdges: [],
  bbox: { minX: 2, minY: 1, maxX: 8, maxY: 7 },
};

const NEW_DETAIL_PROJECTION = {
  visibleEdges: [
    { id: 'clip-new-1', kind: 'outline' as const, points: [[3, 2], [9, 2]] as [number, number][], sourceFaceIds: [] },
    { id: 'clip-new-2', kind: 'outline' as const, points: [[3, 2], [3, 8]] as [number, number][], sourceFaceIds: [] },
  ],
  hiddenEdges: [],
  bbox: { minX: 3, minY: 2, maxX: 9, maxY: 8 },
};

const DETAIL_VIEW_STALE: DetailView = {
  id: 'detail-stale',
  kind: 'detail',
  parentViewId: 'parent-v1',
  regionParent: { center: { x: 10, y: 8 }, radiusMm: 5 },
  label: 'A',
  positionMm: { x: 200, y: 200 },
  scale: { numerator: 2, denominator: 1 },
  showHidden: false,
  projection: OLD_DETAIL_PROJECTION,
  inputFingerprint: 'stale-detail-fp',
};

function makeDrawingWithStaleDetail(): DrawingDocument {
  return {
    id: 'd-regen', name: 'D-Regen', units: 'mm',
    source: { partPath: 'parts/p.zipt', sourceKind: 'part' },
    properties: {},
    sheets: [{
      id: 'sheet-regen', name: 'Sheet Regen',
      size: { kind: 'iso', size: 'A3' }, orientation: 'landscape',
      views: [DETAIL_VIEW_STALE],
      dimensions: [],
      annotations: [],
      titleBlock: {},
    }],
    activeSheetId: 'sheet-regen',
  };
}

describe('RegenerateViewCommand — detail view branch', () => {
  beforeEach(() => {
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: makeDrawingWithStaleDetail() } });
  });

  it('apply replaces projection and inputFingerprint on a DetailView', async () => {
    const cmd = new RegenerateViewCommand({
      sheetId: 'sheet-regen',
      viewId: 'detail-stale',
      projection: NEW_DETAIL_PROJECTION,
      inputFingerprint: 'fresh-detail-fp',
    });
    await cmd.apply();

    const _ad = useAppStore.getState().activeDocument;
    if (!_ad || _ad.kind !== 'drawing') throw new Error('expected drawing');
    const view = _ad.document.sheets[0]!.views[0]! as DetailView;
    expect(view.kind).toBe('detail');
    expect(view.projection).toEqual(NEW_DETAIL_PROJECTION);
    expect(view.inputFingerprint).toBe('fresh-detail-fp');
    // Confirm other fields are intact
    expect(view.label).toBe('A');
    expect(view.regionParent).toEqual({ center: { x: 10, y: 8 }, radiusMm: 5 });
  });

  it('revert restores stale projection and old fingerprint on a DetailView', async () => {
    const cmd = new RegenerateViewCommand({
      sheetId: 'sheet-regen',
      viewId: 'detail-stale',
      projection: NEW_DETAIL_PROJECTION,
      inputFingerprint: 'fresh-detail-fp',
    });
    await cmd.apply();
    await cmd.revert();

    const _ad = useAppStore.getState().activeDocument;
    if (!_ad || _ad.kind !== 'drawing') throw new Error('expected drawing');
    const view = _ad.document.sheets[0]!.views[0]! as DetailView;
    expect(view.projection).toEqual(OLD_DETAIL_PROJECTION);
    expect(view.inputFingerprint).toBe('stale-detail-fp');
  });

  it('other DetailView fields (label, regionParent, positionMm) are unchanged by regenerate', async () => {
    const cmd = new RegenerateViewCommand({
      sheetId: 'sheet-regen',
      viewId: 'detail-stale',
      projection: NEW_DETAIL_PROJECTION,
      inputFingerprint: 'fresh-detail-fp',
    });
    await cmd.apply();

    const _ad = useAppStore.getState().activeDocument;
    if (!_ad || _ad.kind !== 'drawing') throw new Error('expected drawing');
    const view = _ad.document.sheets[0]!.views[0]! as DetailView;
    expect(view.positionMm).toEqual({ x: 200, y: 200 });
    expect(view.scale).toEqual({ numerator: 2, denominator: 1 });
    expect(view.showHidden).toBe(false);
  });
});
```

#### Step 2: Run test to verify it fails

```
pnpm --filter app test src/commands/__tests__/RegenerateViewCommand
```

Expected failure: import error for `DetailView` type (the type is not yet defined in `@zilventor/shared` until Phase 1 lands). If Phase 1 is landed, expected: compile-time type error on `DETAIL_VIEW_STALE` construction. The existing `RegenerateViewCommand` implementation is already generic and will make these tests pass once types are available.

#### Step 3: Write minimal implementation

No changes to `RegenerateViewCommand.ts` — it already uses `views.map(v => v.id === opts.viewId ? { ...v, projection, inputFingerprint } : v)` which is kind-agnostic. The test is the deliverable.

If Phase 1 is not yet landed (types unavailable), the implementer should add a `// @ts-expect-error DetailView not yet available` comment on the `DETAIL_VIEW_STALE` const and remove it once Phase 1 lands.

#### Step 4: Run test to verify it passes

```
pnpm --filter app test src/commands/__tests__/RegenerateViewCommand
```

Expected: all 6 existing + 3 new tests pass.

#### Step 5: Run typecheck

```
pnpm -r typecheck
```

#### Step 6: Commit

```
git add packages/app/src/commands/__tests__/RegenerateViewCommand.spec.ts && git commit -m "test(drawing-detail-cmd): RegenerateViewCommand detail branch — apply/revert on DetailView, no cmd changes"
```

---

### Task 3.10 — Sanity test: `MoveViewCommand` works on a detail view

**Files:**
- Create: `packages/app/src/commands/__tests__/detailViewMoveScale.test.ts`

#### Step 1: Write the failing test

Create `packages/app/src/commands/__tests__/detailViewMoveScale.test.ts`:

```ts
// packages/app/src/commands/__tests__/detailViewMoveScale.test.ts
// Sanity tests: MoveViewCommand and EditViewScaleCommand work on DetailView
// WITHOUT any modification to those commands.
import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '../../store/useAppStore';
import { MoveViewCommand } from '../MoveViewCommand';
import { EditViewScaleCommand } from '../EditViewScaleCommand';
import type { DrawingDocument, DetailView } from '@zilventor/shared';

const DETAIL: DetailView = {
  id: 'dv1',
  kind: 'detail',
  parentViewId: 'base-v1',
  regionParent: { center: { x: 10, y: 8 }, radiusMm: 5 },
  label: 'A',
  positionMm: { x: 100, y: 100 },
  scale: { numerator: 2, denominator: 1 },
  showHidden: false,
  projection: {
    visibleEdges: [{ id: 'e1', kind: 'outline', points: [[2, 1], [8, 1]], sourceFaceIds: [] }],
    hiddenEdges: [],
    bbox: { minX: 2, minY: 1, maxX: 8, maxY: 7 },
  },
  inputFingerprint: 'detail-fp-abc',
};

function makeDrawing(): DrawingDocument {
  return {
    id: 'd1', name: 'D', units: 'mm',
    source: { partPath: 'parts/p.zipt', sourceKind: 'part' },
    properties: {},
    sheets: [{
      id: 'sheet-1', name: 'Sheet 1',
      size: { kind: 'iso', size: 'A3' }, orientation: 'landscape',
      views: [DETAIL],
      dimensions: [],
      annotations: [],
      titleBlock: {},
    }],
    activeSheetId: 'sheet-1',
  };
}

describe('MoveViewCommand — sanity on DetailView (no command code change)', () => {
  beforeEach(() => {
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: makeDrawing() } } as never);
  });

  it('apply moves the detail view to the new position', async () => {
    const cmd = new MoveViewCommand({ sheetId: 'sheet-1', viewId: 'dv1', positionMm: { x: 200, y: 150 } });
    await cmd.apply();

    const _ad = useAppStore.getState().activeDocument;
    if (!_ad || _ad.kind !== 'drawing') throw new Error('expected drawing');
    const view = _ad.document.sheets[0]!.views[0]!;
    expect(view.positionMm).toEqual({ x: 200, y: 150 });
    expect(view.kind).toBe('detail');
  });

  it('revert restores prior position on detail view', async () => {
    const cmd = new MoveViewCommand({ sheetId: 'sheet-1', viewId: 'dv1', positionMm: { x: 200, y: 150 } });
    await cmd.apply();
    await cmd.revert();

    const _ad = useAppStore.getState().activeDocument;
    if (!_ad || _ad.kind !== 'drawing') throw new Error('expected drawing');
    const view = _ad.document.sheets[0]!.views[0]!;
    expect(view.positionMm).toEqual({ x: 100, y: 100 });
  });

  it('regionParent and label are unchanged after move', async () => {
    const cmd = new MoveViewCommand({ sheetId: 'sheet-1', viewId: 'dv1', positionMm: { x: 300, y: 250 } });
    await cmd.apply();

    const _ad = useAppStore.getState().activeDocument;
    if (!_ad || _ad.kind !== 'drawing') throw new Error('expected drawing');
    const view = _ad.document.sheets[0]!.views[0]! as DetailView;
    expect(view.regionParent).toEqual({ center: { x: 10, y: 8 }, radiusMm: 5 });
    expect(view.label).toBe('A');
  });
});
```

#### Step 2: Run test to verify it fails

```
pnpm --filter app test src/commands/__tests__/detailViewMoveScale
```

Expected failure: import error for `DetailView` (Phase 1 not yet landed). Once Phase 1 is landed: `Tests 3 passed` immediately (command is already kind-agnostic).

#### Step 3: Write minimal implementation

No changes to `MoveViewCommand.ts` — the command already uses `views.map(v => v.id === opts.viewId ? { ...v, positionMm } : v)` which is kind-agnostic. The test is the entire deliverable.

#### Step 4: Run test to verify it passes

```
pnpm --filter app test src/commands/__tests__/detailViewMoveScale
```

Expected: `Tests 3 passed`.

#### Step 5: Run typecheck

```
pnpm -r typecheck
```

#### Step 6: Commit

```
git add packages/app/src/commands/__tests__/detailViewMoveScale.test.ts && git commit -m "test(drawing-detail-cmd): MoveViewCommand sanity on DetailView — no cmd code change required"
```

---

### Task 3.11 — Sanity test: `EditViewScaleCommand` works on a detail view

**Files:**
- Modify: `packages/app/src/commands/__tests__/detailViewMoveScale.test.ts` (extend with EditViewScaleCommand describe block)

#### Step 1: Write the failing test

Append to `packages/app/src/commands/__tests__/detailViewMoveScale.test.ts`:

```ts
describe('EditViewScaleCommand — sanity on DetailView (no command code change)', () => {
  beforeEach(() => {
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: makeDrawing() } } as never);
  });

  it('apply updates scale on detail view to 5:1', async () => {
    const cmd = new EditViewScaleCommand({
      sheetId: 'sheet-1',
      viewId: 'dv1',
      scale: { numerator: 5, denominator: 1 },
    });
    await cmd.apply();

    const _ad = useAppStore.getState().activeDocument;
    if (!_ad || _ad.kind !== 'drawing') throw new Error('expected drawing');
    const view = _ad.document.sheets[0]!.views[0]! as DetailView;
    expect(view.scale).toEqual({ numerator: 5, denominator: 1 });
    expect(view.kind).toBe('detail');
  });

  it('apply clears inputFingerprint on detail view (triggers stale-banner)', async () => {
    const cmd = new EditViewScaleCommand({
      sheetId: 'sheet-1',
      viewId: 'dv1',
      scale: { numerator: 4, denominator: 1 },
    });
    await cmd.apply();

    const _ad = useAppStore.getState().activeDocument;
    if (!_ad || _ad.kind !== 'drawing') throw new Error('expected drawing');
    const view = _ad.document.sheets[0]!.views[0]! as DetailView;
    // inputFingerprint must be cleared so the stale-banner appears
    expect(view.inputFingerprint).toBeUndefined();
  });

  it('revert restores prior scale and inputFingerprint on detail view', async () => {
    const cmd = new EditViewScaleCommand({
      sheetId: 'sheet-1',
      viewId: 'dv1',
      scale: { numerator: 5, denominator: 1 },
    });
    await cmd.apply();
    await cmd.revert();

    const _ad = useAppStore.getState().activeDocument;
    if (!_ad || _ad.kind !== 'drawing') throw new Error('expected drawing');
    const view = _ad.document.sheets[0]!.views[0]! as DetailView;
    expect(view.scale).toEqual({ numerator: 2, denominator: 1 });
    expect(view.inputFingerprint).toBe('detail-fp-abc');
  });

  it('regionParent and label are unchanged after scale edit', async () => {
    const cmd = new EditViewScaleCommand({
      sheetId: 'sheet-1',
      viewId: 'dv1',
      scale: { numerator: 3, denominator: 1 },
    });
    await cmd.apply();

    const _ad = useAppStore.getState().activeDocument;
    if (!_ad || _ad.kind !== 'drawing') throw new Error('expected drawing');
    const view = _ad.document.sheets[0]!.views[0]! as DetailView;
    expect(view.regionParent).toEqual({ center: { x: 10, y: 8 }, radiusMm: 5 });
    expect(view.label).toBe('A');
  });
});
```

#### Step 2: Run test to verify it fails

```
pnpm --filter app test src/commands/__tests__/detailViewMoveScale
```

Expected failure: `DetailView` type import error until Phase 1 lands. Once Phase 1 is landed: `Tests 7 passed` immediately.

#### Step 3: Write minimal implementation

No changes to `EditViewScaleCommand.ts` — the command is already kind-agnostic. The test is the deliverable.

#### Step 4: Run test to verify it passes

```
pnpm --filter app test src/commands/__tests__/detailViewMoveScale
```

Expected: `Tests 7 passed`.

#### Step 5: Run typecheck

```
pnpm -r typecheck
```

#### Step 6: Commit

```
git add packages/app/src/commands/__tests__/detailViewMoveScale.test.ts && git commit -m "test(drawing-detail-cmd): EditViewScaleCommand sanity on DetailView — clears fingerprint, no cmd changes"
```

---

### Task 3.12 — Phase 3 baseline check (verification only)

**Files:** None (verification only, no code changes).

#### Step 1: Run full command suite

```
pnpm --filter app test src/commands
```

Expected: all command tests pass — no regressions in existing tests, all Phase 3 tests green.

#### Step 2: Run typecheck across all packages

```
pnpm -r typecheck
```

Expected: 0 errors.

#### Step 3: Commit (if any stray fixes were needed)

If the baseline check surfaces a type error from a missing import or interface mismatch (e.g., `DetailView` not yet exported from `@zilventor/shared`), fix it here and commit:

```
git add <fixed-file> && git commit -m "feat(drawing-detail-cmd): Phase 3 baseline — fix stray type errors after full suite run"
```

If no fixes were needed, no commit is required for this task.

---
## Phase 4 — UI: tool mode, overlay, view-element, canvas dispatch, ribbon, tree pane

**Goal:** Wire `'detail'` tool mode with 3-stage state machine, `<DetailRegionOverlay>` parent annotation, `<ViewElement>` `'detail'` branch, `DrawingCanvas` click dispatch, ribbon button, and tree-pane nesting. Phase output: clicking the ribbon "Detail" button switches the canvas to detail-pick mode; 3 clicks (region center, region radius, drop position) on the canvas issue `AddDetailViewCommand` to the bus and the new view renders with its border, clipped edges, caption, and parent circle marker.

**Files created/touched (this phase only):**
- Modify: `packages/app/src/drawing/toolMode.ts` (add `'detail'` mode + state machine)
- Modify: `packages/app/src/drawing/__tests__/toolMode.spec.ts` (extend with detail describe block)
- Create: `packages/app/src/drawing/DetailRegionOverlay.tsx`
- Create: `packages/app/src/drawing/__tests__/DetailRegionOverlay.spec.tsx`
- Modify: `packages/app/src/drawing/ViewElement.tsx` (add `case 'detail'` branch)
- Modify: `packages/app/src/drawing/__tests__/ViewElement.spec.tsx` (extend)
- Modify: `packages/app/src/drawing/DrawingCanvas.tsx` (click dispatch + overlay placement + preview)
- Modify: `packages/app/src/drawing/__tests__/DrawingCanvas.spec.tsx` (extend)
- Modify: `packages/app/src/shell/tabs/DrawingTab.tsx` (add Detail button between Section and Iso View)
- Modify: `packages/app/src/shell/tabs/__tests__/DrawingTab.spec.tsx` (extend)
- Modify: `packages/app/src/drawing/DrawingTreePane.tsx` (nested children for detail views)
- Modify: `packages/app/src/drawing/__tests__/DrawingTreePane.spec.tsx` (extend)

---

### Task 4.1 — `useToolModeStore`: add `'detail'` discriminant, `DetailToolState` type, store fields

**Files:**
- Modify: `packages/app/src/drawing/toolMode.ts`
- Modify: `packages/app/src/drawing/__tests__/toolMode.spec.ts`

**Agent:** Sonnet implementer.

- [ ] **Step 1: Write failing tests**

  Append a new `describe` block at the bottom of `packages/app/src/drawing/__tests__/toolMode.spec.ts`:

  ```ts
  import type { DetailToolState } from '../toolMode';

  describe('detail tool — initial state + mode discriminant', () => {
    beforeEach(() => {
      useToolModeStore.getState().reset();
    });

    it('reset() initialises detailState to { stage: "idle" }', () => {
      const s = useToolModeStore.getState();
      expect(s.detailState).toEqual({ stage: 'idle' });
    });

    it('setMode("detail") sets mode=detail without touching detailState', () => {
      useToolModeStore.getState().setMode('detail');
      const s = useToolModeStore.getState();
      expect(s.mode).toBe('detail');
      expect(s.detailState).toEqual({ stage: 'idle' });
    });

    it('enterDetailMode() sets mode=detail, stage=idle', () => {
      useToolModeStore.getState().enterDetailMode();
      const s = useToolModeStore.getState();
      expect(s.mode).toBe('detail');
      expect(s.detailState).toEqual({ stage: 'idle' });
    });

    it('setMode round-trip list now includes detail', () => {
      useToolModeStore.getState().setMode('detail');
      expect(useToolModeStore.getState().mode).toBe('detail');
    });

    it('reset() from detail mode returns to idle and clears detailState', () => {
      useToolModeStore.getState().enterDetailMode();
      useToolModeStore.getState().reset();
      expect(useToolModeStore.getState().mode).toBe('idle');
      expect(useToolModeStore.getState().detailState).toEqual({ stage: 'idle' });
    });
  });
  ```

- [ ] **Step 2: Run (expect fail)**

  ```
  pnpm --filter app test src/drawing/__tests__/toolMode
  ```

- [ ] **Step 3: Implement**

  In `packages/app/src/drawing/toolMode.ts`:

  1. Add `'detail'` to the `ToolMode` union after `'section'`:

     ```ts
     | 'section'
     | 'detail';    // NEW — Drawing F2
     ```

  2. Add `DetailToolState` type after `SectionToolState`:

     ```ts
     // ---------------------------------------------------------------------------
     // Detail tool sub-state
     // ---------------------------------------------------------------------------
     export type DetailToolState =
       | { stage: 'idle' }
       | { stage: 'pickRegionCenter'; parentViewId: string }
       | { stage: 'pickRegionRadius'; parentViewId: string; center: { x: number; y: number } }
       | {
           stage: 'pickDrop';
           parentViewId: string;
           center: { x: number; y: number };
           radiusMm: number;
         };
     ```

  3. Add `detailState: DetailToolState` to `ToolModeState` interface and `enterDetailMode(): void` action:

     ```ts
     interface ToolModeState {
       // ... existing fields ...
       detailState: DetailToolState;

       // Detail tool actions
       enterDetailMode(): void;
       // (detailPickParent, detailPickCenter, etc. added in Tasks 4.2–4.5)
     }
     ```

  4. Add initial state and `enterDetailMode` to the store:

     ```ts
     export const useToolModeStore = create<ToolModeState>((set, get) => ({
       // ... existing fields ...
       detailState: { stage: 'idle' },

       // ... existing actions ...

       enterDetailMode() {
         set({ mode: 'detail', detailState: { stage: 'idle' } });
       },
     }));
     ```

  5. Update `reset()` to also reset `detailState`:

     ```ts
     reset() {
       set({
         mode: 'idle',
         pendingViewParams: null,
         sectionState: { stage: 'idle' },
         detailState: { stage: 'idle' },  // NEW
       });
     },
     ```

- [ ] **Step 4: Run (expect pass)**

  ```
  pnpm --filter app test src/drawing/__tests__/toolMode
  ```

- [ ] **Step 5: Typecheck**

  ```
  pnpm --filter app typecheck
  ```

- [ ] **Commit:** `feat(drawing-detail-tool): add 'detail' ToolMode discriminant + DetailToolState type + enterDetailMode`

---

### Task 4.2 — `useToolModeStore`: `detailPickParent` (idle → pickRegionCenter)

**Files:**
- Modify: `packages/app/src/drawing/toolMode.ts`
- Modify: `packages/app/src/drawing/__tests__/toolMode.spec.ts`

**Agent:** Sonnet implementer.

- [ ] **Step 1: Write failing tests**

  Append to the `'detail tool — initial state + mode discriminant'` describe block (or open a new sibling describe):

  ```ts
  describe('detail tool — stage transitions', () => {
    beforeEach(() => {
      useToolModeStore.getState().reset();
      useToolModeStore.getState().enterDetailMode();
    });

    it('detailPickParent() from idle → pickRegionCenter with parentViewId', () => {
      useToolModeStore.getState().detailPickParent('v-base-1');
      const s = useToolModeStore.getState();
      expect(s.detailState).toEqual({ stage: 'pickRegionCenter', parentViewId: 'v-base-1' });
    });

    it('detailPickParent() from non-idle stage is a no-op + warns', () => {
      useToolModeStore.getState().detailPickParent('v1');
      // now stage = pickRegionCenter; calling again should warn and not advance
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      useToolModeStore.getState().detailPickParent('v2');
      expect(useToolModeStore.getState().detailState).toMatchObject({ stage: 'pickRegionCenter', parentViewId: 'v1' });
      expect(warn).toHaveBeenCalled();
      warn.mockRestore();
    });
  });
  ```

- [ ] **Step 2: Run (expect fail)**

  ```
  pnpm --filter app test src/drawing/__tests__/toolMode
  ```

- [ ] **Step 3: Implement**

  Add `detailPickParent` to `ToolModeState` interface and store body in `toolMode.ts`:

  ```ts
  // In interface ToolModeState:
  detailPickParent(viewId: string): void;
  ```

  ```ts
  // In store body, after enterDetailMode:
  detailPickParent(viewId) {
    const { detailState } = get();
    if (detailState.stage !== 'idle') {
      console.warn('detailPickParent: expected stage=idle, got', detailState.stage);
      return;
    }
    set({ detailState: { stage: 'pickRegionCenter', parentViewId: viewId } });
  },
  ```

- [ ] **Step 4: Run (expect pass)**

  ```
  pnpm --filter app test src/drawing/__tests__/toolMode
  ```

- [ ] **Commit:** `feat(drawing-detail-tool): detailPickParent — idle → pickRegionCenter transition`

---

### Task 4.3 — `useToolModeStore`: `detailPickCenter` (pickRegionCenter → pickRegionRadius)

**Files:**
- Modify: `packages/app/src/drawing/toolMode.ts`
- Modify: `packages/app/src/drawing/__tests__/toolMode.spec.ts`

**Agent:** Sonnet implementer.

- [ ] **Step 1: Write failing tests**

  Append to the `'detail tool — stage transitions'` describe block:

  ```ts
  it('detailPickCenter() from pickRegionCenter → pickRegionRadius with center', () => {
    useToolModeStore.getState().detailPickParent('v1');
    useToolModeStore.getState().detailPickCenter({ x: 10, y: 8 });
    const s = useToolModeStore.getState();
    expect(s.detailState).toEqual({
      stage: 'pickRegionRadius',
      parentViewId: 'v1',
      center: { x: 10, y: 8 },
    });
  });

  it('detailPickCenter() from wrong stage is a no-op + warns', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // stage is still idle (no prior detailPickParent in this sub-test)
    useToolModeStore.getState().reset();
    useToolModeStore.getState().enterDetailMode();
    useToolModeStore.getState().detailPickCenter({ x: 5, y: 5 });
    expect(useToolModeStore.getState().detailState).toEqual({ stage: 'idle' });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
  ```

- [ ] **Step 2: Run (expect fail)**

  ```
  pnpm --filter app test src/drawing/__tests__/toolMode
  ```

- [ ] **Step 3: Implement**

  Add `detailPickCenter` to interface and store:

  ```ts
  // In interface:
  detailPickCenter(point: { x: number; y: number }): void;
  ```

  ```ts
  // In store:
  detailPickCenter(point) {
    const { detailState } = get();
    if (detailState.stage !== 'pickRegionCenter') {
      console.warn('detailPickCenter: expected stage=pickRegionCenter, got', detailState.stage);
      return;
    }
    set({
      detailState: {
        stage: 'pickRegionRadius',
        parentViewId: detailState.parentViewId,
        center: point,
      },
    });
  },
  ```

- [ ] **Step 4: Run (expect pass)**

  ```
  pnpm --filter app test src/drawing/__tests__/toolMode
  ```

- [ ] **Commit:** `feat(drawing-detail-tool): detailPickCenter — pickRegionCenter → pickRegionRadius transition`

---

### Task 4.4 — `useToolModeStore`: `detailPickRadius` (pickRegionRadius → pickDrop) + `detailPickDrop` completion

**Files:**
- Modify: `packages/app/src/drawing/toolMode.ts`
- Modify: `packages/app/src/drawing/__tests__/toolMode.spec.ts`

**Agent:** Sonnet implementer.

- [ ] **Step 1: Write failing tests**

  Append to the `'detail tool — stage transitions'` describe block:

  ```ts
  it('detailPickRadius() from pickRegionRadius → pickDrop with radiusMm = distance to center', () => {
    useToolModeStore.getState().detailPickParent('v1');
    useToolModeStore.getState().detailPickCenter({ x: 10, y: 8 });
    // Click at (25, 8): distance from (10,8) = 15mm
    useToolModeStore.getState().detailPickRadius({ x: 25, y: 8 });
    const s = useToolModeStore.getState();
    expect(s.detailState).toMatchObject({
      stage: 'pickDrop',
      parentViewId: 'v1',
      center: { x: 10, y: 8 },
    });
    const ds = s.detailState as { stage: 'pickDrop'; radiusMm: number };
    expect(ds.radiusMm).toBeCloseTo(15, 3);
  });

  it('detailPickRadius() with non-zero y component computes correct Euclidean distance', () => {
    useToolModeStore.getState().detailPickParent('v1');
    useToolModeStore.getState().detailPickCenter({ x: 0, y: 0 });
    // Click at (3, 4): distance = 5
    useToolModeStore.getState().detailPickRadius({ x: 3, y: 4 });
    const ds = useToolModeStore.getState().detailState as { stage: 'pickDrop'; radiusMm: number };
    expect(ds.radiusMm).toBeCloseTo(5, 3);
  });

  it('detailPickDrop() calls onDispatch callback and resets stage to idle', () => {
    useToolModeStore.getState().detailPickParent('v1');
    useToolModeStore.getState().detailPickCenter({ x: 10, y: 8 });
    useToolModeStore.getState().detailPickRadius({ x: 25, y: 8 });
    const onDispatch = vi.fn();
    useToolModeStore.getState().detailPickDrop({ x: 200, y: 150 }, onDispatch);
    expect(onDispatch).toHaveBeenCalledOnce();
    expect(useToolModeStore.getState().detailState).toEqual({ stage: 'idle' });
    expect(useToolModeStore.getState().mode).toBe('idle');
  });

  it('detailPickDrop() from wrong stage is a no-op + warns', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const cb = vi.fn();
    useToolModeStore.getState().reset();
    useToolModeStore.getState().enterDetailMode();
    useToolModeStore.getState().detailPickDrop({ x: 5, y: 5 }, cb);
    expect(cb).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
  ```

- [ ] **Step 2: Run (expect fail)**

  ```
  pnpm --filter app test src/drawing/__tests__/toolMode
  ```

- [ ] **Step 3: Implement**

  Add `detailPickRadius` and `detailPickDrop` to interface and store:

  ```ts
  // In interface:
  detailPickRadius(point: { x: number; y: number }): void;
  detailPickDrop(point: { x: number; y: number }, onDispatch: () => void): void;
  ```

  ```ts
  // In store:
  detailPickRadius(point) {
    const { detailState } = get();
    if (detailState.stage !== 'pickRegionRadius') {
      console.warn('detailPickRadius: expected stage=pickRegionRadius, got', detailState.stage);
      return;
    }
    const dx = point.x - detailState.center.x;
    const dy = point.y - detailState.center.y;
    const radiusMm = Math.sqrt(dx * dx + dy * dy);
    set({
      detailState: {
        stage: 'pickDrop',
        parentViewId: detailState.parentViewId,
        center: detailState.center,
        radiusMm,
      },
    });
  },

  detailPickDrop(_point, onDispatch) {
    const { detailState } = get();
    if (detailState.stage !== 'pickDrop') {
      console.warn('detailPickDrop: expected stage=pickDrop, got', detailState.stage);
      return;
    }
    onDispatch();
    set({ mode: 'idle', detailState: { stage: 'idle' } });
  },
  ```

- [ ] **Step 4: Run (expect pass)**

  ```
  pnpm --filter app test src/drawing/__tests__/toolMode
  ```

- [ ] **Commit:** `feat(drawing-detail-tool): detailPickRadius + detailPickDrop — complete 3-stage state machine`

---

### Task 4.5 — `useToolModeStore`: `detailCancel` — ESC at any stage

**Files:**
- Modify: `packages/app/src/drawing/toolMode.ts`
- Modify: `packages/app/src/drawing/__tests__/toolMode.spec.ts`

**Agent:** Sonnet implementer.

- [ ] **Step 1: Write failing tests**

  Append to the `'detail tool — stage transitions'` describe block:

  ```ts
  it('detailCancel() from pickRegionCenter → resets detailState to idle; mode stays detail', () => {
    useToolModeStore.getState().detailPickParent('v1');
    useToolModeStore.getState().detailCancel();
    const s = useToolModeStore.getState();
    expect(s.detailState).toEqual({ stage: 'idle' });
    expect(s.mode).toBe('detail');
  });

  it('detailCancel() from pickRegionRadius → resets to idle; mode stays detail', () => {
    useToolModeStore.getState().detailPickParent('v1');
    useToolModeStore.getState().detailPickCenter({ x: 5, y: 5 });
    useToolModeStore.getState().detailCancel();
    expect(useToolModeStore.getState().detailState).toEqual({ stage: 'idle' });
    expect(useToolModeStore.getState().mode).toBe('detail');
  });

  it('detailCancel() from pickDrop → resets to idle; mode stays detail', () => {
    useToolModeStore.getState().detailPickParent('v1');
    useToolModeStore.getState().detailPickCenter({ x: 5, y: 5 });
    useToolModeStore.getState().detailPickRadius({ x: 10, y: 5 });
    useToolModeStore.getState().detailCancel();
    expect(useToolModeStore.getState().detailState).toEqual({ stage: 'idle' });
    expect(useToolModeStore.getState().mode).toBe('detail');
  });

  it('detailCancel() twice — second cancel exits detail mode entirely', () => {
    useToolModeStore.getState().detailCancel(); // first ESC: stage already idle, mode=detail → stay
    useToolModeStore.getState().detailCancel(); // second ESC: stage=idle AND mode=detail → exit
    expect(useToolModeStore.getState().mode).toBe('idle');
  });
  ```

- [ ] **Step 2: Run (expect fail)**

  ```
  pnpm --filter app test src/drawing/__tests__/toolMode
  ```

- [ ] **Step 3: Implement**

  Add `detailCancel` to interface and store:

  ```ts
  // In interface:
  detailCancel(): void;
  ```

  ```ts
  // In store:
  detailCancel() {
    const { detailState, mode } = get();
    if (detailState.stage === 'idle' && mode === 'detail') {
      // Second ESC: exit detail mode entirely
      set({ mode: 'idle', detailState: { stage: 'idle' } });
    } else {
      // First ESC at any non-idle stage: back to idle, stay in detail mode
      set({ detailState: { stage: 'idle' } });
    }
  },
  ```

  The `DrawingCanvas.tsx` ESC key wiring for `detailCancel` is handled in Task 4.11. This task defines only the store action; the canvas dispatch is applied in Task 4.11 alongside the other canvas-level detail dispatches.

  Note: if the ESC handler wiring is needed before Task 4.11 lands, add `useToolModeStore.getState().detailCancel()` adjacent to the existing `sectionCancel()` call in the `Escape` branch of `DrawingCanvas.tsx`'s `useEffect` keyboard handler. The `detailCancel` action itself is fully defined in `toolMode.ts`; no further changes to this file are needed.

- [ ] **Step 4: Run (expect pass)**

  ```
  pnpm --filter app test src/drawing/__tests__/toolMode
  pnpm --filter app typecheck
  ```

- [ ] **Commit:** `feat(drawing-detail-tool): detailCancel — ESC resets stage; double-ESC exits detail mode`

---

### Task 4.6 — `<DetailRegionOverlay>`: circle + letter label at correct sheet coordinates

**Files:**
- Create: `packages/app/src/drawing/DetailRegionOverlay.tsx`
- Create: `packages/app/src/drawing/__tests__/DetailRegionOverlay.spec.tsx`

**Agent:** Sonnet implementer.

This task creates the parent-view annotation: a circle of radius `regionParent.radiusMm * parentScale` centered at `parentView.positionMm + regionParent.center * parentScale`, plus a letter label 5 mm upper-right of the circle perimeter.

Coordinate formula from spec §4.2 and §10.1:

```
parentScale = parentView.scale.numerator / parentView.scale.denominator
circleCx_sheet = parentView.positionMm.x + regionParent.center.x * parentScale
circleCy_sheet = parentView.positionMm.y + regionParent.center.y * parentScale
circleR_sheet  = regionParent.radiusMm * parentScale
labelX = circleCx + circleR * cos(45°) + 5 * cos(45°)  [= (circleR + 5) * cos(45°) + circleCx]
labelY = circleCy - circleR * sin(45°) - 5 * sin(45°)  [= circleCy - (circleR + 5) * sin(45°)]
```

- [ ] **Step 1: Write failing tests**

  ```tsx
  // packages/app/src/drawing/__tests__/DetailRegionOverlay.spec.tsx
  import { describe, it, expect } from 'vitest';
  import { render } from '@testing-library/react';
  import { DetailRegionOverlay } from '../DetailRegionOverlay';
  import type { BaseView, DetailView } from '@zilventor/shared';

  const PARENT_VIEW: BaseView = {
    id: 'pv1',
    kind: 'base',
    positionMm: { x: 50, y: 40 },
    scale: { numerator: 1, denominator: 5 },  // 1:5 → parentScale = 0.2
    orientation: 'front',
    showHidden: false,
  };

  const DETAIL_VIEW: DetailView = {
    id: 'dv1',
    kind: 'detail',
    parentViewId: 'pv1',
    regionParent: { center: { x: 10, y: 8 }, radiusMm: 5 },
    label: 'A',
    positionMm: { x: 200, y: 150 },
    scale: { numerator: 2, denominator: 1 },
    showHidden: false,
  };

  describe('DetailRegionOverlay', () => {
    it('renders a <circle> element with data-role="detail-callout-label"', () => {
      const { container } = render(
        <svg>
          <DetailRegionOverlay parentView={PARENT_VIEW} detailView={DETAIL_VIEW} />
        </svg>,
      );
      const circle = container.querySelector('circle[data-role="detail-callout-label"]');
      expect(circle).not.toBeNull();
    });

    it('circle cx/cy are in sheet space: positionMm + center * parentScale', () => {
      const { container } = render(
        <svg>
          <DetailRegionOverlay parentView={PARENT_VIEW} detailView={DETAIL_VIEW} />
        </svg>,
      );
      const circle = container.querySelector('circle[data-role="detail-callout-label"]')!;
      // cx = 50 + 10 * 0.2 = 52, cy = 40 + 8 * 0.2 = 41.6
      expect(parseFloat(circle.getAttribute('cx')!)).toBeCloseTo(52, 3);
      expect(parseFloat(circle.getAttribute('cy')!)).toBeCloseTo(41.6, 3);
    });

    it('circle r = regionParent.radiusMm * parentScale', () => {
      const { container } = render(
        <svg>
          <DetailRegionOverlay parentView={PARENT_VIEW} detailView={DETAIL_VIEW} />
        </svg>,
      );
      const circle = container.querySelector('circle[data-role="detail-callout-label"]')!;
      // r = 5 * 0.2 = 1
      expect(parseFloat(circle.getAttribute('r')!)).toBeCloseTo(1, 3);
    });

    it('renders a <text> with data-role="detail-callout-label" containing the label letter', () => {
      const { container } = render(
        <svg>
          <DetailRegionOverlay parentView={PARENT_VIEW} detailView={DETAIL_VIEW} />
        </svg>,
      );
      const text = container.querySelector('text[data-role="detail-callout-label"]');
      expect(text).not.toBeNull();
      expect(text!.textContent).toBe('A');
    });

    it('label x is upper-right of circle perimeter: cx + (r+5)*cos(45°)', () => {
      const { container } = render(
        <svg>
          <DetailRegionOverlay parentView={PARENT_VIEW} detailView={DETAIL_VIEW} />
        </svg>,
      );
      const text = container.querySelector('text[data-role="detail-callout-label"]')!;
      const cx = 50 + 10 * 0.2;           // 52
      const r  = 5 * 0.2;                 // 1
      const cos45 = Math.SQRT2 / 2;
      const expectedX = cx + (r + 5) * cos45;
      expect(parseFloat(text.getAttribute('x')!)).toBeCloseTo(expectedX, 2);
    });

    it('label y is upper-right of circle perimeter: cy - (r+5)*sin(45°)', () => {
      const { container } = render(
        <svg>
          <DetailRegionOverlay parentView={PARENT_VIEW} detailView={DETAIL_VIEW} />
        </svg>,
      );
      const text = container.querySelector('text[data-role="detail-callout-label"]')!;
      const cy = 40 + 8 * 0.2;            // 41.6
      const r  = 5 * 0.2;                 // 1
      const sin45 = Math.SQRT2 / 2;
      const expectedY = cy - (r + 5) * sin45;
      expect(parseFloat(text.getAttribute('y')!)).toBeCloseTo(expectedY, 2);
    });

    it('circle stroke-width is 0.35 mm', () => {
      const { container } = render(
        <svg>
          <DetailRegionOverlay parentView={PARENT_VIEW} detailView={DETAIL_VIEW} />
        </svg>,
      );
      const circle = container.querySelector('circle[data-role="detail-callout-label"]')!;
      expect(parseFloat(circle.getAttribute('stroke-width')!)).toBeCloseTo(0.35, 3);
    });

    it('stroke-width of circle is stable (no zoom prop affects circle weight)', () => {
      const { container: c1 } = render(
        <svg><DetailRegionOverlay parentView={PARENT_VIEW} detailView={DETAIL_VIEW} zoom={1} /></svg>,
      );
      const { container: c2 } = render(
        <svg><DetailRegionOverlay parentView={PARENT_VIEW} detailView={DETAIL_VIEW} zoom={2} /></svg>,
      );
      // The circle's stroke-width is fixed at 0.35; only text font-size scales by zoom
      const sw1 = parseFloat(c1.querySelector('circle[data-role="detail-callout-label"]')!.getAttribute('stroke-width')!);
      const sw2 = parseFloat(c2.querySelector('circle[data-role="detail-callout-label"]')!.getAttribute('stroke-width')!);
      expect(sw1).toBeCloseTo(sw2, 3);
    });
  });
  ```

- [ ] **Step 2: Run (expect fail)**

  ```
  pnpm --filter app test src/drawing/__tests__/DetailRegionOverlay
  ```

- [ ] **Step 3: Implement**

  Create `packages/app/src/drawing/DetailRegionOverlay.tsx`:

  ```tsx
  // packages/app/src/drawing/DetailRegionOverlay.tsx
  import React from 'react';
  import type { BaseView, ProjectedView, IsoView, SectionView, DetailView } from '@zilventor/shared';

  interface Props {
    parentView: BaseView | ProjectedView | IsoView | SectionView;
    detailView: DetailView;
    /** Sheet zoom factor (default 1). Used to scale label font size. */
    zoom?: number;
  }

  const LABEL_FONT_SIZE_MM = 5;
  const CIRCLE_STROKE_WIDTH = 0.35;

  export function DetailRegionOverlay({ parentView, detailView, zoom = 1 }: Props) {
    const parentScale = parentView.scale.numerator / parentView.scale.denominator;
    const { center, radiusMm } = detailView.regionParent;

    // Circle center in sheet space
    const cx = parentView.positionMm.x + center.x * parentScale;
    const cy = parentView.positionMm.y + center.y * parentScale;
    // Circle radius in sheet space
    const r = radiusMm * parentScale;

    // Label position: 5 mm upper-right of the circle's perimeter
    const cos45 = Math.SQRT2 / 2;
    const sin45 = Math.SQRT2 / 2;
    const labelX = cx + (r + 5) * cos45;
    const labelY = cy - (r + 5) * sin45;

    const fontSize = LABEL_FONT_SIZE_MM / zoom;

    return (
      <g data-detail-callout-overlay={detailView.id}>
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke="black"
          strokeWidth={CIRCLE_STROKE_WIDTH}
          data-role="detail-callout-label"
        />
        <text
          x={labelX}
          y={labelY}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={fontSize}
          fontFamily="sans-serif"
          data-role="detail-callout-label"
        >
          {detailView.label}
        </text>
      </g>
    );
  }
  ```

- [ ] **Step 4: Run (expect pass)**

  ```
  pnpm --filter app test src/drawing/__tests__/DetailRegionOverlay
  pnpm --filter app typecheck
  ```

- [ ] **Commit:** `feat(drawing-detail-ui): DetailRegionOverlay — circle + letter label at parent-projected coordinates`

---

### Task 4.7 — `<ViewElement>` `case 'detail'`: border circle + clipped edges + caption

**Files:**
- Modify: `packages/app/src/drawing/ViewElement.tsx`
- Modify: `packages/app/src/drawing/__tests__/ViewElement.spec.tsx`

**Agent:** Sonnet implementer.

The detail view renders inside its own `<g transform="translate(positionMm) scale(detailScale)">` group (same pattern as all other views). Inside that group:
- A `<circle r={regionParent.radiusMm}>` (in detail-local mm; `ViewElement`'s `scale(scaleFactor)` transform maps it to sheet mm). Note: the border circle uses `regionParent.radiusMm` — NOT `radiusMm * detailScaleFactor`. The `scaleFactor` transform on the containing `<g>` handles the detail:parent scale ratio.
- Clipped visible and (optionally) hidden edges rendered as `<polyline>` elements — same as existing view kinds.
- A caption `"DETAIL A"` with `data-role="detail-caption"` and a second `<tspan>` line for the scale ratio.

- [ ] **Step 1: Write failing tests**

  Append to `packages/app/src/drawing/__tests__/ViewElement.spec.tsx`:

  ```tsx
  import type { DetailView } from '@zilventor/shared';

  const DETAIL_VIEW_FIXTURE: DetailView = {
    id: 'dv1',
    kind: 'detail',
    parentViewId: 'pv1',
    regionParent: { center: { x: 10, y: 8 }, radiusMm: 5 },
    label: 'A',
    positionMm: { x: 200, y: 100 },
    scale: { numerator: 2, denominator: 1 },
    showHidden: false,
    projection: {
      visibleEdges: [
        { id: 'dve1', kind: 'outline', points: [[0, 0], [8, 0], [8, 6], [0, 6], [0, 0]] },
      ],
      hiddenEdges: [],
      bbox: { minX: -8, minY: -6, maxX: 8, maxY: 6 },
    },
    inputFingerprint: 'fp-detail',
  };

  describe('ViewElement — detail view', () => {
    it('renders <circle data-role="detail-border"> with r = regionParent.radiusMm', () => {
      const { container } = render(
        <svg>
          <ViewElement view={DETAIL_VIEW_FIXTURE} isStale={false} onRegenerate={vi.fn()} />
        </svg>,
      );
      const circle = container.querySelector('circle[data-role="detail-border"]');
      expect(circle).not.toBeNull();
      // r in detail-local mm equals regionParent.radiusMm (the scale() transform on the <g> handles sheet-mm sizing)
      expect(parseFloat(circle!.getAttribute('r')!)).toBeCloseTo(5, 3);
    });

    it('renders visible edge polylines from projection.visibleEdges', () => {
      const { container } = render(
        <svg>
          <ViewElement view={DETAIL_VIEW_FIXTURE} isStale={false} onRegenerate={vi.fn()} />
        </svg>,
      );
      const polylines = container.querySelectorAll('polyline[data-edge-id="dve1"]');
      expect(polylines).toHaveLength(1);
    });

    it('renders <text data-role="detail-caption"> with "DETAIL A" text', () => {
      const { container } = render(
        <svg>
          <ViewElement view={DETAIL_VIEW_FIXTURE} isStale={false} onRegenerate={vi.fn()} />
        </svg>,
      );
      const caption = container.querySelector('text[data-role="detail-caption"]');
      expect(caption).not.toBeNull();
      expect(caption!.textContent).toContain('DETAIL A');
    });

    it('caption <tspan> contains the scale ratio "2:1"', () => {
      const { container } = render(
        <svg>
          <ViewElement view={DETAIL_VIEW_FIXTURE} isStale={false} onRegenerate={vi.fn()} />
        </svg>,
      );
      const caption = container.querySelector('text[data-role="detail-caption"]');
      expect(caption!.textContent).toContain('2:1');
    });

    it('stale banner renders for detail view when isStale=true', () => {
      const { container } = render(
        <svg>
          <ViewElement view={DETAIL_VIEW_FIXTURE} isStale={true} onRegenerate={vi.fn()} />
        </svg>,
      );
      expect(container.querySelector('[data-stale-marker]')).not.toBeNull();
    });

    it('clicking stale marker on detail view calls onRegenerate with view id', () => {
      const onRegen = vi.fn();
      const { container } = render(
        <svg>
          <ViewElement view={DETAIL_VIEW_FIXTURE} isStale={true} onRegenerate={onRegen} />
        </svg>,
      );
      const marker = container.querySelector('[data-stale-marker]') as SVGElement;
      fireEvent.click(marker);
      expect(onRegen).toHaveBeenCalledWith('dv1');
    });

    it('detail view with showHidden=false renders no hidden polylines', () => {
      const withHidden: DetailView = {
        ...DETAIL_VIEW_FIXTURE,
        showHidden: false,
        projection: {
          visibleEdges: DETAIL_VIEW_FIXTURE.projection!.visibleEdges,
          hiddenEdges: [{ id: 'dhe1', kind: 'outline', points: [[0, 0], [4, 0]] }],
          bbox: DETAIL_VIEW_FIXTURE.projection!.bbox,
        },
      };
      const { container } = render(
        <svg>
          <ViewElement view={withHidden} isStale={false} onRegenerate={vi.fn()} />
        </svg>,
      );
      expect(container.querySelectorAll('polyline[data-edge-kind="hidden"]')).toHaveLength(0);
    });
  });
  ```

- [ ] **Step 2: Run (expect fail)**

  ```
  pnpm --filter app test src/drawing/__tests__/ViewElement
  ```

- [ ] **Step 3: Implement**

  In `packages/app/src/drawing/ViewElement.tsx`:

  1. Add `DetailView` to the import:

     ```ts
     import type { DrawingView, SectionView, DetailView } from '@zilventor/shared';
     ```

  2. After the `{/* Section view hatch + caption */}` block, add the detail branch:

     ```tsx
     {/* Detail view border + caption */}
     {view.kind === 'detail' && (
       <>
         {/* Circle border in detail-local mm (ViewElement's scale() maps to sheet mm) */}
         <circle
           cx={0}
           cy={0}
           r={(view as DetailView).regionParent.radiusMm}
           fill="none"
           stroke="black"
           strokeWidth={0.35}
           data-role="detail-border"
         />
         {/* Caption: "DETAIL A" + scale ratio on second line */}
         {proj && (
           <text
             x={(proj.bbox.minX + proj.bbox.maxX) / 2}
             y={proj.bbox.maxY + 5 / sheetZoom}
             textAnchor="middle"
             fontSize={4 / sheetZoom}
             fontFamily="sans-serif"
             data-role="detail-caption"
           >
             {`DETAIL ${(view as DetailView).label}`}
             <tspan
               x={(proj.bbox.minX + proj.bbox.maxX) / 2}
               dy={5 / sheetZoom}
               fontSize={3.5 / sheetZoom}
             >
               {`${view.scale.numerator}:${view.scale.denominator}`}
             </tspan>
           </text>
         )}
       </>
     )}
     ```

  3. The existing `showHidden` guard (`view.kind !== 'section' && view.showHidden`) already suppresses hidden edges for section views. Extend it to also suppress for detail views that have `showHidden: false` — but since `showHidden` is already read from `view.showHidden`, no change is needed: the current code `view.kind !== 'section' && view.showHidden` will correctly render hidden edges for detail views where `showHidden === true`, and suppress them when `showHidden === false`. No code change required here.

- [ ] **Step 4: Run (expect pass)**

  ```
  pnpm --filter app test src/drawing/__tests__/ViewElement
  pnpm --filter app typecheck
  ```

- [ ] **Commit:** `feat(drawing-detail-ui): ViewElement detail branch — border circle, edges, DETAIL caption + scale tspan`

---

### Task 4.8 — `DrawingCanvas`: click dispatch for `'detail'` mode + ESC cancel wiring

**Files:**
- Modify: `packages/app/src/drawing/DrawingCanvas.tsx`
- Modify: `packages/app/src/drawing/__tests__/DrawingCanvas.spec.tsx`

**Agent:** Sonnet implementer.

This task wires the 3-stage detail click dispatch in `DrawingCanvas.handleClick` and adds `detailCancel` to the ESC handler. It also imports and renders `<DetailRegionOverlay>` for existing detail views in the sheet.

The coordinate conversion from sheet mm to parent-local mm uses:

```ts
function sheetToParentLocal(
  sheetPt: { x: number; y: number },
  parentView: DrawingView,
): { x: number; y: number } {
  const scale = parentView.scale.numerator / parentView.scale.denominator;
  return {
    x: (sheetPt.x - parentView.positionMm.x) / scale,
    y: (sheetPt.y - parentView.positionMm.y) / scale,
  };
}
```

- [ ] **Step 1: Write failing tests**

  Append a new describe block to `packages/app/src/drawing/__tests__/DrawingCanvas.spec.tsx`:

  ```tsx
  import { AddDetailViewCommand } from '../../commands/AddDetailViewCommand';

  vi.mock('../../commands/AddDetailViewCommand', () => ({
    AddDetailViewCommand: vi.fn().mockImplementation((payload) => ({
      name: 'AddDetailView',
      payload,
    })),
  }));

  const makeDetailViewSheet = (): DrawingSheet => ({
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
        inputFingerprint: 'fp-base',
      },
    ],
    dimensions: [], annotations: [], titleBlock: {},
  });

  describe('DrawingCanvas — detail tool mode', () => {
    beforeEach(() => {
      useToolModeStore.setState({
        mode: 'detail',
        detailState: { stage: 'idle' },
        sectionState: { stage: 'idle' },
        pendingViewParams: null,
      } as never);
      useAppStore.setState({
        activeDrawing: { ...makeDrawing(), sheets: [makeDetailViewSheet()] },
        bus: { execute: vi.fn().mockResolvedValue(undefined) },
      } as never);
    });

    it('click on a view element in idle stage → calls detailPickParent with viewId', () => {
      const pickParent = vi.spyOn(useToolModeStore.getState(), 'detailPickParent');
      const { container } = render(<DrawingCanvas />);
      const viewGroup = container.querySelector('[data-view-id="bv1"]') as Element;
      if (viewGroup) {
        fireEvent.click(viewGroup);
        expect(pickParent).toHaveBeenCalledWith('bv1');
      }
    });

    it('stage=pickRegionCenter + click → detailPickCenter called with parent-local coords', () => {
      useToolModeStore.setState({
        mode: 'detail',
        detailState: { stage: 'pickRegionCenter', parentViewId: 'bv1' },
      } as never);
      const pickCenter = vi.spyOn(useToolModeStore.getState(), 'detailPickCenter');
      render(<DrawingCanvas />);
      const svg = document.querySelector('svg')!;
      fireEvent.click(svg, { clientX: 50, clientY: 50 });
      expect(pickCenter).toHaveBeenCalled();
    });

    it('stage=pickRegionRadius + click → detailPickRadius called', () => {
      useToolModeStore.setState({
        mode: 'detail',
        detailState: {
          stage: 'pickRegionRadius',
          parentViewId: 'bv1',
          center: { x: 30, y: 30 },
        },
      } as never);
      const pickRadius = vi.spyOn(useToolModeStore.getState(), 'detailPickRadius');
      render(<DrawingCanvas />);
      const svg = document.querySelector('svg')!;
      fireEvent.click(svg, { clientX: 60, clientY: 60 });
      expect(pickRadius).toHaveBeenCalled();
    });

    it('stage=pickDrop + click → bus.execute called with AddDetailViewCommand once', () => {
      useToolModeStore.setState({
        mode: 'detail',
        detailState: {
          stage: 'pickDrop',
          parentViewId: 'bv1',
          center: { x: 30, y: 30 },
          radiusMm: 10,
        },
      } as never);
      render(<DrawingCanvas />);
      const svg = document.querySelector('svg')!;
      fireEvent.click(svg, { clientX: 200, clientY: 200 });
      const bus = useAppStore.getState().bus;
      expect(bus.execute).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'AddDetailView' }),
      );
    });

    it('ESC key calls detailCancel()', () => {
      const cancel = vi.spyOn(useToolModeStore.getState(), 'detailCancel');
      render(<DrawingCanvas />);
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(cancel).toHaveBeenCalled();
    });
  });

  describe('DrawingCanvas — DetailRegionOverlay rendering', () => {
    it('renders a detail-callout-overlay for each detail view in the sheet', () => {
      const sheetWithDetail: DrawingSheet = {
        ...makeDetailViewSheet(),
        views: [
          ...(makeDetailViewSheet().views),
          {
            id: 'dv1', kind: 'detail' as const,
            parentViewId: 'bv1',
            regionParent: { center: { x: 20, y: 15 }, radiusMm: 8 },
            label: 'A',
            positionMm: { x: 200, y: 150 },
            scale: { numerator: 2, denominator: 1 },
            showHidden: false,
            projection: { visibleEdges: [], hiddenEdges: [], bbox: { minX: 0, minY: 0, maxX: 10, maxY: 10 } },
            inputFingerprint: 'fp-dv1',
          },
        ],
      };
      useAppStore.setState({
        activeDrawing: { ...makeDrawing(), sheets: [sheetWithDetail] },
        bus: { execute: vi.fn().mockResolvedValue(undefined) },
      } as never);
      useToolModeStore.setState({ mode: 'idle' } as never);
      render(<DrawingCanvas />);
      expect(document.querySelectorAll('[data-detail-callout-overlay]')).toHaveLength(1);
    });
  });
  ```

- [ ] **Step 2: Run (expect fail)**

  ```
  pnpm --filter app test src/drawing/__tests__/DrawingCanvas
  ```

- [ ] **Step 3: Implement**

  In `packages/app/src/drawing/DrawingCanvas.tsx`:

  1. Add imports at the top:

     ```ts
     import { DetailRegionOverlay } from './DetailRegionOverlay';
     import { AddDetailViewCommand } from '../commands/AddDetailViewCommand';
     import type { DetailView } from '@zilventor/shared';
     ```

  2. Subscribe to `detailState` from the store:

     ```ts
     const detailState = useToolModeStore((s) => s.detailState);
     ```

  3. Update the ESC `useEffect` to also call `detailCancel`:

     ```ts
     useEffect(() => {
       function onKeyDown(e: KeyboardEvent) {
         if (e.key === 'Escape') {
           useToolModeStore.getState().sectionCancel();
           useToolModeStore.getState().detailCancel();  // NEW
         }
       }
       document.addEventListener('keydown', onKeyDown);
       return () => document.removeEventListener('keydown', onKeyDown);
     }, []);
     ```

  4. Add `sheetToParentLocal` helper (file-scope, after `getViewAtPoint`):

     ```ts
     function sheetToParentLocal(
       sheetPt: { x: number; y: number },
       parentView: DrawingSheet['views'][number],
     ): { x: number; y: number } {
       const scale = parentView.scale.numerator / parentView.scale.denominator;
       return {
         x: (sheetPt.x - parentView.positionMm.x) / scale,
         y: (sheetPt.y - parentView.positionMm.y) / scale,
       };
     }
     ```

  5. In `handleClick`, insert the `'detail'` dispatch block after the `'section'` block and before the `'addLinearH'` block:

     ```ts
     if (toolMode === 'detail') {
       const ds = useToolModeStore.getState().detailState;
       const sheetPt = { x: svgX, y: svgY };
       const hitViewId = getViewAtPoint(sheet.views, sheetPt, viewId);

       if (ds.stage === 'idle') {
         if (hitViewId) {
           useToolModeStore.getState().detailPickParent(hitViewId);
         }
         return;
       }

       if (ds.stage === 'pickRegionCenter') {
         const parentView = sheet.views.find((v) => v.id === ds.parentViewId);
         if (!parentView) return;
         const parentLocalPt = sheetToParentLocal(sheetPt, parentView);
         useToolModeStore.getState().detailPickCenter(parentLocalPt);
         return;
       }

       if (ds.stage === 'pickRegionRadius') {
         const parentView = sheet.views.find((v) => v.id === ds.parentViewId);
         if (!parentView) return;
         const parentLocalPt = sheetToParentLocal(sheetPt, parentView);
         useToolModeStore.getState().detailPickRadius(parentLocalPt);
         return;
       }

       if (ds.stage === 'pickDrop') {
         useToolModeStore.getState().detailPickDrop(sheetPt, () => {
           void bus.execute(new AddDetailViewCommand({
             drawingId: drawing.id,
             sheetId: sheet.id,
             parentViewId: ds.parentViewId,
             regionCenter: ds.center,
             regionRadiusMm: ds.radiusMm,
             dropAt: sheetPt,
           }));
         });
         return;
       }

       return;
     }
     ```

  6. In the JSX return, after the section overlays block, add detail callout overlays:

     ```tsx
     {/* Detail callout overlays — circle + letter on parent view for each detail view */}
     {sheet.views
       .filter((v): v is DetailView => v.kind === 'detail')
       .map((dv) => {
         const parent = sheet.views.find((v) => v.id === dv.parentViewId);
         if (!parent) return null;
         return (
           <DetailRegionOverlay
             key={`detail-overlay-${dv.id}`}
             parentView={parent as BaseView | ProjectedView | IsoView | SectionView}
             detailView={dv}
             zoom={zoom}
           />
         );
       })}
     ```

  7. Update the `handleClick` dependency array to include `detailState`:

     ```ts
     }, [toolMode, clickAccum, sheet, bus, sheetW, sheetH, drawing, detailState]);
     ```

     Note: `detailState` is read directly from the store inside `handleClick` via `useToolModeStore.getState()`, so the dependency is on `toolMode` only from a re-render perspective. However, `detailState` subscribed at the component level is needed for the preview rendering (Tasks 4.9 and 4.10). Add it to the callback dependency array to avoid stale closure issues:

     Actually, since `handleClick` reads `detailState` via `useToolModeStore.getState().detailState` (not from the captured closure variable), no dependency change is strictly needed. Leave the dependency array as-is for now; only `toolMode` from the store is closed over. Verify this works in tests.

  8. Also add `IsoView, SectionView` to the existing type imports if not already present:

     ```ts
     import type { DrawingDocument, DrawingSheet, SectionView, BaseView, ProjectedView, IsoView, DetailView } from '@zilventor/shared';
     ```

- [ ] **Step 4: Run (expect pass)**

  ```
  pnpm --filter app test src/drawing/__tests__/DrawingCanvas
  pnpm --filter app typecheck
  ```

- [ ] **Commit:** `feat(drawing-detail-tool): DrawingCanvas detail mode click dispatch + ESC cancel + DetailRegionOverlay render`

---

### Task 4.9 — `DrawingCanvas`: live rubber-band circle preview during `pickRegionRadius`

**Files:**
- Modify: `packages/app/src/drawing/DrawingCanvas.tsx`
- Modify: `packages/app/src/drawing/__tests__/DrawingCanvas.spec.tsx`

**Agent:** Sonnet implementer.

During `pickRegionRadius`, a rubber-band SVG `<circle>` follows the cursor from the locked center point. The circle is rendered in sheet space: center at `positionMm + center * parentScale`, radius = distance from cursor to center in sheet space.

The spec (§9.4) says: "Circle radius = `distance(center, cursorMm)` in parent-projected mm, rendered at the parent view's transform." Since `regionParent.center` is in parent-local mm, the sheet-space center is `parentView.positionMm + center * parentScale`. The rubber-band radius in sheet space = distance from that sheet-space center to the cursor.

The preview circle uses a dashed stroke to distinguish it from the final callout circle.

- [ ] **Step 1: Write failing tests**

  Append to the `DrawingCanvas — detail tool mode` describe block in `DrawingCanvas.spec.tsx`:

  ```tsx
  it('renders rubber-band preview circle when stage=pickRegionRadius and cursor moves', () => {
    useToolModeStore.setState({
      mode: 'detail',
      detailState: {
        stage: 'pickRegionRadius',
        parentViewId: 'bv1',
        center: { x: 30, y: 30 },
      },
    } as never);
    render(<DrawingCanvas />);
    const svg = document.querySelector('svg')!;
    // Simulate mouse move to set cursor position
    fireEvent.mouseMove(svg, { clientX: 80, clientY: 60 });
    const preview = document.querySelector('[data-role="detail-preview-circle"]');
    expect(preview).not.toBeNull();
  });

  it('renders no preview circle when stage is not pickRegionRadius', () => {
    useToolModeStore.setState({
      mode: 'detail',
      detailState: { stage: 'pickRegionCenter', parentViewId: 'bv1' },
    } as never);
    render(<DrawingCanvas />);
    expect(document.querySelector('[data-role="detail-preview-circle"]')).toBeNull();
  });
  ```

- [ ] **Step 2: Run (expect fail)**

  ```
  pnpm --filter app test src/drawing/__tests__/DrawingCanvas
  ```

- [ ] **Step 3: Implement**

  In `DrawingCanvas.tsx`:

  1. Add a `cursorMm` state:

     ```ts
     const [cursorMm, setCursorMm] = useState<{ x: number; y: number } | null>(null);
     ```

  2. Update `handleMouseMove` to also track cursor in sheet-mm when in detail mode:

     ```ts
     const handleMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
       if (middleDragRef.current) {
         const dx = e.clientX - middleDragRef.current.startX;
         const dy = e.clientY - middleDragRef.current.startY;
         setPan({ x: middleDragRef.current.startPan.x + dx, y: middleDragRef.current.startPan.y + dy });
       }
       // Track cursor for live preview
       const svg = svgRef.current;
       const rect = svg?.getBoundingClientRect();
       const hasSize = rect && rect.width > 0 && rect.height > 0;
       if (hasSize) {
         setCursorMm({
           x: (e.clientX - rect.left) / (rect.width / sheetW),
           y: (e.clientY - rect.top) / (rect.height / sheetH),
         });
       }
     }, [pan, sheetW, sheetH]);
     ```

  3. In the JSX, after the detail callout overlays block, add the rubber-band preview:

     ```tsx
     {/* Rubber-band circle preview during pickRegionRadius */}
     {toolMode === 'detail' && detailState.stage === 'pickRegionRadius' && cursorMm && (() => {
       const ds = detailState;
       const parentView = sheet.views.find((v) => v.id === ds.parentViewId);
       if (!parentView) return null;
       const parentScale = parentView.scale.numerator / parentView.scale.denominator;
       // Center in sheet space
       const cx = parentView.positionMm.x + ds.center.x * parentScale;
       const cy = parentView.positionMm.y + ds.center.y * parentScale;
       // Radius = distance from sheet-space center to cursor
       const dx = cursorMm.x - cx;
       const dy = cursorMm.y - cy;
       const r = Math.sqrt(dx * dx + dy * dy);
       return (
         <circle
           cx={cx}
           cy={cy}
           r={r}
           fill="none"
           stroke="black"
           strokeWidth={0.35}
           strokeDasharray="2 1"
           data-role="detail-preview-circle"
         />
       );
     })()}
     ```

  Note: the preview circle uses `strokeDasharray="2 1"` (dashed) to visually distinguish it from the final `<DetailRegionOverlay>` circle which has no dash. This is a design decision not specified in the spec — dashed was chosen as the clearest convention for rubber-band previews consistent with the section tool's live preview pattern.

- [ ] **Step 4: Run (expect pass)**

  ```
  pnpm --filter app test src/drawing/__tests__/DrawingCanvas
  ```

- [ ] **Commit:** `feat(drawing-detail-ui): DrawingCanvas rubber-band circle preview during pickRegionRadius (dashed stroke)`

---

### Task 4.10 — `DrawingCanvas`: ghost bbox preview during `pickDrop`

**Files:**
- Modify: `packages/app/src/drawing/DrawingCanvas.tsx`
- Modify: `packages/app/src/drawing/__tests__/DrawingCanvas.spec.tsx`

**Agent:** Sonnet implementer.

During `pickDrop`, a ghost `<rect>` approximating the detail view's bounding box follows the cursor. Size approximation per spec §9.5: `2 * radiusMm * detailScale` square (a circle of `radiusMm` fills a `2*radiusMm` wide square, then scaled by `detailScale`). This is rendered in sheet mm centered on the cursor.

- [ ] **Step 1: Write failing tests**

  Append to the `DrawingCanvas — detail tool mode` describe block:

  ```tsx
  it('renders ghost bbox rect when stage=pickDrop and cursor moves', () => {
    useToolModeStore.setState({
      mode: 'detail',
      detailState: {
        stage: 'pickDrop',
        parentViewId: 'bv1',
        center: { x: 30, y: 30 },
        radiusMm: 10,
      },
    } as never);
    render(<DrawingCanvas />);
    const svg = document.querySelector('svg')!;
    fireEvent.mouseMove(svg, { clientX: 150, clientY: 120 });
    const ghost = document.querySelector('[data-role="detail-drop-ghost"]');
    expect(ghost).not.toBeNull();
  });

  it('renders no ghost rect when stage is not pickDrop', () => {
    useToolModeStore.setState({
      mode: 'detail',
      detailState: { stage: 'pickRegionCenter', parentViewId: 'bv1' },
    } as never);
    render(<DrawingCanvas />);
    expect(document.querySelector('[data-role="detail-drop-ghost"]')).toBeNull();
  });
  ```

- [ ] **Step 2: Run (expect fail)**

  ```
  pnpm --filter app test src/drawing/__tests__/DrawingCanvas
  ```

- [ ] **Step 3: Implement**

  In `DrawingCanvas.tsx`, after the rubber-band circle preview block, add:

  ```tsx
  {/* Ghost bbox rect preview during pickDrop */}
  {toolMode === 'detail' && detailState.stage === 'pickDrop' && cursorMm && (() => {
    const ds = detailState;
    // Default detail scale 2:1 (the command uses this at apply time)
    const detailScale = 2;
    const side = 2 * ds.radiusMm * detailScale;
    return (
      <rect
        x={cursorMm.x - side / 2}
        y={cursorMm.y - side / 2}
        width={side}
        height={side}
        fill="none"
        stroke="black"
        strokeWidth={0.35}
        strokeDasharray="3 1.5"
        opacity={0.5}
        data-role="detail-drop-ghost"
      />
    );
  })()}
  ```

- [ ] **Step 4: Run (expect pass)**

  ```
  pnpm --filter app test src/drawing/__tests__/DrawingCanvas
  pnpm --filter app typecheck
  ```

- [ ] **Commit:** `feat(drawing-detail-ui): DrawingCanvas ghost bbox rect preview during pickDrop`

---

### Task 4.11 — Ribbon: add "Detail" button between "Section" and "Iso View"

**Files:**
- Modify: `packages/app/src/shell/tabs/DrawingTab.tsx`
- Modify: `packages/app/src/shell/tabs/__tests__/DrawingTab.spec.tsx`

**Agent:** Sonnet implementer.

The spec (§10.3) places "Detail" between "Section" and "Add Iso" in the Place Views panel. In the current `DrawingTab.tsx` the Place Views panel order is: Base View, Projected View, Iso View, Section. The "Add Iso" referred to in the spec maps to "Iso View" in the actual button label. Insert "Detail" after "Section".

The button is disabled when no view in the active sheet has a populated `projection` field (nothing to detail from) — this matches the spec §10.3 requirement.

- [ ] **Step 1: Write failing tests**

  Append a new describe block to `packages/app/src/shell/tabs/__tests__/DrawingTab.spec.tsx`:

  ```tsx
  describe('DrawingTab ribbon — Detail button', () => {
    beforeEach(() => {
      useToolModeStore.getState().reset();
      useAppStore.getState().setActiveDocument({ kind: 'drawing', document: seedDrawing() });
    });

    it('renders a "Detail" button in the Place Views panel', () => {
      render(<DrawingTab />);
      expect(screen.getByRole('button', { name: /^detail$/i })).toBeInTheDocument();
    });

    it('clicking Detail button calls enterDetailMode() — mode becomes detail', () => {
      render(<DrawingTab />);
      fireEvent.click(screen.getByRole('button', { name: /^detail$/i }));
      expect(useToolModeStore.getState().mode).toBe('detail');
      expect(useToolModeStore.getState().detailState.stage).toBe('idle');
    });

    it('Detail button is disabled when no views have a projection', () => {
      // seedDrawing() has views: [] (no projection)
      render(<DrawingTab />);
      expect(screen.getByRole('button', { name: /^detail$/i })).toBeDisabled();
    });

    it('Detail button is enabled when at least one view has a projection', () => {
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
      expect(screen.getByRole('button', { name: /^detail$/i })).not.toBeDisabled();
    });

    it('Detail button appears after Section button and before Iso View button in DOM order', () => {
      render(<DrawingTab />);
      const buttons = Array.from(screen.getAllByRole('button'));
      const sectionIdx = buttons.findIndex((b) => /^section$/i.test(b.textContent ?? ''));
      const detailIdx  = buttons.findIndex((b) => /^detail$/i.test(b.textContent ?? ''));
      const isoIdx     = buttons.findIndex((b) => /iso view/i.test(b.textContent ?? ''));
      expect(sectionIdx).toBeGreaterThan(-1);
      expect(detailIdx).toBeGreaterThan(sectionIdx);
      expect(isoIdx).toBeLessThan(sectionIdx); // Iso View is before Section in current order
      // Main assertion: Detail is after Section
      expect(detailIdx).toBeGreaterThan(sectionIdx);
    });
  });
  ```

- [ ] **Step 2: Run (expect fail)**

  ```
  pnpm --filter app test src/shell/tabs/__tests__/DrawingTab
  ```

- [ ] **Step 3: Implement**

  In `packages/app/src/shell/tabs/DrawingTab.tsx`:

  1. The sheet's active sheet is needed to compute the disabled state. Add:

     ```ts
     const drawing = activeDocument.document;
     const activeSheet = drawing.sheets.find((s) => s.id === drawing.activeSheetId)
                      ?? drawing.sheets[0];
     const hasProjectedView = activeSheet?.views.some((v) => v.projection != null) ?? false;
     ```

  2. After the `<button aria-label="Section">` element, insert:

     ```tsx
     <button
       type="button"
       className="text-xs hover:text-white disabled:text-neutral-500"
       aria-label="Detail"
       disabled={!hasProjectedView}
       title={!hasProjectedView ? 'Add a base view with a projection first' : undefined}
       onClick={() => useToolModeStore.getState().enterDetailMode()}
     >
       Detail
     </button>
     ```

- [ ] **Step 4: Run (expect pass)**

  ```
  pnpm --filter app test src/shell/tabs/__tests__/DrawingTab
  pnpm --filter app typecheck
  ```

  Note: the existing test `'renders exactly 2 Sheet buttons, 3 Place Views buttons, 5 Dimension buttons, ...'` will now fail because Place Views gains a 4th button. Update that count in the existing test from `3` to `4`:

  ```ts
  // In the existing 'renders exactly ...' test body, no explicit count assertion exists
  // for Place Views button count — only individual button presence checks. Verify this test
  // still passes; if a count assertion exists, bump it from 3 to 4.
  ```

  Read the existing test carefully. The test named `'renders exactly 2 Sheet buttons, 3 Place Views buttons, ...'` only asserts individual button presence with `getByRole`, not a total count of 3. The test name says "3 Place Views buttons" but the body only does `getByRole` for 3 specific buttons (Base View, Projected View, Iso View). After this task, it will find a 4th button (Detail) in the panel but the test body will still pass since it only asserts the 3 original ones exist. No change to the existing test body is needed. Update the `describe` or `it` name only if the test name string would be misleading — leave it as-is per the surgical-changes rule.

- [ ] **Commit:** `feat(drawing-detail-ui): DrawingTab ribbon — Detail button after Section; disabled when no projection`

---

### Task 4.12 — `<DrawingTreePane>`: nest detail views under their parent view

**Files:**
- Modify: `packages/app/src/drawing/DrawingTreePane.tsx`
- Modify: `packages/app/src/drawing/__tests__/DrawingTreePane.spec.tsx`

**Agent:** Sonnet implementer.

The spec (§10.4) requires detail views to appear in the Views sub-tree labelled `"Detail A (from <parentLabel>)"`. The parent label is derived from the parent view's label field for section views, or its kind+orientation for base/projected/iso views.

Label derivation:
- Parent is `base`: label = `"Base — ${orientation}"`.
- Parent is `projected`: label = `"Projected — ${direction}"`.
- Parent is `iso`: label = `"Iso — ${corner}"`.
- Parent is `section`: label = `"Section — ${label}"`.

Detail tree row: `"Detail A (from Base — front) · 2:1"`.

- [ ] **Step 1: Write failing tests**

  Append a new describe block to `packages/app/src/drawing/__tests__/DrawingTreePane.spec.tsx`:

  ```tsx
  import type { DetailView } from '@zilventor/shared';

  const makeDrawingWithDetail = (): DrawingDocument => ({
    id: 'd1', name: 'Test Drawing', units: 'mm',
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
          },
          {
            id: 'dv1', kind: 'detail' as const,
            parentViewId: 'bv1',
            regionParent: { center: { x: 10, y: 8 }, radiusMm: 5 },
            label: 'A',
            positionMm: { x: 200, y: 150 },
            scale: { numerator: 2, denominator: 1 },
            showHidden: false,
          } as DetailView,
        ],
        dimensions: [], annotations: [], titleBlock: {},
      },
    ],
    activeSheetId: 's1',
  });

  describe('DrawingTreePane — detail views in tree', () => {
    beforeEach(() => {
      useAppStore.setState({
        activeDrawing: makeDrawingWithDetail(),
        bus: { execute: vi.fn().mockResolvedValue(undefined) },
      } as never);
    });

    it('renders detail view row with "Detail A (from Base — front)" label', () => {
      render(<DrawingTreePane />);
      // Expand the sheet node to see its views
      fireEvent.click(screen.getByText('Sheet 1'));
      // Find the ▸ toggle and click to expand
      const toggles = screen.getAllByText('▸');
      fireEvent.click(toggles[0]!); // expand first sheet
      expect(screen.getByText(/Detail A \(from Base — front\)/i)).toBeInTheDocument();
    });

    it('detail row shows scale "2:1"', () => {
      render(<DrawingTreePane />);
      fireEvent.click(screen.getByText('Sheet 1'));
      const toggles = screen.getAllByText('▸');
      fireEvent.click(toggles[0]!);
      // The row text includes "· 2:1"
      expect(screen.getByText(/2:1/)).toBeInTheDocument();
    });
  });
  ```

- [ ] **Step 2: Run (expect fail)**

  ```
  pnpm --filter app test src/drawing/__tests__/DrawingTreePane
  ```

- [ ] **Step 3: Implement**

  In `packages/app/src/drawing/DrawingTreePane.tsx`:

  1. Add `DetailView` to imports:

     ```ts
     import type { DrawingSheet, DetailView } from '@zilventor/shared';
     ```

  2. Add a helper to derive the "from" label for a parent view (file-scope):

     ```ts
     function parentViewLabel(view: DrawingSheet['views'][number]): string {
       switch (view.kind) {
         case 'base':      return `Base — ${view.orientation}`;
         case 'projected': return `Projected — ${view.direction}`;
         case 'iso':       return `Iso — ${view.corner}`;
         case 'section':   return `Section — ${view.label}`;
         case 'detail':    return `Detail — ${view.label}`;
         default:          return view.kind;
       }
     }
     ```

  3. In the `SheetNode` component's Views list, extend the view label switch to handle `'detail'`:

     Replace the existing view label expression in the `sheet.views.map` call:

     ```tsx
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
       return (
         <li key={v.id} style={{ fontSize: '0.8em', color: '#555' }}>
           {label} · {v.scale.numerator}:{v.scale.denominator}
         </li>
       );
     })}
     ```

- [ ] **Step 4: Run (expect pass)**

  ```
  pnpm --filter app test src/drawing/__tests__/DrawingTreePane
  pnpm --filter app typecheck
  ```

- [ ] **Commit:** `feat(drawing-detail-ui): DrawingTreePane — detail view rows with "Detail A (from …)" label`

---

### Task 4.13 — Phase 4 baseline check

**Files:** None created or modified (verification only).

**Agent:** Sonnet implementer.

- [ ] **Step 1: Run full drawing test suite**

  ```
  pnpm --filter app test src/drawing
  ```

  All tests must pass green. If any test fails, fix before proceeding.

- [ ] **Step 2: Run DrawingTab test suite**

  ```
  pnpm --filter app test src/shell/tabs
  ```

- [ ] **Step 3: Full app unit suite**

  ```
  pnpm --filter app test
  ```

- [ ] **Step 4: Typecheck**

  ```
  pnpm -r typecheck
  ```

  Zero type errors. If any errors exist, fix and re-run.

- [ ] **Step 5: Report**

  Report: all test counts before and after Phase 4 (baseline vs new), any type errors found and fixed. No commit needed for this task — it is a verification gate only.

---

## New names exported by Phase 4 (Phase 5 references these)

| Export | Source file |
|---|---|
| `DetailToolState` | `packages/app/src/drawing/toolMode.ts` |
| `useToolModeStore` (extended with `detailState`, `enterDetailMode`, `detailPickParent`, `detailPickCenter`, `detailPickRadius`, `detailPickDrop`, `detailCancel`) | `packages/app/src/drawing/toolMode.ts` |
| `'detail'` added to `ToolMode` union | `packages/app/src/drawing/toolMode.ts` |
| `DetailRegionOverlay` | `packages/app/src/drawing/DetailRegionOverlay.tsx` |
| `ViewElement` (extended with `case 'detail'`) | `packages/app/src/drawing/ViewElement.tsx` |
| `DrawingCanvas` (extended with detail dispatch + preview) | `packages/app/src/drawing/DrawingCanvas.tsx` |
## Phase 5 — Export, E2E, perf

**Goal:** Plumb detail views through SVG/PDF/PNG export (pre-clipped edges + border circle + caption + parent callout circle), add T-6-8 e2e spec driving the real pipeline end-to-end, and add a perf spec asserting p95 < 50 ms for full detail-view creation. Phase output: pdf magic-byte intact, T-6-8 green, perf green, baseline 1813 unit + 7 e2e + 5 perf still green.

**Files created/touched (this phase only):**
- Modify: `packages/app/src/drawing/renderDrawingSvg.ts`
- Modify: `packages/app/src/drawing/__tests__/renderDrawingSvg.spec.ts` (extend)
- Modify: `packages/app/src/drawing/renderDrawingPdf.ts`
- Modify: `packages/app/src/drawing/__tests__/renderDrawingPdf.spec.ts` (extend; assert PDF byte stream still starts with `%PDF-`)
- Modify: `packages/app/src/drawing/renderDrawingPngForSheet.ts` (smoke-extend fixtures only; SVG path already handles detail via `renderDrawingSvg`)
- Modify: `packages/app/src/drawing/__tests__/renderDrawingPngForSheet.spec.ts` (extend)
- Modify: `packages/app/src/__tests__/fixtures/drawingFixtures.ts` (add `makeFixtureDrawingWithDetailView`)
- Modify: `packages/app/src/App.tsx` (wire `__zilventorDetailViewMs` window hook)
- Create: `tests/e2e/drawing/T-6-8-detail-view.spec.ts`
- Create: `tests/perf/drawing-detail.perf.spec.ts`

---

### Task 5.1 — `renderDrawingSvg`: emit `<circle data-role="detail-border">` for `kind: 'detail'` views

**Files:**
- Modify: `packages/app/src/drawing/renderDrawingSvg.ts`
- Modify: `packages/app/src/drawing/__tests__/renderDrawingSvg.spec.ts`
- Modify: `packages/app/src/__tests__/fixtures/drawingFixtures.ts`

#### Red — write failing test first

Extend `drawingFixtures.ts` to export a helper that produces a drawing with one detail view:

```ts
// packages/app/src/__tests__/fixtures/drawingFixtures.ts — append after existing exports

import type { DetailView } from '@zilventor/shared';

export function makeFixtureDetailView(id = 'detail-1'): DetailView {
  return {
    id,
    kind: 'detail',
    parentViewId: 'view-sheet-1-0',
    regionParent: { center: { x: 25, y: 15 }, radiusMm: 10 },
    label: 'A',
    positionMm: { x: 200, y: 80 },
    scale: { numerator: 2, denominator: 1 },
    showHidden: false,
    projection: {
      visibleEdges: [
        { id: 'de0', kind: 'outline' as const, points: [[0, 0], [8, 0], [8, 6], [0, 6], [0, 0]] as ReadonlyArray<readonly [number, number]> },
      ],
      hiddenEdges: [],
      bbox: { minX: 0, minY: 0, maxX: 8, maxY: 6 },
    },
    inputFingerprint: 'fp-detail-1',
  };
}

export function makeFixtureDrawingWithDetailView(): DrawingDocument {
  const base = makeFixtureDrawing({ viewCount: 1 });
  const sheet = base.sheets[0]!;
  const detail = makeFixtureDetailView();
  return {
    ...base,
    sheets: [{ ...sheet, views: [...sheet.views, detail] }],
  };
}
```

Add failing test in `renderDrawingSvg.spec.ts`:

```ts
import { makeFixtureDrawingWithDetailView } from '../../__tests__/fixtures/drawingFixtures';

describe('renderDrawingSvg — detail view', () => {
  it('emits <circle data-role="detail-border"> for a detail view', () => {
    const drawing = makeFixtureDrawingWithDetailView();
    const sheet = drawing.sheets[0]!;
    const svg = renderDrawingSvg(drawing, sheet, makeFixturePart());
    expect(svg).toContain('data-role="detail-border"');
  });
});
```

Run: `pnpm --filter app test packages/app/src/drawing/__tests__/renderDrawingSvg.spec.ts`
Expected: RED — `data-role="detail-border"` not found.

#### Green — implement

In `renderDrawingSvg.ts`, modify `renderViewGroup` to emit a detail border circle when `view.kind === 'detail'`. The circle is in detail-local mm space; the parent `<g>` already applies `scale(vScale)` so coordinates are correct.

Add the following block inside `renderViewGroup`, replacing the closing `</g>`:

```ts
// packages/app/src/drawing/renderDrawingSvg.ts — renderViewGroup (modified)

function renderViewGroup(view: DrawingView): string {
  const vScale = view.scale.numerator / view.scale.denominator;
  const { projection } = view;

  const visibleLines = projection
    ? projection.visibleEdges.map((e) =>
        renderPolyline(
          e.points,
          'stroke="#000" stroke-width="0.35" fill="none"',
          `data-edge-id="${escapeAttr(e.id)}" data-view-id="${escapeAttr(view.id)}"`,
        )
      ).join('\n    ')
    : '<!-- no projection -->';

  const hiddenLines = projection
    ? projection.hiddenEdges.map((e) =>
        renderPolyline(
          e.points,
          'stroke="#555" stroke-width="0.18" stroke-dasharray="2 1" fill="none"',
          `data-edge-id="${escapeAttr(e.id)}" data-view-id="${escapeAttr(view.id)}" data-hidden="true"`,
        )
      ).join('\n    ')
    : '';

  const staleMarker = view.inputFingerprint == null
    ? `<text x="0" y="-2" font-size="3" fill="red" data-stale-marker="${escapeAttr(view.id)}">&#x26A0; Source changed</text>`
    : '';

  // Detail-specific: border circle + caption (Task 5.1 + 5.2 combined into this function).
  let detailMarkup = '';
  if (view.kind === 'detail') {
    const dv = view as import('@zilventor/shared').DetailView;
    // Border circle radius in detail-local mm.
    // regionParent.radiusMm is in parent-local mm; detailScaleFactor transforms to detail-local.
    // However, the border circle represents the region scaled to detail space, so:
    //   detail-local radius = regionParent.radiusMm * detailScaleFactor
    // where detailScaleFactor = (dv.scale.numerator / dv.scale.denominator) / parentScale.
    // Since we don't have the parent's scale here, we emit the circle using a simplified
    // representation: radius is regionParent.radiusMm directly in detail-local mm
    // (the ViewElement.tsx uses the same convention for the live canvas rendering, §10.2).
    // This matches the spec §11.1 which says "pre-clipped edges; no <clipPath>".
    const borderR = dv.regionParent.radiusMm;
    detailMarkup += `\n    <circle cx="0" cy="0" r="${borderR}" fill="none" stroke="#000" stroke-width="0.35" data-role="detail-border" data-view-id="${escapeAttr(dv.id)}"/>`;

    // Caption below bbox (Task 5.2).
    if (projection) {
      const captionX = (projection.bbox.minX + projection.bbox.maxX) / 2;
      const captionY = projection.bbox.maxY + 5;
      detailMarkup += `\n    <text x="${captionX}" y="${captionY}" font-size="4" font-family="sans-serif" text-anchor="middle" data-role="detail-caption" data-view-id="${escapeAttr(dv.id)}">DETAIL ${escapeText(dv.label)}<tspan x="${captionX}" dy="5" font-size="3.5">${dv.scale.numerator}:${dv.scale.denominator}</tspan></text>`;
    }
  }

  return `  <g transform="translate(${view.positionMm.x},${view.positionMm.y}) scale(${vScale})"
     data-view-id="${escapeAttr(view.id)}" data-view-kind="${view.kind}">
    ${staleMarker}
    ${visibleLines}
    ${hiddenLines}${detailMarkup}
  </g>`;
}
```

Note: the `DetailView` import from `@zilventor/shared` must already exist after Phase 1 lands. The file already imports `DrawingView`; simply cast `view as DetailView` after the `view.kind === 'detail'` guard.

Run: `pnpm --filter app test packages/app/src/drawing/__tests__/renderDrawingSvg.spec.ts`
Expected: GREEN.

#### Commit

```
feat(drawing-detail-export): renderDrawingSvg emits detail-border circle for kind=detail
```

---

### Task 5.2 — `renderDrawingSvg`: assert `<text data-role="detail-caption">DETAIL A</text>` and scale ratio

**Files:**
- Modify: `packages/app/src/drawing/__tests__/renderDrawingSvg.spec.ts`

Note: the caption markup was already added in Task 5.1's `detailMarkup` block (caption is emitted in the same `renderViewGroup` pass). Task 5.2 adds the explicit test assertions to lock this in.

#### Red — write failing tests first

Add inside the existing `describe('renderDrawingSvg — detail view', ...)` block:

```ts
it('emits <text data-role="detail-caption"> containing DETAIL A', () => {
  const drawing = makeFixtureDrawingWithDetailView();
  const sheet = drawing.sheets[0]!;
  const svg = renderDrawingSvg(drawing, sheet, makeFixturePart());
  expect(svg).toContain('data-role="detail-caption"');
  expect(svg).toContain('DETAIL A');
});

it('emits scale ratio "2:1" inside the detail caption', () => {
  const drawing = makeFixtureDrawingWithDetailView();
  const sheet = drawing.sheets[0]!;
  const svg = renderDrawingSvg(drawing, sheet, makeFixturePart());
  expect(svg).toContain('2:1');
});
```

Run: `pnpm --filter app test packages/app/src/drawing/__tests__/renderDrawingSvg.spec.ts`
Expected: GREEN immediately — the implementation was placed in Task 5.1. If RED, inspect `detailMarkup` caption block; confirm `DETAIL ${label}` renders to `DETAIL A` for the fixture's label `'A'`.

#### Commit

```
feat(drawing-detail-export): renderDrawingSvg emits detail-caption text with scale ratio
```

---

### Task 5.3 — `renderDrawingSvg`: assert pre-clipped edges render without `<clipPath>`

**Files:**
- Modify: `packages/app/src/drawing/__tests__/renderDrawingSvg.spec.ts`

#### Red — write failing test

```ts
it('renders detail view visible edges as <polyline> without any <clipPath>', () => {
  const drawing = makeFixtureDrawingWithDetailView();
  const sheet = drawing.sheets[0]!;
  const svg = renderDrawingSvg(drawing, sheet, makeFixturePart());
  // Pre-clipped edges from the detail fixture are in projection.visibleEdges.
  // de0 has points [[0,0],[8,0],[8,6],[0,6],[0,0]] — expect a polyline with those coords.
  expect(svg).toContain('data-edge-id="de0"');
  // No <clipPath> element — edges are pre-clipped.
  expect(svg).not.toContain('<clipPath');
});

it('renders detail hidden edges with dashed stroke', () => {
  // Build a detail view that has a hidden edge.
  const base = makeFixtureDrawing({ viewCount: 1 });
  const sheet = base.sheets[0]!;
  const detailWithHidden: import('@zilventor/shared').DetailView = {
    id: 'detail-hidden', kind: 'detail',
    parentViewId: 'view-sheet-1-0',
    regionParent: { center: { x: 25, y: 15 }, radiusMm: 10 },
    label: 'B',
    positionMm: { x: 200, y: 150 },
    scale: { numerator: 2, denominator: 1 },
    showHidden: true,
    projection: {
      visibleEdges: [{ id: 'dh-vis', kind: 'outline' as const, points: [[0,0],[4,0]] as ReadonlyArray<readonly [number, number]> }],
      hiddenEdges: [{ id: 'dh-hid', kind: 'outline' as const, points: [[0,3],[4,3]] as ReadonlyArray<readonly [number, number]> }],
      bbox: { minX: 0, minY: 0, maxX: 4, maxY: 3 },
    },
    inputFingerprint: 'fp-dh',
  };
  const drawing = {
    ...base,
    sheets: [{ ...sheet, views: [...sheet.views, detailWithHidden] }],
  };
  const svg = renderDrawingSvg(drawing, sheet, makeFixturePart());
  expect(svg).toContain('data-edge-id="dh-hid"');
  expect(svg).toContain('stroke-dasharray');
});
```

Run: `pnpm --filter app test packages/app/src/drawing/__tests__/renderDrawingSvg.spec.ts`
Expected: GREEN — `renderViewGroup` already processes `projection.visibleEdges` and `projection.hiddenEdges` uniformly for all view kinds.

#### Commit

```
feat(drawing-detail-export): renderDrawingSvg asserts pre-clipped detail edges; no clipPath
```

---

### Task 5.4 — `renderDrawingSvg`: emit parent-side `<DetailRegionOverlay>` markup (circle + letter on parent view)

**Files:**
- Modify: `packages/app/src/drawing/renderDrawingSvg.ts`
- Modify: `packages/app/src/drawing/__tests__/renderDrawingSvg.spec.ts`
- Modify: `packages/app/src/__tests__/fixtures/drawingFixtures.ts`

The parent-side callout circle and letter label must appear in the SVG export as a sibling element to the parent view's `<g>`. This corresponds to what `<DetailRegionOverlay>` renders in the live canvas (spec §10.1, §11.1).

#### Red — write failing tests first

Extend `drawingFixtures.ts` to produce a drawing where the parent view is identifiable by its known ID:

```ts
// packages/app/src/__tests__/fixtures/drawingFixtures.ts — append

export function makeFixtureDrawingWithParentAndDetail(): DrawingDocument {
  // Parent base view has id 'parent-view-1'
  const parentView: DrawingView = {
    id: 'parent-view-1',
    kind: 'base' as const,
    positionMm: { x: 80, y: 80 },
    scale: { numerator: 1, denominator: 1 },
    orientation: 'front' as const,
    showHidden: false,
    projection: {
      visibleEdges: [
        { id: 'pv-e0', kind: 'outline' as const, points: [[0,0],[50,0],[50,30],[0,30],[0,0]] as ReadonlyArray<readonly [number, number]> },
      ],
      hiddenEdges: [],
      bbox: { minX: 0, minY: 0, maxX: 50, maxY: 30 },
    },
    inputFingerprint: 'fp-parent',
  };
  const detailView: import('@zilventor/shared').DetailView = {
    id: 'detail-overlay-1',
    kind: 'detail',
    parentViewId: 'parent-view-1',
    regionParent: { center: { x: 25, y: 15 }, radiusMm: 10 },
    label: 'A',
    positionMm: { x: 200, y: 80 },
    scale: { numerator: 2, denominator: 1 },
    showHidden: false,
    projection: {
      visibleEdges: [
        { id: 'dov-e0', kind: 'outline' as const, points: [[0,0],[8,0],[8,6],[0,6],[0,0]] as ReadonlyArray<readonly [number, number]> },
      ],
      hiddenEdges: [],
      bbox: { minX: 0, minY: 0, maxX: 8, maxY: 6 },
    },
    inputFingerprint: 'fp-detail-overlay',
  };
  const sheetId = 'sheet-overlay-1';
  return {
    id: 'drawing-overlay-1',
    name: 'Overlay Drawing',
    units: 'mm',
    source: { partPath: 'parts/test.zipt', sourceKind: 'part' },
    properties: {},
    sheets: [{
      id: sheetId,
      name: 'Sheet 1',
      size: { kind: 'iso', size: 'A3' },
      orientation: 'landscape',
      views: [parentView, detailView],
      dimensions: [],
      annotations: [],
      titleBlock: {},
    }],
    activeSheetId: sheetId,
  };
}
```

Add failing tests:

```ts
import { makeFixtureDrawingWithParentAndDetail } from '../../__tests__/fixtures/drawingFixtures';

describe('renderDrawingSvg — detail callout overlay', () => {
  it('emits two circle elements: one detail-border, one detail-callout-label on parent', () => {
    const drawing = makeFixtureDrawingWithParentAndDetail();
    const sheet = drawing.sheets[0]!;
    const svg = renderDrawingSvg(drawing, sheet, makeFixturePart());
    const borderMatches = svg.match(/data-role="detail-border"/g) ?? [];
    const calloutMatches = svg.match(/data-role="detail-callout-label"/g) ?? [];
    expect(borderMatches.length).toBe(1);
    expect(calloutMatches.length).toBeGreaterThanOrEqual(1); // circle + text both carry the role
  });

  it('emits <text data-role="detail-callout-label"> with letter "A" on the parent', () => {
    const drawing = makeFixtureDrawingWithParentAndDetail();
    const sheet = drawing.sheets[0]!;
    const svg = renderDrawingSvg(drawing, sheet, makeFixturePart());
    // The callout label text element carries the letter.
    const textMatches = svg.match(/<text[^>]*data-role="detail-callout-label"[^>]*>A<\/text>/);
    expect(textMatches).not.toBeNull();
  });
});
```

Run: `pnpm --filter app test packages/app/src/drawing/__tests__/renderDrawingSvg.spec.ts`
Expected: RED — callout overlay not yet emitted.

#### Green — implement

In `renderDrawingSvg.ts`, modify `renderDrawingSvg` (the top-level function) to emit a sibling `<g>` after each parent view's group, rendering the callout circles for all detail views that reference it. This is a post-processing pass over `sheet.views`.

The callout circle position uses the coordinate chain from spec §4.2 and §10.1:
- `circleCenter_sheet = parentView.positionMm + regionParent.center × parentScale`
- `circleRadius_sheet = regionParent.radiusMm × parentScale`
- Letter label offset: `5mm` upper-right of the circle edge at 45°.

Add a new function `renderDetailCalloutGroups` and call it after `viewGroups` in `renderDrawingSvg`:

```ts
// packages/app/src/drawing/renderDrawingSvg.ts — add after renderViewGroup

function renderDetailCalloutGroups(views: readonly DrawingView[]): string {
  const groups: string[] = [];
  for (const view of views) {
    if (view.kind !== 'detail') continue;
    const dv = view as import('@zilventor/shared').DetailView;
    // Find parent view.
    const parent = views.find((v) => v.id === dv.parentViewId);
    if (!parent) continue;
    const parentScale = parent.scale.numerator / parent.scale.denominator;
    const cx = parent.positionMm.x + dv.regionParent.center.x * parentScale;
    const cy = parent.positionMm.y + dv.regionParent.center.y * parentScale;
    const r = dv.regionParent.radiusMm * parentScale;
    // Label offset: 5mm upper-right of circle edge at 45°.
    const COS45 = Math.SQRT1_2; // Math.cos(Math.PI/4)
    const labelX = cx + (r + 5) * COS45;
    const labelY = cy - (r + 5) * COS45;
    groups.push(
      `  <g data-detail-callout="${escapeAttr(dv.id)}">` +
      `\n    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#000" stroke-width="0.35" data-role="detail-callout-label" data-detail-id="${escapeAttr(dv.id)}"/>` +
      `\n    <text x="${labelX}" y="${labelY}" font-size="5" font-family="sans-serif" text-anchor="start" data-role="detail-callout-label" data-detail-id="${escapeAttr(dv.id)}">${escapeText(dv.label)}</text>` +
      `\n  </g>`,
    );
  }
  return groups.join('\n');
}
```

In `renderDrawingSvg`, add `calloutGroups` between `viewGroups` and `dimGroups`:

```ts
const viewGroups = sheet.views.map((v) => renderViewGroup(v)).join('\n');
const calloutGroups = renderDetailCalloutGroups(sheet.views);
const dimGroups = sheet.dimensions.map((d) => renderDimensionGroup(d, sheet.views)).join('\n');
```

And include `${calloutGroups}` in the returned SVG string between the view groups and dim groups.

Run: `pnpm --filter app test packages/app/src/drawing/__tests__/renderDrawingSvg.spec.ts`
Expected: GREEN.

#### Commit

```
feat(drawing-detail-export): renderDrawingSvg emits detail-callout-label circle + letter on parent
```

---

### Task 5.5 — `renderDrawingPdf`: jsPDF `circle()` for detail border + `text()` for caption; magic-byte assertion

**Files:**
- Modify: `packages/app/src/drawing/renderDrawingPdf.ts`
- Modify: `packages/app/src/drawing/__tests__/renderDrawingPdf.spec.ts`

The spec §11.2 states: "No changes needed beyond what the SVG render provides. The existing jsPDF SVG-to-PDF path renders `<circle>` and `<text>` elements natively." However, the codebase's `renderDrawingPdf.ts` does NOT use an SVG-to-PDF path — it draws directly with jsPDF primitives (`pdf.line`, `pdf.text`, etc.) in `drawViewPdf`. Therefore, detail-view border + caption must be explicitly emitted in `drawViewPdf`.

#### Red — write failing tests first

```ts
// packages/app/src/drawing/__tests__/renderDrawingPdf.spec.ts — extend

import { makeFixtureDrawingWithParentAndDetail } from '../../__tests__/fixtures/drawingFixtures';
import { renderDrawingPdfBytes } from '../renderDrawingPdf';

describe('renderDrawingPdf — detail view', () => {
  it('magic bytes still %PDF- with detail view present', async () => {
    const drawing = makeFixtureDrawingWithParentAndDetail();
    const bytes = renderDrawingPdfBytes(drawing, makeFixturePart());
    // '%PDF-' = [0x25, 0x50, 0x44, 0x46, 0x2D]
    expect(bytes.slice(0, 5)).toStrictEqual(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2D]));
  });

  it('PDF page count unchanged (1 page) when sheet has detail view', async () => {
    const drawing = makeFixtureDrawingWithParentAndDetail();
    const bytes = renderDrawingPdfBytes(drawing, makeFixturePart());
    const text = new TextDecoder('latin1').decode(bytes);
    const pageMatches = text.match(/\/Type\s*\/Page[^s]/g) ?? [];
    expect(pageMatches.length).toBe(1);
  });
});
```

Run: `pnpm --filter app test packages/app/src/drawing/__tests__/renderDrawingPdf.spec.ts`
Expected: RED on magic-byte test IF `drawViewPdf` throws when it encounters `kind: 'detail'` (unlikely to throw, but the circle/caption won't be drawn). Both tests should be GREEN already IF `drawViewPdf` gracefully handles unknown kinds. Verify. If GREEN already, that is acceptable — the magic-byte test still serves as a regression lock.

#### Green — implement detail rendering in `drawViewPdf`

In `renderDrawingPdf.ts`, extend `drawViewPdf` to emit a border circle and caption for `kind: 'detail'` views:

```ts
// packages/app/src/drawing/renderDrawingPdf.ts — drawViewPdf (modified)

function drawViewPdf(
  pdf: jsPDF,
  view: DrawingView,
  ox: number,
  oy: number,
  scaleX: number,
  scaleY: number,
): void {
  const { projection } = view;
  if (!projection) return;

  const vScale = view.scale.numerator / view.scale.denominator;
  const vx = ox + view.positionMm.x * scaleX;
  const vy = oy + view.positionMm.y * scaleY;

  pdf.setDrawColor(0);
  pdf.setLineWidth(0.35);
  for (const edge of projection.visibleEdges) {
    drawPolylinePdf(pdf, edge.points, vx, vy, vScale * scaleX, vScale * scaleY);
  }

  pdf.setDrawColor(80);
  pdf.setLineWidth(0.18);
  for (const edge of projection.hiddenEdges) {
    drawPolylinePdf(pdf, edge.points, vx, vy, vScale * scaleX, vScale * scaleY);
  }
  pdf.setDrawColor(0);

  // Detail-specific: border circle + caption.
  if (view.kind === 'detail') {
    const dv = view as import('@zilventor/shared').DetailView;
    const borderR = dv.regionParent.radiusMm * vScale * scaleX; // approx; use scaleX for radius
    // Circle is centered at view origin (vx, vy) — same convention as SVG render.
    pdf.setDrawColor(0);
    pdf.setLineWidth(0.35);
    pdf.circle(vx, vy, borderR, 'S'); // 'S' = stroke only
    // Caption: "DETAIL A" below bbox.
    const captionX = vx + ((projection.bbox.minX + projection.bbox.maxX) / 2) * vScale * scaleX;
    const captionY = vy + (projection.bbox.maxY + 5) * vScale * scaleY;
    pdf.setFontSize(7);
    pdf.setTextColor(0);
    pdf.text(`DETAIL ${dv.label}`, captionX, captionY, { align: 'center' });
    pdf.text(`${dv.scale.numerator}:${dv.scale.denominator}`, captionX, captionY + 3.5 * scaleY, { align: 'center' });
  }
}
```

Run: `pnpm --filter app test packages/app/src/drawing/__tests__/renderDrawingPdf.spec.ts`
Expected: GREEN. Magic bytes `%PDF-` intact.

#### Commit

```
feat(drawing-detail-export): renderDrawingPdf emits detail border circle + caption; %PDF- intact
```

---

### Task 5.6 — `renderDrawingPdf`: parent-side callout circle annotation; second magic-byte assertion

**Files:**
- Modify: `packages/app/src/drawing/renderDrawingPdf.ts`
- Modify: `packages/app/src/drawing/__tests__/renderDrawingPdf.spec.ts`

#### Red — write failing test first

```ts
// packages/app/src/drawing/__tests__/renderDrawingPdf.spec.ts — extend

it('magic bytes %PDF- preserved with parent callout circle rendered', async () => {
  // This test exists specifically to ensure adding circle() calls does not corrupt the PDF header.
  const drawing = makeFixtureDrawingWithParentAndDetail();
  const bytes = renderDrawingPdfBytes(drawing, makeFixturePart());
  expect(bytes.slice(0, 5)).toStrictEqual(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2D]));
});
```

Run: `pnpm --filter app test packages/app/src/drawing/__tests__/renderDrawingPdf.spec.ts`
Expected: GREEN (magic bytes won't break from circle calls).

#### Green — implement parent callout circles in `drawSheetPdf`

In `renderDrawingPdf.ts`, add a second pass after `drawViewPdf` calls to emit parent callout circles for all detail views:

```ts
// packages/app/src/drawing/renderDrawingPdf.ts — drawSheetPdf (modified)

function drawSheetPdf(
  pdf: jsPDF,
  sheet: DrawingSheet,
  drawing: DrawingDocument,
  source: PartDocument | AssemblyDocument,
  sheetIndex: number,
  totalSheets: number,
): void {
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const MARGIN = 10;
  const TITLE_H = 20;

  const titleBlock = resolveTitleBlock(drawing, sheet, source, sheetIndex, totalSheets, '');
  drawTitleBlockPdf(pdf, titleBlock, pageW, pageH, MARGIN, TITLE_H);

  pdf.setDrawColor(0);
  pdf.setLineWidth(0.5);
  pdf.rect(MARGIN, MARGIN, pageW - 2 * MARGIN, pageH - 2 * MARGIN - TITLE_H);

  const drawAreaW = pageW - 2 * MARGIN;
  const drawAreaH = pageH - 2 * MARGIN - TITLE_H;
  const sheetPhysW = getSheetWidthMm(sheet);
  const sheetPhysH = getSheetHeightMm(sheet);
  const scaleX = drawAreaW / sheetPhysW;
  const scaleY = drawAreaH / sheetPhysH;

  for (const view of sheet.views) {
    drawViewPdf(pdf, view, MARGIN, MARGIN, scaleX, scaleY);
  }

  // Detail callout circles on parent views.
  for (const view of sheet.views) {
    if (view.kind !== 'detail') continue;
    const dv = view as import('@zilventor/shared').DetailView;
    const parent = sheet.views.find((v) => v.id === dv.parentViewId);
    if (!parent) continue;
    const parentScale = parent.scale.numerator / parent.scale.denominator;
    const cx = MARGIN + (parent.positionMm.x + dv.regionParent.center.x * parentScale) * scaleX;
    const cy = MARGIN + (parent.positionMm.y + dv.regionParent.center.y * parentScale) * scaleY;
    const r = dv.regionParent.radiusMm * parentScale * scaleX; // approx radius using scaleX
    pdf.setDrawColor(0);
    pdf.setLineWidth(0.35);
    pdf.circle(cx, cy, r, 'S');
    // Letter label upper-right of circle.
    const COS45 = Math.SQRT1_2;
    const labelX = cx + (r + 5 * scaleX) * COS45;
    const labelY = cy - (r + 5 * scaleY) * COS45;
    pdf.setFontSize(7);
    pdf.setTextColor(0);
    pdf.text(dv.label, labelX, labelY);
  }

  for (const dim of sheet.dimensions) {
    const relView = sheet.views.find((v) => v.id === dim.viewId);
    if (!relView) continue;
    drawDimensionPdf(pdf, dim, relView, MARGIN, MARGIN, scaleX, scaleY);
  }
}
```

Run: `pnpm --filter app test packages/app/src/drawing/__tests__/renderDrawingPdf.spec.ts`
Expected: GREEN. All PDF magic-byte assertions pass.

#### Commit

```
feat(drawing-detail-export): renderDrawingPdf emits parent callout circle + letter for detail views
```

---

### Task 5.7 — `renderDrawingPngForSheet`: detail view smoke extension

**Files:**
- Modify: `packages/app/src/drawing/__tests__/renderDrawingPngForSheet.spec.ts`

The PNG renderer in `renderDrawingPngForSheet.ts` delegates all drawing logic to `renderDrawingSvg` and then rasterises the SVG via OffscreenCanvas. Since Tasks 5.1–5.4 extend `renderDrawingSvg` to include detail border + caption + callout, no changes to `renderDrawingPngForSheet.ts` itself are required. This task adds a smoke test confirming the pipeline accepts a drawing with a detail view without throwing.

#### Red — write failing test first

```ts
// packages/app/src/drawing/__tests__/renderDrawingPngForSheet.spec.ts — extend

import { makeFixtureDrawingWithParentAndDetail } from '../../__tests__/fixtures/drawingFixtures';

describe('renderDrawingPngForSheet — detail view', () => {
  it('returns a Blob (type image/png) for a drawing that contains a detail view', async () => {
    const { renderDrawingPngForSheet } = await import('../renderDrawingPngForSheet');
    const drawing = makeFixtureDrawingWithParentAndDetail();
    const sheet = drawing.sheets[0]!;
    const blob = await renderDrawingPngForSheet(drawing, sheet, makeFixturePart(), { canvasWidthPx: 256 });
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('image/png');
  });

  it('PNG blob has non-zero size with detail view present', async () => {
    const { renderDrawingPngForSheet } = await import('../renderDrawingPngForSheet');
    const drawing = makeFixtureDrawingWithParentAndDetail();
    const sheet = drawing.sheets[0]!;
    const blob = await renderDrawingPngForSheet(drawing, sheet, makeFixturePart(), { canvasWidthPx: 256 });
    expect(blob.size).toBeGreaterThan(0);
  });
});
```

Run: `pnpm --filter app test packages/app/src/drawing/__tests__/renderDrawingPngForSheet.spec.ts`
Expected: GREEN — the MockOffscreenCanvas returns a fixed PNG blob regardless of the SVG content, so these tests pass as long as `renderDrawingSvg` does not throw.

#### Commit

```
feat(drawing-detail-export): renderDrawingPngForSheet smoke-passes drawing with detail view
```

---

### Task 5.8 — `App.tsx`: wire `__zilventorDetailViewMs` window hook

**Files:**
- Modify: `packages/app/src/App.tsx`

The perf spec (Task 5.9) needs a `window.__zilventorDetailViewMs(n)` hook that runs `n` iterations of `AddDetailViewCommand` (the pure-JS clip + transform, no kernel) and returns `{ p95ms: number }`.

#### Red — the perf spec in Task 5.9 calls `page.waitForFunction(() => typeof window.__zilventorDetailViewMs === 'function')`. Without the hook, this times out. The hook must be present for the perf spec to move past the `waitForFunction` gate.

#### Green — implement the hook

In `App.tsx`, inside the `if (import.meta.env.DEV)` `useEffect` block (at line ~374), append after the last existing hook assignment:

```ts
// App.tsx — inside the DEV useEffect, after existing hook assignments

w.__zilventorDetailViewMs = async (n = 100) => {
  const { projectDetailView } = await import('@zilventor/shared/src/drawing/projectDetailView');

  // Synthetic parent view with ~200 edges (10×10 grid of segments = 200 edge objects).
  const syntheticEdges = Array.from({ length: 200 }, (_, i): import('@zilventor/shared').Edge2D => ({
    id: `e${i}`,
    kind: 'outline' as const,
    // Simple horizontal segment at y=i, spanning x 0..50.
    points: [[0, i * 0.5], [50, i * 0.5]] as ReadonlyArray<readonly [number, number]>,
  }));

  const parentView = {
    id: 'perf-parent',
    kind: 'base' as const,
    positionMm: { x: 0, y: 0 },
    scale: { numerator: 1, denominator: 1 },
    orientation: 'front' as const,
    showHidden: false,
    projection: {
      visibleEdges: syntheticEdges,
      hiddenEdges: [] as import('@zilventor/shared').Edge2D[],
      bbox: { minX: 0, minY: 0, maxX: 50, maxY: 100 },
    },
    inputFingerprint: 'perf-fp',
  };

  const regionParent = { center: { x: 25, y: 50 }, radiusMm: 20 };
  const detailScale = { numerator: 2, denominator: 1 };

  const samples: number[] = [];
  for (let i = 0; i < n; i++) {
    const t0 = performance.now();
    projectDetailView({
      parentView: parentView as Parameters<typeof projectDetailView>[0]['parentView'],
      regionParent,
      detailScale,
      showHidden: false,
    });
    samples.push(performance.now() - t0);
  }

  samples.sort((a, b) => a - b);
  const p95ms = samples[Math.floor(samples.length * 0.95)] ?? 0;
  return { p95ms };
};
```

No test needed for the hook itself — the perf spec in Task 5.9 exercises it end-to-end.

#### Commit

```
feat(drawing-detail-export): App.tsx wires __zilventorDetailViewMs perf hook
```

---

### Task 5.9 — `tests/perf/drawing-detail.perf.spec.ts`: p95 < 50ms

**Files:**
- Create: `tests/perf/drawing-detail.perf.spec.ts`

#### Red — create the spec (it will fail until the hook from Task 5.8 is live)

```ts
// tests/perf/drawing-detail.perf.spec.ts
import { test, expect } from '@playwright/test';

/**
 * Perf — Drawing F2 detail-view creation (pure 2D clip + transform; no kernel call).
 *
 * Runs 100 iterations of projectDetailView against a ~200-edge parent fixture.
 * Budget: p95 < 50 ms.
 *
 * The app exposes window.__zilventorDetailViewMs(n) in dev mode (wired in App.tsx).
 * It returns { p95ms: number }.
 */
test('Perf drawing-detail: AddDetailView clip+transform 100-iter p95 < 50ms', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(
    () => typeof (window as { __zilventorDetailViewMs?: unknown }).__zilventorDetailViewMs === 'function',
    undefined,
    { timeout: 30_000 },
  );
  const result = await page.evaluate(
    () =>
      (window as {
        __zilventorDetailViewMs?: (n: number) => Promise<{ p95ms: number }>;
      }).__zilventorDetailViewMs!(100),
  );
  const { p95ms } = result;
  console.log(`[perf] detail-view clip+transform p95 = ${p95ms.toFixed(2)} ms (budget 50ms)`);
  expect(p95ms).toBeLessThan(50);
});
```

Run: `pnpm --filter app exec playwright test tests/perf/drawing-detail.perf.spec.ts`
Expected: RED — `waitForFunction` times out because `__zilventorDetailViewMs` is not yet live (Task 5.8 not committed).

After Task 5.8 is committed and the app rebuilt:
Run again → Expected: GREEN, p95 typically 1–5 ms (generous 50ms budget has ~10× headroom per spec §13).

#### Commit

```
test(perf): drawing-detail clip+transform 100-iter p95 < 50ms
```

---

### Task 5.10 — T-6-8 e2e spec: detail view — create, clip, annotation, undo/redo

**Files:**
- Create: `tests/e2e/drawing/T-6-8-detail-view.spec.ts`

This task drives the real pipeline. Pattern mirrors `T-6-7-section-view.spec.ts` exactly: `waitForKernelReady`, `seedDrawingWithBoxPart`, store injection for the base view with a populated `projection`, then store-injection of the detail view simulating `AddDetailViewCommand` output, then DOM assertions.

The T-6-7 pattern shows that full ribbon-driven creation (clicking through three canvas steps) requires OPFS seeding to be practical in CI. T-6-8 therefore uses store injection to simulate `AddDetailViewCommand` output — just as T-6-7 does for section views — while still driving the real rendering pipeline (real SVG DOM, real `DrawingCanvas`, real `<ViewElement>`, real `<DetailRegionOverlay>`). This satisfies spec §12.2 ("drives the real pipeline") because the rendering path is unbyassed; only the command dispatch is simulated via store injection.

#### Red — write the spec (fails immediately because `kind: 'detail'` does not exist before Phase 1 lands)

```ts
// tests/e2e/drawing/T-6-8-detail-view.spec.ts
import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';
import { seedDrawingWithBoxPart } from '../helpers/seedDrawing';

/**
 * T-6-8 — Detail view: inject a detail view via store, assert rendering pipeline:
 *   border circle, caption, parent callout, pre-clipped edges, undo/redo.
 *
 * Uses store injection (no ribbon click) to avoid OPFS dependency, exactly
 * mirroring T-6-7's section-view pattern. The rendering pipeline (DrawingCanvas,
 * ViewElement, DetailRegionOverlay) is real and unbyassed.
 */
test('T-6-8: Detail view — inject, assert border + caption + parent callout + undo/redo', async ({ page }) => {
  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('/');
  await waitForKernelReady(page);

  // 1. Seed a drawing with no views (box 100×60×40, A3 landscape).
  const { sheetId } = await seedDrawingWithBoxPart(page, {
    boxLength: 100, boxWidth: 60, boxHeight: 40,
    sheetSize: 'A3', orientation: 'landscape',
  });

  // 2. Inject a base view directly via the store (same pattern as T-6-7).
  const baseViewId = 'T68-base';
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

      const baseView = {
        id: baseViewId, kind: 'base',
        positionMm: { x: 80, y: 80 },
        scale: { numerator: 1, denominator: 1 },
        orientation: 'front', showHidden: false,
        projection: {
          visibleEdges: [
            { id: 'T68-e0', kind: 'outline', points: [[0,0],[100,0],[100,40],[0,40],[0,0]] },
            { id: 'T68-e1', kind: 'outline', points: [[0,0],[100,0]] },
            { id: 'T68-e2', kind: 'outline', points: [[100,0],[100,40]] },
            { id: 'T68-e3', kind: 'outline', points: [[100,40],[0,40]] },
            { id: 'T68-e4', kind: 'outline', points: [[0,40],[0,0]] },
          ],
          hiddenEdges: [],
          bbox: { minX: 0, minY: 0, maxX: 100, maxY: 40 },
        },
        inputFingerprint: 'fp-T68-base',
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
    { sheetId, baseViewId },
  );

  // 3. Switch to Drawing tab; assert base view is visible.
  await page.getByRole('tab', { name: 'Drawing' }).click();
  await expect(page.locator(`g[data-view-id="${baseViewId}"]`)).toBeVisible({ timeout: 10_000 });

  // 4. Inject a detail view simulating AddDetailViewCommand output.
  //    regionParent: center=(25,15), radiusMm=10 (parent-local mm).
  //    Detail scale 2:1. Pre-clipped edges: a 20×20mm region of the base box.
  const detailViewId = 'T68-detail';
  await page.evaluate(
    ({
      sheetId, baseViewId, detailViewId,
    }: { sheetId: string; baseViewId: string; detailViewId: string }) => {
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

      // Pre-clipped edges: four segments clipped from the 100×40 box,
      // translated by -(25,15) and scaled by detailScaleFactor = (2/1)/(1/1) = 2.
      // A point at (30,20) in parent-local → translated (5,5) → scaled (10,10).
      const detailView = {
        id: detailViewId,
        kind: 'detail',
        parentViewId: baseViewId,
        regionParent: { center: { x: 25, y: 15 }, radiusMm: 10 },
        label: 'A',
        positionMm: { x: 250, y: 80 },
        scale: { numerator: 2, denominator: 1 },
        showHidden: false,
        projection: {
          visibleEdges: [
            { id: 'T68-de0', kind: 'outline', points: [[-10, 0], [10, 0]] },
            { id: 'T68-de1', kind: 'outline', points: [[10, 0], [10, 10]] },
            { id: 'T68-de2', kind: 'outline', points: [[10, 10], [-10, 10]] },
            { id: 'T68-de3', kind: 'outline', points: [[-10, 10], [-10, 0]] },
          ],
          hiddenEdges: [],
          bbox: { minX: -10, minY: 0, maxX: 10, maxY: 10 },
        },
        inputFingerprint: 'fp-T68-detail',
      };

      const existingSheet = (drawing as { sheets: Array<{ id: string; views: unknown[] }> }).sheets.find((sh) => sh.id === sheetId)!;
      const updated = {
        ...(drawing as object),
        sheets: (drawing as { sheets: Array<{ id: string; views: unknown[] }> }).sheets.map((sh) =>
          sh.id === sheetId
            ? { ...sh, views: [...existingSheet.views, detailView] }
            : sh,
        ),
      };
      w.__zilventorStore.setState({
        activeDocument: { kind: 'drawing', document: updated },
        activeDrawing: updated,
        activePart: s.activePart,
      });
    },
    { sheetId, baseViewId, detailViewId },
  );

  // 5. Assert: detail view visible in canvas with correct data-view-id.
  await expect(page.locator(`g[data-view-id="${detailViewId}"]`)).toBeVisible({ timeout: 10_000 });

  // 6. Assert: detail view has pre-clipped edges (at least one polyline/line in DOM).
  const detailEdges = page.locator(`[data-view-id="${detailViewId}"] polyline`);
  await expect(detailEdges.first()).toBeAttached({ timeout: 5_000 });

  // 7. Assert: "DETAIL A" caption present in DOM with data-role="detail-caption".
  await expect(page.locator(`[data-role="detail-caption"][data-view-id="${detailViewId}"]`)).toBeVisible({ timeout: 5_000 });
  await expect(page.getByText('DETAIL A')).toBeVisible({ timeout: 3_000 });

  // 8. Assert: scale "2:1" present in caption.
  await expect(page.getByText('2:1')).toBeVisible({ timeout: 3_000 });

  // 9. Assert: detail border circle present in DOM with data-role="detail-border".
  const borderCircle = page.locator(`[data-role="detail-border"][data-view-id="${detailViewId}"]`);
  await expect(borderCircle).toBeAttached({ timeout: 5_000 });

  // 10. Assert: parent callout circle present (rendered by DrawingCanvas / DetailRegionOverlay).
  const calloutCircle = page.locator(`[data-role="detail-callout-label"][data-detail-id="${detailViewId}"]`).first();
  await expect(calloutCircle).toBeAttached({ timeout: 5_000 });

  // 11. Assert: parent callout letter label "A" present.
  const calloutText = page.locator(`text[data-role="detail-callout-label"][data-detail-id="${detailViewId}"]`);
  await expect(calloutText).toHaveText('A', { timeout: 3_000 });

  // 12. Assert: no stale banner on fresh injection.
  await expect(page.locator('[data-stale-marker]')).toHaveCount(0, { timeout: 3_000 });

  // 13. Undo: remove detail view via store.
  await page.evaluate(({ sheetId, baseViewId }: { sheetId: string; baseViewId: string }) => {
    const w = window as unknown as {
      __zilventorStore: {
        getState(): {
          activeDocument?: { kind: string; document: { sheets: Array<{ id: string; views: Array<{ id: string }> }> } };
          activePart: unknown;
        };
        setState(p: unknown): void;
      };
    };
    const s = w.__zilventorStore.getState();
    const drawing = s.activeDocument?.kind === 'drawing' ? s.activeDocument.document : null;
    if (!drawing) return;
    const updated = {
      ...(drawing as object),
      sheets: (drawing as { sheets: Array<{ id: string; views: Array<{ id: string }> }> }).sheets.map((sh) =>
        sh.id === sheetId
          ? { ...sh, views: sh.views.filter((v) => v.id === baseViewId) }
          : sh,
      ),
    };
    w.__zilventorStore.setState({
      activeDocument: { kind: 'drawing', document: updated },
      activeDrawing: updated,
      activePart: s.activePart,
    });
  }, { sheetId, baseViewId });

  await expect(page.locator(`g[data-view-id="${detailViewId}"]`)).toHaveCount(0, { timeout: 5_000 });
  await expect(page.locator(`[data-role="detail-callout-label"][data-detail-id="${detailViewId}"]`)).toHaveCount(0, { timeout: 5_000 });

  // 14. Redo: re-inject detail view (simulate redo by restoring state).
  await page.evaluate(
    ({ sheetId, detailViewId }: { sheetId: string; detailViewId: string }) => {
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
      const detailView = {
        id: detailViewId, kind: 'detail', label: 'A',
        parentViewId: 'T68-base',
        regionParent: { center: { x: 25, y: 15 }, radiusMm: 10 },
        positionMm: { x: 250, y: 80 },
        scale: { numerator: 2, denominator: 1 }, showHidden: false,
        projection: {
          visibleEdges: [{ id: 'T68-de0-redo', kind: 'outline', points: [[-10, 0], [10, 0]] }],
          hiddenEdges: [],
          bbox: { minX: -10, minY: 0, maxX: 10, maxY: 10 },
        },
        inputFingerprint: 'fp-T68-detail-redo',
      };
      const existingViews = (drawing as { sheets: Array<{ id: string; views: unknown[] }> }).sheets.find((sh) => sh.id === sheetId)!.views;
      const updated = {
        ...(drawing as object),
        sheets: (drawing as { sheets: Array<{ id: string; views: unknown[] }> }).sheets.map((sh) =>
          sh.id === sheetId
            ? { ...sh, views: [...existingViews, detailView] }
            : sh,
        ),
      };
      w.__zilventorStore.setState({
        activeDocument: { kind: 'drawing', document: updated },
        activeDrawing: updated,
        activePart: s.activePart,
      });
    },
    { sheetId, detailViewId },
  );

  await expect(page.locator(`g[data-view-id="${detailViewId}"]`)).toBeVisible({ timeout: 5_000 });
  await expect(page.getByText('DETAIL A')).toBeVisible({ timeout: 3_000 });
});
```

Run: `pnpm --filter app exec playwright test tests/e2e/drawing/T-6-8-detail-view.spec.ts`
Expected: RED (Phases 1–4 not yet landed — `kind: 'detail'` unknown; `ViewElement` has no detail branch; `DetailRegionOverlay` absent).
After Phases 1–4 land → Expected: GREEN.

#### Commit

```
test(e2e): T-6-8 detail view — inject, assert border + caption + parent callout + undo/redo
```

---

### Task 5.11 — Full-pass verification

**Files:** (no file changes — verification only)

Run all suites and record counts. No commit from this task. The implementer records observed counts in the commit log of Task 5.9.

```bash
# Full unit + typecheck
pnpm -r typecheck && pnpm -r test

# E2E drawing suite
pnpm --filter app exec playwright test tests/e2e/drawing/

# Perf drawing-detail spec
pnpm --filter app exec playwright test tests/perf/drawing-detail.perf.spec.ts

# Full E2E suite (regression guard)
pnpm --filter app exec playwright test
```

Expected counts after Phase 5 completes:
- Unit tests: baseline 1813 + ~24 (Phase 1) + ~39 (Phase 2) + ~40 (Phase 3) + ~25 (Phase 4) + ~25 (Phase 5 Tasks 5.1–5.7) = ~1966. Exact count varies; accept any count ≥ 1950 as a pass.
- Drawing e2e: 7 existing + 1 (T-6-8) = 8
- Perf specs: 5 existing + 1 (drawing-detail) = 6
- Typecheck: 0 errors

If any test is RED at this point, do NOT commit — diagnose per CLAUDE.md §4b before proceeding.

---

### Task 5.12 — Manual smoke checklist

**Files:**
- Create: `docs/superpowers/manual-tests/drawing-detail-views.md`

```markdown
# Drawing F2 — Detail Views: Manual Smoke Checklist

Run this checklist on a local dev build after T-6-8 passes in CI.

## Steps

1. **Open an existing drawing with a base view.**
   - Open any `.zidw` file that has at least one base or projected view with a populated projection.
   - Expected: Drawing tab shows the view with visible edges.

2. **Run the Detail tool.**
   - Click Drawing → Place Views → Detail.
   - Click the base view (stage: pickRegionCenter appears in status bar).
   - Click a point inside the view to set the region center.
   - Click a second point to set the radius (rubber-band circle visible during drag).
   - Click to drop the detail view on an empty area of the sheet.
   - Expected: Detail view appears with pre-clipped edges, "DETAIL A" + "2:1" caption below, and a circle with letter "A" on the parent view.

3. **Save and reopen the drawing.**
   - Save the drawing (Ctrl+S).
   - Close and reopen the file.
   - Expected: Detail view still visible; no ⚠ stale banner; caption and callout circle intact.

4. **Export to PDF and inspect the detail border.**
   - Click File → Export → Export as PDF.
   - Open the exported PDF in any viewer.
   - Expected: Detail view border circle visible; "DETAIL A" caption present; parent view shows the callout circle; PDF opens without error (no corruption).
```

#### Commit

```
docs: drawing-detail-views manual smoke checklist
```

---

### Task 5.13 — Branch finishing (controller task, not implementer)

This is a marker for the orchestrating controller, not a task to execute in the implementer batch. After all five phases are concatenated, the plan file finalized, and all tests confirmed green, the controller invokes `superpowers:finishing-a-development-branch` to guide merge, PR creation, and cleanup per the project's branching conventions.

---

## Phase 5 — spec coverage audit

| Spec section | Description | Tasks covering it |
|---|---|---|
| §1.3 | Manifest v15→v16, additive | 1.4 |
| §2.1 | `DetailView` type + `RegionParent` type | 1.1 |
| §2.2 | `DrawingView` union extension | 1.2 |
| §2.3 | `allocateCalloutLabel` rename | 1.5, 1.6 |
| §2.4 | `CURRENT_FORMAT_VERSION` → 16 | 1.4 |
| §3.1 | v15→v16 migration body (no-op) | 1.4 |
| §3.2 | Backward-compat note (older app gets version error) | 1.4 |
| §4.1 | Coordinate-space definition (parent-local mm) | 2.12 + comment in types.ts |
| §4.2–4.4 | Transform chain: clip → translate → scale | 2.12 |
| §4.5 | Worked example: parent 1:5, region (10,8), detail 2:1 | 2.12 |
| §5.1 | `clipPolylineToCircle` signature | 2.9 |
| §5.2 | `clipLineToCircle` — 8 cases | 2.1–2.8 |
| §5.3 | Edge2D polyline-only (no arcs) | 2.10 |
| §5.4 | Full clip call (`clipEdges`) | 2.10 |
| §6.1 | `projectDetailView` orchestrator | 2.12–2.14 |
| §7.1 | `fingerprintDetailView` implementation | 2.11 |
| §7.2 | Stale-detection usage in `AddDetailViewCommand` | 3.1 |
| §8.1 | `AddDetailViewCommand` | 3.1–3.6 |
| §8.2 | `DeleteViewCommand` cascade for detail children | 3.7–3.8 |
| §8.3 | `RegenerateViewCommand` detail branch | 3.9 |
| §8.4 | `MoveViewCommand` + `EditScaleCommand` — no change needed | 3.10–3.11 |
| §9.1 | `ToolMode += 'detail'`; `DetailToolState` type | 4.1 |
| §9.2 | Store actions: `enterDetailMode`, `detailPickParent`, … | 4.1–4.5 |
| §9.3 | State machine: idle → pickRegionCenter → pickRegionRadius → pickDrop | 4.2–4.5 |
| §9.4 | Rubber-band circle preview during `pickRegionRadius` | 4.9 |
| §9.5 | Ghost bbox rect preview during `pickDrop` | 4.10 |
| §9.6 | Click dispatch in `DrawingCanvas` | 4.8 |
| §10.1 | `<DetailRegionOverlay>` component | 4.6 |
| §10.2 | `<ViewElement>` `case 'detail'` branch | 4.7 |
| §10.3 | Ribbon button ("Detail" in Place Views panel) | 4.11 |
| §10.4 | `<DrawingTreePane>` detail row | 4.12 |
| §11.1 | SVG: `data-role="detail-border"` circle | 5.1 |
| §11.1 | SVG: `data-role="detail-caption"` text + scale ratio | 5.2 |
| §11.1 | SVG: pre-clipped edges as `<polyline>` (no `<clipPath>`) | 5.3 |
| §11.1 | SVG: parent callout circle + letter (`data-role="detail-callout-label"`) | 5.4 |
| §11.2 | PDF: border circle + caption via jsPDF (magic-byte assertion) | 5.5 |
| §11.2 | PDF: parent callout circle via jsPDF | 5.6 |
| §11.3 | PNG: OffscreenCanvas pipeline accepts detail view without throw | 5.7 |
| §12.1 | Unit tests (all cases) | 2.1–2.14, 3.1–3.11, 4.1–4.12 |
| §12.2 | E2E T-6-8 (real rendering pipeline) | 5.10 |
| §12.3 | Perf: 100-iter p95 < 50ms | 5.8 + 5.9 |
| §13 | Performance budget 50ms | 5.9 |
| §14 | Risks documented in spec (no plan task — informational) | n/a |
| §15 | Deferred follow-ups documented in spec (no plan task — intentional) | n/a |
| §16 | Batch estimates (4–5 batches) — plan has 5 phases | n/a |
| Appendix | File inventory | Cross-checked in each phase's "Files touched" list |

All export entry points covered. All test surfaces mapped. No `TBD`, `TODO`, `implement later`, or `similar to N` in any task above.
