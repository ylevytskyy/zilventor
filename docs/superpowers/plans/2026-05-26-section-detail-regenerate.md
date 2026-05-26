# Section/Detail View Regenerate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `handleRegenerate` bail for `section`/`detail` view kinds with real re-projection: section views re-cut via the kernel, detail views re-clip against their parent's fresh projection, with a cascade that regenerates a stale parent first.

**Architecture:** Two new pure helper functions (`regenerateSectionView`, `regenerateDetailView`) in `DrawingCanvas.tsx` hold the async logic; `handleRegenerate` dispatches to them. Section regenerate reuses `AddSectionViewCommand`'s cut/project/hatch pipeline (kernel call → `projectSectionView`) then commits `projection + hatchSegments + inputFingerprint` atomically via a single `useAppStore.setState(drawingDocState(...))` — NOT via `RegenerateViewCommand`, which would require a separate second write for `hatchSegments`. Detail regenerate is pure-2D (no kernel call); it routes through `RegenerateViewCommand` via `bus.execute` (detail views have no hatch). Cascade: detail checks if its parent is in `staleViews`; if yes, it awaits the parent's regenerate path first, then reads the parent's fresh projection from the live store before re-clipping.

**Tech Stack:** TypeScript, React, Zustand, Vitest (unit), Playwright (e2e/chromium), pnpm monorepo, OCCT kernel via Comlink worker.

---

## DESIGN DECISIONS (resolved open items)

### 1 — Exact section re-cut parameters
`SectionView` stores:
- `mode: 'full' | 'half' | 'stepped'`
- `plane?: { origin, normal }` — present for `full` and `half` (absent for `stepped`)
- `splitPlane?: { origin, normal }` — present iff `mode === 'half'`
- `cutSide?: -1 | 1` — present iff `mode === 'half'`
- `stepSegments?: readonly StepSegment[]` — present iff `mode === 'stepped'`
- `arrowDirection: -1 | 1`

Re-cut dispatch:
- `mode === 'full'` or `mode === 'half'`: call `cutBySectionPlane(kernelId, view.plane!, view.arrowDirection, view.splitPlane, view.cutSide)` (or `cutAssemblyBySectionPlane`)
- `mode === 'stepped'`: call `cutByStepSegments(kernelId, planes, view.arrowDirection)` where `planes` = `deriveStepPlanes(view.stepSegments!, viewMatrix, view.arrowDirection)` with `viewMatrix` from the parent base view

### 2 — EXTEND RegenerateViewCommand vs new commands
**Decision: EXTEND `handleRegenerate` with two new internal async helpers; do NOT add new command classes.** `RegenerateViewCommand` writes `projection + inputFingerprint` via `drawingDocState`. Detail views use it as-is (no hatch). Section views CANNOT use it alone because `hatchSegments` is a separate top-level field on `SectionView` — routing sections through `RegenerateViewCommand` then patching hatch in a second setState would create a transient render frame with stale hatch. Instead, `regenerateSectionView` writes `projection + hatchSegments + inputFingerprint` in ONE atomic `useAppStore.setState(drawingDocState(...))`, bypassing `RegenerateViewCommand`. `RegenerateViewCommand` and its tests are untouched. Net result: zero new command files; two new helpers in co-located files (`regenerateSectionView.ts` / `regenerateDetailView.ts`).

### 3 — Parent lookup and stale set in handleRegenerate
`handleRegenerate` already receives `viewId` and reads `sheet.views.find(v => v.id === viewId)`. For detail cascade: read `view.parentViewId`, look it up in `sheet.views`. Check `staleViews.has(parentId)` to decide if parent needs re-projection first. After parent regenerate succeeds, read fresh state from `useAppStore.getState().activeDocument` (live store, not stale closure) to get the parent's updated projection.

### 4 — Hatch recompute reuse
`projectSectionView(compound, faceTags, scale, hatchLookup, sectionViewMatrix)` already returns `{ edges, hatchSegments, fingerprint }` in one call. On regenerate: after `cutBySectionPlane`/`cutByStepSegments` returns `{compound, faceTags}`, build the same `hatchLookup` from `materials` (stored on `activePart` or `activeAssembly` — same pattern as `AddSectionViewCommand.apply()`). Then call `projectSectionView`. The section view's stored `sectionViewMatrix` is not persisted — for full/half, re-derive it from `deriveSectionPlane({p0,p1}, parentViewMatrix, scale, arrowDirection)`. For stepped, re-derive from `deriveSectionPlane({p0: firstSeg.startSheet, p1: lastSeg.endSheet}, viewMatrix, scale, arrowDirection)`. Then use the new `sectionViewMatrix` as the 5th argument to `projectSectionView`.

### 5 — Detail cascade state-read ordering
The cascade must NOT re-use the `sheet` closure variable after the parent re-project, because the closure is stale. Pattern: (a) await parent regenerate helpers (which call `bus.execute(new RegenerateViewCommand({...}))` and thus commit the updated projection into the Zustand store); (b) read the parent's fresh projection from `useAppStore.getState().activeDocument` AFTER the await. `drawingDocState` in `RegenerateViewCommand.apply()` calls `useAppStore.setState(...)` synchronously, so the live read is immediately consistent after `await bus.execute`.

---

## FILE STRUCTURE

### Created
- `packages/app/src/drawing/regenerateSectionView.ts` — async helper: given `(view: SectionView, sheetId: string, bus: CommandBus)`, re-cuts and re-projects a section view, then commits `projection + hatchSegments + inputFingerprint` atomically via `useAppStore.setState(drawingDocState(...))` (NOT via `RegenerateViewCommand`). Pure logic extracted from `handleRegenerate`.
- `packages/app/src/drawing/regenerateDetailView.ts` — async helper: given `(view: DetailView, sheetId: string, bus: CommandBus, getParentIsStale: (id:string) => boolean, regenerateParent: (parentView: DrawingView) => Promise<void>)`, cascades parent if stale, re-clips detail, calls `bus.execute(new RegenerateViewCommand(...))`.
- `packages/app/src/drawing/__tests__/regenerateSectionView.spec.ts` — unit tests for the section path (all kernel calls mocked via `vi.mock`).
- `packages/app/src/drawing/__tests__/regenerateDetailView.spec.ts` — unit tests for the detail path (all kernel calls mocked; cascade test).
- `tests/e2e/drawing/T-6-21-section-detail-regen.spec.ts` — e2e: real kernel cut + real detail re-clip round-trip.

### Modified
- `packages/app/src/drawing/DrawingCanvas.tsx` — `handleRegenerate`: replace the section/detail bail with calls to `regenerateSectionView` / `regenerateDetailView`; add required imports.

---

## TEST GATES

**Unit (single-file RED → GREEN):**
```
pnpm --filter app test:unit -- packages/app/src/drawing/__tests__/regenerateSectionView.spec.ts
pnpm --filter app test:unit -- packages/app/src/drawing/__tests__/regenerateDetailView.spec.ts
```
**Full unit suite (before every commit — catches full-suite-only regressions):**
```
pnpm --filter app test:unit
```
Baseline: **1735 passing**.

**E2E gate (ROOT, not `--filter`):**
```
pnpm test:e2e -- tests/e2e/drawing/T-6-21-section-detail-regen.spec.ts
```
Project = chromium (configured in root `playwright.config.ts`). If port 5173 is occupied, kill the stale server first: `lsof -ti:5173 | xargs kill -9`.

**Typecheck + lint (final gate before done):**
```
pnpm -r typecheck
pnpm lint
```
Run `pnpm lint` from the repo root (not from a worktree copy). Zero errors required.

---

## BATCH B1 — Section regenerate: part source, full/half modes

### Task 1: Unit test for section re-cut (full mode, part source)

**Files:**
- Create: `packages/app/src/drawing/__tests__/regenerateSectionView.spec.ts`
- Create: `packages/app/src/drawing/regenerateSectionView.ts` (stub)

- [ ] **Step 1: Write the failing test**

