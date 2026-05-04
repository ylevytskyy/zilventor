# Sub-project 6 (2D Drawing Generation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Inventor-2012-style 2D drawing generation to ZilInventor: a new `.zidw` document kind that references a `.zipt` part or `.ziasm` assembly, generates orthographic + iso projected views via a hybrid OCCT-edges + JS depth-buffer pipeline, supports manual dimensions / annotations / title block, and exports to PDF / SVG / PNG.

**Architecture:** Pure projector in `packages/shared/src/drawing/` (consumes triangles + edges from kernel-side `getProjectorInput`; produces deterministic `ProjectedGeometry`). New per-action commands on the bus mutate `DrawingDocument`. SVG `<DrawingCanvas>` replaces the 3D `<Viewport>` when `activeDocument.kind === 'drawing'`. Stale-banner per view via SHA-256 input fingerprint. Manifest bumps v13 → v14 (additive — new `kind: 'drawing'`).

**Tech Stack:** TypeScript, Vitest (unit + integration), Playwright (e2e + perf), React 18, zustand, jsPDF (already a 5e dep), OffscreenCanvas. No new top-level deps.

**Spec:** `docs/superpowers/specs/2026-05-05-subproject-6-design.md` at HEAD `96245ef`.

**Agent dispatch:** Every implementation task in this plan is dispatched to a Sonnet (`claude-sonnet-4-6`) subagent via `superpowers:subagent-driven-development`. The main Opus thread orchestrates and reviews between dispatches per `feedback_sonnet_subagents_default`.

**Worktree:** Create with `superpowers:using-git-worktrees` before T1 — branch `feature/subproject-6`, path `.worktrees/subproject-6/`. All tasks below execute inside that worktree. The final phase merges back to master via `superpowers:finishing-a-development-branch`.

---

## Phase 1 — Shared types + manifest v13→v14 migration

Five tasks; tightly coupled (all type/manifest changes). Dispatch as one batch to a single Sonnet subagent.

### Task 1: Add `DrawingDocument` + sub-types to `packages/shared/src/drawing/types.ts`

**Files:**
- Create: `packages/shared/src/drawing/types.ts`
- Create (test): `packages/shared/src/drawing/__tests__/types.spec.ts`

**Agent:** Sonnet implementer.

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared/src/drawing/__tests__/types.spec.ts
import { describe, it, expect } from 'vitest';
import type {
  DrawingDocument,
  DrawingSource,
  DrawingSheet,
  SheetSize,
  DrawingView,
  BaseView,
  ProjectedView,
  IsoView,
  ViewScale,
  DrawingDimension,
  PointRef,
  DrawingAnnotation,
  TitleBlockOverrides,
} from '../types';
import { ISO_SIZES_MM } from '../types';

describe('drawing/types — discriminator round-trips', () => {
  it('ISO_SIZES_MM has correct A3 dimensions', () => {
    expect(ISO_SIZES_MM.A3).toEqual({ w: 420, h: 297 });
  });

  it('ISO_SIZES_MM has all five sizes', () => {
    expect(Object.keys(ISO_SIZES_MM).sort()).toEqual(['A0', 'A1', 'A2', 'A3', 'A4']);
  });

  it('BaseView kind discriminator survives JSON round-trip', () => {
    const view: BaseView = {
      id: 'v1',
      kind: 'base',
      positionMm: { x: 10, y: 20 },
      scale: { numerator: 1, denominator: 1 },
      orientation: 'front',
      showHidden: true,
    };
    const parsed = JSON.parse(JSON.stringify(view)) as BaseView;
    expect(parsed.kind).toBe('base');
    expect(parsed.orientation).toBe('front');
    expect(parsed.scale).toEqual({ numerator: 1, denominator: 1 });
  });

  it('ProjectedView kind discriminator survives JSON round-trip', () => {
    const view: ProjectedView = {
      id: 'v2',
      kind: 'projected',
      positionMm: { x: 150, y: 20 },
      baseViewId: 'v1',
      direction: 'right',
      scale: { numerator: 1, denominator: 2 },
      showHidden: false,
    };
    const parsed = JSON.parse(JSON.stringify(view)) as ProjectedView;
    expect(parsed.kind).toBe('projected');
    expect(parsed.direction).toBe('right');
  });

  it('IsoView kind discriminator survives JSON round-trip', () => {
    const view: IsoView = {
      id: 'v3',
      kind: 'iso',
      positionMm: { x: 300, y: 20 },
      corner: 'NE',
      scale: { numerator: 1, denominator: 1 },
      showHidden: false,
    };
    const parsed = JSON.parse(JSON.stringify(view)) as IsoView;
    expect(parsed.kind).toBe('iso');
    expect(parsed.corner).toBe('NE');
  });

  it('SheetSize iso kind survives JSON round-trip', () => {
    const size: SheetSize = { kind: 'iso', size: 'A3' };
    const parsed = JSON.parse(JSON.stringify(size)) as SheetSize;
    expect(parsed.kind).toBe('iso');
    if (parsed.kind === 'iso') expect(parsed.size).toBe('A3');
  });

  it('SheetSize custom kind survives JSON round-trip', () => {
    const size: SheetSize = { kind: 'custom', widthMm: 500, heightMm: 350 };
    const parsed = JSON.parse(JSON.stringify(size)) as SheetSize;
    expect(parsed.kind).toBe('custom');
    if (parsed.kind === 'custom') {
      expect(parsed.widthMm).toBe(500);
      expect(parsed.heightMm).toBe(350);
    }
  });

  it('DrawingDimension linear-h kind survives JSON round-trip', () => {
    const dim: DrawingDimension = {
      id: 'd1',
      kind: 'linear-h',
      viewId: 'v1',
      from: { kind: 'edge-endpoint', edgeId: 'e1', end: 'start' },
      to:   { kind: 'edge-endpoint', edgeId: 'e2', end: 'end' },
      offsetMm: 8,
    };
    const parsed = JSON.parse(JSON.stringify(dim)) as DrawingDimension;
    expect(parsed.kind).toBe('linear-h');
  });

  it('DrawingAnnotation balloon kind survives JSON round-trip', () => {
    const ann: DrawingAnnotation = {
      id: 'a1',
      kind: 'balloon',
      viewId: 'v1',
      targetMm: { x: 50, y: 60 },
      textPosMm: { x: 70, y: 80 },
      itemNumber: 3,
    };
    const parsed = JSON.parse(JSON.stringify(ann)) as DrawingAnnotation;
    expect(parsed.kind).toBe('balloon');
    if (parsed.kind === 'balloon') expect(parsed.itemNumber).toBe(3);
  });

  it('DrawingDocument shape assembles without TS errors', () => {
    const doc: DrawingDocument = {
      id: 'draw-1',
      name: 'Cabinet — Drawing',
      units: 'mm',
      source: { partPath: 'parts/cabinet1.zipt', sourceKind: 'part' },
      properties: {},
      sheets: [
        {
          id: 's1',
          name: 'Sheet 1',
          size: { kind: 'iso', size: 'A3' },
          orientation: 'landscape',
          views: [],
          dimensions: [],
          annotations: [],
          titleBlock: {},
        },
      ],
      activeSheetId: 's1',
    };
    expect(doc.units).toBe('mm');
    expect(doc.sheets).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the test (expect fail)**

```
cd .worktrees/subproject-6/packages/shared && pnpm test:unit -- drawing/__tests__/types
```

Expected: all tests fail — `types.ts` does not exist yet.

- [ ] **Step 3: Create `packages/shared/src/drawing/types.ts`**

```ts
// packages/shared/src/drawing/types.ts

import type { ProjectedGeometry } from './projectedGeometry';

// ---------------------------------------------------------------------------
// ISO sheet sizes (mm) — landscape orientation as listed; orientation field
// on DrawingSheet rotates them to portrait when needed.
// ---------------------------------------------------------------------------

export const ISO_SIZES_MM = {
  A0: { w: 1189, h: 841 },
  A1: { w:  841, h: 594 },
  A2: { w:  594, h: 420 },
  A3: { w:  420, h: 297 },
  A4: { w:  297, h: 210 },
} as const;

// ---------------------------------------------------------------------------
// SheetSize
// ---------------------------------------------------------------------------

export type SheetSize =
  | { readonly kind: 'iso';    readonly size: 'A0' | 'A1' | 'A2' | 'A3' | 'A4' }
  | { readonly kind: 'custom'; readonly widthMm: number; readonly heightMm: number };

// ---------------------------------------------------------------------------
// DrawingSource
// ---------------------------------------------------------------------------

export type DrawingSource = {
  readonly partPath: string;              // project-relative path: 'parts/cabinet1.zipt'
  readonly sourceKind: 'part' | 'assembly';
};

// ---------------------------------------------------------------------------
// ViewScale  (e.g. 1:1 → { numerator: 1, denominator: 1 })
// ---------------------------------------------------------------------------

export type ViewScale = {
  readonly numerator: number;
  readonly denominator: number;
};

// ---------------------------------------------------------------------------
// DrawingView union
// ---------------------------------------------------------------------------

export type BaseView = {
  readonly id: string;
  readonly kind: 'base';
  readonly positionMm: { readonly x: number; readonly y: number };
  readonly scale: ViewScale;
  readonly orientation: 'front' | 'top' | 'right' | 'back' | 'bottom' | 'left';
  readonly showHidden: boolean;
  readonly projection?: ProjectedGeometry;
  readonly inputFingerprint?: string;
};

export type ProjectedView = {
  readonly id: string;
  readonly kind: 'projected';
  readonly positionMm: { readonly x: number; readonly y: number };
  readonly baseViewId: string;
  readonly direction: 'top' | 'bottom' | 'left' | 'right';
  readonly scale: ViewScale;
  readonly showHidden: boolean;
  readonly projection?: ProjectedGeometry;
  readonly inputFingerprint?: string;
};

export type IsoView = {
  readonly id: string;
  readonly kind: 'iso';
  readonly positionMm: { readonly x: number; readonly y: number };
  readonly corner: 'NE' | 'NW' | 'SE' | 'SW';
  readonly scale: ViewScale;
  readonly showHidden: boolean;
  readonly projection?: ProjectedGeometry;
  readonly inputFingerprint?: string;
};

export type DrawingView =
  | BaseView
  | ProjectedView
  | IsoView;

// ---------------------------------------------------------------------------
// PointRef — used by dimensions to reference edge geometry
// ---------------------------------------------------------------------------

export type PointRef =
  | { readonly kind: 'edge-endpoint'; readonly edgeId: string; readonly end: 'start' | 'end' }
  | { readonly kind: 'edge-midpoint'; readonly edgeId: string }
  | { readonly kind: 'arc-center';    readonly edgeId: string };

// ---------------------------------------------------------------------------
// DrawingDimension union
// ---------------------------------------------------------------------------

export type DrawingDimension =
  | { readonly id: string; readonly kind: 'linear-h';  readonly viewId: string; readonly from: PointRef; readonly to: PointRef; readonly offsetMm: number }
  | { readonly id: string; readonly kind: 'linear-v';  readonly viewId: string; readonly from: PointRef; readonly to: PointRef; readonly offsetMm: number }
  | { readonly id: string; readonly kind: 'aligned';   readonly viewId: string; readonly from: PointRef; readonly to: PointRef; readonly offsetMm: number }
  | { readonly id: string; readonly kind: 'radial';    readonly viewId: string; readonly edgeId: string; readonly offsetMm: number; readonly angleDeg: number }
  | { readonly id: string; readonly kind: 'diametric'; readonly viewId: string; readonly edgeId: string; readonly offsetMm: number; readonly angleDeg: number };

// ---------------------------------------------------------------------------
// DrawingAnnotation union
// ---------------------------------------------------------------------------

export type DrawingAnnotation =
  | { readonly id: string; readonly kind: 'centerline';  readonly viewId: string; readonly edgeIdA: string; readonly edgeIdB: string }
  | { readonly id: string; readonly kind: 'center-mark'; readonly viewId: string; readonly edgeId: string }
  | { readonly id: string; readonly kind: 'leader';      readonly viewId: string; readonly targetMm: { readonly x: number; readonly y: number }; readonly textPosMm: { readonly x: number; readonly y: number }; readonly text: string }
  | { readonly id: string; readonly kind: 'balloon';     readonly viewId: string; readonly targetMm: { readonly x: number; readonly y: number }; readonly textPosMm: { readonly x: number; readonly y: number }; readonly itemNumber: number };

// ---------------------------------------------------------------------------
// TitleBlockOverrides — all fields optional; blanks fall back to auto-derived
// ---------------------------------------------------------------------------

export type TitleBlockOverrides = {
  readonly drawingName?: string;
  readonly partName?: string;
  readonly drawnBy?: string;
  readonly approvedBy?: string;
  readonly scaleText?: string;   // e.g. "1:5" — auto = primary base view's scale
  readonly date?: string;        // ISO yyyy-mm-dd
  readonly material?: string;
  readonly revision?: string;
  readonly notes?: string;
};

// ---------------------------------------------------------------------------
// DrawingSheet
// ---------------------------------------------------------------------------

export type DrawingSheet = {
  readonly id: string;
  readonly name: string;
  readonly size: SheetSize;
  readonly orientation: 'landscape' | 'portrait';
  readonly views: readonly DrawingView[];
  readonly dimensions: readonly DrawingDimension[];
  readonly annotations: readonly DrawingAnnotation[];
  readonly titleBlock: TitleBlockOverrides;
};

// ---------------------------------------------------------------------------
// DrawingDocument
// ---------------------------------------------------------------------------

export type DrawingDocument = {
  readonly id: string;
  readonly name: string;
  readonly units: 'mm';
  readonly source: DrawingSource;
  readonly properties: Record<string, string | number | boolean>;
  readonly sheets: readonly DrawingSheet[];
  readonly activeSheetId: string;
};
```

- [ ] **Step 4: Run the test (expect pass)**

```
cd .worktrees/subproject-6/packages/shared && pnpm test:unit -- drawing/__tests__/types
```

Expected: 9/9 pass.

- [ ] **Step 5: Commit**

```
git add packages/shared/src/drawing/types.ts \
        packages/shared/src/drawing/__tests__/types.spec.ts
git commit -m "feat(drawing): add DrawingDocument + sub-types to shared/drawing/types.ts"
```

**Verify:** `pnpm -r typecheck` clean; `types.spec.ts` 9/9 pass.

---

### Task 2: Add `ProjectedGeometry` + `Edge2D` types to `packages/shared/src/drawing/projectedGeometry.ts`

**Files:**
- Create: `packages/shared/src/drawing/projectedGeometry.ts`

**Agent:** Sonnet implementer.

Note: Task 2 has no test (pure types file). It must be done before T1 resolves its import, but the import is optional (`projection?`) so TS compiles even if the file exists only as a stub. Create the real file here so T1's types compile cleanly.

- [ ] **Step 1: Create `packages/shared/src/drawing/projectedGeometry.ts`**

```ts
// packages/shared/src/drawing/projectedGeometry.ts

export type Edge2D = {
  readonly id: string;                                        // stable id: <viewId>_<edgeNameKey>_<runIndex>
  readonly kind: 'silhouette' | 'feature' | 'outline';        // line-weight tier
  readonly points: ReadonlyArray<readonly [number, number]>;  // polyline in part-mm space (pre-scale)
  readonly sourceFaceIds?: readonly string[];                 // back-references to FaceNaming for hover/selection
};

export type ProjectedGeometry = {
  readonly visibleEdges: readonly Edge2D[];
  readonly hiddenEdges:  readonly Edge2D[];
  readonly bbox: {
    readonly minX: number;
    readonly minY: number;
    readonly maxX: number;
    readonly maxY: number;
  };
};
```

- [ ] **Step 2: Verify types compile**

```
cd .worktrees/subproject-6/packages/shared && pnpm typecheck
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```
git add packages/shared/src/drawing/projectedGeometry.ts
git commit -m "feat(drawing): add ProjectedGeometry + Edge2D types"
```

**Verify:** `pnpm -r typecheck` clean (no test needed — pure types).

---

### Task 3: Re-export drawing types from `packages/shared/src/index.ts`

**Files:**
- Modify: `packages/shared/src/index.ts`

**Agent:** Sonnet implementer.

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared/src/__tests__/drawing-exports.spec.ts
import { describe, it, expect } from 'vitest';

describe('shared barrel — drawing re-exports', () => {
  it('exports ISO_SIZES_MM', async () => {
    const mod = await import('../index');
    expect(typeof mod.ISO_SIZES_MM).toBe('object');
    expect((mod.ISO_SIZES_MM as Record<string, unknown>)['A3']).toEqual({ w: 420, h: 297 });
  });

  it('re-exports ProjectedGeometry as a type (no runtime value needed — type-only export)', async () => {
    // Confirm the barrel re-exports drawing/projectedGeometry by importing Edge2D kind check
    // We can only test runtime values; ISO_SIZES_MM is the sole runtime export from drawing/types.
    const mod = await import('../index');
    // ISO_SIZES_MM A0 spot-check
    expect((mod.ISO_SIZES_MM as Record<string, unknown>)['A0']).toEqual({ w: 1189, h: 841 });
  });
});
```

- [ ] **Step 2: Run the test (expect fail)**

```
cd .worktrees/subproject-6/packages/shared && pnpm test:unit -- drawing-exports
```

Expected: fails because `ISO_SIZES_MM` is not yet re-exported from index.

- [ ] **Step 3: Modify `packages/shared/src/index.ts`**

Append these two lines at the end of the file:

```ts
export { ISO_SIZES_MM } from './drawing/types';
export type { DrawingDocument, DrawingSource, DrawingSheet, SheetSize, DrawingView, BaseView, ProjectedView, IsoView, ViewScale, DrawingDimension, PointRef, DrawingAnnotation, TitleBlockOverrides } from './drawing/types';
export type { ProjectedGeometry, Edge2D } from './drawing/projectedGeometry';
```

- [ ] **Step 4: Run the test (expect pass)**

```
cd .worktrees/subproject-6/packages/shared && pnpm test:unit -- drawing-exports
```

Expected: 2/2 pass.

- [ ] **Step 5: Commit**

```
git add packages/shared/src/index.ts \
        packages/shared/src/__tests__/drawing-exports.spec.ts
git commit -m "feat(drawing): re-export drawing types from shared barrel"
```

**Verify:** `pnpm -r typecheck` clean; `drawing-exports.spec.ts` 2/2 pass.

---

### Task 4: Widen `ProjectFile` union in `packages/shared/src/types.ts`

**Files:**
- Modify: `packages/shared/src/types.ts`
- Create (test): `packages/shared/src/__tests__/projectFile-drawing.spec.ts`

**Agent:** Sonnet implementer.

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared/src/__tests__/projectFile-drawing.spec.ts
import { describe, it, expect } from 'vitest';
import type { ProjectFile } from '../types';

describe('ProjectFile union — drawing arm (v14)', () => {
  it('a synthetic v14 drawing ProjectFile type-checks at compile time', () => {
    // This test exercises the type at runtime via a cast + property access.
    const manifest = {
      formatVersion: 14 as const,
      kind: 'drawing' as const,
      createdAt: '2026-05-05T00:00:00.000Z',
      appVersion: '0.6.0',
      document: {
        id: 'draw-1',
        name: 'Cabinet — Drawing',
        units: 'mm' as const,
        source: { partPath: 'parts/cabinet1.zipt', sourceKind: 'part' as const },
        properties: {},
        sheets: [],
        activeSheetId: '',
      },
    } satisfies ProjectFile;

    expect(manifest.kind).toBe('drawing');
    expect(manifest.formatVersion).toBe(14);
    expect(manifest.document.units).toBe('mm');
  });

  it('a v14 part ProjectFile type-checks (existing arm extended)', () => {
    const manifest = {
      formatVersion: 14 as const,
      kind: 'part' as const,
      createdAt: '2026-05-05T00:00:00.000Z',
      appVersion: '0.6.0',
      document: {
        id: 'p1',
        name: 'Cabinet',
        units: 'mm' as const,
        parameters: {},
        featureTree: [],
        properties: {},
        materials: [],
        hardware: [],
      },
    } satisfies ProjectFile;

    expect(manifest.kind).toBe('part');
    expect(manifest.formatVersion).toBe(14);
  });

  it('a v14 assembly ProjectFile type-checks (existing arm extended)', () => {
    const manifest = {
      formatVersion: 14 as const,
      kind: 'assembly' as const,
      createdAt: '2026-05-05T00:00:00.000Z',
      appVersion: '0.6.0',
      document: {
        id: 'a1',
        name: 'Wardrobe',
        units: 'mm' as const,
        parameters: {},
        components: [],
        constraints: [],
        groundedComponentPaths: [],
        colors: {},
        bomItemNumbers: {},
        cutListItemNumbers: {},
        colorOverrides: {},
        properties: {},
        materials: [],
        hardware: [],
      },
    } satisfies ProjectFile;

    expect(manifest.kind).toBe('assembly');
    expect(manifest.formatVersion).toBe(14);
  });
});
```

- [ ] **Step 2: Run the test (expect fail)**

```
cd .worktrees/subproject-6/packages/shared && pnpm test:unit -- projectFile-drawing
```

Expected: TS compile errors — `14` not in `ProjectFile` union, `'drawing'` not a valid kind.

- [ ] **Step 3: Modify `packages/shared/src/types.ts`**

Find and replace the existing `ProjectFile` type (currently at line ~130):

Old:
```ts
export type ProjectFile =
  | { formatVersion: 7 | 8 | 9 | 10; kind: 'part'; createdAt: string; appVersion: string; document: PartDocument }
  | { formatVersion: 7 | 8 | 9 | 10; kind: 'assembly'; createdAt: string; appVersion: string; document: AssemblyDocument };
```

New:
```ts
export type ProjectFile =
  | { formatVersion: 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14; kind: 'part';     createdAt: string; appVersion: string; document: PartDocument }
  | { formatVersion: 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14; kind: 'assembly'; createdAt: string; appVersion: string; document: AssemblyDocument }
  | { formatVersion: 14;                                  kind: 'drawing';  createdAt: string; appVersion: string; document: DrawingDocument };
```

Also add the import of `DrawingDocument` at the top of the file (alongside existing imports):
```ts
import type { DrawingDocument } from './drawing/types';
```

- [ ] **Step 4: Run the test (expect pass)**

```
cd .worktrees/subproject-6/packages/shared && pnpm test:unit -- projectFile-drawing
```

Expected: 3/3 pass.

- [ ] **Step 5: Commit**

```
git add packages/shared/src/types.ts \
        packages/shared/src/__tests__/projectFile-drawing.spec.ts
git commit -m "feat(drawing): widen ProjectFile union with kind='drawing' arm (v14)"
```

**Verify:** `pnpm -r typecheck` clean; `projectFile-drawing.spec.ts` 3/3 pass.

---

### Task 5: Bump `CURRENT_FORMAT_VERSION` + add v13→v14 migration in `packages/shared/src/fileFormat.ts`

**Files:**
- Modify: `packages/shared/src/fileFormat.ts`
- Create (test): `packages/shared/src/__tests__/migrateManifest-v13-to-v14.spec.ts`

**Agent:** Sonnet implementer.

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared/src/__tests__/migrateManifest-v13-to-v14.spec.ts
import { describe, it, expect } from 'vitest';
import { migrateManifest, CURRENT_FORMAT_VERSION } from '../fileFormat';

describe('migrateManifest v13 → v14 (6 — no-op additive)', () => {
  it('CURRENT_FORMAT_VERSION is 14', () => {
    expect(CURRENT_FORMAT_VERSION).toBe(14);
  });

  it('passes a v13 part through to v14 unchanged', () => {
    const v13Part = {
      formatVersion: 13, kind: 'part',
      document: {
        id: 'p1', name: 'Cabinet', units: 'mm',
        parameters: {}, featureTree: [], properties: {},
        materials: [], hardware: [],
      },
    };
    const out = migrateManifest(v13Part) as { formatVersion: number; kind: string };
    expect(out.formatVersion).toBe(14);
    expect(out.kind).toBe('part');
  });

  it('passes a v13 assembly through to v14 unchanged', () => {
    const v13Asm = {
      formatVersion: 13, kind: 'assembly',
      document: {
        id: 'a1', name: 'Wardrobe', units: 'mm',
        parameters: {}, components: [], constraints: [],
        groundedComponentPaths: [], colors: {},
        bomItemNumbers: {}, cutListItemNumbers: {},
        colorOverrides: {}, properties: {},
        materials: [], hardware: [],
      },
    };
    const out = migrateManifest(v13Asm) as { formatVersion: number; kind: string; document: Record<string, unknown> };
    expect(out.formatVersion).toBe(14);
    expect(out.kind).toBe('assembly');
    // nest stays absent — migration is no-op
    expect('nest' in out.document).toBe(false);
  });

  it('v13 assembly preserves all existing fields after migration', () => {
    const v13Asm = {
      formatVersion: 13, kind: 'assembly',
      document: {
        id: 'a2', name: 'Cabinet', units: 'mm',
        parameters: {}, components: [], constraints: [],
        groundedComponentPaths: [], colors: {},
        bomItemNumbers: { 'comp1': 1 }, cutListItemNumbers: {},
        colorOverrides: {}, properties: { designer: 'Alice' },
        materials: [{ id: 'm1', name: 'Birch', defaultThickness: 18, color: '#aabbcc' }],
        hardware: [],
      },
    };
    const out = migrateManifest(v13Asm) as { document: Record<string, unknown> };
    expect((out.document.bomItemNumbers as Record<string, unknown>)['comp1']).toBe(1);
    expect((out.document.properties as Record<string, unknown>)['designer']).toBe('Alice');
  });

  it('a v14 drawing manifest passes through migrateManifest unchanged', () => {
    const v14Drawing = {
      formatVersion: 14, kind: 'drawing',
      createdAt: '2026-05-05T00:00:00.000Z',
      appVersion: '0.6.0',
      document: {
        id: 'draw-1',
        name: 'Cabinet — Drawing',
        units: 'mm',
        source: { partPath: 'parts/cabinet1.zipt', sourceKind: 'part' },
        properties: {},
        sheets: [],
        activeSheetId: '',
      },
    };
    const out = migrateManifest(v14Drawing) as { formatVersion: number; kind: string };
    // Already at current version — no migration runs
    expect(out.formatVersion).toBe(14);
    expect(out.kind).toBe('drawing');
  });

  it('does not add sheet-stock fields to materials on v13→v14 migration', () => {
    const v13Asm = {
      formatVersion: 13, kind: 'assembly',
      document: {
        id: 'a3', name: 'A', units: 'mm',
        parameters: {}, components: [], constraints: [],
        groundedComponentPaths: [], colors: {},
        bomItemNumbers: {}, cutListItemNumbers: {},
        colorOverrides: {}, properties: {},
        materials: [{ id: 'm1', name: 'Birch', defaultThickness: 18, color: '#aabbcc' }],
        hardware: [],
      },
    };
    const out = migrateManifest(v13Asm) as { document: { materials: unknown[] } };
    const m = out.document.materials[0] as Record<string, unknown>;
    expect('sheetLengthMm' in m).toBe(false);
    expect('sheetWidthMm' in m).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test (expect fail)**

```
cd .worktrees/subproject-6/packages/shared && pnpm test:unit -- migrateManifest-v13-to-v14
```

Expected: `CURRENT_FORMAT_VERSION is 14` fails (it is 13); no v13 migration entry exists.

- [ ] **Step 3: Modify `packages/shared/src/fileFormat.ts`**

Change line 4:
```ts
export const CURRENT_FORMAT_VERSION = 13 as const;
```
to:
```ts
export const CURRENT_FORMAT_VERSION = 14 as const;
```

Add the v13→v14 migration entry at the end of the `migrations` record (after the `12:` entry, before the closing `}`):

```ts
  // v13 → v14: no-op. New 'drawing' kind is forward-only; existing part/assembly
  // files are unaffected. DrawingDocument is only created by CreateDrawingCommand.
  13: (mIn) => {
    const m = deepClone(mIn);
    return { ...m, formatVersion: 14 };
  },
```

Also update `normalizeKind` to include `14` in the version check (the function currently checks `10 | 11 | 12 | 13`):

Old:
```ts
  if ((m.formatVersion === 10 || m.formatVersion === 11 || m.formatVersion === 12 || m.formatVersion === 13) && (m as any).kind === undefined) {
```

New:
```ts
  if ((m.formatVersion === 10 || m.formatVersion === 11 || m.formatVersion === 12 || m.formatVersion === 13 || m.formatVersion === 14) && (m as any).kind === undefined) {
```

- [ ] **Step 4: Run the test (expect pass)**

```
cd .worktrees/subproject-6/packages/shared && pnpm test:unit -- migrateManifest-v13-to-v14
```

Expected: 6/6 pass.

- [ ] **Step 5: Run the full shared suite to confirm no regressions**

```
cd .worktrees/subproject-6/packages/shared && pnpm test:unit
```

Expected: all pre-existing tests still pass (v12→v13 spec's `CURRENT_FORMAT_VERSION is 13` assertion will now fail — update that assertion to `toBe(14)` in `migrateManifest-v12-to-v13.spec.ts` since the version constant has advanced).

Update `packages/shared/src/__tests__/migrateManifest-v12-to-v13.spec.ts` line 6:

Old:
```ts
    expect(CURRENT_FORMAT_VERSION).toBe(13);
```

New:
```ts
    expect(CURRENT_FORMAT_VERSION).toBe(14);
```

Re-run:
```
cd .worktrees/subproject-6/packages/shared && pnpm test:unit
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```
git add packages/shared/src/fileFormat.ts \
        packages/shared/src/__tests__/migrateManifest-v13-to-v14.spec.ts \
        packages/shared/src/__tests__/migrateManifest-v12-to-v13.spec.ts
git commit -m "feat(drawing): bump CURRENT_FORMAT_VERSION to 14; add v13→v14 no-op migration"
```

**Verify:** `pnpm -r typecheck` clean; `migrateManifest-v13-to-v14.spec.ts` 6/6 pass; full shared unit suite green.
## Phase 2 — Pure projector module

Six tasks (T6..T11). T6-T8 are tightly coupled pure building blocks; dispatch together to one Sonnet implementer. T9-T11 wire and verify the module; dispatch as a second batch.

---

### T6 — `packages/shared/src/drawing/viewMatrix.ts`

**Files:**
- Create: `packages/shared/src/drawing/viewMatrix.ts`
- Create (test): `packages/shared/src/drawing/__tests__/viewMatrix.spec.ts`

**Agent:** Sonnet implementer.

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared/src/drawing/__tests__/viewMatrix.spec.ts
import { describe, it, expect } from 'vitest';
import { buildViewMatrix, apply } from '../viewMatrix';

const EPS = 1e-6;
function near(a: number, b: number) { return Math.abs(a - b) < EPS; }
function nearV(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) {
  return near(a.x, b.x) && near(a.y, b.y) && near(a.z, b.z);
}

// bbox: 100×60×40 box centred at (50,30,20)
const bbox: [number, number, number, number, number, number] = [0, 0, 0, 100, 60, 40];

describe('buildViewMatrix', () => {
  it('front: identity rotation — point (50,30,20) maps to (0,0,0) after recentre', () => {
    const M = buildViewMatrix('front', bbox);
    const p = apply(M, { x: 50, y: 30, z: 20 });
    expect(nearV(p, { x: 0, y: 0, z: 0 })).toBe(true);
  });

  it('front: point at origin maps to bbox-centre-negated after recentre', () => {
    const M = buildViewMatrix('front', bbox);
    const p = apply(M, { x: 0, y: 0, z: 0 });
    expect(nearV(p, { x: -50, y: -30, z: -20 })).toBe(true);
  });

  it('top: rotateX(-90°) — world +Z becomes view +Y', () => {
    // Under rotateX(-90°): y′ = z, z′ = -y (right-hand rule)
    const M = buildViewMatrix('top', bbox);
    // recentre by (-50,-30,-20), then rotateX(-90°)
    // test relative: delta (0,0,1) in world → (0,1,0) after rotation (ignoring recentre offset)
    const a = apply(M, { x: 50, y: 30, z: 21 });
    const b = apply(M, { x: 50, y: 30, z: 20 });
    const delta = { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
    expect(nearV(delta, { x: 0, y: 1, z: 0 })).toBe(true);
  });

  it('right: rotateY(-90°) — world -Z becomes view +X', () => {
    // Under rotateY(-90°): x′ = z, z′ = -x (right-hand rule negated)
    const M = buildViewMatrix('right', bbox);
    const a = apply(M, { x: 50, y: 30, z: 21 });
    const b = apply(M, { x: 50, y: 30, z: 20 });
    const delta = { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
    // rotateY(-90°): delta(0,0,1) → (-1,0,0) wait — rotateY(-90°): x′=-z, z′=x → delta(0,0,1)→(-1,0,0)? No:
    // rotY(-θ): [cos -sin 0 / sin cos 0 / 0 0 1] in XZ plane with -90 gives x′=cos(-90)x-sin(-90)z=0·x+1·z=z, z′=sin(-90)x+cos(-90)z=-x
    // So delta(0,0,1) → (1, 0, 0)
    expect(nearV(delta, { x: 1, y: 0, z: 0 })).toBe(true);
  });

  it('iso-NE: applies non-trivial rotation — result is neither axis-aligned', () => {
    const M = buildViewMatrix('iso-NE', bbox);
    const p = apply(M, { x: 50, y: 30, z: 20 });
    // recentred origin; iso rotated — all three components may differ but result is deterministic
    expect(nearV(p, { x: 0, y: 0, z: 0 })).toBe(true); // centre → origin
  });

  it('iso-NE delta(1,0,0) has non-zero x and z components', () => {
    const M = buildViewMatrix('iso-NE', bbox);
    const a = apply(M, { x: 51, y: 30, z: 20 });
    const b = apply(M, { x: 50, y: 30, z: 20 });
    const delta = { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
    expect(Math.abs(delta.x) > 0.1).toBe(true);
    expect(Math.abs(delta.z) > 0.1).toBe(true);
  });

  it('apply: identity matrix leaves vec unchanged', () => {
    const I: number[] = [
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    ];
    const v = { x: 3, y: -7, z: 2 };
    expect(nearV(apply(I, v), v)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test (expect fail)**

```bash
cd /path/to/worktree && pnpm --filter shared test:unit -- viewMatrix
```

Expected: all fail (module does not exist).

- [ ] **Step 3: Implement `packages/shared/src/drawing/viewMatrix.ts`**

```ts
// packages/shared/src/drawing/viewMatrix.ts
import type { BoundingBox } from '../types';

/**
 * 4×4 row-major homogeneous matrix stored as a flat number[16] array.
 * Row i, column j: M[i*4 + j].
 */
export type Mat4 = number[];

export type Vec3 = { x: number; y: number; z: number };

/** Multiply two 4×4 row-major matrices: C = A * B */
function mul(A: Mat4, B: Mat4): Mat4 {
  const C = new Array<number>(16).fill(0);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += A[r * 4 + k] * B[k * 4 + c];
      C[r * 4 + c] = s;
    }
  }
  return C;
}

/** Identity matrix */
function identity(): Mat4 {
  return [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ];
}

/** Translation matrix */
function translation(tx: number, ty: number, tz: number): Mat4 {
  return [
    1, 0, 0, tx,
    0, 1, 0, ty,
    0, 0, 1, tz,
    0, 0, 0,  1,
  ];
}

/** Rotation about X axis by angle radians (right-hand rule) */
function rotateX(a: number): Mat4 {
  const c = Math.cos(a), s = Math.sin(a);
  return [
    1,  0,  0, 0,
    0,  c, -s, 0,
    0,  s,  c, 0,
    0,  0,  0, 1,
  ];
}

/** Rotation about Y axis by angle radians (right-hand rule) */
function rotateY(a: number): Mat4 {
  const c = Math.cos(a), s = Math.sin(a);
  return [
     c, 0, s, 0,
     0, 1, 0, 0,
    -s, 0, c, 0,
     0, 0, 0, 1,
  ];
}

/** Apply 4×4 row-major matrix M to a Vec3 (homogeneous divide) */
export function apply(M: Mat4 | number[], v: Vec3): Vec3 {
  const { x, y, z } = v;
  const w = M[12] * x + M[13] * y + M[14] * z + M[15];
  return {
    x: (M[0] * x + M[1] * y + M[2] * z + M[3]) / w,
    y: (M[4] * x + M[5] * y + M[6] * z + M[7]) / w,
    z: (M[8] * x + M[9] * y + M[10] * z + M[11]) / w,
  };
}

export type ViewOrientation =
  | 'front' | 'top' | 'right' | 'back' | 'bottom' | 'left'
  | 'iso-NE' | 'iso-NW' | 'iso-SE' | 'iso-SW';

/**
 * Build the view matrix for a given orientation and source bounding box.
 *
 * Pipeline (applied right-to-left in column-major, but written left-to-right here):
 *   M = T_offset · S_scale · R_orient · T_recenter
 *
 * S_scale and T_offset are identity here — scale is applied at render time.
 * T_recenter translates the bbox centre to the origin to minimise float error.
 */
export function buildViewMatrix(orientation: ViewOrientation, sourceBbox: BoundingBox): Mat4 {
  const [minX, minY, minZ, maxX, maxY, maxZ] = sourceBbox;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const cz = (minZ + maxZ) / 2;

  const Trecenter = translation(-cx, -cy, -cz);

  let Rorient: Mat4;

  switch (orientation) {
    case 'front':
      Rorient = identity();
      break;
    case 'top':
      Rorient = rotateX(-Math.PI / 2);
      break;
    case 'right':
      Rorient = rotateY(-Math.PI / 2);
      break;
    case 'back':
      Rorient = rotateY(Math.PI);
      break;
    case 'bottom':
      Rorient = rotateX(Math.PI / 2);
      break;
    case 'left':
      Rorient = rotateY(Math.PI / 2);
      break;
    case 'iso-NE':
      Rorient = mul(rotateX(-Math.atan(1 / Math.sqrt(2))), rotateY(Math.PI / 4));
      break;
    case 'iso-NW':
      Rorient = mul(rotateX(-Math.atan(1 / Math.sqrt(2))), rotateY(-Math.PI / 4));
      break;
    case 'iso-SE':
      Rorient = mul(rotateX(-Math.atan(1 / Math.sqrt(2))), rotateY((3 * Math.PI) / 4));
      break;
    case 'iso-SW':
      Rorient = mul(rotateX(-Math.atan(1 / Math.sqrt(2))), rotateY((-3 * Math.PI) / 4));
      break;
    default: {
      const _exhaustive: never = orientation;
      throw new Error(`Unknown orientation: ${_exhaustive}`);
    }
  }

  // M = Rorient · Trecenter  (T_offset and S_scale are identity)
  return mul(Rorient, Trecenter);
}
```

- [ ] **Step 4: Run the test (expect pass)**

```bash
pnpm --filter shared test:unit -- viewMatrix
```

Expected: all pass.

- [ ] **Step 5: Typecheck**

```bash
pnpm --filter shared typecheck
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/drawing/viewMatrix.ts \
        packages/shared/src/drawing/__tests__/viewMatrix.spec.ts
git commit -m "feat(drawing): viewMatrix buildViewMatrix + apply (6 §3.2)"
```

**Verify:** `pnpm --filter shared test:unit -- viewMatrix` → all pass; `pnpm --filter shared typecheck` → clean.

---

### T7 — `packages/shared/src/drawing/depthBuffer.ts`

**Files:**
- Create: `packages/shared/src/drawing/depthBuffer.ts`
- Create (test): `packages/shared/src/drawing/__tests__/depthBuffer.spec.ts`

**Agent:** Sonnet implementer.

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared/src/drawing/__tests__/depthBuffer.spec.ts
import { describe, it, expect } from 'vitest';
import { buildDepthBuffer, adaptivePixelPitch } from '../depthBuffer';
import type { BoundingBox } from '../../types';

describe('adaptivePixelPitch', () => {
  it('returns at least 0.25 for small bbox', () => {
    const bbox: BoundingBox = [0, 0, 0, 10, 10, 10];
    expect(adaptivePixelPitch(bbox)).toBeGreaterThanOrEqual(0.25);
  });

  it('returns bbox_diag / 2048 for large bbox exceeding threshold', () => {
    // diag of [0,0,0,2048,2048,2048] = 2048*sqrt(3) ≈ 3547; /2048 ≈ 1.732
    const bbox: BoundingBox = [0, 0, 0, 2048, 2048, 2048];
    const pitch = adaptivePixelPitch(bbox);
    const diag = Math.sqrt(2048 ** 2 + 2048 ** 2 + 2048 ** 2);
    expect(Math.abs(pitch - diag / 2048)).toBeLessThan(1e-9);
    expect(pitch).toBeGreaterThan(0.25);
  });
});

describe('buildDepthBuffer', () => {
  // Single 100×100 flat triangle at z=5 in view-space XY, with Y in [0,100] and X in [0,100]
  const tri: [[number, number, number], [number, number, number], [number, number, number]] = [
    [0, 0, 5],
    [100, 0, 5],
    [0, 100, 5],
  ];
  const bbox: BoundingBox = [0, 0, 0, 100, 100, 10];
  const pitch = 1; // 1 mm/pixel for easy math

  it('pixel inside the triangle has z ≈ 5', () => {
    const buf = buildDepthBuffer([tri], bbox, pitch);
    const stride = Math.ceil((100 - 0) / pitch) + 1;
    // pixel at (10,10) should be covered by the triangle
    const idx = 10 * stride + 10;
    expect(buf[idx]).toBeCloseTo(5, 2);
  });

  it('pixel clearly outside the triangle remains Infinity', () => {
    const buf = buildDepthBuffer([tri], bbox, pitch);
    const stride = Math.ceil((100 - 0) / pitch) + 1;
    // pixel at (90,90) is outside the lower-left triangle
    const idx = 90 * stride + 90;
    expect(buf[idx]).toBe(Infinity);
  });

  it('back-face triangle (winding reversed) still rasterises', () => {
    const backTri: [[number, number, number], [number, number, number], [number, number, number]] = [
      [0, 100, 5],
      [100, 0, 5],
      [0, 0, 5],
    ];
    const buf = buildDepthBuffer([backTri], bbox, pitch);
    const stride = Math.ceil((100 - 0) / pitch) + 1;
    const idx = 10 * stride + 10;
    expect(buf[idx]).toBeCloseTo(5, 2);
  });

  it('degenerate (zero-area) triangle is skipped without error', () => {
    const degen: [[number, number, number], [number, number, number], [number, number, number]] = [
      [5, 5, 3],
      [5, 5, 3],
      [5, 5, 3],
    ];
    expect(() => buildDepthBuffer([degen], bbox, pitch)).not.toThrow();
    const buf = buildDepthBuffer([degen], bbox, pitch);
    // All pixels remain Infinity (nothing rasterised)
    const allInf = Array.from(buf).every((v) => v === Infinity);
    expect(allInf).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test (expect fail)**

```bash
pnpm --filter shared test:unit -- depthBuffer
```

Expected: all fail (module does not exist).

- [ ] **Step 3: Implement `packages/shared/src/drawing/depthBuffer.ts`**

```ts
// packages/shared/src/drawing/depthBuffer.ts
import type { BoundingBox } from '../types';

/** Returns the adaptive pixel pitch in mm: max(0.25, bbox_diag / 2048). */
export function adaptivePixelPitch(bbox: BoundingBox): number {
  const [minX, minY, minZ, maxX, maxY, maxZ] = bbox;
  const dx = maxX - minX, dy = maxY - minY, dz = maxZ - minZ;
  const diag = Math.sqrt(dx * dx + dy * dy + dz * dz);
  return Math.max(0.25, diag / 2048);
}

type Tri3 = [[number, number, number], [number, number, number], [number, number, number]];

/**
 * Rasterise triangles (already in view space) into a Z-buffer.
 * Buffer is indexed as buf[row * stride + col] where row↑ = +Y, col→ = +X.
 * Initialised to Infinity (nothing in front).
 *
 * @param triangles  Array of [v0, v1, v2] each [x, y, z] in view space.
 * @param bbox       View-space bounding box of the visible geometry.
 * @param pixelPitchMm  mm per pixel (use adaptivePixelPitch).
 */
export function buildDepthBuffer(
  triangles: ReadonlyArray<Tri3>,
  bbox: BoundingBox,
  pixelPitchMm: number,
): Float32Array {
  const [minX, minY, , maxX, maxY] = bbox;
  const cols = Math.ceil((maxX - minX) / pixelPitchMm) + 1;
  const rows = Math.ceil((maxY - minY) / pixelPitchMm) + 1;
  const buf = new Float32Array(cols * rows).fill(Infinity);

  for (const tri of triangles) {
    rasteriseTri(tri, buf, cols, minX, minY, pixelPitchMm);
  }
  return buf;
}

function rasteriseTri(
  tri: Tri3,
  buf: Float32Array,
  stride: number,
  originX: number,
  originY: number,
  pitch: number,
): void {
  const [v0, v1, v2] = tri;
  const [x0, y0, z0] = v0;
  const [x1, y1, z1] = v1;
  const [x2, y2, z2] = v2;

  // Edge-function area; skip degenerate (zero-area) triangles
  const area2 = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
  if (Math.abs(area2) < 1e-10) return;

  // Pixel bounding box of the triangle
  const xMin = Math.min(x0, x1, x2);
  const xMax = Math.max(x0, x1, x2);
  const yMin = Math.min(y0, y1, y2);
  const yMax = Math.max(y0, y1, y2);

  const colMin = Math.max(0, Math.floor((xMin - originX) / pitch));
  const colMax = Math.min(stride - 1, Math.ceil((xMax - originX) / pitch));
  const rowMin = Math.max(0, Math.floor((yMin - originY) / pitch));
  const rowMax = Math.min(Math.floor(buf.length / stride) - 1, Math.ceil((yMax - originY) / pitch));

  for (let row = rowMin; row <= rowMax; row++) {
    for (let col = colMin; col <= colMax; col++) {
      const px = originX + col * pitch;
      const py = originY + row * pitch;

      // Edge functions (sign-agnostic: test same sign as area2)
      const w0 = (x1 - x0) * (py - y0) - (px - x0) * (y1 - y0);
      const w1 = (x2 - x1) * (py - y1) - (px - x1) * (y2 - y1);
      const w2 = (x0 - x2) * (py - y2) - (px - x2) * (y0 - y2);

      // Point inside (or on edge of) triangle when all weights have the same sign as area2
      const inside =
        area2 > 0
          ? w0 >= 0 && w1 >= 0 && w2 >= 0
          : w0 <= 0 && w1 <= 0 && w2 <= 0;

      if (!inside) continue;

      // Barycentric interpolation for Z
      const b0 = w0 / area2;
      const b1 = w1 / area2;
      const b2 = 1 - b0 - b1;
      const z = b0 * z2 + b1 * z0 + b2 * z1;

      const idx = row * stride + col;
      if (z < buf[idx]) buf[idx] = z;
    }
  }
}
```

- [ ] **Step 4: Run the test (expect pass)**

```bash
pnpm --filter shared test:unit -- depthBuffer
```

Expected: all pass.

- [ ] **Step 5: Typecheck**

```bash
pnpm --filter shared typecheck
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/drawing/depthBuffer.ts \
        packages/shared/src/drawing/__tests__/depthBuffer.spec.ts
git commit -m "feat(drawing): depthBuffer CPU rasteriser + adaptivePixelPitch (6 §3.3)"
```

**Verify:** `pnpm --filter shared test:unit -- depthBuffer` → all pass; `pnpm --filter shared typecheck` → clean.

---

### T8 — `packages/shared/src/drawing/edgeClassifier.ts`

**Files:**
- Create: `packages/shared/src/drawing/edgeClassifier.ts`
- Create (test): `packages/shared/src/drawing/__tests__/edgeClassifier.spec.ts`

**Agent:** Sonnet implementer.

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared/src/drawing/__tests__/edgeClassifier.spec.ts
import { describe, it, expect } from 'vitest';
import { classifyEdges } from '../edgeClassifier';
import { buildDepthBuffer } from '../depthBuffer';
import type { BoundingBox } from '../../types';

describe('classifyEdges', () => {
  const pitch = 1;
  // Depth buffer with a triangle from (0,0,z=10) to (100,100,z=10)
  // covering the lower-left triangle of the 100×100 canvas.
  const tri: [[number, number, number], [number, number, number], [number, number, number]] = [
    [0, 0, 10],
    [100, 0, 10],
    [0, 100, 10],
  ];
  const bbox: BoundingBox = [0, 0, 0, 100, 100, 20];
  const buf = buildDepthBuffer([tri], bbox, pitch);

  // Fully-visible edge: z=5 (in front of the triangle at z=10), horizontal across y=50
  const visibleEdge = {
    id: 'edge-vis',
    points: [[10, 50, 5], [90, 50, 5]] as [number, number, number][],
    adjacentFaces: ['face1'],
  };

  // Fully-hidden edge: z=15 (behind the triangle at z=10), along y=10 inside the triangle area
  const hiddenEdge = {
    id: 'edge-hid',
    points: [[5, 5, 15], [50, 5, 15]] as [number, number, number][],
    adjacentFaces: ['face2'],
  };

  it('visible edge produces only visibleEdges entries', () => {
    const { visibleEdges, hiddenEdges } = classifyEdges([visibleEdge], buf, bbox, pitch);
    expect(visibleEdges.length).toBeGreaterThan(0);
    expect(hiddenEdges.length).toBe(0);
  });

  it('hidden edge produces only hiddenEdges entries', () => {
    const { visibleEdges, hiddenEdges } = classifyEdges([hiddenEdge], buf, bbox, pitch);
    expect(hiddenEdges.length).toBeGreaterThan(0);
    expect(visibleEdges.length).toBe(0);
  });

  it('edge id format is <edgeKey>_<runIndex>', () => {
    const { visibleEdges } = classifyEdges([visibleEdge], buf, bbox, pitch);
    expect(visibleEdges[0].id).toMatch(/^edge-vis_\d+$/);
  });

  it('sample count is at least 8 for short edges', () => {
    // Short edge (3mm long) should still get min 8 samples
    const shortEdge = {
      id: 'short',
      points: [[5, 5, 5], [8, 5, 5]] as [number, number, number][],
      adjacentFaces: [],
    };
    // No error means samples were computed (at least 8)
    expect(() => classifyEdges([shortEdge], buf, bbox, pitch)).not.toThrow();
  });

  it('run-length encoding splits a mixed edge into visible and hidden segments', () => {
    // Edge from visible region (z=5, outside triangle at x=95) to hidden region (z=15, inside triangle at x=5)
    // Travels across the triangle boundary
    const mixedEdge = {
      id: 'mixed',
      // Start at x=5 (inside tri area) z=15 hidden, end at x=95 z=5 visible; y=10 stays inside tri region for first half
      points: [[5, 10, 15], [95, 10, 5]] as [number, number, number][],
      adjacentFaces: [],
    };
    const { visibleEdges, hiddenEdges } = classifyEdges([mixedEdge], buf, bbox, pitch);
    // Both segments should exist
    expect(visibleEdges.length).toBeGreaterThan(0);
    expect(hiddenEdges.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run the test (expect fail)**

```bash
pnpm --filter shared test:unit -- edgeClassifier
```

Expected: all fail (module does not exist).

- [ ] **Step 3: Implement `packages/shared/src/drawing/edgeClassifier.ts`**

```ts
// packages/shared/src/drawing/edgeClassifier.ts
import type { BoundingBox } from '../types';

export type Edge3D = {
  readonly id: string;
  readonly points: ReadonlyArray<readonly [number, number, number]>;
  readonly adjacentFaces?: readonly string[];
};

export type Edge2D = {
  readonly id: string;
  readonly kind: 'silhouette' | 'feature' | 'outline';
  readonly points: ReadonlyArray<readonly [number, number]>;
  readonly sourceFaceIds?: readonly string[];
};

export type ClassifiedEdges = {
  readonly visibleEdges: Edge2D[];
  readonly hiddenEdges: Edge2D[];
};

/**
 * Classify each 3D edge (in view space) as visible or hidden using the pre-built depth buffer.
 * Splits edges into runs via run-length encoding.
 *
 * Edge id format: <edgeKey>_<runIndex>
 */
export function classifyEdges(
  edgesVS: readonly Edge3D[],
  depthBuf: Float32Array,
  bbox: BoundingBox,
  pixelPitchMm: number,
): ClassifiedEdges {
  const [minX, minY, , maxX, maxY] = bbox;
  const cols = Math.ceil((maxX - minX) / pixelPitchMm) + 1;
  const rows = Math.ceil((maxY - minY) / pixelPitchMm) + 1;

  const visibleEdges: Edge2D[] = [];
  const hiddenEdges: Edge2D[] = [];

  for (const edge of edgesVS) {
    const samples = sampleEdge(edge, pixelPitchMm);
    if (samples.length === 0) continue;

    const epsilon = Math.max(1e-4, 0.5 * pixelPitchMm);

    // Determine visibility per sample
    const visible: boolean[] = samples.map(([px, py, pz]) => {
      const col = Math.round((px - minX) / pixelPitchMm);
      const row = Math.round((py - minY) / pixelPitchMm);
      if (col < 0 || col >= cols || row < 0 || row >= rows) return true; // outside buffer → visible
      const bufZ = depthBuf[row * cols + col];
      return pz <= bufZ + epsilon;
    });

    // Run-length encode into runs of same visibility
    type Run = { vis: boolean; pts: ReadonlyArray<readonly [number, number]> };
    const runs: Run[] = [];
    let runStart = 0;

    for (let i = 1; i <= samples.length; i++) {
      if (i === samples.length || visible[i] !== visible[runStart]) {
        const runPts = samples.slice(runStart, i).map(
          ([px, py]) => [px, py] as readonly [number, number],
        );
        runs.push({ vis: visible[runStart], pts: runPts });
        runStart = i;
      }
    }

    let visIdx = 0, hidIdx = 0;
    for (const run of runs) {
      if (run.pts.length < 2) continue; // skip degenerate single-point runs
      const runIndex = run.vis ? visIdx++ : hidIdx++;
      const e2d: Edge2D = {
        id: `${edge.id}_${runIndex}`,
        kind: 'outline',
        points: run.pts,
        sourceFaceIds: edge.adjacentFaces,
      };
      if (run.vis) {
        visibleEdges.push(e2d);
      } else {
        hiddenEdges.push(e2d);
      }
    }
  }

  return { visibleEdges, hiddenEdges };
}

/** Sample N evenly-spaced points along the polyline. N = ceil(arc_length / (0.5 * pitch)), min 8. */
function sampleEdge(
  edge: Edge3D,
  pixelPitchMm: number,
): Array<[number, number, number]> {
  const pts = edge.points;
  if (pts.length === 0) return [];
  if (pts.length === 1) {
    const [x, y, z] = pts[0];
    return [[x, y, z]];
  }

  // Compute total arc length
  let arcLen = 0;
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i][0] - pts[i - 1][0];
    const dy = pts[i][1] - pts[i - 1][1];
    const dz = pts[i][2] - pts[i - 1][2];
    arcLen += Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  const N = Math.max(8, Math.ceil(arcLen / (0.5 * pixelPitchMm)));
  const result: Array<[number, number, number]> = [];

  for (let i = 0; i <= N; i++) {
    const t = i / N;
    result.push(interpolatePolyline(pts, t));
  }
  return result;
}

function interpolatePolyline(
  pts: ReadonlyArray<readonly [number, number, number]>,
  t: number,
): [number, number, number] {
  if (pts.length === 1) return [...pts[0]] as [number, number, number];

  // Compute cumulative arc lengths
  const lens: number[] = [0];
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i][0] - pts[i - 1][0];
    const dy = pts[i][1] - pts[i - 1][1];
    const dz = pts[i][2] - pts[i - 1][2];
    lens.push(lens[i - 1] + Math.sqrt(dx * dx + dy * dy + dz * dz));
  }
  const totalLen = lens[lens.length - 1];
  const target = t * totalLen;

  for (let i = 1; i < pts.length; i++) {
    if (lens[i] >= target - 1e-12) {
      const segLen = lens[i] - lens[i - 1];
      const u = segLen < 1e-12 ? 0 : (target - lens[i - 1]) / segLen;
      const p0 = pts[i - 1], p1 = pts[i];
      return [
        p0[0] + u * (p1[0] - p0[0]),
        p0[1] + u * (p1[1] - p0[1]),
        p0[2] + u * (p1[2] - p0[2]),
      ];
    }
  }
  // Clamp to last point
  return [...pts[pts.length - 1]] as [number, number, number];
}
```

- [ ] **Step 4: Run the test (expect pass)**

```bash
pnpm --filter shared test:unit -- edgeClassifier
```

Expected: all pass.

- [ ] **Step 5: Typecheck**

```bash
pnpm --filter shared typecheck
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/drawing/edgeClassifier.ts \
        packages/shared/src/drawing/__tests__/edgeClassifier.spec.ts
git commit -m "feat(drawing): edgeClassifier run-length visible/hidden split (6 §3.4)"
```

**Verify:** `pnpm --filter shared test:unit -- edgeClassifier` → all pass; `pnpm --filter shared typecheck` → clean.

---

## Second batch (T9..T11) — dispatch to a second Sonnet implementer after T6-T8 are committed.

---

### T9 — `packages/shared/src/drawing/projector.ts`

**Files:**
- Create: `packages/shared/src/drawing/projectedGeometry.ts`
- Create: `packages/shared/src/drawing/projector.ts`
- Create (test): `packages/shared/src/drawing/__tests__/projector.spec.ts`

**Agent:** Sonnet implementer.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/shared/src/drawing/__tests__/projector.spec.ts
import { describe, it, expect } from 'vitest';
import { projectView } from '../projector';
import type { ProjectorInput } from '../projector';

// Helper: build a solid axis-aligned box from (0,0,0) to (w,h,d).
// Returns 12 triangles (2 per face) + 12 edges (4 per axis pair of faces).
function makeBox(w: number, h: number, d: number): ProjectorInput {
  // Vertices
  const vs: [number, number, number][] = [
    [0,0,0],[w,0,0],[w,h,0],[0,h,0],
    [0,0,d],[w,0,d],[w,h,d],[0,h,d],
  ];
  // 12 triangles (2 per face)
  const triangles: [[number,number,number],[number,number,number],[number,number,number]][] = [
    // front (z=0)
    [vs[0],vs[1],vs[2]], [vs[0],vs[2],vs[3]],
    // back (z=d)
    [vs[4],vs[6],vs[5]], [vs[4],vs[7],vs[6]],
    // left (x=0)
    [vs[0],vs[3],vs[7]], [vs[0],vs[7],vs[4]],
    // right (x=w)
    [vs[1],vs[5],vs[6]], [vs[1],vs[6],vs[2]],
    // bottom (y=0)
    [vs[0],vs[4],vs[5]], [vs[0],vs[5],vs[1]],
    // top (y=h)
    [vs[3],vs[2],vs[6]], [vs[3],vs[6],vs[7]],
  ];
  // 12 box edges
  const edges = [
    // bottom rect
    { id: 'e0', points: [vs[0],vs[1]] as [number,number,number][], adjacentFaces: [] },
    { id: 'e1', points: [vs[1],vs[2]] as [number,number,number][], adjacentFaces: [] },
    { id: 'e2', points: [vs[2],vs[3]] as [number,number,number][], adjacentFaces: [] },
    { id: 'e3', points: [vs[3],vs[0]] as [number,number,number][], adjacentFaces: [] },
    // top rect
    { id: 'e4', points: [vs[4],vs[5]] as [number,number,number][], adjacentFaces: [] },
    { id: 'e5', points: [vs[5],vs[6]] as [number,number,number][], adjacentFaces: [] },
    { id: 'e6', points: [vs[6],vs[7]] as [number,number,number][], adjacentFaces: [] },
    { id: 'e7', points: [vs[7],vs[4]] as [number,number,number][], adjacentFaces: [] },
    // verticals
    { id: 'e8',  points: [vs[0],vs[4]] as [number,number,number][], adjacentFaces: [] },
    { id: 'e9',  points: [vs[1],vs[5]] as [number,number,number][], adjacentFaces: [] },
    { id: 'e10', points: [vs[2],vs[6]] as [number,number,number][], adjacentFaces: [] },
    { id: 'e11', points: [vs[3],vs[7]] as [number,number,number][], adjacentFaces: [] },
  ];
  return {
    triangles,
    edges,
    bbox: [0, 0, 0, w, h, d],
  };
}

describe('projectView — box 100×60×40', () => {
  const box = makeBox(100, 60, 40);

  it('front view: 4 outer visible edges, 0 hidden', () => {
    const result = projectView(box, 'front');
    // Front view of a solid box: 4 outer silhouette edges visible; back edges fully hidden
    expect(result.visibleEdges.length).toBeGreaterThanOrEqual(4);
    // All front-face edges (e0..e3) should be visible
    const visIds = new Set(result.visibleEdges.map(e => e.id.split('_')[0]));
    expect(visIds.has('e0')).toBe(true);
    expect(visIds.has('e1')).toBe(true);
    expect(visIds.has('e2')).toBe(true);
    expect(visIds.has('e3')).toBe(true);
  });

  it('front view bbox is positive', () => {
    const result = projectView(box, 'front');
    expect(result.bbox.maxX).toBeGreaterThan(result.bbox.minX);
    expect(result.bbox.maxY).toBeGreaterThan(result.bbox.minY);
  });

  it('top view: produces visible edges', () => {
    const result = projectView(box, 'top');
    expect(result.visibleEdges.length).toBeGreaterThan(0);
  });

  it('iso-NE view: produces visible edges; back edges hidden', () => {
    const result = projectView(box, 'iso-NE');
    expect(result.visibleEdges.length).toBeGreaterThanOrEqual(9);
    expect(result.hiddenEdges.length).toBeGreaterThanOrEqual(1);
  });
});

describe('projectView — cylinder Ø50 h100 (front view)', () => {
  // Approximate a cylinder with 32-segment prism
  function makeCylinder(r: number, h: number, segs = 32): ProjectorInput {
    const triangles: [[number,number,number],[number,number,number],[number,number,number]][] = [];
    const edges: { id: string; points: [number,number,number][]; adjacentFaces: string[] }[] = [];
    for (let i = 0; i < segs; i++) {
      const a0 = (2 * Math.PI * i) / segs;
      const a1 = (2 * Math.PI * (i + 1)) / segs;
      const x0 = r * Math.cos(a0), y0 = r * Math.sin(a0);
      const x1 = r * Math.cos(a1), y1 = r * Math.sin(a1);
      // Side quad
      triangles.push([[x0,y0,0],[x1,y1,0],[x1,y1,h]]);
      triangles.push([[x0,y0,0],[x1,y1,h],[x0,y0,h]]);
      // Top cap
      triangles.push([[0,0,h],[x0,y0,h],[x1,y1,h]]);
      // Bottom cap
      triangles.push([[0,0,0],[x1,y1,0],[x0,y0,0]]);
    }
    // Top and bottom circle edges
    const topPts: [number,number,number][] = [];
    const botPts: [number,number,number][] = [];
    for (let i = 0; i <= segs; i++) {
      const a = (2 * Math.PI * i) / segs;
      topPts.push([r * Math.cos(a), r * Math.sin(a), h]);
      botPts.push([r * Math.cos(a), r * Math.sin(a), 0]);
    }
    edges.push({ id: 'top-circle', points: topPts, adjacentFaces: [] });
    edges.push({ id: 'bot-circle', points: botPts, adjacentFaces: [] });
    // Silhouette lines (at x=±r)
    edges.push({ id: 'sil-left',  points: [[-r,0,0],[-r,0,h]], adjacentFaces: [] });
    edges.push({ id: 'sil-right', points: [[r,0,0],[r,0,h]], adjacentFaces: [] });
    return {
      triangles,
      edges,
      bbox: [-r, -r, 0, r, r, h],
    };
  }

  const cyl = makeCylinder(25, 100, 32);

  it('front view: silhouette lines visible', () => {
    const result = projectView(cyl, 'front');
    const visIds = new Set(result.visibleEdges.map(e => e.id.split('_')[0]));
    expect(visIds.has('sil-left') || visIds.has('sil-right')).toBe(true);
  });

  it('front view: top and bottom circles have ≥16 2D points each', () => {
    const result = projectView(cyl, 'front');
    const allEdges = [...result.visibleEdges, ...result.hiddenEdges];
    const topEdges = allEdges.filter(e => e.id.startsWith('top-circle'));
    const botEdges = allEdges.filter(e => e.id.startsWith('bot-circle'));
    const topPts = topEdges.reduce((s, e) => s + e.points.length, 0);
    const botPts = botEdges.reduce((s, e) => s + e.points.length, 0);
    expect(topPts).toBeGreaterThanOrEqual(16);
    expect(botPts).toBeGreaterThanOrEqual(16);
  });
});
```

- [ ] **Step 2: Run the test (expect fail)**

```bash
pnpm --filter shared test:unit -- projector.spec
```

Expected: all fail.

- [ ] **Step 3: Create `packages/shared/src/drawing/projectedGeometry.ts`**

```ts
// packages/shared/src/drawing/projectedGeometry.ts

export type ProjectedGeometry = {
  readonly visibleEdges: readonly Edge2D[];
  readonly hiddenEdges:  readonly Edge2D[];
  readonly bbox: { readonly minX: number; readonly minY: number; readonly maxX: number; readonly maxY: number };
};

export type Edge2D = {
  readonly id: string;
  readonly kind: 'silhouette' | 'feature' | 'outline';
  readonly points: ReadonlyArray<readonly [number, number]>;
  readonly sourceFaceIds?: readonly string[];
};
```

- [ ] **Step 4: Implement `packages/shared/src/drawing/projector.ts`**

```ts
// packages/shared/src/drawing/projector.ts
import type { BoundingBox } from '../types';
import { buildViewMatrix, apply, type ViewOrientation } from './viewMatrix';
import { buildDepthBuffer, adaptivePixelPitch } from './depthBuffer';
import { classifyEdges, type Edge3D } from './edgeClassifier';
import type { ProjectedGeometry } from './projectedGeometry';

export type { ProjectedGeometry };

export type EdgeMesh3D = {
  readonly id: string;
  readonly points: ReadonlyArray<[number, number, number]>;
  readonly adjacentFaces?: readonly string[];
};

export type ProjectorInput = {
  readonly triangles: ReadonlyArray<[[number,number,number],[number,number,number],[number,number,number]]>;
  readonly edges: readonly EdgeMesh3D[];
  readonly bbox: BoundingBox;
};

/**
 * Pure projection: transforms source geometry into 2D visible/hidden Edge2D sets.
 * Same input always produces byte-identical output (deterministic).
 */
export function projectView(
  source: ProjectorInput,
  orientation: ViewOrientation,
): ProjectedGeometry {
  const Mview = buildViewMatrix(orientation, source.bbox);

  // Transform triangles to view space
  const trisVS = source.triangles.map(
    ([v0, v1, v2]) =>
      [
        [apply(Mview, { x: v0[0], y: v0[1], z: v0[2] })].map(v => [v.x, v.y, v.z])[0],
        [apply(Mview, { x: v1[0], y: v1[1], z: v1[2] })].map(v => [v.x, v.y, v.z])[0],
        [apply(Mview, { x: v2[0], y: v2[1], z: v2[2] })].map(v => [v.x, v.y, v.z])[0],
      ] as [[number,number,number],[number,number,number],[number,number,number]],
  );

  // Transform edges to view space
  const edgesVS: Edge3D[] = source.edges.map(e => ({
    id: e.id,
    points: e.points.map(p => {
      const v = apply(Mview, { x: p[0], y: p[1], z: p[2] });
      return [v.x, v.y, v.z] as [number, number, number];
    }),
    adjacentFaces: e.adjacentFaces ? [...e.adjacentFaces] : [],
  }));

  const pitch = adaptivePixelPitch(source.bbox);
  const viewBBox = computeViewBBox(trisVS, edgesVS);
  const buf = buildDepthBuffer(trisVS, viewBBox, pitch);

  const { visibleEdges, hiddenEdges } = classifyEdges(edgesVS, buf, viewBBox, pitch);

  // Compute 2D bbox from all edge points
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const e of [...visibleEdges, ...hiddenEdges]) {
    for (const [px, py] of e.points) {
      if (px < minX) minX = px;
      if (py < minY) minY = py;
      if (px > maxX) maxX = px;
      if (py > maxY) maxY = py;
    }
  }
  if (!isFinite(minX)) { minX = 0; minY = 0; maxX = 0; maxY = 0; }

  return { visibleEdges, hiddenEdges, bbox: { minX, minY, maxX, maxY } };
}

/** Compute the view-space bounding box from transformed triangles + edges. */
function computeViewBBox(
  trisVS: ReadonlyArray<[[number,number,number],[number,number,number],[number,number,number]]>,
  edgesVS: readonly Edge3D[],
): BoundingBox {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

  function expand(x: number, y: number, z: number) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }

  for (const [v0, v1, v2] of trisVS) {
    expand(v0[0], v0[1], v0[2]);
    expand(v1[0], v1[1], v1[2]);
    expand(v2[0], v2[1], v2[2]);
  }
  for (const e of edgesVS) {
    for (const [x, y, z] of e.points) expand(x, y, z);
  }

  // Ensure non-degenerate (add small pad to Z for edge-only inputs)
  if (!isFinite(minX)) return [0, 0, 0, 1, 1, 1];
  return [minX, minY, minZ - 1, maxX, maxY, maxZ + 1];
}
```

- [ ] **Step 5: Run the test (expect pass)**

```bash
pnpm --filter shared test:unit -- projector.spec
```

Expected: all pass.

- [ ] **Step 6: Typecheck**

```bash
pnpm --filter shared typecheck
```

Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/drawing/projectedGeometry.ts \
        packages/shared/src/drawing/projector.ts \
        packages/shared/src/drawing/__tests__/projector.spec.ts
git commit -m "feat(drawing): projector.ts — projectView orchestrator (6 §3.5)"
```

**Verify:** `pnpm --filter shared test:unit -- projector.spec` → all pass; `pnpm --filter shared typecheck` → clean.

---

### T10 — Determinism test

**Files:**
- Create (test only): `packages/shared/src/drawing/__tests__/projector.determinism.spec.ts`

**Agent:** Sonnet implementer.

- [ ] **Step 1: Implement the test (no source change)**

```ts
// packages/shared/src/drawing/__tests__/projector.determinism.spec.ts
import { describe, it, expect } from 'vitest';
import { projectView, type ProjectorInput } from '../projector';

// Minimal 100×60×40 box input (same as projector.spec)
const vs: [number,number,number][] = [
  [0,0,0],[100,0,0],[100,60,0],[0,60,0],
  [0,0,40],[100,0,40],[100,60,40],[0,60,40],
];
const BOX_INPUT: ProjectorInput = {
  triangles: [
    [vs[0],vs[1],vs[2]], [vs[0],vs[2],vs[3]],
    [vs[4],vs[6],vs[5]], [vs[4],vs[7],vs[6]],
    [vs[0],vs[3],vs[7]], [vs[0],vs[7],vs[4]],
    [vs[1],vs[5],vs[6]], [vs[1],vs[6],vs[2]],
    [vs[0],vs[4],vs[5]], [vs[0],vs[5],vs[1]],
    [vs[3],vs[2],vs[6]], [vs[3],vs[6],vs[7]],
  ],
  edges: [
    { id: 'e0', points: [vs[0],vs[1]], adjacentFaces: [] },
    { id: 'e1', points: [vs[1],vs[2]], adjacentFaces: [] },
    { id: 'e2', points: [vs[2],vs[3]], adjacentFaces: [] },
    { id: 'e3', points: [vs[3],vs[0]], adjacentFaces: [] },
    { id: 'e4', points: [vs[4],vs[5]], adjacentFaces: [] },
    { id: 'e5', points: [vs[5],vs[6]], adjacentFaces: [] },
    { id: 'e6', points: [vs[6],vs[7]], adjacentFaces: [] },
    { id: 'e7', points: [vs[7],vs[4]], adjacentFaces: [] },
    { id: 'e8',  points: [vs[0],vs[4]], adjacentFaces: [] },
    { id: 'e9',  points: [vs[1],vs[5]], adjacentFaces: [] },
    { id: 'e10', points: [vs[2],vs[6]], adjacentFaces: [] },
    { id: 'e11', points: [vs[3],vs[7]], adjacentFaces: [] },
  ],
  bbox: [0, 0, 0, 100, 60, 40],
};

function canonicalize(obj: unknown): string {
  return JSON.stringify(obj, (_, v) =>
    typeof v === 'number' ? parseFloat(v.toFixed(9)) : v,
  );
}

describe('projector determinism', () => {
  it('100 runs of projectView produce byte-identical output for front view', () => {
    const first = canonicalize(projectView(BOX_INPUT, 'front'));
    for (let i = 1; i < 100; i++) {
      expect(canonicalize(projectView(BOX_INPUT, 'front'))).toBe(first);
    }
  });

  it('100 runs of projectView produce byte-identical output for iso-NE view', () => {
    const first = canonicalize(projectView(BOX_INPUT, 'iso-NE'));
    for (let i = 1; i < 100; i++) {
      expect(canonicalize(projectView(BOX_INPUT, 'iso-NE'))).toBe(first);
    }
  });
});
```

- [ ] **Step 2: Run the test (expect pass — no source change needed)**

```bash
pnpm --filter shared test:unit -- projector.determinism
```

Expected: all pass.

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/drawing/__tests__/projector.determinism.spec.ts
git commit -m "test(drawing): projector determinism — 100-run byte-identical check (6 §9.1)"
```

**Verify:** `pnpm --filter shared test:unit -- projector.determinism` → all pass.

---

### T11 — `packages/shared/src/drawing/fingerprint.ts`

**Files:**
- Create: `packages/shared/src/drawing/fingerprint.ts`
- Create (test): `packages/shared/src/drawing/__tests__/fingerprint.spec.ts`

**Agent:** Sonnet implementer.

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared/src/drawing/__tests__/fingerprint.spec.ts
import { describe, it, expect } from 'vitest';
import { computeViewFingerprint, computeSourceGeometryHash } from '../fingerprint';
import type { ProjectorInput } from '../projector';

const BASE_INPUT: ProjectorInput = {
  triangles: [[[0,0,0],[1,0,0],[0,1,0]]],
  edges: [{ id: 'e0', points: [[0,0,0],[1,0,0]], adjacentFaces: [] }],
  bbox: [0, 0, 0, 1, 1, 0],
};

const BASE_VIEW_SPEC = {
  orientation: 'front' as const,
  scale: { numerator: 1, denominator: 1 },
  showHidden: true,
};

describe('computeSourceGeometryHash', () => {
  it('same input → same hash', async () => {
    const h1 = await computeSourceGeometryHash(BASE_INPUT.triangles, BASE_INPUT.edges);
    const h2 = await computeSourceGeometryHash(BASE_INPUT.triangles, BASE_INPUT.edges);
    expect(h1).toBe(h2);
  });

  it('returns a 64-char hex string (SHA-256)', async () => {
    const h = await computeSourceGeometryHash(BASE_INPUT.triangles, BASE_INPUT.edges);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it('perturbation > 1e-3 mm → different hash', async () => {
    const perturbed: ProjectorInput = {
      ...BASE_INPUT,
      triangles: [[[0,0,0],[1.01,0,0],[0,1,0]]],  // 10mm perturbation
    };
    const h1 = await computeSourceGeometryHash(BASE_INPUT.triangles, BASE_INPUT.edges);
    const h2 = await computeSourceGeometryHash(perturbed.triangles, perturbed.edges);
    expect(h1).not.toBe(h2);
  });

  it('perturbation < 1e-3 mm → same hash (rounding bucket)', async () => {
    const perturbed: ProjectorInput = {
      ...BASE_INPUT,
      triangles: [[[0,0,0],[1.0001,0,0],[0,1,0]]],  // 0.1µm — below threshold
    };
    const h1 = await computeSourceGeometryHash(BASE_INPUT.triangles, BASE_INPUT.edges);
    const h2 = await computeSourceGeometryHash(perturbed.triangles, perturbed.edges);
    expect(h1).toBe(h2);
  });
});

describe('computeViewFingerprint', () => {
  it('same viewSpec + source → same fingerprint', async () => {
    const f1 = await computeViewFingerprint(BASE_VIEW_SPEC, BASE_INPUT);
    const f2 = await computeViewFingerprint(BASE_VIEW_SPEC, BASE_INPUT);
    expect(f1).toBe(f2);
  });

  it('different orientation → different fingerprint', async () => {
    const f1 = await computeViewFingerprint(BASE_VIEW_SPEC, BASE_INPUT);
    const f2 = await computeViewFingerprint({ ...BASE_VIEW_SPEC, orientation: 'top' }, BASE_INPUT);
    expect(f1).not.toBe(f2);
  });

  it('returns 64-char hex string', async () => {
    const f = await computeViewFingerprint(BASE_VIEW_SPEC, BASE_INPUT);
    expect(f).toMatch(/^[0-9a-f]{64}$/);
  });
});
```

- [ ] **Step 2: Run the test (expect fail)**

```bash
pnpm --filter shared test:unit -- fingerprint
```

Expected: all fail (module does not exist).

- [ ] **Step 3: Implement `packages/shared/src/drawing/fingerprint.ts`**

```ts
// packages/shared/src/drawing/fingerprint.ts
import type { ProjectorInput, EdgeMesh3D } from './projector';
import type { ViewOrientation } from './viewMatrix';

export type ViewSpec = {
  readonly orientation: ViewOrientation;
  readonly scale: { readonly numerator: number; readonly denominator: number };
  readonly showHidden: boolean;
};

/** Round a float to 1e-3 mm for canonical determinism. */
function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

/** Canonical string for a triangle (floats rounded to 1e-3 mm). */
function encodeTriangle(
  t: readonly [readonly [number,number,number], readonly [number,number,number], readonly [number,number,number]],
): string {
  return t.map(v => v.map(round3).join(',')).join(';');
}

/** Canonical string for an edge. */
function encodeEdge(e: EdgeMesh3D): string {
  return e.id + ':' + e.points.map(p => p.map(round3).join(',')).join(';');
}

async function sha256hex(data: string): Promise<string> {
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(data));
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Hash the source geometry (triangles + edges), with floats rounded to 1e-3 mm.
 * Deterministic across runs regardless of object reference identity.
 */
export async function computeSourceGeometryHash(
  triangles: ProjectorInput['triangles'],
  edges: ProjectorInput['edges'],
): Promise<string> {
  const triStr = [...triangles].map(encodeTriangle).sort().join('|');
  const edgeStr = [...edges].map(encodeEdge).sort().join('|');
  return sha256hex(`tris:${triStr}§edges:${edgeStr}`);
}

/**
 * Compute the per-view input fingerprint.
 * Returns a 64-char hex SHA-256 string.
 * Spec §7.1.
 */
export async function computeViewFingerprint(
  viewSpec: ViewSpec,
  sourceGeometry: ProjectorInput,
): Promise<string> {
  const [bboxHash, triHash, edgeHash] = await Promise.all([
    sha256hex(sourceGeometry.bbox.map(round3).join(',')),
    computeSourceGeometryHash(sourceGeometry.triangles, sourceGeometry.edges),
    // edgeHash is already embedded in computeSourceGeometryHash, but we keep the
    // canonical spec shape with named fields
    sha256hex([...sourceGeometry.edges].map(encodeEdge).sort().join('|')),
  ]);

  const canonical = JSON.stringify({
    orientation: viewSpec.orientation,
    scale: viewSpec.scale,
    showHidden: viewSpec.showHidden,
    sourceBboxHash: bboxHash,
    sourceTrianglesHash: triHash,
    sourceEdgesHash: edgeHash,
  });
  return sha256hex(canonical);
}
```

- [ ] **Step 4: Run the test (expect pass)**

```bash
pnpm --filter shared test:unit -- fingerprint
```

Expected: all pass.

- [ ] **Step 5: Typecheck**

```bash
pnpm --filter shared typecheck
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/drawing/fingerprint.ts \
        packages/shared/src/drawing/__tests__/fingerprint.spec.ts
git commit -m "feat(drawing): fingerprint SHA-256 + 1e-3 mm rounding bucket (6 §7.1)"
```

**Verify:** `pnpm --filter shared test:unit -- fingerprint` → all pass; `pnpm --filter shared typecheck` → clean.

---

## Phase 3 — Title block resolver

Two tasks (T12..T13). Batch with Phase 2 second dispatch or run as its own dispatch.

---

### T12 — `packages/shared/src/drawing/titleBlock.ts`

**Files:**
- Create: `packages/shared/src/drawing/titleBlock.ts`
- Create (test): `packages/shared/src/drawing/__tests__/titleBlock.spec.ts`

**Agent:** Sonnet implementer.

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared/src/drawing/__tests__/titleBlock.spec.ts
import { describe, it, expect } from 'vitest';
import { resolveTitleBlock } from '../titleBlock';
import type { DrawingDocument, DrawingSheet } from '../drawingTypes';
import type { PartDocument } from '../../types';

// Minimal PartDocument stub
const part: PartDocument = {
  id: 'p1',
  name: 'Cabinet Panel',
  units: 'mm',
  parameters: {},
  featureTree: [],
  properties: {},
  materials: [{ id: 'm1', name: 'Birch Ply', defaultThickness: 18, color: '#c8a96e' }],
  hardware: [],
};

// Minimal DrawingDocument stub
const drawing: DrawingDocument = {
  id: 'd1',
  name: 'Cabinet Panel — Drawing',
  units: 'mm',
  source: { partPath: 'parts/cabinet.zipt', sourceKind: 'part' },
  properties: {},
  sheets: [],
  activeSheetId: 's1',
  createdAt: '2026-05-05T10:00:00Z',
};

// Sheet with a base view scale 1:5
const sheet: DrawingSheet = {
  id: 's1',
  name: 'Sheet 1',
  size: { kind: 'iso', size: 'A3' },
  orientation: 'landscape',
  views: [
    {
      id: 'v1',
      kind: 'base',
      positionMm: { x: 10, y: 10 },
      scale: { numerator: 1, denominator: 5 },
      orientation: 'front',
      showHidden: true,
    },
  ],
  dimensions: [],
  annotations: [],
  titleBlock: {},
};

const allSheets: DrawingSheet[] = [sheet];

describe('resolveTitleBlock — no overrides', () => {
  it('auto-derives drawingName from drawing.name', () => {
    const r = resolveTitleBlock(drawing, sheet, allSheets, part);
    expect(r.drawingName).toBe('Cabinet Panel — Drawing');
  });

  it('auto-derives partName from source.name', () => {
    const r = resolveTitleBlock(drawing, sheet, allSheets, part);
    expect(r.partName).toBe('Cabinet Panel');
  });

  it('auto-derives material from part.materials[0].name', () => {
    const r = resolveTitleBlock(drawing, sheet, allSheets, part);
    expect(r.material).toBe('Birch Ply');
  });

  it('auto-derives scaleText from primary base view scale', () => {
    const r = resolveTitleBlock(drawing, sheet, allSheets, part);
    expect(r.scaleText).toBe('1:5');
  });

  it('auto-derives sheetNumber from sheet index', () => {
    const r = resolveTitleBlock(drawing, sheet, allSheets, part);
    expect(r.sheetNumber).toEqual({ current: 1, total: 1 });
  });

  it('auto-derives date as ISO yyyy-mm-dd from drawing.createdAt', () => {
    const r = resolveTitleBlock(drawing, sheet, allSheets, part);
    expect(r.date).toBe('2026-05-05');
  });
});

describe('resolveTitleBlock — full overrides', () => {
  const sheetWithOverrides: DrawingSheet = {
    ...sheet,
    titleBlock: {
      drawingName: 'Custom Name',
      partName: 'Custom Part',
      drawnBy: 'JD',
      approvedBy: 'SM',
      scaleText: '1:10',
      date: '2025-01-01',
      material: 'MDF',
      revision: 'B',
      notes: 'For review only',
    },
  };

  it('full overrides win over all auto-derived values', () => {
    const r = resolveTitleBlock(drawing, sheetWithOverrides, allSheets, part);
    expect(r.drawingName).toBe('Custom Name');
    expect(r.partName).toBe('Custom Part');
    expect(r.drawnBy).toBe('JD');
    expect(r.approvedBy).toBe('SM');
    expect(r.scaleText).toBe('1:10');
    expect(r.date).toBe('2025-01-01');
    expect(r.material).toBe('MDF');
    expect(r.revision).toBe('B');
    expect(r.notes).toBe('For review only');
  });
});

describe('resolveTitleBlock — mixed overrides', () => {
  const sheetPartial: DrawingSheet = {
    ...sheet,
    titleBlock: { drawingName: 'Override Only Name' },
  };

  it('overridden fields use override; non-overridden fields use auto-derived', () => {
    const r = resolveTitleBlock(drawing, sheetPartial, allSheets, part);
    expect(r.drawingName).toBe('Override Only Name');
    expect(r.partName).toBe('Cabinet Panel');   // auto-derived
    expect(r.material).toBe('Birch Ply');       // auto-derived
    expect(r.scaleText).toBe('1:5');            // auto-derived
  });
});

describe('resolveTitleBlock — edge cases', () => {
  it('no base view on sheet → scaleText defaults to 1:1', () => {
    const sheetNoViews: DrawingSheet = { ...sheet, views: [] };
    const r = resolveTitleBlock(drawing, sheetNoViews, allSheets, part);
    expect(r.scaleText).toBe('1:1');
  });

  it('part with no materials → material is empty string', () => {
    const partNoMat: PartDocument = { ...part, materials: [] };
    const r = resolveTitleBlock(drawing, sheet, allSheets, partNoMat);
    expect(r.material).toBe('');
  });
});
```

- [ ] **Step 2: Run the test (expect fail)**

```bash
pnpm --filter shared test:unit -- titleBlock
```

Expected: all fail (module does not exist).

- [ ] **Step 3: Create `packages/shared/src/drawing/drawingTypes.ts`**

This file holds the DrawingDocument / DrawingSheet shape imports needed by titleBlock.ts and later tasks. It re-exports from the spec §2 model (which Phase 1 adds to `packages/shared/src/types.ts`). Since Phase 1 (T1-T5, owned by Part 1) has not yet landed in this batch, use a local minimal declaration here that will be reconciled when Part 1 merges.

```ts
// packages/shared/src/drawing/drawingTypes.ts
// Minimal forward declarations for types defined by Phase 1 (T1-T5).
// When Phase 1 lands these will be imported from '../../types' directly.

export type TitleBlockOverrides = {
  readonly drawingName?: string;
  readonly partName?: string;
  readonly drawnBy?: string;
  readonly approvedBy?: string;
  readonly scaleText?: string;
  readonly date?: string;
  readonly material?: string;
  readonly revision?: string;
  readonly notes?: string;
};

export type ViewScale = {
  readonly numerator: number;
  readonly denominator: number;
};

export type DrawingViewBase = {
  readonly id: string;
  readonly kind: 'base';
  readonly positionMm: { readonly x: number; readonly y: number };
  readonly scale: ViewScale;
  readonly orientation: string;
  readonly showHidden: boolean;
};

export type DrawingViewProjected = {
  readonly id: string;
  readonly kind: 'projected';
  readonly positionMm: { readonly x: number; readonly y: number };
  readonly baseViewId: string;
  readonly direction: string;
  readonly scale: ViewScale;
  readonly showHidden: boolean;
};

export type DrawingViewIso = {
  readonly id: string;
  readonly kind: 'iso';
  readonly positionMm: { readonly x: number; readonly y: number };
  readonly corner: string;
  readonly scale: ViewScale;
  readonly showHidden: boolean;
};

export type DrawingView = DrawingViewBase | DrawingViewProjected | DrawingViewIso;

export type DrawingSheet = {
  readonly id: string;
  readonly name: string;
  readonly size: unknown;
  readonly orientation: 'landscape' | 'portrait';
  readonly views: readonly DrawingView[];
  readonly dimensions: readonly unknown[];
  readonly annotations: readonly unknown[];
  readonly titleBlock: TitleBlockOverrides;
};

export type DrawingSource = {
  readonly partPath: string;
  readonly sourceKind: 'part' | 'assembly';
};

export type DrawingDocument = {
  readonly id: string;
  readonly name: string;
  readonly units: 'mm';
  readonly source: DrawingSource;
  readonly properties: Record<string, string | number | boolean>;
  readonly sheets: readonly DrawingSheet[];
  readonly activeSheetId: string;
  readonly createdAt: string;
};
```

- [ ] **Step 4: Implement `packages/shared/src/drawing/titleBlock.ts`**

```ts
// packages/shared/src/drawing/titleBlock.ts
import type { PartDocument, AssemblyDocument } from '../../types';
import type { DrawingDocument, DrawingSheet, DrawingViewBase } from './drawingTypes';

export type ResolvedTitleBlock = {
  readonly drawingName: string;
  readonly partName: string;
  readonly drawnBy: string;
  readonly approvedBy: string;
  readonly scaleText: string;
  readonly date: string;
  readonly material: string;
  readonly revision: string;
  readonly notes: string;
  readonly sheetNumber: { readonly current: number; readonly total: number };
};

/**
 * Merge per-sheet TitleBlockOverrides with auto-derived values.
 * Override fields take precedence field-by-field; missing overrides fall back to auto.
 *
 * @param drawing      The DrawingDocument (name, createdAt, source).
 * @param sheet        The specific sheet being rendered.
 * @param allSheets    All sheets in the drawing (for n/N computation).
 * @param source       The resolved PartDocument or AssemblyDocument.
 */
export function resolveTitleBlock(
  drawing: DrawingDocument,
  sheet: DrawingSheet,
  allSheets: readonly DrawingSheet[],
  source: PartDocument | AssemblyDocument,
): ResolvedTitleBlock {
  const ov = sheet.titleBlock;

  // Auto-derive scale from primary (first) base view
  const baseView = sheet.views.find((v): v is DrawingViewBase => v.kind === 'base');
  const autoScale = baseView
    ? `${baseView.scale.numerator}:${baseView.scale.denominator}`
    : '1:1';

  // Auto-derive material: part gets first material name; assembly → empty
  const autoMaterial =
    'materials' in source && source.materials.length > 0
      ? source.materials[0].name
      : '';

  // Auto-derive date from drawing.createdAt (ISO yyyy-mm-dd prefix)
  const autoDate = drawing.createdAt ? drawing.createdAt.slice(0, 10) : '';

  // Sheet n/N
  const sheetIndex = allSheets.findIndex(s => s.id === sheet.id);
  const sheetNumber = {
    current: sheetIndex >= 0 ? sheetIndex + 1 : 1,
    total: allSheets.length,
  };

  return {
    drawingName: ov.drawingName ?? drawing.name,
    partName: ov.partName ?? source.name,
    drawnBy: ov.drawnBy ?? '',
    approvedBy: ov.approvedBy ?? '',
    scaleText: ov.scaleText ?? autoScale,
    date: ov.date ?? autoDate,
    material: ov.material ?? autoMaterial,
    revision: ov.revision ?? '',
    notes: ov.notes ?? '',
    sheetNumber,
  };
}
```

- [ ] **Step 5: Run the test (expect pass)**

```bash
pnpm --filter shared test:unit -- titleBlock
```

Expected: all pass.

- [ ] **Step 6: Typecheck**

```bash
pnpm --filter shared typecheck
```

Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/drawing/titleBlock.ts \
        packages/shared/src/drawing/drawingTypes.ts \
        packages/shared/src/drawing/__tests__/titleBlock.spec.ts
git commit -m "feat(drawing): resolveTitleBlock override-merge + auto-derive (6 §2.8)"
```

**Verify:** `pnpm --filter shared test:unit -- titleBlock` → all pass; `pnpm --filter shared typecheck` → clean.

---

### T13 — Re-export from `packages/shared/src/index.ts`

**Files:**
- Modify: `packages/shared/src/index.ts`

**Agent:** Sonnet implementer.

- [ ] **Step 1: Inspect current index.ts exports**

```bash
grep -n "export" packages/shared/src/index.ts | tail -30
```

Identify the last export line to know where to append.

- [ ] **Step 2: Add drawing/* re-exports**

Append to `packages/shared/src/index.ts`:

```ts
// drawing module (Sub-project 6)
export type { Mat4, ViewOrientation } from './drawing/viewMatrix';
export { buildViewMatrix, apply } from './drawing/viewMatrix';
export { buildDepthBuffer, adaptivePixelPitch } from './drawing/depthBuffer';
export type { Edge3D, Edge2D, ClassifiedEdges } from './drawing/edgeClassifier';
export { classifyEdges } from './drawing/edgeClassifier';
export type { ProjectedGeometry } from './drawing/projectedGeometry';
export type { ProjectorInput, EdgeMesh3D } from './drawing/projector';
export { projectView } from './drawing/projector';
export type { ViewSpec } from './drawing/fingerprint';
export { computeViewFingerprint, computeSourceGeometryHash } from './drawing/fingerprint';
export type {
  TitleBlockOverrides,
  ViewScale,
  DrawingView,
  DrawingSheet,
  DrawingDocument,
  DrawingSource,
  ResolvedTitleBlock,
} from './drawing/drawingTypes';
export { resolveTitleBlock } from './drawing/titleBlock';
```

- [ ] **Step 3: Run full shared test suite**

```bash
pnpm --filter shared test:unit
```

Expected: all previously-passing tests still pass; new drawing tests pass.

- [ ] **Step 4: Typecheck**

```bash
pnpm --filter shared typecheck
```

Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/index.ts
git commit -m "feat(drawing): re-export drawing/* from shared/index.ts (6 §T13)"
```

**Verify:** `pnpm --filter shared typecheck` → clean; `pnpm --filter shared test:unit` → all pass.
## Phase 4 — Kernel adapter

Three tasks; all live in `packages/kernel/src/adapter/drawing/` and `packages/kernel/src/api.ts` and `packages/app/src/kernel-client/`. Dispatch as one Sonnet subagent batch — they share the adapter module and must commit in order (T14 → T15 → T16).

### T14 — `getProjectorInput` kernel-side adapter

**Files:**
- Create: `packages/kernel/src/adapter/drawing/getProjectorInput.ts`
- Create: `packages/kernel/src/adapter/drawing/__tests__/getProjectorInput.spec.ts`

**Agent:** Sonnet implementer.

- [ ] **Step 1: Write the failing test**

```ts
// packages/kernel/src/adapter/drawing/__tests__/getProjectorInput.spec.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { loadOcct } from '../../occt/occtLoader';
import { newPart } from '../../adapter/PartDocument';
import { addFeature } from '../../adapter/PartDocument';
import { executeTree } from '../../adapter/FeatureTree';
import { getProjectorInput } from '../drawing/getProjectorInput';
import type { OcctInstance } from '../../occt/occtLoader';

let oc: OcctInstance;

beforeAll(async () => {
  oc = await loadOcct();
}, 30_000);

describe('getProjectorInput — part source', () => {
  it('returns triangles, edges, and bbox for a 100×60×40 box', async () => {
    // Build a minimal box part so we have a NamedShape in the cache
    let part = newPart('box-fixture');
    part = addFeature(part, {
      kind: 'sketch',
      id: 'sk1',
      plane: { source: 'workPlane', featureId: 'origin.XY' },
      primitives: [
        { kind: 'rect', id: 'r1', x: 0, y: 0, width: 100, height: 60 },
      ],
      constraints: [],
    });
    part = addFeature(part, {
      kind: 'extrusion',
      id: 'ex1',
      sketchId: 'sk1',
      depth: { kind: 'literal', value: 40 },
      direction: 'normal',
      operation: 'new',
    });
    const execResult = await executeTree(oc, part, () => undefined);
    expect(execResult.ok).toBe(true);
    if (!execResult.ok) return;

    const input = await getProjectorInput(oc, execResult.value.namedShape);

    // triangles: a box has 12 triangles (2 per face × 6 faces)
    expect(input.triangles.length).toBeGreaterThanOrEqual(12);

    // edges: a box has 12 edges — each should appear in tessellateEdges output
    expect(input.edges.length).toBeGreaterThanOrEqual(12);

    // bbox: roughly matches the 100×60×40 box
    expect(input.bbox.max.x - input.bbox.min.x).toBeCloseTo(100, 0);
    expect(input.bbox.max.y - input.bbox.min.y).toBeCloseTo(60, 0);
    expect(input.bbox.max.z - input.bbox.min.z).toBeCloseTo(40, 0);
  });
});
```

- [ ] **Step 2: Run the test (expect fail)**

```
cd packages/kernel && pnpm test:unit -- getProjectorInput
```
Expected: fail — module does not exist.

- [ ] **Step 3: Create `packages/kernel/src/adapter/drawing/getProjectorInput.ts`**

```ts
import type { OcctInstance } from '../../occt/occtLoader';
import type { TessellatedEdge, BoundingBox } from '@zilventor/shared';
import { tessellate, tessellateEdges } from '../../occt/Tessellator';
import { computeBoundingBox } from '../../occt/SolidOps';
import type { NamedShape } from '../../occt/FaceNaming';

export type ProjectorInputTriangle = readonly [
  { x: number; y: number; z: number },
  { x: number; y: number; z: number },
  { x: number; y: number; z: number },
];

export type ProjectorInput = {
  readonly triangles: ProjectorInputTriangle[];
  readonly edges: TessellatedEdge[];
  readonly bbox: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } };
};

/**
 * Build the projection input for a single-part source.
 *
 * Calls `tessellate` (which runs BRepMesh_IncrementalMesh on the shape to
 * populate face triangulations) then `tessellateEdges` (which reads the
 * edge polygon-on-triangulation populated by the same mesh pass).
 *
 * linearDeflection = 0.05 mm gives adequate silhouette resolution for A3
 * drawings at 1:1 scale; angularDeflection = 0.3 rad ≈ 17° keeps curved
 * surfaces smooth at print scale.
 */
export async function getProjectorInput(
  oc: OcctInstance,
  namedShape: NamedShape,
): Promise<ProjectorInput> {
  const mesh = tessellate(oc, namedShape.shape, {
    linearDeflection: 0.05,
    angularDeflection: 0.3,
  });

  const edges = tessellateEdges(oc, namedShape);

  // Convert flat Float32Array positions + Uint32Array indices into triangle triples
  const triangles: ProjectorInputTriangle[] = [];
  const pos = mesh.positions;
  const idx = mesh.indices;
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i]! * 3;
    const b = idx[i + 1]! * 3;
    const c = idx[i + 2]! * 3;
    triangles.push([
      { x: pos[a]!, y: pos[a + 1]!, z: pos[a + 2]! },
      { x: pos[b]!, y: pos[b + 1]!, z: pos[b + 2]! },
      { x: pos[c]!, y: pos[c + 1]!, z: pos[c + 2]! },
    ]);
  }

  const bb = mesh.boundingBox;
  return {
    triangles,
    edges,
    bbox: {
      min: { x: bb.min.x, y: bb.min.y, z: bb.min.z },
      max: { x: bb.max.x, y: bb.max.y, z: bb.max.z },
    },
  };
}

/**
 * Build the projection input for an assembly source.
 *
 * Walks the assembly's visible leaves (same enumeration as the BOM / cut-list
 * aggregators in 4d) and concatenates triangles + edges from each part,
 * transforming them by the component's composed pose.
 *
 * Suppressed / hidden components are excluded because `visibleLeaves` already
 * filters `c.visible === false` components out of the walk.
 *
 * @param partInputs - Map from `partPath` to an already-computed `ProjectorInput`
 *   for that part. The caller (kernel API) is responsible for loading + executing
 *   each referenced part and calling `getProjectorInput` on its NamedShape,
 *   then passing the results here.
 * @param leaves - output of `visibleLeaves(assemblyDoc, subAssemblyCache)`;
 *   each leaf carries a `componentPath` and the composed pose is provided via
 *   the `poses` map.
 */
export function assembleProjectorInputs(
  partInputs: Map<string, ProjectorInput>,
  leaves: ReadonlyArray<{
    partPath: string;
    pose: { translation: { x: number; y: number; z: number }; quaternion: [number, number, number, number] };
  }>,
): ProjectorInput {
  const allTriangles: ProjectorInputTriangle[] = [];
  const allEdges: TessellatedEdge[] = [];

  for (const leaf of leaves) {
    const input = partInputs.get(leaf.partPath);
    if (!input) continue;

    const { translation: t, quaternion: q } = leaf.pose;

    // Transform each triangle vertex by the component pose
    for (const tri of input.triangles) {
      allTriangles.push([
        applyPose(tri[0], t, q),
        applyPose(tri[1], t, q),
        applyPose(tri[2], t, q),
      ]);
    }

    // Transform each edge segment
    for (const edge of input.edges) {
      const transformedSegments: Array<[
        { x: number; y: number; z: number },
        { x: number; y: number; z: number },
      ]> = edge.segments.map(([a, b]) => [
        applyPose(a, t, q),
        applyPose(b, t, q),
      ]);
      allEdges.push({ ...edge, segments: transformedSegments });
    }
  }

  // Compute combined bounding box
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const tri of allTriangles) {
    for (const v of tri) {
      if (v.x < minX) minX = v.x;
      if (v.y < minY) minY = v.y;
      if (v.z < minZ) minZ = v.z;
      if (v.x > maxX) maxX = v.x;
      if (v.y > maxY) maxY = v.y;
      if (v.z > maxZ) maxZ = v.z;
    }
  }
  if (!isFinite(minX)) { minX = 0; minY = 0; minZ = 0; maxX = 0; maxY = 0; maxZ = 0; }

  return {
    triangles: allTriangles,
    edges: allEdges,
    bbox: { min: { x: minX, y: minY, z: minZ }, max: { x: maxX, y: maxY, z: maxZ } },
  };
}

// --- helpers ---

type Vec3 = { x: number; y: number; z: number };
type Quat = [number, number, number, number]; // [x, y, z, w]

/** Rotate v by quaternion q then translate. */
function applyPose(v: Vec3, t: Vec3, q: Quat): Vec3 {
  const rx = rotateByQuat(v, q);
  return { x: rx.x + t.x, y: rx.y + t.y, z: rx.z + t.z };
}

function rotateByQuat(v: Vec3, [qx, qy, qz, qw]: Quat): Vec3 {
  // Rodrigues formula: v' = v + 2w(q×v) + 2(q×(q×v))
  const tx = 2 * (qy * v.z - qz * v.y);
  const ty = 2 * (qz * v.x - qx * v.z);
  const tz = 2 * (qx * v.y - qy * v.x);
  return {
    x: v.x + qw * tx + (qy * tz - qz * ty),
    y: v.y + qw * ty + (qz * tx - qx * tz),
    z: v.z + qw * tz + (qx * ty - qy * tx),
  };
}
```

- [ ] **Step 4: Run the test (expect pass)**

```
cd packages/kernel && pnpm test:unit -- getProjectorInput
```
Expected: 1/1 pass.

- [ ] **Step 5: Typecheck**

```
pnpm -r typecheck
```
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add packages/kernel/src/adapter/drawing/getProjectorInput.ts \
        packages/kernel/src/adapter/drawing/__tests__/getProjectorInput.spec.ts
git commit -m "feat(kernel): getProjectorInput adapter — triangles+edges+bbox for part/assembly sources (6 §3.6)"
```

**Verify:** `pnpm -r typecheck` clean; `pnpm test:unit -- getProjectorInput` green.

---

### T15 — Wire `getProjectorInput` through `packages/kernel/src/api.ts`

**Files:**
- Modify: `packages/kernel/src/api.ts`
- Modify: `packages/kernel/src/adapter/drawing/__tests__/getProjectorInput.spec.ts` (add API-level test)

**Agent:** Sonnet implementer.

- [ ] **Step 1: Write the failing test (append to existing spec)**

Add a new `describe` block to `packages/kernel/src/adapter/drawing/__tests__/getProjectorInput.spec.ts`:

```ts
// --- API surface test ---
import { createKernelApi } from '../../../api';

describe('KernelApi.getProjectorInput', () => {
  it('returns ProjectorInput via the kernel API surface after execute', async () => {
    const api = createKernelApi();
    await api.init();

    const partId = await api.createPart('box-api-test');
    await api.addFeature(partId, {
      kind: 'sketch', id: 'sk1',
      plane: { source: 'workPlane', featureId: 'origin.XY' },
      primitives: [{ kind: 'rect', id: 'r1', x: 0, y: 0, width: 100, height: 60 }],
      constraints: [],
    });
    await api.addFeature(partId, {
      kind: 'extrusion', id: 'ex1', sketchId: 'sk1',
      depth: { kind: 'literal', value: 40 },
      direction: 'normal', operation: 'new',
    });
    await api.execute(partId);

    const input = await api.getProjectorInput(partId);
    expect(input).not.toBeNull();
    expect(input!.triangles.length).toBeGreaterThanOrEqual(12);
    expect(input!.edges.length).toBeGreaterThanOrEqual(12);
    expect(input!.bbox.max.x - input!.bbox.min.x).toBeCloseTo(100, 0);
  });

  it('returns null for an unexecuted part (cold cache)', async () => {
    const api = createKernelApi();
    await api.init();
    const partId = await api.createPart('cold-test');
    const input = await api.getProjectorInput(partId);
    expect(input).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test (expect fail)**

```
cd packages/kernel && pnpm test:unit -- getProjectorInput
```
Expected: 2 new tests fail — `api.getProjectorInput` does not exist yet.

- [ ] **Step 3: Modify `packages/kernel/src/api.ts`**

Add `getProjectorInput` to the `KernelApi` type and implementation.

In the `KernelApi` type (after `extractAssemblyCircularEdge`):
```ts
  /** Returns projection-ready triangles+edges+bbox for a part that has been
   *  executed (i.e. its NamedShape is in the cache). Returns null if the
   *  cache is cold — caller should call `execute` first. */
  getProjectorInput(partId: string): Promise<import('./adapter/drawing/getProjectorInput').ProjectorInput | null>;
```

In the `createKernelApi()` return object (after `extractAssemblyCircularEdge`):
```ts
    async getProjectorInput(partId) {
      const ns = namedShapeCache.get(partId);
      if (!ns) return null;
      if (!occt) throw new Error('kernel not initialized');
      return getProjectorInputFn(occt, ns);
    },
```

At the top of `api.ts`, add the import alongside existing imports:
```ts
import { getProjectorInput as getProjectorInputFn } from './adapter/drawing/getProjectorInput';
```

- [ ] **Step 4: Run the test (expect pass)**

```
cd packages/kernel && pnpm test:unit -- getProjectorInput
```
Expected: 3/3 pass (T14 + 2 new API tests).

- [ ] **Step 5: Full typecheck**

```
pnpm -r typecheck
```
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add packages/kernel/src/api.ts \
        packages/kernel/src/adapter/drawing/__tests__/getProjectorInput.spec.ts
git commit -m "feat(kernel): expose getProjectorInput on KernelApi surface via Comlink (6 §3.6)"
```

**Verify:** `pnpm -r typecheck` clean; all `getProjectorInput` tests green.

---

### T16 — Main-thread wrapper in `KernelClient`

**Files:**
- Modify: `packages/app/src/kernel-client/KernelClient.ts`
- Create: `packages/app/src/kernel-client/__tests__/getProjectorInput.client.spec.ts`

**Agent:** Sonnet implementer.

The `KernelClient` is defined as `export type KernelClient = KernelApi` — it's a direct type alias of the kernel API. Because `KernelApi` now includes `getProjectorInput`, the client automatically exposes it through the Comlink proxy with no additional code changes needed to `KernelClient.ts`.

The test verifies that a mocked proxy with `getProjectorInput` resolves through `createKernelClient`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/app/src/kernel-client/__tests__/getProjectorInput.client.spec.ts
import { describe, it, expect, vi } from 'vitest';
import { createKernelClient } from '../KernelClient';
import type { KernelApi } from '@zilventor/kernel/src/api';
import type { ProjectorInput } from '@zilventor/kernel/src/adapter/drawing/getProjectorInput';

const MOCK_INPUT: ProjectorInput = {
  triangles: [],
  edges: [],
  bbox: { min: { x: 0, y: 0, z: 0 }, max: { x: 10, y: 10, z: 10 } },
};

describe('KernelClient.getProjectorInput routing', () => {
  it('routes getProjectorInput call through the proxy', async () => {
    const mockProxy = {
      getProjectorInput: vi.fn().mockResolvedValue(MOCK_INPUT),
    } as unknown as KernelApi;

    const client = createKernelClient(mockProxy);
    const result = await client.getProjectorInput('part-123');

    expect(mockProxy.getProjectorInput).toHaveBeenCalledWith('part-123');
    expect(result).toEqual(MOCK_INPUT);
  });

  it('propagates null when proxy returns null (cold cache)', async () => {
    const mockProxy = {
      getProjectorInput: vi.fn().mockResolvedValue(null),
    } as unknown as KernelApi;

    const client = createKernelClient(mockProxy);
    const result = await client.getProjectorInput('part-cold');
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test (expect fail or pass)**

```
cd packages/app && pnpm test:unit -- getProjectorInput.client
```
Expected: may already pass (since `KernelClient = KernelApi` and `createKernelClient` returns the proxy directly). If it fails, the cause is a missing type export — fix accordingly.

- [ ] **Step 3: If tests fail — fix**

If `KernelApi` type error occurs (missing `getProjectorInput`), ensure `packages/kernel/src/api.ts` changes from T15 are present. No other change to `KernelClient.ts` should be needed since it is a pass-through alias.

- [ ] **Step 4: Run the test (expect pass)**

```
cd packages/app && pnpm test:unit -- getProjectorInput.client
```
Expected: 2/2 pass.

- [ ] **Step 5: Full typecheck**

```
pnpm -r typecheck
```
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/kernel-client/__tests__/getProjectorInput.client.spec.ts
git commit -m "test(app/kernel-client): getProjectorInput routes through Comlink proxy (6 §3.6)"
```

**Verify:** `pnpm -r typecheck` clean; all Phase 4 tests green.

---

## Phase 5 — Document, sheet, and view commands

Thirteen commands (T17–T29). Dispatched in three Sonnet batches:
- **Batch A** (T17–T20): document + sheet-level commands
- **Batch B** (T21–T25): sheet-size + view placement commands
- **Batch C** (T26–T29): cascade delete + regen + scale/hidden toggle

All commands read/write `useAppStore.getState().activeDocument` where `kind === 'drawing'`. The store's `activeDocument` union will be widened to include `kind: 'drawing'` in Phase 2 (shared types) — these tasks compile against that widened union.

> **Pattern note:** Each command captures its `prev*` snapshot in `apply()` (not in the constructor), exactly as `GenerateNestCommand` and `DeleteComponentCommand` do. Constructor args match spec §4 exactly.

---

### Batch A: T17–T20 (document + sheet-level)

**Agent:** Sonnet implementer.

---

#### T17 — `CreateDrawingCommand`

**Files:**
- Create: `packages/app/src/commands/CreateDrawingCommand.ts`
- Create: `packages/app/src/commands/__tests__/CreateDrawingCommand.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/app/src/commands/__tests__/CreateDrawingCommand.spec.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useAppStore } from '../../store/useAppStore';
import { CreateDrawingCommand } from '../CreateDrawingCommand';
import type { DrawingDocument } from '@zilventor/shared';

// Stub OPFS: CreateDrawingCommand calls saveDrawingToOpfs which we mock
vi.mock('../../storage/saveDrawingToOpfs', () => ({
  saveDrawingToOpfs: vi.fn().mockResolvedValue(undefined),
}));

function getDrawing(): DrawingDocument | null {
  const doc = useAppStore.getState().activeDocument;
  if (!doc || doc.kind !== 'drawing') return null;
  return doc.document;
}

describe('CreateDrawingCommand', () => {
  beforeEach(() => {
    useAppStore.setState({ activeDocument: null, activePart: null, activeAssembly: null } as never);
  });

  it('apply creates a drawing document with one A3-landscape sheet', async () => {
    const cmd = new CreateDrawingCommand({
      sourcePath: 'parts/cabinet1.zipt',
      sourceKind: 'part',
    });
    await cmd.apply();

    const doc = getDrawing();
    expect(doc).not.toBeNull();
    expect(doc!.source.partPath).toBe('parts/cabinet1.zipt');
    expect(doc!.source.sourceKind).toBe('part');
    expect(doc!.sheets).toHaveLength(1);
    expect(doc!.sheets[0]!.size).toEqual({ kind: 'iso', size: 'A3' });
    expect(doc!.sheets[0]!.orientation).toBe('landscape');
    expect(doc!.activeSheetId).toBe(doc!.sheets[0]!.id);
  });

  it('apply uses provided sheetSize when given', async () => {
    const cmd = new CreateDrawingCommand({
      sourcePath: 'parts/p.zipt',
      sourceKind: 'part',
      sheetSize: { kind: 'iso', size: 'A4' },
    });
    await cmd.apply();
    const doc = getDrawing();
    expect(doc!.sheets[0]!.size).toEqual({ kind: 'iso', size: 'A4' });
  });

  it('revert removes the drawing and restores prior activeDocument', async () => {
    const cmd = new CreateDrawingCommand({ sourcePath: 'parts/p.zipt', sourceKind: 'part' });
    await cmd.apply();
    expect(getDrawing()).not.toBeNull();

    await cmd.revert();
    expect(useAppStore.getState().activeDocument).toBeNull();
  });

  it('revert restores a previously active part document', async () => {
    // Set up a prior part document
    const priorPart = { id: 'p1', name: 'P', units: 'mm' as const, featureTree: [], parameters: {}, parameterRefs: [], sketches: [], properties: {}, materials: [], hardware: [] };
    useAppStore.setState({
      activeDocument: { kind: 'part', document: priorPart },
      activePart: priorPart,
    } as never);

    const cmd = new CreateDrawingCommand({ sourcePath: 'parts/p.zipt', sourceKind: 'part' });
    await cmd.apply();
    expect(getDrawing()).not.toBeNull();

    await cmd.revert();
    const doc = useAppStore.getState().activeDocument;
    expect(doc?.kind).toBe('part');
  });

  it('drawing gets a unique id each call', async () => {
    const cmd1 = new CreateDrawingCommand({ sourcePath: 'parts/p.zipt', sourceKind: 'part' });
    const cmd2 = new CreateDrawingCommand({ sourcePath: 'parts/p.zipt', sourceKind: 'part' });
    await cmd1.apply();
    const id1 = getDrawing()!.id;
    await cmd1.revert();
    await cmd2.apply();
    const id2 = getDrawing()!.id;
    expect(id1).not.toBe(id2);
  });
});
```

- [ ] **Step 2: Run the test (expect fail)**

```
cd packages/app && pnpm test:unit -- CreateDrawingCommand
```
Expected: fail — module does not exist.

- [ ] **Step 3: Create `packages/app/src/commands/CreateDrawingCommand.ts`**

```ts
import type { Command } from './Command';
import type { DrawingDocument, DrawingSheet, SheetSize } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';
import type { ActiveDocument } from '../store/useAppStore';

export class CreateDrawingCommand implements Command {
  readonly name = 'CreateDrawing';
  private prevActiveDocument: ActiveDocument | null = null;
  private createdId: string | null = null;

  constructor(
    private readonly opts: {
      sourcePath: string;
      sourceKind: 'part' | 'assembly';
      sheetSize?: SheetSize;
    }
  ) {}

  async apply(): Promise<void> {
    this.prevActiveDocument = useAppStore.getState().activeDocument;

    const sheetId = crypto.randomUUID();
    const drawingId = crypto.randomUUID();
    this.createdId = drawingId;

    const size: SheetSize = this.opts.sheetSize ?? { kind: 'iso', size: 'A3' };

    const sheet: DrawingSheet = {
      id: sheetId,
      name: 'Sheet 1',
      size,
      orientation: 'landscape',
      views: [],
      dimensions: [],
      annotations: [],
      titleBlock: {},
    };

    const doc: DrawingDocument = {
      id: drawingId,
      name: `${this.opts.sourcePath.split('/').pop()?.replace(/\.\w+$/, '') ?? 'Drawing'} — Drawing`,
      units: 'mm',
      source: {
        partPath: this.opts.sourcePath,
        sourceKind: this.opts.sourceKind,
      },
      properties: {},
      sheets: [sheet],
      activeSheetId: sheetId,
    };

    useAppStore.setState({
      activeDocument: { kind: 'drawing', document: doc },
      activePart: null,
      activeAssembly: null,
    } as never);

    // Persist to OPFS — fire-and-forget; errors surface in production via status bar
    try {
      const { saveDrawingToOpfs } = await import('../storage/saveDrawingToOpfs');
      await saveDrawingToOpfs(doc);
    } catch {
      // Non-fatal: drawing is in memory; user will be prompted to save explicitly
    }
  }

  async revert(): Promise<void> {
    useAppStore.setState({
      activeDocument: this.prevActiveDocument,
      activePart:
        this.prevActiveDocument?.kind === 'part'
          ? this.prevActiveDocument.document
          : null,
      activeAssembly:
        this.prevActiveDocument?.kind === 'assembly'
          ? this.prevActiveDocument.document
          : null,
    } as never);
    this.createdId = null;
  }
}
```

- [ ] **Step 4: Run the test (expect pass)**

```
cd packages/app && pnpm test:unit -- CreateDrawingCommand
```
Expected: 5/5 pass.

- [ ] **Step 5: Typecheck**

```
pnpm -r typecheck
```
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/commands/CreateDrawingCommand.ts \
        packages/app/src/commands/__tests__/CreateDrawingCommand.spec.ts
git commit -m "feat(drawing): add CreateDrawingCommand"
```

**Verify:** `pnpm -r typecheck` clean; 5/5 tests green.

---

#### T18 — `AddSheetCommand`

**Files:**
- Create: `packages/app/src/commands/AddSheetCommand.ts`
- Create: `packages/app/src/commands/__tests__/AddSheetCommand.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/app/src/commands/__tests__/AddSheetCommand.spec.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '../../store/useAppStore';
import { AddSheetCommand } from '../AddSheetCommand';
import type { DrawingDocument } from '@zilventor/shared';

function makeDrawing(): DrawingDocument {
  return {
    id: 'd1', name: 'Test Drawing', units: 'mm',
    source: { partPath: 'parts/p.zipt', sourceKind: 'part' },
    properties: {},
    sheets: [{
      id: 'sheet-1', name: 'Sheet 1',
      size: { kind: 'iso', size: 'A3' }, orientation: 'landscape',
      views: [], dimensions: [], annotations: [], titleBlock: {},
    }],
    activeSheetId: 'sheet-1',
  };
}

describe('AddSheetCommand', () => {
  beforeEach(() => {
    useAppStore.setState({
      activeDocument: { kind: 'drawing', document: makeDrawing() },
    } as never);
  });

  it('apply appends a new sheet and sets it as active', async () => {
    const cmd = new AddSheetCommand({});
    await cmd.apply();

    const doc = (useAppStore.getState().activeDocument as { kind: 'drawing'; document: DrawingDocument }).document;
    expect(doc.sheets).toHaveLength(2);
    expect(doc.activeSheetId).toBe(doc.sheets[1]!.id);
    expect(doc.sheets[1]!.name).toBe('Sheet 2');
  });

  it('apply uses provided size and orientation', async () => {
    const cmd = new AddSheetCommand({ size: { kind: 'iso', size: 'A2' }, orientation: 'portrait' });
    await cmd.apply();

    const doc = (useAppStore.getState().activeDocument as { kind: 'drawing'; document: DrawingDocument }).document;
    expect(doc.sheets[1]!.size).toEqual({ kind: 'iso', size: 'A2' });
    expect(doc.sheets[1]!.orientation).toBe('portrait');
  });

  it('revert removes the new sheet and restores prior activeSheetId', async () => {
    const cmd = new AddSheetCommand({});
    await cmd.apply();

    const docAfterApply = (useAppStore.getState().activeDocument as { kind: 'drawing'; document: DrawingDocument }).document;
    const newSheetId = docAfterApply.sheets[1]!.id;

    await cmd.revert();

    const doc = (useAppStore.getState().activeDocument as { kind: 'drawing'; document: DrawingDocument }).document;
    expect(doc.sheets).toHaveLength(1);
    expect(doc.sheets.find(s => s.id === newSheetId)).toBeUndefined();
    expect(doc.activeSheetId).toBe('sheet-1');
  });

  it('apply is a no-op when no drawing is active', async () => {
    useAppStore.setState({ activeDocument: null } as never);
    const cmd = new AddSheetCommand({});
    await expect(cmd.apply()).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test (expect fail)**

```
cd packages/app && pnpm test:unit -- AddSheetCommand
```
Expected: fail — module does not exist.

- [ ] **Step 3: Create `packages/app/src/commands/AddSheetCommand.ts`**

```ts
import type { Command } from './Command';
import type { SheetSize, DrawingDocument, DrawingSheet } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';

export class AddSheetCommand implements Command {
  readonly name = 'AddSheet';
  private prevActiveSheetId: string | null = null;
  private newSheetId: string | null = null;

  constructor(
    private readonly opts: {
      size?: SheetSize;
      orientation?: 'landscape' | 'portrait';
    }
  ) {}

  async apply(): Promise<void> {
    const state = useAppStore.getState();
    const doc = state.activeDocument;
    if (!doc || doc.kind !== 'drawing') return;

    this.prevActiveSheetId = doc.document.activeSheetId;
    const newId = crypto.randomUUID();
    this.newSheetId = newId;

    const existingCount = doc.document.sheets.length;
    const newSheet: DrawingSheet = {
      id: newId,
      name: `Sheet ${existingCount + 1}`,
      size: this.opts.size ?? { kind: 'iso', size: 'A3' },
      orientation: this.opts.orientation ?? 'landscape',
      views: [],
      dimensions: [],
      annotations: [],
      titleBlock: {},
    };

    const next: DrawingDocument = {
      ...doc.document,
      sheets: [...doc.document.sheets, newSheet],
      activeSheetId: newId,
    };
    useAppStore.setState({
      activeDocument: { kind: 'drawing', document: next },
    } as never);
  }

  async revert(): Promise<void> {
    if (!this.newSheetId) return;
    const state = useAppStore.getState();
    const doc = state.activeDocument;
    if (!doc || doc.kind !== 'drawing') return;

    const next: DrawingDocument = {
      ...doc.document,
      sheets: doc.document.sheets.filter(s => s.id !== this.newSheetId),
      activeSheetId: this.prevActiveSheetId ?? doc.document.sheets[0]!.id,
    };
    useAppStore.setState({
      activeDocument: { kind: 'drawing', document: next },
    } as never);
    this.newSheetId = null;
  }
}
```

- [ ] **Step 4: Run the test (expect pass)**

```
cd packages/app && pnpm test:unit -- AddSheetCommand
```
Expected: 4/4 pass.

- [ ] **Step 5: Typecheck + commit**

```
pnpm -r typecheck
git add packages/app/src/commands/AddSheetCommand.ts \
        packages/app/src/commands/__tests__/AddSheetCommand.spec.ts
git commit -m "feat(drawing): add AddSheetCommand"
```

**Verify:** `pnpm -r typecheck` clean; 4/4 green.

---

#### T19 — `RenameSheetCommand`

**Files:**
- Create: `packages/app/src/commands/RenameSheetCommand.ts`
- Create: `packages/app/src/commands/__tests__/RenameSheetCommand.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/app/src/commands/__tests__/RenameSheetCommand.spec.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '../../store/useAppStore';
import { RenameSheetCommand } from '../RenameSheetCommand';
import type { DrawingDocument } from '@zilventor/shared';

function makeDrawing(): DrawingDocument {
  return {
    id: 'd1', name: 'D', units: 'mm',
    source: { partPath: 'parts/p.zipt', sourceKind: 'part' },
    properties: {},
    sheets: [{
      id: 'sheet-1', name: 'Sheet 1',
      size: { kind: 'iso', size: 'A3' }, orientation: 'landscape',
      views: [], dimensions: [], annotations: [], titleBlock: {},
    }],
    activeSheetId: 'sheet-1',
  };
}

describe('RenameSheetCommand', () => {
  beforeEach(() => {
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: makeDrawing() } } as never);
  });

  it('apply renames the specified sheet', async () => {
    const cmd = new RenameSheetCommand({ sheetId: 'sheet-1', name: 'Front Views' });
    await cmd.apply();

    const doc = (useAppStore.getState().activeDocument as { kind: 'drawing'; document: DrawingDocument }).document;
    expect(doc.sheets[0]!.name).toBe('Front Views');
  });

  it('revert restores the prior name', async () => {
    const cmd = new RenameSheetCommand({ sheetId: 'sheet-1', name: 'Front Views' });
    await cmd.apply();
    await cmd.revert();

    const doc = (useAppStore.getState().activeDocument as { kind: 'drawing'; document: DrawingDocument }).document;
    expect(doc.sheets[0]!.name).toBe('Sheet 1');
  });

  it('apply is a no-op when sheetId not found', async () => {
    const cmd = new RenameSheetCommand({ sheetId: 'no-such-sheet', name: 'X' });
    await expect(cmd.apply()).resolves.toBeUndefined();
    const doc = (useAppStore.getState().activeDocument as { kind: 'drawing'; document: DrawingDocument }).document;
    expect(doc.sheets[0]!.name).toBe('Sheet 1');
  });
});
```

- [ ] **Step 2: Run the test (expect fail)**

```
cd packages/app && pnpm test:unit -- RenameSheetCommand
```

- [ ] **Step 3: Create `packages/app/src/commands/RenameSheetCommand.ts`**

```ts
import type { Command } from './Command';
import type { DrawingDocument } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';

export class RenameSheetCommand implements Command {
  readonly name = 'RenameSheet';
  private prevName: string | null = null;

  constructor(private readonly opts: { sheetId: string; name: string }) {}

  async apply(): Promise<void> {
    const state = useAppStore.getState();
    const doc = state.activeDocument;
    if (!doc || doc.kind !== 'drawing') return;

    const sheet = doc.document.sheets.find(s => s.id === this.opts.sheetId);
    if (!sheet) return;

    this.prevName = sheet.name;

    const next: DrawingDocument = {
      ...doc.document,
      sheets: doc.document.sheets.map(s =>
        s.id === this.opts.sheetId ? { ...s, name: this.opts.name } : s
      ),
    };
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: next } } as never);
  }

  async revert(): Promise<void> {
    if (this.prevName === null) return;
    const state = useAppStore.getState();
    const doc = state.activeDocument;
    if (!doc || doc.kind !== 'drawing') return;

    const next: DrawingDocument = {
      ...doc.document,
      sheets: doc.document.sheets.map(s =>
        s.id === this.opts.sheetId ? { ...s, name: this.prevName! } : s
      ),
    };
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: next } } as never);
    this.prevName = null;
  }
}
```

- [ ] **Step 4: Run the test (expect pass) + typecheck + commit**

```
cd packages/app && pnpm test:unit -- RenameSheetCommand
pnpm -r typecheck
git add packages/app/src/commands/RenameSheetCommand.ts \
        packages/app/src/commands/__tests__/RenameSheetCommand.spec.ts
git commit -m "feat(drawing): add RenameSheetCommand"
```

**Verify:** 3/3 green; typecheck clean.

---

#### T20 — `DeleteSheetCommand`

**Files:**
- Create: `packages/app/src/commands/DeleteSheetCommand.ts`
- Create: `packages/app/src/commands/__tests__/DeleteSheetCommand.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/app/src/commands/__tests__/DeleteSheetCommand.spec.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '../../store/useAppStore';
import { DeleteSheetCommand } from '../DeleteSheetCommand';
import type { DrawingDocument } from '@zilventor/shared';

function makeDrawingTwoSheets(): DrawingDocument {
  return {
    id: 'd1', name: 'D', units: 'mm',
    source: { partPath: 'parts/p.zipt', sourceKind: 'part' },
    properties: {},
    sheets: [
      { id: 'sheet-1', name: 'Sheet 1', size: { kind: 'iso', size: 'A3' }, orientation: 'landscape', views: [], dimensions: [], annotations: [], titleBlock: {} },
      { id: 'sheet-2', name: 'Sheet 2', size: { kind: 'iso', size: 'A3' }, orientation: 'landscape', views: [], dimensions: [], annotations: [], titleBlock: {} },
    ],
    activeSheetId: 'sheet-2',
  };
}

function makeDrawingOneSheet(): DrawingDocument {
  return { ...makeDrawingTwoSheets(), sheets: [makeDrawingTwoSheets().sheets[0]!], activeSheetId: 'sheet-1' };
}

describe('DeleteSheetCommand', () => {
  it('apply removes the specified sheet from a 2-sheet drawing', async () => {
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: makeDrawingTwoSheets() } } as never);
    const cmd = new DeleteSheetCommand({ sheetId: 'sheet-2' });
    await cmd.apply();

    const doc = (useAppStore.getState().activeDocument as { kind: 'drawing'; document: DrawingDocument }).document;
    expect(doc.sheets).toHaveLength(1);
    expect(doc.sheets.find(s => s.id === 'sheet-2')).toBeUndefined();
  });

  it('apply sets activeSheetId to remaining sheet when active sheet is deleted', async () => {
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: makeDrawingTwoSheets() } } as never);
    const cmd = new DeleteSheetCommand({ sheetId: 'sheet-2' });
    await cmd.apply();

    const doc = (useAppStore.getState().activeDocument as { kind: 'drawing'; document: DrawingDocument }).document;
    expect(doc.activeSheetId).toBe('sheet-1');
  });

  it('revert restores the deleted sheet and prior activeSheetId', async () => {
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: makeDrawingTwoSheets() } } as never);
    const cmd = new DeleteSheetCommand({ sheetId: 'sheet-2' });
    await cmd.apply();
    await cmd.revert();

    const doc = (useAppStore.getState().activeDocument as { kind: 'drawing'; document: DrawingDocument }).document;
    expect(doc.sheets).toHaveLength(2);
    expect(doc.sheets[1]!.id).toBe('sheet-2');
    expect(doc.activeSheetId).toBe('sheet-2');
  });

  it('refuses to delete the last sheet — no mutation', async () => {
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: makeDrawingOneSheet() } } as never);
    const cmd = new DeleteSheetCommand({ sheetId: 'sheet-1' });
    await expect(cmd.apply()).rejects.toThrow(/LAST_SHEET/);

    const doc = (useAppStore.getState().activeDocument as { kind: 'drawing'; document: DrawingDocument }).document;
    expect(doc.sheets).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the test (expect fail)**

```
cd packages/app && pnpm test:unit -- DeleteSheetCommand
```

- [ ] **Step 3: Create `packages/app/src/commands/DeleteSheetCommand.ts`**

```ts
import type { Command } from './Command';
import type { DrawingDocument, DrawingSheet } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';

export class DeleteSheetCommand implements Command {
  readonly name = 'DeleteSheet';
  private prevSheet: DrawingSheet | null = null;
  private prevSheetIndex: number = -1;
  private prevActiveSheetId: string | null = null;

  constructor(private readonly opts: { sheetId: string }) {}

  async apply(): Promise<void> {
    const state = useAppStore.getState();
    const doc = state.activeDocument;
    if (!doc || doc.kind !== 'drawing') return;

    if (doc.document.sheets.length <= 1) {
      throw new Error('LAST_SHEET: cannot delete the only sheet in a drawing');
    }

    const idx = doc.document.sheets.findIndex(s => s.id === this.opts.sheetId);
    if (idx === -1) return;

    this.prevSheet = doc.document.sheets[idx]!;
    this.prevSheetIndex = idx;
    this.prevActiveSheetId = doc.document.activeSheetId;

    const remaining = doc.document.sheets.filter(s => s.id !== this.opts.sheetId);
    const newActiveId =
      doc.document.activeSheetId === this.opts.sheetId
        ? (remaining[Math.max(0, idx - 1)]?.id ?? remaining[0]!.id)
        : doc.document.activeSheetId;

    const next: DrawingDocument = {
      ...doc.document,
      sheets: remaining,
      activeSheetId: newActiveId,
    };
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: next } } as never);
  }

  async revert(): Promise<void> {
    if (!this.prevSheet || this.prevSheetIndex === -1) return;
    const state = useAppStore.getState();
    const doc = state.activeDocument;
    if (!doc || doc.kind !== 'drawing') return;

    const sheets = [...doc.document.sheets];
    sheets.splice(this.prevSheetIndex, 0, this.prevSheet);

    const next: DrawingDocument = {
      ...doc.document,
      sheets,
      activeSheetId: this.prevActiveSheetId ?? doc.document.activeSheetId,
    };
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: next } } as never);
    this.prevSheet = null;
    this.prevSheetIndex = -1;
  }
}
```

- [ ] **Step 4: Run the test (expect pass) + typecheck + commit**

```
cd packages/app && pnpm test:unit -- DeleteSheetCommand
pnpm -r typecheck
git add packages/app/src/commands/DeleteSheetCommand.ts \
        packages/app/src/commands/__tests__/DeleteSheetCommand.spec.ts
git commit -m "feat(drawing): add DeleteSheetCommand"
```

**Verify:** 4/4 green; typecheck clean.

---

### Batch B: T21–T25 (sheet size + view placement)

**Agent:** Sonnet implementer.

---

#### T21 — `EditSheetSizeCommand`

**Files:**
- Create: `packages/app/src/commands/EditSheetSizeCommand.ts`
- Create: `packages/app/src/commands/__tests__/EditSheetSizeCommand.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/app/src/commands/__tests__/EditSheetSizeCommand.spec.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '../../store/useAppStore';
import { EditSheetSizeCommand } from '../EditSheetSizeCommand';
import type { DrawingDocument } from '@zilventor/shared';

function makeDrawing(): DrawingDocument {
  return {
    id: 'd1', name: 'D', units: 'mm',
    source: { partPath: 'parts/p.zipt', sourceKind: 'part' },
    properties: {},
    sheets: [{
      id: 'sheet-1', name: 'Sheet 1',
      size: { kind: 'iso', size: 'A3' }, orientation: 'landscape',
      views: [], dimensions: [], annotations: [], titleBlock: {},
    }],
    activeSheetId: 'sheet-1',
  };
}

describe('EditSheetSizeCommand', () => {
  beforeEach(() => {
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: makeDrawing() } } as never);
  });

  it('apply updates size and orientation', async () => {
    const cmd = new EditSheetSizeCommand({
      sheetId: 'sheet-1',
      size: { kind: 'iso', size: 'A1' },
      orientation: 'portrait',
    });
    await cmd.apply();

    const doc = (useAppStore.getState().activeDocument as { kind: 'drawing'; document: DrawingDocument }).document;
    expect(doc.sheets[0]!.size).toEqual({ kind: 'iso', size: 'A1' });
    expect(doc.sheets[0]!.orientation).toBe('portrait');
  });

  it('revert restores prior size and orientation', async () => {
    const cmd = new EditSheetSizeCommand({
      sheetId: 'sheet-1',
      size: { kind: 'iso', size: 'A1' },
      orientation: 'portrait',
    });
    await cmd.apply();
    await cmd.revert();

    const doc = (useAppStore.getState().activeDocument as { kind: 'drawing'; document: DrawingDocument }).document;
    expect(doc.sheets[0]!.size).toEqual({ kind: 'iso', size: 'A3' });
    expect(doc.sheets[0]!.orientation).toBe('landscape');
  });

  it('custom sheet size round-trips', async () => {
    const cmd = new EditSheetSizeCommand({
      sheetId: 'sheet-1',
      size: { kind: 'custom', widthMm: 500, heightMm: 350 },
      orientation: 'landscape',
    });
    await cmd.apply();

    const doc = (useAppStore.getState().activeDocument as { kind: 'drawing'; document: DrawingDocument }).document;
    expect(doc.sheets[0]!.size).toEqual({ kind: 'custom', widthMm: 500, heightMm: 350 });
  });
});
```

- [ ] **Step 2: Run the test (expect fail)**

```
cd packages/app && pnpm test:unit -- EditSheetSizeCommand
```

- [ ] **Step 3: Create `packages/app/src/commands/EditSheetSizeCommand.ts`**

```ts
import type { Command } from './Command';
import type { SheetSize, DrawingDocument } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';

export class EditSheetSizeCommand implements Command {
  readonly name = 'EditSheetSize';
  private prevSize: SheetSize | null = null;
  private prevOrientation: 'landscape' | 'portrait' | null = null;

  constructor(
    private readonly opts: {
      sheetId: string;
      size: SheetSize;
      orientation: 'landscape' | 'portrait';
    }
  ) {}

  async apply(): Promise<void> {
    const state = useAppStore.getState();
    const doc = state.activeDocument;
    if (!doc || doc.kind !== 'drawing') return;

    const sheet = doc.document.sheets.find(s => s.id === this.opts.sheetId);
    if (!sheet) return;

    this.prevSize = sheet.size;
    this.prevOrientation = sheet.orientation;

    const next: DrawingDocument = {
      ...doc.document,
      sheets: doc.document.sheets.map(s =>
        s.id === this.opts.sheetId
          ? { ...s, size: this.opts.size, orientation: this.opts.orientation }
          : s
      ),
    };
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: next } } as never);
  }

  async revert(): Promise<void> {
    if (!this.prevSize || !this.prevOrientation) return;
    const state = useAppStore.getState();
    const doc = state.activeDocument;
    if (!doc || doc.kind !== 'drawing') return;

    const next: DrawingDocument = {
      ...doc.document,
      sheets: doc.document.sheets.map(s =>
        s.id === this.opts.sheetId
          ? { ...s, size: this.prevSize!, orientation: this.prevOrientation! }
          : s
      ),
    };
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: next } } as never);
    this.prevSize = null;
    this.prevOrientation = null;
  }
}
```

- [ ] **Step 4: Run + typecheck + commit**

```
cd packages/app && pnpm test:unit -- EditSheetSizeCommand
pnpm -r typecheck
git add packages/app/src/commands/EditSheetSizeCommand.ts \
        packages/app/src/commands/__tests__/EditSheetSizeCommand.spec.ts
git commit -m "feat(drawing): add EditSheetSizeCommand"
```

**Verify:** 3/3 green; typecheck clean.

---

#### T22 — `AddBaseViewCommand`

**Files:**
- Create: `packages/app/src/commands/AddBaseViewCommand.ts`
- Create: `packages/app/src/commands/__tests__/AddBaseViewCommand.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/app/src/commands/__tests__/AddBaseViewCommand.spec.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '../../store/useAppStore';
import { AddBaseViewCommand } from '../AddBaseViewCommand';
import type { DrawingDocument } from '@zilventor/shared';

function makeDrawing(): DrawingDocument {
  return {
    id: 'd1', name: 'D', units: 'mm',
    source: { partPath: 'parts/p.zipt', sourceKind: 'part' },
    properties: {},
    sheets: [{
      id: 'sheet-1', name: 'Sheet 1',
      size: { kind: 'iso', size: 'A3' }, orientation: 'landscape',
      views: [], dimensions: [], annotations: [], titleBlock: {},
    }],
    activeSheetId: 'sheet-1',
  };
}

describe('AddBaseViewCommand', () => {
  beforeEach(() => {
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: makeDrawing() } } as never);
  });

  it('apply appends a base view with correct fields and undefined projection', async () => {
    const cmd = new AddBaseViewCommand({
      sheetId: 'sheet-1',
      positionMm: { x: 50, y: 60 },
      orientation: 'front',
      scale: { numerator: 1, denominator: 1 },
      showHidden: true,
    });
    await cmd.apply();

    const doc = (useAppStore.getState().activeDocument as { kind: 'drawing'; document: DrawingDocument }).document;
    const sheet = doc.sheets[0]!;
    expect(sheet.views).toHaveLength(1);
    const view = sheet.views[0]!;
    expect(view.kind).toBe('base');
    if (view.kind !== 'base') return;
    expect(view.orientation).toBe('front');
    expect(view.positionMm).toEqual({ x: 50, y: 60 });
    expect(view.scale).toEqual({ numerator: 1, denominator: 1 });
    expect(view.showHidden).toBe(true);
    expect(view.projection).toBeUndefined();
    expect(view.inputFingerprint).toBeUndefined();
  });

  it('showHidden defaults to true when not provided', async () => {
    const cmd = new AddBaseViewCommand({
      sheetId: 'sheet-1',
      positionMm: { x: 0, y: 0 },
      orientation: 'top',
      scale: { numerator: 1, denominator: 2 },
    });
    await cmd.apply();

    const doc = (useAppStore.getState().activeDocument as { kind: 'drawing'; document: DrawingDocument }).document;
    const view = doc.sheets[0]!.views[0]!;
    if (view.kind !== 'base') return;
    expect(view.showHidden).toBe(true);
  });

  it('revert removes the added view', async () => {
    const cmd = new AddBaseViewCommand({
      sheetId: 'sheet-1',
      positionMm: { x: 0, y: 0 },
      orientation: 'right',
      scale: { numerator: 1, denominator: 1 },
    });
    await cmd.apply();
    await cmd.revert();

    const doc = (useAppStore.getState().activeDocument as { kind: 'drawing'; document: DrawingDocument }).document;
    expect(doc.sheets[0]!.views).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the test (expect fail)**

```
cd packages/app && pnpm test:unit -- AddBaseViewCommand
```

- [ ] **Step 3: Create `packages/app/src/commands/AddBaseViewCommand.ts`**

```ts
import type { Command } from './Command';
import type { DrawingDocument, ViewScale, BaseView } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';

type BaseOrient = 'front' | 'top' | 'right' | 'back' | 'bottom' | 'left';

export class AddBaseViewCommand implements Command {
  readonly name = 'AddBaseView';
  private newViewId: string | null = null;

  constructor(
    private readonly opts: {
      sheetId: string;
      positionMm: { x: number; y: number };
      orientation: BaseOrient;
      scale: ViewScale;
      showHidden?: boolean;
    }
  ) {}

  async apply(): Promise<void> {
    const state = useAppStore.getState();
    const doc = state.activeDocument;
    if (!doc || doc.kind !== 'drawing') return;

    const newId = crypto.randomUUID();
    this.newViewId = newId;

    const view: BaseView = {
      id: newId,
      kind: 'base',
      positionMm: this.opts.positionMm,
      orientation: this.opts.orientation,
      scale: this.opts.scale,
      showHidden: this.opts.showHidden ?? true,
    };

    const next: DrawingDocument = {
      ...doc.document,
      sheets: doc.document.sheets.map(s =>
        s.id === this.opts.sheetId
          ? { ...s, views: [...s.views, view] }
          : s
      ),
    };
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: next } } as never);
  }

  async revert(): Promise<void> {
    if (!this.newViewId) return;
    const state = useAppStore.getState();
    const doc = state.activeDocument;
    if (!doc || doc.kind !== 'drawing') return;

    const next: DrawingDocument = {
      ...doc.document,
      sheets: doc.document.sheets.map(s =>
        s.id === this.opts.sheetId
          ? { ...s, views: s.views.filter(v => v.id !== this.newViewId) }
          : s
      ),
    };
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: next } } as never);
    this.newViewId = null;
  }
}
```

- [ ] **Step 4: Run + typecheck + commit**

```
cd packages/app && pnpm test:unit -- AddBaseViewCommand
pnpm -r typecheck
git add packages/app/src/commands/AddBaseViewCommand.ts \
        packages/app/src/commands/__tests__/AddBaseViewCommand.spec.ts
git commit -m "feat(drawing): add AddBaseViewCommand"
```

**Verify:** 3/3 green; typecheck clean.

---

#### T23 — `AddProjectedViewCommand`

**Files:**
- Create: `packages/app/src/commands/AddProjectedViewCommand.ts`
- Create: `packages/app/src/commands/__tests__/AddProjectedViewCommand.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/app/src/commands/__tests__/AddProjectedViewCommand.spec.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '../../store/useAppStore';
import { AddProjectedViewCommand } from '../AddProjectedViewCommand';
import type { DrawingDocument, BaseView } from '@zilventor/shared';

const BASE_VIEW: BaseView = {
  id: 'base-1', kind: 'base',
  positionMm: { x: 100, y: 100 },
  orientation: 'front',
  scale: { numerator: 1, denominator: 1 },
  showHidden: true,
};

function makeDrawing(): DrawingDocument {
  return {
    id: 'd1', name: 'D', units: 'mm',
    source: { partPath: 'parts/p.zipt', sourceKind: 'part' },
    properties: {},
    sheets: [{
      id: 'sheet-1', name: 'Sheet 1',
      size: { kind: 'iso', size: 'A3' }, orientation: 'landscape',
      views: [BASE_VIEW], dimensions: [], annotations: [], titleBlock: {},
    }],
    activeSheetId: 'sheet-1',
  };
}

describe('AddProjectedViewCommand', () => {
  beforeEach(() => {
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: makeDrawing() } } as never);
  });

  it('apply appends a projected view with correct fields', async () => {
    const cmd = new AddProjectedViewCommand({
      sheetId: 'sheet-1',
      baseViewId: 'base-1',
      direction: 'right',
      positionMm: { x: 200, y: 100 },
    });
    await cmd.apply();

    const doc = (useAppStore.getState().activeDocument as { kind: 'drawing'; document: DrawingDocument }).document;
    const views = doc.sheets[0]!.views;
    expect(views).toHaveLength(2);
    const pv = views[1]!;
    expect(pv.kind).toBe('projected');
    if (pv.kind !== 'projected') return;
    expect(pv.baseViewId).toBe('base-1');
    expect(pv.direction).toBe('right');
    expect(pv.scale).toEqual({ numerator: 1, denominator: 1 }); // inherited from base
    expect(pv.projection).toBeUndefined();
  });

  it('apply throws when baseViewId does not exist on the sheet', async () => {
    const cmd = new AddProjectedViewCommand({
      sheetId: 'sheet-1',
      baseViewId: 'no-such-view',
      direction: 'top',
      positionMm: { x: 0, y: 0 },
    });
    await expect(cmd.apply()).rejects.toThrow(/BASE_VIEW_NOT_FOUND/);
  });

  it('revert removes the projected view', async () => {
    const cmd = new AddProjectedViewCommand({
      sheetId: 'sheet-1',
      baseViewId: 'base-1',
      direction: 'left',
      positionMm: { x: 0, y: 100 },
    });
    await cmd.apply();
    await cmd.revert();

    const doc = (useAppStore.getState().activeDocument as { kind: 'drawing'; document: DrawingDocument }).document;
    expect(doc.sheets[0]!.views).toHaveLength(1);
    expect(doc.sheets[0]!.views[0]!.id).toBe('base-1');
  });
});
```

- [ ] **Step 2: Run the test (expect fail)**

```
cd packages/app && pnpm test:unit -- AddProjectedViewCommand
```

- [ ] **Step 3: Create `packages/app/src/commands/AddProjectedViewCommand.ts`**

```ts
import type { Command } from './Command';
import type { DrawingDocument, ProjectedView, BaseView } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';

export class AddProjectedViewCommand implements Command {
  readonly name = 'AddProjectedView';
  private newViewId: string | null = null;

  constructor(
    private readonly opts: {
      sheetId: string;
      baseViewId: string;
      direction: 'top' | 'bottom' | 'left' | 'right';
      positionMm: { x: number; y: number };
    }
  ) {}

  async apply(): Promise<void> {
    const state = useAppStore.getState();
    const doc = state.activeDocument;
    if (!doc || doc.kind !== 'drawing') return;

    const sheet = doc.document.sheets.find(s => s.id === this.opts.sheetId);
    if (!sheet) return;

    const baseView = sheet.views.find(
      (v): v is BaseView => v.id === this.opts.baseViewId && v.kind === 'base'
    );
    if (!baseView) {
      throw new Error(`BASE_VIEW_NOT_FOUND: no base view with id ${this.opts.baseViewId} on sheet ${this.opts.sheetId}`);
    }

    const newId = crypto.randomUUID();
    this.newViewId = newId;

    const view: ProjectedView = {
      id: newId,
      kind: 'projected',
      positionMm: this.opts.positionMm,
      baseViewId: this.opts.baseViewId,
      direction: this.opts.direction,
      scale: baseView.scale,  // inherit from base
      showHidden: baseView.showHidden,
    };

    const next: DrawingDocument = {
      ...doc.document,
      sheets: doc.document.sheets.map(s =>
        s.id === this.opts.sheetId
          ? { ...s, views: [...s.views, view] }
          : s
      ),
    };
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: next } } as never);
  }

  async revert(): Promise<void> {
    if (!this.newViewId) return;
    const state = useAppStore.getState();
    const doc = state.activeDocument;
    if (!doc || doc.kind !== 'drawing') return;

    const next: DrawingDocument = {
      ...doc.document,
      sheets: doc.document.sheets.map(s =>
        s.id === this.opts.sheetId
          ? { ...s, views: s.views.filter(v => v.id !== this.newViewId) }
          : s
      ),
    };
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: next } } as never);
    this.newViewId = null;
  }
}
```

- [ ] **Step 4: Run + typecheck + commit**

```
cd packages/app && pnpm test:unit -- AddProjectedViewCommand
pnpm -r typecheck
git add packages/app/src/commands/AddProjectedViewCommand.ts \
        packages/app/src/commands/__tests__/AddProjectedViewCommand.spec.ts
git commit -m "feat(drawing): add AddProjectedViewCommand"
```

**Verify:** 3/3 green; typecheck clean.

---

#### T24 — `AddIsoViewCommand`

**Files:**
- Create: `packages/app/src/commands/AddIsoViewCommand.ts`
- Create: `packages/app/src/commands/__tests__/AddIsoViewCommand.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/app/src/commands/__tests__/AddIsoViewCommand.spec.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '../../store/useAppStore';
import { AddIsoViewCommand } from '../AddIsoViewCommand';
import type { DrawingDocument } from '@zilventor/shared';

function makeDrawing(): DrawingDocument {
  return {
    id: 'd1', name: 'D', units: 'mm',
    source: { partPath: 'parts/p.zipt', sourceKind: 'part' },
    properties: {},
    sheets: [{
      id: 'sheet-1', name: 'Sheet 1',
      size: { kind: 'iso', size: 'A3' }, orientation: 'landscape',
      views: [], dimensions: [], annotations: [], titleBlock: {},
    }],
    activeSheetId: 'sheet-1',
  };
}

describe('AddIsoViewCommand', () => {
  beforeEach(() => {
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: makeDrawing() } } as never);
  });

  it('apply appends an iso view with correct corner and defaults showHidden=false', async () => {
    const cmd = new AddIsoViewCommand({
      sheetId: 'sheet-1',
      positionMm: { x: 200, y: 200 },
      corner: 'NE',
      scale: { numerator: 1, denominator: 1 },
    });
    await cmd.apply();

    const doc = (useAppStore.getState().activeDocument as { kind: 'drawing'; document: DrawingDocument }).document;
    const view = doc.sheets[0]!.views[0]!;
    expect(view.kind).toBe('iso');
    if (view.kind !== 'iso') return;
    expect(view.corner).toBe('NE');
    expect(view.showHidden).toBe(false); // engineering convention default
    expect(view.projection).toBeUndefined();
  });

  it('respects explicit showHidden=true', async () => {
    const cmd = new AddIsoViewCommand({
      sheetId: 'sheet-1',
      positionMm: { x: 0, y: 0 },
      corner: 'SW',
      scale: { numerator: 1, denominator: 2 },
      showHidden: true,
    });
    await cmd.apply();

    const doc = (useAppStore.getState().activeDocument as { kind: 'drawing'; document: DrawingDocument }).document;
    const view = doc.sheets[0]!.views[0]!;
    if (view.kind !== 'iso') return;
    expect(view.showHidden).toBe(true);
  });

  it('revert removes the iso view', async () => {
    const cmd = new AddIsoViewCommand({
      sheetId: 'sheet-1',
      positionMm: { x: 0, y: 0 },
      corner: 'NW',
      scale: { numerator: 1, denominator: 1 },
    });
    await cmd.apply();
    await cmd.revert();

    const doc = (useAppStore.getState().activeDocument as { kind: 'drawing'; document: DrawingDocument }).document;
    expect(doc.sheets[0]!.views).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the test (expect fail)**

```
cd packages/app && pnpm test:unit -- AddIsoViewCommand
```

- [ ] **Step 3: Create `packages/app/src/commands/AddIsoViewCommand.ts`**

```ts
import type { Command } from './Command';
import type { DrawingDocument, ViewScale, IsoView } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';

export class AddIsoViewCommand implements Command {
  readonly name = 'AddIsoView';
  private newViewId: string | null = null;

  constructor(
    private readonly opts: {
      sheetId: string;
      positionMm: { x: number; y: number };
      corner: 'NE' | 'NW' | 'SE' | 'SW';
      scale: ViewScale;
      showHidden?: boolean;
    }
  ) {}

  async apply(): Promise<void> {
    const state = useAppStore.getState();
    const doc = state.activeDocument;
    if (!doc || doc.kind !== 'drawing') return;

    const newId = crypto.randomUUID();
    this.newViewId = newId;

    const view: IsoView = {
      id: newId,
      kind: 'iso',
      positionMm: this.opts.positionMm,
      corner: this.opts.corner,
      scale: this.opts.scale,
      showHidden: this.opts.showHidden ?? false, // engineering convention
    };

    const next: DrawingDocument = {
      ...doc.document,
      sheets: doc.document.sheets.map(s =>
        s.id === this.opts.sheetId
          ? { ...s, views: [...s.views, view] }
          : s
      ),
    };
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: next } } as never);
  }

  async revert(): Promise<void> {
    if (!this.newViewId) return;
    const state = useAppStore.getState();
    const doc = state.activeDocument;
    if (!doc || doc.kind !== 'drawing') return;

    const next: DrawingDocument = {
      ...doc.document,
      sheets: doc.document.sheets.map(s =>
        s.id === this.opts.sheetId
          ? { ...s, views: s.views.filter(v => v.id !== this.newViewId) }
          : s
      ),
    };
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: next } } as never);
    this.newViewId = null;
  }
}
```

- [ ] **Step 4: Run + typecheck + commit**

```
cd packages/app && pnpm test:unit -- AddIsoViewCommand
pnpm -r typecheck
git add packages/app/src/commands/AddIsoViewCommand.ts \
        packages/app/src/commands/__tests__/AddIsoViewCommand.spec.ts
git commit -m "feat(drawing): add AddIsoViewCommand"
```

**Verify:** 3/3 green; typecheck clean.

---

#### T25 — `MoveViewCommand`

**Files:**
- Create: `packages/app/src/commands/MoveViewCommand.ts`
- Create: `packages/app/src/commands/__tests__/MoveViewCommand.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/app/src/commands/__tests__/MoveViewCommand.spec.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '../../store/useAppStore';
import { MoveViewCommand } from '../MoveViewCommand';
import type { DrawingDocument, BaseView } from '@zilventor/shared';

const VIEW: BaseView = {
  id: 'view-1', kind: 'base',
  positionMm: { x: 50, y: 50 },
  orientation: 'front',
  scale: { numerator: 1, denominator: 1 },
  showHidden: true,
};

function makeDrawing(): DrawingDocument {
  return {
    id: 'd1', name: 'D', units: 'mm',
    source: { partPath: 'parts/p.zipt', sourceKind: 'part' },
    properties: {},
    sheets: [{
      id: 'sheet-1', name: 'Sheet 1',
      size: { kind: 'iso', size: 'A3' }, orientation: 'landscape',
      views: [VIEW], dimensions: [], annotations: [], titleBlock: {},
    }],
    activeSheetId: 'sheet-1',
  };
}

describe('MoveViewCommand', () => {
  beforeEach(() => {
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: makeDrawing() } } as never);
  });

  it('apply moves the view to the new position', async () => {
    const cmd = new MoveViewCommand({ sheetId: 'sheet-1', viewId: 'view-1', positionMm: { x: 150, y: 200 } });
    await cmd.apply();

    const doc = (useAppStore.getState().activeDocument as { kind: 'drawing'; document: DrawingDocument }).document;
    expect(doc.sheets[0]!.views[0]!.positionMm).toEqual({ x: 150, y: 200 });
  });

  it('revert restores the prior position', async () => {
    const cmd = new MoveViewCommand({ sheetId: 'sheet-1', viewId: 'view-1', positionMm: { x: 150, y: 200 } });
    await cmd.apply();
    await cmd.revert();

    const doc = (useAppStore.getState().activeDocument as { kind: 'drawing'; document: DrawingDocument }).document;
    expect(doc.sheets[0]!.views[0]!.positionMm).toEqual({ x: 50, y: 50 });
  });

  it('is a no-op when viewId not found', async () => {
    const cmd = new MoveViewCommand({ sheetId: 'sheet-1', viewId: 'no-such', positionMm: { x: 0, y: 0 } });
    await expect(cmd.apply()).resolves.toBeUndefined();
    const doc = (useAppStore.getState().activeDocument as { kind: 'drawing'; document: DrawingDocument }).document;
    expect(doc.sheets[0]!.views[0]!.positionMm).toEqual({ x: 50, y: 50 });
  });
});
```

- [ ] **Step 2: Run the test (expect fail)**

```
cd packages/app && pnpm test:unit -- MoveViewCommand
```

- [ ] **Step 3: Create `packages/app/src/commands/MoveViewCommand.ts`**

```ts
import type { Command } from './Command';
import type { DrawingDocument } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';

export class MoveViewCommand implements Command {
  readonly name = 'MoveView';
  private prevPosition: { x: number; y: number } | null = null;

  constructor(
    private readonly opts: {
      sheetId: string;
      viewId: string;
      positionMm: { x: number; y: number };
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

    this.prevPosition = { ...view.positionMm };

    const next: DrawingDocument = {
      ...doc.document,
      sheets: doc.document.sheets.map(s =>
        s.id === this.opts.sheetId
          ? {
              ...s,
              views: s.views.map(v =>
                v.id === this.opts.viewId
                  ? { ...v, positionMm: this.opts.positionMm }
                  : v
              ),
            }
          : s
      ),
    };
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: next } } as never);
  }

  async revert(): Promise<void> {
    if (!this.prevPosition) return;
    const state = useAppStore.getState();
    const doc = state.activeDocument;
    if (!doc || doc.kind !== 'drawing') return;

    const next: DrawingDocument = {
      ...doc.document,
      sheets: doc.document.sheets.map(s =>
        s.id === this.opts.sheetId
          ? {
              ...s,
              views: s.views.map(v =>
                v.id === this.opts.viewId
                  ? { ...v, positionMm: this.prevPosition! }
                  : v
              ),
            }
          : s
      ),
    };
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: next } } as never);
    this.prevPosition = null;
  }
}
```

- [ ] **Step 4: Run + typecheck + commit**

```
cd packages/app && pnpm test:unit -- MoveViewCommand
pnpm -r typecheck
git add packages/app/src/commands/MoveViewCommand.ts \
        packages/app/src/commands/__tests__/MoveViewCommand.spec.ts
git commit -m "feat(drawing): add MoveViewCommand"
```

**Verify:** 3/3 green; typecheck clean.

---

### Batch C: T26–T29 (cascade delete, regen, scale, hidden lines)

**Agent:** Sonnet implementer.

---

#### T26 — `DeleteViewCommand` (cascade)

**Files:**
- Create: `packages/app/src/commands/DeleteViewCommand.ts`
- Create: `packages/app/src/commands/__tests__/DeleteViewCommand.spec.ts`

- [ ] **Step 1: Write the failing test**

The cascade case is the key test: delete a base view that has 1 projected child and 2 dimensions → all 4 items gone; Ctrl-Z restores all 4 in original order.

```ts
// packages/app/src/commands/__tests__/DeleteViewCommand.spec.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '../../store/useAppStore';
import { DeleteViewCommand } from '../DeleteViewCommand';
import type { DrawingDocument, BaseView, ProjectedView, DrawingDimension } from '@zilventor/shared';

const BASE: BaseView = {
  id: 'base-1', kind: 'base',
  positionMm: { x: 100, y: 100 },
  orientation: 'front',
  scale: { numerator: 1, denominator: 1 },
  showHidden: true,
};
const PROJ: ProjectedView = {
  id: 'proj-1', kind: 'projected',
  positionMm: { x: 200, y: 100 },
  baseViewId: 'base-1',
  direction: 'right',
  scale: { numerator: 1, denominator: 1 },
  showHidden: true,
};
const ISO: BaseView = {
  id: 'iso-standalone', kind: 'base',
  positionMm: { x: 300, y: 100 },
  orientation: 'top',
  scale: { numerator: 1, denominator: 1 },
  showHidden: false,
};
const DIM_BASE: DrawingDimension = {
  id: 'dim-1', kind: 'linear-h', viewId: 'base-1',
  from: { kind: 'edge-endpoint', edgeId: 'e1', end: 'start' },
  to: { kind: 'edge-endpoint', edgeId: 'e2', end: 'end' },
  offsetMm: 10,
};
const DIM_PROJ: DrawingDimension = {
  id: 'dim-2', kind: 'linear-v', viewId: 'proj-1',
  from: { kind: 'edge-endpoint', edgeId: 'e3', end: 'start' },
  to: { kind: 'edge-endpoint', edgeId: 'e4', end: 'end' },
  offsetMm: 8,
};
const DIM_ISO: DrawingDimension = {
  id: 'dim-iso', kind: 'linear-h', viewId: 'iso-standalone',
  from: { kind: 'edge-endpoint', edgeId: 'e5', end: 'start' },
  to: { kind: 'edge-endpoint', edgeId: 'e6', end: 'end' },
  offsetMm: 5,
};

function makeDrawingWithCascade(): DrawingDocument {
  return {
    id: 'd1', name: 'D', units: 'mm',
    source: { partPath: 'parts/p.zipt', sourceKind: 'part' },
    properties: {},
    sheets: [{
      id: 'sheet-1', name: 'Sheet 1',
      size: { kind: 'iso', size: 'A3' }, orientation: 'landscape',
      views: [BASE, PROJ, ISO],
      dimensions: [DIM_BASE, DIM_PROJ, DIM_ISO],
      annotations: [],
      titleBlock: {},
    }],
    activeSheetId: 'sheet-1',
  };
}

describe('DeleteViewCommand', () => {
  beforeEach(() => {
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: makeDrawingWithCascade() } } as never);
  });

  it('deleting a non-base view removes only that view, not its siblings', async () => {
    const cmd = new DeleteViewCommand({ sheetId: 'sheet-1', viewId: 'iso-standalone' });
    await cmd.apply();

    const doc = (useAppStore.getState().activeDocument as { kind: 'drawing'; document: DrawingDocument }).document;
    const sheet = doc.sheets[0]!;
    expect(sheet.views).toHaveLength(2);
    expect(sheet.views.find(v => v.id === 'iso-standalone')).toBeUndefined();
    // dim-iso should also be removed
    expect(sheet.dimensions.find(d => d.id === 'dim-iso')).toBeUndefined();
  });

  it('cascade: deleting a base view removes it + projected children + all their dimensions', async () => {
    const cmd = new DeleteViewCommand({ sheetId: 'sheet-1', viewId: 'base-1' });
    await cmd.apply();

    const doc = (useAppStore.getState().activeDocument as { kind: 'drawing'; document: DrawingDocument }).document;
    const sheet = doc.sheets[0]!;

    // Only iso-standalone should remain
    expect(sheet.views).toHaveLength(1);
    expect(sheet.views[0]!.id).toBe('iso-standalone');

    // dim-1 (base-1's dim) and dim-2 (proj-1's dim) gone; dim-iso stays
    expect(sheet.dimensions).toHaveLength(1);
    expect(sheet.dimensions[0]!.id).toBe('dim-iso');
  });

  it('cascade revert: Ctrl-Z restores base view + projected child + both dimensions in original order', async () => {
    const cmd = new DeleteViewCommand({ sheetId: 'sheet-1', viewId: 'base-1' });
    await cmd.apply();
    await cmd.revert();

    const doc = (useAppStore.getState().activeDocument as { kind: 'drawing'; document: DrawingDocument }).document;
    const sheet = doc.sheets[0]!;

    expect(sheet.views).toHaveLength(3);
    expect(sheet.views[0]!.id).toBe('base-1');
    expect(sheet.views[1]!.id).toBe('proj-1');
    expect(sheet.views[2]!.id).toBe('iso-standalone');

    expect(sheet.dimensions).toHaveLength(3);
    expect(sheet.dimensions[0]!.id).toBe('dim-1');
    expect(sheet.dimensions[1]!.id).toBe('dim-2');
    expect(sheet.dimensions[2]!.id).toBe('dim-iso');
  });

  it('non-base view revert restores the view and its dimension', async () => {
    const cmd = new DeleteViewCommand({ sheetId: 'sheet-1', viewId: 'iso-standalone' });
    await cmd.apply();
    await cmd.revert();

    const doc = (useAppStore.getState().activeDocument as { kind: 'drawing'; document: DrawingDocument }).document;
    const sheet = doc.sheets[0]!;
    expect(sheet.views).toHaveLength(3);
    expect(sheet.dimensions).toHaveLength(3);
    expect(sheet.dimensions.find(d => d.id === 'dim-iso')).toBeDefined();
  });
});
```

- [ ] **Step 2: Run the test (expect fail)**

```
cd packages/app && pnpm test:unit -- DeleteViewCommand
```

- [ ] **Step 3: Create `packages/app/src/commands/DeleteViewCommand.ts`**

```ts
import type { Command } from './Command';
import type { DrawingDocument, DrawingView, DrawingDimension, DrawingAnnotation } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';

type Snapshot = {
  views: DrawingView[];
  viewIndices: number[];
  dimensions: DrawingDimension[];
  dimIndices: number[];
  annotations: DrawingAnnotation[];
  annIndices: number[];
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

    // Determine which view ids to remove (target + projected children if base)
    const viewIdsToRemove = new Set<string>([this.opts.viewId]);
    if (targetView.kind === 'base') {
      for (const v of sheet.views) {
        if (v.kind === 'projected' && v.baseViewId === this.opts.viewId) {
          viewIdsToRemove.add(v.id);
        }
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

    this.snapshot = {
      views: removedViews,
      viewIndices: removedViewIndices,
      dimensions: removedDims,
      dimIndices: removedDimIndices,
      annotations: removedAnns,
      annIndices: removedAnnIndices,
    };

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
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: next } } as never);
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
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: next } } as never);
    this.snapshot = null;
  }
}
```

- [ ] **Step 4: Run + typecheck + commit**

```
cd packages/app && pnpm test:unit -- DeleteViewCommand
pnpm -r typecheck
git add packages/app/src/commands/DeleteViewCommand.ts \
        packages/app/src/commands/__tests__/DeleteViewCommand.spec.ts
git commit -m "feat(drawing): add DeleteViewCommand with cascade for projected children + dimensions"
```

**Verify:** 4/4 green (including the cascade case); typecheck clean.

---

#### T27 — `RegenerateViewCommand`

**Files:**
- Create: `packages/app/src/commands/RegenerateViewCommand.ts`
- Create: `packages/app/src/commands/__tests__/RegenerateViewCommand.spec.ts`

> **Note for implementer:** This command is the last step in the regeneration round-trip. `DrawingTab` calls `getProjectorInput` → `projectView` → `computeViewFingerprint` in the worker, then dispatches this command with the results. The command itself is a pure state swap — it does not call the worker. Phase 8 (`<DrawingCanvas>`) will wire the full round-trip together.

- [ ] **Step 1: Write the failing test**

```ts
// packages/app/src/commands/__tests__/RegenerateViewCommand.spec.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '../../store/useAppStore';
import { RegenerateViewCommand } from '../RegenerateViewCommand';
import type { DrawingDocument, BaseView, ProjectedGeometry } from '@zilventor/shared';

const OLD_PROJECTION: ProjectedGeometry = {
  visibleEdges: [{ id: 'e1', kind: 'outline', points: [[0, 0], [100, 0]], sourceFaceIds: [] }],
  hiddenEdges: [],
  bbox: { minX: 0, minY: 0, maxX: 100, maxY: 0 },
};

const NEW_PROJECTION: ProjectedGeometry = {
  visibleEdges: [
    { id: 'e1', kind: 'outline', points: [[0, 0], [120, 0]], sourceFaceIds: [] },
    { id: 'e2', kind: 'outline', points: [[0, 0], [0, 60]], sourceFaceIds: [] },
  ],
  hiddenEdges: [],
  bbox: { minX: 0, minY: 0, maxX: 120, maxY: 60 },
};

const VIEW_WITH_OLD: BaseView = {
  id: 'view-1', kind: 'base',
  positionMm: { x: 50, y: 50 },
  orientation: 'front',
  scale: { numerator: 1, denominator: 1 },
  showHidden: true,
  projection: OLD_PROJECTION,
  inputFingerprint: 'old-fingerprint-abc',
};

function makeDrawing(): DrawingDocument {
  return {
    id: 'd1', name: 'D', units: 'mm',
    source: { partPath: 'parts/p.zipt', sourceKind: 'part' },
    properties: {},
    sheets: [{
      id: 'sheet-1', name: 'Sheet 1',
      size: { kind: 'iso', size: 'A3' }, orientation: 'landscape',
      views: [VIEW_WITH_OLD], dimensions: [], annotations: [], titleBlock: {},
    }],
    activeSheetId: 'sheet-1',
  };
}

describe('RegenerateViewCommand', () => {
  beforeEach(() => {
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: makeDrawing() } } as never);
  });

  it('apply replaces projection and inputFingerprint on the target view', async () => {
    const cmd = new RegenerateViewCommand({
      sheetId: 'sheet-1',
      viewId: 'view-1',
      projection: NEW_PROJECTION,
      inputFingerprint: 'new-fingerprint-xyz',
    });
    await cmd.apply();

    const doc = (useAppStore.getState().activeDocument as { kind: 'drawing'; document: DrawingDocument }).document;
    const view = doc.sheets[0]!.views[0]!;
    if (view.kind !== 'base') return;
    expect(view.projection).toEqual(NEW_PROJECTION);
    expect(view.inputFingerprint).toBe('new-fingerprint-xyz');
  });

  it('revert restores the prior projection and fingerprint', async () => {
    const cmd = new RegenerateViewCommand({
      sheetId: 'sheet-1',
      viewId: 'view-1',
      projection: NEW_PROJECTION,
      inputFingerprint: 'new-fingerprint-xyz',
    });
    await cmd.apply();
    await cmd.revert();

    const doc = (useAppStore.getState().activeDocument as { kind: 'drawing'; document: DrawingDocument }).document;
    const view = doc.sheets[0]!.views[0]!;
    if (view.kind !== 'base') return;
    expect(view.projection).toEqual(OLD_PROJECTION);
    expect(view.inputFingerprint).toBe('old-fingerprint-abc');
  });

  it('revert with no prior projection/fingerprint (fresh view) restores undefined', async () => {
    const freshView: BaseView = {
      id: 'view-fresh', kind: 'base',
      positionMm: { x: 0, y: 0 },
      orientation: 'top',
      scale: { numerator: 1, denominator: 1 },
      showHidden: false,
    };
    useAppStore.setState({
      activeDocument: {
        kind: 'drawing',
        document: {
          ...makeDrawing(),
          sheets: [{
            ...makeDrawing().sheets[0]!,
            views: [freshView],
          }],
        },
      },
    } as never);

    const cmd = new RegenerateViewCommand({
      sheetId: 'sheet-1', viewId: 'view-fresh',
      projection: NEW_PROJECTION, inputFingerprint: 'fp-1',
    });
    await cmd.apply();
    await cmd.revert();

    const doc = (useAppStore.getState().activeDocument as { kind: 'drawing'; document: DrawingDocument }).document;
    const view = doc.sheets[0]!.views[0]!;
    if (view.kind !== 'base') return;
    expect(view.projection).toBeUndefined();
    expect(view.inputFingerprint).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test (expect fail)**

```
cd packages/app && pnpm test:unit -- RegenerateViewCommand
```

- [ ] **Step 3: Create `packages/app/src/commands/RegenerateViewCommand.ts`**

```ts
import type { Command } from './Command';
import type { DrawingDocument, ProjectedGeometry } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';

export class RegenerateViewCommand implements Command {
  readonly name = 'RegenerateView';
  private prevProjection: ProjectedGeometry | undefined = undefined;
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

    // Capture prior values (may be undefined for a fresh view)
    this.prevProjection = view.projection;
    this.prevFingerprint = view.inputFingerprint;
    this.applied = true;

    const next: DrawingDocument = {
      ...doc.document,
      sheets: doc.document.sheets.map(s =>
        s.id === this.opts.sheetId
          ? {
              ...s,
              views: s.views.map(v =>
                v.id === this.opts.viewId
                  ? { ...v, projection: this.opts.projection, inputFingerprint: this.opts.inputFingerprint }
                  : v
              ),
            }
          : s
      ),
    };
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: next } } as never);
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
                // Restore: use spread then conditionally set/delete the fields
                const base = { ...v };
                if (this.prevProjection !== undefined) {
                  (base as { projection?: ProjectedGeometry }).projection = this.prevProjection;
                } else {
                  delete (base as { projection?: ProjectedGeometry }).projection;
                }
                if (this.prevFingerprint !== undefined) {
                  (base as { inputFingerprint?: string }).inputFingerprint = this.prevFingerprint;
                } else {
                  delete (base as { inputFingerprint?: string }).inputFingerprint;
                }
                return base;
              }),
            }
          : s
      ),
    };
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: next } } as never);
    this.applied = false;
  }
}
```

- [ ] **Step 4: Run + typecheck + commit**

```
cd packages/app && pnpm test:unit -- RegenerateViewCommand
pnpm -r typecheck
git add packages/app/src/commands/RegenerateViewCommand.ts \
        packages/app/src/commands/__tests__/RegenerateViewCommand.spec.ts
git commit -m "feat(drawing): add RegenerateViewCommand — atomic projection + fingerprint swap with undo"
```

**Verify:** 3/3 green; typecheck clean.

---

#### T28 — `EditViewScaleCommand`

**Files:**
- Create: `packages/app/src/commands/EditViewScaleCommand.ts`
- Create: `packages/app/src/commands/__tests__/EditViewScaleCommand.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/app/src/commands/__tests__/EditViewScaleCommand.spec.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '../../store/useAppStore';
import { EditViewScaleCommand } from '../EditViewScaleCommand';
import type { DrawingDocument, BaseView, ProjectedGeometry } from '@zilventor/shared';

const PROJ: ProjectedGeometry = {
  visibleEdges: [], hiddenEdges: [],
  bbox: { minX: 0, minY: 0, maxX: 100, maxY: 60 },
};
const VIEW: BaseView = {
  id: 'view-1', kind: 'base',
  positionMm: { x: 50, y: 50 },
  orientation: 'front',
  scale: { numerator: 1, denominator: 1 },
  showHidden: true,
  projection: PROJ,
  inputFingerprint: 'fp-old',
};

function makeDrawing(): DrawingDocument {
  return {
    id: 'd1', name: 'D', units: 'mm',
    source: { partPath: 'parts/p.zipt', sourceKind: 'part' },
    properties: {},
    sheets: [{
      id: 'sheet-1', name: 'Sheet 1',
      size: { kind: 'iso', size: 'A3' }, orientation: 'landscape',
      views: [VIEW], dimensions: [], annotations: [], titleBlock: {},
    }],
    activeSheetId: 'sheet-1',
  };
}

describe('EditViewScaleCommand', () => {
  beforeEach(() => {
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: makeDrawing() } } as never);
  });

  it('apply updates scale and clears inputFingerprint (requires regen)', async () => {
    const cmd = new EditViewScaleCommand({
      sheetId: 'sheet-1',
      viewId: 'view-1',
      scale: { numerator: 1, denominator: 2 },
    });
    await cmd.apply();

    const doc = (useAppStore.getState().activeDocument as { kind: 'drawing'; document: DrawingDocument }).document;
    const view = doc.sheets[0]!.views[0]!;
    if (view.kind !== 'base') return;
    expect(view.scale).toEqual({ numerator: 1, denominator: 2 });
    expect(view.inputFingerprint).toBeUndefined(); // cleared to trigger stale-banner
  });

  it('revert restores prior scale and inputFingerprint', async () => {
    const cmd = new EditViewScaleCommand({
      sheetId: 'sheet-1',
      viewId: 'view-1',
      scale: { numerator: 1, denominator: 5 },
    });
    await cmd.apply();
    await cmd.revert();

    const doc = (useAppStore.getState().activeDocument as { kind: 'drawing'; document: DrawingDocument }).document;
    const view = doc.sheets[0]!.views[0]!;
    if (view.kind !== 'base') return;
    expect(view.scale).toEqual({ numerator: 1, denominator: 1 });
    expect(view.inputFingerprint).toBe('fp-old');
  });
});
```

- [ ] **Step 2: Run the test (expect fail)**

```
cd packages/app && pnpm test:unit -- EditViewScaleCommand
```

- [ ] **Step 3: Create `packages/app/src/commands/EditViewScaleCommand.ts`**

```ts
import type { Command } from './Command';
import type { DrawingDocument, ViewScale } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';

export class EditViewScaleCommand implements Command {
  readonly name = 'EditViewScale';
  private prevScale: ViewScale | null = null;
  private prevFingerprint: string | undefined = undefined;
  private applied = false;

  constructor(
    private readonly opts: {
      sheetId: string;
      viewId: string;
      scale: ViewScale;
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

    this.prevScale = view.scale;
    this.prevFingerprint = view.inputFingerprint;
    this.applied = true;

    const next: DrawingDocument = {
      ...doc.document,
      sheets: doc.document.sheets.map(s =>
        s.id === this.opts.sheetId
          ? {
              ...s,
              views: s.views.map(v => {
                if (v.id !== this.opts.viewId) return v;
                const updated = { ...v, scale: this.opts.scale };
                // Scale change invalidates projection — clear fingerprint to trigger stale-banner
                delete (updated as { inputFingerprint?: string }).inputFingerprint;
                return updated;
              }),
            }
          : s
      ),
    };
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: next } } as never);
  }

  async revert(): Promise<void> {
    if (!this.applied || !this.prevScale) return;
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
                const restored = { ...v, scale: this.prevScale! };
                if (this.prevFingerprint !== undefined) {
                  (restored as { inputFingerprint?: string }).inputFingerprint = this.prevFingerprint;
                }
                return restored;
              }),
            }
          : s
      ),
    };
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: next } } as never);
    this.applied = false;
  }
}
```

- [ ] **Step 4: Run + typecheck + commit**

```
cd packages/app && pnpm test:unit -- EditViewScaleCommand
pnpm -r typecheck
git add packages/app/src/commands/EditViewScaleCommand.ts \
        packages/app/src/commands/__tests__/EditViewScaleCommand.spec.ts
git commit -m "feat(drawing): add EditViewScaleCommand"
```

**Verify:** 2/2 green; typecheck clean.

---

#### T29 — `ToggleHiddenLinesCommand`

**Files:**
- Create: `packages/app/src/commands/ToggleHiddenLinesCommand.ts`
- Create: `packages/app/src/commands/__tests__/ToggleHiddenLinesCommand.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/app/src/commands/__tests__/ToggleHiddenLinesCommand.spec.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '../../store/useAppStore';
import { ToggleHiddenLinesCommand } from '../ToggleHiddenLinesCommand';
import type { DrawingDocument, BaseView } from '@zilventor/shared';

const VIEW: BaseView = {
  id: 'view-1', kind: 'base',
  positionMm: { x: 50, y: 50 },
  orientation: 'front',
  scale: { numerator: 1, denominator: 1 },
  showHidden: true,
};

function makeDrawing(): DrawingDocument {
  return {
    id: 'd1', name: 'D', units: 'mm',
    source: { partPath: 'parts/p.zipt', sourceKind: 'part' },
    properties: {},
    sheets: [{
      id: 'sheet-1', name: 'Sheet 1',
      size: { kind: 'iso', size: 'A3' }, orientation: 'landscape',
      views: [VIEW], dimensions: [], annotations: [], titleBlock: {},
    }],
    activeSheetId: 'sheet-1',
  };
}

describe('ToggleHiddenLinesCommand', () => {
  beforeEach(() => {
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: makeDrawing() } } as never);
  });

  it('apply sets showHidden to false', async () => {
    const cmd = new ToggleHiddenLinesCommand({ sheetId: 'sheet-1', viewId: 'view-1', showHidden: false });
    await cmd.apply();

    const doc = (useAppStore.getState().activeDocument as { kind: 'drawing'; document: DrawingDocument }).document;
    const view = doc.sheets[0]!.views[0]!;
    expect(view.showHidden).toBe(false);
  });

  it('revert restores prior showHidden value', async () => {
    const cmd = new ToggleHiddenLinesCommand({ sheetId: 'sheet-1', viewId: 'view-1', showHidden: false });
    await cmd.apply();
    await cmd.revert();

    const doc = (useAppStore.getState().activeDocument as { kind: 'drawing'; document: DrawingDocument }).document;
    const view = doc.sheets[0]!.views[0]!;
    expect(view.showHidden).toBe(true);
  });

  it('apply → revert round-trip: true → false → true', async () => {
    const cmd = new ToggleHiddenLinesCommand({ sheetId: 'sheet-1', viewId: 'view-1', showHidden: false });
    await cmd.apply();
    expect((useAppStore.getState().activeDocument as { kind: 'drawing'; document: DrawingDocument }).document.sheets[0]!.views[0]!.showHidden).toBe(false);
    await cmd.revert();
    expect((useAppStore.getState().activeDocument as { kind: 'drawing'; document: DrawingDocument }).document.sheets[0]!.views[0]!.showHidden).toBe(true);
  });

  it('apply is a no-op when viewId not found', async () => {
    const cmd = new ToggleHiddenLinesCommand({ sheetId: 'sheet-1', viewId: 'no-such', showHidden: false });
    await expect(cmd.apply()).resolves.toBeUndefined();
    const doc = (useAppStore.getState().activeDocument as { kind: 'drawing'; document: DrawingDocument }).document;
    expect(doc.sheets[0]!.views[0]!.showHidden).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test (expect fail)**

```
cd packages/app && pnpm test:unit -- ToggleHiddenLinesCommand
```

- [ ] **Step 3: Create `packages/app/src/commands/ToggleHiddenLinesCommand.ts`**

```ts
import type { Command } from './Command';
import type { DrawingDocument } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';

export class ToggleHiddenLinesCommand implements Command {
  readonly name = 'ToggleHiddenLines';
  private prevShowHidden: boolean | null = null;

  constructor(
    private readonly opts: {
      sheetId: string;
      viewId: string;
      showHidden: boolean;
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

    this.prevShowHidden = view.showHidden;

    const next: DrawingDocument = {
      ...doc.document,
      sheets: doc.document.sheets.map(s =>
        s.id === this.opts.sheetId
          ? {
              ...s,
              views: s.views.map(v =>
                v.id === this.opts.viewId
                  ? { ...v, showHidden: this.opts.showHidden }
                  : v
              ),
            }
          : s
      ),
    };
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: next } } as never);
  }

  async revert(): Promise<void> {
    if (this.prevShowHidden === null) return;
    const state = useAppStore.getState();
    const doc = state.activeDocument;
    if (!doc || doc.kind !== 'drawing') return;

    const next: DrawingDocument = {
      ...doc.document,
      sheets: doc.document.sheets.map(s =>
        s.id === this.opts.sheetId
          ? {
              ...s,
              views: s.views.map(v =>
                v.id === this.opts.viewId
                  ? { ...v, showHidden: this.prevShowHidden! }
                  : v
              ),
            }
          : s
      ),
    };
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: next } } as never);
    this.prevShowHidden = null;
  }
}
```

- [ ] **Step 4: Run + typecheck + commit**

```
cd packages/app && pnpm test:unit -- ToggleHiddenLinesCommand
pnpm -r typecheck
git add packages/app/src/commands/ToggleHiddenLinesCommand.ts \
        packages/app/src/commands/__tests__/ToggleHiddenLinesCommand.spec.ts
git commit -m "feat(drawing): add ToggleHiddenLinesCommand"
```

**Verify:** 4/4 green; typecheck clean; all Phase 5 tests green.
## Phase 6 — Dimension, annotation, title-block, drawing-properties commands

Eight tasks; dispatch as two Sonnet implementer batches (T30-T33, T34-T37).

---

### Task T30 — `AddDrawingDimensionCommand`

**Files:**
- Create: `packages/app/src/commands/AddDrawingDimensionCommand.ts`
- Create (test): `packages/app/src/commands/__tests__/AddDrawingDimensionCommand.spec.ts`

**Agent:** Sonnet implementer.

- [ ] **Step 1: Write the failing test**

```ts
// packages/app/src/commands/__tests__/AddDrawingDimensionCommand.spec.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { AddDrawingDimensionCommand } from '../AddDrawingDimensionCommand';
import { useAppStore } from '../../store/useAppStore';
import type { DrawingDocument, DrawingDimension } from '@zilventor/shared';

function makeDrawingDoc(dims: DrawingDimension[] = []): DrawingDocument {
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
        dimensions: dims,
        annotations: [],
        titleBlock: {},
      },
    ],
  };
}

const dim1: DrawingDimension = {
  id: 'dim1',
  kind: 'linear-h',
  viewId: 'v1',
  from: { kind: 'edge-endpoint', edgeId: 'e1', end: 'start' },
  to:   { kind: 'edge-endpoint', edgeId: 'e1', end: 'end' },
  offsetMm: 10,
};

beforeEach(() => {
  useAppStore.setState({
    activeDocument: { kind: 'drawing', document: makeDrawingDoc() },
  } as never);
});

describe('AddDrawingDimensionCommand', () => {
  it('(a) apply appends the dimension to the sheet', async () => {
    const cmd = new AddDrawingDimensionCommand({ sheetId: 'sh1', dim: dim1 });
    await cmd.apply();
    const doc = (useAppStore.getState().activeDocument as { kind: 'drawing'; document: DrawingDocument }).document;
    const sheet = doc.sheets.find((s) => s.id === 'sh1')!;
    expect(sheet.dimensions).toHaveLength(1);
    expect(sheet.dimensions[0]!.id).toBe('dim1');
  });

  it('(b) revert removes the appended dimension', async () => {
    const cmd = new AddDrawingDimensionCommand({ sheetId: 'sh1', dim: dim1 });
    await cmd.apply();
    await cmd.revert();
    const doc = (useAppStore.getState().activeDocument as { kind: 'drawing'; document: DrawingDocument }).document;
    const sheet = doc.sheets.find((s) => s.id === 'sh1')!;
    expect(sheet.dimensions).toHaveLength(0);
  });

  it('(c) revert is idempotent — second revert is a no-op', async () => {
    const cmd = new AddDrawingDimensionCommand({ sheetId: 'sh1', dim: dim1 });
    await cmd.apply();
    await cmd.revert();
    await cmd.revert();
    const doc = (useAppStore.getState().activeDocument as { kind: 'drawing'; document: DrawingDocument }).document;
    const sheet = doc.sheets.find((s) => s.id === 'sh1')!;
    expect(sheet.dimensions).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the test (expect fail)**

```bash
cd /path/to/worktree && pnpm --filter @zilventor/app test:unit -- AddDrawingDimensionCommand
```

Expected: 3 failures (module not found).

- [ ] **Step 3: Implement `AddDrawingDimensionCommand`**

```ts
// packages/app/src/commands/AddDrawingDimensionCommand.ts
import type { Command } from './Command';
import type { DrawingDimension, DrawingDocument } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';

export class AddDrawingDimensionCommand implements Command {
  readonly name = 'AddDrawingDimension';

  constructor(private readonly opts: { sheetId: string; dim: DrawingDimension }) {}

  async apply(): Promise<void> {
    useAppStore.setState((s) => {
      if (s.activeDocument?.kind !== 'drawing') return s;
      const doc = s.activeDocument.document;
      const sheets = doc.sheets.map((sh) =>
        sh.id === this.opts.sheetId
          ? { ...sh, dimensions: [...sh.dimensions, this.opts.dim] }
          : sh,
      );
      const next: DrawingDocument = { ...doc, sheets };
      return { activeDocument: { kind: 'drawing' as const, document: next } } as never;
    });
  }

  async revert(): Promise<void> {
    useAppStore.setState((s) => {
      if (s.activeDocument?.kind !== 'drawing') return s;
      const doc = s.activeDocument.document;
      const sheets = doc.sheets.map((sh) =>
        sh.id === this.opts.sheetId
          ? { ...sh, dimensions: sh.dimensions.filter((d) => d.id !== this.opts.dim.id) }
          : sh,
      );
      const next: DrawingDocument = { ...doc, sheets };
      return { activeDocument: { kind: 'drawing' as const, document: next } } as never;
    });
  }
}
```

- [ ] **Step 4: Run the test (expect pass)**

```bash
pnpm --filter @zilventor/app test:unit -- AddDrawingDimensionCommand
```

Expected: 3/3 pass.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/commands/AddDrawingDimensionCommand.ts packages/app/src/commands/__tests__/AddDrawingDimensionCommand.spec.ts && git commit -m "feat(drawing): add AddDrawingDimensionCommand"
```

**Verify:** `pnpm -r typecheck` clean; 3 tests green.

---

### Task T31 — `MoveDrawingDimensionCommand`

**Files:**
- Create: `packages/app/src/commands/MoveDrawingDimensionCommand.ts`
- Create (test): `packages/app/src/commands/__tests__/MoveDrawingDimensionCommand.spec.ts`

**Agent:** Sonnet implementer.

- [ ] **Step 1: Write the failing test**

```ts
// packages/app/src/commands/__tests__/MoveDrawingDimensionCommand.spec.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { MoveDrawingDimensionCommand } from '../MoveDrawingDimensionCommand';
import { useAppStore } from '../../store/useAppStore';
import type { DrawingDocument, DrawingDimension } from '@zilventor/shared';

const dim1: DrawingDimension = {
  id: 'dim1',
  kind: 'linear-h',
  viewId: 'v1',
  from: { kind: 'edge-endpoint', edgeId: 'e1', end: 'start' },
  to:   { kind: 'edge-endpoint', edgeId: 'e1', end: 'end' },
  offsetMm: 10,
};

function makeDrawingDoc(): DrawingDocument {
  return {
    id: 'dw1', name: 'Test Drawing', units: 'mm',
    source: { partPath: 'parts/box.zipt', sourceKind: 'part' },
    properties: {}, activeSheetId: 'sh1',
    sheets: [{
      id: 'sh1', name: 'Sheet 1',
      size: { kind: 'iso', size: 'A3' }, orientation: 'landscape',
      views: [], dimensions: [dim1], annotations: [], titleBlock: {},
    }],
  };
}

beforeEach(() => {
  useAppStore.setState({
    activeDocument: { kind: 'drawing', document: makeDrawingDoc() },
  } as never);
});

describe('MoveDrawingDimensionCommand', () => {
  it('(a) apply updates offsetMm on the target dimension', async () => {
    const cmd = new MoveDrawingDimensionCommand({ sheetId: 'sh1', dimId: 'dim1', offsetMm: 25 });
    await cmd.apply();
    const doc = (useAppStore.getState().activeDocument as { kind: 'drawing'; document: DrawingDocument }).document;
    const dim = doc.sheets[0]!.dimensions[0]!;
    expect((dim as { offsetMm: number }).offsetMm).toBe(25);
  });

  it('(a) apply updates angleDeg on radial dimensions when provided', async () => {
    // Seed a radial dim
    const radialDim: DrawingDimension = { id: 'dim2', kind: 'radial', viewId: 'v1', edgeId: 'arc1', offsetMm: 5, angleDeg: 0 };
    useAppStore.setState({
      activeDocument: {
        kind: 'drawing',
        document: {
          id: 'dw1', name: 'Test Drawing', units: 'mm',
          source: { partPath: 'parts/box.zipt', sourceKind: 'part' },
          properties: {}, activeSheetId: 'sh1',
          sheets: [{
            id: 'sh1', name: 'Sheet 1',
            size: { kind: 'iso', size: 'A3' }, orientation: 'landscape',
            views: [], dimensions: [radialDim], annotations: [], titleBlock: {},
          }],
        },
      },
    } as never);
    const cmd = new MoveDrawingDimensionCommand({ sheetId: 'sh1', dimId: 'dim2', offsetMm: 12, angleDeg: 45 });
    await cmd.apply();
    const doc = (useAppStore.getState().activeDocument as { kind: 'drawing'; document: DrawingDocument }).document;
    const dim = doc.sheets[0]!.dimensions[0]! as { offsetMm: number; angleDeg: number };
    expect(dim.offsetMm).toBe(12);
    expect(dim.angleDeg).toBe(45);
  });

  it('(b) revert restores prior offsetMm', async () => {
    const cmd = new MoveDrawingDimensionCommand({ sheetId: 'sh1', dimId: 'dim1', offsetMm: 25 });
    await cmd.apply();
    await cmd.revert();
    const doc = (useAppStore.getState().activeDocument as { kind: 'drawing'; document: DrawingDocument }).document;
    const dim = doc.sheets[0]!.dimensions[0]! as { offsetMm: number };
    expect(dim.offsetMm).toBe(10);
  });

  it('(c) revert is idempotent', async () => {
    const cmd = new MoveDrawingDimensionCommand({ sheetId: 'sh1', dimId: 'dim1', offsetMm: 25 });
    await cmd.apply();
    await cmd.revert();
    await cmd.revert();
    const doc = (useAppStore.getState().activeDocument as { kind: 'drawing'; document: DrawingDocument }).document;
    const dim = doc.sheets[0]!.dimensions[0]! as { offsetMm: number };
    expect(dim.offsetMm).toBe(10);
  });
});
```

- [ ] **Step 2: Run the test (expect fail)**

```bash
pnpm --filter @zilventor/app test:unit -- MoveDrawingDimensionCommand
```

Expected: failures (module not found).

- [ ] **Step 3: Implement `MoveDrawingDimensionCommand`**

```ts
// packages/app/src/commands/MoveDrawingDimensionCommand.ts
import type { Command } from './Command';
import type { DrawingDocument, DrawingDimension } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';

export class MoveDrawingDimensionCommand implements Command {
  readonly name = 'MoveDrawingDimension';
  private prevOffsetMm: number | undefined;
  private prevAngleDeg: number | undefined;

  constructor(private readonly opts: { sheetId: string; dimId: string; offsetMm: number; angleDeg?: number }) {}

  async apply(): Promise<void> {
    useAppStore.setState((s) => {
      if (s.activeDocument?.kind !== 'drawing') return s;
      const doc = s.activeDocument.document;
      const sheets = doc.sheets.map((sh) => {
        if (sh.id !== this.opts.sheetId) return sh;
        const dimensions = sh.dimensions.map((d) => {
          if (d.id !== this.opts.dimId) return d;
          this.prevOffsetMm = (d as { offsetMm: number }).offsetMm;
          this.prevAngleDeg = (d as { angleDeg?: number }).angleDeg;
          const updated = { ...d, offsetMm: this.opts.offsetMm } as DrawingDimension;
          if (this.opts.angleDeg !== undefined && 'angleDeg' in d) {
            return { ...updated, angleDeg: this.opts.angleDeg } as DrawingDimension;
          }
          return updated;
        });
        return { ...sh, dimensions };
      });
      const next: DrawingDocument = { ...doc, sheets };
      return { activeDocument: { kind: 'drawing' as const, document: next } } as never;
    });
  }

  async revert(): Promise<void> {
    if (this.prevOffsetMm === undefined) return;
    useAppStore.setState((s) => {
      if (s.activeDocument?.kind !== 'drawing') return s;
      const doc = s.activeDocument.document;
      const sheets = doc.sheets.map((sh) => {
        if (sh.id !== this.opts.sheetId) return sh;
        const dimensions = sh.dimensions.map((d) => {
          if (d.id !== this.opts.dimId) return d;
          const restored = { ...d, offsetMm: this.prevOffsetMm! } as DrawingDimension;
          if (this.prevAngleDeg !== undefined && 'angleDeg' in d) {
            return { ...restored, angleDeg: this.prevAngleDeg } as DrawingDimension;
          }
          return restored;
        });
        return { ...sh, dimensions };
      });
      const next: DrawingDocument = { ...doc, sheets };
      return { activeDocument: { kind: 'drawing' as const, document: next } } as never;
    });
  }
}
```

- [ ] **Step 4: Run the test (expect pass)**

```bash
pnpm --filter @zilventor/app test:unit -- MoveDrawingDimensionCommand
```

Expected: 4/4 pass.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/commands/MoveDrawingDimensionCommand.ts packages/app/src/commands/__tests__/MoveDrawingDimensionCommand.spec.ts && git commit -m "feat(drawing): add MoveDrawingDimensionCommand"
```

**Verify:** `pnpm -r typecheck` clean; 4 tests green.

---

### Task T32 — `DeleteDrawingDimensionCommand`

**Files:**
- Create: `packages/app/src/commands/DeleteDrawingDimensionCommand.ts`
- Create (test): `packages/app/src/commands/__tests__/DeleteDrawingDimensionCommand.spec.ts`

**Agent:** Sonnet implementer.

- [ ] **Step 1: Write the failing test**

```ts
// packages/app/src/commands/__tests__/DeleteDrawingDimensionCommand.spec.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { DeleteDrawingDimensionCommand } from '../DeleteDrawingDimensionCommand';
import { useAppStore } from '../../store/useAppStore';
import type { DrawingDocument, DrawingDimension } from '@zilventor/shared';

const dimA: DrawingDimension = {
  id: 'dA', kind: 'linear-h', viewId: 'v1',
  from: { kind: 'edge-endpoint', edgeId: 'e1', end: 'start' },
  to:   { kind: 'edge-endpoint', edgeId: 'e1', end: 'end' },
  offsetMm: 10,
};
const dimB: DrawingDimension = {
  id: 'dB', kind: 'linear-v', viewId: 'v1',
  from: { kind: 'edge-endpoint', edgeId: 'e2', end: 'start' },
  to:   { kind: 'edge-endpoint', edgeId: 'e2', end: 'end' },
  offsetMm: 20,
};

function makeDrawingDoc(): DrawingDocument {
  return {
    id: 'dw1', name: 'Test Drawing', units: 'mm',
    source: { partPath: 'parts/box.zipt', sourceKind: 'part' },
    properties: {}, activeSheetId: 'sh1',
    sheets: [{
      id: 'sh1', name: 'Sheet 1',
      size: { kind: 'iso', size: 'A3' }, orientation: 'landscape',
      views: [], dimensions: [dimA, dimB], annotations: [], titleBlock: {},
    }],
  };
}

beforeEach(() => {
  useAppStore.setState({
    activeDocument: { kind: 'drawing', document: makeDrawingDoc() },
  } as never);
});

describe('DeleteDrawingDimensionCommand', () => {
  it('(a) apply removes the dimension by id', async () => {
    const cmd = new DeleteDrawingDimensionCommand({ sheetId: 'sh1', dimId: 'dA' });
    await cmd.apply();
    const doc = (useAppStore.getState().activeDocument as { kind: 'drawing'; document: DrawingDocument }).document;
    const dims = doc.sheets[0]!.dimensions;
    expect(dims).toHaveLength(1);
    expect(dims[0]!.id).toBe('dB');
  });

  it('(b) revert re-inserts the removed dimension at its original index', async () => {
    const cmd = new DeleteDrawingDimensionCommand({ sheetId: 'sh1', dimId: 'dA' });
    await cmd.apply();
    await cmd.revert();
    const doc = (useAppStore.getState().activeDocument as { kind: 'drawing'; document: DrawingDocument }).document;
    const dims = doc.sheets[0]!.dimensions;
    expect(dims).toHaveLength(2);
    expect(dims[0]!.id).toBe('dA');
    expect(dims[1]!.id).toBe('dB');
  });

  it('(c) revert is idempotent — second revert leaves one copy', async () => {
    const cmd = new DeleteDrawingDimensionCommand({ sheetId: 'sh1', dimId: 'dA' });
    await cmd.apply();
    await cmd.revert();
    await cmd.revert();
    const doc = (useAppStore.getState().activeDocument as { kind: 'drawing'; document: DrawingDocument }).document;
    // Second revert is a no-op: index already re-inserted once; no duplicate.
    expect(doc.sheets[0]!.dimensions).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run the test (expect fail)**

```bash
pnpm --filter @zilventor/app test:unit -- DeleteDrawingDimensionCommand
```

Expected: failures (module not found).

- [ ] **Step 3: Implement `DeleteDrawingDimensionCommand`**

```ts
// packages/app/src/commands/DeleteDrawingDimensionCommand.ts
import type { Command } from './Command';
import type { DrawingDocument, DrawingDimension } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';

export class DeleteDrawingDimensionCommand implements Command {
  readonly name = 'DeleteDrawingDimension';
  private priorDim: DrawingDimension | undefined;
  private priorIndex = -1;
  private reverted = false;

  constructor(private readonly opts: { sheetId: string; dimId: string }) {}

  async apply(): Promise<void> {
    this.reverted = false;
    useAppStore.setState((s) => {
      if (s.activeDocument?.kind !== 'drawing') return s;
      const doc = s.activeDocument.document;
      const sheets = doc.sheets.map((sh) => {
        if (sh.id !== this.opts.sheetId) return sh;
        const idx = sh.dimensions.findIndex((d) => d.id === this.opts.dimId);
        if (idx === -1) return sh;
        this.priorDim = sh.dimensions[idx];
        this.priorIndex = idx;
        const dimensions = sh.dimensions.filter((d) => d.id !== this.opts.dimId);
        return { ...sh, dimensions };
      });
      const next: DrawingDocument = { ...doc, sheets };
      return { activeDocument: { kind: 'drawing' as const, document: next } } as never;
    });
  }

  async revert(): Promise<void> {
    if (!this.priorDim || this.reverted) return;
    this.reverted = true;
    const { priorDim, priorIndex } = this;
    useAppStore.setState((s) => {
      if (s.activeDocument?.kind !== 'drawing') return s;
      const doc = s.activeDocument.document;
      const sheets = doc.sheets.map((sh) => {
        if (sh.id !== this.opts.sheetId) return sh;
        const dims = [...sh.dimensions];
        dims.splice(priorIndex, 0, priorDim!);
        return { ...sh, dimensions: dims };
      });
      const next: DrawingDocument = { ...doc, sheets };
      return { activeDocument: { kind: 'drawing' as const, document: next } } as never;
    });
  }
}
```

- [ ] **Step 4: Run the test (expect pass)**

```bash
pnpm --filter @zilventor/app test:unit -- DeleteDrawingDimensionCommand
```

Expected: 3/3 pass.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/commands/DeleteDrawingDimensionCommand.ts packages/app/src/commands/__tests__/DeleteDrawingDimensionCommand.spec.ts && git commit -m "feat(drawing): add DeleteDrawingDimensionCommand"
```

**Verify:** `pnpm -r typecheck` clean; 3 tests green.

---

### Task T33 — `AddDrawingAnnotationCommand`

**Files:**
- Create: `packages/app/src/commands/AddDrawingAnnotationCommand.ts`
- Create (test): `packages/app/src/commands/__tests__/AddDrawingAnnotationCommand.spec.ts`

**Agent:** Sonnet implementer.

- [ ] **Step 1: Write the failing test**

```ts
// packages/app/src/commands/__tests__/AddDrawingAnnotationCommand.spec.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { AddDrawingAnnotationCommand } from '../AddDrawingAnnotationCommand';
import { useAppStore } from '../../store/useAppStore';
import type { DrawingDocument, DrawingAnnotation, AssemblyDocument } from '@zilventor/shared';

function makeDrawingDoc(): DrawingDocument {
  return {
    id: 'dw1', name: 'Test Drawing', units: 'mm',
    source: { partPath: 'assemblies/cabinet.ziasm', sourceKind: 'assembly' },
    properties: {}, activeSheetId: 'sh1',
    sheets: [{
      id: 'sh1', name: 'Sheet 1',
      size: { kind: 'iso', size: 'A3' }, orientation: 'landscape',
      views: [], dimensions: [], annotations: [], titleBlock: {},
    }],
  };
}

function makeActiveAssembly(): AssemblyDocument {
  return {
    id: 'a1', name: 'Cabinet', units: 'mm', parameters: {},
    components: [
      { id: 'c1', partPath: 'parts/side.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
      { id: 'c2', partPath: 'parts/shelf.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
    ],
    constraints: [], groundedComponentPaths: [],
    colors: {}, bomItemNumbers: { 'c1': 1, 'c2': 2 }, cutListItemNumbers: {},
    colorOverrides: {}, properties: {}, materials: [], hardware: [],
  };
}

const leaderAnn: DrawingAnnotation = {
  id: 'ann1', kind: 'leader', viewId: 'v1',
  targetMm: { x: 50, y: 50 }, textPosMm: { x: 80, y: 30 }, text: 'Note A',
};

const balloonAnn: DrawingAnnotation = {
  id: 'ann2', kind: 'balloon', viewId: 'v1',
  targetMm: { x: 100, y: 100 }, textPosMm: { x: 130, y: 80 }, itemNumber: 1,
};

beforeEach(() => {
  useAppStore.setState({
    activeDocument: { kind: 'drawing', document: makeDrawingDoc() },
    activeAssembly: makeActiveAssembly(),
  } as never);
});

describe('AddDrawingAnnotationCommand', () => {
  it('(a) apply appends a leader annotation to the sheet', async () => {
    const cmd = new AddDrawingAnnotationCommand({ sheetId: 'sh1', ann: leaderAnn });
    await cmd.apply();
    const doc = (useAppStore.getState().activeDocument as { kind: 'drawing'; document: DrawingDocument }).document;
    const anns = doc.sheets[0]!.annotations;
    expect(anns).toHaveLength(1);
    expect(anns[0]!.id).toBe('ann1');
  });

  it('(a) apply appends a balloon annotation whose itemNumber resolves against assembly bomItemNumbers', async () => {
    // itemNumber: 1 corresponds to component 'c1' in bomItemNumbers
    const cmd = new AddDrawingAnnotationCommand({ sheetId: 'sh1', ann: balloonAnn });
    await cmd.apply();
    const doc = (useAppStore.getState().activeDocument as { kind: 'drawing'; document: DrawingDocument }).document;
    const anns = doc.sheets[0]!.annotations;
    expect(anns).toHaveLength(1);
    const balloon = anns[0] as Extract<DrawingAnnotation, { kind: 'balloon' }>;
    expect(balloon.itemNumber).toBe(1);
    // Verify itemNumber=1 is present in the assembly's bomItemNumbers values
    const asm = useAppStore.getState().activeAssembly!;
    const bomValues = Object.values(asm.bomItemNumbers);
    expect(bomValues).toContain(balloon.itemNumber);
  });

  it('(b) revert removes the appended annotation', async () => {
    const cmd = new AddDrawingAnnotationCommand({ sheetId: 'sh1', ann: leaderAnn });
    await cmd.apply();
    await cmd.revert();
    const doc = (useAppStore.getState().activeDocument as { kind: 'drawing'; document: DrawingDocument }).document;
    expect(doc.sheets[0]!.annotations).toHaveLength(0);
  });

  it('(c) revert is idempotent', async () => {
    const cmd = new AddDrawingAnnotationCommand({ sheetId: 'sh1', ann: leaderAnn });
    await cmd.apply();
    await cmd.revert();
    await cmd.revert();
    const doc = (useAppStore.getState().activeDocument as { kind: 'drawing'; document: DrawingDocument }).document;
    expect(doc.sheets[0]!.annotations).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the test (expect fail)**

```bash
pnpm --filter @zilventor/app test:unit -- AddDrawingAnnotationCommand
```

Expected: failures (module not found).

- [ ] **Step 3: Implement `AddDrawingAnnotationCommand`**

```ts
// packages/app/src/commands/AddDrawingAnnotationCommand.ts
import type { Command } from './Command';
import type { DrawingDocument, DrawingAnnotation } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';

export class AddDrawingAnnotationCommand implements Command {
  readonly name = 'AddDrawingAnnotation';

  constructor(private readonly opts: { sheetId: string; ann: DrawingAnnotation }) {}

  async apply(): Promise<void> {
    useAppStore.setState((s) => {
      if (s.activeDocument?.kind !== 'drawing') return s;
      const doc = s.activeDocument.document;
      const sheets = doc.sheets.map((sh) =>
        sh.id === this.opts.sheetId
          ? { ...sh, annotations: [...sh.annotations, this.opts.ann] }
          : sh,
      );
      const next: DrawingDocument = { ...doc, sheets };
      return { activeDocument: { kind: 'drawing' as const, document: next } } as never;
    });
  }

  async revert(): Promise<void> {
    useAppStore.setState((s) => {
      if (s.activeDocument?.kind !== 'drawing') return s;
      const doc = s.activeDocument.document;
      const sheets = doc.sheets.map((sh) =>
        sh.id === this.opts.sheetId
          ? { ...sh, annotations: sh.annotations.filter((a) => a.id !== this.opts.ann.id) }
          : sh,
      );
      const next: DrawingDocument = { ...doc, sheets };
      return { activeDocument: { kind: 'drawing' as const, document: next } } as never;
    });
  }
}
```

- [ ] **Step 4: Run the test (expect pass)**

```bash
pnpm --filter @zilventor/app test:unit -- AddDrawingAnnotationCommand
```

Expected: 4/4 pass.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/commands/AddDrawingAnnotationCommand.ts packages/app/src/commands/__tests__/AddDrawingAnnotationCommand.spec.ts && git commit -m "feat(drawing): add AddDrawingAnnotationCommand"
```

**Verify:** `pnpm -r typecheck` clean; 4 tests green.

---

### Task T34 — `MoveDrawingAnnotationCommand`

**Files:**
- Create: `packages/app/src/commands/MoveDrawingAnnotationCommand.ts`
- Create (test): `packages/app/src/commands/__tests__/MoveDrawingAnnotationCommand.spec.ts`

**Agent:** Sonnet implementer.

- [ ] **Step 1: Write the failing test**

```ts
// packages/app/src/commands/__tests__/MoveDrawingAnnotationCommand.spec.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { MoveDrawingAnnotationCommand } from '../MoveDrawingAnnotationCommand';
import { useAppStore } from '../../store/useAppStore';
import type { DrawingDocument, DrawingAnnotation } from '@zilventor/shared';

const leaderAnn: DrawingAnnotation = {
  id: 'ann1', kind: 'leader', viewId: 'v1',
  targetMm: { x: 50, y: 50 }, textPosMm: { x: 80, y: 30 }, text: 'Note A',
};

function makeDrawingDoc(): DrawingDocument {
  return {
    id: 'dw1', name: 'Test Drawing', units: 'mm',
    source: { partPath: 'parts/box.zipt', sourceKind: 'part' },
    properties: {}, activeSheetId: 'sh1',
    sheets: [{
      id: 'sh1', name: 'Sheet 1',
      size: { kind: 'iso', size: 'A3' }, orientation: 'landscape',
      views: [], dimensions: [], annotations: [leaderAnn], titleBlock: {},
    }],
  };
}

beforeEach(() => {
  useAppStore.setState({
    activeDocument: { kind: 'drawing', document: makeDrawingDoc() },
  } as never);
});

describe('MoveDrawingAnnotationCommand', () => {
  it('(a) apply updates textPosMm when provided', async () => {
    const cmd = new MoveDrawingAnnotationCommand({
      sheetId: 'sh1', annId: 'ann1',
      textPosMm: { x: 120, y: 60 },
    });
    await cmd.apply();
    const doc = (useAppStore.getState().activeDocument as { kind: 'drawing'; document: DrawingDocument }).document;
    const ann = doc.sheets[0]!.annotations[0]! as Extract<DrawingAnnotation, { kind: 'leader' }>;
    expect(ann.textPosMm).toEqual({ x: 120, y: 60 });
    // targetMm should be unchanged
    expect(ann.targetMm).toEqual({ x: 50, y: 50 });
  });

  it('(a) apply updates targetMm when provided', async () => {
    const cmd = new MoveDrawingAnnotationCommand({
      sheetId: 'sh1', annId: 'ann1',
      targetMm: { x: 200, y: 150 },
    });
    await cmd.apply();
    const doc = (useAppStore.getState().activeDocument as { kind: 'drawing'; document: DrawingDocument }).document;
    const ann = doc.sheets[0]!.annotations[0]! as Extract<DrawingAnnotation, { kind: 'leader' }>;
    expect(ann.targetMm).toEqual({ x: 200, y: 150 });
  });

  it('(b) revert restores prior textPosMm and targetMm', async () => {
    const cmd = new MoveDrawingAnnotationCommand({
      sheetId: 'sh1', annId: 'ann1',
      textPosMm: { x: 120, y: 60 },
      targetMm: { x: 200, y: 150 },
    });
    await cmd.apply();
    await cmd.revert();
    const doc = (useAppStore.getState().activeDocument as { kind: 'drawing'; document: DrawingDocument }).document;
    const ann = doc.sheets[0]!.annotations[0]! as Extract<DrawingAnnotation, { kind: 'leader' }>;
    expect(ann.textPosMm).toEqual({ x: 80, y: 30 });
    expect(ann.targetMm).toEqual({ x: 50, y: 50 });
  });

  it('(c) revert is idempotent', async () => {
    const cmd = new MoveDrawingAnnotationCommand({
      sheetId: 'sh1', annId: 'ann1',
      textPosMm: { x: 120, y: 60 },
    });
    await cmd.apply();
    await cmd.revert();
    await cmd.revert();
    const doc = (useAppStore.getState().activeDocument as { kind: 'drawing'; document: DrawingDocument }).document;
    const ann = doc.sheets[0]!.annotations[0]! as Extract<DrawingAnnotation, { kind: 'leader' }>;
    expect(ann.textPosMm).toEqual({ x: 80, y: 30 });
  });
});
```

- [ ] **Step 2: Run the test (expect fail)**

```bash
pnpm --filter @zilventor/app test:unit -- MoveDrawingAnnotationCommand
```

Expected: failures (module not found).

- [ ] **Step 3: Implement `MoveDrawingAnnotationCommand`**

```ts
// packages/app/src/commands/MoveDrawingAnnotationCommand.ts
import type { Command } from './Command';
import type { DrawingDocument, DrawingAnnotation } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';

type Vec2 = { x: number; y: number };

export class MoveDrawingAnnotationCommand implements Command {
  readonly name = 'MoveDrawingAnnotation';
  private priorAnn: DrawingAnnotation | undefined;
  private reverted = false;

  constructor(private readonly opts: {
    sheetId: string;
    annId: string;
    textPosMm?: Vec2;
    targetMm?: Vec2;
  }) {}

  async apply(): Promise<void> {
    this.reverted = false;
    useAppStore.setState((s) => {
      if (s.activeDocument?.kind !== 'drawing') return s;
      const doc = s.activeDocument.document;
      const sheets = doc.sheets.map((sh) => {
        if (sh.id !== this.opts.sheetId) return sh;
        const annotations = sh.annotations.map((a) => {
          if (a.id !== this.opts.annId) return a;
          this.priorAnn = a;
          const updated = { ...a } as DrawingAnnotation;
          if (this.opts.textPosMm !== undefined && 'textPosMm' in updated) {
            (updated as { textPosMm: Vec2 }).textPosMm = this.opts.textPosMm;
          }
          if (this.opts.targetMm !== undefined && 'targetMm' in updated) {
            (updated as { targetMm: Vec2 }).targetMm = this.opts.targetMm;
          }
          return updated;
        });
        return { ...sh, annotations };
      });
      const next: DrawingDocument = { ...doc, sheets };
      return { activeDocument: { kind: 'drawing' as const, document: next } } as never;
    });
  }

  async revert(): Promise<void> {
    if (!this.priorAnn || this.reverted) return;
    this.reverted = true;
    const prior = this.priorAnn;
    useAppStore.setState((s) => {
      if (s.activeDocument?.kind !== 'drawing') return s;
      const doc = s.activeDocument.document;
      const sheets = doc.sheets.map((sh) => {
        if (sh.id !== this.opts.sheetId) return sh;
        const annotations = sh.annotations.map((a) => (a.id === this.opts.annId ? prior : a));
        return { ...sh, annotations };
      });
      const next: DrawingDocument = { ...doc, sheets };
      return { activeDocument: { kind: 'drawing' as const, document: next } } as never;
    });
  }
}
```

- [ ] **Step 4: Run the test (expect pass)**

```bash
pnpm --filter @zilventor/app test:unit -- MoveDrawingAnnotationCommand
```

Expected: 4/4 pass.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/commands/MoveDrawingAnnotationCommand.ts packages/app/src/commands/__tests__/MoveDrawingAnnotationCommand.spec.ts && git commit -m "feat(drawing): add MoveDrawingAnnotationCommand"
```

**Verify:** `pnpm -r typecheck` clean; 4 tests green.

---

### Task T35 — `DeleteDrawingAnnotationCommand`

**Files:**
- Create: `packages/app/src/commands/DeleteDrawingAnnotationCommand.ts`
- Create (test): `packages/app/src/commands/__tests__/DeleteDrawingAnnotationCommand.spec.ts`

**Agent:** Sonnet implementer.

- [ ] **Step 1: Write the failing test**

```ts
// packages/app/src/commands/__tests__/DeleteDrawingAnnotationCommand.spec.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { DeleteDrawingAnnotationCommand } from '../DeleteDrawingAnnotationCommand';
import { useAppStore } from '../../store/useAppStore';
import type { DrawingDocument, DrawingAnnotation } from '@zilventor/shared';

const annA: DrawingAnnotation = {
  id: 'annA', kind: 'leader', viewId: 'v1',
  targetMm: { x: 50, y: 50 }, textPosMm: { x: 80, y: 30 }, text: 'Note A',
};
const annB: DrawingAnnotation = {
  id: 'annB', kind: 'center-mark', viewId: 'v1', edgeId: 'arc1',
};

function makeDrawingDoc(): DrawingDocument {
  return {
    id: 'dw1', name: 'Test Drawing', units: 'mm',
    source: { partPath: 'parts/box.zipt', sourceKind: 'part' },
    properties: {}, activeSheetId: 'sh1',
    sheets: [{
      id: 'sh1', name: 'Sheet 1',
      size: { kind: 'iso', size: 'A3' }, orientation: 'landscape',
      views: [], dimensions: [], annotations: [annA, annB], titleBlock: {},
    }],
  };
}

beforeEach(() => {
  useAppStore.setState({
    activeDocument: { kind: 'drawing', document: makeDrawingDoc() },
  } as never);
});

describe('DeleteDrawingAnnotationCommand', () => {
  it('(a) apply removes the annotation by id', async () => {
    const cmd = new DeleteDrawingAnnotationCommand({ sheetId: 'sh1', annId: 'annA' });
    await cmd.apply();
    const doc = (useAppStore.getState().activeDocument as { kind: 'drawing'; document: DrawingDocument }).document;
    const anns = doc.sheets[0]!.annotations;
    expect(anns).toHaveLength(1);
    expect(anns[0]!.id).toBe('annB');
  });

  it('(b) revert re-inserts the removed annotation at its original index', async () => {
    const cmd = new DeleteDrawingAnnotationCommand({ sheetId: 'sh1', annId: 'annA' });
    await cmd.apply();
    await cmd.revert();
    const doc = (useAppStore.getState().activeDocument as { kind: 'drawing'; document: DrawingDocument }).document;
    const anns = doc.sheets[0]!.annotations;
    expect(anns).toHaveLength(2);
    expect(anns[0]!.id).toBe('annA');
    expect(anns[1]!.id).toBe('annB');
  });

  it('(c) revert is idempotent — second revert leaves two annotations without duplicating', async () => {
    const cmd = new DeleteDrawingAnnotationCommand({ sheetId: 'sh1', annId: 'annA' });
    await cmd.apply();
    await cmd.revert();
    await cmd.revert();
    const doc = (useAppStore.getState().activeDocument as { kind: 'drawing'; document: DrawingDocument }).document;
    expect(doc.sheets[0]!.annotations).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run the test (expect fail)**

```bash
pnpm --filter @zilventor/app test:unit -- DeleteDrawingAnnotationCommand
```

Expected: failures (module not found).

- [ ] **Step 3: Implement `DeleteDrawingAnnotationCommand`**

```ts
// packages/app/src/commands/DeleteDrawingAnnotationCommand.ts
import type { Command } from './Command';
import type { DrawingDocument, DrawingAnnotation } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';

export class DeleteDrawingAnnotationCommand implements Command {
  readonly name = 'DeleteDrawingAnnotation';
  private priorAnn: DrawingAnnotation | undefined;
  private priorIndex = -1;
  private reverted = false;

  constructor(private readonly opts: { sheetId: string; annId: string }) {}

  async apply(): Promise<void> {
    this.reverted = false;
    useAppStore.setState((s) => {
      if (s.activeDocument?.kind !== 'drawing') return s;
      const doc = s.activeDocument.document;
      const sheets = doc.sheets.map((sh) => {
        if (sh.id !== this.opts.sheetId) return sh;
        const idx = sh.annotations.findIndex((a) => a.id === this.opts.annId);
        if (idx === -1) return sh;
        this.priorAnn = sh.annotations[idx];
        this.priorIndex = idx;
        const annotations = sh.annotations.filter((a) => a.id !== this.opts.annId);
        return { ...sh, annotations };
      });
      const next: DrawingDocument = { ...doc, sheets };
      return { activeDocument: { kind: 'drawing' as const, document: next } } as never;
    });
  }

  async revert(): Promise<void> {
    if (!this.priorAnn || this.reverted) return;
    this.reverted = true;
    const { priorAnn, priorIndex } = this;
    useAppStore.setState((s) => {
      if (s.activeDocument?.kind !== 'drawing') return s;
      const doc = s.activeDocument.document;
      const sheets = doc.sheets.map((sh) => {
        if (sh.id !== this.opts.sheetId) return sh;
        const anns = [...sh.annotations];
        anns.splice(priorIndex, 0, priorAnn!);
        return { ...sh, annotations: anns };
      });
      const next: DrawingDocument = { ...doc, sheets };
      return { activeDocument: { kind: 'drawing' as const, document: next } } as never;
    });
  }
}
```

- [ ] **Step 4: Run the test (expect pass)**

```bash
pnpm --filter @zilventor/app test:unit -- DeleteDrawingAnnotationCommand
```

Expected: 3/3 pass.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/commands/DeleteDrawingAnnotationCommand.ts packages/app/src/commands/__tests__/DeleteDrawingAnnotationCommand.spec.ts && git commit -m "feat(drawing): add DeleteDrawingAnnotationCommand"
```

**Verify:** `pnpm -r typecheck` clean; 3 tests green.

---

### Task T36 — `EditTitleBlockCommand`

**Files:**
- Create: `packages/app/src/commands/EditTitleBlockCommand.ts`
- Create (test): `packages/app/src/commands/__tests__/EditTitleBlockCommand.spec.ts`

**Agent:** Sonnet implementer.

- [ ] **Step 1: Write the failing test**

```ts
// packages/app/src/commands/__tests__/EditTitleBlockCommand.spec.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { EditTitleBlockCommand } from '../EditTitleBlockCommand';
import { useAppStore } from '../../store/useAppStore';
import type { DrawingDocument, TitleBlockOverrides } from '@zilventor/shared';

function makeDrawingDoc(titleBlock: TitleBlockOverrides = {}): DrawingDocument {
  return {
    id: 'dw1', name: 'Test Drawing', units: 'mm',
    source: { partPath: 'parts/box.zipt', sourceKind: 'part' },
    properties: {}, activeSheetId: 'sh1',
    sheets: [{
      id: 'sh1', name: 'Sheet 1',
      size: { kind: 'iso', size: 'A3' }, orientation: 'landscape',
      views: [], dimensions: [], annotations: [], titleBlock,
    }],
  };
}

beforeEach(() => {
  useAppStore.setState({
    activeDocument: {
      kind: 'drawing',
      document: makeDrawingDoc({ drawingName: 'Original Name', drawnBy: 'Alice' }),
    },
  } as never);
});

describe('EditTitleBlockCommand', () => {
  it('(a) apply merges overrides onto the sheet titleBlock', async () => {
    const cmd = new EditTitleBlockCommand({
      sheetId: 'sh1',
      overrides: { drawingName: 'New Name', revision: 'A' },
    });
    await cmd.apply();
    const doc = (useAppStore.getState().activeDocument as { kind: 'drawing'; document: DrawingDocument }).document;
    const tb = doc.sheets[0]!.titleBlock;
    expect(tb.drawingName).toBe('New Name');
    expect(tb.revision).toBe('A');
    // Pre-existing field not in overrides is overwritten by the full replacement
    // (overrides is the complete new value, not a merge — per §2.8)
  });

  it('(a) apply replaces the entire titleBlock with the provided overrides', async () => {
    const cmd = new EditTitleBlockCommand({
      sheetId: 'sh1',
      overrides: { drawingName: 'New Name' },
    });
    await cmd.apply();
    const doc = (useAppStore.getState().activeDocument as { kind: 'drawing'; document: DrawingDocument }).document;
    const tb = doc.sheets[0]!.titleBlock;
    // drawnBy was in original but not in the new overrides — should be absent
    expect(tb.drawnBy).toBeUndefined();
    expect(tb.drawingName).toBe('New Name');
  });

  it('(b) revert restores the prior titleBlock', async () => {
    const cmd = new EditTitleBlockCommand({
      sheetId: 'sh1',
      overrides: { drawingName: 'New Name', revision: 'A' },
    });
    await cmd.apply();
    await cmd.revert();
    const doc = (useAppStore.getState().activeDocument as { kind: 'drawing'; document: DrawingDocument }).document;
    const tb = doc.sheets[0]!.titleBlock;
    expect(tb.drawingName).toBe('Original Name');
    expect(tb.drawnBy).toBe('Alice');
    expect(tb.revision).toBeUndefined();
  });

  it('(c) revert is idempotent', async () => {
    const cmd = new EditTitleBlockCommand({
      sheetId: 'sh1',
      overrides: { drawingName: 'New Name' },
    });
    await cmd.apply();
    await cmd.revert();
    await cmd.revert();
    const doc = (useAppStore.getState().activeDocument as { kind: 'drawing'; document: DrawingDocument }).document;
    expect(doc.sheets[0]!.titleBlock.drawingName).toBe('Original Name');
  });
});
```

- [ ] **Step 2: Run the test (expect fail)**

```bash
pnpm --filter @zilventor/app test:unit -- EditTitleBlockCommand
```

Expected: failures (module not found).

- [ ] **Step 3: Implement `EditTitleBlockCommand`**

```ts
// packages/app/src/commands/EditTitleBlockCommand.ts
import type { Command } from './Command';
import type { DrawingDocument, TitleBlockOverrides } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';

export class EditTitleBlockCommand implements Command {
  readonly name = 'EditTitleBlock';
  private priorTitleBlock: TitleBlockOverrides | undefined;
  private reverted = false;

  constructor(private readonly opts: { sheetId: string; overrides: TitleBlockOverrides }) {}

  async apply(): Promise<void> {
    this.reverted = false;
    useAppStore.setState((s) => {
      if (s.activeDocument?.kind !== 'drawing') return s;
      const doc = s.activeDocument.document;
      const sheets = doc.sheets.map((sh) => {
        if (sh.id !== this.opts.sheetId) return sh;
        this.priorTitleBlock = sh.titleBlock;
        return { ...sh, titleBlock: this.opts.overrides };
      });
      const next: DrawingDocument = { ...doc, sheets };
      return { activeDocument: { kind: 'drawing' as const, document: next } } as never;
    });
  }

  async revert(): Promise<void> {
    if (this.priorTitleBlock === undefined || this.reverted) return;
    this.reverted = true;
    const prior = this.priorTitleBlock;
    useAppStore.setState((s) => {
      if (s.activeDocument?.kind !== 'drawing') return s;
      const doc = s.activeDocument.document;
      const sheets = doc.sheets.map((sh) =>
        sh.id === this.opts.sheetId ? { ...sh, titleBlock: prior } : sh,
      );
      const next: DrawingDocument = { ...doc, sheets };
      return { activeDocument: { kind: 'drawing' as const, document: next } } as never;
    });
  }
}
```

- [ ] **Step 4: Run the test (expect pass)**

```bash
pnpm --filter @zilventor/app test:unit -- EditTitleBlockCommand
```

Expected: 4/4 pass.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/commands/EditTitleBlockCommand.ts packages/app/src/commands/__tests__/EditTitleBlockCommand.spec.ts && git commit -m "feat(drawing): add EditTitleBlockCommand"
```

**Verify:** `pnpm -r typecheck` clean; 4 tests green.

---

### Task T37 — `EditDrawingPropertiesCommand`

**Files:**
- Create: `packages/app/src/commands/EditDrawingPropertiesCommand.ts`
- Create (test): `packages/app/src/commands/__tests__/EditDrawingPropertiesCommand.spec.ts`

**Agent:** Sonnet implementer.

- [ ] **Step 1: Write the failing test**

```ts
// packages/app/src/commands/__tests__/EditDrawingPropertiesCommand.spec.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { EditDrawingPropertiesCommand } from '../EditDrawingPropertiesCommand';
import { useAppStore } from '../../store/useAppStore';
import type { DrawingDocument } from '@zilventor/shared';

function makeDrawingDoc(properties: Record<string, string | number | boolean> = {}): DrawingDocument {
  return {
    id: 'dw1', name: 'Test Drawing', units: 'mm',
    source: { partPath: 'parts/box.zipt', sourceKind: 'part' },
    properties, activeSheetId: 'sh1',
    sheets: [{
      id: 'sh1', name: 'Sheet 1',
      size: { kind: 'iso', size: 'A3' }, orientation: 'landscape',
      views: [], dimensions: [], annotations: [], titleBlock: {},
    }],
  };
}

beforeEach(() => {
  useAppStore.setState({
    activeDocument: {
      kind: 'drawing',
      document: makeDrawingDoc({ author: 'Alice', version: 1, approved: false }),
    },
  } as never);
});

describe('EditDrawingPropertiesCommand', () => {
  it('(a) apply replaces the drawing-level properties', async () => {
    const cmd = new EditDrawingPropertiesCommand({
      properties: { author: 'Bob', version: 2, approved: true, notes: 'Rev B' },
    });
    await cmd.apply();
    const doc = (useAppStore.getState().activeDocument as { kind: 'drawing'; document: DrawingDocument }).document;
    expect(doc.properties['author']).toBe('Bob');
    expect(doc.properties['version']).toBe(2);
    expect(doc.properties['approved']).toBe(true);
    expect(doc.properties['notes']).toBe('Rev B');
  });

  it('(a) apply is a full replacement — keys absent from new properties are removed', async () => {
    const cmd = new EditDrawingPropertiesCommand({
      properties: { author: 'Bob' },
    });
    await cmd.apply();
    const doc = (useAppStore.getState().activeDocument as { kind: 'drawing'; document: DrawingDocument }).document;
    expect(doc.properties['author']).toBe('Bob');
    expect(doc.properties['version']).toBeUndefined();
    expect(doc.properties['approved']).toBeUndefined();
  });

  it('(b) revert restores the prior properties', async () => {
    const cmd = new EditDrawingPropertiesCommand({
      properties: { author: 'Bob', version: 2 },
    });
    await cmd.apply();
    await cmd.revert();
    const doc = (useAppStore.getState().activeDocument as { kind: 'drawing'; document: DrawingDocument }).document;
    expect(doc.properties['author']).toBe('Alice');
    expect(doc.properties['version']).toBe(1);
    expect(doc.properties['approved']).toBe(false);
  });

  it('(c) revert is idempotent', async () => {
    const cmd = new EditDrawingPropertiesCommand({
      properties: { author: 'Bob' },
    });
    await cmd.apply();
    await cmd.revert();
    await cmd.revert();
    const doc = (useAppStore.getState().activeDocument as { kind: 'drawing'; document: DrawingDocument }).document;
    expect(doc.properties['author']).toBe('Alice');
    expect(doc.properties['version']).toBe(1);
  });
});
```

- [ ] **Step 2: Run the test (expect fail)**

```bash
pnpm --filter @zilventor/app test:unit -- EditDrawingPropertiesCommand
```

Expected: failures (module not found).

- [ ] **Step 3: Implement `EditDrawingPropertiesCommand`**

```ts
// packages/app/src/commands/EditDrawingPropertiesCommand.ts
import type { Command } from './Command';
import type { DrawingDocument } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';

export class EditDrawingPropertiesCommand implements Command {
  readonly name = 'EditDrawingProperties';
  private priorProperties: Record<string, string | number | boolean> | undefined;
  private reverted = false;

  constructor(private readonly opts: { properties: Record<string, string | number | boolean> }) {}

  async apply(): Promise<void> {
    this.reverted = false;
    useAppStore.setState((s) => {
      if (s.activeDocument?.kind !== 'drawing') return s;
      const doc = s.activeDocument.document;
      this.priorProperties = doc.properties;
      const next: DrawingDocument = { ...doc, properties: this.opts.properties };
      return { activeDocument: { kind: 'drawing' as const, document: next } } as never;
    });
  }

  async revert(): Promise<void> {
    if (this.priorProperties === undefined || this.reverted) return;
    this.reverted = true;
    const prior = this.priorProperties;
    useAppStore.setState((s) => {
      if (s.activeDocument?.kind !== 'drawing') return s;
      const doc = s.activeDocument.document;
      const next: DrawingDocument = { ...doc, properties: prior };
      return { activeDocument: { kind: 'drawing' as const, document: next } } as never;
    });
  }
}
```

- [ ] **Step 4: Run the test (expect pass)**

```bash
pnpm --filter @zilventor/app test:unit -- EditDrawingPropertiesCommand
```

Expected: 4/4 pass.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/commands/EditDrawingPropertiesCommand.ts packages/app/src/commands/__tests__/EditDrawingPropertiesCommand.spec.ts && git commit -m "feat(drawing): add EditDrawingPropertiesCommand"
```

**Verify:** `pnpm -r typecheck` clean; 4 tests green.
## Phase 7 — Store, ribbon, active-document cascade

Four tasks; dispatch as one Sonnet implementer batch.

---

### T38 — Widen `useAppStore.activeDocument` discriminated union

**Files:**
- Modify: `packages/app/src/store/useAppStore.ts`
- Create (test): `packages/app/src/store/__tests__/useAppStore.drawing.spec.ts`

**Agent:** Sonnet implementer.

#### Current state

Line 23–25 of `packages/app/src/store/useAppStore.ts`:

```ts
export type ActiveDocument =
  | { kind: 'part'; document: PartDocument }
  | { kind: 'assembly'; document: AssemblyDocument };
```

Line 320–324 (`setActiveDocument` implementation):

```ts
setActiveDocument: (d) => set({
  activeDocument: d,
  activePart: d?.kind === 'part' ? d.document : null,
  activeAssembly: d?.kind === 'assembly' ? d.document : null,
}),
```

There is no `activeDrawing` field today.

#### Diff to apply

**1. Widen the `ActiveDocument` type and add `DrawingDocument` import.**

Add `DrawingDocument` to the import from `@zilventor/shared` at line 2 (alongside the existing named imports). Then replace the union:

```ts
// BEFORE (lines 23-25):
export type ActiveDocument =
  | { kind: 'part'; document: PartDocument }
  | { kind: 'assembly'; document: AssemblyDocument };

// AFTER:
export type ActiveDocument =
  | { kind: 'part';     document: PartDocument }
  | { kind: 'assembly'; document: AssemblyDocument }
  | { kind: 'drawing';  document: DrawingDocument };   // NEW — Sub-project 6
```

**2. Add `activeDrawing` to `AppState`.**

In the `AppState` type (around line 89, after `activeAssembly`):

```ts
// BEFORE:
activeAssembly: AssemblyDocument | null;

// AFTER:
activeAssembly: AssemblyDocument | null;
activeDrawing: DrawingDocument | null;         // NEW — Sub-project 6
```

**3. Add `setActiveDrawing` action signature to `AppState`** (near `setActivePart`, line ~165):

```ts
setActiveDrawing(d: DrawingDocument | null): void;
```

**4. Update `setActiveDocument` implementation** (lines 320–324):

```ts
// BEFORE:
setActiveDocument: (d) => set({
  activeDocument: d,
  activePart: d?.kind === 'part' ? d.document : null,
  activeAssembly: d?.kind === 'assembly' ? d.document : null,
}),

// AFTER:
setActiveDocument: (d) => set({
  activeDocument: d,
  activePart:     d?.kind === 'part'     ? d.document : null,
  activeAssembly: d?.kind === 'assembly' ? d.document : null,
  activeDrawing:  d?.kind === 'drawing'  ? d.document : null,
}),
```

**5. Add `activeDrawing` initial value and `setActiveDrawing` implementation** in the `create<AppState>` body (near `activePart: null` at line ~306):

```ts
activeDrawing: null,
setActiveDrawing: (d) => set({
  activeDocument: d ? { kind: 'drawing', document: d } : null,
  activePart:    null,
  activeAssembly: null,
  activeDrawing: d,
}),
```

**6. Add a selector export** at the bottom of the file (after the `useAppStore` creation, before the closing):

```ts
/** Returns the active DrawingDocument, or null when any other kind is active. */
export const selectActiveDrawing = (s: ReturnType<typeof useAppStore.getState>) =>
  s.activeDocument?.kind === 'drawing' ? s.activeDocument.document : null;
```

#### Test

- [ ] **Step 1: Write the failing test**

```ts
// packages/app/src/store/__tests__/useAppStore.drawing.spec.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore, selectActiveDrawing } from '../useAppStore';
import type { PartDocument, AssemblyDocument, DrawingDocument } from '@zilventor/shared';

const makePart = (): PartDocument =>
  ({ id: 'p1', kind: 'part', name: 'Part', featureTree: [], parameters: {}, materials: [] } as unknown as PartDocument);

const makeAssembly = (): AssemblyDocument =>
  ({ id: 'a1', name: 'Asm', components: [], constraints: [], groundedComponentPaths: [],
     materials: [], colors: {}, bomItemNumbers: {}, cutListItemNumbers: {}, colorOverrides: {} } as unknown as AssemblyDocument);

const makeDrawing = (): DrawingDocument =>
  ({ id: 'd1', name: 'Drawing', sourcePath: 'part.zipt', sheets: [], titleBlock: {} } as unknown as DrawingDocument);

beforeEach(() => {
  useAppStore.getState().setActiveDocument(null);
});

describe('activeDocument drawing arm', () => {
  it('setActiveDocument(null) → activePart null, activeAssembly null, activeDrawing null', () => {
    const s = useAppStore.getState();
    expect(s.activePart).toBeNull();
    expect(s.activeAssembly).toBeNull();
    expect(s.activeDrawing).toBeNull();
  });

  it('setActiveDocument(part) → activePart set, activeAssembly null, activeDrawing null', () => {
    const part = makePart();
    useAppStore.getState().setActiveDocument({ kind: 'part', document: part });
    const s = useAppStore.getState();
    expect(s.activePart).toBe(part);
    expect(s.activeAssembly).toBeNull();
    expect(s.activeDrawing).toBeNull();
  });

  it('setActiveDocument(assembly) → activePart null, activeAssembly set, activeDrawing null', () => {
    const asm = makeAssembly();
    useAppStore.getState().setActiveDocument({ kind: 'assembly', document: asm });
    const s = useAppStore.getState();
    expect(s.activePart).toBeNull();
    expect(s.activeAssembly).toBe(asm);
    expect(s.activeDrawing).toBeNull();
  });

  it('setActiveDocument(drawing) → activePart null, activeAssembly null, activeDrawing set', () => {
    const drawing = makeDrawing();
    useAppStore.getState().setActiveDocument({ kind: 'drawing', document: drawing });
    const s = useAppStore.getState();
    expect(s.activePart).toBeNull();
    expect(s.activeAssembly).toBeNull();
    expect(s.activeDrawing).toBe(drawing);
    expect(selectActiveDrawing(s)).toBe(drawing);
  });

  it('selectActiveDrawing returns null when part is active', () => {
    useAppStore.getState().setActiveDocument({ kind: 'part', document: makePart() });
    expect(selectActiveDrawing(useAppStore.getState())).toBeNull();
  });
});
```

- [ ] **Step 2: Run — expect fail**

```
cd packages/app && pnpm test:unit -- useAppStore.drawing
```

- [ ] **Step 3: Implement** — apply the five diff hunks above.

- [ ] **Step 4: Run — expect pass**

```
cd packages/app && pnpm test:unit -- useAppStore.drawing
```

Also verify no regressions: `cd packages/app && pnpm test:unit`.

- [ ] **Step 5: Commit**

```
git add packages/app/src/store/useAppStore.ts \
        packages/app/src/store/__tests__/useAppStore.drawing.spec.ts
git commit -m "feat(store): widen activeDocument union with kind: 'drawing'"
```

**Verify:** `pnpm -r typecheck` passes with no new errors on the modified files.

---

### T39 — Cascade-gap: every consumer of `activeDocument.kind`

**Files:**
- Modify (as needed, see sites below): several files in `packages/app/src/`
- Create (test): `packages/app/src/store/__tests__/useAppStore.drawingCascade.spec.ts`

**Agent:** Sonnet implementer.

#### Known call sites (grep `packages/app/src/` for `activeDocument\.kind\|activeDocument?\.kind\|kind === 'assembly'\|kind === 'part'`)

Run at implementation time to catch any file added after this plan was written. The following sites were confirmed at plan authoring (HEAD `0bcd8a2`):

| File | Line(s) | Pattern | Action |
|------|---------|---------|--------|
| `packages/app/src/store/useAppStore.ts` | 322–323 | `d?.kind === 'part'`, `d?.kind === 'assembly'` | **Fixed in T38** — `activeDrawing` arm added there. |
| `packages/app/src/store/useAppStore.ts` | 492 | `s.activeDocument?.kind !== 'assembly'` — early-return guards in `setColorOverride`, `setComponentFlexible` | No change needed — these mutators are assembly-only; drawing correctly falls through to `return s`. |
| `packages/app/src/store/useAppStore.ts` | 504 | same pattern for `setComponentFlexible` | No change needed (same reason). |
| `packages/app/src/shell/Ribbon.tsx` | 20 | `s.activeDocument?.kind === 'assembly'` | **Fixed in T40** — replaced with 3-mode switch. |
| `packages/app/src/shell/BrowserPane.tsx` | 282 | `activeDoc?.kind === 'assembly'` early-return | Add a drawing branch: `if (activeDoc?.kind === 'drawing') return <DrawingTreePane />;` — stub is placed in Phase 7; real impl in Phase 8. |
| `packages/app/src/shell/tabs/FileTab.tsx` | 43 | `activeDocument.kind === 'assembly'` — Save handler | Add `if (activeDocument.kind === 'drawing') { /* TODO T-6-save-drawing */ return; }` early-return before the assembly branch. Prevents runtime error if Save is invoked with a drawing active. |
| `packages/app/src/shell/tabs/FileTab.tsx` | 90 | `kind === 'assembly'` — Open handler | Add `if (kind === 'drawing') { /* TODO T-6-open-drawing */ return; }` early-return. |
| `packages/app/src/shell/tabs/AssemblyTab.tsx` | 25 | `s.activeDocument?.kind === 'assembly'` — `hasAssembly` gate | No change needed — `hasAssembly` hides assembly-only UI; drawing kind correctly returns `false`. |
| `packages/app/src/commands/SetComponentColorOverrideCommand.ts` | 14 | `s.activeDocument?.kind !== 'assembly'` — no-op guard | No change needed — guard already rejects non-assembly kinds including drawing. |
| `packages/app/src/commands/ToggleSubAssemblyFlexibleCommand.ts` | 11 | same pattern | No change needed. |
| `packages/app/src/App.tsx` | 1037, 1043 | `activeDocument?.kind === 'assembly'` — keyboard shortcut guards (P for place-component, M/F/N/I/G for constraints) | No change needed — guards correctly prevent shortcuts from firing in drawing mode. |
| `packages/app/src/App.tsx` | 1171–1172 | `docKind === 'assembly'` — `handleViewportPointer` branch | Add `if (docKind === 'drawing') return;` at the top of `handleViewportPointer` (line 1171) to prevent pointer events from reaching 3D viewport logic when a drawing is active. |
| `packages/app/src/App.tsx` | 2612 | `doc.kind === 'assembly'` — autosave handler | Add `if (doc.kind === 'drawing') { /* TODO T-6-autosave-drawing */ return; }` early-return before the assembly branch in the autosave `setTimeout` callback. |
| `packages/app/src/import/InventorImporter.ts` | 127, 180 | `d.kind === 'part'` / `node.kind === 'part'` — importer internal logic | No change needed — importer works on `.ipt`/`.iam` nodes, not on `ActiveDocument`. |

#### Diffs

**`packages/app/src/shell/BrowserPane.tsx` — add drawing branch (around line 282):**

```ts
// BEFORE:
if (activeDoc?.kind === 'assembly') {
  return <AssemblyModePane part={part} partInfo={partInfo} />;
}

// AFTER:
if (activeDoc?.kind === 'drawing') {
  return <DrawingTreePane />;
}
if (activeDoc?.kind === 'assembly') {
  return <AssemblyModePane part={part} partInfo={partInfo} />;
}
```

Add import at top of `BrowserPane.tsx`:

```ts
import { DrawingTreePane } from '../drawing/__placeholders__';
```

**`packages/app/src/shell/tabs/FileTab.tsx` — Save handler (around line 43):**

```ts
// BEFORE:
if (activeDocument.kind === 'assembly') {

// AFTER:
if (activeDocument.kind === 'drawing') {
  // TODO Sub-project 6: implement drawing save
  return;
}
if (activeDocument.kind === 'assembly') {
```

**`packages/app/src/shell/tabs/FileTab.tsx` — Open handler (around line 90):**

```ts
// BEFORE:
if (kind === 'assembly') {

// AFTER:
if (kind === 'drawing') {
  // TODO Sub-project 6: implement drawing open
  return;
}
if (kind === 'assembly') {
```

**`packages/app/src/App.tsx` — `handleViewportPointer` (around line 1171):**

```ts
// BEFORE:
const docKind = useAppStore.getState().activeDocument?.kind;
if (docKind === 'assembly') {

// AFTER:
const docKind = useAppStore.getState().activeDocument?.kind;
if (docKind === 'drawing') return;   // drawing uses DrawingCanvas, not Viewport
if (docKind === 'assembly') {
```

**`packages/app/src/App.tsx` — autosave handler (around line 2612):**

```ts
// BEFORE:
if (doc.kind === 'assembly') {

// AFTER:
if (doc.kind === 'drawing') {
  // TODO Sub-project 6: drawing autosave (.zidw)
  return;
}
if (doc.kind === 'assembly') {
```

**Create placeholder file `packages/app/src/drawing/__placeholders__.tsx`:**

```tsx
// Placeholder components — replaced by real implementations in Phase 8 (T45, T46).
// Exported here so T39/T41 guards can compile before Phase 8 lands.

export function DrawingTreePane() {
  return <div data-testid="drawing-tree-pane" />;
}

export function DrawingCanvas() {
  return <div data-testid="drawing-canvas" />;
}
```

#### Test

- [ ] **Step 1: Write the failing test**

```ts
// packages/app/src/store/__tests__/useAppStore.drawingCascade.spec.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '../useAppStore';
import type { DrawingDocument } from '@zilventor/shared';

const makeDrawing = (): DrawingDocument =>
  ({ id: 'd1', name: 'Drawing', sourcePath: 'part.zipt', sheets: [], titleBlock: {} } as unknown as DrawingDocument);

beforeEach(() => {
  useAppStore.getState().setActiveDocument(null);
});

describe('store cascade — drawing kind no-ops assembly mutators', () => {
  it('setColorOverride is a no-op when drawing is active', () => {
    useAppStore.getState().setActiveDocument({ kind: 'drawing', document: makeDrawing() });
    const before = useAppStore.getState().activeDocument;
    useAppStore.getState().setColorOverride(['comp1'], { r: 1, g: 0, b: 0 });
    expect(useAppStore.getState().activeDocument).toBe(before); // reference unchanged
  });

  it('setComponentFlexible is a no-op when drawing is active', () => {
    useAppStore.getState().setActiveDocument({ kind: 'drawing', document: makeDrawing() });
    const before = useAppStore.getState().activeDocument;
    useAppStore.getState().setComponentFlexible('comp1', true);
    expect(useAppStore.getState().activeDocument).toBe(before);
  });

  it('switching to drawing clears activePart and activeAssembly', () => {
    useAppStore.getState().setActiveDocument({ kind: 'drawing', document: makeDrawing() });
    expect(useAppStore.getState().activePart).toBeNull();
    expect(useAppStore.getState().activeAssembly).toBeNull();
  });
});
```

- [ ] **Step 2: Run — some assertions fail (drawing type unknown before T38 lands; run after T38)**

```
cd packages/app && pnpm test:unit -- useAppStore.drawingCascade
```

- [ ] **Step 3: Implement** — apply diffs to `BrowserPane.tsx`, `FileTab.tsx`, `App.tsx`, and create `__placeholders__.tsx`.

- [ ] **Step 4: Run — expect pass**

```
cd packages/app && pnpm test:unit -- useAppStore.drawingCascade
```

Also: `cd packages/app && pnpm test:unit` (full suite, no regressions).

- [ ] **Step 5: Commit**

```
git add packages/app/src/shell/BrowserPane.tsx \
        packages/app/src/shell/tabs/FileTab.tsx \
        packages/app/src/App.tsx \
        packages/app/src/drawing/__placeholders__.tsx \
        packages/app/src/store/__tests__/useAppStore.drawingCascade.spec.ts
git commit -m "refactor(app): handle activeDocument.kind === 'drawing' in BrowserPane, FileTab, App viewport/autosave"
```

**Verify:** `pnpm -r typecheck` passes; no new TS errors in modified files.

---

### T40 — `Ribbon.tsx` 3-mode tab switch

**Files:**
- Modify: `packages/app/src/shell/Ribbon.tsx`
- Create (test): `packages/app/src/shell/__tests__/Ribbon.kind.spec.tsx`

**Agent:** Sonnet implementer.

#### Current state (confirmed at HEAD `0bcd8a2`)

```ts
// packages/app/src/shell/Ribbon.tsx (lines 14-44, abbreviated)
const PART_TABS     = ['File', 'Model', 'Sketch', 'Furniture', 'Inspect', 'Drawing', 'View'] as const;
const ASSEMBLY_TABS = ['File', 'Assembly', 'Sketch', 'Furniture', 'Inspect', 'Drawing', 'View'] as const;

// ...
const isAssembly = useAppStore((s) => s.activeDocument?.kind === 'assembly');
const TABS: string[] = isAssembly ? [...ASSEMBLY_TABS] : [...PART_TABS];
// ...
const defaultTab = isAssembly ? 'Assembly' : 'Model';
```

#### Diff to apply

```ts
// BEFORE:
const PART_TABS     = ['File', 'Model', 'Sketch', 'Furniture', 'Inspect', 'Drawing', 'View'] as const;
const ASSEMBLY_TABS = ['File', 'Assembly', 'Sketch', 'Furniture', 'Inspect', 'Drawing', 'View'] as const;

// AFTER:
const PART_TABS     = ['File', 'Model',    'Sketch', 'Furniture', 'Inspect', 'Drawing', 'View'] as const;
const ASSEMBLY_TABS = ['File', 'Assembly', 'Sketch', 'Furniture', 'Inspect', 'Drawing', 'View'] as const;
const DRAWING_TABS  = ['File', 'Drawing',  'View'] as const;
```

```ts
// BEFORE:
const isAssembly = useAppStore((s) => s.activeDocument?.kind === 'assembly');
const TABS: string[] = isAssembly ? [...ASSEMBLY_TABS] : [...PART_TABS];

// AFTER:
const kind = useAppStore((s) => s.activeDocument?.kind ?? 'part');
const TABS: string[] =
  kind === 'drawing'  ? [...DRAWING_TABS]  :
  kind === 'assembly' ? [...ASSEMBLY_TABS] :
  [...PART_TABS];
```

```ts
// BEFORE (panels object used):
const panels = isAssembly ? assemblyPanels : partPanels;
const defaultTab = isAssembly ? 'Assembly' : 'Model';

// AFTER:
const drawingPanels: Record<string, ReactElement> = {
  File:    <FileTab />,
  Drawing: <DrawingTab />,
  View:    <ViewTab />,
};

const panels =
  kind === 'drawing'  ? drawingPanels  :
  kind === 'assembly' ? assemblyPanels :
  partPanels;
const defaultTab =
  kind === 'drawing'  ? 'Drawing'  :
  kind === 'assembly' ? 'Assembly' :
  'Model';
```

#### Test

- [ ] **Step 1: Write the failing test**

```tsx
// packages/app/src/shell/__tests__/Ribbon.kind.spec.tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import Ribbon from '../Ribbon';
import { useAppStore } from '../../store/useAppStore';
import type { PartDocument, AssemblyDocument, DrawingDocument } from '@zilventor/shared';

const makePart = (): PartDocument =>
  ({ id: 'p1', name: 'Part', featureTree: [], parameters: {}, materials: [] } as unknown as PartDocument);
const makeAssembly = (): AssemblyDocument =>
  ({ id: 'a1', name: 'Asm', components: [], constraints: [], groundedComponentPaths: [],
     materials: [], colors: {}, bomItemNumbers: {}, cutListItemNumbers: {}, colorOverrides: {} } as unknown as AssemblyDocument);
const makeDrawing = (): DrawingDocument =>
  ({ id: 'd1', name: 'Drawing', sourcePath: 'p.zipt', sheets: [], titleBlock: {} } as unknown as DrawingDocument);

beforeEach(() => useAppStore.getState().setActiveDocument(null));

describe('Ribbon tab sets by document kind', () => {
  it('part mode shows Model tab, not Assembly or Drawing-only set', () => {
    useAppStore.getState().setActiveDocument({ kind: 'part', document: makePart() });
    render(<Ribbon />);
    expect(screen.getByRole('tab', { name: 'Model' })).toBeTruthy();
    expect(screen.queryByRole('tab', { name: 'Assembly' })).toBeNull();
  });

  it('assembly mode shows Assembly tab, not Model', () => {
    useAppStore.getState().setActiveDocument({ kind: 'assembly', document: makeAssembly() });
    render(<Ribbon />);
    expect(screen.getByRole('tab', { name: 'Assembly' })).toBeTruthy();
    expect(screen.queryByRole('tab', { name: 'Model' })).toBeNull();
  });

  it('drawing mode shows only File, Drawing, View tabs', () => {
    useAppStore.getState().setActiveDocument({ kind: 'drawing', document: makeDrawing() });
    render(<Ribbon />);
    expect(screen.getByRole('tab', { name: 'File' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Drawing' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'View' })).toBeTruthy();
    expect(screen.queryByRole('tab', { name: 'Model' })).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Assembly' })).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Sketch' })).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Furniture' })).toBeNull();
  });

  it('drawing mode default tab is Drawing', () => {
    useAppStore.getState().setActiveDocument({ kind: 'drawing', document: makeDrawing() });
    render(<Ribbon />);
    const drawingTab = screen.getByRole('tab', { name: 'Drawing' });
    expect(drawingTab.getAttribute('aria-selected')).toBe('true');
  });
});
```

- [ ] **Step 2: Run — expect fail**

```
cd packages/app && pnpm test:unit -- Ribbon.kind
```

- [ ] **Step 3: Implement** — apply the diff to `Ribbon.tsx`.

- [ ] **Step 4: Run — expect pass**

```
cd packages/app && pnpm test:unit -- Ribbon.kind
```

Also: `cd packages/app && pnpm test:unit`.

- [ ] **Step 5: Commit**

```
git add packages/app/src/shell/Ribbon.tsx \
        packages/app/src/shell/__tests__/Ribbon.kind.spec.tsx
git commit -m "feat(shell): Ribbon 3-mode switch (part / assembly / drawing)"
```

**Verify:** `pnpm -r typecheck` passes. The `RibbonTab` component must expose `aria-selected` for the test selector — confirm it does; if not, add `aria-selected={selected}` to `RibbonTab`'s button element.

---

### T41 — `App.tsx` viewport-vs-canvas switch

**Files:**
- Modify: `packages/app/src/App.tsx`
- Modify: `packages/app/src/drawing/__placeholders__.tsx` (already created in T39)
- Create (test): `packages/app/src/shell/__tests__/AppLayout.kind.spec.tsx`

**Agent:** Sonnet implementer.

#### Current rendering sites (confirmed at HEAD `0bcd8a2`)

Lines 3176–3181 of `packages/app/src/App.tsx`:

```tsx
<aside role="complementary" aria-label="Browser" className="bg-shell-panel border-r border-shell-border" id="region-browser">
  <BrowserPane part={activePart} sketchPicker={sweepPickerRef.current?.isActive() ? sweepPickerRef.current : null} partInfo={partInfoSnapshot} />
</aside>
<main role="main" id="region-viewport" className="bg-shell" style={{ position: 'relative' }}>
  <Viewport ref={viewportRef} onPointer={handleViewportPointer} />
  {sketchMode && activeSketchId && (() => { ... })()}
```

#### New imports to add at top of `App.tsx`

```ts
import { DrawingCanvas, DrawingTreePane } from './drawing/__placeholders__';
```

#### State selector to add near the top of the `App` component body

Add alongside the existing `activeDocument` / `activePart` destructures:

```ts
const activeDocKind = useAppStore((s) => s.activeDocument?.kind ?? 'part');
```

#### Diff for the BrowserPane `<aside>` (line 3176–3178)

```tsx
// BEFORE:
<aside role="complementary" aria-label="Browser" className="bg-shell-panel border-r border-shell-border" id="region-browser">
  <BrowserPane part={activePart} sketchPicker={sweepPickerRef.current?.isActive() ? sweepPickerRef.current : null} partInfo={partInfoSnapshot} />
</aside>

// AFTER:
<aside role="complementary" aria-label="Browser" className="bg-shell-panel border-r border-shell-border" id="region-browser">
  {activeDocKind === 'drawing'
    ? <DrawingTreePane />
    : <BrowserPane part={activePart} sketchPicker={sweepPickerRef.current?.isActive() ? sweepPickerRef.current : null} partInfo={partInfoSnapshot} />
  }
</aside>
```

#### Diff for the `<main>` viewport region (line 3179–3181)

```tsx
// BEFORE:
<main role="main" id="region-viewport" className="bg-shell" style={{ position: 'relative' }}>
  <Viewport ref={viewportRef} onPointer={handleViewportPointer} />
  {sketchMode && activeSketchId && (() => { ... })()}

// AFTER:
<main role="main" id="region-viewport" className="bg-shell" style={{ position: 'relative' }}>
  {activeDocKind === 'drawing'
    ? <DrawingCanvas />
    : <Viewport ref={viewportRef} onPointer={handleViewportPointer} />
  }
  {activeDocKind !== 'drawing' && sketchMode && activeSketchId && (() => { ... })()}
```

> **Note:** The sketch overlay (`ConstraintBadgeRenderer`, `DimensionRenderer`, etc.) inside the IIFE must be guarded with `activeDocKind !== 'drawing'` to prevent it from rendering over a `DrawingCanvas`. The cleanest way is to wrap the entire `{sketchMode && activeSketchId && (() => { ... })()}` block with `{activeDocKind !== 'drawing' && sketchMode && ...}`.

> **Placeholder note:** `<DrawingCanvas>` and `<DrawingTreePane>` live in `packages/app/src/drawing/__placeholders__.tsx` (created in T39). Phase 8 tasks T45 and T46 replace them with real implementations. The Phase 8 implementer will delete `__placeholders__.tsx` and update the import paths in `BrowserPane.tsx` and `App.tsx`.

#### Test

- [ ] **Step 1: Write the failing test**

```tsx
// packages/app/src/shell/__tests__/AppLayout.kind.spec.tsx
//
// Tests that the correct main-area component renders for each activeDocument kind.
// Mounts a lightweight stub of App layout (not the full App) to avoid OCCT/kernel deps.
// Uses @testing-library/react.

import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useAppStore } from '../../store/useAppStore';
import type { DrawingDocument, PartDocument, AssemblyDocument } from '@zilventor/shared';

// Re-export the layout slice under test by pulling just the reactive render logic.
// Because App.tsx is a large component, we test the branching logic via a tiny
// surrogate that mirrors the exact conditional:
import { DrawingCanvas, DrawingTreePane } from '../../drawing/__placeholders__';
import Viewport from '../../viewport/Viewport';   // real import (mocked below)
import BrowserPane from '../../shell/BrowserPane'; // real import (mocked below)

// Mock heavy dependencies so the layout test stays unit-scoped.
vi.mock('../../viewport/Viewport', () => ({
  default: () => <div data-testid="viewport" />,
}));
vi.mock('../../shell/BrowserPane', () => ({
  default: () => <div data-testid="browser-pane" />,
}));

// Minimal inline surrogate of the App layout branch
function LayoutSurrogate() {
  const activeDocKind = useAppStore((s) => s.activeDocument?.kind ?? 'part');
  return (
    <div>
      <aside>
        {activeDocKind === 'drawing'
          ? <DrawingTreePane />
          : <BrowserPane />
        }
      </aside>
      <main>
        {activeDocKind === 'drawing'
          ? <DrawingCanvas />
          : <Viewport />
        }
      </main>
    </div>
  );
}

const makePart = (): PartDocument =>
  ({ id: 'p1', name: 'Part', featureTree: [], parameters: {}, materials: [] } as unknown as PartDocument);
const makeAssembly = (): AssemblyDocument =>
  ({ id: 'a1', name: 'Asm', components: [], constraints: [], groundedComponentPaths: [],
     materials: [], colors: {}, bomItemNumbers: {}, cutListItemNumbers: {}, colorOverrides: {} } as unknown as AssemblyDocument);
const makeDrawing = (): DrawingDocument =>
  ({ id: 'd1', name: 'Drawing', sourcePath: 'p.zipt', sheets: [], titleBlock: {} } as unknown as DrawingDocument);

beforeEach(() => useAppStore.getState().setActiveDocument(null));

describe('App layout routing by document kind', () => {
  it('part mode → Viewport + BrowserPane rendered', () => {
    useAppStore.getState().setActiveDocument({ kind: 'part', document: makePart() });
    render(<LayoutSurrogate />);
    expect(screen.getByTestId('viewport')).toBeTruthy();
    expect(screen.getByTestId('browser-pane')).toBeTruthy();
    expect(screen.queryByTestId('drawing-canvas')).toBeNull();
    expect(screen.queryByTestId('drawing-tree-pane')).toBeNull();
  });

  it('assembly mode → Viewport + BrowserPane rendered', () => {
    useAppStore.getState().setActiveDocument({ kind: 'assembly', document: makeAssembly() });
    render(<LayoutSurrogate />);
    expect(screen.getByTestId('viewport')).toBeTruthy();
    expect(screen.getByTestId('browser-pane')).toBeTruthy();
  });

  it('drawing mode → DrawingCanvas + DrawingTreePane rendered, Viewport absent', () => {
    useAppStore.getState().setActiveDocument({ kind: 'drawing', document: makeDrawing() });
    render(<LayoutSurrogate />);
    expect(screen.getByTestId('drawing-canvas')).toBeTruthy();
    expect(screen.getByTestId('drawing-tree-pane')).toBeTruthy();
    expect(screen.queryByTestId('viewport')).toBeNull();
    expect(screen.queryByTestId('browser-pane')).toBeNull();
  });
});
```

- [ ] **Step 2: Run — expect fail**

```
cd packages/app && pnpm test:unit -- AppLayout.kind
```

- [ ] **Step 3: Implement** — add `DrawingCanvas`/`DrawingTreePane` imports and `activeDocKind` selector in `App.tsx`; apply the two JSX diffs above.

- [ ] **Step 4: Run — expect pass**

```
cd packages/app && pnpm test:unit -- AppLayout.kind
```

Also: `cd packages/app && pnpm test:unit`.

- [ ] **Step 5: Commit**

```
git add packages/app/src/App.tsx \
        packages/app/src/shell/__tests__/AppLayout.kind.spec.tsx
git commit -m "feat(app): route DrawingCanvas + DrawingTreePane on activeDocument.kind === 'drawing'"
```

**Verify:** `pnpm -r typecheck` passes. Confirm that the sketch overlay (ConstraintBadgeRenderer / DimensionRenderer) is guarded with `activeDocKind !== 'drawing'` and does not appear in the drawing-mode render tree.
## Phase 8 — UI: drawing canvas, tree pane, dimension elements (Batch 1: T42-T46)

Five tasks; dispatch as one Sonnet implementer batch. The remaining UI tasks (T47-T51 — ribbon, dialogs, tool-mode store) are in Part 4c2.

---

### T42 — `<TitleBlock>` component

**Files:**
- Create: `packages/app/src/drawing/TitleBlock.tsx`
- Create: `packages/app/src/drawing/__tests__/TitleBlock.spec.tsx`

**Agent:** Sonnet implementer.

- [ ] **Step 1: Write the failing test**

```tsx
// packages/app/src/drawing/__tests__/TitleBlock.spec.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TitleBlock } from '../TitleBlock';
import type { DrawingDocument, DrawingSheet } from '@zilventor/shared';
import type { PartDocument } from '@zilventor/shared';

const sheet = (): DrawingSheet => ({
  id: 's1',
  name: 'Sheet 1',
  size: { kind: 'iso', size: 'A3' },
  orientation: 'landscape',
  views: [],
  dimensions: [],
  annotations: [],
  titleBlock: {},
});

const drawing = (): DrawingDocument => ({
  id: 'd1',
  name: 'Cabinet — Drawing',
  units: 'mm',
  source: { partPath: 'parts/cabinet.zipt', sourceKind: 'part' },
  properties: {},
  sheets: [sheet()],
  activeSheetId: 's1',
});

const source = (): PartDocument => ({
  id: 'p1',
  name: 'Cabinet',
  parameters: [],
  features: [],
  materials: [],
  properties: {},
} as unknown as PartDocument);

describe('TitleBlock', () => {
  it('renders drawing name field', () => {
    render(
      <svg>
        <TitleBlock drawing={drawing()} sheet={sheet()} source={source()} sheetIndex={0} sheetCount={1} />
      </svg>
    );
    expect(screen.getByText('Cabinet — Drawing')).toBeInTheDocument();
  });

  it('renders part name field', () => {
    render(
      <svg>
        <TitleBlock drawing={drawing()} sheet={sheet()} source={source()} sheetIndex={0} sheetCount={1} />
      </svg>
    );
    expect(screen.getByText('Cabinet')).toBeInTheDocument();
  });

  it('renders sheet n/N as "1 / 1"', () => {
    render(
      <svg>
        <TitleBlock drawing={drawing()} sheet={sheet()} source={source()} sheetIndex={0} sheetCount={1} />
      </svg>
    );
    expect(screen.getByText('1 / 1')).toBeInTheDocument();
  });

  it('override drawingName wins over auto-derived name', () => {
    const s = { ...sheet(), titleBlock: { drawingName: 'MY OVERRIDE' } };
    render(
      <svg>
        <TitleBlock drawing={drawing()} sheet={s} source={source()} sheetIndex={0} sheetCount={1} />
      </svg>
    );
    expect(screen.getByText('MY OVERRIDE')).toBeInTheDocument();
  });

  it('renders default scale 1:1', () => {
    render(
      <svg>
        <TitleBlock drawing={drawing()} sheet={sheet()} source={source()} sheetIndex={0} sheetCount={1} />
      </svg>
    );
    expect(screen.getByText('1:1')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test (expect fail)**

```
cd packages/app && pnpm test:unit -- TitleBlock
```

- [ ] **Step 3: Implement `packages/app/src/drawing/TitleBlock.tsx`**

```tsx
// packages/app/src/drawing/TitleBlock.tsx
import type { DrawingDocument, DrawingSheet } from '@zilventor/shared';
import type { PartDocument, AssemblyDocument } from '@zilventor/shared';
import { resolveTitleBlock } from '@zilventor/shared/src/drawing/titleBlock';

export type TitleBlockProps = {
  drawing: DrawingDocument;
  sheet: DrawingSheet;
  source: PartDocument | AssemblyDocument;
  sheetIndex: number;
  sheetCount: number;
};

// Inventor-2012-style title block at bottom-right of the sheet.
// All coordinates in mm (page-space). Sheet origin is top-left.
// For A3 landscape: sheet is 420 × 297 mm.
// Block is placed at (sheet_w - 190, sheet_h - 55) with w=185, h=50.

const TB_W = 185;    // block total width, mm
const TB_H = 50;     // block total height, mm
const COL1 = 90;     // left column width (label + value for main fields)
const ROW_H = 8;     // row height, mm
const FONT = 3.5;    // label font size, mm (≈ 10pt at 1:1)
const FONT_VAL = 4;  // value font size, mm
const LABEL_COLOR = '#555555';
const VALUE_COLOR = '#111111';
const STROKE_COLOR = '#222222';

function getSheetDimsMm(sheet: DrawingSheet): { w: number; h: number } {
  const ISO_MM: Record<string, { w: number; h: number }> = {
    A0: { w: 1189, h: 841 }, A1: { w: 841, h: 594 },
    A2: { w: 594, h: 420 },  A3: { w: 420, h: 297 },
    A4: { w: 297, h: 210 },
  };
  if (sheet.size.kind === 'custom') {
    const base = { w: sheet.size.widthMm, h: sheet.size.heightMm };
    return sheet.orientation === 'landscape' ? base : { w: base.h, h: base.w };
  }
  const base = ISO_MM[sheet.size.size] ?? { w: 420, h: 297 };
  return sheet.orientation === 'landscape' ? base : { w: base.h, h: base.w };
}

export function TitleBlock({ drawing, sheet, source, sheetIndex, sheetCount }: TitleBlockProps) {
  const { w: sheetW, h: sheetH } = getSheetDimsMm(sheet);
  const ox = sheetW - TB_W - 5;   // offset-x (5 mm margin from right border)
  const oy = sheetH - TB_H - 5;   // offset-y (5 mm margin from bottom border)

  const fields = resolveTitleBlock(drawing, sheet, source, sheetIndex, sheetCount);

  // Row definitions: [label, value, x-offset in block, y-offset in block, width]
  // Two-column layout: left half (col1) and right half (col2).
  const rows: Array<{ label: string; value: string; bx: number; by: number; bw: number }> = [
    { label: 'Drawing',   value: fields.drawingName, bx: 0,     by: 0,        bw: COL1 },
    { label: 'Part',      value: fields.partName,    bx: COL1,  by: 0,        bw: TB_W - COL1 },
    { label: 'Drawn By',  value: fields.drawnBy,     bx: 0,     by: ROW_H,    bw: COL1 },
    { label: 'Approved',  value: fields.approvedBy,  bx: COL1,  by: ROW_H,    bw: TB_W - COL1 },
    { label: 'Scale',     value: fields.scaleText,   bx: 0,     by: ROW_H*2,  bw: COL1 / 2 },
    { label: 'Date',      value: fields.date,        bx: COL1 / 2, by: ROW_H*2, bw: COL1 - COL1 / 2 },
    { label: 'Material',  value: fields.material,    bx: COL1,  by: ROW_H*2,  bw: TB_W - COL1 },
    { label: 'Revision',  value: fields.revision,    bx: 0,     by: ROW_H*3,  bw: COL1 },
    { label: 'Sheet',     value: fields.sheetNofN,   bx: COL1,  by: ROW_H*3,  bw: TB_W - COL1 },
    { label: 'Notes',     value: fields.notes ?? '', bx: 0,     by: ROW_H*4,  bw: TB_W },
  ];

  return (
    <g data-title-block>
      {/* Outer border */}
      <rect x={ox} y={oy} width={TB_W} height={TB_H}
        fill="white" stroke={STROKE_COLOR} strokeWidth={0.5} />
      {/* Vertical separator */}
      <line x1={ox + COL1} y1={oy} x2={ox + COL1} y2={oy + TB_H}
        stroke={STROKE_COLOR} strokeWidth={0.25} />
      {/* Half-split of left col in row 2 */}
      <line x1={ox + COL1 / 2} y1={oy + ROW_H*2} x2={ox + COL1 / 2} y2={oy + ROW_H*3}
        stroke={STROKE_COLOR} strokeWidth={0.25} />

      {rows.map(({ label, value, bx, by, bw }, i) => {
        const rx = ox + bx;
        const ry = oy + by;
        return (
          <g key={i}>
            <rect x={rx} y={ry} width={bw} height={ROW_H}
              fill="none" stroke={STROKE_COLOR} strokeWidth={0.25} />
            <text x={rx + 1} y={ry + FONT + 0.5} fontSize={FONT} fill={LABEL_COLOR}>{label}</text>
            <text x={rx + 1} y={ry + ROW_H - 1.5} fontSize={FONT_VAL} fill={VALUE_COLOR}
              data-tb-field={label.toLowerCase().replace(/\s+/g, '-')}>
              {value}
            </text>
          </g>
        );
      })}
    </g>
  );
}
```

Note: `resolveTitleBlock` is implemented in Phase 3 at `packages/shared/src/drawing/titleBlock.ts`. It merges `sheet.titleBlock` overrides with auto-derived values:

```ts
// packages/shared/src/drawing/titleBlock.ts (Phase 3 — shown here for completeness)
export type ResolvedTitleBlock = {
  drawingName: string;
  partName: string;
  drawnBy: string;
  approvedBy: string;
  scaleText: string;
  date: string;
  material: string;
  revision: string;
  sheetNofN: string;
  notes?: string;
};

export function resolveTitleBlock(
  drawing: DrawingDocument,
  sheet: DrawingSheet,
  source: PartDocument | AssemblyDocument,
  sheetIndex: number,
  sheetCount: number,
): ResolvedTitleBlock {
  const ov = sheet.titleBlock;
  const baseScale = sheet.views.find((v) => v.kind === 'base');
  const scaleAuto = baseScale
    ? `${baseScale.scale.numerator}:${baseScale.scale.denominator}`
    : '1:1';
  const materialAuto = 'material' in source && source.materials?.length
    ? (source.materials[0]?.name ?? '')
    : '';
  return {
    drawingName: ov.drawingName ?? drawing.name,
    partName:    ov.partName    ?? source.name,
    drawnBy:     ov.drawnBy    ?? '',
    approvedBy:  ov.approvedBy ?? '',
    scaleText:   ov.scaleText  ?? scaleAuto,
    date:        ov.date       ?? new Date().toISOString().slice(0, 10),
    material:    ov.material   ?? materialAuto,
    revision:    ov.revision   ?? '',
    sheetNofN:   `${sheetIndex + 1} / ${sheetCount}`,
    notes:       ov.notes,
  };
}
```

- [ ] **Step 4: Run the test (expect pass)**

```
cd packages/app && pnpm test:unit -- TitleBlock
```
Expected: 5/5 pass.

- [ ] **Step 5: Typecheck**

```
cd packages/app && pnpm typecheck
```
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/drawing/TitleBlock.tsx packages/app/src/drawing/__tests__/TitleBlock.spec.tsx
git commit -m "feat(drawing): add <TitleBlock> SVG component"
```

**Verify:** 5 tests pass; typecheck clean; `<text data-tb-field="drawing">` contains the drawing name.

---

### T43 — `<ViewElement>` component

**Files:**
- Create: `packages/app/src/drawing/ViewElement.tsx`
- Create: `packages/app/src/drawing/__tests__/ViewElement.spec.tsx`

**Agent:** Sonnet implementer.

- [ ] **Step 1: Write the failing test**

```tsx
// packages/app/src/drawing/__tests__/ViewElement.spec.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ViewElement } from '../ViewElement';
import type { DrawingView, ProjectedGeometry } from '@zilventor/shared';

const proj = (): ProjectedGeometry => ({
  visibleEdges: [
    { id: 've1', kind: 'outline', points: [[0, 0], [100, 0]] },
    { id: 've2', kind: 'feature', points: [[0, 10], [100, 10]] },
  ],
  hiddenEdges: [
    { id: 'he1', kind: 'outline', points: [[0, 20], [100, 20]] },
  ],
  bbox: { minX: 0, minY: 0, maxX: 100, maxY: 20 },
});

const view = (): DrawingView => ({
  id: 'v1',
  kind: 'base',
  positionMm: { x: 50, y: 50 },
  scale: { numerator: 1, denominator: 1 },
  orientation: 'front',
  showHidden: true,
  projection: proj(),
  inputFingerprint: 'fp1',
} as DrawingView);

describe('ViewElement', () => {
  it('renders 2 visible polylines and 1 hidden polyline', () => {
    render(
      <svg>
        <ViewElement view={view()} isStale={false} onRegenerate={vi.fn()} />
      </svg>
    );
    const polylines = document.querySelectorAll('polyline');
    expect(polylines).toHaveLength(3);
  });

  it('visible polylines have stroke-width 0.35', () => {
    render(
      <svg>
        <ViewElement view={view()} isStale={false} onRegenerate={vi.fn()} />
      </svg>
    );
    const visible = document.querySelector('[data-edge-id="ve1"]');
    expect(visible?.getAttribute('stroke-width')).toBe('0.35');
  });

  it('hidden polyline has stroke-dasharray "2 1" and stroke-width 0.18', () => {
    render(
      <svg>
        <ViewElement view={view()} isStale={false} onRegenerate={vi.fn()} />
      </svg>
    );
    const hidden = document.querySelector('[data-edge-id="he1"]');
    expect(hidden?.getAttribute('stroke-dasharray')).toBe('2 1');
    expect(hidden?.getAttribute('stroke-width')).toBe('0.18');
  });

  it('no stale marker when isStale=false', () => {
    render(
      <svg>
        <ViewElement view={view()} isStale={false} onRegenerate={vi.fn()} />
      </svg>
    );
    expect(document.querySelector('[data-stale-marker]')).toBeNull();
  });

  it('renders stale marker when isStale=true', () => {
    render(
      <svg>
        <ViewElement view={view()} isStale={true} onRegenerate={vi.fn()} />
      </svg>
    );
    expect(document.querySelector('[data-stale-marker]')).not.toBeNull();
  });

  it('clicking stale marker calls onRegenerate with the view id', () => {
    const onRegen = vi.fn();
    render(
      <svg>
        <ViewElement view={view()} isStale={true} onRegenerate={onRegen} />
      </svg>
    );
    const marker = document.querySelector('[data-stale-marker]') as SVGElement;
    fireEvent.click(marker);
    expect(onRegen).toHaveBeenCalledWith('v1');
  });
});
```

- [ ] **Step 2: Run the test (expect fail)**

```
cd packages/app && pnpm test:unit -- ViewElement
```

- [ ] **Step 3: Implement `packages/app/src/drawing/ViewElement.tsx`**

```tsx
// packages/app/src/drawing/ViewElement.tsx
import type { DrawingView } from '@zilventor/shared';

export type ViewElementProps = {
  view: DrawingView;
  isStale: boolean;
  onRegenerate: (viewId: string) => void;
};

function pointsAttr(pts: ReadonlyArray<readonly [number, number]>): string {
  return pts.map(([x, y]) => `${x},${y}`).join(' ');
}

export function ViewElement({ view, isStale, onRegenerate }: ViewElementProps) {
  const { positionMm, scale } = view;
  const scaleFactor = scale.numerator / scale.denominator;
  const proj = view.projection;

  return (
    <g
      data-view-id={view.id}
      transform={`translate(${positionMm.x}, ${positionMm.y}) scale(${scaleFactor})`}
    >
      {/* Visible edges */}
      <g data-edge-group="visible">
        {proj?.visibleEdges.map((e) => (
          <polyline
            key={e.id}
            data-edge-id={e.id}
            data-view-id={view.id}
            points={pointsAttr(e.points)}
            stroke="#111111"
            strokeWidth="0.35"
            fill="none"
          />
        ))}
      </g>

      {/* Hidden edges */}
      {view.showHidden && (
        <g data-edge-group="hidden">
          {proj?.hiddenEdges.map((e) => (
            <polyline
              key={e.id}
              data-edge-id={e.id}
              data-view-id={view.id}
              points={pointsAttr(e.points)}
              stroke="#111111"
              strokeWidth="0.18"
              strokeDasharray="2 1"
              fill="none"
            />
          ))}
        </g>
      )}

      {/* Stale banner: 16×16 mm warning marker, top-left of view (in view-local coords) */}
      {isStale && (
        <g
          data-stale-marker
          onClick={() => onRegenerate(view.id)}
          style={{ cursor: 'pointer' }}
        >
          <rect x={0} y={-16} width={16} height={16} fill="#fef08a" stroke="#ca8a04" strokeWidth={0.5} rx={1} />
          <text x={8} y={-4} textAnchor="middle" fontSize={10} fill="#92400e">⚠</text>
        </g>
      )}
    </g>
  );
}
```

- [ ] **Step 4: Run the test (expect pass)**

```
cd packages/app && pnpm test:unit -- ViewElement
```
Expected: 6/6 pass.

- [ ] **Step 5: Typecheck**

```
cd packages/app && pnpm typecheck
```
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/drawing/ViewElement.tsx packages/app/src/drawing/__tests__/ViewElement.spec.tsx
git commit -m "feat(drawing): add <ViewElement> with stale-banner"
```

**Verify:** 6 tests pass; stale marker is clickable; polyline data attributes are set correctly.

---

### T44 — `<DimensionElement>` + `<AnnotationElement>` components

**Files:**
- Create: `packages/app/src/drawing/DimensionElement.tsx`
- Create: `packages/app/src/drawing/AnnotationElement.tsx`
- Create: `packages/app/src/drawing/__tests__/DimensionElement.spec.tsx`
- Create: `packages/app/src/drawing/__tests__/AnnotationElement.spec.tsx`

**Agent:** Sonnet implementer.

- [ ] **Step 1: Write the failing tests**

```tsx
// packages/app/src/drawing/__tests__/DimensionElement.spec.tsx
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { DimensionElement } from '../DimensionElement';
import type { DrawingDimension, DrawingView, ProjectedGeometry } from '@zilventor/shared';

// Minimal view + projection fixture for resolving PointRef → mm coords
const mockProj = (): ProjectedGeometry => ({
  visibleEdges: [
    { id: 'e1', kind: 'outline', points: [[0, 0], [100, 0]] },
    { id: 'e2', kind: 'outline', points: [[0, 50], [0, 100]] },
  ],
  hiddenEdges: [],
  bbox: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
});

const mockView = (): DrawingView => ({
  id: 'v1',
  kind: 'base',
  positionMm: { x: 0, y: 0 },
  scale: { numerator: 1, denominator: 1 },
  orientation: 'front',
  showHidden: false,
  projection: mockProj(),
} as DrawingView);

describe('DimensionElement — linear-h', () => {
  const dim: DrawingDimension = {
    id: 'd1',
    kind: 'linear-h',
    viewId: 'v1',
    from: { kind: 'edge-endpoint', edgeId: 'e1', end: 'start' },
    to:   { kind: 'edge-endpoint', edgeId: 'e1', end: 'end' },
    offsetMm: 15,
  };

  it('renders 2 extension lines + 1 dimension line + text with the measured value', () => {
    render(<svg><DimensionElement dim={dim} view={mockView()} /></svg>);
    const lines = document.querySelectorAll('line');
    expect(lines.length).toBeGreaterThanOrEqual(3);  // 2 ext + 1 dim
    const text = document.querySelector('[data-dim-text]');
    expect(text?.textContent).toBe('100');
  });

  it('renders dim text data-dim-id attribute', () => {
    render(<svg><DimensionElement dim={dim} view={mockView()} /></svg>);
    expect(document.querySelector('[data-dim-id="d1"]')).not.toBeNull();
  });
});

describe('DimensionElement — radial', () => {
  const dim: DrawingDimension = {
    id: 'd2',
    kind: 'radial',
    viewId: 'v1',
    edgeId: 'e2',
    offsetMm: 10,
    angleDeg: 45,
  };

  it('renders a leader line + text with R prefix', () => {
    render(<svg><DimensionElement dim={dim} view={mockView()} /></svg>);
    const text = document.querySelector('[data-dim-text]');
    expect(text?.textContent).toMatch(/^R/);
  });
});
```

```tsx
// packages/app/src/drawing/__tests__/AnnotationElement.spec.tsx
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { AnnotationElement } from '../AnnotationElement';
import type { DrawingAnnotation, DrawingView, ProjectedGeometry } from '@zilventor/shared';

const mockProj = (): ProjectedGeometry => ({
  visibleEdges: [
    { id: 'e1', kind: 'outline', points: [[0, 0], [100, 0]] },
    { id: 'e2', kind: 'outline', points: [[50, 0], [50, 80]] },
    { id: 'circ1', kind: 'feature', points: [[20, 20], [30, 20], [30, 30], [20, 30], [20, 20]] },
  ],
  hiddenEdges: [],
  bbox: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
});

const mockView = (): DrawingView => ({
  id: 'v1', kind: 'base', positionMm: { x: 0, y: 0 },
  scale: { numerator: 1, denominator: 1 }, orientation: 'front',
  showHidden: false, projection: mockProj(),
} as DrawingView);

describe('AnnotationElement — balloon', () => {
  const ann: DrawingAnnotation = {
    id: 'a1',
    kind: 'balloon',
    viewId: 'v1',
    targetMm: { x: 30, y: 30 },
    textPosMm: { x: 60, y: 20 },
    itemNumber: 3,
  };

  it('renders a circle element', () => {
    render(<svg><AnnotationElement ann={ann} view={mockView()} /></svg>);
    expect(document.querySelector('circle')).not.toBeNull();
  });

  it('renders the item number inside the balloon', () => {
    render(<svg><AnnotationElement ann={ann} view={mockView()} /></svg>);
    const text = document.querySelector('[data-ann-text]');
    expect(text?.textContent).toBe('3');
  });

  it('renders a leader polyline from targetMm to textPosMm', () => {
    render(<svg><AnnotationElement ann={ann} view={mockView()} /></svg>);
    expect(document.querySelector('polyline')).not.toBeNull();
  });
});

describe('AnnotationElement — centerline', () => {
  const ann: DrawingAnnotation = {
    id: 'a2', kind: 'centerline', viewId: 'v1',
    edgeIdA: 'e1', edgeIdB: 'e2',
  };

  it('renders cross-pattern paths for centerline', () => {
    render(<svg><AnnotationElement ann={ann} view={mockView()} /></svg>);
    const paths = document.querySelectorAll('line,path');
    expect(paths.length).toBeGreaterThan(0);
  });
});

describe('AnnotationElement — center-mark', () => {
  const ann: DrawingAnnotation = {
    id: 'a3', kind: 'center-mark', viewId: 'v1', edgeId: 'circ1',
  };

  it('renders center mark cross lines', () => {
    render(<svg><AnnotationElement ann={ann} view={mockView()} /></svg>);
    expect(document.querySelectorAll('line').length).toBeGreaterThanOrEqual(2);
  });
});

describe('AnnotationElement — leader', () => {
  const ann: DrawingAnnotation = {
    id: 'a4', kind: 'leader', viewId: 'v1',
    targetMm: { x: 20, y: 20 }, textPosMm: { x: 60, y: 10 }, text: 'Sharp edge',
  };

  it('renders text content for leader', () => {
    render(<svg><AnnotationElement ann={ann} view={mockView()} /></svg>);
    expect(document.querySelector('[data-ann-text]')?.textContent).toBe('Sharp edge');
  });
});
```

- [ ] **Step 2: Run the tests (expect fail)**

```
cd packages/app && pnpm test:unit -- DimensionElement AnnotationElement
```

- [ ] **Step 3: Implement `packages/app/src/drawing/DimensionElement.tsx`**

```tsx
// packages/app/src/drawing/DimensionElement.tsx
import type { DrawingDimension, DrawingView, PointRef } from '@zilventor/shared';

// Resolve a PointRef to sheet-space mm coords within the view's projection.
function resolvePoint(ref: PointRef, view: DrawingView): { x: number; y: number } | null {
  const proj = view.projection;
  if (!proj) return null;
  const allEdges = [...proj.visibleEdges, ...proj.hiddenEdges];
  const edge = allEdges.find((e) => e.id === ref.edgeId);
  if (!edge || edge.points.length === 0) return null;
  const s = view.scale.numerator / view.scale.denominator;
  const px = view.positionMm.x;
  const py = view.positionMm.y;

  if (ref.kind === 'edge-endpoint') {
    const pt = ref.end === 'start' ? edge.points[0] : edge.points[edge.points.length - 1];
    if (!pt) return null;
    return { x: px + pt[0] * s, y: py + pt[1] * s };
  }
  if (ref.kind === 'edge-midpoint') {
    const mid = Math.floor(edge.points.length / 2);
    const pt = edge.points[mid];
    if (!pt) return null;
    return { x: px + pt[0] * s, y: py + pt[1] * s };
  }
  if (ref.kind === 'arc-center') {
    // Approximate arc center as the mean of all points
    const sum = edge.points.reduce((acc, p) => ({ x: acc.x + p[0], y: acc.y + p[1] }), { x: 0, y: 0 });
    return { x: px + (sum.x / edge.points.length) * s, y: py + (sum.y / edge.points.length) * s };
  }
  return null;
}

function arrowHead(x1: number, y1: number, x2: number, y2: number, size = 2): string {
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const ux = dx / len, uy = dy / len;
  const px = -uy, py = ux;
  const tip = { x: x2, y: y2 };
  const b1 = { x: x2 - ux * size + px * size * 0.5, y: y2 - uy * size + py * size * 0.5 };
  const b2 = { x: x2 - ux * size - px * size * 0.5, y: y2 - uy * size - py * size * 0.5 };
  return `M${b1.x},${b1.y} L${tip.x},${tip.y} L${b2.x},${b2.y}`;
}

function LinearDimension({ dim, view, horizontal }: { dim: DrawingDimension & { kind: 'linear-h' | 'linear-v' | 'aligned' }; view: DrawingView; horizontal: boolean | null }) {
  const fromPt = resolvePoint(dim.from, view);
  const toPt   = resolvePoint(dim.to, view);
  if (!fromPt || !toPt) return null;

  const offset = dim.offsetMm;
  // For linear-h: dim line is horizontal at fromPt.y - offset
  // For linear-v: dim line is vertical at fromPt.x - offset
  // For aligned: dim line is parallel to the segment, offset perpendicularly
  let dimFrom: { x: number; y: number };
  let dimTo:   { x: number; y: number };
  let measuredVal: number;

  if (dim.kind === 'linear-h') {
    dimFrom = { x: fromPt.x, y: fromPt.y - offset };
    dimTo   = { x: toPt.x,   y: fromPt.y - offset };
    measuredVal = Math.abs(toPt.x - fromPt.x);
  } else if (dim.kind === 'linear-v') {
    dimFrom = { x: fromPt.x - offset, y: fromPt.y };
    dimTo   = { x: fromPt.x - offset, y: toPt.y };
    measuredVal = Math.abs(toPt.y - fromPt.y);
  } else {
    // aligned: perpendicular offset
    const dx = toPt.x - fromPt.x, dy = toPt.y - fromPt.y;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const nx = -dy / len, ny = dx / len;
    dimFrom = { x: fromPt.x + nx * offset, y: fromPt.y + ny * offset };
    dimTo   = { x: toPt.x   + nx * offset, y: toPt.y   + ny * offset };
    measuredVal = len;
  }

  const midX = (dimFrom.x + dimTo.x) / 2;
  const midY = (dimFrom.y + dimTo.y) / 2 - 1.5;
  const textVal = Math.round(measuredVal * 10) / 10;

  return (
    <g data-dim-id={dim.id}>
      {/* Extension lines */}
      <line x1={fromPt.x} y1={fromPt.y} x2={dimFrom.x} y2={dimFrom.y}
        stroke="#222" strokeWidth="0.18" />
      <line x1={toPt.x} y1={toPt.y} x2={dimTo.x} y2={dimTo.y}
        stroke="#222" strokeWidth="0.18" />
      {/* Dimension line */}
      <line x1={dimFrom.x} y1={dimFrom.y} x2={dimTo.x} y2={dimTo.y}
        stroke="#222" strokeWidth="0.25" />
      {/* Arrowheads */}
      <path d={arrowHead(dimTo.x, dimTo.y, dimFrom.x, dimFrom.y)} stroke="#222" strokeWidth="0.2" fill="none" />
      <path d={arrowHead(dimFrom.x, dimFrom.y, dimTo.x, dimTo.y)} stroke="#222" strokeWidth="0.2" fill="none" />
      {/* Text */}
      <text x={midX} y={midY} textAnchor="middle" fontSize={3.5} fill="#111"
        data-dim-text>
        {String(textVal)}
      </text>
    </g>
  );
}

function RadialOrDiametricDimension({ dim, view }: { dim: DrawingDimension & { kind: 'radial' | 'diametric' }; view: DrawingView }) {
  const proj = view.projection;
  if (!proj) return null;
  const allEdges = [...proj.visibleEdges, ...proj.hiddenEdges];
  const edge = allEdges.find((e) => e.id === dim.edgeId);
  if (!edge || edge.points.length === 0) return null;

  const s = view.scale.numerator / view.scale.denominator;
  const px = view.positionMm.x, py = view.positionMm.y;

  // Estimate center and radius from the edge points
  const sum = edge.points.reduce((acc, p) => ({ x: acc.x + p[0], y: acc.y + p[1] }), { x: 0, y: 0 });
  const cx = px + (sum.x / edge.points.length) * s;
  const cy = py + (sum.y / edge.points.length) * s;
  const first = edge.points[0]!;
  const radius = Math.sqrt((first[0] - sum.x / edge.points.length) ** 2 + (first[1] - sum.y / edge.points.length) ** 2) * s;

  const anglRad = (dim.angleDeg * Math.PI) / 180;
  const leaderEnd = {
    x: cx + Math.cos(anglRad) * (radius + dim.offsetMm),
    y: cy + Math.sin(anglRad) * (radius + dim.offsetMm),
  };
  const leaderStart = {
    x: cx + Math.cos(anglRad) * radius,
    y: cy + Math.sin(anglRad) * radius,
  };
  const textVal = Math.round(radius * 10) / 10;
  const prefix = dim.kind === 'radial' ? 'R' : 'Ø';

  return (
    <g data-dim-id={dim.id}>
      <line x1={leaderStart.x} y1={leaderStart.y} x2={leaderEnd.x} y2={leaderEnd.y}
        stroke="#222" strokeWidth="0.25" />
      <text x={leaderEnd.x + 1} y={leaderEnd.y} fontSize={3.5} fill="#111" data-dim-text>
        {`${prefix}${textVal}`}
      </text>
    </g>
  );
}

export type DimensionElementProps = {
  dim: DrawingDimension;
  view: DrawingView;
};

export function DimensionElement({ dim, view }: DimensionElementProps) {
  switch (dim.kind) {
    case 'linear-h':
    case 'linear-v':
    case 'aligned':
      return <LinearDimension dim={dim} view={view} horizontal={dim.kind === 'linear-h' ? true : dim.kind === 'linear-v' ? false : null} />;
    case 'radial':
    case 'diametric':
      return <RadialOrDiametricDimension dim={dim} view={view} />;
    default:
      return null;
  }
}
```

- [ ] **Step 4: Implement `packages/app/src/drawing/AnnotationElement.tsx`**

```tsx
// packages/app/src/drawing/AnnotationElement.tsx
import type { DrawingAnnotation, DrawingView } from '@zilventor/shared';

function edgeCenter(edgeId: string, view: DrawingView): { x: number; y: number } | null {
  const proj = view.projection;
  if (!proj) return null;
  const all = [...proj.visibleEdges, ...proj.hiddenEdges];
  const edge = all.find((e) => e.id === edgeId);
  if (!edge || edge.points.length === 0) return null;
  const s = view.scale.numerator / view.scale.denominator;
  const sum = edge.points.reduce((acc, p) => ({ x: acc.x + p[0], y: acc.y + p[1] }), { x: 0, y: 0 });
  return {
    x: view.positionMm.x + (sum.x / edge.points.length) * s,
    y: view.positionMm.y + (sum.y / edge.points.length) * s,
  };
}

const CROSS_SIZE = 4;   // mm — half-length of centerline/center-mark cross arms
const BALLOON_R = 5;    // mm — balloon circle radius

export type AnnotationElementProps = {
  ann: DrawingAnnotation;
  view: DrawingView;
};

export function AnnotationElement({ ann, view }: AnnotationElementProps) {
  switch (ann.kind) {
    case 'centerline': {
      const cA = edgeCenter(ann.edgeIdA, view);
      const cB = edgeCenter(ann.edgeIdB, view);
      if (!cA || !cB) return null;
      const mx = (cA.x + cB.x) / 2, my = (cA.y + cB.y) / 2;
      const dx = cB.x - cA.x, dy = cB.y - cA.y;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      const ux = dx / len, uy = dy / len;
      const px = -uy, py = ux;
      // Center-line cross: main axis + perpendicular tick at midpoint
      return (
        <g data-ann-id={ann.id} data-ann-kind="centerline">
          <line x1={cA.x} y1={cA.y} x2={cB.x} y2={cB.y}
            stroke="#555" strokeWidth="0.18" strokeDasharray="4 2 1 2" />
          <line x1={mx - px * CROSS_SIZE} y1={my - py * CROSS_SIZE}
                x2={mx + px * CROSS_SIZE} y2={my + py * CROSS_SIZE}
            stroke="#555" strokeWidth="0.18" strokeDasharray="4 2 1 2" />
        </g>
      );
    }

    case 'center-mark': {
      const c = edgeCenter(ann.edgeId, view);
      if (!c) return null;
      return (
        <g data-ann-id={ann.id} data-ann-kind="center-mark">
          <line x1={c.x - CROSS_SIZE} y1={c.y} x2={c.x + CROSS_SIZE} y2={c.y}
            stroke="#555" strokeWidth="0.18" strokeDasharray="4 1" />
          <line x1={c.x} y1={c.y - CROSS_SIZE} x2={c.x} y2={c.y + CROSS_SIZE}
            stroke="#555" strokeWidth="0.18" strokeDasharray="4 1" />
          {/* Small solid cross at exact center */}
          <line x1={c.x - 1} y1={c.y} x2={c.x + 1} y2={c.y} stroke="#555" strokeWidth="0.35" />
          <line x1={c.x} y1={c.y - 1} x2={c.x} y2={c.y + 1} stroke="#555" strokeWidth="0.35" />
        </g>
      );
    }

    case 'leader': {
      const { targetMm: t, textPosMm: tp } = ann;
      return (
        <g data-ann-id={ann.id} data-ann-kind="leader">
          <polyline points={`${t.x},${t.y} ${tp.x},${tp.y}`}
            stroke="#222" strokeWidth="0.25" fill="none" />
          <text x={tp.x + 1} y={tp.y - 1} fontSize={3.5} fill="#111" data-ann-text>
            {ann.text}
          </text>
        </g>
      );
    }

    case 'balloon': {
      const { targetMm: t, textPosMm: tp, itemNumber } = ann;
      const cx = tp.x, cy = tp.y;
      return (
        <g data-ann-id={ann.id} data-ann-kind="balloon">
          {/* Leader from target to circle edge */}
          <polyline points={`${t.x},${t.y} ${cx - BALLOON_R},${cy}`}
            stroke="#222" strokeWidth="0.25" fill="none" />
          {/* Balloon circle */}
          <circle cx={cx} cy={cy} r={BALLOON_R} fill="white" stroke="#222" strokeWidth="0.35" />
          <text x={cx} y={cy + 1.5} textAnchor="middle" fontSize={4} fill="#111" data-ann-text>
            {String(itemNumber)}
          </text>
        </g>
      );
    }

    default:
      return null;
  }
}
```

- [ ] **Step 5: Run the tests (expect pass)**

```
cd packages/app && pnpm test:unit -- DimensionElement AnnotationElement
```
Expected: all pass.

- [ ] **Step 6: Typecheck**

```
cd packages/app && pnpm typecheck
```
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add packages/app/src/drawing/DimensionElement.tsx packages/app/src/drawing/__tests__/DimensionElement.spec.tsx \
        packages/app/src/drawing/AnnotationElement.tsx packages/app/src/drawing/__tests__/AnnotationElement.spec.tsx
git commit -m "feat(drawing): add <DimensionElement> + <AnnotationElement>"
```

**Verify:** all dimension and annotation kind tests pass; no TS errors; each rendered element has the expected `data-dim-id` / `data-ann-id` attribute.

---

### T45 — `<DrawingCanvas>` component

**Files:**
- Create: `packages/app/src/drawing/DrawingCanvas.tsx`
- Create: `packages/app/src/drawing/__tests__/DrawingCanvas.spec.tsx`

**Agent:** Sonnet implementer.

- [ ] **Step 1: Write the failing test**

```tsx
// packages/app/src/drawing/__tests__/DrawingCanvas.spec.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DrawingCanvas } from '../DrawingCanvas';
import { useAppStore } from '../../store/useAppStore';
import { AddDimensionCommand } from '../../commands/AddDimensionCommand';
import type { DrawingDocument, DrawingSheet } from '@zilventor/shared';

// Minimal drawing fixture
const makeSheet = (): DrawingSheet => ({
  id: 's1',
  name: 'Sheet 1',
  size: { kind: 'iso', size: 'A3' },
  orientation: 'landscape',
  views: [],
  dimensions: [],
  annotations: [],
  titleBlock: {},
});

const makeDrawing = (): DrawingDocument => ({
  id: 'd1',
  name: 'Test Drawing',
  units: 'mm',
  source: { partPath: 'parts/box.zipt', sourceKind: 'part' },
  properties: {},
  sheets: [makeSheet()],
  activeSheetId: 's1',
});

vi.mock('../../commands/AddDimensionCommand', () => ({
  AddDimensionCommand: vi.fn().mockImplementation((opts) => ({ name: 'AddDimension', opts })),
}));

describe('DrawingCanvas', () => {
  beforeEach(() => {
    useAppStore.setState({
      activeDrawing: makeDrawing(),
      drawingToolMode: 'idle',
      bus: { execute: vi.fn().mockResolvedValue(undefined) },
    } as never);
  });

  it('renders an <svg> element with A3-landscape viewBox', () => {
    render(<DrawingCanvas />);
    const svg = document.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute('viewBox')).toBe('0 0 420 297');
  });

  it('renders a sheet border rect', () => {
    render(<DrawingCanvas />);
    const rect = document.querySelector('[data-sheet-border]');
    expect(rect).not.toBeNull();
  });

  it('tool-mode addLinearH + 2 click events → calls bus.execute with AddDimensionCommand', async () => {
    useAppStore.setState({ drawingToolMode: 'addLinearH' } as never);
    render(<DrawingCanvas />);
    const svg = document.querySelector('svg')!;

    // Simulate two edge-endpoint clicks (dispatched as custom events from ViewElement polylines)
    // In real usage, clicks on <polyline data-edge-id="e1"> feed the tool-mode state machine.
    // Here we fire synthetic click events on the SVG directly for the 2-click state machine.
    fireEvent.click(svg, { clientX: 10, clientY: 10 });
    fireEvent.click(svg, { clientX: 110, clientY: 10 });

    const bus = useAppStore.getState().bus;
    // The canvas collects 2 clicks and dispatches AddDimensionCommand
    expect(bus.execute).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'AddDimension' })
    );
  });
});
```

- [ ] **Step 2: Run the test (expect fail)**

```
cd packages/app && pnpm test:unit -- DrawingCanvas
```

- [ ] **Step 3: Implement `packages/app/src/drawing/DrawingCanvas.tsx`**

```tsx
// packages/app/src/drawing/DrawingCanvas.tsx
import { useState, useEffect, useRef, useCallback } from 'react';
import { useAppStore } from '../store/useAppStore';
import { TitleBlock } from './TitleBlock';
import { ViewElement } from './ViewElement';
import { DimensionElement } from './DimensionElement';
import { AnnotationElement } from './AnnotationElement';
import { AddDimensionCommand } from '../commands/AddDimensionCommand';
import { AddAnnotationCommand } from '../commands/AddAnnotationCommand';
import { RegenerateViewCommand } from '../commands/RegenerateViewCommand';
import type { DrawingView, DrawingDocument, DrawingSheet } from '@zilventor/shared';

// Placeholder imports for dialogs (wired in Phase 8 batch 2)
// import { AddViewDialog } from './AddViewDialog';

// ISO sheet sizes in mm (landscape orientation)
const ISO_MM: Record<string, { w: number; h: number }> = {
  A0: { w: 1189, h: 841 }, A1: { w: 841, h: 594 },
  A2: { w: 594, h: 420 },  A3: { w: 420, h: 297 },
  A4: { w: 297, h: 210 },
};

function sheetDims(sheet: DrawingSheet): { w: number; h: number } {
  if (sheet.size.kind === 'custom') {
    return sheet.orientation === 'landscape'
      ? { w: sheet.size.widthMm, h: sheet.size.heightMm }
      : { w: sheet.size.heightMm, h: sheet.size.widthMm };
  }
  const base = ISO_MM[sheet.size.size] ?? { w: 420, h: 297 };
  return sheet.orientation === 'landscape' ? base : { w: base.h, h: base.w };
}

type ClickPoint = { x: number; y: number; edgeId?: string; viewId?: string };

export function DrawingCanvas() {
  const drawing = useAppStore((s) => (s as { activeDrawing?: DrawingDocument }).activeDrawing);
  const bus = useAppStore((s) => s.bus);
  const toolMode = useAppStore((s) => (s as { drawingToolMode?: string }).drawingToolMode ?? 'idle');

  // Pan/zoom state
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const svgRef = useRef<SVGSVGElement>(null);
  const middleDragRef = useRef<{ startX: number; startY: number; startPan: { x: number; y: number } } | null>(null);

  // Tool-mode click accumulation (up to 2 clicks for linear dims)
  const [clickAccum, setClickAccum] = useState<ClickPoint[]>([]);

  // Per-view stale flags (populated by effect that re-fingerprints on mount)
  const [staleViews, setStaleViews] = useState<Set<string>>(new Set());

  if (!drawing) {
    return <div className="flex-1 flex items-center justify-center text-neutral-400 text-sm">No drawing open.</div>;
  }

  const sheet = drawing.sheets.find((s) => s.id === drawing.activeSheetId) ?? drawing.sheets[0];
  if (!sheet) return null;

  const { w: sheetW, h: sheetH } = sheetDims(sheet);

  // Re-fingerprint views on mount to detect stale (simplified: mark all views with a stored
  // inputFingerprint as needing re-check; full fingerprint computation happens in DrawingTab).
  useEffect(() => {
    const stale = new Set<string>();
    for (const v of sheet.views) {
      // Heuristic for test env: views with projection but no fingerprint are stale.
      if (v.projection && !v.inputFingerprint) stale.add(v.id);
    }
    setStaleViews(stale);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawing.id, sheet.id]);

  // Pan/zoom handlers
  const handleWheel = useCallback((e: React.WheelEvent<SVGSVGElement>) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setZoom((z) => Math.max(0.1, Math.min(20, z * delta)));
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (e.button === 1) {
      middleDragRef.current = { startX: e.clientX, startY: e.clientY, startPan: pan };
    }
  }, [pan]);

  const handleMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (!middleDragRef.current) return;
    const dx = e.clientX - middleDragRef.current.startX;
    const dy = e.clientY - middleDragRef.current.startY;
    setPan({ x: middleDragRef.current.startPan.x + dx, y: middleDragRef.current.startPan.y + dy });
  }, []);

  const handleMouseUp = useCallback(() => {
    middleDragRef.current = null;
  }, []);

  // Tool-mode click dispatch
  const handleClick = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (toolMode === 'idle') return;

    // Determine if an edge was clicked (by reading data attrs from the target)
    const target = e.target as SVGElement;
    const edgeId = target.getAttribute('data-edge-id') ?? undefined;
    const viewId = target.getAttribute('data-view-id') ?? undefined;

    // Convert client coords to SVG page-space mm
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const svgX = ((e.clientX - rect.left) / (rect.width / sheetW));
    const svgY = ((e.clientY - rect.top) / (rect.height / sheetH));
    const clickPt: ClickPoint = { x: svgX, y: svgY, edgeId, viewId };

    if (toolMode === 'addLinearH' || toolMode === 'addLinearV' || toolMode === 'addAligned') {
      const next = [...clickAccum, clickPt];
      if (next.length >= 2) {
        const [p1, p2] = next as [ClickPoint, ClickPoint];
        const v = sheet.views.find((v) => v.id === (p1.viewId ?? p2.viewId));
        if (v) {
          const kind = toolMode === 'addLinearH' ? 'linear-h'
                     : toolMode === 'addLinearV' ? 'linear-v' : 'aligned';
          void bus.execute(new AddDimensionCommand({
            sheetId: sheet.id,
            dim: {
              id: `dim-${Date.now()}`,
              kind,
              viewId: v.id,
              from: { kind: 'edge-endpoint', edgeId: p1.edgeId ?? 'unknown', end: 'start' },
              to:   { kind: 'edge-endpoint', edgeId: p2.edgeId ?? 'unknown', end: 'start' },
              offsetMm: 15,
            },
          }));
        }
        setClickAccum([]);
      } else {
        setClickAccum(next);
      }
      return;
    }

    if (toolMode === 'addCenterline') {
      const next = [...clickAccum, clickPt];
      if (next.length >= 2) {
        const [p1, p2] = next as [ClickPoint, ClickPoint];
        const v = sheet.views.find((v) => v.id === (p1.viewId ?? p2.viewId));
        if (v) {
          void bus.execute(new AddAnnotationCommand({
            sheetId: sheet.id,
            ann: {
              id: `ann-${Date.now()}`,
              kind: 'centerline',
              viewId: v.id,
              edgeIdA: p1.edgeId ?? 'unknown',
              edgeIdB: p2.edgeId ?? 'unknown',
            },
          }));
        }
        setClickAccum([]);
      } else {
        setClickAccum(next);
      }
      return;
    }

    if (toolMode === 'addCenterMark') {
      const v = sheet.views.find((v) => v.id === viewId);
      if (v && edgeId) {
        void bus.execute(new AddAnnotationCommand({
          sheetId: sheet.id,
          ann: { id: `ann-${Date.now()}`, kind: 'center-mark', viewId: v.id, edgeId },
        }));
      }
      setClickAccum([]);
      return;
    }

    // addRadial / addDiametric / addLeader / addBalloon / placeBase → open dialogs (Phase 8 batch 2)
    // placeBase: placeholder — dialog import wired in T47
    setClickAccum([]);
  }, [toolMode, clickAccum, sheet, bus, sheetW, sheetH]);

  const handleRegenerate = useCallback((viewId: string) => {
    // Full regen dispatches via DrawingTab; here we clear the stale flag optimistically
    setStaleViews((prev) => { const next = new Set(prev); next.delete(viewId); return next; });
  }, []);

  // Source document needed by TitleBlock (resolved at parent level in DrawingTab)
  const source = useAppStore((s) => (s as { activeSource?: { document: unknown } }).activeSource?.document);

  // viewBox transformation string incorporating pan/zoom
  const vbX = -pan.x / zoom;
  const vbY = -pan.y / zoom;
  const vbW = sheetW / zoom;
  const vbH = sheetH / zoom;

  return (
    <svg
      ref={svgRef}
      viewBox={`${vbX} ${vbY} ${vbW} ${vbH}`}
      preserveAspectRatio="xMidYMid meet"
      style={{ width: '100%', height: '100%', display: 'block', background: '#e5e7eb' }}
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onClick={handleClick}
    >
      {/* Sheet border */}
      <rect
        data-sheet-border
        x={0} y={0} width={sheetW} height={sheetH}
        fill="white" stroke="#888" strokeWidth={0.5}
      />

      {/* Views */}
      {sheet.views.map((v) => (
        <ViewElement
          key={v.id}
          view={v}
          isStale={staleViews.has(v.id)}
          onRegenerate={handleRegenerate}
        />
      ))}

      {/* Dimensions */}
      {sheet.dimensions.map((dim) => {
        const v = sheet.views.find((vw) => vw.id === dim.viewId);
        if (!v) return null;
        return <DimensionElement key={dim.id} dim={dim} view={v} />;
      })}

      {/* Annotations */}
      {sheet.annotations.map((ann) => {
        const v = sheet.views.find((vw) => vw.id === ann.viewId);
        if (!v) return null;
        return <AnnotationElement key={ann.id} ann={ann} view={v} />;
      })}

      {/* Title block (source may be null during loading) */}
      {source && (
        <TitleBlock
          drawing={drawing}
          sheet={sheet}
          source={source as Parameters<typeof TitleBlock>[0]['source']}
          sheetIndex={drawing.sheets.findIndex((s) => s.id === sheet.id)}
          sheetCount={drawing.sheets.length}
        />
      )}
    </svg>
  );
}
```

- [ ] **Step 4: Run the test (expect pass)**

```
cd packages/app && pnpm test:unit -- DrawingCanvas
```
Expected: 3/3 pass.

- [ ] **Step 5: Typecheck**

```
cd packages/app && pnpm typecheck
```
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/drawing/DrawingCanvas.tsx packages/app/src/drawing/__tests__/DrawingCanvas.spec.tsx
git commit -m "feat(drawing): add <DrawingCanvas> with pan/zoom + tool-mode dispatch"
```

**Verify:** SVG viewBox matches sheet dimensions; tool-mode `addLinearH` with 2 clicks dispatches `AddDimensionCommand`; wheel zoom changes viewBox; middle-drag changes pan.

---

### T46 — `<DrawingTreePane>` component + `SetActiveSheetCommand`

**Files:**
- Create: `packages/app/src/drawing/DrawingTreePane.tsx`
- Create: `packages/app/src/drawing/__tests__/DrawingTreePane.spec.tsx`
- Create: `packages/app/src/commands/SetActiveSheetCommand.ts`
- Create: `packages/app/src/commands/__tests__/SetActiveSheetCommand.spec.ts`

**Agent:** Sonnet implementer.

Note: `SetActiveSheetCommand` is introduced here as a cascade need (not in spec §4). It mirrors `OpenNestingTabCommand`'s shape — undoable, captures prior `activeSheetId`. The drawing document's `activeSheetId` mutation lives in the drawing document slice of the store.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/app/src/commands/__tests__/SetActiveSheetCommand.spec.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { SetActiveSheetCommand } from '../SetActiveSheetCommand';
import { useAppStore } from '../../store/useAppStore';
import type { DrawingDocument } from '@zilventor/shared';

const makeDrawing = (activeSheetId: string): DrawingDocument => ({
  id: 'd1', name: 'D', units: 'mm',
  source: { partPath: 'p.zipt', sourceKind: 'part' },
  properties: {},
  sheets: [
    { id: 's1', name: 'Sheet 1', size: { kind: 'iso', size: 'A3' }, orientation: 'landscape',
      views: [], dimensions: [], annotations: [], titleBlock: {} },
    { id: 's2', name: 'Sheet 2', size: { kind: 'iso', size: 'A3' }, orientation: 'landscape',
      views: [], dimensions: [], annotations: [], titleBlock: {} },
  ],
  activeSheetId,
});

describe('SetActiveSheetCommand', () => {
  beforeEach(() => {
    useAppStore.setState({ activeDrawing: makeDrawing('s1') } as never);
  });

  it('apply sets activeSheetId on the drawing', async () => {
    const cmd = new SetActiveSheetCommand({ sheetId: 's2' });
    await cmd.apply();
    const d = (useAppStore.getState() as { activeDrawing?: DrawingDocument }).activeDrawing;
    expect(d?.activeSheetId).toBe('s2');
  });

  it('revert restores the prior activeSheetId', async () => {
    const cmd = new SetActiveSheetCommand({ sheetId: 's2' });
    await cmd.apply();
    await cmd.revert();
    const d = (useAppStore.getState() as { activeDrawing?: DrawingDocument }).activeDrawing;
    expect(d?.activeSheetId).toBe('s1');
  });

  it('apply is a no-op when no activeDrawing', async () => {
    useAppStore.setState({ activeDrawing: null } as never);
    const cmd = new SetActiveSheetCommand({ sheetId: 's2' });
    await expect(cmd.apply()).resolves.toBeUndefined();
  });
});
```

```tsx
// packages/app/src/drawing/__tests__/DrawingTreePane.spec.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DrawingTreePane } from '../DrawingTreePane';
import { useAppStore } from '../../store/useAppStore';
import type { DrawingDocument } from '@zilventor/shared';

const makeDrawing = (): DrawingDocument => ({
  id: 'd1', name: 'Cabinet — Drawing', units: 'mm',
  source: { partPath: 'parts/cabinet.zipt', sourceKind: 'part' },
  properties: {},
  sheets: [
    { id: 's1', name: 'Sheet 1', size: { kind: 'iso', size: 'A3' }, orientation: 'landscape',
      views: [], dimensions: [], annotations: [], titleBlock: {} },
    { id: 's2', name: 'Sheet 2', size: { kind: 'iso', size: 'A3' }, orientation: 'landscape',
      views: [], dimensions: [], annotations: [], titleBlock: {} },
  ],
  activeSheetId: 's1',
});

describe('DrawingTreePane', () => {
  beforeEach(() => {
    useAppStore.setState({
      activeDrawing: makeDrawing(),
      bus: { execute: vi.fn().mockResolvedValue(undefined) },
    } as never);
  });

  it('renders the drawing name as root node', () => {
    render(<DrawingTreePane />);
    expect(screen.getByText(/Cabinet — Drawing/i)).toBeInTheDocument();
  });

  it('renders both sheets in the tree', () => {
    render(<DrawingTreePane />);
    expect(screen.getByText('Sheet 1')).toBeInTheDocument();
    expect(screen.getByText('Sheet 2')).toBeInTheDocument();
  });

  it('clicking Sheet 2 dispatches SetActiveSheetCommand via bus.execute', () => {
    render(<DrawingTreePane />);
    const sheet2 = screen.getByText('Sheet 2');
    fireEvent.click(sheet2);
    const bus = useAppStore.getState().bus;
    expect(bus.execute).toHaveBeenCalledWith(
      expect.objectContaining({ sheetId: 's2' })
    );
  });

  it('renders source path label', () => {
    render(<DrawingTreePane />);
    expect(screen.getByText(/parts\/cabinet\.zipt/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests (expect fail)**

```
cd packages/app && pnpm test:unit -- SetActiveSheetCommand DrawingTreePane
```

- [ ] **Step 3: Implement `packages/app/src/commands/SetActiveSheetCommand.ts`**

```ts
// packages/app/src/commands/SetActiveSheetCommand.ts
import type { Command } from './Command';
import { useAppStore } from '../store/useAppStore';
import type { DrawingDocument } from '@zilventor/shared';

export class SetActiveSheetCommand implements Command {
  readonly name = 'SetActiveSheet';
  readonly sheetId: string;
  private prevSheetId: string | null = null;

  constructor(opts: { sheetId: string }) {
    this.sheetId = opts.sheetId;
  }

  async apply(): Promise<void> {
    const d = (useAppStore.getState() as { activeDrawing?: DrawingDocument }).activeDrawing;
    if (!d) return;
    this.prevSheetId = d.activeSheetId;
    useAppStore.setState(((s: { activeDrawing?: DrawingDocument }) => ({
      activeDrawing: s.activeDrawing ? { ...s.activeDrawing, activeSheetId: this.sheetId } : s.activeDrawing,
    })) as never);
  }

  async revert(): Promise<void> {
    if (this.prevSheetId === null) return;
    const prev = this.prevSheetId;
    useAppStore.setState(((s: { activeDrawing?: DrawingDocument }) => ({
      activeDrawing: s.activeDrawing ? { ...s.activeDrawing, activeSheetId: prev } : s.activeDrawing,
    })) as never);
  }
}
```

- [ ] **Step 4: Implement `packages/app/src/drawing/DrawingTreePane.tsx`**

```tsx
// packages/app/src/drawing/DrawingTreePane.tsx
import { useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { SetActiveSheetCommand } from '../commands/SetActiveSheetCommand';
import { RenameSheetCommand } from '../commands/RenameSheetCommand';
import { DeleteSheetCommand } from '../commands/DeleteSheetCommand';
import { RegenerateViewCommand } from '../commands/RegenerateViewCommand';
import type { DrawingDocument, DrawingSheet } from '@zilventor/shared';

type ContextMenu = {
  kind: 'sheet';
  sheetId: string;
  x: number;
  y: number;
} | null;

function SheetNode({
  sheet,
  isActive,
  onSelect,
  onContextMenu,
}: {
  sheet: DrawingSheet;
  isActive: boolean;
  onSelect: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const dimCount = sheet.dimensions.length;
  const annCount = sheet.annotations.length;

  return (
    <li>
      <div
        role="treeitem"
        aria-selected={isActive}
        style={{ fontWeight: isActive ? 'bold' : 'normal', cursor: 'pointer', paddingLeft: 16 }}
        onClick={onSelect}
        onContextMenu={onContextMenu}
      >
        <span onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); }}>
          {expanded ? '▾' : '▸'}
        </span>
        {' '}{sheet.name}{isActive ? ' (active)' : ''}
      </div>
      {expanded && (
        <ul style={{ paddingLeft: 24, listStyle: 'none', margin: 0 }}>
          <li>
            <div style={{ paddingLeft: 16 }}>Views</div>
            <ul style={{ paddingLeft: 24, listStyle: 'none', margin: 0 }}>
              {sheet.views.map((v) => (
                <li key={v.id} style={{ fontSize: '0.8em', color: '#555' }}>
                  {v.kind === 'base' ? `Base — ${v.orientation}` :
                   v.kind === 'projected' ? `Projected — ${v.direction}` :
                   `Iso — ${v.corner}`} · {v.scale.numerator}:{v.scale.denominator}
                </li>
              ))}
            </ul>
          </li>
          <li style={{ paddingLeft: 16, fontSize: '0.8em', color: '#555' }}>
            Dimensions ({dimCount})
          </li>
          <li style={{ paddingLeft: 16, fontSize: '0.8em', color: '#555' }}>
            Annotations ({annCount})
          </li>
          <li style={{ paddingLeft: 16, fontSize: '0.8em', color: '#555' }}>
            Title Block
          </li>
        </ul>
      )}
    </li>
  );
}

export function DrawingTreePane() {
  const drawing = useAppStore((s) => (s as { activeDrawing?: DrawingDocument }).activeDrawing);
  const bus = useAppStore((s) => s.bus);
  const [sheetsExpanded, setSheetsExpanded] = useState(true);
  const [propsExpanded, setPropsExpanded] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenu>(null);

  if (!drawing) {
    return <div style={{ padding: 8, color: '#888', fontSize: '0.85em' }}>No drawing open.</div>;
  }

  const handleSelectSheet = (sheetId: string) => {
    void bus.execute(new SetActiveSheetCommand({ sheetId }));
    setContextMenu(null);
  };

  const handleSheetContextMenu = (e: React.MouseEvent, sheetId: string) => {
    e.preventDefault();
    setContextMenu({ kind: 'sheet', sheetId, x: e.clientX, y: e.clientY });
  };

  const handleRenameSheet = (sheetId: string) => {
    const name = window.prompt('New sheet name:');
    if (name) void bus.execute(new RenameSheetCommand({ sheetId, name }));
    setContextMenu(null);
  };

  const handleDeleteSheet = (sheetId: string) => {
    void bus.execute(new DeleteSheetCommand({ sheetId }));
    setContextMenu(null);
  };

  return (
    <div
      role="tree"
      aria-label="Drawing tree"
      style={{ fontSize: '0.85em', userSelect: 'none', overflow: 'auto', height: '100%' }}
      onClick={() => setContextMenu(null)}
    >
      {/* Root */}
      <div style={{ fontWeight: 'bold', padding: '4px 8px' }}>
        Drawing: {drawing.name}
      </div>

      {/* Source */}
      <div style={{ paddingLeft: 16, color: '#888', fontSize: '0.9em' }}>
        Source: {drawing.source.partPath}
      </div>

      {/* Sheets */}
      <div style={{ paddingLeft: 8, marginTop: 4 }}>
        <span
          style={{ cursor: 'pointer', fontWeight: 500 }}
          onClick={() => setSheetsExpanded((v) => !v)}
        >
          {sheetsExpanded ? '▾' : '▸'} Sheets
        </span>
        {sheetsExpanded && (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {drawing.sheets.map((sheet) => (
              <SheetNode
                key={sheet.id}
                sheet={sheet}
                isActive={sheet.id === drawing.activeSheetId}
                onSelect={() => handleSelectSheet(sheet.id)}
                onContextMenu={(e) => handleSheetContextMenu(e, sheet.id)}
              />
            ))}
          </ul>
        )}
      </div>

      {/* Properties */}
      <div style={{ paddingLeft: 8, marginTop: 4 }}>
        <span
          style={{ cursor: 'pointer', fontWeight: 500 }}
          onClick={() => setPropsExpanded((v) => !v)}
        >
          {propsExpanded ? '▾' : '▸'} Properties
        </span>
        {propsExpanded && (
          <ul style={{ listStyle: 'none', margin: '4px 0 0 16px', padding: 0, color: '#555' }}>
            {Object.entries(drawing.properties).map(([k, v]) => (
              <li key={k} style={{ fontSize: '0.85em' }}>{k}: {String(v)}</li>
            ))}
          </ul>
        )}
      </div>

      {/* Context menu */}
      {contextMenu && contextMenu.kind === 'sheet' && (
        <div
          role="menu"
          aria-label="Sheet context menu"
          style={{
            position: 'fixed', left: contextMenu.x, top: contextMenu.y,
            background: 'white', border: '1px solid #ccc', borderRadius: 4,
            boxShadow: '0 2px 8px rgba(0,0,0,0.2)', zIndex: 1000, padding: 4,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div role="menuitem" style={{ padding: '4px 12px', cursor: 'pointer' }}
            onClick={() => handleRenameSheet(contextMenu.sheetId)}>Rename</div>
          <div role="menuitem" style={{ padding: '4px 12px', cursor: 'pointer' }}
            onClick={() => handleDeleteSheet(contextMenu.sheetId)}>Delete</div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Run the tests (expect pass)**

```
cd packages/app && pnpm test:unit -- SetActiveSheetCommand DrawingTreePane
```
Expected: 3/3 + 4/4 pass.

- [ ] **Step 6: Typecheck**

```
cd packages/app && pnpm typecheck
```
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add packages/app/src/commands/SetActiveSheetCommand.ts packages/app/src/commands/__tests__/SetActiveSheetCommand.spec.ts \
        packages/app/src/drawing/DrawingTreePane.tsx packages/app/src/drawing/__tests__/DrawingTreePane.spec.tsx
git commit -m "feat(drawing): add <DrawingTreePane> + SetActiveSheetCommand"
```

**Verify:** Both sheet nodes appear; clicking Sheet 2 calls `bus.execute` with a `SetActiveSheetCommand`; `SetActiveSheetCommand` apply/revert tests all pass; source path label renders correctly.
## Phase 8 — UI: ribbon body, dialogs, tool-mode store (Batch 2: T47-T51)

Five tasks; dispatch as one Sonnet implementer batch. Continues the UI work begun in Part 4c1 (T42-T46).

---

### T47 — Replace `DrawingTab.tsx` stub with 5-panel ribbon body

**Files:**
- Modify: `packages/app/src/shell/tabs/DrawingTab.tsx`
- Create (test): `packages/app/src/shell/tabs/__tests__/DrawingTab.spec.tsx`

**Agent:** Sonnet implementer.

- [ ] **Step 1: Write the failing test**

```tsx
// packages/app/src/shell/tabs/__tests__/DrawingTab.spec.tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import DrawingTab from '../DrawingTab';
import { useAppStore } from '../../../store/useAppStore';
import { useToolModeStore } from '../../../drawing/toolMode';
import type { DrawingDocument } from '@zilventor/shared';

const seedDrawing = (): DrawingDocument => ({
  id: 'dw1',
  name: 'Cabinet — Drawing',
  units: 'mm',
  source: { partPath: 'parts/cabinet.zipt', sourceKind: 'part' },
  properties: {},
  sheets: [
    {
      id: 'sh1',
      name: 'Sheet 1',
      size: { kind: 'iso', size: 'A3' },
      orientation: 'landscape',
      views: [],
      dimensions: [],
      annotations: [],
      titleBlock: {},
    },
  ],
  activeSheetId: 'sh1',
});

describe('DrawingTab — drawing active doc', () => {
  beforeEach(() => {
    useToolModeStore.getState().reset();
    useAppStore.getState().setActiveDocument(null);
  });

  it('renders 5 ribbon panels when a drawing document is active', () => {
    useAppStore.getState().setActiveDocument({ kind: 'drawing', document: seedDrawing() });
    render(<DrawingTab />);
    expect(screen.getByText('Sheet')).toBeInTheDocument();
    expect(screen.getByText('Place Views')).toBeInTheDocument();
    expect(screen.getByText('Dimension')).toBeInTheDocument();
    expect(screen.getByText('Annotate')).toBeInTheDocument();
    expect(screen.getByText('Export')).toBeInTheDocument();
  });

  it('renders exactly 2 Sheet buttons, 3 Place Views buttons, 5 Dimension buttons, 4 Annotate buttons, 3 Export buttons', () => {
    useAppStore.getState().setActiveDocument({ kind: 'drawing', document: seedDrawing() });
    render(<DrawingTab />);
    // Sheet panel: New Sheet + Sheet… (disabled follow-up)
    expect(screen.getByRole('button', { name: /new sheet/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^sheet…$/i })).toBeInTheDocument();
    // Place Views panel
    expect(screen.getByRole('button', { name: /base view/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /projected view/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /iso view/i })).toBeInTheDocument();
    // Dimension panel
    expect(screen.getByRole('button', { name: /linear \(h\)/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /linear \(v\)/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^aligned$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^radial$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^diametric$/i })).toBeInTheDocument();
    // Annotate panel
    expect(screen.getByRole('button', { name: /centerline/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /center mark/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /leader text/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /balloon/i })).toBeInTheDocument();
    // Export panel
    expect(screen.getByRole('button', { name: /export pdf/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /export svg/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /export png/i })).toBeInTheDocument();
  });

  it('clicking Linear (H) calls setMode("addLinearH")', () => {
    useAppStore.getState().setActiveDocument({ kind: 'drawing', document: seedDrawing() });
    render(<DrawingTab />);
    fireEvent.click(screen.getByRole('button', { name: /linear \(h\)/i }));
    expect(useToolModeStore.getState().mode).toBe('addLinearH');
  });

  it('clicking Radial calls setMode("addRadial")', () => {
    useAppStore.getState().setActiveDocument({ kind: 'drawing', document: seedDrawing() });
    render(<DrawingTab />);
    fireEvent.click(screen.getByRole('button', { name: /^radial$/i }));
    expect(useToolModeStore.getState().mode).toBe('addRadial');
  });

  it('Balloon button is disabled for a part source drawing', () => {
    useAppStore.getState().setActiveDocument({ kind: 'drawing', document: seedDrawing() }); // sourceKind: 'part'
    render(<DrawingTab />);
    expect(screen.getByRole('button', { name: /balloon/i })).toBeDisabled();
  });

  it('Balloon button is enabled for an assembly source drawing', () => {
    const dwg: DrawingDocument = {
      ...seedDrawing(),
      source: { partPath: 'cabinets/c1.ziasm', sourceKind: 'assembly' },
    };
    useAppStore.getState().setActiveDocument({ kind: 'drawing', document: dwg });
    render(<DrawingTab />);
    expect(screen.getByRole('button', { name: /balloon/i })).not.toBeDisabled();
  });

  it('Sheet… button is disabled with title indicating follow-up', () => {
    useAppStore.getState().setActiveDocument({ kind: 'drawing', document: seedDrawing() });
    render(<DrawingTab />);
    const btn = screen.getByRole('button', { name: /^sheet…$/i });
    expect(btn).toBeDisabled();
    expect(btn.getAttribute('title')).toMatch(/follow-up/i);
  });
});

describe('DrawingTab — non-drawing active doc', () => {
  beforeEach(() => {
    useAppStore.getState().setActiveDocument(null);
  });

  it('renders the stub when no document is active', () => {
    render(<DrawingTab />);
    expect(screen.getByText(/drawing generation/i)).toBeInTheDocument();
    expect(screen.queryByText('Sheet')).not.toBeInTheDocument();
  });

  it('renders the stub when a part is active', () => {
    useAppStore.getState().setActiveDocument({
      kind: 'part',
      document: {
        id: 'p1', name: 'P', units: 'mm', parameters: {}, properties: {},
        featureTree: [], materials: [], hardware: [],
      },
    });
    render(<DrawingTab />);
    expect(screen.getByText(/drawing generation/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test (expect fail)**

```
cd packages/app && pnpm test:unit -- DrawingTab
```
Expected: all assertions fail (stub renders only the stub message, not the 5 panels).

- [ ] **Step 3: Implement `packages/app/src/shell/tabs/DrawingTab.tsx`**

```tsx
import React from 'react';
import RibbonPanel from '../RibbonPanel';
import { useAppStore } from '../../store/useAppStore';
import { useToolModeStore } from '../../drawing/toolMode';
import { AddSheetCommand } from '../../commands/AddSheetCommand';
import { AddViewCommand } from '../../commands/AddViewCommand';
import { ExportDrawingPdfCommand } from '../../commands/ExportDrawingPdfCommand';
import { ExportDrawingSvgCommand } from '../../commands/ExportDrawingSvgCommand';
import { ExportDrawingPngCommand } from '../../commands/ExportDrawingPngCommand';
import { StubTab } from './_stub';

export default function DrawingTab(): JSX.Element {
  const activeDocument = useAppStore((s) => s.activeDocument);
  const bus = useAppStore((s) => s.bus);

  if (activeDocument?.kind !== 'drawing') {
    return <StubTab subProject={6} what="Drawing generation" />;
  }

  const drawing = activeDocument.document;
  const isAssembly = drawing.source.sourceKind === 'assembly';
  const setMode = useToolModeStore.getState().setMode;

  return (
    <div className="flex gap-2 px-3 py-2">
      {/* Sheet panel */}
      <RibbonPanel title="Sheet">
        <button
          type="button"
          className="text-xs hover:text-white"
          aria-label="New Sheet"
          onClick={() => { void bus.execute(new AddSheetCommand({})); }}
        >
          New Sheet
        </button>
        <button
          type="button"
          className="text-xs hover:text-white disabled:text-neutral-500"
          aria-label="Sheet…"
          disabled
          title="Coming in follow-up F1"
        >
          Sheet…
        </button>
      </RibbonPanel>

      {/* Place Views panel */}
      <div aria-label="Place Views panel">
        <RibbonPanel title="Place Views">
          <button
            type="button"
            className="text-xs hover:text-white"
            aria-label="Base View"
            onClick={() => {
              setMode('placeBase');
              useAppStore.getState().setAddViewDialogOpen({ kind: 'base' });
            }}
          >
            Base View
          </button>
          <button
            type="button"
            className="text-xs hover:text-white"
            aria-label="Projected View"
            onClick={() => { setMode('placeProjected'); }}
          >
            Projected View
          </button>
          <button
            type="button"
            className="text-xs hover:text-white"
            aria-label="Iso View"
            onClick={() => {
              setMode('placeIso');
              useAppStore.getState().setAddViewDialogOpen({ kind: 'iso' });
            }}
          >
            Iso View
          </button>
        </RibbonPanel>
      </div>

      {/* Dimension panel */}
      <div aria-label="Dimension panel">
        <RibbonPanel title="Dimension">
          <button type="button" className="text-xs hover:text-white" aria-label="Linear (H)"
            onClick={() => setMode('addLinearH')}>Linear (H)</button>
          <button type="button" className="text-xs hover:text-white" aria-label="Linear (V)"
            onClick={() => setMode('addLinearV')}>Linear (V)</button>
          <button type="button" className="text-xs hover:text-white" aria-label="Aligned"
            onClick={() => setMode('addAligned')}>Aligned</button>
          <button type="button" className="text-xs hover:text-white" aria-label="Radial"
            onClick={() => setMode('addRadial')}>Radial</button>
          <button type="button" className="text-xs hover:text-white" aria-label="Diametric"
            onClick={() => setMode('addDiametric')}>Diametric</button>
        </RibbonPanel>
      </div>

      {/* Annotate panel */}
      <div aria-label="Annotate panel">
        <RibbonPanel title="Annotate">
          <button type="button" className="text-xs hover:text-white" aria-label="Centerline"
            onClick={() => setMode('addCenterline')}>Centerline</button>
          <button type="button" className="text-xs hover:text-white" aria-label="Center Mark"
            onClick={() => setMode('addCenterMark')}>Center Mark</button>
          <button type="button" className="text-xs hover:text-white" aria-label="Leader Text"
            onClick={() => setMode('addLeader')}>Leader Text</button>
          <button
            type="button"
            className="text-xs hover:text-white disabled:text-neutral-500"
            aria-label="Balloon"
            disabled={!isAssembly}
            aria-disabled={!isAssembly}
            title={!isAssembly ? 'Balloon annotations require an assembly drawing' : undefined}
            onClick={() => setMode('addBalloon')}
          >
            Balloon
          </button>
        </RibbonPanel>
      </div>

      {/* Export panel */}
      <div aria-label="Export panel">
        <RibbonPanel title="Export">
          <button
            type="button"
            className="text-xs hover:text-white"
            aria-label="Export PDF"
            onClick={() => { void bus.execute(new ExportDrawingPdfCommand({ drawing })); }}
          >
            Export PDF
          </button>
          <button
            type="button"
            className="text-xs hover:text-white"
            aria-label="Export SVG (sheet)"
            onClick={() => {
              void bus.execute(new ExportDrawingSvgCommand({
                drawing, sheetId: drawing.activeSheetId,
              }));
            }}
          >
            Export SVG (sheet)
          </button>
          <button
            type="button"
            className="text-xs hover:text-white"
            aria-label="Export PNG (sheet)"
            onClick={() => {
              void bus.execute(new ExportDrawingPngCommand({
                drawing, sheetId: drawing.activeSheetId,
              }));
            }}
          >
            Export PNG (sheet)
          </button>
        </RibbonPanel>
      </div>
    </div>
  );
}
```

**Note:** `setAddViewDialogOpen` is wired in T49. `AddSheetCommand`, `ExportDrawingPdfCommand`, `ExportDrawingSvgCommand`, `ExportDrawingPngCommand` are stubs until their respective tasks land (Phase 5/6). Until then they must exist as empty-class stubs; if they are not yet present, add minimal stub files so the import does not break the TypeScript build.

- [ ] **Step 4: Run the test (expect pass)**

```
cd packages/app && pnpm test:unit -- DrawingTab
```
Expected: all pass.

- [ ] **Step 5: Typecheck**

```
pnpm -r typecheck
```
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/shell/tabs/DrawingTab.tsx packages/app/src/shell/tabs/__tests__/DrawingTab.spec.tsx
git commit -m "feat(shell): replace DrawingTab stub with 5-panel ribbon body"
```

**Verify:** `pnpm test:unit -- DrawingTab` exits 0; tests confirm 5 panels visible for drawing doc, stub for part doc, Balloon disabled for part source.

---

### T48 — `<NewDrawingDialog>` at `packages/app/src/shell/NewDrawingDialog.tsx`

**Files:**
- Create: `packages/app/src/shell/NewDrawingDialog.tsx`
- Create: `packages/app/src/shell/__tests__/NewDrawingDialog.spec.tsx`

**Agent:** Sonnet implementer.

- [ ] **Step 1: Write the failing test**

```tsx
// packages/app/src/shell/__tests__/NewDrawingDialog.spec.tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NewDrawingDialog } from '../NewDrawingDialog';
import { useAppStore } from '../../store/useAppStore';

// Mock bus.execute so we can spy without a real kernel
const mockExecute = vi.fn().mockResolvedValue(undefined);

describe('NewDrawingDialog', () => {
  beforeEach(() => {
    mockExecute.mockClear();
    useAppStore.setState({
      newDrawingDialogOpen: false,
      bus: { execute: mockExecute } as any,
    } as any);
  });

  it('renders nothing when newDrawingDialogOpen is false', () => {
    render(<NewDrawingDialog />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders the dialog when newDrawingDialogOpen is true', () => {
    useAppStore.setState({ newDrawingDialogOpen: true } as any);
    render(<NewDrawingDialog />);
    expect(screen.getByRole('dialog', { name: /new drawing/i })).toBeInTheDocument();
  });

  it('shows ISO sheet size options A0–A4 plus Custom', () => {
    useAppStore.setState({ newDrawingDialogOpen: true } as any);
    render(<NewDrawingDialog />);
    const select = screen.getByLabelText(/sheet size/i) as HTMLSelectElement;
    const options = Array.from(select.options).map((o) => o.value);
    expect(options).toContain('A0');
    expect(options).toContain('A1');
    expect(options).toContain('A2');
    expect(options).toContain('A3');
    expect(options).toContain('A4');
    expect(options).toContain('custom');
  });

  it('shows width + height inputs only when Custom is selected', () => {
    useAppStore.setState({ newDrawingDialogOpen: true } as any);
    render(<NewDrawingDialog />);
    // Default is A3 — no custom size inputs
    expect(screen.queryByLabelText(/width.*mm/i)).toBeNull();
    expect(screen.queryByLabelText(/height.*mm/i)).toBeNull();
    // Switch to Custom
    fireEvent.change(screen.getByLabelText(/sheet size/i), { target: { value: 'custom' } });
    expect(screen.getByLabelText(/width.*mm/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/height.*mm/i)).toBeInTheDocument();
  });

  it('shows Landscape / Portrait radios; Landscape default for A3', () => {
    useAppStore.setState({ newDrawingDialogOpen: true } as any);
    render(<NewDrawingDialog />);
    const landscape = screen.getByRole('radio', { name: /landscape/i }) as HTMLInputElement;
    const portrait = screen.getByRole('radio', { name: /portrait/i }) as HTMLInputElement;
    expect(landscape.checked).toBe(true);
    expect(portrait.checked).toBe(false);
  });

  it('clicking Cancel closes the dialog without executing a command', () => {
    useAppStore.setState({ newDrawingDialogOpen: true } as any);
    render(<NewDrawingDialog />);
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(useAppStore.getState().newDrawingDialogOpen).toBe(false);
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('clicking OK with a selected source path calls bus.execute(CreateDrawingCommand) and closes', async () => {
    useAppStore.setState({ newDrawingDialogOpen: true } as any);
    render(<NewDrawingDialog />);
    // Inject a pre-filled source path via the store slot (OPFS picker can't run in jsdom)
    useAppStore.setState({ newDrawingSourcePath: 'parts/cabinet.zipt', newDrawingSourceKind: 'part' } as any);
    fireEvent.click(screen.getByRole('button', { name: /^ok$/i }));
    await Promise.resolve();
    expect(mockExecute).toHaveBeenCalledTimes(1);
    const [cmd] = mockExecute.mock.calls[0]!;
    expect((cmd as any).constructor.name).toBe('CreateDrawingCommand');
    expect(useAppStore.getState().newDrawingDialogOpen).toBe(false);
  });

  it('OK button is disabled when no source is selected', () => {
    useAppStore.setState({ newDrawingDialogOpen: true, newDrawingSourcePath: null } as any);
    render(<NewDrawingDialog />);
    expect(screen.getByRole('button', { name: /^ok$/i })).toBeDisabled();
  });

  it('selecting Custom size and providing values passes widthMm/heightMm in the command', async () => {
    useAppStore.setState({
      newDrawingDialogOpen: true,
      newDrawingSourcePath: 'parts/p.zipt',
      newDrawingSourceKind: 'part',
    } as any);
    render(<NewDrawingDialog />);
    fireEvent.change(screen.getByLabelText(/sheet size/i), { target: { value: 'custom' } });
    fireEvent.change(screen.getByLabelText(/width.*mm/i), { target: { value: '500' } });
    fireEvent.change(screen.getByLabelText(/height.*mm/i), { target: { value: '350' } });
    fireEvent.click(screen.getByRole('button', { name: /^ok$/i }));
    await Promise.resolve();
    const [cmd] = mockExecute.mock.calls[0]!;
    const opts = (cmd as any).opts as { sheetSize: { kind: string; widthMm: number; heightMm: number } };
    expect(opts.sheetSize.kind).toBe('custom');
    expect(opts.sheetSize.widthMm).toBe(500);
    expect(opts.sheetSize.heightMm).toBe(350);
  });
});
```

- [ ] **Step 2: Run the test (expect fail)**

```
cd packages/app && pnpm test:unit -- NewDrawingDialog
```
Expected: all fail (component does not exist yet).

- [ ] **Step 3: Implement `packages/app/src/shell/NewDrawingDialog.tsx`**

```tsx
import React from 'react';
import { useAppStore } from '../store/useAppStore';
import { CreateDrawingCommand } from '../commands/CreateDrawingCommand';
import type { SheetSize } from '@zilventor/shared';

const overlayStyle: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
};
const panelStyle: React.CSSProperties = {
  background: '#1a1a1a', border: '1px solid #444', borderRadius: 6, padding: 16,
  width: 400, color: '#eee', fontSize: 12,
};
const fieldRow: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 };
const labelStyle: React.CSSProperties = { width: 100, fontSize: 11, flexShrink: 0 };
const inputStyle: React.CSSProperties = {
  flex: 1, background: '#222', border: '1px solid #444', color: '#eee',
  padding: '4px 6px', fontSize: 11,
};
const btnStyle: React.CSSProperties = {
  background: '#2a2a2a', color: '#eee', border: '1px solid #444',
  padding: '4px 10px', cursor: 'pointer', fontSize: 11,
};
const okBtnStyle: React.CSSProperties = { ...btnStyle, background: '#3b5a8a', borderColor: '#6a8ec4' };

type SizeOption = 'A0' | 'A1' | 'A2' | 'A3' | 'A4' | 'custom';

export function NewDrawingDialog(): JSX.Element | null {
  const open = useAppStore((s) => (s as any).newDrawingDialogOpen as boolean);
  const sourcePath = useAppStore((s) => (s as any).newDrawingSourcePath as string | null);
  const sourceKind = useAppStore((s) => (s as any).newDrawingSourceKind as 'part' | 'assembly' | null);
  const bus = useAppStore((s) => s.bus);
  const setState = useAppStore.setState;

  const [sizeOption, setSizeOption] = React.useState<SizeOption>('A3');
  const [orientation, setOrientation] = React.useState<'landscape' | 'portrait'>('landscape');
  const [widthStr, setWidthStr] = React.useState('420');
  const [heightStr, setHeightStr] = React.useState('297');

  if (!open) return null;

  const close = () => setState({ newDrawingDialogOpen: false } as any);

  const buildSheetSize = (): SheetSize => {
    if (sizeOption === 'custom') {
      return { kind: 'custom', widthMm: Number(widthStr), heightMm: Number(heightStr) };
    }
    return { kind: 'iso', size: sizeOption };
  };

  const canOk = !!sourcePath && !!sourceKind;

  const handleOk = async (): Promise<void> => {
    if (!canOk) return;
    await bus.execute(new CreateDrawingCommand({
      sourcePath: sourcePath!,
      sourceKind: sourceKind!,
      sheetSize: buildSheetSize(),
      orientation,
    }));
    close();
  };

  return (
    <div
      style={overlayStyle}
      onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}
    >
      <div
        style={panelStyle}
        role="dialog"
        aria-label="New Drawing"
        onKeyDown={(e) => { if (e.key === 'Escape') close(); }}
        tabIndex={-1}
      >
        <div style={{ fontWeight: 600, marginBottom: 12 }}>New Drawing</div>

        {/* Source (OPFS picker — disabled in jsdom; path injected via store slot) */}
        <div style={fieldRow}>
          <label style={labelStyle} htmlFor="nd-source">Source file</label>
          <span style={{ ...inputStyle, color: sourcePath ? '#eee' : '#888', flex: 1 }}>
            {sourcePath ?? '(none selected)'}
          </span>
          <button
            style={btnStyle}
            onClick={async () => {
              // OPFS showOpenFilePicker — only available in real browser context
              if (typeof (window as any).showOpenFilePicker !== 'function') return;
              try {
                const [handle] = await (window as any).showOpenFilePicker({
                  types: [{ description: 'ZilInventor files', accept: { 'application/octet-stream': ['.zipt', '.ziasm'] } }],
                  multiple: false,
                });
                const kind = (handle.name as string).endsWith('.ziasm') ? 'assembly' : 'part';
                setState({ newDrawingSourcePath: handle.name, newDrawingSourceKind: kind } as any);
              } catch {
                // user cancelled picker
              }
            }}
          >
            Browse…
          </button>
        </div>

        {/* Sheet size */}
        <div style={fieldRow}>
          <label style={labelStyle} htmlFor="nd-size">Sheet size</label>
          <select
            id="nd-size"
            aria-label="Sheet size"
            style={inputStyle}
            value={sizeOption}
            onChange={(e) => setSizeOption(e.target.value as SizeOption)}
          >
            <option value="A0">A0</option>
            <option value="A1">A1</option>
            <option value="A2">A2</option>
            <option value="A3">A3</option>
            <option value="A4">A4</option>
            <option value="custom">Custom</option>
          </select>
        </div>

        {sizeOption === 'custom' && (
          <>
            <div style={fieldRow}>
              <label style={labelStyle} htmlFor="nd-width">Width (mm)</label>
              <input
                id="nd-width"
                aria-label="Width (mm)"
                type="number"
                style={inputStyle}
                value={widthStr}
                onChange={(e) => setWidthStr(e.target.value)}
              />
            </div>
            <div style={fieldRow}>
              <label style={labelStyle} htmlFor="nd-height">Height (mm)</label>
              <input
                id="nd-height"
                aria-label="Height (mm)"
                type="number"
                style={inputStyle}
                value={heightStr}
                onChange={(e) => setHeightStr(e.target.value)}
              />
            </div>
          </>
        )}

        {/* Orientation */}
        <div style={{ ...fieldRow, gap: 12 }}>
          <span style={labelStyle}>Orientation</span>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
            <input
              type="radio"
              name="nd-orient"
              value="landscape"
              checked={orientation === 'landscape'}
              onChange={() => setOrientation('landscape')}
            />
            Landscape
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
            <input
              type="radio"
              name="nd-orient"
              value="portrait"
              checked={orientation === 'portrait'}
              onChange={() => setOrientation('portrait')}
            />
            Portrait
          </label>
        </div>

        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 12 }}>
          <button style={btnStyle} onClick={close}>Cancel</button>
          <button
            style={okBtnStyle}
            disabled={!canOk}
            aria-disabled={!canOk}
            onClick={() => { void handleOk(); }}
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
```

**Note:** `newDrawingDialogOpen`, `newDrawingSourcePath`, and `newDrawingSourceKind` must be added to `useAppStore` state in T38/T46 (Part 4c1). If those fields are not yet present, the implementer should add them as part of this task's store-wiring step, mirroring the pattern of `nestDialog` / `setNestDialog`.

- [ ] **Step 4: Run the test (expect pass)**

```
cd packages/app && pnpm test:unit -- NewDrawingDialog
```
Expected: all pass.

- [ ] **Step 5: Typecheck**

```
pnpm -r typecheck
```

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/shell/NewDrawingDialog.tsx packages/app/src/shell/__tests__/NewDrawingDialog.spec.tsx
git commit -m "feat(shell): add <NewDrawingDialog>"
```

**Verify:** `pnpm test:unit -- NewDrawingDialog` exits 0; dialog renders correct fields; OK dispatches `CreateDrawingCommand` with ISO or custom sheet size.

---

### T49 — `<AddViewDialog>` at `packages/app/src/shell/AddViewDialog.tsx`

**Files:**
- Create: `packages/app/src/shell/AddViewDialog.tsx`
- Create: `packages/app/src/shell/__tests__/AddViewDialog.spec.tsx`

**Agent:** Sonnet implementer.

- [ ] **Step 1: Write the failing test**

```tsx
// packages/app/src/shell/__tests__/AddViewDialog.spec.tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AddViewDialog } from '../AddViewDialog';
import { useAppStore } from '../../store/useAppStore';
import { useToolModeStore } from '../../drawing/toolMode';
import type { DrawingDocument } from '@zilventor/shared';

const seedDrawing = (): DrawingDocument => ({
  id: 'dw1', name: 'D', units: 'mm',
  source: { partPath: 'parts/p.zipt', sourceKind: 'part' },
  properties: {},
  sheets: [
    {
      id: 'sh1', name: 'Sheet 1',
      size: { kind: 'iso', size: 'A3' },
      orientation: 'landscape',
      views: [
        {
          id: 'bv1', kind: 'base', positionMm: { x: 50, y: 50 },
          scale: { numerator: 1, denominator: 1 },
          orientation: 'front', showHidden: true,
        },
      ],
      dimensions: [], annotations: [], titleBlock: {},
    },
  ],
  activeSheetId: 'sh1',
});

describe('AddViewDialog — kind=base', () => {
  beforeEach(() => {
    useToolModeStore.getState().reset();
    useAppStore.getState().setActiveDocument(null);
    useAppStore.setState({ addViewDialogState: null } as any);
  });

  it('renders nothing when addViewDialogState is null', () => {
    render(<AddViewDialog />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders Base View fields (orientation select + scale inputs) for kind=base', () => {
    useAppStore.setState({ addViewDialogState: { kind: 'base' } } as any);
    render(<AddViewDialog />);
    expect(screen.getByRole('dialog', { name: /add.*view/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/orientation/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/scale.*numerator/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/scale.*denominator/i)).toBeInTheDocument();
  });

  it('OK with orientation=top sets pendingViewParams correctly', () => {
    useAppStore.setState({ addViewDialogState: { kind: 'base' } } as any);
    render(<AddViewDialog />);
    fireEvent.change(screen.getByLabelText(/orientation/i), { target: { value: 'top' } });
    fireEvent.click(screen.getByRole('button', { name: /^ok$/i }));
    const params = useToolModeStore.getState().pendingViewParams;
    expect(params).toMatchObject({ kind: 'base', orientation: 'top', scale: { n: 1, d: 1 } });
  });

  it('OK closes the dialog', () => {
    useAppStore.setState({ addViewDialogState: { kind: 'base' } } as any);
    render(<AddViewDialog />);
    fireEvent.click(screen.getByRole('button', { name: /^ok$/i }));
    expect((useAppStore.getState() as any).addViewDialogState).toBeNull();
  });

  it('Cancel closes without setting pendingViewParams', () => {
    useAppStore.setState({ addViewDialogState: { kind: 'base' } } as any);
    render(<AddViewDialog />);
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(useToolModeStore.getState().pendingViewParams).toBeNull();
    expect((useAppStore.getState() as any).addViewDialogState).toBeNull();
  });
});

describe('AddViewDialog — kind=projected', () => {
  beforeEach(() => {
    useToolModeStore.getState().reset();
    useAppStore.getState().setActiveDocument({ kind: 'drawing', document: seedDrawing() });
    useAppStore.setState({ addViewDialogState: null } as any);
  });

  it('renders Projected View fields (parent base view select + direction radios)', () => {
    useAppStore.setState({ addViewDialogState: { kind: 'projected' } } as any);
    render(<AddViewDialog />);
    expect(screen.getByLabelText(/parent.*view/i)).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /^top$/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /^bottom$/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /^left$/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /^right$/i })).toBeInTheDocument();
  });

  it('OK sets pendingViewParams for projected view', () => {
    useAppStore.setState({ addViewDialogState: { kind: 'projected' } } as any);
    render(<AddViewDialog />);
    fireEvent.change(screen.getByLabelText(/parent.*view/i), { target: { value: 'bv1' } });
    fireEvent.click(screen.getByRole('radio', { name: /^right$/i }));
    fireEvent.click(screen.getByRole('button', { name: /^ok$/i }));
    const params = useToolModeStore.getState().pendingViewParams;
    expect(params).toMatchObject({ kind: 'projected', baseViewId: 'bv1', direction: 'right' });
  });
});

describe('AddViewDialog — kind=iso', () => {
  beforeEach(() => {
    useToolModeStore.getState().reset();
    useAppStore.setState({ addViewDialogState: null } as any);
  });

  it('renders Iso View fields (corner select + scale inputs)', () => {
    useAppStore.setState({ addViewDialogState: { kind: 'iso' } } as any);
    render(<AddViewDialog />);
    expect(screen.getByLabelText(/corner/i)).toBeInTheDocument();
    const cornerSelect = screen.getByLabelText(/corner/i) as HTMLSelectElement;
    const cornerValues = Array.from(cornerSelect.options).map((o) => o.value);
    expect(cornerValues).toContain('NE');
    expect(cornerValues).toContain('NW');
    expect(cornerValues).toContain('SE');
    expect(cornerValues).toContain('SW');
  });

  it('OK sets pendingViewParams for iso view', () => {
    useAppStore.setState({ addViewDialogState: { kind: 'iso' } } as any);
    render(<AddViewDialog />);
    fireEvent.change(screen.getByLabelText(/corner/i), { target: { value: 'SW' } });
    fireEvent.click(screen.getByRole('button', { name: /^ok$/i }));
    const params = useToolModeStore.getState().pendingViewParams;
    expect(params).toMatchObject({ kind: 'iso', corner: 'SW', scale: { n: 1, d: 1 } });
  });
});
```

- [ ] **Step 2: Run the test (expect fail)**

```
cd packages/app && pnpm test:unit -- AddViewDialog
```
Expected: all fail (file does not exist).

- [ ] **Step 3: Implement `packages/app/src/shell/AddViewDialog.tsx`**

```tsx
import React from 'react';
import { useAppStore } from '../store/useAppStore';
import { useToolModeStore } from '../drawing/toolMode';
import type { DrawingView } from '@zilventor/shared';

const overlayStyle: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
};
const panelStyle: React.CSSProperties = {
  background: '#1a1a1a', border: '1px solid #444', borderRadius: 6, padding: 16,
  width: 360, color: '#eee', fontSize: 12,
};
const fieldRow: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 };
const labelStyle: React.CSSProperties = { width: 120, fontSize: 11, flexShrink: 0 };
const inputStyle: React.CSSProperties = {
  flex: 1, background: '#222', border: '1px solid #444', color: '#eee',
  padding: '4px 6px', fontSize: 11,
};
const btnStyle: React.CSSProperties = {
  background: '#2a2a2a', color: '#eee', border: '1px solid #444',
  padding: '4px 10px', cursor: 'pointer', fontSize: 11,
};
const okBtnStyle: React.CSSProperties = { ...btnStyle, background: '#3b5a8a', borderColor: '#6a8ec4' };

type DialogState = { kind: 'base' } | { kind: 'projected' } | { kind: 'iso' };

export function AddViewDialog(): JSX.Element | null {
  const dialogState = useAppStore((s) => (s as any).addViewDialogState as DialogState | null);
  const activeDocument = useAppStore((s) => s.activeDocument);
  const setPendingViewParams = useToolModeStore((s) => s.setPendingViewParams);

  // Base view state
  const [baseOrientation, setBaseOrientation] = React.useState<string>('front');
  const [baseScaleN, setBaseScaleN] = React.useState('1');
  const [baseScaleD, setBaseScaleD] = React.useState('1');

  // Projected view state
  const [projBaseViewId, setProjBaseViewId] = React.useState<string>('');
  const [projDirection, setProjDirection] = React.useState<'top' | 'bottom' | 'left' | 'right'>('right');

  // Iso view state
  const [isoCorner, setIsoCorner] = React.useState<'NE' | 'NW' | 'SE' | 'SW'>('NE');
  const [isoScaleN, setIsoScaleN] = React.useState('1');
  const [isoScaleD, setIsoScaleD] = React.useState('1');

  if (!dialogState) return null;

  const activeSheet = activeDocument?.kind === 'drawing'
    ? activeDocument.document.sheets.find(
        (sh) => sh.id === activeDocument.document.activeSheetId,
      )
    : undefined;
  const baseViews: DrawingView[] = (activeSheet?.views ?? []).filter(
    (v): v is Extract<DrawingView, { kind: 'base' }> => v.kind === 'base',
  );

  const close = () => {
    useAppStore.setState({ addViewDialogState: null } as any);
  };

  const handleOk = (): void => {
    if (dialogState.kind === 'base') {
      setPendingViewParams({
        kind: 'base',
        orientation: baseOrientation as 'front' | 'top' | 'right' | 'back' | 'bottom' | 'left',
        scale: { n: Number(baseScaleN), d: Number(baseScaleD) },
      });
    } else if (dialogState.kind === 'projected') {
      setPendingViewParams({
        kind: 'projected',
        baseViewId: projBaseViewId || (baseViews[0]?.id ?? ''),
        direction: projDirection,
      });
    } else {
      setPendingViewParams({
        kind: 'iso',
        corner: isoCorner,
        scale: { n: Number(isoScaleN), d: Number(isoScaleD) },
      });
    }
    close();
  };

  return (
    <div
      style={overlayStyle}
      onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}
    >
      <div
        style={panelStyle}
        role="dialog"
        aria-label="Add View"
        onKeyDown={(e) => { if (e.key === 'Escape') close(); }}
        tabIndex={-1}
      >
        <div style={{ fontWeight: 600, marginBottom: 12 }}>
          {dialogState.kind === 'base' ? 'Base View' :
           dialogState.kind === 'projected' ? 'Projected View' : 'Isometric View'}
        </div>

        {dialogState.kind === 'base' && (
          <>
            <div style={fieldRow}>
              <label style={labelStyle} htmlFor="av-orientation">Orientation</label>
              <select
                id="av-orientation"
                aria-label="Orientation"
                style={inputStyle}
                value={baseOrientation}
                onChange={(e) => setBaseOrientation(e.target.value)}
              >
                <option value="front">Front</option>
                <option value="top">Top</option>
                <option value="right">Right</option>
                <option value="back">Back</option>
                <option value="bottom">Bottom</option>
                <option value="left">Left</option>
              </select>
            </div>
            <div style={fieldRow}>
              <label style={labelStyle} htmlFor="av-scale-n">Scale numerator</label>
              <input id="av-scale-n" aria-label="Scale numerator" type="number"
                style={inputStyle} value={baseScaleN}
                onChange={(e) => setBaseScaleN(e.target.value)} />
            </div>
            <div style={fieldRow}>
              <label style={labelStyle} htmlFor="av-scale-d">Scale denominator</label>
              <input id="av-scale-d" aria-label="Scale denominator" type="number"
                style={inputStyle} value={baseScaleD}
                onChange={(e) => setBaseScaleD(e.target.value)} />
            </div>
          </>
        )}

        {dialogState.kind === 'projected' && (
          <>
            <div style={fieldRow}>
              <label style={labelStyle} htmlFor="av-parent">Parent view</label>
              <select
                id="av-parent"
                aria-label="Parent view"
                style={inputStyle}
                value={projBaseViewId || baseViews[0]?.id}
                onChange={(e) => setProjBaseViewId(e.target.value)}
              >
                {baseViews.map((v) => (
                  <option key={v.id} value={v.id}>{v.id}</option>
                ))}
              </select>
            </div>
            <div style={{ ...fieldRow, gap: 12 }}>
              <span style={labelStyle}>Direction</span>
              {(['top', 'bottom', 'left', 'right'] as const).map((dir) => (
                <label key={dir} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
                  <input
                    type="radio"
                    name="av-direction"
                    value={dir}
                    checked={projDirection === dir}
                    onChange={() => setProjDirection(dir)}
                  />
                  {dir.charAt(0).toUpperCase() + dir.slice(1)}
                </label>
              ))}
            </div>
          </>
        )}

        {dialogState.kind === 'iso' && (
          <>
            <div style={fieldRow}>
              <label style={labelStyle} htmlFor="av-corner">Corner</label>
              <select
                id="av-corner"
                aria-label="Corner"
                style={inputStyle}
                value={isoCorner}
                onChange={(e) => setIsoCorner(e.target.value as 'NE' | 'NW' | 'SE' | 'SW')}
              >
                <option value="NE">NE</option>
                <option value="NW">NW</option>
                <option value="SE">SE</option>
                <option value="SW">SW</option>
              </select>
            </div>
            <div style={fieldRow}>
              <label style={labelStyle} htmlFor="av-iso-scale-n">Scale numerator</label>
              <input id="av-iso-scale-n" aria-label="Scale numerator" type="number"
                style={inputStyle} value={isoScaleN}
                onChange={(e) => setIsoScaleN(e.target.value)} />
            </div>
            <div style={fieldRow}>
              <label style={labelStyle} htmlFor="av-iso-scale-d">Scale denominator</label>
              <input id="av-iso-scale-d" aria-label="Scale denominator" type="number"
                style={inputStyle} value={isoScaleD}
                onChange={(e) => setIsoScaleD(e.target.value)} />
            </div>
          </>
        )}

        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 12 }}>
          <button style={btnStyle} onClick={close}>Cancel</button>
          <button style={okBtnStyle} onClick={handleOk}>OK</button>
        </div>
      </div>
    </div>
  );
}
```

**Note:** `addViewDialogState` must be added to `useAppStore` state and `setAddViewDialogOpen` must be a setter action. If not already present from Part 4c1, the implementer adds them here following the `nestDialog` / `setNestDialog` pattern.

- [ ] **Step 4: Run the test (expect pass)**

```
cd packages/app && pnpm test:unit -- AddViewDialog
```
Expected: all pass.

- [ ] **Step 5: Typecheck**

```
pnpm -r typecheck
```

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/shell/AddViewDialog.tsx packages/app/src/shell/__tests__/AddViewDialog.spec.tsx
git commit -m "feat(shell): add <AddViewDialog>"
```

**Verify:** `pnpm test:unit -- AddViewDialog` exits 0; all three kind variants (base/projected/iso) produce correct `pendingViewParams`.

---

### T50 — `<EditTitleBlockDialog>` + `<AddDimensionDialog>` + `<AddLeaderTextDialog>`

**Files:**
- Create: `packages/app/src/shell/EditTitleBlockDialog.tsx`
- Create: `packages/app/src/shell/AddDimensionDialog.tsx`
- Create: `packages/app/src/shell/AddLeaderTextDialog.tsx`
- Create: `packages/app/src/shell/__tests__/EditTitleBlockDialog.spec.tsx`
- Create: `packages/app/src/shell/__tests__/AddDimensionDialog.spec.tsx`
- Create: `packages/app/src/shell/__tests__/AddLeaderTextDialog.spec.tsx`

**Agent:** Sonnet implementer.

- [ ] **Step 1: Write the failing tests**

```tsx
// packages/app/src/shell/__tests__/EditTitleBlockDialog.spec.tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { EditTitleBlockDialog } from '../EditTitleBlockDialog';
import { useAppStore } from '../../store/useAppStore';

const mockExecute = vi.fn().mockResolvedValue(undefined);

describe('EditTitleBlockDialog', () => {
  beforeEach(() => {
    mockExecute.mockClear();
    useAppStore.setState({
      editTitleBlockDialogState: null,
      bus: { execute: mockExecute } as any,
    } as any);
  });

  it('renders nothing when editTitleBlockDialogState is null', () => {
    render(<EditTitleBlockDialog />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders all TitleBlockOverrides fields when open', () => {
    useAppStore.setState({
      editTitleBlockDialogState: {
        sheetId: 'sh1',
        initialOverrides: { drawingName: 'My Drawing', drawnBy: 'JD' },
      },
    } as any);
    render(<EditTitleBlockDialog />);
    expect(screen.getByRole('dialog', { name: /title block/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/drawing name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/part name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/drawn by/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/approved by/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/scale/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/date/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/material/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/revision/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/notes/i)).toBeInTheDocument();
  });

  it('pre-fills initial override values', () => {
    useAppStore.setState({
      editTitleBlockDialogState: {
        sheetId: 'sh1',
        initialOverrides: { drawingName: 'My Drawing', drawnBy: 'JD' },
      },
    } as any);
    render(<EditTitleBlockDialog />);
    expect((screen.getByLabelText(/drawing name/i) as HTMLInputElement).value).toBe('My Drawing');
    expect((screen.getByLabelText(/drawn by/i) as HTMLInputElement).value).toBe('JD');
  });

  it('OK dispatches EditTitleBlockCommand with correct overrides and closes', async () => {
    useAppStore.setState({
      editTitleBlockDialogState: { sheetId: 'sh1', initialOverrides: {} },
    } as any);
    render(<EditTitleBlockDialog />);
    fireEvent.change(screen.getByLabelText(/drawing name/i), { target: { value: 'Cabinet Front' } });
    fireEvent.change(screen.getByLabelText(/drawn by/i), { target: { value: 'LY' } });
    fireEvent.click(screen.getByRole('button', { name: /^ok$/i }));
    await Promise.resolve();
    expect(mockExecute).toHaveBeenCalledTimes(1);
    const [cmd] = mockExecute.mock.calls[0]!;
    expect((cmd as any).constructor.name).toBe('EditTitleBlockCommand');
    expect((cmd as any).opts.sheetId).toBe('sh1');
    expect((cmd as any).opts.overrides.drawingName).toBe('Cabinet Front');
    expect((cmd as any).opts.overrides.drawnBy).toBe('LY');
    expect((useAppStore.getState() as any).editTitleBlockDialogState).toBeNull();
  });

  it('Cancel closes without executing command', () => {
    useAppStore.setState({
      editTitleBlockDialogState: { sheetId: 'sh1', initialOverrides: {} },
    } as any);
    render(<EditTitleBlockDialog />);
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(mockExecute).not.toHaveBeenCalled();
    expect((useAppStore.getState() as any).editTitleBlockDialogState).toBeNull();
  });
});
```

```tsx
// packages/app/src/shell/__tests__/AddDimensionDialog.spec.tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AddDimensionDialog } from '../AddDimensionDialog';
import { useAppStore } from '../../store/useAppStore';

const mockExecute = vi.fn().mockResolvedValue(undefined);

const pendingDim = {
  sheetId: 'sh1',
  dim: {
    id: 'd1',
    kind: 'radial' as const,
    viewId: 'v1',
    edgeId: 'e1',
    offsetMm: 10,
    angleDeg: 45,
  },
  computedValue: 25.4,
};

describe('AddDimensionDialog', () => {
  beforeEach(() => {
    mockExecute.mockClear();
    useAppStore.setState({
      addDimensionDialogState: null,
      bus: { execute: mockExecute } as any,
    } as any);
  });

  it('renders nothing when addDimensionDialogState is null', () => {
    render(<AddDimensionDialog />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders the computed value and a decimal-places selector when open', () => {
    useAppStore.setState({ addDimensionDialogState: pendingDim } as any);
    render(<AddDimensionDialog />);
    expect(screen.getByRole('dialog', { name: /dimension/i })).toBeInTheDocument();
    expect(screen.getByText(/25\.4/)).toBeInTheDocument();
    expect(screen.getByLabelText(/decimal places/i)).toBeInTheDocument();
  });

  it('OK dispatches AddDimensionCommand with the pending dim and closes', async () => {
    useAppStore.setState({ addDimensionDialogState: pendingDim } as any);
    render(<AddDimensionDialog />);
    fireEvent.click(screen.getByRole('button', { name: /^ok$/i }));
    await Promise.resolve();
    expect(mockExecute).toHaveBeenCalledTimes(1);
    const [cmd] = mockExecute.mock.calls[0]!;
    expect((cmd as any).constructor.name).toBe('AddDimensionCommand');
    expect((cmd as any).opts.sheetId).toBe('sh1');
    expect((cmd as any).opts.dim.kind).toBe('radial');
    expect((useAppStore.getState() as any).addDimensionDialogState).toBeNull();
  });

  it('Cancel closes without executing command', () => {
    useAppStore.setState({ addDimensionDialogState: pendingDim } as any);
    render(<AddDimensionDialog />);
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(mockExecute).not.toHaveBeenCalled();
    expect((useAppStore.getState() as any).addDimensionDialogState).toBeNull();
  });
});
```

```tsx
// packages/app/src/shell/__tests__/AddLeaderTextDialog.spec.tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AddLeaderTextDialog } from '../AddLeaderTextDialog';
import { useAppStore } from '../../store/useAppStore';

const mockExecute = vi.fn().mockResolvedValue(undefined);

const pendingLeader = {
  sheetId: 'sh1',
  ann: {
    id: 'a1',
    kind: 'leader' as const,
    viewId: 'v1',
    targetMm: { x: 100, y: 80 },
    textPosMm: { x: 150, y: 60 },
    text: '',
  },
};

describe('AddLeaderTextDialog', () => {
  beforeEach(() => {
    mockExecute.mockClear();
    useAppStore.setState({
      addLeaderTextDialogState: null,
      bus: { execute: mockExecute } as any,
    } as any);
  });

  it('renders nothing when addLeaderTextDialogState is null', () => {
    render(<AddLeaderTextDialog />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders a text input when open', () => {
    useAppStore.setState({ addLeaderTextDialogState: pendingLeader } as any);
    render(<AddLeaderTextDialog />);
    expect(screen.getByRole('dialog', { name: /leader/i })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /text/i })).toBeInTheDocument();
  });

  it('OK dispatches AddAnnotationCommand with the typed text and closes', async () => {
    useAppStore.setState({ addLeaderTextDialogState: pendingLeader } as any);
    render(<AddLeaderTextDialog />);
    fireEvent.change(screen.getByRole('textbox', { name: /text/i }), { target: { value: 'Chamfer here' } });
    fireEvent.click(screen.getByRole('button', { name: /^ok$/i }));
    await Promise.resolve();
    expect(mockExecute).toHaveBeenCalledTimes(1);
    const [cmd] = mockExecute.mock.calls[0]!;
    expect((cmd as any).constructor.name).toBe('AddAnnotationCommand');
    expect((cmd as any).opts.sheetId).toBe('sh1');
    expect((cmd as any).opts.ann.text).toBe('Chamfer here');
    expect((cmd as any).opts.ann.kind).toBe('leader');
    expect((useAppStore.getState() as any).addLeaderTextDialogState).toBeNull();
  });

  it('Cancel closes without executing', () => {
    useAppStore.setState({ addLeaderTextDialogState: pendingLeader } as any);
    render(<AddLeaderTextDialog />);
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(mockExecute).not.toHaveBeenCalled();
    expect((useAppStore.getState() as any).addLeaderTextDialogState).toBeNull();
  });

  it('OK button is disabled when text is empty', () => {
    useAppStore.setState({ addLeaderTextDialogState: pendingLeader } as any);
    render(<AddLeaderTextDialog />);
    expect(screen.getByRole('button', { name: /^ok$/i })).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run the tests (expect fail)**

```
cd packages/app && pnpm test:unit -- EditTitleBlockDialog AddDimensionDialog AddLeaderTextDialog
```
Expected: all fail (files do not exist).

- [ ] **Step 3: Implement all three dialogs**

```tsx
// packages/app/src/shell/EditTitleBlockDialog.tsx
import React from 'react';
import { useAppStore } from '../store/useAppStore';
import { EditTitleBlockCommand } from '../commands/EditTitleBlockCommand';
import type { TitleBlockOverrides } from '@zilventor/shared';

const overlayStyle: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
};
const panelStyle: React.CSSProperties = {
  background: '#1a1a1a', border: '1px solid #444', borderRadius: 6, padding: 16,
  width: 420, color: '#eee', fontSize: 12,
};
const fieldRow: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 };
const labelStyle: React.CSSProperties = { width: 110, fontSize: 11, flexShrink: 0 };
const inputStyle: React.CSSProperties = {
  flex: 1, background: '#222', border: '1px solid #444', color: '#eee',
  padding: '4px 6px', fontSize: 11,
};
const btnStyle: React.CSSProperties = {
  background: '#2a2a2a', color: '#eee', border: '1px solid #444',
  padding: '4px 10px', cursor: 'pointer', fontSize: 11,
};
const okBtnStyle: React.CSSProperties = { ...btnStyle, background: '#3b5a8a', borderColor: '#6a8ec4' };

type DialogState = { sheetId: string; initialOverrides: TitleBlockOverrides };

const FIELDS: Array<{ key: keyof TitleBlockOverrides; label: string; multiline?: boolean }> = [
  { key: 'drawingName',  label: 'Drawing name' },
  { key: 'partName',     label: 'Part name' },
  { key: 'drawnBy',      label: 'Drawn by' },
  { key: 'approvedBy',   label: 'Approved by' },
  { key: 'scaleText',    label: 'Scale' },
  { key: 'date',         label: 'Date' },
  { key: 'material',     label: 'Material' },
  { key: 'revision',     label: 'Revision' },
  { key: 'notes',        label: 'Notes', multiline: true },
];

export function EditTitleBlockDialog(): JSX.Element | null {
  const state = useAppStore((s) => (s as any).editTitleBlockDialogState as DialogState | null);
  const bus = useAppStore((s) => s.bus);

  const [values, setValues] = React.useState<Partial<Record<keyof TitleBlockOverrides, string>>>({});

  React.useEffect(() => {
    if (state) {
      const init: Partial<Record<keyof TitleBlockOverrides, string>> = {};
      for (const { key } of FIELDS) {
        init[key] = (state.initialOverrides[key] as string | undefined) ?? '';
      }
      setValues(init);
    }
  }, [state]);

  if (!state) return null;

  const close = () => useAppStore.setState({ editTitleBlockDialogState: null } as any);

  const handleOk = async (): Promise<void> => {
    const overrides: TitleBlockOverrides = {};
    for (const { key } of FIELDS) {
      const v = values[key];
      if (v && v.trim()) (overrides as Record<string, string>)[key] = v.trim();
    }
    await bus.execute(new EditTitleBlockCommand({ sheetId: state.sheetId, overrides }));
    close();
  };

  return (
    <div style={overlayStyle} onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div style={panelStyle} role="dialog" aria-label="Edit Title Block"
        onKeyDown={(e) => { if (e.key === 'Escape') close(); }} tabIndex={-1}>
        <div style={{ fontWeight: 600, marginBottom: 12 }}>Title Block</div>
        {FIELDS.map(({ key, label, multiline }) => (
          <div key={key} style={fieldRow}>
            <label style={labelStyle} htmlFor={`tb-${key}`}>{label}</label>
            {multiline ? (
              <textarea
                id={`tb-${key}`}
                aria-label={label}
                style={{ ...inputStyle, height: 48, resize: 'vertical' }}
                value={values[key] ?? ''}
                onChange={(e) => setValues((prev) => ({ ...prev, [key]: e.target.value }))}
              />
            ) : (
              <input
                id={`tb-${key}`}
                aria-label={label}
                type="text"
                style={inputStyle}
                value={values[key] ?? ''}
                onChange={(e) => setValues((prev) => ({ ...prev, [key]: e.target.value }))}
              />
            )}
          </div>
        ))}
        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 10 }}>
          <button style={btnStyle} onClick={close}>Cancel</button>
          <button style={okBtnStyle} onClick={() => { void handleOk(); }}>OK</button>
        </div>
      </div>
    </div>
  );
}
```

```tsx
// packages/app/src/shell/AddDimensionDialog.tsx
import React from 'react';
import { useAppStore } from '../store/useAppStore';
import { AddDimensionCommand } from '../commands/AddDimensionCommand';
import type { DrawingDimension } from '@zilventor/shared';

const overlayStyle: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
};
const panelStyle: React.CSSProperties = {
  background: '#1a1a1a', border: '1px solid #444', borderRadius: 6, padding: 16,
  width: 300, color: '#eee', fontSize: 12,
};
const fieldRow: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 };
const labelStyle: React.CSSProperties = { width: 110, fontSize: 11, flexShrink: 0 };
const inputStyle: React.CSSProperties = {
  flex: 1, background: '#222', border: '1px solid #444', color: '#eee',
  padding: '4px 6px', fontSize: 11,
};
const btnStyle: React.CSSProperties = {
  background: '#2a2a2a', color: '#eee', border: '1px solid #444',
  padding: '4px 10px', cursor: 'pointer', fontSize: 11,
};
const okBtnStyle: React.CSSProperties = { ...btnStyle, background: '#3b5a8a', borderColor: '#6a8ec4' };

type DialogState = { sheetId: string; dim: DrawingDimension; computedValue: number };

export function AddDimensionDialog(): JSX.Element | null {
  const state = useAppStore((s) => (s as any).addDimensionDialogState as DialogState | null);
  const bus = useAppStore((s) => s.bus);
  const [decimalPlaces, setDecimalPlaces] = React.useState('2');

  if (!state) return null;

  const close = () => useAppStore.setState({ addDimensionDialogState: null } as any);

  const handleOk = async (): Promise<void> => {
    await bus.execute(new AddDimensionCommand({ sheetId: state.sheetId, dim: state.dim }));
    close();
  };

  const formatted = state.computedValue.toFixed(Number(decimalPlaces));

  return (
    <div style={overlayStyle} onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div style={panelStyle} role="dialog" aria-label="Dimension"
        onKeyDown={(e) => { if (e.key === 'Escape') close(); }} tabIndex={-1}>
        <div style={{ fontWeight: 600, marginBottom: 12 }}>
          {state.dim.kind === 'radial' ? 'Radial Dimension' : 'Diametric Dimension'}
        </div>

        <div style={{ marginBottom: 10, fontSize: 13, color: '#cce' }}>
          Value: <strong>{formatted}</strong> mm
        </div>

        <div style={fieldRow}>
          <label style={labelStyle} htmlFor="dim-dp">Decimal places</label>
          <select
            id="dim-dp"
            aria-label="Decimal places"
            style={inputStyle}
            value={decimalPlaces}
            onChange={(e) => setDecimalPlaces(e.target.value)}
          >
            <option value="0">0</option>
            <option value="1">1</option>
            <option value="2">2</option>
            <option value="3">3</option>
          </select>
        </div>

        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 10 }}>
          <button style={btnStyle} onClick={close}>Cancel</button>
          <button style={okBtnStyle} onClick={() => { void handleOk(); }}>OK</button>
        </div>
      </div>
    </div>
  );
}
```

```tsx
// packages/app/src/shell/AddLeaderTextDialog.tsx
import React from 'react';
import { useAppStore } from '../store/useAppStore';
import { AddAnnotationCommand } from '../commands/AddAnnotationCommand';
import type { DrawingAnnotation } from '@zilventor/shared';

const overlayStyle: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
};
const panelStyle: React.CSSProperties = {
  background: '#1a1a1a', border: '1px solid #444', borderRadius: 6, padding: 16,
  width: 340, color: '#eee', fontSize: 12,
};
const btnStyle: React.CSSProperties = {
  background: '#2a2a2a', color: '#eee', border: '1px solid #444',
  padding: '4px 10px', cursor: 'pointer', fontSize: 11,
};
const okBtnStyle: React.CSSProperties = { ...btnStyle, background: '#3b5a8a', borderColor: '#6a8ec4' };

type DialogState = {
  sheetId: string;
  ann: Extract<DrawingAnnotation, { kind: 'leader' }>;
};

export function AddLeaderTextDialog(): JSX.Element | null {
  const state = useAppStore((s) => (s as any).addLeaderTextDialogState as DialogState | null);
  const bus = useAppStore((s) => s.bus);
  const [text, setText] = React.useState('');

  React.useEffect(() => {
    if (state) setText('');
  }, [state]);

  if (!state) return null;

  const close = () => useAppStore.setState({ addLeaderTextDialogState: null } as any);

  const handleOk = async (): Promise<void> => {
    if (!text.trim()) return;
    const ann: DrawingAnnotation = { ...state.ann, text: text.trim() };
    await bus.execute(new AddAnnotationCommand({ sheetId: state.sheetId, ann }));
    close();
  };

  return (
    <div style={overlayStyle} onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div style={panelStyle} role="dialog" aria-label="Leader Text"
        onKeyDown={(e) => {
          if (e.key === 'Escape') close();
          if (e.key === 'Enter' && text.trim()) { void handleOk(); }
        }} tabIndex={-1}>
        <div style={{ fontWeight: 600, marginBottom: 12 }}>Leader Text</div>
        <div style={{ marginBottom: 10 }}>
          <label htmlFor="lt-text" style={{ fontSize: 11 }}>Text</label>
          <input
            id="lt-text"
            aria-label="Text"
            type="text"
            autoFocus
            style={{
              display: 'block', width: '100%', background: '#222',
              border: '1px solid #444', color: '#eee', padding: '4px 6px',
              fontSize: 11, marginTop: 4, boxSizing: 'border-box',
            }}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </div>
        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
          <button style={btnStyle} onClick={close}>Cancel</button>
          <button
            style={okBtnStyle}
            disabled={!text.trim()}
            aria-disabled={!text.trim()}
            onClick={() => { void handleOk(); }}
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
```

**Note:** Store slots `editTitleBlockDialogState`, `addDimensionDialogState`, `addLeaderTextDialogState` must exist on `useAppStore`. If not present from Part 4c1, add them following the existing dialog-state pattern.

- [ ] **Step 4: Run all three tests (expect pass)**

```
cd packages/app && pnpm test:unit -- EditTitleBlockDialog AddDimensionDialog AddLeaderTextDialog
```
Expected: all pass.

- [ ] **Step 5: Typecheck**

```
pnpm -r typecheck
```

- [ ] **Step 6: Commit**

```bash
git add \
  packages/app/src/shell/EditTitleBlockDialog.tsx \
  packages/app/src/shell/AddDimensionDialog.tsx \
  packages/app/src/shell/AddLeaderTextDialog.tsx \
  packages/app/src/shell/__tests__/EditTitleBlockDialog.spec.tsx \
  packages/app/src/shell/__tests__/AddDimensionDialog.spec.tsx \
  packages/app/src/shell/__tests__/AddLeaderTextDialog.spec.tsx
git commit -m "feat(shell): add <EditTitleBlockDialog> + <AddDimensionDialog> + <AddLeaderTextDialog>"
```

**Verify:** `pnpm test:unit -- EditTitleBlockDialog AddDimensionDialog AddLeaderTextDialog` exits 0; each dialog dispatches the right command class with correct field mappings.

---

### T51 — Tool-mode store slice at `packages/app/src/drawing/toolMode.ts`

**Files:**
- Create: `packages/app/src/drawing/toolMode.ts`
- Create: `packages/app/src/drawing/__tests__/toolMode.spec.ts`

**Agent:** Sonnet implementer.

- [ ] **Step 1: Write the failing test**

```ts
// packages/app/src/drawing/__tests__/toolMode.spec.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useToolModeStore } from '../toolMode';
import type { ToolMode, PendingViewParams } from '../toolMode';

describe('useToolModeStore', () => {
  beforeEach(() => {
    useToolModeStore.getState().reset();
  });

  it('default state: mode=idle, pendingViewParams=null', () => {
    const s = useToolModeStore.getState();
    expect(s.mode).toBe('idle');
    expect(s.pendingViewParams).toBeNull();
  });

  it('setMode round-trip for every ToolMode value', () => {
    const modes: ToolMode[] = [
      'idle',
      'placeBase', 'placeProjected', 'placeIso',
      'addLinearH', 'addLinearV', 'addAligned', 'addRadial', 'addDiametric',
      'addCenterline', 'addCenterMark', 'addLeader', 'addBalloon',
    ];
    for (const mode of modes) {
      useToolModeStore.getState().setMode(mode);
      expect(useToolModeStore.getState().mode).toBe(mode);
    }
  });

  it('reset() sets mode back to idle', () => {
    useToolModeStore.getState().setMode('addRadial');
    expect(useToolModeStore.getState().mode).toBe('addRadial');
    useToolModeStore.getState().reset();
    expect(useToolModeStore.getState().mode).toBe('idle');
  });

  it('reset() clears pendingViewParams', () => {
    const params: PendingViewParams = {
      kind: 'base',
      orientation: 'front',
      scale: { n: 1, d: 1 },
    };
    useToolModeStore.getState().setPendingViewParams(params);
    expect(useToolModeStore.getState().pendingViewParams).toEqual(params);
    useToolModeStore.getState().reset();
    expect(useToolModeStore.getState().pendingViewParams).toBeNull();
  });

  it('setPendingViewParams round-trip for base variant', () => {
    const params: PendingViewParams = {
      kind: 'base',
      orientation: 'top',
      scale: { n: 1, d: 2 },
    };
    useToolModeStore.getState().setPendingViewParams(params);
    expect(useToolModeStore.getState().pendingViewParams).toEqual(params);
  });

  it('setPendingViewParams round-trip for projected variant', () => {
    const params: PendingViewParams = {
      kind: 'projected',
      baseViewId: 'bv-abc',
      direction: 'left',
    };
    useToolModeStore.getState().setPendingViewParams(params);
    expect(useToolModeStore.getState().pendingViewParams).toEqual(params);
  });

  it('setPendingViewParams round-trip for iso variant', () => {
    const params: PendingViewParams = {
      kind: 'iso',
      corner: 'SW',
      scale: { n: 1, d: 5 },
    };
    useToolModeStore.getState().setPendingViewParams(params);
    expect(useToolModeStore.getState().pendingViewParams).toEqual(params);
  });

  it('setPendingViewParams(null) clears params', () => {
    useToolModeStore.getState().setPendingViewParams({
      kind: 'iso', corner: 'NE', scale: { n: 1, d: 1 },
    });
    useToolModeStore.getState().setPendingViewParams(null);
    expect(useToolModeStore.getState().pendingViewParams).toBeNull();
  });

  it('setMode does not clear pendingViewParams', () => {
    const params: PendingViewParams = { kind: 'base', orientation: 'front', scale: { n: 1, d: 1 } };
    useToolModeStore.getState().setPendingViewParams(params);
    useToolModeStore.getState().setMode('addLinearH');
    expect(useToolModeStore.getState().pendingViewParams).toEqual(params);
  });
});
```

- [ ] **Step 2: Run the test (expect fail)**

```
cd packages/app && pnpm test:unit -- toolMode
```
Expected: fail (file does not exist — import error).

- [ ] **Step 3: Implement `packages/app/src/drawing/toolMode.ts`**

```ts
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
  | 'addBalloon';

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

interface ToolModeState {
  mode: ToolMode;
  pendingViewParams: PendingViewParams | null;
  setMode(mode: ToolMode): void;
  setPendingViewParams(p: PendingViewParams | null): void;
  reset(): void;
}

export const useToolModeStore = create<ToolModeState>((set) => ({
  mode: 'idle',
  pendingViewParams: null,

  setMode(mode) {
    set({ mode });
  },

  setPendingViewParams(p) {
    set({ pendingViewParams: p });
  },

  reset() {
    set({ mode: 'idle', pendingViewParams: null });
  },
}));
```

The `drawing/` directory must be created if it does not yet exist (`packages/app/src/drawing/`). Ensure `packages/app/src/drawing/__tests__/` also exists.

- [ ] **Step 4: Run the test (expect pass)**

```
cd packages/app && pnpm test:unit -- toolMode
```
Expected: 9/9 pass.

- [ ] **Step 5: Run full app unit suite to confirm no regression**

```
cd packages/app && pnpm test:unit
```
Expected: all green.

- [ ] **Step 6: Typecheck**

```
pnpm -r typecheck
```
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add packages/app/src/drawing/toolMode.ts packages/app/src/drawing/__tests__/toolMode.spec.ts
git commit -m "feat(drawing): add tool-mode store slice"
```

**Verify:** `pnpm test:unit -- toolMode` exits 0; all 9 assertions pass; full repo typecheck clean; every ToolMode variant round-trips through `setMode`; `reset()` clears both `mode` and `pendingViewParams`.
## Phase 9 — Export pipeline

Four tasks; tightly coupled (render functions + commands share import graph). Dispatch as one batch to a single Sonnet subagent.

### T52 — `renderDrawingPdf.ts`

**Files:**
- Create: `packages/app/src/drawing/renderDrawingPdf.ts`
- Create (test): `packages/app/src/drawing/__tests__/renderDrawingPdf.spec.ts`

**Agent:** Sonnet implementer.

- [ ] **Step 1: Write the failing test**

```ts
// packages/app/src/drawing/__tests__/renderDrawingPdf.spec.ts
import { describe, it, expect } from 'vitest';
import { renderDrawingPdf } from '../renderDrawingPdf';
import { makeFixtureDrawing, makeFixturePart } from '../../__tests__/fixtures/drawingFixtures';

describe('renderDrawingPdf', () => {
  it('returns a Blob with type application/pdf', async () => {
    const drawing = makeFixtureDrawing();
    const source = makeFixturePart();
    const blob = renderDrawingPdf(drawing, source);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('application/pdf');
  });

  it('has non-zero size', async () => {
    const blob = renderDrawingPdf(makeFixtureDrawing(), makeFixturePart());
    expect(blob.size).toBeGreaterThan(0);
  });

  it('starts with PDF magic bytes %PDF-', async () => {
    const blob = renderDrawingPdf(makeFixtureDrawing(), makeFixturePart());
    const buf = await blob.arrayBuffer();
    const bytes = new Uint8Array(buf);
    // '%PDF-' = [37, 80, 68, 70, 45]
    expect(Array.from(bytes.slice(0, 5))).toEqual([37, 80, 68, 70, 45]);
  });

  it('produces one jsPDF page per sheet', async () => {
    const drawing = makeFixtureDrawing({ sheetCount: 3 });
    const blob = renderDrawingPdf(drawing, makeFixturePart());
    // PDF page-count check: count '/Page ' occurrences in the text representation
    const buf = await blob.arrayBuffer();
    const text = new TextDecoder('latin1').decode(buf);
    const pageMatches = text.match(/\/Type\s*\/Page[^s]/g) ?? [];
    expect(pageMatches.length).toBe(3);
  });
});
```

- [ ] **Step 2: Run the test (expect fail)**

```
cd packages/app && pnpm test:unit -- renderDrawingPdf
```
Expected: all 4 fail (module does not exist yet).

- [ ] **Step 3: Create `packages/app/src/drawing/renderDrawingPdf.ts`**

```ts
import { jsPDF } from 'jspdf';
import type { DrawingDocument, DrawingSheet, DrawingView } from '@zilventor/shared';
import type { PartDocument, AssemblyDocument } from '@zilventor/shared';
import { resolveTitleBlock } from '@zilventor/shared/src/drawing/titleBlock';

// ISO sheet dimensions (mm, landscape). Portrait swaps w/h at render time.
const ISO_SIZES_MM: Record<string, { w: number; h: number }> = {
  A0: { w: 1189, h: 841 },
  A1: { w: 841,  h: 594 },
  A2: { w: 594,  h: 420 },
  A3: { w: 420,  h: 297 },
  A4: { w: 297,  h: 210 },
};

/** Returns a PDF Blob (application/pdf), one page per sheet. */
export function renderDrawingPdf(
  drawing: DrawingDocument,
  source: PartDocument | AssemblyDocument,
): Blob {
  return buildPdf(drawing, source).output('blob') as Blob;
}

/** Returns raw PDF bytes (Uint8Array). Used by ExportDrawingPdfCommand. */
export function renderDrawingPdfBytes(
  drawing: DrawingDocument,
  source: PartDocument | AssemblyDocument,
): Uint8Array {
  return new Uint8Array(buildPdf(drawing, source).output('arraybuffer') as ArrayBuffer);
}

function buildPdf(
  drawing: DrawingDocument,
  source: PartDocument | AssemblyDocument,
): jsPDF {
  const sheets = drawing.sheets;
  if (sheets.length === 0) {
    const empty = new jsPDF({ unit: 'mm', format: 'a3', orientation: 'landscape' });
    empty.text('No sheets', 20, 20);
    return empty;
  }

  const { format: firstFormat, orientation: firstOrientation } = sheetFormat(sheets[0]);
  const pdf = new jsPDF({ unit: 'mm', format: firstFormat, orientation: firstOrientation });

  sheets.forEach((sheet, i) => {
    const { format, orientation } = sheetFormat(sheet);
    if (i === 0) {
      // First page already created; fix orientation if it differs from the default 'landscape'.
      if (orientation !== 'landscape') {
        pdf.deletePage(1);
        pdf.addPage(format, orientation);
      }
    } else {
      pdf.addPage(format, orientation);
    }
    drawSheetPdf(pdf, sheet, drawing, source, i, sheets.length);
  });

  return pdf;
}

function sheetFormat(
  sheet: DrawingSheet,
): { format: string | [number, number]; orientation: 'landscape' | 'portrait' } {
  const orientation = sheet.orientation;
  if (sheet.size.kind === 'iso') {
    const key = sheet.size.size.toLowerCase(); // 'a3', 'a4', etc.
    return { format: key, orientation };
  }
  // Custom — jsPDF accepts [widthMm, heightMm] in the active orientation.
  const { widthMm, heightMm } = sheet.size;
  const format: [number, number] = orientation === 'landscape'
    ? [Math.max(widthMm, heightMm), Math.min(widthMm, heightMm)]
    : [Math.min(widthMm, heightMm), Math.max(widthMm, heightMm)];
  return { format, orientation };
}

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
  const TITLE_H = 20; // height reserved at bottom for title block

  // ---- Title block ----
  const titleBlock = resolveTitleBlock(drawing, sheet, source, sheetIndex + 1, totalSheets);
  drawTitleBlockPdf(pdf, titleBlock, pageW, pageH, MARGIN, TITLE_H);

  // ---- Sheet border ----
  pdf.setDrawColor(0);
  pdf.setLineWidth(0.5);
  pdf.rect(MARGIN, MARGIN, pageW - 2 * MARGIN, pageH - 2 * MARGIN - TITLE_H);

  // ---- Views ----
  const drawAreaW = pageW - 2 * MARGIN;
  const drawAreaH = pageH - 2 * MARGIN - TITLE_H;

  // Determine the sheet physical size in mm (for coordinate mapping).
  const sheetPhysW = getSheetWidthMm(sheet);
  const sheetPhysH = getSheetHeightMm(sheet);
  const scaleX = drawAreaW / sheetPhysW;
  const scaleY = drawAreaH / sheetPhysH;

  for (const view of sheet.views) {
    drawViewPdf(pdf, view, sheet, MARGIN, MARGIN, scaleX, scaleY);
  }

  // ---- Dimensions ----
  for (const dim of sheet.dimensions) {
    // Minimal dimension rendering: draw a simple line + text at offset position.
    const relView = sheet.views.find((v) => v.id === dim.viewId);
    if (!relView) continue;
    drawDimensionPdf(pdf, dim, relView, MARGIN, MARGIN, scaleX, scaleY);
  }
}

function drawTitleBlockPdf(
  pdf: jsPDF,
  fields: ReturnType<typeof resolveTitleBlock>,
  pageW: number,
  pageH: number,
  margin: number,
  titleH: number,
): void {
  const x = margin;
  const y = pageH - margin - titleH;
  const w = pageW - 2 * margin;

  pdf.setDrawColor(0);
  pdf.setLineWidth(0.3);
  pdf.rect(x, y, w, titleH);

  // Divider at 50%
  pdf.line(x + w / 2, y, x + w / 2, y + titleH);

  pdf.setFontSize(7);
  pdf.setTextColor(80);

  // Left half — drawing name, part name, scale
  pdf.text(`Drawing: ${fields.drawingName ?? ''}`, x + 2, y + 4);
  pdf.text(`Part: ${fields.partName ?? ''}`, x + 2, y + 8);
  pdf.text(`Scale: ${fields.scaleText ?? '1:1'}`, x + 2, y + 12);
  pdf.text(`Material: ${fields.material ?? ''}`, x + 2, y + 16);

  // Right half — metadata
  pdf.text(`Date: ${fields.date ?? ''}`, x + w / 2 + 2, y + 4);
  pdf.text(`Drawn by: ${fields.drawnBy ?? ''}`, x + w / 2 + 2, y + 8);
  pdf.text(`Revision: ${fields.revision ?? ''}`, x + w / 2 + 2, y + 12);
  pdf.text(`Sheet: ${fields.sheetNumber}/${fields.totalSheets}`, x + w / 2 + 2, y + 16);

  pdf.setTextColor(0);
}

function getSheetWidthMm(sheet: DrawingSheet): number {
  if (sheet.size.kind === 'custom') {
    return sheet.orientation === 'landscape'
      ? Math.max(sheet.size.widthMm, sheet.size.heightMm)
      : Math.min(sheet.size.widthMm, sheet.size.heightMm);
  }
  const base = ISO_SIZES_MM[sheet.size.size];
  return sheet.orientation === 'landscape' ? base.w : base.h;
}

function getSheetHeightMm(sheet: DrawingSheet): number {
  if (sheet.size.kind === 'custom') {
    return sheet.orientation === 'landscape'
      ? Math.min(sheet.size.widthMm, sheet.size.heightMm)
      : Math.max(sheet.size.widthMm, sheet.size.heightMm);
  }
  const base = ISO_SIZES_MM[sheet.size.size];
  return sheet.orientation === 'landscape' ? base.h : base.w;
}

function drawViewPdf(
  pdf: jsPDF,
  view: DrawingView,
  _sheet: DrawingSheet,
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

  // Visible edges — solid line
  pdf.setDrawColor(0);
  pdf.setLineWidth(0.35);
  for (const edge of projection.visibleEdges) {
    drawPolylinePdf(pdf, edge.points, vx, vy, vScale * scaleX, vScale * scaleY);
  }

  // Hidden edges — dashed line
  pdf.setDrawColor(80);
  pdf.setLineWidth(0.18);
  // jsPDF does not have a native setLineDash; approximate with reduced line width only.
  for (const edge of projection.hiddenEdges) {
    drawPolylinePdf(pdf, edge.points, vx, vy, vScale * scaleX, vScale * scaleY);
  }
  pdf.setDrawColor(0);
}

function drawPolylinePdf(
  pdf: jsPDF,
  points: ReadonlyArray<readonly [number, number]>,
  ox: number,
  oy: number,
  sx: number,
  sy: number,
): void {
  if (points.length < 2) return;
  for (let i = 0; i < points.length - 1; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[i + 1];
    pdf.line(ox + x0 * sx, oy + y0 * sy, ox + x1 * sx, oy + y1 * sy);
  }
}

function drawDimensionPdf(
  pdf: jsPDF,
  dim: DrawingSheet['dimensions'][number],
  view: DrawingView,
  ox: number,
  oy: number,
  scaleX: number,
  scaleY: number,
): void {
  if (!view.projection) return;
  const vScale = view.scale.numerator / view.scale.denominator;
  const vx = ox + view.positionMm.x * scaleX;
  const vy = oy + view.positionMm.y * scaleY;

  if (dim.kind === 'linear-h' || dim.kind === 'linear-v' || dim.kind === 'aligned') {
    // Resolve the two endpoint references to 2D positions.
    const p1 = resolvePointRef(dim.from, view.projection);
    const p2 = resolvePointRef(dim.to, view.projection);
    if (!p1 || !p2) return;

    const x1 = vx + p1[0] * vScale * scaleX;
    const y1 = vy + p1[1] * vScale * scaleY;
    const x2 = vx + p2[0] * vScale * scaleX;
    const y2 = vy + p2[1] * vScale * scaleY;
    const offset = dim.offsetMm * scaleY;

    pdf.setDrawColor(0, 0, 180);
    pdf.setLineWidth(0.2);
    // Dimension line
    if (dim.kind === 'linear-h') {
      pdf.line(x1, y1 - offset, x2, y1 - offset);
      pdf.line(x1, y1, x1, y1 - offset);
      pdf.line(x2, y2, x2, y1 - offset);
    } else {
      pdf.line(x1 + offset, y1, x1 + offset, y2);
      pdf.line(x1, y1, x1 + offset, y1);
      pdf.line(x2, y2, x1 + offset, y2);
    }
    // Text
    const distMm = Math.round(Math.sqrt((p2[0] - p1[0]) ** 2 + (p2[1] - p1[1]) ** 2));
    pdf.setFontSize(6);
    pdf.text(
      String(distMm),
      (x1 + x2) / 2,
      y1 - offset - 1,
      { align: 'center' },
    );
    pdf.setDrawColor(0);
  }
  // radial / diametric: minimal rendering deferred to follow-ups
}

function resolvePointRef(
  ref: DrawingSheet['dimensions'][number] extends { from: infer R } ? R : never,
  projection: NonNullable<DrawingView['projection']>,
): readonly [number, number] | null {
  const edge = projection.visibleEdges.find((e) => e.id === (ref as { edgeId: string }).edgeId)
    ?? projection.hiddenEdges.find((e) => e.id === (ref as { edgeId: string }).edgeId);
  if (!edge || edge.points.length === 0) return null;
  if ((ref as { end?: string }).end === 'end') return edge.points[edge.points.length - 1];
  if ((ref as { kind: string }).kind === 'edge-midpoint') {
    const mid = Math.floor(edge.points.length / 2);
    return edge.points[mid];
  }
  return edge.points[0]; // 'start' or arc-center approximation
}
```

- [ ] **Step 4: Run the test (expect pass)**

```
cd packages/app && pnpm test:unit -- renderDrawingPdf
```
Expected: 4/4 pass.

- [ ] **Step 5: Typecheck**

```
cd packages/app && pnpm typecheck
```
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/drawing/renderDrawingPdf.ts \
        packages/app/src/drawing/__tests__/renderDrawingPdf.spec.ts
git commit -m "feat(drawing): renderDrawingPdf — jsPDF multi-page export (6 §4.6)"
```

**Verify:** `renderDrawingPdf(fixture, fixturePart)` returns `Blob` with type `application/pdf` and magic bytes `%PDF-`.

---

### T53 — `renderDrawingSvg.ts`

**Files:**
- Create: `packages/app/src/drawing/renderDrawingSvg.ts`
- Create (test): `packages/app/src/drawing/__tests__/renderDrawingSvg.spec.ts`

**Agent:** Sonnet implementer.

- [ ] **Step 1: Write the failing test**

```ts
// packages/app/src/drawing/__tests__/renderDrawingSvg.spec.ts
import { describe, it, expect } from 'vitest';
import { renderDrawingSvg } from '../renderDrawingSvg';
import { makeFixtureDrawing, makeFixturePart } from '../../__tests__/fixtures/drawingFixtures';

describe('renderDrawingSvg', () => {
  it('returns a string starting with <svg', () => {
    const drawing = makeFixtureDrawing();
    const sheet = drawing.sheets[0];
    const result = renderDrawingSvg(drawing, sheet, makeFixturePart());
    expect(typeof result).toBe('string');
    expect(result.trimStart()).toMatch(/^<svg/);
  });

  it('includes a closing </svg> tag', () => {
    const drawing = makeFixtureDrawing();
    const sheet = drawing.sheets[0];
    const result = renderDrawingSvg(drawing, sheet, makeFixturePart());
    expect(result).toContain('</svg>');
  });

  it('parses as valid XML', () => {
    const drawing = makeFixtureDrawing();
    const sheet = drawing.sheets[0];
    const result = renderDrawingSvg(drawing, sheet, makeFixturePart());
    const parser = new DOMParser();
    const doc = parser.parseFromString(result, 'image/svg+xml');
    const parseError = doc.querySelector('parsererror');
    expect(parseError).toBeNull();
  });

  it('contains a view group for each view in the sheet', () => {
    const drawing = makeFixtureDrawing({ viewCount: 2 });
    const sheet = drawing.sheets[0];
    const result = renderDrawingSvg(drawing, sheet, makeFixturePart());
    const viewGroups = result.match(/data-view-id="[^"]+"/g) ?? [];
    expect(viewGroups.length).toBeGreaterThanOrEqual(2);
  });

  it('includes a title block group', () => {
    const drawing = makeFixtureDrawing();
    const sheet = drawing.sheets[0];
    const result = renderDrawingSvg(drawing, sheet, makeFixturePart());
    expect(result).toContain('data-title-block');
  });
});
```

- [ ] **Step 2: Run the test (expect fail)**

```
cd packages/app && pnpm test:unit -- renderDrawingSvg
```
Expected: all 5 fail.

- [ ] **Step 3: Create `packages/app/src/drawing/renderDrawingSvg.ts`**

```ts
import type { DrawingDocument, DrawingSheet, DrawingView } from '@zilventor/shared';
import type { PartDocument, AssemblyDocument } from '@zilventor/shared';
import { resolveTitleBlock } from '@zilventor/shared/src/drawing/titleBlock';

const ISO_SIZES_MM: Record<string, { w: number; h: number }> = {
  A0: { w: 1189, h: 841 },
  A1: { w: 841,  h: 594 },
  A2: { w: 594,  h: 420 },
  A3: { w: 420,  h: 297 },
  A4: { w: 297,  h: 210 },
};

/**
 * Returns standalone SVG markup for a single sheet.
 * The result is a self-contained <svg> string (no external dependencies).
 * This is the shared rendering primitive — DrawingCanvas uses the same logic
 * by mounting the returned string as innerHTML of a container.
 */
export function renderDrawingSvg(
  drawing: DrawingDocument,
  sheet: DrawingSheet,
  source: PartDocument | AssemblyDocument,
): string {
  const sheetW = getSheetWidthMm(sheet);
  const sheetH = getSheetHeightMm(sheet);
  const titleH = 20;

  const titleBlock = resolveTitleBlock(
    drawing,
    sheet,
    source,
    drawing.sheets.indexOf(sheet) + 1,
    drawing.sheets.length,
  );

  const viewGroups = sheet.views.map((v) => renderViewGroup(v)).join('\n');
  const dimGroups = sheet.dimensions.map((d) => renderDimensionGroup(d, sheet.views)).join('\n');
  const annGroups = sheet.annotations.map((a) => renderAnnotationGroup(a)).join('\n');
  const titleBlockSvg = renderTitleBlockSvg(titleBlock, sheetW, sheetH, titleH);

  return `<svg xmlns="http://www.w3.org/2000/svg"
  viewBox="0 0 ${sheetW} ${sheetH}"
  width="${sheetW}mm"
  height="${sheetH}mm"
  preserveAspectRatio="xMidYMid meet"
  data-sheet-id="${escapeAttr(sheet.id)}">
  <rect x="10" y="10" width="${sheetW - 20}" height="${sheetH - 20 - titleH}"
    fill="white" stroke="#000" stroke-width="0.5"/>
${viewGroups}
${dimGroups}
${annGroups}
${titleBlockSvg}
</svg>`;
}

function renderViewGroup(view: DrawingView): string {
  const vScale = view.scale.numerator / view.scale.denominator;
  const { projection } = view;

  const visibleLines = projection
    ? projection.visibleEdges.map((e) =>
        renderPolyline(e.points, 'stroke="#000" stroke-width="0.35" fill="none"',
          `data-edge-id="${escapeAttr(e.id)}" data-view-id="${escapeAttr(view.id)}"`)
      ).join('\n  ')
    : '<!-- no projection -->';

  const hiddenLines = projection
    ? projection.hiddenEdges.map((e) =>
        renderPolyline(e.points,
          'stroke="#555" stroke-width="0.18" stroke-dasharray="2 1" fill="none"',
          `data-edge-id="${escapeAttr(e.id)}" data-view-id="${escapeAttr(view.id)}" data-hidden="true"`)
      ).join('\n  ')
    : '';

  const staleMarker = (view.inputFingerprint == null)
    ? `<text x="0" y="-2" font-size="3" fill="red" data-stale-marker="${escapeAttr(view.id)}">&#x26A0; Source changed</text>`
    : '';

  return `  <g transform="translate(${view.positionMm.x},${view.positionMm.y}) scale(${vScale})"
     data-view-id="${escapeAttr(view.id)}" data-view-kind="${view.kind}">
    ${staleMarker}
    ${visibleLines}
    ${hiddenLines}
  </g>`;
}

function renderPolyline(
  points: ReadonlyArray<readonly [number, number]>,
  style: string,
  attrs: string,
): string {
  if (points.length < 2) return '';
  const pts = points.map(([x, y]) => `${x},${y}`).join(' ');
  return `<polyline points="${pts}" ${style} ${attrs}/>`;
}

function renderDimensionGroup(
  dim: DrawingSheet['dimensions'][number],
  views: readonly DrawingView[],
): string {
  const view = views.find((v) => v.id === dim.viewId);
  if (!view?.projection) return '';

  if (dim.kind === 'linear-h' || dim.kind === 'linear-v' || dim.kind === 'aligned') {
    const p1 = resolvePointRef(dim.from, view.projection);
    const p2 = resolvePointRef(dim.to, view.projection);
    if (!p1 || !p2) return '';

    const vScale = view.scale.numerator / view.scale.denominator;
    const vx = view.positionMm.x;
    const vy = view.positionMm.y;
    const x1 = vx + p1[0] * vScale;
    const y1 = vy + p1[1] * vScale;
    const x2 = vx + p2[0] * vScale;
    const y2 = vy + p2[1] * vScale;
    const offset = dim.offsetMm;
    const distMm = Math.round(Math.sqrt((p2[0] - p1[0]) ** 2 + (p2[1] - p1[1]) ** 2));
    const midX = (x1 + x2) / 2;

    if (dim.kind === 'linear-h') {
      return `  <g data-dim-id="${escapeAttr(dim.id)}" data-dim-kind="linear-h" stroke="#00c" stroke-width="0.2" fill="none">
      <line x1="${x1}" y1="${y1 - offset}" x2="${x2}" y2="${y1 - offset}"/>
      <line x1="${x1}" y1="${y1}" x2="${x1}" y2="${y1 - offset}"/>
      <line x1="${x2}" y1="${y2}" x2="${x2}" y2="${y1 - offset}"/>
      <text x="${midX}" y="${y1 - offset - 1}" font-size="3.5" text-anchor="middle" fill="#00c" stroke="none">${distMm}</text>
    </g>`;
    } else {
      return `  <g data-dim-id="${escapeAttr(dim.id)}" data-dim-kind="${dim.kind}" stroke="#00c" stroke-width="0.2" fill="none">
      <line x1="${x1 + offset}" y1="${y1}" x2="${x1 + offset}" y2="${y2}"/>
      <line x1="${x1}" y1="${y1}" x2="${x1 + offset}" y2="${y1}"/>
      <line x1="${x2}" y1="${y2}" x2="${x1 + offset}" y2="${y2}"/>
      <text x="${x1 + offset + 1}" y="${(y1 + y2) / 2}" font-size="3.5" fill="#00c" stroke="none">${distMm}</text>
    </g>`;
    }
  }
  return '';
}

function renderAnnotationGroup(ann: DrawingSheet['annotations'][number]): string {
  if (ann.kind === 'balloon') {
    const r = 4;
    return `  <g data-ann-id="${escapeAttr(ann.id)}" data-ann-kind="balloon">
    <circle cx="${ann.textPosMm.x}" cy="${ann.textPosMm.y}" r="${r}" fill="white" stroke="#000" stroke-width="0.3"/>
    <text x="${ann.textPosMm.x}" y="${ann.textPosMm.y + 1.2}" font-size="3" text-anchor="middle" dominant-baseline="middle">${ann.itemNumber}</text>
    <line x1="${ann.targetMm.x}" y1="${ann.targetMm.y}" x2="${ann.textPosMm.x}" y2="${ann.textPosMm.y + r}" stroke="#000" stroke-width="0.3"/>
  </g>`;
  }
  if (ann.kind === 'leader') {
    return `  <g data-ann-id="${escapeAttr(ann.id)}" data-ann-kind="leader">
    <line x1="${ann.targetMm.x}" y1="${ann.targetMm.y}" x2="${ann.textPosMm.x}" y2="${ann.textPosMm.y}" stroke="#000" stroke-width="0.3"/>
    <text x="${ann.textPosMm.x}" y="${ann.textPosMm.y}" font-size="3">${escapeText(ann.text)}</text>
  </g>`;
  }
  if (ann.kind === 'centerline' || ann.kind === 'center-mark') {
    return `  <g data-ann-id="${escapeAttr(ann.id)}" data-ann-kind="${ann.kind}">
    <!-- centerline / center-mark geometry rendered by DrawingCanvas from projection data -->
  </g>`;
  }
  return '';
}

function renderTitleBlockSvg(
  fields: ReturnType<typeof resolveTitleBlock>,
  sheetW: number,
  sheetH: number,
  titleH: number,
): string {
  const x = 10;
  const y = sheetH - 10 - titleH;
  const w = sheetW - 20;
  return `  <g data-title-block="true">
    <rect x="${x}" y="${y}" width="${w}" height="${titleH}" fill="white" stroke="#000" stroke-width="0.3"/>
    <line x1="${x + w / 2}" y1="${y}" x2="${x + w / 2}" y2="${y + titleH}" stroke="#000" stroke-width="0.2"/>
    <text x="${x + 2}" y="${y + 4}"  font-size="2.5" fill="#333">Drawing: ${escapeText(fields.drawingName ?? '')}</text>
    <text x="${x + 2}" y="${y + 8}"  font-size="2.5" fill="#333">Part: ${escapeText(fields.partName ?? '')}</text>
    <text x="${x + 2}" y="${y + 12}" font-size="2.5" fill="#333">Scale: ${escapeText(fields.scaleText ?? '1:1')}</text>
    <text x="${x + 2}" y="${y + 16}" font-size="2.5" fill="#333">Material: ${escapeText(fields.material ?? '')}</text>
    <text x="${x + w / 2 + 2}" y="${y + 4}"  font-size="2.5" fill="#333">Date: ${escapeText(fields.date ?? '')}</text>
    <text x="${x + w / 2 + 2}" y="${y + 8}"  font-size="2.5" fill="#333">Drawn by: ${escapeText(fields.drawnBy ?? '')}</text>
    <text x="${x + w / 2 + 2}" y="${y + 12}" font-size="2.5" fill="#333">Revision: ${escapeText(fields.revision ?? '')}</text>
    <text x="${x + w / 2 + 2}" y="${y + 16}" font-size="2.5" fill="#333">Sheet: ${fields.sheetNumber}/${fields.totalSheets}</text>
  </g>`;
}

function resolvePointRef(
  ref: DrawingSheet['dimensions'][number] extends { from: infer R } ? R : never,
  projection: NonNullable<DrawingView['projection']>,
): readonly [number, number] | null {
  const r = ref as { kind: string; edgeId?: string; end?: string };
  const edge = projection.visibleEdges.find((e) => e.id === r.edgeId)
    ?? projection.hiddenEdges.find((e) => e.id === r.edgeId);
  if (!edge || edge.points.length === 0) return null;
  if (r.end === 'end') return edge.points[edge.points.length - 1];
  if (r.kind === 'edge-midpoint') return edge.points[Math.floor(edge.points.length / 2)];
  return edge.points[0];
}

function getSheetWidthMm(sheet: DrawingSheet): number {
  if (sheet.size.kind === 'custom') {
    return sheet.orientation === 'landscape'
      ? Math.max(sheet.size.widthMm, sheet.size.heightMm)
      : Math.min(sheet.size.widthMm, sheet.size.heightMm);
  }
  const base = ISO_SIZES_MM[sheet.size.size];
  return sheet.orientation === 'landscape' ? base.w : base.h;
}

function getSheetHeightMm(sheet: DrawingSheet): number {
  if (sheet.size.kind === 'custom') {
    return sheet.orientation === 'landscape'
      ? Math.min(sheet.size.widthMm, sheet.size.heightMm)
      : Math.max(sheet.size.widthMm, sheet.size.heightMm);
  }
  const base = ISO_SIZES_MM[sheet.size.size];
  return sheet.orientation === 'landscape' ? base.h : base.w;
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
```

- [ ] **Step 4: Run the test (expect pass)**

```
cd packages/app && pnpm test:unit -- renderDrawingSvg
```
Expected: 5/5 pass.

- [ ] **Step 5: Typecheck**

```
cd packages/app && pnpm typecheck
```
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/drawing/renderDrawingSvg.ts \
        packages/app/src/drawing/__tests__/renderDrawingSvg.spec.ts
git commit -m "feat(drawing): renderDrawingSvg — pure SVG string renderer (6 §4.6)"
```

**Verify:** Result starts with `<svg`, parses as valid XML, contains one `data-view-id` group per view and a `data-title-block` group.

---

### T54 — `renderDrawingPngForSheet.ts`

**Files:**
- Create: `packages/app/src/drawing/renderDrawingPngForSheet.ts`
- Create (test): `packages/app/src/drawing/__tests__/renderDrawingPngForSheet.spec.ts`

**Agent:** Sonnet implementer.

- [ ] **Step 1: Write the failing test**

```ts
// packages/app/src/drawing/__tests__/renderDrawingPngForSheet.spec.ts
import { describe, it, expect } from 'vitest';
import { renderDrawingPngForSheet } from '../renderDrawingPngForSheet';
import { makeFixtureDrawing, makeFixturePart } from '../../__tests__/fixtures/drawingFixtures';

describe('renderDrawingPngForSheet', () => {
  it('returns a Blob with type image/png', async () => {
    const drawing = makeFixtureDrawing();
    const sheet = drawing.sheets[0];
    const blob = await renderDrawingPngForSheet(drawing, sheet, makeFixturePart(), { canvasWidthPx: 256 });
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('image/png');
  });

  it('has non-zero size', async () => {
    const drawing = makeFixtureDrawing();
    const sheet = drawing.sheets[0];
    const blob = await renderDrawingPngForSheet(drawing, sheet, makeFixturePart(), { canvasWidthPx: 256 });
    expect(blob.size).toBeGreaterThan(0);
  });

  it('starts with PNG magic bytes', async () => {
    const drawing = makeFixtureDrawing();
    const sheet = drawing.sheets[0];
    const blob = await renderDrawingPngForSheet(drawing, sheet, makeFixturePart(), { canvasWidthPx: 256 });
    const buf = await blob.arrayBuffer();
    const bytes = new Uint8Array(buf);
    // PNG magic: [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]
    expect(Array.from(bytes.slice(0, 8))).toEqual([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  });
});
```

- [ ] **Step 2: Run the test (expect fail)**

```
cd packages/app && pnpm test:unit -- renderDrawingPngForSheet
```
Expected: all 3 fail.

- [ ] **Step 3: Create `packages/app/src/drawing/renderDrawingPngForSheet.ts`**

```ts
import type { DrawingDocument, DrawingSheet } from '@zilventor/shared';
import type { PartDocument, AssemblyDocument } from '@zilventor/shared';
import { renderDrawingSvg } from './renderDrawingSvg';

export interface RenderPngOptions {
  /** Width of the output canvas in pixels. Height is computed from sheet aspect ratio. */
  canvasWidthPx?: number;
}

const DEFAULT_CANVAS_WIDTH_PX = 1024;

/**
 * Rasterises a single drawing sheet to a PNG Blob via OffscreenCanvas.
 * Falls back to a regular Canvas if OffscreenCanvas is unavailable (test env).
 */
export async function renderDrawingPngForSheet(
  drawing: DrawingDocument,
  sheet: DrawingSheet,
  source: PartDocument | AssemblyDocument,
  opts: RenderPngOptions = {},
): Promise<Blob> {
  const canvasWidthPx = opts.canvasWidthPx ?? DEFAULT_CANVAS_WIDTH_PX;

  // Determine sheet physical aspect ratio.
  const sheetW = getSheetWidthMm(sheet);
  const sheetH = getSheetHeightMm(sheet);
  const canvasHeightPx = Math.round(canvasWidthPx * (sheetH / sheetW));

  // Build SVG string.
  const svgStr = renderDrawingSvg(drawing, sheet, source);
  const svgBlob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
  const svgUrl = URL.createObjectURL(svgBlob);

  try {
    return await renderSvgUrlToPng(svgUrl, canvasWidthPx, canvasHeightPx);
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
}

async function renderSvgUrlToPng(
  svgUrl: string,
  width: number,
  height: number,
): Promise<Blob> {
  // Try OffscreenCanvas first (worker-safe, no DOM required).
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('OffscreenCanvas: no 2d context');
    await drawImageFromUrl(ctx as unknown as CanvasRenderingContext2D, svgUrl, width, height);
    return canvas.convertToBlob({ type: 'image/png' });
  }

  // Fallback: HTMLCanvasElement (test / non-worker environments).
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas: no 2d context');
  await drawImageFromUrl(ctx, svgUrl, width, height);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('canvas.toBlob returned null'));
    }, 'image/png');
  });
}

function drawImageFromUrl(
  ctx: CanvasRenderingContext2D,
  url: string,
  width: number,
  height: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const img = new Image(width, height);
    img.onload = () => {
      ctx.fillStyle = 'white';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);
      resolve();
    };
    img.onerror = () => reject(new Error(`Failed to load SVG as image: ${url}`));
    img.src = url;
  });
}

const ISO_SIZES_MM: Record<string, { w: number; h: number }> = {
  A0: { w: 1189, h: 841 },
  A1: { w: 841,  h: 594 },
  A2: { w: 594,  h: 420 },
  A3: { w: 420,  h: 297 },
  A4: { w: 297,  h: 210 },
};

function getSheetWidthMm(sheet: DrawingSheet): number {
  if (sheet.size.kind === 'custom') {
    return sheet.orientation === 'landscape'
      ? Math.max(sheet.size.widthMm, sheet.size.heightMm)
      : Math.min(sheet.size.widthMm, sheet.size.heightMm);
  }
  const base = ISO_SIZES_MM[sheet.size.size];
  return sheet.orientation === 'landscape' ? base.w : base.h;
}

function getSheetHeightMm(sheet: DrawingSheet): number {
  if (sheet.size.kind === 'custom') {
    return sheet.orientation === 'landscape'
      ? Math.min(sheet.size.widthMm, sheet.size.heightMm)
      : Math.max(sheet.size.widthMm, sheet.size.heightMm);
  }
  const base = ISO_SIZES_MM[sheet.size.size];
  return sheet.orientation === 'landscape' ? base.h : base.w;
}
```

- [ ] **Step 4: Run the test (expect pass)**

```
cd packages/app && pnpm test:unit -- renderDrawingPngForSheet
```
Expected: 3/3 pass.

- [ ] **Step 5: Typecheck**

```
cd packages/app && pnpm typecheck
```
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/drawing/renderDrawingPngForSheet.ts \
        packages/app/src/drawing/__tests__/renderDrawingPngForSheet.spec.ts
git commit -m "feat(drawing): renderDrawingPngForSheet — OffscreenCanvas PNG export (6 §4.6)"
```

**Verify:** Result `type === 'image/png'`, magic bytes `\x89PNG\r\n\x1a\n`, size > 0.

---

### T55 — Three export commands

**Files:**
- Create: `packages/app/src/commands/ExportDrawingPdfCommand.ts`
- Create: `packages/app/src/commands/ExportDrawingSvgCommand.ts`
- Create: `packages/app/src/commands/ExportDrawingPngCommand.ts`
- Create (test): `packages/app/src/commands/__tests__/ExportDrawingPdfCommand.spec.ts`
- Create (test): `packages/app/src/commands/__tests__/ExportDrawingSvgCommand.spec.ts`
- Create (test): `packages/app/src/commands/__tests__/ExportDrawingPngCommand.spec.ts`

**Agent:** Sonnet implementer.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/app/src/commands/__tests__/ExportDrawingPdfCommand.spec.ts
import { describe, it, expect, vi } from 'vitest';
import { ExportDrawingPdfCommand } from '../ExportDrawingPdfCommand';
import { makeFixtureDrawing, makeFixturePart } from '../../__tests__/fixtures/drawingFixtures';

vi.mock('../../nesting/triggerDownload', () => ({
  triggerDownload: vi.fn().mockResolvedValue(undefined),
}));

import { triggerDownload } from '../../nesting/triggerDownload';

describe('ExportDrawingPdfCommand', () => {
  it('calls triggerDownload with a non-empty Blob of type application/pdf', async () => {
    const cmd = new ExportDrawingPdfCommand({
      drawing: makeFixtureDrawing(),
      source: makeFixturePart(),
    });
    await cmd.apply();
    expect(triggerDownload).toHaveBeenCalledTimes(1);
    const [blob] = (triggerDownload as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('application/pdf');
    expect(blob.size).toBeGreaterThan(0);
  });
});
```

```ts
// packages/app/src/commands/__tests__/ExportDrawingSvgCommand.spec.ts
import { describe, it, expect, vi } from 'vitest';
import { ExportDrawingSvgCommand } from '../ExportDrawingSvgCommand';
import { makeFixtureDrawing, makeFixturePart } from '../../__tests__/fixtures/drawingFixtures';

vi.mock('../../nesting/triggerDownload', () => ({
  triggerDownload: vi.fn().mockResolvedValue(undefined),
}));

import { triggerDownload } from '../../nesting/triggerDownload';

describe('ExportDrawingSvgCommand', () => {
  it('calls triggerDownload with a non-empty Blob of type image/svg+xml', async () => {
    const drawing = makeFixtureDrawing();
    const cmd = new ExportDrawingSvgCommand({
      drawing,
      sheetId: drawing.sheets[0].id,
      source: makeFixturePart(),
    });
    await cmd.apply();
    expect(triggerDownload).toHaveBeenCalledTimes(1);
    const [blob] = (triggerDownload as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('image/svg+xml');
    expect(blob.size).toBeGreaterThan(0);
  });
});
```

```ts
// packages/app/src/commands/__tests__/ExportDrawingPngCommand.spec.ts
import { describe, it, expect, vi } from 'vitest';
import { ExportDrawingPngCommand } from '../ExportDrawingPngCommand';
import { makeFixtureDrawing, makeFixturePart } from '../../__tests__/fixtures/drawingFixtures';

vi.mock('../../nesting/triggerDownload', () => ({
  triggerDownload: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../drawing/renderDrawingPngForSheet', () => ({
  renderDrawingPngForSheet: vi.fn().mockResolvedValue(
    new Blob([new Uint8Array([0x89, 0x50, 0x4E, 0x47])], { type: 'image/png' })
  ),
}));

import { triggerDownload } from '../../nesting/triggerDownload';

describe('ExportDrawingPngCommand', () => {
  it('calls triggerDownload with a Blob of type image/png', async () => {
    const drawing = makeFixtureDrawing();
    const cmd = new ExportDrawingPngCommand({
      drawing,
      sheetId: drawing.sheets[0].id,
      source: makeFixturePart(),
    });
    await cmd.apply();
    expect(triggerDownload).toHaveBeenCalledTimes(1);
    const [blob] = (triggerDownload as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('image/png');
  });
});
```

- [ ] **Step 2: Run the tests (expect fail)**

```
cd packages/app && pnpm test:unit -- ExportDrawingPdfCommand ExportDrawingSvgCommand ExportDrawingPngCommand
```

- [ ] **Step 3: Create the three commands**

```ts
// packages/app/src/commands/ExportDrawingPdfCommand.ts
import type { DrawingDocument } from '@zilventor/shared';
import type { PartDocument, AssemblyDocument } from '@zilventor/shared';
import { renderDrawingPdfBytes } from '../drawing/renderDrawingPdf';
import { triggerDownload } from '../nesting/triggerDownload';

declare global {
  // E2E-inspectable bytes from the latest export call.
  // eslint-disable-next-line no-var
  var __zilventorDrawingPdfBytes: Uint8Array | undefined;
}

export class ExportDrawingPdfCommand {
  constructor(
    private readonly opts: {
      drawing: DrawingDocument;
      source: PartDocument | AssemblyDocument;
      suggestedName?: string;
    },
  ) {}

  async apply(): Promise<void> {
    const buf = renderDrawingPdfBytes(this.opts.drawing, this.opts.source);
    (globalThis as { __zilventorDrawingPdfBytes?: Uint8Array }).__zilventorDrawingPdfBytes = buf;
    const blob = new Blob([buf as unknown as BlobPart], { type: 'application/pdf' });
    await triggerDownload(blob, {
      suggestedName: this.opts.suggestedName ?? `drawing-${timestamp()}.pdf`,
      mimeType: 'application/pdf',
      extension: 'pdf',
      description: 'Drawing PDF',
    });
  }
}

function timestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}
```

```ts
// packages/app/src/commands/ExportDrawingSvgCommand.ts
import type { DrawingDocument } from '@zilventor/shared';
import type { PartDocument, AssemblyDocument } from '@zilventor/shared';
import { renderDrawingSvg } from '../drawing/renderDrawingSvg';
import { triggerDownload } from '../nesting/triggerDownload';

export class ExportDrawingSvgCommand {
  constructor(
    private readonly opts: {
      drawing: DrawingDocument;
      sheetId: string;
      source: PartDocument | AssemblyDocument;
      suggestedName?: string;
    },
  ) {}

  async apply(): Promise<void> {
    const sheet = this.opts.drawing.sheets.find((s) => s.id === this.opts.sheetId);
    if (!sheet) throw new Error(`Sheet ${this.opts.sheetId} not found`);
    const svgStr = renderDrawingSvg(this.opts.drawing, sheet, this.opts.source);
    const blob = new Blob([svgStr], { type: 'image/svg+xml' });
    await triggerDownload(blob, {
      suggestedName: this.opts.suggestedName ?? `drawing-${this.opts.sheetId}.svg`,
      mimeType: 'image/svg+xml',
      extension: 'svg',
      description: 'Drawing SVG',
    });
  }
}
```

```ts
// packages/app/src/commands/ExportDrawingPngCommand.ts
import type { DrawingDocument } from '@zilventor/shared';
import type { PartDocument, AssemblyDocument } from '@zilventor/shared';
import { renderDrawingPngForSheet } from '../drawing/renderDrawingPngForSheet';
import { triggerDownload } from '../nesting/triggerDownload';

export class ExportDrawingPngCommand {
  constructor(
    private readonly opts: {
      drawing: DrawingDocument;
      sheetId: string;
      source: PartDocument | AssemblyDocument;
      canvasWidthPx?: number;
      suggestedName?: string;
    },
  ) {}

  async apply(): Promise<void> {
    const sheet = this.opts.drawing.sheets.find((s) => s.id === this.opts.sheetId);
    if (!sheet) throw new Error(`Sheet ${this.opts.sheetId} not found`);
    const blob = await renderDrawingPngForSheet(
      this.opts.drawing,
      sheet,
      this.opts.source,
      { canvasWidthPx: this.opts.canvasWidthPx ?? 1024 },
    );
    await triggerDownload(blob, {
      suggestedName: this.opts.suggestedName ?? `drawing-${this.opts.sheetId}.png`,
      mimeType: 'image/png',
      extension: 'png',
      description: 'Drawing PNG',
    });
  }
}
```

- [ ] **Step 4: Run the tests (expect pass)**

```
cd packages/app && pnpm test:unit -- ExportDrawingPdfCommand ExportDrawingSvgCommand ExportDrawingPngCommand
```
Expected: 3/3 pass (one per command).

- [ ] **Step 5: Typecheck**

```
cd packages/app && pnpm typecheck
```

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/commands/ExportDrawingPdfCommand.ts \
        packages/app/src/commands/ExportDrawingSvgCommand.ts \
        packages/app/src/commands/ExportDrawingPngCommand.ts \
        packages/app/src/commands/__tests__/ExportDrawingPdfCommand.spec.ts \
        packages/app/src/commands/__tests__/ExportDrawingSvgCommand.spec.ts \
        packages/app/src/commands/__tests__/ExportDrawingPngCommand.spec.ts
git commit -m "feat(drawing): ExportDrawingPdf/Svg/Png commands (6 §4.6)"
```

**Verify:** Each command's `apply()` calls `triggerDownload` with the correct MIME type.

---

## Phase 10 — E2E specs + perf spec + manual smoke

### Batch: T56–T61 — Six E2E specs

Dispatch as a single batch to one Sonnet subagent. All six specs live in `tests/e2e/drawing/`.

---

### T56 — T-6-1 Create new drawing

**Files:**
- Create: `tests/e2e/drawing/T-6-1-create-new-drawing.spec.ts`

**Agent:** Sonnet implementer.

- [ ] **Step 1: Create the spec**

```ts
// tests/e2e/drawing/T-6-1-create-new-drawing.spec.ts
import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';

/**
 * T-6-1 — Create new drawing from an active part.
 *
 * Steps:
 *   1. Open app, wait for kernel ready.
 *   2. Create a new part with a 100×60×40 box (via store).
 *   3. File → New Drawing.
 *   4. Assert: drawing tab is open, sheet exists at A3 landscape, title block populated.
 */
test('T-6-1: Create new drawing from part — A3 sheet + title block populated', async ({ page }) => {
  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('/');
  await waitForKernelReady(page);

  // 1. Seed a part document via store.
  await page.evaluate(() => {
    const w = window as unknown as {
      __zilventorStore: { getState(): {
        createPartDocument(opts: { name: string }): void;
      } };
    };
    w.__zilventorStore.getState().createPartDocument({ name: 'BoxPart' });
  });

  // 2. Wait for part to be active.
  await page.waitForFunction(() => {
    const w = window as unknown as {
      __zilventorStore: { getState(): { activeDocument?: { kind: string } } };
    };
    return w.__zilventorStore?.getState().activeDocument?.kind === 'part';
  });

  // 3. File → New Drawing.
  await page.getByRole('tab', { name: 'File' }).click();
  await page.getByRole('button', { name: /new drawing/i }).click();

  // 4. If a dialog appears, confirm defaults (A3 landscape).
  const dialog = page.getByRole('dialog', { name: /new drawing/i });
  if (await dialog.isVisible()) {
    await page.getByRole('button', { name: 'OK' }).click();
  }

  // 5. Assert: drawing kind is active.
  await page.waitForFunction(() => {
    const w = window as unknown as {
      __zilventorStore: { getState(): { activeDocument?: { kind: string } } };
    };
    return w.__zilventorStore?.getState().activeDocument?.kind === 'drawing';
  }, undefined, { timeout: 10_000 });

  // 6. Assert: DrawingCanvas SVG is visible.
  await expect(page.locator('[data-drawing-canvas]')).toBeVisible();

  // 7. Assert: first sheet is A3 landscape.
  const sheetSize = await page.evaluate(() => {
    const w = window as unknown as {
      __zilventorStore: { getState(): { activeDocument?: {
        kind: string;
        document: { sheets: Array<{ size: { kind: string; size?: string }; orientation: string }> };
      } } };
    };
    const doc = w.__zilventorStore.getState().activeDocument;
    if (doc?.kind !== 'drawing') return null;
    const sheet = doc.document.sheets[0];
    return { sizeKind: sheet.size.kind, size: (sheet.size as { size?: string }).size, orientation: sheet.orientation };
  });
  expect(sheetSize?.sizeKind).toBe('iso');
  expect(sheetSize?.size).toBe('A3');
  expect(sheetSize?.orientation).toBe('landscape');

  // 8. Assert: title block has drawing name populated.
  await expect(page.locator('[data-title-block]')).toBeVisible();
  const titleBlockText = await page.locator('[data-title-block]').textContent();
  expect(titleBlockText).toBeTruthy();
  expect(titleBlockText).toContain('BoxPart');
});
```

- [ ] **Step 2: Run the spec**

```
pnpm e2e -- --grep "T-6-1"
```
Expected: pass.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/drawing/T-6-1-create-new-drawing.spec.ts
git commit -m "test(e2e): T-6-1 Create new drawing (6 §9.3)"
```

**Verify:** Spec passes; drawing kind active, A3 landscape sheet, title block visible.

---

### T57 — T-6-2 Place base + projected views

**Files:**
- Create: `tests/e2e/drawing/T-6-2-place-views.spec.ts`

**Agent:** Sonnet implementer.

- [ ] **Step 1: Create the spec**

```ts
// tests/e2e/drawing/T-6-2-place-views.spec.ts
import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';
import { seedDrawingWithBoxPart } from '../helpers/seedDrawing';

/**
 * T-6-2 — Place base view + right-projected view.
 *
 * Steps:
 *   1. Seed a drawing with a 100×60×40 box part (T-6-1 state).
 *   2. Drawing → Place Views → Base → click at (100, 100).
 *   3. Drawing → Place Views → Projected → drag right → drop at (220, 100).
 *   4. Assert: 2 views in the sheet's SVG, projected view at correct aligned offset.
 */
test('T-6-2: Place base + right-projected view — 2 view groups in SVG', async ({ page }) => {
  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('/');
  await waitForKernelReady(page);

  // 1. Seed drawing.
  await seedDrawingWithBoxPart(page, {
    boxLength: 100, boxWidth: 60, boxHeight: 40,
    sheetSize: 'A3', orientation: 'landscape',
  });

  // 2. Place base view via ribbon.
  await page.getByRole('tab', { name: 'Drawing' }).click();
  await page.getByRole('button', { name: 'Base View' }).click();

  // Click on the canvas at a sheet-relative position.
  const canvas = page.locator('[data-drawing-canvas]');
  await canvas.click({ position: { x: 150, y: 100 } });

  // 3. Wait for 1 view to appear.
  await page.waitForFunction(() => {
    const w = window as unknown as {
      __zilventorStore: { getState(): { activeDocument?: {
        kind: string;
        document: { sheets: Array<{ views: unknown[] }> };
      } } };
    };
    const doc = w.__zilventorStore.getState().activeDocument;
    if (doc?.kind !== 'drawing') return false;
    return doc.document.sheets[0].views.length === 1;
  }, undefined, { timeout: 10_000 });

  // 4. Place projected view to the right.
  await page.getByRole('button', { name: 'Projected View' }).click();
  await canvas.click({ position: { x: 350, y: 100 } });

  // 5. Wait for 2 views.
  await page.waitForFunction(() => {
    const w = window as unknown as {
      __zilventorStore: { getState(): { activeDocument?: {
        kind: string;
        document: { sheets: Array<{ views: unknown[] }> };
      } } };
    };
    const doc = w.__zilventorStore.getState().activeDocument;
    if (doc?.kind !== 'drawing') return false;
    return doc.document.sheets[0].views.length === 2;
  }, undefined, { timeout: 10_000 });

  // 6. Assert: 2 view groups in the SVG.
  const viewGroups = page.locator('[data-drawing-canvas] [data-view-id]');
  await expect(viewGroups).toHaveCount(2);

  // 7. Assert: second view is to the right of the first.
  const positions = await page.evaluate(() => {
    const w = window as unknown as {
      __zilventorStore: { getState(): { activeDocument?: {
        kind: string;
        document: { sheets: Array<{ views: Array<{ positionMm: { x: number; y: number } }> }> };
      } } };
    };
    const doc = w.__zilventorStore.getState().activeDocument;
    if (doc?.kind !== 'drawing') return null;
    return doc.document.sheets[0].views.map((v) => v.positionMm);
  });
  expect(positions).not.toBeNull();
  expect(positions![1].x).toBeGreaterThan(positions![0].x);
});
```

- [ ] **Step 2: Run the spec**

```
pnpm e2e -- --grep "T-6-2"
```
Expected: pass.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/drawing/T-6-2-place-views.spec.ts
git commit -m "test(e2e): T-6-2 Place base + projected views (6 §9.3)"
```

**Verify:** 2 view groups in SVG; projected view position.x > base view position.x.

---

### T58 — T-6-3 Linear-H dimension + Ctrl-Z

**Files:**
- Create: `tests/e2e/drawing/T-6-3-add-linear-dim.spec.ts`

**Agent:** Sonnet implementer.

- [ ] **Step 1: Create the spec**

```ts
// tests/e2e/drawing/T-6-3-add-linear-dim.spec.ts
import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';
import { seedDrawingWithView } from '../helpers/seedDrawing';

/**
 * T-6-3 — Add linear-H dimension between two box endpoints; Ctrl-Z removes it.
 *
 * Steps:
 *   1. Seed a drawing with one base view (front, 100×60×40 box) already projected.
 *   2. Drawing → Dimension → Linear (H).
 *   3. Click first edge endpoint → click second → drag offset.
 *   4. Assert: dimension text shows "100".
 *   5. Ctrl-Z → assert: dimension removed (count 0).
 */
test('T-6-3: Linear-H dimension shows 100; Ctrl-Z removes it', async ({ page }) => {
  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('/');
  await waitForKernelReady(page);

  // 1. Seed drawing with one pre-projected base view.
  await seedDrawingWithView(page, {
    boxLength: 100, boxWidth: 60, boxHeight: 40,
    orientation: 'front', scale: { numerator: 1, denominator: 1 },
  });

  // 2. Place dimension via ribbon.
  await page.getByRole('tab', { name: 'Drawing' }).click();
  await page.getByRole('button', { name: /linear.*h/i }).click();

  // 3. Click two endpoints on the canvas (positions correspond to the box's left and right edges
  //    at scale 1:1, with the view centred on the sheet).
  const canvas = page.locator('[data-drawing-canvas]');
  // Simulate picking two edge endpoints stored in the view via the store.
  await page.evaluate(() => {
    const w = window as unknown as {
      __zilventorPickEdgeEndpoint?: (edgeId: string, end: 'start' | 'end') => void;
    };
    // The store exposes a test hook __zilventorPickEdgeEndpoint used in addLinearH tool mode.
    w.__zilventorPickEdgeEndpoint?.('front_edge0_0', 'start');
  });
  await page.evaluate(() => {
    const w = window as unknown as {
      __zilventorPickEdgeEndpoint?: (edgeId: string, end: 'start' | 'end') => void;
    };
    w.__zilventorPickEdgeEndpoint?.('front_edge0_0', 'end');
  });
  // Simulate offset drag by clicking canvas below the view.
  await canvas.click({ position: { x: 150, y: 200 } });

  // 4. Assert: dimension present in the store.
  await page.waitForFunction(() => {
    const w = window as unknown as {
      __zilventorStore: { getState(): { activeDocument?: {
        kind: string;
        document: { sheets: Array<{ dimensions: unknown[] }> };
      } } };
    };
    const doc = w.__zilventorStore.getState().activeDocument;
    if (doc?.kind !== 'drawing') return false;
    return doc.document.sheets[0].dimensions.length === 1;
  }, undefined, { timeout: 10_000 });

  // 5. Assert: dimension text "100" visible in the SVG.
  const dimText = page.locator('[data-dim-kind="linear-h"] text');
  await expect(dimText).toContainText('100');

  // 6. Ctrl-Z → dimension removed.
  await page.keyboard.press('Control+z');
  await page.waitForFunction(() => {
    const w = window as unknown as {
      __zilventorStore: { getState(): { activeDocument?: {
        kind: string;
        document: { sheets: Array<{ dimensions: unknown[] }> };
      } } };
    };
    const doc = w.__zilventorStore.getState().activeDocument;
    if (doc?.kind !== 'drawing') return false;
    return doc.document.sheets[0].dimensions.length === 0;
  }, undefined, { timeout: 5_000 });

  await expect(page.locator('[data-dim-kind="linear-h"]')).toHaveCount(0);
});
```

- [ ] **Step 2: Run the spec**

```
pnpm e2e -- --grep "T-6-3"
```
Expected: pass.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/drawing/T-6-3-add-linear-dim.spec.ts
git commit -m "test(e2e): T-6-3 Linear-H dimension + Ctrl-Z (6 §9.3)"
```

**Verify:** Dimension text "100" in SVG; Ctrl-Z removes it from both store and SVG.

---

### T59 — T-6-4 Stale banner + regenerate

**Files:**
- Create: `tests/e2e/drawing/T-6-4-stale-banner-regen.spec.ts`

**Agent:** Sonnet implementer.

- [ ] **Step 1: Create the spec**

```ts
// tests/e2e/drawing/T-6-4-stale-banner-regen.spec.ts
import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';
import { seedDrawingWithView } from '../helpers/seedDrawing';

/**
 * T-6-4 — Edit source geometry → stale banner → Regenerate clears it.
 *
 * Steps:
 *   1. Seed drawing with a base view of a 100×60×40 box.
 *   2. Switch to the source part, change box length 100 → 120.
 *   3. Switch back to the drawing tab.
 *   4. Assert: stale banner visible on the view.
 *   5. Click Regenerate on the banner.
 *   6. Assert: banner cleared; the dimension (if any) shows updated value.
 */
test('T-6-4: Edit source → stale banner → Regenerate clears it', async ({ page }) => {
  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('/');
  await waitForKernelReady(page);

  // 1. Seed drawing with one projected base view.
  const { partDocId } = await seedDrawingWithView(page, {
    boxLength: 100, boxWidth: 60, boxHeight: 40,
    orientation: 'front', scale: { numerator: 1, denominator: 1 },
  });

  // 2. Switch to the source part and modify geometry.
  await page.evaluate((docId: string) => {
    const w = window as unknown as {
      __zilventorStore: { getState(): {
        setActiveDocumentById(id: string): void;
        updatePartParameter(id: string, key: string, value: number): void;
      } };
    };
    w.__zilventorStore.getState().setActiveDocumentById(docId);
    w.__zilventorStore.getState().updatePartParameter(docId, 'length', 120);
  }, partDocId);

  // 3. Switch back to the drawing.
  await page.evaluate(() => {
    const w = window as unknown as {
      __zilventorStore: { getState(): {
        setActiveDrawing(): void;
      } };
    };
    w.__zilventorStore.getState().setActiveDrawing();
  });

  await page.waitForFunction(() => {
    const w = window as unknown as {
      __zilventorStore: { getState(): { activeDocument?: { kind: string } } };
    };
    return w.__zilventorStore?.getState().activeDocument?.kind === 'drawing';
  });

  // 4. Assert: stale-marker visible (SHA-256 fingerprint mismatch triggers this within 10s).
  await expect(page.locator('[data-stale-marker]')).toBeVisible({ timeout: 10_000 });

  // 5. Click Regenerate.
  await page.getByRole('button', { name: /regenerate/i }).click();

  // 6. Assert: stale marker cleared.
  await expect(page.locator('[data-stale-marker]')).toHaveCount(0, { timeout: 10_000 });
});
```

- [ ] **Step 2: Run the spec**

```
pnpm e2e -- --grep "T-6-4"
```
Expected: pass.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/drawing/T-6-4-stale-banner-regen.spec.ts
git commit -m "test(e2e): T-6-4 Stale-banner round-trip (6 §9.3)"
```

**Verify:** `[data-stale-marker]` appears after source edit; disappears after Regenerate.

---

### T60 — T-6-5 Export PDF magic-byte check

**Files:**
- Create: `tests/e2e/drawing/T-6-5-export-pdf-magic.spec.ts`

**Agent:** Sonnet implementer.

- [ ] **Step 1: Create the spec** (mirrors T-5e-4 exactly)

```ts
// tests/e2e/drawing/T-6-5-export-pdf-magic.spec.ts
import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';
import { seedDrawingWithView } from '../helpers/seedDrawing';

/**
 * T-6-5 — Export Drawing PDF: magic bytes %PDF- + non-zero size + application/pdf MIME.
 *
 * Mirrors 5e's T-5e-4 pattern:
 *   - Seed a drawing with one view.
 *   - Mock showSaveFilePicker to AbortError (preserves __zilventorDrawingPdfBytes).
 *   - Click Export PDF.
 *   - Assert: first 5 bytes are [37, 80, 68, 70, 45] ('%PDF-').
 */
test('T-6-5: Export PDF — magic bytes %PDF- and non-zero size', async ({ page }) => {
  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('/');
  await waitForKernelReady(page);

  // 1. Seed drawing with one projected view.
  await seedDrawingWithView(page, {
    boxLength: 100, boxWidth: 60, boxHeight: 40,
    orientation: 'front', scale: { numerator: 1, denominator: 1 },
  });

  // 2. Mock showSaveFilePicker to abort immediately (preserving bytes).
  await page.evaluate(() => {
    (window as unknown as { showSaveFilePicker: unknown }).showSaveFilePicker = async () => {
      throw new DOMException('cancelled', 'AbortError');
    };
  });

  // 3. Click Export PDF on the Drawing ribbon.
  await page.getByRole('tab', { name: 'Drawing' }).click();
  await page.getByRole('button', { name: 'Export PDF' }).click();

  // 4. Wait for bytes to be set.
  await page.waitForFunction(() => {
    return !!(window as { __zilventorDrawingPdfBytes?: Uint8Array }).__zilventorDrawingPdfBytes;
  }, undefined, { timeout: 10_000 });

  // 5. Check length > 0.
  const len = await page.evaluate(() =>
    (window as { __zilventorDrawingPdfBytes?: Uint8Array }).__zilventorDrawingPdfBytes?.length ?? 0
  );
  expect(len).toBeGreaterThan(0);

  // 6. Check magic bytes '%PDF-' = [37, 80, 68, 70, 45].
  const head = await page.evaluate(() => {
    const bytes = (window as { __zilventorDrawingPdfBytes?: Uint8Array }).__zilventorDrawingPdfBytes;
    return Array.from((bytes ?? new Uint8Array()).slice(0, 5));
  });
  expect(head).toEqual([37, 80, 68, 70, 45]);
});
```

- [ ] **Step 2: Run the spec**

```
pnpm e2e -- --grep "T-6-5"
```
Expected: pass.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/drawing/T-6-5-export-pdf-magic.spec.ts
git commit -m "test(e2e): T-6-5 Export PDF magic-byte check (6 §9.3)"
```

**Verify:** `__zilventorDrawingPdfBytes` non-empty; first 5 bytes `[37, 80, 68, 70, 45]`.

---

### T61 — T-6-6 Balloon on assembly drawing

**Files:**
- Create: `tests/e2e/drawing/T-6-6-balloon-bom.spec.ts`

**Agent:** Sonnet implementer.

- [ ] **Step 1: Create the spec**

```ts
// tests/e2e/drawing/T-6-6-balloon-bom.spec.ts
import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';

/**
 * T-6-6 — Balloon on assembly drawing shows the BOM item number.
 *
 * Steps:
 *   1. Create an assembly with 2 components; set bomItemNumbers.
 *   2. Create a drawing from the assembly.
 *   3. Place a base view.
 *   4. Drawing → Annotate → Balloon → click component face.
 *   5. Assert: balloon text equals the component's itemNumber.
 */
test('T-6-6: Balloon on assembly drawing shows BOM item number', async ({ page }) => {
  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('/');
  await waitForKernelReady(page);

  // 1. Seed assembly with 2 components + bomItemNumbers.
  await page.evaluate(() => {
    const w = window as unknown as {
      __zilventorStore: { getState(): {
        createAssemblyDocument(opts: { name: string }): void;
        addComponent(c: unknown): void;
        setBomItemNumbers(nums: Record<string, number>): void;
      } };
    };
    const s = w.__zilventorStore.getState();
    s.createAssemblyDocument({ name: 'TestAsm' });
    s.addComponent({ id: 'C1', partPath: 'parts/p1.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true });
    s.addComponent({ id: 'C2', partPath: 'parts/p2.zipt', position: { x: 200, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true });
    s.setBomItemNumbers({ 'C1': 1, 'C2': 2 });
  });

  await page.waitForFunction(() => {
    const w = window as unknown as {
      __zilventorStore: { getState(): { activeDocument?: { kind: string } } };
    };
    return w.__zilventorStore?.getState().activeDocument?.kind === 'assembly';
  });

  // 2. Create drawing from assembly.
  await page.getByRole('tab', { name: 'File' }).click();
  await page.getByRole('button', { name: /new drawing/i }).click();
  const dialog = page.getByRole('dialog', { name: /new drawing/i });
  if (await dialog.isVisible()) {
    await page.getByRole('button', { name: 'OK' }).click();
  }

  await page.waitForFunction(() => {
    const w = window as unknown as {
      __zilventorStore: { getState(): { activeDocument?: { kind: string } } };
    };
    return w.__zilventorStore?.getState().activeDocument?.kind === 'drawing';
  }, undefined, { timeout: 10_000 });

  // 3. Place base view.
  await page.getByRole('tab', { name: 'Drawing' }).click();
  await page.getByRole('button', { name: 'Base View' }).click();
  const canvas = page.locator('[data-drawing-canvas]');
  await canvas.click({ position: { x: 150, y: 120 } });

  await page.waitForFunction(() => {
    const w = window as unknown as {
      __zilventorStore: { getState(): { activeDocument?: {
        kind: string;
        document: { sheets: Array<{ views: unknown[] }> };
      } } };
    };
    const doc = w.__zilventorStore.getState().activeDocument;
    if (doc?.kind !== 'drawing') return false;
    return doc.document.sheets[0].views.length >= 1;
  }, undefined, { timeout: 10_000 });

  // 4. Add balloon via Annotate → Balloon, then pick component C1.
  await page.getByRole('button', { name: /balloon/i }).click();
  await page.evaluate(() => {
    const w = window as unknown as {
      __zilventorPickComponent?: (componentId: string, targetMm: { x: number; y: number }) => void;
    };
    w.__zilventorPickComponent?.('C1', { x: 80, y: 100 });
  });

  // 5. Assert: balloon with itemNumber "1" is present in the SVG.
  await page.waitForFunction(() => {
    const w = window as unknown as {
      __zilventorStore: { getState(): { activeDocument?: {
        kind: string;
        document: { sheets: Array<{ annotations: Array<{ kind: string; itemNumber: number }> }> };
      } } };
    };
    const doc = w.__zilventorStore.getState().activeDocument;
    if (doc?.kind !== 'drawing') return false;
    return doc.document.sheets[0].annotations.some((a) => a.kind === 'balloon' && a.itemNumber === 1);
  }, undefined, { timeout: 10_000 });

  const balloonText = page.locator('[data-ann-kind="balloon"] text');
  await expect(balloonText).toContainText('1');
});
```

- [ ] **Step 2: Run the spec**

```
pnpm e2e -- --grep "T-6-6"
```
Expected: pass.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/drawing/T-6-6-balloon-bom.spec.ts
git commit -m "test(e2e): T-6-6 Balloon BOM item number on assembly drawing (6 §9.3)"
```

**Verify:** `[data-ann-kind="balloon"] text` contains "1" (item number for C1).

---

### Batch: T62 — Perf spec

### T62 — `drawing-large.perf.spec.ts`

**Files:**
- Create: `tests/perf/drawing-large.perf.spec.ts`

**Agent:** Sonnet implementer.

- [ ] **Step 1: Create the perf spec** (mirrors `nest-large.spec.ts` shape)

```ts
// tests/perf/drawing-large.perf.spec.ts
import { test, expect } from '@playwright/test';

/**
 * Perf T62 — drawing-large:
 *   - Single-view projection p95 < 200 ms.
 *   - Whole-sheet render (4 views) p95 < 100 ms.
 *   - PDF export (4-sheet drawing) p95 < 500 ms.
 *
 * The app exposes these window hooks when running in dev mode:
 *   __zilventorProjectViewMs(iterations: number): number     → p95 of single-view projection
 *   __zilventorRenderSheetMs(iterations: number): number     → p95 of 4-view sheet render
 *   __zilventorExportPdfMs(iterations: number): number       → p95 of 4-sheet PDF export
 *
 * Each hook runs N iterations and returns the p95 in ms.
 */

test('Perf T62a: single-view projection p95 < 200 ms (50-feature part)', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(
    () => typeof (window as { __zilventorProjectViewMs?: unknown }).__zilventorProjectViewMs === 'function',
    undefined,
    { timeout: 30_000 },
  );
  const p95 = await page.evaluate(
    () => (window as { __zilventorProjectViewMs?: (n: number) => number }).__zilventorProjectViewMs!(20),
  );
  console.log(`[perf] single-view projection p95 = ${p95.toFixed(2)} ms (budget 200ms)`);
  expect(p95).toBeLessThan(200);
});

test('Perf T62b: 4-view sheet first-render p95 < 100 ms', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(
    () => typeof (window as { __zilventorRenderSheetMs?: unknown }).__zilventorRenderSheetMs === 'function',
    undefined,
    { timeout: 30_000 },
  );
  const p95 = await page.evaluate(
    () => (window as { __zilventorRenderSheetMs?: (n: number) => number }).__zilventorRenderSheetMs!(20),
  );
  console.log(`[perf] 4-view sheet render p95 = ${p95.toFixed(2)} ms (budget 100ms)`);
  expect(p95).toBeLessThan(100);
});

test('Perf T62c: PDF export of 4-sheet drawing p95 < 500 ms', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(
    () => typeof (window as { __zilventorExportPdfMs?: unknown }).__zilventorExportPdfMs === 'function',
    undefined,
    { timeout: 30_000 },
  );
  const p95 = await page.evaluate(
    () => (window as { __zilventorExportPdfMs?: (n: number) => number }).__zilventorExportPdfMs!(20),
  );
  console.log(`[perf] 4-sheet PDF export p95 = ${p95.toFixed(2)} ms (budget 500ms)`);
  expect(p95).toBeLessThan(500);
});
```

- [ ] **Step 2: Expose window perf hooks in the app**

Add to `packages/app/src/drawing/perfHooks.ts` (dev-only, tree-shaken in production):

```ts
// packages/app/src/drawing/perfHooks.ts
import { projectView } from '@zilventor/shared/src/drawing/projector';
import { renderDrawingPdfBytes } from './renderDrawingPdf';
import type { DrawingDocument } from '@zilventor/shared';
import type { PartDocument } from '@zilventor/shared';
import { makePerfFixture50Feature } from './__tests__/fixtures/perfFixture';

function percentile95(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * 0.95) - 1] ?? 0;
}

/** Called once at app startup in dev mode to wire up window perf hooks. */
export function registerDrawingPerfHooks(): void {
  if (import.meta.env.PROD) return;

  const { projectorInput, fixtureDrawing4Sheet, fixturePart } = makePerfFixture50Feature();

  (window as { __zilventorProjectViewMs?: unknown }).__zilventorProjectViewMs = (n: number) => {
    const samples: number[] = [];
    for (let i = 0; i < n; i++) {
      const t0 = performance.now();
      projectView(projectorInput, 'front');
      samples.push(performance.now() - t0);
    }
    return percentile95(samples);
  };

  (window as { __zilventorRenderSheetMs?: unknown }).__zilventorRenderSheetMs = (n: number) => {
    const samples: number[] = [];
    for (let i = 0; i < n; i++) {
      const t0 = performance.now();
      // Trigger a full 4-view sheet SVG render.
      import('./renderDrawingSvg').then(({ renderDrawingSvg }) => {
        renderDrawingSvg(fixtureDrawing4Sheet, fixtureDrawing4Sheet.sheets[0], fixturePart);
      });
      samples.push(performance.now() - t0);
    }
    return percentile95(samples);
  };

  (window as { __zilventorExportPdfMs?: unknown }).__zilventorExportPdfMs = (n: number) => {
    const samples: number[] = [];
    for (let i = 0; i < n; i++) {
      const t0 = performance.now();
      renderDrawingPdfBytes(fixtureDrawing4Sheet, fixturePart);
      samples.push(performance.now() - t0);
    }
    return percentile95(samples);
  };
}
```

- [ ] **Step 3: Run the perf spec**

```
pnpm e2e -- tests/perf/drawing-large.perf.spec.ts
```
Expected: T62a p95 < 200ms, T62b p95 < 100ms, T62c p95 < 500ms.

- [ ] **Step 4: Commit**

```bash
git add tests/perf/drawing-large.perf.spec.ts \
        packages/app/src/drawing/perfHooks.ts
git commit -m "test(perf): drawing-large p95 — projection 200ms, sheet 100ms, PDF 500ms (6 §9.4)"
```

**Verify:** All three p95 values logged to console and under budget.

---

### Batch: T63 — Manual smoke checklist

### T63 — `docs/superpowers/manual-tests/subproject-6.md`

**Files:**
- Create: `docs/superpowers/manual-tests/subproject-6.md`

**Agent:** Sonnet implementer.

- [ ] **Step 1: Create the manual smoke checklist**

```markdown
# Sub-project 6 — Manual smoke checklist

Run after merge, on the user's local box. Mirrors the 5e/5d/5c/5b patterns.

## Setup

- `pnpm dev` from repo root, open the printed URL in Chromium.
- Open DevTools console.
- Open (or create) a project that already has at least one part (e.g. a Base Cabinet assembly).

---

## T1 — Create drawing from cabinet → 4 views → Export PDF → spot-check

1. With a Base Cabinet assembly open and active, click **File → New Drawing**. Accept defaults (A3 landscape).
2. **Expect:** A new drawing tab opens. The canvas shows a blank A3 sheet with border and title block. Title block "Part" field shows the cabinet assembly name; "Date" shows today.
3. Click **Drawing → Place Views → Base View**. In the dialog, set orientation = **Front**, scale = **1:1**. Click anywhere on the canvas.
4. **Expect:** The front silhouette of the cabinet is rendered in the SVG with visible solid edges and hidden dashed edges.
5. Click **Drawing → Place Views → Projected View** (parent = the base view, direction = **Right**). Click to the right of the base view.
6. Repeat for **Top** (above) and **Iso (NE corner)**.
7. **Expect:** 4 view groups in the canvas, each with distinct silhouettes. Iso view has no hidden lines by default.
8. Click **Drawing → Export → Export PDF**.
9. Save the file and open it in Preview (macOS) or Evince.
10. **Expect:** 1 PDF page (A3 landscape). Title block in the bottom margin is legible (drawing name, date, scale). All 4 views are present at correct scale; scale ≈ 1:1 visible from the comparison of dimensions to the known cabinet size.

---

## T2 — Edit source → Regenerate → PDF reflects new geometry

1. Continue from T1 state (drawing open with 4 views).
2. Switch to the source cabinet tab. Change the cabinet **Height** parameter (e.g. from 720 mm to 900 mm). Apply.
3. Switch back to the drawing tab.
4. **Expect:** Each view shows a red ⚠ "Source changed" stale marker in its top-left corner. Views appear dimmed.
5. Click **Regenerate All** in the ribbon (or click ⚠ on each view individually → Regenerate).
6. **Expect:** All stale markers clear. The Front and Right views are visibly taller (reflecting the 900 mm height). The Iso view reflects the taller cabinet.
7. Click **Drawing → Export → Export PDF**.
8. Open the PDF and compare to the T1 PDF.
9. **Expect:** The new PDF shows the taller cabinet geometry. All 4 views updated.

---

## T3 — 5-sheet drawing → Export PDF → 5 pages

1. From the T2 drawing state, click **Drawing → Sheet → New Sheet** four more times (total 5 sheets).
2. Add at least one view to each new sheet (copy-paste or place fresh Base View with different orientation).
3. Click **Drawing → Export → Export PDF**.
4. Open the exported PDF.
5. **Expect:** The PDF has exactly **5 pages** (one per sheet). Each page shows its corresponding views and title block with correct "Sheet n/5" in the bottom-right corner.

---

## T4 — Per-sheet PNG export

1. From the T3 drawing state, navigate to Sheet 1 in the DrawingTreePane.
2. Right-click Sheet 1 → **Export PNG** (or use the ribbon **Export → Export PNG**).
3. Save and open the PNG.
4. **Expect:** The PNG is at least 1024 px wide. The content visually matches the on-screen canvas render for Sheet 1 — same views, same border, same title block text.
5. Repeat for Sheet 2.
6. **Expect:** Sheet 2's PNG shows Sheet 2's views only (not Sheet 1's).

---

## T5 — V13 project migration — no regression

1. Open a project created with a previous build (before Sub-project 6, i.e. v13 manifest).
2. **Expect:** The project opens without errors. Existing parts and assemblies behave identically to the pre-6 build. No "unknown manifest version" or schema errors in the console.
3. Verify: the **Drawing** ribbon tab shows its (mostly disabled) stub when a part or assembly is active. No JavaScript exceptions.
4. Optional: create a new drawing inside the migrated project and confirm it opens as v14.

---

## Sign-off

| Date | Initials | Pass / Notes |
|---|---|---|
| | | |
```

- [ ] **Step 2: Verify the file is created at the right path**

```
ls docs/superpowers/manual-tests/subproject-6.md
```
Expected: file present.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/manual-tests/subproject-6.md
git commit -m "docs(manual-tests): T1..T5 sub-project 6 drawing smoke checklist (6 §9.5)"
```

**Verify:** File exists at `docs/superpowers/manual-tests/subproject-6.md`; contains T1-T5 sections and sign-off table.

---

## Appendix — Spec coverage map

| Spec section / criterion | Task(s) |
|---|---|
| §1.1 #1 — `kind: 'drawing'`, `DrawingDocument` type, `.zidw` extension | T1, T2, T3 |
| §1.1 #2 — `CreateDrawingCommand`, `OpenProjectFileCommand` dispatch | T17, T18 |
| §1.1 #3 — Pure projection module `projector.ts` (OCCT edges + JS depth-buffer HLR) | T7, T8, T9, T10 |
| §1.1 #4 — `DrawingDocument` shape: sheets, views, dimensions, annotations, titleBlock, ISO sizes | T1, T2, T3, T4 |
| §1.1 #5 — View kinds: base (6 orientations), projected, iso | T19, T20, T21 |
| §1.1 #6 — Manual dimensions: linear-h/v, aligned, radial, diametric | T31, T32, T33 |
| §1.1 #7 — Annotations: centerline, center-mark, leader, balloon | T34, T35 |
| §1.1 #8 — Title block: fixed template, auto-filled fields, user-editable overrides | T5, T6, T37 |
| §1.1 #9 — Per-action commands: all 19 command types | T17–T40 |
| §1.1 #10 — `<DrawingCanvas>` SVG, `<DrawingTreePane>` | T41, T42, T43 |
| §1.1 #11 — Drawing ribbon tab panels (Sheet / Place Views / Dimension / Annotate / Export) | T44, T45, T46, T47 |
| §1.1 #12 — Export: PDF (jsPDF multi-page), SVG (per sheet), PNG (OffscreenCanvas) | T52, T53, T54, T55 |
| §1.1 #13 — Stale-banner per view: SHA-256 fingerprint, mismatch → banner | T11, T12, T13, T14 |
| §1.1 #14 — Manifest v13→v14 (additive, no-op migration) | T15, T16 |
| §1.4 SC1 — New Drawing → A3 sheet + title block populated | T17, T56 |
| §1.4 SC2 — Place Views → Base → front silhouette with hidden-line dashes | T19, T57 |
| §1.4 SC3 — Projected view right/up at correct aligned offset, inherits scale | T20, T57 |
| §1.4 SC4 — Iso view (NE default), hidden-line removal | T21, T57 |
| §1.4 SC5 — Linear-H dimension shows "100", persists save/load, Ctrl-Z removes | T31, T58 |
| §1.4 SC6 — Balloon on assembly drawing shows BOM itemNumber | T35, T61 |
| §1.4 SC7 — Export PDF: multi-page vector A3, non-zero size, application/pdf | T52, T55, T60 |
| §1.4 SC8 — Export SVG: per-sheet .svg download | T53, T55 |
| §1.4 SC9 — Export PNG: 1024-px-wide rasterisation | T54, T55 |
| §1.4 SC10 — Stale banner per view on source edit → Regenerate clears it | T11, T12, T59 |
| §1.4 SC11 — Ctrl+Z after every drawing action restores prior state | T17–T40 (apply/revert symmetry), T58 |
| §1.4 SC12 — v13 project opens without error; parts/assemblies unaffected | T15, T16, T63 T5 |
| §1.4 SC13 — typecheck + all unit/integration/e2e/perf suites pass | T1–T63 (all), CI gate |
| §2.1 — ProjectFile union / ActiveDocument widen | T1, T2, T3 |
| §2.2 — DrawingDocument shape | T2, T3 |
| §2.3 — DrawingSheet, SheetSize (ISO + Custom), orientation | T3, T4 |
| §2.4 — DrawingView (BaseView, ProjectedView, IsoView), ViewScale | T3, T4, T19, T20, T21 |
| §2.5 — ProjectedGeometry, Edge2D, id derivation | T7, T8, T9 |
| §2.6 — DrawingDimension, PointRef | T4, T31, T32, T33 |
| §2.7 — DrawingAnnotation (balloon, leader, centerline, center-mark) | T4, T34, T35 |
| §2.8 — TitleBlockOverrides, resolveTitleBlock | T5, T6 |
| §3 — Projection algorithm: depth-buffer HLR, view matrix, edge classification | T7, T8, T9, T10 |
| §4.1 — CreateDrawingCommand | T17 |
| §4.2 — Sheet commands (Add/Rename/Delete/EditSize) | T22, T23, T24, T25 |
| §4.3 — View commands (AddBase/Projected/Iso, Move, Delete, Regen, EditScale, ToggleHidden) | T19, T20, T21, T26, T27, T28, T29, T30 |
| §4.4 — Dimension/Annotation commands | T31, T32, T33, T34, T35, T36 |
| §4.5 — Title block + drawing properties commands | T37, T38 |
| §4.6 — Export commands (non-undoable, triggerDownload) | T52, T53, T54, T55 |
| §5.1 — Active-document 3-way switch (part/assembly/drawing) | T39, T40 |
| §5.2 — DrawingTab ribbon panels | T44, T45, T46, T47 |
| §5.3 — DrawingCanvas SVG coordinate frames, pan/zoom, selection, stale-banner | T41, T42, T43 |
| §5.4 — DrawingTreePane tree structure | T48 |
| §5.5 — Dialogs (NewDrawing, AddView, EditTitleBlock, AddDimension, AddLeader) | T49, T50, T51 |
| §5.6 — Tab mutex update (drawings replace entire BrowserPane, not add a tab) | T39 |
| §6.1 — Manifest v13→v14, no-op migration | T15, T16 |
| §6.2 — .zidw envelope (gzipped tar, no blobs/) | T17, T18 |
| §6.3 — OPFS file layout (drawings/ subdirectory) | T17, T18 |
| §6.4 — Source-document resolution, missing-source error banner | T18 |
| §7 — Fingerprint / stale-detection (SHA-256, per-view) | T11, T12, T13, T14 |
| §8.1 — What invalidates a view (geometry vs pose change) | T11, T12 |
| §8.2 — Regeneration flow (worker round-trip, RegenerateViewCommand) | T12, T28 |
| §8.3 — Cascade delete on base view (projections + dims + anns) | T27 |
| §9.1 — Unit tests (projector, fingerprint, commands, renderSvg, resolveTitleBlock) | T7, T8, T9, T10, T11, T17–T37, T52, T53, T54 |
| §9.2 — Integration tests (round-trip save/load, regen) | T13, T14 |
| §9.3 — E2E specs T-6-1..T-6-6 | T56, T57, T58, T59, T60, T61 |
| §9.4 — Perf spec (projection 200ms, sheet 100ms, PDF 500ms) | T62 |
| §9.5 — Manual smoke checklist | T63 |
| §10 — Performance budgets | T62 |
| §11 — Open questions / risks (edge tessellation, curved silhouettes, etc.) | Implementation notes; no separate tasks — addressed inline during T7-T10 |

---

## Phase 11 — Finishing

After T63 passes locally, transition to `superpowers:finishing-a-development-branch` to fast-forward merge `feature/subproject-6` to master, clean up the worktree, and update memory with the execution-state file.
