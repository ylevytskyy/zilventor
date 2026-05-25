# activeDrawing-on-setState Audit — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate a class of undo/redo-staleness bugs by making every drawing command keep the store invariant `activeDrawing === activeDocument.document`, enforced by a parametrized guard test.

**Architecture:** Add one pure helper `drawingDocState(nextDoc)` that returns the full derived store slice (`activeDocument` + `activePart:null` + `activeAssembly:null` + `activeDrawing:nextDoc`). Rewrite the 20 offending commands' `setState` calls to spread it. A single table-driven guard suite drives every touched command through `apply`→assert→`revert`→assert.

**Tech Stack:** TypeScript, Zustand (`useAppStore`), Vitest. Package: `packages/app`.

---

## Background facts (verified by full per-command read — authoritative)

- Store: `packages/app/src/store/useAppStore.ts`. `activeDrawing: DrawingDocument | null` (line ~95, default null line ~330). `setActiveDocument` (line ~343) already derives `activeDrawing` from the doc kind. Subscribers to `activeDrawing`: `DrawingCanvas.tsx`, `DimensionElement.tsx`, `DrawingTreePane.tsx`, `App.tsx`.
- **The bug:** offending commands call `useAppStore.setState({ activeDocument: { kind:'drawing', document: <doc> } })` directly and omit `activeDrawing`, so after the command (and its undo/redo) the two fields diverge.
- **No command sets any EXTRA store field** in these `setState` calls (no `selectedFeatureId`, `activeToolKind`, selection, etc.). So replacing the raw object with `drawingDocState(<doc>)` is always behavior-preserving.
- **No shared test drawing factory exists** — each spec defines its own local `makeDrawing()`. Every offender command already has a `__tests__/<Command>.spec.ts` (or `.test.ts`) with a proven minimal fixture; the guard cases reuse those patterns.
- All offender `setState` calls are the SAME single-line shape; a few correct/sheet commands use a multi-line brace form. The local doc variable name varies (`next`, `nextDoc`) — use whatever the command already declares.

### The 20 commands to fix

