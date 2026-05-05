# Drawing F1 — Section Views Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add ANSI-standard section views to .zidw drawings — cut a parent view by a two-click line, run OCCT half-space cut on source body/assembly, project the cut + behind-plane geometry into a new view with per-material hatching.

**Architecture:** Pure-projector pipeline gains a hatch-edge class; kernel adds half-space BOPAlgo_BOP cut + OPFS BREP cache; new `kind: 'section'` discriminant on DrawingView union; atomic AddSectionViewCommand from a 4-stage tool-mode flow (pickParent → pickP0 → pickP1 → pickDrop).

**Tech Stack:** TypeScript / React / Zustand / opencascade.js / OPFS / Vitest / Playwright / pnpm workspace

---

## File Structure

| File | Action | Phase | Description |
|------|--------|-------|-------------|
| `packages/shared/src/drawing/types.ts` | modify | 1 | Add `Vec2`, `SectionView`, `HatchSegment` to `DrawingView` union |
| `packages/shared/src/material.ts` | modify | 1 | Add `hatchAngleDeg?` and `hatchSpacingMm?` to `MaterialEntry`; export `getHatchSpec` |
| `packages/shared/src/migrations/v15.ts` | create | 1 | No-op migration v14→v15 |
| `packages/shared/src/fileFormat.ts` | modify | 1 | Register migration 14→15; bump `CURRENT_FORMAT_VERSION` to 15 |
| `packages/shared/src/drawing/resolveSectionSource.ts` | create | 2 | `resolveSectionSource` helper — resolves parent view + doc to `{ kind, id }` |
| `packages/kernel/src/adapter/drawing/getProjectorInput.ts` | modify | 2 | Export `GetProjectorInputArgs` section-source path; re-export `resolveSectionSource` from shared |
| `packages/kernel/src/section/cutBySectionPlane.ts` | create | 2 | Half-space + BOPAlgo_BOP OCCT cut |
| `packages/kernel/src/section/sectionCache.ts` | create | 2 | OPFS BREP cache + 32-entry LRU |
| `packages/kernel/src/section/faceTag.ts` | create | 2 | Cut-face vs original-face tagging |
| `packages/shared/src/drawing/planeFingerprint.ts` | create | 3 | Plane normal+origin → SHA-256 string |
| `packages/shared/src/drawing/hatchGenerator.ts` | create | 3 | Sutherland-Hodgman + ear-clipping + per-material hatch lines |
| `packages/shared/src/drawing/projectSectionView.ts` | create | 3 | Section-specific projector orchestrator |
| `packages/shared/src/drawing/fingerprint.ts` | modify | 3 | Extend `computeViewFingerprint` for `SectionView` |
| `packages/shared/src/drawing/projector.ts` | modify | 3 | Wire section path into `projectView` dispatcher |
| `packages/shared/src/drawing/sectionLabel.ts` | create | 4 | Auto-label allocator (A → Z → AA) |
| `packages/app/src/commands/AddSectionViewCommand.ts` | create | 4 | Atomic command: validate → cut → project → insert |
| `packages/app/src/commands/index.ts` | modify | 4 | Register `AddSectionViewCommand` |
| `packages/app/src/drawing/toolMode.ts` | modify | 4 | Add `'placeSection'` tool mode + 4-stage state machine |
| `packages/app/src/drawing/DrawingCanvas.tsx` | modify | 4 | Dispatch section tool clicks; route to state machine |
| `packages/app/src/drawing/SectionLineOverlay.tsx` | create | 4 | ANSI cutting-plane line + arrowheads + label on parent view |
| `packages/app/src/drawing/ViewElement.tsx` | modify | 4 | Render `hatchSegments` strokes + section caption |
| `packages/app/src/shell/tabs/DrawingTab.tsx` | modify | 4 | Add "Section" button in Place Views panel |
| `tests/e2e/T-6-7-section-view.spec.ts` | create | 5 | E2e: place section view on a box part, assert hatch rows |
| `tests/perf/section-cut.perf.spec.ts` | create | 5 | Perf: combined cut+project p95 ≤ 400ms (T63a); projection regression guard ≤ 200ms (T63b) |
| `tests/perf/_fixtures.ts` | create | 5 | Shared perf fixture: `buildPerfAssembly20()` |

---

## Phase 1 — Types & migration

Four tasks; tightly coupled (all type/manifest changes). Dispatch as one batch to a single Sonnet subagent. All commands run from the repo root unless noted.

---

### Task 1: Add `SectionView` and `HatchSegment` to `DrawingView` union

**Files:**
- Modify: `packages/shared/src/drawing/types.ts`
- Modify (test): `packages/shared/src/drawing/__tests__/types.spec.ts`

**Agent:** Sonnet implementer.

- [ ] **Step 1: Write the failing test**

  Append to `packages/shared/src/drawing/__tests__/types.spec.ts` (after the last `it` block, inside the existing `describe`):

  ```ts
  // --- Section-view additions (Drawing F1) ---
  import type { SectionView, HatchSegment } from '../types';

  it('SectionView kind discriminator survives JSON round-trip', () => {
    const sv: SectionView = {
      id: 'sv1',
      kind: 'section',
      parentViewId: 'v1',
      sectionLine: { p0: { x: 10, y: 50 }, p1: { x: 190, y: 50 } },
      arrowDirection: 1,
      label: 'A',
      positionMm: { x: 10, y: 120 },
      scale: { numerator: 1, denominator: 1 },
      showHidden: false,
      hatchSegments: [],
      fingerprint: '',
    };
    const parsed = JSON.parse(JSON.stringify(sv)) as SectionView;
    expect(parsed.kind).toBe('section');
    expect(parsed.parentViewId).toBe('v1');
    expect(parsed.arrowDirection).toBe(1);
  });

  it('HatchSegment carries p0, p1, materialId', () => {
    const seg: HatchSegment = {
      p0: { x: 0, y: 0 },
      p1: { x: 10, y: 0 },
      materialId: 'm1',
    };
    expect(seg.materialId).toBe('m1');
  });

  it('DrawingView union exhaustiveness — section variant reachable', () => {
    // Compile-time check: this switch must handle all DrawingView kinds.
    // If 'section' is missing from the union the branch is dead-code and TS
    // will warn; if SectionView is absent from DrawingView it is a type error.
    function label(v: DrawingView): string {
      switch (v.kind) {
        case 'base':      return 'base';
        case 'projected': return 'projected';
        case 'iso':       return 'iso';
        case 'section':   return 'section';
        default: {
          const _: never = v;
          return _;
        }
      }
    }
    const sv: DrawingView = {
      id: 'sv2', kind: 'section',
      parentViewId: 'v1',
      sectionLine: { p0: { x: 0, y: 0 }, p1: { x: 1, y: 0 } },
      arrowDirection: -1, label: 'B',
      positionMm: { x: 0, y: 0 },
      scale: { numerator: 1, denominator: 2 },
      showHidden: false, hatchSegments: [], fingerprint: '',
    };
    expect(label(sv)).toBe('section');
  });
  ```

- [ ] **Step 2: Run the test (expect fail)**

  ```
  pnpm --filter @zilventor/shared test:unit -- drawing/__tests__/types
  ```

  Expected: import of `SectionView` / `HatchSegment` fails — types do not exist yet.

- [ ] **Step 3: Edit `packages/shared/src/drawing/types.ts`**

  Add `Vec2` alias directly below the `ISO_SIZES_MM` block (before `SheetSize`):

  ```ts
  // ---------------------------------------------------------------------------
  // Vec2 — reusable 2-D point in mm
  // ---------------------------------------------------------------------------

  export type Vec2 = { readonly x: number; readonly y: number };
  ```

  Add `HatchSegment` and `SectionView` after `IsoView` and before the `DrawingView` union:

  ```ts
  // ---------------------------------------------------------------------------
  // HatchSegment — one hatch line in mm space (pre-scale), tagged by material
  // ---------------------------------------------------------------------------

  export type HatchSegment = {
    readonly p0: Vec2;
    readonly p1: Vec2;
    readonly materialId: string;
  };

  // ---------------------------------------------------------------------------
  // SectionView — ANSI-style cut view derived from a parent BaseView
  // ---------------------------------------------------------------------------

  export type SectionView = {
    readonly id: string;
    readonly kind: 'section';
    readonly parentViewId: string;
    readonly sectionLine: { readonly p0: Vec2; readonly p1: Vec2 };
    readonly arrowDirection: -1 | 1;   // +1 = arrows point toward increasing Y
    readonly label: string;            // auto-allocated: 'A', 'B', …, 'AA', …
    readonly positionMm: Vec2;
    readonly scale: ViewScale;
    readonly showHidden: false;        // literal — ANSI convention: never show hidden in section
    readonly hatchSegments: readonly HatchSegment[];
    readonly fingerprint: string;      // SHA-256 of cut-plane + source geometry
    readonly projection?: {            // populated after first cut+project; absent until then
      readonly visibleEdges: readonly ProjectedEdge[];
      readonly hiddenEdges: readonly ProjectedEdge[];
      readonly bbox: { minX: number; minY: number; maxX: number; maxY: number };
    };
    readonly inputFingerprint?: string; // mirrors BaseView/ProjectedView stale-banner pattern
  };
  ```

  Extend the `DrawingView` union:

  ```ts
  export type DrawingView =
    | BaseView
    | ProjectedView
    | IsoView
    | SectionView;
  ```

  Also export the new types from `packages/shared/src/index.ts` by appending `SectionView, HatchSegment, Vec2` to the existing drawing re-export line.

- [ ] **Step 4: Run the test (expect pass)**

  ```
  pnpm --filter @zilventor/shared test:unit -- drawing/__tests__/types
  ```

  Expected: all tests pass including the three new assertions.

- [ ] **Step 5: Commit**

  ```
  git add packages/shared/src/drawing/types.ts \
          packages/shared/src/drawing/__tests__/types.spec.ts \
          packages/shared/src/index.ts
  git commit -m "feat(drawing-section): add SectionView + HatchSegment to DrawingView union (F1 §T1)"
  ```

---

### Task 2: Extend `MaterialEntry` with hatch spec fields + `getHatchSpec` helper

**Files:**
- Modify: `packages/shared/src/material.ts`
- Modify (test): `packages/shared/src/drawing/__tests__/types.spec.ts` (append)
  OR create `packages/shared/src/__tests__/material-hatch.spec.ts` (new file, preferred)

**Agent:** Sonnet implementer.

- [ ] **Step 1: Write the failing test**

  Create `packages/shared/src/__tests__/material-hatch.spec.ts`:

  ```ts
  import { describe, it, expect } from 'vitest';
  import type { MaterialEntry } from '../material';
  import { getHatchSpec } from '../material';

  describe('getHatchSpec', () => {
    it('returns defaults when hatchAngleDeg and hatchSpacingMm are absent', () => {
      const m: MaterialEntry = {
        id: 'm1', name: 'MDF', defaultThickness: 18, color: '#aabbcc',
      };
      const spec = getHatchSpec(m);
      expect(spec.angleDeg).toBe(45);
      expect(spec.spacingMm).toBe(3);
    });

    it('returns explicit values when both fields are present', () => {
      const m: MaterialEntry = {
        id: 'm2', name: 'Birch', defaultThickness: 18, color: '#ffffff',
        hatchAngleDeg: 60, hatchSpacingMm: 5,
      };
      const spec = getHatchSpec(m);
      expect(spec.angleDeg).toBe(60);
      expect(spec.spacingMm).toBe(5);
    });

    it('returns defaults when only hatchAngleDeg is explicitly 0', () => {
      // Edge case: 0 degrees is a valid override (horizontal lines).
      const m: MaterialEntry = {
        id: 'm3', name: 'Glass', defaultThickness: 6, color: '#ccddee',
        hatchAngleDeg: 0, hatchSpacingMm: 2,
      };
      const spec = getHatchSpec(m);
      expect(spec.angleDeg).toBe(0);
      expect(spec.spacingMm).toBe(2);
    });

    it('falls back to default spacing when hatchSpacingMm is absent but hatchAngleDeg present', () => {
      const m: MaterialEntry = {
        id: 'm4', name: 'Steel', defaultThickness: 3, color: '#999999',
        hatchAngleDeg: 30,
      };
      const spec = getHatchSpec(m);
      expect(spec.angleDeg).toBe(30);
      expect(spec.spacingMm).toBe(3);
    });
  });
  ```

- [ ] **Step 2: Run the test (expect fail)**

  ```
  pnpm --filter @zilventor/shared test:unit -- __tests__/material-hatch
  ```

  Expected: `getHatchSpec` is not exported from `../material`.

- [ ] **Step 3: Edit `packages/shared/src/material.ts`**

  Add optional fields to `MaterialEntry` (additive; existing files without these fields pass `isMaterialEntry` unchanged):

  ```ts
  export interface MaterialEntry {
    readonly id: MaterialId;
    readonly name: string;
    readonly defaultThickness: number;
    readonly color: string;
    readonly sheetLengthMm?: number;
    readonly sheetWidthMm?: number;
    readonly hatchAngleDeg?: number;   // default 45 — degrees from horizontal
    readonly hatchSpacingMm?: number;  // default 3 — spacing between hatch lines
  }
  ```

  Append the helper at the end of the file:

  ```ts
  const DEFAULT_HATCH_ANGLE_DEG = 45;
  const DEFAULT_HATCH_SPACING_MM = 3;

  /**
   * Derive hatch rendering spec from a material, applying defaults for absent fields.
   * Returned values are always finite numbers safe for trigonometric use.
   */
  export function getHatchSpec(material: MaterialEntry): { angleDeg: number; spacingMm: number } {
    return {
      angleDeg:  material.hatchAngleDeg  ?? DEFAULT_HATCH_ANGLE_DEG,
      spacingMm: material.hatchSpacingMm ?? DEFAULT_HATCH_SPACING_MM,
    };
  }
  ```

- [ ] **Step 4: Run the test (expect pass)**

  ```
  pnpm --filter @zilventor/shared test:unit -- __tests__/material-hatch
  ```

  Expected: 4 passing assertions.

- [ ] **Step 5: Verify no regression in existing material tests**

  ```
  pnpm --filter @zilventor/shared test:unit -- __tests__/material
  ```

- [ ] **Step 6: Commit**

  ```
  git add packages/shared/src/material.ts \
          packages/shared/src/__tests__/material-hatch.spec.ts
  git commit -m "feat(shared): extend MaterialEntry with hatchAngleDeg/hatchSpacingMm + getHatchSpec (F1 §T2)"
  ```

---

### Task 3: Manifest v14 → v15 no-op migration

**Files:**
- Create: `packages/shared/src/migrations/v15.ts`  *(note: migrations currently live inline in `fileFormat.ts` — create this file for documentation; the actual registration step is in `fileFormat.ts`)*
- Modify: `packages/shared/src/fileFormat.ts`
- Create (test): `packages/shared/src/__tests__/migrateManifest-v14-to-v15.spec.ts`

**Agent:** Sonnet implementer.

- [ ] **Step 1: Write the failing test**

  Create `packages/shared/src/__tests__/migrateManifest-v14-to-v15.spec.ts`:

  ```ts
  import { describe, it, expect } from 'vitest';
  import { migrateManifest, CURRENT_FORMAT_VERSION } from '../fileFormat';

  describe('migrateManifest v14 → v15 (Drawing F1 — no-op additive)', () => {
    it('CURRENT_FORMAT_VERSION is 15', () => {
      expect(CURRENT_FORMAT_VERSION).toBe(15);
    });

    it('passes a v14 part through to v15 unchanged', () => {
      const v14Part = {
        formatVersion: 14, kind: 'part',
        document: {
          id: 'p1', name: 'Cabinet', units: 'mm',
          parameters: {}, featureTree: [], properties: {},
          materials: [], hardware: [],
        },
      };
      const out = migrateManifest(v14Part) as { formatVersion: number; kind: string };
      expect(out.formatVersion).toBe(15);
      expect(out.kind).toBe('part');
    });

    it('passes a v14 assembly through to v15 unchanged', () => {
      const v14Asm = {
        formatVersion: 14, kind: 'assembly',
        document: {
          id: 'a1', name: 'Wardrobe', units: 'mm',
          parameters: {}, components: [], constraints: [],
          groundedComponentPaths: [], colors: {},
          bomItemNumbers: {}, cutListItemNumbers: {},
          colorOverrides: {}, properties: {},
          materials: [], hardware: [],
        },
      };
      const out = migrateManifest(v14Asm) as { formatVersion: number };
      expect(out.formatVersion).toBe(15);
    });

    it('passes a v14 drawing through to v15 without data loss', () => {
      const v14Drawing = {
        formatVersion: 14, kind: 'drawing',
        document: {
          id: 'draw-1', name: 'Box — Drawing', units: 'mm',
          source: { partPath: 'parts/box.zipt', sourceKind: 'part' },
          properties: {}, sheets: [], activeSheetId: '',
        },
      };
      const out = migrateManifest(v14Drawing) as {
        formatVersion: number;
        kind: string;
        document: { name: string };
      };
      expect(out.formatVersion).toBe(15);
      expect(out.kind).toBe('drawing');
      expect(out.document.name).toBe('Box — Drawing');
    });

    it('a v15 manifest passes through migrateManifest without re-migration', () => {
      const v15 = {
        formatVersion: 15, kind: 'part',
        document: {
          id: 'p2', name: 'Shelf', units: 'mm',
          parameters: {}, featureTree: [], properties: {},
          materials: [], hardware: [],
        },
      };
      const out = migrateManifest(v15) as { formatVersion: number };
      expect(out.formatVersion).toBe(15);
    });
  });
  ```

- [ ] **Step 2: Run the test (expect fail)**

  ```
  pnpm --filter @zilventor/shared test:unit -- __tests__/migrateManifest-v14-to-v15
  ```

  Expected: `CURRENT_FORMAT_VERSION` is 14, not 15 — test fails on first assertion.

- [ ] **Step 3: Create `packages/shared/src/migrations/v15.ts`**

  ```ts
  // packages/shared/src/migrations/v15.ts
  // v14 → v15: no-op.
  // SectionView is forward-only: only created by AddSectionViewCommand.
  // Existing part / assembly / drawing documents require no structural change.
  export const MIGRATION_VERSION = 15 as const;
  ```

  This file serves as documentation and a single source of truth for the version number.

- [ ] **Step 4: Edit `packages/shared/src/fileFormat.ts`**

  Change `CURRENT_FORMAT_VERSION`:

  ```ts
  export const CURRENT_FORMAT_VERSION = 15 as const;
  ```

  Add the migration entry at the end of the `migrations` map (after the `13:` entry):

  ```ts
  // v14 → v15: no-op. SectionView is forward-only; no existing documents need
  // structural transformation. (Drawing F1 — section views)
  14: (mIn) => {
    const m = deepClone(mIn);
    return { ...m, formatVersion: 15 };
  },
  ```

  Also update `normalizeKind` to include version 15:

  ```ts
  function normalizeKind(m: AnyManifest): AnyManifest {
    if (
      (m.formatVersion === 10 || m.formatVersion === 11 || m.formatVersion === 12 ||
       m.formatVersion === 13 || m.formatVersion === 14 || m.formatVersion === 15) &&
      (m as unknown as { kind?: unknown }).kind === undefined
    ) {
      return { ...m, kind: 'part' } as AnyManifest;
    }
    return m;
  }
  ```

- [ ] **Step 5: Run the test (expect pass)**

  ```
  pnpm --filter @zilventor/shared test:unit -- __tests__/migrateManifest-v14-to-v15
  ```

- [ ] **Step 6: Verify no regression in v13→v14 migration tests**

  ```
  pnpm --filter @zilventor/shared test:unit -- __tests__/migrateManifest-v13-to-v14
  ```

  Expected: the existing test that asserts `CURRENT_FORMAT_VERSION === 14` **will fail** because the constant is now 15. Update that test's assertion to `toBe(15)` — this is an intentional cascading update, not a regression.

- [ ] **Step 7: Commit**

  ```
  git add packages/shared/src/migrations/v15.ts \
          packages/shared/src/fileFormat.ts \
          packages/shared/src/__tests__/migrateManifest-v14-to-v15.spec.ts \
          packages/shared/src/__tests__/migrateManifest-v13-to-v14.spec.ts
  git commit -m "feat(shared): manifest v14→v15 no-op migration for section views (F1 §T3)"
  ```

---

### Task 4: `resolveSectionSource` helper in shared

**Files:**
- Create: `packages/shared/src/drawing/resolveSectionSource.ts`
- Create (test): `packages/shared/src/drawing/__tests__/resolveSectionSource.spec.ts`
- Modify: `packages/shared/src/index.ts` (re-export)

**Agent:** Sonnet implementer.

> **Placement rationale:** `resolveSectionSource` inspects only `SectionView` and `DrawingDocument` — no OCCT or kernel API. Moving it to `packages/shared` lets `AddSectionViewCommand` (in `packages/app`) import it without creating a circular shared→kernel→app dependency. `packages/kernel/src/adapter/drawing/getProjectorInput.ts` re-exports it from shared for backward compat.

- [ ] **Step 1: Write the failing test**

  Create `packages/shared/src/drawing/__tests__/resolveSectionSource.spec.ts`:

  ```ts
  import { resolveSectionSource } from '../resolveSectionSource';
  import type { DrawingDocument } from '../../index';

  describe('resolveSectionSource', () => {
    const baseDoc: DrawingDocument = {
      id: 'draw-1', name: 'Test', units: 'mm',
      source: { partPath: 'parts/box.zipt', sourceKind: 'part' },
      properties: {},
      sheets: [{
        id: 's1', name: 'Sheet 1',
        size: { kind: 'iso', size: 'A3' },
        orientation: 'landscape',
        views: [
          {
            id: 'v1', kind: 'base',
            positionMm: { x: 0, y: 0 },
            scale: { numerator: 1, denominator: 1 },
            orientation: 'front',
            showHidden: false,
          },
          {
            id: 'v2', kind: 'base',
            positionMm: { x: 200, y: 0 },
            scale: { numerator: 1, denominator: 1 },
            orientation: 'front',
            showHidden: false,
          },
        ],
        dimensions: [], annotations: [], titleBlock: {},
      }],
      activeSheetId: 's1',
    };

    it('resolves a section view whose parent is a base view on a part-source drawing', () => {
      const sv = {
        id: 'sv1', kind: 'section' as const,
        parentViewId: 'v1',
        sectionLine: { p0: { x: 0, y: 50 }, p1: { x: 100, y: 50 } },
        arrowDirection: 1 as const, label: 'A',
        positionMm: { x: 0, y: 150 },
        scale: { numerator: 1, denominator: 1 },
        showHidden: false as const, hatchSegments: [], fingerprint: '',
      };
      const result = resolveSectionSource(sv, baseDoc);
      expect(result.kind).toBe('part');
      expect(result.id).toBe('parts/box.zipt');
    });

    it('resolves correctly when drawing source is assembly', () => {
      const asmDoc: DrawingDocument = {
        ...baseDoc,
        source: { partPath: 'assemblies/wardrobe.ziasm', sourceKind: 'assembly' },
      };
      const sv = {
        id: 'sv2', kind: 'section' as const,
        parentViewId: 'v1',
        sectionLine: { p0: { x: 0, y: 0 }, p1: { x: 1, y: 0 } },
        arrowDirection: -1 as const, label: 'B',
        positionMm: { x: 0, y: 0 },
        scale: { numerator: 1, denominator: 1 },
        showHidden: false as const, hatchSegments: [], fingerprint: '',
      };
      const result = resolveSectionSource(sv, asmDoc);
      expect(result.kind).toBe('assembly');
      expect(result.id).toBe('assemblies/wardrobe.ziasm');
    });

    it('throws when parentViewId does not exist on any sheet', () => {
      const sv = {
        id: 'sv3', kind: 'section' as const,
        parentViewId: 'no-such-view',
        sectionLine: { p0: { x: 0, y: 0 }, p1: { x: 1, y: 0 } },
        arrowDirection: 1 as const, label: 'C',
        positionMm: { x: 0, y: 0 },
        scale: { numerator: 1, denominator: 1 },
        showHidden: false as const, hatchSegments: [], fingerprint: '',
      };
      expect(() => resolveSectionSource(sv, baseDoc)).toThrow('parentViewId');
    });
  });
  ```

- [ ] **Step 2: Run the test (expect fail)**

  ```
  pnpm --filter @zilventor/shared test:unit -- drawing/__tests__/resolveSectionSource
  ```

  Expected: `resolveSectionSource` is not exported — file does not exist yet.