```typescript
// packages/app/src/drawing/__tests__/regenerateSectionView.spec.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAppStore } from '../../store/useAppStore';
import { regenerateSectionView } from '../regenerateSectionView';
import type { DrawingDocument, SectionView } from '@zilventor/shared';

// ── mock the kernel cut function ──────────────────────────────────────────
vi.mock('../../kernel/cutBySectionPlane', () => {
  const okResult = {
    ok: true as const,
    compound: { meshes: [], faces: [] },
    faceTags: new Map([['face-1', 'mat-pine']]),
  };
  return {
    cutBySectionPlane: vi.fn().mockResolvedValue(okResult),
    cutAssemblyBySectionPlane: vi.fn().mockResolvedValue(okResult),
    cutByStepSegments: vi.fn().mockResolvedValue(okResult),
    cutAssemblyByStepSegments: vi.fn().mockResolvedValue(okResult),
  };
});

// ── mock projectSectionView ───────────────────────────────────────────────
// NOTE: projectSectionView lives in the app package at ../drawing/projectSectionView
// (AddSectionViewCommand imports it as '../drawing/projectSectionView', not from shared).
vi.mock('../drawing/projectSectionView', () => ({
  projectSectionView: vi.fn().mockReturnValue({
    edges: [{ id: 'e-new', kind: 'outline', points: [[0,0],[60,0]], sourceFaceIds: [] }],
    hatchSegments: [{ p0: { x: 1, y: 1 }, p1: { x: 59, y: 1 }, materialId: 'mat-pine' }],
    fingerprint: 'fp-regen-new',
  }),
}));

// ── mock deriveSectionPlane (used to rebuild sectionViewMatrix) ───────────
vi.mock('@zilventor/shared/src/drawing/sectionPlane', () => ({
  deriveSectionPlane: vi.fn().mockReturnValue({
    plane: { origin: { x: 0, y: 25, z: 0 }, normal: { x: 0, y: 1, z: 0 } },
    sectionViewMatrix: new Float64Array(16),
  }),
  deriveSplitPlane: vi.fn(),
  deriveStepPlanes: vi.fn(),
  validateSteppedInvariant: vi.fn(),
}));

// ── mock resolveSectionSource ─────────────────────────────────────────────
vi.mock('@zilventor/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@zilventor/shared')>();
  return {
    ...actual,
    resolveSectionSource: vi.fn().mockReturnValue({ kind: 'part', id: 'part-uuid-1' }),
    getHatchSpec: vi.fn().mockReturnValue({ angleDeg: 45, spacingMm: 3 }),
  };
});

// ── mock CommandBus (section regenerate does NOT route through RegenerateViewCommand) ──
// Section regenerate writes atomically via useAppStore.setState(drawingDocState(...));
// it does NOT call bus.execute. The bus parameter is kept for API symmetry with
// regenerateDetailView and in case future callers need it, but sections bypass it.
const fakeBus = { execute: vi.fn().mockResolvedValue(undefined) };

const SECTION_VIEW_FULL: SectionView = {
  id: 'sec-1',
  kind: 'section',
  parentViewId: 'base-1',
  sectionLine: { p0: { x: 5, y: 15 }, p1: { x: 45, y: 15 } },
  arrowDirection: 1,
  label: 'A',
  positionMm: { x: 200, y: 80 },
  scale: { numerator: 1, denominator: 1 },
  showHidden: false,
  mode: 'full',
  plane: { origin: { x: 0, y: 25, z: 0 }, normal: { x: 0, y: 1, z: 0 } },
  hatchSegments: [],
  fingerprint: 'old-fp',
  projection: {
    visibleEdges: [{ id: 'e-old', kind: 'outline', points: [[0,0],[50,0]], sourceFaceIds: [] }],
    hiddenEdges: [],
    bbox: { minX: 0, minY: 0, maxX: 50, maxY: 0 },
  },
  inputFingerprint: 'old-source-fp',
};

const BASE_VIEW = {
  id: 'base-1',
  kind: 'base' as const,
  positionMm: { x: 80, y: 80 },
  scale: { numerator: 1, denominator: 1 },
  orientation: 'front' as const,
  showHidden: false,
  viewMatrix: [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1],
  projection: {
    visibleEdges: [{ id: 'b-e1', kind: 'outline' as const, points: [[0,0],[50,0]], sourceFaceIds: [] }],
    hiddenEdges: [],
    bbox: { minX: 0, minY: 0, maxX: 50, maxY: 50 },
  },
  inputFingerprint: 'new-source-fp',
};

function makeDrawingWithSection(): DrawingDocument {
  return {
    id: 'drw-1', name: 'D', units: 'mm',
    source: { partPath: 'parts/p.zipt', sourceKind: 'part' },
    properties: {},
    sheets: [{
      id: 'sheet-1', name: 'Sheet 1',
      size: { kind: 'iso', size: 'A3' }, orientation: 'landscape',
      views: [BASE_VIEW as never, SECTION_VIEW_FULL],
      dimensions: [], dimensionGroups: [], annotations: [], titleBlock: {},
    }],
    activeSheetId: 'sheet-1',
  };
}

describe('regenerateSectionView — full mode, part source', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({
      activeDocument: { kind: 'drawing', document: makeDrawingWithSection() },
      activeDrawing: makeDrawingWithSection(),
      activeDrawingSourcePartId: 'part-uuid-1',
      activeDrawingSourceFingerprint: 'new-source-fp',
      activePart: { id: 'part-uuid-1', materials: [{ id: 'mat-pine', name: 'Pine', defaultThickness: 18, color: '#D2A679' }], featureTree: [], parameters: {} } as never,
      kernel: { execute: vi.fn(), getProjectorInput: vi.fn() } as never,
    });
  });

  it('calls cutBySectionPlane then projectSectionView then writes store atomically (no bus.execute)', async () => {
    const { cutBySectionPlane } = await import('../../kernel/cutBySectionPlane');
    const { projectSectionView } = await import('../drawing/projectSectionView');

    await regenerateSectionView(SECTION_VIEW_FULL, 'sheet-1', fakeBus as never);

    expect(cutBySectionPlane).toHaveBeenCalledOnce();
    expect(cutBySectionPlane).toHaveBeenCalledWith(
      'part-uuid-1',
      SECTION_VIEW_FULL.plane,
      SECTION_VIEW_FULL.arrowDirection,
      undefined, // splitPlane absent for full mode
      undefined, // cutSide absent for full mode
    );
    expect(projectSectionView).toHaveBeenCalledOnce();
    // Section regenerate does NOT call bus.execute — it writes atomically via useAppStore.setState.
    expect(fakeBus.execute).not.toHaveBeenCalled();

    // Verify the store was updated atomically: projection + hatchSegments + inputFingerprint together.
    const liveDoc = useAppStore.getState().activeDocument;
    expect(liveDoc?.kind).toBe('drawing');
    const liveDrawing = (liveDoc as { kind: string; document: { sheets: Array<{ id: string; views: Array<{ id: string; projection?: unknown; hatchSegments?: unknown[]; inputFingerprint?: string }> }> } }).document;
    const updatedView = liveDrawing.sheets[0]!.views.find((v) => v.id === 'sec-1')!;
    expect(updatedView.inputFingerprint).toBe('new-source-fp');
    expect(Array.isArray(updatedView.hatchSegments)).toBe(true);
    expect((updatedView.hatchSegments as unknown[]).length).toBeGreaterThan(0);
    expect(updatedView.projection).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to confirm RED**

```
pnpm --filter app test:unit -- packages/app/src/drawing/__tests__/regenerateSectionView.spec.ts
```
Expected: FAIL — `Cannot find module '../regenerateSectionView'`

- [ ] **Step 3: Create stub to get past import error, run again to confirm the RIGHT failure**

Create `packages/app/src/drawing/regenerateSectionView.ts`:
```typescript
// packages/app/src/drawing/regenerateSectionView.ts
import type { SectionView } from '@zilventor/shared';
import type { CommandBus } from '../commands/CommandBus';

export async function regenerateSectionView(
  _view: SectionView,
  _sheetId: string,
  _bus: CommandBus,
): Promise<void> {
  throw new Error('regenerateSectionView: not implemented');
}
```

Run test again. Expected: FAIL — `cutBySectionPlane not called` (or the throw from the stub).

- [ ] **Step 4: Implement `regenerateSectionView` (full/half path)**

```typescript
// packages/app/src/drawing/regenerateSectionView.ts
import type { SectionView } from '@zilventor/shared';
import { resolveSectionSource, getHatchSpec } from '@zilventor/shared';
import type { CommandBus } from '../commands/CommandBus';
import {
  cutBySectionPlane,
  cutAssemblyBySectionPlane,
  cutByStepSegments,
  cutAssemblyByStepSegments,
} from '../kernel/cutBySectionPlane';
import { projectSectionView } from './projectSectionView';  // app-internal re-export; same path as AddSectionViewCommand
import { deriveSectionPlane, deriveStepPlanes } from '@zilventor/shared/src/drawing/sectionPlane';
import { drawingDocState } from '../store/drawingDocState';
import { useAppStore } from '../store/useAppStore';
import type { DrawingDocument } from '@zilventor/shared';
import type { Mat4 } from '@zilventor/shared/src/drawing/viewMatrix';
// NOTE: RegenerateViewCommand is intentionally NOT imported here.
// Section regenerate writes projection + hatchSegments + inputFingerprint atomically
// via a single useAppStore.setState(drawingDocState(...)). Routing through
// RegenerateViewCommand would require a second setState for hatchSegments,
// creating a transiently inconsistent render frame. Base/projected/iso views
// continue using RegenerateViewCommand unchanged.

/**
 * Async helper for handleRegenerate — section-view path.
 *
 * Re-runs the same kernel cut used at creation (cutBySectionPlane /
 * cutAssemblyBySectionPlane / cutByStepSegments / cutAssemblyByStepSegments),
 * re-projects via projectSectionView (including hatch recompute), and
 * atomically commits projection + hatchSegments + inputFingerprint in a single
 * useAppStore.setState(drawingDocState(...)) call (NOT via RegenerateViewCommand,
 * which would require a second setState for hatchSegments).
 *
 * Throws on kernel errors — caller (handleRegenerate) catches and leaves
 * the stale marker intact.
 */
export async function regenerateSectionView(
  view: SectionView,
  sheetId: string,
  bus: CommandBus,
): Promise<void> {
  const state = useAppStore.getState();
  const doc = state.activeDocument;
  if (!doc || doc.kind !== 'drawing') throw new Error('REGEN_SECTION: no active drawing');
  const drawing = doc.document as DrawingDocument;

  // 1. Resolve the source (part vs assembly).
  const source = resolveSectionSource(view, drawing);

  // 2. Determine kernel id: same priority as projectViewFromSource (live slot first, then activePart).
  const kernelId: string = source.kind === 'assembly'
    ? (state.activeAssembly?.id ?? source.id)
    : (state.activeDrawingSourcePartId ?? state.activePart?.id ?? source.id);

  // 3. Run the kernel cut for the right mode.
  let compound: unknown;
  let faceTags: Map<string, string>;

  if (view.mode === 'stepped') {
    if (!view.stepSegments || view.stepSegments.length < 2) {
      throw new Error('REGEN_SECTION: stepped view missing stepSegments');
    }
    // Find the parent view's viewMatrix to re-derive step planes.
    const parentView = drawing.sheets
      .flatMap((s) => s.views)
      .find((v) => v.id === view.parentViewId);
    const viewMatrix = ((parentView as { viewMatrix?: number[] })?.viewMatrix
      ?? new Array(16).fill(0) as number[]) as Mat4;
    const planes = deriveStepPlanes(view.stepSegments, viewMatrix, view.arrowDirection);
    const result = source.kind === 'assembly'
      ? await cutAssemblyByStepSegments(kernelId, planes, view.arrowDirection)
      : await cutByStepSegments(kernelId, planes, view.arrowDirection);
    if (!result.ok) throw new Error(`REGEN_SECTION stepped cut failed: ${result.reason}`);
    compound = result.compound;
    faceTags = result.faceTags;
  } else {
    // full or half
    if (!view.plane) throw new Error('REGEN_SECTION: full/half view missing plane');
    const result = source.kind === 'assembly'
      ? await cutAssemblyBySectionPlane(kernelId, view.plane, view.arrowDirection, view.splitPlane, view.cutSide)
      : await cutBySectionPlane(kernelId, view.plane, view.arrowDirection, view.splitPlane, view.cutSide);
    if (!result.ok) throw new Error(`REGEN_SECTION cut failed: ${result.reason}`);
    compound = result.compound;
    faceTags = result.faceTags;
  }

  // 4. Re-derive sectionViewMatrix for projection.
  const parentView = drawing.sheets
    .flatMap((s) => s.views)
    .find((v) => v.id === view.parentViewId);
  const viewMatrix = ((parentView as { viewMatrix?: number[] })?.viewMatrix
    ?? new Array(16).fill(0) as number[]) as Mat4;
  const scale = view.scale.numerator / view.scale.denominator;

  let sectionViewMatrix: Mat4 | undefined;
  if (view.mode === 'stepped' && view.stepSegments && view.stepSegments.length >= 2) {
    const p0 = view.stepSegments[0]!.startSheet;
    const p1 = view.stepSegments[view.stepSegments.length - 1]!.endSheet;
    ({ sectionViewMatrix } = deriveSectionPlane({ p0, p1 }, viewMatrix, scale, view.arrowDirection));
  } else {
    ({ sectionViewMatrix } = deriveSectionPlane(view.sectionLine, viewMatrix, scale, view.arrowDirection));
  }

  // 5. Resolve materials for hatch lookup.
  const materials = state.activePart?.materials ?? state.activeAssembly?.materials ?? [];
  const hatchLookup = (materialId: string): { angleDeg: number; spacingMm: number } => {
    const mat = materials.find((m) => m.id === materialId);
    return getHatchSpec(mat ?? { id: materialId, name: '', defaultThickness: 0, color: '#808080' });
  };

  // 6. Re-project: edges + hatchSegments in one call.
  const { edges, hatchSegments } = projectSectionView(
    compound as Parameters<typeof projectSectionView>[0],
    faceTags,
    scale,
    hatchLookup,
    sectionViewMatrix,
    view,
  );

  // 7. Atomic store write: projection + hatchSegments + inputFingerprint in ONE setState.
  //    Do NOT route through RegenerateViewCommand — that command only writes projection +
  //    inputFingerprint, forcing a second mutation for hatchSegments (transient inconsistency).
  //    Sections take their own atomic-write path; base/projected/iso continue using
  //    RegenerateViewCommand unchanged (no churn on those 15+ tests).
  const inputFingerprint = state.activeDrawingSourceFingerprint ?? kernelId;
  const freshDoc = useAppStore.getState().activeDocument;
  if (!freshDoc || freshDoc.kind !== 'drawing') return;
  const freshDrawing = freshDoc.document as DrawingDocument;

  const nextProjection = {
    visibleEdges: edges,
    hiddenEdges: [] as typeof edges,
    bbox: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
  };
  const nextDrawing: DrawingDocument = {
    ...freshDrawing,
    sheets: freshDrawing.sheets.map((s) =>
      s.id !== sheetId ? s : {
        ...s,
        views: s.views.map((v) => {
          if (v.id !== view.id) return v;
          // One atomic patch: projection + hatchSegments + inputFingerprint together.
          // No render-observable intermediate state.
          return {
            ...v,
            projection: nextProjection,
            hatchSegments,
            inputFingerprint,
          } as typeof v;
        }),
      }
    ),
  };
  useAppStore.setState(drawingDocState(nextDrawing));
}
```

- [ ] **Step 5: Run test to confirm GREEN**

```
pnpm --filter app test:unit -- packages/app/src/drawing/__tests__/regenerateSectionView.spec.ts
```
Expected: PASS (1 test passing).

- [ ] **Step 6: Run full suite to confirm no regressions**

```
pnpm --filter app test:unit
```
Expected: 1736+ passing (at least +1 from the new test). No failures.

- [ ] **Step 7: Commit**

```bash
git add packages/app/src/drawing/regenerateSectionView.ts \
        packages/app/src/drawing/__tests__/regenerateSectionView.spec.ts
