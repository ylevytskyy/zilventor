# Kerf + per-panel oversize nesting — design (Milestone 1b.2)

**Date:** 2026-06-19
**Branch:** `feat/wall-tall-cabinets`
**Source plan:** `docs/furniture-mvp-plan:docs/superpowers/plans/2026-06-18-furniture-mvp-implementation-plan.md` (Milestone 1b.2)

## Goal

Cut-list rows carry a raw (net + oversize) cut size; nesting packs on raw sizes with the
existing kerf gap; the nest dialog exposes an oversize input. This lets a panel shop cut
parts oversize (for later trimming / edge-banding) while the model keeps finished sizes.

## Corrections to the source plan (verified during exploration)

- **No manifest migration.** `CutListRow` is computed on-the-fly (`packages/shared/src/cutListRow.ts`,
  `aggregateCutListLocal`), not serialized. Only `NestState.params` is persisted and it already
  round-trips (`AssemblyDocument.nest?`). The plan's "no migration" holds; nothing to migrate.
- **Oversize input lives in `NestDialog.tsx`**, not `NestingTab` — that is where the kerf field
  already is. The plan said NestingTab.

## Data model

`packages/shared/src/cutListRow.ts`
- Add `oversize?: { lengthMm: number; widthMm: number }` to `CutListRow`. Absent = no oversize
  (back-compatible).
- Pure helpers: `rawLength(row) = row.length + (row.oversize?.lengthMm ?? 0)` and `rawWidth(row)`.
  Net = finished size (labels); raw = cut size (saw / nest footprint).

## Packing

`packages/shared/src/nesting/packGuillotine.ts` + `packAllMaterials.ts`
- Add `oversize?: { lengthMm: number; widthMm: number }` to `NestInputRow`.
- The packer computes effective footprint = raw (net + oversize), falling back to net when
  oversize is absent, then applies the **existing** `kerfMm` gap between placed parts. Kerf logic
  is untouched — an oversized part simply occupies a larger rectangle. Placed-panel rectangles
  are raw-sized (the size the saw cuts).
- Oversized-exceeds-sheet filtering uses the raw footprint.

## Command + UI

`packages/app/src/commands/GenerateNestCommand.ts`
- `opts` gains `oversize?: { lengthMm: number; widthMm: number }` — **one global value for the
  whole job** (MVP). `apply()` stamps it onto each mapped `NestInputRow` and persists it in
  `NestState.params` alongside `kerfMm`.

`packages/app/src/shell/NestDialog.tsx`
- Two numeric inputs (Length oversize / Width oversize, default 0) beside the kerf field, dispatched
  through `GenerateNestCommand`.

## Scope decisions

- **Global** oversize for the whole job (MVP). The `oversize` field lives per-row, so true
  per-panel control is a clean later slice; the UI sets one value applied to all rows.
- **Asymmetric** (separate length / width) per the plan's `{ lengthMm, widthMm }`.

## TDD slices (red → green)

1. `cutListRow.spec.ts` — `rawLength` / `rawWidth` helpers (oversize present + absent fallback).
2. `packGuillotine.spec.ts` — two oversized parts fit-or-not with `kerf=3`; raw footprint drives
   placement coordinates.
3. `GenerateNestCommand` test — opts oversize lands on every `NestInputRow` and persists in
   `NestState.params`.
4. §6 browser e2e — NestDialog oversize input changes a nest layout (placement coords shift).

## Risks / deferred

- Per-panel (vs global) oversize UI — field exists, UI later.
- Per-material oversize.
- Interaction with 1b.3 gross (edge-band) sizes — both grow cut size; 1b.3 will reconcile which
  size feeds nesting. Out of scope here.