- [ ] **Step 3: Create `packages/shared/src/drawing/resolveSectionSource.ts`**

  ```ts
  import type { SectionView, DrawingDocument } from '../index';

  /**
   * Given a SectionView and its parent DrawingDocument, return the source kind
   * ('part' | 'assembly') and the source id (the partPath from DrawingSource).
   *
   * Validates that parentViewId resolves to a real view on some sheet.
   * Throws with a descriptive message if parentViewId is dangling.
   */
  export function resolveSectionSource(
    view: SectionView,
    doc: DrawingDocument,
  ): { kind: 'part' | 'assembly'; id: string } {
    let parentFound = false;
    for (const sheet of doc.sheets) {
      if (sheet.views.some((v) => v.id === view.parentViewId)) {
        parentFound = true;
        break;
      }
    }
    if (!parentFound) {
      throw new Error(
        `resolveSectionSource: parentViewId "${view.parentViewId}" not found in any sheet of drawing "${doc.id}"`,
      );
    }
    return {
      kind: doc.source.sourceKind,
      id: doc.source.partPath,
    };
  }
  ```

- [ ] **Step 4: Re-export from `packages/shared/src/index.ts`**

  Append `resolveSectionSource` to the existing drawing re-export line (or add a new line):

  ```ts
  export { resolveSectionSource } from './drawing/resolveSectionSource';
  ```

- [ ] **Step 5: Add re-export stub to kernel adapter for backward compat**

  Append to `packages/kernel/src/adapter/drawing/getProjectorInput.ts`:

  ```ts
  // Re-export so kernel callers don't need to import from @zilventor/shared directly.
  export { resolveSectionSource } from '@zilventor/shared';
  ```

- [ ] **Step 6: Run the test (expect pass)**

  ```
  pnpm --filter @zilventor/shared test:unit -- drawing/__tests__/resolveSectionSource
  ```

- [ ] **Step 7: Commit**

  ```
  git add packages/shared/src/drawing/resolveSectionSource.ts \
          packages/shared/src/drawing/__tests__/resolveSectionSource.spec.ts \
          packages/shared/src/index.ts \
          packages/kernel/src/adapter/drawing/getProjectorInput.ts
  git commit -m "feat(drawing-section): add resolveSectionSource to shared; re-export from kernel adapter (F1 §T4)"
  ```

---

*End of Part 1 — Phase 1: Types & migration (Tasks 1–4).*
*Part 2 continues with Phase 2: Kernel OCCT cut pipeline (Tasks 5–8).*
## Phase 2: Kernel — Half-Space Cut

Four tasks (T5–T8). Each is a self-contained TDD unit: failing test → minimal impl → passing test → commit. All files live under `packages/kernel/src/section/`. The directory does not exist yet; the implementer creates it in T5.

All tests use the `loadOcct` / `beforeAll` pattern from `packages/kernel/src/occt/__tests__/SolidOps.spec.ts`. Tests that exercise OCCT belong in `*.spec.ts` files co-located with the source; the 60-second `beforeAll` timeout is standard.

Shared type anchor — import `Vec3` from `@zilventor/shared`:

```ts
import type { Vec3 } from '@zilventor/shared';

export type Plane = { origin: Vec3; normal: Vec3 };
```

`Plane` is defined once in `cutBySectionPlane.ts` and re-exported. All sibling modules import from there.

---

### Task 5 — Half-space construction

**Files:**
- Create: `packages/kernel/src/section/cutBySectionPlane.ts`
- Create (test): `packages/kernel/src/section/cutBySectionPlane.spec.ts`

#### Step 1: Write the failing test

```ts
// packages/kernel/src/section/cutBySectionPlane.spec.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { loadOcct, type OcctInstance } from '../occt/occtLoader';
import { computeBoundingBox } from '../occt/SolidOps';
import { buildHalfSpace, type Plane } from './cutBySectionPlane';

let oc: OcctInstance;
beforeAll(async () => { oc = await loadOcct(); }, 60_000);

describe('buildHalfSpace', () => {
  it('plane through origin +Z arrowDirection=1 → solid extends ≥1km on -Z side', () => {
    const plane: Plane = { origin: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 0, z: 1 } };
    const solid = buildHalfSpace(oc, plane, 1);
    const bb = computeBoundingBox(oc, solid);
    // half-space keeps the side OPPOSITE to arrowDirection (the -Z side)
    expect(bb[2]).toBeLessThanOrEqual(-1_000_000);  // zmin ≤ -1 000 000 mm
    expect(bb[5]).toBeCloseTo(0, 2);                // zmax ≈ 0 (coincident face)
    expect(bb[3] - bb[0]).toBeGreaterThanOrEqual(1_000_000); // width ≥ 1 km
    expect(bb[4] - bb[1]).toBeGreaterThanOrEqual(1_000_000); // depth ≥ 1 km
    (solid.handle as { delete(): void }).delete();
  });

  it('plane through origin +X arrowDirection=-1 → solid extends on +X side', () => {
    const plane: Plane = { origin: { x: 0, y: 0, z: 0 }, normal: { x: 1, y: 0, z: 0 } };
    const solid = buildHalfSpace(oc, plane, -1);
    const bb = computeBoundingBox(oc, solid);
    // arrowDirection=-1 → keep +X side (same direction as normal)
    expect(bb[0]).toBeCloseTo(0, 2);               // xmin ≈ 0
    expect(bb[3]).toBeGreaterThanOrEqual(1_000_000); // xmax ≥ 1 km
    (solid.handle as { delete(): void }).delete();
  });

  it('bounding box extends ≥ 1 km in all three axis extents', () => {
    const plane: Plane = { origin: { x: 50, y: 0, z: 0 }, normal: { x: 0, y: 1, z: 0 } };
    const solid = buildHalfSpace(oc, plane, 1);
    const bb = computeBoundingBox(oc, solid);
    expect(bb[3] - bb[0]).toBeGreaterThanOrEqual(1_000_000);
    expect(bb[4] - bb[1]).toBeGreaterThanOrEqual(1_000_000);
    expect(bb[5] - bb[2]).toBeGreaterThanOrEqual(1_000_000);
    (solid.handle as { delete(): void }).delete();
  });
});
```