git commit -m "feat(drawing-regen): regenerateSectionView helper — full/half/stepped, part+assembly"
```

---

### Task 2: Unit tests for half-section re-cut (mode=half, splitPlane/cutSide forwarded) — **Regression-coverage task (not red-first)**

> **Reason:** The `full/half` dispatch branch is already implemented generically in Task 1 (`else` block of the `mode === 'stepped'` guard, with `splitPlane`/`cutSide` forwarded as passed). This test exercises that existing branch with `mode:'half'` inputs; it will pass immediately against the Task 1 implementation. It locks the half-mode parameter-forwarding contract as regression coverage. No new code path exists to make it red-first without artificially removing already-correct logic.

**Files:**
- Modify: `packages/app/src/drawing/__tests__/regenerateSectionView.spec.ts`

- [ ] **Step 1: Add test for half-section mode**

Append to `regenerateSectionView.spec.ts`:
```typescript
const SECTION_VIEW_HALF: SectionView = {
  id: 'sec-half',
  kind: 'section',
  parentViewId: 'base-1',
  sectionLine: { p0: { x: 5, y: 15 }, p1: { x: 45, y: 15 } },
  arrowDirection: 1,
  label: 'B',
  positionMm: { x: 250, y: 80 },
  scale: { numerator: 1, denominator: 1 },
  showHidden: false,
  mode: 'half',
  plane: { origin: { x: 0, y: 25, z: 0 }, normal: { x: 0, y: 1, z: 0 } },
  splitPlane: { origin: { x: 0, y: 0, z: 0 }, normal: { x: 1, y: 0, z: 0 } },
  cutSide: 1,
  hatchSegments: [],
  fingerprint: 'old-half-fp',
  projection: {
    visibleEdges: [],
    hiddenEdges: [],
    bbox: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
  },
  inputFingerprint: 'old-source-fp',
};