| Batch | Command | File (`packages/app/src/commands/`) | apply line | revert line | Notes / fixture preconditions |
|---|---|---|---|---|---|
| B1 | AddBaseViewCommand | `AddBaseViewCommand.ts` | 46 | 63 | ctor `{ sheetId, positionMm:{x,y}, orientation, scale, showHidden? }`. Reuse `AddBaseViewCommand.spec.ts` makeDrawing. |
| B1 | AddProjectedViewCommand | `AddProjectedViewCommand.ts` | 54 | 71 | ctor `{ sheetId, baseViewId, direction, positionMm }`. **Throws `BASE_VIEW_NOT_FOUND`** — fixture sheet must contain a `kind:'base'` view whose id == `baseViewId`. |
| B1 | AddIsoViewCommand | `AddIsoViewCommand.ts` | 44 | 61 | ctor `{ sheetId, positionMm, corner, scale, showHidden? }`. |
| B1 | DeleteViewCommand | `DeleteViewCommand.ts` | 117 | 150 | ctor `{ sheetId, viewId }`. **No-ops (no setState) if view absent** — fixture must contain a view with that id. May async-evict sectionCache (best-effort); keep fixture kernel-free. |
| B1 | RegenerateViewCommand | `RegenerateViewCommand.ts` | 81 | 120 | ctor `{ sheetId, viewId, projection, inputFingerprint }`. No-ops if view absent. Supply a minimal `ProjectedGeometry` (`{ visibleEdges:[], hiddenEdges:[], bbox }`). |
| B1 | MoveViewCommand | `MoveViewCommand.ts` | 45 | 69 | ctor `{ sheetId, viewId, positionMm }`. No-ops if view absent. |
| B1 | EditViewScaleCommand | `EditViewScaleCommand.ts` | 51 | 78 | ctor `{ sheetId, viewId, scale }`. No-ops if view absent. |
| B1 | ToggleHiddenLinesCommand | `ToggleHiddenLinesCommand.ts` | 45 | 69 | ctor `{ sheetId, viewId, showHidden }`. No-ops if view absent; skips `kind:'section'`. |
| B2 | AddDrawingAnnotationCommand | `AddDrawingAnnotationCommand.ts` | 23 | 39 | ctor `{ sheetId, ann }`. `ann` needs unique `id`. |
| B2 | DeleteDrawingAnnotationCommand | `DeleteDrawingAnnotationCommand.ts` | 28 | 45 | ctor `{ sheetId, annId }`. No-ops if annotation absent — fixture sheet must contain it. |
| B2 | MoveDrawingAnnotationCommand | `MoveDrawingAnnotationCommand.ts` | 41 | 57 | ctor `{ sheetId, annId, textPosMm?, targetMm? }`. No-ops if absent. |
| B2 | AddDrawingDimensionCommand | `AddDrawingDimensionCommand.ts` | 23 | 39 | ctor `{ sheetId, dim }`. `dim` needs unique `id`. |
| B2 | DeleteDrawingDimensionCommand | `DeleteDrawingDimensionCommand.ts` | 29 | 47 | ctor `{ sheetId, dimId }`. No-ops if dim absent — fixture must contain it. |
| B3 | AddSheetCommand | `AddSheetCommand.ts` | 44-46 | 60-62 | ctor `{ size?, orientation? }`. Multi-line brace form. Fixture: drawing with ≥1 sheet. |
| B3 | DeleteSheetCommand | `DeleteSheetCommand.ts` | 40 | 57 | ctor `{ sheetId }`. **Throws `LAST_SHEET`** if ≤1 sheet — fixture must have ≥2 sheets. |
| B3 | RenameSheetCommand | `RenameSheetCommand.ts` | 27 | 42 | ctor `{ sheetId, name }`. No-ops if sheet absent. |
| B3 | EditSheetSizeCommand | `EditSheetSizeCommand.ts` | 37 | 54 | ctor `{ sheetId, size, orientation }`. No-ops if sheet absent. |
| B3 | EditDrawingPropertiesCommand | `EditDrawingPropertiesCommand.ts` | 19 | 30 | ctor `{ properties }`. Reads top-level `doc.document.properties`. Always runs. |
| B3 | EditTitleBlockCommand | `EditTitleBlockCommand.ts` | 23 | 37 | ctor `{ sheetId, overrides }`. No-ops revert if sheet absent. |
| B3 | **SetActiveSheetCommand (inverse)** | `SetActiveSheetCommand.ts` | 18-20 | 28 | ctor `{ sheetId }`. **Writes `activeDrawing` ONLY, omits `activeDocument`.** No-ops if `activeDrawing` null. See Task 5 Step C for the special edit. |

**Do NOT touch (already correct — positive controls only):** AddAngularDimCommand, AddBaselineMemberCommand, AddBreakCommand, AddDetailViewCommand, AddDimensionGroupCommand, AddHoleTableCommand, AddOrdinateMemberCommand, AddSectionViewCommand, AutoDimCommand, DeleteBreakCommand, DeleteDimensionGroupCommand, EditDetailRegionCommand, MoveDrawingDimensionCommand.

---

## Task 1: `drawingDocState` helper

**Files:**
- Create: `packages/app/src/store/drawingDocState.ts`
- Test: `packages/app/src/store/__tests__/drawingDocState.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/app/src/store/__tests__/drawingDocState.spec.ts
import { describe, it, expect } from 'vitest';
import type { DrawingDocument } from '@zilventor/shared';
import { drawingDocState } from '../drawingDocState';

const doc = { id: 'd1', name: 'D', units: 'mm' } as unknown as DrawingDocument;

describe('drawingDocState', () => {
  it('returns the full derived drawing slice with activeDrawing === the doc', () => {
    const slice = drawingDocState(doc);
    expect(slice.activeDocument).toEqual({ kind: 'drawing', document: doc });
    expect(slice.activeDrawing).toBe(doc);
    expect(slice.activePart).toBeNull();
    expect(slice.activeAssembly).toBeNull();
  });

  it('activeDrawing is referentially identical to activeDocument.document', () => {
    const slice = drawingDocState(doc);
    expect(slice.activeDrawing).toBe(slice.activeDocument.document);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter app exec vitest run src/store/__tests__/drawingDocState.spec.ts`