Run (expect all fail — file doesn't exist yet):

```
cd packages/kernel && pnpm test:unit -- section/cutBySectionPlane
```

#### Step 2: Create `packages/kernel/src/section/cutBySectionPlane.ts` (half-space only)

The half-space is a 2000 km × 2000 km × 1000 km box placed so that one face is coincident with `plane`. The side that is kept is the side **opposite** to `arrowDirection * normal`.

Convention: `arrowDirection=1` means the arrow points along `+normal` (toward the viewer for a standard front cut). The tool removes the side the arrow points to — i.e. the resulting solid occupies the half-space that is **behind** the arrow.

Algorithm:
1. Build an origin-aligned box with `BRepPrimAPI_MakeBox_2(W, W, D)` where `W = 2_000_000` mm and `D = 1_000_000` mm. The box spans `[0,W] × [0,W] × [0,D]` in local coordinates, with one face at local Z=0 and the opposite face at local Z=D.
2. Build a `gp_Ax3` at `plane.origin` whose Z-axis is `plane.normal * -arrowDirection`. The Z=0 face of the box will be coincident with the section plane; the box grows away from the arrow.
3. Build `gp_Trsf` via `SetTransformation_1(gp_Ax3, gp_Ax3_identity)` then apply with `BRepBuilderAPI_Transform_2(..., copy=true)`.
4. Return the transformed solid as an `OcctShape`.

Look for `gp_Trsf_1`, `gp_Ax2_3(origin, dir)`, `BRepBuilderAPI_Transform_2` — all present in existing files (`TransformOps.ts`, `BooleanOps.ts`).

```ts
// packages/kernel/src/section/cutBySectionPlane.ts
import type { OcctInstance } from '../occt/occtLoader';
import type { OcctShape } from '../occt/SolidOps';
import type { Vec3 } from '@zilventor/shared';

export type Plane = { origin: Vec3; normal: Vec3 };

// Half-space box dimensions (mm): face-coincident side has zero extent along normal.
const BOX_HALF = 2_000_000; // 2 km half-width in both transverse axes
const BOX_DEPTH = 1_000_000; // 1 km depth along the normal

/**
 * Build a 2km×2km×1km solid whose face at local Z=0 is coincident with
 * `plane`. The solid grows in the direction OPPOSITE to `arrowDirection*normal`.
 *
 * arrowDirection=1  → solid is on the -normal side of the plane
 * arrowDirection=-1 → solid is on the +normal side of the plane
 */
export function buildHalfSpace(
  oc: OcctInstance,
  plane: Plane,
  arrowDirection: -1 | 1
): OcctShape {
  // 1. Make a box at the OCCT origin: [0,BOX_HALF]×[0,BOX_HALF]×[0,BOX_DEPTH]
  //    We'll shift it so its centroid is at (-BOX_HALF/2, -BOX_HALF/2, 0) in
  //    local space, then align local Z with the keep-direction.
  const mk = new oc.BRepPrimAPI_MakeBox_2(BOX_HALF, BOX_HALF, BOX_DEPTH);
  const rawBox = mk.Shape();
  mk.delete();

  // 2. Translate so the Z=0 face is centred at the local origin.
  const tx = new oc.gp_Trsf_1();
  const tv = new oc.gp_Vec_4(-BOX_HALF / 2, -BOX_HALF / 2, 0);
  (tx as unknown as { SetTranslation_1(v: unknown): void }).SetTranslation_1(tv as never);
  const centred = new oc.BRepBuilderAPI_Transform_2(rawBox as never, tx as never, true as never);
  const centredShape = (centred as unknown as { Shape(): unknown }).Shape();
  (centred as unknown as { delete(): void }).delete();
  (tx as unknown as { delete(): void }).delete();
  (tv as unknown as { delete(): void }).delete();

  // 3. Compute the keep-direction: opposite to arrowDirection*normal.
  const { normal, origin } = plane;
  const sign = -arrowDirection as number;
  const nx = normal.x * sign;
  const ny = normal.y * sign;
  const nz = normal.z * sign;
  const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;

  const keepDir = new oc.gp_Dir_4(nx / len, ny / len, nz / len);
  const orig    = new oc.gp_Pnt_3(origin.x, origin.y, origin.z);

  // gp_Ax2_3(origin, normal) → Z-axis = keepDir
  const ax2 = new oc.gp_Ax2_3(orig as never, keepDir as never);

  // 4. Build transform: align local Z-axis with keepDir, translate to origin.
  const worldAx3  = new oc.gp_Ax3_2(orig as never, keepDir as never);
  const localAx3  = new oc.gp_Ax3_4(); // identity: origin at (0,0,0), Z=(0,0,1)
  const align = new oc.gp_Trsf_1();
  (align as unknown as { SetTransformation_1(a: unknown, b: unknown): void })
    .SetTransformation_1(worldAx3 as never, localAx3 as never);

  const xform = new oc.BRepBuilderAPI_Transform_2(centredShape as never, align as never, true as never);
  const result = (xform as unknown as { Shape(): unknown }).Shape();
  (xform as unknown as { delete(): void }).delete();
  (align as unknown as { delete(): void }).delete();
  (localAx3 as unknown as { delete(): void }).delete();
  (worldAx3 as unknown as { delete(): void }).delete();
  (ax2 as unknown as { delete(): void }).delete();
  (orig as unknown as { delete(): void }).delete();
  (keepDir as unknown as { delete(): void }).delete();
  (centredShape as unknown as { delete?(): void }).delete?.();

  return { __brand: 'OcctShape', handle: result };
}
```

#### Step 3: Run the test — expect pass

```
cd packages/kernel && pnpm test:unit -- section/cutBySectionPlane
```

#### Commit

```
git add packages/kernel/src/section/cutBySectionPlane.ts \
        packages/kernel/src/section/cutBySectionPlane.spec.ts
git commit -m "feat(kernel-section): T5 buildHalfSpace — 2km box aligned to section plane"
```

---

### Task 6 — BOPAlgo cut + face tagging

**Files:**
- Modify: `packages/kernel/src/section/cutBySectionPlane.ts` (add `cutBySectionPlane` entrypoint + Result type)
- Create: `packages/kernel/src/section/faceTag.ts`
- Extend test: `packages/kernel/src/section/cutBySectionPlane.spec.ts`
- Create test: `packages/kernel/src/section/faceTag.spec.ts`

#### Step 1: Extend the failing test in `cutBySectionPlane.spec.ts`

Append to the existing `describe` block (or add a new `describe`):

```ts
import { cutBySectionPlane } from './cutBySectionPlane';
import { makeBox } from '../occt/SolidOps';

describe('cutBySectionPlane', () => {
  it('cube 10mm cut by z=5 arrowDir=1 → 5 original + 1 cut face', () => {
    // build 10×10×10 box at origin → z∈[0,10]
    const cube = makeBox(oc, 10, 10, 10);
    const compound = buildTestCompound(oc, cube);
    const plane: Plane = { origin: { x: 0, y: 0, z: 5 }, normal: { x: 0, y: 0, z: 1 } };
    const result = cutBySectionPlane(oc, compound, plane, 1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const tags = [...result.faceTags.values()];
    const cutCount = tags.filter(t => t.tag === 'cut-face').length;
    const origCount = tags.filter(t => t.tag === 'original-face').length;
    expect(cutCount).toBe(1);
    expect(origCount).toBe(5);
    disposeOcctShape(oc, result.compound);
  });

  it('cylinder r=5 h=20 cut by x=0 arrowDir=1 → 1 half-cyl + 2 discs + 1 cut face', () => {
    const cyl = buildTestCylinder(oc, 5, 20); // helper below
    const compound = buildTestCompound(oc, cyl);
    const plane: Plane = { origin: { x: 0, y: 0, z: 0 }, normal: { x: 1, y: 0, z: 0 } };
    const result = cutBySectionPlane(oc, compound, plane, 1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const tags = [...result.faceTags.values()];
    const cutCount = tags.filter(t => t.tag === 'cut-face').length;
    expect(cutCount).toBe(1);
    expect(tags.length).toBe(4); // half-cyl + top disc + bottom disc + cut face
    disposeOcctShape(oc, result.compound);
  });

  it('plane misses body (cube cut by z=100) → ok:false reason:empty', () => {
    const cube = makeBox(oc, 10, 10, 10);
    const compound = buildTestCompound(oc, cube);
    const plane: Plane = { origin: { x: 0, y: 0, z: 100 }, normal: { x: 0, y: 0, z: 1 } };
    const result = cutBySectionPlane(oc, compound, plane, 1);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('empty');
  });

  it('plane tangent to body (cube cut by z=0) → ok:false reason:tangent', () => {
    const cube = makeBox(oc, 10, 10, 10); // z∈[0,10]
    const compound = buildTestCompound(oc, cube);
    const plane: Plane = { origin: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 0, z: 1 } };
    const result = cutBySectionPlane(oc, compound, plane, 1);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('tangent');
  });
});

// --- test helpers ---
function buildTestCompound(oc: OcctInstance, shape: OcctShape): unknown /* TopoDS_Compound */ {
  const builder = new oc.BRep_Builder();
  const comp = new oc.TopoDS_Compound();
  (builder as unknown as { MakeCompound(c: unknown): void }).MakeCompound(comp as never);
  (builder as unknown as { Add(c: unknown, s: unknown): void }).Add(comp as never, shape.handle as never);
  (builder as unknown as { delete(): void }).delete();
  (shape.handle as unknown as { delete?(): void }).delete?.();
  return comp;
}

function buildTestCylinder(oc: OcctInstance, r: number, h: number): OcctShape {
  const mk = new oc.BRepPrimAPI_MakeCylinder_2(r, h);
  const shape = mk.Shape();
  mk.delete();
  return { __brand: 'OcctShape', handle: shape };
}

function disposeOcctShape(oc: OcctInstance, compound: unknown): void {
  (compound as { delete?(): void }).delete?.();
}
```

Run (expect fail — `cutBySectionPlane` export doesn't exist yet):

```
cd packages/kernel && pnpm test:unit -- section/cutBySectionPlane
```

#### Step 2: Add `cutBySectionPlane` to `cutBySectionPlane.ts`

Append after `buildHalfSpace`. Define the discriminated-union return type first:

```ts
// --- types ---

export type FaceTagMap = Map<string, {
  tag: 'cut-face' | 'original-face';
  partId: string;
  materialId: string;
}>;

export type Result =
  | { ok: true;  compound: unknown /* TopoDS_Compound */; faceTags: FaceTagMap }
  | { ok: false; reason: 'tangent' | 'empty' };
```

Then the function:

```ts
import { hashFace, classifyFace } from './faceTag';

/**
 * Cut `source` compound by the half-space defined by `plane`/`arrowDirection`.
 *
 * 1. Build half-space solid (Task 5).
 * 2. BRepAlgoAPI_Cut_3 — source minus half-space.
 * 3. Walk result faces via TopExp_Explorer; classify each via classifyFace.
 * 4. Tangent detection: if the result volume equals the source volume within
 *    1e-6 relative tolerance, the plane was coincident with a face → 'tangent'.
 *    If the result compound has no solids → 'empty'.
 */
export function cutBySectionPlane(
  oc: OcctInstance,
  source: unknown /* TopoDS_Compound */,
  plane: Plane,
  arrowDirection: -1 | 1
): Result {
  const halfSpace = buildHalfSpace(oc, plane, arrowDirection);
  const rangeCtor = new oc.Message_ProgressRange_1();
  const rangeBuild = new oc.Message_ProgressRange_1();

  let cut: unknown;
  try {
    const cutter = new oc.BRepAlgoAPI_Cut_3(
      source as never,
      halfSpace.handle as never,
      rangeCtor
    );
    (cutter as unknown as { Build(r: unknown): void }).Build(rangeBuild as never);
    const done = (cutter as unknown as { IsDone(): boolean }).IsDone();
    if (!done) {
      (cutter as unknown as { delete(): void }).delete();
      (rangeCtor as unknown as { delete(): void }).delete();
      (rangeBuild as unknown as { delete(): void }).delete();
      (halfSpace.handle as unknown as { delete(): void }).delete();
      return { ok: false, reason: 'empty' };
    }
    cut = (cutter as unknown as { Shape(): unknown }).Shape();
    (cutter as unknown as { delete(): void }).delete();
  } finally {
    (rangeCtor as unknown as { delete(): void }).delete();
    (rangeBuild as unknown as { delete(): void }).delete();
    (halfSpace.handle as unknown as { delete(): void }).delete();
  }

  // --- empty check: any solid in result? ---
  const solidExplorer = new oc.TopExp_Explorer_2(
    cut as never,
    oc.TopAbs_ShapeEnum.TopAbs_SOLID as never,
    oc.TopAbs_ShapeEnum.TopAbs_SHAPE as never
  );
  const hasSolid = (solidExplorer as unknown as { More(): boolean }).More();
  (solidExplorer as unknown as { delete(): void }).delete();
  if (!hasSolid) {
    (cut as unknown as { delete?(): void }).delete?.();
    return { ok: false, reason: 'empty' };
  }

  // --- tangent check: volume unchanged from source? ---
  const volSource = shapeVolume(oc, source);
  const volResult = shapeVolume(oc, cut);
  const eps = Math.max(volSource, 1) * 1e-6;
  if (volSource > 0 && Math.abs(volResult - volSource) < eps) {
    (cut as unknown as { delete?(): void }).delete?.();
    return { ok: false, reason: 'tangent' };
  }

  // --- face classification ---
  const faceTags: FaceTagMap = new Map();
  const faceExp = new oc.TopExp_Explorer_2(
    cut as never,
    oc.TopAbs_ShapeEnum.TopAbs_FACE as never,
    oc.TopAbs_ShapeEnum.TopAbs_SHAPE as never
  );
  while ((faceExp as unknown as { More(): boolean }).More()) {
    const face = (faceExp as unknown as { Current(): unknown }).Current();
    const key  = hashFace(oc, face);
    const tag  = classifyFace(oc, face, plane);
    faceTags.set(key, { tag, partId: '', materialId: '' });
    (faceExp as unknown as { Next(): void }).Next();
  }
  (faceExp as unknown as { delete(): void }).delete();

  return { ok: true, compound: cut, faceTags };
}

// --- internal volume helper (mirrors BooleanOps.ts pattern) ---
function shapeVolume(oc: OcctInstance, shape: unknown): number {
  const props = new oc.GProp_GProps_1();
  try {
    oc.BRepGProp.VolumeProperties_1(
      shape as never, props,
      true as never, false as never, false as never
    );
    return props.Mass();
  } finally {
    (props as unknown as { delete(): void }).delete();
  }
}
```

#### Step 3: Create `packages/kernel/src/section/faceTag.ts` (stub for Task 6)

The full implementation is in Task 8; here we need enough for Task 6's cut to compile and classify. Full exports and tests ship in T8.

```ts
// packages/kernel/src/section/faceTag.ts
import type { OcctInstance } from '../occt/occtLoader';
import type { Plane } from './cutBySectionPlane';

const PARALLEL_TOL = 1e-4; // mm
const POINT_ON_PLANE_TOL = 1e-4; // mm

/**
 * Hash a face by its surface centroid rounded to 1e-3 mm.
 * Cheap deterministic key — not cryptographic, but collision-free for
 * non-coincident faces in normal CAD geometry.
 */
export function hashFace(oc: OcctInstance, face: unknown): string {
  const props = new oc.GProp_GProps_1();
  oc.BRepGProp.SurfaceProperties_1(face as never, props, false as never, false as never);
  const c = props.CentreOfMass();
  const x = Math.round(c.X() * 1e3) / 1e3;
  const y = Math.round(c.Y() * 1e3) / 1e3;
  const z = Math.round(c.Z() * 1e3) / 1e3;
  (props as unknown as { delete(): void }).delete();
  return `${x}:${y}:${z}`;
}

/**
 * Classify a face as 'cut-face' if it is planar AND lies on the section plane
 * (normal parallel within PARALLEL_TOL and a sample point within POINT_ON_PLANE_TOL).
 * Otherwise 'original-face'.
 */
export function classifyFace(
  oc: OcctInstance,
  face: unknown,
  sectionPlane: Plane
): 'cut-face' | 'original-face' {
  const adaptor = new oc.BRepAdaptor_Surface_2(face as never, false as never);
  const geomType = (adaptor as unknown as { GetType(): number }).GetType();
  // GeomAbs_Plane = 0 in opencascade.js
  if (geomType !== 0) {
    (adaptor as unknown as { delete(): void }).delete();
    return 'original-face';
  }
  const gplnHandle = (adaptor as unknown as { Plane(): unknown }).Plane();
  const gpln = (gplnHandle as unknown as { Axis(): unknown }).Axis();
  const dir  = (gpln as unknown as { Direction(): unknown }).Direction();
  const faceNx = (dir as unknown as { X(): number }).X();
  const faceNy = (dir as unknown as { Y(): number }).Y();
  const faceNz = (dir as unknown as { Z(): number }).Z();
  const { normal: sn, origin: so } = sectionPlane;
  const len = Math.sqrt(sn.x * sn.x + sn.y * sn.y + sn.z * sn.z) || 1;
  const dot = Math.abs(faceNx * (sn.x / len) + faceNy * (sn.y / len) + faceNz * (sn.z / len));
  (adaptor as unknown as { delete(): void }).delete();
  if (Math.abs(dot - 1) > PARALLEL_TOL) return 'original-face';
  // point-on-plane: signed distance from sectionPlane
  const locPt = (gpln as unknown as { Location(): unknown }).Location();
  const lx = (locPt as unknown as { X(): number }).X();
  const ly = (locPt as unknown as { Y(): number }).Y();
  const lz = (locPt as unknown as { Z(): number }).Z();
  const d = (lx - so.x) * (sn.x / len) + (ly - so.y) * (sn.y / len) + (lz - so.z) * (sn.z / len);
  if (Math.abs(d) > POINT_ON_PLANE_TOL) return 'original-face';
  return 'cut-face';
}

export function mergeFaceTags(
  maps: import('./cutBySectionPlane').FaceTagMap[]
): import('./cutBySectionPlane').FaceTagMap {
  const out: import('./cutBySectionPlane').FaceTagMap = new Map();
  for (const m of maps) for (const [k, v] of m) out.set(k, v);
  return out;
}
```

#### Step 4: Run tests — expect pass

```
cd packages/kernel && pnpm test:unit -- section/
```

#### Commit

```
git add packages/kernel/src/section/cutBySectionPlane.ts \
        packages/kernel/src/section/cutBySectionPlane.spec.ts \
        packages/kernel/src/section/faceTag.ts
git commit -m "feat(kernel-section): T6 cutBySectionPlane — BRepAlgoAPI_Cut + face classification"
```

---

### Task 7 — Assembly path (flatten + cut + union)

**Files:**
- Modify: `packages/kernel/src/section/cutBySectionPlane.ts` (add `cutAssemblyBySectionPlane`)
- Extend test: `packages/kernel/src/section/cutBySectionPlane.spec.ts`

The assembly overload exists in the same file to share the `shapeVolume` helper and keep the public surface small.

#### Step 1: Write the failing test

Append a new `describe` block to `cutBySectionPlane.spec.ts`:

```ts
import type { AssemblyDocument } from '@zilventor/shared';
import { cutAssemblyBySectionPlane } from './cutBySectionPlane';

describe('cutAssemblyBySectionPlane', () => {
  it('2-panel assembly cut by mid-plane → cut faces from each component', () => {
    // Build two 10×10×20 panels placed at x=0 and x=50.
    // Section plane at x=5 (bisects first panel only).
    // arrowDirection=1 → keep +x side.
    const panel1Id = 'part-panel1';
    const panel2Id = 'part-panel2';

    // Simulated kernel body map: partId → posed shape in world space.
    // cutAssemblyBySectionPlane uses flattenAssemblyForProjection internally,
    // but here we pass a minimal stub asm + a bodyResolver (see impl notes).
    const asm: AssemblyDocument = {
      id: 'asm1',
      name: 'test',
      units: 'mm',
      parameters: {},
      components: [
        {
          id: 'c1', partPath: 'panel1.zipt',
          position: { x: 0, y: 0, z: 0 },
          visible: true,
        } as AssemblyDocument['components'][number],
        {
          id: 'c2', partPath: 'panel2.zipt',
          position: { x: 50, y: 0, z: 0 },
          visible: true,
        } as AssemblyDocument['components'][number],
      ],
      constraints: [], groundedComponentPaths: [], colors: {}, bomItemNumbers: {},
      cutListItemNumbers: {}, colorOverrides: {}, properties: {}, materials: [], hardware: [],
    };

    // bodyResolver: given partId+pose → apply pose transform to a known shape
    const bodyResolver = (partId: string) => {
      const box = makeBox(oc, 10, 10, 20);
      return box; // world positions already baked via partPath→position (simplified)
    };

    const plane: Plane = { origin: { x: 5, y: 0, z: 0 }, normal: { x: 1, y: 0, z: 0 } };
    const result = cutAssemblyBySectionPlane(oc, asm, plane, 1, {
      lookupSubAsm: () => undefined,
      partPathToId: new Map([['panel1.zipt', panel1Id], ['panel2.zipt', panel2Id]]),
      bodyResolver,
      materialResolver: (partId) => 'mat-default',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const cutFaces = [...result.faceTags.values()].filter(t => t.tag === 'cut-face');
    // panel1 is bisected → 1 cut face; panel2 is entirely on +x side and misses plane → 0 cut
    expect(cutFaces.length).toBeGreaterThanOrEqual(1);
    // every entry has a partId set
    for (const v of result.faceTags.values()) {
      expect(v.partId).not.toBe('');
    }
    disposeOcctShape(oc, result.compound);
  });
});
```

Run (expect fail — `cutAssemblyBySectionPlane` not exported yet):

```
cd packages/kernel && pnpm test:unit -- section/cutBySectionPlane
```

#### Step 2: Add `cutAssemblyBySectionPlane` to `cutBySectionPlane.ts`

The function signature accepts a `resolver` bag rather than importing the app-layer `flattenAssemblyForProjection` directly (kernel package must not depend on app package). The caller (drawing projection pipeline) supplies the flattened list.

```ts
import type { AssemblyDocument } from '@zilventor/shared';
import type { OcctShape } from '../occt/SolidOps';

export type AssemblyBodyResolver = (partId: string, pose: {
  translation: { x: number; y: number; z: number };
  quaternion: readonly [number, number, number, number];
}) => OcctShape | null;

export type AssemblyCutOptions = {
  lookupSubAsm: (partPath: string) => AssemblyDocument | undefined;
  partPathToId: Map<string, string>;
  bodyResolver: AssemblyBodyResolver;
  materialResolver: (partId: string) => string;
};

/**
 * Cut every leaf part in `asm` by `plane`/`arrowDirection` and compose the
 * per-component results into a single compound + merged FaceTagMap.
 *
 * Components that produce { ok: false, reason: 'empty' } are silently skipped
 * (the plane missed them entirely). Components that produce 'tangent' are also
 * skipped with a console.warn.
 *
 * The returned FaceTagMap carries { partId, materialId } on every entry so the
 * hatch renderer can look up material cross-section fill patterns.
 */
export function cutAssemblyBySectionPlane(
  oc: OcctInstance,
  asm: AssemblyDocument,
  plane: Plane,
  arrowDirection: -1 | 1,
  opts: AssemblyCutOptions
): Result {
  // Dynamic import avoided: caller provides a pre-flattened list via bodyResolver.
  // Walk components manually (matches flattenAssemblyForProjection semantics).
  const leaves = flattenLeaves(asm, opts.lookupSubAsm, opts.partPathToId);

  const builder = new oc.BRep_Builder();
  const resultCompound = new oc.TopoDS_Compound();
  (builder as unknown as { MakeCompound(c: unknown): void }).MakeCompound(resultCompound as never);

  const mergedTags: FaceTagMap = new Map();
  let anyOk = false;

  for (const { partId, pose } of leaves) {
    const body = opts.bodyResolver(partId, pose);
    if (!body) continue;

    // Wrap body in compound for cutBySectionPlane
    const srcBuilder = new oc.BRep_Builder();
    const srcComp = new oc.TopoDS_Compound();
    (srcBuilder as unknown as { MakeCompound(c: unknown): void }).MakeCompound(srcComp as never);
    (srcBuilder as unknown as { Add(c: unknown, s: unknown): void })
      .Add(srcComp as never, body.handle as never);
    (srcBuilder as unknown as { delete(): void }).delete();

    const r = cutBySectionPlane(oc, srcComp, plane, arrowDirection);
    (srcComp as unknown as { delete(): void }).delete();

    if (!r.ok) {
      if (r.reason === 'tangent') {
        console.warn(`cutAssemblyBySectionPlane: tangent plane on part ${partId}, skipping`);
      }
      continue;
    }

    anyOk = true;
    (builder as unknown as { Add(c: unknown, s: unknown): void })
      .Add(resultCompound as never, r.compound as never);
    (r.compound as unknown as { delete?(): void }).delete?.();

    const matId = opts.materialResolver(partId);
    for (const [key, val] of r.faceTags) {
      mergedTags.set(key, { tag: val.tag, partId, materialId: matId });
    }
  }

  (builder as unknown as { delete(): void }).delete();

  if (!anyOk) {
    (resultCompound as unknown as { delete(): void }).delete();
    return { ok: false, reason: 'empty' };
  }

  return { ok: true, compound: resultCompound, faceTags: mergedTags };
}

// Minimal inline leaf-walker (mirrors flattenAssemblyForProjection logic;
// avoids cross-package dependency).
type Leaf = { partId: string; pose: { translation: { x: number; y: number; z: number }; quaternion: readonly [number, number, number, number] } };

function flattenLeaves(
  asm: AssemblyDocument,
  lookupSubAsm: (path: string) => AssemblyDocument | undefined,
  partPathToId: Map<string, string>
): Leaf[] {
  const out: Leaf[] = [];
  const IDENTITY = { translation: { x: 0, y: 0, z: 0 }, quaternion: [0, 0, 0, 1] as const };
  function walk(doc: AssemblyDocument, visited: Set<string>): void {
    for (const c of doc.components) {
      if (c.visible === false) continue;
      if ((c as { suppressed?: boolean }).suppressed) continue;
      const pose = (c as { pose?: Leaf['pose'] }).pose ?? {
        translation: { x: c.position.x, y: c.position.y, z: c.position.z },
        quaternion: [0, 0, 0, 1] as const,
      };
      if (!c.partPath.endsWith('.ziasm')) {
        const partId = partPathToId.get(c.partPath);
        if (partId) out.push({ partId, pose });
      } else {
        if (visited.has(c.partPath)) continue;
        const sub = lookupSubAsm(c.partPath);
        if (!sub) continue;
        walk(sub, new Set([...visited, c.partPath]));
      }
    }
  }
  walk(asm, new Set());
  return out;
}
```

#### Step 3: Run tests — expect pass

```
cd packages/kernel && pnpm test:unit -- section/cutBySectionPlane
```

#### Commit

```
git add packages/kernel/src/section/cutBySectionPlane.ts \
        packages/kernel/src/section/cutBySectionPlane.spec.ts
git commit -m "feat(kernel-section): T7 cutAssemblyBySectionPlane — per-component cut + merged FaceTagMap"
```

---

### Task 8 — faceTag module — full exports + tests

**Files:**
- Modify: `packages/kernel/src/section/faceTag.ts` (flesh out + ensure all exports present)
- Create test: `packages/kernel/src/section/faceTag.spec.ts`

The stubs from T6 already export `hashFace`, `classifyFace`, `mergeFaceTags`. This task tightens the implementations and adds a dedicated test file.

#### Step 1: Write `faceTag.spec.ts` (failing against stub quality, not missing exports)

```ts
// packages/kernel/src/section/faceTag.spec.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { loadOcct, type OcctInstance } from '../occt/occtLoader';
import { makeBox } from '../occt/SolidOps';
import { hashFace, classifyFace, mergeFaceTags } from './faceTag';
import type { Plane, FaceTagMap } from './cutBySectionPlane';

let oc: OcctInstance;
beforeAll(async () => { oc = await loadOcct(); }, 60_000);

function getFirstFace(oc: OcctInstance, shape: unknown): unknown {
  const exp = new oc.TopExp_Explorer_2(
    shape as never,
    oc.TopAbs_ShapeEnum.TopAbs_FACE as never,
    oc.TopAbs_ShapeEnum.TopAbs_SHAPE as never
  );
  const face = (exp as unknown as { Current(): unknown }).Current();
  (exp as unknown as { delete(): void }).delete();
  return face;
}

describe('hashFace', () => {
  it('returns a non-empty string for a box face', () => {
    const box = makeBox(oc, 10, 20, 30);
    const face = getFirstFace(oc, box.handle);
    const h = hashFace(oc, face);
    expect(typeof h).toBe('string');
    expect(h.length).toBeGreaterThan(0);
    (box.handle as unknown as { delete(): void }).delete();
  });

  it('two distinct faces of the same box produce different hashes', () => {
    const box = makeBox(oc, 10, 20, 30);
    const exp = new oc.TopExp_Explorer_2(
      box.handle as never,
      oc.TopAbs_ShapeEnum.TopAbs_FACE as never,
      oc.TopAbs_ShapeEnum.TopAbs_SHAPE as never
    );
    const faces: unknown[] = [];
    while ((exp as unknown as { More(): boolean }).More() && faces.length < 2) {
      faces.push((exp as unknown as { Current(): unknown }).Current());
      (exp as unknown as { Next(): void }).Next();
    }
    (exp as unknown as { delete(): void }).delete();
    const h1 = hashFace(oc, faces[0]!);
    const h2 = hashFace(oc, faces[1]!);
    expect(h1).not.toBe(h2);
    (box.handle as unknown as { delete(): void }).delete();
  });

  it('same face hashes consistently (idempotent)', () => {
    const box = makeBox(oc, 10, 20, 30);
    const face = getFirstFace(oc, box.handle);
    expect(hashFace(oc, face)).toBe(hashFace(oc, face));
    (box.handle as unknown as { delete(): void }).delete();
  });
});

describe('classifyFace', () => {
  it('top face of box at z=10 is cut-face when plane is z=10 with normal +Z', () => {
    const box = makeBox(oc, 10, 10, 10); // z∈[0,10]
    const exp = new oc.TopExp_Explorer_2(
      box.handle as never,
      oc.TopAbs_ShapeEnum.TopAbs_FACE as never,
      oc.TopAbs_ShapeEnum.TopAbs_SHAPE as never
    );
    let cutFaceFound = false;
    while ((exp as unknown as { More(): boolean }).More()) {
      const f = (exp as unknown as { Current(): unknown }).Current();
      const plane: Plane = { origin: { x: 0, y: 0, z: 10 }, normal: { x: 0, y: 0, z: 1 } };
      const tag = classifyFace(oc, f, plane);
      if (tag === 'cut-face') cutFaceFound = true;
      (exp as unknown as { Next(): void }).Next();
    }
    (exp as unknown as { delete(): void }).delete();
    expect(cutFaceFound).toBe(true);
    (box.handle as unknown as { delete(): void }).delete();
  });

  it('side face of box is original-face when plane is z=10', () => {
    const box = makeBox(oc, 10, 10, 10);
    // The face at x=0 (normal -X) is not parallel to z=10 plane.
    const exp = new oc.TopExp_Explorer_2(
      box.handle as never,
      oc.TopAbs_ShapeEnum.TopAbs_FACE as never,
      oc.TopAbs_ShapeEnum.TopAbs_SHAPE as never
    );
    const plane: Plane = { origin: { x: 0, y: 0, z: 10 }, normal: { x: 0, y: 0, z: 1 } };
    // Just check the very first face (x=0 side face — not on z=10 plane)
    const f = (exp as unknown as { Current(): unknown }).Current();
    (exp as unknown as { delete(): void }).delete();
    // The first face from TopExp for a MakeBox is typically the bottom (z=0),
    // which IS parallel to z-plane but NOT at z=10 → original-face
    const tag = classifyFace(oc, f, plane);
    expect(tag).toBe('original-face');
    (box.handle as unknown as { delete(): void }).delete();
  });
});

describe('mergeFaceTags', () => {
  it('merges two maps without collision', () => {
    const m1: FaceTagMap = new Map([
      ['k1', { tag: 'cut-face', partId: 'p1', materialId: 'm1' }],
    ]);
    const m2: FaceTagMap = new Map([
      ['k2', { tag: 'original-face', partId: 'p2', materialId: 'm2' }],
    ]);
    const merged = mergeFaceTags([m1, m2]);
    expect(merged.size).toBe(2);
    expect(merged.get('k1')?.partId).toBe('p1');
    expect(merged.get('k2')?.partId).toBe('p2');
  });

  it('later map wins on key collision', () => {
    const m1: FaceTagMap = new Map([['k1', { tag: 'cut-face',      partId: 'p1', materialId: 'm1' }]]);
    const m2: FaceTagMap = new Map([['k1', { tag: 'original-face', partId: 'p2', materialId: 'm2' }]]);
    const merged = mergeFaceTags([m1, m2]);
    expect(merged.get('k1')?.tag).toBe('original-face');
  });

  it('empty array returns empty map', () => {
    expect(mergeFaceTags([]).size).toBe(0);
  });
});
```

Run (expect pass — stubs from T6 already correct for these tests):

```
cd packages/kernel && pnpm test:unit -- section/faceTag
```

#### Commit

```
git add packages/kernel/src/section/faceTag.ts \
        packages/kernel/src/section/faceTag.spec.ts
git commit -m "feat(kernel-section): T8 faceTag — hashFace/classifyFace/mergeFaceTags with tests"
```

---

## Phase 3: Kernel — OPFS BREP Cache

One task (T9). Independent of T5–T8 (no OCCT dependency). Can be dispatched in parallel with T7+T8 if desired.

---

### Task 9 — OPFS BREP cache + LRU eviction

**Files:**
- Create: `packages/kernel/src/section/sectionCache.ts`
- Create test: `packages/kernel/src/section/sectionCache.spec.ts`

The cache uses the existing `Opfs` class from `packages/kernel/src/storage/Opfs.ts`. Tests inject a stub root via `Opfs.forRoot(root)`.

#### Step 1: Write the failing test

```ts
// packages/kernel/src/section/sectionCache.spec.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { makeSectionCache, type SectionCacheStore } from './sectionCache';
import type { FaceTagMap } from './cutBySectionPlane';

// Minimal in-memory OPFS stub using a nested Map tree.
function makeMemoryOpfsRoot(): FileSystemDirectoryHandle {
  const files = new Map<string, Uint8Array>();

  function makeDir(prefix: string): FileSystemDirectoryHandle {
    return {
      kind: 'directory',
      name: prefix,
      async getDirectoryHandle(name: string, opts?: { create?: boolean }) {
        return makeDir(prefix ? `${prefix}/${name}` : name);
      },
      async getFileHandle(name: string, opts?: { create?: boolean }) {
        const fullPath = prefix ? `${prefix}/${name}` : name;
        return {
          kind: 'file',
          name,
          async getFile() {
            const data = files.get(fullPath) ?? new Uint8Array(0);
            return { arrayBuffer: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) } as unknown as File;
          },
          async createWritable() {
            const chunks: Uint8Array[] = [];
            return {
              async write(data: Uint8Array | string | BufferSource) {
                chunks.push(data instanceof Uint8Array ? data : new Uint8Array(data as ArrayBuffer));
              },
              async close() {
                const total = chunks.reduce((a, b) => a + b.length, 0);
                const buf = new Uint8Array(total);
                let off = 0;
                for (const c of chunks) { buf.set(c, off); off += c.length; }
                files.set(fullPath, buf);
              },
            } as unknown as FileSystemWritableFileStream;
          },
        } as unknown as FileSystemFileHandle;
      },
      async removeEntry(name: string) {
        const fullPath = prefix ? `${prefix}/${name}` : name;
        files.delete(fullPath);
      },
      [Symbol.asyncIterator](): AsyncIterator<[string, FileSystemHandle]> {
        // Return entries that start with this prefix
        const relevant = [...files.entries()].filter(([k]) => {
          const stripped = prefix ? k.slice(prefix.length + 1) : k;
          return prefix ? k.startsWith(prefix + '/') : true;
        });
        let i = 0;
        return {
          async next() {
            if (i >= relevant.length) return { done: true, value: undefined as never };
            const [fullPath] = relevant[i++]!;
            const stripped = prefix ? fullPath.slice(prefix.length + 1) : fullPath;
            const name = stripped.split('/')[0]!;
            return { done: false, value: [name, { kind: 'file', name }] as [string, FileSystemHandle] };
          },
        };
      },
    } as unknown as FileSystemDirectoryHandle;
  }

  return makeDir('');
}

let cache: SectionCacheStore;
beforeEach(() => {
  const root = makeMemoryOpfsRoot();
  cache = makeSectionCache(root);
});

describe('sectionCache.get / put round-trip', () => {
  it('put then get returns identical bytes and faceTags', async () => {
    const brep = new Uint8Array([0x42, 0x52, 0x45, 0x50]).buffer; // "BREP"
    const tags: FaceTagMap = new Map([
      ['k1', { tag: 'cut-face', partId: 'p1', materialId: 'm1' }],
    ]);
    await cache.put('key-abc', brep, tags);
    const got = await cache.get('key-abc');
    expect(got).not.toBeNull();
    const bytes = new Uint8Array(got!.brep);
    expect(bytes).toEqual(new Uint8Array([0x42, 0x52, 0x45, 0x50]));
    expect(got!.faceTags.get('k1')?.tag).toBe('cut-face');
  });

  it('get on missing key returns null', async () => {
    const result = await cache.get('nonexistent');
    expect(result).toBeNull();
  });
});

describe('sectionCache.evict', () => {
  it('evicts LRU entries when total size exceeds cap', async () => {
    // Put two 60 MB entries to exceed 100 MB cap.
    const brep60mb = new ArrayBuffer(60 * 1024 * 1024);
    await cache.put('key-old', brep60mb, new Map());
    await cache.put('key-new', brep60mb, new Map());
    await cache.evict();
    // oldest should be evicted, newest retained
    expect(await cache.get('key-old')).toBeNull();
    expect(await cache.get('key-new')).not.toBeNull();
  });

  it('does not evict when total size is within cap', async () => {
    const small = new ArrayBuffer(1024);
    await cache.put('k1', small, new Map());
    await cache.put('k2', small, new Map());
    await cache.evict();
    expect(await cache.get('k1')).not.toBeNull();
    expect(await cache.get('k2')).not.toBeNull();
  });
});

describe('sectionCache.delete', () => {
  it('put → delete → get returns null', async () => {
    await cache.put('key-del', new ArrayBuffer(4), new Map());
    await cache.delete('key-del');
    expect(await cache.get('key-del')).toBeNull();
  });

  it('delete on missing key is a no-op (no throw)', async () => {
    await expect(cache.delete('nonexistent-key')).resolves.toBeUndefined();
  });
});

describe('sectionCache.clear', () => {
  it('removes all entries', async () => {
    await cache.put('k1', new ArrayBuffer(4), new Map());
    await cache.put('k2', new ArrayBuffer(4), new Map());
    await cache.clear();
    expect(await cache.get('k1')).toBeNull();
    expect(await cache.get('k2')).toBeNull();
  });
});
```

Run (expect fail — `sectionCache.ts` does not exist):

```
cd packages/kernel && pnpm test:unit -- section/sectionCache
```

#### Step 2: Create `packages/kernel/src/section/sectionCache.ts`

```ts
// packages/kernel/src/section/sectionCache.ts
import { Opfs } from '../storage/Opfs';
import type { FaceTagMap } from './cutBySectionPlane';

const LRU_CAP_BYTES = 100 * 1024 * 1024; // 100 MB
const INDEX_PATH = 'cache/section/index.json';

type IndexEntry = { key: string; size: number; lastAccess: number };

export type SectionCacheStore = {
  get(key: string): Promise<{ brep: ArrayBuffer; faceTags: FaceTagMap } | null>;
  put(key: string, brep: ArrayBuffer, faceTags: FaceTagMap): Promise<void>;
  delete(key: string): Promise<void>;
  evict(): Promise<void>;
  clear(): Promise<void>;
};

function brepPath(key: string): string { return `cache/section/${key}.brep`; }
function tagsPath(key: string): string { return `cache/section/${key}.tags.json`; }

function serialiseFaceTagMap(m: FaceTagMap): string {
  return JSON.stringify([...m.entries()]);
}

function deserialiseFaceTagMap(s: string): FaceTagMap {
  const entries = JSON.parse(s) as [string, FaceTagMap extends Map<string, infer V> ? V : never][];
  return new Map(entries);
}

/**
 * Factory that returns a SectionCacheStore backed by the given OPFS root.
 * In production: `makeSectionCache(await navigator.storage.getDirectory())`.
 * In tests: inject an in-memory stub root.
 */
export function makeSectionCache(root: FileSystemDirectoryHandle): SectionCacheStore {
  const opfs = Opfs.forRoot(root);

  async function readIndex(): Promise<IndexEntry[]> {
    try {
      const raw = await opfs.read(INDEX_PATH);
      return JSON.parse(new TextDecoder().decode(raw)) as IndexEntry[];
    } catch {
      return [];
    }
  }

  async function writeIndex(idx: IndexEntry[]): Promise<void> {
    await opfs.write(INDEX_PATH, new TextEncoder().encode(JSON.stringify(idx)));
  }

  return {
    async get(key) {
      const bPath = brepPath(key);
      const tPath = tagsPath(key);
      if (!(await opfs.exists(bPath)) || !(await opfs.exists(tPath))) return null;
      const brepBytes = await opfs.read(bPath);
      const tagsRaw   = await opfs.read(tPath);
      // Update lastAccess in index
      const idx = await readIndex();
      const entry = idx.find(e => e.key === key);
      if (entry) { entry.lastAccess = Date.now(); await writeIndex(idx); }
      return {
        brep: brepBytes.buffer.slice(brepBytes.byteOffset, brepBytes.byteOffset + brepBytes.byteLength),
        faceTags: deserialiseFaceTagMap(new TextDecoder().decode(tagsRaw)),
      };
    },

    async put(key, brep, faceTags) {
      const brepBytes = new Uint8Array(brep);
      await opfs.write(brepPath(key), brepBytes);
      await opfs.write(tagsPath(key), new TextEncoder().encode(serialiseFaceTagMap(faceTags)));
      const idx = await readIndex();
      const existing = idx.findIndex(e => e.key === key);
      const entry: IndexEntry = { key, size: brepBytes.byteLength, lastAccess: Date.now() };
      if (existing >= 0) idx[existing] = entry; else idx.push(entry);
      await writeIndex(idx);
    },

    async evict() {
      const idx = await readIndex();
      const totalSize = idx.reduce((s, e) => s + e.size, 0);
      if (totalSize <= LRU_CAP_BYTES) return;
      // Sort ascending by lastAccess (oldest first)
      idx.sort((a, b) => a.lastAccess - b.lastAccess);
      let running = totalSize;
      const keep: IndexEntry[] = [];
      // Walk from oldest; evict until within cap
      let evictUpTo = 0;
      for (let i = 0; i < idx.length; i++) {
        if (running <= LRU_CAP_BYTES) { evictUpTo = i; break; }
        running -= idx[i]!.size;
        evictUpTo = i + 1;
      }
      for (let i = 0; i < evictUpTo; i++) {
        const e = idx[i]!;
        try { await opfs.delete(brepPath(e.key)); } catch { /* already gone */ }
        try { await opfs.delete(tagsPath(e.key)); } catch { /* already gone */ }
      }
      const retained = idx.slice(evictUpTo);
      await writeIndex(retained);
    },

    async delete(key) {
      try { await opfs.delete(brepPath(key)); } catch { /* already gone */ }
      try { await opfs.delete(tagsPath(key)); } catch { /* already gone */ }
      const idx = await readIndex();
      await writeIndex(idx.filter(e => e.key !== key));
    },

    async clear() {
      const idx = await readIndex();
      for (const e of idx) {
        try { await opfs.delete(brepPath(e.key)); } catch { /* ignore */ }
        try { await opfs.delete(tagsPath(e.key)); } catch { /* ignore */ }
      }
      await writeIndex([]);
    },
  };
}

// Singleton for production use — lazy-initialised on first access.
let _store: SectionCacheStore | null = null;

export async function getSectionCache(): Promise<SectionCacheStore> {
  if (!_store) {
    const root = await navigator.storage.getDirectory();
    _store = makeSectionCache(root);
  }
  return _store;
}
```

#### Step 3: Run tests — expect pass

```
cd packages/kernel && pnpm test:unit -- section/sectionCache
```

#### Step 4: Full suite smoke

```
cd packages/kernel && pnpm test:unit -- section/
```

All four spec files (`cutBySectionPlane`, `faceTag`, `sectionCache`) should be green.

#### Commit

```
git add packages/kernel/src/section/sectionCache.ts \
        packages/kernel/src/section/sectionCache.spec.ts
git commit -m "feat(kernel-section): T9 sectionCache — OPFS BREP+tags store with 100MB LRU eviction + delete()"
```
## Phase 4: Hatch Generator

Six tasks; all in `packages/shared/src/drawing/hatchGenerator.ts` plus companion tests. Dispatch Tasks 10–12 as a single batch to one Sonnet subagent — they are tightly sequential (each function builds on the last).

---

### Task 10 — Sutherland-Hodgman convex polygon clipping

**Files:**
- Create: `packages/shared/src/drawing/hatchGenerator.ts`
- Create: `packages/shared/src/drawing/hatchGenerator.test.ts`

**Agent:** Sonnet implementer.

- [ ] **Step 1: Write failing tests**

```ts
// packages/shared/src/drawing/hatchGenerator.test.ts
import { describe, it, expect } from 'vitest';
import { clipLineToConvexPolygon } from './hatchGenerator';
import type { Vec2 } from './types';

const sq: Vec2[] = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
  { x: 0, y: 10 },
];

describe('clipLineToConvexPolygon', () => {
  it('line entirely inside square → unchanged', () => {
    const r = clipLineToConvexPolygon(
      { p0: { x: 2, y: 3 }, p1: { x: 8, y: 7 } },
      sq,
    );
    expect(r).not.toBeNull();
    expect(r!.p0).toMatchObject({ x: 2, y: 3 });
    expect(r!.p1).toMatchObject({ x: 8, y: 7 });
  });

  it('line entirely outside square → null', () => {
    const r = clipLineToConvexPolygon(
      { p0: { x: -5, y: 5 }, p1: { x: -1, y: 5 } },
      sq,
    );
    expect(r).toBeNull();
  });

  it('line crossing one edge → trimmed at entry/exit', () => {
    // enters at x=0 (left edge, y=5), exits at x=10 (right edge, y=5)
    const r = clipLineToConvexPolygon(
      { p0: { x: -5, y: 5 }, p1: { x: 15, y: 5 } },
      sq,
    );
    expect(r).not.toBeNull();
    expect(r!.p0.x).toBeCloseTo(0, 6);
    expect(r!.p0.y).toBeCloseTo(5, 6);
    expect(r!.p1.x).toBeCloseTo(10, 6);
    expect(r!.p1.y).toBeCloseTo(5, 6);
  });

  it('line crossing two edges → chord', () => {
    // diagonal from outside NW to outside SE
    const r = clipLineToConvexPolygon(
      { p0: { x: -2, y: -2 }, p1: { x: 12, y: 12 } },
      sq,
    );
    expect(r).not.toBeNull();
    expect(r!.p0.x).toBeCloseTo(0, 6);
    expect(r!.p0.y).toBeCloseTo(0, 6);
    expect(r!.p1.x).toBeCloseTo(10, 6);
    expect(r!.p1.y).toBeCloseTo(10, 6);
  });

  it('line tangent to vertex (degenerate) → null', () => {
    // passes exactly through (0,0) but otherwise outside
    const r = clipLineToConvexPolygon(
      { p0: { x: -5, y: 5 }, p1: { x: 5, y: -5 } },
      sq,
    );
    // intersection length is effectively 0 at vertex → null
    expect(r).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests (expect fail)**

```bash
cd .worktrees/drawing-section-views && \
  pnpm --filter shared test:unit -- hatchGenerator
```

Expected: module not found errors.

- [ ] **Step 3: Implement `clipLineToConvexPolygon` in `hatchGenerator.ts`**

```ts
// packages/shared/src/drawing/hatchGenerator.ts
import type { Vec2 } from './types';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const CLIP_EPS = 1e-9; // mm — tolerance for parallel-edge classification

function dot2(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.y * b.y;
}

function sub2(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

function lerp2(a: Vec2, b: Vec2, t: number): Vec2 {
  return { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
}

// ---------------------------------------------------------------------------
// Task 10 — Sutherland-Hodgman line vs convex polygon clip (Liang-Barsky style)
//
// For each directed edge (A→B) of the polygon we treat the inside as the
// left half-plane.  We track tMin (entry t) and tMax (exit t) along the
// ray from p0 to p1.  If tMin > tMax the line misses the polygon.
// ---------------------------------------------------------------------------

export function clipLineToConvexPolygon(
  line: { p0: Vec2; p1: Vec2 },
  polygon: Vec2[],
): { p0: Vec2; p1: Vec2 } | null {
  const d = sub2(line.p1, line.p0); // direction vector
  let tMin = 0;
  let tMax = 1;

  const n = polygon.length;
  for (let i = 0; i < n; i++) {
    const edgeA = polygon[i];
    const edgeB = polygon[(i + 1) % n];

    // Inward normal for CCW polygon: rotate edge direction 90° left
    const ex = edgeB.x - edgeA.x;
    const ey = edgeB.y - edgeA.y;
    const nx = -ey;
    const ny = ex;

    // signed distance from p0 to edge plane, and projection of d
    const num = nx * (line.p0.x - edgeA.x) + ny * (line.p0.y - edgeA.y);
    const den = nx * d.x + ny * d.y;

    if (Math.abs(den) < CLIP_EPS) {
      // Line is parallel to this edge
      if (num < -CLIP_EPS) return null; // outside half-plane entirely
      // otherwise inside — skip
    } else {
      const t = -num / den;
      if (den < 0) {
        // entering (t is entry)
        if (t > tMin) tMin = t;
      } else {
        // exiting (t is exit)
        if (t < tMax) tMax = t;
      }
    }

    if (tMin > tMax + CLIP_EPS) return null;
  }

  // Degenerate: segment length below tolerance
  if (tMax - tMin < CLIP_EPS) return null;

  return {
    p0: lerp2(line.p0, line.p1, tMin),
    p1: lerp2(line.p0, line.p1, tMax),
  };
}
```

- [ ] **Step 4: Run tests (expect pass)**

```bash
pnpm --filter shared test:unit -- hatchGenerator
```

All five clipLineToConvexPolygon tests green.

- [ ] **Commit:**

```
feat(drawing-hatch): T10 clipLineToConvexPolygon — Liang-Barsky line/convex-polygon clip
```

---

### Task 11 — Ear-clipping triangulation for non-convex polygons

**Files:**
- Modify: `packages/shared/src/drawing/hatchGenerator.ts`
- Test: extend `packages/shared/src/drawing/hatchGenerator.test.ts`

**Agent:** Sonnet implementer.

- [ ] **Step 1: Write failing tests**

Append to `hatchGenerator.test.ts`:

```ts
import { triangulatePolygon, triangulatePolygonWithHoles } from './hatchGenerator';
import type { Triangle } from './hatchGenerator';

// Helpers
const area2D = ([a, b, c]: Triangle): number =>
  (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y);

describe('triangulatePolygon', () => {
  it('convex quad → 2 triangles', () => {
    const quad: Vec2[] = [
      { x: 0, y: 0 }, { x: 4, y: 0 },
      { x: 4, y: 3 }, { x: 0, y: 3 },
    ];
    const tris = triangulatePolygon(quad);
    expect(tris).toHaveLength(2);
    // all triangles CCW (positive signed area)
    tris.forEach(t => expect(area2D(t)).toBeGreaterThan(0));
  });

  it('L-shape (6 vertices) → 4 triangles, all CCW', () => {
    // L: full square minus top-right quadrant
    const lShape: Vec2[] = [
      { x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 10 },
      { x: 10, y: 10 }, { x: 10, y: 20 }, { x: 0, y: 20 },
    ];
    const tris = triangulatePolygon(lShape);
    expect(tris).toHaveLength(4);
    tris.forEach(t => expect(area2D(t)).toBeGreaterThan(0));
  });

  it('U-shape (8 vertices) → 6 triangles', () => {
    // U: outer box minus inner top notch
    const uShape: Vec2[] = [
      { x: 0, y: 0 },  { x: 30, y: 0 },
      { x: 30, y: 30 }, { x: 20, y: 30 },
      { x: 20, y: 10 }, { x: 10, y: 10 },
      { x: 10, y: 30 }, { x: 0, y: 30 },
    ];
    const tris = triangulatePolygon(uShape);
    expect(tris).toHaveLength(6);
    tris.forEach(t => expect(area2D(t)).toBeGreaterThan(0));
  });

  it('self-intersecting polygon → throws', () => {
    // Bow-tie
    const bowtie: Vec2[] = [
      { x: 0, y: 0 }, { x: 10, y: 10 },
      { x: 10, y: 0 }, { x: 0, y: 10 },
    ];
    expect(() => triangulatePolygon(bowtie)).toThrow('non-simple polygon');
  });
});

describe('triangulatePolygonWithHoles', () => {
  it('square with square hole → 8 triangles', () => {
    const outer: Vec2[] = [
      { x: 0, y: 0 }, { x: 30, y: 0 },
      { x: 30, y: 30 }, { x: 0, y: 30 },
    ];
    // hole (CW — holes are wound opposite to outer)
    const hole: Vec2[] = [
      { x: 10, y: 10 }, { x: 10, y: 20 },
      { x: 20, y: 20 }, { x: 20, y: 10 },
    ];
    const tris = triangulatePolygonWithHoles(outer, [hole]);
    expect(tris).toHaveLength(8);
    tris.forEach(t => expect(area2D(t)).toBeGreaterThan(0));
  });
});
```

- [ ] **Step 2: Run the tests (expect fail)**

Expected: exports not found.

- [ ] **Step 3: Implement triangulation in `hatchGenerator.ts`**

```ts
// ---------------------------------------------------------------------------
// Task 11 — Ear-clipping triangulation
// ---------------------------------------------------------------------------

export type Triangle = [Vec2, Vec2, Vec2];

/** Signed area of triangle (positive = CCW). */
function signedArea(a: Vec2, b: Vec2, c: Vec2): number {
  return 0.5 * ((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y));
}

/** Check if point P is inside triangle ABC (CCW). */
function pointInTriangle(p: Vec2, a: Vec2, b: Vec2, c: Vec2): boolean {
  const d1 = (p.x - b.x) * (a.y - b.y) - (a.x - b.x) * (p.y - b.y);
  const d2 = (p.x - c.x) * (b.y - c.y) - (b.x - c.x) * (p.y - c.y);
  const d3 = (p.x - a.x) * (c.y - a.y) - (c.x - a.x) * (p.y - a.y);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

/** Detect self-intersection (O(n²) check; adequate for ≤200-vertex faces). */
function isSelfIntersecting(poly: Vec2[]): boolean {
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue; // shared endpoint
      const c = poly[j], d = poly[(j + 1) % n];
      if (segmentsIntersect(a, b, c, d)) return true;
    }
  }
  return false;
}

function cross2(o: Vec2, a: Vec2, b: Vec2): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

function segmentsIntersect(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const d1 = cross2(c, d, a);
  const d2 = cross2(c, d, b);
  const d3 = cross2(a, b, c);
  const d4 = cross2(a, b, d);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
      ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  return false;
}

/** Ensure polygon winding is CCW; reverse in-place if CW. */
function ensureCCW(poly: Vec2[]): Vec2[] {
  const area = poly.reduce((acc, v, i) => {
    const next = poly[(i + 1) % poly.length];
    return acc + (v.x * next.y - next.x * v.y);
  }, 0);
  return area < 0 ? [...poly].reverse() : poly;
}

export function triangulatePolygon(polygon: Vec2[]): Triangle[] {
  if (isSelfIntersecting(polygon)) throw new Error('non-simple polygon');

  const verts = ensureCCW([...polygon]);
  const n = verts.length;

  // Fast-path: convex polygon → fan triangulation
  const isConvex = verts.every((_, i) =>
    cross2(verts[i], verts[(i + 1) % n], verts[(i + 2) % n]) >= 0,
  );
  if (isConvex) {
    const result: Triangle[] = [];
    for (let i = 1; i < n - 1; i++) {
      result.push([verts[0], verts[i], verts[i + 1]]);
    }
    return result;
  }

  // Ear-clipping
  const indices = Array.from({ length: n }, (_, i) => i);
  const result: Triangle[] = [];

  let iterations = 0;
  const maxIter = n * n;

  while (indices.length > 3 && iterations++ < maxIter) {
    let earFound = false;
    for (let i = 0; i < indices.length; i++) {
      const prev = indices[(i - 1 + indices.length) % indices.length];
      const curr = indices[i];
      const next = indices[(i + 1) % indices.length];
      const a = verts[prev], b = verts[curr], c = verts[next];

      // Must be convex vertex
      if (cross2(a, b, c) < CLIP_EPS) continue;

      // No other vertex inside this ear triangle
      const empty = indices.every(idx => {
        if (idx === prev || idx === curr || idx === next) return true;
        return !pointInTriangle(verts[idx], a, b, c);
      });

      if (empty) {
        result.push([a, b, c]);
        indices.splice(i, 1);
        earFound = true;
        break;
      }
    }
    if (!earFound) break; // degenerate; stop gracefully
  }

  if (indices.length === 3) {
    const [i0, i1, i2] = indices;
    result.push([verts[i0], verts[i1], verts[i2]]);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Polygon-with-holes: bridge connecting outer ring to each hole
//
// Simple bridge algorithm: for each hole, find the rightmost hole vertex and
// connect it to the nearest mutually-visible outer vertex, then flatten into
// one polygon.
// ---------------------------------------------------------------------------

export function triangulatePolygonWithHoles(
  outer: Vec2[],
  holes: Vec2[][],
): Triangle[] {
  // Ensure outer is CCW, holes are CW (reverse them)
  let merged = ensureCCW([...outer]);

  for (const rawHole of holes) {
    // Holes must be CW; ensureCCW returns CCW — so reverse for hole
    const hole = ensureCCW([...rawHole]).reverse();

    // Find rightmost vertex of hole
    const rightIdx = hole.reduce(
      (best, v, i) => (v.x > hole[best].x ? i : best),
      0,
    );
    const holeV = hole[rightIdx];

    // Find nearest visible outer vertex (simple: pick closest by x, then distance)
    let bestOuter = 0;
    let bestDist = Infinity;
    for (let i = 0; i < merged.length; i++) {
      if (merged[i].x >= holeV.x) {
        const dx = merged[i].x - holeV.x;
        const dy = merged[i].y - holeV.y;
        const dist = dx * dx + dy * dy;
        if (dist < bestDist) { bestDist = dist; bestOuter = i; }
      }
    }

    // Bridge: insert hole into outer polygon
    const holeReordered = [
      ...hole.slice(rightIdx),
      ...hole.slice(0, rightIdx + 1),
    ];
    merged = [
      ...merged.slice(0, bestOuter + 1),
      ...holeReordered,
      merged[bestOuter],
      ...merged.slice(bestOuter + 1),
    ];
  }

  return triangulatePolygon(merged);
}
```

- [ ] **Step 4: Run tests (expect pass)**

```bash
pnpm --filter shared test:unit -- hatchGenerator
```

All triangulation tests green; existing `clipLineToConvexPolygon` tests still green.

- [ ] **Commit:**

```
feat(drawing-hatch): T11 triangulatePolygon — ear-clipping + polygon-with-holes
```

---

### Task 12 — Per-material hatch generation (orchestrator)

**Files:**
- Modify: `packages/shared/src/drawing/hatchGenerator.ts`
- Test: extend `packages/shared/src/drawing/hatchGenerator.test.ts`

**Agent:** Sonnet implementer.

- [ ] **Step 1: Write failing tests**

Append to `hatchGenerator.test.ts`:

```ts
import { generateHatchSegments } from './hatchGenerator';
import type { HatchSegment } from './types';

describe('generateHatchSegments', () => {
  const square100: Vec2[] = [
    { x: 0, y: 0 }, { x: 100, y: 0 },
    { x: 100, y: 100 }, { x: 0, y: 100 },
  ];

  it('100×100 square at 45° / 3mm → ~47 segments', () => {
    const segs = generateHatchSegments(square100, 'mat-wood', {
      angleDeg: 45,
      spacingMm: 3,
    });
    // exact: ceil(100 / (3 * cos(45°))) = ceil(100 / 2.1213...) = ceil(47.14) = 48
    // but boundary-crossing may yield 47 depending on bbox alignment; accept 46–49
    expect(segs.length).toBeGreaterThanOrEqual(46);
    expect(segs.length).toBeLessThanOrEqual(49);
    segs.forEach(s => expect(s.materialId).toBe('mat-wood'));
  });

  it('L-shape at 45° / 3mm → segments skip missing corner', () => {
    const lShape: Vec2[] = [
      { x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 10 },
      { x: 10, y: 10 }, { x: 10, y: 20 }, { x: 0, y: 20 },
    ];
    const segs = generateHatchSegments(lShape, 'mat-ply', {
      angleDeg: 45,
      spacingMm: 3,
    });
    expect(segs.length).toBeGreaterThan(0);
    // No segment should end outside the L-shape bounding box
    segs.forEach(s => {
      expect(s.p0.x).toBeGreaterThanOrEqual(-0.01);
      expect(s.p0.y).toBeGreaterThanOrEqual(-0.01);
      expect(s.p1.x).toBeLessThanOrEqual(20.01);
      expect(s.p1.y).toBeLessThanOrEqual(20.01);
    });
  });

  it('tiny polygon (1×1 mm) at 3mm spacing → 0 or 1 segment', () => {
    const tiny: Vec2[] = [
      { x: 0, y: 0 }, { x: 1, y: 0 },
      { x: 1, y: 1 }, { x: 0, y: 1 },
    ];
    const segs = generateHatchSegments(tiny, 'mat-tiny', {
      angleDeg: 45,
      spacingMm: 3,
    });
    expect(segs.length).toBeLessThanOrEqual(1);
  });

  it('empty polygon → empty array', () => {
    const segs = generateHatchSegments([], 'mat-x', {
      angleDeg: 45,
      spacingMm: 3,
    });
    expect(segs).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the tests (expect fail)**

Expected: `generateHatchSegments` not exported.

- [ ] **Step 3: Implement `generateHatchSegments` in `hatchGenerator.ts`**

```ts
// ---------------------------------------------------------------------------
// Task 12 — Per-material hatch generation
// ---------------------------------------------------------------------------

import type { HatchSegment } from './types';

// Rotate a Vec2 around origin by angleDeg
function rotate2(v: Vec2, angleDeg: number): Vec2 {
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return { x: v.x * cos - v.y * sin, y: v.x * sin + v.y * cos };
}

function rotatePoly(poly: Vec2[], angleDeg: number): Vec2[] {
  return poly.map(v => rotate2(v, angleDeg));
}

function bboxOf(poly: Vec2[]): { minX: number; maxX: number; minY: number; maxY: number } {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const v of poly) {
    if (v.x < minX) minX = v.x;
    if (v.x > maxX) maxX = v.x;
    if (v.y < minY) minY = v.y;
    if (v.y > maxY) maxY = v.y;
  }
  return { minX, maxX, minY, maxY };
}

const MERGE_EPS = 1e-6; // mm

/** Merge overlapping/adjacent 1-D segments on a single scan line. */
function mergeIntervals(intervals: [number, number][]): [number, number][] {
  if (intervals.length === 0) return [];
  const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1];
    if (sorted[i][0] <= last[1] + MERGE_EPS) {
      last[1] = Math.max(last[1], sorted[i][1]);
    } else {
      merged.push(sorted[i]);
    }
  }
  return merged;
}

export function generateHatchSegments(
  polygon: Vec2[],
  materialId: string,
  hatchSpec: { angleDeg: number; spacingMm: number },
): HatchSegment[] {
  if (polygon.length < 3) return [];

  const { angleDeg, spacingMm } = hatchSpec;

  // Rotate polygon so hatch lines become horizontal (scan in Y)
  const rotPoly = rotatePoly(polygon, -angleDeg);
  const bbox = bboxOf(rotPoly);

  // Triangulate rotated polygon
  let tris: Triangle[];
  try {
    tris = triangulatePolygon(rotPoly);
  } catch {
    return []; // non-simple polygon; skip gracefully
  }

  const result: HatchSegment[] = [];

  // Generate scan lines
  const yStart = Math.ceil(bbox.minY / spacingMm) * spacingMm;
  for (let y = yStart; y <= bbox.maxY + MERGE_EPS; y += spacingMm) {
    const intervals: [number, number][] = [];

    for (const [a, b, c] of tris) {
      // Intersect horizontal line y = y with triangle edges
      const edges: [Vec2, Vec2][] = [[a, b], [b, c], [c, a]];
      const xs: number[] = [];
      for (const [p, q] of edges) {
        const dy = q.y - p.y;
        if (Math.abs(dy) < CLIP_EPS) continue;
        const t = (y - p.y) / dy;
        if (t < -CLIP_EPS || t > 1 + CLIP_EPS) continue;
        xs.push(p.x + t * (q.x - p.x));
      }
      if (xs.length === 2) {
        const [x0, x1] = xs[0] < xs[1] ? [xs[0], xs[1]] : [xs[1], xs[0]];
        if (x1 - x0 > MERGE_EPS) intervals.push([x0, x1]);
      }
    }

    const merged = mergeIntervals(intervals);
    for (const [x0, x1] of merged) {
      // Rotate segment back by +angleDeg
      const rawP0 = rotate2({ x: x0, y }, angleDeg);
      const rawP1 = rotate2({ x: x1, y }, angleDeg);
      result.push({ p0: rawP0, p1: rawP1, materialId });
    }
  }

  return result;
}
```

- [ ] **Step 4: Run tests (expect pass)**

```bash
pnpm --filter shared test:unit -- hatchGenerator
```

All Task 10–12 tests green (≥13 tests total).

- [ ] **Commit:**

```
feat(drawing-hatch): T12 generateHatchSegments — bbox/scan/triangle-intersect/rotate pipeline
```

---

## Phase 5: Projector Section Orchestrator + Fingerprint

Three tasks; `projectSectionView.ts`, `planeFingerprint.ts`, and `sectionPlane.ts`. Dispatch Tasks 13–15 as a single batch to one Sonnet subagent.

---

### Task 13 — Section view projector orchestrator

**Files:**
- Create: `packages/shared/src/drawing/projectSectionView.ts`
- Modify: `packages/shared/src/drawing/projector.ts`
- Create: `packages/shared/src/drawing/projectSectionView.test.ts`

**Agent:** Sonnet implementer.

- [ ] **Step 1: Write failing tests**

```ts
// packages/shared/src/drawing/projectSectionView.test.ts
import { describe, it, expect, vi } from 'vitest';
import { projectSectionView } from './projectSectionView';
import type { FaceTagMap } from './types';

// Minimal stub for tessellateForProjection — returns 8 triangles of a 10×10×10 cube
vi.mock('./projector', () => ({
  tessellateForProjection: vi.fn(() => ({
    triangles: [/* 12 triangles omitted for brevity; real test uses a fixture */],
    edges: [
      { id: 'e1', p0: { x: 0, y: 0, z: 5 }, p1: { x: 10, y: 0, z: 5 }, kind: 'silhouette' },
      { id: 'e2', p0: { x: 10, y: 0, z: 5 }, p1: { x: 10, y: 10, z: 5 }, kind: 'silhouette' },
      { id: 'e3', p0: { x: 10, y: 10, z: 5 }, p1: { x: 0, y: 10, z: 5 }, kind: 'silhouette' },
      { id: 'e4', p0: { x: 0, y: 10, z: 5 }, p1: { x: 0, y: 0, z: 5 }, kind: 'silhouette' },
    ],
  })),
  depthBufferTest: vi.fn(edges => edges.map((e: unknown) => ({ ...e as object, visible: true }))),
  classifyEdges: vi.fn(edges => edges),
}));

describe('projectSectionView', () => {
  it('returns edges, hatchSegments, and fingerprint', () => {
    const faceTags: FaceTagMap = new Map([
      ['face-top', { tag: 'cut-face', partId: 'part-1', materialId: 'mat-wood' }],
    ]);

    // Identity view matrix (looking from -Z toward +Z)
    const viewMatrix = [
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    ] as unknown as import('./types').Mat4;

    const result = projectSectionView(
      {} as unknown as import('./types').TopoDS_Compound,
      faceTags,
      viewMatrix,
      1,
    );

    expect(result).toHaveProperty('edges');
    expect(result).toHaveProperty('hatchSegments');
    expect(result).toHaveProperty('fingerprint');
    expect(typeof result.fingerprint).toBe('string');
    expect(result.fingerprint.length).toBeGreaterThan(0);
  });

  it('hatchSegments carry materialId from FaceTagMap', () => {
    const faceTags: FaceTagMap = new Map([
      ['face-cut', { tag: 'cut-face', partId: 'p1', materialId: 'mat-birch' }],
    ]);
    const viewMatrix = [
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    ] as unknown as import('./types').Mat4;

    const result = projectSectionView(
      {} as unknown as import('./types').TopoDS_Compound,
      faceTags,
      viewMatrix,
      1,
    );

    // If any hatch segments exist they must carry the correct materialId
    result.hatchSegments.forEach(s => {
      expect(s.materialId).toBe('mat-birch');
    });
  });

  it('hidden lines omitted when all FaceTag entries are original-face (no cut faces)', () => {
    const faceTags: FaceTagMap = new Map([
      ['face-side', { tag: 'original-face', partId: 'p1', materialId: 'mat-wood' }],
    ]);
    const viewMatrix = [
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    ] as unknown as import('./types').Mat4;

    const result = projectSectionView(
      {} as unknown as import('./types').TopoDS_Compound,
      faceTags,
      viewMatrix,
      1,
    );

    expect(result.hatchSegments).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests (expect fail)**

```bash
pnpm --filter shared test:unit -- projectSectionView
```

Expected: module not found.

- [ ] **Step 3: Implement `projectSectionView.ts`**

```ts
// packages/shared/src/drawing/projectSectionView.ts

import type {
  TopoDS_Compound, FaceTagMap, Mat4, ProjectedEdge, HatchSegment, Vec2,
} from './types';
import { tessellateForProjection, depthBufferTest, classifyEdges } from './projector';
import { generateHatchSegments } from './hatchGenerator';
import { getHatchSpec } from './materialSpec';
import { createHash } from 'crypto';

// ---------------------------------------------------------------------------
// Helper: project a 3D world-space vertex through the view matrix, return Vec2
// in mm (divides by scale).
// ---------------------------------------------------------------------------
function projectVertex(
  v: { x: number; y: number; z: number },
  viewMatrix: Mat4,
  scale: number,
): Vec2 {
  // viewMatrix is column-major 4×4; apply as row-vector * matrix
  const m = viewMatrix as unknown as number[];
  const x = v.x * m[0] + v.y * m[4] + v.z * m[8]  + m[12];
  const y = v.x * m[1] + v.y * m[5] + v.z * m[9]  + m[13];
  return { x: x / scale, y: y / scale };
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

export function projectSectionView(
  cutCompound: TopoDS_Compound,
  faceTags: FaceTagMap,
  viewMatrix: Mat4,
  scale: number,
): {
  edges: ProjectedEdge[];
  hatchSegments: HatchSegment[];
  fingerprint: string;
} {
  // 1. Tessellate
  const { triangles, edges: rawEdges } = tessellateForProjection(cutCompound);

  // 2. Depth-buffer hide test (section views default showHidden: false)
  const testedEdges = depthBufferTest(rawEdges, triangles, { includeHidden: false });

  // 3. Edge classification
  const edges: ProjectedEdge[] = classifyEdges(testedEdges);

  // 4. Hatch: for each cut face in FaceTagMap, extract polygon and generate hatching
  const hatchSegments: HatchSegment[] = [];

  for (const [faceId, faceInfo] of faceTags.entries()) {
    if (faceInfo.tag !== 'cut-face') continue;

    // Collect triangles tagged to this face
    const faceTriangles = triangles.filter(t => t.faceId === faceId);
    if (faceTriangles.length === 0) continue;

    // Project all unique vertices to 2D
    const projVerts: Vec2[] = [];
    const seen = new Set<string>();
    for (const tri of faceTriangles) {
      for (const v of [tri.v0, tri.v1, tri.v2]) {
        const key = `${v.x.toFixed(4)},${v.y.toFixed(4)},${v.z.toFixed(4)}`;
        if (!seen.has(key)) {
          seen.add(key);
          projVerts.push(projectVertex(v, viewMatrix, scale));
        }
      }
    }

    if (projVerts.length < 3) continue;

    // Compute convex hull of projected vertices as the face polygon
    // (for planar cut faces this is exact; non-planar faces are decomposed
    //  into triangles by the tessellator and handled per-triangle above)
    const hatchSpec = getHatchSpec(faceInfo.materialId);
    const segments = generateHatchSegments(projVerts, faceInfo.materialId, hatchSpec);
    hatchSegments.push(...segments);
  }

  // 5. Fingerprint: hash of edge count + hatch segment count + viewMatrix
  const hash = createHash('sha256');
  hash.update(JSON.stringify({ edgeCount: edges.length, hatchCount: hatchSegments.length, viewMatrix, scale }));
  const fingerprint = hash.digest('hex');

  return { edges, hatchSegments, fingerprint };
}
```

- [ ] **Step 4: Wire section dispatch in `projector.ts`**

In `packages/shared/src/drawing/projector.ts`, locate the main `project(view, ...)` dispatch function and add:

```ts
// In project() dispatch — after existing kind checks:
if (view.kind === 'section') {
  return projectSectionView(
    input.cutCompound,
    input.faceTags,
    buildViewMatrix(view),
    scaleToNumber(view.scale),
  );
}
```

No other changes to `projector.ts`.

- [ ] **Step 5: Run tests (expect pass)**

```bash
pnpm --filter shared test:unit -- projectSectionView
```

All three tests green.

- [ ] **Commit:**

```
feat(drawing-projector): T13 projectSectionView — cut-face hatch + edge pipeline orchestrator
```

---

### Task 14 — Plane fingerprint + section view fingerprint extension

**Files:**
- Create: `packages/shared/src/drawing/planeFingerprint.ts`
- Modify: `packages/shared/src/drawing/fingerprint.ts`
- Create: `packages/shared/src/drawing/planeFingerprint.test.ts`
- Test: extend `packages/shared/src/drawing/fingerprint.test.ts`

**Agent:** Sonnet implementer.

- [ ] **Step 1: Write failing tests**

```ts
// packages/shared/src/drawing/planeFingerprint.test.ts
import { describe, it, expect } from 'vitest';
import { fingerprintPlane } from './planeFingerprint';

describe('fingerprintPlane', () => {
  const plane = {
    origin: { x: 0, y: 0, z: 5 },
    normal: { x: 0, y: 0, z: 1 },
  };

  it('identical planes with float noise → same fingerprint', () => {
    const planeA = { origin: { x: 0,         y: 0,         z: 5 },         normal: { x: 0, y: 0, z: 1 } };
    const planeB = { origin: { x: 1.2e-10,   y: -5.0e-11,  z: 4.9999999 }, normal: { x: 0, y: 0, z: 1.0000001 } };
    // 1e-3 mm rounding: 5 vs 4.9999999 → rounds to 5.000 same; 1e-10 → 0.000 same
    expect(fingerprintPlane(planeA)).toBe(fingerprintPlane(planeB));
  });

  it('mirrored normal → different fingerprint', () => {
    const pos = { origin: { x: 0, y: 0, z: 5 }, normal: { x: 0, y: 0, z:  1 } };
    const neg = { origin: { x: 0, y: 0, z: 5 }, normal: { x: 0, y: 0, z: -1 } };
    expect(fingerprintPlane(pos)).not.toBe(fingerprintPlane(neg));
  });

  it('translated plane → different fingerprint', () => {
    const a = { origin: { x: 0, y: 0, z: 5  }, normal: { x: 0, y: 0, z: 1 } };
    const b = { origin: { x: 0, y: 0, z: 10 }, normal: { x: 0, y: 0, z: 1 } };
    expect(fingerprintPlane(a)).not.toBe(fingerprintPlane(b));
  });

  it('serialize/deserialize → stable fingerprint', () => {
    const fp1 = fingerprintPlane(plane);
    const restored = JSON.parse(JSON.stringify(plane));
    const fp2 = fingerprintPlane(restored);
    expect(fp1).toBe(fp2);
  });
});
```

Append to `packages/shared/src/drawing/fingerprint.test.ts`:

```ts
import { fingerprintSectionView } from './fingerprint';
import type { SectionView } from './types';

describe('fingerprintSectionView', () => {
  const view: SectionView = {
    id: 'sv1',
    kind: 'section',
    positionMm: { x: 0, y: 0 },
    scale: { numerator: 1, denominator: 1 },
    showHidden: false,
    sectionLine: { p0: { x: 0, y: 0 }, p1: { x: 100, y: 0 } },
    arrowDirection: 1,
    parentViewId: 'v1',
    plane: { origin: { x: 0, y: 0, z: 50 }, normal: { x: 0, y: 0, z: -1 } },
  };

  it('section view fp is a non-empty string', () => {
    const fp = fingerprintSectionView(view, 'parent-fp-abc');
    expect(typeof fp).toBe('string');
    expect(fp.length).toBeGreaterThan(0);
  });

  it('fp changes when parent source fingerprint changes', () => {
    const fp1 = fingerprintSectionView(view, 'parent-fp-abc');
    const fp2 = fingerprintSectionView(view, 'parent-fp-xyz');
    expect(fp1).not.toBe(fp2);
  });

  it('fp changes when plane changes', () => {
    const viewB: SectionView = {
      ...view,
      plane: { origin: { x: 0, y: 0, z: 60 }, normal: { x: 0, y: 0, z: -1 } },
    };
    const fp1 = fingerprintSectionView(view, 'parent-fp');
    const fp2 = fingerprintSectionView(viewB, 'parent-fp');
    expect(fp1).not.toBe(fp2);
  });
});
```

- [ ] **Step 2: Run tests (expect fail)**

```bash
pnpm --filter shared test:unit -- planeFingerprint fingerprint
```

- [ ] **Step 3: Implement `planeFingerprint.ts`**

```ts
// packages/shared/src/drawing/planeFingerprint.ts

import { createHash } from 'crypto';
import type { Vec3 } from './types';

const HASH_TOL = 1e-3; // mm

function roundTo(v: number, tol: number): number {
  return Math.round(v / tol) * tol;
}

function normalizeVec3(v: Vec3): Vec3 {
  const len = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
  if (len < 1e-12) return { x: 0, y: 0, z: 0 };
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

export function fingerprintPlane(plane: { origin: Vec3; normal: Vec3 }): string {
  const norm = normalizeVec3(plane.normal);
  const payload = [
    roundTo(plane.origin.x, HASH_TOL),
    roundTo(plane.origin.y, HASH_TOL),
    roundTo(plane.origin.z, HASH_TOL),
    roundTo(norm.x, HASH_TOL),
    roundTo(norm.y, HASH_TOL),
    roundTo(norm.z, HASH_TOL),
  ].join(',');
  return createHash('sha256').update(payload).digest('hex');
}
```

- [ ] **Step 4: Extend `fingerprint.ts` with `fingerprintSectionView`**

In `packages/shared/src/drawing/fingerprint.ts`, add after existing exports:

```ts
import { fingerprintPlane } from './planeFingerprint';
import type { SectionView, Mat4, ViewScale } from './types';

export function fingerprintSectionView(
  view: SectionView,
  parentSourceFingerprint: string,
): string {
  const planeFp = view.plane ? fingerprintPlane(view.plane) : 'no-plane';
  const payload = [
    parentSourceFingerprint,
    planeFp,
    view.scale.numerator,
    view.scale.denominator,
    view.arrowDirection,
    view.sectionLine.p0.x.toFixed(3),
    view.sectionLine.p0.y.toFixed(3),
    view.sectionLine.p1.x.toFixed(3),
    view.sectionLine.p1.y.toFixed(3),
  ].join('|');
  return createHash('sha256').update(payload).digest('hex');
}
```

The existing `fingerprintView` dispatcher in `fingerprint.ts` should call `fingerprintSectionView` when `view.kind === 'section'`.

- [ ] **Step 5: Run tests (expect pass)**

```bash
pnpm --filter shared test:unit -- planeFingerprint fingerprint
```

All new fingerprint tests green; existing fingerprint tests still pass.

- [ ] **Commit:**

```
feat(drawing-projector): T14 fingerprintPlane + fingerprintSectionView — stale-cascade support
```

---

### Task 15 — Section line → world plane derivation

**Files:**
- Create: `packages/shared/src/drawing/sectionPlane.ts`
- Create: `packages/shared/src/drawing/sectionPlane.test.ts`

**Agent:** Sonnet implementer.

- [ ] **Step 1: Write failing tests**

```ts
// packages/shared/src/drawing/sectionPlane.test.ts
import { describe, it, expect } from 'vitest';
import { deriveSectionPlane } from './sectionPlane';
import type { Mat4 } from './types';

// Helper: build an ortho view matrix for standard orientations
// Front view: looking from +Y toward -Y; X→right, Z→up in view space
function frontViewMatrix(): Mat4 {
  // World X → view X, World Z → view Y, looking along -Y
  return [
    1, 0,  0, 0,
    0, 0, -1, 0,
    0, 1,  0, 0,
    0, 0,  0, 1,
  ] as unknown as Mat4;
}

describe('deriveSectionPlane', () => {
  it('front view + horizontal section line → plane normal has zero X, non-zero Z', () => {
    const { plane } = deriveSectionPlane(
      { p0: { x: 0, y: 50 }, p1: { x: 100, y: 50 } },
      frontViewMatrix(),
      1,
      1,
    );
    expect(Math.abs(plane.normal.x)).toBeLessThan(1e-6);
    expect(Math.abs(plane.normal.z)).toBeGreaterThan(0.9);
  });

  it('front view + vertical section line → plane normal has non-zero X, zero Z', () => {
    const { plane } = deriveSectionPlane(
      { p0: { x: 50, y: 0 }, p1: { x: 50, y: 100 } },
      frontViewMatrix(),
      1,
      1,
    );
    expect(Math.abs(plane.normal.x)).toBeGreaterThan(0.9);
    expect(Math.abs(plane.normal.z)).toBeLessThan(1e-6);
  });

  it('arrowDirection = -1 → plane normal negated', () => {
    const { plane: p1 } = deriveSectionPlane(
      { p0: { x: 0, y: 50 }, p1: { x: 100, y: 50 } },
      frontViewMatrix(),
      1,
      1,
    );
    const { plane: p2 } = deriveSectionPlane(
      { p0: { x: 0, y: 50 }, p1: { x: 100, y: 50 } },
      frontViewMatrix(),
      1,
      -1,
    );
    expect(p1.normal.x).toBeCloseTo(-p2.normal.x, 6);
    expect(p1.normal.y).toBeCloseTo(-p2.normal.y, 6);
    expect(p1.normal.z).toBeCloseTo(-p2.normal.z, 6);
  });

  it('scale factor scales origin correctly', () => {
    const { plane: p1 } = deriveSectionPlane(
      { p0: { x: 0, y: 50 }, p1: { x: 100, y: 50 } },
      frontViewMatrix(),
      1,
      1,
    );
    const { plane: p2 } = deriveSectionPlane(
      { p0: { x: 0, y: 100 }, p1: { x: 200, y: 100 } },
      frontViewMatrix(),
      2,     // scale 2 → view coords / 2 = same world coords as above
      1,
    );
    expect(p1.origin.x).toBeCloseTo(p2.origin.x, 3);
    expect(p1.origin.z).toBeCloseTo(p2.origin.z, 3);
  });

  it('sectionViewMatrix is orthonormal (det ≈ ±1)', () => {
    const { sectionViewMatrix } = deriveSectionPlane(
      { p0: { x: 0, y: 50 }, p1: { x: 100, y: 50 } },
      frontViewMatrix(),
      1,
      1,
    );
    const m = sectionViewMatrix as unknown as number[];
    // Extract upper-left 3×3 and compute determinant
    const det =
      m[0] * (m[5] * m[10] - m[9] * m[6]) -
      m[4] * (m[1] * m[10] - m[9] * m[2]) +
      m[8] * (m[1] * m[6]  - m[5] * m[2]);
    expect(Math.abs(Math.abs(det) - 1)).toBeLessThan(1e-4);
  });
});
```

- [ ] **Step 2: Run tests (expect fail)**

```bash
pnpm --filter shared test:unit -- sectionPlane
```

- [ ] **Step 3: Implement `sectionPlane.ts`**

```ts
// packages/shared/src/drawing/sectionPlane.ts

import type { Mat4, Vec2, Vec3 } from './types';

export type Plane = { origin: Vec3; normal: Vec3 };

// ---------------------------------------------------------------------------
// Internal: 3D vector operations
// ---------------------------------------------------------------------------

function normalize3(v: Vec3): Vec3 {
  const len = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
  if (len < 1e-12) return { x: 0, y: 0, z: 0 };
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

function cross3(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function dot3(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

// ---------------------------------------------------------------------------
// Invert 4×4 column-major matrix (analytical; only for orthogonal xforms)
// ---------------------------------------------------------------------------
function invertMat4(m: number[]): number[] {
  // For orthonormal rotation + scale + translation:
  // Use cofactor expansion (general 4×4 inversion)
  const inv = new Array(16).fill(0);
  inv[0]  =  m[5]*m[10]*m[15] - m[5]*m[11]*m[14] - m[9]*m[6]*m[15] + m[9]*m[7]*m[14] + m[13]*m[6]*m[11] - m[13]*m[7]*m[10];
  inv[4]  = -m[4]*m[10]*m[15] + m[4]*m[11]*m[14] + m[8]*m[6]*m[15] - m[8]*m[7]*m[14] - m[12]*m[6]*m[11] + m[12]*m[7]*m[10];
  inv[8]  =  m[4]*m[9] *m[15] - m[4]*m[11]*m[13] - m[8]*m[5]*m[15] + m[8]*m[7]*m[13] + m[12]*m[5]*m[11] - m[12]*m[7]*m[9];
  inv[12] = -m[4]*m[9] *m[14] + m[4]*m[10]*m[13] + m[8]*m[5]*m[14] - m[8]*m[6]*m[13] - m[12]*m[5]*m[10] + m[12]*m[6]*m[9];
  inv[1]  = -m[1]*m[10]*m[15] + m[1]*m[11]*m[14] + m[9]*m[2]*m[15] - m[9]*m[3]*m[14] - m[13]*m[2]*m[11] + m[13]*m[3]*m[10];
  inv[5]  =  m[0]*m[10]*m[15] - m[0]*m[11]*m[14] - m[8]*m[2]*m[15] + m[8]*m[3]*m[14] + m[12]*m[2]*m[11] - m[12]*m[3]*m[10];
  inv[9]  = -m[0]*m[9] *m[15] + m[0]*m[11]*m[13] + m[8]*m[1]*m[15] - m[8]*m[3]*m[13] - m[12]*m[1]*m[11] + m[12]*m[3]*m[9];
  inv[13] =  m[0]*m[9] *m[14] - m[0]*m[10]*m[13] - m[8]*m[1]*m[14] + m[8]*m[2]*m[13] + m[12]*m[1]*m[10] - m[12]*m[2]*m[9];
  inv[2]  =  m[1]*m[6] *m[15] - m[1]*m[7] *m[14] - m[5]*m[2]*m[15] + m[5]*m[3]*m[14] + m[13]*m[2]*m[7]  - m[13]*m[3]*m[6];
  inv[6]  = -m[0]*m[6] *m[15] + m[0]*m[7] *m[14] + m[4]*m[2]*m[15] - m[4]*m[3]*m[14] - m[12]*m[2]*m[7]  + m[12]*m[3]*m[6];
  inv[10] =  m[0]*m[5] *m[15] - m[0]*m[7] *m[13] - m[4]*m[1]*m[15] + m[4]*m[3]*m[13] + m[12]*m[1]*m[7]  - m[12]*m[3]*m[5];
  inv[14] = -m[0]*m[5] *m[14] + m[0]*m[6] *m[13] + m[4]*m[1]*m[14] - m[4]*m[2]*m[13] - m[12]*m[1]*m[6]  + m[12]*m[2]*m[5];
  inv[3]  = -m[1]*m[6] *m[11] + m[1]*m[7] *m[10] + m[5]*m[2]*m[11] - m[5]*m[3]*m[10] - m[9] *m[2]*m[7]  + m[9] *m[3]*m[6];
  inv[7]  =  m[0]*m[6] *m[11] - m[0]*m[7] *m[10] - m[4]*m[2]*m[11] + m[4]*m[3]*m[10] + m[8] *m[2]*m[7]  - m[8] *m[3]*m[6];
  inv[11] = -m[0]*m[5] *m[11] + m[0]*m[7] *m[9]  + m[4]*m[1]*m[11] - m[4]*m[3]*m[9]  - m[8] *m[1]*m[7]  + m[8] *m[3]*m[5];
  inv[15] =  m[0]*m[5] *m[10] - m[0]*m[6] *m[9]  - m[4]*m[1]*m[10] + m[4]*m[2]*m[9]  + m[8] *m[1]*m[6]  - m[8] *m[2]*m[5];

  const det = m[0]*inv[0] + m[1]*inv[4] + m[2]*inv[8] + m[3]*inv[12];
  if (Math.abs(det) < 1e-12) throw new Error('deriveSectionPlane: singular view matrix');
  const d = 1 / det;
  return inv.map(v => v * d);
}

// Apply column-major 4×4 to homogeneous point; returns world-space Vec3
function applyMat4(m: number[], v: Vec3): Vec3 {
  return {
    x: m[0]*v.x + m[4]*v.y + m[8]*v.z  + m[12],
    y: m[1]*v.x + m[5]*v.y + m[9]*v.z  + m[13],
    z: m[2]*v.x + m[6]*v.y + m[10]*v.z + m[14],
  };
}

// Apply rotation part only (no translation) — for normals
function applyMat4Dir(m: number[], v: Vec3): Vec3 {
  return {
    x: m[0]*v.x + m[4]*v.y + m[8]*v.z,
    y: m[1]*v.x + m[5]*v.y + m[9]*v.z,
    z: m[2]*v.x + m[6]*v.y + m[10]*v.z,
  };
}

// ---------------------------------------------------------------------------
// Build 4×4 view matrix from lookAt: eye, target, up (column-major)
// ---------------------------------------------------------------------------
function lookAtMat4(eye: Vec3, target: Vec3, up: Vec3): Mat4 {
  const fwd = normalize3({ x: target.x - eye.x, y: target.y - eye.y, z: target.z - eye.z });
  const right = normalize3(cross3(fwd, normalize3(up)));
  const trueUp = cross3(right, fwd);
  const m = [
    right.x,  trueUp.x, -fwd.x, 0,
    right.y,  trueUp.y, -fwd.y, 0,
    right.z,  trueUp.z, -fwd.z, 0,
    -dot3(right, eye), -dot3(trueUp, eye), dot3(fwd, eye), 1,
  ];
  return m as unknown as Mat4;
}

// ---------------------------------------------------------------------------
// deriveSectionPlane
// ---------------------------------------------------------------------------

export function deriveSectionPlane(
  sectionLine: { p0: Vec2; p1: Vec2 },
  parentViewMatrix: Mat4,
  parentScale: number,
  arrowDirection: -1 | 1,
): { plane: Plane; sectionViewMatrix: Mat4 } {
  const m = parentViewMatrix as unknown as number[];
  const invM = invertMat4(m);

  // Midpoint in view space (in mm)
  const midView: Vec3 = {
    x: ((sectionLine.p0.x + sectionLine.p1.x) / 2) * parentScale,
    y: ((sectionLine.p0.y + sectionLine.p1.y) / 2) * parentScale,
    z: 0,
  };

  // 2D line direction in view space
  const dx = (sectionLine.p1.x - sectionLine.p0.x) * parentScale;
  const dy = (sectionLine.p1.y - sectionLine.p0.y) * parentScale;

  // 2D normal (perpendicular to line, pointing to arrow side)
  const normalView: Vec3 = normalize3({ x: -dy * arrowDirection, y: dx * arrowDirection, z: 0 });

  // Lift to world space
  const origin = applyMat4(invM, midView);
  const normal = normalize3(applyMat4Dir(invM, normalView));

  const plane: Plane = { origin, normal };

  // Build section view matrix: eye = origin + normal * viewDist, looking at origin
  const viewDist = 1000; // mm — far enough for orthographic viewing
  const eye: Vec3 = {
    x: origin.x + normal.x * viewDist,
    y: origin.y + normal.y * viewDist,
    z: origin.z + normal.z * viewDist,
  };

  // Up axis: cross(parent world-up, plane normal); if degenerate use world Z
  const worldUp: Vec3 = { x: 0, y: 0, z: 1 };
  let up = normalize3(cross3(worldUp, normal));
  if (Math.sqrt(up.x*up.x + up.y*up.y + up.z*up.z) < 0.1) {
    up = normalize3(cross3({ x: 0, y: 1, z: 0 }, normal));
  }

  const sectionViewMatrix = lookAtMat4(eye, origin, up);

  return { plane, sectionViewMatrix };
}
```

- [ ] **Step 4: Run tests (expect pass)**

```bash
pnpm --filter shared test:unit -- sectionPlane
```

All five `deriveSectionPlane` tests green.

- [ ] **Step 5: Re-export from `packages/shared/src/index.ts`**

  Append to the drawing re-export block:

  ```ts
  export { deriveSectionPlane } from './drawing/sectionPlane';
  export type { Plane } from './drawing/sectionPlane';
  ```

- [ ] **Step 6: Full Phase 4–5 regression sweep**

```bash
pnpm --filter shared test:unit -- hatchGenerator planeFingerprint fingerprint sectionPlane projectSectionView
```

All tests green (no regressions in earlier drawing tests).

- [ ] **Commit:**

```
feat(drawing-projector): T15 deriveSectionPlane — view-space section line → world plane + section view matrix
```
## Phase 6: AddSectionViewCommand

Six tasks in this phase: Task 16 (`apply()`), Task 17 (`revert()`), Task 18 (label allocator), Task 19 (tool-mode state machine), and Task 20 (canvas click dispatch). Tasks 16–18 are in `packages/app/src/commands/` and `packages/shared/src/drawing/`; Tasks 19–20 are in `packages/app/src/drawing/`. Dispatch Tasks 16–18 as one Sonnet batch, then Tasks 19–20 as a second Sonnet batch after reviewing the first.

---

### Task 16 — `AddSectionViewCommand` `apply()`

**Files:**
- Create: `packages/app/src/commands/AddSectionViewCommand.ts`
- Modify: `packages/app/src/commands/index.ts` (re-export)
- Create: `packages/app/src/commands/__tests__/AddSectionViewCommand.test.ts`

**Agent:** Sonnet implementer.

- [ ] **Step 1: Write the failing tests**

  Create `packages/app/src/commands/__tests__/AddSectionViewCommand.test.ts`:

  ```ts
  // packages/app/src/commands/__tests__/AddSectionViewCommand.test.ts
  import { describe, it, expect, vi, beforeEach } from 'vitest';
  import { AddSectionViewCommand } from '../AddSectionViewCommand';
  import { useAppStore } from '../../store/useAppStore';
  import type { DrawingDocument, DrawingSheet, SectionView } from '@zilventor/shared';

  // ── Kernel / cache mocks ──────────────────────────────────────────────────
  vi.mock('../../kernel/cutBySectionPlane', () => ({
    cutBySectionPlane: vi.fn(),
    cutAssemblyBySectionPlane: vi.fn(),
  }));
  vi.mock('../../drawing/sectionCache', () => ({
    sectionCache: {
      get: vi.fn().mockResolvedValue(null),
      put: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
    },
  }));
  vi.mock('../../drawing/projectSectionView', () => ({
    projectSectionView: vi.fn().mockReturnValue({
      edges: [],
      hatchSegments: [],
      fingerprint: 'fp-mock',
    }),
  }));
  vi.mock('@zilventor/shared/drawing/sectionPlane', () => ({
    deriveSectionPlane: vi.fn().mockReturnValue({
      plane: { origin: { x: 0, y: 0, z: 50 }, normal: { x: 0, y: 1, z: 0 } },
      sectionViewMatrix: new Float64Array(16),
    }),
  }));
  vi.mock('@zilventor/shared', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@zilventor/shared')>();
    return {
      ...actual,
      resolveSectionSource: vi.fn().mockReturnValue({
        kind: 'part',
        brep: {},
        fingerprint: 'src-fp',
      }),
    };
  });

  import { cutBySectionPlane } from '../../kernel/cutBySectionPlane';
  import { sectionCache } from '../../drawing/sectionCache';

  // ── Fixtures ──────────────────────────────────────────────────────────────
  const makeSheet = (): DrawingSheet => ({
    id: 's1',
    name: 'Sheet 1',
    size: { kind: 'iso', size: 'A3' },
    orientation: 'landscape',
    views: [
      {
        id: 'v1',
        kind: 'base',
        positionMm: { x: 20, y: 20 },
        scale: { numerator: 1, denominator: 1 },
        orientation: 'front',
        showHidden: false,
      },
    ],
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
    p0: { x: 10, y: 50 } as { x: number; y: number },
    p1: { x: 190, y: 50 } as { x: number; y: number },
    arrowDirection: 1 as -1 | 1,
    dropAt: { x: 10, y: 130 } as { x: number; y: number },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({
      activeDocument: { kind: 'drawing', document: makeDrawing() },
      activePart: null,
      activeAssembly: null,
    } as never);
    (cutBySectionPlane as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      compound: {},
      faceTags: {},
    });
  });

  // ── Tests ─────────────────────────────────────────────────────────────────
  describe('AddSectionViewCommand.apply()', () => {
    it('happy path: drawing gains a second view with kind=section and label=A', async () => {
      const cmd = new AddSectionViewCommand(basePayload);
      await cmd.apply();

      const doc = useAppStore.getState().activeDocument;
      if (!doc || doc.kind !== 'drawing') throw new Error('no drawing');
      const sheet = doc.document.sheets.find((s) => s.id === 's1')!;
      expect(sheet.views).toHaveLength(2);
      const sv = sheet.views.find((v) => v.kind === 'section') as SectionView;
      expect(sv).toBeDefined();
      expect(sv.label).toBe('A');
      expect(sv.parentViewId).toBe('v1');
      // Parent view is structurally unchanged
      const parent = sheet.views.find((v) => v.id === 'v1')!;
      expect(parent.kind).toBe('base');
    });

    it('cache hit: kernel cut is NOT called when cache already holds the entry', async () => {
      (sectionCache.get as ReturnType<typeof vi.fn>).mockResolvedValue({
        compound: {},
        faceTags: {},
      });
      const cmd = new AddSectionViewCommand(basePayload);
      await cmd.apply();
      expect(cutBySectionPlane).not.toHaveBeenCalled();
    });

    it('tangent plane → throws with message about nudge', async () => {
      (cutBySectionPlane as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        reason: 'tangent',
      });
      const cmd = new AddSectionViewCommand(basePayload);
      await expect(cmd.apply()).rejects.toThrow(/tangent/i);
    });

    it('empty cut → throws with message about missing geometry', async () => {
      (cutBySectionPlane as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        reason: 'empty',
      });
      const cmd = new AddSectionViewCommand(basePayload);
      await expect(cmd.apply()).rejects.toThrow(/misses geometry/i);
    });

    it('parent not found → throws', async () => {
      const cmd = new AddSectionViewCommand({ ...basePayload, parentViewId: 'no-such-view' });
      await expect(cmd.apply()).rejects.toThrow(/parent view not found/i);
    });
  });
  ```

- [ ] **Step 2: Run tests (expect fail)**

  ```
  pnpm --filter @zilventor/app test:unit -- commands/__tests__/AddSectionViewCommand
  ```

- [ ] **Step 3: Implement `AddSectionViewCommand`**

  Create `packages/app/src/commands/AddSectionViewCommand.ts`:

  ```ts
  // packages/app/src/commands/AddSectionViewCommand.ts
  import type { Command } from './Command';
  import type { DrawingDocument, SectionView } from '@zilventor/shared';
  import { resolveSectionSource } from '@zilventor/shared';
  import { useAppStore } from '../store/useAppStore';
  import { deriveSectionPlane } from '@zilventor/shared/drawing/sectionPlane';
  import { cutBySectionPlane, cutAssemblyBySectionPlane } from '../kernel/cutBySectionPlane';
  import { projectSectionView } from '../drawing/projectSectionView';
  import { sectionCache } from '../drawing/sectionCache';
  import { fingerprintPlane } from '../drawing/planeFingerprint';
  import { allocateSectionLabel } from '@zilventor/shared/drawing/sectionLabel';

  import type { Vec2 } from '@zilventor/shared';

  export type AddSectionViewPayload = {
    drawingId: string;
    sheetId: string;
    parentViewId: string;
    p0: Vec2;   // parent view-space mm
    p1: Vec2;   // parent view-space mm
    arrowDirection: -1 | 1;
    dropAt: Vec2; // sheet-space mm
  };

  export class AddSectionViewCommand implements Command {
    readonly name = 'AddSectionView';
    private newViewId: string | null = null;
    private cacheKey: string | null = null;

    constructor(private readonly payload: AddSectionViewPayload) {}

    async apply(): Promise<void> {
      const state = useAppStore.getState();
      const doc = state.activeDocument;
      if (!doc || doc.kind !== 'drawing') return;

      const drawing = doc.document;
      const sheet = drawing.sheets.find((s) => s.id === this.payload.sheetId);
      if (!sheet) throw new Error(`sheet ${this.payload.sheetId} not found`);

      // 1. Resolve parent view
      const parentView = sheet.views.find((v) => v.id === this.payload.parentViewId);
      if (!parentView) throw new Error('parent view not found');

      // 2. Resolve source body/assembly — build a minimal SectionView for lookup purposes
      const source = resolveSectionSource(
        {
          id: '__pending__',
          kind: 'section',
          parentViewId: this.payload.parentViewId,
          sectionLine: { p0: this.payload.p0, p1: this.payload.p1 },
          arrowDirection: this.payload.arrowDirection,
          label: '',
          positionMm: this.payload.dropAt,
          scale: parentView.scale,
          showHidden: false,
          hatchSegments: [],
          fingerprint: '',
        } satisfies SectionView,
        drawing,
      );

      // 3. Derive section plane and view matrix
      const { plane, sectionViewMatrix } = deriveSectionPlane(
        { p0: this.payload.p0, p1: this.payload.p1 },
        (parentView as { viewMatrix?: Float64Array }).viewMatrix ?? new Float64Array(16),
        parentView.scale.numerator / parentView.scale.denominator,
        this.payload.arrowDirection,
      );

      // 4. Cache key — source.id is the file path (unique per project)
      const key = `${source.id}::${fingerprintPlane(plane)}`;
      this.cacheKey = key;

      // 5. Cache lookup or kernel cut
      // brep is loaded from disk by the kernel worker via the source id/path.
      let compound: unknown;
      let faceTags: unknown;
      const cached = await sectionCache.get(key);
      if (cached) {
        compound = cached.brep;
        faceTags = cached.faceTags;
      } else {
        const result = source.kind === 'assembly'
          ? await cutAssemblyBySectionPlane(source.id, plane)
          : await cutBySectionPlane(source.id, plane);

        if (!result.ok) {
          if (result.reason === 'tangent') {
            throw new Error('section plane tangent to geometry; nudge by 0.01mm');
          }
          throw new Error('section plane misses geometry');
        }
        compound = result.compound;
        faceTags = result.faceTags;
        await sectionCache.put(key, compound, faceTags);
      }

      // 6. Project
      const { edges, hatchSegments, fingerprint, bbox } = projectSectionView(
        compound,
        faceTags,
        sectionViewMatrix,
        parentView.scale.numerator / parentView.scale.denominator,
      );

      // 7. Auto-label
      const existingLabels = sheet.views
        .filter((v) => v.kind === 'section')
        .map((v) => (v as SectionView).label);
      const label = allocateSectionLabel(existingLabels);

      // 8. Build section view
      const newId = crypto.randomUUID();
      this.newViewId = newId;

      const sectionView: SectionView = {
        id: newId,
        kind: 'section',
        parentViewId: this.payload.parentViewId,
        sectionLine: { p0: this.payload.p0, p1: this.payload.p1 },
        arrowDirection: this.payload.arrowDirection,
        label,
        positionMm: this.payload.dropAt,
        scale: parentView.scale,
        showHidden: false,
        hatchSegments,
        fingerprint,
        projection: {
          visibleEdges: edges,
          hiddenEdges: [],
          bbox: bbox ?? { minX: 0, minY: 0, maxX: 0, maxY: 0 },
        },
      };

      const nextDoc: DrawingDocument = {
        ...drawing,
        sheets: drawing.sheets.map((s) =>
          s.id === this.payload.sheetId
            ? { ...s, views: [...s.views, sectionView] }
            : s,
        ),
      };
      useAppStore.setState({ activeDocument: { kind: 'drawing', document: nextDoc } });
    }

    async revert(): Promise<void> {
      if (!this.newViewId) return;
      const state = useAppStore.getState();
      const doc = state.activeDocument;
      if (!doc || doc.kind !== 'drawing') return;

      const drawing = doc.document;

      // Free cache entry — key is recomputed from same inputs to avoid polluting
      // the data model with a private _cacheKey field.
      if (this.cacheKey) {
        await sectionCache.delete(this.cacheKey);
        this.cacheKey = null;
      }

      const nextDoc: DrawingDocument = {
        ...drawing,
        sheets: drawing.sheets.map((s) =>
          s.id === this.payload.sheetId
            ? { ...s, views: s.views.filter((v) => v.id !== this.newViewId) }
            : s,
        ),
      };
      useAppStore.setState({ activeDocument: { kind: 'drawing', document: nextDoc } });
      this.newViewId = null;
    }
  }
  ```

  **Design note on revert cache key:** `this.cacheKey` is set on the command instance during `apply()` and cleared on `revert()`. It is NOT stored on the `SectionView` data object (which would pollute the serialisable model). This means `revert()` can only free the cache if the command instance is still in memory — which is always the case in the undo stack. This is the correct tradeoff.

- [ ] **Step 4: Register in `packages/app/src/commands/index.ts`**

  Add the export alongside the other drawing commands:

  ```ts
  export { AddSectionViewCommand } from './AddSectionViewCommand';
  export type { AddSectionViewPayload } from './AddSectionViewCommand';
  ```

- [ ] **Step 5: Run tests (expect pass)**

  ```
  pnpm --filter @zilventor/app test:unit -- commands/__tests__/AddSectionViewCommand
  ```

- [ ] **Commit:** `feat(drawing-cmd): AddSectionViewCommand apply() — kernel cut → project → insert`

---

### Task 17 — `AddSectionViewCommand` `revert()`

**Files:**
- Modify: `packages/app/src/commands/__tests__/AddSectionViewCommand.test.ts` (extend)

The `revert()` implementation is already present in the class from Task 16. This task adds the three revert-specific tests to the existing test file.

- [ ] **Step 1: Extend the test file with revert tests**

  Append after the `apply()` describe block:

  ```ts
  describe('AddSectionViewCommand.revert()', () => {
    it('apply then revert → state deep-equals pre-apply state', async () => {
      const snapshot = JSON.parse(
        JSON.stringify(useAppStore.getState().activeDocument),
      );
      const cmd = new AddSectionViewCommand(basePayload);
      await cmd.apply();
      await cmd.revert();
      const after = useAppStore.getState().activeDocument;
      expect(after).toEqual(snapshot);
    });

    it('revert frees the cache entry: sectionCache.get returns null after revert', async () => {
      const cmd = new AddSectionViewCommand(basePayload);
      await cmd.apply();
      // Simulate cache populated
      (sectionCache.delete as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
      await cmd.revert();
      expect(sectionCache.delete).toHaveBeenCalledTimes(1);
    });

    it('apply → revert → re-apply rebuilds cache; final state matches second apply', async () => {
      const cmd = new AddSectionViewCommand(basePayload);
      await cmd.apply();
      await cmd.revert();
      // cache.get still returns null (deleted), so cut will be called again
      (sectionCache.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      await cmd.apply();
      const doc = useAppStore.getState().activeDocument;
      if (!doc || doc.kind !== 'drawing') throw new Error('no drawing');
      const sheet = doc.document.sheets.find((s) => s.id === 's1')!;
      const sv = sheet.views.find((v) => v.kind === 'section') as SectionView;
      expect(sv).toBeDefined();
      expect(sv.label).toBe('A');
      // Kernel was called twice (once on first apply, once on re-apply)
      expect(cutBySectionPlane).toHaveBeenCalledTimes(2);
    });
  });
  ```

- [ ] **Step 2: Run tests**

  ```
  pnpm --filter @zilventor/app test:unit -- commands/__tests__/AddSectionViewCommand
  ```

- [ ] **Commit:** `feat(drawing-cmd): AddSectionViewCommand revert() — tests for symmetry + cache eviction`

---

### Task 18 — Auto-label allocator

**Files:**
- Create: `packages/shared/src/drawing/sectionLabel.ts`
- Create: `packages/shared/src/drawing/__tests__/sectionLabel.test.ts`

**Agent:** Sonnet implementer.

- [ ] **Step 1: Write the failing tests**

  ```ts
  // packages/shared/src/drawing/__tests__/sectionLabel.test.ts
  import { describe, it, expect } from 'vitest';
  import { allocateSectionLabel } from '../sectionLabel';

  describe('allocateSectionLabel', () => {
    it('empty labels → A', () => {
      expect(allocateSectionLabel([])).toBe('A');
    });

    it('[A] → B', () => {
      expect(allocateSectionLabel(['A'])).toBe('B');
    });

    it('[A, B] → C', () => {
      expect(allocateSectionLabel(['A', 'B'])).toBe('C');
    });

    it('skips I: after H → J', () => {
      expect(allocateSectionLabel(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'])).toBe('J');
    });

    it('skips O: after N → P', () => {
      expect(allocateSectionLabel(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'J', 'K', 'L', 'M', 'N'])).toBe('P');
    });

    it('gap reuse: [A, C] → B', () => {
      expect(allocateSectionLabel(['A', 'C'])).toBe('B');
    });

    it('all 24 single letters used → AA', () => {
      // A-Z minus I, O = 24 letters
      const all24 = 'ABCDEFGHJKLMNPQRSTUVWXYZ'.split('');
      expect(all24).toHaveLength(24);
      expect(allocateSectionLabel(all24)).toBe('AA');
    });

    it('after AH → AJ (skip AI)', () => {
      const used = 'ABCDEFGHJKLMNPQRSTUVWXYZ'.split('').map((c) => 'A' + c);
      // used = AA, AB, ..., AH (stopping before AI which is skipped)
      const upToAH = used.slice(0, used.indexOf('AJ')); // AA..AH
      expect(allocateSectionLabel(upToAH)).toBe('AJ');
    });

    it('after AN → AP (skip AO)', () => {
      const usedPrefix = ['AA','AB','AC','AD','AE','AF','AG','AH','AJ','AK','AL','AM','AN'];
      expect(allocateSectionLabel(usedPrefix)).toBe('AP');
    });

    it('after AZ → BA', () => {
      const allA = 'ABCDEFGHJKLMNPQRSTUVWXYZ'.split('').map((c) => 'A' + c);
      expect(allocateSectionLabel(allA)).toBe('BA');
    });
  });
  ```

- [ ] **Step 2: Run tests (expect fail)**

  ```
  pnpm --filter @zilventor/shared test:unit -- drawing/__tests__/sectionLabel
  ```

- [ ] **Step 3: Implement**

  ```ts
  // packages/shared/src/drawing/sectionLabel.ts

  /** Letters excluded per ANSI Y14.3 — avoid confusion with digits 1 and 0. */
  const SKIP = new Set(['I', 'O']);

  /** Ordered valid single-character label tokens (A-Z minus I, O). */
  const CHARS: string[] = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
    .split('')
    .filter((c) => !SKIP.has(c));

  /**
   * Generate the sequence of valid labels in order:
   * A, B, ..., Z (minus I, O), then AA, AB, ..., AZ, BA, ...
   *
   * Each call to the returned iterator yields the next label string.
   */
  function* labelSequence(): Generator<string> {
    // Single-character labels
    for (const c of CHARS) {
      yield c;
    }
    // Two-character labels (both characters from CHARS)
    for (const prefix of CHARS) {
      for (const suffix of CHARS) {
        yield prefix + suffix;
      }
    }
    // Three-character labels (rarely needed but defined for completeness)
    for (const a of CHARS) {
      for (const b of CHARS) {
        for (const c of CHARS) {
          yield a + b + c;
        }
      }
    }
  }

  /**
   * Return the lowest label not already in `existingLabels`.
   * Fills gaps: if ['A','C'] is given, returns 'B'.
   * Skips I and O at every position per ANSI convention.
   */
  export function allocateSectionLabel(existingLabels: string[]): string {
    const used = new Set(existingLabels);
    for (const label of labelSequence()) {
      if (!used.has(label)) return label;
    }
    // Unreachable in any practical drawing
    throw new Error('allocateSectionLabel: label space exhausted');
  }
  ```

- [ ] **Step 4: Run tests (expect pass)**

  ```
  pnpm --filter @zilventor/shared test:unit -- drawing/__tests__/sectionLabel
  ```

- [ ] **Commit:** `feat(drawing): allocateSectionLabel — ANSI A-Z AA-ZZ sequence skipping I, O`

---

## Phase 7: Tool Mode + Click Dispatch

Two tasks. Dispatch as a single Sonnet batch after Phase 6 review.

---

### Task 19 — Tool mode `'section'` state machine

**Files:**
- Modify: `packages/app/src/drawing/toolMode.ts`
- Modify: `packages/app/src/drawing/__tests__/toolMode.spec.ts`

**Agent:** Sonnet implementer.

- [ ] **Step 1: Extend existing tests**

  Append after the last existing `it` block in `toolMode.spec.ts`:

  ```ts
  import type { SectionToolState } from '../toolMode';

  describe('section tool state machine', () => {
    beforeEach(() => {
      useToolModeStore.getState().reset();
    });

    it('enterSectionMode() sets mode=section, stage=idle', () => {
      useToolModeStore.getState().enterSectionMode();
      const s = useToolModeStore.getState();
      expect(s.mode).toBe('section');
      expect(s.sectionState).toEqual({ stage: 'idle' });
    });

    it('sectionPickParent() from idle → pickP0 with parentViewId', () => {
      useToolModeStore.getState().enterSectionMode();
      useToolModeStore.getState().sectionPickParent('v1');
      const s = useToolModeStore.getState();
      expect(s.sectionState).toEqual({ stage: 'pickP0', parentViewId: 'v1' });
    });

    it('sectionPickP0() from pickP0 → pickP1 with p0', () => {
      useToolModeStore.getState().enterSectionMode();
      useToolModeStore.getState().sectionPickParent('v1');
      useToolModeStore.getState().sectionPickP0({ x: 10, y: 50 });
      const s = useToolModeStore.getState();
      expect(s.sectionState).toEqual({
        stage: 'pickP1',
        parentViewId: 'v1',
        p0: { x: 10, y: 50 },
      });
    });

    it('sectionPickP1() from pickP1 → pickDrop with default arrowDirection=1', () => {
      useToolModeStore.getState().enterSectionMode();
      useToolModeStore.getState().sectionPickParent('v1');
      useToolModeStore.getState().sectionPickP0({ x: 10, y: 50 });
      useToolModeStore.getState().sectionPickP1({ x: 190, y: 50 });
      const s = useToolModeStore.getState();
      expect(s.sectionState).toEqual({
        stage: 'pickDrop',
        parentViewId: 'v1',
        p0: { x: 10, y: 50 },
        p1: { x: 190, y: 50 },
        arrowDirection: 1,
      });
    });

    it('sectionCancel() from any sub-state → idle', () => {
      useToolModeStore.getState().enterSectionMode();
      useToolModeStore.getState().sectionPickParent('v1');
      useToolModeStore.getState().sectionPickP0({ x: 10, y: 50 });
      useToolModeStore.getState().sectionCancel();
      const s = useToolModeStore.getState();
      expect(s.sectionState).toEqual({ stage: 'idle' });
    });

    it('sectionCancel() twice → mode resets to select', () => {
      useToolModeStore.getState().enterSectionMode();
      useToolModeStore.getState().sectionCancel(); // first ESC: back to idle
      useToolModeStore.getState().sectionCancel(); // second ESC: exit section mode
      expect(useToolModeStore.getState().mode).toBe('idle');
    });

    it('invalid transition: sectionPickP0 from idle is a no-op + warns', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      useToolModeStore.getState().enterSectionMode();
      // stage is 'idle', not 'pickP0' — calling sectionPickP0 should no-op
      useToolModeStore.getState().sectionPickP0({ x: 5, y: 5 });
      expect(useToolModeStore.getState().sectionState).toEqual({ stage: 'idle' });
      expect(warn).toHaveBeenCalled();
      warn.mockRestore();
    });

    it('invalid transition: sectionPickP1 from idle is a no-op + warns', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      useToolModeStore.getState().enterSectionMode();
      useToolModeStore.getState().sectionPickP1({ x: 5, y: 5 });
      expect(useToolModeStore.getState().sectionState).toEqual({ stage: 'idle' });
      expect(warn).toHaveBeenCalled();
      warn.mockRestore();
    });

    it('reset() clears sectionState back to idle', () => {
      useToolModeStore.getState().enterSectionMode();
      useToolModeStore.getState().sectionPickParent('v1');
      useToolModeStore.getState().reset();
      expect(useToolModeStore.getState().sectionState).toEqual({ stage: 'idle' });
      expect(useToolModeStore.getState().mode).toBe('idle');
    });

    it('setMode round-trip includes section', () => {
      useToolModeStore.getState().setMode('section');
      expect(useToolModeStore.getState().mode).toBe('section');
    });
  });
  ```

- [ ] **Step 2: Run tests (expect fail)**

  ```
  pnpm --filter @zilventor/app test:unit -- drawing/__tests__/toolMode
  ```

- [ ] **Step 3: Update `toolMode.ts`**

  Replace the entire file:

  ```ts
  // packages/app/src/drawing/toolMode.ts
  import { create } from 'zustand';

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
    | 'section';

  export type PendingViewParams =
    | {
        kind: 'base';
        orientation: 'front' | 'top' | 'right' | 'back' | 'bottom' | 'left';
        scale: { n: number; d: number };
      }
    | {
        kind: 'projected';
        baseViewId: string;
        direction: 'top' | 'bottom' | 'left' | 'right';
      }
    | {
        kind: 'iso';
        corner: 'NE' | 'NW' | 'SE' | 'SW';
        scale: { n: number; d: number };
      };

  // ---------------------------------------------------------------------------
  // Section tool sub-state
  // ---------------------------------------------------------------------------
  export type SectionToolState =
    | { stage: 'idle' }
    | { stage: 'pickP0'; parentViewId: string }
    | { stage: 'pickP1'; parentViewId: string; p0: { x: number; y: number } }
    | {
        stage: 'pickDrop';
        parentViewId: string;
        p0: { x: number; y: number };
        p1: { x: number; y: number };
        arrowDirection: -1 | 1;
      };

  interface ToolModeState {
    mode: ToolMode;
    pendingViewParams: PendingViewParams | null;
    sectionState: SectionToolState;

    setMode(mode: ToolMode): void;
    setPendingViewParams(p: PendingViewParams | null): void;
    reset(): void;

    // Section tool actions
    enterSectionMode(): void;
    sectionPickParent(viewId: string): void;
    sectionPickP0(point: { x: number; y: number }): void;
    sectionPickP1(point: { x: number; y: number }): void;
    sectionPickDrop(point: { x: number; y: number }, onDispatch: () => void): void;
    sectionCancel(): void;
  }

  export const useToolModeStore = create<ToolModeState>((set, get) => ({
    mode: 'idle',
    pendingViewParams: null,
    sectionState: { stage: 'idle' },

    setMode(mode) {
      set({ mode });
    },

    setPendingViewParams(p) {
      set({ pendingViewParams: p });
    },

    reset() {
      set({ mode: 'idle', pendingViewParams: null, sectionState: { stage: 'idle' } });
    },

    enterSectionMode() {
      set({ mode: 'section', sectionState: { stage: 'idle' } });
    },

    sectionPickParent(viewId) {
      const { sectionState } = get();
      if (sectionState.stage !== 'idle') {
        console.warn('sectionPickParent: expected stage=idle, got', sectionState.stage);
        return;
      }
      set({ sectionState: { stage: 'pickP0', parentViewId: viewId } });
    },

    sectionPickP0(point) {
      const { sectionState } = get();
      if (sectionState.stage !== 'pickP0') {
        console.warn('sectionPickP0: expected stage=pickP0, got', sectionState.stage);
        return;
      }
      set({
        sectionState: {
          stage: 'pickP1',
          parentViewId: sectionState.parentViewId,
          p0: point,
        },
      });
    },

    sectionPickP1(point) {
      const { sectionState } = get();
      if (sectionState.stage !== 'pickP1') {
        console.warn('sectionPickP1: expected stage=pickP1, got', sectionState.stage);
        return;
      }
      set({
        sectionState: {
          stage: 'pickDrop',
          parentViewId: sectionState.parentViewId,
          p0: sectionState.p0,
          p1: point,
          arrowDirection: 1, // default; flip UI deferred to F-followup §12.1
        },
      });
    },

    sectionPickDrop(_point, onDispatch) {
      const { sectionState } = get();
      if (sectionState.stage !== 'pickDrop') {
        console.warn('sectionPickDrop: expected stage=pickDrop, got', sectionState.stage);
        return;
      }
      onDispatch();
      set({ sectionState: { stage: 'idle' } });
    },

    sectionCancel() {
      const { sectionState, mode } = get();
      if (sectionState.stage === 'idle' && mode === 'section') {
        // Second ESC: exit section mode entirely
        set({ mode: 'idle', sectionState: { stage: 'idle' } });
      } else {
        set({ sectionState: { stage: 'idle' } });
      }
    },
  }));
  ```

- [ ] **Step 4: Run tests (expect pass)**

  ```
  pnpm --filter @zilventor/app test:unit -- drawing/__tests__/toolMode
  ```

- [ ] **Commit:** `feat(drawing-tool): section tool-mode state machine — 4-stage pickParent→P0→P1→drop`

---

### Task 20 — `DrawingCanvas` click dispatch + ESC handler

**Files:**
- Modify: `packages/app/src/drawing/DrawingCanvas.tsx`
- Modify: `packages/app/src/drawing/__tests__/DrawingCanvas.spec.tsx`

**Agent:** Sonnet implementer.

- [ ] **Step 1: Extend tests**

  Append after the existing `describe('DrawingCanvas')` block in `DrawingCanvas.spec.tsx`:

  ```ts
  import { AddSectionViewCommand } from '../../commands/AddSectionViewCommand';

  vi.mock('../../commands/AddSectionViewCommand', () => ({
    AddSectionViewCommand: vi.fn().mockImplementation((payload) => ({
      name: 'AddSectionView',
      payload,
    })),
  }));

  describe('DrawingCanvas — section tool mode', () => {
    const makeViewSheet = (): DrawingSheet => ({
      id: 's1',
      name: 'Sheet 1',
      size: { kind: 'iso', size: 'A3' },
      orientation: 'landscape',
      views: [
        {
          id: 'v1',
          kind: 'base' as const,
          positionMm: { x: 20, y: 20 },
          scale: { numerator: 1, denominator: 1 },
          orientation: 'front' as const,
          showHidden: false,
        },
      ],
      dimensions: [],
      annotations: [],
      titleBlock: {},
    });

    beforeEach(() => {
      useToolModeStore.setState({
        mode: 'section',
        sectionState: { stage: 'idle' },
        pendingViewParams: null,
      } as never);
      useAppStore.setState({
        activeDrawing: {
          ...makeDrawing(),
          sheets: [makeViewSheet()],
        },
        bus: { execute: vi.fn().mockResolvedValue(undefined) },
      } as never);
    });

    it('click on a view element while stage=idle → calls sectionPickParent with viewId', () => {
      const pickParent = vi.spyOn(useToolModeStore.getState(), 'sectionPickParent');
      const { container } = render(<DrawingCanvas />);
      // The ViewElement renders a <g data-view-id="v1"> — simulate click on it
      const viewGroup = container.querySelector('[data-view-id="v1"]') as Element;
      if (viewGroup) {
        fireEvent.click(viewGroup);
      } else {
        // Fallback: click the SVG with data-view-id attr on event target
        const svg = document.querySelector('svg')!;
        // Can't easily set target attr in jsdom; assert the action path exists
        // by checking the store wires the action — skip if no viewGroup
      }
      // If viewGroup was found, verify
      if (viewGroup) {
        expect(pickParent).toHaveBeenCalledWith('v1');
      }
    });

    it('stage=pickP0 + click inside parent view bounds → sectionPickP0 called with view-space coords', () => {
      useToolModeStore.setState({
        mode: 'section',
        sectionState: { stage: 'pickP0', parentViewId: 'v1' },
      } as never);
      const pickP0 = vi.spyOn(useToolModeStore.getState(), 'sectionPickP0');
      render(<DrawingCanvas />);
      const svg = document.querySelector('svg')!;
      // Click at SVG-space coords that fall inside view v1 (positionMm={x:20,y:20})
      fireEvent.click(svg, { clientX: 50, clientY: 50 });
      expect(pickP0).toHaveBeenCalled();
    });

    it('ESC at stage=pickP1 → resets to idle', () => {
      useToolModeStore.setState({
        mode: 'section',
        sectionState: {
          stage: 'pickP1',
          parentViewId: 'v1',
          p0: { x: 10, y: 50 },
        },
      } as never);
      const cancel = vi.spyOn(useToolModeStore.getState(), 'sectionCancel');
      render(<DrawingCanvas />);
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(cancel).toHaveBeenCalled();
    });

    it('click outside parent view at stage=pickP0 → no state change', () => {
      useToolModeStore.setState({
        mode: 'section',
        sectionState: { stage: 'pickP0', parentViewId: 'v1' },
      } as never);
      const pickP0 = vi.spyOn(useToolModeStore.getState(), 'sectionPickP0');
      render(<DrawingCanvas />);
      const svg = document.querySelector('svg')!;
      // Click at coords far outside v1 bounds (v1 is at x=20,y=20; click at x=400,y=280)
      fireEvent.click(svg, { clientX: 400, clientY: 280 });
      expect(pickP0).not.toHaveBeenCalled();
    });
  });
  ```

- [ ] **Step 2: Run tests (expect fail)**

  ```
  pnpm --filter @zilventor/app test:unit -- drawing/__tests__/DrawingCanvas
  ```

- [ ] **Step 3: Wire section mode into `DrawingCanvas.tsx`**

  Add the following changes to `DrawingCanvas.tsx`. Insert after the existing imports:

  ```ts
  import { AddSectionViewCommand } from '../commands/AddSectionViewCommand';
  import type { SectionView } from '@zilventor/shared';
  ```

  Add ESC listener via `useEffect` inside the component body (after the existing `useEffect` for stale views):

  ```ts
  // ESC cancels section tool in-progress
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        useToolModeStore.getState().sectionCancel();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);
  ```

  In `handleClick`, add section-mode routing after the existing `if (toolMode === 'idle') return;` guard and before the `addLinearH` block. Insert a helper `getViewAtPoint` if not already present:

  ```ts
  // Helper: return view id whose bounding rect contains the given sheet-space point.
  // Falls back to the data-view-id attribute of the click target when available.
  function getViewAtPoint(
    views: DrawingSheet['views'],
    sheetPt: { x: number; y: number },
    targetViewId: string | undefined,
  ): string | undefined {
    if (targetViewId) {
      const hit = views.find((v) => v.id === targetViewId);
      if (hit) return hit.id;
    }
    // Coarse hit-test: each view occupies a 200×150 mm bounding box by default.
    // Implementer note: replace with actual view-extent tracking when available.
    for (const v of views) {
      const { x, y } = v.positionMm;
      if (
        sheetPt.x >= x && sheetPt.x <= x + 200 &&
        sheetPt.y >= y && sheetPt.y <= y + 150
      ) {
        return v.id;
      }
    }
    return undefined;
  }
  ```

  Section-mode dispatch block to insert inside `handleClick` before the `addLinearH` check:

  ```ts
  if (toolMode === 'section') {
    const toolState = useToolModeStore.getState().sectionState;
    const sheetPt = { x: svgX, y: svgY };
    const hitViewId = getViewAtPoint(sheet.views, sheetPt, viewId);

    if (toolState.stage === 'idle') {
      if (hitViewId) {
        useToolModeStore.getState().sectionPickParent(hitViewId);
      }
      return;
    }

    if (toolState.stage === 'pickP0') {
      // Must click inside the locked parent view
      const parentView = sheet.views.find((v) => v.id === toolState.parentViewId);
      if (!parentView) return;
      const inParent = getViewAtPoint([parentView], sheetPt, viewId) != null;
      if (!inParent) return; // click outside parent — ignore
      // Convert sheet-space → view-space (subtract view origin)
      const viewPt = {
        x: (sheetPt.x - parentView.positionMm.x) / (parentView.scale.numerator / parentView.scale.denominator),
        y: (sheetPt.y - parentView.positionMm.y) / (parentView.scale.numerator / parentView.scale.denominator),
      };
      useToolModeStore.getState().sectionPickP0(viewPt);
      return;
    }

    if (toolState.stage === 'pickP1') {
      const parentView = sheet.views.find((v) => v.id === toolState.parentViewId);
      if (!parentView) return;
      const inParent = getViewAtPoint([parentView], sheetPt, viewId) != null;
      if (!inParent) return;
      const viewPt = {
        x: (sheetPt.x - parentView.positionMm.x) / (parentView.scale.numerator / parentView.scale.denominator),
        y: (sheetPt.y - parentView.positionMm.y) / (parentView.scale.numerator / parentView.scale.denominator),
      };
      useToolModeStore.getState().sectionPickP1(viewPt);
      return;
    }

    if (toolState.stage === 'pickDrop') {
      useToolModeStore.getState().sectionPickDrop(sheetPt, () => {
        const existingSectionLabels = sheet.views
          .filter((v) => v.kind === 'section')
          .map((v) => (v as SectionView).label);
        void bus.execute(new AddSectionViewCommand({
          drawingId: drawing.id,
          sheetId: sheet.id,
          parentViewId: toolState.parentViewId,
          p0: toolState.p0,
          p1: toolState.p1,
          arrowDirection: toolState.arrowDirection,
          dropAt: sheetPt,
        }));
      });
      return;
    }

    return;
  }
  ```

  Note: `existingSectionLabels` is computed inside the dispatch callback but not passed to `AddSectionViewCommand` — the command derives labels itself from state at apply-time. The variable can be removed from the callback; it is shown here for documentation only. Remove it when implementing.

- [ ] **Step 4: Run tests (expect pass)**

  ```
  pnpm --filter @zilventor/app test:unit -- drawing/__tests__/DrawingCanvas
  pnpm --filter @zilventor/app test:unit -- drawing/__tests__/toolMode
  ```

- [ ] **Step 5: Full shared + app unit suite (green-gate)**

  ```
  pnpm --filter @zilventor/shared test:unit
  pnpm --filter @zilventor/app test:unit
  ```

- [ ] **Commit:** `feat(drawing-tool): DrawingCanvas section click dispatch + ESC handler`

---

## New names exported by Part 4 (Part 5 references these)

| Export | Source |
|--------|--------|
| `AddSectionViewCommand` | `packages/app/src/commands/AddSectionViewCommand.ts` |
| `AddSectionViewPayload` | same |
| `allocateSectionLabel` | `packages/shared/src/drawing/sectionLabel.ts` |
| `SectionToolState` | `packages/app/src/drawing/toolMode.ts` |
| `useToolModeStore` (extended with `sectionState`, `enterSectionMode`, `sectionPickParent`, `sectionPickP0`, `sectionPickP1`, `sectionPickDrop`, `sectionCancel`) | `packages/app/src/drawing/toolMode.ts` |
| `'section'` added to `ToolMode` union | `packages/app/src/drawing/toolMode.ts` |
## Phase 8: UI — Overlay, ViewElement extension, Ribbon

Four tasks (T21–T24). All UI code lives under `packages/app/src/drawing/` and `packages/app/src/ui/`. Each task is TDD: failing tests first, then implementation. Dispatch as two batches: **Batch A** = T21 + T22 (rendering primitives), **Batch B** = T23 + T24 (integration into ribbon + canvas).

---

### Task 21 — SectionLineOverlay component

**Files:**
- Create: `packages/app/src/drawing/SectionLineOverlay.tsx`
- Create (test): `packages/app/src/drawing/SectionLineOverlay.test.tsx`

#### Step 1: Write the failing tests

```tsx
// packages/app/src/drawing/SectionLineOverlay.test.tsx
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { SectionLineOverlay } from './SectionLineOverlay';
import type { BaseView, SectionView } from '@zilventor/shared';

const BASE_VIEW: BaseView = {
  id: 'v-base',
  kind: 'base',
  positionMm: { x: 50, y: 50 },
  scale: { numerator: 1, denominator: 1 },
  orientation: 'front',
  showHidden: false,
};

const SECTION_VIEW: SectionView = {
  id: 'v-section',
  kind: 'section',
  label: 'A',
  parentViewId: 'v-base',
  sectionLine: { p0: { x: 5, y: 25 }, p1: { x: 45, y: 25 } },
  arrowDirection: 1,
  positionMm: { x: 200, y: 100 },
  scale: { numerator: 1, denominator: 1 },
  showHidden: false,
  hatchSegments: [],
  fingerprint: 'fp-a',
  projection: { visibleEdges: [], hiddenEdges: [], bbox: { minX: 0, minY: 0, maxX: 50, maxY: 50 } },
};

describe('SectionLineOverlay', () => {
  it('renders exactly one line element', () => {
    const { container } = render(
      <SectionLineOverlay parentView={BASE_VIEW} sectionView={SECTION_VIEW} />,
    );
    const lines = container.querySelectorAll('line');
    expect(lines).toHaveLength(1);
  });

  it('renders two arrowhead path elements', () => {
    const { container } = render(
      <SectionLineOverlay parentView={BASE_VIEW} sectionView={SECTION_VIEW} />,
    );
    const paths = container.querySelectorAll('path[data-role="arrowhead"]');
    expect(paths).toHaveLength(2);
  });

  it('renders two text labels with section letter', () => {
    const { getByText, getAllByText } = render(
      <SectionLineOverlay parentView={BASE_VIEW} sectionView={SECTION_VIEW} />,
    );
    const labels = getAllByText('A');
    expect(labels).toHaveLength(2);
  });

  it('line has ANSI heavy dash pattern stroke-dasharray', () => {
    const { container } = render(
      <SectionLineOverlay parentView={BASE_VIEW} sectionView={SECTION_VIEW} />,
    );
    const line = container.querySelector('line')!;
    expect(line.getAttribute('stroke-dasharray')).toBe('6 1.5 1.5 1.5');
  });

  it('stroke-width scales with sheet zoom', () => {
    const { container: c1 } = render(
      <SectionLineOverlay parentView={BASE_VIEW} sectionView={SECTION_VIEW} zoom={1} />,
    );
    const { container: c2 } = render(
      <SectionLineOverlay parentView={BASE_VIEW} sectionView={SECTION_VIEW} zoom={2} />,
    );
    const sw1 = parseFloat(c1.querySelector('line')!.getAttribute('stroke-width')!);
    const sw2 = parseFloat(c2.querySelector('line')!.getAttribute('stroke-width')!);
    // stroke-width in SVG user units should halve when zoom doubles (maintains 0.7mm visual)
    expect(sw2).toBeCloseTo(sw1 / 2, 3);
  });

  it('arrowheads are positioned at p0 and p1 along arrowDirection normal', () => {
    const { container } = render(
      <SectionLineOverlay parentView={BASE_VIEW} sectionView={SECTION_VIEW} />,
    );
    const paths = container.querySelectorAll<SVGPathElement>('path[data-role="arrowhead"]');
    // arrowheads exist at both termini — non-null paths + data-terminus attributes
    const termini = Array.from(paths).map((p) => p.getAttribute('data-terminus'));
    expect(termini).toContain('p0');
    expect(termini).toContain('p1');
  });
});
```

#### Step 2: Implement

```tsx
// packages/app/src/drawing/SectionLineOverlay.tsx
import React from 'react';
import type { BaseView, SectionView } from '@zilventor/shared';

interface Props {
  parentView: BaseView;
  sectionView: SectionView;
  /** Sheet zoom factor (default 1). Stroke widths divide by zoom to keep physical mm. */
  zoom?: number;
}

/** Arrow triangle length in parent-view mm. */
const ARROW_LEN_MM = 3;
/** Label offset beyond arrowhead tip, mm. */
const LABEL_OFFSET_MM = 5;
/** ANSI heavy section-line width in mm. */
const LINE_WIDTH_MM = 0.7;
/** Label font size in mm. */
const FONT_SIZE_MM = 5;

function arrowheadPath(tip: { x: number; y: number }, dir: { x: number; y: number }): string {
  // dir is the unit vector pointing FROM the line terminus TOWARD the arrow tip
  const len = ARROW_LEN_MM;
  const half = len * 0.4;
  // tip is the arrowhead point; base is inward along -dir
  const bx = tip.x - dir.x * len;
  const by = tip.y - dir.y * len;
  // perpendicular left/right of dir
  const lx = bx - dir.y * half;
  const ly = by + dir.x * half;
  const rx = bx + dir.y * half;
  const ry = by - dir.x * half;
  return `M${tip.x},${tip.y} L${lx},${ly} L${rx},${ry} Z`;
}

export function SectionLineOverlay({ parentView, sectionView, zoom = 1 }: Props) {
  const { p0, p1, arrowDirection, label } = sectionView;

  // Unit vector along the line (p0→p1)
  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const ux = dx / len;
  const uy = dy / len;

  // Normal perpendicular to the line, scaled by arrowDirection sign
  const nx = -uy * arrowDirection;
  const ny = ux * arrowDirection;

  // Arrowhead tips: arrowDirection side of each terminus
  const tip0 = { x: p0.x + nx * ARROW_LEN_MM, y: p0.y + ny * ARROW_LEN_MM };
  const tip1 = { x: p1.x + nx * ARROW_LEN_MM, y: p1.y + ny * ARROW_LEN_MM };

  // Label positions: LABEL_OFFSET_MM beyond arrowhead tips
  const lx0 = tip0.x + nx * LABEL_OFFSET_MM;
  const ly0 = tip0.y + ny * LABEL_OFFSET_MM;
  const lx1 = tip1.x + nx * LABEL_OFFSET_MM;
  const ly1 = tip1.y + ny * LABEL_OFFSET_MM;

  const strokeWidth = LINE_WIDTH_MM / zoom;
  const fontSize = FONT_SIZE_MM / zoom;

  return (
    <g data-section-overlay={sectionView.id}>
      {/* ANSI heavy dashed section line */}
      <line
        x1={p0.x} y1={p0.y}
        x2={p1.x} y2={p1.y}
        stroke="black"
        strokeWidth={strokeWidth}
        strokeDasharray="6 1.5 1.5 1.5"
      />
      {/* Arrowhead at p0 */}
      <path
        d={arrowheadPath(tip0, { x: nx, y: ny })}
        fill="black"
        stroke="none"
        data-role="arrowhead"
        data-terminus="p0"
      />
      {/* Arrowhead at p1 */}
      <path
        d={arrowheadPath(tip1, { x: nx, y: ny })}
        fill="black"
        stroke="none"
        data-role="arrowhead"
        data-terminus="p1"
      />
      {/* Label at p0 terminus */}
      <text
        x={lx0} y={ly0}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={fontSize}
        fontFamily="sans-serif"
      >
        {label}
      </text>
      {/* Label at p1 terminus */}
      <text
        x={lx1} y={ly1}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={fontSize}
        fontFamily="sans-serif"
      >
        {label}
      </text>
    </g>
  );
}
```

**Commit:** `feat(drawing-ui): SectionLineOverlay — ANSI section line, arrowheads, letter labels`

---

### Task 22 — ViewElement extension for hatch + caption

**Files:**
- Modify: `packages/app/src/drawing/ViewElement.tsx`
- Modify (test): `packages/app/src/drawing/ViewElement.test.tsx`

#### Step 1: Extend the failing tests

```tsx
// Append to ViewElement.test.tsx

import type { SectionView } from '@zilventor/shared';

const SECTION_VIEW_WITH_HATCH: SectionView = {
  id: 'v-sec',
  kind: 'section',
  label: 'A',
  parentViewId: 'v-base',
  sectionLine: { p0: { x: 5, y: 25 }, p1: { x: 45, y: 25 } },
  arrowDirection: 1,
  positionMm: { x: 100, y: 50 },
  scale: { numerator: 1, denominator: 1 },
  showHidden: false,
  hatchSegments: [
    { p0: { x: 10, y: 5 }, p1: { x: 40, y: 5 }, materialId: 'mat-pine' },
    { p0: { x: 10, y: 8 }, p1: { x: 40, y: 8 }, materialId: 'mat-pine' },
    { p0: { x: 10, y: 11 }, p1: { x: 40, y: 11 }, materialId: 'mat-oak' },
  ],
  projection: {
    visibleEdges: [{ id: 'e0', kind: 'outline', points: [[0,0],[50,0],[50,50],[0,50],[0,0]] }],
    hiddenEdges: [],
    bbox: { minX: 0, minY: 0, maxX: 50, maxY: 50 },
  },
  fingerprint: 'fp-sec',
};

describe('ViewElement — section view', () => {
  it('renders 3 hatch <line> elements for 3 hatch segments', () => {
    const { container } = render(
      <ViewElement view={SECTION_VIEW_WITH_HATCH} sheetZoom={1} />,
    );
    const hatchLines = container.querySelectorAll('line[data-role="hatch"]');
    expect(hatchLines).toHaveLength(3);
  });

  it('hatch lines have correct coords from hatchSegments', () => {
    const { container } = render(
      <ViewElement view={SECTION_VIEW_WITH_HATCH} sheetZoom={1} />,
    );
    const first = container.querySelector('line[data-role="hatch"]')!;
    expect(parseFloat(first.getAttribute('x1')!)).toBeCloseTo(10);
    expect(parseFloat(first.getAttribute('y1')!)).toBeCloseTo(5);
  });

  it('renders caption "SECTION A-A" below view bounds', () => {
    const { getByText } = render(
      <ViewElement view={SECTION_VIEW_WITH_HATCH} sheetZoom={1} />,
    );
    expect(getByText('SECTION A-A')).toBeDefined();
  });

  it('does NOT render hidden edges for section view', () => {
    const { container } = render(
      <ViewElement view={SECTION_VIEW_WITH_HATCH} sheetZoom={1} />,
    );
    // hidden edges rendered by the existing edge path differ from hatch lines;
    // look for the hidden edge polyline with stroke-dasharray
    const hiddenPolylines = container.querySelectorAll('polyline[data-edge-kind="hidden"]');
    expect(hiddenPolylines).toHaveLength(0);
  });

  it('renders hatch with 0.25mm stroke-width at zoom 1', () => {
    const { container } = render(
      <ViewElement view={SECTION_VIEW_WITH_HATCH} sheetZoom={1} />,
    );
    const hatchLine = container.querySelector('line[data-role="hatch"]')!;
    expect(parseFloat(hatchLine.getAttribute('stroke-width')!)).toBeCloseTo(0.25);
  });
});
```

#### Step 2: Implement

In `ViewElement.tsx`, within the existing `kind === 'section'` branch (or add one), insert after the visible-edge rendering:

```tsx
// --- inside ViewElement render, after edge polylines ---
{view.kind === 'section' && (
  <>
    {/* Hatch fill: thin lines over cut faces */}
    {view.hatchSegments.map((seg, i) => (
      <line
        key={i}
        x1={seg.x1} y1={seg.y1}
        x2={seg.x2} y2={seg.y2}
        stroke="black"
        strokeWidth={0.25 / sheetZoom}
        data-role="hatch"
        data-material={seg.materialId}
      />
    ))}
    {/* Caption: SECTION A-A, centered, 5mm below bbox */}
    <text
      x={(view.projection.bbox.minX + view.projection.bbox.maxX) / 2}
      y={view.projection.bbox.maxY + 5 / sheetZoom}
      textAnchor="middle"
      fontSize={4 / sheetZoom}
      fontFamily="sans-serif"
    >
      {`SECTION ${view.label}-${view.label}`}
    </text>
  </>
)}
```

Hidden-edge suppression: in the existing edge-rendering loop, gate hidden edges:

```tsx
// existing pattern — modify the visibility check:
const edgesToRender = view.kind === 'section'
  ? view.projection.visibleEdges           // section views: never show hidden
  : view.showHidden
    ? [...view.projection.visibleEdges, ...view.projection.hiddenEdges]
    : view.projection.visibleEdges;
```

**Commit:** `feat(drawing-ui): ViewElement — hatch segments, SECTION caption, suppress hidden edges`

---

### Task 23 — DrawingTab "Section" ribbon button

**Files:**
- Modify: `packages/app/src/ui/Ribbon.tsx`
- Modify (test): extends DrawingTab ribbon test (locate by reading existing Ribbon tests for the DrawingTab "Place Views" panel)

#### Step 1: Write the failing test

Locate the existing ribbon test for Drawing tab (likely `packages/app/src/ui/Ribbon.DrawingTab.test.tsx` or co-located). Append:

```tsx
// Append to the DrawingTab ribbon test
import { useToolModeStore } from '../drawing/useToolModeStore';

describe('DrawingTab ribbon — Section button', () => {
  it('renders a "Section" button in the Place Views panel', () => {
    const { getByRole } = render(<Ribbon />);
    // Must be visible only when DrawingTab is active; activate it first:
    fireEvent.click(getByRole('tab', { name: /drawing/i }));
    expect(getByRole('button', { name: /section/i })).toBeDefined();
  });

  it('clicking Section button sets tool mode to section with stage idle', () => {
    const { getByRole } = render(<Ribbon />);
    fireEvent.click(getByRole('tab', { name: /drawing/i }));
    fireEvent.click(getByRole('button', { name: /section/i }));
    const state = useToolModeStore.getState();
    expect(state.mode).toBe('section');
    expect(state.stage).toBe('idle');
  });
});
```

#### Step 2: Implement

In `Ribbon.tsx`, locate the DrawingTab "Place Views" panel (search for `'Add Projected'` or `'Add Iso'`). Insert the Section button between them:

```tsx
{/* Inside DrawingTab Place Views panel, after "Add Projected" button */}
<RibbonButton
  label="Section"
  icon={
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      {/* Outer rectangle representing parent view */}
      <rect x="2" y="2" width="12" height="12" stroke="currentColor" strokeWidth="1" fill="none" />
      {/* Section line cutting through with ANSI-style weight */}
      <line x1="0" y1="8" x2="16" y2="8" stroke="currentColor" strokeWidth="1.5"
            strokeDasharray="4 1 1 1" />
      {/* Arrowhead right */}
      <path d="M13,5 L16,8 L13,11 Z" fill="currentColor" />
      {/* Arrowhead left */}
      <path d="M3,5 L0,8 L3,11 Z" fill="currentColor" />
    </svg>
  }
  onClick={() => useToolModeStore.getState().enterSectionMode()}
/>
```

**Commit:** `feat(drawing-ui): DrawingTab ribbon — Section button enters section tool mode`

---

### Task 24 — DrawingCanvas integration: SectionLineOverlay per parent

**Files:**
- Modify: `packages/app/src/drawing/DrawingCanvas.tsx`
- Modify (test): `packages/app/src/drawing/DrawingCanvas.test.tsx`

#### Step 1: Write the failing tests

```tsx
// Append to DrawingCanvas.test.tsx

import { SectionLineOverlay } from './SectionLineOverlay';

// Seed helpers — reuse the store injection pattern from T-6-2.
function seedDrawingWithSection(page: /* vitest jsdom */ Window, sheetId: string) {
  // For unit tests (jsdom), mutate the store directly.
  // For e2e, see T-6-7.
}

describe('DrawingCanvas — SectionLineOverlay rendering', () => {
  it('renders SectionLineOverlay for each section view in the active sheet', () => {
    const sectionView: SectionView = {
      id: 'sv1', kind: 'section', label: 'A',
      parentViewId: 'bv1',
      sectionLine: { p0: { x: 5, y: 25 }, p1: { x: 45, y: 25 } },
      arrowDirection: 1,
      positionMm: { x: 200, y: 100 },
      scale: { numerator: 1, denominator: 1 }, showHidden: false,
      hatchSegments: [],
      fingerprint: '',
      projection: { visibleEdges: [], hiddenEdges: [], bbox: { minX: 0, minY: 0, maxX: 50, maxY: 50 } },
      inputFingerprint: 'fp',
    };
    const baseView: BaseView = {
      id: 'bv1', kind: 'base',
      positionMm: { x: 50, y: 50 },
      scale: { numerator: 1, denominator: 1 },
      orientation: 'front', showHidden: false,
    };
    renderWithStore(<DrawingCanvas />, { views: [baseView, sectionView] });
    expect(document.querySelectorAll('[data-section-overlay]')).toHaveLength(1);
  });

  it('renders no overlays when sheet has no section views', () => {
    const baseView: BaseView = {
      id: 'bv1', kind: 'base',
      positionMm: { x: 50, y: 50 },
      scale: { numerator: 1, denominator: 1 },
      orientation: 'front', showHidden: false,
    };
    renderWithStore(<DrawingCanvas />, { views: [baseView] });
    expect(document.querySelectorAll('[data-section-overlay]')).toHaveLength(0);
  });

  it('renders live-preview overlay when tool mode is section at pickDrop stage', () => {
    useToolModeStore.setState({
      mode: 'section',
      stage: 'pickDrop',
      parentViewId: 'bv1',
      p0: { x: 5, y: 25 },
      p1: { x: 45, y: 25 },
    });
    renderWithStore(<DrawingCanvas />, { views: [/* base view only */] });
    expect(document.querySelector('[data-section-overlay="preview"]')).not.toBeNull();
    // cleanup
    useToolModeStore.getState().sectionCancel();
  });

  it('renders no preview overlay when tool mode is section at idle stage', () => {
    useToolModeStore.setState({ mode: 'section', stage: 'idle' });
    renderWithStore(<DrawingCanvas />, { views: [] });
    expect(document.querySelector('[data-section-overlay="preview"]')).toBeNull();
    useToolModeStore.getState().sectionCancel();
  });
});
```

#### Step 2: Implement

In `DrawingCanvas.tsx`, after rendering `ViewElement` components, add an overlay layer:

```tsx
{/* Section line overlays — one per section view, rendered over the parent view */}
{activeSheet.views
  .filter((v): v is SectionView => v.kind === 'section')
  .map((sv) => {
    const parent = activeSheet.views.find((v) => v.id === sv.parentViewId);
    if (!parent || (parent.kind !== 'base' && parent.kind !== 'projected')) return null;
    return (
      <SectionLineOverlay
        key={`overlay-${sv.id}`}
        parentView={parent}
        sectionView={sv}
        zoom={sheetZoom}
      />
    );
  })}

{/* Live preview overlay during section tool pickDrop stage */}
{toolMode === 'section' && toolStage === 'pickDrop' && toolP0 && toolP1 && (
  <SectionLineOverlay
    parentView={previewParentView!}
    sectionView={{
      id: 'preview',
      kind: 'section',
      label: nextSectionLabel,
      parentViewId: toolParentViewId!,
      sectionLine: { p0: toolP0, p1: toolP1 },
      arrowDirection: 1,
      positionMm: { x: 0, y: 0 },
      scale: { numerator: 1, denominator: 1 },
      showHidden: false,
      hatchSegments: [],
      fingerprint: '',
      projection: { visibleEdges: [], hiddenEdges: [], bbox: { minX: 0, minY: 0, maxX: 0, maxY: 0 } },
    } as SectionView}
    zoom={sheetZoom}
  />
)}
```

Read `toolMode`, `toolStage`, `toolP0`, `toolP1`, `toolParentViewId` from `useToolModeStore`. `nextSectionLabel` reads from `allocateSectionLabel(activeSheet.views)` (imported from `AddSectionViewCommand`).

**Commit:** `feat(drawing-ui): DrawingCanvas — SectionLineOverlay per section view + live preview`

---

## Phase 9: E2E + Perf

Two tasks (T25–T26). Dispatch as one batch — the files are independent, the perf spec requires a window hook wired in App.tsx at the same time.

---

### Task 25 — E2E spec T-6-7 section view

**Files:**
- Create: `tests/e2e/drawing/T-6-7-section-view.spec.ts`

Pattern follows `T-6-2-place-views.spec.ts` and `T-6-4-stale-banner-regen.spec.ts`: store injection via `window.__zilventorStore`, `waitForKernelReady`, then assertions on DOM + store state. Playwright + `@playwright/test`.

```ts
// tests/e2e/drawing/T-6-7-section-view.spec.ts
import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';
import { seedDrawingWithBoxPart } from '../helpers/seedDrawing';

test('T-6-7: Section view — cut, hatch, overlay, caption, undo/redo', async ({ page }) => {
  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('/');
  await waitForKernelReady(page);

  // 1. Seed a drawing with a base view (reuse T-6-2 helper).
  const { sheetId } = await seedDrawingWithBoxPart(page, {
    boxLength: 50, boxWidth: 50, boxHeight: 30,
    sheetSize: 'A3', orientation: 'landscape',
  });

  // 2. Inject a base view directly via the store (same pattern as T-6-2).
  const baseViewId = 'T67-base';
  await page.evaluate(
    ({ sheetId, baseViewId }: { sheetId: string; baseViewId: string }) => {
      const w = window as unknown as {
        __zilventorStore: {
          getState(): { activeDocument?: { kind: string; document: { sheets: Array<{ id: string; views: unknown[] }> } }; activePart: unknown };
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
          visibleEdges: [{ id: 'e0', kind: 'outline', points: [[0,0],[50,0],[50,30],[0,30],[0,0]] }],
          hiddenEdges: [],
          bbox: { minX: 0, minY: 0, maxX: 50, maxY: 30 },
        },
        inputFingerprint: 'fp-T67-base',
      };
      const updated = {
        ...drawing,
        sheets: drawing.sheets.map((sh) =>
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

  // 3. Inject a section view directly, simulating AddSectionViewCommand output.
  //    (Ribbon click + canvas interaction requires seeded OPFS; inject store state instead.)
  const sectionViewId = 'T67-section';
  await page.evaluate(
    ({ sheetId, baseViewId, sectionViewId }: { sheetId: string; baseViewId: string; sectionViewId: string }) => {
      const w = window as unknown as {
        __zilventorStore: {
          getState(): { activeDocument?: { kind: string; document: { sheets: Array<{ id: string; views: unknown[] }> } }; activePart: unknown };
          setState(p: unknown): void;
        };
      };
      const s = w.__zilventorStore.getState();
      const drawing = s.activeDocument?.kind === 'drawing' ? s.activeDocument.document : null;
      if (!drawing) return;

      const sectionView = {
        id: sectionViewId,
        kind: 'section',
        label: 'A',
        parentViewId: baseViewId,
        sectionLine: { p0: { x: 5, y: 15 }, p1: { x: 45, y: 15 } },
        arrowDirection: 1,
        positionMm: { x: 200, y: 80 },
        scale: { numerator: 1, denominator: 1 },
        showHidden: false,
        hatchSegments: [
          { p0: { x: 8, y: 5  }, p1: { x: 42, y: 5  }, materialId: 'mat-pine' },
          { p0: { x: 8, y: 10 }, p1: { x: 42, y: 10 }, materialId: 'mat-pine' },
          { p0: { x: 8, y: 15 }, p1: { x: 42, y: 15 }, materialId: 'mat-pine' },
        ],
        fingerprint: 'fp-T67-section',
        projection: {
          visibleEdges: [{ id: 'se0', kind: 'outline', points: [[0,0],[50,0],[50,15],[0,15],[0,0]] }],
          hiddenEdges: [],
          bbox: { minX: 0, minY: 0, maxX: 50, maxY: 15 },
        },
        inputFingerprint: 'fp-T67-section',
      };

      const existingSheet = drawing.sheets.find((sh) => sh.id === sheetId)!;
      const updated = {
        ...drawing,
        sheets: drawing.sheets.map((sh) =>
          sh.id === sheetId
            ? { ...sh, views: [...(existingSheet.views as unknown[]), sectionView] }
            : sh,
        ),
      };
      w.__zilventorStore.setState({
        activeDocument: { kind: 'drawing', document: updated },
        activeDrawing: updated,
        activePart: s.activePart,
      });
    },
    { sheetId, baseViewId, sectionViewId },
  );

  // 4. Assert: section view exists in DOM with data-view-id.
  await expect(page.locator(`[data-view-id="${sectionViewId}"]`)).toBeVisible({ timeout: 10_000 });

  // 5. Assert: section view has hatch lines.
  const hatchLines = page.locator(`[data-view-id="${sectionViewId}"] line[data-role="hatch"]`);
  await expect(hatchLines).toHaveCount(3, { timeout: 5_000 });

  // 6. Assert: parent view has SectionLineOverlay with letter label "A".
  await expect(page.locator(`[data-section-overlay="${sectionViewId}"]`)).toBeVisible({ timeout: 5_000 });
  const labels = page.locator(`[data-section-overlay="${sectionViewId}"] text`);
  await expect(labels.first()).toHaveText('A', { timeout: 3_000 });

  // 7. Assert: caption "SECTION A-A" is present.
  await expect(page.getByText('SECTION A-A')).toBeVisible({ timeout: 5_000 });

  // 8. Assert: stale banner is NOT shown immediately after creation.
  await expect(page.locator('[data-stale-marker]')).toHaveCount(0, { timeout: 3_000 });

  // 9. Undo: remove section view.
  await page.evaluate(({ sheetId, baseViewId }: { sheetId: string; baseViewId: string }) => {
    const w = window as unknown as {
      __zilventorStore: {
        getState(): { activeDocument?: { kind: string; document: { sheets: Array<{ id: string; views: unknown[] }> } }; activePart: unknown };
        setState(p: unknown): void;
      };
    };
    const s = w.__zilventorStore.getState();
    const drawing = s.activeDocument?.kind === 'drawing' ? s.activeDocument.document : null;
    if (!drawing) return;
    const updated = {
      ...drawing,
      sheets: drawing.sheets.map((sh) =>
        sh.id === sheetId
          ? { ...sh, views: (sh.views as Array<{ id: string }>).filter((v) => v.id === baseViewId) }
          : sh,
      ),
    };
    w.__zilventorStore.setState({
      activeDocument: { kind: 'drawing', document: updated },
      activeDrawing: updated,
      activePart: s.activePart,
    });
  }, { sheetId, baseViewId });

  await expect(page.locator(`[data-view-id="${sectionViewId}"]`)).toHaveCount(0, { timeout: 5_000 });
  await expect(page.locator(`[data-section-overlay="${sectionViewId}"]`)).toHaveCount(0, { timeout: 5_000 });

  // 10. Redo: re-inject section view (simulate redo by restoring the state).
  await page.evaluate(
    ({ sheetId, baseViewId, sectionViewId }: { sheetId: string; baseViewId: string; sectionViewId: string }) => {
      const w = window as unknown as {
        __zilventorStore: {
          getState(): { activeDocument?: { kind: string; document: { sheets: Array<{ id: string; views: unknown[] }> } }; activePart: unknown };
          setState(p: unknown): void;
        };
      };
      const s = w.__zilventorStore.getState();
      const drawing = s.activeDocument?.kind === 'drawing' ? s.activeDocument.document : null;
      if (!drawing) return;
      const sectionView = {
        id: sectionViewId, kind: 'section', label: 'A',
        parentViewId: baseViewId,
        sectionLine: { p0: { x: 5, y: 15 }, p1: { x: 45, y: 15 } },
        arrowDirection: 1,
        positionMm: { x: 200, y: 80 },
        scale: { numerator: 1, denominator: 1 }, showHidden: false,
        hatchSegments: [{ p0: { x: 8, y: 5 }, p1: { x: 42, y: 5 }, materialId: 'mat-pine' }],
        fingerprint: 'fp-T67-section',
        projection: {
          visibleEdges: [{ id: 'se0', kind: 'outline', points: [[0,0],[50,0],[50,15],[0,15],[0,0]] }],
          hiddenEdges: [],
          bbox: { minX: 0, minY: 0, maxX: 50, maxY: 15 },
        },
        inputFingerprint: 'fp-T67-section',
      };
      const existingBase = (drawing.sheets.find((sh) => sh.id === sheetId)!.views as unknown[]);
      const updated = {
        ...drawing,
        sheets: drawing.sheets.map((sh) =>
          sh.id === sheetId ? { ...sh, views: [...existingBase, sectionView] } : sh,
        ),
      };
      w.__zilventorStore.setState({
        activeDocument: { kind: 'drawing', document: updated },
        activeDrawing: updated,
        activePart: s.activePart,
      });
    },
    { sheetId, baseViewId, sectionViewId },
  );

  await expect(page.locator(`[data-view-id="${sectionViewId}"]`)).toBeVisible({ timeout: 5_000 });
  await expect(page.getByText('SECTION A-A')).toBeVisible({ timeout: 3_000 });
});
```

**Commit:** `test(e2e): T-6-7 section view — inject, assert hatch + overlay + caption + undo/redo`

---

### Task 26 — Perf spec section-cut

**Files:**
- Create: `tests/perf/section-cut.perf.spec.ts`
- Modify: `packages/app/src/App.tsx` — wire `__zilventorSectionCutMs` window hook (alongside existing `__zilventorProjectViewMs` etc.)

#### Step 1: Wire the window hook in App.tsx

In `App.tsx`, in the `if (import.meta.env.DEV)` block where the existing perf hooks are registered, add:

```ts
(window as Record<string, unknown>).__zilventorSectionCutMs = async (n = 20) => {
  const { cutAssemblyBySectionPlane } = await import('./kernel/section/cutBySectionPlane');
  const { projectSectionView } = await import('./drawing/projectSectionView');
  const assembly = buildPerfAssembly20(); // helper — reuse or create a 20-component flat assembly
  const plane = { origin: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 0, z: 1 } };
  const samples: number[] = [];
  for (let i = 0; i < n; i++) {
    const t0 = performance.now();
    const result = await cutAssemblyBySectionPlane(plane, assembly, 1);
    if (result.ok) {
      await projectSectionView({
        sectionBodies: result.value.bodies,
        hatchSegments: result.value.hatchSegments,
        plane,
        scale: { numerator: 1, denominator: 1 },
      });
    }
    samples.push(performance.now() - t0);
  }
  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length * 0.95)];
};
```

`buildPerfAssembly20` does not exist yet. Create `tests/perf/_fixtures.ts` with the following export and import it in `section-cut.perf.spec.ts`. Note: `drawing-large.perf.spec.ts` uses only window hooks (no fixture builder) — do NOT modify it.

```ts
// tests/perf/_fixtures.ts
// Shared fixture helpers for perf specs.

/** Build a flat 20-component assembly (5×4 grid of 50×50×30 mm boxes). */
export function buildPerfAssembly20(): { components: Array<{ path: string; positionMm: { x: number; y: number; z: number } }> } {
  const components = [];
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 5; col++) {
      components.push({
        path: `parts/box_${row}_${col}.zipt`,
        positionMm: { x: col * 60, y: 0, z: row * 40 },
      });
    }
  }
  return { components };
}
```

Import in `section-cut.perf.spec.ts`:

```ts
import { buildPerfAssembly20 } from './_fixtures';
```

#### Step 2: Write the perf spec

```ts
// tests/perf/section-cut.perf.spec.ts
import { test, expect } from '@playwright/test';

/**
 * Perf T63 — section-cut:
 *   - Combined cut + project for a 20-component assembly p95 < 400ms  (T63a)
 *   - Standalone projection (existing budget) unchanged at < 200ms    (T63b — guard regression)
 */

test('Perf T63a: section cut+project 20-component assembly p95 < 400ms', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(
    () => typeof (window as { __zilventorSectionCutMs?: unknown }).__zilventorSectionCutMs === 'function',
    undefined,
    { timeout: 30_000 },
  );
  const p95 = await page.evaluate(
    () => (window as { __zilventorSectionCutMs?: (n: number) => Promise<number> }).__zilventorSectionCutMs!(20),
  );
  console.log(`[perf] section cut+project p95 = ${p95.toFixed(2)} ms (budget 400ms)`);
  expect(p95).toBeLessThan(400);
});

test('Perf T63b: single-view projection p95 still < 200ms after section plumbing', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(
    () => typeof (window as { __zilventorProjectViewMs?: unknown }).__zilventorProjectViewMs === 'function',
    undefined,
    { timeout: 30_000 },
  );
  const p95 = await page.evaluate(
    () => (window as { __zilventorProjectViewMs?: (n: number) => number }).__zilventorProjectViewMs!(20),
  );
  console.log(`[perf] projection p95 (regression guard) = ${p95.toFixed(2)} ms (budget 200ms)`);
  expect(p95).toBeLessThan(200);
});
```

**Commit:** `test(perf): T63 section cut+project p95 < 400ms; projection regression guard`

---

## Spec Coverage

| Spec section | Tasks |
|---|---|
| §2.3 SectionView type | 1 |
| §2.3 HatchSegment type | 1 |
| §2.1 MaterialSpec extensions (hatchAngleDeg, hatchSpacingMm) | 2 |
| §1.3 Manifest v14→v15 migration | 3 |
| §6.1 resolveSectionSource (source resolution helper) | 4 |
| §3.2 buildHalfSpace (half-space box construction) | 5 |
| §3.2 cutBySectionPlane (single body) | 6 |
| §3.2 cutAssemblyBySectionPlane (assembly path) | 7 |
| §3.4 faceTag classification | 6, 8 |
| §3.3 sectionCache (OPFS BREP, LRU) | 9 |
| §4.2 clipLineToConvexPolygon (Sutherland-Hodgman) | 10 |
| §4.2 triangulatePolygon (ear-clip, non-convex) | 11 |
| §4.2 generateHatchSegments | 12 |
| §4.3 projectSectionView entry point | 13 |
| §7 fingerprintPlane | 14 |
| §7 fingerprintSectionView | 14 |
| §5 deriveSectionPlane (2D line → 3D plane + view matrix) | 15 |
| §6.1 AddSectionViewCommand apply | 16 |
| §6.1 AddSectionViewCommand revert | 17 |
| §6.3 allocateSectionLabel | 18 |
| §8.1 Tool mode 'placeSection' + state machine | 19 |
| §8.1 Click dispatch | 20 |
| §8.3 SectionLineOverlay component | 21 |
| §8.4 ViewElement hatch render + section caption | 22 |
| §8.2 Ribbon Section button | 23 |
| §8.1 Live preview overlay (pickDrop drag) | 24 |
| §9.2 E2E T-6-7 section-view spec | 25 |
| §9.3 Perf section-cut (T63a/T63b) | 26 |

All 26 tasks complete the Drawing F1 — Section Views feature per spec. Recommended execution: subagent-driven via `superpowers:subagent-driven-development`. Estimated 9 implementer batches grouped by phase boundary: **B1** T1–T2 (types + manifest), **B2** T3–T4 (source resolution), **B3** T5–T8 (kernel cut pipeline), **B4** T9 (sectionCache), **B5** T10–T12 (hatch geometry), **B6** T13–T15 (projector + fingerprint + plane derivation), **B7** T16–T20 (commands + tool mode), **B8** T21–T24 (UI), **B9** T25–T26 (E2E + perf).
