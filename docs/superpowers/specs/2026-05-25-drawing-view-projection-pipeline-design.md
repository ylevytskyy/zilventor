# Design: Wire the live-UI drawing-view projection pipeline

**Date:** 2026-05-25
**Feature ID:** F3.9 / Phase-8-completion (drawing view projection)
**Status:** Design — awaiting user review before plan

## Problem statement

Base / projected / iso drawing views cannot be created or refreshed with real
geometry in the live application. Everything *around* the projection pipeline
exists and is tested — the data model, the create commands
(`AddBaseViewCommand`, `AddProjectedViewCommand`, `AddIsoViewCommand`),
`RegenerateViewCommand`, the pure-JS projector (`projectView`), the kernel RPC
that tessellates a part into projector input (`getProjectorInput`), both
renderer paths, and PDF/SVG/PNG export. But the wiring that turns a user gesture
into a real projection was deferred ("wired in Phase 8 batch 2") and never
completed.

Confirmed against all non-test app code:

- `AddBaseViewCommand` / `AddIsoViewCommand` / `AddProjectedViewCommand` — **never dispatched**.
- `getProjectorInput` (kernel RPC) — **never called from the app**.
- `projectView()` — called **only in a benchmark** (`App.tsx:2841`).
- `RegenerateViewCommand` — correct and unit-tested, but **never dispatched**.
- `DrawingCanvas` `placeBase` click branch (`DrawingCanvas.tsx:838`) — a no-op.
- `handleRegenerate` (`DrawingCanvas.tsx:842`) — only deletes the yellow stale marker; no re-projection.
- Nothing clears a view's `inputFingerprint` when the source part changes, so the stale marker is never triggered by a real edit.

Every shipped drawing test/e2e (including `T-6-2-place-views`) sidesteps this by
**hand-typing** `projection` edge data and a fake `inputFingerprint` directly
into the store. The "F3.9/F2.9 Regenerate doesn't re-project" symptom is one
downstream consequence of this larger gap.

## Goal / success criteria

A user can, in the live app:

1. Place a **base** view (pick orientation + scale in the dialog, click the sheet) and see **real** projected edges of the source part.
2. Place **projected** views (orthographic neighbours of a base view) and **iso** views, also with real geometry.
3. Click **Regenerate** on a view and have it re-fetch source geometry and re-project (not just hide the marker).
4. Edit the source part, return to the drawing, and see the affected views flagged **stale**.

Verified end-to-end with a real-geometry Playwright flow (not hand-typed
fixtures) plus a projection round-trip perf check.

## Locked decisions (from brainstorming)

- **Scope:** full pipeline wiring (placement + projection + regenerate + staleness).
- **Command structure:** project inside the create command's **async `apply()`**, via a **shared helper** reused by create *and* regenerate. Matches the existing `AddSectionViewCommand` / `AddDetailViewCommand` precedent.
- **Staleness:** **cheap feature-tree fingerprint compared on drawing activation** (see below). This was reconciled from the original "eager clear on edit" pick once the single-active-document constraint was discovered.
- **View kinds this pass:** **base + projected + iso**. Section/detail left as-is.

## Architecture

### Shared projection helper (NEW)

`packages/app/src/drawing/projectViewFromSource.ts`

```
async projectViewFromSource(orientation: ViewOrientation):
    Promise<{ projection: ProjectedGeometry; inputFingerprint: string }>

  state    = useAppStore.getState()
  kernel   = state.kernel                                  // Comlink proxy; throw if absent
  kernelId = state.activeAssembly?.id
             ?? state.activePart?.id
             ?? <drawing>.source.id                        // mirrors AddSectionViewCommand:115
  input    = await kernel.getProjectorInput({ kind: 'part', partId: kernelId })
             // → null if partId not in the kernel's namedShapeCache → throw a clear error
  projection       = projectView(input, orientation)       // pure JS, synchronous
  inputFingerprint = fingerprintPartState(<source part doc>)  // cheap, no kernel — see Staleness
  return { projection, inputFingerprint }
```

The helper is the single orchestration point. Both the create commands' `apply()`
and the Regenerate handler call it; there is no duplicated "fetch + project +
fingerprint" logic.

`getProjectorInput` contract (kernel): args
`{ kind: 'part'; partId: string } | { kind: 'assembly'; components: [...] }`,
returns `{ triangles, edges, bbox } | null`. `null` when the part isn't in the
kernel cache. The source part is **not guaranteed loaded** in the kernel unless
it was `execute()`d — but when a drawing is active its source part rides along
as `activePart`, the same condition under which section views already cut
successfully. The helper surfaces a clear error if the source geometry is
absent.

### Command changes (all → async `apply()`)

- **`AddBaseViewCommand`** — orientation maps 1:1 to `ViewOrientation`
  (`front|top|right|back|bottom|left`). After building the view object, call the
  helper and store `projection` + `inputFingerprint`. Revert removes the view
  (no recompute).
- **`AddIsoViewCommand`** — `corner ('NE'|'NW'|'SE'|'SW') → 'iso-<corner>'`
  (`ViewOrientation` already supports `iso-NE/NW/SE/SW`), then the helper.
