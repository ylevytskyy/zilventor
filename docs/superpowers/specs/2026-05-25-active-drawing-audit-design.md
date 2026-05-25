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
- **Exact offender list is verified.** A full per-command read (apply + revert, with line numbers) replaced the originating audit's 78%-confidence/13-grep-only guess. The verified lists below are authoritative (86% read-level confidence; the residual caveat is test-driveability of three kernel-heavy *already-correct* commands — AddSectionView, AutoDim, AddDetailView — which are excluded from the parametrized loop anyway, so it does not affect classification).

### Verified offender list (20 commands to fix)

**Standard offenders — `apply` AND `revert` both omit `activeDrawing` (19):**
- **View (8):** AddBaseViewCommand, AddProjectedViewCommand, AddIsoViewCommand, DeleteViewCommand, RegenerateViewCommand, MoveViewCommand, EditViewScaleCommand, ToggleHiddenLinesCommand.
- **Annotation/dimension (5):** AddDrawingAnnotationCommand, DeleteDrawingAnnotationCommand, MoveDrawingAnnotationCommand, AddDrawingDimensionCommand, DeleteDrawingDimensionCommand.
- **Sheet/properties (6):** AddSheetCommand, DeleteSheetCommand, RenameSheetCommand, EditSheetSizeCommand, EditDrawingPropertiesCommand, EditTitleBlockCommand.

**Inverse offender (1):** SetActiveSheetCommand writes `activeDrawing` *only* and never updates `activeDocument` — divergence in the opposite direction. It fails the same `activeDrawing === activeDocument.document` invariant, so it is in scope. Fix: build `nextDoc` with the new `activeSheetId` and spread `drawingDocState(nextDoc)` (sets both fields) in apply and revert.

**Already-correct (do NOT touch — set both fields in apply + revert):** AddAngularDimCommand, AddBaselineMemberCommand, AddBreakCommand, AddDetailViewCommand, AddDimensionGroupCommand, AddHoleTableCommand, AddOrdinateMemberCommand, AddSectionViewCommand, AutoDimCommand, DeleteBreakCommand, DeleteDimensionGroupCommand, EditDetailRegionCommand, MoveDrawingDimensionCommand. *(Audit-hypothesis correction: AddBreak/DeleteBreak/DeleteDimensionGroup are correct — earlier guess wrongly listed them as offenders.)*

**Verified facts that shape the plan:**
- **No EXTRA store fields.** No drawing command writes anything beyond `activeDocument`/`activeDrawing`/`activePart`/`activeAssembly` in its `setState`. Spreading `drawingDocState(nextDoc)` (which nulls part/assembly) is safe for every command.
- **No shared test drawing factory exists** — each spec defines a local `makeDrawing()`. The guard suite hoists ONE shared `makeDrawing()` helper.
- **Existing specs seed `activeDocument` WITHOUT `activeDrawing`.** The guard harness must establish a valid baseline (e.g. call `setActiveDocument(...)`) so the invariant holds *before* the command runs — otherwise the baseline itself is divergent.
- **Several commands guard/throw** if fixtures are unmet: AddProjectedView throws without a matching base view; DeleteSheet throws `LAST_SHEET` with <2 sheets; AddDetailView throws without parent `.projection`. Each guard row's fixture must satisfy the command's preconditions or `apply` no-ops/throws before `setState`.

## Batches (~3)

- **B1** — `drawingDocState` helper + guard-suite harness (+ shared `makeDrawing()`) + **8 view commands**: AddBaseView, AddProjectedView, AddIsoView, DeleteView, RegenerateView, MoveView, EditViewScale, ToggleHiddenLines.
- **B2** — **5 annotation/dimension commands**: Add/Delete/MoveDrawingAnnotation, Add/DeleteDrawingDimension.
- **B3** — **6 sheet/properties commands + SetActiveSheet (inverse)**: Add/Delete/RenameSheet, EditSheetSize, EditDrawingProperties, EditTitleBlock, SetActiveSheet.

Each batch follows red → green → refactor: add the guard rows for that batch's commands (red — they fail on the stale `activeDrawing`), apply the helper (green), full `packages/app test:unit` stays green.

## Success criteria

- Every drawing command that writes a drawing document leaves `activeDrawing === activeDocument.document` (kind `'drawing'`) after both `apply` and `revert` — including the inverse offender SetActiveSheet.
- Parametrized guard suite covers all 20 touched commands plus ≥1 already-correct positive-control row (proves the harness detects correctness, not just failure), and is green.
- `pnpm -r typecheck` clean; `pnpm -r test:unit` green at its prior count plus the new guard rows.
- No manifest bump, no renderer-path change, no already-correct command modified (other than the positive-control rows being *read* by the test, not edited).