Expected: FAIL — cannot resolve `../drawingDocState`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/app/src/store/drawingDocState.ts
import type { DrawingDocument } from '@zilventor/shared';

/**
 * Derived store slice for "a drawing document is now active".
 * Spread into useAppStore.setState(...) so activeDrawing can never drift from
 * activeDocument — see docs/superpowers/specs/2026-05-25-active-drawing-audit-design.md.
 */
export function drawingDocState(nextDoc: DrawingDocument) {
  return {
    activeDocument: { kind: 'drawing' as const, document: nextDoc },
    activePart: null,
    activeAssembly: null,
    activeDrawing: nextDoc,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter app exec vitest run src/store/__tests__/drawingDocState.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Typecheck + commit**

```bash
pnpm --filter app typecheck
git add packages/app/src/store/drawingDocState.ts packages/app/src/store/__tests__/drawingDocState.spec.ts
git commit -m "feat(active-drawing-audit): drawingDocState slice helper (Task 1)"
```

---

## Task 2: Guard-suite harness + shared `makeDrawing()` + positive control

Build the parametrized harness and prove it works with ONE already-correct command (`AddDimensionGroupCommand`) — it must pass immediately. This locks the harness shape before any offender is added.

**Files:**
- Create: `packages/app/src/commands/__tests__/activeDrawingInvariant.guard.test.ts`

- [ ] **Step 1: Write the harness with the makeDrawing helper, the assert, and one positive-control case**

```ts
// packages/app/src/commands/__tests__/activeDrawingInvariant.guard.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import type { DrawingDocument, DrawingSheet } from '@zilventor/shared';
import { useAppStore } from '../../store/useAppStore';
import { AddDimensionGroupCommand } from '../AddDimensionGroupCommand';

/** One minimal sheet. Override per case (views/dimensions/annotations/etc.). */
function makeSheet(over: Partial<DrawingSheet> = {}): DrawingSheet {
  return {
    id: 'sheet-1', name: 'Sheet 1', size: { kind: 'iso', size: 'A3' },
    orientation: 'landscape', views: [], dimensions: [], dimensionGroups: [],
    annotations: [], titleBlock: {},
    ...over,
  } as DrawingSheet;
}

/** Minimal valid DrawingDocument. Override `sheets` per case. */
function makeDrawing(over: Partial<DrawingDocument> = {}): DrawingDocument {
  return {
    id: 'd1', name: 'D', units: 'mm',
    source: { partPath: 'parts/p.zipt', sourceKind: 'part' },
    properties: {},
    sheets: [makeSheet()],
    activeSheetId: 'sheet-1',
    ...over,
  } as DrawingDocument;
}

/** Seed the store with a drawing via setActiveDocument so the baseline is already synced. */
function seedDrawing(doc: DrawingDocument): void {
  useAppStore.getState().setActiveDocument({ kind: 'drawing', document: doc });
}

interface Command { apply(): unknown | Promise<unknown>; revert(): unknown | Promise<unknown>; }

interface GuardCase {
  name: string;
  /** Seed the store AND return the constructed command. Baseline must be a synced drawing. */
  make: () => Command;
}

function expectSynced(label: string): void {
  const s = useAppStore.getState();
  expect(s.activeDocument?.kind, `${label}: activeDocument.kind`).toBe('drawing');
  if (s.activeDocument?.kind === 'drawing') {
    expect(s.activeDrawing, `${label}: activeDrawing must === activeDocument.document`)
      .toBe(s.activeDocument.document);
  }
}

const CASES: GuardCase[] = [
  // Positive control — already correct, must pass without any fix.
  {
    name: 'AddDimensionGroupCommand (control)',
    make: () => {
      seedDrawing(makeDrawing());
      return new AddDimensionGroupCommand({
        sheetId: 'sheet-1',
        group: { id: 'g1', kind: 'baseline', axis: 'x', members: [], originRef: { kind: 'free', pointMm: { x: 0, y: 0 } } } as never,
      });
    },
  },
];

beforeEach(() => {
  useAppStore.setState({ activeDocument: null, activePart: null, activeAssembly: null, activeDrawing: null });
});

describe('activeDrawing invariant — every drawing command keeps activeDrawing === activeDocument.document', () => {
  for (const c of CASES) {
    it(c.name, async () => {
      const cmd = c.make();
      expectSynced('baseline');
      await cmd.apply();
      expectSynced('after apply');
      await cmd.revert();
      expectSynced('after revert');
    });
  }
});
```

> **Note for implementer:** the `AddDimensionGroupCommand` ctor arg shape above is a best-effort guess — open `AddDimensionGroupCommand.ts` + its existing spec and copy the exact `DimensionGroup` shape. The control case MUST pass; if it fails on a fixture/type error, fix the fixture (the command is known-correct).

- [ ] **Step 2: Run — control must PASS**

Run: `pnpm --filter app exec vitest run src/commands/__tests__/activeDrawingInvariant.guard.test.ts`
Expected: PASS (1 test). If it fails on `activeDrawing` divergence, that contradicts the audit — STOP and re-read `AddDimensionGroupCommand`. If it fails on fixture/type, fix the fixture.

- [ ] **Step 3: Commit**

```bash
git add packages/app/src/commands/__tests__/activeDrawingInvariant.guard.test.ts
git commit -m "test(active-drawing-audit): parametrized guard harness + makeDrawing + positive control (Task 2)"
```

---

## Task 3 (Batch B1): 8 view commands

For each command: add its guard case (RED), then apply the helper (GREEN). The RED step is mandatory and load-bearing — it proves the case actually exercises the command's `setState`. **If a newly-added case passes BEFORE the fix, its fixture is not driving the command (the command no-ops) — correct the fixture until it goes RED.**

**Files:**
- Modify: `packages/app/src/commands/__tests__/activeDrawingInvariant.guard.test.ts`
- Modify (the 8 B1 command files listed in the Background table)

- [ ] **Step 1: Add 8 view-command guard cases to `CASES`**

Add imports at top of the guard file:
```ts
import { AddBaseViewCommand } from '../AddBaseViewCommand';
import { AddProjectedViewCommand } from '../AddProjectedViewCommand';
import { AddIsoViewCommand } from '../AddIsoViewCommand';
import { DeleteViewCommand } from '../DeleteViewCommand';
import { RegenerateViewCommand } from '../RegenerateViewCommand';
import { MoveViewCommand } from '../MoveViewCommand';
import { EditViewScaleCommand } from '../EditViewScaleCommand';
import { ToggleHiddenLinesCommand } from '../ToggleHiddenLinesCommand';
```

Append these cases to `CASES` (open each command's existing `__tests__/<Command>.spec.ts` and copy its proven view fixture — the shapes below are scaffolds; align field names to the real `BaseView`/`ProjectedGeometry`/`ViewScale` types):
```ts
{
  name: 'AddBaseViewCommand',
  make: () => {
    seedDrawing(makeDrawing());
    return new AddBaseViewCommand({ sheetId: 'sheet-1', positionMm: { x: 50, y: 50 }, orientation: 'front', scale: { kind: 'ratio', ratio: 1 } } as never);
  },
},
{
  name: 'AddProjectedViewCommand',
  make: () => {
    // precondition: a base view present (else BASE_VIEW_NOT_FOUND)
    const baseView = { id: 'bv1', kind: 'base', positionMm: { x: 50, y: 50 }, orientation: 'front', scale: { kind: 'ratio', ratio: 1 } };
    seedDrawing(makeDrawing({ sheets: [makeSheet({ views: [baseView as never] })] }));
    return new AddProjectedViewCommand({ sheetId: 'sheet-1', baseViewId: 'bv1', direction: 'right', positionMm: { x: 150, y: 50 } } as never);
  },
},
{
  name: 'AddIsoViewCommand',
  make: () => {
    seedDrawing(makeDrawing());
    return new AddIsoViewCommand({ sheetId: 'sheet-1', positionMm: { x: 50, y: 50 }, corner: 'NE', scale: { kind: 'ratio', ratio: 1 } } as never);
  },
},
{
  name: 'DeleteViewCommand',
  make: () => {
    const view = { id: 'v1', kind: 'base', positionMm: { x: 10, y: 10 }, orientation: 'front', scale: { kind: 'ratio', ratio: 1 } };
    seedDrawing(makeDrawing({ sheets: [makeSheet({ views: [view as never] })] }));
    return new DeleteViewCommand({ sheetId: 'sheet-1', viewId: 'v1' });
  },
},
{
  name: 'RegenerateViewCommand',
  make: () => {
    const view = { id: 'v1', kind: 'base', positionMm: { x: 10, y: 10 }, orientation: 'front', scale: { kind: 'ratio', ratio: 1 } };
    seedDrawing(makeDrawing({ sheets: [makeSheet({ views: [view as never] })] }));
    const projection = { visibleEdges: [], hiddenEdges: [], bbox: { min: { x: 0, y: 0 }, max: { x: 10, y: 10 } } };
    return new RegenerateViewCommand({ sheetId: 'sheet-1', viewId: 'v1', projection: projection as never, inputFingerprint: 'fp-1' });
  },
},
{
  name: 'MoveViewCommand',
  make: () => {
    const view = { id: 'v1', kind: 'base', positionMm: { x: 10, y: 10 }, orientation: 'front', scale: { kind: 'ratio', ratio: 1 } };
    seedDrawing(makeDrawing({ sheets: [makeSheet({ views: [view as never] })] }));
    return new MoveViewCommand({ sheetId: 'sheet-1', viewId: 'v1', positionMm: { x: 99, y: 99 } });
  },
},
{
  name: 'EditViewScaleCommand',
  make: () => {
    const view = { id: 'v1', kind: 'base', positionMm: { x: 10, y: 10 }, orientation: 'front', scale: { kind: 'ratio', ratio: 1 } };
    seedDrawing(makeDrawing({ sheets: [makeSheet({ views: [view as never] })] }));
    return new EditViewScaleCommand({ sheetId: 'sheet-1', viewId: 'v1', scale: { kind: 'ratio', ratio: 2 } as never });
  },
},
{
  name: 'ToggleHiddenLinesCommand',
  make: () => {
    const view = { id: 'v1', kind: 'base', positionMm: { x: 10, y: 10 }, orientation: 'front', scale: { kind: 'ratio', ratio: 1 }, showHidden: false };
    seedDrawing(makeDrawing({ sheets: [makeSheet({ views: [view as never] })] }));
    return new ToggleHiddenLinesCommand({ sheetId: 'sheet-1', viewId: 'v1', showHidden: true });
  },
},
```

- [ ] **Step 2: Run — the 8 new cases must FAIL (RED)**

Run: `pnpm --filter app exec vitest run src/commands/__tests__/activeDrawingInvariant.guard.test.ts`
Expected: control PASSES; the 8 new cases FAIL at `after apply: activeDrawing must === activeDocument.document` (and/or `after revert`). If any new case PASSES, its fixture isn't driving the command — fix the fixture until RED (e.g. ensure the view id matches, the base view exists, the projection is supplied). Do NOT proceed to Step 3 until all 8 are RED for the right reason.

- [ ] **Step 3: Fix the 8 commands**

In EACH of the 8 view command files, add the import and rewrite BOTH `setState` calls (apply + revert lines in the Background table). Pattern — change:
```ts
useAppStore.setState({ activeDocument: { kind: 'drawing', document: next } });
```
to:
```ts
useAppStore.setState(drawingDocState(next));
```
…using the command's own local doc variable name (`next` / `nextDoc`). Add at the top of each file:
```ts
import { drawingDocState } from '../store/drawingDocState';
```
For any multi-line brace form, replace the whole object literal with `drawingDocState(<doc>)`. Leave every other field/line untouched (verified: no extra fields exist in these calls).

- [ ] **Step 4: Run — all GREEN**

Run: `pnpm --filter app exec vitest run src/commands/__tests__/activeDrawingInvariant.guard.test.ts`
Expected: PASS (9 tests: control + 8).

- [ ] **Step 5: Typecheck + commit**

```bash
pnpm --filter app typecheck
git add packages/app/src/commands/AddBaseViewCommand.ts packages/app/src/commands/AddProjectedViewCommand.ts packages/app/src/commands/AddIsoViewCommand.ts packages/app/src/commands/DeleteViewCommand.ts packages/app/src/commands/RegenerateViewCommand.ts packages/app/src/commands/MoveViewCommand.ts packages/app/src/commands/EditViewScaleCommand.ts packages/app/src/commands/ToggleHiddenLinesCommand.ts packages/app/src/commands/__tests__/activeDrawingInvariant.guard.test.ts
git commit -m "fix(active-drawing-audit): B1 view commands set activeDrawing via drawingDocState (Task 3)"
```

---

## Task 4 (Batch B2): 5 annotation/dimension commands

Same RED→GREEN discipline as Task 3.

**Files:**
- Modify: `packages/app/src/commands/__tests__/activeDrawingInvariant.guard.test.ts`
- Modify: the 5 B2 command files.

- [ ] **Step 1: Add 5 guard cases**

Imports:
```ts
import { AddDrawingAnnotationCommand } from '../AddDrawingAnnotationCommand';
import { DeleteDrawingAnnotationCommand } from '../DeleteDrawingAnnotationCommand';
import { MoveDrawingAnnotationCommand } from '../MoveDrawingAnnotationCommand';
import { AddDrawingDimensionCommand } from '../AddDrawingDimensionCommand';
import { DeleteDrawingDimensionCommand } from '../DeleteDrawingDimensionCommand';
```

Cases (copy the exact `DrawingAnnotation` / `DrawingDimension` shapes from each command's existing spec — scaffolds below):
```ts
{
  name: 'AddDrawingAnnotationCommand',
  make: () => {
    seedDrawing(makeDrawing());
    return new AddDrawingAnnotationCommand({ sheetId: 'sheet-1', ann: { id: 'a1', kind: 'note', textMm: { x: 0, y: 0 }, text: 'hi' } as never });
  },
},
{
  name: 'DeleteDrawingAnnotationCommand',
  make: () => {
    const ann = { id: 'a1', kind: 'note', textMm: { x: 0, y: 0 }, text: 'hi' };
    seedDrawing(makeDrawing({ sheets: [makeSheet({ annotations: [ann as never] })] }));
    return new DeleteDrawingAnnotationCommand({ sheetId: 'sheet-1', annId: 'a1' });
  },
},
{
  name: 'MoveDrawingAnnotationCommand',
  make: () => {
    const ann = { id: 'a1', kind: 'note', textPosMm: { x: 0, y: 0 }, text: 'hi' };
    seedDrawing(makeDrawing({ sheets: [makeSheet({ annotations: [ann as never] })] }));
    return new MoveDrawingAnnotationCommand({ sheetId: 'sheet-1', annId: 'a1', textPosMm: { x: 5, y: 5 } });
  },
},
{
  name: 'AddDrawingDimensionCommand',
  make: () => {
    seedDrawing(makeDrawing());
    return new AddDrawingDimensionCommand({ sheetId: 'sheet-1', dim: { id: 'dm1', kind: 'linear', value: 10 } as never });
  },
},
{
  name: 'DeleteDrawingDimensionCommand',
  make: () => {
    const dim = { id: 'dm1', kind: 'linear', value: 10 };
    seedDrawing(makeDrawing({ sheets: [makeSheet({ dimensions: [dim as never] })] }));
    return new DeleteDrawingDimensionCommand({ sheetId: 'sheet-1', dimId: 'dm1' });
  },
},
```

- [ ] **Step 2: Run — the 5 new cases must FAIL (RED)**

Run: `pnpm --filter app exec vitest run src/commands/__tests__/activeDrawingInvariant.guard.test.ts`
Expected: 9 prior PASS; 5 new FAIL on the invariant. Fix any false-green fixture before proceeding.

- [ ] **Step 3: Fix the 5 commands**

Add `import { drawingDocState } from '../store/drawingDocState';` and rewrite both `setState` calls in each (apply/revert lines in the Background table), same pattern as Task 3 Step 3.

- [ ] **Step 4: Run — all GREEN**

Run: `pnpm --filter app exec vitest run src/commands/__tests__/activeDrawingInvariant.guard.test.ts`
Expected: PASS (14 tests).

- [ ] **Step 5: Typecheck + commit**

```bash
pnpm --filter app typecheck
git add packages/app/src/commands/AddDrawingAnnotationCommand.ts packages/app/src/commands/DeleteDrawingAnnotationCommand.ts packages/app/src/commands/MoveDrawingAnnotationCommand.ts packages/app/src/commands/AddDrawingDimensionCommand.ts packages/app/src/commands/DeleteDrawingDimensionCommand.ts packages/app/src/commands/__tests__/activeDrawingInvariant.guard.test.ts
git commit -m "fix(active-drawing-audit): B2 annotation/dimension commands set activeDrawing (Task 4)"
```

---

## Task 5 (Batch B3): 6 sheet/properties commands + SetActiveSheet (inverse)

**Files:**
- Modify: `packages/app/src/commands/__tests__/activeDrawingInvariant.guard.test.ts`
- Modify: the 6 sheet/props command files + `SetActiveSheetCommand.ts`.

- [ ] **Step 1: Add 7 guard cases**

Imports:
```ts
import { AddSheetCommand } from '../AddSheetCommand';
import { DeleteSheetCommand } from '../DeleteSheetCommand';
import { RenameSheetCommand } from '../RenameSheetCommand';
import { EditSheetSizeCommand } from '../EditSheetSizeCommand';
import { EditDrawingPropertiesCommand } from '../EditDrawingPropertiesCommand';
import { EditTitleBlockCommand } from '../EditTitleBlockCommand';
import { SetActiveSheetCommand } from '../SetActiveSheetCommand';
```

Cases:
```ts
{
  name: 'AddSheetCommand',
  make: () => { seedDrawing(makeDrawing()); return new AddSheetCommand({}); },
},
{
  name: 'DeleteSheetCommand',
  make: () => {
    // precondition: ≥2 sheets (else throws LAST_SHEET)
    seedDrawing(makeDrawing({ sheets: [makeSheet({ id: 'sheet-1' }), makeSheet({ id: 'sheet-2', name: 'Sheet 2' })] }));
    return new DeleteSheetCommand({ sheetId: 'sheet-2' });
  },
},
{
  name: 'RenameSheetCommand',
  make: () => { seedDrawing(makeDrawing()); return new RenameSheetCommand({ sheetId: 'sheet-1', name: 'Renamed' }); },
},
{
  name: 'EditSheetSizeCommand',
  make: () => { seedDrawing(makeDrawing()); return new EditSheetSizeCommand({ sheetId: 'sheet-1', size: { kind: 'iso', size: 'A4' } as never, orientation: 'portrait' }); },
},
{
  name: 'EditDrawingPropertiesCommand',
  make: () => { seedDrawing(makeDrawing()); return new EditDrawingPropertiesCommand({ properties: { author: 'X' } }); },
},
{
  name: 'EditTitleBlockCommand',
  make: () => { seedDrawing(makeDrawing()); return new EditTitleBlockCommand({ sheetId: 'sheet-1', overrides: { title: 'T' } as never }); },
},
{
  name: 'SetActiveSheetCommand (inverse offender)',
  make: () => {
    seedDrawing(makeDrawing({ sheets: [makeSheet({ id: 'sheet-1' }), makeSheet({ id: 'sheet-2', name: 'Sheet 2' })] }));
    return new SetActiveSheetCommand({ sheetId: 'sheet-2' });
  },
},
```

- [ ] **Step 2: Run — the 7 new cases must FAIL (RED)**

Run: `pnpm --filter app exec vitest run src/commands/__tests__/activeDrawingInvariant.guard.test.ts`
Expected: 14 prior PASS; 7 new FAIL. Note SetActiveSheet fails differently — it sets `activeDrawing` but `activeDocument` stays stale, so `activeDocument.document !== activeDrawing` (or kind check). Fix any false-green before proceeding.

- [ ] **Step 3a: Fix the 6 standard sheet/props commands**

Add `import { drawingDocState } from '../store/drawingDocState';` and rewrite both `setState` calls in each (apply/revert lines in Background table), same pattern as Task 3 Step 3. AddSheet uses a multi-line brace form — replace its object literal with `drawingDocState(<doc>)`.

- [ ] **Step 3b: Fix SetActiveSheetCommand (special — inverse direction)**

Open `SetActiveSheetCommand.ts`. Today its `apply` and `revert` build a new drawing doc (with the new/old `activeSheetId`) and call `useAppStore.setState({ activeDrawing: <newDoc> })`, leaving `activeDocument` stale. Add `import { drawingDocState } from '../store/drawingDocState';` and change BOTH calls to `useAppStore.setState(drawingDocState(<newDoc>))`, where `<newDoc>` is the document it currently assigns to `activeDrawing`. If it currently mutates the live doc in place rather than producing a new doc object, build the new doc explicitly:
```ts
const nextDoc = { ...drawing, activeSheetId: <targetSheetId> };
useAppStore.setState(drawingDocState(nextDoc));
```
Confirm by reading the file — preserve its existing no-op guard (`if activeDrawing is null return`) and its prev-sheet capture for revert.

- [ ] **Step 4: Run — all GREEN**

Run: `pnpm --filter app exec vitest run src/commands/__tests__/activeDrawingInvariant.guard.test.ts`
Expected: PASS (21 tests).

- [ ] **Step 5: Typecheck + commit**

```bash
pnpm --filter app typecheck
git add packages/app/src/commands/AddSheetCommand.ts packages/app/src/commands/DeleteSheetCommand.ts packages/app/src/commands/RenameSheetCommand.ts packages/app/src/commands/EditSheetSizeCommand.ts packages/app/src/commands/EditDrawingPropertiesCommand.ts packages/app/src/commands/EditTitleBlockCommand.ts packages/app/src/commands/SetActiveSheetCommand.ts packages/app/src/commands/__tests__/activeDrawingInvariant.guard.test.ts
git commit -m "fix(active-drawing-audit): B3 sheet/properties + SetActiveSheet inverse offender (Task 5)"
```

---

## Task 6: Final gate

- [ ] **Step 1: Grep for any remaining raw drawing setState**

Run:
```bash
grep -rn "activeDocument: { kind: 'drawing'" packages/app/src/commands --include="*.ts" | grep -v "drawingDocState"
```
Expected: only matches inside ALREADY-CORRECT commands that intentionally also set `activeDrawing` on the same line (the multi-line `{ activeDocument: {...}, activeDrawing: ... }` form). Any offender-style single-field match is a miss — fix it and add its guard case. (Optional consistency cleanup of the correct commands to the helper is OUT OF SCOPE per §3.)

- [ ] **Step 2: Full package test + typecheck**

Run:
```bash
pnpm --filter app typecheck && pnpm --filter shared test:unit && pnpm --filter app test:unit 2>&1 | grep -E "Test Files|Tests"
```
Expected: typecheck clean; shared 707 pass; app = prior 1634 + 21 guard tests + 2 helper tests = **1657** pass (245+2 test files). Confirm no regressions.

- [ ] **Step 3: Full repo gate**

Run: `pnpm -r typecheck && pnpm -r test:unit 2>&1 | grep -E "Test Files|Tests"`
Expected: all green; totals = 707 shared + 37 sketcher-worker + 346 kernel + 1657 app.

---

## Self-review notes (for the executor)

- **No manifest bump, no migration, no renderer change** — `activeDrawing` is runtime store state only. Do NOT edit `renderDrawingSvg.ts` or bump the manifest version.
- **Do NOT modify any already-correct command** (the 13 listed). They are read by the guard suite (control row) but not edited. The optional consistency migration is deferred.
- **RED is mandatory per command.** A guard case that passes before the fix proves the fixture doesn't drive the command — the most likely failure mode of this plan. Always confirm RED-for-the-right-reason before applying the helper.
- **Constructor/fixture shapes in this plan are scaffolds.** The authoritative source for each command's exact arg/doc shape is its existing `__tests__/<Command>.spec.ts`. When a scaffold doesn't typecheck, copy the proven shape from that spec rather than guessing further.
- If a command's `apply`/`revert` turns out NOT to omit `activeDrawing` after you read it (contradicting the Background table), STOP — the table was verified at 86% read-confidence; reconcile before editing.