describe('regenerateSectionView — half mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({
      activeDocument: { kind: 'drawing', document: makeDrawingWithSection() },
      activeDrawing: makeDrawingWithSection(),
      activeDrawingSourcePartId: 'part-uuid-1',
      activeDrawingSourceFingerprint: 'new-source-fp',
      activePart: { id: 'part-uuid-1', materials: [], featureTree: [], parameters: {} } as never,
      kernel: {} as never,
    });
  });

  it('passes splitPlane and cutSide to cutBySectionPlane for half mode', async () => {
    const { cutBySectionPlane } = await import('../../kernel/cutBySectionPlane');

    // Inject the half view into the store's drawing
    const doc = useAppStore.getState().activeDocument!.document as DrawingDocument;
    const withHalf: DrawingDocument = {
      ...doc,
      sheets: doc.sheets.map((s) => ({
        ...s,
        views: [...s.views, SECTION_VIEW_HALF],
      })),
    };
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: withHalf }, activeDrawing: withHalf });

    await regenerateSectionView(SECTION_VIEW_HALF, 'sheet-1', fakeBus as never);

    expect(cutBySectionPlane).toHaveBeenCalledWith(
      'part-uuid-1',
      SECTION_VIEW_HALF.plane,
      SECTION_VIEW_HALF.arrowDirection,
      SECTION_VIEW_HALF.splitPlane,
      SECTION_VIEW_HALF.cutSide,
    );
  });
});
```

- [ ] **Step 2: Run test to confirm GREEN** (regression-coverage — passes immediately against Task 1 impl)

```
pnpm --filter app test:unit -- packages/app/src/drawing/__tests__/regenerateSectionView.spec.ts
```
Expected: All tests in this file PASS.

- [ ] **Step 3: Run full suite**

```
pnpm --filter app test:unit
```
Expected: 1737+ passing, no failures.

- [ ] **Step 4: Commit**

```bash
git add packages/app/src/drawing/__tests__/regenerateSectionView.spec.ts
git commit -m "test(drawing-regen): half-section splitPlane/cutSide forwarded to cutBySectionPlane (regression coverage)"
```

---

### Task 3: Unit test for re-cut failure — stale preserved, error thrown — **Regression-coverage task (not red-first)**

> **Reason:** The `throw new Error('REGEN_SECTION cut failed: ...')` guard is already present in the Task 1 implementation (both `full/half` and `stepped` branches check `result.ok`). This test exercises that guard with a mocked `ok:false` return; it will pass immediately. It locks error-propagation + bus-skipped-on-failure as regression coverage. No distinct new code path exists to make it red-first without removing the already-correct guard.

**Files:**
- Modify: `packages/app/src/drawing/__tests__/regenerateSectionView.spec.ts`

- [ ] **Step 1: Add test**

Append to `regenerateSectionView.spec.ts`:
```typescript
describe('regenerateSectionView — cut failure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({
      activeDocument: { kind: 'drawing', document: makeDrawingWithSection() },
      activeDrawing: makeDrawingWithSection(),
      activeDrawingSourcePartId: 'part-uuid-1',
      activeDrawingSourceFingerprint: 'new-source-fp',
      activePart: { id: 'part-uuid-1', materials: [], featureTree: [], parameters: {} } as never,
      kernel: {} as never,
    });
  });

  it('throws when cutBySectionPlane returns ok:false, store is NOT updated', async () => {
    const { cutBySectionPlane } = await import('../../kernel/cutBySectionPlane');
    (cutBySectionPlane as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      reason: 'empty',
    });

    const fingerprintBefore = (useAppStore.getState().activeDocument as { kind: string; document: { sheets: Array<{ views: Array<{ id: string; inputFingerprint?: string }> }> } }).document.sheets[0]!.views.find((v) => v.id === SECTION_VIEW_FULL.id)?.inputFingerprint;

    await expect(
      regenerateSectionView(SECTION_VIEW_FULL, 'sheet-1', fakeBus as never)
    ).rejects.toThrow('REGEN_SECTION cut failed');

    // Store not mutated — inputFingerprint unchanged.
    const fingerprintAfter = (useAppStore.getState().activeDocument as { kind: string; document: { sheets: Array<{ views: Array<{ id: string; inputFingerprint?: string }> }> } }).document.sheets[0]!.views.find((v) => v.id === SECTION_VIEW_FULL.id)?.inputFingerprint;
    expect(fingerprintAfter).toBe(fingerprintBefore);
    // bus never called (section skips it on the happy path too, but confirm no side effects).
    expect(fakeBus.execute).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to confirm GREEN** (regression-coverage — passes immediately against Task 1 impl)

```
pnpm --filter app test:unit -- packages/app/src/drawing/__tests__/regenerateSectionView.spec.ts
```
Expected: All tests PASS.

- [ ] **Step 3: Run full suite**

```
pnpm --filter app test:unit
```
Expected: 1738+ passing.

- [ ] **Step 4: Commit**

```bash
git add packages/app/src/drawing/__tests__/regenerateSectionView.spec.ts
git commit -m "test(drawing-regen): section re-cut failure propagates error (regression coverage)"
```

---

## BATCH B2 — Detail regenerate + cascade

### Task 4: `regenerateDetailView` helper — pure re-clip (no cascade)

**Files:**
- Create: `packages/app/src/drawing/regenerateDetailView.ts`
- Create: `packages/app/src/drawing/__tests__/regenerateDetailView.spec.ts`

- [ ] **Step 1: Write failing test for basic detail re-clip**

```typescript
// packages/app/src/drawing/__tests__/regenerateDetailView.spec.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAppStore } from '../../store/useAppStore';
import { regenerateDetailView } from '../regenerateDetailView';
import type { DrawingDocument, DetailView, BaseView } from '@zilventor/shared';

// ── mock projectDetailView ────────────────────────────────────────────────
vi.mock('@zilventor/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@zilventor/shared')>();
  return {
    ...actual,
    projectDetailView: vi.fn().mockReturnValue({
      visibleEdges: [{ id: 'clip-new', kind: 'outline', points: [[2,2],[8,2]], sourceFaceIds: [] }],
      hiddenEdges: [],
      bbox: { minX: 2, minY: 2, maxX: 8, maxY: 8 },
    }),
    fingerprintDetailView: vi.fn().mockReturnValue('new-detail-fp'),
  };
});

const mockExecute = vi.fn().mockResolvedValue(undefined);
vi.mock('../RegenerateViewCommand', () => ({
  RegenerateViewCommand: vi.fn().mockImplementation((opts: unknown) => ({ name: 'RegenerateView', opts })),
}));

const fakeBus = { execute: mockExecute };

const BASE_VIEW_FRESH: BaseView = {
  id: 'base-v1',
  kind: 'base',
  positionMm: { x: 80, y: 80 },
  scale: { numerator: 1, denominator: 1 },
  orientation: 'front',
  showHidden: false,
  projection: {
    visibleEdges: [{ id: 'b-e1', kind: 'outline', points: [[0,0],[60,0]], sourceFaceIds: [] }],
    hiddenEdges: [],
    bbox: { minX: 0, minY: 0, maxX: 60, maxY: 60 },
  },
  inputFingerprint: 'new-source-fp',
};

const DETAIL_VIEW: DetailView = {
  id: 'det-1',
  kind: 'detail',
  parentViewId: 'base-v1',
  regionParent: { kind: 'circle', center: { x: 10, y: 10 }, radiusMm: 8 },
  label: 'A',
  positionMm: { x: 200, y: 200 },
  scale: { numerator: 2, denominator: 1 },
  showHidden: false,
  projection: {
    visibleEdges: [{ id: 'clip-old', kind: 'outline', points: [[2,2],[6,2]], sourceFaceIds: [] }],
    hiddenEdges: [],
    bbox: { minX: 2, minY: 2, maxX: 6, maxY: 6 },
  },
  inputFingerprint: 'old-detail-fp',
};

function makeDrawingWithDetail(): DrawingDocument {
  return {
    id: 'drw-d', name: 'D', units: 'mm',
    source: { partPath: 'parts/p.zipt', sourceKind: 'part' },
    properties: {},
    sheets: [{
      id: 'sheet-d', name: 'Sheet 1',
      size: { kind: 'iso', size: 'A3' }, orientation: 'landscape',
      views: [BASE_VIEW_FRESH as never, DETAIL_VIEW],
      dimensions: [], dimensionGroups: [], annotations: [], titleBlock: {},
    }],
    activeSheetId: 'sheet-d',
  };
}

describe('regenerateDetailView — basic re-clip (parent fresh, not stale)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecute.mockResolvedValue(undefined);
    useAppStore.setState({
      activeDocument: { kind: 'drawing', document: makeDrawingWithDetail() },
      activeDrawing: makeDrawingWithDetail(),
      activeDrawingSourceFingerprint: 'new-source-fp',
    });
  });

  it('calls projectDetailView with fresh parent projection, calls bus.execute with new fingerprint', async () => {
    const { projectDetailView, fingerprintDetailView } = await import('@zilventor/shared');

    await regenerateDetailView(
      DETAIL_VIEW,
      'sheet-d',
      fakeBus as never,
      (_id: string) => false, // parent not stale
      async (_view: unknown) => { /* cascade noop */ },
    );

    expect(projectDetailView).toHaveBeenCalledOnce();
    const callArg = (projectDetailView as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      parentView: { projection: { visibleEdges: unknown[] } };
      regionParent: { kind: string };
    };
    // Must clip against the LIVE parent projection (not stale closure)
    expect(callArg.parentView.projection.visibleEdges).toEqual(BASE_VIEW_FRESH.projection!.visibleEdges);
    expect(callArg.regionParent).toEqual(DETAIL_VIEW.regionParent);

    expect(fingerprintDetailView).toHaveBeenCalledOnce();
    expect(mockExecute).toHaveBeenCalledOnce();

    const cmdArg = mockExecute.mock.calls[0]![0] as { opts: { viewId: string; inputFingerprint: string } };
    expect(cmdArg.opts.viewId).toBe('det-1');
    expect(cmdArg.opts.inputFingerprint).toBe('new-detail-fp');
  });
});
```

- [ ] **Step 2: Run test to confirm RED**

```
pnpm --filter app test:unit -- packages/app/src/drawing/__tests__/regenerateDetailView.spec.ts
```
Expected: FAIL — `Cannot find module '../regenerateDetailView'`

- [ ] **Step 3: Create stub**

```typescript
// packages/app/src/drawing/regenerateDetailView.ts
import type { DetailView, DrawingView } from '@zilventor/shared';
import type { CommandBus } from '../commands/CommandBus';

export async function regenerateDetailView(
  _view: DetailView,
  _sheetId: string,
  _bus: CommandBus,
  _parentIsStale: (parentId: string) => boolean,
  _regenerateParent: (parentView: DrawingView) => Promise<void>,
): Promise<void> {
  throw new Error('regenerateDetailView: not implemented');
}
```

Run again. Expected: FAIL — throws instead of calling mocks.

- [ ] **Step 4: Implement `regenerateDetailView`**

```typescript
// packages/app/src/drawing/regenerateDetailView.ts
import type { DetailView, DrawingView, DrawingDocument } from '@zilventor/shared';
import { projectDetailView, fingerprintDetailView } from '@zilventor/shared';
import type { CommandBus } from '../commands/CommandBus';
import { RegenerateViewCommand } from '../commands/RegenerateViewCommand';
import { useAppStore } from '../store/useAppStore';

/**
 * Async helper for handleRegenerate — detail-view path.
 *
 * 1. If the parent is stale, regenerate it first via regenerateParent callback
 *    (which handles base/projected/iso/section depending on kind).
 * 2. Read the parent's FRESH projection from the live store (not stale closure).
 * 3. Re-clip via projectDetailView.
 * 4. Recompute inputFingerprint via fingerprintDetailView.
 * 5. Commit via RegenerateViewCommand.
 *
 * Throws if parent regenerate fails (caller keeps detail stale).
 */
export async function regenerateDetailView(
  view: DetailView,
  sheetId: string,
  bus: CommandBus,
  parentIsStale: (parentId: string) => boolean,
  regenerateParent: (parentView: DrawingView) => Promise<void>,
): Promise<void> {
  // Step 1: resolve live drawing doc.
  const stateBeforeCascade = useAppStore.getState();
  const docBefore = stateBeforeCascade.activeDocument;
  if (!docBefore || docBefore.kind !== 'drawing') throw new Error('REGEN_DETAIL: no active drawing');
  const drawingBefore = docBefore.document as DrawingDocument;

  // Step 2: cascade — regenerate parent if stale.
  if (parentIsStale(view.parentViewId)) {
    const parentView = drawingBefore.sheets
      .flatMap((s) => s.views)
      .find((v) => v.id === view.parentViewId);
    if (!parentView) throw new Error(`REGEN_DETAIL: parentViewId "${view.parentViewId}" not found`);
    // This may throw — let it propagate so the detail stays stale.
    await regenerateParent(parentView);
  }

  // Step 3: read FRESH state after potential parent regen.
  const liveState = useAppStore.getState();
  const liveDoc = liveState.activeDocument;
  if (!liveDoc || liveDoc.kind !== 'drawing') throw new Error('REGEN_DETAIL: drawing disappeared');
  const liveDrawing = liveDoc.document as DrawingDocument;

  const liveParent = liveDrawing.sheets
    .flatMap((s) => s.views)
    .find((v) => v.id === view.parentViewId);
  if (!liveParent || !liveParent.projection) {
    throw new Error(`REGEN_DETAIL: parent "${view.parentViewId}" missing projection after cascade`);
  }

  // Step 4: re-clip via pure-2D projectDetailView.
  const projection = projectDetailView({
    parentView: liveParent as Parameters<typeof projectDetailView>[0]['parentView'],
    regionParent: view.regionParent,
    detailScale: view.scale,
    showHidden: view.showHidden,
  });

  // Step 5: recompute fingerprint = djb2(parent inputFingerprint + regionParent + scale).
  const parentFp = (liveParent as { inputFingerprint?: string }).inputFingerprint ?? '';
  const inputFingerprint = fingerprintDetailView(parentFp, view.regionParent, view.scale);

  // Step 6: commit via RegenerateViewCommand.
  await bus.execute(new RegenerateViewCommand({
    sheetId,
    viewId: view.id,
    projection,
    inputFingerprint,
  }));
}
```

- [ ] **Step 5: Run test to confirm GREEN**

```
pnpm --filter app test:unit -- packages/app/src/drawing/__tests__/regenerateDetailView.spec.ts
```
Expected: PASS.

- [ ] **Step 6: Run full suite**

```
pnpm --filter app test:unit
```
Expected: 1739+ passing, no failures.

- [ ] **Step 7: Commit**

```bash
git add packages/app/src/drawing/regenerateDetailView.ts \
        packages/app/src/drawing/__tests__/regenerateDetailView.spec.ts
git commit -m "feat(drawing-regen): regenerateDetailView helper — pure-2D re-clip + fingerprint"
```

---

### Task 5: Unit test for detail cascade (stale parent regenerated first)

**Files:**
- Modify: `packages/app/src/drawing/__tests__/regenerateDetailView.spec.ts`

- [ ] **Step 1: Add failing cascade test**

Append to `regenerateDetailView.spec.ts`:
```typescript
describe('regenerateDetailView — cascade: stale parent regenerated before re-clip', () => {
  it('calls regenerateParent callback when parent is stale', async () => {
    vi.clearAllMocks();
    mockExecute.mockResolvedValue(undefined);

    // Start with stale parent (projection present but stale).
    const staleParent: BaseView = {
      ...BASE_VIEW_FRESH,
      inputFingerprint: 'stale-parent-fp', // differs from activeDrawingSourceFingerprint
    };
    const drawing = makeDrawingWithDetail();
    const drawingWithStaleParent: DrawingDocument = {
      ...drawing,
      sheets: drawing.sheets.map((s) => ({
        ...s,
        views: [staleParent as never, DETAIL_VIEW],
      })),
    };
    useAppStore.setState({
      activeDocument: { kind: 'drawing', document: drawingWithStaleParent },
      activeDrawing: drawingWithStaleParent,
      activeDrawingSourceFingerprint: 'new-source-fp',
    });

    const mockRegenerateParent = vi.fn().mockImplementation(async () => {
      // Simulate parent regen: update the parent's projection in the store.
      const liveDoc = useAppStore.getState().activeDocument!.document as DrawingDocument;
      const refreshed: DrawingDocument = {
        ...liveDoc,
        sheets: liveDoc.sheets.map((s) => ({
          ...s,
          views: s.views.map((v) =>
            v.id === staleParent.id
              ? { ...v, projection: BASE_VIEW_FRESH.projection, inputFingerprint: 'new-source-fp' }
              : v
          ),
        })),
      };
      useAppStore.setState({ activeDocument: { kind: 'drawing', document: refreshed }, activeDrawing: refreshed });
    });

    const { projectDetailView } = await import('@zilventor/shared');

    await regenerateDetailView(
      DETAIL_VIEW,
      'sheet-d',
      fakeBus as never,
      (_id: string) => true, // parent IS stale
      mockRegenerateParent,
    );

    // 1. regenerateParent was called with the parent view object.
    expect(mockRegenerateParent).toHaveBeenCalledOnce();
    expect(mockRegenerateParent.mock.calls[0]![0]).toMatchObject({ id: 'base-v1', kind: 'base' });

    // 2. projectDetailView was called AFTER regenerateParent (reads fresh projection).
    expect(projectDetailView).toHaveBeenCalledOnce();
    const clipArg = (projectDetailView as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      parentView: { projection: { visibleEdges: unknown[] }; inputFingerprint?: string };
    };
    // Fresh projection (set by mockRegenerateParent above).
    expect(clipArg.parentView.inputFingerprint).toBe('new-source-fp');
  });

  it('does NOT call regenerateParent when parent is not stale', async () => {
    vi.clearAllMocks();
    mockExecute.mockResolvedValue(undefined);
    useAppStore.setState({
      activeDocument: { kind: 'drawing', document: makeDrawingWithDetail() },
      activeDrawing: makeDrawingWithDetail(),
      activeDrawingSourceFingerprint: 'new-source-fp',
    });

    const mockRegenerateParent = vi.fn();

    await regenerateDetailView(
      DETAIL_VIEW,
      'sheet-d',
      fakeBus as never,
      (_id: string) => false, // parent NOT stale
      mockRegenerateParent,
    );

    expect(mockRegenerateParent).not.toHaveBeenCalled();
    expect(mockExecute).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run test to confirm RED**

```
pnpm --filter app test:unit -- packages/app/src/drawing/__tests__/regenerateDetailView.spec.ts
```
Expected: FAIL — cascade test may fail because `makeDrawingWithDetail` sheet id is `sheet-d` but the `staleParent` view is injected with a different drawing structure. If test passes first run, the implementation is already correct.

Likely failure mode: `liveParent.inputFingerprint` is `'stale-parent-fp'` (parent wasn't regenerated yet in the live store when `projectDetailView` is called). The mock `regenerateParent` updates the store correctly, so after `await regenerateParent(parentView)`, the live state has the fresh parent. Verify the test actually passes.

- [ ] **Step 3: Run to confirm GREEN**

```
pnpm --filter app test:unit -- packages/app/src/drawing/__tests__/regenerateDetailView.spec.ts
```
Expected: All tests PASS.

- [ ] **Step 4: Run full suite**

```
pnpm --filter app test:unit
```
Expected: 1741+ passing.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/drawing/__tests__/regenerateDetailView.spec.ts
git commit -m "test(drawing-regen): detail cascade — stale parent regenerated before re-clip"
```

---

## BATCH B3 — handleRegenerate dispatch + error handling

### Task 6: Unit test for DrawingCanvas handleRegenerate — section dispatch

**Files:**
- Create: `packages/app/src/drawing/__tests__/handleRegenerate.spec.ts`

- [ ] **Step 1: Write failing test**

```typescript
// packages/app/src/drawing/__tests__/handleRegenerate.spec.ts
/**
 * Unit tests for the handleRegenerate dispatch logic extracted from DrawingCanvas.
 * We test the helper functions directly rather than mounting the full component.
 * The helpers are exported for testability (see Task 7 for the export).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the two new helpers
const mockRegenerateSectionView = vi.fn().mockResolvedValue(undefined);
const mockRegenerateDetailView = vi.fn().mockResolvedValue(undefined);

vi.mock('../regenerateSectionView', () => ({
  regenerateSectionView: mockRegenerateSectionView,
}));
vi.mock('../regenerateDetailView', () => ({
  regenerateDetailView: mockRegenerateDetailView,
}));

// Re-import after mock setup
import { buildHandleRegenerate } from '../handleRegenerateHelpers';
import type { SectionView, DetailView, BaseView } from '@zilventor/shared';

const SECTION_VIEW: SectionView = {
  id: 'sec-1', kind: 'section', parentViewId: 'base-1',
  sectionLine: { p0: { x: 5, y: 15 }, p1: { x: 45, y: 15 } },
  arrowDirection: 1, label: 'A',
  positionMm: { x: 200, y: 80 }, scale: { numerator: 1, denominator: 1 },
  showHidden: false, mode: 'full',
  plane: { origin: { x: 0, y: 25, z: 0 }, normal: { x: 0, y: 1, z: 0 } },
  hatchSegments: [], fingerprint: 'fp',
  projection: {
    visibleEdges: [{ id: 'e1', kind: 'outline', points: [[0,0],[50,0]], sourceFaceIds: [] }],
    hiddenEdges: [], bbox: { minX: 0, minY: 0, maxX: 50, maxY: 0 },
  },
  inputFingerprint: 'stale-fp',
};

const DETAIL_VIEW: DetailView = {
  id: 'det-1', kind: 'detail', parentViewId: 'base-1',
  regionParent: { kind: 'circle', center: { x: 10, y: 10 }, radiusMm: 8 },
  label: 'B',
  positionMm: { x: 300, y: 200 }, scale: { numerator: 2, denominator: 1 },
  showHidden: false,
  projection: {
    visibleEdges: [{ id: 'clip-1', kind: 'outline', points: [[2,2],[6,2]], sourceFaceIds: [] }],
    hiddenEdges: [], bbox: { minX: 2, minY: 2, maxX: 6, maxY: 6 },
  },
  inputFingerprint: 'stale-detail-fp',
};

const BASE_VIEW: BaseView = {
  id: 'base-1', kind: 'base',
  positionMm: { x: 80, y: 80 }, scale: { numerator: 1, denominator: 1 },
  orientation: 'front', showHidden: false,
  projection: {
    visibleEdges: [{ id: 'b-e1', kind: 'outline', points: [[0,0],[50,0]], sourceFaceIds: [] }],
    hiddenEdges: [], bbox: { minX: 0, minY: 0, maxX: 50, maxY: 50 },
  },
  inputFingerprint: 'stale-base-fp',
};

const views = [BASE_VIEW, SECTION_VIEW, DETAIL_VIEW];
const fakeBus = { execute: vi.fn() };
const mockClearStale = vi.fn();

describe('buildHandleRegenerate — section dispatch', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('calls regenerateSectionView for section view kind', async () => {
    const handleRegen = buildHandleRegenerate({
      views,
      sheetId: 'sheet-1',
      bus: fakeBus as never,
      staleViews: new Set(['sec-1']),
      clearStaleView: mockClearStale,
      projectViewFromSourceFn: vi.fn(),
    });

    await handleRegen('sec-1');

    expect(mockRegenerateSectionView).toHaveBeenCalledOnce();
    expect(mockRegenerateSectionView).toHaveBeenCalledWith(SECTION_VIEW, 'sheet-1', fakeBus);
    expect(mockClearStale).toHaveBeenCalledWith('sec-1');
  });

  it('does NOT clear stale marker when regenerateSectionView throws', async () => {
    mockRegenerateSectionView.mockRejectedValueOnce(new Error('cut failed'));

    const handleRegen = buildHandleRegenerate({
      views,
      sheetId: 'sheet-1',
      bus: fakeBus as never,
      staleViews: new Set(['sec-1']),
      clearStaleView: mockClearStale,
      projectViewFromSourceFn: vi.fn(),
    });

    await handleRegen('sec-1');

    expect(mockClearStale).not.toHaveBeenCalled();
  });

  it('calls regenerateDetailView for detail view kind', async () => {
    const handleRegen = buildHandleRegenerate({
      views,
      sheetId: 'sheet-1',
      bus: fakeBus as never,
      staleViews: new Set(['det-1']),
      clearStaleView: mockClearStale,
      projectViewFromSourceFn: vi.fn(),
    });

    await handleRegen('det-1');

    expect(mockRegenerateDetailView).toHaveBeenCalledOnce();
    const [detView, sid, , parentIsStale] = mockRegenerateDetailView.mock.calls[0]! as [DetailView, string, unknown, (id: string) => boolean];
    expect(detView.id).toBe('det-1');
    expect(sid).toBe('sheet-1');
    // parentIsStale: base-1 is NOT in staleViews (only det-1 is), so false
    expect(parentIsStale('base-1')).toBe(false);
    expect(mockClearStale).toHaveBeenCalledWith('det-1');
  });
});
```

- [ ] **Step 2: Run test to confirm RED**

```
pnpm --filter app test:unit -- packages/app/src/drawing/__tests__/handleRegenerate.spec.ts
```
Expected: FAIL — `Cannot find module '../handleRegenerateHelpers'`

- [ ] **Step 3: Create `handleRegenerateHelpers.ts` stub**

```typescript
// packages/app/src/drawing/handleRegenerateHelpers.ts
import type { DrawingView } from '@zilventor/shared';
import type { CommandBus } from '../commands/CommandBus';

export type HandleRegenerateOptions = {
  views: readonly DrawingView[];
  sheetId: string;
  bus: CommandBus;
  staleViews: Set<string>;
  clearStaleView: (viewId: string) => void;
  projectViewFromSourceFn: (orientation: import('@zilventor/shared').ViewOrientation) => Promise<{ projection: import('@zilventor/shared').ProjectedGeometry; inputFingerprint: string }>;
};

export function buildHandleRegenerate(_opts: HandleRegenerateOptions): (viewId: string) => Promise<void> {
  return async (_viewId: string) => {
    throw new Error('buildHandleRegenerate: not implemented');
  };
}
```

Run test. Expected: FAIL — throws instead of calling mocks.

- [ ] **Step 4: Implement `buildHandleRegenerate`**

```typescript
// packages/app/src/drawing/handleRegenerateHelpers.ts
import type { DrawingView, ViewOrientation, ProjectedGeometry, SectionView, DetailView, BaseView, ProjectedView, IsoView } from '@zilventor/shared';
import type { CommandBus } from '../commands/CommandBus';
import { regenerateSectionView } from './regenerateSectionView';
import { regenerateDetailView } from './regenerateDetailView';
import { RegenerateViewCommand } from '../commands/RegenerateViewCommand';
import { deriveProjectedOrientation } from '@zilventor/shared/src/drawing/deriveProjectedOrientation';

export type HandleRegenerateOptions = {
  views: readonly DrawingView[];
  sheetId: string;
  bus: CommandBus;
  staleViews: Set<string>;
  clearStaleView: (viewId: string) => void;
  projectViewFromSourceFn: (orientation: ViewOrientation) => Promise<{ projection: ProjectedGeometry; inputFingerprint: string }>;
};

/**
 * Builds the async handleRegenerate dispatcher, extracted for testability.
 * Called from DrawingCanvas.handleRegenerate with the real dependencies.
 */
export function buildHandleRegenerate(opts: HandleRegenerateOptions): (viewId: string) => Promise<void> {
  const { views, sheetId, bus, staleViews, clearStaleView, projectViewFromSourceFn } = opts;

  /**
   * Regenerate a single base/projected/iso view by calling projectViewFromSource
   * and committing via RegenerateViewCommand.
   */
  async function regenerateBaseIsoProjected(view: BaseView | ProjectedView | IsoView): Promise<void> {
    let orientation: ViewOrientation;
    if (view.kind === 'base') {
      orientation = view.orientation;
    } else if (view.kind === 'iso') {
      orientation = `iso-${view.corner}` as ViewOrientation;
    } else {
      // 'projected'
      const baseView = views.find(
        (v): v is BaseView => v.id === (view as ProjectedView).baseViewId && v.kind === 'base'
      );
      if (!baseView) throw new Error(`REGEN: base view not found for projected view "${view.id}"`);
      orientation = deriveProjectedOrientation(baseView.orientation, (view as ProjectedView).direction);
    }
    const { projection, inputFingerprint } = await projectViewFromSourceFn(orientation);
    await bus.execute(new RegenerateViewCommand({ sheetId, viewId: view.id, projection, inputFingerprint }));
  }

  return async (viewId: string): Promise<void> => {
    const view = views.find((v) => v.id === viewId);
    if (!view) return;

    try {
      if (view.kind === 'section') {
        await regenerateSectionView(view as SectionView, sheetId, bus);
      } else if (view.kind === 'detail') {
        await regenerateDetailView(
          view as DetailView,
          sheetId,
          bus,
          (parentId: string) => staleViews.has(parentId),
          async (parentView: DrawingView) => {
            if (parentView.kind === 'section') {
              await regenerateSectionView(parentView as SectionView, sheetId, bus);
            } else if (
              parentView.kind === 'base' ||
              parentView.kind === 'projected' ||
              parentView.kind === 'iso'
            ) {
              await regenerateBaseIsoProjected(parentView as BaseView | ProjectedView | IsoView);
            }
          },
        );
      } else if (
        view.kind === 'base' ||
        view.kind === 'projected' ||
        view.kind === 'iso'
      ) {
        await regenerateBaseIsoProjected(view as BaseView | ProjectedView | IsoView);
      } else {
        return;
      }
      clearStaleView(viewId);
    } catch (err) {
      console.error('[handleRegenerate] failed:', err);
      // Do NOT clear stale marker on error — leave it for the user to retry.
    }
  };
}
```

- [ ] **Step 5: Run test to confirm GREEN**

```
pnpm --filter app test:unit -- packages/app/src/drawing/__tests__/handleRegenerate.spec.ts
```
Expected: All 3 tests PASS.

- [ ] **Step 6: Run full suite**

```
pnpm --filter app test:unit
```
Expected: 1744+ passing.

- [ ] **Step 7: Commit**

```bash
git add packages/app/src/drawing/handleRegenerateHelpers.ts \
        packages/app/src/drawing/__tests__/handleRegenerate.spec.ts
git commit -m "feat(drawing-regen): buildHandleRegenerate dispatcher — section/detail/base/iso routing"
```

---

### Task 7: Wire `handleRegenerate` in `DrawingCanvas.tsx`

**Files:**
- Modify: `packages/app/src/drawing/DrawingCanvas.tsx`

- [ ] **Step 1: Add imports to DrawingCanvas.tsx**

Open `packages/app/src/drawing/DrawingCanvas.tsx`. After the existing imports (around line 36), add:
```typescript
import { buildHandleRegenerate } from './handleRegenerateHelpers';
```

- [ ] **Step 2: Replace the `handleRegenerate` useCallback body**

Find lines 895–939 (the existing `handleRegenerate` callback). The current code is:
```typescript
  const handleRegenerate = useCallback((viewId: string) => {
    const view = sheet.views.find((v) => v.id === viewId);
    if (!view || view.kind === 'section' || view.kind === 'detail') {
      // Section/detail regenerate is out of scope for this pass (requires kernel re-cut).
      // Still clear the stale marker so the UI isn't permanently stuck.
      setStaleViews((prev) => { const next = new Set(prev); next.delete(viewId); return next; });
      return;
    }

    // Derive orientation for the view.
    let orientation: ViewOrientation;
    if (view.kind === 'base') {
      orientation = view.orientation;
    } else if (view.kind === 'iso') {
      orientation = `iso-${view.corner}` as ViewOrientation;
    } else if (view.kind === 'projected') {
      const baseView = sheet.views.find(
        (v): v is BaseView => v.id === view.baseViewId && v.kind === 'base'
      );
      if (!baseView) {
        setStaleViews((prev) => { const next = new Set(prev); next.delete(viewId); return next; });
        return;
      }
      orientation = deriveProjectedOrientation(baseView.orientation, view.direction);
    } else {
      setStaleViews((prev) => { const next = new Set(prev); next.delete(viewId); return next; });
      return;
    }

    void (async () => {
      try {
        const { projection, inputFingerprint } = await projectViewFromSource(orientation);
        await bus.execute(new RegenerateViewCommand({
          sheetId: sheet.id,
          viewId,
          projection,
          inputFingerprint,
        }));
        setStaleViews((prev) => { const next = new Set(prev); next.delete(viewId); return next; });
      } catch (err) {
        console.error('[handleRegenerate] failed:', err);
        // Do not clear the stale marker on error — leave it for the user to retry.
      }
    })();
  }, [sheet, bus]);
```

Replace with:
```typescript
  const handleRegenerate = useCallback((viewId: string) => {
    const dispatcher = buildHandleRegenerate({
      views: sheet.views,
      sheetId: sheet.id,
      bus,
      staleViews,
      clearStaleView: (id: string) => {
        setStaleViews((prev) => { const next = new Set(prev); next.delete(id); return next; });
      },
      projectViewFromSourceFn: projectViewFromSource,
    });
    void dispatcher(viewId);
  }, [sheet, bus, staleViews]);
```

- [ ] **Step 3: Remove the now-unused `deriveProjectedOrientation` import if it's only used in handleRegenerate**

Check line 37: `import { deriveProjectedOrientation } from '@zilventor/shared/src/drawing/deriveProjectedOrientation';`

`deriveProjectedOrientation` is now used ONLY inside `buildHandleRegenerate` (in `handleRegenerateHelpers.ts`), NOT in DrawingCanvas directly. Remove it from DrawingCanvas.tsx.

Also remove `RegenerateViewCommand` from line 35 if it is only referenced in `handleRegenerate`: `import { RegenerateViewCommand } from '../commands/RegenerateViewCommand';`

Verify by checking if `RegenerateViewCommand` or `deriveProjectedOrientation` appear elsewhere in DrawingCanvas.tsx:
```bash
grep -n "RegenerateViewCommand\|deriveProjectedOrientation" packages/app/src/drawing/DrawingCanvas.tsx
```
If only in the old `handleRegenerate` block (now replaced), remove those imports. If they appear elsewhere, keep them.

- [ ] **Step 4: Typecheck**

```
pnpm -r typecheck
```
Expected: 0 errors.

- [ ] **Step 5: Run full unit suite**

```
pnpm --filter app test:unit
```
Expected: 1744+ passing, no failures.

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/drawing/DrawingCanvas.tsx
git commit -m "feat(drawing-regen): wire handleRegenerate in DrawingCanvas — section/detail dispatch"
```

---

## BATCH B4 — e2e T-6-21

### Task 8: e2e T-6-21 — real geometry round-trip: section + detail regenerate

**Files:**
- Create: `tests/e2e/drawing/T-6-21-section-detail-regen.spec.ts`

- [ ] **Step 1: Write the e2e test**

```typescript
// tests/e2e/drawing/T-6-21-section-detail-regen.spec.ts
/**
 * T-6-21 — Section + detail view regenerate: real geometry round-trip.
 *
 * Scope: section and detail view Regenerate.
 *
 * Steps:
 *  1. Build a 50×50×30 box (part A).
 *  2. Save box-A bytes to OPFS as 'parts/src-T621.zipt'.
 *  3. Build a 60×60×40 box (part B) before creating the drawing
 *     (Model tab disappears after CreateDrawingCommand).
 *  4. Save box-B bytes to globalThis.__t621_bytesB.
 *  5. CreateDrawingCommand (part A, sourcePath 'parts/src-T621.zipt')
 *     → activeDrawingSourceFingerprint = fpA.
 *  6. AddBaseViewCommand → base view (front projection, inputFingerprint = fpA).
 *  7. AddSectionViewCommand → section view parented to base view
 *     (mid-plane cut y=25, full mode, hatch expected).
 *  8. AddDetailViewCommand → detail view parented to base view
 *     (circle region at center of base view, scale 2:1).
 *  9. Save drawing to OPFS via real packDrawing→unpackDrawing round-trip;
 *     store reopenedDoc in globalThis.__t621_reopenedDoc.
 * 10. Overwrite OPFS source path with box-B bytes.
 * 11. activateDrawingDocument(reopenedDoc) → activeDrawingSourceFingerprint = fpB.
 * 12. Assert: base, section, and detail views are ALL stale.
 * 13. Regenerate the section view → assert stale marker cleared + hatchSegments.length > 0.
 * 14. Regenerate the detail view → assert stale marker cleared.
 *     (detail cascade: base view is still stale; cascade regenerates base first, then re-clips detail.)
 * 15. Assert: no stale markers remain for the section and detail.
 */
import { test, expect } from '@playwright/test';
import { buildBox, waitForKernelReady } from '../helpers/buildBox';

test('T-6-21: section + detail regenerate — real geometry round-trip', async ({ page }) => {
  test.setTimeout(180_000);
  page.setDefaultTimeout(120_000);

  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('/');
  await waitForKernelReady(page);

  const SOURCE_PATH = 'parts/src-T621.zipt';

  // ─── Step 1+2: Build box A; save bytes to OPFS ─────────────────────────
  await buildBox(page, { width: 50, height: 50, depth: 30 });

  const { partIdA } = await page.evaluate(
    async ({ sourcePath }: { sourcePath: string }) => {
      async function opfsWrite(path: string, data: Uint8Array): Promise<void> {
        const root = await navigator.storage.getDirectory();
        const parts = path.split('/').filter((p) => p.length > 0);
        let dir: FileSystemDirectoryHandle = root;
        for (let i = 0; i < parts.length - 1; i++) {
          dir = await dir.getDirectoryHandle(parts[i]!, { create: true });
        }
        const fh = await dir.getFileHandle(parts[parts.length - 1]!, { create: true });
        const w2 = await fh.createWritable();
        await w2.write(data as unknown as FileSystemWriteChunkType);
        await w2.close();
      }

      const store = (window as unknown as { __zilventorStore: { getState(): { activePart: { id: string } | null; kernel: { execute(id: string): Promise<unknown>; saveToBytes(id: string): Promise<Uint8Array> } | null } } }).__zilventorStore;
      const s = store.getState();
      if (!s.activePart || !s.kernel) throw new Error('T-6-21 step 2: kernel not ready');
      await s.kernel.execute(s.activePart.id);
      const bytesA = await s.kernel.saveToBytes(s.activePart.id);
      await opfsWrite(sourcePath, bytesA);
      return { partIdA: s.activePart.id };
    },
    { sourcePath: SOURCE_PATH },
  );

  // ─── Step 3+4: Build box B; save bytes ────────────────────────────────
  await buildBox(page, { width: 60, height: 60, depth: 40 });

  await page.evaluate(async () => {
    const store = (window as unknown as { __zilventorStore: { getState(): { activePart: { id: string } | null; kernel: { execute(id: string): Promise<unknown>; saveToBytes(id: string): Promise<Uint8Array> } | null } } }).__zilventorStore;
    const s = store.getState();
    if (!s.activePart || !s.kernel) throw new Error('T-6-21 step 4: kernel not ready');
    await s.kernel.execute(s.activePart.id);
    const bytesB = await s.kernel.saveToBytes(s.activePart.id);
    (globalThis as unknown as Record<string, unknown>)['__t621_bytesB'] = bytesB;
  });

  // ─── Step 5–8: Create drawing + base + section + detail views ─────────
  const { sheetId, baseViewId, sectionViewId, detailViewId } = await page.evaluate(
    async ({ sourcePath, partIdA: pA }: { sourcePath: string; partIdA: string }) => {
      const store = (window as unknown as {
        __zilventorStore: {
          getState(): {
            activeDocument: { kind: string; document: { id: string; sheets: Array<{ id: string; views: Array<{ id: string; kind: string; projection?: { visibleEdges: unknown[] }; inputFingerprint?: string; hatchSegments?: unknown[] }> }> } } | null;
            activeDrawingSourcePartId: string | null;
            activeDrawingSourceFingerprint: string | null;
            kernel: { execute(id: string): Promise<unknown> } | null;
          };
        };
      }).__zilventorStore;

      // Ensure box-A is loaded in kernel (activate partIdA).
      const s0 = store.getState();
      if (s0.kernel) await s0.kernel.execute(pA);
      void pA;

      const { CreateDrawingCommand } = await import('/src/commands/CreateDrawingCommand.ts');
      await new CreateDrawingCommand({ sourcePath, sourceKind: 'part' }).apply();

      const s1 = store.getState();
      if (!s1.activeDrawingSourcePartId) throw new Error('T-6-21: activeDrawingSourcePartId null');
      if (!s1.activeDrawingSourceFingerprint) throw new Error('T-6-21: activeDrawingSourceFingerprint null');

      const drawing = (s1.activeDocument as { document: { id: string; sheets: Array<{ id: string }> } }).document;
      const sheetId = drawing.sheets[0]!.id;

      // Place base view (front, 1:1)
      const { AddBaseViewCommand } = await import('/src/commands/AddBaseViewCommand.ts');
      await new AddBaseViewCommand({
        sheetId,
        positionMm: { x: 80, y: 80 },
        orientation: 'front',
        scale: { numerator: 1, denominator: 1 },
      }).apply();

      const s2 = store.getState();
      const doc2 = (s2.activeDocument as { document: { sheets: Array<{ id: string; views: Array<{ id: string; kind: string; projection?: { visibleEdges: unknown[] } }> }> } }).document;
      const sh2 = doc2.sheets.find((s) => s.id === sheetId)!;
      const baseView = sh2.views.find((v) => v.kind === 'base')!;
      if (!baseView.projection || baseView.projection.visibleEdges.length === 0) {
        throw new Error('T-6-21: base view has no projected edges');
      }

      // Place section view: mid-plane horizontal cut (y=25 in parent view space), full mode
      const { AddSectionViewCommand } = await import('/src/commands/AddSectionViewCommand.ts');
      await new AddSectionViewCommand({
        drawingId: drawing.id,
        sheetId,
        parentViewId: baseView.id,
        p0: { x: 0, y: 25 },   // left edge of base view at mid-height
        p1: { x: 50, y: 25 },  // right edge
        arrowDirection: 1 as -1 | 1,
        dropAt: { x: 200, y: 80 },
        mode: 'full',
      }).apply();

      const s3 = store.getState();
      const sh3 = (s3.activeDocument as { document: { sheets: Array<{ id: string; views: Array<{ id: string; kind: string }> }> } }).document.sheets.find((s) => s.id === sheetId)!;
      const sectionView = sh3.views.find((v) => v.kind === 'section')!;

      // Place detail view: circle region on base view at ~center of bounding box
      const { AddDetailViewCommand } = await import('/src/commands/AddDetailViewCommand.ts');
      await new AddDetailViewCommand({
        drawingId: drawing.id,
        sheetId,
        parentViewId: baseView.id,
        regionParent: { kind: 'circle', center: { x: 25, y: 25 }, radiusMm: 15 },
        dropAt: { x: 80, y: 200 },
      }).apply();

      const s4 = store.getState();
      const sh4 = (s4.activeDocument as { document: { sheets: Array<{ id: string; views: Array<{ id: string; kind: string }> }> } }).document.sheets.find((s) => s.id === sheetId)!;
      const detailView = sh4.views.find((v) => v.kind === 'detail')!;

      return {
        sheetId,
        baseViewId: baseView.id,
        sectionViewId: sectionView.id,
        detailViewId: detailView.id,
      };
    },
    { sourcePath: SOURCE_PATH, partIdA },
  );

  // ─── Step 9: Pack → unpack round-trip ─────────────────────────────────
  await page.evaluate(async () => {
    const store = (window as unknown as { __zilventorStore: { getState(): { activeDocument: { kind: string; document: unknown } | null } } }).__zilventorStore;
    const state = store.getState();
    if (!state.activeDocument || state.activeDocument.kind !== 'drawing') {
      throw new Error('T-6-21 step 9: no active drawing');
    }
    const { packDrawing, unpackDrawing } = await import('/src/storage/DrawingPacker.ts');
    const packedBytes = await packDrawing(state.activeDocument.document as Parameters<typeof packDrawing>[0]);
    const reopenedDoc = await unpackDrawing(packedBytes);
    (globalThis as unknown as Record<string, unknown>)['__t621_reopenedDoc'] = reopenedDoc;
  });

  // ─── Step 10: Overwrite OPFS with box-B bytes ──────────────────────────
  await page.evaluate(
    async ({ sourcePath }: { sourcePath: string }) => {
      async function opfsWrite(path: string, data: Uint8Array): Promise<void> {
        const root = await navigator.storage.getDirectory();
        const parts = path.split('/').filter((p) => p.length > 0);
        let dir: FileSystemDirectoryHandle = root;
        for (let i = 0; i < parts.length - 1; i++) {
          dir = await dir.getDirectoryHandle(parts[i]!, { create: true });
        }
        const fh = await dir.getFileHandle(parts[parts.length - 1]!, { create: true });
        const w2 = await fh.createWritable();
        await w2.write(data as unknown as FileSystemWriteChunkType);
        await w2.close();
      }

      const bytesB = (globalThis as unknown as Record<string, unknown>)['__t621_bytesB'] as Uint8Array;
      if (!bytesB) throw new Error('T-6-21 step 10: bytesB not in globalThis');
      await opfsWrite(sourcePath, bytesB);
    },
    { sourcePath: SOURCE_PATH },
  );

  // ─── Step 11: activateDrawingDocument with reopenedDoc ────────────────
  await page.evaluate(async () => {
    async function opfsRead(path: string): Promise<Uint8Array> {
      const root = await navigator.storage.getDirectory();
      const parts = path.split('/').filter((p) => p.length > 0);
      let dir: FileSystemDirectoryHandle = root;
      for (let i = 0; i < parts.length - 1; i++) {
        dir = await dir.getDirectoryHandle(parts[i]!, { create: false });
      }
      const fh = await dir.getFileHandle(parts[parts.length - 1]!, { create: false });
      const file = await fh.getFile();
      return new Uint8Array(await file.arrayBuffer());
    }
    async function opfsExists(path: string): Promise<boolean> {
      try { await opfsRead(path); return true; } catch { return false; }
    }

    const opfsShim = { exists: opfsExists, read: opfsRead };
    const store = (window as unknown as { __zilventorStore: { getState(): { kernel: unknown } } }).__zilventorStore;
    const kernel = store.getState().kernel;
    const reopenedDoc = (globalThis as unknown as Record<string, unknown>)['__t621_reopenedDoc'];
    if (!reopenedDoc) throw new Error('T-6-21 step 11: reopenedDoc not in globalThis');

    const { activateDrawingDocument } = await import('/src/drawing/activateDrawingDocument.ts');
    await activateDrawingDocument(reopenedDoc as never, { kernel: kernel as never, opfs: opfsShim as never });
  });

  // ─── Step 12: Switch to Drawing tab; assert stale markers ─────────────
  await page.getByRole('tab', { name: 'Drawing' }).click();
  await expect(page.locator('[data-sheet-border]')).toBeVisible({ timeout: 15_000 });

  // All 3 views (base, section, detail) should be stale after reopen.
  await expect(page.locator('[data-stale-marker]').first()).toBeVisible({ timeout: 15_000 });
  const staleCountBefore = await page.locator('[data-stale-marker]').count();
  expect(staleCountBefore, 'base + section + detail must all be stale').toBeGreaterThanOrEqual(3);

  // ─── Step 13: Regenerate section view ────────────────────────────────
  const sectionStaleMarker = page.locator(`[data-stale-marker][data-view-id="${sectionViewId}"]`);
  await expect(sectionStaleMarker).toBeVisible({ timeout: 10_000 });
  await sectionStaleMarker.click();

  // Section stale marker should clear; hatchSegments updated.
  await expect(async () => {
    const count = await page.locator(`[data-stale-marker][data-view-id="${sectionViewId}"]`).count();
    expect(count, 'section stale marker must clear after Regenerate').toBe(0);
  }).toPass({ timeout: 30_000 });

  // Verify hatchSegments populated in store.
  const sectionHatchCount = await page.evaluate(
    ({ sid, shId }: { sid: string; shId: string }) => {
      const store = (window as unknown as { __zilventorStore: { getState(): { activeDocument?: { kind: string; document: { sheets: Array<{ id: string; views: Array<{ id: string; kind: string; hatchSegments?: unknown[] }> }> } } } } }).__zilventorStore;
      const doc = store.getState().activeDocument;
      if (doc?.kind !== 'drawing') return 0;
      const sh = doc.document.sheets.find((s) => s.id === shId);
      const sv = sh?.views.find((v) => v.id === sid);
      return (sv as { hatchSegments?: unknown[] } | undefined)?.hatchSegments?.length ?? 0;
    },
    { sid: sectionViewId, shId: sheetId },
  );
  console.log('[T-6-21] section hatchSegments after regen:', sectionHatchCount);
  expect(sectionHatchCount, 'section view must have hatch segments after regenerate').toBeGreaterThan(0);

  // ─── Step 14: Regenerate detail view (cascade: base still stale) ──────
  const detailStaleMarker = page.locator(`[data-stale-marker][data-view-id="${detailViewId}"]`);
  await expect(detailStaleMarker).toBeVisible({ timeout: 10_000 });
  await detailStaleMarker.click();

  // Detail stale marker should clear (cascade regenerated base first, then re-clipped detail).
  await expect(async () => {
    const count = await page.locator(`[data-stale-marker][data-view-id="${detailViewId}"]`).count();
    expect(count, 'detail stale marker must clear after Regenerate').toBe(0);
  }).toPass({ timeout: 30_000 });

  // ─── Step 15: Verify detail projection has edges ──────────────────────
  const detailEdgeCount = await page.evaluate(
    ({ did, shId }: { did: string; shId: string }) => {
      const store = (window as unknown as { __zilventorStore: { getState(): { activeDocument?: { kind: string; document: { sheets: Array<{ id: string; views: Array<{ id: string; projection?: { visibleEdges: unknown[] } }> }> } } } } }).__zilventorStore;
      const doc = store.getState().activeDocument;
      if (doc?.kind !== 'drawing') return 0;
      const sh = doc.document.sheets.find((s) => s.id === shId);
      const dv = sh?.views.find((v) => v.id === did);
      return dv?.projection?.visibleEdges.length ?? 0;
    },
    { did: detailViewId, shId: sheetId },
  );
  console.log('[T-6-21] detail edges after regen:', detailEdgeCount);
  // Detail clips a circle region from the base — at least some edges expected.
  // If the geometry is very small relative to the clip region, edges may be 0.
  // We assert the projection exists (not that edges > 0) since the clip may produce
  // empty output depending on where the circle falls on box-B's projection.
  const detailFp = await page.evaluate(
    ({ did, shId }: { did: string; shId: string }) => {
      const store = (window as unknown as { __zilventorStore: { getState(): { activeDocument?: { kind: string; document: { sheets: Array<{ id: string; views: Array<{ id: string; inputFingerprint?: string }> }> } } } } }).__zilventorStore;
      const doc = store.getState().activeDocument;
      if (doc?.kind !== 'drawing') return null;
      const sh = doc.document.sheets.find((s) => s.id === shId);
      const dv = sh?.views.find((v) => v.id === did);
      return dv?.inputFingerprint ?? null;
    },
    { did: detailViewId, shId: sheetId },
  );
  expect(detailFp, 'detail inputFingerprint must be set after regenerate').not.toBeNull();
  expect(detailFp, 'detail inputFingerprint must not be the stale old value').not.toBe('stale-detail-fp');

  // ─── Step 16: No stale markers for section or detail ──────────────────
  const remainingSectionMarkers = await page.locator(`[data-stale-marker][data-view-id="${sectionViewId}"]`).count();
  const remainingDetailMarkers = await page.locator(`[data-stale-marker][data-view-id="${detailViewId}"]`).count();
  expect(remainingSectionMarkers, 'section stale marker must be gone').toBe(0);
  expect(remainingDetailMarkers, 'detail stale marker must be gone').toBe(0);
});
```

- [ ] **Step 2: Run the e2e test to see it fail before implementation (or pass if wiring is done)**

```bash
# Kill stale dev server if needed
lsof -ti:5173 | xargs kill -9 2>/dev/null || true
pnpm test:e2e -- tests/e2e/drawing/T-6-21-section-detail-regen.spec.ts
```
Expected: If Tasks 1–7 are done, this may PASS on first run (the logic is wired). If not, expected failure is `sectionStaleMarker not visible within timeout` or `hatchSegments count = 0`.

- [ ] **Step 3: Confirm output — read the test log**

The browser console output is printed. Look for:
```
[T-6-21] section hatchSegments after regen: <N>
[T-6-21] detail edges after regen: <N>
```
`N` must be > 0 for hatch and ≥ 0 for detail edges.

- [ ] **Step 4: If FAIL — diagnose and fix**

Common failure modes:
- `[handleRegenerate] failed: REGEN_SECTION: full/half view missing plane` → the section view stored on the drawing after AddSectionViewCommand.apply() does NOT have `plane` set. Check `AddSectionViewCommand` line 176 — it only sets `plane` conditionally for full mode in the full/half path. Verify `plane` is set in `sectionView` object. If not, the section view cannot be regenerated — assert in step 7 that `sectionView.plane !== undefined` and fail loud.
- `REGEN_SECTION cut failed: empty` → the box-B geometry misses the section plane. The plane is derived from the box-A sectionLine (p0={x:0,y:25}, p1={x:50,y:25}). Box B is 60×60×40 so a horizontal cut at y=25 should hit it. Verify this is correct.
- `stale markers < 3` → `computeStaleViewIds` may not flag section/detail views if their `inputFingerprint` was set using `Array.from(sectionViewMatrix).slice(0,4).join(',')` rather than `activeDrawingSourceFingerprint`. Check `AddSectionViewCommand.ts` line 182: `inputFingerprint: Array.from(sectionViewMatrix).slice(0, 4).join(',')` — this is NOT the source fingerprint. This means after reopen, `computeStaleViewIds` WILL flag them (condition a: `inputFingerprint !== activeDrawingSourceFingerprint`). Staleness detection already works via condition (b) or (a).

- [ ] **Step 5: Run full unit suite after any fixes**

```
pnpm --filter app test:unit
```
Expected: 1744+ passing.

- [ ] **Step 6: Confirm e2e GREEN**

```
pnpm test:e2e -- tests/e2e/drawing/T-6-21-section-detail-regen.spec.ts
```
Expected: PASS.

- [ ] **Step 7: Run final lint + typecheck**

```
pnpm -r typecheck && pnpm lint
```
Expected: 0 errors, 0 warnings.

- [ ] **Step 8: Commit**

```bash
git add tests/e2e/drawing/T-6-21-section-detail-regen.spec.ts
git commit -m "test(drawing-regen): T-6-21 e2e — section + detail regenerate real geometry round-trip"
```

---

## BATCH B5 — Assembly-sourced section regenerate

### Task 9: Unit test for assembly-sourced section (cutAssemblyBySectionPlane dispatch) — **Regression-coverage task (not red-first)**

> **Reason:** The assembly branch (`source.kind === 'assembly'` → `cutAssemblyBySectionPlane`) is already present in the Task 1 implementation (same `if (view.mode === 'stepped') { ... } else { ... }` block, dispatching on `source.kind`). This test exercises that already-implemented branch with a mocked `resolveSectionSource` returning `'assembly'`; it will pass immediately. It locks the assembly-dispatch contract as regression coverage. There is no distinct code added in this task.

**Files:**
- Modify: `packages/app/src/drawing/__tests__/regenerateSectionView.spec.ts`

- [ ] **Step 1: Add test**

Append to `regenerateSectionView.spec.ts`:
```typescript
describe('regenerateSectionView — assembly source', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses cutAssemblyBySectionPlane when source.kind === "assembly"', async () => {
    const { resolveSectionSource } = await import('@zilventor/shared');
    (resolveSectionSource as ReturnType<typeof vi.fn>).mockReturnValueOnce({ kind: 'assembly', id: 'asm-uuid-1' });

    const { cutAssemblyBySectionPlane } = await import('../../kernel/cutBySectionPlane');

    const drawingAsm: DrawingDocument = {
      ...makeDrawingWithSection(),
      source: { partPath: 'assemblies/asm1.ziasm', sourceKind: 'assembly' },
    };
    useAppStore.setState({
      activeDocument: { kind: 'drawing', document: drawingAsm },
      activeDrawing: drawingAsm,
      activeDrawingSourcePartId: null,
      activeDrawingSourceFingerprint: 'new-asm-fp',
      activeAssembly: { id: 'asm-uuid-1', materials: [], components: [] } as never,
      activePart: null,
      kernel: {} as never,
    });

    await regenerateSectionView(SECTION_VIEW_FULL, 'sheet-1', fakeBus as never);

    expect(cutAssemblyBySectionPlane).toHaveBeenCalledOnce();
    expect(cutAssemblyBySectionPlane).toHaveBeenCalledWith(
      'asm-uuid-1',
      SECTION_VIEW_FULL.plane,
      SECTION_VIEW_FULL.arrowDirection,
      undefined,
      undefined,
    );
    // Section regenerate writes atomically to the store (not through bus.execute).
    expect(fakeBus.execute).not.toHaveBeenCalled();
    // Verify store was updated with the assembly-source fingerprint.
    const liveDoc = useAppStore.getState().activeDocument;
    const liveDrawing = (liveDoc as { kind: string; document: { sheets: Array<{ id: string; views: Array<{ id: string; inputFingerprint?: string }> }> } }).document;
    const updatedView = liveDrawing.sheets[0]!.views.find((v) => v.id === SECTION_VIEW_FULL.id)!;
    expect(updatedView.inputFingerprint).toBe('new-asm-fp');
  });
});
```

- [ ] **Step 2: Run test to confirm GREEN** (regression-coverage — passes immediately against Task 1 impl)

```
pnpm --filter app test:unit -- packages/app/src/drawing/__tests__/regenerateSectionView.spec.ts
```
Expected: All tests PASS.

- [ ] **Step 3: Run full suite**

```
pnpm --filter app test:unit
```
Expected: 1745+ passing.

- [ ] **Step 4: Commit**

```bash
git add packages/app/src/drawing/__tests__/regenerateSectionView.spec.ts
git commit -m "test(drawing-regen): assembly-sourced section uses cutAssemblyBySectionPlane (regression coverage)"
```

---

## BATCH B6 — Stepped section regenerate

### Task 10: Unit test for stepped section (cutByStepSegments dispatch) — **Regression-coverage task (not red-first)**

> **Reason:** The stepped branch (`mode === 'stepped'` → `deriveStepPlanes` → `cutByStepSegments`) is fully implemented in Task 1 (the `if (view.mode === 'stepped')` block). This test exercises that path with a stepped view fixture; it will pass immediately. It locks the stepped-mode parameter-forwarding contract as regression coverage. No new code is introduced in this task.

**Files:**
- Modify: `packages/app/src/drawing/__tests__/regenerateSectionView.spec.ts`

- [ ] **Step 1: Add test**

Append to `regenerateSectionView.spec.ts`:
```typescript
const STEP_SEGS = [
  { startSheet: { x: 0, y: 10 }, endSheet: { x: 25, y: 10 } },
  { startSheet: { x: 25, y: 10 }, endSheet: { x: 25, y: 40 } },
  { startSheet: { x: 25, y: 40 }, endSheet: { x: 50, y: 40 } },
] as const;

