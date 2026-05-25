# Systemic `activeDrawing`-on-setState Audit — Design

**Date:** 2026-05-25
**Status:** Approved (brainstorming) — pending implementation plan
**Scope:** Cross-cutting correctness fix. ~3 batches. No new feature surface.

## Problem

`DrawingDocument` is the active drawing held in two places in the Zustand store:

- `activeDocument: { kind:'drawing', document } | …` — the generic active-document slot.
- `activeDrawing: DrawingDocument | null` — a drawing-specific field that five UI surfaces subscribe to: `DrawingCanvas.tsx`, `DimensionElement.tsx`, `DrawingTreePane.tsx`, and `App.tsx`.

The store action `setActiveDocument` (`packages/app/src/store/useAppStore.ts:343`) already keeps these in sync — it **derives** `activeDrawing` from the document kind (line 347). But ~21 of 33 drawing **commands** bypass that action and call `useAppStore.setState({ activeDocument: { kind:'drawing', document: nextDoc } })` directly, omitting `activeDrawing`.

Consequence: after an offending command runs — and most visibly after its **undo/redo** — `activeDocument` advances but `activeDrawing` stays pointing at the previous (now stale) document. The canvas, dimension layer, and tree pane render stale geometry. This is a latent undo/redo-staleness bug. Commands shipped in F2/F2.4/F6/F2.1 already set both fields and are correct; the remainder are not.

This audit consolidates the F3.10 and F5.10 findings plus the systemic remainder.

## Root cause

The derivation that should be authoritative (`setActiveDocument`) is duplicated by hand in the "fixed" commands and simply omitted in the offenders. The bug exists because `activeDrawing` is *derivable* state that each command must remember to set manually. The fix removes the per-command guesswork by giving every drawing command one correct way to produce the state slice.

## Fix

### 1. Shared state-slice helper

Add to the store module (exported from `useAppStore.ts` or a sibling file):

```ts
export function drawingDocState(nextDoc: DrawingDocument) {
  return {
    activeDocument: { kind: 'drawing' as const, document: nextDoc },
    activePart: null,
    activeAssembly: null,
    activeDrawing: nextDoc,
  };
}
```

This mirrors the derivation `setActiveDocument` performs for the drawing case, in a form spreadable into a single `setState`.

### 2. Route offending commands through the helper

Each offending command's `apply` **and** `revert` change from:

```ts
useAppStore.setState({ activeDocument: { kind: 'drawing', document: nextDoc } });
```

to:

```ts
useAppStore.setState({ ...drawingDocState(nextDoc), /* …any extra fields this command already set… */ });
```

The spread preserves single-`setState` atomicity (no double re-render) and lets a command merge any additional fields it already writes (e.g. selection state).

### 3. Leave already-correct commands untouched

Per CLAUDE.md §3 (surgical — don't refactor working code), commands that already set both fields are not migrated. A consistency migration of those to the helper is a **deferred optional follow-up**, not part of this work.

## Tests — parametrized guard suite

One new table-driven test file. Each row supplies a command name and a factory that builds the command against a minimal drawing-document store fixture. The harness, for every row:

1. `apply()` → assert `getState().activeDocument.kind === 'drawing'` **and** `getState().activeDrawing === getState().activeDocument.document`.
2. `revert()` → assert the same invariant holds for the reverted document.

Properties:

- DRY — one assertion shape covers all ~21 commands.
- Permanent regression net — a future command that drifts (or is added without the helper) fails the suite via a new row.
- Existing per-command tests (`EditDetailRegionCommand`, `AddDetailViewCommand`) are left as-is; they remain valid.

## Scope and non-goals

- **No manifest bump.** `activeDrawing` is runtime store state, never serialized. No `.zidw` shape change → no migration.
- **No renderer change.** This is not a two-renderer-path (`*.tsx` + `renderDrawingSvg.ts`) feature; nothing persisted or exported changes. The two-renderer-parity rule does not apply.
- **Exact offender list is verified, not assumed.** The originating audit reported 78% confidence with 13 of 33 commands classified by grep heuristic rather than full read. **Plan task 0 re-reads every drawing command's `apply`/`revert`** to confirm the precise offender set before any edit. The list below is the working hypothesis, subject to that verification.

### Working offender hypothesis (verify in plan task 0)

AddBaseViewCommand, AddProjectedViewCommand, AddIsoViewCommand, DeleteViewCommand, RegenerateViewCommand, MoveViewCommand, EditViewScaleCommand, ToggleHiddenLinesCommand, AddDrawingAnnotationCommand, DeleteDrawingAnnotationCommand, MoveDrawingAnnotationCommand, AddDrawingDimensionCommand, DeleteDrawingDimensionCommand, AddBreakCommand, DeleteBreakCommand, DeleteDimensionGroupCommand, AddSheetCommand, DeleteSheetCommand, RenameSheetCommand, EditSheetSizeCommand, EditDrawingPropertiesCommand, EditTitleBlockCommand.

Already-correct (do not touch): AddAngularDimCommand, AddBaselineMemberCommand, AddDetailViewCommand, AddDimensionGroupCommand, AddHoleTableCommand, AddOrdinateMemberCommand, AddSectionViewCommand, AutoDimCommand, EditDetailRegionCommand, MoveDrawingDimensionCommand, SetActiveSheetCommand.

## Batches (~3)

- **B1** — `drawingDocState` helper + guard-suite harness + **view commands**: AddBaseView, AddProjectedView, AddIsoView, DeleteView, RegenerateView, MoveView, EditViewScale, ToggleHiddenLines.
- **B2** — **annotation / dimension / break commands**: Add/Delete/MoveDrawingAnnotation, Add/DeleteDrawingDimension, Add/DeleteBreak, DeleteDimensionGroup.
- **B3** — **sheet + properties commands**: Add/Delete/RenameSheet, EditSheetSize, EditDrawingProperties, EditTitleBlock.

Each batch follows red → green → refactor: add the guard rows for that batch's commands (red — they fail on the stale `activeDrawing`), apply the helper (green), full `packages/app test:unit` stays green.

## Success criteria

- Every drawing command that writes a drawing document leaves `activeDrawing === activeDocument.document` after both `apply` and `revert`.
- Parametrized guard suite covers all such commands and is green.
- `pnpm -r typecheck` clean; `pnpm -r test:unit` green at its prior count plus the new guard rows.
- No manifest bump, no renderer-path change, no already-correct command modified.