- **`AddProjectedViewCommand`** — needs a NEW pure function
  `deriveProjectedOrientation(baseOrientation, direction) → ViewOrientation`
  (third-angle orthographic neighbour table, ≤24 cases, fully TDD'd), then the
  helper. No kernel/projector changes required.

Undo semantics: `apply()` becoming async only affects creation; revert for the
Add* commands stays a synchronous view removal. `RegenerateViewCommand` already
captures the prior projection for revert.

### UI wiring (`DrawingCanvas` / `DrawingTab`)

- **placeBase branch** (`handleClick`, currently no-op at `:838`): read
  `pendingViewParams` (kind `'base'`, orientation, scale — already collected by
  `AddViewDialog`), compute the sheet-space point with the existing click→point
  conversion (`:309`), `bus.execute(new AddBaseViewCommand({ sheetId,
  positionMm, orientation, scale }))`, then reset the tool mode.
- **Projected placement**: with a base view selected, the Projected tool's click
  infers `direction` (`top|bottom|left|right`) from the click position relative
  to the base view's bbox, then dispatches `AddProjectedViewCommand`.
- **Iso placement**: corner chosen in the dialog (default `NE`), click to place,
  dispatch `AddIsoViewCommand`.
- **`handleRegenerate`** (`:842`): replace the marker-only stub with — re-run
  `projectViewFromSource` for the view's orientation, then
  `bus.execute(new RegenerateViewCommand(viewId, freshProjection,
  freshFingerprint))` (the command already handles the breaks/`rawProjection`
  branch correctly), then drop the stale flag.

### Staleness — cheap feature-tree fingerprint, compared on activation

The store is **single-active-document**: when the user edits the source part,
the drawing is not loaded, so there is no view object to mutate at edit time.
Therefore staleness is evaluated when the **drawing activates**:

- At projection time, `inputFingerprint = fingerprintPartState(sourcePartDoc)` —
  a synchronous hash of the source part document's feature-tree / parameter
  state **already held in the store** (NOT a kernel tessellation, so no worker
  round-trip).
- On drawing activation, recompute `fingerprintPartState` from the now-loaded
  source part and compare against each view's stored `inputFingerprint`; on
  mismatch, mark the view stale (surface the existing yellow marker).

This delivers the intent ("source changed → view goes stale"), avoids the
per-activation kernel cost, and is correct across app restarts (the hash is
deterministic from saved part data).

> **Batch-1 verification item:** confirm the exact serialized field on the part
> document that represents its feature-tree/parameter state, and that it is
> available as `activePart` when a drawing is active. The fingerprint hashes that
> field. If the field is not reliably present, fall back to hashing the part's
> full serialized document.

## Scope boundary

- **In scope:** base / projected / iso — placement, projection, regenerate, staleness detection.
- **Out of scope (unchanged from today):** section / detail views. They already
  project on creation; their regenerate-on-source-change is heavier (section
  requires a kernel re-cut via `cutBySectionPlane`) and is an explicit
  follow-up. Staleness detection and the Regenerate action in this pass apply to
  base/projected/iso only, keeping the behaviour consistent within the scoped
  set.

## Verification

A real-geometry Playwright e2e (the case existing specs avoided):

1. Seed a **real** box part into the kernel cache (`buildBox` → `kernel.execute`,
   so `activePart.id` is in `namedShapeCache`).
2. Create a drawing that sources it.
3. Drive the actual `placeBase` UI (open dialog → pick orientation → click sheet).
4. Assert **real** projected edges render (geometry derived by the kernel, not hand-typed).
5. Exercise Regenerate and the stale marker.

Plus a perf check on the `getProjectorInput` + `projectView` round-trip (budget
to be set against existing drawing perf thresholds; tessellation is heavier than
the pure-2D drawing ops, so expect a larger but bounded budget).

## Rough batch plan (~6)

1. **B1** — shared `projectViewFromSource` helper + `AddBaseViewCommand` async projection + placeBase canvas wiring. (TDD: command produces empty projection → produces real projection.)
2. **B2** — `deriveProjectedOrientation` third-angle table + `AddProjectedViewCommand` async projection + projected placement wiring.
3. **B3** — iso corner→orientation mapping + `AddIsoViewCommand` async projection + iso placement wiring.
4. **B4** — Regenerate wiring (`handleRegenerate` → helper → `RegenerateViewCommand`) for base/projected/iso.
5. **B5** — staleness: `fingerprintPartState` + activation-time recompute/compare → mark stale.
6. **B6** — real-geometry Playwright e2e + projection round-trip perf check.

## Risks / open items

- **R1** — exact part-doc field for `fingerprintPartState` (resolved in B1; see verification item above).
- **R2** — projected placement UX: inferring `direction` from click position vs. base bbox; if it proves fiddly, fall back to a discrete side-picker (does not change the projection logic).
- **R3** — source part not loaded in the kernel cache when its drawing activates; the helper throws a clear error, and the e2e must seed the part via `kernel.execute`. Confirm the live load path guarantees this (or load on demand).
- **R4** — async `apply()` undo/redo: confirm the bus + revert behave with async creation (precedent: `AddSectionViewCommand`).