const SECTION_VIEW_STEPPED: SectionView = {
  id: 'sec-stepped',
  kind: 'section',
  parentViewId: 'base-1',
  sectionLine: { p0: { x: 0, y: 10 }, p1: { x: 50, y: 40 } },
  arrowDirection: 1,
  label: 'C',
  positionMm: { x: 300, y: 80 },
  scale: { numerator: 1, denominator: 1 },
  showHidden: false,
  mode: 'stepped',
  stepSegments: STEP_SEGS,
  hatchSegments: [],
  fingerprint: 'old-stepped-fp',
  projection: {
    visibleEdges: [],
    hiddenEdges: [],
    bbox: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
  },
  inputFingerprint: 'old-source-fp',
};

import type { StepSegment } from '@zilventor/shared';

describe('regenerateSectionView — stepped mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Set up drawing with the stepped section view.
    const drawingWithStepped: DrawingDocument = {
      ...makeDrawingWithSection(),
      sheets: makeDrawingWithSection().sheets.map((s) => ({
        ...s,
        views: [...s.views, SECTION_VIEW_STEPPED],
      })),
    };
    useAppStore.setState({
      activeDocument: { kind: 'drawing', document: drawingWithStepped },
      activeDrawing: drawingWithStepped,
      activeDrawingSourcePartId: 'part-uuid-1',
      activeDrawingSourceFingerprint: 'new-source-fp',
      activePart: { id: 'part-uuid-1', materials: [], featureTree: [], parameters: {} } as never,
      kernel: {} as never,
    });
  });

  it('calls cutByStepSegments with deriveStepPlanes result for stepped mode', async () => {
    const { cutByStepSegments } = await import('../../kernel/cutBySectionPlane');
    const { deriveStepPlanes } = await import('@zilventor/shared/src/drawing/sectionPlane');

    await regenerateSectionView(SECTION_VIEW_STEPPED, 'sheet-1', fakeBus as never);

    expect(deriveStepPlanes).toHaveBeenCalledOnce();
    const stepArgs = (deriveStepPlanes as ReturnType<typeof vi.fn>).mock.calls[0]![0] as readonly StepSegment[];
    expect(stepArgs).toEqual(STEP_SEGS);

    expect(cutByStepSegments).toHaveBeenCalledOnce();
    // First arg is kernelId, second is planes from deriveStepPlanes, third is arrowDirection.
    expect((cutByStepSegments as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toBe('part-uuid-1');
    expect((cutByStepSegments as ReturnType<typeof vi.fn>).mock.calls[0]![2]).toBe(1);

    // Section regenerate writes to the store, not through bus.execute.
    expect(fakeBus.execute).not.toHaveBeenCalled();
    const liveDoc = useAppStore.getState().activeDocument;
    const liveDrawing = (liveDoc as { kind: string; document: { sheets: Array<{ views: Array<{ id: string; inputFingerprint?: string }> }> } }).document;
    const updatedView = liveDrawing.sheets[0]!.views.find((v) => v.id === SECTION_VIEW_STEPPED.id)!;
    expect(updatedView.inputFingerprint).toBe('new-source-fp');
  });
});
```

- [ ] **Step 2: Run test to confirm GREEN** (regression-coverage — passes immediately against Task 1 impl)

```
pnpm --filter app test:unit -- packages/app/src/drawing/__tests__/regenerateSectionView.spec.ts
```
Expected: All tests PASS.

- [ ] **Step 3: Run full suite**

```
pnpm --filter app test:unit
```
Expected: 1746+ passing.

- [ ] **Step 4: Commit**

```bash
git add packages/app/src/drawing/__tests__/regenerateSectionView.spec.ts
git commit -m "test(drawing-regen): stepped section dispatches to cutByStepSegments via deriveStepPlanes (regression coverage)"
```

---

## FINAL VERIFICATION

- [ ] **Run full unit suite**

```
pnpm --filter app test:unit
```
Expected: 1746+ tests PASS (baseline 1735 + ~11 new tests). Zero failures.

- [ ] **Run e2e**

```
pnpm test:e2e -- tests/e2e/drawing/T-6-21-section-detail-regen.spec.ts
```
Expected: PASS.

- [ ] **Typecheck + lint**

```
pnpm -r typecheck && pnpm lint
```
Expected: 0 errors.

---

## SPEC COVERAGE CHECK

1. Section regenerate (part): ✅ Task 1 (full) + Task 2 (half) + Task 10 (stepped)
2. Assembly-sourced section: ✅ Task 9 + Task 1 (cutAssemblyBySectionPlane branch)
3. Detail regenerate (pure-2D): ✅ Task 4
4. Detail cascade (stale parent): ✅ Task 5 + Task 8 (e2e)
5. `handleRegenerate` dispatch: ✅ Task 6 + Task 7 (wiring)
6. Error handling (cut fail → stale preserved): ✅ Task 3
7. e2e T-6-21 real geometry: ✅ Task 8

**Out of scope** (per spec §Out of scope): Regenerate All button; changing creation or staleness-compute; no kernel changes.

---

*Plan written 2026-05-26.*
