# Section/detail view Regenerate — design

**Date:** 2026-05-26
**Status:** Approved (brainstorming) → writing-plans
**Feature:** Extend `handleRegenerate` so section and detail drawing views re-project from the reloaded source (today it bails for them; only base/projected/iso regenerate). Completes the regenerate story across all view kinds.

## Goal

`handleRegenerate` (`packages/app/src/drawing/DrawingCanvas.tsx:500`) currently early-returns for `view.kind === 'section' || 'detail'` — it just clears the stale marker and does nothing. `computeStaleViewIds` (`computeStaleViewIds.ts`) ALREADY marks section/detail views stale (any view with a `projection` whose `inputFingerprint` ≠ `activeDrawingSourceFingerprint`). So the staleness detection exists; only the re-projection is missing.

After this feature: a saved drawing whose source part/assembly changed → reopen → all view kinds (base/projected/iso/section/detail) go stale → Regenerate updates each.

**Decided in brainstorming (both recommendations accepted):**
1. **Detail cascade** — regenerating a detail first regenerates its parent if the parent is stale, then re-clips the detail against the fresh parent. Depth 1 (details can't parent details).
2. **Include assembly-sourced sections** — section Regenerate reuses `resolveSectionSource` (part → `cutBySectionPlane`, assembly → `cutAssemblyBySectionPlane`); both supported.

## Verified existing pieces (reuse, do not rebuild)

- `handleRegenerate` — `DrawingCanvas.tsx:500–540`. Bails for section/detail (kind check, clears stale flag, returns). Base/projected/iso path: derive orientation → `projectViewFromSource(orientation)` → `RegenerateViewCommand.apply()` updates `projection` + `inputFingerprint`.
- `computeStaleViewIds` — `computeStaleViewIds.ts`. Marks ANY view stale on `inputFingerprint` mismatch (already covers section/detail).
- Section creation — `AddSectionViewCommand.ts:37–151`: `resolveSectionSource(view, drawing)` → `{kind:'part'|'assembly', id}` from `drawing.source`; part → `cutBySectionPlane(partId, plane, arrowDirection, splitPlane, splitSide)` / assembly → `cutAssemblyBySectionPlane(asmId, …)` (`kernel/cutBySectionPlane.ts:23/42`). Returns `{ ok, compound: ProjectorInput, faceTags }`. `SectionView` (`packages/shared/src/drawing/types.ts:136`) stores `parentViewId`, `sectionLine`, `plane?`, `hatchSegments`, `fingerprint`, `projection?`, `inputFingerprint?`.
- Detail creation — `AddDetailViewCommand.ts:36`; `projectDetailView` (`packages/shared/src/drawing/projectDetailView.ts:92`, pure-2D, clips `parentView.projection` against `regionParent`). `reprojectDetailRegion.ts` already re-clips a detail against its parent's current projection on region-edit. `DetailView` (`types.ts:193`) stores `parentViewId`, `regionParent` (circle|rect), `projection?`, `inputFingerprint?` (= djb2(parent fingerprint + regionParent + scale)).
- Source kernel slots: `activeDrawingSourcePartId` / `activeDrawingSourceComponents` (re-warmed by `activateDrawingDocument` on reopen) — the same slots base-view projection uses; section re-cut reads them.

## Architecture — two regenerate paths + cascade, dispatched from handleRegenerate

### Section Regenerate (self-contained)
Given the existing `SectionView` (stored `plane`, `sectionLine`, cut params): resolve the source via `resolveSectionSource`, re-run the same kernel cut used at creation (`cutBySectionPlane` / `cutAssemblyBySectionPlane`), re-project the resulting compound, recompute `hatchSegments`, and set `inputFingerprint = activeDrawingSourceFingerprint`. Update the view in place (a regenerate command analogous to the base-view `RegenerateViewCommand`, or an extension of it — the plan decides the exact command shape; reuse `AddSectionViewCommand`'s cut/project/hatch logic, do not duplicate it). A section's geometry depends only on source + plane (NOT its `parentViewId`, which is a layout reference), so section regenerate does NOT cascade.

### Detail Regenerate (pure-2D re-clip + cascade up)
1. If the detail's parent is stale, regenerate the parent first: base/projected/iso → `projectViewFromSource`; section → the section re-cut above.
2. Re-clip the detail against the parent's (now fresh) `projection` via `projectDetailView` / `reprojectDetailRegion`.
3. Recompute the detail's `inputFingerprint` (djb2 of parent fingerprint + regionParent + scale).
Cascade depth is 1 (details cannot be parents).

### handleRegenerate dispatch
Replace the section/detail bail with a kind dispatch: `section` → regenerate-section; `detail` → cascade-parent-then-reclip; base/projected/iso → unchanged. Clear the stale marker only on success.

## Error handling
- Section re-cut fails (source missing, kernel error, missing assembly component part) → keep the stale flag, `setStatus` an error, leave the view's last-good `projection` intact (do not blank it).
- Detail cascade: if the parent regenerate fails, the detail stays stale (do not clip against bad/stale data).

## Testing

**TDD slices (red→green):**
1. Section regenerate (part source): re-cut updates `projection` + sets `inputFingerprint = activeDrawingSourceFingerprint`.
2. Assembly-sourced section regenerate via `cutAssemblyBySectionPlane`.
3. Detail regenerate: re-clips against a fresh parent projection, updates `projection` + `inputFingerprint`.
4. Detail cascade: a stale parent is regenerated BEFORE the detail is clipped.
5. Section re-cut failure keeps the view stale + last-good projection intact.

**e2e T-6-21** (real geometry, `tests/e2e/drawing/`): build a part → drawing with a base view + a section view + a detail view (detail parented to the base) → Save As `.zidw` → edit the part (re-save changed bytes) → reopen → assert all three stale → Regenerate the section (assert its geometry changed) → Regenerate the detail (assert it cascaded the base regenerate and the detail edges changed). Drives the REAL `cutBySectionPlane` / `projectDetailView` path — no stand-ins (per the file-reopen lesson; re-run + read the console back).

## Out of scope (v1)
- A "Regenerate all stale" button (per-view Regenerate only).
- Changing how sections/details are CREATED or how staleness is COMPUTED (both already work).
- Stepped/half section variants get re-cut through the same `cutBySectionPlane` they were created with — no special-casing.

## Open items for the plan's verifier / implementer to confirm against real code
1. The exact section re-cut parameters stored on `SectionView` (mode half/stepped, `splitPlane`/`splitSide`, `arrowDirection`) so the regenerate re-cut uses identical inputs to creation.
2. Whether to extend `RegenerateViewCommand` (dispatch on kind) or add `RegenerateSectionViewCommand` / `RegenerateDetailViewCommand` — pick the lower-churn option that reuses creation helpers.
3. How `handleRegenerate` reads a view's parent (`parentViewId` lookup in `sheet.views`) and the stale set, for the detail cascade.
4. Section `hatchSegments` recomputation: confirm the creation hatch logic is reusable in regenerate (same faceTags → hatch path).
5. How the detail finds + reads the parent's updated `projection` post-cascade within one Regenerate action (state read ordering).
